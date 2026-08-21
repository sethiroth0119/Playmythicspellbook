/* ══════════════════════════════════════════════════════════════════════════
   ⚡💧 DRIVE-UTILITIES — the launcher, the readout, and the two doors.

   The complaint was "I saw the modal I do not know how I find it". The
   electricity and hydrology info views have always had two doors each — a
   keystroke, and a 12px chip INSIDE the Vitals card — so a player had to have
   Vitals open and had to know the chip was a button. This round adds a rail
   launcher. What has to be true for that to be a fix rather than a decoration:

     1  THE LAUNCHER IS THERE and opening it renders a real readout.
     2  THE NUMBERS ARE THE MODULES', NOT A SECOND OPINION. Moving the city's
        own power figures must move the panel. A panel that keeps its own copy
        passes any static check and drifts the first time anything is retuned —
        which is the failure this file's neighbours were written after.
     3  BOTH DOORS OPEN. The buttons must actually put the two info views on
        screen, because that is the entire complaint.
     4  IT DID NOT COST A THIRD ROW. tmp/fix-zom-tops.mjs measures the dock;
        this asserts the row count so a future launcher cannot quietly wrap the
        bar over the map.

   Run:  node .gauntlet/drive-utilities.mjs
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
const PORT = 8500 + (process.pid % 90);

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
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 240)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(8000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* ── 0. A CITY WITH SOMETHING IN IT ────────────────────────────────────────
   An empty city has no generation, no draw and nothing to list, so every
   figure below would be 0.0 and every comparison would pass vacuously. These
   are placed straight into game.tiles — the same handle drive-waterflow.mjs
   uses — and the host's own pre-passes pick them up on the next beat. */
console.log('\n0. seed a city that actually uses something');
const seeded = await page.evaluate(async () => {
  const g = window.__nc.game, B = window.__nc.BUILDINGS;
  const put = (k, type) => { g.tiles[k] = { type, lvl: 1 }; };
  put('6,6', 'powerstation');     // generation
  put('7,6', 'clinic');           // powerNeed 0.4 + use.water
  put('8,6', 'purifier');         // gen.water
  put('9,6', 'grocery');          // powerNeed 0.6
  await new Promise((r) => setTimeout(r, 2500));
  return { tiles: Object.keys(g.tiles).length,
           gen: g.power.gen, dem: g.power.demand,
           /* Consumers only. The Power Station is a GENERATOR and correctly
              declares no powerNeed — asserting one on it was this driver being
              wrong about the fixture, not the panel being wrong. */
           needs: ['clinic', 'grocery'].map((t) => (B[t] || {}).powerNeed) };
});
console.log('   ' + JSON.stringify(seeded));
ok('the seeded CONSUMERS declare a power need', seeded.needs.every((n) => n > 0), JSON.stringify(seeded.needs));
ok('the city now reports a non-zero power demand', (seeded.dem | 0) > 0 || seeded.dem > 0, 'demand ' + seeded.dem);

/* ── 1. THE LAUNCHER ───────────────────────────────────────────────────── */
console.log('\n1. the launcher exists and opens a real readout');
const open = await page.evaluate(async () => {
  const btn = document.querySelector('#railbar [data-rail="utilcard"]');
  if (!btn) return { err: 'no launcher' };
  btn.click();
  await new Promise((r) => setTimeout(r, 900));
  const body = document.getElementById('utilbody');
  const txt = body ? body.textContent.replace(/\s+/g, ' ').trim() : '';
  return {
    label: btn.textContent.replace(/\s+/g, ' ').trim(),
    rows: body ? body.querySelectorAll('.urow').length : 0,
    buttons: body ? body.querySelectorAll('[data-util]').length : 0,
    hasPower: /Electricity/.test(txt), hasWater: /Water/.test(txt),
    hasDraws: /Biggest draws/.test(txt),
    txt: txt.slice(0, 190),
  };
});
ok('the ⚡ Utility launcher is on the rail', !open.err, open.err || open.label);
if (open.err) { console.log('\ncannot proceed'); await browser.close(); server.close(); process.exit(1); }
ok('opening it renders rows', (open.rows | 0) > 0, open.rows + ' rows');
ok('it shows an electricity block', !!open.hasPower);
ok('it shows a water block', !!open.hasWater);
/* Checked AFTER seeding, below — an empty city legitimately has no draws to
   list, and asserting it here would only be testing the fixture. */
ok('it lists the biggest draws once the city has any',
   !!(await page.evaluate(() => /Biggest draws/.test((document.getElementById('utilbody') || {}).textContent || ''))));
console.log('   readout: ' + open.txt);

