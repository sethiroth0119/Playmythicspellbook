/* procedural-ruins — mean RGB/luma over a box in two shots, so the A/B is a
   number. The BOARD box is the control: same fixture, same seed, same camera,
   and this piece touches nothing inside the playfield, so it must barely move.
   A vista box that moves while the control also moves would mean the fixture
   re-rolled, not that the edit did anything.
   usage: node _pr-box.mjs <a.png> <b.png> name,x,y,w,h [name,x,y,w,h ...] */
import sharp from 'sharp';

async function box(f, x, y, w, h) {
  const { data, info } = await sharp(f).extract({ left: x, top: y, width: w, height: h })
    .raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let R = 0, G = 0, B = 0, n = info.width * info.height;
  for (let i = 0; i < n; i++) { R += data[i * ch]; G += data[i * ch + 1]; B += data[i * ch + 2]; }
  R /= n; G /= n; B /= n;
  return { R, G, B, L: 0.299 * R + 0.587 * G + 0.114 * B, RmB: R - B };
}

const [A, B, ...boxes] = process.argv.slice(2);
for (const spec of boxes) {
  const [name, x, y, w, h] = spec.split(',');
  const a = await box(A, +x, +y, +w, +h);
  const b = await box(B, +x, +y, +w, +h);
  const f = v => v.toFixed(1).padStart(6);
  console.log(name.padEnd(16),
    'A L' + f(a.L) + ' R-B' + f(a.RmB) + '  |  B L' + f(b.L) + ' R-B' + f(b.RmB) +
    '  |  ΔL' + f(b.L - a.L) + ' ΔR-B' + f(b.RmB - a.RmB));
}
