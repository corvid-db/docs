---
title: Joins
description: Cross-collection lookup joins in corvid — left-outer by foreign-key field, JoinRow shape, key-kind matching, self-joins and mutation tracking.
sidebar:
  order: 9
---

`Collection::join(right, fk_field)` is a left-outer lookup join: for every
document in the left collection, resolve `fk_field` against the **keys** of
the right collection.

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?;
# let orders = db.collection("orders");
# let mut o = std::collections::BTreeMap::new();
# o.insert("customer_id".into(), Value::Text("c1".into()));
# orders.insert(b"o1", &Value::Map(o))?;
let rows = orders.join("customers", "customer_id")?;   // Vec<JoinRow>
# let _ = rows;
# Ok::<(), corvid::Error>(())
```

## Semantics

- **Left-outer**: every left row is retained. A missing foreign-key field, a
  dangling reference, or an unusable key shape keeps the row with `right =
  None` — a join never errors on data shape.
- Rows follow **left-collection key order**.
- The foreign key may be a **dotted path** (`"meta.customer.id"` resolves
  nested maps).
- **Key-kind matching** (see [equality](/language/equality/)): a `Text`
  foreign key compares against key bytes; a `Bytes` foreign key against raw
  bytes; an `Int` foreign key joins the text key of its decimal encoding
  (`Int(7)` → key `"7"`). Containers/floats/vectors are unusable and miss.
- Non-map left documents are retained with `right = None`.
- **Self-joins** work (`orders.join("orders", "parent_id")`) — the right
  side is simply the same collection's keys.
- An unknown right collection or empty right side yields all rows with
  `right = None`.
- One MVCC snapshot covers the join — both sides read one committed point in
  time, and later mutations of either side are visible to subsequent joins.

## `JoinRow`

```rust
pub struct JoinRow {
    pub left_key: Vec<u8>,
    pub left: Value,           // the left document
    pub right_key: Option<Vec<u8>>,
    pub right: Option<Value>,  // resolved right document, or None
}
```

This is a lookup join, not a relational algebra engine — no join predicates,
no multi-field keys, no inner-join-only mode. Filter and project around it
with the [query builder](/language/query-builder/) by post-processing rows,
or model the relation as [graph edges](/graph/overview/) when you need traversal
rather than resolution.

Next: [sketches](/language/sketches/).
