/* ══ THE SCANLINE ══════════════════════════════════════════════════════════
   Prints one horizontal row of a capture, pixel by pixel, as RGB + luminance.
   This is the round-9 critic's own instrument made repeatable: it answered
   "the boundary is 1-2 px wide and ~15 units of separation from what it is
   meant to separate" with numbers, and any claim that a lot line is visible
   has to be answered the same way. A picture at 4x is not evidence.

   Usage:  node .gauntlet/lumscan.mjs <file.png> <y> <x0> <x1>
   ══════════════════════════════════════════════════════════════════════════ */
import sharp from 'sharp';
const [file, ys, x0s, x1s] = process.argv.slice(2);
if (!file || ys == null) { console.log('usage: node .gauntlet/lumscan.mjs <file.png> <y> <x0> <x1>'); process.exit(1); }
const y = +ys, x0 = +x0s, x1 = +x1s;
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width, C = info.channels;
const lum = (r, g, b) => +(.299 * r + .587 * g + .114 * b).toFixed(1);
const row = [];
for (let x = x0; x <= x1; x++) {
  const i = (y * W + x) * C;
  row.push(`${x}:(${data[i]},${data[i + 1]},${data[i + 2]})L${lum(data[i], data[i + 1], data[i + 2])}`);
}
console.log(`${file}  y=${y}`);
console.log(row.join('  '));
