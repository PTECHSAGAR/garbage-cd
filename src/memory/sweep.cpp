#include "memory/heap.hpp"

#include <chrono>

namespace memory {

void Heap::sweep(CollectionRecord& record) {
    const auto start = std::chrono::steady_clock::now();
    std::size_t collected = 0;
    std::size_t live = 0;

    for (std::size_t i = 0; i < objects_.size(); ++i) {
        ++record.slotsScanned;
        if (!slotInUse_[i] || objects_[i] == nullptr) {
            continue;
        }

        if (objects_[i]->marked) {
            objects_[i]->marked = false;
            ++live;
        } else {
            objects_[i].reset();
            slotInUse_[i] = false;
            ++collected;
        }
    }

    stats_.objectsCollectedLastRun = collected;
    stats_.liveObjectsAfterLastRun = live;
    record.freed = collected;
    record.liveAfter = live;
    record.sweepNs = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now() - start)
            .count());
}

} // namespace memory
