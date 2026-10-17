# V2 implementation progress

## T1 — baseline, correctness suite, diagnostics, minimal runner

### Verification (no source edits)

- HEAD is `7f46d69f5fd269eeb65dc2686dcd4a0bc970604c`, matching Document B.1.
- The tracked file count is 25, not the 24 stated in Document B.1; the tracked paths are the V1 paths listed by `git ls-files`. The supplied `PLAN.md` is untracked.
- The plan was supplied at repository-root `PLAN.md`; `docs/v2/PLAN.md` does not exist. Per user direction, root `PLAN.md` is treated as canonical. This path discrepancy is recorded rather than moving or copying the plan.
- The baseline Debug build with `-Wall -Wextra -Wpedantic` passed, and both existing CTest tests passed.
- The ASan+UBSan Debug build, both CTest tests, and the sample program passed.
- Document B.7 functional probes matched: sample (2 allocations, 1 collection, 2 freed, 0 live); self-cycle/chain probe (1 freed, 2 live); unreachable two-object cycle (2 freed); runtime, parser, lexer, and integer-overflow errors each abort with exit 134; empty input exits 0; default path from `build/` exits 1.
- Collection timings on this macOS/AppleClang host were 19.03 ms, 28.64 ms, and 47.54 ms after 1M, 3M, and 6M allocations. These differ from the Linux/GCC audit measurements (3.1 ms, 9.8 ms, 20.1 ms); they are environment-specific and still increase with total slot count.
- Local tag `v1-baseline` points to `7f46d69f5fd269eeb65dc2686dcd4a0bc970604c`. Work is on local branch `v2`.
- Toolchain: CMake 4.4.4 and Node 22.23.3 installed with Homebrew; Temurin JDK 21.0.12.1 installed under `~/.jdk/temurin-21`.

### Plan deviations

- Repository plan location and tracked-file count differ from the text in J.0/Document B.1 as described above. The user approved treating root `PLAN.md` as canonical and continuing.
- Baseline timings are not numerically comparable to the audit host; no behavior difference was observed.

### T1 status

- Step A — complete; commit `69773b1`. Added the V2 CMake hook, conditional V2 test/runner target registration, always-on CHECK macros, and the expected-failure canary. The canary's `abort()` was translated by its CTest wrapper to a conventional nonzero exit because CTest does not invert a signal termination with `WILL_FAIL`. Debug and Release CTest passed; Release `gc_tests` flags place `-UNDEBUG` after `-DNDEBUG`.
- Step B — complete; commit `87b52ac`. Added G.1 rows 1–11 and the independent BFS property oracle. Debug CTest passed (5/5), and `GCD_PROPERTY_SEEDS=10000 ./build/gc_property_tests` passed. The collector sources were not modified.
- Step C — complete, ready to commit. Added `GcDiagnostics` and per-collection records, mark/sweep/total timing and exact scan counters, plus 5-object and 1M-garbage diagnostic tests. Debug CTest passed (6/6), including the 1M-slot checks. No reachability or `GCStats` semantics changed.
- Step D–E: not started.
- Step B files: `cmake/gcd_v2.cmake`, `tests/v2/gc_correctness_tests.cpp`, `tests/v2/gc_property_tests.cpp`; staged change stat before this log update was 463 insertions across 3 files.
- Step C files: `include/memory/diagnostics.hpp`, `src/memory/diagnostics.cpp`, `include/memory/heap.hpp`, `src/memory/heap.cpp`, `src/memory/mark.cpp`, `src/memory/sweep.cpp`, `tests/v2/diagnostics_tests.cpp`; staged stat before this log update was 148 insertions and 6 deletions across 7 files.
- Commands: baseline Debug build/test passed; baseline ASan+UBSan build/test/sample passed; B.7 probes passed functionally; Step A Debug and Release CTest passed; Step B Debug CTest and 10,000-seed property test passed; Step C Debug CTest passed.
- Acceptance: pending runner, schemas, and final Debug/Release/ASan and runner gates.
- Open issues: none beyond the noted baseline discrepancies.
