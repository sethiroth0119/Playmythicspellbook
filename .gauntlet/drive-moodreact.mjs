/* ══════════════════════════════════════════════════════════════════════════
   🙂 DRIVE-MOODREACT — P4's evidence: the face changes at EVERY commit seam,
   in the same session, with no reload.

   There is not one placement seam in this game, there are five, and four of
   them never go near tryPlace():

     a  tryPlace()                      — buildings and roads
     b  bldFinish()                     — the moment a TIMED build exists,
                                          minutes to a day after it was ordered
     c  /src/roads applyRun() convert   — rewrites `t.rc`, creates no tile
     d  /src/water                      — a Set with its own save slice
     e  /src/power lines.lay / lift     — another Set, another save slice

   ── 🔴 EVERY SEAM IS DRIVEN THROUGH THE PATH THE PLAYER'S HAND REACHES ─────
   A critic proved that the previous cut of this file did not do that for
   water. It hooked and asserted on `MythicWater.pipes.*` / `MythicWater.
   drains.*` — a FAÇADE that only a console or a driver can call. The shipped
   pipe DRAG commits in /src/water/netui.js `commit()`, and the shipped Sea
   Drain button commits in /src/water/drain.js `place()`; both end at
   `after() -> api.onEdit()`, and neither went anywhere near the façade. Driven
   at the time: `MythicWater.drains.place(26,2)` returned ok, the drain count
   went 0 -> 1, and the mood module's invalidation counter did not move.
   So §7 below now:
     • arms the real tool (`MythicWater.pipes.tool(true)`, i.e. NetUI.arm) and
       lays its mains with SYNTHESISED POINTER EVENTS on the real canvas,
       through /src/netdrag's capture-phase arbiter — the same three events a
       player's drag produces, and no other entry point;
     • presses the Sea Drain button's own code path, `drains.place()`;
     • asserts on the invalidate id, which is now DISTINCT per commit tail
       (`water-edit` from NetUI's onEdit, `drain-edit` from Drain's), so a row
       cannot pass on the façade by accident ever again.
   The façade pings are kept — the loader and the node-importable tests use
   them — but nothing in this file asserts through them.

   ── ⚠ THE ONE-TICK LATENCY, AND THE RULE IT IMPOSES ON THIS FILE ───────────
   /src/plotmood's header states it: `water` and `power` are READERS over a
   solved state, and neither /src/water nor /src/power re-solves on an edit —
   both are solved inside node-city's economyTick pre-passes, once a second,
   from a snapshot the HOST composes. A read taken between a placement and the
   next tick is therefore a stale answer behind a fresh generation counter.
   🔴 SO EVERY PLACEMENT IN THIS FILE IS FOLLOWED BY `await step()` BEFORE THE
      NEXT READ — CONTROLS INCLUDED. No before/after pair may straddle a solve.
      Skipping the step on "the cheap ones" (a decor tile, a lamp) is exactly
      what made the previous cut print 3 failures on one run and 5 on the next:
      the control's own before-read had been taken on the far side of the first
      solve the city ever ran, so it moved for reasons the placement never
      touched.

   ── 🔴 AND THE CITY IS BUILT WELL-SERVED, WHICH IS NOT DECORATION ──────────
   `game.cov.pct` phases in over DEMAND_RAMP_SEC from a neutral 1.0 and then
   settles on supply÷demand. On a bare driven board every need therefore SLIDES
   through the whole 0..1 range while the harness is running, so whichever need
   happened to be lowest at the moment of a read won `reason` — and the answer
   changed between runs. That is the real source of the old flakiness, and it
   also made §4 unprovable: `roadcap` bottoms out at 0.75 on a reachable meter
   and can never win against a need that is still sliding through 0.55.
   §1 therefore grants the two progression nodes and builds the clinic, police
   station, grocery, restaurant, club, graveyard and enough Street Lights for
   every one of the six home needs to sit at or above `needFloor` with real
   headroom. Then every need bids exactly 1.0, coverage drift is common-mode
   and cancels, a control can be checked BYTE FOR BYTE across a tick, and the
   term under test is the only one that can move.

   ── ⚠ FIVE TRAPS THIS HARNESS PAYS FOR, WRITTEN DOWN SO THE NEXT ONE DOES NOT
   1. `window.confirm = () => true` DOES NOT ANSWER THIS GAME'S DIALOGS.
      node-city declares its own `gcConfirm()` (an in-world modal) precisely so
      the player never sees the browser's grey box. It resolves on a CLICK and
      nothing else, so a driver that places anything slow enough to trip
      `bldConfirmLong` hangs for ever with a clean console. The interval
      installed below clicks it. A power plant is slow enough.
   2. A PLANT WITH NO CREW GENERATES NOTHING. `plant = def.gen.power *
      tileMult(..., staffingRatio(), 1)`, so a driven city with
      `game.army.workers === 0` has a Gas Plant, a green panel and a capacity of
      0.00. `game.army.workers` is set AFTER the placements — setting it before
      puts the city over its population cap and every placement is refused.
   3. A HOUSE IS NOT A POWER LOAD IN THIS GAME. `housing` has no `powerNeed`,
      so it never enters `pwLoads` and its `factorAt` is the city-wide fallback
      for ever. The power seam's subject has to be a building that draws — a
      Sawmill here.
   4. HALF THE SERVICE CATALOGUE IS BEHIND THE PROGRESSION TREE. Clinic, police
      station and fire station are `civ_services`; the graveyard is
      `civ_deathcare`; the club is `com_high`. A driven place() of any of them
      is refused with a 🌳 toast and NOTHING ELSE — the tile simply is not
      there. `MythicProgress._grant(id)` is the tree's own test hook.
   5. THE PIPE TOOL'S POINTER PICK IS `cellFromEvent`, A RAYCAST AGAINST y = 0.
      To synthesise a drag this file has to turn a tile into client pixels, and
      it does it by projecting the tile's world centre through the LIVE camera —
      after `updateMatrixWorld()`, because `lookAt()` only writes the quaternion
      and the matrix the projection reads is refreshed inside render(). The
      tile→world offset is DERIVED at runtime from a known anchor rather than
      assuming HALF = 12.

   Finally the visible half: one pixel A/B of the glyph above a subject, under
   .gauntlet/README.md item 6's protocol — renderer.render() BETWEEN the two
   reads and drawImage in the SAME task, because preserveDrawingBuffer is off
   and a read taken in the next task returns the frame from before the change
   and reports a confident, wrong zero.
   🔴 AND IT MEASURES BADGE IDENTITY, NOT BADGE FOOTPRINT. The previous cut
      printed 13.09 % for the badge before the fix and 13.09 % after it, and
      called that a pass: the subject had simply swapped one frowning glyph for
      another (`dark` → `need:health`), so the footprint was unchanged and the
      number was blind to the only thing being claimed. §8's subject is now a
      house whose ONLY defect is the one the placement fixes, on a city where
      every other term is 1.0 — so at the fix it goes to `ok`, `MOOD.drawHappy`
      is false, and the badge is GONE. `B_off → B_on` therefore has to fall to
      the noise floor, and the drawn-badge roster is checked by name as well.

   Run:  node .gauntlet/drive-moodreact.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8800 + (process.pid % 90);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);

/* TRAP 1's answer, and TRAP 6's. See the header. */
await page.evaluate(() => {
  window.__ncModals = 0;
  setInterval(() => {
    const b = document.querySelector('#ncconfirm [data-ncc="1"]');
    if (b) { window.__ncModals++; b.click(); }
  }, 8);

  /* ── 🔴 TRAP 6 — `lastWhy` IS A LAST-WRITER-WINS FIELD, SO READING IT IS A
     RACE, AND THE RACE IS REAL. node-city's economy beat calls
     invalidate('tick') once a second, and every placement in this file is
     awaited (payCost is a bridge round trip). Between a placement resolving
     and a read of report().lastWhy, the tick can — and intermittently did —
     overwrite 'water-edit' with 'tick', and this harness printed a confident
     failure about a seam that had fired perfectly. Reading a field that
     anything else may write is not an observation of an event.
     So every seam assertion below RECORDS the invalidate() calls that happen
     during the gesture instead. The recorder delegates to the real function
     and is removed again; the claim becomes "this action raised this id",
     which no unrelated tick can either satisfy or destroy.
     ⚠ It wraps the PROPERTY, not a captured closure, because every caller in
       the app reaches it as `window.MythicPlotMood.invalidate(...)` — the
       guarded one-liner CLAUDE.md's globals-trap note requires. A caller that
       had captured the function would be invisible here, and there is none:
       node-city's moodInvalidate(), /src/water's moodPing(), /src/roads and
       /src/power all go through the property. */
  window.__mrRecord = async (fn) => {
    const M = window.MythicPlotMood;
    const orig = M.invalidate;
    const seen = [];
    M.invalidate = function (w) { seen.push(w); return orig.apply(M, arguments); };
    let out;
    try { out = await fn(); } finally { M.invalidate = orig; }
    return { seen, out };
  };
});

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};
const pair = (a, b) => {
  console.log('     before  ' + JSON.stringify({ score: a && a.score, reason: a && a.reason }));
  console.log('     after   ' + JSON.stringify({ score: b && b.score, reason: b && b.reason }));
};
const sr = (m) => (m ? m.score + '/' + m.reason : String(m));
const cell = (m) => JSON.stringify({ score: m && m.score, reason: m && m.reason });
const termOf = (m, k) => { if (!m || !m.terms) return null; const t = m.terms.find((x) => x.k === k); return t ? t.s : null; };

/* 🔴 ONE ECONOMY SLICE, AND IT RUNS AFTER EVERY SINGLE PLACEMENT IN THIS FILE.
   See the header: the water and power terms are readers over a state that only
   re-solves inside this trio (__nc.step calls economyTick, vitalsTick and
   periodicSaveTick in animate()'s own order). A read on the wrong side of it is
   a stale answer behind a fresh generation counter. */
const step = (mins) => page.evaluate((m) => window.__nc.step(m, 1), mins == null ? 0.25 : mins);

/* The seam ledger — one row per commit seam, printed as a table at the end so
   a reader can see at a glance which PLAYER path each row was driven through.
   Filled in by the sections themselves; a row nobody filled prints as a hole
   rather than silently not existing. */
