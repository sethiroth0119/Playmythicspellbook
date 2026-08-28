/* ═══════════════════════════════════════════════════════════════════════════
   contracts.js — EVERY Supabase call for Transportation Companies.

   Nothing else in /src/transport touches the client. If a `.from(` or an
   `.rpc(` lives in another file in this directory, that is the bug, not a
   convenience — there is exactly one place where this feature can spend a
   player's money or read another player's row, and this is it.

   ─── THE DEGRADATION CONTRACT ───────────────────────────────────────────────
   ⚠ THE TABLES DO NOT EXIST YET. sql/038_transport_companies.sql has never been
   run against ktsiasyjusesawtrwrjc — there is no CLI login in this repo, so it
   is pasted BY HAND into the Supabase SQL editor, and the window between "the
   module ships" and "someone pastes it" will last days. Every export therefore
   returns a typed envelope and NONE of them throws at its caller: empty data
   plus a `missing` flag, so the panel says "run sql/038" instead of breaking
   the depot. This mirrors community.api.js, which states the same contract, and
   the Corp.* helpers before it.

   ─── WHERE THE MONEY ACTUALLY MOVES, because it is not all in one place ─────
   This file is judged as a money file, so the map is written down rather than
   inferred:
     · The FREIGHT FEE is charged SERVER-SIDE. transport_dispatch() calls
       wallet_charge() (sql/023) with a price IT computed from the carrier's
       stored tariff. This file never debits Cinder for a haul, and must never
       be "fixed" to, because that would charge the shipper twice.
     · The CARGO is escrowed CLIENT-SIDE, because it has to be. sql/038's own
       header publishes the limit: cargo lives in an opaque save blob, "the
       server CANNOT recompute a haul from first principles. It can only BOUND
       one." So the manifest leaves the stash here, at dispatch, and comes back
       here, on a delivered settlement. That is the atomic-spend path below.
     · The REPAIR BILL is charged CLIENT-SIDE, and sql/038 says so in the body
       of transport_repair: "the parts and the bill are charged client-side and
       the server cannot verify either… Do not read this function as verifying a
       repair was paid for." Its bound is max_repairs_per_rig_day.
     · THE CARRIER IS NEVER PAID FROM HERE. transport_settle writes a positive
       append-only transport_ledger row — an audited CLAIM, not cash. Balance is
       `sum(amount)`; there is no balance column and no cash-out RPC in this
       release. Crediting the carrier locally on settle would MINT Cinder: the
       shipper's payment was already burned by wallet_charge, so paying it out
       again on the client creates units nobody destroyed. That is precisely the
       unattributable faucet index.html:64445-64452 was written about — a week
       of production showing "+602,357 🔥 of reconcile gains… with nothing
       attributing a single unit of it to a source".

   ─── 📋 WHAT WAS ACTUALLY MEASURED, and on what, 2026-08-28 ────────────────
   Recorded because "the refund unwinds" is the claim money code in this repo
   has been wrong about before. Driven against a stub bridge and a stub
   PostgREST client (19 cases, then 13 more for the quote seam below, all
   passing) — NOT against ktsiasyjusesawtrwrjc, which has none of these tables:
     · every export returns its typed envelope with no bridge mounted, and the
       module imports without throwing
     · a repair whose RPC refuses put back 900 🔥 and 10 metal exactly
     · a `false` from spendGems refunded the parts leg
     · a dispatch refused after the escrow returned all 40 units into a vault
       ALREADY AT ITS CAP — which is the refundRes-versus-addRes distinction
       being real rather than asserted
     · a settle marked `retried` credited nothing; a settle by the carrier
       credited nothing; a delivery into a vault with room for 10 of 40
       reported the 30 out loud
     · a dispatch answered `retried: true` handed the second escrow back, so a
       resend of a lost call does not take the cargo twice
     · an unknown error code came back containing its own code verbatim
     · a PGRST202 came back naming signature drift AND the nine arguments sent
   And the quote-versus-request seam, driven against routes.js's REAL
   meridianQuote() output rather than a hand-written stand-in for it, because a
   hand-written one would agree with whatever this file assumed:
     · a bare quote object came back as `quote_not_request`, NOT as `bad_cargo`,
       and deducted nothing
     · the enriched object index.js actually sends shipped: the manifest reached
       p_cargo intact, p_units was summed from it (40, not read off the quote),
       p_hops came off the quote, the escrow took exactly 40, and the RPC was
       called with exactly nine named arguments
     · `dispatch({ cargo: {} })` still answered `bad_cargo` — the two failures
       stayed two failures with two fixes
     · a manifest of 80 against a fare quoted for 40 was refused before the
       escrow ran; a manifest of 10 against the same fare shipped
   ⚠ WHAT THIS DOES NOT PROVE. No test ran against real PostgREST, so the
     argument-set claim below is argued from sql/038's declared signature, not
     demonstrated against a live schema cache. Nothing here has seen a real
     wallet_charge. Do not read this block as saying the feature works.

   ─── THE GLOBALS TRAP (CLAUDE.md), which has already cost this project time ──
   `Profile`, `Cloud`, `App`, `Corp` and `Forge` are top-level `const` in
   index.html. A top-level `const` in a classic script is a global LEXICAL
   binding and is NOT a property of the global object, so `window.Profile` is
   undefined however global it looks, and an ES module cannot reach another
   script's lexical scope at all. Everything here arrives through `bridge()`.
   Nothing in this file reads a bare global; if it needs something new from the
   legacy app, it goes on the bridge — in BOTH halves — not around it.

   ─── A REJECTED DESIGN, recorded so it is not re-proposed ───────────────────
   🔴 RIGS ARE NOT SOLD CROSS-PLAYER ON THE EXISTING P2P VEHICLE MARKET, and
      that market is not extended to do it. Two concrete reasons, both in the
      live code:
        · `_vmCreditSeller` (index.html:195581-195589) is a documented no-op:
          `if (sellerId === _vmMyId() …) addCinders(amount); // TODO: Supabase
          RPC for true cross-player credit.` A "sale" therefore destroys the
          buyer's Cinder and pays the seller nothing at all.
        · `Forge.vehicleMarket` rides each player's own `user_profiles.forge`
          row (index.html:46725, 48138-48149), so a listing never leaves the
          account that made it. There is no shared market to sell into.
      Building fleet trading on that would have shipped a storefront where money
      vanishes and stock is invisible. Rigs come off the Prince Portfolios
      auction floor, which each player already runs against NPC sellers.

   ─── ANOTHER, smaller: the DAY KEY is not sent ──────────────────────────────
   `bridge().todayKey()` exists and is display-only. The runs/day counter and
   its day_key are computed from the DATABASE clock inside transport_dispatch(),
   because index.html:71039's getTodayKey() is `new Date()` on the device with
   no anchor: moving the OS clock mints a fresh day. That is tolerable for a
   counter that only cheats the player themself, and not tolerable for a rate
   limit other players are paying Cinder against. Same call v120g0 made when
   world chat moved to the chat_send() RPC.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge, bridgeReady } from './transport.bridge.js';

/* ═══ 1 · WHAT COUNTS AS "NOT INSTALLED" ═══════════════════════════════════ */

/* 🔴 THIS DECIDES ONE THING ONLY: "the migration has not been run", as opposed
   to a real failure. It must NEVER be used to decide the market is EMPTY. A
   rate board with no carriers on it and a rate board whose table does not exist
   are two different sentences to the player — "nobody is carrying yet, found a
   charter" versus "run sql/038 in the Supabase editor" — and collapsing them
   loses the only one an admin can act on. index.html:55405-55411 carries the
   same rule in a comment on its own copy of this regex.

   Three families, three different missing things, all of them meaning "the
   schema is not there yet":
     missing TABLE     PGRST205 · 42P01 · 'relation … does not exist'
     missing FUNCTION  PGRST202 · 42883 · 'Could not find the function'
     missing COLUMN    PGRST204 · 42703
   ⚠ NO /g AND NO /y FLAG, deliberately. A global RegExp keeps `lastIndex`
     between `.test()` calls, so the SAME error string tests true, then false,
     then true — the "run sql/038" banner would appear on every other refresh
     and read as a flapping backend. index.js already rebuilds it stateless
     before use; this side must not need it to. */
export const MISSING_RE =
  /PGRST205|PGRST204|PGRST202|42P01|42883|42703|does not exist|could not find|schema cache/i;

