---
title: Changelog highlights
description: Release highlights for corvid and its ecosystem — v0.1.0, v0.1.1, v0.2.0, v0.2.1, v0.3.0, v0.3.1 — inlined here, self-contained.
sidebar:
  order: 1
---

Highlights per release, inlined below so this page stands alone (condensed
at release time from the engine repository's
[CHANGELOG](https://github.com/corvid-db/corvid/blob/master/CHANGELOG.md) —
provenance only; everything you need to evaluate a release is here). Until
1.0, the API and on-disk format change without backward-compatibility
guarantees; format changes migrate via [dump/load](/admin/dump-load/).

## v0.3.1 (2026-09)

**Header-only fix: `corvid.h` is portable C11/C++.** The generated header
had been wrapping every frozen enum in C23 fixed-underlying-type guards
(`#if __STDC_VERSION__ >= 202311L` + `: uint32_t`), whose pre-C23
fallback (`typedef uint32_t corvid_status;` beside the enum tag) is
ill-formed C++ — the tag and the typedef share a namespace there. Found
by corvid-cpp (the C++ binding), which had to preprocessor-mask the
guards in its ABI translation units. The header now emits the plain
`typedef enum { ... } corvid_xxx;` the FFI spec has always shown —
valid C11, C23, and every C++ standard; verified by compiling a trivial
TU both ways against the published artifact's header. Values,
signatures, and the 124-symbol surface are unchanged; the Rust-side
`#[repr(u32)]` wire-type pin is untouched; `FFI_VERSION` and the soname
stay at 1. C++ consumers drop their workarounds at the next pin;
existing v0.3.0 pins keep working (the C-level surface did not move).

## v0.3.0 (2026-09)

**The C ABI's first additive expansion** — no engine storage or query
changes; two new FFI symbols (Appendix A 122 → 124), both inside
`FFI_VERSION = 1`:

- **`corvid_value_map_keys`** — a map's keys as a string cursor in
  ascending key-byte order (non-maps answer an empty cursor, inert).
  Bindings could previously read a map's values only by known key; key
  enumeration needed a candidate-key oracle.
- **`corvid_phrase_search`** — the direct positional text search
  (consecutive in-order analyzed tokens; stop words collapse out of
  adjacency; most relevant first, ties by key) returning a rows cursor
  whose score is the hit's BM25 phrase sum. `k == 0` answers an empty
  cursor. The query builder's `.text` source stays bag-of-words — phrase
  semantics had no ABI path before this.
- Golden fixtures gained executable lines (map-key enumeration, phrase
  cases) — bindings re-vendor `golden/` at their pin bump. No signature,
  enum value, or behavior change; the soname and `FFI_VERSION` stay at 1.

## v0.2.1 (2026-08)

**Fixes to the v0.2.0 release artifacts** — no engine/API changes:

- darwin dylib install name is `@rpath/libcorvid.dylib` and the Linux `.so`
  carries its SONAME — the v0.2.0 artifacts were unloadable by external
  consumers (found by corvid-c; verified in-pipeline).

## v0.2.0 (2026-08)

The big one — the C ABI, plus a hardening/roadmap-execution program:

- **The C ABI** (`corvid-ffi`): a 122-symbol typed cdylib +
  generated `corvid.h`, `FFI_VERSION = 1` locked contract, golden fixtures,
  C smoke suite (122/122 symbols), header drift gate, 3-OS release CI,
  ASan/UBSan/LSan job (zero leaks), per-platform release archives. Documents
  through value handles — no parsing anywhere; measured at parity with
  native Rust (0.99–1.02×).
- **CJK text search**: sliding-bigram tokenization for Han + kana runs
  (dictionary-free), phrase-order-correct (`東京タワー` matches,
  `タワー東京` doesn't); stemming/folding never apply to CJK. Re-create
  pre-existing text indexes.
- **New sketches**: `CuckooFilter` (deletable membership, rollback-on-full),
  `TDigest` (streaming quantiles/CDF), `MinHash` + `LshIndex` (set
  similarity + candidate lookup).
- **In-memory PQ** (`create_vector_index_pq`) with the persisted codebook;
  parallel PQ training (2.6–4.1×, bit-identical codebooks).
- **Dump format v2** (u64 length prefixes; loader accepts v1 and v2);
  `load_with_renames` for legacy `__`-containing names.
- **zstd feature** (transparent document compression ≥1 KiB, ~12× on text)
  and **tracing feature** (structured events: backfill, compaction, plan
  shapes, semantic cache).
- **Durability/consistency program**: single-snapshot queries/aggregations/
  traverse/page; O(degree) graph-edge cascades via derived adjacency
  (ratified link trade); crash-safe index creation with resume; compound
  prefix-only windows (`all_docs_indexed`); sort indexes (`SortIndex`);
  density-driven verify batching; exact-rerank ANN hits (`Hit.approximate`);
  `plan_shape()`/`PlanShape`; semantic CAS equality (NaN/−0.0); name
  validation (no interior `__`/NUL — breaking); antimeridian bbox + geo
  validation; execution-time RRF/MMR/BM25 argument validation; order_by
  class rules (audit C4); auto-compaction of on-disk vector indexes;
  `Store::begin_bulk` thread-local bulk scopes.

## v0.1.1 (2026-05)

- Release workflow builds `corvid-mcp` for all desktop/server platforms
  (Linux x86_64/aarch64, macOS Intel/Apple Silicon, Windows x86_64).

## v0.1.0 (2026-05)

The first release — the embedded engine complete:

- Transactional KV over redb; typed `Value` model with deterministic codec;
  document layer with fluent `Collection` handles, `insert_auto` ordered
  keys.
- Vector search (cosine/dot/L2, exact KNN + persistent HNSW, `.approx()`
  filtered-ANN path), BM25 full-text with incremental inverted indexes,
  phrase/positional search, CJK-ready tokenizer with S-stemmer.
- The multi-modal query builder: filter + vector + text + RRF + MMR +
  order_by/offset + select + limit; aggregations global and grouped;
  keyset pagination; selectivity-driven index choice; identity-hashable
  `QueryPlan`/`PlanCache`; bounded ranked execution.
- Indexes: scalar, compound, text (in-RAM + on-disk), geo, on-disk HNSW
  (quantized variants), on-disk PQ.
- Graph (`link`/`neighbors`/`traverse`), geo (radius/bbox/k-nearest),
  joins, semantic cache, reactive change feeds, sketches (HLL + Bloom),
  TTL, schemas with unique constraints.
- Operations: online backup, logical dump/load, compaction, bulk load;
  MCP sidecar over stdio; on-disk format version marker; WASM
  (wasm32 engine + 0.2 MB harness), iOS/Android cross-compiles.
- Autovectorized distance kernels under `#![forbid(unsafe_code)]`.
