---
title: Graph
description: corvid's directed property graph — link, link_weighted, unlink, neighbors, in_neighbors, traverse; atomic edges, cascade semantics, adjacency, and relation isolation.
sidebar:
  order: 0
---

A directed property graph lives over document keys, stored in reserved
namespaces and indexed by relation. Edges are **atomic** (forward and reverse
in one transaction) and endpoints need not exist as documents.

```rust
# use corvid::{Db};
# let db = Db::open_in_memory()?; let g = db.collection("people");
g.link(b"alice", "follows", b"bob")?;                   // directed edge, weight 1.0
g.link_weighted(b"alice", "rates", b"film", 4.5)?;      // with a weight
g.neighbors(b"alice", "follows")?;                      // Vec<Vec<u8>> — out-edges
g.in_neighbors(b"bob", "follows")?;                     // who follows bob
g.neighbors_weighted(b"alice", "rates")?;               // (target, weight) pairs
g.traverse(b"alice", "follows", 3)?;                    // BFS up to 3 hops
g.unlink(b"alice", "follows", b"bob")?;                 // bool: existed?
# Ok::<(), corvid::Error>(())
```

## Semantics

- **Directed**: `link(a, r, b)` is an edge *from a to b*. `neighbors(a, r)`
  follows out-edges; `in_neighbors(b, r)` reads the reverse index.
- **Relations are isolated**: a `follows` edge never leaks into `rates`
  queries; relation names follow the collection name rules (empty and
  Unicode relations are legal, ordered by bytes).
- **Idempotent link**: linking an existing edge is a no-op that re-emits the
  insert event. A plain `link` **overwrites a prior weighted edge's weight**
  back to 1.0; `link_weighted` overwrites any prior weight. Float extremes
  (±inf, NaN) round-trip.
- **Self-loops** list self in `neighbors`, but `traverse` excludes the start
  node.
- **Missing endpoints are allowed** — edges to keys with no document are
  legal and queryable (`link` emits an insert event keyed by the `from`).
- **Endpoint keys** may be empty or arbitrary bytes, ordered bytewise.
- **`unlink` is directional**: it removes the named edge and its reverse
  twin in one transaction; the reverse-direction edge (b→a, if separately
  linked) survives. Unlinking a missing edge is a quiet `false` no-op.
- **`neighbors`** returns endpoints in key order; a node with no out-edges or
  an unknown node yields empty.
- **`traverse(start, relation, hops)`** is BFS: reachable nodes up to `hops`
  hops, excluding `start`, each once, in BFS visit order. `hops 0` yields
  nothing; `hops 1` equals `neighbors`; cycles terminate (visited set);
  branching and diamond-convergence orders are pinned by tests. One read
  snapshot covers the walk.

## Cascade semantics

Deleting a document — via `delete`, `delete_batch`, `delete_where`,
`compare_and_set`, or a [TTL](/integrity/ttl/) purge — removes **all its
edges, both directions, in the same transaction**. Even deleting an *absent*
key runs the cascade (cleaning edges dangling on a never-inserted key);
purging a stranded TTL entry cascades likewise. `link`/`unlink` emit change
events; the delete cascade itself is silent (no per-edge events).

## Storage: adjacency

Edges live in reserved edge namespaces; two derived **adjacency** namespaces
re-key them endpoint-first for reads and cascades:

- Steady-state deletes touch only the deleted key's rows — O(edges of that
  document), not O(collection edges). (Hub-heavy delete sweeps measured ~5.9×
  faster; see [performance](/performance/numbers/).)
- `link` pays two extra rows per edge (~1.4× on the pure-link microbench) —
  the ratified trade for O(degree) cascades.
- The adjacency builds lazily inside the first edge write's (or first
  cascade's) transaction on legacy databases, self-heals from source rows if
  a derived row is corrupt, and never appears in `collections()` or dumps
  (dump→load replays edges through `link_weighted`, rebuilding it).

Next: [geo queries](/geo/overview/).
