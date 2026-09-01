---
title: Text indexes
description: create_text_index and create_text_index_ondisk — BM25 inverted indexes for text_search, phrase_search and builder text sources; in-RAM vs on-disk trade-offs.
sidebar:
  order: 2
---

```rust
# use corvid::{Db};
# let db = Db::open_in_memory()?; let c = db.collection("docs");
c.create_text_index("body")?;            // in-RAM postings
c.create_text_index_ondisk("body")?;     // on-disk postings
# Ok::<(), corvid::Error>(())
```

Both are **incremental inverted indexes** storing per-term postings with
positional information, updated transactionally with every write. Both back
`text_search` (BM25), `phrase_search` (in-order positional matching), and
the [query builder](/language/query-builder/)'s `.text(...)` source
identically — a query touches only its query terms' postings instead of
rescanning the corpus.

## In-RAM vs on-disk

| | `create_text_index` | `create_text_index_ondisk` |
|---|---|---|
| Postings live | in memory | as storage records |
| Memory | proportional to corpus | bounded by the operation |
| Open cost | rebuilt lazily on first use | ready immediately, no rebuild |
| Persists | definition persists; postings rebuild | definition + state persist |
| When | up to ~100k–1M docs | beyond, or tight-memory deployments |

Non-text values in the indexed field are excluded from postings; text
mutations keep search correct on every path (indexed and scan arms are
conformance-pinned to match — see the
[construct reference](/reference/constructs/)).

## What acceleration looks like

On the pinned 2k-doc benchmark corpus, BM25 goes ~8.0 ms (exact scan) →
~0.49 ms (indexed) — the index also serves phrase queries' positional
checks. Single-source ranked builder queries are bounded: no corpus
materialization. See [performance](/performance/numbers/).

## Analyzer notes

The index and the query share one analyzer (lowercase, English stop words,
conservative plural stemmer, CJK bigrams) — see
[tokenization](/fts/tokenization/). Consequence for upgrades: when the
analyzer changes between engine versions (the CJK bigram change is the
example), re-create existing text indexes so postings match the new
tokenizer.

Next: [geo indexes](/indexes/geo/).
