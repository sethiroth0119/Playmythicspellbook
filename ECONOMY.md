# 🏙 The Living Economy — what landed, and what is next

`public/src/economy/` — 13 ES modules, registered on `window.MythicEconomy`.
Wired into `public/node-city/index.html` through one tick hook, one save field and one panel.

Nothing in `public/index.html` changed. The economy is additive and fully guarded: a 404 on
`/src/economy/*` costs the player the economy card and nothing else.

---

## The one rule everything else follows

**Cinder is never minted.** `sim.js` runs a closed loop and asserts it every tick:

```
Δ(households + firm cash + treasury + bank reserve) === exports + faucet − imports − payout
```

If that identity breaks, `payoutAllowed` goes false and the city stops paying its owner
until the books balance. node-city retired the Cinder Forge for minting currency with no
customer behind it (~16,000,000 🔥/day for one player); this is the tripwire that stops it
being reintroduced by accident across the ~40 transfers in the tick.

**The audit found four real leaks during development.** Every one of them looked correct in
review:

| Leak | What it did |
|---|---|
| Payroll tax | Treasury credited `wages × rate`; nothing debited. Minted ~6% of every wage. |
| Property tax | Charged *on top of* rent instead of *out of* it. Minted 2% of all rent. |
| Retail → producer | Producers credited whether or not the shop could pay. |
| `levelUp()` | Spent the firm's cash into `pay()` and nowhere else — **destroyed** Cinder. |

That last one is why the audit checks both directions. Money vanishing is harder to notice
than money appearing, because the number only ever goes down.

---

## What each module owns

| File | Owns |
|---|---|
| `tuning.js` | **`ECON` — the one tuning table.** The `_opEcon()` pattern. No economy number lives anywhere else. |
| `recipes.js` | The production graph. All 258 chain ids, `DEPOSITS`, `BYPRODUCTS`, `ALT_FEEDSTOCK`, 50 industries. |
| `endowment.js` | What is in the ground under a node. **The one gate** on whether an extractor may exist. |
| `prices.js` | Prices **derived** from the graph, then moved by supply/demand/scarcity/freight/competition. |
| `households.js` | Jobs, wages, the consumption basket, wealth tiers, subsistence. |
| `firms.js` | Balance sheets: cash, payroll, ground rent, the distress ladder, levels 1–5. |
| `logistics.js` | Freight capacity, congestion, delivered cost. |
| `bank.js` | Simulated firm credit. **Not `player_banks`** — see below. |
| `trade.js` | Specializations (earned, never chosen) and city-to-city trade. |
| `sim.js` | The circular flow and the audit. |
| `bottleneck.js` | The supply-chain view — *why* a factory is at 42%. |
| `render.js` | Markup only. No number is computed here. |
| `index.js` | `window.MythicEconomy`, the bridge seam, self-checks. |

---

## Verified — run the gauntlet

```
node tools/economy-tests/run.mjs      # the regression gate; exits non-zero on failure
node .gauntlet/verify-power-trade.mjs # the electricity-link gate (see below)
node _synckcheck.mjs public/node-city/index.html
```

| Check | Result |
|---|---|
| Recipe graph vs `chain.js` | **258/258 ids**, 0 phantom inputs, 0 orphans |
| Price relaxation | converges, residual `8.7e-8` |
| Arbitrage (output priced below its own inputs) | **0 violations** across the graph |
| Endowment guarantees | hold across **500 nodes** |
| Conservation of Cinder | **0 failures**, 40 randomized cities × 120 days |
| Hostile input (NaN/∞ dt, corrupt saves, zero pop) | survives, no NaN escapes |
| Save/load completeness | exact at 0 ticks; drift bounded <1% after 15 days |
| Buildings → businesses → jobs | grows, closes, idempotent, no inheritance |
| node-city syntax | ALL CLEAN |

### What the gauntlet caught

Everything below was live in the committed code and looked correct in review.

