/* critic round 2 — vertical luma profile of the SURROUND ONLY (left+right
   gutters, board excluded) plus named box means.
   usage: node _crit-prof.mjs <png> [<png2>]
   NEGATIVE CONTROL is built in: pass the same file twice and every delta must
   read 0.00. */
import sharp from 'sharp';
const files = process.argv.slice(2);

async function load(f) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
const L = (im, x, y) => {
  const i = (y * im.w + x) * im.ch;
  return 0.299 * im.data[i] + 0.587 * im.data[i + 1] + 0.114 * im.data[i + 2];
};
function boxMean(im, x0, y0, w, h) {
  let s = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { s += L(im, x, y); n++; }
  return s / n;
}
/* surround gutters: x 0-360 and 1240-1600. The board's stone frame spans
   roughly x 370..1370 at its widest (measured off the render), so these two
   strips never contain board pixels at any y. */
function rowSurround(im, y) {
  let s = 0, n = 0;
  for (let x = 0; x < 360; x++) { s += L(im, x, y); n++; }
  for (let x = 1240; x < im.w; x++) { s += L(im, x, y); n++; }
  return s / n;
}

const BOXES = {
  'sky-top        (600,20,400,60)': [600, 20, 400, 60],
  'sun-disc       (990,45,120,90)': [990, 45, 120, 90],
  'sky-just-above (600,110,400,25)': [600, 110, 400, 25],
  'roomline-band  (40,190,400,30)': [40, 190, 400, 30],
  'plate-L        (240,205,320,30)': [240, 205, 320, 30],
  'plate-R        (1120,205,320,30)': [1120, 205, 320, 30],
  'gutter-under-L (240,250,320,30)': [240, 250, 320, 30],
  'table-open-L   (40,320,260,200)': [40, 320, 260, 200],
  'board-centre   (600,300,400,200)': [600, 300, 400, 200],
  'board-far-row  (600,230,400,40)': [600, 230, 400, 40],
  'surr-bottom-L  (40,540,260,60)': [40, 540, 260, 60],
};

const ims = [];
for (const f of files) ims.push(await load(f));
console.log('files:', files.join('  vs  '));
console.log('\n== named boxes (mean luma) ==');
for (const [k, b] of Object.entries(BOXES)) {
  const vals = ims.map(im => boxMean(im, ...b));
  const d = vals.length > 1 ? '   d=' + (vals[1] - vals[0]).toFixed(2) : '';
  console.log(k.padEnd(34), vals.map(v => v.toFixed(1).padStart(6)).join(''), d);
}
console.log('\n== surround-only row profile (x 0-360 + 1240-1600) ==');
for (let y = 0; y <= 620; y += 10) {
  const vals = ims.map(im => rowSurround(im, y));
  const d = vals.length > 1 ? '   d=' + (vals[1] - vals[0]).toFixed(2) : '';
  console.log('y', String(y).padStart(4), vals.map(v => v.toFixed(1).padStart(7)).join(''), d);
}
