/* CRIT-P5-ROUND2B — two things round 2A could not settle:
     1  IS THE CARD REACHABLE THE WAY A PLAYER REACHES IT? Not __nc.inspect(k):
        a real pointer event on the canvas, at the screen point the badge layer
        itself pins to that building (plotIconAnchor → project through the LIVE
        camera). If the click opens the dossier and the mood card is in it, the
        feature is reachable; if only the seam opens it, it is a diagnostic.
     2  A CLEAN PHOTOGRAPH OF THE CARD. Both existing shots are dimmed behind
        a gcConfirm modal left open by the seeding placement, so neither shows
        the card the check is about.                                          */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const SHOTS = path.resolve(process.cwd(), '.gauntlet/shots/critp5r2');
fs.mkdirSync(SHOTS, { recursive: true });
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
let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  PASS ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
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

/* Seed by DIRECT TILE WRITE only — nc.place() opens a gcConfirm modal that
   never closes in a headless run and dims every screenshot after it. */
const seeded = await page.evaluate(() => {
  const nc = window.__nc, B = nc.BUILDINGS, g = nc.game;
  const pick = (fn) => Object.keys(B).find((t) => { const d = B[t];
    return d && !d.decor && !d.opType && !d.edgeOnly && fn(d, t); });
  const home = pick((d) => (d.popCap | 0) > 0);
  const shop = pick((d) => d.gen && d.gen.cinder);
  for (let i = 0; i < 4; i++) g.tiles[(4 + i) + ',4'] = { type: home, lvl: 1 };
  g.tiles['16,16'] = { type: shop, lvl: 1 };
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('crit'); } catch (e) {}
  try { window.MythicPlotIcons.show(); } catch (e) {}
  return { tiles: Object.keys(g.tiles).length, home, shop };
});
console.log('seed: ' + JSON.stringify(seeded));
await page.waitForTimeout(1500);

/* ── 1. REACHABLE BY A REAL CLICK ─────────────────────────────────────── */
console.log('\n1. a real pointer click on the building, at the badge anchor');
const aim = await page.evaluate(() => {
  const nc = window.__nc;
  const { camera, renderer } = nc.three();
  const PM = window.MythicPlotMood;
  let t = null;
  for (const m of PM.all()) { const v = nc.plotMoodKey(m.k); if (v && v.face === 'frown') { t = { k: m.k, v }; break; } }
  if (!t) return null;
  const c = t.k.indexOf(','), x = +t.k.slice(0, c), z = +t.k.slice(c + 1);
  const a = nc.plotIconAnchor(x, z);
  if (!a) return null;
  const V = new (nc.three().THREE.Vector3)(a.x, a.y, a.z);
  V.project(camera);
  const cv = renderer.domElement, r = cv.getBoundingClientRect();
  return { k: t.k, reason: t.v.reason,
           px: r.left + (V.x * 0.5 + 0.5) * r.width,
           py: r.top + (-V.y * 0.5 + 0.5) * r.height + 24 /* a badge floats ABOVE the roof; aim at the roof */ };
});
console.log('   ' + JSON.stringify(aim));
/* A badge floats above the roof and the roof is not the tile: sweep DOWN from
   the anchor in 12 px steps and stop at the first click that opens the card.
   The offset that works is reported — a reachability test that only tries one
   pixel proves nothing when it misses. */
let hitAt = null;
if (aim) {
  for (let dy = 0; dy <= 120 && !hitAt; dy += 12) {
    await page.mouse.move(aim.px, aim.py + dy);
    await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up();
    await page.waitForTimeout(500);
    const got = await page.evaluate(() => {
      const c = document.getElementById('pmcard');
      const r = c && c.querySelector('[data-pm-reason]');
      return c ? { reason: r ? r.getAttribute('data-pm-reason') : null } : null;
    });
    if (got) hitAt = { dy, ...got };
  }
}
console.log('   first click that opened the card: ' + JSON.stringify(hitAt));
const afterClick = await page.evaluate(() => {
  const card = document.getElementById('pmcard');
  const row = card && card.querySelector('[data-pm-reason]');
  return { cardInDom: !!card, reason: row ? row.getAttribute('data-pm-reason') : null,
           face: row ? row.getAttribute('data-pm-face') : null,
           num: row ? (row.querySelector('.pmn') || {}).textContent : null,
           fix: row ? ((row.querySelector('.pmfix') || {}).textContent || '').slice(0, 110) : null,
           modalOpen: !!document.querySelector('.gc-confirm, .confirm, #gcconfirm') };
});
console.log('   ' + JSON.stringify(afterClick));
ok('clicking the building in the 3D scene opens the mood card', afterClick.cardInDom,
   'reason=' + afterClick.reason);

/* ── 2. A CLEAN PHOTOGRAPH ────────────────────────────────────────────── */
if (!afterClick.cardInDom) {
  const k = aim ? aim.k : null;
  if (k) await page.evaluate((kk) => window.__nc.inspect(kk), k);
  await page.waitForTimeout(800);
}
const el = await page.$('#pmcard');
if (el) await el.screenshot({ path: path.join(SHOTS, 'moodcard-clean.png') });
await page.screenshot({ path: path.join(SHOTS, 'inspector-clean.png') });
const txt = await page.evaluate(() => { const c = document.getElementById('pmcard'); return c ? c.textContent.replace(/\s+/g, ' ').slice(0, 500) : null; });
console.log('\n2. the card, as text:\n   ' + txt);

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
} finally { await browser.close(); server.close(); }
