---
title: Geo indexes
description: create_geo_index — fixed-resolution grid cells making radius, bbox, within_km and geo_nearest queries sub-linear, with exact haversine verification.
sidebar:
  order: 3
---

```rust
# use corvid::{Db};
# let db = Db::open_in_memory()?; let c = db.collection("places");
c.create_geo_index("loc")?;
# Ok::<(), corvid::Error>(())
```

The geo index keys documents into **fixed-resolution grid cells (~0.1°)** as
order-preserving keys. A radius or bbox query computes the cells its bounding
box overlaps, scans only those cells, then verifies exact haversine distance
— sub-linear instead of a full-collection scan.

- Accelerates `geo_within_radius`, `geo_within_bbox`, `geo_nearest` (which is
  an expanding-radius exact search), and the builder filter
  `field("loc").within_km(...)`.
- Documents whose indexed field is not a valid point (`[lat, lon]` array or
  `{lat, lon}` map) are skipped — non-points are simply not in the index.
- Moving a document's point (update) or deleting it maintains the index
  transactionally; indexed and scan paths return byte-identical results.
- Very large windows (continental-scale radii, antimeridian-wrapping boxes)
  exceed the candidate cap and fall back to the bounded scan — correct, just
  unaccelerated.
- On disk, persists across reopen; no rebuild on open.

`geo_within_bbox` results are in **key order** on every path (the indexed
path used to emit cell order — pinned fixed); `geo_within_radius` and
`geo_nearest` are nearest-first with ties by key. See
[geo queries](/geo/overview/).

Next: [vector indexes](/indexes/vector/).
