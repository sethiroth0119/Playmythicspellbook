/* mean rgb + Rec.601 luma of one or more boxes of a PNG.
   usage: node .gauntlet/tabletop/_r9-sample.mjs <png> "name:x,y,w,h" ... */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [PNG, ...boxes] = process.argv.slice(2);
const b64 = readFileSync(PNG).toString('base64');
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage({ viewport: { width: 40, height: 40 } });
const out = await pg.evaluate(async ([s, boxes]) => {
  const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode();
  const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  return boxes.map(spec => {
    const [name, rect] = spec.split(':');
    const [x0, y0, w, h] = rect.split(',').map(Number);
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const k = (y * c.width + x) * 4; r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++;
    }
    r /= n; gg /= n; b /= n;
    return { name, rgb: [r, gg, b].map(v => +v.toFixed(1)),
             L: +(0.299 * r + 0.587 * gg + 0.114 * b).toFixed(1) };
  });
}, [b64, boxes]);
console.log(JSON.stringify(out));
await br.close();
