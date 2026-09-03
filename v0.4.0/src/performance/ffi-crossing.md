---
title: FFI crossing cost
description: The measured cost of crossing the C ABI — put/get/scan/hybrid-query through the ABI run 0.99-1.02x their native Rust twins; method and reading.
sidebar:
  order: 4
---

The [C ABI](/ffi/overview/) exists so bindings pay "zero parsing, bounded crossing
cost". The engine measured that phrase directly: the same four shapes
through the ABI — a C consumer compiled at bench time against the committed,
drift-gated `corvid.h`, linked against the release cdylib — and natively
in-process in Rust, on identical deterministic corpora (2000 docs of
`{i: int, txt: 4 tokens, vec: [64 × f32]}`).

| Shape (iterations) | FFI (through the ABI) | native Rust | ratio |
|---|---|---|---|
| put — construct + insert (10k) | 20.8 µs/op | 20.9 µs/op | **1.00×** |
| get — point-get + read 1 field (100k) | 1510 ns/op | 1508 ns/op | **1.00×** |
| scan — full 2000-row pass (200) | 883 µs/pass | 896 µs/pass | **0.99×** |
| hybrid — vector+text RRF query, k=10/source, drained (500) | 3.02 ms/query | 2.97 ms/query | **1.02×** |

Confirmation run agreed within ±2% (0.99×/1.00×/0.99×/0.99×).

## Method

Medians of 5 rounds after a discarded warmup; the C child does its own setup
then N iterations; the driver times the whole child and subtracts a
zero-iteration baseline (spawn + setup cancel), so there is no timing code
in C and the file stays portable ISO C. The `put` row includes document
**construction** on both sides — a binding builds a value per call — so it
prices the honest end-to-end path.

## Reading

The crossing cost is invisible at every shape: each call is a plain C-ABI
jump behind engine work that dominates (an insert's transaction, a scan's
decode loop, a hybrid query's candidate fusion). There is no serialization
anywhere on the path by construction — typed handles in, borrowed views out.
The measured bound on "bounded crossing cost" is **≤ ±2%, i.e. noise**.

One consequence: the ABI's exclusion of direct `vector_search`/
`text_search` entry points (see [ABI exclusions](/ffi/stability/)) stays
closed on this evidence — the builder path through the ABI is at parity
with native, so per-call builder overhead cannot be a workload problem at
this scale.

Provenance: Apple M1 Max, rustc 1.91.1, clang 17, release cdylib + `-O2` C
consumer. Single-machine — the claim is the **ratio** column, not the
absolute times.

Next: [the C ABI](/ffi/overview/).
