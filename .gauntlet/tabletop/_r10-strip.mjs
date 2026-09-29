/* WHERE, ALONG ONE SCANLINE, THE SHADOW ACTUALLY IS.
   usage: node .gauntlet/tabletop/_r10-strip.mjs <on.png> <off.png> <y> [<y> …]

   The acceptance box (60,240,300,300) is a 300x300 mean, so it answers "how
   much of this box is in shade" and CANNOT distinguish "no shadow anywhere"
   from "a deep shadow across a quarter of it". Both were live hypotheses after
   round 2's first capture, and they call for opposite fixes. This prints the
   raw profile — off-minus-on delta and the off arm's own luma, averaged over a
   5-row band to kill the rain — every 10 px across the frame, so the shadow's
   left and right edges and the board's own edge are all readable as numbers. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [ON, OFF, ...YS] = process.argv.slice(2);
const b64 = f => readFileSync(f).toString('base64');
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage({ viewport: { width: 40, height: 40 } });
const out = await pg.evaluate(async ([A, B, ys]) => {
  const load = async s => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); return i; };
  const ia = await load(A), ib = await load(B);
  const W = ia.width, H = ia.height;
  const mk = im => { const c = document.createElement('canvas'); c.width = W; c.height = H;
                     const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
                     return g.getImageData(0, 0, W, H).data; };
  const A4 = mk(ia), B4 = mk(ib);
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const res = {};
  for (const y of ys) {
    const row = [];
    for (let x = 0; x < W; x += 10) {
      let d = 0, lo = 0, n = 0;
      for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x; xx < Math.min(W, x + 10); xx++) {
        const i = (yy * W + xx) * 4; d += L(B4, i) - L(A4, i); lo += L(B4, i); n++;
      }
      row.push([x, +(d / n).toFixed(1), +(lo / n).toFixed(1)]);
    }
    res['y' + y] = row;
  }
  return res;
}, [b64(ON), b64(OFF), YS.map(Number)]);
for (const [k, row] of Object.entries(out)) {
  console.log('== ' + k + '  (x : offMinusOn : offLuma)');
  console.log(row.map(r => r[0] + ':' + r[1] + '/' + r[2]).join('  '));
}
await br.close();
