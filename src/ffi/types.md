---
title: Types and enums
description: The C ABI's POD types — corvid_kv, corvid_field_def, corvid_geohit, the frozen enums (status, err, cmp, metric, quant, value types, field types) and the corvid_value_type_t naming.
sidebar:
  order: 1
---

## Opaque handles (10 types)

Every handle is an opaque, single-pointer-sized forward-declared struct —
see [handles](/ffi/handles/):

```c
typedef struct corvid_db        corvid_db;
typedef struct corvid_coll      corvid_coll;
typedef struct corvid_value     corvid_value;
typedef struct corvid_pred      corvid_pred;
typedef struct corvid_query     corvid_query;
typedef struct corvid_rows      corvid_rows;
typedef struct corvid_strs      corvid_strs;
typedef struct corvid_geohits   corvid_geohits;
typedef struct corvid_groupiter corvid_groupiter;
typedef struct corvid_schemaiter corvid_schemaiter;
```

## POD structs

```c
/* One (key, value) pair for bulk inserts (corvid_put_many). */
typedef struct corvid_kv {
    const uint8_t    *key;     /* non-NULL; may point at empty (len 0) */
    size_t            key_len; /* bytes */
    const corvid_value *val;   /* non-NULL; CLONED by the call, caller keeps ownership */
} corvid_kv;

/* One declared schema field (corvid_set_schema input, schemaiter output). */
typedef struct corvid_field_def {
    const char       *name;    /* non-NULL for inputs; BORROWED when filled by schemaiter_next */
    corvid_field_type type;
    int               required; /* 0 or 1 */
    int               unique;   /* 0 or 1 */
} corvid_field_def;

/* One geospatial / weighted hit (corvid_geohits_next output). */
typedef struct corvid_geohit {
    const uint8_t *key;        /* BORROWED until the next geohits_next or geohits_free */
    size_t         key_len;
    double         distance_km; /* geo: km from the query point;
                                   neighbors_weighted: the edge weight;
                                   geo_within_bbox: 0.0 sentinel (no center). */
} corvid_geohit;
```

## Status and error enums (frozen)

```c
typedef enum corvid_status {
    CORVID_OK  = 0,  /* success */
    CORVID_ERR = 1   /* failure; detail in corvid_last_error_code/message */
} corvid_status;
```

`corvid_err` — the detailed codes returned by `corvid_last_error_code()` —
maps 1:1 onto the engine's error variants (codes 1–18), plus one FFI-only
code (19). Value 0 means "no error recorded on this thread". **Never
renumber**; see the full table on [error codes](/reference/error-codes/) and
the error model on [errors](/ffi/errors/).

## Domain enums (frozen, values mirror engine discriminants)

```c
typedef enum corvid_cmp {          /* mirrors corvid::CmpOp */
    CORVID_CMP_EQ = 0, CORVID_CMP_NE = 1, CORVID_CMP_LT = 2,
    CORVID_CMP_LE = 3, CORVID_CMP_GT = 4, CORVID_CMP_GE = 5
} corvid_cmp;

typedef enum corvid_metric {       /* mirrors corvid::Metric */
    CORVID_METRIC_COSINE = 0,      /* 1 - cos_sim, [0,2]; zero-norm = maximally distant */
    CORVID_METRIC_DOT    = 1,      /* negated dot product (larger dot sorts first) */
    CORVID_METRIC_L2     = 2       /* squared Euclidean (monotonic with L2) */
} corvid_metric;

typedef enum corvid_quant {        /* mirrors corvid::Quantization */
    CORVID_QUANT_NONE   = 0,       /* full f32 (dim*4 bytes/vector) */
    CORVID_QUANT_BINARY = 1,       /* 1 bit/dim (sign), Hamming; ~32x smaller */
    CORVID_QUANT_SCALAR = 2        /* 8-bit per-vector min+scale; ~4x smaller */
} corvid_quant;

typedef enum corvid_value_type_t { /* tags 0..8, identical to the value codec */
    CORVID_TYPE_NULL = 0, CORVID_TYPE_BOOL = 1, CORVID_TYPE_INT = 2,
    CORVID_TYPE_FLOAT = 3, CORVID_TYPE_TEXT = 4, CORVID_TYPE_BYTES = 5,
    CORVID_TYPE_ARRAY = 6, CORVID_TYPE_MAP = 7, CORVID_TYPE_VECTOR = 8
} corvid_value_type_t;

typedef enum corvid_field_type {   /* mirrors schema FieldType (0..8) */
    CORVID_FIELD_ANY = 0, CORVID_FIELD_BOOL = 1, CORVID_FIELD_INT = 2,
    CORVID_FIELD_FLOAT = 3, CORVID_FIELD_TEXT = 4, CORVID_FIELD_BYTES = 5,
    CORVID_FIELD_VECTOR = 6, CORVID_FIELD_ARRAY = 7, CORVID_FIELD_MAP = 8
} corvid_field_type;
```

## The `corvid_value_type_t` naming erratum

ISO C forbids one identifier from being both a typedef and a function in the
same scope — and the locked function `corvid_value_type` (§4.4) collides
with the enum type's original spelling. Resolution: the **function** name
`corvid_value_type` and the member values (`CORVID_TYPE_NULL..=VECTOR`,
frozen 0..=8) are unchanged; in the generated `corvid.h` the type's typedef
**and** enum tag are spelled `corvid_value_type_t`. C sources write
`corvid_value_type_t` for the type. (Discovered by compiling the C smoke
suite — the pre-fix header did not compile as C at all.)

## Strings, keys, lengths

- Binary-safe pointer+length; **not** NUL-terminated; empty = non-NULL
  pointer, length 0.
- Names/paths/relations/text must be UTF-8 (`CORVID_E_ARGUMENT` otherwise);
  keys and `Bytes` payloads arbitrary.
- Name rules are the engine's: no NUL byte, no `__` anywhere
  (`CORVID_E_INVALID_NAME`), no leading `__` (`CORVID_E_RESERVED_COLLECTION`).
  The empty name is legal. Violations surface on the first write/definition
  call — handles never validate on creation.

Next: [handles](/ffi/handles/).
