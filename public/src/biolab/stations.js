/* ══════════════════════════════════════════════════════════════════════════
   🏷 STATIONS — the lab's floor plan, as data.
   ──────────────────────────────────────────────────────────────────────────
   One table drives the 3D geometry, the collision boxes, the proximity
   prompts, the HUD and the objective list. Everything about a station that a
   player can perceive is here, so moving a bench is one edit and not five.

   🔴 `hot: true` IS THE HAZMAT RULE. A hot station refuses to be worked
   without a SEALED suit, and standing near one unsuited accrues exposure that
   lands on the batch (see /src/plague/cures.js — exposure reduces purity and
   stability, and a contaminated batch is how a cure becomes a virus). The
   suit is not a costume and it is not a timer; it is the difference between
   the product working and the product being the next outbreak.

   Coordinates are metres in a room that is ROOM.w × ROOM.d, centred on the
   origin. The airlock is at −z and the hot zone is everything past z > HOT_Z,
   so the player physically walks from clean to dirty and the geometry tells
   them which half they are in before any text does.
   ══════════════════════════════════════════════════════════════════════════ */

export const ROOM = { w: 26, d: 34, h: 4.4 };

/* The clean/hot boundary. Everything at z greater than this is the hot zone —
   one number, used by the floor paint, the hazard stripe, the door frame and
   the exposure check, so they can never disagree about where the line is. */
export const HOT_Z = -2.5;

export const STATIONS = [
  {
    key: 'suitup', name: 'Suit-Up Airlock', icon: '🥽', short: 'AIRLOCK',
    pos: [0, -14.5], size: [4.6, 1.8], color: 0x2f6f8f, hot: false,
    prompt: 'Don the hazmat suit',
    blurb: 'Four seals, in order. Nothing past the stripe opens until all four are green.',
  },
  {
    key: 'sequencer', name: 'Sequencer', icon: '🧭', short: 'SEQ',
    pos: [-8.5, -8], size: [3.2, 2.2], color: 0x5a7fd8, hot: false,
    prompt: 'Read the strain',
    blurb: 'Reads the isolate\'s four axes. Formulating without it is formulating blind.',
  },
  {
    key: 'centrifuge', name: 'Centrifuge', icon: '🌀', short: 'SPIN',
    pos: [-8.5, 4], size: [2.6, 2.6], color: 0x8f6fd8, hot: true,
    prompt: 'Spin the reagents',
    blurb: 'Purity. Hold the rotor in the green band — over-spin shears the batch.',
  },
  {
    key: 'synthesis', name: 'Synthesis Bench', icon: '⚗️', short: 'BENCH',
    pos: [0, 6.5], size: [6.4, 2.4], color: 0x4fae7a, hot: true,
    prompt: 'Mix the formulation',
    blurb: 'Where the cure is actually made. Choose the reagents; the strain decides if you were right.',
  },
  {
    key: 'assay', name: 'Assay / QC', icon: '🔬', short: 'QC',
    pos: [8.5, 4], size: [3.0, 2.4], color: 0xd8b45a, hot: true,
    prompt: 'Run the assay',
    blurb: 'The only station that tells you the truth before you ship. Skipping it is a bet.',
  },
  {
    key: 'dispatch', name: 'Dispatch Bay', icon: '📦', short: 'BAY',
    pos: [8.5, -9], size: [3.6, 3.0], color: 0xd8825a, hot: false,
    prompt: 'Package and ship',
    blurb: 'Seals the batch and hands it to a haulier. Past this door it is somebody else\'s cargo.',
  },
];

export function stationByKey(k) { for (const s of STATIONS) if (s.key === k) return s; return null; }
export function isHot(k) { const s = stationByKey(k); return !!(s && s.hot); }

/* Is a world point inside the hot zone? The suit rule, the floor colour and
   the exposure meter all ask this one function. */
export function inHotZone(x, z) { return z > HOT_Z; }

/* Nearest station within `reach` metres of (x, z), or null. Returned with the
   distance so the HUD can fade the prompt in rather than pop it. */
export function nearest(x, z, reach) {
  const R = Number.isFinite(+reach) ? +reach : 3.0;
  let best = null, bestD = Infinity;
  for (const s of STATIONS) {
    // Distance to the bench's footprint, not its centre — walking to the end
    // of a 6.4m bench should still count as being at it.
    const hx = s.size[0] / 2, hz = s.size[1] / 2;
    const dx = Math.max(0, Math.abs(x - s.pos[0]) - hx);
    const dz = Math.max(0, Math.abs(z - s.pos[1]) - hz);
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < bestD) { bestD = d; best = s; }
  }
  return (best && bestD <= R) ? { station: best, dist: +bestD.toFixed(2) } : null;
}

/* Solid boxes the player cannot walk through: the benches themselves plus the
   room's four walls. Returned as {x,z,hx,hz} so player.js can do one cheap
   AABB sweep per axis and never needs to know what a station is. */
export function colliders() {
  const out = STATIONS
    // The airlock is a doorway, not furniture — you walk INTO it.
    .filter((s) => s.key !== 'suitup')
    .map((s) => ({ x: s.pos[0], z: s.pos[1], hx: s.size[0] / 2 + 0.25, hz: s.size[1] / 2 + 0.25, key: s.key }));
  return out;
}

/* The objective list, in the order a competent run does them. The HUD prints
   this as a checklist; nothing enforces the order except the suit gate, so a
   player who wants to skip QC is allowed to — and finds out later. */
export const OBJECTIVES = [
  { key: 'sequencer', text: 'Sequence the strain', why: 'Otherwise you are guessing at its shape.' },
  { key: 'suitup', text: 'Seal the hazmat suit', why: 'Required before any hot-zone bench will run.' },
  { key: 'centrifuge', text: 'Spin the reagents', why: 'Purity. A dirty batch travels badly.' },
  { key: 'synthesis', text: 'Mix the formulation', why: 'The cure itself.' },
  { key: 'assay', text: 'Run QC', why: 'The last chance to see what you actually made.' },
  { key: 'dispatch', text: 'Package for dispatch', why: 'A cure in the lab has cured nobody.' },
];
