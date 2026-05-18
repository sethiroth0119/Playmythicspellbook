/* eslint-disable */
// data.jsx — game state: rooms, alerts, survivors, resources
// Exposed to window so other Babel scripts can read it.

const ROOMS = [
  // Row 1 — surface tier
  {
    id: "CMD-01", slot: 0, code: "C/01", name: "Command Center", tier: "SURFACE",
    depth: -12, level: 4, levelMax: 6,
    status: "ok", workers: { on: 4, max: 4 },
    art: "command", glow: "var(--bronze)",
    output: { label: "TACTICAL OPS", value: "4", unit: "actions/turn", tone: "bronze" },
    secondary: { label: "INTEL", value: "+12", unit: "/cycle", tone: "bronze" },
    crew: [
      { i: "VK", n: "V. Karras",      role: "Commander", st: "ON DUTY" },
      { i: "ML", n: "M. Lim",         role: "Comms",     st: "ON DUTY" },
      { i: "RD", n: "R. Doss",        role: "Analyst",   st: "ON DUTY" },
      { i: "AT", n: "A. Toma",        role: "Cartog.",   st: "FATIGUED" },
    ],
    upgrade: [
      { t: "MK I",   d: "Radio mast — 3 ops/turn" },
      { t: "MK II",  d: "Recon drones unlocked" },
      { t: "MK III", d: "Encrypted comms, +1 op" },
      { t: "MK IV",  d: "Sat. uplink, fog reveal", cur: true },
      { t: "MK V",   d: "Strategic AI co-pilot" },
      { t: "MK VI",  d: "Predictive ops queue" },
    ],
    lore: "All authority flows through this room. We don't argue here — we decide.",
    cost: { scrap: 280, power: 6, time: "2d 04h" }
  },
  {
    id: "BRK-01", slot: 1, code: "B/01", name: "Survivor Barracks", tier: "SURFACE",
    depth: -14, level: 3, levelMax: 6,
    status: "warn", workers: { on: 3, max: 6 },
    art: "barracks", glow: "var(--bronze)",
    output: { label: "HOUSED", value: "18", unit: "/24 bunks", tone: "bronze" },
    secondary: { label: "MORALE", value: "62%", unit: "low", tone: "amber" },
    progress: 0.42,
    crew: [
      { i: "EJ", n: "E. Joon",        role: "Quartermaster", st: "ON DUTY" },
      { i: "SM", n: "S. Marquez",     role: "Bunk Capt.",    st: "ON DUTY" },
      { i: "PH", n: "P. Han",         role: "Cook",          st: "ON DUTY" },
      { i: "??", n: "Open Slot",      role: "—",             st: "VACANT", empty: true },
    ],
    upgrade: [
      { t: "MK I",   d: "12 bunks, basic kit" },
      { t: "MK II",  d: "24 bunks, lockers, +morale" },
      { t: "MK III", d: "Showers, mess hall", cur: true },
      { t: "MK IV",  d: "Private quarters tier" },
      { t: "MK V",   d: "Rec room, +20% morale" },
      { t: "MK VI",  d: "Family wing — civilians" },
    ],
    lore: "Bunks for 24. Three shift in, three shift out. No one sleeps alone here.",
    cost: { scrap: 180, power: 3, time: "1d 12h" }
  },
  {
    id: "MED-01", slot: 2, code: "M/01", name: "Medical Bay", tier: "SURFACE",
    depth: -14, level: 2, levelMax: 6,
    status: "ok", workers: { on: 2, max: 3 },
    art: "medical", glow: "var(--blue)",
    output: { label: "PATIENTS", value: "3", unit: "stable", tone: "green" },
    secondary: { label: "MEDS", value: "47", unit: "doses", tone: "blue" },
    crew: [
      { i: "DR", n: "Dr. Reva",       role: "Surgeon",   st: "ON DUTY" },
      { i: "NK", n: "N. Kovac",       role: "Nurse",     st: "ON DUTY" },
      { i: "??", n: "Open Slot",      role: "Medic",     st: "VACANT", empty: true },
    ],
    upgrade: [
      { t: "MK I",   d: "Field cot, gauze, prayers" },
      { t: "MK II",  d: "Operating table, +heal", cur: true },
      { t: "MK III", d: "Diagnostic scanner" },
      { t: "MK IV",  d: "Cryo-stasis revive bay" },
      { t: "MK V",   d: "Gene-therapy unlock" },
      { t: "MK VI",  d: "Trauma surgeon-AI" },
    ],
    lore: "We patch them up. We don't promise to send them home — there is no home.",
    cost: { scrap: 220, power: 4, time: "1d 22h" }
  },

  // Row 2 — mid tier
  {
    id: "AIL-01", slot: 3, code: "A/01", name: "AI Lab", tier: "MID",
    depth: -38, level: 5, levelMax: 6,
    status: "ok", workers: { on: 3, max: 3 },
    art: "ai", glow: "var(--blue)",
    output: { label: "CYCLES", value: "847", unit: "tflops", tone: "blue" },
    secondary: { label: "ATHENA", value: "98.4%", unit: "stable", tone: "green" },
    crew: [
      { i: "IK", n: "Dr. I. Kade",    role: "Lead Engineer", st: "ON DUTY" },
      { i: "OW", n: "O. Wen",         role: "Data Sci.",     st: "ON DUTY" },
      { i: "TR", n: "T. Rios",        role: "Cooling Tech",  st: "FATIGUED" },
    ],
    upgrade: [
      { t: "MK I",   d: "Salvaged compute rig" },
      { t: "MK II",  d: "Liquid-cooled cluster" },
      { t: "MK III", d: "Recovered ATHENA core" },
      { t: "MK IV",  d: "Distributed inference" },
      { t: "MK V",   d: "Predictive threat model", cur: true },
      { t: "MK VI",  d: "Full sentience — locked" },
    ],
    lore: "She remembers things she shouldn't. Sometimes she answers questions we never asked.",
    cost: { scrap: 420, power: 18, time: "3d 06h" }
  },
  {
    id: "FRG-01", slot: 4, code: "F/01", name: "Card Forge", tier: "MID",
    depth: -40, level: 3, levelMax: 6,
    status: "build", workers: { on: 2, max: 4 },
    art: "forge", glow: "var(--purple)",
    output: { label: "CARDS", value: "12", unit: "stock", tone: "purple" },
    secondary: { label: "RELIC FUEL", value: "284", unit: "/ 500", tone: "purple" },
    progress: 0.68,
    crew: [
      { i: "BM", n: "B. Mavric",      role: "Forgemaster",  st: "ON DUTY" },
      { i: "LN", n: "L. Nin",         role: "Engraver",     st: "ON DUTY" },
      { i: "??", n: "Open Slot",      role: "Apprentice",   st: "VACANT", empty: true },
      { i: "??", n: "Open Slot",      role: "Apprentice",   st: "VACANT", empty: true },
    ],
    upgrade: [
      { t: "MK I",   d: "Common-tier forge" },
      { t: "MK II",  d: "Uncommon-tier glyphs" },
      { t: "MK III", d: "Rare cards, relic infusion", cur: true },
      { t: "MK IV",  d: "Epic-tier, double crit" },
      { t: "MK V",   d: "Legendary forge — myth" },
      { t: "MK VI",  d: "Singular forge — unique" },
    ],
    lore: "Steel for the body, glyphs for the soul. Each card costs a piece of the relic — and of the forger.",
    cost: { scrap: 360, power: 12, time: "2d 18h" }
  },
  {
    id: "TRN-01", slot: 5, code: "T/01", name: "Training Hall", tier: "MID",
    depth: -40, level: 3, levelMax: 6,
    status: "ok", workers: { on: 4, max: 5 },
    art: "training", glow: "var(--bronze)",
    output: { label: "XP/CYCLE", value: "+42", unit: "shared", tone: "bronze" },
    secondary: { label: "RECRUITS", value: "5", unit: "in drill", tone: "bronze" },
    crew: [
      { i: "GV", n: "G. Voss",        role: "Drillmaster", st: "ON DUTY" },
      { i: "KP", n: "K. Pell",        role: "Trainer",     st: "ON DUTY" },
      { i: "JX", n: "J. Xian",        role: "Sparring",    st: "ON DUTY" },
      { i: "AM", n: "A. Mori",        role: "Recruit",     st: "TRAINING" },
      { i: "??", n: "Open Slot",      role: "Recruit",     st: "VACANT", empty: true },
    ],
    upgrade: [
      { t: "MK I",   d: "Mats, dummies, basic kit" },
      { t: "MK II",  d: "Live-fire range" },
      { t: "MK III", d: "Holo-sim opponents", cur: true },
      { t: "MK IV",  d: "Specialist tracks unlocked" },
      { t: "MK V",   d: "Veteran's instinct bonus" },
      { t: "MK VI",  d: "Champion's tier — +crit" },
    ],
    lore: "Wood splinters. Bones heal. Memory doesn't — so we train until it does.",
    cost: { scrap: 200, power: 5, time: "1d 16h" }
  },

  // Row 3 — deep tier
  {
    id: "RCT-01", slot: 6, code: "R/01", name: "Power Reactor", tier: "DEEP",
    depth: -68, level: 4, levelMax: 6,
    status: "warn", workers: { on: 2, max: 3 },
    art: "reactor", glow: "var(--purple)",
    output: { label: "OUTPUT", value: "82", unit: "MW", tone: "purple" },
    secondary: { label: "COOLANT", value: "71%", unit: "warning", tone: "amber" },
    crew: [
      { i: "ZK", n: "Z. Kostas",      role: "Reactor Chief", st: "ON DUTY" },
      { i: "FE", n: "F. Engel",       role: "Coolant Op.",   st: "ON DUTY" },
      { i: "??", n: "Open Slot",      role: "Safety Officer",st: "VACANT", empty: true },
    ],
    upgrade: [
      { t: "MK I",   d: "Diesel gen — 12 MW" },
      { t: "MK II",  d: "Salvaged fission core" },
      { t: "MK III", d: "Twin loop, redundancy" },
      { t: "MK IV",  d: "Relic-infused regulator", cur: true },
      { t: "MK V",   d: "Cold-fusion stabilizer" },
      { t: "MK VI",  d: "Zero-point tap — myth" },
    ],
    lore: "Without her, we go dark. Without us, she goes critical. Mutual hostage situation.",
    cost: { scrap: 500, power: -24, time: "4d 12h" }
  },
  {
    id: "CNT-01", slot: 7, code: "X/01", name: "Containment", tier: "DEEP",
    depth: -72, level: 2, levelMax: 6,
    status: "crit", workers: { on: 1, max: 4 },
    art: "containment", glow: "var(--red)",
    output: { label: "SUBJECTS", value: "1", unit: "active", tone: "red" },
    secondary: { label: "BREACH RISK", value: "11.4%", unit: "rising", tone: "red" },
    progress: 0.88,
    crew: [
      { i: "DC", n: "Dr. Chen",       role: "Containment Lead", st: "ON DUTY" },
      { i: "??", n: "Open Slot",      role: "Observer",         st: "VACANT", empty: true },
      { i: "??", n: "Open Slot",      role: "Security",         st: "VACANT", empty: true },
      { i: "??", n: "Open Slot",      role: "Backup",           st: "VACANT", empty: true },
    ],
    upgrade: [
      { t: "MK I",   d: "Reinforced cage" },
      { t: "MK II",  d: "Energy lattice prison", cur: true },
      { t: "MK III", d: "Dampening field + obs." },
      { t: "MK IV",  d: "Phase-locked stasis" },
      { t: "MK V",   d: "Anti-cognitive baffles" },
      { t: "MK VI",  d: "Reality anchor — myth" },
    ],
    lore: "It hasn't moved in 31 days. The cage hasn't either. We are not sure which of those is more concerning.",
    cost: { scrap: 600, power: 14, time: "5d 02h" }
  },
  {
    id: "VLT-01", slot: 8, code: "V/01", name: "Relic Vault", tier: "DEEP",
    depth: -72, level: 4, levelMax: 6,
    status: "ok", workers: { on: 2, max: 3 },
    art: "vault", glow: "var(--purple)",
    output: { label: "RELICS", value: "23", unit: "vaulted", tone: "purple" },
    secondary: { label: "RESONANCE", value: "+0.3", unit: "Hz", tone: "purple" },
    crew: [
      { i: "AV", n: "A. Voss",        role: "Vault Warden", st: "ON DUTY" },
      { i: "TM", n: "T. Marek",       role: "Cataloguer",   st: "ON DUTY" },
      { i: "??", n: "Open Slot",      role: "Researcher",   st: "VACANT", empty: true },
    ],
    upgrade: [
      { t: "MK I",   d: "Locked steel cabinet" },
      { t: "MK II",  d: "Mag-sealed compartments" },
      { t: "MK III", d: "Energy lattice barriers" },
      { t: "MK IV",  d: "Resonance dampeners", cur: true },
      { t: "MK V",   d: "Cross-dimensional locks" },
      { t: "MK VI",  d: "Time-stasis archive" },
    ],
    lore: "The relics whisper. We keep them sorted by which language they whisper in.",
    cost: { scrap: 420, power: 8, time: "3d 08h" }
  },
];

