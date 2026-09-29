/* ══════════════════════════════════════════════════════════════════════════
   🧬🏕 DRIVE-LABCAMP-SYNC — the Camp and the Lab travel with the account,
   and the daily latches do NOT get merged like facilities.

   THE BUG. Cross-device portability in public/index.html is a hand-maintained
   per-key allow-list: the `forgeSmall` object literal in cloudSyncProfile() and
   a matching hydration block in cloudFetchProfile(). Two whole progression
   stores were outside it. Lab (fusion / breeding embryos) wrote only to
   localStorage['hg_lab']; Camp (daycare slots, facilities, workers) only to
   localStorage['hg_camp']. But the Cinder that paid for both is debited against
   the CANONICAL server row — breedToCore() charges BREED_COST_CINDER (2,500)
   through spendGems, and campStartBuild / parkInCamp / hireCampRoomWorker all
   charge through _serverMirrorCharge.

   So the loss was asymmetric and always in the house's favour. Breed on device
   A: the 20-hour parent cooldown syncs (__breedCooldowns__ is uploaded and
   MAX-merged), the embryo does not. Sign in on device B and the player has
   paid, is locked out of re-breeding BOTH parents, and has nothing to hatch.
   Parked units are additionally subtracted from deckKeyOwnedCount, so the two
   devices disagreed about which cards were legal in a deck.

   WHAT THIS DRIVER PINS DOWN — the merges, not the transport:
     · Lab.cores is UNION by core.id. A core made on either device survives, no
       id appears twice, and a core already carrying `hatchedCardId` is NOT
       resurrected into the incubator from the cloud side (it is a spent
       receipt; the card it minted already rides customCards / cardCollection,
       and re-incubating it would mint a second copy of the same offspring).
     · Camp facilities merge per-facility taking the HIGHER `level` — a built
       level was paid for and can never regress.
     · Camp slots union by slot id AND by kind:refId, so a unit parked on either
       device stays parked EXACTLY ONCE.
     · 🔴 THE ONE THAT PAYS REAL CINDER. The four `__`-prefixed daily latches
       stored under Camp.facilities — __tithe, __rnr, __meta, __smuggler — are
       NOT facilities and must merge on a separate path, taking the LATER
       day/window. A latch has no `level`, so a blanket max-by-level compares
       0 against 0 and can hand back the OLDER day. _campCollectTithe() calls
       addGems and the smuggler board pays through _serverMirrorCredit, so a
       re-opened latch is real Cinder minted twice off one day. §6 reconstructs
       exactly that wrong merge and asserts it IS destructive, so a green run
       here means "the separate path changed something", not "the test agrees
       with itself".
     · saveCamp()/saveLab() still write hg_camp/hg_lab on every change. The
       cloud copy is a second home, not a replacement.
     · The payload is size-guarded: capped AND run through _stripDataUrls, the
       way __unopenedPacks__ is. A Lab core embeds TWO full parent snapshots
       (stats + learnset + memories), and this file records real `canceling
       statement due to statement timeout` (57014) aborts from oversized forge
       rows — an abort takes the WHOLE profile upsert down, losing far more than
       the embryos this is trying to save.

   ⚠ WHAT THIS DRIVER CANNOT PROVE — read this before believing anything above.
     It does NOT show that the save travels. No Supabase project is contacted,
     no user_profiles row is written or read, and nothing here is signed in.
     The cloud blob is a literal typed by this file and handed straight to the
     shipped hydration block. TRUE two-device behaviour needs a live Supabase
     project and two authenticated browsers on the same account, and that has
     NOT been done. What is proven is the SHAPE of the merge: union-by-id,
     max-by-level, later-of-latch — nothing about the round trip.

   ⚠ IT RUNS THE SHIPPED HYDRATION TEXT. The camp/lab clauses are sliced out of
     public/index.html and evaluated against the booted page's own globals
     (_mergeLabCores, _mergeCampFacilities, saveLab, saveCamp…), reached through
     the window.__mg.labcamp diagnostics seam — Lab and Camp are top-level
     `const` in that script and are invisible to a driver otherwise, the same
     lexical-binding trap node-city's window.__nc seam exists for. A driver
     carrying its own copy of the merge would be testing its own copy.

   Run:  node .gauntlet/drive-labcamp-sync.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8790 + (process.pid % 40);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('\n\u{1F9EC}\u{1F3D5} LAB + CAMP TRAVEL WITH THE ACCOUNT — UNION BY ID, MAX BY LEVEL, LATER-OF LATCH\n');

/* ── STATIC PASS ─────────────────────────────────────────────────────────── */
const HTML = fs.readFileSync('public/index.html', 'utf8');

console.log('  ── static: both halves of the whitelist');
for (const key of ['__labCores__', '__campSlots__', '__campMaxSlots__', '__campFacilities__', '__campWorkers__']) {
  const n = HTML.split(key).length - 1;
  ok('`' + key + '` appears in the upload literal AND the hydration block', n >= 2, 'x' + n);
}

/* The upload literal spans one object; the hydration lives inside
   cloudFetchProfile. Locate both by their own anchors rather than by line
   number — every line number in this file moves on the next edit. */
const upAt  = HTML.indexOf('const forgeSmall = {');
const upEnd = HTML.indexOf('const rowRaw = {', upAt);
const UPLOAD = (upAt < 0 || upEnd < 0) ? '' : HTML.slice(upAt, upEnd);
const hyAt  = HTML.indexOf('      // \u{1FAA6} Removal tombstones first');
const hyEnd = HTML.indexOf('      // \u{1F381} Chest + key inventories — MAX-per-key merge', hyAt);
const HYDRATION = (hyAt < 0 || hyEnd < 0) ? '' : HTML.slice(hyAt, hyEnd);

ok('the forgeSmall upload literal was located', UPLOAD.length > 1000, UPLOAD.length + ' chars');
ok('the lab/camp hydration block was located', HYDRATION.length > 500, HYDRATION.length + ' chars');
for (const key of ['__labCores__', '__campSlots__', '__campMaxSlots__', '__campFacilities__', '__campWorkers__']) {
  ok('  upload literal carries ' + key, UPLOAD.includes(key));
  ok('  hydration block reads ' + key, HYDRATION.includes(key));
}

console.log('\n  ── static: no bare assignment where a merge was required');
/* Strip comments before matching. The WHY comments above these clauses quote
   the very anti-pattern being asserted against ("a straight `Lab.cores =
   f.__labCores__` here would be…"), so an un-stripped match would fail on a
   correct build. */
