# BRIEF — rigs.data.js — the haul-class rig catalog and its runs/cargo maths

## GOAL
Write ONE new file, /home/user/Playmythicspellbook/public/src/transport/rigs.data.js: the six-entry PP_RIGS catalog (one per existing game rarity), the weighted roll that puts a haul-class listing on the Prince Portfolios auction floor, the effective-runs maths (rarity runs × condition multiplier, floored at 1), the Garage-tier fleet perk mapping, and a runnable self-audit. It is a data file that must argue for its own shape: why the rig table sits BESIDE PP_VEHICLE_NAMES rather than inside it, why rarity for a rig comes from the entry rather than from condition, why lotSlots is authored but deliberately not enforced in v1, and which numbers are provisional. Pure and total: no I/O, no imports of anything but nothing at all, no bridge, no window reads at module scope, nothing that can throw at import.

## FILES YOU OWN (write ONLY these)
- public/src/transport/rigs.data.js

## ACCEPTANCE CRITERIA (a critic verifies each against your real output)
1. File exists at public/src/transport/rigs.data.js and `node --check public/src/transport/rigs.data.js` passes. (Do NOT cite `node _synckcheck.mjs` on a .js path — it only extracts inline <script> blocks from HTML, finds zero matches, prints ALL CLEAN and exits 0. That is a false green.)
2. Exports EXACTLY these names with these arities: PP_RIGS, PP_RIGS_BY_ID, RIG_RARITIES, rollRig(), rigById(id), rarityIndex(rarityId), effectiveRuns(rigId, condition, garageTier), fleetSlotBonus(garageTier), runsPerDayBonus(garageTier), auditRigs(rarityIds, condMult).
3. PP_RIGS has 6 entries whose `rarity` values are exactly the six lowercase ids from index.html's RARITIES: common, uncommon, rare, epic, legendary, mythic. No parallel ladder, no capitalised keys, no 'Uncommon'-less five-tier set.
4. Entries carry `haul: true` and the doc's ratified numbers: Roachback Flatbed / 46000 / 3 runs / cargo 1.00 / risk 0 / speed 1.00 / 1 slot / weight 40; Mule Box Hauler / 98000 / 4 / 1.30 / -3 / 1.05 / 1 / 26; Kettledrum Freighter / 210000 / 5 / 1.70 / -8 / 1.15 / 1 / 18; Ashgate Longhaul / 480000 / 6 / 2.20 / -14 / 1.25 / 2 / 10; Saint Corvid Roadtrain / 1150000 / 8 / 3.00 / -22 / 1.40 / 2 / 5; The Cinder Line / 3400000 / 10 / 4.20 / -32 / 1.60 / 3 / 1.
5. `grep -in ironback public/src/transport/rigs.data.js` returns 0. Ironback Mauler (PP) and Ironback Runner (Garage) already coexist; a third would be unreadable, and the Garage one is a $99 real-money product.
6. grep finds no reference to GARAGE_RIGS, GARAGE_RIG_FX, rig_ironback, rig_ashconvoy, rig_warden, CONVOY_TRUCKS, _convoyCapacity or _convoySpend. The Garage perk is taken as an integer tier 0-3 argument only.
7. fleetSlotBonus / runsPerDayBonus map a SINGLE best tier (0-3) to a perk — they do not iterate or sum owned rigs. Tier 1 → +1 fleet slot; tier 2 → +1 run/day on every rig; tier 3 → both. A comment states that rigs do not stack and cites the existing rule that the best one owned applies.
8. effectiveRuns implements floor(rarityRuns × condMult[condition]) with Math.max(1, …). Verifiable by hand: Legendary 8 × Wrecked 0.30 = 2; Rare 5 × Salvage 0.18 = 0 → clamps to 1; Common 3 × Pristine 1.15 = 3.
9. The condition multipliers are NOT redefined in this file as the authority. Either they arrive as a parameter/injected map, or a local copy is present and explicitly labelled as a mirror of index.html:195340 PP_COND_MULT ({Pristine 1.15, Clean 1.00, Worn 0.78, Battered 0.55, Wrecked 0.30, Salvage 0.18}) with a comment naming index.html as the authority and saying what drift would do.
10. `lotSlots` is authored on every entry AND a prominent comment says it is NOT enforced in this release, names the invariant it would break (one vehicle occupies exactly one integer slot), and names concrete sites that would have to move together — ppBuyVehicle index.html:196009/196013, vmCancelListing 195524-195527, vmBuyListing 195548, the auction cap 196629, and the lot renderers.
11. A rejected design is recorded with its cost: the rig entries are NOT merged into PP_VEHICLE_NAMES (index.html:195315-195335), and the comment names what merging would break — the admin photo grid at index.html:197455 keys f.listingPhotos[v.name] off that shared name namespace, and _ppaGenCar() at index.html:196495 picks from the same array and stamps PPA_RARITIES (index.html:196457-196463: Common/Rare/Epic/Legendary/Mythic, capitalised, no Uncommon), so a rig would carry two contradictory rarities.
12. Comments mark provisional numbers as provisional and say who deletes them, in the style of production.data.js:29-35 ("this comment exists to be deleted by whoever adds one").
13. auditRigs() is EXPORTED but NOT run at import, with a comment saying why (a data assertion that throws on load would take the app down over a tuning typo). It checks at minimum: 6 entries; rarity ids all present exactly once and all members of the passed rarity list; weights sum to 100; runs strictly increase with rarity index; every entry has haul:true, a positive baseValue and a name; and no name collides with a PP_VEHICLE_NAMES name it is handed. Returns [] when sound.
14. rollRig() returns null (not undefined, not a throw) when the catalog is empty, and every export is total — no throws, no async, no Math.random at module scope, no `window`/`document`/`Profile`/`Corp`/`Forge` reference anywhere in the file.
15. File opens with a box header stating what it is, what consumes it, and the one thing it must never become.

