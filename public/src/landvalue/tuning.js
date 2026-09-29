/* ════════════════════════════════════════════════════════════════════════════
   🏷 LAND VALUE — THE ONE TUNING TABLE.  `_opEcon()` pattern (CLAUDE.md).
   ----------------------------------------------------------------------------
   No land-value number lives anywhere else in this feature. Every constant
   below carries the derivation that produced it, because the standing rule on
   this project is: DO NOT SHIP A NUMBER WITH NO MODEL BEHIND IT.

   🔴 WHAT THIS TABLE IS NOT
   It is not a price list. Nothing here is a currency, nothing here is a rate,
   and NOTHING HERE MOVES CINDER. `lotValue()` is read by exactly two surfaces
   in node-city — the dossier's "Lot value" row and the inspector's meta line —
   and by nothing that pays anybody (verified by grep before this was written).
   The one place node-city already prices a tile per minute is the Lease Plot's
   rent, and that reads /src/pollution's multiplier, not this. So the whole of
   this feature is outside ECONOMY.md's closed loop by construction, and the
   audit in sim.js cannot see it because there is nothing to see.

   ── THE SHAPE OF THE MODEL ────────────────────────────────────────────────
       V(x,z)  =  CITY  +  LOCAL(x,z)
       CITY    =  20 + round(citySync()*0.3) + decorPoints()      ← the HOST's
       LOCAL   =  ( stencil + reach + wealth + transit + water ) × pollution

   CITY is node-city's own two city-wide terms, untouched. They are IDENTICAL
   ON EVERY TILE — that is not an opinion, it is what the source says — so they
   set the level of the whole map and separate nothing. That is exactly why the
   BAND is taken on LOCAL and not on V: subtracting a constant that every tile
   shares is precisely what isolates location, and it is the only way a band
   ladder can mean the same thing in a young city and an old one.

   ── WHY `premiumFull` IS THE ANCHOR AND NOT A PERCENTILE ──────────────────
   /src/dossier ranks household wealth by QUARTILE and says why: fixed
   thresholds would be invented numbers, wrong at both ends of the game. The
   opposite call is made here, deliberately, and the reason is the feedback
   loop. A percentile ladder RE-NORMALISES every time the city improves: it
   guarantees that a top band exists in every city, including one with no
   downtown in it, and it guarantees that improving everything changes nothing.
   That is a runaway loop with the sign flipped — the ladder chases the city
   instead of the city climbing the ladder.

   So the ladder is anchored to what THIS MODEL CAN ACTUALLY PRODUCE:
   `premiumFull` is the sum of the caps below, and every threshold is a fraction
   of it. A poor city then legitimately has no Prime land, and a city that
   invests everywhere moves everything up without moving the ruler.
   ⚠ `verify()` walks the live board and reports when the real stencil exceeds
     `stencilRef`, so this anchor cannot go stale in silence.
   ════════════════════════════════════════════════════════════════════════════ */

