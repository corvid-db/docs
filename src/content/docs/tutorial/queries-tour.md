---
title: A tour of queries
description: Filters, vector search, text search, aggregations and pagination in corvid — the read-side tour before composing them into hybrid queries.
sidebar:
  order: 1
---

corvid reads through one fluent builder. This tour touches each capability
singly; the [hybrid walkthrough](/tutorial/hybrid-walkthrough/) composes them.

## Filters

Predicates are built with `field(path)` and evaluate against dotted paths in
the document:

```rust
use corvid::{field, Value};

field("category").eq(Value::Text("blog".into()));
field("score").gt(Value::Int(5));
field("score").between(Value::Int(1), Value::Int(10));   // inclusive
field("tag").is_in([Value::Text("a".into()), Value::Text("b".into())]);
field("title").starts_with("intro");
field("body").contains("rust");
field("loc").within_km(51.5, -0.13, 25.0);               // geo
field("email").exists();

// Combine with and/or/not:
let p = field("category").eq(Value::Text("blog".into()))
    .and(field("score").ge(Value::Int(3)))
    .or(field("pinned").eq(Value::Bool(true)));
let p = !field("draft").eq(Value::Bool(true));            // negation
# let _ = p;
```

Comparisons on a missing path are `false`; ordered comparisons across
non-comparable types are `false`. Full semantics — including the NaN rules —
are on the [filters](/language/filters/) and
[equality](/language/equality/) pages.

## Vector search

Vectors are first-class document values (`Value::Vector`, dense `f32`).
Without an index, search is exact — brute-force with a bounded heap, streamed:

```rust
# use corvid::{Db, Metric};
# let db = Db::open_in_memory()?; let docs = db.collection("docs");
let hits = docs.vector_search("embedding", &[0.1, 0.9], 10, Metric::Cosine)?;
// Vec<Hit>: { key, score, approximate, document }
# let _ = hits;
# Ok::<(), corvid::Error>(())
```

Metrics: `Metric::Cosine` (1 − cos similarity), `Metric::Dot` (negated dot —
larger dot sorts first), `Metric::L2` (squared Euclidean). Creating a
[vector index](/indexes/vector/) switches `vector_search` to HNSW
transparently; `Hit.approximate` tells you which path served the answer.

## Text search

BM25 ranking over an analyzer that lowercases, drops common English stop
words, and applies a conservative plural stemmer (`dog` matches `dogs`):

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let docs = db.collection("docs");
let hits = docs.text_search("body", "rust databases", 10)?;      // Vec<TextHit>
let phrase = docs.phrase_search("body", "embedded database", 10)?; // exact, in order
# let _ = (hits, phrase);
# Ok::<(), corvid::Error>(())
```

Text containing CJK (Han, hiragana, katakana) tokenizes as sliding bigrams —
`東京タワー` phrase-matches in order, `タワー東京` does not. See
[full-text search](/fts/overview/).

## The builder, in one shape

```rust
# use corvid::{Db, Metric, Value, field};
# let db = Db::open_in_memory()?; let docs = db.collection("docs");
let rows = docs.query()
    .filter(field("category").eq(Value::Text("blog".into())))
    .vector("embedding", vec![0.1, 0.9], 100, Metric::Cosine)  // a retrieval source
    .text("body", "rust embedded database", 100)               // another source
    .fuse_rrf(60.0)            // reciprocal-rank-fusion constant (optional)
    .rerank_mmr(0.7)           // diversify (optional; needs a vector source)
    .offset(0)
    .limit(10)
    .select(["title", "meta.author"])  // project returned docs (optional)
    .run()?;                   // -> Vec<ResultRow> { key, score, document }
# let _ = rows;
# Ok::<(), corvid::Error>(())
```

Notes:

- Zero sources → a pure filter/scan query (streamed, bounded memory).
- One source → ranked by that source. Multiple → fused with RRF.
- Rank order is what you get above; `order_by(field, desc)` replaces it with
  a sort on a **literal document field** (there is no special `score` field —
  to keep rank order, omit `order_by`; the fused score rides on each row).
- Filtering happens **before** ranking, so the top-k is computed among
  matching documents.
- `.approx()` lets a *filtered* vector query use the ANN index (over-fetch
  then filter); without it, filtered vector queries run exact.
- `.explain()` returns a human-readable plan string; `.plan()` returns a
  hashable `QueryPlan` you can key a `PlanCache` on.

## Aggregations

Over the filtered set (filters and indexes still apply):

```rust
# use corvid::{Db, field, Value};
# let db = Db::open_in_memory()?; let sales = db.collection("sales");
sales.query().count()?;                          // usize
sales.query().filter(field("region").eq(Value::Text("eu".into()))).count()?;
sales.query().sum("amount")?;                    // f64
sales.query().avg("amount")?;                    // Option<f64>
sales.query().min("amount")?; sales.query().max("amount")?;  // Option<Value>
sales.query().count_distinct("region")?;         // usize
sales.query().group_count("region")?;            // BTreeMap<String, usize>
sales.query().group_sum("region", "amount")?;    // BTreeMap<String, f64>
sales.query().group_avg("region", "amount")?;
# Ok::<(), corvid::Error>(())
```

Retrieval sources, ranking, and `limit`/`offset`/`select` are ignored by
aggregates — they measure the filtered set. Details in
[aggregations](/language/aggregations/).

## Pagination

Keyset (cursor) pagination — no offset rescans:

```rust
# use corvid::{Db, field, Value};
# let db = Db::open_in_memory()?; let docs = db.collection("docs");
let mut after: Option<Vec<u8>> = None;
loop {
    let page = docs.page(after.as_deref(), 100)?;   // or page_where(after, n, predicate)
    for (key, doc) in &page.rows { /* ... */ let _ = (key, doc); }
    match page.next { Some(cursor) => after = Some(cursor), None => break }
}
# Ok::<(), corvid::Error>(())
```

## Graph, geo, joins

Three more read paths, each with a dedicated section:

```rust
# use corvid::{Db, field};
# let db = Db::open_in_memory()?; let people = db.collection("people");
people.link(b"alice", "follows", b"bob")?;             // graph edges
people.traverse(b"alice", "follows", 3)?;              // BFS up to 3 hops
# let places = db.collection("places");
places.geo_nearest("loc", 51.5, -0.13, 5)?;            // k nearest
# let orders = db.collection("orders");
orders.join("customers", "customer_id")?;              // left-outer lookup join
# Ok::<(), corvid::Error>(())
```

- [Graph](/graph/overview/): link/unlink/neighbors/traverse, cascade semantics.
- [Geo](/geo/overview/): radius/bbox/nearest, antimeridian handling.
- [Joins](/language/joins/): foreign-key resolution across collections.

Next: put it all together in the [hybrid walkthrough](/tutorial/hybrid-walkthrough/).
