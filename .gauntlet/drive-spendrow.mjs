/* ══════════════════════════════════════════════════════════════════════════
   🧍💸 DRIVE-SPENDROW — "show what the NPCs spent, on the building's panel".

   The building info panel answered only half of "what does this earn me": the
   tile's own gen rate, and nothing about customers. This adds a Customer spend
   row read from /src/economy's own firm records.

   WHAT HAS TO BE TRUE:
     1  A tile that owns a firm shows the row.
     2  The figure is the ECONOMY'S — it equals firms().revenueDay for that
        tile, sampled at the same instant. A panel that estimates takings from
        price x population would look right and drift forever.
     3  CONTROL — a tile that owns NO firm (a wall, a tree) shows NO row. This
        is the half that matters: a row reading "0 🔥 from 0 customers" on a
        Watchtower is a claim about a business that does not exist, and a check
        that only looked at the shop case would pass with that bug shipped.

   Run:  node .gauntlet/drive-spendrow.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8400 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three' });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 240)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* Seed a city with a shop the economy will actually found a firm for, plus a
   tile that is definitively NOT a business — the control. */
console.log('\n0. seed a shop and a non-business');
const seeded = await page.evaluate(async () => {
  const g = window.__nc.game;
  g.tiles['10,10'] = { type: 'grocery', lvl: 1 };
  g.tiles['12,10'] = { type: 'wall', lvl: 1 };
  g.tiles['11,11'] = { type: 'housing', lvl: 2 };
  g.tiles['9,10'] = { type: 'farm', lvl: 2 };
  // syncBuildings runs on the host's own interval; give it several passes
  await new Promise((r) => setTimeout(r, 14000));
  const E = window.MythicEconomy;
  let firms = [];
  try { firms = E.firms() || []; } catch (e) {}
  return { n: firms.length,
           shop: firms.filter((f) => f.tileKey === '10,10').map((f) => ({ ind: f.ind, rev: f.revenueDay, cust: f.customersDay })),
           wall: firms.filter((f) => f.tileKey === '12,10').length };
});
console.log('   ' + JSON.stringify(seeded));
ok('the economy founded a firm on the shop tile', seeded.shop.length > 0, JSON.stringify(seeded.shop));
ok('CONTROL — it founded nothing on the wall', seeded.wall === 0);

/* Open the inspector on a tile and read the Overview rows back. */
const inspect = (k) => page.evaluate(async (key) => {
  const [x, z] = key.split(',').map(Number);
  try { window.__nc.inspect(key); } catch (e) {}
  // fall back to the shipped entry point if the seam is not exposed
  if (!document.getElementById('inspanes')) {
    try { window.dispatchEvent(new CustomEvent('nc:inspect', { detail: { x, z } })); } catch (e) {}
  }
  await new Promise((r) => setTimeout(r, 700));
  const p = document.getElementById('inspanes');
  const txt = p ? p.textContent.replace(/\s+/g, ' ') : '';
  /* The shipped label is "Customer spend" — the card it sits in is already
     headed "per cycle", so the row does not repeat the period. This regex read
     "Customer spend / day" for three runs and reported a row that was rendering
     perfectly as absent. */
  return { open: !!p, hasRow: /Customer spend/.test(txt),
           txt: (txt.match(/The books.{0,300}/) || [txt.slice(0, 300)])[0] };
}, k);

console.log('\n1. the shop panel carries the row');
const shop = await inspect('10,10');
ok('the inspector opened on the shop', shop.open, shop.open ? '' : 'no #inspanes — is there an inspect seam?');
ok('the Customer spend row is on it', shop.hasRow, shop.txt.slice(0, 160));

/* ── 2. THE FIGURE IS THE ECONOMY'S ────────────────────────────────────────
   🔴 WRITTEN, NOT JUST COMPARED. The first version of this check asserted that
   the panel text contained firms().revenueDay — but on a young city that is
   0.00, and "0.00" appears in other rows, so it passed by coincidence and
   would have passed against a panel that printed a hardcoded dash.
   Writing a distinctive value onto the LIVE firm record and re-rendering is
   the real test: books.js resolves the firm through E.firms() at render time,
   so a panel keeping its own copy shows the old number. */
console.log('\n2. the figure is the economy’s — write it and watch the panel follow');
const mirror = await page.evaluate(async () => {
  const E = window.MythicEconomy;
  const f = (E.firms() || []).find((r) => String(r.tileKey) === '10,10');
  if (!f) return { err: 'no firm' };
  const wasRev = f.revenueDay, wasCust = f.customersDay;
  f.revenueDay = 87.65; f.customersDay = 23;
  window.__nc.inspect('10,10');
  await new Promise((r) => setTimeout(r, 900));
  const txt = ((document.getElementById('inspanes') || {}).textContent || '').replace(/\s+/g, ' ');
  const shown = txt.indexOf('87.65') >= 0 || txt.indexOf('87.7') >= 0 || txt.indexOf('88') >= 0;
  const custShown = txt.indexOf('23 customers') >= 0;
  const chunk = (txt.match(/Customer spend.{0,120}/) || [''])[0];
  f.revenueDay = wasRev; f.customersDay = wasCust;
  return { shown, custShown, chunk };
});
ok('a written revenueDay reaches the panel', !mirror.err && !!mirror.shown, mirror.err || mirror.chunk);
ok('...and so does the customer count', !mirror.err && !!mirror.custShown, mirror.err || mirror.chunk);

console.log('\n3. CONTROL — a tile with no business shows NO row');
const wall = await inspect('12,10');
ok('the inspector opened on the wall', wall.open);
ok('no Customer spend row on a Watchtower/Wall', !wall.hasRow,
   wall.hasRow ? 'a row was invented for a tile that owns no firm' : 'absent, correctly');

console.log('\npage errors: ' + logs.length);
logs.slice(0, 4).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
