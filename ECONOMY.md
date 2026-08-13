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
| `firms.js` | Balance sheets: cash, payroll, the distress ladder, levels 1–5. |
| `logistics.js` | Freight capacity, congestion, delivered cost. |
| `bank.js` | Simulated firm credit. **Not `player_banks`** — see below. |
| `trade.js` | Specializations (earned, never chosen) and city-to-city trade. |
| `sim.js` | The circular flow and the audit. |
| `bottleneck.js` | The supply-chain view — *why* a factory is at 42%. |
| `render.js` | Markup only. No number is computed here. |
| `index.js` | `window.MythicEconomy`, the bridge seam, self-checks. |

---

## Verified

Run these; they are cheap and they are the regression gate.

```
node --input-type=module -e "Promise.all([import('./public/src/economy/recipes.js'),
  import('./public/src/resources/chain.js')]).then(([R,C])=>console.log(R.audit(C.RESOURCE_CHAIN.map(r=>r.id))))"
node _synckcheck.mjs public/node-city/index.html
```

| Check | Result |
|---|---|
| Recipe graph vs `chain.js` | **258/258 ids**, 0 phantom inputs, 0 orphans |
| Price relaxation | converges, residual `8.7e-8` |
| Arbitrage (output priced below its own inputs) | **0 violations** across the graph |
| Endowment guarantees | hold across **500 nodes** |
| Closed-loop audit | **0 failures** over 200 economic days × 4 nodes |
| Save round-trip | `totalCinder` preserved to rounding |
| node-city syntax | ALL CLEAN |

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

1. **Employment scales with businesses, not population.** A test city with 8 businesses and
   278 residents sits near 97% unemployment — which is *correct*, but it means the number the
   player sees depends entirely on how much industry they have built. Jobs arrive through
   `syncBuildings()`; the more the city builds, the more this comes to life. Worth watching in
   real play before retuning `laborUnitsPerDay`.
2. **`unmetSubsistence` is a real signal, not a bug.** It means the city genuinely cannot feed
   its population — two bakeries cannot supply 278 people. That is a bottleneck to solve by
   building, and the panel says so.
3. **Firms hold large cash relative to households.** `dividendRate` (0.45) and
   `UPKEEP_SPEND_RATE` are the levers. Under-consumption without dividends was severe enough
   to pin household savings at zero; it is fixed, not necessarily optimal.

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
- **Per-building firm mapping in node-city.** `syncBuildings()` exists and is tested; node-city
  does not yet call it, because mapping its ~40 tile types onto resource ids is a design pass
  of its own and I did not want to guess at it. Until it is called, firms come from
  `bootstrap()` and the economy runs alongside the existing tile production rather than
  replacing it. **Nothing in the existing city changed.**
- **Discord webhooks.** Out of scope, permanently (CLAUDE.md).

---

## Deploying

Unchanged, and still three knobs together or the update check breaks:
`public/version.txt`, `window.BUILD_VERSION`, `sw.js CACHE_VERSION`. node-city additionally
carries `window.NC_BUILD`, which is the `?v=` cache-buster on the economy import — **bump it
or the module is served stale.** Verify at the EDGE with curl, and poll; propagation takes a
couple of minutes.
