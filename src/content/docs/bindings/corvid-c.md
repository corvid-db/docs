---
title: corvid-c
description: The corvid-c reference C consumer — fetch and verify release artifacts, link, run the golden suite; quick start, installing, and the v0.2.0 macOS artifact story.
sidebar:
 order: 1
---

[`corvid-c`](https://github.com/corvid-db/corvid-c) is the canonical C
consumer of corvid. It exists to prove, continuously and outside the
engine's repository, that the **published FFI artifacts** — the platform
cdylib, `corvid.h`, and the golden fixtures shipped in each release archive —
work for a plain C consumer. Its role in the bindings program is
**reference consumer**: everything there links the release artifacts exactly
the way a third-party binding author would — no engine checkout, no
vendored binaries.

## What's inside

| Path | What it is |
|---|---|
| `fetch.sh` / `fetch.ps1` | Download the pinned release archive, verify against the release's `checksums.txt` (sha256), extract into gitignored `deps/` |
| `CMakeLists.txt` | Offline-first build consuming `deps/`; builds the demo and the golden-suite port; installs a `corvid.pc` |
| `examples/demo.c` | A small idiomatic consumer: open, insert, query, print (~15 symbols) |
| `test/golden.c` | The golden-suite port — replays the engine's 256-line fixture suite against the downloaded libcorvid |

## Quick start

Requirements: a C11 compiler, CMake ≥ 3.16, `curl` + `shasum`/`sha256sum`
(macOS/Linux) or PowerShell 5+ (Windows).

```sh
./fetch.sh                     # download + verify corvid v0.2.1 into deps/
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure   # the golden suite (256 lines)
./build/bin/demo                              # open → insert → query → print
```

Windows: `./fetch.ps1`, then the same CMake steps (`ctest -C Release`).

## A taste of the API

```c
#include "corvid.h"

corvid_db *db = corvid_open_memory();
corvid_coll *docs = corvid_collection(db, "docs", 4);

corvid_value *doc = corvid_value_map_new();
corvid_value_map_put(doc, "name", 4, corvid_value_text("ada", 3));
corvid_value_map_put(doc, "v", 1, corvid_value_vector(v, 3));
corvid_insert(docs, (const uint8_t *)"p1", 2, doc);   /* clones the value */
corvid_value_free(doc);

corvid_query *q = corvid_query_new(docs);
corvid_query_vector(q, "v", 1, probe, 3, 2, CORVID_METRIC_COSINE);
corvid_rows *rows = corvid_query_run(q);              /* consumes q */
/* … corvid_rows_next(rows, &key, &key_len, &doc, &score) … */
corvid_rows_free(rows);
corvid_collection_free(docs);
corvid_close(db);
```

Every construct maps to the [ABI function pages](/ffi/functions-lifecycle/);
the ownership flow (cloned document inputs, consumed query, borrowed row
views) follows the [transfer rules](/ffi/ownership/).

## Installing (system use)

`cmake --install build` installs `corvid.h`, the library, and a `corvid.pc`
pkg-config file:

```sh
pkg-config --cflags --libs corvid
```

## Versioning

The engine pin lives in one variable in the fetch scripts
(`CORVID_VERSION=v0.2.1`). Artifacts are always taken from that exact tag's
GitHub release and sha256-verified; `deps/` is never committed.

## The macOS note (a bindings-program war story)

The v0.2.0 darwin dylibs shipped with the release CI runner's absolute path
as their install name, so binaries linked against them aborted at launch.
corvid-c caught this (finding F1 in its plan); the engine fixed its release
pipeline; **v0.2.1 — the current pin — is clean**: `otool -D` shows
`@rpath/libcorvid.dylib`, and the golden suite runs 256/256 with no
workarounds. v0.2.1's Linux `.so` also gained its SONAME (finding F2,
likewise resolved). This is the reference-consumer role working as designed.

Next: [corvid-node](/bindings/corvid-node/).
