# Mythic Spellbook — Game Mechanics Specification

Authoritative export of every gameplay system, pulled from the live build.
Companion machine-readable file: `/exports/game-mechanics.json`.
Element/faction detail: `/exports/elements-factions.json`.

---

## 1. Core Card Model

**Card types:** `unit`, `hero`, `spell`, `trap`, `location`, `weather`, `wall`.

**Stats (units & heroes):** `HP`, `ATK` (physical attack), `DEF` (physical defense), `MAG` (magical attack), `RES` (magical resistance), `SPD` (speed/movement tier 1–3).

**Rarities:** common, uncommon, rare, epic, legendary, mythic.

**Identity fields:** `elements[]` (1–2 of 21), `factions[]` (of 40), `passive`/`passive2`, `learnset[]` (`{lvl,m}`), `cost` (energy 1–10), `icon`, art, `kalonForm`.

**Levels:** cap **50**. XP curve: `xpForLevel(lvl) = floor(50 + 30·lvl + 5·lvl²)`.

**Known moves:** a unit/hero actively holds **max 4** (`knownMoves`); the learnset is the catalog of what it can hold. Resolution priority each build: player-customised list (Tutor purchase / level-up replace, flagged `tutorMoves`) is preserved; otherwise re-derive from the **current admin learnset** so balance edits propagate to everyone.

---

## 2. Battle System

**Board:** grid **8 wide × 7 tall**. Player hero south, enemy hero north. Reduce the enemy hero to 0 HP to win; lose if yours falls.

**Turn loop:** energy starts at 1, +1 max each turn. Each unit may **Move** (one path; longer paths cost more energy, gated by SPD tier) **and** take one **attack/ability** per turn. End Turn passes to the opponent. Per-turn timer: **120 s** (auto-ends turn at 0; frozen during tutorial until first unit is played; final-10s alarm SFX; start-turn SFX, local side only).

**Damage:** `dmg ≈ floor(power·ATK_or_MAG / (max(1,DEF_or_RES)·4)) + 2`, then multiplied by: elemental type chart, day/night shift (±20% light/shadow), STAB (+50%, +75% with Adaptability), crit, weather/location effects, and **custom element modifiers** (admin-authored strengthen/weaken on weather/spell/trap/location — multi-element, attack/defense side, physical/magical channel).

**Elemental type chart:** 21 elements; each is 2× vs the elements in its `strongVs` list; reciprocal is 0.5× unless mutual (then 2× both ways); otherwise 1×. Full matrix in `elements-factions.json`.

**Kalon transformation:** 3 charges per match. Spend one to ascend an eligible unit into its secret form (bigger stats, new moves/factions). Built-in forms: goblinKing, orcChampion, alphaWolf, archlich, infernoLord, broodmother; custom cards may define their own `kalonForm`. Forced-Kalon timings exist (e.g. `onEnter`).

**Random events:** sparkling tiles can grant items/gems/cards when a hero steps on them.

**Other board pieces:** **Walls** (50 HP, block movement/attacks), **Traps** (hidden, trigger on enemy entry; air traps hit flyers), **Locations** (persistent field effects: dot/heal/status/cleanse/energyRegen/aura/speedMod/critBonus/rangeBonus + element modifiers), **Weather** (looped field effect + element boost/penalty + stat aura + HP/turn; optional looping audio).

---

## 3. Status Effects (33)

poison, burn, bleed, siphoned, stun, slow, haste, weak, strong, shielded, focused, frozen, sleep, confusion, paralysis, dispel, assisted, spectralHaze, stumble, protected, countering, rage, infected, happy, followLead, blessed, cursed, mirror, toxic, doom, reraise, moxie, knockdown.

(Each carries dmg/turn or stat mods + trigger timing; e.g. poison 1–5 dmg at turn start. `infected` is the alien-spread mechanic.)

## 4. Passives (90+)

Includes: regeneration, lifesteal, swift, tough, magicWard, warlord, archmage, guardian, inspire, venomous, bloodthirst, weatherSummoner, taunt, physicalImmortal/magicalImmortal, physical/magicalRetribution, sturdy, adaptability, sneakAttack, geomancer, xenoBond, phoenixRebirth/rebirthShift/raiseFromDead, plus full elemental Wards (fire/water/…/blood), faction Wards (wardVsWarrior/Mage/…), and weather-synergy passives (solarFlare, monsoonMight, stormChannel, sandShroud, mistDancer, eclipseLord, etc.). Tribal/aura passives scale with allied faction counts (warriorOath, arcaneBond, packTactics, dragonsBoon, coldScales…).

