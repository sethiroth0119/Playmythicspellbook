/* Headless arithmetic check for /src/dossier: builds a small district in a fake
   ctx (the same shape index.html hands over) and asserts the address, the
   household deal and the money rows. No browser, no disk, no GPU — this is the
   part of the feature that can be proved without the page, so it is proved
   here and the browser run is left to prove the RENDER. */
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ set textContent(v) {}, id: '' }),
  head: { appendChild() {} },
};

const D = await import('../public/src/dossier/index.js');

const BUILDINGS = {
  road: { name: 'Road', ico: '🛤️', maxLvl: 1, desc: 'r' },
  housing: { name: 'Housing', ico: '🏠', popCap: 6, desc: 'h' },
  grocery: { name: 'Grocery', ico: '🥬', crew: 2, svc: { need: 'food', supply: 1, input: 'rations', rate: 0.4 }, desc: 'g' },
  gasstation: { name: 'Gas Station', ico: '⛽', crew: 1, gen: { cinder: 0.25 }, use: { fuel: 0.2 }, desc: 'gs' },
  tree: { name: 'Tree', ico: '🌳', maxLvl: 1, decorPts: 2, desc: 't' },
};
const tiles = {};
const put = (k, type, lvl, extra) => { tiles[k] = Object.assign({ type, lvl: lvl || 1 }, extra || {}); };
// road row z=4 (east-west) and road column x=4 (north-south)
for (let i = 0; i <= 10; i++) { put(i + ',4', 'road'); put('4,' + i, 'road'); }
/* 5,5 touches BOTH roads. rot 1 faces west, so its frontage — and therefore
   its street — must be the column, not the row the NEI scan would find first. */
put('5,5', 'housing', 1, { rot: 1 });
put('6,5', 'housing', 2);
put('7,5', 'housing', 1);
put('5,3', 'housing', 1);          // other side of the same road row
put('6,3', 'housing', 3);
put('7,7', 'housing', 1);          // no road frontage
put('5,6', 'grocery', 1);
put('3,3', 'gasstation', 2, { earn: 400, spent: 120 });
put('9,9', 'tree', 1);             // no frontage, no household

const game = { tiles, power: { factor: 1 }, res: {}, stock: {} };
const isRoad = (x, z) => { const t = tiles[x + ',' + z]; return !!(t && t.type === 'road'); };

const ctx = {
  game, BUILDINGS, MAX_LVL: 3, RATE_MULT: 2, CITY_DAY_MIN: 20, LOT_RENT_PER_MIN: 0.15,
  isRoad,
  lotValue: (x, z) => {
    let v = 20;
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (isRoad(x + dx, z + dz)) v += 10;
    return v;
  },
  haveOf: () => 10,
  genOf: (def, r) => (r === 'cinder' ? (def.gen[r] || 0) / 60 : (def.gen[r] || 0)),
  cinderRate: (v) => (v || 0) / 60,
  tileMult: () => 1.25,
  staffingRatio: () => 1,
  tileOutputFactor: () => 1,
  cityOutputMultipliers: () => ({}),
  resIco: (r) => ({ fuel: '⛽', rations: '🥫' }[r] || '?'),
  resName: (r) => r,
  esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  rate: (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (+v).toFixed(2)),
  pctCol: () => '#fff',
  card: (t, r, b) => '<div class="ins-card"><h>' + t + '|' + r + '</h>' + b + '</div>',
  fac: (l, v) => '<div class="fac">' + l + v + '</div>',
  alert: (c, i, t, d) => '<div class="al ' + c + '">' + t + ' ' + d + '</div>',
  sectionOf: () => null,
  opsRowForKey: () => null,
};

// a fake citizens layer, exactly the shape index.html's CITIZENS_API exposes
const NAMES = ['Ada Moreno', 'Bren Moreno', 'Cass Lark', 'Dara Lark', 'Edda Lark',
  'Fen Vantree', 'Gale Vantree', 'Hal Ashcroft', 'Ilva Ashcroft', 'Jory Crane'];
const citizens = NAMES.map((n, i) => ({ id: 'c' + i, name: n, job: i < 3 ? '5,6' : null, mood: 40 + i * 5 }));
window.MythicCitizens = {
  list: () => citizens.map(c => ({ ...c })),
  byJob: (k) => citizens.filter(c => c.job === k).map(c => ({ ...c })),
};

const api = D.mount(ctx);
const fails = [];
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails.push(label + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  console.log((ok ? '  ok  ' : ' FAIL ') + label + ' = ' + JSON.stringify(got));
};

console.log('── addresses ──');
eq('rot decides the frontage, not the scan order', api.addressOf('5,5').text, '110 5th Avenue');
eq('its neighbour fronts the row instead', api.addressOf('6,5').text, '112 5th Street');
eq('the far side of that road is ODD', api.addressOf('6,3').text, '113 5th Street');
eq('and numbers ascend along the street', api.addressOf('5,3').text, '111 5th Street');
eq('7,7 has no frontage', api.addressOf('7,7').why, 'nofrontage');
eq('a road is not AT an address, it IS the street', api.addressOf('6,4').street, '5th Street');
eq('a crossing knows it is one', api.addressOf('4,4').crossing, true);
eq('the grocery fronts the column', api.addressOf('5,6').text, '112 5th Avenue');

