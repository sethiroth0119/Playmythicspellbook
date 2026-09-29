/* ═══════════════════════════════════════════════════════════════════════════
   🎚 SC — every Supply Chain knob, in one place (the _opEcon / ECON pattern).

   🔴 THERE IS NO ECONOMY NUMBER IN THIS FILE, AND THERE MUST NEVER BE ONE.
   No startup cost, wage, hourly rate, yield, input rate, price, fee or tariff.
   Those belong to the game: the browser reads them through sc.bridge.js
   `opEcon(id)` (which is `_opEcon()`, so a published admin override shows up
   here too) and Node tests read tools/supplychain/fixture.opsecon.json, which
   is generated from index.html and drift-checked. No KEY in the object below
   may be one of OPS_ECON's field names — that is the grep the audit smoke
   runs, and it must stay empty.

   What DOES live here is everything that is this feature's own opinion:
   where things sit in 3D, how the camera moves, how long a tween takes, where
   the hover card floats, how the plan words its verdicts, and how the OFF-by-
   default proposal scales a new input. Every one of those that touches the
   economy is RELATIVE — a fraction of a figure the game supplies — so a retune
   of the real table moves the proposal and the plan with it and nothing here
   goes stale.

   Pure data: no window, no DOM, no imports. `node` can import() it.
   Never hardcode one of these anywhere else in this folder. Read SC.x.
   ═══════════════════════════════════════════════════════════════════════════ */

const deepFreeze = (o) => {
  for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); }
  return Object.freeze(o);
};

