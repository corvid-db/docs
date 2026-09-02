---
title: Compaction
description: Db::compact in corvid — offline space reclamation after heavy deletes, exclusivity requirements, and the automatic on-disk vector index compaction.
sidebar:
  order: 3
---

Two distinct compactions exist — don't confuse them:

1. **`Db::compact()`** — file-level space reclamation (below).
2. **Automatic on-disk vector-index compaction** — self-maintained; see
   [index maintenance](/indexes/maintenance/).

## `Db::compact`

```rust
# use corvid::{Db};
# let dir = tempfile::tempdir().unwrap();
# let mut db = Db::open(dir.path().join("app.corvid"))?;
let moved = db.compact()?;   // bool: whether any data moved
# let _ = moved;
# Ok::<(), corvid::Error>(())
```

After heavy deletes, freed pages can remain allocated in the file.
`compact()` rewrites the database to reclaim that space — data unchanged,
double-compact tolerated (the second is a no-op).

**Offline maintenance**: `compact` takes `&mut self` — the engine requires
exclusive access. In practical terms: close other handles, or compact from a
point in your lifecycle where the `Db` isn't shared. Through
[the C ABI](/ffi/functions-admin/), `corvid_compact` checks exclusivity via
the derived-handle counter and fails with the FFI-only `CORVID_E_BUSY` while
collection/query handles are alive — a deterministic answer, never a hang.

## When to compact

- After deleting a large fraction of a collection (file size doesn't shrink
  on delete; compaction makes it shrink).
- After TTL purges of big batches.
- Not routinely — it's O(file) offline work; the automatic vector-index
  compaction handles index bloat on its own.

Next: [bulk loading](/admin/bulk/).
