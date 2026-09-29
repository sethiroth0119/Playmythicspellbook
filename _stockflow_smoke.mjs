/* 🏥📤🪚 v121v118 — the Clinic never dispenses more than it prepared; city
   goods (rations, planks, remedies) flow to the stash by themselves; planks are
   a build cost in the city builder, the farm and the camp. Runs the tick
   helpers for real. Run: node _stockflow_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const FARM = readFileSync('./public/src/farm/index.js', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the clinic ── */
/* THE RULE, NOT THE LINE. This pinned the whole `got` expression as one
   line, so it went red the moment a THIRD way to feed a service was added
   (the Clinic now dispenses nothing and its coverage comes from its own
   production run). Nothing it was protecting had changed - svcDraw is still
   asked via svcWantFor - so assert that, and assert the new arm beside it.
   A check that fails on a reflow teaches people to update checks without
   reading them. */
ok(/svcDraw\(s\.input, svcWantFor\(def, s, mult, omRes, dtMin\), def\)/.test(NC),
  'the tick asks svcWantFor how much a service may draw');
ok(/: s\.fromRun \? \(runOk \? share : 0\)\s*\n\s*: 1;/.test(NC),
  '...and a service that dispenses NOTHING is fed by its own production run, not a free 1');
{
  const body = NC.slice(NC.indexOf('function svcWantFor('), NC.indexOf('/* 📤 AUTO-STASH'));
  const svcWantFor = new Function(body + '\nreturn svcWantFor;')();
  const clinic = { gen: { remedies: 0.45 }, use: { medicine: 0.28, water: 0.24 }, svc: { need: 'health', supply: 1.5, input: 'remedies', rate: 0.30 } };
  ok(Math.abs(svcWantFor(clinic, clinic.svc, 1, 1, 1) - 0.30) < 1e-9, 'run for real: at full conditions the Clinic draws its 0.30/min (it made 0.45)');
  ok(Math.abs(svcWantFor(clinic, clinic.svc, 1, 0.5, 1) - 0.225) < 1e-9, '…at 50 % conditions it draws 0.225 — exactly what it prepared, never more (was 0.30 against 0.225 made)');
  ok(Math.abs(svcWantFor(clinic, clinic.svc, 1, 0.1, 10) - 0.45) < 1e-9, '…and over ten minutes at 10 %: 0.45 drawn for 0.45 made');
  const kitchen = { svc: { need: 'food', supply: 1, input: 'rations', rate: 0.5 } };
  ok(Math.abs(svcWantFor(kitchen, kitchen.svc, 2, 0.3, 1) - 1.0) < 1e-9, 'a kitchen (does not make rations) still draws its full rate whatever the conditions');
}

