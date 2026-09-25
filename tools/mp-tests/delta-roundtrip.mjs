#!/usr/bin/env node
/* 📦 DELTA ROUND-TRIP — is _applyStateDelta the exact inverse of _computeStateDelta?
   ---------------------------------------------------------------------------
   Run:  node tools/mp-tests/delta-roundtrip.mjs     (or via tools/mp-tests/run.mjs)

   WHY THIS EXISTS
   Multiplayer does not send the whole board on every action. The first
   broadcast of a turn is a full snapshot; every packet after it is a DELTA
   against that snapshot, and the receiver patches its own copy with it. So the
   pair (_computeStateDelta, _applyStateDelta) is a codec, and a codec whose
   decoder does not implement its encoder loses data silently — there is no
   error, no dropped packet, nothing to notice. The two sides just stop agreeing.

   And they had. Each half carried its OWN hand-written list of keys:
     · compute diffed 17 unit fields and 9 top-level keys
     · apply patched a DIFFERENT 9
   `_atkFx` was on the send list and not the receive list, so the attack
   cinematic was computed, serialized, shipped and thrown away. Worse, the whole
   BOARD (surfaces, walls, traps), controlPoints, cpScore, graveLock,
   enchantments, delayedBlasts, _counterChain, _lastMove, _mpPrivateRemovals,
   unit.equipment, unit._bleeding and unit.walkPath were on NEITHER list.
   Measured through the shipped pair: 3 of 17 state fields round-tripped and 14
   were lost on every hop.

   WHY THAT MATTERED MORE THAN IT SOUNDS. The end-of-turn handoff is ALWAYS a
   delta — it changes turnNumber / currentTurn / turn, which were on the
   whitelist — so a turn that built a wall, lit a surface or took a control
   point but summoned and killed nothing (units.length unchanged, so no bail to
   a full snapshot) handed the opponent a board on which none of it had
   happened. And it did not heal: the sender advances its baseline to the full
   next snapshot while the receiver advances to the PATCHED one, so every later
   delta was computed against a state the receiver did not have.

   ⚠ THE MEASUREMENT SUBTLETY THAT MAKES A BROKEN CODEC LOOK FINE.
     If a mutation changes ONLY a key that neither list mentions, the old
     _computeStateDelta found no changes at all and returned null — and null
     means "send a full snapshot", which loses nothing. So a probe that mutates
     one field in isolation reports FULL, not LOST, and the codec looks
     healthy. Real actions never do that: they also write a log line, bump a
     counter, move a unit. Every case below therefore carries a log line the way
     an action does, and the FULL-fallback count is reported separately from the
     LOST count so the two can never be confused again.

   ⚠ AND THE FIX THAT WOULD PASS THIS FILE WHILE RUINING THE GAME.
     "Return null unconditionally" makes the codec lossless and turns every
     packet into a 30 KB full snapshot. So fidelity is not the only thing
     checked here: BANDWIDTH is checked too (§4), and the negative control in §5
     proves this file can actually go red.
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* MP_SRC points the extraction at a DIFFERENT copy of index.html — run.mjs sets
   it to a copy with one shipped fix reverted, to prove each check can fail. */
const SRC = process.env.MP_SRC || join(ROOT, 'public', 'index.html');

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '   ' + detail : ''));
};

/* Extract the REAL functions from index.html, line-anchored exactly the way
   tools/mp-tests/perspective.mjs does it: a top-level `function NAME(` through
   the first following line beginning with `}` at column 0. Testing the shipped
   source rather than a transcription is the point — a copy drifts and the gate
   then guards nothing. Normalised to LF: a merge can hand this file CRLF and a
   stray \r on every line leaks into the extracted source. */
const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
function extractFn(name) {
  const start = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (start === -1) throw new Error('could not find top-level `function ' + name + '(` in ' + SRC);
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('}')) { end = i; break; }
  if (end === -1) throw new Error('could not find the column-0 closing brace of ' + name);
  return lines.slice(start, end + 1).join('\n');
}
/* _applyStateDelta calls _surfaceOpponentDeltaFeedback (toasts + damage flashes)
   inside a try — it is UI, it is not part of the codec, and it is stubbed. */
const { _computeStateDelta, _applyStateDelta } = new Function(
  '_surfaceOpponentDeltaFeedback',
  ['_computeStateDelta', '_applyStateDelta'].map(extractFn).join('\n')
  + '\nreturn { _computeStateDelta, _applyStateDelta };'
)(() => {});

