/* arena-markings r1 — does §7's "whose half is whose AT A GLANCE" reach pixels?
   ══════════════════════════════════════════════════════════════════════════
   The marks are mirrored GEOMETRY, and a mirror is identical on both sides —
   so the only thing in the plan that can answer "which half is MINE" is the
   pair of opposite colour temperatures MARKS.farHue / MARKS.nearHue. A row
   histogram cannot see that: a blue wash and an orange wash of equal strength
   produce the SAME "this moved" percentage, which is the "one degree from the
   question that mattered" failure this pass keeps re-learning. So measure the
   SIGNED colour shift the paint applied, per half.

   Method: over each half's zone rows, take every pixel the on/off pair moved,
   and average (on - off) per channel. A far half that got bluer reads as
   dB - dR > 0; a near half that got warmer reads as dR - dB > 0.
   🔴 CONTROL: the identical statistic over the on/on repeat pair, same pixels.
   The renderer's own jitter is achromatic-ish rain and grain, so the control
   must come out near zero on BOTH halves. If the control shows a tilt of the
   same size as the signal, this measurement proves nothing and says so.
   usage: node _am-identity.mjs <off.png> <on.png> <onRepeat.png> */
import sharp from 'sharp';
const [OFF, ON, REP] = process.argv.slice(2, 5);
async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { d:data, w:info.width, h:info.height, c:info.channels }; }
const a = await raw(OFF), b = await raw(ON), r = await raw(REP);
const { w:W, c:C } = a;
/* the two deployment zones, as screen bands. Bounds come from the diff image's
   own bright rows, not from a guess: far wash y 205..262, near wash y 484..578. */
const HALVES = [
  { name:'FAR  (rows 0-1)', x0:430, x1:1270, y0:205, y1:262 },
  { name:'NEAR (rows 10-11)', x0:400, x1:1300, y0:484, y1:578 },
];
const stat = (H, P, Q) => {           /* mean (Q - P) over pixels P/Q disagree on */
  let n = 0, dr = 0, dg = 0, db = 0;
  for (let y = H.y0; y < H.y1; y++) for (let x = H.x0; x < H.x1; x++){
    const i = (y*W + x)*C;
    const d = Math.abs(P.d[i]-Q.d[i]) + Math.abs(P.d[i+1]-Q.d[i+1]) + Math.abs(P.d[i+2]-Q.d[i+2]);
    if (d <= 12) continue;
    n++; dr += Q.d[i]-P.d[i]; dg += Q.d[i+1]-P.d[i+1]; db += Q.d[i+2]-P.d[i+2];
  }
  return n ? { n, dr:dr/n, dg:dg/n, db:db/n, warm:(dr-db)/n } : { n:0, dr:0, dg:0, db:0, warm:0 };
};
console.log('mean per-channel shift over the pixels that moved');
console.log('  half                 n       dR     dG     dB    warmth(dR-dB)');
for (const H of HALVES){
  const s = stat(H, a, b), c = stat(H, b, r);
  const f = q => q.toFixed(2).padStart(6);
  console.log('  ' + H.name.padEnd(18) + String(s.n).padStart(6) + ' ' + f(s.dr) + ' ' + f(s.dg) + ' ' + f(s.db) + '   ' + f(s.warm) + '   <- SIGNAL');
  console.log('  ' + ''.padEnd(18) + String(c.n).padStart(6) + ' ' + f(c.dr) + ' ' + f(c.dg) + ' ' + f(c.db) + '   ' + f(c.warm) + '   <- control (on vs on)');
}
