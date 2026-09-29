/* 🏢 CORPORATIONS EMPLOY NODE MANAGERS (sql/142, draft).

   Asked for: corporation owners hire players as Node Managers (the on-screen
   name for node_mayors) and take a percentage of what those managers are
   contracted for by their clients.

   sql/142 splits the manager's existing cut (sql/121) between the manager and
   the corp treasury. It is money, so this suite pins the things that turn a
   split into a faucet or a leak:

     · CONSERVATION. owner + manager + corp = delta, to the Cinder, for every
       delta. The manager share is floored and the corp takes the exact
       remainder — the moment someone writes a second floor, a Cinder per
       payout goes to nobody. Section 1 evaluates the SQL's own lines, and its
       NEGATIVE CONTROL evaluates the two-floor mutant and requires the leak.
     · RPC ONLY. The percentage decides money; a table the payee can UPDATE is
       a manager setting their own share to 100. Section 2 lints every policy
       and requires the lint to CATCH a `using (true)` mutant and a write
       policy mutant.
     · APPEND-ONLY TREASURY, and the corp's insert is not swallowed by an
       exception handler (a swallowed insert commits the owner side while the
       corp's Cinder vanishes).
     · NO EMPLOYMENT = sql/123 EXACTLY. The owner half of the function is
       compared line for line against sql/123, and a mutant must be caught.
     · A BOUNDED DELTA (sql/145, sections 7-8). The delta is chosen by the
       manager's client; 145 refuses a credit above a per-node token bucket.
       The bucket is simulated from 145's own lines and must refuse 1,000,000
       where the same run over 142 takes it, and the client's flush sizing is
       driven against a stand-in server, with the sizing removed as the
       negative control.

   The live proof (a DO block that creates everything, runs deltas 1000/7/1/0/-50
   under impersonation, exercises the refusals as role `authenticated`, then
   RAISE EXCEPTION) is in the builder's report; this suite is the static half
   that keeps it true after edits.

   Run: node _corpnodemgr_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); c ? passes++ : fails++; };
const SQL = readFileSync('./sql/142_corp_node_managers.sql', 'utf8');
const S123 = readFileSync('./sql/123_mayor_dashboard.sql', 'utf8');
const strip = s => s.replace(/--[^\n]*/g, '');
const CODE = strip(SQL);

function fnBody(src, name) {
  const i = src.indexOf('create or replace function public.' + name + '(');
  if (i < 0) return '';
  const a = src.indexOf('$$', i), b = src.indexOf('$$', a + 2);
  return src.slice(a + 2, b);
}
const LEDGER = strip(fnBody(SQL, 'city_owner_ledger_apply'));

