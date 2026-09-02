---
title: Ownership & transfer
description: The C ABI's ownership rules — the seven transfer rules, the per-family transfer table (cloned/consumed/borrowed inputs, owned/borrowed outputs), and the UB prohibitions.
sidebar:
  order: 10
---

The ABI's transfer rules, in full:

1. **ABI-returned buffers** (strings, `next_after`, auto-keys) →
   `corvid_free(ptr)` only.
2. **Handles** → their own `_free`, never cross-family.
3. **`const corvid_value*` inputs are CLONED** — caller keeps ownership.
4. **Predicates consumed** by and/or/not/filter/delete_where.
5. **`run` and aggregations CONSUME the query.**
6. **Owned-vs-borrowed outputs documented per signature** (rows doc + value
   children are borrowed; freeing them is UB).
7. **NULL discipline per parameter**; unexpected NULL →
   `CORVID_E_ARGUMENT`, never UB.

A function that **consumes** a handle or value consumes it
**unconditionally** — even when it later fails (a failed
`corvid_query_run` has still consumed the query; a failed `corvid_pred_and`
has still consumed both children). Callers must not free consumed handles
afterwards. This mirrors Rust's by-value semantics and makes ownership
transfer single-shot.

## Per-family transfer table

Inputs: C = cloned, K = consumed, B = borrowed-read.
Outputs: O = owned-by-caller, B = borrowed.

| Family | Inputs | Outputs |
|---|---|---|
| Lifecycle & errors | path B | db handle O; error message B (thread-local); strs handle O |
| Collection | name B | coll handle O; name B (until free) |
| Value construction | text/bytes/vector C; `array_push`/`map_put` item K | value O |
| Value reads | parent B | `_ref` buffers B; children B; `as_*` by value; `clone` O |
| Predicates | path/value C; combinators' children K | pred O |
| Query builder | filter pred K; vector/text/select/fields B | query O; `run` → rows O (query K) |
| Aggregations | query K; field names B | scalars by value; min/max O; groupiter O |
| Mutations | keys/docs B (docs C into the engine); update callback's `*out` K; CAS/pred per rule 4 | auto-key buffer O (corvid_free); counters by value |
| Reads | key/after B | `get` value O; scan rows B (callback-scoped); page rows O + next_after O (corvid_free) |
| Indexes & schema | field(s) B; field_defs B | schemaiter O; iterated names B |
| Graph | keys/relations B | strs/geohits O |
| Geo & iterators | field/coords by value | geohits O; hit keys/docs B |
| Admin | paths B | by value |

## The UB prohibitions (bold by design)

- **Freeing or writing through a `_ref` buffer** (text/bytes/vector views) —
  borrowed from the parent value, valid until it is freed or mutated.
- **`corvid_value_free` on a borrowed child** — from `_ref`, `array_get`,
  `map_get`, `rows_next`, `geohits_next`, callbacks, or push/put inputs
  already consumed.
- **Using or freeing a rows cursor's key/document after the next
  `corvid_rows_next` or `corvid_rows_free`.**
- **Freeing a consumed predicate or query** (double free).
- **Cross-family frees** — each handle has exactly one destructor.
- **Concurrent calls on a single-threaded handle** from two threads —
  documented, not detected (see [threading](/ffi/threading/)).

The sanctioned escape hatch for keeping borrowed data:
`corvid_value_clone` — a deep copy returning an owned handle.

Next: [threading](/ffi/threading/).
