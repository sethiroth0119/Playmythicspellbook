#!/usr/bin/env node
/* 🔀 MULTIPLAYER GATE — run from the repo root:  node tools/mp-tests/run.mjs
   ---------------------------------------------------------------------------
   Every test file MUST be listed in TESTS below. This project has twice
   written a test, reported it green across multiple rounds, and never run it:
   fuelarb.mjs and then repairtrap.mjs (41 KB) both sat unreferenced in the
   economy runner's list. A file that is not in the array is not a gate.

   This runner also does something the economy gauntlet learned the hard way:
   it PROVES each check can fail. After the real run passes, it rebuilds
   index.html in a temp directory with ONE fix surgically reverted and requires
   the suite to go RED. A green result only means something if red is reachable
   — the first multiplayer load test passed while comparing nothing at all.
   The shipped tree is never written to; every mutation lands in a temp copy. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const INDEX = join(ROOT, 'public', 'index.html');

const TESTS = ['perspective.mjs', 'private-zones.mjs'];

/* Each entry reverts ONE shipped fix by substring surgery, and names the bug it
   reintroduces. `find` must match exactly once — if index.html is edited such
   that it matches zero or many times, that is reported as a broken proof rather
   than silently skipped, because a mutation that does not apply proves nothing. */
const MUTATIONS = [
  {
    name: 'sealedTiles / smokedTiles / delayedBlasts stop mirroring',
    find: "for (const _k of ['sealedTiles', 'smokedTiles', 'delayedBlasts']) {",
    replace: "for (const _k of []) {",
  },
  {
    name: 'delayedBlasts owner stops swapping',
    find: '? state.delayedBlasts.map(b => (b && b.owner) ? { ...b, owner: swapOwner(b.owner) } : b)',
    replace: '? state.delayedBlasts',
  },
  {
    /* Reverting this one needs care. The obvious edit — weakening the ternary
       TEST to `state._lastPlayerCounterCard && state._lastAiCounterCard` — is a
       no-op: both are truthy in the fixture, so the same branch is taken and
       the suite stayed green. That looked like an unfalsifiable check and was
       really just a mutation that did not mutate. Break the CONSEQUENT instead,
       so the field keeps the sender's own stash and never exchanges. */
    name: 'the counter-card pair stops exchanging',
    find: '{ ...state._lastAiCounterCard, owner: swapOwner(state._lastAiCounterCard.owner || \'ai\') }',
    replace: 'state._lastPlayerCounterCard',
  },
  {
    name: 'private-zone removals stop being applied (liveness)',
    find: '    if (ix < 0) continue;   // already gone (resync replay, or we never had it)',
    replace: '    if (ix < 0 || true) continue;',
  },
  {
    name: 'the op ledger stops deduping (a resync would remove a second card)',
    find: '    seen[op.id] = 1;\n    const zone =',
    replace: '    const zone =',
  },
  {
    name: 'a cross-side write loses its removal op (millEnemy)',
    find: "      for (const _mc of milled) _mpNotePrivateRemoval(state, _mc, 'deck', 'graveyard');",
    replace: '',
  },
];

const runSuite = (srcOverride) => {
  let worst = 0;
  const out = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [join(HERE, t)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: srcOverride ? { ...process.env, MP_SRC: srcOverride } : process.env,
    });
    out.push((r.stdout || '') + (r.stderr || ''));
    if (r.status !== 0) worst = r.status || 1;
  }
  return { status: worst, output: out.join('\n') };
};

// ── 1. The real run ────────────────────────────────────────────────────────
console.log('\n══ MULTIPLAYER GATE ══  ' + TESTS.length + ' test file(s): ' + TESTS.join(', '));
const real = runSuite(null);
process.stdout.write(real.output);
if (real.status !== 0) {
  console.log('❌ MP GATE FAILED — see the findings above.\n');
  process.exit(real.status);
}

// ── 2. Prove each check can fail ───────────────────────────────────────────
console.log('── falsifiability: reverting each fix in a temp copy, expecting RED ──\n');
const html = readFileSync(INDEX, 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'mp-gate-'));
let broken = 0;
try {
  for (const m of MUTATIONS) {
    const hits = html.split(m.find).length - 1;
    if (hits !== 1) {
      console.log('  ⚠ PROOF BROKEN  "' + m.name + '" — anchor matched ' + hits + ' times, expected exactly 1.');
      console.log('                  The mutation did not apply, so this check is UNPROVEN.');
      broken++;
      continue;
    }
    const copy = join(tmp, 'index.html');
    writeFileSync(copy, html.replace(m.find, m.replace));
    const r = runSuite(copy);
    if (r.status === 0) {
      console.log('  ❌ NOT PROVEN   "' + m.name + '" — suite still passed with the fix reverted.');
      broken++;
    } else {
      const n = (r.output.match(/❌/g) || []).length;
      console.log('  ✅ proven       "' + m.name + '" → ' + n + ' finding(s)');
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (broken) {
  console.log('❌ MP GATE UNSOUND — ' + broken + ' check(s) cannot be shown to fail. A green run means nothing.\n');
  process.exit(1);
}
console.log('✅ MP GATE PASSED — and every check was shown to fail when its fix is removed.\n');
process.exit(0);
