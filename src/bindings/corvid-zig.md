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
### Vector indexes (ANN vs exact)

<!-- corvid-examples:vector_index BEGIN -->

```zig
fn putDoc(items: corvid.Collection, key: []const u8, v: []const f32) !void {
    var doc = corvid.Value.map();
    defer doc.deinit();
    var a = corvid.Value.vector(v);
    try doc.put("v_mem", &a);
    var b = corvid.Value.vector(v);
    try doc.put("v_disk", &b);
    var q = corvid.Value.vector(v);
    try doc.put("v_q", &q);
    try items.insert(key, doc);
}

// Run a top-4 vector query over `field`, print its ranked keys.
fn runQuery(init: std.process.Init, items: corvid.Collection, field: []const u8, approx: bool, label: []const u8) u8 {
    var q = items.query() catch |e| return fail(e, "query_new");
    defer q.deinit();
    _ = q.vector(field, &PROBE, 4, .cosine) catch |e| return fail(e, "query_vector");
    if (approx) _ = q.approx() catch |e| return fail(e, "query_approx");
    var rows = q.run() catch |e| return fail(e, "query_run");
    defer rows.deinit();

    var buf: [512]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    w.interface.print("{s:<38}", .{label}) catch {};
    while (rows.next()) |row| {
        w.interface.print(" {s}({d:.6})", .{ row.key, @as(f64, row.score) }) catch {};
    }
    w.interface.print("\n", .{}) catch {};
    w.interface.flush() catch {};
    return 0;
}

pub fn main(init: std.process.Init) u8 {
    var buf: [512]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    const say = struct {
        fn print(writer: *std.Io.File.Writer, comptime fmt: []const u8, args: anytype) void {
            writer.interface.print(fmt, args) catch {};
        }
    }.print;

    std.Io.Dir.cwd().deleteTree(init.io, DB_FILE) catch {};

    var db = corvid.Db.open(DB_FILE) catch |e| return fail(e, "open");
    var items = db.collection("items") catch |e| return fail(e, "collection");

    for (DOCS, 0..) |v, i| {
        var key_buf: [8]u8 = undefined;
        const key = std.fmt.bufPrint(&key_buf, "i{d}", .{i}) catch unreachable;
        putDoc(items, key, &v) catch |e| return fail(e, "insert");
    }

    items.createVectorIndex("v_mem", .cosine) catch |e| return fail(e, "index v_mem");
    items.createVectorIndexOndisk("v_disk", .cosine) catch |e| return fail(e, "index v_disk");
    items.createVectorIndexQuantized("v_q", .cosine, .binary) catch |e| return fail(e, "index v_q");

    say(&w, "corpus: 8 docs, 4-d; probe (1,0,0,0), top-4 cosine\n", .{});
    say(&w, "scores are RRF ranks of each lane's own ranking\n\n", .{});
    w.interface.flush() catch {};

    var rc = runQuery(init, items, "v_mem", false, "exact scan (no index):");
    if (rc != 0) return rc;
    rc = runQuery(init, items, "v_mem", true, "in-memory HNSW (approx):");
    if (rc != 0) return rc;
    rc = runQuery(init, items, "v_disk", true, "on-disk HNSW (approx):");
    if (rc != 0) return rc;
    rc = runQuery(init, items, "v_q", true, "binary-quantized (approx):");
    if (rc != 0) return rc;

    // Close and reopen: the on-disk graph reloads with the file and
    // serves the same ANN answer without a rebuild.
    items.deinit();
    db.deinit();
    say(&w, "\nclose + reopen (on-disk HNSW reloads):\n", .{});
    w.interface.flush() catch {};

    var db2 = corvid.Db.open(DB_FILE) catch |e| return fail(e, "reopen");
    defer db2.deinit();
    var items2 = db2.collection("items") catch |e| return fail(e, "collection 2");
    defer items2.deinit();
    return runQuery(init, items2, "v_disk", true, "on-disk HNSW (approx):");
}
```

<!-- corvid-examples:vector_index END -->
### Text search (BM25, CJK, phrases)

<!-- corvid-examples:text_search BEGIN -->

