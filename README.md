# garbage-cd

Design and Implementation of a Mark-Sweep Garbage Collector Integrated
with an Interpreted Language Runtime (Compiler Design, Review 2).

A small interpreted language runtime with its own Mark-Sweep garbage
collector. No existing GC or external libraries are used.

The toy language supports only:

```
a = new Object();
b = new Object();
a.ref = b;
a = null;
b = null;
gc();
```

- Integer values
- `null`
- Object allocation (`new Object()`)
- Variable assignment
- Object field references (`a.ref = b`)
- `gc()`

No functions, classes, modules, or type system.

## Status

Project skeleton only. Interfaces and class declarations are in place;
the tokenizer, parser, interpreter execution, and mark/sweep algorithm
are not implemented yet (see `TODO` comments in `src/`).

## Building

Requires CMake 3.15+ and a C++17 compiler.

```sh
cmake -S . -B build
cmake --build build
```

This produces:
- `garbage_cd` -- the main executable
- `interpreter_tests` -- smoke tests for the interpreter/runtime
- `gc_tests` -- smoke tests for the memory subsystem

Run tests with:

```sh
ctest --test-dir build
```

## Module Ownership

**Prateek** -- interpreter, lexer/parser, runtime environment, integration
- `include/interpreter/`, `src/interpreter/`
- `include/runtime/`, `src/runtime/`
- `src/main.cpp`
- `tests/interpreter_tests.cpp`

**Akshat** -- managed heap, object representation, mark phase, sweep
phase, memory reclamation, GC statistics
- `include/memory/`, `src/memory/`
- `tests/gc_tests.cpp`

**Shared** (the contract between the two sides, changed only by agreement)
- `include/gc_interface.hpp`

## Architecture

The interpreter never includes `memory/heap.hpp` or `memory/object.hpp`.
It only depends on `gc::IHeap` and `gc::ObjectHandle` from
`include/gc_interface.hpp`. `ObjectHandle` is an opaque id -- the
interpreter can store, copy, and compare handles, but cannot inspect or
dereference what they point to. `memory::Heap` implements `gc::IHeap`,
so the mark-sweep internals can be changed freely without touching any
interpreter code.
