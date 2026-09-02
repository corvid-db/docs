---
title: "Functions: graph & geo"
description: The C ABI function reference part 5 — the graph family (link, link_weighted, unlink, neighbors, in_neighbors, neighbors_weighted, traverse) and the geo & shared iterator family.
sidebar:
  order: 8
---

## Graph (7)

Directed property graph over document keys; endpoints need not exist as
documents. All wrap `corvid::Collection` methods — semantics on
[graph](/graph/overview/).

```c
corvid_status corvid_link(corvid_coll *c, const uint8_t *from, size_t from_len,
                          const char *relation, size_t rel_len,
                          const uint8_t *to, size_t to_len);
```
Idempotent directed edge with default weight 1.0 (a plain link overwrites a
prior weighted edge's weight).

```c
corvid_status corvid_link_weighted(corvid_coll *c, const uint8_t *from, size_t from_len,
                                   const char *relation, size_t rel_len,
                                   const uint8_t *to, size_t to_len, double weight);
corvid_status corvid_unlink(corvid_coll *c, const uint8_t *from, size_t from_len,
                            const char *relation, size_t rel_len,
                            const uint8_t *to, size_t to_len, int *removed_out);
```
`unlink` removes the edge and its reverse atomically; `*removed_out`
(nullable) reports whether the forward edge existed — false is not an error.

```c
corvid_strs* corvid_neighbors(corvid_coll *c, const uint8_t *from, size_t from_len,
                              const char *relation, size_t rel_len);
corvid_strs* corvid_in_neighbors(corvid_coll *c, const uint8_t *to, size_t to_len,
                                 const char *relation, size_t rel_len);
corvid_geohits* corvid_neighbors_weighted(corvid_coll *c, const uint8_t *from, size_t from_len,
                                          const char *relation, size_t rel_len);
```
Out-/in-edge endpoints in key order as a strs cursor. `neighbors_weighted`
returns `(target, weight)` pairs through the geohits cursor —
`distance_km` carries the edge weight (1.0 for unweighted edges); its
`doc_out` is always NULL.

```c
corvid_strs* corvid_traverse(corvid_coll *c, const uint8_t *start, size_t start_len,
                             const char *relation, size_t rel_len, size_t hops);
```
BFS up to `hops` hops: reachable nodes excluding `start`, each once, BFS
order; `hops == 0` yields nothing; cycles terminate. One read snapshot
covers the walk.

## Geo & shared string iterators (7)

The three geo queries return a geohits cursor (nearest-first for
radius/nearest; key order for bbox). A location field holds `[lat, lon]` or
a `lat`/`lon` map; invalid points are skipped. Distances are haversine
kilometres. Semantics on [geo](/geo/overview/).

```c
corvid_geohits* corvid_geo_within_radius(corvid_coll *c, const char *field, size_t field_len,
                                         double lat, double lon, double radius_km);
corvid_geohits* corvid_geo_within_bbox(corvid_coll *c, const char *field, size_t field_len,
                                       double min_lat, double min_lon,
                                       double max_lat, double max_lon);
corvid_geohits* corvid_geo_nearest(corvid_coll *c, const char *field, size_t field_len,
                                   double lat, double lon, size_t k);
```
`geo_within_bbox` validates bounds at entry (latitude `[-90, 90]`,
longitude `[-180, 180]`, NaN rejected, inverted latitude rejected) with
`CORVID_E_ARGUMENT`; `min_lon > max_lon` wraps the antimeridian (matches
both ranges; exact, unaccelerated). bbox hits carry the **0.0 sentinel** in
`distance_km` (no center). `geo_nearest` is exact (expanding radius);
`k == 0` yields nothing.

```c
int  corvid_geohits_next(corvid_geohits *h, corvid_geohit *out,
                         const corvid_value **doc_out);
void corvid_geohits_free(corvid_geohits *h);

int  corvid_strs_next(corvid_strs *s, const char **str_out, size_t *len_out);
void corvid_strs_free(corvid_strs *s);
```
`geohits_next`: 1 fetched, 0 exhausted; `out->key` BORROWED until the next
call or free; `*doc_out` (nullable pointer) is the likewise-borrowed full
document — NULL for `neighbors_weighted` cursors. `strs_next` hands out
binary-safe borrowed byte strings (graph keys keep arbitrary bytes).

Next: [admin functions](/ffi/functions-admin/).
