# BRIEF — index.html — the transport bridge, the charter op, the haul listings and the deploy knobs

## GOAL
Make every legacy-side edit the feature needs, as small additive hunks in the house idiom, plus the three deploy knobs. In public/index.html: (1) the `transport` entry in OPS_ECON and the label in OP_LABELS; (2) fix the duplicated inline `opNiceName` map so the purchase modal names the business correctly; (3) a `transport` arm in the founding-unlock blurb; (4) a `transport` block in `_opAfterFound()` plus an ownership predicate that derives from Operations.list rather than a stored flag; (5) the new `window.MythicTransportBridge` block next to MythicCityBridge; (6) the haul-class roll inside `_ppGenListing()`, additive so an ordinary car listing is field-for-field identical to before; (7) the launcher tile; (8) the `<script type="module">` tag with its comment and `?v=`, plus a `?v=` bump on the city module. In public/version.txt and public/sw.js: the matching version bumps. Delete nothing, reindent nothing, and preserve every existing comment.

## FILES YOU OWN (write ONLY these)
- public/index.html
- public/version.txt
- public/sw.js

## ACCEPTANCE CRITERIA (a critic verifies each against your real output)
1. `node /home/user/Playmythicspellbook/_synckcheck.mjs public/index.html` passes. (Run `npm install` first if needed — terser and wrangler are already in package.json devDependencies; installing them is not a new dependency. package.json and package-lock.json must show NO diff.)
2. `git diff --stat public/index.html` shows a small additive hunk count. Zero reindentation, zero restructuring, zero deleted or reworded pre-existing comments anywhere in the diff.
3. `OPS_ECON.transport` is inserted immediately after the `bank:` entry (currently line 79770) and before the closing `};` (currently 79771), comment-first in the local idiom, with `yields: {}` present and a comment explaining it in the `bank` entry's own terms: a carrier earns Cinder in freight fees, not resources, so it must never be swept up by the production-pressure hook cxProduce (index.html:191773, fed at 80381/80434 from the computed yields map). Values: startup 650000, ratePerWorkerHr 1000, salaryPerWorkerHr 300, maxWorkers 10, yields {}, inputs { fuel: 1.4 }.
4. `OP_LABELS.transport = 'Transportation Company'` is added (block at 79979-79990). The in-file comment at 79985-79988 already explains it is required, not cosmetic.
5. The duplicated inline map at 82287-82293 is replaced with `const opNiceName = (OP_LABELS && OP_LABELS[a.op]) || (a.op.charAt(0).toUpperCase() + a.op.slice(1));` and a comment recording that the map had already drifted (warehouse and genelab were missing from it, so both rendered via the charAt fallback) and that a second copy is why. Verifiable: the modal now says 'Transportation Company', 'Warehouse' and 'Genetics Lab'.
6. A `transport` arm is added to the unlock-blurb ternary chain at 82307-82315, in the same markup style as the `cars` arm, telling the buyer the Freight Depot screen is what they are also unlocking.
7. `_opAfterFound()` (function at 80199, closing `}` at 80270) gains a `transport` block appended before that closing brace, in the same `if (opId === '…') { try { … } catch (_) {} }` shape as the `cars` block at 80213-80227. It calls `window.MythicTransport.onCharterFounded({ free:true })` guarded by a typeof check, saves, and toasts. It has an ELSE branch that says out loud that the module has not loaded rather than silently founding a company with no screen.
8. An ownership predicate is added in the shape of `_dojoOwnsLicense()` (80272-80280) / `_geneLabOwnsLicense()` (80287-80295) — derived from `Operations.list` / `_opsAllRows()`, not from a stored boolean — with a comment naming the failure it prevents: `ppIsUnlocked()` at 195778 exists precisely because a stale cloud profile loaded with owned=false left the screen empty, and a feature whose only unlock hook is `_opAfterFound` loses its unlock on exactly that reload.
9. `window.MythicTransportBridge` is inserted as a new top-level block immediately after MythicCityBridge's closing `};` at line 207504 and before the `/* 🏦 CITY → OPS VAULT.` comment at 207505. It has its own globals-trap banner in the house style.
10. The bridge's key set is EXACTLY the pinned list in the context below — no more, no fewer — so it matches the NULL_BRIDGE another builder is writing. Every accessor is a FUNCTION, never a snapshot, with the staleness reason stated; the two exceptions (collectCdMs, accrualCapH) are constants passed through from OP_COLLECT_CD_MS / OP_ACCRUAL_CAP_H with a comment saying the idle contract is passed, never redeclared.
11. Every bridge method is try-wrapped and returns a typed default; nothing throws across the seam. Every MUTATOR returns a boolean, and a comment explains why a wrapper returning `undefined` on success would make the module's rollback path fire on a leg that actually worked. `refundRes` (uncapped undo) and `addRes` (capped add) are both present and the distinction is explained as a safety property.
12. `setRigField` uses an explicit key ALLOW-LIST (not a free write) and returns false for anything outside it.
13. `_ppGenListing()` (195910-195932) is changed additively: a non-haul listing produced after the change is FIELD-FOR-FIELD IDENTICAL to one produced before, including the existing `rarity: condition === 'Pristine' ? 'rare' : 'common'` rule for ordinary cars. All six existing callers (80220, 195776, 195791, 195951, 195956, 195959) are untouched. The haul branch reaches `window.MythicTransport.rollRig()` with a typeof guard and falls back to `_ppPick(PP_VEHICLE_NAMES)` when the module is absent. Haul-only fields are spread conditionally so a car listing gains no new keys.
14. PP_VEHICLE_NAMES (195315-195335) is NOT widened with rig entries, and a comment says why: the admin photo grid at 197455 keys `f.listingPhotos[v.name]` off that shared name namespace, and `_ppaGenCar()` at 196495 picks from the same array and stamps the incompatible PPA_RARITIES ladder (196457-196463).
15. A launcher tile is added to the portal list near 114699 following the Communities pattern exactly — a conditional entry that resolves to `null` when `window.MythicTransport` is absent, so a broken module is a missing tile rather than a dead button, with a catch that toasts if open() throws.
16. A `<script type="module" src="src/transport/index.js?v=…">` tag is added after the chain.js tag (currently 223098) and before the battle-board block, preceded by a 6-12 line HTML comment in the local style stating what it registers, that it is inert until opened, what happens if it 404s, and the ⚠ bump-?v= warning.
17. The `?v=` on `src/city/index.js` (currently `?v=v120u0seam`, line 223064) is bumped, because the Freight Depot catalog entry ships in production.data.js in the same deploy and a stale cached catalog would make ensureState() silently delete a paid-for depot.
18. All three deploy knobs move together and consistently: `public/version.txt` (currently `v120w6`), `window.BUILD_VERSION` at index.html:36444 (currently `'v120w6'`), and `CACHE_VERSION` at public/sw.js:414 (currently `'mythic-v120w6-chain-wiring'`).
19. ZERO change to any of: `_convoyCanSend` (66347-66358) and its three grep hits (66347, 65726-65727, 186453); `_convoySpend` (66359); `_convoyGrant` (66364, dead — leave it dead); `CONVOY_TRUCKS` (66282); `GARAGE_RIG_FX` (164198-164202); `GARAGE_RIGS` (164212); `_jbConvoys` (218953); `_vmResearchMult` (195451); `playerOwnsVehicle` (195441); and `worker.js` (empty diff). Each verifiable by grep or `git diff`.
20. No 'discord'/'webhook' anywhere in the diff including comments; no `wallet_credit` call; no raw `Profile.gems =` arithmetic added; no image/video upload, FormData, createObjectURL or storage bucket.