## 5. Natures (24) & Traits (23)

**Natures** (±10% stat bias, Pokémon-style): adamant, modest, bold, calm, brave, timid, careful, quiet, impish, lax, lonely, naive, naughty, sassy, mild, rash, relaxed, gentle, jolly, hardy, docile, bashful, quirky, serious.

**Traits** (flat stat package, rarity-tagged): sturdy, keen, arcane, warded, hardy, balanced, brutal, ironhide, mystic, vigorous, tactician, stalwart, berserker, juggernaut, archmage, warbander, packhunter, necrobound, feywild, ancient, apex, dragonblood, sanguine.

**Bond** (0–100, per unit/hero): raises survival/learning odds, unlocks team play; low bond → desertion risk. **EVs / stat-gains:** per-level random growth + EV boosts persist per unit profile.

---

## 6. Progression & Profiles

- **Account level** — meta progression; gates Tutor (Lv 5).
- **Per-unit / per-hero profiles** (`Profile.units` / `Profile.heroes`): level, xp, kills, statGains, evs, nature, bond, morale, trauma, corruption, fatigue, knownMoves, tutorMoves.
- **Hero subclasses** — chosen at level milestones; add subclass learnset moves.
- **Egg moves** — faction inheritance pool offered at milestone levels **5, 10, 15**.
- **The Lab / Fusion** — fuse two parent units into a **Core** (egg); hatches after **3 battles** into a new fused card (max stats of parents ±10% jitter, unioned elements/factions/learnset).
- **Hero ownership lockdown** — non-admins own only what they obtain (starter/structure deck pick, packs, loot). Deck Builder & Choose-Your-Deck only list owned heroes.
- **Stat stage step:** ±3 per stage.

---

## 7. Economy & Currencies

| Currency | Field | Source |
|---|---|---|
| 🔥 **Cinders** | `Profile.gems` | Earned (battles, dailies, achievements, selling). Cashout-eligible. |
| 👑 **Sovereigns / Aza** | `Profile.sovereigns` | Premium (real money) — also tradeable in the resource exchange. |
| 🧰 **Survival Resources** | `Profile.resources` | **food, ammo, water, medicine, supplies, metal, intel** — earned from camp loot/missions; local-only persistence. |
| (legacy) Element Essence | `Profile.essence` | Dormant — replaced by resources for crafting. |

**Crafting** — cards/relics/items cost survival resources. Admins set exact per-card/item/relic `craftCost`; otherwise a rarity default applies (common→mythic scaling). Scrapping refunds 40% of resources.

**Cashout Vault** (unlock: 1 hero Lv 15): 5,000 🔥 per $1; minimum 500,000 🔥 ($100) threshold; tiered.

---

## 8. Markets & Trading

