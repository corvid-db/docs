---
title: Backup
description: Online consistent backup in corvid — Db::backup and Store::backup, the fresh-target rule, physical format caveats, and failure cleanup.
sidebar:
  order: 1
---

```rust
# use corvid::{Db};
# let dir = tempfile::tempdir().unwrap();
# let db = Db::open(dir.path().join("app.corvid"))?;
db.backup(dir.path().join("backup.corvid"))?;
# Ok::<(), corvid::Error>(())
```

`Db::backup(path)` writes a **consistent point-in-time physical copy** of the
database from one read snapshot — safe to run while writers are active.

## Rules

- **The target must not exist.** An existing file fails with
  `Error::BackupTargetExists` — backups never overwrite. A mid-copy failure
  removes the partial destination (best-effort) so debris never masquerades
  as a backup or blocks future attempts.
- The result is an **independently openable database** — open it with
  `Db::open`, run the full test suite against it.
- Physical copy = fast, but **feature-configuration-dependent**: a backup
  written by a `zstd`-feature build is not readable by a default build (clean
  per-row `Decode` errors), and vice versa matters only in that direction.
  Use [dump/load](/admin/dump-load/) — a logical, format-stable transfer —
  to move between feature configurations or engine versions.

## Scheduling pattern

```rust
# use corvid::{Db, Value};
# let dir = tempfile::tempdir().unwrap();
# let db = Db::open(dir.path().join("app.corvid"))?;
# let stamp = 1;
let path = format!("backups/app-{stamp}.corvid");
db.backup(&path)?;
# Ok::<(), corvid::Error>(())
```

Take backups on a cadence; verify by opening them. The MCP `backup` tool
exposes the same operation to agentic clients; corvid-c's golden suite runs
`backup_reopens_as_a_live_database` against every release artifact.

Next: [dump and load](/admin/dump-load/).
