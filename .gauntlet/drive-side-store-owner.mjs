/* ══════════════════════════════════════════════════════════════════════════
   🪪 DRIVE-SIDE-STORE-OWNER — the synchronous side-store keys belong to ONE
   account, and a boot only merges the copy that belongs to the save it loaded.

   THE BUG. hg_itemInventory, hg_frTaxLedger and hg_cxHoldings are written
   synchronously on every purchase so a refresh inside the save debounce cannot
   lose it, and loadForge() MAX-merges them back into Profile at boot. They had
   no owner and cloudSignOut never removed them, so after account A signed out
   and account B signed in on the same browser, B's boot poured A's items,
   exchange holdings and tax ledger into B's Profile, and the next sync
   uploaded them into B's user_profiles row. The same shape existed in the
   Warpath grant ledger (its repair raises cardCollection to every entry), the
   remembered maintenance hold, and the Black Market pass fallback.

   WHAT THIS DRIVES. The real public/index.html boots in headless chromium
   with localStorage SEEDED before the first script runs (addInitScript), every
   off-origin request aborted (so the page runs offline, never near Supabase),
   and the page's own functions are called. Checks:
     P1  B's save on disk, A's side copies beside it  → B's Profile holds none
     P2  A's save on disk, A's side copies             → adopted (the reason the
         keys exist: a reload still recovers a debounced purchase)
     P3  pre-upgrade plain keys, no save, no stamp (A signed out, keys left)
         → dropped, not merged into the next Profile
     P4  plain keys + a guest save (no stamp)          → a guest's, merged
     P5  plain keys + stamp A                           → moved to @A, merged
     P6  in-session: the write gate, _sideAdoptFor freshness both ways, the
         guest keys retired on adoption, _sideForget, the Warpath ledger owner
         filter and the Black Market pass key.
   NEGATIVE CONTROL. P3 is also run against the HEAD blob of index.html (the
   pre-fix code), where the same seeded residue MUST show up in the next
   Profile — if it does not, this probe could not see the leak and its green
   means nothing. Pass --page=<file> to point the main run somewhere else.

   Output: PASS/FAIL lines with marker ids only. No email, no real account.
   Run:  node .gauntlet/drive-side-store-owner.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ARGS = process.argv.slice(2);
const argVal = (k) => { const a = ARGS.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const ROOT = path.resolve(process.cwd(), 'public');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

let passes = 0, fails = 0;
const ok = (name, cond, detail) => {
  if (cond) passes++; else fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
  return !!cond;
};
const fmt = (o) => JSON.stringify(o);

let INDEX_BODY = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(INDEX_BODY); }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const PORT = 8900 + (process.pid % 50);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + PORT;
let browser;

const inv = (tag) => JSON.stringify({ ['zz' + tag + '_item']: 3 });
const cx = (tag) => JSON.stringify({ ['zz' + tag + '_cx']: { qty: 40, avgCost: 10 } });
const led = (tag) => JSON.stringify({ total: 50000, byRes: { ['zz' + tag + '_tax']: 50000 }, byMarket: {}, recent: [] });
/* The seeded save acknowledges the build's current global-reset epoch, read from
   a preflight boot, so the boot-time reset (which empties itemInventory on a
   save that has not acknowledged it) does not run and hide what the side-store
   merge did. The comparison truncates with "| 0" on both sides, so the exact value is used. */
let guestBlob = null;

/* Boot a page with `seed` in localStorage before any page script runs. */
async function boot(seed) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const u = route.request().url();
    return u.startsWith(ORIGIN) ? route.continue() : route.abort();
  });
  await context.addInitScript((s) => {
    try { if (!sessionStorage.getItem('__seeded')) { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); sessionStorage.setItem('__seeded', '1'); } } catch (e) {}
  }, seed);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => { try { return typeof Profile !== 'undefined' && typeof saveProfile === 'function'; } catch (e) { return false; } },
    null, { timeout: 120000, polling: 250 });
  await page.waitForTimeout(500);
  return { context, page, errors };
}
const held = (page) => page.evaluate(() => {
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^hg_(itemInventory|cxHoldings|frTaxLedger|side_at|bmPass|maint_mine|warpath_grants)/.test(k)) ls[k] = localStorage.getItem(k); }
  return {
    items: Object.keys(Profile.itemInventory || {}).filter((k) => k.startsWith('zz')),
    cx: Object.keys(Profile.cxHoldings || {}).filter((k) => k.startsWith('zz')),
    tax: Object.keys((Profile.frTaxLedger && Profile.frTaxLedger.byRes) || {}).filter((k) => k.startsWith('zz')),
    ls,
  };
});
const ids = (h) => [...h.items, ...h.cx, ...h.tax].sort();

