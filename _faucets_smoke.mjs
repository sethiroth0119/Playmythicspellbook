/* 🚰 PER-SOURCE CINDER FAUCETS (sql/196_faucet_settle.sql).

   Four credits that used to reach the generic wallet_credit with a client-
   chosen amount now call their own RPC: Fuel Command sales (fcTick →
   _fcSalesPay), Refinery spot sales (sellSpot → St.earnSale → the bridge's
   settleSale), City builder income (window.cityAddCinders → _faucetCityIncome)
   and reconcile_local_gain_on_fetch (_faucetReconcileGain). This drives the
   REAL engine headless with stub RPCs and pins, per source:
     ok       — Profile.gems rises by what the SERVER paid, and no
                wallet_credit mirror fires on top (that would pay twice);
     refused  — no Cinder; goods (fuel / refinery stock) come back EXACTLY once;
     missing  — sql/196 not applied: the old addGems path pays once, and the
                missing RPC is remembered (no failed round trip per tick);
     network  — retried once with the SAME ref, then NOT refunded (the outcome
                is unknown — a refund would pay twice if the server had paid):
                the sale is credited locally and the reconcile flag is set.
   It also MODELS the SQL bounds in JS and checks them against the client's own
   constants, so a change to the demand curve, FC_NPC_MAX, a refinery price,
   the haircut, the index clamp or the tank size fails here before it makes the
   server refuse honest sales:
     * fuel: sold ≤ min(260, ceil(234.667 × (1.6 − pump/320))) for every
       reachable (pump, npc, rep, supply) — brute-forced against fcTick's formula;
     * refinery: the per-stream top unit in sql/196 equals data.js cost × 0.72 ×
       1.95 / RACK × 1.95, and litres ≤ 10 × 24,000.

   Run: node _faucets_smoke.mjs */
