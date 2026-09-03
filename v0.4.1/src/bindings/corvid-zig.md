---
title: corvid-zig
description: The corvid-zig binding — Zig over the published FFI artifacts via @cImport, Db/Collection/Query structs with deinit, Zig error sets, move semantics for consumed handles, typed borrows, and the golden-suite correctness story.
sidebar:
 order: 7
---

[`corvid-zig`](https://github.com/corvid-db/corvid-zig) is the Zig binding:
it links the engine's **published FFI artifacts** (the platform cdylib and
`corvid.h`) through a single `@cImport` and carries an idiomatic Zig layer
on top. Deliberately the corvid-c/corvid-go pattern (a fetched, checksummed
shared library), not the node/python one (Rust-source builds): `./fetch.sh`
downloads and sha256-verifies the pinned release archive, `zig build` does
the rest — no Rust toolchain, no vendored binaries.

**When to choose this binding:** your project is Zig and you want corvid
embedded with the language's own shape — `defer`-friendly handles, error
unions instead of status codes, and the ABI's sharpest UB classes
(consumed-then-freed handles, freed borrows) turned into compile errors or
safe no-ops by construction.

## The idiom mapping

| C ABI | corvid-zig |
| --- | --- |
| opaque handles (`corvid_db*`, …) | `Db` / `Collection` / `Query` / `Pred` / `Value` structs with `deinit()` — `defer` is the ownership model |
| `CORVID_ERR` + thread-local last error | `corvid.Error` — one Zig error per `corvid_err` code; `lastErrorCode()` / `lastErrorMessage()` stay public |
| frozen enums | `Metric`, `Quant`, `Cmp`, `FieldType`, `ValueKind` (exact ABI values) |
| consumed-by-call args (pred trees, builders) | **moves**: consuming calls take the wrapper by pointer and null its handle — a moved wrapper's `deinit()` is a safe no-op, so the double-free UB class cannot happen |
| borrowed views (`_ref` buffers, row docs, `map_get` children) | `ValueView` — a read-only type with **no** `deinit`: freeing a borrow is a *compile error* in Zig, where in C it is undefined behavior |
| `corvid_update_fn` / `corvid_scan_fn` | Zig closures (context + function); an `update` callback returning ANY Zig error aborts the read-modify-write through the ABI's §1.6 abort channel, and panics never unwind through C frames (Zig panics abort) |
| strings / bytes / vectors | `[]const u8` / `[]const f32` slices — the ABI's binary-safe ptr+len maps 1:1 |

The raw ABI stays importable as `corvid.c` — the golden harness drives it
exactly the way the engine's own C harness does. Application code should
stick to the wrapper types.

## Install

From the pinned release artifacts:

```sh
./fetch.sh         # fetch + sha256-verify corvid v0.3.2 into deps/current
zig build test     # wrapper unit tests + the golden suite (267 lines)
```