| Bug | Consequence |
|---|---|
| `Infinity` dt survived the guard | A bad clock read from the host ran three economic days and moved money. |
| `Math.floor(str)` in `households.load` | One bad byte in a save made population `NaN`, poisoning the treasury and the audit. |
| Freight counts stored by reference | A bad host count printed `NaN` warehouses while every internal figure was right. |
| `demandEMA` not serialized | A reloaded city re-entered the production warm-up and drifted — 28 firms became 29. |
| `loanId` / `blacklistUntil` not serialized | **A firm could take a second loan against the first by reloading the page**, and a defaulter got its credit back free. |
| Distress `throttle` not restored on load | A failing business ran at full rate for one tick after every reload. |
| Rebuilt tile kept the old firm | A Sawmill rebuilt as a Clinic inherited the sawmill's cash, payroll and suppliers. |
| Extractors could never start | Production planned only from *realised* demand, so a copper mine with no local customer sat dark while four partner cities were openly buying copper. Export interest now feeds the forecast. |

### One tuning trap worth remembering

A sweep of `laborUnitsPerDay` said 5 was strictly better than 12 — employment
27→90, unemployment 92%→73%. **That sweep was wrong**, because the test city's
population grew freely. node-city gates population on housing
(`popCap()` = 4 + 6 per housing level), and against the real cap 5 pins the city
at 0% unemployment permanently — deleting the mechanic rather than fixing it.
The value stayed at 12. *A test that does not match the host's constraints will
confidently point the wrong way.*

---

## 🔴 Traps — read before touching this

**The globals trap (again).** `game`, `BUILDINGS`, `NODE_TYPES` are top-level `const` in
node-city's module script and invisible to an ES module. `ecoHost()` in node-city IS the
hand-over. There is no `window.game`.

**Never write a chain resource through the bridge.** The 258 ids are *not* in index.html's
`RESOURCES`. `addRes('flour', 5)` invents a ledger key the camp UI cannot show and the cloud
whitelist never syncs — node-city documents this at `CITY_STOCK` §2b. The economy holds its
own inventory. The **only** ledger write is the audited Cinder payout via `addCinders`.

**`bank.js` is not `player_banks`.** The repo already ships a player-facing chartered bank
moving real `Profile.gems`. These loans are simulated NPC credit inside the closed loop.
Wiring them together would let a simulated bakery draw on a real player's reserves — a
duplication bug that would look correct on both sides in isolation.

**Endowment is a hard gate; terroir is a soft one.** They answer different questions and must
not be merged. Terroir's §SOLO promise ("nobody is ever locked out") is preserved at the
*economy* level, not the tile level: a resource you cannot mine, you can always **buy**. So
`canExtract()` returning false must never gate a *purchase* path. Grep before adding a caller.

**Two graph cycles are real and are not bugs**: `steel ⇄ recycledMetal` and `electricity ⇄
its fuels`. `topoOrder()` breaks them deliberately and `cycles()` reports which. A real
economy is circular.

**Base price uses the *primary* leg, not the cheapest.** Using the cheapest made `steel`
derive below `pigIron`, its own input — a live arbitrage, because the arc-furnace leg runs on
near-free scrap. A base price is what a thing costs made the way you can *always* make it;
the recycled leg's advantage is margin, and `bestLeg()` still picks it at run time.

---

## Balance notes (honest state)

The simulation is **structurally** sound and **economically** stable. Three things are tuning
surfaces rather than finished numbers, all reachable from `ECON`:

1. **Employment tracks buildings, and that now works end to end.** Against node-city's real
   housing cap, a city runs at **0% unemployment while it is small** and starts shedding jobs
   once it outgrows its own demand (~23% by day 240, ~49% by day 300 in a 30-building city).
   That arc is the intended one. Roughly half of a mature city's businesses sit idle for want
   of a downstream customer — correct for a 258-resource chain that no single city can cover,
   and the reason the trade and specialization layers matter.
2. **`unmetSubsistence` is a real signal, not a bug.** It means the city genuinely cannot feed
   its population — two bakeries cannot supply 278 people. That is a bottleneck to solve by
   building, and the panel says so.
3. **Firms hold large cash relative to households.** `dividendRate` (0.45),
   `UPKEEP_SPEND_RATE` and now `firm.privateCapital` are the levers. Under-consumption
   without dividends was severe enough to pin household savings at zero; it is fixed, not
   necessarily optimal. **The residual is still real and it is measurable**: a 705-day
   node-city board driven through `/src/tenants` finished with 690,768 🔥 of firm cash,
   **14 🔥** of household savings and 2 🔥 in the treasury.

