/* 🐄 Homestead Farm — node harness. Drives farm.state.js with a FAKE host and
   diffs the ledger, so the whole economy (build → buy → feed → grow → collect →
   slaughter → craft, health, guards, raids, events, seasons, town demand,
   crates, the editor, and every refund path) is checked without a browser.
   Run: node tools/farm_harness.mjs */
import * as S from '../public/src/farm/farm.state.js';
import { FARM_ECON, FARM_BUILDINGS, auditCatalog } from '../public/src/farm/farm.data.js';
import { seasonFor, weatherAt, rngFor } from '../public/src/farm/farm.events.js';

let fails = 0;
const ok = (c, msg) => { if (c) console.log('  ✓', msg); else { fails++; console.log('  ✗', msg); } };
const H = 3600000;
const SE = seasonFor(Date.now());                    // tests run in whatever month it is
const savedChance = FARM_ECON.eventChance;
FARM_ECON.eventChance = 0;                           // events are tested on their own below
// The general suite wants instant buildings and instant deliveries; the
// construction + transport sections below restore real timings for themselves.
const savedBuildH = new Map(FARM_BUILDINGS.map(b => [b.id, b.buildH]));
const instant = (on) => { FARM_BUILDINGS.forEach(b => { b.buildH = on ? [0, 0, 0] : savedBuildH.get(b.id); }); Object.values(FARM_ECON.transport.carriers).forEach(c => { c._hours = c._hours == null ? c.hours : c._hours; c._risk = c._risk == null ? c.risk : c._risk; c.hours = on ? 0 : c._hours; c.risk = on ? 0 : c._risk; }); };
instant(true);

function fakeHost(opts) {
  opts = opts || {};
  const led = Object.assign({ food: 500, water: 500, wood: 2000, stone: 1000, cloth: 300, metal: 500, supplies: 200, medicine: 10 }, opts.ledger || {});
  const st = { gems: opts.gems == null ? 2e6 : opts.gems, state: { seed: opts.seed || 'harness' }, cap: opts.cap || 1e9, saveFails: 0, farmers: opts.farmers | 0, builders: opts.builders | 0, rig: opts.rig || null, tier: opts.tier || 'COMMON' };
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
    farmers: () => st.farmers, builders: () => st.builders | 0, bestRig: () => st.rig || null, rivals: () => ['Camp Ember', 'Sludge Hollow'], terroirTier: () => st.tier,
    collectCdMs: 6 * 3600000, accrualCapH: 36,
  };
}
// A pen stocked, fed, and past events. Returns {h, s}.
function farm(opts) {
  const h = fakeHost(opts); const s = S.ensureState(h);
  S.build(h, s, 'feedmill'); S.build(h, s, 'coop');
  S.craft(h, s, 'feedmill', 'feed', 999); S.fillTrough(h, s, 'coop', 1e9);
  return { h, s };
}

console.log('catalogue audit');
const ids = ['animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer', 'livestock', 'food', 'water', 'wood', 'stone', 'cloth', 'metal', 'supplies', 'medicine', 'memoryShards', 'dna'];
ok(auditCatalog(ids).length === 0, 'every id the farm touches is in the promotion list: ' + auditCatalog(ids).join(','));
ok(FARM_BUILDINGS.every(b => b.cost.every(c => c.cinder > 0 && Object.keys(c).filter(k => k !== 'cinder').length >= 2)), 'every building level costs Cinder + ≥2 resources');
ok(Object.values(FARM_ECON.townDemand.offers).every(o => !('cinder' in o.get)), 'town demand never pays Cinder (no faucet)');

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

console.log('v1 → v2 migration');
{
  const h = fakeHost(); h.st.state = { v: 1, buildings: { coop: { level: 2, feed: 10, simAt: Date.now(), lastCollect: 0, accrual: {} } }, animals: [{ id: 1, sp: 'chicken', ageH: 9, born: 1 }], seq: 2 };
  const s = S.ensureState(h);
  const a = s.animals[0];
  ok(s.v === 2 && a.grownH === 9 && a.health === 100 && typeof a.name === 'string' && a.name.length > 0, 'v1 animal gains grownH, health 100 and a name (' + a.name + ')');
  ok(s.look.ground === 'meadow' && s.look.decor.trees === true, 'look defaults applied');
}

