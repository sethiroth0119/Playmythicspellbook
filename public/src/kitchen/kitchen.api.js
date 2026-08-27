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

   ── 🔴 ROUND 2: THE WRITES BECAME RPCs, AND WHY ─────────────────────────────
   `insertConvoy` and `claimConvoy` go through SECURITY DEFINER functions now,
   and the matching table grants are revoked in sql/038. The reason is the same
   in both cases: **a value the server has to own was being supplied by the
   client.** (`upsertStats` was the third, and round 6 deleted it with the table
   it wrote to — see the STATS tombstone below.)

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
     · STATS   — (removed round 6.) An upsert needs UPDATE on the row, and
                 giving the client UPDATE on a table it does not own is a bigger
                 door than a leaderboard is worth. That trap is recorded in the
                 tombstone below in case the board is ever rebuilt.

   ── 🔴 ROUND 3: THE CLIENT STOPPED SETTING THE PRICE ────────────────────────
   Round 2 moved the CLOCK to the server and left the SIZE with the client. The
   launch RPC took the box count and the transit time as arguments and clamped
   them globally — 1..500 boxes, 10 minutes..12 hours — with the tier sitting
   unused in `p_tier`. Ten trucks of 500 boxes, launched in one burst with zero
   cooking, all landing in ten minutes: 10,000 units of live `food` an hour into
   a colluding account, carrying an append-only ledger row that made the balance
   look audited. sql/038 now looks the tier up in a server-side table and clamps
   to it, and rate-limits BOXES (not just trucks) against what a kitchen could
   physically have cooked.

   What that means for THIS file, and it is the only thing it means:
     · `dishes` and `transit_ms` are REQUESTS, not facts. Read what actually
       happened off the returned row.
     · a refusal now has a REASON — `code` on every failure result. See
       `serverCode()` for why a player-facing sentence is not one.
     · convoys carry `delay_ms` / `delay_leg`: the hold-up the server rolled on
       the road, already inside `arrives_at`. See `CONVOY_COLS`.

   ── 🔴 ROUND 4 SHIPPED A GHOST. ROUND 5 IS ABOUT LOST REPLIES. ──────────────
   Rounds 2 and 3 gave the server the clock and the size. What nobody owned was
   the answer to **"did my write land?"**, and the launch path could not tell
   "the depot never heard me" from "the depot heard me, committed the row, and
   the reply died on the way back". It treated both as a refusal, turned the
   truck back into a local practice run, and paid the SENDER for it — while the
   committed row was still on the road to the recipient. 40 dishes left the pass
   once and 80 units of live `food` came out. Proven against a depot that
   commits and then rejects the promise; reachable with no attacker at all by a
   dropped mobile connection, a suspended tab or a TLS reset.

   THREE THINGS IN THIS FILE CLOSE IT, and none of them is a heuristic:
     · `ambiguousErr()` — DEFINITE (the server answered with a code) vs
       AMBIGUOUS (nobody knows). Every failure result carries `ambiguous`.
     · `insertConvoy()` sends `p_client_ref`, so a retry is free of consequence:
       the RPC returns the row it already wrote instead of writing another.
     · `findConvoysByRef()` — the reconcile. It is what lets convoy.js hold a
       launch in `'pending'`, pay out nothing, and settle it on a fact.

   ── 🔴 ROUND 6: THE DEAD SECURED SURFACE CAME OUT. ─────────────────────────
   `upsertStats()` and `listLeaderboard()` are deleted, with `kitchen_stats` and
   everything guarding it in sql/038. Four rounds of "each other is my only
   caller" is a decision, not a backlog item. The reasoning and the two traps to
   re-read before rebuilding are in the STATS block below and in convoy.js §10.
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
  return { ok: false, missing: MISSING_RE.test(probe), error: msg, code: serverCode(probe),
           // 🔴 "DID THE SERVER GET IT?" — see ambiguousErr() below. Present on
           //    every failure so a WRITE caller never has to guess, and harmless
           //    on a read, where a retry costs nothing either way.
           ambiguous: ambiguousErr(e) };
}
/* ⚠ `ambiguous:false` — nothing was SENT. A signed-out client refuses before it
   opens a socket, so there is no committed row to reconcile against. */
const OFFLINE = { ok: false, missing: false, offline: true, error: 'not signed in', ambiguous: false };

