# FINAL FIX BRIEF — g-seam

## FILES YOU OWN (write ONLY these)
- public/src/transport/index.js
- public/src/transport/transport.bridge.js
- public/index.html

## PINNED FACTS — the same in every brief, do not re-derive
- The server floors are `min_units_per_contract = 1` and `min_price_per_contract = 100`,
  in transport_config. transport_quote refuses with error codes `units_below_min`
  (returning `min_units`) and `under_price_floor` (returning `min_price`).
- Meridian's own floor is 40 x 2.5 = exactly 100, so the price floor refuses nothing
  the NPC carrier could sell. It is a real floor, not a rounding artefact.
- The overlay element id is exactly `mythic-transport-ov`.
- The deploy triple must move TOGETHER to v120w8: public/version.txt,
  `window.BUILD_VERSION` in index.html, and sw.js `CACHE_VERSION`. The transport
  module's script-tag cache-bust (`src/transport/index.js?v=...`) moves with them.

## THE RULE FOR THIS ROUND — IT IS WHY THESE FINDINGS EXIST
Five of the thirteen findings below were INTRODUCED by the last round of fixes, which
over-reached: it added server behaviour with no client mirror, and wrote error messages
promising remedies the build does not implement. So:
  * Prefer the SMALLEST correction that closes the finding.
  * Do NOT add new features, new buttons, or new server levers.
  * Where a COMMENT or an error message promises something the build cannot do, fix the
    COMMENT OR THE MESSAGE — do not build the feature to make the sentence true.
  * Do not add a file:line citation into another file unless you have just verified it
    with sed -n. Wrong citations were finding #6; a citation you cannot verify should be
    written as a named symbol instead ("transport_rigs' status CHECK"), never a number.
This is the FINAL automated round. Anything you leave open gets handed to the human as
open, so close what you can and say plainly what you could not.

======================================================================
## FINDING #1  [contracts / blocking]
WHERE: sql/038_transport_companies.sql:1857 (`under_price_floor`) and :806 (`min_price_per_contract numeric not null default 100`)  ↔  public/src/transport/routes.js:395-411 (SHEET) and :1132 (priceRefusal)  ↔  public/src/transport/contracts.js:270-455 (CODES)

### PROBLEM
THE SERVER GREW A PRICE FLOOR THIS ROUND AND NO CLIENT PATH KNOWS ABOUT IT. transport_quote now refuses `under_price_floor` when `v_price < v_cfg.min_price_per_contract` (default 100), at the single exit both branches pass through, and transport_dispatch returns transport_quote's refusal verbatim (:1984-1986). Three client pieces are out of step and they compound:
  · routes.js's SHEET mirror (:395) carries maxUnits and maxPricePerContract and has NO min_units_per_contract and NO min_price_per_contract, under a PROVENANCE comment claiming "every value is the DEFAULT of the named column, transcribed from sql/038 and re-verified against it on 2026-08-28". Two columns were added to that table and the mirror was not updated.
  · priceRefusal() (routes.js:1132) mirrors only the ceiling — `if (price <= cap) return null` — so there is no floor test anywhere on the quote path.
  · CODES (contracts.js) has no `under_price_floor` entry, so explain()'s unknown arm fires.
DRIVEN against the real modules: `quote({nodes:[N-A,N-B], fromId:'N-A', toId:'N-B', cargoUnits:1, carrier:{tariff:{base:5}, home_node_id:'N-A', depot_level:1}})` returns `{ok:true, price:5}`. index.js:1301 puts that 5 into gcConfirm("Ship for 5 🔥?"), the player says yes, contracts.js escrows the cargo out of the stash, and the RPC answers `under_price_floor`. reasonOf() then prints explain()'s unknown arm: "The freight service refused with a code this build does not know: \"under_price_floor\". Quote that code verbatim to an admin." Any player tariff below 100/(units × hops) does this, i.e. every small haul on the board — Meridian's own minimum fare sits exactly ON the floor (40 × 2.5 × 1 × 1 = 100; measured: meridianQuote at 1 unit/1 hop returns price 100), so the NPC is legal while every cheaper player carrier is not. This is the exact "shown one number, refused by another" failure routes.js's header spends paragraphs forbidding, arriving with an unreadable reason after the money dialog. `units_below_min` is latent only because normCargo() floors units to an integer ≥ 1 (contracts.js:667).
sql/038:243-245 names the gap in the file itself — "'units_below_min' — no CODES entry (contracts.js:269+). 'under_price_floor' — no CODES entry. 'rig_ran_today' — no CODES entry" — and says the migration cannot close it because /src/transport belongs to another seam. The client-side round did not pick it up.

