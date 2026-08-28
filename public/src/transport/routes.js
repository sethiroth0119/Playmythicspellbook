/* ════════════════════════════════════════════════════════════════════════════
   🗺 TRANSPORT — ROUTES & PRICING. Hops, reach, the quote, and the ceiling.
   ----------------------------------------------------------------------------
   Spec: docs/transport-company-design.md. This is the arithmetic half of
   Transportation Companies and NOTHING ELSE: how far apart two nodes are,
   whether a carrier's depot reaches both ends, what a haul costs, how long it
   takes, how dangerous it is, and what the NPC carrier charges.

   TWO CONSUMERS, and they want different things from the same numbers:
     • src/transport/index.js + depot.render.js — the depot panel. tariffCap()
       draws the Meridian row on the rate board (index.js:537, in
       carrierBlock()); quote()/meridianQuote() sit behind the two quote buttons
       (index.js:1001, inside onClick()'s `act === 'quote' || act === 'meridian'`
       branch which opens at index.js:983) and every figure in the quote sheet
       comes from here — depot.render.js:890-918, in quoteCard(), reads
       ok/price/cap/tariff/hops/hopsKnown/cargoUnits/escort/unit/runs/etaText/
       riskPct, plus the capped banner at depot.render.js:938.
     • sql/038's transport_quote() / transport_dispatch() — THE AUTHORITY. The
       server re-derives the median, the price, the ETA and the risk and charges
       what IT computes. transport_dispatch does not even price: it calls
       `v_q := public.transport_quote(…)` and inserts that number.

   🔴 SO THIS FILE IS INSTANT FEEDBACK, NOT A SECOND PRICING AUTHORITY, and
   sql/038 says why in its own words — the client is REVOKED from reading
   transport_config precisely because "a client which reads the ceilings
   acquires a SECOND copy of the pricing authority and will eventually disagree
   with the first" (the comment above `revoke … on public.transport_config`).
   Same discipline CLAUDE.md records for chat, where the client keeps its
   profanity list "purely as instant feedback" and never as enforcement. Every
   number below is therefore a HAND-COPIED MIRROR of a server default, and the
   DRIFT LEDGER below is the only thing standing between that mirror and the
   worst bug class this repo has: shown one price, billed another.

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
   (`routes: { PHASE, MERIDIAN, MERIDIAN_TARIFF_MULT, … }`, index.js:1227). Two
   publication sites is two copies of the ceiling that can drift, and a rate
   board where the NPC undercuts the ceiling it defines is not a display bug, it
   is a free-transport exploit.

   ⚠ A REFUSAL IS AN OBJECT, NOT A NULL. Callers must test `q.ok`, not `q`.
   Every path returns the same shape; a refusal carries `code`, `serverCode`,
   `reason`, `fix`, and `price: null` so nothing formats it as a real price.
   Both consumers read it that way today, and both say so in their own words:
   index.js:1008 tests `if (!q || typeof q !== 'object')` for "the pricer did
   not answer" and index.js:1026 tests `if (!q.ok)` to toast the reason and the
   fix, over a comment recording that a PREVIOUS revision of THAT file used a
   truthiness test and therefore "stored every refusal as a live quote, which
   left the Dispatch button reading a null price off a 'no route' answer";
   depot.render.js:890 derives the same flag defensively as
   `('ok' in q) ? !!q.ok : (N(q.price) !== null)`, because the pinned view shape
   does not promise `ok`. Returning null instead of a shaped refusal would make
   the panel say nothing at all, and "nothing happened when I clicked Quote" is
   the least debuggable report a player can file.
   ════════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════════
   📎 HOW TO READ THE CITATIONS IN THIS FILE — the anchor is the SYMBOL.
   ----------------------------------------------------------------------------
   This file cites other files constantly, because the whole of its correctness
   IS agreement with them. The citation style is deliberate and it changed in
   this revision for a measured reason.

   • sql/038 is cited BY SYMBOL — `transport_quote()`, `v_mer_price`,
     `transport_config.max_hops` — with the verbatim SQL wherever the exact
     expression matters, and NEVER by line. That migration is applied by hand in
     the Supabase SQL editor (CLAUDE.md), so an insertion anywhere renumbers
     everything below it, silently, with no build step that could notice.
     MEASURED WHILE THIS REVISION WAS BEING WRITTEN: `minutes_per_hop` moved
     from line 448 to line 465 and the whole of transport_quote() shifted 18
     lines in one edit. A line number into that file is a citation with a decay
     rate. A symbol is grep-able and survives the renumber, and the verbatim SQL
     beside it is stronger evidence than a line number ever was.
   • The sibling ES modules ARE cited by line — they are ~1,000-line files where
     the line puts the reader on the spot immediately — but ALWAYS with the
     enclosing symbol named in the same breath (`index.js:537, in
     carrierBlock()`). The line is the hint; the symbol is the anchor. If they
     ever disagree, believe the symbol.
   • index.html is cited by line first. At 215k lines a grep is genuinely
     expensive, and that file is stable legacy.

   WHY THIS IS WRITTEN DOWN RATHER THAN QUIETLY DONE: the previous revision of
   this file carried roughly fifteen wrong sibling line numbers — not
   approximations, wrong locations, several landing in unrelated subsystems —
   and nothing caught it, because a stale citation still compiles and still
   reads as authoritative. Worse, it asserted in the present tense that
   index.js's quote handler "currently tests truthiness and will therefore
   render the refusal in the quote panel", a bug that had already been fixed in
   the very file it was describing. A wrong citation is worse than no citation:
   it sends the next reader somewhere else and then teaches them to distrust the
   ones that are right. Every citation below was re-verified against the working
   tree on 2026-08-28.
   ════════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════════
   📋 DRIFT LEDGER — THIS FILE vs sql/038_transport_companies.sql
   ----------------------------------------------------------------------------
   sql/038 is the authority, in its own words in the header above
   transport_quote(): "THE ONE PRICING AUTHORITY… two copies of a price formula
   is two authorities, and the day they drift the player is shown one number and
   billed another." This block is the reconciliation, item by item, with the
   server expression beside each one. An earlier revision of this file disagreed
   with 038 in five places and said nothing about any of them; those five are
   marked FIXED below with what they used to print, because a silently corrected
   divergence teaches nobody why the number moved.

   ⚠ THIS LEDGER IS A RECONCILIATION AT A MOMENT, AND IT MOVED WHILE IT WAS
   BEING WRITTEN. sql/038 changed underneath this revision — `v_mer_base` gained
   a floor-and-ceiling clamp, `v_reach` moved into transport_caps(), the median
   sample gained a delivered-contract filter, and the Meridian branch stopped
   returning early. Three of the entries below are the RESULT of re-reading it,
   not of writing this file. That is the maintenance instruction: to re-check an
   entry, grep the symbol named in it — never trust this text over the SQL.

   ── AGREED, and checked expression by expression ──────────────────────────
   A1 CEILING RATE   client ceilingRate() = resolved median × 2.5, UNROUNDED,
                     then the whole fare gets ONE ceil().
                     server, transport_quote(): `v_mer_base := least(greatest(
                     coalesce(v_median, v_cfg.meridian_base_floor),
                     v_cfg.meridian_base_floor), v_cfg.max_tariff_per_unit_hop)
                     * v_cfg.meridian_tariff_mult; v_mer_price := ceil(v_mer_base
                     * v_units * v_hops)`. resolveMedian() reproduces that
                     greatest-then-least pair exactly; see D4, which used to say
                     the opposite and is the reason it is now a `greatest`.
                     ⚠ FIXED — this used to be `ceil(median × 2.5)` and THEN
                     ceil the fare, i.e. it rounded twice. At median 41, 100
                     units, 5 hops it printed 51,501 against a server charge of
                     51,250, and the old comment claimed rounding up "can only
                     ever over-quote by <1 Cinder". It was out by 251.
   A2 MEDIAN         both take the true median (even counts average the two
                     middle values). The server's `percentile_cont(0.5) within
                     group (order by (c.tariff->>'base')::numeric)` interpolates
                     linearly, which for the midpoint IS that average.
   A3 PLAYER FARE    ceil(base × units × hops × (1 + escort_pct/100)).
                     server: `v_price := ceil(v_base * v_units * v_hops *
                     (1 + v_escort_pct / 100.0))`.
   A4 THE CAP        the PRICE is clamped to the Meridian price — not the
                     tariff. server: `if v_price > v_mer_price then v_price :=
                     v_mer_price; v_capped := true; end if;`
                     ⚠ FIXED — this used to clamp the TARIFF (`min(asked, cap)`)
                     and then apply the escort surcharge on top, so an escorted
                     at-ceiling haul printed 1.25× the price the server charges.
   A5 HOP BOUND      the ladder's top rung is 5 and transport_config.max_hops is
                     6, so every rung this file can produce is dispatchable.
                     server: `if v_hops < 1 or v_hops > v_cfg.max_hops then …
                     'bad_hops'`.
                     ⚠ COUPLED: raise HOP_CROSS_REGION above 6 and every
                     cross-region quote this file prints becomes undispatchable.

   ── DIVERGENT ON PURPOSE, and the direction is stated ─────────────────────
   D1 REACH          server: `v_reach := (public.transport_caps(v_co.id)->>
                     'reach')::int; if v_hops > v_reach then … 'out_of_reach'`,
                     where transport_caps() publishes `'reach', 3 +
                     c.depot_level`. (It was an inline `3 + coalesce(
                     v_co.depot_level, 1)` when this file was first written; the
                     ladder moved into one function so bays, fleet_cap and reach
                     stop being copied per call site. Same number, one home.)
                     That bounds the HOP COUNT; it cannot check WHERE the
                     endpoints are, because — its own words, in the header above
                     transport_quote — "there is no adjacency table in this
                     database". This file
                     has the node list, so it checks both: the depot's distance
                     to each endpoint AND the server's own hop bound, refusing
                     if either fails. Deliberately STRICTER — the client must
                     never quote a route dispatch will refuse. The reverse
                     (client permissive, server strict) is a confirm dialog
                     followed by an error, which is the shape players report as
                     "it took my Cinder" even when it did not.
   D2 BLACKLIST      the server checks it in transport_dispatch (the
                     `blacklisted` refusal), not in transport_quote — the board
                     deliberately does not publish who has refused whom, and the
                     reason is written out at contracts.js:693-698, above
                     listCarriers(). When the caller already knows (they were
                     refused once), this file refuses at quote time and points
                     at Meridian. Earlier than the server, never later.
   D3 MEDIAN SAMPLE  ⚠ THE WIDEST DIVERGENCE IN THIS LEDGER, and it is the one
                     that can show a price below the charge. The server now
                     medians only carriers that are open, whose `tariff->'base'`
                     is a JSON *number*, whose base is > 0, AND which have at
                     least one delivered contract (`exists (select 1 from
                     public.transport_contracts k where k.carrier_id = c.id and
                     k.status = 'delivered')`) — a shell charter with no
                     deliveries cannot move the ceiling. The client medians what
                     listCarriers() handed it: `.eq('status','open')`,
                     `.limit(60)` ordered by reliability (contracts.js:699-710),
                     with no delivered-contract column in its select list at all
                     (contracts.js:704) — so this side CANNOT reproduce that
                     filter, and adding a second query to try would be a client
                     re-deriving a server sample, which is the thing this whole
                     header argues against.
                     DIRECTION, stated because it is the unsafe one: including
                     never-delivered carriers can only pull the client's median
                     DOWN (a new charter undercutting to get its first job), so
                     the client can display a ceiling — and therefore a capped
                     price — BELOW what transport_quote charges. That is "shown
                     one price, billed another" in the bad direction. It is
                     bounded (the confirm dialog is a client number, the charge
                     is the server's) and the standing mitigation is the last
                     paragraph of this ledger: once a round trip has happened,
                     prefer transport_quote's own returned price over this
                     file's. Do not fix it by guessing here.
   D4 FLOOR          ⚠ THIS ENTRY IS REVERSED FROM THE PREVIOUS REVISION, and
                     the reversal is the useful part. It used to read: "the
                     floor applies ONLY when there is no median at all; an
                     earlier draft's `max(40, median)` would have printed a
                     ceiling 4× the server's." That was true of a `coalesce(
                     v_median, meridian_base_floor)`. The server has since moved
                     to `least(greatest(coalesce(v_median, floor), floor),
                     max_tariff_per_unit_hop)` — a genuine low median IS now
                     raised to the floor, and the whole thing is capped at
                     max_tariff_per_unit_hop before the ×2.5. So resolveMedian()
                     now does `min(max(median, 40), 500)`, and the reasoning
                     that used to justify the opposite is preserved above rather
                     than deleted, because the next person to read
                     `coalesce(…)` in some other migration will reach for it
                     again.

   ── FIXED, and what they used to be ───────────────────────────────────────
   F1 RISK           was: base 30 + 4/hop, escort −22 points, clamp [4,95].
                     A 1-hop haul printed 30% and booked a 4% contract.
                     now: `v_risk := least(v_cfg.max_risk_pct, ceil(v_hops *
                     v_cfg.risk_pct_per_hop))`, and escorted `v_risk :=
                     floor(v_risk * (100 - v_cfg.escort_risk_cut_pct) / 100.0)`.
                     A multiplier, not a subtraction, and no base term.
   F2 ETA            was: 120000 ms per hop ÷ rig speed, × a client-invented run
                     count. A 5-hop haul showed "10m" and ran 125 minutes.
                     now: `v_eta := v_hops * v_cfg.minutes_per_hop`, and
                     Meridian `v_mer_eta := ceil(v_hops * v_cfg.minutes_per_hop
                     * v_cfg.meridian_time_mult)`. Rig speed is NOT applied — R1.
   F3 SAME NODE      was: priced, ok, "a same-node haul still bills one hop".
                     The server refuses `same_node` outright, and would refuse
                     it again at the `bad_hops` guard, because contracts.js:1059-
                     1060 converts a hops of 0 into a null p_hops. So the old
                     path priced a route the server would never dispatch, twice
                     over. now: a refusal in BOTH quote() and meridianQuote().
   F4 MERIDIAN EDGE  was: an output guard that bumped the NPC to `refPrice + 1`,
                     where refPrice was character-for-character the expression
                     that had just produced the NPC's price. It could detect
                     nothing and it fired on EVERY quote — 51,501 shown against
                     a 51,250 charge. now: no output price guard at all. A tie
                     is the server's own ratified outcome ("at equal price they
                     are 1.6x faster and can sell an escort", in the comment
                     above transport_quote()'s v_price clamp); the never-cheaper
                     property is the clamp in quote(); and the guard that remains
                     sits on the MULTIPLIERS, where a bad value can actually be
                     detected. See tariffMultOf().
   F5 ESCORT         was: a flat 25% surcharge invented here.
                     now: the carrier's own `tariff->>'escort_pct'`, clamped
                     0..100, defaulting to 0 exactly as the server's
                     `v_escort_pct := least(greatest(coalesce((
                     v_co.tariff->>'escort_pct')::numeric, 0), 0), 100)` does.

   ── REPORTED BUT NOT APPLIED ──────────────────────────────────────────────
   R1 rigSpeed, rigCargo, rigRisk are in the pinned input contract and ARE
      resolved and returned, but none of them changes a price, an ETA or a risk,
      because sql/038 reads none of them: `create table … transport_rigs` has
      runs_cap, rarity, condition and status — no speed column, no cargo
      capacity column, no risk column — and transport_quote's parameter list
      (p_carrier_id, p_from_node, p_to_node, p_hops, p_units, p_escort) has no
      rig parameter at all. Applying any of them here would print a number the
      contract row cannot contain. They are returned so a caller can show the
      rig it picked; they are multiplied into nothing. Read riskPoints() before
      ever wiring rigRisk up — the unit trap documented there is live.
   R2 RUNS is 1, always. One dispatch claims exactly one run (transport_dispatch:
      `set runs_used = case when r.day_key = v_today then r.runs_used + 1 else 1
      end`) regardless of tonnage, and units are bounded only by
      max_units_per_contract. The old runsNeeded() split a manifest into 20-unit
      runs and multiplied the ETA by the count; nothing server-side has ever had
      that concept.

   ⚠ HOW THIS LEDGER GOES STALE, and it is the only way: sql/038 changes and
   nobody re-reads this block. There is no automated check and there cannot be
   one from this side — sql/038 revokes `select` on transport_config from
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
   agrees structurally: `if p_carrier_id is null then` is the Meridian branch of
   transport_quote(), and the whole reach test — `v_reach := (
   public.transport_caps(v_co.id)->>'reach')::int` and the `out_of_reach`
   refusal — sits in the `else` arm, so no Meridian quote can be reach-refused.
   ⚠ AND THE BRANCH NO LONGER RETURNS EARLY: it sets v_price/v_eta and falls
   through to a single exit, because returning there stepped over the
   max_price_per_contract guard and made "the one quote no player controls the
   one quote with no price cap on it" — 7,500,000,000 returned ok against a cap
   of 5,000,000, in sql/038's own measured note. This file has always applied
   priceRefusal() to BOTH paths, so it agreed with the fix before the fix; the
   agreement is now exact rather than lucky, and priceRefusal() must stay shared
   for that reason.
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
   sql/038 but ratified independently of it — there they are
   `meridian_tariff_mult numeric not null default 2.5` and `meridian_time_mult
   numeric not null default 1.6` on transport_config, with the same values, and
   if either ever changes it changes in both places in the same commit or the
   client shows a ceiling the server does not enforce. */
