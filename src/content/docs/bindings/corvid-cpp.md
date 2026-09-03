---
title: corvid-cpp
description: The corvid-cpp binding — a header-first RAII library over the published C ABI, move-only handles, Value from initializer lists, map_keys and phrase search at engine v0.3.2, exceptions with frozen error codes, the quickstart and hybrid examples, and the golden-suite correctness story.
sidebar:
  order: 6
---

[`corvid-cpp`](https://github.com/corvid-db/corvid-cpp) is the C++20
binding: a **header-first RAII library** over the frozen C ABI (one
public header, `corvid/corvid.hpp`, plus one implementation TU), linking
the **published FFI artifacts** — the platform cdylib, the generated
header, and the golden fixtures — downloaded from a pinned engine
release (v0.3.2) and sha256-verified. No engine checkout, no Rust
toolchain, no dependencies beyond the C++ standard library.

**When to choose this binding:** you are writing modern C++ (C++20
floor; CI runs latest-ish GCC, Clang, and MSVC) and want the engine's
typed documents, vector/text/hybrid search, graph edges, and geo — with
RAII doing the freeing, `std::optional`/`std::span` shaping the reads,
and failures arriving as `corvid::Error` carrying the frozen error
`code()`.

The architecture ruling in one breath: every engine handle becomes a
**move-only class** whose destructor calls the ABI's free family (a
copied handle would double-free; deep copies are explicit via
`Value::clone()`); the fluent `Query` builder mirrors the engine's Rust
builder; and **no raw ABI symbol ever appears in the public header** —
a CI gate (`scripts/idiom-gate.sh`) scans the header to keep it that
way, and `test/raii.cpp` pins move-only-ness at compile time.

## Install

**Pending first packaged release** — build from source meanwhile (a
C++20 compiler, CMake ≥ 3.28, and `curl` + `shasum`/`sha256sum` or
PowerShell):

```sh
git clone https://github.com/corvid-db/corvid-cpp && cd corvid-cpp
./fetch.sh          # download + sha256-verify corvid v0.3.2 into deps/
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

Consume it from your own CMake two ways — `FetchContent` of the repo
(after its `fetch.sh` populates `deps/`; the build is offline-first) or
`find_package` against an installed package:

```cmake
find_package(corvid REQUIRED)
target_link_libraries(my_app PRIVATE corvid::corvid)
```

## The examples

Six runnable programs in the repo's `examples/` directory, executed on
every CI leg with deterministic output (and leak-clean under the
sanitizer leg): **quickstart**, **hybrid** (the flagship below),
**vector-index** (exact scan vs HNSW vs binary-quantized vs on-disk,
plus close/reopen), **text-search** (BM25 incl. CJK and the v0.3.0
phrase API), **graph** (neighbors/traverse + delete cascade), and
**geo** (radius / bbox / nearest in haversine kilometres). The
quickstart and hybrid sources are embedded below — imported from the
repo so they cannot drift from what CI executes
(`scripts/sync-binding-examples.sh`; the drift gate reddens docs CI if
they diverge).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```cpp
void put_doc(corvid::Collection& docs, std::string_view key,
             std::string_view title, std::string_view kind,
             std::span<const float> v) {
    using namespace corvid;
    docs.insert(key, Value::map({{"title", lit::text(title)},
                                 {"kind", lit::text(kind)},
                                 {"v", lit::vec(v)}}));
}

