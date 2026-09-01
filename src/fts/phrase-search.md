---
title: Phrase search
description: phrase_search in corvid — exact in-order token matching, positional indexing, repeated terms, sentence boundaries, and the stop-word collapse caveat.
sidebar:
  order: 2
---

`phrase_search(field, phrase, k)` matches documents whose field contains the
phrase's tokens **consecutively and in order** — a positional check, not a
bag-of-words AND:

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
# let mut m = std::collections::BTreeMap::new();
# m.insert("body".into(), Value::Text("an embedded database for rust".into()));
# c.insert(b"d1", &Value::Map(m))?;
c.phrase_search("body", "embedded database", 10)?;   // matches d1
c.phrase_search("body", "database embedded", 10)?;   // order matters — no match
c.phrase_search("body", "embedded", 10)?;            // single term == term search
# Ok::<(), corvid::Error>(())
```

## Semantics

- **Single-term phrases** equal term search.
- **Repeated terms** must actually repeat: `"rust rust"` does not match a
  single `rust`.
- **Non-adjacent tokens do not match**: `"database for"` does not match
  *database for rust*? It does — `for` may be a stop word (below). But
  `"database rust"` (skipping a *kept* word) does not.
- **k bounds**: `k = 0` yields nothing; beyond the corpus yields everything
  that matches. An empty phrase yields nothing.
- Both index arms (in-RAM and on-disk postings carry positions) and the
  no-index fallback behave identically; the fallback scores hits with BM25 on
  the same scale as the indexed paths, so scores are comparable and creating
  or dropping an index does not reorder the same phrase query.

## The stop-word collapse caveat

Token positions are assigned **after stop-word removal**, and there is no
position gap for a removed stop word. Therefore phrases match *across*
removed stop words:

> `"quick the brown"` matches text containing `"quick brown"`.

`the` never got a position, so `quick` and `brown` are adjacent in the
positional stream. This is documented, pinned behavior — design phrase
queries accordingly (avoid stop words inside phrases when adjacency matters
against the *raw* text).

## Sentence boundaries

Phrase matching does not respect sentence boundaries — positions continue
across sentence-internal punctuation in the same field, so a phrase can
match across a period if the tokens are adjacent in the stream. Pin your
expectations with tests if you rely on boundary behavior.

## CJK phrases

Over CJK bigrams, phrase order is order-correct: `東京タワー` matches,
`タワー東京` does not (see [tokenization](/fts/tokenization/)).

Next: [graph](/graph/overview/).
