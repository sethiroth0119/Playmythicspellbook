# 🏙 CITY ECONOMY — HANDOFF

**You are picking up a finished, tested, shipped subsystem and connecting the rest of the
game to it.** The economy itself is done and green. What is left is *integration*, and it is
listed here in dependency order with exact file:anchor targets.

Read `ECONOMY.md` first — it is the architecture and the trap list. This file is the work
queue.

```
Branch:  claude/city-builder-economy-update-i0iitd
Head:    da84530  (+ warehouse-count fix, see "Already done" below)
Gate:    node tools/economy-tests/run.mjs   ← MUST stay green. Exits non-zero on failure.
Syntax:  node _synckcheck.mjs public/node-city/index.html
```

---

## 🔴 THE FIVE RULES. Violate any of these and you have broken the feature.

1. **Cinder is never minted.** `sim.js` audits a closed loop every tick. If you add a
   transfer, debit one account by exactly what you credit another. A failed audit disables
   the player payout — that is the tripwire for the retired Cinder Forge bug (~16,000,000 🔥/day
   for one player). Four leaks were caught this way; every one looked correct in review.
2. **Never `addRes()` / `spendRes()` a chain resource.** The 258 ids in
   `/src/resources/chain.js` are **not** in index.html's `RESOURCES`. Writing one through the
   bridge invents a ledger key the camp UI cannot show and the cloud whitelist never syncs
   (node-city documents this at `CITY_STOCK` §2b). The economy holds its own inventory. The
   **only** ledger write is the audited payout via `addCinders`.
3. **The globals trap.** `game`, `BUILDINGS`, `NODE_TYPES`, `Profile`, `Corp` are top-level
   `const` — **not** on `window`. An ES module cannot see them. `ecoHost()` / `ecoBuildings()`
   in node-city are the hand-over. There is no `window.game`.
4. **All economy numbers live in `ECON` (`tuning.js`).** No literal anywhere else, render
   code included. This is the `_opEcon()` pattern.
5. **`economy/bank.js` is NOT `player_banks`.** It is simulated NPC credit inside the closed
   loop. `player_banks.sql` moves real `Profile.gems`. Never join them.

---

## ✅ Already done — do not redo

| | |
|---|---|
| 13 modules in `public/src/economy/`, `window.MythicEconomy` | done, green |
| Recipes for **all 258** chain ids, 0 phantom inputs, 0 orphans | done |
| Node endowment (hard gate on extractors), 500-node verified | done |
| Derived prices, 0 arbitrage, residual `8.7e-8` | done |
| Households, firms, distress ladder, levels 1–5, banking, logistics, trade, specializations | done |
| Supply-chain bottleneck tracer | done |
| node-city: tick hook, save field, panel, 3 tabs | done |
| **Buildings → businesses → jobs** (`ECO_BUILDING_MAP`, 28 tile types) | done |
| Freight counts warehouse / depot / railyard / convoy anchor | done |
| Gauntlet regression gate, 3 rounds | done |

---

## 📋 THE WORK QUEUE

### 1. Bump the deploy knobs — **required before any deploy, do this last**

Four knobs, and node-city adds a fifth. Miss one and the update check breaks or the module
is served stale.

```
public/version.txt           v120w6            → bump
public/index.html            BUILD_VERSION = 'v120w6'
public/sw.js                 CACHE_VERSION = 'mythic-v120w6-chain-wiring'
public/node-city/index.html  window.NC_BUILD = "v120i3-city-eco"   ← the ?v= on the economy import
```

`NC_BUILD` **must** move whenever anything under `/src/economy/` changes — it is the
cache-buster on `import('../src/economy/index.js?v=' + NC_BUILD)`. A missed bump ships
invisibly.

Verify at the **edge** with curl, never the deploy log, and poll — propagation takes minutes.
**Commit before deploying**: `deploy.mjs` minifies `index.html` in place; if the machine dies
mid-deploy the tree holds the 9 MB minified build and `git checkout -- public/index.html` is
the only recovery.

---

