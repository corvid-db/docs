---
title: Ordering rules
description: order_by class rules in corvid — comparable values first, incomparable after, missing last, ties by key, kind lattice (numbers before texts), and how descending works.
sidebar:
  order: 7
---

`order_by(field, descending)` sorts rows by a document field instead of by
rank. The contract is a fixed **class order** with a pinned total order
inside each class, so mixed-shape fields sort deterministically instead of
panicking or interleaving by key.

## The class order

```text
1. comparable values    (in value order)
2. incomparable values  (bools, containers, vectors, NaN — kind tag first,
                         then key)
3. rows missing the field (stable by key)
```

Ties inside a class break by key. Within the incomparable class, a **kind
tag** orders the values first — NaN is a numeric kind, so it precedes the
other incomparable kinds (bools, containers, vectors), which then fall to
key order among themselves. `descending` reverses the within-class order —
kind tag and value together — in **both** the comparable and the
incomparable class; the class order
(comparable < incomparable < missing) and the key tiebreak are fixed, so
incomparable and missing values always sort last.

## The comparable class

- **Numbers** — `Int` and `Float` interoperate numerically (i64 converts
  through f64, exact up to 2^53; larger ints share an f64 encoding and tie,
  then break by key). NaN is *not* comparable: it sorts with the
  incomparable class, never among numbers.
- **Text** — lexicographic by UTF-8 bytes.
- **Across kinds** — numbers sort before texts (a kind tag orders the
  cross-kind pairs). This closes a historical hole: key-order fallback for
  cross-kind pairs was not a total order and could construct sort cycles.

Bytes, bools, arrays, maps, and vectors are incomparable and occupy class 2
— after every number and text, before the missing rows.

## Interaction with the rest of the builder

- `offset`/`limit` apply **after** ordering (a window over the sorted rows).
- Filters order only the matching rows.
- A filterless `order_by` whose field carries a complete
  [scalar index](/indexes/scalar/) is served by an index order walk
  (`PlanShape::SortIndex`): documents are fetched only for the
  `offset + limit` window; incomparable/missing rows are appended by an
  on-exhaustion tail scan. Results are identical to the materialize-and-sort
  path by construction — measured ~9× faster ascending / ~2.7× descending on
  a 5k corpus with `limit 20`.
- With retrieval sources present, `order_by` re-sorts the fused candidates
  (rank order applies only when `order_by` is absent).

## Example

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("t");
c.insert(b"a", &Value::Map([("v".to_string(), Value::Text("x".into()))].into()))?;
c.insert(b"b", &Value::Map([("v".to_string(), Value::Int(10))].into()))?;
c.insert(b"c", &Value::Map([("v".to_string(), Value::Int(2))].into()))?;
c.insert(b"d", &Value::Map([("v".to_string(), Value::Bool(true))].into()))?;
c.insert(b"e", &Value::Int(0))?;                       // missing "v" entirely

// order_by("v", ascending) yields keys: c (2), b (10), a ("x"), d (bool), e (missing)
let rows = c.query().order_by("v", false).run()?;
# let _ = rows;
# Ok::<(), corvid::Error>(())
```

Descending yields `a` (text), then `b`, `c` (numbers reversed), then `d`,
`e` unchanged at the tail — classes keep their order.

Next: [pagination](/language/pagination/).
