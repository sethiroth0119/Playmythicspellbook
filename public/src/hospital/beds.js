/* ══════════════════════════════════════════════════════════════════════════
   🛏 BEDS — where a patient lies. The ward bay's slots, as data. PURE.
   ──────────────────────────────────────────────────────────────────────────
   Beds come from the game's DECORATION SYSTEM: the same furniture catalogue
   the Card Shop builder and the Dwelling buy from (Supabase furniture_catalog,
   admin-posted .glb models with `func: 'bed'`), purchased into the same
   Profile.furnitureOwned inventory through the same spend path. This module
   only knows about SLOTS — fixed positions on the ward bay floor — and which
   owned bed stands in which slot. Placing a bed takes one out of the owned
   inventory; picking it up puts it back, exactly as the Dwelling does.

   A built-in WARD COT exists for a player with no catalogue reach (offline,
   table absent) so the ward is never un-buildable; it is priced through the
   medical op's econ row like everything else in this building.
   ══════════════════════════════════════════════════════════════════════════ */

/* The desk's footprint, for the queue and the walk-round below. floor.js is
   a table, so importing it keeps this module as pure as it was. */
import { DESK_MODEL, deskFront } from './floor.js';

export const V = 1;

/* Two rows of five, in the west wing, head to the wall. A slot is a place a
   1×2 m bed fits with an aisle beside it. */
export const SLOTS = (() => {
  const out = [];
  const xs = [-12.2, -9.6, -7.0, -4.4, -1.8];
  const rows = [{ z: -5.5, rot: 0 }, { z: 0.5, rot: Math.PI }];
  let i = 0;
  for (const r of rows) for (const x of xs) out.push({ index: i++, x, z: r.z, rot: r.rot });
  return out;
})();
/* 🛏 THE WARD COT IS A MODEL: /models/hospital/ward-bed.glb, packed by
   tools/pack-glb.mjs --bed from a 118 MB Meshy export.
   ──────────────────────────────────────────────────────────────────────────
   🔴 TWO NUMBERS HERE WERE MEASURED, NOT GUESSED, and they are the whole
      point. A patient has to lie ON the mattress with their head on the
      pillow, and the mesh does not say where either is. So the pack tool
      measures them — the mattress is the highest surface in the middle 30%
      of the footprint (rails are at the sides, boards at the ends), and the
      head end is where the tallest vertices cluster — and writes them to
      ward-bed.json. mattressTop and headEnd below are copied from there and
      _hospital_smoke.mjs fails if they ever disagree, so a re-export cannot
      leave patients floating over the bed or lying with their heads at the
      footboard. Model units above the base; scaled with the mesh.
   ⚠ length is the SLOT's, not the model's: the mesh is scaled so its long
     axis fills the 2.2 m slot, and everything else follows that scale. */
export const BED_MODEL = {
  url: '/models/hospital/ward-bed.glb',
  raw: { w: 1.085, h: 1.385, d: 1.902 },
  length: 2.2,
  mattressTop: 0.484,
  headEnd: '-z',
};
export function bedScale() { return BED_MODEL.length / BED_MODEL.raw.d; }
/* The cot's headboard is at local -z; turn the model round if its is not. */
export function bedYaw() { return BED_MODEL.headEnd === '-z' ? 0 : Math.PI; }
/* Where the mattress surface actually is, in metres, at slot scale. */
export function bedTop() { return +(BED_MODEL.mattressTop * bedScale()).toFixed(3); }

/* The footprint the bay's collider and the fallback cot use: the slot's
   length, and the model's width at slot scale (it was 1.1 by assumption). */
export const BED_SIZE = { w: +(BED_MODEL.raw.w * (2.2 / BED_MODEL.raw.d)).toFixed(2), d: 2.2, h: 0.6 };

export const COT = { id: 'cot', name: 'Ward Cot', ico: '🛏', builtin: true, url: BED_MODEL.url,
  blurb: 'A steel frame and a thin mattress. Every ward starts with these.',
  /* share of the medical op's ratePerWorkerHr — see cotPrice() */
  priceMul: 1.8 };

export function cotPrice(econ) {
  const rate = Math.max(0, +(econ && econ.ratePerWorkerHr) || 0);
  return rate ? Math.max(1, Math.round(rate * COT.priceMul)) : 0;
}

/* Catalogue rows that are beds, in the Dwelling's row shape. */
export function bedRows(catalogRows) {
  return (catalogRows || []).filter((r) => r && (r.func === 'bed'));
}

export function slotAt(i) { return SLOTS[i | 0] || null; }
export function freeSlots(beds) {
  const used = {}; for (const b of (beds || [])) if (b) used[b.slot | 0] = 1;
  return SLOTS.filter((s) => !used[s.index]);
}
export function bedAt(beds, slot) { for (const b of (beds || [])) if (b && (b.slot | 0) === (slot | 0)) return b; return null; }

