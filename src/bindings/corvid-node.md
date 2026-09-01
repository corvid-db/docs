---
title: corvid-node
description: The corvid-node Node.js binding — install (pending first npm publish), OOP usage with Db/Collection/Query/field, the JS value mapping, the quickstart and hybrid examples, error handling and the golden-suite correctness story.
sidebar:
 order: 2
---

[`corvid-node`](https://github.com/corvid-db/corvid-node) is the Node.js
binding: the engine compiled in (a Rust napi crate pinned to an exact corvid
release tag), exposed as idiomatic **synchronous OOP** — `Db`, `Collection`,
a fluent `Query` builder, and `field()` predicates. No SQL, no JSON, no
serialization on the data path; values map natively.

**When to choose this binding:** your application is Node.js (servers,
CLIs, tooling) and you want an embedded database with vector/text/hybrid
search, graph edges, and geo — without running a separate database server.
The engine compiles into the process (a prebuilt native binary per
platform), calls are synchronous, and JavaScript values cross the boundary
natively. For browsers, wait for the planned wasm binding; for a system
library you can link from anything, see [corvid-c](/bindings/corvid-c/).

## Install

```sh
npm i corvid-node
```

**Pending first publish** — the package is not on npm yet; publishing waits
on the platform packages existing first (the repo's plan §5). Until then
build from source (Rust ≥ 1.88 + a C toolchain):

```sh
npm install
npm run build
```

Prebuilt binaries (`optionalDependencies`) will cover
`darwin-arm64` / `darwin-x64` / `linux-x64-gnu` / `linux-arm64-gnu` /
`win32-x64-msvc`.

## The examples

Six runnable programs in the repo's `examples/` directory, executed on
every CI leg with deterministic output: **quickstart**, **hybrid** (the
flagship below), **vector-index** (in-memory / on-disk / binary-quantized
HNSW vs the exact scan), **text-search** (BM25 incl. CJK bigram
segmentation), **graph** (neighbors/traverse + delete cascade), and
**geo** (radius / bbox / nearest). The quickstart and hybrid sources are
embedded below — imported from the repo so they cannot drift from what CI
executes (`scripts/sync-binding-examples.sh`; the drift gate reddens docs
CI if they diverge). Run them from a checkout with
`npm run build && node examples/hybrid.js` (they `require('..')`; in an
application, `require('corvid-node')`).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```js
const { Db } = require('..');

const db = Db.openMemory();
const docs = db.collection('docs');

docs.insert('p1', {
  title: 'rust embedded database',
  kind: 'doc',
  v: new Float32Array([1.0, 0.0]),
});
docs.insert('p2', {
  title: 'python web frameworks',
  kind: 'doc',
  v: new Float32Array([0.0, 1.0]),
});
docs.insert('p3', {
  title: 'rust again database',
  kind: 'doc',
  v: new Float32Array([0.9, 0.1]),
});

// kNN: the 3 nearest documents to (1, 0) under cosine.
const rows = docs
  .query()
  .vector('v', new Float32Array([1.0, 0.0]), 3, 'cosine')
  .run(); // [{ key, doc, score }]

let rank = 0;
for (const { key, doc, score } of rows) {
  console.log(`${++rank}. ${key} score=${score.toFixed(6)} ${doc.title}`);
}

docs.close();
db.close();
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```js
const { Db, field } = require('..');

const db = Db.openMemory();
const docs = db.collection('docs');

docs.insert('s1', { kind: 'doc', body: 'rust embedded database', v: new Float32Array([1.0, 0.0]) });
docs.insert('s2', { kind: 'doc', body: 'python web frameworks', v: new Float32Array([0.0, 1.0]) });
docs.insert('s3', { kind: 'doc', body: 'rust again database', v: new Float32Array([0.9, 0.1]) });
docs.insert('m1', { kind: 'meta' }); // filtered out below

// The flagship query: filter + vector + text, RRF + MMR + limit.
const rows = docs
  .query()
  .filter(field('kind').eq('doc'))
  .vector('v', new Float32Array([1.0, 0.0]), 2, 'cosine')
  .text('body', 'rust database', 2)
  .fuseRrf(60)
  .rerankMmr(1.0)
  .limit(2)
  .run(); // [{ key, doc, score }]

let rank = 0;
for (const { key, doc, score } of rows) {
  console.log(`${++rank}. ${key} score=${score.toFixed(6)} ${doc.body}`);
}

docs.close();
db.close();
```

<!-- corvid-examples:hybrid END -->

The fused scores are RRF rank sums: `s1` is rank 1 of both sources
(1/61 + 1/61 = 2/61 ≈ 0.032787), `s3` rank 2 of both (2/62 ≈ 0.032258).

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
CI run (`test/golden.spec.ts`), then executes the six-example tour. The plan
(architecture ruling, OOP surface, value contract, follow-ups) lives in the
repo.

## Development

```sh
npm install                 # @napi-rs/cli + vitest
npm run build               # build the native binary for this platform
npm test                    # the golden suite (256 lines)
node examples/hybrid.js     # the examples tour
npm run lint                # cargo fmt --check + clippy -D warnings
```

Next: [corvid-python](/bindings/corvid-python/).
