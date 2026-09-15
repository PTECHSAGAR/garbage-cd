#include "memory/heap.hpp"

namespace memory {

void Heap::sweep() {
    std::size_t collected = 0;
    std::size_t live = 0;

    for (std::size_t i = 0; i < objects_.size(); ++i) {
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
}

} // namespace memory
