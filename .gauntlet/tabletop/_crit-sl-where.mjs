/* Follow-up: my quad-based board mask failed gate (a) with meanMoved 0.2 but
   maxMoved 37.5 — the signature of a MASK error, not a tile crush. So localise
   it: where inside the quad did anything move, and is that region board or is
   it table my straight-line quad swallowed?
   Also: the honest board test, which is a shrunken quad (the playfield proper,
   inside the stone rim) — if the tiles were crushed, THAT would move. */
import sharp from 'file:///E:/game-deploy/node_modules/sharp/lib/index.js';
const W = 1600, H = 900, TRAY = 605;
const load = async p => (await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const [fa, fb] = process.argv.slice(2);
const A = await load(fa), B = await load(fb);

const quad = [[545, 196], [1190, 192], [1372, 600], [372, 600]];
function shrink(q, k) { const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4; return q.map(p => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]); }
function inQ(q, x, y) { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c > 0) s++; else if (c < 0) s--; } return Math.abs(s) === 4; }

for (const k of [1.0, 0.95, 0.90, 0.80]) {
  const q = shrink(quad, k);
  let n = 0, sum = 0, max = 0, over2 = 0, over5 = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
  for (let y = 0; y < TRAY; y++) for (let x = 0; x < W; x++) {
    if (!inQ(q, x, y)) continue;
    const i = (y * W + x) * 4, d = Math.abs(lum(A, i) - lum(B, i));
    n++; sum += d; if (d > max) max = d;
    if (d >= 2) { over2++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    if (d >= 5) over5++;
  }
  console.log(`quad x${k.toFixed(2)}  px=${n}  mean|dL|=${(sum / n).toFixed(3)}  max=${max.toFixed(1)}  >=2: ${(100 * over2 / n).toFixed(2)}%  >=5: ${(100 * over5 / n).toFixed(2)}%  movedBBox=${over2 ? [bx0, by0, bx1, by1].join(',') : 'none'}`);
}

/* The tiles themselves: sample a grid of points well inside the playfield and
   report each one's move. A crush would show up as a systematic negative. */
console.log('\nplayfield grid, dL (armed - ablated):');
const rows = [];
for (let y = 240; y <= 560; y += 40) {
  const r = [];
  for (let x = 480; x <= 1300; x += 60) {
    if (!inQ(shrink(quad, 0.92), x, y)) { r.push('  . '); continue; }
    const i = (y * W + x) * 4;
    r.push((lum(A, i) - lum(B, i)).toFixed(1).padStart(5));
  }
  rows.push('y=' + String(y).padStart(3) + ' ' + r.join(''));
}
console.log(rows.join('\n'));
