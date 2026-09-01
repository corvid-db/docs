---
title: Values
description: The Value type — null, bool, int, float, text, bytes, array, map and first-class vectors; dotted-path access and typed accessors.
sidebar:
  order: 1
---

`Value` is the document and field type — the unit of storage, filtering, and
encoding:

```text
Null · Bool(bool) · Int(i64) · Float(f64) · Text(String)
Bytes(Vec<u8>) · Array(Vec<Value>) · Map(BTreeMap<String, Value>)
Vector(Vec<f32>)        // a dense embedding — first-class
```

Notes on individual kinds:

- **`Int`** is a signed 64-bit integer. **`Float`** is IEEE-754 f64: NaN,
  ±infinity, and −0.0 are preserved bit-exact through storage.
- **`Int` and `Float` interoperate numerically** in filters and comparisons:
  `Int(2)` equals `Float(2.0)`, exact up to 2^53 (beyond that, an i64 may
  round through f64 — see [equality](/language/equality/)).
- **`Text`** must be valid UTF-8 (Rust `String`); **`Bytes`** are opaque.
  Ordering of text is lexicographic by UTF-8 bytes.
- **`Map`** keys are strings; iteration order is sorted by key — construction
  order never matters for equality or encoding. Documents are usually maps.
- **`Vector`** is a dense `f32` embedding. It is a storage/search kind, not a
  math library: no arithmetic is exposed on it. First-class means filters can
  test it (`eq` — element-wise), [unique constraints](/integrity/schema/) can
  police it, and it can serve as a vector-search field.

## Accessors

Typed reads return `Option` — a wrong type is `None`, never an error:

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?;
# let c = db.collection("docs");
# let mut m = std::collections::BTreeMap::new();
# m.insert("age".into(), Value::Int(36));
# m.insert("name".into(), Value::Text("ada".into()));
# c.insert(b"u1", &Value::Map(m))?;
let doc = c.get(b"u1")?.unwrap();
let age: Option<i64> = doc.as_int();
let name: Option<&str> = doc.as_text();
let flag: Option<bool> = doc.as_bool();
let raw: Option<&[u8]> = doc.as_bytes();
let vec: Option<&[f32]> = doc.as_vector();
# let _ = (age, name, flag, raw, vec);
# Ok::<(), corvid::Error>(())
```

`as_float` widens an `Int` to `Option<f64>` as well as reading a `Float`.

## Dotted paths

`Value::get_path` walks nested maps by dotted path:

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?;
# let mut inner = std::collections::BTreeMap::new();
# inner.insert("author".into(), Value::Text("ada".into()));
# let mut doc = std::collections::BTreeMap::new();
# doc.insert("meta".into(), Value::Map(inner));
# let v = Value::Map(doc);
v.get_path("meta.author")   // Some(Text("ada"))
# ;
# Ok::<(), corvid::Error>(())
```

The same dotted paths work in **filters** (`field("meta.score").gt(...)`),
**index definitions** (`create_scalar_index("meta.score")`), and **`select`
projection**. Paths traverse maps only; an empty path resolves nothing.

## Encoding

`Value::encode` / `Value::decode` implement the deterministic on-disk codec —
a tag/length format where tags 0..8 are the value kinds (the C ABI's
`corvid_value_type` mirrors them exactly). Nesting is bounded
(`value::MAX_NESTING`) and enforced on decode. You rarely touch the codec
directly; it is what `dump`/`load` and storage use. Every value variant
round-trips byte-exact — including NaN payloads, −0.0, and empty containers.

## Containers as documents

Any `Value` can be stored as a document — a bare `Int`, a text blob, an
array. Map documents are the common case because dotted paths, `patch`,
`select` projection, and schemas are map-shaped operations; non-map documents
pass through queries and scans unchanged (`select` returns them as-is).

Next: [writes](/language/writes/) — every way to mutate a collection.
