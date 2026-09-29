/* ══════════════════════════════════════════════════════════════════════════
   CRITIC PROBE 2 — the attribution result of _crit-reach-r2.mjs, hardened.

   Probe 1 said 0/36 carets are nearest their own tile and 16/36 are nearest a
   tile outside the move set. NEAREST CENTRE is a proxy, and on a board with
   elevation it conflates "further back" with "higher up", so before that
   number is used to fail a piece it is re-asked two stricter ways:

     A  IN ROWS.  lift_px ÷ that tile's OWN projected row pitch. This is the
        quantity REACH_CUE.rows claims to hold at 1.60 for every tile, and the
        header's ATTEMPT-1 post-mortem is written in exactly these units, so
        it is the number that can be compared to the build's own claim.
     B  POINT-IN-HEXAGON.  Which tile's drawn hexagon actually contains the
        caret point — the literal "what ground is this mark hovering over".
        tilePoly() is the same function the wash and the contour are built
        from, so this asks the question in the renderer's own geometry rather
        than in my arithmetic.

   🔴 NEGATIVE CONTROL FIRST: at rows=0 both answers must be degenerate —
      lift 0.00 rows, and point-in-hexagon must return the caret's OWN tile
      for every caret. A run where the control is not degenerate is measuring
      the probe, not the build.
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHOT = fileURLToPath(new URL('./_crit-shot-report.mjs', import.meta.url));

const REPORT = `(() => {
const R = window.__bbReach;
const keys = [...PAINT.move];
const V = hexV();

/* every tile's drawn hexagon, in screen space, from the renderer's own
   tilePoly() — the function teleWash and teleContour are built from */
const polys = [];
for (let x = 0; x < 14; x++) for (let z = 0; z < 12; z++){
  const P = tilePoly(x, z, 0); if (!P) continue;
  polys.push({ k: x + ',' + z, P });
}
function hit(px, py){
  const out = [];
  for (const o of polys){
    let inside = false;
    for (let i = 0, j = 5; i < 6; j = i++){
      const a = o.P[i], b = o.P[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    if (inside) out.push(o.k);
  }
  return out;
}
function run(rows){
  const keep = R.rows; R.rows = rows;
  const pts = teleReachPoints();
  R.rows = keep;
  return keys.map((k, i) => {
    const c = k.indexOf(',');
    const gx = +k.slice(0, c), gz = +k.slice(c + 1);
    const g  = project(gw(gx, gz, tileElev(gx, gz)));
    const nb = project({ x: gw(gx, gz, tileElev(gx, gz)).x, y: tileElev(gx, gz), z: gw(gx, gz, 0).z + V });
    const pitch = nb ? Math.abs(nb.y - g.y) : null;
    const p = pts[i];
    const over = hit(p.x, p.y);
    return { k, pitch: pitch && +pitch.toFixed(2), lift: +(g.y - p.y).toFixed(1),
             rows: pitch ? +((g.y - p.y) / pitch).toFixed(2) : null,
             over, overOwn: over.includes(k), overInSet: over.some(o => PAINT.move.has(o)),
             overNone: over.length === 0, occupied: over.filter(o => {
               const cc = o.indexOf(','); const ox = +o.slice(0,cc), oz = +o.slice(cc+1);
               return units.some(u => !u.dead && u.x === ox && u.z === oz);
             }) };
  });
}
return JSON.stringify({ ctl: run(0), live: run(R.rows), rows: R.rows,
  sel: PAINT.sel, nMove: keys.length,
  unitTiles: units.filter(u=>!u.dead).map(u => u.x + ',' + u.z) });
})()`;

const r = spawnSync(process.execPath, [
  SHOT, '.gauntlet/tabletop/_crit-reach-r2b.png', '--scene', 'crowd', '--report', REPORT,
], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: fileURLToPath(new URL('../../', import.meta.url)) });
process.stderr.write(r.stderr || '');
let j; try { j = JSON.parse(r.stdout); } catch { console.log(r.stdout.slice(-3000)); process.exit(1); }
const D = JSON.parse(j.boardshot.report);

const ctlBad = D.ctl.filter(o => !o.overOwn || Math.abs(o.rows) > 0.01);
console.log('--- NEGATIVE CONTROL rows=0 ------------------------------------');
console.log('  ' + (ctlBad.length === 0 ? '✅' : '🔴') + ' ' + (D.ctl.length - ctlBad.length) + '/' + D.ctl.length +
            ' carets sit at lift 0.00 rows INSIDE their own hexagon' +
            (ctlBad.length ? '  — probe is wrong, stop' : ''));

const rows = D.live.map(o => o.rows).filter(v => v != null).sort((a,b)=>a-b);
console.log('\n--- A  LIFT IN ROWS (the unit REACH_CUE.rows is written in) ----');
console.log('  claimed ' + D.rows + '   measured min ' + rows[0] + '  median ' + rows[rows.length>>1] + '  max ' + rows[rows.length-1]);
console.log('  pitch px: min ' + Math.min(...D.live.map(o=>o.pitch)) + '  max ' + Math.max(...D.live.map(o=>o.pitch)));

console.log('\n--- B  POINT-IN-HEXAGON: what ground is the mark hovering over? -');
const own  = D.live.filter(o => o.overOwn);
const inS  = D.live.filter(o => !o.overOwn && o.overInSet);
const outS = D.live.filter(o => !o.overOwn && !o.overInSet && !o.overNone);
const none = D.live.filter(o => o.overNone);
const occ  = D.live.filter(o => o.occupied.length);
console.log('  over its OWN tile                        : ' + own.length + '/' + D.live.length);
console.log('  over a DIFFERENT tile that IS reachable  : ' + inS.length + '/' + D.live.length);
console.log('  over a tile that is NOT reachable        : ' + outS.length + '/' + D.live.length +
            (outS.length ? '\n      ' + outS.slice(0,8).map(o => o.k + ' hovers over ' + o.over.join('/')).join('\n      ') : ''));
console.log('  over NO tile at all (off the board)      : ' + none.length + '/' + D.live.length +
            (none.length ? '   ' + none.map(o=>o.k).join(' ') : ''));
console.log('  over a tile a UNIT IS STANDING ON        : ' + occ.length + '/' + D.live.length +
            (occ.length ? '\n      ' + occ.map(o => o.k + ' hovers over occupied ' + o.occupied.join('/')).join('\n      ') : ''));
console.log('\n  unit tiles: ' + D.unitTiles.join('  ') + '   selected: ' + JSON.stringify(D.sel));
