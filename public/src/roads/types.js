/* ══════════════════════════════════════════════════════════════════════════
   🛣 IS THIS TILE A CARRIAGEWAY? — the ONE place that question is answered.

   This is the smaller half of the resolver, and it is a genuinely different
   question from the one classes.js answers:

       isRoadTile(t)   is this tile a carriageway AT ALL?
       classOf(t)      and if so, which of the nine classes is it?

   It exists as its own file, with its own export, for one reason: `t.type ===
   'road'` is the single most copy-pasted expression in this codebase. node-city
   re-derives it at least twelve times — its own isRoad (then handed BY VALUE
   through ctx to about a dozen modules), computeLinks, allRoadKeys, the power
   snapshot's `road: isR` projection — and /src/streets, /src/naming,
   /src/zoning, /src/parking and /src/crowd each keep private copies. The file
   has named the resulting bug class twice in its own comments ("the seventh
   instance", "eighth"). /src/roads gets exactly ONE copy, here, and everything
   in the feature reads through it.

   ⚠ TAKES A TILE, NEVER A TYPE STRING, in its primary form. A type string
     cannot carry a class, and a helper that accepted one would be used with one
     — which is precisely the shape roadsAdjacentTo() refuses by taking a
     RESOLVER rather than a list. isRoadType() exists for the handful of host
     seams that genuinely only ever hold a type string.

   ── 🔴 THE ANSWER IS NO LONGER THE BARE LITERAL 'road', AND HERE IS WHY ─────
   An earlier draft of this file hard-coded `t.type === 'road'` and said so in
   as many words: *"this predicate agrees with node-city's isRoad EXACTLY, for
   every class, forever. If that ever stops being true — if some future round
   really does mint a second carriageway type — this is the one function that
   changes, and every consumer in /src/roads follows for free."*

   That round happened. node-city now publishes a TABLE of carriageway types
   (`ROAD_CLASSES`, declared beside BUILDINGS) and the sweep that came with it
   replaced all 23 bare-string tests in node-city and all 12 under /src with
   `isRoadType` / `isRoadTile`. So this is that one function, changed — and the
   whole point of the indirection is that nothing else had to move.

   ⚠ THE TWO DESIGNS COMPOSE, THEY DO NOT COMPETE. classes.js's rule — a road
     CLASS rides in `t.rc` and does not mint a type — is untouched and remains
     correct: every one of its classes is type 'road', and this predicate
     answers true for all of them. What node-city's table adds is a separate
     axis: a small number of genuinely distinct carriageway TYPES, each of which
     also carries `rc` classes. Ask this file "is it road at all"; ask
     classes.js "which class". Neither answer is derivable from the other.

   🔒 IT FAILS OPEN, ALWAYS. If `window.MythicRoads` is missing — an older host,
   a rolled-back index.html, this file loaded outside node-city — every function
   here degrades to the pre-table behaviour, i.e. 'road' and nothing else. That
   is what makes the 404 round trip safe (verified: a save containing a second
   carriageway type still loads, still renders and is still demolishable with
   this module removed from the deploy, because node-city's own copy of the
   table is what drives loadState, refreshRoad, the cap and the demolish path).
   ══════════════════════════════════════════════════════════════════════════ */

/* The type node-city writes on every road tile, in every save, on every path:
   tryPlace, loadState, the admin path, /src/outside's grandfather migration.
   Named once so no other file in this module has to write the literal, and it
   is ALSO this file's whole fallback answer when the host table is absent. */
export const ROAD_TYPE = 'road';

/* THE HAND-OVER. node-city's ROAD_CLASSES is a top-level `const` and therefore
   invisible to an ES module (CLAUDE.md, the globals trap); `window.MythicRoads`
   is the real window property it publishes at the declaration. try/catch rather
   than a truthiness test because this file is also parsed by the module gate,
   where `window` need not be the page's window at all. */
function host() {
  try { return (typeof window !== 'undefined' && window.MythicRoads) || null; }
  catch (e) { return null; }
}

/** Every carriageway TYPE the host knows, in the host's own order. Falls back
    to the single legacy type. Callers that need the list — the research tree
    gates every class the same way — should take it from here, never write it
    out: a literal list is the shape that hid instance #7 (TRUCK_STOPS). */
export function roadTypes() {
  const h = host();
  try {
    if (h && typeof h.types === 'function') {
      const l = h.types();
      if (Array.isArray(l) && l.length) return l.slice();
    }
  } catch (e) {}
  return [ROAD_TYPE];
}

/** 🪦 Every carriageway type a player may still LAY — the subset of
    roadTypes() with the host's `retired` flag removed.

    ⚠ THIS IS A DIFFERENT QUESTION FROM roadTypes(), and mixing them up is how
      the Lane became a research reward for a building with no affordance.

        roadTypes()           what counts as a carriageway. Asked of TILES —
                              rendering, the maintenance cap, zoning bounds, the
                              cable graph, demolition. Its answer may only ever
                              GROW: a type is written verbatim into every save
                              and a save is never stranded.
        buildableRoadTypes()  what may still be OFFERED. Asked by anything that
                              puts a carriageway in front of the player — today
                              that is the research tree's unlock list, and
                              'absent ⇒ open' means listing one there is what
                              LOCKS it, so a type that can be built and is not
                              listed is the cheap way around the trunk node.
                              Its answer may shrink, and has.

    🔒 FAILS OPEN IN THE SAFE DIRECTION, TWICE. An older host with no
    `buildable()` on the hand-over falls back to roadTypes() — i.e. to the
    pre-retirement behaviour, gating everything, which costs a player nothing
    and closes the trunk-node loophole. No host at all falls back to ['road'].
    Never returns empty: an empty unlock list would ungate every carriageway. */
export function buildableRoadTypes() {
  const h = host();
  try {
    if (h && typeof h.buildable === 'function') {
      const l = h.buildable();
      if (Array.isArray(l) && l.length) return l.slice();
    }
  } catch (e) {}
  return roadTypes();
}

/* The same question asked of a bare type string, for the host seams that
   genuinely only have one (serialize's whitelist, the buildMesh dispatch, the
   construction-timer exemption). Deliberately separate from isRoadTile so a
   call site that HAS a tile cannot accidentally take the weaker form and lose
   the class with it. */
export function isRoadType(type) {
  if (typeof type !== 'string' || !type) return false;
  const h = host();
  try { if (h && typeof h.isType === 'function') return !!h.isType(type); } catch (e) {}
  return type === ROAD_TYPE;
}

/* ⭐ The predicate. Null-safe on purpose — callers walk game.tiles and a missing
   key is an empty plot, not an error. */
export function isRoadTile(t) {
  return !!t && isRoadType(t.type);
}

/** The host's record for a carriageway type ({ id, name, ico, … }) or null.
    Read it for LABELS. Do NOT read it for prices: a road type's price is its
    BUILDINGS row through costOf(), and a road CLASS's multiplier is
    price.js — see /src/streets' roadCost note, where reading the raw table
    quoted upkeep 100x low and looked correct. */
export function roadClassOf(type) {
  const h = host();
  try {
    if (h && typeof h.classOf === 'function') {
      const c = h.classOf(type);
      if (c) return c;
    }
  } catch (e) {}
  return isRoadType(type) ? { id: type, name: 'Road', ico: '🛤️' } : null;
}

export default { ROAD_TYPE, roadTypes, buildableRoadTypes, isRoadTile, isRoadType, roadClassOf };
