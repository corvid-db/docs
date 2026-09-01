---
title: Writes
description: Every write path in corvid — insert, batch, auto keys, patch, update, compare_and_set, delete_where — with their exact semantics, index maintenance and rollback behavior.
sidebar:
  order: 2
---

All writes are atomic per call: the document change, every index maintenance
step, unique-constraint checks, TTL changes, and graph-edge cascades commit
in one transaction. An error leaves no partial side effects — a failed batch
rolls back whole.

## Insert

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("users");
c.insert(b"u1", &Value::Text("ada".into()))?;   // insert or full overwrite
# Ok::<(), corvid::Error>(())
```

Overwrite replaces the whole document. The empty key and the empty map are
legal. Reserved/invalid collection names are rejected here (lazily, at first
write).

## Batch insert

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("users");
let batch: Vec<(&[u8], &Value)> = vec![
    (b"u1", &Value::Int(1)),
    (b"u2", &Value::Int(2)),
];
c.insert_batch(&batch)?;   // one transaction, one fsync
# Ok::<(), corvid::Error>(())
```

Duplicates inside a batch follow last-write-wins. A unique or schema
violation anywhere rolls back the **whole batch**.

## Auto keys

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("events");
let key: Vec<u8> = c.insert_auto(&Value::Int(42))?;  // ordered, unique, per-collection
# let _ = key;
# Ok::<(), corvid::Error>(())
```

Keys are zero-padded 20-digit monotonically increasing values, so insertion
order == key order. The id is reserved inside the insert transaction: a
failed insert (schema/unique violation) does not burn an id.

## Patch

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("users");
# let mut m = std::collections::BTreeMap::new(); m.insert("age".into(), Value::Int(36));
# c.insert(b"u1", &Value::Map(m))?;
let mut p = std::collections::BTreeMap::new();
p.insert("age".into(), Value::Int(37));
c.patch(b"u1", &Value::Map(p))?;   // merge top-level fields
# Ok::<(), corvid::Error>(())
```

Top-level map fields merge; a non-map value under a patched key **replaces**
the old value (no deep merge). Patching a key with no document creates it.
Either side being a non-map makes the result the patch value.

## Update (read-modify-write)

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("counters");
# c.insert(b"k", &Value::Int(1))?;
c.update(b"k", |cur| match cur {
    Some(Value::Int(n)) => Some(Value::Int(n + 1)),
    _ => Some(Value::Int(0)),      // absent -> create with 0
})?;
# Ok::<(), corvid::Error>(())
```

The closure sees the current document (or `None` when absent — absence is not
an error) and returns the replacement, or `None` to delete. `update` is
get-then-write and therefore **not linearizable** against concurrent writers
to the same key — when that matters, use `compare_and_set`.

## Compare-and-set

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("users");
// insert-if-absent:
let applied = c.compare_and_set(b"u9", None, Some(Value::Int(1)))?;
// delete-if-present:
let removed = c.compare_and_set(b"u9", Some(&Value::Int(1)), None)?;
# let _ = (applied, removed);
# Ok::<(), corvid::Error>(())
```

Atomic conditional write / delete / insert-if-absent. The comparison uses the
engine's **semantic value equality** — the same rule unique constraints use:
`NaN == NaN` regardless of payload, `-0.0 == 0.0`, containers element-wise. A
failed compare returns `false` (not an error); nothing is written.

## Deletes

```rust
# use corvid::{Db, field, Value};
# let db = Db::open_in_memory()?; let c = db.collection("users");
c.delete(b"u1")?;                    // bool: existed?
c.delete_batch(&[b"u2", b"u3"])?;    // usize: how many existed
c.delete_where(field("age").lt(Value::Int(18)))?;  // usize, index-accelerated
# Ok::<(), corvid::Error>(())
```

Deleting a document **cascades its graph edges** in the same transaction —
including edges dangling on a key that never existed as a document. Deleting
an absent key is a quiet `false`, still running the edge cascade; no change
events fire.

## Events

Every write path emits [change events](/integrity/events/) — `Insert` /
`Delete` vectors with exact per-path semantics (patch and CAS emit per branch;
TTL purges and cascades are silent).

Next: [filters](/language/filters/) — building predicates over documents.
