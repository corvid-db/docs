---
title: Equality semantics
description: Equality in corvid is per-construct — predicates, compare_and_set, unique constraints, joins and group keys each use their own rule; the NaN duality explained.
sidebar:
  order: 6
---

"Equal" means different things in different places, on purpose. The engine
pins each rule with conformance tests; this page is the consolidated table.

## The per-construct table

| Construct | Equality rule |
|---|---|
| **Predicates** (`eq`/`ne`, ordered ops, `is_in`, `between`) | Typed total-order comparison: NaN never equals anything (not even NaN); `Int(2)` equals `Float(2.0)` numerically — mixed comparisons convert the integer through f64, exact up to 2^53. |
| **`compare_and_set` expected value** | Semantic value equality: NaN == NaN regardless of payload, −0.0 == 0.0, containers element-wise. |
| **Unique constraints** | Storage-level semantic equality (NaN == NaN), enforced per field value on write. |
| **Joins** | An `Int` foreign key matches a `Text` key via its decimal-string encoding: `Int(7)` joins to the key `"7"`. |
| **Group keys** (`group_count`/`group_sum`/`group_avg`, `count_distinct`) | Type-tagged canonical keys: bare for text (`blog`), `i:`/`f:`/`b:` tags for non-text, `t:` escape for text that would look tagged — distinct types stay distinct. |

## The NaN duality

Two rules coexist by design:

- **Predicate comparisons** — NaN matches nothing, not even NaN. A NaN
  filter value selects the empty set under `eq` and ordered operators;
  `ne` selects everything else. This keeps filter semantics a clean total
  order without an NaN special case.
- **Storage equality** — `compare_and_set` expectations and unique
  constraints treat NaN as equal to NaN (payload-agnostic) and −0.0 equal to
  0.0. These constructs answer "is the stored value *this* value?", where
  rejecting NaN would make NaN-valued fields (common in float pipelines)
  unusable.

## Worked examples

```rust
# use corvid::{Db, Value, field};
# use std::collections::BTreeMap;
# let db = Db::open_in_memory()?; let c = db.collection("t");
// field("v") traverses maps, so each doc carries its value under "v"
let doc = |v: Value| {
    let mut m = BTreeMap::new();
    m.insert("v".to_string(), v);
    Value::Map(m)
};

// Predicate: NaN selects nothing, ne selects the rest
c.insert(b"a", &doc(Value::Float(f64::NAN)))?;
c.insert(b"b", &doc(Value::Int(2)))?;
c.insert(b"c", &doc(Value::Float(2.0)))?;

c.query().filter(field("v").eq(Value::Float(f64::NAN))).count()?;  // 0
c.query().filter(field("v").eq(Value::Int(2))).count()?;           // 2 — numeric interop
c.query().filter(field("v").ne(Value::Int(2))).count()?;           // 1 (the NaN doc)

// Storage equality: NaN matches NaN in compare_and_set, element-wise
// inside containers too — this deletes doc "a"
let matched = c.compare_and_set(b"a", Some(&doc(Value::Float(f64::NAN))), None)?; // true
# let _ = matched;
# Ok::<(), corvid::Error>(())
```

Unique constraints make NaN==NaN visible too: a second document with NaN in a
`unique` Float field is rejected with `Error::SchemaViolation`, whether or
not the payloads differ.

## Why joins get a rule of their own

Join foreign keys are *document values*; the target is a *byte key*. Text
foreign keys compare as bytes; an `Int` foreign key encodes through its
decimal string (`Int(7)` → `"7"`) so integer ids join text keys naturally.
Unusable shapes (containers, vectors, floats) retain the row with a `None`
right side — a lookup join never errors on data shape, it misses.

Next: [ordering rules](/language/ordering/).
