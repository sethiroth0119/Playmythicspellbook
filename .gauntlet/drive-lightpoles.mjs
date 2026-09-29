/* ══════════════════════════════════════════════════════════════════════════
   💡 DRIVE-LIGHTPOLES — "the NPCs complain about street lights and the roads
   already have street lights on them"

   The report is exactly right and the cause is a split brain: every road tile
   has carried a lamp MESH and a real light in the night pool since the day/night
   cycle shipped, while litKeys() counted only placed Street Lights. Roads went
   into the light DEMAND (computeCoverage counts every tile) and contributed
   nothing to supply, so paving a city made its Light vital worse while filling
   the screen with working lamps.

   ⚠ EVERY CLAIM HERE IS MEASURED AGAINST A CONTROL THAT MUST FAIL:
       · roads light themselves  → a city of BUILDINGS ONLY must stay dark
       · a road lamp reaches 1   → the tile 2 back from a road must stay dark
       · a pole reaches 2        → and it must light that same far tile
       · a pole needs power      → the identical pole with the grid cut goes out
       · the kerb rule           → the same pole one tile further out is refused
     If the "after" case passed and the control passed too, the feature would be
     decoration and this file would be a rubber stamp.

   ⚠ IT DRIVES litKeys() AND coverage(), NOT A SECOND COPY OF THE RADIUS MODEL.
     Re-deriving Chebyshev here would test the rig. __nc.litKeys() is the set the
     game itself uses for the Light vital.

   Run:  node .gauntlet/drive-lightpoles.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const P = 8610 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 170)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.litKeys && window.__nc.previewOk)', null, { timeout: 180000 });
await pg.waitForTimeout(2500);

const r = await pg.evaluate(() => {
  const nc = window.__nc, o = {};
  const K = (x, z) => x + ',' + z;

  /* A CLEAN BOARD. Building a city through the shop would drag in cost,
     population and cap rules that have nothing to do with lighting; this writes
     tiles the way loadState does and then asks the SHIPPED litKeys() about
     them. The meshes are irrelevant — litKeys reads game.tiles, not the scene. */
  const wipe = () => { for (const k of Object.keys(nc.game.tiles)) delete nc.game.tiles[k]; };
  const put = (x, z, type, extra) => {
    nc.game.tiles[K(x, z)] = Object.assign({ type, lvl: 1, rot: 0, born: 0, spent: 0, earn: 0, bld: null }, extra || {});
  };
  const lit = () => new Set(nc.litKeys());
  // Full grid, so poleHasPower's no-module fallback answers "there is a grid".
  const grid = (gen, dem) => { nc.game.power.gen = gen; nc.game.power.demand = dem; nc.game.power.ratio = dem ? gen / dem : 1; nc.game.power.factor = gen >= dem ? 1 : 0.5 + 0.5 * (dem ? gen / dem : 1); };

  o.roadType = Object.keys(nc.BUILDINGS).find(t => /road|street/i.test(t)) || null;
  // Use the game's own road resolver rather than guessing an id.
  const ROAD = (window.MythicRoads && window.MythicRoads.types()[0]) || 'road';
  o.ROAD = ROAD;

  // ── 1. THE REPORTED BUG: a paved city is lit ─────────────────────────────
  wipe(); grid(10, 1);
  for (let x = 4; x <= 10; x++) put(x, 6, ROAD);
  {
    const L = lit();
    let n = 0; for (const k in nc.game.tiles) if (L.has(k)) n++;
    o.pavedLitTiles = n;
    o.pavedTotal = Object.keys(nc.game.tiles).length;
    const c = nc.coverage();
    o.pavedLightPct = +( ((nc.game.cov.pct || {}).light) || 0 ).toFixed(3);
    o.pavedSupply = (nc.game.cov.supply || {}).light;
  }

  // ── 1b. CONTROL: buildings, no roads, no poles → still dark ──────────────
  wipe(); grid(10, 1);
  for (let x = 4; x <= 10; x++) put(x, 6, 'housing');
  {
    const L = lit();
    let n = 0; for (const k in nc.game.tiles) if (L.has(k)) n++;
    o.unpavedLitTiles = n;
    o.unpavedTotal = Object.keys(nc.game.tiles).length;
  }

  // ── 2. REACH: a road lamp does 1, a pole does 2 ──────────────────────────
  wipe(); grid(10, 1);
  put(6, 6, ROAD);
  {
    const L = lit();
    o.roadLightsSelf = L.has(K(6, 6));
    o.roadLightsOneOut = L.has(K(6, 7)) && L.has(K(7, 6)) && L.has(K(7, 7));  // Chebyshev 1, corners too
    o.roadLightsTwoOut = L.has(K(6, 8));                                       // must be FALSE
  }
  wipe(); grid(10, 1);
  put(6, 6, 'streetlight');
  {
    const L = lit();
    o.poleLightsOneOut = L.has(K(6, 7));
    o.poleLightsTwoOut = L.has(K(6, 8));       // the pole's whole selling point
    o.poleLightsThreeOut = L.has(K(6, 9));     // must be FALSE
  }

  /* ── 3. POWER — BOTH BRANCHES, because they answer to different authorities.
     ⚠ THE FIRST VERSION OF THIS SECTION WAS WRONG AND PASSED FOR THE WRONG
       REASON. It cut power by writing game.power.gen = 0 and expected the pole
       to go out. It did not, and the code was right: /src/power ships with
       transmission.enforce = true, so on a live page MythicPower.factorAt() is
       the authority and a write to game.power is invisible to it. A "blackout"
       the authority never saw is not a blackout. Each branch is now cut at its
       own source. */
  const PW = window.MythicPower;
  const realEnforcing = PW && PW.enforcing, realFactorAt = PW && PW.factorAt;
  const stubGrid = (factor) => {
    if (!PW) return false;
    PW.enforcing = () => ({ inEffect: true, flag: true, wired: true });
    PW.factorAt = () => ({ factor, cls: 'stub', shed: factor < 1 });
    return true;
  };
  const unstub = () => { if (PW) { PW.enforcing = realEnforcing; PW.factorAt = realFactorAt; } };

  wipe();
  put(6, 6, 'streetlight');
  grid(10, 1);
  o.powerModulePresent = !!PW;

  // (a) the module branch — the tile is connected
  stubGrid(1);
  o.poweredPoleLit = lit().has(K(6, 8));
  o.poweredSaysLit = nc.poleLit(6, 6);
  // (b) the module branch — the tile is off the end of the network
  stubGrid(0);
  o.darkPoleLit = lit().has(K(6, 8));          // must be FALSE
  o.darkSaysLit = nc.poleLit(6, 6);            // must be FALSE
  o.darkTip = (nc.tipOf(K(6, 6)) || '');
  // (c) a brownout is NOT a blackout — factor bottoms out at POWER_FLOOR 0.5
  stubGrid(0.5);
  o.brownoutPoleLit = lit().has(K(6, 8));      // must stay TRUE
  unstub();

  // (d) the NO-MODULE fallback: /src/power absent, city generating nothing
  const savedPW = window.MythicPower;
  window.MythicPower = null;
  grid(10, 1); o.fallbackPoweredLit = lit().has(K(6, 8));
  grid(0, 5);  o.fallbackDarkLit = lit().has(K(6, 8));   // must be FALSE
  window.MythicPower = savedPW;

  // …and a road lamp is NOT knocked out by any of it, on purpose.
  wipe(); grid(0, 5);
  put(6, 6, ROAD);
  stubGrid(0);
  o.roadLampSurvivesBlackout = lit().has(K(6, 6));
  unstub();

  // ── 4. A SITE AND A DAMAGED POLE LIGHT NOTHING (unchanged rule) ──────────
  wipe(); grid(10, 1);
  put(6, 6, 'streetlight', { bld: { k: 0, l: 1, s: Date.now() / 1000, d: 3600, pc: null, pr: null } });
  o.sitePoleLit = lit().has(K(6, 6));
  wipe(); grid(10, 1);
  put(6, 6, 'streetlight', { damaged: true });
  o.damagedPoleLit = lit().has(K(6, 6));
  wipe(); grid(10, 1);
  put(6, 6, ROAD, { damaged: true });
  o.damagedRoadLit = lit().has(K(6, 6));

  // ── 5. THE KERB RULE + THE PREVIEW SQUARE ────────────────────────────────
  wipe(); grid(10, 1);
  put(6, 6, ROAD);
  o.previewBesideRoad = nc.previewOk('streetlight', 6, 7);     // green
  o.previewTwoOut = nc.previewOk('streetlight', 6, 8);         // RED — the point
  o.previewDiagonal = nc.previewOk('streetlight', 7, 7);       // RED — a kerb is an edge
  o.previewOnRoad = nc.previewOk('streetlight', 6, 6);         // RED — occupied
  // …and a building with no kerb rule is unaffected by any of it.
  o.previewHousingAnywhere = nc.previewOk('housing', 6, 8);
  o.previewHousingOccupied = nc.previewOk('housing', 6, 6);

  return o;
});

