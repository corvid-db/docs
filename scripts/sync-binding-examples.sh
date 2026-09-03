#!/usr/bin/env bash
# Sync the binding-example code blocks into the binding pages.
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
  corvid-c/examples/vector_index.c
  corvid-c/examples/text_search.c
  corvid-c/examples/graph.c
  corvid-c/examples/geo.c
  corvid-node/examples/quickstart.js
  corvid-node/examples/hybrid.js
  corvid-node/examples/vector-index.js
  corvid-node/examples/text-search.js
  corvid-node/examples/graph.js
  corvid-node/examples/geo.js
  corvid-python/examples/quickstart.py
  corvid-python/examples/hybrid.py
  corvid-python/examples/vector_index.py
  corvid-python/examples/text_search.py
  corvid-python/examples/graph.py
  corvid-python/examples/geo.py
  corvid-go/examples/quickstart/main.go
  corvid-go/examples/hybrid/main.go
  corvid-go/examples/vector-index/main.go
  corvid-go/examples/text-search/main.go
  corvid-go/examples/graph/main.go
  corvid-go/examples/geo/main.go
  corvid-js/examples/quickstart.js
  corvid-js/examples/hybrid.js
  corvid-js/examples/vector-index.js
  corvid-js/examples/text-search.js
  corvid-js/examples/graph.js
  corvid-js/examples/geo.js
  corvid-cpp/examples/quickstart.cpp
  corvid-cpp/examples/hybrid.cpp
  corvid-cpp/examples/vector_index.cpp
  corvid-cpp/examples/text_search.cpp
  corvid-cpp/examples/graph.cpp
  corvid-cpp/examples/geo.cpp
  corvid-zig/examples/quickstart.zig
  corvid-zig/examples/hybrid.zig
  corvid-zig/examples/vector_index.zig
  corvid-zig/examples/text_search.zig
  corvid-zig/examples/graph.zig
  corvid-zig/examples/geo.zig
  corvid-dart/example/quickstart.dart
  corvid-dart/example/hybrid.dart
  corvid-dart/example/vector_index.dart
  corvid-dart/example/text_search.dart
  corvid-dart/example/graph.dart
  corvid-dart/example/geo.dart
  corvid-php/examples/quickstart.php
  corvid-php/examples/hybrid.php
  corvid-php/examples/vector_index.php
  corvid-php/examples/text_search.php
  corvid-php/examples/graph.php
  corvid-php/examples/geo.php
  corvid-jvm/examples/Quickstart.kt
  corvid-jvm/examples/Hybrid.kt
  corvid-jvm/examples/VectorIndex.kt
  corvid-jvm/examples/TextSearch.kt
  corvid-jvm/examples/Graph.kt
  corvid-jvm/examples/Geo.kt
  corvid-swift/Examples/Quickstart/main.swift
  corvid-swift/Examples/Hybrid/main.swift
  corvid-swift/Examples/VectorIndex/main.swift
  corvid-swift/Examples/TextSearch/main.swift
  corvid-swift/Examples/Graph/main.swift
  corvid-swift/Examples/Geo/main.swift
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
  for page in corvid-c corvid-node corvid-python corvid-go corvid-js corvid-cpp corvid-zig corvid-dart corvid-php corvid-jvm corvid-swift; do
    cp "src/content/docs/bindings/${page}.md" "$PAGES/${page}.md"
  done
  node scripts/sync-binding-examples.mjs "$TMP" "$PAGES"
  status=0
  for page in corvid-c corvid-node corvid-python corvid-go corvid-js corvid-cpp corvid-zig corvid-dart corvid-php corvid-jvm corvid-swift; do
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
