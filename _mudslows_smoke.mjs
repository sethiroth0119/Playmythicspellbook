/* 🪵 _mudslows_smoke — does mud actually cost one tile, and only one tile?
   ══════════════════════════════════════════════════════════════════════════
   Written for the piece "mud-slows". It SLICES the real functions out of
   public/index.html and runs them in a vm sandbox, rather than re-typing them —
   the whole lesson of this pass is that a green test driving a copy of the code
   proves nothing about the code that ships. If a slice fails to find its
   function the suite dies loudly here rather than reporting a silent pass.

   It also carries its own NEGATIVE CONTROLS: the grass case and the flier case
   are asserted to be UNCHANGED, because "mud costs a tile" is only a rule if
   clean ground does not.

   Run: node _mudslows_smoke.mjs */
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync('public/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const no = (m, extra) => { fail++; console.log('  ❌ ' + m + (extra ? '  — ' + extra : '')); };
const eq = (m, got, want) => (got === want) ? ok(m + '  (' + JSON.stringify(got) + ')')
  : no(m, 'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

/* ── the slicer ───────────────────────────────────────────────────────────
   Brace-balanced, and aware of strings / templates / both comment forms, so a
   `{` inside a comment about braces cannot end the slice early. */
function slice(marker) {
  const i = SRC.indexOf(marker);
  if (i < 0) throw new Error('SLICE MISS: ' + marker.slice(0, 60));
  if (SRC.indexOf(marker, i + 1) >= 0) throw new Error('SLICE AMBIGUOUS: ' + marker.slice(0, 60));
  let j = SRC.indexOf('{', i + marker.length - 1);
  if (j < 0) throw new Error('SLICE NO BODY: ' + marker.slice(0, 60));
  let depth = 0, k = j;
  while (k < SRC.length) {
    const c = SRC[k], d = SRC[k + 1];
    if (c === '/' && d === '/') { k = SRC.indexOf('\n', k); if (k < 0) break; continue; }
    if (c === '/' && d === '*') { k = SRC.indexOf('*/', k + 2) + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; k++;
      while (k < SRC.length && SRC[k] !== q) { if (SRC[k] === '\\') k++; k++; }
      k++; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(i, k + 1); }
    k++;
  }
  throw new Error('SLICE UNBALANCED: ' + marker.slice(0, 60));
}

/* The functions under test, plus every real helper they reach that is cheap to
   carry. Anything NOT sliced is stubbed in the sandbox below and named there,
   so a reader can see exactly what is real and what is fake. */
const REAL = {};
for (const [name, marker] of [
  ['distance',            'const distance = (a, b) => {'],
  ['getOccupant',         'const getOccupant = (pos, units) =>'],
  ['getMoveRange',        'const getMoveRange = (unit, weather) => {'],
  ['_getMoveRangeRaw',    'const _getMoveRangeRaw = (unit, weather) => {'],
  ['_bbStampTerrainSurf', 'function _bbStampTerrainSurf(state) {'],
  ['_terrainSurfAt',      'function _terrainSurfAt(state, x, y) {'],
  ['getValidMoves',       'const getValidMoves = (unit, units, weather, board) => {'],
  ['getMovePath',         'function getMovePath(unit, units, weather, target) {'],
  ['getSpeedPenalty',     'function getSpeedPenalty(unit) {'],
  ['_isStationaryUnit',   'function _isStationaryUnit(u) {'],
]) {
  try { REAL[name] = slice(marker); } catch (e) { console.log('  ❌ ' + e.message); fail++; }
}
if (fail) { console.log('\n❌ the slicer could not find the code under test — nothing below would mean anything.'); process.exit(1); }
// getOccupant is a one-liner arrow with no block body; slice() would over-reach.
REAL.getOccupant = 'const getOccupant = (pos, units) => units.find(u => u.alive && u.pos.x === pos.x && u.pos.y === pos.y);';

const BOARD_W = 14, BOARD_H = 12;

/* ── the sandbox ────────────────────────────────────────────────────────── */
function makeCtx(mapTiles) {
  const board = [];
  for (let y = 0; y < BOARD_H; y++) { const r = []; for (let x = 0; x < BOARD_W; x++) r.push({ x, y }); board.push(r); }
  const state = { board, units: [], weather: null };
  const sandbox = {
    console, BOARD_W, BOARD_H,
    App: { state },
    // ── stubs, all of them named so the reader knows what is fake ──────────
    hasPassive: () => false,
    countAlliesByFaction: () => 0,
    _bagHasScpSpeed: () => false,
    getStatusStatMultiplier: () => 1,
    getLocationSpeedMod: () => 0,
    STATUS_EFFECTS: { slow: { spdMod: -1 }, chokeStub: {} },
    _ley: () => null,                    // the ley layer OFF — mud must not need it
    isEffectivelyFlying: (u) => !!(u && u.flying),
    _leyMap: () => ({ terrain: null, cols: 0, rows: 0, tiles: mapTiles }),
    inBounds: (x, y) => x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H,
    tileBlockedByTombstone: () => false,
    window: { MythicFuel: null, MythicSea: null, __mg: {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // 🔴 THE LATTICE IS SLICED, NOT RE-TYPED. A hand-written hexDirs table in
  // this harness got the odd-row offsets wrong on the first run and turned a
  // radius assertion into a lattice bug; HEXSPEC §5 says the offsets differ by
  // row parity and this file is not allowed a second opinion about them.
  const LATTICE = [
    slice('const offsetToCube = (x, y) => {'),
    SRC.match(/const HEX_DIRS_EVEN = \[.*?\];/s)[0],
    SRC.match(/const HEX_DIRS_ODD  = \[.*?\];/s)[0],
    'const hexDirs = (y) => ((y & 1) ? HEX_DIRS_ODD : HEX_DIRS_EVEN);',
  ].join('\n;\n');
  const code = [LATTICE, REAL.distance, REAL.getOccupant, REAL._isStationaryUnit, REAL.getSpeedPenalty,
    REAL._bbStampTerrainSurf, REAL._terrainSurfAt, REAL._getMoveRangeRaw, REAL.getMoveRange,
    REAL.getValidMoves, REAL.getMovePath,
    'const hexNeighbors = (x, y) => hexDirs(y).map(d => ({ x: x + d[0], y: y + d[1] }));',
    // `const` inside runInContext is lexical and never lands on the sandbox
    // object, so hand the suite explicit handles on the real sliced functions.
    'Object.assign(globalThis, { distance, getOccupant, getMoveRange, _getMoveRangeRaw, getValidMoves, getMovePath, getSpeedPenalty, hexNeighbors });',
  ].join('\n;\n');
  vm.runInContext(code, sandbox);
  return { sandbox, state };
}
const tilesAll = (surf) => { const t = []; for (let z = 0; z < BOARD_H; z++) for (let x = 0; x < BOARD_W; x++) t.push({ x, z, surf }); return t; };
const tilesWith = (mudCells) => {
  const set = new Set(mudCells.map(p => p[0] + ',' + p[1]));
  const t = []; for (let z = 0; z < BOARD_H; z++) for (let x = 0; x < BOARD_W; x++) t.push({ x, z, surf: set.has(x + ',' + z) ? 'mud' : 'grass' });
  return t;
};
const unit = (o) => Object.assign({ id: 'u1', alive: true, owner: 'player', pos: { x: 7, y: 6 }, stats: { spd: 3 }, statusEffects: [], stages: {} }, o);

console.log('\n--- 1. the rule: standing on mud costs exactly one tile ---');
{
  const g = makeCtx(tilesAll('grass'));
  const m = makeCtx(tilesAll('mud'));
  const ug = unit({}), um = unit({});
  g.state.units = [ug]; m.state.units = [um];
  const rg = g.sandbox.getMoveRange(ug, null), rm = m.sandbox.getMoveRange(um, null);
  eq('spd-3 on grass (the negative control)', rg, 3);
  eq('spd-3 on mud', rm, 2);
  eq('the delta is exactly 1', rg - rm, 1);
  // §5.4 asked for SPEED ONLY. These two are what the `slow` status would also
  // have moved, and they must not move.
  eq('attack-range penalty unchanged (getSpeedPenalty)', m.sandbox.getSpeedPenalty(um), 0);
  eq('no status was applied', um.statusEffects.length, 0);
}

console.log('\n--- 2. getValidMoves highlights the smaller disc ---');
{
  const m = makeCtx(tilesAll('mud'));
  const um = unit({}); m.state.units = [um];
  const moves = m.sandbox.getValidMoves(um, m.state.units, null, m.state.board);
  // A hex disc of radius N is 3N^2+3N+1 tiles, minus the start tile the caller
  // excludes; clipped by the board edge, so assert the RADIUS, not the count.
  const maxd = Math.max(...moves.map(p => m.sandbox.distance(p, um.pos)));
  eq('no highlighted tile further than 2', maxd, 2);
  const g = makeCtx(tilesAll('grass'));
  const ug = unit({}); g.state.units = [ug];
  const gmoves = g.sandbox.getValidMoves(ug, g.state.units, null, g.state.board);
  eq('grass control reaches 3', Math.max(...gmoves.map(p => g.sandbox.distance(p, ug.pos))), 3);
  (moves.length < gmoves.length) ? ok('mud disc is strictly smaller (' + moves.length + ' < ' + gmoves.length + ')')
    : no('mud disc is not smaller', moves.length + ' vs ' + gmoves.length);
}

console.log('\n--- 3. "STANDING ON", not entering: mud under the DESTINATION is free ---');
{
  // One single mud tile, three hexes east of a spd-3 unit standing on grass.
  const c = makeCtx(tilesWith([[10, 6]]));
  const u = unit({}); c.state.units = [u];
  eq('range from clean ground beside mud', c.sandbox.getMoveRange(u, null), 3);
  const moves = c.sandbox.getValidMoves(u, c.state.units, null, c.state.board);
  const reached = moves.some(p => p.x === 10 && p.y === 6);
  reached ? ok('the mud tile 3 away is still reachable this turn') : no('crossing/entering mud was charged');
  // …and the moment the unit is ON it, the next query is smaller.
  u.pos = { x: 10, y: 6 };
  eq('after stepping onto it', c.sandbox.getMoveRange(u, null), 2);
}

console.log('\n--- 4. fliers are above the floor ---');
{
  const m = makeCtx(tilesAll('mud'));
  const uf = unit({ flying: true }); m.state.units = [uf];
  eq('flying spd-3 on mud', m.sandbox.getMoveRange(uf, null), 3);
}

console.log('\n--- 5. THE SOFT-LOCK: spd-1 + mud + chokehold + Slowed ---');
{
  const m = makeCtx(tilesAll('mud'));
  const u = unit({ stats: { spd: 1 }, _chokeheld: true, statusEffects: [{ type: 'slow' }] });
  m.state.units = [u];
  const r = m.sandbox.getMoveRange(u, null);
  (r >= 1) ? ok('getMoveRange floors at 1 (got ' + r + ')') : no('SOFT-LOCK: getMoveRange returned ' + r);
  const moves = m.sandbox.getValidMoves(u, m.state.units, null, m.state.board);
  (moves.length > 0) ? ok('getValidMoves is NON-empty (' + moves.length + ' tiles)') : no('SOFT-LOCK: no legal move, no explanation on screen');
  const path = m.sandbox.getMovePath(u, m.state.units, null, moves[0] || { x: 7, y: 5 });
  (path.length > 0) ? ok('getMovePath agrees a route exists') : no('getMovePath returned []');
}

console.log('\n--- 6. CONTRACT R31: getValidMoves and getMovePath agree tile-for-tile ---');
{
  for (const surf of ['grass', 'mud']) {
    const c = makeCtx(tilesAll(surf));
    const u = unit({}); c.state.units = [u];
    const moves = c.sandbox.getValidMoves(u, c.state.units, null, c.state.board);
    let bad = 0;
    for (const p of moves) { const path = c.sandbox.getMovePath(u, c.state.units, null, p); if (!path.length || path[path.length - 1].x !== p.x || path[path.length - 1].y !== p.y) bad++; }
    eq('every ' + surf + ' highlight has a path that ends on it', bad, 0);
  }
}

console.log('\n--- 7. the seam: O(1), and one generator run at most ---');
{
  let leyMapCalls = 0;
  const tiles = tilesWith([[7, 6]]);
  const c = makeCtx(tiles);
  c.sandbox._leyMap = () => { leyMapCalls++; return { terrain: null, cols: 0, rows: 0, tiles }; };
  const u = unit({}); c.state.units = [u];
  for (let i = 0; i < 500; i++) c.sandbox.getMoveRange(u, null);
  eq('500 speed queries cost ONE map build', leyMapCalls, 1);
  eq('and the answer is still right', c.sandbox.getMoveRange(u, null), 2);
  // every tile carries a decision, so no tile can re-enter the stamp
  let undef = 0;
  for (let y = 0; y < BOARD_H; y++) for (let x = 0; x < BOARD_W; x++) if (c.state.board[y][x].surf === undefined) undef++;
  eq('no tile left undefined (the re-entry trap)', undef, 0);
}

console.log('\n--- 8. it degrades: no map, no terrain, no crash ---');
{
  const c = makeCtx(null);
  c.sandbox._leyMap = () => { throw new Error('map unavailable'); };
  const u = unit({}); c.state.units = [u];
  eq('speed falls back to the clean-ground answer', c.sandbox.getMoveRange(u, null), 3);
  eq('reader answers null, not undefined', c.sandbox._terrainSurfAt(c.state, 7, 6), null);
}

console.log('\n--- 9. the board survives the {...t} rebuilds this file does everywhere ---');
{
  const c = makeCtx(tilesAll('mud'));
  const u = unit({}); c.state.units = [u];
  eq('before the rebuild', c.sandbox.getMoveRange(u, null), 2);
  c.state.board = c.state.board.map(row => row.map(t => ({ ...t, event: null })));
  c.sandbox.App.state = c.state;
  eq('after a full board rebuild', c.sandbox.getMoveRange(u, null), 2);
}

console.log('\n--- 10. mud is the ONLY surface that moves the number ---');
{
  const others = ['grass', 'asphalt', 'dirt', 'rubble', 'water', 'sand', 'lava', 'ice', null];
  let moved = [];
  for (const s of others) {
    const c = makeCtx(tilesAll(s));
    const u = unit({}); c.state.units = [u];
    if (c.sandbox.getMoveRange(u, null) !== 3) moved.push(String(s));
  }
  eq('no other surface changes speed', moved.join(',') || '(none)', '(none)');
}

console.log('\n--- 11. subtracted exactly once per query ---');
{
  const m = makeCtx(tilesAll('mud'));
  const u = unit({ stats: { spd: 5 } }); m.state.units = [u];
  eq('spd-5 on mud', m.sandbox.getMoveRange(u, null), 4);
  const u2 = unit({ stats: { spd: 5 }, _chokeheld: true }); m.state.units = [u2];
  eq('spd-5 on mud, chokeheld', m.sandbox.getMoveRange(u2, null), 3);
}

console.log('\n--- 12. source-level: ONE rule, ONE terrain opinion ---');
{
  // judgedBy (e): mud must be subtracted exactly once in the whole file, and
  // there must be no second movement rule. Count the SUBTRACTION, not the word
  // "mud" — the comments are allowed to say it as often as they need to.
  const subs = (SRC.match(/=== 'mud'\) speed -= 1;/g) || []).length;
  eq('exactly one mud speed subtraction in the file', subs, 1);
  // judgedBy (f): the stamp must not hold a SECOND opinion about the terrain.
  // _leyMap() -> _bbMapFromEditor() is the array the canvas stage and ley.js
  // both read, and it is where the admin editor's painted surfaces are merged
  // over the generated ones. A stamp that called _bbGenTerrain directly would
  // agree on a generated map and silently disagree on every hand-painted one.
  // 🔴 STRIP THE COMMENTS FIRST. The first version of these two checks went red
  // against correct code: both functions NAME the thing they refuse to do
  // ("deliberately NOT a direct _bbGenTerrain() call", "the cheap
  // implementation is applyStatus(unit,'slow'), and it is a trap"). A gate that
  // cannot tell a refusal from a call is a gate that punishes the comment.
  const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const stamp = codeOnly(REAL._bbStampTerrainSurf);
  (stamp.includes('_leyMap()')) ? ok('the stamp reads _leyMap() (the merged editor+generator array)')
    : no('the stamp does not read _leyMap()');
  (!/_bbGenTerrain\s*\(/.test(stamp)) ? ok('the stamp never re-derives terrain itself')
    : no('the stamp calls _bbGenTerrain — it now has a second opinion about the ground');
  // The rule must not have grown a status. Re-check at source level, because
  // the runtime check above only proves it for the units this suite builds.
  const rule = codeOnly(REAL._getMoveRangeRaw);
  (!/applyStatus|statusEffects\.push/.test(rule)) ? ok("_getMoveRangeRaw applies no status (no 'slow' smuggled in)")
    : no('_getMoveRangeRaw now applies a status');
  // And the wrapper floor must not drift back to 0.
  (/return Math\.max\(1, _base - 1\);/.test(REAL.getMoveRange)) ? ok('the chokehold wrapper still floors at 1')
    : no('the chokehold wrapper floor is not 1 — the soft-lock is back');
}

console.log('\n--- 13. TRICK ROOM: the mirror must not turn the penalty into a bonus ---');
{
  /* 🔴 THE BUG THIS SECTION EXISTS TO CATCH, and why it survived twelve green
     sections. Every case above passes `weather = null`. _getMoveRangeRaw ends
     with Trick Room's `speed = 6 - speed` mirror, so ANY term applied above
     that line is inverted by it: a subtraction becomes an addition. Measured
     against the code as it stood before this section existed — spd-5 under
     parallelWorld returned 1 on grass and 2 on MUD. Mud was a +1 movement
     BONUS in one of the game's weathers, and five separate mutation controls
     could all go red while the rule silently pointed the wrong way, because
     not one test in the file passed a weather object other than null.
     The fix is placement, not arithmetic: the mud term now sits BELOW the
     mirror, immediately above the final floor.

     ⚠ THE ASSERTION IS max(1, grass-1), NOT grass-1 FLAT. At spd 5 the mirror
     lands on 1 and there is no tile left to take; the final Math.max(1, …)
     wins and mud costs nothing. That is the floor doing its job — §5.4 says a
     0-speed unit is a soft-lock and not a tactic — so the floor is asserted
     here deliberately rather than papered over. Both halves are checked: the
     exact −1 wherever the floor is not binding, and never-a-bonus everywhere. */
  const WX = { weatherType: 'parallelWorld', turnsLeft: 3 };
  for (let spd = 1; spd <= 5; spd++) {
    const g = makeCtx(tilesAll('grass'));
    const m = makeCtx(tilesAll('mud'));
    const ug = unit({ stats: { spd } }), um = unit({ stats: { spd } });
    g.state.units = [ug]; m.state.units = [um];
    const rg = g.sandbox.getMoveRange(ug, WX), rm = m.sandbox.getMoveRange(um, WX);
    eq('spd-' + spd + ' mirrored — mud = max(1, grass-1)  [grass=' + rg + ']', rm, Math.max(1, rg - 1));
    (rm <= rg) ? ok('spd-' + spd + ' mirrored — mud is never FASTER than grass')
      : no('spd-' + spd + ' mirrored — MUD IS A BONUS', 'mud ' + rm + ' > grass ' + rg);
    if (rg > 1) eq('spd-' + spd + ' mirrored — the floor is not binding, so it is exactly −1', rg - rm, 1);
  }
  // The mirror must still be reachable at all — a weather object that silently
  // did nothing would make every assertion above pass for the wrong reason.
  const c = makeCtx(tilesAll('grass'));
  const u1 = unit({ stats: { spd: 1 } }); c.state.units = [u1];
  eq('positive control: the mirror really fires (spd-1 grass, no weather)', c.sandbox.getMoveRange(u1, null), 1);
  eq('positive control: the mirror really fires (spd-1 grass, parallelWorld)', c.sandbox.getMoveRange(u1, WX), 5);
}

console.log('\n' + (fail ? '❌ ' + fail + ' FAILED, ' + pass + ' passed' : '✅ ALL PASS (' + pass + ' checks)'));
process.exit(fail ? 1 : 0);
