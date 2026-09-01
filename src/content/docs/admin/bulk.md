---
title: Bulk loading
description: Fast bulk ingestion in corvid — Db::bulk relaxed-durability scopes, insert_batch single-transaction writes, and the crash window semantics.
sidebar:
  order: 4
---

Three tools, fastest-first:

## `Db::bulk` — relaxed-durability scope

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
})?;
# Ok::<(), corvid::Error>(())
```

Writes inside the closure run under non-fsync durability; one flush at the
end. **Crash window**: committed data stays consistent, but in-flight writes
may be lost on a crash before the flush. Writes made before an erroring
closure *do* persist. A panic unwinds past the flush — rebulk or reopen if
that matters.

Bulk is thread-local (`Store::BulkScope` under the hood): concurrent writers
on other threads keep normal durability. Scopes nest.

## `insert_batch` — one transaction, one fsync

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
let batch: Vec<(&[u8], &Value)> = (0..1_000)
    .map(|i| (Box::leak(i.to_le_bytes().into_boxed_slice()) as &[u8], &Value::Int(i)))
    .collect();
c.insert_batch(&batch)?;
# Ok::<(), corvid::Error>(())
```

All-or-nothing: a unique/schema violation rolls back the whole batch.
Duplicates inside a batch are last-write-wins. Right choice when the batch
must be atomic or when you can't tolerate a crash window.

## Loop of inserts — the slow baseline

Correct, durable per write, ~one fsync per insert. Fine for hundreds; use
the above for thousands-plus.

## Measured shape

Batch insert of 16-dim-embedding documents (the engine's scaling example):
~16 ms at 1k, ~0.6 s at 100k, ~4.9 s at 1M — bounded per-batch memory. See
[performance: scaling](/performance/scaling/).

## After the load

- In-RAM indexes maintained during bulk rebuild are as fresh as the writes
  (they're transactional — no stale windows).
- Reclaim file space after bulk-delete cycles with
  [compaction](/admin/compact/).
- Ingesting a dump file? That's [`load`](/admin/dump-load/), which streams
  buffered and rebuilds definitions.

Next: [feature flags](/admin/features/).
