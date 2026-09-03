# 🦠 Plague, Cures & Cure Logistics

Viruses the city's NPCs catch, cures mixed from the game's real resources in a 3D
hazmat lab, the mistake that spawns a *new* virus, and the shipping leg through a
player-owned Transportation Company to a player-owned Medical Corporation.

## Where it lives

Nothing new was added to `index.html` except the seam (CLAUDE.md).

```
public/src/plague/           the domain. Pure except for state.js.
  strains.js                 the virus model: 4-axis signature, families, mutation
  outbreak.js                infection over the city's NAMED CITIZENS
  outbreak.city.js           the node-city adapter (mount(ctx), the globals trap)
  cures.js                   reagent chemistry, grading, and administering
  logistics.js               carriers, cold chain, quotes, arrival, settlement
  state.js                   the ONLY file that spends, saves or touches Supabase
  index.js                   window.MythicPlague

public/src/ward/             the Medical Corporation. The far end of the pipe.
  triage.js                  patients, dose costs, coverage — the reservoir rule
  intake.js                  what is in the crate, and whether you open it
  hud.js                     the clinic screen (deliberately not the lab's)
  index.js                   window.MythicWard

public/src/biolab/           the 3D minigame.
  stations.js                the floor plan, as data. HOT_Z is the clean/hot line
  hazmat.js                  the suit: four seals, and the exposure that outlives it
  player.js                  walking, collision, WASD + virtual stick
  scene.js                   three.js r128 (the legacy global, not the import map)
  hud.js                     every pixel of the 2D layer, and its CSS
  index.js                   window.MythicBioLab

sql/038_plague_cures_logistics.sql    waybills + payouts + the carrier view
_plague_smoke.mjs                     headless driver for the domain invariants
```

index.html contributes exactly four things: `window.MythicPlagueBridge`, the
`transport` row in `OPS_ECON` (+ its `OP_LABELS` entry), two `<script type="module">`
tags, and the `medical` / `transport` entries in `cityEnterBusiness`.

## The loop

1. **A virus emerges.** `outbreak.js` reads the city's own vitals — health
   coverage, water, food, density — into a single `pressure` number and rolls
   against it. A well-run city can reach **zero** pressure and never see a wild
   outbreak; that is deliberate, because a system with an unavoidable floor
   teaches players that building correctly does not pay.
2. **NPCs catch it.** Named citizens go incubating → symptomatic → critical →
   recovered → immune, on an 8 / 20 / 30-minute clock, and it spreads along the
   *workplace* graph the city already models. **Nobody dies and no building is
   ever touched** — see the three inherited rules at the top of `outbreak.js`.

   Transmission is written as an explicit R₀ rather than a magic coefficient:

   ```
   secondary infections per case = contagion × CONTACTS_PER_HR × infectious_hours
   ```

   A moderate strain (contagion 0.35) lands near **R₀ 2.0**, a virulent one near
   4.5. Measured on a 40-citizen roster over five uncured hours: moderate reaches
   27 of 40, virulent reaches all 40. Retune `CONTACTS_PER_HR`, not the formula.

   Sick citizens also **cost the city output**. `labour` in node-city is a Liebig
   minimum over food / water / health, so an outbreak is expressed as a drag on
   the health vital and flows through the multipliers the city already has — no
   new economic term, and "Limited by: HEALTH" appears on the Vital Signs panel
   by itself. Bounded by `WORKFORCE_DRAG_MAX` (0.35); set it to 0 to make
   outbreaks purely social again.

   Three rails survive the tuning: concurrent cases never exceed `CEILING_SHARE`
   (0.72) so the city always keeps a workforce, immunity stays long so an ignored
   outbreak burns out instead of cycling forever, and a *moderate* strain never
   reaches everyone — otherwise the player's clinics and clean water never
   mattered.
3. **You cure it in the lab.** Walk to the Sequencer to read the strain's four
   axes. Suit up at the airlock. Spin, mix, assay, package.
4. **You can get it wrong.** A batch that is unstable or contaminated is graded
   `IATROGENIC`, and administering it spawns a **new strain** — the parent,
   pushed along the axes your failed blend was leaning on. It is traceable to
   what you mixed, on purpose.
