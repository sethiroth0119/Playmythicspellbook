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
    maxLevel: 4, power: 28, wear: 0.05, buffer: 120,
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
    maxLevel: 4, power: 34, wear: 0.04, buffer: 100,
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
    maxLevel: 4, power: 42, wear: 0.11, buffer: 110,
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
    maxLevel: 4, power: 72, wear: 0.15, buffer: 90,
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
    maxLevel: 4, power: 80, wear: 0.13, buffer: 80,
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
    maxLevel: 4, power: 66, wear: 0.10, buffer: 80,
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
    maxLevel: 3, power: 24, wear: 0.06, buffer: 110,
    cost: [
      { cinder: 26000, metal: 60, stone: 30, supplies: 25 },
      { cinder: 62000, metal: 140, stone: 70, supplies: 60 },
      { cinder: 145000, metal: 300, stone: 155, supplies: 135 },
    ],
  },
  {
    id: 'ewaste', name: 'E-Waste Line', kind: 'converter', separator: true, emoji: '📟', accent: '#7fb8ff', line: 'crush',
    desc: 'Board stripping. The densest copper in the yard, at the slowest cycle.',
    maxLevel: 3, power: 38, wear: 0.07, buffer: 70,
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
    maxLevel: 4, power: 58, wear: 0.09, buffer: 100,
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
    maxLevel: 4, power: 92, wear: 0.12, buffer: 80,
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
    maxLevel: 3, power: 30, wear: 0.05, buffer: 90,
    cost: [
      { cinder: 46000, metal: 100, wood: 60, water: 40 },
      { cinder: 110000, metal: 230, wood: 140, water: 95 },
      { cinder: 255000, metal: 490, wood: 300, water: 210, memoryShards: 6 },
    ],
  },
  {
    id: 'blender', name: 'Fuel Blender', kind: 'converter', emoji: '🧪', accent: '#d8a05a', line: 'refine',
    desc: 'Three streams into the fuel your own Powerhouse burns.',
    maxLevel: 3, power: 26, wear: 0.045, buffer: 90,
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
  BROWNOUT_SPEED, COND_WORN, conditionSpeed,
  trimSpeed, trimPurity, levelSpeed, levelBuffer, repairCost,
};
