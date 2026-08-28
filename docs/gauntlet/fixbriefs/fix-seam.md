# FIX BRIEF — fix-seam

Close EVERY finding below. Each was found by an integration agent that read the real
files across seams, and each was verified against running code. The proposed fix is a
strong suggestion, not a mandate — if you find a better one, take it and say why.

## FILES YOU OWN (write ONLY these)
- public/src/transport/index.js
- public/src/transport/transport.bridge.js
- public/index.html

## PINNED SHARED CONSTANT
The overlay element id is exactly `mythic-transport-ov`. index.js declares it as OV
(index.js:66); depot.render.js must key its CSS rule to that same literal. Both files
must carry a comment naming the other side, because the id lives in one file and the
CSS in another.


======================================================================
## FINDING #2  [contracts]
WHERE: public/src/transport/index.js:850 (quoteRequest)  ↔  public/src/transport/routes.js:956 (resolveInput)

### PROBLEM
THE SHIPPER'S OWN YARD OVERRULES THE CARRIER'S, SO THE CLIENT MEASURES REACH AGAINST THE WRONG DEPOT. index.js:825-831 builds `carrier.depot` from the carrier's `home_node_id` + `depot_level` under the comment "The carrier's OWN yard decides reach, not the shipper's" — then index.js:850 ALSO sets a top-level `depot:` from depotBlock(b,…), which is the SHIPPER's yard (index.js:996 passes `depotBlock(b, !b._null)`). routes.js:956 resolves `depot: resolveDepot(i.depot || (carrier && (carrier.depot || carrier)))` — `i.depot` WINS — so `carrier.depot` is dead on every path where the shipper owns a Freight Depot, and quote()'s two reach tests at routes.js:1210 run against the shipper's radius. The server does the opposite: transport_quote:1367 reads `v_reach := (public.transport_caps(v_co.id)->>'reach')::int` — the CARRIER's company row. routes.js:956's own comment justifies the precedence as "a caller holding a fresher depot… is not overruled by a stale row", which is only true when i.depot is the same carrier's yard; index.js hands it a different party's. DRIVEN: a rival carrier with a reach-1 yard at N-A, a shipper with a reach-6 yard at N-A, route N-A→N-C (5 hops). With the shipper depot passed: `{ok:true, price:500}`. With it omitted: `{ok:false, code:'out-of-reach', reason:"Rival's depot reaches 1 hop…"}`. The player is quoted and confirms a fare the server then refuses as `out_of_reach` — and in the opposite direction a shipper with a small yard is refused a haul a large carrier could legally take. This is the 'shown one number, refused by another' failure both files spend paragraphs forbidding.

### PROPOSED FIX
Stop sending the shipper's yard as the quote's depot for a player-carrier quote. In index.js:850, use the carrier's yard when there is a carrier: `depot: carrier ? carrier.depot : (depot && depot.nodeId ? { nodeId: depot.nodeId, radius: depot.radius, bays: depot.bays } : null)`. Meridian (npc, carrier === null) legitimately has no depot — meridianQuote() has no reach check — so the null there is correct. Alternatively invert the precedence in routes.js:956 to `(carrier && (carrier.depot || carrier)) || i.depot`, but the index.js fix is the narrower one and leaves routes.js's stated contract intact. Record in the comment at index.js:825 that i.depot outranks carrier.depot inside resolveInput, since that is the fact that made the existing comment untrue.

======================================================================
## FINDING #3  [contracts]
WHERE: public/src/transport/index.js:1022 and :1038  ↔  sql/038_transport_companies.sql:1621 and :1635

### PROBLEM
A RIG FROM THE PLAYER'S OWN FLEET IS SENT AS `p_rig_id` FOR A RIVAL'S `p_carrier_id`. index.js:1022 sets `rigId: npc ? '' : ownRigRowId()`, and ownRigRowId() (index.js:878-889) filters `String(r.company_id) === String(S.company.id)` — the player's OWN charter, with no reference to the carrier the quote was for. Nothing on the quote path restricts the carrier selection to the player's own company: carrierBlock() lists every open carrier from listCarriers(), and the rate board's Quote button stamps that carrier's id. transport_dispatch claims the run under `where r.id = p_rig_id and r.company_id = p_carrier_id` (sql/038:1621) and, when that matches nothing, diagnoses `rig_not_in_fleet` (sql/038:1635). The guard at index.js:1038 (`if (!q.meridian && !q.rigId)`) only fires when the player has NO usable rig — exactly the case where the mismatch cannot happen. So a player who owns a fleet and picks a rival carrier passes the guard, is charged nothing but is refused `rig_not_in_fleet` after confirming a fare. index.js:853-864's own comment claims that dispatch 'is refused HERE with a sentence instead of being fired at the RPC', which is what the code does not do.

