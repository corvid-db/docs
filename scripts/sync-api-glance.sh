#!/usr/bin/env bash
# Sync the "API at a glance" tables into the binding pages.
#
#   scripts/sync-api-glance.sh [--check] [ref]
#
# Fetches each binding repo's docs/SURFACE.tsv from GitHub raw (default
# ref: master — the manifest is a moving master surface policed by each
# repo's own surface gate) and runs scripts/gen-api-glance.mjs to splice
# the folded table between the corvid-api-glance BEGIN/END markers on
# each bindings/<page>.md. With --check, splices into a temp copy and
# diffs against the committed pages — the drift gate verify-sync.sh
# runs in CI, so a SURFACE.tsv change propagates here or reddens the
# docs CI.

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

mkdir -p .tmp-sync
TMP=".tmp-sync/$(basename "$(mktemp -d "${PWD}/.tmp-sync/glance.XXXXXX")")"
trap 'rm -rf "$TMP"' EXIT

REPOS=(
  corvid-c corvid-node corvid-python corvid-go corvid-js
  corvid-cpp corvid-zig corvid-dart corvid-php corvid-jvm corvid-swift
)

for repo in "${REPOS[@]}"; do
  echo "fetching ${repo}@${REF} docs/SURFACE.tsv"
  curl -fsSL "https://raw.githubusercontent.com/corvid-db/${repo}/${REF}/docs/SURFACE.tsv" \
       -o "$TMP/${repo}.tsv"
done

if [ "$CHECK" -eq 1 ]; then
  PAGES="$TMP/pages"
  mkdir -p "$PAGES"
  for repo in "${REPOS[@]}"; do
    cp "src/content/docs/bindings/${repo}.md" "$PAGES/${repo}.md"
  done
  node scripts/gen-api-glance.mjs "$TMP" "$PAGES"
  status=0
  for repo in "${REPOS[@]}"; do
    if diff -u "src/content/docs/bindings/${repo}.md" "$PAGES/${repo}.md" \
         > "$TMP/diff-${repo}.txt" 2>&1; then
      echo "ok: bindings/${repo}.md api-glance matches ${REF}"
    else
      echo "DRIFT: bindings/${repo}.md api-glance does not match binding ${REF}" >&2
      sed -n '1,40p' "$TMP/diff-${repo}.txt" >&2
      status=1
    fi
  done
  exit "$status"
fi

node scripts/gen-api-glance.mjs "$TMP" "src/content/docs/bindings"
echo "re-run the docs build if the tables changed page sizes."
