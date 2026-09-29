/* critic r2 — crop + optional upscale, so a band can be LOOKED at.
   usage: node _crit2-crop.mjs <in.png> <out.png> x y w h [scale] */
import sharp from 'sharp';
const [IN, OUT, x, y, w, h, s] = process.argv.slice(2);
const sc = +(s || 1);
let p = sharp(IN).extract({ left: +x, top: +y, width: +w, height: +h });
if (sc !== 1) p = p.resize({ width: Math.round(+w * sc), kernel: 'nearest' });
await p.png().toFile(OUT);
console.log('wrote', OUT, +w * sc, 'x', Math.round(+h * sc));
