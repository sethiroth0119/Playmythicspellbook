/* ══════════════════════════════════════════════════════════════════════════
   🎲 SEEDED RANDOMNESS — the reason a reload does not rewrite history.

   Nothing in this feature calls Math.random(). Every choice the composer makes
   is drawn from a stream seeded on a STABLE string: the citizen's id, the tile
   key, the event's own identity. That is the same technique makeHousing uses
   (seeded on tile coords) and /src/naming uses (seeded per business), and it
   buys three separate things:

     · a citizen's VOICE is the same in every session, so you recognise a
       regular rather than meeting a stranger with a familiar name;
     · the same event composes to the same sentence, so a driver can assert on
       the text instead of on "a string appeared";
     · a like count the player already read never re-rolls under them.

   xmur3 → mulberry32, both public-domain integer hashes. No dependency (see
   CLAUDE.md: no new npm packages).
   ══════════════════════════════════════════════════════════════════════════ */

/* String → 32-bit seed. */
export function hashStr(str) {
  let h = 1779033703 ^ String(str == null ? '' : str).length;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/* Seed → a 0..1 stream. */
export function rngFrom(seed) {
  let a = (typeof seed === 'string' ? hashStr(seed) : (seed >>> 0)) || 1;
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* One element. Empty array is a defined answer (null), never a throw — every
   pool in phrases.js is filtered by voice and a filter CAN come back empty. */
export function pick(rnd, arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

/* n distinct elements, order preserved-ish. Used for hashtags, where drawing
   the same tag twice would print "#air #air". */
export function pickSome(rnd, arr, n) {
  if (!arr || !arr.length || n <= 0) return [];
  const pool = arr.slice(), out = [];
  const want = Math.min(n, pool.length);
  for (let i = 0; i < want; i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

/* A weighted pick over [{ w, ...}] — for poster selection, where a citizen the
   problem actually hits should be likelier to speak than one it does not. */
export function pickWeighted(rnd, rows) {
  if (!rows || !rows.length) return null;
  let total = 0;
  for (const r of rows) total += Math.max(0, +r.w || 0);
  if (total <= 0) return rows[Math.floor(rnd() * rows.length) % rows.length];
  let t = rnd() * total;
  for (const r of rows) { t -= Math.max(0, +r.w || 0); if (t <= 0) return r; }
  return rows[rows.length - 1];
}

/* ±frac around 1, seeded. Kept here rather than inline in likes.js because it
   is the one place a "little noise" is allowed to touch a MEASUREMENT, and it
   should be readable in isolation. */
export function jitter(rnd, frac) {
  const f = Math.max(0, +frac || 0);
  return 1 + (rnd() * 2 - 1) * f;
}

export default { hashStr, rngFrom, pick, pickSome, pickWeighted, jitter };