export const MERIDIAN_TARIFF_MULT = 2.5;
export const MERIDIAN_TIME_MULT = 1.6;

/* ── THE SHEET: a hand-copied mirror of transport_config's DEFAULT clauses ───
   ⚠ CLAUDE.md: "All operation pricing goes through _opEcon(). Never hardcode
   economy numbers." That rule governs the BUSINESS — the transport charter's
   startup, rate and salary live in OPS_ECON (index.html:79732) and only there,
   and sql/038's transport_config header makes the same split from its own side
   ("NO PRICING LIVES HERE"). This file prices FREIGHT, which OPS_ECON has no
   concept of. The tariff and the median arrive as ARGUMENTS. What is left below
   is the set of BOUNDS the server owns, one line per transport_config column,
   named so each is one grep away.

   🔴 AND IT CAN NEVER BE FETCHED. sql/038 revokes `select` on transport_config
   from `authenticated`, on purpose, so that a client cannot acquire a second
   copy of the pricing authority. That means `input.sheet` below is A TEST SEAM
   AND NOTHING ELSE — there is no runtime path that can populate it, and none
   should be built. It exists so the divergence cases in the ledger above can be
   driven from a test without a database, and so that a future admin retune has
   one obvious place to be re-copied INTO by a human who has read both files.
   Anyone tempted to wire it to a live config row should read the
   `revoke … on public.transport_config` line and the paragraph above it first.

   PROVENANCE: every value is the DEFAULT of the named column, transcribed from
   sql/038 and re-verified against it on 2026-08-28. Nothing here is a guess,
   and nothing here is measured either — they are the server's numbers, and the
   server is where they get argued about. No line numbers: that migration is
   applied by hand and renumbers (see the citation note above). */