/* 🔴 THE NAMED-DEPENDENCY BRANCH, and it goes FIRST — before the generic
   missing-schema test above ever runs.

   index.html:79918-79930 is a monument to getting this order wrong, in its own
   words: "'does not exist' does NOT mean the RPC is missing. It also fires when
   the function EXISTS but a table INSIDE it does not — which is exactly what
   happened: bank_open_cinder reads public.public_profiles, a table that never
   existed, so this branch told the admin to run a .sql file they had already
   run, FOUR SEPARATE TIMES. Name the real error instead of guessing at a
   cause."

   The same shape is live here: every transport RPC calls transport_quote, and
   transport_dispatch calls wallet_charge from sql/023. If 023 was never
   applied, the raw string is `function public.wallet_charge(…) does not exist`
   — and telling that admin to run sql/038 sends them to the wrong file. So a
   dependency this file knows about by name is reported by name. */
const DEP_RE = /wallet_charge|wallet_ledger|user_profiles|auth\.users|transport_config/i;

/* The shape a caller gets when there is no session at all. `offline` is a
   THIRD state beside ok and missing on purpose — it is not an error, it is a
   designed state, and it gets its own sentence. */
export const OFFLINE = { ok: false, missing: false, offline: true, error: 'not signed in' };

/* Two ways to have no client, and they are not the same problem, so they are
   not the same sentence. bridgeReady() is false when index.html has not handed
   the module its capabilities (the feature is inert and a developer must wire
   the bridge); it is true, with no signed-in session, when the player is simply
   logged out (the player can fix it). */
function offWhy() {
  return bridgeReady()
    ? 'You are signed out — the freight exchange needs a connection.'
    : 'The freight bridge has not mounted, so the depot is inert. index.html must publish window.MythicTransportBridge.';
}

/* Never throws, never returns a half-built client. Touching `window` can throw
   in a sandboxed frame, and `signedIn()` is a bridge call that may itself throw
   before the game has finished booting — so the whole thing is wrapped and a
   failure is simply "no client". */
function client() {
  const b = bridge();
  try {
    if (!b || !b.cloud || !b.cloud.client) return null;
    if (!b.signedIn()) return null;
    return b.cloud.client;
  } catch (e) { return null; }
}

/* The one place a raw error becomes an envelope. Exported because index.js
   classifies on the same flags and a second copy of this rule would be a second
   answer to "is the schema missing?". */
export function fail(e) {
  const msg = (e && (e.message || e.msg || e.details || e.code)) || String(e || '');
  const s = String(msg);
  return { ok: false, offline: false, missing: MISSING_RE.test(s), error: s };
}

/* ═══ 2 · THE ERROR TABLE ══════════════════════════════════════════════════
   Every refusal transport_quote / transport_dispatch / transport_settle /
   transport_repair / transport_set_sheet can return, with its own sentence and
   its own `fix`. This list is copied from the `jsonb_build_object('ok', false,
   'error', …)` sites in sql/038 and NOTHING ELSE decides what a code means.

   ⚠ THE LIST CAN GO STALE, and staleness inverts the check: a code added to
     sql/038 and not added here falls through to the unknown arm, which prints
     the code verbatim. That is the correct direction to fail in — the player
     sees `over_weight_cap` and an admin can grep for it — but it is a worse
     message than a written one, so a new refusal in sql/038 wants a line here.
     What must NEVER happen is the opposite: inventing a plausible cause for a
     code this build has not seen. sql/037:16-23 is the other half of the same
     lesson — an unhandled code fell through to a generic "nothing moved" that
     hid a hard crash for the entire life of that feature.

   The `d` argument is the RPC's own jsonb: sql/038 deliberately ships the
   numbers a client needs to write a sentence (cap, used, remaining, needed,
   bays, reach), so the message states them instead of gesturing at them. */
const CODES = {
  not_authenticated: () => ({
    why: 'The freight service did not recognise your session.',
    fix: 'Sign in again — a tab left open since before the session expired looks exactly like this.',
  }),
  closed: () => ({
    why: 'The freight exchange is closed (transport_config.enabled is false).',
    fix: 'Nothing is wrong with your depot — an admin has the exchange switched off.',
  }),

  /* ── routing / quote ──────────────────────────────────────────────────── */
  bad_hops: (d) => ({
    why: d.hops === 0 || d.hops == null
      ? 'No route length was sent with that haul, so the exchange has nothing to price.'
      : 'That route is ' + n(d.hops) + ' hops and the exchange carries at most ' + n(d.max_hops) + '.',
    fix: 'Ship to somewhere closer, or in two legs.',
  }),
  bad_units: (d) => ({
    why: n(d.units) + ' units is outside what one contract carries (max ' + n(d.max_units) + ').',
    fix: 'Split the load across two hauls.',
  }),
  bad_route: () => ({ why: 'Both ends of the route have to be real places.', fix: 'Pick an origin and a destination.' }),
  same_node: () => ({ why: 'The cargo is already there.', fix: 'Pick a different destination.' }),
  out_of_reach: (d) => ({
    why: 'That carrier reaches ' + n(d.reach) + ' hops from its depot; this haul is ' + n(d.hops) + '.',
    fix: 'Hire a carrier closer to the route, or ship with Meridian Haulage.',
  }),
  no_tariff_published: () => ({
    why: 'That carrier has not published a rate yet, so the exchange cannot quote them.',
    fix: 'Pick another carrier, or ship with Meridian Haulage.',
  }),
  over_price_cap: (d) => ({
    why: 'That haul prices at ' + n(d.price) + ' 🔥, over the exchange ceiling of ' + n(d.cap) + ' 🔥.',
    fix: 'Fewer units or fewer hops — the price is units × hops × the tariff.',
  }),

  /* ── carrier state ────────────────────────────────────────────────────── */
  no_such_carrier: () => ({ why: 'That carrier is no longer on the exchange.', fix: 'Refresh the rate board.' }),
  carrier_closed: (d) => ({
    why: 'That carrier is ' + (d.status || 'not open') + ', not trading.',
    fix: 'Pick another carrier from the board.',
  }),
  /* Meridian is the answer to this one BY DESIGN — it is a price ceiling that
     exists so a carrier cannot end another player's game by refusing them. */
  blacklisted: () => ({
    why: 'That carrier has refused your business.',
    fix: 'Ship with Meridian Haulage — it never refuses anyone; that is what it is for.',
  }),
  no_free_bay: (d) => ({
    why: 'All ' + n(d.bays) + ' of that carrier’s bays are loaded (' + n(d.in_transit) + ' in transit).',
    fix: 'Wait for one of their hauls to land, or hire someone else.',
  }),
  not_your_company: () => ({
    why: 'That charter is not yours.',
    fix: 'Reopen the depot — the panel is holding a company id that has changed hands.',
  }),
  bad_tariff: () => ({ why: 'That rate sheet is not a tariff the exchange can read.', fix: 'A tariff is a positive number of Cinder per unit·hop.' }),
  bad_status: () => ({ why: 'A charter is open, paused or closed — nothing else.', fix: 'Pick one of the three.' }),
  blacklist_too_long: (d) => ({
    why: 'A refusal list holds ' + n(d.max) + ' shippers; that one has ' + n(d.sent) + '.',
    fix: 'Drop some names before saving.',
  }),

  /* ── the fleet ────────────────────────────────────────────────────────── */
  no_rig_chosen: () => ({ why: 'No rig was assigned to that haul.', fix: 'Pick a rig from the yard.' }),
  no_such_rig: () => ({ why: 'That rig is not in the fleet table.', fix: 'Refresh the yard — it may have been retired.' }),
  rig_not_in_fleet: () => ({ why: 'That rig belongs to a different carrier.', fix: 'Refresh the yard.' }),
  rig_on_deployment: () => ({
    why: 'That rig is out on a deployment and cannot haul.',
    fix: 'Bring it home first.',
  }),
  rig_retired: () => ({ why: 'That rig is retired.', fix: 'Register another one.' }),
  rig_out_of_runs: (d) => ({
    why: 'That rig has used all ' + n(d.cap) + ' of its runs for the day.',
    fix: 'Use another rig, repair this one to raise its ladder, or wait for the reset (server day ' + (d.day_key || 'UTC') + ').',
  }),
  rig_in_transit: () => ({ why: 'That rig is mid-haul.', fix: 'Settle the contract it is on first.' }),
  not_your_rig: () => ({ why: 'That rig is not in a fleet you own.', fix: 'Refresh the yard.' }),
  rig_is_salvage: () => ({
    why: 'That rig is Salvage — it is finished as freight.',
    fix: 'Strip it for parts or sell it on; it will not repair.',
  }),
  not_damaged: (d) => ({
    why: 'That rig is already ' + (d.condition || 'in top condition') + '.',
    fix: 'Nothing to repair.',
  }),
  repair_cap: (d) => ({
    why: 'That rig has had its ' + n(d.cap) + ' repairs for the day.',
    fix: 'It resets on the server day (' + (d.day_key || 'UTC') + ') — the device clock is not what counts.',
  }),

  /* ── the manifest ─────────────────────────────────────────────────────── */
  bad_cargo: () => ({ why: 'That manifest is not something the exchange can carry.', fix: 'Pick a resource and an amount.' }),
  cargo_too_large: (d) => ({
    why: 'That manifest is ' + n(d.bytes) + ' bytes; the limit is ' + n(d.max_bytes) + '.',
    fix: 'Ship fewer distinct resources in one contract.',
  }),

  /* ── money ────────────────────────────────────────────────────────────── */
  insufficient_cinder: (d) => ({
    why: 'The haul costs ' + n(d.needed) + ' 🔥 and the wallet holds ' + n(d.balance) + '.',
    fix: 'Nothing was charged and nothing shipped.',
  }),
  /* 🔴 THE FOUR-TIMES BUG, closed from the other side. sql/038 catches
     `undefined_function` around wallet_charge and hands back THIS code with the
     file to run, precisely so the client does not print "does not exist" and
     send an admin back to the migration they already applied. Say the right
     file out loud. */
  wallet_rpc_missing: (d) => ({
    why: 'Freight is installed, but the wallet RPC it charges through is not.',
    fix: 'Run ' + (d.run_sql || 'sql/023_boe_canonical_wallet.sql') + ' in the Supabase editor — NOT sql/038, which is already applied if you are seeing this code.',
  }),

  /* ── settlement ───────────────────────────────────────────────────────── */
  no_such_contract: () => ({ why: 'That contract is not on the exchange.', fix: 'Refresh the depot.' }),
  not_your_contract: () => ({ why: 'That contract is between two other parties.', fix: 'Refresh the depot.' }),
  still_in_transit: (d) => ({
    why: 'That haul has not landed yet (' + mins(d.seconds_remaining) + ' to run).',
    fix: 'The arrival clock is the server’s — the device clock cannot land it early.',
  }),
};

