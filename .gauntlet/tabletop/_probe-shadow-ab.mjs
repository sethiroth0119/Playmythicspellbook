/* A/B the board shadow against a real negative control, and against dusk.
   Renders the SAME gauntlet `mixed` fixture four ways:
     on-day   shadow on,  timeOfDay day
     off-day  shadow ABLATED (__vistaOff.boardshadow), timeOfDay day
     on-dusk  shadow on,  timeOfDay dusk
     off-dusk shadow ablated, dusk
   and reports, per arm, the pixels the shadow actually moves.

   ⚠ The land bake is keyed on W|H|dpr|MAP.id|cols|rows and NOT on the ablation
   flag, so flipping the flag alone changes nothing on screen. Nudging the
   viewport a pixel and back is what forces the re-bake — without that this
   script reports a confident zero, which is the exact failure mode
   .gauntlet/README.md item 6 is about. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PUB = 'E:/game-deploy/public';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(PUB, p);
  if (!path.resolve(f).startsWith(path.resolve(PUB))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(b);
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

/* the gauntlet fixture's OWN payload, taken from shot.mjs at run time rather
   than copied: the bar treats the fixture as frozen, and a second copy of the
   scene tables is exactly how two rounds end up A/B-ing different boards.
   Everything shot.mjs defines above its `const evalJs` line is pure — scene
   tables, buildTiles(), the mix report — so it is evaluated here with the same
   two argv it would see, and `payload` is read straight out of it. */
const shotSrc = fs.readFileSync('E:/game-deploy/.gauntlet/tabletop/shot.mjs', 'utf8');
const pure = shotSrc.slice(0, shotSrc.indexOf('const payload ='))
  .replace(/^import.*$/gm, '');
const payload = new Function('process', pure + ';return JSON.stringify({cols:COLS,rows:ROWS,tiles});')(
  { argv: ['node', 'shot', 'ab.png', '--scene', 'mixed'] });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:' + PORT + '/battle-board/index.html', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(7000);
await page.evaluate(js => eval(js), `window.postMessage({type:'board:map',map:${payload}},location.origin)`);
await page.waitForTimeout(3000);

async function rebake() {
  await page.setViewportSize({ width: 1601, height: 900 });
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 1600, height: 900 });
  /* ⚠ 1800 WAS NOT ENOUGH AND THE SYMPTOM LOOKED LIKE NOISE, NOT LIKE A BUG.
     bakeKeys' `shape` carries W/H/dpr/MAP but not CAMERA.yaw or CAMERA.pan, so
     the land bake — the shadow included — is stale while the fit is still
     easing after a viewport change. Round 3 measured the SAME code returning a
     box delta of 14.6 on one load and 15.6 on the next, which at a clause
     floor of 15 is the difference between a pass and a fail, and it collapsed
     to a spread of 0.13 over four loads at 8s. */
  await page.waitForTimeout(8000);
}
async function arm(shadowOn, time) {
  await page.evaluate(t => { try { setTimeOfDay(t); } catch (e) { } }, time);
  await page.waitForTimeout(3200);           /* the 2.5s light lerp + settle */
  await page.evaluate(on => { window.__vistaOff = on ? {} : { boardshadow: 1 }; }, shadowOn);
  await rebake();
}
async function shot(name) { const p = 'E:/game-deploy/.gauntlet/tabletop/_ab-' + name + '.png'; await page.screenshot({ path: p }); return p; }

/* ── THE ROUND-3 HUE CLAUSE, measured where it is argued ────────────────────
   The board shadow may darken the table without COLOURING it: in BOX the
   shadow-on frame must hold |R−B| ≤ 10 and chroma ≤ 12 (max−min of the box
   mean) while still darkening that box by ≥ 15 luma against the ablation
   control. REF is the open table immediately below the same box — quoted with
   every reading because "not coloured" only means anything relative to the
   surface the shadow is lying on. Round 2 measured −25.7 / 25.7 in BOX against
   +9.2 in REF; that is the number this clause exists to move. */
const BOX = [0, 742, 120, 45];
const REF = [0, 787, 120, 45];

const arms = {};
for (const time of ['day', 'dusk']) {
  for (const on of [true, false]) {
    await arm(on, time);
    arms[(on ? 'on-' : 'off-') + time] = await shot((on ? 'on-' : 'off-') + time);
    /* 🔴 THE A/A CONTROL, AND IT IS NOT OPTIONAL — see TABLETOP-BAR §11 ("a
       gate nobody has seen fail is not evidence") and the header of
       _probe-ab-analyse.mjs. THE SCENE ANIMATES: rain falls across the whole
       frame and two braziers burn, so two screenshots of the SAME arm already
       differ, and every "pixels the shadow moved" count below is that
       difference PLUS the shadow. Round 3 measured it: at a 2-luma threshold
       the day pair reported 122,953 darkened pixels — and 75,334 BRIGHTENED
       ones, over a bbox covering the entire frame. A cast shadow is one-sided
       and local; that is the rain. So each arm is photographed TWICE and the
       second frame is diffed against the first at the same thresholds, which
       is the floor every number in this report has to clear to mean
       anything. */
    await page.waitForTimeout(1200);
    arms[(on ? 'on-' : 'off-') + time + '-aa'] = await shot((on ? 'on-' : 'off-') + time + '-aa');
  }
}
await browser.close(); srv.close();

