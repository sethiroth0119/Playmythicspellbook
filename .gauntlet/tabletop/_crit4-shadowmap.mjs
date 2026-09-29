/* CRITIC round 4, piece `table-and-shadow`.

   The written A/B rigs in this folder all report the shadow as a NUMBER in a
   120x45 box. The judgedBy clause is not a number — it asks whether the shadow
   reads as the board's footprint projected along lightVector, and where in the
   frame a player would see it. So this rig renders the same four arms as
   _probe-shadow-ab.mjs (shadow on/off x day/dusk, plus the A/A animation
   control) and writes the DIFFERENCE AS AN IMAGE, amplified, so the shape can
   be opened and looked at instead of inferred from a centroid.

   ⚠ Same two traps as the parent rig, kept verbatim:
     - the land bake is keyed on W|H|dpr|MAP and NOT on __vistaOff, so the flag
       alone changes nothing; the viewport nudge is what forces the re-bake.
     - the scene animates (rain + two braziers), so every diff carries an
       animation floor. The A/A frame is diffed with the identical amplifier so
       the floor is visible in the picture, not just in the count.                */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PUB = 'E:/game-deploy/public';
const OUT = 'E:/game-deploy/.gauntlet/tabletop/';
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

/* the geometry, read off the live page rather than off a comment. */
const geom = await page.evaluate(() => {
  const o = {};
  try { o.boardExtent = boardExtent(); } catch (e) { o.boardExtent = String(e); }
  try { o.groundExtent = groundExtent(); } catch (e) { o.groundExtent = String(e); }
  try { o.wall = CONFIG.wall; } catch (e) { }
  try { o.light = lightVector(LIGHT); } catch (e) { }
  /* where the two quads' NEAR corners land on screen — the strip question. */
  try {
    const g = groundExtent(), b = boardExtent();
    const pr = (u, v) => { const p = gp(u, v, 0); return p ? [Math.round(p.x), Math.round(p.y)] : null; };
    o.groundNear = [pr(-g.x, g.near), pr(g.x, g.near)];
    o.groundFar = [pr(-g.x, -g.far), pr(g.x, -g.far)];
    o.boardNear = [pr(-b.x, b.z), pr(b.x, b.z)];
  } catch (e) { o.proj = String(e); }
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
  await page.evaluate(v => { window.__vistaOff = v ? {} : { boardshadow: 1 }; }, on);
  await rebake();
}
const shot = async n => { const p = OUT + '_crit4-' + n + '.png'; await page.screenshot({ path: p }); return p; };

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

/* The map: control MINUS shadow, i.e. how much the shadow darkened each pixel,
   amplified x10 and written as grey. Brightening (rain, flames) is written to
   the RED channel so animation noise is visibly a different colour from the
   one-sided darkening a cast shadow makes. */
async function map(aF, bF, out) {
  const A = await raw(aF), B = await raw(bF);
  const { width: W, height: H, channels: C } = A.info;
  const px = Buffer.alloc(W * H * 3);
  let n = 0, sx = 0, sy = 0, lowest = -1, top = 1e9, left = 1e9, right = -1;
  const rowN = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C, j = (y * W + x) * 3;
    const la = 0.299 * A.data[i] + 0.587 * A.data[i + 1] + 0.114 * A.data[i + 2];
    const lb = 0.299 * B.data[i] + 0.587 * B.data[i + 1] + 0.114 * B.data[i + 2];
    const d = lb - la;
    const g = Math.max(0, Math.min(255, d * 10));
    const r = Math.max(0, Math.min(255, -d * 10));
    px[j] = Math.max(g, r); px[j + 1] = g; px[j + 2] = g;
    if (d > 4) { n++; sx += x; sy += y; rowN[y]++; if (y > lowest) lowest = y; if (y < top) top = y; if (x < left) left = x; if (x > right) right = x; }
  }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(OUT + out);
  return { out, pxOver4: n, centroid: n ? [Math.round(sx / n), Math.round(sy / n)] : null,
    bbox: n ? [left, top, right, lowest] : null,
    topRows: rowN.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]).slice(0, 6) };
}
async function boxMean(f, B) {
  const { data, info } = await raw(f);
  const { width: W, channels: C } = info;
  let R = 0, G = 0, Bl = 0, n = 0;
  for (let y = B[1]; y < B[1] + B[3]; y++) for (let x = B[0]; x < B[0] + B[2]; x++) {
    const i = (y * W + x) * C; R += data[i]; G += data[i + 1]; Bl += data[i + 2]; n++;
  }
  R /= n; G /= n; Bl /= n;
  const f2 = v => +v.toFixed(2);
  return { R: f2(R), G: f2(G), B: f2(Bl), L: f2(0.299 * R + 0.587 * G + 0.114 * Bl), RmB: f2(R - Bl), chroma: f2(Math.max(R, G, Bl) - Math.min(R, G, Bl)) };
}

const dayMap = await map(arms['on-day'], arms['off-day'], 'crit4-map-day.png');
const duskMap = await map(arms['on-dusk'], arms['off-dusk'], 'crit4-map-dusk.png');
const aaMap = await map(arms['on-day'], arms['aa-day'], 'crit4-map-AAfloor.png');
const BOX = [0, 742, 120, 45];
const out = {
  geom, dayMap, duskMap, aaMap,
  hueBox: { on: await boxMean(arms['on-day'], BOX), off: await boxMean(arms['off-day'], BOX) },
};
out.hueBox.lumaDelta = +(out.hueBox.off.L - out.hueBox.on.L).toFixed(2);
console.log(JSON.stringify(out, null, 1));
