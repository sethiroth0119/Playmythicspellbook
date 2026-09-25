/* arena-markings CRITIC round 1 — measure the A/B, then measure the thing the
   A/B cannot answer.

   TWO DIFFERENT QUESTIONS, AND ONLY ONE OF THEM IS §7's.
   (a) "did the paint reach the frame?" — an OFF/ON difference answers this, and
       it must be a RATIO against a same-state control because shot.mjs
       resamples rain, grain and sky on every run.
   (b) "can a player see whose half is whose AT A GLANCE?" — a player never sees
       the OFF frame. This is a property of the ON frame ALONE: the far zone and
       the near zone must be separated by more than the board's own row-to-row
       variation. Measuring (a) and reporting it as (b) is the one-degree-off
       failure this pass keeps re-learning, so both are computed here and
       printed side by side.

   usage: node _am-crit-measure.mjs <off.png> <on.png> <rep.png> */
import sharp from 'sharp';
const [OFF, ON, REP] = process.argv.slice(2);
async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { d:data, w:info.width, h:info.height, c:info.channels }; }
const a = await raw(OFF), b = await raw(ON), r = await raw(REP);
const { w:W, h:H, c:C } = a;
const at = (im, x, y) => { const i = (y*im.w + x)*im.c; return [im.d[i], im.d[i+1], im.d[i+2]]; };

/* the board's bounding box in the fixture frame, hand-read off the render and
   kept deliberately INSIDE the stone frame so the rim and the table never enter
   any mean. */
const X0 = 470, X1 = 1290, Y0 = 205, Y1 = 590;

/* ── (a) per-scanline OFF/ON signal vs the ON/ON control ─────────────────── */
console.log('=== per-scanline signal (board columns ' + X0 + '-' + X1 + ') ===');
console.log('   y   sigAB%  ctlBR%   ratio');
const rows = [];
for (let y = Y0; y < Y1; y += 3){
  let nAB = 0, nBR = 0, n = 0;
  for (let x = X0; x < X1; x += 2){
    const [ar,ag,ab] = at(a,x,y), [br,bg,bb] = at(b,x,y), [rr,rg,rb] = at(r,x,y);
    const dAB = (Math.abs(ar-br)+Math.abs(ag-bg)+Math.abs(ab-bb))/3;
    const dBR = (Math.abs(rr-br)+Math.abs(rg-bg)+Math.abs(rb-bb))/3;
    if (dAB > 6) nAB++;
    if (dBR > 6) nBR++;
    n++;
  }
  rows.push({ y, sig: nAB/n*100, ctl: nBR/n*100 });
}
for (const q of rows)
  console.log(String(q.y).padStart(5), q.sig.toFixed(1).padStart(6), q.ctl.toFixed(1).padStart(7),
              '  ' + (q.ctl > 0.2 ? (q.sig/q.ctl).toFixed(1) : '∞') + (q.sig > 20 ? '  ###' : ''));

/* ── (b) the ON frame on its own: is one end warmer than the other? ─────── */
function meanOf(im, y0, y1){
  let R=0,G=0,B=0,n=0;
  for (let y=y0; y<y1; y++) for (let x=X0; x<X1; x+=2){ const [p,q,s]=at(im,x,y); R+=p;G+=q;B+=s;n++; }
  return { R:R/n, G:G/n, B:B/n, warm:(R-B)/n };
}
const BANDS = {
  'far zone   (rows 0-1)': [212, 258],
  'far open   (rows 2-3)': [262, 310],
  'mid        (rows 5-6)': [320, 372],
  'near open  (rows 8-9)': [420, 478],
  'near zone  (rows10-11)': [486, 580],
};
console.log('\n=== (b) the ON frame alone — warmth (R-B) per band ===');
console.log('band                      OFF R   OFF B  OFFwarm |   ON R    ON B   ONwarm |  d(warm)');
const res = {};
for (const [k,[y0,y1]] of Object.entries(BANDS)){
  const ma = meanOf(a,y0,y1), mb = meanOf(b,y0,y1);
  res[k] = { off:ma, on:mb };
  console.log(k.padEnd(24),
    ma.R.toFixed(1).padStart(6), ma.B.toFixed(1).padStart(7), ma.warm.toFixed(1).padStart(8), ' |',
    mb.R.toFixed(1).padStart(6), mb.B.toFixed(1).padStart(7), mb.warm.toFixed(1).padStart(8), ' |',
    (mb.warm-ma.warm).toFixed(2).padStart(8));
}
/* the control: the same band measured on two identical ON renders. Anything the
   markings do must beat this or it is the renderer breathing. */
console.log('\n=== control: ON vs ON-repeat, same bands ===');
for (const [k,[y0,y1]] of Object.entries(BANDS)){
  const mb = meanOf(b,y0,y1), mr = meanOf(r,y0,y1);
  console.log(k.padEnd(24), 'd(warm) =', (mb.warm-mr.warm).toFixed(2).padStart(7),
              '   d(R) =', (mb.R-mr.R).toFixed(2).padStart(6));
}
const fz = res['far zone   (rows 0-1)'], nz = res['near zone  (rows10-11)'];
console.log('\n=== §7 "whose half is whose at a glance", ON FRAME ONLY ===');
console.log('far zone warmth  ' + fz.on.warm.toFixed(1) + '   near zone warmth ' + nz.on.warm.toFixed(1) +
            '   SEPARATION ' + (nz.on.warm - fz.on.warm).toFixed(1));
console.log('the same separation with the markings OFF: ' + (nz.off.warm - fz.off.warm).toFixed(1));
console.log('so the markings contribute ' +
            ((nz.on.warm-fz.on.warm) - (nz.off.warm-fz.off.warm)).toFixed(1) +
            ' of it; the rest is the board/lighting and would be there anyway.');
