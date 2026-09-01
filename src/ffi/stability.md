---
title: Stability & v1 exclusions
description: The C ABI's naming conventions, frozen enums, pre-1.0 break policy, post-1.0 soname discipline, and the deliberate v1 exclusions with their reopen triggers.
sidebar:
  order: 12
---

## Naming conventions

- Every symbol is prefixed `corvid_`.
- Constructors return handles and end in a noun or `_new`
  (`corvid_value_int`, `corvid_query_new`, the `corvid_pred_*` family).
- Destructors end in `_free` — exactly one per handle type, never
  cross-family. `corvid_free` (no suffix) is reserved for plain buffers.
- Cursor advance ends in `_next` and returns `int` (1 row, 0 exhausted).
- Zero-copy borrows end in `_ref`.
- Fluent query setters are `corvid_query_<knob>` — the Rust chain
  `.filter(...).vector(...)` becomes a sequence of calls.
- A function that **consumes** a handle or value says so in this spec and
  consumes it unconditionally, even on failure.

## Stability policy

- `corvid_ffi_version()` returns `FFI_VERSION = 1`.
- **Enum values are frozen.** `corvid_status`, `corvid_err` (1–19),
  `corvid_cmp`, `corvid_metric`, `corvid_quant`, `corvid_value_type_t`,
  `corvid_field_type` are never renumbered or reordered; new values may only
  be appended (a new engine `Error` variant appends code 20+, never fills a
  gap — and the variant-inventory snapshot test fails until it is mapped).
- **Pre-1.0 break policy:** breaking ABI changes are allowed but must be
  loud — bump `FFI_VERSION`, change the artifact names, record the break in
  the CHANGELOG and the design decision log. Bindings pin exact engine
  tags, so a break is a coordinated bump PR per binding repo, never a
  surprise.
- **Post-1.0 soname discipline:** the cdylib is `libcorvid.so.1` /
  `libcorvid.1.dylib` / `corvid.dll` with import-lib versioning; additive
  changes keep soname `.1` and `FFI_VERSION = 1`; any breaking change bumps
  `FFI_VERSION` to 2 and the soname to `.2`, shipped alongside a migration
  note. Struct layouts in `corvid.h` are append-only (new fields at the
  end, with size checks in the header).
- The generated `corvid.h` is committed and drift-gated: a test regenerates
  it from the crate and diffs — spec, header, and radar can never disagree
  silently.

## v1 exclusions (deliberate, with reopen triggers)

| Exclusion | Why | Reopen trigger |
|---|---|---|
| Events / subscriptions | reentrancy across languages | demonstrated v2 need (a binding shipping a portable event loop story) |
| Direct `vector_search` / `text_search` fns | the query builder covers them (`.vector`/`.text` sources). (`phrase_search` gained a direct fn in 0.3.0 — positional semantics do not compose out of the bag-of-words `.text` source; see [predicates & queries](/ffi/functions-query/)) | a workload proving per-call builder overhead matters — **stays closed on the measured parity** (see [FFI crossing cost](/performance/ffi-crossing/)) |
| Sketches (Bloom, Cuckoo, HLL, LshIndex, MinHash, TDigest) | not core to the typed-document story | binding-user demand |
| Semantic cache | young API | engine-side stabilization |
| `PlanCache` / `explain` / `plan_shape` | advisory/diagnostic, no runtime contract | a binding asks for query introspection |
| `Db::bulk` (begin_bulk relaxed durability) | `corvid_put_many` covers the bulk fast path | a dump-ingest bench showing per-commit fsync cost matters |
| `Collection::page_where` | filtered keyset pagination composes from `query().filter()` + `offset/limit`; cursor semantics across a moving filter set are subtle | a binding needing constant-memory filtered pagination |
| `Store`-level byte API | the ABI is typed-document only by ruling 1 | none foreseen |
| Non-UTF-8 filesystem paths | `Db::open` accepts any `AsRef<Path>`; the ABI takes `(const char*, len)` and requires UTF-8 — one encoding rule covers every string | a binding on a platform where UTF-8 paths are insufficient (then: a wide-char or OS-native path entry point, additive) |

Next: [bindings](/bindings/overview/).
