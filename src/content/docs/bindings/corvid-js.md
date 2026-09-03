---
title: corvid-js
description: The corvid-js browser/Worker binding — the engine compiled to WebAssembly behind wasm-bindgen typed exports, with a synchronous in-memory surface (Db/Collection/Query) plus async OPFS persistence (openOpfs/AsyncDb) in a dedicated Worker, the JS value mapping, the quickstart and hybrid examples, and the golden-suite correctness story (267/267 in real Chromium).
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
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```js
import { Db } from '../node.mjs';

const PROBE = new Float32Array([1.0, 0.0, 0.0, 0.0]);

const CORPUS = [
  ['k0', [1.0, 0.0, 0.0, 0.0]], // nearest
  ['k1', [0.95, 0.05, 0.0, 0.0]],
  ['k2', [0.0, 1.0, 0.0, 0.0]],
  ['k3', [0.0, 0.9, 0.1, 0.0]],
  ['k4', [0.0, 0.0, 1.0, 0.0]],
  ['k5', [0.7, 0.7, 0.0, 0.0]],
  ['k6', [0.0, 0.0, 0.0, 1.0]],
  ['k7', [0.98, 0.02, 0.0, 0.0]],
];

function runQuery(docs, field, approx, label) {
  let q = docs.query().vector(field, PROBE, 4, 'cosine');
  if (approx) q = q.approx();
  const rows = q.run();
  const parts = rows.map(({ key, score }) => `${key}(${score.toFixed(6)})`);
  console.log(label.padEnd(38), parts.join(' '));
}

const db = new Db();
const docs = db.collection('items');
for (const [key, v] of CORPUS) {
  const vec = new Float32Array(v);
  docs.insert(key, { v_mem: vec, v_disk: vec, v_q: vec });
}
docs.createVectorIndex('v_mem', 'cosine');
docs.createVectorIndexOndisk('v_disk', 'cosine');
docs.createVectorIndexQuantized('v_q', 'cosine', 'binary');

console.log('top-4 nearest to (1,0,0,0) under cosine:');
runQuery(docs, 'v_mem', false, 'exact (scan):');
runQuery(docs, 'v_mem', true, 'ann in-memory HNSW:');
runQuery(docs, 'v_disk', true, 'ann on-disk-mode HNSW:');
runQuery(docs, 'v_q', true, 'ann binary-quantized:');
console.log('(the quantized lane trades recall for a ~32x smaller index)');

docs.close();
db.close();
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```js
import { Db } from '../node.mjs';

const db = new Db();
const notes = db.collection('notes');

notes.insert('n1', { body: 'the quick brown fox jumps over the lazy dog' });
notes.insert('n2', { body: 'a quick red fox leaps over a sleeping dog' });
notes.insert('n3', { body: 'slow green turtle crosses the road' });
notes.insert('n4', { body: '东京是一座巨大的城市' });   // Tokyo is a huge city
notes.insert('n5', { body: '大阪是关西最大的城市' });   // Osaka is Kansai's biggest city
notes.insert('n6', { body: '机器学习正在改变数据库' }); // ML is changing databases

notes.createTextIndex('body');

function search(query, label) {
  const rows = notes.query().text('body', query, 3).run();
  const parts = rows.map(({ key, score }) => `${key}(${score.toFixed(6)})`);
  console.log(label.padEnd(28), '->', parts.join(' '));
}

function phrase(query, label) {
  const rows = notes.phraseSearch('body', query, 3);
  const parts = rows.map(({ key, score }) => `${key}(${score.toFixed(6)})`);
  console.log(label.padEnd(28), '->', parts.join(' '));
}

search('quick fox', 'bm25 "quick fox":');
search('quick dog', 'bm25 "quick dog":');
search('城市', 'bm25 CJK 城市 (city):');
search('数据库', 'bm25 CJK 数据库 (database):');

phrase('fox jumps over', 'phrase "fox jumps over":');
phrase('over jumps fox', 'phrase reversed (no match):');
phrase('leaps over a sleeping', 'phrase stop words collapsed:');

notes.close();
db.close();
```

<!-- corvid-examples:text_search END -->
### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```js
import { Db } from '../node.mjs';

const db = new Db();
const nodes = db.collection('nodes');

for (const key of ['ga', 'gb', 'gc']) nodes.insert(key, { n: key });