export const LV = {

  /* ── ① THE NEIGHBOURHOOD WINDOW ─────────────────────────────────────────
     Chebyshev radius, in tiles, on a 24×24 board. 4 gives a 9×9 window — about
     an eighth of the map, i.e. "a few blocks", which is the scale a
     neighbourhood is. Bigger and every tile sees every other tile and the map
     goes flat; smaller and the model is the adjacency stencil again.

     🔴 THE NON-OVERLAP RULE, AND IT IS LOAD-BEARING. The host's stencil already
        scores the FOUR ADJACENT tiles (road, anchor, arena, fountain, decor).
        Everything computed in this module therefore starts at d = `inner` and
        the two can never double-count the same fountain. If you widen the
        stencil in node-city, raise `inner` here in the same commit. */
  radius: 4,
  inner: 2,

  /* ── ② THE CAPS. Each term's ceiling, and the whole band ladder is anchored
     to their sum. The RATIO between them is the design statement: what is on
     your street corner (stencil) outweighs what is four tiles away (reach),
     which outweighs who your neighbours are (wealth), which outweighs the bus
     (transit), which outweighs the view (water). ───────────────────────── */

  /* The host stencil's realistic ceiling on a plot a player can actually build
     on: one adjacent anchor at full link (20 + 100×0.5 = 70), one road frontage
     (+10) and an adjacent Duel Arena (+30) = 110. Four adjacent anchors is
     arithmetically possible and unreachable in play. `verify()` reports the
     live board's true maximum rather than trusting this. */
  stencilRef: 110,

  reach: {
    cap: 60,
    /* Every service building within the window, decayed by distance. The
       weights are read off SHIPPED FIELDS rather than invented per building:
         · `def.svc.need`   — this thing supplies a service you can walk to.
         · `def.svc.morale` — the game's OWN authored statement of how much
           better a building makes people feel. A Club is 6, a Restaurant is 2,
           a Grocery is 0. That IS an amenity ranking, already balanced by
           whoever tuned service, and inventing a second one beside it is how
           two systems come to disagree about the same street.
       ⚠ `decorPts` is deliberately NOT read here. Beauty is scored by the
         host's stencil at adjacency and reading it again over a radius would be
         the same fountain counted twice. */
    perService: 6,
    perMorale: 2.5,
    /* Distance falloff over d = inner..radius, linear: (radius + 1 − d)/radius.
       d=2 → 0.75, d=4 → 0.25. Linear rather than 1/d² because the window is
       four tiles wide: an inverse-square over that span is nearly a step
       function and the overlay reads as blobs rather than as districts. */
  },

  wealth: {
    cap: 45,
    /* Who lives around here — /src/demographics, live, per tile. Capped BELOW
       the amenity term on purpose: a district of comfortable households with no
       shops, no transit and nothing to walk to is a commuter suburb, and it
       should not out-price a high street.
       `popRef` is how many residents inside the window count as full coverage,
       so one wealthy house cannot max the term. 40 people over an 81-tile
       window is roughly a filled block of walk-ups. */
    popRef: 40,
    /* The tier scores. /src/demographics ranks households low/mid/high, and the
       ladder is its own — this only turns three labels into a 0..1 number. */
    tier: { low: 0.15, mid: 0.5, high: 1 },
  },

  transit: {
    cap: 35,
    /* Distance to the nearest stop or station, decayed over the same window.
       🔴 SCALED BY THE NETWORK'S ACTUAL MODE SHARE (`jobAccess().served`), so a
          shelter that no line stops at is worth EXACTLY NOTHING. That is not a
          nicety — /src/transit's own tuning header says a stop you built and
          never routed still costs upkeep, and a land-value premium for unused
          infrastructure would be a way to farm this number with a shelter and a
          shrug. It also inherits that function's monotonicity: building a line
          can only raise this, deleting one puts it back. */
    types: ['trainstation', 'busstop'],
    /* A station is worth more than a bus shelter, and the split is the game's
       own: /src/transit prices a Rail Operator at 5× a Bus Company. */
    weight: { trainstation: 1, busstop: 0.55 },
  },

  water: {
    cap: 25,
    /* Waterfront. /src/water's surface field, 0..1, taken at its strongest
       point inside the window. The smallest cap in the table because it is the
       one term the player cannot build: it rewards siting, not investment. */
    minRead: 0.12,      // the same cut /src/water's own overlay draws at
  },

  /* ── ③ THE BANDS. Fractions of `premiumFull` (= stencilRef + every cap).
     Five, because five is the ladder the brief names end to end (Small Card
     Shop → … → Ouroboros Mega Store) and because it is what four thresholds
     buys you.

     🔴 THE ONE PLACE THE FRACTIONS COME FROM. `stencilRef / premiumFull` is
        0.40, and 0.40 is the bottom of band 4 EXACTLY. That is the whole
        design of this ladder: a plot with a full-link anchor, road frontage and
        an arena next door reaches PREMIUM on its frontage alone, and can never
        reach PRIME on it. Prime requires the SURROUNDINGS — amenity, wealthy
        neighbours, transit — which is the difference between a good corner and
        a downtown, and is what stops one lucky tile from being the whole city.
     ⚠ The bottom of band 5 (0.62) is above stencilRef + any single cap
       (0.40 + 0.22 = 0.62 for reach, the largest). Prime therefore needs at
       least TWO of the surrounding terms, never one. */
  bandCuts: [0.09, 0.22, 0.40, 0.62],

  /* ── ④ THE FIELD ────────────────────────────────────────────────────────
     Recomputed at most this often, and only when something it reads has moved.
     576 tiles × a 9×9 convolution is ~46k weighted adds; cheap, but not free
     every frame, and nothing it reads changes at frame rate. */
  field: { ttlMs: 2500 },

  /* Floor on the printed value. A tile can never read 0 ₵ — the number is on a
     dossier row a player reads as "what is this land worth", and 0 there means
     "the model is broken", not "this is cheap". */
  minValue: 5,

  /* ── ⑤ THE OVERLAY ─────────────────────────────────────────────────────
     One PlaneGeometry, one CanvasTexture, exactly as /src/power and /src/water
     do it — 576 tinted quads would be 576 draw calls for a layer the player
     toggles.

     🔴 y AND renderOrder WERE CHECKED AGAINST THE OTHER THREE, NOT PICKED.
        This is the FOURTH flat data plane over the same ground and all four can
        be open at once — comparing a plume against the land value under it is
        exactly what this batch is for. The stack, read off their tuning files:
            /src/power      y 0.060  renderOrder  ~4
            /src/water      y 0.075  renderOrder   4
            /src/pollution  y 0.090  renderOrder  13
            /src/landvalue  y 0.105  renderOrder  14   ← this one
            /src/tenants    y 0.115  renderOrder  15
            /src/resmap     y 0.120  renderOrder  16   ← the resource map, on top
        ⚠ THIS ONE IS NO LONGER THE TOP OF THE STACK, and the table is kept
          up to date here rather than only in the new file for the reason the
          🐞 below records: the next module to want a plane reads the FIRST of
          these tables it finds, and a stale one is how two of them end up
          coplanar again. /src/resmap took 0.120 by reading this list.
        🐞 …AND THE LIST WAS ALREADY STALE WHEN IT DID. /src/tenants/overlay.js
           has shipped `Y = 0.115, RENDER_ORDER = 15` since the tenant round and
           was never added here, so /src/resmap read the bottom of this table,
           claimed renderOrder 15, and collided with a plane the document did
           not mention. Its row is now written in, and the resource round's
           driven test enumerates the live scene graph for every CanvasTexture
           plane instead of trusting this comment — because a table is only as
           good as the last module that remembered to update it.
        ⚠ 0.09 WAS THE FIRST VALUE HERE AND IT WAS WRONG: it is /src/pollution's
          exact height, and two coplanar planes z-fight into a flicker the
          moment a player opens both. Caught by reading the neighbour's table
          rather than by looking at a frame, because the flicker is
          camera-dependent and a still would not have shown it.

     `opacity` 0.72 is in the same range as /src/power (0.78) and
     /src/pollution (0.80) rather than /src/water's 0.55 — water is quieter
     because its ramp starts near white and a bright fog over the whole district
     makes the city under it unreadable. This ramp is fully saturated at both
     ends, so it stays legible against node-city's pale ground at a weight where
     a near-white one would not. */
  overlay: { y: 0.105, px: 16, opacity: 0.72, renderOrder: 14 },

  col: {
    /* The band ramp. Cool → warm, five stops, one per band, so the legend and
       the map are the same five colours and the player never has to read a
       gradient against a number. Deliberately NOT the zoning family hues
       (green/blue/teal/yellow) — this layer answers a different question and
       must not be mistaken for a zone map. */
    band: ['#2f4f96', '#2f9fb8', '#5fbf5a', '#e8a72a', '#e04a2f'],
    stop: '#8fd0e8',        // a transit stop that is actually served
    poison: '#7d5fa8',      // hatch, where pollution is taking value off
    poisonAt: 0.97,         // below this multiplier the hatch is drawn
  },
};

export default LV;
