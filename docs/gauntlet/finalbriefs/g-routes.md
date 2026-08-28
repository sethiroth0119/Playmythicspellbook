# FINAL FIX BRIEF — g-routes

## FILES YOU OWN (write ONLY these)
- public/src/transport/routes.js

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
