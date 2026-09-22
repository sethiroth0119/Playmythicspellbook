/* 🔒 AI-CORP TRADES SETTLE ON THE SERVER (sql/191_ai_trade_settle.sql).

   Owner decision: two paid trades per AI corp per UTC day, enforced SERVER-
   side so a modified client cannot skip the allowance _aitrade_smoke pins.
   _aiSpotTrade / _aiDeliver now call the ai_trade_settle RPC instead of
   addGems when it exists. This drives the REAL engine headless with a stub
   RPC and pins the four answers it can get:
     ok       — the server's balance is ADOPTED tax-exempt (a bare
                Profile.gems = x is double-charged, bug-mtyp80rx), no
                addGems/wallet_credit mirror fires, the counter follows `left`;
     limit    — the goods come back EXACTLY once, no Cinder, counter reads 0;
     missing  — sql/191 not applied: the old client-only path pays, once;
     network  — retried once with the SAME ref, then refunded, nothing paid.
   Also: a second click while a settle is in flight does not spend twice, and
   a refused price ('pay') refunds too.

   Run: node _aitradesrv_smoke.mjs */
import { loadEngine, EXPORTS } from './tools/gamedev/headless.mjs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
EXPORTS.push('_aiTradeState', '_aiSpotTrade', '_aiDeliver', '_aiEnterBusiness', '_aiSpotOffer', '_aiContractTerms',
  '_aiTradesLeft', 'AI_TRADE_DAILY', 'AI_CORP_BY_ID', 'getRes', 'addRes');
const e = loadEngine();
const P = e.Profile, S = e.sandbox;
if (typeof e._aiSpotTrade !== 'function') { console.log('  FAIL _aiSpotTrade missing'); process.exit(1); }
const CAP = e.AI_TRADE_DAILY;

// ── a signed-in player with a stub Supabase client ──────────────────────
S.initCloud = () => true;
S.saveProgressCloud = () => Promise.resolve();
P.cloud.signedIn = true; P.cloud.userId = '00000000-0000-0000-0000-000000000001';
let exempt = 0;
const realExempt = S._gemsTaxExempt;
S._gemsTaxExempt = (fn) => { exempt++; return realExempt(fn); };
let calls = [], answer = null;
e.Cloud.client = {
  rpc: (fn, args) => {
    calls.push({ fn, args });
    if (fn !== 'ai_trade_settle') return Promise.resolve({ data: P.gems | 0, error: null });
    return answer(args);
  },
  from: () => { throw new Error('no tables in this smoke'); },
};
const settles = () => calls.filter(c => c.fn === 'ai_trade_settle');
const mirrors = () => calls.filter(c => c.fn === 'wallet_credit');
const fresh = () => { P.aiTrade = {}; calls = []; exempt = 0; };
const corp = Object.keys(e.AI_CORP_BY_ID)[0];
const o = e._aiSpotOffer(corp), terms = e._aiContractTerms(corp);
e.addRes(o.res, 400); if (terms.res !== o.res) e.addRes(terms.res, 400);
const gems = () => P.gems | 0;

console.log('— ok: the server pays and its balance is adopted (' + corp + ')');
fresh();
let g0 = gems(), r0 = e.getRes(o.res);
answer = (a) => Promise.resolve({ data: { ok: true, balance: g0 + a.p_pay, pay: a.p_pay, left: CAP - 1, cap: CAP }, error: null });
await e._aiSpotTrade(corp);
ok(settles().length === 1, 'ai_trade_settle called once', settles().length);
const a0 = settles()[0] && settles()[0].args;
ok(a0 && a0.p_corp === corp && a0.p_kind === 'spot' && a0.p_pay === o.pay && a0.p_qty === o.qty && a0.p_res === o.res,
   'called with the offer the panel showed', JSON.stringify(a0));
ok(a0 && typeof a0.p_ref === 'string' && a0.p_ref.length > 4, 'carries an idempotency ref');
ok(gems() === g0 + o.pay, 'Profile.gems is the server balance', gems() - g0);
ok(exempt >= 1, 'the balance is adopted tax-exempt (bug-mtyp80rx)', exempt);
ok(mirrors().length === 0, 'no addGems → wallet_credit mirror on top (would pay twice)', mirrors().length);
ok(e.getRes(o.res) === r0 - o.qty, 'goods spent once', r0 - e.getRes(o.res));
ok(e._aiTradesLeft(corp) === CAP - 1, 'counter follows the server', e._aiTradesLeft(corp));
ok(e._aiTradeState().spot[corp] != null, 'spot flag set');

