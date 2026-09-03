---
title: corvid-c
description: The corvid-c reference C consumer — fetch and verify release artifacts, link, run the golden suite and the six-example tour; quickstart and hybrid examples, installing, and the v0.2.0 macOS artifact story.
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

**When to choose this binding:** you are writing C (or building another
binding, a plugin, or an embedded deployment) and want the zero-dependency
path — no Rust toolchain, no language runtime, just a C11 compiler, CMake,
and the sha256-verified release archive. It is also the reference for how
the ABI's ownership rules (cloned inputs, consumed queries and predicates,
borrowed row views) are meant to be driven by hand, and the place where
published-artifact defects surface first.

## What's inside

| Path | What it is |
|---|---|
| `fetch.sh` / `fetch.ps1` | Download the pinned release archive, verify against the release's `checksums.txt` (sha256), extract into gitignored `deps/` |
| `CMakeLists.txt` | Offline-first build consuming `deps/`; builds the demo, the examples tour, and the golden-suite port; installs a `corvid.pc` |
| `examples/demo.c` | A small idiomatic consumer: open, insert, query, print (~20 symbols) |
| `examples/{quickstart,hybrid,vector_index,text_search,graph,geo}.c` | The examples tour — one runnable program per concept, each a ctest on every CI leg |
| `test/golden.c` | The golden-suite port — replays the engine's 267-line fixture suite against the downloaded libcorvid |

## Quick start

Requirements: a C11 compiler, CMake ≥ 3.28, `curl` + `shasum`/`sha256sum`
(macOS/Linux) or PowerShell 5+ (Windows).

```sh
./fetch.sh                     # download + verify corvid v0.3.2 into deps/
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure   # golden suite + demo + examples
./build/bin/demo                              # open → insert → query → print
./build/bin/example_hybrid                    # the flagship hybrid query
```

Windows: `./fetch.ps1`, then the same CMake steps (`ctest -C Release`).

## The examples

Six runnable programs, each also a ctest (and each leak-clean under the
CI sanitizer job): **quickstart** (open, insert, kNN, print), **hybrid**
(filter + vector + BM25, RRF fusion, MMR rerank, limit), **vector_index**
(in-memory / on-disk / binary-quantized HNSW vs the exact scan, plus a
close/reopen), **text_search** (BM25, English + CJK, plus the v0.3.0 direct `corvid_phrase_search`), **graph**
(neighbors/traverse + delete cascade), and **geo** (radius / bbox /
nearest with haversine kilometres). The quickstart and hybrid sources
are embedded below — imported from the repo's `examples/` so they cannot
drift from what CI executes (`scripts/sync-binding-examples.sh` keeps
this page in step; the drift gate reddens CI if they diverge).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```c
static void put_doc(corvid_coll *docs, const char *key, const char *title,
                    const char *kind, const float *v, size_t dim) {
    corvid_value *doc = corvid_value_map_new();
    must("map_put title", corvid_value_map_put(
        doc, "title", 5, corvid_value_text(title, strlen(title))));
    must("map_put kind", corvid_value_map_put(
        doc, "kind", 4, corvid_value_text(kind, strlen(kind))));
    must("map_put v",
         corvid_value_map_put(doc, "v", 1, corvid_value_vector(v, dim)));
    must("insert", corvid_insert(docs, (const uint8_t *)key, strlen(key), doc));
    corvid_value_free(doc); /* insert CLONES the value; ours is still ours */
}

int main(void) {
    corvid_db *db = corvid_open_memory();
    if (!db) { fprintf(stderr, "quickstart: open failed\n"); return 1; }
    corvid_coll *docs = corvid_collection(db, "docs", 4);
    if (!docs) { fprintf(stderr, "quickstart: collection failed\n"); return 1; }

    put_doc(docs, "p1", "rust embedded database", "doc",
            (const float[]){1.0f, 0.0f}, 2);
    put_doc(docs, "p2", "python web frameworks", "doc",
            (const float[]){0.0f, 1.0f}, 2);
    put_doc(docs, "p3", "rust again database", "doc",
            (const float[]){0.9f, 0.1f}, 2);

    /* kNN: the 3 nearest documents to (1, 0) under cosine. */
    corvid_query *q = corvid_query_new(docs);
    if (!q) { fprintf(stderr, "quickstart: query_new failed\n"); return 1; }
    must("query_vector",
         corvid_query_vector(q, "v", 1, (const float[]){1.0f, 0.0f}, 2, 3,
                             CORVID_METRIC_COSINE));
    corvid_rows *rows = corvid_query_run(q); /* consumes q */
    if (!rows) {
        size_t len = 0;
        const char *msg = corvid_last_error_message(&len);
        fprintf(stderr, "quickstart: query_run failed: %.*s\n", (int)len, msg);
        return 1;
    }

    int rank = 0;
    for (;;) {
        const uint8_t *key = NULL;
        size_t key_len = 0;
        const corvid_value *doc = NULL;
        float score = 0.0f;
        if (corvid_rows_next(rows, &key, &key_len, &doc, &score) != 1) break;
        const corvid_value *title =
            corvid_value_map_get(doc, "title", 5);
        size_t title_len = 0;
        const char *title_p = corvid_value_text_ref(title, &title_len);
        printf("%d. %-.*s score=%.6f %.*s\n", ++rank, (int)key_len, key,
               (double)score, (int)title_len, title_p ? title_p : "?");
    }
    corvid_rows_free(rows);

    corvid_collection_free(docs);
    must("close", corvid_close(db));
    return 0;
}
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```c
static void put_doc(corvid_coll *docs, const char *key, const char *kind,
                    const char *body, const float *v) {
    corvid_value *doc = corvid_value_map_new();
    must("map_put kind", corvid_value_map_put(
        doc, "kind", 4, corvid_value_text(kind, strlen(kind))));
    if (body)
        must("map_put body", corvid_value_map_put(
            doc, "body", 4, corvid_value_text(body, strlen(body))));
    if (v)
        must("map_put v",
             corvid_value_map_put(doc, "v", 1, corvid_value_vector(v, 2)));
    must("insert", corvid_insert(docs, (const uint8_t *)key, strlen(key), doc));
    corvid_value_free(doc);
}

