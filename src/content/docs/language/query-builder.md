---
title: The query builder
description: QueryBuilder end to end — filter, vector and text sources, RRF fusion, MMR reranking, approx, order_by, offset, limit, select, run, explain and plan shapes.
sidebar:
  order: 4
---

One chained call composes filtering, vector search, text search, fusion, and
reranking. The builder is the only query entrypoint — there is no SQL and no
string-formatted query language.

```rust
# use corvid::{Db, Metric, Value, field};
# let db = Db::open_in_memory()?; let docs = db.collection("docs");
let rows = docs.query()
    .filter(field("category").eq(Value::Text("blog".into())))
    .vector("embedding", vec![0.1, 0.9], 100, Metric::Cosine)
    .text("body", "rust embedded database", 100)
    .fuse_rrf(60.0)
    .rerank_mmr(0.7)
    .offset(0)
    .limit(10)
    .select(["title", "meta.author"])
    .run()?;   // Vec<ResultRow> { key, score, document }
# let _ = rows;
# Ok::<(), corvid::Error>(())
```

Execution order is fixed regardless of call order:

```text
filter (predicate) → sources (vector/text candidates among matches)
      → fusion (RRF) → rerank (MMR) → order_by → offset → limit → select
```

## `filter(predicate)`

Adds a [predicate](/language/filters/); multiple calls intersect (`and`).
The filter is a **true predicate**: it runs before ranking, so the top-k is
computed among matching documents only — never top-k-then-trim.

## `vector(field, query, k, metric)`

Adds a vector-similarity source: the `k` nearest values of `field` to
`query`. Metrics: `Metric::Cosine`, `Metric::Dot`, `Metric::L2` (squared).
Documents missing the field or carrying a different dimension are skipped.
With a [vector index](/indexes/vector/) on the field, the source is served
by HNSW; otherwise it is an exact bounded scan. Zero-norm vectors are
maximally distant under cosine/dot and rank last.

## `text(field, query, k)`

Adds a BM25 text source: the `k` best matches for the analyzed query
terms. With a [text index](/indexes/text/) the source reads only query-term
postings; without one it scores an exact pass. When a filter is present, BM25
statistics are computed over the **filtered** corpus — a score always means
"relevance within the candidate set the filter admits".

## `fuse_rrf(k)`

Reciprocal-rank fusion across sources: each document scores
`Σ_sources 1 / (k + rank)`. Default `corvid::DEFAULT_RRF_K` = 60. `k` must be
positive and non-NaN (validated at `run()`, `Error::InvalidArgument`). With
one source, fusion is identity; with none, the query is a pure
filter/shape query.

## `rerank_mmr(lambda)`

Maximal-marginal-relevance diversification over the fused ranking, anchored on
the **first vector source's** query (with several vector sources, the earliest
`.vector(...)` call supplies the relevance vector). `lambda ∈ [0, 1]`
(1 = pure relevance order, 0 = maximal diversity; validated at `run()`).
Requires a vector source — without one it is a no-op. Documents without an
embedding survive the rerank unchanged.

## `approx()`

Opts a **filtered** vector query into the ANN index: fetch the index's top-k
first, apply the filter after. Without `.approx()` (default), filtered vector
queries run exact over the matching set. Trade: `.approx()` is faster on
large collections but a highly selective filter may return fewer than
`limit` rows. Unfiltered vector sources always use the index when present.

## `order_by(field, descending)`

Sort by a document field **instead of** rank (rank ordering applies when
`order_by` is absent). There is **no special `score` field**:
`order_by("score", true)` orders by a literal document field named `score` —
which documents rarely carry, so every row lands in the missing class, sorted
by key. To get rank order, simply omit `order_by`; the fused RRF score rides
along on every `ResultRow` if you want to re-sort client-side. Ordering
follows the class rules on
[ordering](/language/ordering/): comparable values (numbers numerically —
numbers before texts across kinds — texts lexically) first; incomparable
values after; rows missing the field last; ties by key. `descending`
reverses within-class order only. A filterless `order_by` over a complete
scalar index is served by an index order walk (`PlanShape::SortIndex`) —
documents are fetched only for the `offset + limit` window.

## `offset(n)` / `limit(n)`

Windowing applies after ordering, before `select`. `limit 0` yields an empty
result. `offset` paginates but is O(offset) — for heavy pagination prefer
keyset [cursors](/language/pagination/).

## `select(fields)`

Projects each returned document to the listed top-level (dotted) fields.
Missing fields are omitted (not null); duplicates collapse; a non-map
document passes through unchanged. Ranking and filtering always see the full
document — `select` only shapes the output.

## `run()`

Executes and returns `Vec<ResultRow>` (`{ key, score, document }`). `score`
is the fused RRF score (`f32`); `0.0` for pure filter/order queries. One MVCC
snapshot covers the whole query — the result set matches one committed point
in time. Ranking arguments (RRF k, MMR lambda, BM25 params) are validated
here.

## `explain()`, `plan()`, `plan_shape()`

```rust
# use corvid::{Db, field};
# let db = Db::open_in_memory()?; let docs = db.collection("docs");
let mut q = docs.query().filter(field("a").exists());
q.explain()?;        // String — human-readable plan, pinned to the real decision
q.plan_shape()?;     // PlanShape (advisory)
q.plan()?;           // QueryPlan — canonical, identity-hashable
# Ok::<(), corvid::Error>(())
```

`PlanShape` variants: `AnnIndex` (single vector source on an indexed field),
`TextIndex` (single text source on an indexed field), `IndexedWindow`
(a scalar/compound/geo/or index drives the filter), `SortIndex` (order walk),
`StreamingTopK` (bounded ranked pass without an index), `Scan` (streaming
filter/shape pass). `QueryPlan` is equal iff the query shape is equal — key
a `PlanCache` on it to cache prepared per-shape work (never results).

## Aggregations on the builder

`count`, `count_distinct`, `sum`, `avg`, `min`, `max`, `group_count`,
`group_sum`, `group_avg` execute against the filtered set on one snapshot and
**ignore** sources, ranking, and `limit`/`offset`/`select` — see
[aggregations](/language/aggregations/).

Next: [aggregations](/language/aggregations/).
