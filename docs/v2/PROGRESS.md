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
- Step C — complete; commit `2c1d7a3`. Added `GcDiagnostics` and per-collection records, mark/sweep/total timing and exact scan counters, plus 5-object and 1M-garbage diagnostic tests. Debug CTest passed (6/6), including the 1M-slot checks. No reachability or `GCStats` semantics changed.
- Step D — complete; commit `0bbcfb7` plus a runner-test follow-up. Added the bounded `gcd_runner`, statement stepping with one persistent interpreter, source hashing, ULID run IDs, atomic result writes, structured errors/spans, toy AST JSON, custom-engine metrics, and runner acceptance tests. The tests cover the sample (including baseline counter cross-check), the B.7 chain/cycle/error/empty probes, source/stdout limits, a runtime span, AST truncation, and an inline-compiled JSON writer test for control characters, valid UTF-8, and malformed-byte escaping. Runner and Debug CTest passed.
- Step E — complete, ready to commit. Added Draft 2020-12 schemas for run results, custom-engine results, static analysis, and structured errors, plus one example of each generated from `gcd_runner`. All four examples passed `npx ajv-cli@5 validate --spec=draft2020`.
- Step D added an internal `fieldNodesFreed`/`currentFieldNodes` diagnostics counter so the D.7 estimated-byte metrics can include the documented per-field node estimate. This does not change tracing or reclamation behavior and is not exposed as an extra result field.
- Step B files: `cmake/gcd_v2.cmake`, `tests/v2/gc_correctness_tests.cpp`, `tests/v2/gc_property_tests.cpp`; staged change stat before this log update was 463 insertions across 3 files.
- Step C files: `include/memory/diagnostics.hpp`, `src/memory/diagnostics.cpp`, `include/memory/heap.hpp`, `src/memory/heap.cpp`, `src/memory/mark.cpp`, `src/memory/sweep.cpp`, `tests/v2/diagnostics_tests.cpp`; staged stat before this log update was 148 insertions and 6 deletions across 7 files.
- Commands: baseline Debug build/test passed; baseline ASan+UBSan build/test/sample passed; B.7 baseline probes passed functionally; Step A Debug and Release CTest passed; Step B Debug CTest and 10,000-seed property test passed; Step C Debug CTest passed; final Debug, Release, and ASan+UBSan builds and CTest each passed (7/7); `GCD_PROPERTY_SEEDS=10000 ./build/gc_property_tests` passed; runner sample reported 2 allocations, 1 collection, 2 freed, and 0 live; all four schema examples validated with Ajv.
- Acceptance: passed. The canary is inverted correctly in Release; all B.7 error probes return exit 2 with valid structured result JSON and expected codes; runner sample matches the V1 output counters; all schema examples validate. Frozen files are unchanged, and the root `CMakeLists.txt` contains only the approved hook.
- Open issues: the default Homebrew `node` (Node 25) aborts because its `simdjson.29` dylib is missing; the required Node 22 executable at `/opt/homebrew/opt/node@22/bin/node` works and is selected for runner tests. This is an environment issue, not a repository dependency.
