/* critic round-2, pass 2 — the two acceptance clauses re-measured independently,
   plus the question the builder's box could not answer: of the BARE TABLE a
   player can actually see, how much carries the shadow.
   NEGATIVE CONTROL: --selftest builds the mask on one image against itself and
   asserts the shaded count is 0, then darkens a known wedge of table by 10 and
   asserts the mask finds exactly that wedge. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 40, height: 40 } });
async function load(path) {
  const b64 = readFileSync(path).toString('base64');
  const d = await pg.evaluate(async (s) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode();
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0);
    return { w: c.width, h: c.height, data: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  }, b64);
  return { w: d.w, h: d.h, px: Uint8ClampedArray.from(d.data) };
}
const L = (im, x, y) => { const o = (y * im.w + x) * 4; return 0.2126 * im.px[o] + 0.7152 * im.px[o + 1] + 0.0722 * im.px[o + 2]; };
const box = (im, x, y, w, h) => { let s = 0, n = 0; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { s += L(im, i, j); n++; } return s / n; };

const ON = await load(process.argv[2]), OFF = await load(process.argv[3]), AA = await load(process.argv[4]);

/* THE BARE-TABLE MASK. A pixel counts as bare table when, IN THE CONTROL ARM
   (shadow off), it is table-coloured — the apron measures L 66-82 and R,G
   within 6 of each other with B well under both, board tops run 95-190, the
   kerb 100-150, the sky/cliffs 130-210, the card rail under 60. Built off OFF
   so the shadow itself cannot shrink its own denominator. Restricted to the
   part of the frame a player sees table in: y 250..612 (above the card rail,
   below the horizon strip). */
function isTable(im, i, j) {
  const o = (j * im.w + i) * 4, r = im.px[o], g = im.px[o + 1], b = im.px[o + 2];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 60 && l < 88 && Math.abs(r - g) < 8 && b < g - 4;
}
function tableStats(a, bImg, label) {
  let total = 0, shaded = 0, sum = 0, peak = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let j = 250; j < 612; j++) for (let i = 0; i < ON.w; i++) {
    if (!isTable(OFF, i, j)) continue;
    total++;
    const d = L(bImg, i, j) - L(a, i, j);
    if (d > 3) { shaded++; sum += d; if (d > peak) peak = d; if (i < minX) minX = i; if (i > maxX) maxX = i; if (j < minY) minY = j; if (j > maxY) maxY = j; }
  }
  return { label, bareTablePx: total, shadedPx: shaded, pct: +(100 * shaded / total).toFixed(2),
           meanDepth: +(shaded ? sum / shaded : 0).toFixed(2), peak: +peak.toFixed(1),
           bbox: shaded ? [minX, minY, maxX - minX, maxY - minY] : null };
}

if (process.argv[5] === '--selftest') {
  const same = tableStats(ON, ON, 'identity');
  const cp = { w: ON.w, h: ON.h, px: Uint8ClampedArray.from(ON.px) };
  /* darken a wedge of KNOWN table (x 100..260, y 400..500) by 10 in the "on" arm */
  for (let j = 400; j < 500; j++) for (let i = 100; i < 260; i++) { const o = (j * ON.w + i) * 4; for (let k = 0; k < 3; k++) cp.px[o + k] = Math.max(0, cp.px[o + k] - 10); }
  const wedge = tableStats(cp, ON, 'known 10-luma wedge x100-260 y400-500');
  console.log(JSON.stringify({ same, wedge }, null, 1));
  console.log('SELFTEST PASS:', same.shadedPx === 0 && wedge.shadedPx > 8000 && Math.abs(wedge.meanDepth - 10) < 0.6 &&
    wedge.bbox[0] >= 100 && wedge.bbox[0] + wedge.bbox[2] <= 260);
  await br.close(); process.exit(0);
}

const r = {
  /* the builder's clause-1 box, verbatim */
  openTableLeft_on: +box(ON, 60, 240, 300, 300).toFixed(2),
  openTableLeft_off: +box(OFF, 60, 240, 300, 300).toFixed(2),
  openTableLeft_aa: +box(AA, 60, 240, 300, 300).toFixed(2),
  /* the builder's clause-2 tile, verbatim */
  playtile_0_8_on: +box(ON, 498, 445, 26, 22).toFixed(2),
  playtile_0_8_off: +box(OFF, 498, 445, 26, 22).toFixed(2),
  playtile_0_8_aa: +box(AA, 498, 445, 26, 22).toFixed(2),
  /* every playable tile is painted after the shadow, so NO tile should move
     between on and off by more than the A/A floor. Sweep a grid of tile-sized
     boxes across the playfield and report the worst. */
};
let worst = 0, worstAt = null, worstAA = 0;
for (let y = 240; y < 560; y += 24) for (let x = 570; x < 1140; x += 26) {
  const d = Math.abs(box(ON, x, y, 20, 16) - box(OFF, x, y, 20, 16));
  const a = Math.abs(box(ON, x, y, 20, 16) - box(AA, x, y, 20, 16));
  if (a > worstAA) worstAA = a;
  if (d > worst) { worst = d; worstAt = [x, y]; }
}
r.worstPlayfieldBoxDelta = +worst.toFixed(2); r.worstPlayfieldBoxAt = worstAt;
r.worstPlayfieldBoxAAFloor = +worstAA.toFixed(2);
r.table = tableStats(ON, OFF, 'shadow on vs off');
r.tableAA = tableStats(ON, AA, 'A/A control');
console.log(JSON.stringify(r, null, 1));
await br.close();