const clone = (o) => JSON.parse(JSON.stringify(o));
const BOARD_W = 14, BOARD_H = 12;   // index.html: `const BOARD_W = 14, BOARD_H = 12`

/* THE FIXTURE — one snapshot carrying every class of field the battle engine
   actually writes and the broadcast serializer actually ships. Shapes are taken
   from index.html itself (_cpSeedControlPoints for controlPoints, _setSurface
   for board[y][x].surface, moveUnit for walkPath, and so on) so a field that
   round-trips here round-trips in a match.
   `_seq` is deliberately present: broadcastMyState stores the sender's baseline
   as `{ ...snapshot, _seq: n }` while a fresh snapshot has no _seq at all, so
   every real diff sees a key on one side only. §3 pins that. */
const fixture = () => ({
  _seq: 7,
  turnNumber: 4, currentTurn: 'player', turn: 'player', turn_who: 'player',
  gameOver: null, comboHits: 0,
  log: [{ msg: 'baseline', color: 'grey' }],
  weather: { id: 'rain', turnsLeft: 3 },
  activeLocation: { id: 'ruins' },
  units: [
    { id: 'u1', owner: 'player', isHero: true, name: 'Ava', currentHp: 30, maxHp: 30,
      pos: { x: 2, y: 9 }, hasMoved: false, hasAttacked: false, alive: true,
      statusEffects: [], stats: { atk: 4, def: 2 }, passives: ['speed'],
      equipment: [{ id: 'blade', slot: 'weapon' }], _bleeding: 0, walkPath: null },
    { id: 'u2', owner: 'ai', isHero: false, name: 'Grunt', currentHp: 12, maxHp: 12,
      pos: { x: 11, y: 2 }, hasMoved: false, hasAttacked: false, alive: true,
      statusEffects: [{ id: 'burn', turnsLeft: 2 }], stats: { atk: 3, def: 1 }, passives: [],
      equipment: [], _bleeding: 0, walkPath: null },
  ],
  board: Array.from({ length: BOARD_H }, (_, y) =>
    Array.from({ length: BOARD_W }, (_, x) => ({ x, y, location: null, trap: null, event: null }))),
  player: { hand: [{ instanceId: 'c1', cardId: 'strike', name: 'Strike' }], deck: [], graveyard: [], energy: 3 },
  ai:     { hand: [{ instanceId: 'c9', cardId: 'bolt', name: 'Bolt' }], deck: [], graveyard: [], energy: 3 },
  controlPoints: [
    { id: 'cp1', label: 'A', name: 'SCP-A', x: 3, y: 7, holder: null, scored: { player: false, ai: false } },
    { id: 'cp2', label: 'B', name: 'SCP-B', x: 9, y: 5, holder: null, scored: { player: false, ai: false } },
  ],
  cpScore: { player: 0, ai: 0 },
  cpStreak: { player: 0, ai: 0 },
  graveLock: { player: 0, ai: 0 },
  enchantments: [],
  delayedBlasts: [],
  sealedTiles: [], smokedTiles: [],
  _atkFx: null,
  _mpPrivateRemovals: [],
  _counterChain: [],
  _lastMove: null,
  _lastPlayerCounterCard: null,
  _lastAiCounterCard: null,
  structures: [],
  tombstones: [],
});

/* THE MUTATIONS. Each is a real action's footprint on state, named for the
   action. Every one also writes a log line, because every real action does —
   see the measurement-subtlety note in the header. */
