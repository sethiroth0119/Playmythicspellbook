/* ═══════════════════════════════════════════════════════════════════════════
   haul.api.js — everything that talks to Supabase, and the state it fills.

   🔒 EVERY call is guarded. No client, no sign-in, no table, no RPC → the
   module drops to PRACTICE mode: the board is empty, the run still plays, no
   Cinder moves, and the UI says exactly why. Follow the Corp.* pattern.

   💰 No money is moved here either. The RPCs in sql/038 debit the shipper,
   credit the driver, refund the shipper and pay the treasury; this file only
   calls them and then asks the bridge to re-read the wallet. The one thing it
   DOES move client-side is GOODS: the shipper's resources leave their stash
   before the job row is written (escrow first, exactly as the exchange does)
   and are refunded through refundRes — never addRes, which respects the stash
   cap and would silently destroy an unwind — if the post fails.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge, client } from './haul.bridge.js';

export const Haul = {
  jobs: [],          // the open board
  mine: [],          // jobs I posted, am driving, or am receiving
  board: [],         // haul_driver_board rows
  company: null,     // haul_companies row for my corp (or null)
  wages: {},         // user_id -> wage_pct overrides for my corp
  transportOp: null, // my corp's transport operation, if it has one
  runs: [],          // my recent runs
  missing: false,    // sql/038 not applied
  offline: false,    // no client / not signed in
  error: null,
  loading: false,
  lastLoad: 0,
};

const MISSING_RE = /haul_jobs|haul_runs|haul_companies|haul_wages|haul_driver_board|haul_post_job|haul_claim_job|haul_complete|haul_claim_goods|haul_cancel_job|relation .* does not exist|schema cache|PGRST20[12]|42P01|42883/i;

function fail(e) {
  const msg = String((e && (e.message || e.code)) || e || 'error');
  if (MISSING_RE.test(msg)) Haul.missing = true;
  Haul.error = msg;
  return null;
}
function ready() {
  const c = client();
  Haul.offline = !(c && bridge().signedIn());
  return Haul.offline ? null : c;
}
/** Human-readable reason for an RPC exception name. */
const WHY = {
  NOT_SIGNED_IN: 'Sign in first.', BAD_ROUTE: 'Pick two different cities.', BAD_RESOURCE: 'Pick a resource.',
  BAD_QTY: 'Quantity must be 1–99,999.', BAD_FARE: 'That fare is out of range.', TOO_MANY_JOBS: 'You already have 10 shipments waiting.',
  TOO_FAST: 'Slow down — one post every few seconds.', INSUFFICIENT: 'Not enough Cinder for that fare.',
  NO_SUCH_JOB: 'That shipment is gone.', OWN_JOB: 'You cannot drive your own shipment.', ALREADY_CLAIMED: 'Another driver already took it.',
  HOLDING_A_JOB: 'Finish the run you already claimed first.', NOT_YOUR_RUN: 'That run is not yours.',
  PAYOUT_EXCEEDS_ESCROW: 'Settlement refused — payout exceeds escrow.',
};
export function why(code) {
  const m = String(code || '');
  const k = Object.keys(WHY).find((x) => m.includes(x));
  return k ? WHY[k] : (MISSING_RE.test(m) ? 'The haul tables are not set up yet (sql/038).' : m.slice(0, 120));
}

export async function loadAll() {
  if (Haul.loading) return;
  const c = ready();
  if (!c) { Haul.loading = true; try { await loadCompany(); } catch (e) {} Haul.loading = false; return; }
  Haul.loading = true; Haul.error = null;
  try {
    const me = bridge().userId();
    const [open, mine, board] = await Promise.all([
      c.from('haul_jobs').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(60),
      c.from('haul_jobs').select('*').or('shipper_id.eq.' + me + ',driver_id.eq.' + me + ',recipient_id.eq.' + me).order('created_at', { ascending: false }).limit(40),
      c.from('haul_driver_board').select('*').limit(200),
    ]);
    if (open.error) fail(open.error); else Haul.jobs = open.data || [];
    if (mine.error) fail(mine.error); else Haul.mine = mine.data || [];
    if (board.error) fail(board.error); else Haul.board = board.data || [];
    if (!Haul.missing) { Haul.missing = false; }
    const runs = await c.from('haul_runs').select('*').eq('driver_id', me).order('created_at', { ascending: false }).limit(30);
    if (!runs.error) Haul.runs = runs.data || [];
    await loadCompany();
  } catch (e) { fail(e); }
  Haul.loading = false; Haul.lastLoad = Date.now();
}

