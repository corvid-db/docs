---
title: The numbers
description: corvid's measured baseline — the full criterion suite (encode/decode, HNSW build/search, PQ, BM25 exact vs indexed, distance kernels, edge churn, delete-heavy, windows, order walks) with deltas and provenance.
sidebar:
  order: 1
---

All numbers: Apple M1 Max, criterion, deterministic corpora — means with 95%
CI unless noted. Single-machine: compare relatively. Method and caveats on
[the previous page](/performance/overview/).

## Current full-suite baseline (2026-08-31)

| Bench | Mean | 95% CI |
|---|---|---|
| value_encode | 409.44 ns | [408.99, 411.51] |
| value_decode | 872.73 ns | [872.36, 876.42] |
| hnsw_build_2k_64d | 125.92 ms | [125.73, 126.11] |
| hnsw_search_2k_64d | 19.04 µs | [18.97, 19.10] |
| hnsw_build_pq_2k_64d | 365.69 ms | [363.03, 369.07] |
| hnsw_search_pq_2k_64d | 37.79 µs | [36.85, 39.14] |
| pq_train_2k_64d (parallel) | 64.93 ms | suite context |
| pq_train_10k_128d (parallel) | 381.68 ms | suite context |
| bm25_exact_2k | 8.033 ms | [7.968, 8.143] |
| bm25_indexed_2k | 490.10 µs | [483.54, 498.24] |
| dot_768d | 81.07 ns | [80.42, 81.68] |
| l2_768d | 84.26 ns | [82.48, 84.98] |
| cosine_768d | 224.29 ns | [220.86, 231.60] |
| edge_link_10k | 392.98 ms | suite context |
| edge_delete_sweep_100 | 49.70 ms | suite context |
| delete_heavy/delete_half_2p5k | 230.39 ms | suite context |
| delete_heavy/insert_unique_scalar_5k | 185.72 ms | suite context |
| compound_prefix_scan/eq_leading_only_5k | 251.09 µs | suite context |
| selective_window_verify/eq_50_of_5k | 236.20 µs | suite context |
| selective_window_verify/eq_500_of_5k | 619.56 µs | suite context |
| order_by_indexed_5k/asc_limit20 | 312.61 µs | suite context |
| order_by_indexed_5k/desc_limit20 | 1.009 ms | suite context |
| create_text_index_ondisk_5k | 230.22 ms | suite context |
| create_vector_index_ondisk_2k_8d | 402.82 ms | suite context |

Named deltas vs the prior baseline: `bm25_exact_2k` +5.0% (the CJK-aware
tokenize pass on a latin corpus — documented residual, inside the guard);
the delete/edge family sits above its recorded isolated AFTERs (the
suite-vs-isolated context gap, unchanged code, isolated re-probes confirmed);
`value_decode` +3.0% and the distance kernels +1–5% are ambient machine
drift. **No regression attributable to code; the guard holds.**

## The optimization program's headline deltas

Each row's BEFORE is the recorded pre-change baseline (provenance in the
engine's BENCHES.md; conventions on the
[overview](/performance/overview/)).

**Verify-candidates batching** (dense indexed windows verify with one
ordered walk instead of per-key point-gets):

| Bench | BEFORE | AFTER | Δ |
|---|---|---|---|
| eq_500_of_5k (10% density) | 745.14 µs | 576.25 µs | **−22.7%** |
| eq_50_of_5k (1% density) | 221.21 µs | 229.82 µs | +3.9% (point-gets kept; within guard) |

**Sort indexes** (filterless `order_by` over a complete scalar index):

| Bench | BEFORE | AFTER | Δ |
|---|---|---|---|
| asc_limit20 | 2.642 ms | 289.5 µs | **−89.0%** |
| desc_limit20 | 2.795 ms | 1.024 ms | **−63.4%** |

**Compound prefix-only windows** (the `all_docs_indexed` flag):

| Bench | BEFORE | AFTER | Δ |
|---|---|---|---|
| eq_leading_only_5k | 1.540 ms | 232.41 µs | **−84.9% (6.6×)** |

**Edge adjacency** (O(degree) delete cascades via endpoint-first derived
namespaces):

| Bench | BEFORE | AFTER | Δ |
|---|---|---|---|
| edge_delete_sweep_100 | 241.0 ms | 40.5 ms | **~5.9× — O(degree) vs O(E)** |
| delete_half_2p5k | 566.8 ms | 194.5 ms | **~2.9×** |
| edge_link_10k | 273.5 ms | 359.4 ms | **+40% — RATIFIED** |

The ratified trade: two extra rows per link buy O(degree) cascades — deletes
were the workload-blocking hazard. The alternative shapes (consolidated
per-endpoint values, pure-lazy adjacency) were measured and rejected with
numbers.

**Parallel PQ training** (identical codebooks, bit-for-bit):

| Bench | Sequential | Parallel | Δ |
|---|---|---|---|
| pq_train_2k_64d | 177.2 ms | 67.4 ms | **2.6×** |
| pq_train_10k_128d | 1465.0 ms | 356.2 ms | **4.1×** |

**Graph reads, endpoint-direct** (parity verdict — kept for the shared
layout, not speed):

| Bench | BEFORE | AFTER | Δ |
|---|---|---|---|
| hub_out_knows (313 rows) | 37.08 µs | 37.12 µs | +0.1% |
| hub_in_knows | 29.58 µs | 29.96 µs | +1.3% |
| traverse_hub_2hops | 570.5 µs | 581.4 µs | +1.9% |

Next: [scaling](/performance/scaling/).