const SEAMS = [];
const seam = (id, where, via, before, after, moved) =>
  SEAMS.push({ id, where, via, before: cell(before), after: cell(after), moved });

/* ── 0. BOOT ───────────────────────────────────────────────────────────── */
console.log('\n0. boot');
const boot = await page.evaluate(() => ({
  nc: !!window.__nc,
  pm: !!(window.MythicPlotMood && window.MythicPlotMood.ready()),
  water: !!window.MythicWater, power: !!window.MythicPower, roads: !!window.MythicRoadClasses,
  prog: !!(window.MythicProgress && window.MythicProgress._grant),
  seam: typeof (window.__nc || {}).plotMoodKey === 'function',
  anchor: typeof (window.__nc || {}).plotIconAnchor === 'function',
  verify: window.__nc && window.__nc.plotMoodVerify ? window.__nc.plotMoodVerify() : null,
}));
ok('the page booted with the diagnostics seam', boot.nc);
ok('/src/plotmood mounted', boot.pm);
ok('__nc.plotMood is on the seam', boot.seam);
ok('__nc.plotIconAnchor is on the seam (the pixel A/B needs a MEASURED crop)', boot.anchor);
ok('/src/water, /src/power and /src/roads are all up (the four non-tryPlace seams)',
   boot.water && boot.power && boot.roads,
   JSON.stringify({ water: boot.water, power: boot.power, roads: boot.roads }));
ok('the progression tree exposes its own grant hook (TRAP 4)', boot.prog);
console.log('   verify: ' + JSON.stringify(boot.verify));

if (!boot.pm) { console.log('\nplotmood did not mount — nothing below can run.'); console.log(logs.slice(-25).join('\n')); await browser.close(); server.close(); process.exit(1); }

/* ── 1. THE BOARD ──────────────────────────────────────────────────────────
   Two districts, and the second one exists for the power seam alone.

   THE MAINLAND: a road spine at z=12, x=4..16, with the services on z=13 and
   the subjects on z=11.
     8,11   TARGET     — the tryPlace, bldFinish, road-class and water subject
     12,11  W-CONTROL  — four tiles east, never reached by a main
     16,11  A/B SUBJ   — §8's photograph. Deliberately outside every lamp, and
                         so are its two road tiles, so its ONLY defect is dark.
     6,11   the Waterworks §7's mains run from

   THE LAMPS ARE PLACED AROUND A HOLE. Every lamp sits where its Chebyshev-2
   square covers the spine and the service row but NOT 8,11 — the target has to
   start dark or §2 has nothing to fix — and none of them reaches x≥15, which
   is what leaves §8 a subject whose only complaint is the dark.

   THE ISLAND: two road stubs at z=20 with a GAP between them, so neither is
   walkable to the other and neither touches the mainland. /src/power's cable
   set is a BFS over conductors (roads + line cells) seeded from plants and the
   Grid Connector, so a stub joined to nothing carries no power however much
   the city is generating — the only way to make ONE building on this board
   off-grid while its neighbour four tiles away stays a fair control.
     18,19  P-TARGET  — a Sawmill (powerNeed 0.5). See TRAP 3.
     22,19  P-CONTROL — the same building on the other stub
   ── */
console.log('\n1. build a WELL-SERVED city through __nc.place() → tryPlace()');
const built = await page.evaluate(async () => {
  const nc = window.__nc;
  const B = window.MythicCityBridge;
  /* Cost is checked at the BRIDGE, not at game.res (.gauntlet/README.md item
     2). Stubbing game.res does nothing. */
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  /* TRAP 4 — the service catalogue is gated. _grant is the tree's own hook. */
  const G = window.MythicProgress;
  const grants = G ? { civ_services: G._grant('civ_services'), civ_deathcare: G._grant('civ_deathcare'),
                       com_high: G._grant('com_high') } : null;

  const _c = window.confirm; window.confirm = () => true;
  const why = [];
  window.__ncToastSink = (m) => why.push(String(m).slice(0, 90));
  const missing = [];
  const put = async (t, x, z) => {
    await nc.place(t, x, z);
    try { nc.build.finishAll('moodreact'); } catch (e) {}
    const got = !!nc.game.tiles[x + ',' + z];
    if (!got) missing.push(t + '@' + x + ',' + z);
    return got;
  };

  for (let x = 4; x <= 16; x++) await put('road', x, 12);     // 13 tiles of spine
  await put('housing', 8, 11);        // TARGET
  await put('housing', 12, 11);       // WATER CONTROL
  await put('housing', 16, 11);       // §6's A/B subject — outside every lamp
  await put('purifier', 6, 11);       // §7's waterworks, standing from the start

  /* 🔴 EIGHT HOUSES, AND THE COUNT IS ARITHMETIC RATHER THAN TASTE.
     popCap() is `4 + 6 × housing`; popUsed() is `workers + soldiers + Σ def.pop`
     and tryPlace refuses outright at `popUsed() + def.pop > popCap()`. The
     services below cost 20 population between them, the Gas Plant §3 orders
     costs 2 more, and the crew pool has to be large enough that
     staffingRatio() does not idle the plant (TRAP 2) — 24 crew are needed, so
     20 workers. 22 + 20 = 42 against a cap of 52.
     ⚠ THIS IS EXACTLY WHAT WENT WRONG ONCE: with three houses the cap was 22,
       the plant's own `pop: 2` did not fit, tryPlace refused it, and §3, §4,
       §5 and §6 all failed for a reason none of them mentioned — the log said
       `place-refused` and every downstream row blamed its own seam.
     ⚠ AND THEY ALL STAND WEST OF x = 12. §6 photographs a ±75 px crop around
       16,11 and at that camera one tile is about 14 px, so a judged building
       within three tiles would put a SECOND badge in the crop and the identity
       measurement would never reach zero. */
  await put('housing', 4, 11);
  await put('housing', 5, 11);
  await put('housing', 10, 11);
  await put('housing', 11, 11);
  await put('housing', 6, 13);

  /* The services. Coverage is CITY-WIDE in this game (see /src/plotmood's
     header) so where they stand does not affect who they cover — only that
     they stand, are fed, and are lit. Two clinics and two groceries rather
     than one of each: population climbs while the harness runs, and a need
     that is merely ABOVE the floor at §1 can slide under it by §7. The margin
     is the determinism. */
  await put('graveyard', 4, 13);
  await put('clinic', 5, 13);
  await put('police', 7, 13);
  await put('clinic', 8, 13);
  await put('grocery', 9, 13);
  await put('grocery', 10, 13);
  await put('restaurant', 11, 13);
  await put('club', 12, 13);

  /* THE LAMPS, AND THE HOLE THEY ARE PLACED AROUND. litKeys() is Chebyshev-2,
     so a lamp at (lx,lz) lights |x-lx|≤2 ∧ |z-lz|≤2. None of these four has
     |x-8|≤2 ∧ |z-11|≤2, so 8,11 stays dark for §2; and none reaches x≥15, so
     15,12 / 16,12 / 16,11 stay dark for §8. */
  await put('streetlight', 4, 10);    // x2-6  z8-12
  await put('streetlight', 12, 10);   // x10-14 z8-12
  await put('streetlight', 4, 14);    // x2-6  z12-16
  await put('streetlight', 8, 14);    // x6-10 z12-16
  await put('streetlight', 12, 14);   // x10-14 z12-16

  // the island: two stubs, a gap at 20,20 and 21,20 between them
  await put('road', 18, 20); await put('road', 19, 20);
  await put('road', 22, 20); await put('road', 23, 20);
  await put('sawmill', 18, 19);       // P-TARGET
  await put('sawmill', 22, 19);       // P-CONTROL
  /* Both island subjects must be LIT or `dark` (0.45) outscores the brownout
     floor and the power seam would be asserting on a term that never wins.
     One lamp cannot cover both — and must not, or the two stubs would share a
     tile. */
  await put('streetlight', 19, 19);   // covers 18,19
  await put('streetlight', 21, 19);   // covers 22,19, not 18,19 (|21-18| = 3)
  /* ⚠ THE GAS PLANT IS DELIBERATELY *NOT* BUILT HERE. It is §3's subject: the
     bar asks for a TIMED order whose SCAFFOLD must not cheer a neighbour up
     and whose bldFinish must. Building it in §1 would hand §3 a city that is
     already powered and leave the scaffold half untestable. §8 needs the plant
     too, and gets it: §3 finishes it. */

  window.confirm = _c; window.__ncToastSink = null;
  /* TRAP 2. AFTER the placements, never before — workers count against the
     SAME population cap the placements are checked with. */
  nc.game.army.workers = 20;
  return { tiles: Object.keys(nc.game.tiles).length, why: why.slice(0, 10), missing, grants,
           budget: nc.popBudget ? nc.popBudget() : null };
});
ok('every building the board needs actually stands (TRAP 4 — a gated row leaves NO tile)',
   built.missing.length === 0, built.missing.length ? JSON.stringify(built.missing) : 'none missing');
console.log('   grants ' + JSON.stringify(built.grants) + ' · tiles ' + built.tiles);
console.log('   population budget ' + JSON.stringify(built.budget));
/* 🔴 THE POPULATION BUDGET IS CHECKED HERE, NOT DISCOVERED IN §3. See the
   comment on the housing block: the Gas Plant §3 orders costs 2 population,
   and if it does not fit, tryPlace refuses it silently and four sections
   downstream fail naming their own subjects instead of this one. */
ok('the board leaves room for §3\'s Gas Plant (pop 2) and staffs it (TRAP 2)',
   !!built.budget && built.budget.free >= 2 && built.budget.staffing >= 0.6,
   JSON.stringify(built.budget && { free: built.budget.free, staffing: built.budget.staffing }));
if (built.why.length) console.log('   refusals: ' + JSON.stringify(built.why));

/* SETTLE. `game.cov.pct` phases in over DEMAND_RAMP_SEC from a neutral 1.0, so
   a board read before the ramp has closed is read on a number that is still
   moving. Six slices of half a city-minute, through the shipped trio. */
for (let i = 0; i < 6; i++) await step(0.5);

