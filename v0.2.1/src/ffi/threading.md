---
title: Threading
description: The C ABI thread-safety contract — thread-safe db/collection handles, single-threaded builders and cursors, thread-local last error, and the compact quiescence rule.
sidebar:
  order: 11
---

- **`corvid_db` / `corvid_coll`: thread-safe.** Concurrent reads from any
  number of threads; writes are serialized by the engine (single writer);
  queries are MVCC point-in-time. The engine's `Db` is `Sync`.
- **Value builders, predicates, queries, and every cursor:
  single-threaded** construction and use. Concurrent calls on the same
  handle from two threads are **undefined behavior — documented, not
  detected**. Bindings enforce this by confining each object to one
  thread/queue (per-language idiom maps do this naturally; PHP ZTS note:
  one handle per request/thread).
- **Different handles may be used concurrently**, even derived from one db:
  a query on thread A and an insert on thread B are fine — each sees a
  consistent snapshot/commit as documented.
- **`corvid_last_error_code/message` are thread-local**: each thread sees
  its own last failure; no locking is needed or provided.
- **Freeing a handle while another thread is calling into it is UB** — free
  after joining/quiescing.
- **Callbacks** (scan sink, update closure) run on the caller's thread
  between engine operations: reads through other handles are memory-safe,
  but callbacks must not issue further writes to the same database, must not
  free or mutate borrowed arguments, and should not make other corvid calls
  at all — the portable contract is "no reentrant corvid calls".

## The compact quiescence rule

`corvid_compact` needs exclusive engine access (the derived-handle counter
plus sole `Arc` ownership — see [admin](/ffi/functions-admin/)). Concurrent
use of other handles is unaffected until the compact call, but a binding
that wants to compact must reach a quiescent point (all collection/query
handles freed) first; threads still holding handles keep `CORVID_E_BUSY` as
the deterministic answer — never a hang, never UB.

## How bindings map this

| Engine/ABI reality | Binding idiom |
|---|---|
| thread-safe `db` handle | shareable native object |
| single-threaded builder/cursor | confined to thread/queue/event-loop turn |
| `_next` cursors | the language's native iteration protocol |
| `CORVID_ERR` + last error | native exceptions carrying the code |
| `_free` destructors | dispose/finalizer patterns |

Next: [stability & exclusions](/ffi/stability/).
