---
title: Quantization guidance
description: The measured quantization decision — binary's 50.8x scan win, PQ's storage/time premiums, the SIMD closure verdict, and zstd's vector-blindness.
sidebar:
  order: 3
---

The compression/time/recall trade with the engine's measured tables. Method
and caveats: [reading these numbers](/performance/overview/).

## The volume lever: Binary quantization

Same 2,000×768d corpus, same graph params, cosine, k=10, ef=64:

| Storage | search | vs None |
|---|---|---|
| None (f32) | 239.8 µs | — |
| **Binary** (96 packed bytes; Hamming) | 4.72 µs | **50.8× faster** |
| Scalar (reconstruct to f32) | 306.8 µs | 1.28× slower |

Binary's packed-byte Hamming path is the throughput answer for big corpora
(~32× less traffic *and* a cheaper kernel). Scalar pays a per-evaluation
decode (with allocation) and lands *slower* than full precision at this
dimension — compression is not automatically speed.

## PQ's premiums (2000×64d, m=16, k=256)

| | None (f32) | PQ | premium |
|---|---|---|---|
| hnsw build | 124.9 ms | 367.9 ms | 2.9× slower |
| hnsw search | 19.1 µs | 35.8 µs | 1.9× slower |
| vector payload | 256 B/doc | 16 B/doc | **16× smaller** |

Recall margins (pinned): public path (`vector_search`, over-fetch + exact
rerank) measures **1.0** (floor ≥0.7); the direct `Hnsw` API corpus measures
0.56, identical at ef 100/200/400 (floor ≥0.55 — the thin margin is
deliberate; the corpus is deterministic so the value cannot drift). The
residual gap is codebook resolution, not graph reach.

## Why not faster kernels: the SIMD closure (measured)

LLVM already auto-vectorizes `dot`/`l2_squared` 4-wide (verified in release
assembly). Hot kernels hold 62–83% of the same-shape read ceiling across
64–3072 dimensions with no small-dim cliff. The measured "faster" shapes:

| 768d | time | vs shipped |
|---|---|---|
| shipped dot (8 lanes) | 78.15 ns | — |
| 16 accumulator lanes | 55.36 ns | −29% — **declined** (changes f32 summation order → not bit-identical) |
| `mul_add` (fused) | 97.01 ns | +24% slower AND de-vectorized |

Every faster shape reassociates `f32` summation, which the bit-exactness
oracle (recall floors, reproducible codebooks, twin-build equality) declines.
Volume scans are memory-side anyway: beyond cache, scans hold 41–42 GB/s
against a 43–58 GB/s streaming band — a 29%-faster kernel cannot lift a
DRAM-resident scan past it. **The available throughput lever already ships:
Binary quantization, 50.8× at 768d.**

## zstd is not a vector feature

| Payload | Ratio |
|---|---|
| Structured text document | **12×** (8.3% of raw) |
| f32 vector payload (even smooth values) | ~1.1× — barely compresses |

IEEE-754 mantissas are near-full entropy; if you need smaller vectors, the
levers are Binary/Scalar/PQ, not zstd (which is a text/document play — see
[feature flags](/admin/features/)).

## Decision summary

1. `None` until footprint/throughput forces a choice.
2. Volume scans → **Binary**.
3. Tight RAM/disk budget → **PQ** (validate recall on your corpus).
4. Scalar only with a measurement on your dimension.
5. Text documents too big → `zstd` feature (not for vectors).

Next: [FFI crossing cost](/performance/ffi-crossing/).
