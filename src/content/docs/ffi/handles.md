---
title: Handles
description: The C ABI's ten handle types — backing, thread contract, creation and destruction, lifetimes, and the cross-family-free rule.
sidebar:
  order: 2
---

Every non-trivial object crosses the ABI as an opaque handle. One table
rules them all:

| Handle | Backed by (Rust) | Thread contract | Created by | Freed by |
|---|---|---|---|---|
| `corvid_db*` | `Arc<corvid::Db>` | **thread-safe**: concurrent reads from many threads; writes serialized by the engine | `corvid_open`, `corvid_open_memory` | `corvid_close` |
| `corvid_coll*` | `Arc<Db>` + collection name | **thread-safe** (shares the `Arc<Db>`) | `corvid_collection` | `corvid_collection_free` |
| `corvid_value*` | `corvid::Value` | builder handles **single-threaded**; borrowed children ride the parent's lifetime | any `corvid_value_*` constructor, `corvid_get`, `corvid_query_min/max`, `corvid_value_clone` | `corvid_value_free` (owned values only) |
| `corvid_pred*` | `Predicate` tree | **single-threaded** construction | the 10 `corvid_pred_*` constructors | `corvid_pred_free` (never-consumed roots only); consumed by and/or/not/filter/delete_where |
| `corvid_query*` | owned QueryBuilder state | **single-threaded** build | `corvid_query_new` | `corvid_query_run` and every aggregate (CONSUME); `corvid_query_free` for abandoned builders |
| `corvid_rows*` | materialized `Vec<ResultRow>` + cursor | read-only cursor; **single-threaded** use | `corvid_query_run`, `corvid_page` | `corvid_rows_free` |
| `corvid_strs*` | owned byte-string vector + cursor | read-only cursor; **single-threaded** | `corvid_collections`, `corvid_neighbors`, `corvid_in_neighbors`, `corvid_traverse` | `corvid_strs_free` |
| `corvid_geohits*` | owned hit vector + cursor | read-only cursor; **single-threaded** | the 3 `corvid_geo_*` fns, `corvid_neighbors_weighted` | `corvid_geohits_free` |
| `corvid_groupiter*` | owned group list (sorted by group key) + cursor | read-only cursor; **single-threaded** | `corvid_query_group_count/sum/avg` (consume the query) | `corvid_groupiter_free` |
| `corvid_schemaiter*` | owned field list + cursor | read-only cursor; **single-threaded** | `corvid_schema` | `corvid_schemaiter_free` |

## Lifecycle rules

- `corvid_db` holds the only strong reference after open; every `corvid_coll`
  clones the `Arc`. `corvid_close` drops the handle's reference — the `Db`
  (and its file locks) release when the **last derived handle** is gone.
  Freeing the db while collection handles live is fine (the collection keeps
  the engine open).
- Collections are created lazily on first write (engine `Db::collection` is
  infallible) — `corvid_collection` never fails for name reasons;
  reserved/invalid names surface at write time, exactly as in Rust.
- **Cross-family frees are forbidden.** Each handle has exactly one
  destructor. Passing a handle to any function of another family is
  undefined behavior (C's type system cannot stop it). `_free(NULL)` is a
  no-op for every family.
- `corvid_compact` requires exclusivity (see [admin](/ffi/functions-admin/))
  — the counter-plus-`Arc::get_mut` gate answers `CORVID_E_BUSY`.

## Implementation errata (recorded, contract-unchanged)

- The derived-handle counter for `corvid_compact` is necessary but not
  sufficient alone: a query's execute releases its count at entry while its
  engine `Arc` clone lives through the engine call — the gate is the counter
  at exactly 1 **and** sole `Arc` ownership.
- `corvid_strs*`'s backing is `Vec<Vec<u8>>`, not `Vec<String>` — graph
  endpoints are document **keys** (arbitrary bytes), so the cursor preserves
  bytes and hands out the same binary-safe `(pointer, length)` pairs either
  way.

Next: [errors and NULL discipline](/ffi/errors/).
