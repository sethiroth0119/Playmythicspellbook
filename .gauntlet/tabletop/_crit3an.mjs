import sharp from 'sharp';
const OUT = 'E:/game-deploy/.gauntlet/tabletop/_crit3/';
const raw = async f => { const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
async function analyse(time) {
  const A = await raw(OUT + '_c3-on-' + time + '.png');
  const B = await raw(OUT + '_c3-off-' + time + '.png');
  const C = await raw(OUT + '_c3-aa-' + time + '.png');
  const { width: W, height: H, channels: CH } = A.info;
  let n = 0, sx = 0, sy = 0, sum = 0, maxD = 0, aaN = 0;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const rowN = new Array(H).fill(0), colN = new Array(W).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * CH;
    const d = L(B.data, i) - L(A.data, i);
    if (Math.abs(L(C.data, i) - L(A.data, i)) > 8) aaN++;
    if (d > 8) { n++; sx += x; sy += y; sum += d; if (d > maxD) maxD = d;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      rowN[y]++; colN[x]++; }
  }
  return { time, movedPx_gt8: n, animFloor_gt8: aaN, mean: +(sum / Math.max(1, n)).toFixed(2),
    max: +maxD.toFixed(1), centroid: n ? [Math.round(sx / n), Math.round(sy / n)] : null,
    bbox: n ? [minX, minY, maxX, maxY] : null,
    lowestRow: rowN.reduce((a, v, i) => v > 0 ? i : a, -1),
    topRow: rowN.findIndex(v => v > 0) };
}
console.log(JSON.stringify({ day: await analyse('day'), dusk: await analyse('dusk') }, null, 1));
