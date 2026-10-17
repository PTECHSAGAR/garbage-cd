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
- Step E — complete; commit `0cc1f2d`. Added Draft 2020-12 schemas for run results, custom-engine results, static analysis, and structured errors, plus one example of each generated from `gcd_runner`. All four examples passed `npx ajv-cli@5 validate --spec=draft2020`.
- Step D added an internal `fieldNodesFreed`/`currentFieldNodes` diagnostics counter so the D.7 estimated-byte metrics can include the documented per-field node estimate. This does not change tracing or reclamation behavior and is not exposed as an extra result field.
- Step B files: `cmake/gcd_v2.cmake`, `tests/v2/gc_correctness_tests.cpp`, `tests/v2/gc_property_tests.cpp`; staged change stat before this log update was 463 insertions across 3 files.
- Step C files: `include/memory/diagnostics.hpp`, `src/memory/diagnostics.cpp`, `include/memory/heap.hpp`, `src/memory/heap.cpp`, `src/memory/mark.cpp`, `src/memory/sweep.cpp`, `tests/v2/diagnostics_tests.cpp`; staged stat before this log update was 148 insertions and 6 deletions across 7 files.
- Commands: baseline Debug build/test passed; baseline ASan+UBSan build/test/sample passed; B.7 baseline probes passed functionally; Step A Debug and Release CTest passed; Step B Debug CTest and 10,000-seed property test passed; Step C Debug CTest passed; final Debug, Release, and ASan+UBSan builds and CTest each passed (7/7); `GCD_PROPERTY_SEEDS=10000 ./build/gc_property_tests` passed; runner sample reported 2 allocations, 1 collection, 2 freed, and 0 live; all four schema examples validated with Ajv.
- Acceptance: passed. The canary is inverted correctly in Release; all B.7 error probes return exit 2 with valid structured result JSON and expected codes; runner sample matches the V1 output counters; all schema examples validate. Frozen files are unchanged, and the root `CMakeLists.txt` contains only the approved hook.
- Open issues: the default Homebrew `node` (Node 25) aborts because its `simdjson.29` dylib is missing; the required Node 22 executable at `/opt/homebrew/opt/node@22/bin/node` works and is selected for runner tests. This is an environment issue, not a repository dependency.

### T1 completion report

- Verification vs Document B: baseline commit and V1 behavior matched; the only repository differences were the approved root `PLAN.md` location and 25-vs-24 tracked files. Baseline timing values varied by host but retained linear growth.
- Committed diff against `v1-baseline`: 32 files changed, 3,391 insertions, 6 deletions. Files: `CMakeLists.txt`; `cmake/gcd_v2.cmake`; `contracts/examples/{custom-engine-result,run-result,static-analysis,structured-error}.json`; `contracts/schemas/{custom-engine-result,run-result,static-analysis,structured-error}.schema.json`; `docs/v2/PROGRESS.md`; `include/memory/{diagnostics,heap}.hpp`; `src/memory/{diagnostics,heap,mark,sweep}.cpp`; `tests/v2/{canary_test.cpp,check.hpp,diagnostics_tests.cpp,gc_correctness_tests.cpp,gc_property_tests.cpp,runner_tests.sh}`; `tools/gcd_runner/{errors.hpp,json_writer.hpp,main.cpp,spans.cpp,spans.hpp,toy_ast_json.cpp,toy_ast_json.hpp,tracing_heap.cpp,tracing_heap.hpp}`.
- Commands: Debug/Release/ASan+UBSan configure, build, and CTest passed (7/7 each); 10,000 property seeds passed; runner sample counters were 2/1/2/0; all four Ajv validations passed.
- Deviations: added internal field-node diagnostics solely to implement the D.7 estimated-byte formula. It is not added to the JSON contract and does not affect collector decisions. Canary abort handling uses a wrapper because CTest `WILL_FAIL` does not invert signal exits.
- Open issues: only the Node 25 Homebrew dylib issue noted above; no code or acceptance blockers.
- Proposed T2 risks: preserve the observer-off baseline mark path with compile-time specialization; validate each mark-forest edge against a real root/field edge; verify observer/region instrumentation does not alter freed-object sets; test event sequence/batch overflow boundaries.

## T2 brief — observer, snapshots, events, invariants

### Source sections

I.3 items 3–7; D.8–D.9; E.4; E.7; G.1 rows 14, 16, and 17. This brief follows those sections without changing their design.

### May create or modify

- M-owned `include/memory/**` and `src/memory/**`, including `observer.hpp`, read-only `HeapView`, object allocation/statement metadata, mark-forest metadata, observer hooks, and `Heap::verifyInvariants()`.
- `cmake/gcd_v2.cmake`, `tools/gcd_runner/**`, `tests/v2/**`, `contracts/schemas/**`, `contracts/examples/**`, and this progress log.

