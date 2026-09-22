/* 🛢🥩 bug-mu2oz3ve — "Fast Food / Food Truck / Restaurant: No feedstock".

   Real cause: those three tiles found /src/economy firms making preparedMeals,
   whose four legs are {meat, vegetables, rice, cookingOil} | {potatoes,
   vegetables, cookingOil} | {freshFish, vegetables, cookingOil} | {seafood,
   shellfish, vegetables}. NOTHING in node-city's ECO_BUILDING_MAP produced
   cookingOil or meat, so without a Fishing Company every leg was blocked and
   the firm read NO_FEEDSTOCK for ever. The owner's decision was new content:
   an Oil Press (soybeans → cookingOil) and an Abattoir (livestock → meat).

   This suite pins:
     1. the two tiles exist on every surface a building needs (BUILDINGS with a
        runnable tile recipe, the build menu, ECO_BUILDING_MAP, work types);
     2. cookingOil was PROMOTED the way the derivation demands (RESOURCES row
        + cinder value) and meat needed nothing (it was already a ledger id);
     3. the plot card no longer says "(no building makes it yet)" for either;
     4. DRIVEN: the shipped ecoBuildings() against the real economy module on
        a real node — WITHOUT the two buildings every kitchen-day is
        NO_FEEDSTOCK (the reproduction); WITH them the Oil Press makes oil and
        the kitchens make meals; and given livestock in stock the Abattoir
        makes meat and sells it.
        ⚠ In the full-chain city the ranch makes NO livestock: its freshWater
          reads 0% because residents drink the purifiers dry first. That is the
          city's water, not these buildings — which is why 4c supplies the
          livestock instead of pretending the ranch keeps up.

   Run: node _foodchain_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const IDX = readFileSync('./public/index.html', 'utf8');
const WORK = readFileSync('./public/src/work/work.js', 'utf8');

// Brace-match a block starting at `head`, stepping over comments and strings.
function block(src, head, open = '{') {
  const at = src.indexOf(head); if (at < 0) return null;
  const close = open === '[' ? ']' : '}';
  let i = src.indexOf(open, at + head.length - 1); const st = at; let d = 0;
  for (; i < src.length; i++) {
    const c = src[i], e = src[i + 1];
    if (c === '/' && e === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '/' && e === '/') { i = src.indexOf('\n', i + 2); continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; } continue; }
    if (c === open) d++; else if (c === close) { d--; if (d === 0) return src.slice(st, i + 1); }
  }
  return null;
}
const lit = (src, head, open = '{') => { const b = block(src, head, open); return b && b.slice(b.indexOf(open)); };
const loose = (txt) => { // BUILDINGS references a few consts — answer 0 for any free identifier
  const scope = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : 0) });
  return new Function('__s', 'with (__s) { return (' + txt + '); }')(scope);
};

const MAPTXT = lit(NC, 'const ECO_BUILDING_MAP = {');
const ECO = vm.runInNewContext('(' + MAPTXT + ')');
const OP = vm.runInNewContext('(' + lit(NC, 'const OP_ECO_MAP = {') + ')');
const BUILDINGS = loose(lit(NC, 'const BUILDINGS = {'));
const SECTIONS = loose(lit(NC, 'const BUILD_SECTIONS = [', '['));
const ORDER = vm.runInNewContext('(' + lit(NC, 'const BUILD_ORDER = [', '[') + ')');
const RESOURCES = vm.runInNewContext('(' + lit(IDX, 'const RESOURCES = [', '[') + ')');
const VALUE = vm.runInNewContext('(' + lit(IDX, 'const RESOURCE_CINDER_VALUE = {') + ')');
const RIDS = new Set(RESOURCES.map((r) => r.id));
ok(!!MAPTXT && !!BUILDINGS && Array.isArray(SECTIONS) && ORDER.length > 50 && RESOURCES.length > 100,
  'lifted ECO_BUILDING_MAP / OP_ECO_MAP / BUILDINGS / BUILD_SECTIONS / BUILD_ORDER / RESOURCES');

/* ── 1. THE TWO BUILDINGS, ON EVERY SURFACE ─────────────────────────────── */
const NEW = { oilpress: { out: 'cookingOil', in: 'corn', feeder: 'farm' },
              abattoir: { out: 'meat',       in: 'livestock', feeder: 'stockfarm' } };
