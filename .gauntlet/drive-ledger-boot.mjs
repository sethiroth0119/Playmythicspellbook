/* ══════════════════════════════════════════════════════════════════════════
   📒 DRIVE-LEDGER-BOOT — does the game still boot with a 108-id ledger?

   The materials-tier promotion added 21 rows to RESOURCES, and RESOURCES is
   not a display list: _resStashFloor() derives the stash ceiling from
   RESOURCE_IDS.length, resMarketPost guards on it, _ensureResources seeds a
   profile from it, and the cost renderers walk it. A static gate cannot see
   any of that. So this boots the real page and asks the ledger questions.

   Run:  node .gauntlet/drive-ledger-boot.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 7300 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof RESOURCES !== "undefined"', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(6000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

const r = await page.evaluate(() => {
  const out = {};
  out.n = RESOURCES.length;
  out.ids = RESOURCES.map((x) => x.id);
  out.dupes = out.ids.filter((x, i) => out.ids.indexOf(x) !== i);
  out.blank = RESOURCES.filter((x) => !x.id || !x.name || !x.icon || !x.color).map((x) => x.id);
  out.resourceIds = (typeof RESOURCE_IDS !== 'undefined') ? RESOURCE_IDS.length : -1;
  try { out.stashFloor = typeof _resStashFloor === 'function' ? _resStashFloor() : null; } catch (e) { out.stashErr = String(e).slice(0, 100); }
  /* Every new id must PRICE, and must not fall through to the `|| 3` guard. */
  const probe = ['clothing', 'furniture', 'petrochemicals', 'syntheticFiber', 'toys', 'paint'];
  out.prices = {};
  try { for (const id of probe) out.prices[id] = _resCinderValue(id); } catch (e) { out.priceErr = String(e).slice(0, 120); }
  /* A profile seeded from the ledger must carry the new ids at 0, not undefined.
     ⚠ THE STORE IS Profile.salvage, NOT Profile.resources. _ensureResources
       merges any legacy Profile.resources INTO salvage once (_resMergedV1) and
       then CLEARS Profile.resources, so asserting on Profile.resources reads
       the emptied side of a completed migration and fails on correct code —
       which it did, on the first run of this driver. Assert on the return
       value, which is the store itself. */
  try {
    if (typeof _ensureResources === 'function') {
      const S = _ensureResources();
      out.seeded = probe.every((id) => typeof S[id] === 'number');
      out.seededCount = Object.keys(S).length;
    }
  } catch (e) { out.seedErr = String(e).slice(0, 120); }
  return out;
});
console.log('   ledger ' + r.n + ' ids · RESOURCE_IDS ' + r.resourceIds + ' · stash floor ' + r.stashFloor);
console.log('   prices ' + JSON.stringify(r.prices));

ok('the page booted with no uncaught error', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');
ok('RESOURCES carries the promoted ledger', r.n >= 106, r.n + ' ids');
ok('no duplicate id survived the rewrite', r.dupes.length === 0, r.dupes.join(',') || 'none');
ok('every row is complete (id/name/icon/colour)', r.blank.length === 0, r.blank.join(',') || 'none');
ok('RESOURCE_IDS tracks RESOURCES', r.resourceIds === r.n, r.resourceIds + ' vs ' + r.n);
ok('the stash ceiling still derives', Number.isFinite(r.stashFloor) && r.stashFloor > 0,
   r.stashErr || String(r.stashFloor));
ok('every probed new id has a real price (none is the `|| 3` guard)',
   Object.keys(r.prices).length === 6 && Object.values(r.prices).every((v) => v > 0 && v !== 3),
   r.priceErr || JSON.stringify(r.prices));
ok("a seeded profile carries the new ids as numbers", r.seeded === true, r.seedErr || (String(r.seeded) + " (" + r.seededCount + " ids in Profile.salvage)"));

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