nodes.link('ga', 'parent_of', 'gb');
nodes.link('ga', 'parent_of', 'gc');
nodes.link('gb', 'parent_of', 'gd'); // gd never exists as a document
nodes.linkWeighted('ga', 'route', 'gb', 2.5);
nodes.linkWeighted('ga', 'route', 'gd', 0.75);

const fmt = (keys) => `[${keys.join(' ')}]`;
console.log('neighbors(ga)'.padEnd(36), fmt(nodes.neighbors('ga', 'parent_of')));
console.log('in_neighbors(gb)'.padEnd(36), fmt(nodes.inNeighbors('gb', 'parent_of')));
const routes = nodes
  .neighborsWeighted('ga', 'route')
  .map(({ key, weight }) => `${key}=${weight.toFixed(2)}`)
  .join(' ');
console.log('routes from ga (weighted):'.padEnd(36), `[${routes}]`);
console.log('traverse(ga, 1 hop)'.padEnd(36), fmt(nodes.traverse('ga', 'parent_of', 1)));
console.log('traverse(ga, 2 hops)'.padEnd(36), fmt(nodes.traverse('ga', 'parent_of', 2)));

// Delete cascade: remove gc (a document) and gd (never a document).
console.log('delete gc: existed=', nodes.delete('gc'));
console.log('delete gd: existed=', nodes.delete('gd'), '(never a document; its edges still cascade)');

console.log('neighbors(ga) after deletes'.padEnd(36), fmt(nodes.neighbors('ga', 'parent_of')));
console.log('neighbors(gb) after deletes'.padEnd(36), fmt(nodes.neighbors('gb', 'parent_of')));
console.log('traverse(ga, 2 hops) after'.padEnd(36), fmt(nodes.traverse('ga', 'parent_of', 2)));

nodes.close();
db.close();
```

<!-- corvid-examples:graph END -->
### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```js
import { Db } from '../node.mjs';

const db = new Db();
const places = db.collection('places');

places.insert('berlin', { name: 'berlin', loc: [52.52, 13.4] });
places.insert('potsdam', { name: 'potsdam', loc: [52.4, 13.06] });
places.insert('hamburg', { name: 'hamburg', loc: [53.55, 9.99] });
places.insert('munchen', { name: 'munchen', loc: [48.14, 11.58] });

places.createGeoIndex('loc');

const fmt = (hits) =>
  `[${hits.map(({ key, distanceKm }) => `${key} ${distanceKm.toFixed(6)}km`).join(' ')}]`;

console.log(
  'within 600km of Berlin:'.padEnd(34),
  fmt(places.geoWithinRadius('loc', 52.52, 13.4, 600.0)),
);
console.log(
  'bbox 47..55N, 5..15E:'.padEnd(34),
  fmt(places.geoWithinBBox('loc', 47, 5, 55, 15)),
);
console.log(
  'nearest 2 to Berlin:'.padEnd(34),
  fmt(places.geoNearest('loc', 52.52, 13.4, 2)),
);

