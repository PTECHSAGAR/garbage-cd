#include "check.hpp"

#include <cstdint>
#include <iostream>

#include "memory/heap.hpp"

namespace {

void testFiveObjectGraphCounters() {
    memory::Heap heap;
    const auto a = heap.allocate();
    const auto b = heap.allocate();
    const auto c = heap.allocate();
    const auto d = heap.allocate();
    const auto e = heap.allocate();
    heap.setField(a, "left", b);
    heap.setField(a, "right", c);
    heap.setField(b, "next", d);
    heap.setField(c, "next", d);
    heap.setField(d, "next", e);
    heap.setRoot("root", a);

    heap.collect();

    const auto& records = heap.diagnostics().collections;
    CHECK_EQ(records.size(), 1U);
    const auto& record = records.front();
    CHECK_EQ(record.gcIndex, 1U);
    CHECK_EQ(record.liveBefore, 5U);
    CHECK_EQ(record.marked, 5U);
    CHECK_EQ(record.freed, 0U);
    CHECK_EQ(record.liveAfter, 5U);
    CHECK_EQ(record.fieldsScanned, 5U);
    CHECK_EQ(record.refsPushed, 6U);
    CHECK_EQ(record.slotsScanned, 10U);
    CHECK(record.worklistPeak > 0);
    CHECK(record.totalNs >= record.markNs + record.sweepNs);
    CHECK_EQ(heap.getStats().totalCollections, 1U);
    CHECK_EQ(heap.getStats().liveObjectsAfterLastRun, 5U);
}

void testOneLiveObjectAfterOneMillionGarbageSlots() {
    constexpr std::uint64_t garbageCount = 1000000;
    memory::Heap heap;
    const auto live = heap.allocate();
    heap.setRoot("live", live);
    for (std::uint64_t i = 0; i < garbageCount; ++i) {
        heap.allocate();
    }

    heap.collect();

    const auto& record = heap.diagnostics().collections.front();
    CHECK_EQ(record.liveBefore, garbageCount + 1);
    CHECK_EQ(record.marked, 1U);
    CHECK_EQ(record.freed, garbageCount);
    CHECK_EQ(record.liveAfter, 1U);
    CHECK_EQ(record.fieldsScanned, 0U);
    CHECK_EQ(record.refsPushed, 1U);
    CHECK_EQ(record.slotsScanned, (garbageCount + 1) * 2);
    CHECK_EQ(heap.getStats().objectsCollectedLastRun, garbageCount);
}

void testFieldNodeAccounting() {
    memory::Heap heap;
    const auto first = heap.allocate();
    const auto second = heap.allocate();
    heap.setField(first, "next", second);
    heap.setField(first, "next", second);
    heap.setField(second, "next", first);
    heap.setRoot("first", first);
    heap.collect();
    CHECK_EQ(heap.diagnostics().currentFieldNodes, 2U);
    CHECK_EQ(heap.diagnostics().collections.back().fieldNodesFreed, 0U);

    heap.clearRoot("first");
    heap.collect();
    CHECK_EQ(heap.diagnostics().currentFieldNodes, 0U);
    CHECK_EQ(heap.diagnostics().collections.back().fieldNodesFreed, 2U);
}

} // namespace

int main() {
    testFiveObjectGraphCounters();
    testOneLiveObjectAfterOneMillionGarbageSlots();
    testFieldNodeAccounting();
    std::cout << "diagnostics_tests: all checks passed\n";
}
