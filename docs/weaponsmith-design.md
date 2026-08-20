# 🔧 The Weapon Smith — operation + assembly mini-game

**Status:** design agreed, not yet built. Branch `claude/weapon-smith-crafting-yczg12`.
**Inspiration:** Gunsmith Simulator (strip → clean → assemble → proof → deliver).

Three decisions were made up front and everything below follows from them:

1. **Power ceiling — crafted weapons sidegrade INTO existing stat budgets.** Never a new
   top tier. A perfect craft *equals* the best shop weapon; it does not beat it.
2. **Crafted weapons are sellable.** So stats are computed SERVER-SIDE from day one. The
   client never posts a stat block.
3. **Units first, heroes second.** Units are the simpler equip path and validate the loop.

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
| `gunParts` | Gun Parts | ⚙️ | the Weapon Smith op's `yields` |
| `gunOil` | Gun Oil | 🛢 | the **Oil Company** op (`oil`) — gives an existing business a new downstream customer |

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

### 6d. Order board

NPC contracts in the shape of the other mini-games' event tables (`FC_EVENTS`,
`WF_DISPATCH_*`): *"8mm carbine, range ≥ 2, ATK ≥ 6, delivered under 40 minutes."* Pays
Cinder + shop reputation; reputation unlocks higher blueprint tiers. This is the career
mode and the operation's Cinder faucet.

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

- `ws_mint(blueprint_id, parts, build_log)` — `SECURITY DEFINER` RPC. Recomputes
  `qualityFactor` from the build log, recomputes `stats` from
  `budget × quality × allocation`, **clamps to the blueprint budget**, and inserts. The
  client posts *what it did*, never *what it got*.
- Market listings reference a `crafted_weapons.id`. Selling transfers `owner_id`; the stat
  block travels with the row, so a buyer cannot receive forged stats.
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
| 1 | `weaponsmith` in `OPS_ECON` + `OP_LABELS`, `_opAfterFound` branch, `_wsOwnsLicense()`, the two new resources | Small, self-contained, testable via Just Business |
| 2 | Bridge + module skeleton + `Profile.weaponSmith` + cloud-save whitelist | The riskiest plumbing, done while it is still cheap |
| 3 | `getItemById` crafted source + `Profile.craftedItems` + `__craftedItems__` in the save whitelist | Mint a hardcoded weapon, equip it to a unit, verify it survives a reload **and a second device** |
| 4 | Parts as `slotType:'weaponPart'` items, vault footprints, strip-a-donor | The collectible layer |
| 5 | Assembly bench: dependency graph, fitment, torque bar | The actual game |
| 6 | `sql/038_weaponsmith.sql` + `ws_mint` + market integration | Turns it tradeable |
| 7 | Forge bench (blades) | Second craft |
| 8 | Order board + reputation + blueprint tiers | Career mode |
| 9 | Hero loadout parity + provenance UI | Round two |

**Verify with `node _synckcheck.mjs`, not `build.mjs`.** The Browser pane does not
composite, so call renderers directly rather than relying on `render()`.

---

## 11. Open questions

1. **Blueprint source.** Bought with Cinder, dropped as loot, or earned through order-board
   reputation? Reputation is the most Gunsmith-Sim-like and the best Cinder sink.
2. **Do parts stack?** `itemInventory` is quantity-based, so parts stack naturally — but
   then *part condition* cannot be per-part. Either condition is per part-type-tier
   (stackable, simpler) or parts also need minting (not stackable, richer). **Leaning
   stackable with a condition tier baked into the part id** (`bar_long_worn`,
   `bar_long_pristine`), which keeps parts inside the existing inventory model entirely.
3. **Corp-shared bench?** Communities sit above corps; a corp-owned smith serving its
   roster is a natural later feature, deliberately not in scope now.
