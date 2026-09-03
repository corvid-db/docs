---
title: Opening and closing
description: Db lifecycle in corvid — open, open_in_memory, the exclusive file lock, collection listing, and what persists across reopen.
sidebar:
  order: 0
---

```rust
use corvid::Db;

let db = Db::open("app.corvid")?;       // file-backed; created if absent
let db = Db::open_in_memory()?;          // isolated ephemeral instance
```

## `Db::open`

- Creates the file (and parent expectation: a missing parent directory is an
  error, not an implicit mkdir).
- Takes the storage engine's **exclusive lock**: a second `Db` handle to the
  same file in the same or another process fails with `Error::Database`. One
  file, one handle, one process.
- Refuses incompatible files via the on-disk format marker
  (`Error::IncompatibleFormat`) — an old file is never silently misread;
  migrate with [dump/load](/admin/dump-load/).

## `Db::open_in_memory`

A purely in-memory instance — isolated from every other instance (including
other in-memory ones), gone when dropped. Useful for tests, caches, scratch
state.

## Closing

There is no explicit close: persistence is durable **per transaction**, so
dropping the handle (or exiting the process) is safe at any point. `Db` is
`Send + Sync` — share it behind an `Arc` across threads; writes serialize on
the storage engine's single-writer lock, readers get MVCC snapshots.

## What persists

Reopening a file restores everything:

- documents, in every user collection,
- [index definitions and on-disk index state](/indexes/overview/) (on-disk
  families are ready with no rebuild; in-RAM families rebuild lazily),
- [schemas](/integrity/schema/), [TTL entries](/integrity/ttl/),
  [graph edges](/graph/overview/) and their adjacency, auto-id counters.

## Listing collections

```rust
# use corvid::{Db};
# let db = Db::open_in_memory()?;
let names = db.collections()?;   // Vec<String>, user collections in name order
# let _ = names;
# Ok::<(), corvid::Error>(())
```

Engine-reserved `__` namespaces (edges, TTL, index definitions, adjacency)
are excluded — you see exactly your collections. A collection that was never
written may not appear (creation is lazy, on first write).

## The MCP and binding surfaces

The same lifecycle is exposed everywhere: `corvid_open`/`corvid_open_memory`
+ `corvid_close` in [the C ABI](/ffi/handles/), `Db.open`/`openMemory` in
[corvid-node](/bindings/corvid-node/), the `open_server` MCP helpers.

Next: [backup](/admin/backup/).
