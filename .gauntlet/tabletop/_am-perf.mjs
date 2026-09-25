/* arena-markings r1 — what does flipping MARKS.on COST?
   ══════════════════════════════════════════════════════════════════════════
   TABLETOP-BAR §8.9: performance does not regress, and if the ground bake gets
   more expensive the frame cost must be PROVEN, not asserted. paintArenaMarks
   adds a save/clip/fill/stroke pass to every tile that the plan touches, on
   every bake — and nobody had priced it, because until this round the flag was
   off and the painter returned on its first line.
   Method: bake the real terrain into an offscreen canvas through the real
   bakeTerrainInto(), alternating MARKS.on, and report the medians. Alternating
   rather than blocked, so a warming JIT or a GC pause lands on both arms.
   🔴 The A/B is valid ONLY because bakeTerrainInto is synchronous and stamps
   TERR.ms itself — this is not an rAF measurement, so CLAUDE.md's 0.56 Hz
   Browser-pane trap does not apply and no rAF shim is needed. */
import { spawnSync } from 'node:child_process';
const COLS = 14, ROWS = 12;
/* the real mixed scene's shape matters for cost, so reuse shot.mjs's generator
   rather than a flat board: a flat board has no walls and no cliff faces. */
const { default:_ } = { default:null };
const tiles = [];
const rng = (s => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)(0x5EED);
const ELEM = ['lava','ice','nature','void','storm','crystal'];
for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++){
  const r = rng();
  const surf = r < 0.60 ? ['grass','asphalt','dirt'][(rng()*3)|0]
             : r < 0.78 ? ['rubble','water','mud','sand'][(rng()*4)|0]
             : ELEM[(rng()*ELEM.length)|0];
  tiles.push({ x, z, surf, elev: [0,0.34,0.68,1.02][(rng()*4)|0] });
}
const payload = JSON.stringify({ cols: COLS, rows: ROWS, tiles });

const REPORT = `(() => {
  const cv = document.createElement('canvas');
  cv.width = (TERR.cv && TERR.cv.width) || 1600; cv.height = (TERR.cv && TERR.cv.height) || 900;
  const bake = () => { bakeTerrainInto(cv, LIGHT); return TERR.ms; };
  const on = [], off = [];
  const was = MARKS.on;
  bake(); bake();                         /* warm: first bake pays for tile art decode */
  for (let i = 0; i < 9; i++){
    MARKS.on = true;  on.push(bake());
    MARKS.on = false; off.push(bake());
  }
  MARKS.on = was;
  const med = a => { const s = [...a].sort((p,q)=>p-q); return Math.round(s[s.length>>1]*100)/100; };
  const mOn = med(on), mOff = med(off);
  return { marksOn_ms: mOn, marksOff_ms: mOff,
           delta_ms: Math.round((mOn-mOff)*100)/100,
           delta_pct: Math.round((mOn-mOff)/mOff*1000)/10,
           onSamples: on.map(v=>Math.round(v*10)/10), offSamples: off.map(v=>Math.round(v*10)/10),
           shippedFlag: was };
})()`;

const r = spawnSync(process.execPath, [
  'E:/game-deploy/.gauntlet/boardshot.mjs', 'E:/game-deploy/.gauntlet/tabletop/_am-perf.png',
  '--wait', '8000', '--w', '1600', '--h', '900',
  '--eval', `window.postMessage({type:'board:map',map:${payload}},location.origin)`,
  '--report', REPORT,
], { encoding: 'utf8', maxBuffer: 1 << 26 });
process.stderr.write(r.stderr || '');
try { console.log(JSON.stringify(JSON.parse(r.stdout).report, null, 1)); }
catch { console.log(r.stdout); }
