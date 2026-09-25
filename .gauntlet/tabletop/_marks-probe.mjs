/* arena-markings — the NUMERIC check, because eyeballing a 1600x900 board shot
   cannot tell "the centre line is missing" from "the centre line is faint".
   Boots the board through boardshot.mjs, posts a board:map, and asks the PAGE
   where each mark landed in screen pixels and how many tiles each one touches.
   Second run posts a DIFFERENT cols/rows so the plan can be shown to re-derive
   (piece judgedBy: "FAIL if the marks survive unchanged when --eval posts a
   board:map with different cols/rows"). */
import { spawnSync } from 'node:child_process';

const REPORT = `JSON.stringify((function(){
  const M = markPlan(), zd = Math.abs(M.zDep), R = hexSize();
  const y = z => { const p = project({x:0,y:0,z:z}); return p ? Math.round(p.y) : null; };
  let mid=0, dep=0, zone=0, circ=0, obj=0;
  for (let z=0; z<MAP.rows; z++) for (let x=0; x<MAP.cols; x++){
    const w = gw(x,z,0), az = Math.abs(w.z);
    if (az <= M.lw*MARKS.haloW + R) mid++;
    if (Math.abs(az-zd) <= M.lw*0.72*MARKS.haloW + R) dep++;
    if (az >= zd - R) zone++;
    if (w.x*w.x + w.z*w.z <= (M.cr+R)*(M.cr+R)) circ++;
    for (const o of M.objs) if (Math.abs(w.x-o.x) <= M.or+R && Math.abs(w.z-o.z) <= M.or+R){ obj++; break; }
  }
  return { board: MAP.cols+'x'+MAP.rows, sig:M.sig, depRows:M.dep,
           zDep:+M.zDep.toFixed(3), lw:+M.lw.toFixed(3), or:+M.or.toFixed(3), cr:+M.cr.toFixed(3),
           screenY:{ row0:y(gw(0,0,0).z), depFar:y(-zd), mid:y(0), depNear:y(zd), rowN:y(gw(0,MAP.rows-1,0).z) },
           tilesTouched:{ mid, dep, zone, circ, obj },
           mk: (terrainKey().match(/mk[^|]*/)||[''])[0] };
})())`;

function run(cols, rows){
  const tiles = [];
  for (let z=0; z<rows; z++) for (let x=0; x<cols; x++) tiles.push({ x, z, surf:'grass', elev:0 });
  const payload = JSON.stringify({ cols, rows, tiles });
  const r = spawnSync(process.execPath, [
    'E:/game-deploy/.gauntlet/boardshot.mjs',
    'E:/game-deploy/.gauntlet/tabletop/_marks-probe-' + cols + 'x' + rows + '.png',
    '--wait', '6500', '--w', '1600', '--h', '900',
    '--eval', `window.postMessage({type:'board:map',map:${payload}},location.origin)`,
    '--report', REPORT
  ], { encoding:'utf8', maxBuffer: 1 << 26 });
  process.stderr.write(r.stderr || '');
  let o; try { o = JSON.parse(r.stdout); } catch { o = { raw: String(r.stdout).slice(-1500) }; }
  console.log(cols + 'x' + rows + ' -> ' + (o.report || JSON.stringify(o).slice(0, 800)));
}
run(14, 12);
run(10, 8);
