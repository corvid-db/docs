---
title: Install
description: How to install corvid today — a git dependency for Rust, the C ABI artifacts from GitHub releases, and the corvid-node npm package; feature flags and platform support.
sidebar:
  order: 1
---

corvid is a Rust library. Today it is consumed three ways:

1. **From Rust** — a git dependency (crates.io publication is planned; see
   [bindings roadmap](/bindings/overview/)).
2. **From C or any C-FFI language** — the release artifacts of the engine:
   the `corvid` cdylib plus the generated `corvid.h`, attached to every
   [engine release](https://github.com/corvid-db/corvid/releases).
3. **From Node.js** — the [`corvid-node`](https://www.npmjs.com/package/corvid-node)
   npm package with prebuilt binaries.

## Rust (git dependency)

```toml
[dependencies]
corvid = { git = "https://github.com/corvid-db/corvid" }
```

Pin a tag if you want reproducible builds (recommended while pre-1.0):

```toml
[dependencies]
corvid = { git = "https://github.com/corvid-db/corvid", tag = "v0.2.1" }
```

Requires stable Rust, 2024 edition, MSRV **1.88**. The default build has no
required features and pulls in only `redb`; the engine is
`#![forbid(unsafe_code)]`.

### Optional cargo features

Both features are **OFF by default** so the default build stays
dependency-minimal (and the WASM size budget stays a contract):

| Feature | What it does | Enable with |
|---|---|---|
| `zstd` | Transparent compression of stored documents at/above 1 KiB. Queries, scans, indexes, dump/load all behave identically — just smaller on disk (~12× on structured text; vector payloads barely compress). | `corvid = { features = ["zstd"] }` |
| `tracing` | Structured instrumentation events at the engine's load-bearing points, for any `tracing`-compatible subscriber. | `corvid = { features = ["tracing"] }` |

See [feature flags](/admin/features/) for details and caveats (notably:
backups are physical copies and not portable across feature builds — use
[dump/load](/admin/dump-load/) to move between configurations).

## The C ABI (release artifacts)

Every engine release attaches a per-platform FFI archive containing the
cdylib, `corvid.h`, and golden fixtures, with sha256 entries in
`checksums.txt`:

- Linux: `libcorvid.so`
- macOS: `libcorvid.dylib` (install name `@rpath/libcorvid.dylib` since
  v0.2.1)
- Windows: `corvid.dll` plus its MSVC import library `corvid.dll.lib` —
  link the import lib, place the DLL on the loader path

The contract these artifacts implement is [the C ABI](/ffi/overview/) specification.
[`corvid-c`](/bindings/corvid-c/) shows the full consumption pattern: fetch a
pinned release, verify checksums, link, run the golden suite.

If you prefer to build from source:

```sh
git clone https://github.com/corvid-db/corvid
cd corvid
cargo build -p corvid-ffi --release
# → target/release/libcorvid.{so,dylib} or corvid.dll, plus corvid.h
```

## Node.js

```sh
npm i corvid-node
```

Prebuilt binaries cover `darwin-arm64`, `darwin-x64`, `linux-x64-gnu`,
`linux-arm64-gnu`, and `win32-x64-msvc`; other platforms build from source
(Rust ≥ 1.88 + a C toolchain). See [corvid-node](/bindings/corvid-node/).

## The MCP sidecar

The `corvid-mcp` binary ships on the engine's releases (Linux x86_64/aarch64,
macOS Intel/Apple Silicon, Windows x86_64):

```sh
# from source:
cargo run -p corvid-mcp -- app.corvid   # file-backed; omit the path for in-memory
```

See [the MCP sidecar](/admin/mcp/).

## Platform support

| Target | Status |
|---|---|
| Desktop/server (Linux, macOS, Windows) | full support, CI-tested |
| WASM (`wasm32-unknown-unknown`) | engine builds; ≈0.2 MB gzipped harness, in-memory use |
| Mobile (aarch64 iOS/Android) | engine cross-compiles |

WASM persistence (OPFS) and the JS browser binding are planned, not shipped —
see the [bindings roadmap](/bindings/overview/).

## Next

Open your first database in the [tutorial](/tutorial/first-database/).
