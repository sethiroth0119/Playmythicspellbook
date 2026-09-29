/* CRITIC round-3 independent probe for table-and-shadow.
   Renders the frozen `mixed` fixture with the board shadow ON and ABLATED
   (window.__vistaOff.boardshadow), at `day` and `dusk`, plus an A/A control
   frame per arm so the animated rain/braziers can be subtracted.
   Writes a signed heatmap PNG per time so a human can LOOK at the shape.  */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PUB = 'E:/game-deploy/public';
const OUT = 'E:/game-deploy/.gauntlet/tabletop/_crit3/';
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

async function rebake() {
  await page.setViewportSize({ width: 1601, height: 900 });
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(8000);
}
async function arm(on, time) {
  await page.evaluate(t => { try { setTimeOfDay(t); } catch (e) { } }, time);
  await page.waitForTimeout(3200);
  await page.evaluate(o => { window.__vistaOff = o ? {} : { boardshadow: 1 }; }, on);
  await rebake();
}
const shot = async n => { const p = OUT + '_c3-' + n + '.png'; await page.screenshot({ path: p }); return p; };

const facts = {};
const arms = {};
for (const time of ['day', 'dusk']) {
  await arm(true, time);
  facts[time] = await page.evaluate(() => {
    const lv = lightVector();
    return { lv: { x: +lv.x.toFixed(4), y: +lv.y.toFixed(4), z: +lv.z.toFixed(4) },
      az: +LIGHT.az.toFixed(4), elev: +LIGHT.elev.toFixed(4), keyI: LIGHT.keyI };
  });
  arms['on-' + time] = await shot('on-' + time);
  await page.waitForTimeout(1500);
  arms['aa-' + time] = await shot('aa-' + time);
  await arm(false, time);
  arms['off-' + time] = await shot('off-' + time);
}
await browser.close(); srv.close();

const raw = async f => { const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };

async function analyse(onF, offF, aaF, tag) {
  const A = await raw(onF), B = await raw(offF), C = await raw(aaF);
  const { width: W, height: H, channels: CH } = A.info;
  const heat = Buffer.alloc(W * H * 3);
  let n = 0, sx = 0, sy = 0, sum = 0, maxD = 0, aaN = 0;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const rowN = new Array(H).fill(0), colN = new Array(W).fill(0);
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * CH, j = (y * W + x) * 3;
    const d = L(B.data, i) - L(A.data, i);     /* +ve = shadow darkened it   */
    const a = Math.abs(L(C.data, i) - L(A.data, i)); /* animation floor       */
    if (a > 8) aaN++;
    if (d > 8) {
      n++; sx += x; sy += y; sum += d; if (d > maxD) maxD = d;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      rowN[y]++; colN[x]++;
      heat[j] = Math.min(255, d * 6); heat[j + 1] = 0; heat[j + 2] = 0;
    } else if (d < -8) { heat[j] = 0; heat[j + 1] = 0; heat[j + 2] = Math.min(255, -d * 6); }
    else { const v = L(A.data, i) * 0.35 | 0; heat[j] = heat[j + 1] = heat[j + 2] = v; }
  }
  await sharp(heat, { raw: { width: W, height: H, channels: 3 } }).png().toFile(OUT + '_c3-heat-' + tag + '.png');
  /* where does the darkening live vertically / horizontally */
  const band = k => { const o = []; for (let i = 0; i < k.length; i += 50) o.push(k.slice(i, i + 50).reduce((a, b) => a + b, 0)); return o; };
  return { tag, movedPx_gt8: n, animFloor_gt8: aaN, meanDarkening: +(sum / Math.max(1, n)).toFixed(2),
    maxDarkening: +maxD.toFixed(1), centroid: n ? [Math.round(sx / n), Math.round(sy / n)] : null,
    bbox: n ? [minX, minY, maxX, maxY] : null, rowBands50: band(rowN), colBands50: band(colN) };
}
async function boxMean(f, B) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const { width: W, channels: C } = info; let R = 0, G = 0, Bl = 0, n = 0;
  for (let y = B[1]; y < B[1] + B[3]; y++) for (let x = B[0]; x < B[0] + B[2]; x++) {
    const i = (y * W + x) * C; R += data[i]; G += data[i + 1]; Bl += data[i + 2]; n++;
  }
  R /= n; G /= n; Bl /= n; const f2 = v => +v.toFixed(2);
  return { R: f2(R), G: f2(G), B: f2(Bl), L: f2(0.299 * R + 0.587 * G + 0.114 * Bl),
    RmB: f2(R - Bl), chroma: f2(Math.max(R, G, Bl) - Math.min(R, G, Bl)) };
}
const day = await analyse(arms['on-day'], arms['off-day'], arms['aa-day'], 'day');
const dusk = await analyse(arms['on-dusk'], arms['off-dusk'], arms['aa-dusk'], 'dusk');
const BOX = [0, 742, 120, 45], REF = [0, 787, 120, 45];
console.log(JSON.stringify({ facts, day, dusk,
  duskOverDay_gt8: +(dusk.movedPx_gt8 / Math.max(1, day.movedPx_gt8)).toFixed(2),
  netOfFloor: +((dusk.movedPx_gt8 - dusk.animFloor_gt8) / Math.max(1, day.movedPx_gt8 - day.animFloor_gt8)).toFixed(2),
  box: { on: await boxMean(arms['on-day'], BOX), off: await boxMean(arms['off-day'], BOX), tableBelow: await boxMean(arms['on-day'], REF) },
}, null, 1));
