/* ══════════════════════════════════════════════════════════════════════════
   🔐 DRIVE-OPSGATES — ONE OWNERSHIP PREDICATE, ONE SCOPE.

   "Does this player hold operation <type>?" used to be answered by thirteen
   hand-rolled scans, and no two of them agreed. Four read Operations.list
   alone (empty until opFetch lands); four demanded `status === 'active'` (so a
   legacy row carrying no status opened the Dojo and left the Oil Co. locked);
   four accepted a Profile flag beside the row; the city and the corp app were
   handed every row regardless of status. One row could open the Just Business
   door, lock the city PLACE card and leave the mini-game half-unlocked at the
   same time.

   THIS FILE IS THE MEASUREMENT, not a description of it. It sets ONE row's
   status to 'retired' through __mg.ops.rows() — the live objects — and asserts
   that every surface for that row revokes in the same read:
       · the Just Business door        (_jbEcon().operations → My Companies)
       · the mini-game unlock          (wf/br/fc/ppIsUnlocked)
       · the city PLACE card           (cityOpsState().ops → node-city)
       · both "my operations" seams    (StorageBridge, MythicPlagueBridge)
       · the warehouse ceiling         (_warehouseCapacity)
   …and that every other predicate in the file answers from the same rule, and
   that NOTHING ELSE moved: 12 of the 13 gates stay open.

   ⚠ THE CONTROL MATTERS AS MUCH AS THE REVOCATION. A rule that just said
     "status === 'active'" would pass the retire test and silently revoke a
     LEGACY row with no status at all, and a paid licence quietly revoked is
     worse than the bug being fixed. So phase C re-runs the whole board on a
     row with `status` deleted, and on an unknown status ('paused'), and every
     gate must still be OPEN.

   ⚠ AND THE FLAGS. Removing `Profile.dojoUnlocked` & friends as a second
     source of truth would take a licence away from anyone holding the flag
     with no row. Phase D asserts _opsAdoptOwnedCompanies mints the row, so the
     door stays open — through a row every other surface can see.

   Run:  node .gauntlet/drive-opsgates.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.txt': 'text/plain', '.glb': 'model/gltf-binary' };
const P = 9600 + (process.pid % 190);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
// Everything off-box is 502'd: this drives the client's own logic, and a real
// network call would make the run depend on the live database.
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1:' + P)) return r.continue();
  return r.fulfill({ status: 502, contentType: 'text/plain', body: '// offline' });
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _ownsOp === "function" && typeof window.cityOpsState === "function"',
  null, { timeout: 150000 });

const r = await pg.evaluate(async () => {
  const o = {};
  /* No cloud, no corp: every row below is a LOCAL row on the profile, which is
     the shape a signed-out client actually has, and the shape _opsAllRows must
     answer for from the first frame. */
  try { Profile.cloud = Profile.cloud || {}; Profile.cloud.signedIn = false; } catch (e) {}
  window.isAdmin = () => false;               // admin bypasses every gate; not the subject

  const rowOf = (type, extra) => Object.assign({
    id: 'drv_' + type, corp_id: 'local', op_type: type, level: 1, workers: 3,
    status: 'active', meta: { lastCollect: Date.now(), localOnly: true },
    created_at: new Date().toISOString(),
  }, extra || {});

  // A clean slate: no rows, no company blobs, no licence flags.
  const reset = () => {
    Profile.jbLocalOps = [];
    Operations.list = []; Operations._fetched = Date.now(); Operations.fetchFailed = false;
    ['fishingCorp', 'blackRiver', 'fuelCommand', 'princePortfolios'].forEach((k) => {
      if (Profile[k] && typeof Profile[k] === 'object') Profile[k].owned = false;
    });
    Profile.dojoUnlocked = false; Profile.weaponSmithUnlocked = false;
    Profile.cardShopUnlocked = false; Profile.geneLabUnlocked = false;
  };

  /* Every surface, read the way its real consumer reads it. `door` is the My
     Companies sidebar's own source (corp/shell.jsx: JB.operations); `place` is
     node-city's (opsRowsOf over cityOpsState().ops). */
  const board = () => {
    const jb = (function () { try { return _jbEcon().operations || []; } catch (e) { return []; } })();
    const cs = (function () { try { return window.cityOpsState().ops || []; } catch (e) { return []; } })();
    return {
      bank: _ownsBankOp(), dojo: _dojoOwnsLicense(), genelab: _geneLabOwnsLicense(),
      weaponsmith: _wsOwnsLicense(), cardshop: _csOwnsLicense(), restaurant: _ownsRestaurant(),
      transport: _transportOps().length > 0, research: _labOwnsResearch(),
      // The Just Business desk's own `ownsWh`, read where the app reads it.
      warehouse: (function () { try { return !!_jbDesks().warehouse.owns; } catch (e) { return false; } })(),
      fishing: wfIsUnlocked(), cars: ppIsUnlocked(), oil: brIsUnlocked(), gas: fcIsUnlocked(),
      door: jb.map(x => x.op_type).sort(),
      place: cs.map(x => x.type).sort(),
      /* The storage office's own hand-over (window.StorageBridge.operations),
         which has to be the same rows — the office and the ceiling disagreeing
         about "my operations" is the failure that seam exists to prevent.
         NOT wrapped in a try: a missing bridge must fail this run, not pass it
         with an empty list that trivially "does not contain" the retired row. */
      bridgeOps: (window.StorageBridge.operations() || []).map(x => x.op_type).sort(),
      // The other hand-over of "my operations", read by the plague module.
      mgOps: (window.MythicPlagueBridge.myOps() || []).map(x => x.op_type).sort(),
      whCap: (function () { try { return _warehouseCapacity(); } catch (e) { return -1; } })(),
    };
  };

  const TYPES = ['bank', 'dojo', 'genelab', 'weaponsmith', 'cardshop', 'restaurant',
                 'transport', 'research', 'warehouse', 'fishing', 'cars', 'oil', 'gas'];

  // ── A. NOTHING OWNED ─────────────────────────────────────────────────────
  reset();
  o.empty = board();

  // ── B. ONE ROW EACH, THEN RETIRE THE LOT ─────────────────────────────────
  reset();
  Operations.list = TYPES.map(t => rowOf(t));
  o.owned = board();

  // Retire ONE row — the Fishing Co. — and read every surface again.
  (function () {
    const rows = window.__mg.ops.rows();
    const f = rows.find(x => x && x.op_type === 'fishing');
    if (f) f.status = 'retired';
  })();
  o.afterRetireFishing = board();

  // …then retire the rest, one status field at a time.
  window.__mg.ops.rows().forEach((x) => { x.status = 'retired'; });
  o.allRetired = board();

  // ── C. CONTROL — a row this client cannot classify must still COUNT ──────
  reset();
  Operations.list = TYPES.map(t => { const x = rowOf(t); delete x.status; return x; });
  o.noStatus = board();
  reset();
  Operations.list = TYPES.map(t => rowOf(t, { status: 'paused' }));
  o.unknownStatus = board();

  // ── D. THE LICENCE FLAGS SURVIVE AS ROWS ────────────────────────────────
  reset();
  Profile.dojoUnlocked = true; Profile.weaponSmithUnlocked = true;
  Profile.cardShopUnlocked = true; Profile.geneLabUnlocked = true;
  o.flagsOnly = board();
  o.flagRows = _opsAllRows().filter(x => x && String(x.id).indexOf('company_') === 0)
                            .map(x => x.op_type + ':' + ((x.meta && x.meta.fundedBy) || '')).sort();

  // ── E. …AND A FLAG CANNOT RESURRECT A RETIRED ROW ───────────────────────
  reset();
  Operations.list = [rowOf('dojo', { status: 'retired' })];
  Profile.dojoUnlocked = true;
  o.flagVsRetiredRow = { dojo: _dojoOwnsLicense(), minted: _opsAllRows().length };

  reset();
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
const GATES = ['bank', 'dojo', 'genelab', 'weaponsmith', 'cardshop', 'restaurant', 'transport',
               'research', 'warehouse', 'fishing', 'cars', 'oil', 'gas'];