console.log('feed, growth, weight, age');
{
  const { h, s } = farm();
  const t0 = Date.now();
  let r = S.buyAnimal(h, s, 'chicken', 6);
  ok(r.ok && s.animals.length === 6 && r.shipped === 6, 'bought 6 chickens (instant delivery in this suite)');
  ok(s.animals.every(a => S.weightOf(a) > 0 && S.weightOf(a) < FARM_ECON.animals.chicken.adultWeight), 'chicks start light');
  S.simulate(h, s, t0 + 9 * H, () => 1);
  const a = s.animals[0];
  ok(Math.abs(a.ageH - 9) < 1e-3 && Math.abs(a.grownH - 9) < 1e-3 && S.isAdult(a), '9h fed: age 9h, grown 9h, adult');
  ok(Math.abs(S.weightOf(a) - FARM_ECON.animals.chicken.adultWeight) < 0.5, 'adult weight ≈ ' + FARM_ECON.animals.chicken.adultWeight + 'kg (' + S.weightOf(a) + ')');
  const drained = 240 - s.buildings.coop.feed;
  ok(Math.abs(drained - 9 * 6 * 0.6 * SE.feedMul) < 1e-3, 'trough drained 0.6/h per bird × season feedMul ' + SE.feedMul);
  const p = S.pendingCollect(s, 'coop');
  const wx = weatherAt(s.seed, t0 + 9 * H);
  const expEggs = Math.floor(6 * 3 * 0.35 * (typeof wx.eggMul === 'number' ? wx.eggMul : 1));
  ok(p.eggs === expEggs || (expEggs === 0 && !p.eggs), '3 adult hours → ' + expEggs + ' eggs (weather ' + wx.key + ')');
}

console.log('health: neglect, sickness, treatment, death');
{
  const { h, s } = farm();
  S.buyAnimal(h, s, 'chicken', 2);
  const t0 = Date.now();
  S.simulate(h, s, t0 + 10 * H, () => 1);
  s.buildings.coop.feed = 0;                                 // starve them
  S.simulate(h, s, t0 + 30 * H, () => 1);                    // 20 unfed hours: 24h grace, no loss yet
  ok(s.animals.every(a => a.health === 100), 'inside the 24h grace: health untouched');
  S.simulate(h, s, t0 + 40 * H, () => 1);                    // 30 unfed: 6 past grace → −12
  ok(s.animals.every(a => Math.abs(a.health - 88) < 1e-3), 'past grace: −2/h (' + s.animals[0].health + ')');
  S.simulate(h, s, t0 + 80 * H, () => 1);                    // 70 unfed: 46 past grace → 100 − 92 = 8 → sick
  ok(s.animals.every(a => a.health < FARM_ECON.health.sickBelow && a.health > 0), 'sick, not dead (' + s.animals[0].health + ')');
  ok(Object.values(S.penRatePerH(s, 'coop', h)).every(v => v === 0), 'sick birds yield nothing');
  const r = S.treat(h, s, s.animals[0].id);
  ok(r.ok && s.animals[0].health === 48 && h.led.medicine === 9, 'treat: +40 health for 1 medicine');
  S.simulate(h, s, t0 + 120 * H, () => 1);
  ok(s.animals.length === 1 && s.animals[0].id !== undefined && s.journal.some(j => j.kind === 'death'), 'the untreated bird died of neglect and was journalled; the treated one lives');
  ok(s.stats.died === 1, 'stats.died = 1');
}

console.log('accrual cap + collect + stash clip');
{
  const { h, s } = farm({ cap: 4506 });
  const units = () => Object.values(h.led).reduce((a, b) => a + b, 0);
  h.led.animalFeed = 240; S.fillTrough(h, s, 'coop', 1e9); S.buyAnimal(h, s, 'chicken', 6);
  const t0 = Date.now(); S.simulate(h, s, t0 + 60 * H, () => 1);
  // Same `now` as the simulate above: the rate reads the weather of the
  // moment, and a storm (eggs ×0) at Date.now() would zero it while the
  // accrual was earned under the window that was simulated.
  const p = S.pendingCollect(s, 'coop'); const rate = S.penRatePerH(s, 'coop', h, t0 + 60 * H);
  ok(p.eggs <= Math.floor(rate.eggs * 36) + 1, 'accrual capped near 36h of adult rate: ' + p.eggs);
  h.led.stone += 4506 - units() - 2;
  const r = S.collect(h, s, 'coop');
  ok(r.ok && r.clipped && (r.got.eggs | 0) + (r.got.feathers | 0) === 2, 'collect delivered only the 2 that fit and flagged clipped');
  const after = S.pendingCollect(s, 'coop');
  ok((after.eggs | 0) + (after.feathers | 0) === (p.eggs | 0) + (p.feathers | 0) - 2, 'the remainder stays in the pen');
}

