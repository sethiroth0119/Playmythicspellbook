/* procedural-ruins — per-row mean RGB in a column strip, to find hard seams by
   NUMBER rather than by eye. usage: node _pr-rows.mjs <png> x w y0 y1 */
import sharp from 'sharp';
const [IN, xs, ws, y0s, y1s] = process.argv.slice(2);
const x = +xs, w = +ws, y0 = +y0s, y1 = +y1s;
const { data, info } = await sharp(IN).extract({ left: x, top: y0, width: w, height: y1 - y0 })
  .raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
let prev = null;
for (let r = 0; r < info.height; r++) {
  let R = 0, G = 0, B = 0;
  for (let c = 0; c < info.width; c++) {
    const i = (r * info.width + c) * ch;
    R += data[i]; G += data[i + 1]; B += data[i + 2];
  }
  R /= info.width; G /= info.width; B /= info.width;
  const L = 0.299 * R + 0.587 * G + 0.114 * B;
  const d = prev == null ? 0 : L - prev;
  prev = L;
  console.log(String(y0 + r).padStart(4), 'rgb(' + R.toFixed(0) + ',' + G.toFixed(0) + ',' + B.toFixed(0) + ')',
    'L', L.toFixed(1), 'dL', d.toFixed(2), Math.abs(d) > 2 ? '   <<< STEP' : '');
}