function n(v) { const x = Number(v); return Number.isFinite(x) ? Math.round(x).toLocaleString() : '?'; }
function mins(secs) {
  const s = Math.max(0, Math.ceil(Number(secs) || 0));
  return s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'
       : s >= 60 ? Math.floor(s / 60) + 'm' : s + 's';
}

/* The unknown arm SAYS THE CODE. It does not guess a cause, it does not
   apologise generically, and it does not blame the migration — a generic
   "something went wrong" is how a specific, known, fixable condition gets
   hidden, and a guessed cause is how an admin gets sent to the wrong file. */
function explain(code, d) {
  const f = Object.prototype.hasOwnProperty.call(CODES, code) ? CODES[code] : null;
  if (f) { try { return f(d || {}); } catch (e) { /* fall through to verbatim */ } }
  return {
    why: 'The freight service refused with a code this build does not know: "' + code + '".',
    fix: 'Quote that code verbatim to an admin — it is printed rather than guessed at on purpose.',
  };
}

/* ═══ 3 · THE CHOKEPOINTS ══════════════════════════════════════════════════ */

/* 🔴 THE ONLY `throw` IN THIS FILE, AND IT NEVER LEAVES IT.
   It is here so the refund branches below stay LIVE CODE. index.html's city
   bridge shipped `setState: (s) => { try { B.setProdState(s); } catch (e) {} }`
   and that single swallowed catch made build()'s refund-on-record-failure
   branch unreachable: a save throw charged a player 50,000 Cinder for a
   building that never persisted, and build() still returned {ok:true}.
   production.state.js's fix is the shape copied here — convert a `false` from
   the seam into a throw at ONE place, so every caller's unwind path is reached
   by a real failure rather than by inspection.

   `=== false`, not `!x`: transport.bridge.js pins every mutator on the seam to
   a boolean and states that "`false` IS the contract", so only an explicit
   refusal unwinds. A bridge that has not been built yet answering `undefined`
   must not make every repair in the game refuse. */
function persist(b) {
  if (b.save() === false) throw new Error('the profile refused to save');
}

/* THE SECOND AND LAST INTERNAL THROW is `ownCompanyId` below, and it is here
   for a reason worth stating rather than a convenience: it could have returned
   null on a read failure, and that would have collapsed "the
   transport_companies table does not exist" into "you do not run a carrier".
   Those are the two sentences MISSING_RE exists to keep apart. It throws, every
   caller already has a try/catch that turns it into a proper `missing`
   envelope, and nothing escapes an export.

   A REFUND HAS TO REACH DISK, and the return value of the save that puts it
   there is CHECKED. A refund that did not persist is a refund the next reload
   silently undoes — the player is left paid-up with nothing — and this project
   has shipped the swallowed-save bug often enough that the branch says so out
   loud instead of `try { save(); } catch (e) {}`. */
function saveRefund(b, what) {
  let ok = false;
  try { ok = (b.save() !== false); } catch (e) { ok = false; }
  if (!ok) {
    try { b.toast('⚠ ' + what + ' was refunded but the profile did not save. Reopen the depot before closing the tab.', 6500); } catch (e) {}
  }
  return ok;
}

/* Every RPC in this feature goes through here, so there is exactly one place
   that decides what a Postgres failure means.

   BOTH guards are mandatory and neither is redundant: supabase-js returns a
   query error as `r.error` on a resolved promise, and a NETWORK failure throws.
   A call site with only the try/catch silently treats a PostgREST 400 as
   success; one with only the `r.error` check dies in a click handler when the
   tunnel drops mid-request. */
async function rpc(c, name, args) {
  const sent = Object.keys(args).join(', ');
  let r;
  try {
    r = await c.rpc(name, args);
  } catch (e) { return rpcFail(name, sent, e); }
  if (r && r.error) return rpcFail(name, sent, r.error);

  const d = (r && r.data && typeof r.data === 'object') ? r.data : null;
  if (!d) {
    /* A 200 with a body that is not the documented envelope. Reported rather
       than coerced: `!d.ok` on a null body would report a refusal that never
       happened, and treating it as success would report a haul that never
       shipped. */
    return {
      ok: false, missing: false, offline: false, code: 'no_answer',
      error: name + ' returned ' + (r && r.data === null ? 'null' : typeof (r && r.data)),
      why: 'The freight service answered without saying whether it worked.',
      fix: 'Refresh the depot before retrying — the call may or may not have landed.',
    };
  }
  if (d.ok === true) return { ok: true, missing: false, offline: false, data: d };

  const code = String(d.error || 'unknown');
  const m = explain(code, d);
  return { ok: false, missing: false, offline: false, code, error: code, why: m.why, fix: m.fix, data: d };
}

/* 🔴 THE ORDER OF THESE THREE BRANCHES IS THE WHOLE POINT.
   1. A dependency this file knows by NAME. "does not exist" is ambiguous, and
      the ambiguity has already cost four debugging sessions here
      (index.html:79918-79930): the function existed, a table inside it did not,
      and the generic branch sent an admin back to a migration they had already
      run. So a message that names wallet_charge or transport_config wins first.
   2. A genuinely absent RPC. ⚠ And it is reported HONESTLY: PostgREST resolves
      an RPC by the EXACT SET of named arguments, so "the migration was never
      applied" and "the installed function has a different parameter list" are
      the same PGRST202 from out here. Saying only the first would recreate the
      exact bug in (1). The arguments this build sends are printed so the two
      can be told apart in ten seconds.
   3. Anything else, VERBATIM and trimmed. */
function rpcFail(name, sent, e) {
  const base = fail(e);
  const msg = base.error;
  if (DEP_RE.test(msg)) {
    const dep = (msg.match(DEP_RE) || ['a dependency'])[0];
    return Object.assign(base, {
      missing: true,
      why: name + ' is installed but the "' + dep + '" it depends on is not.',
      fix: 'Do not re-run sql/038 — it is clearly applied. Find the migration that creates ' + dep + ' (wallet_charge is sql/023) and run that.',
    });
  }
  if (MISSING_RE.test(msg)) {
    return Object.assign(base, {
      missing: true,
      why: name + '() is not installed, OR it is installed with a different parameter list.',
      fix: 'Run sql/038_transport_companies.sql in the Supabase SQL editor. If it is already applied, compare its signature against the arguments this build sends: (' + sent + ').',
    });
  }
  return Object.assign(base, {
    why: 'The freight service failed: ' + msg.slice(0, 220),
    fix: 'That is the database’s own words, not a guess.',
  });
}

