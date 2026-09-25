/* CRIT-P5-ROUND2C — the one-line proof that pmLayerOn() is reading the wrong
   module. Same page, same tiles, twice:
     RED   as shipped — pmLayerOn() asks MythicPlotMood.layerVisible(), which
           /src/plotmood/index.js:95 documents as ALWAYS FALSE in a normal boot
           because overlay.js took the painter.
     GREEN with layerVisible() monkey-patched to MythicPlotIcons.visible() —
           the accessor node-city itself already uses at :27475 and :30210.
   The count of cards that reconcile the roof glyph with their own headline
   must go 0 → N. If it does not, the finding is wrong.                       */
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
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
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
await page.evaluate(() => {
  const nc = window.__nc, B = nc.BUILDINGS, g = nc.game;
  const pick = (fn) => Object.keys(B).find((t) => { const d = B[t]; return d && !d.decor && !d.opType && !d.edgeOnly && fn(d, t); });
  const home = pick((d) => (d.popCap | 0) > 0);
  for (let i = 0; i < 4; i++) g.tiles[(4 + i) + ',4'] = { type: home, lvl: 1, damaged: i === 0 };
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('crit'); } catch (e) {}
  try { window.MythicPlotIcons.show(); } catch (e) {}
});
await page.waitForTimeout(1500);
const scan = () => page.evaluate(() => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  let should = 0, claimed = 0;
  for (const m of PM.all()) {
    const v = nc.plotMoodKey(m.k); if (!v) continue;
    if (v.fromPill && v.base && v.base.reason !== 'ok') {
      should++; nc.inspect(m.k);
      const c = document.getElementById('pmcard');
      if (c && c.textContent.indexOf('glyph over the roof') >= 0) claimed++;
    }
  }
  return { should, claimed, badgesVisible: window.MythicPlotIcons.visible(),
           badges: (window.MythicPlotIcons.drawn() || []).length,
           moodLayerVisible: window.MythicPlotMood.layerVisible() };
});
console.log('RED   (as shipped):        ' + JSON.stringify(await scan()));
await page.evaluate(() => { window.MythicPlotMood.layerVisible = () => window.MythicPlotIcons.visible(); });
console.log('GREEN (one-line fix):     ' + JSON.stringify(await scan()));
await page.evaluate(() => { window.MythicPlotIcons.hide(); });
console.log('CONTROL (badges hidden):  ' + JSON.stringify(await scan()));
} finally { await browser.close(); server.close(); }
