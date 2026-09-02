#!/usr/bin/env bash
# Sync the binding-example code blocks into the four binding pages.
#
#   scripts/sync-binding-examples.sh [ref]
#
# Fetches each binding repo's quickstart + hybrid example files from
# GitHub raw (default ref: master — the bindings' example tour is a
# moving master surface, unlike the engine pages which pin a tag in
# .engine-pin), extracts the docs:begin/end region, and splices it into
# src/content/docs/bindings/<page>.md between the corvid-examples
# BEGIN/END markers. With --check, splices into a temp copy instead and
# diffs against the committed pages — the drift gate verify-sync.sh
# runs in CI.
#
# Why imported (not hand-inlined): the docs pages must show exactly the
# code CI executes in the binding repos. The gate makes divergence
# loud: change a binding example without re-running this script and the
# docs CI goes red until the splice is refreshed.

set -euo pipefail

cd "$(dirname "$0")/.."

REF="master"
CHECK=0
if [ "${1:-}" = "--check" ]; then
  CHECK=1
  shift
fi
if [ "${1:-}" != "" ]; then
  REF="$1"
fi

# Temp stays inside the repo (git-ignored .tmp-sync/) — see the note
# in sync-from-engine.sh; system-TMPDIR paths must never be reachable
# by git.
mkdir -p .tmp-sync
TMP=".tmp-sync/$(basename "$(mktemp -d "${PWD}/.tmp-sync/bindings.XXXXXX")")"
trap 'rm -rf "$TMP"' EXIT

FILES=(
  corvid-c/examples/quickstart.c
  corvid-c/examples/hybrid.c
  corvid-node/examples/quickstart.js
  corvid-node/examples/hybrid.js
  corvid-python/examples/quickstart.py
  corvid-python/examples/hybrid.py
  corvid-go/examples/quickstart/main.go
  corvid-go/examples/hybrid/main.go
  corvid-js/examples/quickstart.js
  corvid-js/examples/hybrid.js
)

for f in "${FILES[@]}"; do
  repo="${f%%/*}"
  path="${f#*/}"
  mkdir -p "$(dirname "$TMP/$f")"
  echo "fetching ${repo}@${REF} ${path}"
  curl -fsSL "https://raw.githubusercontent.com/corvid-db/${repo}/${REF}/${path}" \
       -o "$TMP/$f"
done

if [ "$CHECK" -eq 1 ]; then
  PAGES="$TMP/pages"
  mkdir -p "$PAGES"
  for page in corvid-c corvid-node corvid-python corvid-go corvid-js; do
    cp "src/content/docs/bindings/${page}.md" "$PAGES/${page}.md"
  done
  node scripts/sync-binding-examples.mjs "$TMP" "$PAGES"
  status=0
  for page in corvid-c corvid-node corvid-python corvid-go corvid-js; do
    if diff -u "src/content/docs/bindings/${page}.md" "$PAGES/${page}.md" \
         > "$TMP/diff-${page}.txt" 2>&1; then
      echo "ok: bindings/${page}.md example blocks match ${REF}"
    else
      echo "DRIFT: bindings/${page}.md example blocks do not match binding ${REF}" >&2
      sed -n '1,40p' "$TMP/diff-${page}.txt" >&2
      status=1
    fi
  done
  exit "$status"
fi

node scripts/sync-binding-examples.mjs "$TMP" "src/content/docs/bindings"
echo "re-run the docs build if the fences changed page sizes."