/* One read, one place, and DELIBERATELY NOT CACHED. The pinned signatures for
   setTariff() and listContracts() carry no company id, so the caller's own
   charter has to be looked up. A module-level cache would be a fourth copy of
   "which company am I?" (the panel holds one, the row holds one, the RPC reads
   one) and a stale one after founding, closing or re-founding points a rate
   change at a company that is not there — which the setter then refuses as
   `not_your_company`, a confusing answer to a question the client got wrong.
   It is one row on an indexed owner_id. */
async function ownCompanyId(c, uid) {
  const r = await c.from('transport_companies').select('id').eq('owner_id', uid).limit(1).maybeSingle();
  if (r.error) throw r.error;                    // caught by the caller's own try/catch
  return (r.data && r.data.id) || null;
}

/* ═══ 4 · THE MANIFEST AND THE SPEND ═══════════════════════════════════════ */

/* A manifest is `{ <resourceId>: units }` with every leg a positive integer.
   Zero, negative and NaN legs are DROPPED rather than rounded up: a leg that is
   present but zero is not freight, and shipping it would price a contract for
   cargo that never left the stash. */
function normCargo(cargo) {
  const out = {};
  if (!cargo || typeof cargo !== 'object' || Array.isArray(cargo)) return out;
  for (const k in cargo) {
    if (!Object.prototype.hasOwnProperty.call(cargo, k)) continue;
    const v = Math.floor(Number(cargo[k]));
    if (Number.isFinite(v) && v > 0) out[String(k)] = v;
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

/* 🔎 "IS THIS OBJECT A ROUTES.JS QUOTE?" — used by dispatch() to tell a caller
   that handed over a PRICE from one that handed over a HAUL.

   It tests for the fare fields, and it can do so safely because routes.js's
   shape() stamps every one of them onto EVERY outcome it returns, refusals
   included — that is the stated point of having one shape. So their presence is
   structural rather than incidental, and a refusal shape (ok:false, price:null,
   cargoUnits:0) is recognised just as reliably as a live quote.

   ⚠ THREE FIELDS, NOT ONE. `ok` alone is on half the envelopes in this file and
     would misfire on anything. `etaText` and `cargoUnits` together are specific
     to a fare: nothing else in this feature carries a human ETA string and a
     unit count at the same time. And the check is deliberately CONSERVATIVE —
     when in doubt it says "not a quote" and the call proceeds down the ordinary
     path, because a false positive here would refuse a legitimate dispatch,
     which is a worse failure than the confusing message it exists to prevent. */
function isQuoteShaped(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o)
      && typeof o.ok === 'boolean'
      && typeof o.etaText === 'string'
      && Object.prototype.hasOwnProperty.call(o, 'cargoUnits');
}

function unitsOf(legs) {
  let t = 0;
  for (const k in legs) t += legs[k];
  return t;
}

/* ════════════════════════════════════════════════════════════════════════════
   🔴 THE ATOMIC RESOURCE SPEND. Verify EVERY leg with a human message before
   touching a single balance; then deduct, recording each leg so it can be put
   back exactly; and hand the caller a `refund` closure so the path that fails
   AFTER this returns can unwind too.

   This is cost.js's spendCost() applied to a manifest. The one structural
   difference is that Cinder is NOT a leg here — transport_dispatch charges it
   server-side through wallet_charge — so the ordering argument cost.js makes
   ("resources first, Cinder last, because Cinder is the leg that can fail for
   reasons outside this function") lands differently: the leg outside this
   function is the RPC itself, so every local leg is taken first and the RPC is
   the last thing that can fail. Unwinding N resource legs is cheap; unwinding a
   charge that has already fired a server write is not, and from here it is not
   even possible.

   🔴 THE REFUND USES b.refundRes, NEVER b.addRes, and the distinction is a
      safety property rather than a naming nicety. addRes is the CAPPED add: it
      respects the stash cap and returns WITHOUT ADDING when the vault is full,
      which is right for a payout (a delivery that overflows is a smaller
      delivery) and catastrophic for an undo. A driven test in /src/city caught
      exactly that failure: 95 metal and 70 supplies deducted, "refunded", and
      gone. A refund is an UNDO of units the player held moments ago, so it must
      bypass the ceiling. Unwound in REVERSE so the ledger retraces its steps.
   ════════════════════════════════════════════════════════════════════════════ */
function takeRes(b, legs, what) {
  const ids = Object.keys(legs);

  // ── Phase 1: verify everything. Nothing has moved yet.
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const have = b.getRes(id) | 0;
    if (have < legs[id]) {
      return {
        ok: false, code: 'short_res',
        why: 'Not enough ' + id + ' for ' + what + ' — need ' + n(legs[id]) + ', have ' + n(have) + '.',
        fix: 'Produce or buy ' + n(legs[id] - have) + ' more, or send a smaller load.',
      };
    }
  }

  // ── Phase 2: deduct, recording each leg.
  const taken = [];
  const refund = () => {
    // Nothing was ever deducted (an empty parts bill, or a double call from two
    // failure paths). Returning early keeps a no-op unwind from triggering a
    // save and a "did not save" toast about zero units.
    if (!taken.length) return true;
    let lost = 0;
    for (let i = taken.length - 1; i >= 0; i--) {
      const t = taken[i];
      // Wrapped per leg: one throwing seam must not abandon the remaining legs
      // half-refunded, which is a worse state than the one being unwound. Each
      // leg's return value is counted, because a refund that returned false is
      // units the player is owed and did not get back.
      try {
        const done = (typeof b.refundRes === 'function')
          ? b.refundRes(t.id, t.n)
          : b.addRes(t.id, t.n);             // last resort; see the cap note above
        if (done === false) lost += t.n;
      } catch (e) { lost += t.n; }
    }
    taken.length = 0;
    if (lost > 0) {
      try { b.toast('⚠ ' + n(lost) + ' units could not be put back into the stash. Tell an admin.', 7000); } catch (e) {}
    }
    saveRefund(b, what);
    return lost === 0;
  };

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    // `!x` matches cost.js exactly: an `undefined` from the seam counts as a
    // REFUSAL here, not a success, because the cost of guessing wrong on a
    // deduction is the player's goods.
    if (!b.spendRes(id, legs[id])) {
      refund();
      return {
        ok: false, code: 'ledger_refused',
        why: 'The stash refused ' + n(legs[id]) + ' ' + id + ' — every deducted leg was refunded.',
        fix: 'Reopen the depot and try again.',
      };
    }
    taken.push({ id: id, n: legs[id] });
  }
  return { ok: true, refund: refund, taken: taken };
}

/* 🎚 THE REPAIR BILL COMES FROM _opEcon AND NOWHERE ELSE.
   CLAUDE.md: "All operation pricing goes through _opEcon(). Never hardcode
   economy numbers." So this reads the transport operation's own economy row
   through the bridge and REFUSES if there is not one, rather than inventing a
   figure. An invented figure would be a second pricing authority that the shop
   cannot see and an admin retune cannot reach — which is how a UI comes to
   advertise one price while the charge does something else.

   THE RULE, stated once: one rung of condition costs one worker-hour of the
   yard's own gross rate. `ratePerWorkerHr` and nothing multiplied by it — a
   coefficient here would BE the hardcoded economy number, just wearing a
   variable name. If the econ row ever publishes an explicit `repairPerStep`
   that wins, so the authority can become exact later without another edit here.

   ⚠ PROVISIONAL, AND THIS COMMENT EXISTS TO BE DELETED BY WHOEVER FIXES IT.
     Design §4 says repairs also consume PP_PARTS-mapped resources. PP_PARTS is
     a `const` in index.html (~195346) and this module genuinely cannot see it
     (the globals trap), and copying the sixteen-row table here would be a
     second parts catalog to drift against the first. So until
     `_opEcon('transport').repairParts` publishes a dict, a repair costs Cinder
     only, and the parts leg below is dead but correct. */
function repairBill(b) {
  let e = null;
  try { e = b.opEcon('transport'); } catch (err) { e = null; }
  if (!e || typeof e !== 'object') {
    return {
      ok: false, code: 'not_priced',
      why: 'Freight has no economy row yet, so a repair has no price.',
      fix: 'Add a `transport` entry to OPS_ECON (index.html:79732) — this module will not invent one.',
    };
  }
  const raw = (e.repairPerStep != null) ? e.repairPerStep : e.ratePerWorkerHr;
  const cinder = Math.max(0, Math.floor(Number(raw) || 0));
  if (!(cinder > 0)) {
    return {
      ok: false, code: 'not_priced',
      why: 'The freight economy row publishes no rate, so a repair has no price.',
      fix: 'Set ratePerWorkerHr (or repairPerStep) on the `transport` entry in OPS_ECON.',
    };
  }
  return { ok: true, cinder: cinder, parts: normCargo(e.repairParts) };
}

