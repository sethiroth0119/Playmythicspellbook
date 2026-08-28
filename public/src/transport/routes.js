/* ════════════════════════════════════════════════════════════════════════════
   🗺 TRANSPORT — ROUTES & PRICING. Hops, reach, the quote, and the ceiling.
   ----------------------------------------------------------------------------
   Spec: docs/transport-company-design.md. This is the arithmetic half of
   Transportation Companies and NOTHING ELSE: how far apart two nodes are,
   whether a carrier's depot reaches both ends, what a haul costs, how long it
   takes, how dangerous it is, and what the NPC carrier charges.

   TWO CONSUMERS, and they want different things from the same numbers:
     • src/transport/index.js + depot.render.js — the depot panel. tariffCap()
       draws the Meridian row on the rate board; quote()/meridianQuote() sit
       behind the two quote buttons and every figure in the quote sheet
       (depot.render.js:777-822 reads price/tariff/cap/unit/hops/hopsKnown/
       runs/etaText/riskPct/capped) comes from here.
     • sql/038's transport_quote() / transport_dispatch() — THE AUTHORITY. The
       server re-derives the median, the price, the ETA and the risk and charges
       what IT computes. transport_dispatch does not even price: it calls
       transport_quote (sql/038:954) and inserts that number.

   🔴 SO THIS FILE IS INSTANT FEEDBACK, NOT A SECOND PRICING AUTHORITY, and
   sql/038:640-648 says why in its own words — the client is REVOKED from
   reading transport_config precisely because "a client which reads the ceilings
   acquires a SECOND copy of the pricing authority and will eventually disagree
   with the first." Same discipline CLAUDE.md records for chat, where the client
   keeps its profanity list "purely as instant feedback" and never as
   enforcement. Every number below is therefore a HAND-COPIED MIRROR of a
   server default, and the DRIFT LEDGER immediately after this header is the
   only thing standing between that mirror and the worst bug class this repo
   has: shown one price, billed another.

   🔴 IT MUST DEGRADE TO NOTHING. A player with no carrier, no depot, no map
   and no rate board must get exactly today's behaviour — node→camp freight the
   way it already works. So every export here is PURE and TOTAL: no async, no
   await, no I/O, no clock, no randomness, no throws, and not one reference to
   the legacy file's top-level `const` bindings (the globals trap, CLAUDE.md —
   they are lexical, they are not properties of the global object, and this has
   already cost this project real time twice). Everything arrives as arguments.
   This file is imported on every page load; a throw here would take a 223k-line
   app down over a freight quote.

   ⚠ NOTHING IS PUBLISHED ON THE GLOBAL OBJECT FROM HERE, deliberately, unlike
   src/nodes/tiers.js. index.js already re-exports these under its own bridge
   (`routes: { … }`, index.js:814). Two publication sites is two copies of the
   ceiling that can drift, and a rate board where the NPC undercuts the ceiling
   it defines is not a display bug, it is a free-transport exploit.

   ⚠ A REFUSAL IS AN OBJECT, NOT A NULL. Callers must test `q.ok`, not `q`.
   Every path returns the same shape; a refusal carries `code`, `serverCode`,
   `reason`, `fix`, and `price: null` so nothing formats it as a real price.
   index.js:653 currently tests truthiness and will therefore render the refusal
   in the quote panel instead of toasting it — that is the safe direction (the
   reason is on screen either way, and dispatch refuses server-side regardless),
   but it is drift and it is written down here rather than left to be
   discovered. Returning null would make the panel say nothing at all, and
   "nothing happened when I clicked Quote" is the least debuggable report a
   player can file.
   ════════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════════
   📋 DRIFT LEDGER — THIS FILE vs sql/038_transport_companies.sql
   ----------------------------------------------------------------------------
   sql/038 is the authority (its own words, sql/038:674-682: "transport_quote —
   THE ONE PRICING AUTHORITY… two copies of a price formula is two authorities,
   and the day they drift the player is shown one number and billed another").
   This block is the reconciliation, item by item, with the server line beside
   each one. An earlier revision of this file disagreed with 038 in five places
   and said nothing about any of them; those five are marked FIXED below with
   what they used to print, because a silently corrected divergence teaches
   nobody why the number moved.

   ── AGREED, and checked line by line ──────────────────────────────────────
   A1 CEILING RATE   client ceilingRate() = median × 2.5, UNROUNDED, then the
                     whole fare gets ONE ceil().
                     server sql/038:760-761 `v_mer_base := coalesce(v_median,
                     meridian_base_floor) * meridian_tariff_mult;
                     v_mer_price := ceil(v_mer_base * v_units * v_hops)`.
                     ⚠ FIXED — this used to be `ceil(median × 2.5)` and THEN
                     ceil the fare, i.e. it rounded twice. At median 41, 100
                     units, 5 hops it printed 51,501 against a server charge of
                     51,250, and the old comment claimed rounding up "can only
                     ever over-quote by <1 Cinder". It was out by 251.
   A2 MEDIAN        both take the true median (even counts average the two
                     middle values). percentile_cont(0.5) interpolates
                     linearly, which for the midpoint IS that average.
                     server sql/038:754-758.
   A3 PLAYER FARE   ceil(base × units × hops × (1 + escort_pct/100)).
                     server sql/038:816.
   A4 THE CAP       the PRICE is clamped to the Meridian price — not the tariff.
                     server sql/038:824-828.
                     ⚠ FIXED — this used to clamp the TARIFF (`min(asked, cap)`)
                     and then apply the escort surcharge on top, so an escorted
                     at-ceiling haul printed 1.25× the price the server charges.
   A5 HOP BOUND     the ladder's top rung is 5 and max_hops is 6, so every rung
                     this file can produce is dispatchable.
                     server sql/038:435 + 733-736 (`bad_hops`).
                     ⚠ COUPLED: raise HOP_CROSS_REGION above 6 and every
                     cross-region quote this file prints becomes undispatchable.

   ── DIVERGENT ON PURPOSE, and the direction is stated ─────────────────────
   D1 REACH         server sql/038:795-799 bounds the HOP COUNT against
                     `3 + depot_level`; it cannot check WHERE the endpoints are,
                     because there is no adjacency table in that database. This
                     file has the node list, so it checks both — the depot's
                     distance to each endpoint AND the server's own hop bound —
                     and refuses if either fails. Deliberately STRICTER: the
                     client must never quote a route dispatch will refuse. The
                     reverse (client permissive, server strict) is a confirm
                     dialog followed by an error, which is the shape players
                     report as "it took my Cinder" even when it did not.
   D2 BLACKLIST     server checks it in transport_dispatch (sql/038:995), not in
                     transport_quote — the board deliberately does not publish
                     who has refused whom (contracts.js:657-662). When the
                     caller already knows (they were refused once), this file
                     refuses at quote time and points at Meridian. Earlier than
                     the server, never later.
   D3 MEDIAN SAMPLE server medians EVERY open carrier with base > 0. The client
                     medians what listCarriers() handed it, which is `status =
                     'open'` but capped at 60 rows ordered by reliability
                     (contracts.js:663-671). Identical at ≤60 carriers; past 60
                     the client's ceiling is drawn from the 60 most reliable.
                     Live population is 22 players, so this is a bound on a
                     future, not a current, disagreement.
   D4 FLOOR         server `coalesce(v_median, meridian_base_floor)` — the floor
                     applies ONLY when there is no median at all. This file does
                     the same. It does NOT raise a genuine low median up to 40;
                     an earlier draft's `max(40, median)` would have printed a
                     ceiling 4× the server's on a board whose median is 10.

   ── FIXED, and what they used to be ───────────────────────────────────────
   F1 RISK          was: base 30 + 4/hop, escort −22 points, clamp [4,95].
                     A 1-hop haul printed 30% and booked a 4% contract.
                     now: least(max_risk_pct 45, ceil(hops × risk_pct_per_hop
                     4)), escort as a MULTIPLIER ×(100−60)/100, no base term.
                     server sql/038:767 and 813.
   F2 ETA           was: 120000 ms per hop ÷ rig speed, × a client-invented run
                     count. A 5-hop haul showed "10m" and ran 125 minutes.
                     now: hops × minutes_per_hop (25); Meridian
                     ceil(hops × 25 × 1.6). Rig speed is NOT applied — see R1.
                     server sql/038:817 and 762.
   F3 SAME NODE     was: priced, ok, "a same-node haul still bills one hop".
                     server sql/038:745 refuses `same_node` outright, and would
                     refuse it again at sql/038:733 because contracts.js:963
                     sends hops 0 as a null p_hops. So the old path priced a
                     route the server would never dispatch, twice over.
                     now: a refusal in BOTH quote() and meridianQuote().
   F4 MERIDIAN EDGE was: an output guard that bumped the NPC to `refPrice + 1`,
                     where refPrice was character-for-character the expression
                     that had just produced the NPC's price. It could detect
                     nothing and it fired on EVERY quote — 51,501 shown against
                     a 51,250 charge. now: no output price guard at all. A tie
                     is the server's own ratified outcome (sql/038:820-823, "at
                     equal price they are 1.6x faster and can sell an escort"),
                     the never-cheaper property is the clamp in quote(), and the
                     guard that remains sits on the MULTIPLIERS where a bad
                     value can actually be detected. See tariffMultOf().
   F5 ESCORT        was: a flat 25% surcharge invented here.
                     now: the carrier's own `tariff->>'escort_pct'`, clamped
                     0..100, defaulting to 0 exactly as the server's coalesce
                     does. server sql/038:812.

   ── REPORTED BUT NOT APPLIED ──────────────────────────────────────────────
   R1 rigSpeed, rigCargo, rigRisk are in the pinned input contract and are
      resolved and RETURNED, but none of them changes a price, an ETA or a risk,
      because sql/038 reads none of them: transport_rigs (sql/038:252-292) has
      runs_cap, rarity and condition — there is no speed column, no cargo
      capacity column and no risk column, and transport_quote's signature
      (sql/038:694-701) has no rig parameter at all. Applying any of them here
      would print a number the contract row cannot contain. They are returned
      so a caller can show the rig it picked; they are not multiplied into
      anything. Read riskPoints() before ever wiring rigRisk up — the unit trap
      documented there is live.
   R2 RUNS is 1, always. One dispatch claims exactly one run
      (sql/038:1027-1029, `runs_used + 1`) regardless of tonnage, and units are
      bounded only by max_units_per_contract. The old runsNeeded() split a
      manifest into 20-unit runs and multiplied the ETA by the count; nothing
      server-side has ever had that concept.

   ⚠ HOW THIS LEDGER GOES STALE, and it is the only way: sql/038 changes and
   nobody re-reads this block. There is no automated check and there cannot be
   one from this side — sql/038:648 revokes `select` on transport_config from
   `authenticated`, so this file can never read the live ceilings to compare.
   What IS available is transport_quote's own reply: it returns price,
   eta_minutes, risk_pct, capped and hops. A caller that has made the round trip
   should PREFER those numbers over these, and contracts.js already does — it
   sends ids and a manifest and takes the server's price back.
   ════════════════════════════════════════════════════════════════════════════ */