console.log('breeding, seasons, rare breeds');
{
  const { h, s } = farm();
  S.buyAnimal(h, s, 'chicken', 2);
  const t0 = Date.now();
  S.simulate(h, s, t0 + 6 * H, () => 1);
  S.simulate(h, s, t0 + 16 * H, () => 0);                    // always breed, always rare
  ok(s.animals.length === 6, 'breeding fills the coop to capacity and no further (' + s.animals.length + ')');
  ok(s.animals.filter(a => a.breed === 'chicken').length === 4 && s.journal.some(j => /Golden Hen/.test(j.text)), 'rnd=0 births are Golden Hens, journalled');
  ok(S.yieldMul(s.animals[5]) === 2, 'rare breed doubles yield');
  ok(s.stats.births === 4, 'stats.births = 4');
}

console.log('guards, defense, raids and predators');
{
  const h = fakeHost({ seed: 'raidtest' }); const s = S.ensureState(h);
  S.build(h, s, 'feedmill'); S.build(h, s, 'coop'); S.build(h, s, 'guardpost');
  h.led.animalFeed = 480; S.fillTrough(h, s, 'coop', 240); S.fillTrough(h, s, 'guardpost', 240);
  S.buyAnimal(h, s, 'chicken', 6);
  let r = S.slaughter(h, s, { sp: 'terrier', n: 1 }); ok(!r.ok, 'no butcher: refused');
  r = S.buyAnimal(h, s, 'donkey', 1); ok(r.ok && s.animals.some(a => a.sp === 'donkey'), 'bought a donkey (25,000)');
  ok(S.guardDefense(s) === 0, 'a foal defends nothing');
  // Pinned clock: event windows are seeded by ABSOLUTE window index, so a
  // Date.now() here would make which events fire drift with the wall clock.
  // The pin is in the FUTURE on purpose: mutators call simulate(Date.now())
  // internally, and the sim's never-rewind guard turns those into no-ops
  // instead of fast-forwarding the farm a year (a past pin did exactly that).
  const t0 = 2000000000000; Object.values(s.buildings).forEach(b => { b.simAt = t0; }); S.simulate(h, s, t0 + 13 * H, () => 1);
  ok(S.guardDefense(s) === 10 && S.penDefense(s, 'coop') === 10, 'grown donkey: defense 10');
  S.upgrade(h, s, 'coop'); ok(S.penDefense(s, 'coop') === 11.5, 'L2 fence adds 1.5');
  // Force events: chance 1, and walk windows one at a time with a known seed.
  FARM_ECON.eventChance = 1;
  const before = s.animals.length;
  s.eventAt = t0 + 13 * H;
  for (let i = 1; i <= 40; i++) S.simulate(h, s, t0 + 13 * H + i * 6 * H, () => 1);
  const J = s.journal;
  ok(J.length > 0, 'events fired over 40 windows: ' + J.length + ' journal lines');
  ok(J.some(j => j.kind === 'raid') && J.some(j => ['fox', 'hawk', 'wolves', 'ufo', 'storm', 'gift'].indexOf(j.kind) >= 0), 'raids and random events both occurred');
  const repelled = s.stats.raidsRepelled + s.stats.predatorsRepelled;
  ok(repelled > 0, 'the donkey and fence repelled some: ' + repelled + ' (raids lost: ' + s.stats.raidsLost + ')');
  ok(h.led.supplies > 200 || s.stats.raidsRepelled === 0, 'repelled raiders dropped supplies (' + h.led.supplies + ')');
  ok(s.animals.length <= before + 10, 'herd stayed bounded (' + s.animals.length + ')');
  // Determinism: same seed + same windows → same journal.
  const h2 = fakeHost({ seed: 'raidtest' }); const s2 = S.ensureState(h2);
  s2.buildings = JSON.parse(JSON.stringify({ feedmill: s.buildings.feedmill, coop: Object.assign({}, s.buildings.coop, { feed: 240, simAt: t0 + 13 * H }), guardpost: Object.assign({}, s.buildings.guardpost, { feed: 240, simAt: t0 + 13 * H }) }));
  s2.animals = [{ id: 1, sp: 'chicken', name: 'A', ageH: 20, grownH: 20, hungry: 0, health: 100, breed: null, born: 0 }, { id: 2, sp: 'donkey', name: 'D', ageH: 20, grownH: 20, hungry: 0, health: 100, breed: null, born: 0 }];
  s2.eventAt = t0 + 13 * H; s2.seq = 3;
  const s3h = fakeHost({ seed: 'raidtest' }); const s3 = S.ensureState(s3h);
  s3.buildings = JSON.parse(JSON.stringify(s2.buildings)); s3.animals = JSON.parse(JSON.stringify(s2.animals)); s3.eventAt = s2.eventAt; s3.seq = 3;
  S.simulate(h2, s2, t0 + 13 * H + 20 * 6 * H, () => 1); S.simulate(s3h, s3, t0 + 13 * H + 20 * 6 * H, () => 1);
  ok(JSON.stringify(s2.journal.map(j => j.kind)) === JSON.stringify(s3.journal.map(j => j.kind)), 'two devices replaying the same windows get the same story');
  FARM_ECON.eventChance = 0;
  // Storm repair
  const dmg = Object.keys(s.buildings).find(k => s.buildings[k].damaged);
  if (dmg) { const rr = S.repair(h, s, dmg); ok(rr.ok && !s.buildings[dmg].damaged, 'storm damage repaired for wood+stone'); }
  else ok(true, '(no storm this run — repair path not exercised)');
}