/* ═══ 5 · READS ════════════════════════════════════════════════════════════
   Every read returns its empty collection ALONGSIDE the flags, from the failure
   path and the catch alike, so a caller never has to branch on failure to find
   the array. `rows` is always an array; `row` is always present or null. */

/* The caller's own charter. `maybeSingle()` rather than `single()`: having no
   company is the ordinary state for every player who has not founded one, and
   `single()` turns that into a PGRST116 error the panel would have to un-learn. */
export async function myCompany() {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, row: null, why: offWhy() };
  try {
    const r = await c.from('transport_companies')
      .select('id,owner_id,name,home_node_id,depot_level,tariff,reliability,status,created_at')
      .eq('owner_id', uid).limit(1).maybeSingle();
    if (r.error) return { ...fail(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...fail(e), row: null }; }
}

/* THE RATE BOARD. Public by policy (`using (true)` on transport_companies, and
   sql/038 says why: "a price nobody can see cannot be undercut").

   ⚠ `blacklist` IS DELIBERATELY NOT SELECTED, even though the row-level policy
     would return it. Two reasons: it is up to 200 uuids on every row of a board
     that lists sixty carriers, and pre-filtering the board by it would publish
     to every client exactly who has refused whom. A refusal arrives instead as
     the `blacklisted` code at dispatch — one round trip, one carrier, and the
     message points at Meridian, which is what Meridian is for. */
export async function listCarriers(limit = 60) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [], why: offWhy() };
  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 60)));
  try {
    const r = await c.from('transport_companies')
      .select('id,owner_id,name,home_node_id,depot_level,tariff,reliability,status,created_at')
      .eq('status', 'open')
      .order('reliability', { ascending: false, nullsFirst: false })
      .limit(lim);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* The yard. RLS already narrows this to fleets the caller owns
   (`is_transport_owner(company_id)`), so there is no owner filter here — and
   adding one would be a client-side re-statement of a server-side boundary,
   which reads as security and is not. */
export async function listMyRigs() {
  const c = client(); if (!c) return { ...OFFLINE, rows: [], why: offWhy() };
  try {
    const r = await c.from('transport_rigs')
      .select('id,company_id,owner_id,vehicle_id,rarity,condition,runs_cap,runs_used,day_key,repairs_used,assigned_to,status,created_at')
      .order('created_at', { ascending: true }).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* Contracts on either side. `role` is 'carrier' | 'shipper'; anything else —
   including the no-argument call the panel makes on refresh — means BOTH, in
   one round trip, because the depot screen shows a player their inbound and
   outbound freight together and two queries would render them out of step.
   A carrier with no charter simply has no carrier side. */
export async function listContracts(role) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [], why: offWhy() };
  const b = bridge();
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, rows: [], why: offWhy() };
  const cols = 'id,carrier_id,rig_id,shipper_id,from_node,to_node,hops,units,cargo,price,escort,risk_pct,depart_at,arrive_at,status,settled_at,created_at';
  try {
    let q = c.from('transport_contracts').select(cols);
    if (role === 'shipper') {
      q = q.eq('shipper_id', uid);
    } else {
      const mine = await ownCompanyId(c, uid);
      if (role === 'carrier') {
        // No charter means no carrier-side contracts. Answering with an empty
        // list is the truth; a query with `carrier_id = null` would return the
        // Meridian hauls of every player on the exchange.
        if (!mine) return { ok: true, rows: [] };
        q = q.eq('carrier_id', mine);
      } else {
        /* ⚠ `or()` TAKES A FILTER EXPRESSION, NOT A PARAMETER. PostgREST parses
           this string as its own mini-language, so a uuid carrying a comma, a
           dot or a parenthesis would not be escaped — it would change which
           rows come back. Both values are checked against the uuid shape first
           and the query falls back to the single-sided `eq()` form, which IS
           parameterised, if either one is not one. */
        q = (mine && isUuid(uid) && isUuid(mine))
          ? q.or('shipper_id.eq.' + uid + ',carrier_id.eq.' + mine)
          : q.eq('shipper_id', uid);
      }
    }
    const r = await q.order('created_at', { ascending: false }).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* ═══ 6 · WRITES THAT MOVE NO MONEY ════════════════════════════════════════ */

/* Founding the charter. The CINDER for it is NOT charged here — a charter is
   bought in Just Business through _opFound/_opEcon, which is the one place an
   operation is priced. Charging again on this insert would be a second price
   for the same thing and the two could disagree.

   ⚠ WHAT IS DELIBERATELY NOT SENT, and why the omissions are the security:
   sql/038's insert policy pins `status='open'`, `reliability is null` and
   `blacklist='{}'`. Every one of those is left to the column default rather
   than stated here — a founder who could pick their own opening reliability
   would start at 100% and never earn it, and a charter born with a refusal list
   arrives pre-loaded against a rival. Sending them would at best duplicate the
   policy and at worst violate it after a future edit. */
export async function createCompany(name, homeNodeId) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  // The pinned contract is positional; index.js:614 calls createCompany({name}).
  // Accepted rather than refused, because a two-file arity drift must degrade to
  // a working call, not to a company named "[object Object]".
  if (name && typeof name === 'object') {
    homeNodeId = (homeNodeId != null) ? homeNodeId : (name.homeNodeId || name.home_node_id);
    name = name.name;
  }
  const nm = String(name == null ? '' : name).trim().slice(0, 40);
  if (!nm) {
    return { ok: false, missing: false, offline: false, error: 'no_name',
             why: 'A carrier needs a name shippers can find it by.', fix: 'Type one in.' };
  }
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, row: null, why: offWhy() };

  // The depot's home node. Falls back to where the player's city actually is,
  // because home_node_id holds a TERRITORY-WARS node id ('N-25') — sql/038 has
  // the postmortem on the two id spaces both called "node".
  let home = homeNodeId;
  if (home == null) { try { home = b.campNodeId(); } catch (e) { home = null; } }

  try {
    const r = await c.from('transport_companies')
      .insert({ owner_id: uid, name: nm, home_node_id: home ? String(home).slice(0, 40) : null })
      .select('id,owner_id,name,home_node_id,depot_level,tariff,reliability,status,created_at')
      .maybeSingle();
    if (r.error) return { ...fail(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...fail(e), row: null }; }
}

/* THE RATE SHEET goes through transport_set_sheet(), never through an UPDATE.
   That is not a style choice: sql/038 revokes UPDATE on transport_companies
   because POSTGRES RLS HAS NO COLUMN GRANULARITY — a row policy saying "the
   owner may retune their own tariff" also hands over reliability, depot_level
   and status. An RPC can express what a policy cannot, so a direct
   `.update({tariff})` from here would simply be denied, and correctly.

   The RPC's parameters are all nullable and mean "leave this alone", so one
   field is sent without round-tripping the others and racing a second tab. */
export async function setTariff(tariff) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, row: null, why: offWhy() };

  /* A bare number is accepted and normalised to `{ base: n }`, and this is a
     correctness fix rather than politeness: index.js:624 calls setTariff(5), and
     transport_quote reads the rate as `(tariff->>'base')::numeric`. A jsonb `5`
     has no 'base' key, so the carrier would store a tariff, see it saved, and be
     refused `no_tariff_published` on every quote forever. */
  let sheet = tariff;
  if (typeof sheet === 'number' || typeof sheet === 'string') sheet = { base: Number(sheet) };
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
    return { ok: false, missing: false, offline: false, error: 'bad_tariff',
             why: 'A tariff is a rate sheet or a number of Cinder per unit·hop.', fix: 'Enter a positive number.' };
  }
  const clean = {};
  ['base', 'escort_pct', 'illicit_pct'].forEach((k) => {
    const v = Number(sheet[k]);
    if (Number.isFinite(v) && v >= 0) clean[k] = v;
  });

  try {
    const id = await ownCompanyId(c, uid);
    if (!id) {
      return { ok: false, missing: false, offline: false, error: 'no_company',
               why: 'You do not run a carrier yet.', fix: 'Register one on the exchange first.' };
    }
    /* Every argument is named, including the three this call leaves null.
       PostgREST resolves an RPC by the exact set of named arguments, so omitting
       them would not mean "use the default" — it would fail to find the function
       at all, and arrive here as a PGRST202 that looks exactly like an unapplied
       migration. */
    const r = await rpc(c, 'transport_set_sheet', {
      p_company_id: id, p_tariff: clean, p_status: null, p_depot_level: null, p_blacklist: null,
    });
    if (!r.ok) return r;
    const d = r.data;
    /* `tariff` is handed back as the CLAMPED BASE NUMBER and the full sheet is
       on `sheet`. The caller prints it (index.js:628 does fmtNum(num(r.tariff)))
       and Number({}) is NaN, which would silently echo the requested rate — the
       one thing that comment says not to do, since the server clamps to the
       Meridian ceiling. */
    const base = Number(d.tariff && d.tariff.base);
    return {
      ok: true, tariff: Number.isFinite(base) ? base : 0, sheet: d.tariff || clean,
      status: d.status, depotLevel: d.depot_level, bays: d.bays, fleetCap: d.fleet_cap, row: d,
    };
  } catch (e) { return { ...fail(e), row: null }; }
}

