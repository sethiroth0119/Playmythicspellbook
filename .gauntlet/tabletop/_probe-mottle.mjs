/* MOTTLE METER for the table-and-shadow piece, round 2.
   node _probe-mottle.mjs <png> [<png>...]

   The round-1 critic failed the near field on ONE number: the standard
   deviation of 8x8-BLOCK MEAN LUMA over the crop (0,700,300,200) was 8.98,
   and the gap said get it to <= 3. Per-pixel sd (what _probe-measure.mjs
   reports) is the WRONG meter for this: grain is per-pixel noise and reads as
   texture, while 30-80px cloud blobs are LOW-frequency and are what actually
   reads as "murky water". Averaging each 8x8 block first throws away the
   grain and leaves exactly the blob energy. That is why the gap is phrased in
   blocks and why this file exists separately.

   Also reported: the 5th-95th percentile BLOCK luma span (the "no more than
   ~6 luma across the band" target for the flattened lamp pool) and the
   per-pixel sd, so a future reader can see the grain did NOT go to zero. */
import sharp from 'sharp';

const BOXES = {
  /* THE judged crop for round 2. */
  bottomLeft: [0, 700, 300, 200],
  /* ⚠ AND THE SAME CORNER WITH THE NON-TABLE CONTENT CUT OUT. Measured off
     the gauntlet `mixed` fixture at 1600x900: the top ~60px of the judged crop
     is the board's near skirt and tiles, and everything from x≈205 rightwards
     is the hand's card rail. Between them they are ~45% of that crop's pixels
     and no table change can move either. So the judged crop's absolute number
     is reported for continuity and THIS box is the one that answers "is the
     band flat". Both are printed every run; do not quote one as the other. */
  tableClean: [0, 764, 200, 130],
  /* the box round 1 measured instead, kept only so the two can be compared */
  midLeftOld: [10, 250, 120, 140],
  bottomRight: [1300, 700, 300, 200],
  bottomMid: [650, 780, 300, 120],
};

function measure(data, info, W, H) {
  const ch = info.channels;
  const lum = new Float64Array(W * H);
  for (let i = 0, p = 0; p < W * H; i += ch, p++)
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

  let s = 0; for (let p = 0; p < W * H; p++) s += lum[p];
  const mean = s / (W * H);
  let v = 0; for (let p = 0; p < W * H; p++) v += (lum[p] - mean) ** 2;
  const pxSd = Math.sqrt(v / (W * H));

  const blocks = [];
  for (let by = 0; by + 8 <= H; by += 8) {
    for (let bx = 0; bx + 8 <= W; bx += 8) {
      let b = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b += lum[(by + y) * W + bx + x];
      blocks.push(b / 64);
    }
  }
  let bs = 0; for (const b of blocks) bs += b;
  const bMean = bs / blocks.length;
  let bv = 0; for (const b of blocks) bv += (b - bMean) ** 2;
  const sorted = blocks.slice().sort((a, b) => a - b);
  const q = f => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))];
  return {
    L: +bMean.toFixed(2),
    blockSd: +Math.sqrt(bv / blocks.length).toFixed(2),
    span5_95: +(q(0.95) - q(0.05)).toFixed(2),
    spanFull: +(sorted[sorted.length - 1] - sorted[0]).toFixed(2),
    pxSd: +pxSd.toFixed(2),
    n: blocks.length,
  };
}

for (const f of process.argv.slice(2)) {
  const out = { file: f.replace(/^.*[\\/]/, '') };
  for (const [k, b] of Object.entries(BOXES)) {
    const { data, info } = await sharp(f)
      .extract({ left: b[0], top: b[1], width: b[2], height: b[3] })
      .raw().toBuffer({ resolveWithObject: true });
    out[k] = measure(data, info, b[2], b[3]);
  }
  console.log(JSON.stringify(out, null, 1));
}