const TK = '8,11';
const snap = () => page.evaluate((k) => window.MythicPlotMood.moodAtKey(k), TK);
const snapAt = (k) => page.evaluate((kk) => window.MythicPlotMood.moodAtKey(kk), k);

/* 🔴 THE PRECONDITION, ASSERTED RATHER THAN HOPED FOR. Everything below rests
   on "every city NEED bids exactly 1.0 for this house", because that is what
   makes a byte-identical control possible across a tick and what lets the term
   under test be the only one that can move. If it is not true, the sections
   below would still run and would fail somewhere else entirely, which is how
   the previous cut of this file came to blame the seams for a coverage ramp. */
const covr = await page.evaluate(() => {
  const nc = window.__nc, M = window.MythicPlotMood;
  const m = M.moodAtKey('8,11');
  const needs = (m ? m.terms : []).filter((t) => t.k.indexOf('need:') === 0);
  /* `light` is the one need measured in BLOCKS rather than per head — demand is
     the tile count and supply is how many of those tiles a lamp reaches — so
     when it is the one that is short, the actionable answer is WHICH TILES.
     Printed rather than described, because "add another lamp" is a guess and a
     list of four keys is not. */
  let dark = [];
  try {
    const lit = nc.litKeys ? new Set(nc.litKeys()) : null;
    if (lit) dark = Object.keys(nc.game.tiles).filter((k) => !lit.has(k));
  } catch (e) { dark = ['(litKeys is not on the seam)']; }
  return { pct: Object.fromEntries(Object.entries(nc.game.cov.pct || {}).map(([k, v]) => [k, +(+v).toFixed(3)])),
           needs, pop: +nc.game.pop.npc.toFixed(1), floor: M.tuning.needFloor, dark,
           low: needs.filter((t) => t.s < 1).map((t) => t.k + '=' + t.s) };
});
console.log('   cov.pct ' + JSON.stringify(covr.pct) + ' · pop ' + covr.pop);
console.log('   unlit tiles (' + covr.dark.length + '): ' + JSON.stringify(covr.dark));
ok('THE PRECONDITION — every city NEED for the target bids exactly 1.0 (needFloor ' + covr.floor + ')',
   covr.needs.length >= 6 && covr.low.length === 0,
   covr.low.length ? 'still short: ' + JSON.stringify(covr.low) : covr.needs.length + ' needs, all 1.0');

const start = await snap();
ok('the target tile is judged, and its ONLY complaint is the dark block',
   !!start && start.reason === 'dark', sr(start));

/* ── 2. SEAM (a) — tryPlace. A STREET LIGHT inside the target's catchment ── */
console.log('\n2. seam (a) tryPlace — litKeys() is node-city\'s ONE radius model (Chebyshev 2)');
{
  const before = await snap();
  const rec2 = await page.evaluate(() => window.__mrRecord(async () => {
    const nc = window.__nc;
    await nc.place('streetlight', 9, 11);       // 1 tile away — inside radius 2
    try { nc.build.finishAll('moodreact'); } catch (e) {}
  }));
  await step();                                  // THE RULE. See the header.
  const after = await snap();
  pair(before, after);
  ok('the `dark` term was a defect before the lamp', termOf(before, 'dark') !== null && termOf(before, 'dark') < 1,
     'dark=' + termOf(before, 'dark'));
  ok('…and is clear after it, in the same session with no reload', termOf(after, 'dark') === 1,
     'dark=' + termOf(after, 'dark'));
  ok('the placement seam fired', rec2.seen.some((w) => w && w.indexOf('place') === 0), JSON.stringify(rec2.seen));
  seam('a', 'tryPlace() — node-city :29845 wrapper', 'nc.place() → tryPlace()', before, after, true);

  /* THE CONTROL. A decor tile eleven tiles away, and IT IS STEPPED TOO — the
     rule in the header has no exceptions, because the control is the row a
     stale read breaks first. */
  const ctlBefore = await snap();
  await page.evaluate(async () => {
    const nc = window.__nc;
    await nc.place('tree', 13, 14);              // lit, far from the target
    try { nc.build.finishAll('moodreact'); } catch (e) {}
  });
  await step();
  const ctlAfter = await snap();
  ok('CONTROL — a decor tile placed and a full tick later, the target is byte-identical',
     JSON.stringify(ctlBefore) === JSON.stringify(ctlAfter), sr(ctlBefore) + '  →  ' + sr(ctlAfter));
}

/* ── 3. SEAM (b) — bldFinish. THE SCAFFOLD IS NOT THE BUILDING ────────────
   A NEIGHBOUR is the subject, not the placed tile. The mood module drops any
   tile with `t.bld` on principle, so "a site carries no face and a building
   does" is true of every placement of every building in this game and proves
   nothing about what a scaffold DOES.
   What the bar asks for is: order a TIMED building that WOULD fix somebody
   else's frown; the frown must survive a whole economy tick while only the
   site stands, and must die at bldFinish.
     subject : the target house, whose worst term is now `power` (§2 cleared
               its dark block, and §1 deliberately left the board unpowered)
     fix     : a GAS PLANT, asserted timed BEFORE it is ordered
     control : the island sawmill at 22,19 — a real power LOAD (TRAP 3) that a
               mainland plant cannot reach, because /src/power serves by
               conductor adjacency and that stub joins nothing. ── */
console.log('\n3. seam (b) bldFinish — a TIMED order writes a SCAFFOLD, not a building');
{
  const times = await page.evaluate(() => {
    const b = window.__nc.build;
    const t = (k) => { try { return b.timeFor(k, 1, 0, 1); } catch (e) { return null; } };
    return { gas: t('gas'), purifier: t('purifier'), housing: t('housing'), road: t('road') };
  });
  console.log('   __nc.build.timeFor (s): ' + JSON.stringify(times));
  ok('the subject row is PROVABLY timed — asserted BEFORE anything is ordered, never inferred after',
     times.gas > 0, 'timeFor(gas) = ' + times.gas + ' s');

  const before = await snap();
  const ctlBefore = await snapAt('22,19');
  ok('BEFORE — the target house is frowning on `power`, and there is no plant on the board',
     !!before && before.reason === 'power' && termOf(before, 'power') < 1,
     sr(before) + ' · power=' + termOf(before, 'power'));

  /* ── ROW 1 — THE SCAFFOLD. A whole economy tick with only the site up. ── */
  const scaf = await page.evaluate(async () => {
    const nc = window.__nc, M = window.MythicPlotMood;
    const _c = window.confirm; window.confirm = () => true;
    /* 🔴 THE REFUSAL IS CAPTURED, because a refused tryPlace is INVISIBLE from
       here otherwise: place() resolves either way, the tile simply is not
       there, and the whole of §3, §4, §5 and §6 then fails naming its own
       subject. That is not a hypothetical — it is what one run of this file
       actually did, for want of two points of population cap. */
    const why = [];
    window.__ncToastSink = (m) => why.push(String(m).slice(0, 90));
    // TRAP 1 fires here; the modal clicker answers it. TRAP 6: the ids are
    // RECORDED, not read back off lastWhy.
    const rec = await window.__mrRecord(() => nc.place('gas', 4, 8));
    window.__ncToastSink = null;
    window.confirm = _c;
    return { seen: rec.seen, why,
             budget: nc.popBudget ? nc.popBudget() : null,
             site: !!(nc.game.tiles['4,8'] && nc.game.tiles['4,8'].bld),
             faceOnSite: M.moodAtKey('4,8') };
  });
  ok('the Gas Plant was ACCEPTED — a refusal here is silent and takes four sections with it',
     scaf.seen.indexOf('place-refused') < 0,
     JSON.stringify(scaf.seen) + (scaf.why.length ? ' · ' + JSON.stringify(scaf.why) : '') +
     ' · budget ' + JSON.stringify(scaf.budget));
  await step(0.6);                            // a FULL tick, scaffold only
  const scafRead = await page.evaluate(() => {
    const nc = window.__nc, M = window.MythicPlotMood, P = window.MythicPower;
    return { stillSite: !!(nc.game.tiles['4,8'] && nc.game.tiles['4,8'].bld),
             mood: M.moodAtKey('8,11'), ctl: M.moodAtKey('22,19'),
             cap: P ? +P.state().capacity.toFixed(2) : null, modals: window.__ncModals };
  });

  /* ── ROW 2 — bldFinish(). The shipped completion path, not a hand write. ── */
  const fin = await page.evaluate(async () => {
    const nc = window.__nc, M = window.MythicPlotMood;
    const rec = await window.__mrRecord(async () => { try { nc.build.finishAll('moodreact'); } catch (e) {} });
    return { seen: rec.seen,
             standing: !!(nc.game.tiles['4,8'] && !nc.game.tiles['4,8'].bld),
             faceOnSite: M.moodAtKey('4,8') };
  });
  await step(0.6);
  const finRead = await page.evaluate(() => {
    const M = window.MythicPlotMood, P = window.MythicPower;
    return { mood: M.moodAtKey('8,11'), ctl: M.moodAtKey('22,19'),
             faceOnSite: M.moodAtKey('4,8'), cap: P ? +P.state().capacity.toFixed(2) : null };
  });

  console.log('   ┌ state ─────────────────────┬ 4,8 ─────┬ capacity ┬ target 8,11 ───────────────────────');
  console.log('   │ ordered, SCAFFOLD only     │ ' + (scafRead.stillSite ? 'site    ' : 'standing') +
              ' │ ' + String(scafRead.cap).padEnd(8) + ' │ ' + cell(scafRead.mood) + ' power=' + termOf(scafRead.mood, 'power'));
  console.log('   │ bldFinish(), BUILDING      │ ' + (fin.standing ? 'standing' : 'site    ') +
              ' │ ' + String(finRead.cap).padEnd(8) + ' │ ' + cell(finRead.mood) + ' power=' + termOf(finRead.mood, 'power'));
  console.log('   └────────────────────────────┴──────────┴──────────┴────────────────────────────────────');
  console.log('     before the order            ' + cell(before) + ' power=' + termOf(before, 'power'));
  console.log('     control 22,19 (off-grid)    ' + cell(ctlBefore) + '  →  ' + cell(scafRead.ctl) + '  →  ' + cell(finRead.ctl));
  console.log('     modals answered: ' + scafRead.modals);

  ok('the order really IS a timed build — the site survived a whole economy tick',
     scaf.site === true && scafRead.stillSite === true,
     JSON.stringify({ siteAtOrder: scaf.site, siteAfterTick: scafRead.stillSite }));
  ok('the tryPlace wrapper reported a SITE, not a building', scaf.seen.indexOf('place-site') >= 0, JSON.stringify(scaf.seen));
  ok('THE BAR — the NEIGHBOUR did NOT clear while only the scaffold stood, byte-identical across a full tick',
     cell(before) === cell(scafRead.mood) && termOf(before, 'power') === termOf(scafRead.mood, 'power'),
     cell(before) + '  →  ' + cell(scafRead.mood));
  ok('…and the scaffold really was generating nothing (capacity still 0)', scafRead.cap === 0, 'capacity=' + scafRead.cap);
  ok('bldFinish fired the seam', fin.seen.indexOf('finish') >= 0, JSON.stringify(fin.seen));
  ok('THE BAR — the neighbour CLEARED at bldFinish, same session, no reload',
     termOf(finRead.mood, 'power') === 1 && finRead.mood.reason !== 'power',
     'power ' + termOf(before, 'power') + ' → ' + termOf(finRead.mood, 'power') + ' · ' + cell(before) + '  →  ' + cell(finRead.mood));
  ok('CONTROL — the off-grid island load 22,19 is byte-identical across BOTH rows',
     cell(ctlBefore) === cell(scafRead.ctl) && cell(ctlBefore) === cell(finRead.ctl),
     cell(ctlBefore) + ' → ' + cell(scafRead.ctl) + ' → ' + cell(finRead.ctl));
  /* Supporting, not the headline: the placed tile itself. */
  ok('supporting — the site tile carried no face at all, and is judged once it stands',
     scaf.faceOnSite === null && !!fin.faceOnSite,
     JSON.stringify({ asSite: scaf.faceOnSite, asBuilding: sr(fin.faceOnSite) }));
  seam('b', 'bldFinish() — node-city :29369', 'nc.build.finishAll() → bldFinish()', scafRead.mood, finRead.mood, true);
}

