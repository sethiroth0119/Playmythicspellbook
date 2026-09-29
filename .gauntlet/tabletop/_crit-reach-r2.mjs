/* ══════════════════════════════════════════════════════════════════════════
   CRITIC PROBE — reach-cue round 2.  TABLETOP-BAR §12.3.
   Not the builder's gate. This one asks three questions the builder's
   _reach-ink.mjs does not:

     Q1  ATTRIBUTION.  The caret is lifted `rows` hex rows UP THE SCREEN, which
         on an isometric board is BACKWARDS ALONG THE LATTICE. So the mark for
         tile T is painted over the GROUND OF A DIFFERENT TILE. §12.3.3 ("it
         must not lie") and the REACH_CUE header's own ATTEMPT-1 post-mortem
         ("a mark hovering over the wrong tile is a cue that lies") make that
         the load-bearing question, and nothing in the build measures it.
         MEASURED: for every caret, which tile's ground centre is nearest, and
         is that tile in the move set at all.

     Q2  INK SURVIVAL, split by whether the tile's GROUND is behind a body.
         §12.3.1 is only about tiles you cannot see the ground of; averaging
         those in with the 20-odd tiles standing in open field is the "one
         degree off" failure §11 names.

     Q3  DOES THE CARET LAND ON A BODY.  §12.3.1 asks for a cue that lives
         ABOVE sprite height. Drawing last makes a cue UNOCCLUDED, which is a
         different property: a caret painted across a sprite's chest is
         visible and still reads as decoration ON THAT UNIT, not as ground
         behind it. Measured as: does the caret point fall inside some unit's
         screen box.

   🔴 NEGATIVE CONTROLS, WRITTEN BEFORE THE ASSERTS (§11).
     N1  `__bbReach.rows = 0` drops every caret onto its own tile centre. The
         nearest-tile arithmetic of Q1 MUST then answer "own tile" 36/36. If
         it does not, Q1 is measuring my projection bug, not the build. This
         is the control that makes the Q1 number mean anything.
     N2  `__bbReach.on = false` must take the A/B delta at every caret box to
         ~0, and a box with no caret in it must read ~0 in BOTH states. The
         second half is what separates "I am measuring the caret" from "I am
         measuring the rain".
     N3  the same-state control: two frames of the SAME state, same `now`,
         same reseed, must diff to ~0. Anything above that floor is animation
         leaking through my hold and every later number is noise.

   Run:  node .gauntlet/tabletop/_crit-reach-r2.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHOT = fileURLToPath(new URL('./_crit-shot-report.mjs', import.meta.url));

/* The whole measurement, as one expression evaluated in the BOARD frame.
   Everything is synchronous: the RAF reschedule is swallowed for the length
   of the sweep, so no frame can interleave between a frame() and its
   getImageData. This is a 2D context, so the readback is a plain bitmap read
   — the preserveDrawingBuffer warning in CLAUDE.md is about WebGL. */