/* Registering a rig into the fleet. It costs NOTHING, and the absence of a
   charge is deliberate: the rig was already bought on the Prince Portfolios
   auction floor, and billing again at registration would be a second price for
   one object with no _opEcon key behind it. A caller's `{ free: false }` is
   therefore honoured as a no-op rather than quietly meaning something.

   ⚠ runs_cap IS THE CALLER'S TO SUPPLY, AND THIS FILE WILL NOT DERIVE IT.
     The ladder — 3/4/5/6/8/10 by rarity × PP_COND_MULT, floor, minimum 1 — is
     rigs.data.js's `effectiveRuns()` and that is the authority. Copying it here
     would be a second ladder to drift against the first, and the auction
     minigame already runs a second, incompatible rarity list (PPA_RARITIES),
     which is exactly how a rig ends up with two contradictory rarities.
     When no cap is handed over the column defaults to 3 server-side, so a Mythic
     rig would run three times a day instead of ten. That is the correct
     direction for the disagreement to fail in — sql/038 says the same about
     `least(runs_cap, max_runs_per_rig)` — but it IS wrong, and the fix is for
     the caller to pass it, not for this file to grow a rarity table. */
export async function registerRig(vehicleId, rarity, condition) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  // index.js:636 calls registerRig(id, { free:false }) and :490 calls it with
  // { free:true, starter:true }. Second-argument-as-options is accepted.
  let opts = {};
  if (rarity && typeof rarity === 'object') { opts = rarity; rarity = opts.rarity; }
  if (condition == null) condition = opts.condition;

  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, row: null, why: offWhy() };

  const row = {
    owner_id: uid,
    vehicle_id: vehicleId == null ? null : String(vehicleId).slice(0, 64),
  };
  if (rarity) row.rarity = String(rarity).toLowerCase().slice(0, 16);
  if (condition) row.condition = String(condition).slice(0, 16);
  const cap = Math.floor(Number(opts.runsCap != null ? opts.runsCap : opts.runs_cap));
  if (Number.isFinite(cap) && cap > 0) row.runs_cap = Math.min(10, cap);
  /* runs_used, repairs_used, day_key, assigned_to and status are NOT sent —
     every one of them is pinned at its zero by the insert policy, and sending
     them is at best redundant and at worst the exploit the policy is refusing
     (a rig arriving with runs_used = -1000 has a thousand free hauls). */

  try {
    const id = await ownCompanyId(c, uid);
    if (!id) {
      return { ok: false, missing: false, offline: false, error: 'no_company',
               why: 'A rig has to belong to a carrier.', fix: 'Register your carrier on the exchange first.' };
    }
    row.company_id = id;
    const r = await c.from('transport_rigs').insert(row)
      .select('id,company_id,vehicle_id,rarity,condition,runs_cap,runs_used,status').maybeSingle();
    if (r.error) return { ...fail(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...fail(e), row: null }; }
}

/* ═══ 7 · THE MONEY PATHS ══════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════════
   DISPATCH — the shipper hands over cargo and the server charges the fee.

   THE PINNED FIVE ARGUMENTS ARE THE CONTRACT; `route` IS A SIXTH, OPTIONAL, AND
   IT EXISTS BECAUSE THE TWO SIDES DRIFTED. The client-side spec pins
   `dispatch(carrierId, rigId, fromNode, toNode, cargo)` and an RPC taking five
   `p_` arguments. The function that is actually in sql/038 declares NINE, none
   of them with a default: p_hops, p_units, p_escort and p_client_ref as well.
   🔴 THE FILE ON DISK IS THE AUTHORITY, and the consequence of pretending
      otherwise is specific: PostgREST resolves an RPC by the EXACT SET of named
      arguments, so a five-key call against a nine-argument function is not a
      call with defaults — it is PGRST202, "could not find the function", which
      is indistinguishable from an unapplied migration and would send an admin
      to re-run sql/038 for the fifth time in this project's history. So all nine
      are sent, always.
   `route` carries only what cannot be derived here: hops (routes.js owns the
   map; this file must not) and escort. Absent hops is NOT defaulted to 1 —
   price is base × units × hops, so a silent 1 would undercharge every long
   haul. It is sent as null and comes back as a legible `bad_hops` refusal.

   `units` is NOT taken from the caller even when offered: it is summed from the
   manifest, so the number that is priced and the number that leaves the stash
   are the same number. A units figure larger than the manifest charges for
   freight nobody handed over; a smaller one ships goods for free.

   NOTHING ELSE IS SENT. No price, no amount, no user id, no runs_used, no
   day_key, no reliability — the RPC takes ids and re-reads every one of those
   from rows it owns. sql/015's r9 settle is the counter-example this rule comes
   from: it inserted the client's payload verbatim, unbounded and unsigned, and
   two HTTP calls minted a billion Cinder.

   ⚠ A NULL carrierId IS MERIDIAN HAULAGE and is a supported call, not a bug.
     Meridian is a price CEILING at 2.5× the median tariff and 1.6× the trip
     time — ratified — so that a monopolist cannot end another player's game by
     refusing to serve them. It is never cheaper and never faster.

   🔴 THE OBJECT-FORM OVERLOAD, AND THE ONE THING IT WILL NOT GUESS.
      index.js's Dispatch button is holding a routes.js quote when it fires, so
      an object in first position is read as the whole request — cargo, from,
      to, rigId, carrierId. That only works because index.js merges the form it
      quoted ONTO the quote before calling. routes.js's own shape() carries NONE
      of those five: it is a price, not a manifest. It has `price`, `capped`,
      `hops`, `cargoUnits`, `etaText`, `riskPct` — every field needed to show a
      player a fare, and not one field saying what is on the truck.
      🔴 SO A BARE QUOTE IS REFUSED BY NAME, and this file does NOT pretend to
         absorb the drift. It cannot: absorbing it would mean inventing the
         freight — there is no map here, no resource picker, and no way to know
         which of the player's rigs was meant. What a bare quote used to do is
         the reason this branch exists: `normCargo(undefined)` returned {}, and
         the haul came back as `bad_cargo`, "there is nothing on that manifest
         to ship" — which blames the player for a form they filled in correctly
         and sends whoever debugs it to the resource picker, the one place the
         bug is not. That is the four-times bug of index.html:79918-79930 in
         miniature: a real, specific, fixable condition wearing a guessed cause.
         The branch below names the actual defect instead — the call site passed
         the quote rather than the request it quoted — because a wrong caller is
         something a developer can fix in one line and an empty manifest is not.
   ════════════════════════════════════════════════════════════════════════════ */
