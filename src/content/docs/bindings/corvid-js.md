---
title: corvid-js
description: The corvid-js browser/Worker binding — the engine compiled to WebAssembly behind wasm-bindgen typed exports: synchronous in-memory OOP (Db/Collection/Query) plus async OPFS persistence (openOpfs/AsyncDb) in a dedicated Worker, the JS value mapping, the quickstart and hybrid examples, and the golden-suite correctness story (267/267 in real Chromium).
sidebar:
  order: 5
---

[`corvid-js`](https://github.com/corvid-db/corvid-js) is the JavaScript
binding for browsers and Web Workers: the engine compiled to
`wasm32-unknown-unknown` (a Rust crate pinned to an exact corvid release
tag) behind **wasm-bindgen typed exports**, wrapped as idiomatic OOP —
a **synchronous in-memory surface** (`Db`, `Collection`, a fluent
`Query` builder, `field()` predicates) and an **async OPFS-persistent
surface** (`openOpfs()` / `AsyncDb`) hosted in a dedicated Worker. No
SQL, no JSON, no serialization on the data path; values cross the
boundary natively.

**When to choose this binding:** your application runs in the browser
or a Worker (edge runtimes, client-side search, offline-first caches,
in-page analytics) and you want an embedded database with
vector/text/hybrid search, graph edges, and geo — without a server
round-trip. The engine ships as one `.wasm` artifact (~379 KB gzipped,
budget-gated at 1 MB in CI); sync-surface calls are synchronous,
persistent-surface calls are Promises.

## Install

```sh
npm i corvid-js
```

The published package carries the prebuilt wasm. To build from source
instead: Rust ≥ 1.88 with the `wasm32-unknown-unknown` target +
[wasm-pack](https://rustwasm.github.io/wasm-pack/), then `npm install
&& npm run build`.

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
`code` table. The async surface additionally rejects `Map`/`Set`/
`Date`, functions, symbols, and cyclic values with `InvalidArgument`
before they cross the worker boundary.

## Persistence (OPFS)

The sync `Db` is in-memory per session. For data that survives reloads,
use the async surface — one OPFS file per database, the engine hosted
in a dedicated Worker, every method a Promise:

```js
import { openOpfs, field } from 'corvid-js';

const db = await openOpfs('notes');     // <OPFS root>/corvid/notes.corvid
const docs = await db.collection('docs');
await docs.insert('k1', { body: 'survives reloads', n: 1 });
const rows = await docs.query().filter(field('n').ge(1)).run();
await docs.close();
await db.close();                        // the OPFS lock frees when this resolves
```

`AsyncDb`/`AsyncCollection`/`AsyncQuery` mirror the sync surface —
every index family, schema, TTL, graph, geo, and the fluent builder
(chain synchronously, terminals are Promises) — with three documented
deviations: `name` is a synchronous getter, `update(key, fn)` composes
get→fn→compare-and-set on the main thread (exact, not racy: OPFS is
single-writer), and `scanEach` streams rows in chunks with early-stop.
The surface also adds `dump()`/`load()`/`loadWithRenames()` (portable
byte streams) and `backupTo(name)` (a physical copy; an existing
target rejects with code 17).

**Single writer, by design.** OPFS grants the database file
exclusively per origin: a second tab's `openOpfs` of an open name
rejects with `Busy` (19), and the lock frees the moment `close()`
resolves. Durability is bounded by the browser's `flush()` semantics;
crash-consistency (a reload mid-commit never corrupts) is the engine's
checksummed format, exactly as on desktop.

**Storage is evictable unless persisted.** Browser storage under
pressure is evicted whole-origin (LRU); Safari may additionally evict
script-created data after 7 idle days. `openOpfs` requests persistent
storage by default (best-effort); monitor with `storageEstimate()`
and verify with `isPersistentStorage()`.

Browser support: the sync surface needs the wasm baseline only; the
OPFS surface needs the OPFS sync-handle baseline — Chrome/Edge 102+,
Firefox 111+, Safari 15.2+ (Chromium is the enforced CI leg). Under
Node the async surface exports nothing — use the sync surface from
`corvid-js/node`. The binding contract is `docs/OPFS-SPEC.md` in the
corvid-js repo (review-gated, like the C ABI's FFI.md).

## Correctness story

The binding replays the engine's **golden suite** — the same fixture
files the C ABI smoke harness runs — against its public API on every
CI run: **267/267 executable lines across all eight fixture files**.
The six in-memory files run against the sync surface in Node *and* in
a real browser (`await init()` — the same spec unchanged); the two
file-backed files (`persist.txt`, `admin.txt`) run against the async
OPFS surface in Chromium end to end — real Worker, real OPFS file,
real postMessage. Browser-only contracts are pinned too: persistence
across a real page reload, and the cross-tab single-writer `Busy` with
the lock freeing exactly when `close()` resolves. A size gate holds
the gzipped wasm under 1 MB (the engine's own reference: 2 MB), and a
surface-manifest gate resolves every engine construct at the pinned
tag to a binding API or a documented N/A.

## Development

```sh
npm install                 # vitest + playwright (Rust + wasm-pack required for the build)
npm run build               # wasm-pack build --release --target web -> pkg/
npm test                    # Node leg: golden (230 lines) + regressions + OPFS suites
npm run test:browser        # the golden suite in real Chromium (await init())
npm run test:e2e            # async OPFS fixtures + reload/cross-tab (Playwright)
npm run size-gate           # gzipped wasm <= 1 MiB
npm run surface-gate        # SURFACE.tsv vs the pinned engine
node examples/hybrid.js     # the examples tour
npm run lint                # cargo fmt --check + clippy -D warnings
```

Next: [the FFI reference](/ffi/overview/).