```zig
fn putNote(notes: corvid.Collection, key: []const u8, body: []const u8) !void {
    var doc = corvid.Value.map();
    defer doc.deinit();
    var b = try corvid.Value.text(body);
    try doc.put("body", &b);
    try notes.insert(key, doc);
}

fn searchBm25(init: std.process.Init, notes: corvid.Collection, query: []const u8, label: []const u8) u8 {
    var q = notes.query() catch |e| return fail(e, "query_new");
    defer q.deinit();
    _ = q.text("body", query, 3) catch |e| return fail(e, "query_text");
    var rows = q.run() catch |e| return fail(e, "query_run");
    defer rows.deinit();

    var buf: [512]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    w.interface.print("{s:<34} ->", .{label}) catch {};
    while (rows.next()) |row| {
        w.interface.print(" {s}({d:.6})", .{ row.key, @as(f64, row.score) }) catch {};
    }
    w.interface.print("\n", .{}) catch {};
    w.interface.flush() catch {};
    return 0;
}

fn searchPhrase(init: std.process.Init, notes: corvid.Collection, phrase: []const u8, k: usize, label: []const u8) u8 {
    var rows = notes.phraseSearch("body", phrase, k) catch |e| return fail(e, "phrase_search");
    defer rows.deinit();

    var buf: [512]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    w.interface.print("{s:<34} ->", .{label}) catch {};
    var any = false;
    while (rows.next()) |row| {
        any = true;
        w.interface.print(" {s}({d:.6})", .{ row.key, @as(f64, row.score) }) catch {};
    }
    if (!any) w.interface.print(" (none)", .{}) catch {};
    w.interface.print("\n", .{}) catch {};
    w.interface.flush() catch {};
    return 0;
}

pub fn main(init: std.process.Init) u8 {
    var db = corvid.Db.openMemory() catch |e| return fail(e, "open");
    defer db.deinit();
    var notes = db.collection("notes") catch |e| return fail(e, "collection");
    defer notes.deinit();

    const corpus = [_]struct { key: []const u8, body: []const u8 }{
        .{ .key = "n1", .body = "the quick brown fox jumps over the lazy dog" },
        .{ .key = "n2", .body = "a quick red fox leaps over a sleeping dog" },
        .{ .key = "n3", .body = "slow green turtle crosses the road" },
        .{ .key = "n4", .body = "东京是一座巨大的城市" }, // Tokyo is a huge city
        .{ .key = "n5", .body = "大阪是关西最大的城市" }, // Osaka is Kansai's biggest city
        .{ .key = "n6", .body = "机器学习正在改变数据库" }, // ML is changing databases
    };
    for (corpus) |n| putNote(notes, n.key, n.body) catch |e| return fail(e, "insert");

    notes.createTextIndex("body") catch |e| return fail(e, "create_text_index");

    var rc: u8 = 0;
    var buf: [512]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    w.interface.print("== BM25 (query builder; RRF-rank scores) ==\n", .{}) catch {};
    w.interface.flush() catch {};
    rc = searchBm25(init, notes, "quick fox", "bm25 \"quick fox\":");
    if (rc != 0) return rc;
    rc = searchBm25(init, notes, "quick dog", "bm25 \"quick dog\":");
    if (rc != 0) return rc;
    rc = searchBm25(init, notes, "城市", "bm25 CJK 城市 (city):");
    if (rc != 0) return rc;
    rc = searchBm25(init, notes, "数据库", "bm25 CJK 数据库 (database):");
    if (rc != 0) return rc;

    w.interface.print("\n== phrase (direct positional; BM25 phrase-sum scores) ==\n", .{}) catch {};
    w.interface.flush() catch {};
    // Word order matters: reversed matches nothing.
    rc = searchPhrase(init, notes, "quick brown fox", 3, "phrase \"quick brown fox\":");
    if (rc != 0) return rc;
    rc = searchPhrase(init, notes, "fox quick brown", 3, "phrase \"fox quick brown\":");
    if (rc != 0) return rc;
    // Stop words collapse out of adjacency: the ≡ nothing.
    rc = searchPhrase(init, notes, "over the lazy", 3, "phrase \"over the lazy\":");
    if (rc != 0) return rc;
    rc = searchPhrase(init, notes, "over lazy", 3, "phrase \"over lazy\":");
    if (rc != 0) return rc;
    // CJK bigrams carry the phrase match through.
    rc = searchPhrase(init, notes, "巨大的城市", 3, "phrase CJK 巨大的城市:");
    if (rc != 0) return rc;
    // k == 0: an EMPTY cursor — inert, not an error.
    rc = searchPhrase(init, notes, "quick", 0, "phrase k=0:");
    if (rc != 0) return rc;
    return 0;
}
```

