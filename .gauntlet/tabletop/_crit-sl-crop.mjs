/* Two crops I need to OPEN rather than tabulate.
   (1) the left table, armed over ablated, so Ask I ("there is a table under
       it", §2) can be judged on whether the plane still reads as a SURFACE
       after the falloff, not just on its median.
   (2) the far-left corner at 3x, brightness-normalised, which is the one place
       the pool is at full alpha and therefore the one place a "dark table" can
       have quietly become a void. Normalising is the point: if the detail is
       still THERE, a gain will reveal it; if the pool crushed it to flat, no
       gain can. */
import sharp from 'file:///E:/game-deploy/node_modules/sharp/lib/index.js';
const [fa, fb, out] = process.argv.slice(2);
const R = { left: 0, top: 150, width: 470, height: 460 };
const a = sharp(fa).extract(R), b = sharp(fb).extract(R);
await sharp({ create: { width: 470, height: 930, channels: 3, background: '#000' } })
  .composite([{ input: await a.png().toBuffer(), top: 0, left: 0 },
              { input: await b.png().toBuffer(), top: 470, left: 0 }])
  .png().toFile(out);

/* far corner, 3x, +150% gain */
const C = { left: 20, top: 200, width: 240, height: 200 };
await sharp(fa).extract(C).resize(720, 600, { kernel: 'nearest' }).linear(2.5, 0).png().toFile(out.replace('.png', '-corner-armed.png'));
await sharp(fb).extract(C).resize(720, 600, { kernel: 'nearest' }).linear(2.5, 0).png().toFile(out.replace('.png', '-corner-abl.png'));

/* and the numbers that decide whether a gain is even meaningful: the LOCAL
   standard deviation inside that corner box. Detail that survives a value cut
   keeps its relative texture; detail that was crushed does not. */
const load = async p => (await sharp(p).extract(C).raw().toBuffer({ resolveWithObject: true }));
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
for (const [k, f] of [['armed', fa], ['ablated', fb]]) {
  const { data, info } = await load(f);
  const n = info.width * info.height, ch = info.channels;
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const L = lum(data, i * ch); s += L; s2 += L * L; }
  const m = s / n, sd = Math.sqrt(s2 / n - m * m);
  console.log(k.padEnd(8) + ' corner mean L ' + m.toFixed(1) + '   sd ' + sd.toFixed(2) + '   sd/mean ' + (sd / m).toFixed(3));
}
