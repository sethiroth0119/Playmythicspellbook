/* Static-masked ablation analysis: only pixels that did NOT move between the
   two same-arm frames (rain, flames, unit rings) can count as shadow.       */
import sharp from 'sharp';
const OUT = 'E:/game-deploy/.gauntlet/tabletop/_crit3/';
const raw = async f => { const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
async function analyse(time) {
  const A = await raw(OUT + '_c3-on-' + time + '.png');
  const B = await raw(OUT + '_c3-off-' + time + '.png');
  const C = await raw(OUT + '_c3-aa-' + time + '.png');
  const { width: W, height: H, channels: CH } = A.info;
  const heat = Buffer.alloc(W * H * 3);
  let n = 0, sx = 0, sy = 0, sum = 0, maxD = 0;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const rowN = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * CH, j = (y * W + x) * 3;
    const stat = Math.abs(L(C.data, i) - L(A.data, i)) <= 2;
    const d = L(B.data, i) - L(A.data, i);
    const v = L(A.data, i) * 0.30 | 0;
    heat[j] = heat[j + 1] = heat[j + 2] = v;
    if (stat && d > 8) {
      n++; sx += x; sy += y; sum += d; if (d > maxD) maxD = d;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      rowN[y]++;
      heat[j] = Math.min(255, 60 + d * 5); heat[j + 1] = 0; heat[j + 2] = 0;
    } else if (stat && d < -8) { heat[j] = 0; heat[j + 1] = 0; heat[j + 2] = Math.min(255, 60 - d * 5); }
  }
  await sharp(heat, { raw: { width: W, height: H, channels: 3 } }).resize({ width: 800 }).png().toFile(OUT + '_c3-heatS-' + time + '.png');
  const bands = []; for (let i = 0; i < H; i += 60) bands.push(rowN.slice(i, i + 60).reduce((a, b) => a + b, 0));
  return { time, staticDarkened_gt8: n, pctFrame: +(100 * n / (W * H)).toFixed(2), mean: +(sum / Math.max(1, n)).toFixed(2),
    max: +maxD.toFixed(1), centroid: n ? [Math.round(sx / n), Math.round(sy / n)] : null,
    bbox: n ? [minX, minY, maxX, maxY] : null, rowBands60: bands };
}
const d = await analyse('day'), k = await analyse('dusk');
console.log(JSON.stringify({ day: d, dusk: k, duskOverDay: +(k.staticDarkened_gt8 / Math.max(1, d.staticDarkened_gt8)).toFixed(2) }, null, 1));
