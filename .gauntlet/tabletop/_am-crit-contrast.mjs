/* arena-markings CRITIC round 1 — the COST side of the ledger.
   §7 wants the markings; §1.4 lists "everything is washed out … one narrow
   value band" as the defect this whole pass exists to delete, and a flat alpha
   wash laid over two rows is the cheapest way to re-create it from a new
   direction. So the question is not "did the wash appear" (it did, 12x-300x the
   control) but "what did it do to the LOCAL CONTRAST of the ground under it".
   Standard deviation of luma inside each band, ON against OFF, with the same
   ON/ON control as everything else.
   usage: node _am-crit-contrast.mjs <off.png> <on.png> <rep.png> */
import sharp from 'sharp';
const [OFF, ON, REP] = process.argv.slice(2);
async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { d:data, w:info.width, h:info.height, c:info.channels }; }
const ims = { off: await raw(OFF), on: await raw(ON), rep: await raw(REP) };
const X0 = 470, X1 = 1290;
const BANDS = {
  'far zone   rows 0-1 ': [212, 258],
  'far open   rows 2-3 ': [262, 310],
  'mid        rows 5-6 ': [320, 372],
  'near open  rows 8-9 ': [420, 478],
  'near zone  rows10-11': [486, 580],
};
function stat(im, y0, y1){
  let s = 0, s2 = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = X0; x < X1; x += 2){
    const i = (y*im.w + x)*im.c;
    const L = 0.2126*im.d[i] + 0.7152*im.d[i+1] + 0.0722*im.d[i+2];
    s += L; s2 += L*L; n++;
  }
  const m = s/n;
  return { m, sd: Math.sqrt(s2/n - m*m) };
}
console.log('band                   luma OFF  luma ON   dL   |  sd OFF  sd ON    dsd   | control dsd');
for (const [k,[y0,y1]] of Object.entries(BANDS)){
  const a = stat(ims.off,y0,y1), b = stat(ims.on,y0,y1), r = stat(ims.rep,y0,y1);
  console.log(k,
    a.m.toFixed(1).padStart(8), b.m.toFixed(1).padStart(8), (b.m-a.m).toFixed(1).padStart(6), ' |',
    a.sd.toFixed(1).padStart(6), b.sd.toFixed(1).padStart(6), (b.sd-a.sd).toFixed(1).padStart(7),
    ' (' + ((b.sd-a.sd)/a.sd*100).toFixed(1) + '%) |',
    (b.sd-r.sd).toFixed(2).padStart(7));
}
