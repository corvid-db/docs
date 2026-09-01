---
title: Bindings ecosystem
description: Language bindings for corvid — shipped (corvid-c reference consumer, corvid-node) and the planned ecosystem index (go, js/wasm, jvm, dart, php, python, cpp, zig, rust on crates.io), each with its planned scope.
sidebar:
  order: 0
---

Bindings sit on [the C ABI](/ffi/overview/) (or embed the engine directly), expose
idiomatic OOP per the ABI's ruling 3 — handles become native classes,
iterators become the language's native iteration, `CORVID_ERR` becomes
native exceptions, destructors map to the dispose pattern — and are
**synchronous** in v1 (the engine is sync). No FFI symbols leak into a
binding's public API.

## Shipped

| Binding | Language | Status |
|---|---|---|
| [corvid-node](/bindings/corvid-node/) | Node.js (native) | shipped — npm `corvid-node`, prebuilt binaries, golden-suite CI |
| [corvid-c](/bindings/corvid-c/) | C (reference consumer) | shipped — release-artifact conformance, golden suite port |
| corvid (Rust) | Rust | the engine itself; native API |

## Planned bindings

Each planned binding codes against the same frozen ABI, pins an exact
engine tag, and ships the engine's golden fixtures as its correctness floor.
One planned-scope line each:

| Binding | Planned scope |
|---|---|
| **corvid-go** | cgo bindings exposing `DB`, `Collection`, `Query` structs with Go-native errors; gofr-style module wrapping the cdylib artifacts, golden-suite port in `go test`. |
| **corvid-js** (wasm) | the engine compiled to `wasm32-unknown-unknown` behind a Worker-RPC surface; in-memory first, OPFS persistence when the engine's browser VFS lands. |
| **corvid-jvm** | JNI bindings for Java/Kotlin with `AutoCloseable` handles; cursor iterators as `java.util.Iterator`; gradle-consumed artifacts per platform. |
| **corvid-dart** | Flutter/Dart FFI bindings with `Finalizable` handles — mobile-first (the engine already cross-compiles for aarch64 iOS/Android). |
| **corvid-php** | PHP extension (FFI or native) with one handle per request/thread (ZTS posture per the ABI threading rules). |
| **corvid-python** | CPython extension (or PyO3-wrapped cdylib) exposing `corvid.Db` with context-manager lifetimes and `Iterator` cursors; wheels per platform. |
| **corvid-cpp** | RAII header-only wrapper over `corvid.h` — unique_ptr handles, ranges-compatible cursors, exceptions mapped from `corvid_err`. |
| **corvid-zig** | `extern` declarations generated from the ABI surface with Zig error-union returns and defer-friendly deinitializers. |
| **corvid-rust** (crates.io) | the engine itself, published to crates.io as `corvid` — replacing the git dependency (see [install](/start/install/)). |

Planned means planned: none of the above exist yet; this page is the
ecosystem index the project is executing against. Each will get its own
documentation section here when it ships.

## The correctness floor

Every binding replays the engine's **golden fixtures** — the 256-line
fixture suite the C ABI smoke harness runs — against its public API on every
CI run. corvid-c ports the fixtures in C; corvid-node replays them through
TypeScript. A binding that cannot pass the golden suite is not shippable;
that is the program's bar.

Next: [corvid-c](/bindings/corvid-c/).
