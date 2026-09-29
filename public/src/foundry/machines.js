/* ════════════════════════════════════════════════════════════════════════════
   ⚙️ THE FOUNDRY — machines. The hardware that runs recipes.js.
   ----------------------------------------------------------------------------
   Modelled on Black River Extraction (`OSIM_MACHINES`, index.html ~198727),
   which already proved the shape in this game: build from a parts/cost dict,
   level it, watch it wear, repair it. What is NEW here is that a Foundry machine
   does not have ONE hardcoded conversion — it takes a RECIPE. That is the
   deliberate answer to the open question RESOURCES_NEXT.md ends on:

     "Does CITY_PRODUCTION need a building per resource, or can one building
      take a recipe parameter? 40 producers is a lot of buildings; a generic
      'Refinery' that reads a recipe may be the better shape."

   It is the better shape. One `still` runs two different crude cuts; one
   `furnace` smelts ferrous OR non-ferrous. Eleven machines cover nineteen
   recipes, and the twentieth recipe costs a table row instead of a building.

   🔴 THE THREE PRESSURES. A converter with infinite uptime is a spreadsheet, not
   a factory. Every machine here is squeezed three ways, and all three are
   recoveries the player performs rather than walls they hit:
     • POWER    — capacity comes from the Powerhouse, which burns fuel YOU refined.
                  Short on power and everything runs at BROWNOUT_SPEED, the same
                  40% CITY_PRODUCTION uses for an unpowered building.
     • FUEL     — every converter burns fuel PER BATCH, on top of drawing grid
                  power. Sized so a running refinery clearly OUT-earns the line's
                  own consumption — fuel has to be a running cost you FEEL, not
                  one that eats the product.
                  ⚠ WHEN THE FOUNDRY'S RETURN DROPS, SUSPECT BUFFERS BEFORE
                  BURN RATES. A 24h run once measured 0.4x and ~139 net fuel for
                  a whole day, and cutting these rates by 60% moved it to 0.41x —
                  because the real cap was the Distillation Column's OUTPUT
                  BUFFER jamming at 280 units once its diesel stopped being sold.
                  Burn is a small line item next to backpressure; measure where
                  the units actually stop before retuning anything here. Heat is where it goes, so the amounts track the process
                  rather than the power draw: a Blast Furnace burns seven times
                  what a Magnetic Sorter does. A machine with no fuel to burn
                  halts on its own (HALT.NO_FUEL) — it does not take the line
                  down with it, because one starved furnace should not read as a
                  blackout.
                  ⚠ THIS IS A SECOND FUEL SINK ALONGSIDE THE POWERHOUSE, and
                  that is deliberate: the grid burns fuel to make electricity,
                  hot machines burn it for process heat. Together they are what
                  make the refinery line mandatory instead of merely profitable.
                  ⚠ BOOTSTRAP: a brand-new Foundry has no fuel and cannot refine
                  any, so the Supply Office sells diesel at a markup. Buying fuel
                  to burn is meant to be a bad deal you grow out of — if you ever
                  remove that contract, every new player deadlocks on turn one.
                  🔴 THE DISTILLATION COLUMN AND THE BIO-DIGESTER BURN NOTHING,
                  and that is a SAFETY VALVE, not an oversight. A first pass gave
                  every converter a burn rate and a 24h sim died: fuel dipped, the
                  Powerhouse went dark, the brownout halved every machine, the
                  still made even less fuel, and the line ended permanently dry
                  with no way back except spending Cinder on diesel. A machine
                  whose whole job is MAKING fuel must never be stoppable by the
                  lack of it, or the failure is unrecoverable by play. A real
                  column burns its own gas anyway, and leaving the digester free
                  keeps organic waste → biogas as a second route back from zero.
                  Any new fuel-producing machine inherits this rule.
     • WEAR     — condition drops PER BATCH COMPLETED, not per second (the
                  OSIM_DECAY_PER_UNIT precedent). Idle machines do not rot, so a
                  player is never punished for logging off.
                  ⚠ These rates are calibrated so a machine running FLAT OUT
                  wants a repair roughly once a day, not once an hour. The first
                  pass used CITY_PRODUCTION-sized numbers (1.6–3.0/batch) and a
                  headless 8h run broke the shredder inside fifty minutes — a
                  factory that is broken every time you open it is not a
                  pressure, it is a chore. Retune against a full-line sim, never
                  by eye.
     • BUFFERS  — a full output buffer HALTS the machine. production.data.js
                  warns that players read a stalled building as broken, so
                  state.js reports the halt reason and render.js must show it.
   ════════════════════════════════════════════════════════════════════════════ */

