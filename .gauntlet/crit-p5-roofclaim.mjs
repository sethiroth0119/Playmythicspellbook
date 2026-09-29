/* One counted probe: the card may only say "the 😟 glyph over the roof is
   reading X" when that glyph is ON SCREEN. MythicPlotMood.layer() no-ops while
   the roof-glyph layer object is null (P4 owns mounting it), so before this
   gate the sentence asserted something the player could not see.
   Counts cards that make the claim while MythicPlotMood.layerVisible() is
   false — must be 0. */
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
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'nf' });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
try {
await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);

const r = await page.evaluate(async () => {
  const nc = window.__nc, g = nc.game, B = nc.BUILDINGS, PM = window.MythicPlotMood;
  const raced = (p) => Promise.race([Promise.resolve(p), new Promise((rr) => setTimeout(() => rr(false), 1200))]);
  for (const k in g.res) g.res[k] = 99999;
  const pick = (fn) => Object.keys(B).find((t) => { const d = B[t]; return d && !d.decor && !d.opType && !d.edgeOnly && fn(d, t); });
  const home = pick((d) => (d.popCap | 0) > 0);
  const plan = [[home, 8, 8], [home, 9, 8], [home, 10, 8], [home, 8, 9]];
  for (const [t, x, z] of plan) {
    const k = x + ',' + z;
    if (!g.tiles[k]) { try { await raced(nc.place(t, x, z)); } catch (e) {} }
    if (!g.tiles[k]) g.tiles[k] = { type: t, lvl: 1 };
  }
  /* A wreck and a construction site: the hard-pill path is the ONLY path that
     reaches the clause (it is gated on v.fromPill). Filtered to real buildings
     the same way drive-moodwhy does it — the boot board's first key is decor
     and setting `damaged` on it produces no pill at all, which made the first
     version of this probe pass vacuously with fromPill=0. */
  const built = Object.keys(g.tiles).filter((k) => {
    const d = B[g.tiles[k].type];
    return d && !d.decor && (d.popCap || d.gen || d.svc || d.crew);
  });
  if (built[0]) g.tiles[built[0]].damaged = true;
  if (built[1]) g.tiles[built[1]].bld = { k: 0, s: Date.now(), d: 99999 };
  try { nc.coverage(); } catch (e) {}
  try { PM.invalidate('crit-roof'); } catch (e) {}
  await new Promise((rr) => setTimeout(rr, 600));

  const CLAIM = 'glyph over the roof';
  let judged = 0, fromPill = 0, claims = 0, claimsWhileHidden = 0;
  for (const m of PM.all()) {
    const v = nc.plotMoodKey(m.k);
    if (!v) continue;
    judged++;
    if (v.fromPill && v.base && v.base.reason !== 'ok') fromPill++;
    nc.inspect(m.k);
    const card = document.getElementById('pmcard');
    const txt = card ? (card.textContent || '') : '';
    const claimed = txt.indexOf(CLAIM) >= 0;
    if (claimed) claims++;
    if (claimed && !PM.layerVisible()) claimsWhileHidden++;
  }
  return { judged, fromPill, claims, claimsWhileHidden, layerVisible: PM.layerVisible(),
           layerToggled: nc.plotMoodLayer ? nc.plotMoodLayer(true) : null,
           layerVisibleAfterToggle: PM.layerVisible() };
});
console.log(JSON.stringify(r, null, 1));
console.log('\nCARDS CLAIMING A ROOF GLYPH WHILE THE LAYER IS HIDDEN: ' + r.claimsWhileHidden + '  (must be 0)');
console.log('cards that would have made the claim ungated (fromPill && base!=ok): ' + r.fromPill);
process.exitCode = r.claimsWhileHidden === 0 ? 0 : 1;
} finally { await browser.close(); server.close(); }
