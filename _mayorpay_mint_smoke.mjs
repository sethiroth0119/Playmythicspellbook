/* 🔥 NODE MANAGER HIRING PAY CANNOT MINT CINDER (sql/148, draft).

   The hole, measured on the live database 2026-09-17 (rolled-back DO block):
     · city_set_mayor (SECURITY DEFINER) inserted a city_mayor_pay row for
       least(100000, p_pay) with NO wallet debit. The 500 fee was spendGems'd
       on the client in a separate step the server never saw, so a console call
       naming yourself with p_pay 100000 was a 100,000 Cinder faucet. (It is
       only dormant today because its ON CONFLICT (user_id) no longer matches
       city_state's (user_id, node_id) key and every call raises — fixing that
       line alone would have reopened it.)
     · _mayorPayClaim read the rows, UPDATEd claimed = true itself and called
       addCinders(total) with a total it added up. The cmp_upd policy that let
       it do that equally let the payee set claimed back to FALSE — measured:
       the un-claim UPDATE flipped a real row — so the same pay could be
       claimed forever.

   sql/148 makes the fee an escrow (debited by _ct_cinder_take inside the RPC,
   row marked funded), makes claiming a definer RPC that marks and credits in
   one transaction, and removes every client write on the table. Proven live
   inside a rolled-back DO block: self-hire refused, a real hire moved −500 /
   +500 with ledger net 0, second claim 0, client INSERT/UPDATE denied, the
   legacy unfunded rows unclaimable; city_mayor_pay still 5 rows / 2,500 after.

   This suite cannot reach Postgres, so it guards what silently undoes that:
     A · the migration drifts (debit removed or moved after the insert, the
         `not claimed` / `funded` guard dropped, a write policy or grant back,
         the file stops being idempotent, the verify block goes).
     B · the client drifts: it is DRIVEN (the real cityMayorSet /
         _mayorPayClaim lifted out of index.html, run in a vm against a fake
         148 server, a fake pre-148 server, offline, and a network error).
         On a 148 server it must never spendGems, never addCinders, and only
         adopt what the server returned.
     N · NEGATIVE CONTROLS: the LIVE function and policy text, HEAD's client,
         and eight SQL + two client mutants must each be caught.

   Run: node _mayorpay_mint_smoke.mjs */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import vm from 'vm';
import * as acorn from 'acorn';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x));
  if (c) passes++; else fails++;
};

const SQL = readFileSync('./sql/148_mayor_hiring_pay_ledger.sql', 'utf8');
const INDEX = readFileSync('./public/index.html', 'utf8');

