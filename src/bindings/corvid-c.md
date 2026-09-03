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

## Quick start

Requirements: a C11 compiler, CMake ≥ 3.28, `curl` + `shasum`/`sha256sum`
(macOS/Linux) or PowerShell 5+ (Windows).

```sh
./fetch.sh                     # download + verify corvid v0.4.1 into deps/
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
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```c
static void put_doc(corvid_coll *items, const char *key, const float *v) {
    corvid_value *doc = corvid_value_map_new();
    must("map_put v_mem", corvid_value_map_put(
        doc, "v_mem", 5, corvid_value_vector(v, 4)));
    must("map_put v_disk", corvid_value_map_put(
        doc, "v_disk", 6, corvid_value_vector(v, 4)));
    must("map_put v_q",
         corvid_value_map_put(doc, "v_q", 3, corvid_value_vector(v, 4)));
    must("insert", corvid_insert(items, (const uint8_t *)key, strlen(key), doc));
    corvid_value_free(doc);
}

/* Run a top-4 vector query over `field`, print its ranked keys. */
static void run_query(corvid_coll *items, const char *field, int approx,
                      const char *label) {
    corvid_query *q = corvid_query_new(items);
    if (!q) { fprintf(stderr, "vector_index: query_new failed\n"); exit(1); }
    static const float probe[4] = {1.0f, 0.0f, 0.0f, 0.0f};
    must("query_vector",
         corvid_query_vector(q, field, strlen(field), probe, 4, 4,
                             CORVID_METRIC_COSINE));
    if (approx) must("query_approx", corvid_query_approx(q));
    corvid_rows *rows = corvid_query_run(q);
    if (!rows) {
        size_t len = 0;
        const char *msg = corvid_last_error_message(&len);
        fprintf(stderr, "vector_index: query_run failed: %.*s\n", (int)len,
                msg);
        exit(1);
    }
    printf("%-38s", label);
    for (;;) {
        const uint8_t *key = NULL;
        size_t key_len = 0;
        const corvid_value *doc = NULL;
        float score = 0.0f;
        if (corvid_rows_next(rows, &key, &key_len, &doc, &score) != 1) break;
        printf(" %.*s(%.6f)", (int)key_len, key, (double)score);
    }
    printf("\n");
    corvid_rows_free(rows);
}