const REPORT = `(() => {
const el = document.getElementById('stage');
const c2 = el.getContext('2d');
const R  = window.__bbReach;
const src = String(window.frame);
const order = { arc: src.indexOf('drawTeleArc('), plates: src.indexOf('drawNameplates()'), pips: src.indexOf('drawTeleReach(') };

/* css px -> device px: teleReachPoints() is in ctx space; the canvas backing
   store may be DPR-scaled. Read it, never assume 1. */
const rect = el.getBoundingClientRect();
const S = el.width / rect.width;

/* ---- board geometry, measured, not re-derived -------------------------- */
const moveKeys = [...PAINT.move];
const tileXY = {};                       /* every tile on the board */
for (let x = 0; x < 14; x++) for (let z = 0; z < 12; z++){
  const g = project(gw(x, z, tileElev(x, z)));
  if (g) tileXY[x + ',' + z] = { x: g.x, y: g.y };
}
const boxes = units.filter(u => !u.dead).map(u => ({ id: u.id, b: unitScreenBox(u) })).filter(o => o.b);
const inBox = (px, py) => boxes.filter(o => px >= o.b.left && px <= o.b.left + o.b.width &&
                                            py >= o.b.top  && py <= o.b.top  + o.b.height).map(o => o.id);

function sample(rows){
  const keep = R.rows; R.rows = rows;
  const pts = teleReachPoints();
  R.rows = keep;
  return pts;
}
function attribute(pts){
  const rec = [];
  for (let i = 0; i < pts.length; i++){
    const key = moveKeys[i], p = pts[i];
    let best = null, bd = 1e9;
    for (const k in tileXY){
      const d = Math.hypot(tileXY[k].x - p.x, tileXY[k].y - p.y);
      if (d < bd){ bd = d; best = k; }
    }
    rec.push({ key, nearest: best, own: best === key, inSet: PAINT.move.has(best),
               d: +bd.toFixed(1), x: Math.round(p.x), y: Math.round(p.y),
               onBody: inBox(p.x, p.y),
               groundHidden: inBox(tileXY[key].x, tileXY[key].y).filter(id => id !== key) });
  }
  return rec;
}

/* N1 — the control, run FIRST */
const ctl = attribute(sample(0));
const live = attribute(sample(R.rows));

/* ---- the A/B --------------------------------------------------------- */
const RAF = window.requestAnimationFrame;
window.requestAnimationFrame = () => 0;
let _s = 20250915;
const seed = () => { _s = 20250915; const a = () => (_s = (Math.imul(_s,1664525)+1013904223)>>>0) / 4294967296; Math.random = a; };
const now = performance.now();
function shot(boxes){
  seed(); window.frame(now);
  return boxes.map(b => c2.getImageData(b.x, b.y, b.w, b.h).data);
}
function absdiff(a, b){ let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]); return s; }

const PAD = 14;
const wins = live.map(r => ({ x: Math.max(0, Math.round((r.x - PAD) * S)), y: Math.max(0, Math.round((r.y - PAD) * S)),
                              w: Math.round(PAD * 2 * S), h: Math.round(PAD * 2 * S) }));
/* N2b — three DECOY windows the same size, placed on board ground far from
   any caret. A caret-blind measure lights these up; a caret measure does not. */
const decoy = [{x:300,y:600},{x:1250,y:560},{x:420,y:300}].map(p => ({ x:Math.round(p.x*S), y:Math.round(p.y*S), w:Math.round(PAD*2*S), h:Math.round(PAD*2*S) }));
const all = wins.concat(decoy);

/* 20 phases; median, so one unlucky rain streak cannot decide a caret. */
const phases = [];
for (let ph = 0; ph < 20; ph++){
  for (let i = 0; i < 6; i++){ seed(); window.frame(now + ph * 0.0167); }
  const A  = shot(all);                       /* same-state pair: N3 floor */
  const A2 = shot(all);
  R.on = false; const B = shot(all); R.on = true;
  phases.push({ floor: A.map((a,i) => absdiff(a, A2[i])), sig: A.map((a,i) => absdiff(a, B[i])) });
}
window.requestAnimationFrame = RAF;

function med(v){ const s = v.slice().sort((a,b)=>a-b); return s[s.length>>1]; }
const nWin = all.length;
const floorM = [], sigM = [];
for (let i = 0; i < nWin; i++){
  floorM.push(med(phases.map(p => p.floor[i])));
  sigM.push(med(phases.map(p => p.sig[i])));
}
return JSON.stringify({
  order, scale: S, canvas: [el.width, el.height], rows: R.rows, r: R.r,
  nMove: moveKeys.length, nPts: live.length,
  ctlOwn: ctl.filter(r => r.own).length, ctlN: ctl.length,
  live, floorM, sigM, nDecoy: decoy.length,
  units: boxes.map(o => ({ id:o.id, l:Math.round(o.b.left), t:Math.round(o.b.top), w:Math.round(o.b.width), h:Math.round(o.b.height) }))
});
})()`;

const r = spawnSync(process.execPath, [
  SHOT, '.gauntlet/tabletop/_crit-reach-r2.png', '--scene', 'crowd', '--report', REPORT,
], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: fileURLToPath(new URL('../../', import.meta.url)) });

process.stderr.write(r.stderr || '');
let j; try { j = JSON.parse(r.stdout); } catch { console.log(r.stdout.slice(-4000)); process.exit(1); }
const D = JSON.parse(j.boardshot.report);

const nD = D.nDecoy, nC = D.sigM.length - nD;
const sigC = D.sigM.slice(0, nC), sigD = D.sigM.slice(nC);
const floorC = D.floorM.slice(0, nC), floorD = D.floorM.slice(nC);