## CONTEXT
You own THREE files and no others: /home/user/Playmythicspellbook/public/index.html (223,149 lines — NEVER read it whole; use grep and sed with line numbers), /home/user/Playmythicspellbook/public/version.txt, /home/user/Playmythicspellbook/public/sw.js. Every line number below was verified against the working tree today. The design doc's numbers are stale by +20 to +30 — use these.

WHAT THE FEATURE IS. A Transportation Company is a new player-run business that hauls other players' freight between map nodes for Cinder. The owner founds it as a `transport` operation (the charter), plants a Freight Depot city building, and stocks a fleet of rigs bought on the Prince Portfolios auction floor. All of the feature's logic lives in a NEW ES module at public/src/transport/ (CLAUDE.md: "NEW features go in public/src/<feature>/ as ES modules. Never add a new top-level system to index.html"), written in parallel by other people. Your job is exclusively the legacy-side wiring. Do not define a rig table, a rate board, a route function or any transport state in index.html.

═══ EDIT 1 — OPS_ECON + OP_LABELS ═══
`const OPS_ECON = {` at 79732, closes `};` at 79771; the `bank:` entry is 79770. Insert after 79770. The template to copy is the bank entry with its comment (79763-79770), verbatim:
  // 🏦 Bank — the licence to run a LENDING house. Founding it is only the
  // premises; the charter itself is bought in MT at the Office of the Mint and
  // is what actually lets you lend. Workers here are BANK TELLERS: they staff
  // the underwriting desk and decide applications on the owner's behalf, within
  // the per-teller ceiling enforced server-side in bank_decide().
  // yields {} on purpose — a bank earns Cinder interest, not resources, so it
  // must never be swept up by the production-pressure hook (cxProduce).
  bank:         { startup: 1000000, ratePerWorkerHr: 1500, salaryPerWorkerHr: 400, maxWorkers: 8,  yields: {} },
