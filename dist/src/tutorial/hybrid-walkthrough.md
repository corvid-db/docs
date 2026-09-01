---
title: The hybrid query walkthrough
description: A complete worked example — building a small retrieval corpus, choosing indexes, and running a filter + vector + BM25 query fused with RRF and reranked with MMR.
sidebar:
  order: 2
---

This walkthrough builds a small hybrid-retrieval corpus and queries it the way
a RAG application would: metadata filter + embedding similarity + keyword
search, fused into one ranked list. It exercises most of the query builder in
one continuous example.

## The scenario

A notes application stores Markdown documents. Each document carries:

- `title`, `body` — text
- `tags` — an array of text
- `source` — where it came from
- `embedding` — a dense vector from your embedding model (corvid does not run
  models; you embed at the boundary)

The retrieval question: *"among my imported notes, which ten are most relevant
to a query — by meaning and by keywords — without near-duplicates dominating
the page?"*

## Set up the corpus

```rust
use corvid::{Db, Metric, Value, field};
use std::collections::BTreeMap;

let db = Db::open("notes.corvid")?;
let notes = db.collection("notes");

fn note(title: &str, body: &str, tags: &[&str], embedding: Vec<f32>) -> Value {
    let mut m = BTreeMap::new();
    m.insert("title".into(), Value::Text(title.into()));
    m.insert("body".into(), Value::Text(body.into()));
    m.insert("tags".into(), Value::Array(
        tags.iter().map(|t| Value::Text((*t).into())).collect()));
    m.insert("embedding".into(), Value::Vector(embedding));
    Value::Map(m)
}

notes.insert(b"n1", &note(
    "HNSW graphs", "Hierarchical navigable small world graphs index vectors for approximate search",
    &["vector", "search"], vec![0.1, 0.9, 0.2]))?;
notes.insert(b"n2", &note(
    "BM25 in one page", "BM25 ranks documents by term frequency, inverse document frequency, and length",
    &["search", "text"], vec![0.9, 0.1, 0.4]))?;
// … more documents …
# Ok::<(), corvid::Error>(())
```

## Add indexes

Exact search is the correctness baseline and fine at small scale. Past
~100k documents you want indexes; add them now so the walkthrough is
realistic:

```rust
# use corvid::{Db, Metric, Quantization};
# let db = Db::open_in_memory()?; let notes = db.collection("notes");
notes.create_scalar_index("source")?;              // sub-linear equality filters
notes.create_text_index_ondisk("body")?;           // BM25 postings, bounded memory
notes.create_vector_index_ondisk_quantized(
    "embedding", Metric::Cosine, Quantization::Scalar)?; // HNSW, ~4x smaller
# Ok::<(), corvid::Error>(())
```

You never change the query to use an index — the builder picks the most
selective available index automatically and falls back to a bounded scan when
none helps. See [indexes](/indexes/overview/) for choosing.

## The hybrid query

```rust
# use corvid::{Db, Metric, Value, field};
# let db = Db::open_in_memory()?; let notes = db.collection("notes");
let query_vec = vec![0.12, 0.85, 0.18];   // embedding of the user's question
let query_txt = "vector search index";

let rows = notes
    .query()
    .filter(field("tags").contains("search"))
    .vector("embedding", query_vec, 100, Metric::Cosine)
    .text("body", query_txt, 100)
    .fuse_rrf(60.0)
    .rerank_mmr(0.7)
    .limit(10)
    .select(["title", "tags"])
    .run()?;
# let _ = rows;
# Ok::<(), corvid::Error>(())
```

What each stage does:

1. **`filter`** runs first. It is a true predicate: the candidate set for
   ranking is exactly the matching documents — the top-k is never computed
   over documents the filter would reject. (With a scalar index on the
   filtered field, this step is sub-linear.)
2. **`vector`** adds a similarity source: the 100 nearest embeddings by
   cosine distance among the filtered candidates.
3. **`text`** adds a BM25 source: the 100 best matches for the query terms.
   Because the filter ran first, BM25's statistics — document frequencies,
   average length — are computed over the *filtered* corpus, so a score means
   "relevance within the candidates the filter admits".
4. **`fuse_rrf(60.0)`** merges the two ranked lists with reciprocal-rank
   fusion: each document scores `Σ 1/(k + rank_i)` across sources. The
   default constant is `corvid::DEFAULT_RRF_K` = 60. Documents appearing high
   in *both* lists outrank documents that top only one — the fusion boost.
5. **`rerank_mmr(0.7)`** diversifies: maximal-marginal-relevance reranking
   trades a little relevance for coverage, using the query vector as the
   relevance anchor. `λ = 1` is pure relevance (a no-op reorder), `λ = 0`
   maximizes diversity. Documents without an embedding field survive the
   rerank (they just don't diversify).
6. **`limit` / `select`** shape the answer: ten rows, each document projected
   to `title` and `tags` for cheap transport. Ranking still saw the full
   documents.

Each `ResultRow` carries `{ key, score, document }`. `score` is the fused RRF
score (`0.0` for pure filter/order queries).

## Variations

**No vector model yet?** Drop the `.vector(...)` line — a single text source
is a normal BM25 query (served by the text index without a corpus rescan).
**No text?** Drop `.text(...)` — single-source vector ranking. **Neither?**
The builder degrades to a filtered scan, streamed with bounded memory.

**Tighter correctness on the vector side?** Leave `.approx()` off (the
default): filtered vector queries run *exact* over the matching set. Add
`.approx()` to let a filtered query use the ANN index — over-fetch then
filter — which is faster but may return fewer than `limit` rows when the
filter is highly selective.

**Understand what ran:**

```rust
# use corvid::{Db, field, Value};
# let db = Db::open_in_memory()?; let notes = db.collection("notes");
let q = notes.query().filter(field("tags").exists());
println!("{}", q.explain()?);     // human-readable plan
let shape = q.plan_shape()?;      // AnnIndex | TextIndex | IndexedWindow | SortIndex | StreamingTopK | Scan
let plan = q.plan()?;             // hashable QueryPlan — key a PlanCache on it
# let _ = (shape, plan);
# Ok::<(), corvid::Error>(())
```

## Where to go next

- [The query builder](/language/query-builder/) — every knob and its exact
  semantics.
- [Equality semantics](/language/equality/) — the per-construct rules
  (predicates vs storage equality vs unique constraints).
- [Indexes](/indexes/overview/) — which index serves which query shape.
- [Performance](/performance/overview/) — the measured numbers behind these defaults.
