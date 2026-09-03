#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   ♻️ FOUNDRY REGRESSION HARNESS —  node _foundrysim.mjs
   ----------------------------------------------------------------------------
   Every check here exists because a REAL BUG got past reading the code. The
   Foundry is a simulation: its failures are emergent (a buffer jams, a loop
   fails to close, a yield compounds to zero) and are invisible in review. Run
   this after ANY change to recipes, machines, state, taps or models.

   Exits non-zero on failure, so it can gate a commit.

   ⚠ It runs the modules directly with a MOCK host — it does not touch
   index.html. For the real page, see FOUNDRY_HANDOFF.md § "Verifying the wiring".
   ════════════════════════════════════════════════════════════════════════════ */
import S from './public/src/foundry/state.js';
import T from './public/src/foundry/taps.js';
import M from './public/src/foundry/machines.js';
import R from './public/src/foundry/recipes.js';
import MO from './public/src/foundry/models.js';
import G from './public/src/foundry/guide.js';
import { readFileSync } from 'node:fs';

let fails = 0, checks = 0;
const ok = (name, pass, detail) => {
  checks++; if (!pass) fails++;
  console.log((pass ? '  \x1b[32mPASS\x1b[0m ' : '  \x1b[31mFAIL\x1b[0m ') + name + (detail ? '   ' + detail : ''));
};
const head = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');

/* A host with a bottomless wallet. Mirrors window.MythicFoundryBridge's contract
   plus the cost grammar index.js layers on via src/city/cost.js. */
function makeRig() {
  const L = { cinder: 9e8, metal: 9e6, fuel: 9e6, supplies: 9e6, stone: 9e6, wood: 9e6, water: 9e6, memoryShards: 9e6 };
  let o = {};
  const h = {
    foundryState: () => o, save: () => true, accrualCapH: () => 36, econ: () => undefined,
    gems: () => L.cinder, getRes: (i) => L[i] | 0, resName: (i) => i,
    spendGems: (n) => { if (L.cinder < n) return false; L.cinder -= n; return true; },
    addGems: (n) => { L.cinder += n; }, addRes: (i, n) => { L[i] = (L[i] | 0) + n; return n; },
    refundRes: (i, n) => { L[i] = (L[i] | 0) + n; },
    spendCost: (c) => { for (const k in c) { if ((k === 'cinder' ? L.cinder : L[k]) < c[k]) return { ok: false, why: k }; }
      for (const k in c) { if (k === 'cinder') L.cinder -= c[k]; else L[k] -= c[k]; } return { ok: true }; },
    refundCost: (c) => { for (const k in c) { if (k === 'cinder') L.cinder += c[k]; else L[k] += c[k]; } },
  };
  const reset = () => { o = {}; const st = S.ensureState(h); o = st; return st; };
  return { h, L, reset };
}
const T0 = 2_000_000_000_000;
/* Builds are timed now — a rig that wants a running line must land them. */
const land = (st, t) => { for (const k in st.machines) { const b = st.machines[k].build; if (b) b.done = t; } S.settleBuilds(st, t); };

// ── 1. Recipe graph ────────────────────────────────────────────────────────
head('1. Recipe graph closure');
{
  const produced = new Set(), consumed = new Set();
  R.RECIPES.forEach(r => { Object.keys(R.normIn(r)).forEach(k => consumed.add(k)); Object.keys(R.normOut(r)).forEach(k => produced.add(k)); });
  const feed = new Set(R.MATERIALS.filter(m => m.feed).map(m => m.id));
  const dangling = [...consumed].filter(k => !produced.has(k) && !feed.has(k));
  const unknown = [...new Set([...consumed, ...produced])].filter(k => !R.matById(k));
  ok('every consumed material is produced or purchasable', !dangling.length, dangling.join(',') || '');
  ok('no recipe references an unknown material id', !unknown.length, unknown.join(',') || '');
  const ids = new Set(M.MACHINES.map(m => m.id));
  ok('every recipe belongs to a real machine', R.RECIPES.every(r => ids.has(r.machine)));
  ok('every converter has at least one recipe', M.MACHINES.filter(m => m.kind === 'converter').every(m => R.recipesFor(m.id).length));
  /* Regression: outputs of qty 1 were annihilated by Math.floor(qty * mult). */
  const rig = makeRig(); const st = rig.reset(); st.lastTick = T0;
  S.build(st, rig.h, 'yard', T0); S.build(st, rig.h, 'shredder', T0); S.build(st, rig.h, 'sorter', T0); land(st, T0);
  S.setRecipe(st, rig.h, 'shredder', 'shredIndustrial'); S.setRecipe(st, rig.h, 'sorter', 'sortBasic');
  T.buyFeed(st, rig.h, 'industrialWaste', 300); T.buyFeed(st, rig.h, 'diesel', 120);
  S.tick(st, rig.h, T0 + 3 * 3600 * 1000);
  ok('1-unit outputs are not rounded out of existence', S.qtyOf(st, 'glassCullet') > 0 && S.qtyOf(st, 'nonFerrousStream') > 0,
     'glass ' + Math.floor(S.qtyOf(st, 'glassCullet')) + ', non-ferrous ' + Math.floor(S.qtyOf(st, 'nonFerrousStream')));
}

