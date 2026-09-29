/* crop + scale a boardshot, for reading what a region is actually made of.
   Lives in the repo rather than the scratchpad ONLY so that `playwright`
   resolves — ESM resolution is relative to the script, not to cwd.
   usage: node .gauntlet/tabletop/_r9-crop.mjs <in.png> <out.png> x y w h [scale] */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const [inp, outp, X, Y, W, H, S] = process.argv.slice(2);
const sc = +(S || 1);
const b64 = readFileSync(inp).toString('base64');
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage({ viewport: { width: 40, height: 40 } });
const data = await pg.evaluate(async ([b64, x, y, w, h, sc]) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round(w * sc); c.height = Math.round(h * sc);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}, [b64, +X, +Y, +W, +H, sc]);
writeFileSync(outp, Buffer.from(data.split(',')[1], 'base64'));
await br.close();
console.log('wrote ' + outp);
