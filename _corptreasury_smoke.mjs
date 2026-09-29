/* 🔐 CORP TREASURY CREDITS ARE WRITTEN BY THE SERVER (sql/146, draft).

   The hole: live ct_ins was `with check (user_id = auth.uid() and
   is_corp_member(corp_id, auth.uid()))` — no bound on amount or kind — and
   corp_members lets anyone join any corporation. Any signed-in player could
   insert +N into any corporation's treasury without spending a Cinder, and a
   forged kind='node_manager_fee' row inflated sql/142's corp_fees_total.

   sql/146 is proven on the live database in a rolled-back DO block (builder
   report: HEAD forge lands; candidate refuses it through RLS alone AND through
   the trigger alone; deposit moves wallet −700 / treasury +700 / one
   wallet_ledger row; a short wallet moves nothing; refund = its debit, once,
   never after the filing landed; op_revenue ceiling and cooldown). This suite
   cannot reach Postgres, so it guards what silently undoes that proof:

     S  THE MIGRATION. ct_ins keeps `amount < 0` and a spend-kind list, the
        trigger names the same kinds, the RPCs are definer + granted, the
        op_revenue ceiling equals the product DERIVED from the client's own
        economy constants, the bank fee equals BOE_CORP_FEE_PCT.
     C  THE CLIENT WRITER INVENTORY. Every corp_treasury insert in public/ sits
        in a known function, and each positive one is behind its RPC as the
        pre-146 fallback only.
     H  A HARNESS. The shipped functions (corpTreasuryDeposit, boeCorpDeposit,
        nodeEstablish, _opTreasuryRow and the _ct* helpers) are lifted out of
        index.html and driven against a fake store whose ct_ins is PARSED from
        sql/146: deposit, short wallet, bank fee, construction debit + refund,
        filing-failed refund, offline, and the pre-146 degrade.
     N  NEGATIVE CONTROLS. The HEAD policy lets the forge land; HEAD's
        index.html cannot deposit against the 146 store; mutated SQL and a
        mutated client are each caught.

   Run: node _corptreasury_smoke.mjs */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import vm from 'vm';
import * as acorn from 'acorn';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x));
  if (c) passes++; else fails++;
};

const SQL = readFileSync('./sql/146_corp_treasury_server_writes.sql', 'utf8');
const INDEX = readFileSync('./public/index.html', 'utf8');
const TERROIR = readFileSync('./public/src/city/terroir.js', 'utf8');

// ── source helpers ──────────────────────────────────────────────────────────
function extractFrom(src, name) {
  let at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = src.indexOf('\nasync function ' + name + '(');
  if (at < 0) return null;
  // Tokenise instead of counting raw braces: these bodies hold template
  // literals and regexes with braces in them.
  const slice = src.slice(at + 1, at + 1 + 200000);
  let depth = 0, started = false;
  for (const tok of acorn.tokenizer(slice, { ecmaVersion: 'latest' })) {
    const l = tok.type.label;
    if (l === '{' || l === '${') { depth++; started = true; }
    else if (l === '}') { depth--; if (started && depth === 0) return slice.slice(0, tok.end); }
  }
  return null;
}
function sqlBlock(src, startRe) {
  const m = src.match(startRe);
  if (!m) return '';
  const from = m.index;
  const end = src.indexOf('end $$;', from);
  return end < 0 ? '' : src.slice(from, end + 7);
}
function policyText(src) {
  const m = src.match(/create policy ct_ins on public\.corp_treasury[\s\S]*?\);\n/);
  return m ? m[0] : '';
}
function kindList(text) {
  const m = text.match(/kind\s+(?:not\s+)?in\s*\(([^)]*)\)/);
  return m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort() : null;
}

