#!/usr/bin/env node
/* 📚 MOVESET MERGE — the gate on "my new move didn't save".
   ---------------------------------------------------------------------------
   Run:  node tools/mp-tests/move-merge.mjs   (or via tools/mp-tests/run.mjs)

   THE BUG THIS EXISTS FOR, reported repeatedly and never actually closed.
   The cloud/local merge picked the moveset by LENGTH, on this reasoning:

       // Moves only ever GET LEARNED, so the longer list is the newer one

   Moves do not only ever get learned. A unit at the MAX_KNOWN_MOVES cap does
   not gain a fifth — it SWAPS one out, and the length is identical before and
   after. So for every unit with a full moveset the comparison was false, the
   local swap lost, and the cloud's pre-swap list came back. A unit BELOW the
   cap grew its array and survived, which is exactly why every report was about
   units that already had four moves.

   The merge now prefers `movesAt`, a stamp written whenever a moveset changes.
   The cases below are the ones that were wrong, plus the ones a naive stamp
   fix would get wrong next.

   ⚠ EVERY CASE HERE USES EQUAL-LENGTH MOVESETS unless it is specifically
     testing length. A swap is the whole point; a test built on growing arrays
     would pass against the OLD code and prove nothing.
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.MP_SRC || join(ROOT, 'public', 'index.html');
const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');

function extractFn(name) {
  const start = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (start === -1) throw new Error('could not find top-level `function ' + name + '(` in index.html');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('}')) { end = i; break; }
  if (end === -1) throw new Error('no column-0 closing brace for ' + name);
  return lines.slice(start, end + 1).join('\n');
}
const { _mergeMoveRow } = new Function(extractFn('_mergeMoveRow') + '\nreturn { _mergeMoveRow };')();

const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail: cond ? '' : detail });
const ids = (r) => (r && r.knownMoves || []).join(',');

const FOUR_OLD = ['a', 'b', 'c', 'd'];
const FOUR_NEW = ['a', 'b', 'c', 'NEW'];      // a SWAP: same length, one id changed

// ── 1. THE REPORTED BUG ────────────────────────────────────────────────────
{
  // Local swapped at the cap and stamped it; cloud still holds the old four.
  const loc = { knownMoves: FOUR_NEW, knownMovesAuto: false, movesAt: 2000 };
  const rem = { knownMoves: FOUR_OLD, movesAt: 1000 };
  const m = _mergeMoveRow(loc, rem);
  check('a full-moveset SWAP survives the cloud merge', ids(m) === 'a,b,c,NEW', 'got ' + ids(m));
  check('the swap keeps its stamp', m.movesAt === 2000, 'movesAt ' + m.movesAt);
  check('the loadout stays hand-picked', m.knownMovesAuto === false, 'auto ' + m.knownMovesAuto);
}
// And the reverse: the cloud is genuinely newer, so it must win.
{
  const loc = { knownMoves: FOUR_OLD, knownMovesAuto: false, movesAt: 1000 };
  const rem = { knownMoves: FOUR_NEW, knownMovesAuto: false, movesAt: 5000 };
  const m = _mergeMoveRow(loc, rem);
  check('a NEWER cloud swap wins', ids(m) === 'a,b,c,NEW', 'got ' + ids(m));
}
// Two devices, same length, both stamped — the later one wins, not the longer.
{
  const A = { knownMoves: ['a', 'b', 'c', 'X'], knownMovesAuto: false, movesAt: 900 };
  const B = { knownMoves: ['a', 'b', 'c', 'Y'], knownMovesAuto: false, movesAt: 901 };
  check('later stamp beats earlier at equal length', ids(_mergeMoveRow(A, B)) === 'a,b,c,Y', 'got ' + ids(_mergeMoveRow(A, B)));
  check('and symmetrically the other way', ids(_mergeMoveRow(B, A)) === 'a,b,c,Y', 'got ' + ids(_mergeMoveRow(B, A)));
}

// ── 2. ONE SIDE STAMPED — the rollout case ─────────────────────────────────
// Rows written before stamps existed have none. A stamped row was written by
// the build that stamps, so it is the later one.
{
  const loc = { knownMoves: FOUR_NEW, knownMovesAuto: false, movesAt: 1 };
  const rem = { knownMoves: FOUR_OLD };
  check('a stamped local beats an unstamped cloud', ids(_mergeMoveRow(loc, rem)) === 'a,b,c,NEW',
    'got ' + ids(_mergeMoveRow(loc, rem)));
}
{
  const loc = { knownMoves: FOUR_OLD, knownMovesAuto: false };
  const rem = { knownMoves: FOUR_NEW, movesAt: 1 };
  check('a stamped cloud beats an unstamped local', ids(_mergeMoveRow(loc, rem)) === 'a,b,c,NEW',
    'got ' + ids(_mergeMoveRow(loc, rem)));
}

// ── 3. NEITHER STAMPED — the legacy save ───────────────────────────────────
// Length cannot prove a swap, so the hand-picked flag is what rescues it.
{
  const loc = { knownMoves: FOUR_NEW, knownMovesAuto: false };
  const rem = { knownMoves: FOUR_OLD };
  check('legacy: local custom beats remote auto at equal length',
    ids(_mergeMoveRow(loc, rem)) === 'a,b,c,NEW', 'got ' + ids(_mergeMoveRow(loc, rem)));
}
{
  // Both auto, equal length, no stamps — nothing distinguishes them, so the
  // cloud stands. Asserted so a future change has to mean it.
  const loc = { knownMoves: FOUR_NEW };
  const rem = { knownMoves: FOUR_OLD };
  check('legacy: two auto rows fall back to the cloud',
    ids(_mergeMoveRow(loc, rem)) === 'a,b,c,d', 'got ' + ids(_mergeMoveRow(loc, rem)));
}
{
  // The ORIGINAL rule, still correct where it applies: a genuinely longer local
  // list (learned below the cap) wins when nothing is stamped.
  const loc = { knownMoves: ['a', 'b', 'c'] };
  const rem = { knownMoves: ['a', 'b'] };
  check('legacy: a longer local list still wins', ids(_mergeMoveRow(loc, rem)) === 'a,b,c',
    'got ' + ids(_mergeMoveRow(loc, rem)));
}

// ── 4. knownMovesAuto IS STICKY-FALSE ──────────────────────────────────────
{
  // Even when the CLOUD moveset wins, a local hand-pick must not revert to auto.
  const loc = { knownMoves: FOUR_OLD, knownMovesAuto: false, movesAt: 1 };
  const rem = { knownMoves: FOUR_NEW, movesAt: 999 };
  const m = _mergeMoveRow(loc, rem);
  check('cloud moveset can win while the custom flag survives',
    ids(m) === 'a,b,c,NEW' && m.knownMovesAuto === false, ids(m) + ' auto=' + m.knownMovesAuto);
}

// ── 5. OTHER FIELDS, AND HOSTILE ROWS ──────────────────────────────────────
{
  const loc = { knownMoves: FOUR_NEW, movesAt: 9, level: 3, xp: 40 };
  const rem = { knownMoves: FOUR_OLD, level: 7, xp: 900 };
  const m = _mergeMoveRow(loc, rem);
  check('non-move fields still come from the cloud', m.level === 7 && m.xp === 900,
    'level ' + m.level + ' xp ' + m.xp);
}
{
  const m = _mergeMoveRow({ knownMoves: 'not-an-array', movesAt: 5 }, { knownMoves: FOUR_OLD });
  check('a non-array local moveset cannot win', ids(m) === 'a,b,c,d', 'got ' + ids(m));
  const m2 = _mergeMoveRow({}, {});
  check('two empty rows do not throw', m2 && typeof m2 === 'object', 'threw or returned junk');
}

const failed = results.filter(r => !r.ok);
console.log('\n📚 MOVESET MERGE — ' + results.length + ' properties\n');
for (const r of results) console.log('  ' + (r.ok ? '✅' : '❌') + ' ' + r.name + (r.ok ? '' : '  → ' + r.detail));
if (failed.length) { console.log('\n  ' + failed.length + ' failed.\n'); process.exit(1); }
console.log('\n  ✅ a swap at the move cap survives the cloud merge.\n');
process.exit(0);
