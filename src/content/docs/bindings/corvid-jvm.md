---
title: corvid-jvm
description: The corvid-jvm binding — Kotlin-first JVM library (Java consumes the same artifact) over the published FFI artifacts via a thin C JNI shim, Db/Collection/Query fluent API, CorvidException with the frozen engine codes, complete map-key decoding, and the golden-suite correctness story.
sidebar:
  order: 10
---

[`corvid-jvm`](https://github.com/corvid-db/corvid-jvm) is the
Kotlin-first JVM binding: **Java users consume the same artifact** (the
API is plain Kotlin/JVM classes). It links the engine's **published FFI
artifacts** (the platform cdylib and `corvid.h`) through a thin hand-
written **C JNI shim** (one file, `native/corvid_jni.c`) compiled
per-platform, with the idiomatic Kotlin API on top. Deliberately the
corvid-c/corvid-go pattern (a fetched, checksummed shared library), not
the node/python one (Rust-source builds): `./fetch.sh` + `./scripts/
build-native.sh` download, sha256-verify, and build against the pinned
release — no Rust toolchain, no vendored binaries.

**When to choose this binding:** your project is Kotlin or Java on the
JVM (server-side, desktop) and you want corvid embedded with the
platform's own shape — `AutoCloseable` handles (`use` blocks), real
exceptions carrying the engine's frozen error codes, and fluent builder
chains — with per-call FFI cost kept at JNI's native-marshaling floor.

## The architecture ruling: JNI, not JNA

Per the repo's `docs/PLAN.md`: JNA's reflection-driven libffi dispatch
and boxing are exactly the crossing-cost overhead the engine's BENCHES
discipline polices; a hand-written JNI shim crosses with native
argument marshaling and decodes each document in **one crossing per
row**. Kotlin Multiplatform was ruled out too — one platform (the JVM),
so no expect/actual ceremony. The nine-rule JNI discipline in the PLAN
is the binding's review center-of-gravity; the shapes it pins:

| C ABI | corvid-jvm |
| --- | --- |
| opaque handles (`corvid_db*`, …) | `Db` / `Collection` / `Query` / `Predicate` — `AutoCloseable`, `close()` idempotent, `use` is the ownership model; no raw pointers in the public API (long handles live in an `internal` object) |
| `CORVID_ERR` + thread-local last error | `CorvidException` (a `RuntimeException` with the frozen `ErrCode`); the same-call guarantee — JNI runs on the calling Java thread, so the code+message read after a failure is always THIS failure's |
| frozen enums | `Metric`, `Quant`, `FieldType`, `ErrCode` (exact ABI values) |
| consumed-by-call args (pred trees, builders) | marked consumed on the Kotlin side **before** the native call, whatever its outcome — the double-free UB class cannot happen; a consumed object throws on reuse |
| borrowed views (`_ref` buffers, row docs, callback args) | copied into JVM memory inside the same native call that observed them — nothing borrowed is ever retained past the call |
| `corvid_update_fn` / `corvid_scan_fn` | Kotlin lambdas; a **throwing callback aborts the engine call** (store untouched, `ARGUMENT` recorded) and the user's own exception surfaces at the call site — never swallowed, never unwound through C frames |
| strings / bytes / vectors | `String` ↔ **real UTF-8** bytes (JNI's modified UTF-8 never touches the engine side), `ByteArray`, `FloatArray` |

The raw ABI stays reachable as `corvid.jni.Natives` — `internal`, used
by the golden harness for the value-handle exercises exactly the way
the engine's own C harness drives them. Application code should stick
to the wrapper types.

## Install

```kotlin
dependencies {
    implementation("io.github.corvid-db:corvid-jvm:0.4.1")
    runtimeOnly("io.github.corvid-db:corvid-jvm:0.4.1:macos-arm64")
    // classifiers: macos-arm64 | macos-x64 | linux-x64 | linux-arm64 | windows-x64
}
```

Published to **Maven Central** — the jars are self-contained: the
platform classifier bundles the JNI shim AND the engine cdylib, and
the loader extracts both to a temp dir and `System.load()`s them, so a
consumer needs nothing else (no fetch, no compiler, no
`java.library.path`). The version rides the engine's release cascade.

**Android:** the same wrapper ships as an AAR —
`io.github.corvid-db:corvid-android` (published in the same release
bundle, same version). ONE dependency, no classifier — the AAR
carries the Kotlin classes plus `arm64-v8a` and `x86_64` `jniLibs`
pairs (engine cdylib + JNI shim), `Corvid.load()` resolves them
through Android's `nativeLibraryDir` automatically, and `minSdk` is
26:

```kotlin
dependencies {
    implementation("io.github.corvid-db:corvid-android:0.4.1")
}
```

The API is identical (the SAME Kotlin sources, compiled against
`android.jar`); the engine's Android cdylibs ship on the engine
release since v0.4.1, and the on-device gate is the repo's
instrumented smoke against the arm64 ATD emulator.

Building from source instead (development):

```sh
./fetch.sh                    # fetch + sha256-verify corvid v0.4.1
./scripts/build-native.sh     # compile the JNI shim into build/native
./gradlew test                # the golden suite (267 executable lines)
./gradlew examples            # the six-example tour
```

Requirements: JDK 17+ (CI exercises 21 and 17), Gradle 8.14+
(wrapper-pinned), Kotlin 2.2.x, a C compiler (clang/gcc/MSVC). On
Windows: `./fetch.ps1` then `./scripts/build-native.ps1`. Consumers
point the library loader at the shim directory via
`-Dcorvid.native.dir=<dir>` (or `CORVID_NATIVE_DIR`).

## Documents, maps, and phrases

Engine v0.3.0's ABI additions are first-class here:

- **Complete map decoding** — every decode path (`get`, `scan`,
  `page`, query rows, geo docs, callback arguments) enumerates map keys
  through the real `corvid_value_map_keys` iterator (ascending
  key-byte order), so documents decode COMPLETE on any database,
  whatever wrote the data — no candidate-key oracle, ever. Decoded maps
  are `LinkedHashMap`s in that engine order.
- `Collection.phraseSearch(field, phrase, k)` — the DIRECT positional
  search: consecutive, in-order analyzed tokens, stop words collapsing
  out of adjacency, rows carrying the BM25 phrase score (the phrase
  scale, not the builder's fused RRF scale); `k == 0` answers an empty
  result — inert, never an error. The `TextSearch` example demonstrates
  it, CJK bigram phrases included.

NaN/±inf/-0.0 cross bit-exactly and NaN payloads are preserved —
documented, and pinned op by op by the golden suite's `bits:` literals.

## The examples

Six runnable programs under the repo's `examples/` directory
(`./gradlew example<Name>`), executed on every CI leg with
deterministic output: **Quickstart**, **Hybrid** (the flagship below),
**VectorIndex** (in-memory / on-disk / binary-quantized HNSW vs the
exact scan, plus a close/reopen), **TextSearch** (BM25 incl. CJK
bigram segmentation, plus the v0.3.0 direct `phraseSearch`), **Graph**
(neighbors/traverse + delete cascade), and **Geo** (radius / bbox /
nearest with haversine kilometres). The quickstart and hybrid sources
are embedded below — imported from the repo so they cannot drift from
what CI executes (`scripts/sync-binding-examples.sh`; the drift gate
reddens docs CI if they diverge).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```kotlin
fun main() {
    openMemory().use { db ->
        val docs = db.collection("docs")

        docs.insert("p1".toByteArray(), mapOf(
            "title" to "rust embedded database", "kind" to "doc",
            "v" to floatArrayOf(1.0f, 0.0f),
        ))
        docs.insert("p2".toByteArray(), mapOf(
            "title" to "python web frameworks", "kind" to "doc",
            "v" to floatArrayOf(0.0f, 1.0f),
        ))
        docs.insert("p3".toByteArray(), mapOf(
            "title" to "rust again database", "kind" to "doc",
            "v" to floatArrayOf(0.9f, 0.1f),
        ))

        // kNN: the 3 nearest documents to (1, 0) under cosine. Project
        // the field the printout needs (docs decode in full either way;
        // select trims the payload).
        val rows = docs.query()
            .vector("v", floatArrayOf(1.0f, 0.0f), 3, Metric.COSINE)
            .select("title")
            .run()
        rows.forEachIndexed { rank, r ->
            println("%d. %s score=%.6f %s".format(rank + 1, String(r.key), r.score, r.doc))
        }

        docs.close()
    }
}
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```kotlin
fun main() {
    openMemory().use { db ->
        val docs = db.collection("docs")

        docs.insert("s1".toByteArray(), mapOf(
            "kind" to "doc", "body" to "rust embedded database",
            "v" to floatArrayOf(1.0f, 0.0f),
        ))
        docs.insert("s2".toByteArray(), mapOf(
            "kind" to "doc", "body" to "python web frameworks",
            "v" to floatArrayOf(0.0f, 1.0f),
        ))
        docs.insert("s3".toByteArray(), mapOf(
            "kind" to "doc", "body" to "rust again database",
            "v" to floatArrayOf(0.9f, 0.1f),
        ))
        docs.insert("m1".toByteArray(), mapOf("kind" to "meta")) // filtered out below

        // The flagship query: filter + vector + text, RRF + MMR + limit.
        val rows = docs.query()
            .filter(field("kind").eq("doc"))
            .vector("v", floatArrayOf(1.0f, 0.0f), 2, Metric.COSINE)
            .text("body", "rust database", 2)
            .fuseRRF(60.0f)
            .rerankMMR(1.0f)
            .limit(2)
            .select("body")
            .run()
        rows.forEachIndexed { rank, r ->
            println("%d. %s score=%.6f %s".format(rank + 1, String(r.key), r.score, r.doc))
        }

        docs.close()
    }
}
```

<!-- corvid-examples:hybrid END -->
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```kotlin
fun main() {
    val path = Path.of(System.getProperty("java.io.tmpdir"), "corvid-jvm-example-vector-index.redb")
    Files.deleteIfExists(path) // reruns start clean (single-file db)

    open(path.toString()).use { db ->
        val items = db.collection("items")
        for ((key, v) in corpus) {
            items.insert(key.toByteArray(), mapOf(
                "v_mem" to v, "v_disk" to v, "v_q" to v,
            ))
        }
        items.createVectorIndex("v_mem", Metric.COSINE)
        items.createVectorIndexOnDisk("v_disk", Metric.COSINE)
        items.createVectorIndexQuantized("v_q", Metric.COSINE, Quant.BINARY)

        println("top-4 nearest to (1,0,0,0) under cosine:")
        runQuery(items, "v_mem", false, "exact (scan):")
        runQuery(items, "v_mem", true, "ann in-memory HNSW:")
        runQuery(items, "v_disk", true, "ann on-disk HNSW:")
        runQuery(items, "v_q", true, "ann binary-quantized:")
        println("(the quantized lane trades recall for a ~32x smaller index)")

        items.close()
    }

    // Reopen: the on-disk graph reloads (no rebuild) and answers again.
    open(path.toString()).use { db ->
        val items = db.collection("items")
        runQuery(items, "v_disk", true, "ann on-disk after reopen:")
        items.close()
    }

    Files.deleteIfExists(path)
}
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```kotlin
fun main() {
    openMemory().use { db ->
        val notes = db.collection("notes")

        for ((key, body) in corpus) {
            notes.insert(key.toByteArray(), mapOf("body" to body))
        }
        notes.createTextIndex("body")

        search(notes, "quick fox", "bm25 \"quick fox\":")
        search(notes, "quick dog", "bm25 \"quick dog\":")
        search(notes, "城市", "bm25 CJK 城市 (city):")
        search(notes, "数据库", "bm25 CJK 数据库 (database):")

        phrase(notes, "fox jumps over", "phrase \"fox jumps over\":")
        phrase(notes, "over jumps fox", "phrase \"over jumps fox\" (reversed — no match):")
        phrase(notes, "leaps over a sleeping", "phrase with stop words collapsed:")

        notes.close()
    }
}
```

<!-- corvid-examples:text_search END -->
### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```kotlin
fun main() {
    openMemory().use { db ->
        val nodes = db.collection("nodes")

        for (key in listOf("ga", "gb", "gc")) {
            nodes.insert(key.toByteArray(), mapOf("n" to key))
        }

        nodes.link("ga".toByteArray(), "parent_of", "gb".toByteArray())
        nodes.link("ga".toByteArray(), "parent_of", "gc".toByteArray())
        nodes.link("gb".toByteArray(), "parent_of", "gd".toByteArray()) // gd never a document
        nodes.linkWeighted("ga".toByteArray(), "route", "gb".toByteArray(), 2.5)
        nodes.linkWeighted("ga".toByteArray(), "route", "gd".toByteArray(), 0.75)

        val ga = "ga".toByteArray()
        val gb = "gb".toByteArray()

        show("neighbors(ga)", nodes.neighbors(ga, "parent_of"))
        show("in_neighbors(gb)", nodes.inNeighbors(gb, "parent_of"))
        val routes = nodes.neighborsWeighted(ga, "route")
            .joinToString(" ") { r -> "%s=%.2f".format(String(r.key), r.weight) }
        println("%-36s [%s]".format("routes from ga (weighted):", routes))
        show("traverse(ga, 1 hop)", nodes.traverse(ga, "parent_of", 1))
        show("traverse(ga, 2 hops)", nodes.traverse(ga, "parent_of", 2))

        // Delete cascade: remove gc (a document) and gd (never a document).
        println("delete gc: existed = " + nodes.delete("gc".toByteArray()))
        val existedGd = nodes.delete("gd".toByteArray())
        println("delete gd: existed = $existedGd (never a document; its edges still cascade)")

        show("neighbors(ga) after deletes", nodes.neighbors(ga, "parent_of"))
        show("neighbors(gb) after deletes", nodes.neighbors(gb, "parent_of"))
        show("traverse(ga, 2 hops) after", nodes.traverse(ga, "parent_of", 2))

        nodes.close()
    }
}
```

<!-- corvid-examples:graph END -->
### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```kotlin
fun main() {
    openMemory().use { db ->
        val places = db.collection("places")

        for ((name, lat, lon) in cities) {
            places.insert(name.toByteArray(), mapOf(
                "name" to name,
                "loc" to listOf(lat, lon), // the [lat, lon] array encoding
            ))
        }
        places.createGeoIndex("loc")

        show("within 600km of Berlin:", places.geoWithinRadius("loc", 52.52, 13.40, 600.0))
        show("bbox 47..55N, 5..15E:", places.geoWithinBBox("loc", 47.0, 5.0, 55.0, 15.0))
        show("nearest 2 to Berlin:", places.geoNearest("loc", 52.52, 13.40, 2))

        places.close()
    }
}
```

<!-- corvid-examples:geo END -->





## API at a glance

Generated from the binding's `docs/SURFACE.tsv` (every engine
construct at the pinned tag mapped or N/A with a reason) — regenerated
by the docs sync, so it cannot drift.

<!-- corvid-api-glance BEGIN -->

| API group | engine constructs | proven by |
|---|---|---|
| `the Kotlin value mapping (null/Boolean/Long/Double/String/ByteArray/FloatArray/List<Any?>/LinkedHashMap<String,Any?>)` | 10 | golden:values.txt:VTYPE |
| `FieldExpr.eq/ne/lt/le/gt/ge` | 7 | golden:queries.txt:QF_* |
| `Predicate via field()/Predicate.not()` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN |
| `Metric enum (Metric.COSINE/Metric.DOT/Metric.L2)` | 4 | golden:queries.txt:QVEC |
| `Quant enum (Quant.NONE/Quant.BINARY/Quant.SCALAR)` | 4 | golden:schema.txt:IDX_VEC_Q |
| `throws CorvidException` | 1 | golden:mutations.txt:INSERT_ERR |
| `CorvidException.code (ErrCode table)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.DATABASE (code 1)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.TRANSACTION (code 2)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.TABLE (code 3)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.STORAGE (code 4)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.COMMIT (code 5)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.SET_DURABILITY (code 6)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.COMPACTION (code 7)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.DECODE (code 8)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.CORRUPT_INDEX (code 9)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.RESERVED_COLLECTION (code 10)` | 1 | ErrCodesTest.errorCodeTableIsFrozen; golden:mutations.txt:INSERT_ERR(err:10) |
| `ErrCode.INVALID_NAME (code 11)` | 1 | ErrCodesTest.errorCodeTableIsFrozen; golden:mutations.txt:INSERT_ERR(err:11) |
| `ErrCode.ARGUMENT (code 12)` | 1 | ErrCodesTest.errorCodeTableIsFrozen; golden:mutations.txt:UPDATE_ABORT(err:12) |
| `ErrCode.INCOMPATIBLE_FORMAT (code 13)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.EMPTY_INDEX_TRAINING (code 14)` | 1 | ErrCodesTest.errorCodeTableIsFrozen; golden:schema.txt:IDX_PQ_ERR(err:14) |
| `ErrCode.SCHEMA_VIOLATION (code 15)` | 1 | ErrCodesTest.errorCodeTableIsFrozen; golden:schema.txt:SCHEMA_ERR(err:15) |
| `ErrCode.INVALID_DUMP (code 16)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
| `ErrCode.BACKUP_TARGET_EXISTS (code 17)` | 1 | ErrCodesTest.errorCodeTableIsFrozen; golden:admin.txt:BACKUP_DUP(err:17) |
| `ErrCode.IO (code 18)` | 1 | ErrCodesTest.errorCodeTableIsFrozen |
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
| `corvid.open/openMemory + Db.collection/collections/backup/compact` | 6 | golden:admin.txt (COLLECTIONS/BACKUP/COMPACT) |
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
| `Collection.phraseSearch(field, phrase, k) — the direct positional search (corvid_phrase_search, v0.3.0) over the rows cursor` | 1 | golden:queries.txt:PHRASE |
| `Query.fuseRRF default k=60` | 1 | golden:queries.txt:HYBRID |
| `GeoHit { key, doc, distanceKm }` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `Collection.geoWithinRadius/geoNearest/geoWithinBBox/createGeoIndex` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `Collection.link/linkWeighted/unlink/neighbors/inNeighbors/neighborsWeighted/traverse` | 7 | golden:graph.txt |
| `Collection.createScalarIndex/createCompoundIndex/createTextIndex[/OnDisk]/createGeoIndex/createVectorIndex* (variants)` | 10 | golden:schema.txt:IDX_* |
| `FieldType enum (FieldType.ANY/BOOL/INT/FLOAT/TEXT/BYTES/VECTOR/ARRAY/MAP)` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `Collection.setSchema/schema + FieldDef(name, type, required, unique)` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `Collection.insertTTL/setTTL/getTTL/purgeExpired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `Db.dump/load/loadWithRenames` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) |

159 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

Dokka-generated reference: [corvid-db.github.io/corvid-jvm](https://corvid-db.github.io/corvid-jvm/) — published from the same sources the artifact builds.


## The correctness floor

`./gradlew test` replays the engine's entire **golden fixture suite** —
267 executable lines across 8 files, including the v0.3.0
`VMAP_KEYS`/`GET_KEYS` (map-key iteration) and `PHRASE`/`PHRASE_K0`
(direct positional search) lines — against the **downloaded** cdylib,
through a line-for-line port of the engine's C harness
(`GoldenTest.kt`): every counted line must dispatch, the first failure
names file:line + OP + expected-vs-got, and the `UPDATE_ABORT` line
pins both halves of the callback ruling (the marker exception surfaces
at the call site AND the engine's abort is readable in the same-thread
last-error slot). The fixtures are vendored in the repo and
byte-compared against the release's copies at fetch time (the repo's
`.gitattributes` pins `* -text` so Windows checkouts cannot CRLF them),
so a bad artifact is a loud fetch failure, never a silent skip.

On top sits `docs/SURFACE.tsv` — every construct of the engine's public
surface (327 rows at this pin) resolved to the Kotlin API exposing it
plus the golden line that proves it, or `N/A` with the ABI's §9 reason,
gated in CI (`scripts/surface-gate.sh`).

Android AAR bundling is a documented follow-up with a trigger (first
Android consumer request, or the Maven Central publish) — a packaging
change only; no API or lifetime semantics move (the repo's
`docs/PLAN.md`).

Next: [the bindings overview](/bindings/overview/).
