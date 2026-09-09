/* 🐄 Homestead Farm — node harness. Drives farm.state.js with a FAKE host and
   diffs the ledger, so the whole economy (build → buy → feed → grow → collect →
   slaughter → craft, plus every refund path) is checked without a browser.
   Run: node tools/farm_harness.mjs */
import * as S from '../public/src/farm/farm.state.js';
import { FARM_ECON, FARM_BUILDINGS, auditCatalog } from '../public/src/farm/farm.data.js';

let fails = 0;
const ok = (c, msg) => { if (c) console.log('  ✓', msg); else { fails++; console.log('  ✗', msg); } };

function fakeHost(opts) {
  opts = opts || {};
  const led = Object.assign({ food: 500, water: 500, wood: 2000, stone: 1000, cloth: 300, metal: 500, supplies: 200 }, opts.ledger || {});
  const st = { gems: opts.gems == null ? 2e6 : opts.gems, state: {}, cap: opts.cap || 1e9, saveFails: 0 };
  const units = () => Object.values(led).reduce((a, b) => a + b, 0);
  return {
    led, st,
    gems: () => st.gems,
    getRes: id => led[id] | 0,
    resMeta: id => ({ name: id, icon: '·' }),
    spendGems: n => { if (st.gems < n) return false; st.gems -= n; return true; },
    addGems: n => { st.gems += n; },
    spendRes: (id, n) => { if ((led[id] | 0) < n) return false; led[id] -= n; return true; },
    addRes: (id, n) => { const free = st.cap - units(); if (free <= 0) return; led[id] = (led[id] | 0) + Math.min(n, free); },
    refundRes: (id, n) => { led[id] = (led[id] | 0) + n; },
    state: () => st.state,
    setState: s => { st.state = s; return true; },
    save: () => { if (st.saveFails > 0) { st.saveFails--; return false; } return true; },
    collectCdMs: 6 * 3600000, accrualCapH: 36,
  };
}
const H = 3600000;

console.log('catalogue audit');
const ids = ['animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer', 'food', 'water', 'wood', 'stone', 'cloth', 'metal', 'supplies'];
ok(auditCatalog(ids).length === 0, 'every id the farm touches is in the promotion list: ' + auditCatalog(ids).join(','));
ok(FARM_BUILDINGS.every(b => b.cost.every(c => c.cinder > 0 && Object.keys(c).filter(k => k !== 'cinder').length >= 2)), 'every building level costs Cinder + ≥2 resources');

console.log('build + refund paths');
{
  const h = fakeHost(); const s = S.ensureState(h);
  const g0 = h.st.gems, w0 = h.led.wood;
  let r = S.build(h, s, 'coop');
  ok(r.ok && s.buildings.coop && s.buildings.coop.level === 1, 'coop builds');
  ok(h.st.gems === g0 - 30000 && h.led.wood === w0 - 40 && h.led.cloth === 290, 'coop charged cinder 30000, wood 40, cloth 10');
  r = S.build(h, s, 'coop'); ok(!r.ok && r.why === 'already built', 'cannot build twice');
  const h2 = fakeHost({ gems: 100 }); const s2 = S.ensureState(h2);
  r = S.build(h2, s2, 'coop'); ok(!r.ok && r.why === 'short' && r.shortfall.cinder === 29900, 'short on cinder refuses with shortfall');
  ok(h2.led.wood === 2000, 'no resource leg was taken on a short build');
  const h3 = fakeHost(); const s3 = S.ensureState(h3); h3.st.saveFails = 1;
  r = S.build(h3, s3, 'barn');
  ok(!r.ok && h3.st.gems === 2e6 && h3.led.wood === 2000 && h3.led.stone === 1000 && h3.led.metal === 500, 'save failure refunds every leg, cinder included');
  ok(!s3.buildings.barn, 'save failure leaves nothing built');
}

console.log('feed mill + trough');
{
  const h = fakeHost(); const s = S.ensureState(h);
  let r = S.fillTrough(h, s, 'coop', 100); ok(!r.ok, 'trough refused before the pen exists');
  S.build(h, s, 'coop');
  r = S.fillTrough(h, s, 'coop', 100); ok(!r.ok && /Feed Mill/.test(r.why), 'trough refused before the Feed Mill');
  S.build(h, s, 'feedmill');
  r = S.craft(h, s, 'feedmill', 'feed', 3);
  ok(r.ok && r.batches === 3 && h.led.animalFeed === 72 && h.led.food === 500 - 24 && h.led.water === 500 - 10 - 18, 'feed mill: 3 batches → 72 feed for 24 food + 18 water (after the mill\'s own 10 water)');
  r = S.fillTrough(h, s, 'coop', 1e9);
  ok(r.ok && r.added === 72 && s.buildings.coop.feed === 72 && h.led.animalFeed === 0, 'fill trough moves all 72 feed');
  S.craft(h, s, 'feedmill', 'feed', 999);
  r = S.fillTrough(h, s, 'coop', 1e9);
  ok(r.ok && s.buildings.coop.feed === FARM_ECON.troughCap, 'trough caps at ' + FARM_ECON.troughCap);
}