export async function loadCompany() {
  // The corp half comes from the bridge and works offline; only the terms and
  // the wage overrides need the server.
  Haul.company = null; Haul.wages = {}; Haul.transportOp = null;
  try {
    const b = bridge(); await b.corpEnsure();
    const corp = b.myCorp();
    if (!corp) return;
    Haul.transportOp = await b.transportOp();
    const c = ready(); if (!c) return;
    const r = await c.from('haul_companies').select('*').eq('corp_id', corp.id).maybeSingle();
    if (r.error) { fail(r.error); return; }
    Haul.company = r.data || null;
    const w = await c.from('haul_wages').select('user_id,wage_pct').eq('corp_id', corp.id).limit(200);
    if (!w.error) (w.data || []).forEach((x) => { Haul.wages[x.user_id] = Number(x.wage_pct); });
  } catch (e) { fail(e); }
}

/** Post a shipment. Escrows the goods locally FIRST; the fare is debited by
    the RPC. Returns { ok, job | why }. */
export async function postJob(j) {
  const b = bridge();
  const c = ready(); if (!c) return { ok: false, why: 'Sign in to post a shipment.' };
  const qty = Math.max(1, j.qty | 0);
  if (b.getRes(j.resource) < qty) return { ok: false, why: 'You do not hold ' + qty + ' of that.' };
  if (!b.spendRes(j.resource, qty)) return { ok: false, why: 'Could not take the goods from your stash.' };
  b.saveProfile();
  try {
    const r = await c.rpc('haul_post_job', {
      p_from_node: j.fromId, p_from_name: j.fromName, p_to_node: j.toId, p_to_name: j.toName,
      p_resource: j.resource, p_qty: qty, p_distance_km: j.km, p_fare: Math.floor(j.fare),
      p_recipient: j.recipientId || null, p_shipper_name: b.displayName(),
    });
    if (r.error) throw r.error;
    await b.refreshWallet();
    return { ok: true, job: r.data };
  } catch (e) {
    fail(e);
    b.refundRes(j.resource, qty); b.saveProfile();
    return { ok: false, why: why(e && e.message) };
  }
}

export async function cancelJob(job) {
  const b = bridge(); const c = ready(); if (!c) return false;
  try {
    const r = await c.rpc('haul_cancel_job', { p_job_id: job.id });
    if (r.error) throw r.error;
    if (r.data === true) { b.refundRes(job.resource, job.qty | 0); b.saveProfile(); await b.refreshWallet(); return true; }
    return false;
  } catch (e) { fail(e); return false; }
}

export async function claimJob(job) {
  const c = ready(); if (!c) return { ok: false, why: 'Sign in to take a job.' };
  try {
    const r = await c.rpc('haul_claim_job', { p_job_id: job.id, p_driver_name: bridge().displayName() });
    if (r.error) throw r.error;
    return { ok: true, job: r.data };
  } catch (e) { fail(e); return { ok: false, why: why(e && e.message) }; }
}

export async function completeRun(job, out) {
  const b = bridge(); const c = ready(); if (!c) return { ok: false, why: 'Offline — the run could not be settled.' };
  try {
    const r = await c.rpc('haul_complete', {
      p_job_id: job.id, p_crashes_car: out.crashesCar | 0, p_crashes_rail: out.crashesRail | 0,
      p_time_s: out.timeS | 0, p_par_s: out.parS | 0, p_cargo_pct: out.completed ? out.cargoPct : 0,
    });
    if (r.error) throw r.error;
    await b.refreshWallet();
    try { await b.corpTreasuryRefresh(); } catch (e) {}
    return { ok: true, run: r.data };
  } catch (e) { fail(e); return { ok: false, why: why(e && e.message) }; }
}