/* ── 4. SEAM (c) — a ROAD CLASS conversion. No tile is created. ───────────
   🔴 REWRITTEN AFTER A CRITIC PASS, AND THE REASON IS WORTH KEEPING. The old
      cut printed a before/after pair that was BYTE-IDENTICAL and called the
      seam proved on the strength of `lastWhy` plus a term that was not the
      winner. It was byte-identical because `roadcap` bottoms out at 0.75 on
      any meter a player can actually reach (both tryPlace and applyRun refuse
      BEFORE crossing the cap, so `frac` stops around 0.95) — and on a bare
      board a city need was still sliding through 0.55 and beat it. An
      unchanged pair is indistinguishable from a dead seam, whatever the log
      says beside it.
      §1 now builds a city where every need bids 1.0, so 0.75 is genuinely the
      worst term and the pair FLIPS: ok → roadcap → ok. That is the honest
      reading of a class conversion, and /src/plotmood's header states at
      length why a per-plot "frontage quality" would be an invented number. ── */
console.log('\n4. seam (c) /src/roads applyRun() — rewrites t.rc, never calls tryPlace');
{
  const before = await snap();
  const up = await page.evaluate(async () => {
    const nc = window.__nc, R = window.MythicRoadClasses;
    if (!R) return { err: 'no /src/roads' };
    /* Convert the spine up to HIGHWAY (capWeight 4) until the weighted road
       meter reaches the cap. That is the ONE real number a road class moves. */
    const cells = [];
    for (let x = 4; x <= 16; x++) cells.push({ x, z: 12 });
    const rec = await window.__mrRecord(() => R._apply(cells, 'highway'));
    return { res: rec.out, seen: rec.seen };
  });
  await step();
  const after = await snap();
  const meter = await page.evaluate(() => window.MythicPlotMood.report().road);
  pair(before, after);
  console.log('     road meter ' + JSON.stringify(meter) + ' · converted ' + JSON.stringify(up.res));
  ok('the conversion drove the road meter into its last tenth',
     !!meter && meter.frac >= 0.9, JSON.stringify(meter));
  ok('the conversion seam fired', up.seen.indexOf('road-class') >= 0, JSON.stringify(up.seen));
  ok('THE BAR — the pair genuinely FLIPS: the target was content and now names roadcap',
     before && before.reason === 'ok' && after && after.reason === 'roadcap',
     cell(before) + '  →  ' + cell(after));
  ok('…and roadcap is the term that moved', termOf(before, 'roadcap') === 1 && termOf(after, 'roadcap') < 1,
     'roadcap ' + termOf(before, 'roadcap') + ' → ' + termOf(after, 'roadcap'));
  seam('c', '/src/roads/index.js:186-206 applyRun()', 'MythicRoadClasses._apply() — the drag tool\'s own api.apply', before, after, true);

  /* THE CONTROL for this seam is a conversion of a run the target is not on.
     The road meter is a CITY figure, so the honest control is the one that
     changes nothing at all: converting a run that is ALREADY that class. */
  const ctlBefore = await snap();
  await page.evaluate(async () => {
    const R = window.MythicRoadClasses;
    await R._apply([{ x: 18, z: 20 }, { x: 19, z: 20 }], 'street');   // already street
  });
  await step();
  const ctlAfter = await snap();
  ok('CONTROL — converting an island stub to the class it already has leaves the target byte-identical',
     JSON.stringify(ctlBefore) === JSON.stringify(ctlAfter), sr(ctlBefore) + '  →  ' + sr(ctlAfter));

  await page.evaluate(async () => {
    const R = window.MythicRoadClasses;
    const cells = []; for (let x = 4; x <= 16; x++) cells.push({ x, z: 12 });
    await R._apply(cells, 'street');
  });
  await step();
  const down = await snap();
  const meter2 = await page.evaluate(() => window.MythicPlotMood.report().road);
  ok('…and it clears when the class goes back down, same session, no reload',
     termOf(down, 'roadcap') === 1 && down.reason === 'ok',
     cell(down) + ' · meter ' + JSON.stringify(meter2));

  /* THE RIG'S OWN CLASS SETTER IS THE SIXTH WRITER OF `t.rc`, and it reaches
     NEITHER seam: it does not go through tryPlace (no tile is created) and it
     does not go through applyRun (it is node-city's own ungated closure). Left
     unhooked it would hand any future driver a mood computed from the previous
     road meter and let it call this seam dead. Driven here rather than trusted,
     because both verify gates only PARSE. */
  const rigSet = await page.evaluate(async () => {
    const nc = window.__nc, M = window.MythicPlotMood;
    const was = nc.roadClassOf(4, 12);
    M.invalidate('probe-reset');
    let set = null;
    const rec = await window.__mrRecord(async () => { set = nc.roadClass(4, 12, 'avenue'); });
    nc.roadClass(4, 12, was);                       // put it back
    return { was, set, seen: rec.seen, restored: nc.roadClassOf(4, 12) };
  });
  await step();
  ok('__nc.roadClass — the rig\'s own t.rc writer — fires the seam too',
     rigSet.seen.indexOf('road-class') >= 0 && rigSet.set === 'avenue' && rigSet.restored === rigSet.was,
     JSON.stringify(rigSet));
}

/* ── 5. SEAM (e) — /src/power's line Set ────────────────────────────────────
   Run BEFORE the water seam on purpose: `plumbed` is derived from "has this
   city any pipe at all", so the moment §7 lays its first main every unpiped
   building on the board drops to a water score of 0.00 — which would then win
   every comparison here and the power term could never be the reason.
   ⚠ AND `lay`/`lift` ARE THE PLAYER'S PATH, not a façade. lines.js's own drag
     tool commits through exactly these two functions (lines.js :761 and :771),
     and both end at `changed()`, which is where the invalidate lives. ── */
console.log('\n5. seam (e) /src/power lines.lay / lift — a Set with its own save slice');
{
  const before = await page.evaluate(() => {
    const P = window.MythicPower, M = window.MythicPlotMood;
    const s = P.state();
    return { t: M.moodAtKey('18,19'), c: M.moodAtKey('22,19'),
             cap: s && +s.capacity.toFixed(2), fac: s && s.factor, enforce: s && s.enforce,
             unserved: s ? s.topo.unserved.map((u) => u.k) : null,
             fT: P.factorAt(18, 19).factor, fC: P.factorAt(22, 19).factor, lines: P.lines.count() };
  });
  console.log('     grid: ' + JSON.stringify({ capacity: before.cap, factor: before.fac, enforcing: before.enforce, unserved: before.unserved }));
  ok('the plant is actually generating (TRAP 2 — an unstaffed plant reads 0.00)', before.cap > 0, 'capacity=' + before.cap);
  ok('BEFORE — the island subject is off the cable network and its power term is shed',
     termOf(before.t, 'power') !== null && termOf(before.t, 'power') < 1, 'power=' + termOf(before.t, 'power') + ' factorAt=' + before.fT);
  ok('BEFORE — and `power` is the reason the face is showing', before.t && before.t.reason === 'power', sr(before.t));

  const laid = await page.evaluate(async () => {
    const P = window.MythicPower;
    const c = P.lines.connector();
    /* The line ends on the FREE tile beside the subject, not on the subject:
       a building tile cannot hold a cable cell, and grid.js serves a load that
       is ORTHOGONALLY ADJACENT to a conductor. */
    const rec = await window.__mrRecord(() => P.lines.lay(c.x, c.z, 17, 19));
    return { r: rec.out, seen: rec.seen, count: P.lines.count() };
  });
  ok('laying a line through the drag tool\'s own lay() fired the seam',
     laid.seen.indexOf('power-lines') >= 0, JSON.stringify(laid.seen));
  console.log('     laid ' + JSON.stringify(laid.r) + ' · cells now ' + laid.count);
  await step();

  const after = await page.evaluate(() => {
    const P = window.MythicPower, M = window.MythicPlotMood;
    const s = P.state();
    return { t: M.moodAtKey('18,19'), c: M.moodAtKey('22,19'),
             unserved: s ? s.topo.unserved.map((u) => u.k) : null,
             fT: P.factorAt(18, 19).factor, fC: P.factorAt(22, 19).factor };
  });
  pair(before.t, after.t);
  ok('AFTER — the power term cleared, in the same session with no reload',
     termOf(after.t, 'power') === 1, 'power=' + termOf(after.t, 'power') + ' factorAt=' + after.fT);
  ok('AFTER — and `power` is no longer the reason', after.t && after.t.reason !== 'power', sr(after.t));
  ok('CONTROL — the second subject, four tiles east on its own stub, is byte-identical',
     cell(before.c) === cell(after.c), sr(before.c) + '  →  ' + sr(after.c));
  seam('e', '/src/power/lines.js:232 changed()', 'MythicPower.lines.lay() — the drag tool\'s own commit', before.t, after.t, true);

  const lifted = await page.evaluate(async () => {
    const P = window.MythicPower; const c = P.lines.connector();
    const rec = await window.__mrRecord(async () => P.lines.lift(c.x, c.z, 17, 19));
    return { r: rec.out, seen: rec.seen };
  });
  ok('lifting the line fires the seam too', lifted.seen.indexOf('power-lines') >= 0, JSON.stringify(lifted.seen));
  await step();
  const back = await snapAt('18,19');
  ok('…and the defect comes back when the cable goes', termOf(back, 'power') !== null && termOf(back, 'power') < 1,
     'power=' + termOf(back, 'power'));
}

