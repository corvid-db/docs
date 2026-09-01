---
title: Schemas and constraints
description: Optional declared schemas in corvid — FieldType, required and unique constraints, write-time enforcement, NaN and container rules under unique, and the MCP schema tools.
sidebar:
  order: 1
---

Schemas are **optional and opt-in**; schemaless collections are unaffected.
A declared schema is enforced on **write** — existing documents are never
retroactively validated.

```rust
use corvid::schema::{Schema, Field, FieldType};
# use corvid::{Db};
# let db = Db::open_in_memory()?; let c = db.collection("users");
let schema = Schema::new()
    .field(Field::new("name", FieldType::Text).required())
    .field(Field::new("email", FieldType::Text).unique())
    .field(Field::new("age", FieldType::Int));
c.set_schema(&schema)?;   // future writes are validated; violations error
# Ok::<(), corvid::Error>(())
```

`Collection::schema()` reads back the declared fields (`None` when
undeclared).

## Field types

`FieldType::Any | Bool | Int | Float | Text | Bytes | Vector | Array | Map`.
`Any` accepts every value; the others accept their kind exactly. A violation
(type mismatch, missing `required` field, duplicate `unique` value) fails the
write with `Error::SchemaViolation` — and nothing is stored.

## `required`

The field must be present. A `Null` value counts as present (use `Any` +
required checks sparingly; there is no `not-null` constraint distinct from
presence).

## `unique`

No two documents may hold equal values of the field, enforced per write
(insert, batch, patch, update, CAS, `insert_auto`):

- Equality is **storage-level semantic equality** — `NaN` conflicts with
  `NaN` regardless of payload, `-0.0` conflicts with `0.0`, containers
  compare element-wise (see [equality](/language/equality/)). Numeric kinds
  interop: `Int(7)` and `Float(7.0)` collide.
- Works for **non-index-encodable values** (Bytes/Array/Map/Vector) when a
  scalar index exists on the field — and the check keys on the actual stored
  values, so numerically equal-but-distinct stored values never falsely
  reject.
- A unique violation **rolls back the whole write** — including an
  `insert_batch` (the batch is all-or-nothing).
- Delete-then-reinsert of the same value is allowed (uniqueness is over
  live documents).
- A scalar index on the unique field makes enforcement index-served and
  keeps it enforced as values move.

## Where schemas apply

| Path | Behavior |
|---|---|
| `insert` / `insert_batch` / `insert_auto` | validated; violations roll back the write |
| `patch` / `update` / `compare_and_set` | the resulting document must satisfy the schema |
| `set_schema` replacing an existing schema | subsequent writes validated against the new one |
| existing documents | never re-validated |
| dump/load | definitions round-trip; load replays writes through validation |

## MCP tools

The sidecar exposes `set_schema` (fields array of
`{name, type: any|bool|int|float|text|bytes|vector|array|map, required?,
unique?}`) and `get_schema` (`{fields: null}` when none declared) — see
[the MCP sidecar](/admin/mcp/).

Next: [transactions](/integrity/transactions/).
