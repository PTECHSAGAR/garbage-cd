#include "memory/heap.hpp"

// Sweep phase of the mark-sweep collector. Owned by Akshat.
// Not implemented yet -- currently a no-op.

namespace memory {

void Heap::sweep() {
    // TODO(Akshat): reclaim every unmarked object, clear marked bits on
    // survivors, and update stats_ (objectsCollectedLastRun,
    // liveObjectsAfterLastRun).
}

} // namespace memory
