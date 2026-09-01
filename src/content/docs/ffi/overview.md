---
title: "The C ABI: overview"
description: The corvid C ABI at a glance — the locked rulings (typed calls, no serialization, OOP bindings), artifact shape, version, and how the 124 symbols are organized.
sidebar:
  order: 0
---

The C ABI (`corvid-ffi`) is corvid's cross-language contract: the `corvid`
cdylib (`libcorvid.so` / `libcorvid.dylib` / `corvid.dll`) plus the
generated `corvid.h` — **124 symbols** covering the engine surface, at
`FFI_VERSION = 1` (locked; 122 before the additive 0.3.0 expansion). Every
binding repo codes against it.

```text
corvid_ffi_version → 1

10 opaque handle types, ~15 POD structs/enums
124 functions in 13 families:
  lifecycle & errors · collections · value construction · value reads
  predicates · query builder, rows & direct phrase search · aggregations
  mutations · reads · indexes & schema · graph · geo & iterators · admin
```

## The locked rulings

1. **No SQL, no JSON, no serialization anywhere in the runtime path.** The
   ABI is typed C function calls end to end. (The MCP sidecar keeps JSON
   only because JSON-RPC is the MCP spec; the FFI never touches it.)
2. **Typed calls end to end.** Documents are built and read through
   `corvid_value` handles; there is no parse step, no string-formatted
   query, and no byte-blob document interface on the hot path.
3. **Bindings expose idiomatic OOP; FFI symbols never leak into a binding's
   public API.** Handles become native classes, iterators become the
   language's native iteration protocol, `CORVID_ERR` becomes native
   exceptions, handle destructors map to the language's dispose pattern. v1
   bindings are synchronous (the engine is sync).

## Calling conventions

- All functions use the C ABI (`extern "C"`), the platform's default
  cdecl/System V convention, and are **synchronous**. All symbols are
  prefixed `corvid_`.
- `corvid_status` (`CORVID_OK`/`CORVID_ERR`) is the standard return; NULL
  where a handle/buffer was expected; out-params for optional values. See
  [errors](/ffi/errors/).
- Strings and keys cross as **pointer + length**, binary-safe, NOT
  NUL-terminated; empty is non-NULL pointer + length 0. Engine string
  parameters (collection names, field paths, relations, disk paths) must be
  **valid UTF-8** or the call fails with `CORVID_E_ARGUMENT` — never UB.
  Keys and `Bytes` payloads may be arbitrary bytes.
- `size_t` for lengths/counts; `int` for booleans (0/1); `int64_t` for
  engine `i64`; `double` for `f64`; `float` for `f32`.

## Where functions live on this site

| Family (count) | Page |
|---|---|
| Lifecycle & errors (8), collections (3) | [Lifecycle & collections](/ffi/functions-lifecycle/) |
| Value construction (11), value reads (13) | [Lifecycle & collections](/ffi/functions-lifecycle/) |
| Predicates (11), query builder, rows & phrase search (16) | [Predicates & queries](/ffi/functions-query/) |
| Aggregations (11), mutations (13) | [Aggregations & mutations](/ffi/functions-data/) |
| Reads (4), indexes & schema (15) | [Reads & indexes](/ffi/functions-reads/) |
| Graph (7), geo & iterators (7) | [Graph & geo](/ffi/functions-graph-geo/) |
| Admin (5) | [Admin](/ffi/functions-admin/) |

Cross-cutting: [types & enums](/ffi/types/), [handles](/ffi/handles/),
[errors & NULL discipline](/ffi/errors/),
[ownership & transfer rules](/ffi/ownership/),
[threading](/ffi/threading/), [stability & exclusions](/ffi/stability/).

## Enforcement (why you can trust the header)

- The generated `corvid.h` is **committed and drift-gated**: a test
  regenerates it from the crate and diffs — spec, header, and radar can
  never disagree silently.
- A spec-referential radar asserts the header exposes exactly the 124
  pinned symbols, and a C smoke suite **drives every one** (124/124),
  compiled as a cargo test per OS/compiler (gcc, clang, MSVC via
  `corvid.dll.lib`).
- Golden fixtures (267 lines across 8 files: NaN/±inf/−0.0, cursors,
  map-key enumeration, phrase search, unique violations, geo boundaries,
  persistence-across-reopen) pin observable behavior.
- CI runs a 3-OS release-profile job and an ASan+UBSan+LSan Linux job —
  **zero leaks is the contract** (every handle family's free path executes
  inside the fixtures).

Release archives attach the cdylib (Windows: plus `corvid.dll.lib`),
`corvid.h`, and the golden fixtures, sha256-verified in `checksums.txt`.
Note for C authors: the header's value-type typedef/enum tag spells
`corvid_value_type_t` (the bare name is the function — see
[types](/ffi/types/)); on Windows link the import library and place
`corvid.dll` on the loader path.

Next: [types and enums](/ffi/types/).
