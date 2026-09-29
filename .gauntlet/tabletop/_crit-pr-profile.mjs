/* critic helper: vertical luma/chroma profile down a column strip, plus box stats.
   Asks the §2 question directly: is there a horizon line (a sky->ground step) in
   the surround, and does the surround fall off at the frame edges (vignette)? */
import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const px = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function rowStat(y, x0, x1) {
  let L = 0, R = 0, B = 0, n = 0;
  for (let x = x0; x < x1; x++) { const p = px(x, y); L += luma(p); R += p[0]; B += p[2]; n++; }
  return { L: L / n, RB: (R - B) / n };
}
function box(x0, y0, w, h) {
  let L = 0, R = 0, G = 0, B = 0, n = 0, sq = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const p = px(x, y); const l = luma(p); L += l; sq += l * l; R += p[0]; G += p[1]; B += p[2]; n++;
  }
  const m = L / n;
  return { L: +m.toFixed(1), sd: +Math.sqrt(sq / n - m * m).toFixed(1), r: Math.round(R / n), g: Math.round(G / n), b: Math.round(B / n) };
}

const mode = process.argv[3] || 'profile';
if (mode === 'profile') {
  // left surround strip, well clear of the board (board left edge ~ x 370 at its widest)
  const x0 = 40, x1 = 240;
  const step = +(process.argv[4] || 5), yA = +(process.argv[5] || 0), yB = +(process.argv[6] || H - 1);
  console.log(`— vertical profile, left surround x${x0}-${x1} (L, R-B) —`);
  let prev = null;
  for (let y = yA; y < yB; y += step) {
    const s = rowStat(y, x0, x1);
    const d = prev === null ? 0 : s.L - prev;
    console.log(`y${String(y).padStart(3)}  L ${s.L.toFixed(1).padStart(6)}  R-B ${s.RB.toFixed(1).padStart(7)}  ΔL ${d.toFixed(1).padStart(6)}`);
    prev = s.L;
  }
} else if (mode === 'boxes') {
  const named = JSON.parse(process.argv[4]);
  for (const [name, r] of Object.entries(named)) {
    const s = box(...r);
    console.log(`${name.padEnd(18)} L ${String(s.L).padStart(6)}  sd ${String(s.sd).padStart(5)}  rgb ${s.r},${s.g},${s.b}`);
  }
}