int main(void) {
    remove(DB_FILE); /* reruns start clean (single-file db) */

    static const float vecs[8][4] = {
        {1.0f, 0.0f, 0.0f, 0.0f},   /* k0 — nearest */
        {0.95f, 0.05f, 0.0f, 0.0f}, /* k1 */
        {0.0f, 1.0f, 0.0f, 0.0f},   /* k2 */
        {0.0f, 0.9f, 0.1f, 0.0f},   /* k3 */
        {0.0f, 0.0f, 1.0f, 0.0f},   /* k4 */
        {0.7f, 0.7f, 0.0f, 0.0f},   /* k5 */
        {0.0f, 0.0f, 0.0f, 1.0f},   /* k6 */
        {0.98f, 0.02f, 0.0f, 0.0f}, /* k7 */
    };
    static const char *keys[8] = {"k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7"};

    corvid_db *db = corvid_open(DB_FILE, strlen(DB_FILE));
    if (!db) { fprintf(stderr, "vector_index: open failed\n"); return 1; }
    corvid_coll *items = corvid_collection(db, "items", 5);
    if (!items) { fprintf(stderr, "vector_index: collection failed\n"); return 1; }

    for (int i = 0; i < 8; i++) put_doc(items, keys[i], vecs[i]);

    must("create_vector_index (in-memory)",
         corvid_create_vector_index(items, "v_mem", 5, CORVID_METRIC_COSINE));
    must("create_vector_index_ondisk",
         corvid_create_vector_index_ondisk(items, "v_disk", 6,
                                           CORVID_METRIC_COSINE));
    must("create_vector_index_quantized (binary)",
         corvid_create_vector_index_quantized(items, "v_q", 3,
                                              CORVID_METRIC_COSINE,
                                              CORVID_QUANT_BINARY));

    printf("top-4 nearest to (1,0,0,0) under cosine:\n");
    run_query(items, "v_mem", 0, "exact (scan):");
    run_query(items, "v_mem", 1, "ann in-memory HNSW:");
    run_query(items, "v_disk", 1, "ann on-disk HNSW:");
    run_query(items, "v_q", 1, "ann binary-quantized:");
    printf("(the quantized lane trades recall for a ~32x smaller index)\n");

    corvid_collection_free(items);
    must("close", corvid_close(db));

    /* Reopen: the on-disk graph reloads (no rebuild) and answers again. */
    db = corvid_open(DB_FILE, strlen(DB_FILE));
    if (!db) { fprintf(stderr, "vector_index: reopen failed\n"); return 1; }
    items = corvid_collection(db, "items", 5);
    if (!items) { fprintf(stderr, "vector_index: recollection failed\n"); return 1; }
    run_query(items, "v_disk", 1, "ann on-disk after reopen:");
    corvid_collection_free(items);
    must("close", corvid_close(db));

    remove(DB_FILE);
    return 0;
}
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```c
static void put_note(corvid_coll *notes, const char *key, const char *body) {
    corvid_value *doc = corvid_value_map_new();
    must("map_put body", corvid_value_map_put(
        doc, "body", 4, corvid_value_text(body, strlen(body))));
    must("insert", corvid_insert(notes, (const uint8_t *)key, strlen(key), doc));
    corvid_value_free(doc);
}

static void phrase(corvid_coll *notes, const char *q, const char *label) {
    corvid_rows *rows = corvid_phrase_search(notes, "body", 4, q, strlen(q), 3);
    if (!rows) {
        size_t len = 0;
        const char *msg = corvid_last_error_message(&len);
        fprintf(stderr, "text_search: phrase_search failed: %.*s\n", (int)len,
                msg ? msg : "?");
        exit(1);
    }
    printf("%-28s ->", label);
    for (;;) {
        const uint8_t *key = NULL;
        size_t key_len = 0;
        const corvid_value *doc = NULL;
        float score = 0.0f;
        if (corvid_rows_next(rows, &key, &key_len, &doc, &score) != 1) break;
        printf(" %.*s(%.6f)", (int)key_len, key, (double)score);
    }
    printf("\n");
    corvid_rows_free(rows);
}

static void search(corvid_coll *notes, const char *query, const char *label) {
    corvid_query *q = corvid_query_new(notes);
    if (!q) { fprintf(stderr, "text_search: query_new failed\n"); exit(1); }
    must("query_text",
         corvid_query_text(q, "body", 4, query, strlen(query), 3));
    corvid_rows *rows = corvid_query_run(q);
    if (!rows) {
        size_t len = 0;
        const char *msg = corvid_last_error_message(&len);
        fprintf(stderr, "text_search: query_run failed: %.*s\n", (int)len, msg);
        exit(1);
    }
    printf("%-28s ->", label);
    for (;;) {
        const uint8_t *key = NULL;
        size_t key_len = 0;
        const corvid_value *doc = NULL;
        float score = 0.0f;
        if (corvid_rows_next(rows, &key, &key_len, &doc, &score) != 1) break;
        printf(" %.*s(%.6f)", (int)key_len, key, (double)score);
    }
    printf("\n");
    corvid_rows_free(rows);
}

int main(void) {
    corvid_db *db = corvid_open_memory();
    if (!db) { fprintf(stderr, "text_search: open failed\n"); return 1; }
    corvid_coll *notes = corvid_collection(db, "notes", 5);
    if (!notes) { fprintf(stderr, "text_search: collection failed\n"); return 1; }

    put_note(notes, "n1", "the quick brown fox jumps over the lazy dog");
    put_note(notes, "n2", "a quick red fox leaps over a sleeping dog");
    put_note(notes, "n3", "slow green turtle crosses the road");
    put_note(notes, "n4", "东京是一座巨大的城市");   /* Tokyo is a huge city */
    put_note(notes, "n5", "大阪是关西最大的城市");   /* Osaka is Kansai's biggest city */
    put_note(notes, "n6", "机器学习正在改变数据库"); /* ML is changing databases */

    must("create_text_index", corvid_create_text_index(notes, "body", 4));

    search(notes, "quick fox", "bm25 \"quick fox\":");
    search(notes, "quick dog", "bm25 \"quick dog\":");
    search(notes, "城市", "bm25 CJK 城市 (city):");
    search(notes, "数据库", "bm25 CJK 数据库 (database):");

    phrase(notes, "fox jumps over", "phrase \"fox jumps over\":");
    phrase(notes, "over jumps fox", "phrase reversed (no match):");
    phrase(notes, "leaps over a sleeping", "phrase stop words collapsed:");

    corvid_collection_free(notes);
    must("close", corvid_close(db));
    return 0;
}
```

