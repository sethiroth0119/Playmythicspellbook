# 🔧 The Weapon Smith — operation + assembly mini-game

**Status:** design agreed, not yet built. Branch `claude/weapon-smith-crafting-yczg12`.
**Inspiration:** Gunsmith Simulator (strip → clean → assemble → proof → deliver).

Five decisions are settled, and everything below follows from them:

1. **Power ceiling — crafted weapons sidegrade INTO existing stat budgets.** Never a new
   top tier. A perfect craft *equals* the best shop weapon; it does not beat it.
2. **Crafted weapons are sellable.** So stats are computed SERVER-SIDE from day one. The
   client never posts a stat block.
3. **Units first, heroes second.** Units are the simpler equip path and validate the loop.
4. **Parts stack.** Condition is baked into the part id, not stored per-part — so parts stay
   entirely inside the existing quantity-based `itemInventory`. Only finished weapons mint.
5. **Blueprints come from all three sources:** Aza in the Vendor Market, loot drops, and
   order-board reputation.

---

## 1. Why this fits the app

| What the smith needs | What already exists |
| --- | --- |
| A "gunsmith" fiction | `technician` hero, `role: 'Gunsmith'`, sig `'Loadout Mastery'` (index.html:40451) |
| An op that is also a sub-game | Woods Fishing (`wf*`), Black River (`br*`), Fuel Command (`fc*`) |
| Weapon stat shape | `HELD_ITEMS` `stats:{atk,mag,spd,crit}` + `weapon:{range,crit}` |
| Parts as inventory objects | Tarkov vault grid, per-slotType footprints (`VAULT_GRID_DEFAULTS`) |
| An attachment map | `Profile.socketedGems` = `{cardId: [gemId…]}` — proven, cloud-synced |
| A skill-bar mini-game | the WF3 reel bar (`_wf3UpdateReel`, progress vs tension) |
| A licence gate | `_geneLabOwnsLicense()` / `_dojoOwnsLicense()` |

**Nothing here is a new kind of system.** It is Fuel Command's skeleton with a different
mini-game inside it.

---

## 2. 🔴 The one architectural problem

Item ownership in this app is **catalog-ID-keyed with no per-instance data**:

- `Profile.itemInventory[itemId] = count`
- loadout slots store an **ID string** (`lo.primeWeapon = it.id`)
- `syncVaultWithInventory()` (index.html:190830) prunes any placement whose `itemId` is
  not owned, and creates **exactly one** placement per itemId

There is nowhere to hang *"this rifle, long barrel, 4× optic, +11 ATK, 62% condition."*
A Gunsmith-style game is entirely about unique instances.

### Chosen model: minted item defs ("blueprint model")

A finished weapon is **minted as a real item def with its own generated id**, stored in a
player-owned book, and resolved by adding ONE source to `getItemById()` (index.html:42556):

```
getItemById(id)
  → Profile.craftedItems[id]     ← NEW, highest priority
  → Forge.customItems
  → Catalog.items
  → HELD_ITEMS
```

Because the minted gun **is** an item with an id, the vault, the loadout, the battle stat
reader (`index.html:201812`) and the market all keep working with **zero changes**.

Rejected: a uid-keyed instance refactor of `itemInventory`. It touches vault + loadout +
battle + market + cloud save simultaneously, and CLAUDE.md forbids touching battle/economy
code for this feature.

### ⚠ Two traps this model must not fall into

1. `Profile.craftedItems` **must** join the cloud-save whitelist as `__craftedItems__`,
   next to `__equipment__` / `__relicEquipment__` (index.html:46600). Miss this and a
   crafted gun evaporates when the player opens the game on another device — while the
   loadout still references its id.
2. `getItemById()` returning `null` makes an equipped slot render **silently empty**, not
   error. So an unresolvable crafted id is a *silent* loss of a player's weapon. The
   crafted book is therefore restored from the server before the loadout is first read.

---

## 3. The stat-budget rule (this is the balance design)

This is how "sidegrade, never a new tier" is *enforced by the maths*, not by tuning care.

```
finalStats = distribute( blueprint.budget × qualityFactor , partAllocation )
```

