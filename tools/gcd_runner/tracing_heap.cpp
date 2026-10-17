#include "tracing_heap.hpp"

TracingHeap::TracingHeap(memory::Heap& heap) : heap_(heap) {}

gc::ObjectHandle TracingHeap::allocate() {
    ++calls_.allocations;
    return heap_.allocate();
}

void TracingHeap::setRoot(const std::string& name, gc::ObjectHandle handle) {
    ++calls_.rootSets;
    heap_.setRoot(name, handle);
}

void TracingHeap::clearRoot(const std::string& name) {
    ++calls_.rootClears;
    heap_.clearRoot(name);
}

void TracingHeap::setField(gc::ObjectHandle obj, const std::string& field,
                           gc::ObjectHandle target) {
    ++calls_.fieldWrites;
    heap_.setField(obj, field, target);
}

gc::ObjectHandle TracingHeap::getField(gc::ObjectHandle obj, const std::string& field) const {
    ++calls_.fieldReads;
    return heap_.getField(obj, field);
}

void TracingHeap::collect() {
    ++calls_.collections;
    heap_.collect();
}

gc::GCStats TracingHeap::getStats() const {
    return heap_.getStats();
}

const memory::GcDiagnostics& TracingHeap::diagnostics() const {
    return heap_.diagnostics();
}

const TracingHeap::CallCounts& TracingHeap::calls() const {
    return calls_;
}
