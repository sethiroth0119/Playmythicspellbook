/* 🔐 ONLY A FOUNDER'S HIRE MAKES A CORP MEMBER (sql/149, draft).

   The hole (live policies read 2026-09-17): corp_members.cm_ins was
   `with check (user_id = auth.uid())`, cm_upd had no corp_id/role limit,
   corp_requests.creq_ins took any status and creq_upd was `with check (true)`.
   So any player could insert themselves into any corporation, move or promote
   their own row, file or flip their own application to 'hired', and a founder
   could re-point a request at somebody who never applied. is_corp_member()
   then opened that corporation's vault and treasury to them (sql/045, 143,
   146 all trust it).

   sql/149 is proven on the live database in rolled-back DO blocks (builder
   report): HEAD lets the stranger insert (then is_corp_member=true, 4
   treasury rows, 26 vault rows visible), move, promote, self-hire and
   re-point; with 149's statements run first every one of those is 42501,
   corp_hire + corp_join_accept yields exactly one row, and pg_policies /
   corp_members / corp_requests hash identically before and after.

   This suite cannot reach Postgres, so it guards what silently undoes that:
     S  THE MIGRATION. Idempotent, RLS + triggers in the same file, the exact
        clauses that close each hole, a definer accept RPC that checks owner
        and status, and a verify select at the end.
     C  THE CLIENT WRITER INVENTORY. A corp_members insert/upsert may appear
        only inside _corpWriteOwnMembership; the hire fallbacks are behind
        _jbRpcMissing (a refusal is never answered with a direct write);
        "join by tag" files an application.
     M  A STORE MODEL whose rules are PARSED from sql/149 (and a HEAD rule set
        matching the live policies): the same exploit probes as the live DO
        block.
     H  THE SHIPPED CLIENT (_corpEnsureRun, _corpAcceptHire,
        _corpWriteOwnMembership, _jbRpcMissing lifted out of index.html) booted
        against the model: founder hires → applicant boots → one membership;
        the same with corp_join_accept absent (pre-149 fallback); a vault-only
        stranger is not admitted; a refusal writes nothing; a founder still
        self-heals.
     N  NEGATIVE CONTROLS. HEAD's policies let every exploit land; HEAD's
        client cannot land a hire against 149 and fails the inventory; SQL and
        client mutants are each caught.

   Run: node _corpmembership_smoke.mjs */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import vm from 'vm';
import * as acorn from 'acorn';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x));
  if (c) passes++; else fails++;
};

const SQL_PATH = './sql/149_corp_membership_boundary.sql';
const SQL = readFileSync(SQL_PATH, 'utf8');
const INDEX = readFileSync('./public/index.html', 'utf8');
/* The negative-control client is the last commit BEFORE this fix, pinned by
   hash — not HEAD, which becomes the fixed code the moment this is committed
   and would turn every control below into a false FAIL. */
