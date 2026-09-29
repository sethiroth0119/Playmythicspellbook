/* ══════════════════════════════════════════════════════════════════════════
   📦 DRIVE-WAREHOUSE-UI — does storage open FROM the City Builder?

   THE REPORT: "when the button is pressed in the city to send stuff to the
   storage or buy and rent a storage or my storage, open the modal in the city
   builder not the city node map — it's confusing the players."

   So the claim to test is not "a modal exists". It is:

     1. the buttons are reachable while standing in the CITY,
     2. clicking one opens a modal WITHOUT leaving the city — the iframe is
        still mounted and App.screen has not changed,
     3. the modal is actually ON TOP and clickable, not painted underneath the
        city (it was z-index 9460 against a city at 2147483300, which is the
        bug that made it look like nothing happened at all).

   ⚠ (3) IS MEASURED WITH elementFromPoint, NOT WITH A z-index COMPARISON. A
     number being larger does not prove a stacking context put it in front; the
     hit test is what the player's mouse actually does.

   Run:  node .gauntlet/drive-warehouse-ui.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8400 + (process.pid % 50);
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
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 150)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _openNodeCity==="function" && typeof _whOpenMyStorage==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(3500);

/* Open the city the player would be standing in. */
const setup = await pg.evaluate(() => {
  const o = {};
  try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {}
  o.fns = ['_whOpenMyStorage', '_whOpenDirectory', '_whOpenSendModal', '_whModal', '_whBindSendButtons']
    .filter(n => typeof window[n] !== 'function' && typeof eval('typeof ' + n) === 'string' && eval('typeof ' + n) !== 'function');
  try { Profile.campNodeId = 'wh-node'; } catch (e) {}

  /* 🔴 THIS DRIVER WENT STALE AND FAILED ALL TEN CHECKS FOR ONE REASON THAT
     HAD NOTHING TO DO WITH STORAGE. Two gates arrived after it was written:

       1. The game boots to App.screen 'authGate', and _openNodeCity does
          nothing from there — silently.
       2. Opening a node you do not own is now REFUSED ("🔒 That node is not
          yours"), because opening a foreign node CREATES a city on it, and
          that is how 13 of 21 cities in the database ended up on land their
          builder does not own.

     Both refusals are correct and neither is a storage bug. The driver was
     asking for a node the test player has no claim to, from a screen where
     nothing opens, and then asserting ten things about a city that was never
     on screen. Every failure read as "storage is broken"; none of them were.

     ⚠ App._myCityNodes IS THE HONEST STAND-IN, NOT AN OWNERSHIP BYPASS. It is
       the game's own "I already have a city standing here" list, built from
       city_state rows where user_id = me — the third legitimate way in, and
       the only one that needs no server. Faking ownership or a mayoral
       appointment would have exercised a path a signed-out player cannot
       reach, which is a worse lie than the one being fixed. */
  try { App.screen = 'map'; if (typeof render === 'function') render(); }
  catch (e) { o.screenErr = String(e).slice(0, 80); }
  try { App._myCityNodes = ['wh-node']; } catch (e) {}

  try { _openNodeCity('wh-node'); } catch (e) { o.err = String(e).slice(0, 120); }
  return o;
});
await pg.waitForTimeout(1500);