/* 🔌 An unpowered machine crawls rather than stopping. Stopping dead reads as
   "my factory is broken"; crawling reads as "I need another Powerhouse", which
   is the thought we actually want. Matches CITY_PRODUCTION's unpowered rule. */
export const BROWNOUT_SPEED = 0.4;

/* 🔴 ONE FUEL ORDER FOR THE WHOLE BUILDING, worst-value-first, and the Powerhouse
   uses the same list. Industrial Fuel is blended for burning and taps lowest, so
   it goes first; aviation fuel is absent entirely because burning a 2.4x tap in a
   furnace is lighting money on fire. Gasoline before diesel protects the
   Blender's input — see the note on the Powerhouse's `burns`. */
export const FUEL_ORDER = ['industrialFuel', 'naturalGasFuel', 'gasoline', 'diesel'];

/* 🔧 Condition. A machine at or below WORN runs slower; at 0 it stops entirely
   and must be repaired. The taper is what gives a player warning — a cliff at
   zero with no ramp means the first they hear of wear is a dead line. */
export const COND_WORN = 45;
export const COND_MIN_SPEED = 0.35;
export function conditionSpeed(cond) {
  const c = Math.max(0, Math.min(100, Number(cond) || 0));
  if (c <= 0) return 0;
  if (c >= COND_WORN) return 1;
  return COND_MIN_SPEED + (1 - COND_MIN_SPEED) * (c / COND_WORN);
}

/* 🎚 THE TRIM DIAL — one line-wide knob, 0 = tonnage, 1 = grade.
   This is the "set purity target 82%" control. It is deliberately a POSTURE for
   the whole line, not a per-machine setting: eleven separate sliders is a
   settings screen, one slider is a decision. Recipe variants (Fast Cycle vs
   Ferrous Bale) stay a separate axis because they are a ROUTE choice — which
   machine does what — rather than how hard you push whatever route you picked. */
export const TRIM_SPEED = [1.35, 0.70]; // at trim 0 → 1
export const TRIM_PURITY = [-0.12, 0.14];
const lerp = (a, b, t) => a + (b - a) * t;
export const trimSpeed = (trim) => lerp(TRIM_SPEED[0], TRIM_SPEED[1], Math.max(0, Math.min(1, Number(trim) || 0)));
export const trimPurity = (trim) => lerp(TRIM_PURITY[0], TRIM_PURITY[1], Math.max(0, Math.min(1, Number(trim) || 0)));

/* ⚙️ MACHINES.
     kind      — 'utility' grants capacity and yields nothing; 'converter' runs recipes.
     maxLevel  — level raises speed and buffer, never unlocks recipes. Recipes are
                 gated by MACHINE availability so the player's next goal is always
                 a visible piece of hardware, not a hidden threshold.
     power     — units of grid capacity consumed while running.
     wear      — condition points lost per BATCH completed.
     buffer    — output buffer units at level 1 (scales with level).
     cost[]    — per level. Live-ledger resources + cinder, priced through the
                 same grammar src/city/cost.js uses. ⚠ These literals are tuning
                 starting points, NOT an authority — the same caveat
                 production.data.js carries. If a _cityEcon()/_opEcon() path for
                 production ever lands, route these through it and delete this. */
