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

/* 🏥 THE FRONT DESK IS A MODEL, NOT A BOX.
   ──────────────────────────────────────────────────────────────────────────
   Every other station is the lab builder's generic cabinet + worktop. The
   desk is /models/hospital/intake-desk.glb (packed from a 115 MB Meshy export
   by tools/build-intake-desk.mjs), swapped in over the box by scene.desk.js
   once it loads — the box stays as the answer on a device that cannot fetch.

   🔴 THE FOOTPRINT FOLLOWS THE MODEL, NOT THE OTHER WAY ROUND. The mock was
      5.2 m wide; this counter is 1.9 × 1.39 × 0.92 in its own units, and
      scaling it to 5.2 m wide would make it 3.8 m tall. So it is scaled to a
      real counter HEIGHT, and the station's `size` — the box the walker
      collides with and the footprint nearest() measures reach from — is
      derived from the model's extents at that scale. The collider hugs what
      you can see.
   ⚠ `raw` MUST MATCH THE PACKED FILE. build-intake-desk.mjs writes the packed
     model's measured extents to intake-desk.json, and _hospital_smoke.mjs
     checks the two agree — so a re-export cannot leave the collider sized for
     the old mesh.
   ⚠ THE FRONT IS A z-FACE. A counter is wider than deep, so its front is one
     of the two ±z faces and `yaw` is 0 or π — never a quarter turn, which
     would swap the footprint's axes (the smoke pins that too). The doors are
     at −z and patients queue at the front (beds.js queueSpot), so the front
     must face −z. Settled by looking at the packed model in /model-test.html
     on 2026-09-04: the monitor on the counter faces +z and its BACK is what
     you see from −z — the screen faces the staff, so +z is the staff side
     and −z is the patients'. yaw 0 leaves the model's −z face toward the
     doors, which is the counter's front. */
export const DESK_MODEL = {
  url: '/models/hospital/intake-desk.glb',
  raw: { w: 1.903, h: 1.393, d: 0.921 },
  height: 1.2,
  yaw: 0,
  /* how far off the front edge a patient stands to be seen */
  standOff: 0.55,
};
/* 🛏 THE WARD BAY'S DESK — the nurses' station. A second Meshy export
   (ward-desk.glb, a different mesh: 1.086 deep against the intake desk's
   0.921), packed by tools/pack-glb.mjs, same rules as DESK_MODEL: scaled to
   counter height, footprint derived, raw pinned to its sidecar. Front toward
   the lobby (-z) like the intake desk, so the staff side faces the beds. */
export const BAY_MODEL = {
  url: '/models/hospital/ward-desk.glb',
  raw: { w: 1.903, h: 1.396, d: 1.086 },
  height: 1.2,
  yaw: 0,
};

/* One rule for every station that is a model: scale from its real-world
   height, footprint from the raw extents at that scale. The collider and
   nearest() both read the footprint, so the box the walker hits is the box
   you see.
   ⚠ A QUARTER TURN SWAPS THE AXES. The stations along the east and west
     walls face the corridor, which is a yaw of ±π/2 — and then the model's
     width lies along z. The footprint is rotated with the yaw here, in the
     one place both the collider and the proximity read it, so no station
     can be turned without its collider turning with it. Only multiples of
     π/2 are meaningful for an axis-aligned box; the smoke pins that. */
/* 🏥 FOUR MORE STATIONS AS MODELS (2026-09-04): the Crate Intake, the
   Containment Vault, the Supply Bench and the Dispensary Stockroom, each a
   ~3M-triangle Meshy export packed by tools/pack-glb.mjs and pinned to its
   sidecar the same way. Heights are what the thing IS, not a counter: the
   vault and the shelving are tall, the bench and the crate table are low.
   They stand along the east and west walls and face the room; a face toward
   the corridor is a quarter turn, and footprintOf swaps the axes for it.
   Fronts settled in /model-test.html on 2026-09-04: all four present their
   detail on the +z face (crates on the racks, the vault's glowing door, the
   bench's bottles, the shelving's boxes). A +z front turned by yaw θ faces
   (sin θ, cos θ): the three east-wall stations take -π/2 to face the corridor
   at -x, the west-wall stockroom +π/2 to face it at +x. To turn one round,
   change its yaw; the collider and reach follow. */
export const WARD_MODEL   = { url: '/models/hospital/crate-intake.glb',         raw: { w: 1.909, h: 1.217, d: 1.216 }, height: 1.3, yaw: -Math.PI / 2 };
export const VAULT_MODEL  = { url: '/models/hospital/containment-vault.glb',    raw: { w: 1.867, h: 1.905, d: 1.785 }, height: 2.2, yaw: -Math.PI / 2 };
export const SUPPLY_MODEL = { url: '/models/hospital/supply-bench.glb',         raw: { w: 1.903, h: 1.315, d: 0.798 }, height: 1.2, yaw: -Math.PI / 2 };
export const STOCK_MODEL  = { url: '/models/hospital/dispensary-stockroom.glb', raw: { w: 1.511, h: 1.903, d: 0.718 }, height: 2.1, yaw:  Math.PI / 2 };
/* ⚗️ THE CLEAN ROOM AND THE DOCK (2026-09-04). The compounding station is
   the one hot station — that is the hazmat gate's business, not the swap's.
   It stands at the centre of the sterile wing and is approached from the
   scrub station at -z, so its +z front is turned π to face the way you come
   in. The dock stands against the west wall of the wing and faces it. */
