# 🏥 HANDOFF — The Medical Corporation hospital

**Branch:** `claude/medical-corporation-minigame-ghw4da`
**Head:** `2e85553` · 5 commits on top of PR #4's branch (`claude/hazmat-station-minigame-0dbwd6`, head `35eabdc`)
**Version knobs:** `v120y0` (version.txt, `BUILD_VERSION`, `sw.js CACHE_VERSION` — all three moved together)
**Live preview:** https://claude.ai/code/artifact/bc27afac-737c-4b63-a0e0-775c2f1b3c05 — the real modules bundled into one page over a stand-in ledger, saves in the browser only

---

## ⛔ READ THIS FIRST

### 1. This branch CONTAINS PR #4, unmerged

The plague, lab and ward modules only exist on PR #4's branch, so this branch was fast-forwarded onto it
before a line of the hospital was written. Merging this branch merges PR #4's content too, and inherits
every blocker in `HANDOFF-2026-09-01-plague.md` — above all the `transport` row in `OPS_ECON`, which
switches on income for five live businesses bought under different terms. **That decision has not been
made.** Read that handoff before merging anything.

### 2. Two migrations need applying by hand

Supabase SQL editor, project `ktsiasyjusesawtrwrjc`, in order:

```
sql/038_plague_cures_logistics.sql   (PR #4's — waybills, payouts, the carrier view)
sql/039_pharma_wholesale.sql         (this branch — the wholesale board; widens cure_payouts.role)
```

Both idempotent, both ship RLS, both end with a verify query. Until 039 is applied the Loading Dock
reports the board as offline and everything else in the building works. Until 038 is applied the
whole cure pipe degrades to solo play, as PR #4 documents.

**RLS is the security boundary — review every policy in 039 line by line.** The buyer's claim is an
`UPDATE ... where status = 'listed'` under the `pl_upd_buy` policy, and the `pharma_lots_lock` trigger
is what stops that update rewriting the offer. If either is loosened the market is exploitable.

### 3. Merging deploys straight to production

`.github/workflows/deploy.yml` pushes `./public` on every push to `main`; there is no CI on pull
requests. The local gate is the only gate:

```bash
npm i                                                              # terser
node _synckcheck.mjs public/index.html public/node-city/index.html # → ALL CLEAN
node _plague_smoke.mjs                                             # → 72 checks
node _hospital_smoke.mjs                                           # → 120 checks
```

All green at `2e85553`. The Cloudflare MCP connectors were never authorised in the session that built
this, so **the edge has not been verified after any deploy**; the CLAUDE.md rule (curl the edge, poll,
never trust the deploy log) still applies.

### 4. One deliberate rule break, by the owner's call

