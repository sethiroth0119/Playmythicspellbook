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
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const INDEX = join(ROOT, 'public', 'index.html');

const TESTS = ['perspective.mjs', 'private-zones.mjs', 'citytrade.mjs', 'trade-modal.mjs', 'move-merge.mjs', 'node-daycap.mjs', 'builtins.mjs'];

/* Mutations may target a file OTHER than index.html — /src/citytrade/plan.js is
   a real ES module, not an extracted function, so its proof works by swapping
   the module itself. `file` is repo-relative and defaults to public/index.html.
   The copy is written to a mirror path under the temp dir so a module's own
   relative imports still resolve. */
const DEFAULT_TARGET = 'public/index.html';

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
  {
    /* The property-losing shape: shipping 40 of 100 because that is all there
       was. Turn the refusal into a partial and the suite must go red.

       ⚠ A PROOF CAN PASS FOR THE WRONG REASON, and this one did. The first
         version replaced the `return` with `left = need;`, which is a TDZ error
         (`left` is declared below it) — so the module threw ReferenceError, the
         run went red, and the mutation was scored "proven" while demonstrating
         nothing about whether the test can SEE a part-delivery. A mutation that
         crashes the code under test proves only that the test executes it.
         Neutering the CONDITION instead lets the function run to completion and
         return a genuine partial, which is the thing the assertion is for.
         Check that a red mutation is red for the reason you intended. */
    name: 'planDraw part-delivers instead of refusing',
    file: 'public/src/citytrade/plan.js',
    find: '  if (available < need) {',
    replace: '  if (false) {',
  },
  {
    /* Make the cycle index depend on what has been settled rather than on the
       clock, which is how two offline clients start disagreeing about which
       cycle is which and the unique constraint stops guarding anything. */
    name: 'cycle count stops being a function of the clock',
    file: 'public/src/citytrade/plan.js',
    find: '  const fired = Math.min(total, Math.floor(elapsed / periodMs));',
    replace: '  const fired = Math.min(total, (settled || []).length + 1);',
  },
  {
    /* Put the ORIGINAL bug back: decide the moveset by length alone. A swap at
       the move cap does not change the length, so the local choice loses and
       the cloud's pre-swap list returns — the "my new move didn't save" report.
       If this does not redden, the gate is not testing the thing it exists for. */
    name: 'the moveset merge goes back to picking by length',
    find: '    if (la || ra) takeLocal = la > ra;                       // 1 + 2',
    replace: '    if (false) takeLocal = false;',
  },
  {
    /* The root cause of the placeholder cards on the camp Table: the admin
       grant stuffed every built-in pool into Profile.cardCollection, and the
       Table reads that collection directly. Ungate it and the grant returns. */
    name: 'the admin grant stops honouring the built-in flag',
    find: '      if (!_hideBuiltins()) {',
    replace: '      if (true) {',
  },
  {
    /* And the surface itself. Without this line the Table lists any built-in
       an older save already owns, which is precisely the reported bug. */
    name: 'the camp Table stops skipping built-in ids',
    find: '        if (_isBuiltinCardId(id)) continue;      // placeholders get no seat at the Table',
    replace: '',
  },
  {
    /* Put back the fail-closed reading of an absent tier: rate 0 → cap 0 rather
       than "no cap". That is the bug I nearly shipped — one guarded module
       404ing would have clamped every PRN payout to nothing. The suite must go
       red on it, or the gate is not guarding the direction that locks players
       out of their own money. */
    name: 'an absent tier means a ZERO daily cap instead of none',
    find: '    if (!isFinite(rate) || rate <= 0) return Infinity;',
    replace: '    if (!isFinite(rate) || rate <= 0) return 0;',
  },
];

const runSuite = (srcOverride, cwdOverride) => {
  let worst = 0;
  const out = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [join(HERE, t)], {
      // A module mutation runs the suite against a MIRRORED tree, so the tests'
      // own `../../public/src/...` imports resolve to the mutated copy.
      cwd: cwdOverride || ROOT,
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
/* Normalised to LF. A merge or a fresh checkout can hand this file CRLF — that
   happened on the city-builder merge and silently broke the one multi-line
   anchor below, reporting a real check as UNPROVEN. The anchors are written with
   \n, so the input has to be. */
const html = readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'mp-gate-'));
let broken = 0;
try {
  for (const m of MUTATIONS) {
    const target = m.file || DEFAULT_TARGET;
    const source = target === DEFAULT_TARGET
      ? html
      : readFileSync(join(ROOT, target), 'utf8').replace(/\r\n/g, '\n');
    const hits = source.split(m.find).length - 1;
    if (hits !== 1) {
      console.log('  ⚠ PROOF BROKEN  "' + m.name + '" — anchor matched ' + hits + ' times in ' + target + ', expected exactly 1.');
      console.log('                  The mutation did not apply, so this check is UNPROVEN.');
      broken++;
      continue;
    }
    const mutated = source.replace(m.find, m.replace);
    let r;
    if (target === DEFAULT_TARGET) {
      // index.html is reached through MP_SRC, so a bare copy is enough.
      const copy = join(tmp, 'index.html');
      writeFileSync(copy, mutated);
      r = runSuite(copy, null);
    } else {
      /* A MODULE is imported by relative path, so it has to be mutated inside a
         MIRROR of the tree — never in place. Editing the shipped file and
         restoring afterwards is the shape that has already bitten this repo
         once (deploy.mjs minifying index.html in place, where an interrupted
         run left a 9 MB tree). A mirror cannot leave wreckage behind. */
      const mirror = mkdtempSync(join(tmpdir(), 'mp-mut-'));
      try {
        cpSync(HERE, join(mirror, 'tools', 'mp-tests'), { recursive: true });
        const dest = join(mirror, target);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, mutated);
        r = spawnSync(process.execPath, [join(mirror, 'tools', 'mp-tests', 'citytrade.mjs')],
          { cwd: mirror, encoding: 'utf8' });
        r = { status: r.status || 0, output: (r.stdout || '') + (r.stderr || '') };
      } finally {
        rmSync(mirror, { recursive: true, force: true });
      }
    }
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