export const COMPOUND_MODEL = { url: '/models/hospital/compounding-lab.glb', raw: { w: 1.449, h: 1.902, d: 0.887 }, height: 2.0, yaw: Math.PI };
export const DOCK_MODEL     = { url: '/models/hospital/loading-dock.glb',    raw: { w: 1.903, h: 1.899, d: 1.785 }, height: 2.6, yaw: Math.PI / 2 };

export function scaleOf(m) { return m.height / m.raw.h; }
export function quarterTurned(m) { return Math.abs(Math.round((m.yaw || 0) / (Math.PI / 2))) % 2 === 1; }
export function footprintOf(m) {
  const s = scaleOf(m);
  const w = +(m.raw.w * s).toFixed(2), d = +(m.raw.d * s).toFixed(2);
  return quarterTurned(m) ? [d, w] : [w, d];
}
export function deskScale() { return scaleOf(DESK_MODEL); }
export function deskFootprint() { return footprintOf(DESK_MODEL); }

export const STATIONS = [
  {
    key: 'desk', name: 'Front Desk', icon: '🏥', short: 'DESK',
    pos: [0, -13.5], size: deskFootprint(), model: DESK_MODEL, color: 0x8fd4c8, hot: false,
    prompt: 'Read the ledger',
    blurb: 'What the business made, what the city bought, and what is waiting on you.',
  },
  {
    key: 'bay', name: 'Ward Bay', icon: '🛏', short: 'BAY',
    pos: [-8.3, -10.2], size: footprintOf(BAY_MODEL), model: BAY_MODEL, color: 0x9fb4d8, hot: false,
    prompt: 'Run the ward',
    blurb: 'Patients wait in the lobby for a bed. Place beds in the bay, admit them, and treat wounds and sickness.',
  },
  {
    key: 'ward', name: 'Crate Intake', icon: '📦', short: 'INTAKE',
    pos: [9.5, -9], size: footprintOf(WARD_MODEL), model: WARD_MODEL, color: 0x9fb4d8, hot: false,
    prompt: 'Open intake and triage',
    blurb: 'Cure crates from hauliers stop here. Screen them, choose who gets the doses, or refuse the box.',
  },
  {
    key: 'supply', name: 'Supply Bench', icon: '🩹', short: 'SUPPLY',
    pos: [10.5, 4.5], size: footprintOf(SUPPLY_MODEL), model: SUPPLY_MODEL, color: 0xd8b45a, hot: false,
    prompt: 'Roll bandages',
    blurb: 'Cloth and clean water into dressings. Every wound in the ward takes one per severity.',
  },
  {
    key: 'vault', name: 'Containment Vault', icon: '🧊', short: 'VAULT',
    pos: [10, -2.5], size: footprintOf(VAULT_MODEL), model: VAULT_MODEL, color: 0x7fd6ff, hot: false,
    prompt: 'Inspect the cure stock',
    blurb: 'Every cure a haulier delivered and the ward opened leaves a sample line here. This is the raw material.',
  },
  {
    key: 'stock', name: 'Dispensary Stockroom', icon: '📦', short: 'STOCK',
    pos: [-9.5, 4.8], size: footprintOf(STOCK_MODEL), model: STOCK_MODEL, color: 0xd8b45a, hot: false,
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
    pos: [0, 12.5], size: footprintOf(COMPOUND_MODEL), model: COMPOUND_MODEL, color: 0x4fae7a, hot: true,
    prompt: 'Compound medicine',
    blurb: 'Turn a cure line into tablets, serum, vaccine, salve or tonic. Titrate carefully — the dial is the yield.',
  },
  {
    key: 'dock', name: 'Loading Dock', icon: '🚚', short: 'DOCK',
    pos: [-11.5, 12.5], size: footprintOf(DOCK_MODEL), model: DOCK_MODEL, color: 0xd8a13a, hot: false,
    prompt: 'Trade wholesale',
    blurb: 'Sell shelf stock to other players\' hospitals, or buy theirs. A player-owned haulier moves every lot.',
  },
];

export function stationByKey(k) { for (const s of STATIONS) if (s.key === k) return s; return null; }

/* The counter's front edge (the door side, where patients stand), its centre
   line, and its half-width — everything the queue and the walk-round need. */
export function deskFront() {
  const s = stationByKey('desk');
  return { x: s.pos[0], z: s.pos[1] - s.size[1] / 2, cz: s.pos[1], hw: s.size[0] / 2 };
}

/* The plan the lab's scene builder and walker take. Same geometry rules,
   different building — and, since 2026-09-04, a different LIGHT. The first
   palette was the lab's dark navy with the colours swapped, and it read as a
   bunker with beds in it. A hospital is white: white walls, pale linoleum, a
   mint clean room, and a pale background — which is also the fog colour, so
   the far walls fade to daylight rather than into a void.
   ⚠ THE LIGHTS ARE THE LAB'S (scene.js: a 0.95 hemisphere and a 0.55 key)
     and are not changed here. Lambert white under them reads as white
     without clipping, and the hazard stripe is a DARK teal now because the
     old pale one vanished on a pale floor — the sterile line has to read. */
export const PLAN = {
  room: ROOM,
  hotZ: HOT_Z,
  stations: STATIONS,
  bg: 0xbcc6d1,
  colors: {
    floorClean: 0xd8dde3,
    floorHot: 0xc6e6e2,
    wall: 0xf4f6f8,
    trim: 0xb7c0ca,
    hazard: 0x1f8f86,
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
