/* ══════════════════════════════════════════════════════════════════════════
   🏦 DRIVE-VAULT-DEPOSIT — can a player actually deposit what they own?

   THE REPORT (filed three times): "SOME players cannot deposit into the
   corporation vault." Two earlier rounds chased permissions, membership rows
   and RPC failures. All of that was real and all of it is fixed — and none of
   it was this.

   THE ACTUAL SHAPE: the deposit list was built by walking SALVAGE_RES, the
   tombstone-loot DROP TABLE, while the player's holdings live in
   Profile.salvage, seeded from RESOURCES. The tables overlap by 14 ids out of
   108. So whether you could deposit depended on WHICH resources you owned —
   salvage stock listed, city stock vanished — which is exactly what "some
   players" looks like from the outside.

   ⚠ THIS DRIVES THE REAL _jbDepositable() AND _jbEcon(), the two functions the
     corp iframe actually reads. A test that rebuilt either would be asserting
     against its own copy of the very lookup that was wrong.

   ⚠ IT PROVES THE TEST CAN FAIL. The old table walk is re-run here against the
     same seeded profile as a CONTROL. If the control does not drop the
     city-economy resources, this driver is not measuring the bug and says so
     rather than passing.

   Run:  node .gauntlet/drive-vault-deposit.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 7460 + (process.pid % 80);
const s = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => s.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 150)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _jbDepositable==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4000);

const r = await pg.evaluate(() => {
  const o = {};
  o.reachable = (typeof _jbDepositable === 'function') && (typeof _ensureResources === 'function')
             && (typeof _jbEcon === 'function');
  if (!o.reachable) return o;

  // The live store, reached through the game's own accessor — Profile is a
  // top-level const and is NOT on window (the lexical-binding trap).
  const R = _ensureResources();
  Object.keys(R).forEach(k => { R[k] = 0; });        // clean slate, no stray stock

  // CITY-ECONOMY stock: in RESOURCES, absent from SALVAGE_RES. This is what
  // used to vanish.
  const CITY = ['coal', 'lumber', 'copperOre', 'electricity', 'wheat', 'plastic'];
  // SALVAGE stock: in both tables. This always worked, and must keep working.
  const SALV = ['metal', 'ammo', 'medicine'];
  CITY.forEach((k, i) => { R[k] = 100 + i; });
  SALV.forEach((k, i) => { R[k] = 500 + i; });

  const dep = _jbDepositable();
  const got = new Set((dep.resources || []).map(x => x.id));
  o.total       = (dep.resources || []).length;
  o.cityListed  = CITY.filter(k => got.has(k));
  o.cityMissing = CITY.filter(k => !got.has(k));
  o.salvListed  = SALV.filter(k => got.has(k));
  o.salvMissing = SALV.filter(k => !got.has(k));

  // Quantities and labels must survive, not just the ids.
  const coal = (dep.resources || []).find(x => x.id === 'coal') || null;
  o.coalQty  = coal ? coal.qty : null;
  o.coalName = coal ? coal.name : null;
  o.coalIcon = coal ? coal.icon : null;
  o.everyRowUsable = (dep.resources || []).every(x => x.name && x.qty > 0);

  // Zero-quantity stock must NOT be offered.
  R.tungsten = 0;
  o.zeroHidden = !((_jbDepositable().resources || []).some(x => x.id === 'tungsten'));

  // The econ payload (the corp app's own resource panel) shares the fix.
  const econ = _jbEcon();
  const eg = new Set(((econ && econ.resources) || []).map(x => x.id));
  o.econCityListed = CITY.filter(k => eg.has(k));

  // ── CONTROL: the OLD table walk, on this same profile ──────────────────
  // If this does not drop the city stock, the driver is not measuring the bug.
  const pool = (typeof SALVAGE_RES !== 'undefined' ? SALVAGE_RES : []);
  const oldIds = new Set(pool.filter(x => (R[x.id] | 0) > 0).map(x => x.id));
  o.controlTotal     = oldIds.size;
  o.controlDropsCity = CITY.filter(k => !oldIds.has(k));
  o.controlKeepsSalv = SALV.filter(k => oldIds.has(k));
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F3E6} CORP VAULT — DEPOSITABLE LIST\n');
ok('the deposit bridge is reachable (else nothing below ran)', r.reachable === true);
if (r.reachable) {
  console.log('   ANTI-VACUITY CONTROL — the old SALVAGE_RES walk on this same profile');
  ok('   the control DROPS the city-economy stock (proves the bug was real)',
     r.controlDropsCity && r.controlDropsCity.length === 6, (r.controlDropsCity || []).join(', '));
  ok('   the control KEEPS the salvage stock (proves it was selective, not blind)',
     r.controlKeepsSalv && r.controlKeepsSalv.length === 3, (r.controlKeepsSalv || []).join(', '));
  console.log('   control listed ' + r.controlTotal + ' of 9 owned resources\n');

  ok('\u{1F3AF} city-economy resources are now depositable',
     r.cityMissing && r.cityMissing.length === 0,
     'listed: ' + (r.cityListed || []).join(', ') + (r.cityMissing.length ? ('  MISSING: ' + r.cityMissing.join(', ')) : ''));
  ok('\u{1F3AF} salvage resources still depositable (no regression)',
     r.salvMissing && r.salvMissing.length === 0, (r.salvListed || []).join(', '));
  ok('all 9 owned resources are offered', r.total === 9, r.total + ' listed');
  console.log('');
  ok('quantity survives the lookup', r.coalQty === 100, 'coal qty ' + r.coalQty);
  ok('coal gets a real name, not a bare id', r.coalName === 'Coal', String(r.coalName));
  ok('coal gets an icon', !!r.coalIcon, String(r.coalIcon));
  ok('every listed row has a name and a positive qty', r.everyRowUsable === true);
  ok('a zero-quantity resource is NOT offered', r.zeroHidden === true);
  console.log('');
  ok('the corp econ panel shares the fix', r.econCityListed && r.econCityListed.length === 6,
     (r.econCityListed || []).join(', '));
}
console.log('\npage errors: ' + errs.length); errs.slice(0, 3).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails ? 1 : 0);
