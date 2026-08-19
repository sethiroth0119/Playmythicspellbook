/* ════════════════════════════════════════════════════════════════════════════
   🗄 THE SPECIALISATION STORE — one map, "x,z" → spec id, and its save slice.
   ----------------------------------------------------------------------------
   🔴 WHY THIS IS A SECOND MAP AND NOT A COMPOUND ZONE ID.
      The obvious implementation is to write "c_high/c_mythic" into `game.zones`
      and split it on read. It was rejected outright: `game.zones` is read by
      NINE things that all look an id up in `ZONE_BY_ID` — /src/zoning's own
      overlay and develop pass, /src/progression's gate wrapper and its
      adoption sweep, /src/landvalue's compile, node-city's serialize and its
      dossier. Every one of them would silently stop recognising a specialised
      tile as zoned at all, and the failure would look like the zoning tool
      having forgotten a district. A separate map cannot do that: a build with
      this module absent reads `game.zones` exactly as it always has.

   🔑 IT RIDES THE SAVE SHELF, so node-city's `serialize()` literal needs NO
      edit — the same contract /src/naming, /src/zoning and /src/progression
      ship under. Registering LATE is safe and is the documented behaviour:
      SaveShelf stashes the payload and replays it to whoever registers next
      (naming/save.js, "Load order is the hard part").

   ⚠ AN UNKNOWN SPEC ID IS KEPT, NOT STRIPPED. A save written by a newer build
     that knows more specialisations must not be quietly emptied by an older
     one — the same rule /src/zoning states for unknown zone ids. It is simply
     not drawn and not used until a build that knows it opens the city.

   ⚠ A *LOCKED* ID IS ALSO KEPT — AND IT IS NOT THE SAME CASE, SO HERE IS THE
     SECOND ARGUMENT RATHER THAN THE FIRST ONE STRETCHED.
     🔴 THIS MAP IS THE ONE DOOR IN THE RESEARCH GATE THAT DOES NOT ASK. `arm()`,
        `onZone()` and `_set()` all refuse a specialisation the tree has not
        opened; `load()` below writes whatever the save says, because a loader
        that consults live game state is a loader that behaves differently
        depending on module boot order. That is deliberate and it is safe ONLY
        because index.js asks `unlocked()` again at every READ — mixFor,
        levelFor, markAt, refusal and the `per` census. Change one of those and
        this file becomes a hole: three strings in a save file were once worth
        15 progression nodes and 40 ⬡ of a 74 ⬡ tree.
     WHY KEPT RATHER THAN DROPPED. An unknown id is a BUILD-VERSION mismatch; a
     locked id is a WITHIN-BUILD state that the player can legitimately reach —
     a node re-costed or renamed under a district they painted honestly.
     /src/progression's header is absolute that nothing may remove what a live
     city already has, so the tile keeps its district, does nothing with it, and
     gets it back the moment the node opens. `reconcile()` below therefore drops
     on FAMILY only and never on research; the honest player loses nothing and
     the hand-edited save buys nothing.
   ════════════════════════════════════════════════════════════════════════════ */

export function makeStore() {
  let M = Object.create(null);          // "x,z" -> spec id
  let shelved = false;
  let dirty = null;                     // saveSoon(), handed in at mount

  const get = (k) => (k && M[k]) || null;
  const set = (k, id) => {
    if (!k) return false;
    const was = M[k] || null;
    if ((was || null) === (id || null)) return false;
    if (id) M[k] = id; else delete M[k];
    if (dirty) { try { dirty(); } catch (e) {} }
    return true;
  };
  const clear = (k) => set(k, null);

  function count(pred) {
    let n = 0;
    for (const k in M) if (!pred || pred(M[k], k)) n++;
    return n;
  }
  /* ⚠ THE RAW CENSUS, AND IT IS *NOT* THE ONE ANY CONSUMER SHOULD READ. It
     counts held and unknown ids alongside live ones. `MythicDistricts.stats()`
     builds the filtered `per` that /src/progression reads as evidence — see the
     locked-id note in the header before wiring anything to this. */
  function per() {
    const out = {};
    for (const k in M) out[M[k]] = (out[M[k]] || 0) + 1;
    return out;
  }
  function keysOf(id) {
    const out = [];
    for (const k in M) if (M[k] === id) out.push(k);
    return out;
  }

  /* ⚠ A SWEEP, NOT A MIGRATION. Called after a load and after any bulk zone
     change: a spec whose tile no longer carries a zone of the right family is
     dropped, because it could never be acted on again and would reappear the
     day the player re-zoned that tile as something else — a district they did
     not paint. Returns how many were dropped so a driver can assert on it. */
  function reconcile(famOf, zoneCatAt) {
    let dropped = 0;
    for (const k of Object.keys(M)) {
      const fam = famOf(M[k]);
      if (fam === undefined) continue;          // unknown id — kept, see header
      if (fam !== zoneCatAt(k)) { delete M[k]; dropped++; }
    }
    if (dropped && dirty) { try { dirty(); } catch (e) {} }
    return dropped;
  }

  function shelfRegister(saveSoon) {
    dirty = saveSoon || dirty;
    if (shelved) return true;
    try {
      const shelf = (typeof window !== 'undefined') && window.MythicCitySave;
      if (!shelf || typeof shelf.register !== 'function') return false;
      shelved = shelf.register('districts', {
        save: () => ({ v: 1, spec: { ...M } }),
        load: (p) => {
          M = Object.create(null);
          if (!p || typeof p !== 'object') return;
          const src = (p.spec && typeof p.spec === 'object') ? p.spec : {};
          for (const k in src) {
            const v = src[k];
            /* Hostile input is a real case: a hand-edited save, a truncated
               sync, a key that is not "x,z". Anything that is not two strings
               is dropped rather than carried into the tile map, because a bad
               key here becomes a lookup that never matches and a district the
               player can see in the count and never on the map. */
            if (typeof k !== 'string' || typeof v !== 'string') continue;
            if (!/^-?\d+,-?\d+$/.test(k)) continue;
            M[k] = v;
          }
        },
      });
    } catch (e) { console.warn('[Districts] save shelf unavailable (non-fatal):', e); }
    return shelved;
  }

  return { get, set, clear, count, per, keysOf, reconcile, shelfRegister,
           all: () => M, shelved: () => shelved, size: () => Object.keys(M).length };
}
