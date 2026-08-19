/* ════════════════════════════════════════════════════════════════════════════
   🎲 THE CANDIDATE POOL — the companies that want a location and have not got
   one yet.
   ----------------------------------------------------------------------------
   "Suppose you've zoned 50 commercial properties but there are 200 companies
    wanting locations."

   That ratio IS the feature. If the pool were the same size as the lots there
   would be no competition, only allocation — every candidate would get a lot
   and the bid would decide nothing. So the pool is deliberately larger than the
   board, and `TEN.pool.perLot` is the knob.

   🔴 WHAT IS FICTION HERE, SAID PLAINLY. A company that has never opened has no
      record in any save, so its NAME and its SIZE are invented — exactly like
      /src/naming's word lists, which name every business in this city already.
      The honest line is: fiction may decide WHO is in the room; only measured
      facts decide WHO WINS. Nothing in this file is read by bid.js except
      `size.rentBearing`, which is disclosed in the panel as a company attribute
      and not as a fact about the city.

   🔴 DETERMINISTIC, ALWAYS. Candidate #7 for `shop` is the same company with
      the same name and the same size in every session, on every device, before
      and after a reload — the same contract /src/naming's generator ships under
      and for the same reason it was written down there: "a business that
      renames itself across a reload is the single worst failure this system can
      have". There is no Math.random in this file.

   ⚠ THE NAME COMES FROM /src/naming, NOT FROM A SECOND GENERATOR. `generate()`
     is imported directly. Two name machines in one city is how a shop ends up
     called one thing on its sign and another in a list.
   ══════════════════════════════════════════════════════════════════════════ */

import { generate, hash32 } from '../naming/generate.js';
import { TEN } from './tuning.js';

const SIZES = TEN.sizes;
const SIZE_BY_ID = SIZES.reduce((a, s) => (a[s.id] = s, a), {});
export { SIZE_BY_ID };

/* Weighted draw over the size table, from a 32-bit seed. Weighted rather than
   uniform because a city is mostly independents with a few chains in it — the
   shape "one Ouroboros Mega Store, forty corner shops" the brief's own upgrade
   ladder describes. */
function sizeFor(seed) {
  let tot = 0; for (const s of SIZES) tot += s.w;
  let r = (seed % 10000) / 10000 * tot;
  for (const s of SIZES) { r -= s.w; if (r < 0) return s; }
  return SIZES[0];
}

export function makePool() {
  /* The per-city salt. Rides the save (store.js) so a city keeps its companies;
     regenerated only for a city that has never had one. */
  let salt = '';
  const cache = new Map();          // want -> [candidate]

  function setSalt(s) {
    const v = String(s || '');
    if (v === salt) return;
    salt = v; cache.clear();
  }

  /* Candidate `i` for a building type. Pure. */
  function make(want, i) {
    const h = hash32(salt + '|cand|' + want + '|' + i);
    const size = sizeFor(h);
    return {
      id: want + '#' + i,
      want, i, size,
      /* ⚠ The generator is seeded on (salt, type, x, z, attempt). A candidate
         has no coordinates, so `i` stands in for x and the size index for z —
         which keeps every candidate's draw independent of every tile's, so no
         company is ever named the same thing as the shop on that square by
         construction of the seed. */
      name: generate(salt + '|tenant', want, i, size.i, 0),
    };
  }

  function series(want, n) {
    let arr = cache.get(want);
    if (!arr) { arr = []; cache.set(want, arr); }
    while (arr.length < n) arr.push(make(want, arr.length));
    return arr;
  }

  /* How many companies are in the market for this trade. Derived from how many
     LOTS could take it, so a player who paints a bigger district gets a bigger
     field of bidders rather than the same six. */
  function sizeOf(lots) {
    const n = Math.ceil(Math.max(0, lots | 0) * TEN.pool.perLot);
    return Math.max(TEN.pool.floor, Math.min(TEN.pool.maxPerWant, n));
  }

  /* THE BIDDERS: every candidate for this trade that has not got premises.
     `housed` is the set of candidate ids currently holding a tenancy — owned by
     store.js, passed in, never mirrored here. */
  function bidders(want, housed, lots) {
    const all = series(want, sizeOf(lots));
    const out = [];
    for (const c of all) if (!housed.has(c.id)) out.push(c);
    return out;
  }

  function byId(id) {
    if (typeof id !== 'string') return null;
    const at = id.lastIndexOf('#');
    if (at < 0) return null;
    const want = id.slice(0, at), i = +id.slice(at + 1);
    if (!want || !isFinite(i) || i < 0) return null;
    return make(want, i);
  }

  function stats(wants, housed, lotsOf) {
    const per = {};
    let cands = 0, free = 0;
    for (const w of wants) {
      const n = sizeOf(lotsOf ? lotsOf(w) : 0);
      const b = bidders(w, housed, lotsOf ? lotsOf(w) : 0);
      per[w] = { pool: n, bidding: b.length, lots: lotsOf ? lotsOf(w) : 0 };
      cands += n; free += b.length;
    }
    return { candidates: cands, unhoused: free, per };
  }

  return { setSalt, salt: () => salt, make, series, sizeOf, bidders, byId, stats,
           SIZES, SIZE_BY_ID };
}

export default { makePool, SIZE_BY_ID };
