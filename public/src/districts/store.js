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
