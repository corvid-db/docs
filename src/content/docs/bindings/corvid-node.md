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

**Pending first publish** — the release pipeline is wired (a
`npm-publish-v*` tag push builds the platform matrix and publishes
`corvid-node-<platform>` then this package) but it waits on the repo's
`NPM_TOKEN` secret. Until then build from source (Rust ≥ 1.88 + a C
toolchain):

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
segmentation, plus the v0.3.0 direct `phraseSearch()`), **graph**
(neighbors/traverse + delete cascade), and
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
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```js
const { rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const { Db } = require('..');

const PATH = join(tmpdir(), 'corvid-node-example-vector-index.redb');
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

rmSync(PATH, { force: true }); // reruns start clean (single-file db)

let db = Db.open(PATH);
let docs = db.collection('items');
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
runQuery(docs, 'v_disk', true, 'ann on-disk HNSW:');
runQuery(docs, 'v_q', true, 'ann binary-quantized:');
console.log('(the quantized lane trades recall for a ~32x smaller index)');

docs.close();
db.close();

// Reopen: the on-disk graph reloads (no rebuild) and answers again.
db = Db.open(PATH);
docs = db.collection('items');
runQuery(docs, 'v_disk', true, 'ann on-disk after reopen:');
docs.close();
db.close();

rmSync(PATH, { force: true });
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```js
const { Db } = require('..');

const db = Db.openMemory();
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
const { Db } = require('..');

const db = Db.openMemory();
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
const { Db } = require('..');

const db = Db.openMemory();
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
| `the JS value mapping (null/boolean/number/bigint/string/Buffer/Float32Array/Array/object)` | 10 | golden:values.txt:VTYPE |
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
| `ErrorCode.BackupTargetExists (code 17)` | 1 | regressions:error-code table is frozen; golden:admin.txt:BACKUP_DUP(err:17) |
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
| `Db` | 1 | golden:admin.txt:FILEDB |
| `Db.open/openMemory/collection/collections/backup/compact` | 6 | golden:admin.txt (COLLECTIONS/BACKUP/COMPACT) |
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
| `Row.score (Query.vector().run())` | 1 | golden:queries.txt:QVEC |
| `Row.score (Query.text().run())` | 1 | golden:queries.txt:QTEXT |
| `Collection#phraseSearch(field, phrase, k) — the direct positional search over the engine method` | 1 | golden:queries.txt:PHRASE |
| `Query.fuseRrf default k=60` | 1 | golden:queries.txt:HYBRID |
| `GeoHit { key, doc, distanceKm }` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `Collection.geoWithinRadius/geoNearest/geoWithinBBox/createGeoIndex` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `Collection.link/linkWeighted/unlink/neighbors/inNeighbors/neighborsWeighted/traverse` | 7 | golden:graph.txt |
| `Collection.createScalarIndex/createCompoundIndex/createTextIndex[/Ondisk]/createGeoIndex/createVectorIndex* (6 variants)` | 10 | golden:schema.txt:IDX_* |
| `FieldType union ('any'|'bool'|'int'|'float'|'text'|'bytes'|'vector'|'array'|'map')` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `Collection.setSchema/schema + SchemaField { name, type, required, unique }` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `Collection.insertWithTtl/setTtl/getTtl/purgeExpired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `Db.dumpToPath/loadFromPath/loadFromPathWithRenames` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) |

159 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

The [TypeScript definitions](https://github.com/corvid-db/corvid-node/blob/master/index.d.ts) in the repo (`index.d.ts` + the generated `index-native.d.ts`) are the reference — editor-inline and versioned with the package.


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

The binding replays the engine's **golden suite** — the same 267-line
fixture files the C ABI smoke harness runs — against its public API on every
CI run (`test/golden.spec.ts`), then executes the six-example tour. The plan
(architecture ruling, OOP surface, value contract, follow-ups) lives in the
repo.

## Development

```sh
npm install                 # @napi-rs/cli + vitest
npm run build               # build the native binary for this platform
npm test                    # the golden suite (267 lines)
node examples/hybrid.js     # the examples tour
npm run lint                # cargo fmt --check + clippy -D warnings
```

Next: [corvid-python](/bindings/corvid-python/).
