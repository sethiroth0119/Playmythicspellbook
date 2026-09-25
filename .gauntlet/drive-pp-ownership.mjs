/* ══════════════════════════════════════════════════════════════════════════
   🚗 DRIVE-PP-OWNERSHIP — can a bought car be discarded on the next load?

   THE REPORT: a player wins a car in the Prince Portfolio auction, pays for
   it, and later finds it gone.

   THE MECHANISM UNDER TEST. The cloud restore does NOT merge the vehicle lot —
   it picks one whole copy over the other:

       Profile.princePortfolios = _preferRicherObj(cloudCopy, localCopy)

   and "richer" is `_approxDataWeight()`, a recursive byte-ish size of the
   ENTIRE object. But princePortfolios holds the lot AND an event log that
   grows with every auction, sale and strip. So the comparison is not
   "who owns more cars" — it is "whose blob is bigger", and a chatty log on the
   stale side outweighs a whole vehicle on the fresh side.

   That is precisely the failure the brief names: missing/lighter client data
   being treated as authority to drop an owned asset.

   ⚠ IT PROVES THE TEST CAN FAIL. The plain case (same log, one extra car) must
     KEEP the car. If that also failed, the probe would be measuring something
     other than the log confounder.

   Run:  node .gauntlet/drive-pp-ownership.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8320 + (process.pid % 50);
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
await pg.waitForFunction('typeof _preferRicherObj==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(3500);

const r = await pg.evaluate(() => {
  const o = {};
  o.reachable = typeof _preferRicherObj === 'function' && typeof _approxDataWeight === 'function';
  if (!o.reachable) return o;
  o.hasMerge = typeof _mergePrincePortfolios === 'function';

  const car = (id) => ({ id: id, name: 'Armored Freight Truck', type: 'truck', color: '#333',
    condition: 82, mileage: 41000, riskLevel: 'Low', price: 85000, estPartValue: 30000,
    baseValue: 90000, sellerRating: 5, rarity: 'rare', boughtAt: Date.now(),
    fuelLevel: 0, listPrice: 114750, slot: 0, modelUrl: '', modelScale: 1, modelRotY: 0 });
  const logLines = (n, txt) => Array.from({ length: n }, (_, i) => ({ k: 'event', t: txt + ' #' + i }));

  // ── A. The plain case. Same log both sides; local has ONE more car. ────
  const cloudA = { lot: [car('v1'), car('v2')], log: logLines(10, 'sold a part'), lotLevel: 2 };
  const localA = { lot: [car('v1'), car('v2'), car('v3')], log: logLines(10, 'sold a part'), lotLevel: 2 };
  const wonA = _preferRicherObj(cloudA, localA);
  o.plainKeepsCar = (wonA.lot || []).length === 3;

  // ── B. THE REPORTED SHAPE. The stale cloud copy has a FATTER LOG; the
  //      fresh local copy has the car the player just paid for. ───────────
  const cloudB = { lot: [car('v1'), car('v2')], log: logLines(140, 'auction round closed with no sale'), lotLevel: 2 };
  const localB = { lot: [car('v1'), car('v2'), car('v3')], log: logLines(4, 'auction WIN'), lotLevel: 2 };
  o.weightCloud = _approxDataWeight(cloudB, 0);
  o.weightLocal = _approxDataWeight(localB, 0);
  const wonB = _preferRicherObj(cloudB, localB);
  o.wonLot = (wonB.lot || []).length;
  o.carSurvivesToday = (wonB.lot || []).some(v => v && v.id === 'v3');

  // ── C. If the repair exists, it must union by vehicle id. ──────────────
  if (o.hasMerge) {
    const m = _mergePrincePortfolios(cloudB, localB);
    o.mergedLot = (m.lot || []).length;
    o.mergedKeepsAll = ['v1', 'v2', 'v3'].every(id => (m.lot || []).some(v => v && v.id === id));
    o.mergedNoDupes = new Set((m.lot || []).map(v => v && v.id)).size === (m.lot || []).length;
    // and the reverse direction must be just as safe
    const m2 = _mergePrincePortfolios(localB, cloudB);
    o.mergeSymmetric = (m2.lot || []).length === o.mergedLot;
    // a car only the CLOUD has must survive a thin local copy too
    const thin = { lot: [car('v1')], log: [] };
    const fat = { lot: [car('v1'), car('v9')], log: logLines(80, 'x') };
    o.cloudOnlyCarSurvives = (_mergePrincePortfolios(fat, thin).lot || []).some(v => v && v.id === 'v9');

    /* 🪦 THE OTHER HALF, and the reason a plain union would be wrong. The
       player SOLD v2. The stale cloud copy still lists it. A union with no
       tombstones hands the car back — which is duplication wearing the mask of
       a fix, and would be worse than the original bug. */
    const staleWithSold = { lot: [car('v1'), car('v2')], log: logLines(90, 'old') };
    const freshAfterSale = { lot: [car('v1')], retired: [{ id: 'v2', at: Date.now(), why: 'scrapped' }], log: [] };
    const afterSale = _mergePrincePortfolios(staleWithSold, freshAfterSale);
    o.soldStaysSold = !(afterSale.lot || []).some(v => v && v.id === 'v2');
    o.keptTheRest = (afterSale.lot || []).some(v => v && v.id === 'v1');
    o.tombstoneKept = (afterSale.retired || []).some(t => t && t.id === 'v2');
    // a paid capacity upgrade may only go up
    o.lotLevelMax = _mergePrincePortfolios({ lot: [], lotLevel: 1 }, { lot: [], lotLevel: 3 }).lotLevel === 3;
  }
  return o;
});

