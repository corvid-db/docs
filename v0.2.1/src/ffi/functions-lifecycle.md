---
title: "Functions: lifecycle & values"
description: The C ABI function reference part 1 — lifecycle and errors (8), collection handles (3), value construction (11) and value reads (12), with signatures, semantics and counterparts.
sidebar:
  order: 4
---

Conventions used throughout the function pages: `corvid_status` return
unless stated; `(const char* s, size_t len)` = borrowed, binary-safe,
UTF-8 where the engine takes `&str`; `NULL` pointer with `len > 0` is
`CORVID_E_ARGUMENT`, `NULL` with `len == 0` is empty only where marked
*nullable*; `const corvid_value*` inputs are **CLONED** — the caller keeps
ownership.

## Lifecycle & errors (8)

```c
uint32_t corvid_ffi_version(void);
```
Returns `1`. No engine counterpart — pure ABI versioning. Bindings verify
this before anything else.

```c
corvid_db* corvid_open(const char *path, size_t path_len);
```
Open (creating if absent) a file-backed database. Wraps `Db::open`.
Returns the handle, or NULL + `CORVID_E_DATABASE` /
`CORVID_E_INCOMPATIBLE_FORMAT` / `CORVID_E_IO` (non-UTF-8 paths answer
`CORVID_E_ARGUMENT` — the universal UTF-8 rule).

```c
corvid_db* corvid_open_memory(void);
```
In-memory database. Wraps `Db::open_in_memory`.

```c
corvid_status corvid_close(corvid_db *db);
```
Releases the handle's reference. Persistence is durable per-transaction —
no explicit close/flush exists in the engine either. Freeing the db while
rows/iterators from it are live is fine (they own their data).

```c
corvid_err     corvid_last_error_code(void);
const char*    corvid_last_error_message(size_t *len_out);
```
Thread-local last error — NULL message when none recorded. See
[errors](/ffi/errors/).

```c
void corvid_free(void *ptr);
```
**The ONLY buffer deallocator** — for ABI-returned buffers (`corvid_insert_auto`
keys, `corvid_page`'s `next_after` cursor). Does NOT free handles or values.
`corvid_free(NULL)` is a no-op.

```c
corvid_strs* corvid_collections(corvid_db *db);
```
User collection names (engine `__` namespaces excluded), name order, as a
string cursor. Listing creates nothing (collections are lazy on first write).

## Collection handles (3)

```c
corvid_coll* corvid_collection(corvid_db *db, const char *name, size_t name_len);
void         corvid_collection_free(corvid_coll *coll);
const char*  corvid_collection_name(corvid_coll *coll, size_t *len_out);
```
`corvid_collection` returns NULL only on NULL arguments; reserved/invalid
names fail **at write time** (lazy validation, as in Rust). The name is
BORROWED from the handle until `corvid_collection_free`.

## Value construction (11)

All constructors return an OWNED `corvid_value*` or NULL +
`CORVID_E_ARGUMENT`. Byte/text/vector inputs are **CLONED** into the value.

```c
corvid_value* corvid_value_null(void);
corvid_value* corvid_value_bool(int v);                      /* v != 0 */
corvid_value* corvid_value_int(int64_t v);
corvid_value* corvid_value_float(double v);                  /* NaN/±inf/-0.0 bit-exact */
corvid_value* corvid_value_text(const char *s, size_t len);  /* must be UTF-8 */
corvid_value* corvid_value_bytes(const uint8_t *b, size_t len);
corvid_value* corvid_value_vector(const float *v, size_t dim); /* dim 0 legal */

corvid_value* corvid_value_array_new(void);
corvid_status corvid_value_array_push(corvid_value *arr, corvid_value *item);
corvid_value* corvid_value_map_new(void);
corvid_status corvid_value_map_put(corvid_value *map, const char *key, size_t key_len,
                                   corvid_value *val);
```

- `array_push`/`map_put` **consume** `item`/`val` (ownership moves in; do
  not free them afterwards). Single-threaded mutation of the container.
- A duplicate map key REPLACES the previous entry (last write wins; the
  replaced child is dropped). Map order in the engine is sorted by key —
  construction order never matters.
- Pushing/putting invalidates previously borrowed children of the container
  (see [ownership](/ffi/ownership/)).

## Value reads (12)

```c
corvid_value_type_t corvid_value_type(const corvid_value *v);   /* discriminant */

int      corvid_value_as_bool(const corvid_value *v, int *ok);
int64_t  corvid_value_as_int(const corvid_value *v, int *ok);
double   corvid_value_as_float(const corvid_value *v, int *ok);
```
Wrong type sets `*ok = 0` and returns 0 — **not an error** (mirrors the
Rust `Option` accessors).

```c
const char*    corvid_value_text_ref(const corvid_value *v, size_t *len_out);
const uint8_t* corvid_value_bytes_ref(const corvid_value *v, size_t *len_out);
const float*   corvid_value_vector_ref(const corvid_value *v, size_t *dim_out);
```
Zero-copy BORROWED views. NULL when the value is a different type (not an
error). Valid until the parent value is freed or mutated — writing through
these pointers is UB.

```c
const corvid_value* corvid_value_array_get(const corvid_value *arr, size_t index);
const corvid_value* corvid_value_map_get(const corvid_value *map, const char *key, size_t key_len);
```
BORROWED children; NULL when out of range / absent / wrong container (not an
error). Child lifetime rides the parent — freeing a borrowed child is UB.

```c
size_t        corvid_value_len(const corvid_value *v);   /* items/entries/dims/bytes */
corvid_value* corvid_value_clone(const corvid_value *v); /* deep copy, OWNED */
void          corvid_value_free(corvid_value *v);        /* OWNED values only */
```

`corvid_value_clone` is the sanctioned way to keep data observed through a
borrowed pointer (e.g. a rows document) beyond the parent's lifetime.
`corvid_value_free` on a borrowed child (from `_ref`, `array_get`, `map_get`,
`rows_next`, `geohits_next`, callbacks, or already-consumed push/put inputs)
is **undefined behavior**.

Next: [predicates & queries](/ffi/functions-query/).
