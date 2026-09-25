/* CRITIC round 4 — what does boardShadow() actually put on screen, and where?
   judgedBy asks two things a box mean cannot answer: is the shape the board's
   footprint projected along lightVector (vs a symmetric drop shadow), and does
   it land where a player looks. So this walks the WHOLE frame of the A/B and
   reports, per row and per column, the darkened-pixel count against the A/A
   animation floor measured the same way in the same run. */
import sharp from 'sharp';
const OUT = 'E:/game-deploy/.gauntlet/tabletop/';
const raw = async f => await sharp(OUT + f).raw().toBuffer({ resolveWithObject: true });
const A = await raw('_crit4-on-day.png'), B = await raw('_crit4-off-day.png');
const AA = await raw('_crit4-aa-day.png');
const { width: W, height: H, channels: C } = A.info;
const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function scan(X, Y) {                    /* X = shadow arm, Y = the other arm */
  const rowN = new Array(H).fill(0), colN = new Array(W).fill(0);
  const rowSx = new Array(H).fill(0);
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C;
    const d = L(Y.data, i) - L(X.data, i);
    if (d > 6) { rowN[y]++; colN[x]++; rowSx[y] += x; n++; }
  }
  return { rowN, colN, rowSx, n };
}
const S = scan(A, B);          /* shadow on vs ablated */
const F = scan(A, AA);         /* same arm twice — rain + braziers only */

const band = (rowN, y0, y1) => rowN.slice(y0, y1).reduce((s, v) => s + v, 0);
const rep = [];
for (let y = 180; y < 900; y += 60) {
  rep.push({ y0: y, shadowPx: band(S.rowN, y, y + 60), floorPx: band(F.rowN, y, y + 60),
    xCentroid: band(S.rowN, y, y + 60) ? Math.round(S.rowSx.slice(y, y + 60).reduce((s, v) => s + v, 0) / band(S.rowN, y, y + 60)) : null });
}
/* left half vs right half of the frame — a light vector with lv.x = +0.196
   casts toward -x, so a directional shadow must be heavier on the LEFT. */
const half = (colN, a, b) => colN.slice(a, b).reduce((s, v) => s + v, 0);
console.log(JSON.stringify({
  totalShadowPx: S.n, totalFloorPx: F.n,
  leftHalf: { shadow: half(S.colN, 0, 800), floor: half(F.colN, 0, 800) },
  rightHalf: { shadow: half(S.colN, 800, 1600), floor: half(F.colN, 800, 1600) },
  byRowBand: rep,
}, null, 1));