/* ── THE PURCHASE ITSELF: pay, fail the save, and check the player is whole. ── */
const txn = await pg.evaluate(() => {
  const o = {};
  if (typeof _ppaWin !== "function") { o.skip = true; return o; }
  try { localStorage.setItem("mg_onboarded", "1"); } catch (e) {}
  Profile.gems = 500000;
  Profile.princePortfolios = { lot: [], log: [], lotLevel: 3 };
  const car = { name: "Armored Freight Truck", type: "truck", color: "#333", condition: 82,
    mileage: 41000, value: 90000, baseValue: 90000, rarity: { key: "Rare" }, modelUrl: "" };
  // the auction screen state _ppaWin writes into
  _ppaS = { status: "live", log: [], won: 0 };   // bare assignment: _ppaS is module-scoped, not on window

  // ── A. HAPPY PATH ────────────────────────────────────────────────────
  const gems0 = Profile.gems | 0;
  _ppaWin(car, 85000, "buynow");
  o.okStatus = _ppaS.status;
  o.okLot = (Profile.princePortfolios.lot || []).length;
  o.okCharged = gems0 - (Profile.gems | 0);

  // ── B. IDEMPOTENCY: a second win must not charge or duplicate ────────
  const gems1 = Profile.gems | 0;
  _ppaWin(car, 85000, "buynow");
  o.dupLot = (Profile.princePortfolios.lot || []).length;
  o.dupCharged = gems1 - (Profile.gems | 0);

  // ── C. ROLLBACK: make the save refuse, then buy ──────────────────────
  Profile.princePortfolios = { lot: [], log: [], lotLevel: 3 };
  _ppaS = { status: "live", log: [], won: 0 };   // bare assignment: _ppaS is module-scoped, not on window
  const realSave = window.saveProfile;
  try { window.saveProfile = function () { return false; }; } catch (e) {}
  const gems2 = Profile.gems | 0;
  _ppaWin(car, 85000, "buynow");
  o.rbStatus = _ppaS.status;
  o.rbLot = (Profile.princePortfolios.lot || []).length;
  o.rbNet = (Profile.gems | 0) - gems2;
  try { window.saveProfile = realSave; } catch (e) {}
  return o;
});
let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F697} PRINCE PORTFOLIO — VEHICLE OWNERSHIP ON RELOAD\n');
ok('the restore helpers are reachable (else nothing below ran)', r.reachable === true);
if (r.reachable) {
  console.log('  ── CONTROL · same log on both sides, local has one more car');
  ok('   the extra car is kept', r.plainKeepsCar === true,
     'so the probe is not just "richer always wins"');

  console.log('\n  ── THE REPORTED SHAPE · stale cloud with a fatter LOG');
  console.log('     cloud blob weight ' + r.weightCloud + '  (2 cars, 140 log lines)');
  console.log('     local blob weight ' + r.weightLocal + '  (3 cars, 4 log lines)');
  /* ⚠ THIS IS THE CONTROL, NOT A REGRESSION. _preferRicherObj is the generic
     blob-picker and it still behaves exactly as it always did — that is
     correct for photos, flags and counters. What was wrong was ROUTING
     OWNERSHIP THROUGH IT, and this line is the measurement of why: the old
     rule really does drop a paid-for car. The restore path no longer calls it
     for the lot; the assertions below are on the merge that replaced it. */
  ok('   CONTROL — the OLD rule DOES lose the paid-for car (so the bug is real)',
     r.carSurvivesToday === false,
     'kept only ' + r.wonLot + ' of 3 cars — the fatter log won');

  console.log('\n  ── THE REPAIR · ownership merged by id, never chosen by weight');
  ok('a dedicated vehicle merge exists', r.hasMerge === true);
  if (r.hasMerge) {
    ok('\u{1F3AF} every car from BOTH copies survives', r.mergedKeepsAll === true, 'lot=' + r.mergedLot);
    ok('…with no duplicates', r.mergedNoDupes === true);
    ok('…whichever way round the two copies arrive', r.mergeSymmetric === true);
    ok('\u{1F3AF} a car only the SERVER has is not dropped by a thin local copy',
       r.cloudOnlyCarSurvives === true);

    console.log('\n  ── …and a union must NOT hand back what was sold');
    ok('\u{1F3AF} a SOLD car stays sold, even against a stale copy that still lists it',
       r.soldStaysSold === true, r.soldStaysSold ? 'stayed sold' : 'RESURRECTED — the union duplicated it');
    ok('…while the cars that were kept are still there', r.keptTheRest === true);
    ok('the tombstone itself survives the merge', r.tombstoneKept === true);
    ok('a paid lot upgrade can only ever go UP', r.lotLevelMax === true);
  }

  if (txn.skip) {
    ok('the auction win handler was reachable', false, '_ppaWin not found — transaction checks did NOT run');
  } else {
    console.log('\n  ── THE PURCHASE · pay, save, verify, or refund');
    ok('a good purchase completes', txn.okStatus === 'sold' && txn.okLot === 1,
       txn.okStatus + ' · lot ' + txn.okLot);
    ok('…and charges exactly once', txn.okCharged === 85000, txn.okCharged + ' cinder');
    ok('\u{1F3AF} a repeated win does NOT charge again', txn.dupCharged === 0, txn.dupCharged + ' cinder');
    ok('\u{1F3AF} …nor create a second car', txn.dupLot === 1, 'lot ' + txn.dupLot);
    ok('\u{1F3AF} when the save REFUSES, no car is kept', txn.rbLot === 0, 'lot ' + txn.rbLot);
    ok('\u{1F3AF} …and the player is refunded in full', txn.rbNet === 0, 'net ' + txn.rbNet + ' cinder');
    ok('…and is never told the sale succeeded', txn.rbStatus !== 'sold', txn.rbStatus);
  }
}
console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
