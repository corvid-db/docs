---
title: corvid-go
description: The corvid-go binding — cgo over the published FFI artifacts, Db/Collection/Query with Go errors, the Go value mapping and the v0.3.0 map-key collapse, the quickstart and hybrid examples, and the golden-suite correctness story.
sidebar:
 order: 4
---

[`corvid-go`](https://github.com/corvid-db/corvid-go) is the Go binding:
it links the engine's **published FFI artifacts** (the platform cdylib and
`corvid.h`) over **cgo** and carries an idiomatic Go API on top — `Db`,
`Collection`, a fluent `Query` builder, and `Field(...)` predicates.
Deliberately different from the node/python bindings (Rust-source builds):
Go users expect a system/shared library, not a Rust toolchain — `make deps`
fetches and sha256-verifies the pinned release archive, and the requirement
stops at "a C compiler", which cgo already needs.

**When to choose this binding:** your service is written in Go and you want
corvid embedded without CGO-free purism getting in the way — errors are Go
errors (`*corvid.CorvidError`, never panics), `Db` and `Collection` are
safe for concurrent use, and the engine loads as a shared library your
binary links at runtime.

## Install

From the pinned release artifacts (default):

```sh
make deps          # fetch + verify corvid v0.3.0 into deps/current
go test ./...      # the golden suite (267 fixture lines)
```

Requirements: Go ≥ 1.26, a C compiler (CGO enabled — the default when one
is present), `curl` + `shasum`/`sha256sum`. Or, if corvid is installed as
a system library, point cgo at it with `CGO_CFLAGS` / `CGO_LDFLAGS` (see
the repo README).

## Documents, maps, and phrases

Engine v0.3.0 added the map-key iterator (`corvid_value_map_keys`) and the
direct positional phrase search (`corvid_phrase_search`) to the C ABI:

- **Map decoding is complete, everywhere.** The v0.2.x-era boundary — a
  candidate-key oracle that failed `Get` with `ErrMapKeyEnumeration` on
  unknown keys — collapsed into a plain decode through the real iterator:
  `Get`/`Scan`/`Page`/query rows decode every document the engine can
  read, on any database, whatever wrote it (UTF-8 and nested keys
  included).
- Retrieval queries still return `Row.Doc == nil` without
  `Query.Select(...)` — keys and scores by design; read the document
  explicitly, or use `PhraseSearch` (whose rows always carry documents).
- `(*Collection).PhraseSearch(field, phrase, k)` is the DIRECT positional
  search: consecutive, in-order analyzed tokens, stop words collapsing
  out of adjacency, rows carrying the BM25 phrase score (the phrase
  scale, not the builder's fused RRF scale); `k == 0` answers empty —
  inert, never an error.

## The examples

Six runnable programs under the repo's `examples/` directory (`go run
./examples/<name>`), executed on every CI leg with deterministic output:
**quickstart**, **hybrid** (the flagship below), **vector-index**
(in-memory / on-disk / binary-quantized HNSW vs the exact scan),
**text-search** (BM25 incl. CJK bigram segmentation, plus the v0.3.0 direct `PhraseSearch`), **graph**
(neighbors/traverse + delete cascade), and **geo** (radius / bbox /
nearest). The quickstart and hybrid sources are embedded below — imported
from the repo so they cannot drift from what CI executes
(`scripts/sync-binding-examples.sh`; the drift gate reddens docs CI if
they diverge).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```go
func main() {
	db, err := corvid.OpenMemory()
	if err != nil {
		panic(err)
	}
	defer func() { must(db.Close()) }()

	docs, err := db.Collection("docs")
	if err != nil {
		panic(err)
	}
	defer docs.Close()

	must(docs.Insert([]byte("p1"), map[string]any{
		"title": "rust embedded database", "kind": "doc",
		"v": []float32{1.0, 0.0},
	}))
	must(docs.Insert([]byte("p2"), map[string]any{
		"title": "python web frameworks", "kind": "doc",
		"v": []float32{0.0, 1.0},
	}))
	must(docs.Insert([]byte("p3"), map[string]any{
		"title": "rust again database", "kind": "doc",
		"v": []float32{0.9, 0.1},
	}))

	// kNN: the 3 nearest documents to (1, 0) under cosine. Row.Doc is
	// materialized only under Select — retrieval rows carry keys and
	// scores, so select the field the printout needs.
	rows, err := docs.Query().
		Vector("v", []float32{1.0, 0.0}, 3, corvid.MetricCosine).
		Select("title").
		Run()
	if err != nil {
		panic(err)
	}
	for rank, r := range rows {
		fmt.Printf("%d. %s score=%.6f %v\n", rank+1, r.Key, r.Score, r.Doc)
	}
}
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```go
func main() {
	db, err := corvid.OpenMemory()
	if err != nil {
		panic(err)
	}
	defer func() { must(db.Close()) }()

	docs, err := db.Collection("docs")
	if err != nil {
		panic(err)
	}
	defer docs.Close()

	must(docs.Insert([]byte("s1"), map[string]any{
		"kind": "doc", "body": "rust embedded database",
		"v": []float32{1.0, 0.0},
	}))
	must(docs.Insert([]byte("s2"), map[string]any{
		"kind": "doc", "body": "python web frameworks",
		"v": []float32{0.0, 1.0},
	}))
	must(docs.Insert([]byte("s3"), map[string]any{
		"kind": "doc", "body": "rust again database",
		"v": []float32{0.9, 0.1},
	}))
	must(docs.Insert([]byte("m1"), map[string]any{"kind": "meta"})) // filtered out below

	// The flagship query: filter + vector + text, RRF + MMR + limit.
	rows, err := docs.Query().
		Filter(corvid.Field("kind").Eq("doc")).
		Vector("v", []float32{1.0, 0.0}, 2, corvid.MetricCosine).
		Text("body", "rust database", 2).
		FuseRRF(60).
		RerankMMR(1.0).
		Limit(2).
		Select("body").
		Run()
	if err != nil {
		panic(err)
	}
	for rank, r := range rows {
		fmt.Printf("%d. %s score=%.6f %v\n", rank+1, r.Key, r.Score, r.Doc)
	}
}
```

<!-- corvid-examples:hybrid END -->

The fused scores are RRF rank sums: `s1` is rank 1 of both sources
(1/61 + 1/61 = 2/61 ≈ 0.032787), `s3` rank 2 of both (2/62 ≈ 0.032258).

## Value mapping

| Go | engine |
|---|---|
| `nil` / `bool` / `string` | Null / Bool / Text |
| `int64` | Int (full i64) |
| `float64` | Float — NaN and ±inf cross bit-exactly |
| `[]byte` | Bytes |
| `[]float32` | Vector |
| `[]any` / `map[string]any` | Array / Map |

Keys are `[]byte`. Errors are `*corvid.CorvidError` (implements `error` +
`Code()`); `Query`/`Predicate` builders are single-goroutine,
build-once, consumed-by-the-terminal; `Close` on every handle, with
runtime finalizers as backstops only.

## Correctness story

The binding replays the engine's **golden suite** — the same 267-line
fixture files the C ABI smoke harness runs, vendored byte-identical and
verified against each release — through its public API on every CI run
(`golden_test.go`), then executes the six-example tour under `go run`
(and golangci-lint). The plan (architecture ruling, lifetime mapping,
pointer discipline) lives in the repo.

Next: the [reference section](/reference/constructs/).
