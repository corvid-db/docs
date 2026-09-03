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
