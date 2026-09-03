---
title: corvid-swift
description: The corvid-swift binding — the Swift package for Apple platforms (iOS 13+ device/simulator, macOS) over the engine's prebuilt CorvidEngine.xcframework, no shim (Swift consumes the C ABI directly), throws + CorvidError with the frozen engine codes, and the golden-suite correctness story.
sidebar:
  order: 11
---

[`corvid-swift`](https://github.com/corvid-db/corvid-swift) is the
Swift binding for **Apple platforms** — iOS 13+ (device and simulator,
arm64 + x86_64) and macOS 10.15+ (arm64 + x86_64). One Swift Package,
installed by URL, nothing else: the wrapper calls the engine's frozen
C ABI directly through the clang module formed from the prebuilt
**`CorvidEngine.xcframework`** (iOS device + fat iOS-simulator + fat
macOS staticlib slices) that every engine release publishes. The
engine is **statically linked** — no dynamic loading, no symbol
search paths — and the pin is double: the binary target's URL tag
plus its sha256 checksum, both verified by the binding's release gate
against the engine release's own checksums.

**When to choose this binding:** your project is Swift on iOS or
macOS and you want corvid embedded with the platform's own shape —
`throws`/`CorvidError` carrying the engine's frozen error codes,
`deinit`-based handle lifetimes, `Data` keys, `[String: Any?]`
documents, and closures for scan/update (a throwing closure aborts
the engine call and rethrows at the call site).

## Install

Swift Package Manager — the package URL is the repository:

```swift
dependencies: [
    .package(url: "https://github.com/corvid-db/corvid-swift.git", from: "0.4.1")
]
```

```swift
.target(name: "App", dependencies: [
    .product(name: "Corvid", package: "corvid-swift"),
])
```

Requires Xcode 16+ / a Swift 6 toolchain (the package itself builds
in the Swift 5 language mode). No other dependencies. Platform scope:
iOS + macOS slices ship today; watchOS/visionOS/tvOS are a recorded,
additive follow-up in the binding's PLAN.

## The API in one screen

```swift
import Corvid

let db = try Corvid.openMemory()
let docs = try db.collection("docs")

try docs.insert(
    Data("s1".utf8),
    ["kind": "doc",
     "body": "rust embedded database",
     "v": [1.0, 0.0] as [Float]] as [String: Any?])

let rows = Array(try docs.query()
    .filter(try field("kind").eq("doc"))
    .vector("v", [1.0, 0.0], k: 2, metric: .cosine)
    .run())

let phrase = Array(try docs.phraseSearch(
    field: "body", phrase: "embedded database", k: 2))

db.close() // deinit also closes; Db/Collection are thread-safe
```

Documents are Swift values: `[String: Any?]` maps and `[Any?]`
arrays whose leaves are `Bool`, `Int`, `UInt` (by bit pattern),
`Double`, `Float`, `String`, `Data`, and `[Float]` vectors — note
that a bare `[1.0, 0.0]` inside a document literal infers `[Double]`
and encodes as an *array*; vectors are `[Float]`, so write
`[1.0, 0.0] as [Float]`. Keys are `Data`. NaNs cross bit-exact both
ways.

## The examples

Six runnable programs as executable targets in the package
(`swift run <Name>`), executed on every CI leg with deterministic
output: **quickstart**, **hybrid** (the flagship), **vector-index**
(in-memory / on-disk / binary-quantized HNSW vs the exact scan),
**text-search** (BM25 incl. CJK bigram segmentation, plus the direct
phrase search), **graph** (neighbors/traverse + delete cascade), and
**geo** (radius / bbox / nearest). All six sources are embedded below —
imported from the repo so they cannot drift from what CI executes
(`scripts/sync-binding-examples.sh`; the drift gate reddens docs CI if
they diverge).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```swift
let db = try Corvid.openMemory()
defer { db.close() }

let docs = try db.collection("docs")

try docs.insert(
    Data("p1".utf8),
    ["title": "rust embedded database", "kind": "doc",
     "v": [1.0, 0.0] as [Float]] as [String: Any?])
try docs.insert(
    Data("p2".utf8),
    ["title": "python web frameworks", "kind": "doc",
     "v": [0.0, 1.0] as [Float]] as [String: Any?])
try docs.insert(
    Data("p3".utf8),
    ["title": "rust again database", "kind": "doc",
     "v": [0.9, 0.1] as [Float]] as [String: Any?])

// kNN: the 3 nearest documents to (1, 0) under cosine. Project the
// field the printout needs (docs decode in full either way; select
// trims the payload). render flattens the Any?-boxed values Swift's
// dictionary printing would show as Optional(...).
func render(_ doc: Any?) -> String {
    guard let d = doc as? [String: Any?] else { return String(describing: doc ?? "nil") }
    return "[" + d.sorted { $0.key < <!-- corvid-examples:quickstart BEGIN -->.key }
        .map { "\($0.key): \($0.value.map { String(describing: $0) } ?? "nil")" }
        .joined(separator: ", ") + "]"
}

let rows = Array(try docs.query()
    .vector("v", [1.0, 0.0], k: 3, metric: .cosine)
    .select(["title"])
    .run())
for (rank, r) in rows.enumerated() {
    print(String(format: "%d. %@ score=%.6f %@",
                 rank + 1, String(decoding: r.key, as: UTF8.self), r.score, render(r.doc)))
}
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```swift
let db = try Corvid.openMemory()
defer { db.close() }

let docs = try db.collection("docs")

try docs.insert(
    Data("s1".utf8),
    ["kind": "doc", "body": "rust embedded database",
     "v": [1.0, 0.0] as [Float]] as [String: Any?])
try docs.insert(
    Data("s2".utf8),
    ["kind": "doc", "body": "python web frameworks",
     "v": [0.0, 1.0] as [Float]] as [String: Any?])
try docs.insert(
    Data("s3".utf8),
    ["kind": "doc", "body": "rust again database",
     "v": [0.9, 0.1] as [Float]] as [String: Any?])
try docs.insert(Data("m1".utf8), ["kind": "meta"]) // filtered out below

// The flagship query: filter + vector + text, RRF + MMR + limit.
// render flattens the Any?-boxed values Swift's dictionary printing
// would show as Optional(...).
func render(_ doc: Any?) -> String {
    guard let d = doc as? [String: Any?] else { return String(describing: doc ?? "nil") }
    return "[" + d.sorted { $0.key < <!-- corvid-examples:hybrid BEGIN -->.key }
        .map { "\($0.key): \($0.value.map { String(describing: $0) } ?? "nil")" }
        .joined(separator: ", ") + "]"
}

let rows = Array(try docs.query()
    .filter(try field("kind").eq("doc"))
    .vector("v", [1.0, 0.0], k: 2, metric: .cosine)
    .text("body", "rust database", k: 2)
    .fuseRRF(k: 60)
    .rerankMMR(lambda: 1)
    .limit(n: 2)
    .select(["body"])
    .run())
for (rank, r) in rows.enumerated() {
    print(String(format: "%d. %@ score=%.6f %@",
                 rank + 1, String(decoding: r.key, as: UTF8.self), r.score, render(r.doc)))
}
```

<!-- corvid-examples:hybrid END -->

### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```swift
let path = NSTemporaryDirectory() + "corvid-swift-example-vector-index.redb"
try? FileManager.default.removeItem(atPath: path) // reruns start clean (single-file db)

do {
    let db = try Corvid.open(path)
    defer { db.close() }
    let items = try db.collection("items")
    for (key, v) in corpus {
        try items.insert(Data("\(key)".utf8),
                         ["v_mem": v, "v_disk": v, "v_q": v] as [String: Any?])
    }
    try items.createVectorIndex("v_mem", metric: .cosine)
    try items.createVectorIndexOnDisk("v_disk", metric: .cosine)
    try items.createVectorIndexQuantized("v_q", metric: .cosine, quant: .binary)

    print("top-4 nearest to (1,0,0,0) under cosine:")
    try runQuery(items, "v_mem", approx: false, "exact (scan):")
    try runQuery(items, "v_mem", approx: true, "ann in-memory HNSW:")
    try runQuery(items, "v_disk", approx: true, "ann on-disk HNSW:")
    try runQuery(items, "v_q", approx: true, "ann binary-quantized:")
    print("(the quantized lane trades recall for a ~32x smaller index)")
}

// Reopen: the on-disk graph reloads (no rebuild) and answers again.
do {
    let db = try Corvid.open(path)
    defer { db.close() }
    let items = try db.collection("items")
    try runQuery(items, "v_disk", approx: true, "ann on-disk after reopen:")
}

try? FileManager.default.removeItem(atPath: path)
```

<!-- corvid-examples:vector_index END -->

### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```swift
let db = try Corvid.openMemory()
defer { db.close() }

let notes = try db.collection("notes")

for (key, body) in corpus {
    try notes.insert(Data(key.utf8), ["body": body] as [String: Any?])
}
try notes.createTextIndex("body")

try search(notes, "quick fox", "bm25 \"quick fox\":")
try search(notes, "quick dog", "bm25 \"quick dog\":")
try search(notes, "城市", "bm25 CJK 城市 (city):")
try search(notes, "数据库", "bm25 CJK 数据库 (database):")

try phrase(notes, "fox jumps over", "phrase \"fox jumps over\":")
try phrase(notes, "over jumps fox", "phrase \"over jumps fox\" (reversed — no match):")
try phrase(notes, "leaps over a sleeping", "phrase with stop words collapsed:")
```

<!-- corvid-examples:text_search END -->

### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```swift
let db = try Corvid.openMemory()
defer { db.close() }

let nodes = try db.collection("nodes")

for key in ["ga", "gb", "gc"] {
    try nodes.insert(Data(key.utf8), ["n": key] as [String: Any?])
}

try nodes.link(Data("ga".utf8), "parent_of", Data("gb".utf8))
try nodes.link(Data("ga".utf8), "parent_of", Data("gc".utf8))
try nodes.link(Data("gb".utf8), "parent_of", Data("gd".utf8)) // gd never a document
try nodes.linkWeighted(Data("ga".utf8), "route", Data("gb".utf8), weight: 2.5)
try nodes.linkWeighted(Data("ga".utf8), "route", Data("gd".utf8), weight: 0.75)

let ga = Data("ga".utf8)
let gb = Data("gb".utf8)

show("neighbors(ga)", Array(try nodes.neighbors(ga, "parent_of")))
show("in_neighbors(gb)", Array(try nodes.inNeighbors(gb, "parent_of")))
let routes = try nodes.neighborsWeighted(ga, "route")
    .map { String(format: "%@=%0.2f", String(decoding: $0.key, as: UTF8.self), $0.weight) }
    .joined(separator: " ")
print("\(pad("routes from ga (weighted):", 36)) [\(routes)]")
show("traverse(ga, 1 hop)", Array(try nodes.traverse(ga, "parent_of", hops: 1)))
show("traverse(ga, 2 hops)", Array(try nodes.traverse(ga, "parent_of", hops: 2)))

// Delete cascade: remove gc (a document) and gd (never a document).
print("delete gc: existed = \(try nodes.delete(Data("gc".utf8)))")
let existedGd = try nodes.delete(Data("gd".utf8))
print("delete gd: existed = \(existedGd) (never a document; its edges still cascade)")

show("neighbors(ga) after deletes", Array(try nodes.neighbors(ga, "parent_of")))
show("neighbors(gb) after deletes", Array(try nodes.neighbors(gb, "parent_of")))
show("traverse(ga, 2 hops) after", Array(try nodes.traverse(ga, "parent_of", hops: 2)))
```

<!-- corvid-examples:graph END -->

### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```swift
let db = try Corvid.openMemory()
defer { db.close() }

let places = try db.collection("places")

for (name, lat, lon) in cities {
    try places.insert(Data(name.utf8), [
        "name": name,
        "loc": [lat, lon] as [Any?], // the [lat, lon] array encoding
    ] as [String: Any?])
}
try places.createGeoIndex("loc")

show("within 600km of Berlin:", Array(try places.geoWithinRadius("loc", lat: 52.52, lon: 13.40, radiusKm: 600.0)))
show("bbox 47..55N, 5..15E:", Array(try places.geoWithinBBox("loc", minLat: 47.0, minLon: 5.0, maxLat: 55.0, maxLon: 15.0)))
show("nearest 2 to Berlin:", Array(try places.geoNearest("loc", lat: 52.52, lon: 13.40, k: 2)))
```

<!-- corvid-examples:geo END -->

## API at a glance

Generated from the binding's `docs/SURFACE.tsv` (every engine
construct at the pinned tag mapped or N/A with a reason) — regenerated
by the docs sync, so it cannot drift.

<!-- corvid-api-glance BEGIN -->

| API group | engine constructs | proven by |
|---|---|---|
| `the Swift value mapping (nil/Bool/Int/Double/String/Data/[Float]/[Any?]/[String: Any?])` | 10 | golden:values.txt:VTYPE |
| `FieldExpr.eq/ne/lt/le/gt/ge` | 7 | golden:queries.txt:QF_* |
| `Predicate via field()/Predicate.not()` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN |
| `Metric enum (Metric.cosine/dot/l2)` | 4 | golden:queries.txt:QVEC |
| `Quant enum (Quant.none/binary/scalar)` | 4 | golden:schema.txt:IDX_VEC_Q |
| `throws CorvidError` | 1 | golden:mutations.txt:INSERT_ERR |
| `CorvidError.code (CorvidErrorCode table)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.database (code 1)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.transaction (code 2)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.table (code 3)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.storage (code 4)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.commit (code 5)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.setDurability (code 6)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.compaction (code 7)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.decode (code 8)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.corruptIndex (code 9)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.reservedCollection (code 10)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen; golden:mutations.txt:INSERT_ERR(err:10) |
| `CorvidErrorCode.invalidName (code 11)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen; golden:mutations.txt:INSERT_ERR(err:11) |
| `CorvidErrorCode.argument (code 12)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen; golden:mutations.txt:UPDATE_ABORT(err:12) |
| `CorvidErrorCode.incompatibleFormat (code 13)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.emptyIndexTraining (code 14)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen; golden:schema.txt:IDX_PQ_ERR(err:14) |
| `CorvidErrorCode.schemaViolation (code 15)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen; golden:schema.txt:SCHEMA_ERR(err:15) |
| `CorvidErrorCode.invalidDump (code 16)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `CorvidErrorCode.backupTargetExists (code 17)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen; golden:admin.txt:BACKUP_DUP(err:17) |
| `CorvidErrorCode.io (code 18)` | 1 | ErrCodesTest.swift errorCodeTableIsFrozen |
| `Row { key, doc, score }` | 1 | golden:queries.txt |
| `Query (Collection.query())` | 2 | golden:queries.txt |
| `Query.filter` | 1 | golden:queries.txt:QF_COUNT |
| `Query.vector` | 1 | golden:queries.txt:QVEC |
| `Query.text` | 1 | golden:queries.txt:QTEXT |
| `Query.fuseRRF` | 1 | golden:queries.txt:HYBRID_F |
| `Query.rerankMMR` | 1 | golden:queries.txt:HYBRID |
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
| `Corvid.open/openMemory + Db.collection/collections/backup/compact` | 6 | golden:admin.txt (COLLECTIONS/BACKUP/COMPACT) |
| `Collection` | 1 | golden:mutations.txt:COLL |
| `Collection.insert/update/patch/compareAndSet` | 4 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `Collection.scan(callback, early stop)` | 1 | golden:mutations.txt:SCAN/SCAN_STOP |
| `Collection.len (len()==0 for empty)` | 2 | golden:mutations.txt:LEN |
| `Collection.putMany` | 1 | golden:mutations.txt:PUTMANY + golden:schema.txt:PUTMANY_ROLLBACK |
| `Collection.insertAuto` | 1 | golden:mutations.txt:INSERT_AUTO |
| `Collection.get` | 1 | golden:mutations.txt:GET |
| `Collection.delete/deleteWhere/deleteBatch` | 3 | golden:mutations.txt (DELETE/DELETE_WHERE/DELETE_BATCH) |
| `Collection.scan` | 1 | golden:mutations.txt:SCAN |
| `Collection.page -> Page(rows, nextAfter)` | 2 | golden:mutations.txt:PAGE |
| `Row.score (Query.vector().run())` | 1 | golden:queries.txt:QVEC |
| `Row.score (Query.text().run())` | 1 | golden:queries.txt:QTEXT |
| `Collection.phraseSearch(field:phrase:k:) — the direct positional search (corvid_phrase_search, v0.3.0) over the rows cursor` | 1 | golden:queries.txt:PHRASE |
| `Query.fuseRRF default k=60` | 1 | golden:queries.txt:HYBRID |
| `GeoHit { key, doc, distanceKm }` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `Collection.geoWithinRadius/geoNearest/geoWithinBBox/createGeoIndex` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `Collection.link/linkWeighted/unlink/neighbors/inNeighbors/neighborsWeighted/traverse` | 7 | golden:graph.txt |
| `Collection.createScalarIndex/createCompoundIndex/createTextIndex[/OnDisk]/createGeoIndex/createVectorIndex* (variants)` | 10 | golden:schema.txt:IDX_* |
| `FieldType enum (FieldType.any/bool/int/float/text/bytes/vector/array/map)` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `Collection.setSchema/schema + FieldDef(name:type:required:unique:)` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `Collection.insertWithTTL/setTTL/getTTL/purgeExpired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `Db.dumpToPath/loadFromPath/loadFromPathWithRenames` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) |

159 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

The [Swift Package Index](https://swiftpackageindex.com/corvid-db/corvid-swift) renders DocC-style reference from the wrapper's doc comments (also Quick Help in Xcode).


## The architecture ruling: SPM binary target, no shim

Per the repo's `docs/PLAN.md`: Swift consumes C natively — unlike
corvid-jvm, whose JNI demands a C shim, the wrapper
(`Sources/Corvid`) imports `CorvidEngine` and calls the 124 frozen
symbols directly. The xcframework carries `corvid.h` plus an umbrella
and module map so SwiftPM forms the clang module; each slice is the
engine's `staticlib` build (bare dylibs outside frameworks are not
supported on iOS — static linking is the Rust-on-Apple norm).

The lifetime mapping is the binding's review center-of-gravity:
opaque handles → `final class`es with `deinit` frees; consumed-by-call
args (predicate trees, query builders) invalidated **before** the
native call whatever its outcome (FFI.md §8's unconditional
consumption — the double-free class cannot happen); borrowed views
copied inside the same call that observed them; `Db`/`Collection`
are `@unchecked Sendable` exactly where the ABI's §6 thread contract
says so, builders and iterators are not. Cursors (`Rows`, `GeoHits`,
`Strs`, `GroupIter`) are single-pass — iterate once.

## Correctness story

The golden-suite port (`Tests/CorvidTests/GoldenTest.swift`) replays
the engine's 8-fixture, 267-executable-line suite through this
binding against the **downloaded** xcframework at the pin — same
grammar, same dispatch, every line, first failure naming file:line.
A deep integration pass covers the surfaces the fixture grammar does
not reach (admin paths, scan aborts, graph, geo, schema, TTL, the
full aggregate set), and a frozen error-code table test pins the
19+1 code mapping. CI runs the suite on macOS plus an iOS-Simulator
compile leg (the simulator slice links), and the surface gate
resolves every engine construct at the pinned tag
(`docs/SURFACE.tsv`: mapped with a proving test, or N/A with a
reason).

Releases ride the engine's cascade: engine tag `vX.Y.Z` → `from:
"X.Y.Z"` here, with the manifest's URL and checksum rewritten in the
same bump PR (`bump.sh` downloads the new zip and re-hashes it — a
stale checksum would break every consumer's resolve).
