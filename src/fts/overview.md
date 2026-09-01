---
title: Full-text search
description: BM25 full-text search in corvid — text_search and the query builder text source, scoring over the filtered corpus, and the exact baseline.
sidebar:
  order: 0
---

```rust
# use corvid::{Db, Value};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
let hits = c.text_search("body", "rust databases", 10)?;        // Vec<TextHit>
let phrase = c.phrase_search("body", "embedded database", 10)?; // exact, in order
# let _ = (hits, phrase);
# Ok::<(), corvid::Error>(())
```

Text search is **BM25** — term frequency saturated against document length,
rare terms outweighing common ones (IDF), scores comparable across a corpus.
The same engine serves `text_search` directly and the
[query builder](/language/query-builder/)'s `.text(field, query, k)` source.

## Scoring semantics

- **Pre-ranking predicates.** A builder text query with a filter ranks the
  *filtered* candidate set: the predicate runs first (index window or scan),
  and BM25 statistics — document frequencies, average document length — are
  computed over exactly those candidates. The same query without a filter
  scores against full-corpus stats. A score always means "relevance within
  the candidate set the filter admits".
- **Rare terms outrank common ones.** `text_search` for a term appearing in
  one document outscores a term appearing everywhere, at equal TF/length.
  Ties break deterministically.
- **k semantics**: `k = 0` returns nothing; `k = 1` the best hit; `k` beyond
  the corpus returns everything that matches. Stop-word-only and empty
  queries return nothing.
- **Missing fields** are skipped, never errors.

## Exact vs indexed

Without a [text index](/indexes/text/), search is an exact pass — every
document tokenized and scored (correct, streamed, O(n)). With one, a query
touches only its query terms' postings. Results are identical either way
(conformance-pinned); on the 2k benchmark corpus the indexed path is ~16×
faster. Phrase queries store and check positions on both paths; the no-index
phrase fallback scores BM25 on the same scale as the indexed paths, so
creating or dropping an index does not reorder the same phrase query.

## `TextHit`

```rust
pub struct TextHit { pub key: Vec<u8>, pub score: f32, pub document: Value }
```

## Phrase search

`phrase_search` matches exact consecutive tokens **in order**
(`"quick brown"` matches *quick brown fox*, not *brown quick fox*). Positions
are assigned by the shared analyzer — see
[phrase search](/fts/phrase-search/) for the stop-word collapse caveat — and
CJK bigrams make phrase order work over unspaced scripts
(`東京タワー` matches; `タワー東京` does not).

## The analyzer

One analyzer feeds index and query on every path: lowercase, English stop
words, conservative plural stemming (Harman's S-stemmer: `dogs` → `dog`,
`parties` → `party` — but `boxes` → `boxe`, so it does **not** match `box`),
and CJK bigram segmentation. Details and boundaries on
[tokenization](/fts/tokenization/); the honest limitations:

- The S-stemmer is not a full Porter stemmer. Match irregular/s-suffixed
  pairs by storing a normalized field or querying both forms.
- Phrase positions are post-stop-word: `"quick the brown"` matches text
  containing `"quick brown"` — there is no position gap for a removed stop
  word.

Next: [tokenization](/fts/tokenization/).
