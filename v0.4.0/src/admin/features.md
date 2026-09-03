---
title: Feature flags
description: corvid's optional cargo features — zstd document compression and tracing instrumentation, both OFF by default, with ratios, overheads and portability caveats.
sidebar:
  order: 5
---

The engine has **no required features** — the default build pulls in only
`redb` and is `#![forbid(unsafe_code)]`. Two optional cargo features exist,
both OFF by default so the dependency-minimal default build and the WASM
size budget stay contracts:

```toml
[dependencies]
corvid = { git = "https://github.com/corvid-db/corvid", features = ["zstd"] }
```

## `zstd` — transparent document compression

With the feature on, values in user collections whose encoding is **≥ 1 KiB**
are compressed (zstd level 3) when written and decompressed on every read
path — queries, scans, paging, indexes, TTL, edges, dump/load, and backup
all behave identically, just smaller on disk.

- Stored rows are self-describing (a reserved leading marker byte `0xFF` no
  value encoding can produce), so databases written by default (feature-off)
  builds read fine under a feature-on build, and `dump` output is
  format-stable v2 either way.
- Incompressible values are stored raw (never larger). The known tax: a
  ≥1 KiB random value pays the compression attempt (~0.85 µs/KiB) and is
  stored raw anyway.
- Engine-internal `__` namespaces (indexes, edges, TTL) stay raw.

**Measured ratios** (deterministic corpora, exact byte counts):

| Document | Stored | Ratio |
|---|---|---|
| Structured text map, 50,975 B | 4,242 B | **8.3% (12×)** |
| f32 vector array (smooth sin values), 16k dims | 59,933 B | 91.4% (~1.1×) |
| Random bytes, 64 KiB | raw | — |

The honest headline: **vector payloads barely compress** — IEEE-754
mantissas are near-full entropy even for smooth sequences. zstd is a
text/document play; the vector footprint levers are
[quantization](/indexes/quantization/) (Binary/Scalar/PQ).

**Per-op overhead** (8 KiB document, insert/get): ~+4.9 µs/write,
~+2.6 µs/read for compressible text; raw rows read at parity.

**Portability caveat**: backups are physical copies — a backup written by an
ON build fails per-row `Decode` under an OFF binary. `dump`/`load` carries
raw encodings either way and is the migration path between feature builds.

## `tracing` — structured instrumentation

```toml
corvid = { features = ["tracing"] }
```

Structured events at the engine's load-bearing points, via the `tracing`
facade (trimmed: `span!`/`event!` only) — attach any tracing-compatible
subscriber; events carry `target = "corvid"`. No public API change; when the
feature is off, every call site compiles to nothing through a private
telemetry shim (CI asserts the default and WASM dependency graphs never
contain `tracing`).

Instrumented at per-operation/per-page granularity (never per-document) —
the full inventory is on the [observability](/admin/observability/) page.

Next: [observability](/admin/observability/).
