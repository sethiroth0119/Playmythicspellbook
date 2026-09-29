/* arena-markings r1 — WHERE on screen is each mark, in pixels.
   _am-geom.mjs reported thicknesses; this reports POSITIONS, so a row-band
   signal profile can be read against the plan instead of against a guess.
   (The first version of this analysis guessed the far deployment line's screen
   row from the zone depth and was wrong by a row, which is how a builder talks
   himself into a defect that is not there. Ask the page.) */
import { spawnSync } from 'node:child_process';
const COLS = 14, ROWS = 12;
const tiles = [];
for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) tiles.push({ x, z, surf:'grass', elev:0 });
const payload = JSON.stringify({ cols: COLS, rows: ROWS, tiles });

const REPORT = `(() => {
  const M = markPlan(), hv = hexV(), R = hexSize();
  const sy = (wz, wx) => { const p = project({ x:wx||0, y:0, z:wz }); return p ? Math.round(p.y*10)/10 : null; };
  const zd = Math.abs(M.zDep);
  const rows = [];
  for (let g = 0; g < MAP.rows; g++) rows.push(sy((g - (MAP.rows-1)/2) * hv));
  return {
    rowCentreY: rows,
    boardFarEdgeY:  sy(-M.zEnd),
    boardNearEdgeY: sy(M.zEnd),
    depLineFarY:  [sy(-zd - M.lw*0.62), sy(-zd), sy(-zd + M.lw*0.62)],
    depLineNearY: [sy(zd - M.lw*0.62), sy(zd), sy(zd + M.lw*0.62)],
    centreLineY:  [sy(-M.lw), sy(0), sy(M.lw)],
    objFarY:  sy(M.objs[0].z), objNearY: sy(M.objs[2].z),
    objFarX:  (()=>{const p=project({x:M.objs[0].x,y:0,z:M.objs[0].z});return p?Math.round(p.x):null;})(),
    objNearX: (()=>{const p=project({x:M.objs[2].x,y:0,z:M.objs[2].z});return p?Math.round(p.x):null;})(),
    centreCircleY: [sy(-M.cr), sy(M.cr)],
    /* and the ALPHAS actually in force, so a reader can tell a faint mark from
       an absent one without opening the source */
    alphas: { zoneA: MARKS.zoneA, depA: MARKS.depA, depEdgeA: MARKS.depEdgeA,
              lineA: MARKS.lineA, edgeA: MARKS.edgeA, ringA: MARKS.ringA, haloA: MARKS.haloA }
  };
})()`;

const r = spawnSync(process.execPath, [
  'E:/game-deploy/.gauntlet/boardshot.mjs', 'E:/game-deploy/.gauntlet/tabletop/_am-geom2.png',
  '--wait', '7000', '--w', '1600', '--h', '900',
  '--eval', `window.postMessage({type:'board:map',map:${payload}},location.origin)`,
  '--report', REPORT,
], { encoding: 'utf8', maxBuffer: 1 << 26 });
process.stderr.write(r.stderr || '');
try { console.log(JSON.stringify(JSON.parse(r.stdout).report, null, 1)); }
catch { console.log(r.stdout); }
