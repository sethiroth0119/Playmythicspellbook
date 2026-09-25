/* ══════════════════════════════════════════════════════════════════════════
   ⏱ DRIVE-STAMINA-MODAL — one cause, two reports.

   "The scroll wheel shoots back to the top when I scroll down."
   "This button is also not working."   (Restore +10 · 500)

   THE CAUSE, shared: openHeroRestPanel ran `setInterval(render, 1000)` and
   render() did `host.innerHTML = …`. Every second the ENTIRE modal was
   destroyed and rebuilt.

     · .hr-modal-list is a new element each time, so its scrollTop is 0 again a
       second after the player scrolls. The app-wide scroll memory cannot cover
       it — this panel is appended to <body> and renders itself, outside
       _renderImpl.
     · a click requires pointerdown and pointerup on the SAME element. Rebuild
       under the player's finger and the browser never generates a click at all.
       The Restore handler was never broken; it was never called.

   The tick exists to count "+5 in 4m 12s" down, which is TEXT. So the render
   now only rebuilds when something real changed, and re-times in place
   otherwise — and when it does rebuild, it puts the scroll back.

   Pinned, with controls:
     · a second of ticking does not move the scroll   + CONTROL: it still counts down
     · …and does not replace the buttons              + CONTROL: a real change does rebuild
     · Restore actually fires and pays out            + CONTROL: the wallet moved
     · a forced rebuild keeps the scroll position

   Run:  node .gauntlet/drive-stamina-modal.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8950 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
const booted = await pg.waitForFunction('typeof openHeroRestPanel === "function" && typeof getAllHeroes === "function"', null, { timeout: 120000 })
  .then(() => true).catch(() => false);
await pg.waitForTimeout(3000);

// Open the panel with enough tired heroes that the list actually scrolls.
await pg.evaluate(() => {
  window.saveProfile = () => {};
  window.ownsHero = () => true;
  window.showToast = () => {};
  window._serverMirrorCharge = () => {};
  Profile.gems = 500000;
  const all = getAllHeroes().slice(0, 10);
  Profile.heroes = Profile.heroes || {}; Profile.heroEnergy = {};
  all.forEach((h, i) => {
    Profile.heroes[h.id] = { level: 1 };
    // energy below max so the "+5 in …" countdown is live and ticking
    Profile.heroEnergy[h.id] = { energy: 8, fatigue: 40 + i, stress: 0,
      lastRestAt: Date.now() - 30000, lastFatigueAt: Date.now() };
  });
  openHeroRestPanel();
});
await pg.waitForTimeout(400);

const out = await pg.evaluate(async () => {
  const o = {};
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const host = document.getElementById('hero-rest-modal');
  o.opened = !!host;
  if (!host) return o;
  const list = () => host.querySelector('.hr-modal-list');
  o.scrollable = list().scrollHeight > list().clientHeight + 20;

  // ── 1 · scroll down, then let the tick run ────────────────────────────
  list().scrollTop = 220;
  const btnBefore = host.querySelector('[data-hr-restore]');
  const tickBefore = host.querySelector('[data-hr-tick]').innerHTML;
  await wait(2400);                                  // two ticks
  o.scrollAfterTicks = list().scrollTop;             // must still be 220
  o.sameButtonNode = (host.querySelector('[data-hr-restore]') === btnBefore);
  /* CONTROL: the countdown must still be counting — a panel that stopped
     updating would also "keep the scroll", and that is not a fix. */
  o.countdownMoved = (host.querySelector('[data-hr-tick]').innerHTML !== tickBefore);

  // ── 2 · the Restore button, clicked for real ──────────────────────────
  const gemsBefore = Profile.gems | 0;
  const btn = host.querySelector('[data-hr-restore]');
  o.restoreVisible = !!btn && !btn.disabled;
  const hid = btn && btn.dataset.hrRestore;
  const energyBefore = hid ? (getHeroEnergy(hid).energy | 0) : null;
  if (btn) btn.click();
  await wait(150);
  o.gemsSpent = gemsBefore - (Profile.gems | 0);                       // 500
  o.energyGained = hid ? ((getHeroEnergy(hid).energy | 0) - energyBefore) : null;  // +10

  // ── 3 · CONTROL: a real change DOES rebuild, and keeps the place ──────
  const host2 = document.getElementById('hero-rest-modal');
  host2.querySelector('.hr-modal-list').scrollTop = 260;
  const btn2 = host2.querySelector('[data-hr-restore]');
  Profile.gems = (Profile.gems | 0) - 1;             // signature changes
  await wait(1400);
  o.rebuiltOnRealChange = (host2.querySelector('[data-hr-restore]') !== btn2);
  o.scrollKeptAcrossRebuild = host2.querySelector('.hr-modal-list').scrollTop;   // 260
  try { host2.remove(); } catch (e) {}
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
need('the page booted', booted === true);
need('the panel opened', out.opened === true, out.opened);
need('CONTROL: the list is actually long enough to scroll', out.scrollable === true, out.scrollable);
/* ⚠ WITHIN A PIXEL, not exactly. Chromium snaps scrollTop to device pixels, so
   a perfectly preserved 220 reads back as 220.571… — the first version of these
   two assertions demanded integer equality and failed a fix that worked. */
need('THE REPORT: the scroll survives two ticks', Math.abs(out.scrollAfterTicks - 220) <= 1, out.scrollAfterTicks);
need('…because the buttons are not replaced under the player', out.sameButtonNode === true, out.sameButtonNode);
need('CONTROL: the countdown is still live', out.countdownMoved === true, out.countdownMoved);
need('THE REPORT: Restore is clickable', out.restoreVisible === true, out.restoreVisible);
need('…and actually charges 500 Cinder', out.gemsSpent === 500, out.gemsSpent);
need('…and actually restores the battles', out.energyGained === 10, out.energyGained);
need('CONTROL: a real change still rebuilds the cards', out.rebuiltOnRealChange === true, out.rebuiltOnRealChange);
need('…and the rebuild keeps the player\'s place', Math.abs(out.scrollKeptAcrossRebuild - 260) <= 1, out.scrollKeptAcrossRebuild);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify({ booted, ...out, pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the list stays put, the buttons stay under your finger, and the clock still ticks.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
