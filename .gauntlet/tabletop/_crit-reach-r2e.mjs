/* What lift can the caret keep and still hover over the tile it means?
   Sweep REACH_CUE.rows and count point-in-OWN-hexagon. This exists so the
   instruction handed back carries a measured number rather than a guess. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SHOT = fileURLToPath(new URL('./_crit-shot-report.mjs', import.meta.url));
const REPORT = `(() => {
const R = window.__bbReach, keys = [...PAINT.move];
const polys = [];
for (let x=0;x<14;x++) for (let z=0;z<12;z++){ const P=tilePoly(x,z,0); if (P) polys.push({k:x+','+z,P}); }
const hit = (px,py) => polys.filter(o=>{ let ins=false; for(let i=0,j=5;i<6;j=i++){ const a=o.P[i],b=o.P[j];
  if (((a.y>py)!==(b.y>py)) && (px < (b.x-a.x)*(py-a.y)/(b.y-a.y)+a.x)) ins=!ins; } return ins; }).map(o=>o.k);
const out = [];
for (let rows = 0; rows <= 1.8001; rows += 0.1){
  const keep = R.rows; R.rows = +rows.toFixed(2); const pts = teleReachPoints(); R.rows = keep;
  let own = 0, occ = 0, nil = 0;
  keys.forEach((k,i) => { const h = hit(pts[i].x, pts[i].y);
    if (h.includes(k)) own++; if (!h.length) nil++;
    if (h.some(t => units.some(u => !u.dead && u.x+','+u.z === t))) occ++; });
  out.push({ rows:+rows.toFixed(2), own, occ, nil });
}
return JSON.stringify(out);
})()`;
const r = spawnSync(process.execPath, [SHOT, '.gauntlet/tabletop/_crit-reach-r2e.png','--scene','crowd','--report',REPORT],
  { encoding:'utf8', maxBuffer:1<<28, cwd: fileURLToPath(new URL('../../', import.meta.url)) });
process.stderr.write(r.stderr||'');
const D = JSON.parse(JSON.parse(r.stdout).boardshot.report);
console.log('rows  carets-over-OWN-tile /36   over-an-OCCUPIED-tile   over-NO-tile');
for (const o of D) console.log('  ' + String(o.rows).padEnd(5) + '        ' + String(o.own).padStart(2) +
  '                     ' + String(o.occ).padStart(2) + '                  ' + String(o.nil).padStart(2) +
  (o.own === 36 ? '   ✅' : ''));
