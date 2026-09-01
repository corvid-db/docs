---
title: TTL and expiry
description: Per-record expiry in corvid — insert_with_ttl, set_ttl, ttl, purge_expired; the injected clock, visibility until purge, and index/edge cascades on purge.
sidebar:
  order: 0
---

The engine keeps **no clock** — you supply "now". Expired records stay
visible until a purge; purging is your scheduled job.

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("sessions");
# let doc = Value::Int(1);
c.insert_with_ttl(b"s1", &doc, 1_700_000_000)?;  // expiry timestamp (your epoch)
c.set_ttl(b"s1", 1_700_000_500)?;                 // change it
c.ttl(b"s1")?;                                    // Option<i64>
let purged = c.purge_expired(1_700_000_600)?;     // delete everything due by now
# let _ = purged;
# Ok::<(), corvid::Error>(())
```

## Semantics

- **Expiry is `<= now`, inclusive** — a record due exactly at `now` is
  purged; one nanosecond-conceptually before is not.
- **Boundary correctness**: one-before / exactly-at / one-after the expiry
  are pinned by tests; `purge_expired` is idempotent.
- **Expired but not purged records remain visible** to every read (`get`,
  queries, scans, search). TTL hides nothing — it schedules deletion, not
  visibility. Purge is when state changes.
- **Timestamps accept i64 extremes** and order correctly; the epoch is yours
  (unix seconds, milliseconds, anything monotonic).
- **Plain writes clear expiry**: `insert`/`insert_batch`/`patch` on a key
  with an expiry remove the expiry; `set_ttl` sets/replaces without
  rewriting the document; `set_ttl` on a missing key is `Ok` (and purges
  nothing).
- `insert_with_ttl` writes row + expiry in one commit; the round-trip (set
  on insert, after plain insert, after overwrite) is conformance-pinned.

## What a purge does

`purge_expired(now)` deletes each due record through the normal delete path,
so it:

- removes the document from **every index** (scalar, unique, vector, text) —
  no stale entries,
- **cascades the document's graph edges** in the same transaction (both
  namespaces), including stranded TTL entries (expiry on a key with no
  document),
- emits **no change events** (the cascade is silent),
- re-reads each due key inside one transaction and deletes only if the
  timestamp still matches — a record rewritten after collection is **not**
  deleted by a racing purge.

## Scheduling pattern

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("sessions");
# let doc = Value::Int(1);
# c.insert_with_ttl(b"s1", &doc, 1_700_000_000)?;
loop {
    // your clock, your cadence
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?.as_secs() as i64;
    c.purge_expired(now)?;
# break;
    // sleep ...
}
# Ok::<(), corvid::Error>(())
```

TTL persists across reopen (reserved namespaces); [dump/load](/admin/dump-load/)
carries TTL entries with the documents.

Next: [schemas and constraints](/integrity/schema/).