const hydCode = HYDRATION.split('\n').filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join('\n');
ok('cores hydrate through _mergeLabCores, not `Lab.cores = f.__labCores__`',
  /_mergeLabCores\(/.test(hydCode) && !/cores\s*=\s*f\.__labCores__\s*;/.test(hydCode));
ok('slots hydrate through _mergeCampSlots, not `= f.__campSlots__`',
  /_mergeCampSlots\(/.test(hydCode) && !/slots\s*=\s*f\.__campSlots__\s*;/.test(hydCode));
ok('workers hydrate through _mergeCampWorkers, not `= f.__campWorkers__`',
  /_mergeCampWorkers\(/.test(hydCode) && !/workers\s*=\s*f\.__campWorkers__\s*;/.test(hydCode));
ok('facilities hydrate through _mergeCampFacilities, not `= f.__campFacilities__`',
  /_mergeCampFacilities\(/.test(hydCode) && !/facilities\s*=\s*f\.__campFacilities__\s*;/.test(hydCode));
ok('maxSlots takes a MAX, never a bare assignment',
  /maxSlots\s*=\s*Math\.max\(/.test(hydCode) && !/maxSlots\s*=\s*f\.__campMaxSlots__\s*;/.test(hydCode));

console.log('\n  ── static: the daily latches are on a SEPARATE path from facilities');
const facAt = HTML.indexOf('function _mergeCampFacilities(');
const facSrc = facAt < 0 ? '' : HTML.slice(facAt, HTML.indexOf('\n}', facAt));
ok('_mergeCampFacilities branches on _isCampLatchKey before merging a facility',
  /_isCampLatchKey\(k\)\s*\?\s*_mergeCampLatch\(/.test(facSrc.replace(/\s+/g, ' ').replace(/ \? /g, ' ? ')) ||
  (/_isCampLatchKey\(/.test(facSrc) && /_mergeCampLatch\(/.test(facSrc) && /_mergeCampFacility\(/.test(facSrc)),
  facSrc ? 'found' : 'NOT FOUND');
ok('all four latch keys are named in the source', ['__tithe', '__rnr', '__meta', '__smuggler']
  .every((k) => HTML.includes("'" + k + "'")));
const latchAt = HTML.indexOf('function _mergeCampLatch(');
const latchSrc = latchAt < 0 ? '' : HTML.slice(latchAt, HTML.indexOf('\n}', latchAt));
ok('the latch merge never reads `.level`', latchSrc.length > 0 && !/\.level/.test(latchSrc));
const facOnly = HTML.indexOf('function _mergeCampFacility(');
const facOnlySrc = facOnly < 0 ? '' : HTML.slice(facOnly, HTML.indexOf('\n}', facOnly));
ok('the facility merge never reads `.day` or `.claimed`',
  facOnlySrc.length > 0 && !/\.day/.test(facOnlySrc) && !/\.claimed/.test(facOnlySrc));

console.log('\n  ── static: the account-switch wipe covers the two new stores');
/* 🪪 These two stores were localStorage-only until they joined the forge blob.
   That is what put them inside _resetProfileForNewOwner()'s remit: the upload has
   NO owner gate (cloudSyncProfile only waits for _hydratedFromCloud), so anything
   left behind by account A unions into account B's row on the next sync and, since
   the merge only ever adds, never comes out again. §11 drives it live. */
const rstAt  = HTML.indexOf('function _resetProfileForNewOwner() {');
const RESET  = rstAt < 0 ? '' : HTML.slice(rstAt, HTML.indexOf('\r\n}', rstAt));
/* The lab/camp half lives in its own function. It was split out because the
   foreign-profile branch in cloudFetchProfile has to run THAT half even when it
   does not run the full profile wipe — §12 is the section that pins that down. */
const lcAt   = HTML.indexOf('function _resetLabCampForNewOwner() {');
const LCRESET = lcAt < 0 ? '' : HTML.slice(lcAt, HTML.indexOf('\r\n}', lcAt));
ok('_resetProfileForNewOwner() was located', RESET.length > 400, RESET.length + ' chars');
ok('_resetLabCampForNewOwner() was located', LCRESET.length > 200, LCRESET.length + ' chars');
ok('  the full profile wipe delegates to it', /_resetLabCampForNewOwner\(\);/.test(RESET));
ok('  it empties Lab.cores', /_lab\.cores\s*=\s*\[\]/.test(LCRESET));
ok('  it empties Camp.slots / workers / facilities', /_cmp\.slots\s*=\s*\[\]/.test(LCRESET)
  && /_cmp\.workers\s*=\s*\[\]/.test(LCRESET) && /_cmp\.facilities\s*=\s*\{\}/.test(LCRESET));
ok('  it resets Camp.maxSlots to the unpaid default (6)', /_cmp\.maxSlots\s*=\s*6/.test(LCRESET));
ok('  it clears the removal tombstones', /Profile\.labCampTombs\s*=\s*\{\}/.test(LCRESET));
ok('  it pushes the wipe into hg_lab / hg_camp', /saveLab\(\)/.test(LCRESET) && /saveCamp\(\)/.test(LCRESET));
ok('  ⚠ _labCampSeen is reset BEFORE the stores are emptied, so the wipe cannot '
 + 'manufacture a tombstone for every id the DEPARTING account owned',
  /_labCampSeen\.cores\s*=\s*null/.test(LCRESET)
  && LCRESET.indexOf('_labCampSeen.cores') < LCRESET.indexOf('_lab.cores = []')
  && LCRESET.indexOf('_labCampSeen.slots') < LCRESET.indexOf('_cmp.slots = []'));

console.log('\n  ── static: the foreign-profile branch runs that wipe UNCONDITIONALLY');
/* 🔴 THE ROUND-3 BUG. _resetProfileForNewOwner() is called from inside
   `if (!cloudHasProg)` — only when the ARRIVING account has NOTHING in the cloud.
   For an arriving account that is an existing player (the normal case) the wipe
   never ran at all, so account A's stores were still populated when the union
   merge and then the ungated upload went out. The lab/camp reset therefore has to
   sit OUTSIDE that gate. */
const fbAt  = HTML.indexOf('    if (foreignProfile) {');
const fbEnd = HTML.indexOf('    } else if (forceRestore) {', fbAt);
const FOREIGN = (fbAt < 0 || fbEnd < 0) ? '' : HTML.slice(fbAt, fbEnd);
ok('the foreignProfile branch was located', FOREIGN.length > 200, FOREIGN.length + ' chars');
const fCode = FOREIGN.split('\n').filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)
  && !/^\s*\/\*/.test(l) && !/^\s{9,}\S/.test(l)).join('\n');
ok('  it calls _resetLabCampForNewOwner()', /_resetLabCampForNewOwner\(\)/.test(fCode));
ok('  🔴 ...OUTSIDE the `if (!cloudHasProg)` gate, not inside it',
  fCode.indexOf('_resetLabCampForNewOwner()') > -1
  && fCode.indexOf('_resetLabCampForNewOwner()') < fCode.indexOf('if (!cloudHasProg)'));
ok('  the full profile wipe is still the one thing that stays gated on !cloudHasProg — '
 + 'an arriving player with a cloud row keeps their own heroes/decks',
  fCode.indexOf('_resetProfileForNewOwner()') > fCode.indexOf('if (!cloudHasProg)'));

console.log('\n  ── static: Force Restore is not silently defeated by a tombstone');
ok('the hydration block consults forceRestore', /\bforceRestore\b/.test(hydCode));
ok('  and it drops tombstones rather than skipping the merge',
  /if\s*\(forceRestore\)/.test(hydCode) && /delete\s+_lt\[id\]/.test(hydCode));
/* The branch must be a tombstone eraser and NOTHING else. A forceRestore branch
   that reached for `_lab.cores = f.__labCores__` would honour the button's word
   literally and delete every local-only embryo — and one that touched
   hatchedCardId would re-open the double-mint hole _mergeLabCores closes. */
const frBody = (() => {
  const a = hydCode.indexOf('if (forceRestore) {');
  return a < 0 ? '' : hydCode.slice(a, hydCode.indexOf('\n      }', a));
})();
ok('  the forceRestore branch was located', frBody.length > 60, frBody.length + ' chars');
ok('  it ONLY erases tombstones — no bare assignment, no merge, no hatched-receipt bypass',
  /delete\s+_lt\[id\]/.test(frBody) && !/_mergeLabCores/.test(frBody)
  && !/hatchedCardId/.test(frBody) && !/cores\s*=/.test(frBody) && !/slots\s*=/.test(frBody));
ok('  ...and the union merges still run unconditionally, outside it',
  hydCode.indexOf('_mergeLabCores(') > hydCode.indexOf('if (forceRestore) {')
  && !frBody.includes('_mergeCampSlots'));

console.log('\n  ── static: localStorage is NOT removed, and the payload is guarded');
ok("saveLab() still writes localStorage['hg_lab']",
  /function saveLab\(\)[\s\S]{0,900}localStorage\.setItem\(STORAGE_KEYS\.lab,/.test(HTML));
ok("saveCamp() still writes localStorage['hg_camp']",
  /function saveCamp\(\)[\s\S]{0,1200}localStorage\.setItem\(STORAGE_KEYS\.camp,/.test(HTML));
ok('cores are capped on upload (LAB_CORES_SYNC_MAX)', /const LAB_CORES_SYNC_MAX\s*=\s*\d+/.test(HTML)
  && /_labCoresForUpload\(/.test(UPLOAD));
ok('slots + workers are capped on upload',
  /const CAMP_SLOTS_SYNC_MAX\s*=\s*\d+/.test(HTML) && /const CAMP_WORKERS_SYNC_MAX\s*=\s*\d+/.test(HTML)
  && /_syncTrimList\(/.test(UPLOAD));
const upforAt = HTML.indexOf('function _labCoresForUpload(');
const upforSrc = upforAt < 0 ? '' : HTML.slice(upforAt, HTML.indexOf('\n}', upforAt));
ok('the upload path runs _stripDataUrls, like __unopenedPacks__ does',
  /_stripDataUrls\(/.test(upforSrc) && /_stripDataUrls\(/.test(UPLOAD.slice(UPLOAD.indexOf('__campFacilities__'))));
ok('unhatched cores are kept in preference to hatched history when trimming',
  /hatchedCardId/.test(upforSrc) && /LAB_CORES_SYNC_MAX/.test(upforSrc));

/* ── LIVE PASS ───────────────────────────────────────────────────────────── */
console.log('\n  ── live: booting the real page\n');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
/* Offline. Every CDN this page pulls is aborted — nothing under test needs
   them, and a driver that silently depends on the network is a flake. */
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(
  'window.__mg && window.__mg.labcamp && typeof window.__mg.labcamp.mergeLabCores === "function"',
  null, { timeout: 180000 });

ok('the window.__mg.labcamp seam reaches the real Lab and Camp',
  await page.evaluate(() => {
    const s = window.__mg.labcamp;
    return !!(s.lab() && Array.isArray(s.lab().cores) && s.camp() && Array.isArray(s.camp().slots));
  }));

/* The fixture. Local is what this device did; cloud is what the OTHER device
   pushed. They overlap on core_A, on the `barracks` facility (at a LOWER level
   in the cloud), on slot s1, and on worker w1. */
const FIXTURE = {
  localCores: [
    { id: 'core_A', bred: true, battlesUntilHatch: 2, hatchedCardId: null, createdAt: 1000 },
    { id: 'core_B', bred: false, battlesUntilHatch: 0, hatchedCardId: 'cc_fused_b', createdAt: 900 },
    { id: 'core_A', bred: true, battlesUntilHatch: 2, hatchedCardId: null, createdAt: 1000 },  // a store that already had a dupe
  ],
  cloudCores: [
    { id: 'core_A', bred: true, battlesUntilHatch: 1, hatchedCardId: null, createdAt: 1000 },  // overlapping, further along
    { id: 'core_C', bred: true, battlesUntilHatch: 3, hatchedCardId: null, createdAt: 2000 },  // disjoint — the embryo that was lost
    { id: 'core_D', bred: false, battlesUntilHatch: 0, hatchedCardId: 'cc_fused_d', createdAt: 800 }, // spent receipt
    { id: 'core_T', bred: true, battlesUntilHatch: 3, hatchedCardId: null, createdAt: 700 },   // discarded HERE
  ],
  tombs: { core_T: 1755000000000 },
  localCamp: {
    slots: [
      { id: 's1', kind: 'unit', refId: 'u_wolf', parkedAt: 100 },
      { id: 's2', kind: 'unit', refId: 'u_hawk', parkedAt: 110 },
    ],
    workers: [{ id: 'w1', kind: 'npc', role: 'engineer', station: 'reactor', at: 100 }],
    maxSlots: 6,
    facilities: {
      barracks: { level: 3, state: 'active' },
      __tithe:     { day: '2026-08-26' },
      __smuggler:  { window: 100, claimed: { 0: true } },
      __meta:      { day: '2026-08-20' },
    },
  },
  cloudCamp: {
    slots: [
      { id: 's1', kind: 'unit', refId: 'u_wolf', parkedAt: 100 },
      { id: 's3', kind: 'unit', refId: 'u_bear', parkedAt: 120 },
      { id: 's4', kind: 'unit', refId: 'u_wolf', parkedAt: 130 },   // SAME unit under a new slot id
    ],
    workers: [
      { id: 'w1', kind: 'npc', role: 'engineer', station: 'reactor', at: 100 },
      { id: 'w2', kind: 'npc', role: 'medic',    station: 'lounge',  at: 200 },
      { id: 'w3', kind: 'npc', role: 'engineer', station: 'reactor', at: 210 },  // room already staffed
    ],
    maxSlots: 9,
    facilities: {
      barracks: { level: 1, state: 'active' },      // LOWER — must not win
      lounge:   { level: 2, state: 'active' },      // cloud-only
      __tithe:     { day: '2026-08-20' },           // OLDER — must not win
      __smuggler:  { window: 100, claimed: { 1: true } },
      __meta:      { day: '2026-08-27' },           // NEWER — must win
      __rnr:       { day: '2026-08-25' },           // cloud-only
    },
  },
};

/* Run the SHIPPED hydration text. `f` is the only free variable it needs that
   is not already a global function declaration in that script. */
const result = await page.evaluate(({ block, fx }) => {
  const s = window.__mg.labcamp;
  s.lab().cores = JSON.parse(JSON.stringify(fx.localCores));
  const camp = s.camp();
  camp.slots      = JSON.parse(JSON.stringify(fx.localCamp.slots));
  camp.workers    = JSON.parse(JSON.stringify(fx.localCamp.workers));
  camp.facilities = JSON.parse(JSON.stringify(fx.localCamp.facilities));
  camp.maxSlots   = fx.localCamp.maxSlots;
  const t = s.tombs();
  for (const k in t) delete t[k];
  Object.assign(t, fx.tombs);

  const f = {
    __labCores__:       JSON.parse(JSON.stringify(fx.cloudCores)),
    __campSlots__:      JSON.parse(JSON.stringify(fx.cloudCamp.slots)),
    __campWorkers__:    JSON.parse(JSON.stringify(fx.cloudCamp.workers)),
    __campFacilities__: JSON.parse(JSON.stringify(fx.cloudCamp.facilities)),
    __campMaxSlots__:   fx.cloudCamp.maxSlots,
    __labCampTombs__:   {},
  };
  // eslint-disable-next-line no-new-func
  (new Function('f', 'forceRestore', block))(f, false);
  return {
    cores: s.lab().cores.map((c) => ({ id: c.id, b: c.battlesUntilHatch, h: c.hatchedCardId || null })),
    slots: camp.slots.map((x) => ({ id: x.id, u: x.kind + ':' + x.refId })),
    workers: camp.workers.map((w) => ({ id: w.id, st: w.station })),
    facilities: camp.facilities,
    maxSlots: camp.maxSlots,
    lsLab:  JSON.parse(localStorage.getItem('hg_lab')  || 'null'),
    lsCamp: JSON.parse(localStorage.getItem('hg_camp') || 'null'),
  };
}, { block: HYDRATION, fx: FIXTURE });

console.log('  ── 1. Lab.cores — union by id');
const ids = result.cores.map((c) => c.id);
ok('the local-only core survived (core_B)', ids.includes('core_B'), ids.join(','));
ok('the cloud-only embryo arrived (core_C) — this is the 2,500 \u{1F525} that was lost',
  ids.includes('core_C'), ids.join(','));
ok('the overlapping core is present exactly once (core_A)',
  ids.filter((x) => x === 'core_A').length === 1, ids.join(','));
ok('NO id appears twice', new Set(ids).size === ids.length, ids.join(','));
ok('a HATCHED cloud core is not resurrected into the incubator (core_D absent)',
  !ids.includes('core_D'), ids.join(','));
ok('a core discarded on this device is not handed back (core_T absent)',
  !ids.includes('core_T'), ids.join(','));
ok('the shared core keeps the FURTHER-ALONG battle count (MIN)',
  (result.cores.find((c) => c.id === 'core_A') || {}).b === 1,
  JSON.stringify(result.cores.find((c) => c.id === 'core_A')));

console.log('\n  ── 2. Camp facilities — max by level');
ok('a facility built higher HERE does not regress to the cloud level (barracks 3)',
  (result.facilities.barracks || {}).level === 3, JSON.stringify(result.facilities.barracks));
ok('a facility built only on the OTHER device arrives (lounge 2)',
  (result.facilities.lounge || {}).level === 2, JSON.stringify(result.facilities.lounge));

console.log('\n  ── 3. Camp slots — union by id, parked exactly once');
const slotIds = result.slots.map((s) => s.id);
ok('the local-only slot survived (s2)', slotIds.includes('s2'), slotIds.join(','));
ok('the cloud-only slot arrived (s3)', slotIds.includes('s3'), slotIds.join(','));
ok('the overlapping slot is present exactly once (s1)',
  slotIds.filter((x) => x === 's1').length === 1, slotIds.join(','));
ok('the SAME unit re-parked under a new slot id is rejected (s4 absent) — it would ' +
   'double-subtract from deckKeyOwnedCount',
  !slotIds.includes('s4'), slotIds.join(','));
ok('slot count equals the union (3)', result.slots.length === 3, String(result.slots.length));
ok('maxSlots takes the MAX (9)', result.maxSlots === 9, String(result.maxSlots));

console.log('\n  ── 4. Camp workers — union by id, one per room');
const wIds = result.workers.map((w) => w.id);
ok('the cloud-only worker arrived (w2)', wIds.includes('w2'), wIds.join(','));
ok('the overlapping worker is present exactly once (w1)',
  wIds.filter((x) => x === 'w1').length === 1, wIds.join(','));
ok('a second worker for an already-staffed room is rejected (w3 absent)',
  !wIds.includes('w3'), wIds.join(','));

console.log('\n  ── 5. the daily latches — LATER day/window wins');
ok('__tithe keeps the LATER day (2026-08-26, not the cloud’s 08-20)',
  (result.facilities.__tithe || {}).day === '2026-08-26', JSON.stringify(result.facilities.__tithe));
ok('__meta adopts the LATER cloud day (2026-08-27)',
  (result.facilities.__meta || {}).day === '2026-08-27', JSON.stringify(result.facilities.__meta));
ok('__rnr arrives from the cloud when this device has none',
  (result.facilities.__rnr || {}).day === '2026-08-25', JSON.stringify(result.facilities.__rnr));
ok('__smuggler keeps the window and UNIONS the claim map (a claim on either device is spent)',
  (result.facilities.__smuggler || {}).window === 100
  && !!(result.facilities.__smuggler.claimed || {})['0']
  && !!(result.facilities.__smuggler.claimed || {})['1'],
  JSON.stringify(result.facilities.__smuggler));
ok('a latch never grows a `level` field',
  ['__tithe', '__rnr', '__meta', '__smuggler'].every((k) => !result.facilities[k] || result.facilities[k].level === undefined));

console.log('\n  ── 6. \u{1F534} RED — the wrong merges ARE destructive');
/* Reconstructing the two anti-patterns is the point: a merge test that cannot
   show the loss it prevents is a comment. These are deliberately the WRONG
   algorithms, so restating them here rather than lifting them is correct. */
const bareAssign = FIXTURE.cloudCores.slice();
ok('\u{1F534} a bare `Lab.cores = f.__labCores__` DROPS the local-only core (core_B)',
  !bareAssign.some((c) => c.id === 'core_B'),
  'that is the embryo/history this device paid for');
ok('\u{1F534} ...and RESURRECTS the spent receipt (core_D)',
  bareAssign.some((c) => c.id === 'core_D'));
const blanketMax = (() => {
  const L = FIXTURE.localCamp.facilities, C = FIXTURE.cloudCamp.facilities, out = {};
  for (const k of new Set([...Object.keys(L), ...Object.keys(C)])) {
    const a = L[k], b = C[k];
    if (!a) { out[k] = b; continue; }
    if (!b) { out[k] = a; continue; }
    out[k] = ((a.level | 0) >= (b.level | 0)) ? a : b;     // "just MAX everything"
  }
  return out;
})();
ok('\u{1F534} a blanket max-by-level over facilities corrupts __meta — it hands back the OLDER day',
  blanketMax.__meta.day === '2026-08-20',
  'shipped merge gives ' + (result.facilities.__meta || {}).day + ', blanket-MAX gives ' + blanketMax.__meta.day);
ok('\u{1F534} ...and that is a re-opened daily claim (resolveCampMeta / _campCollectTithe pay real Cinder)',
  blanketMax.__meta.day !== (result.facilities.__meta || {}).day);
ok('\u{1F534} a blanket max-by-level also loses one side of the smuggler claim map',
  Object.keys(blanketMax.__smuggler.claimed || {}).length === 1
  && Object.keys((result.facilities.__smuggler || {}).claimed || {}).length === 2,
  'blanket=' + JSON.stringify(blanketMax.__smuggler.claimed));

console.log('\n  ── 7. localStorage is still the local canon');
ok("hg_lab was rewritten by the merge (saveLab still runs)",
  result.lsLab && Array.isArray(result.lsLab.cores)
  && result.lsLab.cores.some((c) => c.id === 'core_C'),
  result.lsLab ? result.lsLab.cores.map((c) => c.id).join(',') : 'null');
ok("hg_camp was rewritten by the merge (saveCamp still runs)",
  result.lsCamp && Array.isArray(result.lsCamp.slots)
  && result.lsCamp.slots.some((s) => s.id === 's3')
  && result.lsCamp.facilities && result.lsCamp.facilities.barracks.level === 3,
  result.lsCamp ? result.lsCamp.slots.map((s) => s.id).join(',') : 'null');

console.log('\n  ── 8. the merge is idempotent (cloudFetchProfile runs on every sign-in / refresh)');
const second = await page.evaluate(({ block, fx }) => {
  const s = window.__mg.labcamp;
  const f = {
    __labCores__:       JSON.parse(JSON.stringify(fx.cloudCores)),
    __campSlots__:      JSON.parse(JSON.stringify(fx.cloudCamp.slots)),
    __campWorkers__:    JSON.parse(JSON.stringify(fx.cloudCamp.workers)),
    __campFacilities__: JSON.parse(JSON.stringify(fx.cloudCamp.facilities)),
    __campMaxSlots__:   fx.cloudCamp.maxSlots,
    __labCampTombs__:   {},
  };
  // eslint-disable-next-line no-new-func
  (new Function('f', 'forceRestore', block))(f, false);
  const camp = s.camp();
  return {
    cores: s.lab().cores.map((c) => c.id),
    slots: camp.slots.map((x) => x.id),
    workers: camp.workers.map((w) => w.id),
    tithe: (camp.facilities.__tithe || {}).day,
    barracks: (camp.facilities.barracks || {}).level,
  };
}, { block: HYDRATION, fx: FIXTURE });
ok('a second fetch adds no cores', second.cores.length === result.cores.length, second.cores.join(','));
ok('a second fetch adds no slots', second.slots.length === result.slots.length, second.slots.join(','));
ok('a second fetch adds no workers', second.workers.length === result.workers.length, second.workers.join(','));
ok('a second fetch does not move the latch backwards', second.tithe === '2026-08-26', String(second.tithe));
ok('a second fetch does not regress a facility level', second.barracks === 3, String(second.barracks));

console.log('\n  ── 9. a DISCARD survives the union (saveLab/saveCamp record the removal)');
/* The Lab discard dialog says "This cannot be undone", and a union merge cannot
   express a delete — without a tombstone the very next fetch hands the core
   straight back. The tombstone is written at the saveLab()/saveCamp() choke
   point rather than at each of the seven removal sites, so this drives the real
   removal shape: mutate the store the way the discard handler does, save, then
   fetch again with the cloud still holding it. */
const discard = await page.evaluate(({ block }) => {
  const s = window.__mg.labcamp;
  const lab = s.lab(), camp = s.camp();
  const before = lab.cores.map((c) => c.id);
  const cloudCores = JSON.parse(JSON.stringify(lab.cores));      // cloud still has everything
  const cloudSlots = JSON.parse(JSON.stringify(camp.slots));
  lab.cores  = lab.cores.filter((c) => c.id !== 'core_C');        // the discard handler's exact shape
  camp.slots = camp.slots.filter((x) => x.id !== 's3');           // ejectCampSlot's exact shape
  saveLab(); saveCamp();
  const tombed = { core_C: !!s.tombs().core_C, s3: !!s.tombs().s3 };
  // eslint-disable-next-line no-new-func
  (new Function('f', 'forceRestore', block))({ __labCores__: cloudCores, __campSlots__: cloudSlots, __labCampTombs__: {} }, false);
  return { before, tombed, after: lab.cores.map((c) => c.id), slotsAfter: camp.slots.map((x) => x.id) };
}, { block: HYDRATION });
ok('saveLab() recorded the discarded core as removed', discard.tombed.core_C === true,
  JSON.stringify(discard.tombed));
ok('saveCamp() recorded the ejected slot as removed', discard.tombed.s3 === true,
  JSON.stringify(discard.tombed));
ok('the discarded core is NOT handed back by the next fetch',
  !discard.after.includes('core_C'), discard.after.join(','));
ok('the ejected slot is NOT handed back by the next fetch',
  !discard.slotsAfter.includes('s3'), discard.slotsAfter.join(','));
ok('...and nothing else was lost along with it',
  discard.after.includes('core_A') && discard.after.includes('core_B')
  && discard.slotsAfter.includes('s1') && discard.slotsAfter.includes('s2'),
  discard.after.join(',') + ' | ' + discard.slotsAfter.join(','));

console.log('\n  ── 10. 🛟 FORCE RESTORE beats a tombstone (the button says UNCONDITIONALLY)');
/* The Settings button's own dialog promises to "UNCONDITIONALLY overwrite this
   device with your cloud account". The tombstone filter added for §9 defeats
   exactly the case that button exists for: a core discarded here by accident,
   still sitting in the cloud row, refused on the way back in. */
const forced = await page.evaluate(({ block }) => {
  const s = window.__mg.labcamp;
  const lab = s.lab(), camp = s.camp();
  lab.cores  = [{ id: 'core_keep', bred: true, battlesUntilHatch: 2, hatchedCardId: null }];
  camp.slots = [{ id: 'sk', kind: 'unit', refId: 'u_keep', parkedAt: 1 }];
  const t = s.tombs();
  for (const k in t) delete t[k];
  // Three tombstones: two the cloud still carries, one it does not.
  t.core_oops = 1755000000000;   // discarded by accident — the recovery case
  t.s_oops    = 1755000000000;
  t.core_gone = 1755000000000;   // both sides agree it is gone
  const cloud = () => ({
    __labCores__: [
      { id: 'core_keep', bred: true, battlesUntilHatch: 2, hatchedCardId: null },
      { id: 'core_oops', bred: true, battlesUntilHatch: 3, hatchedCardId: null },
      { id: 'core_spent', bred: false, battlesUntilHatch: 0, hatchedCardId: 'cc_x' },
    ],
    __campSlots__: [
      { id: 'sk',     kind: 'unit', refId: 'u_keep', parkedAt: 1 },
      { id: 's_oops', kind: 'unit', refId: 'u_oops', parkedAt: 2 },
    ],
    __labCampTombs__: {},
  });
  // eslint-disable-next-line no-new-func
  const run = (f, fr) => (new Function('f', 'forceRestore', block))(f, fr);
  run(cloud(), false);
  const normal = { cores: lab.cores.map((c) => c.id), slots: camp.slots.map((x) => x.id) };
  run(cloud(), true);
  return {
    normal,
    cores: lab.cores.map((c) => c.id),
    slots: camp.slots.map((x) => x.id),
    tombsAfter: Object.keys(s.tombs()).sort(),
  };
}, { block: HYDRATION });
ok('🔴 WITHOUT the flag the tombstone still wins (core_oops stays out)',
  !forced.normal.cores.includes('core_oops'), forced.normal.cores.join(','));
ok('🔴 ...and the ejected slot stays out too (s_oops)',
  !forced.normal.slots.includes('s_oops'), forced.normal.slots.join(','));
ok('a Force Restore DOES bring back the tombstoned core (core_oops)',
  forced.cores.includes('core_oops'), forced.cores.join(','));
ok('a Force Restore DOES bring back the tombstoned slot (s_oops)',
  forced.slots.includes('s_oops'), forced.slots.join(','));
ok('...and it does not resurrect a spent receipt — that guard is about double-minting, '
 + 'not about deletion (core_spent absent)',
  !forced.cores.includes('core_spent'), forced.cores.join(','));
ok('the restored ids lose their tombstones, so the map stops lying about a live id',
  !forced.tombsAfter.includes('core_oops') && !forced.tombsAfter.includes('s_oops'),
  forced.tombsAfter.join(','));
ok('a tombstone the cloud no longer carries SURVIVES the restore (core_gone) — a restore '
 + 'is not a reason to resurrect what both sides agree is gone',
  forced.tombsAfter.includes('core_gone'), forced.tombsAfter.join(','));
ok('nothing local was dropped by the restore', forced.cores.includes('core_keep')
  && forced.slots.includes('sk'), forced.cores.join(',') + ' | ' + forced.slots.join(','));

console.log('\n  ── 11. 🪪 ACCOUNT SWITCH — the departing account leaks nothing into the new one');
/* THE LEAK THIS SECTION EXISTS FOR. forgeSmall uploads these five keys with no
   owner gate — cloudSyncProfile only waits for _hydratedFromCloud. Before the
   fix, account A's embryos, parked units, workers and paid facility levels were
   still in Lab/Camp when account B signed in, so B's very next sync wrote them
   into B's user_profiles.forge row, permanently: the merge only ever adds. A's
   parked slots then subtract from B's deckKeyOwnedCount and can make a legal
   deck illegal. Same failure the comment above _resetProfileForNewOwner()
   describes for name/email/level, one blob further down. */
const upLabAt  = HTML.indexOf('      __labCores__:');
const upLabEnd = HTML.indexOf('      // \u{1F381} Chest + key inventories', upLabAt);
const UPLOAD_FRAG = (upLabAt < 0 || upLabEnd < 0) ? '' : HTML.slice(upLabAt, upLabEnd);
ok('the lab/camp slice of the forgeSmall upload literal was located',
  UPLOAD_FRAG.includes('__labCores__') && UPLOAD_FRAG.includes('__campWorkers__')
  && UPLOAD_FRAG.includes('__labCampTombs__'), UPLOAD_FRAG.length + ' chars');

const switched = await page.evaluate(({ frag }) => {
  const s = window.__mg.labcamp;
  const lab = s.lab(), camp = s.camp();
  // Account A, mid-game: two embryos, two parked units, a worker, a paid
  // facility level, an expanded camp and a real discard behind it.
  lab.cores = [
    { id: 'A_core1', bred: true, battlesUntilHatch: 2, hatchedCardId: null },
    { id: 'A_core2', bred: true, battlesUntilHatch: 1, hatchedCardId: null },
  ];
  camp.slots      = [{ id: 'A_s1', kind: 'unit', refId: 'A_wolf', parkedAt: 1 },
                     { id: 'A_s2', kind: 'unit', refId: 'A_hawk', parkedAt: 2 }];
  camp.workers    = [{ id: 'A_w1', kind: 'npc', role: 'medic', station: 'lounge', at: 1 }];
  camp.facilities = { barracks: { level: 4, state: 'active' }, __tithe: { day: '2026-08-26' } };
  camp.maxSlots   = 11;
  saveLab(); saveCamp();                     // A's ids are now the "seen" set
  // eslint-disable-next-line no-new-func
  const payload = () => (new Function('return ({' + frag + '});'))();
  const before = payload();
  const beforeCounts = {
    cores: (before.__labCores__ || []).length,
    slots: (before.__campSlots__ || []).length,
    workers: (before.__campWorkers__ || []).length,
    facilities: Object.keys(before.__campFacilities__ || {}).length,
    maxSlots: before.__campMaxSlots__,
  };

  s.resetForNewOwner();                      // account B signs in with no cloud row

  const after = payload();
  const seen = s.seen();
  return {
    beforeCounts,
    after: {
      cores: (after.__labCores__ || []).length,
      slots: (after.__campSlots__ || []).length,
      workers: (after.__campWorkers__ || []).length,
      facilities: Object.keys(after.__campFacilities__ || {}),
      maxSlots: after.__campMaxSlots__,
      tombs: Object.keys(after.__labCampTombs__ || {}),
    },
    lsLab:  JSON.parse(localStorage.getItem('hg_lab')  || 'null'),
    lsCamp: JSON.parse(localStorage.getItem('hg_camp') || 'null'),
    seenSizes: { cores: seen.cores ? seen.cores.size : null,
                 slots: seen.slots ? seen.slots.size : null,
                 workers: seen.workers ? seen.workers.size : null },
  };
}, { frag: UPLOAD_FRAG });

ok('🔴 BEFORE the switch the upload payload really did carry all of account A',
  switched.beforeCounts.cores === 2 && switched.beforeCounts.slots === 2
  && switched.beforeCounts.workers === 1 && switched.beforeCounts.maxSlots === 11,
  JSON.stringify(switched.beforeCounts));
ok('after _resetProfileForNewOwner() the upload carries NO cores',
  switched.after.cores === 0, String(switched.after.cores));
ok('...NO parked slots — so nothing of A subtracts from B\u2019s deckKeyOwnedCount',
  switched.after.slots === 0, String(switched.after.slots));
ok('...NO workers', switched.after.workers === 0, String(switched.after.workers));
ok('...NO facilities, so A\u2019s paid levels cannot be gifted to B',
  switched.after.facilities.length === 0, switched.after.facilities.join(','));
ok('...and maxSlots is back to the unpaid default (6)',
  switched.after.maxSlots === 6, String(switched.after.maxSlots));
ok('⚠ the wipe manufactured NO tombstones for the departing account\u2019s ids — they '
 + 'ride Profile and would block A\u2019s OWN cloud restore of those same ids',
  switched.after.tombs.length === 0, switched.after.tombs.join(','));
ok('  (the seen-set was reset first, so the saves inside the wipe saw prev === null)',
  switched.seenSizes.cores === 0 && switched.seenSizes.slots === 0
  && switched.seenSizes.workers === 0, JSON.stringify(switched.seenSizes));
ok('hg_lab followed the wipe', switched.lsLab && Array.isArray(switched.lsLab.cores)
  && switched.lsLab.cores.length === 0, JSON.stringify(switched.lsLab));
ok('hg_camp followed the wipe — a reload cannot resurrect A',
  switched.lsCamp && switched.lsCamp.slots.length === 0
  && switched.lsCamp.workers.length === 0
  && Object.keys(switched.lsCamp.facilities || {}).length === 0
  && switched.lsCamp.maxSlots === 6, JSON.stringify(switched.lsCamp));

console.log('\n  ── 12. 🪪 ACCOUNT SWITCH onto an EXISTING player (cloudHasProg = true)');
/* 🔴 THE HALF §11 DID NOT COVER. §11 drives _resetProfileForNewOwner() directly,
   which is the brand-new-account path. The far more common switch is onto an
   account that ALREADY has a cloud row, and that path never called the wipe: the
   call sits inside `if (!cloudHasProg)`. So A's cores/slots/workers/facilities
   were still in the stores when the union merge ran, unioned with B's cloud set,
   and then rode the ungated forgeSmall upload into B's user_profiles.forge row —
   permanently, because the merge only ever adds. This section runs the SHIPPED
   branch text with cloudHasProg = true, then the SHIPPED hydration against a
   NON-EMPTY account-B blob, then evaluates the SHIPPED upload literal.

   ⚠ `Profile` is a top-level const in that script and is not on window, so the
     branch text gets a stub for its two `Profile.cloud` touches. Everything the
     assertions below look at is moved by the real _resetLabCampForNewOwner(),
     which closes over the real Profile and the real Lab/Camp. */
const fBody = (() => {
  /* FOREIGN stops BEFORE the else-if line, so the branch's own closing brace is
     not in it — everything after the opening brace is already the body. */
  const a = FOREIGN.indexOf('{');
  return a < 0 ? '' : FOREIGN.slice(a + 1);
})();
ok('the foreignProfile branch BODY was sliced for live use', fBody.length > 150, fBody.length + ' chars');

const B_CLOUD = {
  __labCores__:    [{ id: 'B_core1', bred: true, battlesUntilHatch: 3, hatchedCardId: null }],
  __campSlots__:   [{ id: 'B_s1', kind: 'unit', refId: 'B_bear', parkedAt: 50 }],
  __campWorkers__: [{ id: 'B_w1', kind: 'npc', role: 'cook', station: 'mess', at: 50 }],
  __campFacilities__: { barracks: { level: 1, state: 'active' }, __tithe: { day: '2026-08-01' } },
  __campMaxSlots__: 6,
  __labCampTombs__: {},
};

const cross = await page.evaluate(({ branch, block, frag, cloud }) => {
  const s = window.__mg.labcamp;
  const seedA = () => {
    /* Null the seen-sets first: without this the fixture's own re-seed looks like a
       removal of B_core1 and manufactures a tombstone that would then block B's
       core from hydrating — the driver would be testing its own bookkeeping. */
    const sn = s.seen(); sn.cores = null; sn.slots = null; sn.workers = null;
    const lab = s.lab(), camp = s.camp();
    lab.cores = [{ id: 'A_core1', bred: true, battlesUntilHatch: 2, hatchedCardId: null }];
    camp.slots      = [{ id: 'A_s1', kind: 'unit', refId: 'A_wolf', parkedAt: 1 }];
    camp.workers    = [{ id: 'A_w1', kind: 'npc', role: 'medic', station: 'lounge', at: 1 }];
    camp.facilities = { barracks: { level: 4, state: 'active' }, __tithe: { day: '2026-08-26' } };
    camp.maxSlots   = 11;
    saveLab(); saveCamp();
    const t = s.tombs(); for (const k in t) delete t[k];
  };
  // eslint-disable-next-line no-new-func
  const payload = () => (new Function('return ({' + frag + '});'))();
  // eslint-disable-next-line no-new-func
  const hydrate = () => (new Function('f', 'forceRestore', block))(JSON.parse(JSON.stringify(cloud)), false);
  const snap = () => {
    const p = payload();
    return {
      cores:   s.lab().cores.map((c) => c.id),
      slots:   s.camp().slots.map((x) => x.id),
      workers: s.camp().workers.map((w) => w.id),
      barracks: (s.camp().facilities.barracks || {}).level,
      maxSlots: s.camp().maxSlots,
      upCores:   (p.__labCores__ || []).map((c) => c.id),
      upSlots:   (p.__campSlots__ || []).map((x) => x.id),
      upWorkers: (p.__campWorkers__ || []).map((w) => w.id),
      upMaxSlots: p.__campMaxSlots__,
    };
  };

  /* CONTROL — the shipped hydration with the wipe NOT run, i.e. exactly what the
     gated branch used to do for an arriving account that had a cloud row. If this
     comes back clean the fixture is wrong and the section below proves nothing. */
  seedA();
  hydrate();
  const leaked = snap();

  /* THE FIX — the shipped branch text, cloudHasProg = true. */
  seedA();
  const stubProfile = { cloud: { _foreignProfile: true, lastFetchAt: 0 } };
  // eslint-disable-next-line no-new-func
  (new Function('Profile', 'cloudHasProg', branch))(stubProfile, true);
  const wiped = snap();
  /* Read hg_camp HERE, before the merge repopulates it from B's blob — the point
     is that the wipe reached localStorage, not what the merge later put back. */
  const lsCamp = JSON.parse(localStorage.getItem('hg_camp') || 'null');
  const lsLab  = JSON.parse(localStorage.getItem('hg_lab')  || 'null');
  hydrate();
  const merged = snap();

  return { leaked, wiped, merged, lsCamp, lsLab };
}, { branch: fBody, block: HYDRATION, frag: UPLOAD_FRAG, cloud: B_CLOUD });

ok('🔴 CONTROL — without the wipe, account A really does survive the merge into B',
  cross.leaked.cores.includes('A_core1') && cross.leaked.slots.includes('A_s1')
  && cross.leaked.workers.includes('A_w1') && cross.leaked.barracks === 4
  && cross.leaked.maxSlots === 11,
  JSON.stringify(cross.leaked.cores) + ' ' + JSON.stringify(cross.leaked.slots)
  + ' barracks=' + cross.leaked.barracks + ' maxSlots=' + cross.leaked.maxSlots);
ok('🔴 CONTROL — ...and rides the ungated upload payload into B\u2019s forge row',
  cross.leaked.upCores.includes('A_core1') && cross.leaked.upSlots.includes('A_s1')
  && cross.leaked.upWorkers.includes('A_w1'),
  JSON.stringify(cross.leaked.upCores) + ' ' + JSON.stringify(cross.leaked.upSlots));

ok('the branch empties the stores even though cloudHasProg was TRUE',
  cross.wiped.cores.length === 0 && cross.wiped.slots.length === 0
  && cross.wiped.workers.length === 0 && cross.wiped.maxSlots === 6,
  JSON.stringify(cross.wiped.cores) + ' ' + JSON.stringify(cross.wiped.slots)
  + ' maxSlots=' + cross.wiped.maxSlots);
ok('hg_lab / hg_camp followed it, so a reload cannot resurrect A',
  cross.lsLab && cross.lsLab.cores.length === 0
  && cross.lsCamp && cross.lsCamp.slots.length === 0 && cross.lsCamp.workers.length === 0
  && Object.keys(cross.lsCamp.facilities || {}).length === 0 && cross.lsCamp.maxSlots === 6,
  JSON.stringify(cross.lsLab) + ' ' + JSON.stringify(cross.lsCamp));

ok('after the cloud merge NO A_* core survives — the store is exactly B\u2019s set',
  cross.merged.cores.length === 1 && cross.merged.cores[0] === 'B_core1',
  cross.merged.cores.join(','));
ok('NO A_* parked slot survives — nothing of A subtracts from B\u2019s deckKeyOwnedCount',
  cross.merged.slots.length === 1 && cross.merged.slots[0] === 'B_s1',
  cross.merged.slots.join(','));
ok('NO A_* worker survives', cross.merged.workers.length === 1
  && cross.merged.workers[0] === 'B_w1', cross.merged.workers.join(','));
ok("A\u2019s paid barracks level 4 is NOT gifted to B — B keeps its own level 1",
  cross.merged.barracks === 1, String(cross.merged.barracks));
ok("A\u2019s expanded maxSlots (11) is NOT gifted to B", cross.merged.maxSlots === 6,
  String(cross.merged.maxSlots));
ok('...and B lost nothing: the union from an empty local side is exactly the cloud set',
  cross.merged.cores.includes('B_core1') && cross.merged.slots.includes('B_s1')
  && cross.merged.workers.includes('B_w1'), JSON.stringify(cross.merged.cores));

ok('🔴 the OUTGOING payload carries no A_* core', !cross.merged.upCores.includes('A_core1'),
  cross.merged.upCores.join(','));
ok('🔴 the OUTGOING payload carries no A_* slot', !cross.merged.upSlots.includes('A_s1'),
  cross.merged.upSlots.join(','));
ok('🔴 the OUTGOING payload carries no A_* worker', !cross.merged.upWorkers.includes('A_w1'),
  cross.merged.upWorkers.join(','));
ok('🔴 the OUTGOING payload carries no inflated maxSlots', cross.merged.upMaxSlots === 6,
  String(cross.merged.upMaxSlots));

ok('no page errors while the merge ran', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
await new Promise((r) => server.close(r));

console.log('\n  ⚠ NOT PROVEN HERE: that the save actually travels. No Supabase project was');
console.log('    contacted and nothing was signed in. Two-device behaviour needs a live');
console.log('    project and two authenticated browsers on one account.');
console.log('    §11 and §12 prove the LOCAL stores and the upload payload are empty after an');
console.log('    account switch. It does NOT prove account B\'s cloud row stays clean —');
console.log('    that needs two real accounts against a live project.\n');
console.log(fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