/* 🚦 THE GATING LADDER — PHASE 1 SHIPS, AND ONLY PHASE 1.
   Hiring a carrier is a BONUS: bigger loads, lower risk, faster. A player who
   hires nobody is not penalised by one line in this file, and there is no code
   path in it that can reach a penalty. Promotion criteria, so whoever raises
   this number knows what they are claiming:
     Phase 2 — soft gate. Unhired freight runs as 'Hand-hauled': 35% cargo,
               +25 risk points, 1.6× trip. Painful, never fatal.
               SHIPS AT: ≥3 active carriers.
     Phase 3 — hard gate. Long-haul (2+ hops) requires a carrier; LOCAL 1-HOP
               STAYS HAND-HAULABLE FOREVER, so no one can be cut off entirely.
               SHIPS AT: ≥5 carriers covering ≥80% of live node pairs.
   The measured population when this was written was 22 players and 4 node
   owners, so Phase 2's precondition cannot be true on day one — this is not a
   guess about the population, it is the reason the ladder exists at all.
   ⚠ The 35 / +25 / 1.6 above are the SPEC, not constants: they are written in
   prose precisely so that no import of this module can apply them by accident.
   ⚠ And it is not this file's gate to apply anyway: whatever Phase gets to,
   the player's own squad leaving on a scout/raid/deep-run is NOT cargo and is
   never gated by freight. */
export const PHASE = 1;

/* 🚚 MERIDIAN HAULAGE — the NPC carrier. RATIFIED, SETTLED, NOT A BALANCE KNOB.
   It exists because of one failure mode: a sole carrier can set an infinite
   price, or simply refuse to serve someone they are at war with, and that
   player's game is over through no action of their own. Meridian removes the
   kill switch while leaving the power intact — it is a PRICE CEILING, not a
   bypass. A monopolist can charge 2.4× the median and get rich.

   🔴 REJECTED: giving Meridian a depot and a radius like everyone else, so the
   NPC "plays by the same rules". Rejected because the moment the NPC has a
   reach, there exists a node pair with zero carriers — which is precisely the
   lockout it was added to make impossible. Meridian has no depot, is never
   reach-checked, and never appears or disappears with the rate board. Its
   coverage is 100 by construction, not by having built anything. The server
   agrees structurally: p_carrier_id null is the Meridian branch and it returns
   before the reach check ever runs (sql/038:770-782).
   🔴 REJECTED: making Meridian *unavailable* for illicit freight by leaving it
   off the board. It refuses that one cargo class WITH A REASON AND A FIX (see
   meridianQuote) instead of vanishing, because a carrier that silently is not
   there is indistinguishable from a broken rate board. */
export const MERIDIAN = {
  id: 'meridian',
  name: 'Meridian Haulage',
  npc: true,
  escort: false,        // no escorts, ever — that is the player business's edge
  illicit: false,       // and no illicit freight; a player carrier is that channel
  reliability: 100,     // it is the NPC; it does not miss a contract
  coverage: 100,        // every node pair, always — see the rejection above
  depot: null,          // deliberate: no origin, therefore no reach to fall outside
};

/* 2.5 and 1.6 EXACTLY, ratified by the owner and quoted from the design doc:
   "Always available, deliberately bad — 2.5× the median player tariff, 1.6×
   trip time, no escort, no illicit freight."
   They are named constants and not tunables with a default elsewhere because
   they are not a balance dial: 2.5 IS the ceiling every player price is clamped
   to, so moving it moves what every carrier in the game may charge.
   These two are the ONLY numbers in this file that are not merely mirrored from
   sql/038 but ratified independently of it — they appear there as
   transport_config.meridian_tariff_mult / meridian_time_mult (sql/038:429-430)
   with the same defaults, and if either ever changes it changes in both places
   in the same commit, or the client shows a ceiling the server does not
   enforce. */
export const MERIDIAN_TARIFF_MULT = 2.5;
export const MERIDIAN_TIME_MULT = 1.6;

/* ── THE SHEET: a hand-copied mirror of transport_config's DEFAULT clauses ───
   ⚠ CLAUDE.md: "All operation pricing goes through _opEcon(). Never hardcode
   economy numbers." That rule governs the BUSINESS — the transport charter's
   startup, rate and salary live in OPS_ECON (index.html:79732) and only there,
   and sql/038:401-407 makes the same split from its own side ("NO PRICING LIVES
   HERE"). This file prices FREIGHT, which OPS_ECON has no concept of. The
   tariff and the median arrive as ARGUMENTS. What is left below is the set of
   BOUNDS the server owns, one line per transport_config column, cited.

   🔴 AND IT CAN NEVER BE FETCHED. sql/038:648 revokes `select` on
   transport_config from `authenticated`, on purpose, so that a client cannot
   acquire a second copy of the pricing authority. That means `input.sheet`
   below is A TEST SEAM AND NOTHING ELSE — there is no runtime path that can
   populate it, and none should be built. It exists so the divergence cases in
   the ledger above can be driven from a test without a database, and so that a
   future admin retune has one obvious place to be re-copied INTO by a human who
   has read both files. Anyone tempted to wire it to a live config row should
   read sql/038:640-648 first.

   PROVENANCE: every value is the DEFAULT of the named column, transcribed
   2026-08-28 from sql/038 at the line given. Nothing here is a guess, and
   nothing here is measured either — they are the server's numbers, and the
   server is where they get argued about. */
const SHEET = {
  minutesPerHop: 25,           // transport_config.minutes_per_hop        sql/038:448
  riskPctPerHop: 4,            // transport_config.risk_pct_per_hop       sql/038:449
  escortRiskCutPct: 60,        // transport_config.escort_risk_cut_pct    sql/038:450
  maxRiskPct: 45,              // transport_config.max_risk_pct           sql/038:451
  meridianBaseFloor: 40,       // transport_config.meridian_base_floor    sql/038:434
  meridianTariffMult: MERIDIAN_TARIFF_MULT,  // transport_config.meridian_tariff_mult sql/038:429
  meridianTimeMult: MERIDIAN_TIME_MULT,      // transport_config.meridian_time_mult   sql/038:430
  maxHops: 6,                  // transport_config.max_hops               sql/038:435
  maxUnits: 5000,              // transport_config.max_units_per_contract sql/038:436
  maxTariffPerUnitHop: 500,    // transport_config.max_tariff_per_unit_hop sql/038:437
  maxPricePerContract: 5000000,// transport_config.max_price_per_contract sql/038:444
  escortPct: 0,                // the coalesce default at sql/038:812 — an unset
                               // sheet sells escorts for nothing, and matching
                               // that beats inventing a surcharge the server
                               // will not charge (drift F5)
};

