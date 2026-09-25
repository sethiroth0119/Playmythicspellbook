/* crop + measure helper for the table-and-shadow piece.
   node _probe-measure.mjs <png> [<png2>]
   Reports the boxes the piece is judged on: the bottom third (is it material or
   is it sand?), the table band right under the board's near edge (is there a
   shadow, and which way does it lean?) and the top third. */
import sharp from 'sharp';

const files = process.argv.slice(2);

const BOXES = {
  bottomThird: [0, 600, 1600, 300],
  tableL: [20, 760, 260, 120],       /* open table, left of the board shadow  */
  tableR: [1340, 760, 240, 120],     /* open table, right                     */
  tableFarL: [10, 250, 120, 140],    /* table beside the board, far left      */
  underBoardC: [700, 706, 200, 26],  /* table immediately below the apron     */
  underBoardL: [300, 706, 200, 26],
  underBoardR: [1200, 706, 200, 26],
  below60: [700, 760, 200, 26],      /* same column, 54px further down        */
  topThird: [0, 0, 1600, 300],
};

function stats(data, info) {
  let n = 0, R = 0, G = 0, B = 0, L = 0;
  const lum = [];
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    R += r; G += g; B += b;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    L += l; lum.push(l); n++;
  }
  lum.sort((a, b) => a - b);
  const mean = L / n;
  let v = 0; for (const l of lum) v += (l - mean) * (l - mean);
  const r = R / n, g = G / n, b = B / n;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return {
    rgb: [r, g, b].map(x => +x.toFixed(1)),
    L: +mean.toFixed(1),
    sd: +Math.sqrt(v / n).toFixed(1),
    RmB: +(r - b).toFixed(1),
    chroma: +(mx - mn).toFixed(1),
  };
}

for (const f of files) {
  const out = { file: f };
  for (const [k, box] of Object.entries(BOXES)) {
    const { data, info } = await sharp(f)
      .extract({ left: box[0], top: box[1], width: box[2], height: box[3] })
      .raw().toBuffer({ resolveWithObject: true });
    out[k] = stats(data, info);
  }
  console.log(JSON.stringify(out, null, 1));
}