### Must not modify

- `include/gc_interface.hpp`; anything under `include/interpreter/`, `src/interpreter/`, `include/runtime/`, or `src/runtime/`; `src/main.cpp`; `tests/gc_tests.cpp`; `tests/interpreter_tests.cpp`; root `CMakeLists.txt`; or any V1 behavior.

### Ordered steps

1. Add observer interface and read-only heap view; add `allocSeq`, `allocStatement`, and `discoveredBy` storage; add the memory-owned current-statement setter and call it from the runner before each statement.
2. Template marking on whether parent recording is enabled; keep the no-observer mark path free of parent-recording work; implement collection begin/visit/mark-complete/sweep-free/end callbacks.
3. Implement I1–I5 and I7 invariant verification and call it in tests and Debug builds after collection.
4. Implement bounded breadth-first heap snapshots, including roots and at most 2,000 objects, and serialize the D.8 contract.
5. Implement D.9 event records, `EventBuffer`, `FileSink`, and `MemorySink`; support trace levels, batch sizes 1–8,192, flush boundaries, output caps, structural-event retention, drop accounting, and the end trailer.
6. Add the heap-snapshot and trace-batch Draft 2020-12 schemas and runner-generated examples; extend tests for the spanning forest, event boundaries/overflow, and event replay against a model heap.
7. Run freed-set differential and seeded property checks; run Debug, Release, and ASan/UBSan gates; update the log and commit locally.

### Commands

- `cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build -j && ctest --test-dir build --output-on-failure`
- `cmake -S . -B build-rel -DCMAKE_BUILD_TYPE=Release && cmake --build build-rel -j && ctest --test-dir build-rel --output-on-failure`
- `cmake -S . -B build-asan -DCMAKE_BUILD_TYPE=Debug -DGCD_SANITIZE=ON && cmake --build build-asan -j && ctest --test-dir build-asan --output-on-failure`
- `GCD_PROPERTY_SEEDS=10000 ./build/gc_property_tests`
- Validate generated snapshot and trace examples against their schemas with Node 22 and Ajv.

### Acceptance

- Observer callbacks and snapshots are correct; the spanning forest is rooted in actual heap edges; `verifyInvariants()` checks I1–I5 and I7.
- Snapshot truncation preserves roots and a breadth-first slice and is set above 2,000 objects.
- Event sequences are contiguous across batches; batch boundaries work for B = 1, 3, and 1,024; overflow retains structural events and accounts for drops; normal and caught-error paths flush a trailer.
- Replaying mutator events reproduces each collection's freed set; enabling observation does not change freed-object sets.
- All C++ Debug, Release, and ASan/UBSan gates pass; no frozen file or shared interface changes.

### Stop conditions

- Stop if a change would touch a must-not-modify file, alter reclamation behavior, require changing a frozen L.1 decision, or if a collector test fails on unchanged collector behavior.
- Stop after three consecutive failures of the same gate; do not weaken or skip tests.

## T2 completion — observer, snapshots, events, invariants

- Steps 1–3: added `GcObserver`, immutable heap views, allocation/statement/discovery metadata, observer-selectable parent recording, mark/sweep callbacks, and `Heap::verifyInvariants()` for I1–I5 and I7. Diagnostics tests validate real spanning-forest edges and prove observed/unobserved collection frees the same handles.
- Step 4: added D.8 snapshot serialization and atomic file publication. Snapshots retain all roots, prioritize a breadth-first slice, cap objects at 2,000, record mark-complete discovery metadata, and write program-end snapshots with `marked: null`.
- Steps 5–6: added D.9 NDJSON batching, interned names, `FileSink`/`MemorySink`, trace-level and batch-size CLI options, 1,000,000-event/64-MiB bounds, structural-event retention, drop accounting, and trailers. Added the snapshot/trace schemas and examples generated by `gcd_runner`.
- Step 7 acceptance: Debug, Release, and ASan/UBSan builds and full CTest each passed (9/9); `GCD_PROPERTY_SEEDS=10000 ./build/gc_property_tests` passed; both new examples validated with Node 22/Ajv. Runner acceptance replays full mutator traces against a model heap and matches each GC's freed set; batch sizes 1, 3, and 1,024, overflow, trace levels, caught-error trailers, snapshot truncation, and discovery paths are covered.
- The first ASan run exposed a stack-use-after-scope in the new test helper (iteration over a view returned from a temporary). The helper now owns the `HeapView`; the targeted sanitizer test and complete sanitizer gate then passed.
- Plan deviation: `Heap::setRoot` normalizes invalid or stale handles to `invalid()` so I1 can be verified. Existing marking already ignored unresolvable roots; the observed-vs-unobserved freed-handle test and 10,000-seed oracle show no change to reclaimed sets.
- Frozen V1 interpreter/runtime sources, `gc_interface.hpp`, `src/main.cpp`, and `tests/gc_tests.cpp` remain unchanged. No outstanding T2 blockers.
- T2 files: `cmake/gcd_v2.cmake`; `contracts/{schemas,examples}/{heap-snapshot,trace-batch}*`; `include/memory/{observer,heap,object}.hpp`; `src/memory/{heap,mark,sweep}.cpp`; `tests/v2/{diagnostics_tests,event_buffer_tests,snapshot_tests,runner_tests.sh}`; `tools/gcd_runner/{event_buffer,snapshot_writer}.{hpp,cpp}` and `main.cpp`, `tracing_heap.{hpp,cpp}`; this log.
- Commit series: `841be50` observer/invariants; `1949ce1` snapshots; `34e29df` trace buffering and runner wiring; `f7b0993` contracts/replay gates. The final completion-log commit follows.

