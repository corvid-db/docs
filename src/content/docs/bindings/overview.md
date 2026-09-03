---
title: Bindings ecosystem
description: Language bindings for corvid — twelve live (corvid-c reference consumer, corvid-node, corvid-python, corvid-go, corvid-js in the browser via WebAssembly with OPFS persistence, corvid-cpp with RAII over the C ABI, corvid-zig over the C ABI with Zig error unions, corvid-dart over the C ABI with dart:ffi + ffigen, corvid-php as a native PHP extension over the C ABI, corvid-jvm — Kotlin-first over the C ABI via a JNI shim, Java consumes the same artifact — plus its corvid-android AAR, corvid-swift for Apple platforms over the published xcframework, and the engine itself on crates.io), each with a runnable six-example tour and registry-published where the language has one.
sidebar:
  order: 0
---

Bindings sit on [the C ABI](/ffi/overview/) (or embed the engine directly), expose
idiomatic OOP per the ABI's ruling 3 — handles become native classes,
iterators become the language's native iteration, `CORVID_ERR` becomes
native exceptions, destructors map to the dispose pattern — and are
**synchronous** in v1 (the engine is sync; corvid-js's persistent OPFS
surface is the one documented async mirror). No FFI symbols leak into a
binding's public API.

## Live

| Binding | Language | Status |
|---|---|---|
| [corvid-c](/bindings/corvid-c/) | C (reference consumer) | live — release-artifact conformance, golden suite port, six-example tour as ctests |
| [corvid-node](/bindings/corvid-node/) | Node.js (native, engine compiled in) | live — golden-suite CI + examples tour; **npm** `corvid-node` (prebuilt platform binaries) |
| [corvid-python](/bindings/corvid-python/) | Python (native, engine compiled in) | live — golden-suite CI + examples tour; **PyPI** `corvid-python` (abi3 wheels) |
| [corvid-go](/bindings/corvid-go/) | Go (cgo over the published cdylib) | live — golden-suite CI + examples tour, no Rust toolchain required |
| [corvid-js](/bindings/corvid-js/) | JavaScript (browser/Worker, engine compiled to wasm) | live — **npm** `corvid-js`; golden suite incl. the file-backed fixtures in real Chromium, reload/cross-tab persistence contracts, CI-enforced wasm size budget; sync in-memory surface + async OPFS persistence |
| [corvid-cpp](/bindings/corvid-cpp/) | C++ (RAII over the published cdylib) | live — golden-suite CI + examples tour, header-first RAII library, no Rust toolchain required |
| [corvid-zig](/bindings/corvid-zig/) | Zig (@cImport of the published cdylib) | live — golden-suite CI + examples tour (text search exercises the phrase API), move-safe handles and typed borrows, no Rust toolchain required |
| [corvid-dart](/bindings/corvid-dart/) | Dart (dart:ffi + ffigen over the published cdylib) | live — golden-suite CI + examples tour + an ffigen drift gate, Db/Collection/Query with NativeFinalizer backstops, no Rust toolchain required; **pub.dev** `corvid` |
| [corvid-php](/bindings/corvid-php/) | PHP (native extension over the published cdylib) | live — golden-suite CI (NTS 8.4/8.3 + a linux ZTS leg) + examples tour, refcounted handle lifetimes with the honest FPM story; **Packagist** `corvid/php-corvid`, installed with PIE |
| [corvid-jvm](/bindings/corvid-jvm/) | Kotlin/Java (JNI shim over the published cdylib) + Android | live — golden-suite CI (linux/macos/windows × JDK 21/17) + examples tour, Kotlin-first API with `AutoCloseable` handles and `CorvidException`, Java consumes the same artifact; **Maven Central** `io.github.corvid-db:corvid-jvm` (self-contained per-platform jars) and `io.github.corvid-db:corvid-android` (the AAR — same wrapper, `arm64-v8a`/`x86_64` jniLibs, minSdk 26) |
| [corvid-swift](/bindings/corvid-swift/) | Swift on Apple platforms (iOS 13+ device/simulator, macOS; over the published xcframework, no shim) | live — golden-suite CI (267/267 on macOS) + iOS-Simulator compile leg + surface gate; installed by SPM package URL, the tag IS the release (binary target checksum-pinned) |
| corvid (Rust) | Rust | the engine itself — **crates.io** `corvid-db`, native API |

Every live binding ships the same **examples tour** — six runnable
programs per language (quickstart, hybrid RRF+MMR, vector-index families,
text search incl. CJK, graph with delete cascade, geo), executed on
every CI leg with deterministic output. The quickstart and hybrid
sources are imported into each binding page here
(`scripts/sync-binding-examples.sh`; CI diffs against the binding repos'
master so they cannot drift).

## The correctness floor

Every binding replays the engine's **golden fixtures** — the 267-line
fixture suite the C ABI smoke harness runs — against its public API on every
CI run. corvid-c ports the fixtures in C; corvid-node and corvid-python
replay them through TypeScript and pytest; corvid-go drives them through
`go test`; corvid-js runs all eight fixture files in real Chromium — the
six in-memory files against the synchronous surface via `await init()`,
and the two file-backed files (`persist`, `admin`) end to end through the
async OPFS surface in a real Worker, plus reload and cross-tab
single-writer contracts; corvid-zig replays them through a
statement-for-statement port of the engine's own C harness; corvid-dart
drives them through `dart test`; corvid-php replays them through PHPUnit
(and a direct driver on its ZTS CI leg); corvid-jvm drives them through
JUnit 5 in Gradle. On top of the golden suite, every binding's CI
executes its examples tour. A binding that cannot pass the golden suite
is not shippable; that is the program's bar.

Next: [corvid-c](/bindings/corvid-c/).
