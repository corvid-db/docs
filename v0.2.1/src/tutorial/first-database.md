---
title: Your first database
description: Open a corvid database, create collections, write and read documents — the five-minute tour of the embedded engine from Rust.
sidebar:
  order: 0
---

This tutorial walks through opening a database, storing documents, and reading
them back. Examples are Rust (the engine's native language); the same shapes
exist through [the C ABI](/ffi/overview/) and [bindings](/bindings/overview/) as native classes.

## Open a database

```rust
use corvid::Db;

let db = Db::open("app.corvid")?;          // file-backed, created if absent
// let db = Db::open_in_memory()?;          // ephemeral, no file
# Ok::<(), corvid::Error>(())
```

A `Db` is one embedded database file. Open it once and share it — it is
`Send + Sync`; wrap it in `Arc` to share across threads. A second `Db` handle
to the same file fails on the storage engine's exclusive lock, so one process,
one handle, is the pattern.

## Collections and documents

A **collection** is a named namespace of documents, created lazily on first
write. A **document** is a typed [`Value`](/language/values/) — usually a map.
A **key** is arbitrary bytes; documents sort by key.

```rust
use corvid::{Db, Value};
use std::collections::BTreeMap;

let db = Db::open_in_memory()?;
let users = db.collection("users");

let mut u = BTreeMap::new();
u.insert("name".into(), Value::Text("ada".into()));
u.insert("age".into(), Value::Int(36));
u.insert("loc".into(), Value::Array(vec![
    Value::Float(51.5), Value::Float(-0.13),
]));
users.insert(b"u1", &Value::Map(u))?;      // insert or overwrite

let got = users.get(b"u1")?;                // Option<Value>
let n = users.len()?;                       // O(1) maintained count
users.delete(b"u1")?;                       // returns whether it existed
# Ok::<(), corvid::Error>(())
```

Names starting with `__` are reserved for the engine and rejected; names may
not contain a NUL byte or an interior `__` sequence.

## Write modes

| Method | Use |
|---|---|
| `insert(key, &doc)` | insert / full overwrite |
| `insert_batch(&[(&[u8], &Value)])` | many docs in one transaction (one fsync) |
| `insert_auto(&doc) -> Vec<u8>` | append under a generated ordered key |
| `patch(key, &partial_map)` | merge top-level fields into an existing doc |
| `update(key, \|cur\| -> Option<Value>)` | read-modify-write (return `None` to delete) |
| `compare_and_set(key, expected, new)` | atomic conditional write / delete / insert-if-absent |
| `delete_where(predicate)` | delete every matching doc (index-accelerated) |
| `delete_batch(&[&[u8]])` | delete a set of keys |

```rust
# use corvid::{Db, Value};
# use std::collections::BTreeMap;
# let db = Db::open_in_memory()?; let users = db.collection("users");
# let mut m = BTreeMap::new(); m.insert("age".into(), Value::Int(36)); users.insert(b"u1", &Value::Map(m))?;
// Patch: set/add fields without resending the whole document.
let mut p = BTreeMap::new();
p.insert("age".into(), Value::Int(37));
users.patch(b"u1", &Value::Map(p))?;

// Conditional write: only if absent.
let mut v = BTreeMap::new();
v.insert("name".into(), Value::Text("grace".into()));
let applied = users.compare_and_set(b"u2", None, Some(Value::Map(v)))?; // true
# let _ = applied;
# Ok::<(), corvid::Error>(())
```

See [writes](/language/writes/) for the full semantics of each mode.

## Read it back

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?;
# let docs = db.collection("docs");
// Point read
let doc = docs.get(b"p1")?;

// Full scan, key order (materialized)
let all = docs.scan()?;

// Streaming scan with early stop (bounded memory)
docs.for_each_doc(|key, doc| {
    // ...
    true // return false to stop
})?;
# Ok::<(), corvid::Error>(())
```

## Persist and reopen

Nothing to flush — every write is durable per-transaction. Drop the handle
(or exit); the file reopens with all data, plus every
[index](/indexes/overview/) and [schema](/integrity/schema/) definition:

```rust
# use corvid::{Db, Value};
# let dir = tempfile::tempdir().unwrap();
# let path = dir.path().join("app.corvid");
{
    let db = Db::open(&path)?;
    db.collection("docs").insert(b"p1", &Value::Int(1))?;
} // handle dropped
let db = Db::open(&path)?;
assert_eq!(db.collection("docs").get(b"p1")?, Some(Value::Int(1)));
# Ok::<(), corvid::Error>(())
```

## Next

Continue with the [queries tour](/tutorial/queries-tour/) — filters, vector
search, and text search — then the
[hybrid walkthrough](/tutorial/hybrid-walkthrough/).