/* The kerb rule at the real gate — tryPlace, with money and caps in play.
   Separated because __nc.place() is async and charges the city. */
const place = await pg.evaluate(async () => {
  const nc = window.__nc, K = (x, z) => x + ',' + z;
  for (const k of Object.keys(nc.game.tiles)) delete nc.game.tiles[k];
  nc.game.cinder = 100000;
  const ROAD = (window.MythicRoads && window.MythicRoads.types()[0]) || 'road';
  nc.game.tiles[K(6, 6)] = { type: ROAD, lvl: 1, rot: 0, born: 0, spent: 0, earn: 0, bld: null };
  await nc.place('streetlight', 6, 8);           // no kerb — must be refused
  const far = !!nc.game.tiles[K(6, 8)];
  await nc.place('streetlight', 6, 7);           // on the kerb — must land
  const near = nc.game.tiles[K(6, 7)] || null;
  return { farPlaced: far, nearPlaced: !!near, nearType: near && near.type, link: near && near.lightRoad || null };
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F4A1} STREET LIGHTING\n');

console.log('  ── the reported bug: a paved city was dark to the simulation');
ok('\u{1F3AF} a road-only city is now LIT', r.pavedLitTiles === r.pavedTotal && r.pavedTotal > 0,
  r.pavedLitTiles + ' / ' + r.pavedTotal + ' tiles');
ok('\u{1F3AF} CONTROL · the same city of BUILDINGS stays dark', r.unpavedLitTiles === 0,
  r.unpavedLitTiles + ' / ' + r.unpavedTotal + ' tiles');

console.log('\n  ── reach: the pole is an upgrade, not a duplicate');
ok('a road lamp lights its own tile', r.roadLightsSelf === true);
ok('…and one tile out, corners included', r.roadLightsOneOut === true);
ok('\u{1F3AF} CONTROL · but NOT two out — that gap is what a pole is for', r.roadLightsTwoOut === false);
ok('a pole reaches one out', r.poleLightsOneOut === true);
ok('\u{1F3AF} …and two, where the road lamp could not', r.poleLightsTwoOut === true);
ok('CONTROL · and not three', r.poleLightsThreeOut === false);

console.log('\n  ── the NO POWER state · /src/power is the authority');
ok('/src/power is mounted (else this whole branch is untested)', r.powerModulePresent === true);
ok('a pole on a connected tile lights its 5×5', r.poweredPoleLit === true && r.poweredSaysLit === true);
ok('\u{1F3AF} CONTROL · the SAME pole off the end of the network goes dark', r.darkPoleLit === false && r.darkSaysLit === false);
ok('\u{1F3AF} …and the hover card says so rather than leaving it a mystery', /NO POWER/.test(r.darkTip),
  (r.darkTip.match(/⚡ NO POWER[^<]*/) || ['(no line)'])[0]);
ok('a BROWNOUT does not put it out — a dim lamp is still a lit street', r.brownoutPoleLit === true);

console.log('\n  ── the NO POWER state · no /src/power at all');
ok('a generating city keeps its poles lit', r.fallbackPoweredLit === true);
ok('\u{1F3AF} CONTROL · a city generating nothing does not', r.fallbackDarkLit === false);
ok('a road lamp is knocked out by none of it', r.roadLampSurvivesBlackout === true);

console.log('\n  ── unchanged rules still hold');
ok('a pole still under construction lights nothing', r.sitePoleLit === false);
ok('a damaged pole lights nothing', r.damagedPoleLit === false);
ok('a damaged road lights nothing', r.damagedRoadLit === false);

console.log('\n  ── the kerb: preview square and the real gate agree');
ok('\u{1F3AF} the square is GREEN beside a road', r.previewBesideRoad === true);
ok('\u{1F3AF} CONTROL · RED two tiles out (the old build showed green, then refused)', r.previewTwoOut === false);
ok('RED on the diagonal — a kerb is an edge, not a corner', r.previewDiagonal === false);
ok('RED on an occupied tile', r.previewOnRoad === false);
ok('a building with no kerb rule is unaffected', r.previewHousingAnywhere === true && r.previewHousingOccupied === false);
ok('\u{1F3AF} tryPlace refuses the pole with no kerb', place.farPlaced === false);
ok('…and accepts it on the kerb', place.nearPlaced === true, String(place.nearType));
ok('\u{1F3AF} the road it serves is STORED on the tile', place.link === '6,6', String(place.link));

console.log('\npage errors: ' + errs.length); errs.slice(0, 5).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