- **`blueprint.budget`** — a fixed point total per blueprint tier, set equal to an existing
  shop weapon. Tier examples, matched to `HELD_ITEMS`:

  | Blueprint tier | Budget | Benchmarked against |
  | --- | --- | --- |
  | Field carbine | 8 | `pw_combatRifle` (+8 ATK, range 2) |
  | Heavy frame | 12 | `pw_heavyMaul` (+12 ATK) |
  | Energy frame | 14 | `pw_pulseLance` (6 ATK + 4 MAG + range) |
  | Breacher | 14 + 8% crit | `pw_riotShotgun` |
  | Blade (secondary) | 4 | `sw_autopistol`, `sw_combatKnife` |

- **`qualityFactor`** — `0.60 → 1.00`, earned from the build (order correctness, fitment,
  torque timing, part condition). **A perfect build ties the shop item. Nothing exceeds
  1.00 — the clamp is in the server function, not the client.**
- **`partAllocation`** — parts decide *where* the budget lands: ATK vs MAG vs SPD vs crit
  vs range. This is the entire player expression. Long barrel buys range out of the ATK
  pool; a light stock buys SPD out of it.

Net effect: crafting gives you **the weapon shaped the way you want**, at the cost of
effort, and never the strongest weapon in the game. A non-crafter is never behind.

---

## 4. Resources