console.log('growth, accrual, cap, collect');
{
  const h = fakeHost(); const s = S.ensureState(h);
  S.build(h, s, 'feedmill'); S.build(h, s, 'coop');
  S.craft(h, s, 'feedmill', 'feed', 999); S.fillTrough(h, s, 'coop', 1e9);
  const t0 = Date.now();
  let r = S.buyAnimal(h, s, 'chicken', 6);
  ok(r.ok && s.animals.length === 6 && h.st.gems === 2e6 - 22000 - 30000 - 6 * 1800, 'bought 6 chickens for cinder only');
  r = S.buyAnimal(h, s, 'chicken', 1); ok(!r.ok && /full/.test(r.why), 'coop full at 6');
  r = S.buyAnimal(h, s, 'cow', 1); ok(!r.ok && /Cattle Barn/.test(r.why), 'no cow without a barn');
  const never = () => 1;   // no births
  S.simulate(h, s, t0 + 3 * H, never);
  ok(s.animals.every(a => Math.abs(a.ageH - 3) < 1e-9) && !s.animals.some(S.isAdult), '3h: chicks aged 3h, none adult');
  ok(Object.keys(S.pendingCollect(s, 'coop')).length === 0, 'no eggs from chicks');
  S.simulate(h, s, t0 + 9 * H, never);
  const p = S.pendingCollect(s, 'coop');
  // 6 hens adult for 3h each → 6*3*0.35 = 6.3 eggs, 6*3*0.08 = 1.44 feathers
  ok(p.eggs === 6 && p.feathers === 1, '9h: 6 eggs + 1 feather accrued (' + JSON.stringify(p) + ')');
  ok(Math.abs(s.buildings.coop.feed - (240 - 9 * 6 * 0.6)) < 1e-6, 'trough drained 0.6/h per bird');
  // Cooldown: lastCollect=0 so first collect is allowed.
  r = S.collect(h, s, 'coop');
  ok(r.ok && r.got.eggs === 6 && h.led.eggs === 6 && h.led.feathers === 1, 'collect banks eggs + feathers');
  r = S.collect(h, s, 'coop'); ok(!r.ok && r.why === 'nothing to collect' || r.why === 'cooldown', 'second collect refused');
  // Run the trough dry: 240 feed / 3.6 per h = 66.7h total. Advance 200h → fed only until feed hits 0.
  S.simulate(h, s, t0 + 200 * H, never);
  ok(s.buildings.coop.feed === 0, 'trough empty after 200h');
  const p2 = S.pendingCollect(s, 'coop');
  const rate = S.penRatePerH(s, 'coop');
  ok(p2.eggs <= Math.floor(rate.eggs * 36) && p2.eggs > 0, 'accrual capped at 36h of adult rate: ' + p2.eggs + ' ≤ ' + Math.floor(rate.eggs * 36));
  // Unfed pens do not advance.
  const age = s.animals[0].ageH;
  S.simulate(h, s, t0 + 400 * H, never);
  ok(s.animals[0].ageH === age, 'unfed pen: age frozen');
}

console.log('breeding');
{
  const h = fakeHost(); const s = S.ensureState(h);
  S.build(h, s, 'feedmill'); S.build(h, s, 'coop'); S.craft(h, s, 'feedmill', 'feed', 999); S.fillTrough(h, s, 'coop', 1e9);
  S.buyAnimal(h, s, 'chicken', 2);
  const t0 = Date.now();
  S.simulate(h, s, t0 + 6 * H, () => 1);
  S.simulate(h, s, t0 + 16 * H, () => 0);   // always breed
  ok(s.animals.length === 6, 'breeding fills the coop to capacity and no further (' + s.animals.length + ')');
  ok(s.animals.filter(a => a.ageH === 0 || a.ageH < 16).length >= 4, 'chicks are born young');
}

