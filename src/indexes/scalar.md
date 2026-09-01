---
title: Scalar and compound indexes
description: create_scalar_index and create_compound_index — order-preserving keys for sub-linear equality/range filters and counts, prefix-equality plus trailing-range compound windows, and the all_docs_indexed rule.
sidebar:
  order: 1
---

```rust
# use corvid::{Db};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
c.create_scalar_index("category")?;                 // one field
c.create_scalar_index("meta.score")?;               // nested paths work
c.create_compound_index(&["tenant", "ts"])?;        // ordered field list
# Ok::<(), corvid::Error>(())
```

Both store **order-preserving keys** in engine namespaces as ordinary
records: selective equality/range filters and counts go sub-linear (an index
window instead of a full scan), and the state persists across reopen with no
rebuild.

## How the scalar index serves a query

- Numbers (Int+Float) share one lane keyed by the IEEE-754 total order of
  the f64 — the i64→f64 cast is monotonic, so a range scan never excludes a
  true match. Text has its own lane; a field holding both kinds indexes
  per-lane.
- The index returns a **verified candidate superset**: the builder re-checks
  every candidate against the exact predicate, so encoding ties cost a few
  extra checks, never correctness.
- `ne` is not serviced — an anti-scan is not sub-linear.
- Unselective windows (and `is_in`/`or` unions over the 100,000-key
  aggregate cap) fall back to the bounded streaming scan.
- A filterless `order_by(field)` over a complete scalar index is served by an
  **index order walk** (`PlanShape::SortIndex`) — documents are fetched only
  for the `offset + limit` window (see [ordering](/language/ordering/)).

Measured shape: on 1M docs, a selective equality drops ~662 ms → ~3 ms; a
100-row range window ~0.5 ms (see [performance](/performance/scaling/)).

## Compound indexes

`create_compound_index(&["a", "b"])` covers **equality on a leading prefix +
at most one trailing range**:

```rust
# use corvid::{Db, field, Value};
# let db = Db::open_in_memory()?; let c = db.collection("events");
# c.create_compound_index(&["tenant", "ts"])?;
// servable: equality prefix + trailing range
let rows = c.query()
    .filter(field("tenant").eq(Value::Text("acme".into())))
    .filter(field("ts").between(Value::Int(1), Value::Int(99)))
    .run()?;
# let _ = rows;
# Ok::<(), corvid::Error>(())
```

- **Field order matters**: `["tenant","ts"]` serves `tenant = ?` (+ optional
  `ts` range); it does not serve a bare `ts` range. `["ts","tenant"]` is a
  different index — both may coexist.
- Documents **missing any indexed field are absent from the index.** This has
  a consequence for prefix-only queries (equality on the leading field with
  trailing fields unconstrained): a matching document necessarily has the
  leading field, so it *is* indexed — but only when the index can trust that
  *every* document has all fields present. Each compound definition persists
  an `all_docs_indexed` flag, set at backfill completion iff no document ever
  missed a field, cleared permanently by any write that leaves a field
  missing/non-encodable, and recomputed by re-creating the index:
  - flag set → prefix-only queries are served through the window (~6.6× on
    the 5k benchmark corpus);
  - flag clear → prefix-only queries decline to the `Scan` path — identical
    results, just unaccelerated.
- Any write that leaves an indexed field missing or non-encodable marks the
  miss in the write's own transaction, so the flag never lies.

## Maintenance

- Re-creating an index (same or different parameters) replaces it — one
  transactional reset, no stale entries.
- Backfills over an existing collection commit per page with progress
  persistence; creation interrupted by crash/error resumes on first query
  (see [maintenance](/indexes/maintenance/)).
- Scalar indexes also accelerate `delete_where` and unique-constraint
  enforcement for `unique` schema fields.

Next: [text indexes](/indexes/text/).
