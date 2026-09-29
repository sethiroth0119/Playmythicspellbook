import sharp from 'sharp';
const OUT = 'E:/game-deploy/.gauntlet/tabletop/_crit3/';
const raw = async f => { const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
async function go(time) {
  const A = await raw(OUT + '_c3-on-' + time + '.png');
  const B = await raw(OUT + '_c3-off-' + time + '.png');
  const C = await raw(OUT + '_c3-aa-' + time + '.png');
  const { width: W, height: H, channels: CH } = A.info;
  let left = 0, right = 0;
  /* the strip of OPEN TABLE between the board's near edge (y 581) and the
     ground quad's near edge (y 681) — where a board's cast shadow must live  */
  let front = 0, frontTot = 0;
  /* the two side gutters beside the board, y 300..560                        */
  let sideL = 0, sideR = 0;
  const colBands = new Array(32).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * CH;
    if (Math.abs(L(C.data, i) - L(A.data, i)) > 2) continue;
    const d = L(B.data, i) - L(A.data, i);
    if (y >= 581 && y < 681) { frontTot++; if (d > 8) front++; }
    if (d > 8) {
      (x < W / 2 ? left++ : right++);
      colBands[Math.min(31, x / 50 | 0)]++;
      if (y >= 300 && y < 560) { if (x < 397) sideL++; else if (x > 1273) sideR++; }
    }
  }
  return { time, left, right, leftRightRatio: +(left / Math.max(1, right)).toFixed(2),
    openTableInFrontOfBoard: { darkened: front, static: frontTot, pct: +(100 * front / Math.max(1, frontTot)).toFixed(2) },
    sideGutterLeft: sideL, sideGutterRight: sideR, colBands50: colBands };
}
console.log(JSON.stringify({ day: await go('day'), dusk: await go('dusk') }, null, 1));
