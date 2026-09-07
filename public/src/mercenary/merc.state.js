/* ═══════════════════════════════════════════════════════════════════════════
   merc.state.js — the store. One object, loaded by the render layer.

   Holds NOTHING the server owns. Contracts, applications and claims are read
   fresh; the only local state here is what the player is currently typing into
   the post form, which is deliberately kept across tab switches so a
   half-written contract survives a look at the roster.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as api from './merc.api.js';
import { bridge } from './merc.bridge.js';

export const Merc = {
  // remote
  open: [],            // the public board
  mine: [],            // every contract I am a party to
  mercs: [],           // the hire roster (merc_public_standing)
  myProfile: null,     // my merc_profiles row, or null if I never registered
  applied: new Map(),  // contract_id -> my application status
  apps: new Map(),     // contract_id -> applications, for contracts I posted
  outstanding: new Map(), // contract_id -> merc_outstanding() rows
  claims: [],          // merc_claimable()

  // status flags the UI renders instead of guessing
  loading: false,
  missing: false,      // sql/038 has not been applied on this project
  offline: false,      // signed out
  error: null,
  loadedAt: 0,

  // 📝 the post form, kept across tab switches on purpose
  draft: { title: '', brief: '', reward: 500, deadlineHours: 72, lines: [] },
};

function absorb(res) {
  if (!res) return res;
  if (res.missing) Merc.missing = true;
  if (res.offline) Merc.offline = true;
  if (res.error && !res.missing && !res.offline) Merc.error = res.error;
  return res;
}

/** One pass over everything the hub shows. Deliberately ONE function rather
    than per-tab loaders: the tabs share counts (the Collect badge, the
    applicant count on a contract card), and loading them separately is how a
    UI ends up showing "0 waiting" next to a full Collect tab. */
export async function loadAll() {
  Merc.loading = true;
  Merc.missing = false; Merc.offline = false; Merc.error = null;
  try {
    const b = bridge();
    if (!b.signedIn()) { Merc.offline = true; return Merc; }

    const [open, mine, mercs, prof, applied, claims] = await Promise.all([
      api.listOpen(), api.listMine(), api.listMercs(), api.myMercProfile(),
      api.myApplications(), api.claimable(),
    ]);
    [open, mine, mercs, prof, applied, claims].forEach(absorb);

    Merc.open = open.rows || [];
    Merc.mine = mine.rows || [];
    Merc.mercs = mercs.rows || [];
    Merc.myProfile = prof.row || null;
    Merc.claims = claims.rows || [];

    Merc.applied = new Map();
    (applied.rows || []).forEach((a) => { if (a) Merc.applied.set(a.contract_id, a.status); });

    // Applicants, but only for contracts I posted that are still open —
    // fetching them for every row would be a query per card for information
    // nobody can act on.
    const uid = b.userId();
    const needApps = Merc.mine.filter((c) => c && c.employer_id === uid && c.status === 'open');
    const appLists = await Promise.all(needApps.map((c) => api.listApplications(c.id)));
    Merc.apps = new Map();
    needApps.forEach((c, i) => { absorb(appLists[i]); Merc.apps.set(c.id, appLists[i].rows || []); });

    // Delivery progress, for the jobs actually in flight on either side.
    const live = Merc.mine.filter((c) => c && c.status === 'hired');
    const outs = await Promise.all(live.map((c) => api.outstanding(c.id)));
    Merc.outstanding = new Map();
    live.forEach((c, i) => { absorb(outs[i]); Merc.outstanding.set(c.id, outs[i].rows || []); });

    Merc.loadedAt = Date.now();
    return Merc;
  } catch (e) {
    Merc.error = (e && e.message) || 'load failed';
    return Merc;
  } finally {
    Merc.loading = false;
  }
}

/** Refresh one contract's progress without reloading the whole hub — what a
    delivery calls, so the checklist ticks over immediately. */
export async function refreshProgress(contractId) {
  const r = absorb(await api.outstanding(contractId));
  Merc.outstanding.set(contractId, r.rows || []);
  return r.rows || [];
}

export function contractById(id) {
  return Merc.mine.find((c) => c && c.id === id)
      || Merc.open.find((c) => c && c.id === id)
      || null;
}

export function myRole(c) {
  const uid = bridge().userId();
  if (!c || !uid) return null;
  if (c.employer_id === uid) return 'employer';
  if (c.merc_id === uid) return 'mercenary';
  return null;
}

/* Buckets the UI renders as sections. Kept here so "what counts as active"
   has exactly one definition. */
export function myPostings() {
  const uid = bridge().userId();
  return Merc.mine.filter((c) => c && c.employer_id === uid);
}
export function myJobs() {
  const uid = bridge().userId();
  return Merc.mine.filter((c) => c && c.merc_id === uid);
}
export function claimCount() { return (Merc.claims || []).length; }

export { api };
