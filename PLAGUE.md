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
   recovered → immune. It spreads along the *workplace* graph the city already
   models. **Nobody dies and no building is ever touched** — see the three
   inherited rules at the top of `outbreak.js`.
3. **You cure it in the lab.** Walk to the Sequencer to read the strain's four
   axes. Suit up at the airlock. Spin, mix, assay, package.
4. **You can get it wrong.** A batch that is unstable or contaminated is graded
   `IATROGENIC`, and administering it spawns a **new strain** — the parent,
   pushed along the axes your failed blend was leaning on. It is traceable to
   what you mixed, on purpose.
5. **You ship it.** A cure in the lab has cured nobody. Hire a player-owned
   haulier to run it to a player-owned Medical Corporation.

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

## Next

The Medical Corporation minigame is the far end of this pipe. The hook is
already there: `rankLabs()` computes each lab's `capacity` and `canAdminister`
from its staffing, and an unstaffed lab receives the crate and cannot open it.
That is the medical player's job, and it is what their minigame is for.
