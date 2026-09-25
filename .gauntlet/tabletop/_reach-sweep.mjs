/* reach-cue — LIFT SWEEP, and the correction that made it measure the right
   thing. One render, many lifts: project() is pure over a parked camera and
   unitScreenBox() is pure over a settled scene, so the whole ladder is scored
   inside ONE --report. Every row is then measured against the SAME frame, so
   the ladder cannot be confounded by a scene that settled differently between
   Chromium boots.

   🔴 THE FIRST VERSION OF THIS FILE ASKED THE WRONG QUESTION, and it is worth
   the paragraph because the wrong question looked exactly like the right one.
   It scored "does this pip intersect ANY unit's screen box", swept 0.05 → 4.0,
   and reported that NO lift reaches zero (9,0,3,2,4,3,3,4,3,3 hits). Read
   naively that says the whole approach is impossible. It says nothing of the
   kind. The reachable region spans rows 2-10, so the pip cloud is ~260px tall
   while the bodies occupy y 266-471; lifting the cloud slides its NEAR half up
   THROUGH that band while its far half leaves at the top. There is no global
   lift that empties the band because the cloud is taller than the gap.

   And "intersects any box" was never the requirement. A pip that overlaps a
   body standing BEHIND its own tile is fine — that body cannot hide that tile,
   and the pip is painted after the actor loop so it is drawn over it anyway.
   The requirement (§12.3.1) is per-tile and relative:

       for a tile whose GROUND the player cannot see — i.e. whose ground centre
       falls inside some unit's screen box — that tile's pip must sit ABOVE the
       TOP of every body that is hiding it.

   That population is the one §12.2 is about; scoring the other 30 tiles was
   the "one degree off" failure in its usual costume. The ladder below reports
   BOTH numbers so a reader can see the difference rather than take it on faith.

   ⚠ AND A CEILING, so "clear of the occluders" cannot be won by flinging the
   pips into the sky. maxRise is the largest screen distance between a pip and
   its own tile's ground centre. A constellation that has left the board is a
   different failure and it has to be visible as a number.
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const SHOT = fileURLToPath(new URL('./shot.mjs', import.meta.url));
const ROWS_LADDER = [0, 0.8, 1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0, 2.4];

/* Runs in the board frame. `A` are the renderer's own cached anchors, each at
   its tile's GROUND height — so a.y is the ground and a.y+L is the pip, and
   the two are measured from one object rather than from two derivations. */
