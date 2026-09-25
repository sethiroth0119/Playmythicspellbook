/* 🧮 OPERATION REVENUE IS COMPUTED ON THE SERVER (sql/151, draft).
   Owner 2026-09-17: "a corporation's business revenue should be calculated on
   the server".
   Run: node _opserver_smoke.mjs

   Before this, the Just Business collect computed gross / wages / net in the
   browser (_opComputed) and sent the NET to the treasury — sql/146 could only
   bound that figure (up to ~12.7M a settlement). sql/151 adds corp_op_collect:
   the server reads its own tuning table, its own clock and the op row, and
   writes the op_salary + op_revenue rows itself. The client sends no amount.

   The SQL was proven on the live database inside a DO block that ended in
   RAISE EXCEPTION (everything rolled back, re-checked afterwards). Its figures
   are pinned below as LIVE and this suite's model must reproduce them from the
   SQL text, so the model cannot drift from what Postgres actually did.

   S  the migration, read as text (tuning seed == OPS_ECON, RLS, definer, the
      roles, the CAS before any treasury row, the client-figure path revoked,
      146's tail keeps it revoked on a re-run).
   M  a model whose formula and accrual-start rule are PARSED from the SQL:
      reproduces the live probe, pays an interleaved second tab nothing, and a
      meta rewind nothing. Negative controls: a CAS-less copy double pays, a
      meta-trusting copy pays the rewind.
   C  the REAL client functions (_opServerCollect, _opServerPre, _opSettle,
      _ctOpRevenue, _ctRpcMissing) driven against a fake 151 server, a pre-151
      server and a refusing server; the handlers checked for order.
   N  negative controls on the client: HEAD's client still sends its own figure;
      three mutants (double revenue, fallback on refusal, uncapped yield ratio)
      must each be caught. */
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (c) passes++; else fails++; };
const LF = (s) => s.replace(/\r\n/g, '\n');
const SRC = LF(readFileSync('./public/index.html', 'utf8'));
const SQL = LF(readFileSync('./sql/151_op_revenue_server.sql', 'utf8'));
const SQL146 = LF(readFileSync('./sql/146_corp_treasury_server_writes.sql', 'utf8'));

function fnText(name, src) {
  const s = src || SRC;
  let i = s.indexOf('async function ' + name + '(');
  if (i < 0) i = s.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, started = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return s.slice(i, j + 1).replace(/^\n/, ''); }
  }
  throw new Error('unbalanced ' + name);
}
const stripSqlComments = (s) => s.replace(/--[^\n]*/g, '');
function sqlFn(src, name) {
  const i = src.indexOf('create or replace function public.' + name + '(');
  if (i < 0) return '';
  const a = src.indexOf('as $$', i), b = src.indexOf('end $$;', a);
  return src.slice(i, b + 7);
}
function opsEcon(src) {
  const a = src.indexOf('const OPS_ECON = {'); const b = src.indexOf('\n};', a);
  return (0, eval)('(' + src.slice(a + 16, b + 2) + ')');
}
const numConst = (name) => { const m = new RegExp('const ' + name + '\\s*=\\s*([^;\\n]+);').exec(SRC); return m ? Number((0, eval)(m[1])) : NaN; };

