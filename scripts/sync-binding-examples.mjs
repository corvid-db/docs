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
  ],
  'corvid-node.md': [
    { name: 'quickstart', file: 'corvid-node/examples/quickstart.js', lang: 'js' },
    { name: 'hybrid', file: 'corvid-node/examples/hybrid.js', lang: 'js' },
  ],
  'corvid-python.md': [
    { name: 'quickstart', file: 'corvid-python/examples/quickstart.py', lang: 'python' },
    { name: 'hybrid', file: 'corvid-python/examples/hybrid.py', lang: 'python' },
  ],
  'corvid-go.md': [
    { name: 'quickstart', file: 'corvid-go/examples/quickstart/main.go', lang: 'go' },
    { name: 'hybrid', file: 'corvid-go/examples/hybrid/main.go', lang: 'go' },
  ],
  'corvid-js.md': [
    { name: 'quickstart', file: 'corvid-js/examples/quickstart.js', lang: 'js' },
    { name: 'hybrid', file: 'corvid-js/examples/hybrid.js', lang: 'js' },
  ],
  'corvid-cpp.md': [
    { name: 'quickstart', file: 'corvid-cpp/examples/quickstart.cpp', lang: 'cpp' },
    { name: 'hybrid', file: 'corvid-cpp/examples/hybrid.cpp', lang: 'cpp' },
  ],
  'corvid-zig.md': [
    { name: 'quickstart', file: 'corvid-zig/examples/quickstart.zig', lang: 'zig' },
    { name: 'hybrid', file: 'corvid-zig/examples/hybrid.zig', lang: 'zig' },
  ],
  'corvid-dart.md': [
    { name: 'quickstart', file: 'corvid-dart/examples/quickstart.dart', lang: 'dart' },
    { name: 'hybrid', file: 'corvid-dart/examples/hybrid.dart', lang: 'dart' },
  ],
  'corvid-php.md': [
    { name: 'quickstart', file: 'corvid-php/examples/quickstart.php', lang: 'php' },
    { name: 'hybrid', file: 'corvid-php/examples/hybrid.php', lang: 'php' },
  ],
  'corvid-jvm.md': [
    { name: 'quickstart', file: 'corvid-jvm/examples/Quickstart.kt', lang: 'kotlin' },
    { name: 'hybrid', file: 'corvid-jvm/examples/Hybrid.kt', lang: 'kotlin' },
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
