---
title: "Indexes: choosing"
description: The corvid index families at a glance — scalar, compound, text, geo, vector — what each accelerates, storage characteristics, and the decision table for when to create which.
sidebar:
  order: 0
---

All corvid indexes are **derived**: maintained inside the write transaction,
never stale at query time, rebuilt from documents on re-creation, persisted
across reopen. You never change a query to use an index — the builder probes
every serviceable index and drives on the smallest candidate set, verifying
candidates against the exact predicate, falling back to a bounded scan when
nothing helps.

## The families

| Family | Constructor | Accelerates | Storage |
|---|---|---|---|
| Scalar | `create_scalar_index(field)` | equality/range filters, counts, `order_by` walks | on disk, persists |
| Compound | `create_compound_index(&["a","b"])` | prefix-equality + trailing range across fields | on disk, persists |
| Text | `create_text_index(field)` / `create_text_index_ondisk(field)` | BM25 `text_search`, `phrase_search`, builder text sources | in-RAM (rebuilt on open) or on disk |
| Geo | `create_geo_index(field)` | radius / bbox / `within_km` / `geo_nearest` | on disk, persists |
| Vector | `create_vector_index*(field, metric, ...)` | `vector_search`, builder vector sources | in-RAM HNSW (rebuilt on open) or on disk |

Deep dives: [scalar & compound](/indexes/scalar/), [text](/indexes/text/),
[geo](/indexes/geo/), [vector](/indexes/vector/), and
[quantization](/indexes/quantization/) for the compression paths.

## Choosing

Decide by query shape first, scale second:

- **Equality/range on one field** (`eq`, `between`, `gt`, `starts_with`) →
  scalar index on that field.
- **Equality on a leading field + range on the next** (e.g. `tenant = X AND
  ts BETWEEN a AND b`) → compound index `["tenant", "ts"]`.
- **Keyword/phrase search** on a body of text → text index; in-RAM up to
  ~100k–1M docs, on-disk above (bounded memory, persists).
- **Radius / bbox / nearest** around points → geo index.
- **Vector similarity** past ~100k docs (exact scan is the correct baseline
  below that) → HNSW. In-memory until it doesn't fit in RAM, on-disk beyond;
  add [quantization](/indexes/quantization/) when footprint matters more than
  the last margin of recall.

Rules of thumb from the engine's measurements:

- The scalar index takes a selective equality filter on 1M docs from a
  ~662 ms scan to ~3 ms (see [performance](/performance/scaling/)).
- An index never changes results — only the plan (`explain()` reports
  `IndexedWindow` vs `Scan`). Unselective predicates decline to the scan by
  design (candidate caps).
- Indexes cost write amplification: every write maintains every index. Index
  what you filter on, not what you store.

## Maintenance invariants

- **Definitions persist** across reopen; on-disk index state persists with
  them (no rebuild). In-RAM indexes (in-memory HNSW, in-RAM text) rebuild
  lazily on first use after open.
- **Creation is crash-safe**: an interrupted create resumes on the next query
  — queries never serve a partially built index (exact fallbacks cover the
  gap; see [maintenance](/indexes/maintenance/)).
- **Re-creating replaces**: calling a `create_*` again (same or different
  parameters) rebuilds the index in one transactional reset.
- Indexes are never listed as collections and never appear in dumps as data —
  dumps carry the *definitions* and rebuild on load.

Next: [scalar and compound indexes](/indexes/scalar/).