/* ── 6. THE VISIBLE HALF — a pixel A/B under README item 6's protocol ────
   ⚠ RUN HERE, BEFORE THE WATER SEAM, AND THAT IS A MEASURED DECISION rather
     than a running order. §7 plumbs the city, which drops every unpiped
     building on the board to a water score of 0.00 — the subject below would
     then keep a badge whatever the lamp did, and the identity claim would be
     untestable.
   🔴 AND IT MEASURES IDENTITY, NOT FOOTPRINT. See the header. The subject is
      16,11, a house on a city where every other term is 1.0 and whose only
      defect is the dark block, so the fix takes it to `ok` — and MOOD.drawHappy
      is false, so the badge is not redrawn smaller, it is GONE. ── */
console.log('\n6. pixel A/B of the glyph above the subject — badge IDENTITY, not footprint');
{
  const sub = await page.evaluate(async () => {
    const nc = window.__nc;
    /* Frame BOTH crops from above and to the north. updateMatrixWorld is the
       load-bearing line — lookAt() writes the quaternion, and the matrixWorld
       the projection reads is only refreshed inside render(). */
    nc.camera.position.set(-2, 21, -9);
    if (nc.controls) { nc.controls.target.set(5, 0.6, 3); nc.controls.update(); }
    nc.camera.position.set(-2, 21, -9);
    nc.camera.lookAt(5, 0.6, 3);
    nc.camera.updateMatrixWorld();
    nc.camera.updateProjectionMatrix();
    /* Every agent hidden. A van that walks two pixels between the two shots is
       noise in a crop that is trying to measure one badge. */
    try { nc.cullAgents(0.001); } catch (e) {}
    try { if (window.MythicPlotIcons) { window.MythicPlotIcons.show(); window.MythicPlotIcons.sync(); } } catch (e) {}
    return { mood: window.MythicPlotMood.moodAtKey('16,11') };
  });
  ok('the A/B subject is a house whose ONLY defect is the dark block',
     !!sub.mood && sub.mood.reason === 'dark' && sub.mood.terms.every((t) => t.k === 'dark' || t.s === 1),
     sr(sub.mood) + ' · terms ' + JSON.stringify(sub.mood && sub.mood.terms.filter((t) => t.s < 1)));
  await page.waitForTimeout(700);

  const px = await page.evaluate(async () => {
    const nc = window.__nc, M = window.MythicPlotMood;
    const { renderer, scene, camera, THREE } = nc.three();
    const ICONS = window.MythicPlotIcons || null;
    if (!ICONS) return { err: 'no MythicPlotIcons — the glyph layer is what has to be measured, not index.js\'s stood-down painter' };
    const gl = renderer.domElement, CW = gl.width, CH = gl.height;
    const s = document.createElement('canvas'); s.width = CW; s.height = CH;
    const g2 = s.getContext('2d', { willReadFrequently: true });

    /* The crop is MEASURED — the module's own anchorAt(), projected through the
       LIVE camera — never a guessed world height. */
    const project = (a) => {
      const v = new THREE.Vector3(a.x, a.y, a.z).project(camera);
      return { sx: (v.x * 0.5 + 0.5) * CW, sy: (-v.y * 0.5 + 0.5) * CH };
    };
    const HW = 75, HH = 52;
    const box = (p) => ({ x0: Math.max(0, Math.round(p.sx - HW)), y0: Math.max(0, Math.round(p.sy - HH)),
                          x1: Math.min(CW, Math.round(p.sx + HW)), y1: Math.min(CH, Math.round(p.sy + HH)) });
    /* 🔴 render() then drawImage IN THE SAME TASK. preserveDrawingBuffer is off,
       so by the next task the buffer is gone and this returns the PREVIOUS
       frame — a dead instrument that reports a confident 0.00 %. */
    const shoot = () => { renderer.render(scene, camera);
      g2.clearRect(0, 0, CW, CH); g2.drawImage(gl, 0, 0, CW, CH);
      return g2.getImageData(0, 0, CW, CH).data; };
    const diff = (A, B, b) => {
      let n = 0, tot = 0;
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
        const i = (y * CW + x) * 4; tot++;
        if (Math.abs(A[i] - B[i]) > 6 || Math.abs(A[i + 1] - B[i + 1]) > 6 || Math.abs(A[i + 2] - B[i + 2]) > 6) n++;
      }
      return +(100 * n / Math.max(1, tot)).toFixed(2);
    };
    const named = (k) => ICONS.drawn().filter((d) => d.x + ',' + d.z === k).map((d) => d.glyph + '/' + d.reason);

    ICONS.show(); M.repaint(true); ICONS.sync();
    const aT = nc.plotIconAnchor(16, 11), aC = nc.plotIconAnchor(22, 19);
    const pT = project(aT), pC = project(aC);
    const bT = box(pT), bC = box(pC);
    const onScreen = (p) => p.sx > HW && p.sx < CW - HW && p.sy > HH && p.sy < CH - HH;
    const overlap = !(bT.x1 <= bC.x0 || bC.x1 <= bT.x0 || bT.y1 <= bC.y0 || bC.y1 <= bT.y0);

    const moodA = M.moodAtKey('16,11'), moodAc = M.moodAtKey('22,19');
    const drawnA = named('16,11');
    /* ⚠ ONE WARM FRAME FIRST, DISCARDED. The first render after a texture or a
       geometry has been rebuilt uploads them, and it comes back different from
       the second for reasons that have nothing to do with the city. Measured:
       without this, two shots with NOTHING changed differed by 13 %. */
    shoot();
    const A_on = shoot();
    const A2 = shoot();                       // the do-nothing shot: A_on vs A2 must be 0
    /* 🔴 THE FOUR-WAY, AND WHY IT EXISTS. The fixing STREET LIGHT lands one
       tile from the subject, and at this camera one tile is about 14 px in x,
       so the new pole is INSIDE a ±75 px crop. A single A_on→B_on number is
       therefore glyph + lamp mesh + the lamp's light, and nothing separates
       them. So each state is shot TWICE, once with the badge layer hidden, and
       the glyph is measured as the difference the badges alone make WITHIN one
       state — where the world is byte-identical by construction and cannot
       contribute a single pixel. Every flip is followed by a render() before
       the read (README item 6). */
    ICONS.hide();
    shoot();                                  // warm the flip
    const A_off = shoot();

    /* STATE B — a lamp, laid through the SHIPPED placement path. No reload, no
       re-mount, no hand-written tile, and NO TICK: the same call a player's
       click makes, and nothing else in the world moves.
       ⚠ 17,11 rather than 15,11: at Chebyshev-2 both light 16,11, and 17,11
         leaves the crop's west half — where the badge sits — untouched. */
    await nc.place('streetlight', 17, 11);
    try { nc.build.finishAll('ab'); } catch (e) {}
    try { nc.cullAgents(0.001); } catch (e) {}
    M.repaint(true);                           // badges still HIDDEN here
    shoot();
    const B_off = shoot();
    ICONS.show(); M.repaint(true); ICONS.sync();
    shoot();                                   // warm the rebuilt badge buffer
    const B_on = shoot();
    const moodB = M.moodAtKey('16,11'), moodBc = M.moodAtKey('22,19');
    const drawnB = named('16,11');

    return { canvas: [CW, CH], anchorT: aT, anchorC: aC, at: pT, control: pC, overlap,
             onScreen: onScreen(pT) && onScreen(pC),
             noiseT: diff(A_on, A2, bT), noiseC: diff(A_on, A2, bC),
             builders: diff(A_on, B_on, bT),      // glyph + world, the naive number
             worldOnly: diff(A_off, B_off, bT),   // the lamp mesh alone — the confound
             glyphBefore: diff(A_off, A_on, bT),  // the badge's OWN footprint, state A
             glyphAfter: diff(B_off, B_on, bT),   // the badge's OWN footprint, state B
             controlCrop: diff(A_on, B_on, bC),
             controlGlyph: diff(A_off, A_on, bC),
             drawnA, drawnB,
             moodA: { score: moodA && moodA.score, reason: moodA && moodA.reason },
             moodB: { score: moodB && moodB.score, reason: moodB && moodB.reason },
             ctlA: { score: moodAc && moodAc.score, reason: moodAc && moodAc.reason },
             ctlB: { score: moodBc && moodBc.score, reason: moodBc && moodBc.reason },
             icons: { visible: ICONS.visible(), drawn: ICONS.drawn().length, cost: ICONS.cost(), source: ICONS.source() },
             mine: M.verify().drawCalls };
  });
  if (px.err) ok('the glyph layer is reachable', false, px.err);
  else {
    console.log('   canvas ' + JSON.stringify(px.canvas));
    console.log('   subject anchor ' + JSON.stringify(px.anchorT) + ' → px ' + JSON.stringify(px.at));
    console.log('   control anchor ' + JSON.stringify(px.anchorC) + ' → px ' + JSON.stringify(px.control));
    console.log('   mood  16,11 ' + JSON.stringify(px.moodA) + '  →  ' + JSON.stringify(px.moodB));
    console.log('   badge 16,11 ' + JSON.stringify(px.drawnA) + '  →  ' + JSON.stringify(px.drawnB));
    console.log('   ctl   22,19 ' + JSON.stringify(px.ctlA) + '  →  ' + JSON.stringify(px.ctlB));
    console.log('   ── the crop over 16,11, four ways in ONE task ───────────────────────────');
    console.log('     A_on  → B_on    glyph + world (the naive number)   ' + px.builders + '%');
    console.log('     A_off → B_off   the lamp mesh ALONE, badges hidden ' + px.worldOnly + '%   ← the confound, disclosed');
    console.log('     A_off → A_on    THE GLYPH, before the fix          ' + px.glyphBefore + '%');
    console.log('     B_off → B_on    THE GLYPH, after  the fix          ' + px.glyphAfter + '%   ← must fall to the noise floor');
    console.log('     A_off → A_on    the same, over the CONTROL crop    ' + px.controlGlyph + '%');
    ok('both crops are on screen and do not overlap', px.onScreen && !px.overlap,
       JSON.stringify({ onScreen: px.onScreen, overlap: px.overlap }));
    ok('the instrument is alive — two shots with nothing changed differ by 0',
       px.noiseT === 0 && px.noiseC === 0, JSON.stringify({ target: px.noiseT, control: px.noiseC }));
    ok('the mood under the subject actually moved (or the pixels below prove nothing)',
       JSON.stringify(px.moodA) !== JSON.stringify(px.moodB), sr(px.moodA) + ' → ' + sr(px.moodB));
    ok('the control badge did NOT move', JSON.stringify(px.ctlA) === JSON.stringify(px.ctlB), sr(px.ctlA) + ' → ' + sr(px.ctlB));
    /* 🔴 THE HEADLINE IS THE GLYPH-ONLY PAIR, not the naive number. Within one
       state the world is byte-identical, so every pixel counted here is badge. */
    ok('GLYPH ONLY — the frowning badge is a real, measurable part of the crop',
       px.glyphBefore > 1, px.glyphBefore + '% of the crop is badge while the house is unhappy');
    ok('IDENTITY — the badge is GONE once the defect is fixed, not merely redrawn',
       px.glyphAfter <= px.noiseT + 0.2 && px.drawnB.length === 0,
       'glyph ' + px.glyphBefore + '% → ' + px.glyphAfter + '% · roster ' + JSON.stringify(px.drawnA) + ' → ' + JSON.stringify(px.drawnB));
    ok('the disclosed confound is smaller than the glyph it was hiding inside',
       px.worldOnly < px.glyphBefore, 'lamp mesh ' + px.worldOnly + '% vs glyph ' + px.glyphBefore + '%');
    ok('the unflagged control crop moved 0', px.controlCrop === 0, px.controlCrop + '%');
    console.log('   glyph layer: ' + JSON.stringify({ visible: px.icons.visible, source: px.icons.source, cost: px.icons.cost }));
    ok('the glyph is ONE mesh over ONE texture — index.js stood its own painter down',
       px.mine === 0 && px.icons.cost.meshes === 1 && px.icons.cost.textures === 1,
       JSON.stringify({ indexJsDrawCalls: px.mine, overlayMeshes: px.icons.cost.meshes }));
  }
}