console.log('slaughter: weight, cuts, prize, trophy');
{
  const h = fakeHost({ seed: 'cut' }); const s = S.ensureState(h);
  S.build(h, s, 'feedmill'); S.build(h, s, 'barn'); S.build(h, s, 'butcher'); h.led.animalFeed = 240; S.fillTrough(h, s, 'barn', 1e9);
  S.buyAnimal(h, s, 'cow', 3);
  let r = S.slaughter(h, s, { sp: 'cow', n: 1 }); ok(!r.ok && /not grown/.test(r.why) || /no adult/.test(r.why), 'calves are refused');
  const t0 = Date.now(); S.simulate(h, s, t0 + 30 * H, () => 1);
  const c = s.animals[0]; const wf = S.weightOf(c) / FARM_ECON.animals.cow.adultWeight;
  r = S.slaughter(h, s, { ids: [c.id] }, 'balanced');
  const expMeat = Math.max(1, Math.round(12 * wf * SE.meatMul));
  ok(r.ok && r.got.meat === expMeat && r.got.hide === Math.max(1, Math.round(3 * wf)), `balanced: ${r.got.meat} meat (weight factor ${wf.toFixed(2)}, season ×${SE.meatMul}), ${r.got.hide} hide`);
  r = S.slaughter(h, s, { sp: 'cow', n: 1 }, 'meat');
  ok(r.ok && r.got.meat === Math.max(1, Math.round(12 * wf * 1.5 * SE.meatMul)) && r.got.hide === Math.max(1, Math.round(3 * wf * 0.5)), 'meat cut: +50% meat, −50% hide');
  r = S.slaughter(h, s, { sp: 'cow', n: 1 }, 'trophy'); ok(!r.ok && /level 2/.test(r.why), 'trophy needs butcher L2');
  S.upgrade(h, s, 'butcher');
  r = S.slaughter(h, s, { sp: 'cow', n: 1 }, 'trophy');
  ok(r.ok && s.animals.length === 0 && r.got.meat === Math.max(1, Math.round(12 * wf * 1.15 * 0.75 * SE.meatMul)), 'trophy cut at L2: ×1.15 × 0.75 meat; rare roll ' + (r.got.memoryShards ? 'HIT' : 'miss'));
  ok(s.stats.slaughtered === 3 && s.journal.filter(j => j.kind === 'butcher').length === 3, 'three butcher journal lines');
  // Prize: a 3×growH-old cow
  S.buyAnimal(h, s, 'cow', 1); s.animals[0].ageH = 24 * 3 + 1; s.animals[0].grownH = 30;
  ok(S.prizeIds(s).has(s.animals[0].id), 'oldest grown cow past 72h is the prize beast');
}

