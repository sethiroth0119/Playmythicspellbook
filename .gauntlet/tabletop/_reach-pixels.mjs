/* ══════════════════════════════════════════════════════════════════════════
   reach-cue — THE PIXEL GATE. Is the cue actually PAINTED, only where it
   should be, and silent when nothing is selected?

   _reach-probe.mjs proves the GEOMETRY: the pip for an occluded tile lands
   above the body hiding it. Geometry alone would pass on a painter that is
   perfectly correct and never called — drawTeleReach defined, reachable,
   computing beautiful coordinates, absent from frame(). That failure renders
   as "the edit did nothing", which is indistinguishable from not having made
   it. So this file works in pixels and asks three separate questions.

   1. IS IT PAINTED?           |on − off| must light up, and must light up AT
                               THE PIPS — the renderer's own projected pip
                               positions, carried out of the ON render by
                               --report rather than recomputed here.
   2. IS THAT SIGNAL REAL?     |off − off₂|, two boots of the SAME state, is
                               the noise floor. Chromium + swiftshader is not
                               bit-identical across boots and the board has
                               live effects, so a raw "N pixels changed" means
                               nothing until it is divided by this. 🔴 THIS IS
                               THE NEGATIVE CONTROL AND IT RUNS FIRST: if a
                               same-state pair shows as much change as the A/B
                               does, the comparison is measuring the renderer's
                               jitter and every number below it is worthless.
   3. IS IT QUIET AT REST?     §12.3.6 — nothing may appear when nothing is
                               selected. Same crowd, paint cleared to empty,
                               cue ON vs cue OFF. That pair must sit at the
                               noise floor, i.e. an unselected board is exactly
                               the board we had before this piece.

   ⚠ The ON/OFF flip is __bbReach.on, NOT a rebuild of the page, so the two
     frames differ in exactly one boolean and nothing else — same map, same
     roster, same paint, same camera, same seed.

   Usage:  node .gauntlet/tabletop/_reach-pixels.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import sharp from 'sharp';

const SHOT = fileURLToPath(new URL('./shot.mjs', import.meta.url));

/* Carried out of whichever render is asked for it: where the renderer thinks
   its own pips are. Recomputing these in Node would let the gate agree with
   itself while disagreeing with the picture. */
const REPORT = "(() => { const R = window.__bbReach; const o = []; " +
  "for (const p of window.teleReachPoints()) o.push([Math.round(p.x), Math.round(p.y), Math.round(p.r)]); " +
  "return JSON.stringify({ on:R.on, rows:R.rows, pips:o, move:window.Board.paint.move.size }); })()";

function render(label, inject){
  const src = fs.readFileSync(SHOT, 'utf8');
  const N1 = "  await w(300);\n  return 'crowd pushed';";
  if (!src.includes(N1)) { console.error('FAIL: crowd eval tail not found — shot.mjs changed'); process.exit(1); }
  let out = src.replace(N1, `  await w(300);\n  ${inject}\n  await w(150);\n  return 'crowd pushed';`);
  if (out === src) { console.error('FAIL: eval injection was a no-op'); process.exit(1); }
  const N2 = "  '--eval', evalJs,\n";
  if (!out.includes(N2)) { console.error('FAIL: boardshot arg list not found'); process.exit(1); }
  const prev = out;
  out = out.replace(N2, N2 + "    '--report', " + JSON.stringify(REPORT) + ",\n");
  if (out === prev) { console.error('FAIL: --report injection was a no-op'); process.exit(1); }
  if (!out.includes(inject)) { console.error('FAIL: injection missing from copy'); process.exit(1); }

  /* beside shot.mjs, never %TEMP%: shot.mjs resolves boardshot relative to its
     OWN url, and a copy in the temp dir silently renders nothing at all. */
  const dst = fileURLToPath(new URL(`./_reach-shot-px-${label}.mjs`, import.meta.url));
  fs.writeFileSync(dst, out);
  const png = fileURLToPath(new URL(`./_reach-px-${label}.png`, import.meta.url));
  const r = spawnSync(process.execPath, [dst, png, '--scene', 'crowd'], { encoding:'utf8', maxBuffer: 1 << 26 });
  let J; try { J = JSON.parse(r.stdout); } catch { console.error(r.stdout.slice(-1200)); console.error('FAIL: no JSON from ' + label); process.exit(1); }
  const rep = J.boardshot && J.boardshot.report;
  /* ⚠ THE PNG IS NOT RELIABLY READABLE THE INSTANT THE CHILD EXITS. spawnSync
     is synchronous, the child printed its JSON, the screenshot succeeded — and
     on Windows the directory entry can still be a beat behind, which surfaced
     here once as sharp throwing "Input file is missing" on a file that was on
     disk by the time anyone looked. Busy-wait briefly rather than either
     sleeping unconditionally (slow, and hides a real failure) or trusting the
     exit code (which is what produced the confusing throw). */
  const t0 = Date.now();
  while (!fs.existsSync(png) && Date.now() - t0 < 4000){ /* spin */ }
  if (!fs.existsSync(png)){
    console.error(r.stderr ? r.stderr.slice(-800) : '');
    console.error('FAIL: ' + label + ' rendered no PNG at ' + png);
    process.exit(1);
  }
  return { png, rep: rep ? JSON.parse(rep) : null };
}