### 2. Apply `sql/038_city_economy_trade.sql`

Written, idempotent, RLS-complete, **not applied**. Migrations go in by hand in the Supabase
SQL editor for project `ktsiasyjusesawtrwrjc`.

The file ends with a verify query. Expect `tables_created = 2, policies_created = 8,
functions_created = 2, rls_enabled = true`.

**Review every policy line by line before running it.** RLS is the entire security boundary.
Note in particular why `city_trade_offers` UPDATE is owner-only and filling goes through the
`SECURITY DEFINER` `city_trade_fill()` RPC: an open UPDATE policy would let a buyer set
`unit_price` to 0 and *then* fill. The RPC takes `for update` on the row — without that lock
two players filling the last 40 units both read 0 filled, both write 40, and the seller ships 80.

---

### 3. Wire real city-to-city trade  ← **the biggest remaining feature**

Today `trade.js` contains **zero** Supabase calls (deliberately — CLAUDE.md requires the app
to work offline) and trades against `simulatedPartners()` derived from the same endowment
function real nodes use. The layer is fully playable; it just has no real neighbours.

**Do not put Supabase calls in `trade.js`.** Follow the pattern `/src/trading/index.js`
already documents: the Supabase calls stay on the host side next to `Cloud` and `Profile`,
and the module receives data through a bridge.

Concretely:

- **Publish**: once per economic day, upsert this city into `city_profiles`
  (`node_id`, `specializations` from `MythicEconomy.snapshot().trade.active`, `sells` from
  the surplus, `buys` from `MythicEconomy.structuralGaps()`), and its offers into
  `city_trade_offers`.
- **Discover**: select other `city_profiles` (RLS already allows reading any), shape them as
  `{id, name, nodeId, specs[], sells{}, buys{}}` and hand them over with
  `Trade.setPartners(list)`. That is the *only* call needed — matching, freight and pricing
  already work against real partners exactly as they do against simulated ones.
- **Settle**: call the `city_trade_fill(offer_id, units)` RPC. It returns
  `(filled, remaining, unit_price)`. **Credit only `filled`** — never what you asked for.
- **Degrade**: on any error, or no rows, fall back to `simulatedPartners()`. Offline must
  keep working.

⚠ `refreshPartners()` refills *simulated* partners each day and leaves real ones alone
(`p.simulated` flag). Keep that flag set correctly or real partners will be overwritten with
fabricated inventory.

---

### 4. Hook the Foundation Reserve to card production

`MythicEconomy.cardOutput()` exists and is **never called**. It returns real Ouroboros volume
the city actually printed:

```js
{ units: { boosterPacks: n, collectorPacks: n, … }, totalUnits, value, exported }
```

🔴 **It reports. It does not mint, and it must not.** Paying out from inside the economy
would be a second, unaudited faucet — the exact bug the closed loop exists to prevent.
Whatever the Foundation Reserve does with the figure belongs on the **host** side of the
bridge, where `FoundationReserve` and `Profile` actually live, and it must be bounded there.

Suggested seam: call it on the daily close in node-city, pass `totalUnits`/`value` out through
`MythicCityBridge`, and let index.html decide. Nothing in `/src/economy/` should change.

---

### 5. Feed disasters into prices

`sim.js` reads `host.shock` (a price multiplier, `1` = normal) and node-city **never sets
it**. Raids and weather already exist and already write to the city log.

In `ecoHost()`, return a `shock` derived from the live raid/weather state — a siege or a storm
should move prices. This is one line plus a small mapping, and it turns the announcement's
"Disasters" price term from wired-but-dark into live.

---

### 6. Join the economy's jobs to the named citizens

`households.js` exports `bindRoster(citizens)` and it is **never called**. Right now
`/src/city/citizens.city.js` owns ~72 named residents with jobs, moods and dialogue, and the
economy owns aggregate employment — and they do not know about each other. A citizen can be
"unemployed" in dialogue while the economy has them working.

Do **not** merge them (that would either cap the economy at 72 people or give 4,000 people
dialogue trees). Assign named citizens to the bands/industries the economy reports, so the
person the player talks to holds a job the simulation agrees exists.

