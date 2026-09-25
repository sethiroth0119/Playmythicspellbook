/* 📏 CRIT-WASH — did the frame pass LIGHTEN a screen it was only meant to
   texture? Mean RGB of the same patches in two shots of the same screen.

   The Crash Exchange carries an animated light sweep across the page, so a
   naked A/B of two screenshots reports whatever phase the sweep was in and
   not what the CSS did. These patches are chosen away from the sweep's track
   and the answer is a number: mean channel per patch, before vs after.

   Usage: node .gauntlet/_crit-wash.mjs before.png after.png                    */
import sharp from 'sharp';
const [A, B] = process.argv.slice(2);
const PATCHES = [
  ['page ground, top-left', 8, 150, 60, 40],
  ['left rail panel',      120, 640, 180, 60],
  ['centre panel ground',  420, 700, 120, 40],
  ['right rail ground',   1140, 300, 120, 40],
  ['order-book area',      640, 780, 120, 40],
];
const load = async (p) => { const r = await sharp(p).raw().toBuffer({ resolveWithObject: true }); return r; };
const a = await load(A), b = await load(B);
const mean = (img, x0, y0, w, h) => {
  const { width, channels, data } = img.info ? { ...img.info, data: img.data } : img;
  let r = 0, g = 0, bl = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * width + x) * channels; r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++;
  }
  return [r / n, g / n, bl / n];
};
console.log('\n  patch                    before RGB        after RGB         Δlum');
for (const [name, x, y, w, h] of PATCHES) {
  const m1 = mean(a, x, y, w, h), m2 = mean(b, x, y, w, h);
  const lum = (m) => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  const d = lum(m2) - lum(m1);
  const f = (m) => m.map(v => String(Math.round(v)).padStart(3)).join(',');
  console.log('  ' + name.padEnd(24) + f(m1) + '     ' + f(m2) + '     ' +
    (d >= 0 ? '+' : '') + d.toFixed(1) + (Math.abs(d) > 6 ? '   ⚠' : ''));
}