places.close();
db.close();
```

<!-- corvid-examples:geo END -->





The fused scores are RRF rank sums: `s1` is rank 1 of both sources
(1/61 + 1/61 = 2/61 ≈ 0.032787), `s3` rank 2 of both (2/62 ≈ 0.032258).

## API at a glance

Generated from the binding's `docs/SURFACE.tsv` (every engine
construct at the pinned tag mapped or N/A with a reason) — regenerated
by the docs sync, so it cannot drift.

<!-- corvid-api-glance BEGIN -->

| API group | engine constructs | proven by |
|---|---|---|
| `the JS value mapping (null/boolean/number/bigint/string/Uint8Array/Float32Array/Array/object)` | 10 | golden:values.txt:VTYPE |
| `FieldRef eq/ne/lt/le/gt/ge` | 7 | golden:queries.txt:QF_* |
| `Predicate via field()/and()/or()/not()` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN |
| `Metric type ('cosine' | 'dot' | 'l2')` | 4 | golden:queries.txt:QVEC |
| `Quantization type ('none' | 'binary' | 'scalar')` | 4 | golden:schema.txt:IDX_VEC_Q |
| `throws CorvidError` | 1 | golden:mutations.txt:INSERT_ERR |
| `CorvidError.code (ErrorCode table)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.Database (code 1)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.Transaction (code 2)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.Table (code 3)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.Storage (code 4)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.Commit (code 5)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.SetDurability (code 6)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.Compaction (code 7)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.Decode (code 8)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.CorruptIndex (code 9)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.ReservedCollection (code 10)` | 1 | regressions:error-code table is frozen; golden:mutations.txt:INSERT_ERR(err:10) |
| `ErrorCode.InvalidName (code 11)` | 1 | regressions:error-code table is frozen; golden:mutations.txt:INSERT_ERR(err:11) |
| `ErrorCode.InvalidArgument (code 12)` | 1 | regressions:error-code table is frozen; golden:mutations.txt:UPDATE_ABORT(err:12) |
| `ErrorCode.IncompatibleFormat (code 13)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.EmptyIndexTraining (code 14)` | 1 | regressions:error-code table is frozen; golden:schema.txt:IDX_PQ_ERR(err:14) |
| `ErrorCode.SchemaViolation (code 15)` | 1 | regressions:error-code table is frozen; golden:schema.txt:SCHEMA_ERR(err:15) |
| `ErrorCode.InvalidDump (code 16)` | 1 | regressions:error-code table is frozen |
| `ErrorCode.BackupTargetExists (code 17)` | 1 | regressions:error-code table is frozen (the code's file-target trigger is unconstructible on wasm) |
| `ErrorCode.Io (code 18)` | 1 | regressions:error-code table is frozen |
| `Row { key, doc, score }` | 1 | golden:queries.txt |
| `Query (Collection.query())` | 2 | golden:queries.txt |
| `Query.filter` | 1 | golden:queries.txt:QF_COUNT |
| `Query.vector` | 1 | golden:queries.txt:QVEC |
| `Query.text` | 1 | golden:queries.txt:QTEXT |
| `Query.fuseRrf` | 1 | golden:queries.txt:HYBRID_F |
| `Query.rerankMmr` | 1 | golden:queries.txt:HYBRID |
| `Query.limit` | 1 | golden:queries.txt:ORDER_BY |
| `Query.offset` | 1 | golden:queries.txt:ORDER_BY |
| `Query.orderBy` | 1 | golden:queries.txt:ORDER_BY |
| `Query.approx` | 1 | golden:queries.txt:APPROX |
| `Query.select` | 1 | golden:queries.txt:SELECT |
| `Query.count` | 1 | golden:queries.txt:AGG_COUNT |
| `Query.groupCount` | 1 | golden:queries.txt:AGG_GCOUNT |
| `Query.sum` | 1 | golden:queries.txt:AGG_SUM |
| `Query.avg` | 1 | golden:queries.txt:AGG_AVG |
| `Query.min` | 1 | golden:queries.txt:AGG_MIN |
| `Query.max` | 1 | golden:queries.txt:AGG_MAX |
| `Query.countDistinct` | 1 | golden:queries.txt:AGG_DISTINCT |
| `Query.groupSum` | 1 | golden:queries.txt:AGG_GSUM |
| `Query.groupAvg` | 1 | golden:queries.txt:AGG_GAVG |
| `Query.run` | 1 | golden:queries.txt:QVEC |
| `Db (new Db() / Db.openMemory)` | 1 | regressions:session durability; golden:queries.txt (COLL/INSERT) |
| `the persistent twin: openOpfs(name) — the engine Db over an OPFS sync handle in a dedicated Worker, Promise-flavored (ASYNC; docs/OPFS-SPEC.md §3.3); the path form stays unconstructible on wasm32, which is why the seam twin below carries the mechanism` | 1 | e2e:persist.txt FILEDB/REOPEN; opfs-async:cross-tab BUSY + reopen |
| `new Db() / Db.openMemory()` | 1 | regressions:session durability; golden:mutations.txt:COLL |
| `OpfsBackend (src/opfs.rs) over the worker's corvidOpfs shims — WasmDb.openOpfs is this seam's binding consumer (ASYNC)` | 1 | opfs-async suite (DirectLink, fake handles) + browser e2e legs (real OPFS) |
| `Db.collection` | 1 | golden:mutations.txt:COLL |
| `AsyncDb.backupTo(name) — the physical copy into a second OPFS file; the caller (worker env) owns the exists-check and debris cleanup, exactly the backend form's contract (ASYNC)` | 1 | opfs-async:backupTo (17 on duplicate, no debris); e2e:admin.txt BACKUP/BACKUP_DUP |
| `WasmDb.backupOpfs(targetHandleId) over a second registered sync handle — the engine seam AsyncDb.backupTo consumes (ASYNC)` | 1 | opfs-async:backupTo debris test; e2e:admin.txt BACKUP |
| `Db.compact` | 1 | regressions:compact quiescence gate (busy 19 with handles open, quiescent pass, data intact) |
| `Db.collections` | 1 | regressions:collections listing (admin.txt's in-memory-executable CONTRACT; the file-db scenario is not vendored) |
| `Collection` | 1 | golden:mutations.txt:COLL |
| `Collection.insert/update/patch/compareAndSet` | 4 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `Collection.scanEach` | 1 | golden:mutations.txt:SCAN/SCAN_STOP |
| `Collection.len / Collection.isEmpty` | 2 | golden:mutations.txt:LEN |
| `Collection.insertMany` | 1 | golden:mutations.txt:PUTMANY + golden:schema.txt:PUTMANY_ROLLBACK |
| `Collection.insertAuto` | 1 | golden:mutations.txt:INSERT_AUTO |
| `Collection.get` | 1 | golden:mutations.txt:GET |
| `Collection.delete/deleteWhere/deleteBatch` | 3 | golden:mutations.txt (DELETE/DELETE_WHERE/DELETE_BATCH) |
| `Collection.scan` | 1 | golden:mutations.txt:SCAN |
| `Collection.page / Page` | 2 | golden:mutations.txt:PAGE |
| `the OpfsBackend implements this seam — every persistent open goes through it (ASYNC; the engine-side twin is exercised by the engine's own tests/backend.rs)` | 1 | opfs:openOpfs persists across close/reopen; e2e:persist.txt |
| `the backup target's OpfsBackend — backupOpfs's engine seam (ASYNC)` | 1 | opfs-async:backupTo; e2e:admin.txt BACKUP |
| `Row.score (Query.vector().run())` | 1 | golden:queries.txt:QVEC |
| `Row.score (Query.text().run())` | 1 | golden:queries.txt:QTEXT |
| `Collection.phraseSearch (BM25 phrase-sum scores, order-sensitive adjacency)` | 1 | golden:queries.txt:PHRASE/PHRASE_K0 |
| `Query.fuseRrf default k=60` | 1 | golden:queries.txt:HYBRID |
| `GeoHit { key, doc, distanceKm }` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `Collection.geoWithinRadius/geoNearest/geoWithinBBox/createGeoIndex` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `Collection.link/linkWeighted/unlink/neighbors/inNeighbors/neighborsWeighted/traverse` | 7 | golden:graph.txt |
| `Collection.createScalarIndex/createCompoundIndex/createTextIndex[/Ondisk]/createGeoIndex/createVectorIndex* (6 variants)` | 10 | golden:schema.txt:IDX_* |
| `FieldType union ('any'|'bool'|'int'|'float'|'text'|'bytes'|'vector'|'array'|'map')` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `Collection.setSchema/schema + SchemaField { name, type, required, unique }` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `Collection.insertWithTtl/setTtl/getTtl/purgeExpired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `AsyncDb.dump(): Promise<Uint8Array> — the byte-stream form (a whole-db Vec<u8> in the worker), transferred across the worker boundary (ASYNC)` | 1 | opfs-async:dump/load/renames roundtrip; e2e:admin.txt DUMP/LOAD |
| `AsyncDb.load(bytes) — merge replay of a dump stream into the open OPFS database (ASYNC)` | 1 | opfs-async:dump/load; e2e:admin.txt LOAD |
| `AsyncDb.loadWithRenames(bytes, Record<string,string>) — the facade decomposes the map onto the parallel-array wire the wasm layer takes (ASYNC)` | 1 | opfs-async:dump/load/renames; e2e:admin.txt LOAD_RENAMES (incl. the err:11 invalid target) |

155 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

The [TypeScript definitions](https://github.com/corvid-db/corvid-js/blob/master/index.d.ts) in the repo are the reference — editor-inline and versioned with the package (sync + async surfaces, the OPFS types).


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