export const MACHINES = [
  // ───────────────────────── UTILITIES ────────────────────────────────────
  {
    id: 'yard', name: 'Scrap Yard', kind: 'utility', emoji: '🏗️', accent: '#d4af37', line: 'crush',
    desc: 'Raises the Foundry stockpile ceiling. Every buffer in the yard shares it.',
    /* A full line holds six feedstocks plus ~15 process streams plus two waste
       liabilities. At 600/level the ceiling was 2,800, and a maxed sim run spent
       most of a 36h window unable to buy crude because waste and flux had
       already filled the yard — the refinery line simply never got fed.
       1,200/level puts the ceiling at 5,200, which fits a full line with room
       to actually run it. */
    maxLevel: 4, power: 0, wear: 0,
    effect: lv => ({ storage: 1200 * lv }),
    cost: [
      { cinder: 18000, metal: 40, stone: 30 },
      { cinder: 46000, metal: 95, stone: 70, wood: 40 },
      { cinder: 108000, metal: 210, stone: 160, supplies: 45 },
      { cinder: 240000, metal: 460, stone: 340, supplies: 110, memoryShards: 6 },
    ],
  },
  {
    id: 'powerhouse', name: 'Powerhouse', kind: 'utility', emoji: '⚡', accent: '#8affd6', line: 'refine',
    desc: 'Burns fuel you refined to power the line. This is the loop: trash makes fuel, fuel crushes trash.',
    maxLevel: 4, power: 0, wear: 0.03,
    /* 🔴 THE POWERHOUSE IS WHY THE REFINERY IS NOT OPTIONAL. Without it the
       crush line browns out at 40% forever. It burns a FOUNDRY fuel, not the
       live `fuel` resource — spending real Fuel to make fake Metal would just
       be a bad exchange rate wearing a factory costume. */
    /* Burn order is WORST FUEL FIRST, deliberately. Aviation fuel is absent from
       this list entirely — it taps at 2.4x and burning it would be lighting money
       on fire. Diesel and gasoline are here as the bootstrap: a brand new
       Foundry has nothing else, and a grid that refuses to start until you have
       already built the Blender is a grid that never starts. */
    burns: ['industrialFuel', 'naturalGasFuel', 'gasoline', 'diesel'],
    /* 🔴 UNITS OF EACH FUEL PER GRID-MINUTE. Not decoration — this is what makes
       the Blender worth building. Industrial Fuel is blended FOR the grid and
       burns 1:1; gasoline is a premium product being wasted in a boiler and
       burns at more than double the rate. Without an efficiency spread the
       Powerhouse was indifferent to what it ate, so the whole bio/blend branch
       existed only as a slightly different way to make sellable fuel.
       ⚠ GASOLINE IS BURNED BEFORE DIESEL ON PURPOSE, out of pure cost order.
       Diesel is an INPUT to blendIndustrial, and burning it first starved the
       Blender permanently in sim — the grid ate the feedstock of the fuel it
       most wanted. Protecting a downstream recipe's input beats saving a
       fraction of a unit an hour. */
    burnEff: { industrialFuel: 1.0, naturalGasFuel: 1.3, gasoline: 2.1, diesel: 1.7 },
    /* 🔴 0.25/min/level, AND THE MARGIN HERE IS THE WHOLE FEATURE.
       This was 1.0/min/level, which burned ~480 units over an 8h catch-up while
       a buffer-limited Distillation Column could only make ~456 — so the grid
       consumed more fuel than the refinery could produce and the loop could
       NEVER bootstrap. Every sim run ended at 0 fuel, 0 power, permanent
       brownout, no matter how well the player had built. A loop that cannot
       close is not a difficulty curve, it is a broken feature.
       Retune ONLY against a full-line sim that reaches "✅ POWERED", and keep
       generous headroom: the player must be able to run the grid AND still have
       fuel worth tapping, or the refinery line has no payoff of its own. */
    burnRate: 0.25,
    /* 180/level so a maxed Powerhouse (720) can actually carry the whole line
       (~576 with everything running). At 120/level the ceiling was 480 — below
       full demand — so a player who built everything was permanently browned
       out with no move left to make. */
    effect: lv => ({ power: 180 * lv }),
    cost: [
      { cinder: 34000, metal: 70, supplies: 40, fuel: 25 },
      { cinder: 82000, metal: 160, supplies: 95, fuel: 60 },
      { cinder: 190000, metal: 340, supplies: 200, fuel: 140 },
      { cinder: 420000, metal: 720, supplies: 430, fuel: 300, memoryShards: 10 },
    ],
  },

  // ───────────────────────── CRUSH LINE ───────────────────────────────────
  {
    id: 'shredder', name: 'Shredder', kind: 'converter', separator: true, emoji: '🌀', accent: '#8a8578', line: 'crush',
    desc: 'Mouth of the line. Bales in, shred out — nothing downstream runs without it.',
    maxLevel: 4, power: 28, wear: 0.05, burn: 0.03, buffer: 120,
    cost: [
      { cinder: 22000, metal: 55, stone: 25 },
      { cinder: 55000, metal: 130, stone: 60, supplies: 30 },
      { cinder: 130000, metal: 280, stone: 140, supplies: 80 },
      { cinder: 290000, metal: 600, stone: 300, supplies: 180, memoryShards: 5 },
    ],
  },
  {
    id: 'sorter', name: 'Magnetic Sorter', kind: 'converter', separator: true, emoji: '🧲', accent: '#9fb4d8', line: 'crush',
    desc: 'Splits shred four ways and lifts the grade. The single biggest purity gain in the yard.',
    maxLevel: 4, power: 34, wear: 0.04, burn: 0.02, buffer: 100,
    cost: [
      { cinder: 40000, metal: 95, supplies: 40, memoryShards: 2 },
      { cinder: 96000, metal: 215, supplies: 95, memoryShards: 5 },
      { cinder: 220000, metal: 450, supplies: 210, memoryShards: 11 },
      { cinder: 480000, metal: 950, supplies: 440, memoryShards: 24 },
    ],
  },
  {
    id: 'baler', name: 'Crusher / Baler', kind: 'converter', separator: true, emoji: '🗜️', accent: '#c2725a', line: 'crush',
    desc: 'The press itself. Ferrous stream in, dense scrap bales out.',
    maxLevel: 4, power: 42, wear: 0.11, burn: 0.05, buffer: 110,
    cost: [
      { cinder: 30000, metal: 80, stone: 40 },
      { cinder: 74000, metal: 185, stone: 95, supplies: 35 },
      { cinder: 172000, metal: 390, stone: 210, supplies: 95 },
      { cinder: 380000, metal: 830, stone: 450, supplies: 210, memoryShards: 7 },
    ],
  },
  {
    id: 'furnace', name: 'Blast Furnace', kind: 'converter', emoji: '🔥', accent: '#ff9a5a', line: 'crush',
    desc: 'Scrap and coke to pig iron. Runs hot, wears fast, drinks power.',
    maxLevel: 4, power: 72, wear: 0.15, burn: 0.16, buffer: 90,
    cost: [
      { cinder: 68000, metal: 170, stone: 110, fuel: 40 },
      { cinder: 160000, metal: 380, stone: 250, fuel: 95 },
      { cinder: 370000, metal: 800, stone: 540, fuel: 220, memoryShards: 8 },
      { cinder: 800000, metal: 1700, stone: 1150, fuel: 470, memoryShards: 18 },
    ],
  },
  {
    id: 'converter', name: 'Oxygen Converter', kind: 'converter', emoji: '🏗️', accent: '#c2725a', line: 'crush',
    desc: 'Pig iron plus flux becomes steel — the first output in the yard worth real Metal.',
    maxLevel: 4, power: 80, wear: 0.13, burn: 0.14, buffer: 80,
    cost: [
      { cinder: 95000, metal: 240, stone: 150, fuel: 60, memoryShards: 3 },
      { cinder: 225000, metal: 530, stone: 340, fuel: 140, memoryShards: 7 },
      { cinder: 520000, metal: 1120, stone: 730, fuel: 320, memoryShards: 15 },
      { cinder: 1120000, metal: 2400, stone: 1560, fuel: 690, memoryShards: 32 },
    ],
  },
  {
    id: 'mill', name: 'Rolling Mill', kind: 'converter', emoji: '📐', accent: '#9fb4d8', line: 'crush',
    desc: 'Steel to sheet. Best Metal-per-unit here — but only clean steel rolls without tearing.',
    maxLevel: 4, power: 66, wear: 0.10, burn: 0.08, buffer: 80,
    cost: [
      { cinder: 130000, metal: 320, supplies: 120, memoryShards: 5 },
      { cinder: 300000, metal: 700, supplies: 270, memoryShards: 11 },
      { cinder: 690000, metal: 1480, supplies: 580, memoryShards: 23 },
      { cinder: 1480000, metal: 3150, supplies: 1240, memoryShards: 48 },
    ],
  },
  {
    id: 'recycler', name: 'Recyclate Baler', kind: 'converter', separator: true, emoji: '♻️', accent: '#86e08a', line: 'crush',
    /* 🔴 THIS MACHINE EXISTS BECAUSE OF A STRUCTURAL JAM, NOT FOR VARIETY.
       The Magnetic Sorter emits FOUR streams, but a machine runs ONE recipe at a
       time — so with the Crusher set to ferrous bales (which is the only setting
       that makes steel, i.e. the only one anybody picks) plastics and cullet had
       no consumer at all. They piled into the sorter's own buffer and jammed it,
       which backpressured the shredder, which stalled the entire crush line. An
       8h sim run spent most of it halted for exactly this reason.
       Giving the reject streams their own press means all four sorter outputs
       drain in parallel and the sorter's power draw finally buys something.
       ⚠ Do not fold this back into the Crusher to save a table row. The jam is
       structural: any machine with more outputs than the line has consumers
       will deadlock upstream of itself. */
    desc: 'Presses the three streams the furnace will not take. Without it the Sorter jams on its own reject.',
    maxLevel: 3, power: 24, wear: 0.06, burn: 0.02, buffer: 110,
    cost: [
      { cinder: 26000, metal: 60, stone: 30, supplies: 25 },
      { cinder: 62000, metal: 140, stone: 70, supplies: 60 },
      { cinder: 145000, metal: 300, stone: 155, supplies: 135 },
    ],
  },
  {
    id: 'caster', name: 'Casting Line', kind: 'converter', emoji: '🪙', accent: '#c8b48a', line: 'crush', separator: false,
    /* The end of the metal road: everything that is going to become Metal ends
       up here as bar. Two recipes — a cheap direct melt from scrap, and the
       non-ferrous pool that pays the best rate in the building. See the note in
       recipes.js for why the short road has to stay the worse deal. */
    desc: 'Pours bar. The building\'s dedicated Metal source, and the best rate in the yard.',
    maxLevel: 4, power: 70, wear: 0.12, burn: 0.18, buffer: 85,
    cost: [
      { cinder: 110000, metal: 260, stone: 120, fuel: 70, memoryShards: 4 },
      { cinder: 258000, metal: 570, stone: 265, fuel: 160, memoryShards: 9 },
      { cinder: 595000, metal: 1200, stone: 570, fuel: 365, memoryShards: 19 },
      { cinder: 1285000, metal: 2560, stone: 1220, fuel: 785, memoryShards: 40 },
    ],
  },
  {
    id: 'ewaste', name: 'E-Waste Line', kind: 'converter', separator: true, emoji: '📟', accent: '#7fb8ff', line: 'crush',
    desc: 'Board stripping. The densest copper in the yard, at the slowest cycle.',
    maxLevel: 3, power: 38, wear: 0.07, burn: 0.02, buffer: 70,
    cost: [
      { cinder: 88000, metal: 190, supplies: 90, memoryShards: 6 },
      { cinder: 205000, metal: 420, supplies: 205, memoryShards: 14 },
      { cinder: 470000, metal: 890, supplies: 440, memoryShards: 30 },
    ],
  },

  // ───────────────────────── REFINERY LINE ────────────────────────────────
  {
    id: 'still', name: 'Distillation Column', kind: 'converter', emoji: '🫙', accent: '#ffcf6b', line: 'refine',
    desc: 'Crude in, three cuts out at once. You do not get to pick which.',
    maxLevel: 4, power: 58, wear: 0.09, burn: 0, buffer: 100,
    cost: [
      { cinder: 60000, metal: 150, supplies: 70, fuel: 35 },
      { cinder: 145000, metal: 330, supplies: 160, fuel: 85 },
      { cinder: 335000, metal: 700, supplies: 345, fuel: 195, memoryShards: 9 },
      { cinder: 725000, metal: 1490, supplies: 735, fuel: 420, memoryShards: 20 },
    ],
  },
  {
    id: 'cracker', name: 'Catalytic Cracker', kind: 'converter', emoji: '⚗️', accent: '#9ad17a', line: 'refine',
    desc: 'Turns heavy ends nobody wanted into aviation fuel everybody does. The best rate in the game.',
    maxLevel: 4, power: 92, wear: 0.12, burn: 0.12, buffer: 80,
    cost: [
      { cinder: 150000, metal: 360, supplies: 150, fuel: 90, memoryShards: 8 },
      { cinder: 345000, metal: 790, supplies: 340, fuel: 205, memoryShards: 17 },
      { cinder: 790000, metal: 1670, supplies: 720, fuel: 470, memoryShards: 36 },
      { cinder: 1690000, metal: 3550, supplies: 1540, fuel: 1010, memoryShards: 74 },
    ],
  },
  {
    id: 'digester', name: 'Bio-Digester', kind: 'converter', emoji: '🫧', accent: '#86e08a', line: 'refine',
    desc: 'Rot, captured. The route that makes your own organic trash worth burning.',
    maxLevel: 3, power: 30, wear: 0.05, burn: 0, buffer: 90,
    cost: [
      { cinder: 46000, metal: 100, wood: 60, water: 40 },
      { cinder: 110000, metal: 230, wood: 140, water: 95 },
      { cinder: 255000, metal: 490, wood: 300, water: 210, memoryShards: 6 },
    ],
  },
  {
    id: 'blender', name: 'Fuel Blender', kind: 'converter', emoji: '🧪', accent: '#d8a05a', line: 'refine',
    desc: 'Three streams into the fuel your own Powerhouse burns.',
    maxLevel: 3, power: 26, wear: 0.045, burn: 0.04, buffer: 90,
    cost: [
      { cinder: 72000, metal: 165, supplies: 80, fuel: 45 },
      { cinder: 170000, metal: 365, supplies: 180, fuel: 105 },
      { cinder: 390000, metal: 775, supplies: 385, fuel: 240, memoryShards: 9 },
    ],
  },
];

