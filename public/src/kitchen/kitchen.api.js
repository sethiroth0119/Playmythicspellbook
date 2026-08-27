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

   ── 🔴 ROUND 2: THREE WRITES BECAME RPCs, AND WHY ───────────────────────────
   `insertConvoy`, `claimConvoy` and `upsertStats` all go through SECURITY
   DEFINER functions now, and the matching table grants are revoked in sql/038.
   The reason is the same in all three cases: **a value the server has to own
   was being supplied by the client.**

     · LAUNCH  — round 1 posted `arrives_at` computed on the DEVICE clock, and
                 the only server-side check was `arrives_at > now()`. A tampered
                 client landed a truck in one millisecond (transit time is the
                 one thing stopping a convoy being a vending machine), and a
                 player whose clock ran slow could never ship at all. We now
                 post a DURATION and the server computes the arrival.
     · CLAIM   — round 1 got back only the convoy row, with no way to tell a
                 first claim from a replay, so two tabs claiming one 40-box
                 truck credited 80 food. The RPC now returns `first_claim` and
                 `delivered_dishes`, and convoy.js pays on `delivered_dishes`
                 and nothing else.
     · STATS   — an upsert needs UPDATE on the row, and giving the client UPDATE
                 on a table it does not own is a bigger door than a leaderboard
                 is worth. The RPC pins `user_id = auth.uid()`.
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

/**
 * ⚠ IT READS `code`, `details` AND `hint`, NOT JUST `message`. community.api.js
 * matches on the message alone and gets away with it because PostgREST's
 * table-missing message happens to contain the words "schema cache". An RPC
 * that does not exist does NOT always say that — the message can be a bare
 * "Could not find the function public.kitchen_convoy_launch(…)" with PGRST202
 * only in `code`. Matching the message alone turned a SETUP state into a REAL
 * ERROR, which is the one thing the header of this file says must never happen:
 * the player got "something went wrong" instead of "the convoy network is not
 * set up yet", and the launch path reported the wrong reason for turning back.
 */