/* ── diff ──────────────────────────────────────────────────────────────── */
async function raw(f) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}
async function diff(aF, bF, label) {
  const A = await raw(aF), B = await raw(bF);
  const { width: W, height: H, channels: C } = A.info;
  let moved = 0, moved8 = 0, sumD = 0, sx = 0, sy = 0, maxD = 0;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const colMoved = new Array(W).fill(0), rowMoved = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const la = 0.299 * A.data[i] + 0.587 * A.data[i + 1] + 0.114 * A.data[i + 2];
      const lb = 0.299 * B.data[i] + 0.587 * B.data[i + 1] + 0.114 * B.data[i + 2];
      const d = lb - la;                 /* control minus shadow: positive = darkened */
      if (d > 8) moved8++;
      if (d > 2) {
        moved++; sumD += d; sx += x; sy += y;
        if (d > maxD) maxD = d;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        colMoved[x]++; rowMoved[y]++;
      }
    }
  }
  return {
    label, movedPx: moved, movedPx_gt8: moved8, pctOfFrame: +(100 * moved / (W * H)).toFixed(2),
    meanDarkening: +(sumD / Math.max(1, moved)).toFixed(2), maxDarkening: +maxD.toFixed(1),
    centroid: moved ? [Math.round(sx / moved), Math.round(sy / moved)] : null,
    bbox: moved ? [minX, minY, maxX, maxY] : null,
    lowestRow: rowMoved.reduce((acc, n, i) => n > 0 ? i : acc, -1),
  };
}
async function boxMean(f, B) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const { width: W, channels: C } = info;
  let R = 0, G = 0, Bl = 0, n = 0;
  for (let y = B[1]; y < B[1] + B[3]; y++) for (let x = B[0]; x < B[0] + B[2]; x++) {
    const i = (y * W + x) * C; R += data[i]; G += data[i + 1]; Bl += data[i + 2]; n++;
  }
  R /= n; G /= n; Bl /= n;
  const f2 = v => +v.toFixed(2);
  return { R: f2(R), G: f2(G), B: f2(Bl), L: f2(0.299 * R + 0.587 * G + 0.114 * Bl),
    RmB: f2(R - Bl), chroma: f2(Math.max(R, G, Bl) - Math.min(R, G, Bl)) };
}
const day = await diff(arms['on-day'], arms['off-day'], 'day');
const dusk = await diff(arms['on-dusk'], arms['off-dusk'], 'dusk');
/* the floor: the same count between two frames of the SAME arm. */
const aaDay = await diff(arms['on-day-aa'], arms['on-day'], 'aa-day');
const aaDusk = await diff(arms['on-dusk-aa'], arms['on-dusk'], 'aa-dusk');
const onBox = await boxMean(arms['on-day'], BOX);
const offBox = await boxMean(arms['off-day'], BOX);
const onRef = await boxMean(arms['on-day'], REF);
const hue = {
  box: BOX, tableRef: REF,
  shadowOn: onBox, shadowOff: offBox, tableBelow: onRef,
  lumaDelta: +(offBox.L - onBox.L).toFixed(2),
  /* ⚠ REPORTED AT BOTH THRESHOLDS, AND THE >8 ONE IS THE HONEST ONE. At >2
     the A/A control below is a large fraction of the day count, so that ratio
     is measuring rain as much as shadow; at >8 the control is small and the
     ratio is the shadow's. Round 2's quoted 1.76 was a >2 number taken before
     this control existed — it is kept here so the two rounds can still be
     compared on the same (contaminated) measure, not because it is the better
     one. */
  duskOverDayMoved: +(dusk.movedPx / Math.max(1, day.movedPx)).toFixed(2),
  duskOverDayMoved_gt8: +(dusk.movedPx_gt8 / Math.max(1, day.movedPx_gt8)).toFixed(2),
  animationFloor: { day: { gt2: aaDay.movedPx, gt8: aaDay.movedPx_gt8 },
    dusk: { gt2: aaDusk.movedPx, gt8: aaDusk.movedPx_gt8 } },
  /* …and the same ratio with the floor taken off each end, which is the single
     number to quote if only one is quoted. */
  duskOverDayMoved_gt8_netOfFloor: +((dusk.movedPx_gt8 - aaDusk.movedPx_gt8)
    / Math.max(1, day.movedPx_gt8 - aaDay.movedPx_gt8)).toFixed(2),
  pass: {
    'abs(R-B) <= 10': Math.abs(onBox.RmB) <= 10,
    'chroma <= 12': onBox.chroma <= 12,
    'lumaDelta >= 15': (offBox.L - onBox.L) >= 15,
    'dusk/day moved >= 1.6 (>2, contaminated)': (dusk.movedPx / Math.max(1, day.movedPx)) >= 1.6,
    'dusk/day moved >= 1.6 (>8, above the floor)': (dusk.movedPx_gt8 / Math.max(1, day.movedPx_gt8)) >= 1.6,
    'dusk/day moved >= 1.6 (>8, net of floor)':
      ((dusk.movedPx_gt8 - aaDusk.movedPx_gt8) / Math.max(1, day.movedPx_gt8 - aaDay.movedPx_gt8)) >= 1.6,
  },
};
console.log(JSON.stringify({ day, dusk, hue }, null, 1));
