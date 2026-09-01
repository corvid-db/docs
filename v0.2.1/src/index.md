---
title: corvid documentation
description: Canonical documentation for corvid — an embedded, multi-modal data store for AI applications. Vector search, full-text search, filters, rank fusion, graph, geo and TTL behind one in-process query builder.
template: splash
hero:
  tagline: One embedded engine. Vector, text, filter, fusion — one query builder call.
  actions:
    - text: Get started
      link: tutorial/first-database/
      icon: right-arrow
      variant: primary
    - text: Install
      link: start/install/
      icon: download
    - text: The C ABI
      link: ffi/overview/
      icon: external
---

**corvid** is an embedded, multi-modal data store for AI applications. One
in-process dependency does vector search, full-text search, metadata filtering,
and rank fusion — composed into a single fluent call instead of three services
glued together in application code.

```rust
use corvid::{Db, Metric, Value, field};

let db = Db::open("memory.corvid")?;
let docs = db.collection("docs");

let mut doc = std::collections::BTreeMap::new();
doc.insert("category".into(), Value::Text("blog".into()));
doc.insert("body".into(), Value::Text("rust embedded database design".into()));
doc.insert("embedding".into(), Value::Vector(vec![0.1, 0.9, 0.2]));
docs.insert(b"post-1", &Value::Map(doc))?;

// Hybrid query: filter + vector + text, fused and reranked, in one call.
let rows = docs
    .query()
    .filter(field("category").eq(Value::Text("blog".into())))
    .vector("embedding", vec![0.1, 0.9, 0.2], 100, Metric::Cosine)
    .text("body", "rust embedded database", 100)
    .rerank_mmr(0.7)
    .limit(10)
    .run()?;
# Ok::<(), corvid::Error>(())
```

The filter runs *before* ranking, so it is a true predicate — the top-k is
computed among matching documents, never a post-hoc trim.

## Where to go next

- **New to corvid?** The [tutorial](/tutorial/first-database/) walks from
  install through your first database to the hybrid query walkthrough.
- **Writing queries?** [The corvid language](/language/data-model/) covers the
  data model, the query builder, filters, aggregations, ordering and pagination.
- **Choosing indexes?** The [indexes](/indexes/overview/) section explains every index
  family — scalar, compound, text, geo, vector (HNSW, quantization, PQ) — and
  when each serves.
- **Coming from C, Node, or another language?** Start at [bindings](/bindings/overview/);
  the [C ABI](/ffi/overview/) is the frozen contract every binding codes against.
- **Operating a deployment?** [Administration](/admin/open-close/) covers
  backup, dump/load, compaction, bulk load, feature flags and observability.

## What corvid is — and is not

corvid is a personal experiment, built in the open: the engine has 1,000+
tests across four feature configurations, >96% line coverage, and a
correctness-first design (filters are true predicates, indexes are never
stale, writes are transactional). It is pre-1.0: the API and on-disk format
change freely until 1.0, with `dump`/`load` as the migration path — never a
silent format change.

Permanent non-goals: SQL, networking/replication in the engine, distributed
transactions, a hosted service.

## About these pages

This site is the canonical corvid documentation. Two generated reference
pages — the [construct reference](/reference/constructs/) and the
[error codes](/reference/error-codes/) — are synced from the engine's
conformance manifests at each release; everything else is hand-maintained
prose. Versioned snapshots live under `/vX.Y.Z/`; see
[About these docs](/about/) for the versioning mechanism.
