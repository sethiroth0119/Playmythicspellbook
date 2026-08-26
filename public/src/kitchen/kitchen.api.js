/* ═══════════════════════════════════════════════════════════════════════════
   🛰 kitchen.api.js — EVERY Supabase call in Mythic Kitchen.
   ═══════════════════════════════════════════════════════════════════════════

   Nothing else in /src/kitchen touches the client. If a query lives anywhere
   else, that is the bug (CONTRACT §1).

   ⚠ EVERY CALL DEGRADES, AND THAT IS THE POINT. `sql/038_kitchen_convoys.sql`
   is applied BY HAND in the Supabase SQL editor, so there is a window — for
   some players a permanent one — where the tables simply do not exist. The
   kitchen has to be fully playable in that window: you cook, you serve the
   drive-thru, you run practice convoys to your own city, and the only thing you
   cannot do is ship to another player. So no function here ever throws at its
   caller. Each one returns empty data plus a flag:

       { ok:false, missing:true }   → sql/038 has not been run.  SETUP, not error.
       { ok:false, offline:true }   → signed out / no Cloud.      SETUP, not error.
       { ok:false, error:'…' }      → a real failure worth saying out loud.

   🔴 `missing` AND `offline` MUST NEVER REACH THE PLAYER AS AN ERROR TOAST.
   CONTRACT §9 rung 3 is explicit: the banner reads "Convoy network not set up
   yet", never "something went wrong". A setup state dressed as a failure sends
   players to support for a feature that is working exactly as designed.

   This is community.api.js's shape, deliberately verbatim — `MISSING_RE`,
   `client()`, `fail()`, `OFFLINE` — because two guarded API layers that guard
   DIFFERENTLY is how one of them ends up with a hole in it.

   🔴 THE GLOBALS TRAP (CLAUDE.md, three times paid for). `Cloud` is a top-level
   `const` in index.html. It is a LEXICAL global: it is not on `window`, and an
   ES module cannot see it. `window.Cloud` is `undefined`. The client arrives
   through `bridge().cloud` and NOWHERE ELSE.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as BRIDGE from './kitchen.bridge.js';

/* PostgREST codes that mean "the migration has not been run", as opposed to a
   real failure. Distinguishing them is the whole reason the UI can say
   something useful instead of something frightening.
     PGRST205 — table not found in the schema cache
     PGRST202 — function (RPC) not found                                      */
const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache/i;

const BRIDGE_FLOOR = {};
function bridge() {
  try {
    if (typeof BRIDGE.bridge === 'function') return BRIDGE.bridge() || BRIDGE_FLOOR;
    return BRIDGE.NULL_BRIDGE || BRIDGE_FLOOR;
  } catch (e) { return BRIDGE_FLOOR; }
}

/**
 * The Supabase client, or null.
 *
 * ⚠ `b.cloud` IS A PROPERTY, NOT A FUNCTION (CONTRACT §7). Calling it would
 * throw inside every single call site below, and because every call site is
 * wrapped in try/catch the whole feature would degrade to "offline" forever
 * with nothing in the console. That failure is silent and total, which is
 * exactly the kind this file exists to prevent.
 */
function client() {
  const b = bridge();
  try {
    if (!b || !b.cloud || !b.cloud.client) return null;
    if (!b.signedIn || !b.signedIn()) return null;
    return b.cloud.client;
  } catch (e) { return null; }
}

function fail(e) {
  const msg = (e && (e.message || e.msg)) || String(e || '');
  return { ok: false, missing: MISSING_RE.test(msg), error: msg };
}
const OFFLINE = { ok: false, missing: false, offline: true, error: 'not signed in' };

function uid() {
  const b = bridge();
  try { return (b.userId ? b.userId() : null) || null; } catch (e) { return null; }
}
function who() {
  const b = bridge();
  try { return String((b.displayName ? b.displayName() : '') || 'Survivor').slice(0, 40); } catch (e) { return 'Survivor'; }
}
const _int = (n) => { const v = Math.floor(Number(n)); return isFinite(v) ? v : 0; };

