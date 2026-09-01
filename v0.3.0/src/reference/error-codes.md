---
title: Error codes
description: The frozen corvid error-code table — engine corvid::Error variants 1-18 mapped 1:1 onto C ABI codes, plus the FFI-only CORVID_E_BUSY (19); generated from the engine's FFI spec.
sidebar:
  order: 1
---

<!-- GENERATED FILE — do not edit by hand. Source: the engine's
     docs/FFI.md §1.3 frozen code table at tag v0.3.0. Regenerate with
     scripts/sync-from-engine.sh v0.3.0 — CI verifies the committed copy
     matches the pinned tag (see .engine-pin). -->

> **generated — synced from the engine at v0.3.0.** The detailed codes
> returned by `corvid_last_error_code()`. Value 0 means "no error recorded
> on this thread". Codes 1–18 map 1:1 onto the engine's
> `corvid::Error` variants (pinned by the variant-inventory snapshot
> test); code 19 is FFI-only. **Never renumbered; new values only appended
> (20+).** The error model itself: [errors & NULL discipline](/ffi/errors/).

| Code | Name | Meaning |
|---|---|---|
| `0` | `CORVID_E_OK` | no error |
| `1` | `CORVID_E_DATABASE` | corvid::Error::Database — opening/creating the file failed |
| `2` | `CORVID_E_TRANSACTION` | corvid::Error::Transaction — beginning a read/write txn failed |
| `3` | `CORVID_E_TABLE` | corvid::Error::Table — opening a storage table failed |
| `4` | `CORVID_E_STORAGE` | corvid::Error::Storage — a storage read/write failed |
| `5` | `CORVID_E_COMMIT` | corvid::Error::Commit — committing a write txn failed |
| `6` | `CORVID_E_SET_DURABILITY` | corvid::Error::SetDurability — changing txn durability failed |
| `7` | `CORVID_E_COMPACTION` | corvid::Error::Compaction — compacting the file failed |
| `8` | `CORVID_E_DECODE` | corvid::Error::Decode — stored bytes are not a decodable Value |
| `9` | `CORVID_E_CORRUPT_INDEX` | corvid::Error::CorruptIndex — persisted index state is corrupt |
| `10` | `CORVID_E_RESERVED_COLLECTION` | corvid::Error::ReservedCollection — name uses the `__` prefix |
| `11` | `CORVID_E_INVALID_NAME` | corvid::Error::InvalidName — name has a NUL byte or interior `__` |
| `12` | `CORVID_E_ARGUMENT` | corvid::Error::InvalidArgument — argument outside its domain (RRF k, MMR lambda, geo bounds) AND the FFI's own NULL/UTF-8 discipline (§7) |
| `13` | `CORVID_E_INCOMPATIBLE_FORMAT` | corvid::Error::IncompatibleFormat — file is a foreign format version |
| `14` | `CORVID_E_EMPTY_INDEX_TRAINING` | corvid::Error::EmptyIndexTraining — PQ create with no training vectors |
| `15` | `CORVID_E_SCHEMA_VIOLATION` | corvid::Error::SchemaViolation — write violates the declared schema |
| `16` | `CORVID_E_INVALID_DUMP` | corvid::Error::InvalidDump — malformed / unknown-version dump stream |
| `17` | `CORVID_E_BACKUP_TARGET_EXISTS` | corvid::Error::BackupTargetExists — backup path already exists |
| `18` | `CORVID_E_IO` | corvid::Error::Io — I/O error (dump/load paths, files) |
| `19` | `CORVID_E_BUSY` | FFI-ONLY: corvid_compact while derived handles are still open (engine Db::compact needs &mut self; see §4.13). No engine variant. |

In Rust, the same failures surface as the typed `corvid::Error` enum
(`thiserror`, `#[non_exhaustive]`); methods return
`corvid::Result<T>`. Bindings map the code to native exceptions
(corvid-node exports this table as `ErrorCode`).
