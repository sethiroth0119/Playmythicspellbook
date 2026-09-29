/* §7's literal claim: "the playfield is the BRIGHTEST THING IN FRAME".
   A median comparison does not test that — a small bright object outside the
   board would pass it while sitting in the frame pulling the eye. So: 20x12
   block map of mean luma over the frame above the tray, with each block marked
   BOARD / ROOM by whether its centre falls in the board quad, and the ROOM
   blocks ranked. Anything in the room out-ranking the board's median is a
   §7 failure and gets named with its coordinates. */
import sharp from 'file:///E:/game-deploy/node_modules/sharp/lib/index.js';
const W = 1600, TRAY = 605, BX = 20, BY = 12;
const load = async p => (await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const quad = [[545, 196], [1190, 192], [1372, 600], [372, 600]];
const inQ = (x, y) => { let s = 0; for (let i = 0; i < 4; i++) { const a = quad[i], b = quad[(i + 1) % 4]; const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c > 0) s++; else if (c < 0) s--; } return Math.abs(s) === 4; };
const bw = W / BX, bh = TRAY / BY;

for (const f of process.argv.slice(2)) {
  const D = await load(f);
  const rows = [], room = [];
  let boardSum = 0, boardN = 0;
  for (let by = 0; by < BY; by++) {
    const r = [];
    for (let bx = 0; bx < BX; bx++) {
      let s = 0, n = 0;
      for (let y = by * bh | 0; y < (by + 1) * bh; y += 2) for (let x = bx * bw | 0; x < (bx + 1) * bw; x += 2) { s += lum(D, (y * W + x) * 4); n++; }
      const m = s / n;
      const isB = inQ((bx + .5) * bw, (by + .5) * bh);
      if (isB) { boardSum += m; boardN++; } else room.push({ m, bx, by });
      r.push((isB ? '[' : ' ') + String(Math.round(m)).padStart(3) + (isB ? ']' : ' '));
    }
    rows.push(r.join(''));
  }
  room.sort((a, b) => b.m - a.m);
  console.log('\n══ ' + f);
  console.log(rows.join('\n'));
  const bmean = boardSum / boardN;
  console.log('board blocks mean ' + bmean.toFixed(1) + ' (' + boardN + ' blocks)');
  console.log('brightest ROOM blocks: ' + room.slice(0, 5).map(r => `${Math.round(r.m)}@(${r.bx},${r.by})`).join('  '));
  const over = room.filter(r => r.m > bmean);
  console.log('room blocks brighter than the board mean: ' + over.length + (over.length ? '  -> ' + over.map(r => `(${r.bx},${r.by})=${Math.round(r.m)}`).join(' ') : '  §7 OK'));
}
