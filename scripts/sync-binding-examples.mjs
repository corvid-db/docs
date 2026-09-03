// gen-binding-example-blocks.mjs — splice the binding examples into the
// docs pages.
//
// The binding pages embed each binding's quickstart + hybrid
// examples as code blocks. The source of truth is the binding repos
// (examples/<name>.* on master, each carrying `docs:begin:<name>` /
// `docs:end:<name>` markers); this script fetches those files, extracts
// the marked region, and splices it into the page between the
// `<!-- corvid-examples:<name> BEGIN -->` / `END` comment markers —
// the same generated-page discipline scripts/sync-from-engine.sh uses
// for the reference pages. CI (verify-sync.sh --binding-examples) runs
// this against the committed pages and fails on drift, so a binding
// example change propagates here or reddens the docs CI.
//
// Usage:
//   node scripts/gen-binding-example-blocks.mjs <tmpdir> <pages-dir>
//     <tmpdir>: where the fetched example files already live (see
//               sync-binding-examples.sh, which curls them)
//     <pages-dir>: src/content/docs/bindings, or a temp copy in
//               check mode

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// page -> [{ example name, repo file (under the fetched tmpdir), lang }]
const PAGES = {
  'corvid-c.md': [
    { name: 'quickstart', file: 'corvid-c/examples/quickstart.c', lang: 'c' },
    { name: 'hybrid', file: 'corvid-c/examples/hybrid.c', lang: 'c' },
    { name: 'vector_index', file: 'corvid-c/examples/vector_index.c', lang: 'c' },
    { name: 'text_search', file: 'corvid-c/examples/text_search.c', lang: 'c' },
    { name: 'graph', file: 'corvid-c/examples/graph.c', lang: 'c' },
    { name: 'geo', file: 'corvid-c/examples/geo.c', lang: 'c' },
  ],
  'corvid-node.md': [
    { name: 'quickstart', file: 'corvid-node/examples/quickstart.js', lang: 'js' },
    { name: 'hybrid', file: 'corvid-node/examples/hybrid.js', lang: 'js' },
    { name: 'vector_index', file: 'corvid-node/examples/vector-index.js', lang: 'js' },
    { name: 'text_search', file: 'corvid-node/examples/text-search.js', lang: 'js' },
    { name: 'graph', file: 'corvid-node/examples/graph.js', lang: 'js' },
    { name: 'geo', file: 'corvid-node/examples/geo.js', lang: 'js' },
  ],
  'corvid-python.md': [
    { name: 'quickstart', file: 'corvid-python/examples/quickstart.py', lang: 'python' },
    { name: 'hybrid', file: 'corvid-python/examples/hybrid.py', lang: 'python' },
    { name: 'vector_index', file: 'corvid-python/examples/vector_index.py', lang: 'python' },
    { name: 'text_search', file: 'corvid-python/examples/text_search.py', lang: 'python' },
    { name: 'graph', file: 'corvid-python/examples/graph.py', lang: 'python' },
    { name: 'geo', file: 'corvid-python/examples/geo.py', lang: 'python' },
  ],
  'corvid-go.md': [
    { name: 'quickstart', file: 'corvid-go/examples/quickstart/main.go', lang: 'go' },
    { name: 'hybrid', file: 'corvid-go/examples/hybrid/main.go', lang: 'go' },
    { name: 'vector_index', file: 'corvid-go/examples/vector-index/main.go', lang: 'go' },
    { name: 'text_search', file: 'corvid-go/examples/text-search/main.go', lang: 'go' },
    { name: 'graph', file: 'corvid-go/examples/graph/main.go', lang: 'go' },
    { name: 'geo', file: 'corvid-go/examples/geo/main.go', lang: 'go' },
  ],
  'corvid-js.md': [
    { name: 'quickstart', file: 'corvid-js/examples/quickstart.js', lang: 'js' },
    { name: 'hybrid', file: 'corvid-js/examples/hybrid.js', lang: 'js' },
    { name: 'vector_index', file: 'corvid-js/examples/vector-index.js', lang: 'js' },
    { name: 'text_search', file: 'corvid-js/examples/text-search.js', lang: 'js' },
    { name: 'graph', file: 'corvid-js/examples/graph.js', lang: 'js' },
    { name: 'geo', file: 'corvid-js/examples/geo.js', lang: 'js' },
  ],
  'corvid-cpp.md': [
    { name: 'quickstart', file: 'corvid-cpp/examples/quickstart.cpp', lang: 'cpp' },
    { name: 'hybrid', file: 'corvid-cpp/examples/hybrid.cpp', lang: 'cpp' },
    { name: 'vector_index', file: 'corvid-cpp/examples/vector_index.cpp', lang: 'cpp' },
    { name: 'text_search', file: 'corvid-cpp/examples/text_search.cpp', lang: 'cpp' },
    { name: 'graph', file: 'corvid-cpp/examples/graph.cpp', lang: 'cpp' },
    { name: 'geo', file: 'corvid-cpp/examples/geo.cpp', lang: 'cpp' },
  ],
  'corvid-zig.md': [
    { name: 'quickstart', file: 'corvid-zig/examples/quickstart.zig', lang: 'zig' },
    { name: 'hybrid', file: 'corvid-zig/examples/hybrid.zig', lang: 'zig' },
    { name: 'vector_index', file: 'corvid-zig/examples/vector_index.zig', lang: 'zig' },
    { name: 'text_search', file: 'corvid-zig/examples/text_search.zig', lang: 'zig' },
    { name: 'graph', file: 'corvid-zig/examples/graph.zig', lang: 'zig' },
    { name: 'geo', file: 'corvid-zig/examples/geo.zig', lang: 'zig' },
  ],
  'corvid-dart.md': [
    { name: 'quickstart', file: 'corvid-dart/example/quickstart.dart', lang: 'dart' },
    { name: 'hybrid', file: 'corvid-dart/example/hybrid.dart', lang: 'dart' },
    { name: 'vector_index', file: 'corvid-dart/example/vector_index.dart', lang: 'dart' },
    { name: 'text_search', file: 'corvid-dart/example/text_search.dart', lang: 'dart' },
    { name: 'graph', file: 'corvid-dart/example/graph.dart', lang: 'dart' },
    { name: 'geo', file: 'corvid-dart/example/geo.dart', lang: 'dart' },
  ],
  'corvid-php.md': [
    { name: 'quickstart', file: 'corvid-php/examples/quickstart.php', lang: 'php' },
    { name: 'hybrid', file: 'corvid-php/examples/hybrid.php', lang: 'php' },
    { name: 'vector_index', file: 'corvid-php/examples/vector_index.php', lang: 'php' },
    { name: 'text_search', file: 'corvid-php/examples/text_search.php', lang: 'php' },
    { name: 'graph', file: 'corvid-php/examples/graph.php', lang: 'php' },
    { name: 'geo', file: 'corvid-php/examples/geo.php', lang: 'php' },
  ],
  'corvid-jvm.md': [
    { name: 'quickstart', file: 'corvid-jvm/examples/Quickstart.kt', lang: 'kotlin' },
    { name: 'hybrid', file: 'corvid-jvm/examples/Hybrid.kt', lang: 'kotlin' },
    { name: 'vector_index', file: 'corvid-jvm/examples/VectorIndex.kt', lang: 'kotlin' },
    { name: 'text_search', file: 'corvid-jvm/examples/TextSearch.kt', lang: 'kotlin' },
    { name: 'graph', file: 'corvid-jvm/examples/Graph.kt', lang: 'kotlin' },
    { name: 'geo', file: 'corvid-jvm/examples/Geo.kt', lang: 'kotlin' },
  ],
  'corvid-swift.md': [
    { name: 'quickstart', file: 'corvid-swift/Examples/Quickstart/main.swift', lang: 'swift' },
    { name: 'hybrid', file: 'corvid-swift/Examples/Hybrid/main.swift', lang: 'swift' },
    { name: 'vector_index', file: 'corvid-swift/Examples/VectorIndex/main.swift', lang: 'swift' },
    { name: 'text_search', file: 'corvid-swift/Examples/TextSearch/main.swift', lang: 'swift' },
    { name: 'graph', file: 'corvid-swift/Examples/Graph/main.swift', lang: 'swift' },
    { name: 'geo', file: 'corvid-swift/Examples/Geo/main.swift', lang: 'swift' },
  ],
};

