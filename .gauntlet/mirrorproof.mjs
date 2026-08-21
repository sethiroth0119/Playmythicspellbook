/* 🪞 THE MIRROR PROOF — run it, don't trust the comment.
   node .gauntlet/mirrorproof.mjs [seedCount]     (default 4000)

   WHAT IT ANSWERS. Multiplayer rotates the whole board 180° on receive
   (`_mirrorAllPositions`), so every placement constraint in the battle builder
   is really TWO constraints: one in the frame the sender rolled it in, and one
   in the frame the opponent looks at. A constraint that is not invariant under
   (x,y) -> (W-1-x, H-1-y) holds for exactly one of the two players and NOTHING
   THROWS — it renders as an art bug on one screen only. That failure mode is
   invisible to every other check in this repo, which is why this file exists.

   It rolls the REAL `_rollStructurePlacements` and `_cpRollTruckTiles` over a
   seed sweep and asserts, in BOTH frames: the height-aware keep-out, standing
   water, the hero keep-out, no duplicate tiles, the trucks' middle band, the
   two OFF-CANVAS tiles, and that five ruins and three trucks still come back on
   every seed. It also asserts the promise those rest on — that `_bbGenTerrain`
   really is its own 180° rotation, tile by tile.

   ⚠ `ruinCrop*Frame` IS CURRENTLY VACUOUS AND IS KEPT ARMED ANYWAY.
   `_STRUCT_ROW_STEPS` is `[]` — the measured clearance in the host the game
   actually mounts (`.board-area`, 802x688 at a 1600x900 window) is ZERO for
   every height from 0.78 to 4.21 — so `_structMinRow` returns 0 and these two
   counters cannot fire. That is the correct answer, not a disabled test: the
   first table was calibrated in the full 1600x900 viewport, a framing no match
   produces, and the 3-6 rows of phantom clearance it bought emptied rows 0-2
   and 9-11 of every building. The counters stay because the SHAPE of the rule
   (two-sided, `min(y, H-1-y)`) is right and independent of the threshold: put a
   non-empty table back for a genuinely tighter frame and this proof re-arms
   itself with no edit. Re-derive the table with
     node .gauntlet/probe.mjs "/battle-board/_harness.html?scene=ruins&host=boardarea" … 1600 900
   and never at `host=full`.

   ⚠ THE ROOF-IN-FRAME GUARANTEE DOES NOT LIVE HERE ANY MORE. A row-indexed
   keep-out is a property of the CAMERA, and the player has one (BAR #2).
   Measured at host=boardarea, the worst-case tile for a 4.21-unit billboard is
   (0,0) at rest and (13,11) after a Q-yaw — it migrates from the far corner to
   the near corner. No placement rule can track that; `drawStruct` clamps it
   per-client at draw time instead.

   ⚠ IT READS public/index.html AND EXTRACTS BY MARKER, never by line number:
   the line numbers in .gauntlet/*.md have drifted twice already, and a proof
   that silently tested a stale copy of the function would be worse than none. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8').split('\n');

function grab(marker) {
  const i = SRC.findIndex(l => l.startsWith(marker));
  if (i < 0) throw new Error('marker not found (did it get renamed?): ' + marker);
  const bal = t => (t.match(/[{[(]/g) || []).length - (t.match(/[}\])]/g) || []).length;
  if (bal(SRC[i]) === 0 && SRC[i].includes(';')) return SRC[i];      // one-liner const
  for (let j = i + 1; j < SRC.length; j++)                            // …else to its column-0 close
    if (SRC[j] === '}' || SRC[j] === '};' || SRC[j] === '];') return SRC.slice(i, j + 1).join('\n');
  throw new Error('no terminator for ' + marker);
}
const body = [
  'const BOARD_W', 'const offsetToCube', 'const distance', 'function _boardDims',
  'const STRUCTURE_ORDER', 'const STRUCTURE_DRAWN_H', 'const _STRUCT_ROW_STEPS',
  'function _structMinRow', 'function _rollStructurePlacements',
  'const CP_COUNT', 'function _cpRollTruckTiles',
  'function _bbRng', 'function _bbSeedFromString',
  'const _BB_ELEV', 'const _BB_NB', 'function _bbGenTerrain',
].map(grab).join('\n\n');
/* Evaluated, not imported: these are top-level `const`s inside a <script>, which
   is exactly why an ES module cannot see them (CLAUDE.md, "the globals trap"). */
const F = new Function(body + '\nreturn { BOARD_W, BOARD_H, distance, _structMinRow,' +
  ' _rollStructurePlacements, _cpRollTruckTiles, _bbGenTerrain, STRUCTURE_ORDER, CP_COUNT };')();