console.log('── zone ──');
eq('housing L1', api.zoneOf('5,5').label, 'Residential — Low Density Housing');
eq('housing L2', api.zoneOf('6,5').label, 'Residential — Medium Density Housing');
eq('housing L3', api.zoneOf('6,3').label, 'Residential — High Density Housing');
eq('grocery', api.zoneOf('5,6').label, 'Commercial — Service');
eq('gas station', api.zoneOf('3,3').label, 'Commercial — Retail');
eq('tree', api.zoneOf('9,9').label, 'Parks & Greenery');

console.log('── households ──');
const homes = ['5,3', '5,5', '6,3', '6,5', '7,5', '7,7'];
for (const k of homes) {
  const h = api.householdOf(k);
  console.log('  ' + k + ' → ' + h.name + ' [' + h.members.map(m => m.name).join(', ') + ']');
}
const all = homes.flatMap(k => api.householdOf(k).members.map(m => m.id));
eq('every named citizen is housed exactly once', all.length, citizens.length);
eq('no duplicate residents', new Set(all).size, all.length);
const fam = api.householdOf('5,3');
eq('a same-surname house is a Family', /Family$/.test(fam.name), true);

console.log('── stability across reloads ──');
const snap1 = homes.map(k => k + '=' + api.householdOf(k).members.map(m => m.id).join('+')).join(' ');
api.flush();
const snap2 = homes.map(k => k + '=' + api.householdOf(k).members.map(m => m.id).join('+')).join(' ');
eq('the deal is deterministic', snap1, snap2);

console.log('── wealth ──');
for (const k of homes) { const w = api.wealthOf(k); console.log('  ' + k + ' → ' + w.label + ' (rank ' + w.rank + '/' + w.of + ')'); }
eq('a non-home has no household wealth', api.wealthOf('5,6'), null);

console.log('── the books ──');
for (const k of ['3,3', '5,5', '5,6']) {
  const b = api.booksOf(k);
  console.log('  ' + k + ':');
  for (const r of b.rows) console.log('     ' + r.label.padEnd(16) + String(r.value).replace(/<[^>]*>/g, ''));
}
const gs = api.booksOf('3,3');
eq('a gas station earns real Cinder', gs.rows[0].value, '+0.10 🔥');
eq('and its lifetime is measured', gs.lifetime.net, 280);
eq('a house earns nothing and says so', api.booksOf('5,5').rows[0].un, true);

console.log('── headers ──');
eq('a home is titled by address alone', api.headerHtml('5,5', 'Housing'), '<span class="dsr-addr">110 5th Avenue</span>');
eq('a business keeps its name AND takes an address', api.headerHtml('3,3', 'Pumpline Fuels'),
  'Pumpline Fuels<span class="dsr-addr">, 107 5th Street</span>');
eq('no frontage ⇒ no override, the header is what it was', api.headerHtml('7,7', 'Housing'), null);
eq('a road is titled by its street', api.headerHtml('6,4', 'Road'), '5th Street');
eq('a crossing says so', api.headerHtml('4,4', 'Road'), '5th Street <span class="dsr-addr">crossing</span>');

console.log('── degradation ──');
window.MythicCitizens = null;
const broken = api.householdOf('5,5');
eq('a missing citizens layer is a FAULT, not an empty house', broken.ok, false);
const html = api.cardsHtml('5,5') + api.sideHtml('5,5');
eq('and the cards still render', html.length > 400, true);
eq('and say so out loud', /Could not read the citizen roster/.test(html), true);
window.MythicCitizens = { list: () => [] };
api.flush();
eq('an EMPTY roster is a fact, not a fault', api.householdOf('5,5').ok, true);
eq('and reads differently', /No named citizen lives here yet/.test(api.cardsHtml('5,5') + api.sideHtml('5,5')), true);

console.log('── a streets layer, when one turns up ──');
window.MythicStreets = { nameAt: (x, z) => (z === 4 ? 'Robin Street' : 'Ash Lane') };
eq('the module name wins', api.addressOf('5,3').text, '111 Robin Street');
eq('and is marked as its source', api.addressOf('5,3').source, 'streets');
window.MythicStreets = { nameAt: () => ({ nope: 1 }) };
eq('a junk answer falls back to the grid', api.addressOf('5,3').source, 'grid');
window.MythicStreets = { nameAt: () => { throw new Error('boom'); } };
eq('a THROWING streets layer falls back too', api.addressOf('5,3').source, 'grid');
delete window.MythicStreets;

console.log('── a zoning layer, when one turns up ──');
window.MythicZoning = { zoneAt: () => 'NA Low Density Housing' };
eq('the zoning layer wins', api.zoneOf('5,5').label, 'NA Low Density Housing');
delete window.MythicZoning;

console.log('\n' + (fails.length ? fails.length + ' FAILED\n' + fails.join('\n') : 'ALL CLEAN'));
process.exit(fails.length ? 1 : 0);
