---
title: Glossary
description: Definitions of corvid's terms — adjacency, ANN, backfill, candidate superset, CAS, class order, derived index, golden fixtures, keyset pagination, MVCC, PQ, RRF, MMR, tombstone and more.
sidebar:
  order: 2
---

A working glossary of terms used across these docs.

**adjacency** — the derived, endpoint-first re-keying of graph edges into
private `__adj_out__`/`__adj_in__` namespaces so deletes cascade in
O(edges-of-document) and neighbor reads are direct. Invisible: never listed,
never dumped.

**ANN (approximate nearest neighbor)** — vector search served by an HNSW
graph index instead of an exact scan. Candidates are approximate; scores are
reranked exact. See `Hit.approximate`.

**backfill** — the process of building an index over an existing collection,
committed page by page with a persisted cursor (`Building{cursor}` →
`Complete`) so an interrupted creation resumes and queries never serve a
partial index.

**candidate superset** — what an index window returns: a set guaranteed to
contain every match (encoding ties may add extras); the builder re-checks
each candidate against the exact predicate, so results are always exact.

**CAS (compare-and-set)** — an atomic conditional write: apply only if the
stored value equals `expected` (or is absent). Uses semantic value equality.

**change event** — an `Insert`/`Delete` notification delivered synchronously
post-commit to subscribers; the engine has no separate event log.

**class order (ordering)** — `order_by`'s fixed row classes: comparable
values (numbers, then texts) → incomparable values → rows missing the field;
ties by key; `descending` reverses within the comparable class only.

**collection** — a named namespace of documents, created lazily on first
write; `__`-prefixed names are engine-reserved.

**compound index** — an index over an ordered field list serving
prefix-equality plus at most one trailing range; carries the
`all_docs_indexed` flag that gates prefix-only acceleration.

**corvid** — the engine. Corvid = crows/ravens: eat anything, highly
intelligent, cache food across thousands of remembered locations.

**cursor** — an opaque byte token resuming a keyset page walk strictly after
the last served key. Also the general term for the ABI's `_next`-driven
iterators.

**derived index** — an index maintained transactionally from the documents
(the source of truth). Never stale at query time; re-creatable; corrupt
state errors loudly.

**dump** — the logical, version-stamped export stream (`CORVIDDUMPv1`/`v2`)
carrying documents plus definitions; the migration path across format
breaks. `load` (and `load_with_renames`) replay it.

**exact baseline** — vector/text search without an index: brute-force
streamed scoring. Correct at any scale (OOM-free); the default until you
create an index.

**fused score** — the reciprocal-rank-fusion score of a row
(`Σ 1/(k + rank)` across sources); `0.0` for pure filter/order queries.

**golden fixtures** — the 256-line fixture suite pinning ABI-observable
behavior (NaN/±inf/−0.0, cursors, unique violations, geo boundaries,
persistence); every binding replays it in CI.

**HNSW** — Hierarchical Navigable Small World: the graph index behind all
corvid vector indexes, in-RAM or on-disk, optionally quantized/PQ.

**keyset pagination** — walking a collection by cursor instead of offset:
each page returns rows plus the resume point; O(limit) per page regardless
of depth.

**MVCC** — multi-version concurrency control: readers get point-in-time
snapshots and never block (or get blocked by) the single writer.

**MMR (maximal marginal relevance)** — a rerank trading relevance for
diversity; `lambda ∈ [0,1]` (1 = pure relevance, 0 = maximal diversity).

**PQ (product quantization)** — compressing vectors to `m` code bytes via a
trained per-subspace codebook; the smallest footprint (e.g. 16× at 64d,
m=16), scored via ADC (L2) or reconstruction.

**predicate** — a filter tree over dotted field paths; a **true predicate**
runs before ranking (the top-k is computed among matches).

**purge** — the TTL deletion step (`purge_expired(now)`): expired records
stay visible until you call it; the engine keeps no clock.

**quantization** — storing vectors lossily-compressed: Binary (1 bit/dim,
~32×, Hamming), Scalar (8-bit + header, ~4×), or PQ.

**RRF (reciprocal rank fusion)** — merging ranked lists by
`Σ 1/(k + rank)`; corvid's default constant is 60.

**scalar index** — order-preserving keys making equality/range filters,
counts, and order walks sub-linear.

**schema** — an optional per-collection declaration of field
types/required/unique constraints, enforced on write.

**semantic cache** — a vector-keyed cache: nearest embedding within a
threshold answers; distance units follow the metric.

**snapshot** — the MVCC point-in-time view behind every query, page, join,
traverse, and dump; one query = one committed state.

**tombstone** — a delete marker inside an on-disk index; over-fetch scales
with tombstone count, and compaction triggers when they exceed a third of
the index.

**true predicate** — see *predicate*.

**wave 4** — the audit-remediation wave that tightened name validation
(interior `__`, NUL); pre-wave-4 dumps migrate via `load_with_renames`.
