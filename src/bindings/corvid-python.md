---
title: corvid-python
description: The corvid-python binding — install (pending first PyPI release), Db/Collection/Query/field OOP with context-manager lifetimes, the Python value mapping, the quickstart and hybrid examples, and the golden-suite correctness story.
sidebar:
 order: 3
---

[`corvid-python`](https://github.com/corvid-db/corvid-python) is the Python
binding: the engine compiled in (a Rust pyo3 crate pinned to an exact corvid
release tag), exposed as idiomatic **synchronous OOP** — `Db`,
`Collection`, a fluent `Query` builder, and `field()` predicates. No SQL,
no JSON, no serialization on the data path; values map natively
(`array('f')` is the vector type; floats round-trip with f64 bits
preserved exactly — no JS-style NaN caveats).

**When to choose this binding:** your workload lives in Python — data
pipelines, notebooks, model-serving sidecars, scripts — and you want an
embedded vector + text + graph + geo store with zero servers and zero
serialization. Handles are context managers (`with Db(...) as db:`),
cursors are Python iterables, and every failure raises a typed
`CorvidError` carrying the engine's frozen error `code`. For other
languages see the [bindings overview](/bindings/overview/).

## Install

**Pending first publish** — the package is not on PyPI yet; everything is
prepared (maturin wheel config, one abi3 wheel per platform), and
publishing waits on the first release tag. Until then build from source —
Python ≥ 3.11, Rust ≥ 1.88, and a C toolchain:

```sh
pip install maturin
maturin develop --release    # into the active venv
```

The wheel is abi3 (cp311), so one wheel per platform covers every
Python ≥ 3.11. Planned platform matrix: `linux-x64` / `linux-arm64` /
`macos-arm64` / `windows-x64`.

## The examples

Six runnable programs in the repo's `examples/` directory, executed on
every CI leg with deterministic output: **quickstart**, **hybrid** (the
flagship below), **vector-index** (in-memory / on-disk / binary-quantized
HNSW vs the exact scan), **text-search** (BM25 incl. CJK bigram
segmentation, plus the v0.3.0 direct `phrase_search()`), **graph**
(neighbors/traverse + delete cascade), and
**geo** (radius / bbox / nearest). The quickstart and hybrid sources are
embedded below — imported from the repo so they cannot drift from what CI
executes (`scripts/sync-binding-examples.sh`; the drift gate reddens docs
CI if they diverge). Run them from a checkout with
`maturin develop && python examples/hybrid.py`.

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```python
from array import array

from corvid import Db

with Db.open_memory() as db:
    docs = db.collection("docs")

    docs.insert("p1", {"title": "rust embedded database", "kind": "doc",
                       "v": array("f", [1.0, 0.0])})
    docs.insert("p2", {"title": "python web frameworks", "kind": "doc",
                       "v": array("f", [0.0, 1.0])})
    docs.insert("p3", {"title": "rust again database", "kind": "doc",
                       "v": array("f", [0.9, 0.1])})

    # kNN: the 3 nearest documents to (1, 0) under cosine.
    rows = (
        docs.query()
        .vector("v", array("f", [1.0, 0.0]), 3, "cosine")
        .run()
    )  # [Row(key, score, document), ...]

    for rank, row in enumerate(rows, start=1):
        print(f"{rank}. {row.key} score={row.score:.6f} "
              f"{row.document['title']}")

    docs.close()
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```python
from array import array

from corvid import Db, field

with Db.open_memory() as db:
    docs = db.collection("docs")

    docs.insert("s1", {"kind": "doc", "body": "rust embedded database",
                       "v": array("f", [1.0, 0.0])})
    docs.insert("s2", {"kind": "doc", "body": "python web frameworks",
                       "v": array("f", [0.0, 1.0])})
    docs.insert("s3", {"kind": "doc", "body": "rust again database",
                       "v": array("f", [0.9, 0.1])})
    docs.insert("m1", {"kind": "meta"})  # filtered out below

    # The flagship query: filter + vector + text, RRF + MMR + limit.
    rows = (
        docs.query()
        .filter(field("kind").eq("doc"))
        .vector("v", array("f", [1.0, 0.0]), 2, "cosine")
        .text("body", "rust database", 2)
        .fuse_rrf(60)
        .rerank_mmr(1.0)
        .limit(2)
        .run()
    )  # [Row(key, score, document), ...]

    for rank, row in enumerate(rows, start=1):
        print(f"{rank}. {row.key} score={row.score:.6f} "
              f"{row.document['body']}")

    docs.close()
```

<!-- corvid-examples:hybrid END -->
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```python
import os
import tempfile
from array import array

from corvid import Db

CORPUS = [
    ("k0", [1.0, 0.0, 0.0, 0.0]),  # nearest
    ("k1", [0.95, 0.05, 0.0, 0.0]),
    ("k2", [0.0, 1.0, 0.0, 0.0]),
    ("k3", [0.0, 0.9, 0.1, 0.0]),
    ("k4", [0.0, 0.0, 1.0, 0.0]),
    ("k5", [0.7, 0.7, 0.0, 0.0]),
    ("k6", [0.0, 0.0, 0.0, 1.0]),
    ("k7", [0.98, 0.02, 0.0, 0.0]),
]
PROBE = array("f", [1.0, 0.0, 0.0, 0.0])


def run_query(items, field_name, approx, label):
    q = items.query().vector(field_name, PROBE, 4, "cosine")
    if approx:
        q = q.approx()
    rows = q.run()
    hits = " ".join(f"{r.key}({r.score:.6f})" for r in rows)
    print(f"{label:<38} {hits}")


with tempfile.TemporaryDirectory() as tmp:
    path = os.path.join(tmp, "vectors.redb")

    with Db.open(path) as db:
        items = db.collection("items")
        for key, v in CORPUS:
            vec = array("f", v)
            items.insert(key, {"v_mem": vec, "v_disk": vec, "v_q": vec})
        items.create_vector_index("v_mem", "cosine")
        items.create_vector_index_ondisk("v_disk", "cosine")
        items.create_vector_index_quantized("v_q", "cosine", "binary")

        print("top-4 nearest to (1,0,0,0) under cosine:")
        run_query(items, "v_mem", False, "exact (scan):")
        run_query(items, "v_mem", True, "ann in-memory HNSW:")
        run_query(items, "v_disk", True, "ann on-disk HNSW:")
        run_query(items, "v_q", True, "ann binary-quantized:")
        print("(the quantized lane trades recall for a ~32x smaller index)")
        items.close()

    # Reopen: the on-disk graph reloads (no rebuild) and answers again.
    with Db.open(path) as db:
        items = db.collection("items")
        run_query(items, "v_disk", True, "ann on-disk after reopen:")
        items.close()
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```python
from corvid import Db

CORPUS = [
    ("n1", "the quick brown fox jumps over the lazy dog"),
    ("n2", "a quick red fox leaps over a sleeping dog"),
    ("n3", "slow green turtle crosses the road"),
    ("n4", "东京是一座巨大的城市"),   # Tokyo is a huge city
    ("n5", "大阪是关西最大的城市"),   # Osaka is Kansai's biggest city
    ("n6", "机器学习正在改变数据库"),  # ML is changing databases
]

with Db.open_memory() as db:
    notes = db.collection("notes")
    for key, body in CORPUS:
        notes.insert(key, {"body": body})
    notes.create_text_index("body")

    def search(query, label):
        rows = notes.query().text("body", query, 3).run()
        hits = " ".join(f"{r.key}({r.score:.6f})" for r in rows)
        print(f"{label:<28} -> {hits}")

    def phrase(query, label):
        rows = notes.phrase_search("body", query, 3)
        hits = " ".join(f"{r.key}({r.score:.6f})" for r in rows)
        print(f"{label:<28} -> {hits}")

    search("quick fox", 'bm25 "quick fox":')
    search("quick dog", 'bm25 "quick dog":')
    search("城市", "bm25 CJK 城市 (city):")
    search("数据库", "bm25 CJK 数据库 (database):")

    phrase("fox jumps over", 'phrase "fox jumps over":')
    phrase("over jumps fox", "phrase reversed (no match):")
    phrase("leaps over a sleeping", "phrase stop words collapsed:")

    notes.close()
```

<!-- corvid-examples:text_search END -->
### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```python
from corvid import Db

with Db.open_memory() as db:
    nodes = db.collection("nodes")
    for key in ("ga", "gb", "gc"):
        nodes.insert(key, {"n": key})

    nodes.link("ga", "parent_of", "gb")
    nodes.link("ga", "parent_of", "gc")
    nodes.link("gb", "parent_of", "gd")  # gd never exists as a document
    nodes.link_weighted("ga", "route", "gb", 2.5)
    nodes.link_weighted("ga", "route", "gd", 0.75)

    def show(label, keys):
        print(f"{label:<36} [{' '.join(keys)}]")

    show("neighbors(ga)", nodes.neighbors("ga", "parent_of"))
    show("in_neighbors(gb)", nodes.in_neighbors("gb", "parent_of"))
    routes = " ".join(f"{k}={w:.2f}" for k, w in nodes.neighbors_weighted("ga", "route"))
    print(f"{'routes from ga (weighted):':<36} [{routes}]")
    show("traverse(ga, 1 hop)", nodes.traverse("ga", "parent_of", 1))
    show("traverse(ga, 2 hops)", nodes.traverse("ga", "parent_of", 2))

    # Delete cascade: remove gc (a document) and gd (never a document).
    print("delete gc: existed=", nodes.delete("gc"))
    print("delete gd: existed=", nodes.delete("gd"),
          "(never a document; its edges still cascade)")

    show("neighbors(ga) after deletes", nodes.neighbors("ga", "parent_of"))
    show("neighbors(gb) after deletes", nodes.neighbors("gb", "parent_of"))
    show("traverse(ga, 2 hops) after", nodes.traverse("ga", "parent_of", 2))

    nodes.close()
```

<!-- corvid-examples:graph END -->
### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```python
from corvid import Db

CITIES = [
    ("berlin", 52.52, 13.40),
    ("potsdam", 52.40, 13.06),
    ("hamburg", 53.55, 9.99),
    ("munchen", 48.14, 11.58),
]

with Db.open_memory() as db:
    places = db.collection("places")
    for name, lat, lon in CITIES:
        places.insert(name, {"name": name, "loc": [lat, lon]})
    places.create_geo_index("loc")

    def show(label, hits):
        inside = " ".join(f"{h.key} {h.distance_km:.6f}km" for h in hits)
        print(f"{label:<34} [{inside}]")

    show("within 600km of Berlin:",
         places.geo_within_radius("loc", 52.52, 13.40, 600.0))
    show("bbox 47..55N, 5..15E:",
         places.geo_within_bbox("loc", 47, 5, 55, 15))
    show("nearest 2 to Berlin:",
         places.geo_nearest("loc", 52.52, 13.40, 2))

    places.close()
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
| `the Python value mapping (None/bool/int/float/str/bytes/array('f')/list/dict)` | 10 | golden:values.txt:VTYPE |
| `FieldRef eq/ne/lt/le/gt/ge` | 7 | golden:queries.txt:QF_* |
| `Predicate via field()/and_()/or_()/not_()` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN; golden:geo.txt:26 QF_GEO (the geo-predicate fixture line); tests/test_value_mapping.py::test_lt_predicate_executes (no fixture line dispatches lt; QF_AND uses ge/le) |
| `Metric type ('cosine' | 'dot' | 'l2')` | 4 | golden:queries.txt:QVEC; golden:queries.txt:QVEC (query) + tests/test_value_mapping.py::test_vector_query_per_metric; golden:schema.txt:31 IDX_VEC_Q (index creation) + tests/test_value_mapping.py::test_vector_query_per_metric (query; QVEC never runs dot); golden:schema.txt:32 IDX_VEC_DISK (index creation) + tests/test_value_mapping.py::test_vector_query_per_metric (query; QVEC never runs l2) |
| `Quantization type ('none' | 'binary' | 'scalar')` | 4 | golden:schema.txt:IDX_VEC_Q |
| `raises CorvidError` | 1 | golden:mutations.txt:INSERT_ERR |
| `CorvidError.code (ErrorCode table)` | 1 | test_error_code_table |
| `ErrorCode.DATABASE (code 1)` | 1 | test_error_code_table |
| `ErrorCode.TRANSACTION (code 2)` | 1 | test_error_code_table |
| `ErrorCode.TABLE (code 3)` | 1 | test_error_code_table |
| `ErrorCode.STORAGE (code 4)` | 1 | test_error_code_table |
| `ErrorCode.COMMIT (code 5)` | 1 | test_error_code_table |
| `ErrorCode.SET_DURABILITY (code 6)` | 1 | test_error_code_table |
| `ErrorCode.COMPACTION (code 7)` | 1 | test_error_code_table |
| `ErrorCode.DECODE (code 8)` | 1 | test_error_code_table |
| `ErrorCode.CORRUPT_INDEX (code 9)` | 1 | test_error_code_table |
| `ErrorCode.RESERVED_COLLECTION (code 10)` | 1 | test_error_code_table; golden:mutations.txt:INSERT_ERR(err:10) |
| `ErrorCode.INVALID_NAME (code 11)` | 1 | test_error_code_table; golden:mutations.txt:INSERT_ERR(err:11) |
| `ErrorCode.INVALID_ARGUMENT (code 12)` | 1 | test_error_code_table; golden:mutations.txt:UPDATE_ABORT(err:12) |
| `ErrorCode.INCOMPATIBLE_FORMAT (code 13)` | 1 | test_error_code_table |
| `ErrorCode.EMPTY_INDEX_TRAINING (code 14)` | 1 | test_error_code_table; golden:schema.txt:IDX_PQ_ERR(err:14) |
| `ErrorCode.SCHEMA_VIOLATION (code 15)` | 1 | test_error_code_table; golden:schema.txt:SCHEMA_ERR(err:15) |
| `ErrorCode.INVALID_DUMP (code 16)` | 1 | test_error_code_table |
| `ErrorCode.BACKUP_TARGET_EXISTS (code 17)` | 1 | test_error_code_table; golden:admin.txt:BACKUP_DUP(err:17) |
| `ErrorCode.IO (code 18)` | 1 | test_error_code_table |
| `Row { key, score, document }` | 1 | golden:queries.txt |
| `Query (Collection.query())` | 2 | golden:queries.txt |
| `Query.filter` | 1 | golden:queries.txt:QF_COUNT |
| `Query.vector` | 1 | golden:queries.txt:QVEC |
| `Query.text` | 1 | golden:queries.txt:QTEXT |
| `Query.fuse_rrf` | 1 | golden:queries.txt:HYBRID_F |
| `Query.rerank_mmr` | 1 | golden:queries.txt:HYBRID |
| `Query.limit` | 1 | golden:queries.txt:ORDER_BY |
| `Query.offset` | 1 | golden:queries.txt:ORDER_BY |
| `Query.order_by` | 1 | golden:queries.txt:ORDER_BY |
| `Query.approx` | 1 | golden:queries.txt:APPROX |
| `Query.select` | 1 | golden:queries.txt:SELECT |
| `Query.count` | 1 | golden:queries.txt:AGG_COUNT |
| `Query.group_count` | 1 | golden:queries.txt:AGG_GCOUNT |
| `Query.sum` | 1 | golden:queries.txt:AGG_SUM |
| `Query.avg` | 1 | golden:queries.txt:AGG_AVG |
| `Query.min` | 1 | golden:queries.txt:AGG_MIN |
| `Query.max` | 1 | golden:queries.txt:AGG_MAX |
| `Query.count_distinct` | 1 | golden:queries.txt:AGG_DISTINCT |
| `Query.group_sum` | 1 | golden:queries.txt:AGG_GSUM |
| `Query.group_avg` | 1 | golden:queries.txt:AGG_GAVG |
| `Query.run` | 1 | golden:queries.txt:QVEC |
| `Db` | 1 | golden:admin.txt:FILEDB |
| `Db.open/open_memory/collection/collections/backup/compact` | 6 | golden:admin.txt (COLLECTIONS/BACKUP/COMPACT) |
| `Collection` | 1 | golden:mutations.txt:COLL |
| `Collection.insert/update/patch/compare_and_set` | 4 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `Collection.scan_each` | 1 | golden:mutations.txt:SCAN/SCAN_STOP |
| `Collection.__len__ / Collection.is_empty` | 2 | golden:mutations.txt:LEN |
| `Collection.insert_many` | 1 | golden:mutations.txt:PUTMANY + golden:schema.txt:PUTMANY_ROLLBACK |
| `Collection.insert_auto` | 1 | golden:mutations.txt:INSERT_AUTO |
| `Collection.get` | 1 | golden:mutations.txt:GET |
| `Collection.delete/delete_where/delete_batch` | 3 | golden:mutations.txt (DELETE/DELETE_WHERE/DELETE_BATCH) |
| `Collection.scan` | 1 | golden:mutations.txt:SCAN |
| `Collection.page / Page` | 2 | golden:mutations.txt:PAGE |
| `Row.score (Query.vector().run())` | 1 | golden:queries.txt:QVEC |
| `Row.score (Query.text().run())` | 1 | golden:queries.txt:QTEXT |
| `Collection.phrase_search(field, phrase, k) — the direct positional search over the engine method` | 1 | golden:queries.txt:PHRASE |
| `Query.fuse_rrf default k=60` | 1 | golden:queries.txt:HYBRID |
| `GeoHit { key, distance_km, document }` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `Collection.geo_within_radius/geo_nearest/geo_within_bbox/create_geo_index` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `Collection.link/link_weighted/unlink/neighbors/in_neighbors/neighbors_weighted/traverse` | 7 | golden:graph.txt |
| `Collection.create_scalar_index/create_compound_index/create_text_index[/ondisk]/create_geo_index/create_vector_index* (6 variants)` | 10 | golden:schema.txt:IDX_* |
| `FieldType Literal ('any'|'bool'|'int'|'float'|'text'|'bytes'|'vector'|'array'|'map')` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `Collection.set_schema/schema + SchemaField(name, ty, required, unique)` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `Collection.insert_with_ttl/set_ttl/get_ttl/purge_expired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `Db.dump_to_path/load_from_path/load_from_path_with_renames` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) |

159 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

Docstrings ship in the wheel: [pypi.org/project/corvid-python](https://pypi.org/project/corvid-python/) — `help(corvid)` renders the same, offline.


## Value mapping

| Python | engine |
|---|---|
| `None`, `bool`, `str` | Null / Bool / Text |
| `int` | Int (full i64 — out-of-range ints raise code 12) |
| `float` | Float |
| `bytes` / `bytearray` | Bytes |
| `array('f')` | Vector (other typecodes are rejected) |
| `list` / `tuple` | Array |
| `dict` (str keys) | Map |

Reading back: Int → `int` (arbitrary precision — no ±2^53 boundary, unlike
the JS binding's number/BigInt split); Float → `float` with **f64 bits
preserved exactly** — NaN payloads, `-0.0`, and `±inf` all round-trip
bit-exactly. Vector → `array('f')` (f32-exact both directions), Map →
`dict` in the engine's key order. Keys are `str` (UTF-8) or `bytes`.

## Correctness story

The binding replays the engine's **golden suite** — the same 267-line
fixture files the C ABI smoke harness runs — against its public API on every
CI run (`tests/test_golden.py`), then executes the six-example tour. Type
stubs ship in-package (`py.typed`); the plan (architecture ruling, OOP
surface, value contract) lives in the repo.

## Development

```sh
python -m venv .venv && source .venv/bin/activate
pip install maturin pytest
maturin develop               # build the native extension
pytest tests                  # the golden suite (267 fixture lines)
python examples/hybrid.py     # the examples tour
cargo fmt --check             # + cargo clippy --all-targets -- -D warnings
```

Next: [corvid-go](/bindings/corvid-go/).