// ═══ S · the migration ═══════════════════════════════════════════════════════
console.log('\nS · sql/151');
function checkSql(sql) {
  const r = {};
  const code = stripSqlComments(sql);
  r.draft = /draft, NOT applied/.test(sql.slice(0, 400));
  r.tx = code.includes('\nbegin;\n') && code.includes('\ncommit;\n');
  r.verify = /\ncommit;\n[\s\S]*\nselect\n[\s\S]*;\s*$/.test(code);
  // seed
  const seedBlock = (/insert into public\.corp_op_econ[^;]*values([\s\S]*?)on conflict \(op_type\) do nothing;/.exec(code) || [])[1] || '';
  r.seed = {};
  for (const m of seedBlock.matchAll(/\('([a-z]+)',\s*([\d.]+),\s*([\d.]+),\s*(\d+)\)/g)) r.seed[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  r.seedNoClobber = /on conflict \(op_type\) do nothing;/.test(code) && !/on conflict \(op_type\) do update/.test(code);
  // RLS
  r.rls = /alter table public\.corp_op_econ enable row level security;/.test(code) && /alter table public\.corp_op_clock enable row level security;/.test(code);
  const pols = [...code.matchAll(/create policy (\w+) on public\.(corp_op_\w+)\s+for (\w+) to (\w+)\s+((?:using \([^;]*?\))?\s*(?:with check \([^;]*?\))?);/g)]
    .map((m) => ({ name: m[1], table: m[2], cmd: m[3], role: m[4], body: m[5] }));
  r.pols = pols;
  const econW = pols.filter((p) => p.table === 'corp_op_econ' && p.cmd !== 'select');
  r.econWritesAdmin = econW.length === 3 && econW.every((p) => p.role === 'authenticated' && /is_admin\(\)/.test(p.body) && !/\btrue\b/.test(p.body)
    && (p.cmd !== 'update' || (/using \(public\.is_admin\(\)\)/.test(p.body) && /with check \(public\.is_admin\(\)\)/.test(p.body))));
  r.clockNoWritePolicy = pols.filter((p) => p.table === 'corp_op_clock').every((p) => p.cmd === 'select')
    && pols.some((p) => p.table === 'corp_op_clock' && /is_corp_member\(corp_id, auth\.uid\(\)\)/.test(p.body));
  r.clockRevoked = /revoke insert, update, delete, truncate on public\.corp_op_clock from authenticated;/.test(code);
  r.idemPolicies = pols.every((p) => code.includes('drop policy if exists ' + p.name + ' on public.' + p.table + ';'));
  // the function
  const fn = stripSqlComments(sqlFn(sql, 'corp_op_collect'));
  r.fn = fn;
  r.definer = /\)\s*returns jsonb\s*language plpgsql\s*security definer\s*set search_path = public, pg_temp/.test(fn);
  r.noAmountParam = !/p_amount/.test(fn) && /corp_op_collect\(\s*p_op_id\s+uuid,\s*p_supply\s+numeric default 1\s*\)/.test(fn);
  r.member = /if not public\.is_corp_member\(v_corp, v_uid\) then\s*raise exception/.test(fn);
  const roles = (/lower\(coalesce\(m\.role, ''\)\) in \(([^)]*)\)/.exec(fn) || [])[1] || '';
  r.roles = roles.split(',').map((x) => x.trim().replace(/'/g, '')).sort().join(',');
  r.founder = /c\.founder_id = v_uid/.test(fn);
  r.capH = Number((/c_accrual_cap_h\s+constant numeric := ([\d.]+);/.exec(fn) || [])[1]);
  r.siteMin = Number((/c_site_min\s+constant numeric := ([\d.]+);/.exec(fn) || [])[1]);
  r.siteMax = Number((/c_site_max\s+constant numeric := ([\d.]+);/.exec(fn) || [])[1]);
  r.mktMul = Number((/c_mkt_mul\s+constant numeric := ([\d.]+);/.exec(fn) || [])[1]);
  r.grossExpr = (/v_gross\s*:= floor\(([^;]*?)\)::bigint;/.exec(fn) || [])[1] || '';
  r.salaryExpr = (/v_salary\s*:= floor\(([^;]*?)\)::bigint;/.exec(fn) || [])[1] || '';
  r.prevArgs = ((/v_prev := least\(v_now, greatest\(([^;]*)\)\);/.exec(fn) || [])[1] || '').split(',').map((x) => x.trim());
  r.supplyClamp = /v_supply := least\(1, greatest\(0, v_supply\)\);/.test(fn) && /'NaN'::numeric/.test(fn);
  r.npcCap = /v_npc := least\(greatest\(0, coalesce\(v_op\.workers, 0\)\), v_econ\.max_workers\);/.test(fn);
  r.wCap = /v_w := least\(v_econ\.max_workers, v_npc \+ v_staff\);/.test(fn);
  r.staffAgreed = /s\.status = 'agreed'/.test(fn);
  r.cas = /update public\.corp_op_clock[\s\S]*?where op_id = p_op_id and last_collect_at = v_clock\.last_collect_at;/.test(fn)
       && /if v_n <> 1 then\s*raise exception/.test(fn);
  const iCas = fn.indexOf('get diagnostics v_n = row_count;'), iRow = fn.indexOf('insert into public.corp_treasury');
  r.casBeforePay = iCas > 0 && iRow > iCas;
  r.locks = /perform 1 from public\.corporations where id = v_corp for update;/.test(fn) && /from public\.corp_operations where id = p_op_id for update;/.test(fn);
  r.twoRows = (fn.match(/insert into public\.corp_treasury/g) || []).length === 2 && /'op_salary'/.test(fn) && /'op_revenue'/.test(fn) && /-v_pay, 'op_salary'/.test(fn) && /v_net, 'op_revenue'/.test(fn);
  r.noBalanceUpdate = !/update public\.corp_treasury/i.test(code) && !/balance\s*=/.test(fn.replace(/'treasury_balance'/g, ''));
  r.short = /if v_bal < v_salary then[\s\S]*?v_gross := floor\(v_gross \* 0\.5\)::bigint;/.test(fn);
  r.grants = /revoke all on function public\.corp_op_collect\(uuid, numeric\) from public, anon;/.test(code)
          && /grant execute on function public\.corp_op_collect\(uuid, numeric\) to authenticated;/.test(code);
  r.revokes146 = /revoke all on function public\.corp_treasury_op_revenue\(uuid, bigint, text\) from public, anon, authenticated/.test(code);
  return r;
}
const S = checkSql(SQL);
const OPS = opsEcon(SRC);
ok(S.draft, 'S.header says draft, NOT applied');
ok(S.tx && S.verify, 'S.one transaction, ends with a verify SELECT');
{
  const keys = Object.keys(OPS).sort(), seeded = Object.keys(S.seed).sort();
  ok(JSON.stringify(keys) === JSON.stringify(seeded), 'S.tuning seed covers exactly the OPS_ECON types (' + keys.length + ')', 'missing ' + keys.filter((k) => !S.seed[k]) + ' extra ' + seeded.filter((k) => !OPS[k]));
  const bad = keys.filter((k) => !S.seed[k] || S.seed[k][0] !== OPS[k].ratePerWorkerHr || S.seed[k][1] !== OPS[k].salaryPerWorkerHr || S.seed[k][2] !== OPS[k].maxWorkers);
  ok(bad.length === 0, 'S.every seeded rate / salary / maxWorkers equals OPS_ECON', bad.join(','));
}
ok(S.seedNoClobber, 'S.seed is ON CONFLICT DO NOTHING - a re-run never undoes an admin retune');
ok(S.rls, 'S.RLS enabled on corp_op_econ and corp_op_clock');
ok(S.econWritesAdmin, 'S.corp_op_econ: insert/update/delete are admin-only on both sides, no bare true');
ok(S.clockNoWritePolicy && S.clockRevoked, 'S.corp_op_clock: members read, no client write policy, writes revoked');
ok(S.idemPolicies, 'S.every policy is dropped before it is created (re-runnable)');
ok(S.definer && S.grants, 'S.corp_op_collect is SECURITY DEFINER with a pinned search_path; authenticated only');
ok(S.noAmountParam, 'S.the client cannot name an amount: (p_op_id, p_supply) only');
ok(S.member && S.founder, 'S.caller must be a corp member (is_corp_member) and the founder or an officer');
{
  // The officer set must be exactly what the live cop_upd policy (and the
  // client claim it gates) admits today — collecting may not widen.
  ok(S.roles === 'ceo,corp ceo,founder,owner', 'S.officer roles == live cop_upd set (founder, owner, ceo, corp ceo)', S.roles);
}
ok(S.capH === numConst('OP_ACCRUAL_CAP_H'), 'S.accrual cap ' + S.capH + ' h == OP_ACCRUAL_CAP_H');
const _se = /const OP_SITE_EFF_MIN = ([\d.]+), OP_SITE_EFF_MAX = ([\d.]+);/.exec(SRC) || [];
ok(S.siteMin === Number(_se[1]) && S.siteMax === Number(_se[2]), 'S.site efficiency clamp [' + S.siteMin + ', ' + S.siteMax + '] == OP_SITE_EFF_MIN/MAX');
ok(S.mktMul === 1, 'S.market multiplier is 1 (no trustworthy server source - see header)');
ok(S.supplyClamp, 'S.p_supply clamped to [0, 1], NaN treated as 1');
ok(S.npcCap && S.wCap && S.staffAgreed, 'S.NPC workers capped at max_workers, NPC + agreed staff capped at max_workers');
ok(S.cas && S.casBeforePay, 'S.clock is compare-and-set, and checked BEFORE any treasury row is written');
ok(S.locks, 'S.corporation then operation locked FOR UPDATE (payroll lock order)');
ok(S.twoRows, 'S.exactly one op_salary (-pay) and one op_revenue (+net) insert');
ok(S.noBalanceUpdate, 'S.append-only: no UPDATE of corp_treasury, no balance column');
ok(S.short, 'S.treasury short of wages: pay what is there, gross halved (the client rule)');
ok(S.prevArgs.includes('v_clock.last_collect_at') && S.prevArgs.includes('v_meta_ts') && S.prevArgs.includes('v_rev_ts'),
  'S.accrual starts at the LATEST of server clock, meta.lastCollect and last op_revenue', S.prevArgs.join(','));
ok(S.revokes146, 'S.the sql/146 client-figure RPC is revoked from clients');
{
  const tail = stripSqlComments(SQL146.slice(SQL146.lastIndexOf('grant execute on function public.corp_treasury_op_revenue'), SQL146.indexOf('\ncommit;\n')));
  ok(/to_regprocedure\('public\.corp_op_collect\(uuid,numeric\)'\) is not null/.test(tail) && /revoke all on function public\.corp_treasury_op_revenue\(uuid, bigint, text\) from public, anon, authenticated/.test(tail),
    'S.sql/146 re-run after 151 revokes the client-figure RPC again (its grant is followed by the guard)');
  ok(/sql\/146 FIRST, then this file/.test(SQL), 'S.151 documents the order: 146 then 151');
}

// ═══ M · a model parsed from the SQL ═════════════════════════════════════════
console.log('\nM · model from the SQL text');
function sqlExprToJs(e) {
  return e.replace(/v_econ\.rate_per_worker_hr/g, 'E.rate').replace(/v_econ\.salary_per_worker_hr/g, 'E.sal')
    .replace(/\bc_mkt_mul\b/g, 'K.mkt').replace(/\bv_(w|npc|supply|site|hrs)\b/g, 'V.$1');
}
function makeServer(S, opts) {
  const o = opts || {};
  const gross = new Function('E', 'K', 'V', 'return (' + sqlExprToJs(S.grossExpr) + ');');
  const salary = new Function('E', 'K', 'V', 'return (' + sqlExprToJs(S.salaryExpr) + ');');
  const H = 3600e3;
  const st = { now: o.now || Date.UTC(2026, 8, 17, 12), clock: {}, rows: [], bal: o.bal == null ? 1e9 : o.bal, ops: {} };
  const pick = { 'v_clock.last_collect_at': (x) => x.clock, v_meta_ts: (x) => x.meta, v_rev_ts: (x) => x.rev, 'v_op.created_at': (x) => x.created };
  function read(opId, supply) {
    const op = st.ops[opId]; const E = S.seed[op.type];
    const e = { E: { rate: E[0], sal: E[1], max: E[2] } };
    const lastRev = Math.max(-Infinity, ...st.rows.filter((r) => r.ref === opId && r.kind === 'op_revenue').map((r) => r.at));
    const stamps = { clock: st.clock[opId], meta: op.meta, rev: isFinite(lastRev) ? lastRev : undefined, created: op.created };
    const args = S.prevArgs.map((a) => (a.startsWith('v_now') ? st.now - 36 * H : (pick[a] ? pick[a](stamps) : undefined))).filter((v) => v != null);
    const prev = Math.min(st.now, Math.max(...args));
    const hrs = Math.min(S.capH, Math.max(0, (st.now - prev) / H));
    let sup = supply == null || Number.isNaN(supply) ? 1 : supply; sup = Math.min(1, Math.max(0, sup));
    const npc = Math.min(Math.max(0, op.workers), e.E.max);
    const w = Math.min(e.E.max, npc + (op.staff || 0));
    const V = { w, npc, supply: sup, site: 1, hrs };
    let g = Math.floor(gross(e.E, { mkt: S.mktMul }, V)); const sOwed = Math.floor(salary(e.E, { mkt: S.mktMul }, V));
    const bal = st.rows.reduce((s, r) => s + r.amount, st.bal);
    let pay = sOwed, short = false;
    if (bal < sOwed) { short = true; pay = Math.max(0, Math.floor(bal)); g = Math.floor(g * 0.5); }
    return { opId, readClock: st.clock[opId], hours: +hrs.toFixed(6), workers: w, workers_npc: npc, workers_staff: op.staff || 0, gross: g, salary: pay, net: Math.max(0, g - pay), wages_short: short, supply: sup };
  }
  function commit(x) {
    if (S.cas) { if (st.clock[x.opId] !== x.readClock) return { error: { code: '40001', message: 'already collected from another tab or device' } }; }
    st.clock[x.opId] = st.now;
    st.ops[x.opId].meta = st.now;
    if (x.salary > 0) st.rows.push({ ref: x.opId, kind: 'op_salary', amount: -x.salary, at: st.now });
    if (x.net > 0) st.rows.push({ ref: x.opId, kind: 'op_revenue', amount: x.net, at: st.now });
    return { data: Object.assign({ source: 'server', op_id: x.opId, last_collect_ms: st.now, prev_collect_ms: 0 }, x) };
  }
  const rpc = (opId, supply) => commit(read(opId, supply));
  return { st, read, commit, rpc };
}
const H = 3600e3;
{
  // LIVE, 2026-09-17, rolled-back DO block on ktsiasyjusesawtrwrjc (see the report).
  const LIVE = {
    C1: { type: 'transport', workers: 10, staff: 0, hrs: 36, supply: 7, gross: 360000, salary: 108000, net: 252000 },
    C4: { type: 'construction', workers: 7, staff: 0, hrs: 4.076804, supply: 0.5, gross: 11415, salary: 5707, net: 5708 },
    C5: { type: 'construction', workers: 10, staff: 9, hrs: 4.292144, supply: 1, gross: 65240, salary: 8584, net: 56656 },
  };
  for (const [k, v] of Object.entries(LIVE)) {
    const srv = makeServer(S);
    srv.st.ops.x = { type: v.type, workers: v.workers, staff: v.staff, meta: srv.st.now - v.hrs * H, created: 0 };
    const d = srv.rpc('x', v.supply).data;
    ok(d.gross === v.gross && d.salary === v.salary && d.net === v.net,
      'M.model from the SQL text reproduces live ' + k + ' (' + v.type + ', ' + (v.workers + v.staff) + ' workers, ' + v.hrs + ' h): ' + d.gross + ' / ' + d.salary + ' / ' + d.net,
      JSON.stringify(d));
  }
}
function interleave(S) {
  const srv = makeServer(S);
  srv.st.ops.t = { type: 'transport', workers: 10, meta: srv.st.now - 48 * H, created: 0 };
  const a = srv.read('t', 1), b = srv.read('t', 1);        // two tabs read before either writes
  const ra = srv.commit(a), rb = srv.commit(b);
  const revenue = srv.st.rows.filter((r) => r.kind === 'op_revenue').reduce((s, r) => s + r.amount, 0);
  return { ra, rb, revenue };
}
{
  const r = interleave(S);
  ok(!r.ra.error && r.rb.error && r.rb.error.code === '40001' && r.revenue === 252000, 'M.two tabs read the same clock: the second CAS fails, revenue paid once (252000)', JSON.stringify(r.revenue));
  const srv = makeServer(S);
  srv.st.ops.t = { type: 'transport', workers: 10, meta: srv.st.now - 48 * H, created: 0 };
  const first = srv.rpc('t', 1).data, second = srv.rpc('t', 1).data;
  ok(first.net === 252000 && second.hours === 0 && second.net === 0 && second.salary === 0, 'M.an immediate second collect pays 0 (live C2 said the same)');
  srv.st.ops.t.meta = srv.st.now - 72 * H;   // the CEO rewinds meta through cop_upd
  const third = srv.rpc('t', 1).data;
  ok(third.net === 0 && third.hours === 0, 'M.a rewound meta.lastCollect pays 0 (live C3 said the same)');
  const lie = makeServer(S); lie.st.ops.t = { type: 'transport', workers: 10000, meta: lie.st.now - 48 * H, created: 0 };
  const d = lie.rpc('t', 1e9).data;
  ok(d.workers === 10 && d.gross === 360000 && d.salary === 108000, 'M.workers=10000 and supply=1e9 earn and bill exactly the capped figure');
  const poor = makeServer(S, { bal: 50000 }); poor.st.ops.t = { type: 'transport', workers: 10, meta: poor.st.now - 48 * H, created: 0 };
  const p = poor.rpc('t', 1).data;
  ok(p.wages_short && p.salary === 50000 && p.gross === 180000 && p.net === 130000, 'M.treasury short: pays the 50000 it has, gross halved', JSON.stringify(p));
}
{
  // NEGATIVE CONTROLS: the same model with the CAS removed from the SQL, and
  // with the accrual start reduced to meta.lastCollect alone.
  const noCas = checkSql(SQL.replace(' and last_collect_at = v_clock.last_collect_at;', ';'));
  ok(!noCas.cas, 'NEG.M1 static check catches a CAS-less clock update');
  const r = interleave(noCas);
  ok(!r.ra.error && !r.rb.error && r.revenue === 504000, 'NEG.M1 driven: the CAS-less copy pays the same 36 h twice (504000)', r.revenue);
  const metaOnly = checkSql(SQL.replace('greatest(v_clock.last_collect_at, v_meta_ts, v_rev_ts, v_op.created_at, v_now - interval \'36 hours\')', 'greatest(v_meta_ts, v_now - interval \'36 hours\')'));
  ok(!(metaOnly.prevArgs.includes('v_clock.last_collect_at')), 'NEG.M2 static check catches an accrual start that trusts meta alone');
  const srv = makeServer(metaOnly);
  srv.st.ops.t = { type: 'transport', workers: 10, meta: srv.st.now - 48 * H, created: 0 };
  srv.rpc('t', 1); srv.st.ops.t.meta = srv.st.now - 72 * H;
  const again = srv.rpc('t', 1).data;
  ok(again.net === 252000, 'NEG.M2 driven: trusting meta, a CEO rewind is paid a second full 36 h', again.net);
  const noCap = checkSql(SQL.replace('v_npc := least(greatest(0, coalesce(v_op.workers, 0)), v_econ.max_workers);', 'v_npc := greatest(0, coalesce(v_op.workers, 0));'));
  ok(!noCap.npcCap, 'NEG.M3 static check catches uncapped NPC workers');
  const seedDrift = checkSql(SQL.replace("('rail',          3600,", "('rail',          3700,"));
  ok(seedDrift.seed.rail[0] !== OPS.rail.ratePerWorkerHr, 'NEG.M4 a drifted seed row is seen as drift');
  const widened = checkSql(SQL.replace("in ('founder', 'owner', 'ceo', 'corp ceo')", "in ('founder', 'owner', 'ceo', 'corp ceo', 'member')"));
  ok(widened.roles !== S.roles, 'NEG.M5 widening the officer set is caught');
}

// ═══ C · the real client functions ══════════════════════════════════════════
console.log('\nC · client (real functions, fake servers)');
function clientWorld(src, mode, srvOpts) {
  const server = makeServer(S, srvOpts);
  const calls = [], clientRows = [], legacyRevenue = [], toasts = [], salvage = {}, burned = {};
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'corp_op_collect') {
        if (mode === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.corp_op_collect(p_op_id, p_supply) in the schema cache' } };
        if (mode === 'refuse') return { data: null, error: { code: '42501', message: 'only the founder or CEO collects production' } };
        if (mode === 'down') throw new Error('network');
        return server.rpc(args.p_op_id, args.p_supply);
      }
      if (name === 'corp_treasury_op_revenue') { legacyRevenue.push(args); return { data: {}, error: null }; }
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    },
    from: () => ({ insert: async (row) => { clientRows.push(row); return { error: null }; } }),
  };
  const env = {
    Cloud: { client }, Corp: { treasury: 1e9, mine: { id: 'corp' } }, Profile: { cloud: { userId: 'u' } },
    _jbNum: (x) => Number(x) || 0,
    corpTreasuryFetch: async () => {}, corpStaffPayroll: async () => {},
    _opTreasuryRow: async (amt, kind) => { clientRows.push({ amount: amt, kind }); return true; },
    _wagePoolCredit: () => 0, saveProfile: () => {}, addCinders: () => {},
    spendResources: (m) => { for (const k in m) burned[k] = (burned[k] | 0) + m[k]; },
    _nodeTierResBonus: () => ({}),
    addSalvage: (y) => { for (const k in y) salvage[k] = (salvage[k] | 0) + y[k]; },
    cxProduce: () => {}, showToast: (m) => toasts.push(m), _jbLocalOpsList: () => [],
    _opComputed: () => { throw new Error('the server path must not re-measure'); },
  };
  const body = ['_walletRpcUnavailable', '_ctRpcMissing', '_ctOpRevenue', '_opServerCollect', '_opServerPre', '_opSettle'].map((n) => fnText(n, src)).join('\n');
  const api = new Function(...Object.keys(env), body + '\nreturn { _opServerCollect, _opServerPre, _opSettle };')(...Object.values(env));
  return { api, server, calls, clientRows, legacyRevenue, toasts, salvage, burned };
}
// What _opComputed would have measured on this device: 36 h of a 10-worker transport-like op.
const pre = (hrs, extra) => Object.assign({ hrs, supply: 1, gross: 999999, salary: 1, net: 999998,
  yields: { fuel: Math.floor(10 * 2 * hrs) }, inputsUsed: { metal: Math.floor(10 * 1 * hrs) } }, extra || {});
