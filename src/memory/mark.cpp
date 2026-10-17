#include "memory/heap.hpp"

#include <algorithm>
#include <chrono>
#include <vector>

// Mark phase of the mark-sweep collector.
// Starts from GC roots and traverses the object graph.

namespace memory {

void Heap::mark(CollectionRecord& record) {
    const auto start = std::chrono::steady_clock::now();
    // Start every collection with all objects unmarked.
    for (std::size_t i = 0; i < objects_.size(); ++i) {
        ++record.slotsScanned;
        if (slotInUse_[i] && objects_[i] != nullptr) {
            ++record.liveBefore;
            objects_[i]->marked = false;
        }
    }

    // Worklist for graph traversal.
    std::vector<gc::ObjectHandle> worklist;

    // Start traversal from all GC roots.
    for (const auto& root : roots_) {
        if (root.second.isValid()) {
            worklist.push_back(root.second);
            ++record.refsPushed;
        }
    }
    record.worklistPeak = worklist.size();

    // Traverse all reachable objects.
    while (!worklist.empty()) {
        gc::ObjectHandle handle = worklist.back();
        worklist.pop_back();

        Object* object = resolve(handle);

        // Invalid/stale handle or already visited object.
        if (object == nullptr || object->marked) {
            continue;
        }

        // Mark this object as reachable.
        object->marked = true;
        ++record.marked;

        // Follow every object reference stored in its fields.
        for (const auto& field : object->fields()) {
            ++record.fieldsScanned;
            gc::ObjectHandle target = field.second;

            if (target.isValid()) {
                worklist.push_back(target);
                ++record.refsPushed;
                record.worklistPeak =
                    std::max<std::uint64_t>(record.worklistPeak, worklist.size());
            }
        }
    }
    record.markNs = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now() - start)
            .count());
}

} // namespace memory