---

## 🏦 The two arrows added after the churn audit

A critic drove a 34-lot commercial district for 600 economic days and found every business
dying about every 60 days for ever — 345 closures, all with the same sentence. The
diagnosis and both fixes are in the source; this is the map.

### 💼 `firm.privateCapital` — savings → new business

**The finding.** Past day 480 `charterIssued` sat pinned at its 700,000 🔥 lifetime ceiling
and `charter` had drained to 0, so `fundFounding` had nothing to draw on and every
re-founded shopfront opened with an empty till. **And the city was not poor**: 692,528 🔥 of
its 696,048 🔥 was firm cash, 74% of it in one landlord and one power plant, against
2,275 🔥 of household savings.

**So it is a missing arrow, not a shortage.** Every other arc of the circular flow exists —
wages, dividends, b2b, rent, tax, benefits, upkeep, municipal spending — and the one that
did not is SAVINGS → NEW BUSINESS. `drawPrivateCapital()` subscribes a new firm's seed
capital out of incumbent firms' surplus, **before** the charter fund, because the charter
allowance is finite and irreplaceable while private surplus regenerates. A firm may be a
source only if it is HEALTHY, in lifetime profit, and holding more than
`privateCapital.floorDays` (30) of its own operating cost — so a freshly-seeded firm (12
days) can never fund the next one and a bootstrap cannot cannibalise itself.

Measured on the same 600-day board, same seed, one variable:

| | before | after |
|---|---|---|
| `charterIssued` at day 600 | **700,000 — the ceiling, exhausted** | **380,000**, frozen since day ~60 |
| charter fund at day 600 | 0 | 80,000 (full) |
| seed capital that could not be funded | 74,099 🔥 and climbing | 28,189 🔥, **all of it at bootstrap** |
| private capital subscribed | — | 417,384 🔥 over 82 re-foundings |
| audit | ok | ok, `err 0`, `delta 0` |

⚠ **It is not a universal fix and the limit is measured.** On the `/src/tenants` crit board
the arrow contributes only ~21,000 🔥, because **not one of that city's 220 firms is a
saver**: the richest holds **10.65 days** of its own operating cost against a 12-day
founding buffer. That city is not hoarding, it is thin — its whole 690,768 🔥 is committed
working capital. Raising `lifetimeCap` is the tuned-number move and is **not** the answer;
what that board shows is a city running 220 businesses on a 700,000 🔥 allowance.

### 🏷 `firm.groundRent` — a business pays for where it is

"Eventually one FAILS because rent gets too expensive." Before this it could not: firm
operating cost is wages + inputs, `tax.property` was charged on *household* rent only, and
no file in `/src/economy` mentioned `MythicLandValue`.

- **Priced off the LOCATION PREMIUM, not `valueAt()`.** The printed value carries an
  unbounded city-wide term (`decorPoints()`); renting off it would charge every business in
  the city for a garden planted across town, for ever.
- **The money goes where household rent already goes** — property tax **out of** the rent to
  the treasury, the net to the `landlord` firms, and to the treasury when the city has none.
  Landlords are exempt from paying it: their plots are already priced by household rent.
- **Flat per plot.** It does not scale with the tenant's size, revenue or level — a rent
  that shrank as a firm failed could never push one under, and not scaling with level is
  what makes *building up* a tenant's answer to expensive ground.
- **No `/src/landvalue` ⇒ no rent at all**, never a default premium.

The ledger row it makes possible, on a board where the land value ramps from 15 to 275
under a district that was already trading:

```
d353 🏚 Card Shop (boosterPacks) went bankrupt. 🏷 Ground rent took 1,893 🔥 —
     it was 1,012 🔥 in profit before the rent.
```

Same board, same ramp, rent the only difference: 117 → 207 closures in 600 days, 0 → 2 of
them stated by the books as rent-caused, 690,274 🔥 collected, and the audit clean on every
one of the 600 days (`err −7e-12`). Rate sweep, to show the number is not fitted to a
symptom: `perPremiumDay` 0.10 → 165 deaths / 1 rent-caused, 0.22 → 207 / 2, 0.40 → 268 / 17.