async function scenario(label, seed, fn) {
  let b;
  try { b = await boot(seed); await fn(b.page); }
  catch (e) { ok(label + ': ran to the end', false, String(e && e.message || e).slice(0, 240)); }
  finally { if (b) await b.context.close().catch(() => {}); }
}

async function mainRun() {
  await scenario('P1', {
    hg_profile: guestBlob, hg_profile_owner: B,
    ['hg_itemInventory@' + A]: inv('A'), ['hg_cxHoldings@' + A]: cx('A'), ['hg_frTaxLedger@' + A]: led('A'),
    ['hg_side_at@' + A]: String(Date.now()),
    ['hg_itemInventory@' + B]: inv('B'),
  }, async (page) => {
    const h = await held(page);
    ok('P1: B\'s boot merges none of A\'s side copies', !ids(h).some((m) => m.startsWith('zzA')), fmt(ids(h)));
    ok('P1: B\'s own side copy IS merged (not vacuous)', h.items.includes('zzB_item'), fmt(h.items));
    ok('P1: A\'s copies are still on disk under A\'s name (recoverable)', !!h.ls['hg_itemInventory@' + A] && !!h.ls['hg_cxHoldings@' + A], fmt(Object.keys(h.ls).sort()));
  });

  await scenario('P2', {
    hg_profile: guestBlob, hg_profile_owner: A,
    ['hg_itemInventory@' + A]: inv('A'), ['hg_cxHoldings@' + A]: cx('A'), ['hg_frTaxLedger@' + A]: led('A'),
  }, async (page) => {
    const h = await held(page);
    ok('P2: A\'s own reload adopts A\'s item / holding / ledger', fmt(ids(h)) === fmt(['zzA_cx', 'zzA_item', 'zzA_tax']), fmt(ids(h)));
    const w = await page.evaluate(() => { Profile.itemInventory.zzA_bought = 1; _persistItemInventoryNow(); return localStorage.getItem('hg_itemInventory@' + _sideAdoptedFor); });
    ok('P2: a purchase in A\'s session is written synchronously to A\'s key', /zzA_bought/.test(w || ''), '');
  });

  await p3('P3', true);

  await scenario('P4', { hg_profile: guestBlob, hg_itemInventory: inv('G'), hg_cxHoldings: cx('G') }, async (page) => {
    const h = await held(page);
    ok('P4: guest play keeps the guest\'s plain side keys (no stamp, save present)', h.items.includes('zzG_item') && h.cx.includes('zzG_cx'), fmt(ids(h)));
    const w = await page.evaluate(() => { Profile.itemInventory.zzG_more = 1; _persistItemInventoryNow(); return localStorage.getItem('hg_itemInventory'); });
    ok('P4: a guest purchase still lands on the plain key', /zzG_more/.test(w || ''), '');
  });

  await scenario('P5', { hg_profile: guestBlob, hg_profile_owner: A, hg_itemInventory: inv('A'), hg_frTaxLedger: led('A') }, async (page) => {
    const h = await held(page);
    ok('P5: pre-upgrade keys beside A\'s stamped save are A\'s and are merged', h.items.includes('zzA_item') && h.tax.includes('zzA_tax'), fmt(ids(h)));
    ok('P5: ...and moved under A\'s name (no plain copy left for the next player)', !h.ls.hg_itemInventory && !!h.ls['hg_itemInventory@' + A], fmt(Object.keys(h.ls).sort()));
  });

  await scenario('P6', {
    hg_profile: guestBlob, hg_profile_owner: A, ['hg_itemInventory@' + A]: inv('A'),
    hg_warpath_grants: JSON.stringify([{ id: 'gA', cards: { zzA_card: 2 }, mats: {}, ts: 1 }]),
  }, async (page) => {
    const r = await page.evaluate(([A, B]) => {
      const out = {};
      // Warpath: the legacy entry was stamped with A at script evaluation.
      out.wpOwner = (JSON.parse(localStorage.getItem('hg_warpath_grants')) || [])[0].u;
      Profile.cardCollection = {};
      out.wpRaisedForA = _wpLedgerRepair('probe');
      out.cardA = Profile.cardCollection.zzA_card | 0;
      // A switch in-session: B's id is set, memory is still A's.
      Profile.cloud.userId = B;
      Profile.itemInventory = { zzA_item: 3, zzA_mem: 1 };
      Profile.cxHoldings = { zzA_cx: { qty: 1 } };
      _persistItemInventoryNow(); _saveCxHoldings(); _frScheduleLedgerSave();
      out.gateB = localStorage.getItem('hg_itemInventory@' + B) || localStorage.getItem('hg_cxHoldings@' + B) || localStorage.getItem('hg_frTaxLedger@' + B);
      Profile.cardCollection = {};
      out.wpRaisedForBMidSwitch = _wpLedgerRepair('probe');
      // The fetch wiped memory and merged B's cloud, which is newer than B's old side copy.
      Profile.itemInventory = {}; Profile.cxHoldings = {}; Profile.frTaxLedger = {};
      localStorage.setItem('hg_itemInventory@' + B, JSON.stringify({ zzB_old: 1 }));
      localStorage.setItem('hg_side_at@' + B, String(1000));
      localStorage.setItem('hg_itemInventory', JSON.stringify({ zzG_stale: 1 }));
      out.adoptOld = _sideAdoptFor(B, 5000);
      out.afterOld = Object.keys(Profile.itemInventory);
      out.guestGone = localStorage.getItem('hg_itemInventory') === null;
      Profile.itemInventory.zzB_new = 1; _persistItemInventoryNow();
      out.writeB = localStorage.getItem('hg_itemInventory@' + B);
      out.stillA = localStorage.getItem('hg_itemInventory@' + A);
      Profile.cardCollection = {};
      out.wpRaisedForB = _wpLedgerRepair('probe');
      // Bmpass is per account.
      grantBmPass(); out.bmB = !!localStorage.getItem('hg_bmPass@' + B);
      Profile.bmPass = 0; Profile.cloud.userId = A; _sideAdoptedFor = A;
      out.bmSeenByA = hasBmPass();
      // A newer side copy (failed push, then someone else used the browser) is recovered.
      Profile.cloud.userId = B; _sideAdoptedFor = A;
      Profile.itemInventory = {};
      localStorage.setItem('hg_itemInventory@' + B, JSON.stringify({ zzB_unsynced: 2 }));
      localStorage.setItem('hg_side_at@' + B, String(9000));
      out.adoptNew = _sideAdoptFor(B, 5000);
      out.afterNew = Object.keys(Profile.itemInventory);
      // Clean sign-out forgets that account's copies and any guest copy.
      localStorage.setItem('hg_cxHoldings', '{"zzG_x":{"qty":1}}');
      _sideForget(B);
      out.forgot = ['hg_itemInventory@' + B, 'hg_side_at@' + B, 'hg_bmPass@' + B, 'hg_cxHoldings'].filter((k) => localStorage.getItem(k) !== null);
      out.adoptedAfterForget = _sideAdoptedFor;
      return out;
    }, [A, B]);
    ok('P6: legacy Warpath ledger entries are stamped with the save\'s owner', r.wpOwner === A, String(r.wpOwner && r.wpOwner.slice(-2)));
    ok('P6: A\'s Warpath repair still restores A\'s card', r.wpRaisedForA === 1 && r.cardA === 2, fmt([r.wpRaisedForA, r.cardA]));
    ok('P6: mid-switch (B signed in, memory still A\'s) nothing is written under B\'s name', r.gateB === null, String(r.gateB));
    ok('P6: mid-switch the Warpath repair applies nothing', r.wpRaisedForBMidSwitch === 0, String(r.wpRaisedForBMidSwitch));
    ok('P6: an OLDER side copy is not adopted over a newer cloud row', r.adoptOld === false && !r.afterOld.length, fmt(r.afterOld));
    ok('P6: adoption retires the plain guest keys', r.guestGone, '');
    ok('P6: after adoption B\'s purchases are written under B\'s name only', /zzB_new/.test(r.writeB || '') && !/zzB_new/.test(r.stillA || ''), '');
    ok('P6: A\'s Warpath entries are never applied to B', r.wpRaisedForB === 0, String(r.wpRaisedForB));
    ok('P6: B\'s Black Market pass is not seen by A', r.bmB && r.bmSeenByA === false, fmt([r.bmB, r.bmSeenByA]));
    ok('P6: a NEWER side copy (unsynced when that account left) is recovered on its sign-in', r.adoptNew === true && r.afterNew.includes('zzB_unsynced'), fmt(r.afterNew));
    ok('P6: _sideForget removes that account\'s copies and the guest copy', !r.forgot.length, fmt(r.forgot));
    ok('P6: after a clean sign-out the tab writes as a guest', r.adoptedAfterForget === '', fmt(r.adoptedAfterForget));
  });
}

