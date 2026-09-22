/* 🧾 WEBSITE-PURCHASE RECEIPTS ARE WRITTEN AS ONE KEY (sql/195).

   redeemWebPurchases() used to mark receipts applied with
       update user_profiles set forge = { webPurchases: [...] }
   which REPLACED the whole forge column (~80 synced keys) with one key.
   This drives the REAL functions out of public/index.html against a stub
   Supabase client and pins:
     1. with sql/195 applied: the write is the web_purchases_set RPC and the
        forge column is never written directly;
     2. without it (RPC missing): read → merge ONE key → write, and the written
        forge still carries every stored key; the write is conditional on the
        row being unchanged since the read (updated_at);
     3. RPC missing and the read fails: nothing is written at all;
     4. an unrelated RPC error (not "missing"): nothing is written directly.
   On the pre-fix file check 1 and 2 fail (a one-key forge is written).

   Run: node _webpurchases_smoke.mjs      (WP_FILE=<html> to run another copy) */
import vm from 'node:vm';
import { loadEngine, INDEX } from './tools/gamedev/headless.mjs';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x));
  if (c) passes++; else fails++;
};
const FILE = process.env.WP_FILE || INDEX;
const tick = () => new Promise((r) => setTimeout(r, 30));

const STORED = { __cardCollection__: { c1: 2 }, __itemInventory__: { i1: 1 }, __salvage__: { metal: 5 },
                 __equipment__: { e: 1 }, __vaultLayout__: [1, 2], webPurchases: [{ packId: 'nope' }] };

function world(rpcMode, readFails) {
  const e = loadEngine({ file: FILE });
  const run = (s) => vm.runInContext(s, e.sandbox);
  run(`
    var __calls = [];
    var __stored = ${JSON.stringify(STORED)};
    var __rpcMode = ${JSON.stringify(rpcMode)}, __readFails = ${!!readFails};
    const __q = (tbl) => { const st = { tbl, op: null, payload: null, eqs: [] }; const q = {
      select(cols) { st.op = st.op || 'select'; st.cols = cols; return q; },
      update(p) { st.op = 'update'; st.payload = p; return q; },
      eq(k, v) { st.eqs.push([k, v]);
        if (st.op === 'update' && st.eqs.length >= 1) { /* resolved on then */ }
        return q; },
      maybeSingle() { __calls.push({ tbl, op: 'select', eqs: st.eqs.slice() });
        return Promise.resolve(__readFails ? { data: null, error: { message: 'boom' } }
                                           : { data: { forge: __stored, updated_at: '2026-09-22T10:00:00Z' }, error: null }); },
      then(res, rej) { __calls.push({ tbl, op: st.op, payload: st.payload, eqs: st.eqs.slice() });
        return Promise.resolve({ data: null, error: null }).then(res, rej); },
    }; return q; };
    Cloud.client = {
      from: (t) => __q(t),
      rpc: (fn, args) => { __calls.push({ rpc: fn, args });
        if (__rpcMode === 'ok') return Promise.resolve({ data: true, error: null });
        if (__rpcMode === 'missing') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.web_purchases_set' } });
        return Promise.resolve({ data: null, error: { code: 'XX000', message: 'internal' } }); },
      auth: {},
    };
    Profile.cloud = Profile.cloud || {}; Profile.cloud.userId = 'u1'; Profile.cloud.signedIn = true;
    redeemWebPurchases([{ packId: 'nope' }]);
  `);
  return { run, calls: () => JSON.parse(run('JSON.stringify(__calls)')) };
}
const forgeWrites = (calls) => calls.filter((c) => c.tbl === 'user_profiles' && c.op === 'update' && c.payload && 'forge' in c.payload);

console.log('1. sql/195 applied → the RPC, never a direct forge write');
{
  const w = world('ok'); await tick(); const c = w.calls();
  const rpc = c.find((x) => x.rpc === 'web_purchases_set');
  ok(!!rpc, 'web_purchases_set was called');
  ok(rpc && Array.isArray(rpc.args.p_list) && rpc.args.p_list[0].applied === true, 'with the applied-marked receipt list', JSON.stringify(rpc && rpc.args));
  ok(forgeWrites(c).length === 0, 'the forge column was not written directly', JSON.stringify(forgeWrites(c)));
}

console.log('2. RPC missing → one key merged into the stored forge, conditionally');
{
  const w = world('missing'); await tick(); const c = w.calls();
  const fw = forgeWrites(c);
  ok(fw.length === 1, 'exactly one forge write', String(fw.length));
  const f = fw[0] && fw[0].payload.forge;
  const lost = Object.keys(STORED).filter((k) => k !== 'webPurchases' && !(f && k in f));
  ok(!!f && lost.length === 0, 'every stored forge key is still in the write', lost.join(', ') || JSON.stringify(f));
  ok(!!f && Array.isArray(f.webPurchases) && f.webPurchases[0].applied === true, 'webPurchases carries the applied mark');
  ok(!!fw[0] && fw[0].eqs.some(([k, v]) => k === 'updated_at' && v === '2026-09-22T10:00:00Z'),
     'the write only lands if the row is unchanged since the read (updated_at)', JSON.stringify(fw[0] && fw[0].eqs));
}

console.log('3. RPC missing and the read fails → nothing written');
{
  const w = world('missing', true); await tick();
  ok(forgeWrites(w.calls()).length === 0, 'no forge write when the current row could not be read');
}

console.log('4. an unrelated RPC error → no direct forge write');
{
  const w = world('error'); await tick();
  ok(forgeWrites(w.calls()).length === 0, 'a server error is not treated as "RPC missing"');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
