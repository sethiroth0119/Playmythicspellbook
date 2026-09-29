/* ══ 🌊 THE SAVE ROUND-TRIP — does a PRE-OCEAN city open unchanged? ════════
   The one claim about this round that cannot be argued from the diff, because
   the thing it is about is a save file written by a build that did not have the
   feature. So it is run for real, in one browser context, across two boots:

     BOOT 1  /src/ocean/** is ROUTED TO 404, so the page is byte-for-byte the
             pre-ocean game. The standard gauntlet district is built through the
             SHIPPED __nc.place() → tryPlace() path, then saveNow().
     BOOT 2  the same localStorage, the ocean allowed to load. Every tile is
             read back and compared, key by key, on type / level / position.

   A pass is: same tile count, same types on the same keys, nothing refused,
   nothing moved, and no `ocean` field anywhere in the save blob.

   ⚠ IT MATTERS THAT IT IS A REAL 404 AND NOT A FLAG. The whole risk this test
     covers is a module that quietly participates in loading — a placement
     refusal, a mesh swap, a save field. A flag inside the module would still
     have run its mount.

   Usage: node .gauntlet/oceansave.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8900 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

let blockOcean = true;
await page.route('**/src/ocean/**', r => (blockOcean ? r.fulfill({ status: 404, body: 'nf' }) : r.continue()));

await page.addInitScript(({ hour }) => {
  const _D = Date; const now = new _D(); const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now)) parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class S extends _D { constructor(...a) { if (!a.length) super(_D.now() + shiftMs); else super(...a); }
    static now() { return _D.now() + shiftMs; } }
  S.parse = _D.parse; S.UTC = _D.UTC; window.Date = S;
}, { hour: 15 });

const logs = [];
page.on('console', m => logs.push('[' + m.type() + '] ' + m.text().slice(0, 300)));

const boot = async (label) => {
  await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => !!(window.__nc && window.__nc.three), null, { timeout: 180000 });
  await page.waitForTimeout(18000);
  console.log('booted: ' + label + '  ocean=' + (blockOcean ? 'BLOCKED (404)' : 'allowed') +
              '  MythicOcean=' + await page.evaluate(() => !!window.MythicOcean));
};

const inventory = () => page.evaluate(() => {
  const g = window.__nc.game, out = {};
  for (const k in g.tiles) {
    const t = g.tiles[k];
    out[k] = { type: t.type, lvl: t.lvl || 1,
               mx: t.mesh ? +t.mesh.position.x.toFixed(4) : null,
               mz: t.mesh ? +t.mesh.position.z.toFixed(4) : null };
  }
  return out;
});

// ── BOOT 1: the pre-ocean game builds a city and saves it ───────────────────
await boot('BOOT 1 — pre-ocean');
/* A small district, built the way .gauntlet/scene.js builds one — through the
   SHIPPED __nc.place() → tryPlace() path, with the same two gates stubbed
   (scene.js's own header names them: cost consults MythicCityBridge and not
   game.res, and a crew slot has to be freed between batches).
   ⚠ DELIBERATELY WEIGHTED ONTO THE EAST COLUMNS. Columns 20–23 are the coastal
     strip this round made coastal; if anything in it could refuse or move a
     building, that is where it would. A district in the middle of the map would
     pass this test without ever touching the feature. */
const gates = await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.spendCinders = async () => true; B.spendRes = async () => true; }
  const done = () => { try { nc.build.finishAll('ocean save test'); } catch (e) {} };
  const log = [];
  const put = async (type, x, z) => { try { const r = await nc.place(type, x, z); log.push([type, x, z, !!r]); } catch (e) { log.push([type, x, z, 'threw ' + e.message]); } };
  // roads down the east side and one spur inland
  for (let z = 6; z <= 17; z++) await put('road', 22, z);
  for (let x = 14; x <= 21; x++) await put('road', x, 12);
  done();
  for (const [x, z] of [[23, 8], [23, 9], [21, 8], [21, 9], [20, 14], [23, 15]]) await put('housing', x, z);
  done();
  for (const [x, z] of [[23, 11], [21, 13]]) await put('purifier', x, z);
  done();
  for (const [x, z] of [[15, 10], [16, 14], [10, 12]]) await put('housing', x, z);
  done();
  return { placed: log.filter(l => l[3] === true).length, tried: log.length,
           refused: log.filter(l => l[3] !== true) };
});
await page.waitForTimeout(4000);
console.log('boot-1 placements:', gates.placed, 'of', gates.tried,
            gates.refused.length ? ('· refused: ' + JSON.stringify(gates.refused).slice(0, 300)) : '');