/* ── total helpers. None of these can throw. ────────────────────────────────*/
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); }
function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
function idOf(v) { return (v === undefined || v === null) ? '' : String(v); }

/* Merges over SHEET key by key rather than spreading, so a caller handing over
   a partial or junk-valued object cannot delete a bound. A missing key keeps
   the mirrored default; a non-finite value keeps it too. */
function sheetOf(input) {
  const s = input && input.sheet;
  if (!s || typeof s !== 'object') return SHEET;
  const out = {};
  for (const k of Object.keys(SHEET)) out[k] = Number.isFinite(Number(s[k])) ? Number(s[k]) : SHEET[k];
  return out;
}

/* ═══ ADJACENCY ═════════════════════════════════════════════════════════════
   🔴 THE HOP LADDER LIVES HERE AND NOWHERE ELSE.

   The caller hands us a FLAT ARRAY of `{ id, name, regionId, parentId?,
   resourceYield }` from the bridge's twNodes(). That array carries exactly two
   structural facts — the sql/033 main/town hierarchy (`parentId`) and the
   Territory Wars region (`regionId`) — so this is a LADDER, not a metric. It is
   as fine-grained as the data allows and no finer:

     0  same node                                    — refused, not priced (F3)
     1  linked in the hierarchy: one is the other's  — a road exists
        parent, or they share a parent (siblings)
     2  same region, not directly linked             — you go via the region hub
     5  different regions, both known                — the cross-region trunk
    -1  either id is not in `nodes`, or `nodes` is   — THE UNREACHABLE SENTINEL
        missing/empty

   WHY 5 AND NOT 3 for the cross-region step, which is the only number here
   with a choice in it: it must exceed a level-1 depot's radius or REACH NEVER
   BINDS. The design doc's depot effect is `radius: 3 + lv` → 4 / 5 / 6, and
   sql/038:795 hardcodes the same `3 + coalesce(v_co.depot_level, 1)`. At 3 a
   level-1 yard would quote the entire planet, "no depot in reach of both
   endpoints" would be dead code, and the depot — the building this whole
   feature exists to plant — would decide nothing. At 5: L1 serves its own
   region, L2 reaches anywhere, and L3 buys bays and fleet cap rather than
   reach, which is the shape the doc wants ("more depots is the natural sink
   for a growing company").
   ⚠ AND 5 MUST STAY ≤ max_hops (6, sql/038:435). Above it, transport_quote
   refuses `bad_hops` and every cross-region fare this file prints becomes a
   confirm dialog followed by an error. Two couplings, neither tested: the depot
   effect in src/city/production.data.js, and that column.

   🔴 REJECTED: a real BFS over an optional `links`/edges array on each node,
   falling back to this ladder when absent. It is strictly better geometry and
   it loses anyway, because it would mean TWO adjacency rules that can
   disagree: the same route priced at 5 hops on a client whose node rows lack
   links and 3 on one whose rows have them — and sql/038 can only implement
   one of them. In fact it implements NEITHER: sql/038:686-691 records that
   "there is no adjacency table in this database", so hops arrives as a caller
   parameter and is merely BOUNDED. That makes this ladder the only adjacency
   rule in the system, which is an argument for it being simple and single, not
   for it being clever.

   A node with no `regionId` is treated as its own region, so it lands on the
   cross-region rung. Over-stating a distance costs a shipper a refusal with a
   reason (recoverable: take the NPC, or pick another carrier) or a dearer fare
   they can see before agreeing; under-stating one prices a haul below what it
   costs to run and the carrier eats it silently. And note which way the server
   leans on the same question: "A shipper inflating hops charges THEMSELVES
   more, which is the harmless direction" (sql/038:688-691). Refusals and
   over-charges are visible; a quiet loss is not. */
const HOP_SAME = 0;
const HOP_LINKED = 1;
const HOP_REGION = 2;
const HOP_CROSS_REGION = 5;
/* Deliberately NOT exported, though it is tempting. The export list of this
   module is a PINNED CONTRACT that other builders are importing right now, and
   a module does not get to widen a pinned contract on its own — the sentinel
   is documented instead, and every caller's guard is `h < 0`, which is the
   same test without the coupling. */
const HOP_UNREACHABLE = -1;

/* Built per call rather than cached. A cache keyed on the array identity would
   go stale the moment the bridge hands over a freshly fetched node list, and a
   stale MAP is a quote for a route that no longer exists. Node lists are tens
   of entries; this is not the expensive part of anything. */
function indexNodes(nodes) {
  const by = {};
  if (!Array.isArray(nodes)) return by;   // 🆓 no map at all is a real, handled state
  for (const n of nodes) {
    if (!n) continue;
    const id = idOf(n.id);
    if (id) by[id] = n;
  }
  return by;
}
function regionOf(n) {
  const r = n && n.regionId;
  return (r === undefined || r === null || r === '') ? null : String(r);
}
function parentOf(n) {
  const p = n && n.parentId;
  return (p === undefined || p === null || p === '') ? null : String(p);
}

/* Integer hop count between two nodes. Returns HOP_UNREACHABLE (-1) — never
   null, never a throw — when either id is unknown or `nodes` is missing. -1 is
   the sentinel BECAUSE it is arithmetically loud: it cannot be mistaken for a
   distance, and any price or duration derived from it comes out negative,
   which every guard below catches. A `null` would have coerced to 0 and
   quietly produced a free, instant haul. */
export function hops(fromId, toId, nodes) {
  const by = indexNodes(nodes);
  const a = by[idOf(fromId)];
  const b = by[idOf(toId)];
  if (!a || !b) return HOP_UNREACHABLE;
  const aid = String(a.id);
  const bid = String(b.id);
  if (aid === bid) return HOP_SAME;
  const ap = parentOf(a);
  const bp = parentOf(b);
  if (ap === bid || bp === aid) return HOP_LINKED;          // parent ↔ child
  if (ap && bp && ap === bp) return HOP_LINKED;             // siblings under one parent
  const ar = regionOf(a);
  const br = regionOf(b);
  if (ar && br && ar === br) return HOP_REGION;
  return HOP_CROSS_REGION;                                   // includes "region unknown"
}

/* 🆓 NO DEPOT IS FALSE, NOT TRUE. A carrier without a yard reaches nothing —
   that is the rule the whole building exists to enforce ("no depot in reach of
   both endpoints ⇒ you cannot quote that route", quoted verbatim by the server
   at sql/038:788-793, and it is what stops one player owning the planet from a
   single tile). Defaulting a missing depot to "reaches everything" would delete
   the feature and look like a null-check. A depot row with no `radius` and no
   `level` is the same case: reach 0, its own node only.
   Absence is never generosity here.

   ⚠ THIS IS THE STRICTER OF THE TWO REACH TESTS (drift D1). It asks where the
   endpoints actually are, which the server cannot: with no adjacency table it
   can only bound the route LENGTH against `3 + depot_level`. quote() applies
   BOTH, because the client must never print a fare that dispatch will refuse.

   🔴 THE PUBLIC EXPORT RESOLVES; THE TEST DOES NOT. This split is the fix for
   a real, shipped bug and it is written down so nobody re-merges the two.
   inReach() used to BE the test and called resolveDepot() itself, while
   resolveInput() had already resolved the same depot onto `q.depot`. quote()
   then handed that normalised object back in, resolveDepot() ran a second time
   over its own output — which publishes `reach`, not `radius` — found neither a
   `radius` nor a non-zero `level`, and returned reach 0. Both real call sites
   are exactly that shape (index.js:850 `{nodeId, radius, bays}` and index.js:829
   `Object.assign({nodeId}, depotEffect(level))`, neither of which carries
   `level`), so EVERY route of one hop or more was refused 'out-of-reach' by
   every carrier on the board.
   MEASURED, not theorised — the old resolver run twice over the index.js:850
   shape `{nodeId:'H1', radius:4, bays:2}`: first pass `reach:4`, second pass
   `reach:0`, identically for the depotEffect() shape. A 2-hop haul from a yard
   with a 4-hop radius came back 'out-of-reach', and the refusal text SAID
   "reaches 4 hops" — because that string reads `q.depot.reach` off the FIRST
   resolve while the decision came from the second. A feature that refuses
   everything and then explains itself with the right number is the hardest kind
   to catch by reading: the panel looks like a working reach rule enforcing a
   radius nobody can satisfy. It was caught by tracing the depot object the real
   call sites actually build, not by review.
   Two defences, because either alone would have been enough and neither was
   there: resolveDepot() is now idempotent (see its own comment), and the reach
   test takes a resolved depot so there is only ever one resolve per quote. */
