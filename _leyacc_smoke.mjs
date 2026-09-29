/* ══════════════════════════════════════════════════════════════════════════
   LEY ACCURACY — is the rule REACHED, not merely correct.

   WHY THIS EXISTS. `MythicLey.accuracyMod` shipped written, argued, capped,
   symmetric and covered by _ley_smoke §14 — with ZERO callers. A repo-wide grep
   returned three hits, all inside ley.js: a comment, the definition, the export.
   `git log -S accuracyMod -- public/index.html` was EMPTY: it had never been
   wired, in any commit. Every existing check was green the whole time, because
   they exercised the function directly and none of them asked whether the game
   ever reached it.

   That is the failure shape this repo hit eight separate times in two days: a
   check that runs, exits 0, and answers a question ONE DEGREE from the one that
   mattered. "Is the rule correct" is not "does the rule fire".

   So this suite tests the WIRING, not the arithmetic — _ley_smoke already owns
   the arithmetic. And every assertion here carries a NEGATIVE CONTROL that is
   run FIRST: the check is shown failing against a deliberately broken copy
   before it is trusted against the real file. A gate nobody has seen fail is
   not evidence.

   Usage:  node _leyacc_smoke.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (msg, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (detail ? '  <-- ' + detail : '')); }
};

const IDX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const LEY = fs.readFileSync(path.join(ROOT, 'public/src/battle/ley.js'), 'utf8');

/* The predicate under test, isolated so the negative control can run the SAME
   code against a mutated string. A control that re-implements the check is
   testing a second implementation, not the one that ships. */
