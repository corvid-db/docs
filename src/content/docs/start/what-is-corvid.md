---
title: What is corvid?
description: corvid's design in one page — an embedded multi-modal store with a fluent builder API, one transactional core, and no SQL, networking, or serialization on the query path.
sidebar:
  order: 0
---

corvid is an **embedded** database: a Rust library linked into your process,
not a server. There is no network protocol, no connection string, no daemon.
You open a file (or an in-memory instance), get a handle, and share it across
threads.

What makes it *multi-modal* is that the three things AI applications usually
assemble from separate systems — a vector database, a full-text engine, and a
metadata store — live behind **one engine and one query builder**, updated in
**one transaction**:

> Every secondary index reflects the same committed state as the documents, at
> the same MVCC version.

That invariant is the project's central commitment. It is why a hybrid query
in corvid never sees a stale index, and why a filter is a true predicate rather
than a post-ranking trim.

## The shape of the API

There is no SQL and no JSON on the query path. Documents are typed `Value`s
(maps, arrays, scalars, bytes, and first-class dense vectors), and queries are
built with chained method calls:

```text
filter → vector source → text source → fuse (RRF) → rerank (MMR)
       → order_by → offset → select → limit → run
```

Each source is a retrieval candidate generator; the builder fuses and reranks
them and applies shaping. Zero sources gives a pure filter/scan query.

## What's inside

| Capability | Since |
|---|---|
| Transactional KV storage (redb), atomic multi-op transactions | v0.1.0 |
| Typed values + documents (embeddings first-class) | v0.1.0 |
| Vector search (cosine / dot / L2), exact baseline + HNSW | v0.1.0 |
| Full-text search (BM25) with CJK bigram tokenization | v0.1.0 |
| Hybrid fusion (RRF) and diversification (MMR) | v0.1.0 |
| Scalar, compound, text, geo, and on-disk indexes | v0.1.0 |
| Vector quantization: binary, scalar, product (PQ) — in memory and on disk | v0.1.0 / v0.2.x |
| Directed property graph (`link`/`neighbors`/`traverse`) | v0.1.0 |
| Geo radius / bbox / k-nearest | v0.1.0 |
| TTL, schemas with unique constraints, reactive change feeds | v0.1.0 |
| Probabilistic sketches (HLL, Bloom, cuckoo, t-digest, MinHash + LSH) | v0.1.0 / v0.2.x |
| Online backup, dump/load migration (format v2), compaction | v0.1.0 |
| MCP sidecar (`corvid-mcp`) over stdio | v0.1.0 |
| C ABI (`corvid-ffi`): 122-symbol typed cdylib + generated `corvid.h` | v0.2.0 |
| Optional zstd compression and tracing instrumentation (cargo features) | v0.2.x |

## What corvid deliberately is not

- **No SQL, ever.** The fluent builder is the only entrypoint; a SQL parser
  would drag in ANSI semantics the design does not want.
- **No networking in the engine.** Replication, wire protocols, and servers
  are permanent non-goals. (The separate `corvid-mcp` sidecar speaks MCP over
  stdio — a subprocess, not a listener.)
- **No embedding models.** You embed in your application (CLIP, sentence
  transformers, anything); corvid stores and searches the resulting vectors.
- **No backward compatibility before 1.0.** A format change is migrated with
  [`dump`/`load`](/admin/dump-load/) — old files are refused, never silently
  misread.

## The projects around the engine

| Crate / repo | Role |
|---|---|
| [`corvid`](https://github.com/corvid-db/corvid) | The engine itself (Rust library) |
| `corvid-mcp` | MCP sidecar exposing a store to agentic tools |
| `corvid-ffi` | The C ABI — `libcorvid.so` / `.dylib` / `corvid.dll` + `corvid.h` |
| [`corvid-c`](https://github.com/corvid-db/corvid-c) | Reference C consumer (release-artifact conformance) |
| [`corvid-node`](https://github.com/corvid-db/corvid-node) | Node.js binding (native, OOP API) |

See [bindings](/bindings/overview/) for the full ecosystem, including planned bindings.

Ready? Continue to [install](/start/install/), or jump straight into the
[tutorial](/tutorial/first-database/).
