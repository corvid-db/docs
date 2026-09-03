---
title: corvid-php
description: The corvid-php binding — a native PHP extension in C over the published FFI artifacts, Corvid\Db / Corvid\Collection / fluent Corvid\Query, Corvid\Exception with the engine error table, the honest FPM/ZTS lifecycle story, and the golden-suite correctness floor.
sidebar:
  order: 9
---

[`corvid-php`](https://github.com/corvid-db/corvid-php) is the PHP binding:
a **native PHP extension in C** linking the engine's **published FFI
artifacts** (the platform cdylib and `corvid.h`). Deliberately the
corvid-c/corvid-go pattern (a fetched, checksummed shared library —
`./fetch.sh` sha256-verifies the pinned release archive and
`phpize && configure && make` links it), not an `FFI\FFI` script binding
and not a Rust-source build: PHP users install extensions, not
toolchains, and the ecosystem's install story for native code — PIE/
PECL — compiles exactly this shape against a `phpize` toolchain PHP
distributions already ship.

**When to choose this binding:** your project is PHP and you want
corvid embedded with the language's own shape — real classes with
refcounted handle lifetimes, `Corvid\Exception` carrying the engine's
error-code table, and arrays/strings mapped the way PHP actually uses
them (with `Corvid\Bytes` / `Corvid\Vector` as the type tags that keep
bytes-vs-text and arrays-vs-embeddings distinguishable).

## The idiom mapping

| C ABI | corvid-php |
| --- | --- |
| opaque handles (`corvid_db*`, …) | `Corvid\Db` / `Corvid\Collection` / `Corvid\Query` / `Corvid\Predicate` — real PHP objects; the object destructor is the free path (`Db::close()` is the explicit, idempotent shortcut) |
| `CORVID_ERR` + thread-local last error | `Corvid\Exception` — `getCode()` carries the `corvid_err` table (`Corvid\Exception::CODE_*`); every wrapper reads the thread-local slot immediately after the failing call, on the same thread, and the message rides the exception — no separate last-error fetch in the public API |
| frozen enums | `Corvid\Metric`, `Corvid\Quant`, `Corvid\FieldDef::TYPE_*` class constants (exact ABI values) |
| consumed-by-call args (pred trees, builders) | `run()` and every aggregate consume the builder; abandoned builders/predicates are freed by their destructors, guarded by consumed flags so the ABI's double-free UB class cannot happen |
| cursors (`rows`, `geohits`, `groupiter`, …) | walked to exhaustion **inside** the producing call — a plain PHP array of decoded `Corvid\Row`/`Corvid\GeoHit`/… objects crosses back; nothing borrowed escapes |
| `corvid_update_fn` / `corvid_scan_fn` | ordinary PHP callables; a throwing callback aborts/stops through the ABI's §1.6 contract with the exception caught at the C trampoline boundary (never unwound through C frames) and re-thrown after the engine call returns |
| strings / bytes / vectors | `string` (UTF-8 text) / `Corvid\Bytes` (binary-safe) / `Corvid\Vector` (f32 array) — plus `Corvid\Values` for the engine-side value interrogations (`type()`, `len()`, `asInt()`, `mapKeys()`, …) |

Documents are plain PHP arrays: an assoc array encodes as the engine's
Map (the document shape; an empty array is an empty Map), a list array
as the engine's Array, `Corvid\Vector` as the f32 embedding, and
`Corvid\Bytes` for binary payloads — `"\x00\xff"` round-trips exactly.
NaN / ±INF / -0.0 cross bit-exact.

## Install

From the pinned release artifacts:

```sh
./fetch.sh                    # fetch + sha256-verify corvid v0.3.2 into deps/current
./scripts/build-ext.sh        # phpize + configure + make (needs PHP 8.3+ dev headers)
php -d extension=ext/corvid/modules/corvid.so examples/quickstart.php
```

Requirements: PHP 8.3+ with dev headers (`phpize`/`php-config`), a C
compiler, `curl` + `shasum`/`sha256sum`. The floor is 8.3 and CI tests
8.4 (latest) + 8.3 (floor), NTS, plus a linux **ZTS** leg running the
identical golden suite — the extension declares no request-scoped
globals at all. Once published, the install story is
`pie install corvid/php-corvid` (PECL/PIE — pending first release; the
repo carries the `package.xml`).

## Lifecycle: CLI, workers, FPM, ZTS

The honest PHP story, ruled in the repo's `docs/PLAN.md`:

- **CLI and long-running workers** (queues, ReactPHP, RoadRunner-style
  persistent workers) are the natural fit — open a `Corvid\Db` once and
  serve unbounded work from it.
- **Under FPM**, handles die with refcount, not with the request: a
  `Db` parked in a global survives request shutdown for as long as
  userland holds a reference. That is a userland decision, documented,
  not policed — there is no extension-owned handle registry to sweep.
- **ZTS** is safe per the ABI's threading rules (`Arc<Db>` sharing),
  and the one sharp edge — the thread-local last-error slot — is closed
  by construction: the failing call and its error read share the
  wrapper's C frame, and a PHP request is pinned to one interpreter
  thread. The CI ZTS leg executes this posture on every run.
- **Callbacks** (`update`, `scan`): do not call back into corvid from
  inside one (the ABI's no-reentrancy contract) — UB or a deadlock,
  not a checked error; documented, not policed.

## The v0.3.0 surface

`Corvid\Values::mapKeys()` walks the engine's §4.4 map-key iterator
(ascending key-byte order; non-maps answer `[]` — inert), and
`Collection::phraseSearch($field, $phrase, $k)` is the direct
positional search — consecutive, in-order analyzed tokens, stop words
collapsing out of adjacency, rows carrying the BM25 phrase score;
`$k === 0` answers `[]`, never an error. The `text_search` example
demonstrates all of it, CJK bigram phrases included.

## The examples

Six runnable programs under the repo's `examples/` directory
(`php -d extension=…/corvid.so examples/<name>.php`), executed on every
CI leg with deterministic output: **quickstart**, **hybrid** (the
flagship below), **vector_index** (in-memory / on-disk /
binary-quantized HNSW vs the exact scan, plus a close/reopen),
**text_search** (BM25 incl. CJK bigram segmentation, plus the v0.3.0
direct `phraseSearch`), **graph** (neighbors/traverse + delete
cascade), and **geo** (radius / bbox / nearest with haversine
kilometres). The quickstart and hybrid sources are embedded below —
imported from the repo so they cannot drift from what CI executes
(`scripts/sync-binding-examples.sh`; the drift gate reddens docs CI if
they diverge).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```php
$db = Corvid\Db::openMemory();
$docs = $db->collection('docs');

$docs->insert('p1', [
    'title' => 'rust embedded database',
    'kind' => 'doc',
    'v' => new Corvid\Vector([1.0, 0.0]),
]);
$docs->insert('p2', [
    'title' => 'python web frameworks',
    'kind' => 'doc',
    'v' => new Corvid\Vector([0.0, 1.0]),
]);
$docs->insert('p3', [
    'title' => 'rust again database',
    'kind' => 'doc',
    'v' => new Corvid\Vector([0.9, 0.1]),
]);

// kNN: the 3 nearest documents to (1, 0) under cosine. The builder
// methods chain; run() consumes the builder and every row carries its
// decoded document.
$rows = $docs->query()
    ->vector('v', new Corvid\Vector([1.0, 0.0]), 3, Corvid\Metric::COSINE)
    ->run();

foreach ($rows as $rank => $r) {
    printf("%d. %s score=%.6f %s\n", $rank + 1, $r->key, $r->score, $r->doc['title']);
}
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```php
$db = Corvid\Db::openMemory();
$docs = $db->collection('docs');

$docs->insert('s1', [
    'kind' => 'doc', 'body' => 'rust embedded database',
    'v' => new Corvid\Vector([1.0, 0.0]),
]);
$docs->insert('s2', [
    'kind' => 'doc', 'body' => 'python web frameworks',
    'v' => new Corvid\Vector([0.0, 1.0]),
]);
$docs->insert('s3', [
    'kind' => 'doc', 'body' => 'rust again database',
    'v' => new Corvid\Vector([0.9, 0.1]),
]);
$docs->insert('m1', ['kind' => 'meta']); // filtered out below

// The flagship query: filter + vector + text, RRF + MMR + limit.
$rows = $docs->query()
    ->filter((new Corvid\Field('kind'))->eq('doc'))
    ->vector('v', new Corvid\Vector([1.0, 0.0]), 2, Corvid\Metric::COSINE)
    ->text('body', 'rust database', 2)
    ->fuseRrf(60.0)
    ->rerankMmr(1.0)
    ->limit(2)
    ->run();

foreach ($rows as $rank => $r) {
    printf("%d. %s score=%.6f %s\n", $rank + 1, $r->key, $r->score, $r->doc['body']);
}
```

<!-- corvid-examples:hybrid END -->
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```php
$path = sys_get_temp_dir() . '/corvid-php-example-vector-index.redb';
@unlink($path); // reruns start clean (single-file db)

$corpus = [
    ['k0', [1.0, 0.0, 0.0, 0.0]], // nearest
    ['k1', [0.95, 0.05, 0.0, 0.0]],
    ['k2', [0.0, 1.0, 0.0, 0.0]],
    ['k3', [0.0, 0.9, 0.1, 0.0]],
    ['k4', [0.0, 0.0, 1.0, 0.0]],
    ['k5', [0.7, 0.7, 0.0, 0.0]],
    ['k6', [0.0, 0.0, 0.0, 1.0]],
    ['k7', [0.98, 0.02, 0.0, 0.0]],
];
$probe = [1.0, 0.0, 0.0, 0.0];

function runQuery(Corvid\Collection $items, string $field, bool $approx, string $label, array $probe): void
{
    $q = $items->query()->vector($field, new Corvid\Vector($probe), 4, Corvid\Metric::COSINE);
    if ($approx) {
        $q->approx();
    }
    $rows = $q->run();
    printf('%-38s', $label);
    foreach ($rows as $r) {
        printf(' %s(%.6f)', $r->key, $r->score);
    }
    echo "\n";
}

$db = Corvid\Db::open($path);
$items = $db->collection('items');
foreach ($corpus as [$key, $v]) {
    $items->insert($key, [
        'v_mem' => new Corvid\Vector($v),
        'v_disk' => new Corvid\Vector($v),
        'v_q' => new Corvid\Vector($v),
    ]);
}
$items->createVectorIndex('v_mem', Corvid\Metric::COSINE);
$items->createVectorIndexOnDisk('v_disk', Corvid\Metric::COSINE);
$items->createVectorIndexQuantized('v_q', Corvid\Metric::COSINE, Corvid\Quant::BINARY);

echo "top-4 nearest to (1,0,0,0) under cosine:\n";
runQuery($items, 'v_mem', false, 'exact (scan):', $probe);
runQuery($items, 'v_mem', true, 'ann in-memory HNSW:', $probe);
runQuery($items, 'v_disk', true, 'ann on-disk HNSW:', $probe);
runQuery($items, 'v_q', true, 'ann binary-quantized:', $probe);
echo "(the quantized lane trades recall for a ~32x smaller index)\n";

unset($items); // free the derived handle before close
$db->close();

// Reopen: the on-disk graph reloads (no rebuild) and answers again.
$db = Corvid\Db::open($path);
$items = $db->collection('items');
runQuery($items, 'v_disk', true, 'ann on-disk after reopen:', $probe);
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```php
$corpus = [
    ['n1', 'the quick brown fox jumps over the lazy dog'],
    ['n2', 'a quick red fox leaps over a sleeping dog'],
    ['n3', 'slow green turtle crosses the road'],
    ['n4', '东京是一座巨大的城市'],  // Tokyo is a huge city
    ['n5', '大阪是关西最大的城市'],  // Osaka is Kansai's biggest city
    ['n6', '机器学习正在改变数据库'], // ML is changing databases
];

function search(Collection $notes, string $query, string $label): void
{
    $rows = $notes->query()->text('body', $query, 3)->run();
    printf('%-28s ->', $label);
    foreach ($rows as $r) {
        printf(' %s(%.6f)', $r->key, $r->score);
    }
    echo "\n";
}

function phrase(Collection $notes, string $query, string $label): void
{
    $rows = $notes->phraseSearch('body', $query, 3);
    printf('%-28s ->', $label);
    foreach ($rows as $r) {
        printf(' %s(%.6f)', $r->key, $r->score);
    }
    echo "\n";
}

$db = Corvid\Db::openMemory();
$notes = $db->collection('notes');
foreach ($corpus as [$key, $body]) {
    $notes->insert($key, ['body' => $body]);
}
$notes->createTextIndex('body');

search($notes, 'quick fox', 'bm25 "quick fox":');
search($notes, 'quick dog', 'bm25 "quick dog":');
search($notes, '城市', 'bm25 CJK 城市 (city):');
search($notes, '数据库', 'bm25 CJK 数据库 (database):');

phrase($notes, 'fox jumps over', 'phrase "fox jumps over":');
phrase($notes, 'over jumps fox', 'phrase "over jumps fox" (reversed — no match):');
phrase($notes, 'leaps over a sleeping', 'phrase with stop words collapsed:');
```

<!-- corvid-examples:text_search END -->
### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```php
function show(string $label, array $keys): void
{
    printf("%-36s [%s]\n", $label, implode(' ', $keys));
}

$db = Corvid\Db::openMemory();
$nodes = $db->collection('nodes');

foreach (['ga', 'gb', 'gc'] as $key) {
    $nodes->insert($key, ['n' => $key]);
}

$nodes->link('ga', 'parent_of', 'gb');
$nodes->link('ga', 'parent_of', 'gc');
$nodes->link('gb', 'parent_of', 'gd'); // gd never exists as a document
$nodes->linkWeighted('ga', 'route', 'gb', 2.5);
$nodes->linkWeighted('ga', 'route', 'gd', 0.75);

show('neighbors(ga)', $nodes->neighbors('ga', 'parent_of'));
show('in_neighbors(gb)', $nodes->inNeighbors('gb', 'parent_of'));

$routes = $nodes->neighborsWeighted('ga', 'route');
$parts = [];
foreach ($routes as $r) {
    $parts[] = sprintf('%s=%.2f', $r->key, $r->weight);
}
printf("%-36s [%s]\n", 'routes from ga (weighted):', implode(' ', $parts));

show('traverse(ga, 1 hop)', $nodes->traverse('ga', 'parent_of', 1));
show('traverse(ga, 2 hops)', $nodes->traverse('ga', 'parent_of', 2));

// Delete cascade: remove gc (a document) and gd (never a document).
printf("delete gc: existed = %s\n", $nodes->delete('gc') ? 'true' : 'false');
printf("delete gd: existed = %s (never a document; its edges still cascade)\n", $nodes->delete('gd') ? 'true' : 'false');

show('neighbors(ga) after deletes', $nodes->neighbors('ga', 'parent_of'));
show('neighbors(gb) after deletes', $nodes->neighbors('gb', 'parent_of'));
show('traverse(ga, 2 hops) after', $nodes->traverse('ga', 'parent_of', 2));
```

<!-- corvid-examples:graph END -->
### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```php
$cities = [
    ['berlin', 52.52, 13.40],
    ['potsdam', 52.40, 13.06],
    ['hamburg', 53.55, 9.99],
    ['munchen', 48.14, 11.58],
];

function show(string $label, array $hits): void
{
    $parts = [];
    foreach ($hits as $h) {
        $parts[] = sprintf('%s %.6fkm', $h->key, $h->distanceKm);
    }
    printf("%-34s [%s]\n", $label, implode(' ', $parts));
}

$db = Corvid\Db::openMemory();
$places = $db->collection('places');

foreach ($cities as [$name, $lat, $lon]) {
    $places->insert($name, [
        'name' => $name,
        'loc' => [$lat, $lon], // the [lat, lon] array encoding
    ]);
}
$places->createGeoIndex('loc');

show('within 600km of Berlin:', $places->geoWithinRadius('loc', 52.52, 13.40, 600.0));
show('bbox 47..55N, 5..15E:', $places->geoWithinBBox('loc', 47, 5, 55, 15));
show('nearest 2 to Berlin:', $places->geoNearest('loc', 52.52, 13.40, 2));
```

<!-- corvid-examples:geo END -->





## API at a glance

Generated from the binding's `docs/SURFACE.tsv` (every engine
construct at the pinned tag mapped or N/A with a reason) — regenerated
by the docs sync, so it cannot drift.

<!-- corvid-api-glance BEGIN -->

| API group | engine constructs | proven by |
|---|---|---|
| `the PHP value mapping (null/bool/int/float/string Text/Corvid\Bytes/Corvid\Vector/array/Map)` | 10 | golden:values.txt:VTYPE |
| `the encode recursion enforces the same inclusive 128 container-depth cap (PHP_CORVID_MAX_NESTING, mirroring value.rs); a deeper value throws a clean CODE_ARGUMENT instead of unbounded C recursion` | 1 | BindingTest::testEncodingDeeperThanMaxNestingIsRejectedCleanly + testMaxNestingBoundaryRoundTrips |
| `Corvid\Values::asBool() — null on wrong type (the engine Option convention)` | 1 | golden:values.txt:VAS_BOOL |
| `Corvid\Values::asInt() — null on wrong type (the engine Option convention)` | 1 | golden:values.txt:VAS_INT |
| `Corvid\Values::asFloat() — null on wrong type; NaN/±INF/-0.0 bit-exact` | 1 | golden:values.txt:VAS_FLOAT |
| `Corvid\Values::asText() — null on wrong type (the _ref reads through the mapping)` | 1 | golden:values.txt:VTEXT_REF |
| `Corvid\Values::asBytes() — binary-safe Corvid\Bytes, null on wrong type` | 1 | golden:values.txt:VBYTES_REF |
| `Corvid\Values::asVector() — f32-payload Corvid\Vector, null on wrong type` | 1 | golden:values.txt:VVECTOR_REF |
| `FieldExpr.Eq/Ne/Lt/Le/Gt/Ge` | 7 | golden:queries.txt:QF_* |
| `Corvid\Field eq/ne/lt/le/gt/ge/in/between/startsWith/contains/geoWithin/exists + Predicate and()/or()/not()` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN |
| `Corvid\Metric::COSINE/DOT/L2 constants (frozen ABI values)` | 4 | golden:queries.txt:QVEC |
| `Corvid\Quant::NONE/BINARY/SCALAR constants (frozen ABI values)` | 4 | golden:schema.txt:IDX_VEC_Q |
| `throws Corvid\Exception (getCode() = corvid_err)` | 1 | golden:mutations.txt:INSERT_ERR |
| `Corvid\Exception::getCode() (the CODE_* constants table)` | 1 | TestErrorCodeTable |
| `CODE_DATABASE (1)` | 1 | TestErrorCodeTable |
| `CODE_TRANSACTION (2)` | 1 | TestErrorCodeTable |
| `CODE_TABLE (3)` | 1 | TestErrorCodeTable |
| `CODE_STORAGE (4)` | 1 | TestErrorCodeTable |
| `CODE_COMMIT (5)` | 1 | TestErrorCodeTable |
| `CODE_SET_DURABILITY (6)` | 1 | TestErrorCodeTable |
| `CODE_COMPACTION (7)` | 1 | TestErrorCodeTable |
| `CODE_DECODE (8)` | 1 | TestErrorCodeTable |
| `CODE_CORRUPT_INDEX (9)` | 1 | TestErrorCodeTable |
| `CODE_RESERVED_COLLECTION (10)` | 1 | TestErrorCodeTable; golden:mutations.txt:INSERT_ERR(err:10) |
| `CODE_INVALID_NAME (11)` | 1 | TestErrorCodeTable; golden:mutations.txt:INSERT_ERR(err:11) |
| `CODE_ARGUMENT (12)` | 1 | TestErrorCodeTable; golden:mutations.txt:UPDATE_ABORT(err:12) |
| `CODE_INCOMPATIBLE_FORMAT (13)` | 1 | TestErrorCodeTable |
| `CODE_EMPTY_INDEX_TRAINING (14)` | 1 | TestErrorCodeTable; golden:schema.txt:IDX_PQ_ERR(err:14) |
| `CODE_SCHEMA_VIOLATION (15)` | 1 | TestErrorCodeTable; golden:schema.txt:SCHEMA_ERR(err:15) |
| `CODE_INVALID_DUMP (16)` | 1 | TestErrorCodeTable |
| `CODE_BACKUP_TARGET_EXISTS (17)` | 1 | TestErrorCodeTable; golden:admin.txt:BACKUP_DUP(err:17) |
| `CODE_IO (18)` | 1 | TestErrorCodeTable |
| `Corvid\Row { key, doc, score }` | 1 | golden:queries.txt |
| `Corvid\Query (Collection->query())` | 2 | golden:queries.txt |
| `Query->filter()` | 1 | golden:queries.txt:QF_COUNT |
| `Query->vector()` | 1 | golden:queries.txt:QVEC |
| `Query->text()` | 1 | golden:queries.txt:QTEXT |
| `Query->fuseRrf()` | 1 | golden:queries.txt:HYBRID_F |
| `Query->rerankMmr()` | 1 | golden:queries.txt:HYBRID |
| `Query->limit()` | 1 | golden:queries.txt:ORDER_BY |
| `Query->offset()` | 1 | golden:queries.txt:ORDER_BY |
| `Query->orderBy()` | 1 | golden:queries.txt:ORDER_BY |
| `Query->approx()` | 1 | golden:queries.txt:APPROX |
| `Query->select()` | 1 | golden:queries.txt:SELECT |
| `Query->count()` | 1 | golden:queries.txt:AGG_COUNT |
| `Query->groupCount()` | 1 | golden:queries.txt:AGG_GCOUNT |
| `Query->sum()` | 1 | golden:queries.txt:AGG_SUM |
| `Query->avg()` | 1 | golden:queries.txt:AGG_AVG |
| `Query->min()` | 1 | golden:queries.txt:AGG_MIN |
| `Query->max()` | 1 | golden:queries.txt:AGG_MAX |
| `Query->countDistinct()` | 1 | golden:queries.txt:AGG_DISTINCT |
| `Query->groupSum()` | 1 | golden:queries.txt:AGG_GSUM |
| `Query->groupAvg()` | 1 | golden:queries.txt:AGG_GAVG |
| `Query->run()` | 1 | golden:queries.txt:QVEC |
| `Corvid\Db` | 1 | golden:admin.txt:FILEDB |
| `Db::open(path) — file-backed` | 1 | golden:admin.txt:FILEDB |
| `Db::openMemory()` | 1 | golden:mutations.txt (every non-values fixture opens via Db::openMemory()) |
| `Db->collection(name) -> Corvid\Collection` | 1 | golden:admin.txt:COLL |
| `Db->backup(path)` | 1 | golden:admin.txt:BACKUP |
| `Db->compact()` | 1 | golden:admin.txt:COMPACT |
| `Db->collections() -> string[]` | 1 | golden:admin.txt:COLLECTIONS |
| `Collection` | 1 | golden:mutations.txt:COLL |
| `Collection->insert(key, doc)` | 1 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `Collection->update(key, callable)` | 1 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `Collection->patch(key, patch)` | 1 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `Collection->compareAndSet(key, expected, replacement)` | 1 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `Collection->scan(callable, early stop on false)` | 1 | golden:mutations.txt:SCAN/SCAN_STOP |
| `Collection->len() (0 for empty)` | 2 | golden:mutations.txt:LEN |
| `Collection->putMany()` | 1 | golden:mutations.txt:PUTMANY + golden:schema.txt:PUTMANY_ROLLBACK |
| `Collection->insertAuto()` | 1 | golden:mutations.txt:INSERT_AUTO |
| `Collection->get()` | 1 | golden:mutations.txt:GET |
| `Collection->delete()/deleteWhere()/deleteBatch()` | 3 | golden:mutations.txt (DELETE/DELETE_WHERE/DELETE_BATCH) |
| `Collection->scan()` | 1 | golden:mutations.txt:SCAN |
| `Collection->page() -> Corvid\Page { rows, next }` | 2 | golden:mutations.txt:PAGE |
| `Corvid\Row->score (Query->vector()->run())` | 1 | golden:queries.txt:QVEC |
| `Corvid\Row->score (Query->text()->run())` | 1 | golden:queries.txt:QTEXT |
| `Collection->phraseSearch(field, phrase, k) — the direct positional search (corvid_phrase_search, v0.3.0) over the rows cursor` | 1 | golden:queries.txt:PHRASE |
| `Query->fuseRrf() default k=60` | 1 | golden:queries.txt:HYBRID |
| `Corvid\GeoHit { key, doc, distanceKm }` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `Collection->geoWithinRadius()/geoNearest()/geoWithinBBox()/createGeoIndex()` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `Collection->link()/linkWeighted()/unlink()/neighbors()/inNeighbors()/neighborsWeighted()/traverse()` | 7 | golden:graph.txt |
| `Collection->createScalarIndex()/createCompoundIndex(...)/createTextIndex()/createTextIndexOnDisk()/createGeoIndex()/createVectorIndex* (6 variants)` | 10 | golden:schema.txt:IDX_* |
| `Corvid\FieldDef::TYPE_* constants (0..8, frozen ABI values)` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `Collection->setSchema()/schema() + Corvid\FieldDef { name, type, required, unique }` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `Collection->insertWithTtl()/setTtl()/getTtl()/purgeExpired()` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `Db->dump()/load()/loadWithRenames()` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) |

152 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

The extension's userland API (classes, methods, signatures) is documented in the [repo's README](https://github.com/corvid-db/corvid-php) with the FPM/lifetime caveats in docs/PLAN.md.


## The correctness floor

PHPUnit (and the direct driver on the ZTS leg) replays the engine's
entire **golden fixture suite** — 267 executable lines across 8 files,
including the v0.3.0 `VMAP_KEYS`/`GET_KEYS` (map-key iteration) and
`PHRASE`/`PHRASE_K0` (direct positional search) lines — against the
**downloaded** cdylib, through this binding's public PHP API: every
counted line must dispatch, the first failure names file:line + OP +
expected-vs-got, and every handle is freed on its creation path. The
fixtures are vendored in the repo and byte-compared against the
release's copies at fetch time, so a bad artifact is a loud fetch
failure, never a silent skip.

On top sits `docs/SURFACE.tsv` — every construct of the engine's public
surface (327 rows at this pin) resolved to the PHP API exposing it plus
the golden line that proves it, or `N/A` with the ABI's §9 reason,
gated in CI (`scripts/surface-gate.sh`).

Next: [the bindings overview](/bindings/overview/).