export const MACHINE_BY_ID = MACHINES.reduce((m, x) => { m[x.id] = x; return m; }, {});
export const machineById = (id) => MACHINE_BY_ID[id] || null;
export const machinesForLine = (line) => MACHINES.filter(m => m.line === line);

/* Level scaling. Speed and buffer both grow, so a levelled machine is faster AND
   less likely to choke the machine feeding it — levelling one stage in isolation
   should relieve a bottleneck, not just move it one slot down the line. */
export const levelSpeed = (lv) => 1 + 0.45 * Math.max(0, (lv | 0) - 1);
export const levelBuffer = (def, lv) => Math.round((def.buffer || 0) * (1 + 0.6 * Math.max(0, (lv | 0) - 1)));

/* ⏳ BUILD TIME — HOW WORTHY IS THIS THING?
   ────────────────────────────────────────────────────────────────────────────
   A machine takes time to put up, and the time comes from what it is WORTH, not
   from a hand-authored number per machine. Worth is the build cost valued at the
   game's OWN trader prices (index.html TRADER_DEFAULTS, ~line 76586) — so a
   Rolling Mill takes longer than a Shredder for the same reason it costs more,
   and the two can never drift apart when someone retunes a cost.

   🔴 WHY NOT JUST TIME EACH MACHINE BY HAND: seventeen build costs across four
   levels is 51 numbers; adding a hand-authored duration next to each makes 102,
   and the pair is exactly the kind of thing that desyncs silently when one gets
   edited. Deriving one from the other means there is only ever one number to
   change. This is the same argument cost.js makes for applying its economy dial
   at the single read site rather than baking it into the entries.

   ⚠ These are TRADER BUY prices, not sell. A machine is worth what it would cost
   you to acquire its materials, which is the buy side. Keep in step with the
   trader table; if those prices move, these should follow. */
