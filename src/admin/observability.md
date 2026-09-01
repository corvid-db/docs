---
title: Observability
description: Observing corvid — the tracing feature's event inventory (plan shapes, backfill, compaction, semantic cache), explain/plan_shape introspection, and counters via subscribers.
sidebar:
  order: 6
---

corvid observability has three layers, none requiring a server:

1. **Query introspection** — `explain()` / `plan_shape()` / `plan()` (always
   on).
2. **Structured events** — the `tracing` cargo feature (see
   [feature flags](/admin/features/)).
3. **Counters via subscribers** — aggregate the events; no metrics-export
   subsystem (deliberate non-goal).

## Query introspection

```rust
# use corvid::{Db, field};
# let db = Db::open_in_memory()?; let docs = db.collection("docs");
let mut q = docs.query().filter(field("a").exists());
let plan = q.explain()?;        // human-readable, pinned to the real decision
let shape = q.plan_shape()?;    // PlanShape enum
# let _ = (plan, shape);
# Ok::<(), corvid::Error>(())
```

`PlanShape` labels what drove the candidate set: `AnnIndex`,
`TextIndex`, `IndexedWindow`, `SortIndex`, `StreamingTopK`, `Scan`.
`QueryPlan` (via `plan()`) is identity-hashable — key a `PlanCache` on it to
cache prepared per-shape work (never results).

## The `tracing` event inventory

With `features = ["tracing"]`, these events fire (target `corvid`):

| Event | Carries |
|---|---|
| Index backfill spans | collection, index family (scalar/compound/text/geo/vector), page size, cursor progress; completion event with page count |
| Compactions (in-memory + on-disk) | dead/live trigger math on the actual crossing, rebuild outcome |
| Lazy index-build resume / adjacency rebuild | including whether the marker was absent or stale-shaped |
| Plan-shape selection (one per query) | which arm drove candidates + candidate count |
| Order-index walk tail scan | the on-exhaustion fallback |
| Edge-cascade rebuild fallback | corrupt adjacency row recovery |
| Semantic cache | hit/miss with the deciding distance |

Two deliberate label divergences from `PlanShape`:
`indexed_window` events carry no family discriminator (the
scalar/compound/geo/or kind is `plan_shape()`'s to report), and `stream_scan`
is finer than `PlanShape::Scan` (it splits the bounded streaming filter pass
from the materializing fallback).

## Counters

A subscriber aggregating `plan_shape` per shape **is** the index-probe
counter per shape; `semantic_cache_hit`/`semantic_cache_miss` subscribers are
the cache-hit-rate counters. Deferred (with triggers): plan-cache hit
counters (`PlanCache` is host-side state — the engine sees no traffic to
count) and any metrics-export subsystem.

## What there isn't

No `.profile()` (the events above carry what a profiler would; reopens only
if a need outgrows them), no metrics export, no server to poll. The engine
is a library — your process's observability stack is the stack.

Next: [the MCP sidecar](/admin/mcp/).
