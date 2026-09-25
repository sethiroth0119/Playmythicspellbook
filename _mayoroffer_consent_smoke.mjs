/* 🤝 A NODE MANAGER CONTRACT NEEDS BOTH SIGNATURES (sql/147, draft).

   The hole (proven on live 2026-09-17, rolled back): mayor_offers let a
   candidate INSERT an offer naming any node owner at player_pct 100 with
   turn null, or UPDATE player_pct / turn on an existing offer, and
   mayor_accept_offer only asked "are you a party, is it your turn (or nobody's),
   does the owner still own the node". The candidate then signed their own
   contract and node_mayors paid them 100% of the owner's city deltas.

   sql/147: a SECURITY INVOKER trigger stamps last_actor/turn on INSERT and
   freezes terms / turn / last_actor / parties against direct client UPDATEs
   (only a decline gets through); mayor_accept_offer refuses the party who last
   set the terms; counters go through mayor_offer_counter().

   This suite cannot reach Postgres. The live proof (exploit DO block against
   HEAD seats the attacker; the same block with 147's DDL first refuses every
   step and the owner-offers / candidate-accepts flow still seats at the
   offered pct; afterwards mayor_offers = 27 and node_mayors unchanged) is in
   the builder's report. This suite is the static half that keeps it true:

     S  THE MIGRATION's shape: idempotent, verify query last, RLS restated,
        anon write grants revoked, RPCs definer + search_path, the guard is
        NOT definer (a definer trigger sees current_user = postgres and would
        exempt every client write).
     M  A MODEL whose rules are PARSED from the SQL text: which columns the
        trigger freezes, whether INSERT stamps last_actor from auth.uid(),
        whether accept refuses the last setter. The exploit sequence and the
        legitimate flow run against it.
     N  NEGATIVE CONTROLS: the same exploit against the HEAD definitions
        (the live function text, captured below) SEATS the attacker at 100;
        mutants of 147 (last-setter gate removed, player_pct unfrozen, turn
        gate removed, insert stamp removed, guard made definer) are each caught.
     C  CLIENT INVENTORY: no file under public/ writes mayor_offers directly
        except through the RPCs; a planted direct write is caught.

   Run: node _mayoroffer_consent_smoke.mjs */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); c ? passes++ : fails++; };
const section = (t) => console.log('\n' + t);

const SQL_PATH = 'sql/147_mayor_offer_consent.sql';
const raw = readFileSync(SQL_PATH);
const SQL = raw.toString('utf8');
// Strip comments so prose that NAMES a rule never satisfies the check for it.
const code = (s) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const C147 = code(SQL);

// The live definitions at HEAD (pg_get_functiondef / pg_policy on 2026-09-17).
const HEAD_ACCEPT = `
declare o public.mayor_offers%rowtype;
begin
  select * into o from public.mayor_offers where id = p_offer_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if auth.uid() is null or auth.uid() not in (o.owner_id, o.candidate_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_party');
  end if;
  if o.status not in ('pending', 'countered') then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  if o.turn is not null and o.turn <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_your_turn');
  end if;
  if not exists (select 1 from public.tw_node_owners w
                  where w.node_id = o.node_id and w.user_id = o.owner_id) then
    return jsonb_build_object('ok', false, 'error', 'not_the_node_owner');
  end if;
  update public.mayor_offers
     set status = 'accepted', turn = null, last_actor = auth.uid(), updated_at = now()
   where id = o.id;
  insert into public.node_mayors (node_id, mayor_id, owner_id, offer_id, player_pct) values (o.node_id, o.candidate_id, o.owner_id, o.id, o.player_pct);
end`;
const HEAD_SQL = `create or replace function public.mayor_accept_offer(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$${HEAD_ACCEPT}$fn$;`;