async function driveCollect(W, c) {
  const o = { id: 't', op_type: 'transport', workers: 10, meta: { lastCollect: 1 } };
  const r = await W.api._opServerCollect(o, c);
  if (!r.ok) return { r, o };
  const s = await W.api._opSettle(o, W.api._opServerPre(c, r.res));
  return { r, s, o };
}
function seedOp(W, hrs) { W.server.st.ops.t = { type: 'transport', workers: 10, meta: W.server.st.now - hrs * H, created: 0 }; }
async function clientChecks(src, label) {
  const out = {};
  { // 1. a 151 database
    const W = clientWorld(src, 'ok'); seedOp(W, 48);
    const { r, s, o } = await driveCollect(W, pre(36));
    out.adopts = !!(r.ok && s && s.gross === 360000 && s.salary === 108000 && s.net === 252000);
    out.noClientRows = W.clientRows.length === 0 && W.legacyRevenue.length === 0;
    out.serverRows = W.server.st.rows.length === 2;
    out.yieldsFull = W.salvage.fuel === 720 && W.burned.metal === 360;
    out.metaMirrored = o.meta.lastCollect === W.server.st.now;
    out.sentSupply = W.calls[0] && W.calls[0][0] === 'corp_op_collect' && W.calls[0][1].p_supply === 1 && !('p_amount' in W.calls[0][1]);
    // 2. immediately again: the server pays 0 and so do the resources
    const again = await driveCollect(W, pre(36));
    out.secondZero = again.r.ok && again.s.net === 0 && W.salvage.fuel === 720 && W.server.st.rows.length === 2;
  }
  { // 3. this device's clock claims 72 h, the server measured 18 h
    const W = clientWorld(src, 'ok'); seedOp(W, 18);
    await driveCollect(W, pre(72));
    out.yieldsCapped = W.salvage.fuel === Math.floor(1440 * 0.25) && W.burned.metal === Math.floor(720 * 0.25);
  }
  { // 3b. device measured LESS than the server: never more than it measured
    const W = clientWorld(src, 'ok'); seedOp(W, 36);
    await driveCollect(W, pre(9));
    out.yieldsNotInflated = W.salvage.fuel === 180;
  }
  { // 4. supply lies
    const W = clientWorld(src, 'ok'); seedOp(W, 36);
    await W.api._opServerCollect({ id: 't', meta: {} }, pre(36, { supply: 7 }));
    await W.api._opServerCollect({ id: 't', meta: {} }, pre(36, { supply: NaN }));
    await W.api._opServerCollect({ id: 't', meta: {} }, pre(36, { supply: -3 }));
    out.supplyClamped = W.calls.map((c) => c[1].p_supply).join(',') === '1,1,0';
  }
  { // 5. wages short on the server: output halved, no client treasury write
    const W = clientWorld(src, 'ok', { bal: 50000 }); seedOp(W, 48);
    const { s } = await driveCollect(W, pre(36));
    out.short = !!(s && s.wagesShort && s.net === 130000 && W.salvage.fuel === 360 && W.clientRows.length === 0);
  }
  { // 6. pre-151: legacy, and nothing written
    const W = clientWorld(src, 'missing'); seedOp(W, 48);
    const r = await W.api._opServerCollect({ id: 't', meta: {} }, pre(36));
    out.legacy = r.legacy === true && !r.ok && W.clientRows.length === 0;
  }
  { // 7. refused: NOT legacy, nothing written, no fallback
    const W = clientWorld(src, 'refuse'); seedOp(W, 48);
    const r = await W.api._opServerCollect({ id: 't', meta: {} }, pre(36));
    out.refusedNoFallback = !r.ok && !r.legacy && W.clientRows.length === 0 && W.legacyRevenue.length === 0;
    const W2 = clientWorld(src, 'down'); seedOp(W2, 48);
    const r2 = await W2.api._opServerCollect({ id: 't', meta: {} }, pre(36));
    out.downNoFallback = !r2.ok && !r2.legacy;
  }
  { // 8. a local (personally funded) op never calls the server
    const W = clientWorld(src, 'ok');
    const r = await W.api._opServerCollect({ id: 'local_1', meta: { localOnly: true } }, pre(36));
    out.localLegacy = r.legacy === true && W.calls.length === 0;
  }
  { // 9. without `server`, _opSettle is the pre-151 path: it writes wages and revenue itself
    const W = clientWorld(src, 'ok');
    const s = await W.api._opSettle({ id: 't', op_type: 'transport', meta: {} }, { gross: 1000, salary: 100, yields: {}, inputsUsed: {} });
    out.legacyPathIntact = s.net === 900 && W.clientRows.some((x) => x.kind === 'op_salary') && W.legacyRevenue.length === 1;
  }
  return out;
}
const HANDLER_OK = (src) => {
  const i = src.indexOf("} else if (a.kind === 'opCollect') {");
  const h = src.slice(i, i + 9000);
  const iSrv = h.indexOf('await _opServerCollect(o, c)'), iLegacy = h.indexOf('if (!_srv.legacy) {'), iClaim = h.indexOf('await _opClaimCollect(o)');
  const srvBlock = h.slice(iLegacy, iClaim);
  const j = src.indexOf("} else if (a.kind === 'opAssign') {");
  const g = src.slice(j, j + 6000);
  return {
    order: iSrv > 0 && iLegacy > iSrv && iClaim > iLegacy,
    returns: /return;\s*\}\s*_jbOpBusy\[a\.opId\] = true;/.test(srvBlock + '_jbOpBusy[a.opId] = true;') && (srvBlock.match(/return;/g) || []).length >= 2,
    refusedPaysNothing: srvBlock.indexOf('nothing was paid') > 0 && srvBlock.indexOf('nothing was paid') < srvBlock.indexOf('_opSettle('),
    adoptsServer: /await _opSettle\(o, _opServerPre\(c, _srv\.res\)\)/.test(srvBlock),
    assign: /const _srv = await _opServerCollect\(o, _c0\);/.test(g) && /if \(!_srv\.ok\) \{[^\n]*return; \}/.test(g) && /_opSettle\(o, _opServerPre\(_c0, _srv\.res\)\)/.test(g)
      && /lastCollect: _srvLast \|\| Date\.now\(\)/.test(g),
  };
};
const C = await clientChecks(SRC, 'tree');
ok(C.adopts, 'C.151: the client adopts the server figures 360000 / 108000 / 252000 (its own estimate said 999999)');
ok(C.noClientRows, 'C.151: the client writes NO treasury row and never calls corp_treasury_op_revenue');
ok(C.serverRows, 'C.151: the server wrote exactly two rows (op_salary, op_revenue)');
ok(C.sentSupply, 'C.151: the call carries p_op_id and p_supply only - no amount');
ok(C.yieldsFull, 'C.151: resources are granted and inputs burned for the hours the server paid');
ok(C.metaMirrored, "C.151: the row's lastCollect mirrors the server clock (cooldown display)");
ok(C.secondZero, 'C.151: an immediate second collect pays 0 Cinder and 0 resources');
ok(C.yieldsCapped, 'C.a device clock claiming 72 h against a server 18 h gets 18 h of resources');
ok(C.yieldsNotInflated, 'C.a device that measured 9 h is never scaled above its own measurement');
ok(C.supplyClamped, 'C.p_supply is clamped on the way out (7 -> 1, NaN -> 1, -3 -> 0)');
ok(C.short, 'C.wages short on the server: net adopted, resources halved, no client row');
ok(C.legacy, 'C.pre-151 database (PGRST202): legacy, so the handler keeps the claim path');
ok(C.refusedNoFallback, 'C.a refusal is NOT legacy: no fallback, nothing written');
ok(C.downNoFallback, 'C.a network failure is NOT legacy either');
ok(C.localLegacy, 'C.a personally funded op never calls the server');
ok(C.legacyPathIntact, 'C._opSettle without a server answer is the pre-151 path, unchanged');
{
  const hk = HANDLER_OK(SRC);
  ok(hk.order, 'C.handler: server collect first, legacy test, claim only after');
  ok(hk.returns, 'C.handler: the server branch returns before the claim path in both outcomes');
  ok(hk.refusedPaysNothing, 'C.handler: a refused server collect says nothing was paid, before any settle');
  ok(hk.adoptsServer, "C.handler: settles from the server's answer (_opServerPre)");
  ok(hk.assign, 'C.re-staffing settles through the server first, stops on a refusal, and keeps the server clock');
}

