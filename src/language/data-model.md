---
title: Data model
description: The corvid data model — databases, collections, keys, documents, and the derived-index invariant that keeps every index consistent with the documents.
sidebar:
  order: 0
---

corvid's data model is deliberately small: one database, named collections of
documents, byte keys, and typed values. Everything else — indexes, graph
edges, TTL, schemas — is derived from or attached to that core.

## The `Db`

A [`Db`](https://corvid-db.github.io/corvid/api/corvid/struct.Db.html) is one
embedded database file (or an in-memory instance):

```rust
use corvid::Db;

let db = Db::open("app.corvid")?;   // file-backed; created if absent
let db = Db::open_in_memory()?;      // ephemeral
```

- Open it **once** and share it. `Db` is `Send + Sync`; wrap in `Arc` for
  threads. A second handle to the same file fails on the storage engine's
  exclusive lock.
- Writes are durable per-transaction — there is no explicit flush or close.
- The concurrency model is **single writer, concurrent readers** (MVCC):
  writes serialize database-wide; queries run against point-in-time
  snapshots.

## Collections

A **collection** is a named namespace of documents:

```rust
let docs = db.collection("docs");
```

- Created lazily on first write — `collection()` itself never fails for name
  reasons; invalid names surface at write time with the exact error.
- Names must not start with `__` (engine-reserved, `Error::ReservedCollection`),
  contain an interior `__` sequence, or contain a NUL byte
  (`Error::InvalidName`). The empty name is legal.
- `db.collections()` lists user collection names (engine namespaces
  excluded), in name order. A collection that was never written may not
  appear — creation is lazy.

## Keys

A **key** is arbitrary bytes (`&[u8]`) up to any length the storage engine
accepts; documents are ordered by key byte order. The empty key is legal and
sorts first. `insert_auto` generates zero-padded 20-digit monotonically
increasing keys per collection.

## Documents

A **document** is a [`Value`](/language/values/) — usually a `Value::Map`.
Documents are schemaless by default: different documents in one collection
may have different shapes. An optional [schema](/integrity/schema/) enforces
field types, required fields, and unique constraints on write.

Field paths in filters, index definitions, and `select` are **dotted** and
traverse nested maps: `"meta.author"` resolves `doc["meta"]["author"]`. Paths
traverse maps only — arrays are never indexed into by path.

## The derived-index invariant

The design commitment that shapes everything else:

> Every secondary index reflects the same committed state as the documents,
> at the same MVCC version.

Consequences you can rely on:

- **Indexes are never stale at query time.** Index maintenance happens inside
  the write transaction that changes the documents. A query never sees a
  document set and an index that disagree.
- **Documents are the source of truth.** An index definition is derived
  state: re-creating an index rebuilds it from the documents, and a corrupt
  on-disk index errors loudly (`Error::CorruptIndex`) instead of silently
  serving empty results.
- **Query results never depend on which indexes exist.** The builder picks
  whatever index is most selective, and verifies candidates against the exact
  predicate. `explain()` tells you which path served a query; the rows are
  the same either way.

## Where state lives

| Kind of state | Where |
|---|---|
| Documents | user collections |
| Index definitions + on-disk index state | engine-reserved `__` namespaces |
| Graph edges | reserved edge namespaces (derived adjacency, mirrored) |
| TTL expiries | reserved TTL namespaces |
| Schemas | reserved schema namespaces |

All of it persists across reopen; [dump/load](/admin/dump-load/) carries
documents, definitions, edges, TTL, schemas and auto-id counters as one
logical, version-stamped stream.

Next: the [`Value` type](/language/values/) and
[writing documents](/language/writes/).