// The marker line styles per binding (C block comments, // and #).
function extract(body, name) {
  const lines = body.split('\n');
  const begin = lines.findIndex((l) => l.includes(`docs:begin:${name}`));
  const end = lines.findIndex((l) => l.includes(`docs:end:${name}`));
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`markers docs:begin:${name}/docs:end:${name} not found`);
  }
  let region = lines.slice(begin + 1, end);
  // trim leading/trailing blank lines the runnable file pads for
  // readability
  while (region.length && region[0].trim() === '') region.shift();
  while (region.length && region[region.length - 1].trim() === '') region.pop();
  return region.join('\n');
}

const [tmpDir, pagesDir] = process.argv.slice(2);
if (!tmpDir || !pagesDir) {
  console.error('usage: gen-binding-example-blocks.mjs <tmpdir> <pages-dir>');
  process.exit(2);
}

for (const [page, blocks] of Object.entries(PAGES)) {
  const pagePath = join(pagesDir, page);
  let src = readFileSync(pagePath, 'utf8');
  for (const { name, file, lang } of blocks) {
    const body = readFileSync(join(tmpDir, file), 'utf8');
    const code = extract(body, name);
    const beginRe = new RegExp(
      `(<!-- corvid-examples:${name} BEGIN -->)[\\s\\S]*?(<!-- corvid-examples:${name} END -->)`,
    );
    if (!beginRe.test(src)) {
      throw new Error(`${page}: corvid-examples:${name} BEGIN/END markers not found`);
    }
    src = src.replace(
      beginRe,
      `$1\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n$2`,
    );
  }
  writeFileSync(pagePath, src);
  console.log(`ok: ${page} example blocks spliced`);
}
