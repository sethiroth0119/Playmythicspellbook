#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// extract-duel-data.mjs — GENERATE the data catalogs the Duel of Roses
// prototype (public/duel + public/src/duel) runs on, straight from
// public/index.html. Same line-anchored approach as extract-engine-data.mjs,
// which it deliberately mirrors rather than imports: that script also writes
// the Colyseus server copy, and a prototype must never be able to touch the
// server's catalogs by accident.
//
//   node tools/extract-duel-data.mjs          # regenerate
//   node tools/extract-duel-data.mjs --check  # CI/drift guard, writes nothing
//
// WHY a generated file inside public/src/duel and not an import of
// engine/catalogs.gen.js: `public/` is the deploy root (Cloudflare Workers
// Assets). Anything outside it is simply not served, so a browser module cannot
// import from ../engine. Copying by hand would drift within a week; generating
// keeps the prototype honest to the live game's numbers.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'public', 'index.html');
const OUT_DIR = join(ROOT, 'public', 'src', 'duel');
const OUT = join(OUT_DIR, 'catalogs.gen.js');

// Dependency order matters: TYPE_CHART's IIFE reads ELEMENTS and STRONG_VS.
// UNIT_CARDS is the prototype-specific addition — the base roster the duel
// decks are built from.
const TARGETS = ['STATUS_EFFECTS', 'PASSIVES', 'ELEMENTS', 'STRONG_VS', 'TYPE_CHART', 'TYPE_IMMUNITIES', 'MOVES', 'UNIT_CARDS'];

const lines = readFileSync(SRC, 'utf8').split('\n');

function extractConst(name) {
  const startRe = new RegExp('^const ' + name + ' = ');
  const start = lines.findIndex((l) => startRe.test(l));
  if (start === -1) throw new Error('Could not find top-level `const ' + name + ' = ` in index.html');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[}\])]/.test(lines[i])) { end = i; break; }
  }
  if (end === -1) throw new Error('Could not find the closing bracket for ' + name);
  return lines.slice(start, end + 1).join('\n').replace(/^const /, 'export const ');
}

const header = [
  '// ╔══════════════════════════════════════════════════════════════════════╗',
  '// ║  GENERATED FILE — DO NOT EDIT BY HAND.                                ║',
  '// ║  Source of truth: public/index.html (the inline battle engine).       ║',
  '// ║  Regenerate: node tools/extract-duel-data.mjs                         ║',
  '// ║  Data the Duel of Roses prototype plays with — identical to the live  ║',
  '// ║  game so the prototype is a rules experiment, not a balance fork.     ║',
  '// ╚══════════════════════════════════════════════════════════════════════╝',
  '',
].join('\n');

const blocks = TARGETS.map((name) => {
  const text = extractConst(name);
  console.log('  ✓ ' + name.padEnd(18) + ' (' + text.split('\n').length + ' lines)');
  return text;
});
const out = header + blocks.join('\n\n') + '\n';

// Sanity: the extracted blocks must evaluate as a unit (catches a moved closer).
new Function(out.replace(/^export const /gm, 'const ') + '\nreturn {' + TARGETS.join(', ') + '};')();

if (process.argv.includes('--check')) {
  let committed = '';
  try { committed = readFileSync(OUT, 'utf8'); } catch (e) {}
  if (committed !== out) {
    console.error('\n✗ STALE: public/src/duel/catalogs.gen.js is out of date with public/index.html.');
    console.error('  Run:  node tools/extract-duel-data.mjs\n');
    process.exit(1);
  }
  console.log('✓ Duel catalogs are current with index.html.');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, out, 'utf8');
console.log('→ wrote ' + OUT);