export const SC = deepFreeze({
  version: 'sc2',                       // matches the entry tag's ?v= ; bump together

  /* 🗺 LAYOUT (world units). The owner's PDF is the map: four SYSTEMS as the
     big landmarks, the business tiles grouped the way pages 6-9 group them, and
     Transport in the MIDDLE because the owner's rule is that every lane goes
     through it. A force-directed layout was rejected — it is different on every
     open, and a player who learned "Mining is top-left" must find it there
     again. Everything below is an input to a deterministic ring/sector layout;
     positions themselves are derived in the scene from the graph. */
  layout: {
    hubRadius: 0,                       // Transport sits at the origin
    channelRadius: 9,                   // Marketplace / Car Marketplace ring
    businessRadius: 22,                 // inner business ring
    businessRadiusOuter: 31,            // second ring when a sector overflows
    perRingMax: 14,                     // tiles on the inner ring before spilling outward
    systemRadius: 44,                   // the four system landmarks
    sectorGapDeg: 8,                    // breathing room between PDF page groups
    startAngleDeg: -90,                 // first tile at "north", reading clockwise like the PDF
    tile: { w: 4.2, d: 4.2, h: 1.1 },   // a business plinth
    hubTile: { w: 7, d: 7, h: 1.6 },
    systemTile: { w: 9, d: 9, h: 2.4 },
    labelLift: 3.2,                     // name plate height above the plinth
    laneLift: 0.35,                     // lanes float just off the ground so they never z-fight it
    laneArc: 0.18,                      // sideways bow as a fraction of lane length; parallel lanes stay apart
    depotOffset: 5.5,                   // pickup / depot markers this far from the hub centre along a lane
    groundSize: 140,
  },

  /* 🎥 CAMERA. Tweens are TIMESTAMP-based (performance.now), never frame-
     counted: the Browser pane composites at about half a hertz and a frame-
     counted tween there takes minutes (CLAUDE.md, "Verifying"). */
  camera: {
    fov: 42, near: 0.5, far: 400,
    home: { dist: 96, polarDeg: 52, azimuthDeg: 0, target: [0, 0, 0] },
    focus: { dist: 30, polarDeg: 58 },
    systemFocus: { dist: 52, polarDeg: 55 },
    minDist: 18, maxDist: 130,
    minPolarDeg: 18, maxPolarDeg: 82,   // never under the ground, never flat top-down
    orbitSpeed: 0.0055,                 // radians per dragged pixel
    zoomStep: 0.12,                     // fraction of distance per wheel notch
    dragSlopPx: 6,                      // movement under this is a click, not a drag
    /* 🔴 THE IDLE TURNTABLE IS A BOUNDED SWAY, NOT A FREE SPIN.
       It used to be `idleSpinDegPerSec: 1.2` added to the azimuth forever, with
       no bound and no re-fit. Measured in the real page at 1600x900 from an
       untouched home: t+0 all 33 plates in frame, t+31s 32, t+60s 24 — nine
       gone, including ALL FOUR district labels — t+120s 27, t+180s 30. So the
       overview spent most of its idle life not reading as the owner's PDF, and
       at t+60s the districts had skewed out of their left-to-right order with
       CITY BUILDER clipped by the bottom edge. Reduced motion sets `still` and
       skips the spin, which is the only reason this was never caught.
       The map is four districts side by side in a fixed reading order; a
       turntable that carries them past 90° destroys the one thing the overview
       is for. So the camera BREATHES either side of home instead: it never
       leaves a band the home() fit has already proved every plate fits in (the
       fit unions the frame over this whole band — see scene.js home()), and it
       always comes back. Keep the two numbers small: widening the sway widens
       the band home() must fit, which pushes the whole map further away. */
    idleSwayDeg: 6,                     // ± either side of home azimuth; 0 disables. Reduced motion: still.
    idleSwayPeriodMs: 44000,            // one there-and-back. Deliberately not a round divisor of the
                                        // 30/60/120/180/300 s the gate photographs, so no sample lands
                                        // on the phase where the frame is identical to t+0.
    idleAfterMs: 9000,
  },

  tween: {
    cameraMs: 750,
    reducedMs: 1,                       // prefers-reduced-motion: arrive, do not travel
    hoverFadeMs: 120,
    modalMs: 180,
    flowHighlightMs: 260,
  },

  /* 🚚 FREIGHT — the moving markers that make "it ships through Transport"
     visible. Purely illustrative: count and speed say nothing about volume,
     and the legend says so. Clocked on Date.now so a throttled tab does not
     pile them up. All off under reduced motion. */
  freight: {
    perLane: 1,
    maxTotal: 60,                       // software WebGL budget; lanes beyond this stay static
    unitsPerSec: 7,
    size: 0.7,
    pauseAtDepotMs: 500,
  },

  /* LIVE vs PLANNED must be readable without colour (contract rule 3): planned
     is dashed + dimmer + carries a text tag; colour is only the third cue. */
  status: {
    live: { opacity: 1, dash: null, tag: 'LIVE' },
    planned: { opacity: 0.55, dash: [0.9, 0.6], tag: 'PLANNED' },
  },

  /* 🎨 Ruin Ledger palette for the places CSS variables cannot reach (three.js
     materials, canvas-painted labels). Same values as the :root tokens in
     index.html — DESIGN-BAR section 1: warm black, gold, parchment; blue is
     never chrome. If a token changes there, change it here. */
  palette: {
    bgDeep: '#0c0b0a', bgPanel: '#17150f', bgCard: '#1c1813',
    gold: '#d4af37', goldBright: '#f5d76e', ember: '#e85d3c', blood: '#a02828',
    emerald: '#3aa86b', azure: '#4a8fd4', violet: '#8b5cf6',
    ink: '#e8e0d0', inkDim: '#a89888', border: '#504224', borderBright: '#7a6431',
    parchment: '#d9cbaa', parchmentInk: '#241f16',
    // edge kinds (graph.js): one hue each, chosen warm-first so the map reads as
    // one ledger page and not a rainbow.
    edge: { system: '#7a6431', supply: '#d4af37', loot: '#e85d3c', channel: '#3aa86b', service: '#a89888' },
    system: { 'sys:battle': '#e85d3c', 'sys:business': '#d4af37', 'sys:city': '#3aa86b', 'sys:camp': '#d9cbaa' },
  },

  /* 🪧 HOVER CARD — follows the pointer, flips before it would leave the
     overlay, and waits a beat so sweeping the mouse across the map does not
     strobe twenty cards. */
  hover: {
    offsetX: 18, offsetY: 16,
    edgePad: 12,
    maxWidth: 340,
    showDelayMs: 90,
    hideDelayMs: 60,
    maxMakes: 4, maxNeeds: 4, maxPartners: 3,   // the card is a glance; the modal holds the full list
    touchHoldMs: 350,                   // long-press stands in for hover on touch
    /* 🔴 The card MUST paint above the overlay chrome. It shipped at z-index 4
       while .sc-head (the search/legend header, sc.css.js) is z-index 6 and
       occupies the top ~182 px, so on any node near the top of the stage the
       card's own HEAD ROW — the business NAME, its LIVE/PLANNED badge and the
       first "Makes…" line — was painted UNDERNEATH the header. Measured on 4 of
       8 sampled businesses at BOTH 1600x900 and 1366x768 (58–129 px hidden;
       Car Factory 129, Medical 126, Fishing 94, Transport 76). A card with no
       visible title does not answer the owner's "hovering shows the
       information", and a viewport-bounds assertion stays green the whole time,
       which is why it shipped. 10 = above .sc-head (6) and above the mobile
       rail (8/9), still below the modal host (modal.js, 20) — the card hides
       when the modal opens, so it must never be able to cover it. */
    zIndex: 10,
  },

  modal: {
    maxWidth: 860,
    maxResourcesShown: 24,              // per section before "show all"
    maxPartners: 6,
  },

  search: { minChars: 2, maxResults: 12, debounceMs: 120 },

  /* 🤝 PARTNER RANKING — weights over facts in the graph, not over money. A
     partner that is LIVE today outranks one that only exists on the owner's
     map, because "best business to work with" is advice a player acts on now. */
  partners: {
    weight: { supplier: 1.0, customer: 0.9, carrier: 0.8, channel: 0.5, financier: 0.4, storage: 0.4 },
    perSharedResource: 0.25,
    liveBonus: 0.5,
    pdfDrawnBonus: 0.35,                // the owner drew this dependency on the map
    ambiguousPenalty: 0.3,              // AMBIGUITIES rows are shown, but never ranked first
    maxShown: 6,
  },

  /* 🧭 PLAN — "is this for me". Every threshold is a RATIO against figures the
     game supplies at run time (what the player holds vs what the licence asks;
     what the payroll asks vs what the business brings in), so none of them is a
     price and none goes stale on a retune. */
  plan: {
    afford: { ready: 1.0, close: 0.5 },          // held Cinder as a fraction of the licence ask: ready / close / far
    margin: { thin: 0.15, healthy: 0.4 },        // (income - payroll) / income per worker-hour, as the game states both
    inputsHeld: { ready: 1.0, partial: 0.34 },   // share of needed resource KINDS the player already holds
    dependency: { light: 1, heavy: 4 },          // supplier businesses needed: at or under light = solo-friendly, at or over heavy = network business
    lootShare: { battler: 0.5 },                 // share of needs that are battle loot before we call it a battler's business
    staffing: { small: 0.34, full: 1.0 },        // fraction of the worker cap used for the "starting small" vs "fully staffed" lines
    maxSteps: 6,
    maxRisks: 4,
  },

  /* 📜 PROPOSAL — the OFF-by-default overlay (OWNER_DECISIONS D1/D2). A new
     input is sized as a FRACTION of a reference rate the game already states
     for that operation, never as an absolute figure:
       reference = the operation's own largest per-worker output, else the
                   median of the input rates live operations already pay.
     So the proposal scales with the real table and rebalances nothing: no
     existing yield, input or price is touched, only additive inputs. */
  proposal: {
    enabledByDefault: false,
    tiers: { core: 0.30, support: 0.12, trace: 0.04 },
    reference: ['ownMaxYield', 'medianLiveInput'],
    maxInputsPerOp: { core: 2, support: 3, trace: 6 },
    decimals: 2,
    neverTouchExisting: true,           // an id the op already consumes keeps the game's rate

    /* 🎯 THE LOOT GATE — how much looting ONE business may be told to depend on.
       These are ASSUMPTIONS about play time, not prices, and they are the owner's to
       argue with (decisions/proposal.md, Question 1). They live here and ONLY here:
       rounds 2-4 kept a fallback copy inside proposal.js "until the seam adopts it",
       which meant the one number that sets every appetite sat outside the settings
       file for three rounds. proposal.js now carries NO fallback — without this block
       it proposes nothing and says why, and tools/supplychain/proposal-gate.mjs FAILS.
         accept          loot `via` kinds a business may be told to depend on
         haulsPerWindow  single lootings' worth ONE business may ask for, over all of
                         its loot needs together, per window (5 ruins to a battle, so
                         36 is about 7 fully looted battles)
         windowHours     the window; 12 because that is the collect rhythm the harness
                         measures the worst-need throttle over
         madeShare       share of a maker's SPARE hourly output that new buyers may
                         claim between them (the rest stays for the market)
         decimals        precision of a capped rate (finer than proposal.decimals: a
                         thin drop divided by many workers lives below 0.01)
         minLootNeedsPerOp / promoteMax   a business that would end with no aimable
                         battle-loot need borrows up to promoteMax items from its own
                         craft list
         maxMinigameInputsPerOp  needs of ONE business that only exist if somebody
                         PLAYS another business's screen (farm, refinery). Each is a
                         standing chore for a supplier and the throttle takes the worst
                         one — round 2's first run gave the Restaurant five at once.
         minigameUnits   how many of the maker's production units (one ANIMAL on the
                         Homestead Farm) all new buyers of one farm good may lean on,
                         before madeShare. 1 = never more than half of one hen.
         allowUnmeasuredMakers  false = a good whose ONLY maker has no readable rate
                         table (the Cracking Yard's diesel / naphtha / butane) is LEFT
                         OUT. Round 3 sized them at a stand-in and put them on Transport;
                         a guess under a worst-need throttle can stop every lane.       */
    lootGate: {
      accept: ['always', 'drops', 'staples'],
      haulsPerWindow: 36,
      windowHours: 12,
      madeShare: 0.5,
      decimals: 3,
      minLootNeedsPerOp: 1,
      promoteMax: 2,
      maxMinigameInputsPerOp: 2,
      minigameUnits: 1,
      allowUnmeasuredMakers: false,
    },
  },

  /* ♿ FALLBACK (no WebGL / screen reader / cheap tests). */
  fallback: { columns: 3, minTileWidth: 220 },

  /* zIndex sits in the app's top band on purpose (the hub chrome reaches
     2147483296) but BELOW the two things the map itself opens through the
     bridge: `.toast` and gcConfirm's #gc-confirm-backdrop are both 2147483647
     in index.html. Raise this past them and a confirm opened from the map is
     invisible behind it — and unanswerable. */
  overlay: { id: 'sc-overlay', zIndex: 2147483400, deepLinkParam: 'supplychain', deepLinkDelayMs: 800 },

  /* 🔌 THE SEAM's own two knobs — the only part of sc.bridge.js that is an
     opinion rather than a reading of the game. Neither is an economy number.

     confirmTimeoutMs: `confirmAsync` is the ONE bridge member that returns a
     promise, and that makes it the one member that can be total in VALUE and
     still not total in TIME. A bridge whose `confirm` never settles (a dialog
     the player never answers, a legacy opener that forgets to resolve) hangs
     whoever awaited it forever; reproduced in Node, where an unsettled
     top-level await exits 13 with no message at all. So the wait has a
     ceiling and the timeout answers FALSE — an unanswered question is a "no",
     exactly like a missing bridge. Two minutes is deliberately far longer
     than a human takes to read a one-line confirm, so a real player who
     hesitates is never overruled by it. */
  bridge: { confirmTimeoutMs: 120000 },
});

export default SC;
