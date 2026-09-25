import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const PUB = 'E:/game-deploy/public';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(PUB, p);
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); res.end(b); });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const shotSrc = fs.readFileSync('E:/game-deploy/.gauntlet/tabletop/shot.mjs', 'utf8');
const pure = shotSrc.slice(0, shotSrc.indexOf('const payload =')).replace(/^import.*$/gm, '');
const payload = new Function('process', pure + ';return JSON.stringify({cols:COLS,rows:ROWS,tiles});')(
  { argv: ['node', 'shot', 'a.png', '--scene', 'mixed'] });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:' + PORT + '/battle-board/index.html', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(7000);
await page.evaluate(js => eval(js), `window.postMessage({type:'board:map',map:${payload}},location.origin)`);
await page.waitForTimeout(4000);
const out = {};
for (const t of ['day', 'dusk']) {
  await page.evaluate(x => { try { setTimeOfDay(x); } catch (e) { } }, t);
  await page.waitForTimeout(3500);
  out[t] = await page.evaluate(() => {
    const lv = lightVector(), be = boardExtent(), ge = groundExtent();
    const PLINTH_H = 0.62;   /* read off vista.js for the len formula */
    const len = Math.max(PLINTH_H * 0.4, Math.min(PLINTH_H * 3.2, PLINTH_H / (lv.y + 0.22)));
    const f = v => +v.toFixed(3);
    /* screen span of the two quads */
    const proj = (x, z) => { const p = project(gp(x, z, -0.02)); return p ? [Math.round(p.x), Math.round(p.y)] : null; };
    return { lv: { x: f(lv.x), y: f(lv.y), z: f(lv.z) }, elev: f(LIGHT.elev), az: f(LIGHT.az),
      len: f(len), offset: { ox: f(-lv.x * len), oz: f(-lv.z * len) },
      boardExtent: { x: f(be.x), z: f(be.z) },
      groundExtent: { x: f(ge.x), near: f(ge.near), far: f(ge.far) },
      wall: CONFIG.wall,
      groundQuadScreen: { fl: proj(-ge.x, -ge.far), fr: proj(ge.x, -ge.far), nl: proj(-ge.x, ge.near), nr: proj(ge.x, ge.near) },
      boardQuadScreen: { fl: proj(-be.x, -be.z), fr: proj(be.x, -be.z), nl: proj(-be.x, be.z), nr: proj(be.x, be.z) },
      viewport: [innerWidth, innerHeight] };
  });
}
console.log(JSON.stringify(out, null, 1));
await browser.close(); srv.close();