5. **You ship it.** A cure in the lab has cured nobody. Hire a player-owned
   haulier to run it to a player-owned Medical Corporation.

6. **Somebody else decides whether it goes into people.** The crate stops at
   the ward door. The lab owner chooses whether to screen it, who among the
   patients gets the doses, and whether to administer it at all.

## The ward

Arrival and administration are **separate**, and that split is the whole Medical
Corporation feature. Before it, a lab was a mailbox: paid automatically on
arrival, no decision, no game, while the shipper ate every consequence alone.

- `collect()` — the drive is over. Re-grade for the cold chain, pay the
  **carrier** (they drove it either way), put the crate at the door.
- `administerBatch()` — the ward's call. Pays the **lab**, treats patients,
  retires a strain, and is the only thing that can release a mutant.

Three decisions, each with a real price:

**Screen, or don't.** A crate arrives opaque. You see the *dispatch* grade —
what the shipper claimed before the drive — and the carrier's integrity, which
is a reason for suspicion, not a measurement. Screening costs Medicine and
reveals what actually arrived. Those two grades differ exactly when the cold
chain broke, which is the case worth catching, so showing the arrived grade for
free would delete the decision.

**Triage.** A critical patient takes 2 doses, a symptomatic one takes 1, and
incubating cases are invisible — you cannot pre-empt an outbreak with a
well-timed crate. Measured: 6 doses treats **6 people, or 3 critical ones**.
Treating the sickest costs double and does not slow the spread, because someone
that ill is not at work infecting anyone. The efficient play abandons them. The
game does not resolve that for the player and must not.

**Coverage — the rule everything turns on.** A viable cure only *retires* a
strain if it reached ≥80% of active cases, counting the incubating ones the ward
cannot see. Under-dose and the untreated are a reservoir: the strain survives a
cure that was chemically perfect. Without this, one dose clears an outbreak and
dose count is decoration.

**Refusing** an iatrogenic crate is the only clean way to stop it — and it
forfeits the lab's cut, so it is never a free out. Two players can now each have
genuinely acted, and each can genuinely blame the other.

Nothing strands: a crate nobody opens is administered by ward staff after six
hours on the default plan, which is deliberately *not* the optimal one.

## The hazmat rule

The suit is four seals, in order, standing still at the airlock, and it takes
about eleven seconds. Walking away mid-seal costs that step.

**Its consequence is on the product, not on an avatar.** There is no health bar.
Working a hot bench unsuited accrues `exposure`, and exposure goes straight into
`cures.formulate()` where it costs purity, costs stability and sets the
`contaminated` flag — which is how a cure becomes the next outbreak.

Anything that makes the suit cosmetic — an "ignore" button, an auto-suit, a
difficulty toggle — removes the teeth from the whole feature. Don't add one.

## The four axes

`vector · envelope · replication · resilience`, each 0–100.

A strain is those four numbers. A reagent blend is those four numbers. Efficacy
is the distance between them. That is the entire disease↔cure equation, and it
is continuous rather than a lookup table specifically so that **near misses
exist**: you have to be able to ship something 70% right and watch it half-work.

Every reagent is an id from index.html's live `RESOURCES` list (the 14) — never
`SALVAGE_RES` and never the 258-entry chain catalogue. A recipe asking for a
resource no producer makes is a recipe that sends the player nowhere.

Two traps are deliberate:

- **Corrupted Essence** is the strongest reagent in the game *and* the only one
  with a large negative stability. It is how you beat a Catastrophic strain and
  it is how you breed the next one.
- **Shipping a half-cure** raises the strain's `resistance`, permanently. "Ship
  the 50%, it's better than nothing" is a real mistake, not a free win.

## Why the middleman is not a tax

A shipping step that only subtracts Cinder is a toll booth, and players route
around toll booths. This one **changes the cargo**: `integrityOf()` in
`logistics.js` reads the carrier's staffing, level and investment, and whatever
the cold chain loses comes off the same `stability` number the bench produced.
A batch that was a `VIABLE CURE` at dispatch can arrive `IATROGENIC` and spawn a
strain at the far end. The carrier you hire is a decision about the product.

The carrier is paid **for the drive, not for the result** — a broken chain costs
them reputation (`rating`), not the fee. Paying on outcome would make hauling an
unstable batch uninsurable and nobody would take the interesting job.