### PROPOSED FIX
Make the rig pick carrier-aware and let the guard cover the mismatch. In index.js, change ownRigRowId() to take the carrier id — `function ownRigRowId(carrierId) { … .filter(r => r && String(r.company_id) === String(carrierId) && …) }` — and call it as `rigId: npc ? '' : ownRigRowId(q.carrierId || sel.carrierId)`. It returns '' for any carrier that is not the player's own (their rigs are invisible under trg_sel anyway), so the existing refusal at index.js:1038 then fires with the sentence its comment promises, before the confirm dialog rather than after it.

======================================================================
## FINDING #13  [regression]
WHERE: public/index.html:80337-80341 (legacy-wiring) vs public/src/transport/index.js:666-718 (transport-seam)

### PROBLEM
Both sides promise a starter-rig retry that no code performs. index.html's transport arm of _opAfterFound toasts, on the 'full' return, "⚠ Your vehicle lot is full, so the starter rig could not be parked — free a slot and reopen the Freight Depot to claim it", and on any other failure "open the Freight Depot and it will try again". The module's seedStarter() (index.js:688-696) mirrors it from the other side: when it finds no haul-class truck on the lot it sets _starterPending=true and returns fix "The charter grants the starter rig onto the Prince Portfolios lot; reopen the Freight Depot once it lands." But nothing ever makes it land. _transportGrantStarterRig() (index.html:80450) is called from exactly one site — `grep -n _transportGrantStarterRig public/index.html` gives the definition plus the single call inside `if (opId === 'transport')` — which runs only at founding, and index.html deliberately exposes no vehicle-creating method on MythicTransportBridge (verified: the 36-key set has lot/lotCap/setRigField and nothing that pushes to p.lot). seedStarter's own comment at index.js:683-687 states this correctly ("This module has no lot writer BY DESIGN") while its `fix` string tells the player the opposite. A player whose Prince Portfolios lot is full at charter time is permanently rigless, and _starterPending retries forever against a lot that will never gain a truck.

### PROPOSED FIX
Make the grant reachable after founding. Cheapest: expose the existing index.html helper on the bridge (e.g. `grantStarterRig: () => { try { return _transportGrantStarterRig(); } catch (e) { return 'error'; } }`), add it to NULL_BRIDGE in public/src/transport/transport.bridge.js to keep the pinned key set intact, and have seedStarter() call it once when the lot holds no haul vehicle before setting _starterPending. It stays index.html's mint (the module still cannot conjure a vehicle) and _transportGrantStarterRig's existing 'already' guard keeps it idempotent. If that is out of scope for r1, delete the retry promise from both message strings and say the rig is issued at founding only.

======================================================================
## FINDING #14  [regression]
WHERE: public/index.html:196168-196201 (_ppGenListing, legacy-wiring) — effect on the Prince Portfolios scrap path at 196326-196337

### PROBLEM
The 18% haul share moves a number in an existing system that no comment names. Rig baseValues run 46,000–3,400,000 (public/src/transport/rigs.data.js:221-263) against the existing PP_VEHICLE_NAMES range of 9,200–388,000 (index.html:195563-195582). price, estPartValue and listPrice all derive from base.baseValue, so the dealership floor's top-end listing price rises roughly tenfold — and ppScrapVehicle() at index.html:196331 pays `Math.round(v.price * 0.10 / 100) * 100` straight through addGems(), so the per-vehicle scrap faucet's ceiling moves from ~35k to ~300k Cinder. It is not an exploit (scrapping is always a 90% loss on the purchase, and stripping via ppStripVehicle yields PP_PARTS quantities that do not scale with baseValue — verified at 196369-196394), but the free starter rig is minted at zero cost with `price: fair` (~43k for the common rig at 'Clean') and is immediately scrappable for ~4,300 free Cinder. The comment block on this hunk is otherwise exhaustive about what it does and does not change; this is the one economy consequence it omits, and CLAUDE.md makes that omission the defect.

### PROPOSED FIX
Add a line to the _ppGenListing comment block naming the consequence: haul baseValues are ~9x the car table's ceiling, so the derived price/estPartValue/listPrice ceilings and ppScrapVehicle's 10% refund ceiling all scale with them, and the free starter rig is scrappable for ~10% of its fair value once per charter. If the free-rig scrap faucet is unwanted, the cheap fix is to mint the starter rig with `price: 0` (listPrice still derived from fair) — but only if nothing else on the lot path divides by price.