`patients.js` TUNING `FEE_MIN` / `FEE_MAX` (500–5,000 Cinder) is the one Cinder figure in the building
that does not derive from `_opEcon()`. The owner asked for it on 2026-09-03 ("make 5000 cinder, make
it rng"). The comment on it records that. Do not "fix" it back to an econ share without asking.

---

## What was built

### The building

Buying a Medical Corporation in Just Business puts it under **My Companies**; entering it, or pressing
ENTER BUSINESS on the sited building in the city, opens a walkable 3D hospital (`/src/hospital`,
`window.MythicHospital`). It reuses the containment lab's scene builder, walker, camera and character
rig with its own floor plan — one renderer for both rooms.

| Room | What it does |
|---|---|
| **Front Desk** | The ledger: patients waiting and treated, fees, counter sales, crates, lines, prophylaxis |
| **Ward Bay** | Patients tab: admit, treat, send away. Beds tab: buy from the decoration market, place in ten slots, pick up |
| **Crate Intake** | The existing `/src/ward` intake/triage overlay, now a room here |
| **Supply Bench** | Roll bandages: 2 cloth + 1 water → 3 |
| **Containment Vault** | Every cure crate the ward administered, as a sample line |
| **Scrub Station** | The hazmat airlock under another name — four seals |
| **Compounding Lab** | Sterile. A cure line becomes salve, tablets, serum, tonic or vaccine; a titration dial sets yield |
| **Dispensary Stockroom** | The shelf the player's city retails from |
| **Loading Dock** | Wholesale: list shelf stock for other players, buy theirs, hauled by a player-owned carrier |

**There is no lab in this building.** The containment lab is the Research Facility — a different
business that ships to this one. The corridor that used to lead there was removed at the owner's request.

### The loops

1. **Patients walk in** (`patients.js`). A floor of wasteland wounds plus the city's sick during an
   outbreak, who carry the strain and a citizen's name. They wait in the lobby for a bed and walk out
   untreated after twelve minutes. A night away fills the lobby, capped at six.
2. **Beds come from the decoration system** (`beds.js`). The same `furniture_catalog` the Card Shop
   and Dwelling buy from (`func = 'bed'`), the same `Profile.furnitureOwned` inventory, the same taxed
   spend, through three bridge accessors. The hospital adds only which slot a bed stands in. A built-in
   Ward Cot priced off the medical op's rate keeps the ward buildable offline.
3. **Treatment.** A wound takes one bandage per severity; a sickness takes one shelf unit of a relief
   product (outbreak family first) or two raw Medicine. It runs on the wall clock in bed; better medicine
   heals faster. **On discharge the patient pays a random 500–5,000 Cinder** (rolled once from their id,
   severity leaning it upward) and walks out.
4. **Cure lines** (`pharma.js`). A crate the ward administered leaves leftover doses plus a fifth of
   the crate as retained samples in the vault. Iatrogenic or refused crates leave nothing.
5. **Compounding.** Five products, each costing samples and live-resource inputs. The clean room is the
   hazmat rule reused whole: ungowned work contaminates the run, past 0.35 exposure it is destroyed.
6. **The city sells it** (`pharmacy.city.js`, mounted in node-city). Every Clinic and Med Lab standing
   retails the shelf to NPCs on `economyTick`; Cinder lands through the bridge. No clinic, no sales.
7. **Prophylaxis.** Doses sold in the last six hours (vaccine 1.0 … salve 0) discount the city's wild
   outbreak pressure by up to 70%, through `host.prophylaxis()` in `outbreak.pressureOf`.
8. **Wholesale.** Listing escrows units off the shelf first; buying is an update guarded by status so a
   race refunds the loser; the seller's `wholesale` payout row is filed at the sale, the carrier's on
   arrival; what lands is what the cold chain left.

### File map

```
public/src/hospital/
  floor.js            floor plan; HOT_Z is the sterile line; no lab door
  beds.js             ten slots, cot price, colliders — pure
  patients.js         arrivals, needs, treatment time, the fee roll — pure
  patients.models.js  THE LIST OF PATIENT .glb LOOKS (empty → tinted box figures)
  pharma.js           cure lines, products, compounding, pricing, counter, prophylaxis, wholesale arrival — pure
  state.js            the ONLY file that spends, saves or reads the game
  scene.patients.js   beds and patients in three.js, on top of the lab's scene
  hud.js              panels; borrows the lab's chrome (bl-root hp-root)
  index.js            window.MythicHospital
  pharmacy.city.js    node-city adapter: the NPC counter
public/models/hospital/README.md    where patient models go
sql/039_pharma_wholesale.sql
_hospital_smoke.mjs                 120 headless checks
PLAGUE.md                           design doc — "The hospital" section onward
```

### index.html's contribution

Bridge accessors on `window.MythicPlagueBridge`: `pharmaState` / `setPharmaState` (one Profile slot),
`furnitureCatalog` / `furnitureOwned` / `buyFurniture` / `adjustOwned` (the decoration market).
`cityEnterBusiness('medical')` routes to the hospital with the ward as fallback. `_jbHandleAction`
gains `openHospital`. The settle poll calls `MythicHospital.sweep()`. One `<script type="module">`.

`node-city/index.html`: **the parent's `MythicPlagueBridge` is handed into the iframe** (see the bug
below), the pharmacy is mounted after the outbreak, ticks at the tail of `economyTick`, and clinic /
med lab tiles print its tip line. `OPS_INTERIORS` now includes medical, research and transport.

