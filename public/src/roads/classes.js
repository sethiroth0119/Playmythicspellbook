/* ══════════════════════════════════════════════════════════════════════════
   🛣 THE ROAD CLASS RESOLVER — and the decision that this file exists to make.

   🔴 A ROAD CLASS IS **NOT** A TILE TYPE. `t.type` stays the literal string
      'road' for every one of the nine classes, and the class rides beside it in
      `t.rc`.

   That is the whole design, and it is worth the paragraph, because the
   alternative is a bug this codebase has already shipped eight times and named
   twice in its own comments (node-city index.html: TRUCK_STOPS, "the seventh
   instance"; a load-order snapshot, "eighth"). `isRoad` is a bare
   `t.type === 'road'` string compare and it is RE-DERIVED INDEPENDENTLY in at
   least twelve places: node-city's own isRoad (handed BY VALUE through ctx to
   about a dozen modules), computeLinks, allRoadKeys, the power snapshot's
   `road: isR` projection, and private closures in /src/streets, /src/naming,
   /src/zoning, /src/parking and /src/crowd — the last two of which go further
   and re-compute the N/S/E/W neighbour mask themselves.

   A class that was a new TYPE would therefore, silently and with no error
   anywhere:
     · render as an INVISIBLE BUILDING — buildMesh has no 'road' arm and no
       default arm, so it returns an empty Group; roads only escape that
       because five call sites hard-code `=== 'road'` and route to refreshRoad;
     · DESPAWN every agent standing on it — agentTick reads a type change on an
       occupied tile as "the road was demolished";
     · fall out of the road maintenance cap, so "pave the map" comes back;
     · become zonable land AND stop bounding zoning's fills, so one click
       escapes the block and runs to FILL_MAX;
     · drop off /src/power's cable graph, which routes on `t.road`;
     · lose its /src/contact AO patches, /src/parcel skip and /src/naming
       suppression, and stop being exempt in /src/economy's exemptTypes list;
     · break /src/outside's grandfather migration, which calls place('road').

   Keeping the type means every one of those keeps working UNCHANGED and this
   module can be deleted from the deploy without breaking a single save: a road
   whose class this file no longer resolves is a road, and node-city renders,
   prices, meters, paths and demolishes it exactly as it did before any of this
   existed. That degradation is the point, not a consolation.

   ⚠ EVERY read of a class goes through classOf() below. Nothing in this module
     — and nothing in node-city — may compare `t.rc` to a literal. That is the
     same rule roadsAdjacentTo() already enforces by taking a RESOLVER rather
     than a list, and for exactly the same reason.
   ══════════════════════════════════════════════════════════════════════════ */

import { ROADS, rd } from './tuning.js';
/* 🛣 …and the TYPE-side resolver, which is a different question from the one
   this file answers. classOf() asks WHICH class a carriageway is; isRoadTile()
   asks whether the tile is a carriageway AT ALL, across every type node-city
   publishes on window.MythicRoads. Asking it with a bare literal here would be
   the exact defect this file's header spends forty lines on. */
import { isRoadTile } from './types.js';

/* The id every unclassed road resolves to. A city built before this module
   existed has no `rc` on any tile and must price, meter, render and segment
   byte-for-byte as it did — so DEFAULT is the entry whose costMult is 1.0 and
   whose mesh contributes nothing. See tuning.js's note on `street`. */
export const DEFAULT = 'street';

/* Palette order, hidden classes removed. Built once; the table is static. */
export const CLASSES = Object.keys(ROADS.cls)
  .filter(id => !ROADS.cls[id].hidden)
  .sort((a, b) => (ROADS.cls[a].order || 0) - (ROADS.cls[b].order || 0));

/* Every id including the hidden ones — what `known()` validates against. */
export const ALL = Object.keys(ROADS.cls);

export function known(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ROADS.cls, id);
}

/* The definition, never null: an unknown id resolves to the default's def, so
   no caller has to guard. An id that is unknown here but present in a save is
   a class from a NEWER build, and reading it as a plain street is the safe
   direction — the player sees a road, not a hole. */
export function defOf(id) {
  return ROADS.cls[known(id) ? id : DEFAULT];
}

/* ⭐ THE RESOLVER. The only sanctioned way to ask what class a tile is.
   Takes the TILE, not the type string, because a class is a property of a tile
   and a type string cannot carry one. A non-road tile has no class at all —
   `null`, not DEFAULT — so a caller cannot accidentally treat a Grocery as a
   street by forgetting to check. */
export function classOf(t) {
  if (!isRoadTile(t)) return null;
  const c = t.rc;
  return known(c) ? c : DEFAULT;
}

/* Is this tile a road of a class that is not the shipped default? Used only to
   decide whether anything at all has to be drawn, so the common case (a city of
   plain streets) does zero work per tile. */
export function isClassed(t) {
  const c = classOf(t);
  return !!c && c !== DEFAULT;
}

/* The maintenance burden of one tile, in road-cap units. Absent/unknown ⇒ 1,
   which is what every road in every existing save weighs today. */
export function capWeightOf(t) {
  const c = classOf(t);
  if (!c) return 0;
  return rd('cls.' + c + '.capWeight', rd('cls.' + DEFAULT + '.capWeight', 1));
}

/* The price multiplier for a class id (NOT a tile — this is asked about the
   class the player has ARMED, before any tile exists). See price.js for the
   only place it is allowed to meet a cost dict. */
export function costMultOf(id) {
  return rd('cls.' + (known(id) ? id : DEFAULT) + '.costMult',
            rd('cls.' + DEFAULT + '.costMult', 1));
}

/* How many tiles on a side this class stamps, or 0 for a class laid by drag.
   Only the roundabout declares one. */
export function stampOf(id) {
  return rd('cls.' + (known(id) ? id : DEFAULT) + '.stamp', 0) | 0;
}

export default { DEFAULT, CLASSES, ALL, known, defOf, classOf, isClassed, capWeightOf, costMultOf, stampOf };
