---
title: "Functions: admin"
description: The C ABI function reference part 6 — dump to path, load from path, load with renames, backup, and compact with its exclusivity gate and the FFI-only CORVID_E_BUSY.
sidebar:
  order: 9
---

Path-based administrative operations, all wrapping `corvid::Db` methods.
Dump and load open the files themselves and hand them to the engine's
generic `Read`/`Write` methods; `corvid_backup` passes the path through to
the engine, which opens the backup file itself. Semantics on
[dump/load](/admin/dump-load/) and [backup](/admin/backup/).

```c
corvid_status corvid_dump_to_path(corvid_db *db, const char *path, size_t path_len);
```
Logical, version-stamped dump of the whole database (documents,
index/schema/TTL definitions, graph edges, auto-id counters) to `path`, from
one read snapshot.

```c
corvid_status corvid_load_from_path(corvid_db *db, const char *path, size_t path_len);
corvid_status corvid_load_from_path_with_renames(corvid_db *db,
                                                 const char *path, size_t path_len,
                                                 const char *const *old_names,
                                                 const char *const *new_names,
                                                 const size_t *old_lens,
                                                 const size_t *new_lens,
                                                 size_t count);
```
Replay a dump into this database — the plain form equals
`load_with_renames` with an empty map. The rename map is the migration path
for legacy `__`-containing collection names: invalid targets fail with
`CORVID_E_INVALID_NAME` before reading; two-sources-one-target collisions
fail with `CORVID_E_ARGUMENT`.

```c
corvid_status corvid_backup(corvid_db *db, const char *path, size_t path_len);
```
Consistent point-in-time physical backup to a **fresh** file (an existing
target fails with `CORVID_E_BACKUP_TARGET_EXISTS`); safe while writers are
active. Physical means feature-configuration-dependent — use dump/load to
move between feature builds.

```c
corvid_status corvid_compact(corvid_db *db, int *moved_out);
```
Reclaim file space after heavy deletes (offline maintenance). `*moved_out`
(nullable) reports whether any data moved. The engine's `Db::compact` needs
`&mut self` — **exclusivity** — so this call requires every handle derived
from this `db` (collections, queries, anything holding an engine reference)
to be freed first. The gate: an FFI-owned derived-handle counter
(incremented on handle creation, decremented on free) at exactly 1 (the db
handle itself) **and** sole `Arc` ownership (`Arc::get_mut`). Otherwise the
call fails with the FFI-only `CORVID_E_BUSY` — a deterministic answer,
never a hang or UB.

Consequence for bindings: to compact, reach a quiescent point (drop
collection/query handles), call compact, then rebuild handles. Threads
still holding handles keep `CORVID_E_BUSY` as the answer.

Next: [ownership & transfer rules](/ffi/ownership/).