int run() {
    using namespace corvid;
    const float v1[]{1.0f, 0.0f}, v2[]{0.0f, 1.0f}, v3[]{0.9f, 0.1f};

    Db db = Db::open_memory();
    Collection docs = db.collection("docs");

    put_doc(docs, "p1", "rust embedded database", "doc", v1);
    put_doc(docs, "p2", "python web frameworks", "doc", v2);
    put_doc(docs, "p3", "rust again database", "doc", v3);

    // kNN: the 3 nearest documents to (1, 0) under cosine.
    const float probe[]{1.0f, 0.0f};
    Rows rows = docs.query()
                    .vector("v", probe, 3, Metric::Cosine)
                    .run();  // consumes the builder

    int rank = 0;
    for (const Row& r : rows) {
        auto title = r.doc.get("title").as_text();
        std::printf("%d. %.*s score=%.6f %.*s\n", ++rank,
                    static_cast<int>(r.key.size()), r.key.data(),
                    static_cast<double>(r.score),
                    static_cast<int>(title ? title->size() : 1),
                    title ? title->data() : "?");
    }
    return 0;
}
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```cpp
void put_doc(corvid::Collection& docs, std::string_view key,
             std::string_view kind, const char* body, const float* v) {
    using namespace corvid;
    Value doc = Value::map({{"kind", lit::text(kind)}});
    if (body != nullptr) doc.put("body", lit::text(body));
    if (v != nullptr) doc.put("v", lit::vec(std::span<const float>(v, 2)));
    docs.insert(key, doc);
}

int run() {
    using namespace corvid;
    const float v1[]{1.0f, 0.0f}, v2[]{0.0f, 1.0f}, v3[]{0.9f, 0.1f};

    Db db = Db::open_memory();
    Collection docs = db.collection("docs");

    put_doc(docs, "s1", "doc", "rust embedded database", v1);
    put_doc(docs, "s2", "doc", "python web frameworks", v2);
    put_doc(docs, "s3", "doc", "rust again database", v3);
    put_doc(docs, "m1", "meta", nullptr, nullptr);  // filtered out below

    // The flagship query: filter + vector + text, RRF + MMR + limit.
    const float probe[]{1.0f, 0.0f};
    Rows rows = docs.query()
                    .filter(pred::eq("kind", "doc"))
                    .vector("v", probe, 2, Metric::Cosine)
                    .text("body", "rust database", 2)
                    .fuse_rrf(60.0f)
                    .rerank_mmr(1.0f)
                    .limit(2)
                    .run();  // consumes the builder AND the predicate

    int rank = 0;
    for (const Row& r : rows) {
        auto body = r.doc.get("body").as_text();
        std::printf("%d. %.*s score=%.6f %.*s\n", ++rank,
                    static_cast<int>(r.key.size()), r.key.data(),
                    static_cast<double>(r.score),
                    static_cast<int>(body ? body->size() : 1),
                    body ? body->data() : "?");
    }
    return 0;
}
```

