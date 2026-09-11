#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check.mjs — THE gate. Run this before every commit that touches game logic or
// data. It chains every existing check in the repo with the gamedev ones, in
// the order that fails fastest, and prints one verdict.
//
//   node tools/gamedev/check.mjs           # everything
//   node tools/gamedev/check.mjs --quick   # syntax + runtime + lint only (~5 s)
//   node tools/gamedev/check.mjs --fix     # also regenerate engine catalogs first
//
// Steps
//   1. _synckcheck.mjs      — every inline <script> in index.html parses (terser)
//   2. _harness.js          — the inline script EXECUTES top-level (TDZ / const-order crashes)
//   3. extract --check      — engine/colyseus catalogs are current   (--fix regenerates)
//   4. lint.mjs             — id cross-references, registry⇄resolver parity, cardsets
//   5. effects.mjs          — every on-play effect runs headless; none throw; no new quiet
//   6. damage.mjs --golden  — the damage formula still matches the locked goldens
//   7. sw/version knobs     — public/version.txt, BUILD_VERSION and sw.js CACHE_VERSION agree
//
// Never weaken a step to get green — fix the code, or if the step is wrong, fix
// the step and say so in the commit.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, argFlag } from './headless.mjs';

const quick = argFlag('quick');
const steps = [];
const run = (name, cmd, args, opts = {}) => steps.push({ name, cmd, args, ...opts });

if (argFlag('fix')) run('regenerate engine catalogs', process.execPath, [join(ROOT, 'tools', 'extract-engine-data.mjs')]);
run('syntax   (_synckcheck.mjs)',      process.execPath, [join(ROOT, '_synckcheck.mjs'), join(ROOT, 'public', 'index.html')]);
run('runtime  (_harness.js)',          process.execPath, [join(ROOT, '_harness.js'), join(ROOT, 'public', 'index.html')]);
run('engine   (extract --check)',      process.execPath, [join(ROOT, 'tools', 'extract-engine-data.mjs'), '--check']);
run('lint     (gamedev/lint.mjs)',     process.execPath, [join(ROOT, 'tools', 'gamedev', 'lint.mjs')]);
if (!quick) {
  run('effects  (gamedev/effects.mjs)', process.execPath, [join(ROOT, 'tools', 'gamedev', 'effects.mjs'), '--strict']);
  run('damage   (gamedev/damage.mjs --golden)', process.execPath, [join(ROOT, 'tools', 'gamedev', 'damage.mjs'), '--golden']);
  run('versions (version.txt / BUILD_VERSION / CACHE_VERSION)', null, null, { fn: versionKnobs });
}

// Deploy bumps three knobs together or the update check breaks (CLAUDE.md). Fail
// if they disagree — this is the exact mistake that ships a stale service worker.
function versionKnobs() {
  const txt = readFileSync(join(ROOT, 'public', 'version.txt'), 'utf8').trim();
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
  const sw = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');
  const bv = (html.match(/window\.BUILD_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  const cv = (sw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  const norm = (s) => (s || '').replace(/^v/i, '').trim();
  const out = 'version.txt=' + txt + '  BUILD_VERSION=' + bv + '  CACHE_VERSION=' + cv;
  const agree = bv && cv && norm(txt) === norm(bv) && (norm(cv) === norm(bv) || cv.includes(norm(bv)));
  return { ok: !!agree, out: out + (agree ? '' : '\n  ✗ the three deploy knobs disagree — bump them together') };
}

let failed = 0;
const t0 = Date.now();
for (const s of steps) {
  const t = Date.now();
  let ok, out;
  if (s.fn) { try { ({ ok, out } = s.fn()); } catch (e) { ok = false; out = e.message; } }
  else { const r = spawnSync(s.cmd, s.args, { encoding: 'utf8', cwd: ROOT }); ok = r.status === 0; out = (r.stdout || '') + (r.stderr || ''); }
  const ms = Date.now() - t;
  console.log((ok ? '✓ ' : '✗ ') + s.name.padEnd(52) + (ms + ' ms').padStart(9));
  if (!ok || argFlag('verbose')) {
    const tail = out.trim().split('\n');
    const shown = argFlag('verbose') ? tail : tail.slice(-25);
    console.log(shown.map((l) => '    ' + l).join('\n'));
  }
  if (!ok) failed++;
}
console.log('\n' + (failed ? '✗ ' + failed + ' of ' + steps.length + ' checks FAILED' : '✓ all ' + steps.length + ' checks passed') + '   (' + (Date.now() - t0) + ' ms total)');
process.exit(failed ? 1 : 0);
