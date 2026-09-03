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
export const BED_SIZE = { w: 1.1, d: 2.2, h: 0.6 };

export const COT = { id: 'cot', name: 'Ward Cot', ico: '🛏', builtin: true,
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
export function lieAt(slot) {
  const s = slotAt(slot); if (!s) return null;
  return { x: s.x, y: BED_SIZE.h + 0.05, z: s.z, rot: s.rot };
}

/* Where the queue stands: a ragged line in the lobby, one spot per patient. */
export function queueSpot(i) {
  const n = i | 0;
  return { x: 3.2 + (n % 4) * 1.5 - 2.2, z: -10.2 - Math.floor(n / 4) * 1.4 };
}
export const DOOR = { x: 0, z: -18.4 };