`corp/shell.jsx`: `COMPANY_PAGES.medical` → the My Companies entry.

### Two bugs found in PR #4's code, fixed here

- **The city iframe had no plague bridge.** `/src/plague/state.js` reads `window.MythicPlagueBridge`;
  node-city never defined one, so the city's outbreak ran on the null bridge and never reached
  `Profile.plague` — the ward in the game window could not see a single city case. Fixed by handing the
  parent's bridge over (same-origin) and by making both `blob()` readers refuse a cached copy once the
  slot holds a different object (two windows, one profile slot).
- **The hazmat gate's wording** says "airlock" and "hot zone"; the hospital maps it to "scrub station"
  and "clean room".

---

## Waiting on the owner

- **Patient models.** Drop `.glb` files in `/public/models/hospital/patients/`, list them in
  `patients.models.js`, bump the hospital `?v=`. Height is normalised on load; a `walk` clip is used if
  present. Until then patients are tinted box figures.
- **Migrations 038 and 039**, by hand.
- **The `transport` decision** from PR #4's handoff.
- **Cloudflare connectors**, so the edge can be verified after a deploy.

## Known gaps

- **Placement is by slot, not free.** Ten fixed positions; the owner asked for "buy and place" and this
  is the honest minimum. Free placement would mean a ghost-and-raycast mode like the Dwelling's.
- **Beds are cots unless the catalogue has a bed.** A catalogue `.glb` loads and is scaled to the slot;
  if it fails the cot mesh stays. Nobody has posted a `func = 'bed'` row yet to test with.
- **The haulier decides nothing** on either the cure leg or the wholesale leg — PR #4's gap, still open.
- **Sick patients do not clear outbreak cases.** Treating a citizen in the hospital does not touch
  `Profile.plague` infections; the ward's crates do. Wiring `treat()` to clear that citizen's infection
  is one call to `outbreak.js` and was left out to keep the two systems from double-counting.
- **The preview page is not in the repo.** It is built from the scratchpad by bundling the modules with
  esbuild (installed `--no-save`); the template and build steps live only in the session that made it.

## Tuning, one place each

| Knob | File | Value |
|---|---|---|
| `FEE_MIN` / `FEE_MAX` | `patients.js` | 500 / 5000 — the owner's call |
| `PATIENCE_MS` | `patients.js` | 12 min |
| `BASE_PER_MIN` etc. | `patients.js` | walk-in rate |
| `BANDAGE_RECIPE` / `_YIELD` | `patients.js` | 2 cloth + 1 water → 3 |
| `COT.priceMul` | `beds.js` | 1.8 × ratePerWorkerHr |
| `PRODUCTS[*].priceMul` | `pharma.js` | shares of ratePerWorkerHr |
| `TUNING.CUSTOMERS_PER_POP_MIN` | `pharma.js` | 0.0055 |
| `PROPHYLAXIS.MAX` | `pharma.js` | 0.7 |
| `SLOTS` | `beds.js` | ten positions in the west wing |

## Degraded states, all supported

| Missing | Behaviour |
|---|---|
| `MythicPlagueBridge` | Building opens, says it is not connected, nothing trades |
| WebGL / the CDN | Opens flat; every room reachable by button; the sterile gate still applies |
| Patient / bed models | Box figures and cot meshes, no toast storm |
| Supabase / signed out | Wholesale board offline; listing refuses and escrows nothing |
| `furniture_catalog` absent | Only the Ward Cot is on offer |
| City not open | Counter does not run; desk says so; patients still arrive off the plague ledger |

*Read `PLAGUE.md` next — the hospital sections explain the why behind each mechanic.*