Yours: `transport: { startup: 650000, ratePerWorkerHr: 1000, salaryPerWorkerHr: 300, maxWorkers: 10, yields: {}, inputs: { fuel: 1.4 } }` with a comment saying it is two purchases like bank (this is the paperwork; the Freight Depot in src/city/production.data.js is the premises), that workers here are DRIVERS (one staffed worker licenses one rig), and the `yields: {}` reason. ⚠ `yields: {}` is not optional and not the same as omitting it — `_opEcon(t)` at 80021-80039 nested-merges yields/inputs, and `_opSettle` feeds `cxProduce()` (index.html:191773) at 80381/80434 from the computed yields map, which moves Crash Exchange prices. A carrier that 'produces' anything would push the market price of a resource it never extracted.
Nothing downstream needs changing: `_opEcon` merges admin overrides, `_opComputed` reads rate/salary/maxWorkers, `window.cityOpsState` at 207762 builds the city build menu from `Object.keys(OPS_ECON)`, and the admin economy editor at 159663 does the same. CLAUDE.md: "All operation pricing goes through `_opEcon()`. Never hardcode economy numbers" — this single table entry is the only place these numbers may appear in the whole repo.
`const OP_LABELS = {` at 79979 closes at 79990; add `transport: 'Transportation Company',` after the `genelab:` line at 79989. The comment already there (79985-79988) explains why it is required: the Just Business catalog falls back to the raw key, "so a new operation without a label here is buyable but shows up in the shop as 'genelab'."

═══ EDIT 2 — THE SIXTH SITE THE DESIGN DOC DOES NOT NAME ═══
There is a SECOND, duplicated label map inline in the personal-Cinder founding branch, 82286-82293:
          // Friendly name lookup so the modal says "Fishing Company" not "fishing".
          const opNiceName = ({
            mining: 'Mining Company', oil: 'Oil Company', construction: 'Construction Co.',
            medical: 'Medical Corporation', agri: 'Agricultural Op.', research: 'Research Facility',
            smuggling: 'Smuggling Network', salvage: 'Salvage Operation', gas: 'Gas Station Chain',
            cars: 'Car Dealership', fishing: 'Fishing Company', cardshop: 'Card Shop',
            dojo: 'Dojo', bank: 'Bank',
          })[a.op] || (a.op.charAt(0).toUpperCase() + a.op.slice(1));
It does not read OP_LABELS and has ALREADY DRIFTED — `warehouse` and `genelab` are missing, so they currently render via the charAt fallback. `transport` would show as "Transport" in the "Do You Want to Buy This Business?" modal even with OP_LABELS set correctly. Replace those seven lines with `const opNiceName = (OP_LABELS && OP_LABELS[a.op]) || (a.op.charAt(0).toUpperCase() + a.op.slice(1));`, keeping the existing comment above it and adding one line recording the drift and why one authority beats two.
Immediately below, the unlock-blurb ternary chain at 82307-82315 tells the buyer what founding also unlocks. The `cars` arm at 82309-82310 is the markup template. Add a `transport` arm.

