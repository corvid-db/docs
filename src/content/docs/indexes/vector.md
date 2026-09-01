---
title: Vector indexes
description: HNSW vector indexes in corvid — the six constructor variants, metrics, exact vs approximate behavior, Hit.approximate, dimension handling, automatic use, and the direct Hnsw/Pq APIs.
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

## The direct APIs: `Hnsw` and `Pq` without a `Collection`

Everything above manages indexes for you inside a `Collection`. The engine
also exposes the primitives directly — reach for them when your vectors do
not live in a corvid collection at all, or their lifecycle is shorter than a
stored document's. `corvid::Hnsw` is the plain in-memory graph: a
build-once, search-many structure over `Vec<f32>` you own, with no storage,
persistence, or documents attached — e.g. clustering/deduplicating a batch
of candidate embeddings at query time, or prototyping recall/latency
trade-offs before committing to an index configuration. `corvid::pq::Pq` is
the trained product quantizer on its own: encode vectors to `m` bytes and
keep the codebook (`to_bytes`/`from_bytes`) wherever you like — shards,
files, network messages — scoring codes against a query yourself, with the
same compression the collection-level PQ indexes use.

```rust
use corvid::{Hnsw, Metric};
use corvid::pq::Pq;
use std::sync::Arc;

// Hnsw: insert returns a stable id; search returns (id, distance), nearest first.
let mut g = Hnsw::new(Metric::Cosine);
let ids: Vec<usize> = (0..1000).map(|i| g.insert(vec![i as f32 / 1000.0, 1.0])).collect();
let _ = g.search(&[0.5, 1.0], 10, 100);          // top-10, ef_search = 100

// Pq: train on a sample, encode each vector to m bytes, score against a query.
let sample: Vec<Vec<f32>> = (0..512).map(|i| vec![i as f32, 1.0]).collect();
let pq = Pq::train(&sample, 1, 16).expect("m divides dim, sample big enough");
let code = pq.encode(&[3.0, 1.0]);               // 1 byte per vector
let d = pq.distance(Metric::L2, &[3.0, 1.0], &code);  // reconstruct-then-distance
let _ = Arc::new(pq);                             // Hnsw::with_pq takes Arc<Pq>
let _ = (ids, d);
```

Notes: `Hnsw::search`'s `ef_search` widens the beam (raised to at least
`k` — larger is more accurate, slower); `Hnsw::with_pq(metric, Arc<Pq>, m,
ef_construction)` builds a graph over PQ codes exactly like the collection
index (L2 via the asymmetric-distance table, cosine/dot via
reconstruction). `Pq::train` is deterministic for a fixed sample and
returns `None` on unusable parameters (empty sample, `dim` not divisible by
`m`, `k` outside `2..=256`); the distance helpers (`Pq::distance`,
`Pq::l2_table`/`adc_l2`) are covered in the
[constructs reference](/reference/constructs/).

Next: [quantization](/indexes/quantization/).
