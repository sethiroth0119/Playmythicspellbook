/* 💰 LUNI SALE-PAY SMOKE — bug-mtyn1mcn.
   "Luni payment bug: 2 lots of water @ 50k c each were sold without payment."

   Measured (read-only, 2026-09-17): Mavric listed 5 × 100 water @ 50,000
   (listing 21609071…). Three sold and were paid (ledger 2105/2167/2189, each a
   seller claim + a 50,000 wallet_ledger credit). Two did NOT sell: ledger 2386
   'expire', 200 units, claimed 09-12 02:47 UTC, announced by the client of the
   day as "💰 Exchange collected: 200 💧 back". Report filed 17:07 the same day.
   The structural way a seller really can go unpaid is the one this closes: the
   client spent the claim and then credited itself through wallet_credit, which
   can refuse/hold and still answer with a balance.

   sql/155_C rl_claim_sale_pay was proven in a rolled-back DO block: wallet
   217,277 -> 267,277 once, a second call claimed:false paid 0, an expire row
   answered fallback, the buyer was refused; nothing persisted.

   This runs the shipped _resSettleEntry with stubs. Negative control: HEAD's
   path, against a wallet_credit that refuses, spends the claim and the server
   balance never moves.
   Run: node _lunisalepay_smoke.mjs */
import { readFileSync } from 'fs';
/* Negative controls read the commit BEFORE the fix (767bf27084), not HEAD: once
   the fix was committed (1f9779cdde) HEAD carries it and the controls went red
   for the wrong reason. PRE_FIX_REF=HEAD shows the pin matters. */
import { execSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const SQL = readFileSync('./sql/155_C_rl_claim_sale_pay.sql', 'utf8');
let HEAD = '';
try { HEAD = execSync('git -c core.eol=lf -c core.autocrlf=false show ' + (process.env.PRE_FIX_REF || '767bf27084') + ':public/index.html', { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) {}
function fnText(src, name, prefix) {
  const i = src.indexOf((prefix || 'function ') + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; } else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

function world(src, { fnMissing = false, rpcError = null, creditRefuses = false } = {}) {
  const S = { server: 100000, claims: new Set(), local: 100000 };
  const Profile = {}; Object.defineProperty(Profile, 'gems', { get: () => S.local, set: (v) => { S.local = v; } });
  const ResMarket = { caps: {}, stuck: [] };
  const Cloud = { client: { rpc: async (fn, a) => {
    if (fn === 'rl_claim_sale_pay') {
      if (fnMissing) return { error: { code: 'PGRST202', message: 'Could not find the function' } };
      if (rpcError) return { error: rpcError };
      if (S.claims.has(a.p_ledger_id)) return { data: { ok: true, claimed: false, paid: 0 } };
      S.claims.add(a.p_ledger_id); S.server += 50000; return { data: { ok: true, claimed: true, paid: 50000, balance: S.server } };
    }
    if (fn === 'rl_claim') { const out = a.p_ids.filter((i) => !S.claims.has(i)); out.forEach((i) => S.claims.add(i)); return { data: out }; }
    return { data: null };
  } } };
  // the old client-leg path: addGems locally + a wallet_credit that may refuse
  const MT = { preflight: () => ({ ok: true }), settleLegs: (legs) => { for (const l of legs) if (l.kind === 'cinder') { S.local += l.n; if (!creditRefuses) S.server += l.n; } return { ok: true }; } };
  const body = [fnText(src, '_resMissing'), fnText(src, '_resEntryLegs'), fnText(src, '_resClaimIds', 'async function '), fnText(src, '_resSettleEntry', 'async function '), 'return _resSettleEntry;'].join('\n');
  const settle = new Function('Profile', 'ResMarket', 'Cloud', '_MT', 'frApplyTax', 'getRes', 'showToast', '_cinderLedgerAdd', 'console', body)(
    Profile, ResMarket, Cloud, () => MT, (g) => ({ net: g, tax: 0 }), () => 0, () => {}, () => {}, { warn() {} });
  return { S, settle, ResMarket };
}
const sale = () => ({ ledger_id: 2105, party: 'seller', kind: 'sale', resource: 'water', currency: 'cinders', units: 100, lots: 1, price_total: 50000 });

console.log('\n=== 1. the migration ===');
ok(/security definer/i.test(SQL) && /me\s+uuid := auth\.uid\(\)/.test(SQL), 'definer, identity from auth.uid()');
ok(/e\.seller_id is distinct from me/.test(SQL), 'only the seller');
ok(/on conflict \(ledger_id, party\) do nothing\s+returning ledger_id into v_got/.test(SQL) && /if v_got is null then/.test(SQL), 'the claim\'s primary key is the idempotence key');
ok(SQL.indexOf('insert into public.resource_trade_claims') < SQL.indexOf('_ct_cinder_give(me, v_amt'), 'claim and credit in the same function (one transaction)');
ok(/e\.kind <> 'sale' or coalesce\(e\.currency, 'cinders'\) <> 'cinders'/.test(SQL), 'cinder sales only; everything else falls back');
ok(/DRAFT — NOT APPLIED/.test(SQL) && /^select p\.oid::regprocedure/m.test(SQL), 'DRAFT, ends with a verify');

console.log('\n=== 2. the client, run ===');
{
  const w = world(SRC);
  const r = await w.settle(sale());
  ok(r.ok && r.serverPaid, 'a cinder sale is paid by the server path');
  ok(w.S.server === 150000 && w.S.local === 150000, 'server and local both +50,000, once', w.S.server + '/' + w.S.local);
  const r2 = await w.settle(sale());
  ok(!r2.ok && w.S.server === 150000, 'a second collect pays nothing');
}
{
  const w = world(SRC, { fnMissing: true });
  const r = await w.settle(sale());
  ok(r.ok && w.ResMarket.caps.salePay === false && w.S.server === 150000, 'function missing -> the old path pays (and remembers it is missing)');
}
{
  const w = world(SRC, { rpcError: { code: '57014', message: 'statement timeout' } });
  const r = await w.settle(sale());
  ok(!r.ok && r.deferred && !w.S.claims.has(2105), 'any other error: nothing claimed, row still waiting');
}
{
  const w = world(SRC);
  const r = await w.settle({ ledger_id: 2386, party: 'seller', kind: 'expire', resource: 'water', units: 200, currency: 'cinders' });
  ok(r.ok && w.S.server === 100000, 'an expiry still returns goods through the old path, no Cinder moves');
}

console.log('\n=== 3. negative control: HEAD against a refusing wallet_credit ===');
{
  const w = world(HEAD, { creditRefuses: true });
  const r = await w.settle(sale());
  ok(r.ok && w.S.claims.has(2105) && w.S.server === 100000 && w.S.local === 150000,
     'HEAD: claim spent, Cinder only in the local wallet, server unpaid (the next refresh takes it back)', w.S.server + '/' + w.S.local);
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