const CASES = [
  // ── the four known-answer controls, which survived even the broken codec ──
  { ctl: true,  name: 'CONTROL unit currentHp (survived before the fix too)', mut: s => { s.units[0].currentHp = 21; } },
  { ctl: true,  name: 'CONTROL turnNumber     (survived before the fix too)', mut: s => { s.turnNumber = 5; } },
  { ctl: true,  name: 'CONTROL unit pos       (survived before the fix too)', mut: s => { s.units[1].pos = { x: 10, y: 3 }; } },
  { ctl: false, name: 'CONTROL a board tile   (was LOST before the fix)',     mut: s => { s.board[4][6].surface = { type: 'fire', turnsLeft: 4 }; } },
  // ── the fourteen that were silently lost ─────────────────────────────────
  { name: 'a wall is built',                mut: s => { s.board[3][3].wall = { owner: 'player', hp: 3 }; } },
  { name: 'a trap is planted',              mut: s => { s.board[8][2].trap = { owner: 'ai', kind: 'spike' }; } },
  { name: 'a surface is cleared (key delete)', pre: s => { s.board[5][5].surface = { type: 'oil', turnsLeft: 2 }; },
    mut: s => { delete s.board[5][5].surface; } },
  { name: 'the attack cinematic (_atkFx)',  mut: s => { s._atkFx = { startedAt: 999, attacker: { id: 'u1', owner: 'player' }, defenderPos: { x: 11, y: 2 } }; } },
  { name: 'a private-zone removal op',      mut: s => { s._mpPrivateRemovals = [{ id: 'pr_a_1', from: 'hand', to: 'graveyard', instanceId: 'c9' }]; } },
  { name: 'a control point changes hands',  mut: s => { s.controlPoints[0].holder = 'player'; s.controlPoints[0].scored.player = true; } },
  { name: 'cpScore is banked',              mut: s => { s.cpScore = { player: 1, ai: 0 }; } },
  { name: 'cpStreak advances',              mut: s => { s.cpStreak = { player: 2, ai: 0 }; } },
  { name: 'graveLock is set',               mut: s => { s.graveLock = { player: 0, ai: 2 }; } },
  { name: 'an enchantment lands',           mut: s => { s.enchantments = [{ id: 'e1', owner: 'player', turnsLeft: 3 }]; } },
  { name: 'a delayed blast is planted',     mut: s => { s.delayedBlasts = [{ x: 5, y: 5, owner: 'player', turnsLeft: 2 }]; } },
  { name: 'the counter chain grows',        mut: s => { s._counterChain = [{ owner: 'player', id: 'l1' }]; } },
  { name: '_lastMove is stamped',           mut: s => { s._lastMove = { owner: 'player', cardId: 'c_strike' }; } },
  { name: 'a unit is equipped',             mut: s => { s.units[0].equipment = [{ id: 'blade', slot: 'weapon' }, { id: 'ring', slot: 'trinket' }]; } },
  { name: 'a unit starts bleeding',         mut: s => { s.units[0]._bleeding = 2; } },
  { name: 'a unit walks a bent route',      mut: s => { s.units[1].walkPath = [{ x: 11, y: 2 }, { x: 10, y: 2 }, { x: 10, y: 3 }]; } },
  // ── shapes the codec has to survive as well as fields ────────────────────
  { name: 'a unit field is DELETED',        mut: s => { delete s.units[0].walkPath; } },
  { name: 'a top-level key is DELETED',     mut: s => { delete s._lastAiCounterCard; } },
  { name: 'a whole side block changes',     mut: s => { s.player = { ...s.player, energy: 1, hand: [] }; } },
  { name: 'several things at once (a real turn)', mut: s => {
    s.board[4][6].surface = { type: 'fire', turnsLeft: 4 };
    s.controlPoints[1].holder = 'ai';
    s.cpScore = { player: 0, ai: 1 };
    s.units[0].pos = { x: 3, y: 8 };
    s.units[0].walkPath = [{ x: 2, y: 9 }, { x: 3, y: 8 }];
    s.units[1].currentHp = 5;
    s.turnNumber = 5; s.currentTurn = 'ai'; s.turn = 'ai';
  } },
];

/* Compare recon against next, IGNORING _seq. The sender's baseline carries a
   _seq the fresh snapshot does not, so a codec that diffed it would emit a
   phantom removal on every packet; §3 asserts it never appears in a delta, and
   this comparison must not double-count it. */