const allGates = (b, want) => GATES.filter(k => !!b[k] !== want);

console.log('\n\u{1F510} ONE OWNERSHIP PREDICATE, ONE SCOPE\n');

console.log('  \u{2500}\u{2500} A. nothing owned');
ok('every one of the 13 gates is shut', allGates(r.empty, false).length === 0,
   'open with no row: [' + allGates(r.empty, false).join(', ') + ']');
ok('the city is offered no operation', r.empty.place.length === 0, JSON.stringify(r.empty.place));

console.log('\n  \u{2500}\u{2500} B. one active row each');
ok('all 13 gates open', allGates(r.owned, true).length === 0,
   'still shut with a row: [' + allGates(r.owned, true).join(', ') + ']');
ok('the Just Business door lists all 13', r.owned.door.length === 13, r.owned.door.length + ' door(s)');
ok('the city PLACE list carries all 13', r.owned.place.length === 13, r.owned.place.length + ' row(s)');
ok('both "my operations" bridges carry all 13',
   r.owned.bridgeOps.length === 13 && r.owned.mgOps.length === 13,
   r.owned.bridgeOps.length + ' storage / ' + r.owned.mgOps.length + ' __mg');
ok('the warehouse ceiling is a real number', r.owned.whCap > 0, r.owned.whCap + ' units');