## T3 brief — controller and JVM execution backend

### Source sections

I.4; C.3; D.3–D.6; D.10; H.1–H.6; G.3. This brief keeps the specified two-engine process model, wire contracts, and security boundaries unchanged.

### May create or modify

- `java/**`: JDK-only Java 21 analyzer and launcher; `java/build.sh`.
- `web/package.json`, `web/shared/**`, `web/server/**`: Node 22 workspaces, shared types/contracts, Fastify controller, adapters, subprocess supervision, schemas, and tests.
- `contracts/schemas/**`: add/extend the request and JVM-result contracts; do not change existing V1/C++ result semantics.
- `contracts/examples/**`, test fixtures, and this progress log as required by the T3 acceptance suite.

### Must not modify

- Existing C++ implementation and tests, including all T1/T2 files.
- V1 interpreter/runtime, `include/gc_interface.hpp`, root `src/main.cpp`, and `tests/gc_tests.cpp`.
- The architecture, API meanings, error mapping, process model, security policy, or metrics provenance fixed in Documents C, D, and H.
- No Docker, database, queue, authentication, WebSockets, cloud service, or Java agent.

### Ordered steps

1. Build the Java 21 analyzer using only JDK APIs: parse source, locate public type and `main`, compile with `-proc:none -Xlint:all` into the isolated classes directory, and emit analysis/compile diagnostics and timing.
2. Add the Java launcher and shutdown hook: invoke the selected main class, catch `Throwable`, report exception class/message/top 20 frames, and write the specified MXBean totals even when user code exits or throws.
3. Add `java/build.sh` using `javac` and `jar`; build the analyzer/launcher tools artifact without third-party Java dependencies.
4. Create the Node 22/npm workspaces and shared request/result types and schemas; configure strict TypeScript, Fastify, Ajv Draft 2020-12, Vitest, and the specified engine defaults/limits.
5. Implement the controller: loopback-only server, Host/Origin/content-type checks, single-run semaphore, in-memory LRU and per-run directory, startup/exit cleanup, argument-array process spawning, process-group timeout/cancellation, environment scrubbing, platform-aware `prlimit`, and bounded stdout/stderr.
6. Implement JVM and custom-runner adapters, GC-log parsing for JDK 21 Serial/G1, metrics/provenance/result assembly, schema validation, and D.10 health/samples/analyze/runs/cancel routes. Trace, snapshot, and region routes remain explicit 404 stubs in this phase.
7. Add five Java and four toy samples plus G.3 unit/integration tests and JDK 21 Serial/G1 golden logs; exercise all expected outcomes and confirm no run process is left behind.
8. Run the complete Java, Node, schema, and curl-level gates; record platform limitations and commit each completed T3 step and the task locally.

### Commands

- `./java/build.sh`
- `npm --prefix web install`
- `npm --prefix web test`
- `npm --prefix web run build`
- `npm --prefix web run lint`
- Start the controller on loopback and run the G.3 HTTP acceptance suite; validate every emitted payload with Ajv Draft 2020-12.
- Verify JDK 21 and Node 22 versions before the suite; check for orphaned analyzer/launcher/runner processes afterward.

### Acceptance

- A valid Java churn program returns captured stdout, parsed GC-log events, MXBean totals, and provenance-marked metrics; a toy program still uses the existing runner.
- Syntax/type/no-main/package/exception/OOM/timeout/output-flood/System.exit/thread/cancel/JDK-unavailable cases meet G.3 expected status/error/cleanup behavior.
- Serial and G1 JDK 21 GC logs match committed golden parser fixtures.
- Hostile cross-origin and non-JSON POSTs are rejected; the server binds only to `127.0.0.1`; no shell command interpolation or user-controlled run-directory names.
- Request, analysis, engine, and final result payloads validate against their versioned schemas; timeouts, output caps, environment scrubbing, and unsupported-platform `prlimit` reporting are explicit.
- No C++ or frozen file changes; Node 22 strict typecheck/build, lint, Vitest, Java build, and all G.3 rows pass.