for (const [k, want] of Object.entries(NEW)) {
  const b = BUILDINGS[k] || {}, m = ECO[k] || {};
  ok(!!BUILDINGS[k] && b.cost && b.cost.cinder > 0 && b.crew > 0, k + ' is a BUILDINGS row with a cost and a crew');
  ok(JSON.stringify(m.out) === JSON.stringify([want.out]) && m.ind === 'foodPlant',
    k + ' founds a foodPlant firm making ' + want.out + ' (its own recipe industry)', JSON.stringify(m));
  ok((b.gen || {})[want.out] > 0, k + ' tile gens ' + want.out + ' — the tile recipe and the economy map agree', JSON.stringify(b.gen));
  ok((b.use || {})[want.in] > 0, k + ' tile eats ' + want.in, JSON.stringify(b.use));
  ok(RIDS.has(want.in) && ((BUILDINGS[want.feeder] || {}).gen || {})[want.in] > 0,
    '…which is a ledger id the ' + want.feeder + ' tile already gens — so the mirror fetches it and the tile can run');
  /* No Cinder faucet on the tile: ledger value out ≤ value in. */
  const vin = (VALUE[want.in] || 0) * b.use[want.in], vout = (VALUE[want.out] || 0) * b.gen[want.out];
  ok(vout <= vin + 1e-9, k + ' is not a Cinder faucet at ledger values (' + vout.toFixed(2) + ' out ≤ ' + vin.toFixed(2) + ' in)');
  ok(SECTIONS.some((s) => (s.items || []).includes(k)) && ORDER.includes(k), k + ' is in the build menu (a section AND BUILD_ORDER)');
  ok(new RegExp('\\n\\s*' + k + ':\\s*\\[').test(WORK), k + ' has work types in /src/work so a crew can staff it');
}

/* ── 2. PROMOTION: cookingOil joined the ledger, meat needed nothing ─────── */
{
  globalThis.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
  const chain = await import('./public/src/resources/chain.js');
  const PD = await import('./public/src/city/production.data.js');
  const oil = RESOURCES.find((r) => r.id === 'cookingOil'), c = chain.chainById('cookingOil');
  ok(!!oil && oil.name === c.name && oil.icon === c.icon && oil.color === c.color,
    'cookingOil is a RESOURCES row carrying chain.js name/icon/colour verbatim');
  ok(VALUE.cookingOil === 2, 'with the tier-1 cinder value every sibling carries (floor 78/28 = 2)', String(VALUE.cookingOil));
  ok(PD.PROMOTED_CHAIN_IDS.includes('cookingOil'), 'and it is in PROMOTED_CHAIN_IDS (round0p re-derives the list from ECO_BUILDING_MAP)');
  ok(!chain.NEW_IDS.includes('meat') && RIDS.has('meat') && PD.MINIGAME_IDS.includes('meat'),
    'meat was already a ledger id (the Homestead Farm\'s), so the Abattoir promotes nothing');
}

/* ── 3. THE PLOT CARD STOPS SAYING "no building makes it yet" ────────────── */
{
  const fn = block(NC, 'function pmFeedstockLead(d)');
  const ctx = { ECO_BUILDING_MAP: ECO, _ecoResLabel: (id) => id, Array, Set };
  vm.createContext(ctx); vm.runInContext(fn, ctx);
  const line = ctx.pmFeedstockLead({ noLeg: true, feedstocks: ['meat', 'vegetables', 'rice', 'cookingOil'] });
  ok(!!fn && /^Runs on /.test(line) && !/no building makes it yet/.test(line),
    'pmFeedstockLead names both as made by a building now', line);
}