## CONTEXT
You are writing ONE new file: /home/user/Playmythicspellbook/public/src/transport/rigs.data.js. You may write no other file. `public/` is the deploy root, so this is served at /src/transport/rigs.data.js.

WHAT IT IS FOR. Transportation Companies are a new player-run business that hauls other players' freight for Cinder. Their trucks are ORDINARY Prince Portfolios vehicles with a haul class: they roll onto the same auction floor through the same generator, and inherit for free the condition ladder, mileage, colour, seller rating, scam risk, discount ladder, lot slots, fuel and strip-for-parts. This file is the catalog those haul-class listings are rolled from, plus the small amount of maths that turns a rig entry + a condition into a number of runs per day.

TWO CONSUMERS, both fixed, both written by other people in parallel:
  1. public/index.html's `_ppGenListing()` (line 195910) will call `window.MythicTransport.rollRig()` and `window.MythicTransport.rigCatalog()`, falling back to a plain car when the module is absent. It reads `base.name`, `base.type`, `base.baseValue`, `base.rarity`, `base.haul`, `base.id`, `base.lotSlots` off whatever rollRig() returns. So EVERY entry must carry `id`, `name`, `type`, `baseValue`, `rarity`, `haul: true`, `lotSlots`.
  2. public/src/transport/index.js will re-export `rigCatalog: () => PP_RIGS`, `rollRig`, `rarityIndex`, and the fleet code will call effectiveRuns / fleetSlotBonus / runsPerDayBonus.

PINNED EXPORT CONTRACT — match names and arities exactly, other builders are importing these right now:
  export const PP_RIGS
  export const PP_RIGS_BY_ID
  export const RIG_RARITIES              // the six ids in ladder order, lowest first
  export function rollRig()              // weighted pick, null if the table is empty
  export function rigById(id)            // entry or null
  export function rarityIndex(rarityId)  // 0..5, 0 for unknown — never throws
  export function effectiveRuns(rigId, condition, garageTier)   // integer >= 1
  export function fleetSlotBonus(garageTier)   // integer
  export function runsPerDayBonus(garageTier)  // integer
  export function auditRigs(rarityIds, condMult)   // array of problem strings; [] when sound

