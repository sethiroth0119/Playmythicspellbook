/* CRIT-P5-ROUND2D — measure the legend/dossier collision seen in
   .gauntlet/shots/critp5r2/inspector-clean.png: with the badge layer on, does
   the "Plot mood" legend cover the mood card's "Limited by" value?
   Reported as a rectangle intersection in CSS px at three viewport widths, with
   the legend HIDDEN as the control.                                          */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'] });
try {
for (const vw of [1400, 1600, 1920]) {
  const page = await browser.newPage({ viewport: { width: vw, height: 900 } });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
      const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
      const f = path.join(THREE_DIR, rel);
      return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
                              : route.fulfill({ status: 404, body: 'nf' });
    }
    if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
    return route.abort();
  });
  await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(9000);
  const r = await page.evaluate(() => {
    const nc = window.__nc, g = nc.game, B = nc.BUILDINGS;
    const home = Object.keys(B).find((t) => B[t] && (B[t].popCap | 0) > 0 && !B[t].decor);
    for (let i = 0; i < 4; i++) g.tiles[(4 + i) + ',4'] = { type: home, lvl: 1 };
    try { nc.coverage(); } catch (e) {}
    try { window.MythicPlotMood.invalidate('crit'); } catch (e) {}
    const meas = () => {
      nc.inspect('4,4');
      const card = document.getElementById('pmcard');
      if (!card) return null;
      let val = null;
      for (const f of card.querySelectorAll('.fac'))
        if (((f.querySelector('.fac-l') || {}).textContent || '').indexOf('Limited by') >= 0) val = f.querySelector('.fac-v');
      const leg = document.querySelector('#pmlegend, .pm-legend, [id*="legend" i]');
      if (!val) return { noVal: true };
      const a = val.getBoundingClientRect();
      const b = leg ? leg.getBoundingClientRect() : null;
      const covered = b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
                          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
      return { legendId: leg ? (leg.id || leg.className) : null,
               legendShown: b ? (b.width > 0 && getComputedStyle(leg).display !== 'none') : false,
               valRect: [Math.round(a.left), Math.round(a.top), Math.round(a.width), Math.round(a.height)],
               coveredPx2: Math.round(covered), text: val.textContent.trim() };
    };
    try { window.MythicPlotIcons.show(); } catch (e) {}
    const on = meas();
    try { window.MythicPlotIcons.hide(); } catch (e) {}
    const off = meas();
    return { on, off };
  });
  console.log(vw + 'px  badges ON : ' + JSON.stringify(r.on));
  console.log(vw + 'px  CONTROL   : ' + JSON.stringify(r.off));
  await page.close();
}
} finally { await browser.close(); server.close(); }