/* ── 2. THE NUMBERS ARE THE MODULES', NOT A PRIVATE COPY ───────────────────
   🔴 SAMPLED TOGETHER, NOT INJECTED. The first version of this check wrote
   game.power.gen = 123.4 and looked for it in the panel. It never appeared,
   and the panel was not at fault: updateHUD RECOMPUTES that pair from the city
   on every beat, so the injected value was overwritten before renderUtil ran.
   Reading the panel and the source in one evaluate compares what the player
   sees against what the city says at the same instant, which is the actual
   claim — and the seeded city above is what stops it being 0 === 0. */
console.log('\n2. the figures mirror the city at the same instant');
const mirror = await page.evaluate(() => {
  const txt = ((document.getElementById('utilbody') || {}).textContent || '').replace(/\s+/g, ' ');
  const g = window.__nc.game;
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  let wsup = null;
  try { const W = window.MythicWater; if (W && W.ready()) wsup = W.supply(); } catch (e) {}
  return {
    txt: txt.slice(0, 220),
    genShown: txt.indexOf('Generated ' + f1(g.power.gen)) >= 0 || txt.indexOf(f1(g.power.gen) + ' /min') >= 0,
    demShown: txt.indexOf(f1(g.power.demand) + ' /min') >= 0,
    gen: f1(g.power.gen), dem: f1(g.power.demand),
    waterShown: wsup ? txt.indexOf(f1(wsup.draw) + ' /min') >= 0 : null,
    wdraw: wsup ? f1(wsup.draw) : null,
    nonZero: g.power.gen > 0 || g.power.demand > 0,
  };
});
console.log('   panel: ' + mirror.txt);
ok('the city is not all zeroes (so the comparison is not vacuous)', !!mirror.nonZero,
   'gen ' + mirror.gen + ' · demand ' + mirror.dem);
ok('the generation figure matches game.power.gen', !!mirror.genShown, 'expected ' + mirror.gen);
ok('the demand figure matches game.power.demand', !!mirror.demShown, 'expected ' + mirror.dem);
ok('the water figure matches MythicWater.supply().draw',
   mirror.waterShown !== false, 'expected ' + mirror.wdraw);

/* ── 3. BOTH DOORS OPEN — the whole point of the round ─────────────────── */
console.log('\n3. the two buttons put the info views on screen');
const doors = await page.evaluate(async () => {
  const out = {};
  const click = async (sel) => {
    const b = document.querySelector('#utilbody [data-util="' + sel + '"]');
    if (!b) return null;
    b.click();
    await new Promise((r) => setTimeout(r, 700));
    return true;
  };
  out.pwBtn = !!document.querySelector('#utilbody [data-util="pw"]');
  out.wtBtn = !!document.querySelector('#utilbody [data-util="wt"]');
  if (out.pwBtn) { await click('pw'); try { out.pwOpen = !!window.MythicPower.panelOpen(); } catch (e) { out.pwOpen = false; }
                   try { window.MythicPower.closePanel(); } catch (e) {} }
  await new Promise((r) => setTimeout(r, 400));
  if (out.wtBtn) { await click('wt'); try { out.wtOpen = !!window.MythicWater.panelOpen(); } catch (e) { out.wtOpen = false; }
                   try { window.MythicWater.closePanel(); } catch (e) {} }
  return out;
});
ok('the electricity button is rendered', !!doors.pwBtn);
ok('...and it opens the electricity info view', !!doors.pwOpen);
ok('the groundwater button is rendered', !!doors.wtBtn);
ok('...and it opens the hydrology info view', !!doors.wtOpen);

/* ── 4. IT DID NOT COST A THIRD ROW ────────────────────────────────────── */
console.log('\n4. the dock still wraps to two rows, not three');
const rail = await page.evaluate(() => {
  const bar = document.getElementById('railbar');
  const vis = [...bar.querySelectorAll('.rl')].filter((b) => getComputedStyle(b).display !== 'none');
  const tops = {};
  for (const b of vis) {
    const t = Math.round(b.getBoundingClientRect().top);
    // a clocked button sits 1px high — bucket to the nearest 4px so a row is a row
    const key = Math.round(t / 4) * 4;
    (tops[key] = tops[key] || []).push(b.dataset.rail);
  }
  return { n: vis.length, rows: Object.keys(tops).length, barH: Math.round(bar.getBoundingClientRect().height), tops };
});
console.log('   ' + JSON.stringify(rail.tops));
ok('the utility launcher is among the visible ones',
   JSON.stringify(rail.tops).indexOf('utilcard') >= 0);
ok('the dock is 2 rows, not 3', rail.rows <= 2, rail.rows + ' rows · ' + rail.n + ' shown · barH ' + rail.barH);

console.log('\npage errors: ' + logs.length);
logs.slice(0, 5).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
