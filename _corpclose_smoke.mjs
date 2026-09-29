/* 💰 CORP CLOSE-WITHDRAW SMOKE — bug-mu17gpcz.
   "A request for a button to withdraw any Cinder from the Corporate Treasury to
   their Wallet when closing down a Corporation."

   The money moves on the SERVER (sql/152_C_corp_close_withdraw.sql, a DRAFT):
   founder-only, corporation row locked, balance = sum(corp_treasury.amount),
   ONE negative ledger row for the whole balance, the founder credited
   floor(balance) through _ct_cinder_give — in one function, one transaction.
   Proven live inside a rolled-back DO block on 2026-09-17: treasury
   71,193 -> 0, founder wallet +71,193 exactly, a member refused, nothing
   persisted (pg_proc and corp_treasury re-read clean afterwards).

   This suite pins the migration's invariants and the client handler, and runs
   the client's decision (confirm -> withdraw -> dissolve, legacy on missing
   function) against stubs. Negative control: the handler as it stood at HEAD
   never offers the withdrawal.
   Run: node _corpclose_smoke.mjs */
import { readFileSync } from 'fs';
/* Negative controls read the commit BEFORE the fix (767bf27084), not HEAD: once
   the fix was committed (1f9779cdde) HEAD carries it and the controls went red
   for the wrong reason. PRE_FIX_REF=HEAD shows the pin matters. */
import { execSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (c) passes++; else fails++; };

const SQL = readFileSync('./sql/152_C_corp_close_withdraw.sql', 'utf8');
const SRC = readFileSync('./public/index.html', 'utf8');
const body = (() => { const a = SQL.indexOf('create or replace function public.corp_close_withdraw'); return SQL.slice(a, SQL.indexOf('end $$;', a)); })();
const code = body.replace(/--[^\n]*/g, '');

