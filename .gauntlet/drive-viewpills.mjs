/* ══════════════════════════════════════════════════════════════════════════
   ⛏ DRIVE-VIEWPILLS — "the Resource button appears and disappears".

   Reported against the city host bar, with a screenshot showing 🏷 LAND and
   ☁ AIR present and ⛏ RESOURCES absent. That asymmetry is the whole clue: all
   three pills are built by the same loop in _ncViewPills(), so a bug that hit
   the row would have taken all three.

   THE RACE, read from the source. mount() waits for `cfg.some(live)` — ANY ONE
   module ready — and then runs the creation loop ONCE. It is never rescheduled
   after a pass that created something. So the row is decided by whichever
   modules happen to be ready at the instant the FIRST one registers:

     · MythicLandValue and MythicPollution ready first → LAND and AIR mount,
       and MythicResourceMap, registering even a tick later, never gets a pill.
     · all three ready together → all three mount, and the bug is invisible.

   That is a boot race, so it is intermittent per load — which is exactly what
   "appears and disappears" describes.

   This drives _ncViewPills() against a REAL iframe whose contentWindow exposes
   the three modules with STAGGERED readiness, which is the shape the city
   actually boots in. It does not need the city: the defect is entirely in the
   host-side mount loop.

   Run:  node .gauntlet/drive-viewpills.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 7500 + (process.pid % 80);
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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof _ncViewPills === "function"', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(4000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* Build the host bar + a real iframe, register modules on a schedule, run the
   mount loop, and read the row back. `lateMs` is the whole experiment. */
const scenario = (lateMs, waitMs) => page.evaluate(async ([lateMs, waitMs]) => {
  for (const id of ['node-city-hostbar', 'node-city-frame']) {
    const old = document.getElementById(id); if (old) old.remove();
  }
  for (const id of ['node-city-land', 'node-city-air', 'node-city-res']) {
    const old = document.getElementById(id); if (old) old.remove();
  }
  if (window.App && App._ncViewTimer) { try { clearInterval(App._ncViewTimer); } catch (e) {} }

  const bar = document.createElement('div');
  bar.id = 'node-city-hostbar';
  bar.style.cssText = 'position:fixed;top:12px;right:14px;display:flex;gap:8px';
  document.body.appendChild(bar);

  const f = document.createElement('iframe');
  f.id = 'node-city-frame';
  f.style.cssText = 'position:fixed;left:-9999px;width:10px;height:10px';
  document.body.appendChild(f);
  await new Promise((r) => setTimeout(r, 120));
  const w = f.contentWindow;

  const mk = () => ({ ready: () => true, panelOpen: () => false, togglePanel() {} });
  /* LAND and AIR register first — the order the city actually boots in. */
  w.MythicLandValue = mk();
  w.MythicPollution = mk();
  /* RESOURCES registers `lateMs` later.
     ⚠ lateMs < 0 means "already there before the loop runs" and is the CONTROL.
       It has to be a synchronous assignment, not setTimeout(…, 0): mount() runs
       synchronously inside _ncViewPills(), so even a zero-delay timer lands
       AFTER the only pass the old code ever made. The first draft of this
       driver used setTimeout(…, 0) as its "lucky load" and the control failed
       too — which looked like a broken control and was actually the defect
       being wider than predicted: not "a late module is unlucky" but "any
       module not ready at the synchronous call is lost". */
  if (lateMs < 0) w.MythicResourceMap = mk();
  else setTimeout(() => { try { w.MythicResourceMap = mk(); } catch (e) {} }, lateMs);

  _ncViewPills();
  await new Promise((r) => setTimeout(r, waitMs));
  return {
    land: !!document.getElementById('node-city-land'),
    air: !!document.getElementById('node-city-air'),
    res: !!document.getElementById('node-city-res'),
    labels: [...bar.querySelectorAll('button')].map((b) => b.textContent),
  };
}, [lateMs, waitMs]);

console.log('\n\u{26CF} THE RESOURCE PILL — does it survive a staggered boot?\n');

console.log('1. the CONTROL — every module ready BEFORE the loop runs (must pass either way)');
const lucky = await scenario(-1, 2500);
console.log('   ' + JSON.stringify(lucky.labels));
ok('all three pills mount when nothing is late', lucky.land && lucky.air && lucky.res,
   'land=' + lucky.land + ' air=' + lucky.air + ' res=' + lucky.res);

console.log('\n2. the REPORTED load — the resource map registers 600ms after the other two');
const late = await scenario(600, 4000);
console.log('   ' + JSON.stringify(late.labels));
ok('LAND and AIR still mount (the row itself is not broken)', late.land && late.air,
   'land=' + late.land + ' air=' + late.air);
ok('\u{26CF} RESOURCES mounts too — a module that registers late still gets its pill',
   late.res, late.res ? '' : 'MISSING — this is the reported bug, reproduced');

console.log('\n3. a SLOW load — 3s late, still inside the city boot window');
const slow = await scenario(3000, 7000);
console.log('   ' + JSON.stringify(slow.labels));
ok('\u{26CF} RESOURCES still mounts on a slow boot', slow.res,
   slow.res ? '' : 'MISSING at 3s');

console.log('\n4. a module that is genuinely ABSENT must still produce NO pill');
const absent = await page.evaluate(async () => {
  for (const id of ['node-city-hostbar', 'node-city-frame', 'node-city-land', 'node-city-air', 'node-city-res']) {
    const old = document.getElementById(id); if (old) old.remove();
  }
  if (window.App && App._ncViewTimer) { try { clearInterval(App._ncViewTimer); } catch (e) {} }
  const bar = document.createElement('div'); bar.id = 'node-city-hostbar'; document.body.appendChild(bar);
  const f = document.createElement('iframe'); f.id = 'node-city-frame';
  f.style.cssText = 'position:fixed;left:-9999px;width:10px;height:10px';
  document.body.appendChild(f);
  await new Promise((r) => setTimeout(r, 120));
  const mk = () => ({ ready: () => true, panelOpen: () => false, togglePanel() {} });
  f.contentWindow.MythicLandValue = mk();      // only ONE module ever exists
  _ncViewPills();
  await new Promise((r) => setTimeout(r, 9000));
  return { land: !!document.getElementById('node-city-land'),
           res: !!document.getElementById('node-city-res'),
           air: !!document.getElementById('node-city-air') };
});
ok('the one live module still mounts', absent.land, 'land=' + absent.land);
ok('...and an absent module gets NO dead pill (the retry must not invent one)',
   !absent.res && !absent.air, 'res=' + absent.res + ' air=' + absent.air);

console.log('\npage errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