/* The RPCs in sql/038 signal refusals with `raise exception 'LAUNCH_QUOTA'` and
   friends. PostgREST hands those back as a P0001 whose `message` is the bare
   token, so a caller can tell them apart WITHOUT string-matching a player-facing
   sentence — which is the trap: the moment someone rewords a toast, a
   `/quota/i.test(msg)` branch stops firing and the player is told the wrong
   thing with no test failing anywhere.

   🔴 WHY THIS EXISTS AT ALL, and it is finding #2 from the round-2 review. The
   launch path had exactly one failure sentence — "the depot could not reach
   them, the truck turned back" — for every possible refusal. When the in-flight
   quota locked a sender out (permanently, on round-2's server), the fee was
   charged, the dishes left the pass, the network was blamed, and every future
   attempt did the same thing. The player could not act on any of it because the
   message was about a problem they did not have. A refusal the player can FIX
   has to be distinguishable from one they cannot.

   ⚠ The list is a CLOSED SET matched whole. A substring match would let a
   Postgres message that merely CONTAINS one of these words be misread as a
   refusal code. */
const SERVER_CODES = [
  'NOT_SIGNED_IN', 'NO_RECIPIENT', 'NO_SELF_SHIP', 'NO_SUCH_PLAYER',
  'LAUNCH_QUOTA', 'NO_TIER_TABLE', 'BAD_CONVOY', 'CONVOY_GONE',
  'NOT_YOURS', 'STILL_IN_TRANSIT',
];
function serverCode(probe) {
  const s2 = String(probe || '');
  for (const k of SERVER_CODES) {
    // Word-boundary match: the token appears as its own word, not inside one.
    if (new RegExp('(^|[^A-Z_])' + k + '([^A-Z_]|$)').test(s2)) return k;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   🔴 DID THE SERVER GET IT? THE ONE QUESTION A FAILED WRITE HAS TO ANSWER.
   ═══════════════════════════════════════════════════════════════════════════
   ROUND 5, FINDING #1 — THE GHOST CONVOY. A launch whose reply was lost AFTER
   the row committed was indistinguishable, to convoy.js, from a launch the
   server never received. It turned the truck back into a local practice run and
   paid the SENDER for it while the committed row was still on the road to the
   recipient: 40 dishes left the pass once, 80 units of live `food` came out.
   That is the food printer the whole feature is built around preventing, opened
   by a dropped mobile connection rather than by an attacker.

   The fix has two halves and this is the first: **stop collapsing two different
   failures into one.**

     DEFINITE  — the depot ANSWERED and said no. PostgREST handed back an error
                 object carrying a `code`: a SQLSTATE (`P0001` for every token
                 in SERVER_CODES, `42P01`, `23505`, `XX000`) or a PGRST code
                 (`PGRST202` = the function is not there). Every one of those
                 means the statement raised and the transaction rolled back, so
                 NOTHING WAS WRITTEN. Safe to turn the truck back.
     AMBIGUOUS — nobody knows. `fetch` rejected, the tab was suspended, a
                 gateway returned a 5xx with no PostgREST body, the RPC came
                 back 200 with no row. The insert may well have committed.
                 🔴 THE ONLY SAFE ACT HERE IS TO PAY NOTHING AND ASK AGAIN —
                 which is what `p_client_ref` + `findConvoysByRef()` make
                 possible, and what convoy.js's `'pending'` state is for.

   ⚠ IT ERRS TOWARDS AMBIGUOUS, ON PURPOSE. A DEFINITE misread pays the sender
     for a truck that exists — the ghost. An AMBIGUOUS misread costs one extra
     round trip on the next heartbeat and nothing else. The asymmetry is total,
     so anything without a recognisable code is ambiguous.
   ⚠ `missing` and `offline` never come through here: `missing` is PGRST202/205
     (definite — the function does not exist) and `offline` is a client-side
     refusal before any request is made (definite — nothing was sent). Both are
     handled by name in convoy.js, ahead of this.
   ═══════════════════════════════════════════════════════════════════════════ */
const DEFINITE_CODE_RE = /^(PGRST\d{3,}|[0-9A-Za-z]{5})$/;
function ambiguousErr(e) {
  try {
    const code = e && e.code;
    if (typeof code === 'string' && DEFINITE_CODE_RE.test(code)) return false;
    return true;
  } catch (e2) { return true; }
}

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
  'id,from_user,to_user,from_name,to_name,tier,items,dishes,launched_at,arrives_at,state,claimed_at,'
  + 'delay_ms,delay_leg';

/* 🔴 THE OUTBOUND READ CARRIES THE IDEMPOTENCY KEY AND THE INBOUND ONE DOES
   NOT. `client_ref` is how a SENDER settles a launch whose reply was lost — it
   is the only column that can answer "is my truck up there?" — and it is of no
   use whatsoever to a recipient. Selecting it on the inbound pipe would hand
   every recipient a key that only the sender's retry path can use, for nothing.
   Two constants, and the narrower one is the one aimed at other people's rows. */
const OUTBOUND_COLS = CONVOY_COLS + ',client_ref';

/* ⚠ `delay_ms` / `delay_leg` ARE ALREADY INSIDE `arrives_at`. They are not a
   second number to add on: the launch RPC rolls the hold-up, adds it to the
   transit it was going to charge, and stores both the total arrival and what it
   rolled. The client reads them ONLY to draw the story — which leg the truck
   was stopped on and for how long. Treating `delay_ms` as an additional wait
   would double it and make the countdown disagree with the claim RPC, which is
   the one clock that matters.

   ⚠ A SERVER ONE MIGRATION BEHIND HAS NEITHER COLUMN, and PostgREST fails a
   `select` naming a column that does not exist — it does NOT quietly omit it.
   The error carries "does not exist", which `MISSING_RE` already reads as
   `missing:true`, so an un-migrated project degrades to "the convoy network is
   not set up yet" rather than to a hard error. That is the correct rung: re-run
   sql/038. */

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
      .select(OUTBOUND_COLS)
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
 * ⚠ THE SERVER MAY SHRINK THE LOAD OR LENGTHEN THE ROAD, AND THAT IS NOT AN
 * ERROR. sql/038 clamps `dishes` DOWN to the tier's real capacity and
 * `transit_ms` UP to the tier's real transit — the two safe directions — so a
 * client one deploy out of step under-ships instead of failing. Read the numbers
 * back off `row`, never off what was posted.
 *
 * → { ok, row }        `row` has the SERVER's `launched_at`/`arrives_at`/
 *                      `delay_ms`/`delay_leg`; convoy.js adopts them and
 *                      corrects for device clock skew.
 * → { ok:false, quota:true }   the sender has too many trucks out, or has
 *                      shipped more this hour than a kitchen could cook. A
 *                      refusal the player can act on — see `serverCode`.
 * → { ok:false, badPlayer:true } that recipient does not exist any more.
 */
export async function insertConvoy(payload) {
  const c = client(); if (!c) return { ...OFFLINE, row: null };
  const me = uid(); if (!me) return { ...OFFLINE, row: null };
  const p = payload || {};
  // ⚠ `ambiguous:false` on both: these refuse BEFORE a request leaves the
  //   device, so there is definitively no row on the server to reconcile.
  if (!p.to_user) return { ok: false, error: 'no recipient', row: null, ambiguous: false };
  if (p.to_user === me) return { ok: false, error: 'cannot ship to yourself', row: null, ambiguous: false };
  try {
    const r = await c.rpc('kitchen_convoy_launch', {
      p_to: p.to_user,
      p_to_name: String(p.to_name || '').slice(0, 40) || null,
      p_from_name: String(p.from_name || who()).slice(0, 40),
      p_tier: String(p.tier || 'van').slice(0, 24),
      p_items: (p.items && typeof p.items === 'object') ? p.items : {},
      p_dishes: Math.max(1, _int(p.dishes)),
      p_transit_ms: Math.max(0, _int(p.transit_ms)),
      /* 🔴 THE IDEMPOTENCY KEY. A uuid the CALLER generates once per launch and
         re-sends on every retry of that same launch. sql/038's
         kitchen_convoy_launch() looks it up under the sender's advisory lock and
         returns the row it already wrote, so a retry cannot put a second truck
         on the road, cannot write a second ledger row, and cannot spend a second
         slot of the quota.
         🔴 IT IS WHAT MAKES A LOST REPLY ANSWERABLE, which is the whole of the
            ghost-convoy fix: without it, "did my insert land?" has no answer and
            round 4 answered it by minting a second copy of the load. */
      p_client_ref: p.client_ref || null,
    });
    if (r.error) {
      const f = fail(r.error);
      // 🔴 A QUOTA REFUSAL IS NOT A NETWORK FAILURE and must not be reported as
      //    one. Round 2 collapsed both into "the depot could not reach them",
      //    which told a locked-out sender to blame their connection forever.
      return { ...f, row: null,
        quota: f.code === 'LAUNCH_QUOTA',
        badPlayer: f.code === 'NO_SUCH_PLAYER' };
    }
    const row = firstRow(r.data);
    /* ⚠ 200 WITH NO ROW IS AMBIGUOUS, NOT A REFUSAL. The RPC `returns
       public.kitchen_convoys`, so an empty body means something between us and
       Postgres ate the result — a proxy, a truncated response — and the insert
       may perfectly well have committed. Round 4 read this as "it did not
       happen" and paid the sender. It is a reconcile now, like every other
       unanswered question. */
    if (!row || !row.id) return { ok: false, error: 'no row returned', row: null, ambiguous: true };
    return { ok: true, row };
  } catch (e) { return { ...fail(e), row: null }; }
}

/**
 * 🔴 THE RECONCILE. "Is my truck up there?" — the question round 4 could not ask.
 *
 * Given the client refs of launches whose reply was lost, return the server rows
 * that actually exist. convoy.js holds those launches in `state:'pending'`,
 * pays out NOTHING for them, and settles each one on the answer:
 *   · a row came back  → adopt its id and its clock; the truck is real and on
 *                        the road to the person it was addressed to;
 *   · `ok` and no row  → the insert never landed. NOW it is safe to turn the
 *                        truck back into a local run, because the depot has
 *                        answered the question.
 *   · `ok:false`       → still nobody knows. Stay pending. Never pay.
 *
 * ⚠ KEYED ON `client_ref`, NOT ON A PAGE OF `listOutbound()`. The obvious
 *   implementation is "look for it in the outbound list", and it is wrong in a
 *   way that only bites the busiest senders: `listOutbound()` is `limit(40)`
 *   ordered by `launched_at desc`, so a pending truck can simply fall off the
 *   page — and "not on this page" would then be read as "never existed" and the
 *   sender would be paid for a truck that is on the road. An `.in()` on the
 *   unique-indexed column cannot be wrong about absence.
 * ⚠ `.eq('from_user', me)` is a PERFORMANCE filter, not a security one: RLS
 *   (`kc_sel`) is what stops a client reading somebody else's convoys, and refs
 *   are only unique per sender, so this is also what makes the answer *mine*.
 */
export async function findConvoysByRef(refs) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const me = uid(); if (!me) return { ...OFFLINE, rows: [] };
  const list = (Array.isArray(refs) ? refs : [])
    .filter((x) => typeof x === 'string' && x.length >= 8 && x.length <= 64)
    .slice(0, 40);
  if (!list.length) return { ok: true, rows: [] };
  try {
    const r = await c.from('kitchen_convoys')
      .select(OUTBOUND_COLS)
      .eq('from_user', me)
      .in('client_ref', list)
      .limit(list.length);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
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
      // The road, so an arrival can say what the trip actually was even when the
      // recipient never had the row on screen while it was moving. Absent on a
      // pre-road server → 0, which convoy.js reads as "a clean run".
      delayMs: Math.max(0, _int(row.delay_ms)),
      delayLeg: Math.max(0, _int(row.delay_leg)),
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
   STATS — REMOVED IN ROUND 6, WITH THE TABLE THEY TALKED TO
   ═══════════════════════════════════════════════════════════════════════════
   `upsertStats()` and `listLeaderboard()` lived here and are gone, together with
   `convoy.js`'s `leaderboard()` / `publishStats()` and the whole `kitchen_stats`
   half of sql/038 — the table, `kitchen_stats_upsert()`, the `ks_sel` policy,
   six column grants, an index and four of the migration's verify assertions.

   THEY HAD EXACTLY ONE CALLER EACH, EACH OTHER, FOR FOUR ROUNDS. No screen in
   the game ever showed a row. Round 5 closed the real defect (every client
   posting its display name to a shared table on a 60-second heartbeat for a page
   that does not exist) by making the write follow a read that never came, which
   left a fully reviewed, fully secured surface protecting nothing. CLAUDE.md
   asks for every RLS policy to be reviewed line by line; the fastest way to make
   that review worse is to fill it with policies that guard dead tables.

   The full argument, and the two traps to re-read before rebuilding any of it,
   are in convoy.js §10. Nothing here is a comment about a decision that could
   have gone the other way inside this file: the board needs a screen, and the
   screen is kitchen.render.js's.
   ═══════════════════════════════════════════════════════════════════════════ */

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