/* ── 7. SEAM (d) — /src/water, THROUGH THE PLAYER'S OWN COMMIT PATHS ──────
   🔴 THIS SECTION EXISTS IN THIS SHAPE BECAUSE A CRITIC BROKE THE LAST ONE.
      It used to drive `__nc.waterPipe` → `MythicWater.pipes.add`, a façade the
      player cannot reach. What the player reaches is:
        • the pipe DRAG   → netui.js onDown/onMove/onUp → commit() → after()
                            → api.onEdit()  (handed over at water/index.js :279)
        • the Sea Drain   → drain.js place() → after() → api.onEdit()
                            (handed over at water/index.js :290)
      Both hand-overs now carry the ping, with DISTINCT ids, and this section
      drives both of them and nothing else.

   ⚠ SYNTHESISING THE DRAG (TRAP 5). /src/netdrag/rig.js listens on `document`
     with capture:true and dispatches to the one armed claimant, whose `hot()`
     requires `ev.target === host.canvas`. So the events are dispatched ON THE
     CANVAS and bubble up to the capture listeners exactly as a real pointer's
     do. The client coordinates are the tile's world centre projected through
     the live camera; the tile→world offset is derived from a known anchor
     rather than assuming HALF = 12. ── */
console.log('\n7. seam (d) /src/water — the pipe DRAG and the Sea Drain button, not the façade');
{
  /* The pointer rig, installed once. Returns the count of cells the graph
     gained so a drag that picked the wrong tiles cannot pass as a drag that
     picked the right ones. */
  const rig = await page.evaluate(() => {
    const nc = window.__nc;
    const { renderer, camera, THREE } = nc.three();
    const canvas = renderer.domElement;
    /* Derive the tile→world offset from a tile whose anchor we can read.
       anchor.x = x - HALF + 0.5  ⇒  HALF = x + 0.5 - anchor.x */
    const a = nc.plotIconAnchor(8, 11);
    if (!a) return { ok: false, why: 'no anchor to derive the tile→world offset from' };
    const HALF = 8 + 0.5 - a.x;
    window.__mrPointer = (x, z) => {
      camera.updateMatrixWorld();
      const v = new THREE.Vector3(x - HALF + 0.5, 0, z - HALF + 0.5).project(camera);
      const r = canvas.getBoundingClientRect();
      return { clientX: r.left + (v.x * 0.5 + 0.5) * r.width,
               clientY: r.top + (-v.y * 0.5 + 0.5) * r.height };
    };
    window.__mrDrag = async (x0, z0, x1, z1) => {
      const W = window.MythicWater;
      const n0 = W.pipes.count();
      const ev = (type, p, btn) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, button: btn || 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: p.clientX, clientY: p.clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      const a0 = window.__mrPointer(x0, z0), a1 = window.__mrPointer(x1, z1);
      ev('pointerdown', a0);
      ev('pointermove', { clientX: (a0.clientX + a1.clientX) / 2, clientY: (a0.clientY + a1.clientY) / 2 });
      ev('pointermove', a1);
      ev('pointerup', a1);
      /* commit() awaits payCost, so the graph is not written when dispatch
         returns. Yield until the count settles or a short budget runs out —
         never a fixed sleep, which is how a flaky harness is written. */
      for (let i = 0; i < 40 && window.MythicWater.pipes.count() === n0; i++) await new Promise((r) => setTimeout(r, 25));
      return window.MythicWater.pipes.count() - n0;
    };
    return { ok: true, HALF, armed: window.MythicWater.pipes.tool(true) };
  });
  ok('the SHIPPED pipe tool armed — this is /src/netdrag\'s arbiter, the player\'s only pointer path',
     rig.ok && rig.armed === true, JSON.stringify(rig));

  /* CUT THE TARGET'S WATER, through the module's own rule rather than a flag:
     `plumbed` is derived — "any pipe, any governed well, any outfall" — and an
     unplumbed city is served everywhere by definition (servedAt returns true).
     So one run of main that reaches NEITHER house plumbs the city and leaves
     both of them off the network. Nothing is hand-written. */
  const cut = await page.evaluate(async () => {
    const M = window.MythicPlotMood;
    const inv0 = M.report().stats.invalidations;
    const r = await window.__mrRecord(() => window.__mrDrag(6, 11, 6, 14));
    return { n: r.out, seen: r.seen, inv0, inv1: M.report().stats.invalidations,
             pipes: window.MythicWater.pipes.count() };
  });
  ok('THE PLAYER\'S DRAG laid main — three synthesised pointer events, no façade call',
     cut.n > 0, cut.n + ' cells, pipes now ' + cut.pipes);
  ok('…and it fired the seam from NetUI\'s own onEdit (water/index.js :279)',
     cut.seen.indexOf('water-edit') >= 0 && cut.inv1 > cut.inv0,
     'invalidate() calls during the gesture: ' + JSON.stringify(cut.seen) +
     ' · counter ' + cut.inv0 + ' → ' + cut.inv1);
  await step();

  const before = await page.evaluate(() => {
    const W = window.MythicWater, M = window.MythicPlotMood;
    const m = W.mains();
    return { t: M.moodAtKey('8,11'), c: M.moodAtKey('12,11'),
             mains: { plumbed: m.plumbed, pipes: m.pipes, unservedTiles: m.unservedTiles },
             sT: W.servedAt('8,11'), sC: W.servedAt('12,11') };
  });
  console.log('     mains: ' + JSON.stringify(before.mains) + ' · served ' + JSON.stringify({ target: before.sT, control: before.sC }));
  ok('BEFORE — the city is plumbed and the target is NOT on the mains', before.mains.plumbed === true && before.sT === false,
     JSON.stringify({ plumbed: before.mains.plumbed, served: before.sT }));
  ok('BEFORE — the target\'s reason is the water id', before.t && before.t.reason === 'water', sr(before.t));

  const laid = await page.evaluate(async () => {
    const M = window.MythicPlotMood;
    const inv0 = M.report().stats.invalidations;
    const r = await window.__mrRecord(() => window.__mrDrag(6, 11, 8, 11));
    return { n: r.out, seen: r.seen, inv0, inv1: M.report().stats.invalidations };
  });
  ok('the drag that reaches the target fires the same player seam',
     laid.seen.indexOf('water-edit') >= 0 && laid.inv1 > laid.inv0 && laid.n > 0,
     JSON.stringify(laid.seen) + ' · ' + laid.n + ' cells · counter ' + laid.inv0 + ' → ' + laid.inv1);
  await step();
  const after = await page.evaluate(() => {
    const W = window.MythicWater, M = window.MythicPlotMood;
    return { t: M.moodAtKey('8,11'), c: M.moodAtKey('12,11'), sT: W.servedAt('8,11'), sC: W.servedAt('12,11') };
  });
  pair(before.t, after.t);
  ok('AFTER — the water term cleared, in the same session with no reload',
     termOf(after.t, 'water') === 1 && after.sT === true, 'water=' + termOf(after.t, 'water') + ' servedAt=' + after.sT);
  ok('AFTER — and the reason is no longer the water id', after.t && after.t.reason !== 'water', sr(after.t));
  ok('CONTROL — the house four tiles east, still off the mains, is byte-identical',
     cell(before.c) === cell(after.c), sr(before.c) + '  →  ' + sr(after.c));
  seam('d', '/src/water/netui.js:562/590 commit() → onEdit', 'a synthesised pointer DRAG on the canvas', before.t, after.t, true);

  /* THE SEA DRAIN BUTTON — the other commit tail on the same onEdit seam, and
     the one the critic drove to prove the façade hook was not on the player's
     path. `place()` is the button's own function: it refuses, charges through
     payCost and builds. The cell is FOUND through the module's own refusal
     rule rather than guessed, so a retune of the apron cannot leave this
     asserting on a cell that is no longer legal. */
  const drain = await page.evaluate(async () => {
    const W = window.MythicWater, M = window.MythicPlotMood;
    const dom = W.pipes.domain ? W.pipes.domain() : null;
    let spot = null;
    for (let x = 24; x <= 30 && !spot; x++) for (let z = 0; z < 24; z++) {
      if (W.drains.refusalAt(x, z) == null) { spot = { x, z }; break; }
    }
    if (!spot) return { spot: null, dom };
    const n0 = W.drains.count();
    const inv0 = M.report().stats.invalidations;
    const rec = await window.__mrRecord(() => W.drains.place(spot.x, spot.z));
    return { spot, dom, r: rec.out, seen: rec.seen, n0, n1: W.drains.count(),
             inv0, inv1: M.report().stats.invalidations };
  });
  console.log('     sea drain at ' + JSON.stringify(drain.spot) + ' → ' + JSON.stringify(drain.r));
  ok('the Sea Drain button\'s own place() built a drain', !!(drain.r && drain.r.ok) && drain.n1 === drain.n0 + 1,
     'count ' + drain.n0 + ' → ' + drain.n1);
  ok('THE CRITIC\'S CASE — drains.place() now moves the invalidation counter (it did NOT before this round)',
     drain.seen.indexOf('drain-edit') >= 0 && drain.inv1 > drain.inv0,
     'invalidate() calls during the press: ' + JSON.stringify(drain.seen) +
     ' · counter ' + drain.inv0 + ' → ' + drain.inv1);
  await page.evaluate(() => { try { window.MythicWater.pipes.tool(false); } catch (e) {} });
}