// ── 2. Floor layout ────────────────────────────────────────────────────────
head('2. Floor layout & collision');
{
  const items = Object.entries(MO.LAYOUT).map(([id, p]) => ({ id, ...p, ...MO.footprintOf(id) }));
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2) overlaps.push(a.id + '/' + b.id);
  }
  ok('every machine has a floor position', M.MACHINES.every(m => MO.LAYOUT[m.id]),
     M.MACHINES.filter(m => !MO.LAYOUT[m.id]).map(m => m.id).join(',') || '');
  ok('no two footprints overlap', !overlaps.length, overlaps.join(',') || '');
  ok('everything is inside the shed', items.every(p => Math.abs(p.x) < MO.FLOOR.w / 2 - 2 && Math.abs(p.z) < MO.FLOOR.d / 2 - 2));
  ok('spawn point is not inside a machine', !items.some(p => MO.blocks(p.id, p.ry, MO.SPAWN.x, MO.SPAWN.z, p.x, p.z)));
  const unreachable = items.filter(p => {
    let d = 0; while (d < 14 && MO.blocks(p.id, p.ry, p.x, p.z + d, p.x, p.z)) d += 0.05;
    return d > MO.interactRadius(p.id);
  }).map(p => p.id);
  ok('every machine is reachable (body clears inside prompt radius)', !unreachable.length, unreachable.join(',') || '');

  /* 🔴 THE UNSTICK. Building while standing on a pad puts a solid body around
     the player; without pushOut every move is refused and they are trapped. */
  let tested = 0, stuck = 0;
  for (const [id, p] of Object.entries(MO.LAYOUT)) {
    const f = MO.footprintOf(id);
    for (let a = -f.w / 2 - 0.5; a <= f.w / 2 + 0.5; a += 0.1) for (let b = -f.d / 2 - 0.5; b <= f.d / 2 + 0.5; b += 0.1) {
      const c = Math.cos(p.ry || 0), s = Math.sin(p.ry || 0);
      const wx = p.x + (a * c - b * s), wz = p.z + (a * s + b * c);
      if (!MO.blocks(id, p.ry, wx, wz, p.x, p.z)) continue;
      tested++; const out = MO.pushOut(id, p.ry, wx, wz, p.x, p.z);
      if (!out || MO.blocks(id, p.ry, out.x, out.z, p.x, p.z)) stuck++;
    }
  }
  ok('pushOut frees every interior point in one step', stuck === 0, tested + ' points, ' + stuck + ' stuck');
}

// ── 3. Build times ─────────────────────────────────────────────────────────
head('3. Build times scale with worth');
{
  const rows = [];
  for (const d of M.MACHINES) for (let lv = 0; lv < d.maxLevel; lv++) {
    const c = S.nextCost(d, lv); if (c) rows.push({ id: d.id + ' L' + (lv + 1), w: M.costWorth(c), s: M.buildSeconds(c) });
  }
  rows.sort((a, b) => a.w - b.w);
  const lo = rows[0], hi = rows[rows.length - 1];
  ok('cheapest build is quick', lo.s <= 120, lo.id + ' = ' + M.fmtDur(lo.s));
  /* Longer than the accrual cap means building COSTS you banked production. */
  ok('dearest build fits inside the 36h accrual cap', hi.s < 36 * 3600, hi.id + ' = ' + M.fmtDur(hi.s));
  ok('time rises monotonically with worth', rows.every((r, i) => i === 0 || r.s >= rows[i - 1].s - 1));
}