export const WORTH_PRICE = {
  metal: 90, fuel: 110, supplies: 80, stone: 30, wood: 25, water: 35,
  memoryShards: 580, cloth: 30, food: 40, ammo: 70,
};
/* Cinder is counted at face value — it IS the currency, so it needs no price. */
export function costWorth(cost) {
  let w = 0;
  for (const k in (cost || {})) {
    const n = Math.max(0, cost[k] | 0);
    if (!n) continue;
    w += (k === 'cinder') ? n : n * (WORTH_PRICE[k] || 40);
  }
  return w;
}

/* The curve. REF is the cheapest thing in the catalogue (a level-1 Scrap Yard,
   ~22.5k of worth) and it takes BASE seconds; everything else scales from there.

   🔴 THE EXPONENT IS BELOW 1 ON PURPOSE. Worth spans ~100x across this
   catalogue (22.5k for a starter yard, ~2.29M for a level-4 Cracker). Linear
   scaling would make the last upgrade a 37-hour wait — longer than the game's
   own 36h accrual cap, so a player would lose production just for building. At
   0.88 the same span lands around an hour, which reads as "this is the big one"
   without turning it into a punishment.
   ⚠ MIN is 30s so even a trivial build is a decision you commit to rather than
   a button you spam; MAX is 6h so nothing can outlive the accrual window. */