- **Vendor Market / Player Market** (unlock: 2 heroes Lv 15+) — NPC traders restock every **6 h**; sell custom cards/items for Cinders (price 5–9,999).
- **Black Market** — admin-tunable buy prices per rarity (catalog-synced).
- **Tutor Shop** (unlock: account Lv 5) — buy moves with gems; tutor-bought moves are permanently protected.
- **🧰 Resource Exchange (player-to-player, cloud)** — Supabase `resource_listings`. Post a resource stack priced in **🔥 Cinders**, **👑 Aza**, or **🔄 Barter** (a specific custom card or item/relic). Escrow on post; atomic open→sold flip (no double-sell); cancel-refund; offline payout sweep credits the seller. RLS-locked.
- **Packs / Starter decks / Structure decks** — admin-authored; starter pick is the new-player gate (one free deck; its hero + cards granted; hero pinned from the deck's own cards).

---

## 9. Roguelite Campaigns (RLC)

Node-map runs. **Node types:** battle, elite, boss, finalBoss, medical, market, treasure, event, randomEvent, mystery, rest, upgrade. **Strictly one-directional** — only the current node's forward connections are selectable (no backtracking; behind nodes grey out). Rewards (cards/relics/currency/medPoints) are granted **only on death or campaign completion** — abandoning a run forfeits everything (warned via modal). Run deck = the player's built/starter decks only. RLC **relics** are admin-authored run-scoped modifiers (maxHp/winCurrency/shopDiscount/reviveOnce/grants/etc.).

---

## 10. MGSV-Style Survivor Camp

Unlocks at hero **Lv 10**. Real-time, offline-resolving, permadeath.

**Deploy slots** (base 6, +1 per Resistance Ring level). Park a unit (5 🔥) then assign an activity:

- **Rest** — passive 10 XP/hr (cap 240; ×Training Center). Daily R&R recovers morale/fatigue/trauma.
- **Loot Run** — Scout (1 h, low danger) / Raid (3 h) / Deep Sector (6 h, permadeath risk). Survival = level + bond + morale + Intel − danger − trauma − fatigue. Outcomes: success+loot, injured, **MIA** (→ Missing wall), **KIA** (card destroyed → Memorial), or bond-break **Desert/Turn**. Drops salvage (🔥) + survival resources + chance of cards/relics/heroes.
- **Study** (12 h) — learn a move (tutor-protected), partial, fail, or rare mutation.
- **Rescue** (3 h) — send a unit to recover a MIA survivor (can save, fail, or lose the rescuer).
- **Strike the Rival** (6 h) — offensive op vs the rival faction; cuts their threat, builds reputation, can KIA the striker.

**Dynamic loot events:** ambush, hidden vault, merchant, SCP breach, demon, cosmic anomaly (secret-hero recruit), survivor rescue, weather, whispers — modify survival/loot/trauma/corruption.

**Psychology:** Trauma, Corruption, Fatigue (per unit) lower survival/study; recovered by Rest, Morale Lounge, Infirmary.

**Base building (XCOM-style grid):** facilities **Resistance Ring, Training Center, Intelligence Center, Infirmary, Research Lab, Proving Ground, Black Market, Morale Lounge, Power Relay** — each up to Lv 3–4, costs 🔥 + resources (admin-editable, catalog-synced), real-time builds, each grants a system bonus. Per-facility art + a camp ambience track are admin-uploadable (catalog-synced).

**Rival faction:** daily-escalating Threat; **Reputation** deters them; **Broker Truce** (spend 🔥, 3-day peace); hidden **Camp Invasions** (Repelled / Raided / Overrun); **Faction War** climax at max threat. **Kinship / Grief** events between bonded resting units. All resolved offline through a cinematic MGSV **Mission Debrief**; Memorial Wall + Missing-In-Action wall persist.

---

## 11. Multiplayer

- **Matchmaking** — Supabase `matchmaking_queue` + `matches`; client-side pairing + poll fallback (works without server trigger/realtime), deterministic creator, idempotent handoff, AI fallback timer.
- **Live battle** — realtime channel; each client is `player`, opponent is `ai`; `swapBattlePerspective` mirrors units/blocks/owners/**turn**/currentTurn/gameOver on every snapshot; delta + full-snapshot sync; presence/DC watchdog; emotes.
- Multiplayer always ranked; RR/AP competitive ladder, tiers, season resets.

---

## 12. Other Systems

Daily Challenge · Achievements · Replays (record/view) · Leaderboard / Competitive (RR, AP, streaks, tiers) · Friends (requests, presence badge) · Gifts · Profile dashboard · Book of Knowledge · RPG page guides (admin-authored per-screen voiced explainers) · Tombstones & cosmetics · Sprite Atelier (per-anim frames) · Camp/weather/SFX/music audio · Data Vault (admin export/import).

## 13. The Forge (Admin Authoring)

Editors: **Cards** (units/heroes/spells/traps/locations/weather/walls — stats, learnset, passives, kalon, subclasses, on-play, element modifiers, craft cost), **Moves**, **Items**, **🔮 Relics** (slot:'relic' items; equip 2 per hero), **Packs**, **Events**, **Encounters**, **Guides**, **Starter Decks**, **AI Decks**, **Structure Decks**, **Camp facility costs**, **Black Market prices**. Content publishes to a single `card_catalog` row (+ Storage for art/sprites/audio) consumed by every player. `lookupMove`/`getItemById`/custom-card lookups resolve local Forge → published Catalog so admin edits reach all players.

---

*Generated from the live source. Treat the running build as the source of truth for exact formulas/values; this spec is the system map.*
