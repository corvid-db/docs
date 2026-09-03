---
title: Semantic cache
description: The vector-keyed cache — SemanticCache lookups by nearest embedding within a threshold, metric units, and LLM response caching.
sidebar:
  order: 11
---

The semantic cache answers *"have I already answered a question that is
semantically close to this one?"* — a nearest-embedding lookup within a
threshold, over an ordinary collection.

```rust
# use corvid::{Db, Metric, Value};
# let db = Db::open_in_memory()?;
let cache = db.collection("llm_cache")
    .semantic_cache("embedding", "answer", Metric::Cosine, 0.95);

cache.put(b"q1", vec![0.1, 0.9], Value::Text("the answer".into()))?;

let hit = cache.get(&[0.1, 0.89])?;   // Some(value) — within threshold of q1
let miss = cache.get(&[0.9, 0.1])?;   // None — nothing close enough
# let _ = (hit, miss);
# Ok::<(), corvid::Error>(())
```

## How it works

`semantic_cache(embedding_field, value_field, metric, threshold)` wraps a
collection whose documents carry an embedding under `embedding_field` and the
cached payload under `value_field`:

- **`put(key, embedding, value)`** stores `{embedding, value}` at `key`.
- **`get(query)`** finds the nearest stored embedding by `metric` and returns
  its value iff the distance is **≤ threshold**; otherwise `None`.

Threshold units follow the metric: cosine thresholds live in `[0, 2]`
(distance, not similarity — 0.05 means "very close"); L2 thresholds are
squared distance. Distances are exact metric distances —
`vector_search` reranks ANN hits with exact distances, so a quantized index
does not distort threshold comparisons.

## Design notes

- The cache is built on the collection's own machinery: create a
  [vector index](/indexes/vector/) on the embedding field and lookups are
  ANN-served; without one they are exact scans. Semantics are identical.
- It is a cache *pattern*, not a TTL'd store — pair it with
  [TTL](/integrity/ttl/) on the backing collection when entries should
  expire.
- Tracing subscribers see `semantic_cache_hit` / `semantic_cache_miss` events
  with the deciding distance when the `tracing` feature is on (see
  [observability](/admin/observability/)).

Next: [TTL and expiry](/integrity/ttl/).