/* ── 8. THE DIRTY-FLAG CONTRACT ────────────────────────────────────────── */
console.log('\n8. the beat is a dirty-flag test and nothing else');
{
  const r = await page.evaluate(() => {
    const M = window.MythicPlotMood;
    M.repaint(true);                       // settle
    const a = M.report().stats;
    for (let i = 0; i < 40; i++) M.beat();  // 40 beats, nothing placed
    const b = M.report().stats;
    M.invalidate('test');
    M.beat();
    const c = M.report().stats;
    return { beatsIdle: b.beats - a.beats, repaintsIdle: b.repaints - a.repaints,
             repaintsAfterInvalidate: c.repaints - b.repaints };
  });
  ok('40 idle beats cost ZERO recomputes', r.repaintsIdle === 0, JSON.stringify(r));
  ok('one invalidate + one beat costs exactly one repaint pass', r.repaintsAfterInvalidate <= 1, JSON.stringify(r));
}

/* ── 9. THE SELF-CHECK ─────────────────────────────────────────────────── */
console.log('\n9. self-check');
{
  const v = await page.evaluate(() => window.__nc.plotMoodVerify());
  ok('no NaN, no undefined, no scaffold judged, every frown has a fix', !!(v && v.ok), JSON.stringify(v));
}

/* ── 9b. THE STALENESS A/B — DOES *OPENING* THE LAYER MAKE THE FACES LIE? ──
   🔴 THIS SECTION EXISTS BECAUSE A CRITIC MEASURED A BUG THE OTHER NINE COULD
      NOT SEE, AND IT IS PERMANENT FOR EXACTLY THAT REASON.
   Every section above drives a SEAM: place a thing, read the face, assert it
   moved. All of them passed while the badge layer was, at the same time,
   reporting need:* terms one beat behind game.cov.pct — but ONLY while the
   layer was open, i.e. only in the state a player is in whenever this feature
   is in use.
   THE MECHANISM, so nobody has to re-derive it: game.cov.pct is written by
   computeCoverage(), which is called from vitalsTick(). __nc.step and
   animate() both run economyTick FIRST and vitalsTick SECOND. The host's
   tick-driven invalidate+sync used to sit at the tail of economyTick, and
   sync() is EAGER — it forces recompute() and stamps the memo with the
   CURRENT generation. So it rebuilt the table from the PREVIOUS beat's
   coverage and then marked it fresh, which defeats /src/plotmood's own safety
   net (table() only recomputes when cacheGen !== gen). Layer shut, nothing
   forced the rebuild, the lazy recompute happened on the read and agreed.
   Measured before the fix: layer hidden 0/8 beats disagreed, layer shown 8/8,
   each by exactly one beat. The hook now lives at the tail of vitalsTick.
   ⚠ A SETTLED BOARD CANNOT DETECT THIS AND MUST NOT BE USED. Sections 1–9 run
     on a city where every need bids exactly 1.0 (that is §1's asserted
     precondition, and it is what makes a byte-identical control possible). A
     term pinned at 1.0 reads the same whether it was computed this beat or
     last. So this section first puts the board back INSIDE the demand ramp
     with coverage genuinely short, and asserts that it did. It runs LAST for
     that reason: it deliberately wrecks the board every other section needs.
   ⚠ AND THE ASSERTION IS PROVED TO HAVE TEETH BEFORE IT IS TRUSTED. The
     negative control below reproduces the old ordering by hand — stamp the
     memo, then rewrite game.cov.pct the way vitalsTick would — and requires
     the checker to CATCH it. A staleness test that cannot fail is worse than
     no staleness test, because it is a green row that means nothing. */