Requirements: Zig 0.16.0 (the current stable line — the floor rides it;
see the repo's `docs/PLAN.md` toolchain-policy note), `curl` +
`shasum`/`sha256sum` (or PowerShell on Windows). On Windows, binaries run
by hand want `deps/current` on `PATH` so the loader finds `corvid.dll`
(the build's run steps handle this for you).

## Documents, maps, and phrases

Engine v0.3.0's ABI additions are first-class here:

- `Value.mapKeys()` / `ValueView.mapKeys()` — the map's keys in ascending
  byte order (UTF-8 and nested keys included), over the §4.12 string
  cursor. Wrong-typed values answer an empty cursor — inert, not an error.
- `Collection.phraseSearch(field, phrase, k)` — the DIRECT positional
  search: consecutive, in-order analyzed tokens, stop words collapsing
  out of adjacency (`"embedded the database"` matches
  `"embedded database"`), rows carrying the BM25 phrase score (the phrase
  scale, not the builder's fused RRF scale); `k == 0` answers an empty
  cursor — inert, never an error. The `text_search` example demonstrates
  all of it, CJK bigram phrases included.

## The examples

Six runnable programs under the repo's `examples/` directory
(`zig build run-<name>`), executed on every CI leg with deterministic
output: **quickstart**, **hybrid** (the flagship below), **vector_index**
(in-memory / on-disk / binary-quantized HNSW vs the exact scan, plus a
close/reopen), **text_search** (BM25 incl. CJK bigram segmentation, plus
the v0.3.0 direct `phraseSearch`), **graph** (neighbors/traverse + delete
cascade), and **geo** (radius / bbox / nearest with haversine
kilometres). The quickstart and hybrid sources are embedded below —
imported from the repo so they cannot drift from what CI executes
(`scripts/sync-binding-examples.sh`; the drift gate reddens docs CI if
they diverge).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```zig
fn putDoc(docs: corvid.Collection, key: []const u8, title: []const u8, kind: []const u8, v: []const f32) !void {
    var doc = corvid.Value.map();
    defer doc.deinit(); // insert CLONES the value; ours is still ours
    var t = try corvid.Value.text(title);
    try doc.put("title", &t); // moves t into the map
    var k = try corvid.Value.text(kind);
    try doc.put("kind", &k);
    var vec = corvid.Value.vector(v);
    try doc.put("v", &vec);
    try docs.insert(key, doc);
}

pub fn main(init: std.process.Init) u8 {
    var db = corvid.Db.openMemory() catch |e| return fail(e, "open");
    defer db.deinit();
    var docs = db.collection("docs") catch |e| return fail(e, "collection");
    defer docs.deinit();

    putDoc(docs, "p1", "rust embedded database", "doc", &.{ 1.0, 0.0 }) catch |e| return fail(e, "insert");
    putDoc(docs, "p2", "python web frameworks", "doc", &.{ 0.0, 1.0 }) catch |e| return fail(e, "insert");
    putDoc(docs, "p3", "rust again database", "doc", &.{ 0.9, 0.1 }) catch |e| return fail(e, "insert");

    // kNN: the 3 nearest documents to (1, 0) under cosine. The builder
    // methods chain; run() consumes the builder.
    var q = docs.query() catch |e| return fail(e, "query_new");
    defer q.deinit(); // no-op after run()
    var rows = (q
        .vector("v", &.{ 1.0, 0.0 }, 3, .cosine) catch |e| return fail(e, "query_vector")
    ).run() catch |e| return fail(e, "query_run");
    defer rows.deinit();

    var rank: usize = 0;
    var buf: [256]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    while (rows.next()) |row| {
        rank += 1;
        const title = row.doc.mapGet("title").?.textRef().?;
        w.interface.print("{d}. {s} score={d:.6} {s}\n", .{ rank, row.key, @as(f64, row.score), title }) catch {};
    }
    w.interface.flush() catch {};
    return 0;
}
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```zig
fn putDoc(docs: corvid.Collection, key: []const u8, kind: []const u8, body: ?[]const u8, v: ?[]const f32) !void {
    var doc = corvid.Value.map();
    defer doc.deinit();
    var k = try corvid.Value.text(kind);
    try doc.put("kind", &k);
    if (body) |b| {
        var t = try corvid.Value.text(b);
        try doc.put("body", &t);
    }
    if (v) |vec| {
        var val = corvid.Value.vector(vec);
        try doc.put("v", &val);
    }
    try docs.insert(key, doc);
}

fn printRows(init: std.process.Init, rows: *corvid.Rows) void {
    var buf: [256]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    var rank: usize = 0;
    while (rows.next()) |row| {
        rank += 1;
        const body = row.doc.mapGet("body").?.textRef() orelse "?";
        w.interface.print("{d}. {s} score={d:.6} {s}\n", .{ rank, row.key, @as(f64, row.score), body }) catch {};
    }
    w.interface.flush() catch {};
}

pub fn main(init: std.process.Init) u8 {
    var db = corvid.Db.openMemory() catch |e| return fail(e, "open");
    defer db.deinit();
    var docs = db.collection("docs") catch |e| return fail(e, "collection");
    defer docs.deinit();

    putDoc(docs, "s1", "doc", "rust embedded database", &.{ 1.0, 0.0 }) catch |e| return fail(e, "insert");
    putDoc(docs, "s2", "doc", "python web frameworks", &.{ 0.0, 1.0 }) catch |e| return fail(e, "insert");
    putDoc(docs, "s3", "doc", "rust again database", &.{ 0.9, 0.1 }) catch |e| return fail(e, "insert");
    putDoc(docs, "m1", "meta", null, null) catch |e| return fail(e, "insert"); // filtered out below

    // The flagship query: filter + vector + text, RRF + MMR + limit.
    var q = docs.query() catch |e| return fail(e, "query_new");
    defer q.deinit(); // no-op after run()

    var kind = corvid.Value.text("doc") catch |e| return fail(e, "text");
    defer kind.deinit(); // pred_compare CLONES it; ours is still ours
    var only_docs = corvid.Pred.compare("kind", .eq, kind) catch |e| return fail(e, "pred_compare");
    defer only_docs.deinit(); // safe no-op after filter moves it
    _ = q.filter(&only_docs) catch |e| return fail(e, "query_filter"); // moves the pred

    // The setters mutate the builder and return it, so each step is one
    // statement with its own named failure; run() consumes the builder.
    _ = q.vector("v", &.{ 1.0, 0.0 }, 2, .cosine) catch |e| return fail(e, "query_vector");
    _ = q.text("body", "rust database", 2) catch |e| return fail(e, "query_text");
    _ = q.fuseRrf(60.0) catch |e| return fail(e, "query_fuse_rrf");
    _ = q.rerankMmr(1.0) catch |e| return fail(e, "query_rerank_mmr");
    _ = q.limit(2) catch |e| return fail(e, "query_limit");
    var rows = q.run() catch |e| return fail(e, "query_run");
    defer rows.deinit();
    printRows(init, &rows);
    return 0;
}
```

<!-- corvid-examples:hybrid END -->

## The correctness floor

`zig build test` replays the engine's entire **golden fixture suite** —
267 executable lines across 8 files, including the v0.3.0
`VMAP_KEYS`/`GET_KEYS` (map-key iteration) and `PHRASE`/`PHRASE_K0`
(direct positional search) lines — against the **downloaded** cdylib,
through a statement-for-statement port of the engine's own C harness
(`test/golden.zig`): every counted line must dispatch, the first failure
names file:line + OP + expected-vs-got, and every handle is freed on its
creation path (the CI sanitizer leg builds the harness with ASan and
expects zero reports). The fixtures are vendored in the repo and
byte-compared against the release's copies at fetch time, so a bad
artifact is a loud fetch failure, never a silent skip.

On top sits `docs/SURFACE.tsv` — every construct of the engine's public
surface (327 rows at this pin) resolved to the Zig API exposing it plus
the golden line that proves it, or `N/A` with the ABI's §9 reason,
gated in CI (`scripts/surface-gate.sh`).

Next: [corvid-js](/bindings/corvid-js/).
