/* THE CASE THE PIECE EXISTS FOR, named tile by tile.
   §12.7 says judge the crowd, and §12.3.1 says a tile whose GROUND you cannot
   see must still be identifiable. So: take only the reachable tiles whose
   ground centre is behind a body, and print, for each, the tile its caret is
   actually hovering over. That is the exact question a player asks in the
   scrum — "can I go behind the wyrm" — and the exact one a floating mark has
   to answer.

   🔴 NEGATIVE CONTROL: the same listing at rows=0. Every one of those carets
   must then name its own tile. If the control does not come back clean the
   listing below is my arithmetic, not the build. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHOT = fileURLToPath(new URL('./_crit-shot-report.mjs', import.meta.url));
const REPORT = `(() => {
const R = window.__bbReach, keys = [...PAINT.move];
const polys = [];
for (let x = 0; x < 14; x++) for (let z = 0; z < 12; z++){ const P = tilePoly(x,z,0); if (P) polys.push({k:x+','+z,P}); }
const hit = (px,py) => polys.filter(o => { let ins=false; for (let i=0,j=5;i<6;j=i++){ const a=o.P[i],b=o.P[j];
  if (((a.y>py)!==(b.y>py)) && (px < (b.x-a.x)*(py-a.y)/(b.y-a.y)+a.x)) ins=!ins; } return ins; }).map(o=>o.k);
const live = units.filter(u => !u.dead);
const boxes = live.map(u => ({ id:u.id, tile:u.x+','+u.z, b:unitScreenBox(u) })).filter(o=>o.b);
const cover = (px,py) => boxes.filter(o => px>=o.b.left && px<=o.b.left+o.b.width && py>=o.b.top && py<=o.b.top+o.b.height);
function run(rows){
  const keep = R.rows; R.rows = rows; const pts = teleReachPoints(); R.rows = keep;
  return keys.map((k,i) => {
    const c=k.indexOf(','); const gx=+k.slice(0,c), gz=+k.slice(c+1);
    const g = project(gw(gx,gz,tileElev(gx,gz)));
    const hidBy = cover(g.x, g.y);
    return { k, hidBy: hidBy.map(o=>o.id+'@'+o.tile), over: hit(pts[i].x, pts[i].y),
             occupiedUnder: hit(pts[i].x, pts[i].y).filter(t => live.some(u => u.x+','+u.z === t)) };
  }).filter(o => o.hidBy.length);
}
return JSON.stringify({ ctl: run(0), live: run(R.rows) });
})()`;
const r = spawnSync(process.execPath, [SHOT, '.gauntlet/tabletop/_crit-reach-r2d.png', '--scene','crowd','--report',REPORT],
  { encoding:'utf8', maxBuffer: 1<<28, cwd: fileURLToPath(new URL('../../', import.meta.url)) });
process.stderr.write(r.stderr||'');
const D = JSON.parse(JSON.parse(r.stdout).boardshot.report);
const bad = D.ctl.filter(o => !o.over.includes(o.k));
console.log('NEGATIVE CONTROL rows=0: ' + (bad.length?'🔴 ':'✅ ') + (D.ctl.length-bad.length) + '/' + D.ctl.length +
            ' of the ground-hidden tiles name their OWN tile at zero lift');
console.log('\nreachable tiles whose GROUND is behind a body — where their caret actually hovers:');
for (const o of D.live)
  console.log('  tile ' + o.k.padEnd(5) + ' ground hidden by ' + o.hidBy.join(',').padEnd(16) +
              '  caret hovers over ' + (o.over.join('/') || '(no tile — off the hex field)') +
              (o.occupiedUnder.length ? '   🔴 that tile is OCCUPIED' : '') +
              (o.over.includes(o.k) ? '   ✅ own tile' : ''));