/* ── 4. DRIVEN: the kitchens run ─────────────────────────────────────────── */
const chainMod = await import('./public/src/resources/chain.js');
window.MythicResourceChain = { ALL: chainMod.RESOURCE_CHAIN };
const E = (await import('./public/src/economy/index.js')).default;
const Endow = await import('./public/src/economy/endowment.js');
const Firms = await import('./public/src/economy/firms.js');
const _warn = console.warn, _info = console.info;
console.warn = () => {}; console.info = () => {};

/* A node whose ground carries what the full chain needs: the oilseed, the
   root leg's crops, corn and seaweed for the feed, and water. */
const NEED = ['soybeans', 'potatoes', 'vegetables', 'rice', 'corn', 'seaweed', 'rawWater'];
let NODE = null;
for (let i = 0; i < 3000 && !NODE; i++) { const n = 'food-' + i; if (NEED.every((id) => Endow.canExtract(n, id))) NODE = n; }
ok(!!NODE, 'found a node carrying ' + NEED.join(', '), NODE);

const FNS = ['function _ecoSeamRank(E, list)', 'function _ecoIsSeamRow(E, m)', 'function ecoBuildings()'].map((h) => block(NC, h));
function city(withNew) {
  const game = { tiles: {} };
  const map = Object.assign({}, ECO);
  for (const t of Object.keys(OP)) map['op_' + t] = OP[t];      // node-city joins ops the same way (opsKeyOf)
  if (!withNew) { delete map.oilpress; delete map.abattoir; }
  const ctx = { window, game, BUILDINGS: {}, bldSite: () => false, Object, Array, String };
  vm.createContext(ctx);
  vm.runInContext('const ECO_BUILDING_MAP = ' + JSON.stringify(map) + ';\n' + FNS.join('\n') + '\nthis.ecoBuildings = ecoBuildings;', ctx);
  let n = 0;
  const put = (type, count = 1) => { for (let i = 0; i < count; i++) game.tiles[(n++) + ',0'] = { type, lvl: 1 }; };
  // the full chain, laid out as a player would
  put('farm', 6);                              // seam spread: wheat, corn, rice, potatoes, soybeans, vegetables
  put('hydrofarm', 4);                         // more vegetables and potatoes — residents eat them too
  put('waterintake', 3); put('purifier', 3);   // rawWater → freshWater
  put('powerstation', 2);
  put('op_fishing', 4); put('op_feed');        // the seam spread reaches seaweed; seaweed + corn → animalFeed
  put('stockfarm', 2);                         // animalFeed + freshWater → livestock
  put('oilpress'); put('abattoir');            // ← the two new buildings (unmapped in the control)
  put('fastfood'); put('foodtruck'); put('restaurant');
  put('housing', 6);
  return ctx;
}
const H = { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.8, logisticsCounts: { warehouse: 3, depot: 3 }, population: 260 };
/* Kitchen state is sampled over a WINDOW, not read off the last day: a
   young kitchen can go broke, be reaped and be re-founded by syncBuildings,
   so any single day may catch one mid-refound. */