---

## 🔌 The one thing outside this module that moves Cinder through it

`/src/power` trades electricity over the outside connection (`/src/outside` — the
Highway Interchange). It **does not move money**. It measures the energy that crossed
the link, prices it with the one tariff in `POWER.trade`, and calls
`MythicEconomy.utilityTrade({ importValue, exportValue })`, which accumulates a bill.

`sim.js` `settleUtility()` settles that bill **inside `runDay`**, through the two
channels that were already audited and no others:

| Leg | Channel | Why that one |
|---|---|---|
| Import | `S.treasury -= paid` → `addImports(paid)` | The Cinder left the city with the energy. It lands in `flow.imports`, which is an `outgoings` term of the payout basis. |
| Export | folded into the day's `earned` → the **same** faucet | Exported electricity is real exported volume, so it enters under the *one* `ECON.faucet.maxPerMin` ceiling rather than beside it. Two separately-capped faucets are two faucets. |

Three things about it are load-bearing and are the reasons it is shaped this way:

1. **It settles inside the audit window, not where the energy is measured.** The power
   tick runs at the host's cadence. Money that moves *between* two `runDay` windows is
   invisible to `audit()` — the blind spot the founding mint lived in for its whole life.
2. **An unpayable bill becomes `arrears`, never a write-off.** The energy was already
   delivered and the city ran on it; forgiving the shortfall is the "credited whether or
   not the shop could pay" leak with the sign flipped. The debt curtails the *import* and
   leaves the *export* open, so selling the surplus is the way out.
3. **`flow.utilityImport` / `flow.utilityExport` are readouts, not bookings.** Delete
   them and the books balance exactly as they do now. `audit()` does not mention them.

`.gauntlet/verify-power-trade.mjs` is the gate: conservation over 240 days in each
direction, the export arriving as `flow.faucet` and nothing else, arrears surviving a
reload, a round trip losing money, and — the one nobody would think to check — that a
city which *buys* power does not pay its owner **more** than one that does not. `sim.js`
warns that any new claim on the treasury "buys itself back out of the payout basis"
(measured once at +61.3%); that round is what proves this charge does not.

Both halves of the gate have been seen to fail, by injuring `settleUtility()` once each:
crediting the export straight to the treasury reported 240 audit failures out of 240
days; zeroing the arrears went red on the debt rounds **while the audit stayed perfectly
clean**, which is why that round does not settle for asking the audit.

---

## Not built (deliberately, and why)

- **Real city-to-city trade over the network.** `sql/038_city_economy_trade.sql` is written,
  idempotent, RLS-complete, with a locking `city_trade_fill()` RPC — but **not applied**
  (migrations are applied by hand in the Supabase SQL editor). Until then `trade.js` runs
  against simulated partners derived from the same endowment real nodes use, so the layer is
  fully playable solo and the networked version is the same code with better partners.
- **A Foundation Reserve payout for card production.** `cardOutput()` *reports* real Ouroboros
  volume; it does not mint. What the host does with that number belongs on the host's side of
  the bridge where `FoundationReserve` and `Profile` actually live. Paying from inside the
  economy would be a second, unaudited faucet.
- ~~Per-building firm mapping in node-city.~~ **Now wired.** `ECO_BUILDING_MAP` in
  node-city maps 28 tile types to industries and candidate outputs; the economy picks the one
  the node's ground supports (`pickAvailable`), so a Farm grows wheat on one node and rice on
  another and is not offered at all where neither exists. Businesses are founded when a
  building goes up, closed when it comes down, and replaced (not inherited) when a tile is
  rebuilt as something else. Capacity scales with tile level. Tiles with no payroll and no
  customers — roads, walls, decor — are deliberately absent from the map, so they are exactly
  what they were before this feature existed.
- **Discord webhooks.** Out of scope, permanently (CLAUDE.md).

---

## Deploying

Unchanged, and still three knobs together or the update check breaks:
`public/version.txt`, `window.BUILD_VERSION`, `sw.js CACHE_VERSION`. node-city additionally
carries `window.NC_BUILD`, which is the `?v=` cache-buster on the economy import — **bump it
or the module is served stale.** Verify at the EDGE with curl, and poll; propagation takes a
couple of minutes.
