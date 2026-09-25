/* analyse the four _ab-*.png arms written by _probe-shadow-ab.mjs.
   ⚠ THE SCENE HAS ANIMATED RAIN AND ANIMATED BRAZIER FLAME, so a raw
   "pixels that differ" count is contaminated: two screenshots of the SAME arm
   already differ. So this reports DARKENED and BRIGHTENED separately — a real
   cast shadow is one-sided, animation is not — and writes a visualisation. */
import sharp from 'sharp';

const D = 'E:/game-deploy/.gauntlet/tabletop/';
async function raw(f) { const { data, info } = await sharp(D + f).raw().toBuffer({ resolveWithObject: true }); return { data, info }; }
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

async function diff(onF, offF, tag) {
  const A = await raw(onF), B = await raw(offF);
  const { width: W, height: H, channels: C } = A.info;
  let dark = 0, bright = 0, sumDark = 0, sx = 0, sy = 0;
  let dark8 = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const vis = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C, j = (y * W + x) * 3;
    const d = lum(B.data, i) - lum(A.data, i);      /* off − on: + = the shadow darkened it */
    if (d > 2) { dark++; sumDark += d; sx += x * d; sy += y * d; }
    if (d < -2) bright++;
    if (d > 8) {
      dark8++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const v = Math.max(0, Math.min(255, Math.round(d * 12)));
    vis[j] = v; vis[j + 1] = v; vis[j + 2] = Math.max(0, Math.min(255, Math.round(-d * 12)));
  }
  await sharp(vis, { raw: { width: W, height: H, channels: 3 } }).png().toFile(D + '_ab-vis-' + tag + '.png');
  return {
    tag,
    darkenedPx: dark, brightenedPx: bright,
    oneSidedRatio: +(dark / Math.max(1, bright)).toFixed(2),
    meanDarkening: +(sumDark / Math.max(1, dark)).toFixed(2),
    strongPx_gt8: dark8,
    strongBBox: dark8 ? [minX, minY, maxX, maxY] : null,
    weightedCentroid: dark ? [Math.round(sx / sumDark), Math.round(sy / sumDark)] : null,
  };
}
console.log(JSON.stringify({
  day: await diff('_ab-on-day.png', '_ab-off-day.png', 'day'),
  dusk: await diff('_ab-on-dusk.png', '_ab-off-dusk.png', 'dusk'),
  /* the A/A control: two DIFFERENT arms that should be identical apart from
     animation. day-on vs dusk-on is not that, so the honest control here is
     the brightened count inside each arm above. */
}, null, 1));
