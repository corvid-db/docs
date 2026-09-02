---
title: corvid-cpp
description: The corvid-cpp binding — a header-first RAII library over the published C ABI, move-only handles, Value from initializer lists, map_keys and phrase search at engine v0.3.1, exceptions with frozen error codes, the quickstart and hybrid examples, and the golden-suite correctness story.
sidebar:
  order: 6
---

[`corvid-cpp`](https://github.com/corvid-db/corvid-cpp) is the C++20
binding: a **header-first RAII library** over the frozen C ABI (one
public header, `corvid/corvid.hpp`, plus one implementation TU), linking
the **published FFI artifacts** — the platform cdylib, the generated
header, and the golden fixtures — downloaded from a pinned engine
release (v0.3.1) and sha256-verified. No engine checkout, no Rust
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
./fetch.sh          # download + sha256-verify corvid v0.3.1 into deps/
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

The fused scores are RRF rank sums: `s1` is rank 1 of both sources
(1/61 + 1/61 = 2/61 ≈ 0.032787), `s3` rank 2 of both (2/62 ≈ 0.032258).

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
lines at v0.3.1 (byte-identical with v0.3.0's), including the additive
map-keys and phrase ops. If the
published `.so`/`.dylib`/`.dll`, header, or fixtures disagree, that CI
leg reddens where the engine's own suite stayed green. On top of the
golden port, `test/raii.cpp` exercises the wrapper's own surface (145
checks), and `docs/SURFACE.tsv` resolves all 327 engine constructs
(180 mapped / 147 N/A-with-reason) against a CI gate.

Next: the [C ABI reference](/ffi/overview/) underneath every binding.
