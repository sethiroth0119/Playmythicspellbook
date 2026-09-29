/* critic r2 — WHAT ARE THE TWO PALE PLATES AT y~200?
   Finds, per row, the x of the strongest horizontal luma step in the left
   gutter (x 60..560) and in the right gutter (x 1040..1560), ignoring the
   board. A PROJECTED GROUND QUAD's near-vertical side edge walks outward
   linearly with y; a painted scenery plate has a vertical edge that does not.
   usage: node _crit2-edge.mjs <png> y0 y1 step
   NEGATIVE CONTROL: rows well above the horizon (pure sky) must report a weak
   step (|d| small) and a wandering x — if they report a crisp walking edge the
   detector is finding noise, not geometry. */
import sharp from 'sharp';
const [IN, a, b, s] = process.argv.slice(2);
const { data, info } = await sharp(IN).raw().toBuffer({ resolveWithObject: true });
const { width: W, channels: ch } = info;
const L = (x, y) => { const i = (y * W + x) * ch; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
/* 5px box either side of x, so single-pixel rain streaks do not win */
function step(x, y) {
  let l = 0, r = 0;
  for (let k = 1; k <= 5; k++) { l += L(x - k, y); r += L(x + k, y); }
  return (r - l) / 5;
}
function best(y, x0, x1, sign) {
  let bx = -1, bv = 0;
  for (let x = x0; x < x1; x++) { const d = step(x, y) * sign; if (d > bv) { bv = d; bx = x; } }
  return [bx, bv];
}
console.log('row    leftEdgeX  step     rightEdgeX  step');
for (let y = +a; y <= +b; y += +(s || 10)) {
  const [lx, lv] = best(y, 60, 560, +1);     /* dark -> pale going right */
  const [rx, rv] = best(y, 1040, 1560, -1);  /* pale -> dark going right */
  console.log(String(y).padStart(4), String(lx).padStart(10), lv.toFixed(1).padStart(7),
    String(rx).padStart(12), rv.toFixed(1).padStart(7));
}