const REPORT = "(() => { const R = window.__bbReach; const A = window.teleLoops().pips || []; " +
  "const boxes = (window.Board.units || []).filter(u => !u.dead).map(u => { const b = window.Board.unitScreenBox(u); " +
  "return b ? { id:u.id, x:u.x, z:u.z, left:b.left, top:b.top, w:b.width, h:b.height } : null; }).filter(Boolean); " +
  "const hidden = []; for (let i=0;i<A.length;i++){ const a=A[i]; const g=window.project({x:a.x,y:a.y+0.02,z:a.z}); if(!g) continue; " +
  "const over=[]; for (const b of boxes) if (g.x>b.left && g.x<b.left+b.w && g.y>b.top && g.y<b.top+b.h) over.push(b); " +
  "if (over.length) hidden.push({ i, gx:g.x, gy:g.y, over }); } " +
  "const keep = R.rows; const rows = []; const V = window.hexV(); " +
  "for (const L of " + JSON.stringify(ROWS_LADDER) + "){ R.rows = L; const P = window.teleReachPoints(); " +
  "let anyHit=0, occHit=0, maxRise=0, minMargin=1e9, worst=null; " +
  "for (let i=0;i<A.length;i++){ const p=P[i]; if(!p) continue; const a=A[i]; " +
  "const g=window.project({x:a.x,y:a.y,z:a.z}); if(g){ const rise=Math.abs(g.y-p.y); if(rise>maxRise) maxRise=rise; } " +
  "for (const b of boxes) if (p.x+p.r>b.left && p.x-p.r<b.left+b.w && p.y+p.r>b.top && p.y-p.r<b.top+b.h){ anyHit++; break; } } " +
  "for (const H of hidden){ const p=P[H.i]; if(!p){ occHit++; continue; } " +
  "for (const b of H.over){ const m = b.top - (p.y + p.r); if (m < minMargin) minMargin = m; " +
  "if (m <= 0){ occHit++; if(!worst) worst='pip#'+H.i+' y='+(p.y+p.r).toFixed(0)+' vs '+b.id+' top='+b.top.toFixed(0); break; } } } " +
  "let ruMin=1e9, ruMax=0; for (let i=0;i<A.length;i++){ const p=P[i]; if(!p) continue; const a=A[i]; " +
  "const g=window.project({x:a.x,y:a.y,z:a.z}); const nb=window.project({x:a.x,y:a.y,z:a.z+V}); if(!g||!nb) continue; " +
  "const ru=(g.y-p.y)/Math.abs(nb.y-g.y); if(ru<ruMin)ruMin=ru; if(ru>ruMax)ruMax=ru; } " +
  "rows.push({ L, anyHit, occHit, maxRise:+maxRise.toFixed(1), minMargin:+minMargin.toFixed(1), drift:+(ruMax/Math.max(0.001,ruMin)).toFixed(2), worst }); } " +
  "R.rows = keep; " +
  "return JSON.stringify({ rows, n:A.length, hidden:hidden.map(h=>({i:h.i, by:h.over.map(o=>o.id+'@'+o.x+','+o.z)})), boxes }); })()";

const src = fs.readFileSync(SHOT, 'utf8');
const N2 = "  '--eval', evalJs,\n";
if (!src.includes(N2)) { console.error('FAIL: boardshot arg list not found'); process.exit(1); }
const out = src.replace(N2, N2 + "    '--report', " + JSON.stringify(REPORT) + ",\n");
if (out === src) { console.error('FAIL: replace was a no-op'); process.exit(1); }
if (!out.includes('--report')) { console.error('FAIL: injection missing'); process.exit(1); }
const dst = fileURLToPath(new URL('./_reach-shot-sweep.mjs', import.meta.url));
fs.writeFileSync(dst, out);

const png = fileURLToPath(new URL('./_reach-sweep.png', import.meta.url));
const r = spawnSync(process.execPath, [dst, png, '--scene', 'crowd'], { encoding:'utf8', maxBuffer: 1 << 26 });
let J; try { J = JSON.parse(r.stdout); } catch { console.error(r.stdout.slice(-1200)); process.exit(1); }
const rep = J.boardshot && J.boardshot.report;
if (!rep) { console.error(JSON.stringify(J.boardshot, null, 1).slice(-1500)); console.error('FAIL: no report'); process.exit(1); }
const D = JSON.parse(rep);

console.log(`pips: ${D.n}   OCCLUDED tiles (ground centre inside a body): ${D.hidden.length}`);
for (const h of D.hidden) console.log(`   pip#${h.i} hidden by ${h.by.join(', ')}`);
console.log('\n  lift   occHit  anyHit  minMargin(px)  maxRise(px)  worst occluded case');
for (const row of D.rows)
  console.log(`  ${String(row.L).padEnd(5)}  ${String(row.occHit).padStart(6)}  ${String(row.anyHit).padStart(6)}  ${String(row.minMargin).padStart(13)}  ${String(row.maxRise).padStart(11)}  ${String(row.drift).padStart(5)}  ${row.worst || '-'}`);

const lo = D.rows[0], hi = D.rows[D.rows.length-1];
console.log(`\n  ladder sanity: rows=${lo.L} (flat on the ground) occHit=${lo.occHit} (must be >0); top rows=${hi.L} occHit=${hi.occHit} (must be 0)`);
process.exit((lo.occHit > 0 && hi.occHit === 0) ? 0 : 1);