const PRE_FIX_REV = '3fd3156dc5';
let HEAD_INDEX = null;
try {
  HEAD_INDEX = execFileSync('git', ['-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'show', PRE_FIX_REV + ':public/index.html'],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) { HEAD_INDEX = null; }

// ── source helpers ──────────────────────────────────────────────────────────
function extractFrom(src, name) {
  let at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = src.indexOf('\nasync function ' + name + '(');
  if (at < 0) return null;
  const slice = src.slice(at + 1, at + 1 + 400000);
  let depth = 0, started = false;
  for (const tok of acorn.tokenizer(slice, { ecmaVersion: 'latest' })) {
    const l = tok.type.label;
    if (l === '{' || l === '${') { depth++; started = true; }
    else if (l === '}') { depth--; if (started && depth === 0) return slice.slice(0, tok.end); }
  }
  return null;
}
// Enclosing top-level-ish function name for an offset (nearest preceding
// `function NAME(` whose extracted body spans the offset).
function enclosingFn(src, off) {
  const re = /\n(?:async )?function ([A-Za-z0-9_$]+)\(/g;
  let m, best = null;
  const starts = [];
  while ((m = re.exec(src)) && m.index < off) starts.push([m.index, m[1]]);
  for (let i = starts.length - 1; i >= 0 && i >= starts.length - 40; i--) {
    const [at, name] = starts[i];
    const body = extractFrom(src.slice(at), name);
    if (body && at + 1 + body.length > off) { best = name; break; }
  }
  return best;
}

// ── SQL helpers ─────────────────────────────────────────────────────────────
const stripComments = (s) => s.replace(/--[^\n]*/g, '');
function policyBlock(sql, name) {
  const m = new RegExp('create policy ' + name + '\\b[\\s\\S]*?;').exec(stripComments(sql));
  return m ? m[0].replace(/\s+/g, ' ') : '';
}
function fnBody(sql, name) {
  const s = stripComments(sql);
  const at = s.indexOf('function public.' + name + '(');
  if (at < 0) return '';
  const a = s.indexOf('$fn$', at);
  const b = s.indexOf('$fn$', a + 4);
  return a < 0 || b < 0 ? '' : s.slice(a + 4, b).replace(/\s+/g, ' ');
}
function listAfter(body, anchor) {
  const at = body.indexOf(anchor);
  if (at < 0) return null;
  const m = /not in \(([^)]*)\)/.exec(body.slice(at));
  return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')) : null;
}

/* The rule set the model enforces, read off the SQL text. Every flag is a
   specific clause; a mutant that drops the clause flips the flag and the
   exploit probes below must notice. */
function parseRules(sql) {
  const cmIns = policyBlock(sql, 'cm_ins');
  const creqIns = policyBlock(sql, 'creq_ins');
  const creqUpd = policyBlock(sql, 'creq_upd');
  const cmG = fnBody(sql, '_corp_members_guard');
  const rqG = fnBody(sql, '_corp_requests_guard');
  const acc = fnBody(sql, 'corp_join_accept');
  const founderPart = rqG.slice(rqG.indexOf('if v_founder then'), rqG.indexOf('return new; end if;', rqG.indexOf('if v_founder then')));
  const requesterPart = rqG.slice(rqG.indexOf('return new; end if;', rqG.indexOf('if v_founder then')));
  const cmTrig = /create trigger corp_members_guard\s+before update on public\.corp_members/.test(sql);
  const rqTrig = /create trigger corp_requests_guard\s+before update on public\.corp_requests/.test(sql);
  return {
    name: 'sql/149',
    cmInsFounderOnly: /user_id = auth\.uid\(\)/.test(cmIns) && /c\.id = corp_members\.corp_id and c\.founder_id = auth\.uid\(\)/.test(cmIns),
    cmGuard: cmTrig && /current_user not in \('authenticated', 'anon'\)/.test(cmG),
    cmFreezeIds: /new\.user_id is distinct from old\.user_id or new\.corp_id is distinct from old\.corp_id then raise/.test(cmG),
    cmFreezeRole: /new\.role is distinct from old\.role then raise/.test(cmG),
    creqInsPending: /user_id = auth\.uid\(\) and status = 'pending'/.test(creqIns),
    creqUpdCheck: /with check \(user_id = auth\.uid\(\) or exists/.test(creqUpd),
    creqGuard: rqTrig && /current_user not in \('authenticated', 'anon'\)/.test(rqG),
    creqFreezeIds: /new\.user_id is distinct from old\.user_id or new\.corp_id is distinct from old\.corp_id then raise/.test(rqG),
    founderStatuses: listAfter(founderPart, 'new.status is distinct from old.status'),
    requesterStatuses: listAfter(requesterPart, 'new.status is distinct from old.status'),
    creqRoleOnlyPending: /new\.role is distinct from old\.role and new\.status <> 'pending' then raise/.test(requesterPart),
    hasJoinAccept: /create or replace function public\.corp_join_accept\(p_request_id uuid\)[\s\S]*?security definer/.test(stripComments(sql)),
    acceptChecksOwner: /if r\.user_id <> v_uid then raise/.test(acc),
    acceptHiredOnly: /if r\.status = 'hired' then insert into public\.corp_members[^;]*; update public\.corp_requests q set status = 'joined' where q\.id = r\.id; elsif r\.status <> 'joined' then raise/.test(acc),
    hasCorpHire: true,
  };
}
/* The live policies, 2026-09-17 (pg_policies; see the header). */
const HEAD_RULES = {
  name: 'HEAD (live)', cmInsFounderOnly: false, cmGuard: false, cmFreezeIds: false, cmFreezeRole: false,
  creqInsPending: false, creqUpdCheck: false, creqGuard: false, creqFreezeIds: false,
  founderStatuses: null, requesterStatuses: null, creqRoleOnlyPending: false,
  hasJoinAccept: false, acceptChecksOwner: false, acceptHiredOnly: false, hasCorpHire: true,
};

// ── the store model ─────────────────────────────────────────────────────────
const UNIQUE = { corp_members: ['corp_id,user_id'], corp_requests: ['id', 'corp_id,user_id'] };
function makeStore(R, seed) {
  const db = JSON.parse(JSON.stringify(seed));
  for (const t of ['corporations', 'corp_members', 'corp_requests', 'corp_vault']) db[t] = db[t] || [];
  const log = [];
  let uid = null, seq = 1;
  const E = (code, message) => ({ data: null, error: { code, message } });
  const founderOf = (corpId, u) => db.corporations.some((c) => c.id === corpId && c.founder_id === u);
  const keyOf = (r, k) => k.split(',').map((f) => r[f]).join('|');

  function memberUpdate(old, patch) {
    if (old.user_id !== uid) return 'rls';
    const nu = { ...old, ...patch };
    if (R.cmGuard) {
      if (R.cmFreezeIds && (nu.user_id !== old.user_id || nu.corp_id !== old.corp_id)) return 'trigger';
      if (R.cmFreezeRole && nu.role !== old.role) return 'trigger';
    }
    if (nu.user_id !== uid) return 'check';
    return nu;
  }
  function requestUpdate(old, patch) {
    const founder = founderOf(old.corp_id, uid);
    if (!(old.user_id === uid || founder)) return 'rls';
    const nu = { ...old, ...patch };
    if (R.creqGuard) {
      if (R.creqFreezeIds && (nu.user_id !== old.user_id || nu.corp_id !== old.corp_id)) return 'trigger';
      if (founder) {
        if (R.founderStatuses && nu.status !== old.status && !R.founderStatuses.includes(nu.status)) return 'trigger';
      } else {
        if (R.requesterStatuses && nu.status !== old.status && !R.requesterStatuses.includes(nu.status)) return 'trigger';
        if (R.creqRoleOnlyPending && nu.role !== old.role && nu.status !== 'pending') return 'trigger';
      }
    }
    if (R.creqUpdCheck && !(nu.user_id === uid || founderOf(nu.corp_id, uid))) return 'check';
    return nu;
  }
  function doInsert(table, row) {
    if (table === 'corp_members') {
      if (row.user_id !== uid || (R.cmInsFounderOnly && !founderOf(row.corp_id, uid))) return E('42501', 'new row violates row-level security policy for table "corp_members"');
      if (db.corp_members.some((r) => keyOf(r, 'corp_id,user_id') === keyOf(row, 'corp_id,user_id'))) return E('23505', 'duplicate key');
      db.corp_members.push({ role: 'member', is_primary: false, ...row });
      return { data: null, error: null };
    }
    if (table === 'corp_requests') {
      const r = { role: 'member', status: 'pending', ...row };
      if (r.user_id !== uid || (R.creqInsPending && r.status !== 'pending')) return E('42501', 'new row violates row-level security policy for table "corp_requests"');
      if (db.corp_requests.some((x) => keyOf(x, 'corp_id,user_id') === keyOf(r, 'corp_id,user_id'))) return E('23505', 'duplicate key');
      db.corp_requests.push({ id: 'req-' + (seq++), ...r });
      return { data: null, error: null };
    }
    (db[table] = db[table] || []).push(row);
    return { data: null, error: null };
  }
  function doUpdate(table, rows, patch) {
    const fn = table === 'corp_members' ? memberUpdate : table === 'corp_requests' ? requestUpdate : (o) => ({ ...o, ...patch });
    const out = [];
    for (const o of rows) {
      const r = fn(o, patch);
      if (r === 'rls') continue;                     // USING hides the row: 0 rows, no error
      if (typeof r === 'string') return E('42501', table + ': refused by ' + r);
      out.push([o, r]);
    }
    for (const [o, n] of out) Object.assign(o, n);
    return { data: null, error: null, count: out.length };
  }
  function run(st) {
    const t = st.table;
    const rows = (db[t] = db[t] || []);
    const hit = rows.filter((r) => st.filters.every((f) => f(r)));
    log.push({ table: t, op: st.op, uid, row: st.row, patch: st.patch });
    if (st.op === 'select') {
      let data = hit;
      if (st.lim != null) data = data.slice(0, st.lim);
      if (st.single) {
        if (data.length > 1) return E('PGRST116', 'multiple rows');
        return { data: data[0] ? { ...data[0] } : null, error: null };
      }
      return { data: data.map((r) => ({ ...r })), error: null };
    }
    if (st.op === 'insert') return doInsert(t, st.row);
    if (st.op === 'upsert') {
      const k = (st.opts && st.opts.onConflict) || 'id';
      if (!(UNIQUE[t] || []).includes(k)) return E('42P10', 'there is no unique or exclusion constraint matching the ON CONFLICT specification');
      const ex = rows.find((r) => keyOf(r, k) === keyOf(st.row, k));
      if (!ex) return doInsert(t, st.row);
      if (t === 'corp_requests' && !(ex.user_id === uid || founderOf(ex.corp_id, uid))) return E('42501', 'rls');
      return doUpdate(t, [ex], st.row);
    }
    if (st.op === 'update') return doUpdate(t, hit, st.patch);
    if (st.op === 'delete') {
      for (const r of hit) {
        const allowed = t === 'corp_members' || t === 'corp_requests' ? (r.user_id === uid || founderOf(r.corp_id, uid)) : true;
        if (allowed) rows.splice(rows.indexOf(r), 1);
      }
      return { data: null, error: null };
    }
    return E('XX000', 'unknown op');
  }
  function builder(table) {
    const st = { table, op: 'select', filters: [], row: null, patch: null, opts: null, lim: null, single: false };
    const known = {
      select() { return p; },
      eq(k, v) { st.filters.push((r) => r[k] === v); return p; },
      neq(k, v) { st.filters.push((r) => r[k] !== v); return p; },
      in(k, vs) { st.filters.push((r) => vs.includes(r[k])); return p; },
      limit(n) { st.lim = n; return p; },
      maybeSingle() { st.single = true; return p; },
      single() { st.single = true; return p; },
      insert(row) { st.op = 'insert'; st.row = row; return p; },
      upsert(row, opts) { st.op = 'upsert'; st.row = row; st.opts = opts || {}; return p; },
      update(patch) { st.op = 'update'; st.patch = patch; return p; },
      delete() { st.op = 'delete'; return p; },
      then(res, rej) { return Promise.resolve().then(() => run(st)).then(res, rej); },
    };
    const p = new Proxy(known, { get(o, k) { if (k in o) return o[k]; if (typeof k === 'symbol') return undefined; return () => p; } });
    return p;
  }
  async function rpc(name, args) {
    log.push({ rpc: name, uid, args });
    if (name === 'corp_hire') {
      if (!R.hasCorpHire) return E('PGRST202', 'Could not find the function public.corp_hire in the schema cache');
      const r = db.corp_requests.find((x) => x.id === args.p_request_id);
      if (!r) return E('P0001', 'corp_hire: no such application');
      if (!founderOf(r.corp_id, uid)) return E('P0001', 'corp_hire: not the founder of this corporation');
      if (!['pending', 'hired'].includes(r.status)) return { data: [], error: null };
      const m = db.corp_members.find((x) => x.user_id === r.user_id && x.corp_id === r.corp_id);
      if (m) Object.assign(m, { user_name: r.user_name || m.user_name, role: r.role || 'member' });
      else db.corp_members.push({ user_id: r.user_id, corp_id: r.corp_id, user_name: r.user_name || 'Member', role: r.role || 'member', is_primary: false });
      r.status = 'joined';
      return { data: db.corp_members.filter((x) => x.user_id === r.user_id && x.corp_id === r.corp_id), error: null };
    }
    if (name === 'corp_join_accept') {
      if (!R.hasJoinAccept) return E('PGRST202', 'Could not find the function public.corp_join_accept(p_request_id) in the schema cache');
      if (!uid) return E('42501', 'corp_join_accept: sign in first');
      if (!args || !args.p_request_id) return E('P0002', 'corp_join_accept: no application');
      const r = db.corp_requests.find((x) => x.id === args.p_request_id);
      if (!r) return E('P0002', 'corp_join_accept: no such application');
      if (R.acceptChecksOwner && r.user_id !== uid) return E('42501', 'corp_join_accept: not your application');
      const has = () => db.corp_members.some((x) => x.user_id === r.user_id && x.corp_id === r.corp_id);
      if (r.status === 'hired' || !R.acceptHiredOnly) {
        if (!has()) db.corp_members.push({ user_id: r.user_id, corp_id: r.corp_id, user_name: r.user_name || 'Member', role: r.role || 'member', is_primary: false });
        r.status = 'joined';
      } else if (r.status !== 'joined') return E('42501', 'corp_join_accept: this application has not been hired');
      return { data: db.corp_members.filter((x) => x.user_id === r.user_id && x.corp_id === r.corp_id).map((x) => ({ ...x })), error: null };
    }
    return E('PGRST202', 'Could not find the function public.' + name);
  }
  return {
    db, log, R,
    as(u) { uid = u; return this; },
    client: { from: builder, rpc },
    members: (u, c) => db.corp_members.filter((x) => x.user_id === u && (!c || x.corp_id === c)),
  };
}

const IDS = { founder: 'u-founder', founder2: 'u-founder2', stranger: 'u-stranger', app: 'u-app', app2: 'u-app2', left: 'u-left' };
const SEED = () => ({
  corporations: [
    { id: 'c-1', name: 'Anomaly', tag: 'ANOM', founder_id: IDS.founder, created_at: '2026-01-01' },
    { id: 'c-2', name: 'Other', tag: 'OTH', founder_id: IDS.founder2, created_at: '2026-01-02' },
  ],
  corp_members: [
    { user_id: IDS.founder, corp_id: 'c-1', user_name: 'Boss', role: 'founder', is_primary: false },
    { user_id: IDS.founder2, corp_id: 'c-2', user_name: 'Boss2', role: 'founder', is_primary: false },
    { user_id: IDS.stranger, corp_id: 'c-2', user_name: 'Str', role: 'member', is_primary: false },
  ],
  corp_requests: [],
  corp_vault: [],
});

// ── exploit probes (the live DO block, on the model) ────────────────────────
async function exploits(R) {
  const s = makeStore(R, SEED());
  const out = {};
  const c = s.client;
  let r;
  s.as(IDS.stranger);
  r = await c.from('corp_members').insert({ user_id: IDS.stranger, corp_id: 'c-1', user_name: 'x', role: 'member' });
  out.strangerInsert = !r.error && s.members(IDS.stranger, 'c-1').length === 1;
  s.db.corp_members = s.db.corp_members.filter((x) => !(x.user_id === IDS.stranger && x.corp_id === 'c-1'));
  r = await c.from('corp_members').update({ corp_id: 'c-1' }).eq('user_id', IDS.stranger).eq('corp_id', 'c-2');
  out.moveCorp = s.members(IDS.stranger, 'c-1').length === 1;
  s.db.corp_members.forEach((x) => { if (x.user_id === IDS.stranger) x.corp_id = 'c-2'; });
  r = await c.from('corp_members').update({ role: 'founder' }).eq('user_id', IDS.stranger).eq('corp_id', 'c-2');
  out.promote = s.members(IDS.stranger, 'c-2')[0].role === 'founder';
  s.db.corp_members.forEach((x) => { if (x.user_id === IDS.stranger) x.role = 'member'; });
  r = await c.from('corp_members').update({ user_name: 'renamed', is_primary: true }).eq('user_id', IDS.stranger).eq('corp_id', 'c-2');
  out.ownRename = !r.error && s.members(IDS.stranger, 'c-2')[0].user_name === 'renamed';

  s.as(IDS.app);
  r = await c.from('corp_requests').insert({ corp_id: 'c-1', user_id: IDS.app, user_name: 'App', role: 'member', status: 'pending' });
  out.filePending = !r.error;
  const req = s.db.corp_requests.find((x) => x.user_id === IDS.app && x.corp_id === 'c-1');
  r = await c.from('corp_requests').update({ status: 'hired' }).eq('id', req.id);
  out.selfHire = req.status === 'hired';
  req.status = 'pending';
  r = await c.from('corp_requests').insert({ corp_id: 'c-2', user_id: IDS.app, user_name: 'App', role: 'member', status: 'hired' });
  out.fileHired = !r.error;
  s.db.corp_requests = s.db.corp_requests.filter((x) => x.corp_id !== 'c-2');
  r = await c.from('corp_requests').upsert({ corp_id: 'c-1', user_id: IDS.app, user_name: 'App', role: 'Lawyer', status: 'pending' }, { onConflict: 'corp_id,user_id' });
  out.refile = !r.error && req.role === 'Lawyer';
  r = await c.from('corp_requests').update({ status: 'withdrawn' }).eq('id', req.id);
  out.withdraw = req.status === 'withdrawn';
  Object.assign(req, { status: 'pending', role: 'member' });

  s.as(IDS.founder);
  r = await c.from('corp_requests').update({ user_id: IDS.stranger }).eq('id', req.id);
  out.repointUser = req.user_id === IDS.stranger;
  Object.assign(req, { user_id: IDS.app, corp_id: 'c-1' });
  r = await c.from('corp_requests').update({ corp_id: 'c-2' }).eq('id', req.id);
  out.repointCorp = req.corp_id === 'c-2';
  Object.assign(req, { user_id: IDS.app, corp_id: 'c-1' });
  r = await c.from('corp_members').insert({ user_id: IDS.founder, corp_id: 'c-2', user_name: 'x', role: 'founder' });
  out.founderOtherCorp = !r.error;
  s.db.corp_members = s.db.corp_members.filter((x) => !(x.user_id === IDS.founder && x.corp_id === 'c-2'));
  r = await c.from('corp_requests').update({ status: 'joined' }).eq('id', req.id);
  out.founderSetsJoined = req.status === 'joined';
  req.status = 'pending';

  r = await c.rpc('corp_hire', { p_request_id: req.id });
  out.hire = !r.error;
  s.as(IDS.app);
  r = await c.rpc('corp_join_accept', { p_request_id: req.id });
  out.acceptAfterHire = !r.error;
  out.appRows = s.members(IDS.app).length;

  s.as(IDS.app2);
  await c.from('corp_requests').insert({ corp_id: 'c-1', user_id: IDS.app2, user_name: 'App2', role: 'Lawyer', status: 'pending' });
  const req2 = s.db.corp_requests.find((x) => x.user_id === IDS.app2);
  s.as(IDS.founder);
  r = await c.from('corp_requests').update({ status: 'hired' }).eq('id', req2.id);
  out.founderSetsHired = req2.status === 'hired';
  s.as(IDS.stranger);
  r = await c.rpc('corp_join_accept', { p_request_id: req2.id });
  out.strangerAcceptsOthers = !r.error;
  out.strangerRowsAfter = s.members(IDS.stranger, 'c-1').length;
  s.db.corp_members = s.db.corp_members.filter((x) => !(x.user_id === IDS.stranger && x.corp_id === 'c-1'));
  req2.status = 'hired';
  s.as(IDS.app2);
  r = await c.from('corp_requests').update({ role: 'CEO' }).eq('id', req2.id);
  out.relabelHired = req2.role === 'CEO';
  req2.role = 'Lawyer';
  await c.rpc('corp_join_accept', { p_request_id: req2.id });
  await c.rpc('corp_join_accept', { p_request_id: req2.id });
  out.app2Rows = s.members(IDS.app2, 'c-1').filter((x) => x.role === 'Lawyer').length;

  // a player who LEFT keeps a 'joined' request (3 such rows live) — never re-admitted
  s.db.corp_requests.push({ id: 'req-left', corp_id: 'c-1', user_id: IDS.left, user_name: 'Gone', role: 'member', status: 'joined' });
  s.as(IDS.left);
  await c.rpc('corp_join_accept', { p_request_id: 'req-left' });
  out.leftReadmitted = s.members(IDS.left, 'c-1').length > 0;
  return out;
}

// ── the shipped client in a sandbox ─────────────────────────────────────────
const CLIENT_FNS = ['_jbRpcMissing', '_corpWriteOwnMembership', '_corpAcceptHire', '_corpEnsureRun'];
function loadClient(src, mutate) {
  const parts = CLIENT_FNS.map((n) => extractFrom(src, n)).filter(Boolean);
  let code = parts.join('\n\n');
  if (mutate) code = mutate(code);
  return code;
}
async function boot(store, code, who, name) {
  store.as(who);
  const noop = async () => {};
  const ctx = {
    Cloud: { client: store.client },
    Profile: { cloud: { userId: who, displayName: name, signedIn: true }, account: {}, _corpXferSeen: {} },
    Corp: {},
    Operations: {},
    console: { log() {}, warn() {}, error() {} },
    showToast() {}, saveProfile() {}, render() {}, _jbSendData() {},
    _corpMemberCitiesFetch: noop, _corpAnnounceIncoming: () => 0, _jbTradeFetch: noop,
    corpLawsFetch: noop, corpLawApplyMood() {}, corpScoreCompliance: () => ({}), corpTreasuryFetch: noop, opFetch: noop,
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.__run = _corpEnsureRun;', ctx, { timeout: 5000 });
  let threw = null;
  try { await ctx.__run(); } catch (e) { threw = e; }
  return { Corp: ctx.Corp, threw };
}
const memberWrites = (store, who) => store.log.filter((l) => l.table === 'corp_members' && (l.op === 'insert' || l.op === 'upsert') && l.uid === who);

async function flows(R, code, label) {
  const res = {};
  // F1 founder hires with corp_hire; applicant boots.
  {
    const s = makeStore(R, SEED());
    s.as(IDS.app); await s.client.from('corp_requests').insert({ corp_id: 'c-1', user_id: IDS.app, user_name: 'App', role: 'Weapon Smith', status: 'pending' });
    const req = s.db.corp_requests[0];
    s.as(IDS.founder); const h = await s.client.rpc('corp_hire', { p_request_id: req.id });
    const b = await boot(s, code, IDS.app, 'App');
    res.f1 = { hireOk: !h.error, rows: s.members(IDS.app).length, mine: b.Corp.mine && b.Corp.mine.id, role: (s.members(IDS.app)[0] || {}).role, threw: b.threw };
  }
  // F2 founder marks 'hired' (the corp_hire-missing path); applicant boots.
  {
    const s = makeStore(R, SEED());
    s.as(IDS.app); await s.client.from('corp_requests').insert({ corp_id: 'c-1', user_id: IDS.app, user_name: 'App', role: 'Lawyer', status: 'pending' });
    const req = s.db.corp_requests[0];
    s.as(IDS.founder); const u = await s.client.from('corp_requests').update({ status: 'hired', role: 'Lawyer' }).eq('id', req.id);
    const b = await boot(s, code, IDS.app, 'App');
    const b2 = await boot(s, code, IDS.app, 'App');   // a second boot adds nothing
    res.f2 = { setOk: !u.error && req.status !== 'pending', rows: s.members(IDS.app).length, status: req.status, mine: b.Corp.mine && b.Corp.mine.id, mine2: b2.Corp.mine && b2.Corp.mine.id, role: (s.members(IDS.app)[0] || {}).role, rpcCalls: s.log.filter((l) => l.rpc === 'corp_join_accept').length, threw: b.threw };
  }
  // F3 a vault-only stranger (vault row, no hire) boots.
  {
    const s = makeStore(R, SEED());
    s.db.corp_members = s.db.corp_members.filter((x) => x.user_id !== IDS.stranger);
    s.db.corp_vault.push({ corp_id: 'c-1', depositor_id: IDS.stranger, kind: 'res', item_id: 'wood', qty: 5 });
    const b = await boot(s, code, IDS.stranger, 'Str');
    res.f3 = { rows: s.members(IDS.stranger, 'c-1').length, mine: b.Corp.mine && b.Corp.mine.id, writes: memberWrites(s, IDS.stranger).length, threw: b.threw };
  }
  // F4 the accept RPC exists and REFUSES: nothing may be written directly.
  {
    const s = makeStore({ ...R, hasJoinAccept: true }, SEED());
    s.db.corp_requests.push({ id: 'req-x', corp_id: 'c-1', user_id: IDS.app, user_name: 'App', role: 'member', status: 'hired' });
    const real = s.client.rpc;
    s.client.rpc = async (n, a) => (n === 'corp_join_accept' ? { data: null, error: { code: '42501', message: 'corp_join_accept: not your application' } } : real(n, a));
    const b = await boot(s, code, IDS.app, 'App');
    res.f4 = { rows: s.members(IDS.app).length, writes: memberWrites(s, IDS.app).length, status: s.db.corp_requests[0].status, threw: b.threw };
  }
  // F5 a founder whose own row is missing self-heals.
  {
    const s = makeStore(R, SEED());
    s.db.corp_members = s.db.corp_members.filter((x) => x.user_id !== IDS.founder);
    const b = await boot(s, code, IDS.founder, 'Boss');
    res.f5 = { rows: s.members(IDS.founder, 'c-1').length, mine: b.Corp.mine && b.Corp.mine.id, threw: b.threw };
  }
  // F6 a hired player already in ANOTHER corp: accepting adds, never moves.
  {
    const s = makeStore(R, SEED());
    s.db.corp_requests.push({ id: 'req-s', corp_id: 'c-1', user_id: IDS.stranger, user_name: 'Str', role: 'member', status: 'pending' });
    s.as(IDS.founder); await s.client.from('corp_requests').update({ status: 'hired' }).eq('id', 'req-s');
    await boot(s, code, IDS.stranger, 'Str');
    res.f6 = { inC1: s.members(IDS.stranger, 'c-1').length, inC2: s.members(IDS.stranger, 'c-2').length };
  }
  return res;
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S · the migration ──');
function sqlChecks(sql) {
  const r = [];
  const add = (c, m) => r.push([!!c, m]);
  const bare = stripComments(sql);
  const creates = [...bare.matchAll(/create policy (\w+) on public\.(\w+)/g)];
  add(creates.length >= 8, 'defines the 8 corp_members/corp_requests policies (' + creates.length + ')');
  add(creates.every(([, p, t]) => new RegExp('drop policy if exists ' + p + ' on public\\.' + t + '\\s*;').test(bare)), 'every create policy has a drop-if-exists before it');
  add(!/create function /i.test(bare) && (bare.match(/create or replace function/g) || []).length === 3, 'three functions, all create-or-replace');
  add(/drop trigger if exists corp_members_guard on public\.corp_members;/.test(bare) && /drop trigger if exists corp_requests_guard on public\.corp_requests;/.test(bare), 'both triggers drop-if-exists first');
  add(/alter table public\.corp_members enable row level security/.test(bare) && /alter table public\.corp_requests enable row level security/.test(bare), 'RLS enabled on both tables in this file');
  const R = parseRules(sql);
  add(R.cmInsFounderOnly, 'cm_ins: own row AND founder of that corp');
  add(R.cmGuard && R.cmFreezeIds && R.cmFreezeRole, 'corp_members guard: client may not change user_id, corp_id or role');
  add(R.creqInsPending, "creq_ins: an application is born 'pending'");
  add(R.creqUpdCheck && !/with check \(true\)/.test(policyBlock(sql, 'creq_upd')), 'creq_upd: WITH CHECK is no longer true');
  add(R.creqGuard && R.creqFreezeIds, 'corp_requests guard: user_id / corp_id frozen for everyone');
  add(Array.isArray(R.requesterStatuses) && !R.requesterStatuses.includes('hired') && !R.requesterStatuses.includes('joined'), "applicant can never set 'hired' or 'joined' (" + R.requesterStatuses + ')');
  add(Array.isArray(R.founderStatuses) && R.founderStatuses.includes('hired') && !R.founderStatuses.includes('joined'), "founder may set 'hired', 'joined' is RPC-only (" + R.founderStatuses + ')');
  add(R.creqRoleOnlyPending, 'applicant changes the position only on a pending application');
  add(R.hasJoinAccept && R.acceptChecksOwner && R.acceptHiredOnly, "corp_join_accept: definer, caller's own application, inserts only on 'hired'");
  add(/set search_path = public/.test(fnBody(sql, 'corp_join_accept')) || /corp_join_accept\(p_request_id uuid\)[\s\S]*?set search_path = public/.test(bare), 'corp_join_accept pins search_path');
  add(/on conflict \(corp_id, user_id\) do nothing/.test(fnBody(sql, 'corp_join_accept')), 'accept never moves or overwrites a row (on conflict do nothing)');
  add(/revoke all on function public\.corp_join_accept\(uuid\) from public, anon;/.test(bare) && /grant execute on function public\.corp_join_accept\(uuid\) to authenticated;/.test(bare), 'accept granted to authenticated only');
  add(/security invoker/.test(bare.slice(bare.indexOf('_corp_members_guard()'), bare.indexOf('_corp_members_guard()') + 200)) && /security invoker/.test(bare.slice(bare.indexOf('_corp_requests_guard()'), bare.indexOf('_corp_requests_guard()') + 200)), 'guard triggers are SECURITY INVOKER (current_user is the caller)');
  // No data statements outside function bodies.
  const outside = bare.replace(/\$fn\$[\s\S]*?\$fn\$/g, '');
  add(!/^\s*(insert into|update public|delete from|truncate)/im.test(outside), 'no data statement outside function bodies');
  add(!/\b(email|msbemail)\b/i.test(bare), 'no email column anywhere');
  const tail = sql.trimEnd();
  add(/-- ── verify \(read-only\)[\s\S]*select[\s\S]*;\s*(--[^\n]*)?$/.test(tail) && tail.lastIndexOf('select') > tail.lastIndexOf('create '), 'ends with a read-only verify select');
  return r;
}
for (const [c, m] of sqlChecks(SQL)) ok(c, m);

console.log('\n── C · client writer inventory ──');
function clientChecks(src) {
  const r = [];
  const add = (c, m, x) => r.push([!!c, m, x]);
  const re = /from\((['"])corp_members\1\)\s*\.\s*(insert|upsert)\(/g;
  const sites = [];
  let m;
  while ((m = re.exec(src))) sites.push([m.index, m[2], enclosingFn(src, m.index)]);
  add(sites.length >= 1 && sites.every((s) => s[2] === '_corpWriteOwnMembership'), 'every corp_members insert/upsert is inside _corpWriteOwnMembership',
    sites.filter((s) => s[2] !== '_corpWriteOwnMembership').map((s) => s[1] + '@' + s[2]).join(', '));
  const acc = extractFrom(src, '_corpAcceptHire') || '';
  add(/rpc\('corp_join_accept'/.test(acc), '_corpAcceptHire calls corp_join_accept first');
  const iRpc = acc.indexOf("rpc('corp_join_accept'"), iGate = acc.indexOf('if (!_jbRpcMissing('), iWrite = acc.indexOf('_corpWriteOwnMembership(');
  add(iRpc >= 0 && iGate > iRpc && iWrite > iGate && /return \{ ok: false, via: 'refused' \}/.test(acc.slice(iGate, iWrite)),
    'the direct write is reachable only after _jbRpcMissing says the RPC is absent');
  const run = extractFrom(src, '_corpEnsureRun') || '';
  add((run.match(/_corpAcceptHire\(/g) || []).length === 2, '_corpEnsureRun joins via _corpAcceptHire (hired request + vault heal)');
  add(!/from\('corp_requests'\)\.update\(\{ status: 'joined'/.test(src.replace(acc, '')), "no 'joined' write outside _corpAcceptHire's pre-149 fallback");
  // corp_requests only: boe_merc listings also have a 'hired' status.
  const hiredWrites = [...src.matchAll(/from\('corp_requests'\)\.update\(\{ status: 'hired'/g)].map((x) => x.index);
  add(hiredWrites.length === 1 && /if \(!_jbRpcMissing\(_hireErr\)\)[\s\S]{0,600}$/.test(src.slice(Math.max(0, hiredWrites[0] - 800), hiredWrites[0])),
    "the one status:'hired' write (corpApprove) runs only when corp_hire is missing");
  const joinAt = src.indexOf("a.kind === 'corpJoin'");
  const joinEnd = src.indexOf("a.kind === 'corpRequest'", joinAt);
  const join = joinAt >= 0 && joinEnd > joinAt ? src.slice(joinAt, joinEnd) : '';
  add(join && !/corp_members/.test(join.replace(/\/\*[\s\S]*?\*\//g, '')) && /from\('corp_requests'\)\.upsert\(/.test(join) && /status: 'pending'/.test(join), 'join-by-tag files a pending application, never a membership');
  add(!/Corp\.mine = \{[^}]*role: 'member'/.test(join), 'join-by-tag does not pretend the player is a member');
  const vaultAt = run.indexOf("from('corp_vault').select('corp_id')");
  const vault = vaultAt >= 0 ? run.slice(vaultAt, vaultAt + 1500) : '';
  add(/if \(_acc\.ok\) \{\s*memRow =/.test(vault), 'vault self-heal sets memRow only when the row landed');
  add(/eq\('status', 'hired'\)/.test(vault), "vault self-heal looks only for a 'hired' request");
  return r;
}
for (const [c, m, x] of clientChecks(INDEX)) ok(c, m, x);

const R149 = parseRules(SQL);
const CUR = loadClient(INDEX);

(async () => {
  console.log('\n── M · exploit probes on the sql/149 model ──');
  const e = await exploits(R149);
  ok(!e.strangerInsert, 'stranger cannot insert into another corp');
  ok(!e.moveCorp, 'stranger cannot move their row to another corp');
  ok(!e.promote, 'stranger cannot promote their own role');
  ok(e.ownRename, 'a member can still rename / set primary on their own row');
  ok(e.filePending, 'an applicant can file a pending application');
  ok(!e.selfHire, "an applicant cannot set their own request to 'hired'");
  ok(!e.fileHired, "an applicant cannot file an application already 'hired'");
  ok(e.refile && e.withdraw, 'an applicant can re-file (pending, new role) and withdraw');
  ok(!e.repointUser, 'a founder cannot re-point a request at another player');
  ok(!e.repointCorp, 'a founder cannot move a request to another corp');
  ok(!e.founderOtherCorp, "a founder cannot insert their row into a corp they don't own");
  ok(!e.founderSetsJoined, "a founder cannot write 'joined' (RPC-only)");
  ok(e.hire && e.acceptAfterHire && e.appRows === 1, 'corp_hire then corp_join_accept → exactly one membership', JSON.stringify(e));
  ok(e.founderSetsHired, "a founder can still mark a request 'hired' (corp_hire-missing path)");
  ok(!e.strangerAcceptsOthers && e.strangerRowsAfter === 0, "nobody can accept someone else's hire");
  ok(!e.relabelHired, 'a hired request cannot be re-labelled before acceptance');
  ok(e.app2Rows === 1, 'accepting twice lands one row, with the hired position');
  ok(!e.leftReadmitted, "a 'joined' request of a player who left does not re-admit them");

  console.log('\n── H · the shipped client against the sql/149 model ──');
  const f = await flows(R149, CUR, 'current');
  ok(f.f1.hireOk && f.f1.rows === 1 && f.f1.mine === 'c-1' && f.f1.role === 'Weapon Smith' && !f.f1.threw, 'founder hires (corp_hire) → applicant boots into c-1, one row', JSON.stringify(f.f1));
  ok(f.f2.setOk && f.f2.rows === 1 && f.f2.status === 'joined' && f.f2.mine === 'c-1' && f.f2.mine2 === 'c-1' && f.f2.role === 'Lawyer' && f.f2.rpcCalls === 1, "founder marks 'hired' → applicant boots via corp_join_accept, one row, second boot quiet", JSON.stringify(f.f2));
  ok(f.f3.rows === 0 && !f.f3.mine && f.f3.writes === 0, 'a vault-only stranger is not admitted and no direct write is tried', JSON.stringify(f.f3));
  ok(f.f4.rows === 0 && f.f4.writes === 0 && f.f4.status === 'hired', 'an RPC refusal writes nothing and leaves the request alone', JSON.stringify(f.f4));
  ok(f.f5.rows === 1 && f.f5.mine === 'c-1', 'a founder with a lost row self-heals (the one client write 149 allows)', JSON.stringify(f.f5));
  ok(f.f6.inC1 === 1 && f.f6.inC2 === 1, 'a hire adds a second membership and never moves the first', JSON.stringify(f.f6));

  console.log('\n── H · the shipped client with corp_join_accept ABSENT (pre-149 live DB) ──');
  const g = await flows(HEAD_RULES, CUR, 'current/pre149');
  ok(g.f1.hireOk && g.f1.rows === 1 && g.f1.mine === 'c-1', 'pre-149: founder hires (corp_hire) → applicant boots, one row', JSON.stringify(g.f1));
  ok(g.f2.setOk && g.f2.rows === 1 && g.f2.status === 'joined' && g.f2.mine === 'c-1' && g.f2.mine2 === 'c-1' && g.f2.role === 'Lawyer', "pre-149: 'hired' request → fallback write lands, request 'joined', second boot quiet", JSON.stringify(g.f2));
  ok(g.f3.rows === 1 && g.f3.mine === 'c-1', 'pre-149: the vault self-heal still restores (old behaviour kept where the old policies stand)', JSON.stringify(g.f3));
  ok(g.f5.rows === 1 && g.f5.mine === 'c-1', 'pre-149: founder self-heal unchanged', JSON.stringify(g.f5));
  ok(g.f6.inC1 === 1 && g.f6.inC2 === 1, 'pre-149: the fallback adds a row and never moves one (real conflict key)', JSON.stringify(g.f6));

  console.log('\n── N · negative controls ──');
  const h = await exploits(HEAD_RULES);
  ok(h.strangerInsert && h.moveCorp && h.promote && h.selfHire && h.fileHired && h.repointUser && h.repointCorp && h.founderOtherCorp,
    'HEAD policies: stranger insert, move, promote, self-hire, file-hired, re-point and cross-corp founder row all LAND (the probes detect the hole)', JSON.stringify(h));

  if (HEAD_INDEX) {
    const headInv = clientChecks(HEAD_INDEX);
    ok(!headInv[0][0], "HEAD's index.html fails the writer inventory (direct writes outside the helper)");
    ok(headInv.filter(([c]) => !c).length >= 5, "HEAD's index.html fails at least five client checks (" + headInv.filter(([c]) => !c).length + ')');
    const HEADC = loadClient(HEAD_INDEX);
    const hf = await flows(R149, HEADC, 'HEAD client');
    ok(hf.f2.rows === 0, "HEAD's client cannot land a 'hired' membership once 149 is applied (why the client had to change)", JSON.stringify(hf.f2));
    // End to end on HEAD: a self-hire + boot makes a stranger a member.
    const s = makeStore(HEAD_RULES, SEED());
    s.as(IDS.app); await s.client.from('corp_requests').insert({ corp_id: 'c-1', user_id: IDS.app, user_name: 'App', role: 'CEO', status: 'hired' });
    await boot(s, HEADC, IDS.app, 'App');
    ok(s.members(IDS.app, 'c-1').length === 1, 'HEAD end to end: a self-filed hired application + boot = membership (the exploit)');
    const s2 = makeStore(R149, SEED());
    s2.as(IDS.app); await s2.client.from('corp_requests').insert({ corp_id: 'c-1', user_id: IDS.app, user_name: 'App', role: 'CEO', status: 'hired' });
    await boot(s2, CUR, IDS.app, 'App');
    ok(s2.members(IDS.app, 'c-1').length === 0, '149 end to end: the same attempt gives no membership');
  } else {
    ok(false, 'git show HEAD:public/index.html unavailable — HEAD client controls not run');
  }

  const SQL_MUTANTS = [
    ['cm_ins without the founder clause', (s) => s.replace(/\n    and exists \(select 1 from public\.corporations c\n                 where c\.id = corp_members\.corp_id\n                   and c\.founder_id = auth\.uid\(\)\)/, ''), (e) => e.strangerInsert],
    ['members guard without the role freeze', (s) => s.replace("if new.role is distinct from old.role then\n    raise exception 'corp_members: positions", "if false then\n    raise exception 'corp_members: positions"), (e) => e.promote],
    ['members guard without the corp_id freeze', (s) => s.replace(/(_corp_members_guard[\s\S]*?)if new\.user_id is distinct from old\.user_id\n     or new\.corp_id is distinct from old\.corp_id then/, '$1if false then'), (e) => e.moveCorp],
    ['creq_ins without status pending', (s) => s.replace("with check (user_id = auth.uid() and status = 'pending');", 'with check (user_id = auth.uid());'), (e) => e.fileHired],
    ["applicant may set 'hired'", (s) => s.replace("and new.status not in ('pending', 'withdrawn') then", "and new.status not in ('pending', 'withdrawn', 'hired') then"), (e) => e.selfHire],
    ['requests guard without the id freeze', (s) => s.replace(/(_corp_requests_guard[\s\S]*?)if new\.user_id is distinct from old\.user_id\n     or new\.corp_id is distinct from old\.corp_id then/, '$1if false then'), (e) => e.repointUser],
    ['accept without the owner check', (s) => s.replace('if r.user_id <> v_uid then', 'if false then'), (e) => e.strangerAcceptsOthers],
    ["accept re-admits a 'joined' request", (s) => s.replace("elsif r.status <> 'joined' then\n    raise", "elsif false then\n    raise").replace("if r.status = 'hired' then", "if r.status in ('hired', 'joined') then"), (e) => e.leftReadmitted],
    ['guard trigger never created', (s) => s.replace(/create trigger corp_requests_guard\n  before update on public\.corp_requests\n  for each row execute function public\._corp_requests_guard\(\);/, ''), (e) => e.selfHire || e.repointUser],
  ];
  for (const [name, mut, caught] of SQL_MUTANTS) {
    const ms = mut(SQL);
    if (ms === SQL) { ok(false, 'SQL mutant did not apply: ' + name); continue; }
    const me = await exploits(parseRules(ms));
    const staticFail = sqlChecks(ms).some(([c]) => !c);
    ok(caught(me) && staticFail, 'SQL mutant caught by probe AND static check: ' + name);
  }
  const creqTrue = SQL.replace(/with check \(user_id = auth\.uid\(\)\n              or exists/, 'with check (true) and (user_id = auth.uid()\n              or exists');
  ok(creqTrue !== SQL && sqlChecks(creqTrue).some(([c]) => !c), 'SQL mutant caught: creq_upd WITH CHECK (true)');
  const noVerify = SQL.slice(0, SQL.indexOf('-- ── verify (read-only)'));
  ok(sqlChecks(noVerify).some(([c, m]) => !c && /verify/.test(m)), 'SQL mutant caught: verify block removed');

  // Client mutants.
  const anyErrFallback = loadClient(INDEX, (c) => c.replace('if (!_jbRpcMissing(r && r.error)) {', 'if (false) {'));
  ok(anyErrFallback !== CUR, 'client mutant applied: fall back on ANY error');
  const mf = await flows(R149, anyErrFallback, 'mutant');
  ok(mf.f4.writes > 0, 'client mutant caught: a refusal answered with a direct write', JSON.stringify(mf.f4));
  const invMut = clientChecks(INDEX.replace(anyErrFallbackSrc(INDEX), (x) => x.replace('if (!_jbRpcMissing(r && r.error)) {', 'if (false) {')));
  ok(invMut.some(([c]) => !c), 'client mutant caught by the inventory too');
  const stray = INDEX.replace('\nasync function corpEnsure() {', "\nasync function _strayJoin(me, c) { return Cloud.client.from('corp_members').insert({ user_id: me, corp_id: c }); }\nasync function corpEnsure() {");
  ok(stray !== INDEX && !clientChecks(stray)[0][0], 'client mutant caught: a stray corp_members insert in another function');
  const joinBack = INDEX.replace("const _ja = await Cloud.client.from('corp_requests').upsert(", "await Cloud.client.from('corp_members').delete().eq('user_id', me); const _ja = await Cloud.client.from('corp_requests').upsert(");
  ok(joinBack !== INDEX && clientChecks(joinBack).some(([c, m]) => !c && /join-by-tag/.test(m)), 'client mutant caught: join-by-tag touching corp_members');
  const vaultMut = loadClient(INDEX, (c) => c.replace('if (_acc.ok) {\n              memRow =', 'if (true) {\n              memRow ='));
  const vf = await flows(R149, vaultMut, 'vault mutant');
  ok(vaultMut !== CUR && vf.f3.mine === 'c-1', 'client mutant caught: vault heal claiming a membership the server refused', JSON.stringify(vf.f3));

  /* B · THE SAME FLOWS IN A REAL BROWSER. Headless Chromium, blank page: the
     lifted client functions are evaluated as classic-script globals (as they
     are in index.html) and Cloud / Profile / Corp are window globals, so a
     dependency the vm sandbox happened to provide cannot hide here. */
  console.log('\n── B · headless Chromium: founder hires → applicant boots ──');
  let chromium = null;
  try { ({ chromium } = await import('playwright')); } catch (e) { chromium = null; }
  if (!chromium) {
    ok(false, 'playwright is not installed — the browser section did not run');
  } else {
    const browser = await chromium.launch();
    try {
      const inPage = async (R, code) => {
        const page = await browser.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
        await page.setContent('<!doctype html><html><body></body></html>');
        const script = `(async () => {
          const UNIQUE = ${JSON.stringify(UNIQUE)};
          const IDS = ${JSON.stringify(IDS)};
          const SEED = ${SEED.toString()};
          const memberWrites = ${memberWrites.toString()};
          ${makeStore.toString()}
          ${flows.toString()}
          async function boot(store, code, who, name) {
            store.as(who);
            const noop = async () => {};
            Object.assign(window, {
              Cloud: { client: store.client },
              Profile: { cloud: { userId: who, displayName: name, signedIn: true }, account: {}, _corpXferSeen: {} },
              Corp: {}, Operations: {},
              showToast() {}, saveProfile() {}, render() {}, _jbSendData() {},
              _corpMemberCitiesFetch: noop, _corpAnnounceIncoming: () => 0, _jbTradeFetch: noop,
              corpLawsFetch: noop, corpLawApplyMood() {}, corpScoreCompliance: () => ({}), corpTreasuryFetch: noop, opFetch: noop,
            });
            if (window.__code !== code) { (0, eval)(code); window.__code = code; }
            let threw = null;
            try { await window._corpEnsureRun(); } catch (e) { threw = String(e); }
            return { Corp: { mine: window.Corp.mine ? { id: window.Corp.mine.id } : null }, threw };
          }
          return flows(${JSON.stringify(R)}, ${JSON.stringify(code)}, 'browser');
        })()`;
        const res = await page.evaluate(script);
        await page.close();
        return { res, errs };
      };
      const b1 = await inPage(R149, CUR);
      ok(b1.errs.length === 0, 'browser: no page errors (149)', b1.errs.join(' | '));
      ok(b1.res.f1.rows === 1 && b1.res.f1.mine === 'c-1' && !b1.res.f1.threw, 'browser 149: corp_hire → boot → member of c-1', JSON.stringify(b1.res.f1));
      ok(b1.res.f2.rows === 1 && b1.res.f2.status === 'joined' && b1.res.f2.mine === 'c-1' && b1.res.f2.rpcCalls === 1, "browser 149: 'hired' → boot → corp_join_accept → one row", JSON.stringify(b1.res.f2));
      ok(b1.res.f3.rows === 0 && !b1.res.f3.mine && b1.res.f3.writes === 0, 'browser 149: vault-only stranger stays out', JSON.stringify(b1.res.f3));
      ok(b1.res.f4.writes === 0, 'browser 149: a refusal writes nothing', JSON.stringify(b1.res.f4));
      const b2 = await inPage(HEAD_RULES, CUR);
      ok(b2.errs.length === 0 && b2.res.f2.rows === 1 && b2.res.f2.status === 'joined' && b2.res.f2.mine === 'c-1', 'browser, RPC absent: the fallback lands the hire', JSON.stringify(b2.res.f2));
      ok(b2.res.f1.rows === 1 && b2.res.f1.mine === 'c-1', 'browser, RPC absent: corp_hire path unchanged', JSON.stringify(b2.res.f1));
      if (HEAD_INDEX) {
        const b3 = await inPage(R149, loadClient(HEAD_INDEX));
        ok(b3.res.f2.rows === 0, 'browser negative control: the pre-fix client cannot land a hire under 149', JSON.stringify(b3.res.f2));
      }
      const b4 = await inPage(R149, anyErrFallback);
      ok(b4.res.f4.writes > 0, 'browser negative control: the fall-back-on-any-error mutant writes on a refusal', JSON.stringify(b4.res.f4));
    } finally { await browser.close(); }
  }

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

function anyErrFallbackSrc(src) { return extractFrom(src, '_corpAcceptHire') || ' none'; }