console.log('stations + town demand + crates');
{
  const h = fakeHost({ ledger: { hide: 10, wool: 9, meat: 9, eggs: 13, rawMilk: 11 }, seed: 'town' }); const s = S.ensureState(h);
  S.build(h, s, 'tannery'); S.build(h, s, 'spinner'); S.build(h, s, 'kitchen');
  let r = S.craft(h, s, 'tannery', 'tannery', 999);
  ok(r.ok && r.batches === 3 && h.led.leather === 6 && h.led.hide === 1, 'tannery: 9 hide + 6 water → 6 leather');
  r = S.craft(h, s, 'spinner', 'spinner', 1); ok(r.ok && h.led.cloth === 300 - 15 + 3, 'spinner: 4 wool → 3 cloth');
  const o = S.townOffer(s);
  ok(o && o.give && o.get && o.left === 3, 'town posts an offer: ' + JSON.stringify(o.give) + ' → ' + JSON.stringify(o.get));
  Object.keys(o.give).forEach(k => { h.led[k] = 100; });
  r = S.deliverDemand(h, s); ok(r.ok && r.left === 2 && Object.keys(r.got).length, 'delivered once');
  S.deliverDemand(h, s); S.deliverDemand(h, s);
  r = S.deliverDemand(h, s); ok(!r.ok && /today/.test(r.why), 'capped at 3 per day');
  // Crates
  S.build(h, s, 'feedmill'); S.build(h, s, 'pasture'); h.led.animalFeed = 240; S.fillTrough(h, s, 'pasture', 1e9);
  S.buyAnimal(h, s, 'sheep', 1); const sh = s.animals.find(a => a.sp === 'sheep');
  r = S.crate(h, s, sh.id); ok(!r.ok, 'cannot crate a lamb');
  sh.grownH = 20;
  r = S.crate(h, s, sh.id); ok(r.ok && h.led.livestock === 1 && !s.animals.some(a => a.sp === 'sheep'), 'crated a grown sheep → 1 livestock');
  const g0 = h.st.gems;
  r = S.uncrate(h, s, 'goat'); ok(r.ok && h.led.livestock === 0 && h.st.gems === g0 - 2100 && s.animals.some(a => a.sp === 'goat'), 'uncrated as a goat for 1 livestock + 50% price (no haulage: it is already at the gate)');
}

console.log('farmers + terroir');
{
  const h = fakeHost({ farmers: 5, tier: 'RICH' }); const s = S.ensureState(h);
  S.build(h, s, 'feedmill'); S.build(h, s, 'pasture'); S.buyAnimal(h, s, 'sheep', 2);
  ok(S.farmersBonus(h) === 0.15, '5 farmers → +15% yield');
  h.led.animalFeed = 100;
  let r = S.tend(h, s); ok(r.ok && r.moved === 100 && s.buildings.pasture.feed === 100 && h.led.animalFeed === 0, 'farmers topped the empty trough with all 100 feed');
  r = S.tend(h, s); ok(r.ok && r.moved === 0, 'no-op when the trough is above the threshold');
  const gfRich = S.grazeFactor(h, Date.now()); h.st.tier = 'BARREN'; const gfBarren = S.grazeFactor(h, Date.now());
  ok(gfRich < gfBarren, 'rich ground grazes cheaper than barren (' + gfRich.toFixed(2) + ' vs ' + gfBarren.toFixed(2) + ')');
  ok(S.penCapacity(s, 'pasture', h) === 4, 'barren pasture loses a stall (4)');
}

console.log('rename + editor');
{
  const { h, s } = farm(); S.buyAnimal(h, s, 'chicken', 1);
  let r = S.rename(h, s, s.animals[0].id, '  Sir <Clucks>  '); ok(r.ok && s.animals[0].name === 'Sir Clucks', 'rename strips angle brackets and trims');
  r = S.setLook(h, s, { ground: 'snow', sky: 'night', decor: { pond: false }, roofs: { coop: '#FF0000', bogus: '#000000' } });
  ok(r.ok && s.look.ground === 'snow' && s.look.sky === 'night' && s.look.decor.pond === false && s.look.decor.trees === true && s.look.roofs.coop === '#ff0000' && !s.look.roofs.bogus, 'look patch validated and merged');
  r = S.setLook(h, s, { ground: 'lava' }); ok(r.ok && s.look.ground === 'meadow' || s.look.ground === 'snow', 'unknown ground falls back safely');
}

