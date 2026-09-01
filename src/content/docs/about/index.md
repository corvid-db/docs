---
title: About these docs
description: How corvid's documentation works — the current/snapshot versioning mechanism, the generated-class pages synced from the engine, AI-friendly endpoints (llms.txt, markdown sources), and how to contribute.
sidebar:
  order: 0
---

This site (`corvid-db/docs`) is the canonical documentation for corvid. It
is built with [Astro Starlight](https://starlight.astro.build), deployed to
GitHub Pages at <https://corvid-db.github.io/docs/>, and versioned
PostgreSQL-style: a **current** site plus frozen **release snapshots**.

## Versioning

- **`/docs/` (current)** — built from the repo's default branch; tracks the
  engine's development. Every page carries a version banner stating what
  you're reading.
- **`/docs/vX.Y.Z/` (snapshots)** — at each engine release, the docs repo's
  state at that moment is snapshotted into a `releases/vX.Y.Z` branch and
  built with its own base path (`/docs/vX.Y.Z/`) and banner. A snapshot is
  frozen: it documents exactly the release it was cut for, forever, and
  never receives fixes (fixes land on current and future snapshots).

The first snapshot is **[v0.2.1](/docs/v0.2.1/)** — identical to the initial
site content. The mechanism:

1. On each engine release, maintainers branch `releases/vX.Y.Z` from the
   docs repo (or tag it), then run the *snapshot* workflow
   ([`.github/workflows/snapshot.yml`](https://github.com/corvid-db/docs/blob/master/.github/workflows/snapshot.yml))
   with the version — it builds that branch with
   `SITE_VERSION=X.Y.Z SITE_BASE=/docs/vX.Y.Z/` and deploys the output under
   the `vX.Y.Z/` directory of the published site.
2. The *deploy* workflow rebuilds and republishes the root (`/docs/`) from
   the default branch on every push, preserving the version directories.

Honesty note: a snapshot reflects the **docs repo** at the release moment —
the engine's own release notes remain the changelog of record (mirrored as
[highlights](/about/changelog/)).

## Generated vs hand-maintained pages

Two pages are **generated-class** — synced from the engine, not edited by
hand:

- [Construct reference](/reference/constructs/) — generated from the
  engine's `docs/SYNTAX.md` (itself generated from the conformance surface
  manifests).
- [Error codes](/reference/error-codes/) — generated from the engine's
  `docs/FFI.md` §1.3 frozen code table.

Both carry a "generated — synced from the engine at vX.Y.Z" header naming
the pinned tag (see [`.engine-pin`](https://github.com/corvid-db/docs/blob/master/.engine-pin)).
`scripts/sync-from-engine.sh <tag>` regenerates them; CI
([the sync check](https://github.com/corvid-db/docs/blob/master/.github/workflows/ci.yml))
fails if the committed copies drift from the pinned tag — the same
drift-gate pattern the engine uses for its generated files. Everything else
on this site is hand-maintained canon.

## AI-friendly endpoints

- [`/docs/llms.txt`](/llms.txt) — a curated index of every page with
  one-line descriptions, generated at build time.
- [`/docs/llms-full.txt`](/llms-full.txt) — the full site as one markdown
  stream.
- Every page is reachable as **clean markdown** at
  `/docs/src/<page-path>.md` — the build copies the source files next to the
  rendered HTML, with stable URLs and frontmatter-carrying meta descriptions.

## Contributing

- PRs to [`corvid-db/docs`](https://github.com/corvid-db/docs) — prose fixes,
  new pages, better cross-links are all welcome.
- Factual claims about engine behavior should cite or mirror the engine's
  conformance suites; if docs and engine disagree, that's a bug in one of
  them — open an issue in the right repo.
- Local development:

  ```sh
  npm install
  npm run dev        # live preview
  npm run build      # build + generate llms.txt + markdown sources
  npm run verify-sync  # check the generated pages match the pinned tag
  ```

## License

The docs are MIT-licensed, like the engine.
