/* ══════════════════════════════════════════════════════════════════════════
   EXPEDITION LOCK PROBE — the bunker Field Bag is "on expedition" only while a
   run the player can actually reach is live.

   Owner (v180, own account): the bunker showed "80/80 — ON EXPEDITION" and
   "On expedition — bank loot at a Convoy" with no run anywhere. The saved
   run was of "Day one as a survivor." (campmp7v6dpn), a World-Map-placed
   campaign nothing launches any more; every lock check was "rlcRun and not
   complete/failed".

   Every case goes through the REAL load path: the run is written into the
   saved profile (hg_profile) and the page is RELOADED, so loadForge restores
   it and whatever runs after load decides.
     O1–O4  orphans (Gas Station Run — World-Map only, no launcher; an unknown
            campaign id; no campaignId; campmp7v6dpn) → after load: rlcRun
            cleared, lock map cleared, bag unlocked, bag items untouched, one
            toast saying so.
     L1     a live Ethos Heights run (msn_*) → still there, still locked.
     L2     a Black Market Run (bm_run) → still there, still locked: it is
            still launchable (Ruin Exchange → Black Market tile) and can be
            continued / abandoned from the Ethos map's run banner.
     L3     a published Story Run (placement 'roguelite') → kept, locked.
     U1     before the published catalog lands, a run it would decide stays
            held AND locked (unknown is never treated as an orphan).
     E1/E2  completed / failed runs → untouched, not locked.
     T1     a stale copy of a closed run (started at or before the closed one)
            written back into the save → NOT resurrected on reload, no toast.
     T2     cloud path: _rlcRunTombstoned() refuses the stale copy, and the
            served source guards the cloud merge with it and uploads the
            tombstone (the merge itself needs a signed-in Supabase row, so this
            half is a source + function check, not an end-to-end one).
     A1     the bunker banner's "Abandon expedition" button (real base/ iframe,
            real hud.jsx) → the game's confirm → run gone, bag unlocked.

   Usage: node .gauntlet/expedition-lock-probe.mjs [candidateDir]   (:8787 up)
     candidateDir holds index.html, hud.jsx, base-index.html (any subset);
     each present file is served in place of the live one via page.route.
   Expect FAIL on the current files, PASS on the candidates.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:8787/';
const dir = process.argv[2] || '';
const cand = (f) => (dir && fs.existsSync(path.join(dir, f))) ? fs.readFileSync(path.join(dir, f), 'utf8') : null;
const C_INDEX = cand('index.html'), C_HUD = cand('hud.jsx'), C_BASE = cand('base-index.html');

const b = await chromium.launch();
// ⚠ serviceWorkers 'block': sw.js caches index.html after the first load, and a
// request the SW answers never reaches page.route — every reload after the
// first would silently test the LIVE file instead of the candidate.
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (C_INDEX) await p.route(/localhost:8787\/(index\.html)?(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: C_INDEX }));
if (C_BASE) await p.route(/\/base\/index\.html(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: C_BASE }));
if (C_HUD) await p.route(/\/base\/hud\.jsx(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/babel; charset=utf-8', body: C_HUD }));

const R = [];
const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ready() {
  await p.waitForFunction(() => typeof _baseFieldBag === 'function' && typeof saveProfile === 'function'
    && typeof Profile !== 'undefined' && document.readyState === 'complete', null, { timeout: 90000 });
  // the mission module is what resolves msn_* ids
  try { await p.waitForFunction(() => !!(window.MythicMissions && window.MythicMissions.campaign), null, { timeout: 20000 }); } catch (e) {}
}
await p.goto(BASE + 'index.html', { waitUntil: 'load', timeout: 90000 });
await ready();

const T0 = Date.now() - 3600e3;
const baseRun = (extra) => Object.assign({ heroId: null, currentNodeId: null, completed: [], heroHP: 80, maxHP: 100,
  currency: 12, medPoints: 1, deck: [], relics: [], purchases: [], choices: {}, haul: {}, isComplete: false, isFailed: false }, extra);

// Write run + bag (+ an explicit tombstone, or none) into the saved profile and
// reload through the real load path.
async function seedAndReload(run, tomb) {
  const saved = await p.evaluate(({ run, tomb }) => {
    Profile.rlcRun = run;
    if (tomb) Profile.rlcRunClosed = tomb; else { try { delete Profile.rlcRunClosed; } catch (e) {} }
    Profile.fieldBag = { metal: 5, fuel: 2 };
    Profile.fieldBagRunLock = run ? { metal: 3 } : {};
    saveProfile();
    const raw = localStorage.getItem('hg_profile') || '';
    return run ? raw.indexOf(String(run.startedAt || run.campaignId || 'isComplete')) >= 0 : true;
  }, { run, tomb: tomb || null });
  await p.reload({ waitUntil: 'load', timeout: 90000 });
  await ready();
  return saved;
}
// The probe runs SIGNED OUT, where cloudFetchCatalog never runs and a fresh
// browser has no cached catalog — so Catalog.campaigns is empty. A signed-in
// player's catalog lands a few seconds after load; this plays that part, with
// the owner's real campaign shape (campmp7v6dpn is published, placement
// 'worldMap') and one campaign that IS on the Ethos map's Story Runs drawer.
async function catalogLands() {
  await p.evaluate(() => {
    const nodes = [{ id: 'n1', type: 'battle', name: 'Probe', row: 0, col: 0, connections: [] }];
    Catalog.campaigns = [
      { id: 'campmp7v6dpn', name: 'Day one as a survivor.', placement: 'worldMap', isPublished: true, nodes },
      { id: 'probe_story_run', name: 'Probe Story Run', placement: 'roguelite', isPublished: true, nodes },
    ];
  });
}
// Watch the page after load. stopWhenGone: return as soon as rlcRun is cleared.
async function observe(ms, stopWhenGone) {
  const t = Date.now(); let toast = false, s = null;
  while (Date.now() - t < ms) {
    s = await p.evaluate(() => {
      const bag = _baseFieldBag() || {};
      return {
        run: Profile.rlcRun ? { id: Profile.rlcRun.campaignId || null, st: Profile.rlcRun.startedAt || null } : null,
        locked: !!bag.locked,
        lock: JSON.stringify(Profile.fieldBagRunLock || {}),
        fieldBag: JSON.stringify(Profile.fieldBag || {}),
        toast: /was closed/i.test(document.body ? document.body.innerText : ''),
        closed: Profile.rlcRunClosed ? JSON.stringify(Profile.rlcRunClosed) : null,
        cats: (typeof Catalog !== 'undefined' && Array.isArray(Catalog.campaigns)) ? Catalog.campaigns.length : -1,
      };
    });
    if (s.toast) toast = true;
    if (stopWhenGone && !s.run) { const t2 = Date.now(); while (!toast && Date.now() - t2 < 1500) { await sleep(200); toast = await p.evaluate(() => /was closed/i.test(document.body.innerText)); } break; }
    await sleep(250);
  }
  s.toastSeen = toast;
  return s;
}

// ── orphans ────────────────────────────────────────────────────────────────
// needsCatalog: the verdict depends on the published catalog, so it is judged
// only after catalogLands() (U1 checks what happens BEFORE it lands).
const orphans = [
  ['O1 Gas Station Run (World-Map only, no launcher)', baseRun({ campaignId: 'gas_station_run', startedAt: T0 + 1 }), false],
  ['O2 unknown campaign id', baseRun({ campaignId: 'camp_probe_does_not_exist', startedAt: T0 + 2 }), true],
  ['O3 no campaignId', baseRun({ startedAt: T0 + 3 }), false],
  ['O4 campmp7v6dpn (the owner\'s run, World-Map placed)', baseRun({ campaignId: 'campmp7v6dpn', startedAt: T0 + 4 }), true],
];
let lastClosed = null, lastTomb = null;
for (const [label, run, needsCatalog] of orphans) {
  try {
    const saved = await seedAndReload(run);
    ok(label + ': seeded into the saved profile', saved);
    if (needsCatalog) {
      // U1 — before the catalog lands the run cannot be judged: it must stay
      // LOCKED (never bankable just because the page is still booting).
      const u = await observe(4000, false);
      ok(label + ': before the catalog lands → still held + locked (unknown ≠ orphan)', u.run && u.locked, JSON.stringify(u.run) + ' locked=' + u.locked);
      await catalogLands();
    }
    const s = await observe(30000, true);
    ok(label + ': rlcRun cleared after load', !s.run, JSON.stringify(s.run) + ' cats=' + s.cats);
    ok(label + ': Field Bag unlocked', !s.locked);
    ok(label + ': run lock map cleared', s.lock === '{}', s.lock);
    ok(label + ': bag items untouched', s.fieldBag === JSON.stringify({ metal: 5, fuel: 2 }), s.fieldBag);
    ok(label + ': player told once ("…was closed…")', s.toastSeen);
    if (!s.run) { lastClosed = run; lastTomb = s.closed ? JSON.parse(s.closed) : null; }
  } catch (e) { ok(label + ' ran', false, e.message); }
}

// ── T1: a stale copy of the last closed run does not come back ─────────────
// The save holds exactly what a device holds after the close (the tombstone the
// close wrote) PLUS the stale run copy. The stale run is one the sweep would
// close ANYWAY (with a toast) — so "no toast" is what proves the tombstone,
// not the sweep, kept it out.
try {
  // O3's run (no campaignId) is judged with no catalog at all, so without the
  // tombstone it WOULD be restored and then closed again with a toast. The
  // tombstone is the last close's (O4, a later startedAt) — a run started at
  // or before a closed one is stale by construction.
  const src = orphans[2][1];
  ok('T1 the last close wrote a tombstone (startedAt of the closed run)', !!lastTomb && lastClosed && Number(lastTomb.startedAt) === Number(lastClosed.startedAt), JSON.stringify(lastTomb));
  const saved = await seedAndReload(Object.assign({}, src), lastTomb);
  ok('T1 stale copy written back into the save', saved);
  const s = await observe(9000, false);
  ok('T1 stale run copy NOT resurrected on load', !s.run, JSON.stringify(s.run));
  ok('T1 …and no second toast', !s.toastSeen);
  ok('T1 tombstone survived the reload', !!s.closed && lastTomb && s.closed.indexOf(String(lastTomb.startedAt)) >= 0, s.closed);
} catch (e) { ok('T1 ran', false, e.message); }

// ── T2: cloud merge half ───────────────────────────────────────────────────
try {
  const r = await p.evaluate(async () => {
    const html = await (await fetch('index.html', { cache: 'no-store' })).text();
    const t = Profile.rlcRunClosed || null;
    const st = t && t.startedAt;
    return {
      fn: typeof _rlcRunTombstoned === 'function',
      staleRefused: typeof _rlcRunTombstoned === 'function' && st ? _rlcRunTombstoned({ campaignId: 'x', startedAt: st }) : false,
      newerAllowed: typeof _rlcRunTombstoned === 'function' && st ? !_rlcRunTombstoned({ campaignId: 'x', startedAt: st + 1000 }) : false,
      mergeGuarded: html.indexOf("!Profile.rlcRun && !_rlcRunTombstoned(f.__rlcRun__)) Profile.rlcRun = f.__rlcRun__;") >= 0,
      mergeTomb: html.indexOf('_rlcMergeTombstone(f.__rlcRunClosed__)') >= 0,
      uploadTomb: /__rlcRunClosed__:\s+\(Profile\.rlcRunClosed/.test(html),
      runNull: !Profile.rlcRun,   // the payload writes a falsy run as null
    };
  });
  ok('T2 _rlcRunTombstoned refuses a copy with the closed startedAt', r.fn && r.staleRefused);
  ok('T2 …and allows a genuinely newer run', r.fn && r.newerAllowed);
  ok('T2 cloud merge restores __rlcRun__ only if not tombstoned (source)', r.mergeGuarded);
  ok('T2 cloud merge takes the cloud tombstone (source)', r.mergeTomb);
  ok('T2 next upload carries __rlcRunClosed__ and a null run', r.uploadTomb && r.runNull);
} catch (e) { ok('T2 ran', false, e.message); }

// ── live runs stay live ────────────────────────────────────────────────────
const MSN = 'msn_midtown_scp_100_16';
try {
  const saved = await seedAndReload(baseRun({ campaignId: MSN, startedAt: Date.now() - 60000 }));
  ok('L1 Ethos run seeded', saved);
  const s = await observe(12000, false);
  ok('L1 live Ethos Heights run (msn_*) is still there after load', s.run && s.run.id === MSN, JSON.stringify(s.run));
  ok('L1 …and the bag is still locked', s.locked);
  ok('L1 …no "closed" toast', !s.toastSeen);
} catch (e) { ok('L1 ran', false, e.message); }
try {
  const saved = await seedAndReload(baseRun({ campaignId: 'bm_run', startedAt: Date.now() - 50000, _bmLeg: 'out' }));
  ok('L2 Black Market Run seeded', saved);
  const s = await observe(9000, false);
  ok('L2 Black Market Run (still launchable) is kept', s.run && s.run.id === 'bm_run', JSON.stringify(s.run));
  ok('L2 …and locked', s.locked);
  const reach = await p.evaluate(() => { try { return !!window.MythicMissionBridge.activeRun(); } catch (e) { return false; } });
  ok('L2 …and reachable: the Ethos map shows it with Continue / Abandon', reach);
} catch (e) { ok('L2 ran', false, e.message); }

try {
  await seedAndReload(baseRun({ campaignId: 'probe_story_run', startedAt: Date.now() - 45000 }));
  await catalogLands();
  const s = await observe(12000, false);
  ok('L3 a published Story Run (placement roguelite, on the Ethos map) is kept', s.run && s.run.id === 'probe_story_run', JSON.stringify(s.run));
  ok('L3 …and locked', s.locked);
} catch (e) { ok('L3 ran', false, e.message); }

// ── ended runs are untouched ───────────────────────────────────────────────
for (const [label, extra] of [['E1 completed', { isComplete: true }], ['E2 failed', { isFailed: true }]]) {
  try {
    const run = baseRun(Object.assign({ campaignId: 'gas_station_run', startedAt: Date.now() - 40000 }, extra));
    await seedAndReload(run);
    const s = await observe(7000, false);
    ok(label + ' run kept for its result screen', s.run && s.run.id === 'gas_station_run', JSON.stringify(s.run));
    ok(label + ' run does not lock the bag', !s.locked);
    ok(label + ' …no toast', !s.toastSeen);
  } catch (e) { ok(label + ' ran', false, e.message); }
}

// ── A1: the banner's Abandon button ────────────────────────────────────────
try {
  await seedAndReload(baseRun({ campaignId: MSN, startedAt: Date.now() - 30000 }));
  await sleep(3000);
  await p.evaluate(() => { App.screen = 'camp'; mountBaseBuilder(); });
  const frame = await (async () => {
    for (let i = 0; i < 120; i++) {
      const f = p.frames().find(fr => /\/base\/index\.html/.test(fr.url()));
      if (f) return f;
      await sleep(250);
    }
    return null;
  })();
  ok('A1 bunker iframe mounted', !!frame);
  if (frame) {
    await frame.waitForFunction(() => document.body && /on expedition/i.test(document.body.innerText), null, { timeout: 45000 });
    const hasBtn = await frame.evaluate(() => [...document.querySelectorAll('button')].some(x => /abandon expedition/i.test(x.textContent)));
    ok('A1 lock banner shows an "Abandon expedition" action', hasBtn);
    if (hasBtn) {
      await frame.evaluate(() => [...document.querySelectorAll('button')].find(x => /abandon expedition/i.test(x.textContent)).click());
      await p.waitForSelector('#gc-yes', { timeout: 10000 });
      ok('A1 the game\'s own confirm opens (forfeit warning)', await p.evaluate(() => /FORFEIT/.test((document.getElementById('gc-confirm-backdrop') || {}).innerText || '')));
      await p.click('#gc-yes');
      await sleep(1200);
      const s = await p.evaluate(() => ({ run: !!Profile.rlcRun, locked: !!(_baseFieldBag() || {}).locked, lock: JSON.stringify(Profile.fieldBagRunLock || {}), screen: App.screen }));
      ok('A1 run abandoned', !s.run);
      ok('A1 bag unlocked + lock map cleared', !s.locked && s.lock === '{}', s.lock);
      ok('A1 player stays in the bunker', s.screen === 'camp', s.screen);
      let dep = false;
      try { await frame.waitForFunction(() => /Deposit All/i.test(document.body.innerText), null, { timeout: 8000 }); dep = true; } catch (e) {}
      ok('A1 bunker re-painted with the Deposit button', dep);
    }
  }
} catch (e) { ok('A1 ran', false, e.message.split('\n')[0]); }

await b.close();
let fails = 0;
for (const r of R) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
const own = errs.filter(e => /rlc|expedition|tombstone|_baseFieldBag/i.test(e));
if (own.length) console.log('page errors (related): ' + own.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + R.length + ' PASS'));
process.exit(fails ? 1 : 0);
