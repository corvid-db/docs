---
title: Tokenization
description: The corvid analyzer — case folding, English stop words, the Harman S-stemmer, and CJK sliding-bigram segmentation with its exact code-point boundaries.
sidebar:
  order: 1
---

One analyzer feeds indexing and querying on every serving path, so token
streams always line up. The pipeline: split → lowercase → stop-word removal →
conservative plural stemming, with CJK runs segmented as sliding bigrams.

```rust
use corvid::text::{tokenize, analyze, Analyzer};

let tokens = tokenize("Dogs chase Cats!");   // raw tokenizer
let analyzed = Analyzer::default().analyze("Dogs chase Cats!");
let raw = Analyzer::raw().analyze("Dogs chase Cats!");  // no normalization
```

`Analyzer` is configurable; `tokenize` is the raw Unicode-aware splitter
(alphanumeric runs; case and punctuation handled; numbers included).

## Case and stop words

- Lowercase folding applies to cased scripts (Latin and friends).
- A conservative English stop-word list is removed (`the`, `of`, `and`, ...).
- Stop-word removal affects **positions** — see the
  [phrase search caveat](/fts/phrase-search/).

## The S-stemmer

Harman's S-stemmer normalizes common plurals only:

| Input | Stem | Matches `box`? |
|---|---|---|
| `dogs` | `dog` | — |
| `parties` | `party` | — |
| `boxes` | `boxe` | **no** |
| `goes` | `goe` | no |

It is deliberately conservative — no full Porter algorithm — so stemming
never merges unrelated words. For irregular or s-suffixed pairs that matter
to your queries, store a normalized field or query both forms.

## CJK: sliding bigrams

Runs of CJK characters tokenize as **sliding bigrams** (a single-character
run yields that character) — the standard dictionary-free segmentation
fallback for unspaced scripts, with no dictionary data and no dependencies.

The CJK set (documented on the tokenizer):

- Hiragana + katakana: U+3040–30FF (prolonged sound mark `ー` included)
- Han ideographs: U+3400–4DBF, U+4E00–9FFF, U+F900–FAFF, U+20000–323AF

Deliberately **outside** the set:

- **Hangul** — Korean is space-separated, so whole runs remain its tokens
  (the Latin behavior).
- **Halfwidth katakana** and the iteration marks (々 U+3005, 〆 U+3006,
  〱–〵 U+3031–3035): a mark splits the surrounding CJK run and joins the
  non-CJK whole-token piece. Index and query split identically; NFKC-normalize
  upstream if you need bigrams across marks.

Boundary behavior:

- The Han↔kana script transition inside one run does **not** restart the
  window (`東タ` bigrams continue across the transition).
- A CJK↔non-CJK transition splits the run.
- **Stemming and case folding never apply to CJK tokens** (`東京` never
  merges with `東`).
- Consequence: `東京タワー` indexes so that phrase search matches in order —
  and `タワー東京` does not.

## Upgrade note

CJK behavior previously indexed whole runs as single tokens. Text indexes
created before the bigram change should be **re-created** so their postings
carry bigrams for CJK fields (definitions persist; postings rebuild on
re-creation).

Next: [phrase search](/fts/phrase-search/).