console.log('construction: time, gates, builders, rush, upgrade');
{
  instant(false);
  const h = fakeHost(); const s = S.ensureState(h);
  const t0 = Date.now();
  let r = S.build(h, s, 'coop');
  ok(r.ok && s.buildings.coop.constructing && r.readyAt >= t0 + 0.75 * H - 50 && r.readyAt <= t0 + 0.75 * H + 50, 'coop takes 45 min to raise');
  ok(!S.isReady(s, 'coop'), 'not ready yet');
  r = S.build(h, s, 'feedmill'); ok(r.ok, 'feed mill also started');
  r = S.buyAnimal(h, s, 'chicken', 1); ok(!r.ok && /construction/.test(r.why), 'cannot buy stock for a pen under construction');
  r = S.craft(h, s, 'feedmill', 'feed', 1); ok(!r.ok && /construction/.test(r.why), 'cannot grind at an unfinished mill');
  const p = S.buildProgress(s, 'coop'); ok(p && p.pct === 0 && p.left > 0, 'progress reads 0% with time left');
  const rc = S.rushCost(s, 'coop'); ok(rc === Math.max(500, Math.ceil(p.left / 60000) * 40), 'rush priced per remaining minute: ' + rc);
  const g0 = h.st.gems; r = S.rush(h, s, 'coop');
  ok(r.ok && h.st.gems === g0 - rc && S.isReady(s, 'coop') && !s.buildings.coop.constructing, 'rush finishes it for Cinder');
  // Time finishes the mill on its own.
  S.simulate(h, s, t0 + 1 * H, () => 1);
  ok(S.isReady(s, 'feedmill') && s.journal.some(j => /Feed Mill is finished/.test(j.text)), 'the mill finished by itself after 30 min and was journalled');
  // Upgrade keeps working at the old level until done.
  r = S.upgrade(h, s, 'coop'); ok(r.ok && s.buildings.coop.level === 1 && s.buildings.coop.pendingLevel === 2, 'upgrade queued: still level 1 while crews work');
  r = S.upgrade(h, s, 'coop'); ok(!r.ok && /already/.test(r.why), 'cannot queue a second upgrade');
  ok(S.isReady(s, 'coop'), 'an upgrading pen stays usable');
  S.simulate(h, s, t0 + 4 * H, () => 1);
  ok(s.buildings.coop.level === 2 && !s.buildings.coop.pendingLevel, 'upgrade landed after 2.5h');
  // Builders shave time.
  const hb = fakeHost({ builders: 4 }); const sb = S.ensureState(hb);
  const rb = S.build(hb, sb, 'barn');
  ok(rb.ok && Math.abs((rb.readyAt - Date.now()) - 4 * H * 0.8) < 2000, '4 Builders: barn 4h → 3h12m');
  const hc = fakeHost({ builders: 20 }); const sc = S.ensureState(hc);
  ok(S.buildTimeMs(hc, FARM_BUILDINGS.find(b => b.id === 'barn'), 1) === Math.round(4 * H * 0.6), 'builder bonus caps at 40%');
  instant(true);
}