static void print_rows(corvid_rows *rows) {
    int rank = 0;
    for (;;) {
        const uint8_t *key = NULL;
        size_t key_len = 0;
        const corvid_value *doc = NULL;
        float score = 0.0f;
        if (corvid_rows_next(rows, &key, &key_len, &doc, &score) != 1) break;
        const corvid_value *body = corvid_value_map_get(doc, "body", 4);
        size_t body_len = 0;
        const char *body_p = corvid_value_text_ref(body, &body_len);
        printf("%d. %-.*s score=%.6f %.*s\n", ++rank, (int)key_len, key,
               (double)score, (int)body_len, body_p ? body_p : "?");
    }
    corvid_rows_free(rows);
}

int main(void) {
    corvid_db *db = corvid_open_memory();
    if (!db) { fprintf(stderr, "hybrid: open failed\n"); return 1; }
    corvid_coll *docs = corvid_collection(db, "docs", 4);
    if (!docs) { fprintf(stderr, "hybrid: collection failed\n"); return 1; }

    put_doc(docs, "s1", "doc", "rust embedded database",
            (const float[]){1.0f, 0.0f});
    put_doc(docs, "s2", "doc", "python web frameworks",
            (const float[]){0.0f, 1.0f});
    put_doc(docs, "s3", "doc", "rust again database",
            (const float[]){0.9f, 0.1f});
    put_doc(docs, "m1", "meta", NULL, NULL); /* filtered out below */

    /* The flagship query: filter + vector + text, RRF + MMR + limit. */
    corvid_query *q = corvid_query_new(docs);
    if (!q) { fprintf(stderr, "hybrid: query_new failed\n"); return 1; }

    corvid_value *doc_kind = corvid_value_text("doc", 3);
    corvid_pred *only_docs =
        corvid_pred_compare("kind", 4, CORVID_CMP_EQ, doc_kind);
    corvid_value_free(doc_kind); /* CLONED into the tree (§5 rule 3) */
    if (!only_docs) { fprintf(stderr, "hybrid: pred_compare failed\n"); return 1; }
    must("query_filter", corvid_query_filter(q, only_docs)); /* consumes pred */

    must("query_vector",
         corvid_query_vector(q, "v", 1, (const float[]){1.0f, 0.0f}, 2, 2,
                             CORVID_METRIC_COSINE));
    must("query_text",
         corvid_query_text(q, "body", 4, "rust database", 13, 2));
    must("query_fuse_rrf", corvid_query_fuse_rrf(q, 60.0f));
    must("query_rerank_mmr", corvid_query_rerank_mmr(q, 1.0f));
    must("query_limit", corvid_query_limit(q, 2));

    corvid_rows *rows = corvid_query_run(q); /* consumes q */
    if (!rows) {
        size_t len = 0;
        const char *msg = corvid_last_error_message(&len);
        fprintf(stderr, "hybrid: query_run failed: %.*s\n", (int)len, msg);
        return 1;
    }
    print_rows(rows);

    corvid_collection_free(docs);
    must("close", corvid_close(db));
    return 0;
}
```

<!-- corvid-examples:hybrid END -->

The fused scores are RRF rank sums: `s1` is rank 1 of both sources
(1/61 + 1/61 = 2/61 ≈ 0.032787), `s3` rank 2 of both (2/62 ≈ 0.032258).

Every construct maps to the [ABI function pages](/ffi/functions-lifecycle/);
the ownership flow (cloned document inputs, consumed query and predicate,
borrowed row views) follows the [transfer rules](/ffi/ownership/).

## Installing (system use)

`cmake --install build` installs `corvid.h`, the library, and a `corvid.pc`
pkg-config file:

```sh
pkg-config --cflags --libs corvid
```

## Versioning

The engine pin lives in one variable in the fetch scripts
(`CORVID_VERSION=v0.3.2`). Artifacts are always taken from that exact tag's
GitHub release and sha256-verified; `deps/` is never committed.

## The macOS note (a bindings-program war story)

The v0.2.0 darwin dylibs shipped with the release CI runner's absolute path
as their install name, so binaries linked against them aborted at launch.
corvid-c caught this (finding F1 in its plan); the engine fixed its release
pipeline; **every pin since v0.2.1 — the current is v0.3.2 — is clean**:
`otool -D` shows
`@rpath/libcorvid.dylib`, and the golden suite runs 267/267 with no
workarounds. v0.2.1's Linux `.so` also gained its SONAME (finding F2,
likewise resolved). This is the reference-consumer role working as designed.

Next: [corvid-node](/bindings/corvid-node/).
