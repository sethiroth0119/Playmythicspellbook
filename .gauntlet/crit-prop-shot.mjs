/* CRIT-PROP-SHOT — stop inferring, look. Put ONE ruin on ONE mid-board tile,
   drive frame() directly (no rAF), and screenshot the stage cropped to that
   tile with the hex's own footprint printed alongside in the same CSS px, so
   "does it overhang" is answered by the picture and a ruler, not by a diff
   whose threshold I chose.  node .gauntlet/crit-prop-shot.mjs */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const OUT  = path.resolve('D:/game-deploy', 'tmp');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8700 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.route('**/*', r => { const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort(); });
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
await page.waitForTimeout(5000);
await page.evaluate(() => {
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null); App.screen = 'battle'; render();
});
await page.waitForTimeout(7000);

const KINDS = ['school', 'hospital', 'car', 'house', 'church'];
for (const kind of KINDS) {
  const geo = await page.evaluate(async (kind) => {
    const host = document.querySelector('iframe.bb-stage');
    const w = host.contentWindow;
    const map = w.Board.map;
    const X = Math.floor(map.cols / 2), Z = Math.floor(map.rows / 2);
    /* one ruin, on that tile, sent the way the game sends them */
    w.postMessage({ type: 'board:structs', list: [{ x: X, z: Z, kind, lootable: false, looted: false, risk: null }] }, '*');
    await new Promise(r => setTimeout(r, 200));
    const wp = w.gw(X, Z, w.tileElev(X, Z));
    const foot = w.project({ x: wp.x, y: wp.y, z: wp.z });
    const hexHalf = w.ringPx(foot, w.tileR());
    const poly = w.__bbDebug.quads().poly[X + ',' + Z];      // the tile's SIX drawn corners

    /* 🔴 frame() driven DIRECTLY with a rising t, and the crop is lifted in the
       SAME TASK. page.screenshot() is useless here — it waits for a composited
       frame and the pane composites at ~0.56 Hz, so it times out. The stage is
       a 2D canvas, so its backing store is readable straight after frame(). */
    const cv = w.document.getElementById('stage');
    const dpr = cv.width / parseFloat(cv.style.width);
    const padX = hexHalf * 2.8, up = hexHalf * 5.4, dn = hexHalf * 1.4;
    const K = 4;                                     // magnify, nearest-neighbour
    const sx = (foot.x - padX) * dpr, sy = (foot.y - up) * dpr;
    const sw = padX * 2 * dpr, sh = (up + dn) * dpr;
    const off = w.document.createElement('canvas');
    off.width = Math.round(padX * 2 * K); off.height = Math.round((up + dn) * K);
    const oc = off.getContext('2d'); oc.imageSmoothingEnabled = false;

    let t = 500000; for (let i = 0; i < 4; i++) { t += 16.7; w.frame(t); }
    oc.drawImage(cv, sx, sy, sw, sh, 0, 0, off.width, off.height);
    /* the hex's own footprint, drawn ON THE CROP as a ruler — magenta hexagon
       and a centre tick. Nothing is drawn on the board itself. */
    oc.strokeStyle = '#ff00ff'; oc.lineWidth = 2; oc.beginPath();
    poly.forEach((p, i) => { const x = (p.x - (foot.x - padX)) * K, y = (p.y - (foot.y - up)) * K;
                             i ? oc.lineTo(x, y) : oc.moveTo(x, y); });
    oc.closePath(); oc.stroke();
    oc.strokeStyle = '#00ffff'; oc.beginPath();
    oc.moveTo(padX * K, 0); oc.lineTo(padX * K, off.height); oc.stroke();
    const hr = host.getBoundingClientRect();
    return { X, Z, footX: foot.x, footY: foot.y, hexHalf,
             polyMinX: Math.min(...poly.map(p => p.x)), polyMaxX: Math.max(...poly.map(p => p.x)),
             png: off.toDataURL('image/png') };
  }, kind);

  const file = path.join(OUT, 'prop-' + kind + '.png');
  fs.writeFileSync(file, Buffer.from(geo.png.split(',')[1], 'base64'));
  console.log(kind.padEnd(9) +
    ' tile hex spans x ' + geo.polyMinX.toFixed(1) + '..' + geo.polyMaxX.toFixed(1) +
    ' (width ' + (geo.polyMaxX - geo.polyMinX).toFixed(1) + 'px, inradius ' + geo.hexHalf.toFixed(1) +
    ', foot x ' + geo.footX.toFixed(1) + ')  -> ' + file);
}
await browser.close(); server.close();