export const BUILD_BASE_S = 55;
export const BUILD_REF_WORTH = 22500;
export const BUILD_EXP = 0.88;
export const BUILD_MIN_S = 30;
export const BUILD_MAX_S = 6 * 3600;

export function buildSeconds(cost) {
  const w = costWorth(cost);
  if (w <= 0) return BUILD_MIN_S;
  const secs = BUILD_BASE_S * Math.pow(w / BUILD_REF_WORTH, BUILD_EXP);
  return Math.round(Math.max(BUILD_MIN_S, Math.min(BUILD_MAX_S, secs)));
}

/* Human duration. Deliberately coarse above a minute — a player deciding whether
   to start a build wants "about 40 minutes", not "39m 12s", and a ticking
   seconds field on a one-hour build is just noise that forces a repaint. */
export function fmtDur(secs) {
  secs = Math.max(0, Math.round(secs));
  if (secs < 60) return secs + 's';
  if (secs < 3600) { const m = Math.round(secs / 60); return m + 'm'; }
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return m ? h + 'h ' + m + 'm' : h + 'h';
}

/* Repair. Priced off the machine's level-1 build cost so an expensive machine is
   expensive to keep alive, and charged pro-rata on the damage actually repaired
   — a player topping up a 90% machine must not pay the full-rebuild price. */
export const REPAIR_COST_FRAC = 0.18;
export function repairCost(def, cond) {
  const missing = Math.max(0, 100 - Math.max(0, Math.min(100, Number(cond) || 0))) / 100;
  const base = (def && def.cost && def.cost[0]) || {};
  const out = {};
  for (const k in base) {
    const n = Math.ceil((base[k] || 0) * REPAIR_COST_FRAC * missing);
    if (n > 0) out[k] = n;
  }
  return out;
}

export default {
  MACHINES, MACHINE_BY_ID, machineById, machinesForLine,
  costWorth, buildSeconds, fmtDur, WORTH_PRICE, FUEL_ORDER,
  BROWNOUT_SPEED, COND_WORN, conditionSpeed,
  trimSpeed, trimPurity, levelSpeed, levelBuffer, repairCost,
};
