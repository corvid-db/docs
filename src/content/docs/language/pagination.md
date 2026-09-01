---
title: Pagination
description: Keyset cursor pagination in corvid — page and page_where, cursor semantics, snapshot guarantees, and when to prefer cursors over offset.
sidebar:
  order: 8
---

For walking large result sets, corvid offers **keyset (cursor) pagination**:
each page returns rows plus an opaque cursor that resumes strictly after the
last key served. No offset rescan, bounded memory, streamed.

## `page`

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
let mut after: Option<Vec<u8>> = None;
loop {
    let page = c.page(after.as_deref(), 100)?;
    for (key, doc) in &page.rows { /* ... */ let _ = (key, doc); }
    match page.next {
        Some(cursor) => after = Some(cursor),
        None => break,          // short page = end of collection
    }
}
# Ok::<(), corvid::Error>(())
```

- Rows are in **key order**, from one MVCC snapshot covering the whole
  chunked walk.
- `after = None` (or empty bytes... see below) starts at the beginning.
- `Page.next` is `Some(cursor)` iff the page was full — a full page always
  yields a cursor; a short page means end.
- `limit 0` returns an empty page and no cursor.

Cursor corner cases, pinned by tests: `after = b""` skips exactly the empty
key (the empty key is a legal document key and sorts first). Cursors are
opaque byte strings — treat them as tokens (the C ABI returns the buffer for
`corvid_free`).

## `page_where`

The same walk with a predicate — only matching documents are served, the
cursor still advances by key:

```rust
# use corvid::{Db, Value, field};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
let page = c.page_where(None, 50, field("category").eq(Value::Text("blog".into())))?;
# let _ = page;
# Ok::<(), corvid::Error>(())
```

Filtered pagination composes from `query().filter()` + `offset`/`limit` too;
`page_where` gives you the constant-memory cursor form. (The C ABI exposes
`page` only in v1 — see the [exclusions](/ffi/stability/).)

## Snapshot semantics

Each `page` call opens its **own** read snapshot and runs the entire chunked
walk inside it: the returned rows always match some committed point in time,
even while writers are active. Successive pages see the then-current state —
a walk across concurrent writes is per-page consistent, not walk-consistent.

The snapshot-holding cost is space, not latency: freed pages from commits
landing during a walk stay in the file until the walk ends (bounded by
`limit` rows and 1024-key chunk reads).

## Cursors vs `offset`

- `offset` on the query builder is O(offset + limit) — it walks and discards.
  Fine for shallow pages, dashboards, small windows.
- Cursors are O(limit) per page regardless of depth — the shape for exporting
  a collection, background syncs, and feeding pipelines.
- Ranked (multi-source fused) result sets do not have a cursor in v0.2 —
  fusion materializes the candidate set. Filter-only, order-only, and
  single-source ranked paths are bounded/streamed.

Next: [joins](/language/joins/).