console.log('slaughter');
{
  const h = fakeHost(); const s = S.ensureState(h);
  S.build(h, s, 'feedmill'); S.build(h, s, 'barn'); S.craft(h, s, 'feedmill', 'feed', 999); S.fillTrough(h, s, 'barn', 1e9);
  S.buyAnimal(h, s, 'cow', 3);
  let r = S.slaughter(h, s, 'cow', 1); ok(!r.ok && /Butcher/.test(r.why), 'no slaughter without the block');
  S.build(h, s, 'butcher');
  r = S.slaughter(h, s, 'cow', 1); ok(!r.ok && /adult/.test(r.why), 'calves are refused');
  const t0 = Date.now(); S.simulate(h, s, t0 + 30 * H, () => 1);
  ok(s.animals.every(S.isAdult), 'cows grown after 30 fed hours');
  r = S.slaughter(h, s, 'cow', 2);
  ok(r.ok && r.taken === 2 && r.got.meat === 24 && r.got.hide === 6 && r.got.fertilizer === 2 && s.animals.length === 1, '2 cows → 24 meat, 6 hide, 2 fertilizer');
  S.upgrade(h, s, 'butcher'); S.upgrade(h, s, 'butcher');
  r = S.slaughter(h, s, 'cow', 5);
  ok(r.ok && r.taken === 1 && r.got.meat === 16 && r.got.hide === 4 && r.got.fertilizer === 1, 'L3 block: +30% → 16 meat, 4 hide, 1 fertilizer (rounded) from the last cow');
  ok(s.animals.length === 0, 'herd empty');
}

console.log('stations');
{
  const h = fakeHost({ ledger: { hide: 10, wool: 9, meat: 9, eggs: 13, rawMilk: 11 } }); const s = S.ensureState(h);
  S.build(h, s, 'tannery'); S.build(h, s, 'spinner'); S.build(h, s, 'kitchen');
  let r = S.craft(h, s, 'tannery', 'tannery', 999);
  ok(r.ok && r.batches === 3 && h.led.leather === 6 && h.led.hide === 1, 'tannery: 9 hide + 6 water → 6 leather, 1 hide left');
  r = S.craft(h, s, 'spinner', 'spinner', 1); ok(r.ok && h.led.cloth === 300 - 15 + 3 && h.led.wool === 5, 'spinner: 4 wool → 3 cloth (after the shed\'s own 15 cloth)');
  r = S.craft(h, s, 'kitchen', 'spinner', 1); ok(!r.ok, 'kitchen cannot run the spinner recipe');
  const f0 = h.led.food;
  r = S.craft(h, s, 'kitchen', 'kitchenEggs', 999); ok(r.ok && r.batches === 2 && h.led.food === f0 + 8 && h.led.eggs === 1, 'kitchen: 12 eggs → 8 food');
  r = S.craft(h, s, 'kitchen', 'kitchenMeat', 999); ok(r.ok && r.batches === 2 && h.led.food === f0 + 8 + 12, 'kitchen: 8 meat → 12 food');
  r = S.craft(h, s, 'kitchen', 'kitchenMilk', 1); ok(r.ok && h.led.food === f0 + 25, 'kitchen: 6 milk → 5 food');
  r = S.craft(h, s, 'tannery', 'tannery', 1); ok(!r.ok && r.why === 'short', 'tannery short on hide');
}

console.log('stash cap keeps un-banked yield in the pen');
{
  const h = fakeHost({ cap: 4506 }); const s = S.ensureState(h);   // ledger starts at 4,500 units → 6 free
  S.build(h, s, 'feedmill'); S.build(h, s, 'coop');
  // building costs freed some units; recompute free space then fill it back up
  const units = () => Object.values(h.led).reduce((a, b) => a + b, 0);
  h.led.stone += (4506 - 6) - units();
  S.craft(h, s, 'feedmill', 'feed', 1);   // -14 units +24 → over by 4, addRes clamps to what fits
  const feed = h.led.animalFeed; ok(feed === 20, 'feed mill delivered only what fit: ' + feed);
  h.led.animalFeed = 240;   // hand the test enough feed to grow a flock
  S.fillTrough(h, s, 'coop', 1e9); S.buyAnimal(h, s, 'chicken', 6);
  const t0 = Date.now(); S.simulate(h, s, t0 + 40 * H, () => 1);
  const pend = S.pendingCollect(s, 'coop');
  h.led.stone += 4506 - units() - 2;      // exactly 2 free units
  const r = S.collect(h, s, 'coop');
  ok(r.ok && r.clipped && (r.got.eggs | 0) + (r.got.feathers | 0) === 2, 'collect delivered only the 2 that fit and flagged clipped');
  const after = S.pendingCollect(s, 'coop');
  ok((after.eggs | 0) + (after.feathers | 0) === (pend.eggs | 0) + (pend.feathers | 0) - 2, 'the remainder stays in the pen instead of being destroyed');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL CLEAR');
process.exit(fails ? 1 : 0);
