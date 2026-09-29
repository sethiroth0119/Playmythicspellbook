/* Crop + upscale a region of a PNG with no image library: decode via the same
   headless Chromium the rig already depends on. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const [src, out, X, Y, W, H, S] = process.argv.slice(2);
const x = +X, y = +Y, w = +W, h = +H, s = +(S || 3);
const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: Math.round(w * s), height: Math.round(h * s) } });
await page.setContent('<style>html,body{margin:0}canvas{display:block}</style><canvas id=c></canvas>');
await page.evaluate(async ([b64, x, y, w, h, s]) => {
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
  const c = document.getElementById('c');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
}, [b64, x, y, w, h, s]);
await page.locator('#c').screenshot({ path: out });
await browser.close();
console.log('wrote', out);
