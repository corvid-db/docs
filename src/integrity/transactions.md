---
title: Transactions
description: corvid's transaction model — single writer with MVCC readers, the Store byte-level API, transaction/WriteBatch/ReadBatch, bulk scopes and relaxed durability.
sidebar:
  order: 2
---

The document API is transactional per call: every write is one atomic
transaction covering the document, indexes, constraints, TTL, and edge
cascades. For multi-document units, `insert_batch` and `Store`-level
transactions give you the same atomicity across many keys.

## The concurrency model

- **Single writer, whole database** — writes serialize (the storage engine's
  model). No savepoints.
- **Concurrent readers, MVCC** — every query/scan/page runs against one
  point-in-time snapshot; readers never block the writer and vice versa.
- **Snapshot isolation, not serializability.** A query's result always
  matches one committed state; omission-only mid-write anomalies are possible
  within a query, never torn reads.
- Single-call atomicity: a failed multi-op write (batch, CAS, transaction)
  leaves no partial side effects.

## `Db::bulk` — the durability scope

```rust
# use corvid::{Db, Value};
# let dir = tempfile::tempdir().unwrap();
# let mut db = Db::open(dir.path().join("app.corvid"))?;
db.bulk(|| {
    let c = db.collection("docs");
    for i in 0..100_000u32 {
        c.insert(&i.to_le_bytes(), &Value::Int(i as i64))?;
    }
    Ok(())
})?;   // ~N fsyncs -> ~1
# Ok::<(), corvid::Error>(())
```

Bulk load under relaxed durability: committed data stays consistent, but
in-flight writes may be lost on a crash **before the closing flush**. Errors
inside the closure still persist writes made before the error. A panic inside
the closure unwinds past the flush (the next durable commit makes the writes
durable — rebulk or reopen if that matters). See also
[bulk loading](/admin/bulk/).

## `Store` — the byte-level surface

`Store` is the lower-level KV API the document layer is built on — useful for
systems that want raw bytes without document semantics:

```rust
# use corvid::{Db};
# let db = Db::open_in_memory()?;
let store = db.store();

// Atomic multi-op write transaction
store.transaction(|tx| {
    tx.put(b"c", b"k1", b"v1")?;
    tx.delete(b"c", b"k0")?;
    Ok(())
})?;

// WriteBatch — staged writes applied atomically
use corvid::store::WriteBatch;
let mut wb = WriteBatch::new();
wb.put(b"c", b"k2", b"v2");
wb.delete(b"c", b"k1");
store.apply(&wb)?;

// ReadBatch — one snapshot across many reads
use corvid::store::ReadBatch;
let rb = store.read()?;
let v = rb.get(b"c", b"k2")?;          // Option<Vec<u8>>
let n = rb.count(b"c")?;               // usize
rb.scan_prefix(b"c", b"k", |k, v| true)?;
# let _ = v;
# Ok::<(), corvid::Error>(())
```

The full surface: `put`/`get`/`delete`/`scan`/`scan_from`/`scan_prefix`/
`count`/`for_each`, `collections`, `next_auto_id`, `transaction`,
`read`, `backup`, `compact`, `begin_bulk`/`flush`, `set_relaxed_durability`.

### `begin_bulk` / `BulkScope`

`Store::begin_bulk()` opens a thread-local, panic-safe relaxed-durability
scope (`BulkScope`); `Store::flush()` ends it. This is what `Db::bulk` uses
— and unlike the old global switch, concurrent writers on other threads are
unaffected. Scopes nest.

### Durability control

`Store::set_relaxed_durability(bool)` toggles per-transaction durability for
advanced hosts; `flush()` makes everything durable.

## What's not here

No savepoints, no nested write transactions, no per-collection write locks
(the write lock is database-wide), no async API — the engine is synchronous;
wrap it in your executor. See [administration](/admin/open-close/) for the
operational side.

Next: [change events](/integrity/events/).
