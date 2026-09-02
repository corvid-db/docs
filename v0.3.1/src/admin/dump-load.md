---
title: Dump and load
description: Logical migration in corvid — Db::dump and Db::load (format v2, u64 prefixes), load_with_renames for legacy __-containing names, and the one-way compat matrix.
sidebar:
  order: 2
---

`dump`/`load` is the **logical migration path** — the way data crosses
format breaks, feature configurations, and the pre-1.0 API churn. A dump is
a version-stamped byte stream of documents plus every definition; loading
replays it and rebuilds derived state.

```rust
# use corvid::{Db, Value};
# let dir = tempfile::tempdir().unwrap();
# let mut db = Db::open(dir.path().join("old.corvid"))?;
# db.collection("docs").insert(b"p1", &Value::Int(1))?;
let mut bytes = Vec::new();
db.dump(&mut bytes)?;                       // whole database, one read snapshot

let fresh = Db::open(dir.path().join("new.corvid"))?;
fresh.load(&bytes[..])?;                    // documents + defs rebuild
# Ok::<(), corvid::Error>(())
```

## What a dump carries

Documents, all index definitions (rebuilt from the renamed documents on
load — nothing to re-create by hand), schemas, TTL entries, graph edges
(replayed through `link_weighted`, so adjacency rebuilds by the end of the
load), and auto-id counters. Loading into a **non-empty** database merges
records and counters with what's there.

## Format v2 (current)

The 12-byte magic **is** the version marker: `CORVIDDUMPv1` (legacy) or
`CORVIDDUMPv2` (what `dump` writes today). v2 widens every length/count
prefix — byte-field lengths, per-definition field counts, PQ `m`/`k` — from
u32 to u64, so a single value, key, string, or field count beyond 4 GiB is
representable (v1's writer truncated such lengths silently).

| | writer emits | reader accepts |
|---|---|---|
| v0.1 binaries | v1 | v1 |
| v0.2+ binaries | **v2** | **v1 and v2** |

One-way by design: an unknown magic (a future v3) is `Error::InvalidDump` in
older binaries. The migration story is always *dump with the old binary,
load with the new*.

## `load_with_renames` — the `a__b` migration

Collection names containing an interior `__` were accepted before audit
remediation wave 4 and are rejected since (they could forge engine-internal
namespaces). Dumps from old databases still carry such names — a plain
`load` fails at index/schema replay with `Error::InvalidName`. The rename
map migrates them:

```rust
# use corvid::{Db};
# let dir = tempfile::tempdir().unwrap();
# let db = Db::open(dir.path().join("new.corvid"))?;
# let bytes: &[u8] = &[];
let mut renames = std::collections::BTreeMap::new();
renames.insert("a__b".to_owned(), "a_b".to_owned());
db.load_with_renames(bytes, &renames)?;
# Ok::<(), corvid::Error>(())
```

Every collection-name occurrence in the stream — documents, index/schema
definitions, TTL entries, graph edges, auto-id counters — is mapped before
replay, so indexes rebuild under the new name automatically. The contract:

- each target must be a valid user name (else `Error::InvalidName` naming
  the offending target, checked before the stream is read);
- no two dump names may load into one output name — two sources sharing a
  target, or a target colliding with an unmapped dump collection, is
  `Error::InvalidArgument` (merging keyspaces would silently overwrite
  documents);
- reserved dump names are rejected before mapping (a rename cannot launder
  an engine namespace);
- a map entry whose source never occurs is a no-op.

## Operational notes

- `dump` streams records without materializing the corpus, from one read
  snapshot (catalog walk included — a concurrent TTL commit can't be
  omitted).
- `load` streams the file through buffered reads and rejects
  engine-reserved names on **every** replay path (including the auto-id
  counter section).
- The MCP `dump`/`load` tools work on files; `load` takes the same rename
  table as an optional `rename` object.

Next: [compaction](/admin/compact/).
