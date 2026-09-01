---
title: Filters
description: Predicate construction in corvid — field paths, comparison operators, in/between/starts_with/contains, geo predicates, and/or/not composition, and index serviceability.
sidebar:
  order: 3
---

Filters are pure predicates: `Predicate` trees built with the `field(path)`
fluent API and evaluated against documents. They compose into
[queries](/language/query-builder/), `delete_where`, `page_where`, and the C
ABI's predicate family.

## Building predicates

```rust
use corvid::{field, Value};

// Comparisons
field("category").eq(Value::Text("blog".into()));
field("category").ne(Value::Text("draft".into()));
field("score").lt(Value::Int(5));
field("score").le(Value::Int(5));
field("score").gt(Value::Int(5));
field("score").ge(Value::Int(5));

// Membership and ranges
field("tag").is_in([Value::Text("a".into()), Value::Text("b".into())]);
field("score").between(Value::Int(1), Value::Int(10));      // inclusive both ends

// Text
field("title").starts_with("intro");
field("body").contains("rust");

// Presence
field("email").exists();

// Geo (haversine kilometres)
field("loc").within_km(51.5, -0.13, 25.0);
# let _ = ();
```

## Composition

```rust
# use corvid::{field, Value};
let p = field("category").eq(Value::Text("blog".into()))
    .and(field("score").ge(Value::Int(3)))
    .or(field("pinned").eq(Value::Bool(true)));
let p = !field("draft").eq(Value::Bool(true));   // Not
# let _ = p;
```

`and`/`or`/`not` build the tree; De Morgan identities hold and nesting is
arbitrary. Multiple `.filter(...)` calls on one query intersect like `and`.

## Evaluation semantics

- **Missing path ⇒ false** for every predicate except `exists()` (and `ne`,
  which is `true` when the path is missing — see below).
- **Ordered comparisons across non-comparable kinds ⇒ false.** Numbers
  compare numerically across `Int`/`Float` (exact to 2^53); text compares
  lexicographically by UTF-8 bytes; bools, bytes, containers and vectors do
  not participate in `<`/`>`/`<=`/`>=`.
- **`eq` matches per value kind**, with numeric interop:
  `field("n").eq(Value::Float(2.0))` matches `Int(2)`.
- **`ne` is the complement of `eq`** evaluated over the same rule — a
  missing path or a NaN value therefore yields `true` for `ne`.
- **NaN matches nothing, not even NaN** — a NaN filter value selects the
  empty set under `eq` and ordered ops, and everything *else* under `ne`.
  (This is the predicate rule; storage equality — CAS, unique constraints —
  treats NaN as equal to NaN. See
  [equality semantics](/language/equality/).)
- **`is_in`** is an OR over `eq` against each element; an empty list matches
  nothing. **`between(lo, hi)`** is `lo <= v && v <= hi`, inclusive; a
  degenerate `lo > hi` range simply matches nothing.
- **`starts_with` / `contains`** are byte-level text predicates — false on
  non-text values and missing paths, case-sensitive.
- **`within_km(lat, lon, km)`** resolves the path as a geo point
  (`[lat, lon]` array or `{lat, lon}` map), false on non-points.

## Index serviceability

Filters never *require* an index, but each predicate family has a
sub-linear path when one exists:

| Predicate | Serviced by |
|---|---|
| `eq` / `ne`* / `lt` / `le` / `gt` / `ge` | [scalar index](/indexes/scalar/) |
| `eq` prefix + trailing range across fields | [compound index](/indexes/scalar/#compound-indexes) |
| `is_in` | scalar index (union of windows, capped) |
| `between` | scalar index (range window) |
| `starts_with` | scalar index (text prefix scan) |
| `within_km` | [geo index](/indexes/geo/) |
| top-level `or` of index-serviceable disjuncts | index union |

*`ne` is not serviced (an anti-scan is not sub-linear) — it verifies on the
scan path.

The builder probes every serviceable index (each capped) and drives the query
on the smallest candidate set, then verifies every candidate against the
exact predicate — so results are identical with or without indexes, and
unselective predicates fall back to the bounded streaming scan. `explain()`
reports which happened (`IndexedWindow` vs `Scan`).

Next: the [query builder](/language/query-builder/).