/* ── 2. the auto-stash ── */
ok(/try \{ autoStashTick\(false\); \} catch \(e\) \{\}/.test(NC) && /try \{ autoStashTick\(false\)[^\n]*\n\s*economyTick\._demandFull = demandFull;/.test(NC), 'the tick moves the surplus at its end (just before the demand snapshot the next share reads)');
{
  const body = NC.slice(NC.indexOf('/* 📤 AUTO-STASH'), NC.indexOf('async function autoStashTick(force)'));
  const helpers = new Function(body + '\nreturn { autoStashReserve, AUTO_STASH_RESERVE_MIN, AUTO_STASH_FLOOR, AUTO_STASH_EVERY_MS };')();
  const B = { clinic: { gen: { remedies: 0.45 }, use: { medicine: 0.28, water: 0.24 }, svc: { input: 'remedies', rate: 0.30 } }, restaurant: { svc: { input: 'rations', rate: 0.5 } }, sawmill: { gen: { planks: 0.42 } } };
  const tiles = { '1,1': { type: 'clinic', lvl: 1 }, '2,2': { type: 'restaurant', lvl: 2 }, '3,3': { type: 'sawmill', lvl: 1 }, '4,4': { type: 'restaurant', lvl: 1, damaged: true } };
  ok(helpers.autoStashReserve('remedies', tiles, B) === Math.ceil(0.30 * 120) + 20, 'the Clinic\'s remedies reserve is two hours of its dispensing plus the floor', helpers.autoStashReserve('remedies', tiles, B));
  ok(helpers.autoStashReserve('rations', tiles, B) === Math.ceil(1.0 * 120) + 20, 'rations: two kitchens (level 2 draws twice), the damaged one does not count', helpers.autoStashReserve('rations', tiles, B));
  ok(helpers.autoStashReserve('planks', tiles, B) === 20, 'planks nobody in the city draws: just the floor');
  // the whole tick, with a stash that takes everything, then one that refuses until halved
  const full = NC.slice(NC.indexOf('/* 📤 AUTO-STASH'), NC.indexOf('\n}\n', NC.indexOf('} finally { _autoStashBusy = false; }')) + 3);
  const mk = (addRes) => {
    const g = { STOCK_STASHABLE: ['rations', 'planks', 'remedies'], game: { stock: { rations: 500, planks: 4000, remedies: 5 }, tiles }, BUILDINGS: B, stockOf: (r) => g.game.stock[r] || 0, MythicCityBridge: { addRes }, saveSoon() { g.saved = true; }, toast(m) { g.toast = m; }, resName: (r) => r, updateHUD() {}, Date, Math, Object, setTimeout };
    const api = new Function('g', 'with (g) { ' + full + '\nreturn { autoStashTick, tiles: () => game.tiles }; }')(g);
    return { g, api };
  };
  const a = mk(async () => true);
  const moved = await a.api.autoStashTick(true);
  ok(moved && moved.planks === 3980 && moved.rations === 500 - (Math.ceil(1.0 * 120) + 20) && !moved.remedies, 'run for real: 3,980 planks and the surplus rations go to the stash; the 5 remedies stay (below the reserve)', JSON.stringify(moved));
  ok(a.g.game.stock.planks === 20 && a.g.game.stock.rations === Math.ceil(1.0 * 120) + 20 && a.g.saved === true && /Sent to your stash/.test(a.g.toast), 'the shelf keeps its reserve, the city saves, the player is told');
  const calls = []; const b = mk(async (r, n) => { calls.push(n); return n <= 1000; });
  const moved2 = await b.api.autoStashTick(true);
  ok(moved2.planks === 995 && calls.filter((n) => n >= 995).join() === '3980,1990,995' && b.g.game.stock.planks === 4000 - 995, 'a stash that refuses the pile is retried by halves until it takes what fits (3,980 → 1,990 → 995)', JSON.stringify({ moved2, calls }));
  const c = mk(async () => true); await c.api.autoStashTick(true);
  ok((await c.api.autoStashTick(false)) === null, '…and the next tick within five minutes does nothing');
}

/* ── 3. planks as a build cost ── */
/* 🪚 v121v128 (bug-mtxkunre) — TWELVE, not thirteen. The BASIC house came off
   the list on the reporter's own recommendation: a new city starts with
   `stock: {}`, and it cannot make a plank until it has raised power, a Logging
   Camp and a Sawmill — each of which needs crew, and crew needs housing. So the
   city's very first house sat behind three buildings it could not staff. This
   is a deliberate change to what the file says, not a baseline being raised:
   the pin below asserts the new rule, including that the sink survives
   everywhere it was doing work. */
ok((NC.match(/, planks: \d+ \}/g) || []).length >= 12, 'twelve city-builder buildings take planks (the apartment tiers, barracks, tower, gate, shop, office, retail, club, arena) — the basic house no longer does', (NC.match(/, planks: \d+ \}/g) || []).length);
ok(/highrise:\s*\{ name: 'High-Rise',[^\n]*planks: 200 \}/.test(NC) && /apartment:\s*\{ name: 'Apartment Building',[^\n]*planks: 16 \}/.test(NC),
  'from 16 planks for an Apartment to 200 for a High-Rise — every housing tier ABOVE the basic house still pays');
{
  const h = NC.slice(NC.indexOf("  housing:  { name: 'Housing'"), NC.indexOf("  housing:  { name: 'Housing'") + 260);
  ok(!/planks/.test(h) && /cost: \{ cinder: 26, metal: 10, supplies: 6 \}/.test(h),
    '…and the basic house is plank-free, with nothing else about its price moved (bug-mtxkunre)');
}
ok((FARM.match(/planks: \d+/g) || []).length === 12, 'the feed business: six farm buildings take planks at levels 2 and 3 (Feed Mill, the pens, the Farm Kitchen)', (FARM.match(/planks: \d+/g) || []).length);
ok(/id: 'feedmill'[\s\S]{0,600}\{ cinder: 90000, wood: 140, stone: 90, metal: 40, planks: 40 \},\n\s*\{ cinder: 225000, wood: 300, stone: 200, metal: 120, planks: 100 \}/.test(FARM), 'the Feed Mill: 40 planks at level 2, 100 at level 3; level 1 stays plank-free');
{
  const camp = SRC.slice(SRC.indexOf('const CAMP_FACILITIES = ['), SRC.indexOf('\n];', SRC.indexOf('const CAMP_FACILITIES = [')));
  ok((camp.match(/planks: \d+/g) || []).length === 14, 'the Camp: five facilities take planks from level 2 (Resistance Ring, Training Center, Proving Ground, Black Market, Morale Lounge)', (camp.match(/planks: \d+/g) || []).length);
  ok(/id: 'barracks'[\s\S]{0,400}fuel: 10, planks: 20 \},/.test(camp), 'the Resistance Ring: 20 planks at level 2');
}
ok(/\{ id: 'planks'/.test(SRC), 'planks is a ledger resource (v121v105), so every cost renderer and spendResources know it');

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 118, 'BUILD_VERSION is v121v118 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
ok(/src\/farm\/index\.js\?v=v121v118farm(5|6)\b/.test(SRC), 'the farm buster moved (farm6: the Homestead doors)');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
