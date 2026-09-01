---
title: Scaling characteristics
description: How corvid scales — measured operation times at 1k/100k/1M, what holds constant or bounded to 50M, and the walls the on-disk and scalar index families remove.
sidebar:
  order: 2
---

From the engine's scaling example (file-backed, 16-dim embeddings), after
the streaming/index optimizations. One machine — the point is the *shape*:

| Operation | 1k | 100k | 1M | memory |
|---|---|---|---|---|
| batch insert | ~16 ms | ~0.6 s | ~4.9 s | bounded (per batch) |
| `count()` (no filter) | µs | µs | ~12 µs | O(1) — maintained counter |
| point `get` | µs | ~15 µs | ~22 µs | O(1) |
| filtered `count` / `group_count` | <1 ms | ~55 ms | ~0.55 s | **constant** (streamed) |
| `order_by` + `limit` | ~1 ms | ~0.13 s | ~0.58 s | **bounded** (≈ page size) |
| `text_search` (indexed) | µs | µs | µs | — (after build) |
| HNSW build (in-memory) | — | ~15 s | minutes | in-RAM |

## What scales

**Constant or bounded memory, O(1)/O(n) time** — these hold at 50M
(slower, but no OOM):

- storage and point operations,
- `count`/`len` (O(1) maintained counters),
- streamed aggregates (constant memory, linear time),
- ordered pagination and keyset [cursors](/language/pagination/),
- the bounded-heap exact vector search (streamed).

## The walls at 1M–50M — and what addresses each

**In-memory index build/rebuild.** The in-memory HNSW and inverted index
live in RAM and rebuild on open; at 1M the HNSW build is minutes, at 50M
they don't fit. → The [on-disk variants](/indexes/on-disk/)
(`create_vector_index_ondisk*`, `create_text_index_ondisk`) store state as
storage records: an operation touches only what it needs, memory is bounded
by the operation, the index persists with no rebuild.

**Unindexed `filter`/`order_by`** are O(n) scans (constant memory, linear
time). → The [scalar / compound / geo indexes](/indexes/overview/) make
selective queries sub-linear; the builder picks the most selective index
and falls back to the bounded scan when none is selective enough. Scalar
example at 1M: ~662 ms scan → ~3 ms eq / ~0.5 ms for a 100-row range.

**Exact (unindexed) search** is O(n) time — correct and OOM-free (streamed),
but you want an index past ~100k. → Any [vector index](/indexes/vector/);
quantize ([binary/PQ](/performance/quantization-guidance/)) when volume
matters.

So: storage, point ops, counts, streamed aggregates, and ordered pagination
scale to 50M with bounded memory; large-scale *search* and *selective
filters* are what the index families exist for — leaving only the in-memory
index variants' RAM build as a deliberate small-scale convenience.

Next: [quantization guidance](/performance/quantization-guidance/).
