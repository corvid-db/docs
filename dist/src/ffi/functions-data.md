---
title: "Functions: aggregations & mutations"
description: The C ABI function reference part 3 — the eleven aggregation functions consuming the query, and the thirteen mutation functions (insert, put_many, insert_auto, update, patch, CAS, deletes, TTL).
sidebar:
  order: 6
---

## Aggregations (11)

Every aggregate **consumes the query** and executes on one read snapshot
over the filtered set — sources, ranking, limit/offset/select are ignored.

```c
corvid_status corvid_query_count(corvid_query *q, size_t *out);
```
O(1) when unfiltered (maintained counter).

```c
corvid_status corvid_query_count_distinct(corvid_query *q,
                                          const char *field, size_t field_len,
                                          size_t *out);
```
Distinct values by the canonical group key (text bare; int/float/bool
type-tagged; missing/containers ignored).

```c
corvid_status corvid_query_sum(corvid_query *q, const char *field, size_t field_len,
                               double *out);
corvid_status corvid_query_avg(corvid_query *q, const char *field, size_t field_len,
                               double *out, int *has_value);
```
Missing/non-numeric skipped; `avg` sets `*has_value = 0` when no numeric
values existed.

```c
corvid_status corvid_query_min(corvid_query *q, const char *field, size_t field_len,
                               corvid_value **out);
corvid_status corvid_query_max(corvid_query *q, const char *field, size_t field_len,
                               corvid_value **out);
```
Min/max comparable value, as an **OWNED** value handle. Absence is a
success: `CORVID_OK` + `*out == NULL` when no comparable value exists.

```c
corvid_groupiter* corvid_query_group_count(corvid_query *q,
                                           const char *field, size_t field_len);
corvid_groupiter* corvid_query_group_sum(corvid_query *q,
                                        const char *group_field, size_t group_field_len,
                                        const char *value_field, size_t value_field_len);
corvid_groupiter* corvid_query_group_avg(corvid_query *q,
                                        const char *group_field, size_t group_field_len,
                                        const char *value_field, size_t value_field_len);
int  corvid_groupiter_next(corvid_groupiter *it,
                           const char **key_out, size_t *key_len_out,
                           double *value_out);
void corvid_groupiter_free(corvid_groupiter *it);
```
`(group key, value)` pairs in ascending group-key byte order. `group_count`'s
value is exact in a `double` up to 2^53. Group keys use the canonical
tagged form.

## Mutations (13)

All wrap `corvid::Collection` methods; document inputs are CLONED.

```c
corvid_status corvid_insert(corvid_coll *c, const uint8_t *key, size_t key_len,
                            const corvid_value *doc);
corvid_status corvid_put_many(corvid_coll *c, const corvid_kv *items, size_t count);
```
`put_many` is the bulk fast path — one commit instead of N; whole batch
rolls back on schema/unique violation; duplicates follow last-write-wins.

```c
uint8_t* corvid_insert_auto(corvid_coll *c, const corvid_value *doc,
                            size_t *key_len_out);
```
Fresh zero-padded 20-digit key; the key bytes are returned — **free with
`corvid_free`**. NULL + error on failure (a failed insert does not burn an
id).

```c
corvid_status corvid_update(corvid_coll *c, const uint8_t *key, size_t key_len,
                            corvid_update_fn fn, void *ctx);
```
Read-modify-write via callback: `fn` receives the current document
(borrowed; NULL when absent — not an error) and produces the replacement
(owned, consumed) or a deletion (`*out = NULL`). A non-`CORVID_OK` return
aborts with `CORVID_E_ARGUMENT` and nothing is written. **Not linearizable**
against concurrent writers — use CAS when that matters. Callbacks must not
make reentrant corvid calls.

```c
corvid_status corvid_patch(corvid_coll *c, const uint8_t *key, size_t key_len,
                           const corvid_value *patch);
```
Merge top-level fields (creating if absent); non-map either side replaces
with `patch`.

```c
corvid_status corvid_compare_and_set(corvid_coll *c, const uint8_t *key, size_t key_len,
                                     const corvid_value *expected,       /* nullable */
                                     const corvid_value *replacement,    /* nullable */
                                     int *applied_out);
```
Atomic conditional write. Nullability is semantic: `expected == NULL` means
"must be absent"; `replacement == NULL` means "delete if it matches".
`*applied_out` = 0 on a failed compare is **not an error**. Equality is the
engine's semantic value equality (NaN==NaN, −0.0==0.0, element-wise
containers).

```c
corvid_status corvid_delete(corvid_coll *c, const uint8_t *key, size_t key_len,
                            int *existed_out);              /* nullable out */
corvid_status corvid_delete_where(corvid_coll *c, corvid_pred *pred,   /* CONSUMED */
                                  size_t *removed_out);
corvid_status corvid_delete_batch(corvid_coll *c, const uint8_t *const *keys,
                                  const size_t *key_lens, size_t count,
                                  size_t *removed_out);
```
Deleting a key cascades its graph edges in the same transaction (including
edges dangling on a never-existing key).

```c
corvid_status corvid_insert_with_ttl(corvid_coll *c, const uint8_t *key, size_t key_len,
                                     const corvid_value *doc, int64_t expires_at);
corvid_status corvid_set_ttl(corvid_coll *c, const uint8_t *key, size_t key_len,
                             int64_t expires_at);
corvid_status corvid_get_ttl(corvid_coll *c, const uint8_t *key, size_t key_len,
                             int64_t *expires_at_out, int *has_ttl);
corvid_status corvid_purge_expired(corvid_coll *c, int64_t now, size_t *purged_out);
```
The engine keeps no clock — `now`/`expires_at` are the caller's epoch.
`*has_ttl = 0` is absence (not an error). Expiry is `<= now` inclusive; see
[TTL](/integrity/ttl/).

Next: [reads & indexes](/ffi/functions-reads/).
