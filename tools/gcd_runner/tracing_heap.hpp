#pragma once

#include <cstdint>

#include "gc_interface.hpp"
#include "memory/heap.hpp"

class TracingHeap final : public gc::IHeap {
public:
    struct CallCounts {
        std::uint64_t allocations = 0;
        std::uint64_t rootSets = 0;
        std::uint64_t rootClears = 0;
        std::uint64_t fieldWrites = 0;
        std::uint64_t fieldReads = 0;
        std::uint64_t collections = 0;
    };

    explicit TracingHeap(memory::Heap& heap);

    gc::ObjectHandle allocate() override;
    void setRoot(const std::string& name, gc::ObjectHandle handle) override;
    void clearRoot(const std::string& name) override;
    void setField(gc::ObjectHandle obj, const std::string& field,
                  gc::ObjectHandle target) override;
    gc::ObjectHandle getField(gc::ObjectHandle obj, const std::string& field) const override;
    void collect() override;
    gc::GCStats getStats() const override;

    const memory::GcDiagnostics& diagnostics() const;
    const CallCounts& calls() const;

private:
    memory::Heap& heap_;
    mutable CallCounts calls_;
};