const hasCallSite = src => /_MA\s*\.\s*accuracyMod\s*\(|\.accuracyMod\s*\(\s*App\.state/.test(src);
const foldsIntoAccuracy = src => /accuracy\s*\+=\s*_leyAcc\s*\.\s*pts/.test(src);
/* The call must sit BEFORE the roll, or it cannot affect the dice. The roll is
   the `Math.random() * 100 >= accuracy` line. */
const beforeTheRoll = src => {
  const call = src.indexOf('_MA.accuracyMod');
  const roll = src.indexOf('Math.random() * 100 >= accuracy');
  return call > 0 && roll > 0 && call < roll;
};

console.log('--- 0. negative controls (each check must be seen to FAIL) ---');
{
  const stripped = IDX.replace(/_leyAcc\s*=\s*_MA\.accuracyMod\([^)]*\);/, '_leyAcc = null;')
                      .replace(/accuracy\s*\+=\s*_leyAcc\.pts;/, '');
  ok('the call-site check FAILS when the call is removed', !hasCallSite(stripped),
     'the predicate matches a file with no call — it is not testing the call');
  ok('the fold check FAILS when the += is removed', !foldsIntoAccuracy(stripped),
     'the predicate matches a file that never adds pts to accuracy');

  /* And the inverse: a file where the call sits AFTER the roll must fail the
     ordering check, or "before the roll" is not being measured at all. */
  const moved = 'x Math.random() * 100 >= accuracy ; y _MA.accuracyMod(App.state) z';
  ok('the ordering check FAILS when the call is after the roll', !beforeTheRoll(moved),
     'ordering is not actually being measured');

  if (fail){ console.log('\n🔴 NEGATIVE CONTROLS FAILED. Refusing to report on the real file.'); process.exit(1); }
}

console.log('\n--- 1. the rule is REACHED by the game ---');
ok('accuracyMod is called from public/index.html', hasCallSite(IDX),
   'ZERO callers — the rule exists and never fires. This is the bug this suite exists for.');
ok('its pts are folded into `accuracy`', foldsIntoAccuracy(IDX));
ok('the call happens BEFORE the accuracy roll', beforeTheRoll(IDX),
   'the dice are rolled before the term is applied, so the term does nothing');

/* One call site, not two. The damage rule's own comment forbids a second ley
   multiplier at another site and the same argument applies here: two sites
   means two opinions about the same cliff. */
ok('exactly ONE call site', (IDX.match(/\.accuracyMod\s*\(/g) || []).length === 1,
   'more than one caller — height would be charged twice');

console.log('\n--- 2. the module still holds up its end ---');
ok('accuracyMod is exported', /accuracyMod\s*:\s*accuracyMod/.test(LEY));
ok('it is RANGED-ONLY, matching damageMod', /dist\(attacker\.pos,\s*defender\.pos\)\s*<=\s*1\)\s*return out/.test(LEY),
   'melee scope drifted from the damage rule — §5.3(d) requires they agree');
ok('it is capped through clampAcc', /clampAcc\(/.test(LEY));
ok('it shares ELEV_MAX_RUNGS with the damage rule', /ELEV_MAX_RUNGS/.test(LEY),
   'a separate cap means damage and accuracy stop scaling at different cliffs');

console.log('\n--- 3. it is symmetric (the §5.3 clause a critic checks) ---');
{
  /* Exercise the real module rather than reasoning about it. ley.js is an IIFE
     that registers on a global; give it one and read the export table back. */
  const g = { window: {}, console };
  g.window.window = g.window;
  /* ⚠ SUPPLY THE HEX DISTANCE THROUGH THE MODULE'S OWN wire() BRIDGE — not
     window.distance, which is what I reached for first and which does nothing.
     ley.js keeps an internal bridge object `W` with `distance: null`, wired
     from index.html (the CLAUDE.md globals trap: index.html's `distance` is a
     top-level const and therefore NOT on window, so the module cannot see it
     and must be handed it). Setting window.distance in a harness is invisible
     to the module.

     AND THE REASON THIS MATTERS BEYOND THE TEST: ley.js's dist() falls back to
     `(same tile) ? 0 : 2` whenever the bridge is unwired. That fallback makes
     EVERY pair of distinct positions read as range 2, so the ranged-only guard
     never fires and melee silently starts taking the high-ground accuracy term
     — exactly the §5.3(d) disagreement between the damage and accuracy rules
     that the bar forbids. It cost one red assertion here; unwired in the game
     it would cost a rule nobody could explain.
     Odd-r offset → cube, per .gauntlet/HEXSPEC.md §2. */
  const HEXDIST = (a, b) => {
    const cx = p => p.x - ((p.y - (p.y & 1)) >> 1);
    const ax = cx(a), az = a.y, ay = -ax - az;
    const bx = cx(b), bz = b.y, by = -bx - bz;
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
  };
  try {
    new Function('window', 'console', LEY)(g.window, console);
  } catch (e) { ok('ley.js evaluates', false, e.message); }

  const M = g.window.MythicLey;
  if (M && typeof M.wire === 'function') M.wire({ distance: HEXDIST });
  ok('MythicLey registered', !!M);
  if (M && typeof M.accuracyMod === 'function'){
    /* A board where rungs come straight off the tile, two apart, at range. */
    const mk = (x, r) => ({ pos: { x, y: 0 }, _r: r });
    const state = { board: [[{ elevRung: 2 }, {}, {}, {}, { elevRung: 0 }]] };
    state.board[0][0].elevRung = 2; state.board[0][4].elevRung = 0;
    const hi = { pos: { x: 0, y: 0 } }, lo = { pos: { x: 4, y: 0 } };
    const down = M.accuracyMod(state, hi, lo);
    const up   = M.accuracyMod(state, lo, hi);
    ok('downhill and uphill are opposite in sign (or both inert)',
       !down || !up || (down.pts === -up.pts),
       `down ${down && down.pts} vs up ${up && up.pts} — §5.3 requires symmetry`);
    /* Melee must be inert in BOTH directions. */
    const near = M.accuracyMod(state, { pos: { x: 0, y: 0 } }, { pos: { x: 1, y: 0 } });
    ok('adjacent (melee) is inert', !near || near.pts === 0,
       'melee is picking up a height term the damage rule does not give it');
  }
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