/* The columns every convoy read asks for. Written out rather than `select('*')`
   so that adding a column to the table in a later migration cannot change the
   shape of what the client already parses — and so a reader can see at a glance
   exactly what leaves the database. */
const CONVOY_COLS =
  'id,from_user,to_user,from_name,to_name,tier,items,dishes,launched_at,arrives_at,state,claimed_at';

/* ═══════════════════════════════════════════════════════════════════════════
   CONVOYS — reads
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Trucks addressed to ME that are still worth showing.
 *
 * ⚠ The `.eq('to_user', me)` filter is a PERFORMANCE filter, not a security
 * one. The security is `kc_sel` in sql/038 — RLS returns rows to the two
 * parties and nobody else, so removing this line would change nothing about
 * what a client can see. Never rely on it the other way round.
 */
export async function listInbound(limit = 40) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const me = uid(); if (!me) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('kitchen_convoys')
      .select(CONVOY_COLS)
      .eq('to_user', me)
      .neq('state', 'claimed')
      .order('arrives_at', { ascending: true })
      .limit(Math.max(1, Math.min(100, _int(limit) || 40)));
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/** Trucks I sent. Claimed ones are INCLUDED — convoy.js reconciles against this
    list to retire the ghost row a sender would otherwise keep forever. */
export async function listOutbound(limit = 40) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const me = uid(); if (!me) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('kitchen_convoys')
      .select(CONVOY_COLS)
      .eq('from_user', me)
      .order('launched_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, _int(limit) || 40)));
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONVOYS — writes
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Post a launched convoy.
 *
 * 🔴 `from_user` IS PINNED TO `auth.uid()` HERE AND AGAIN IN RLS. The policy
 * `kc_ins` is `with check (from_user = auth.uid())`, so a tampered client that
 * posts somebody else's id gets a policy violation rather than the ability to
 * ship *from* another player's kitchen. This line is the convenience; the
 * policy is the security. Both, always.
 *
 * ⚠ `dishes` IS SENDER-SUPPLIED and therefore is NOT trusted as an economy
 * fact by anybody. The recipient's payout is `dishes × ECON.CONVOY_FOOD_PER_DISH`
 * where that constant is tuned below the food embodied in one dish, sql/038
 * caps `dishes` with a CHECK constraint, and `kitchen_convoy_quota_ok()` rate
 * limits how many convoys one account can post. Three walls, because a client
 * number that turns into a live resource has to have more than one.
 */
export async function insertConvoy(payload) {
  const c = client(); if (!c) return { ...OFFLINE, row: null };
  const me = uid(); if (!me) return { ...OFFLINE, row: null };
  const p = payload || {};
  if (!p.to_user) return { ok: false, error: 'no recipient', row: null };
  try {
    const r = await c.from('kitchen_convoys').insert({
      from_user: me,
      to_user: p.to_user,
      from_name: String(p.from_name || who()).slice(0, 40),
      to_name: String(p.to_name || '').slice(0, 40) || null,
      tier: String(p.tier || 'van').slice(0, 24),
      items: (p.items && typeof p.items === 'object') ? p.items : {},
      dishes: Math.max(1, _int(p.dishes)),
      arrives_at: p.arrives_at,
    }).select(CONVOY_COLS).maybeSingle();
    if (r.error) return { ...fail(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...fail(e), row: null }; }
}

/**
 * Unload a convoy addressed to me.
 *
 * 🔴 THE PAYOUT IS MARKED SERVER-SIDE FIRST AND THE STASH IS CREDITED ON WHAT
 * THIS RETURNS — never before it. Same rule, same words, as
 * community.api.js's `claimRewards`, and it exists because a double-click paid
 * twice. `kitchen_convoy_claim()` is SECURITY DEFINER, derives the actor from
 * `auth.uid()`, and appends its ledger row under a unique index on
 * (convoy_id, kind) — so a REPLAYED request returns the same row and writes
 * nothing, rather than paying a second time.
 *
 * ⚠ It deliberately does NOT raise on an already-claimed convoy. A client that
 * lost the response to its first call has to be able to ask again, or a stash
 * that filled up mid-unload would strand the remainder with no way to collect
 * it. Idempotency lives in the unique index, not in an exception.
 */
export async function claimConvoy(convoyId) {
  const c = client(); if (!c) return { ...OFFLINE, row: null };
  if (!convoyId) return { ok: false, error: 'no convoy', row: null };
  try {
    const r = await c.rpc('kitchen_convoy_claim', { p_id: convoyId });
    if (r.error) return { ...fail(r.error), row: null };
    // The RPC returns the row itself; PostgREST hands back either the object or
    // a one-row array depending on how it resolves the return type.
    const row = Array.isArray(r.data) ? (r.data[0] || null) : (r.data || null);
    return { ok: true, row };
  } catch (e) { return { ...fail(e), row: null }; }
}

/**
 * The append-only movement log for one convoy. READ-ONLY BY CONSTRUCTION: there
 * is no insert/update/delete counterpart in this file and there is no policy
 * for one in sql/038, so adding one here would not work anyway. Balance is
 * `sum(amount)` — there is no balance column and there never will be
 * (CLAUDE.md, `corp_treasury`).
 */
export async function listConvoyLedger(convoyId, limit = 20) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  if (!convoyId) return { ok: true, rows: [] };
  try {
    const r = await c.from('kitchen_convoy_ledger')
      .select('id,convoy_id,kind,from_user,to_user,resource,amount,dishes,note,created_at')
      .eq('convoy_id', convoyId)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, _int(limit) || 20)));
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATS — cosmetic, and cosmetic is load-bearing here
   ═══════════════════════════════════════════════════════════════════════════
   🔴 `kitchen_stats` IS NEVER AN ECONOMY SOURCE. Every number in it is written
   by the player's own client, so it is a scoreboard and nothing else. Nothing
   may read it back and grant anything. It exists so the kitchen has a wall to
   put a name on; it is not a ledger and it is not evidence.
   ═══════════════════════════════════════════════════════════════════════════ */