<!-- corvid-examples:hybrid END -->
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```cpp
void put_doc(Collection& docs, std::string_view key, float a, float b,
             std::string_view tag) {
    const float v[]{a, b};
    docs.insert(key,
                Value::map({{"v", lit::vec(v)}, {"tag", lit::text(tag)}}));
}

std::string run_vector(Rows rows) {
    std::string out;
    for (const Row& r : rows) {
        if (!out.empty()) out += ",";
        out += std::string(r.key);
    }
    return out;
}

int run() {
    const float probe[]{0.99f, 0.05f};
    Db db = Db::open_memory();
    Collection docs = db.collection("docs");

    put_doc(docs, "a", 1.0f, 0.0f, "alpha");
    put_doc(docs, "b", 0.95f, 0.05f, "beta");
    put_doc(docs, "c", 0.0f, 1.0f, "gamma");
    put_doc(docs, "d", -1.0f, 0.0f, "delta");

    // 1. The exact scan: no index, the query walks every vector.
    std::printf("exact    : %s\n",
                run_vector(docs.query().vector("v", probe, 3).run()).c_str());

    // 2. The in-memory HNSW index: same answer, index-backed.
    docs.create_vector_index("v", Metric::Cosine);
    std::printf("hnsw     : %s\n",
                run_vector(docs.query().vector("v", probe, 3).run()).c_str());

    // 3. Binary-quantized: same family, compressed codes.
    docs.create_vector_index_quantized("v", Metric::Cosine, Quant::Binary);
    std::printf("binary   : %s\n",
                run_vector(docs.query().vector("v", probe, 3).run()).c_str());

    // 4. approx(): the index-first posture — the engine may answer
    //    from the ANN structure directly.
    std::printf("approx   : %s\n", run_vector(docs.query()
                                                  .vector("v", probe, 3)
                                                  .approx()
                                                  .run())
                                       .c_str());

    // 5. The on-disk family + persistence: file db, index, close,
    //    reopen — the index rides along in the file.
    const char* path = "vector-index-tmp.redb";
    {
        Db file = Db::open(path);
        Collection fdocs = file.collection("docs");
        put_doc(fdocs, "a", 1.0f, 0.0f, "alpha");
        put_doc(fdocs, "c", 0.0f, 1.0f, "gamma");
        fdocs.create_vector_index_ondisk("v", Metric::Cosine);
    }  // fdocs freed, file closed — index persisted
    {
        Db file = Db::open(path);
        Collection fdocs = file.collection("docs");
        std::printf("ondisk   : %s\n", run_vector(fdocs.query()
                                                     .vector("v", probe, 2)
                                                     .run())
                                            .c_str());
    }
    std::remove(path);
    return 0;
}
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```cpp
int run() {
    Db db = Db::open_memory();
    Collection docs = db.collection("docs");

    docs.insert("s1", Value::map({{"body", "the rust embedded database story"}}));
    docs.insert("s2", Value::map({{"body", "python web frameworks"}}));
    docs.insert("s3", Value::map({{"body", "rust and database, again rust"}}));
    docs.insert("c1", Value::map({{"body", "嵌入式数据库"}}));
    docs.insert("c2", Value::map({{"body", "网络应用框架"}}));

    docs.create_text_index("body");

    // 1. BM25 via the builder: multi-term OR ranking.
    std::printf("bm25 'rust database':\n");
    for (const Row& r :
         docs.query().text("body", "rust database", 3).run()) {
        auto body = r.doc.get("body").as_text();
        std::printf("  %.*s score=%.6f %.*s\n", static_cast<int>(r.key.size()),
                    r.key.data(), static_cast<double>(r.score),
                    static_cast<int>(body ? body->size() : 1),
                    body ? body->data() : "?");
    }

    // 2. CJK: the analyzer tokenizes Han runs; the same builder ranks.
    std::printf("bm25 '数据库':\n");
    for (const Row& r : docs.query().text("body", "数据库", 2).run()) {
        auto body = r.doc.get("body").as_text();
        std::printf("  %.*s score=%.6f %.*s\n", static_cast<int>(r.key.size()),
                    r.key.data(), static_cast<double>(r.score),
                    static_cast<int>(body ? body->size() : 1),
                    body ? body->data() : "?");
    }

    // 3. The v0.3.0 phrase API: direct positional search — the phrase
    //    must appear as a CONSECUTIVE, IN-ORDER token run. "embedded
    //    database" matches s1; the same words reversed do not; k == 0
    //    is the inert empty cursor.
    std::printf("phrase 'embedded database':\n");
    for (const Row& r : docs.phrase_search("body", "embedded database", 10)) {
        std::printf("  %.*s score=%.6f\n", static_cast<int>(r.key.size()),
                    r.key.data(), static_cast<double>(r.score));
    }
    Rows reversed = docs.phrase_search("body", "database embedded", 10);
    std::printf("phrase 'database embedded': %s\n",
                reversed.next() ? "unexpected hit" : "(no hits — order matters)");
    Rows inert = docs.phrase_search("body", "embedded database", 0);
    std::printf("phrase k=0: %s\n",
                inert.next() ? "unexpected hit" : "(empty cursor, inert)");

    // 4. A CJK phrase, too: consecutive Han tokens.
    std::printf("phrase '嵌入式数据库':\n");
    for (const Row& r : docs.phrase_search("body", "嵌入式数据库", 10)) {
        std::printf("  %.*s score=%.6f\n", static_cast<int>(r.key.size()),
                    r.key.data(), static_cast<double>(r.score));
    }
    return 0;
}
```

<!-- corvid-examples:text_search END -->
### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```cpp
int run() {
    Db db = Db::open_memory();
    Collection docs = db.collection("docs");

    for (const char* key : {"a", "b", "c", "d"})
        docs.insert(key, Value::map({{"name", lit::text(key)}}));

    // Directed, labeled edges.
    docs.link("a", "knows", "b");
    docs.link("b", "knows", "c");
    docs.link("c", "knows", "d");
    docs.link("a", "knows", "c");   // a shortcut edge
    docs.link("d", "knows", "a");   // a cycle

    std::printf("a knows     :");
    for (const auto& n : docs.neighbors("a", "knows").to_vector())
        std::printf(" %s", n.c_str());
    std::printf("\nc in-edges  :");
    for (const auto& n : docs.in_neighbors("c", "knows").to_vector())
        std::printf(" %s", n.c_str());
    std::printf("\n");

    // Transitive traversal to depth 2 (a -> {b, c} -> {c, d}).
    std::printf("traverse(a,2):");
    for (const auto& n : docs.traverse("a", "knows", 2).to_vector())
        std::printf(" %s", n.c_str());
    std::printf("\n");

    // Weighted edges + the weighted-neighbor cursor (distance_km
    // carries the edge weight; no documents ride along).
    docs.link_weighted("a", "rated", "b", 0.9);
    docs.link_weighted("a", "rated", "c", 0.5);
    std::printf("a rated     :");
    for (const GeoHit& h : docs.neighbors_weighted("a", "rated"))
        std::printf(" %.*s=%.1f", static_cast<int>(h.key.size()), h.key.data(),
                    h.distance_km);
    std::printf("\n");

    // The delete cascade: removing c drops its edges on both sides.
    expect(docs.erase("c"), "erase(c) existed");
    std::printf("after erasing c, a knows:");
    for (const auto& n : docs.neighbors("a", "knows").to_vector())
        std::printf(" %s", n.c_str());
    std::printf("\n");

    // unlink removes one specific edge.
    expect(docs.unlink("a", "knows", "b"), "unlink(a->b) removed");
    std::printf("after unlink(a->b), a knows:");
    for (const auto& n : docs.neighbors("a", "knows").to_vector())
        std::printf(" %s", n.c_str());
    std::printf("\n");
    return 0;
}
```

<!-- corvid-examples:graph END -->
### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```cpp
void put_place(Collection& docs, std::string_view key, std::string_view name,
               double lat, double lon) {
    docs.insert(key, Value::map({{"name", lit::text(name)},
                                 {"loc", Value::array({lat, lon})}}));
}