A player never pays themselves: a self-owned leg files no payout row, so shipping
with your own trucks costs the crew's wages and nothing more. See `settleWaybill`.

## Degraded states, all of them supported

| Missing | What happens |
|---|---|
| `MythicPlagueBridge` | Modules register, stay inert, warn once. Nothing throws. |
| WebGL / the CDN | The lab opens **flat**: no room, every station still there, suit gate still applies. |
| Supabase / signed out | You ship to your **own** operations. The market is solitary, the mechanic is whole. |
| `sql/038` not applied | Indistinguishable from being offline. By design. |
| The city builder not loaded | A strain with nobody to infect is **queued** (`pending`) and takes hold on the next city tick. This is the *normal* case when a shipment lands on the game's poll. |

## Verifying

```
node _plague_smoke.mjs        # domain invariants, headless — no DOM, no three.js
node _synckcheck.mjs public/index.html public/node-city/index.html
```

The smoke driver asserts the things that are expensive to find by playing:
determinism, that a clean city reaches zero pressure, that an outbreak never
takes the whole roster and never deletes a citizen, that a reckless batch grades
iatrogenic and its mutant is traceable to its parent, that the suit changes the
product, that a better carrier delivers a better batch, and that clearing a
strain clears every carrier.

In-browser, both modules carry a test seam (`MythicBioLab._run/_step/_interact`,
`MythicOutbreak._advance/_seed`) because the Browser pane in the dev environment
never composites — `requestAnimationFrame` does not fire, so anything reachable
only through the render loop is otherwise unobservable (CLAUDE.md).

## The hospital — the Medical Corporation minigame

`/src/hospital` is the building the Medical Corporation licence buys. It is
what opens from Just Business → My Companies → Medical Corporation, and from
the city's ENTER BUSINESS on a sited `medical` operation. The ward above is
one room in it.

```
public/src/hospital/
  floor.js            the floor plan, as data. HOT_Z is the sterile line
  pharma.js           cure lines, five products, compounding, pricing, the NPC counter — pure
  state.js            the ONLY file here that spends, saves or reads the game
  hud.js              the 2D layer; borrows the lab's chrome (bl-root hp-root)
  index.js            window.MythicHospital — the 3D walk
  pharmacy.city.js    the node-city adapter: Clinics and Med Labs retail the shelf
_hospital_smoke.mjs   66 headless checks
```

The loop it closes:

1. **A crate the ward administers leaves a cure line** in the Containment
   Vault: the leftover doses plus a fifth of the crate as retained samples,
   carrying the ARRIVED numbers. An iatrogenic or refused crate leaves
   nothing — a product compounded from it would be a way to sell the mutant.
   `sweep()` books them idempotently from the ward, the hospital door and the
   game's settle poll, so a crate STAFF opened still reaches the vault.
2. **The Compounding Lab turns a line into medicine.** Five products —
   Field Salve (from anything), Antiviral Tablets, Immune Serum, Nerve Tonic
   (neural lines only), Vaccine Dose (stable viable lines only). Each costs
   samples and per-unit resources from the live 14. The titration dial sets
   the yield; the line sets the quality.
3. **The clean room is the hazmat rule, reused whole.** Same four seals at
   the scrub station, same exposure meter, same gate. Compounding ungowned
   puts the exposure on the product; past 0.35 the run fails sterility and
   is destroyed, inputs and samples included.
4. **The city sells it.** `pharmacy.city.js` ticks on node-city's own
   `economyTick`. Every Clinic and Med Lab standing retails the shelf to
   NPCs; the Cinder lands through the bridge. A city with neither sells
   nothing — the hospital makes medicine, the city's buildings retail it.
   Outbreak cases send people to the counter (up to 3×), and the product
   that treats the current family sells first.

**Prices are shares of `_opEcon('medical').ratePerWorkerHr`.** Not one
Cinder figure lives in the module; staff and level the operation and every
product is worth more.

**Two windows share the profile slots.** The city builder is an iframe with
its own copy of `/src/plague/state.js`, and it now receives the parent's
`MythicPlagueBridge` — before this the outbreak in the city ran on the null
bridge and never reached the ward. Both `blob()` readers refuse a cached copy
the moment the slot holds a different object than the one they read, so
whichever window persisted last is the truth and nothing overwrites it.