export function inReach(depot, fromId, toId, nodes) {
  return reaches(resolveDepot(depot), fromId, toId, nodes);
}

/* The test itself, over an ALREADY-RESOLVED depot — the shape resolveDepot()
   returns, never a caller's raw row. Not exported: widening the pinned contract
   is not this module's call, and a second public entry point taking a different
   depot shape is how the two got confused in the first place. */
function reaches(d, fromId, toId, nodes) {
  if (!d || !d.present) return false;
  const a = hops(d.nodeId, fromId, nodes);
  if (a < 0 || a > d.reach) return false;
  const b = hops(d.nodeId, toId, nodes);
  if (b < 0 || b > d.reach) return false;
  return true;
}

/* ═══ THE CEILING ═══════════════════════════════════════════════════════════ */

/* The median of the live player tariffs. Accepts a list of numbers, a list of
   carrier rows with a numeric `tariff`, OR a list of raw sql/038 rows whose
   `tariff` is the jsonb sheet `{ base, escort_pct, illicit_pct }`
   (sql/038:201). ONE resolver serves all three call sites instead of three that
   can disagree about the ceiling: index.js:329 hands over a mapped array of
   numbers, the rate board holds rows, and listCarriers() (contracts.js:668)
   selects `tariff` unmapped, straight from the column.
   ⚠ That third shape is not hypothetical padding — `Number({base:41})` is NaN,
   so a resolver that only understood numbers would median an empty list, fall
   through to the floor, and draw a 100 🔥 ceiling on a board whose real one is
   102.5. It would look like a working feature.

   🔴 MEDIAN, NOT MEAN, AND THAT IS A SECURITY CHOICE. The mean is a one-line
   attack: list a second shell carrier at 9,999,999 and the ceiling you are
   capped by moves with it, which hands the monopolist back the infinite price
   this whole system was built to take away. A median needs a majority of the
   board to move. The server reasons identically at sql/038:747-753.
   ⚠ WHICH CARRIERS COUNT AS ACTIVE IS THE SERVER'S CALL, not this function's.
   It medians what it is handed; see drift D3 for the one case where the two
   samples differ. */
