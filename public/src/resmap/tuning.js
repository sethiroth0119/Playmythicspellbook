/* ════════════════════════════════════════════════════════════════════════════
   🗺 THE RESOURCE MAP — every number, in one file.
   ----------------------------------------------------------------------------
   "I cannot see where anything IS." — the player, after v121c0.

   This is the FIFTH instance of a template this codebase has already run four
   times (/src/power's geology, /src/water's hydrology, /src/pollution's field,
   /src/landvalue's field). Nothing here is new machinery; what is new is that
   the ground the city ALREADY has an opinion about is finally drawn, and that
   the two resources nobody had an opinion about — ore and fertile land — get
   one, built to the same rules as the two that do.

   🔴 THE RULE THAT SHAPES EVERY NUMBER BELOW: THIS MODULE OWNS THE GROUND AND
      NEVER THE RATE. `yield.floor`/`yield.top` are a MULTIPLIER on a rate
      node-city computes; there is no resource price, no output figure and no
      cost anywhere in this file. That is the hydro.js single-truth rule, and it
      is why a 404 on /src/resmap leaves production byte-identical.
   ════════════════════════════════════════════════════════════════════════════ */

export const RES = {

  /* ── ① THE OVERLAY PLANE ──────────────────────────────────────────────────
     🔴 y AND renderOrder WERE READ OFF THE NEIGHBOURS' TABLE, NOT PICKED. This
        is the FIFTH flat data plane over the same ground and all five can be
        open at once — comparing an ore body against the pollution over it is
        exactly the kind of read this layer exists for. The stack, read off
        /src/landvalue/tuning.js:170-190 (which is itself the checked copy):

            /src/power       y 0.028 / 0.060   renderOrder  3 / ~4
            /src/ocean       y 0.035
            /src/water       y 0.075           renderOrder  4
            /src/pollution   y 0.090           renderOrder 13
            /src/landvalue   y 0.105           renderOrder 14
            /src/tenants     y 0.115           renderOrder 15
            /src/resmap      y 0.120           renderOrder 16   ← this one, on top

        ⚠ 0.090 IS NOT AVAILABLE and was a real bug once: it is /src/pollution's
          exact height, and two coplanar planes z-fight into a camera-dependent
          flicker that a still frame will not show. 0.120 is 0.015 clear of
          /src/landvalue and 0.005 clear of /src/tenants.

        🐞 AND renderOrder 15 WAS TAKEN, WHICH THE TABLE DID NOT SAY. The first
           version of this file read /src/landvalue/tuning.js — the canonical
           list — and claimed 0.120/15 off the bottom of it. /src/tenants/
           overlay.js was already at `Y = 0.115, RENDER_ORDER = 15` and had
           never been added to that table, so the two shipped an identical
           renderOrder with 0.005 between them: not a z-fight (both are
           depthWrite:false), but a tie that three then breaks by camera
           distance, i.e. an ordering that can change as the player orbits.
           Caught by ENUMERATING the live scene graph — every mesh whose
           material carries a CanvasTexture — rather than by trusting the
           document, and the missing row was written back into
           /src/landvalue/tuning.js in the same change. A table is only as good
           as the last module that remembered to update it, so the check is now
           a scene walk in the driven test.

     ⚠ ON TOP IS THE RIGHT PLACE FOR THIS ONE, not a coin toss. A resource map
       is what a player opens WHILE deciding where to put a building; every
       other layer is something they consult afterwards. If it were under the
       land-value plane, the two would fight for the same district and the
       answer to "can I site the mine here" would be the one underneath.

     `opacity` 0.74 sits between /src/pollution (0.80) and /src/landvalue
     (0.72). The ramps below are saturated at the top end and nearly
     transparent at the bottom (see fieldAlpha), so the layer is quiet where it
     has nothing to say and loud on a deposit. */
  overlay: {
    y: 0.120,
    renderOrder: 16,
    // 24 px per tile — /src/power's figure. 24 × 24 tiles is a 576px texture:
    // a trivial upload, and enough to resolve the deposit outline below.
    px: 24,
    opacity: 0.74,
    /* 🔴 THE ALPHA FLOOR IS 0.10, NOT 0.55, AND THAT IS A MEASURED FIX, NOT A
       PREFERENCE. /src/power/overlay.js records it: a field defined on ALL 576
       tiles sitting around 0.15 almost everywhere, painted from a 0.55 floor,
       tints the whole district a flat grey that says nothing and hides the city
       under it — worst in the evening, because the plane is toneMapped:false
       while the city beneath it is not. A resource field is dense in exactly
       the same way (fertile land has a base level EVERYWHERE), so it takes the
       same ramp: invisible where it has nothing to say. */
    fieldAlpha: { floor: 0.02, lo: 0.10, hi: 0.70 },
    /* The deposit OUTLINE. This is the single thing that turns a pretty
       gradient into a usable map, and /src/power made the same argument for its
       geothermal contour: the player does not want to know the rock reads 0.42,
       they want to know whether this tile is INSIDE the ore body. That is a
       line, not a colour. Drawn at each field's own `mark` threshold, in the
       field's own hue, so two overlapping bodies stay two bodies. */
    edge: 0.11,          // stroke thickness as a fraction of a tile
    edgeAlpha: 0.92,
  },

  /* ── ② THE FIELDS ─────────────────────────────────────────────────────────
     Each entry is ONE deterministic per-tile field, generated from the city id
     by fields.js the way /src/water/endowment.js generates aquifers and
     /src/power/geology.js generates vents.

       res        which of node-city's LEDGER resources this ground feeds. The
                  mapping lives HERE and not in node-city, because "ore feeds
                  metal" is a fact about the GROUND — this module's whole
                  subject — while node-city owns the rate. The host's pre-pass
                  reads `def.gen` generically and never names a building type,
                  so there is no list of type strings in a second file (the bug
                  class node-city has had to correct three times by number).
       surface    true  ⇒ this is something GROWING ON the ground, and an
                  indoor building is exempt from it. The Hydro Farm is
                  ember-lamps in a shed and its own description says
                  "weatherproof"; charging it for the soil outside would be the
                  layer telling a visible lie. Read off the row's existing
                  `outdoor` flag, which is already what separates the two.
                  false ⇒ it is UNDER the ground, and a roof is irrelevant.
       base       a floor the field carries on every tile. Soil is everywhere
                  and there is poor rock under most ground; an ore body and a
                  gas pocket are not, and carry no base at all — which is what
                  makes them worth going to look for.
       mark       the outline threshold — "you are on the RICH part of the
                  deposit". ⚠ THIS IS A RICHNESS CONTOUR AND NOT THE SITE LINE,
                  and the two must not be confused (the read-through rows in ⑤
                  are the opposite case, and got it wrong once). `bodyAt()` —
                  which is what siteRefusal() actually asks — cuts at `minRead`
                  below, and minRead < every mark here. So the refusal's
                  sentence "every tile inside the outline is a legal site" is
                  SUFFICIENT and deliberately not necessary: inside the contour
                  is always legal, and the thin fringe outside it is legal too.
                  A map that under-promises sends a player somewhere that works;
                  the reverse sends them somewhere the gate refuses, which is
                  the defect ⑤ documents. Never let a mark here drop below
                  `minRead`, or that sentence stops being true.
       nMin/nMax  how many bodies. FEW AND TIGHT reads as located deposits;
                  many and broad reads as one soft blur, which is the failure
                  this whole feature exists to avoid.
       rMin/rMax  body radius in tiles, on a 24×24 plate.

     ⚠ NO PRICES, NO YIELDS PER FIELD. Every field feeds the ONE yield ladder
       in ③. A per-field multiplier would be a second economy with no ECON row
       behind it. */
  fields: [
    {
      id: 'ore', label: 'Ore & Buried Scrap', ico: '⛏', res: ['metal'],
      surface: false, base: 0, mark: 0.34,
      nMin: 3, nMax: 5, rMin: 2.0, rMax: 3.7, sMin: 0.42, sMax: 1.00,
      note: 'The Mine pulls metal out of this. Rich, tight and rare — a city usually has two bodies worth taking.',
      ramp: ['#3a3128', '#8a5a2b', '#d3862c', '#f7cf7d'],
      key: '#d3862c',
    },
    {
      id: 'petro', label: 'Rift-Gas Pockets', ico: '🛢', res: ['fuel'],
      surface: false, base: 0, mark: 0.36,
      /* 🐞 nMin WAS 1 AND THAT WAS A DESIGN BUG, CAUGHT BY MEASURING RATHER
         THAN BY EYE: a single pocket of r≈1.6 covers about six tiles of 576, so
         a city rolled at the minimum had exactly ONE place to put a Fuel Rig
         and no decision to make. Two is still the scarcest ground in the game
         (mean coverage ~1%) and it is a CHOICE. */
      nMin: 2, nMax: 3, rMin: 1.8, rMax: 3.0, sMin: 0.46, sMax: 1.00,
      note: 'The Fuel Rig taps these. The scarcest ground in the game — two or three pockets, and they are small.',
      ramp: ['#2b2b34', '#4b4160', '#7b5fa8', '#c3a6f0'],
      key: '#7b5fa8',
    },
    {
      id: 'stone', label: 'Stone & Aggregate', ico: '🪨', res: ['stone'],
      surface: false, base: 0.04, mark: 0.30,
      nMin: 2, nMax: 4, rMin: 2.6, rMax: 4.6, sMin: 0.40, sMax: 0.95,
      note: 'The Quarry cuts these ridges. Broader than ore and easier to find — but a Quarry off the rock is still a Quarry off the rock.',
      ramp: ['#2e3238', '#5a6672', '#8f9aa6', '#d5dde6'],
      key: '#8f9aa6',
    },
    {
      id: 'fertile', label: 'Fertile Land', ico: '🌾', res: ['food', 'cloth'],
      surface: true, base: 0.11, mark: 0.34,
      nMin: 3, nMax: 5, rMin: 3.6, rMax: 6.4, sMin: 0.40, sMax: 0.98,
      note: 'The Farm and the Fiber Croft grow on this. Broad, and every city has some — but the good ground is worth walking to. The Hydro Farm is indoors and ignores it entirely.',
      ramp: ['#2f3a2b', '#4e7a3a', '#83bf4c', '#d8f08a'],
      key: '#83bf4c',
    },
    {
      id: 'timber', label: 'Standing Timber', ico: '🪵', res: ['wood'],
      surface: true, base: 0.06, mark: 0.32,
      nMin: 2, nMax: 4, rMin: 3.0, rMax: 5.6, sMin: 0.42, sMax: 0.98,
      note: 'The Lumber Camp fells this. Stands are wide and soft-edged; the middle of one is worth a third more than its fringe.',
      ramp: ['#2b3330', '#3f6a52', '#5f9a6a', '#a8d9a0'],
      key: '#5f9a6a',
    },
  ],

  /* ── ③ THE YIELD LADDER ───────────────────────────────────────────────────
     🔴 A SOFT CEILING, NEVER A GATE — AND THAT IS A PROMISE THIS PROJECT HAS
        ALREADY MADE IN WRITING. /src/economy/endowment.js owns `canExtract`,
        the one HARD build gate about ground, and /src/city/terroir.js carries
        the SOLO promise that "nobody is ever locked out". A per-tile hard gate
        on wood or stone would break that at a resolution the trade layer cannot
        rescue: a player whose city has no ore body would simply have no metal.
        So this ladder can only ever multiply a rate the host already computed,
        between a floor and a top, and every tile in every city is buildable.

     ⚠ THE FLOOR IS 0.85 AND NOT 0, FOR THE SAME REASON /src/water's IS 0.80.
       Every farm and every mine standing in an existing save was placed by a
       player who could not see this map, because it did not exist. A floor of
       0 would be a retroactive halving of a lived city, which the save rules
       forbid; 0.85 is a nudge that says "you could do better", and only a NEW
       building can be sited to collect the 1.50.

     `full` is the field value at which the top is reached. 0.72 rather than
     1.0 because a deposit's exact peak is a single tile — a ladder that only
     pays out at the peak would make the map a pixel hunt instead of a siting
     decision. Anywhere in the core of a good body earns the full bonus. */
  yield: { floor: 0.85, top: 1.50, full: 0.72 },

  /* ── ④ THE SCARCITY FLOOR ─────────────────────────────────────────────────
     Re-imposed AFTER generation, exactly as /src/water/endowment.js re-imposes
     `minBasinStrength` and /src/economy/endowment.js re-imposes its guarantee:
     everything above can only roll DOWN, so a promise that is not asserted
     after the rolls is a promise that quietly stops being true after a tuning
     pass. Every field in every city has at least one body whose best tile
     reads `minPeak` — i.e. every city has somewhere good to put every kind of
     extractor. Lifted to EXACTLY the minimum, never higher: a pinned deposit
     is never a gift. verify() proves it over 200 ids. */
  minPeak: 0.68,
  /* Below this a tile is not "on" anything — used by depositAt() and by the
     refusal, so the message and the map cannot disagree about what counts. */
  minRead: 0.12,

  /* ── ⑤ THE READ-THROUGH LAYERS ────────────────────────────────────────────
     🔴 THESE ARE NOT GENERATED HERE AND MUST NEVER BE. Groundwater and ground
        heat already exist, with their own endowments, their own panels and —
        in groundwater's case — a PLACEMENT GATE that refuses a Water Station
        off the aquifer. A second field drawn from a second seed would render
        perfectly and disagree with the gate forever, visibly, which is exactly
        the "second waterline" /src/ocean refuses to draw.
        So this layer asks the owner, every paint:
            groundwater ← window.MythicWater.endowment().groundAt(x, z)
            heat        ← window.MythicPower.heatAt(x, z)
        and when the owner is absent the row renders DISABLED and names the
        global it is waiting for. It never substitutes a plausible field.

     ⚠ AND THEY CARRY NO YIELD. `res` is empty on both: /src/water already owns
       the water multiplier (`_wtFac`) and /src/power already owns the
       geothermal gate. Giving them one here would double-charge the same
       ground through two modules.

     ── 🐞 …AND THEY CARRY NO THRESHOLD EITHER. THIS IS THE FIX FOR A SHIPPED
        DEFECT, SO IT IS WRITTEN DOWN RATHER THAN JUST CORRECTED ──────────────
        The first cut of this table typed `mark: 0.12` beside `markFrom:
        'water'` and then never read `markFrom` at all. Two numbers disagreed
        in silence:
          · the OUTLINE was drawn at 0.12 while /src/water's gate cuts at
            `WATER.aquifer.minRead` = 0.10, so the line excluded legal sites
            (measured over 60 cities: 5.1 per city, 7.2% of all legal tiles);
          · the PAINT was cut at the generated fields' alpha floor (0.02), so
            the layer coloured 27.5 tiles per city — 27.9% of everything it
            painted — that the Water Station gate REFUSES. /src/water/overlay.js
            had already been through this exact bug and wrote the verdict down:
            painting the falloff's tail "promised water on tiles where a
            waterworks would get the dry floor… worse than no overlay."
        It is the failure mode this whole feature exists to avoid — a legend
        promising a colour the simulation does not use — and it was on the
        headline layer, the one the player asked for by name.

        SO NO THRESHOLD IS TYPED HERE. `markFrom` names the OWNER OF THE LINE
        and index.js asks that owner for the number LIVE, every paint
        (`OWNER_LINE`). A row whose owner will not state its line is REFUSED
        and drawn as nothing — the /src/ocean discipline — because a contour
        this module invented would be a second opinion about a gate it does not
        enforce, which is the same defect wearing a different number.

        ⚠ THE OWNER RETURNS TWO NUMBERS AND THEY ARE NOT ALWAYS EQUAL:
            mark  the SITE LINE — at or above it the owner's placement gate
                  says yes. This is the outline.
            cut   the PAINT FLOOR — below it the owner's own overlay draws
                  nothing, so neither does this one. `null` means "the owner
                  paints its whole field", and then this layer falls back to the
                  shared alpha floor so the two pictures still match.
          For groundwater they are the SAME number (minRead is both the gate and
          /src/water/overlay.js's own cut). For heat they differ: /src/power
          paints all 576 tiles from its alpha floor and outlines at `minHeat`,
          so copying only one of the two would make this panel disagree with the
          panel next to it. */
  read: [
    {
      id: 'groundwater', label: 'Groundwater', ico: '💧',
      need: 'water', from: 'window.MythicWater.endowment()',
      /* The line comes from WATER.aquifer.minRead, live. Both numbers, because
         /src/water cuts its own paint at exactly its gate. */
      markFrom: 'water',
      /* 🔴 THE NOTE DOES NOT STATE THE NUMBER. The panel appends the live one
         it actually drew with, so the prose cannot go stale behind a retune —
         which is how the sentence this replaced ("the outline is the legal-site
         line, and /src/water refuses anything outside it") became false while
         reading perfectly. */
      note: 'Where the aquifers are. A Water Station MUST stand on this, and this layer is drawn to /src/water’s own line: every tile it paints is a legal site, and every legal site is painted.',
      ramp: ['#22303a', '#2f6f8f', '#4fd8e8', '#c8f4ff'],
      key: '#4fd8e8',
    },
    {
      id: 'heat', label: 'Geothermal Heat', ico: '♨',
      need: 'power', from: 'window.MythicPower.heatAt()',
      /* POWER.plants.geothermal.minHeat, live — and it is 0.46, not the 0.30
         this row used to assert. The old number outlined ground the Geothermal
         Plant would refuse. */
      markFrom: 'power',
      note: 'Hot rock. The Geothermal Plant is licensed on it, and /src/power draws the same field in its own panel — this is that field, not a copy of it. The outline is that plant’s licence line.',
      ramp: ['#331f1f', '#8a3a1f', '#e0762a', '#ffd9a0'],
      key: '#e0762a',
    },
  ],

  /* ── ⑥ THE PANEL ──────────────────────────────────────────────────────────
     Which rows start switched on. NOT everything: an info view that lights
     every layer at once is a colour soup and its first read says nothing (the
     rule /src/water/panel.js states and /src/pollution repeats). Groundwater is
     on because it is the one the player asked for by name — "a water station
     has to be sited on it and right now siting is blind guessing". */
  defaultLayers: {
    groundwater: true, heat: false,
    ore: true, petro: false, stone: false, fertile: true, timber: false,
  },
  /* Deposits smaller than this share of the biggest one in their field are
     folded into a "…and N smaller" line in the table, the same rule the away
     report and the water panel already use. */
  table: { maxRows: 4 },
};

export default RES;