No SQL. Cure lines, the shelf and the counter log are facts about one
player's business and one player's city, and live on the profile.

### The ward bay — patients, beds and bandages

NPCs walk into the building on their own (`patients.js`): a floor of
wasteland wounds, plus the city's sick when there is an outbreak, who carry
the strain and a citizen's name. They wait in the lobby for a bed; a patient
nobody beds walks out again after twelve minutes and the desk counts it.

- **Beds are the decoration system's.** The same `furniture_catalog` the
  Card Shop and the Dwelling buy from (`func = 'bed'`), the same
  `Profile.furnitureOwned` inventory, the same taxed spend, through three
  bridge accessors. The hospital adds only which SLOT a bed stands in
  (`beds.js`, ten slots in the west wing). A built-in Ward Cot, priced off
  the medical op's rate, means the ward is never un-buildable offline.
- **Treatment.** A wound takes one bandage per severity point; a sickness
  takes one shelf unit of a relief product (the outbreak's family first) or
  two raw Medicine. Treatment runs on the wall clock in bed; better medicine
  heals faster. **A healed patient pays a random 500–5,000 Cinder** — rolled
  once per patient from their id, severity leaning it upward — the moment
  they are discharged, then walks out. This band is the owner's explicit call
  and the one Cinder figure in the building not derived from `_opEcon`; it
  lives in `patients.js` TUNING as `FEE_MIN` / `FEE_MAX`.
- **Bandages** are rolled at the Supply Bench: 2 cloth + 1 water per batch
  of 3. Live resource ids only.
- **Patient models** rotate at random from `patients.models.js`; a look is
  fixed at arrival. Empty list → tinted box figures. Drop `.glb` files in
  `/public/models/hospital/patients/`.
- **No lab in this building.** The containment lab is the Research Facility
  — a different business that ships to this one. The corridor is gone.

### Prophylaxis — what the medicine does for the city

Doses NPCs actually bought protect them. `pharma.prophylaxisOf` weights the
last six hours of counter sales (vaccine 1.0, serum 0.55, tablets 0.35,
tonic 0.3, salve 0), fades them linearly, divides by population, and hands
back a 0..1 factor capped at 0.7. `outbreak.pressureOf` multiplies wild
pressure by `(1 − factor)` when the host offers one — the city adapter reads
it off `MythicPharmacy` by duck type, so a city with no hospital is exactly
as it was. It is a discount, never a floor-breaker: clinics and clean water
are still the building answer, this is the business answer, and both pay.
The desk and the clinic tooltip both print it.

### Wholesale — the Loading Dock

Shelf stock sold to ANOTHER player's hospital, hauled by a player-owned
Transportation Company (`sql/039_pharma_wholesale.sql`, apply after 038).

- **Listing escrows.** The units leave the seller's shelf the moment they
  list, so the city counter cannot sell them under a buyer; if the insert
  fails they come straight back. Listing refuses offline, and refuses for a
  personally-funded medical op, because the payout row it would produce is
  unclaimable (settleWaybill's rule).
- **Buying is an UPDATE** `where status = 'listed'`; two buyers racing the
  same lot means the second sees zero rows and refunds itself. The buyer
  pays goods + haul up front; the seller's `wholesale` payout row is filed at
  the sale, the carrier's `carrier` row on arrival, both claimed through the
  existing `claimPayouts` sweep. A self-owned carrier files no row.
- **What lands is what the cold chain left.** `pharma.wholesaleArrive` takes
  units and quality off a bad haul, deterministically from the lot id.
- **The state machine is a trigger** (`pharma_lots_lock`): the offer is
  immutable once listed; listed→sold needs a buyer, a destination, a carrier
  and an arrival; sold→received changes only the stamp; nothing else moves.

## Next

- **Reputation for sellers.** A lot's arrived quality is known to the buyer;
  a seller rating in the board view would let the market punish bad shelf
  stock the way `rating` punishes bad hauliers.
- **The haulier still decides nothing** on a wholesale lot either — the same
  gap the cure leg has. `haul_post` / `haul_board` in the existing transport
  system is the job board that would fix both.
