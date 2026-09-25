/* ══════════════════════════════════════════════════════════════════════════
   🎲 THE GENERATOR — a seeded, offline, deterministic business-name machine.

   THE CONTRACT, and every clause of it was chosen because breaking it is a
   bug the player sees:

     1. STABLE. name(salt, type, x, z, attempt) is a pure function. Reload the
        page, reopen the save on another device, rebuild the register from
        scratch — the same tile produces the same name. A business that
        renames itself across a reload is the single worst failure this system
        can have, so the seed is the tile's own coordinates plus a per-city
        salt and NOTHING else. No Math.random anywhere in this file.
        (The same trap already bit `makeHousing`: a wrapper swallowed the tile
        coords, every house fell back to Math.random and re-rolled its
        archetype on every load. See the buildMesh wrapper's comment in
        node-city/index.html.)

     2. OFFLINE. No fetch, no LLM, no CDN. The page's import map cannot even
        reach jsdelivr in the harness.

     3. SUITED TO THE TYPE. The trade noun and the grammar both come from the
        building type, so a shop and a foundry are named by different rules.

   `attempt` is the de-duplicator's re-roll counter: same tile, different name.
   It is part of the seed rather than an index into a list, so attempt 1 is a
   completely different draw and not "the next surname along".
   ══════════════════════════════════════════════════════════════════════════ */
import { GIVEN, SURNAME, PLACE, ADJECTIVE, OBJECT, SUFFIX, HOUSE_WORD,
         PATTERNS, TRADE, GENERIC } from './words.js';

/* FNV-1a. Small, fast, no dependency, and stable across engines — the last
   part matters: a hash that differed between browsers would give the same
   save different names on a phone and a laptop. */
export function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* mulberry32 — 32-bit, seedable, good enough for picking words and cheap
   enough to call a few hundred times during a load without being felt. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

export function registerOf(type) {
  const row = TRADE[type] || GENERIC;
  return row[0];
}

export function tradesOf(type) {
  const row = TRADE[type] || GENERIC;
  return row[1];
}

/* The whole grammar. Tokens:
     {G} given name   {S} surname   {S2} a DIFFERENT surname
     {P} place        {A} adjective {O} object
     {T} trade noun   {X} firm suffix  {H} residential block word          */
function fill(pattern, r, trades) {
  const s1 = pick(r, SURNAME);
  let s2 = pick(r, SURNAME);
  /* Two identical surnames in "{S} & {S2}" reads as a typo, not a partnership.
     One nudge is enough — the pools are 72 long. */
  if (s2 === s1) s2 = SURNAME[(SURNAME.indexOf(s1) + 7) % SURNAME.length];
  const map = {
    '{G}': () => pick(r, GIVEN),
    '{S}': () => s1,
    '{S2}': () => s2,
    '{P}': () => pick(r, PLACE),
    '{A}': () => pick(r, ADJECTIVE),
    '{O}': () => pick(r, OBJECT),
    '{T}': () => pick(r, trades),
    '{X}': () => pick(r, SUFFIX),
    '{H}': () => pick(r, HOUSE_WORD),
  };
  /* ⚠ Ordered replace, not a global regex with a callback over the whole
     string: {S2} contains {S} as a prefix in no regex sense but DOES collide
     when replaced naively left to right, so the longer token is consumed
     first. Getting this wrong produced "Ashby2 & Co." exactly once. */
  let out = pattern;
  for (const tok of ['{S2}', '{G}', '{S}', '{P}', '{A}', '{O}', '{T}', '{X}', '{H}']) {
    while (out.indexOf(tok) >= 0) out = out.replace(tok, map[tok]());
  }
  return out.replace(/\s+/g, ' ').trim();
}

/* The one entry point. `opts.tenant` is the leased-plot case: a plot let to a
   real player is that player's business, so their name goes on the sign
   instead of a generated stranger's. */
export function generate(salt, type, x, z, attempt, opts) {
  const o = opts || {};
  const reg = registerOf(type);
  const trades = tradesOf(type);
  const r = rng(hash32(salt + '|' + type + '|' + x + '|' + z + '|' + (attempt | 0)));
  if (o.tenant) {
    const t = String(o.tenant).trim();
    if (t) return (t + "'s " + pick(r, trades)).slice(0, 48);
  }
  const pats = PATTERNS[reg] || PATTERNS.retail;
  return fill(pick(r, pats), r, trades).slice(0, 48);
}