const probe = await pg.evaluate(async () => {
  const o = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  o.cityOpen = !!document.getElementById('node-city-frame');
  o.screenBefore = App.screen;

  const mine = document.getElementById('node-city-mystorage');
  const send = document.getElementById('node-city-storage');
  o.mineBtn = !!mine; o.sendBtn = !!send;
  o.mineLabel = mine ? (mine.textContent || '').trim() : null;
  o.sendLabel = send ? (send.textContent || '').trim() : null;

  /* ── A. SIGNED OUT. The storage network is a server feature, so the honest
        behaviour is to SAY SO, not to open an empty modal and not to do
        nothing at all. Silence here is the "confusing the players" report in
        its purest form, so it is asserted. ─────────────────────────────── */
  document.querySelectorAll('.toast').forEach(t => t.remove());
  if (mine) mine.click();
  await sleep(1200);
  const toast = document.querySelector('.toast');
  o.signedOutToast = toast ? (toast.textContent || '').trim().slice(0, 70) : null;
  o.signedOutSaysWhy = !!(o.signedOutToast && /sign|offline/i.test(o.signedOutToast));
  o.noModalWhenSignedOut = !document.getElementById('wh-storage') && !document.getElementById('wh-directory');
  document.querySelectorAll('.toast').forEach(t => t.remove());

  /* ── B. THE REAL UI, with the SERVER BOUNDARY stubbed. Stubbing _whRpc and
        not the UI is the point: every line of modal-building code below runs
        for real, against the row shape the RPCs actually return. ────────── */
  const realRpc = window._whRpc;
  window._whRpc = async (fn) => {
    if (fn === 'wh_my_rentals') return [{
      bay_no: 41, owner_name: 'PlayerName', tier: 2, used_kg: 38450, capacity_kg: 50000,
      rent_until: Date.now() + 86400000, contents: { steel: 12500, copper: 5200, fuel: 3750 },
      warehouse_id: 'w1', bay_id: 'b41',
    }];
    if (fn === 'wh_directory') return [
      { owner_name: 'PlayerName', tier: 2, free_units: 3, my_units: 1, warehouse_id: 'w1' },
      { owner_name: 'AnotherPlayer', tier: 1, free_units: 1, my_units: 0, warehouse_id: 'w2' },
    ];
    if (fn === 'wh_config') return { rent_cinder_per_day: 1200 };
    return null;
  };
  try { if (typeof _whRentalsCache !== 'undefined') _whRentalsCache = null; } catch (e) {}

  // ── MY STORAGE ────────────────────────────────────────────────────────
  if (mine) mine.click();
  await sleep(1400);
  const m1 = document.getElementById('wh-storage');
  o.myStorageOpened = !!m1;
  o.cityStillOpenAfterMine = !!document.getElementById('node-city-frame');
  o.screenAfterMine = App.screen;
  if (m1) {
    const cs = getComputedStyle(m1);
    o.myZ = cs.zIndex;
    const cityZ = (function () { const f = document.getElementById('node-city-frame');
      return f ? getComputedStyle(f).zIndex : null; })();
    o.cityZ = cityZ;
    // 🎯 the hit test — is the modal what the mouse would actually hit?
    const el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    o.centreInsideModal = !!(el && m1.contains(el));
    o.centreTag = el ? (el.id || el.className || el.tagName) : null;
    // close it again
    const x = m1.querySelector('[data-wh-close], .wh-x, button');
    if (x) x.click();
    await sleep(500);
  }
  o.closedAgain = !document.getElementById('wh-storage');

  // ── BUY / SEND STORAGE ────────────────────────────────────────────────
  if (send) send.click();
  await sleep(1100);
  const m2 = document.getElementById('wh-directory') || document.getElementById('wh-send');
  o.buyOpened = !!m2;
  o.buyWhich = m2 ? m2.id : null;
  o.cityStillOpenAfterBuy = !!document.getElementById('node-city-frame');
  o.screenAfterBuy = App.screen;
  if (m2) {
    const el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    o.buyCentreInside = !!(el && m2.contains(el));
    o.buyListsWarehouses = /warehouse/i.test(m2.textContent || '');
  }
  try { window._whRpc = realRpc; } catch (e) {}
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F4E6} WAREHOUSE STORAGE — FROM THE CITY BUILDER\n');
/* 🔴 IF THE CITY DID NOT OPEN, EVERYTHING BELOW IS MEANINGLESS. Each of the
   nine checks after this asserts something about a city being on screen, so a
   failed precondition reads as ten separate storage regressions and none of
   them names the cause. That is exactly how this driver sat broken: the game
   grew an auth gate and a node-ownership refusal, the setup silently did
   nothing, and the report blamed the feature. Labelled SETUP so the next
   reader knows which line to fix. */
ok('SETUP: the city opened (else nothing below ran)', probe.cityOpen === true, setup.err || (probe.screenBefore || ''));
ok('the MY STORAGE button is on the city bar', probe.mineBtn === true, probe.mineLabel || '');
ok('the BUY / SEND STORAGE button is on the city bar', probe.sendBtn === true, probe.sendLabel || '');

console.log('\n  ── Signed out · the server-backed path must SAY so');
ok('it tells the player why, instead of doing nothing',
   probe.signedOutSaysWhy === true, probe.signedOutToast || '(no toast at all)');
ok('…and does not open an empty modal', probe.noModalWhenSignedOut === true);

console.log('\n  ── My Storage (server boundary stubbed, real UI)');
ok('\u{1F3AF} it opens a modal', probe.myStorageOpened === true);
ok('\u{1F3AF} …WITHOUT leaving the City Builder', probe.cityStillOpenAfterMine === true);
ok('\u{1F3AF} …and without navigating to the node map',
   probe.screenAfterMine === probe.screenBefore, probe.screenBefore + ' → ' + probe.screenAfterMine);
ok('\u{1F3AF} the modal is what the mouse actually hits at screen centre',
   probe.centreInsideModal === true, 'hit: ' + probe.centreTag + ' · modal z ' + probe.myZ + ' vs city z ' + probe.cityZ);
ok('it closes again', probe.closedAgain === true);

console.log('\n  ── Buy / Send storage');
ok('\u{1F3AF} it opens a modal', probe.buyOpened === true, probe.buyWhich || '');
ok('\u{1F3AF} …WITHOUT leaving the City Builder', probe.cityStillOpenAfterBuy === true);
ok('\u{1F3AF} …and without navigating to the node map',
   probe.screenAfterBuy === probe.screenBefore, probe.screenBefore + ' → ' + probe.screenAfterBuy);
ok('the modal is on top there too', probe.buyCentreInside === true);

console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