**Rule (from CLAUDE.md's r12 note): a resource a player can hold but cannot make is worse
than a missing one.** Every id below has a producer.

### Reused, no changes needed
`metal` (frames, barrels, blades) · `wood` (stocks, grips, handles) · `cloth` (wraps,
slings) · `fuel` (forge heat, quench) · `stone` (whetstone, grinding) · `supplies`
(fasteners) · `memoryShards` (optics/electronics) · `corruptedEssence` (exotic parts) ·
`scrapMetal` (already a `SALVAGE_RES` loot id — donor stock)

### Two new promotions to `RESOURCES` — and only two
| id | name | icon | produced by |
| --- | --- | --- | --- |
| `weaponParts` | Weapon Parts | 🔫 | the Weapon Smith op's `yields` — **and it already existed**, see below |
| `gunOil` | Gun Oil | 🛢 | the **Oil Company** op (`oil`) — gives an existing business a new downstream customer |

⚠ **`weaponParts` was already in the file.** It has been a `SALVAGE_RES` id all
along — lootable, bankable, counted by `getResourceUnits()` and **sold by the
Industrialist at 280 Cinder** — while being produced by nothing and spendable on
nothing. That is exactly the stranded-resource trap this section warns about,
sitting in the codebase already. Minting a parallel `gunParts` beside it would
have been two ids for one thing. Promoting the existing id instead fixes the
stranded resource *and* gives the smith a second supply line (the trader) for
free. Only `gunOil` is genuinely new.

Promoting them is just adding the rows to `RESOURCES` — `RESOURCE_IDS`, `_ensureResources`,
the market guard, the cost renderers and the admin editors all derive from it. The stash
floor is already per-kind (`RES_STASH_PER_KIND × kinds`) so the cap rises on its own.

⚠ The kind count moves 14 → 16. Anything asserting 14 needs checking.

---

## 5. The operation

```js
// OPS_ECON — modelled on `genelab`: the op is BOTH the licence AND the industry.
weaponsmith: {
  startup: 650000, ratePerWorkerHr: 1300, salaryPerWorkerHr: 320, maxWorkers: 8,
  yields: { gunParts: 1.5 }, inputs: { metal: 1.4, fuel: 0.3 }
},
```

- **`OP_LABELS.weaponsmith = 'Weapon Smith'` is REQUIRED, not cosmetic.** The Just Business
  catalog is built from `Object.keys(OPS_ECON)` and falls back to the raw key — without the
  label the shop lists it as "weaponsmith" (see the comment at index.html:79986).
- ⚠ **The yield and the part costs are one dial in two places** — exactly the genelab
  DNA warning. Fully staffed = 8 × 1.5 = 12 `gunParts`/hr; a mid-tier build should cost
  roughly a shift. Retune either and the other must move.
- Unlock hook: add a `weaponsmith` branch to `_opAfterFound()` (index.html:80199), matching
  the `gas` / `oil` / `cars` branches — set `owned`, log, toast, save.
- Licence check: `_wsOwnsLicense()`, copied from `_geneLabOwnsLicense()` so there is one
  recognisable way to ask the question. Reads `Operations.list` (cloud-backed) so the
  licence follows the account, not the device.

---

## 6. The mini-game: **The Bench**

Two benches under one operation, because guns and blades are genuinely different crafts.

### 6a. 🔫 Assembly Bench (guns) — the Gunsmith Simulator loop

An **exploded-view board** in DOM. Parts tray on the left, receiver silhouette in the
middle with numbered anchor points. No 3D, no canvas required.

**Take a job** → **Strip a donor** → **Clean/refurb** → **Assemble** → **Proof** → **Deliver or Keep**

Three sources of difficulty, all cheap to implement and all faithful to the reference:

1. **Order matters.** Each blueprint carries a dependency graph — the handguard cannot seat
   before the barrel, the dust cover cannot close before the bolt. Wrong order = the part
   is refused *with the reason*, which is how the player learns the weapon.
2. **Fitment.** Every anchor declares an accepted `partType` **and** a `mount` tag
   (picatinny vs dovetail, 5.56 vs 7.62, tang width). A mismatched part is refused with a
   named reason. This is where part *variety* becomes knowledge rather than noise.
3. **Torque.** A per-fastening timing bar — reuse the WF3 reel pattern (`progress` vs
   `tension`, hold-to-fill, overshoot fails). Under-torque and over-torque both cost
   quality; stripping a fastener costs a `gunParts`.

**Part taxonomy (gun):** receiver · barrel · bolt/action · trigger group · stock ·
handguard · magazine · optic · muzzle device · grip

**Strip** is the same board run backwards, and is the main *source* of parts: donor
weapons drop from nodes/battles as `scrapMetal`-tier junk, and stripping yields parts at
varying condition. This is the reference game's real economy and it costs us nothing new.

### 6b. ⚔️ Forge Bench (knives + swords) — a different game on purpose

Blades are not assembled, they are **made**: heat → hammer → quench → temper → grind →
sharpen. A short sequence of timing/temperature steps against a heat bar (`fuel` burns
throughout, `stone` for grinding, `gunOil`/`cloth` for finish). Over-quench cracks the
blade; under-temper leaves it soft.

**Part taxonomy (blade):** blade blank · tang · crossguard · grip/handle · pommel · fitting

### 6c. Condition — and the line it must not cross

Parts carry `condition 0–100`, cleaned up with `gunOil` at the bench. Condition feeds
`qualityFactor` **at mint time only**.

⚠ **Condition never decays on an equipped weapon.** Ongoing durability would mean touching
battle code, which is out of scope per CLAUDE.md. Condition lives entirely inside the
smith. A minted weapon's stats are fixed forever.

### 6d. Parts stack — condition is in the id

`itemInventory` is quantity-based, so parts stack naturally. Rather than fight that,
**condition is a tier baked into the part id**:

```
bar_long_pristine   bar_long_worn   bar_long_shot     (barrel, long profile)
rcv_mil_pristine    rcv_mil_worn    rcv_mil_shot      (receiver, milspec)
```

- Stripping a donor yields the tier the donor was in. Junk donors yield `worn` / `shot`.
- The **Cleaning station** consumes `gunOil` (+ `cloth`) to promote a part one tier:
  `shot → worn → pristine`. That is the whole refurb loop and it is a pure id swap.
- Condition tier is one input to `qualityFactor` at mint time. A `pristine` build tops out
  at 1.00; a `shot` build cannot reach it however well you assemble.

**Nothing about parts needs minting, uid tracking, or a server row.** Parts are ordinary
stackable items in the vault, tradeable on the existing market with zero new code. Only the
finished weapon mints. This halves the mint surface and was the deciding reason.

---

## 6.5 Where blueprints come from

Three sources, each with a distinct job. **The same blueprint should be reachable more than
one way** wherever possible — that is what keeps Aza a *shortcut* rather than a *gate*.

| Source | Role | Mechanism |
| --- | --- | --- |
| **Ⓐ Aza — Vendor Market** | Buy access now | New `🔧 Blueprints` tab in `renderVendorMarket()` (index.html:162056), priced in Aza via `spendSovereigns()` |
| **🎁 Loot drops** | Exploration reward | Blueprint drops from nodes/caches like any other item |
| **🏅 Order-board reputation** | Mastery track | Rep tiers unlock blueprint tiers — see §6.6 |

### Why Aza-priced blueprints are not pay-to-win

Because of the §3 budget rule, a blueprint bought with real money produces a weapon that
**cannot exceed the shop weapon it is benchmarked against**. Aza buys *which shapes you can
build*, not *how strong they are*. A player who never spends reaches the same ceiling
through loot and reputation. Worth stating in the store copy, not just in this doc.

### 🔴 Aza blueprints are a real-money entitlement — they MUST be server-held

This is the single easiest thing to get wrong here, and the existing precedent gets it
wrong in a way we must not copy.

- **Aza is `Profile.sovereigns`, bought with real money only** (index.html:44488).
- `Profile.gems` and `Profile.sovereigns` are **deliberately NOT uploaded** to the cloud
  save (index.html:46751, v120t7) — the balance is server-canonical via `sov_charge` /
  `aza_purchases`.
- The Oil Sim stores its Aza-bought blueprints in **local state only**
  (`_osimState.blueprints`, index.html:199277). For a real-money purchase that means a
  device change or a cache clear destroys something the player paid cash for.

So: **blueprint ownership is a server row (`ws_blueprints_owned`), written in the same
transaction as the Aza charge — never a local flag.** Loot-granted and rep-granted
blueprints go in the same table so there is one source of truth for "what can this player
build".

⚠ `spendSovereigns()` debits locally and returns `true` **before** the server `sov_charge`
resolves; it hands back a ledger id via a promise. The grant path must therefore await the
charge and call `refundSovereigns()` if the entitlement write fails — otherwise a player
can be charged for a blueprint they never receive.

---

## 6.6 The Order Board + Reputation

Reputation is the career spine: it is what makes being *good* at the craft pay, and it is
the third blueprint source.

**Precedent to copy:** Fuel Command already runs a multi-axis reputation with generated
reviews (`s.rep`, `s.repPrice`, `s.repSafety`, `s.repQuality`, `s.repReli`, `FC_REVIEWS` at
index.html:199530). The Weapon Smith uses the same shape so it reads as one game.

### Contracts

Generated onto the board like `FC_EVENTS` / `WF_DISPATCH_*`. A contract is a **spec plus a
deadline**, never a named item — the player decides how to meet it:

```js
{ id, client, tier, deadlineMs,
  spec:   { class: 'carbine', minRange: 2, minAtk: 6, maxWeight: 8 },
  pays:   { cinder: 4200, rep: 6 },
  bonus:  { onQuality: 90, cinder: 1500 } }
```

### Three reputation axes

| Axis | Earned by |
| --- | --- |
| `repQuality` | the `qualityFactor` of what you delivered |
| `repSpeed` | delivering inside the deadline |
| `repSpec` | meeting the spec exactly — overshooting is not rewarded |

Overall `rep` is their weighted blend. **Failing or letting a contract expire lowers it** —
a board with no downside is a board with no decisions.

### Rep tiers

| Tier | Rep | Unlocks |
| --- | --- | --- |
| Unproven | 0 | 1 concurrent contract, tier-1 blueprints |
| Jobbing Smith | 20 | 2 contracts, better pay |
| Registered Armorer | 45 | 3 contracts, tier-2 blueprints |
| Master Armorer | 70 | 4 contracts, tier-3 blueprints |
| Guild Master | 90 | 5 contracts, exotic blueprints, best clients |

Rep-unlocked blueprints are written to the same `ws_blueprints_owned` table as Aza and loot
grants — one source of truth, and rep unlocks survive a device change for free.

⚠ Rep must be **server-held too**, for a different reason than Aza: it gates content and is
trivially forgeable in a local save. Same table pattern, `SECURITY DEFINER` writes only.

---

## 7. Server side (required by "sellable" from day one)

`sql/038_weaponsmith.sql` — idempotent, re-runnable, ships its RLS in the same file,
ends with a verify query.

```
crafted_weapons
  id uuid pk
  owner_id uuid not null references auth.users(id) on delete cascade
  blueprint_id text not null
  parts jsonb not null            -- [{slot, partId, condition}]
  quality int not null            -- 0..100, SERVER-computed
  stats jsonb not null            -- SERVER-computed, never client-posted
  created_at timestamptz default now()
```

```
ws_blueprints_owned                    -- one source of truth for "what can this player build"
  owner_id uuid not null references auth.users(id) on delete cascade
  blueprint_id text not null
  source text not null                 -- 'aza' | 'loot' | 'rep'
  aza_ledger_id uuid                   -- set when source='aza'; the sov_charge receipt
  granted_at timestamptz default now()
  primary key (owner_id, blueprint_id)

ws_shop                                -- the smith's career record
  owner_id uuid primary key references auth.users(id) on delete cascade
  rep int not null default 0
  rep_quality int not null default 0
  rep_speed int not null default 0
  rep_spec int not null default 0
  contracts jsonb not null default '[]'
  updated_at timestamptz default now()
```

- `ws_grant_blueprint(blueprint_id, source, aza_ledger_id)` — `SECURITY DEFINER`. For
  `source='aza'` it **verifies the ledger id against the Aza charge** before granting, so a
  client cannot grant itself a paid blueprint by calling the RPC directly. Idempotent on
  `(owner_id, blueprint_id)`.
- `ws_deliver(contract_id, crafted_weapon_id)` — scores the delivery against the contract
  spec **server-side**, moves rep, pays Cinder. Rep is never client-written.
- `ws_mint(blueprint_id, parts, build_log)` — `SECURITY DEFINER` RPC. Recomputes
  `qualityFactor` from the build log, recomputes `stats` from
  `budget × quality × allocation`, **clamps to the blueprint budget**, and inserts. The
  client posts *what it did*, never *what it got*.
- Market listings reference a `crafted_weapons.id`. Selling transfers `owner_id`; the stat
  block travels with the row, so a buyer cannot receive forged stats.
- **Blueprint ownership is checked in `ws_mint`.** Minting a weapon from a blueprint the
  player does not own must fail server-side, not just be hidden in the UI.
- **RLS is the whole security boundary.** `select` = `owner_id = auth.uid()` **or** the row
  is on an open listing. `insert` only via `ws_mint`. No direct client `update` of `stats`
  or `quality` — ever.
- ⚠ Any membership-style check must go through a `SECURITY DEFINER` helper, per the RLS
  recursion note in CLAUDE.md.

Offline/degraded path (non-negotiable per CLAUDE.md): with no Supabase, the bench still
runs and mints **locally, untradeable**, flagged `local: true`. Guarded exactly like
`Corp.*`.

---

## 8. Equipping

**Round one — units.** Units are still on the legacy single-slot map,
`Profile.equipment['u_goblin'] = itemId`. A minted weapon is an itemId, so this works the
moment `getItemById` resolves it. No new equip code at all.

**Round two — heroes.** `Profile.heroLoadouts` with `primeWeapon` / `secondaryWeapon`.
Also already works by id; the extra work is UI (showing quality, parts, provenance) and
the migration path at index.html:188130 that promotes legacy `Profile.equipment` into
`primeWeapon`.

---

## 9. Where the code lives

Per CLAUDE.md: **a new top-level system does not go in index.html.**

```
public/src/weaponsmith/
  index.js          entry, registers with the bridge
  state.js          ensureWeaponSmith() — Profile.weaponSmith shape + defaults
  blueprints.js     blueprint catalogue + stat budgets + dependency graphs
  parts.js          part catalogue, mount tags, condition
  bench.gun.js      assembly board + torque mini-game
  bench.forge.js    blade forging mini-game
  mint.js           local mint + ws_mint RPC call, guarded
  render.js         DOM
  ws.bridge.js      the seam
```

### 🔴 The globals trap

`Profile`, `Cloud`, `App`, `Corp`, `Forge` are top-level `const` in index.html — **lexical
bindings, not on `window`.** An ES module cannot see them. This has already cost real time
twice. index.html must hand the module what it needs through a bridge, the way
`window.MythicBridge` does for `/src/community`.

`window.WeaponSmithBridge` surface to design **before writing the module**:

```
profile:   getWeaponSmith(), save()
resources: getRes(id), addRes(id,n), spendRes(costMap), cxProduce(map, 'weaponsmith')
currency:  gems(), spendGems(n), addGems(n)
items:     getItemById(id), grantItem(id), craftedBook()  // read+write Profile.craftedItems
cloud:     rpc(name, args), from(table)   // null when offline — module must degrade
ui:        showToast(msg, ms), gcConfirm(msg), render()
licence:   ownsWeaponSmith()
```

---

## 10. Build order

| Phase | Ships | Notes |
| --- | --- | --- |
| ✅ 1 | `weaponsmith` in `OPS_ECON` + `OP_LABELS`, `_opAfterFound` branch, `_wsOwnsLicense()`, the two new resources | **Done.** `gunOil` is produced by `OPS_ECON.oil` (additive — the fuel rate is untouched) so neither new resource ships without a producer |
| ✅ 2 | Bridge + module skeleton + `Profile.weaponSmith` + cloud-save whitelist | **Done.** `window.WeaponSmithBridge` + `src/weaponsmith/{ws.bridge,state,index}.js`. `__weaponSmith__` restores LOCAL-WINS because `bench` holds already-paid-for materials. Probe: `__mg.weaponSmith` |
| ✅ 3 | `getItemById` crafted source + `Profile.craftedItems` + `__craftedItems__` in the save whitelist | **Done.** `mint.js` holds the §3 budget clamp + a refusal assert. `__craftedItems__` merges ADDITIVE-ONLY (a dropped def reads as a vanished weapon). Probe: `__mg.weaponSmith.mint()` / `.equip()` |
| ✅ 4 | Parts as stackable `slotType:'weaponPart'` items (condition in the id), vault footprints, strip-a-donor, cleaning station | **Done.** `parts.js`: 21 variants × 3 tiers = 63 ids + 3 donors, registered into `getItemById` via `WS_PART_DEFS`. Probes: `__mg.weaponSmith.strip()` / `.clean()` |
| ✅ 5 | Assembly bench: dependency graph, fitment, torque bar | **Done.** `blueprints.js` (5 frames) + `bench.gun.js` (order / fitment / torque / scoring) + `render.js` (module-owned overlay). Opened by the `openWeaponSmith` JB action — **the JB iframe still needs a sidebar entry emitting it** |
| ✅ 6 | `sql/038_weaponsmith.sql` — `crafted_weapons`, `ws_blueprints_owned`, `ws_shop`, `ws_blueprints` + `ws_mint` / `ws_grant_blueprint` / `ws_deliver` / `ws_state` | **Done and verified against a real Postgres 16** — see the commit. `server.js` routes the bench mint through `ws_mint`; offline still mints `local: true` (untradeable). ⚠ **Not yet applied** — run it by hand in the SQL editor |
| ✅ 7 | Loot-dropped blueprints (grant through `ws_grant_blueprint`, source `'loot'`) | **Done.** `schematics.js` — blueprints drop as TRADEABLE items consumed to grant the entitlement. Loot hook: `window.wsDropSchematic()`. ⚠ **Not wired into the battle drop table** — that arm is battle code, out of scope |
| ✅ 8 | Ⓐ Blueprints tab in the Vendor Market | **Done.** `wsBuyBlueprintAza()` owns charge+refund together (the module is never handed a bare charge). Button disables on click — two clicks would be two charges for one frame. Verified: Aza restored on every failure path |
| ✅ 9 | Order board + reputation + rep-gated blueprint tiers | **Done.** `sql/039_weaponsmith_board.sql` — contracts are SERVER-generated from templates. Verified against Postgres 16; caught a real bug (a new smith's first roll was throttled to an empty board). ⚠ **Not yet applied** |
| 10 | Forge bench (blades) | Second craft |
| 11 | Hero loadout parity + provenance UI | Round two |

⚠ **Two migrations to apply by hand**, in order: `sql/038_weaponsmith.sql` then
`sql/039_weaponsmith_board.sql`. Until they are, the client keeps its mirror, the board
stays empty, and every mint takes the local (untradeable) path — the intended degraded
behaviour, not a breakage.

**Verify with `node _synckcheck.mjs`, not `build.mjs`.** The Browser pane does not
composite, so call renderers directly rather than relying on `render()`.

---

## 11. Decisions log

| Question | Decision |
| --- | --- |
| Power ceiling | **Sidegrade only.** Budget × quality (clamped ≤ 1.00), parts redistribute |
| Sellable? | **Yes** — so stats are server-computed from day one |
| Units or heroes first | **Units**, via the existing single-slot `Profile.equipment` |
| Do parts stack? | **Yes** — condition tier baked into the part id. Only weapons mint |
| Blueprint source | **All three** — Aza in the Vendor Market, loot drops, rep tiers |

## 12. Still open

1. **Aza pricing per blueprint tier.** Shipped at **tier 2 = 12 Aza, tier 3 = 22 Aza**,
   benchmarked against the Oil Sim's 8 / 18 / 25 licences (index.html:198734) — the only
   in-app reference point. Easy to retune: the numbers live in `store.js` `AZA_PRICE` and
   in `ws_blueprints.aza_price`, and **the server's copy decides** (a client that
   undercharges gets `underpaid` and a refund, which is the correct failure).
2. ~~Do blueprints drop as items or as entitlements?~~ **Resolved in phase 7: item.**
   A schematic is a tradeable item consumed to grant the entitlement. A schematic in the
   vault is an *asset*; a learned blueprint is a *capability*. Selling the first is
   reasonable, "selling" the second would mean un-learning, which nothing else here does.
3. **Corp-shared bench.** Communities sit above corps; a corp-owned smith serving its
   roster is a natural later feature, deliberately not in scope now.
