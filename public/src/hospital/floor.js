/* ══════════════════════════════════════════════════════════════════════════
   🏥 FLOOR — the Medical Corporation's floor plan, as data.
   ──────────────────────────────────────────────────────────────────────────
   Same contract as /src/biolab/stations.js: one table drives the 3D geometry,
   the collision boxes, the proximity prompts, the HUD and the objective list.
   The scene builder, the walker and the proximity rule are the LAB's, handed
   this table instead of theirs — so a camera fix or a character fix lands in
   both rooms at once.

   🔴 `hot: true` IS THE STERILE RULE, and it is the hazmat rule reused whole.
   The Compounding Lab is a clean room: worked without a sealed suit, whatever
   is on you goes into the product (/src/hospital/pharma.js reads the same
   `exposure` number cures.js does, and it costs quality and can spoil a run).
   Every other room in the building is clean-side. The scrub station is the
   airlock under another name, and the stripe on the floor is the same line.

   ⚠ NO LAB IN THIS BUILDING. The containment lab is the Research Facility —
   a different business that SHIPS to this one. The ward bay in the west wing
   is where beds stand (beds.js owns the slots) and patients lie.

   Coordinates are metres in a room ROOM.w × ROOM.d centred on the origin.
   The lobby is at −z; the sterile wing is everything past z > HOT_Z.
   ══════════════════════════════════════════════════════════════════════════ */

export const ROOM = { w: 28, d: 36, h: 4.4 };

/* The clean/sterile boundary. Only the compounding lab sits past it. */
export const HOT_Z = 6.5;

export const STATIONS = [
  {
    key: 'desk', name: 'Front Desk', icon: '🏥', short: 'DESK',
    pos: [0, -13.5], size: [5.2, 1.8], color: 0x8fd4c8, hot: false,
    prompt: 'Read the ledger',
    blurb: 'What the business made, what the city bought, and what is waiting on you.',
  },
  {
    key: 'bay', name: 'Ward Bay', icon: '🛏', short: 'BAY',
    pos: [-8.3, -10.2], size: [3.6, 1.4], color: 0x9fb4d8, hot: false,
    prompt: 'Run the ward',
    blurb: 'Patients wait in the lobby for a bed. Place beds in the bay, admit them, and treat wounds and sickness.',
  },
  {
    key: 'ward', name: 'Crate Intake', icon: '📦', short: 'INTAKE',
    pos: [9.5, -9], size: [3.6, 2.2], color: 0x9fb4d8, hot: false,
    prompt: 'Open intake and triage',
    blurb: 'Cure crates from hauliers stop here. Screen them, choose who gets the doses, or refuse the box.',
  },
  {
    key: 'supply', name: 'Supply Bench', icon: '🩹', short: 'SUPPLY',
    pos: [10.5, 4.5], size: [3.4, 2.0], color: 0xd8b45a, hot: false,
    prompt: 'Roll bandages',
    blurb: 'Cloth and clean water into dressings. Every wound in the ward takes one per severity.',
  },
  {
    key: 'vault', name: 'Containment Vault', icon: '🧊', short: 'VAULT',
    pos: [10, -2.5], size: [4.0, 2.6], color: 0x7fd6ff, hot: false,
    prompt: 'Inspect the cure stock',
    blurb: 'Every cure a haulier delivered and the ward opened leaves a sample line here. This is the raw material.',
  },
  {
    key: 'stock', name: 'Dispensary Stockroom', icon: '📦', short: 'STOCK',
    pos: [-9.5, 4.8], size: [4.0, 2.0], color: 0xd8b45a, hot: false,
    prompt: 'Check the shelves',
    blurb: 'Finished medicine, on its way to the clinics and med labs in your city, where NPCs buy it.',
  },
  {
    key: 'scrub', name: 'Scrub Station', icon: '🥽', short: 'SCRUB', frame: true,
    pos: [0, 5.2], size: [4.6, 1.8], color: 0x2f6f8f, hot: false,
    prompt: 'Gown up for the clean room',
    blurb: 'Four seals, in order, standing still. The clean room refuses you until all four are green.',
  },
  {
    key: 'compound', name: 'Compounding Lab', icon: '⚗️', short: 'COMPOUND',
    pos: [0, 12.5], size: [7.0, 2.6], color: 0x4fae7a, hot: true,
    prompt: 'Compound medicine',
    blurb: 'Turn a cure line into tablets, serum, vaccine, salve or tonic. Titrate carefully — the dial is the yield.',
  },
  {
    key: 'dock', name: 'Loading Dock', icon: '🚚', short: 'DOCK',
    pos: [-11.5, 12.5], size: [2.2, 3.2], color: 0xd8a13a, hot: false,
    prompt: 'Trade wholesale',
    blurb: 'Sell shelf stock to other players\' hospitals, or buy theirs. A player-owned haulier moves every lot.',
  },
];

export function stationByKey(k) { for (const s of STATIONS) if (s.key === k) return s; return null; }

/* The plan the lab's scene builder and walker take. Colours are the clinical
   set: pale floors, a teal sterile wing, and a blue-white fill instead of the
   lab's sickly green. Same geometry rules, different building. */
export const PLAN = {
  room: ROOM,
  hotZ: HOT_Z,
  stations: STATIONS,
  bg: 0x0b1216,
  colors: {
    floorClean: 0x2a3440,
    floorHot: 0x1f3a3c,
    wall: 0x18202a,
    trim: 0x3a4656,
    hazard: 0x8fd4c8,
    glass: 0xbfe8ff,
    hotFill: 0x9fe8ff,
  },
};

/* The objective list, in the order a competent shift does them. Nothing
   enforces the order except the sterile gate. */
export const OBJECTIVES = [
  { key: 'bay', text: 'Bed and treat the patients', why: 'A patient nobody beds walks back out.' },
  { key: 'ward', text: 'Clear the crate intake', why: 'Crates nobody opens are opened by staff — badly.' },
  { key: 'vault', text: 'Check the vault', why: 'You can only compound what a haulier delivered.' },
  { key: 'scrub', text: 'Gown up', why: 'Required before the clean room will run.' },
  { key: 'compound', text: 'Compound a run', why: 'Cure lines become medicine here.' },
  { key: 'stock', text: 'Stock the shelves', why: 'Your clinics sell what is on them.' },
];