export async function dispatch(carrierId, rigId, fromNode, toNode, cargo, route) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();

  /* One object in first position is read as the whole request. `quoted` is
     kept rather than discarded because the units check further down needs the
     number the player was actually shown a price for. */
  let quoted = null;
  if (carrierId && typeof carrierId === 'object') {
    const q = carrierId;
    quoted = q;
    /* 🔴 A QUOTE IS NOT A REQUEST — see the header. Refused by its own name, so
       the message points at the call site instead of at the player's form. The
       test is on the FARE FIELDS, not on the absence of cargo alone: a caller
       who genuinely meant `dispatch({ cargo: {} })` has an empty manifest and
       should still hear `bad_cargo` below, which is a different bug with a
       different fix. Only an object that is recognisably one of routes.js's
       shapes AND carries no manifest lands here. */
    if (q.cargo == null && isQuoteShaped(q)) {
      return {
        ok: false, missing: false, offline: false, error: 'quote_not_request',
        why: 'That dispatch was handed a price quote instead of the haul it priced. A quote carries a fare, an ETA and a hop count — it carries no manifest, no origin and no rig, so there is nothing here to ship.',
        fix: 'Pass the request that was quoted: dispatch(carrierId, rigId, from, to, cargo, quote), or merge { from, to, cargo, rigId, carrierId } onto the quote before handing it over. This file will not fill them in — it has no map, no resource picker and no way to know which rig you meant.',
      };
    }
    route = route || q;
    cargo = q.cargo;
    toNode = q.to != null ? q.to : (q.toNode != null ? q.toNode : q.to_node);
    fromNode = q.from != null ? q.from : (q.fromNode != null ? q.fromNode : q.from_node);
    rigId = q.rigId != null ? q.rigId : q.rig_id;
    carrierId = q.carrierId != null ? q.carrierId : q.carrier_id;
  }
  route = route || {};

  const legs = normCargo(cargo);
  if (!Object.keys(legs).length) {
    return { ok: false, missing: false, offline: false, error: 'bad_cargo',
             why: 'There is nothing on that manifest to ship.', fix: 'Pick a resource and an amount.' };
  }
  const units = unitsOf(legs);

  /* 🔴 THE MANIFEST MAY NOT BE BIGGER THAN THE LOAD THE PLAYER AGREED TO PAY
     FOR. The confirm dialog quotes a fare for `cargoUnits`; the server prices
     from `p_units`, which is summed from the manifest. Those are the same
     number on every path index.js takes today — but if they ever drift apart
     the player is charged for a load they never saw a price for, and they
     already pressed Yes. Refusing costs one re-quote; the alternative is a
     silent overcharge, which is the failure this whole file is arranged around.
     ⚠ ONLY THE OVER direction is refused. A manifest SMALLER than the quote is
       a smaller haul at a smaller price — the server re-derives the fare from
       what actually ships, so the player is charged less than they agreed to,
       and refusing that would be refusing a haul in the player's favour. */
  const quotedUnits = quoted ? Math.floor(Number(quoted.cargoUnits)) : NaN;
  if (Number.isFinite(quotedUnits) && quotedUnits > 0 && units > quotedUnits) {
    return {
      ok: false, missing: false, offline: false, error: 'manifest_exceeds_quote',
      why: 'That manifest is ' + n(units) + ' units but the price you approved was quoted for ' + n(quotedUnits) + '. The exchange bills what actually ships, so sending it would charge you more than you agreed to.',
      fix: 'Re-quote the haul at ' + n(units) + ' units and confirm the new fare. Nothing was charged and no cargo has moved.',
    };
  }

  const hopsRaw = Math.floor(Number(route.hops));
  const hops = (Number.isFinite(hopsRaw) && hopsRaw > 0) ? hopsRaw : null;

  /* THE ESCROW. Every leg is verified before anything is deducted, then the
     manifest leaves the stash. It has to happen on this side: sql/038's header
     publishes the limit plainly — cargo lives in a client save blob, so the
     server "can only BOUND a haul, not recompute one", and a manifest nobody
     debited is freight the shipper never actually had. */
  const held = takeRes(b, legs, 'that haul');
  if (!held.ok) return { ok: false, missing: false, offline: false, error: held.code, why: held.why, fix: held.fix };

  try {
    const r = await rpc(c, 'transport_dispatch', {
      p_carrier_id: carrierId || null,
      p_rig_id: rigId || null,
      p_from_node: fromNode == null ? null : String(fromNode).slice(0, 40),
      p_to_node: toNode == null ? null : String(toNode).slice(0, 40),
      p_hops: hops,
      p_units: units,
      p_cargo: legs,
      p_escort: !!route.escort,
      /* The retry guard. sql/038 is explicit that a caller sending no ref gets
         "no retry protection at all": a dispatch that succeeded server-side and
         lost its answer on the way home would sell the shipper a second haul.
         One id per attempt, minted here, so a resend of THIS call matches. */
      p_client_ref: String(route.clientRef || route.client_ref || newRef()).slice(0, 64),
    });

    if (!r.ok) {
      // The RPC refused. The cargo never left, so put it back — uncapped, in
      // reverse — and hand the caller the reason it gave.
      held.refund();
      return r;
    }

    /* 🔴 A RETRY MUST NOT ESCROW THE CARGO TWICE.
       transport_dispatch is idempotent on `client_ref`: a call whose answer was
       lost on the way home and is sent again gets the SAME contract back with
       `retried: true`, and is charged nothing more. But the escrow above ran
       BEFORE the RPC on both attempts, so by here the manifest has left the
       stash a second time for a haul that was already loaded. The server's
       idempotence protects the Cinder; nothing but this line protects the
       goods. Hand them back — and note that the ordinary double-CLICK is a
       different event that does not reach here, because each attempt mints its
       own ref and therefore buys its own haul. */
    if (r.data && r.data.retried === true) held.refund();

    /* 🔴 RECORDING THE ESCROW, AND THE ONE PLACE THIS FILE MUST NOT UNWIND.
       Past this line the contract EXISTS and wallet_charge has already taken
       the fee, so a refused save is not a failed haul and must never be
       reported as one. The obvious shape — persist(); catch; refund(); "the
       haul did not go out" — would print a sentence that is simply false about
       a contract the player is holding, and would hand back cargo they are also
       paying to have moved. So the failure is REPORTED, loudly, and the haul is
       still ok:true. The direction it fails in is the player's favour: the
       deduction is in memory only, so a reload brings the cargo back. */
    let warn;
    try {
      persist(b);
    } catch (e) {
      warn = 'The haul is booked and paid for, but the manifest did not save — your cargo may reappear after a reload.';
      try { b.toast('⚠ ' + warn, 7000); } catch (e2) {}
    }

    /* ⚠ THE HONEST LIMIT OF THE REFUND HANDED BACK HERE. cost.js returns its
       closure on success so a caller that fails while RECORDING a purchase can
       still unwind, and that is why this one is returned too — but it unwinds
       the CARGO ONLY. By this line the contract exists and the fee has been
       charged by wallet_charge inside the RPC, and no client can undo a
       server-side charge: the only function that mints Cinder credits
       auth.uid(), and sql/034's own header calls it "NOT the real fix". So
       calling refund() after a successful dispatch returns the goods to a
       shipper who is also holding a paid contract to move them. It is here for
       a failed local record, not as a cancellation. */
    const d = r.data;
    return {
      ok: true, row: d, contractId: d.contract_id, price: d.price, capped: !!d.capped,
      arriveAt: d.arrive_at, etaMinutes: d.eta_minutes, riskPct: d.risk_pct,
      retried: !!d.retried, refund: held.refund, warn: warn,
    };
  } catch (e) {
    held.refund();
    const f = fail(e);
    return { ...f, row: null, why: 'The haul did not go out and the cargo was returned. ' + f.error.slice(0, 180) };
  }
}

/* A per-attempt id for the retry guard. crypto.randomUUID is used when it
   exists and the fallback is not cryptographic — it does not need to be. Its
   only job is to be distinct from every OTHER dispatch this player makes, and a
   collision would be refused by the unique index rather than double-charge. */
