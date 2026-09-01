---
title: "Performance: reading these numbers"
description: How to read corvid's benchmark record — the machine, method, provenance rules, the no-regression guard, and single-machine caveats.
sidebar:
  order: 0
---

corvid's performance story is a **durable record**, not marketing: every
"before/after" number of the optimization programs is committed in the
engine repo (docs/BENCHES.md), with provenance, and a standing bench rule:

> No existing bench regresses beyond noise (>5%), and no "faster" claim
> without a before/after table whose provenance is stated.

This section restructures that record as prose and tables. The caveats
apply to everything here:

## Machine and method

- **Machine:** Apple M1 Max (MacBookPro18,2), Darwin arm64, 32 GiB.
- **Toolchain:** rustc 1.91.1; MSRV 1.88.
- **Method:** `cargo bench -p corvid --bench engine` (criterion, bench
  profile, in-memory `Db`, deterministic corpora — seeded index math, no
  `rand`).
- Numbers are criterion **means with 95% CI** unless a table says median.
- **Single-machine numbers: compare relatively, not absolutely.** Your
  hardware, corpus, and dimensions will differ; the *shape* (constant vs
  linear, indexed vs scan) is what transfers.

## Reading conventions in these tables

- "BEFORE provenance" — where the before number came from. Some benches were
  backported to the pre-change tree in a throwaway worktree (the bench did
  not exist at the base).
- "suite context" vs "isolated" — a bench run inside the full suite measures
  differently from one run alone (machine state, cache); multi-hundred-ms
  delete-path benches sit a few percent higher in suite context, documented
  and re-probed.
- "RATIFIED" — a regression accepted as a permanent, deliberate trade by
  explicit decision (e.g. the link/edge-cascade trade in
  [numbers](/performance/numbers/)).

## Where to go

- [Numbers](/performance/numbers/) — the current full-suite baseline table
  and the program's before/after deltas.
- [Scaling](/performance/scaling/) — how operations behave at 1k / 100k /
  1M / 50M, and which wall each index family removes.
- [Quantization guidance](/performance/quantization-guidance/) — the
  compression/time/recall trade with the measured tables.
- [FFI crossing cost](/performance/ffi-crossing/) — proof the C ABI adds
  nothing measurable over native Rust.

Next: [the numbers](/performance/numbers/).