console.log('\n  \u{2500}\u{2500} \u{1F3AF} THE DRIVE · one row set to status=\'retired\'');
ok('the mini-game unlock revokes', r.afterRetireFishing.fishing === false, 'wfIsUnlocked=' + r.afterRetireFishing.fishing);
ok('the Just Business door closes in the SAME read',
   !r.afterRetireFishing.door.includes('fishing'), JSON.stringify(r.afterRetireFishing.door));
ok('the city PLACE card goes with it (node-city transitOwns/opsRowsOf source)',
   !r.afterRetireFishing.place.includes('fishing'), JSON.stringify(r.afterRetireFishing.place));
ok('the storage-office bridge drops it too (12 rows, no fishing)',
   r.afterRetireFishing.bridgeOps.length === 12 && !r.afterRetireFishing.bridgeOps.includes('fishing'),
   JSON.stringify(r.afterRetireFishing.bridgeOps));
ok('…and so does __mg.myOps, the other "my operations" hand-over',
   r.afterRetireFishing.mgOps.length === 12 && !r.afterRetireFishing.mgOps.includes('fishing'),
   JSON.stringify(r.afterRetireFishing.mgOps));
ok('\u{1F3AF} and NOTHING ELSE moved — 12 of 13 gates still open',
   allGates(r.afterRetireFishing, true).join(',') === 'fishing',
   'shut: [' + allGates(r.afterRetireFishing, true).join(', ') + ']');

console.log('\n  \u{2500}\u{2500} every row retired');
ok('all 13 gates shut together', allGates(r.allRetired, false).length === 0,
   'still open: [' + allGates(r.allRetired, false).join(', ') + ']');
ok('the door is empty', r.allRetired.door.length === 0, JSON.stringify(r.allRetired.door));
ok('the city PLACE list is empty', r.allRetired.place.length === 0, JSON.stringify(r.allRetired.place));
ok('the warehouse ceiling falls to 0', r.allRetired.whCap === 0, r.allRetired.whCap + ' units');

console.log('\n  \u{2500}\u{2500} C. CONTROL · the rule may not revoke what it does not recognise');
ok('a LEGACY row with no status at all still opens all 13', allGates(r.noStatus, true).length === 0,
   'wrongly shut: [' + allGates(r.noStatus, true).join(', ') + ']');
ok('…and reaches the city and the door', r.noStatus.place.length === 13 && r.noStatus.door.length === 13,
   r.noStatus.place.length + ' place / ' + r.noStatus.door.length + ' door');
ok('an UNKNOWN status (\'paused\') still opens all 13', allGates(r.unknownStatus, true).length === 0,
   'wrongly shut: [' + allGates(r.unknownStatus, true).join(', ') + ']');

console.log('\n  \u{2500}\u{2500} D. the legacy licence flags become rows, so nobody loses a licence');
ok('dojo / weaponsmith / cardshop / genelab open on the flag alone',
   ['dojo', 'weaponsmith', 'cardshop', 'genelab'].every(k => r.flagsOnly[k] === true),
   JSON.stringify(['dojo', 'weaponsmith', 'cardshop', 'genelab'].map(k => k + '=' + r.flagsOnly[k])));
ok('…because each was ADOPTED as a row, not read as a flag', r.flagRows.length === 4,
   JSON.stringify(r.flagRows));
ok('…and that row is what the city and the door are handed',
   ['cardshop', 'dojo', 'genelab', 'weaponsmith'].every(t => r.flagsOnly.place.includes(t)),
   JSON.stringify(r.flagsOnly.place));

console.log('\n  \u{2500}\u{2500} E. …and a stale flag cannot resurrect a retired row');
ok('a retired dojo row beats Profile.dojoUnlocked', r.flagVsRetiredRow.dojo === false,
   '_dojoOwnsLicense=' + r.flagVsRetiredRow.dojo);
ok('no second dojo row was minted beside it', r.flagVsRetiredRow.minted === 1,
   r.flagVsRetiredRow.minted + ' row(s)');

console.log('\npage errors: ' + errs.length); errs.slice(0, 5).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n❌ ' + fails + ' CHECK(S) FAILED') : '\n✅ ALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