<!-- corvid-examples:text_search END -->
### Graph (neighbors, traverse, delete cascade)

<!-- corvid-examples:graph BEGIN -->

```zig
fn putNode(nodes: corvid.Collection, key: []const u8) !void {
    var doc = corvid.Value.map();
    defer doc.deinit();
    var n = try corvid.Value.text(key);
    try doc.put("n", &n);
    try nodes.insert(key, doc);
}

// Print one `[a b c ]` line from a key-set cursor (borrowed views).
fn printStrs(init: std.process.Init, label: []const u8, s: *corvid.Strs) void {
    var buf: [256]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    w.interface.print("{s:<36} [", .{label}) catch {};
    while (s.next()) |item| {
        w.interface.print("{s} ", .{item}) catch {};
    }
    w.interface.print("]\n", .{}) catch {};
    w.interface.flush() catch {};
}

pub fn main(init: std.process.Init) u8 {
    var db = corvid.Db.openMemory() catch |e| return fail(e, "open");
    defer db.deinit();
    var nodes = db.collection("nodes") catch |e| return fail(e, "collection");
    defer nodes.deinit();

    for ([_][]const u8{ "ga", "gb", "gc" }) |key| {
        putNode(nodes, key) catch |e| return fail(e, "insert");
    }

    nodes.link("ga", "parent_of", "gb") catch |e| return fail(e, "link ga->gb");
    nodes.link("ga", "parent_of", "gc") catch |e| return fail(e, "link ga->gc");
    // gb -> gd: gd never exists as a document; the edge dangles fine.
    nodes.link("gb", "parent_of", "gd") catch |e| return fail(e, "link gb->gd");
    nodes.linkWeighted("ga", "route", "gb", 2.5) catch |e| return fail(e, "link_weighted ga->gb");
    nodes.linkWeighted("ga", "route", "gd", 0.75) catch |e| return fail(e, "link_weighted ga->gd");

    var buf: [512]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);

    var neighbors = nodes.neighbors("ga", "parent_of") catch |e| return fail(e, "neighbors");
    defer neighbors.deinit();
    printStrs(init, "neighbors(ga):", &neighbors);

    var in = nodes.inNeighbors("gb", "parent_of") catch |e| return fail(e, "in_neighbors");
    defer in.deinit();
    printStrs(init, "in_neighbors(gb):", &in);

    var routes = nodes.neighborsWeighted("ga", "route") catch |e| return fail(e, "neighbors_weighted");
    defer routes.deinit();
    w.interface.print("{s:<36} [", .{"routes from ga (weighted):"}) catch {};
    while (routes.next()) |hit| {
        w.interface.print("{s}={d:.2} ", .{ hit.key, hit.distance_km }) catch {};
    }
    w.interface.print("]\n", .{}) catch {};

    var t1 = nodes.traverse("ga", "parent_of", 1) catch |e| return fail(e, "traverse 1");
    defer t1.deinit();
    printStrs(init, "traverse(ga, 1 hop):", &t1);
    var t2 = nodes.traverse("ga", "parent_of", 2) catch |e| return fail(e, "traverse 2");
    defer t2.deinit();
    printStrs(init, "traverse(ga, 2 hops):", &t2);
    w.interface.flush() catch {};

    // Delete cascade: remove gc (a document) and gd (never a document).
    const gc_gone = nodes.delete("gc") catch |e| return fail(e, "delete gc");
    w.interface.print("delete gc: existed={}\n", .{gc_gone}) catch {};
    const gd_gone = nodes.delete("gd") catch |e| return fail(e, "delete gd");
    w.interface.print("delete gd: existed={} (never a document; its edges still cascade)\n", .{gd_gone}) catch {};
    w.interface.flush() catch {};

    var na = nodes.neighbors("ga", "parent_of") catch |e| return fail(e, "neighbors after");
    defer na.deinit();
    printStrs(init, "neighbors(ga) after deletes:", &na);
    var nb = nodes.neighbors("gb", "parent_of") catch |e| return fail(e, "neighbors(gb) after");
    defer nb.deinit();
    printStrs(init, "neighbors(gb) after deletes:", &nb);
    var t3 = nodes.traverse("ga", "parent_of", 2) catch |e| return fail(e, "traverse after");
    defer t3.deinit();
    printStrs(init, "traverse(ga, 2 hops) after:", &t3);
    return 0;
}
```