// ═══ S · the migration ═══════════════════════════════════════════════════════
function checkSql(src) {
  const r = {};
  const pol = policyText(src);
  const body = src.slice(src.indexOf('\nbegin;\n'), src.indexOf('\ncommit;\n'));
  r.hasBeginCommit = src.includes('\nbegin;\n') && src.includes('\ncommit;\n');
  r.policyBoundsAmount = /\bamount\s*<\s*0\b/.test(pol);
  r.policyNoCredit = !/deposit|refund|op_revenue|node_manager_fee/.test(pol);
  r.policyUid = /user_id\s*=\s*auth\.uid\(\)/.test(pol) && /is_corp_member\(corp_id,\s*auth\.uid\(\)\)/.test(pol);
  r.policyRefNull = /ref_id is null/.test(pol);
  const trg = sqlBlock(src, /create or replace function public\._ct_client_write_guard\(\)/);
  r.triggerKinds = JSON.stringify(kindList(trg)) === JSON.stringify(kindList(pol)) && !!kindList(pol);
  r.triggerRefusesCredit = /new\.amount >= 0 then\s*\n\s*raise exception/.test(trg);
  r.triggerRoleGate = /current_user not in \('authenticated', 'anon'\)/.test(trg);
  r.triggerAttached = /create trigger ct_client_write_guard\s+before insert or update or delete on public\.corp_treasury/.test(src)
                   && /drop trigger if exists ct_client_write_guard/.test(src);
  r.idempotentPolicy = /drop policy if exists ct_ins on public\.corp_treasury;\s*\ncreate policy ct_ins/.test(src);
  r.revokesWrites = /revoke update, delete, truncate on public\.corp_treasury from anon, authenticated;/.test(src);
  const fns = ['corp_treasury_deposit', 'corp_treasury_refund', 'corp_treasury_op_revenue'];
  r.fnsDefiner = fns.every((f) => /security definer\s*\nset search_path = public, pg_temp/.test(sqlBlock(src, new RegExp('create or replace function public\\.' + f + '\\('))));
  r.fnsGranted = fns.every((f) => new RegExp('grant execute on function public\\.' + f + '\\([^)]*\\)\\s+to authenticated;').test(src)
                                && new RegExp('revoke all on function public\\.' + f + '\\([^)]*\\)\\s+from public, anon;').test(src));
  const dep = sqlBlock(src, /create or replace function public\.corp_treasury_deposit\(/);
  // The debit must come BEFORE the credit, in the same function, un-caught.
  r.depositDebitsFirst = dep.indexOf('_ct_cinder_take(') > 0 && dep.indexOf('_ct_cinder_take(') < dep.indexOf('insert into public.corp_treasury')
                      && !/exception\s+when/.test(dep);
  const ref = sqlBlock(src, /create or replace function public\.corp_treasury_refund\(/);
  r.refundAmountFromDebit = /-v_d\.amount, 'refund'/.test(ref) && !/p_amount/.test(ref);
  r.refundOnceIndex = /create unique index if not exists corp_treasury_refund_once\s+on public\.corp_treasury \(ref_id\) where kind = 'refund';/.test(src);
  r.refundFiledCheck = /if v_filed >= v_open then/.test(ref);
  r.verifyAtEnd = /-- --- VERIFY[\s\S]*select[\s\S]*;\s*$/.test(src.slice(src.indexOf('\ncommit;\n')));
  r.noDataStatements = !/\b(update|delete from)\s+public\.corp_treasury\b/i.test(body.replace(/--.*$/gm, ''));
  r.nmFeeServerOnly = !/node_manager_fee/.test(pol) && !/node_manager_fee/.test(kindList(trg) ? kindList(trg).join() : 'node_manager_fee');
  // Derived constants.
  const cap = Number((src.match(/c_rev_ceiling_per_hr constant numeric := (\d+);/) || [])[1]);
  const capH = Number((src.match(/c_accrual_cap_h\s+constant numeric := (\d+);/) || [])[1]);
  const cdH = Number((src.match(/c_cooldown\s+constant interval := interval '(\d+) hours';/) || [])[1]);
  const fee = Number((src.match(/c_bank_fee_pct constant numeric := ([\d.]+);/) || [])[1]);
  r.cap = cap; r.capH = capH; r.cdH = cdH; r.fee = fee;
  return r;
}
function derivedCeiling(idx, terr) {
  const i = idx.indexOf('const OPS_ECON = {');
  const src = extractObj(idx, i + 'const OPS_ECON = '.length);
  const T = vm.runInNewContext('(' + src + ')');
  const num = (re, s) => Number((s.match(re) || [])[1]);
  const CX = num(/const CX_MUL_MAX\s*=\s*([\d.]+)/, idx);
  const AI = num(/AI_TRADE_MUL_MAX\s*=\s*([\d.]+)/, idx);
  const SITE = num(/OP_SITE_EFF_MAX\s*=\s*([\d.]+)/, idx);
  const SEAM = num(/export const SEAM_BONUS_MUL\s*=\s*([\d.]+)/, terr);
  const tierMax = Math.max(...[...terr.matchAll(/yieldMul:\s*([\d.]+)/g)].map((m) => Number(m[1])));
  let best = 0, bestK = '';
  for (const k of Object.keys(T)) {
    const e = T[k];
    const yields = e.yields && Object.keys(e.yields).some((y) => Number(e.yields[y]) > 0);
    const v = (e.maxWorkers | 0) * (e.ratePerWorkerHr || 0) * SITE * (yields ? CX * AI * tierMax * SEAM : 1);
    if (!((e.maxWorkers | 0) > 0)) return { unbounded: k };
    if (v > best) { best = v; bestK = k; }
  }
  return {
    perHr: Math.ceil(best - 1e-9), bestK,
    capH: num(/const OP_ACCRUAL_CAP_H\s*=\s*(\d+)/, idx),
    cdMs: vm.runInNewContext(((idx.match(/const OP_COLLECT_CD_MS\s*=\s*([^;]+);/) || [])[1]) || 'NaN'),
    fee: num(/const BOE_CORP_FEE_PCT\s*=\s*([\d.]+)/, idx),
    factors: { CX, AI, SITE, SEAM, tierMax },
  };
}
function extractObj(src, at) {
  let depth = 0;
  for (const tok of acorn.tokenizer(src.slice(at, at + 400000), { ecmaVersion: 'latest' })) {
    const l = tok.type.label;
    if (l === '{' || l === '${') depth++;
    else if (l === '}') { depth--; if (depth === 0) return src.slice(at, at + tok.end); }
  }
  return null;
}

console.log('\nS · sql/146');
const S = checkSql(SQL);
for (const k of ['hasBeginCommit', 'policyBoundsAmount', 'policyNoCredit', 'policyUid', 'policyRefNull', 'triggerKinds',
  'triggerRefusesCredit', 'triggerRoleGate', 'triggerAttached', 'idempotentPolicy', 'revokesWrites', 'fnsDefiner',
  'fnsGranted', 'depositDebitsFirst', 'refundAmountFromDebit', 'refundOnceIndex', 'refundFiledCheck', 'verifyAtEnd',
  'noDataStatements', 'nmFeeServerOnly']) ok(S[k] === true, 'S.' + k);
const D = derivedCeiling(INDEX, TERROIR);
ok(!D.unbounded, 'S.every OPS_ECON row has a worker cap (else no ceiling exists)', D.unbounded);
ok(S.cap === D.perHr, 'S.op_revenue ceiling ' + S.cap + '/h == derived ' + D.perHr + '/h (' + D.bestK + ')', JSON.stringify(D.factors));
ok(S.capH === D.capH, 'S.accrual cap ' + S.capH + 'h == OP_ACCRUAL_CAP_H ' + D.capH);
ok(S.cdH > 0 && S.cdH * 3600000 < D.cdMs, 'S.server cooldown ' + S.cdH + 'h is below the client cooldown ' + (D.cdMs / 3600000) + 'h');
ok(S.fee === D.fee, 'S.bank fee ' + S.fee + ' == BOE_CORP_FEE_PCT ' + D.fee);

// ═══ C · client writer inventory ═════════════════════════════════════════════
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?js|html)$/.test(f)) out.push(p);
  }
  return out;
}
const ALLOWED_WRITERS = {
  _ctDebitRow: 'negative only',
  _ctRefund: 'after corp_treasury_refund RPC',
  corpTreasuryDeposit: 'after corp_treasury_deposit RPC',
  boeCorpDeposit: 'after corp_treasury_deposit RPC',
  _opTreasuryRow: 'positive only after the amount < 0 branch',
};
function enclosingFn(src, pos) {
  const re = /\n(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  let m, name = null;
  while ((m = re.exec(src)) && m.index < pos) name = m[1];
  return name;
}
function inventory(files) {
  const bad = [];
  let count = 0;
  for (const [path, src] of files) {
    const re = /from\(\s*['"]corp_treasury['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/g;
    let m;
    while ((m = re.exec(src))) {
      count++;
      const fn = enclosingFn(src, m.index);
      if (m[1] !== 'insert' || !ALLOWED_WRITERS[fn]) { bad.push(path + ':' + fn + ':' + m[1]); continue; }
      const body = extractFrom(src, fn) || '';
      const off = m.index - src.indexOf(body);
      const before = body.slice(0, off);
      if (fn === '_ctDebitRow' && !/amount:\s*-Math\.abs\(/.test(body)) bad.push(fn + ' writes a non-negative amount');
      if (fn === '_ctRefund' && !/rpc\('corp_treasury_refund'/.test(before)) bad.push(fn + ' inserts before its RPC');
      if ((fn === 'corpTreasuryDeposit' || fn === 'boeCorpDeposit') && !/_ctDeposit\(/.test(before)) bad.push(fn + ' inserts before _ctDeposit');
      if ((fn === 'corpTreasuryDeposit' || fn === 'boeCorpDeposit') && !/_dep\.legacy/.test(before)) bad.push(fn + ' does not gate the insert on legacy');
      if (fn === '_opTreasuryRow' && !/if \(amount < 0\)[\s\S]*_ctDebitRow/.test(before)) bad.push(fn + ' positive insert not behind the debit branch');
    }
  }
  return { bad, count };
}
const OTHER = [...walk('./public/src'), './public/node-city/index.html', './public/main-menu/index.html']
  .map((p) => { try { return [p, readFileSync(p, 'utf8')]; } catch (e) { return null; } }).filter(Boolean);
console.log('\nC · client writers');
const INV = inventory([['public/index.html', INDEX], ...OTHER]);
ok(INV.bad.length === 0, 'C.every corp_treasury write is in a reviewed writer (' + INV.count + ' sites)', INV.bad.join(' | '));
ok(INV.count === 5, 'C.exactly 5 client write sites (debit, refund fallback, 2 deposit fallbacks, _opTreasuryRow)', INV.count);
ok(/_ctOpRevenue\(o, net,/.test(INDEX) && !/_opTreasuryRow\(net, 'op_revenue'/.test(extractFrom(INDEX, '_opSettle') || INDEX.slice(INDEX.indexOf('if (net > 0) {'), INDEX.indexOf('if (net > 0) {') + 400)),
  'C.op settlement banks revenue through _ctOpRevenue');
// Every RPC the client calls exists in 146 with the same argument names.
for (const [fn, args] of [['corp_treasury_deposit', ['p_corp_id', 'p_amount', 'p_bank']], ['corp_treasury_refund', ['p_debit_id', 'p_note']], ['corp_treasury_op_revenue', ['p_op_id', 'p_amount', 'p_note']]]) {
  const call = INDEX.match(new RegExp("rpc\\('" + fn + "',\\s*\\{([^}]*)\\}"));
  const keys = call ? [...call[1].matchAll(/(p_[a-z_]+)\s*:/g)].map((m) => m[1]) : [];
  const def = sqlBlock(SQL, new RegExp('create or replace function public\\.' + fn + '\\('));
  ok(call && JSON.stringify(keys) === JSON.stringify(args) && args.every((a) => def.includes(a)), 'C.' + fn + ' call args ' + keys.join(',') + ' match sql/146');
}

// ═══ H · harness ═════════════════════════════════════════════════════════════
const ME = 'u-member', FOUNDER = 'u-founder', CORP = 'c-1';
function makeStore(mode, sqlSrc) {
  const pol = policyText(sqlSrc);
  const kinds = kindList(pol) || [];
  const negOnly = /\bamount\s*<\s*0\b/.test(pol);
  const feePct = checkSql(sqlSrc).fee;
  const st = {
    mode, uid: ME, wallet: { [ME]: 5000, [FOUNDER]: 5000 }, ledger: [], rows: [], nodes: [], ops: [{ id: 'op-1', corp_id: CORP, op_type: 'mining', created_at: Date.now() - 48 * 3600e3 }],
    members: { [CORP]: [ME, FOUNDER] }, founder: { [CORP]: FOUNDER }, failNodeInsert: false, seq: 0,
  };
  let idn = 0;
  const now = () => Date.now();
  const policy = (row) => {
    const member = (st.members[row.corp_id] || []).includes(st.uid);
    if (row.user_id !== st.uid || !member) return false;
    if (mode === 'HEAD') return true;
    return (!negOnly || row.amount < 0) && kinds.includes(row.kind) && row.ref_id == null;
  };
  const err = (message, code) => ({ message, code });
  const put = (row) => { const r = Object.assign({ id: 'r' + (++idn), created_at: now(), ref_id: null }, row); st.rows.push(r); return r; };
  const take = (uid, amt, reason) => {
    if ((st.wallet[uid] | 0) < amt) throw err('not enough Cinder', 'P0001');
    st.wallet[uid] -= amt; st.seq++;
    st.ledger.push({ user_id: uid, delta: -amt, reason });
    return { balance: st.wallet[uid], wallet_seq: st.seq };
  };
  const sum = (c) => st.rows.filter((r) => r.corp_id === c).reduce((s, r) => s + r.amount, 0);
  // Models of the three RPCs, line for line with sql/146. The real
  // functions are proven on Postgres (builder report); these exist so the
  // CLIENT can be driven end to end.
  const rpcs = {
    corp_treasury_deposit({ p_corp_id, p_amount, p_bank }) {
      const amt = Math.floor(p_amount || 0);
      if (amt <= 0) throw err('amount must be greater than zero');
      if (!(st.members[p_corp_id] || []).includes(st.uid)) throw err('not a member', '42501');
      const fee = p_bank ? (st.founder[p_corp_id] !== st.uid ? (() => { throw err('the bank only funds a corporation you founded', '42501'); })() : Math.max(1, Math.ceil(amt * feePct))) : 0;
      if (amt - fee <= 0) throw err('too small');
      const t = take(st.uid, amt, 'deposit');
      put({ corp_id: p_corp_id, user_id: st.uid, amount: amt - fee, kind: 'deposit', note: 'rpc' });
      return { gross: amt, fee, net: amt - fee, new_balance: t.balance, wallet_seq: t.wallet_seq, tax_amount: 0, treasury_balance: sum(p_corp_id) };
    },
    corp_treasury_refund({ p_debit_id, p_note }) {
      const d = st.rows.find((r) => r.id === p_debit_id);
      if (!d) throw err('no such treasury debit');
      if (d.user_id !== st.uid) throw err('not yours', '42501');
      if (!(d.amount < 0) || !['construction', 'op_startup'].includes(d.kind)) throw err('only a construction or startup debit can be refunded');
      if (st.rows.some((r) => r.kind === 'refund' && r.ref_id === d.id)) throw err('that debit was already refunded', '23505');
      const open = st.rows.filter((x) => x.corp_id === d.corp_id && x.user_id === st.uid && x.kind === d.kind && x.amount < 0 && x.created_at >= d.created_at
        && !st.rows.some((r) => r.kind === 'refund' && r.ref_id === x.id)).length;
      const filed = d.kind === 'construction'
        ? st.nodes.filter((n) => n.corp_id === d.corp_id && n.owner_id === st.uid && n.created_at >= d.created_at && (n.meta || {}).funded === 'treasury').length
        : 0;
      if (filed >= open) throw err('that debit paid for a filing that landed; nothing to refund');
      put({ corp_id: d.corp_id, user_id: st.uid, amount: -d.amount, kind: 'refund', note: p_note, ref_id: d.id });
      return { amount: -d.amount, treasury_balance: sum(d.corp_id) };
    },
    corp_treasury_op_revenue({ p_op_id, p_amount }) {
      const o = st.ops.find((x) => x.id === p_op_id);
      if (!o) throw err('no such operation');
      const s = checkSql(sqlSrc);
      const last = Math.max(0, ...st.rows.filter((r) => r.kind === 'op_revenue' && r.ref_id === o.id).map((r) => r.created_at));
      if (last && last > now() - s.cdH * 3600e3) throw err('this operation was settled recently');
      const hrs = Math.min(s.capH, (now() - (last || o.created_at)) / 3600e3);
      if (p_amount > Math.ceil(s.cap * hrs)) throw err('revenue exceeds ceiling');
      put({ corp_id: o.corp_id, user_id: st.uid, amount: p_amount, kind: 'op_revenue', ref_id: o.id });
      return { amount: p_amount };
    },
  };
  function builder(table) {
    const q = { table, filters: [], op: 'select', row: null, wantRow: false };
    const exec = () => {
      if (q.table === 'corp_treasury') {
        if (q.op === 'insert') {
          if (!policy(q.row)) return { data: null, error: err('new row violates row-level security policy for table "corp_treasury"', '42501') };
          const r = put(q.row);
          return { data: q.wantRow ? { id: r.id } : null, error: null };
        }
        let rows = st.rows.slice();
        q.filters.forEach(([k, v]) => { rows = rows.filter((r) => r[k] === v); });
        if (!(st.members[q.filters.find((f) => f[0] === 'corp_id')?.[1]] || []).includes(st.uid)) rows = [];
        rows.sort((a, b) => b.created_at - a.created_at);
        return { data: rows.map((r) => Object.assign({}, r, { created_at: new Date(r.created_at).toISOString() })), error: null };
      }
      if (q.table === 'economy_nodes' && q.op === 'insert') {
        if (st.failNodeInsert) return { data: null, error: err('filing failed') };
        st.nodes.push(Object.assign({ created_at: now() + 1 }, q.row));
        return { data: null, error: null };
      }
      return { data: [], error: null };
    };
    const b = {
      insert(row) { q.op = 'insert'; q.row = row; return b; },
      select() { if (q.op === 'insert') q.wantRow = true; return b; },
      eq(k, v) { q.filters.push([k, v]); return b; },
      order() { return b; }, limit() { return b; }, single() { return b; },
      then(res, rej) { try { res(exec()); } catch (e) { rej(e); } },
    };
    return b;
  }
  st.client = {
    from: builder,
    rpc: async (name, args) => {
      if (mode === 'HEAD' || !rpcs[name]) return { data: null, error: err('Could not find the function public.' + name + ' in the schema cache', 'PGRST202') };
      try { return { data: rpcs[name](args), error: null }; } catch (e) { return { data: null, error: e }; }
    },
  };
  st.sum = sum;
  return st;
}

/* 📌 2026-09-19 — _nodePlacedList / _nodePlacedCount joined this list, and the
   sandbox below gained NODE_MAX_PLACED / NODE_MAX_OWNED / NODE_STORED_STATUS,
   when buying a PRN stopped being capped at six: a player may now OWN any mix
   up to the ceiling and PLACE six at a time. nodeEstablish reads all of them,
   so without this the suite THREW on a ReferenceError and checked nothing —
   which the gate reports as 💥, not as a failure, and is how a treasury suite
   can go silent while every one of its own assertions is still correct.
   The two helpers are EXTRACTED rather than stubbed, so what is exercised is
   the shipped definition of "placed" and not this file's idea of it. */
const FNS = ['_ctRpcMissing', '_walletRpcUnavailable', '_ctDebitRow', '_ctRefund', '_ctDeposit', '_ctAdoptWallet', '_ctOpRevenue',
  '_opTreasuryRow', '_applyServerCharge', 'corpTreasuryFetch', 'corpTreasuryDeposit', 'boeCorpDeposit',
  '_nodePlacedList', '_nodePlacedCount', 'nodeEstablish'];
function boot(indexSrc, store, opts = {}) {
  const toasts = [];
  const Profile = { gems: store.wallet[store.uid], cloud: { signedIn: opts.offline ? false : true, userId: store.uid, displayName: 'Me' } };
  const Corp = { mine: { id: CORP, name: 'Acme', tag: 'ACM' }, owned: store.uid === FOUNDER ? { id: CORP, name: 'Acme' } : null, amOwner: true, roster: [], treasury: 0, treasuryLog: [], treasury24h: 0, treasuryKnown: false };
  const ctx = {
    console: { log() {}, warn() {}, info() {} }, Date, Math, Number, JSON, Object, Array, String, isFinite, Error, RegExp, Promise,
    Profile, Corp, Cloud: { client: store.client },
    /* ⚠ 9, not 6, ON PURPOSE — a cap the shipped code reads rather than one it
       could be hard-coding. The two new limits keep that property by being
       DERIVED from it exactly as index.html derives them (placed = the cap,
       owned = 4x), so a literal creeping into either one still shows up here. */
    FoundationReserve: { nodes: [], myPoints: 0 }, NODE_REQUIRED_LICENSE: {}, NODE_MAX_PER_CORP: 9,
    NODE_MAX_PLACED: 9, NODE_MAX_OWNED: 36, NODE_STORED_STATUS: 'stored', BOE_CORP_FEE_PCT: 0.01,
    Wallet: {}, toasts,
    initCloud: () => true,
    showToast: (m) => toasts.push(String(m)),
    gcConfirm: async () => true,
    saveProfile() {}, saveProgressCloud: async () => {},
    spendGems(a) { if (Profile.gems < a) return false; Profile.gems -= a; store.wallet[store.uid] -= a; return true; },
    addGems(a) { Profile.gems += a; store.wallet[store.uid] += a; },
    _gemsTaxExempt: (fn) => fn(), _cinderLedgerAdd() {}, walletFetchProgress() {},
    _jbNum: (n) => { const v = Number(n); return isFinite(v) ? Math.round(v) : 0; },
    _nodeType: () => ({ id: 'mine', name: 'Mine', cinder: 400, res: { metal: 1 }, buildH: 1, proc: 'metal' }),
    _jailBlocked: () => false, cityHoldsLicense: () => true, _cityLicense: () => null,
    canAffordResources: () => true, spendResources: () => opts.materialsShort ? false : true, addSalvage() {},
    _meta: () => ({ name: 'Metal' }), nodeFetch: async () => {}, nodeTierFetchPledge() {},
  };
  vm.createContext(ctx);
  const missing = [];
  const code = FNS.map((n) => { const s = extractFrom(indexSrc, n); if (!s) missing.push(n); return s || ''; }).join('\n');
  vm.runInContext(code + '\n;this.__fns = {' + FNS.filter((n) => !missing.includes(n)).map((n) => n + ':' + n).join(',') + '};', ctx);
  return { ctx, fns: ctx.__fns, toasts, Profile, Corp, missing };
}
const forge = async (store, row) => {
  const before = store.sum(CORP);
  const r = await store.client.from('corp_treasury').insert(Object.assign({ corp_id: CORP, user_id: store.uid }, row));
  return { landed: !r.error, delta: store.sum(CORP) - before };
};

console.log('\nH · harness against the sql/146 store');
{
  const st = makeStore('CAND', SQL);
  const b = boot(INDEX, st);
  ok(b.missing.length === 0, 'H.all shipped functions extracted', b.missing.join(','));
  const f1 = await forge(st, { amount: 1000, kind: 'deposit' });
  ok(!f1.landed && f1.delta === 0, 'H.bar1 direct +1000 deposit refused', JSON.stringify(f1));
  const f2 = await forge(st, { amount: 5, kind: 'node_manager_fee' });
  const f3 = await forge(st, { amount: -5, kind: 'node_manager_fee' });
  ok(!f2.landed && !f3.landed, 'H.bar1 direct node_manager_fee refused (+5 and -5)');
  const f4 = await forge(st, { amount: 1000, kind: 'refund' });
  ok(!f4.landed, 'H.direct +1000 refund refused');

  // bar 2: deposit through the RPC
  const w0 = st.wallet[ME], t0 = st.sum(CORP);
  const okDep = await b.fns.corpTreasuryDeposit(700);
  ok(okDep === true, 'H.bar2 corpTreasuryDeposit(700) succeeds', b.toasts.slice(-1)[0]);
  ok(w0 - st.wallet[ME] === 700 && st.sum(CORP) - t0 === 700, 'H.bar2 server wallet -700 and treasury +700', (w0 - st.wallet[ME]) + '/' + (st.sum(CORP) - t0));
  ok(b.Profile.gems === st.wallet[ME], 'H.bar2 Profile.gems adopts the server balance (no second local spend)', b.Profile.gems + ' vs ' + st.wallet[ME]);
  ok(st.ledger.filter((l) => l.delta === -700).length === 1, 'H.bar2 exactly one wallet ledger row for the deposit');
  ok(b.Corp.treasury === st.sum(CORP) && b.Corp.treasuryKnown === true, 'H.deposit re-reads the ledger (balance = sum(amount))', b.Corp.treasury);
  // short wallet: server holds less than local believes
  st.wallet[ME] = 100; b.Profile.gems = 5000;
  const t1 = st.sum(CORP);
  const short = await b.fns.corpTreasuryDeposit(2000);
  ok(short === false && st.wallet[ME] === 100 && st.sum(CORP) === t1 && b.Profile.gems === 5000, 'H.bar2 short server wallet: refused, nothing moved on either side');
  ok(/cannot cover/.test(b.toasts.slice(-1)[0] || ''), 'H.short wallet tells the player', b.toasts.slice(-1)[0]);

  // bar 3: construction debit + refund (materials short) and filing failed
  st.wallet[ME] = 5000; b.Profile.gems = 5000;
  const bm = boot(INDEX, st, { materialsShort: true });
  const t2 = st.sum(CORP);
  const r1 = await bm.fns.nodeEstablish('mine', true);
  const deb = st.rows.filter((r) => r.kind === 'construction');
  const rf = st.rows.filter((r) => r.kind === 'refund');
  ok(r1 === false && deb.length === 1 && rf.length === 1 && rf[0].ref_id === deb[0].id, 'H.bar3 materials short: debit then refund linked by id');
  ok(st.sum(CORP) === t2 && rf[0].amount === -deb[0].amount, 'H.bar3 treasury nets zero; refund == its debit', st.sum(CORP) - t2);
  st.failNodeInsert = true;
  const bf = boot(INDEX, st);
  const r2 = await bf.fns.nodeEstablish('mine', true);
  ok(r2 === false && st.sum(CORP) === t2 && st.rows.filter((r) => r.kind === 'refund').length === 2, 'H.bar3 filing failed: refunded by id');
  st.failNodeInsert = false;
  const r3 = await bf.fns.nodeEstablish('mine', true);
  ok(r3 === true && st.sum(CORP) === t2 - 400 && st.nodes.length === 1, 'H.successful treasury build debits once and files the node');
  const lastDebit = st.rows.filter((r) => r.kind === 'construction').pop();
  const again = await st.client.rpc('corp_treasury_refund', { p_debit_id: lastDebit.id, p_note: 'x', p_amount: 999999 });
  ok(!!again.error && st.sum(CORP) === t2 - 400, 'H.bar3 no refund once the filing landed (and no amount can be supplied)');
  const firstRefunded = st.rows.find((r) => r.kind === 'refund').ref_id;
  const twice = await st.client.rpc('corp_treasury_refund', { p_debit_id: firstRefunded });
  ok(!!twice.error, 'H.bar3 a debit refunds at most once');

  // bank path: founder only, fee server-side
  const sf = makeStore('CAND', SQL); sf.uid = FOUNDER;
  const bb = boot(INDEX, sf);
  const tb = sf.sum(CORP), wb = sf.wallet[FOUNDER];
  const okB = await bb.fns.boeCorpDeposit(1000);
  ok(okB === true && wb - sf.wallet[FOUNDER] === 1000 && sf.sum(CORP) - tb === 990 && bb.Profile.gems === sf.wallet[FOUNDER], 'H.bank deposit: wallet -1000, treasury +990, balance adopted');
  const bnf = boot(INDEX, makeStore('CAND', SQL));
  ok((await bnf.fns.boeCorpDeposit(1000)) === false, 'H.bank deposit refuses a corporation you did not found (client gate)');

  // op revenue: bounded
  const so = makeStore('CAND', SQL);
  const bo = boot(INDEX, so);
  const big = await bo.fns._ctOpRevenue({ id: 'op-1' }, 1e12, 'forge');
  const fine = await bo.fns._ctOpRevenue({ id: 'op-1' }, 1000, 'mining production');
  const dup = await bo.fns._ctOpRevenue({ id: 'op-1' }, 1000, 'mining production');
  ok(!big.ok && fine.ok && !dup.ok, 'H.op_revenue: ceiling refuses 1e12, honest 1000 banks, immediate repeat refused');

  // bar 4: fee total only counts server rows
  const fees = st.rows.filter((r) => r.kind === 'node_manager_fee').reduce((s, r) => s + r.amount, 0);
  ok(fees === 0, 'H.bar4 corp_fees_total sees no client-written node_manager_fee', fees);

  // bar 5: offline and pre-146
  const off = boot(INDEX, makeStore('CAND', SQL), { offline: true });
  ok((await off.fns.corpTreasuryDeposit(10)) === false && /Sign in/.test(off.toasts[0] || ''), 'H.bar5 offline: deposit refuses with a toast, no throw');
  const legacy = makeStore('HEAD', SQL);
  const bl = boot(INDEX, legacy);
  const wl = legacy.wallet[ME];
  ok((await bl.fns.corpTreasuryDeposit(300)) === true && legacy.sum(CORP) === 300 && legacy.wallet[ME] === wl - 300, 'H.bar5 pre-146 database: deposit still works through the legacy path');
  const bll = boot(INDEX, legacy, { materialsShort: true });
  await bll.fns.nodeEstablish('mine', true);
  ok(legacy.sum(CORP) === 300, 'H.bar5 pre-146 database: construction refund still nets zero');
}

// ═══ N · negative controls ═══════════════════════════════════════════════════
console.log('\nN · negative controls (each must be caught)');
{
  // N1: the live HEAD policy lets the forge land.
  const head = makeStore('HEAD', SQL);
  const f = await forge(head, { amount: 1000, kind: 'deposit' });
  const g = await forge(head, { amount: 5, kind: 'node_manager_fee' });
  ok(f.landed && f.delta === 1000 && g.landed, 'N1 HEAD ct_ins: +1000 deposit and node_manager_fee LAND (the check above would go red)');
  // N2: HEAD index.html against the 146 store cannot deposit.
  /* Pinned, not HEAD: once the fix is committed HEAD carries it and the control goes vacuous. 3fd3156dc5 is the last client before it (same pin as _corpmembership_smoke). */ const PRE_FIX_REF = process.env.PRE_FIX_REF || '3fd3156dc5';
  let headIndex = null;
  try { headIndex = execFileSync('git', ['-c', 'core.autocrlf=false', 'show', PRE_FIX_REF + ':public/index.html'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8'); } catch (e) {}
  if (headIndex) {
    const st = makeStore('CAND', SQL);
    // Server-written opening balance, so HEAD's build is not refused for funds.
    st.rows.push({ id: 'seed', corp_id: CORP, user_id: FOUNDER, amount: 5000, kind: 'deposit', created_at: Date.now() - 1e6, ref_id: null });
    const hb = boot(headIndex, st);
    const t0 = st.sum(CORP);
    const r = hb.fns.corpTreasuryDeposit ? await hb.fns.corpTreasuryDeposit(700) : true;
    ok(r === false && st.sum(CORP) === t0, 'N2 HEAD client against sql/146: deposit is refused (the client change is required)');
    const hm = boot(headIndex, st, { materialsShort: true });
    await hm.fns.nodeEstablish('mine', true);
    ok(st.sum(CORP) === t0 - 400, 'N2 HEAD client against sql/146: a construction refund is lost (the refund RPC is required)', st.sum(CORP) - t0);
  } else ok(false, 'N2 git show HEAD:public/index.html');
  // N3: SQL mutants.
  const m1 = checkSql(SQL.replace('    and amount < 0\n', ''));
  ok(!m1.policyBoundsAmount, 'N3 policy without `amount < 0` is caught');
  const m1store = makeStore('CAND', SQL.replace('    and amount < 0\n', '').replace("kind in ('construction', 'op_salary', 'op_startup')", "kind in ('construction', 'op_salary', 'op_startup', 'deposit')"));
  ok((await forge(m1store, { amount: 1000, kind: 'deposit' })).landed, 'N3 that mutant store lets the forge land');
  const m2 = checkSql(SQL.replace(':= 352176;', ':= 9999999;'));
  ok(m2.cap !== D.perHr, 'N4 a hand-edited ceiling no longer matches the derivation');
  const m3 = checkSql(SQL.replace("and kind in ('construction', 'op_salary', 'op_startup')", "and kind in ('construction', 'op_salary', 'op_startup', 'node_manager_fee')"));
  ok(!m3.triggerKinds || !m3.policyNoCredit, 'N5 node_manager_fee added to ct_ins is caught');
  const m4 = checkSql(SQL.replace(/create trigger ct_client_write_guard/, 'create trigger ct_client_write_guard_x'));
  ok(!m4.triggerAttached, 'N6 a detached trigger is caught');
  // N7: a client mutant writing a credit directly.
  const bad = INDEX.replace('\nasync function _ctOpRevenue(', "\nasync function _sneaky() { await Cloud.client.from('corp_treasury').insert({ amount: 5, kind: 'op_revenue' }); }\nasync function _ctOpRevenue(");
  ok(inventory([['x', bad]]).bad.length > 0, 'N7 a new direct credit writer is caught by the inventory');
  const bad2 = INDEX.replace('const _dep = await _ctDeposit(Corp.mine.id, amount, false);', 'const _dep = { legacy: true };');
  ok(inventory([['x', bad2]]).bad.length > 0, 'N8 a deposit that skips the RPC is caught');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
