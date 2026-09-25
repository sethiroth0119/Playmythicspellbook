/* ══════════════════════════════════════════════════════════════════════════
   ⚡ DRIVE-POWER-WHY — a dead plant has to say what killed it.

   THE REPORT: "it is still connected… it is connected to a solar farm and it
   is not connecting power." Three rounds were spent on the LINES — crossing
   roads, seeding off the interchange, the surge — and the lines were fine.
   The break was one field wide, at the host seam:

     node-city asks /src/power for availability, gets back BOTH a factor and a
     reason per plant, applies the factor to the plant's output — and drops the
     reason on the floor. So grid.js received a plant producing 0 with nothing
     to say, and every surface downstream inherited the silence: the tile
     tooltip printed a bare "0.00 ⚡/min reaching the grid", and the power
     panel's supply row printed "☀️ Solar Farm 0%" with no cause.

     A player reading that concludes the GRID is broken, redraws the line, and
     reports it again. Which is exactly what happened.

   Pinned here against the real page, through the real tick:

     · every plant row that comes out of a tick carries a `why` STRING — the
       field survives the seam at all (it did not)
     · a wind turbine boxed in by buildings says it is sheltered
     · CONTROL: the identical turbine in open ground says nothing — so the
       sentence above is caused by the shelter and is not printed always
     · a becalmed/dark plant that reports 0 output never reports 0 in silence

   The wind wake is used as the probe rather than the solar farm because the
   sun follows the real EST wall clock: a solar assertion would pass all night
   and fail all day, which is a coin toss wearing a test's clothes. The solar
   row is still checked — for the WEAKER claim that holds at any hour.

   Run:  node .gauntlet/drive-power-why.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8870 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.game && window.MythicPower)', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(9000);

const out = await pg.evaluate(async () => {
  const o = {};
  const nc = window.__nc, PW = window.MythicPower;
  o.reachable = !!(nc && nc.game && nc.step && PW && PW.state);
  if (!o.reachable) return o;

  const g = nc.game, B = nc.BUILDINGS || {};
  const fillType = B.road ? 'road' : Object.keys(B)[0];
  const put = (x, z, type) => { g.tiles[x + ',' + z] = { type, lvl: 1 }; };

  /* SHELTERED turbine at 5,5 — ringed by buildings, which is what the wake
     model penalises. OPEN turbine at 20,20 with nothing near it: the control.
     A solar farm at 5,20, likewise clear. */
  put(5, 5, 'wind');
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue; put(5 + dx, 5 + dz, fillType);
  }
  put(20, 20, 'wind');
  put(5, 20, 'solar');

  /* The hook-up rule is switched OFF for this city, because it OVERWRITES the
     reason with its own ("not connected to the grid connector") and there is no
     line drawn here. That rule has its own driver — drive-power-grid, claim 3.
     What is under test is the reason a CONNECTED plant gives, so the plant must
     be connected. */
  try { window.__pwTuning.transmission.requireConnector = false; } catch (e) { o.tuningError = String(e).slice(0, 120); }

  try { nc.step(); nc.step(); } catch (e) { o.stepError = String(e).slice(0, 200); }
  await new Promise(r => setTimeout(r, 400));

  const st = PW.state();
  o.ok = !!(st && st.ok);
  const rows = (st && st.byPlant) || [];
  o.n = rows.length;
  const at = (k) => rows.find(r => r && r.k === k) || null;
  const pick = (r) => r ? { why: r.why, whyType: typeof r.why, out: +(+r.out).toFixed(3),
                            avail: +(+r.avail).toFixed(3), linked: r.linked } : null;
  o.sheltered = pick(at('5,5'));
  o.open      = pick(at('20,20'));
  o.solar     = pick(at('5,20'));
  // Every row must carry the field, not just the two being read by name.
  o.allStrings = rows.every(r => typeof r.why === 'string');
  /* Anything the WEATHER has shut down must say so. The test is availability,
     not output: a plant can also read 0 because its crew is unhired, and that
     is the host's own arithmetic (tileMult × staffing) with its own line in the
     tooltip — /src/power has no opinion on it and must not invent one. */
  o.silentZeros = rows.filter(r => !(+r.avail > 0) && !r.why && r.linked !== false)
                      .map(r => r.k + ':' + r.type);
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('node-city / MythicPower not reachable on the page');
else {
  need('the solve answered', out.ok, out);
  need('all three plants reached the grid solver', out.n >= 3, out.n);
  need('every plant row carries a why STRING (the field survives the seam)', out.allStrings === true, out);
  need('the SHELTERED turbine says why it is down', !!(out.sheltered && /shelter/i.test(out.sheltered.why || '')), out.sheltered);
  need('CONTROL: the OPEN turbine says nothing', !!(out.open && !out.open.why), out.open);
  need('the solar row carries the field at any hour', !!(out.solar && typeof out.solar.why === 'string'), out.solar);
  need('a solar farm reading 0 is never silent about it',
       !!(out.solar && (+out.solar.out > 0 || !!out.solar.why)), out.solar);
  need('a plant the weather has shut down never does it in silence', (out.silentZeros || []).length === 0, out.silentZeros);
  need('the tick did not throw', !out.stepError, out.stepError);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — a plant that is making nothing now says what is stopping it, and one that is fine stays quiet.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