### Stop conditions

- Stop if a requirement would require changing a frozen C++/shared-interface file or any fixed architecture/API/security decision.
- Stop if Java 21 or Node 22 cannot be used, a test demonstrates an existing C++ regression, or any gate fails three consecutive fix attempts.
- Do not claim Linux process-limit coverage on this macOS host; verify and record the plan-defined `unsupported-platform` result instead.

## T3 completion — controller and JVM execution backend

- Steps 1–3: Java 21 analyzer (`java/analyzer`), launcher with shutdown-hook MXBean metrics (`java/launcher`), JSON helper, and `java/build.sh` (`javac -Xlint:all -Werror` + `jar`, JDK-only).
- Steps 4–6: Node 22 workspaces (`web/shared`, `web/server`), strict TypeScript, Fastify loopback controller, Java and custom adapters, JDK 21 Serial/G1 GC-log parser, D.10 routes (`health`, `samples`, `analyze`, `runs`, `runs/:id`, `cancel`); trace, snapshot and region routes are explicit 404 stubs. Added `run-request` and `jvm-engine-result` schemas and extended `run-result` / `structured-error` (jvm engine, compile phase, `RESOURCE_LIMIT`, `PROGRAM_EXIT`).
- Step 7: 5 Java and 4 toy samples; Vitest suite `web/server/test` (23 tests) covering the G.3 rows and golden Serial/G1 logs captured from JDK 21.0.12.1 (`web/server/test/fixtures`).
- Defects found and fixed by the suite: (1) analyzer was launched with `-jar` though the jar has no manifest main class (now `-cp`); (2) `run-request.schema.json` failed Ajv strict mode (`type: object` missing in the engine-specific `allOf` branches), which prevented the controller from starting; (3) GC-log regex did not match padded tags (`[gc          ]`) so no pause was parsed; (4) HotSpot prints the `-XX:+ExitOnOutOfMemoryError` message to stdout, so OOM detection also checks stdout; (5) lint `prefer-const` in `process.ts`.
- Gates (JDK 21.0.12.1, Node 22.23.3, macOS): `./java/build.sh`, `npm run build`, `npm run lint`, `npm test` (23/23) pass; no orphan `gcd-java`/`gcd_runner` processes afterwards. No C++ or frozen files changed.
- Platform limitation: `prlimit` is Linux-only; this macOS host reports `unsupported-platform` in `limits.prlimit`. Linux process-limit coverage is not claimed. The OOM case relies on `-Xmx` plus `ExitOnOutOfMemoryError`, not prlimit.
- Not verified here: a curl-level run against a started server (tests use Fastify `inject` with loopback host headers), and the "JDK missing" case is covered via a nonexistent `javaPath`, not by removing `java` from `PATH`.
- Known gap: `toolVersions.jdk` reads `GCD_JDK_VERSION` from the environment and is `unknown` unless set, even though health probes the real version.

## Phase 3 — Java source analysis

- `java/analyzer/AstBuilder.java` converts javac trees (`TreeScanner`, `SourcePositions`, `LineMap`) to the D.5 `AstNode` JSON: kind = `Tree.Kind`, per-kind labels (identifiers, member names, literals, primitive types, modifiers) truncated to 80 chars, compiler spans (UTF-16 offsets; columns use javac's `LineMap`, which expands tabs), `NOPOS` nodes kept with `synthetic: true` and no span. Selection is breadth-first capped at 5,000 nodes; ids are pre-order over the kept nodes; truncation adds an `AST_TRUNCATED` note diagnostic. The analyzer runs on a 256 MiB-stack thread to survive deeply nested expressions.
- Two paths: the full run path rebuilds the AST after `analyze()` so the implicit default constructor appears (flagged synthetic); `POST /api/analyze` uses a new `--parse-only` analyzer flag (parse-time syntax diagnostics, no compile, no implicit constructor).
- Contract/type changes: `synthetic` added to the `astNode` schema and shared `AstNode` type.
- Tests (`web/server/test/analyze.test.ts`, 16): golden AST JSON for the 5 samples (`test/golden/`, regenerate with `UPDATE_GOLDEN=1`), span round-trip/containment, contiguous ids, synthetic constructor, 6,000-element initializer truncating to exactly 5,000 nodes, syntax-error location, and a ~300-line program analyzed in <2 s on this host. `vitest.config.ts` now runs test files sequentially because the orphan-process check is machine-wide.
- Gates: `./java/build.sh`, `npm run build`, `npm run lint`, `npm test` (39/39) pass with JDK 21 and Node 22; no orphan processes.
- Deviations/limits: `routes/analyze.ts` was not split out (the route stays in `server.ts`). A `StackOverflowError` while building the AST yields `ast: null` rather than failing the run; that path is untested. The 2 s check is a timing assertion on one host and may be flaky under load.