<!-- corvid-examples:text_search END -->
### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```c
/* Print one `[a,b,c]` line from a key-set cursor (borrowed views),
 * naming the last error if the call failed. */
static void print_strs(const char *label, corvid_strs *s) {
    if (!s) {
        size_t len = 0;
        const char *msg = corvid_last_error_message(&len);
        fprintf(stderr, "graph: %s failed: %.*s\n", label, (int)len, msg);
        exit(1);
    }
    printf("%-36s [", label);
    for (;;) {
        const char *str = NULL;
        size_t len = 0;
        if (corvid_strs_next(s, &str, &len) != 1) break;
        printf("%.*s ", (int)len, str);
    }
    printf("]\n");
    corvid_strs_free(s);
}

int main(void) {
    corvid_db *db = corvid_open_memory();
    if (!db) { fprintf(stderr, "graph: open failed\n"); return 1; }
    corvid_coll *nodes = corvid_collection(db, "nodes", 5);
    if (!nodes) { fprintf(stderr, "graph: collection failed\n"); return 1; }

    static const char *keys[3] = {"ga", "gb", "gc"};
    for (int i = 0; i < 3; i++) {
        corvid_value *doc = corvid_value_map_new();
        must("map_put n", corvid_value_map_put(
            doc, "n", 1, corvid_value_text(keys[i], strlen(keys[i]))));
        must("insert",
             corvid_insert(nodes, (const uint8_t *)keys[i], strlen(keys[i]), doc));
        corvid_value_free(doc);
    }

    must("link ga->gb", corvid_link(nodes, (const uint8_t *)"ga", 2, "parent_of",
                                    9, (const uint8_t *)"gb", 2));
    must("link ga->gc", corvid_link(nodes, (const uint8_t *)"ga", 2, "parent_of",
                                    9, (const uint8_t *)"gc", 2));
    /* gb -> gd: gd never exists as a document; the edge dangles fine. */
    must("link gb->gd", corvid_link(nodes, (const uint8_t *)"gb", 2, "parent_of",
                                    9, (const uint8_t *)"gd", 2));
    must("link_weighted ga->gb",
         corvid_link_weighted(nodes, (const uint8_t *)"ga", 2, "route", 5,
                              (const uint8_t *)"gb", 2, 2.5));
    must("link_weighted ga->gd",
         corvid_link_weighted(nodes, (const uint8_t *)"ga", 2, "route", 5,
                              (const uint8_t *)"gd", 2, 0.75));

    print_strs("neighbors(ga)",
              corvid_neighbors(nodes, (const uint8_t *)"ga", 2,
                                                "parent_of", 9));
    print_strs("in_neighbors(gb)",
              corvid_in_neighbors(nodes, (const uint8_t *)"gb", 2, "parent_of", 9));

    corvid_geohits *routes = corvid_neighbors_weighted(
        nodes, (const uint8_t *)"ga", 2, "route", 5);
    if (!routes) { fprintf(stderr, "graph: neighbors_weighted failed\n"); return 1; }
    printf("%-34s [", "routes from ga (weighted):");
    for (;;) {
        corvid_geohit hit;
        const corvid_value *doc = NULL;
        if (corvid_geohits_next(routes, &hit, &doc) != 1) break;
        printf("%.*s=%.2f ", (int)hit.key_len, hit.key, hit.distance_km);
    }
    printf("]\n");
    corvid_geohits_free(routes);

    print_strs("traverse(ga, 1 hop)",
              corvid_traverse(nodes, (const uint8_t *)"ga", 2, "parent_of", 9, 1));
    print_strs("traverse(ga, 2 hops)",
              corvid_traverse(nodes, (const uint8_t *)"ga", 2, "parent_of", 9, 2));

    /* Delete cascade: remove gc (a document) and gd (never a document). */
    int32_t existed = 0;
    must("delete gc", corvid_delete(nodes, (const uint8_t *)"gc", 2, &existed));
    printf("delete gc: existed=%d\n", existed);
    must("delete gd", corvid_delete(nodes, (const uint8_t *)"gd", 2, &existed));
    printf("delete gd: existed=%d (never a document; its edges still cascade)\n",
           existed);

    print_strs("neighbors(ga) after deletes",
              corvid_neighbors(nodes, (const uint8_t *)"ga", 2, "parent_of", 9));
    print_strs("neighbors(gb) after deletes",
              corvid_neighbors(nodes, (const uint8_t *)"gb", 2, "parent_of", 9));
    print_strs("traverse(ga, 2 hops) after",
              corvid_traverse(nodes, (const uint8_t *)"ga", 2, "parent_of", 9, 2));

    corvid_collection_free(nodes);
    must("close", corvid_close(db));
    return 0;
}
```

<!-- corvid-examples:graph END -->
### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```c
static void put_place(corvid_coll *places, const char *key, double lat,
                      double lon) {
    corvid_value *doc = corvid_value_map_new();
    must("map_put name", corvid_value_map_put(
        doc, "name", 4, corvid_value_text(key, strlen(key))));
    /* map_put / array_push CONSUME the child value (spec §5/§8) — the
     * [lat, lon] point in the engine's array encoding. */
    corvid_value *loc = corvid_value_array_new();
    must("array_push lat", corvid_value_array_push(loc, corvid_value_float(lat)));
    must("array_push lon", corvid_value_array_push(loc, corvid_value_float(lon)));
    must("map_put loc", corvid_value_map_put(doc, "loc", 3, loc));
    must("insert",
         corvid_insert(places, (const uint8_t *)key, strlen(key), doc));
    corvid_value_free(doc); /* insert CLONES the value; ours is still ours */
}

