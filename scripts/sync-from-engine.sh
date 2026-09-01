#!/usr/bin/env bash
# Sync the GENERATED-CLASS pages from the engine at a pinned tag.
#
#   scripts/sync-from-engine.sh [tag] [output-dir]
#
# Defaults: tag from .engine-pin, output into src/content/docs/reference.
# Pulls docs/SYNTAX.md and docs/FFI.md from the engine repo's tag via
# raw.githubusercontent, then regenerates reference/constructs.md and
# reference/error-codes.md. CI (verify-sync.sh) runs this into a temp dir
# and diffs against the committed copies — the docs' drift gate.

set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${1:-$(cat .engine-pin | tr -d '[:space:]')}"
OUT_DIR="${2:-src/content/docs/reference}"
ENGINE_RAW="https://raw.githubusercontent.com/corvid-db/corvid/${TAG}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "syncing generated pages from engine tag ${TAG} ..."
curl -fsSL "${ENGINE_RAW}/docs/SYNTAX.md" -o "${TMP}/SYNTAX.md"
curl -fsSL "${ENGINE_RAW}/docs/FFI.md"    -o "${TMP}/FFI.md"

node scripts/gen-generated-pages.mjs "$TMP" "$OUT_DIR" "$TAG"
