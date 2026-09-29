/* 🥡 SUPPLY CRATES RIDE CONVOYS — and never turn into food.

   Asked for: "with the loading bay players can load in trucks any of the
   resources of the food they made in the Supplies, so other players can use
   the supplies in their restaurant." So a crate of mushrooms goes on a truck,
   arrives, and is a crate of mushrooms in the other kitchen's pantry.

   What this file defends, headless, through the real convoy.js:
     · a crate is a whole Supplies-sheet crate, counted as one box;
     · the manifest lists crates next to dishes and quotes food for DISHES only;
     · a crates-only load is a legal load (sql/110 lets the depot store it);
     · launching takes the crates out of the pantry; unloading puts them in;
     · a second claim of the same truck puts nothing in twice;
     · a truck that cannot leave puts everything back.

   The bridge here is a FAKE with a purse, not NULL_BRIDGE: freight is real
   Cinder, and the null seam's purse is 0, which would refuse every launch
   before the crate code ran. Practice runs (to your own city) never touch
   the network, so nothing here needs a depot.

   Run: node _convoy_smoke.mjs */
let purse = 100000;
let food = 500;      // the fake stash: claim() re-reads it after addRes to measure what landed
globalThis.window = { MythicKitchenBridge: {
  signedIn: () => false, userId: () => null, displayName: () => 'Tester',
  resources: () => [], meta: (id) => ({ id: String(id), name: String(id), icon: '📦', color: '#888' }),
  getRes: (id) => (id === 'food' ? food : 500), resourceCap: () => 100000, resourceUnits: () => 0,
  gems: () => purse, spendGems: (n) => { if (purse < n) return false; purse -= n; return true; }, addGems: (n) => { purse += n; return true; },
  spendRes: () => true, addRes: (id, n) => { if (id === 'food') food += n | 0; return true; }, refundRes: () => true,
  kitchenState: () => null, setKitchenState: () => true, save: () => true,
  toast: () => {}, confirm: async () => true, render: () => {},
  cloud: null, myCorp: () => null, cityProd: () => ({}), isAdmin: () => false,
} };

const State  = await import('./public/src/kitchen/kitchen.state.js');
const Convoy = await import('./public/src/kitchen/convoy.js');
const DATA   = await import('./public/src/kitchen/kitchen.data.js');

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 0);

/* Land a truck the way the game does: one tick past its arrival flips it to
   'arrived' (tick is (K, dt, now) — the FIRST draft called tick(K, t) and
   nothing ever arrived), then the dock beat has to pass before CLAIM arms. */
async function land(row, claimId) {
  const t1 = row.arrivesAt + 1000;
  Convoy.tick(K, 16, t1);
  const t2 = t1 + 10 * 60 * 1000;           // well past any CONVOY_HOLD_MS
  Convoy.tick(K, 16, t2);
  return { t: t2, res: await Convoy.claim(K, claimId, t2) };
}

const K = State.init();
K.level = 20; K.upgrades = K.upgrades || []; K.convoys = []; K.inbound = []; K.now = 1_000_000;
const NOW = K.now;

// a shippable dish to ride alongside the crates
const dish = (DATA.RECIPES || []).find((r) => r && DATA.shippable(r.id));
ok(!!dish, 'the menu has a shippable dish (' + (dish && dish.name) + ')');
const mush = DATA.ingredient('mushroom'), sup = mush && DATA.supply(mush.supply);
const PER = sup && sup.out && sup.out.qty;
ok(!!sup && PER > 0, 'mushrooms come in crates of ' + PER + ' from ' + (sup && sup.id));

console.log('\n=== 1. the manifest lists crates, quotes food for dishes only ===');
K.pantry = { mushroom: PER * 2 + 3 };            // two whole crates and a bit
K.pass = [];
for (let i = 0; i < 4; i++) K.pass.push({ recipeId: dish.id, madeAt: NOW - i });
{
  const man = Convoy.manifest(K, 'van', null);
  const crate = (man.lines || []).find((L) => L.recipeId === 'ing:mushroom');
  ok(!!crate && crate.kind === 'crate' && crate.have === 2, 'two whole crates are offered; the loose 3 mushrooms stay home', JSON.stringify(crate));
  ok(!!crate && /crate/i.test(crate.name) && crate.icon, 'a crate has a name and an icon for the sheet');
  ok(man.dishes === 6, 'the truck counts 6 boxes — 4 dishes + 2 crates', String(man.dishes));
  ok(man.crates === 2, 'and says 2 of them are crates', String(man.crates));
  const perDish = Number(DATA.ECON && DATA.ECON.CONVOY_FOOD_PER_DISH) || 1;
  ok(man.food === 4 * perDish, 'food on landing is quoted for the 4 DISHES only (' + man.food + ')');
  ok(man.ok, 'and the load is sendable: ' + (man.why || 'ok'));
}