console.log('--- page identity -------------------------------------------------');
console.log('  canvas', D.canvas.join('x'), ' cssPx->devicePx', D.scale,
            ' REACH_CUE.rows', D.rows, ' r', D.r);
console.log('  frame() draw order read from the live function source:',
            'arc@' + D.order.arc, 'plates@' + D.order.plates, 'pips@' + D.order.pips,
            '=>', (D.order.pips > D.order.plates && D.order.pips > D.order.arc)
                  ? 'PIPS LAST of arc/plates/pips' : '🔴 PIPS NOT LAST');
console.log('  move set', D.nMove, 'tiles,', D.nPts, 'carets');

console.log('\n--- N1  NEGATIVE CONTROL: rows=0 must attribute 36/36 to own tile ---');
console.log('  ' + (D.ctlOwn === D.ctlN ? '✅' : '🔴') + ' own-tile ' + D.ctlOwn + '/' + D.ctlN +
            (D.ctlOwn === D.ctlN ? '  — the nearest-tile arithmetic is sound, so Q1 grades the build'
                                 : '  — Q1 IS MEASURING MY OWN BUG, stop here'));

console.log('\n--- N2/N3  floors -------------------------------------------------');
const mean = v => v.reduce((a,b)=>a+b,0)/v.length;
console.log('  same-state floor  caret windows median ' + Math.round(mean(floorC)) +
            ',  decoy windows median ' + Math.round(mean(floorD)));
console.log('  cue on/off signal caret windows median ' + Math.round(mean(sigC)) +
            ',  decoy windows median ' + Math.round(mean(sigD)) +
            (mean(sigD) < mean(sigC) / 20 ? '   ✅ decoys dark: the measure is caret-specific'
                                          : '   🔴 decoys lit: the measure is not caret-specific'));

console.log('\n--- Q1  ATTRIBUTION — which tile is the caret actually over? -------');
const wrong = D.live.filter(r => !r.own);
const offSet = D.live.filter(r => !r.inSet);
console.log('  carets nearest their OWN tile      : ' + (D.live.length - wrong.length) + '/' + D.live.length);
console.log('  carets nearest SOME OTHER tile     : ' + wrong.length + '/' + D.live.length);
console.log('  carets nearest a tile NOT in the move set (reads as "you may go there" over ground you may not):');
console.log('    ' + offSet.length + '/' + D.live.length +
            (offSet.length ? '  e.g. ' + offSet.slice(0,6).map(r => r.key + '→' + r.nearest).join('  ') : ''));

console.log('\n--- Q2  INK, split by whether the tile GROUND is behind a body ----');
const hid = [], open = [];
D.live.forEach((r,i) => (r.groundHidden.length ? hid : open).push({ r, s: sigC[i], f: floorC[i] }));
const fmt = a => a.length ? 'n=' + a.length + '  median Δ ' + Math.round(med(a.map(o=>o.s))) +
                            '  min ' + Math.round(Math.min(...a.map(o=>o.s))) : 'n=0';
function med(v){ const s = v.slice().sort((a,b)=>a-b); return s[s.length>>1]; }
console.log('  ground BEHIND a body : ' + fmt(hid));
console.log('  ground in open field : ' + fmt(open));
const worst = D.live.map((r,i)=>({r,s:sigC[i]})).sort((a,b)=>a.s-b.s)[0];
console.log('  faintest caret anywhere: tile ' + worst.r.key + ' at (' + worst.r.x + ',' + worst.r.y + ') Δ=' + Math.round(worst.s) +
            '  vs floor ' + Math.round(floorC[D.live.indexOf(worst.r)]));

console.log('\n--- Q3  DOES THE CARET LAND ON A BODY (is it ABOVE sprite height)? -');
const onBody = D.live.filter(r => r.onBody.length);
console.log('  carets whose point falls INSIDE a unit screen box: ' + onBody.length + '/' + D.live.length +
            (onBody.length ? '\n    ' + onBody.slice(0,10).map(r => r.key + ' on ' + r.onBody.join('+')).join('\n    ') : ''));
console.log('  unit boxes: ' + D.units.map(u => u.id + ' ' + u.w + 'x' + u.h + '@' + u.l + ',' + u.t).join('  '));
