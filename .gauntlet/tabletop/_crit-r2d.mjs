/* pass 4 — the ROUND delta: shipped (day.az 0.95) against the value this round
   replaced (0.28), both rendered from the same fixture, the control from a
   throwaway page copy so the shared tree was never reverted.
   Answers what the az swing cost as well as what it bought. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 40, height: 40 } });
async function load(p) {
  const d = await pg.evaluate(async (s) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode();
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0);
    return { w: c.width, h: c.height, data: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  }, readFileSync(p).toString('base64'));
  return { w: d.w, h: d.h, px: Uint8ClampedArray.from(d.data) };
}
const L = (im, x, y) => { const o = (y * im.w + x) * 4; return 0.2126 * im.px[o] + 0.7152 * im.px[o + 1] + 0.0722 * im.px[o + 2]; };
const box = (im, x, y, w, h) => { let s = 0, n = 0; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { s += L(im, i, j); n++; } return +(s / n).toFixed(2); };
const peak = (im, x, y, w, h) => { let m = 0; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m = Math.max(m, L(im, i, j)); return +m.toFixed(1); };
const A = await load(process.argv[2]);   /* shipped, az 0.95 */
const B = await load(process.argv[3]);   /* control, az 0.28 */
const R = {
  'sky patch where the day sun disc now sits (1000,50,110,80)': { az095: box(A, 1000, 50, 110, 80), az028: box(B, 1000, 50, 110, 80), peak095: peak(A, 1000, 50, 110, 80), peak028: peak(B, 1000, 50, 110, 80) },
  'sky patch where the az-0.28 glow sat (850,30,110,80)':       { az095: box(A, 850, 30, 110, 80),  az028: box(B, 850, 30, 110, 80) },
  'playfield centre (620,260,460,280)':                          { az095: box(A, 620, 260, 460, 280), az028: box(B, 620, 260, 460, 280) },
  'open table LEFT of board (80,400,200,180)':                   { az095: box(A, 80, 400, 200, 180),  az028: box(B, 80, 400, 200, 180) },
  'table in the shadow band (330,430,70,110)':                   { az095: box(A, 330, 430, 70, 110),  az028: box(B, 330, 430, 70, 110) },
  'open table RIGHT of board (1340,400,200,180)':                { az095: box(A, 1340, 400, 200, 180), az028: box(B, 1340, 400, 200, 180) },
  'cliff band (180,40,300,80)':                                  { az095: box(A, 180, 40, 300, 80),  az028: box(B, 180, 40, 300, 80) },
};
console.log(JSON.stringify(R, null, 1));
await br.close();