static void print_geohits(const char *label, corvid_geohits *h) {
    printf("%-34s [", label);
    for (;;) {
        corvid_geohit hit;
        const corvid_value *doc = NULL;
        if (corvid_geohits_next(h, &hit, &doc) != 1) break;
        printf("%.*s %.6fkm ", (int)hit.key_len, hit.key, hit.distance_km);
    }
    printf("]\n");
    corvid_geohits_free(h);
}

int main(void) {
    corvid_db *db = corvid_open_memory();
    if (!db) { fprintf(stderr, "geo: open failed\n"); return 1; }
    corvid_coll *places = corvid_collection(db, "places", 6);
    if (!places) { fprintf(stderr, "geo: collection failed\n"); return 1; }

    put_place(places, "berlin", 52.52, 13.40);
    put_place(places, "potsdam", 52.40, 13.06);
    put_place(places, "hamburg", 53.55, 9.99);
    put_place(places, "munchen", 48.14, 11.58);

    must("create_geo_index", corvid_create_geo_index(places, "loc", 3));

    corvid_geohits *hits = corvid_geo_within_radius(places, "loc", 3,
                                                    52.52, 13.40, 600.0);
    if (!hits) { fprintf(stderr, "geo: radius failed\n"); return 1; }
    print_geohits("within 600km of Berlin:", hits);

    hits = corvid_geo_within_bbox(places, "loc", 3, 47, 5, 55, 15);
    if (!hits) { fprintf(stderr, "geo: bbox failed\n"); return 1; }
    print_geohits("bbox 47..55N, 5..15E:", hits);

    hits = corvid_geo_nearest(places, "loc", 3, 52.52, 13.40, 2);
    if (!hits) { fprintf(stderr, "geo: nearest failed\n"); return 1; }
    print_geohits("nearest 2 to Berlin:", hits);

    corvid_collection_free(places);
    must("close", corvid_close(db));
    return 0;
}
```

<!-- corvid-examples:geo END -->





The fused scores are RRF rank sums: `s1` is rank 1 of both sources
(1/61 + 1/61 = 2/61 ≈ 0.032787), `s3` rank 2 of both (2/62 ≈ 0.032258).

Every construct maps to the [ABI function pages](/ffi/functions-lifecycle/);
the ownership flow (cloned document inputs, consumed query and predicate,
borrowed row views) follows the [transfer rules](/ffi/ownership/).

## API at a glance

Generated from the binding's `docs/SURFACE.tsv` (every engine
construct at the pinned tag mapped or N/A with a reason) — regenerated
by the docs sync, so it cannot drift.

<!-- corvid-api-glance BEGIN -->

| API group | engine constructs | proven by |
|---|---|---|
| `corvid_value_* constructors + corvid_value_type` | 10 | golden:values.txt:VTYPE |
| `corvid_value_array_get / corvid_value_map_get` | 2 | golden:values.txt:VNEST |
| `corvid_value_as_bool/int/float, corvid_value_text/bytes/vector_ref` | 6 | golden:values.txt:VAS_*/V*_REF |
| `CORVID_CMP_EQ..GE` | 7 | golden:queries.txt:QF_* |
| `corvid_pred_* constructor family` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN |
| `corvid_metric_t / CORVID_METRIC_*` | 4 | golden:queries.txt:QVEC |
| `corvid_quant_t / CORVID_QUANT_*` | 4 | golden:schema.txt:IDX_VEC_Q |
| `CORVID_ERR + corvid_last_error_code/message` | 1 | golden:mutations.txt:INSERT_ERR |
| `corvid_err enum (corvid_last_error_code)` | 1 | errcodes |
| `CORVID_E_* (corvid_err enum, code 1)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 2)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 3)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 4)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 5)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 6)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 7)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 8)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 9)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 10)` | 1 | errcodes (frozen-table _Static_assert test); golden:mutations.txt:INSERT_ERR(err:10) |
| `CORVID_E_* (corvid_err enum, code 11)` | 1 | errcodes (frozen-table _Static_assert test); golden:mutations.txt:INSERT_ERR(err:11) |
| `CORVID_E_* (corvid_err enum, code 12)` | 1 | errcodes (frozen-table _Static_assert test); golden:mutations.txt:UPDATE_ABORT(err:12) |
| `CORVID_E_* (corvid_err enum, code 13)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 14)` | 1 | errcodes (frozen-table _Static_assert test); golden:schema.txt:IDX_PQ_ERR(err:14) |
| `CORVID_E_* (corvid_err enum, code 15)` | 1 | errcodes (frozen-table _Static_assert test); golden:schema.txt:SCHEMA_ERR(err:15) |
| `CORVID_E_* (corvid_err enum, code 16)` | 1 | errcodes (frozen-table _Static_assert test) |
| `CORVID_E_* (corvid_err enum, code 17)` | 1 | errcodes (frozen-table _Static_assert test); golden:admin.txt:BACKUP_DUP(err:17) |
| `CORVID_E_* (corvid_err enum, code 18)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid_rows_next cursor` | 1 | golden:queries.txt |
| `corvid_query_new` | 2 | golden:queries.txt |
| `corvid_query_filter` | 1 | golden:queries.txt:QF_COUNT |
| `corvid_query_vector` | 1 | golden:queries.txt:QVEC |
| `corvid_query_text` | 1 | golden:queries.txt:QTEXT |
| `corvid_query_fuse_rrf` | 1 | golden:queries.txt:HYBRID_F |
| `corvid_query_rerank_mmr` | 1 | golden:queries.txt:HYBRID |
| `corvid_query_limit` | 1 | golden:queries.txt:ORDER_BY |
| `corvid_query_offset` | 1 | golden:queries.txt:ORDER_BY |
| `corvid_query_order_by` | 1 | golden:queries.txt:ORDER_BY |
| `corvid_query_approx` | 1 | golden:queries.txt:APPROX |
| `corvid_query_select` | 1 | golden:queries.txt:SELECT |
| `corvid_query_count` | 1 | golden:queries.txt:AGG_COUNT |
| `corvid_query_group_count` | 1 | golden:queries.txt:AGG_GCOUNT |
| `corvid_query_sum` | 1 | golden:queries.txt:AGG_SUM |
| `corvid_query_avg` | 1 | golden:queries.txt:AGG_AVG |
| `corvid_query_min` | 1 | golden:queries.txt:AGG_MIN |
| `corvid_query_max` | 1 | golden:queries.txt:AGG_MAX |
| `corvid_query_count_distinct` | 1 | golden:queries.txt:AGG_DISTINCT |
| `corvid_query_group_sum` | 1 | golden:queries.txt:AGG_GSUM |
| `corvid_query_group_avg` | 1 | golden:queries.txt:AGG_GAVG |
| `corvid_query_run` | 1 | golden:queries.txt:QVEC |
| `corvid_open/corvid_open_memory handle` | 1 | golden:admin.txt:FILEDB |
| `corvid_open/corvid_open_memory/corvid_collection/corvid_collections/corvid_backup/corvid_compact` | 6 | golden:admin.txt (COLLECTIONS/BACKUP/COMPACT) |
| `corvid_collection handle family` | 1 | golden:mutations.txt:COLL |
| `corvid_insert/corvid_update/corvid_patch/corvid_compare_and_set` | 4 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `corvid_scan callback + stop` | 1 | golden:mutations.txt:SCAN/SCAN_STOP |
| `corvid_len (== 0 for empty)` | 2 | golden:mutations.txt:LEN |
| `corvid_put_many` | 1 | golden:mutations.txt:PUTMANY + golden:schema.txt:PUTMANY_ROLLBACK |
| `corvid_insert_auto` | 1 | golden:mutations.txt:INSERT_AUTO |
| `corvid_get` | 1 | golden:mutations.txt:GET |
| `corvid_delete/corvid_delete_where/corvid_delete_batch` | 3 | golden:mutations.txt (DELETE/DELETE_WHERE/DELETE_BATCH) |
| `corvid_scan (full walk)` | 1 | golden:mutations.txt:SCAN |
| `corvid_page` | 2 | golden:mutations.txt:PAGE |
| `row score from corvid_rows_next` | 2 | golden:queries.txt:QVEC; golden:queries.txt:QTEXT |
| `corvid_phrase_search (the v0.3.0 direct positional fn) over the rows cursor` | 1 | golden:queries.txt:PHRASE |
| `corvid_query_fuse_rrf default k=60` | 1 | golden:queries.txt:HYBRID |
| `corvid_geohits_next cursor` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `corvid_geo_within_radius/corvid_geo_nearest/corvid_geo_within_bbox/corvid_create_geo_index` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `corvid_link/corvid_link_weighted/corvid_unlink/corvid_neighbors/corvid_in_neighbors/corvid_neighbors_weighted/corvid_traverse` | 7 | golden:graph.txt |
| `corvid_create_{scalar,compound,text,text_ondisk,geo,vector,vector_quantized,vector_ondisk,vector_ondisk_quantized,vector_pq,vector_ondisk_pq}_index` | 10 | golden:schema.txt:IDX_* |
| `corvid_field_type_t / CORVID_FTYPE_*` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `corvid_set_schema/corvid_schema + schemaiter` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `corvid_insert_with_ttl/corvid_set_ttl/corvid_get_ttl/corvid_purge_expired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `corvid_dump_to_path/corvid_load_from_path/corvid_load_from_path_with_renames` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) |

151 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

The API *is* the ABI: [corvid.h](https://github.com/corvid-db/corvid/blob/master/crates/corvid-ffi/corvid.h) in the engine repo, documented symbol-by-symbol in the [C ABI reference](/ffi/overview/) here.


## Installing (system use)

`cmake --install build` installs `corvid.h`, the library, and a `corvid.pc`
pkg-config file:

```sh
pkg-config --cflags --libs corvid
```

## Versioning

The engine pin lives in one variable in the fetch scripts
(`CORVID_VERSION=v0.4.1`). Artifacts are always taken from that exact tag's
GitHub release and sha256-verified; `deps/` is never committed.

## The macOS note (a bindings-program war story)

The v0.2.0 darwin dylibs shipped with the release CI runner's absolute path
as their install name, so binaries linked against them aborted at launch.
corvid-c caught this (finding F1 in its plan); the engine fixed its release
pipeline; **every pin since v0.2.1 — the current is v0.4.1 — is clean**:
`otool -D` shows
`@rpath/libcorvid.dylib`, and the golden suite runs 267/267 with no
workarounds. v0.2.1's Linux `.so` also gained its SONAME (finding F2,
likewise resolved). This is the reference-consumer role working as designed.

Next: [corvid-node](/bindings/corvid-node/).
