---
title: corvid-php
description: The corvid-php binding — a native PHP extension in C over the published FFI artifacts, Corvid\Db / Corvid\Collection / fluent Corvid\Query, Corvid\Exception with the engine error table, the honest FPM/ZTS lifecycle story, and the golden-suite correctness floor.
sidebar:
  order: 9
---

[`corvid-php`](https://github.com/corvid-db/corvid-php) is the PHP binding:
a **native PHP extension in C** linking the engine's **published FFI
artifacts** (the platform cdylib and `corvid.h`). Deliberately the
corvid-c/corvid-go pattern (a fetched, checksummed shared library —
`./fetch.sh` sha256-verifies the pinned release archive and
`phpize && configure && make` links it), not an `FFI\FFI` script binding
and not a Rust-source build: PHP users install extensions, not
toolchains, and the ecosystem's install story for native code — PIE/
PECL — compiles exactly this shape against a `phpize` toolchain PHP
distributions already ship.

**When to choose this binding:** your project is PHP and you want
corvid embedded with the language's own shape — real classes with
refcounted handle lifetimes, `Corvid\Exception` carrying the engine's
error-code table, and arrays/strings mapped the way PHP actually uses
them (with `Corvid\Bytes` / `Corvid\Vector` as the type tags that keep
bytes-vs-text and arrays-vs-embeddings distinguishable).

## The idiom mapping

| C ABI | corvid-php |
| --- | --- |
| opaque handles (`corvid_db*`, …) | `Corvid\Db` / `Corvid\Collection` / `Corvid\Query` / `Corvid\Predicate` — real PHP objects; the object destructor is the free path (`Db::close()` is the explicit, idempotent shortcut) |
| `CORVID_ERR` + thread-local last error | `Corvid\Exception` — `getCode()` carries the `corvid_err` table (`Corvid\Exception::CODE_*`); every wrapper reads the thread-local slot immediately after the failing call, on the same thread, and the message rides the exception — no separate last-error fetch in the public API |
| frozen enums | `Corvid\Metric`, `Corvid\Quant`, `Corvid\FieldDef::TYPE_*` class constants (exact ABI values) |
| consumed-by-call args (pred trees, builders) | `run()` and every aggregate consume the builder; abandoned builders/predicates are freed by their destructors, guarded by consumed flags so the ABI's double-free UB class cannot happen |
| cursors (`rows`, `geohits`, `groupiter`, …) | walked to exhaustion **inside** the producing call — a plain PHP array of decoded `Corvid\Row`/`Corvid\GeoHit`/… objects crosses back; nothing borrowed escapes |
| `corvid_update_fn` / `corvid_scan_fn` | ordinary PHP callables; a throwing callback aborts/stops through the ABI's §1.6 contract with the exception caught at the C trampoline boundary (never unwound through C frames) and re-thrown after the engine call returns |
| strings / bytes / vectors | `string` (UTF-8 text) / `Corvid\Bytes` (binary-safe) / `Corvid\Vector` (f32 array) — plus `Corvid\Values` for the engine-side value interrogations (`type()`, `len()`, `asInt()`, `mapKeys()`, …) |

Documents are plain PHP arrays: an assoc array encodes as the engine's
Map (the document shape; an empty array is an empty Map), a list array
as the engine's Array, `Corvid\Vector` as the f32 embedding, and
`Corvid\Bytes` for binary payloads — `"\x00\xff"` round-trips exactly.
NaN / ±INF / -0.0 cross bit-exact.

## Install

From the pinned release artifacts:

```sh
./fetch.sh                    # fetch + sha256-verify corvid v0.3.2 into deps/current
./scripts/build-ext.sh        # phpize + configure + make (needs PHP 8.3+ dev headers)
php -d extension=ext/corvid/modules/corvid.so examples/quickstart.php
```

Requirements: PHP 8.3+ with dev headers (`phpize`/`php-config`), a C
compiler, `curl` + `shasum`/`sha256sum`. The floor is 8.3 and CI tests
8.4 (latest) + 8.3 (floor), NTS, plus a linux **ZTS** leg running the
identical golden suite — the extension declares no request-scoped
globals at all. Once published, the install story is
`pie install corvid/php-corvid` (PECL/PIE — pending first release; the
repo carries the `package.xml`).

## Lifecycle: CLI, workers, FPM, ZTS

The honest PHP story, ruled in the repo's `docs/PLAN.md`:

- **CLI and long-running workers** (queues, ReactPHP, RoadRunner-style
  persistent workers) are the natural fit — open a `Corvid\Db` once and
  serve unbounded work from it.
- **Under FPM**, handles die with refcount, not with the request: a
  `Db` parked in a global survives request shutdown for as long as
  userland holds a reference. That is a userland decision, documented,
  not policed — there is no extension-owned handle registry to sweep.
- **ZTS** is safe per the ABI's threading rules (`Arc<Db>` sharing),
  and the one sharp edge — the thread-local last-error slot — is closed
  by construction: the failing call and its error read share the
  wrapper's C frame, and a PHP request is pinned to one interpreter
  thread. The CI ZTS leg executes this posture on every run.
- **Callbacks** (`update`, `scan`): do not call back into corvid from
  inside one (the ABI's no-reentrancy contract) — UB or a deadlock,
  not a checked error; documented, not policed.

## The v0.3.0 surface

`Corvid\Values::mapKeys()` walks the engine's §4.4 map-key iterator
(ascending key-byte order; non-maps answer `[]` — inert), and
`Collection::phraseSearch($field, $phrase, $k)` is the direct
positional search — consecutive, in-order analyzed tokens, stop words
collapsing out of adjacency, rows carrying the BM25 phrase score;
`$k === 0` answers `[]`, never an error. The `text_search` example
demonstrates all of it, CJK bigram phrases included.

## The examples

Six runnable programs under the repo's `examples/` directory
(`php -d extension=…/corvid.so examples/<name>.php`), executed on every
CI leg with deterministic output: **quickstart**, **hybrid** (the
flagship below), **vector_index** (in-memory / on-disk /
binary-quantized HNSW vs the exact scan, plus a close/reopen),
**text_search** (BM25 incl. CJK bigram segmentation, plus the v0.3.0
direct `phraseSearch`), **graph** (neighbors/traverse + delete
cascade), and **geo** (radius / bbox / nearest with haversine
kilometres). The quickstart and hybrid sources are embedded below —
imported from the repo so they cannot drift from what CI executes
(`scripts/sync-binding-examples.sh`; the drift gate reddens docs CI if
they diverge).

### Quickstart

<!-- corvid-examples:quickstart BEGIN -->

```php
$db = Corvid\Db::openMemory();
$docs = $db->collection('docs');

$docs->insert('p1', [
    'title' => 'rust embedded database',
    'kind' => 'doc',
    'v' => new Corvid\Vector([1.0, 0.0]),
]);
$docs->insert('p2', [
    'title' => 'python web frameworks',
    'kind' => 'doc',
    'v' => new Corvid\Vector([0.0, 1.0]),
]);
$docs->insert('p3', [
    'title' => 'rust again database',
    'kind' => 'doc',
    'v' => new Corvid\Vector([0.9, 0.1]),
]);

// kNN: the 3 nearest documents to (1, 0) under cosine. The builder
// methods chain; run() consumes the builder and every row carries its
// decoded document.
$rows = $docs->query()
    ->vector('v', new Corvid\Vector([1.0, 0.0]), 3, Corvid\Metric::COSINE)
    ->run();

foreach ($rows as $rank => $r) {
    printf("%d. %s score=%.6f %s\n", $rank + 1, $r->key, $r->score, $r->doc['title']);
}
```

<!-- corvid-examples:quickstart END -->

### Hybrid retrieval

<!-- corvid-examples:hybrid BEGIN -->

```php
$db = Corvid\Db::openMemory();
$docs = $db->collection('docs');

$docs->insert('s1', [
    'kind' => 'doc', 'body' => 'rust embedded database',
    'v' => new Corvid\Vector([1.0, 0.0]),
]);
$docs->insert('s2', [
    'kind' => 'doc', 'body' => 'python web frameworks',
    'v' => new Corvid\Vector([0.0, 1.0]),
]);
$docs->insert('s3', [
    'kind' => 'doc', 'body' => 'rust again database',
    'v' => new Corvid\Vector([0.9, 0.1]),
]);
$docs->insert('m1', ['kind' => 'meta']); // filtered out below

// The flagship query: filter + vector + text, RRF + MMR + limit.
$rows = $docs->query()
    ->filter((new Corvid\Field('kind'))->eq('doc'))
    ->vector('v', new Corvid\Vector([1.0, 0.0]), 2, Corvid\Metric::COSINE)
    ->text('body', 'rust database', 2)
    ->fuseRrf(60.0)
    ->rerankMmr(1.0)
    ->limit(2)
    ->run();

foreach ($rows as $rank => $r) {
    printf("%d. %s score=%.6f %s\n", $rank + 1, $r->key, $r->score, $r->doc['body']);
}
```

<!-- corvid-examples:hybrid END -->

## The correctness floor

PHPUnit (and the direct driver on the ZTS leg) replays the engine's
entire **golden fixture suite** — 267 executable lines across 8 files,
including the v0.3.0 `VMAP_KEYS`/`GET_KEYS` (map-key iteration) and
`PHRASE`/`PHRASE_K0` (direct positional search) lines — against the
**downloaded** cdylib, through this binding's public PHP API: every
counted line must dispatch, the first failure names file:line + OP +
expected-vs-got, and every handle is freed on its creation path. The
fixtures are vendored in the repo and byte-compared against the
release's copies at fetch time, so a bad artifact is a loud fetch
failure, never a silent skip.

On top sits `docs/SURFACE.tsv` — every construct of the engine's public
surface (327 rows at this pin) resolved to the PHP API exposing it plus
the golden line that proves it, or `N/A` with the ABI's §9 reason,
gated in CI (`scripts/surface-gate.sh`).

Next: [the bindings overview](/bindings/overview/).
