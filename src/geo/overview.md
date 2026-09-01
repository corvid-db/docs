---
title: Geo queries
description: Geospatial queries in corvid — geo_within_radius, geo_within_bbox (including antimeridian wrap), geo_nearest, point formats, haversine distances and validation rules.
sidebar:
  order: 0
---

A location field holds a point as `[lat, lon]` (array) or `{lat, lon}` (map).
Distances are haversine kilometres (spherical Earth). Documents without a
valid point are skipped, never errors.

```rust
# use corvid::{Db};
# let db = Db::open_in_memory()?; let c = db.collection("places");
c.geo_within_radius("loc", 51.5, -0.13, 25.0)?;    // within 25 km, nearest first
c.geo_within_bbox("loc", 51.0, -1.0, 52.0, 1.0)?;  // bounding box, key order
c.geo_nearest("loc", 51.5, -0.13, 5)?;             // k nearest, any distance
# Ok::<(), corvid::Error>(())
```

And as a composable builder filter:

```rust
# use corvid::{field};
field("loc").within_km(51.5, -0.13, 25.0);
# let _ = ();
```

## `geo_within_radius(lat, lon, radius_km)`

- Inclusive boundary: a point at exactly `radius_km` matches.
- Results are **nearest first, ties by key**.
- `radius 0` matches the point itself; a "full globe" radius matches every
  valid point.
- No input validation is applied — the query is a mathematical predicate
  (invalid centers behave per the haversine formula; use
  [`within_km`'s predicate rules](#validation) when you want checked input).
- With a [geo index](/indexes/geo/) the window scans only overlapped cells,
  then verifies exact haversine.

## `geo_within_bbox(min_lat, min_lon, max_lat, max_lon)`

- **Validated at entry** (see [validation](#validation)): latitude in
  `[-90, 90]`, longitude in `[-180, 180]`, NaN rejected, inverted latitude
  (`min_lat > max_lat`) rejected with `Error::InvalidArgument`.
- **Antimeridian**: `min_lon > max_lon` wraps — the box matches **both**
  longitude ranges (the two sides of the 180° line). The wrap path is exact
  but unaccelerated (cap-fallback to a scan).
- Results are in **key order, portably** — every path (indexed, scan) emits
  the same documents in the same order. Key order is the contract.
- Degenerate shapes are legal: a point box matches the point; a line box
  (zero height/width) matches the line; pole and globe boxes work.
- `GeoHit.distance_km` is the **0.0 sentinel** for bbox hits — the box query
  has no center, so no distance is computed.

## `geo_nearest(lat, lon, k)`

- The true `k` nearest points regardless of distance (an expanding-radius
  exact search), nearest first, equidistant ties by key.
- `k = 0` yields nothing; fewer than `k` results only when fewer valid
  points exist; antipodal points are found.

## Validation

The two entry points differ deliberately:

| Entry point | Validation |
|---|---|
| `geo_within_bbox` | strict: bounds, NaN, inverted latitude → `Error::InvalidArgument` |
| `geo_within_radius` / `geo_nearest` | none — mathematical semantics (documented, pinned) |
| `field("loc").within_km(...)` predicate | deep-checked: invalid centers and pole-adjacent degenerates are tested per the conformance suite |

If your application feeds user input to radius/nearest, validate bounds
yourself or route through the predicate.

## `GeoHit`

```rust
pub struct GeoHit { pub key: Vec<u8>, pub distance_km: f64, pub document: Value }
```

`haversine_km(a, b)` is the public distance helper — symmetric, exact at
poles and antipodes.

Next: [TTL and expiry](/integrity/ttl/).