<!-- corvid-examples:graph END -->
### Geo (radius, bbox, nearest)

<!-- corvid-examples:geo BEGIN -->

```zig
fn putCity(places: corvid.Collection, key: []const u8, name: []const u8, lat: f64, lon: f64) !void {
    var doc = corvid.Value.map();
    defer doc.deinit();
    var n = try corvid.Value.text(name);
    try doc.put("name", &n);
    var loc = corvid.Value.array();
    // put()/push() move each value into its parent as they go
    var la = corvid.Value.float(lat);
    try loc.push(&la);
    var lo = corvid.Value.float(lon);
    try loc.push(&lo);
    try doc.put("loc", &loc);
    try places.insert(key, doc);
}

fn printHits(init: std.process.Init, label: []const u8, hits: *corvid.GeoHits) void {
    var buf: [512]u8 = undefined;
    var w = std.Io.File.stdout().writer(init.io, &buf);
    w.interface.print("{s:<32} [", .{label}) catch {};
    while (hits.next()) |hit| {
        // geo cursors carry their document; neighborsWeighted leaves it null
        if (hit.doc) |d| {
            const name = d.mapGet("name").?.textRef() orelse "?";
            w.interface.print("{s}={d:.6}km({s}) ", .{ hit.key, hit.distance_km, name }) catch {};
        } else {
            w.interface.print("{s}={d:.6} ", .{ hit.key, hit.distance_km }) catch {};
        }
    }
    w.interface.print("]\n", .{}) catch {};
    w.interface.flush() catch {};
}

pub fn main(init: std.process.Init) u8 {
    var db = corvid.Db.openMemory() catch |e| return fail(e, "open");
    defer db.deinit();
    var places = db.collection("places") catch |e| return fail(e, "collection");
    defer places.deinit();

    //               key        lat     lon     (name for the printout)
    const cities = [_]struct { key: []const u8, name: []const u8, lat: f64, lon: f64 }{
        .{ .key = "berlin", .name = "Berlin", .lat = 52.520, .lon = 13.405 },
        .{ .key = "potsdam", .name = "Potsdam", .lat = 52.396, .lon = 13.064 },
        .{ .key = "hamburg", .name = "Hamburg", .lat = 53.551, .lon = 9.994 },
        .{ .key = "munchen", .name = "München", .lat = 48.137, .lon = 11.575 },
    };
    for (cities) |city| {
        putCity(places, city.key, city.name, city.lat, city.lon) catch |e| return fail(e, "insert");
    }

    var r = places.geoWithinRadius("loc", 52.52, 13.40, 600.0) catch |e| return fail(e, "geo_within_radius");
    defer r.deinit();
    printHits(init, "radius 600km from Berlin:", &r);

    var b = places.geoWithinBbox("loc", 47.0, 5.0, 55.0, 15.0) catch |e| return fail(e, "geo_within_bbox");
    defer b.deinit();
    printHits(init, "bbox (47..55, 5..15):", &b);

    var n2 = places.geoNearest("loc", 52.52, 13.40, 2) catch |e| return fail(e, "geo_nearest");
    defer n2.deinit();
    printHits(init, "nearest 2 to Berlin:", &n2);
    return 0;
}
```

<!-- corvid-examples:geo END -->





## API at a glance

Generated from the binding's `docs/SURFACE.tsv` (every engine
construct at the pinned tag mapped or N/A with a reason) — regenerated
by the docs sync, so it cannot drift.

<!-- corvid-api-glance BEGIN -->

