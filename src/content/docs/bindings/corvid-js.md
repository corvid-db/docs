---
title: corvid-js
description: The corvid-js browser/Worker binding — the engine compiled to WebAssembly behind wasm-bindgen typed exports, synchronous OOP with Db/Collection/Query, the JS value mapping, in-memory-per-session persistence boundary (OPFS planned), the quickstart and hybrid examples, and the golden-suite correctness story.
sidebar:
  order: 5
---

[`corvid-js`](https://github.com/corvid-db/corvid-js) is the JavaScript
binding for browsers and Web Workers: the engine compiled to
`wasm32-unknown-unknown` (a Rust crate pinned to an exact corvid release
tag) behind **wasm-bindgen typed exports**, wrapped as idiomatic
**synchronous OOP** — `Db`, `Collection`, a fluent `Query` builder, and
`field()` predicates. No SQL, no JSON, no serialization on the data
path; values cross the boundary natively.

**When to choose this binding:** your application runs in the browser
or a Worker (edge runtimes, client-side search, offline-first caches,
in-page analytics) and you want an embedded database with
vector/text/hybrid search, graph edges, and geo — without a server
round-trip. The engine ships as one `.wasm` artifact (~363 KB gzipped
at bootstrap, budget-gated at 1 MB in CI); every call is synchronous.

**The persistence boundary, stated plainly: a `Db` is in-memory per
session.** wasm has no filesystem, so nothing survives a page reload
today — OPFS-backed persistence is a *decided* addition whose
implementation program is now underway (the binding contract:
`docs/OPFS-SPEC.md` in the corvid-js repo; a Worker-hosted engine over
an OPFS storage backend, with an async `openOpfs()` API alongside the
sync in-memory surface). This page documents the shipped in-memory
behavior until that lands. Everything else the engine does — every
index family, schemas, TTL, graph, geo, hybrid queries — works and is
pinned by the engine's golden fixtures.

## Install

```sh
npm i corvid-js
```

**Pending first publish** — 0.3.2 is fully staged (wasm built against
the v0.3.2 engine pin, gates green, tarball verified) but the
publishing npm account enforces 2FA, so the publish itself needs a
one-time password. Build from source meanwhile (Rust ≥ 1.88 with the
`wasm32-unknown-unknown` target
+ [wasm-pack](https://rustwasm.github.io/wasm-pack/)):

```sh
npm install
npm run build
```

## The examples

Six runnable programs in the repo's `examples/` directory, executed on
every CI leg with deterministic output: **quickstart**, **hybrid** (the
flagship below), **vector-index** (in-memory / on-disk-mode /
binary-quantized HNSW vs the exact scan), **text-search** (BM25 incl.
CJK bigram segmentation and v0.3.0 phrase search), **graph**
(neighbors/traverse + delete cascade), and **geo** (radius / bbox /
nearest). The quickstart and hybrid sources are embedded below —
imported from the repo so they cannot drift from what CI executes
(`scripts/sync-binding-examples.sh`; the drift gate reddens docs CI if
they diverge). The files run as Node scripts against the same wasm
binary browsers load — in a browser only the loader line differs:

```js
import { Db, init } from 'corvid-js';
await init();          // fetch + instantiate the wasm module (the only async part)
const db = new Db();   // ...everything below, unchanged
```

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```js
import { Db } from '../node.mjs';

const db = new Db();
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
import { Db, field } from '../node.mjs';

const db = new Db();
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
| `Uint8Array` (Buffer included) | Bytes |
| `Float32Array` | Vector |
| `Array` / plain object | Array / Map |

Reading back: Int → `number` (or `bigint` beyond ±2^53); Float →
`number` with f64 bits preserved **except NaN payloads**, which
canonicalize across the JS↔wasm Number boundary (`-0.0`, `±inf` are
exact; vector elements keep their f32 bits). Keys are strings (UTF-8)
or Uint8Arrays. `Object.keys()` of a mapped document enumerates the
engine's ascending key-byte order — the JS form of the ABI's v0.3.0
`map_keys` surface. Errors are `CorvidError` with the frozen C-ABI
`code` table.

## Correctness story

The binding replays the engine's **golden suite** — the same fixture
files the C ABI smoke harness runs — against its public API on every
CI run: 230/230 executable lines across the six in-memory fixture
files, including the v0.3.0 `VMAP_KEYS` and `PHRASE` additions. The
two file-backed fixture files (`persist.txt`, `admin.txt`) are not
vendored — their scenarios are exactly the deferred persistence
boundary; their in-memory-executable contracts (the compact
quiescence gate, collections listing, session durability) are pinned
by the binding's regression suite. The suite runs under node's wasm
runtime against the same binary browsers load. A size gate holds the
gzipped wasm under 1 MB (the engine's own reference: 2 MB), and a
surface-manifest gate resolves every engine construct at the pinned
tag to a binding API or a documented N/A.

## Development

```sh
npm install                 # vitest (Rust + wasm-pack required for the build)
npm run build               # wasm-pack build --release --target web -> pkg/
npm test                    # the golden suite (230 lines) + regressions
node examples/hybrid.js     # the examples tour
npm run lint                # cargo fmt --check + clippy -D warnings
```

Next: [the FFI reference](/ffi/overview/).
