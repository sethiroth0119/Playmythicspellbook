# FINAL FIX BRIEF — g-render

## FILES YOU OWN (write ONLY these)
- public/src/transport/depot.render.js

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
## FINDING #6  [contracts / minor]
WHERE: public/src/transport/depot.render.js:736-742, :788-792, :1170-1176 and :1240 — the sql/038 line citations added this round

### PROBLEM
THE NEW COMMENTS REINTRODUCED COLON-AND-LINE CITATIONS INTO sql/038 AND EVERY ONE OF THEM IS ALREADY WRONG. Checked line by line with `sed -n` against the file as it stands:
  · ":596" for transport_rigs' status CHECK — line 596 is `--    client claims that ladder produced. The server honours`; the CHECK is at :618-619.
  · ":2018" for transport_dispatch setting `status = 'hauling'` — line 2018 is a comment about reliability griefing; the assignment is at :2062.
  · ":2353" for `create or replace function public.transport_repair` — line 2353 is `and k.shipper_id <> c.owner_id`, inside transport_settle; the function is at :2397.
  · ":2386 / :2393 / :2396" for rig_in_transit / rig_retired / rig_is_salvage — all three are comment prose; the raises are at :2430 / :2437 / :2440.
  · ":2255" for "transport_settle … is the ONLY writer … sets status to 'delivered' or 'lost' AND settled_at in one UPDATE" — line 2255 is the `if v_ct.status <> 'in_transit'` GUARD; the UPDATE is at :2299.
  · ":2211" for that same guard — line 2211 is a comment about server-rolled risk.
This matters more here than it usually would, because it is the failure mode this repo has already written up twice: sql/038's own header says "that file grew ~800 lines this round and every colon-and-number citation into it went stale", routes.js:391-394 refuses line numbers outright ("that migration is applied by hand and renumbers"), and one of these very comments says ":2396 — grep `rig_is_salvage`; the line number moves, the token does not" while the lines beside it do the opposite. A reader who follows :2255 lands on the guard and concludes the guard is the settle writer — which is the one distinction the settle-button fix turns on.

### PROPOSED FIX
Replace the numbers with tokens, the way the salvage line already does: cite transport_rigs' status CHECK by its constraint text, transport_dispatch's `status = 'hauling'`, transport_repair's `rig_in_transit` / `rig_retired` / `rig_is_salvage`, and transport_settle's `if v_ct.status <> 'in_transit'` (the guard) and its `set status = v_status, settled_at = now()` (the writer) — naming both explicitly, since conflating them is exactly what the current numbers encode. Add a line to the CONTRACT_STATE header pointing at routes.js:391-394 as the standing rule for this file, so the next round does not add more.