console.log('\n=== 2. a crates-only load is a legal load ===');
K.pantry = { mushroom: PER * 5 };
K.pass = [];
{
  const c = Convoy.compose(K, 'van', { 'ing:mushroom': 5 }, false);
  ok(c.ok, 'five crates and no dishes compose: ' + (c.why || 'ok'));
  ok(c.ok && c.convoy.dishes === 0 && c.convoy.crates === 5 && c.convoy.boxes === 5, 'dishes 0 · crates 5 · boxes 5', c.ok ? JSON.stringify([c.convoy.dishes, c.convoy.crates, c.convoy.boxes]) : c.why);
  ok(c.ok && c.convoy.food === 0, 'and it promises no food');
  ok(c.ok && c.convoy.feeCinder > 0, 'crates pay freight (' + (c.ok ? c.convoy.feeCinder : '?') + ' Cinder)');
  const before = purse;
  const l = Convoy.launch(K, c.convoy, null, NOW);
  const res = (l && typeof l.then === 'function') ? await l : l;
  ok(res && res.ok, 'a practice run launches: ' + (res && res.why || 'ok'));
  ok(K.pantry.mushroom === undefined || K.pantry.mushroom === 0, 'launching took every crate out of the pantry (left: ' + (K.pantry.mushroom | 0) + ')');
  ok(purse === before - c.convoy.feeCinder, 'and charged the freight');
  const row = K.convoys[K.convoys.length - 1];
  ok(!!row && row.dishes === 0 && row.crates === 5 && row.items['ing:mushroom'] === 5, 'the row carries 0 dishes and 5 crates');

  console.log('\n=== 3. the crates land in the pantry, once ===');
  const { t, res: cl } = await land(row, row.id);
  ok(cl && cl.ok, 'the truck unloads: ' + (cl && cl.why || 'ok'), JSON.stringify(cl));
  ok(K.pantry.mushroom === PER * 5, 'five crates are back in the pantry (' + (K.pantry.mushroom | 0) + ' mushrooms)');
  ok(cl && cl.crates === 5 && cl.granted === 0, 'the claim reports 5 crates and 0 food');
  const again = await Convoy.claim(K, row.id, t + 1000);
  ok(!(again && again.ok) && K.pantry.mushroom === PER * 5, 'claiming it again puts nothing in twice');
}

console.log('\n=== 4. a mixed load keeps dishes and crates apart ===');
K.pantry = { mushroom: PER * 2 };
K.pass = [];
for (let i = 0; i < 4; i++) K.pass.push({ recipeId: dish.id, madeAt: NOW - i });
{
  // "fill it" is manifest()'s convention (null); compose() takes the explicit list the panel resolved
  const fill = Convoy.manifest(K, 'van', null);
  const c = Convoy.compose(K, 'van', fill.items, false);
  ok(c.ok && c.convoy.dishes === 4 && c.convoy.crates === 2, 'fill it: 4 dishes + 2 crates', c.ok ? JSON.stringify(c.convoy.items) : c.why);
  const res = await Convoy.launch(K, c.convoy, null, NOW);
  ok(res && res.ok, 'it launches');
  ok(K.pass.length === 0 && !(K.pantry.mushroom | 0), 'the pass and the pantry are both emptied');
  const row = K.convoys[K.convoys.length - 1];
  ok(row.dishes === 4, 'the row says 4 dishes — the number the depot pays food for');
  const { res: cl } = await land(row, row.id);
  ok(cl && cl.ok && cl.crates === 2, 'unloading lands 2 crates…', JSON.stringify(cl));
  ok(K.pantry.mushroom === PER * 2, '…back in the pantry');
  ok(cl && cl.granted === 4, '…and 4 food for the 4 dishes, not 6 for the 6 boxes (' + (cl && cl.granted) + ')');
}

console.log('\n=== 5. the pantry moving under a load puts everything back ===');
K.pantry = { mushroom: PER * 5 };
K.pass = [];
{
  const c = Convoy.compose(K, 'van', { 'ing:mushroom': 5 }, false);
  ok(c.ok, 'five crates compose: ' + (c.why || 'ok'));
  K.pantry.mushroom = PER * 1;                    // a cook fired between quote and click
  const before = purse;
  const res = await Convoy.launch(K, c.convoy, null, NOW);
  ok(res && !res.ok, 'the launch refuses before spending: ' + (res && res.why));
  ok(K.pantry.mushroom === PER * 1 && purse === before, 'nothing left the pantry and the fee came back');
}

console.log('\n=== 6. the wiring that has to hold ===');
{
  const src = (await import('fs')).readFileSync('./public/src/kitchen/convoy.js', 'utf8');
  ok(/dishes: load\.dishes,\s*\r?\n\s*crates: Math\.max\(0, _int\(load\.crates\)\),/.test(src), 'the row sends dishes = cooked boxes to the depot, crates separately');
  ok(/if \(res\.firstClaim === false \|\| \(ceilingDishes <= 0 && crateCount\(landedItems\) <= 0\)\)/.test(src), 'a crates-only inbound truck is a first delivery, not "already unloaded"');
  const sql = (await import('fs')).readFileSync('./sql/110_convoy_crates.sql', 'utf8');
  ok(/greatest\(coalesce\(p_dishes, 0\), 0\)/.test(sql), 'sql/110 lets the depot store a crates-only load without a phantom dish');
}

console.log('\n' + (fails ? `❌ ${fails} FAILED\n` : '✅ all clear — crates ride, land, and are never food\n'));
process.exit(fails ? 1 : 0);