console.log('\n=== 1. the migration ===');
ok(/security definer/i.test(code), 'SECURITY DEFINER');
ok(/v_uid\s+uuid := auth\.uid\(\)/.test(code), 'identity is auth.uid(), never a parameter');
ok(/where id = p_corp_id and founder_id = v_uid\s+for update/.test(code), 'founder check and row lock in one statement');
ok(/sum\(amount\)[\s\S]*from corp_treasury where corp_id = p_corp_id/.test(code), 'balance = sum(corp_treasury.amount)');
ok((code.match(/insert into corp_treasury/g) || []).length === 1, 'exactly ONE ledger row appended');
ok(/values \(p_corp_id, v_uid, -v_bal, 'close_withdraw'/.test(code), '…for the WHOLE numeric balance (no dust left for corp_dissolve to refuse over)');
ok(/v_give := floor\(v_bal\)::bigint/.test(code) && /_ct_cinder_give\(v_uid, v_give,/.test(code), 'the wallet gets floor(balance) via _ct_cinder_give — never rounded up, nothing minted');
ok(!/\bupdate\s+corp_treasury\b|\bdelete\s+from\s+corp_treasury\b/i.test(code), 'append-only: no UPDATE/DELETE of corp_treasury');
ok(/if v_bal <= 0 then\s+return/.test(code), 'a zero / negative treasury writes nothing');
ok(!/ref_id/.test(code), 'writes no ref_id, so it runs with or without sql/146');
ok(/revoke all on function public\.corp_close_withdraw\(uuid\) from public, anon;/.test(SQL) && /grant execute on function public\.corp_close_withdraw\(uuid\) to authenticated;/.test(SQL), 'execute: authenticated only');
ok(/^select p\.oid::regprocedure/m.test(SQL), 'ends with a verify query');
ok(/DRAFT — NOT APPLIED/.test(SQL), 'marked DRAFT');

console.log('\n=== 2. the client handler ===');
const hStart = SRC.indexOf("} else if (a.kind === 'corpDissolve') {");
const hEnd = SRC.indexOf("} else if (a.kind === 'corpLeave') {", hStart);
const H = SRC.slice(hStart, hEnd);
ok(hStart > 0 && hEnd > hStart, 'found the corpDissolve handler');
ok(/await gcConfirm\(/.test(H) && /Treasury holds ' \+ _tb\.toLocaleString\(\)/.test(H), 'a gcConfirm shows the amount');
ok(H.indexOf("rpc('corp_close_withdraw'") > 0 && H.indexOf("rpc('corp_close_withdraw'") < H.indexOf("rpc('corp_dissolve'"), 'withdraw runs BEFORE dissolve');
ok(/_code === 'PGRST202' \|\| _code === '42883'/.test(H) && /not installed on the server yet \(sql\/152_C\)/.test(H), 'missing function -> the legacy instruction, and it stops');
ok(!/addGems\(/.test(H) && !/spendGems\(/.test(H), 'the client neither adds nor spends Cinder itself');
ok(/_gemsTaxExempt\(\(\) => \{ Profile\.gems = Math\.max\(0, Math\.floor\(Number\(wd\.balance\)\)\); \}\)/.test(H), 'it adopts the SERVER balance, tax-exempt');

console.log('\n=== 3. the decision, run against stubs ===');
async function drive({ treasury, known = true, confirm = true, rpcErr = null }) {
  const calls = []; const toasts = [];
  const Corp = { mine: { id: 'c1', name: 'Co' }, amOwner: true, treasury, treasuryKnown: known };
  const Profile = { gems: 100 };
  const Cloud = { client: { rpc: async (fn) => { calls.push(fn);
    if (fn === 'corp_close_withdraw') return rpcErr ? { error: rpcErr } : { data: { ok: true, withdrawn: treasury, balance: 100 + treasury, name: 'Co' } };
    return { data: { ok: true, name: 'Co' } }; } } };
  const inner = H.slice(H.indexOf('(async function () {'), H.lastIndexOf('})();') + 5);
  const f = new Function('Corp', 'Profile', 'Cloud', 'Operations', 'showToast', 'gcConfirm', 'corpTreasuryFetch', '_jbNum', '_ctRpcMissing', '_gemsTaxExempt', '_cinderLedgerAdd', 'saveProfile', '_jbSendData',
    'return ' + inner.replace(/\}\)\(\);\s*$/, '})'));
  await f(Corp, Profile, Cloud, { list: [] }, (m) => toasts.push(m), async () => confirm, async () => {}, (n) => Number(n) || 0,
    (e) => /PGRST202/.test((e && e.code) || ''), (fn) => fn(), () => {}, () => {}, () => {})();
  return { calls, toasts, Profile };
}
{
  const r = await drive({ treasury: 71193 });
  ok(r.calls.join(',') === 'corp_close_withdraw,corp_dissolve', 'treasury > 0, confirmed: withdraw then dissolve', r.calls.join(','));
  ok(r.Profile.gems === 71293, 'wallet adopts the server balance', r.Profile.gems);
}
{
  const r = await drive({ treasury: 71193, confirm: false });
  ok(r.calls.length === 0, 'cancelled: nothing is called', r.calls.join(','));
}
{
  const r = await drive({ treasury: 0 });
  ok(r.calls.join(',') === 'corp_dissolve', 'empty treasury: straight to dissolve, no confirm needed', r.calls.join(','));
}
{
  const r = await drive({ treasury: 500, rpcErr: { code: 'PGRST202', message: 'Could not find the function' } });
  ok(r.calls.join(',') === 'corp_close_withdraw' && r.toasts.some((t) => /sql\/152_C/.test(t)), 'function missing: legacy message, no dissolve', r.calls.join(','));
}
{
  const r = await drive({ treasury: 500, rpcErr: { code: '42501', message: 'only the founder can withdraw' } });
  ok(r.calls.join(',') === 'corp_close_withdraw' && r.toasts.some((t) => /Nothing was moved/.test(t)), 'refused: says so, no dissolve');
}

console.log('\n=== 4. negative control: HEAD never offered the withdrawal ===');
{
  let head = '';
  try { head = execSync('git -c core.eol=lf -c core.autocrlf=false show ' + (process.env.PRE_FIX_REF || '767bf27084') + ':public/index.html', { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) { head = ''; }
  const a = head.indexOf("} else if (a.kind === 'corpDissolve') {"), b = head.indexOf("} else if (a.kind === 'corpLeave') {", a);
  const HH = head.slice(a, b);
  ok(a > 0 && !/corp_close_withdraw/.test(HH), 'HEAD handler calls corp_dissolve alone (the reported gap)');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