/* Collision boxes for the walker, in the same {x,z,hx,hz} shape the lab's
   colliders() returns, so placed beds are furniture you walk around. */
export function bedColliders(beds) {
  const out = [];
  for (const b of (beds || [])) {
    const s = slotAt(b.slot); if (!s) continue;
    const across = Math.abs(Math.sin(s.rot)) > 0.5;
    out.push({ x: s.x, z: s.z, hx: (across ? BED_SIZE.d : BED_SIZE.w) / 2 + 0.15, hz: (across ? BED_SIZE.w : BED_SIZE.d) / 2 + 0.15, key: 'bed' + b.slot });
  }
  return out;
}

/* Which bed a patient in slot i lies on, world position for the scene. */
/* 🛏 THE SURFACE A PATIENT ACTUALLY LIES ON.
   ──────────────────────────────────────────────────────────────────────────
   🔴 DERIVED FROM THE COT MESH, NOT GUESSED. This was `BED_SIZE.h + 0.05`
      (0.65) while cotMesh() puts the mattress slab centred at h + 0.02 and
      0.16 thick — so its top surface is at h + 0.10 (0.70), and the blanket
      over the legs reaches 0.76. The body was therefore seated 5 cm UNDER the
      mattress and up to 11 cm under the blanket, and patients visibly sank
      into the bed.
   ⚠ cotMesh() reads MATTRESS_TOP too, so the mesh and the pose cannot drift
     apart again: move the mattress and the patient moves with it.
   ⚠ A catalogue bed loaded from a .glb is scaled to the slot but its own
     surface height is unknowable, so it uses this figure as the honest
     default — the cot is the reference bed. */
export const MATTRESS_TOP = BED_SIZE.h + 0.10;
/* ⚠ SINCE THE COT BECAME A MODEL this is the FALLBACK box's surface only —
   lieAt() reads bedTop(), the measured mattress of the real bed. On a device
   where the model never loads, the patient lies at the model's height over
   the box cot: a few centimetres off, and the honest answer, because the box
   is a stand-in for the bed the pose was measured against. */
/* Clearance so the body rests ON the surface rather than z-fighting with it. */
export const LIE_CLEARANCE = 0.03;

export function lieAt(slot) {
  const s = slotAt(slot); if (!s) return null;
  return { x: s.x, y: bedTop() + LIE_CLEARANCE, z: s.z, rot: s.rot };
}

/* 🏥 WHERE THE QUEUE STANDS: IN FRONT OF THE DESK, ON THE DOOR SIDE.
   ──────────────────────────────────────────────────────────────────────────
   It used to be a ragged block at x 1.0–5.5, z −10.2 — BESIDE the desk and on
   the ward side of it, nowhere near where a patient asking to be admitted
   would stand. The first patient now stands at the counter and the rest file
   back toward the doors. Derived from the desk's footprint, so moving or
   re-exporting the desk moves the line with it.
   ⚠ FOUR DEEP, THEN A SECOND FILE. z −14.4 → −17.9 is all the room there is
     before the doors at −18.4; a fifth patient starts a new file 1.5 m to the
     side rather than queueing out of the building. */
export function queueSpot(i) {
  const n = i | 0, f = deskFront();
  const col = Math.floor(n / 4), row = n % 4;
  const side = col === 0 ? 0 : (col % 2 ? 1 : -1) * Math.ceil(col / 2) * 1.5;
  return { x: f.x + side, z: f.z - DESK_MODEL.standOff - row * 1.15 };
}
export const DOOR = { x: 0, z: -18.4 };

/* 🚶 AROUND THE DESK, NOT THROUGH IT.
   Patients have no collision — they walk a straight line to wherever they
   are going — and with the queue at the front of the desk, the line from
   there to a west-wing bed cuts the desk's corner (x −0.78 at the desk's z
   for the nearest bed), as does the walk back to the doors from the bed at
   the aisle end. So a walk whose straight line would cross the desk's centre
   line inside its span is sent to a point beside the desk first. Returns
   null when the line is clear, which is most walks. Pure geometry;
   scene.patients.js applies it every frame and never stores it. */
export function deskBypass(x, z, tx, tz) {
  const f = deskFront();
  const a = z - f.cz, b = tz - f.cz;
  if (!(a * b < 0)) return null;                        // never crosses the desk's line
  const t = a / (a - b);
  const cx = x + (tx - x) * t;                           // x where it would cross
  if (Math.abs(cx - f.x) >= f.hw + 0.8) return null;     // crosses clear of the desk
  // Round whichever side the walk as a whole leans to — the ward for an
  // admission, the same side you came from for a walk back to the doors.
  const side = ((x + tx) / 2 - f.x) < 0 ? -1 : 1;
  return { x: f.x + side * (f.hw + 1.0), z: f.cz };
}