THE RATIFIED TABLE (do not retune, do not reorder, do not rename):
| rarity | name | baseValue | runs/day | cargo | risk | speed | lotSlots | weight |
| common | Roachback Flatbed | 46000 | 3 | 1.00 | -0 | 1.00 | 1 | 40 |
| uncommon | Mule Box Hauler | 98000 | 4 | 1.30 | -3 | 1.05 | 1 | 26 |
| rare | Kettledrum Freighter | 210000 | 5 | 1.70 | -8 | 1.15 | 1 | 18 |
| epic | Ashgate Longhaul | 480000 | 6 | 2.20 | -14 | 1.25 | 2 | 10 |
| legendary | Saint Corvid Roadtrain | 1150000 | 8 | 3.00 | -22 | 1.40 | 2 | 5 |
| mythic | The Cinder Line | 3400000 | 10 | 4.20 | -32 | 1.60 | 3 | 1 |
`risk` is a FLAT PERCENTAGE-POINT REDUCTION applied before a 0..0.95 clamp elsewhere; `cargo` and `speed` are multipliers (speed higher = arrives sooner). Give each entry a `type` string for the PP listing card (these are trucks: 'Flatbed', 'Box Hauler', 'Freighter', 'Longhaul', 'Roadtrain', 'Roadtrain' or similar). Names deliberately avoid 'Ironback' — Ironback Mauler already exists in PP_VEHICLE_NAMES and Ironback Runner is a $20 real-money Garage rig.

GROUND TRUTH YOU NEED, quoted from the live file:

index.html:39231-39238 — the ONLY rarity ladder you may use:
  const RARITIES = [
    { id: 'common', name: 'Common', color: '#9aa0a6' }, { id: 'uncommon', … '#5eb37a' },
    { id: 'rare', … '#5a9bd4' }, { id: 'epic', … '#a070d9' },
    { id: 'legendary', … '#d4af37' }, { id: 'mythic', … '#e85d3c' },
  ];

index.html:195340 — the condition multipliers you reuse rather than reinvent:
  const PP_COND_MULT = { 'Pristine': 1.15, 'Clean': 1.00, 'Worn': 0.78, 'Battered': 0.55, 'Wrecked': 0.30, 'Salvage': 0.18 };
and index.html:195338:
  const PP_CONDITIONS = ['Pristine','Clean','Worn','Battered','Wrecked','Salvage'];
Both are top-level `const` in index.html — LEXICAL globals, NOT properties of window, so this module genuinely cannot read them (`window.PP_COND_MULT` is undefined). You have two honest options and must pick one and say why in a comment: take the map as the `condMult` parameter that effectiveRuns/auditRigs already accept, or keep a local mirror clearly labelled as a MIRROR with index.html:195340 named as the authority and the consequence of drift stated. Do not silently duplicate it as if it were the source.

index.html:195910-195932 — `_ppGenListing()` as it stands today. `base` is `_ppPick(PP_VEHICLE_NAMES)` and the return object is:
  { id, name, type, color, condition, mileage, riskLevel, price, estPartValue, isScam,
    rarity: condition === 'Pristine' ? 'rare' : 'common', baseValue: base.baseValue, sellerRating }
The existing `rarity` is a two-valued derivative of condition. For a haul-class listing rarity comes from the RIG ENTRY instead, and condition becomes a separate multiplier on runs — that is what makes a beaten Legendary a real decision against a Pristine Rare. Say this in a comment; it is the single most important design line in the file.

index.html:164190-164193, the Garage effects table's own header, which is why the perk is a single-tier lookup:
  "⚙ THE EFFECTS TABLE IS THE SINGLE SOURCE OF TRUTH… Rigs do not stack: the best one you own hauls everything, which is why each tier's copy says 'everything below'."