/* P3 — the reported residue. `expectClean` false = the HEAD control. */
async function p3(label, expectClean) {
  await scenario(label, { hg_itemInventory: inv('A'), hg_cxHoldings: cx('A'), hg_frTaxLedger: led('A') }, async (page) => {
    const h = await held(page);
    const leak = ids(h).filter((m) => m.startsWith('zzA'));
    if (expectClean) {
      ok(label + ': a signed-out account\'s leftover keys are NOT merged into the next Profile', !leak.length, fmt(leak));
      // The tab is a guest afterwards and may write its OWN (empty) plain keys; none may hold A's ids.
      const left = Object.keys(h.ls).filter((k) => /zzA_/.test(h.ls[k]));
      ok(label + ': ...and no key on the device still holds them', !left.length, fmt(left));
    } else {
      /* Items are not asserted here: with no save on disk the boot-time global reset empties
         itemInventory on both builds, so only the holding and the ledger can show. */
      ok(label + ': HEAD merges the leftover holding and ledger (the leak this probe must be able to see)', leak.includes('zzA_cx') && leak.includes('zzA_tax'), fmt(leak));
    }
  });
}

const t0 = Date.now();
console.log('\n🪪 SIDE-STORE OWNER — per-account hg_itemInventory / hg_cxHoldings / hg_frTaxLedger\n');
try {
  browser = await chromium.launch({ headless: true });
  const pageArg = argVal('page');
  INDEX_BODY = fs.readFileSync(pageArg || path.join(ROOT, 'index.html'));
  console.log('  page: ' + (pageArg || 'public/index.html') + ' · ' + INDEX_BODY.length + ' bytes');
  const pre = await boot({});
  const epoch = await pre.page.evaluate(() => Forge.resetEpoch || 0);
  await pre.context.close();
  guestBlob = JSON.stringify({ gems: 5, itemInventory: {}, heroes: {}, resetEpoch: epoch });
  console.log('  preflight: current reset epoch ' + epoch);
  await mainRun();
  if (!ARGS.includes('--no-negative')) {
    console.log('\n  ── NEGATIVE CONTROL: P3 against the HEAD blob');
    let head = null;
    try { head = execFileSync('git', ['-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'show', 'HEAD:public/index.html'], { maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) { head = null; }
    if (!ok('NEG: HEAD blob read', !!head && head.length > 1e6, head ? head.length + ' bytes' : 'git show failed')) throw new Error('no HEAD');
    if (head.includes(Buffer.from('function _sideWrite('))) {
      console.log('  (HEAD already carries the fix — using a throwaway copy of the candidate with the owner rule removed)');
      let s = INDEX_BODY.toString('utf8');
      const anchor = 'function _sideSettleLegacy() {';
      ok('NEG: mutant anchor found once', s.split(anchor).length === 2, '');
      s = s.replace(anchor, anchor + ' return;').replace('function _sideReadJson(base, owner) {', 'function _sideReadJson(base, owner) { owner = \'\';');
      INDEX_BODY = Buffer.from(s);
    } else {
      INDEX_BODY = head;
    }
    await p3('NEG-P3', false);
  }
} catch (e) {
  ok('harness ran to the end', false, String(e && e.stack || e).slice(0, 300));
} finally {
  try { if (browser) await browser.close(); } catch (e) {}
  server.close();
}
console.log('\n  ' + passes + ' passed, ' + fails + ' failed · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
