---
title: On-disk vs in-memory indexes
description: corvid's on-disk index family — bounded memory, persistence without rebuild, when to switch from in-RAM indexes, and the scaling walls each removes.
sidebar:
  order: 6
---

corvid's index families come in two storage shapes:

- **In-RAM** (in-memory HNSW, in-RAM text postings): state lives in memory,
  definitions persist, state rebuilds lazily on first use after open. Fast,
  simple, the right default up to ~100k–1M documents.
- **On-disk** (`create_vector_index_ondisk*`, `create_text_index_ondisk`,
  `create_scalar_index`, `create_compound_index`, `create_geo_index`): state
  lives as storage records. An insert or search touches only the
  nodes/postings/keys it needs, so **memory is bounded by the operation, not
  the collection**, and the index persists across reopen with no rebuild.

```rust
# use corvid::{Db, Metric};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
c.create_vector_index_ondisk("embedding", Metric::Cosine)?;
c.create_text_index_ondisk("body")?;
c.create_scalar_index("category")?;
c.create_geo_index("loc")?;
# Ok::<(), corvid::Error>(())
```

## Why it matters: the scaling walls

From the engine's measured scaling characteristics (1M documents, file-backed):

| Wall at 1M–50M | Removed by |
|---|---|
| In-memory HNSW build is minutes at 1M; doesn't fit at 50M | on-disk vector indexes |
| Unindexed `filter`/`order_by` are O(n) scans | scalar / compound / geo indexes |
| Exact (unindexed) search is O(n) time | any vector index past ~100k |

Storage, point ops, counts, streamed aggregates, and ordered pagination scale
with bounded memory regardless — the on-disk family exists for *search* and
*selective filters* at scale.

## Behavior differences to know

- **First-use latency**: on-disk indexes are ready immediately after open.
  In-RAM indexes rebuild on first use (a large collection's first query
  includes the build; tracing's backfill events make it visible).
- **Bulk backfill** of an on-disk index batches commits with a shared node
  cache — index creation over an existing corpus is checkpointed and
  resumable (see [maintenance](/indexes/maintenance/)).
- **Compaction**: on-disk vector indexes self-compact when tombstones exceed
  a third of the index; on-disk text/scalar/geo state is maintained
  incrementally (no periodic compaction needed).
- **Recall**: on-disk HNSW corpora pin recall floors (≥0.85 on-disk vs ≥0.9
  in-memory against exact-KNN twins on the engine's corpora); over-fetch
  scales with tombstone count between compactions.

Next: [index maintenance](/indexes/maintenance/).