const ALERTS = [
  { sev: "crit", time: "00:14", body: "Containment field <em>11.4%</em> breach risk — subject restless." },
  { sev: "warn", time: "00:42", body: "Reactor coolant at <em>71%</em>. Maintenance crew requested." },
  { sev: "warn", time: "01:08", body: "Card Forge build <em>68%</em>. ETA 2d 18h." },
  { sev: "info", time: "01:21", body: "Scout team <em>RAVEN-2</em> returned. 3 survivors recovered." },
  { sev: "info", time: "01:33", body: "ATHENA flagged anomaly in sector <em>NE-04</em>." },
  { sev: "warn", time: "02:02", body: "Barracks morale dipping. Rec-room proposal queued." },
];

const ROSTER = [
  { i: "VK", n: "V. Karras",   t: "CMD",   state: "on"  },
  { i: "IK", n: "Dr. I. Kade", t: "AI",    state: "on"  },
  { i: "BM", n: "B. Mavric",   t: "FRG",   state: "on"  },
  { i: "DC", n: "Dr. Chen",    t: "CNT",   state: "busy"},
  { i: "ZK", n: "Z. Kostas",   t: "RCT",   state: "on"  },
  { i: "GV", n: "G. Voss",     t: "TRN",   state: "on"  },
  { i: "EJ", n: "E. Joon",     t: "BRK",   state: "on"  },
  { i: "DR", n: "Dr. Reva",    t: "MED",   state: "on"  },
  { i: "AV", n: "A. Voss",     t: "VLT",   state: "on"  },
  { i: "RX", n: "R. Xian",     t: "—",     state: "hurt"},
  { i: "PH", n: "P. Han",      t: "BRK",   state: "on"  },
  { i: "TR", n: "T. Rios",     t: "AI",    state: "hurt"},
];

const RESOURCES = [
  { key: "scrap",  label: "Scrap",   val: "1,248", delta: "+24" },
  { key: "power",  label: "Power",   val: "82",    delta: "-6", neg: true, unit: "MW" },
  { key: "relic",  label: "Relics",  val: "23",    delta: "+1" },
  { key: "food",   label: "Food",    val: "412",   delta: "-3", neg: true },
  { key: "survivor",label:"Survivors",val: "31",   delta: "+3" },
];

Object.assign(window, { ROOMS, ALERTS, ROSTER, RESOURCES });