═══ EDIT 3 — THE FOUNDING HOOK ═══
`function _opAfterFound(opId)` at 80199, closing `}` at 80270. It is a flat sequence of `if (opId === '…')` blocks, NOT a switch (the design doc calls it a switch; it is not). It is called from THREE sites: 79968 (`_opCreateLocal`, the MT-stake/free path), 82273 (corp Treasury path) and 82388 (personal Cinder path). Append your block before the closing brace at 80270. The exact template, the `cars` block at 80213-80227:
  // 🚗 Car Dealership → Prince Portfolios mini-game.
  if (opId === 'cars') {
    try {
      const _pp = ensurePrincePortfolios();
      if (!_pp.owned) {
        _pp.owned = true;
        for (let i = 0; i < 8; i++) _pp.listings.push(_ppGenListing());
        _pp.lastListingRoll = Date.now();
        _ppLog('event', 'Prince Portfolios unlocked via Car Dealership founding.');
        try { saveProfile && saveProfile(); } catch (_) {} try { saveForge && saveForge(); } catch (_) {}
        showToast('🚗 PRINCE PORTFOLIOS unlocked! Open it from Just Business → My Companies.', 7200);
      }
    } catch (_) {}
  }
The `fishing` block at 80200-80212 is the one that seeds a free asset: line 80205 is `wfBuyBoat('skiff', { free: true, name: 'The Starter' })`. Your block calls `window.MythicTransport.onCharterFounded({ free: true })` behind a typeof guard — the MODULE owns the state; index.html only tells it the charter landed — and MUST have an else branch that says out loud that the module has not loaded, so the player is never silently sold a company with no screen.
Also add an ownership predicate in the shape of `_dojoOwnsLicense()` (80272-80280) or `_geneLabOwnsLicense()` (80287-80295), which read `Operations.list` (declared `const Operations = { list: [], _fetched: 0 };` at 80041) so "the licence follows the account rather than the device." Expose it on the bridge as `ownsCharter()`. Why this matters: Prince Portfolios has a FOURTH unlock route that bypasses `_opAfterFound` entirely — `ppIsUnlocked()` at 195778 self-heals by scanning `Operations.list.some(o => o && o.op_type === 'cars' && o.status === 'active')`, with a comment saying it exists because a stale cloud profile loaded with owned=false left the screen empty. Never let a stored flag be the only source of truth.

═══ EDIT 4 — THE BRIDGE ═══
There are four bridges in this file: `window.MythicBridge` 206909 (banner 206894-206907), `window.MythicHouseBridge` 207322, `window.MythicTradeBridge` 207373 (banner 207352-207372), `window.MythicCityBridge` 207415 closing `};` at 207504. Insert yours as a new top-level block after 207504 and before the `/* 🏦 CITY → OPS VAULT.` comment at 207505.
The house rules those four encode, and you must too:
  • Every accessor is a FUNCTION, not a snapshot (MythicBridge banner 206906-206907: "Profile.gems changes constantly; a captured value would go stale the moment the player spends"). The one exception is a static array of resource DEFINITIONS (MythicCityBridge.resources, 207418).
  • Every method is try-wrapped and returns a typed default; nothing throws across the seam. `confirm: (m) => { try { return gcConfirm(m); } catch (e) { return Promise.resolve(false); } }`.
  • EVERY MUTATOR RETURNS A BOOLEAN. MythicTradeBridge 207358-207362: "That is not decoration: /src/trading's settlement engine decides whether to unwind a whole trade from these return values, and a wrapper that returns `undefined` on success would make its rollback path fire on a leg that actually worked." And MythicCityBridge 207446-207451: "🔴 RETURN FALSE ON FAILURE — DO NOT SWALLOW IT. These two were `try { … } catch (e) {}`, which made the module's refund-on-record-failure path dead code: a saveProfile() throw charged the player 50,000 Cinder for a building that never persisted, and build() still returned {ok:true}."
  • `refundRes` is the UNCAPPED undo; `addRes` respects the stash cap. The distinction is a safety property, not a convenience — `addRes` returns WITHOUT ADDING when the vault is full, and a refund routed through it evaporated 95 metal and 70 supplies in a driven test.
  • Never mutate Profile.gems (207440: "Cinder. Routed through the real helpers — never mutate Profile.gems.").
  • The idle contract is PASSED, never redeclared (207453-207454), from OP_COLLECT_CD_MS / OP_ACCRUAL_CAP_H, "so the Bunkhouse, the city Resting House and corp operations can never drift into three different idle policies."
  • ⚠ 207344-207351 corrects its own task doc in place and loudly: "RESOURCES DO NOT LIVE ON `Profile.resources`." Use getRes/addRes/_refundRes/spendResources only.
  • An honest dead hook is labelled, not hidden (207497-207503: `outputMultipliers: null` with what was grepped for and how to wire it later).