// ── 4. Construction behaviour ──────────────────────────────────────────────
head('4. A construction site is not a machine');
{
  const rig = makeRig(); const st = rig.reset(); st.lastTick = T0;
  S.build(st, rig.h, 'yard', T0); land(st, T0);
  const r = S.build(st, rig.h, 'shredder', T0);
  S.setRecipe(st, rig.h, 'shredder', 'shredIndustrial');
  T.buyFeed(st, rig.h, 'industrialWaste', 300); T.buyFeed(st, rig.h, 'diesel', 120);
  ok('build reports a duration', r.ok && r.secs > 0, M.fmtDur(r.secs || 0));
  ok('a site draws no power', S.powerDemand(st) === 0);
  S.tick(st, rig.h, T0 + Math.floor(r.secs * 0.5) * 1000);
  ok('a site produces nothing', S.qtyOf(st, 'shreddedWaste') === 0);
  S.tick(st, rig.h, T0 + (r.secs + 3600) * 1000);
  ok('it produces once construction lands', S.qtyOf(st, 'shreddedWaste') > 0, Math.floor(S.qtyOf(st, 'shreddedWaste')) + ' shred');
  const u = S.upgrade(st, rig.h, 'shredder', T0 + (r.secs + 3600) * 1000);
  ok('upgrade keeps the OLD level until it lands', u.ok && S.machineState(st, 'shredder').lv === 1);
  ok('repair is refused mid-build', !S.repair(st, rig.h, 'shredder').ok);
}

// ── 5. Fuel ────────────────────────────────────────────────────────────────
head('5. Fuel: bootstrap and no death spiral');
{
  ok('the fuel-makers burn nothing (unrecoverable-spiral guard)',
     M.machineById('still').burn === 0 && M.machineById('digester').burn === 0);
  ok('a purchasable fuel exists (bootstrap contract)', !!T.FEED_PRICES.diesel, 'diesel @ ' + T.FEED_PRICES.diesel);
  const rig = makeRig(); const st = rig.reset(); st.lastTick = T0;
  S.build(st, rig.h, 'yard', T0); S.build(st, rig.h, 'shredder', T0); land(st, T0);
  S.setRecipe(st, rig.h, 'shredder', 'shredIndustrial');
  T.buyFeed(st, rig.h, 'industrialWaste', 300);
  S.tick(st, rig.h, T0 + 3600 * 1000);
  ok('with no fuel, nothing runs', S.qtyOf(st, 'shreddedWaste') === 0);
  T.buyFeed(st, rig.h, 'diesel', 120);
  S.tick(st, rig.h, T0 + 2 * 3600 * 1000);
  ok('buying diesel restarts a dead line', S.qtyOf(st, 'shreddedWaste') > 0, Math.floor(S.qtyOf(st, 'shreddedWaste')) + ' shred');
}

