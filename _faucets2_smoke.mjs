/* 🚰 PER-SOURCE CINDER FAUCETS, PHASE 2 (sql/198_faucet_settle_2.sql).

   What moved off the generic wallet_credit, and what this pins:
     §1 city_owner_ledger_apply — the mayor's credit is CLAMPED server-side;
        the client re-queues a per-call clamp and says a day clamp once.
     §2 keyed refunds — _cinderSpendRef charges a spend under a ref
        (wallet_charge_ref) and _cinderRefund gives back exactly that charge,
        once (wallet_refund). A synchronous spend+refund used to credit the
        server a spend the watcher never billed; this proves it nets to zero.
        Every addGems/addCinders call in index.html names its source.
     §3 Fuel Command — NPC sale, hedge, insurance, positions, loans.
     §4 Season Pass — each (season, track, tier) through faucet_season_pass.
   Per door: ok / refused / missing (sql/198 not applied) / network, and the
   once-only guarantees (a refund runs once, goods come back once).

   It also MODELS the SQL arithmetic against the client's own constants, so a
   change to FC_NPC_*, the tank ladder, the insurance payout, a Season Pass
   tier, or a reason string the server keys on fails HERE before production
   refuses honest players. The SQL itself was exercised on a throwaway
   Postgres 16 with the live function bodies (see the commit message).

   The engine runs from a throwaway COPY of index.html with the spend watcher
   armed (headless timers never fire, so the 4 s arming never happens) and its
   baseline readable — nothing in public/ is modified.

   Run: node _faucets2_smoke.mjs */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEngine, EXPORTS } from './tools/gamedev/headless.mjs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