async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { d:data, w:info.width, h:info.height, c:info.channels }; }

/* A pixel counts as CHANGED at 18/255 mean absolute difference. The board has
   rain, embers, a light lerp and pulsing telegraph alphas; a 1-2 level
   threshold counts weather.

   🔴 AND A RAW WHOLE-FRAME COUNT IS NOT USABLE HERE, which cost a run to learn
   and is written down rather than quietly worked around. Two boots of the
   IDENTICAL state differ by ~3,200 px at this threshold: the board animates,
   and swiftshader is not bit-identical across processes. The cue's own signal
   is ~3,600 px, so "changed pixels" reports a ratio of 1.1× and the gate reads
   as a null result for a cue that is plainly visible in the picture. That is
   the same failure the whole pass keeps meeting: a number that answers a
   question one degree away — "did the frame change" instead of "did the frame
   change WHERE THE CUE IS".

   So everything below is a DENSITY: changed pixels per pixel of area, measured
   separately inside the pip mask and outside it. The board's jitter is spread
   over the whole frame and the cue is not, so the two separate by orders of
   magnitude even though their totals are similar. The control pair is run
   through the identical arithmetic, so the floor is measured in the same units
   as the signal instead of being asserted.

   ⚠ AND TWO THRESHOLDS, NOT ONE — for a reason that is physical rather than
   convenient, because "raise the threshold until it passes" is the same sin as
   lowering one.
     SOFT 18  catches anything that moved at all. At this level the CONTROL is
              not flat inside the pip mask: the pips sit over the move region,
              whose wash breathes on sin(t·2.2), and two boots photograph it at
              an arbitrary phase difference. So the soft control is not even
              STABLE — measured at 30.2 per 1000px on one pair and 3.7 on the
              next, which drags the soft signal/control ratio between 5.9× and
              40× on an unchanged build. A gate whose verdict depends on which
              phase of a sine two screenshots caught is not a gate.
     HARD 70  is above anything the wash, the rain or the embers can produce
              between two phases of the same animation, and far below what a
              near-black casing stroke laid over a pale cyan tile produces
              (|Δ| > 100). So the hard count separates the mark from the
              weather instead of separating "changed" from "unchanged".
   Both are printed. The assert is on the hard count; the soft count stays in
   the output so a reader can see what was discarded and why. */
const THRESH = 18;
const HARD   = 70;
async function diff(fa, fb, mask){
  const A = await raw(fa), B = await raw(fb);
  if (A.w !== B.w || A.h !== B.h){ console.error('FAIL: size mismatch'); process.exit(1); }
  let n = 0, inMask = 0, maskArea = 0, nH = 0, inMaskH = 0;
  const N = A.w * A.h;
  for (let p = 0; p < N; p++){
    const m = mask && mask[p];
    if (m) maskArea++;
    const i = p*A.c;
    const d = (Math.abs(A.d[i]-B.d[i]) + Math.abs(A.d[i+1]-B.d[i+1]) + Math.abs(A.d[i+2]-B.d[i+2])) / 3;
    if (d < THRESH) continue;
    n++; if (m) inMask++;
    if (d < HARD) continue;
    nH++; if (m) inMaskH++;
  }
  const outArea = N - maskArea;
  return {
    n, inMask, nH, inMaskH, maskArea, area: N,
    /* changed pixels per 1000 px of area */
    dIn:   maskArea ? +(1000 * inMask  / maskArea).toFixed(1) : null,
    dOut:  outArea  ? +(1000 * (n  - inMask)  / outArea).toFixed(1) : null,
    hIn:   maskArea ? +(1000 * inMaskH / maskArea).toFixed(1) : null,
    hOut:  outArea  ? +(1000 * (nH - inMaskH) / outArea).toFixed(1) : null
  };
}

/* The mask: a small box around each pip the RENDERER reported, padded by the
   pip's own radius plus the casing. If the changed pixels do not land here,
   something is being drawn — but not the pips. */
function pipMask(pips, W, H){
  const m = new Uint8Array(W*H);
  for (const [x, y, r] of pips){
    const pad = r + 4;
    for (let yy = Math.max(0, y-pad); yy <= Math.min(H-1, y+pad); yy++)
      for (let xx = Math.max(0, x-pad); xx <= Math.min(W-1, x+pad); xx++) m[yy*W+xx] = 1;
  }
  return m;
}