// ── 6. Economy ─────────────────────────────────────────────────────────────
head('6. Economy — priced against the real trader table');
{
  const PRICE = { metal: 90, fuel: 110, supplies: 80 };   // index.html TRADER_DEFAULTS
  const REC = { shredder: 'shredIndustrial', sorter: 'sortBasic', baler: 'crushFerrous', recycler: 'baleRecycled',
    furnace: 'smeltPigIron', converter: 'makeSteel', mill: 'rollSheet', caster: 'castReject', ewaste: 'stripEwaste',
    still: 'distill', cracker: 'crackHeavy', digester: 'digestOrganic', blender: 'blendIndustrial' };
  const out = [];
  for (const trim of [0, 1]) {
    const rig = makeRig(); const st = rig.reset(); let t = T0; st.lastTick = t;
    for (const d of M.MACHINES) { S.build(st, rig.h, d.id, t); land(st, t); for (let i = 1; i < d.maxLevel; i++) { S.upgrade(st, rig.h, d.id, t); land(st, t); } }
    for (const k in REC) S.setRecipe(st, rig.h, k, REC[k]);
    S.setTrim(st, rig.h, trim);
    const c0 = rig.L.cinder;
    const feed = () => [['crudeOil', 900], ['industrialWaste', 700], ['coal', 400], ['limestone', 300], ['organicWaste', 400], ['electronicWaste', 150]]
      .forEach(([i, q]) => T.buyFeed(st, rig.h, i, q));
    T.buyFeed(st, rig.h, 'diesel', 200); feed();
    let metal = 0, fuel = 0, sup = 0, dry = 0;
    for (let k = 0; k < 8; k++) {
      t += 3 * 3600 * 1000; S.tick(st, rig.h, t);
      for (const i of ['metalIngot', 'sheetMetal', 'steel', 'aluminum', 'copper', 'recycledMetal']) { const c = T.cashOut(st, rig.h, i, 1e9); if (c.ok) metal += c.paid; }
      // sell the SURPLUS fuel, keep a reserve — refusing to sell jams the still
      for (const i of ['aviationFuel', 'gasoline', 'diesel', 'industrialFuel', 'naturalGasFuel']) {
        const keep = (i === 'diesel' || i === 'industrialFuel') ? 150 : 0;
        const sell = Math.floor(S.qtyOf(st, i)) - keep;
        if (sell > 0) { const c = T.cashOut(st, rig.h, i, sell); if (c.ok) fuel += c.paid; }
      }
      for (const i of ['recycledPlastic', 'recycledGlass', 'recycledElectronics']) { const c = T.cashOut(st, rig.h, i, 1e9); if (c.ok) sup += c.paid; }
      T.haul(st, rig.h, 'slag'); T.haul(st, rig.h, 'hazardousWaste');
      if (S.fuelOnHand(st) < 1) dry++;
      feed();
    }
    const val = metal * PRICE.metal + fuel * PRICE.fuel + sup * PRICE.supplies;
    out.push({ trim, ratio: val / (c0 - rig.L.cinder), dry, metal });
  }
  const [dirty, clean] = out;
  ok('running dirty is still profitable', dirty.ratio > 1.0, 'trim 0 = ' + dirty.ratio.toFixed(2) + 'x');
  ok('running clean pays better (the trim dial matters)', clean.ratio > dirty.ratio * 1.08,
     'trim 1 = ' + clean.ratio.toFixed(2) + 'x vs ' + dirty.ratio.toFixed(2) + 'x');
  ok('the line never runs dry over 24h', dirty.dry === 0 && clean.dry === 0);
  ok('the Casting Line contributes Metal', clean.metal > 0, clean.metal + ' Metal at clean trim');
}

// ── 7. The bridge contract ─────────────────────────────────────────────────
head('7. Bridge ↔ module contract (index.html)');
{
  try {
    const html = readFileSync('./public/index.html', 'utf8');
    const idx = readFileSync('./public/src/foundry/index.js', 'utf8');
    const bm = html.match(/window\.MythicFoundryBridge = \{([\s\S]*?)\n\};/);
    const hm = idx.match(/function makeHost\(\) \{([\s\S]*?)\n\}/);
    const provided = new Set([...(bm ? bm[1] : '').matchAll(/^\s{2}([A-Za-z_]\w*):/gm)].map(m => m[1]));
    const used = new Set([...(hm ? hm[1] : '').matchAll(/\bB\.(\w+)/g)].map(m => m[1]));
    const missing = [...used].filter(k => !provided.has(k));
    ok('index.html provides every bridge method the module calls', bm && hm && !missing.length, missing.join(',') || provided.size + ' methods');
    ok('the module script tag is present', /src\/foundry\/index\.js\?v=/.test(html));
    ok('Profile.foundry rides the cloud whitelist', /__foundry__/.test(html));
    ok('Forge.foundry (admin models) rides the forge whitelist', /foundry: \(Forge\.foundry/.test(html));
    ok('openFoundry() is defined', /function openFoundry\(\)/.test(html));
    const bv = (html.match(/BUILD_VERSION = '([^']+)'/) || [])[1];
    const sw = readFileSync('./public/sw.js', 'utf8');
    const cv = (sw.match(/CACHE_VERSION = '([^']+)'/) || [])[1];
    const vt = readFileSync('./public/version.txt', 'utf8').trim();
    ok('version triple agrees', bv === vt && (cv || '').includes(vt), `version.txt=${vt} BUILD_VERSION=${bv} CACHE_VERSION=${cv}`);
  } catch (e) { ok('bridge contract readable', false, e.message); }
}

console.log('\n' + '─'.repeat(60));
console.log(fails ? `\x1b[31m${fails} of ${checks} checks FAILED\x1b[0m` : `\x1b[32mall ${checks} checks passed\x1b[0m`);
process.exit(fails ? 1 : 0);
