#!/usr/bin/env node
// Internal link check over the built site (dist/). Fast, dependency-free:
//  - collects href/src from every built HTML page
//  - verifies same-page anchors (#id) exist in the page
//  - verifies internal absolute links (${BASE}/...) resolve to files in dist/
// Excludes external http(s) links, mailto:, data:.
// Env: SITE_BASE (default /docs)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist');
const BASE = (process.env.SITE_BASE || '/docs').replace(/\/$/, '');

if (!existsSync(DIST)) {
  console.error('dist/ not found — run npm run build first');
  process.exit(2);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const attrRe = /(?:href|src)="([^"]+)"/g;

let checked = 0;
const broken = [];

for (const html of htmlFiles) {
  const text = readFileSync(html, 'utf8');
  const ids = new Set([...text.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  let m;
  while ((m = attrRe.exec(text)) !== null) {
    const url = m[1];
    if (/^(https?:|mailto:|data:|\/\/)/.test(url)) continue;
    checked++;
    const hashIdx = url.indexOf('#');
    const hash = hashIdx >= 0 ? url.slice(hashIdx + 1) : '';
    const pathPart = hashIdx >= 0 ? url.slice(0, hashIdx) : url;

    if (pathPart === '' || pathPart.startsWith('./')) {
      // same-page anchor
      if (hash && !ids.has(hash)) {
        broken.push(`${relative(DIST, html)}: missing anchor #${hash}`);
      }
      continue;
    }
    // Plain relative link (e.g. hero actions "start/install/") — resolve
    // against the page's directory.
    if (!pathPart.startsWith('/')) {
      const resolved = join(dirname(html), pathPart);
      const relFromDist = relative(DIST, resolved);
      const candidates = relFromDist.endsWith('.html')
        ? [resolved]
        : [resolved, join(resolved, 'index.html')];
      const ok = candidates.some((c) => existsSync(c) && statSync(c).isFile());
      if (!ok) broken.push(`${relative(DIST, html)}: broken relative link ${url}`);
      continue;
    }
    // Cross-build links: version snapshots (/docs/vX.Y.Z/) and the current
    // site root (/docs) point at other deployed builds — not present in
    // this dist by design; skip them.
    if (/^\/docs\/v\d+\.\d+\.\d+\//.test(pathPart)) continue;
    if (pathPart === '/docs' || pathPart === '/docs/') continue;
    if (!pathPart.startsWith(BASE + '/')) {
      broken.push(`${relative(DIST, html)}: unexpected non-rooted link ${url}`);
      continue;
    }
    const fsPath = join(DIST, pathPart.slice(BASE.length + 1));
    const candidates =
      fsPath.endsWith('.html') || extnameNonEmpty(fsPath)
        ? [fsPath]
        : [fsPath, join(fsPath, 'index.html'), fsPath.replace(/\/$/, '') + '.html'];
    const ok = candidates.some((c) => existsSync(c) && statSync(c).isFile());
    if (!ok) broken.push(`${relative(DIST, html)}: broken link ${url}`);
  }
}

function extnameNonEmpty(p) {
  const base = p.split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0;
}

console.log(`checked ${checked} internal links across ${htmlFiles.length} pages`);
if (broken.length) {
  console.error(`BROKEN (${broken.length}):`);
  for (const b of [...new Set(broken)].slice(0, 50)) console.error('  ' + b);
  process.exit(1);
}
console.log('link check: ok');
