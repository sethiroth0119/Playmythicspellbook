/* ══════════════════════════════════════════════════════════════════════════
   👥 HOUSEHOLDS — who actually lives at this address.
   ──────────────────────────────────────────────────────────────────────────
   🔴 NOBODY IS INVENTED HERE. Every person in a household is an EXISTING named
      citizen off `window.MythicCitizens` (index.html ~22621) — the same record
      the chat bubbles speak for, the same one the Workforce roster lists, the
      same id the citizen-talk dialog opens. This module adds no people, no
      ages, no biographies, no relationships. It answers exactly one question
      the citizens layer does not: WHICH HOUSE. That layer tracks `job` and no
      `home`, so residence is derived here.

   🔴 DERIVED, NOT STORED — and that is what makes it save-compatible.
      `homesIndex()` is a pure function of (the roster, the housing tiles). No
      new save field exists, so a save written before this feature opens with
      households already in it and a save written after opens in a build
      without it. Nothing to migrate, nothing to be missing.

   🔴 STABLE ACROSS RELOADS, WHICH IS THE WHOLE POINT.
      makeHousing's header records why this class of bug is so easy to ship:
      anything seeded off Math.random at RENDER time re-rolls on every redraw,
      so the house you were looking at becomes a different house. The same trap
      applies to people. Nothing here calls Math.random. The allocation is a
      deterministic deal from a SORTED roster into SORTED housing tiles, so
      Cass Marrow lives at the same address every time the panel is opened,
      across a reload, and on another machine with the same save.

   🏡 WHY SURNAME-SORTED. Dealing the roster in id order would put Ada Ashcroft
      and Bren Lark in one house and call them a family, which is the plausible
      lie this codebase keeps refusing. Sorting by surname first makes people
      who share one land in the same house, so a household usually IS a family
      and can honestly be called one. When a house ends up mixed the label says
      "Household", not "Family" — see `householdOf`.

   ⚠ A house whose residents change because the PLAYER changed the city (built
     more housing, demolished a block, upgraded a level) is re-dealt. People
     move when the housing stock moves. That is honest and it is the only case
     in which an address's residents change.
   ══════════════════════════════════════════════════════════════════════════ */

/* The citizens seam. THREE DIFFERENT ANSWERS and they are never collapsed:
     null  — the seam is missing or threw          → a FAULT, said out loud
     []    — the seam answered with nobody          → a FACT
     [...] — people                                 → the roster
   insRosterCard in index.html draws the same distinction for the same reason:
   rendering a fault as an empty building is how a broken panel goes on looking
   healthy. */
export function rosterOf() {
  try {
    if (typeof window === 'undefined') return null;
    const M = window.MythicCitizens;
    if (!M || typeof M.list !== 'function') return null;
    const r = M.list();
    if (!Array.isArray(r)) return null;
    return r.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string');
  } catch (e) { return null; }
}

export function surnameOf(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || 'Household');
}

/* Every housing tile, with its bed count, in a STABLE numeric order. A damaged
   building still houses its people — losing the roof does not evict them, and
   the citizens layer takes the same line about a damaged workplace. */
function housingTiles(C) {
  const out = [];
  const tiles = (C.game && C.game.tiles) || {};
  for (const k in tiles) {
    const t = tiles[k], d = t && C.BUILDINGS[t.type];
    if (!d || !(d.popCap > 0)) continue;
    const p = k.split(',');
    out.push({ k, x: +p[0], z: +p[1], beds: (d.popCap | 0) * (t.lvl || 1) });
  }
  out.sort((a, b) => (a.x - b.x) || (a.z - b.z));
  return out;
}

/* One deal per (roster, housing stock). Recomputing it for every row of every
   card would be O(people x houses) on each repaint of the panel; the signature
   is what makes the cache safe — it changes the moment either input does. */
let _cache = { sig: null, val: null };
function signature(C, people, homes) {
  return people.length + '|' + people.map(c => c.id).join(',') + '#' +
         homes.map(h => h.k + ':' + h.beds).join(',');
}

