---
title: Aggregations
description: Aggregations in corvid — count, count_distinct, sum, avg, min, max and grouped variants over the filtered set, with NaN, missing-value and group-key semantics.
sidebar:
  order: 5
---

Aggregations execute against the **filtered set** on one read snapshot.
Retrieval sources (`.vector`/`.text`), ranking knobs, and
`limit`/`offset`/`select` are ignored — an aggregate measures the filtered
collection. Filters and indexes still apply, and indexed vs scan paths give
identical answers.

```rust
# use corvid::{Db, field, Value};
# let db = Db::open_in_memory()?; let sales = db.collection("sales");
let q = || sales.query().filter(field("region").eq(Value::Text("eu".into())));
q().count()?;                    // usize — O(1) when unfiltered
q().sum("amount")?;              // f64
q().avg("amount")?;              // Option<f64>
q().min("amount")?;              // Option<Value>
q().max("amount")?;              // Option<Value>
q().count_distinct("region")?;   // usize
q().group_count("region")?;      // BTreeMap<String, usize>
q().group_sum("region", "amount")?;   // BTreeMap<String, f64>
q().group_avg("region", "amount")?;   // BTreeMap<String, f64>
# Ok::<(), corvid::Error>(())
```

Ranking arguments are validated before aggregating (a garbage RRF k or MMR
lambda fails with `Error::InvalidArgument` even though ranking is unused).

## Per-aggregate semantics

**`count`** — number of matching documents. Without a filter it is the O(1)
maintained collection counter.

**`sum(field)`** — sums numeric (`Int`/`Float`) values; missing paths and
non-numeric values are skipped; all-missing yields `0.0`. NaN members poison
the sum; infinities follow IEEE arithmetic. Ints round through f64 beyond
2^53.

**`avg(field)`** — mean over the numeric values that were present;
`None` when there were none. A NaN member poisons the mean.

**`min` / `max(field)`** — smallest/largest *comparable* value (numbers
interoperate; text compares lexicographically), returned as the stored
`Value`. Incomparable-only fields yield `None`; mixed kinds pin the first
comparable kind's winner (numbers beat texts in cross-kind min/max).

**`count_distinct(field)`** — distinct scalar values by the canonical
[group key](#group-keys): distinct types stay distinct; missing and container
values are ignored.

**`group_count` / `group_sum` / `group_avg`** — one bucket per distinct value
of the group field; counts are exact, sums/averages follow the `sum`/`avg`
rules within the bucket. Buckets with no numeric members are absent from
`group_sum`/`group_avg`. Grouping respects filters, and — like every
aggregate — runs on one snapshot.

## Group keys

`group_*` and `count_distinct` key buckets by a canonical type-tagged form so
that distinct kinds never collide:

| Field value | Group key |
|---|---|
| `Text("blog")` | `blog` (bare) |
| `Int(1)` / `Float(1.5)` / `Bool(true)` | `i:1` / `f:1.5` / `b:true` |
| Text that would look tagged (`"i:1"`) | `t:i:1` (escaped) |

Consequences visible in results: `1` (Int) and `1.0` (Float) are **distinct**
buckets (the tags differ), `0.0` and `-0.0` share a bucket, NaN forms one
`f:NaN` bucket, and a text value that happens to look like a tag is escaped,
never conflated. The engine's `BTreeMap` gives the iteration order: ascending
group-key byte order (the C ABI's group iterator preserves it).

## Approximate distinct

`Collection::approx_distinct(field)` estimates a field's distinct count with
HyperLogLog — sub-linear memory on large corpora, exact on small counts and
duplicate-heavy inputs (see [sketches](/language/sketches/)).

Next: [equality semantics](/language/equality/).
