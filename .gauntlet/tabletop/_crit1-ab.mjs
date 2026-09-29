/* CRITIC round 1, piece `table-and-shadow`. Independent ablation.
   Renders shadow ON vs OFF at day and dusk, plus an A/A control for the
   animation floor, and reports:
     - where the darkening is (bbox, centroid, per-row profile)
     - how much of it is VISIBLE, i.e. not under the card rail and not inside
       the lattice
     - length at day vs dusk
   Writes the on/off pair and an amplified diff so the shape can be opened. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PUB = 'E:/game-deploy/public';
const OUT = 'C:/Users/sethi/AppData/Local/Temp/claude/E--game-deploy/4aad5554-09a5-412c-a875-a96a5851793c/scratchpad/';
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

/* geometry + the card rail rect, read off the live page. */
const geom = await page.evaluate(() => {
  const o = {};
  const pr = p => p ? [Math.round(p.x), Math.round(p.y)] : null;
  try { o.light = lightVector(LIGHT); } catch (e) { o.light = String(e); }
  try {
    const L = lipRect();
    o.footScreen = L.foot.map(c => pr(project({ x: c.x, y: 0, z: c.z })));
    o.inScreen = L.in.map(c => pr(project({ x: c.x, y: 0, z: c.z })));
  } catch (e) { o.lip = String(e); }
  try { o.boardExtent = boardExtent(); } catch (e) { }
  try {
    const el = document.querySelector('.hand, #hand, .card-rail, .bb-hand');
    if (el) { const r = el.getBoundingClientRect(); o.railRect = [r.x | 0, r.y | 0, r.width | 0, r.height | 0]; }
  } catch (e) { }
  return o;
});

async function rebake() {
  await page.setViewportSize({ width: 1601, height: 900 });
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(8000);
}
async function arm(on, time) {
  await page.evaluate(t => { try { setTimeOfDay(t); } catch (e) { } }, time);
  await page.waitForTimeout(3200);
  await page.evaluate(v => { window.__vistaOff = v ? {} : { boardshadow: 1 }; try { TERR.key = ''; } catch (e) { } }, on);
  await rebake();
}
const shot = async n => { const p = OUT + 'crit1-' + n + '.png'; await page.screenshot({ path: p }); return p; };

const arms = {};
for (const time of ['day', 'dusk']) {
  for (const on of [true, false]) {
    await arm(on, time);
    arms[(on ? 'on-' : 'off-') + time] = await shot((on ? 'on-' : 'off-') + time);
    await page.waitForTimeout(1200);
    if (on) arms['aa-' + time] = await shot('aa-' + time);
  }
}
await browser.close(); srv.close();

const raw = async f => await sharp(f).raw().toBuffer({ resolveWithObject: true });

function inPoly(px, py, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

async function map(onF, offF, out, thresh) {
  const A = await raw(onF), B = await raw(offF);
  const { width: W, height: H, channels: C } = A.info;
  const px = Buffer.alloc(W * H * 3);
  let n = 0, sx = 0, sy = 0, peak = 0, top = 1e9, lowest = -1, left = 1e9, right = -1;
  let inLat = 0, underRail = 0, visible = 0;
  const lat = geom.inScreen && geom.inScreen.every(Boolean) ? geom.inScreen : null;
  const rail = geom.railRect;
  const rowN = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C, j = (y * W + x) * 3;
    const la = 0.299 * A.data[i] + 0.587 * A.data[i + 1] + 0.114 * A.data[i + 2];
    const lb = 0.299 * B.data[i] + 0.587 * B.data[i + 1] + 0.114 * B.data[i + 2];
    const d = lb - la;
    const g = Math.max(0, Math.min(255, d * 10));
    const r = Math.max(0, Math.min(255, -d * 10));
    px[j] = Math.max(g, r); px[j + 1] = g; px[j + 2] = g;
    if (d > thresh) {
      n++; sx += x; sy += y; rowN[y]++;
      if (d > peak) peak = d;
      if (y > lowest) lowest = y; if (y < top) top = y;
      if (x < left) left = x; if (x > right) right = x;
      const isLat = lat && inPoly(x, y, lat);
      const isRail = rail && x >= rail[0] && x < rail[0] + rail[2] && y >= rail[1] && y < rail[1] + rail[3];
      if (isLat) inLat++; else if (isRail) underRail++; else visible++;
    }
  }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(OUT + out);
  return {
    out, thresh, pxOver: n, peak: +peak.toFixed(1),
    centroid: n ? [Math.round(sx / n), Math.round(sy / n)] : null,
    bbox: n ? [left, top, right, lowest] : null,
    inLattice: inLat, underRail, visibleOnTable: visible,
    topRows: rowN.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]).slice(0, 5)
  };
}

const out = { geom, arms };
out.day = await map(arms['on-day'], arms['off-day'], 'crit1-map-day.png', 4);
out.dusk = await map(arms['on-dusk'], arms['off-dusk'], 'crit1-map-dusk.png', 4);
out.aaFloorDay = await map(arms['on-day'], arms['aa-day'], 'crit1-map-aa-day.png', 4);
out.aaFloorDusk = await map(arms['on-dusk'], arms['aa-dusk'], 'crit1-map-aa-dusk.png', 4);
console.log(JSON.stringify(out, null, 1));