function run(withNew, days, window, feedLivestock) {
  E.mount({ nodeId: NODE, population: 260, established: false });
  const ctx = city(withNew);
  const tally = { kitchenDays: 0, stuckDays: 0, meals: 0, oil: 0, meat: 0, livestock: 0, legs: {}, feedLegs: {} };
  const madeBy = (id) => Firms.alive().filter((f) => f.tileKey && f.out === id).reduce((s, f) => s + (f.lastProduced || 0), 0);
  for (let d = 0; d < days; d++) {
    /* "A city with the inputs": stand in for a ranch that is keeping up, so the
       Abattoir is judged on its own recipe rather than on the city's water. */
    if (feedLivestock) { const inv = E.inventory(); if ((inv.livestock || 0) < 400) inv.livestock = 400; }
    E.syncBuildings(ctx.ecoBuildings()); E.tick(24 * 60, H);
    if (d < days - window) continue;
    for (const f of Firms.alive().filter((x) => x.tileKey && x.out === 'preparedMeals')) {
      const dx = E.diagnose(f.id);
      tally.kitchenDays++;
      if (dx.cause && dx.cause.key === 'NO_FEEDSTOCK') tally.stuckDays++;
      if ((dx.produced || 0) > 0) tally.legs[dx.leg] = (tally.legs[dx.leg] || 0) + 1;
      tally.meals += dx.produced || 0;
    }
    for (const f of Firms.alive().filter((x) => x.tileKey && x.out === 'animalFeed')) tally.feedLegs[(f.lastLeg && f.lastLeg.tag) || '-'] = 1;
    tally.oil += madeBy('cookingOil'); tally.meat += madeBy('meat'); tally.livestock += madeBy('livestock');
  }
  tally.audit = E.audit();
  tally.meatRevenue = Firms.alive().filter((f) => f.tileKey && f.out === 'meat').reduce((s, f) => s + (f.lifetimeRevenue || 0), 0);
  return tally;
}

/* 4a. The reproduction — the same city with neither building mapped. */
{
  const t = run(false, 40, 10);
  ok(t.kitchenDays > 0 && t.stuckDays === t.kitchenDays && t.meals === 0,
    'control (no Oil Press, no Abattoir): every kitchen-day is NO_FEEDSTOCK and no meal is made — the reported bug',
    t.stuckDays + '/' + t.kitchenDays + ' stuck, ' + t.meals.toFixed(0) + ' meals');
}

/* 4b. With the two buildings — the full chain, no help. */
{
  const t = run(true, 60, 20);
  console.log('     full chain, last 20 days: ' + t.meals.toFixed(0) + ' meals, legs ' + JSON.stringify(t.legs) +
              ', ' + t.stuckDays + '/' + t.kitchenDays + ' kitchen-days on NO_FEEDSTOCK, oil ' + t.oil.toFixed(0) +
              ', livestock ' + t.livestock.toFixed(0) + ', meat ' + t.meat.toFixed(0) + ', feed legs ' + Object.keys(t.feedLegs).join(','));
  ok(t.oil > 0, 'the Oil Press firm produces cooking oil', t.oil.toFixed(1));
  ok(t.meals > 0 && Object.keys(t.legs).some((l) => l !== 'shellfish'),
    'Fast Food / Food Truck / Restaurant make meals on an oil leg — they are off "No feedstock"', JSON.stringify(t.legs));
  ok(t.stuckDays < t.kitchenDays, 'and NO_FEEDSTOCK is no longer permanent', t.stuckDays + '/' + t.kitchenDays);
  ok(!!t.feedLegs.seaweed, 'the Feed Operation runs its seaweed leg (grain needs biomass, which nothing makes)', Object.keys(t.feedLegs).join(','));
  ok(t.audit && t.audit.ok, 'the closed-loop Cinder audit stays clean', t.audit && ('err=' + t.audit.err));
}

/* 4c. Given livestock in stock, the Abattoir makes meat and the kitchens use it. */
{
  const t = run(true, 30, 10, true);
  ok(t.meat > 0, 'with livestock available, the Abattoir firm produces meat', t.meat.toFixed(1));
  /* Not "the kitchens switch to the meat leg": bestLeg() ranks by cost and the
     root leg is cheaper, so a kitchen with potatoes on hand rightly keeps
     frying chips. The meat is SOLD — to residents (meat is in the food basket)
     and to any kitchen whose cheaper legs run dry. */
  ok(t.meatRevenue > 0, 'and it sells — the Abattoir earns revenue', t.meatRevenue.toFixed(1));
  ok(t.audit && t.audit.ok, 'the audit stays clean', t.audit && ('err=' + t.audit.err));
}
console.warn = _warn; console.info = _info;

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
