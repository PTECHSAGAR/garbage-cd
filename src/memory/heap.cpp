#include "memory/heap.hpp"

#include <algorithm>
#include <chrono>
#include <stdexcept>
#include <unordered_set>

namespace memory {

gc::ObjectHandle Heap::allocate() {
    auto object = std::make_unique<Object>();
    object->allocSeq = stats_.totalAllocations + 1;
    object->allocStatement = currentStatement_;
    objects_.push_back(std::move(object));
    slotInUse_.push_back(true);
    stats_.totalAllocations++;

    gc::ObjectHandle handle(objects_.size() - 1);
    return handle;
}

void Heap::setRoot(const std::string& name, gc::ObjectHandle handle) {
    roots_[name] = resolve(handle) == nullptr ? gc::ObjectHandle::invalid() : handle;
}

void Heap::clearRoot(const std::string& name) {
    roots_.erase(name);
}

void Heap::setField(gc::ObjectHandle obj, const std::string& field, gc::ObjectHandle target) {
    Object* object = resolve(obj);
    if (object != nullptr) {
        const bool isNewField = object->fields().find(field) == object->fields().end();
        object->setField(field, target);
        if (isNewField) {
            ++diagnostics_.currentFieldNodes;
        }
    }
}

gc::ObjectHandle Heap::getField(gc::ObjectHandle obj, const std::string& field) const {
    Object* object = resolve(obj);
    if (object == nullptr) {
        return gc::ObjectHandle::invalid();
    }
    return object->getField(field);
}

void Heap::collect() {
    CollectionRecord record;
    record.gcIndex = stats_.totalCollections + 1;
    const auto start = std::chrono::steady_clock::now();
    if (observer_) {
        observer_->onCollectionBegin(record.gcIndex);
    }
    mark(record);
    if (observer_) {
        observer_->onMarkComplete(makeView());
    }
    sweep(record);
    record.totalNs = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now() - start)
            .count());
    diagnostics_.collections.push_back(record);
    stats_.totalCollections++;
    if (observer_) {
        observer_->onCollectionEnd(diagnostics_.collections.back());
    }
#ifndef NDEBUG
    verifyInvariants();
#endif
}

gc::GCStats Heap::getStats() const {
    return stats_;
}

const GcDiagnostics& Heap::diagnostics() const {
    return diagnostics_;
}

void Heap::setObserver(GcObserver* observer) {
    observer_ = observer;
}

void Heap::setCurrentStatement(std::uint32_t statementIndex) {
    currentStatement_ = statementIndex;
}

HeapView Heap::view() const {
    return makeView();
}

HeapView Heap::makeView() const {
    HeapView view;
    view.objects_.reserve(stats_.liveObjectsAfterLastRun);
    for (std::size_t i = 0; i < objects_.size(); ++i) {
        if (!slotInUse_[i] || objects_[i] == nullptr) {
            continue;
        }
        const Object& object = *objects_[i];
        HeapObjectView objectView;
        objectView.handle = gc::ObjectHandle(i);
        objectView.allocSeq = object.allocSeq;
        objectView.allocStatement = object.allocStatement;
        objectView.marked = object.marked;
        objectView.discoveredBy = object.discoveredBy;
        objectView.fields.reserve(object.fields().size());
        for (const auto& field : object.fields()) {
            objectView.fields.push_back(HeapFieldView{field.first, field.second});
        }
        std::sort(objectView.fields.begin(), objectView.fields.end(),
                  [](const HeapFieldView& left, const HeapFieldView& right) {
                      return left.name < right.name;
                  });
        view.objects_.push_back(std::move(objectView));
    }

    view.roots_.reserve(roots_.size());
    for (const auto& root : roots_) {
        if (root.second.isValid()) {
            view.roots_.push_back(HeapRootView{root.first, root.second});
        }
    }
    std::sort(view.roots_.begin(), view.roots_.end(),
              [](const HeapRootView& left, const HeapRootView& right) {
                  return left.name < right.name;
              });
    return view;
}

