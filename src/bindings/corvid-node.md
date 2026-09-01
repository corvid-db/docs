---
title: corvid-node
description: The corvid-node Node.js binding — npm install, OOP usage with Db/Collection/Query/field, the JS value mapping, error handling and the golden-suite correctness story.
sidebar:
 order: 2
---

[`corvid-node`](https://github.com/corvid-db/corvid-node) is the Node.js
binding: the engine compiled in (a Rust napi crate pinned to an exact corvid
release tag), exposed as idiomatic **synchronous OOP** — `Db`, `Collection`,
a fluent `Query` builder, and `field()` predicates. No SQL, no JSON, no
serialization on the data path; values map natively.

## Install

```sh
npm i corvid-node
```

Prebuilt binaries cover `darwin-arm64` / `darwin-x64` / `linux-x64-gnu` /
`linux-arm64-gnu` / `win32-x64-msvc`. Other platforms build from source
(Rust ≥ 1.88 + a C toolchain): `npm run build`.

## Usage

```js
const { Db, field } = require('corvid-node');

const db = Db.open('app.redb');           // or Db.openMemory()
const docs = db.collection('docs');

docs.insert('p1', {
  title: 'rust embedded database',
  kind: 'doc',
  v: new Float32Array([1.0, 0.0]),
});

// hybrid retrieval: filter + vector + BM25, fused (RRF) + reranked (MMR)
const rows = docs
  .query()
  .filter(field('kind').eq('doc'))
  .vector('v', new Float32Array([1.0, 0.0]), 10, 'cosine')
  .text('title', 'rust database', 10)
  .fuseRrf(60)
  .rerankMmr(1.0)
  .limit(5)
  .run();                                  // [{ key, doc, score }]

for (const { key, doc, score } of rows) console.log(key, score, doc.title);

// predicates everywhere (queries and deletes)
docs.deleteWhere(field('kind').eq('draft'));

// scalar/compound/text/geo/vector indexes (incl. quantized + PQ + on-disk)
docs.createVectorIndex('v', 'cosine');

// TTL, graph, geo, schema, CAS, bulk-writes, dump/backup/compact …
docs.close();
db.close();
```

TypeScript types ship in `index.d.ts`; every failure throws a `CorvidError`
carrying the engine error `code` — the C ABI's frozen table, exported as
`ErrorCode` (see [error codes](/reference/error-codes/)).

## Value mapping

| JS | engine |
|---|---|
| `null`, `boolean`, `string` | Null / Bool / Text |
| `number` (integer-valued, ≤ 2^53) | Int — `2` and `2.0` collapse; `CorvidFloat(n)` forces the Float kind |
| `number` (`0.5`, `inf`, `NaN`, `-0.0`), `bigint` | Float / Int (full i64) |
| `Buffer` / `Uint8Array` | Bytes |
| `Float32Array` | Vector |
| `Array` / plain object | Array / Map |

Reading back: Int → `number` (or `bigint` beyond ±2^53); Float → `number`
with f64 bits preserved **except NaN payloads**, which V8 canonicalizes at
the N-API number boundary (`-0.0`, `±inf` are exact; vector elements keep
their f32 bits). Keys are strings (UTF-8) or Buffers.

## Correctness story

The binding replays the engine's **golden suite** — the same 256-line
fixture files the C ABI smoke harness runs — against its public API on every
CI run (`test/golden.spec.ts`). The plan (architecture ruling, OOP surface,
value contract, follow-ups) lives in the repo.

## Development

```sh
npm install                 # @napi-rs/cli + vitest
npm run build               # build the native binary for this platform
npm test                    # the golden suite (256 lines)
npm run lint                # cargo fmt --check + clippy -D warnings
```

Next: the [reference section](/reference/constructs/).
