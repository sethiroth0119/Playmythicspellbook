/* 👥 ONE CITY, ONE POPULATION (bug-mucu5m51).

   Reported: the main NPC counter said 1,206, the Zoning panel said "55
   Population · 44 Homes · 99% occupancy", and after building more houses it
   said "56 · 44 Homes · 45%". Three defects, all measured here:
     1. /src/demographics' zone normaliser read /src/zoning's real ids by
        keyword — `c_low`/`o_low` → detached houses, `c_high`/`o_high` → towers —
        so shops and offices were homes (and phantom beds via capacityDelta).
     2. deriveFromBuilding() never learned the density ladder (apartment …
        highrise), so building those left Homes unchanged.
     3. the Zoning panel labelled the module's residents-in-dwellings figure
        "Population". It now prints the city ledger under that name.

   Run: node _popagree_smoke.mjs */
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
globalThis.window = globalThis;

const Z = await import('./public/src/demographics/zones.js');
const DM = (await import('./public/src/demographics/index.js')).default;
const HUD = await import('./public/src/hud/demand.js');

/* ── 1. /src/zoning's ids ─────────────────────────────────────────────── */
for (const id of ['c_low', 'c_high', 'o_low', 'o_high', 'i_mfg', 'i_ware'])
  ok(Z.normalizeZone(id) === null, id + ' is not housing', Z.normalizeZone(id));
const want = { r_low: 'resLow', r_row: 'resRow', r_apt: 'resApt', r_high: 'resHigh', r_mixed: 'resMixed',
  r_mansion: 'resLow', r_condo: 'resApt', r_rent: 'resLowRent', r_asbuilt: null };
for (const id in want) ok(Z.normalizeZone(id) === want[id], id + ' → ' + want[id], Z.normalizeZone(id));
ok(Z.normalizeZone('commercialLow') === null && Z.normalizeZone('residential-high') === 'resHigh', 'the keyword pass still works for other spellings');

/* ── the city: a street of houses, a high street, offices, one apartment ── */
const POPCAP = { housing: 6, apartment: 24, aptblock: 70, apttower: 180, highrise: 320, shop: 0, restaurant: 0, office: 0 };
const tiles = {};
let nx = 0;
const put = (type, lvl, zone) => { const k = (nx++) + ',0'; tiles[k] = { type, lvl, zone }; return k; };
for (let i = 0; i < 6; i++) put('housing', 1, 'r_asbuilt');
for (let i = 0; i < 4; i++) put('shop', 2, 'c_low');
for (let i = 0; i < 3; i++) put('restaurant', 1, 'c_high');
for (let i = 0; i < 2; i++) put('office', 2, 'o_high');
put('apartment', 1, null);
window.MythicZoning = { zoneAt: (x, z) => (tiles[x + ',' + z] || {}).zone || null };
const parcels = () => Object.keys(tiles).map((k) => {
  const t = tiles[k], c = k.split(',');
  return { key: k, x: +c[0], z: +c[1], type: t.type, lvl: t.lvl, popCap: (POPCAP[t.type] || 0) * t.lvl, site: false, zone: null };
});

/* ── 1b. no commercial tile is a home, and none adds a phantom bed ──────── */
let sv = Z.survey(parcels());
for (const [k, info] of sv.byKey) ok(['housing', 'apartment'].includes(tiles[k].type), 'surveyed ' + tiles[k].type + ' at ' + k + ' is a home tile');
ok(Z.capacityDelta(sv) === 0, 'shops and offices add no beds to popCap via capacityDelta', Z.capacityDelta(sv));

/* ── 2. building houses moves Homes ─────────────────────────────────────── */
const h0 = sv.totalHomes;
ok(sv.byKey.has('15,0'), 'the Apartment Building is surveyed as dwellings');
put('apartment', 1, null); put('aptblock', 1, null); put('housing', 1, null);
Z.beginTick(); sv = Z.survey(parcels());
ok(sv.totalHomes > h0, 'Homes rises when houses/apartments are built (' + h0 + ' → ' + sv.totalHomes + ')');
ok(Math.round(sv.totalCapacity) >= 6 * 7 + 24 * 2 + 70, 'dwelling capacity covers every bed the housing tiles grant', sv.totalCapacity);

/* ── 3. the panel's Population is the city ledger ───────────────────────── */
DM.mount({});
const cityPop = 1206;
for (let i = 0; i < 40; i++) DM.tick(60, { parcels: parcels(), population: cityPop });
const rep = DM.report();
ok(rep.ok && rep.hostPop === cityPop, 'report carries the city ledger as hostPop', rep.hostPop);
const res = HUD.read();
const card = (res.cats || res.byCat || res).res || (Array.isArray(res) ? res.find((c) => c.id === 'res') : null) || res;
const stat = (card && card.stat) || [];
const get = (k) => (stat.find((s) => s.k === k) || {}).v;
ok(Number(String(get('Population')).replace(/,/g, '')) === cityPop,
   'Zoning panel "Population" = the main counter (' + cityPop + ')', JSON.stringify(stat));
ok(get('In homes') != null && Number(String(get('In homes')).replace(/,/g, '')) === rep.population, 'the dwellings figure is labelled "In homes"', get('In homes'));
ok(Number(String(get('Homes')).replace(/,/g, '')) === rep.homes && rep.homes === sv.totalHomes, 'Homes = the dwellings on the tiles that exist', get('Homes'));
ok(rep.population <= cityPop, 'residents in homes never exceed the city ledger', rep.population);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