// ── rule extraction ─────────────────────────────────────────────────────────
function fnBody(sql, name) {
  const re = new RegExp('create\\s+or\\s+replace\\s+function\\s+public\\.' + name + '\\s*\\(([\\s\\S]*?)\\$fn\\$([\\s\\S]*?)\\$fn\\$', 'i');
  const m = sql.match(re);
  return m ? { head: m[1], body: m[2] } : null;
}
function rules(sqlText) {
  const s = code(sqlText);
  const acc = fnBody(s, 'mayor_accept_offer');
  const guard = fnBody(s, 'mayor_offers_guard');
  const r = { acceptExists: !!acc, guardExists: !!guard };
  if (acc) {
    const seat = acc.body.search(/insert\s+into\s+public\.node_mayors/i);
    const pre = seat >= 0 ? acc.body.slice(0, seat) : acc.body;
    r.lastSetterGate = /auth\.uid\(\)\s*=\s*coalesce\(\s*o\.last_actor\s*,\s*o\.created_by\s*\)[\s\S]*?return\s+jsonb_build_object\(\s*'ok'\s*,\s*false/i.test(pre);
    r.turnGate = /o\.turn\s+is\s+not\s+null\s+and\s+o\.turn\s*<>\s*auth\.uid\(\)/i.test(pre);
    r.partyGate = /auth\.uid\(\)\s+not\s+in\s*\(\s*o\.owner_id\s*,\s*o\.candidate_id\s*\)/i.test(pre);
    r.pctGate = /o\.player_pct\s*<\s*0\s+or\s+o\.player_pct\s*>\s*100/i.test(pre);
  }
  const trig = /create\s+trigger\s+mayor_offers_guard\s+before\s+insert\s+or\s+update\s+on\s+public\.mayor_offers\s+for\s+each\s+row\s+execute\s+function\s+public\.mayor_offers_guard\(\)/i.test(s);
  r.triggerOn = !!guard && trig;
  if (guard) {
    const g = guard.body;
    r.guardDefiner = /security\s+definer/i.test(guard.head);
    r.clientTest = /v_client\s+boolean\s*:=\s*current_user\s+in\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)/i.test(g);
    const ins = g.slice(0, g.search(/if\s+not\s+v_client\s+then/i));
    r.insStampLast = /new\.last_actor\s*:=\s*coalesce\(\s*v_uid/i.test(ins);
    r.insStampTurn = /new\.turn\s*:=\s*case\s+when\s+new\.last_actor\s*=\s*new\.owner_id\s+then\s+new\.candidate_id\s+else\s+new\.owner_id\s+end/i.test(ins);
    r.insCreatedBy = /new\.created_by\s*:=\s*v_uid/i.test(ins);
    r.insStatus = /new\.status\s*:=\s*'pending'/i.test(ins);
    r.insOwnerCheck = /_mayor_node_owned\(\s*new\.node_id\s*,\s*new\.owner_id\s*\)/i.test(ins);
    r.insPctRange = /new\.player_pct\s*<\s*0\s+or\s+new\.player_pct\s*>\s*100/i.test(ins);
    const upd = g.slice(g.search(/if\s+not\s+v_client\s+then/i));
    const termBlock = (upd.match(/if\s+(new\.player_pct[\s\S]*?)then\s+raise\s+exception\s+'mayor_offers: change terms/i) || [])[1] || '';
    r.frozenTerms = [...termBlock.matchAll(/new\.(\w+)\s+is\s+distinct\s+from\s+old\.\1/gi)].map(m => m[1]);
    r.turnFrozen = /new\.turn\s+is\s+distinct\s+from\s+old\.turn[\s\S]*?raise\s+exception/i.test(upd);
    r.lastFrozen = /new\.last_actor\s+is\s+distinct\s+from\s+old\.last_actor[\s\S]*?raise\s+exception/i.test(upd);
    r.partiesFrozen = ['node_id', 'owner_id', 'candidate_id', 'created_by'].every(c => new RegExp('new\\.' + c + '\\s*<>\\s*old\\.' + c).test(upd));
    r.onlyDecline = /if\s+new\.status\s*<>\s*'declined'\s+then\s+raise/i.test(upd);
    r.closedStays = /old\.status\s+not\s+in\s*\(\s*'pending'\s*,\s*'countered'\s*\)\s+then\s+raise/i.test(upd);
  }
  return r;
}

// ── the model: a mayor_offers + node_mayors store driven by parsed rules ────
const OWNER = 'owner-O', ATT = 'attacker-A', CAND = 'cand-B', NODE = 'N-28';
function makeStore(R) {
  const offers = new Map(); const nm = new Map(); let seq = 0;
  const owns = (node, uid) => node === NODE && uid === OWNER;
  const guarded = R.guardExists && R.triggerOn && R.clientTest && !R.guardDefiner;
  const TERMS = ['player_pct', 'currency', 'hours_per_month', 'card_policy', 'resource_policy'];
  return {
    nm,
    offers,
    // A direct PostgREST INSERT as `uid` (policy: created_by = uid and uid is a party).
    clientInsert(uid, row) {
      if (row.created_by !== uid || ![row.owner_id, row.candidate_id].includes(uid)) throw new Error('rls');
      const n = { status: 'pending', turn: null, last_actor: null, currency: 'CINDER', hours_per_month: 20, card_policy: 'owner', resource_policy: 'owner', ...row };
      if (guarded) {
        if (R.insCreatedBy) n.created_by = uid;
        if (R.insStatus) n.status = 'pending';
        if (R.insOwnerCheck && !owns(n.node_id, n.owner_id)) throw new Error('not owner');
        if (R.insPctRange && (n.player_pct < 0 || n.player_pct > 100)) throw new Error('pct');
        if (R.insStampLast) n.last_actor = uid;
        if (R.insStampTurn) n.turn = n.last_actor === n.owner_id ? n.candidate_id : n.owner_id;
      }
      n.id = 'o' + (++seq); offers.set(n.id, n); return n.id;
    },
    clientUpdate(uid, id, patch) {
      const o = offers.get(id);
      if (![o.owner_id, o.candidate_id].includes(uid)) throw new Error('rls');
      const n = { ...o, ...patch };
      if (guarded) {
        if (R.partiesFrozen && ['node_id', 'owner_id', 'candidate_id', 'created_by'].some(c => n[c] !== o[c])) throw new Error('parties');
        for (const c of TERMS) if (R.frozenTerms.includes(c) && n[c] !== o[c]) throw new Error('terms:' + c);
        const sameStatus = n.status === o.status;
        if (sameStatus && R.turnFrozen && n.turn !== o.turn) throw new Error('turn');
        if (sameStatus && R.lastFrozen && n.last_actor !== o.last_actor) throw new Error('last_actor');
        if (!sameStatus) {
          if (R.closedStays && !['pending', 'countered'].includes(o.status)) throw new Error('closed');
          if (R.onlyDecline && n.status !== 'declined') throw new Error('status');
          n.last_actor = uid; n.turn = null;
        }
      }
      offers.set(id, n);
    },
    accept(uid, id) {
      const o = offers.get(id);
      if (!o) return { ok: false, error: 'not_found' };
      if (R.partyGate && ![o.owner_id, o.candidate_id].includes(uid)) return { ok: false, error: 'not_a_party' };
      if (!['pending', 'countered'].includes(o.status)) return { ok: false, error: 'closed' };
      if (R.lastSetterGate && uid === (o.last_actor ?? o.created_by)) return { ok: false, error: 'other_party_must_accept' };
      if (R.turnGate && o.turn != null && o.turn !== uid) return { ok: false, error: 'not_your_turn' };
      if (R.pctGate && (o.player_pct < 0 || o.player_pct > 100)) return { ok: false, error: 'bad_terms' };
      if (!owns(o.node_id, o.owner_id)) return { ok: false, error: 'not_the_node_owner' };
      o.status = 'accepted'; o.turn = null; o.last_actor = uid;
      nm.set(o.node_id, { mayor_id: o.candidate_id, owner_id: o.owner_id, player_pct: o.player_pct });
      return { ok: true };
    },
  };
}
const tryIt = (f) => { try { f(); return 'ok'; } catch (e) { return 'refused:' + e.message; } };

// The exploit sequence. Returns what an attacker got.
function exploit(R) {
  const S = makeStore(R); const out = {};
  // X1: attacker writes a 100% offer naming the owner, turn null, accepts alone.
  let id1; out.x1Insert = tryIt(() => { id1 = S.clientInsert(ATT, { node_id: NODE, owner_id: OWNER, candidate_id: ATT, created_by: ATT, player_pct: 100, turn: null }); });
  out.x1Accept = id1 ? S.accept(ATT, id1) : { ok: false, error: 'no row' };
  out.x1Seat = S.nm.get(NODE) ? { ...S.nm.get(NODE) } : null;
  S.nm.clear();
  // X2: owner offers 10; attacker rewrites pct and turn, then accepts.
  const id2 = S.clientInsert(OWNER, { node_id: NODE, owner_id: OWNER, candidate_id: ATT, created_by: OWNER, player_pct: 10 });
  out.x2Pct = tryIt(() => S.clientUpdate(ATT, id2, { player_pct: 100 }));
  out.x2Turn = tryIt(() => S.clientUpdate(ATT, id2, { turn: null, last_actor: OWNER }));
  out.x2Status = tryIt(() => S.clientUpdate(ATT, id2, { status: 'accepted' }));
  out.x2Accept = S.accept(ATT, id2);
  out.x2Seat = S.nm.get(NODE) ? { ...S.nm.get(NODE) } : null;
  S.nm.clear();
  // X3: whoever last set the terms tries to accept them.
  const id3 = S.clientInsert(OWNER, { node_id: NODE, owner_id: OWNER, candidate_id: CAND, created_by: OWNER, player_pct: 20 });
  out.x3Accept = S.accept(OWNER, id3);
  out.x3Seat = S.nm.get(NODE) ? { ...S.nm.get(NODE) } : null;
  // POS: the other party signs.
  out.posAccept = S.accept(CAND, id3);
  out.posSeat = S.nm.get(NODE) ? { ...S.nm.get(NODE) } : null;
  // Out-of-range pct on insert.
  out.pct150 = tryIt(() => S.clientInsert(ATT, { node_id: NODE, owner_id: OWNER, candidate_id: ATT, created_by: ATT, player_pct: 150 }));
  return out;
}
// Each layer must hold ON ITS OWN, so removing one is visible even though the
// other still covers the hole: the trigger alone (accept gate off) and the
// accept gate alone (trigger off, i.e. a client writing rows as at HEAD).
const triggerOnly = (R) => ({ ...R, lastSetterGate: false });
const gateOnly = (R) => ({ ...R, guardExists: false });
const attackerWon = (o) =>
  (o.x1Accept.ok && o.x1Seat?.mayor_id === ATT && o.x1Seat.player_pct === 100) ||
  (o.x2Accept.ok && o.x2Seat?.player_pct === 100) ||
  (o.x3Accept.ok);

// ═════════════════════════════════════════════════════════════════════════════
section('S · the migration');
ok(raw.indexOf(13) === -1, 'sql/147 has no CR bytes');
const nums = readdirSync('sql').filter(f => /^147_/.test(f));
ok(nums.length === 1, 'exactly one sql/147_* file', nums.join(','));
ok(!/^\s*(begin|commit)\s*;/im.test(C147), 'no transaction control (the SQL editor wraps it)');
const stmts = C147.trim().split(/;\s*$/m).map(s => s.trim()).filter(Boolean);
ok(/^select\b/i.test(stmts[stmts.length - 1]), 'the last statement is a verify select');
ok(/active_node_managers/.test(stmts[stmts.length - 1]) && /anon_write_grants/.test(stmts[stmts.length - 1]), 'the verify reports active managers and anon write grants');
ok(!/create\s+function\b/i.test(C147) && (C147.match(/create\s+or\s+replace\s+function/gi) || []).length === 6, 'all six functions are create or replace');
ok(/drop\s+trigger\s+if\s+exists\s+mayor_offers_guard\s+on\s+public\.mayor_offers\s*;\s*create\s+trigger\s+mayor_offers_guard/i.test(C147), 'the trigger is dropped-if-exists before create (re-runnable)');
for (const p of ['mayor_offers_create', 'mayor_offers_party_read', 'mayor_offers_party_update'])
  ok(new RegExp('drop\\s+policy\\s+if\\s+exists\\s+' + p + '\\s+on\\s+public\\.mayor_offers\\s*;\\s*create\\s+policy\\s+' + p).test(C147), `policy ${p} is drop-if-exists + create`);
ok(/alter\s+table\s+public\.mayor_offers\s+enable\s+row\s+level\s+security/i.test(C147), 'RLS is (re)enabled in the same file');
ok(!/using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)/i.test(C147), 'no policy is using(true) / with check(true)');
ok(/for\s+insert\s+to\s+authenticated\s+with\s+check\s*\(\s*created_by\s*=\s*auth\.uid\(\)/i.test(C147), 'insert policy pins created_by = auth.uid()');
ok(/for\s+update\s+to\s+authenticated\s+using\s*\([^)]*owner_id\s*=\s*auth\.uid\(\)[^)]*candidate_id\s*=\s*auth\.uid\(\)\s*\)\s*with\s+check/i.test(C147), 'update policy is party-scoped with a WITH CHECK');
ok(/revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+public\.mayor_offers\s+from\s+anon/i.test(C147), 'anon loses write grants on mayor_offers');
ok(/revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+public\.mayor_offer_events\s+from\s+anon/i.test(C147), 'anon loses write grants on mayor_offer_events');
for (const f of ['mayor_accept_offer', 'mayor_offer_create', 'mayor_offer_counter', 'mayor_offer_decline']) {
  const b = fnBody(C147, f);
  ok(b && /security\s+definer/i.test(b.head) && /set\s+search_path\s*=\s*public/i.test(b.head), `${f} is SECURITY DEFINER with a pinned search_path`);
  ok(new RegExp('revoke\\s+all\\s+on\\s+function\\s+public\\.' + f + '\\([^)]*\\)\\s+from\\s+public\\s*,\\s*anon').test(C147) &&
     new RegExp('grant\\s+execute\\s+on\\s+function\\s+public\\.' + f + '\\([^)]*\\)\\s+to\\s+authenticated').test(C147), `${f}: revoked from public/anon, granted to authenticated`);
}
{
  const c = fnBody(C147, 'mayor_offer_counter').body;
  ok(/v_uid\s*=\s*coalesce\(\s*o\.last_actor\s*,\s*o\.created_by\s*\)[\s\S]*?not_your_turn/i.test(c), 'counter refuses the party who last set the terms');
  ok(/last_actor\s*=\s*v_uid/i.test(c) && /turn\s*=\s*case\s+when\s+v_uid\s*=\s*o\.owner_id\s+then\s+o\.candidate_id\s+else\s+o\.owner_id\s+end/i.test(c), 'counter stamps last_actor and hands the turn over');
  const cr = fnBody(C147, 'mayor_offer_create').body;
  ok(/_mayor_node_owned\(\s*p_node_id\s*,\s*p_owner_id\s*\)/i.test(cr) && /v_uid\s+not\s+in\s*\(\s*p_owner_id\s*,\s*p_candidate_id\s*\)/i.test(cr), 'create checks the caller is a party and the owner owns the node');
}
{
  // The only node_mayors write in the file is accept's seat.
  const writes = [...C147.matchAll(/(insert\s+into|update|delete\s+from)\s+public\.node_mayors/gi)];
  ok(writes.length === 1, 'the file writes node_mayors exactly once (accept\'s seat)', writes.length);
  ok(!/public\.economy|sim\.js/.test(C147), 'no economy reference');
}

section('M · the model, rules parsed from sql/147');
const R147 = rules(SQL);
ok(R147.triggerOn && R147.clientTest, 'the guard trigger is installed and tells clients from RPCs by current_user');
ok(R147.guardDefiner === false, 'the guard is NOT security definer');
ok(R147.lastSetterGate && R147.turnGate && R147.partyGate && R147.pctGate, 'accept has party, last-setter, turn and pct gates before the seat');
ok(['player_pct', 'currency', 'hours_per_month', 'card_policy', 'resource_policy'].every(c => R147.frozenTerms.includes(c)), 'every term column is frozen', R147.frozenTerms.join(','));
ok(R147.turnFrozen && R147.lastFrozen && R147.partiesFrozen, 'turn, last_actor and the parties are frozen');
ok(R147.insStampLast && R147.insStampTurn && R147.insCreatedBy && R147.insOwnerCheck, 'INSERT stamps writer/turn and checks the owner');
const F = exploit(R147);
ok(F.x1Insert === 'ok' && !F.x1Accept.ok && F.x1Accept.error === 'other_party_must_accept' && !F.x1Seat, '(a) a self-written 100% offer cannot be accepted by its writer', JSON.stringify(F.x1Accept));
ok(F.x2Pct.startsWith('refused') && F.x2Turn.startsWith('refused') && F.x2Status.startsWith('refused'), '(b) UPDATE of player_pct / turn / status is refused', [F.x2Pct, F.x2Turn, F.x2Status].join(' | '));
ok(F.x2Accept.ok && F.x2Seat?.player_pct === 10, 'the candidate can still accept the OWNER\'s 10% offer as written', JSON.stringify(F.x2Seat));
ok(!F.x3Accept.ok && F.x3Accept.error === 'other_party_must_accept' && !F.x3Seat, '(c) the party who last set the terms cannot accept; node_mayors unchanged', JSON.stringify(F.x3Accept));
ok(F.posAccept.ok && F.posSeat?.mayor_id === CAND && F.posSeat.player_pct === 20, 'POSITIVE: owner offers, candidate accepts, seated at the offered pct', JSON.stringify(F.posSeat));
ok(F.pct150.startsWith('refused'), 'a 150% offer is refused at insert');
ok(!attackerWon(F), 'the attacker gets nothing under 147');
ok(!attackerWon(exploit(triggerOnly(R147))), 'the trigger ALONE stops the exploit (accept gate switched off in the model)');
ok(!attackerWon(exploit(gateOnly(R147))), 'the accept gate ALONE stops the exploit (trigger switched off in the model)');

section('N · negative controls');
const RH = rules(HEAD_SQL);
const H = exploit(RH);
ok(attackerWon(H), 'HEAD: the exploit SEATS the attacker (the suite can see the hole)', JSON.stringify({ x1: H.x1Accept, seat: H.x1Seat }));
ok(H.x1Accept.ok && H.x1Seat?.player_pct === 100 && H.x2Pct === 'ok' && H.x3Accept.ok, 'HEAD: self-insert accept, pct rewrite and self-accept all succeed');
const mutants = [
  ['last-setter gate removed', SQL.replace(/if auth\.uid\(\) = coalesce\(o\.last_actor, o\.created_by\) then\s*return jsonb_build_object\('ok', false, 'error', 'other_party_must_accept'\);\s*end if;/, '')],
  ['player_pct unfrozen', SQL.replace(/if new\.player_pct      is distinct from old\.player_pct\s*or /, 'if ')],
  ['turn gate removed', SQL.replace(/\(new\.turn is distinct from old\.turn or new\.last_actor is distinct from old\.last_actor\)/, '(false)')],
  ['insert stamp removed', SQL.replace(/new\.last_actor := coalesce\(v_uid, new\.created_by\);/, '').replace(/new\.turn := case when new\.last_actor = new\.owner_id then new\.candidate_id else new\.owner_id end;/, '')],
  ['guard made security definer', SQL.replace(/(function public\.mayor_offers_guard\(\)\s*returns trigger\s*language plpgsql\s*)security invoker/, '$1security definer')],
  ['trigger never created', SQL.replace(/create trigger mayor_offers_guard/, 'create trigger mayor_offers_guard_x')],
];
for (const [name, text] of mutants) {
  ok(text !== SQL, `mutant "${name}" applied`);
  const rm = rules(text);
  const m = exploit(rm), t = exploit(triggerOnly(rm)), g = exploit(gateOnly(rm));
  const caught = attackerWon(m) || m.x2Pct === 'ok' || m.x2Turn === 'ok' || attackerWon(t) || attackerWon(g);
  ok(caught, `mutant "${name}" lets an exploit step through (caught)`, JSON.stringify({ x1: m.x1Accept, x2Pct: m.x2Pct, x2Turn: m.x2Turn, x3: m.x3Accept }));
}

section('C · client writer inventory');
function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = join(dir, f); const st = statSync(p);
    if (st.isDirectory()) walk(p, acc); else if (/\.(html|js|mjs)$/.test(f)) acc.push(p);
  }
  return acc;
}
const DIRECT = /from\(\s*['"]mayor_offers['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\s*\(/;
const scan = (txt) => DIRECT.test(txt.replace(/\s+/g, ' '));
const files = walk('public');
ok(files.length > 50, 'scanned public/', files.length);
const offenders = files.filter(f => { const t = readFileSync(f, 'utf8'); return t.includes('mayor_offers') && scan(t); });
ok(offenders.length === 0, 'no file under public/ writes mayor_offers directly (use mayor_offer_create/counter/decline)', offenders.join(','));
ok(scan(`sb.from('mayor_offers')\n  .update({ player_pct: 100 })`), 'NEGATIVE: a planted direct update is caught by the scanner');
ok(!scan(`sb.rpc('mayor_offer_counter', { p_offer_id: id, p_player_pct: 40 })`), 'the RPC call is not flagged');

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