function newRef() {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (e) {}
  return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ════════════════════════════════════════════════════════════════════════════
   SETTLE — the haul lands, and the cargo comes off the truck.

   The OUTCOME is rolled server-side against the risk_pct the server itself
   wrote at dispatch, and the payout is an append-only transport_ledger row
   credited to the carrier's COMPANY. This function moves no Cinder, in either
   direction, and must not be made to (see the header).

   What it does move is the shipper's cargo, which was escrowed at dispatch.
   Three rules, and each one is a hole if it is dropped:

   🔴 ONLY THE SHIPPER IS CREDITED. Either party may settle — arrival is
      offline-safe and whoever logs in first should be able to close the haul —
      so a carrier settling a stranger's contract must not receive that
      stranger's freight into their own stash. The contract row is read first,
      for `shipper_id` and `cargo`, precisely so this can be checked; the RPC's
      own answer does not carry either.

   🔴 A RETRY CREDITS NOTHING. transport_settle is idempotent and answers an
      already-settled contract with `retried: true` rather than an error, which
      is what makes a double-click harmless server-side. Crediting on that
      branch would make the SAME double-click a duplication exploit: click
      settle twice, receive the cargo twice.

   ⚠ THE CREDIT IS NOT TRANSACTIONAL WITH THE SETTLEMENT, and cannot be made so
     from here. The ledger is server-side, the stash is a client blob, and there
     is no third place to write "paid but not yet delivered". A tab closed in
     the gap between the RPC returning and addRes landing loses that cargo, and
     the retry branch above means the next settle will not re-credit it.
     Rejected alternative: credit on every settle including retries, which
     trades a rare loss for a repeatable exploit. Recorded, not fixed.

   🔴 THE CREDIT USES addRes, NOT refundRes — the exact opposite of the escrow's
      unwind, and deliberately. This is a PAYOUT, not an undo: the goods have
      been in transit, the stash cap applies, and a delivery that overflows a
      full vault is a smaller delivery. refundRes bypasses the ceiling, which is
      right only for units the player held moments ago.
   ════════════════════════════════════════════════════════════════════════════ */
export async function settle(contractId) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  if (!contractId) {
    return { ok: false, missing: false, offline: false, error: 'no_contract',
             why: 'That contract has no id.', fix: 'Refresh the depot.' };
  }
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }

  try {
    // Read BEFORE settling. After the RPC the row's status has already moved,
    // and the cargo manifest is the only record of what was escrowed.
    let manifest = {}, shipper = null;
    const pre = await c.from('transport_contracts')
      .select('id,shipper_id,cargo,status').eq('id', contractId).maybeSingle();
    if (pre.error) return { ...fail(pre.error), row: null };
    if (pre.data) { manifest = normCargo(pre.data.cargo); shipper = pre.data.shipper_id; }

    const r = await rpc(c, 'transport_settle', { p_contract_id: contractId });
    if (!r.ok) return r;

    const d = r.data;
    let delivered = 0;
    const refused = [];
    if (d.status === 'delivered' && d.retried !== true && shipper && uid && shipper === uid) {
      for (const id in manifest) {
        /* 🔴 WHAT LANDED IS MEASURED, NEVER ASSUMED FROM THE REQUEST — and a
           driven test is why this line looks like this. addRes is CAPPED and
           returns a boolean, so a vault with room for 10 of a 40-unit delivery
           adds 10 and answers `true`. Counting the request instead of the delta
           made `delivered` read 40, the shortfall read 0, and 30 units vanished
           with the player told nothing. A boolean cannot say how much a capped
           add took; the ledger's own before/after can. */
        let before = 0, after = 0;
        try {
          before = b.getRes(id) | 0;
          // The boolean still matters: `false` means the stash REFUSED the leg
          // outright, which is a different sentence from "it took what it could".
          if (b.addRes(id, manifest[id]) === false) refused.push(id);
          after = b.getRes(id) | 0;
        } catch (e) { after = before; refused.push(id); }
        delivered += Math.max(0, after - before);
      }
      try { persist(b); } catch (e) {
        // The goods are in memory but not on disk. Say so — silence here is the
        // swallowed-save class of bug this project has shipped repeatedly.
        try { b.toast('⚠ The delivery did not save. Reopen the depot before closing the tab.', 6500); } catch (e2) {}
      }

      /* addRes is CAPPED, so a full vault swallows part of a delivery and
         reports nothing. That has to be visible: "where did my cargo go" is not
         a question a player should have to take to the console. This is the
         same cap that makes addRes the wrong call for a refund — here it is
         the right one, and this line is what makes its cost legible. */
      const short = unitsOf(manifest) - delivered;
      if (short > 0) {
        try {
          b.toast(refused.length
            ? '📦 The stash refused ' + refused.join(', ') + ' — ' + n(short) + ' units of the delivery had nowhere to go.'
            : '📦 The stash is full — ' + n(short) + ' units of the delivery had nowhere to go.', 6500);
        } catch (e) {}
      }
    }

    return {
      ok: true, row: d, status: d.status, amount: d.amount, retried: !!d.retried,
      carrierBalance: d.carrier_balance, delivered: delivered,
      why: d.status === 'lost'
        ? 'The haul was lost on the road. A lost haul is not refunded — that is what reliability and escorts are for.'
        : undefined,
    };
  } catch (e) { return { ...fail(e), row: null }; }
}

/* ════════════════════════════════════════════════════════════════════════════
   REPAIR — one rung up the condition ladder, paid for on this side.

   THE ONLY CINDER SPEND IN THIS FILE, and it is shaped exactly like
   corpTreasuryDeposit() (index.html:79679-79699), which is this repo's settled
   answer to "spend, then write": confirm → spendGems with its RETURN VALUE
   CHECKED → the server call → on failure, put the money back and toast the REAL
   error. Never the raw arithmetic next door at index.html:196020
   (`ppBuyVehicle`), which subtracts from the balance directly and so bypasses
   whatever the real spend path does about persistence and tax exemption — the
   sibling bug at index.html:195546-195549 is a misspelled helper that "ALWAYS
   took the raw-subtraction fallback below and bypassed the real spend path".

   ORDER OF THE LEGS, and it is the reverse of cost.js's for a reason. cost.js
   spends resources first and Cinder last because Cinder is the leg that can
   fail for outside reasons. Here the parts leg is local and the Cinder leg is
   local, but the leg that can fail for outside reasons is the RPC — a rig
   already at Pristine, a rig mid-haul, the daily repair cap — so BOTH local
   legs are taken first and the RPC is last. Everything unwinds if it refuses.

   The refund for Cinder goes through addGems WITH A NAMED REASON, and the
   reason is not decoration: every faucet used to land in the wallet ledger as
   an anonymous blob, so the supply could not be audited — production showed
   +602,357 🔥 of reconcile gains in one week with nothing attributing a single
   unit to a source. A named reason per faucet is the prerequisite for ever
   noticing abuse. (Cinder has no ceiling, which is why addGems is a true undo
   here while addRes would not be for resources.)
   ════════════════════════════════════════════════════════════════════════════ */
export async function repair(rigId) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  if (!rigId) {
    return { ok: false, missing: false, offline: false, error: 'no_rig',
             why: 'That rig has no id.', fix: 'Refresh the yard.' };
  }

  const bill = repairBill(b);
  if (!bill.ok) return { ok: false, missing: false, offline: false, error: bill.code, why: bill.why, fix: bill.fix };

  // ── Phase 1: verify every leg. Nothing has moved.
  const have = b.gems() | 0;
  if (have < bill.cinder) {
    return { ok: false, missing: false, offline: false, error: 'insufficient_cinder',
             why: 'That repair costs ' + n(bill.cinder) + ' 🔥 and you have ' + n(have) + '.',
             fix: 'Nothing was charged.' };
  }
  const parts = takeRes(b, bill.parts, 'that repair');   // verifies before deducting
  if (!parts.ok) return { ok: false, missing: false, offline: false, error: parts.code, why: parts.why, fix: parts.fix };

  // ── Phase 2: the Cinder leg. spendGems re-checks the balance and CAN still
  //    say no — a concurrent tab, a server wallet reconcile — which is exactly
  //    the failure the parts refund above exists for.
  if (!b.spendGems(bill.cinder)) {
    parts.refund();
    return { ok: false, missing: false, offline: false, error: 'spend_refused',
             why: 'The wallet refused ' + n(bill.cinder) + ' 🔥 — every part taken was refunded.',
             fix: 'Reopen the depot and try again.' };
  }

  // One closure that unwinds BOTH legs, in reverse, so there is a single thing
  // to call on every failure path below instead of three near-copies.
  const unwind = () => {
    let back = false;
    try { back = (b.addGems(bill.cinder, 'transport_repair_refund') !== false); } catch (e) { back = false; }
    if (!back) {
      // A Cinder refund the wallet refused is money the player is owed. Silence
      // here would be the swallowed-persist bug wearing a refund's clothes.
      try { b.toast('⚠ ' + n(bill.cinder) + ' 🔥 could not be refunded. Tell an admin before spending anything else.', 8000); } catch (e) {}
    }
    parts.refund();              // saves and reports on its own behalf
    saveRefund(b, 'The repair bill');
    return back;
  };

  try {
    persist(b);                              // a refused save unwinds, it does not ship
    const r = await rpc(c, 'transport_repair', { p_rig_id: rigId });
    if (!r.ok) { unwind(); return r; }
    const d = r.data;
    return {
      ok: true, row: d, condition: d.condition, was: d.was, spent: bill.cinder,
      // On success the caller may still fail while recording; both legs are
      // local here, so unlike dispatch this closure is a complete undo.
      refund: unwind,
    };
  } catch (e) {
    unwind();
    const f = fail(e);
    return { ...f, row: null, why: 'The repair did not happen and the bill was refunded. ' + f.error.slice(0, 180) };
  }
}
