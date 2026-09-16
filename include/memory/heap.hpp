#pragma once

// memory::Heap -- concrete managed heap, implements gc::IHeap.
// Owned by Akshat. This is the only memory-subsystem type the rest of
// the project constructs directly; everyone else talks to it through
// the gc::IHeap interface.

#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "gc_interface.hpp"
#include "memory/object.hpp"

namespace memory {

class Heap : public gc::IHeap {
public:
    Heap() = default;

    gc::ObjectHandle allocate() override;

    void setRoot(const std::string& name, gc::ObjectHandle handle) override;
    void clearRoot(const std::string& name) override;

    void setField(gc::ObjectHandle obj, const std::string& field, gc::ObjectHandle target) override;
    gc::ObjectHandle getField(gc::ObjectHandle obj, const std::string& field) const override;

    void collect() override;

    gc::GCStats getStats() const override;

private:
    // Mark-sweep phases. Implemented in mark.cpp / sweep.cpp respectively.
    // Not implemented yet -- currently no-ops.
    void mark();
    void sweep();

    Object* resolve(gc::ObjectHandle handle) const;

    std::vector<std::unique_ptr<Object>> objects_;   // slot index == ObjectHandle::raw()
    std::vector<bool> slotInUse_;                     // true if the slot holds a live allocation
    std::unordered_map<std::string, gc::ObjectHandle> roots_;
    gc::GCStats stats_;
};

} // namespace memory
