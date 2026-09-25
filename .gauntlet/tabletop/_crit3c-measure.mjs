// Critic round 3 measurement. Independent of the builder's tools.
// Q1: does the surround get LIGHTER as it recedes (ground->horizon) or DARKER (room wall)?
// Q2: what are the bright patches at y~200-230 and the object at x~1110 y~170?
import sharp from 'sharp';
const f = process.argv[2];
const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const L = (x, y) => { const i = (y * W + x) * C; return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; };
const rgb = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };

console.log('size', W, 'x', H);

// --- Q1: vertical luma profile down the LEFT gutter (x 60-300) and RIGHT gutter (x 1320-1560)
// These columns never touch the board, so they are pure surround.
function colProfile(x0, x1, label) {
  const rows = [];
  for (let y = 0; y < 900; y += 20) {
    let s = 0, n = 0;
    for (let y2 = y; y2 < Math.min(y + 20, 900); y2++) for (let x = x0; x < x1; x += 2) { s += L(x, y2); n++; }
    rows.push([y, s / n]);
  }
  console.log('\n' + label + '  (x ' + x0 + '-' + x1 + ')  y : meanL');
  console.log(rows.map(([y, l]) => 'y' + String(y).padStart(3) + ' ' + l.toFixed(1)).join('  '));
  // where is the local MAX above the board top (y<600)?
  let best = rows.filter(r => r[0] < 600).reduce((a, b) => b[1] > a[1] ? b : a);
  console.log('  brightest band above y600: y=' + best[0] + ' L=' + best[1].toFixed(1));
}
colProfile(40, 300, 'LEFT GUTTER');
colProfile(1320, 1570, 'RIGHT GUTTER');

// --- Q2: horizontal profile across the suspect lit band y 200-240
function rowProfile(y0, y1, label) {
  const cols = [];
  for (let x = 0; x < W; x += 50) {
    let s = 0, n = 0;
    for (let x2 = x; x2 < Math.min(x + 50, W); x2 += 2) for (let y = y0; y < y1; y += 2) { s += L(x2, y); n++; }
    cols.push([x, s / n]);
  }
  console.log('\n' + label + ' (y ' + y0 + '-' + y1 + ') x : meanL');
  console.log(cols.map(([x, l]) => 'x' + String(x).padStart(4) + ' ' + l.toFixed(1)).join('  '));
}
rowProfile(200, 240, 'BAND A');
rowProfile(120, 160, 'BAND B (upper)');
rowProfile(40, 80, 'BAND C (top of frame)');

// --- sample specific colours
for (const [x, y, n] of [[150, 40, 'top-left blob'], [800, 40, 'top-centre'], [1500, 40, 'top-right'],
[150, 150, 'left mid'], [800, 150, 'centre mid'], [1500, 150, 'right mid'],
[300, 215, 'left patch'], [1350, 215, 'right patch'], [800, 195, 'behind board'],
[120, 700, 'table fore-left'], [1500, 700, 'table fore-right'], [800, 870, 'table bottom']]) {
  console.log(n.padEnd(18), 'rgb', rgb(x, y).join(','), 'L', L(x, y).toFixed(1));
}
