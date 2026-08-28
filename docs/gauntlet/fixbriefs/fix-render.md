# FIX BRIEF — fix-render

Close EVERY finding below. Each was found by an integration agent that read the real
files across seams, and each was verified against running code. The proposed fix is a
strong suggestion, not a mandate — if you find a better one, take it and say why.

## FILES YOU OWN (write ONLY these)
- public/src/transport/depot.render.js

## PINNED SHARED CONSTANT
The overlay element id is exactly `mythic-transport-ov`. index.js declares it as OV
(index.js:66); depot.render.js must key its CSS rule to that same literal. Both files
must carry a comment naming the other side, because the id lives in one file and the
CSS in another.


======================================================================
## FINDING #1  [contracts]
WHERE: public/src/transport/depot.render.js:698 and :734  ↔  sql/038_transport_companies.sql:415 and :1619

### PROBLEM
THE RIG STATUS VOCABULARY IS WRONG. sql/038:415 declares `transport_rigs.status text ... check (status in ('idle','hauling','assigned','retired'))` and transport_dispatch:1619 sets `status = 'hauling'` when a rig goes out. There is no 'in_transit' on a rig — that is the CONTRACT ladder (sql/038:458-459). depot.render.js tests `status === 'in_transit'` in both places it matters, and index.js's fleetBlock() passes the column through verbatim (`status: row.status || 'idle'`, index.js:625), so a rig actually hauling arrives as 'hauling'. Two consequences, both driven against the real renderer: (1) the 'Out on a haul' info banner never fires; the row falls through to the else-arm at :700 and prints `Status "hauling" is not one this build recognises`, telling the player a normal rig is in an unknown state; (2) `repairable = !!vid && status !== 'retired' && status !== 'in_transit'` is TRUE for 'hauling', so the Repair button renders ENABLED on a rig mid-haul. Clicking it runs contracts.js repair(): gcConfirm → spendGems(bill.cinder) → takeRes(parts) → persist → transport_repair() refuses with `rig_in_transit` (sql/038:1928) → unwind. A real Cinder+parts spend and refund round trip on a button the panel's own status table was written to disable. Measured: renderFleet({fleet:[{status:'hauling',...}]}) emits `<button ... data-mt="repair" data-mt-id="v1">` with no disabled attribute and the unrecognised-status banner.

### PROPOSED FIX
In depot.render.js, replace both `'in_transit'` tests with the server's rig vocabulary. Line 698: `} else if (status === 'hauling' || status === 'assigned' || str(r.assignedTo)) {`. Line 734: `const repairable = !!vid && status !== 'retired' && status !== 'hauling';`. Keep the else-arm at :700 for genuinely unknown values. Cite sql/038:415 in a comment so the next edit reads the CHECK constraint rather than guessing, and note that 'in_transit' is the contract ladder, not the rig one.

======================================================================
## FINDING #6  [contracts]
WHERE: public/src/transport/depot.render.js:1073-1077  ↔  sql/038_transport_companies.sql:458-459 and :1822-1824

### PROBLEM
THE CONTRACT STATUS VOCABULARY DOES NOT MATCH THE COLUMN'S CHECK. sql/038:458-459 declares `status text ... check (status in ('in_transit','delivered','lost','late','refused'))`, and transport_settle:1822-1824 writes 'delivered' or 'lost' and sets `settled_at` — there is no separate 'settled' state and never an 'arrived'. CONTRACT_STATE (depot.render.js:1073) invents `arrived` and `settled`, which the exchange can never emit, and omits `late` and `refused`, which the constraint permits (sql/038 says nothing produces them yet, so that half is only a latent gap). The live consequence is the 'delivered' arm at :1076: a contract that HAS been settled reads back as `delivered`, and the panel prints '📥 Delivered.' with the fix 'Settle it to close the contract out' beside a live Settle button — instructing the player to settle a haul that is already closed. contracts.js's settle() then answers `retried: true` and credits nothing (contracts.js:1220), which is correct server-side but reads to the player as a delivery that would not deliver.

### PROPOSED FIX
Align the map to the column. Delete the `arrived` and `settled` entries; reword `delivered` to a terminal state — `delivered: { kind: 'ok', text: '📥 Delivered — the cargo is in the stash.', fix: '' }` — and add `late` and `refused` entries so the constraint's full ladder is covered when something starts producing them. Then suppress the Settle button for terminal rows: at depot.render.js:1110 pass `disabled: !id || status === 'delivered' || status === 'lost'`. Cite sql/038:458-459 (the CHECK) and :1822 (the only writer) in a comment, since the invented names are what made this drift invisible.

======================================================================
## FINDING #12  [regression]
WHERE: public/src/transport/index.js:66,1102-1112 (transport-seam) vs public/src/transport/depot.render.js:245-330 (depot-render)

### PROBLEM
The Freight Depot overlay element has no CSS anywhere in the repo. open() creates `<div id="mythic-transport-ov">`, appends it to document.body, and attaches a click-outside handler commented "matching every other overlay in the game" — but TRANSPORT_CSS defines only `.mt-*` class rules; `awk 'NR>=245&&NR<=330' depot.render.js | grep 'position:fixed|z-index'` returns nothing, and `grep -rn mythic-transport-ov public/src/` returns exactly one hit (the const declaration at index.js:66), with 0 hits in index.html. paint() sets no inline style either. The sibling this pattern was copied from does supply it: public/src/community/community.render.js:74 emits `#${OV}{position:fixed;inset:0;z-index:2147483200;background:rgba(6,5,12,.86);backdrop-filter:blur(5px);...}`. Net effect: clicking the launcher tile appends an unstyled block-flow div at the end of <body>. The depot renders BELOW the entire game in normal document flow instead of over it, it lengthens the page's scroll height, and the click-outside close is unreachable because the div is only as tall as its content — leaving the panel with no exit unless a close button exists inside .mt-wrap. Two pieces each assumed the other owned the overlay rule: transport-seam owns the element, depot-render owns the stylesheet, and neither shipped it.

### PROPOSED FIX
Add the overlay rule to TRANSPORT_CSS in public/src/transport/depot.render.js, keyed to the same id the seam uses (`#mythic-transport-ov{position:fixed;inset:0;z-index:2147483200;overflow:auto;background:rgba(6,5,12,.86);backdrop-filter:blur(5px)}`), matching community.render.js:74. Since the id string lives in index.js:66 and the CSS lives in another file, either export OV from one place and interpolate it (community.render.js does `#${OV}{...}`), or write the literal id with a comment in both files naming the other.
