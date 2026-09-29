/* crop + optional 2x zoom of a boardshot, for reading what a region is made of.
   usage: node r7crop.mjs <in.png> <out.png> x y w h [scale] */
import fs from 'node:fs';
import path from 'node:path';
const PW = process.env.PLAYWRIGHT_PKG || 'playwright';
const [, , inp, outp, X, Y, W, H, S] = process.argv;
const { chromium } = await import(PW);
const b = await chromium.launch();
const p = await b.newPage();
const dataUrl = 'data:image/png;base64,' + fs.readFileSync(inp).toString('base64');
const sc = Number(S || 1);
const r = await p.evaluate(async ({ dataUrl, X, Y, W, H, sc }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = W * sc; c.height = H * sc;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, X, Y, W, H, 0, 0, W * sc, H * sc);
  return { url: c.toDataURL('image/png'), src: img.width + 'x' + img.height };
}, { dataUrl, X: +X, Y: +Y, W: +W, H: +H, sc });
fs.writeFileSync(outp, Buffer.from(r.url.split(',')[1], 'base64'));
console.log('src', r.src, '->', outp, `${W}x${H}@${sc}x`);
await b.close();