The ratified Transport perk: owning a Garage rig grants a FLEET-WIDE perk — tier 1 (Ironback, $20) +1 fleet slot; tier 2 (Ash Convoy, $60) +1 run/day on every rig; tier 3 (Warden, $99) BOTH. This exists so the $99 rig becomes MORE valuable when Transport ships, not less. It is the single most important balance call in the feature and it is settled — implement it, do not hedge it, and do not sum tiers. You receive `garageTier` as an integer 0-3 and nothing else; you must never import, name or read a Garage SKU.

index.html:195401-195407 — the lot, for the lotSlots comment:
  PP_LOT_LEVELS slots are 6 / 10 / 15 / 25 / 40.
The lot is modelled as ONE VEHICLE PER INTEGER SLOT in roughly a dozen places. ppBuyVehicle checks `p.lot.length >= cap` (196009) and assigns with `p.lot.some(x => x.slot === i)` (196013); vmCancelListing re-slots identically at 195524-195527; vmBuyListing caps at 195548; the auction minigame caps at 196629; and there are render-side reads at 196969, 197008, 197064, 197130, 197171, 197188. A `lotSlots: 3` rig that only the buy path respects would overlap another vehicle's slot on unlist or be duplicated past capacity through the P2P market. So v1 KEEPS one-vehicle-one-slot; `lotSlots` is authored as forward data and the comment must say so, name the sites, and say what the enforcement would cost. This is a recorded rejected design, not an omission.

═══ THE BAR: what production.data.js does that you must match ═══
Your file is judged blind against /home/user/Playmythicspellbook/public/src/city/production.data.js. Read it. Specifically:
- It opens by naming the REJECTED design and calling it the point: "🔴 THIS IS DELIBERATELY NOT MERGED INTO CAMP_FACILITIES, and that is the whole design decision", then names the three things that only look alike and the exact cost of merging ("every facility read site… grew a 'but is it a factory?' branch"). Your equivalent is PP_RIGS beside PP_VEHICLE_NAMES rather than inside it, and the cost is the shared `f.listingPhotos[v.name]` namespace at index.html:197455 plus `_ppaGenCar()` at 196495 stamping the incompatible PPA_RARITIES ladder (196457-196463) onto anything in that array.
- It marks its own literals as provisional and pre-writes its own deletion (lines 24-31): rates are "tuning starting points, NOT an authority… this comment exists to be deleted by whoever adds" a `_cityEcon()`.
- Array ORDER is documented as load-bearing with a player-experience reason and the instruction "Do not 'tidy' this into alphabetical order." Your ladder order is load-bearing too (rarityIndex depends on it; so does the weighted roll's readability).
- `auditCatalog()` (lines 360-398) turns acceptance criteria into runnable rules, is exported but deliberately NOT run at import "because a data assertion that throws on load would take the whole city down over a tuning typo", and its own hardcoded fallback id list carries a staleness warning explaining how a stale list would INVERT the very bug the audit exists to catch. Copy all three properties.
- Emoji conventions: 🔴 for a rule that has already been broken and cost money or data (name the measured consequence); ⚠ for a live gotcha; box header `/* ═══ … ═══ */` with a one-line thesis, a `---` rule, then WHY.

HARD RULES (CLAUDE.md, non-negotiable):
- THE GLOBALS TRAP. Profile, Cloud, App, Corp, Forge, RESOURCES, RARITIES, PP_COND_MULT and every _pp* helper are top-level `const`/function declarations in index.html — global LEXICAL bindings, not properties of window. `window.Profile` is undefined even though `const Profile` is right there. This has already cost real time twice. `grep -nE "\\b(Profile|Cloud|App|Corp|Forge|RESOURCES|RARITIES|Operations|Catalog)\\b" ` on your file must return zero non-comment hits, with or without a `window.` prefix.
- Nothing may throw at import time. This module is loaded on every page load and a failure here would take a 223k-line app down with it.
- No new npm dependencies; no bare-specifier imports; every import (if any) is a relative path ending in .js. This file should need none.
- No image/video/upload anything; visuals are emoji + an accent colour, matching the design doc's `emoji: '🚛', accent: '#e0a45c'`.
- Never write the word 'discord' or 'webhook', including in a comment. That decision is settled and re-proposing it in a comment counts as re-proposing it.
