/* ══════════════════════════════════════════════════════════════════════════
   🔒 DRIVE-STASH-DEATH — does the Secret Stash actually survive defeat?

   THE ONE CLAIM THAT MATTERS: "Anything successfully stored inside the Secret
   Stash before defeat cannot be dropped, stolen, or lost when that player is
   defeated."

   ⚠ THIS RUNS THE REAL _fieldBagLossOnDefeat(). That function is the shipped
     Tarkov-rule handler — it empties the carry bag and destroys any bag above
     the basic one. A test that re-implemented it would be asserting against
     its own copy of the very rule it is checking, which is exactly the shape
     of test that lets a loot bug through.

   ⚠ IT PROVES THE TEST CAN FAIL. The same defeat must still DESTROY the field
     bag. If the run shows the bag surviving too, the handler did not execute
     and every "stash survived" line below is meaningless — so the bag's loss
     is asserted just as hard as the stash's survival.

   Run:  node .gauntlet/drive-stash-death.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8210 + (process.pid % 50);
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
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 150)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _fieldBagLossOnDefeat==="function" && typeof _stashDeposit==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(3500);

const r = await pg.evaluate(() => {
  const o = {};
  o.reachable = ['_fieldBagLossOnDefeat', '_stashDeposit', '_stashWithdraw', '_ensureStash',
                 '_ensureFieldBag', '_stashBuyNext', '_stashCap'].every(n => typeof window[n] === 'function' || typeof eval(n) === 'function');
  if (!o.reachable) return o;

  // ── A locked player cannot protect anything ────────────────────────────
  Profile.stashTier = 0; Profile.secretStash = {};
  Profile.fieldBag = { iron: 500 };
  o.lockedRefuses = _stashDeposit('iron', 100).reason === 'locked';

  // ── Buy the ladder in order, and check it cannot be skipped ────────────
  // 💰 Ⓐ AZA. The ladder is a Vendor Market purchase now; funding only gems
  //    returned 'poor' five times and the failure named the LADDER rather than
  //    the wallet — the shape of an assertion that has stopped testing.
  Profile.sovereigns = 100000;
  Profile.stashTier = 0;
  const buys = [];
  for (let i = 0; i < 5; i++) { const x = _stashBuyNext(); buys.push(x.ok ? x.tier : x.reason); }
  o.ladder = buys;
  o.capAtMax = _stashCap();
  o.tierSlots = STASH_TIERS.map(t => t.slots);
  o.pastMax = _stashBuyNext().reason;

  // ── Load the two stores the way the brief's example does ───────────────
  Profile.stashTier = 2;                       // 10 protected slots
  Profile.secretStash = {};
  Profile.fieldBag = { iron: 500, medicine: 20, scrapMetal: 40, etherCrystals: 3, dna: 7 };
  const dep1 = _stashDeposit('etherCrystals', 3);
  const dep2 = _stashDeposit('dna', 7);
  o.moved = [dep1.ok && dep1.qty, dep2.ok && dep2.qty];
  o.bagBefore = { ...Profile.fieldBag };
  o.stashBefore = { ...Profile.secretStash };
  o.bagCountBefore = Object.keys(o.bagBefore).length;

  // Give the player an above-basic bag so the handler has one to destroy —
  // that is the half of this that proves the handler really ran.
  Profile.bagsOwned = ['basic', 'military'];
  o.bagsOwnedBefore = Profile.bagsOwned.slice();

  // ── ☠ THE REAL DEFEAT HANDLER ──────────────────────────────────────────
  let res = null;
  try { res = _fieldBagLossOnDefeat(); } catch (e) { o.threw = String(e).slice(0, 120); }
  o.result = res ? { lostKeys: Object.keys(res.lost || {}), bagLost: res.bagLost || null } : null;

  o.bagAfter = { ...(Profile.fieldBag || {}) };
  o.stashAfter = { ...(Profile.secretStash || {}) };
  o.bagsOwnedAfter = (Profile.bagsOwned || []).slice();

  // ── The claims ─────────────────────────────────────────────────────────
  o.bagEmptied = Object.keys(o.bagAfter).length === 0;
  o.bagTierDestroyed = o.bagsOwnedAfter.indexOf('military') < 0;
  o.stashIntact = JSON.stringify(o.stashAfter) === JSON.stringify(o.stashBefore);
  o.stashNotInLost = !(res && res.lost && (('etherCrystals' in res.lost) || ('dna' in res.lost)));
  o.tierKept = (Profile.stashTier | 0) === 2;

  // ── And it is still usable afterwards: the goods come back out ──────────
  const w = _stashWithdraw('etherCrystals', 3);
  o.withdrawOk = w.ok && w.qty === 3 && (Profile.fieldBag.etherCrystals | 0) === 3;

  /* ── Capacity is real: a Tier 1 stash refuses one MORE than it holds ─────
     ⚠ THE COUNT COMES OFF THE TABLE. It was five ids typed into an array, and
       the retune to 7 slots turned "a sixth kind is REFUSED" into a check that
       tested nothing at all — the sixth now fits. Derived, so the retune after
       this one cannot do the same thing quietly. */
  const T1 = STASH_TIERS[0].slots;
  const ids = Array.from({ length: T1 + 1 }, (_, i) => 'k' + i);
  Profile.stashTier = 1; Profile.secretStash = {};
  Profile.fieldBag = {}; ids.forEach(k => { Profile.fieldBag[k] = 1; });
  const fills = ids.slice(0, T1).map(k => _stashDeposit(k, 1).ok);
  const oneMore = _stashDeposit(ids[T1], 1);
  o.tier1Slots = T1;
  o.fiveFit = fills.every(Boolean);
  o.sixthRefused = !oneMore.ok && oneMore.reason === 'full';
  o.topUpStillWorks = (function () {
    Profile.fieldBag[ids[0]] = 99; return _stashDeposit(ids[0], 99).ok;
  })();
  return o;
});

