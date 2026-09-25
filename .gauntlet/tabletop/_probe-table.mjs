/* geometry probe for the table-and-shadow piece. Boots the board at 1600x900
   with a 14x12 map (the gauntlet fixture's shape) and reports every number the
   table + board shadow need: horizon, near edge, both extents, the light
   vector, and where the lattice / ground quads land on screen. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';


/* served straight from public/ — see boardshot.mjs for the same server. */
const PUB = 'E:/game-deploy/public';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.txt':'text/plain', '.webp':'image/webp',
  '.avif':'image/avif', '.gif':'image/gif', '.mp3':'audio/mpeg', '.woff2':'font/woff2' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(PUB, p);
  if (!path.resolve(f).startsWith(path.resolve(PUB))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end('404 ' + p); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(b);
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:' + PORT + '/battle-board/index.html', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(7000);

const tiles = [];
for (let z = 0; z < 12; z++) for (let x = 0; x < 14; x++) tiles.push({ x, z, surf: 'grass', elev: (x === 7 && z < 4) ? 1.02 : 0 });
await page.evaluate(m => window.postMessage({ type: 'board:map', map: m }, location.origin), { cols: 14, rows: 12, tiles });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const o = {};
  const P = p => { const q = project(p); return q ? { x: +q.x.toFixed(1), y: +q.y.toFixed(1) } : null; };
  o.W = W; o.H = H;
  o.VIEW = { cx: +VIEW.cx.toFixed(1), cy: +VIEW.cy.toFixed(1), scale: +VIEW.scale.toFixed(1), box: VIEW.box };
  o.MAP = { cols: MAP.cols, rows: MAP.rows, id: MAP.id, location: MAP.location };
  o.CONFIG_wall = CONFIG.wall;
  o.boardExtent = boardExtent();
  o.groundExtent = groundExtent();
  o.skirtRange = (typeof skirtRange === 'function') ? skirtRange() : null;
  o.lv = lightVector();
  o.LIGHT = { keyI: LIGHT.keyI, az: LIGHT.az, elev: LIGHT.elev, body: LIGHT.body, fog: LIGHT.fog, key: LIGHT.key, ambient: LIGHT.ambient };
  o.time = BATTLE.timeOfDay;
  o.horizonY = P({ x: 0, y: 0, z: -MAP.rows / 2 - (CONFIG.wall || 0) });
  o.nearY = P({ x: 0, y: 0, z: MAP.rows / 2 });
  const g = groundExtent(), b = boardExtent();
  o.apronQuad = [
    P(gp(-g.x - CONFIG.wall, -g.far - CONFIG.wall, -.02)),
    P(gp(g.x + CONFIG.wall, -g.far - CONFIG.wall, -.02)),
    P(gp(g.x + CONFIG.wall, g.near + CONFIG.wall, -.02)),
    P(gp(-g.x - CONFIG.wall, g.near + CONFIG.wall, -.02))];
  o.latticeQuad = [P({ x: -b.x, y: 0, z: -b.z }), P({ x: b.x, y: 0, z: -b.z }),
                   P({ x: b.x, y: 0, z: b.z }), P({ x: -b.x, y: 0, z: b.z })];
  o.tileR = (typeof tileR === 'function') ? tileR() : null;
  o.hexV = (typeof hexV === 'function') ? hexV() : null;
  o.BACKDROP = { hasImg: !!(BACKDROP.img && BACKDROP.img.complete), src: BACKDROP.img && BACKDROP.img.src };
  o.GROUND = { hasImg: !!(GROUND.img && GROUND.img.complete) };
  o.locKeys = Object.keys(LOCATIONS || {}).slice(0, 8);
  /* what colour is actually on screen at a few probe points */
  const cv = document.querySelector('canvas');
  const cx2 = cv.getContext('2d', { willReadFrequently: true });
  const pick = (x, y) => { try { const d = cx2.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; } catch (e) { return null; } };
  o.px = {};
  [[800, 880], [100, 870], [1500, 870], [800, 700], [40, 400], [1560, 400], [800, 215], [800, 120], [800, 40]]
    .forEach(([x, y]) => { o.px[x + ',' + y] = pick(x, y); });
  return o;
});
console.log(JSON.stringify({ out, logs: logs.slice(0, 10) }, null, 1));
await browser.close(); srv.close();
