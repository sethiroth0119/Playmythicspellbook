/* arena-markings r1 — WHERE did the pitch land, and is it above the noise?
   ══════════════════════════════════════════════════════════════════════════
   🔴 THE CONTROL IS THE POINT. shot.mjs is NOT pixel-deterministic: rain,
   film grain and the sky all resample, and two renders of the SAME state
   differ by 2.43% of the frame. So "the A/B moved 9% of the frame" is not on
   its own evidence that anything was drawn — a previous round quoted 9.26% for
   a band it then called invisible, and both numbers are true at once.
   This script therefore takes THREE images: the off shot, the on shot, and a
   REPEAT of the on shot. It reports, per 6-pixel row band, the on/off signal
   AND the on/on noise measured at the same rows, so every claim is a ratio
   against a control captured under identical conditions.

   usage: node _am-rowsig.mjs <off.png> <on.png> <onRepeat.png> [x0 x1 y0 y1] */
import sharp from 'sharp';
const [OFF, ON, REP] = process.argv.slice(2, 5);
const X0 = +(process.argv[5] ?? 380), X1 = +(process.argv[6] ?? 1300);
const Y0 = +(process.argv[7] ?? 190), Y1 = +(process.argv[8] ?? 620);
async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { d:data, w:info.width, c:info.channels }; }
const a = await raw(OFF), b = await raw(ON), r = await raw(REP);
const W = a.w, C = a.c;
const BAND = 6;
/* per-row counts of "this pixel moved", for the pair under test and the control */
const sig = [], noi = [];
for (let y = Y0; y < Y1; y++){
  let s = 0, n = 0;
  for (let x = X0; x < X1; x++){
    const i = (y*W + x)*C;
    const dAB = Math.abs(a.d[i]-b.d[i]) + Math.abs(a.d[i+1]-b.d[i+1]) + Math.abs(a.d[i+2]-b.d[i+2]);
    const dBR = Math.abs(r.d[i]-b.d[i]) + Math.abs(r.d[i+1]-b.d[i+1]) + Math.abs(r.d[i+2]-b.d[i+2]);
    if (dAB > 12) s++;
    if (dBR > 12) n++;
  }
  sig.push(s); noi.push(n);
}
const px = X1 - X0;
console.log('band region x[' + X0 + ',' + X1 + '] y[' + Y0 + ',' + Y1 + ']  row width ' + px + 'px');
console.log('  y    signal%  noise%   ratio');
const rows = [];
for (let k = 0; k + BAND <= sig.length; k += BAND){
  let s = 0, n = 0;
  for (let j = k; j < k + BAND; j++){ s += sig[j]; n += noi[j]; }
  const sp = 100*s/(BAND*px), np = 100*n/(BAND*px);
  rows.push({ y: Y0 + k, sp, np, ratio: np > 0.05 ? sp/np : (sp > 0.05 ? 99 : 0) });
}
for (const q of rows)
  console.log(String(q.y).padStart(5) + '  ' + q.sp.toFixed(1).padStart(6) + '  ' + q.np.toFixed(1).padStart(6) +
              '   ' + q.ratio.toFixed(1).padStart(5) + '  ' + '#'.repeat(Math.min(60, Math.round(q.sp/1.5))));
/* the three loudest bands, which is where the marks are */
const top = [...rows].sort((p,q) => q.sp - p.sp).slice(0, 6).map(q => 'y=' + q.y + ' ' + q.sp.toFixed(1) + '% (x' + q.ratio.toFixed(1) + ')');
console.log('loudest: ' + top.join('  |  '));