/* ── THE PANEL. An enforcement rule nobody can reach is not a feature. ──── */
const ui = await pg.evaluate(async () => {
  const o = {};
  try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {}
  Profile.stashTier = 0; Profile.secretStash = {};
  Profile.fieldBag = { iron: 500, medicine: 20, etherCrystals: 3 };
  /* 💰 AZA, NOT CINDER. Stashes are bought in the Vendor Market for Ⓐ Aza
     (Profile.sovereigns) as of the retune; funding gems here and nothing else
     made every purchase below fail with 'poor' and four checks went red for a
     reason that had nothing to do with the panel. */
  Profile.gems = 10000000;
  Profile.sovereigns = 100000;
  openBagUpgradeModal();
  await new Promise(r => setTimeout(r, 400));
  o.lockedShown = !!document.querySelector('.fi-locked');
  o.hasBothCards = document.querySelectorAll('.fi-card.risk').length === 1 &&
                   document.querySelectorAll('.fi-card.safe').length === 1;
  o.protectHiddenWhileLocked = document.querySelectorAll('[data-stash-in]').length === 0;
  /* 🔒 Bought through the SHIPPED purchase function, not a test twin — the
     panel's own #stash-buy is a signpost to the Vendor Market now (a permanent
     progression purchase does not belong on a screen opened mid-run), so this
     calls what the market tile calls. */
  const r1 = _stashBuyTier(1);
  openBagUpgradeModal();
  await new Promise(r => setTimeout(r, 400));
  o.tierAfterBuy = r1.ok ? r1.tier : null;
  o.protectButtons = document.querySelectorAll('[data-stash-in]').length;
  const btn = document.querySelector('[data-stash-in]');
  o.clickedId = btn ? btn.dataset.stashIn : null;
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 500));
  o.stashAfterClick = { ...(Profile.secretStash || {}) };
  o.bagAfterClick = { ...(Profile.fieldBag || {}) };
  o.movedOut = o.clickedId ? !(o.clickedId in o.bagAfterClick) : false;
  o.movedIn = o.clickedId ? ((o.stashAfterClick[o.clickedId] | 0) > 0) : false;
  o.listScrolls = (function () { const l = document.querySelector('.fi-list');
    return l ? getComputedStyle(l).overflowY === 'auto' : false; })();
  try { const ov = document.getElementById('bag-upgrade-modal'); if (ov) ov.remove(); } catch (e) {}
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F512} SECRET STASH vs DEFEAT\n');
ok('the stash and the defeat handler are reachable (else nothing below ran)', r.reachable === true);
if (r.reachable) {
  ok('a LOCKED player cannot protect anything', r.lockedRefuses === true);
  ok('the tier ladder buys 1→5 in order', JSON.stringify(r.ladder) === '[1,2,3,4,5]', JSON.stringify(r.ladder));
  ok('the deepest tier is 30 slots and cannot be exceeded', r.capAtMax === 30 && r.pastMax === 'maxed',
     r.capAtMax + ' slots · past max: ' + r.pastMax);
  ok('\u{1F3AF} the ladder runs 7 → 30 and never narrows',
     JSON.stringify(r.tierSlots) === '[7,12,18,24,30]', JSON.stringify(r.tierSlots));
  ok('two valuables went into the stash', JSON.stringify(r.moved) === '[3,7]', JSON.stringify(r.moved));

  console.log('\n  ── ☠ the real _fieldBagLossOnDefeat() ran');
  console.log('     bag before : ' + JSON.stringify(r.bagBefore));
  console.log('     stash before: ' + JSON.stringify(r.stashBefore));
  console.log('     bag after  : ' + JSON.stringify(r.bagAfter));
  console.log('     stash after : ' + JSON.stringify(r.stashAfter));
  ok('   CONTROL — the field bag WAS emptied (proves the handler executed)',
     r.bagEmptied === true, r.bagCountBefore + ' stacks → ' + Object.keys(r.bagAfter).length);
  ok('   CONTROL — the above-basic bag WAS destroyed', r.bagTierDestroyed === true,
     JSON.stringify(r.bagsOwnedBefore) + ' → ' + JSON.stringify(r.bagsOwnedAfter));
  ok('\u{1F3AF} the SECRET STASH survived defeat untouched', r.stashIntact === true,
     JSON.stringify(r.stashAfter));
  ok('\u{1F3AF} protected goods never appear in the dropped-loot list',
     r.stashNotInLost === true, 'dropped: ' + JSON.stringify((r.result || {}).lostKeys || []));
  ok('the purchased tier survived too', r.tierKept === true);
  ok('and the goods can be taken back out afterwards', r.withdrawOk === true);
  ok('no exception from the handler', !r.threw, r.threw || 'clean');

  console.log('\n  ── capacity is real');
  ok('exactly Tier 1’s worth of stacks fits', r.fiveFit === true, r.tier1Slots + ' slots');
  ok('\u{1F3AF} one MORE kind of item is REFUSED', r.sixthRefused === true);
  ok('…but topping up a stack already inside still works', r.topUpStillWorks === true);

  console.log('\n  ── THE PANEL · can a player reach any of this?');
  ok('both stores are shown together in ONE modal', ui.hasBothCards === true);
  ok('a new player sees the stash as LOCKED', ui.lockedShown === true);
  ok('…and cannot protect anything while it is locked', ui.protectHiddenWhileLocked === true);
  ok('buying Tier 1 unlocks it', ui.tierAfterBuy === 1, String(ui.tierAfterBuy));
  ok('Protect buttons appear once unlocked', (ui.protectButtons | 0) > 0, ui.protectButtons + ' buttons');
  ok('\u{1F3AF} clicking Protect MOVES the stack out of the field bag', ui.movedOut === true, ui.clickedId || '');
  ok('\u{1F3AF} …and INTO the stash', ui.movedIn === true, JSON.stringify(ui.stashAfterClick));
  ok('a long list scrolls rather than clipping', ui.listScrolls === true);
}
console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