THE PINNED KEY SET. The module-side NULL_BRIDGE is being written from this same list; it must match key-for-key:
  cloud (a `get cloud()` accessor, copying MythicBridge:206910 — not a captured reference), signedIn(), userId(), displayName(),
  gems(), spendGems(n)→bool, addGems(n, why)→bool,
  resources (static defs array), getRes(id), spendRes(id,n)→bool, addRes(id,n)→bool, refundRes(id,n)→bool,
  opEcon(t), opLabel(t), ownsCharter()→bool, charterWorkers(),
  lot() (COPIES of the PP lot rows, never the live array), lotCap(), condMult(c), conditions(), rarities(),
  setRigField(vehicleId, key, val)→bool  ← allow-list the keys (runsUsed|dayKey|assignedTo|condition|status), never a free write,
  garageRig(), campNodeId(), twNodes(), regionControl(regionId, corpId), myCorp(),
  cityProd() → window.MythicCityProduction or null,
  save()→bool, toast(m,ms), confirm(m)→Promise<bool>, render(), isAdmin(), todayKey(),
  collectCdMs (constant), accrualCapH (constant).
Helpers to wire them to, all verified: `getRes` 39375, `addRes` 39518, `spendResources` 39536, `_refundRes` 39571, `spendGems` 64430, `addGems(amount, reason)` 64454, `RESOURCES` 39272 (14 ids), `RARITIES` 39231, `PP_COND_MULT` 195340, `PP_CONDITIONS` 195338, `ppLotCap` 195745, `_garageRig` 164227, `_opEcon` 80021, `OP_LABELS` 79979, `_opsAllRows` 207702, `Operations` 80041, `_twForge` 214983, `_twState` 215129, `tw_regionControlPct` 214341, `isAdmin` 53896, `gcConfirm` 111729, `showToast` 112801, `getTodayKey` 71039.
⚠ `garageRig()` is READ-ONLY and exists only so the module can grant the ratified fleet-wide perk. `_garageRig()` returns `{ owned:false, name:'Hand-hauled', icon:'🧺', load:1, risk:0, speed:1, tier:0 }` from both the no-rig path and the catch, "so every caller can use the same shape without branching on ownership". Never expose a way to grant a Garage rig: the Vendor Market handler at 162020-162058 deliberately grants nothing and calls `garageCheckout(t.sku)` instead, because "Granting on click would hand out a $99 rig for free." `_convoyGrant` (66364) has zero call sites — leave it dead.

═══ EDIT 5 — _ppGenListing ═══
`function _ppGenListing()` at 195910, closing `}` at 195932. Six callers, all unconditional: 80220, 195776, 195791, 195951, 195956, 195959. Change it so the ONLY difference for an ordinary car is nothing at all. Branch at the top:
  const RIGS = (typeof window !== 'undefined' && window.MythicTransport && typeof window.MythicTransport.rollRig === 'function') ? window.MythicTransport : null;
  const wantHaul = !!(RIGS && _ppChance(0.18));
  const base = (wantHaul && RIGS.rollRig()) || _ppPick(PP_VEHICLE_NAMES);
