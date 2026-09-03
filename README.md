# corvid docs

The canonical documentation site for
[corvid](https://github.com/corvid-db/corvid) — an embedded, multi-modal
data store for AI applications. Built with [Astro
Starlight](https://starlight.astro.build), deployed to GitHub Pages at
**<https://corvid-db.github.io/docs/>**.

The pages are hand-maintained markdown except two **generated**
reference pages — the public-constructs list (`reference/constructs.md`,
from the engine's `docs/SYNTAX.md`) and the frozen error-code table
(`reference/error-codes.md`, from the engine's `docs/FFI.md` §1.3) —
which are regenerated from the engine tag recorded in `.engine-pin`.
CI drift-gates the committed copies against that tag, so the generated
pages can never silently diverge from the engine they document.

## Versioning (PostgreSQL-style)

- **`/docs/` (current)** — built from this repo's default branch on every
  push ([deploy.yml](.github/workflows/deploy.yml)). Tracks the engine's
  development. A version banner on every page says so.
- **`/docs/vX.Y.Z/` (snapshots)** — at each engine release, the docs repo's
  content at that moment is snapshotted into a `releases/vX.Y.Z` **branch**,
  then built with `SITE_VERSION=X.Y.Z SITE_BASE=/docs/vX.Y.Z/` and published
  under `vX.Y.Z/` on `gh-pages` ([snapshot.yml](.github/workflows/snapshot.yml),
  triggered by tag pushes or manually). Snapshots are frozen — fixes land on
  current and future snapshots only. Both builds are served from one
  `gh-pages` branch; the current build replaces the root and never touches
  the `vX.Y.Z/` directories.

The honest framing (documented on the site's "About these docs" page): a
snapshot reflects **this repo** at the release moment; the engine's
changelog remains the record of what changed in the engine.

## Working on the site

```sh
npm install
npm run dev            # live preview at http://localhost:4321/docs/
npm run build          # build + llms.txt + markdown sources into dist/
npm run check-links    # internal link check over dist/
npm run verify-sync    # generated-pages drift gate (engine tag in .engine-pin)
npm run sync-from-engine.sh [tag]   # regenerate the two reference pages
```

Two build shapes share one config:

```sh
npm run build                                            # current  -> base /docs/
SITE_VERSION=0.2.1 SITE_BASE=/docs/v0.2.1 npm run build   # snapshot -> base /docs/v0.2.1/
```

## CI (kept under ~4 minutes)

[ci.yml](.github/workflows/ci.yml) on every push/PR: `npm ci`, build the
current shape, link check, the sync drift gate, then build the snapshot
shape and link check it too. Deploys are separate workflows.

## AI-friendly endpoints

- `/llms.txt` and `/llms-full.txt` at the site root (generated at build)
- Every page as clean markdown at `/src/<page-path>.md`
- Stable URLs, per-page meta descriptions, sitemap

## Releasing a docs snapshot (maintainers)

1. At engine release time, snapshot the docs: `git branch releases/vX.Y.Z <sha>`
   and push it.
2. Run the *Snapshot vX.Y.Z* workflow with the version (or push a `vX.Y.Z`
   tag) — it builds and publishes `/docs/vX.Y.Z/`.
3. Update the current site's banner link list
   (`src/components/VersionBanner.astro`) and, if the engine tag moved, the
   `.engine-pin` + regeneration + commit.

## License

MIT — see [LICENSE](LICENSE).