export function homesIndex(C) {
  const people = rosterOf();
  if (!people) return { ok: false, why: 'seam', byHome: new Map(), homes: 0, homeless: 0 };
  const homes = housingTiles(C);
  const sig = signature(C, people, homes);
  if (_cache.sig === sig) return _cache.val;

  const byHome = new Map();
  for (const h of homes) byHome.set(h.k, []);
  let homeless = people.length;
  if (homes.length && people.length) {
    /* Surname, then given name, then id — so the order is total (two people
       can share both names) and therefore identical on every machine. */
    const sorted = people.slice().sort((a, b) => {
      const sa = surnameOf(a.name), sb = surnameOf(b.name);
      if (sa !== sb) return sa < sb ? -1 : 1;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    /* An even spread, in CONTIGUOUS blocks. Round-robin would spread the
       roster evenly too, and would scatter every family across the district —
       the block is what keeps the surname-sort meaningful.

       🔴 THE QUOTA IS FLOOR-PLUS-REMAINDER, NOT CEILING, AND THIS WAS A REAL
          BUG. `ceil(people / homes)` looks like the even split and is not: on
          the standard 54-house district with 62 named citizens it is 2, so the
          first 31 houses took everybody and THE OTHER 23 HOUSES WERE EMPTY —
          half the district reading "no named citizen lives here yet" while the
          roster was full. Caught in the render, not in the arithmetic. Floor
          plus one to the first `rem` houses is the actual even split: 8 houses
          of two, 46 of one, none empty. */
    const base = Math.floor(sorted.length / homes.length);
    const rem = sorted.length - base * homes.length;
    let i = 0, hi = 0;
    for (const h of homes) {
      const quota = base + (hi++ < rem ? 1 : 0);
      const take = Math.min(quota, h.beds, sorted.length - i);
      if (take <= 0) continue;
      byHome.set(h.k, sorted.slice(i, i + take));
      i += take;
    }
    // Whoever is left over (a house ran out of beds) fills remaining beds.
    if (i < sorted.length) {
      for (const h of homes) {
        if (i >= sorted.length) break;
        const cur = byHome.get(h.k);
        while (cur.length < h.beds && i < sorted.length) cur.push(sorted[i++]);
      }
    }
    homeless = sorted.length - i;
  }
  const val = { ok: true, byHome, homes: homes.length, homeless };
  _cache = { sig, val };
  return val;
}

/* The people at one address, or a fault. */
export function residentsOf(C, k) {
  const idx = homesIndex(C);
  if (!idx.ok) return { ok: false, why: idx.why, members: [] };
  return { ok: true, members: idx.byHome.get(k) || [], homeless: idx.homeless };
}

/* THE HOUSEHOLD'S NAME. "Family" is claimed only when every resident actually
   shares the surname; a mixed house is a "Household", which is a true word for
   people who share an address without sharing a name. */
export function householdOf(C, k) {
  const r = residentsOf(C, k);
  if (!r.ok) return { ok: false, why: r.why, members: [] };
  const mem = r.members;
  if (!mem.length) return { ok: true, members: [], name: null, family: false };
  const counts = Object.create(null);
  for (const c of mem) { const s = surnameOf(c.name); counts[s] = (counts[s] || 0) + 1; }
  let top = null, n = -1;
  for (const s in counts) if (counts[s] > n || (counts[s] === n && s < top)) { top = s; n = counts[s]; }
  const family = n === mem.length && mem.length > 1;
  return {
    ok: true, members: mem, surname: top, family,
    name: 'The ' + top + (family ? ' Family' : ' Household'),
  };
}

/* Who WORKS here — straight through the citizens seam, no derivation at all.
   Same three-answer contract as the roster. */
export function workersOf(k) {
  try {
    if (typeof window === 'undefined') return null;
    const M = window.MythicCitizens;
    if (!M || typeof M.byJob !== 'function') return null;
    const r = M.byJob(k);
    return Array.isArray(r) ? r : null;
  } catch (e) { return null; }
}

/* The mood band names are the citizen-talk dialog's own (`ctBand`, index.html
   ~23182) so one person cannot read "content" in the bubble and something else
   in their own household row. */
export function moodBand(v) {
  if (!Number.isFinite(v)) return { label: 'Unknown', face: '·', tone: 'fl' };
  if (v < 25) return { label: 'Wretched', face: '😖', tone: 'bad' };
  if (v < 40) return { label: 'Struggling', face: '🙁', tone: 'bad' };
  if (v < 60) return { label: 'Getting by', face: '😐', tone: 'warn' };
  if (v < 78) return { label: 'Content', face: '🙂', tone: 'good' };
  return { label: 'Thriving', face: '😄', tone: 'good' };
}

/* The average mood of a group, ignoring anyone whose mood has not been
   computed yet (a citizen minted this frame carries NaN by design). */
export function averageMood(people) {
  let sum = 0, n = 0;
  for (const c of (people || [])) if (Number.isFinite(c.mood)) { sum += c.mood; n++; }
  return n ? { v: sum / n, n } : { v: NaN, n: 0 };
}

// Test seam: drop the deal cache so a driver can prove it re-deals.
export function _flush() { _cache = { sig: null, val: null }; }
