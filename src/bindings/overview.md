---
title: Bindings ecosystem
description: Language bindings for corvid — four live (corvid-c reference consumer, corvid-node, corvid-python, corvid-go, each with a runnable six-example tour) and the planned ecosystem index (js/wasm, jvm, dart, php, cpp, zig, rust on crates.io).
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
| **corvid-js** (wasm) | the engine compiled to `wasm32-unknown-unknown` behind a Worker-RPC surface; in-memory first, OPFS persistence when the engine's browser VFS lands. |
| **corvid-jvm** | JNI bindings for Java/Kotlin with `AutoCloseable` handles; cursor iterators as `java.util.Iterator`; gradle-consumed artifacts per platform. |
| **corvid-dart** | Flutter/Dart FFI bindings with `Finalizable` handles — mobile-first (the engine already cross-compiles for aarch64 iOS/Android). |
| **corvid-php** | PHP extension (FFI or native) with one handle per request/thread (ZTS posture per the ABI threading rules). |
| **corvid-cpp** | RAII header-only wrapper over `corvid.h` — unique_ptr handles, ranges-compatible cursors, exceptions mapped from `corvid_err`. |
| **corvid-zig** | `extern` declarations generated from the ABI surface with Zig error-union returns and defer-friendly deinitializers. |
| **corvid-rust** (crates.io) | the engine itself, published to crates.io as `corvid` — replacing the git dependency (see [install](/start/install/)). |

Planned means planned: none of the above exist yet. Each will get its own
documentation section here when it ships.

## The correctness floor

Every binding replays the engine's **golden fixtures** — the 267-line
fixture suite the C ABI smoke harness runs — against its public API on every
CI run. corvid-c ports the fixtures in C; corvid-node and corvid-python
replay them through TypeScript and pytest; corvid-go drives them through
`go test`. On top of the golden suite, every binding's CI executes its
examples tour. A binding that cannot pass the golden suite is not
shippable; that is the program's bar.

Next: [corvid-c](/bindings/corvid-c/).
