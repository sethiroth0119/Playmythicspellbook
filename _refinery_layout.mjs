/* Site-plan checker for the refinery yard. Run from the repo root:
     node _refinery_layout.mjs
   Verifies that no two footprints overlap at FULL build-out (including
   the office box), that the gate spawn is clear, and that every first
   plot plus the office door can be walked to from it.
   Run it after touching PLOT_GRID in build.js or the office in scene.js —
   the hand-written version of that layout shipped 43 overlaps. */
const B = await import('./public/src/refinery/build.js');
const { EQUIPMENT } = await import('./public/src/refinery/data.js');
/* Footprint radii as the scene registers them, plus the office. Anything that
   overlaps here overlaps in the yard. */
const R = { crudeTank:4.4, cdu:3.4, cracker:2.4, reformer:2.4, treater:2.4, alky:2.4,
            blendTank:3.4, storeTank:3.6, bay:5.2, truck:2.6, lab:3.2, automation:3.2, pumps:1.6 };
const items = [];
for (const id in R) {
  const max = EQUIPMENT[id].max;
  for (let i = 0; i < max; i++) {
    const p = B.plotPosition(id, i);
    items.push({ n: id + '#' + (i+1), x: p.x, z: p.z, r: R[id] });
  }
}
// The office is a box; approximate it as a circle that contains it, then also
// do an exact box test, because a circle over-reports on the corners.
const OFF = { x: 33, z: 34, w: 13, d: 10 };
items.push({ n: 'OFFICE', x: OFF.x, z: OFF.z, box: [OFF.w/2, OFF.d/2] });
items.push({ n: 'flare', x: -14, z: -34, r: 1.2 });

const clash = [];
for (let i = 0; i < items.length; i++) for (let j = i+1; j < items.length; j++) {
  const a = items[i], b = items[j];
  let hit = false, gap = 0;
  if (a.box || b.box) {
    const bx = a.box ? a : b, ci = a.box ? b : a;
    // circle vs axis-aligned box
    const cx = Math.max(bx.x - bx.box[0], Math.min(ci.x, bx.x + bx.box[0]));
    const cz = Math.max(bx.z - bx.box[1], Math.min(ci.z, bx.z + bx.box[1]));
    const d = Math.hypot(ci.x - cx, ci.z - cz);
    hit = d < ci.r; gap = +(d - ci.r).toFixed(2);
  } else {
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    hit = d < a.r + b.r; gap = +(d - a.r - b.r).toFixed(2);
  }
  if (hit) clash.push(a.n + ' ↔ ' + b.n + '  (overlap ' + (-gap).toFixed(2) + ')');
}
console.log(clash.length ? 'OVERLAPS (' + clash.length + '):\n  ' + clash.join('\n  ') : 'layout is clear');

/* ── Is the site actually walkable? A clear plan is not enough: the player has
   to be able to spawn somewhere and reach the office door and the units. */
const FENCE = 44;
function clearAt(x, z, pad) {
  if (Math.abs(x) > FENCE - 2 || Math.abs(z) > FENCE - 2) return false;
  for (const it of items) {
    if (it.box) {
      const cx = Math.max(it.x - it.box[0], Math.min(x, it.x + it.box[0]));
      const cz = Math.max(it.z - it.box[1], Math.min(z, it.z + it.box[1]));
      if (Math.hypot(x - cx, z - cz) < pad) return false;
    } else if (Math.hypot(x - it.x, z - it.z) < it.r + pad) return false;
  }
  return true;
}
/* Search the southern approach for a clear spawn rather than asserting one —
   the yard's furniture moves, and a hard-coded spawn is how the player ends up
   standing inside a parked truck. */
let SPAWN = null;
const GATE = { x: 17, z: 41 };     // must match scene.js
if (clearAt(GATE.x, GATE.z - 2, 2.0)) SPAWN = { x: GATE.x, z: GATE.z - 2 };
if (!SPAWN) {
  for (let z = 41; z >= 20 && !SPAWN; z--)
    for (let x = 0; x <= 24 && !SPAWN; x++)
      for (const sx of [x, -x]) { if (clearAt(sx, z, 2.0)) { SPAWN = { x: sx, z }; break; } }
  console.log('⚠ the gate spawn is BLOCKED — nearest clear point is above');
}
console.log('\nclear spawn found:', SPAWN ? '(' + SPAWN.x + ', ' + SPAWN.z + ')' : 'NONE');
if (!SPAWN) process.exit(1);

// Flood fill on a 1-unit grid from the spawn: everything reachable on foot.
const S = 1, N = Math.floor(FENCE * 2 / S);
const key = (i, j) => i + ',' + j;
const seen = new Set();
const q = [[Math.round((SPAWN.x + FENCE) / S), Math.round((SPAWN.z + FENCE) / S)]];
seen.add(key(q[0][0], q[0][1]));
while (q.length) {
  const [i, j] = q.pop();
  for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni > N || nj > N || seen.has(key(ni, nj))) continue;
    const x = ni * S - FENCE, z = nj * S - FENCE;
    if (!clearAt(x, z, 0.9)) continue;
    seen.add(key(ni, nj)); q.push([ni, nj]);
  }
}
const reach = (x, z, what) => {
  const i = Math.round((x + FENCE) / S), j = Math.round((z + FENCE) / S);
  let ok = false;
  for (let a = -3; a <= 3 && !ok; a++) for (let b = -3; b <= 3 && !ok; b++) ok = seen.has(key(i+a, j+b));
  console.log('  ' + (ok ? 'reachable  ' : 'UNREACHABLE') + '  ' + what);
  return ok;
};
console.log('reachable on foot from the spawn:');
reach(OFF.x - OFF.w/2 - 1.5, OFF.z, 'the office door');
/* The office is modelled here as a SOLID box, so its interior can never be
   reachable in this check — the real yard leaves a doorway gap in the west
   wall. Reaching the door is the meaningful test; the interior is not. */
for (const id of ['crudeTank','cdu','blendTank','storeTank','bay','cracker','reformer','treater','alky','lab','automation','pumps','truck']) {
  const p = B.plotPosition(id, 0);
  const r = R[id];
  reach(p.x, p.z - r - 1.6, id + ' (first plot)');
}
