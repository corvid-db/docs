---
title: Install
description: How to install corvid — crates.io for Rust, the C ABI artifacts from GitHub releases, and the published language bindings (npm, PyPI, pub.dev, Packagist); feature flags and platform support.
sidebar:
  order: 1
---

corvid is consumed four ways:

1. **From Rust** — crates.io, package **`corvid-db`**: `corvid-db = "0.4"`
   with the `use corvid::…` ident.
2. **From C or any C-FFI language** — the release artifacts of the engine:
   the `corvid` cdylib plus the generated `corvid.h`, attached to every
   [engine release](https://github.com/corvid-db/corvid/releases).
3. **From a published language binding** —
   [`corvid-node`](https://www.npmjs.com/package/corvid-node) and
   [`corvid-js`](https://www.npmjs.com/package/corvid-js) on npm,
   [`corvid-python`](https://pypi.org/project/corvid-python/) on PyPI,
   [`corvid`](https://pub.dev/packages/corvid) on pub.dev, and
   [`corvid/php-corvid`](https://packagist.org/packages/corvid/php-corvid)
   on Packagist (installed with PIE). The full matrix — including the
   artifact-consuming C/Go/C++/Zig/JVM bindings — is the
   [bindings overview](/bindings/overview/).
4. **In the browser** — `npm i corvid-js`: the engine compiled to wasm,
   synchronous in-memory OOP plus async OPFS persistence (see
   [corvid-js](/bindings/corvid-js/)).

## Rust (crates.io)

```toml
[dependencies]
corvid-db = "0.4"   # the crate ident stays `corvid`: use corvid::…
```

For pinned, reproducible builds (recommended while pre-1.0), pin the git
dependency to an exact release tag instead:

```toml
[dependencies]
corvid-db = { git = "https://github.com/corvid-db/corvid", tag = "v0.4.0" }
```

Requires stable Rust, 2024 edition, MSRV **1.88**. The default build has no
required features and pulls in only `redb`; the engine is
`#![forbid(unsafe_code)]`.

### Optional cargo features

Both features are **OFF by default** so the default build stays
dependency-minimal (and the WASM size budget stays a contract):

| Feature | What it does | Enable with |
|---|---|---|
| `zstd` | Transparent compression of stored documents at/above 1 KiB. Queries, scans, indexes, dump/load all behave identically — just smaller on disk (~12× on structured text; vector payloads barely compress). | `corvid-db = { features = ["zstd"] }` |
| `tracing` | Structured instrumentation events at the engine's load-bearing points, for any `tracing`-compatible subscriber. | `corvid-db = { features = ["tracing"] }` |

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
`linux-arm64-gnu`, and `win32-x64-msvc`; other platforms build from
source (Rust ≥ 1.88 + a C toolchain). Publishing is automated via npm
trusted publishing — no registry tokens involved.
See [corvid-node](/bindings/corvid-node/).

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
| WASM (`wasm32-unknown-unknown`) + browser | shipped via [corvid-js](/bindings/corvid-js/): in-memory sync surface + OPFS persistence (Chromium CI-enforced; Firefox/Safari supported by the OPFS baseline) |
| Mobile (aarch64 iOS/Android) | engine cross-compiles |

## Next

Open your first database in the [tutorial](/tutorial/first-database/).