console.log('transport: carriers, fees, ETA, room, losses, insurance, own rig');
{
  instant(false);
  const h = fakeHost({ seed: 'haul' }); const s = S.ensureState(h);
  FARM_BUILDINGS.forEach(b => { b.buildH = [0, 0, 0]; });   // instant buildings, real hauling
  S.build(h, s, 'feedmill'); S.build(h, s, 'coop'); S.build(h, s, 'barn');
  const cs = S.carriersFor(h);
  ok(cs.length === 3 && cs.map(c => c.id).join() === 'hollow,voss,ironclad', 'three haulage companies, no rig');
  ok(S.shipFee(S.carrierById(h, 'hollow'), 'chicken', 6) === Math.round(400 + 2 * 2.5 * 0.3 * 6) && S.shipFee(S.carrierById(h, 'ironclad'), 'cow', 1) === Math.round(3000 + 8 * 520 * 0.3), 'fee = base + perKg × shipping weight');
  const g0 = h.st.gems; const t0 = Date.now();
  let r = S.buyAnimal(h, s, 'cow', 2, 'voss');
  ok(r.ok && r.shipped === 2 && s.animals.length === 0 && s.shipments.length === 1 && Math.abs(r.arriveAt - (t0 + 1.5 * H)) < 100, 'cows are on the road with Voss, ETA 90 min, none in the pen yet');
  ok(h.st.gems === g0 - 2 * 14000 - S.shipFee(S.carrierById(h, 'voss'), 'cow', 2), 'paid price + fee');
  ok(S.inTransit(s, 'barn') === 2, '2 in transit count against the barn');
  r = S.buyAnimal(h, s, 'cow', 2, 'voss'); ok(!r.ok && /room|full/.test(r.why), 'a full barn (counting the road) refuses');
  S.simulate(h, s, t0 + 1 * H, () => 1); ok(s.animals.length === 0, 'still on the road at 60 min');
  S.simulate(h, s, t0 + 2 * H, () => 1);
  ok(s.animals.filter(a => a.sp === 'cow').length === 2 && s.shipments.length === 0 && s.journal.some(j => /delivered 2 cows/.test(j.text)), 'delivered at 90 min and journalled');
  // Losses: find a shipment id whose seeded roll is a hit for Hollow Road (risk .25).
  let hit = null; for (let i = 100; i < 400; i++) { if (rngFor('ship:' + s.seed + ':' + i)() < 0.25) { hit = i; break; } }
  s.seq = hit; const g1 = h.st.gems;
  r = S.buyAnimal(h, s, 'chicken', 3, 'hollow'); ok(r.ok, 'ordered 3 chickens with Hollow Road (uninsured)');
  S.simulate(h, s, t0 + 6 * H, () => 1);
  ok(s.animals.filter(a => a.sp === 'chicken').length === 2 && s.stats.lostInTransit === 1 && s.journal.some(j => /hit on the road/.test(j.text) && /No insurance/.test(j.text)), 'the seeded hit lost 1 of 3, no refund');
  ok(h.st.gems === g1 - 3 * 1800 - S.shipFee(S.carrierById(h, 'hollow'), 'chicken', 3), 'no Cinder came back');
  // Same roll with Voss (insured 50%) refunds half of the lost animal's price.
  let hit2 = null; for (let i = s.seq; i < s.seq + 600; i++) { if (rngFor('ship:' + s.seed + ':' + i)() < 0.08) { hit2 = i; break; } }
  s.seq = hit2; const g2 = h.st.gems;
  r = S.buyAnimal(h, s, 'chicken', 3, 'voss');
  S.simulate(h, s, t0 + 9 * H, () => 1);
  ok(h.st.gems === g2 - 3 * 1800 - S.shipFee(S.carrierById(h, 'voss'), 'chicken', 3) + 900 && s.journal.some(j => /Insurance paid back 900/.test(j.text)), 'Voss insurance paid back 900 Cinder for the lost hen');
  // Ironclad never loses a load.
  r = S.buyAnimal(h, s, 'chicken', 1, 'ironclad'); S.simulate(h, s, t0 + 12 * H, () => 1);
  ok(s.animals.filter(a => a.sp === 'chicken').length === 5, 'Ironclad delivered');
  // Own rig: free and fast.
  const hr = fakeHost({ rig: { id: 'warden', name: 'Warden Longhaul', emoji: '🚛' } }); const sr = S.ensureState(hr);
  S.build(hr, sr, 'feedmill'); S.build(hr, sr, 'coop');
  const own = S.carriersFor(hr)[0];
  ok(own.own && own.id === 'own:warden' && own.hours === 0.6 && S.shipFee(own, 'chicken', 6) === 0, 'own Warden rig: first option, 36 min, no fee');
  const g3 = hr.st.gems; r = S.buyAnimal(hr, sr, 'chicken', 2, 'own:warden');
  ok(r.ok && hr.st.gems === g3 - 3600, 'hauled by own rig for the animals\' price only');
  instant(true);
}

FARM_ECON.eventChance = savedChance;
console.log(fails ? `\n${fails} FAILED` : '\nALL CLEAR');
process.exit(fails ? 1 : 0);
