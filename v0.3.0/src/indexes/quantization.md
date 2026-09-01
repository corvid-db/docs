---
title: Vector quantization
description: Binary, Scalar and Product Quantization for corvid vector indexes — compression ratios, time premiums, recall margins and the guidance for choosing a mode.
sidebar:
  order: 5
---

Quantization trades footprint (and some time) for the last margin of recall.
All three modes serve every metric on both the in-memory and on-disk indexes,
and all keep the public contract: results are reranked with exact distances.

| Mode | Footprint (asymptotic) | Time | Notes |
|---|---|---|---|
| `Quantization::None` | `dim × 4` bytes/vector | baseline | exact graph, full f32 |
| `Quantization::Binary` | 1 bit/dim (sign) | **fastest at volume** | Hamming kernel; ~32× smaller; the throughput lever |
| `Quantization::Scalar` | 8-bit/dim + 8-byte header | slower than None at some dims | ~4× smaller; per-eval reconstruction can cost more than it saves at low dim |
| PQ (`m, k`) | `m` code bytes/vector | build 2.9×, search 1.9× | trained codebook; 16× at 64d with `m=16, k=256` |

```rust
# use corvid::{Db, Metric, Quantization};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
c.create_vector_index_ondisk_quantized("embedding", Metric::Cosine, Quantization::Binary)?;
c.create_vector_index_ondisk_pq("embedding", Metric::Cosine, 16, 256)?;
# Ok::<(), corvid::Error>(())
```

## Product quantization in detail

PQ trains a deterministic per-subspace codebook (k-means, parallelized since
v0.2) from a bounded sample of existing vectors, stores each vector as `m`
code bytes, and persists the codebook in the index's namespace — after a
reopen, the lazily rebuilt in-memory graph re-encodes under the **same**
codebook. Dump/load round-trips the index as a vector mode carrying `m`/`k`.

- L2 scores through the asymmetric-distance computation (ADC — the fast
  path); cosine and dot score through reconstruction (decode + metric).
- Constraints: `dim % m == 0`, `k ∈ 2..=256`, and training requires usable
  vectors (`Error::EmptyIndexTraining` otherwise).
- Time premiums on the pinned 2000×64d corpus (`m=16, k=256`): build
  367.9 ms vs 124.9 ms full precision (2.9×); search 35.8 µs vs 19.1 µs
  (1.9×). Training itself: ~67 ms at 2000×64d, ~356 ms at 10000×128d.

## Recall margins (measured, pinned)

| Corpus | Measured recall | Pinned floor |
|---|---|---|
| Public path (`vector_search`, clustered corpus, over-fetch + exact rerank) | **1.0** | ≥ 0.7 |
| Direct HNSW API unit corpus (ef 100/200/400) | 0.56 (identical at all ef) | ≥ 0.55 |

The public path's over-fetch plus exact rerank recover the full top-k; the
residual gap on the direct API is codebook resolution, not graph reach.

## Guidance

1. **Default to `None`** until footprint or throughput forces a choice.
   Exact search is OOM-free and correct at any scale; indexes are for speed.
2. **Volume scans → Binary.** On a 2000×768d corpus, the packed-byte Hamming
   path searches **50.8× faster** than full precision (~32× less traffic and
   a cheaper kernel) — the measured throughput lever for large corpora.
3. **RAM/disk budget → PQ.** The smallest footprint; accept the 2–3× build
   and ~2× search premiums and validate recall on *your* corpus (recall
   depends on data distribution; pinned corpora are the engine's, not yours).
4. **Scalar** when you want a middle compression without a training step —
   but measure: at 768d its per-evaluation decode can make it *slower* than
   full precision (306.8 µs vs 239.8 µs on the pinned scan corpus).
5. Whatever the mode, **exact rerank keeps scores trustworthy**; only the
   candidate set is approximate. If a workload needs the exact top-k under a
   threshold, keep `None` or validate recall empirically.

All numbers above: Apple M1 Max, criterion means, deterministic corpora —
single-machine, compare relatively. Full provenance in
[performance](/performance/quantization-guidance/).

Next: [on-disk vs in-memory](/indexes/on-disk/).
