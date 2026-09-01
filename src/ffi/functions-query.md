---
title: "Functions: predicates & queries"
description: The C ABI function reference part 2 — the eleven predicate constructors and combinators (11), the query builder with rows cursors (15), and the direct phrase search (16th of the family since 0.3.0).
sidebar:
  order: 5
---

## Predicates (11)

Ten constructors return an OWNED `corvid_pred*` (NULL + `CORVID_E_ARGUMENT`
on bad input); the combinators **consume** their children. Rust counterparts
are the `corvid::field(path)` fluent builders. Paths are dotted and traverse
nested maps; an empty path resolves nothing.

```c
corvid_pred* corvid_pred_exists(const char *path, size_t path_len);
```
True when the path resolves. Counterpart: `field(path).exists()`.

```c
corvid_pred* corvid_pred_compare(const char *path, size_t path_len,
                                 corvid_cmp op, const corvid_value *value);
```
Compare against a constant (CLONED). Counterpart: `field(path).eq/ne/...`.
Semantics: missing path ⇒ false; unordered kinds under ordered ops ⇒ false;
Int/Float compare numerically across kinds (exact to 2^53); NaN compares
false against everything except `NE`.

```c
corvid_pred* corvid_pred_in(const char *path, size_t path_len,
                            const corvid_value *const *values, size_t count);
corvid_pred* corvid_pred_between(const char *path, size_t path_len,
                                 const corvid_value *low, const corvid_value *high);
corvid_pred* corvid_pred_starts_with(const char *path, size_t path_len,
                                     const char *prefix, size_t prefix_len);
corvid_pred* corvid_pred_contains(const char *path, size_t path_len,
                                  const char *substr, size_t substr_len);
```
`is_in` (each element CLONED; empty list matches nothing), inclusive
`between`, and the two text predicates (false on non-text values and missing
paths).

```c
corvid_pred* corvid_pred_geo_within(const char *path, size_t path_len,
                                    double lat, double lon, double radius_km);
```
Path holds a point within `radius_km` (inclusive, haversine). Counterpart:
`field(path).within_km(...)`.

```c
corvid_pred* corvid_pred_and(corvid_pred *a, corvid_pred *b);
corvid_pred* corvid_pred_or(corvid_pred *a, corvid_pred *b);
corvid_pred* corvid_pred_not(corvid_pred *a);
void         corvid_pred_free(corvid_pred *p);
```
Combinators **consume their argument(s)** and return a new root — after a
combine, the children belong to the tree. `corvid_pred_free` frees a
**never-consumed root only**: predicates handed to and/or/not,
`corvid_query_filter`, or `corvid_delete_where` are consumed and must not be
freed (double free = UB).

## Query builder, rows & direct phrase search (16)

A query is built on a `corvid_query*` (single-threaded) and executed by
`corvid_query_run` or any aggregate, **either of which consumes it**
(mirroring the Rust builder taking `self`).

```c
corvid_query* corvid_query_new(corvid_coll *coll);            /* Collection::query() */

corvid_status corvid_query_filter(corvid_query *q, corvid_pred *pred);
```
Add a filter — **CONSUMES `pred`**. Multiple calls AND together.

```c
corvid_status corvid_query_vector(corvid_query *q, const char *field, size_t field_len,
                                  const float *query, size_t dim, size_t k,
                                  corvid_metric metric);
corvid_status corvid_query_text(corvid_query *q, const char *field, size_t field_len,
                                const char *s, size_t s_len, size_t k);
```
Add a vector source (query CLONED) / a BM25 text source.

```c
corvid_status corvid_query_fuse_rrf(corvid_query *q, float k);      /* default 60 */
corvid_status corvid_query_rerank_mmr(corvid_query *q, float lambda); /* [0,1] */
```
The setters always succeed; the engine validates at execution (a
non-positive/NaN k or out-of-range lambda fails run/aggregates with
`CORVID_E_ARGUMENT`).

```c
corvid_status corvid_query_approx(corvid_query *q);
corvid_status corvid_query_limit(corvid_query *q, size_t n);
corvid_status corvid_query_offset(corvid_query *q, size_t n);
corvid_status corvid_query_order_by(corvid_query *q, const char *field, size_t field_len,
                                    int descending);
corvid_status corvid_query_select(corvid_query *q, const char *const *fields,
                                  const size_t *field_lens, size_t count);
```
`limit 0` yields empty; `offset` applies after ordering, before limit. The
ordering contract is the engine's class rule (comparable → incomparable →
missing, ties by key; `descending` reverses within-class order only — see
[ordering](/language/ordering/)). `select` projects result documents
(missing fields absent; non-map documents pass through; ranking sees the
full document).

```c
corvid_rows* corvid_query_run(corvid_query *q);
```
Execute — **CONSUMES `q`**. Returns a rows cursor even for an empty result
(distinguish failure by `CORVID_ERR`); NULL + error on failure. One MVCC
snapshot covers the query; ranking parameters validate here.

```c
void corvid_query_free(corvid_query *q);
```
For builders abandoned without running — NOT after run/aggregates.

```c
int corvid_rows_next(corvid_rows *rows,
                     const uint8_t **key_out, size_t *key_len_out,
                     const corvid_value **doc_out, float *score_out);
void corvid_rows_free(corvid_rows *rows);
```
Advance: 1 and fill out-params, 0 at exhaustion (never errors — the result
is materialized). The key and document are **BORROWED from the cursor:
valid only until the next `corvid_rows_next` or `corvid_rows_free`** —
using or freeing them after is UB; `corvid_value_clone` copies what you keep.
`score` is the producing call's ranking: the fused RRF score for
`corvid_query_run` (`0.0` for pure filter/order queries), the BM25 phrase
score for `corvid_phrase_search`, `0.0` for `corvid_page` rows.

```c
corvid_rows* corvid_phrase_search(corvid_coll *c, const char *field, size_t field_len,
                                  const char *phrase, size_t phrase_len, size_t k);
```
DIRECT positional text search — no query handle, one call over the
collection (added in 0.3.0; wraps `Collection::phrase_search`). Documents
whose `field` TEXT contains `phrase` as a consecutive, IN-ORDER run of
analyzed tokens, most relevant first, ties by key, up to `k` rows. The
engine's analysis applies to the phrase too, and stop words collapse out of
adjacency on both sides — `"embedded the database"` matches text containing
`"embedded database"`. Documents lacking the field or holding a non-text
value there are not part of the corpus. `k == 0` yields an empty cursor
(inert — the `geo_nearest`/`page` convention, not an error); larger `k`
just caps. Returns an OWNED rows cursor whose `score` is the hit's BM25
relevance (the sum over the phrase's analyzed terms — `TextHit::score`,
not the builder's fused RRF scale). One MVCC snapshot covers the search.
NULL `c`/`field`/`phrase`, or invalid UTF-8 in either string, answers
NULL + `CORVID_E_ARGUMENT`.

Next: [aggregations & mutations](/ffi/functions-data/).
