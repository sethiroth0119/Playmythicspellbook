/* THE HAZARD THE BUILDER'S GATES CANNOT SEE, because the fixture posts a map
   and no units: STAGE_POOL_HEAD is 0.25 WORLD UNITS of headroom above the
   tallest tile, and the elevation ladder's own rung is 0.34 (_BB_ELEV). So
   the pool's ceiling sits LESS THAN ONE RUNG above the top of the board. §3.4
   explicitly allows a tile's effects to "rise ABOVE it", and a unit sprite
   certainly does. Anything that rises past that ceiling leaves the pool and is
   darkened by up to 0.56 — at its TOP, which is the half a player reads.

   There is one thing in the mixed fixture that already rises above the board:
   the bare tree standing off the far-right corner at ~(1105,150-195). Measure
   its head armed vs ablated. A/A is measured in the same pass because the tree
   is thin against a dark sky and the rain animates across it, so the noise
   floor is not zero and a raw delta would over-read. */
import sharp from 'file:///E:/game-deploy/node_modules/sharp/lib/index.js';
const W = 1600;
const load = async p => (await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const [armed, abl, aa] = process.argv.slice(2);
const A = await load(armed), B = await load(abl), C = await load(aa);
/* bands up the tree, from its crown down to where it meets the board's frame */
const boxes = {
  'crown  y138-158': [1085, 138, 1145, 158],
  'mid    y158-176': [1085, 158, 1145, 176],
  'trunk  y176-193': [1090, 176, 1130, 193],
  'sky ref (no tree) y138-193': [900, 138, 1000, 193],
};
const band = (D, [x0, y0, x1, y1]) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum(D, (y * W + x) * 4); n++; } return s / n; };
console.log('band'.padEnd(20) + 'armed'.padStart(8) + 'ablated'.padStart(9) + 'dL'.padStart(7) + '   A/A noise');
for (const k in boxes) {
  const a = band(A, boxes[k]), b = band(B, boxes[k]), c = band(C, boxes[k]);
  console.log(k.padEnd(20) + a.toFixed(1).padStart(8) + b.toFixed(1).padStart(9) + (a - b).toFixed(1).padStart(7) + '   ' + (a - c).toFixed(1));
}
