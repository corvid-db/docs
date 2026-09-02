---
title: Bindings ecosystem
description: Language bindings for corvid — ten live (corvid-c reference consumer, corvid-node, corvid-python, corvid-go, corvid-js in the browser via WebAssembly, corvid-cpp with RAII over the C ABI, corvid-zig over the C ABI with Zig error unions, corvid-dart over the C ABI with dart:ffi + ffigen, corvid-php as a native PHP extension over the C ABI, and corvid-jvm — Kotlin-first over the C ABI via a JNI shim, Java consumes the same artifact, each with a runnable six-example tour) and the planned ecosystem index (rust on crates.io).
sidebar:
  order: 0
---

Bindings sit on [the C ABI](/ffi/overview/) (or embed the engine directly), expose
idiomatic OOP per the ABI's ruling 3 — handles become native classes,
iterators become the language's native iteration, `CORVID_ERR` becomes
native exceptions, destructors map to the dispose pattern — and are
**synchronous** in v1 (the engine is sync). No FFI symbols leak into a
binding's public API.

## Live

| Binding | Language | Status |
|---|---|---|
| [corvid-c](/bindings/corvid-c/) | C (reference consumer) | live — release-artifact conformance, golden suite port, six-example tour as ctests |
| [corvid-node](/bindings/corvid-node/) | Node.js (native, engine compiled in) | live — golden-suite CI + examples tour; npm publish pending first release |
| [corvid-python](/bindings/corvid-python/) | Python (native, engine compiled in) | live — golden-suite CI + examples tour; PyPI publish pending first release |
| [corvid-go](/bindings/corvid-go/) | Go (cgo over the published cdylib) | live — golden-suite CI + examples tour, no Rust toolchain required |
| [corvid-js](/bindings/corvid-js/) | JavaScript (browser/Worker, engine compiled to wasm) | live — golden-suite CI + examples tour + a CI-enforced wasm size budget; in-memory per session (OPFS persistence is a decided, trigger-based deferral); npm publish pending first release |
| [corvid-cpp](/bindings/corvid-cpp/) | C++ (RAII over the published cdylib) | live — golden-suite CI + examples tour, header-first RAII library, no Rust toolchain required |
| [corvid-zig](/bindings/corvid-zig/) | Zig (@cImport of the published cdylib) | live — golden-suite CI + examples tour (text search exercises the v0.3.0 phrase API), move-safe handles and typed borrows, no Rust toolchain required |
| [corvid-dart](/bindings/corvid-dart/) | Dart (dart:ffi + ffigen over the published cdylib) | live — golden-suite CI + examples tour + an ffigen drift gate, Db/Collection/Query with NativeFinalizer backstops, no Rust toolchain required; pub.dev publish pending first release |
| [corvid-php](/bindings/corvid-php/) | PHP (native extension over the published cdylib) | live — golden-suite CI (NTS 8.4/8.3 + a linux ZTS leg) + examples tour, refcounted handle lifetimes with the honest FPM story; PIE/PECL publish pending first release |
| [corvid-jvm](/bindings/corvid-jvm/) | Kotlin/Java (JNI shim over the published cdylib) | live — golden-suite CI (linux/macos/windows × JDK 21/17) + examples tour, Kotlin-first API with `AutoCloseable` handles and `CorvidException`, Java consumes the same artifact; Maven Central publish pending first release |
| corvid (Rust) | Rust | the engine itself; native API |

Every live binding ships the same **examples tour** — six runnable
programs per language (quickstart, hybrid RRF+MMR, vector-index families,
text search incl. CJK, graph with delete cascade, geo), executed on
every CI leg with deterministic output. The quickstart and hybrid
sources are imported into each binding page here
(`scripts/sync-binding-examples.sh`; CI diffs against the binding repos'
master so they cannot drift).

## Planned bindings

Each planned binding codes against the same frozen ABI, pins an exact
engine tag, and ships the engine's golden fixtures as its correctness floor.
One planned-scope line each:

| Binding | Planned scope |
|---|---|
| **corvid-rust** (crates.io) | the engine itself, published to crates.io as `corvid` — replacing the git dependency (see [install](/start/install/)). |

Planned means planned: none of the above exist yet. Each will get its own
documentation section here when it ships.

## The correctness floor

Every binding replays the engine's **golden fixtures** — the 267-line
fixture suite the C ABI smoke harness runs — against its public API on every
CI run. corvid-c ports the fixtures in C; corvid-node and corvid-python
replay them through TypeScript and pytest; corvid-go drives them through
`go test`; corvid-js replays the six in-memory fixture files through the
wasm binary node's runtime and browsers share (the two file-backed
fixture files are the deferred OPFS persistence boundary — their
in-memory contracts are pinned by its regression suite); corvid-zig
replays them through a statement-for-statement port of the engine's own
C harness; corvid-dart drives them through `dart test`; corvid-php
replays them through PHPUnit (and a direct driver on its ZTS CI leg);
corvid-jvm drives them through JUnit 5 in Gradle. On
top of the golden suite, every binding's CI executes its
examples tour. A binding that cannot pass the golden suite is not
shippable; that is the program's bar.

Next: [corvid-c](/bindings/corvid-c/).
