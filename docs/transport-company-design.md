# 🚛 Transportation Companies — design spec

**Status:** proposal, not built. Nothing in this document has been implemented.
**Written against:** v120g0-era `public/index.html`, `public/src/city/*`, `sql/037`.

---

## 0. The one-paragraph version

A **Transportation Company** is a player-run business that moves other players'
freight between nodes and cities. The owner founds it as an operation (`transport`),
plants a **Freight Depot** in one of their cities to give it a physical origin, and
stocks a **fleet of rigs bought on the Prince Portfolios auction floor**. Rig rarity
decides how many **runs per day** that rig can make — 3 at Common, up to 10 at Mythic.
Shippers hire a carrier from a public rate board; the carrier is paid in Cinder through
an append-only ledger. Rigs are ordinary PP vehicles, so they already count for battle
looting — and a rig sent on a raid is a rig that is *not* earning freight money that day.

---

## 1. What already exists (do not rebuild any of this)

This feature is unusually cheap because the game already contains most of its parts.
Every line below is a real system in the current build.

| Existing thing | Where | What it gives us |
|---|---|---|
| `CONVOY_TRUCKS` + `_convoyState()` | `index.html` ~66259 | Daily-cap pattern, day-key reset via `getTodayKey()`, self-healing state |
| Garage rigs + `GARAGE_RIG_FX` | ~164177 | `load` / `risk` / `speed` effect grammar, and the rule that **the best rig owned applies, rigs don't stack** |
| `_garageRig()` fallback | ~164225 | Already returns `{ owned:false, name:'Hand-hauled' }` — **the unhired fallback is already named in the code** |
| `_jbConvoys()` | ~218935 | Node→camp freight, derived live from owned nodes. Drives the war-map trucks *and* the corp Logistics screen from one source |
| `frConvoyDispatch()` / `frConvoyTick()` | ~61120 | Real physical haul: travel time, interception risk, escort purchase, offline-safe arrival |
| `frConvoyIntercept()` | ~61301 | Black-market interception of Foundation shipments — the PvP raiding hook |
| Prince Portfolios | ~195307 | Auction listings, condition ladder, scam/discount risk, lot capacity, fuel, strip-for-parts, **and `_ppGenListing()` already stamps a `rarity` field** |
| P2P vehicle market (`vmListVehicle`) | ~195480 | Player-to-player vehicle sales — a used-rig market falls out free |
| `playerOwnsVehicle()` / `_vmResearchMult()` | ~195441 | Vehicles already gate and multiply battle loot extraction |
| Roguelite `🚚 Convoy` extraction node | ~184082 | The in-battle "bank your haul" beat is already convoy-flavoured |
| `OPS_ECON` / `_opEcon()` | ~79732 | The only sanctioned place to price a business |
| `CITY_PRODUCTION` | `src/city/production.data.js` | Placeable buildings with footprint, `draw`, `inputs`, level costs |
| `corp_hire()` RPC | `sql/RUN_016` | The exact `SECURITY DEFINER` pattern for "one player's click writes another player's row" |
| Node hierarchy (main/town, city per node) | `sql/033` | Real geography for routes to cross |
| `tw_regionControlPct()` | territory wars | Whose ground your freight is driving over |
| `security` PRN — *"Protects the Reserve & convoys"* | ~61581 | Already written for an escort business that does not exist yet |

**The honest read: this is mostly wiring, not invention.** The expensive parts are the
server-authoritative run counter and turning `_jbConvoys()` from a pure function into
persisted state (§8).

---

## 2. The company: charter + depot

Deliberately **two purchases**, mirroring how `bank` already works (the op is the
premises; the charter is bought separately and is what actually lets you lend).

### 2a. The charter — a new operation

Add to `OPS_ECON` (index.html ~79732). All pricing goes through `_opEcon()`; never
hardcode these anywhere else.

```js
transport: {
  startup: 650000, ratePerWorkerHr: 1000, salaryPerWorkerHr: 300,
  maxWorkers: 10, yields: {}, inputs: { fuel: 1.4 },
  // yields {} on purpose — a carrier earns Cinder in freight fees, not resources,
  // so it must never be swept up by the production-pressure hook (cxProduce).
  // Same reasoning as `bank`. Workers here are DRIVERS: each staffed worker
  // licenses one rig in the fleet (see §4).
},
```

