/* Is the bright rim at the frame edge (a) real, (b) this piece's, (c) also below
   the horizon? NEGATIVE CONTROL built in: the same probe on the builder's
   SKY_SCENERY_ON=true render. If the rim is there too, it predates this piece. */
import sharp from 'sharp';
async function probe(f, label) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const L = (x, y) => { const i = (y * W + x) * C; return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; };
  const box = (x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += L(x, y); n++; } return s / n; };
  console.log('\n== ' + label + ' (' + W + 'x' + H + ')');
  console.log('  ABOVE HORIZON   edge x0-6   ', box(0, 20, 6, 170).toFixed(1), ' vs inland x60-200 ', box(60, 20, 200, 170).toFixed(1));
  console.log('  ABOVE HORIZON   edge y0-6   ', box(300, 0, 1300, 6).toFixed(1), ' vs inland y60-140', box(300, 60, 1300, 140).toFixed(1));
  console.log('  BELOW HORIZON   edge x0-6   ', box(0, 620, 6, 890).toFixed(1), ' vs inland x60-200 ', box(60, 620, 200, 890).toFixed(1));
  console.log('  BOTTOM          edge y894-900', box(300, 894, 1300, 900).toFixed(1), ' vs y800-860     ', box(300, 800, 1300, 860).toFixed(1));
}
for (let i = 2; i < process.argv.length; i += 2) await probe(process.argv[i], process.argv[i + 1]);
