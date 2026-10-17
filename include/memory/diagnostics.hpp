#pragma once

#include <cstdint>
#include <vector>

namespace memory {

struct CollectionRecord {
    std::uint64_t gcIndex = 0;
    std::uint64_t liveBefore = 0;
    std::uint64_t marked = 0;
    std::uint64_t freed = 0;
    std::uint64_t liveAfter = 0;
    std::uint64_t fieldsScanned = 0;
    std::uint64_t refsPushed = 0;
    std::uint64_t worklistPeak = 0;
    std::uint64_t slotsScanned = 0;
    std::uint64_t markNs = 0;
    std::uint64_t sweepNs = 0;
    std::uint64_t totalNs = 0;
};

struct GcDiagnostics {
    std::vector<CollectionRecord> collections;
};

} // namespace memory