import { readFileSync } from 'node:fs';
import { loadEngine, EXPORTS } from './tools/gamedev/headless.mjs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// ════════════════════════════════════════════════════════════════════════
// 1. The SQL bounds, modelled, against the client's constants.
// ════════════════════════════════════════════════════════════════════════
const SQL = readFileSync(new URL('./sql/196_faucet_settle.sql', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
console.log('— the SQL bounds match the client maths');
const npcMax = Number((HTML.match(/const FC_NPC_MAX\s*=\s*(\d+)/) || [])[1]);
ok(npcMax === 320, 'FC_NPC_MAX is still 320 (sql/196 divides by it)', npcMax);
ok(/least\(260, ceil\(110 \* 1\.6 \* \(0\.5 \+ 100 \/ 120\.0\) \* \(1\.6 - p_pump \/ 320\.0\)\)\)/.test(SQL), 'sql/196 carries the fuel ceiling formula');
ok(/let dem = 110 \* \(1\.6 - ratio\);[\s\S]{0,80}dem \*= \(0\.5 \+ s\.rep \/ 120\);[\s\S]{0,60}if \(s\.supply < 30\) dem \*= 1\.6;[\s\S]{0,40}dem = _fcClamp\(dem, 0, 260\);/.test(HTML),
   'fcTick still uses the demand curve sql/196 was derived from');
const sqlCeil = (pump) => Math.min(260, Math.ceil(110 * 1.6 * (0.5 + 100 / 120) * (1.6 - pump / 320)));
let worst = null;
for (let pump = 1; pump <= 520; pump += 1) {
  for (const npc of [22, 60, 95, 150, 200, 260, 319.9, 320]) {
    for (const rep of [0, 50, 99.9, 100]) {
      for (const supply of [3, 29.9, 30, 100]) {
        let dem = 110 * (1.6 - pump / npc); dem *= (0.5 + rep / 120); if (supply < 30) dem *= 1.6;
        const sold = Math.round(Math.max(0, Math.min(260, dem)));
        if (sold <= 0) continue;
        if (pump >= 512 || sold > sqlCeil(pump)) { worst = { pump, npc, rep, supply, sold, ceil: sqlCeil(pump) }; }
      }
    }
  }
}
ok(worst === null, 'no reachable honest sale exceeds the server\'s sold ceiling (or needs pump ≥ 512)', JSON.stringify(worst));
let top = 0; for (let p = 1; p < 512; p++) top = Math.max(top, p * sqlCeil(p));
ok(top === 48316, 'the fuel ceiling per tick is 48,316 (pump 257 × 188), as sql/196 documents', top);

globalThis.window = { };   // replaced by the engine's window below; the module reads window.MythicRefineryBridge lazily
const data = await import('./public/src/refinery/data.js');
const state = await import('./public/src/refinery/state.js');
const sqlUnits = {};
for (const m of SQL.matchAll(/when '(\w+)'\s+then ([\d.]+) \* ([\d.]+)(?: \* ([\d.]+))?/g)) {
  sqlUnits[m[1]] = Number(m[2]) * Number(m[3]) * (m[4] ? Number(m[4]) : 1);
}
const idxMax = data.priceIndex(1e9, 1);
ok(Math.abs(idxMax - 1.95) < 1e-9, 'priceIndex still tops out at 1.95', idxMax);
let unitBad = [];
for (const id of Object.keys(data.COMPONENTS)) {
  const want = data.spotSellPrice(id, idxMax);
  if (!(Math.abs((sqlUnits[id] || 0) - want) < 1e-9)) unitBad.push(id + ' sql=' + sqlUnits[id] + ' js=' + want);
}
for (const id of Object.keys(data.RACK)) {
  if (data.COMPONENTS[id]) continue;
  const want = data.rackPrice(id, idxMax);
  if (!(Math.abs((sqlUnits[id] || 0) - want) < 1e-9)) unitBad.push(id + ' sql=' + sqlUnits[id] + ' js=' + want);
}
ok(unitBad.length === 0, 'every sellable stream\'s top unit price in sql/196 equals data.js at index 1.95', unitBad.join('; '));
ok(Object.keys(sqlUnits).length === Object.keys(data.COMPONENTS).length + Object.keys(data.RACK).length,
   'sql/196 prices exactly the sellable streams (components + rack)', Object.keys(sqlUnits).join(','));
const tanks = data.EQUIPMENT && data.EQUIPMENT.storeTank ? data.EQUIPMENT.storeTank.max : null;
ok(tanks * state.STORE_TANK_L === 240000 && /p_litres > 240000/.test(SQL), 'litres bound = storeTank max × STORE_TANK_L = 240,000', tanks + '×' + state.STORE_TANK_L);

// ════════════════════════════════════════════════════════════════════════
// 2. The client, driven headless.
// ════════════════════════════════════════════════════════════════════════
EXPORTS.push('fcTick', 'ensureFuelCommand', '_fcSalesPay', '_faucetBusy', '_faucetMissing',
  '_faucetReconcileGain', '_faucetCityIncome', 'CityMgr', 'Wallet');
const e = loadEngine();
const P = e.Profile, S = e.sandbox, W = e.window;
if (typeof e._fcSalesPay !== 'function') { console.log('  FAIL _fcSalesPay missing'); process.exit(1); }
S.initCloud = () => true;
S.saveProgressCloud = () => Promise.resolve();
S.saveProfile = () => {};
P.cloud.signedIn = true; P.cloud.userId = '00000000-0000-0000-0000-000000000001';
e.Wallet.rpcMissing = false;
let shift = 0;
const RealDate = Date;
S.Date = class extends RealDate { static now() { return RealDate.now() + shift; } };
let recon = 0;
const realMark = S._walletMarkReconcile;
S._walletMarkReconcile = () => { recon++; };
let calls = [], answers = {};
e.Cloud.client = {
  rpc: (fn, args) => {
    calls.push({ fn, args });
    if (answers[fn]) return answers[fn](args);
    return Promise.resolve({ data: P.gems | 0, error: null });
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
};
const of = (fn) => calls.filter(c => c.fn === fn);
const gems = () => P.gems | 0;
const fresh = () => { calls = []; recon = 0; };
const paid = (a, pay) => Promise.resolve({ data: { ok: true, paid: pay, balance: 0, left_day: 1, cap_day: 2 }, error: null });
const refuse = (why) => () => Promise.resolve({ data: { ok: false, reason: why, balance: 0 }, error: null });
const netFail = () => Promise.reject(new Error('Failed to fetch'));
const MISSING = () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });

// ── Fuel Command ─────────────────────────────────────────────────────────
console.log('— fuel: fcTick sells through faucet_fuel_sales (ok)');
const s = e.ensureFuelCommand();
Object.assign(s, { owned: true, online: true, power: 100, fuel: 1000, pump: 95, npc: 95, rep: 62, supply: 50, lastTickAt: 0, threat: 0, damage: 0 });
P.gems = 100000;   // opex is clamped at 0, so start with a wallet it can come out of
fresh(); let g0 = gems();
answers.faucet_fuel_sales = (a) => paid(a, a.p_sold * a.p_pump);
const fuel0 = s.fuel, sold0 = s.totalSold;
S.Math = Object.create(Math, { random: { value: () => 0.99 } });   // no RNG event, no review
e.fcTick();
await tick();
S.Math = Math;
const fc = of('faucet_fuel_sales')[0];
ok(!!fc, 'faucet_fuel_sales called by the tick');
const soldT = fc ? fc.args.p_sold : -1;
// fuel0 − fuel = sold + the 4 bbl a sub-100% generator burns this tick
ok(fc && soldT > 0 && fuel0 - s.fuel === soldT + 4 && fc.args.p_pump === 95, 'called with the barrels the tick sold and the pump price', fc && JSON.stringify(fc.args) + ' Δfuel=' + (fuel0 - s.fuel));
ok(fc && typeof fc.args.p_ref === 'string' && fc.args.p_ref.length >= 6 && fc.args.p_ref.length <= 80, 'carries a 6..80-char ref (sql/196 requires one)');
ok(of('wallet_credit').length === 0, 'no wallet_credit mirror on top', of('wallet_credit').length);
const opex = (s.workers * 36) + ((s.upgrades.pump | 0) * 3) + (s.insured ? 120 : 0);
ok(gems() === g0 + soldT * 95 - opex, 'wallet = + server pay − local opex', gems() - g0);
ok(s.totalSold === sold0 + soldT, 'KPIs count the sale');

console.log('— fuel: refused → barrels back exactly once, no Cinder');
fresh(); g0 = gems();
let f1 = s.fuel, t1 = s.totalSold, l1 = s.lifetimeRevenue;
s.fuel -= 40; s.totalSold += 40; s.lifetimeRevenue += 40 * 95;       // what fcTick books before paying
answers.faucet_fuel_sales = refuse('day');
await e._fcSalesPay(s, 40, 40 * 95);
ok(s.fuel === f1, 'fuel back in the tank', s.fuel - f1);
ok(s.totalSold === t1 && s.lifetimeRevenue === l1, 'KPIs forget the sale');
ok(gems() === g0 && of('wallet_credit').length === 0, 'no Cinder, no mirror');
console.log('— fuel: a refusal pauses the station (no RPC every 30 s)');
fresh(); const f2 = s.fuel;
s.lastTickAt = 0; e.fcTick(); await tick();
ok(of('faucet_fuel_sales').length === 0 && s.fuel >= f2 - 4, 'the next tick sells nothing while paused', of('faucet_fuel_sales').length);
shift = 11 * 60 * 1000;   // past the 10-minute pause

console.log('— fuel: network → one retry with the SAME ref, not refunded, credited locally, reconcile flagged');
fresh(); g0 = gems();
f1 = s.fuel; s.fuel -= 30;
answers.faucet_fuel_sales = netFail;
await e._fcSalesPay(s, 30, 30 * 95);
ok(of('faucet_fuel_sales').length === 2 && of('faucet_fuel_sales')[0].args.p_ref === of('faucet_fuel_sales')[1].args.p_ref, 'retried once, same ref');
ok(s.fuel === f1 - 30, 'fuel NOT refunded (outcome unknown — a refund could pay twice)');
ok(gems() === g0 + 30 * 95 && recon === 1, 'credited locally + reconcile flag set (addGems\' failure shape)', gems() - g0);

console.log('— fuel: busy → a tick while a sale is settling sells nothing');
fresh();
let release;
answers.faucet_fuel_sales = (a) => new Promise(r => { release = () => r({ data: { ok: true, paid: a.p_sold * a.p_pump }, error: null }); });
s.fuel = 1000; s.lastTickAt = 0; s.power = 100; s.online = true;
S.Math = Object.create(Math, { random: { value: () => 0.99 } });
e.fcTick();
const fAfter1 = s.fuel;
s.lastTickAt = 0; e.fcTick();
S.Math = Math;
ok(of('faucet_fuel_sales').length === 1 && s.fuel >= fAfter1 - 4, 'second tick while in flight: no second sale', of('faucet_fuel_sales').length);
if (release) release(); await tick();
ok(!e._faucetBusy.fuel, 'busy flag cleared when the answer lands');

console.log('— fuel: missing (sql/196 not applied) → addGems once, remembered');
fresh(); g0 = gems();
answers.faucet_fuel_sales = MISSING;
await e._fcSalesPay(s, 10, 950);
ok(gems() === g0 + 950 && of('wallet_credit').length === 1, 'paid via addGems + its usual mirror', gems() - g0);
fresh(); g0 = gems();
await e._fcSalesPay(s, 10, 950);
ok(of('faucet_fuel_sales').length === 0 && gems() === g0 + 950, 'no second failed round trip; old path pays');

// ── Refinery ────────────────────────────────────────────────────────────
console.log('— refinery: bridge.settleSale');
const B = W.MythicRefineryBridge;
ok(B && typeof B.settleSale === 'function', 'MythicRefineryBridge.settleSale exists');
let refunds = 0; const undo = () => { refunds++; };
fresh(); g0 = gems();
answers.faucet_refinery_sale = (a) => paid(a, a.p_amount);
await B.settleSale(8846, 'Refinery: spot sale', 'alkylate', 1000, undo);
const rc = of('faucet_refinery_sale')[0];
ok(rc && rc.args.p_stream === 'alkylate' && rc.args.p_litres === 1000 && rc.args.p_amount === 8846, 'called with stream, litres, amount', rc && JSON.stringify(rc.args));
ok(gems() === g0 + 8846 && refunds === 0 && of('wallet_credit').length === 0, 'paid once, no mirror, no refund');
fresh(); g0 = gems();
answers.faucet_refinery_sale = refuse('price');
await B.settleSale(9999, 'Refinery: spot sale', 'alkylate', 1000, undo);
ok(refunds === 1 && gems() === g0, 'refused → the undo runs exactly once, no Cinder', refunds);
fresh(); g0 = gems(); refunds = 0;
answers.faucet_refinery_sale = netFail;
await B.settleSale(500, 'Refinery: spot sale', 'kero', 100, undo);
ok(refunds === 0 && gems() === g0 + 500 && recon === 1, 'network → not refunded, credited locally, reconcile flagged');
console.log('— refinery: sellSpot drives the undo (module + bridge together)');
globalThis.window = W;   // the module reads window.MythicRefineryBridge at call time
const blend = await import('./public/src/refinery/blend.js');
const rs = state.S();
ok(rs === P.refinery, 'the module runs on the bridged save (Profile.refinery)');
rs.stock = rs.stock || {}; rs.stock.kero = 5000; rs.pnl = rs.pnl || {};
fresh(); g0 = gems();
answers.faucet_refinery_sale = refuse('day');
const rev0 = rs.pnl.revenue | 0;
blend.sellSpot('kero', 1000);
await tick();
ok(Math.round(state.stock('kero')) === 5000, 'stock back to 5,000 L after the refusal', state.stock('kero'));
ok((rs.pnl.revenue | 0) === rev0 && gems() === g0, 'revenue unbooked, no Cinder', (rs.pnl.revenue | 0) - rev0);
fresh();
answers.faucet_refinery_sale = MISSING;
g0 = gems();
blend.sellSpot('kero', 1000);
await tick();
ok(Math.round(state.stock('kero')) === 4000 && gems() > g0 && of('wallet_credit').length === 1, 'missing → sold, paid by addGems once', gems() - g0);

// ── City builder income ─────────────────────────────────────────────────
console.log('— city income: window.cityAddCinders');
e.CityMgr.active = false; S.App._cityOwnerId = null;
fresh(); g0 = gems();
answers.faucet_city_income = (a) => paid(a, a.p_amount);
W.cityAddCinders(1234, 'City builder income');
await tick();
ok(of('faucet_city_income').length === 1 && of('faucet_city_income')[0].args.p_amount === 1234, 'faucet_city_income(1234)');
ok(gems() === g0 + 1234 && of('wallet_credit').length === 0, 'paid once, no mirror');
fresh(); g0 = gems();
answers.faucet_city_income = refuse('day');
W.cityAddCinders(1234);
await tick();
ok(gems() === g0, 'refused → not paid (nothing was spent to earn it)');
fresh(); g0 = gems();
W.cityAddCinders(77, 'Stadium ticket');
await tick();
ok(of('faucet_city_income').length === 0 && gems() === g0 + 77, 'any other reason keeps the old path');
fresh(); g0 = gems();
answers.faucet_city_income = MISSING;
W.cityAddCinders(10);
await tick();
W.cityAddCinders(10);
await tick();
ok(of('faucet_city_income').length === 1 && gems() === g0 + 20, 'missing → addGems, remembered', of('faucet_city_income').length);

// ── reconcile_local_gain_on_fetch ───────────────────────────────────────
console.log('— reconcile gain');
fresh(); g0 = gems();
answers.faucet_reconcile_gain = (a) => paid(a, Math.min(a.p_amount, 250000));
await e._faucetReconcileGain(400000);
ok(of('faucet_reconcile_gain').length === 1 && of('faucet_reconcile_gain')[0].args.p_amount === 400000, 'asks for the whole diff');
ok(gems() === g0 && of('wallet_credit').length === 0, 'local untouched (it already holds MAX), no mirror');
fresh();
answers.faucet_reconcile_gain = refuse('day');
await e._faucetReconcileGain(5);
ok(recon === 0, 'over the allowance: no reconcile flag (would loop)');
fresh();
answers.faucet_reconcile_gain = netFail;
await e._faucetReconcileGain(5);
ok(recon === 1 && of('faucet_reconcile_gain').length === 2, 'network: retried once, reconcile flag set');
fresh();
answers.faucet_reconcile_gain = MISSING;
await e._faucetReconcileGain(5);
ok(of('wallet_credit').length === 1 && of('wallet_credit')[0].args.p_reason === 'reconcile_local_gain_on_fetch', 'missing → the old mirror, same reason');
ok(/_faucetReconcileGain\(diff\)/.test(HTML) && !/_serverMirrorCredit\(diff, 'reconcile_local_gain_on_fetch'\)/.test(HTML.replace(/const old = \(\) => _serverMirrorCredit\(diff, 'reconcile_local_gain_on_fetch'\);/, '')),
   'walletFetchProgress routes its diff through _faucetReconcileGain');

console.log('— signed out: never calls a faucet');
fresh(); P.cloud.signedIn = false; g0 = gems();
W.cityAddCinders(5);
await tick();
ok(of('faucet_city_income').length === 0 && gems() === g0 + 5, 'offline city income pays locally');
S._walletMarkReconcile = realMark;

console.log(fails ? `\n${fails} FAIL, ${passes} pass` : `\nall ${passes} pass`);
process.exit(fails ? 1 : 0);