const { BOARD_W: W, BOARD_H: H } = F;
const DEPLOY_INSET = 2;                       // matches buildHero's two calls in createInitialState
const heroes = [ { x: Math.floor(W / 2) - 1, y: H - 1 - DEPLOY_INSET },
                 { x: Math.floor(W / 2),     y: DEPLOY_INSET } ];
const state = {
  board: Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y }))),
  units: heroes.map((p, i) => ({ isHero: true, alive: true, owner: i ? 'ai' : 'player', pos: p })),
};
const mirror = p => ({ x: (W - 1) - p.x, y: (H - 1) - p.y });   // _mirrorPos, verbatim

/* 🚫 THE TWO TILES THAT PROJECT OFF THE CANVAS, and their mirror partners.
   OPEN-BREAKS.md #3: at the shipped rect two of the 168 tiles have their CENTRE
   outside the canvas entirely. Measured, not assumed — `scene=gamemap`,
   `host=boardarea`, 1600x900, projecting each tile centre at its own elevation:
     (0,10)  -> x = -6   (canvas is 0..802)
     (13,11) -> x = 807
   Everything else clears by at least 8px. Mirroring sends (0,10) -> (13,1) and
   (13,11) -> (0,0), so FOUR tiles are unsafe once both frames are counted, and
   an objective on any of them is one a player can neither see nor click.
   This is asserted here rather than fixed here: the fix is at the FRAMING level
   (OPEN-BREAKS.md says so explicitly — shrinking the playable board instead
   would just move the lie), and this proof's job is to catch the day a roll
   starts handing those tiles a ruin or a truck. Re-measure the list with the
   probe above if the fit ever changes; a hardcoded pair that has gone stale is
   worse than no check. */
const OFF_CANVAS = (() => {
  const s = new Set();
  for (const [x, y] of [[0, 10], [13, 11]]) {
    s.add(x + ',' + y);
    const m = mirror({ x, y }); s.add(m.x + ',' + m.y);
  }
  return s;
})();
/* Which horizontal third a column falls in, written exactly as
   _cpRollTruckTiles writes it — floor(lane*W/CP_COUNT), NOT W/3 rounded. */
const laneOf = x => {
  for (let l = 0; l < F.CP_COUNT; l++)
    if (x >= Math.floor(l * W / F.CP_COUNT) && x < Math.floor((l + 1) * W / F.CP_COUNT)) return l;
  return -1;
};

const N = Math.max(1, +(process.argv[2] || 4000) | 0);
const r = { seeds: 0, seedsWithFewerThanFiveRuins: 0, seedsWithFewerThanThreeTrucks: 0,
  terrainAsymmetricTiles: 0, ruinCropSenderFrame: 0, ruinCropMirroredFrame: 0,
  ruinOnWater: 0, ruinInsideHeroKeepOut: 0, ruinDuplicateTile: 0,
  ruinOnOffCanvasTile: 0, truckOnOffCanvasTile: 0,
  truckOutOfBandSenderFrame: 0, truckOutOfBandMirroredFrame: 0,
  truckInsideHeroKeepOut: 0, truckOnRuin: 0 };
/* 📎 DOCUMENTED, NOT FAILED. Counted and printed, deliberately kept out of `r`
   so it cannot flip the exit code — see the note beside the tally at the end. */
const doc = { seedsTruckLaneThirdsNotPreservedByMirror: 0 };
const examples = [];