### PROPOSED FIX
Three edits, all client-side. (a) Add the two columns to routes.js's SHEET: `minUnits: 1, // transport_config.min_units_per_contract` and `minPricePerContract: 100, // transport_config.min_price_per_contract`, so sheetOf() carries them and the PROVENANCE comment becomes true again. (b) Add a floor arm to priceRefusal() beside the existing ceiling — it is already shared by the player and Meridian paths: `const floor = Math.max(0, num(sheet.minPricePerContract, SHEET.minPricePerContract)); if (price < floor) return shape({ ...base, code: 'under-price-floor', serverCode: 'under_price_floor', reason: 'That haul prices at ' + price + ' 🔥, under the exchange floor of ' + floor + ' per contract.', fix: 'Send more in one load — the floor is per contract, not per unit.' });` It must REFUSE and not clamp up, matching sql/038:1852's explicit note that clamping would charge more than the sheet the player was shown. (c) Add the three missing CODES entries in contracts.js (`under_price_floor` off `d.price`/`d.floor`/`d.units`, `units_below_min` off `d.min_units`, `rig_ran_today` off `d.used`/`d.cap`), each surviving an empty `d`. Cite sql/038 by SYMBOL, not line, per routes.js's own citation rule.

======================================================================
## FINDING #2  [contracts / blocking]
WHERE: public/src/transport/index.js:1022-1023 (`carrier.depot` nodeId) and :1043 (`depot: carrier ? carrier.depot : null`)  ↔  public/src/transport/contracts.js:983 (createCompany's home_node_id fallback)  ↔  public/src/transport/routes.js:835 (resolveDepot: `if (!d || !nodeId) return { present:false, … }`)

### PROBLEM
THE FIX FOR THE SHIPPER/CARRIER DEPOT MIX-UP MADE A NULL `home_node_id` FATAL, WITH NO WAY BACK. quoteRequest() now builds the quote's only depot from the carrier row — `{ nodeId: row.home_node_id || row.homeNodeId || '' }` merged with depotEffect(depot_level) — and passes it as the sole `depot:`. resolveDepot() decides `present` by nodeId ALONE (routes.js:835, its own comment says so), so an empty nodeId yields `{present:false, reach:0}` and quote() refuses at :1217 with code 'no-depot'.
`transport_companies.home_node_id` is nullable (sql/038:319) and createCompany() sets it to `b.campNodeId()` when the caller passes none — which index.js:1178 always does, calling `createCompany({ name })`. `campNodeId()` is `Profile.campNodeId || null` (index.html:208154), set only by registering a camp to a Territory Wars node (index.html:216065); it is null for every player who has not done that.
DRIVEN both directions against routes.js — carrier `{id:'c1', name:'My Haulage', tariff:{base:200}, depot:{nodeId:'', bays:2, fleetCap:4, radius:4}}`, N-A→N-B, 10 units:
  · as index.js now sends it: `{ok:false, code:'no-depot', reason:"My Haulage has no Freight Depot, so it has no origin to quote from.", price:null}`
  · with the pre-fix top-level shipper depot `{nodeId:'N-A', radius:4, bays:2}`: `{ok:true, price:2000}`
So the fix converts a harmless null into a carrier that can never quote anything — including for its OWN OWNER, whose Depot tab is at that moment drawing a working yard with a real nodeId out of depotReady() (depot.js:825 reads `best.nodeId`, the PLACED BUILDING's node, not the camp node). There is no recovery: transport_companies has no UPDATE policy and UPDATE/DELETE are revoked (sql/038:1365), and transport_set_sheet takes p_company_id/p_tariff/p_status/p_depot_level/p_blacklist and no home node — the column is write-once at insert. That player's only carrier is Meridian at the 2.5× ceiling, permanently. The server does NOT agree: transport_quote's only reach test is `v_hops > v_reach` and there is no adjacency table, so this is the client refusing a haul the exchange would take.
Secondary, same line: even when campNodeId IS set it is the CAMP's node, while the yard granting the reach stands wherever the Freight Depot was placed, so reaches() measures from a node the depot is not in.

### PROPOSED FIX
Give createCompany the yard's node instead of the camp's. In index.js's 'register' branch: `const yard = call(depotReady, null); … acall(createCompany, {ok:false}, { name, homeNodeId: (yard && yard.nodeId) || null })` — depotReady() already refuses with code 'no-origin' when it has no nodeId, so this cannot silently send ''. Keep contracts.js's campNodeId() as the second fallback. Then refuse the registration outright when both are empty, with a sentence, rather than writing a row that can never quote — a charter with no origin is not a recoverable state, because nothing in this build can set home_node_id afterwards. Record in the comment at index.js:1022 that home_node_id is WRITE-ONCE (no UPDATE policy, no set_sheet parameter), since that is the fact that turns a null here into a permanent one.

======================================================================
## FINDING #3  [contracts / moderate]
WHERE: public/src/transport/index.js:544-548 (carrierBlock: `reliability: num(c.reliability)`, `coverage: num(c.coverage)`)  ↔  public/src/transport/depot.render.js:161-187 (N / pctText) and :1020-1031  ↔  sql/038_transport_companies.sql (transport_companies.reliability, nullable by design)

### PROBLEM
THE RENDERER'S THREE-WAY NULL DISCIPLINE IS DEFEATED ONE FILE UPSTREAM, ON THE TWO COLUMNS THAT DECIDE WHO A SHIPPER HIRES. depot.render.js goes to real lengths over this: N() is idempotent over null with a comment recording that an already-N'd null re-coerced by Number() "came back out as 0 even at a call site that had checked for null first", pctText(null) prints '—', and carrierRow() explicitly handles `N(c.coverage) === null` as '—'. index.js's carrierBlock() then hands it numbers those branches can never see, because index.js's `num` is `(v,d) => { const n = Number(v); return Number.isFinite(n) ? n : (d||0); }` and `Number(null)` is 0, not NaN.
  · `reliability` is NULL on every carrier until a haul settles — tco_ins pins it null deliberately ("a founder who could pick their own opening reliability would start at 100% and never earn it") and transport_settle is its only writer.
  · `coverage` is not a column at all — listCarriers() selects id,owner_id,name,home_node_id,depot_level,tariff,reliability,status,created_at — so `c.coverage` is undefined, `Number(undefined)` is NaN, the `d||0` fallback fires, and 0 is emitted.
DRIVEN: renderExchange() fed exactly what carrierBlock() emits for a fresh row prints `<td>0%</td><td>0 pairs</td>`. The rate board therefore advertises every newly founded player carrier as 0% reliable and serving 0 node pairs, in the same table as the NPC row printing 100% and 'every pair' — the strongest possible argument for taking the Meridian quote, made about a carrier the server has said nothing about.
The same function gets it right ten lines earlier for freeBays, with the reasoning spelled out: "Unknown is NOT zero. `0 free bays` reads as 'full' and would quietly route the shipper to Meridian at 2.5× over a column the rate board simply did not send." That sentence is true of these two columns and they were not given the treatment.

### PROPOSED FIX
Use the null-preserving shape carrierBlock already uses for freeBays and let the renderer's '—' do its job: `reliability: (c.reliability === null || c.reliability === undefined) ? null : num(c.reliability),` and `coverage: (c.coverage === undefined && c.coverageCount === undefined) ? null : num(c.coverage !== undefined ? c.coverage : c.coverageCount),`. Both pctText() and the coverage cell already render null as '—' with no further change. Note that `coverage` has no column in transport_companies today, so null is the only honest value until one exists, and cite carrierBlock's own freeBays paragraph as the precedent so the three columns now agree.

======================================================================
## FINDING #10  [regression / moderate]
WHERE: public/src/transport/index.js:712-719 (refresh) vs index.js:827, :843, :854, :860 and index.html:80352

### PROBLEM
THE REOPEN PATH — THE WHOLE POINT OF THIS ROUND'S FIX — SWALLOWS EVERY REFUSAL SENTENCE IT WROTE. refresh()'s new durable trigger calls `const r = await seedStarter(S.rigs)` and then reads ONLY `if (r && r.seeded)`. `r.why` and `r.fix` are dropped on the floor. The four sentences this round added to seedStarter — 'spent' (:827), 'full' (:843), 'nobridge' (:854) and the generic retry (:860) — are reachable from NOWHERE ELSE: the only other caller, `onCharterFounded` (index.js:1474-1475), does toast them, but it runs once at founding, where index.html has already printed its own version of the same message. DRIVEN, with a stub bridge whose `grantStarterRig` answers 'spent': open() plus two more refresh() calls produced 3 grantStarterRig calls and 0 toasts, and the rendered panel contains no mention of the starter rig at all (the charter tab prints 'CHARTERED', 'register on the exchange' and nothing else). So index.html:80352 tells the player "free a slot and reopen the Freight Depot to claim it" — they reopen, the lot is still full, and the depot says nothing. Worse for 'spent': index.html:80353-80361's comment says the dedicated 'spent' sentence exists precisely so the player is not "sent round a loop that cannot end", and on the only path that can produce it the player gets silence while `_starterSeeded` is released so it re-asks on every refresh — which is that loop, run silently.

### PROPOSED FIX
Surface the refusal from refresh(), once per session so the every-action cadence cannot spam it. In the block at index.js:713-719: `const r = await seedStarter(S.rigs); if (r && r.seeded) { ...existing refetch... } else if (r && r.ok === false && r.why && !_starterToldWhy) { _starterToldWhy = true; b.toast('🚛 ' + reasonOf(r), 6200); }` with a `let _starterToldWhy = false;` beside `_starterPending` (~index.js:114), cleared when a seed succeeds. reasonOf() already concatenates why + fix and is the same shape index.js:1475 uses. Note in the comment at index.js:713 that seedStarter's return is a player-facing refusal and not merely a seeded flag — that is the fact the `if (r && r.seeded)` line silently discarded.

======================================================================
## FINDING #11  [regression / moderate]
WHERE: public/version.txt, public/index.html:36444, public/sw.js:414, public/index.html:223856 — all four byte-identical to HEAD

### PROBLEM
THE DEPLOY TRIPLE AND THE MODULE CACHE-BUST DID NOT MOVE FOR THIS ROUND, SO TWO DIFFERENT BUILDS NOW SHARE ONE VERSION STRING. `git show HEAD:public/version.txt` -> v120w7; HEAD's `window.BUILD_VERSION` -> v120w7; HEAD's sw.js -> `mythic-v120w7-transport-wiring`; HEAD's script tag -> `src/transport/index.js?v=v120w7tr1`. All four are unchanged in the working tree, while index.html gained 190 lines (a new bridge key, a new Profile field, a new toast branch) and four /src/transport modules changed substantially. The knobs 'agree' only in the sense that they still name the pre-fix build. index.html:223852-223855's own comment states the rule for the fourth: "Bump ?v= on every change — the service worker serves /src/* network-first but the HTTP cache still applies, and the sub-modules ... are imported by bare relative specifier and carry no query string of their own, so this tag is the only cache-bust the whole feature gets." Consequences if v120w7 ever reached the edge: the update check at index.html:36468-36476 compares the running BUILD_VERSION against version.txt and both are unchanged, so no returning player is offered the update; sw.js's activate/reap only runs when the SW script bytes change and CACHE_VERSION is unchanged, so nothing is reaped; and on any load not yet controlled by the SW the four changed modules keep the HTTP cache key ?v=v120w7tr1. Navigations bypass the SW (sw.js:470-478) so index.html itself stays fresh — which makes the failure mode the bad one: NEW index.html paired with STALE modules, the exact pairing sw.js:481-489 went network-first to prevent and the shape that produced "canFoundCommunity is not a function".

### PROPOSED FIX
Bump all four together as one edit: public/version.txt -> v120w8, index.html:36444 `window.BUILD_VERSION = 'v120w8'`, sw.js:414 `CACHE_VERSION = 'mythic-v120w8-transport-fixes'`, and index.html:223856 `src/transport/index.js?v=v120w8tr1`. The fourth is the one this repo has no other guard for and it is not part of the CLAUDE.md triple, so add it to the deploy note beside the other three.

======================================================================
## FINDING #12  [regression / minor]
WHERE: public/index.html:208141 (`if (!_transportOwnsCharter()) return 'nocharter';`) vs index.html:80446 and public/src/transport/index.js:712

### PROBLEM
THE NEW MINT'S ONLY GATE ANSWERS TRUE FOR EVERY ADMIN, AND THE NEW TRIGGER FIRES WITHOUT A CHARTER. `_transportOwnsCharter()` (index.html:80444-80449) opens with `if (typeof isAdmin === 'function' && isAdmin()) return true;` — a deliberate convenience when it powered only a launcher badge (115007) and a read-only bridge key (208028). This round made it the sole gate on a Cinder-valued mint: grantStarterRig (208139-208152) checks it and nothing else, and refresh()'s new trigger `_starterPending || (!S.rigs.length && !!call(b.ownsCharter, false))` (index.js:712) is TRUE for an admin who has never founded anything, because their fleet is legitimately empty. Net: an admin who merely opens the Freight Depot has a haul-class rig minted onto their Prince Portfolios lot at `price: fair` (~43k, index.html:80557) and `p.starterRigIssued` written. Before this round the helper had exactly one call site — inside `if (opId === 'transport')` in _opAfterFound — which runs only after a real founding, so `ownsCharter`'s admin arm had never gated a mint. This is the risk the bridge banner at index.html:208108-208112 claims to have closed ("A module bug cannot hand a free vehicle to someone who never founded a Transportation Company"): the sentence is true of a module bug and false of the admin arm sitting inside the gate it names.

### PROPOSED FIX
Gate the mint on a real charter rather than on the licence-shaped helper. In index.html:208141 use the ops list directly — `if (!_transportOps().length) return 'nocharter';` — which is what _transportOwnsCharter reduces to for a non-admin, and leave _transportOwnsCharter alone so the launcher badge and the read-only bridge key keep their admin convenience. Record in the comment at 208108 that ownsCharter() answers true for admins and that this is why the mint does not use it, so the next reader does not "simplify" the two back together.
