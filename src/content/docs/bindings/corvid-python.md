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

The fused scores are RRF rank sums: `s1` is rank 1 of both sources
(1/61 + 1/61 = 2/61 ≈ 0.032787), `s3` rank 2 of both (2/62 ≈ 0.032258).

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