| API group | engine constructs | proven by |
|---|---|---|
| `corvid.Value constructors + corvid.Value.kind (corvid.ValueKind)` | 10 | golden:values.txt:VTYPE |
| `corvid.ValueView.arrayGet/mapGet` | 2 | golden:values.txt:VNEST |
| `corvid.ValueView.asBool/asInt/asFloat, textRef/bytesRef/vectorRef` | 6 | golden:values.txt:VAS_*/V*_REF |
| `corvid.Cmp (.eq/.ne/.lt/.le/.gt/.ge)` | 7 | golden:queries.txt:QF_* |
| `corvid.Pred constructor family (+ andOp/orOp/notOp moves)` | 27 | golden:queries.txt:QF_* + golden:mutations.txt:DELETE_IN |
| `corvid.Metric enum (.cosine/.dot/.l2)` | 4 | golden:queries.txt:QVEC |
| `corvid.Quant enum (.none/.binary/.scalar)` | 4 | golden:schema.txt:IDX_VEC_Q |
| `corvid.Error + corvid.lastErrorCode/lastErrorMessage` | 1 | golden:mutations.txt:INSERT_ERR |
| `corvid.ErrCode via corvid.lastErrorCode` | 1 | errcodes |
| `corvid.Error / corvid.ErrCode (code 1)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 2)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 3)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 4)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 5)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 6)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 7)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 8)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 9)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 10)` | 1 | errcodes (frozen-table _Static_assert test); golden:mutations.txt:INSERT_ERR(err:10) |
| `corvid.Error / corvid.ErrCode (code 11)` | 1 | errcodes (frozen-table _Static_assert test); golden:mutations.txt:INSERT_ERR(err:11) |
| `corvid.Error / corvid.ErrCode (code 12)` | 1 | errcodes (frozen-table _Static_assert test); golden:mutations.txt:UPDATE_ABORT(err:12) |
| `corvid.Error / corvid.ErrCode (code 13)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 14)` | 1 | errcodes (frozen-table _Static_assert test); golden:schema.txt:IDX_PQ_ERR(err:14) |
| `corvid.Error / corvid.ErrCode (code 15)` | 1 | errcodes (frozen-table _Static_assert test); golden:schema.txt:SCHEMA_ERR(err:15) |
| `corvid.Error / corvid.ErrCode (code 16)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Error / corvid.ErrCode (code 17)` | 1 | errcodes (frozen-table _Static_assert test); golden:admin.txt:BACKUP_DUP(err:17) |
| `corvid.Error / corvid.ErrCode (code 18)` | 1 | errcodes (frozen-table _Static_assert test) |
| `corvid.Rows.next cursor (corvid.Row)` | 1 | golden:queries.txt |
| `corvid.Collection.query (corvid.Query builder)` | 2 | golden:queries.txt |
| `corvid.Query.filter (consumes the corvid.Pred)` | 1 | golden:queries.txt:QF_COUNT |
| `corvid.Query.vector` | 1 | golden:queries.txt:QVEC |
| `corvid.Query.text` | 1 | golden:queries.txt:QTEXT |
| `corvid.Query.fuseRrf` | 1 | golden:queries.txt:HYBRID_F |
| `corvid.Query.rerankMmr` | 1 | golden:queries.txt:HYBRID |
| `corvid.Query.limit` | 1 | golden:queries.txt:ORDER_BY |
| `corvid.Query.offset` | 1 | golden:queries.txt:ORDER_BY |
| `corvid.Query.orderBy/orderByDesc` | 1 | golden:queries.txt:ORDER_BY |
| `corvid.Query.approx` | 1 | golden:queries.txt:APPROX |
| `corvid.Query.select` | 1 | golden:queries.txt:SELECT |
| `corvid.Query.count` | 1 | golden:queries.txt:AGG_COUNT |
| `corvid.Query.groupCount` | 1 | golden:queries.txt:AGG_GCOUNT |
| `corvid.Query.sum` | 1 | golden:queries.txt:AGG_SUM |
| `corvid.Query.avg` | 1 | golden:queries.txt:AGG_AVG |
| `corvid.Query.min` | 1 | golden:queries.txt:AGG_MIN |
| `corvid.Query.max` | 1 | golden:queries.txt:AGG_MAX |
| `corvid.Query.countDistinct` | 1 | golden:queries.txt:AGG_DISTINCT |
| `corvid.Query.groupSum` | 1 | golden:queries.txt:AGG_GSUM |
| `corvid.Query.groupAvg` | 1 | golden:queries.txt:AGG_GAVG |
| `corvid.Query.run (consumes the builder)` | 1 | golden:queries.txt:QVEC |
| `corvid.Db.open/openMemory handle (deinit)` | 1 | golden:admin.txt:FILEDB |
| `corvid.Db.open/openMemory/collection/collections/backup/compact + corvid.Collection.deinit` | 6 | golden:admin.txt (COLLECTIONS/BACKUP/COMPACT) |
| `corvid.Collection handle family (deinit)` | 1 | golden:mutations.txt:COLL |
| `corvid.Collection.insert/update/patch/compareAndSet` | 4 | golden:mutations.txt (INSERT/UPDATE/PATCH/CAS) |
| `corvid.Collection.scan callback + early stop` | 1 | golden:mutations.txt:SCAN/SCAN_STOP |
| `corvid.Collection.len (== 0 for empty)` | 2 | golden:mutations.txt:LEN |
| `corvid.Collection.putMany (corvid.Kv)` | 1 | golden:mutations.txt:PUTMANY + golden:schema.txt:PUTMANY_ROLLBACK |
| `corvid.Collection.insertAuto` | 1 | golden:mutations.txt:INSERT_AUTO |
| `corvid.Collection.get (+ corvid.Value/ValueView.mapKeys)` | 1 | golden:mutations.txt:GET/GET_KEYS |
| `corvid.Collection.delete/deleteWhere/deleteBatch` | 3 | golden:mutations.txt (DELETE/DELETE_WHERE/DELETE_BATCH) |
| `corvid.Collection.scan (full walk)` | 1 | golden:mutations.txt:SCAN |
| `corvid.Collection.page (corvid.Page)` | 2 | golden:mutations.txt:PAGE |
| `corvid.Row.score from corvid.Rows.next` | 2 | golden:queries.txt:QVEC; golden:queries.txt:QTEXT |
| `corvid.Collection.phraseSearch (the v0.3.0 direct positional fn) over the corvid.Rows cursor` | 1 | golden:queries.txt:PHRASE |
| `corvid.Query.fuseRrf default k=60` | 1 | golden:queries.txt:HYBRID |
| `corvid.GeoHits.next cursor (corvid.GeoHit)` | 1 | golden:geo.txt:RADIUS/NEAREST/BBOX |
| `corvid.Collection.geoWithinRadius/geoNearest/geoWithinBbox/createGeoIndex` | 4 | golden:geo.txt (RADIUS/NEAREST/BBOX/IDX_GEO) |
| `corvid.Collection.link/linkWeighted/unlink/neighbors/inNeighbors/neighborsWeighted/traverse` | 7 | golden:graph.txt |
| `corvid.Collection.createScalarIndex/createCompoundIndex/createTextIndex/createTextIndexOndisk/createGeoIndex/createVectorIndex/createVectorIndexQuantized/createVectorIndexOndisk/createVectorIndexOndiskQuantized/createVectorIndexPq/createVectorIndexOndiskPq` | 10 | golden:schema.txt:IDX_* |
| `corvid.FieldType enum` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA |
| `corvid.Collection.setSchema/schema + corvid.SchemaIter` | 10 | golden:schema.txt:SET_SCHEMA/SCHEMA/SCHEMA_ERR |
| `corvid.Collection.insertWithTtl/setTtl/getTtl/purgeExpired` | 4 | golden:mutations.txt (INSERT_TTL/SET_TTL/GET_TTL/PURGE) |
| `corvid.Db.dumpToPath/loadFromPath/loadFromPathWithRenames` | 3 | golden:admin.txt (DUMP/LOAD/LOAD_RENAMES) |

151 engine constructs are deliberately not exposed (each with its reason in the repo's `docs/SURFACE.tsv`).

<!-- corvid-api-glance END -->

## API reference

Zig has no hosted doc service yet; the [README + docs/PLAN.md](https://github.com/corvid-db/corvid-zig) carry the API mapping,


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
surface (331 rows at this pin) resolved to the Zig API exposing it plus
the golden line that proves it, or `N/A` with the ABI's §9 reason,
gated in CI (`scripts/surface-gate.sh`).

Next: [corvid-js](/bindings/corvid-js/).
