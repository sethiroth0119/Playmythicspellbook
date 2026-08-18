/* ══════════════════════════════════════════════════════════════════════════
   🚌 TRANSIT — THE TUNING TABLE.  Every number the transit layer uses is here.
   ──────────────────────────────────────────────────────────────────────────
   The `_opEcon()` habit (CLAUDE.md): one table, no literals downstream. If a
   figure appears in a mesh recipe, a button handler or a ridership formula it
   is a bug — put it here and read it from here.

   🔴 WHAT IS DELIBERATELY *NOT* IN THIS FILE: the two LICENCE PRICES.
   A Bus Company is 2,000,000 🔥 and a Rail Operator is 10,000,000 🔥, and those
   two numbers live in `OPS_ECON` in public/index.html — the one place operation
   pricing is allowed to live — where they are read through `_opEcon()` and are
   therefore reachable by the admin Operations Economy editor like every other
   business. node-city receives them over the ops bridge
   (`cityOpsState().catalog[].startup`). Copying them here would create a second
   source of truth for a price, which is exactly what CLAUDE.md forbids.

   💱 THE SCALE QUESTION, ANSWERED ONCE.
   node-city runs a divided economy: the design pack's 2,400,000 🔥 Stadium is
   ~1,200 ₵ of city Cinder (a ÷2,000 divisor). The user's 2M / 10M therefore
   cannot be city-Cinder building costs — at that divisor they would be a
   1,000 ₵ bus company, cheaper than a Cinder Trust. They sit naturally at the
   CORPORATE scale, where a Stadium *is* 2.4M and a Bank is 1M — so a Bus
   Company at 2M and a Rail Operator at 10M is a coherent ladder in exactly the
   table where a player already buys a Construction Co. That is where they went.
   What a player buys with CITY Cinder is the infrastructure (stops, stations,
   track), and those costs live in BUILDINGS with every other city building.
   ══════════════════════════════════════════════════════════════════════════ */

/* 🎨 The line palette. Eight, because a player needs to be able to tell two
   lines apart at city zoom and because a swatch grid of eight fits one row.
   Chosen for separation in the game's twilight grade, not for prettiness —
   the two greens are far enough apart to read as different lines on a road. */
export const LINE_COLORS = [
  { hex: 0xe2574c, name: 'Red' },
  { hex: 0xe08b32, name: 'Amber' },
  { hex: 0xd8c447, name: 'Gold' },
  { hex: 0x5fbf6a, name: 'Green' },
  { hex: 0x3fa9c9, name: 'Cyan' },
  { hex: 0x4f74d8, name: 'Blue' },
  { hex: 0x9b62d4, name: 'Violet' },
  { hex: 0xd469a6, name: 'Rose' },
];