/* ORDER: the ON render runs first because it is the one that reports where the
   pips are, and that mask is what BOTH pairs are then measured through. A
   control measured through a different mask is not a control. */
const on = render('on', 'void 0;');
if (!on.rep || !on.rep.pips || !on.rep.pips.length){ console.error('FAIL: the ON render reported no pips'); process.exit(1); }
const meta = await sharp(on.png).metadata();
const mask = pipMask(on.rep.pips, meta.width, meta.height);

console.log('--- 0. NEGATIVE CONTROL: two boots of the SAME state, same mask ---');
const off  = render('off',  'try{window.__bbReach.on=false;}catch(e){}');
const off2 = render('off2', 'try{window.__bbReach.on=false;}catch(e){}');
const floor = await diff(off.png, off2.png, mask);
console.log(`    |off − off2|  soft: AT pips=${floor.dIn}/1000px  elsewhere=${floor.dOut}/1000px   |   hard: AT pips=${floor.hIn}/1000px  elsewhere=${floor.hOut}/1000px`);
console.log(`    (mask = ${floor.maskArea}px, ${(100*floor.maskArea/floor.area).toFixed(2)}% of the frame)`);

console.log('\n--- 1. IS IT PAINTED, AND PAINTED AT THE PIPS? ---');
const sig = await diff(off.png, on.png, mask);
console.log(`    on: rows=${on.rep.rows} moveSet=${on.rep.move} pips=${on.rep.pips.length}`);
console.log(`    |on − off|    soft: AT pips=${sig.dIn}/1000px  elsewhere=${sig.dOut}/1000px   |   hard: AT pips=${sig.hIn}/1000px  elsewhere=${sig.hOut}/1000px`);
console.log(`    at-pip SOFT signal/control = ${(sig.dIn / Math.max(0.1, floor.dIn)).toFixed(1)}x   (the wash breathes here — see the THRESH note)`);
console.log(`    at-pip HARD signal/control = ${(sig.hIn / Math.max(0.1, floor.hIn)).toFixed(1)}x   <- the number the gate asserts on`);
console.log(`    at-pip vs elsewhere, same frame, hard = ${(sig.hIn / Math.max(0.1, sig.hOut)).toFixed(1)}x`);
console.log(`    raw whole-frame totals (${sig.n} vs ${floor.n}) are ~1.1x and say nothing — see the THRESH note.`);

console.log('\n--- 2. §12.3.6 QUIET AT REST: same board, nothing selected ---');
const CLEAR = "window.postMessage({type:'board:paint',move:[],attack:[],place:[],swap:[],sel:null},location.origin); await w(250);";
const rest    = render('rest',    CLEAR + 'void 0;');
const restoff = render('restoff', CLEAR + 'try{window.__bbReach.on=false;}catch(e){}');
console.log(`    rest render reports moveSet=${rest.rep ? rest.rep.move : '?'} (must be 0) pips=${rest.rep ? rest.rep.pips.length : '?'}`);
const quiet = await diff(rest.png, restoff.png, mask);
console.log(`    |rest(on) − rest(off)|  hard: AT pips=${quiet.hIn}/1000px  elsewhere=${quiet.hOut}/1000px  (floor was ${floor.hIn})`);

let fails = 0;
const ok = (m, c, d='') => { if (c) console.log('  ✅ ' + m); else { fails++; console.log('  ❌ ' + m + (d ? '  <-- ' + d : '')); } };

ok('the control is a real floor, not a broken comparison', floor.n > 0 && floor.dIn !== null,
   'two identical boots differed by nothing at all — the diff is not reading the images');
ok('the cue paints something', sig.n > 0);
ok('at-pip HARD change is >= 10x the control at the SAME pixels', sig.hIn >= 10 * Math.max(0.1, floor.hIn),
   `${sig.hIn} vs ${floor.hIn} per 1000px at |delta| >= ${HARD}`);
ok('the cue is concentrated at the pips, not spread over the frame (>= 10x)', sig.hIn >= 10 * Math.max(0.1, sig.hOut),
   `at-pip ${sig.hIn} vs elsewhere ${sig.hOut} per 1000px, hard`);
ok('nothing is selected in the rest render', rest.rep && rest.rep.move === 0,
   'the rest fixture still has a move set — it is not at rest');
ok('§12.3.6 an unselected board is indistinguishable from the control',
   quiet.hIn <= Math.max(2.0, 2 * floor.hIn),
   `${quiet.hIn}/1000px hard at the pip positions with nothing selected, floor ${floor.hIn}`);

console.log(`\n${fails ? '❌' : '✅'} reach-pixels ${fails ? 'FAILED' : 'PASSED'}`);
process.exit(fails ? 1 : 0);