console.log('— ok: a delivery on a signed contract');
e._aiEnterBusiness(corp);
const deal = e._aiTradeState().deal[corp];
ok(!!deal, 'contract signed');
g0 = gems(); r0 = e.getRes(terms.res); calls = [];
answer = (a) => Promise.resolve({ data: { ok: true, balance: g0 + a.p_pay, left: 0, cap: CAP }, error: null });
await e._aiDeliver(corp);
ok(settles()[0] && settles()[0].args.p_kind === 'deliver' && settles()[0].args.p_pay === deal.pay, 'deliver settles with the pay the contract was signed at');
ok(gems() === g0 + deal.pay && deal.left === deal.runs - 1, 'paid and the run counted', deal.left);
ok(e.getRes(terms.res) === r0 - terms.qty, 'delivery goods spent once');
ok(e._aiTradesLeft(corp) === 0, 'counter 0 after the second trade');

console.log('— limit: the server refuses although the client thinks a trade is left');
fresh(); e._aiEnterBusiness(corp);
const deal2 = e._aiTradeState().deal[corp];
g0 = gems(); r0 = e.getRes(terms.res);
answer = () => Promise.resolve({ data: { ok: false, reason: 'limit', left: 0, cap: CAP }, error: null });
await e._aiDeliver(corp);
ok(e.getRes(terms.res) === r0, 'goods refunded exactly once', e.getRes(terms.res) - r0);
ok(gems() === g0, 'no Cinder', gems() - g0);
ok(deal2.left === deal2.runs, 'the contract did not advance', deal2.left);
ok(e._aiTradesLeft(corp) === 0, 'local counter synced to the server (0 left)', e._aiTradesLeft(corp));

console.log('— pay: a price the server will not accept is refunded too');
fresh(); g0 = gems(); r0 = e.getRes(o.res);
answer = () => Promise.resolve({ data: { ok: false, reason: 'pay', max_pay: 1, left: CAP, cap: CAP }, error: null });
await e._aiSpotTrade(corp);
ok(e.getRes(o.res) === r0 && gems() === g0, 'goods back, no Cinder');
ok(e._aiTradesLeft(corp) === CAP && e._aiTradeState().spot[corp] == null, 'allowance and spot flag untouched');

console.log('— network: one retry with the SAME ref, then a refund');
fresh(); g0 = gems(); r0 = e.getRes(o.res);
answer = () => Promise.reject(new Error('Failed to fetch'));
await e._aiSpotTrade(corp);
ok(settles().length === 2, 'retried once', settles().length);
ok(settles().length === 2 && settles()[0].args.p_ref === settles()[1].args.p_ref, 'the retry reuses the ref (server dedupes)');
ok(e.getRes(o.res) === r0 && gems() === g0, 'goods back, no Cinder');
ok(e._aiTradesLeft(corp) === CAP, 'allowance untouched');
// an error OBJECT (supabase-js does not throw) is treated the same way
fresh();
answer = () => Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } });
await e._aiSpotTrade(corp);
ok(settles().length === 2 && e.getRes(o.res) === r0 && gems() === g0, 'error object: retried, refunded, unpaid');

console.log('— a second click while settling does not spend twice');
fresh(); g0 = gems(); r0 = e.getRes(o.res);
let release;
answer = (a) => new Promise(res => { release = () => res({ data: { ok: true, balance: g0 + a.p_pay, left: CAP - 1, cap: CAP }, error: null }); });
const first = e._aiSpotTrade(corp);
e._aiSpotTrade(corp);
ok(settles().length === 1 && e.getRes(o.res) === r0 - o.qty, 'second click refused while in flight', settles().length);
if (release) release(); await first;
ok(gems() === g0 + o.pay && e.getRes(o.res) === r0 - o.qty, 'paid once, spent once');

console.log('— missing: sql/191 not applied → the client-only path, once');
fresh(); g0 = gems(); r0 = e.getRes(o.res);
answer = () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.ai_trade_settle' } });
await e._aiSpotTrade(corp);
ok(gems() === g0 + o.pay, 'paid locally via addGems', gems() - g0);
ok(e.getRes(o.res) === r0 - o.qty, 'goods spent once (not refunded, not re-spent)');
ok(mirrors().length === 1, 'the usual wallet_credit mirror fired', mirrors().length);
ok(e._aiTradesLeft(corp) === CAP - 1, 'local allowance spent');
e._aiEnterBusiness(corp); calls = [];
await e._aiDeliver(corp);
ok(settles().length === 0, 'missing is remembered — no second failed round trip', settles().length);
ok(e._aiTradesLeft(corp) === 0, 'local allowance still enforced offline-style');

console.log('— signed out: never calls the server');
fresh(); P.cloud.signedIn = false;
await e._aiSpotTrade(corp);
ok(settles().length === 0, 'no RPC when signed out');

console.log(fails ? `\n${fails} FAIL, ${passes} pass` : `\nall ${passes} pass`);
process.exit(fails ? 1 : 0);
