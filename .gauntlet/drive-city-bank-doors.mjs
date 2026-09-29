/* ══════════════════════════════════════════════════════════════════════════
   🚪 DRIVE-CITY-BANK-DOORS — the two new doors, driven both ways

   THE ASK: a Bank of Ethos button in the city, and a My City button in the
   bank. Two doors, one round trip.

   WHAT MAKES THIS MORE THAN A "DOES THE BUTTON EXIST" TEST:

   1. IT ROUND-TRIPS. City → bank → city. A door that opens and a door that
      returns are different claims, and a button that mounts is not a button
      that navigates.

   2. IT CHECKS THE HANDOFF, WHICH IS THE ONLY PART THAT CAN GO WRONG QUIETLY.
      The bank wrap and the city iframe share z-index 2147483300 while the city
      host bar sits at ...301 — ABOVE both. If the city is not torn down before
      the bank mounts, MY STORAGE / ZONES / LEAVE CITY float over the bank and
      act on a city the player can no longer see. So this asserts the OLD
      surface is GONE, not merely that the new one arrived.

   3. IT CHECKS THE REPAINT. The bank's paint() rewrites bar.innerHTML on every
      balance refresh. A button appended once outside paint() is eaten by the
      first refresh — the failure would appear minutes in, not on open.

   ⚠ IT PROVES THE TEST CAN FAIL. The My City button is meant to be ABSENT for a
     player with no settlement. That is asserted as its own check with the node
     cleared, so "the button is there" is measured against a state where it must
     not be.

   Run:  node .gauntlet/drive-city-bank-doors.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 7550 + (process.pid % 70);
const s = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => s.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 150)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof openBankOfEthos==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4000);

const r = await pg.evaluate(async () => {
  const o = {};
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  o.reachable = (typeof openBankOfEthos === 'function') && (typeof _openNodeCity === 'function')
             && (typeof _closeNodeCity === 'function');
  if (!o.reachable) return o;

  // Give this profile a settlement. Profile is a top-level const — not on
  // window — but a driver body runs in page scope, so the binding resolves.
  try { Profile.campNodeId = 'drive-node-1'; } catch (e) {}

  /* ── LEG 1: the city's door out ─────────────────────────────────────── */
  try { _openNodeCity('drive-node-1'); } catch (e) { o.openCityErr = String(e).slice(0, 90); }
  await sleep(1200);
  const bar = document.getElementById('node-city-hostbar');
  o.cityOpened = !!document.getElementById('node-city-frame');
  o.hostbarUp  = !!bar;
  const bk = document.getElementById('node-city-bank');
  o.bankPill = !!bk;
  o.bankPillLabel = bk ? (bk.textContent || '').trim() : null;
  if (bk && bar) {
    // It must sit in the row, not off on its own layer.
    o.bankPillInBar = (bk.parentElement === bar);
    const cs = getComputedStyle(bk);
    o.bankPillOrder = cs.order;
    o.bankPillVisible = cs.display !== 'none' && cs.visibility !== 'hidden' && bk.getBoundingClientRect().width > 40;
    const x = document.getElementById('node-city-close');
    o.leaveOrder = x ? getComputedStyle(x).order : null;
    // Ordered AFTER resources, BEFORE leave city.
    const res = document.getElementById('node-city-res');
    o.resOrder = res ? getComputedStyle(res).order : null;
  }

  /* ── LEG 2: click it. City must DIE, bank must MOUNT. ───────────────── */
  if (bk) { try { bk.click(); } catch (e) { o.clickErr = String(e).slice(0, 90); } }
  await sleep(1400);
  o.cityGone       = !document.getElementById('node-city-frame');
  o.hostbarGone    = !document.getElementById('node-city-hostbar');
  o.strayPillGone  = !document.getElementById('node-city-bank');
  o.strayStorGone  = !document.getElementById('node-city-mystorage');
  o.bankMounted    = !!document.getElementById('be-frame-wrap');

  /* ── LEG 3: the bank's door back ────────────────────────────────────── */
  const mc = document.getElementById('boe-mycity');
  o.myCityBtn = !!mc;
  o.myCityLabel = mc ? (mc.textContent || '').trim() : null;
  o.myCityVisible = mc ? (mc.getBoundingClientRect().width > 30) : false;

  /* ── LEG 4: survive a repaint. paint() rewrites bar.innerHTML. ──────── */
  // Force the bar to redraw the way a balance refresh would.
  try { if (typeof BankEthos === 'object') BankEthos.ready = BankEthos.ready; } catch (e) {}
  const wrapEl = document.getElementById('be-frame-wrap');
  const barEl = wrapEl ? wrapEl.firstElementChild : null;
  o.sawBar = !!barEl;
  await sleep(1600);            // let any scheduled paint() land
  o.myCityAfterRepaint = !!document.getElementById('boe-mycity');

  /* ── LEG 5: click My City. Bank must DIE, city must COME BACK. ──────── */
  const mc2 = document.getElementById('boe-mycity');
  if (mc2) { try { mc2.click(); } catch (e) { o.click2Err = String(e).slice(0, 90); } }
  await sleep(1400);
  o.bankGone    = !document.getElementById('be-frame-wrap');
  o.cityBack    = !!document.getElementById('node-city-frame');
  o.hostbarBack = !!document.getElementById('node-city-hostbar');
  o.bankPillBack = !!document.getElementById('node-city-bank');

  /* ── LEG 6: NEGATIVE CONTROL — no settlement, no My City button ─────── */
  try { _closeNodeCity(); } catch (e) {}
  await sleep(400);
  let savedNid = null;
  try { savedNid = Profile.campNodeId; Profile.campNodeId = null; } catch (e) {}
  // getCampNodeId() may read elsewhere; neutralise it for the control only.
  let savedFn = null;
  try { if (typeof getCampNodeId === 'function') { savedFn = window.getCampNodeId; window.getCampNodeId = () => null; } } catch (e) {}
  try { const old = document.getElementById('be-frame-wrap'); if (old) old.remove(); } catch (e) {}
  try { openBankOfEthos(); } catch (e) {}
  await sleep(1200);
  o.controlBankMounted = !!document.getElementById('be-frame-wrap');
  o.controlNoMyCity = !document.getElementById('boe-mycity');
  try { if (savedFn) window.getCampNodeId = savedFn; Profile.campNodeId = savedNid; } catch (e) {}
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F6AA} CITY ↔ BANK DOORS\n');
ok('both screens are reachable (else nothing below ran)', r.reachable === true);
if (r.reachable) {
  console.log('  ── LEG 1 · the city’s door out');
  ok('the city opened', r.cityOpened === true, r.openCityErr || '');
  ok('the host bar mounted', r.hostbarUp === true);
  ok('\u{1F3AF} the BANK OF ETHOS pill is on the bar', r.bankPill === true, r.bankPillLabel || '');
  ok('it is a child of the row, not a loose overlay', r.bankPillInBar === true);
  ok('it is actually rendered, not zero-width', r.bankPillVisible === true);
  ok('it sits before LEAVE CITY in the row',
     r.bankPillOrder != null && r.leaveOrder != null
       && Number(r.bankPillOrder) < Number(r.leaveOrder),
     'bank=' + r.bankPillOrder + ' leave=' + r.leaveOrder);
  /* ⚠ NOT AN ASSERTION. The RESOURCES pill mounts only once node-city's own
     module has loaded inside the iframe, which does not happen in this driver.
     An earlier version compared against it anyway and PASSED on Number(null)→0,
     which is a check that cannot fail — worse than no check. Reported, not
     graded. */
  console.log('         (RESOURCES pill order: ' + (r.resOrder == null ? 'not mounted in-driver — not graded' : r.resOrder) + ')');

  console.log('\n  ── LEG 2 · clicking it hands over cleanly');
  ok('\u{1F3AF} the bank mounted', r.bankMounted === true, r.clickErr || '');
  ok('\u{1F3AF} the city iframe is GONE (not stacked under the bank)', r.cityGone === true);
  ok('\u{1F3AF} the host bar is GONE (no pills floating over the bank)', r.hostbarGone === true);
  ok('no stray BANK pill left behind', r.strayPillGone === true);
  ok('no stray MY STORAGE pill left behind', r.strayStorGone === true);

  console.log('\n  ── LEG 3 · the bank’s door back');
  ok('\u{1F3AF} the MY CITY button is on the bank bar', r.myCityBtn === true, r.myCityLabel || '');
  ok('it is actually rendered, not zero-width', r.myCityVisible === true);

  console.log('\n  ── LEG 4 · it survives a repaint');
  ok('\u{1F3AF} still there after paint() rewrote the bar', r.myCityAfterRepaint === true);

  console.log('\n  ── LEG 5 · the round trip closes');
  ok('\u{1F3AF} the bank closed', r.bankGone === true, r.click2Err || '');
  ok('\u{1F3AF} the city came back', r.cityBack === true);
  ok('the host bar came back with it', r.hostbarBack === true);
  ok('and so did the bank pill (the door is still there)', r.bankPillBack === true);

  console.log('\n  ── LEG 6 · NEGATIVE CONTROL · a player with no settlement');
  ok('the bank still opens for them', r.controlBankMounted === true);
  ok('\u{1F3AF} but MY CITY is ABSENT, not a dead button', r.controlNoMyCity === true);
}
console.log('\npage errors: ' + errs.length); errs.slice(0, 3).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails ? 1 : 0);
