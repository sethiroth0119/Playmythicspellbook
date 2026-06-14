#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// extract-engine-data.mjs — GENERATE the shared engine's pure data catalogs
// straight from public/index.html so there is ONE source of truth and zero
// transcription drift. The browser keeps its inline `const NAME = {...}`; this
// emits an ES-module copy (engine/catalogs.gen.js) that the Node/Colyseus server
// imports. Re-run after editing any catalog in index.html.
//
//   node tools/extract-engine-data.mjs
//
// Extraction is line-anchored: each target is a TOP-LEVEL `const NAME = ...`
// whose closing brace sits at column 0 (verified formatting), so we capture from
// the declaration line through the first following line that starts with `}`.
// Nested object braces are indented, so they never false-match the closer.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'public', 'index.html');
const OUT_DIR = join(ROOT, 'engine');
const OUT = join(OUT_DIR, 'catalogs.gen.js');
// Evaluated JSON copies for consumers that can't import the ESM module directly:
// the CommonJS Colyseus server (bundled into its own src/ so it ships in the
// fly.io image) and a general engine/ copy.
const OUT_JSON = join(OUT_DIR, 'catalogs.gen.json');
const OUT_JSON_SERVER = join(ROOT, 'colyseus-server', 'src', 'engine', 'catalogs.gen.json');

// Pure-data catalogs the battle engine reads. All are top-level consts.
// Order matters — a definition must precede anything that references it
// (TYPE_CHART's IIFE reads ELEMENTS), so list dependencies first.
const TARGETS = ['STATUS_EFFECTS', 'PASSIVES', 'WEATHERBORN_PASSIVES', 'ELEMENTS', 'STRONG_VS', 'TYPE_CHART', 'MOVES'];

const html = readFileSync(SRC, 'utf8');
const lines = html.split('\n');

function extractConst(name) {
  const startRe = new RegExp('^const ' + name + ' = ');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) throw new Error('Could not find top-level `const ' + name + ' = ` in index.html');
  // Find the first following line that begins with a closer at column 0 — the
  // top-level close. Objects close `}`, arrays `]`, IIFEs `})();`. Nested
  // members are indented, so a column-0 closer is always the statement end.
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[}\])]/.test(lines[i])) { end = i; break; }
  }
  if (end === -1) throw new Error('Could not find the closing `}` for ' + name);
  const body = lines.slice(start, end + 1).join('\n');
  return body.replace(/^const /, 'export const ');
}

const header = [
  '// ╔══════════════════════════════════════════════════════════════════════╗',
  '// ║  GENERATED FILE — DO NOT EDIT BY HAND.                                ║',
  '// ║  Source of truth: public/index.html (the inline battle engine).       ║',
  '// ║  Regenerate: node tools/extract-engine-data.mjs                       ║',
  '// ║  This is the SHARED engine data the Node/Colyseus server imports so   ║',
  '// ║  it runs the exact same definitions as the browser — no drift.        ║',
  '// ╚══════════════════════════════════════════════════════════════════════╝',
  '',
].join('\n');

const blocks = TARGETS.map((name) => {
  const text = extractConst(name);
  console.log('  ✓ ' + name.padEnd(22) + ' (' + text.split('\n').length + ' lines)');
  return text;
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, header + blocks.join('\n\n') + '\n', 'utf8');
console.log('→ wrote ' + OUT);

// Evaluate the generated module and emit JSON for non-ESM consumers (the CJS
// server). TYPE_CHART is an IIFE, so we eval rather than parse — the result is
// pure data and JSON-serializable.
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());
const data = {};
for (const name of TARGETS) data[name] = mod[name];
const json = JSON.stringify(data, null, 1);
writeFileSync(OUT_JSON, json, 'utf8');
console.log('→ wrote ' + OUT_JSON);
try {
  mkdirSync(dirname(OUT_JSON_SERVER), { recursive: true });
  writeFileSync(OUT_JSON_SERVER, json, 'utf8');
  console.log('→ wrote ' + OUT_JSON_SERVER + '  (bundled into the server build)');
} catch (e) {
  console.warn('  (skipped server JSON copy: ' + e.message + ')');
}