⚠ `OP_LABELS.transport = 'Transportation Company'` is **required, not cosmetic** — the
Just Business catalog is built from `Object.keys(OPS_ECON)` and falls back to the raw
key, so a missing label ships a shop entry called "transport".

Founding hook goes in the same switch as `cars` / `oil` / `fishing` (~80213): unlock the
Depot screen, seed the fleet with one free Common rig ("the rig every carrier starts
with", exactly like `wfBuyBoat('skiff', {free:true})` does for fishing).

### 2b. The depot — a placeable city building

This is the user's requirement that transport must be *planted somewhere*. New entry in
`public/src/city/production.data.js`, `kind: 'utility'` (it yields nothing; it enables):

```js
{
  id: 'freightdepot', name: 'Freight Depot', kind: 'utility', emoji: '🚛', accent: '#e0a45c',
  desc: 'Loading bays, fuel bowsers and a yard. Without one your charter is paperwork.',
  maxLevel: 3,
  yields: null, inputs: { fuel: 30 },
  draw: { power: 18, water: 4, workers: 8, pollution: 14 },
  effect: lv => ({ bays: 2 * lv, fleetCap: 4 * lv, radius: 3 + lv }),
  footprint: { w: 3, h: 3 },
  cost: [ /* three legs minimum, per the catalog rule */ ],
}
```

Three things the depot decides, and they are the whole reason it exists as a building:

1. **Origin.** The node the depot stands in is where your routes start. Node hierarchy
   (`sql/033`) already gives every node its own city, so this is a real map position.
2. **Reach.** `radius` — how many hops from the depot you can quote. A carrier cannot
   serve the whole world from one yard; **more depots is the natural sink for a growing
   company**, which is the shape you want a business to have.
3. **Concurrency.** `bays` caps *simultaneous in-transit contracts*, independently of
   fleet size. Buying rigs alone does not scale you; you have to build.

> **Rule:** no depot in reach of both endpoints ⇒ you cannot quote that route. This is
> what stops one player owning the planet from a single tile.

---

## 3. Rigs — bought on the Prince Portfolios floor

Trucks are **ordinary PP vehicles with a haul class**. They roll onto the same auction
floor, through the same `_ppGenListing()`, and inherit for free: condition, mileage,
colour, seller rating, scam risk, the discount ladder, lot slots, fuel, and
strip-for-parts. They also inherit the **P2P vehicle market**, so a second-hand rig
trade between carriers exists on day one with no new code.

Add a `PP_RIGS` table alongside `PP_VEHICLE_NAMES`, entries flagged `haul: true`:

| Rarity | Rig | Base value | Runs/day | Cargo | Risk | Speed | Lot slots | Roll weight |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Common | Roachback Flatbed | 46,000 | **3** | ×1.00 | −0 | ×1.00 | 1 | 40% |
| Uncommon | Mule Box Hauler | 98,000 | **4** | ×1.30 | −3 | ×1.05 | 1 | 26% |
| Rare | Kettledrum Freighter | 210,000 | **5** | ×1.70 | −8 | ×1.15 | 1 | 18% |
| Epic | Ashgate Longhaul | 480,000 | **6** | ×2.20 | −14 | ×1.25 | 2 | 10% |
| Legendary | Saint Corvid Roadtrain | 1,150,000 | **8** | ×3.00 | −22 | ×1.40 | 2 | 5% |
| Mythic | The Cinder Line | 3,400,000 | **10** | ×4.20 | −32 | ×1.60 | 3 | 1% |

Notes on the table:

- **Common is 3 runs**, as asked. Everything else ladders off it.
- Rarity ids are the game's existing `RARITIES` (`common…mythic`, index.html ~39231).
  Do not invent a parallel ladder.
- `_ppGenListing()` **already writes a `rarity` field** (`'rare'` if Pristine else
  `'common'`). For haul-class listings, rarity comes from the rig entry instead of from
  condition, and condition becomes a separate multiplier — see next line.
- **Effective runs = `floor(rarityRuns × PP_COND_MULT[condition])`, minimum 1.** A
  Wrecked Roadtrain (×0.30) does 2 runs, not 8. This is what makes buying a beaten
  Legendary a real decision against a Pristine Rare, and it reuses a table that exists.
- Big rigs eat **more than one lot slot**. `PP_LOT_LEVELS` tops out at 40 slots; a Mythic
  fleet is genuinely a real-estate problem. That is a feature.
- Names deliberately avoid "Ironback" — `Ironback Mauler` (PP) and `Ironback Runner`
  (Garage) already coexist and a third would be unreadable.

### 🔴 The paid-rig collision — read this before touching anything

The Garage sells **Ironback Runner / Ash Convoy Rig / Warden Longhaul for real money**
($20 / $60 / $99), and those rigs carry `load` / `risk` / `speed` multipliers plus the
daily operative cap. If PP freight rigs hand out comparable numbers for in-game Cinder,
**you have devalued a real-money product that people have already bought**, which is a
refund conversation, not a balance conversation.

Keep them on separate rails:

- **Garage rigs** stay exactly what they are: *your own* daily operative cap
  (`_convoyCapacity`) and *your own* freight (`_jbConvoys`). Untouched by this feature.
- **PP freight rigs** are a **company fleet** that hauls *other players'* cargo. They
  never raise your personal operative cap.
- **And make the paid tier better, not worse:** owning a Garage rig grants a fleet-wide
  perk — Ironback `+1 fleet slot`, Ash `+1 run/day on every rig`, Warden `both`. When
  Transport ships, the $99 rig becomes *more* valuable, not less. This is the single
  most important balance call in the feature.

---

## 4. Drivers, fuel, breakdowns

- **One driver per active rig**, drawn from the op's `maxWorkers: 10` and paid
  `salaryPerWorkerHr`. An unstaffed rig sits in the yard. This is the labour cost that
  makes the business feel like a business, and it competes with staffing your other ops.
- **Every run burns fuel** from the depot (`inputs: { fuel: 30 }`). The carrier is a
  standing fuel *sink* — which is a clean loop back into `gas`, `oil` and Black River
  Petroleum, all of which currently produce fuel with nowhere urgent to put it.
- **Condition degrades ~1 step per 25 runs**, faster on high-risk routes. Below `Worn`,
  each run rolls a **breakdown** that strands the cargo mid-route (shipper can pay a
  recovery fee, or lose it). Repairs consume `PP_PARTS`-mapped resources — which means
  the salvage/parts economy that PP already models acquires a customer.
- A rig that hits `Salvage` is finished as freight. Strip it (PP already does this) or
  dump it on the P2P market to someone who will.

---

## 5. Hiring a carrier

### The rate board
A **Freight Exchange** screen: every active carrier, ranked, showing

`tariff (Cinder per unit·hop) · reliability % · coverage (node pairs served) · free bays now`

Carriers publish a **tariff sheet**, not a per-deal negotiation: base rate per resource
class, per-hop multiplier, escort surcharge, illicit surcharge. Price discovery between
carriers *is* the game here — one number that everyone can see and undercut.

### The flow
1. Shipper opens Logistics, has cargo at node A wanted at node B.
2. Picks a carrier whose depot reaches both. Sees quote + ETA + risk before committing.
3. `transport_dispatch()` RPC: server checks reach, free bay, rig run budget, driver,
   fuel; debits the shipper; writes the contract; decrements the rig's `runs_used`.
4. On arrival `transport_settle()` credits the carrier's ledger and delivers cargo,
   minus anything lost to interception.

### Reliability
Public, derived, and the actual asset a carrier builds: `delivered / (delivered + late +
refused + lost)`. It gates the large contracts and it is what a rate board is sorted by.
A cheap unreliable carrier and an expensive safe one is a real choice.

### 🔴 Monopoly — the part that needs a decision

The brief says *"if only one player owns a transport company they will have to hire that
one company."* That is the right instinct for drama and the wrong instinct for a live
service, because a sole carrier can set an infinite price or simply refuse to serve
someone they are at war with — and that player's game is now over through no action of
their own.

**Recommendation — keep the monopoly's power, remove its kill switch:**

1. **NPC fallback: Meridian Haulage.** Always available, deliberately bad — **2.5× the
   median player tariff, 1.6× trip time, no escort, no illicit freight**. Meridian
   already dominates fuel in `AI_CORP_RESOURCE`, so it is the natural carrier. It is a
   *price ceiling*, not a bypass: a monopolist can charge 2.4× and get rich.
2. **Tariff cap at the NPC rate.** Above it nobody rational hires you anyway.
3. **Refusal is legal and expensive.** A carrier may blacklist a shipper — that is where
   the politics should live — but each refusal is public and drops reliability.
4. **Antitrust event.** If one company clears >70% of delivered volume over a rolling
   week, the Foundation Director spawns an Antitrust event that halves their tariff cap
   for 48h. Reuses the existing Director event system; it is a pressure valve, and it is
   also a *story*.

If you want the pure monopoly anyway, ship 1–4 behind a Forge flag so it can be turned
off after you have watched a week of real behaviour. Do not discover this one live.

---

## 6. Rigs in battle and looting

The hooks already exist, which is why this half is cheap.

1. **Extraction gate.** `playerOwnsVehicle()` (~195441) already gates "send loot to camp"
   and walks `Profile.princePortfolios.lot` — a rig lands there by construction, so it
   qualifies with zero new code.
2. **Loot multiplier.** `_vmResearchMult()` maps condition → 0.5–1.4. Give haul-class
   vehicles `+0.10 × rarityIndex` and **raise the clamp to 1.9 for rigs only**. A Mythic
   roadtrain hauling loot out of a raid should visibly beat a Pristine sports car; today
   the clamp says otherwise.
3. **Assign a rig to the run.** At deployment, pick which rig rides along. That rig is
   **out of the fleet for the duration** — so combat looting directly competes with
   freight income, out of one shared budget. This is the best decision in the whole
   design and it costs one `assignedTo` field.
4. **Rigs can be lost.** A defeat rolls against condition and knocks it down the ladder
   (`Pristine → … → Salvage`). Losing a Legendary rig on a bad raid should hurt. It is
   also a serious Cinder sink, which this economy wants.
5. **Convoy raiding as PvP.** `frConvoyIntercept()` already models black-market
   interception. Extend it: an in-transit contract is an attackable object on the war
   map. Raider fights the escort; a win takes a cargo slice and dents the carrier's
   reliability. This finally gives the `security` PRN — already blurbed
   *"Protects the Reserve & convoys"* — a business to be in.
6. **Region tolls.** Freight crossing a region owned by a corp (`tw_regionControlPct`)
   pays them a toll. One line of maths that makes Territory Wars matter to players who
   never fight.

---

## 7. The gate: how hard, and when

This is the highest-risk part of the brief. `sql/033`'s measured numbers were **22
players, 4 node owners**. A hard "no carrier, no freight" rule on that population means
most of the map stops moving on day one.

**Phase it.**

| Phase | Node→camp freight without a carrier | Ship when |
|---|---|---|
| **1 — Optional** | Works exactly as today. Hiring a carrier is a *bonus*: bigger loads, lower risk, faster. | First release. Nothing can break. |
| **2 — Soft gate** | Runs "Hand-hauled": **35% cargo, +25 risk, 1.6× trip**. Painful, never fatal. | ≥3 active carriers |
| **3 — Hard gate** | Long-haul (2+ hops) genuinely requires a carrier; local 1-hop stays hand-haulable forever. | ≥5 carriers covering ≥80% of live node pairs |

`_garageRig()` already returns `{ owned:false, name:'Hand-hauled' }` for the no-rig case,
so **Phase 2's fallback is already named and already rendering in the UI**. That is not a
coincidence worth ignoring — it is the seam this feature was going to need anyway.

**Never gate `_convoyCanSend()`.** That is the player's own boots going out on scout /
raid / deep-run / Covert Action. Putting a carrier requirement on it would let a
monopolist stop other people from playing the game at all. Freight is freight; a squad is
not cargo.

---

## 8. Engineering cost — where the real work is

Being honest about this up front:

1. **`_jbConvoys()` must become stateful.** Today it is a *pure function of the clock*,
   deliberately: "nothing to store, nothing to tick, and two observers always agree."
   Contracts have owners, prices and outcomes, so that property has to go. This is the
   single biggest change in the feature and it touches the war-map trucks and the corp
   Logistics screen together. Budget for it.
2. **Runs/day must be server-authoritative.** `_convoyState()` is an honest-client daily
   counter, which is fine when the only person it cheats is yourself. A carrier being
   paid real Cinder by other players is a fraud target. `day_key` and `runs_used` live in
   `transport_dispatch()`, checked server-side — the same reasoning that moved world chat
   to `chat_send()` in v120g0.
3. **Ledger is append-only.** `transport_ledger.amount`, balance = `sum(amount)`. Never
   an UPDATE on a balance column. Follow `corp_treasury` exactly.
4. **RLS recursion.** Membership/ownership checks go through `SECURITY DEFINER` helpers
   (`is_transport_owner`, mirroring `is_community_member`), never a policy on
   `transport_rigs` that itself queries `transport_rigs`.
5. **Offline-safe arrival.** `frConvoyTick()` already resolves convoys that landed while
   the player was away — copy that, do not reinvent it.

---

## 9. File plan

New module, per CLAUDE.md ("NEW features go in `public/src/<feature>/`"):

```
public/src/transport/
  index.js              registers window.MythicTransport; inert without a bridge
  transport.bridge.js   the seam — window.MythicTransportBridge
  rigs.data.js          rarity table, PP rig catalog, runs/cargo/risk maths
  routes.js             hops, reach, risk, price. Pure, total, no I/O
  contracts.js          Supabase-guarded; degrades to empty before tables exist
  depot.render.js       depot + fleet + rate board UI
sql/038_transport_companies.sql
```

🔴 **The globals trap applies.** `Profile`, `Corp`, `Forge` are top-level `const` in
index.html — lexical globals, **not** on `window`. `/src/transport` reads nothing by
itself; index.html hands it `window.MythicTransportBridge`, built next to
`MythicCityBridge` (~207415). This has already cost real time twice.

Minimal, additive `index.html` edits — five places, nothing restructured:

- `OPS_ECON.transport` + `OP_LABELS.transport`
- the founding hook, in the existing `cars` / `oil` / `fishing` switch (~80213)
- the bridge block (~207415)
- `_ppGenListing()` — roll haul-class listings onto the floor
- `_vmResearchMult()` — the haul-class loot bonus and the raised clamp

Schema:

```
transport_companies  (id, owner_id, name, home_node_id, depot_level, tariff jsonb,
                      reliability, blacklist uuid[], status, created_at)
transport_rigs       (id, company_id, owner_id, vehicle_id, rarity, condition,
                      runs_used, day_key, assigned_to, status)
transport_contracts  (id, carrier_id, shipper_id, from_node, to_node, cargo jsonb,
                      price, escort, risk_pct, depart_at, arrive_at, status, settled_at)
transport_ledger     (id, company_id, contract_id, amount, kind, created_at)  -- append-only
```

RLS ships in the same file. RPCs: `transport_quote()`, `transport_dispatch()`,
`transport_settle()`, `transport_repair()` — all `SECURITY DEFINER` with a pinned
`search_path`, EXECUTE revoked from `public`/`anon`, granted to `authenticated` only.
Idempotent, re-runnable, ends with a verify query.

---

## 10. Build order

1. `sql/038` — tables, RLS, `transport_dispatch/settle`. Nothing visible yet.
2. `rigs.data.js` + PP haul listings. Players can **buy** rigs before they can use them —
   this seeds the fleet market and gives the auction floor a week of new content on its own.
3. Depot building + charter op. Carriers can exist.
4. Freight Exchange + contracts, **Phase 1 (optional)**. Freight starts moving for money.
5. Battle integration: rig assignment, loss-on-defeat, the raised loot clamp.
6. Escorts, tolls, convoy raiding.
7. Measure carrier count and coverage, **then** consider Phase 2.

Steps 1–4 are a shippable feature on their own. Everything after is upside.

---

## 11. Open questions for the owner

1. **Monopoly:** ship the Meridian Haulage ceiling (recommended), or the pure monopoly
   behind a flag?
2. **Corp or solo?** Is a transport company owned by a *player* or by a *corp*? Corps
   already have roster, roles and treasury (`Corp.*`) — corp ownership is close to free
   and makes freight a job you can hire into. Solo ownership is simpler and more personal.
   Recommendation: **solo owner, corp-affiliated** — the owner may assign their corp's
   members as drivers.
3. **How hard is the eventual gate?** Long-haul only (recommended), or everything?
4. **Are Garage rigs ever registerable as fleet rigs?** Recommendation: **no** — keep the
   rails separate, and pay Garage owners in fleet-wide perks instead (§3).