---

### 7. Surface the actions the API already offers

These are implemented and exposed on `window.MythicEconomy`, with no UI:

| Call | What it gives the player |
|---|---|
| `borrow(firmId, amount)` | Take a business loan (needs a bank tile standing) |
| `levelCheck(firmId)` | Already rendered in the Supply tab — but there is no *button* |
| `structuralGaps()` | "Your city can never mine these" → a prompt into Trade |
| `trace(resId)` | The `Iron Mine → Warehouse → Freight → Steel Mill` chain view |
| `movers(n)` | A market screen: what is spiking and why |

The panel lives at `#ecocard` / `#ecobody` in node-city with three tabs (`city` / `chain` /
`survey`), repainted by `renderEco()` on a 4s timer. Markup comes from `render.js`;
**compute no numbers in the panel** — render what the snapshot says, or the UI will
eventually disagree with the simulation.

---

### 8. Optional: promote economy resources into the visible HUD

Not required — the economy runs entirely on its own inventory. Only do this if you want chain
resources to appear in the camp/vault UI.

`RESOURCES_NEXT.md` documents the **five sites** each promotion touches and why a resource
must never be promoted without a producer (a lootable-but-unspendable pile is *worse* than a
missing one). The economy now supplies the missing producer for any id in `recipes.js`, so
that objection is answerable per-resource for the first time. Promote **with** the producer,
never before it.

---

## 🧪 How to know you have not broken it

```bash
node tools/economy-tests/run.mjs                      # 3 rounds, must be green
node _synckcheck.mjs public/node-city/index.html      # ALL CLEAN
```

Round 3 models node-city's **real** population cap (`popCap()` = 4 + 6 per housing level).
**Do not "fix" it to let population grow freely.** An earlier version did, and it made a
tuning change look strictly beneficial — employment 27→90, unemployment 92%→73% — when
against the real cap that same change pinned the city at 0% unemployment forever, *deleting*
the mechanic. A test that does not match the host's constraints will confidently point the
wrong way.

**If you change `ECON`, re-run the gauntlet.** The price graph, the wage bill and the
headcount are all derived from the same numbers; moving one moves all three.

---

## 🐛 Bugs already found here — do not reintroduce them

Each was live, each looked correct, each is now covered by the gauntlet.

- `Infinity` dt survived a `|| 0` guard (NaN and undefined did not) and ran three economic
  days off a bad clock read.
- `Math.floor(x || 0)` on save data: a non-numeric **string is truthy**, so `|| 0` never
  fired and one bad byte made population `NaN`.
- An object stored **by reference** from the host leaked `NaN` into the panel while every
  internal number stayed correct.
- Three unsaved state variables (`demandEMA`, distress `throttle`, `loanId`/`blacklistUntil`).
  The loan one let a firm take a **second loan against the first by reloading the page**.
- Matching a firm on tile key alone: a Sawmill rebuilt as a Clinic inherited the sawmill's
  cash, payroll and suppliers.
- Planning from *realised* demand only: an extractor with no local customer could never
  start — no output → no stock → no offer → no export → no demand. Standing export interest
  now feeds the forecast.
- Asserting a tile type was absent without checking `BUILDINGS`: `warehouse` had been there
  all along and every player who built one got none of its freight capacity, silently.

---

## Honest state of the balance

Structurally sound, economically stable, **not finally tuned.** All levers are in `ECON`.

- Against the real housing cap a city runs at **0% unemployment while small** and sheds jobs
  once it outgrows its own demand (~23% by day 240, ~49% by day 300 in a 30-building city).
  That arc is intended.
- Roughly **half a mature city's businesses sit idle** for want of a downstream customer.
  Correct for a 258-resource chain no single city can cover — and precisely why trade and
  specialization matter. Item 3 is what makes that pressure resolve instead of just existing.
- `unmetSubsistence` in the flow readout is a **real signal, not a bug**: the city cannot
  feed its population and needs more food production.
