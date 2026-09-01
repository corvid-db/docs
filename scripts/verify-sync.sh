#!/usr/bin/env bash
# The drift gate: regenerate the GENERATED-CLASS pages from the pinned
# engine tag into a temp dir and verify the committed copies match.
# Same pattern as the engine's generated-file gates.

set -euo pipefail

cd "$(dirname "$0")/.."

TAG="$(cat .engine-pin | tr -d '[:space:]')"
# Temp stays inside the repo (git-ignored .tmp-sync/) — see the note in
# sync-from-engine.sh; system-TMPDIR paths must never be reachable by git.
mkdir -p .tmp-sync
TMP=".tmp-sync/$(basename "$(mktemp -d "${PWD}/.tmp-sync/verify.XXXXXX")")"
trap 'rm -rf "$TMP"' EXIT

bash scripts/sync-from-engine.sh "$TAG" "$TMP"

status=0
for f in constructs.md error-codes.md; do
  if diff -u "src/content/docs/reference/$f" "$TMP/$f" > "$TMP/diff-$f.txt" 2>&1; then
    echo "ok: $f matches engine tag $TAG"
  else
    echo "DRIFT: src/content/docs/reference/$f does not match engine tag $TAG" >&2
    sed -n '1,40p' "$TMP/diff-$f.txt" >&2
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "" >&2
  echo "Run: scripts/sync-from-engine.sh && git commit" >&2
fi
exit "$status"
