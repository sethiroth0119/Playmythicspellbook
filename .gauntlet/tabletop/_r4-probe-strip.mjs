/* ROUND 4 — where does the board shadow actually LAND?
   Same rig as _probe-shadow-ab.mjs (same fixture, same ablation control, same
   A/A animation floor), with the round-4 clause added: the critic's gap is
   stated as a percentage of the OPEN TABLE STRIP in front of the board,
   y 581-681, which round 3 measured at 0.18 % darkened at BOTH day and dusk.
   So this reports that strip explicitly, at both thresholds, against the A/A
   floor, plus a row profile so the shadow's footprint can be read rather than
   asserted. Hue is re-measured in the strip too, because round 3's hue box
   (0,742,120,45) is a LOCATION and the whole point of this change is that the
   shadow is no longer there. */
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

const shotSrc = fs.readFileSync('E:/game-deploy/.gauntlet/tabletop/shot.mjs', 'utf8');
const pure = shotSrc.slice(0, shotSrc.indexOf('const payload =')).replace(/^import.*$/gm, '');
const payload = new Function('process', pure + ';return JSON.stringify({cols:COLS,rows:ROWS,tiles});')(
  { argv: ['node', 'shot', 'ab.png', '--scene', 'mixed'] });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:' + PORT + '/battle-board/index.html', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(7000);
await page.evaluate(js => eval(js), `window.postMessage({type:'board:map',map:${payload}},location.origin)`);
await page.waitForTimeout(3000);

/* the geometry the shadow is built from, read off the LIVE page — so the
   handoff quotes measured numbers and not numbers from a comment. */
const geom = await page.evaluate(() => {
  const b = boardExtent(), g = groundExtent(), tx = latticeCentreX();
  const lv = lightVector(LIGHT);
  const pr = (x, z) => { const p = project({ x, y: -0.02, z }); return p ? [Math.round(p.x), Math.round(p.y)] : null; };
  return {
    boardExtent: { x: +b.x.toFixed(2), z: +b.z.toFixed(2) }, latticeCentreX: +tx.toFixed(3),
    groundExtent: { x: +g.x.toFixed(2), near: +g.near.toFixed(2), far: +g.far.toFixed(2) },
    wall: CONFIG.wall, lightVector: { x: +lv.x.toFixed(3), y: +lv.y.toFixed(3), z: +lv.z.toFixed(3) },
    boardNearCorners: [pr(tx - (b.x + CONFIG.wall), b.z + CONFIG.wall), pr(tx + (b.x + CONFIG.wall), b.z + CONFIG.wall)],
    groundNearCorners: [pr(-(g.x + CONFIG.wall), g.near + CONFIG.wall), pr(g.x + CONFIG.wall, g.near + CONFIG.wall)],
  };
});

async function rebake() {
  await page.setViewportSize({ width: 1601, height: 900 });
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(8000);
}
async function arm(shadowOn, time) {
  await page.evaluate(t => { try { setTimeOfDay(t); } catch (e) { } }, time);
  await page.waitForTimeout(3200);
  await page.evaluate(on => { window.__vistaOff = on ? {} : { boardshadow: 1 }; }, shadowOn);
  await rebake();
}
async function shot(name) { const p = 'E:/game-deploy/.gauntlet/tabletop/_r4-' + name + '.png'; await page.screenshot({ path: p }); return p; }

const arms = {};
for (const time of ['day', 'dusk']) {
  for (const on of [true, false]) {
    await arm(on, time);
    arms[(on ? 'on-' : 'off-') + time] = await shot((on ? 'on-' : 'off-') + time);
    await page.waitForTimeout(1200);
    arms[(on ? 'on-' : 'off-') + time + '-aa'] = await shot((on ? 'on-' : 'off-') + time + '-aa');
  }
}
await browser.close(); srv.close();