leave 195912-195922 exactly as they are, and in the return object make rarity `base.haul ? base.rarity : (condition === 'Pristine' ? 'rare' : 'common')` and append the haul fields conditionally: `...(base.haul ? { haul: true, rigId: base.id, lotSlots: base.lotSlots | 0 || 1 } : {})`. Comment that rarity for a rig comes from the RIG ENTRY, not from condition, because condition is a separate multiplier on runs/day — which is what makes a beaten Legendary a real decision against a Pristine Rare.
⚠ DO NOT widen PP_VEHICLE_NAMES (195315-195335). The admin photo grid at 197455 keys `f.listingPhotos[v.name]` off that shared name namespace, and `_ppaGenCar()` at 196495 picks from the same array and stamps PPA_RARITIES (196457-196463: Common/Rare/Epic/Legendary/Mythic — capitalised, no Uncommon, a different ladder from the game's RARITIES), so a rig in that array would carry two contradictory rarities. The rig table lives in public/src/transport/rigs.data.js; module → window is the direction that works.
⚠ DO NOT enforce multi-slot lot footprints. The lot is one-vehicle-one-integer-slot in ~12 places (ppBuyVehicle 196009/196013, vmCancelListing 195524-195527, vmBuyListing 195548, the auction cap 196629, plus render reads). `lotSlots` is carried as forward data only.
⚠ DO NOT copy `ppBuyVehicle`'s charge line at 196020 (`Profile.gems = (Profile.gems | 0) - v.price;`). It bypasses spendGems, which CLAUDE.md forbids, and 195546-195549 documents the sibling bug where a misspelled `spendCinderS` silently fell through to raw subtraction.

═══ EDIT 6 — LAUNCHER TILE ═══
Copy the Communities tile at 114694-114705 exactly, including its comment: "Hidden entirely if the module failed to load, so a broken module is a missing tile rather than a dead button. ⚠ Resolves to NULL when the module has not loaded — the tile list is `.filter(Boolean)`ed… There is no `hidden` flag; returning null IS the flag." Gate on `window.MythicTransport`, call `window.MythicTransport.open()` in a try/catch that toasts on failure.

═══ EDIT 7 — SCRIPT TAG AND THE THREE KNOBS ═══
Tags live at 223032-223098, each preceded by a 6-12 line HTML comment. Add yours after the chain.js tag (223098) and before the `<!-- battle-board round 1 -->` block. Path convention: relative, no leading slash, `?v=` on the ENTRY TAG ONLY (sub-modules are imported by bare relative specifier and carry no query string). Model the comment on the city one at 223055-223064.
Bump `?v=` on `src/city/index.js` at 223064 (currently `v120u0seam`) as well: the Freight Depot catalog entry ships in src/city/production.data.js in this same deploy, and public/sw.js:485-492 records the measured failure of a mismatched pair — "it threw 'canFoundCommunity is not a function' while the file on the server plainly had it."
Then the three knobs, which move together or the update check breaks: `public/version.txt` (currently `v120w6`), `window.BUILD_VERSION` at index.html:36444 (currently `'v120w6'`), and `CACHE_VERSION` at public/sw.js:414 (currently `'mythic-v120w6-chain-wiring'`). Verify the edge with curl and poll rather than trusting a deploy log — but do NOT deploy; just move the knobs.

═══ HARD PROHIBITIONS — each verifiable by grep or git diff ═══
- `_convoyCanSend()` (66347-66358) is UNTOUCHED, no wrapper, no reassignment, no added early return. It gates the player's own squad going out on scout/raid/deep-run/Covert Action; a carrier requirement on it would let a monopolist stop other people from playing the game at all. After your change `grep -n "_convoyCanSend" ` must return exactly the same three hits it does today: 66347, 65726-65727, 186453. Do not call `_convoySpend` (66359) either.
- `CONVOY_TRUCKS` (66282), `GARAGE_RIG_FX` (164198-164202), `GARAGE_RIGS` (164212) and `worker.js` are untouched. The Garage sells three rigs for $20/$60/$99 of real money; 164187-164189 says GARAGE_RIGS in worker.js is the pricing authority and "If these two disagree the player is shown one price and billed another", and 164190-164191 says the effects table is the single source of truth from which the store's bullet points are GENERATED. Editing either silently rewrites live paid-product marketing copy.
- `_jbConvoys()` (218953) is untouched. Making it stateful is the biggest change in the feature and belongs to a later phase; it drives the war-map trucks AND the corp Logistics screen from one source, and its consumers parse display strings out of it.
- `_vmResearchMult()` (195451) and `playerOwnsVehicle()` (195441) are untouched. Battle integration is build-order step 5. In particular do NOT change `return Math.min(1.4, best);` at 195472 to 1.9 — `best` is a bare number and the loop has already discarded which vehicle produced it, so a flat raise silently buffs every Luxury/Armored car in every player's lot.
- Do not add `wallet_credit`, any npm dependency, any 'discord'/'webhook' text including in comments, or any image/video upload path.
- Do not fix the unrelated defects you will notice in passing (`_convoyPanelHtml`'s `best` reading only the legacy Aza array so a cash-only buyer sees the wrong rig pictured; `_convoyCanSend`'s `why` naming the flagged truckId; the war-map truck's SMIL duration coming from route index rather than progress; `_ppaWin`'s `slot: p.lot.length` collision). Note them for a separate change; do not bundle them into a branch that touches paid-rig and economy rails.