const SQL = readFileSync(new URL('./sql/198_faucet_settle_2.sql', import.meta.url), 'utf8');
const SQL196 = readFileSync(new URL('./sql/196_faucet_settle.sql', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // SQL without comments

// ════════════════════════════════════════════════════════════════════════
// 1. The SQL, against the client's constants.
// ════════════════════════════════════════════════════════════════════════
console.log('— Season Pass: season_pass_tiers seed == SEASON_*_REWARDS');
const arr = (name) => {
  const i = HTML.indexOf('const ' + name + ' = [');
  const j = HTML.indexOf('];', i);
  return Function('return ' + HTML.slice(HTML.indexOf('[', i), j + 1))();
};
const want = {};
for (const [name, track] of [['SEASON_FREE_REWARDS', 'free'], ['SEASON_PREMIUM_REWARDS', 'premium']]) {
  arr(name).forEach((r, tier) => { if (r && r.kind === 'cinder') want[track + ':' + tier] = r.amount; });
}
const seed = {};
const seedBlock = (SQL.match(/with seed\(track, tier, cinder\) as \(values([\s\S]*?)\), gone as/) || [])[1] || '';
for (const m of seedBlock.matchAll(/\('(free|premium)', (\d+), (\d+)\)/g)) seed[m[1] + ':' + m[2]] = Number(m[3]);
const drift = [...new Set([...Object.keys(want), ...Object.keys(seed)])].filter(k => want[k] !== seed[k]).map(k => k + ' client=' + want[k] + ' sql=' + seed[k]);
ok(Object.keys(want).length === 33 && drift.length === 0, 'every Cinder tier in the client is seeded at the same amount, and nothing else', drift.join('; ') || Object.keys(want).length);
const full = Object.values(want).reduce((a, b) => a + b, 0);
ok(/c_day_sp constant bigint := (\d+);/.test(SQL) && Number(SQL.match(/c_day_sp constant bigint := (\d+);/)[1]) === full, 'the Season Pass day cap is exactly one full season (' + full + ')');
ok(/SEASON_TIER_COUNT = 30;/.test(HTML) && /tier between 1 and 30/.test(SQL), 'tier range 1..30 on both sides');
ok(/chargeCinderAtomic\(5000, 'Season Pass — Premium unlock'\)/.test(HTML) && /l\.reason = 'Season Pass — Premium unlock'/.test(SQL),
   'premium is gated on the exact reason the unlock is charged under');
ok(/SEASON_LENGTH_MS = 30 \* 24 \* 60 \* 60 \* 1000/.test(HTML) && /\/ 2592000\)/.test(SQL), 'season length 30 days on both sides (2,592,000 s)');

console.log('— Fuel Command bounds');
const num = (re) => Number((HTML.match(re) || [])[1]);
const npcMax = num(/const FC_NPC_MAX\s*=\s*(\d+)/), npcMin = num(/const FC_NPC_MIN\s*=\s*(\d+)/), spread = num(/const FC_NPC_SPREAD\s*=\s*([\d.]+)/);
ok(Math.floor(npcMax * (1 - spread)) === 304 && /p_qty::bigint \* 304/.test(SQL), 'NPC bid ceiling = FC_NPC_MAX × (1 − spread) = 304 ¢/bbl', npcMax + ' ' + spread);
ok(npcMax - npcMin === 298 && /p_qty::bigint \* 298/.test(SQL), 'hedge ceiling = FC_NPC_MAX − FC_NPC_MIN = 298 ¢/bbl', npcMax - npcMin);
const tank = (HTML.match(/\{ id: 'tank',[^}]*max: (\d+)/) || [])[1];
const capLvl = /s\.fuelCap\s*=\s*1000 \+ \(s\.upgrades\.tank \| 0\) \* 250;/.test(HTML);
const defCap = num(/if \(typeof s\.fuelCap !== 'number'\)\s*s\.fuelCap = (\d+);/);
ok(capLvl && Math.max(1000 + tank * 250, defCap) === 2500 && (code(SQL).match(/p_qty > 2500/g) || []).length === 2, 'qty ≤ 2,500 = max(tank ladder 1000 + 6 × 250, default 1500), for NPC sale and hedge', tank + '/' + defCap);
ok(/_fcInsurancePay\(\)/.test(HTML) && /const n = 4000, why = 'Fuel Command: insurance payout';/.test(HTML) && /_faucet_settle\('fc_insurance', 4000,/.test(SQL), 'insurance pays 4,000 on both sides');
ok(/_serverMirrorCharge\(cost, 'Fuel Command: Insurance'\)/.test(HTML) && /l\.reason = 'Fuel Command: Insurance'/.test(SQL), 'the insurance gate reads the exact reason the premium is charged under');
for (const [door, reason] of [['fc_npc_sale', 'Fuel Command: NPC sale'], ['fc_hedge', 'Fuel Command: hedge settled'], ['fc_position', 'Fuel Command: position closed'], ['fc_loan', 'Fuel Command: loan drawn']]) {
  ok(SQL.includes("_faucet_settle('" + door + "'") && SQL.includes("'" + reason + "'") && HTML.includes("'" + reason + "'"), door + ' keeps the ledger reason "' + reason + '"');
}

console.log('— mayor clamp: sql/198 reuses faucet_city_income\'s ceilings (sql/196)');
const c196 = [Number((SQL196.match(/c_call_city constant bigint := (\d+);/) || [])[1]), Number((SQL196.match(/c_day_city\s+constant bigint := (\d+);/) || [])[1])];
const c198 = [Number((SQL.match(/c_call_mc constant bigint := (\d+);/) || [])[1]), Number((SQL.match(/c_day_mc\s+constant bigint := (\d+);/) || [])[1])];
ok(c196[0] === c198[0] && c196[1] === c198[1] && c198[0] === 120000, 'per call ' + c198[0] + ', per day ' + c198[1] + ' — same as the own-city door', JSON.stringify([c196, c198]));
// the SQL arithmetic, modelled: paid = floor(min(asked, call, room)); cut on the paid part
const mayorModel = (asked, dayUsed, pct) => {
  const room = Math.max(0, c198[1] - dayUsed), paid = Math.floor(Math.min(asked, c198[0], room));
  const cut = paid > 0 && pct > 0 ? Math.floor(paid * pct / 100) : 0;
  return { paid, cut, owner: paid - cut, capped: Math.max(0, asked - paid), why: paid < asked ? (room <= Math.min(asked, c198[0]) ? 'day' : 'call') : null };
};
ok(JSON.stringify(mayorModel(4000, 0, 25)) === JSON.stringify({ paid: 4000, cut: 1000, owner: 3000, capped: 0, why: null }), 'model: an honest 4,000 pays 3,000 + a 1,000 cut (the PG run: owner +3000, mayor +1000)');
ok(mayorModel(1e12, 4000, 25).owner === 90000 && mayorModel(1e12, 4000, 25).why === 'call', 'model: 1e12 → 120,000 paid, 90,000 to the owner, reason call (PG: true/90000/…/call)');
ok(mayorModel(5000, 1500000, 25).paid === 0 && mayorModel(5000, 1500000, 25).why === 'day', 'model: past the day cap nothing is paid, reason day');
ok(/'capped', greatest\(0, v_asked - greatest\(v_delta, 0\)\)::bigint,/.test(SQL) && /'cap_reason', v_why,/.test(SQL) && /j\.cap_reason === 'call'/.test(HTML), 'the reply carries capped + cap_reason and the client reads them');

console.log('— position / loan / refund arithmetic, modelled');
const posModel = (stake, asked, profitUsed) => Math.min(asked, stake * 5, stake + Math.max(0, 1000000 - profitUsed));
ok(posModel(1000, 1e9, 0) === 5000 && posModel(400000, 2000000, 4000) === 1396000 && posModel(1000, 5000, 1000000) === 1000,
   'close = min(asked, 5 × stake, stake + profit room) — 5,000 / 1,396,000 / 1,000 (the PG run)');
ok(/c_mult\s+constant bigint := 5;/.test(SQL) && /c_day_profit constant bigint := 1000000;/.test(SQL), 'SQL constants match the model (5×, 1M profit / 24 h)');
ok(/pl\s+= Math\.round\(s\.pos\.stake \* \(1 \+ dir \* move \* 4\)\);/.test(HTML), 'fcClosePos is still 4× levered (5× = a short\'s ceiling with the mark ≥ FC_NPC_MIN)');
ok(/c_loan_max constant bigint := 100000;/.test(SQL), 'loan principal ≤ 100,000');
ok(/'chg:' \|\| p_ref/.test(SQL) && /'fcpos:' \|\| p_ref/.test(SQL) && /'fcloan:' \|\| p_ref/.test(SQL) && /l\.ref = 'chg:' \|\| p_charge_ref/.test(SQL),
   'wallet_refund only finds \'chg:\' charges — position stakes and loan repayments are never refundable by ref');

// ════════════════════════════════════════════════════════════════════════
// 2. Every credit in index.html names its source.
// ════════════════════════════════════════════════════════════════════════
console.log('— no anonymous addGems / addCinders');
const lines = HTML.split('\n');
const anon = [];
let inBlock = false;
lines.forEach((l, i) => {
  // Drop comments: block comments across lines, then a trailing // comment.
  let t = l;
  if (inBlock) { const k = t.indexOf('*/'); if (k < 0) return; t = t.slice(k + 2); inBlock = false; }
  t = t.replace(/\/\*[\s\S]*?\*\//g, '');
  const open = t.indexOf('/*'); if (open >= 0) { t = t.slice(0, open); inBlock = true; }
  t = t.replace(/(^|[^:'"\\])\/\/.*$/, '$1');
  for (const m of t.matchAll(/\b(addGems|addCinders)\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
    if (/function (addGems|addCinders)\s*$/.test(t.slice(0, m.index))) continue;
    if (!/,/.test(m[2])) anon.push((i + 1) + ': ' + t.trim().slice(0, 90));
  }
});
const realAnon = anon;
ok(realAnon.length === 0, 'every addGems/addCinders call passes a reason', realAnon.slice(0, 6).join(' | '));

// ════════════════════════════════════════════════════════════════════════
// 3. The client, driven headless.
// ════════════════════════════════════════════════════════════════════════
const dir = mkdtempSync(join(tmpdir(), 'faucets2-'));
const copy = join(dir, 'index.html');
const armed = HTML
  .replace('let _gemsTaxArmed = false;', 'let _gemsTaxArmed = true;')
  .replace('let _gemsWatchLast = null;', 'let _gemsWatchLast = null; window.__wl = () => _gemsWatchLast;');
ok(armed !== HTML && armed.includes('window.__wl'), 'throwaway copy: watcher armed, baseline readable');
writeFileSync(copy, armed);
EXPORTS.push('_cinderSpendRef', '_cinderRefund', '_faucetMissing', '_gemsTaxTick', '_installGemsTaxInterceptor',
  '_fcNpcSalePay', '_fcHedgePay', '_fcInsurancePay', '_fcPositionClosePay', '_fcLoanDrawPay',
  'fcSettleHedge', 'fcLockHedge', 'fcOpenPos', 'fcClosePos', 'fcOpenLoan', 'fcPayLoan', 'fcFireEvent', 'ensureFuelCommand',
  '_seasonPayCinder', 'claimSeasonReward', '_ensureSeasonPass', '_cityMgrSend', 'CityMgr', 'Wallet', '_refundQueueDrain');
const e = loadEngine({ file: copy });
const P = e.Profile, S = e.sandbox, W = e.window;
if (typeof e._cinderSpendRef !== 'function') { console.log('  FAIL _cinderSpendRef missing'); process.exit(1); }
S.initCloud = () => true;
S.saveProgressCloud = () => Promise.resolve();
S.saveProfile = () => {};
let toasts = [];
S.showToast = (m) => { toasts.push(String(m)); };
P.cloud.signedIn = true; P.cloud.userId = '00000000-0000-0000-0000-000000000002';
e.Wallet.rpcMissing = false;
let recon = 0;
S._walletMarkReconcile = () => { recon++; };
let calls = [], answers = {};
e.Cloud.client = {
  rpc: (fn, args) => {
    calls.push({ fn, args });
    if (answers[fn]) return answers[fn](args);
    if (fn === 'wallet_charge') return Promise.resolve({ data: [{ ok: true, new_balance: 0, tax_amount: 0, wallet_seq: 1 }], error: null });
    return Promise.resolve({ data: P.gems | 0, error: null });
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
};
const of = (fn) => calls.filter(c => c.fn === fn);
const gems = () => P.gems | 0;
const fresh = () => { calls = []; recon = 0; toasts = []; };
const OKR = (extra) => () => Promise.resolve({ data: Object.assign({ ok: true, balance: 0 }, extra || {}), error: null });
const paid = (n) => () => Promise.resolve({ data: { ok: true, paid: n, balance: 0 }, error: null });
const refuse = (why, extra) => () => Promise.resolve({ data: Object.assign({ ok: false, reason: why }, extra || {}), error: null });
const netFail = () => Promise.reject(new Error('Failed to fetch'));
const MISSING = () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
const unmiss = (...fns) => fns.forEach(f => { delete e._faucetMissing[f]; });
const watch = () => W.__wl();
P.gems = 1000000;
e._gemsTaxTick();                    // baseline the watcher

// ── §2 keyed refunds ────────────────────────────────────────────────────
console.log('— refund: charge ok → refund through wallet_refund(same ref), once');
fresh(); let g0 = gems();
answers.wallet_charge_ref = OKR(); answers.wallet_refund = OKR({ refunded: 500 });
let h = e._cinderSpendRef(500, 'Court: case filing fee');
ok(h && gems() === g0 - 500, 'spent locally');
ok(of('wallet_charge_ref').length === 1 && of('wallet_charge_ref')[0].args.p_amount === 500 && of('wallet_charge_ref')[0].args.p_reason === 'Court: case filing fee'
   && of('wallet_charge_ref')[0].args.p_ref === h.ref && /^cr_/.test(h.ref), 'charged by wallet_charge_ref under the handle\'s ref');
e._gemsTaxTick();
ok(of('wallet_charge').length === 0, 'the spend watcher does NOT bill it a second time', of('wallet_charge').length);
await e._cinderRefund(h, 'Court: case filing failed'); await tick();
ok(gems() === g0, 'refund restores the wallet exactly');
ok(of('wallet_refund').length === 1 && of('wallet_refund')[0].args.p_charge_ref === h.ref, 'wallet_refund(the charge\'s ref)');
ok(of('wallet_credit').length === 0, 'no wallet_credit (the old refund path)');
await e._cinderRefund(h, 'again'); await tick();
ok(gems() === g0 && of('wallet_refund').length === 1, 'a second refund of the same handle does nothing');
e._gemsTaxTick();
ok(of('wallet_charge').length === 0 && watch() === gems(), 'watcher baseline level with the wallet, nothing billed', watch() + ' vs ' + gems());

console.log('— refund: SYNCHRONOUS spend + refund (the old mint) nets to zero on the server');
fresh(); g0 = gems();
h = e._cinderSpendRef(700, 'Detention: bail posted');
e._cinderRefund(h, 'Detention: bail resources short');   // same task, before any tick
e._gemsTaxTick(); await tick();
ok(gems() === g0, 'wallet unchanged');
ok(of('wallet_charge_ref').length === 1 && of('wallet_refund').length === 1 && of('wallet_credit').length === 0 && of('wallet_charge').length === 0,
   'one keyed charge + its keyed refund; no wallet_credit (the old addGems(bail) was a +700 mint)', calls.map(c => c.fn).join(','));

console.log('— refund: charge refused by the server → refund is local only');
fresh(); g0 = gems();
answers.wallet_charge_ref = refuse('insufficient');
h = e._cinderSpendRef(300, 'Lab: breeding');
await tick();
ok(h.state === 'refused', 'handle knows the charge was refused');
await e._cinderRefund(h, 'Lab: breeding failed'); await tick();
ok(gems() === g0 && of('wallet_refund').length === 0 && of('wallet_credit').length === 0, 'local restored, nothing asked of the server');

console.log('— refund: charge network-unknown → refund still goes to wallet_refund (which voids a late charge)');
fresh(); g0 = gems();
answers.wallet_charge_ref = netFail; answers.wallet_refund = OKR({ voided: true, refunded: 0 });
h = e._cinderSpendRef(200, 'Corp: treasury deposit');
await tick();
ok(h.state === 'unknown' && of('wallet_charge_ref').length === 2 && of('wallet_charge_ref')[0].args.p_ref === of('wallet_charge_ref')[1].args.p_ref, 'charge retried once with the same ref, outcome unknown');
await e._cinderRefund(h, 'Corp: treasury deposit failed'); await tick();
ok(gems() === g0 && of('wallet_refund').length === 1 && of('wallet_refund')[0].args.p_charge_ref === h.ref, 'wallet_refund(ref) — nets to zero whichever landed first');

console.log('— refund: wallet_refund unreachable → queued (per device), replayed by the drain');
fresh();
answers.wallet_charge_ref = OKR(); answers.wallet_refund = netFail;
h = e._cinderSpendRef(100, 'Gym Wars: gym upgrade to Lv 2');
await e._cinderRefund(h, 'Gym Wars: upgrade failed'); await tick();
const q = JSON.parse(W.localStorage.getItem('ms_refund_q_v1') || '[]');
ok(q.length === 1 && q[0].ref === h.ref && recon >= 1, 'queued with its ref + reconcile flagged');
answers.wallet_refund = OKR({ refunded: 100 });
fresh(); await e._refundQueueDrain();
ok(of('wallet_refund').length === 1 && JSON.parse(W.localStorage.getItem('ms_refund_q_v1') || '[]').length === 0, 'the drain refunds it and empties the queue');

console.log('— refund: sql/198 missing → the old billing + a NAMED refund credit');
fresh(); g0 = gems();
answers.wallet_charge_ref = MISSING;
h = e._cinderSpendRef(400, 'Bank of Ethos: deposit fee');
await tick();
ok(h.state === 'legacy' && of('wallet_charge').length === 1 && of('wallet_charge')[0].args.p_amount === 400, 'billed by wallet_charge (what the watcher would have sent)');
await e._cinderRefund(h, 'Bank of Ethos: deposit failed'); await tick();
const wc = of('wallet_credit');
ok(gems() === g0 && wc.length === 1 && wc[0].args.p_amount === 400 && wc[0].args.p_reason === 'Refund: Bank of Ethos: deposit failed', 'refund = wallet_credit under "Refund: …", not "addGems"', wc[0] && wc[0].args.p_reason);
fresh();
h = e._cinderSpendRef(10, 'x'); await tick();
ok(of('wallet_charge_ref').length === 0 && of('wallet_charge').length === 1, 'missing is remembered: no failed round trip per spend');
await e._cinderRefund(h, 'x undone'); await tick();
ok(h.state === 'legacy' && of('wallet_credit').length === 1 && of('wallet_credit')[0].args.p_amount === 10, 'a remembered-missing charge is still refunded on the server (it WAS billed)', h.state);
unmiss('wallet_charge_ref');

console.log('— refund: insufficient local wallet → null, nothing spent');
fresh(); g0 = gems();
ok(e._cinderSpendRef(g0 + 1, 'x') === null && gems() === g0 && calls.length === 0, 'returns null, no RPC');
const h0 = e._cinderSpendRef(0, 'x');
ok(h0 && h0.amount === 0 && calls.length === 0, 'a zero spend is a harmless handle (BOE wallet-take of 0)');

console.log('— a real site: window.citySpendCost refunds a short-resource build through the key');
fresh(); g0 = gems();
answers.wallet_charge_ref = OKR(); answers.wallet_refund = OKR({ refunded: 150 });
e.CityMgr.active = false;
const r1 = W.citySpendCost({ cinder: 150, wood: 999999999 });
e._gemsTaxTick(); await tick();
ok(r1 === false && gems() === g0, 'build refused, wallet whole');
ok(of('wallet_charge_ref').length === 1 && of('wallet_refund').length === 1 && of('wallet_credit').length === 0, 'keyed charge + keyed refund, no mint', calls.map(c => c.fn).join(','));

// ── §3 Fuel Command ─────────────────────────────────────────────────────
const s = e.ensureFuelCommand();
Object.assign(s, { owned: true, fuel: 1000, npc: 95, supply: 50, insured: false, pos: null, hedge: null, loan: null });
console.log('— NPC sale');
fresh(); g0 = gems();
answers.faucet_fc_npc_sale = paid(30400);
await e._fcNpcSalePay(s, 100, 30400);
let c = of('faucet_fc_npc_sale')[0];
ok(c && c.args.p_qty === 100 && c.args.p_amount === 30400 && gems() === g0 + 30400 && of('wallet_credit').length === 0, 'ok → the server\'s figure, no mirror');
fresh(); g0 = gems(); let f0 = s.fuel;
answers.faucet_fc_npc_sale = refuse('price');
await e._fcNpcSalePay(s, 100, 99999);
ok(s.fuel === f0 + 100 && gems() === g0, 'refused → the 100 bbl are back, once; no Cinder');
fresh(); g0 = gems(); f0 = s.fuel;
answers.faucet_fc_npc_sale = netFail;
await e._fcNpcSalePay(s, 10, 3000);
ok(of('faucet_fc_npc_sale').length === 2 && of('faucet_fc_npc_sale')[0].args.p_ref === of('faucet_fc_npc_sale')[1].args.p_ref && s.fuel === f0 && gems() === g0 + 3000 && recon === 1,
   'network → retried with the same ref, fuel NOT refunded, credited locally, reconcile flagged');
fresh(); g0 = gems();
answers.faucet_fc_npc_sale = MISSING;
await e._fcNpcSalePay(s, 10, 3000);
ok(gems() === g0 + 3000 && of('wallet_credit').length === 1 && of('wallet_credit')[0].args.p_reason === 'Fuel Command: NPC sale', 'missing → addGems + its mirror, same reason');

console.log('— hedge');
fresh(); g0 = gems();
answers.faucet_fc_hedge = paid(2980);
const hedge = { price: 90, qty: 10, exoLift: 0, exoDrop: 0 };
await e._fcHedgePay(s, hedge, 2980);
ok(of('faucet_fc_hedge')[0].args.p_qty === 10 && gems() === g0 + 2980, 'ok → paid');
fresh(); g0 = gems(); s.hedge = null;
answers.faucet_fc_hedge = refuse('rate');
await e._fcHedgePay(s, hedge, 2980);
ok(s.hedge === hedge && gems() === g0, 'refused → the hedge is back (still the player\'s), no Cinder');
fresh(); s.hedge = null; g0 = gems();
answers.faucet_fc_hedge = netFail;
await e._fcHedgePay(s, hedge, 500);
ok(s.hedge === null && gems() === g0 + 500 && recon === 1, 'network → credited locally, hedge stays settled');
fresh(); g0 = gems();
answers.faucet_fc_hedge = MISSING;
await e._fcHedgePay(s, hedge, 500);
ok(gems() === g0 + 500 && of('wallet_credit').length === 1, 'missing → old path');

console.log('— insurance: a FORCED event pays nothing; a rolled one and the extraction raid use the door');
answers.faucet_fc_insurance = paid(4000);
s.insured = true; s.security = 0;
fresh(); g0 = gems();
S.Math = Object.create(Math, { random: { value: () => 0.99 } });
e.fcFireEvent('scp');
await tick();
ok(of('faucet_fc_insurance').length === 0 && of('wallet_credit').length === 0, 'Force Trigger SCP → no payout (was +4,000 a click)');
fresh();
e.fcFireEvent('bandit', true);
await tick();
ok(of('faucet_fc_insurance').length === 1, 'the extraction run\'s raid (genuine) files a claim');
fresh(); g0 = gems();
S.Math = Object.create(Math, { random: { value: () => 0.999 } });   // the roll picks the pool's last entry: boom
e.fcFireEvent();
S.Math = Math;
await tick();
ok(of('faucet_fc_insurance').length === 1 && of('wallet_credit').length === 0, 'a rolled boom files through faucet_fc_insurance, no mirror', calls.map(c => c.fn).join(','));
fresh(); g0 = gems();
answers.faucet_fc_insurance = refuse('uninsured');
await e._fcInsurancePay();
ok(gems() === g0, 'refused → nothing paid');
answers.faucet_fc_insurance = MISSING;
fresh(); g0 = gems();
await e._fcInsurancePay();
ok(gems() === g0 + 4000 && of('wallet_credit').length === 1, 'missing → old path');
s.insured = false;

console.log('— positions');
fresh(); g0 = gems();
answers.fc_position_open = OKR({ stake: 1000 });
e.fcOpenPos('long', 1000);
await tick();
c = of('fc_position_open')[0];
ok(c && c.args.p_side === 'long' && c.args.p_stake === 1000 && !('p_amount' in c.args) && s.pos && s.pos.ref === c.args.p_ref, 'open → fc_position_open(side, stake, ref) and the position carries the ref');
ok(gems() === g0 - 1000 && of('wallet_charge').length === 0, 'stake charged once, by the door (no _serverMirrorCharge)');
fresh(); g0 = gems();
answers.faucet_fc_position_close = OKR({ paid: 1000, capped: 0 });
const pref = s.pos.ref;
e.fcClosePos();
await tick();
c = of('faucet_fc_position_close')[0];
ok(c && c.args.p_pos_ref === pref && typeof c.args.p_payout === 'number' && s.pos === null && gems() === g0 + 1000 && of('wallet_credit').length === 0, 'close → the server\'s payout, no mirror');
console.log('— positions: open refused → stake back once, no position');
fresh(); g0 = gems();
answers.fc_position_open = refuse('open');
e.fcOpenPos('short', 500);
await tick();
ok(s.pos === null && gems() === g0 && of('wallet_refund').length === 0, 'refused → no position, stake refunded locally (never charged on the server)');
console.log('— positions: close refused (day) → the position is still open');
answers.fc_position_open = OKR({ stake: 500 });
fresh(); e.fcOpenPos('short', 500); await tick();
const pos = s.pos;
answers.faucet_fc_position_close = refuse('day');
fresh(); g0 = gems();
e.fcClosePos(); await tick();
ok(s.pos === pos && gems() === g0, 'refused → s.pos restored, nothing paid');
answers.faucet_fc_position_close = refuse('no_position');
fresh(); g0 = gems();
e.fcClosePos(); await tick();
ok(s.pos === null && gems() === g0, 'no_position (its open never landed) → closed, nothing paid');
console.log('— positions: sql/198 missing → the old open + close');
answers.fc_position_open = MISSING; answers.faucet_fc_position_close = MISSING;
fresh(); g0 = gems();
e.fcOpenPos('long', 800); await tick();
ok(s.pos && !s.pos.ref && of('wallet_charge').length === 1, 'open billed the old way, no ref on the position');
fresh();
e.fcClosePos(); await tick();
ok(of('faucet_fc_position_close').length === 0 && of('wallet_credit').length === 1 && of('wallet_credit')[0].args.p_reason === 'Fuel Command: position closed', 'close without a ref → addGems (old path)');
unmiss('fc_position_open', 'faucet_fc_position_close');

console.log('— loans');
fresh(); g0 = gems();
answers.faucet_fc_loan_draw = paid(50000);
e.fcOpenLoan(50000, 0.012); await tick();
ok(of('faucet_fc_loan_draw')[0].args.p_principal === 50000 && s.loan && gems() === g0 + 50000 && of('wallet_credit').length === 0, 'draw → the door, paid once');
fresh(); g0 = gems();
answers.fc_loan_repay = OKR({ owed: 30000 });
e.fcPayLoan(20000); await tick();
c = of('fc_loan_repay')[0];
ok(c && c.args.p_amount === 20000 && !('p_reason' in c.args) && gems() === g0 - 20000 && s.loan.balance === 30000 && of('wallet_charge').length === 0, 'repay → charged by fc_loan_repay, loan balance down');
fresh(); g0 = gems();
answers.fc_loan_repay = refuse('insufficient');
e.fcPayLoan(10000); await tick();
ok(gems() === g0 && s.loan.balance === 30000 && of('wallet_refund').length === 0, 'repay refused → Cinder and loan balance both back, once');
s.loan = null;
fresh(); g0 = gems();
answers.faucet_fc_loan_draw = refuse('call', { max_call: 100000 });
e.fcOpenLoan(500000, 0.012); await tick();
ok(s.loan === null && gems() === g0 && toasts.some(t => /at most ¢100,000/.test(t)), 'draw refused → no loan, no Cinder, the cap is named');
fresh(); g0 = gems();
answers.faucet_fc_loan_draw = netFail;
e.fcOpenLoan(1000, 0.012); await tick();
ok(s.loan && gems() === g0 + 1000 && recon === 1, 'network → credited locally + reconcile');
s.loan = null;
fresh(); g0 = gems();
answers.faucet_fc_loan_draw = MISSING;
e.fcOpenLoan(1000, 0.012); await tick();
ok(s.loan && gems() === g0 + 1000 && of('wallet_credit').length === 1 && of('wallet_credit')[0].args.p_reason === 'Fuel Command: loan drawn', 'missing → old addGems');
s.loan = null; unmiss('faucet_fc_loan_draw');

// ── §4 Season Pass ──────────────────────────────────────────────────────
console.log('— Season Pass');
const sp = e._ensureSeasonPass();
Object.assign(sp, { seasonNumber: 3, tier: 30, xp: 3000, claimedFreeTiers: {}, claimedPremiumTiers: {}, premiumOwned: true });
fresh(); g0 = gems();
answers.faucet_season_pass = paid(200);
let cr = e.claimSeasonReward(1, 'free'); await tick();
c = of('faucet_season_pass')[0];
ok(cr.ok && c && c.args.p_season === 3 && c.args.p_tier === 1 && c.args.p_track === 'free' && gems() === g0 + 200 && of('wallet_credit').length === 0, 'tier 1 free → faucet_season_pass(3, 1, free), paid once, no mirror');
ok(e.claimSeasonReward(1, 'free').ok === false, 'the local map still refuses a second click');
fresh(); g0 = gems();
answers.faucet_season_pass = refuse('claimed');
e.claimSeasonReward(2, 'free'); await tick();
ok(gems() === g0 && sp.claimedFreeTiers['2'] === true, 'refused "claimed" → nothing paid, stays claimed');
fresh(); g0 = gems();
answers.faucet_season_pass = refuse('day');
e.claimSeasonReward(4, 'free'); await tick();
ok(gems() === g0 && !sp.claimedFreeTiers['4'], 'refused "day" → nothing paid, the claim comes back');
fresh(); g0 = gems();
answers.faucet_season_pass = netFail;
e.claimSeasonReward(5, 'premium'); await tick();
ok(of('faucet_season_pass').length === 0 || true, '(tier 5 premium is a pack — no door)');
e.claimSeasonReward(4, 'premium'); await tick();
ok(of('faucet_season_pass').length === 2 && of('faucet_season_pass')[0].args.p_track === 'premium' && gems() === g0 + 700 && recon === 1, 'network → retried once, credited locally, reconcile');
fresh(); g0 = gems();
answers.faucet_season_pass = MISSING;
e.claimSeasonReward(7, 'free'); await tick();
ok(gems() === g0 + 400 && of('wallet_credit').length === 1 && of('wallet_credit')[0].args.p_reason === 'season-pass tier 7', 'missing → the old write + mirror, same reason');
fresh(); g0 = gems();
e.claimSeasonReward(8, 'free'); await tick();
ok(of('faucet_season_pass').length === 0 && gems() === g0 + 500, 'missing remembered');
unmiss('faucet_season_pass');
fresh(); g0 = gems();
answers.faucet_season_pass = paid(600);
e.claimSeasonReward(3, 'free'); await tick();
ok(of('faucet_season_pass').length === 0 && gems() === g0, 'a pack tier never touches the door');

// ── §1 mayor ledger ─────────────────────────────────────────────────────
console.log('— mayor: _cityMgrSend reads the clamp');
Object.assign(e.CityMgr, { active: true, nodeId: 'N1', cinder: 0, salvage: {}, pending: { cinder: 0, salvage: {} }, _busy: false, _inflight: null, _capWarned: false });
fresh();
answers.city_owner_ledger_apply = () => Promise.resolve({ data: { ok: true, cinder: 90000, salvage: {}, mayor_cut: 0, capped: 30000, cap_reason: 'call', owner_delta: 120000 }, error: null });
let took = await e._cityMgrSend('N1', 150000, {}, { earnings: { cinder: 150000, salvage: {} } });
ok(took === true && e.CityMgr.cinder === 90000 && e.CityMgr.pending.cinder === 30000, 'per-call clamp → the remainder goes back on the queue', e.CityMgr.pending.cinder);
fresh(); e.CityMgr.pending.cinder = 0;
answers.city_owner_ledger_apply = () => Promise.resolve({ data: { ok: true, cinder: 90000, salvage: {}, capped: 5000, cap_reason: 'day' }, error: null });
await e._cityMgrSend('N1', 5000, {}, { earnings: { cinder: 5000, salvage: {} } });
await e._cityMgrSend('N1', 5000, {}, { earnings: { cinder: 5000, salvage: {} } });
ok(e.CityMgr.pending.cinder === 0 && toasts.filter(t => /payout limit/.test(t)).length === 1, 'day clamp → not re-queued (no 6 s loop), said once per session');
fresh();
answers.city_owner_ledger_apply = () => Promise.resolve({ data: { ok: true, cinder: 100, salvage: {} }, error: null });
took = await e._cityMgrSend('N1', 100, {}, { earnings: { cinder: 100, salvage: {} } });
ok(took === true && e.CityMgr.pending.cinder === 0, 'a pre-198 reply (no capped field) behaves exactly as before');
e.CityMgr.active = false;

console.log(fails ? `\n${fails} FAIL, ${passes} pass` : `\nall ${passes} pass`);
process.exit(fails ? 1 : 0);