const SHEET = {
  minutesPerHop: 25,           // transport_config.minutes_per_hop
  riskPctPerHop: 4,            // transport_config.risk_pct_per_hop
  escortRiskCutPct: 60,        // transport_config.escort_risk_cut_pct
  maxRiskPct: 45,              // transport_config.max_risk_pct
  meridianBaseFloor: 40,       // transport_config.meridian_base_floor
  meridianTariffMult: MERIDIAN_TARIFF_MULT,  // transport_config.meridian_tariff_mult
  meridianTimeMult: MERIDIAN_TIME_MULT,      // transport_config.meridian_time_mult
  maxHops: 6,                  // transport_config.max_hops
  maxUnits: 5000,              // transport_config.max_units_per_contract
  maxTariffPerUnitHop: 500,    // transport_config.max_tariff_per_unit_hop
  maxPricePerContract: 5000000,// transport_config.max_price_per_contract
  escortPct: 0,                // the coalesce default inside transport_quote's
                               // v_escort_pct — an unset sheet sells escorts for
                               // nothing, and matching that beats inventing a
                               // surcharge the server will not charge (drift F5)
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
   BINDS. The Freight Depot's authored effect is `radius: 3 + lv` → 4 / 5 / 6
   (src/city/production.data.js:408, the `freightdepot` def), and the server
   publishes the same ladder as `'reach', 3 + c.depot_level` out of
   transport_caps(). At 3 a level-1 yard would quote the entire planet, "no depot in reach of
   both endpoints" would be dead code, and the depot — the building this whole
   feature exists to plant — would decide nothing. At 5: L1 serves its own
   region, L2 reaches anywhere, and L3 buys bays and fleet cap rather than
   reach, which is the shape the doc wants ("more depots is the natural sink
   for a growing company").
   ⚠ AND 5 MUST STAY ≤ transport_config.max_hops (6). Above it, transport_quote
   refuses `bad_hops` and every cross-region fare this file prints becomes a
   confirm dialog followed by an error. Two couplings, neither tested: that
   column, and the depot effect at src/city/production.data.js:408.

   🔴 REJECTED: a real BFS over an optional `links`/edges array on each node,
   falling back to this ladder when absent. It is strictly better geometry and
   it loses anyway, because it would mean TWO adjacency rules that can
   disagree: the same route priced at 5 hops on a client whose node rows lack
   links and 3 on one whose rows have them — and sql/038 can only implement one
   of them. In fact it implements NEITHER: the header above transport_quote
   records that "there is no adjacency table in this database", so hops arrives
   as a caller parameter and is merely BOUNDED. That makes this ladder the only
   adjacency rule in the system, which is an argument for it being simple and
   single, not for it being clever.

   A node with no `regionId` is treated as its own region, so it lands on the
   cross-region rung. Over-stating a distance costs a shipper a refusal with a
   reason (recoverable: take the NPC, or pick another carrier) or a dearer fare
   they can see before agreeing; under-stating one prices a haul below what it
   costs to run and the carrier eats it silently. And note which way the server
   leans on the same question, in that same header: "A shipper inflating hops
   charges THEMSELVES more, which is the harmless direction." Refusals and
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
   in the comment above transport_quote()'s `v_reach`, and it is what stops one
   player owning the planet from a single tile). Defaulting a missing depot to
   "reaches everything" would delete the feature and look like a null-check. A
   depot row with no `radius` and no `level` is the same case: reach 0, its own
   node only. Absence is never generosity here.

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
   are exactly that shape: index.js:850, in quoteRequest(), passes `{ nodeId,
   radius, bays }`, and index.js:829-831 builds the carrier's yard as
   `Object.assign({ nodeId: … }, depotEffect(level))` — neither of which carries
   a `level` key. So EVERY route of one hop or more was refused 'out-of-reach'
   by every carrier on the board.
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
   `tariff` is the jsonb sheet `{ base, escort_pct, illicit_pct }`. ONE resolver
   serves all three call sites instead of three that can disagree about the
   ceiling: index.js:537, in carrierBlock(), hands over a mapped array of
   numbers; the rate board holds rows; and listCarriers() selects `tariff`
   unmapped, straight from the column (contracts.js:704).
   ⚠ That third shape is not hypothetical padding — `Number({base:41})` is NaN,
   so a resolver that only understood numbers would median an empty list, fall
   through to the floor, and draw a 100 🔥 ceiling on a board whose real one is
   102.5. It would look like a working feature.

   🔴 MEDIAN, NOT MEAN, AND THAT IS A SECURITY CHOICE. The mean is a one-line
   attack: list a second shell carrier at 9,999,999 and the ceiling you are
   capped by moves with it, which hands the monopolist back the infinite price
   this whole system was built to take away. A median needs a majority of the
   board to move. The server reasons identically in the comment above its
   `percentile_cont(0.5)` select ("trading is not a market rate").
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
   never null and never zero. sql/038 states the same requirement in the same
   words, in the comment above the `meridian_base_floor` column: "With no open
   carrier there is no median, and Meridian must still quote."

   ⚠ THE FLOOR IS A `greatest`, NOT A `coalesce` — AND THAT REVERSED (drift D4).
   The server used to write `coalesce(v_median, meridian_base_floor)`, which
   applies the floor ONLY when there is no median, and this function matched it;
   a draft before that used `max(40, median)` and was corrected for printing a
   ceiling of 100 where the server's was 25. sql/038 has since moved to
   `least(greatest(coalesce(v_median, floor), floor), max_tariff_per_unit_hop)`,
   so a genuine low median IS now raised to the floor and the result is capped
   before the ×2.5 multiply. Matching it is not optional: at a real median of 10
   the two rules differ by 4×, and the difference lands on the clamp that
   decides what every carrier on the board may charge.
   The order matters and mirrors the SQL exactly — greatest FIRST, then least —
   so that a hand-edited sheet where maxTariffPerUnitHop < meridianBaseFloor
   resolves to the lower of the two rather than to a floor above the ceiling. */
function resolveMedian(medianTariff_, sheet) {
  const raw = Array.isArray(medianTariff_) ? medianTariff(medianTariff_) : baseRateOf(medianTariff_);
  const floor = Math.max(1, num(sheet.meridianBaseFloor, SHEET.meridianBaseFloor));
  const roof = Math.max(1, num(sheet.maxTariffPerUnitHop, SHEET.maxTariffPerUnitHop));
  const seen = (Number.isFinite(raw) && raw > 0) ? raw : 0;   // 0 = "no median at all"
  return Math.min(Math.max(seen, floor), roof);
}

/* 🔒 THE DOMINANCE GUARD LIVES ON THE MULTIPLIERS, and this is the whole of it.
   The ratified property is that Meridian is never cheaper and never faster than
   a rational player quote. A multiplier at or below 1 does not merely weaken
   that — it inverts the system: at 0.9 the NPC undercuts the median, and since
   quote() clamps every player price down to the NPC's, it would drag the entire
   market below the median rather than cap it. That is a price control, not a
   ceiling, and it is the one edit to SHEET that silently destroys the feature
   rather than mis-displaying it.

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
   than any quote this module can produce — and a tie is the ratified outcome:
   "at equal price they are 1.6x faster and can sell an escort", in the comment
   above transport_quote()'s v_price clamp. TIME is the axis nothing else
   enforces, so that one keeps an output check as well (see meridianQuote). */
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
   of the server's `v_mer_base` / `v_mer_price` pair (drift A1). Rounding the
   rate first and the fare second compounds, and it compounds upward — the
   direction that shows the player a price above the one they are charged, which
   is a support ticket rather than a loss, but is still two numbers where there
   should be one. */
function ceilingRate(median, sheet) {
  return Math.max(0, median * tariffMultOf(sheet));
}

/* The tariff ceiling a carrier types against, rounded up for display.
   🔴 DISPLAY HALF ONLY. THE BINDING CAP IS SERVER-SIDE: sql/038's
   transport_quote() re-derives the median from the live rows and clamps the
   PRICE there (`if v_price > v_mer_price then v_price := v_mer_price`), and
   transport_dispatch() takes that number without recomputing it — `v_q :=
   public.transport_quote(…)` then `v_price := (v_q->>'price')::numeric`. THAT
   is the authority. This number exists so the rate board can draw the ceiling
   row (index.js:537, in carrierBlock()) and so a carrier typing a tariff gets
   instant feedback. A client that both quotes and clamps is a client that can
   be argued with.

   ⚠ TWO CEILINGS, and the lower one wins: the Meridian rate, and
   transport_config.max_tariff_per_unit_hop (500), which transport_quote applies
   to the carrier's own sheet at read time — `v_base := least(greatest(coalesce(
   (v_co.tariff->>'base')::numeric, 0), 0), v_cfg.max_tariff_per_unit_hop)`. A
   board that drew only the Meridian ceiling would invite a carrier to type 900
   on a rich board and then quietly quote them at 500. Note the two are NOT the
   same clamp and must not be merged: resolveMedian() applies that same 500 to
   the MEDIAN, before the ×2.5, exactly as v_mer_base does — so the Meridian
   RATE can legitimately sit above 500 (up to 1250) while no carrier's typed
   tariff ever may. This function returns the number a carrier is typing
   against, so it takes the lower.

   ⚠ SINGLE ARGUMENT, deliberately, because that is the pinned contract and
   index.js:537 calls it with one. It therefore uses the module's mirrored
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
   the adjacent design in the comment above that same clamp — refusing an
   over-ceiling tariff rather than clamping it — because that "punishes the one
   party who cannot fix it", the shipper. */
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
                   label is not invented here — index.html:164461's _garageRig()
                   already returns { owned:false, name:'Hand-hauled', icon:'🧺',
                   load:1, risk:0, speed:1, tier:0 } from BOTH its no-rig path
                   (index.html:164476) and its catch (index.html:164479), and it
                   is the authority on the name. A parallel "no carrier" label
                   would be a second name for one state.
                   ⚠ Phase 1: the baseline is NEUTRAL. It is not the Phase 2
                   penalty wearing the same name. And per drift R1 none of the
                   three rig figures is applied to anything today, so the
                   baseline and a Mythic rig price and time identically.
     no units    → 1. A zero-unit quote prices at 0, and a 0-Cinder dispatch is
                   a free haul that still burns one of the carrier's runs.
                   ⚠ The server refuses `bad_units` at 0, and contracts.js:1033
                   refuses an empty manifest with `bad_cargo` before the request
                   ever leaves the client, so this floor can never become a
                   dispatch — it only stops the panel printing "0 🔥" while
                   someone is still typing.
     no escort   → false. Never opt a player into a surcharge.
     no tariff   → NOT the floor, and this changed: a refusal, matching the
                   server's `if v_base <= 0 then … 'no_tariff_published'`.
                   Quoting an unset sheet at 40 shows a price no dispatch can
                   produce.

   🔴 REJECTED: quote() silently falling back to Meridian when the chosen
   carrier cannot serve the route. It reads like helpfulness and it is a
   billing bug: a player who picked carrier X and pressed Quote would be
   charged at the NPC's 2.5× ceiling by a carrier they never chose. The
   fallback is a SEPARATE BUTTON — depot.render.js:730 renders "🚚 Quote
   Meridian instead" next to "💬 Get a quote", and index.js:983-985 routes the
   two actions apart — because taking the ceiling has to be a decision somebody
   made. */
function resolveDepot(depot) {
  const d = (depot && typeof depot === 'object') ? depot : null;
  const nodeId = d ? idOf(d.nodeId !== undefined ? d.nodeId : d.home_node_id) : '';
  if (!d || !nodeId) return { present: false, nodeId: '', reach: 0, radius: 0, level: 0, bays: 0 };

  /* 🔴 THIS FUNCTION IS IDEMPOTENT, AND THAT IS A REQUIREMENT, NOT A PROPERTY
     IT HAPPENS TO HAVE. `resolveDepot(resolveDepot(x))` must equal
     `resolveDepot(x)` for every x, because this module hands its own resolved
     depot around (`q.depot`) while `inReach` is ALSO a public export that a
     caller may hand either shape — index.js re-publishes it on the bridge
     (index.js:1227) and depot.js:272-273 expects both `inReach(bestDepot(), …)`
     and `quote({ depot: bestDepot() })` to work.
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
          `3 + lv` ladder the server hardcodes as `3 + coalesce(
          v_co.depot_level, 1)`, and a level that has not been sent yet must not
          silently become reach 3.
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
    // (depot.render.js:501 reads `depot.radius` to print the Reach vital), and
    // carrying both is what makes a re-resolve a fixpoint instead of a silent
    // reach 0.
    radius: reach,
    level,
    bays: Math.max(0, Math.floor(num(d.bays, 0))),
  };
}

/* 🔴 RISK UNITS, AND THIS IS THE TRAP IN THIS FEATURE. rigs.data.js stores rig
   risk in PERCENTAGE POINTS, NEGATIVE (-32 = "32 points off") — its own field
   note says exactly that at rigs.data.js:104, and auditRigs() enforces both
   halves at rigs.data.js:558-559 (`risk must be <= 0 (percentage points off)`,
   and a value in (-1, 0) is reported as "looks like a FRACTION"). The paid
   Garage effects table uses THE SAME FIELD NAME for a FRACTION —
   `GARAGE_RIG_FX` at index.html:164432-164436 carries risk 0.05 / 0.12 / 0.22
   against the 0..0.95 clamp named in the comment directly above it
   (index.html:164430). Mixing them is not a rounding error in either direction:
   a -32 read as a fraction annihilates every risk in the game, and a 0.22 read
   as points is 0.22 points off a 30% roll — a rig bought with real money that
   does nothing.
   So this is the ONE place the unit is decided, and it decides by a
   discriminator that cannot be ambiguous: |r| < 1 is unusable as points (0.22
   points is a no-op nobody means), therefore it is the Garage fraction and is
   scaled to points. The magnitude is then taken as a REDUCTION regardless of
   the sign the caller used, because no rig in the game adds risk.

   ⚠ AND NOTHING MULTIPLIES BY IT TODAY (drift R1). transport_quote's risk is
   `least(v_cfg.max_risk_pct, ceil(v_hops * v_cfg.risk_pct_per_hop))` and has no
   rig term at all, so subtracting one here would print a risk the contract row
   cannot hold. This function survives because the unit question above is the
   hard part, and whoever adds a rig term — to sql/038 first, then here — needs
   it. It is reported on the quote as `rigRiskPts` and applied to nothing. */
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

  /* TWO INPUT SHAPES, ON PURPOSE. The pinned contract is { fromId, toId, … };
     index.js's quoteRequest() builds `from` / `to` / `cargo: {resId: units}`
     straight off the form instead (index.js:842-844). Accepting both means one
     resolver serves both call sites rather than two that disagree about which
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
    // Clamped to max_tariff_per_unit_hop exactly as transport_quote does when it
    // reads v_base, so a sheet written before a ceiling was lowered quotes at
    // the ceiling rather than above it.
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
   carried the comment "a same-node haul still bills one hop"; the server
   refuses `same_node` outright, so both quote paths now refuse a 0-hop route
   before anything is priced (drift F3) and nothing reaches this with h < 1
   except a caller who bypassed them. Kept because `hops` is the number
   contracts.js:1059-1060 turns into p_hops — `const hops = (Number.isFinite(
   hopsRaw) && hopsRaw > 0) ? hopsRaw : null` — so a 0 there becomes a null
   p_hops and a `bad_hops` refusal. A floor of 1 keeps a hand-built call
   dispatchable instead of silently unfixable. */
function atLeastOneHop(h) { return Math.max(1, Math.floor(num(h, 1))); }

/* Fares round UP, ONCE, at the end — `ceil(rate × units × hops × escort)`, the
   exact shape of the server's `v_price` and `v_mer_price` (drift A1). Rounding
   the rate first and the fare second is what put 51,501 on the screen against a
   51,250 charge. If the client ever rounds DOWN instead it shows a price below
   what transport_dispatch() charges, and "shown one price, billed another" is
   the failure this repo has already paid for elsewhere. */
function fareOf(rate, units, h, escortPct) {
  return Math.ceil(
    Math.max(0, num(rate, 0))
    * Math.max(0, num(units, 0))
    * atLeastOneHop(h)
    * (1 + clamp(num(escortPct, 0), 0, 100) / 100)
  );
}

/* 🔴 RISK. Server formula, verbatim from transport_quote():
       v_risk := least(v_cfg.max_risk_pct, ceil(v_hops * v_cfg.risk_pct_per_hop))
       escorted: v_risk := floor(v_risk * (100 - v_cfg.escort_risk_cut_pct) / 100.0)
   The escort is a MULTIPLIER, not a subtraction, and there is no base term.
   This file used to add a base of 30 and subtract 22 points for an escort,
   copied from the Foundation Reserve convoy grammar (`FR_CONVOY_RISK = 30` and
   `FR_CONVOY_ESC_CUT = 22`, index.html:61128-61130) — a defensible feel, and
   wrong, because a 1-hop haul printed 30% and the contract row stored 4%
   (drift F1). The Reserve's grammar is the Reserve's; this system's grammar is
   transport_config.

   🔴 THE CLAMP IS THE POINT, NOT DECORATION. `least(max_risk_pct, …)` is the
   server's own upper bound; the lower bound of 0 is this file's, and it exists
   because of the sign. Every term here is non-negative today, but the escort arm
   subtracts inside a multiply and a hand-edited escortRiskCutPct above 100 would
   turn the figure negative. A negative risk prints "−12% risk" to the player and
   — far worse — any consumer reading it as a survival fraction (`1 − risk`) pays
   out 1.12× the cargo, quietly minting freight out of a sign. 100 is the
   absolute upper bound for the same reason in the other direction: a figure
   above it is not a probability at all. */
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
   the empty panel this whole design exists to prevent.
   `serverCode` is the sql/038 error string this refusal corresponds to, or ''
   where there is no server analogue. It is here so a support report can be
   matched against a server log without translating two vocabularies by hand.
   sql/038's own rule ("EVERY REFUSAL IS A DISTINCT SHORT CODE, and every code
   carries the numbers needed to write a sentence") records four wasted
   debugging sessions caused by exactly that kind of mismatch. */
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
    /* `hops` IS A WIRE FIELD, not a display convenience: contracts.js:1059-1060
       reads it and contracts.js:1076 sends it as p_hops, which the server
       multiplies the price by. So it is always the hop count this quote was
       PRICED at — never -1, never 0 — and the ladder's raw answer, sentinel
       included, is reported separately as `hopsMeasured`. Returning -1 here
       would arrive as a null p_hops and a `bad_hops` refusal on a fare the
       player had already agreed to. */
    hops: (o.hops === undefined || o.hops === null) ? 1 : o.hops,
    hopsMeasured: (o.hopsMeasured === undefined || o.hopsMeasured === null) ? HOP_UNREACHABLE : o.hopsMeasured,
    hopsKnown: !!o.hopsKnown,
    cargoUnits: o.cargoUnits || 0,
    // Always 1: one dispatch claims one run (`runs_used + 1`), drift R2.
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
   things sql/038 rejects before it ever looks at a carrier — `same_node`,
   `bad_hops`, `bad_units` — and the cheapest way to keep two functions agreeing
   is for them not to be two functions. Returns null when there is nothing to
   refuse, which is the ONE place in this file where a null means "keep going"
   rather than "no answer"; it never leaves the module. */
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

/* Over transport_config.max_price_per_contract — the server's `over_price_cap`,
   the last check transport_quote makes before it returns a fare. Reachable only
   on an enormous manifest, and the fix is always the same edit: send less at a
   time. Shared because the NPC hits the same wall and must say the same thing. */
function priceRefusal(price, sheet, base) {
  const cap = Math.max(1, num(sheet.maxPricePerContract, SHEET.maxPricePerContract));
  if (price <= cap) return null;
  return shape({ ...base, code: 'over-price-cap', serverCode: 'over_price_cap',
    reason: 'That haul prices at ' + price + ' 🔥, over the exchange ceiling of ' + cap + ' per contract.',
    fix: 'Split the manifest and send it as more than one haul.' });
}

/* 💰 A player carrier's quote.
   TARIFF UNIT: Cinder PER UNIT·HOP, and it is stored in that unit because that
   is what the UI prints. index.js:944 refuses a non-positive rate with "A
   tariff has to be a positive number of Cinder per unit·hop" and index.js:950
   confirms the saved one the same way; the rate board column is headed
   "Tariff 🔥/unit·hop" (depot.render.js:802); the quote sheet prints `q.unit`
   verbatim beside both the base tariff and the exchange ceiling
   (depot.render.js:904 and :914); and the server's own column is named
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
       checks the blacklist in transport_dispatch, not in transport_quote,
       because the board does not publish who has refused whom — the reasoning
       is written out at contracts.js:693-698. */
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
     which is the only one the server can ask (`v_hops > v_reach`, where
     `v_reach := (public.transport_caps(v_co.id)->>'reach')::int` and
     transport_caps publishes `'reach', 3 + c.depot_level`). When the radius
     came from depotEffect() the two numbers are the same `3 + lv`, so this
     second clause is the server's own refusal reproduced locally rather than an
     independent rule. */
  if (!reaches(q.depot, q.fromId, q.toId, q.nodes) || h > q.depot.reach) {
    return shape({ ...base, code: q.depot.present ? 'out-of-reach' : 'no-depot',
      serverCode: q.depot.present ? 'out_of_reach' : '',
      hops: h, hopsMeasured: h, hopsKnown: true,
      reason: q.depot.present
        ? (q.carrierName + "'s depot reaches " + q.depot.reach + ' hop' + (q.depot.reach === 1 ? '' : 's') + ', and this route needs both ends inside that.')
        : (q.carrierName + ' has no Freight Depot, so it has no origin to quote from.'),
      fix: 'Choose a carrier with a yard nearer the cargo, or take the Meridian Haulage quote.' });
  }

  /* An unset sheet is a refusal, not a discount. The server returns
     `no_tariff_published` when `v_base <= 0`; this file used to quote such a
     carrier at the 40 floor, which showed a price no dispatch could ever
     produce. */
  if (!(q.tariff > 0)) {
    return shape({ ...base, code: 'no-tariff', serverCode: 'no_tariff_published',
      hops: h, hopsMeasured: h, hopsKnown: true,
      reason: q.carrierName + ' has not published a tariff.',
      fix: 'Pick a carrier with a rate on the board, or take the Meridian Haulage quote.' });
  }

  /* THE CLAMP, and it clamps the PRICE, not the rate (drift A4: `if v_price >
     v_mer_price then v_price := v_mer_price; v_capped := true`). The difference
     only shows with an escort: clamping the rate and then adding the surcharge
     produced a figure 1 + escort_pct/100 times the server's. The Meridian
     reference is computed WITHOUT an escort because that is what sql/038
     compares against — Meridian sells no escort, so its price has no escort
     term to compare with.
     `capped` tells the UI the asking price was cut to the ceiling;
     depot.render.js:938 prints the "⚖ CAPPED" banner so the player knows why
     the number is not what the board said. */
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
   BY ANOTHER PLAYER. There are five, all caused by the shipper's own manifest
   or their own choice of cargo, and each names the edit that clears it:
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
     risk   identical to a player's, because transport_quote computes `v_risk`
            BEFORE it branches on the carrier and Meridian gets the unescorted
            figure. A player who buys an escort gets 40% of it; Meridian sells
            none. So the NPC is never better on risk either, and that is
            structural rather than guarded.

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
     as a measurement — depot.render.js:910 prints "route not measurable" on the
     Hops line when it is false — while `hops` stays a real, dispatchable number
     because contracts.js:1059-1060 turns it into p_hops. Over-stating is the
     harmless direction: the shipper is charged more for a route they can see is
     a guess, and the server bounds it anyway ("A shipper inflating hops charges
     THEMSELVES more, which is the harmless direction"). */
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

  // server: v_mer_price := ceil(v_mer_base * v_units * v_hops)
  const price = fareOf(rate, q.cargoUnits, h, 0);
  // server: v_mer_eta := ceil(v_hops * v_cfg.minutes_per_hop * v_cfg.meridian_time_mult)
  let etaMinutes = Math.ceil(atLeastOneHop(h) * minutesPerHop * timeMult);

  /* 🔒 DOMINANCE ON TIME, the axis nothing else enforces. The reference is the
     player's own ETA for the identical route — the server's `v_eta := v_hops *
     v_cfg.minutes_per_hop` — and Meridian must land STRICTLY after it. At the
     ratified 1.6 this holds for every hop count and the line does nothing; it
     fires when minutesPerHop has been zeroed in a sheet, where both figures
     collapse to 0 and an untouched NPC would advertise instant delivery. The
     multiplier itself is already refused upstream by timeMultOf().

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
    // DEFINES it. The server agrees by construction — `v_capped` is only ever
    // set inside the player arm's `if v_price > v_mer_price`, so the shared
    // return ships `'capped', v_capped` still false on the NPC path. Flagging
    // it would make depot.render.js:938 print "⚖ CAPPED — this carrier's asking
    // rate is above the exchange ceiling" on the quote of the carrier that IS
    // the exchange ceiling.
    capped: false,
    hops: h,
    hopsMeasured: measured,
    hopsKnown: known,
    runs: 1,
    etaMinutes,
    tripMs: etaMinutes * 60000,
    etaText: etaText(etaMinutes),
    // Unescorted, always — Meridian sells no escort, so `escort` is not even
    // read here. The server's Meridian branch says why in its own comment: a
    // caller asking for one "is not refused, because refusing would make the
    // fallback carrier fail in exactly the situation it exists to cover; the
    // flag comes back false so the UI can say so instead of quietly charging
    // for something it did not sell."
    riskPct: riskOf(h, false, sheet),
    escort: false,
    guarded,
    note: q.escort
      ? 'Meridian Haulage does not sell escorts; this quote runs unescorted.'
      : (known ? '' : 'The node map has not loaded — this fare is priced at the longest route on the board.'),
  });
}