export function medianTariff(carriers) {
  const vals = [];
  if (Array.isArray(carriers)) {
    for (const c of carriers) {
      const t = baseRateOf(c);
      if (t > 0) vals.push(t);          // 0 / NaN / negative are not rates
    }
  }
  if (!vals.length) return 0;           // resolveMedian decides what 0 means
  vals.sort((x, y) => x - y);
  const mid = vals.length >> 1;
  // Even counts average the two middle values, which is exactly what
  // percentile_cont(0.5) interpolates to (drift A2).
  return (vals.length % 2) ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/* The one place a "tariff" of any shape becomes a number. Not exported: it is
   the inside of medianTariff() and resolveInput(), and two entry points to a
   unit conversion is how a jsonb column ends up read as a number in one place
   and an object in the other. */
function baseRateOf(c) {
  if (c === null || c === undefined) return 0;
  if (typeof c === 'object') {
    const t = c.tariff;
    if (t && typeof t === 'object') return num(t.base !== undefined ? t.base : t.rate, 0);
    if (t !== undefined && t !== null) return num(t, 0);
    if (c.base !== undefined) return num(c.base, 0);
    return 0;
  }
  return num(c, 0);
}
function escortPctOf(c, sheet) {
  const dflt = clamp(num(sheet.escortPct, 0), 0, 100);
  if (!c || typeof c !== 'object') return dflt;
  const t = c.tariff;
  if (t && typeof t === 'object' && t.escort_pct !== undefined) return clamp(num(t.escort_pct, dflt), 0, 100);
  if (t && typeof t === 'object' && t.escortPct !== undefined) return clamp(num(t.escortPct, dflt), 0, 100);
  if (c.escortPct !== undefined) return clamp(num(c.escortPct, dflt), 0, 100);
  return dflt;
}

/* 🆓 THE ONE PLACE THAT DECIDES WHAT "NO MEDIAN" MEANS, and it is load-bearing.
   Zero carriers is not a hypothetical, it is DAY ONE: the board is empty, the
   median is 0, and 0 × 2.5 is still 0. A ceiling of zero means Meridian hauls
   for free, which (a) is unlimited free logistics and (b) makes founding a
   carrier pointless forever, since no player can undercut free. So an absent,
   zero, negative or NaN median resolves to `meridianBaseFloor` — a real rate,
   never null and never zero. sql/038:431-433 states the same requirement in the
   same words: "With no open carrier there is no median, and Meridian must still
   quote."
   ⚠ THE FLOOR APPLIES ONLY WHEN THERE IS NO MEDIAN (drift D4). The server's
   `coalesce(v_median, meridian_base_floor)` does not raise a real low median up
   to 40, and neither does this. A previous draft's `max(40, median)` printed a
   ceiling of 100 where the server's was 25. */
function resolveMedian(medianTariff_, sheet) {
  const raw = Array.isArray(medianTariff_) ? medianTariff(medianTariff_) : baseRateOf(medianTariff_);
  const floor = Math.max(1, num(sheet.meridianBaseFloor, SHEET.meridianBaseFloor));
  return (Number.isFinite(raw) && raw > 0) ? raw : floor;
}

/* 🔒 THE DOMINANCE GUARD LIVES ON THE MULTIPLIERS, and this is the whole of it.
   The ratified property is that Meridian is never cheaper and never faster than
   a rational player quote. A multiplier at or below 1 does not merely weaken
   that — it inverts the system: at 0.9 the NPC undercuts the median, and since
   quote() clamps every player price down to the NPC's (sql/038:824-828), it
   would drag the entire market below the median rather than cap it. That is a
   price control, not a ceiling, and it is the one edit to SHEET that silently
   destroys the feature rather than mis-displaying it.

   So both multipliers are REFUSED here rather than trusted, and the ratified
   constants are substituted. `guarded` on a quote says it happened, which makes
   a tampered sheet a visible bug report instead of a slow economy collapse.

   🔴 AND THIS IS WHERE THE GUARD BELONGS, which took a wrong answer to learn.
   The previous revision guarded the OUTPUT instead: it recomputed "the best
   price a compliant player could offer" and bumped Meridian past it by 1
   Cinder. That reference was `fareOf(rate, units, h, 0)` — character for
   character the expression that had just produced Meridian's own price — so the
   comparison was an expression against itself, could never detect anything, and
   fired its +1 on EVERY quote: 51,501 on screen against a 51,250 charge at
   median 41 / 100 units / 5 hops. A guard that cannot fail is not a guard, and
   one that always fires is a bug wearing a guard's comment.
   The price relation needs no output guard because it is an IDENTITY, enforced
   one screenful down in quote(): `if (price > merPrice) price = merPrice`. Every
   player price is clamped to Meridian's, so Meridian is never strictly cheaper
   than any quote this module can produce — and a tie is the ratified outcome,
   sql/038:820-823, "at equal price they are 1.6x faster and can sell an
   escort." TIME is the axis nothing else enforces, so that one keeps an output
   check as well (see meridianQuote). */
function tariffMultOf(sheet) {
  const m = num(sheet.meridianTariffMult, MERIDIAN_TARIFF_MULT);
  return m > 1 ? m : MERIDIAN_TARIFF_MULT;
}
function timeMultOf(sheet) {
  const m = num(sheet.meridianTimeMult, MERIDIAN_TIME_MULT);
  return m > 1 ? m : MERIDIAN_TIME_MULT;
}
function multsTampered(sheet) {
  return num(sheet.meridianTariffMult, MERIDIAN_TARIFF_MULT) <= 1
      || num(sheet.meridianTimeMult, MERIDIAN_TIME_MULT) <= 1;
}

/* The UNROUNDED ceiling rate, in Cinder per unit·hop. Everything that prices a
   haul multiplies by this and rounds ONCE at the end, because that is the shape
   of sql/038:760-761 (drift A1). Rounding the rate first and the fare second
   compounds, and it compounds upward — the direction that shows the player a
   price above the one they are charged, which is a support ticket rather than a
   loss, but is still two numbers where there should be one. */
function ceilingRate(median, sheet) {
  return Math.max(0, median * tariffMultOf(sheet));
}

/* The tariff ceiling a carrier types against, rounded up for display.
   🔴 DISPLAY HALF ONLY. THE BINDING CAP IS SERVER-SIDE: sql/038's
   transport_quote() re-derives the median from the live rows and clamps the
   PRICE there (sql/038:824-828), and transport_dispatch() takes that number
   without recomputing it (sql/038:954-958). THAT is the authority. This number
   exists so the rate board can draw the ceiling row (index.js:329) and so a
   carrier typing a tariff gets instant feedback. A client that both quotes and
   clamps is a client that can be argued with.

   ⚠ TWO CEILINGS, and the lower one wins: the Meridian rate, and
   max_tariff_per_unit_hop (500, sql/038:437) which transport_quote applies to
   the carrier's own sheet at read time with `least(greatest(base, 0), 500)`
   (sql/038:804). A board that drew only the Meridian ceiling would invite a
   carrier to type 900 on a rich board and then quietly quote them at 500.

   ⚠ SINGLE ARGUMENT, deliberately, because that is the pinned contract and
   index.js:329 calls it with one. It therefore uses the module's mirrored
   SHEET, while quote()/meridianQuote() use the per-call sheet. If a test ever
   drives those with an overridden sheet, the board's ceiling row is the stale
   one — display drifting from display, which is the safe direction, and the
   dispatch price is unaffected either way.

   🔴 REJECTED: a soft cap — blending the carrier's asking rate with the ceiling
   (a max/min mix, or "charge over the cap and lose reliability"). Rejected on
   one operational ground: the cap's job is to bound the WORST CASE for a
   shipper with no alternative, and a blend has no worst case. A monopolist
   charging 40× under a blend still gets most of 40×, and the shipper still
   cannot afford to move their cargo. A hard ceiling is the only shape where
   "the most this can cost you" is a number anyone can state. The server rejects
   the other adjacent design at sql/038:820-823 — refusing an over-ceiling
   tariff instead of clamping it — because that "punishes the one party who
   cannot fix it", the shipper. */
export function tariffCap(medianTariff_) {
  const rate = ceilingRate(resolveMedian(medianTariff_, SHEET), SHEET);
  return Math.min(Math.ceil(rate), Math.ceil(num(SHEET.maxTariffPerUnitHop, 500)));
}

/* ═══ 🆓 THE ONE RESOLVER ════════════════════════════════════════════════════
   Every "no X" in this module is decided HERE and only here — resolveDepot(),
   resolveMedian() and resolveInput() below — so there is exactly one place to
   read when asking what an absent depot, an absent carrier, an absent rig or an
   absent map is worth:

     no nodes    → an empty index → every hops() is -1 → a refusal with a
                   reason. NOT a free haul.
     no depot    → present:false, reach 0 → inReach() false. NOT unlimited.
     no carrier  → a refusal from quote() ("pick a carrier"), and NEVER a
                   silent substitution of the NPC. See the rejection below.
     no median   → the floor, 40. Never 0, never null (resolveMedian).
     no rig      → the HAND-HAULED BASELINE: load ×1, risk 0, speed ×1. That
                   label is not invented here — index.html:164244's _garageRig()
                   already returns { owned:false, name:'Hand-hauled', load:1,
                   risk:0, speed:1, tier:0 } from both its no-rig path and its
                   catch, and it is the authority on the name. A parallel "no
                   carrier" label would be a second name for one state.
                   ⚠ Phase 1: the baseline is NEUTRAL. It is not the Phase 2
                   penalty wearing the same name. And per drift R1 none of the
                   three rig figures is applied to anything today, so the
                   baseline and a Mythic rig price and time identically.
     no units    → 1. A zero-unit quote prices at 0, and a 0-Cinder dispatch is
                   a free haul that still burns one of the carrier's runs.
                   ⚠ The server refuses `bad_units` at 0 (sql/038:737) and
                   contracts.js:958 refuses an empty manifest before that, so
                   this floor can never become a dispatch — it only stops the
                   panel printing "0 🔥" while someone is still typing.
     no escort   → false. Never opt a player into a surcharge.
     no tariff   → NOT the floor, and this changed: a refusal, matching
                   sql/038:806-808's `no_tariff_published`. Quoting an unset
                   sheet at 40 shows a price no dispatch can produce.

   🔴 REJECTED: quote() silently falling back to Meridian when the chosen
   carrier cannot serve the route. It reads like helpfulness and it is a
   billing bug: a player who picked carrier X and pressed Quote would be
   charged at the NPC's 2.5× ceiling by a carrier they never chose. The
   fallback is a SEPARATE BUTTON (index.js:652's `meridian` action) because
   taking the ceiling has to be a decision someone made. */
function resolveDepot(depot) {
  const d = (depot && typeof depot === 'object') ? depot : null;
  const nodeId = d ? idOf(d.nodeId !== undefined ? d.nodeId : d.home_node_id) : '';
  if (!d || !nodeId) return { present: false, nodeId: '', reach: 0, radius: 0, level: 0, bays: 0 };

  /* 🔴 THIS FUNCTION IS IDEMPOTENT, AND THAT IS A REQUIREMENT, NOT A PROPERTY
     IT HAPPENS TO HAVE. `resolveDepot(resolveDepot(x))` must equal
     `resolveDepot(x)` for every x, because this module hands its own resolved
     depot around (`q.depot`) while `inReach` is ALSO a public export that a
     caller may hand either shape — index.js re-publishes it on the bridge
     (index.js:1227) and depot.js:211 expects `inReach(bestDepot(), …)` to work.
     It was NOT idempotent once and the cost is written up at inReach() above:
     the output names the field `reach`, the input named it `radius`, a second
     pass therefore saw neither a radius nor a level and returned reach 0 (4→0,
     measured), and every multi-hop quote in the game was refused.
     The two lines that make it a fixpoint are the `d.reach` fallback below and
     the `radius` mirror in the returned object. Do not delete either as
     redundant — they are load-bearing in opposite directions.

     REACH, in order:
       1. an explicit `radius` (or `reach`) the caller supplied. Not laxity:
          the caller got it from depot.js's depotEffect(), which is the same
          `3 + lv` ladder the server hardcodes at sql/038:795, and a level that
          has not been sent yet must not silently become reach 3.
       2. else `3 + level`, the design's formula.
       3. else 0 — its own node and nothing else. A depot row with neither a
          radius nor a level is not a depot that reaches everything. */
  const level = Math.max(0, Math.floor(num(d.level !== undefined ? d.level : d.depot_level, 0)));
  const given = d.radius !== undefined ? d.radius : d.reach;
  const reach = given !== undefined
    ? Math.max(0, Math.floor(num(given, 0)))
    : (level > 0 ? 3 + level : 0);
  return {
    present: true,
    nodeId,
    reach,
    // Same number under both names, deliberately: `reach` is what this module
    // reads, `radius` is what every caller and the depot panel already call it
    // (depot.render.js:501), and carrying both is what makes a re-resolve a
    // fixpoint instead of a silent reach 0.
    radius: reach,
    level,
    bays: Math.max(0, Math.floor(num(d.bays, 0))),
  };
}

/* 🔴 RISK UNITS, AND THIS IS THE TRAP IN THIS FEATURE. rigs.data.js stores rig
   risk in PERCENTAGE POINTS, NEGATIVE (-32 = "32 points off"), and auditRigs()
   enforces `risk <= 0`. The paid Garage effects table (index.html ~164198)
   uses THE SAME FIELD NAME for a FRACTION (0.05 / 0.12 / 0.20) against the
   same 0..0.95 clamp. Mixing them is not a rounding error in either direction:
   a -32 read as a fraction annihilates every risk in the game, and a 0.20 read
   as points is 0.2 points off a 30% roll — a $99 rig that does nothing.
   So this is the ONE place the unit is decided, and it decides by a
   discriminator that cannot be ambiguous: |r| < 1 is unusable as points (0.2
   points is a no-op nobody means), therefore it is the Garage fraction and is
   scaled to points. The magnitude is then taken as a REDUCTION regardless of
   the sign the caller used, because no rig in the game adds risk.

   ⚠ AND NOTHING MULTIPLIES BY IT TODAY (drift R1). transport_quote's risk is
   `least(max_risk_pct, ceil(hops × risk_pct_per_hop))` and has no rig term at
   all, so subtracting one here would print a risk the contract row cannot hold.
   This function survives because the unit question above is the hard part, and
   whoever adds a rig term — to sql/038 first, then here — needs it. It is
   reported on the quote as `rigRiskPts` and applied to nothing. */
function riskPoints(rigRisk) {
  const r = Number(rigRisk);
  if (!Number.isFinite(r) || r === 0) return 0;
  const mag = Math.abs(r);
  return -(mag < 1 ? mag * 100 : mag);
}

function resolveInput(input) {
  const i = (input && typeof input === 'object') ? input : {};
  const sheet = sheetOf(i);
  const carrier = (i.carrier && typeof i.carrier === 'object') ? i.carrier : null;

  /* TWO INPUT SHAPES, ON PURPOSE. The pinned contract is
     { fromId, toId, … }; index.js:649's click handler builds { from, to,
     cargo:{resId:units} } straight off the form. Accepting both means one
     resolver serves both call sites instead of two that disagree about which
     end of a route is which — the kind of disagreement that ships as a haul
     billed in the wrong direction. */
  const fromId = i.fromId !== undefined ? i.fromId : i.from;
  const toId = i.toId !== undefined ? i.toId : i.to;

  let units = Number(i.cargoUnits);
  if (!Number.isFinite(units) && i.cargo && typeof i.cargo === 'object') {
    units = 0;
    for (const k of Object.keys(i.cargo)) units += num(i.cargo[k], 0);
  }
  units = Math.max(1, Math.floor(Number.isFinite(units) ? units : 0));

  /* ⚠ Written long-hand, and it stayed long-hand after a smoke test caught the
     clever version throwing. `(carrier && carrier.tariff) !== undefined` is
     `null !== undefined` → true when there is no carrier at all, so the ternary
     then read `carrier.tariff` off null and meridianQuote(null) — the one call
     that must never fail — threw a TypeError. A file whose whole promise is "no
     input makes this throw" has to be tested against null, not reasoned about.
     baseRateOf/escortPctOf are null-safe by construction for the same reason. */
  const askedRaw = carrier ? baseRateOf(carrier) : baseRateOf(i.tariff !== undefined ? i.tariff : null);

  return {
    sheet,
    fromId,
    toId,
    nodes: Array.isArray(i.nodes) ? i.nodes : [],
    carrier,
    carrierId: idOf((carrier && carrier.id) || i.carrierId),
    carrierName: String((carrier && carrier.name) || i.carrierName || '') || 'Unnamed carrier',
    /* An explicit `depot` wins over the carrier row it was read from, so a
       caller holding a fresher depot (a level-up that has not reached the rate
       board yet) is not overruled by a stale row. Falling back to the carrier
       ITSELF is not a trick: a raw sql/038 company row carries home_node_id and
       depot_level, which is the same depot expressed in the column names the
       table uses. */
    depot: resolveDepot(i.depot || (carrier && (carrier.depot || carrier))),
    // Clamped to max_tariff_per_unit_hop exactly as sql/038:804 does on read,
    // so a sheet written before a ceiling was lowered quotes at the ceiling.
    tariff: Math.min(Math.max(0, askedRaw), Math.max(0, num(sheet.maxTariffPerUnitHop, 500))),
    escortPct: escortPctOf(carrier || i, sheet),
    // ×1 / ×1 / 0 points is the Hand-hauled baseline described above. Resolved,
    // returned, applied to nothing — drift R1.
    rigCargo: Math.max(0.01, num(i.rigCargo, 1)),
    rigSpeed: Math.max(0.1, num(i.rigSpeed, 1)),
    rigRiskPts: riskPoints(i.rigRisk),
    cargoUnits: units,
    escort: !!i.escort,
    illicit: !!(i.illicit || String(i.cargoClass || '') === 'illicit'),
    blocked: !!(i.blocked || (carrier && carrier.blocked)),
    median: resolveMedian(i.medianTariff !== undefined ? i.medianTariff : i.carriers, sheet),
  };
}

/* ═══ THE QUOTE ═════════════════════════════════════════════════════════════ */

function etaText(minutes) {
  const m = Math.max(0, Math.round(num(minutes, 0)));
  if (m < 1) return 'under a minute';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? (h + 'h ' + rm + 'm') : (h + 'h');
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? (d + 'd ' + rh + 'h') : (d + 'd');
}

/* Defensive only, and it used to be load-bearing in the wrong way. It once
   carried the comment "a same-node haul still bills one hop"; sql/038:745
   refuses `same_node` outright, so both quote paths now refuse a 0-hop route
   before anything is priced (drift F3) and nothing reaches this with h < 1
   except a caller who bypassed them. Kept because `hops` is the number
   contracts.js:963 hands to p_hops, and a 0 there becomes a null p_hops and a
   `bad_hops` refusal — a floor of 1 keeps a hand-built call dispatchable
   instead of silently unfixable. */
function atLeastOneHop(h) { return Math.max(1, Math.floor(num(h, 1))); }

/* Fares round UP, ONCE, at the end — `ceil(rate × units × hops × escort)`,
   the exact shape of sql/038:816 and :761 (drift A1). Rounding the rate first
   and the fare second is what put 51,501 on the screen against a 51,250 charge.
   If the client ever rounds DOWN instead it shows a price below what
   transport_dispatch() charges, and "shown one price, billed another" is the
   failure this repo has already paid for elsewhere. */
function fareOf(rate, units, h, escortPct) {
  return Math.ceil(
    Math.max(0, num(rate, 0))
    * Math.max(0, num(units, 0))
    * atLeastOneHop(h)
    * (1 + clamp(num(escortPct, 0), 0, 100) / 100)
  );
}

/* 🔴 RISK. Server formula, verbatim (sql/038:767 and :813):
       risk = least(max_risk_pct 45, ceil(hops × risk_pct_per_hop 4))
       escorted: floor(risk × (100 − escort_risk_cut_pct 60) / 100)
   The escort is a MULTIPLIER, not a subtraction, and there is no base term.
   This file used to add a base of 30 and subtract 22 points for an escort,
   copied from the Foundation Reserve convoy grammar (FR_CONVOY_RISK /
   FR_CONVOY_ESC_CUT, index.html ~61128) — a defensible feel, and wrong, because
   a 1-hop haul printed 30% and the contract row stored 4% (drift F1). The
   Reserve's grammar is the Reserve's; this system's grammar is transport_config.

   🔴 THE CLAMP IS THE POINT, NOT DECORATION. `least(45, …)` is the server's own
   upper bound; the lower bound of 0 is this file's, and it exists because of the
   sign. Every term here is non-negative today, but the escort arm subtracts
   inside a multiply and a hand-edited escortRiskCutPct above 100 would turn the
   figure negative. A negative risk prints "−12% risk" to the player and — far
   worse — any consumer reading it as a survival fraction (`1 − risk`) pays out
   1.12× the cargo, quietly minting freight out of a sign. 100 is the absolute
   upper bound for the same reason in the other direction: a figure above it is
   not a probability at all. */
function riskOf(h, escort, sheet) {
  const perHop = Math.max(0, num(sheet.riskPctPerHop, SHEET.riskPctPerHop));
  const ceilPct = Math.max(0, num(sheet.maxRiskPct, SHEET.maxRiskPct));
  const base = Math.min(ceilPct, Math.ceil(atLeastOneHop(h) * perHop));
  if (!escort) return clamp(Math.round(base), 0, 100);
  const cut = clamp(num(sheet.escortRiskCutPct, SHEET.escortRiskCutPct), 0, 100);
  return clamp(Math.floor(base * (100 - cut) / 100), 0, 100);
}

/* ONE SHAPE FOR EVERY OUTCOME, so no caller has to branch on failure to read a
   field. A refusal is this object with ok:false, a code, a printable `reason`
   and a `fix` naming the concrete thing to go do — "no quote" with no reason is
   the empty panel this rubric exists to prevent.
   `serverCode` is the sql/038 error string this refusal corresponds to, or ''
   where there is no server analogue. It is here so that a support report can be
   matched against a server log without translating two vocabularies by hand —
   sql/038:665-673 records four wasted debugging sessions caused by exactly that
   kind of mismatch. */
function shape(o) {
  return {
    ok: !!o.ok,
    code: o.code || (o.ok ? 'ok' : 'refused'),
    serverCode: o.serverCode || '',
    reason: o.reason || '',
    fix: o.fix || '',
    note: o.note || '',
    carrierId: o.carrierId || '',
    carrierName: o.carrierName || '',
    meridian: !!o.meridian,
    price: (o.price === undefined || o.price === null) ? null : o.price,
    capped: !!o.capped,
    tariff: (o.tariff === undefined || o.tariff === null) ? null : o.tariff,
    cap: (o.cap === undefined || o.cap === null) ? null : o.cap,
    unit: 'Cinder per unit·hop',
    /* `hops` IS A WIRE FIELD, not a display convenience: contracts.js:963 reads
       it and sends it as p_hops, which the server multiplies the price by. So
       it is always the hop count this quote was PRICED at — never -1, never 0 —
       and the ladder's raw answer, sentinel included, is reported separately as
       `hopsMeasured`. Returning -1 here would arrive as a null p_hops and a
       `bad_hops` refusal on a fare the player had already agreed to. */
    hops: (o.hops === undefined || o.hops === null) ? 1 : o.hops,
    hopsMeasured: (o.hopsMeasured === undefined || o.hopsMeasured === null) ? HOP_UNREACHABLE : o.hopsMeasured,
    hopsKnown: !!o.hopsKnown,
    cargoUnits: o.cargoUnits || 0,
    // Always 1: one dispatch claims one run (sql/038:1027-1029), drift R2.
    runs: o.runs || 0,
    etaMinutes: o.etaMinutes || 0,
    tripMs: o.tripMs || 0,
    etaText: o.etaText || '—',
    riskPct: (o.riskPct === undefined || o.riskPct === null) ? 0 : o.riskPct,
    escort: !!o.escort,
    escortPct: o.escortPct || 0,
    // Reported, applied to nothing — drift R1.
    rigCargo: (o.rigCargo === undefined || o.rigCargo === null) ? 1 : o.rigCargo,
    rigSpeed: (o.rigSpeed === undefined || o.rigSpeed === null) ? 1 : o.rigSpeed,
    rigRiskPts: o.rigRiskPts || 0,
    guarded: !!o.guarded,
  };
}

/* Shared refusals. quote() and meridianQuote() must agree about the three
   things sql/038 rejects before it ever looks at a carrier — same_node,
   bad_hops, bad_units (sql/038:733-746) — and the cheapest way to keep two
   functions agreeing is for them not to be two functions. Returns null when
   there is nothing to refuse, which is the ONE place in this file where a null
   means "keep going" rather than "no answer"; it never leaves the module. */
function routeRefusal(q, h, base) {
  const sheet = q.sheet;
  if (h === HOP_SAME) {
    return shape({ ...base, code: 'same-node', serverCode: 'same_node',
      hops: 1, hopsMeasured: HOP_SAME, hopsKnown: true,
      reason: 'The cargo is already at the destination.',
      fix: 'Pick a different destination — nothing needs hauling.' });
  }
  const maxHops = Math.max(1, Math.floor(num(sheet.maxHops, SHEET.maxHops)));
  if (h > maxHops) {
    return shape({ ...base, code: 'too-far', serverCode: 'bad_hops',
      hops: h, hopsMeasured: h, hopsKnown: true,
      reason: 'That route is ' + h + ' hops and the exchange will not book past ' + maxHops + '.',
      fix: 'Ship it in legs — haul to somewhere in between first.' });
  }
  const maxUnits = Math.max(1, num(sheet.maxUnits, SHEET.maxUnits));
  if (q.cargoUnits > maxUnits) {
    return shape({ ...base, code: 'too-much', serverCode: 'bad_units',
      hops: atLeastOneHop(h), hopsMeasured: h, hopsKnown: h >= 0,
      reason: 'One contract carries at most ' + maxUnits + ' units.',
      fix: 'Split the manifest and send it as more than one haul.' });
  }
  return null;
}

/* Over max_price_per_contract (sql/038:830-834). Reachable only on an enormous
   manifest, and the fix is always the same edit: send less at a time. Shared
   because the NPC hits the same wall and must say the same thing. */
function priceRefusal(price, sheet, base) {
  const cap = Math.max(1, num(sheet.maxPricePerContract, SHEET.maxPricePerContract));
  if (price <= cap) return null;
  return shape({ ...base, code: 'over-price-cap', serverCode: 'over_price_cap',
    reason: 'That haul prices at ' + price + ' 🔥, over the exchange ceiling of ' + cap + ' per contract.',
    fix: 'Split the manifest and send it as more than one haul.' });
}

/* 💰 A player carrier's quote.
   TARIFF UNIT: Cinder PER UNIT·HOP, and it is stored in that unit because it
   is what the UI prints — index.js:622's tariff toast says "per unit·hop", the
   rate board column is headed the same way, depot.render.js:809 prints
   `q.unit` verbatim, and the server's own column is named
   max_tariff_per_unit_hop. Storing a whole-route fare instead would mean every
   display site had to divide by a hop count it does not have, and every carrier
   would be comparing prices for routes of different lengths.

   REFUSAL ORDER MIRRORS sql/038's, deliberately, so the first thing the player
   is told is the first thing the server would tell them. Every refusal names
   Meridian in the `fix` where Meridian is genuinely the answer, because the
   entire promise of this system is that a shipper is never stuck. */
export function quote(input) {
  const q = resolveInput(input);
  const rate = ceilingRate(q.median, q.sheet);
  const cap = Math.ceil(rate);
  const base = {
    carrierId: q.carrierId,
    carrierName: q.carrierName,
    cap,
    cargoUnits: q.cargoUnits,
    escortPct: q.escortPct,
    rigCargo: q.rigCargo,
    rigSpeed: q.rigSpeed,
    rigRiskPts: q.rigRiskPts,
    meridian: false,
  };

  if (!q.carrierId && !q.carrier) {
    return shape({ ...base, code: 'no-carrier',
      reason: 'No carrier selected.',
      fix: 'Pick a carrier from the rate board, or take the Meridian Haulage quote.' });
  }

  const h = hops(q.fromId, q.toId, q.nodes);
  if (h < 0) {
    return shape({ ...base, code: 'no-route', serverCode: 'bad_route',
      reason: q.nodes.length
        ? 'The exchange has no route between those two nodes.'
        : 'The node map has not loaded, so no route can be measured.',
      fix: q.nodes.length
        ? 'Pick nodes that are on the map, or take the Meridian Haulage quote.'
        : 'Refresh the depot panel; if it stays empty the node list failed to load.' });
  }
  const bad = routeRefusal(q, h, base);
  if (bad) return bad;

  if (q.blocked) {
    /* A carrier may refuse anyone — that is their business, and taking that
       away would make the rate board a public utility. What it may NOT do is
       end someone's game, which is exactly why the fix line below exists and
       why meridianQuote() has no blocked check at all. Drift D2: the server
       checks the blacklist at dispatch (sql/038:995), not at quote, because the
       board does not publish who has refused whom. */
    return shape({ ...base, code: 'blocked', serverCode: 'blacklisted',
      hops: h, hopsMeasured: h, hopsKnown: true,
      reason: q.carrierName + ' will not carry your freight.',
      fix: 'Meridian Haulage carries it regardless — take the NPC quote.' });
  }

  /* BOTH reach tests, and the stricter answer wins (drift D1).
     `reaches()` — not `inReach()` — because `q.depot` is ALREADY resolved and
     re-resolving it is the bug documented at inReach(). The two tests are
     genuinely different questions and both are needed: reaches() asks where the
     ENDPOINTS are (a depot with reach 2 can serve two nodes 2 hops away on
     opposite sides of it), and `h > q.depot.reach` bounds the ROUTE LENGTH,
     which is the only one the server can ask (`v_hops > 3 + depot_level`,
     sql/038:795). When the radius came from depotEffect() the two numbers are
     the same `3 + lv`, so this second clause is the server's own refusal
     reproduced locally rather than an independent rule. */
  if (!reaches(q.depot, q.fromId, q.toId, q.nodes) || h > q.depot.reach) {
    return shape({ ...base, code: q.depot.present ? 'out-of-reach' : 'no-depot',
      serverCode: q.depot.present ? 'out_of_reach' : '',
      hops: h, hopsMeasured: h, hopsKnown: true,
      reason: q.depot.present
        ? (q.carrierName + "'s depot reaches " + q.depot.reach + ' hop' + (q.depot.reach === 1 ? '' : 's') + ', and this route needs both ends inside that.')
        : (q.carrierName + ' has no Freight Depot, so it has no origin to quote from.'),
      fix: 'Choose a carrier with a yard nearer the cargo, or take the Meridian Haulage quote.' });
  }

  /* An unset sheet is a refusal, not a discount. sql/038:806-808 returns
     `no_tariff_published` when base ≤ 0; this file used to quote such a carrier
     at the 40 floor, which showed a price no dispatch could ever produce. */
  if (!(q.tariff > 0)) {
    return shape({ ...base, code: 'no-tariff', serverCode: 'no_tariff_published',
      hops: h, hopsMeasured: h, hopsKnown: true,
      reason: q.carrierName + ' has not published a tariff.',
      fix: 'Pick a carrier with a rate on the board, or take the Meridian Haulage quote.' });
  }

  /* THE CLAMP, and it clamps the PRICE, not the rate (drift A4, sql/038:824).
     The difference only shows with an escort: clamping the rate and then adding
     the surcharge produced a figure 1 + escort_pct/100 times the server's. The
     Meridian reference is computed WITHOUT an escort because that is what
     sql/038 compares against — Meridian sells no escort, so its price has no
     escort term to compare with.
     `capped` tells the UI the asking price was cut to the ceiling;
     depot.render.js:843 prints a banner so the player knows why the number is
     not what the board said. */
  const merPrice = fareOf(rate, q.cargoUnits, h, 0);
  let price = fareOf(q.tariff, q.cargoUnits, h, q.escort ? q.escortPct : 0);
  let capped = false;
  if (price > merPrice) { price = merPrice; capped = true; }

  const over = priceRefusal(price, q.sheet, { ...base, hops: h, hopsMeasured: h, hopsKnown: true, tariff: q.tariff });
  if (over) return over;

  const mins = atLeastOneHop(h) * Math.max(0, num(q.sheet.minutesPerHop, SHEET.minutesPerHop));

  return shape({
    ...base,
    ok: true,
    code: 'ok',
    price,
    capped,
    tariff: q.tariff,
    hops: h,
    hopsMeasured: h,
    hopsKnown: true,
    runs: 1,
    etaMinutes: mins,
    tripMs: mins * 60000,
    etaText: etaText(mins),
    riskPct: riskOf(h, q.escort, q.sheet),
    escort: q.escort,
    // Flagged on BOTH quote paths, not just the NPC's: a sheet whose ceiling
    // multiplier was refused by tariffMultOf() changed the number this haul was
    // clamped against, and the player carrier's quote is where that shows up as
    // money.
    guarded: multsTampered(q.sheet),
  });
}

/* 🚚 THE NPC QUOTE — THE ONE THAT MUST ALWAYS EXIST.
   🔴 DESIGN REQUIREMENT, not a nicety: NO INPUT MAKES THIS PATH RETURN NULL OR
   UNDEFINED, AND NONE MAKES IT THROW. Not an empty carrier list, not a zero /
   NaN / negative median, not a shipper blacklisted by every carrier on the
   board, not a caller with no depot, not `meridianQuote(null)`, not a build
   where sql/038 has never been pasted into the SQL editor, not a node list that
   failed to load. A shipper left with zero carriers has had their game ended by
   another player's choice, and that must be impossible.

   🔴 AND THAT IS THE PROPERTY, PRECISELY STATED: no refusal here can be CAUSED
   BY ANOTHER PLAYER. There are four, all caused by the shipper's own manifest,
   and each names the edit that clears it:
     same-node       the cargo is already there — no haul exists to refuse
     too-far         over max_hops; ship it in legs
     too-much        over max_units_per_contract; split the manifest
     over-price-cap  over max_price_per_contract; split the manifest
     no-illicit      the one ratified cargo class, and player carriers take it
   Nothing on that list moves when a rival blacklists you, closes their charter,
   raises their tariff to infinity or deletes their depot. That is the whole
   guarantee, and it is why there is no reach check, no blocked check, no
   carrier lookup and no tariff check in this function.

   It is deliberately worse than a player carrier on every axis that matters:
     price  2.5× the LIVE median (never a fixed number — a fixed NPC price is a
            price that stops being a ceiling the moment the board moves),
     time   1.6× the same hop count, and no rig helps,
     escort none, ever,
     risk   identical to a player's, because sql/038:767 computes risk before it
            branches on the carrier and Meridian gets the unescorted figure. A
            player who buys an escort gets 40% of it; Meridian sells none. So
            the NPC is never better on risk either, and it is structural rather
            than guarded.

   🔒 WHERE THE NEVER-COMPETITIVE PROPERTY IS ENFORCED IN CODE, since a comment
   claiming it would be worth nothing. Two guards and one identity, and each is
   on the axis where a bad value is actually detectable:
     price  tariffMultOf() REFUSES a multiplier ≤ 1 and substitutes the ratified
            2.5 — that is a guard which RAISES this quote's price back above the
            market, and it is the only input that could ever make the NPC
            undercut it. The relation to a specific player quote needs no output
            check because it is an identity: quote() clamps every player price
            DOWN to this one (`if (price > merPrice) price = merPrice`), so no
            quote this module can produce is dearer than Meridian's. Read
            tariffMultOf() for the revision that got this wrong by comparing an
            expression against itself.
     time   timeMultOf() refuses ≤ 1 the same way, AND the ETA below is checked
            against the player's own ETA for the identical route and bumped past
            it if it is not already — because time is the one axis no clamp
            elsewhere enforces.
     escort not sold, so it cannot be sold cheaper.
   `guarded: true` on the returned quote says a substitution happened, which
   turns a tampered sheet into a visible bug report rather than a slow collapse
   of the carrier market. */
export function meridianQuote(input) {
  const q = resolveInput(input);
  const sheet = q.sheet;
  const rate = ceilingRate(q.median, sheet);
  const cap = Math.ceil(rate);
  const base = {
    carrierId: MERIDIAN.id,
    carrierName: MERIDIAN.name,
    meridian: true,
    cap,
    tariff: cap,
    cargoUnits: q.cargoUnits,
    escortPct: 0,
    rigCargo: q.rigCargo,
    rigSpeed: q.rigSpeed,
    rigRiskPts: q.rigRiskPts,
  };

  /* Meridian is never reach-checked and never blocked-checked. An unmeasurable
     route (-1: no map at all) still gets a fare — it prices at the longest rung
     on the ladder, because the alternative is refusing, and refusing for a
     reason outside the shipper's control is the one thing this carrier may not
     do. `hopsKnown:false` tells the UI to say so rather than presenting a guess
     as a measurement, while `hops` stays a real, dispatchable number because
     contracts.js:963 sends it as p_hops. Over-stating is the harmless
     direction: the shipper is charged more for a route they can see is a guess,
     and the server bounds it anyway (sql/038:686-691). */
  const measured = hops(q.fromId, q.toId, q.nodes);
  const known = measured >= 0;
  const h = known ? measured : HOP_CROSS_REGION;

  const bad = routeRefusal(q, h, base);
  if (bad) return bad;

  if (q.illicit) {
    /* The single ratified refusal: "no illicit freight". It refuses WITH a fix,
       and the fix is real — illicit cargo is what the player carriers are for,
       and a shipper turned down here still has every carrier on the board plus
       the ordinary legal route for the same goods. This is not the lockout the
       NPC exists to prevent; it is a cargo class the NPC declines. Note it is
       still a fully-shaped object: no null, no throw. */
    return shape({ ...base, code: 'no-illicit',
      hops: h, hopsMeasured: measured, hopsKnown: known,
      reason: 'Meridian Haulage does not carry illicit freight.',
      fix: 'Hire a player carrier for this cargo — that trade is theirs.' });
  }

  const minutesPerHop = Math.max(0, num(sheet.minutesPerHop, SHEET.minutesPerHop));
  const timeMult = timeMultOf(sheet);

  const price = fareOf(rate, q.cargoUnits, h, 0);               // sql/038:761
  let etaMinutes = Math.ceil(atLeastOneHop(h) * minutesPerHop * timeMult);  // sql/038:762

  /* 🔒 DOMINANCE ON TIME, the axis nothing else enforces. The reference is the
     player's own ETA for the identical route — sql/038:817, `v_hops *
     minutes_per_hop` — and Meridian must land STRICTLY after it. At the ratified
     1.6 this holds for every hop count and the line does nothing; it fires when
     minutesPerHop has been zeroed in a sheet, where both figures collapse to 0
     and an untouched NPC would advertise instant delivery. The multiplier
     itself is already refused upstream by timeMultOf().

     PRICE IS NOT CHECKED HERE, and tariffMultOf's comment is the reason: it
     would be an expression compared against itself, which is precisely the bug
     the previous revision shipped. The price relation is the clamp in quote().

     Escort stays out of the reference deliberately: it is a service Meridian
     does not sell, and ratcheting the NPC up for something it cannot provide
     would punish the shipper for a player carrier's extras. */
  const refMinutes = atLeastOneHop(h) * minutesPerHop;
  let guarded = multsTampered(sheet);
  if (etaMinutes <= refMinutes) { etaMinutes = refMinutes + 1; guarded = true; }

  const over = priceRefusal(price, sheet, { ...base, hops: h, hopsMeasured: measured, hopsKnown: known });
  if (over) return over;

  return shape({
    ...base,
    ok: true,
    code: 'ok',
    price,
    // NOT flagged capped: Meridian does not get clamped to the ceiling, it
    // DEFINES it (sql/038:774 returns 'capped', false on this branch too).
    // Flagging it would print "capped at the Meridian ceiling" on Meridian's
    // own quote.
    capped: false,
    hops: h,
    hopsMeasured: measured,
    hopsKnown: known,
    runs: 1,
    etaMinutes,
    tripMs: etaMinutes * 60000,
    etaText: etaText(etaMinutes),
    // Unescorted, always — Meridian sells no escort, so `escort` is not even
    // read here. sql/038:770-777: a caller asking for one "is not refused,
    // because refusing would make the fallback carrier fail in exactly the
    // situation it exists to cover; the flag comes back false so the UI can say
    // so instead of quietly charging for something it did not sell."
    riskPct: riskOf(h, false, sheet),
    escort: false,
    guarded,
    note: q.escort
      ? 'Meridian Haulage does not sell escorts; this quote runs unescorted.'
      : (known ? '' : 'The node map has not loaded — this fare is priced at the longest route on the board.'),
  });
}