void Heap::verifyInvariants() const {
    const auto fail = [](const char* message) {
        throw std::logic_error(std::string("Heap invariant failed: ") + message);
    };

    for (const auto& root : roots_) {
        if (root.second.isValid() && resolve(root.second) == nullptr) {
            fail("I1 root handle does not resolve");
        }
    }

    std::uint64_t inUseCount = 0;
    for (std::size_t i = 0; i < objects_.size(); ++i) {
        if (slotInUse_[i] && objects_[i] != nullptr) {
            ++inUseCount;
        }
    }

    if (stats_.totalCollections == 0) {
        if (diagnostics_.collections.size() != 0) {
            fail("diagnostic collection count is inconsistent");
        }
        return;
    }

    if (diagnostics_.collections.size() != stats_.totalCollections) {
        fail("diagnostic collection count is inconsistent");
    }

    for (const auto& object : objects_) {
        if (object != nullptr && object->marked) {
            fail("I3 mark bit remains set after collection");
        }
    }

    std::uint64_t freedTotal = 0;
    for (const auto& record : diagnostics_.collections) {
        freedTotal += record.freed;
    }
    if (stats_.liveObjectsAfterLastRun != inUseCount ||
        stats_.totalAllocations < freedTotal ||
        stats_.totalAllocations - freedTotal != inUseCount) {
        fail("I5 allocation, freed, and live counts disagree");
    }

    std::unordered_set<std::size_t> reachable;
    std::vector<gc::ObjectHandle> worklist;
    for (const auto& root : roots_) {
        if (root.second.isValid()) {
            worklist.push_back(root.second);
        }
    }
    while (!worklist.empty()) {
        const gc::ObjectHandle handle = worklist.back();
        worklist.pop_back();
        Object* object = resolve(handle);
        if (object == nullptr || !reachable.insert(handle.raw()).second) {
            continue;
        }
        for (const auto& field : object->fields()) {
            if (field.second.isValid()) {
                worklist.push_back(field.second);
            }
        }
    }

    for (std::size_t i = 0; i < objects_.size(); ++i) {
        const bool inUse = slotInUse_[i] && objects_[i] != nullptr;
        if (inUse != (reachable.find(i) != reachable.end())) {
            fail("I2 in-use objects differ from root reachability");
        }
    }

    if (!observer_ || !observer_->wantsMarkForest()) {
        return;
    }
    for (std::size_t i = 0; i < objects_.size(); ++i) {
        if (!slotInUse_[i] || objects_[i] == nullptr) {
            continue;
        }
        const Object& object = *objects_[i];
        if (!object.discoveredBy) {
            fail("I7 live object has no mark-forest discoverer");
        }
        std::unordered_set<std::size_t> path;
        const Object* current = &object;
        std::size_t currentHandle = i;
        while (current->discoveredBy && current->discoveredBy->parent) {
            if (!path.insert(currentHandle).second) {
                fail("I7 mark-forest contains a cycle");
            }
            const MarkDiscovery& discovery = *current->discoveredBy;
            if (!discovery.field || discovery.root) {
                fail("I7 parent discovery has invalid edge metadata");
            }
            const Object* parent = resolve(*discovery.parent);
            if (parent == nullptr || parent->getField(*discovery.field) !=
                                         gc::ObjectHandle(currentHandle)) {
                fail("I7 parent discovery is not a real field edge");
            }
            currentHandle = discovery.parent->raw();
            current = parent;
        }
        if (!current->discoveredBy || !current->discoveredBy->root ||
            current->discoveredBy->parent || current->discoveredBy->field) {
            fail("I7 mark-forest path does not terminate at a root");
        }
        const auto root = roots_.find(*current->discoveredBy->root);
        if (root == roots_.end() || root->second != gc::ObjectHandle(currentHandle)) {
            fail("I7 root discovery is not a real root edge");
        }
    }
}

Object* Heap::resolve(gc::ObjectHandle handle) const {
    if (!handle.isValid() || handle.raw() >= objects_.size() || !slotInUse_[handle.raw()]) {
        return nullptr;
    }
    return objects_[handle.raw()].get();
}

// Heap::mark() is defined in mark.cpp.
// Heap::sweep() is defined in sweep.cpp.

} // namespace memory
