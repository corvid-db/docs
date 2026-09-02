---
title: Index maintenance
description: Index creation, crash-safe backfill with resume, re-creation semantics, automatic compaction, and corruption posture for corvid indexes.
sidebar:
  order: 7
---

## Creation

Index creation over an existing collection runs as a **persisted state
machine**: the definition is registered as `Building{cursor}`, backfill
commits page by page (progress checkpointed), and completion flips the
definition to `Complete`.

- **Queries never serve a building index** — they use exact/bounded
  fallbacks, so results are always correct during a backfill.
- **Crash or error mid-creation** leaves a resumable `Building` definition —
  no permanently partial index that queries silently trust.
- **The first query after a reopen resumes an interrupted build
  synchronously**: first-query latency can include the remaining backfill.
  (Tracing's backfill span-per-page events make the resume visible — see
  [observability](/admin/observability/).)
- On-disk backfill batches commits with a shared node cache for speed.

## Re-creation replaces

Calling any `create_*` again — for a parameter change or none — rebuilds the
index in one transactional reset:

```rust
# use corvid::{Db, Metric, Quantization};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
c.create_vector_index("v", Metric::Cosine)?;                       // original
c.create_vector_index("v", Metric::L2)?;                           // replaces + rebuilds
# Ok::<(), corvid::Error>(())
```

Same-parameter re-creation does not resume a partial backfill — it resets.
Compound indexes recompute their `all_docs_indexed` flag at completion (see
[scalar & compound](/indexes/scalar/)).

## Writes maintain everything, transactionally

Every mutation path — `insert`, `insert_batch`, `patch`, `update`,
`compare_and_set`, `delete`, `delete_where`, `delete_batch`, TTL purges —
maintains every index inside the write's transaction. The maintenance
contract is conformance-pinned per mutation kind (see the
[construct reference](/reference/constructs/)).

## Automatic compaction (on-disk vector)

On-disk vector indexes compact automatically once tombstones exceed a third
of the index (`dead * 2 > live`), checked on the write path after the commit:

- Expect a synchronous rebuild burst (write amplification) when a write
  crosses the threshold.
- Between compactions, the search's over-fetch scales by the tombstone count
  (`ef_search.max(k) + dead`) so recall does not decay as tombstones
  accumulate.
- Deleting *all* documents leaves index definitions intact (deletes never
  unregister) — one consequence: a dump of a drained PQ-indexed collection
  fails on load with `EmptyIndexTraining` (the definition replays but has no
  training vectors). Re-create the index after such a load, or drop the
  definition before dumping a drained collection.

## Corruption posture

Corrupt persisted index state surfaces loudly: `Error::CorruptIndex` with a
context string — never a silently degraded empty result. Recovery is
re-creating the index (documents are the source of truth). A corrupt derived
*adjacency* row self-heals: the engine rebuilds it from the source edge rows
and re-runs the operation.

Next: [full-text search](/fts/overview/).