const STRIP = [0, 581, 1600, 100];        /* the critic's open-table strip */
async function raw(f) { const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true }); return { data, info }; }
async function diff(aF, bF, label) {
  const A = await raw(aF), B = await raw(bF);
  const { width: W, height: H, channels: C } = A.info;
  let moved = 0, moved8 = 0, sumD = 0, sx = 0, sy = 0, maxD = 0;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  let sMoved = 0, sMoved8 = 0, sSum = 0;
  const rowMoved = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C;
    const la = 0.299 * A.data[i] + 0.587 * A.data[i + 1] + 0.114 * A.data[i + 2];
    const lb = 0.299 * B.data[i] + 0.587 * B.data[i + 1] + 0.114 * B.data[i + 2];
    const d = lb - la;                     /* control minus shadow: + = darkened */
    const inStrip = y >= STRIP[1] && y < STRIP[1] + STRIP[3];
    if (d > 8) { moved8++; if (inStrip) sMoved8++; }
    if (d > 2) {
      moved++; sumD += d; sx += x; sy += y; rowMoved[y]++;
      if (d > maxD) maxD = d;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (inStrip) { sMoved++; sSum += d; }
    }
  }
  const stripPx = STRIP[2] * STRIP[3];
  const prof = [];
  for (let y = 0; y < H; y += 25) { let n = 0; for (let k = y; k < Math.min(H, y + 25); k++) n += rowMoved[k]; if (n > 200) prof.push(y + ':' + n); }
  return {
    label, movedPx: moved, movedPx_gt8: moved8,
    meanDarkening: +(sumD / Math.max(1, moved)).toFixed(2), maxDarkening: +maxD.toFixed(1),
    centroid: moved ? [Math.round(sx / moved), Math.round(sy / moved)] : null,
    bbox: moved ? [minX, minY, maxX, maxY] : null,
    strip: { rect: STRIP, pctDarkened_gt2: +(100 * sMoved / stripPx).toFixed(2),
      pctDarkened_gt8: +(100 * sMoved8 / stripPx).toFixed(2),
      meanDarkening: +(sSum / Math.max(1, sMoved)).toFixed(2) },
    rowProfile_gt200: prof,
  };
}
async function boxMean(f, B) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const { width: W, channels: C } = info;
  let R = 0, G = 0, Bl = 0, n = 0;
  for (let y = B[1]; y < B[1] + B[3]; y++) for (let x = B[0]; x < B[0] + B[2]; x++) {
    const i = (y * W + x) * C; R += data[i]; G += data[i + 1]; Bl += data[i + 2]; n++;
  }
  R /= n; G /= n; Bl /= n; const f2 = v => +v.toFixed(2);
  return { R: f2(R), G: f2(G), B: f2(Bl), L: f2(0.299 * R + 0.587 * G + 0.114 * Bl),
    RmB: f2(R - Bl), chroma: f2(Math.max(R, G, Bl) - Math.min(R, G, Bl)) };
}
const day = await diff(arms['on-day'], arms['off-day'], 'day');
const dusk = await diff(arms['on-dusk'], arms['off-dusk'], 'dusk');
const aaDay = await diff(arms['on-day-aa'], arms['on-day'], 'aa-day');
const aaDusk = await diff(arms['on-dusk-aa'], arms['on-dusk'], 'aa-dusk');

/* hue, re-measured where the shadow now is. The box is the 120x45 patch of
   open table nearest the shadow's own centroid on the LEFT flank, so it is the
   same size and the same kind of place as round 3's (0,742,120,45). */
const HUEBOX = [0, 560, 120, 45], HUEREF = [0, 470, 120, 45];
const onBox = await boxMean(arms['on-day'], HUEBOX);
const offBox = await boxMean(arms['off-day'], HUEBOX);
const onRef = await boxMean(arms['on-day'], HUEREF);
const oldBOX = [0, 742, 120, 45];
const onOld = await boxMean(arms['on-day'], oldBOX), offOld = await boxMean(arms['off-day'], oldBOX);

console.log(JSON.stringify({
  geom, day, dusk,
  animationFloor: { day: { gt2: aaDay.movedPx, gt8: aaDay.movedPx_gt8, stripGt2: aaDay.strip.pctDarkened_gt2 },
    dusk: { gt2: aaDusk.movedPx, gt8: aaDusk.movedPx_gt8, stripGt2: aaDusk.strip.pctDarkened_gt2 } },
  duskOverDayMoved_gt8_netOfFloor: +((dusk.movedPx_gt8 - aaDusk.movedPx_gt8) / Math.max(1, day.movedPx_gt8 - aaDay.movedPx_gt8)).toFixed(2),
  hueNew: { box: HUEBOX, ref: HUEREF, shadowOn: onBox, shadowOff: offBox, tableAbove: onRef,
    lumaDelta: +(offBox.L - onBox.L).toFixed(2) },
  hueOldRound3Box: { box: oldBOX, shadowOn: onOld, shadowOff: offOld, lumaDelta: +(offOld.L - onOld.L).toFixed(2) },
}, null, 1));