for (let s = 1; s <= N; s++) {
  const seed = (Math.imul(s, 0x9e3779b1) ^ 0x5f3a1c) >>> 0;
  const elev = {}, surf = {};
  for (const t of F._bbGenTerrain(W, H, seed)) { elev[t.x + ',' + t.z] = +t.elev || 0; surf[t.x + ',' + t.z] = t.surf; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = mirror({ x, y });
    if (elev[x + ',' + y] !== elev[m.x + ',' + m.y] || surf[x + ',' + y] !== surf[m.x + ',' + m.y]) r.terrainAsymmetricTiles++;
  }
  const ruins = F._rollStructurePlacements(state, seed);
  r.seeds++;
  if (ruins.length !== F.STRUCTURE_ORDER.length) r.seedsWithFewerThanFiveRuins++;
  const seen = new Set();
  for (const p of ruins) {
    const m = mirror(p);
    const needHere = F._structMinRow(p.kind, elev[p.x + ',' + p.y]);
    const needThere = F._structMinRow(p.kind, elev[m.x + ',' + m.y]);
    if (p.y < needHere) { r.ruinCropSenderFrame++; examples.push(['sender', seed, p.kind, p.x, p.y, needHere]); }
    if (m.y < needThere) { r.ruinCropMirroredFrame++; examples.push(['mirror', seed, p.kind, p.x, p.y, needThere]); }
    if (surf[p.x + ',' + p.y] === 'water') r.ruinOnWater++;
    if (heroes.some(h => F.distance(p, h) < 3)) r.ruinInsideHeroKeepOut++;
    /* One test covers both frames because OFF_CANVAS already holds the mirror
       partners: a ruin on (0,10) is off-frame for the sender, and a ruin on
       (13,1) is off-frame for the opponent. Testing only p would pass the
       second case silently, which is this file's whole subject. */
    if (OFF_CANVAS.has(p.x + ',' + p.y)) { r.ruinOnOffCanvasTile++; examples.push(['offcanvas-ruin', seed, p.kind, p.x, p.y, -1]); }
    const k = p.x + ',' + p.y; if (seen.has(k)) r.ruinDuplicateTile++; seen.add(k);
  }
  const trucks = F._cpRollTruckTiles({ ...state, structures: ruins }, seed);
  if (trucks.length !== F.CP_COUNT) r.seedsWithFewerThanThreeTrucks++;
  /* The widest band _cpRollTruckTiles can reach is its last pass (pass 3). It is
     symmetric about (H-1)/2 by construction; this asserts that end to end. */
  const mid = (H - 1) / 2, band = Math.max(1, Math.round(H / 6)) + 3;
  for (const t of trucks) {
    if (Math.abs(t.y - mid) > band) r.truckOutOfBandSenderFrame++;
    if (Math.abs(mirror(t).y - mid) > band) r.truckOutOfBandMirroredFrame++;
    if (heroes.some(h => F.distance(t, h) < 2)) r.truckInsideHeroKeepOut++;
    if (ruins.some(o => o.x === t.x && o.y === t.y)) r.truckOnRuin++;
    if (OFF_CANVAS.has(t.x + ',' + t.y)) { r.truckOnOffCanvasTile++; examples.push(['offcanvas-truck', seed, 'truck', t.x, t.y, -1]); }
  }
  /* 🛣 LANE THIRDS ARE **NOT** MIRROR-INVARIANT, AND THAT IS RECORDED RATHER
     THAN "FIXED". _cpRollTruckTiles gives each truck its own horizontal third,
     cut as [floor(l*W/3), floor((l+1)*W/3)) — at W=14 that is cols 0-3 / 4-8 /
     9-13, three lanes of unequal width. Mirroring is x -> 13-x, which maps
     0-3 -> 10-13 and 9-13 -> 0-4. Those are not the same partition: x=4 (lane 1)
     mirrors to x=9 (lane 2) and back, so on some seeds the opponent sees two
     trucks in one third and none in another.
     WHY IT IS NOT A BUG WORTH A CONSTRAINT: "one per third" exists so a side
     cannot open the match already sitting on two points, and the property that
     actually delivers that is the MIDDLE-BAND row rule (asserted above, and
     genuinely symmetric about (H-1)/2) plus the 3-hex hero keep-out — both of
     which hold in both frames on every seed. The thirds are spread, i.e. taste.
     Forcing invariance would mean an odd-width board could only use a symmetric
     lane cut, which either narrows the middle lane to nothing at some W or
     starts rejecting legal tiles for a cosmetic reason.
     WHY IT IS COUNTED ANYWAY: because "the trucks look bunched on my screen and
     not on yours" is exactly the report this file exists to pre-empt, and the
     next person to see it deserves to find the number already measured instead
     of spending an afternoon rediscovering it. ~30% of seeds. If that number
     ever changes sharply, the lane cut changed and someone should know. */
  if (trucks.length === F.CP_COUNT) {
    const here = trucks.map(t => laneOf(t.x)).sort().join('');
    const there = trucks.map(t => laneOf(mirror(t).x)).sort().join('');
    if (here !== there) doc.seedsTruckLaneThirdsNotPreservedByMirror++;
  }
}
console.log(JSON.stringify(r, null, 2));
/* Printed apart from `r` and NOT in the exit-code tally: it is a measured,
   accepted asymmetry, and folding it into the failures would train whoever runs
   this to ignore a red line — which is how the real ones get ignored too. */
console.log('documented (expected non-zero, does NOT fail the run):',
  JSON.stringify({ ...doc, asPctOfSeeds: +(100 * doc.seedsTruckLaneThirdsNotPreservedByMirror / Math.max(1, r.seeds)).toFixed(1) }));
if (examples.length) console.log('first 10 failures [frame, seed, kind, x, y, rowsNeeded]:', examples.slice(0, 10));
const bad = Object.entries(r).filter(([k, v]) => k !== 'seeds' && v > 0);
console.log(bad.length ? 'FAIL — ' + bad.map(([k]) => k).join(', ') : 'PASS — every constraint holds in BOTH frames');
process.exit(bad.length ? 1 : 0);