/* ── 1. conservation, evaluated from the SQL's own assignment lines ── */
const toJs = (line) => line.replace(/floor\(/g, 'Math.floor(').replace(/100\.0/g, '100');
function splitterFrom(code) {
  const grab = (re) => { const m = re.exec(code); return m ? toJs(m[1]) : null; };
  const cut = grab(/v_cut := (floor\(v_delta \* v_pct \/ 100\.0\));/);
  const owner = grab(/v_owner_delta := (v_delta - v_cut);/);
  // The in-branch assignment only; `v_mgr_share := v_cut;` is the unemployed default.
  const mgr = grab(/v_mgr_share\s+:= ((?:floor|ceil|round)\([^;]+\));/);
  const corp = grab(/v_corp_share := ([^;]+);/);
  if (!cut || !owner || !mgr || !corp) return null;
  // eslint-disable-next-line no-new-func
  return new Function('v_delta', 'v_pct', 'v_mgr_pct', `
    let v_cut = 0; if (v_delta > 0 && v_pct > 0) v_cut = ${cut};
    const v_owner_delta = ${owner};
    let v_mgr_share = v_cut, v_corp_share = 0;
    if (v_cut > 0 && v_mgr_pct !== null) { v_mgr_share = ${mgr}; v_corp_share = ${corp}; }
    return { owner: v_owner_delta, mgr: v_mgr_share, corp: v_corp_share };`);
}
function leaks(fn) {
  let bad = 0, neg = 0, over = 0;
  for (let d = -60; d <= 1200; d += (d < 50 ? 1 : 37)) for (const p of [0, 1, 7, 30, 33, 99, 100])
    for (const m of [null, 0, 1, 33, 50, 70, 99, 100]) {
      const r = fn(d, p, m);
      if (r.owner + r.mgr + r.corp !== d) bad++;
      if (d <= 0 && (r.mgr !== 0 || r.corp !== 0)) neg++;
      if (r.mgr < 0 || r.corp < 0 || !Number.isInteger(r.mgr) || !Number.isInteger(r.corp)) over++;
    }
  return { bad, neg, over };
}
{
  const fn = splitterFrom(LEDGER);
  ok(!!fn, 'the four money lines are present in city_owner_ledger_apply');
  if (fn) {
    const l = leaks(fn);
    ok(l.bad === 0, 'owner + manager + corp is exactly the delta across the grid', JSON.stringify(l));
    ok(l.neg === 0, 'a spend (delta <= 0) is never split');
    ok(l.over === 0, 'no share is negative or fractional');
    const r = fn(1000, 30, 70);
    ok(r.owner === 700 && r.mgr === 210 && r.corp === 90, 'the live-proof case: 1000 at 30% / 70% = 700 / 210 / 90', JSON.stringify(r));
    const r7 = fn(7, 30, 70);
    ok(r7.owner === 5 && r7.mgr === 1 && r7.corp === 1, 'the crumb: 7 → 5 / 1 / 1', JSON.stringify(r7));
    const rn = fn(1000, 30, null);
    ok(rn.owner === 700 && rn.mgr === 300 && rn.corp === 0, 'no employment pays exactly as sql/121', JSON.stringify(rn));
  }
  /* NEGATIVE CONTROL: the two-floor mutant must be caught. */
  const mutant = LEDGER.replace(/v_corp_share := [^;]+;/, 'v_corp_share := floor(v_cut * (100 - v_mgr_pct) / 100.0);');
  const mf = splitterFrom(mutant);
  ok(mutant !== LEDGER && mf && leaks(mf).bad > 0, 'NEGATIVE CONTROL: a second floor for the corp is detected as a leak', mf && JSON.stringify(leaks(mf)));
  /* A share taken from the DELTA instead of the cut would pay the corp out of
     the owner's money; conservation must catch it too. */
  const fromDelta = LEDGER.replace(/v_corp_share := [^;]+;/, 'v_corp_share := v_delta - v_mgr_share;');
  const fd = splitterFrom(fromDelta);
  ok(fd && leaks(fd).bad > 0, 'NEGATIVE CONTROL: a corp share taken from the delta is detected', fd && JSON.stringify(leaks(fd)));
  ok(/v_mgr_share\s+:= floor\(v_cut \* v_mgr_pct \/ 100\.0\);/.test(LEDGER), 'the manager share is FLOORED in the shipped text');
}
ok(/if v_delta > 0 and coalesce\(v_pct, 0\) > 0 then/.test(LEDGER), 'only a positive delta produces a cut (sql/121 rule 1)');
{
  const iRefuse = LEDGER.indexOf("'insufficient_cinder'"), iLoop = LEDGER.indexOf('end loop;');
  const iEmp = LEDGER.indexOf('from public.corp_node_managers'), iGive = LEDGER.indexOf('_ct_cinder_give');
  const iCorp = LEDGER.indexOf('insert into public.corp_treasury');
  ok(iRefuse > 0 && iLoop > iRefuse && iEmp > iLoop && iGive > iEmp && iCorp > iGive,
    'refusals fire before the employment lookup, the manager payment and the corp insert');
}

/* ── 2. RLS: the table is read-only to clients, every policy names auth.uid() ── */
function rlsLint(code) {
  const out = [];
  const pols = [...code.matchAll(/create policy (\w+) on public\.corp_node_managers([\s\S]*?);/g)];
  if (!pols.length) out.push('no policy');
  for (const [, name, body] of pols) {
    if (!/for select/.test(body)) out.push(name + ' is not SELECT-only');
    if (!/auth\.uid\(\)/.test(body)) out.push(name + ' has no auth.uid() predicate');
    if (/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/.test(body)) out.push(name + ' is open to everyone');
    /* Members may read (owner decision 2026-09-17), but only through the
       definer helper is_corp_member(), whose meaning sql/149 made a real trust
       boundary. A raw corp_members subquery is refused: it bypasses that one
       place and, under RLS on corp_members, is a recursion risk. */
    if (/corp_members\b/.test(body)) out.push(name + ' reads corp_members directly instead of is_corp_member()');
  }
  if (!/enable row level security/.test(code)) out.push('RLS not enabled');
  if (!/revoke insert, update, delete, truncate on public\.corp_node_managers from authenticated;/.test(code)) out.push('writes not revoked');
  if (!/revoke all on public\.corp_node_managers from anon, public;/.test(code)) out.push('anon not revoked');
  if (/grant (insert|update|delete|all)[^;]*on public\.corp_node_managers/.test(code)) out.push('a write is granted');
  return out;
}
{
  const l = rlsLint(CODE);
  ok(l.length === 0, 'corp_node_managers: one SELECT policy with auth.uid(), writes revoked, anon revoked', l.join('; '));
  const pol = /create policy cnm_sel[\s\S]*?;/.exec(CODE)[0];
  ok(/manager_id = auth\.uid\(\)/.test(pol) && /public\.is_corp_member\(corp_node_managers\.corp_id, auth\.uid\(\)\)/.test(pol),
    'the readers are the manager and members of that corporation (founder included by is_corp_member)');
  const S149 = readFileSync('./sql/149_corp_membership_boundary.sql', 'utf8');
  ok(/create policy cm_ins on public\.corp_members for insert to authenticated\s+with check \(\s+user_id = auth\.uid\(\)\s+and exists \(select 1 from public\.corporations c\s+where c\.id = corp_members\.corp_id\s+and c\.founder_id = auth\.uid\(\)\)/.test(S149)
     && /apply AFTER sql\/149/.test(SQL),
    'member reads rest on sql/149: a player can no longer insert themselves into a corporation, and 142 says to apply after it');
  const m1 = CODE.replace(/using \(\s*manager_id = auth\.uid\(\)[\s\S]*?\n  \);/, 'using (true);');
  ok(m1 !== CODE && rlsLint(m1).length > 0, 'NEGATIVE CONTROL: a `using (true)` policy is caught', rlsLint(m1).join('; '));
  const m2 = CODE + '\ncreate policy cnm_upd on public.corp_node_managers for update to authenticated using (manager_id = auth.uid());\n';
  ok(rlsLint(m2).some(x => /not SELECT-only/.test(x)), 'NEGATIVE CONTROL: an UPDATE policy for the manager is caught');
  const m3 = CODE.replace('or public.is_corp_member(corp_node_managers.corp_id, auth.uid())', 'or exists (select 1 from public.corp_members m where m.corp_id = corp_node_managers.corp_id and m.user_id = auth.uid())');
  ok(m3 !== CODE && rlsLint(m3).some(x => /corp_members directly/.test(x)), 'NEGATIVE CONTROL: a raw corp_members reader is caught');
}

/* ── 3. RPC authority ── */
{
  const offer = strip(fnBody(SQL, 'corp_offer_node_manager'));
  const accept = strip(fnBody(SQL, 'corp_accept_node_manager'));
  const end = strip(fnBody(SQL, 'corp_end_node_manager'));
  const list = strip(fnBody(SQL, 'corp_node_manager_list'));
  ok(/c\.id = p_corp_id and c\.founder_id = v_uid/.test(offer), 'offer: only the founder of THAT corporation');
  ok(/p_pct < 0 or p_pct > 100 or p_pct <> trunc\(p_pct\)/.test(offer), 'offer: pct outside 0-100 or fractional is refused');
  ok(/r\.manager_id <> v_uid/.test(accept) && /r\.status <> 'offered'/.test(accept), 'accept: only the named player, only an open offer');
  ok(/c\.founder_id = r\.offered_by/.test(accept), 'accept: an offer from a founder who no longer owns the corp is stale');
  ok(/r\.manager_id = v_uid/.test(end) && /c\.founder_id = v_uid/.test(end), 'end: the manager or the current founder, nobody else');
  ok(/where k\.manager_id = auth\.uid\(\)\s+or public\.is_corp_member\(k\.corp_id, auth\.uid\(\)\)/.test(list), 'list: rows the caller manages, or of a corporation the caller belongs to');
  ok(/when c\.founder_id = auth\.uid\(\) then 'employer'\s+else 'member' end/.test(list), 'list: a member who is neither party is labelled member, not employer');
  for (const f of ['corp_offer_node_manager', 'corp_accept_node_manager', 'corp_end_node_manager', 'corp_node_manager_list'])
    ok(new RegExp('create or replace function public\\.' + f + '\\([^$]*security definer set search_path = public, pg_temp').test(CODE)
       && new RegExp('revoke all on function public\\.' + f + '\\([^)]*\\)\\s+from public, anon;').test(CODE)
       && new RegExp('grant execute on function public\\.' + f + '\\([^)]*\\)\\s+to authenticated;').test(CODE),
       f + ': definer, pinned search_path, revoked from public/anon, granted to authenticated');
  ok(/create unique index if not exists corp_node_managers_one_active\s+on public\.corp_node_managers \(manager_id\) where status = 'active';/.test(CODE),
    'at most one active employer per manager, by UNIQUE INDEX (a race-proof guarantee)');
  ok(/check \(manager_pct >= 0 and manager_pct <= 100 and manager_pct = trunc\(manager_pct\)\)/.test(CODE),
    'the table itself refuses a pct outside 0-100');
}

/* ── 4. the treasury is append-only and the corp insert is not swallowed ── */
{
  ok(!/update\s+public\.corp_treasury|delete\s+from\s+public\.corp_treasury|update\s+corp_treasury/i.test(CODE), 'corp_treasury is never updated or deleted');
  const i = LEDGER.indexOf('insert into public.corp_treasury');
  const before = LEDGER.slice(LEDGER.lastIndexOf('end if;', i), i);
  const after = LEDGER.slice(i, LEDGER.indexOf('end if;', i));
  ok(i > 0 && !/begin/.test(before) && !/exception/.test(after), 'the corp insert has no exception handler around it', before + '|' + after);
  ok(/'node_manager_fee'/.test(LEDGER) && /values \(v_emp_corp, v_mayor, v_corp_share, 'node_manager_fee'/.test(LEDGER),
    'one row: the employer corp, user_id = the manager, the corp share, kind node_manager_fee');
  const bad = CODE + '\nupdate public.corp_treasury set amount = 0;';
  ok(/update\s+public\.corp_treasury/i.test(bad), 'NEGATIVE CONTROL: the append-only check sees an UPDATE');
}

/* ── 5. no employment = sql/123, and the client contract ── */
{
  const norm = s => strip(s).split('\n').map(x => x.trim()).filter(Boolean);
  const upTo = (body, stop) => { const l = norm(body); return l.slice(0, l.findIndex(x => x.startsWith(stop))); };
  const a = upTo(fnBody(S123, 'city_owner_ledger_apply'), 'if v_cut > 0 then')
    .filter(x => !/^v_(have|next)\s|^k\s/.test(x) || true);
  const bFull = norm(fnBody(SQL, 'city_owner_ledger_apply'));
  const b = bFull.slice(0, bFull.findIndex(x => x.startsWith('v_mgr_share := v_cut;')))
    .filter(x => !/^v_(emp_corp|mgr_pct|mgr_share|corp_share)\s/.test(x));
  const diff = a.filter((x, k) => x !== b[k]);
  ok(a.length > 30 && a.length === b.length && diff.length === 0, 'the owner half is sql/123 line for line (' + a.length + ' lines)', diff.slice(0, 2).join(' / '));
  const b2 = b.map(x => x.replace('v_cut := floor(v_delta * v_pct / 100.0);', 'v_cut := round(v_delta * v_pct / 100.0);'));
  ok(a.filter((x, k) => x !== b2[k]).length === 1, 'NEGATIVE CONTROL: a one-line change to the owner half is detected');
  ok(/'Mayor revenue share \(' \|\| round\(v_pct\)::text \|\| '%\) — city on node '/.test(LEDGER),
    'the unemployed wording is unchanged (sql/123 backfill and the phone ledger read it)');
  ok(!/^Mayor revenue share/.test('Node Manager commission') && /'Node Manager commission \('/.test(LEDGER),
    'the commission line does not match the sql/123 backfill pattern');
  ok(/insert into public\.mayor_earnings \(node_id, mayor_id, owner_id, amount, pct\)\s+values \(p_node_id, v_mayor, v_owner, v_mgr_share::bigint, v_pct\);/.test(LEDGER),
    'mayor_earnings records what reached the manager, not the corp part');
  ok(/'mayor_cut', v_mgr_share,/.test(LEDGER), "mayor_cut (toasted by index.html's _cityCutReport) is the manager's own take");
  ok(/for share;/.test(LEDGER), 'the employment row is held for the payout (no end-mid-split)');
}

/* ── 6. migration hygiene ── */
ok(/^begin;$/m.test(SQL) && /^commit;$/m.test(SQL), 'one transaction');
ok(/create table if not exists public\.corp_node_managers/.test(CODE)
   && (CODE.match(/create (unique )?index if not exists/g) || []).length === 3
   && /drop policy if exists cnm_sel/.test(CODE), 'idempotent: table, indexes and policy are guarded');
ok(/client_can_write_expect_false;\s*$/.test(SQL.trim()), 'ends with a verify query');
ok(!/\r/.test(SQL), 'LF line endings');

/* ── 7. sql/145: the server bounds the client-chosen delta ──────────────────
   The payout above takes p_cinder_delta from the manager's client. A seated
   manager could send 1e9 and mint for the owner, themselves and the corp.
   sql/145 re-states the function with a per-node token bucket. Pinned here:
     · the ONLY change to the function is the marked rate-bound lines (so
       everything sections 1-5 prove about 142 is still true of 145);
     · the refusal fires before every write, the bucket debit after them;
     · a bucket simulated from the SQL's own lines refuses 1,000,000 right
       after an apply, with a NEGATIVE CONTROL: the same simulation built
       from sql/142's body takes it;
     · the bucket table has RLS and no client access at all;
     · the client sizes its flushes to the bucket, driven against a stand-in
       server, with a NEGATIVE CONTROL where the sizing is removed and the
       queue bounces forever. */
const S145 = readFileSync('./sql/145_city_ledger_delta_bound.sql', 'utf8');
const C145 = strip(S145);
const RAW145 = fnBody(S145, 'city_owner_ledger_apply');
const unmark = (body) => body.replace(/\n[ \t]*-- ▼ rate bound \(sql\/145\)\n[\s\S]*?\n[ \t]*-- ▲ rate bound\n/g, '\n');
{
  const norm = s => strip(s).split('\n').map(x => x.trim()).filter(Boolean);
  const a = norm(fnBody(SQL, 'city_owner_ledger_apply'));
  const b = norm(unmark(RAW145));
  const diff = a.map((x, k) => x === b[k] ? null : k + ': ' + x + ' ≠ ' + b[k]).filter(Boolean);
  ok(RAW145.length > 0 && (RAW145.match(/-- ▼ rate bound/g) || []).length === 4
     && a.length > 60 && a.length === b.length && diff.length === 0,
     '145 = 142 line for line outside the four marked rate-bound blocks (' + a.length + ' lines)', diff.slice(0, 2).join(' / ') || (a.length + ' vs ' + b.length));
  // NEGATIVE CONTROL: an unmarked edit to the split is caught.
  const mut = unmark(RAW145).replace('v_corp_share := v_cut - v_mgr_share;', 'v_corp_share := v_cut - v_mgr_share + 1;');
  ok(norm(mut).some((x, k) => x !== a[k]), 'NEGATIVE CONTROL: an unmarked change to the split in 145 is detected');
  // The header of the function (signature, definer) is unchanged too.
  const sig = (s) => (/create or replace function public\.city_owner_ledger_apply\([\s\S]*?as \$\$/.exec(s) || [''])[0];
  ok(sig(S145) && sig(S145) === sig(SQL), 'signature, SECURITY DEFINER and search_path are sql/142\'s');
}
const B145 = strip(RAW145);
{
  const at = (s) => B145.indexOf(s);
  const iRefuse = at("'over_rate'");
  const writes = ['insert into public.city_ledger_rate', 'update public.user_profiles', 'update public.user_progress',
    '_ct_cinder_give', 'insert into public.mayor_earnings', 'insert into public.corp_treasury'];
  // city_ledger_rate's seed insert comes BEFORE the refusal on purpose (a full
  // bucket, harmless); every money write must come after it.
  const late = writes.slice(1).filter((w) => !(at(w) > iRefuse));
  ok(iRefuse > 0 && late.length === 0, 'the over_rate refusal fires before every money write', late.join(', '));
  ok(at('for update') > 0 && at('from public.city_ledger_rate where node_id = p_node_id for update') < iRefuse,
    'the bucket row is locked before it is read (two applies cannot spend one allowance)');
  const iDebit = at('update public.city_ledger_rate');
  ok(iDebit > at('insert into public.corp_treasury') && iDebit > at("'insufficient_cinder'") && iDebit > at("'insufficient_resource'")
     && iDebit < B145.lastIndexOf("'ok', true"),
    'the bucket is debited only on the success path (a returned refusal cannot eat allowance)');
  // NEGATIVE CONTROL: moving the refusal below the owner credit is caught.
  const gate = /\n\s*if coalesce\(p_cinder_delta, 0\) > v_allow then[\s\S]*?end if;\n/.exec(B145);
  ok(!!gate, 'the gate compares the whole delta with the allowance');
  if (gate) {
    const moved = B145.replace(gate[0], '\n').replace('   where user_id = v_owner;', '   where user_id = v_owner;' + gate[0]);
    const mi = moved.indexOf("'over_rate'");
    ok(!(moved.indexOf('update public.user_profiles') > mi), 'NEGATIVE CONTROL: a refusal after the owner credit is detected');
  }
  ok(/'error', 'over_rate'/.test(B145) && /'allowance', floor\(v_allow\)/.test(B145) && /'retry_after'/.test(B145),
    "the refusal says over_rate and carries the allowance and retry_after the client reads");
  ok(!/\b(36000|40000|250000)\b/.test(B145) && /v_econ\s+jsonb := public\._city_ledger_econ\(\);/.test(B145),
    'no rate number in the payout body: they come from _city_ledger_econ() (the _opEcon rule)');
}
/* The bucket, simulated from the SQL's own lines. */
function bucketFrom(body) {
  const g = (re) => { const m = re.exec(body); return m ? m[1] : null; };
  const allow = g(/v_allow := (greatest\(v_rrow\.allowance,[\s\S]*?\/ 3600\.0\)\));/);
  const gate = g(/if (coalesce\(p_cinder_delta, 0\) > v_allow) then/);
  const credit = g(/if p_cinder_delta > 0 then\s+v_left := ([^;]+);/);
  const refund = g(/else\s+v_left := (greatest\(v_allow, least\(v_ceil, v_allow - p_cinder_delta\)\));/);
  if (!allow || !gate || !credit || !refund) return null;
  const js = (s) => s.replace(/greatest\(/g, 'Math.max(').replace(/least\(/g, 'Math.min(').replace(/coalesce\(p_cinder_delta, 0\)/g, 'p_cinder_delta')
    .replace(/extract\(epoch from \(now\(\) - v_rrow\.updated_at\)\)/g, '(now - v_rrow.updated_at)').replace(/v_rrow\.allowance/g, 'v_rrow.allowance');
  // eslint-disable-next-line no-new-func
  return new Function('v_rrow', 'now', 'p_cinder_delta', 'v_rate', 'v_cap', 'v_ceil', `
    const v_allow = ${js(allow)};
    if (${js(gate)}) return { ok: false, row: v_rrow };
    if (p_cinder_delta === 0) return { ok: true, row: v_rrow };
    const v_left = p_cinder_delta > 0 ? (${js(credit)}) : (${js(refund)});
    return { ok: true, row: { allowance: v_left, updated_at: now } };`);
}
const ECON = (() => {
  const m = /create or replace function public\._city_ledger_econ\(\)[\s\S]*?'rate_per_hour',\s*(\d+)[\s\S]*?'burst_cap',\s*(\d+)[\s\S]*?'spend_credit_ceiling',\s*(\d+)/.exec(C145);
  return m ? { rate: +m[1], cap: +m[2], ceil: +m[3] } : null;
})();
ok(!!ECON && ECON.cap > 20000 && ECON.rate > 0 && ECON.ceil >= ECON.cap,
  'the econ constants parse, and the cap clears the biggest real live apply (~20,000 gross)', JSON.stringify(ECON));
function runBucket(fn, seq) {
  // fn === null means "no gate in this body" (sql/142): everything is taken.
  let row = { allowance: ECON.cap, updated_at: 0 };
  return seq.map(([t, d]) => {
    if (!fn) return true;
    const r = fn(row, t, d, ECON.rate, ECON.cap, ECON.ceil); row = r.row; return r.ok;
  });
}
{
  const b = bucketFrom(B145);
  ok(!!b, 'the bucket lines are present in 145 (refill, gate, debit, spend credit)');
  if (b && ECON) {
    const H = 3600;
    // BAR 1 + 2 + 3: an apply, then 1,000,000 at once, then a spend, then the refund of it.
    const r = runBucket(b, [[0, 1000], [0, 1000000], [0, -50], [0, ECON.cap - 1000 + 51], [0, ECON.cap - 1000 + 50]]);
    ok(r[0] === true && r[1] === false, '1,000 is taken, 1,000,000 right after is refused', JSON.stringify(r));
    ok(r[2] === true, 'a spend is never refused by the rate');
    ok(r[3] === false && r[4] === true, 'a spend credits the bucket by exactly what it spent', JSON.stringify(r));
    // Refill: empty the bucket, then an hour later one hour of rate fits and one more does not.
    const f = runBucket(b, [[0, ECON.cap], [0, 1], [H, ECON.rate + 1], [H, ECON.rate], [H * 10, ECON.cap + 1], [H * 10, ECON.cap]]);
    ok(f[0] && !f[1] && !f[2] && f[3], 'an empty bucket refills at rate_per_hour, to the Cinder', JSON.stringify(f));
    ok(!f[4] && f[5], 'a long idle never refills past burst_cap', JSON.stringify(f));
    // Sustained honest play at the rate never trips; minting at 10x does.
    let honest = 0, cheat = 0;
    const hs = [], cs = [];
    for (let s = 0; s < 6 * 3600; s += 6) { hs.push([s, Math.floor(ECON.rate / 600)]); cs.push([s, ECON.rate / 60]); }
    honest = runBucket(b, hs).filter((x) => !x).length;
    cheat = runBucket(b, cs).filter((x) => x).length * (ECON.rate / 60);
    ok(honest === 0, 'six hours of 6 s flushes AT the rate: zero refusals', honest);
    ok(cheat <= ECON.cap + ECON.rate * 6 + 1, 'six hours of flushes at 10x the rate bank no more than cap + 6h of rate', cheat);
  }
  // NEGATIVE CONTROL: sql/142's body has no gate; the same run takes 1,000,000.
  const n = bucketFrom(strip(fnBody(SQL, 'city_owner_ledger_apply')));
  const nr = runBucket(n, [[0, 1000], [0, 1000000]]);
  ok(n === null && nr[1] === true, 'NEGATIVE CONTROL: the unbounded sql/142 function takes 1,000,000 in the same run');
}
/* RLS / grants for the bucket table. */
function rateRls(code) {
  const out = [];
  if (!/create table if not exists public\.city_ledger_rate/.test(code)) out.push('no table');
  if (!/alter table public\.city_ledger_rate enable row level security;/.test(code)) out.push('RLS not enabled');
  if (/create policy [\w]+ on public\.city_ledger_rate/.test(code)) out.push('a client policy exists');
  if (!/revoke all on public\.city_ledger_rate from anon, authenticated, public;/.test(code)) out.push('client grants not revoked');
  if (/grant [^;]*on (table )?public\.city_ledger_rate/.test(code)) out.push('a grant on the bucket');
  return out;
}
{
  const l = rateRls(C145);
  ok(l.length === 0, 'city_ledger_rate: RLS on, no policy, every client grant revoked', l.join('; '));
  const m = C145 + '\ncreate policy clr_upd on public.city_ledger_rate for update to authenticated using (true);\n';
  ok(rateRls(m).length > 0, 'NEGATIVE CONTROL: a client policy on the bucket is caught');
  const m2 = C145.replace('revoke all on public.city_ledger_rate from anon, authenticated, public;', 'grant select on public.city_ledger_rate to authenticated;');
  ok(rateRls(m2).length >= 2, 'NEGATIVE CONTROL: a client grant on the bucket is caught');
}
/* Hygiene. */
ok(/^begin;$/m.test(S145) && /^commit;$/m.test(S145), '145: one transaction');
ok(/to_regclass\('public\.corp_node_managers'\) is null then\s+raise exception/.test(C145), '145 refuses to run before sql/142');
ok(/create or replace function public\._city_ledger_econ\(\)/.test(C145) && /create or replace function public\.city_owner_ledger_apply\(/.test(C145)
   && !/create table public\.|create policy/.test(C145), '145 is re-runnable (if-not-exists / or-replace, nothing to re-create)');
ok(/revoke all on function public\.city_owner_ledger_apply\(text, numeric, jsonb\) from public, anon;/.test(C145)
   && /grant execute on function public\.city_owner_ledger_apply\(text, numeric, jsonb\) to authenticated;/.test(C145),
   '145 keeps the function revoked from anon and granted to authenticated');
ok(/econ_rate_expect_36000;\s*$/.test(S145.trim()) && /bound_live_t/.test(S145), '145 ends with a verify query');
ok(!/\r/.test(S145), '145: LF line endings');

/* ── 8. the client sizes its flushes to the bucket (driven, not grepped) ── */
{
  const IDX = readFileSync('./public/index.html', 'utf8');
  const a = IDX.indexOf('function _cityMgrDescribe(dC, dS)');
  const z = IDX.indexOf('/* 🏛🔴 "WHOSE CITY IS THIS?"');
  ok(a > 0 && z > a, 'the ledger client block is found in index.html');
  const SRC = IDX.slice(a, z);
  ok(/j\.error === 'over_rate'/.test(SRC) && SRC.indexOf("j.error === 'over_rate'") < SRC.indexOf('The owner cannot afford that'),
    "an over_rate refusal is handled before the owner-cannot-afford toast");
  const drive = async (src) => {
    const toasts = [], warns = [];
    const server = { allowance: ECON.cap, at: 0, owner: 0, calls: 0, refused: 0 };
    let clock = 0;
    const b = bucketFrom(B145);
    const rpc = async (name, args) => {
      server.calls++;
      const r = b({ allowance: server.allowance, updated_at: server.at }, clock / 1000, args.p_cinder_delta, ECON.rate, ECON.cap, ECON.ceil);
      if (!r.ok) { server.refused++; return { data: { ok: false, error: 'over_rate', allowance: Math.floor(server.allowance), rate_per_hour: ECON.rate, rate_cap: ECON.cap } }; }
      server.allowance = r.row.allowance; server.at = r.row.updated_at; server.owner += args.p_cinder_delta;
      return { data: { ok: true, cinder: 1e9, salvage: {}, mayor_cut: 0, rate_allowance: Math.floor(server.allowance), rate_per_hour: ECON.rate, rate_cap: ECON.cap } };
    };
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      // eslint-disable-next-line no-new-func
      const env = new Function('Cloud', 'showToast', 'console', 'CityMgr', '_cityCutReport',
        src + '\nreturn { flush: _cityMgrFlush, spend: _cityMgrSpend, end: _cityMgrEnd };');
      const CityMgr = { active: true, nodeId: 'N-T', cinder: 1e9, salvage: {}, pending: { cinder: 0, salvage: {} }, _timer: null, _busy: false, _inflight: null };
      const api = env({ client: { rpc } }, (m) => toasts.push(m), { warn: (m) => warns.push(m), log() {} }, CityMgr, () => {});
      // A demolish refund worth 100,000 lands in one tick, then 6 s flushes for 2 hours.
      CityMgr.pending.cinder = 100000;
      for (let t = 0; t <= 2 * 3600; t += 6) { clock = t * 1000; const p = api.flush(); if (p) await p; }
      const banked = server.owner, held = CityMgr.pending.cinder, flushRefused = server.refused;
      // A build (spend) with a large held pay riding along must still be charged.
      // No learned bucket (a fresh session): the whole held pay rides, the bundle is refused for rate.
      CityMgr.pending.cinder = 500000; server.allowance = 0; server.at = clock / 1000; delete CityMgr._rate;
      const built = await api.spend(1400, {});
      const heldAfterSpend = CityMgr.pending.cinder;
      api.end();
      return { banked, held, refused: flushRefused, calls: server.calls, toasts, warns, built, heldAfterSpend };
    } finally { Date.now = realNow; }
  };
  const r = await drive(SRC);
  ok(r.banked === 100000 && r.held === 0, 'a 100,000 refund is banked in full across flushes, none lost', JSON.stringify({ banked: r.banked, held: r.held }));
  ok(r.refused <= 1, 'the flushes bounce at most once (the bounce that teaches the client the bucket)', r.refused);
  ok(r.toasts.some((m) => /earning faster than the ledger banks it/.test(m)) && !r.toasts.some((m) => /cannot afford/.test(m)),
    'the hold is told once, and never as "the owner cannot afford"', JSON.stringify(r.toasts));
  ok(r.built === true, 'a build is charged even when a large held pay is over the rate');
  ok(r.heldAfterSpend === 500000, 'the held pay that could not ride is still queued after the build', r.heldAfterSpend);
  ok(r.toasts.some((m) => /could not be banked before the city closed/.test(m)), 'closing with pay over the rate says how much was dropped');
  // NEGATIVE CONTROL: the sizing removed — the 100,000 bounces every tick and is never banked.
  const unsized = SRC.replace(/function _cityRateRoom\(node\) \{/, 'function _cityRateRoom(node) { return Infinity;');
  ok(unsized !== SRC, 'the negative control mutant differs');
  const n = await drive(unsized);
  ok(n.banked === 0 && n.refused > 100, 'NEGATIVE CONTROL: without sizing, a queue over the cap bounces forever and banks nothing', JSON.stringify({ banked: n.banked, refused: n.refused }));
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