int run() {
    Db db = Db::open_memory();
    Collection docs = db.collection("places");

    // San Francisco Bay Area pins, plus one far away.
    put_place(docs, "sfo", "San Francisco", 37.7749, -122.4194);
    put_place(docs, "oak", "Oakland", 37.8044, -122.2712);
    put_place(docs, "sjc", "San Jose", 37.3382, -121.8863);
    put_place(docs, "nyc", "New York", 40.7128, -74.0060);

    docs.create_geo_index("loc");

    // 1. Radius: everything within 30 km of San Francisco.
    std::printf("within 30km of SF:\n");
    for (const GeoHit& h :
         docs.geo_within_radius("loc", 37.7749, -122.4194, 30.0)) {
        auto name = h.doc.get("name").as_text();
        std::printf("  %.*s %.*s %.2fkm\n", static_cast<int>(h.key.size()),
                    h.key.data(), static_cast<int>(name ? name->size() : 1),
                    name ? name->data() : "?", h.distance_km);
    }

    // 2. Nearest: the two closest pins to the Golden Gate.
    std::printf("2 nearest to the Golden Gate:\n");
    for (const GeoHit& h : docs.geo_nearest("loc", 37.8199, -122.4783, 2)) {
        auto name = h.doc.get("name").as_text();
        std::printf("  %.*s %.*s %.2fkm\n", static_cast<int>(h.key.size()),
                    h.key.data(), static_cast<int>(name ? name->size() : 1),
                    name ? name->data() : "?", h.distance_km);
    }

    // 3. Bbox: the South Bay window catches San Jose only.
    std::printf("bbox (South Bay):\n");
    for (const GeoHit& h :
         docs.geo_within_bbox("loc", 37.0, -122.2, 37.5, -121.5)) {
        auto name = h.doc.get("name").as_text();
        std::printf("  %.*s %.*s\n", static_cast<int>(h.key.size()),
                    h.key.data(), static_cast<int>(name ? name->size() : 1),
                    name ? name->data() : "?");
    }

    // 4. The geo PREDICATE: geo filtering composed into any query —
    //    here combined with a scalar filter through pred::all().
    std::size_t near_count = docs.query()
                                 .filter(pred::geo_within("loc", 37.7749,
                                                          -122.4194, 50.0))
                                 .count();
    std::printf("pred geo_within(50km) count: %zu\n", near_count);
    return 0;
}
```

<!-- corvid-examples:geo END -->





The fused scores are RRF rank sums: `s1` is rank 1 of both sources
(1/61 + 1/61 = 2/61 ≈ 0.032787), `s3` rank 2 of both (2/62 ≈ 0.032258).

## API at a glance

Generated from the binding's `docs/SURFACE.tsv` (every engine
construct at the pinned tag mapped or N/A with a reason) — regenerated
by the docs sync, so it cannot drift.

<!-- corvid-api-glance BEGIN -->

| API group | engine constructs | proven by |
|---|---|---|
| `corvid::Value ctors + Value::map/array + Value::type()` | 10 | golden:values.txt:VTYPE; raii:test_values |
| `corvid::Value::get()/at() (+ corvid::ValueView)` | 1 | golden:values.txt:VNEST; raii:test_values |
| `corvid::Value::get()/at() chains (+ corvid::ValueView)` | 1 | golden:values.txt:VNEST; raii:test_values |
| `corvid::Value/ValueView as_bool/as_int/as_float/as_text/as_bytes/as_vector` | 6 | golden:values.txt:VAS_*/V*_REF; raii:test_values |
| `corvid::Cmp (pred::compare/eq/ne/lt/le/gt/ge)` | 7 | golden:queries.txt:QF_*; raii:test_predicates_and_queries |
| `corvid::pred::* builder family (returns corvid::Predicate)` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN; raii:test_predicates_and_queries |
| `corvid::Metric (Query::vector, Collection::create_vector_index*)` | 4 | golden:queries.txt:QVEC; raii:test_graph_geo_indexes |
| `corvid::Quant (Collection::create_vector_index_quantized*)` | 4 | golden:schema.txt:IDX_VEC_Q; raii:test_graph_geo_indexes |
| `corvid::Error thrown on CORVID_ERR (code + message)` | 1 | golden:mutations.txt:INSERT_ERR; raii:test_exceptions |
| `corvid::Error / corvid::ErrorCode` | 1 | errcodes (compile-time frozen table); raii:test_exceptions |
| `corvid::ErrorCode::Database (code 1, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::Transaction (code 2, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::Table (code 3, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::Storage (code 4, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::Commit (code 5, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::SetDurability (code 6, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::Compaction (code 7, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::Decode (code 8, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::CorruptIndex (code 9, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::ReservedCollection (code 10, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table); golden:mutations.txt:INSERT_ERR(err:10) |
| `corvid::ErrorCode::InvalidName (code 11, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table); golden:mutations.txt:INSERT_ERR(err:11) |
| `corvid::ErrorCode::InvalidArgument (code 12, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table); golden:mutations.txt:UPDATE_ABORT(err:12) |
| `corvid::ErrorCode::IncompatibleFormat (code 13, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::EmptyIndexTraining (code 14, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table); golden:schema.txt:IDX_PQ_ERR(err:14) |
| `corvid::ErrorCode::SchemaViolation (code 15, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table); golden:schema.txt:SCHEMA_ERR(err:15) |
| `corvid::ErrorCode::InvalidDump (code 16, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::ErrorCode::BackupTargetExists (code 17, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table); golden:admin.txt:BACKUP_DUP(err:17) |
| `corvid::ErrorCode::Io (code 18, thrown as corvid::Error)` | 1 | errcodes (compile-time frozen table) |
| `corvid::Row (corvid::Rows range)` | 1 | golden:queries.txt; raii:test_predicates_and_queries |
| `corvid::Query (Collection::query(), fluent chaining)` | 1 | golden:queries.txt; raii:test_predicates_and_queries |
| `Collection::query() -> corvid::Query` | 1 | golden:queries.txt; raii:test_predicates_and_queries |
| `Query::filter(Predicate)` | 1 | golden:queries.txt:QF_COUNT; raii:test_predicates_and_queries |
| `Query::vector(field, probe, k, Metric)` | 1 | golden:queries.txt:QVEC; example:vector_index |
| `Query::text(field, query, k)` | 1 | golden:queries.txt:QTEXT; example:text_search |
| `Query::fuse_rrf(k=60)` | 1 | golden:queries.txt:HYBRID_F; example:hybrid |
| `Query::rerank_mmr(lambda)` | 1 | golden:queries.txt:HYBRID; example:hybrid |
| `Query::limit(n)` | 1 | golden:queries.txt:ORDER_BY; example:hybrid |
| `Query::offset(n)` | 1 | golden:queries.txt:ORDER_BY; raii:test_predicates_and_queries |
| `Query::order_by(field, descending)` | 1 | golden:queries.txt:ORDER_BY; raii:test_predicates_and_queries |
| `Query::approx()` | 1 | golden:queries.txt:APPROX; example:vector_index |
| `Query::select(fields)` | 1 | golden:queries.txt:SELECT; raii:test_predicates_and_queries |
| `Query::count()` | 1 | golden:queries.txt:AGG_COUNT; raii:test_predicates_and_queries |
| `Query::group_count(field) -> GroupIter` | 1 | golden:queries.txt:AGG_GCOUNT; raii:test_predicates_and_queries |
| `Query::sum(field)` | 1 | golden:queries.txt:AGG_SUM; raii:test_predicates_and_queries |
| `Query::avg(field)` | 1 | golden:queries.txt:AGG_AVG; raii:test_predicates_and_queries |
| `Query::min(field)` | 1 | golden:queries.txt:AGG_MIN; raii:test_predicates_and_queries |
| `Query::max(field)` | 1 | golden:queries.txt:AGG_MAX; raii:test_predicates_and_queries |
| `Query::count_distinct(field)` | 1 | golden:queries.txt:AGG_DISTINCT; raii:test_predicates_and_queries |
| `Query::group_sum(key, value) -> GroupIter` | 1 | golden:queries.txt:AGG_GSUM; raii:test_predicates_and_queries |
| `Query::group_avg(key, value) -> GroupIter` | 1 | golden:queries.txt:AGG_GAVG |
| `Query::run() -> Rows` | 1 | golden:queries.txt:QVEC; example:quickstart |
| `corvid::Db (RAII; Db::open / Db::open_memory)` | 1 | golden:admin.txt:FILEDB; raii:test_persistence |
| `Db::open/open_memory/collection/collections/backup/compact` | 6 | golden:admin.txt (COLLECTIONS/BACKUP/COMPACT); raii:test_persistence |
| `corvid::Collection (RAII handle, Db::collection())` | 1 | golden:mutations.txt:COLL; raii:test_mutations_and_reads |
| `Collection::insert/update/patch/compare_and_set` | 4 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS); raii:test_mutations_and_reads |
| `Collection::scan(fn) with early stop` | 1 | golden:mutations.txt:SCAN/SCAN_STOP; raii:test_mutations_and_reads |
| `Collection::len() (== 0 for empty)` | 1 | golden:mutations.txt:LEN; raii:test_mutations_and_reads |
| `Collection::len() == 0` | 1 | golden:mutations.txt:LEN; raii:test_mutations_and_reads |
| `Collection::put_many(items)` | 1 | golden:mutations.txt:PUTMANY + golden:schema.txt:PUTMANY_ROLLBACK; raii:test_mutations_and_reads |
| `Collection::insert_auto(doc) -> key` | 1 | golden:mutations.txt:INSERT_AUTO; raii:test_mutations_and_reads |
| `Collection::get(key) -> optional<Value>` | 1 | golden:mutations.txt:GET/GET_KEYS; raii:test_mutations_and_reads |
| `Collection::erase/erase_where/erase_batch` | 3 | golden:mutations.txt (DELETE/DELETE_WHERE/DELETE_BATCH); raii:test_mutations_and_reads |
| `Collection::scan(fn)` | 1 | golden:mutations.txt:SCAN; raii:test_mutations_and_reads |
| `Collection::page(after, limit) -> Page` | 1 | golden:mutations.txt:PAGE; raii:test_mutations_and_reads |
| `corvid::Page (rows + next cursor)` | 1 | golden:mutations.txt:PAGE; raii:test_mutations_and_reads |
| `corvid::Row::score` | 2 | golden:queries.txt:QVEC; example:quickstart; golden:queries.txt:QTEXT + PHRASE; example:text_search |
| `Collection::phrase_search(field, phrase, k) -> Rows` | 1 | golden:queries.txt:PHRASE/PHRASE_K0; raii:test_phrase_search; example:text_search |
| `Query::fuse_rrf default k = 60.0f` | 1 | golden:queries.txt:HYBRID; example:hybrid |
| `corvid::GeoHit (key + distance_km + doc)` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX; example:geo |
| `Collection::geo_within_radius/geo_nearest/geo_within_bbox/create_geo_index` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO); example:geo |
| `Collection::link/link_weighted/unlink/neighbors/in_neighbors/neighbors_weighted/traverse` | 7 | golden:graph.txt; example:graph |
| `Collection::create_scalar/compound/text/text_ondisk/geo/vector/vector_quantized/vector_ondisk/vector_ondisk_quantized/vector_pq/vector_ondisk_pq _index` | 10 | golden:schema.txt:IDX_*; raii:test_graph_geo_indexes; example:vector_index |
| `corvid::FieldType (FieldDef/Field)` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA9; raii:test_graph_geo_indexes |
| `Collection::set_schema(span<FieldDef>) / schema() -> vector<Field>` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR; raii:test_graph_geo_indexes |
| `Collection::insert_with_ttl/set_ttl/ttl/purge_expired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE); raii:test_mutations_and_reads |
| `Db::dump_to/load_from/load_from_with_renames` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) + golden:persist.txt; raii:test_persistence |

151 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

Header-first: the [corvid/ headers](https://github.com/corvid-db/corvid-cpp/tree/master/include/corvid) in the repo are the reference — RAII classes, documented in place.


## What the RAII layer adds over the C ABI

- **Values from literals**: `Value::map({{"title", lit::text("…")}, {"v", lit::vec(span)}})`
  and `Value::array({1, 2.5, "x"})` — a copyable `Lit` borrows its
  bytes for the full expression; nested composites borrow an owned
  `Value` (cloned at materialization).
- **Borrowed reads**: map/array children and row documents surface as
  the read-only `ValueView`; typed accessors return `std::optional`
  and `std::span`.
- **Map keys** (the v0.3.0 additive symbol): `Value::map_keys()` —
  owned keys in ascending key-byte order (the engine's BTreeMap order).
- **Phrase search** (the other v0.3.0 symbol):
  `docs.phrase_search("body", "embedded database", 10)` — direct
  positional search, consecutive and in order, BM25 phrase scores.
- **Errors**: every failing call throws `corvid::Error` with the frozen
  `code()` (mirroring the ABI's error enum 1:1 — pinned at compile time
  on both sides by `test/errcodes.cpp`).
- **Callbacks**: `scan` and `update` take `std::function`; exceptions
  thrown inside a callback cross the C frame safely and rethrow.

## The correctness floor

Every binding replays the engine's golden fixtures; corvid-cpp ports
the C harness itself to C++ (`test/golden.cpp`) and drives the
**downloaded** cdylib over the release's fixtures — 267 executable
lines at v0.3.2 (byte-identical with v0.3.0's — unchanged through v0.3.2), including the additive
map-keys and phrase ops. If the
published `.so`/`.dylib`/`.dll`, header, or fixtures disagree, that CI
leg reddens where the engine's own suite stayed green. On top of the
golden port, `test/raii.cpp` exercises the wrapper's own surface (145
checks), and `docs/SURFACE.tsv` resolves all 327 engine constructs
(180 mapped / 147 N/A-with-reason) against a CI gate.

Next: the [C ABI reference](/ffi/overview/) underneath every binding.