// ═══ N · client negative controls ════════════════════════════════════════════
console.log('\nN · client negative controls');
{
  /* Pinned, not HEAD: once d8f1a25ccd (the server-collect client) was committed,
     HEAD carries the fix and this control went red for the wrong reason.
     35ce5ec19c is the last client before it. PRE_FIX_REF=HEAD shows the pin
     matters. Same pattern as _corptreasury_smoke / _mayorpay_mint_smoke. */
  const PRE_FIX_REF = process.env.PRE_FIX_REF || '35ce5ec19c';
  const g = spawnSync('git', ['-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'show', PRE_FIX_REF + ':public/index.html'], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  const HEAD = g.status === 0 ? LF(g.stdout) : '';
  ok(HEAD.length > 1e6, 'N0 HEAD index.html read (' + HEAD.length + ' chars)');
  const usesServer = (src) => /rpc\('corp_op_collect'/.test(src) && src.includes('await _opServerCollect(o, c)');
  const sendsFigure = (src) => /rpc\('corp_treasury_op_revenue', \{ p_op_id: o\.id, p_amount: net/.test(src);
  ok(!usesServer(HEAD) && sendsFigure(HEAD), 'N1 HEAD client: the old client-figure path is detected (no corp_op_collect; sends p_amount: net)');
  ok(usesServer(SRC), 'N1 working tree: the collect uses the server figure');
  let threw = false; try { fnText('_opServerCollect', HEAD); } catch (e) { threw = true; }
  ok(threw, 'N1 HEAD has no _opServerCollect to drive');
}
async function mutant(label, from, to, pred) {
  if (!SRC.includes(from)) { ok(false, label + ' (anchor missing)'); return; }
  const M = SRC.replace(from, to);
  const r = await clientChecks(M, label);
  ok(pred(r), label, JSON.stringify(r));
}
await mutant('N2 mutant: the settle also banks net itself -> double revenue is caught',
  '  if (!srv && net > 0) {', '  if (net > 0) {', (r) => r.noClientRows === false);
await mutant('N3 mutant: fall back on ANY error -> refusal falls back, caught',
  '      if (_ctRpcMissing(r.error)) return { ok: false, legacy: true };\n      const raced', '      if (true) return { ok: false, legacy: true };\n      const raced', (r) => r.refusedNoFallback === false);
await mutant('N4 mutant: yield ratio not capped at 1 -> device clock inflates resources, caught',
  'Math.max(0, Math.min(1, hrs / c.hrs))', 'Math.max(0, hrs / c.hrs)', (r) => r.yieldsNotInflated === false);
await mutant('N5 mutant: supply not clamped -> caught',
  'Math.max(0, Math.min(1, Number(c.supply)))', 'Number(c.supply)', (r) => r.supplyClamped === false);
{
  const M = SRC.replace('const _srv = await _opServerCollect(o, c);\n          if (!_srv.legacy) {', 'const _srv = await _opServerCollect(o, c);\n          if (false) {');
  ok(M !== SRC, 'N6 anchor found');
  ok(!HANDLER_OK(M).order, 'N6 mutant: a handler that never takes the server branch is caught');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