/* ── A · the migration ─────────────────────────────────────────────────── */
const stripComments = (t) => t.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
function fnBody(t, name) {
  const re = new RegExp('create\\s+(or\\s+replace\\s+)?function\\s+public\\.' + name + '\\s*\\(', 'i');
  const m = re.exec(t);
  if (!m) return null;
  const a = t.indexOf('$$', m.index);
  const b = a < 0 ? -1 : t.indexOf('$$', a + 2);
  return (a < 0 || b < 0) ? null : { head: t.slice(m.index, a), body: t.slice(a + 2, b), at: m.index };
}
function sqlChecks(raw) {
  const t = stripComments(raw);
  const low = t.toLowerCase();
  const out = [];
  const add = (c, m) => out.push([!!c, m]);
  add(/^\s*begin\s*;/m.test(low) && /^\s*commit\s*;/m.test(low), 'A1 one transaction (begin; … commit;)');
  add(/add\s+column\s+if\s+not\s+exists\s+funded\s+boolean\s+not\s+null\s+default\s+false/.test(low), 'A2 funded column, idempotent, defaults false (old rows never claimable)');
  add(/drop\s+policy\s+if\s+exists\s+cmp_upd\s+on\s+public\.city_mayor_pay/.test(low), 'A3 cmp_upd (the un-claim policy) is dropped');
  const pols = [...low.matchAll(/create\s+policy\s+(\w+)\s+on\s+public\.city_mayor_pay([\s\S]*?);/g)];
  add(pols.length >= 1 && pols.every((p) => /for\s+select/.test(p[2])), 'A4 only SELECT policies are created on city_mayor_pay', pols.map((p) => p[1]).join(','));
  add(pols.length >= 1 && pols.every((p) => /user_id\s*=\s*auth\.uid\(\)/.test(p[2]) && !/\btrue\b/.test(p[2])), 'A5 every policy is own-rows (user_id = auth.uid()), never true');
  add(pols.every((p) => { const d = low.indexOf('drop policy if exists ' + p[1] + ' on public.city_mayor_pay'); return d >= 0 && d < p.index; }), 'A6 every create policy is preceded by its drop policy if exists');
  const rv = /revoke\s+([^;]*?)\s+on\s+public\.city_mayor_pay\s+from\s+([^;]*);/.exec(low);
  add(!!rv && /\binsert\b/.test(rv[1]) && /\bupdate\b/.test(rv[1]) && /\bdelete\b/.test(rv[1]) && /\banon\b/.test(rv[2]) && /\bauthenticated\b/.test(rv[2]), 'A7 INSERT/UPDATE/DELETE revoked from anon and authenticated');
  add(!/grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*on\s+(table\s+)?public\.city_mayor_pay/.test(low), 'A8 no write grant on city_mayor_pay comes back');

  const sm = fnBody(low, 'city_set_mayor');
  const b = sm ? sm.body : '';
  add(!!sm && /security\s+definer/.test(sm.head) && /set\s+search_path/.test(sm.head), 'A9 city_set_mayor is SECURITY DEFINER with a pinned search_path');
  const take = b.search(/_ct_cinder_take\s*\(\s*v_uid\s*,\s*v_amt\s*,/);
  const ins = b.search(/insert\s+into\s+public\.city_mayor_pay/);
  add(take >= 0 && ins >= 0 && take < ins, 'A10 the fee is debited from the CALLER (_ct_cinder_take(v_uid, v_amt)) BEFORE the pay row is written', 'take@' + take + ' insert@' + ins);
  add(/values\s*\(\s*p_mayor_id\s*,\s*v_amt\s*,[\s\S]*?,\s*true\s*\)\s*returning/.test(b) && /\(\s*user_id\s*,\s*amount\s*,\s*from_name\s*,\s*funded\s*\)/.test(b), 'A11 the row pays exactly the debited v_amt and is marked funded');
  add(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/.test(b) && /if\s+v_uid\s+is\s+null\s+then\s+raise/.test(b), 'A12 no session → refused');
  add(/if\s+p_mayor_id\s*=\s*v_uid\s+then\s+raise/.test(b), 'A13 hiring yourself → refused');
  add(/from\s+auth\.users/.test(b) && /no such player/.test(b), 'A14 payee must be a real account');
  add(/if\s+p_node_id\s+is\s+null\s+then\s+raise/.test(b) && /c\.user_id\s*=\s*v_uid\s+and\s+c\.node_id\s*=\s*p_node_id/.test(b), 'A15 paid hire must name a city the CALLER owns');
  add(/v_prev\s+is\s+not\s+distinct\s+from\s+p_mayor_id\s+then\s+raise/.test(b), 'A16 re-appointing the seated manager is refused (no second fee)');
  add(!/on\s+conflict\s*\(\s*user_id\s*\)/.test(b) && !/insert\s+into\s+public\.city_state/.test(b), 'A17 no city_state upsert on (user_id) — the key is (user_id, node_id)');
  add(/least\s*\(\s*100000\s*,\s*greatest\s*\(\s*0/.test(b), 'A18 amount clamped to 0..100000');
  add(/where\s+c\.user_id\s*=\s*v_uid/.test(b.slice(b.search(/update\s+public\.city_state/))), 'A19 the appointment only ever writes the caller\'s own rows');
  const d4 = low.indexOf('drop function if exists public.city_set_mayor(uuid, text, integer, text);');
  const d5 = low.indexOf('drop function if exists public.city_set_mayor(uuid, text, integer, text, text);');
  add(!!sm && (/or\s+replace/.test(sm.head) || (d4 >= 0 && d5 >= 0 && d4 < sm.at && d5 < sm.at)), 'A20 city_set_mayor re-creatable (both signatures dropped first)');

  const cl = fnBody(low, 'city_mayor_pay_claim');
  const c = cl ? cl.body : '';
  add(!!cl && /security\s+definer/.test(cl.head) && /set\s+search_path/.test(cl.head), 'A21 city_mayor_pay_claim is SECURITY DEFINER with a pinned search_path');
  const w = /update\s+public\.city_mayor_pay\s+p\s+set\s+claimed\s*=\s*true\s+where([\s\S]*?)returning/.exec(c);
  add(!!w && /p\.user_id\s*=\s*v_uid/.test(w[1]) && /\bnot\s+p\.claimed\b/.test(w[1]) && /\bp\.funded\b/.test(w[1]), 'A22 claim marks ONLY the caller\'s own, funded, still-unclaimed rows', w ? w[1].trim() : 'no update');
  add(/select\s+coalesce\s*\(\s*sum\s*\(\s*amount\s*\)\s*,\s*0\s*\)/.test(c) && /from\s+c\s*;/.test(c), 'A23 the credited total is the sum of exactly the rows this call marked');
  add(/_ct_cinder_give\s*\(\s*v_uid\s*,\s*v_total\s*,/.test(c) && /if\s+v_total\s*<=\s*0\s+then\s+return/.test(c), 'A24 credits v_total to the caller server-side; nothing marked → nothing credited');
  add(/'credit_cinder'\s*,\s*v_total/.test(c), 'A25 returns the credited figure for the client to adopt');
  add(/if\s+v_uid\s+is\s+null\s+then\s+raise/.test(c), 'A26 claim with no session → refused');
  add(/revoke\s+all\s+on\s+function\s+public\.city_set_mayor\(uuid, text, integer, text, text\)\s+from\s+public,\s*anon/.test(low)
      && /revoke\s+all\s+on\s+function\s+public\.city_mayor_pay_claim\(\)\s+from\s+public,\s*anon/.test(low)
      && /grant\s+execute\s+on\s+function\s+public\.city_mayor_pay_claim\(\)\s+to\s+authenticated/.test(low), 'A27 execute revoked from anon/public, granted to authenticated');
  // No data statement outside a function body (an RLS/DDL-only file).
  const noBodies = low.replace(/\$\$[\s\S]*?\$\$/g, '');
  const verifyAt = raw.toLowerCase().lastIndexOf('-- --- verify');
  const ddl = stripComments(raw.slice(0, verifyAt < 0 ? raw.length : verifyAt)).toLowerCase().replace(/\$\$[\s\S]*?\$\$/g, '');
  add(!/^\s*(update|delete\s+from|insert\s+into|truncate)\b/m.test(ddl), 'A28 no data statement outside the functions');
  add(verifyAt > 0 && /^\s*select\b/m.test(raw.slice(verifyAt)) && /historical_sum_expect_2500/.test(raw.slice(verifyAt)) && /client_update_f/.test(raw.slice(verifyAt)), 'A29 ends with a verify query (grants, policies, historical rows)');
  add((noBodies.match(/security\s+definer/g) || []).length === (noBodies.match(/set\s+search_path/g) || []).length, 'A30 every definer function pins search_path');
  return out;
}

console.log('\nA · sql/148 as written');
for (const [c, m] of sqlChecks(SQL)) ok(c, m);

/* ── B · the client, driven ────────────────────────────────────────────── */
function lift(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const at = src.indexOf(marker.startsWith('window.') ? 'async function' : marker, i);
  const node = acorn.parseExpressionAt(src, at, { ecmaVersion: 'latest' });
  return src.slice(node.start, node.end);
}
function sources(src) {
  return {
    set: lift(src, 'window.cityMayorSet = async function'),
    claim: lift(src, 'async function _mayorPayClaim()'),
    missing: lift(src, 'function _jbRpcMissing(err)'),
  };
}

const PGRST202 = { code: 'PGRST202', message: 'Could not find the function public.city_set_mayor(p_from, p_mayor_id, p_mayor_name, p_node_id, p_pay) in the schema cache' };
function server148() {
  let claimed = false;
  return {
    rpc(n, a) {
      if (n === 'city_set_mayor') {
        if (!('p_node_id' in a) && a.p_pay > 0) return { data: null, error: { code: 'P0001', message: 'which city? a paid hire must name the node' } };
        if (a.p_mayor_id === 'u-a') return { data: null, error: { code: 'P0001', message: 'you cannot hire yourself' } };
        if (a.p_mayor_id === 'u-poor') return { data: null, error: { code: 'P0001', message: 'not enough Cinder' } };
        if (a.p_mayor_id === 'u-ghost') return { data: null, error: { code: 'P0001', message: 'no such player' } };
        if (!a.p_mayor_id) return { data: { ok: true, paid: 0, cities: 1 }, error: null };
        return { data: { ok: true, paid: 500, pay_id: 'p1', cinder: 4500, wallet_seq: 9 }, error: null };
      }
      if (n === 'city_mayor_pay_claim') {
        if (claimed) return { data: { claimed: 0, rows: 0 }, error: null };
        claimed = true;
        return { data: { claimed: 500, rows: 1, from_name: 'Ay', credit_cinder: 500, balance: 1500 }, error: null };
      }
      return { data: null, error: PGRST202 };
    },
    from(t, ops) {
      if (ops.includes('update')) return { data: null, error: { code: '42501', message: 'permission denied for table city_mayor_pay' } };
      return { data: [{ id: 1, amount: 500, from_name: 'Ay' }], error: null };
    },
  };
}
function serverOld() {
  return {
    rpc(n, a) {
      if (n === 'city_set_mayor') return ('p_node_id' in a) ? { data: null, error: PGRST202 } : { data: null, error: null };
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + n + ' without parameters in the schema cache' } };
    },
    from(t, ops) { return ops.includes('update') ? { data: null, error: null } : { data: [{ id: 1, amount: 500, from_name: 'Ay' }], error: null }; },
  };
}
function serverDown() {
  return {
    rpc() { return { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }; },
    from() { return { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }; },
  };
}

function makeEnv(src, server, opt = {}) {
  const calls = { spend: 0, add: [], adopt: [], rpc: [], from: [] };
  const toasts = [];
  const ctx = {
    console, Date, Math, Number, String, Promise, Array, JSON, Object,
    toasts, calls,
    showToast: (m) => toasts.push(String(m)),
    spendGems: (n) => { calls.spend += n; return true; },
    spendCinders: (n) => { calls.spend += n; return true; },
    addCinders: (n) => { calls.add.push(n); },
    _jbTradeAdopt: (r) => { calls.adopt.push(JSON.parse(JSON.stringify(r))); },
    searchPlayers: async () => [opt.pick || { userId: 'u-b', name: 'Bee' }],
    _campRegName: () => 'Ay',
    Profile: { gems: opt.gems == null ? 5000 : opt.gems, cloud: { signedIn: true, userId: 'u-a', displayName: 'Ay' } },
    App: { _cityNodeId: 'N-49' },
    Cloud: {
      ready: opt.offline ? false : true,
      client: {
        rpc: async (n, a) => { calls.rpc.push([n, a || {}]); return server.rpc(n, a || {}); },
        from: (t) => {
          const ops = [];
          const q = {
            select() { ops.push('select'); return q; }, eq() { return q; }, in() { return q; }, limit() { return q; },
            update(v) { ops.push('update'); calls.from.push([t, 'update', v]); return q; },
            then(res, rej) { return Promise.resolve(server.from(t, ops)).then(res, rej); },
          };
          return q;
        },
      },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const s = sources(src);
  vm.runInContext('const MAYOR_HIRE_FEE = 500;\n' + (s.missing || '') + '\n' + s.claim + '\nwindow.cityMayorSet = ' + s.set + ';\nwindow.__claim = _mayorPayClaim;', ctx);
  return ctx;
}

async function clientChecks(src) {
  const out = [];
  const add = (c, m, x) => out.push([!!c, m, x]);
  const s = sources(src);
  add(!!(s.set && s.claim && s.missing), 'B0 cityMayorSet, _mayorPayClaim and _jbRpcMissing lifted from index.html');
  if (!(s.set && s.claim && s.missing)) return out;

  // 148 server — appoint
  let e = makeEnv(src, server148());
  let r = await e.cityMayorSet('Bee');
  const hire = e.calls.rpc.find((x) => x[0] === 'city_set_mayor');
  add(r && r.mayorId === 'u-b', 'B1 148: the appointment succeeds', JSON.stringify(r));
  add(e.calls.spend === 0, 'B2 148: no local spendGems (the server already debited — a local spend is a second charge)', e.calls.spend);
  add(e.calls.add.length === 0, 'B3 148: no addCinders', JSON.stringify(e.calls.add));
  add(e.calls.adopt.length === 1 && e.calls.adopt[0].cinder === 4500 && e.calls.adopt[0].wallet_seq === 9, 'B4 148: adopts exactly the balance + wallet_seq the server returned', JSON.stringify(e.calls.adopt));
  add(hire && hire[1].p_node_id === 'N-49' && hire[1].p_pay === 500, 'B5 148: the paid call names the open city (p_node_id)', hire && JSON.stringify(hire[1]));
  add(e.calls.rpc.filter((x) => x[0] === 'city_set_mayor').length === 1, 'B6 148: exactly one RPC (no legacy retry)');

  // 148 server — refusals
  e = makeEnv(src, server148(), { pick: { userId: 'u-a', name: 'Ay' } });
  r = await e.cityMayorSet('Ay');
  add(r == null && e.calls.spend === 0 && e.calls.adopt.length === 0 && e.calls.add.length === 0, 'B7 self-hire: nothing charged, nothing credited', JSON.stringify(e.calls));
  e = makeEnv(src, server148(), { pick: { userId: 'u-poor', name: 'Poor' } });
  r = await e.cityMayorSet('Poor');
  add(r == null && e.calls.spend === 0 && e.calls.add.length === 0 && e.calls.adopt.length === 0 && e.toasts.some((t) => /costs 500 .*not enough Cinder/.test(t)), 'B8 short wallet (the server refuses): no charge, no credit, the cost toast', JSON.stringify(e.toasts));
  e = makeEnv(src, server148(), { pick: { userId: 'u-ghost', name: 'Ghost' } });
  r = await e.cityMayorSet('Ghost');
  add(r == null && e.calls.spend === 0 && e.calls.adopt.length === 0 && e.calls.add.length === 0 && e.toasts.some((t) => /No Cinder was taken/.test(t)), 'B9 server refusal: no spend, no refund-mint, says nothing was taken', JSON.stringify(e.toasts));

  // 148 server — claim
  e = makeEnv(src, server148());
  await e.__claim();
  add(e.calls.adopt.length === 1 && e.calls.adopt[0].credit_cinder === 500 && e.calls.adopt[0].cinder === undefined, 'B10 claim: adopts the server\'s credit_cinder as a credit leg', JSON.stringify(e.calls.adopt));
  add(e.calls.add.length === 0, 'B11 claim: never addCinders with a client-computed total', JSON.stringify(e.calls.add));
  add(e.calls.from.length === 0, 'B12 claim: never UPDATEs city_mayor_pay itself', JSON.stringify(e.calls.from));
  add(e.toasts.some((t) => /\+500/.test(t)), 'B13 claim: toast shows the server figure');
  await e.__claim();
  add(e.calls.rpc.filter((x) => x[0] === 'city_mayor_pay_claim').length === 1, 'B14 claim: the 5-minute throttle holds');
  e.App._mayorPayAt = 0;
  await e.__claim();
  add(e.calls.rpc.filter((x) => x[0] === 'city_mayor_pay_claim').length === 2 && e.calls.adopt.length === 1 && e.calls.add.length === 0, 'B15 second claim returns 0 → nothing credited');

  // pre-148 server — the legacy path still works
  e = makeEnv(src, serverOld());
  r = await e.cityMayorSet('Bee');
  add(r && r.mayorId === 'u-b' && e.calls.spend === 500, 'B16 pre-148: legacy appoint still charges locally and appoints', JSON.stringify(e.calls));
  e = makeEnv(src, serverOld());
  await e.__claim();
  add(e.calls.from.length === 1 && e.calls.add.length === 1 && e.calls.add[0] === 500, 'B17 pre-148: legacy claim still pays', JSON.stringify(e.calls));

  // offline, network error
  e = makeEnv(src, server148(), { offline: true });
  r = await e.cityMayorSet('Bee'); await e.__claim();
  add(r == null && e.calls.rpc.length === 0 && e.calls.spend === 0 && e.calls.add.length === 0, 'B18 offline: no call, no money');
  e = makeEnv(src, serverDown());
  r = await e.cityMayorSet('Bee');
  add(r == null && e.calls.spend === 0 && e.calls.add.length === 0 && e.calls.adopt.length === 0, 'B19 network error on appoint: nothing charged or credited', JSON.stringify(e.calls));
  e = makeEnv(src, serverDown());
  await e.__claim();
  add(e.calls.add.length === 0 && e.calls.adopt.length === 0 && e.calls.from.length === 0, 'B20 network error on claim: nothing credited, no client write', JSON.stringify(e.calls));

  // 148 server, a legacy-shaped client call is not a way around the debit
  add(!/addCinders\s*\(\s*total\s*\)/.test(s.claim.slice(0, s.claim.indexOf('legacy: sql/148 not applied'))), 'B21 no addCinders(total) before the legacy marker');
  return out;
}

console.log('\nB · the client, driven');
for (const [c, m, x] of await clientChecks(INDEX)) ok(c, m, x);

/* ── N · negative controls ─────────────────────────────────────────────── */
console.log('\nN · negative controls (each must be CAUGHT)');
const caught = (label, checks) => {
  const bad = checks.filter((x) => !x[0]).map((x) => x[1].split(' ')[0]);
  ok(bad.length > 0, 'N ' + label + ' caught' + (bad.length ? ' by ' + bad.join(',') : ''), 'NOT caught');
};

// The LIVE definition (pg_get_functiondef, 2026-09-17) + the live cmp_upd policy.
const LIVE = `begin;
create policy cmp_upd on public.city_mayor_pay for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cmp_sel on public.city_mayor_pay for select to authenticated using (user_id = auth.uid());
grant insert, update, delete, select on public.city_mayor_pay to anon, authenticated;
CREATE OR REPLACE FUNCTION public.city_set_mayor(p_mayor_id uuid, p_mayor_name text, p_pay integer DEFAULT 0, p_from text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  insert into public.city_state (user_id, mayor_id, mayor_name)
  values (auth.uid(), p_mayor_id, p_mayor_name)
  on conflict (user_id) do update
    set mayor_id = excluded.mayor_id,
        mayor_name = excluded.mayor_name,
        updated_at = now();
  if p_mayor_id is not null and coalesce(p_pay, 0) > 0 then
    insert into public.city_mayor_pay (user_id, amount, from_name)
    values (p_mayor_id, least(100000, p_pay), p_from);
  end if;
end $$;
commit;`;
{
  const live = sqlChecks(LIVE);
  const bad = live.filter((x) => !x[0]).map((x) => x[1].split(' ')[0]);
  ok(['A3', 'A4', 'A8', 'A10', 'A11', 'A13', 'A17'].every((k) => bad.includes(k)), 'N the LIVE function + policy are caught as minting (' + bad.join(',') + ')');
}
const mut = (label, from, to) => {
  if (!SQL.includes(from)) { ok(false, 'N mutant ' + label + ': anchor missing in sql/148', from); return; }
  caught('SQL mutant ' + label, sqlChecks(SQL.replace(from, to)));
};
mut('debit removed', "  v_take := public._ct_cinder_take(v_uid, v_amt, 'Node Manager hiring pay (escrow)');\n", "  v_take := '{}'::jsonb;\n");
mut('debit after insert', "  v_take := public._ct_cinder_take(v_uid, v_amt, 'Node Manager hiring pay (escrow)');\n\n  insert into public.city_mayor_pay (user_id, amount, from_name, funded)\n  values (p_mayor_id, v_amt, left(coalesce(p_from, ''), 60), true)\n  returning id into v_id;\n",
    "  insert into public.city_mayor_pay (user_id, amount, from_name, funded)\n  values (p_mayor_id, v_amt, left(coalesce(p_from, ''), 60), true)\n  returning id into v_id;\n  v_take := public._ct_cinder_take(v_uid, v_amt, 'Node Manager hiring pay (escrow)');\n");
mut('re-claim (not claimed dropped)', 'and not p.claimed ', '');
mut('unfunded rows claimable', 'and p.funded ', '');
mut('update policy back', 'grant select on public.city_mayor_pay to authenticated;', 'grant select on public.city_mayor_pay to authenticated;\ncreate policy cmp_upd on public.city_mayor_pay for update to authenticated using (user_id = auth.uid());');
mut('write grants kept', 'revoke insert, update, delete, truncate, references, trigger on public.city_mayor_pay from anon, authenticated;', '');
mut('double credit', 'public._ct_cinder_give(v_uid, v_total,', 'public._ct_cinder_give(v_uid, v_total * 2,');
mut('self-hire allowed', "if p_mayor_id = v_uid then raise exception 'you cannot hire yourself'; end if;", '');

// HEAD's client (the shipped one) must fail the drive.
/* Pinned, not HEAD: once the fix is committed HEAD carries it and the control goes vacuous. 3fd3156dc5 is the last client before it (same pin as _corpmembership_smoke). */ const PRE_FIX_REF = process.env.PRE_FIX_REF || '3fd3156dc5';
let head = null;
try { head = execFileSync('git', ['-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'show', PRE_FIX_REF + ':public/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { head = null; }
if (head && !head.includes('city_mayor_pay_claim')) caught("HEAD's client (spendGems + addCinders(total))", await clientChecks(head));
else ok(false, 'N HEAD client available and pre-148', head ? 'HEAD already has the claim RPC — pick an older control' : 'git show failed');

const cmut = async (label, from, to) => {
  if (!INDEX.includes(from)) { ok(false, 'N client mutant ' + label + ': anchor missing', from); return; }
  caught('client mutant ' + label, await clientChecks(INDEX.replace(from, to)));
};
await cmut('claim credits with addCinders', "_jbTradeAdopt({ credit_cinder: got })", 'addCinders(got)');
await cmut('appoint also spends locally', "      const d = rs.data;\n", "      const d = rs.data;\n      spendGems(MAYOR_HIRE_FEE);\n");

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURES' : '✅ mayor hiring pay: ' + passes + ' passes'));
process.exit(fails ? 1 : 0);
