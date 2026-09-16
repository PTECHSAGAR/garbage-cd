#include "memory/heap.hpp"

// Mark phase of the mark-sweep collector. Owned by Akshat.
// Not implemented yet -- currently a no-op.

namespace memory {

void Heap::mark() {
    // TODO(Akshat): traverse roots_ and mark every object reachable
    // from them (object->marked = true).
}

} // namespace memory
