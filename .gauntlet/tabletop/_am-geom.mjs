/* arena-markings r1 — MEASURE the pitch in screen pixels, in the real page.
   ══════════════════════════════════════════════════════════════════════════
   Why this exists: the diff image proves the marks are drawn, but §7's test is
   "a player can see whose half is whose AT A GLANCE" and the two halves are NOT
   at the same distance from a fixed high camera (§2). An A/B percentage cannot
   tell those apart — it happily reports a big number while one half of a
   mirrored plan is four times thinner than the other. So this asks the page
   itself, through boardshot's --report hook, for the projected screen geometry
   of every mark in BOTH halves.
   These identifiers are top-level `const`/`function` in a CLASSIC script, so
   they live in the global LEXICAL environment and a later page.evaluate sees
   them — the exact opposite of the ES-module case in CLAUDE.md, and the reason
   this probe can exist at all without a new export. */
import { spawnSync } from 'node:child_process';

const COLS = 14, ROWS = 12;
/* the same scene shot.mjs posts, minus the tiles: geometry does not read them */
const tiles = [];
for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) tiles.push({ x, z, surf:'grass', elev:0 });
const payload = JSON.stringify({ cols: COLS, rows: ROWS, tiles });

const REPORT = `(() => {
  const M = markPlan(), hv = hexV(), R = hexSize();
  /* screen y of a world z on the centre column, at ground level */
  const sy = (wz) => { const p = project({ x:0, y:0, z:wz }); return p ? Math.round(p.y*10)/10 : null; };
  /* on-screen thickness, in px, of a band of half-width h centred at c */
  const thick = (c, h) => { const a = sy(c-h), b = sy(c+h); return (a==null||b==null) ? null : Math.round(Math.abs(b-a)*10)/10; };
  const zd = Math.abs(M.zDep);
  return {
    rows: MAP.rows, cols: MAP.cols, dep: M.dep, hv: Math.round(hv*1e3)/1e3,
    lwWorld: Math.round(M.lw*1e3)/1e3,
    rowDepthPx: { far: thick(-(MAP.rows-1)/2*hv, hv/2), mid: thick(0, hv/2), near: thick((MAP.rows-1)/2*hv, hv/2) },
    centreLinePx: thick(0, M.lw),
    depLinePx:    { far: thick(-zd, M.lw*0.62), near: thick(zd, M.lw*0.62) },
    zoneDepthPx:  { far: Math.abs(sy(-M.zEnd) - sy(-zd)), near: Math.abs(sy(M.zEnd) - sy(zd)) },
    objRingPx:    { far: thick(-M.objs[0].z*-1, M.or), near: thick(M.objs[2].z, M.or) },
    marksOn: MARKS.on
  };
})()`;

const r = spawnSync(process.execPath, [
  'E:/game-deploy/.gauntlet/boardshot.mjs', 'E:/game-deploy/.gauntlet/tabletop/_am-geom.png',
  '--wait', '7000', '--w', '1600', '--h', '900',
  '--eval', `window.postMessage({type:'board:map',map:${payload}},location.origin)`,
  '--report', REPORT,
], { encoding: 'utf8', maxBuffer: 1 << 26 });
process.stderr.write(r.stderr || '');
try { console.log(JSON.stringify(JSON.parse(r.stdout).report, null, 1)); }
catch { console.log(r.stdout); }