function fail(e) {
  const msg = (e && (e.message || e.msg)) || String(e || '');
  const probe = [msg, e && e.code, e && e.details, e && e.hint]
    .filter((x) => x != null).join(' ');
  return { ok: false, missing: MISSING_RE.test(probe), error: msg };
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

/* PostgREST hands an RPC result back as either the object or a one-row array,
   depending on how it resolves the return type. Every RPC below goes through
   this so that difference cannot become a bug in one call site and not another. */
function firstRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

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
 *
 * ⚠ `.neq('state','claimed')` IS WHY THE DEPOT HOLD EXISTS. A claimed convoy
 * never comes back down this pipe, so anything the client still needs to
 * remember about it — a remainder that would not fit in the stash — has to be
 * held locally in `K.convoys`, not left in `K.inbound` waiting for a refresh
 * that will delete it. See convoy.js §4.
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
    list to retire the ghost row a sender would otherwise keep forever, and
    builds the recipient picker's "shipped before" shortlist from it. */
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
 * Launch a convoy. Name kept from CONTRACT §1; it is an RPC now, not an insert.
 *
 * 🔴 THE CLIENT POSTS A DURATION, NEVER A TIMESTAMP. `kitchen_convoy_launch()`
 * computes `arrives_at = now() + clamp(p_transit_ms)` on the SERVER clock and
 * there is no INSERT policy or INSERT grant on `kitchen_convoys` any more, so
 * this is the only way a row gets written. Round 1 sent
 * `arrives_at: new Date(localArrival).toISOString()` and the server checked
 * only `arrives_at > now()`, which meant:
 *   · a tampered client could post `now() + 1ms` and skip transit entirely;
 *   · a device clock 40 minutes slow FAILED the check on every single launch,
 *     and the player's truck was silently renamed "(local run)" with no reason
 *     given. Both of those are gone with the timestamp.
 *
 * 🔴 `from_user` is derived from `auth.uid()` INSIDE the function. There is no
 * parameter for it and there must never be one: a caller-supplied sender id is
 * the ability to ship *from* another player's kitchen.
 *
 * ⚠ `dishes` IS SENDER-SUPPLIED and therefore is NOT trusted as an economy fact
 * by anybody. The recipient's payout is `delivered_dishes ×
 * ECON.CONVOY_FOOD_PER_DISH` where that constant is tuned below the food
 * embodied in one dish, the RPC clamps `dishes` to 1..500, and
 * `kitchen_convoy_quota_ok()` rate limits how many convoys one account can
 * post. Three walls, because a client number that turns into a live resource
 * has to have more than one.
 *
 * → { ok, row }  `row` has the SERVER's `launched_at`/`arrives_at`; convoy.js
 *                adopts them and corrects for device clock skew.
 */
export async function insertConvoy(payload) {
  const c = client(); if (!c) return { ...OFFLINE, row: null };
  const me = uid(); if (!me) return { ...OFFLINE, row: null };
  const p = payload || {};
  if (!p.to_user) return { ok: false, error: 'no recipient', row: null };
  if (p.to_user === me) return { ok: false, error: 'cannot ship to yourself', row: null };
  try {
    const r = await c.rpc('kitchen_convoy_launch', {
      p_to: p.to_user,
      p_to_name: String(p.to_name || '').slice(0, 40) || null,
      p_from_name: String(p.from_name || who()).slice(0, 40),
      p_tier: String(p.tier || 'van').slice(0, 24),
      p_items: (p.items && typeof p.items === 'object') ? p.items : {},
      p_dishes: Math.max(1, _int(p.dishes)),
      p_transit_ms: Math.max(0, _int(p.transit_ms)),
    });
    if (r.error) return { ...fail(r.error), row: null };
    const row = firstRow(r.data);
    if (!row || !row.id) return { ok: false, error: 'no row returned', row: null };
    return { ok: true, row };
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
 * (convoy_id, kind).
 *
 * 🔴 IT RETURNS TWO FACTS AND THE SECOND ONE IS THE WHOLE FIX:
 *     `firstClaim`      — was THIS call the one that delivered the convoy?
 *     `deliveredDishes` — how many boxes THIS call delivered. **0 on a replay.**
 *   Round 1 returned only the convoy row, which looks identical on a first
 *   claim and on a replay, so convoy.js credited the stash both times: two tabs
 *   on one 40-box truck produced 80 food out of nothing. Callers must pay on
 *   `deliveredDishes` and on nothing else.
 *
 * ⚠ It still deliberately does NOT raise on an already-claimed convoy. A client
 * that lost the response to its first call has to be able to ask again — and
 * now it gets a truthful "you already have it" instead of a second payout.
 * Idempotency lives in the unique index; the ANSWER lives in `first_claim`.
 *
 * ⚠ An older sql/038 (before this migration was re-run) returns a bare convoy
 * row with no `first_claim` column. `firstClaim` is then `undefined` — NOT
 * `false` — and convoy.js treats `undefined` as "cannot tell" and falls back to
 * the row's own `dishes`. That is round 1's behaviour, on round 1's schema,
 * which is the only honest thing to do with a server that cannot answer the
 * question. Re-run sql/038 to close it.
 */
export async function claimConvoy(convoyId) {
  const c = client(); if (!c) return { ...OFFLINE, row: null };
  if (!convoyId) return { ok: false, error: 'no convoy', row: null };
  try {
    const r = await c.rpc('kitchen_convoy_claim', { p_id: convoyId });
    if (r.error) return { ...fail(r.error), row: null };
    const row = firstRow(r.data);
    if (!row) return { ok: false, error: 'no row returned', row: null };
    const known = Object.prototype.hasOwnProperty.call(row, 'first_claim');
    return {
      ok: true,
      row,
      firstClaim: known ? !!row.first_claim : undefined,
      deliveredDishes: Object.prototype.hasOwnProperty.call(row, 'delivered_dishes')
        ? Math.max(0, _int(row.delivered_dishes))
        : Math.max(0, _int(row.dishes)),      // pre-migration server; see the note
    };
  } catch (e) { return { ...fail(e), row: null }; }
}

/**
 * The append-only movement log for one convoy. READ-ONLY BY CONSTRUCTION: there
 * is no insert/update/delete counterpart in this file and there is no policy
 * for one in sql/038, so adding one here would not work anyway. Balance is
 * `sum(amount)` — there is no balance column and there never will be
 * (CLAUDE.md, `corp_treasury`). A launch row is `-dishes`, a claim row is
 * `+dishes`, so a delivered convoy sums to zero.
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

/**
 * Write my own scoreboard row.
 *
 * 🔴 AN RPC, NOT AN UPSERT. PostgREST's upsert compiles to
 * `insert … on conflict (user_id) do update set user_id = excluded.user_id, …`,
 * which needs an UPDATE grant on `user_id` — i.e. the ability to move a row to
 * another player's id. That is impersonation on a public board, and it is the
 * only real risk this table has. `kitchen_stats_upsert()` pins the id to
 * `auth.uid()`, so sql/038 can revoke every client write grant on the table.
 */
export async function upsertStats(stats) {
  const c = client(); if (!c) return OFFLINE;
  const me = uid(); if (!me) return OFFLINE;
  const s = stats || {};
  try {
    const r = await c.rpc('kitchen_stats_upsert', {
      p_name: who(),
      p_level: Math.max(1, _int(s.level) || 1),
      p_served: Math.max(0, _int(s.served)),
      p_days: Math.max(0, _int(s.days)),
      p_pop: Math.max(0, Math.min(100, _int(s.popularity))),
    });
    if (r.error) return fail(r.error);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * The board.
 *
 * 🔴 `user_id` IS DELIBERATELY NOT SELECTED, and sql/038 revokes the column
 * grant so asking for it fails rather than quietly working again later. The
 * policy has to be `using (true)` — a leaderboard nobody can read is not a
 * leaderboard — and combined with `select('user_id,…')` that was a paginated
 * dump of `auth.users` UUIDs to every signed-in player. The board never used
 * the id for anything: it was selected and discarded. Rows are keyed on
 * `name` + index by the renderer.
 *
 * ⚠ If a "this is me" highlight is ever wanted, do it SERVER-side with a view
 * that exposes `user_id = auth.uid() as is_me`. Do not re-add the raw id.
 */
export async function listLeaderboard(limit = 25) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('kitchen_stats')
      .select('name,level,served,days,popularity,updated_at')
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
 * runs exactly this query (`select user_id, display_name … ilike`) for the
 * friend search, so the table, its RLS and its read grant already exist and are
 * already exposed to every signed-in player. sql/038 therefore does NOT touch
 * `user_profiles` — adding a policy to a table another system owns is how you
 * silently widen someone else's security boundary while reviewing your own.
 *
 * 🔴 THIS IS NOT A "SEARCH THE PLAYERBASE" ENDPOINT. Two characters minimum, a
 * hard `limit`, and the wildcards are stripped out of the fragment before it
 * reaches `ilike`: a one-letter `'%a%'` is a full table scan that returns a
 * random slice of everybody, which is neither useful to the player nor kind to
 * the database, and `%`/`_` from the player would let them write the pattern.
 *
 * The self-exclusion is a UX filter (a practice run is the `null` recipient,
 * not a search result), never a security one.
 */
export async function findPlayer(nameFragment, limit = 12) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const me = uid();
  const q = String(nameFragment || '').trim().slice(0, 40);
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
