---
title: Errors and NULL discipline
description: The C ABI error model — status returns, thread-local last error, absence-is-success out-params, message lifetime, and the never-UB NULL rules.
sidebar:
  order: 3
---

## The status channel

- Functions report success/failure with `corvid_status` (`CORVID_OK` /
  `CORVID_ERR`), or with a NULL return where a handle/buffer was expected.
- On failure, the detail is in **thread-local** storage:
  - `corvid_last_error_code()` — one of the 19 codes (0 = nothing failed on
    this thread);
  - `corvid_last_error_message(&len)` — the engine's human-readable text,
    NUL-terminated for convenience.
- **Failure signals are always paired with a freshly recorded last error** —
  a `CORVID_ERR` status or a failure-NULL sets the thread-local code and
  message as its first act.
- **Message lifetime:** valid until the *next failing* corvid call on the
  same thread (or thread exit). Copy it if you need it longer. Successful
  calls do **not** clear the last error — read it immediately after the
  failure that interests you.
- Errors never leave partial side effects Rust would not allow — transactions
  are atomic per call (a `CORVID_ERR` from `corvid_put_many` means the whole
  batch rolled back).
- The engine never panics on user input; the FFI additionally converts any
  residual panic to `CORVID_ERR` + message (defensive, not contract).

## Absence is a success

"Optional value" results — `corvid_get`, `corvid_schema`,
`corvid_query_min`, `corvid_query_max` — use an **out-parameter plus
status**: `CORVID_OK` + `*out = value`, or `CORVID_OK` + `*out = NULL` for
"no such value" (a missing document, an undeclared schema, no comparable
value). Absence is never an error and never signalled by a bare NULL return —
only unambiguous handles/buffers (open, run, constructors, auto-key) return
NULL for failure.

## The NULL discipline (never UB)

- An unexpected NULL — NULL handle, NULL required out-param, NULL data
  pointer with nonzero length — returns `CORVID_ERR` with
  `CORVID_E_ARGUMENT`. **Never UB.**
- **Non-status functions** (no `corvid_status` return):
  `corvid_value_type`, `corvid_value_as_bool/as_int/as_float`,
  `corvid_value_len`, the `_ref` trio, and all five `_next` cursors follow
  the same discipline through a defined inert value — `0` / `*ok = 0` /
  `NULL` pointer / `0` (= exhausted) — **and** record `CORVID_E_ARGUMENT`
  in the thread-local last error. Never UB, never a status return.
- Nullable-by-contract pointers carry semantics:
  `corvid_compare_and_set`'s `expected`/`replacement` (absent / delete),
  `corvid_page`'s `after` (start), `corvid_update`'s `current`/`*out`
  (absent / delete), optional out-params (`existed_out`, `removed_out`,
  `moved_out`, the `len_out`s, `doc_out`).
- Empty (pointer, length 0) is distinct from NULL and legal for keys, names,
  text, bytes, vectors — the engine accepts empty keys and documents.
- `corvid_free(NULL)` and every `_free(NULL)` are no-ops.
- UTF-8-requiring strings with invalid encoding: `CORVID_E_ARGUMENT`
  (checked, copied, never UB).

## The error codes

Codes 1–18 map 1:1 onto the engine's `corvid::Error` variants; 19
(`CORVID_E_BUSY`) is FFI-only (compact-while-derived-handles-open). The full
frozen table with meanings is the generated
[error codes reference](/reference/error-codes/). The mapping is pinned by a
variant-inventory snapshot test — adding, removing, or renaming an engine
variant fails the FFI suite until the mapping is maintained; new variants
append code 20+, never fill a gap.

Next: [lifecycle & collection functions](/ffi/functions-lifecycle/).
