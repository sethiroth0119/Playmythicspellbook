/* critic r2 — §7 "the playfield is the brightest thing in frame".
   Ranks 32x32 blocks by mean luma over the STAGE ONLY (y 0..600, above the
   card tray, which is UI chrome and not part of the board picture) and labels
   each block board / surround / sky by its position against the board's
   measured stone frame.
   usage: node _crit2-bright.mjs <png>
   NEGATIVE CONTROL: node _crit2-bright.mjs --synthetic builds a frame whose
   only bright block is a known 32x32 patch at (320,320) and must rank it #1
   and label it 'board'. */
import sharp from 'sharp';
const IN = process.argv[2];
let data, W, H, ch;
if (IN === '--synthetic') {
  W = 1600; H = 600; ch = 3; data = Buffer.alloc(W * H * ch, 40);
  for (let y = 320; y < 352; y++) for (let x = 320; x < 352; x++) { const i = (y * W + x) * ch; data[i] = data[i + 1] = data[i + 2] = 250; }
} else {
  const r = await sharp(IN).extract({ left: 0, top: 0, width: 1600, height: 600 }).raw().toBuffer({ resolveWithObject: true });
  data = r.data; W = r.info.width; H = r.info.height; ch = r.info.channels;
}
/* the board's stone frame, read off the render: a quad whose far edge is
   y=196 spanning x 551..1154 and whose near edge is y=600 spanning x 330..1400.
   A block is 'board' if its centre is inside that quad. */
function onBoard(cx, cy) {
  if (cy < 196 || cy > 600) return false;
  const t = (cy - 196) / (600 - 196);
  return cx > 551 - t * (551 - 330) && cx < 1154 + t * (1400 - 1154);
}
const blocks = [];
for (let by = 0; by + 32 <= H; by += 32) for (let bx = 0; bx + 32 <= W; bx += 32) {
  let s = 0;
  for (let y = by; y < by + 32; y++) for (let x = bx; x < bx + 32; x++) { const i = (y * W + x) * ch; s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; }
  const cx = bx + 16, cy = by + 16;
  blocks.push({ bx, by, L: s / 1024, where: onBoard(cx, cy) ? 'board' : (cy < 190 ? 'SKY' : 'surround') });
}
blocks.sort((a, b) => b.L - a.L);
console.log('top 12 brightest 32x32 blocks in the stage (y<600):');
for (const b of blocks.slice(0, 12)) console.log(`  x${String(b.bx).padStart(4)} y${String(b.by).padStart(4)}  L ${b.L.toFixed(1).padStart(6)}   ${b.where}`);
const byWhere = k => blocks.filter(b => b.where === k);
for (const k of ['SKY', 'board', 'surround']) {
  const a = byWhere(k); if (!a.length) { console.log(k, 'none'); continue; }
  console.log(`${k.padEnd(9)} n=${String(a.length).padStart(4)}  max ${a[0].L.toFixed(1).padStart(6)}  mean ${(a.reduce((s, b) => s + b.L, 0) / a.length).toFixed(1).padStart(6)}`);
}
const skyMax = byWhere('SKY')[0], boardMax = byWhere('board')[0];
if (skyMax && boardMax) console.log(`\n§7: brightest SKY block ${skyMax.L.toFixed(1)}  vs brightest BOARD block ${boardMax.L.toFixed(1)}  ->  ${skyMax.L > boardMax.L ? 'SKY WINS (rule inverted)' : 'board wins'}`);
