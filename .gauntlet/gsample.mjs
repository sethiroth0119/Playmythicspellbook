/* ═══ THE GROUND SAMPLER ══════════════════════════════════════════════════
   Round 5. The round-4 whole-frame critic's sentence was "the whole city is
   sitting on ONE FLAT, UNIFORM SHEET OF OLIVE-GREEN … no variation in hue".
   That is a claim about pixels, so it is answered with pixels rather than with
   an opinion.

   HOW IT PICKS THE GROUND. Hand-drawn sample rectangles were tried first and
   were useless: every box big enough to be a sample also caught a lamp shadow,
   a kerb or a rail, and the within-box sd then measured the FURNITURE, not the
   terrain. This classifies instead — a pixel is terrain if its hue is in the
   grass/dust family and it is not in deep shade — and then bins the survivors
   by IMAGE ROW, which on a fixed camera is a monotonic proxy for distance.
   Reported per bin: mean sRGB, hue, value, and the sd of value WITHIN the bin.

   THE TWO NUMBERS THAT MATTER:
     acrossBins.valSpread — does the ground change from foreground to horizon
     meanWithinSD         — does it have a surface at any one distance
   ══════════════════════════════════════════════════════════════════════════ */
import sharp from 'sharp';

const rgb2hsv = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
};

const file = process.argv[2];
// The UI chrome bands (top HUD, bottom dock) are not terrain and are excluded.
const Y0 = +(process.argv[3] || 230), Y1 = +(process.argv[4] || 810);
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width, C = info.channels;

const NB = 5;                                   // near → far
const bins = Array.from({ length: NB }, () => ({ n: 0, r: 0, g: 0, b: 0, hs: 0, hc: 0, vs: [] }));
for (let y = Y0; y < Y1; y++) {
  // near = bottom of frame. Bin 0 is the foreground.
  const k = Math.min(NB - 1, ((Y1 - 1 - y) / (Y1 - Y0) * NB) | 0);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C, r = data[i], g = data[i + 1], b = data[i + 2];
    const [h, s, v] = rgb2hsv(r, g, b);
    // grass / dust / verge family, lit side only — shade is a lighting question
    if (h < 40 || h > 125 || s < 0.10 || v < 0.28) continue;
    const B = bins[k];
    B.n++; B.r += r; B.g += g; B.b += b; B.hs += h; B.vs.push(v);
  }
}
const rows = [], names = ['near', 'nearmid', 'mid', 'midfar', 'far'];
for (let k = 0; k < NB; k++) {
  const B = bins[k]; if (!B.n) { rows.push({ bin: names[k], px: 0 }); continue; }
  const mv = B.vs.reduce((a, c) => a + c, 0) / B.n;
  const sd = Math.sqrt(B.vs.reduce((a, c) => a + (c - mv) * (c - mv), 0) / B.n);
  rows.push({
    bin: names[k], px: B.n,
    rgb: `${(B.r / B.n) | 0},${(B.g / B.n) | 0},${(B.b / B.n) | 0}`,
    hue: +(B.hs / B.n).toFixed(1), val: +mv.toFixed(3), sd: +sd.toFixed(4),
  });
}
console.table(rows);
const ok = rows.filter(r => r.px > 2000);
const sp = a => +(Math.max(...a) - Math.min(...a)).toFixed(3);
console.log(JSON.stringify({
  file,
  acrossBins: { hueSpread: sp(ok.map(r => r.hue)), valSpread: sp(ok.map(r => r.val)) },
  meanWithinSD: +(ok.reduce((a, r) => a + r.sd, 0) / ok.length).toFixed(4),
  terrainPx: ok.reduce((a, r) => a + r.px, 0),
}));

/* ⭐ PATCH SPREAD, which is the one that answers "no variation in hue".
   The by-distance bins above answer "does the ground change from the
   foreground to the horizon" and they CANNOT answer "does it change from place
   to place": a field that varies laterally averages back to its own mean inside
   every row band, so a plate with real patches and a plate with none score the
   same. This tiles the frame into 40x40 blocks, keeps the ones that are almost
   all terrain, and reports the 10th-to-90th percentile spread of their mean
   value and mean hue. That is the number the critic's eye is actually reading.  */
{
  const BS = 40, blocks = [];
  for (let by = Y0; by + BS < Y1; by += BS) for (let bx = 0; bx + BS < W; bx += BS) {
    let n = 0, sv = 0, sh = 0, tot = 0;
    for (let y = by; y < by + BS; y += 2) for (let x = bx; x < bx + BS; x += 2) {
      const i = (y * W + x) * C;
      const [h, s, v] = rgb2hsv(data[i], data[i + 1], data[i + 2]);
      tot++;
      if (h < 40 || h > 125 || s < 0.10 || v < 0.28) continue;
      n++; sv += v; sh += h;
    }
    if (n / tot > 0.9) blocks.push([sv / n, sh / n]);
  }
  const pct = (a, p) => { a = a.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, (a.length * p) | 0)]; };
  const vv = blocks.map(b => b[0]), hh = blocks.map(b => b[1]);
  console.log(JSON.stringify({
    patchBlocks: blocks.length,
    patchValSpread: +(pct(vv, .9) - pct(vv, .1)).toFixed(3),
    patchHueSpread: +(pct(hh, .9) - pct(hh, .1)).toFixed(1),
  }));
}

/* ⭐ LOCAL contrast, which is the one that answers "no texture".
   The global sd above is dominated by the sun/shade gradient across the frame:
   a perfectly flat sheet lit by a raking sun still scores ~0.05 on it. This
   measures each terrain pixel against the mean of the 15×15 box around it, so
   a smooth gradient scores ~0 and a SURFACE scores. */
{
  const R = 7, step = 2;
  let acc = 0, n = 0;
  for (let y = Y0 + R; y < Y1 - R; y += step) for (let x = R; x < W - R; x += step) {
    const i = (y * W + x) * C;
    const [h, s, v] = rgb2hsv(data[i], data[i + 1], data[i + 2]);
    if (h < 40 || h > 125 || s < 0.10 || v < 0.28) continue;
    let m = 0, k = 0, bad = 0;
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const j = ((y + dy) * W + (x + dx)) * C;
      const [hh, ss, vv] = rgb2hsv(data[j], data[j + 1], data[j + 2]);
      if (hh < 40 || hh > 125 || ss < 0.10 || vv < 0.28) { bad++; continue; }
      m += vv; k++;
    }
    if (bad > 4 || k < 8) continue;               // skip edges of other objects
    acc += Math.abs(v - m / k); n++;
  }
  console.log(JSON.stringify({ localContrast: +(acc / n).toFixed(5), samples: n }));
}