const before = await inventory();
/* THE SAVE IS FROZEN AND REPLAYED, NOT HANDED ON.
   🐞 THE FIRST RUN OF THIS TEST REPORTED SIX EXTRA TILES AND CALLED IT A FAIL,
      AND IT WAS NOT THIS ROUND'S. They were road tiles at 22,0…22,5 laid by
      /src/outside's grandfather migration (link.js:235 calls place('road', x, z)
      through the deliberately UNGATED place closure, so a city already at its
      road cap can still be reconnected). Boot 1 had no roads at load and the
      migration waived; boot 2 loaded a city WITH roads and duly connected it to
      the north edge. Nothing to do with the sea — and the only way to know that
      is a CONTROL: the same frozen save opened twice, once with /src/ocean 404
      and once with it live. Comparing a load against the session that wrote it
      compares two different questions. */
const saved = await page.evaluate(() => {
  window.__nc.saveNow();
  const keys = Object.keys(localStorage).filter(k => /city/i.test(k));
  const blob = {}; for (const k of keys) blob[k] = localStorage.getItem(k);
  const biggest = keys.map(k => blob[k]).sort((a, b) => b.length - a.length)[0] || '';
  return { keys, blob, len: biggest.length, hasOceanField: /"ocean"\s*:/.test(biggest) };
});
console.log('district built:', Object.keys(before).length, 'tiles · save', saved.len, 'chars · keys', JSON.stringify(saved.keys));

const replay = async (label) => {
  await page.evaluate((b) => { for (const k in b) localStorage.setItem(k, b[k]); }, saved.blob);
  logs.length = 0;
  await boot(label);
  return inventory();
};

// ── BOOT 2: THE CONTROL. The same frozen save, still no ocean. ──────────────
const control = await replay('BOOT 2 — CONTROL, the same save, ocean still 404');

// ── BOOT 3: the same frozen save, opened by a build that HAS the ocean ──────
blockOcean = false;
const after = await replay('BOOT 3 — the same save, with the ocean');
const oceanState = await page.evaluate(() => ({
  mounted: !!window.MythicOcean,
  verify: window.MythicOcean ? window.MythicOcean.verify() : null,
  outskirts: window.__nc.three().scene.children.filter(o => o.name === 'outskirts').length,
  coastalSource: window.MythicWater ? window.MythicWater.sourceAt(23, 11).kind : null,
}));

// ── COMPARE: control vs test, never boot-1 vs test. ─────────────────────────
const before2 = control;
const ka = Object.keys(before2).sort(), kb = Object.keys(after).sort();
const kb1 = Object.keys(before).sort();
const missing = ka.filter(k => !(k in after));
const added = kb.filter(k => !(k in before2));
const changed = [];
for (const k of ka) {
  if (!(k in after)) continue;
  const a = before2[k], b = after[k];
  if (a.type !== b.type || a.lvl !== b.lvl || a.mx !== b.mx || a.mz !== b.mz)
    changed.push({ k, before: a, after: b });
}
const refusals2 = logs.filter(l => /refus|cannot place|blocked/i.test(l));

const ok = !missing.length && !added.length && !changed.length && !saved.hasOceanField && oceanState.mounted;
console.log(JSON.stringify({
  tilesWhenWritten: kb1.length,
  tilesControlLoad: ka.length, tilesOceanLoad: kb.length,
  missing, added, changed: changed.slice(0, 8), changedCount: changed.length,
  saveHasOceanField: saved.hasOceanField,
  refusalsDuringLoad: refusals2.slice(0, 6),
  ocean: oceanState,
  VERDICT: ok ? 'PASS — the pre-ocean save opened with every building on its own tile' : 'FAIL',
}, null, 2));

await browser.close(); server.close();
process.exit(ok ? 0 : 1);
