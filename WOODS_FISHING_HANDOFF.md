# Handoff — Woods Fishing expansion (written 2026-09-09)

Everything below is verified against the branch, not from memory. Companion design notes:
`docs/woods-fishing-expansion.md` (the "why" per system). This file is the "what state is
it in and what do I do next".

## Where things stand

| | |
|---|---|
| Branch | `claude/woods-fishing-expansion-jigcur` |
| Commits | `5e310fa` (round 1 — the catch is a resource) · `32be5ff` (round 2 — boats, sharks, crew, tournaments) |
| Base | `4dbc4f9` on `main` |
| Pushed | yes, branch is on GitHub. **Not merged to `main`.** |
| Deployed | **no.** `public/version.txt`, `window.BUILD_VERSION` and `sw.js CACHE_VERSION` are still `v120w6` |
| Migration pending | **`sql/038_fishing_records.sql`** — not yet run in the Supabase SQL editor |
| Working tree | clean |

Nothing is half-finished in code. Two operator steps remain (deploy knobs, the migration).

## What the update is, in one paragraph

Fish are ledger resources now. Every catch from the live 3D trip, a fleet expedition, the
Fishing Company op or a city Fishing Wharf lands as **Fresh Fish, Shellfish, Prime Seafood,
Seaweed** (round 1) or **Leviathan Parts** (round 2, off things that attack boats). They sell
on the Player Market, feed six new city buildings and a new Fish Cannery op, and fill NPC
contracts at a premium over the Crash Exchange price. The 3D trip gained day/night, weather,
moving fish schools with sonar and aiming, a deckhand, boat hold and gear, and then a threat
meter with sharks and anomalies that bite the hull and can be harpooned, fled, or fought in
the card battle. Boats have stats, levels and refits; crew have ranks and can die; there is a
weekly tournament board and world-wide tide events.

## Ship checklist (in order)

1. **Run the migration.** Paste `sql/038_fishing_records.sql` into the Supabase SQL editor for
   project `ktsiasyjusesawtrwrjc`. Idempotent; the three verify queries at the bottom should
   show `relrowsecurity = t`, one `SELECT` policy, and a row count. Until this runs the
   TOURNAMENT tab prints "board unavailable — run sql/038" and keeps local records only.
2. **Merge to `main`** (fast-forward is fine; the branch is two commits on top of `4dbc4f9`).
3. **Bump the three deploy knobs together** — `public/version.txt`, `window.BUILD_VERSION`,
   `sw.js CACHE_VERSION` — to the next version (suggest `v120x1`). ⚠ All three or the update
   check breaks (CLAUDE.md).
4. Deploy, then **verify at the edge with curl** and poll; PoP propagation takes minutes.
5. Smoke on a real GPU browser: open Woods Fishing → EXPEDITIONS → CAST OFF, cast once, and
   confirm the catch card says "iced in the hold as Fresh Fish" and the stash count moves.

## Player-visible behaviour changes to know about

- **Fishing Company owners now receive fish, not food.** Same units/hr (1.5 fresh fish +
  0.6 shellfish + 0.3 seaweed instead of 2.4 food). The Cold Storage bench converts instantly
  (5 fish → 7 food) and the Cannery does it better. Expect a question about this.
- **Fleet expeditions drop fish resources**, not food, for the same three rows.
- **Terroir was re-dealt twice** (18 then 19 resources). Every surveyed player's ground
  changed. r12 accepted the same for +3; this is +5. Nothing placed was touched.
- **Boats can now be wrecked on a live trip** (hull 0) and **crew can die** on a bite or a
  bad expedition (30% at health 0; 10% for veterans/hunters). Both are logged to the event
  feed and the Coastal Dispatches channel.
- **New resource icons appear** in every cost renderer, the vault, the market dropdowns and
  node-city's HUD (seeded from `chain.js`) automatically. No per-site edits were needed.

## Where every piece lives

| System | Location |
|---|---|
| Ledger: 5 new ids, base prices | `public/index.html` `RESOURCES` (~39290), `SALVAGE_RES` (~75390) |
| Terroir slots (now 19: RICH 4 / COMMON 7 / SCARCE 6 / BARREN 2) | `public/src/city/terroir.js` |
| Chain catalogue (`existing: true` on the five) | `public/src/resources/chain.js` |
| City buildings: Fishing Wharf, Kelp Beds, Deepwater Pier, Cannery, Fish Oil Works, Leviathan Rendery + `CITY_PREREQ` | `public/src/city/production.data.js` |
| Ops: `fishing` yields fish; new `cannery` op | `OPS_ECON` / `OP_LABELS` (~79790 / ~80037) + the founding-modal name table (~82340) |
| Fleet: drops, armor soak, crew hurt, boat XP | `WF_FISH_DROPS`, `wfResolveExpedition` |
| Boat classes (armor/sonar/stability), refits, levels | `WF_BOAT_CLASSES`, `WF_BOAT_MODS`, `_wfBoatStats`, `_wfInstallMod`, `_wfOpenRefitModal` (~192500) |
| Crew ranks / injury / death | `WF_CREW_RANKS`, `_wfCrewLevel`, `_wfCrewHurt` (same block) |
| Live 3D trip (everything) | `index.html` WF3 block, `const WF3_RARITY_COLOR` → `_wf3Close` (~193600–195240) |
| Threats: table, meter, attacker, card, harpoon/flee/battle, wreck | `WF3_THREATS` … `_wf3Wreck` inside the WF3 block |
| Tournaments client | `_wfTourneySubmit`, `_wfTourneyFetch`, `_wfRenderTournament` (just above the WF3 DOM helpers) |
| Coastal claim luck | `_wf3TerritoryLuck` (same place) |
| Economy module: recipes, contracts, tide events, demand maths, two tabs | `public/src/fishing/{demand,render,index}.js` |
| Bridge | `window.MythicFishingBridge` next to `MythicCityBridge` (~208490) |
| Screen tabs | `renderWoodsFishing`: COLD STORAGE + CONTRACTS (module, legacy fallback), TOURNAMENT |
| Migration | `sql/038_fishing_records.sql` |
| Cache versions bumped | `src/fishing/index.js?v=fish2`, `src/city/index.js?v=v120x1shark`, `src/resources/chain.js?v=v120x1shark` (in **both** `index.html` and `node-city/index.html`) |

