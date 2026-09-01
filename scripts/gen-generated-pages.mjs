#!/usr/bin/env node
// Generate the GENERATED-CLASS reference pages (constructs, error codes)
// from the engine's SYNTAX.md and FFI.md at a pinned tag.
//
// Usage: node scripts/gen-generated-pages.mjs <input-dir> <output-dir> <tag>
//   <input-dir>  holds SYNTAX.md and FFI.md (downloaded by sync-from-engine.sh)
//   <output-dir> is src/content/docs/reference
//   <tag>        e.g. v0.2.1

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [inDir, outDir, tag] = process.argv.slice(2);
if (!inDir || !outDir || !tag) {
  console.error('usage: gen-generated-pages.mjs <input-dir> <output-dir> <tag>');
  process.exit(2);
}

const root = dirname(dirname(fileURLToPath(import.meta.url))); // unused now, kept for clarity

const syntax = readFileSync(join(inDir, 'SYNTAX.md'), 'utf8');
const ffi = readFileSync(join(inDir, 'FFI.md'), 'utf8');

// ---------------------------------------------------------------------------
// constructs.md — from SYNTAX.md (strip its H1 + generation comment, retitle)
// ---------------------------------------------------------------------------

function genConstructs() {
  // Drop everything before the first "## " heading? Keep the intro
  // paragraph after the comment block. The file starts with:
  //   # title
  //   <!-- comment -->
  //   intro...
  let body = syntax.replace(/^# .*?\n/, '');
  body = body.replace(/<!--[\s\S]*?-->\n?/, '');
  // Drop the original intro paragraph (between the comment and the first
  // "## " heading) — the page's own banner replaces it.
  const firstHeading = body.indexOf('\n## ');
  if (firstHeading > 0) body = body.slice(firstHeading + 1);
  // Demote every heading one level so the page's own H1 rules.
  body = body.replace(/^## /gm, '### ').replace(/^# /gm, '## ');
  return `---
title: Construct reference
description: Every public construct of corvid and corvid-mcp — 327 engine constructs across 13 statement classes plus 51 wire constructs — each with its covering conformance tests, generated from the engine's surface manifests.
sidebar:
  order: 0
---

<!-- GENERATED FILE — do not edit by hand. Source: the engine's
     docs/SYNTAX.md at tag ${tag}, itself generated from the conformance
     surface manifests (crates/corvid/tests/surface/mod.rs and
     crates/corvid-mcp/tests/surface/mod.rs). Regenerate with
     scripts/sync-from-engine.sh ${tag} — CI verifies the committed copy
     matches the pinned tag (see .engine-pin). -->

> **generated — synced from the engine at ${tag}.** This page lists the
> complete writable surface of \`corvid\` and \`corvid-mcp\`: every public
> construct grouped by statement class (the SQL analogue is a guide, not a
> promise), each with the integration tests that pin its
> happy/edge/error/corner behavior. Construct paths are canonical Rust
> paths; \`mcp::tool::<name>\` / \`mcp::envelope::<kind>\` are wire syntax.
> Human-oriented guides: [the corvid language](/language/data-model/).

${body.trimEnd()}
`;
}

// ---------------------------------------------------------------------------
// error-codes.md — from FFI.md §1.3's frozen corvid_err block
// ---------------------------------------------------------------------------

function parseErrCodes() {
  const start = ffi.indexOf('typedef enum corvid_err');
  const end = ffi.indexOf('} corvid_err;', start);
  if (start < 0 || end < 0) throw new Error('corvid_err block not found in FFI.md');
  const block = ffi.slice(start, end);
  // Entries: NAME = value, /* comment (possibly multi-line) */
  const re = /^\s{4}(CORVID_E_[A-Z_]+)\s*=\s*(\d+),?\s*(\/\*[\s\S]*?\*\/)?\s*$/gm;
  const rows = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    const [, name, code, commentRaw] = m;
    let desc = (commentRaw || '')
      .replace(/^\/\*\s?/, '').replace(/\*\/$/, '')
      .replace(/\s+/g, ' ')
      .replace(/\*(?=\s)/g, '•') // keep nested emphasis markers visible
      .trim();
    rows.push({ name, code: Number(code), desc });
  }
  return rows;
}

function genErrorCodes() {
  const rows = parseErrCodes();
  if (rows.length < 19) throw new Error(`expected >=19 error codes, parsed ${rows.length}`);
  const table = rows
    .map(
      (r) =>
        `| \`${r.code}\` | \`${r.name}\` | ${r.desc || '—'} |`
    )
    .join('\n');
  return `---
title: Error codes
description: The frozen corvid error-code table — engine corvid::Error variants 1-18 mapped 1:1 onto C ABI codes, plus the FFI-only CORVID_E_BUSY (19); generated from the engine's FFI spec.
sidebar:
  order: 1
---

<!-- GENERATED FILE — do not edit by hand. Source: the engine's
     docs/FFI.md §1.3 frozen code table at tag ${tag}. Regenerate with
     scripts/sync-from-engine.sh ${tag} — CI verifies the committed copy
     matches the pinned tag (see .engine-pin). -->

> **generated — synced from the engine at ${tag}.** The detailed codes
> returned by \`corvid_last_error_code()\`. Value 0 means "no error recorded
> on this thread". Codes 1–18 map 1:1 onto the engine's
> \`corvid::Error\` variants (pinned by the variant-inventory snapshot
> test); code 19 is FFI-only. **Never renumbered; new values only appended
> (20+).** The error model itself: [errors & NULL discipline](/ffi/errors/).

| Code | Name | Meaning |
|---|---|---|
${table}

In Rust, the same failures surface as the typed \`corvid::Error\` enum
(\`thiserror\`, \`#[non_exhaustive]\`); methods return
\`corvid::Result<T>\`. Bindings map the code to native exceptions
(corvid-node exports this table as \`ErrorCode\`).
`;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'constructs.md'), genConstructs());
writeFileSync(join(outDir, 'error-codes.md'), genErrorCodes());
console.log(`generated constructs.md + error-codes.md (engine tag ${tag}) into ${outDir}`);
