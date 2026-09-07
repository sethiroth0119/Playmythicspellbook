/* ═══════════════════════════════════════════════════════════════════════════
   merc.api.js — EVERY Supabase call for the Mercenary Board.
   Nothing else in /src/mercenary touches the client. If a query lives
   somewhere else, that is the bug.

   ⚠ EVERY call degrades. sql/038_mercenary_board.sql is applied BY HAND in the
   Supabase editor (CLAUDE.md, "Migrations"), so on any given client the tables
   may simply not exist yet — and the game must stay usable when they do not.
   No call here ever throws at its caller: it returns empty data plus a
   `missing` flag, and the UI says "the board is not set up yet" instead of
   breaking. This mirrors how Corp.* already behaves.

   🔴 THE ORDER OF OPERATIONS IS THE SAFETY STORY, and it is not the same on
      both sides of a trade:
        • MONEY moves server-first. merc_post_contract charges inside its own
          transaction, so there is no window where a contract exists unpaid.
        • GOODS move client-first. Profile.salvage and Profile.cardCollection
          are CLIENT state — the server cannot debit them — so deliver() takes
          the goods out of the stash BEFORE writing the delivery row, and puts
          them back if the write fails. That is exactly the escrow-first order
          /src/trading uses, and for the same reason: writing the row first and
          discovering the player never had the goods mints them from nothing.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge } from './merc.bridge.js';
import * as M from './merc.manifest.js';

// PostgREST codes that mean "the migration has not been run", as opposed to a
// real failure. Distinguishing them is what lets the UI say something useful.
const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache/i;

function client() {
  const b = bridge();
  try {
    if (!b || !b.cloud || !b.cloud.client) return null;
    if (!b.signedIn()) return null;
    return b.cloud.client;
  } catch (e) { return null; }
}

function fail(e) {
  const msg = (e && (e.message || e.msg)) || String(e || '');
  return { ok: false, missing: MISSING_RE.test(msg), error: msg };
}
const OFFLINE = { ok: false, missing: false, offline: true, error: 'not signed in' };

/* The RPCs raise bare codes (OVER_DELIVERY:scrap, DEADLINE_NOT_PASSED …)
   because a database is not where user-facing prose belongs. This is where a
   code becomes a sentence. Anything unmapped falls through as-is rather than
   being swallowed — an unexplained failure the player can screenshot beats a
   friendly lie. */
const SAYS = {
  NOT_SIGNED_IN:       'Sign in to use the Mercenary Board.',
  BAD_TITLE:           'Give the contract a title.',
  BAD_MANIFEST:        'That manifest is not something the board can hold you to.',
  BAD_REWARD:          'That reward is out of range.',
  BAD_DEADLINE:        'Pick a deadline between 1 hour and 30 days.',
  TOO_MANY_CONTRACTS:  'You already have 10 contracts open. Close one first.',
  TOO_FAST:            'Slow down a moment, then try again.',
  CONTRACT_GONE:       'That contract is no longer on the board.',
  NOT_OPEN:            'Somebody was hired for that one already.',
  OWN_CONTRACT:        'You cannot take your own contract.',
  NOT_YOURS:           'That is not your contract.',
  CANNOT_HIRE_SELF:    'You cannot hire yourself.',
  NO_APPLICATION:      'That mercenary has not applied.',
  NOT_YOUR_JOB:        'You are not the mercenary on that contract.',
  NOT_HIRED:           'That contract has not been awarded to anyone yet.',
  NOTHING_TO_DELIVER:  'Nothing to hand over.',
  ALREADY_CLOSED:      'That contract is already closed.',
  DEADLINE_NOT_PASSED: 'You cannot cancel while your mercenary still has time on the clock.',
  NOT_OWED:            'There is nothing waiting for you on that contract.',
  BAD_PARTY:           'That is not a side of this contract.',
};

function say(err) {
  const raw = (err && (err.message || err.msg)) || String(err || '');
  const code = raw.replace(/^.*?([A-Z_]{4,})(:.*)?$/, '$1');
  if (SAYS[code]) return SAYS[code];
  if (/^ESCROW_FAILED/.test(raw)) return 'Not enough Cinder to put that reward in escrow.';
  if (/^OVER_DELIVERY/.test(raw))  return 'That is more than the contract asked for — send only what is on the manifest.';
  if (/^NOT_ON_MANIFEST/.test(raw)) return 'That item is not on this contract’s manifest.';
  return raw.slice(0, 140) || 'Something went wrong.';
}

async function rpc(name, args) {
  const c = client(); if (!c) return { ...OFFLINE, row: null };
  try {
    const r = await c.rpc(name, args || {});
    if (r.error) return { ...fail(r.error), why: say(r.error), row: null, rows: [] };
    const data = r.data;
    return { ok: true, row: Array.isArray(data) ? (data[0] || null) : (data || null),
             rows: Array.isArray(data) ? data : (data ? [data] : []) };
  } catch (e) { return { ...fail(e), why: say(e), row: null, rows: [] }; }
}

