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
make deps          # fetch + verify corvid v0.4.1 into deps/current
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
nearest). All six sources are embedded below — imported
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
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```go
func main() {
	path := filepath.Join(os.TempDir(), "corvid-go-example-vector-index.redb")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		panic(err)
	} // reruns start clean (single-file db)

	db, err := corvid.Open(path)
	if err != nil {
		panic(err)
	}
	items, err := db.Collection("items")
	if err != nil {
		panic(err)
	}
	for _, c := range corpus {
		must(items.Insert([]byte(c.key), map[string]any{
			"v_mem": c.v, "v_disk": c.v, "v_q": c.v,
		}))
	}
	must(items.CreateVectorIndex("v_mem", corvid.MetricCosine))
	must(items.CreateVectorIndexOnDisk("v_disk", corvid.MetricCosine))
	must(items.CreateVectorIndexQuantized("v_q", corvid.MetricCosine, corvid.QuantBinary))

	fmt.Println("top-4 nearest to (1,0,0,0) under cosine:")
	runQuery(items, "v_mem", false, "exact (scan):")
	runQuery(items, "v_mem", true, "ann in-memory HNSW:")
	runQuery(items, "v_disk", true, "ann on-disk HNSW:")
	runQuery(items, "v_q", true, "ann binary-quantized:")
	fmt.Println("(the quantized lane trades recall for a ~32x smaller index)")

	items.Close()
	must(db.Close())

	// Reopen: the on-disk graph reloads (no rebuild) and answers again.
	db, err = corvid.Open(path)
	if err != nil {
		panic(err)
	}
	items, err = db.Collection("items")
	if err != nil {
		panic(err)
	}
	runQuery(items, "v_disk", true, "ann on-disk after reopen:")
	items.Close()
	must(db.Close())

	must(os.Remove(path))
}
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```go
func main() {
	db, err := corvid.OpenMemory()
	if err != nil {
		panic(err)
	}
	defer func() { must(db.Close()) }()

	notes, err := db.Collection("notes")
	if err != nil {
		panic(err)
	}
	defer notes.Close()

	for _, n := range corpus {
		must(notes.Insert([]byte(n.key), map[string]any{"body": n.body}))
	}
	must(notes.CreateTextIndex("body"))

	search(notes, "quick fox", `bm25 "quick fox":`)
	search(notes, "quick dog", `bm25 "quick dog":`)
	search(notes, "城市", "bm25 CJK 城市 (city):")
	search(notes, "数据库", "bm25 CJK 数据库 (database):")

	phrase(notes, "fox jumps over", `phrase "fox jumps over":`)
	phrase(notes, "over jumps fox", `phrase "over jumps fox" (reversed — no match):`)
	phrase(notes, "leaps over a sleeping", `phrase with stop words collapsed:`)
}
```

<!-- corvid-examples:text_search END -->
### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```go
func main() {
	db, err := corvid.OpenMemory()
	if err != nil {
		panic(err)
	}
	defer func() { must(db.Close()) }()

	nodes, err := db.Collection("nodes")
	if err != nil {
		panic(err)
	}
	defer nodes.Close()

	for _, key := range []string{"ga", "gb", "gc"} {
		must(nodes.Insert([]byte(key), map[string]any{"n": key}))
	}

	must(nodes.Link([]byte("ga"), "parent_of", []byte("gb")))
	must(nodes.Link([]byte("ga"), "parent_of", []byte("gc")))
	must(nodes.Link([]byte("gb"), "parent_of", []byte("gd"))) // gd never exists as a document
	must(nodes.LinkWeighted([]byte("ga"), "route", []byte("gb"), 2.5))
	must(nodes.LinkWeighted([]byte("ga"), "route", []byte("gd"), 0.75))

	ga, gb := []byte("ga"), []byte("gb")

	if nb, err := nodes.Neighbors(ga, "parent_of"); err != nil {
		panic(err)
	} else {
		show("neighbors(ga)", nb)
	}
	if in, err := nodes.InNeighbors(gb, "parent_of"); err != nil {
		panic(err)
	} else {
		show("in_neighbors(gb)", in)
	}
	if routes, err := nodes.NeighborsWeighted(ga, "route"); err != nil {
		panic(err)
	} else {
		parts := make([]string, len(routes))
		for i, r := range routes {
			parts[i] = fmt.Sprintf("%s=%.2f", r.Key, r.Weight)
		}
		fmt.Printf("%-36s [%s]\n", "routes from ga (weighted):", strings.Join(parts, " "))
	}
	if tr, err := nodes.Traverse(ga, "parent_of", 1); err != nil {
		panic(err)
	} else {
		show("traverse(ga, 1 hop)", tr)
	}
	if tr, err := nodes.Traverse(ga, "parent_of", 2); err != nil {
		panic(err)
	} else {
		show("traverse(ga, 2 hops)", tr)
	}

	// Delete cascade: remove gc (a document) and gd (never a document).
	if existed, err := nodes.Delete([]byte("gc")); err != nil {
		panic(err)
	} else {
		fmt.Println("delete gc: existed =", existed)
	}
	if existed, err := nodes.Delete([]byte("gd")); err != nil {
		panic(err)
	} else {
		fmt.Println("delete gd: existed =", existed,
			"(never a document; its edges still cascade)")
	}

	if nb, err := nodes.Neighbors(ga, "parent_of"); err != nil {
		panic(err)
	} else {
		show("neighbors(ga) after deletes", nb)
	}
	if nb, err := nodes.Neighbors(gb, "parent_of"); err != nil {
		panic(err)
	} else {
		show("neighbors(gb) after deletes", nb)
	}
	if tr, err := nodes.Traverse(ga, "parent_of", 2); err != nil {
		panic(err)
	} else {
		show("traverse(ga, 2 hops) after", tr)
	}
}
```

<!-- corvid-examples:graph END -->
### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```go
func main() {
	db, err := corvid.OpenMemory()
	if err != nil {
		panic(err)
	}
	defer func() { must(db.Close()) }()

	places, err := db.Collection("places")
	if err != nil {
		panic(err)
	}
	defer places.Close()

	for _, c := range cities {
		must(places.Insert([]byte(c.name), map[string]any{
			"name": c.name,
			"loc":  []any{c.lat, c.lon}, // the [lat, lon] array encoding
		}))
	}
	must(places.CreateGeoIndex("loc"))

	hits, err := places.GeoWithinRadius("loc", 52.52, 13.40, 600.0)
	show("within 600km of Berlin:", hits, err)
	hits, err = places.GeoWithinBBox("loc", 47, 5, 55, 15)
	show("bbox 47..55N, 5..15E:", hits, err)
	hits, err = places.GeoNearest("loc", 52.52, 13.40, 2)
	show("nearest 2 to Berlin:", hits, err)
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
| `the Go value mapping (nil/bool/int64/float64/string/[]byte/[]float32/[]any/map[string]any)` | 10 | golden:values.txt:VTYPE |
| `FieldExpr.Eq/Ne/Lt/Le/Gt/Ge` | 7 | golden:queries.txt:QF_* |
| `Predicate via Field()/Not()` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN |
| `Metric type (MetricCosine/MetricDot/MetricL2)` | 4 | golden:queries.txt:QVEC |
| `Quant type (QuantNone/QuantBinary/QuantScalar)` | 4 | golden:schema.txt:IDX_VEC_Q |
| `returns *CorvidError` | 1 | golden:mutations.txt:INSERT_ERR |
| `CorvidError.Code() (ErrCode table)` | 1 | TestErrorCodeTable |
| `ErrDatabase (code 1)` | 1 | TestErrorCodeTable |
| `ErrTransaction (code 2)` | 1 | TestErrorCodeTable |
| `ErrTable (code 3)` | 1 | TestErrorCodeTable |
| `ErrStorage (code 4)` | 1 | TestErrorCodeTable |
| `ErrCommit (code 5)` | 1 | TestErrorCodeTable |
| `ErrSetDurability (code 6)` | 1 | TestErrorCodeTable |
| `ErrCompaction (code 7)` | 1 | TestErrorCodeTable |
| `ErrDecode (code 8)` | 1 | TestErrorCodeTable |
| `ErrCorruptIndex (code 9)` | 1 | TestErrorCodeTable |
| `ErrReservedCollection (code 10)` | 1 | TestErrorCodeTable; golden:mutations.txt:INSERT_ERR(err:10) |
| `ErrInvalidName (code 11)` | 1 | TestErrorCodeTable; golden:mutations.txt:INSERT_ERR(err:11) |
| `ErrArgument (code 12)` | 1 | TestErrorCodeTable; golden:mutations.txt:UPDATE_ABORT(err:12) |
| `ErrIncompatibleFormat (code 13)` | 1 | TestErrorCodeTable |
| `ErrEmptyIndexTraining (code 14)` | 1 | TestErrorCodeTable; golden:schema.txt:IDX_PQ_ERR(err:14) |
| `ErrSchemaViolation (code 15)` | 1 | TestErrorCodeTable; golden:schema.txt:SCHEMA_ERR(err:15) |
| `ErrInvalidDump (code 16)` | 1 | TestErrorCodeTable |
| `ErrBackupTargetExists (code 17)` | 1 | TestErrorCodeTable; golden:admin.txt:BACKUP_DUP(err:17) |
| `ErrIO (code 18)` | 1 | TestErrorCodeTable |
| `Row { Key, Doc, Score }` | 1 | golden:queries.txt |
| `Query (Collection.Query())` | 2 | golden:queries.txt |
| `Query.Filter` | 1 | golden:queries.txt:QF_COUNT |
| `Query.Vector` | 1 | golden:queries.txt:QVEC |
| `Query.Text` | 1 | golden:queries.txt:QTEXT |
| `Query.FuseRRF` | 1 | golden:queries.txt:HYBRID_F |
| `Query.RerankMMR` | 1 | golden:queries.txt:HYBRID |
| `Query.Limit` | 1 | golden:queries.txt:ORDER_BY |
| `Query.Offset` | 1 | golden:queries.txt:ORDER_BY |
| `Query.OrderBy` | 1 | golden:queries.txt:ORDER_BY |
| `Query.Approx` | 1 | golden:queries.txt:APPROX |
| `Query.Select` | 1 | golden:queries.txt:SELECT |
| `Query.Count` | 1 | golden:queries.txt:AGG_COUNT |
| `Query.GroupCount` | 1 | golden:queries.txt:AGG_GCOUNT |
| `Query.Sum` | 1 | golden:queries.txt:AGG_SUM |
| `Query.Avg` | 1 | golden:queries.txt:AGG_AVG |
| `Query.Min` | 1 | golden:queries.txt:AGG_MIN |
| `Query.Max` | 1 | golden:queries.txt:AGG_MAX |
| `Query.CountDistinct` | 1 | golden:queries.txt:AGG_DISTINCT |
| `Query.GroupSum` | 1 | golden:queries.txt:AGG_GSUM |
| `Query.GroupAvg` | 1 | golden:queries.txt:AGG_GAVG |
| `Query.Run` | 1 | golden:queries.txt:QVEC |
| `Db` | 1 | golden:admin.txt:FILEDB |
| `Db.Open/OpenMemory/Collection/Collections/Backup/Compact` | 6 | golden:admin.txt (COLLECTIONS/BACKUP/COMPACT) |
| `Collection` | 1 | golden:mutations.txt:COLL |
| `Collection.Insert/Update/Patch/CompareAndSet` | 4 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `Collection.Scan(callback, early stop)` | 1 | golden:mutations.txt:SCAN/SCAN_STOP |
| `Collection.Len (Len()==0 for empty)` | 2 | golden:mutations.txt:LEN |
| `Collection.PutMany` | 1 | golden:mutations.txt:PUTMANY + golden:schema.txt:PUTMANY_ROLLBACK |
| `Collection.InsertAuto` | 1 | golden:mutations.txt:INSERT_AUTO |
| `Collection.Get` | 1 | golden:mutations.txt:GET |
| `Collection.Delete/DeleteWhere/DeleteBatch` | 3 | golden:mutations.txt (DELETE/DELETE_WHERE/DELETE_BATCH) |
| `Collection.Scan` | 1 | golden:mutations.txt:SCAN |
| `Collection.Page / (rows, next)` | 2 | golden:mutations.txt:PAGE |
| `Row.Score (Query.Vector().Run())` | 1 | golden:queries.txt:QVEC |
| `Row.Score (Query.Text().Run())` | 1 | golden:queries.txt:QTEXT |
| `(*Collection).PhraseSearch(field, phrase, k) — the direct positional search (corvid_phrase_search, v0.3.0) over the rows cursor` | 1 | golden:queries.txt:PHRASE |
| `Query.FuseRRF default k=60` | 1 | golden:queries.txt:HYBRID |
| `GeoHit { Key, Doc, DistanceKm }` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `Collection.GeoWithinRadius/GeoNearest/GeoWithinBBox/CreateGeoIndex` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `Collection.Link/LinkWeighted/Unlink/Neighbors/InNeighbors/NeighborsWeighted/Traverse` | 7 | golden:graph.txt |
| `Collection.CreateScalarIndex/CreateCompoundIndex/CreateTextIndex[/OnDisk]/CreateGeoIndex/CreateVectorIndex* (6 variants)` | 10 | golden:schema.txt:IDX_* |
| `FieldType enum (FieldAny/FieldBool/FieldInt/FieldFloat/FieldText/FieldBytes/FieldVector/FieldArray/FieldMap)` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `Collection.SetSchema/Schema + FieldDef { Name, Type, Required, Unique }` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `Collection.InsertTTL/SetTTL/GetTTL/PurgeExpired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `Db.Dump/Load/LoadWithRenames` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) |

159 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

godoc renders the package from its doc comments: [pkg.go.dev/github.com/corvid-db/corvid-go](https://pkg.go.dev/github.com/corvid-db/corvid-go) — also `go doc` locally.


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
