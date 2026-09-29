/* reach-cue — IS THE FLOAT UNIFORM ACROSS THE BOARD?

   Looking at the wide crop, the pips along the region's FAR edge appear to
   hover further from their tiles than the near ones do — which, if true, is a
   misattribution bug: a far pip would sit over a tile two or three rows behind
   its own, and the player would read the region as being somewhere it is not.

   That is an eye judgement and the eye is the wrong instrument here, because
   the region's far edge genuinely IS at the back of the board, so a pip that
   is correctly one row up has nothing behind it and LOOKS detached.

   So measure it in the unit that decides the question: RISE / LOCAL ROW PITCH,
   i.e. how many hex rows up the pip floats, evaluated per tile at that tile's
   own depth. Uniform ⇒ the cloud is a consistent hovering layer and the wide
   crop was misleading. Growing with distance ⇒ a real defect and the lift has
   to become a screen-space quantity instead of a world one.

   Row pitch is taken from the tile's OWN two neighbours in z (gz±1 projected
   at the same ground height), not from a constant — the projection is
   perspective, so the pitch is a function of depth and a constant would be the
   very assumption under test.
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const SHOT = fileURLToPath(new URL('./shot.mjs', import.meta.url));

/* Anchors carry world x/z but not their grid coordinates, so the row pitch is
   measured in WORLD units off the lattice pitch (hexV) and projected at the
   anchor's own position: a point one row's worth of world z nearer, same
   height, gives the on-screen distance one row spans THERE. */
/* The pip positions come from teleReachPoints() — the renderer's own helper,
   the one the painter strokes — never from a formula retyped here. Recomputing
   them would let this file certify its own arithmetic as uniform while the
   painter drew something else. */
const REPORT = "(() => { const R = window.__bbReach; const A = window.teleLoops().pips || []; " +
  "const P = window.teleReachPoints(); const V = window.hexV(); const rows = []; " +
  "for (let i=0;i<A.length;i++){ const a = A[i], p = P[i]; if (!p) continue; " +
  "const g  = window.project({ x:a.x, y:a.y, z:a.z }); " +
  "const nb = window.project({ x:a.x, y:a.y, z:a.z + V }); " +
  "if (!g || !nb) continue; " +
  "const rise = g.y - p.y, pitch = Math.abs(nb.y - g.y); " +
  "rows.push({ depth:+g.z.toFixed(2), gy:+g.y.toFixed(1), rise:+rise.toFixed(1), pitch:+pitch.toFixed(1), rowsUp:+(rise/pitch).toFixed(2) }); } " +
  "rows.sort((a,b) => b.depth - a.depth); return JSON.stringify({ lift:R.rows, rows }); })()";

const src = fs.readFileSync(SHOT, 'utf8');
const N2 = "  '--eval', evalJs,\n";
if (!src.includes(N2)) { console.error('FAIL: boardshot arg list not found'); process.exit(1); }
const out = src.replace(N2, N2 + "    '--report', " + JSON.stringify(REPORT) + ",\n");
if (out === src) { console.error('FAIL: replace was a no-op'); process.exit(1); }
const dst = fileURLToPath(new URL('./_reach-shot-drift.mjs', import.meta.url));
fs.writeFileSync(dst, out);
const png = fileURLToPath(new URL('./_reach-drift.png', import.meta.url));
const r = spawnSync(process.execPath, [dst, png, '--scene', 'crowd'], { encoding:'utf8', maxBuffer: 1 << 26 });
let J; try { J = JSON.parse(r.stdout); } catch { console.error(r.stdout.slice(-1200)); process.exit(1); }
const rep = J.boardshot && J.boardshot.report;
if (!rep) { console.error(JSON.stringify(J.boardshot, null, 1).slice(-1200)); process.exit(1); }
const D = JSON.parse(rep);

console.log(`lift=${D.lift}   ${D.rows.length} pips, sorted FURTHEST first\n`);
console.log('  camDepth   groundY   rise(px)  rowPitch(px)  rowsUp');
for (const t of D.rows)
  console.log(`  ${String(t.depth).padStart(8)}  ${String(t.gy).padStart(8)}  ${String(t.rise).padStart(8)}  ${String(t.pitch).padStart(12)}  ${String(t.rowsUp).padStart(6)}`);

const ru = D.rows.map(t => t.rowsUp);
const far = ru.slice(0, 6), near = ru.slice(-6);
const avg = a => a.reduce((s,v)=>s+v,0)/a.length;
console.log(`\n  furthest 6 average rowsUp = ${avg(far).toFixed(2)}`);
console.log(`  nearest  6 average rowsUp = ${avg(near).toFixed(2)}`);
console.log(`  spread  min=${Math.min(...ru).toFixed(2)}  max=${Math.max(...ru).toFixed(2)}  ratio=${(Math.max(...ru)/Math.min(...ru)).toFixed(2)}x`);
console.log(`\n  VERDICT: ${(Math.max(...ru)/Math.min(...ru)) < 1.35
  ? 'UNIFORM — every pip floats the same number of rows over its own tile, at every depth.'
  : 'NOT UNIFORM — far pips drift further in rows than near ones, so a far mark hovers over the wrong tile. This is what killed the world-unit lift; see REACH_CUE.rows.'}`);