/* ── READS ───────────────────────────────────────────────────────────────── */

/** The open board. Deliberately NOT filtered to "not mine": seeing your own
    posting sitting on the board is how you know it went out. */
export async function listOpen(limit = 60) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('merc_contracts')
      .select('id,employer_id,employer_name,merc_id,merc_name,title,brief,manifest,reward,status,deadline_at,created_at,eb_post_id')
      .eq('status', 'open').order('created_at', { ascending: false }).limit(limit);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/** Everything this player is a party to, either side, any state. One query:
    the RLS policy already restricts it to their own rows, so an `or` filter
    here is a convenience and not the security boundary. */
export async function listMine() {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const uid = bridge().userId();
  if (!uid) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('merc_contracts')
      .select('id,employer_id,employer_name,merc_id,merc_name,title,brief,manifest,reward,status,deadline_at,hired_at,settled_at,cancelled_at,created_at,eb_post_id')
      .or(`employer_id.eq.${uid},merc_id.eq.${uid}`)
      .order('created_at', { ascending: false }).limit(120);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

export async function listApplications(contractId) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('merc_applications')
      .select('id,contract_id,merc_id,merc_name,pitch,status,created_at')
      .eq('contract_id', contractId).order('created_at', { ascending: true }).limit(100);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/** Every contract this player has applied to, so the board can say "applied"
    instead of offering the button a second time. */
export async function myApplications() {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const uid = bridge().userId();
  if (!uid) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('merc_applications')
      .select('contract_id,status,created_at').eq('merc_id', uid).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/** The hire roster. Reads the PUBLIC view, not merc_profiles: the view is
    where the jobs_done / cinder_earned aggregates come from, and those are
    computed by a SECURITY DEFINER function precisely so they are the same
    numbers a signed-out visitor sees on mythicspellbook.xyz. */
export async function listMercs(limit = 80) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('merc_public_standing')
      .select('user_id,handle,label,bio,rate_hint,tags,status,jobs_done,cinder_earned,badges,updated_at')
      .neq('status', 'retired')
      .order('jobs_done', { ascending: false }).limit(limit);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

export async function myMercProfile() {
  const c = client(); if (!c) return { ...OFFLINE, row: null };
  const uid = bridge().userId();
  if (!uid) return { ...OFFLINE, row: null };
  try {
    const r = await c.from('merc_profiles').select('*').eq('user_id', uid).maybeSingle();
    if (r.error) return { ...fail(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...fail(e), row: null }; }
}

export async function outstanding(contractId) {
  const r = await rpc('merc_outstanding', { p_contract: contractId });
  return { ...r, rows: r.rows || [] };
}

export async function claimable() {
  const r = await rpc('merc_claimable', {});
  return { ...r, rows: r.rows || [] };
}

/* ── WRITES ──────────────────────────────────────────────────────────────── */

/** Register (or update) this player as available for hire. */
export async function register({ label, bio, rate, tags, status }) {
  const b = bridge();
  return rpc('merc_register', {
    p_label: label || b.displayName(),
    p_bio: String(bio || '').slice(0, 600),
    p_rate: Math.max(0, Math.floor(Number(rate) || 0)),
    p_tags: Array.isArray(tags) ? tags.slice(0, 8) : [],
    p_status: status || 'open',
  });
}

/** Post a contract. The reward is charged server-side inside the same
    transaction that writes the row, so this either both happened or neither
    did — there is no "posted but unpaid" state to reconcile.

    ⚠ ADOPTING THE RETURNED BALANCE IS NOT OPTIONAL. The charge happened on the
      server; Profile.gems is now stale HIGH. index.html's chargeCinderAtomic
      adopts new_balance + wallet_seq + tax_amount after its own wallet_charge,
      and skipping the seq is a documented way to lose the spend on the next
      boot. adoptBalance() on the bridge is that same code path. */
export async function post({ title, brief, manifest, reward, deadlineHours }) {
  const b = bridge();
  const lines = M.normalise(manifest);
  const bad = M.validate(lines, reward);
  if (bad) return { ok: false, why: bad, row: null };

  const r = await rpc('merc_post_contract', {
    p_title: String(title || '').slice(0, 120),
    p_brief: String(brief || '').slice(0, 1200),
    p_manifest: lines,
    p_reward: Math.floor(Number(reward) || 0),
    p_deadline_hours: Math.max(1, Math.min(720, Math.floor(Number(deadlineHours) || 72))),
    p_employer_name: b.displayName(),
  });
  if (!r.ok) return r;

  const payload = r.row || {};
  try {
    b.adoptBalance(payload.new_balance, payload.wallet_seq, payload.tax_amount,
                   'Mercenary contract escrow');
  } catch (e) {}
  return { ok: true, row: payload.contract || null, balance: payload.new_balance };
}

export async function apply(contractId, pitch) {
  const b = bridge();
  return rpc('merc_apply', { p_contract: contractId, p_pitch: String(pitch || '').slice(0, 600), p_name: b.displayName() });
}

export async function withdraw(contractId) {
  return rpc('merc_withdraw_application', { p_contract: contractId });
}

export async function hire(contractId, mercId) {
  return rpc('merc_hire', { p_contract: contractId, p_merc: mercId });
}

/** Cancel and take the escrow back. The refund is credited server-side, so the
    returned balance is adopted for the same reason post() adopts one. */
export async function cancel(contractId) {
  const r = await rpc('merc_cancel_contract', { p_contract: contractId });
  if (!r.ok) return r;
  const payload = r.row || {};
  // No wallet_seq: wallet_credit does not move the debit counter, only
  // wallet_charge does. Passing null leaves Profile.walletSeqProgress alone,
  // which is correct — inventing a value here would desynchronise it.
  try { bridge().adoptBalance(payload.new_balance, null, 0, 'Mercenary escrow refunded'); } catch (e) {}
  return { ok: true, row: payload.contract || null, balance: payload.new_balance };
}

/** 📦 THE DELIVERY. Goods leave the stash FIRST (see the header note), and are
    put back leg by leg if the server refuses the drop.

    `io` is the bridge's mutator set; every one returns a boolean, which is
    what makes the unwind below correct rather than hopeful. */
export async function deliver(contractId, items, io) {
  const send = (items || []).map(M.cleanLine).filter(Boolean);
  if (!send.length) return { ok: false, why: 'Nothing to hand over.', row: null };

  // 1) Take the goods. Stop at the first leg that refuses and unwind what we
  //    already took — a half-emptied stash is the worst possible outcome here.
  const taken = [];
  for (const it of send) {
    const took = (it.kind === 'res') ? !!io.spendRes(it.id, it.qty)
                                     : !!io.takeOwned('card', it.id, it.qty);
    if (!took) {
      unwind(taken, io);
      try { io.save(); } catch (e) {}
      return { ok: false, why: `You no longer have ${it.qty} × ${it.name || it.id}.`, row: null };
    }
    taken.push(it);
  }
  try { io.save(); } catch (e) {}

  // 2) Write the drop. Anything short of success puts every leg back.
  const r = await rpc('merc_deliver', { p_contract: contractId, p_items: send });
  if (!r.ok) {
    unwind(taken, io);
    try { io.save(); } catch (e) {}
    return { ...r, rolledBack: true };
  }

  const row = r.row || {};
  return { ok: true, row, complete: !!row.complete, delivered: row.delivered | 0, status: row.status };
}

/* ↩️ The undo. refundRes, NOT addRes — addRes enforces the stash cap and
   returns without adding when the vault is full, which silently destroys an
   unwind. This is putting back units the player held milliseconds ago, so it
   must be uncapped. That distinction is spelled out on _refundRes in
   index.html and it is the whole reason both wrappers exist. */
function unwind(taken, io) {
  for (const it of taken) {
    try {
      if (it.kind === 'res') io.refundRes(it.id, it.qty);
      else io.giveOwned('card', it.id, it.qty);
    } catch (e) {}
  }
}

/** Collect. `party` is 'merc_cinder' | 'employer_goods' | 'merc_return'.

    🔴 CLAIM, THEN GRANT — and only after checking we can accept the whole lot.
    The claim INSERT is the lock: it succeeds exactly once, so if this client
    dies between the claim and the grant, those goods are gone. That is the
    same residual risk /src/trading carries on rl_claim, and it is why the
    caller checks `acceptable()` BEFORE claiming rather than discovering a
    clamped stash afterwards. */
export async function claim(contractId, party, io) {
  const r = await rpc('merc_claim', { p_contract: contractId, p_party: party });
  if (!r.ok) return r;
  const row = r.row;
  // No row = this party had already collected. That is the correct answer to a
  // double tap, and it must NEVER be retried or granted a second time.
  if (!row) return { ok: true, already: true, granted: [] };

  if (party === 'merc_cinder') {
    try { bridge().adoptBalance(row.new_balance, null, 0, 'Mercenary contract payout'); } catch (e) {}
    return { ok: true, reward: row.reward | 0, granted: [] };
  }

  let items = row.items;
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
  const granted = [];
  (Array.isArray(items) ? items : []).forEach((it) => {
    const line = M.cleanLine(it);
    if (!line) return;
    try {
      // addRes, not refundRes: this CREATES units for the player, so it
      // respects the stash cap. The cap was checked before we claimed.
      if (line.kind === 'res') io.addRes(line.id, line.qty);
      else io.giveOwned('card', line.id, line.qty);
      granted.push(line);
    } catch (e) {}
  });
  try { io.save(); } catch (e) {}
  return { ok: true, granted };
}

export { say };
