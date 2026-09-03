---
title: "Functions: reads & indexes"
description: The C ABI function reference part 4 — reads (get, scan, page, len) and the indexes & schema family (scalar, compound, text, geo, six vector variants, set_schema, schema iterator).
sidebar:
  order: 7
---

## Reads (4)

```c
corvid_status corvid_get(corvid_coll *c, const uint8_t *key, size_t key_len,
                         corvid_value **out);
```
Fetch and decode — `*out` receives an OWNED value. Absence is a success:
`CORVID_OK` + `*out == NULL` for a missing key.

```c
corvid_status corvid_scan(corvid_coll *c, corvid_scan_fn fn, void *ctx);
```
Stream every `(key, document)` in key order to the callback — constant
memory. The callback returns 1 to continue, 0 to stop (stopping is not an
error); `key`/`doc` are borrowed, valid only inside the callback. Callbacks
must not make reentrant corvid calls.

```c
corvid_status corvid_page(corvid_coll *c, const uint8_t *after, size_t after_len,
                          size_t limit, corvid_rows **rows_out,
                          uint8_t **next_after_out, size_t *next_after_len_out);
```
Keyset pagination: up to `limit` documents in key order strictly after
`after`, from one MVCC snapshot. `after == NULL` is the ONLY start form —
it begins at the very first key, the legal empty key `b""` included; a
non-NULL `after` of ANY length — including 0 — is the exclusive
continuation cursor (strictly after those bytes), so a page boundary
landing on `b""` hands back a zero-length cursor that, fed back,
continues the walk instead of restarting it (v0.3.2's §4.9 erratum; a
fresh start must pass NULL, never an empty non-NULL buffer).
`*rows_out` is an owned rows cursor (score 0.0). `*next_after_out` is the
resume cursor — **free it with `corvid_free`** — or NULL with length 0 at
the end. `limit == 0` returns empty rows and no cursor. (Filtered
pagination `page_where` composes from `query().filter()`; not exposed in
v1.)

```c
corvid_status corvid_len(corvid_coll *c, size_t *out);
```
Document count, O(1) maintained counter.

## Indexes & schema (15)

Every create is create-or-replace (re-creating rebuilds); all validate
names (`CORVID_E_RESERVED_COLLECTION` / `CORVID_E_INVALID_NAME`) and
persist across reopen. Semantics mirror the engine — see
[indexes](/indexes/overview/).

```c
corvid_status corvid_create_scalar_index(corvid_coll *c, const char *field, size_t field_len);
corvid_status corvid_create_compound_index(corvid_coll *c,
                                           const char *const *fields,
                                           const size_t *field_lens, size_t count);
corvid_status corvid_create_text_index(corvid_coll *c, const char *field, size_t field_len);
corvid_status corvid_create_text_index_ondisk(corvid_coll *c, const char *field, size_t field_len);
corvid_status corvid_create_geo_index(corvid_coll *c, const char *field, size_t field_len);
```

The six HNSW variants, 1:1 with the engine:

```c
corvid_status corvid_create_vector_index(corvid_coll *c, const char *field, size_t field_len,
                                         corvid_metric metric);
corvid_status corvid_create_vector_index_quantized(corvid_coll *c, const char *field, size_t field_len,
                                                   corvid_metric metric, corvid_quant quant);
corvid_status corvid_create_vector_index_ondisk(corvid_coll *c, const char *field, size_t field_len,
                                                corvid_metric metric);
corvid_status corvid_create_vector_index_ondisk_quantized(corvid_coll *c, const char *field, size_t field_len,
                                                          corvid_metric metric, corvid_quant quant);
corvid_status corvid_create_vector_index_pq(corvid_coll *c, const char *field, size_t field_len,
                                            corvid_metric metric, size_t m, size_t k);
corvid_status corvid_create_vector_index_ondisk_pq(corvid_coll *c, const char *field, size_t field_len,
                                                   corvid_metric metric, size_t m, size_t k);
```

PQ arity is `(field, metric, m, k)` — `m` subspaces × `k` centroids,
`dim % m == 0`. PQ creates fail with `CORVID_E_EMPTY_INDEX_TRAINING` when
there are no usable training vectors, and (the training domain checks fold
into the same error) also for `m == 0`, `k` outside `2..=256`,
`dim % m != 0`, zero-dimensional or mixed-dimension training vectors.

```c
corvid_status corvid_set_schema(corvid_coll *c, const corvid_field_def *fields, size_t count);
corvid_status corvid_schema(corvid_coll *c, corvid_schemaiter **out);
int           corvid_schemaiter_next(corvid_schemaiter *it, corvid_field_def *out);
void          corvid_schemaiter_free(corvid_schemaiter *it);
```
`set_schema` declares (or replaces) the schema — enforced on subsequent
writes only (existing documents are not retroactively validated).
`corvid_schema` absence is a success (`CORVID_OK` + `*out == NULL` when
undeclared). The iterator yields fields in declaration order;
`out->name` is BORROWED until the next call or free.

Next: [graph & geo](/ffi/functions-graph-geo/).
