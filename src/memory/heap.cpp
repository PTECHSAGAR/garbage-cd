#include "memory/heap.hpp"

namespace memory {

gc::ObjectHandle Heap::allocate() {
    objects_.push_back(std::make_unique<Object>());
    slotInUse_.push_back(true);
    stats_.totalAllocations++;

    gc::ObjectHandle handle(objects_.size() - 1);
    return handle;
}

void Heap::setRoot(const std::string& name, gc::ObjectHandle handle) {
    roots_[name] = handle;
}

void Heap::clearRoot(const std::string& name) {
    roots_.erase(name);
}

void Heap::setField(gc::ObjectHandle obj, const std::string& field, gc::ObjectHandle target) {
    Object* object = resolve(obj);
    if (object != nullptr) {
        object->setField(field, target);
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
    mark();
    sweep();
    stats_.totalCollections++;
}

gc::GCStats Heap::getStats() const {
    return stats_;
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
