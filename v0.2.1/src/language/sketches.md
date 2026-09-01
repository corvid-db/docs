---
title: Probabilistic sketches
description: corvid's sketch family — HyperLogLog, BloomFilter, CuckooFilter, TDigest, MinHash and LshIndex — deterministic, dependency-free approximate data structures.
sidebar:
  order: 10
---

corvid ships six probabilistic data structures with one shared posture:
**deterministic, zero dependencies** — std's `DefaultHasher`, no `rand` — so
identical inputs produce identical sketches. Use them for cardinality,
membership, quantiles, and set similarity at sub-linear memory.

## HyperLogLog — approximate distinct count

```rust
use corvid::HyperLogLog;

let mut hll = HyperLogLog::new();          // or with_precision(bits)
hll.add_bytes(b"user-1");
hll.add_hash(h);                            // precomputed-hash twin
let approx_unique = hll.estimate();         // f64
```

Precision clamps to a sane range; duplicates are ignored; small counts are
near-exact. `Collection::approx_distinct(field)` applies it to a field of a
collection in one call.

## BloomFilter — membership, no deletions

```rust
use corvid::BloomFilter;

let mut bloom = BloomFilter::new(10_000, 0.01);   // expected items, fp rate
bloom.add_bytes(b"seen");
let maybe = bloom.contains_bytes(b"seen");        // true (never a false negative)
```

No false negatives for admitted items; false positives bounded by the
configured rate.

## CuckooFilter — membership **with deletion**

```rust
use corvid::CuckooFilter;

let mut cuckoo = CuckooFilter::new(10_000, 0.01);
cuckoo.add_bytes(b"session-7");
assert!(cuckoo.contains_bytes(b"session-7"));
cuckoo.delete_bytes(b"session-7");   // really gone — only delete what you added
```

Deletion is the differentiator vs Bloom. One deliberate divergence from the
paper, pinned by conformance tests: when the table exhausts its displacement
budget, `add_bytes` returns `false` and the whole eviction chain **rolls
back** — a rejected insert leaves the filter byte-identical (the paper's
variant silently drops a previously admitted item). `false` therefore means
"the filter is full", and older items stay admitted.

## TDigest — streaming quantiles

```rust
use corvid::TDigest;

let mut td = TDigest::new(100.0);            // compression
for latency in [12.0, 45.0, 51.0, 80.0] { td.add(latency); }
let p99 = td.quantile(0.99);                 // Option<f64>; 0.0/1.0 exact min/max
let cdf = td.cdf(50.0);                      // monotone
let merged = TDigest::merge(&[td, other]);   // merge algebra
```

NaN and ±infinity observations are rejected. Deterministic given a fixed
add/merge history.

## MinHash + LshIndex — set similarity and candidate lookup

```rust
use corvid::{MinHash, LshIndex};

let mh = MinHash::new(64);
let sig_a = mh.signature(&[b"tag:x", b"tag:y", b"tag:z"]);
let sig_b = mh.signature(&[b"tag:y", b"tag:z", b"tag:w"]);
let similarity = MinHash::jaccard_estimate(&sig_a, &sig_b);  // ~0.5

let mut lsh = LshIndex::new(16, 4);   // bands × rows = signature length
lsh.insert(b"doc-a", &sig_a);
let similar = lsh.candidates(&sig_b); // keys sharing a full band
```

`jaccard_estimate` is exactly `1.0` for identical sets, `0.0` for disjoint
ones, `None` on length mismatch. Banding trades recall for precision along
the `1 − (1 − J^rows)^bands` curve.

## When to use what

| Question | Tool |
|---|---|
| "How many distinct values?" | `HyperLogLog` / `approx_distinct` |
| "Have I ever seen X?" (no deletes) | `BloomFilter` |
| "Have I seen X, and can I forget it?" | `CuckooFilter` |
| "What's the p99 of this stream?" | `TDigest` |
| "Which sets look similar?" | `MinHash` + `LshIndex` |

The sketches are host-side structures — they live outside the database file
(not persisted), which is why the C ABI excludes them from v1 (see
[ABI exclusions](/ffi/stability/)).

Next: the [semantic cache](/language/semantic-cache/).
