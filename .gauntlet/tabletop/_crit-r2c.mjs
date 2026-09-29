/* pass 3 — what the shadow COSTS. §5.1 wants the board's own base to show a
   lit top face and distinct darker flanks; §3.1 wants a tile outline traceable
   without guessing. The band the shadow lays over the skirt ring is where both
   are spent. Reports luma mean / min / max / stddev inside matched boxes on the
   skirt ring and on open table, on vs off.
   NEGATIVE CONTROL: --selftest asserts a synthetic FLAT box reads stddev 0 and
   a synthetic checker reads a stddev near its known amplitude. */
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
function stats(im, x, y, w, h) {
  const v = []; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) v.push(L(im, i, j));
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length);
  return { mean: +m.toFixed(1), min: +Math.min(...v).toFixed(1), max: +Math.max(...v).toFixed(1), sd: +sd.toFixed(2) };
}
if (process.argv[2] === '--selftest') {
  const im = { w: 100, h: 100, px: new Uint8ClampedArray(100 * 100 * 4) };
  for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) { const o = (j * 100 + i) * 4; const v = 128; im.px[o] = im.px[o + 1] = im.px[o + 2] = v; im.px[o + 3] = 255; }
  const flat = stats(im, 10, 10, 40, 40);
  for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) { const o = (j * 100 + i) * 4; const v = ((i >> 2) + (j >> 2)) & 1 ? 148 : 108; im.px[o] = im.px[o + 1] = im.px[o + 2] = v; }
  const chk = stats(im, 10, 10, 40, 40);
  console.log(JSON.stringify({ flat, checker: chk }));
  console.log('SELFTEST PASS:', flat.sd === 0 && Math.abs(chk.sd - 20) < 0.5);
  await br.close(); process.exit(0);
}
const ON = await load(process.argv[2]), OFF = await load(process.argv[3]);
const BOXES = {
  'skirt ring, left flank  (352,412,84,104)': [352, 412, 84, 104],
  'skirt ring, left flank  (300,500,90,90)': [300, 500, 90, 90],
  'open table, left        (120,420,140,120)': [120, 420, 140, 120],
  'kerb stone, left        (430,430,30,60)': [430, 430, 30, 60],
  'skirt ring, RIGHT flank (1210,400,84,104)': [1210, 400, 84, 104],
};
const r = {};
for (const k in BOXES) { const b = BOXES[k]; r[k] = { on: stats(ON, ...b), off: stats(OFF, ...b) }; }
console.log(JSON.stringify(r, null, 1));
await br.close();