export async function claimGoods(job) {
  const b = bridge(); const c = ready(); if (!c) return { ok: false, why: 'Sign in.' };
  try {
    const r = await c.rpc('haul_claim_goods', { p_job_id: job.id });
    if (r.error) throw r.error;
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) return { ok: false, why: 'Already collected.' };
    const n = row.units | 0;
    if (n > 0) { b.addRes(row.resource, n); b.saveProfile(); }
    return { ok: true, resource: row.resource, units: n };
  } catch (e) { fail(e); return { ok: false, why: why(e && e.message) }; }
}

export async function saveCompany(terms) {
  const b = bridge(); const c = ready(); if (!c) return false;
  const corp = b.myCorp(); if (!corp || !b.amCorpFounder()) return false;
  try {
    const row = { corp_id: corp.id, wage_pct: +terms.wage_pct, car_penalty_pct: +terms.car_penalty_pct, rail_penalty_pct: +terms.rail_penalty_pct, max_penalty_pct: +terms.max_penalty_pct, updated_by: b.userId(), updated_at: new Date().toISOString() };
    const r = await c.from('haul_companies').upsert(row, { onConflict: 'corp_id' }).select().maybeSingle();
    if (r.error) throw r.error;
    Haul.company = r.data || row;
    return true;
  } catch (e) { fail(e); return false; }
}

export async function setWage(userId, pct) {
  const b = bridge(); const c = ready(); if (!c) return false;
  const corp = b.myCorp(); if (!corp || !b.amCorpFounder()) return false;
  try {
    if (pct == null) {
      const r = await c.from('haul_wages').delete().eq('corp_id', corp.id).eq('user_id', userId);
      if (r.error) throw r.error; delete Haul.wages[userId]; return true;
    }
    const r = await c.from('haul_wages').upsert({ corp_id: corp.id, user_id: userId, wage_pct: +pct, set_by: b.userId(), updated_at: new Date().toISOString() }, { onConflict: 'corp_id,user_id' });
    if (r.error) throw r.error;
    Haul.wages[userId] = +pct; return true;
  } catch (e) { fail(e); return false; }
}

/* ── Practice log — local only, so the rank preview works before sign-in and
   so a run against nothing still teaches the road. Never money. */
const PRACTICE_KEY = 'haul_practice_v1';
export function practiceLog() { try { return JSON.parse(localStorage.getItem(PRACTICE_KEY) || '[]'); } catch (e) { return []; } }
export function practiceAdd(out) {
  try {
    const L = practiceLog();
    L.unshift({ at: Date.now(), km: out.km, timeS: out.timeS, parS: out.parS, crashesCar: out.crashesCar, crashesRail: out.crashesRail, cargoPct: out.cargoPct, completed: !!out.completed });
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(L.slice(0, 30)));
  } catch (e) {}
}
/** Practice runs folded into the same stats shape as haul_driver_board. */
export function practiceStats() {
  const L = practiceLog(); if (!L.length) return null;
  const d = L.filter((r) => r.completed);
  const s = { runs: L.length, delivered: d.length, km: 0, crashes_car: 0, crashes_rail: 0, cargo_avg: 0, time_ratio: 1, earned: 0, company_net: 0, fare_paid: 0 };
  L.forEach((r) => { s.km += r.km; s.crashes_car += r.crashesCar; s.crashes_rail += r.crashesRail; });
  if (d.length) { s.cargo_avg = d.reduce((a, r) => a + r.cargoPct, 0) / d.length; s.time_ratio = d.reduce((a, r) => a + Math.min(2, r.parS ? r.timeS / r.parS : 1), 0) / d.length; }
  return s;
}