export const TRANSIT_ECON = {
  /* ── the two modes ───────────────────────────────────────────────────────
     `runsOn` is the whole difference between them, and it is load-bearing:
     a bus walks the ROAD graph (bfsPath's default predicate), a train walks
     the TRACK graph the player lays. Everything else is a dial. */
  modes: {
    bus: {
      ico: '🚌', name: 'Bus', vehicleWord: 'bus', pluralWord: 'buses',
      stopType: 'busstop', licence: 'bus', runsOn: 'road',
      speed: 0.62,            // tiles/sec — a shade under AGENTS.truckSpeed
      dwellSec: 2.4,          // how long it sits at a stop
      seats: 26,              // riders one vehicle carries per city-hour
      stopsPerVehicle: 2.2,   // one bus per N stops on the line
      maxVehicles: 6,
      minStops: 2,
    },
    rail: {
      ico: '🚆', name: 'Train', vehicleWord: 'train', pluralWord: 'trains',
      stopType: 'trainstation', licence: 'rail', runsOn: 'track',
      speed: 1.05,
      dwellSec: 3.6,
      seats: 150,
      stopsPerVehicle: 2.0,
      maxVehicles: 4,
      minStops: 2,
    },
  },

  /* 🚶 How far a citizen will walk to a stop, in Chebyshev tiles. 2 means a
     stop covers the 5x5 block centred on it. This is the single dial that
     decides whether transit feels generous or fiddly — CS2's is about the same
     in relative terms (a stop serves its block and the one behind it). */
  walkRadius: 2,

  /* 🚏 THE RIDERSHIP MODEL, and its honest limitation.
     A line only carries anybody if it touches BOTH ends of a commute, so its
     mode share is min(share of the city's homes it reaches, share of the jobs).
     `demand` is that share of the citizenry; `capacity` is seats × vehicles.
     Riders is the smaller — which is why adding a seventh stop to a line with
     one bus does nothing, and why that is the correct answer.
     ⚠ tripsPerCitizen is per CITY-HOUR, matching the Cinder period. */
  tripsPerCitizen: 1.0,
  /* Nobody's whole city rides the bus. Even Zurich is ~65%, and leaving this
     uncapped let a dense grid of stops delete every private car on the map,
     which reads as a bug rather than as good planning. */
  maxModeShare: 0.65,

  /* 💰 FARES AND UPKEEP — in the same per-minute units every `gen:{cinder}`
     figure in BUILDINGS uses, i.e. DIVIDED BY 60 on the way out by cinderRate()
     (see node-city's CINDER_PERIOD_DIV note). A Shop earns 0.18 in these units,
     so one bus at 0.08 costs about half a shop's takings to run.

     🔴 TRANSIT CAN NEVER NET POSITIVE. `net = min(0, fares − upkeep)`, enforced
        in sim.js. A public transport network that PAYS you is a Cinder faucet
        with a paint job, and this file has a retired Cinder Forge in its history
        to prove how that ends. Fares are a SUBSIDY REDUCTION: run the line well
        and it costs you almost nothing; run empty buses round an industrial
        estate and you pay for every one of them. */
  farePerRider: 0.0075,
  upkeep: {
    busstop: 0.02,
    trainstation: 0.10,
    railtrack: 0.004,
    busVehicle: 0.08,
    trainVehicle: 0.30,
  },

  /* 🗺 The map overlay. A ribbon of flat plates down the middle of the route,
     capped so a pathological 400-tile loop cannot add 400 meshes to a scene
     that already draws ~1,700. */
  overlay: { y: 0.055, width: 0.085, maxSegments: 260 },

  /* 🚶 JOB ACCESS — THE ONE PLACE TRANSIT REACHES THE CITIZEN SIMULATION.
     ────────────────────────────────────────────────────────────────────────
     🔴 READ THIS BEFORE CHANGING EITHER NUMBER. Until this block existed the
     whole feature was DECORATION at citizen level, and that was MEASURED, not
     suspected: the same city run 400 city-minutes with a six-stop bus line and
     then again with the line deleted (.gauntlet/drive-transit-effect.js,
     Math.random re-seeded identically for both arms) came back with employment,
     vacancies, unemployment, labour force, firm count, satisfaction, coverage,
     vitals, demographic attractiveness and net migration IDENTICAL TO THE
     DIGIT. The only things that moved were the car mesh count (8 → 5), the
     ridership readout and the Cinder bill. A network you pay for that changes
     nothing about the people is a paint job.

     So: A JOB NOBODY CAN GET TO GOES UNFILLED. `routes.jobAccess()` scores the
     city's jobs, crew-weighted, into three buckets and /src/demographics scales
     the labour ladder it hands `households.hire()` by the result:

       WALKABLE   a job within `walkRadius` of housing. Always staffable, and
                  it is the SAME radius a stop's catchment uses — one distance
                  for "a citizen will cross this much city on foot", stated
                  once, so a compact city is unaffected by any of this forever.
       DRIVEABLE  of what is left, `carAccess` is reachable by private car. The
                  cars are already in the sim (`desiredAgentCounts().car`), so
                  this is not an invention — it is the mode the city already has.
       STRANDED   the rest. A transit line that reaches BOTH ends of the commute
                  recovers them, in proportion to the mode share it actually
                  carries — which means seats and running vehicles, not stops.

     ⚠ THE WORST CASE IS BOUNDED AND THAT IS DELIBERATE. With every job out of
       walking range and no transit, hiring is capped at `carAccess` — a 15%
       haircut, not a dead city. An employment gate that can reach zero would
       let one badly-placed industrial estate starve a working city, and this
       feature is not allowed to be that important.
     ⚠ AND THE FLOOR IS NEVER LOWERED BY BUILDING A BUS. `access` is monotonic
       in mode share: running a line can only ever raise it. Deleting one puts
       the city back exactly where it was, never below.
     ⚠ 0.85 IS A STATED ASSUMPTION, NOT A MEASUREMENT. It says "roughly one
       commuter in seven cannot drive to a job on the far side of town" — the
       carless, the ones the road network does not actually join up. It is the
       one number in this block a retune should touch. */
  commute: {
    carAccess: 0.85,
  },

  /* 🧍 COMMUTE BIASING. When a line is running, this fraction of the mode share
     is expressed as pedestrians actually walking to and from stops rather than
     to and from arbitrary roads — which is the visible half of "the NPCs use
     it". 1.0 would send every served citizen to a stop and empty the rest of
     the pavements, so it is deliberately partial. */
  walkToStopShare: 0.7,
};

export const MODE_IDS = Object.keys(TRANSIT_ECON.modes);
