// gen-api-glance.mjs — generate each binding page's "API at a glance"
// table from the binding repo's docs/SURFACE.tsv.
//
// SURFACE.tsv is the binding-surface manifest every repo carries (one
// row per engine construct: construct, class, MAPPED|N/A, binding-api,
// proving test), gate-checked in each repo's CI at the pinned engine
// tag. This script folds the MAPPED rows by their binding-api cell —
// one row per API group with the count of engine constructs it covers
// and the distinct proofs — and splices the table into the page between
// the corvid-api-glance BEGIN/END markers. Same generated-page
// discipline as the example blocks: sync-api-glance.sh fetches, this
// splices, verify-sync.sh diffs.
//
// Usage: node scripts/gen-api-glance.mjs <tmpdir-with-<repo>/SURFACE.tsv> <pages-dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPOS_TO_PAGE = {
  'corvid-c': 'corvid-c.md',
  'corvid-node': 'corvid-node.md',
  'corvid-python': 'corvid-python.md',
  'corvid-go': 'corvid-go.md',
  'corvid-js': 'corvid-js.md',
  'corvid-cpp': 'corvid-cpp.md',
  'corvid-zig': 'corvid-zig.md',
  'corvid-dart': 'corvid-dart.md',
  'corvid-php': 'corvid-php.md',
  'corvid-jvm': 'corvid-jvm.md',
  'corvid-swift': 'corvid-swift.md',
};

const [tmpDir, pagesDir] = process.argv.slice(2);
if (!tmpDir || !pagesDir) {
  console.error('usage: gen-api-glance.mjs <tmpdir> <pages-dir>');
  process.exit(2);
}

for (const [repo, page] of Object.entries(REPOS_TO_PAGE)) {
  const tsv = readFileSync(join(tmpDir, `${repo}.tsv`), 'utf8');
  const groups = new Map(); // api prose -> { constructs, tests:Set }
  let na = 0;
  for (const line of tsv.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (cols.length !== 5) continue;
    const [, , exposure, api, test] = cols;
    if (exposure === 'N/A') { na += 1; continue; }
    if (exposure !== 'MAPPED') continue;
    if (!groups.has(api)) groups.set(api, { constructs: 0, tests: new Set() });
    const g = groups.get(api);
    g.constructs += 1;
    if (test) g.tests.add(test);
  }

  const lines = [
    '| API group | engine constructs | proven by |',
    '|---|---|---|',
    ...[...groups.entries()].map(([api, g]) =>
      `| \`${api}\` | ${g.constructs} | ${[...g.tests].join('; ')} |`),
    '',
    `${na} engine constructs are deliberately not exposed (each with its reason in the repo's \`docs/SURFACE.tsv\`).`,
  ].join('\n');

  const pagePath = join(pagesDir, page);
  let src = readFileSync(pagePath, 'utf8');
  const re = /(<!-- corvid-api-glance BEGIN -->)[\s\S]*?(<!-- corvid-api-glance END -->)/;
  if (!re.test(src)) throw new Error(`${page}: corvid-api-glance markers not found`);
  src = src.replace(re, `$1\n\n${lines}\n\n$2`);
  writeFileSync(pagePath, src);
  console.log(`ok: ${page} api-glance (${groups.size} API groups, ${na} N/A)`);
}