export async function upsertStats(stats) {
  const c = client(); if (!c) return OFFLINE;
  const me = uid(); if (!me) return OFFLINE;
  const s = stats || {};
  try {
    const r = await c.from('kitchen_stats').upsert({
      user_id: me,
      name: who(),
      level: Math.max(1, _int(s.level) || 1),
      served: Math.max(0, _int(s.served)),
      days: Math.max(0, _int(s.days)),
      popularity: Math.max(0, Math.min(100, _int(s.popularity))),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (r.error) return fail(r.error);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function listLeaderboard(limit = 25) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('kitchen_stats')
      .select('user_id,name,level,served,days,popularity,updated_at')
      .order('served', { ascending: false })
      .limit(Math.max(1, Math.min(100, _int(limit) || 25)));
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RECIPIENT PICKER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Find someone to ship to, by display name.
 *
 * ⚠ READS `user_profiles`, WHICH THIS FEATURE DOES NOT OWN. index.html already
 * runs exactly this query (`select user_id, display_name ... ilike`) for the
 * friend search, so the table, its RLS and its read grant already exist and are
 * already exposed to every signed-in player. sql/038 therefore does NOT touch
 * `user_profiles` — adding a policy to a table another system owns is how you
 * silently widen someone else's security boundary while reviewing your own.
 *
 * The self-exclusion is a UX filter (a practice run is the `null` recipient,
 * not a search result), never a security one.
 */
export async function findPlayer(nameFragment, limit = 12) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const me = uid();
  const q = String(nameFragment || '').trim().slice(0, 40);
  // Two characters minimum: a one-letter `ilike '%a%'` is a full table scan
  // that returns a random slice of the entire playerbase, which is neither
  // useful to the player nor kind to the database.
  if (q.length < 2) return { ok: true, rows: [] };
  try {
    let sel = c.from('user_profiles')
      .select('user_id,display_name')
      .ilike('display_name', '%' + q.replace(/[%_,]/g, ' ') + '%')
      .limit(Math.max(1, Math.min(50, _int(limit) || 12)));
    if (me) sel = sel.neq('user_id', me);
    const r = await sel;
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: (r.data || []).filter((x) => x && x.user_id) };
  } catch (e) { return { ...fail(e), rows: [] }; }
}