## The dials (first-pass tuning, one table each)

If something feels off, these are the only places to touch:

| Feel | Table |
|---|---|
| Fish worth too much / too little | `SALVAGE_RES` `value` (90 / 240 / 900 / 45 / 1500) |
| Species units, weights, day/night | `WF3_BIOMES[].loot` (`units`, `kg`, `time`) |
| Weather strength | `WF3_WEATHER` |
| Sharks too frequent / too weak | `WF3_THREAT_PER_CAST`, `WF3_THREATS`, `_wf3ThreatPerCast()` |
| Harpoon / flee odds | `WF3_HARPOON_AMMO`, `_wf3HarpoonShot` (15–30 + 2×level), `_wf3AttackerEscapeOdds` |
| Boat progression | `WF_BOAT_XP_PER_LEVEL` (100), `_wfBoatSlots` (L2/4/6), `WF_BOAT_MODS[].cost` |
| Crew death odds | `_wfCrewHurt` (0.7 / 0.9 survive) |
| Contract sizes, premiums, buyers, board length | `demand.js` `CONTRACT_BUYERS`, `CONTRACT_WINDOW_MS` (8h), `CONTRACT_COUNT` (4) |
| Bench recipes | `demand.js` `RECIPES` |
| Tide events and weights | `demand.js` `TIDE_EVENTS` |
| City building yields/costs | `production.data.js` (run `auditCatalog()` after any edit — it must return `[]`) |
| Op rates | `OPS_ECON.fishing` / `.cannery` (admin econ tuner reaches these live) |

## Verified how

- `node _synckcheck.mjs` → ALL CLEAN on both commits.
- `production.data.js` `auditCatalog()` → `[]` (19 resources, every one has a producer).
- `demand.js` driven in node: boards are deterministic per (window, user), differ per user,
  tides are window-only, payout floors at 1 Cinder/unit.
- Headless Chromium via Playwright (three r128 served from the npm tarball because the CDN is
  blocked in the sandbox): every tab renders; bench converts 5 fish → 7 food; a contract pays
  and writes the ledger; refit modal installs Harpoon Mount + Reinforced Hull; the trip boots,
  casts, bites, reels, banks fresh fish + seaweed and records a trophy; a forced shark is
  harpooned to death and drops parts; flee escapes; hull 3 + two bites → WRECKED card and the
  boat docks `damaged`; tournament tab renders offline. Zero page errors. Only console noise
  is the pre-existing `<link rel=preload>` warnings.
- ⚠ Headless swiftshader runs the trip at ~3–5 fps, so game-clock things (bite timers, the
  attacker's circle) take 10× longer there. That is the sandbox, not the game.
- ⚠ The Browser pane in the Claude environment does not composite (no RAF). Use real Chromium.

## Known gaps / deliberately not done

- **Contracts are client-settled** (like the smuggler board). If they ever need to be shared or
  audited across players, that is a `fishing_contracts` migration with RLS, not a code change.
- **The tournament board trusts `display_name` as text** (length-capped server-side, escaped on
  render). `kg` is clamped ≤120 by the RPC. There is no anti-cheat beyond that; a forged
  weight ≤120 would post. If that matters, move the weight roll server-side.
- **No new op gained a fish input** (`medical` etc.). Adding an input to an existing op throttles
  every player who lacks it to 0 output. Demand went into new buildings and a new op.
- **Admin .glb uploads for threats** are honoured (`Forge.woodsFishing.models.threats[id]`) but
  there is no upload UI for them yet — the species uploader pattern in `_wf3AdminModelsHtml`
  is the template.
- **Anomaly Hunter Ship** has no unique ability beyond its stats. A "hunts anomalies for
  double parts" trait would be the obvious next touch.
- **Coastal claim** only reads region control; no fishing income flows to the controlling corp.
- The `docs/woods-fishing-expansion.md` line-number hints drift as `index.html` grows; grep
  the function names instead.

## If you have to roll back

Each round is one commit. `git revert 32be5ff` removes round 2 cleanly (boats, threats, crew
death, tournaments, tide events, `monsterParts`); `git revert 5e310fa 32be5ff` removes both.
Player saves gain fields (`live.gear`, `live.deckhandId`, `live.catchLog[].bestKg`,
`fishingCorp.contracts`, `boats[].xp/level/mods`) that older code ignores; nothing is renamed
or removed, so a rollback does not corrupt a profile.
