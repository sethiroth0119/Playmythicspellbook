/* critic r2 — the OUTER edge of the pale far-ground wedge, left and right.
   Same detector as _crit2-edge.mjs but windowed OUTSIDE the board's stone
   frame (left 40..330, right 1380..1580) so the frame's own rim cannot win.
   usage: node _crit2-edge2.mjs <png> y0 y1 step */
import sharp from 'sharp';
const [IN, a, b, s] = process.argv.slice(2);
const { data, info } = await sharp(IN).raw().toBuffer({ resolveWithObject: true });
const { width: W, channels: ch } = info;
const L = (x, y) => { const i = (y * W + x) * ch; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
function step(x, y) { let l = 0, r = 0; for (let k = 1; k <= 5; k++) { l += L(x - k, y); r += L(x + k, y); } return (r - l) / 5; }
function best(y, x0, x1, sign) { let bx = -1, bv = 0; for (let x = x0; x < x1; x++) { const d = step(x, y) * sign; if (d > bv) { bv = d; bx = x; } } return [bx, bv]; }
console.log('row    leftEdgeX  step     rightEdgeX  step');
for (let y = +a; y <= +b; y += +(s || 10)) {
  const [lx, lv] = best(y, 40, 330, +1);
  const [rx, rv] = best(y, 1380, 1580, -1);
  console.log(String(y).padStart(4), String(lx).padStart(10), lv.toFixed(1).padStart(7), String(rx).padStart(12), rv.toFixed(1).padStart(7));
}
