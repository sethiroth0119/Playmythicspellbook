/* CRIT-P5b — two focused probes.
   A) "Limited by: DARK 0" — pmEnrich sets term.raw = n ? n.d : 0 for the three
      DISTANCE reasons (water/road/dark). When nothing of that kind exists
      anywhere, the distance is unbounded and the card prints 0 — which on a
      distance scale reads as "it is right here", the exact opposite. The same
      line also prints coverage percentages (HEALTH 38, POWER 92) where higher
      is better, with no unit on either. Counted, not argued.
   B) does the roof-glyph layer actually mount? The card's own closing sentence
      claims "the glyph over the roof is reading <reason>", so if the layer is
      never mounted that sentence points at nothing. */
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
  const nc = window.__nc, g = nc.game, B = nc.BUILDINGS;
  const raced = (p) => Promise.race([Promise.resolve(p), new Promise((rr) => setTimeout(() => rr(false), 1500))]);
  for (const k in g.res) g.res[k] = 99999;
  const pick = (fn) => Object.keys(B).find((t) => { const d = B[t]; return d && !d.decor && !d.opType && !d.edgeOnly && fn(d, t); });
  const home = pick((d) => (d.popCap | 0) > 0);
  // ONE house, far from everything, in a city with no roads and no lamps.
  for (const kk of Object.keys(g.tiles)) { /* leave the default board alone */ }
  const k = '19,19';
  if (!g.tiles[k]) { try { await raced(nc.place(home, 19, 19)); } catch (e) {} }
  if (!g.tiles[k]) g.tiles[k] = { type: home, lvl: 1 };
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('crit'); } catch (e) {}
  await new Promise((rr) => setTimeout(rr, 500));

  // sweep the whole board for the printed "Limited by" line
  const all = window.MythicPlotMood.all();
  const rows = [], zeroDistance = [];
  for (const m of all) {
    const c = m.k.indexOf(',');
    const v = nc.plotMood(+m.k.slice(0, c), +m.k.slice(c + 1));
    if (!v) continue;
    nc.inspect(m.k);
    const card = document.getElementById('pmcard');
    const txt = card ? (card.textContent || '').replace(/\s+/g, ' ') : '';
    const lim = /Limited by(.{0,24})/.exec(txt);
    rows.push({ k: m.k, reason: v.reason, valueTxt: v.valueTxt, limitedBy: v.limitedBy,
                printed: lim ? lim[1].trim() : null });
    // the defect: a DISTANCE reason whose own value says "none exist" but whose
    // Limited-by figure is 0 — which on a distance scale means "right here".
    const t = v.terms && v.terms.find((o) => o.short && ['WATER', 'ROAD', 'DARK'].includes(o.short));
    if (t && /^no (mains|roads|lamps)$/.test(String(t.valueTxt)) && t.raw === 0)
      zeroDistance.push({ k: m.k, short: t.short, valueTxt: t.valueTxt, raw: t.raw, limitedBy: v.limitedBy });
  }

  // B) the roof-glyph layer
  let layer = null;
  try {
    const on = nc.plotMoodLayer(true);
    const mesh = nc.plotMoodMesh();
    const PM = window.MythicPlotMood;
    layer = { toggled: on, mesh: !!mesh,
              mounted: typeof PM.mounted === 'function' ? PM.mounted() : null,
              visible: typeof PM.visible === 'function' ? PM.visible() : null,
              drawn: typeof PM.drawn === 'function' ? (PM.drawn() || []).length : null,
              keys: Object.keys(PM).slice(0, 40) };
  } catch (e) { layer = { err: String(e && e.message || e) }; }
  return { judged: all.length, rows, zeroDistance, layer };
});
console.log('judged: ' + r.judged);
console.log('\nrows (reason / value / the printed "Limited by" line):');
for (const x of r.rows.slice(0, 14)) console.log('  ' + JSON.stringify(x));
console.log('\nZERO-DISTANCE DEFECT COUNT: ' + r.zeroDistance.length);
for (const x of r.zeroDistance.slice(0, 8)) console.log('  ' + JSON.stringify(x));
console.log('\nroof-glyph layer: ' + JSON.stringify(r.layer, null, 1));
} finally { await browser.close(); server.close(); }
