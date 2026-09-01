#!/usr/bin/env node
// Post-build: make the site AI-friendly.
//
// 1. Copy every source markdown page into dist/src/<path>.md — clean,
//    stable markdown URLs alongside the HTML (e.g. /docs/src/language/values.md).
// 2. Generate dist/llms.txt — a curated index (title, link, description).
// 3. Generate dist/llms-full.txt — the full site as one markdown stream.
//
// Env: SITE_BASE (default /docs), SITE_VERSION (default '' = current).

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src/content/docs');
const DIST = join(root, 'dist');
const BASE = (process.env.SITE_BASE || '/docs').replace(/\/$/, '');
const VERSION = process.env.SITE_VERSION || 'current';

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  return fm;
}

const files = walk(SRC).filter((f) => extname(f) === '.md');

// 1. Copy markdown sources under dist/src/, collecting page metadata.
const pages = [];
for (const abs of files) {
  const rel = relative(SRC, abs); // e.g. language/values.md
  const text = readFileSync(abs, 'utf8');
  const fm = parseFrontmatter(text);
  const htmlUrl = rel === 'index.md'
    ? `${BASE}/`
    : `${BASE}/${rel.replace(/\.md$/, '').replace(/index$/, '')}/`;
  const mdUrl = `${BASE}/src/${rel}`;
  const out = join(DIST, 'src', rel);
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(abs, out);
  pages.push({
    title: fm.title || rel,
    description: fm.description || '',
    htmlUrl,
    mdUrl,
    rel,
    text,
  });
}

// Sidebar-ish grouping by top-level directory for a readable index.
const order = ['index.md', 'start', 'tutorial', 'language', 'indexes', 'fts',
  'graph', 'geo', 'integrity', 'admin', 'performance', 'ffi', 'bindings',
  'reference', 'about'];
const groups = new Map();
for (const p of pages) {
  const seg = p.rel === 'index.md' ? 'index.md' : p.rel.split('/')[0];
  if (!groups.has(seg)) groups.set(seg, []);
  groups.get(seg).push(p);
}
const sortedGroups = [
  ...order.filter((k) => groups.has(k)),
  ...[...groups.keys()].filter((k) => !order.includes(k)),
];
const groupTitles = {
  'index.md': 'Overview',
  start: 'Start',
  tutorial: 'Tutorial',
  language: 'The corvid language',
  indexes: 'Indexes',
  fts: 'Full-text search',
  graph: 'Graph',
  geo: 'Geo',
  integrity: 'Integrity & events',
  admin: 'Administration',
  performance: 'Performance',
  ffi: 'The C ABI',
  bindings: 'Bindings',
  reference: 'Reference',
  about: 'About',
};

// 2. llms.txt
let llms = `# corvid documentation (${VERSION})

> corvid is an embedded, multi-modal data store for AI applications: vector
> search, full-text search, metadata filtering, and rank fusion behind one
> in-process query builder. These docs cover the engine, the C ABI, the
> bindings, administration, and performance. Every page is also available as
> clean markdown at the same path under ${BASE}/src/.

`;
for (const g of sortedGroups) {
  llms += `## ${groupTitles[g] || g}\n\n`;
  for (const p of groups.get(g)) {
    llms += `- [${p.title}](${p.htmlUrl})${p.description ? `: ${p.description}` : ''}\n`;
  }
  llms += '\n';
}
writeFileSync(join(DIST, 'llms.txt'), llms);

// 3. llms-full.txt — every page's markdown, with page delimiters.
let full = `# corvid documentation — full text (${VERSION})

# Source: ${BASE}/llms-full.txt

`;
for (const g of sortedGroups) {
  for (const p of groups.get(g)) {
    // Strip the frontmatter block; keep the body as-is.
    const body = p.text.replace(/^---\n[\s\S]*?\n---\n/, '');
    full += `\n\n================================================================================\n# ${p.title}\n# ${p.htmlUrl}\n================================================================================\n${body.trimEnd()}\n`;
  }
}
writeFileSync(join(DIST, 'llms-full.txt'), full);

console.log(
  `llms: indexed ${pages.length} pages -> ${BASE}/llms.txt, ${BASE}/llms-full.txt, and ${BASE}/src/*.md`
);
