/* ════════════════════════════════════════════════════════════════════════════
   ⚡ POWER — THE TUNING TABLE. Every number the grid model uses lives here.
   ----------------------------------------------------------------------------
   CLAUDE.md: "All operation pricing goes through `_opEcon()`. Never hardcode
   economy numbers." /src/economy states the same rule as "all economy numbers
   live in ECON (tuning.js)". This file is the power system's ECON, and the rest
   of /src/power reads POWER rather than writing a literal.

   🔴 THE TWO NUMBERS THAT ARE NOT OURS TO OWN.
   `POWER_FLOOR` (0.5) and `DEMAND_PER_POP.power` (0.0625) are declared in
   node-city/index.html and are read by the coverage system, the vitals panel and
   the away report as well as by us. Copying either one here would create a
   second truth about brownouts that drifts the first time somebody retunes the
   host — the exact failure this integration exists to prevent. They arrive in
   the host snapshot instead (`host.floor`, `host.perPop`) and are NEVER given a
   default in this file. If they are missing the solve says so out loud.
   ════════════════════════════════════════════════════════════════════════════ */

export const POWER = {

  /* ── UNITS ────────────────────────────────────────────────────────────────
     node-city prices power as an abstract "per minute" quantity: a Power
     Station declares `gen: { power: 6.0 }` and a Machine Shop `powerNeed: 0.7`.
     Those are the numbers the build panel and the dossier already print, so
     they stay the model's internal unit and nothing here rescales them.

     `unitKW` exists purely so the PANEL can speak electricity. The CS2 reference
     is deliberately honest about mixed magnitudes — "Consumption: 75.3 kW"
     against "Production: 40 MW", so the player reads the headroom before they
     read either number — and that only works if the unit floats. 250 kW per
     unit/min puts one Power Station at 1.5 MW and a Street Light at 12.5 kW,
     which are recognisable magnitudes for what those buildings are.
     ⚠ COSMETIC ONLY. No simulation result may depend on unitKW; it is applied
       at format time in panel.js and nowhere else. */
  unitKW: 250,

  /* ── STORAGE ──────────────────────────────────────────────────────────────
     The grid module owns transmission and storage; the host owns generation.

     Capacity is expressed in UNIT-MINUTES — "how many minutes of one unit of
     draw" — because that is the unit the rest of the model is already in, and
     converting to kWh at the boundary (panel.js) keeps one conversion in one
     place. 45 unit-min is 187.5 kWh at the rate above, and lets a single plant
     carry its own 6.0/min output for seven and a half minutes.

     ⚠ perPlant, NOT a building. node-city has exactly one generator type
       (`powerstation`), whose own blueprint text reads "Turbine hall, cooling
       stack, transformer yard". A transformer yard is where a grid buffer
       physically lives, so the buffer rides on the plant rather than arriving as
       a new BUILDINGS row. Adding a building type would have been a large edit
       to a file three other workflows are editing this round — see index.js's
       header for the full list of what was deliberately not touched.
     🚫 REJECTED: a flat city-wide buffer independent of plant count. It made the
        first Power Station the only one worth building, because the buffer — not
        the turbines — was carrying the peaks. */
  storage: {
    perPlantUnitMin: 45,
    // Round-trip efficiency. Charging banks 92% of the surplus offered; the
    // other 8% is the loss that makes overbuilding genuinely wasteful rather
    // than merely unnecessary.
    chargeEff: 0.92,
    // A plant will only divert surplus to the buffer once the city is actually
    // in surplus by this margin, so a grid sitting exactly at parity does not
    // oscillate charge/discharge every tick.
    chargeAboveRatio: 1.05,
    // Discharge is capped per minute so a full buffer cannot hide a permanent
    // generation shortfall for an entire session — it smooths peaks, it does
    // not replace a turbine.
    dischargePerMinPerPlant: 3.0,
  },

  /* ── TRANSMISSION ─────────────────────────────────────────────────────────
     Cables run with the roads. That is not a metaphor: node-city already models
     a road as the thing that connects a building to the city, `isRoad`/`NEI`
     already exist, and the reference's own legend separates "Low Voltage
     Electric Cables" from "High Voltage Power Lines" as NETWORK colours — i.e.
     as something drawn along a network the city already has.

     🔴 `enforce` IS OFF, ON PURPOSE, AND THIS IS THE MOST IMPORTANT LINE IN THE
        FILE. Today's host charges brownout from a pure supply/demand ratio and
        ignores topology completely. Turning topology into a production gate
        would retroactively black out every building in every EXISTING SAVE that
        happens to sit off the powered road component — a silent, unannounced
        balance break landing on cities the player already built, which the
        save-compatibility constraint forbids. So connectivity is DIAGNOSTIC:
        it drives the overlay, the bottleneck colour and the panel's "unserved"
        advisory, and it does not touch `factor`. Flipping this to true is a
        deliberate, announced balance round — one number, right here.

     ⚠ AND IT GOVERNS LINE LOSS TOO, for exactly the same reason. Loss is a
       DEMAND term: charging it raises consumption a few per cent, which is
       enough to tip a city that sits just above parity today into a brownout it
       did not have yesterday. That is the same silent retroactive re-balance,
       just smaller, and "smaller" is not a defence. So while `enforce` is false
       the loss figure is COMPUTED and REPORTED — the panel prints what it would
       cost — and is not added to load. One flag, one meaning: "does
       transmission affect the simulation, or only the info view".
     ⚠ Anything reading this flag must degrade to "ratio only" when it is false;
       grid.js branches on it in exactly one place, in solve(). */
  transmission: {
    enforce: false,
    // A road tile's cable rating, in draw units. Any segment carrying more than
    // this is a BOTTLENECK — the reference's whole diagnostic argument is that a
    // single availability number can never say WHERE the grid is choking.
    lvRating: 4.0,
    // Segments carrying at least this much are drawn as HIGH VOLTAGE trunk. A
    // trunk is not a different cable the player buys; it is the part of the same
    // network that has aggregated enough load to read as one.
    hvThreshold: 6.0,
    // …as is every segment within this many hops of a plant, so a plant always
    // leaves on trunk even in a city too small to have aggregated anything yet.
    trunkHops: 2,
    // HV carries more before it chokes.
    hvRating: 18.0,
    // Resistive loss per hop, as a fraction of the draw carried. Small, but it
    // is what makes a plant near its load genuinely better than a plant in the
    // corner — and it is a real term in the causal list rather than a fudge.
    lossPerHop: 0.004,
    // Loss is capped however long the run: beyond this the model is no longer
    // saying anything true about a 24-tile city.
    lossMax: 0.12,
  },

  /* ── THE CAUSAL LIST ──────────────────────────────────────────────────────
     BAR.md rubric dimension 12: state reads "as a meter with a signed causal
     list, not a raw number". These bound that list so a 60-building city does
     not print sixty rows and stop being readable. */
  causes: {
    maxRows: 7,
    // A contributor smaller than this share of the total is folded into the
    // "…and N smaller" row rather than printed. Keeps the list honest — the
    // total is always exact even when the list is abbreviated, the same rule
    // node-city's own away report states for its leaver list.
    minShare: 0.02,
  },

  /* ── METERS ───────────────────────────────────────────────────────────────
     Where red becomes amber becomes green on each bar, as a fraction of the
     bar. The reference's read is "state before number": availability far right
     is a comfortable margin, mid-bar is balanced.

     availability is plotted as supply/demand normalised so that:
       ratio 0   -> 0.00   (blackout)
       ratio 1   -> 0.55   (exactly met — amber/green boundary, no headroom)
       ratio 2+  -> 1.00   (double the demand — the reference's far-right marker)
     Anything past 2x is clamped, because a city with 10x headroom is not ten
     times healthier, it is nine plants of waste. */
  meters: {
    availability: { red: 0.30, amber: 0.55, ratioFull: 2.0 },
    // Reserve margin: (capacity - load) / capacity. Under 5% is red (no
    // contingency), 5–15% amber, over 15% green. Past `wasteAbove` the panel
    // adds a "− overbuilt" cause rather than colouring the bar differently —
    // two opposite meanings on one gradient is exactly the confusion the
    // reference avoids.
    reserve: { red: 0.05, amber: 0.15, wasteAbove: 0.60 },
    battery: { red: 0.15, amber: 0.40 },
  },

  /* ── OVERLAY ──────────────────────────────────────────────────────────────
     🔴 PERFORMANCE. The city already renders ~1,700 meshes / ~2M triangles, and
     a 24x24 overlay must not be 576 meshes. It is ONE mesh: a single plane
     carrying a single CanvasTexture that every enabled layer paints into. Cost
     is one draw call and one texture upload, and only when a layer actually
     changes — see overlay.js's repaint gate. */
  overlay: {
    // Texture pixels per tile. 24 tiles x 24 px = 576px square, which is a
    // trivial upload and still resolves a painted road centre-line.
    px: 24,
    // Height above the ground plane. Low enough to read as paint on the
    // terrain, high enough to beat z-fighting with the road slabs.
    y: 0.06,
    opacity: 0.78,
  },

  /* ── COLOURS ──────────────────────────────────────────────────────────────
     node-city's own dark language, not CS2's skin. The reference's information
     design is what is being matched; its palette is not.
     ⚠ Every ramp is stated low->high so overlay.js can interpolate generically
       and the panel's legend swatch strip is generated from the SAME array —
       a legend that is hand-written beside the ramp it describes is a legend
       that goes stale, which is how a key stops matching the map. */
  col: {
    plant:       '#4fd8e8',   // cyan   — power plants
    transformer: '#5fe08a',   // green  — step-down points
    battery:     '#b79cf0',   // lilac  — storage
    lv:          '#ffd24a',   // yellow — low voltage
    lvFlow:      '#fff2b0',   // pale yellow
    lvChoke:     '#ff5a4d',   // red
    hv:          '#4fd8e8',   // cyan
    hvFlow:      '#a8f0f8',
    hvChoke:     '#ff5ad8',   // magenta
    unserved:    '#8a8f98',   // grey — connected to nothing
    // Consumption ramp, pale -> yellow -> orange -> red.
    demandRamp: ['#e8e2c8', '#ffe066', '#ff9d3d', '#ff4d3d'],
    // Wind ramp, pale -> amber (only drawn when a pollution module supplies it).
    windRamp:   ['#e8e2c8', '#ffc14d'],
    // Groundwater, pale -> blue; surface flow, pale -> white-blue. Same caveat.
    groundRamp: ['#dfe7ee', '#3d8fd8'],
    surfaceRamp:['#e6f2f5', '#9fe8f5'],
  },
};

/* Read a POWER path with a loud failure instead of `undefined` arithmetic.
   Same shape as /src/economy's `econ()`: a mistyped path is a bug that should
   surface at the call site, not become NaN four frames later. */
export function pw(path, fallback) {
  let cur = POWER;
  for (const seg of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) {
      if (fallback !== undefined) return fallback;
      try { console.warn('[power] no tuning at POWER.' + path); } catch (e) {}
      return undefined;
    }
    cur = cur[seg];
  }
  return cur;
}