function diffPaths(a, b, p, out) {
  if (out.length > 40) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'arr' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'arr' : typeof b;
  if (ta !== tb) { out.push(p + ': ' + ta + ' ≠ ' + tb); return out; }
  if (ta === 'arr') {
    if (a.length !== b.length) { out.push(p + '.length: ' + a.length + ' ≠ ' + b.length); return out; }
    for (let i = 0; i < a.length; i++) diffPaths(a[i], b[i], p + '[' + i + ']', out);
    return out;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!p && k === '_seq') continue;
      diffPaths(a[k], b[k], p ? p + '.' + k : k, out);
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(p + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
  return out;
}

/* One round trip through whichever codec is handed in. `apply` is a parameter
   so §5 can run the SAME cases through a deliberately broken decoder and
   require this file to notice. */
function roundTrip(compute, apply, c) {
  const base = fixture();
  if (c.pre) c.pre(base);
  const next = clone(base);
  delete next._seq;                                   // a fresh snapshot has none
  c.mut(next);
  next.log = [...next.log, { msg: 'line for ' + c.name, color: 'amber' }];
  const delta = compute(base, next);
  if (!delta) return { full: true };
  const recon = apply(clone(base), delta);
  return { full: false, delta, lost: diffPaths(next, recon, '', []) };
}

console.log('\n📦 DELTA ROUND-TRIP — ' + SRC);

// ── 1 · every field must survive the trip ──────────────────────────────────
console.log('\n── 1 · fidelity: compute → apply must reproduce the sender\'s state ──');
let lost = 0, full = 0, kept = 0;
const lostNames = [];
for (const c of CASES) {
  const r = roundTrip(_computeStateDelta, _applyStateDelta, c);
  if (r.full) {
    /* Lossless, but it means a FULL SNAPSHOT went out instead of a delta. That
       is the behaviour the old codec accidentally had for isolated changes, and
       it is not free — see §4. Counted, never silently accepted. */
    full++;
    console.log('     FULL  ' + c.name + '  (delta was null → full snapshot; lossless but not a delta)');
  } else if (r.lost.length) {
    lost++; lostNames.push(c.name);
    console.log('     LOST  ' + c.name + '  →  ' + r.lost.slice(0, 4).join(', '));
  } else kept++;
}
ok('🎯 every field round-trips: nothing is silently lost', lost === 0,
  lost ? lost + ' case(s) lost data: ' + lostNames.join('; ')
    : kept + ' round-tripped, ' + full + ' fell back to a full snapshot');
/* The four controls are named individually, because "17 of 17 passed" is not a
   claim anybody can check and "the board tile survives" is. */
for (const c of CASES.filter(x => x.name.startsWith('CONTROL'))) {
  const r = roundTrip(_computeStateDelta, _applyStateDelta, c);
  ok('   ' + c.name, !r.full && !r.lost.length,
    r.full ? 'fell back to a full snapshot' : (r.lost.join(', ') || 'round-tripped as a delta'));
}

// ── 2 · a delta must actually be sent for these ────────────────────────────
/* Fidelity alone is satisfiable by never sending a delta at all. Every case
   above is an ordinary action and every one of them must produce a DELTA. */
console.log('\n── 2 · these are ordinary actions: each must produce a delta, not a snapshot ──');
ok('🔴 no case degraded into a full snapshot', full === 0,
  full ? full + ' of ' + CASES.length + ' returned null — the codec is refusing to diff'
    : 'all ' + CASES.length + ' produced a delta');
const noop = _computeStateDelta(fixture(), (() => { const s = fixture(); delete s._seq; return s; })());
ok('a state that did not change produces NO packet at all', noop === null,
  noop === null ? 'null, as it should be' : 'a delta was built for an unchanged state: ' + JSON.stringify(Object.keys(noop)));

// ── 3 · the sender's own bookkeeping must not leak onto the wire ───────────
/* broadcastMyState keeps its baseline as `{ ...snapshot, _seq: n }`; the fresh
   snapshot has no _seq. A codec that diffs generically WILL see that as a key
   removed on every single packet, and would tell the receiver to delete it. */
console.log('\n── 3 · _seq is the sender\'s baseline counter and must never travel ──');
const seqCase = roundTrip(_computeStateDelta, _applyStateDelta, CASES[0]);
ok('_seq is not in the delta', !seqCase.full && !('_seq' in seqCase.delta),
  seqCase.full ? 'no delta built' : JSON.stringify(Object.keys(seqCase.delta)));
ok('_seq is not queued for deletion on the receiver',
  !seqCase.full && !(seqCase.delta._dropKeys || []).includes('_seq'),
  JSON.stringify((seqCase.delta || {})._dropKeys || null));

// ── 4 · BANDWIDTH: the delta must still be a delta ─────────────────────────
/* 🔴 THE REGRESSION THIS SECTION EXISTS FOR. "Make the delta carry every field"
   has a trivially correct and completely useless answer: return null always, or
   copy the whole snapshot into the delta. Both make §1 green. Both undo the
   30 KB → 2-5 KB reduction the delta path was built for, on the hottest wire
   path in multiplayer, and neither would be visible in any fidelity check.
   So: a one-field change must cost a small fraction of the snapshot it is a
   delta against. The board alone is 14×12 tiles; shipping it whole on every
   packet is the specific mistake this guards. */
console.log('\n── 4 · bandwidth: a delta must cost far less than the snapshot ──');
const snapBytes = JSON.stringify((() => { const s = fixture(); delete s._seq; return s; })()).length;
const sizes = [];
for (const c of CASES) {
  const r = roundTrip(_computeStateDelta, _applyStateDelta, c);
  sizes.push({ name: c.name, bytes: r.full ? snapBytes : JSON.stringify(r.delta).length, full: r.full });
}
const worst = sizes.reduce((a, b) => (a.bytes > b.bytes ? a : b));
const median = sizes.map(s => s.bytes).sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
console.log('     full snapshot: ' + snapBytes + ' bytes   ·   median delta: ' + median
  + '   ·   largest delta: ' + worst.bytes + ' (' + worst.name + ')');
ok('the median one-action delta is under a quarter of a full snapshot',
  median < snapBytes / 4, median + ' vs ' + Math.round(snapBytes / 4));
ok('🔴 even the WORST case is smaller than shipping the whole snapshot',
  worst.bytes < snapBytes, worst.bytes + ' vs ' + snapBytes + (worst.full ? '  (it fell back to a snapshot)' : ''));
/* And specifically: lighting ONE tile must not ship the whole grid. */
const oneTile = roundTrip(_computeStateDelta, _applyStateDelta,
  { name: 'one tile', mut: s => { s.board[4][6].surface = { type: 'fire', turnsLeft: 4 }; } });
const wholeBoard = JSON.stringify(fixture().board).length;
ok('lighting ONE tile ships one tile, not the whole 14×12 board',
  !oneTile.full && JSON.stringify(oneTile.delta).length < wholeBoard / 4,
  (oneTile.full ? 'full snapshot' : JSON.stringify(oneTile.delta).length + ' bytes')
  + ' vs a whole board at ' + wholeBoard);

// ── 5 · NEGATIVE CONTROL: this file must be able to go red ─────────────────
/* 🔴 A GREEN RESULT MEANS NOTHING IF RED IS UNREACHABLE. §1 is run again with
   the decoder replaced by the one that SHIPPED before this was fixed — the
   hand-written ten-key patch list — against the very same cases. It must lose
   the fields the bug report named. If this ever passes, §1 is comparing nothing
   and every claim above is decoration.
   (run.mjs additionally reverts the real fix in a temp copy of index.html and
   requires the whole suite to redden; this control is the cheap in-file version
   that runs even when nobody invokes the sweep.) */
console.log('\n── 5 · negative control: the OLD decoder must fail these same cases ──');
const OLD_APPLY = (baseline, delta) => {
  const next = { ...baseline };
  if (Array.isArray(delta.unitChanges)) {
    const map = new Map(delta.unitChanges.map(c => [c.id, c]));
    next.units = baseline.units.map(u => {
      const patch = map.get(u.id);
      if (!patch) return u;
      const { id, ...fields } = patch;
      return { ...u, ...fields };
    });
  }
  for (const k of ['turnNumber', 'currentTurn', 'turn', 'turn_who', 'log', 'weather', 'activeLocation', 'comboHits', 'player', 'ai']) {
    if (delta[k] !== undefined) next[k] = delta[k];
  }
  return next;
};
let oldLost = 0;
const oldLostNames = [];
for (const c of CASES) {
  const r = roundTrip(_computeStateDelta, OLD_APPLY, c);
  if (!r.full && r.lost.length) { oldLost++; oldLostNames.push(c.name); }
}
ok('🔴 the old ten-key decoder loses fields these cases carry', oldLost > 0,
  oldLost + ' of ' + CASES.length + ' cases lost data through it'
  + (oldLost ? ' (e.g. ' + oldLostNames.slice(0, 3).join('; ') + ')' : ' — §1 IS VACUOUS'));
/* …and it must lose the SPECIFIC things the bug named, not just something. */
const boardThroughOld = roundTrip(_computeStateDelta, OLD_APPLY,
  { name: 'board tile', mut: s => { s.board[4][6].surface = { type: 'fire', turnsLeft: 4 }; } });
ok('   …the board in particular, which is what a lit surface rides on',
  !boardThroughOld.full && boardThroughOld.lost.some(p => p.startsWith('board')),
  boardThroughOld.full ? 'no delta' : (boardThroughOld.lost.slice(0, 2).join(', ') || 'IT SURVIVED — the control is wrong'));

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURE(S) — the delta codec is lossy\n' : '✅ delta round-trip clean\n'));
process.exit(fails ? 1 : 0);
