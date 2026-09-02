---
title: Change events
description: Reactive change feeds in corvid — subscribe/unsubscribe, ChangeEvent shape, exact per-path insert/delete vectors, synchronous post-commit dispatch, and the silent paths.
sidebar:
  order: 3
---

```rust
# use corvid::{Db};
# let db = Db::open_in_memory()?;
let id = db.subscribe(|ev| {
    println!("{:?} {} {:?}", ev.kind, ev.collection, ev.key);
});
// ... writes fire the callback ...
db.unsubscribe(id);
# Ok::<(), corvid::Error>(())
```

In-process subscriptions piggyback on the write path — there is no separate
event log. Every event carries:

```rust
pub struct ChangeEvent {
    pub kind: ChangeKind,     // Insert | Delete
    pub collection: String,
    pub key: Vec<u8>,
}
pub struct SubscriptionId(/* opaque */);
```

## Dispatch semantics

- **Synchronous, post-commit, in mutation order.** Callbacks run on the
  writing thread after the transaction commits — when your callback returns,
  the event is delivered.
- **Multiple subscribers all receive identical event vectors**, in order.
- **Cross-collection tagging**: each event names its own collection.
- Callbacks should be fast and non-blocking; a slow callback stalls the
  writer. Keep a lock-free hand-off if you process asynchronously.
- `unsubscribe` reports whether the subscription existed; ids are distinct.

## Exact event vectors per path

| Path | Events |
|---|---|
| `insert` (new key) | one `Insert` |
| `insert` (overwrite) | one `Insert` (the new value) |
| `insert_batch` | one `Insert` per applied key, in batch order |
| `insert_auto` | one `Insert` keyed by the generated key |
| `update` returning `Some` | one `Insert` |
| `update` returning `None` (delete) | one `Delete` |
| `update` on missing key creating | one `Insert` |
| `patch` creating | one `Insert` |
| `patch` merging | one `Insert` |
| `compare_and_set` applied (write) | one `Insert` |
| `compare_and_set` applied (delete) | one `Delete` |
| `compare_and_set` compare failed | none |
| `delete` / `delete_batch` / `delete_where` | one `Delete` per existing key, in order |
| `delete` of absent key (incl. edge cascade) | none |
| `link` (new or duplicate) | one `Insert` keyed by the `from` endpoint — including links to missing endpoints |
| `unlink` | none |
| TTL purge | none (silent cascade) |
| stranded TTL purge | none |

The "duplicate link re-emits insert" and "TTL purge is silent" rows are the
surprising ones — both are pinned by the conformance suite.

## What events are for

Cache invalidation, derived-state maintenance, audit trails within the
process, live UIs. For cross-process notification, run the
[MCP sidecar](/admin/mcp/) or front the engine with your own service — the
engine has no networking, by design, and the C ABI excludes subscriptions in
v1 (reentrancy across languages; see
[ABI exclusions](/ffi/stability/)).

Next: [administration](/admin/open-close/).