console.log('\n9b. the staleness A/B — the ONLY variable is whether the layer is open');
{
  /* Back into the ramp. THREE things are needed and all three are needed:
       • HOUSES, which raise popCap() — vitalsTick clamps game.pop.npc to the
         cap, so without them the population set below is clamped straight back
         down on the next beat and nothing happens;
       • POPULATION, because computeCoverage() derives demand as
         DEMAND_PER_POP[n] × cityPop() — PER HEAD, not per house. ⚠ The first
         cut of this section placed 36 buildings and asserted coverage had
         fallen. It had not: 36 more tiles moved only `light` (the one need
         whose demand is the TILE COUNT) from 1.000 to 0.958, still above the
         0.85 floor, and every other need sat at 1.125. Houses are beds, not
         people;
       • a ramp REWIND, so the published figure is still MOVING beat to beat
         (DEMAND_RAMP_SEC is 180 s and node-city blends coverage from a neutral
         1.0 across it).
     A number that does not move cannot be caught being a beat behind, and a
     number pinned at 1.0 by the floor cannot either. */
  const shock = await page.evaluate(async () => {
    const nc = window.__nc, B = window.MythicCityBridge;
    if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
             B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
    const _c = window.confirm; window.confirm = () => true;
    let got = 0, tried = 0;
    const put = async (t, x, z) => {
      tried++;
      await nc.place(t, x, z);
      try { nc.build.finishAll('stale-ab'); } catch (e) {}
      if (nc.game.tiles[x + ',' + z]) got++;
    };
    // Two road stubs so the houses have frontage, then the houses themselves.
    for (let x = 4; x <= 12; x++) await put('road', x, 9);
    for (let x = 4; x <= 12; x++) await put('road', x, 16);
    for (let x = 4; x <= 12; x++) await put('housing', x, 8);
    for (let x = 4; x <= 12; x++) await put('housing', x, 17);
    window.confirm = _c;
    /* The people. 90% of the cap the houses above just bought, which is a
       crowded-but-legal city rather than a made-up number: vitalsTick clamps
       to popCap() every beat, so anything above it would be silently undone
       and anything well below it would not out-run the services §1 built. */
    const cap = nc.popBudget().cap;
    const pop = Math.floor(cap * 0.9);
    nc.game.pop.npc = pop;
    nc.game.cov.ramp = 0;                       // rewind — back inside the ramp
    return { got: got, tried: tried, cap: cap, pop: pop,
             tiles: Object.keys(nc.game.tiles).length };
  });

  /* THE CHECKER, INSTALLED ONCE AND USED BY ALL THREE READS BELOW. For every
     need:* term the badge scored on, put game.cov.pct through MOOD.needFloor's
     OWN clamp — the same expression /src/plotmood bids with — and require the
     term to equal it. It lives in the page so that the term and the figure it
     claims to be derived from are read in ONE task, which is the dossier
     card's exact timing (plotMoodAt → moodAtKey). Three copies of it inline
     would be three chances for the control and the subject to drift apart. */
  await page.evaluate((k) => {
    window.__staleCheck = function (M, cov) {
      const floor = M.tuning.needFloor;
      const m = M.moodAtKey(k);
      const ts = (m && m.terms ? m.terms : []).filter((t) => t.k.indexOf('need:') === 0);
      return ts.map((t) => {
        const n = t.k.slice(5), v = +cov[n];
        const e = +((v < floor ? Math.max(0, Math.min(1, v)) : 1).toFixed(4));
        return { n: n, term: t.s, cov: +v.toFixed(4), expect: e, agree: Math.abs(t.s - e) < 1e-4 };
      });
    };
  }, TK);

  // Let the shock reach the published table, but stop well short of the ramp.
  for (let i = 0; i < 3; i++) await step(0.25);
  const state = await page.evaluate(() => {
    const nc = window.__nc, M = window.MythicPlotMood;
    const cov = nc.game.cov.pct || {};
    const rows = window.__staleCheck(M, cov);
    return { floor: M.tuning.needFloor, ramp: +(nc.game.cov.ramp || 0).toFixed(1),
             pct: Object.fromEntries(Object.keys(cov).map((k) => [k, +(+cov[k]).toFixed(3)])),
             short: rows.filter((r) => r.cov < M.tuning.needFloor).map((r) => r.n),
             needs: rows.length };
  });
  console.log('   shock: ' + shock.got + '/' + shock.tried + ' placements stood · tiles ' + shock.tiles
              + ' · pop ' + shock.pop + ' of cap ' + shock.cap + ' · cov.ramp ' + state.ramp + 's of 180s');
  console.log('   cov.pct ' + JSON.stringify(state.pct));
  ok('THE PRECONDITION — the board is back inside the ramp with at least one need UNDER the floor '
     + '(a settled 1.0 board cannot detect a one-beat lag)',
     state.needs >= 4 && state.short.length > 0,
     state.short.length ? 'under ' + state.floor + ': ' + JSON.stringify(state.short)
                        : 'every need still bids 1.0 — this section would be a no-op');

  /* ── 9b.i THE NEGATIVE CONTROL. Reproduce the OLD ordering BY HAND. ──
     Stamp the memo (what the old economyTick-tail sync() did), then rewrite
     game.cov.pct (what vitalsTick then did). Nothing invalidates in between,
     because the eager sync has already stamped the current generation. The
     checker MUST catch this, or every green row below means nothing. */
  const teeth = await page.evaluate(async () => {
    const nc = window.__nc, M = window.MythicPlotMood, I = window.MythicPlotIcons;
    const was = I.visible(); I.show();
    M.invalidate('teeth'); I.sync();                   // ← the eager stamp
    const cov = nc.game.cov.pct;
    const saved = Object.assign({}, cov);
    for (const k of Object.keys(cov)) cov[k] = 0.10;   // ← vitalsTick's write
    const rows = window.__staleCheck(M, cov);
    Object.assign(cov, saved);                         // put the board back
    M.invalidate('teeth-restore');
    if (!was) I.hide();
    return { caught: rows.filter((r) => !r.agree).length, of: rows.length,
             sample: rows.filter((r) => !r.agree)[0] || null };
  });
  ok('NEGATIVE CONTROL — the checker CATCHES a memo stamped before coverage was rewritten '
     + '(i.e. this section could have failed)',
     teeth.caught > 0, teeth.caught + '/' + teeth.of + ' terms caught'
     + (teeth.sample ? '  e.g. ' + JSON.stringify(teeth.sample) : ''));

  /* ── 9b.ii / iii THE A/B. Same board, same steps, same read. The layer's
        visibility is the only thing that differs between the two runs, and it
        is the thing that used to decide whether the numbers agreed with their
        own source. */
  const AB_BEATS = 8;
  const trial = (vis) => page.evaluate(async (v) => {
    const nc = window.__nc, M = window.MythicPlotMood, I = window.MythicPlotIcons;
    if (v) I.show(); else I.hide();
    await nc.step(0.25, 1);                     // economyTick then vitalsTick
    const cov = nc.game.cov.pct || {};
    const rows = window.__staleCheck(M, cov);
    return { visible: I.visible(), bad: rows.filter((r) => !r.agree),
             short: rows.filter((r) => r.cov < M.tuning.needFloor).length,
             covSig: Object.keys(cov).sort().map((k) => (+cov[k]).toFixed(4)).join(',') };
  }, vis);

  /* 🔴 EACH RUN STARTS FROM THE SAME BOARD, and the first cut of this section
     did not — which made the second run a different experiment, not a control.
     Run A swept the ramp from 45 s to 165 s; by the time run B started the
     ramp had closed, coverage had stopped moving, and B reported "coverage
     moved on 0/7 beat boundaries" — a run that could not have caught the bug
     even if it were still there, sitting under a green tick. Rewinding the
     ramp AND restoring the population makes the two runs traverse the same
     regime with the layer's visibility as the only difference between them. */
  const reset = () => page.evaluate((p) => {
    const nc = window.__nc;
    nc.game.pop.npc = p;
    nc.game.cov.ramp = 0;
    try { window.MythicPlotMood.invalidate('ab-reset'); } catch (e) {}
  }, shock.pop);

  const run = async (vis, n) => {
    await reset();
    let bad = 0, moved = 0, short = 0, prev = null, wrongLayer = 0;
    const eg = [];
    for (let i = 0; i < n; i++) {
      const t = await trial(vis);
      if (t.bad.length) { bad++; if (eg.length < 3) eg.push(t.bad[0]); }
      if (prev != null && t.covSig !== prev) moved++;
      prev = t.covSig;
      short = Math.max(short, t.short);
      if (t.visible !== vis) wrongLayer++;      // the A/B's own variable failed to set
    }
    return { bad: bad, moved: moved, short: short, eg: eg, wrongLayer: wrongLayer };
  };

  console.log('   A. layer HIDDEN — the control. Nothing forces a rebuild; the recompute is on the read.');
  const off = await run(false, AB_BEATS);
  console.log('      beats where a need:* term disagreed with game.cov.pct: ' + off.bad + '/' + AB_BEATS
              + '  (coverage moved on ' + off.moved + '/' + (AB_BEATS - 1) + ' beat boundaries, '
              + off.short + ' terms under the floor)');
  for (const e of off.eg) console.log('        e.g. need:' + e.n + ' term=' + e.term + ' cov=' + e.cov + ' expected=' + e.expect);

  console.log('   B. layer SHOWN — the state a player is in whenever this feature is in use.');
  const on = await run(true, AB_BEATS);
  console.log('      beats where a need:* term disagreed with game.cov.pct: ' + on.bad + '/' + AB_BEATS
              + '  (coverage moved on ' + on.moved + '/' + (AB_BEATS - 1) + ' beat boundaries, '
              + on.short + ' terms under the floor)');
  for (const e of on.eg) console.log('        e.g. need:' + e.n + ' term=' + e.term + ' cov=' + e.cov + ' expected=' + e.expect);

  ok('the A/B\'s own variable actually set on every beat', off.wrongLayer === 0 && on.wrongLayer === 0,
     'hidden ' + off.wrongLayer + ' · shown ' + on.wrongLayer + ' beats read the wrong layer state');
  ok('THE RUN WAS CAPABLE OF FAILING — coverage moved between beats and terms sat under the floor',
     off.moved >= AB_BEATS - 2 && on.moved >= AB_BEATS - 2 && off.short > 0 && on.short > 0,
     'hidden moved ' + off.moved + '/' + (AB_BEATS - 1) + ' short ' + off.short
     + ' · shown moved ' + on.moved + '/' + (AB_BEATS - 1) + ' short ' + on.short);
  ok('CONTROL — layer HIDDEN: every need:* term agrees with game.cov.pct',
     off.bad === 0, off.bad + '/' + AB_BEATS + ' stale beats');
  ok('layer SHOWN: every need:* term STILL agrees with game.cov.pct (this read 8/8 before the hook moved)',
     on.bad === 0, on.bad + '/' + AB_BEATS + ' stale beats');
  ok('OPENING THE LAYER CHANGES NOTHING ABOUT THE NUMBERS — the two runs agree',
     off.bad === on.bad, 'hidden ' + off.bad + ' · shown ' + on.bad);

  /* ── 9b.iv THE CONSEQUENCE A PLAYER CAN SEE. The badge's own reason and
        score against the same tile recomputed from THIS beat. Before the fix
        these differed while the layer was open, which is the glyph and the
        dossier card telling two stories about one house. */
  const seen = await page.evaluate(async () => {
    const nc = window.__nc, M = window.MythicPlotMood, I = window.MythicPlotIcons;
    I.show();
    await nc.step(0.25, 1);
    const d = I.drawn().find((r) => r.x === 8 && r.z === 11) || null;
    const memo = M.moodAtKey('8,11');
    M.invalidate('fresh-read');                 // force a read of THIS beat's coverage
    const fresh = M.moodAtKey('8,11');
    I.hide();                                   // leave the layer as the rest of the file found it
    return { drawn: d ? d.reason : null, memo: { r: memo.reason, s: memo.score },
             fresh: { r: fresh.reason, s: fresh.score } };
  });
  console.log('      the glyph on screen names: ' + seen.drawn);
  console.log('      the memo the dossier card reads: ' + JSON.stringify(seen.memo));
  console.log('      the same tile recomputed from THIS beat: ' + JSON.stringify(seen.fresh));
  ok('the memo behind the glyph and a fresh recompute are byte-identical',
     seen.memo.r === seen.fresh.r && seen.memo.s === seen.fresh.s, JSON.stringify(seen));
  ok('and the glyph on screen names that same reason', seen.drawn === seen.fresh.r,
     'drawn ' + seen.drawn + ' · fresh ' + seen.fresh.r);
}

/* ── 10. THE SEAM TABLE ────────────────────────────────────────────────── */
console.log('\n10. one row per commit seam — and the PLAYER path each was driven through');
{
  const w = [3, 42, 52, 26, 26];
  const row = (c) => '   ' + c.map((s, i) => String(s).padEnd(w[i])).join('│ ');
  console.log(row(['id', 'where the invalidate lives', 'the path the PLAYER reaches it by', 'before', 'after']));
  console.log('   ' + w.map((n) => '─'.repeat(n)).join('┼─'));
  for (const s of SEAMS) console.log(row([s.id, s.where, s.via, s.before, s.after]));
  ok('all five seams produced a row', SEAMS.length === 5, SEAMS.length + '/5');
  ok('every seam row MOVED (a byte-identical pair is indistinguishable from a dead seam)',
     SEAMS.every((s) => s.before !== s.after), JSON.stringify(SEAMS.filter((s) => s.before === s.after).map((s) => s.id)));
}

console.log('\n' + (fails ? '🔴 ' + fails + ' FAILED' : '🟢 ALL PASSED'));
const bad = logs.filter((l) => l.startsWith('pageerror') || l.includes('PlotMood'));
if (bad.length) console.log('\nconsole:\n' + bad.slice(-12).join('\n'));
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
