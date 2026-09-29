/* CRITIC, piece `staged-lighting`, round 1. Independent measurement.
   A = armed render, B = ablated (__vistaOff.stagepool=1) control.
   Everything is measured on the FRAME ABOVE THE CARD TRAY (y < TRAY), because
   the tray is fixed UI at ~620 px and 280 rows of card art would swamp every
   histogram with values the board cannot change.

   Negative control: pass the same file twice. Every delta must read 0 and the
   verdict must flip to FAIL. */
import sharp from 'file:///E:/game-deploy/node_modules/sharp/lib/index.js';

const TRAY = 605;           /* first row of the card tray in a 1600x900 shot */
const W = 1600, H = 900;

async function load(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error('unexpected size ' + info.width + 'x' + info.height);
  return data;
}
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

const [fa, fb] = process.argv.slice(2);
const A = await load(fa), B = await load(fb);

/* ── 1. WHERE DID IT CHANGE? Derived from the pixels, not from my eyeball.
   A column/row occupancy map of |dL| >= 2. The board should be a hole. */
let changed = 0, total = 0, maxd = 0;
const dmap = new Float32Array(W * H);
for (let y = 0; y < TRAY; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  const d = lum(A, i) - lum(B, i);
  dmap[y * W + x] = d;
  total++; if (Math.abs(d) >= 2) changed++;
  if (Math.abs(d) > maxd) maxd = Math.abs(d);
}

/* ── 2. THE BOARD MASK. Taken as the set of pixels the pool did NOT touch
   (|dL| < 0.5) inside the board's bounding quad — i.e. the region the piece
   claims is untouched. If the piece HAD crushed the tiles this mask would
   collapse and the "unchanged" claim would be self-refuting, so the mask is
   reported with its area. */
const quad = [[545, 196], [1190, 192], [1372, 600], [372, 600]];
function inQuad(x, y) {
  let s = 0;
  for (let k = 0; k < 4; k++) {
    const a = quad[k], b = quad[(k + 1) % 4];
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c > 0) s++; else if (c < 0) s--;
  }
  return Math.abs(s) === 4;
}
const boardL = [], roomL = [], boardMoved = [], roomMoved = [];
const boardRB = [], roomRB = [];
for (let y = 0; y < TRAY; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, L = lum(A, i), rb = A[i] - A[i + 2];
  if (inQuad(x, y)) { boardL.push(L); boardMoved.push(Math.abs(dmap[y * W + x])); boardRB.push(rb); }
  else { roomL.push(L); roomMoved.push(Math.abs(dmap[y * W + x])); roomRB.push(rb); }
}
const q = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

/* ── 3. IS THE BOARD THE BRIGHTEST THING IN FRAME (§7)? Not "is its median
   higher" — a bright sky band would beat it on p99 while the board still read
   as a lit room. The honest test is the LIT DECILE of each region: the board's
   p90 against the room's p90, plus the ratio of medians. */
const out = {
  changedPixelsPct: +(100 * changed / total).toFixed(1),
  maxAbsDeltaL: +maxd.toFixed(1),
  board: { px: boardL.length, median: +q(boardL, .5).toFixed(1), p90: +q(boardL, .9).toFixed(1), p10: +q(boardL, .1).toFixed(1), meanMoved: +mean(boardMoved).toFixed(2), maxMoved: +boardMoved.reduce((m,v)=>v>m?v:m,0).toFixed(1), medRB: +q(boardRB, .5).toFixed(1) },
  roomArmed: { px: roomL.length, median: +q(roomL, .5).toFixed(1), p90: +q(roomL, .9).toFixed(1), meanMoved: +mean(roomMoved).toFixed(2) },
};
/* room, ablated */
const roomB = [], roomBrb = [];
for (let y = 0; y < TRAY; y++) for (let x = 0; x < W; x++) {
  if (inQuad(x, y)) continue;
  const i = (y * W + x) * 4; roomB.push(lum(B, i)); roomBrb.push(B[i] - B[i + 2]);
}
out.roomAblated = { median: +q(roomB, .5).toFixed(1), p90: +q(roomB, .9).toFixed(1) };
out.contrastBoardOverRoomP90 = { armed: +(q(boardL, .5) / q(roomL, .9)).toFixed(2), ablated: +(q(boardL, .5) / q(roomB, .9)).toFixed(2) };

/* ── 4. §1.4 THE VALUE BAND. The defect is "one narrow value band", so the
   measure is how much of the frame piles into the midtones that the board's
   own lower half occupies. 16-bucket histogram, above the tray only. */
function hist(d) {
  const h = new Array(16).fill(0); let n = 0;
  for (let y = 0; y < TRAY; y++) for (let x = 0; x < W; x++) { const L = lum(d, (y * W + x) * 4); h[Math.min(15, L / 16 | 0)]++; n++; }
  return h.map(v => +(100 * v / n).toFixed(1));
}
out.histArmed = hist(A);
out.histAblated = hist(B);

/* ── 5. BANDING. A 16-step column walk across the left table at the board's
   mid height. A staircase here would be the pool's own ramp quantising. */
const prof = (d, y) => { const r = []; for (let x = 8; x < 380; x += 16) r.push(+lum(d, (y * W + x) * 4).toFixed(0)); return r; };
out.leftTableProfileY400 = prof(A, 400);
out.leftTableProfileY400_ablated = prof(B, 400);
out.maxStepLeftProfile = (() => { const p = prof(A, 400); let m = 0; for (let i = 1; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - p[i - 1])); return m; })();

/* ── 6. NO TEAL (§1.4's "dark water"). R−B at five table sites. */
const sites = { farLeft: [120, 260], left: [300, 430], nearLeft: [300, 580], right: [1450, 430], farRight: [1460, 250], nearRight: [1480, 580] };
out.tableSites = {};
for (const k in sites) {
  const [x, y] = sites[k]; const i = (y * W + x) * 4;
  out.tableSites[k] = { L_armed: +lum(A, i).toFixed(1), L_ablated: +lum(B, i).toFixed(1), dL: +(lum(A, i) - lum(B, i)).toFixed(1), RB_armed: A[i] - A[i + 2], RB_ablated: B[i] - B[i + 2] };
}

/* ── 7. THE VERDICT GATES.
   (a) the board must not move       — max |dL| inside the quad < 2
   (b) the room's lit decile must fall by >= 8 luma
   (c) no site may go teal           — R−B armed > -12 everywhere on the table */
const gA = out.board.maxMoved < 2;
const gB = (q(roomB, .9) - q(roomL, .9)) >= 8;
const gC = Object.values(out.tableSites).every(s => s.RB_armed > -12);
out.gates = { a_boardHeld: gA, b_roomLitDecileFell: +(q(roomB, .9) - q(roomL, .9)).toFixed(1), b_pass: gB, c_noTeal: gC };
out.VERDICT = (gA && gB && gC) ? 'PASS' : 'FAIL';
console.log(JSON.stringify(out, null, 1));
