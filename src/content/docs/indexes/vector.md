---
title: Vector indexes
description: HNSW vector indexes in corvid — the five constructor variants, metrics, exact vs approximate behavior, Hit.approximate, dimension handling and automatic use.
sidebar:
  order: 4
---

Without an index, vector search is **exact** — a streamed brute-force scan
with a bounded heap (the correctness baseline, OOM-free at any size). Creating
an HNSW index switches `vector_search` and builder `.vector(...)` sources to
the graph transparently; `Hit.approximate` reports which path served the
answer.

## The constructors

| Constructor | Storage | When |
|---|---|---|
| `create_vector_index(field, metric)` | in-RAM HNSW | default; fast, rebuilt lazily on open |
| `create_vector_index_quantized(field, metric, quant)` | in-RAM, compressed | `Quantization::Binary` (~32×) / `Scalar` (~4×) |
| `create_vector_index_pq(field, metric, m, k)` | in-RAM, product-quantized | smallest RAM footprint (`m` code bytes/vector) |
| `create_vector_index_ondisk(field, metric)` | on-disk HNSW | bounded memory, persists, no rebuild |
| `create_vector_index_ondisk_quantized(field, metric, quant)` | on-disk, compressed | billions of vectors on a laptop |
| `create_vector_index_ondisk_pq(field, metric, m, k)` | on-disk, product-quantized | smallest on-disk footprint |

```rust
# use corvid::{Db, Metric, Quantization};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
c.create_vector_index_ondisk_quantized("embedding", Metric::Cosine, Quantization::Scalar)?;
# Ok::<(), corvid::Error>(())
```

Compression ratios are asymptotic (less at low dimensions, where the 8-byte
scalar header dominates). PQ variants need training vectors:
`create_vector_index_pq` fails with `Error::EmptyIndexTraining` when the
collection has no usable vectors, when `m` does not divide the field
dimension, when `m == 0`, or when `k` is outside `2..=256`. See
[quantization](/indexes/quantization/) for choosing a mode.

## Metrics

`Metric::Cosine` (1 − cosine similarity, `[0, 2]`; zero-norm vectors are
maximally distant), `Metric::Dot` (negated dot product — larger dot sorts
first), `Metric::L2` (squared Euclidean). The index is built per metric;
`vector_search` with a different metric than the index falls back to the
exact path rather than answering with the wrong metric.

## Behavior contract

- **Exact distances in results.** Indexed (ANN) hits are reranked with exact
  metric distances recomputed from the stored documents — quantized internal
  distances (Hamming counts, reconstruction approximations) never leak into
  `Hit.score`. Metric-unit thresholds (like the
  [semantic cache](/language/semantic-cache/)'s) stay meaningful under any
  index mode.
- **Documents are the source of truth.** Dimension mismatches skip documents
  (and the index falls back to exact for the mismatched query dimension);
  overwriting a vector with a different dimension tombstones the old node
  first — ANN results never resurrect stale keys.
- **Filtered queries run exact by default.** `.approx()` opts into the
  over-fetch-then-filter ANN path (see
  [the query builder](/language/query-builder/)). Unfiltered vector sources
  use the index whenever present.
- **Duplicate re-creation replaces** the index with new parameters in one
  transactional reset; same-parameter re-creation rebuilds from scratch too
  (never resumes a stale partial backfill).
- **Tombstone hygiene.** On-disk indexes compact automatically when
  tombstones exceed a third of the index (`dead * 2 > live`) — expect a
  synchronous rebuild burst on the write that crosses the threshold. Between
  compactions, over-fetch scales with the tombstone count so recall does not
  decay.

## HNSW parameters

The in-memory graph exposes the direct API (`corvid::Hnsw`) with
`DEFAULT_M` / `DEFAULT_EF_CONSTRUCTION` and `with_params` /
`with_quant` / `with_pq` constructors for advanced control; collection-level
constructors use the defaults, which the pinned corpora validate for recall.

Next: [quantization](/indexes/quantization/).
