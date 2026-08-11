/* ============================================================================
 * RESONANCE — the seam.                            round 8 / piece: resonance
 * ----------------------------------------------------------------------------
 * Registers `window.MythicResonance`. Everything above it (model/field/face)
 * is pure; this file is the only place that touches the outside world, and
 * even here the outside world is reached through exactly one object.
 *
 * 🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `App`, `Cloud`, `Forge` are
 * top-level `const` in index.html — global LEXICAL bindings, NOT properties of
 * window. `window.Profile` being truthy in a console is not evidence; an ES
 * module still cannot rely on it. So this module reaches nothing by name. It
 * uses `window.MythicBridge.resonance*`, which index.html hands over
 * explicitly, and if the bridge is missing it degrades to an in-memory store
 * and keeps working rather than throwing into a battle.
 *
 * PUBLIC SURFACE  (this is the contract the House builder consumes — §HOUSE)
 *   MythicResonance.get(key)                -> normalized spread (never null)
 *   MythicResonance.total(key)              -> 0..510
 *   MythicResonance.remaining(key)          -> 510 - total
 *   MythicResonance.headroom(key, stat)     -> what `stat` can still take
 *   MythicResonance.rank(key)               -> { id, name, bars, glow, sigil }
 *   MythicResonance.statBonus(key)          -> { hp, atk, mag, def, res, spd, spdTiles }
 *   MythicResonance.grant(key, stat, n, o)  -> { ok, granted, spread, rank, reason }
 *   MythicResonance.grantMany(key, bag, o)  -> { ok, granted, total, spread, rank }
 *   MythicResonance.add(key, stat, n)       -> number granted   🏠 House door
 *   MythicResonance.isFull(key)             -> total >= 510
 *   MythicResonance.statFull(key, stat)     -> that stat can take no more
 *   MythicResonance.reset(key, o)           -> { ok, spread }
 *   MythicResonance.applyBoosts(stats, maxHp, spread) -> { stats, maxHp }
 *   MythicResonance.face.{ faceHTML, markHTML, radialSVG, injectStyle }
 *   MythicResonance.field.{ record, settle, raw, begin }
 *   MythicResonance.onChange(fn) -> unsubscribe
 *   MythicResonance.MODEL, .SOURCES, .VERSION
 * ==========================================================================*/

import * as M from './model.js';
import { Ledger } from './field.js';
import * as FACE from './face.js';

const VERSION = 'r8-resonance-1.0.0';

/* ------------------------------------------------------------------ *
 * 🔴 ANTI-PATTERN #1 IS ENFORCED IN CODE, NOT IN A COMMENT.
 * "Let paid currency buy Resonance → it becomes pay-to-win the moment it
 *  does." (doc §9). Every grant must name a source, and a source that is or
 * looks like real money / premium currency is REFUSED — grant() returns
 * ok:false and nothing is written. A future House, shop, event or admin tool
 * physically cannot route Cinder into a spread without editing this list,
 * which is a thing a reviewer will see.
 * ------------------------------------------------------------------ */
const ALLOWED_SOURCES = ['field', 'house', 'bunkhouse', 'reflection', 'admin', 'migration'];
const DENIED_SOURCE_RE = /gem|cinder|paid|pay|iap|purchase|buy|bought|store|shop|premium|sovereign|money|usd|stripe/i;

const listeners = new Set();
let ledger = new Ledger();
const memory = Object.create(null);   // fallback store when no bridge exists
let bridgeMissingWarned = false;

function bridge() {
  try {
    const b = (typeof window !== 'undefined') ? window.MythicBridge : null;
    if (b && typeof b.resonanceGet === 'function' && typeof b.resonanceSet === 'function') return b;
  } catch (e) {}
  if (!bridgeMissingWarned) {
    bridgeMissingWarned = true;
    try { console.warn('[resonance] MythicBridge.resonanceGet/Set missing — spreads are in memory only for this session.'); } catch (e) {}
  }
  return null;
}

function readRaw(key) {
  const b = bridge();
  if (b) { try { return b.resonanceGet(key); } catch (e) { return null; } }
  return memory[key] || null;
}

function writeRaw(key, spread, save) {
  const b = bridge();
  if (b) {
    try {
      b.resonanceSet(key, spread);
      if (save !== false && typeof b.saveProfile === 'function') b.saveProfile();
      return true;
    } catch (e) { return false; }
  }
  memory[key] = spread;
  return true;
}

function emit(key, spread, meta) {
  for (const fn of listeners) { try { fn(key, spread, meta || {}); } catch (e) {} }
}

function validKey(key) { return !!key && typeof key === 'string'; }

/* ------------------------------------------------------------------ *
 * READS. All absent-tolerant: a card with no entry, a corrupt entry, a
 * key that has never existed — every one of these returns a clean zeroed
 * spread rather than null, so no caller ever needs a guard.
 * ------------------------------------------------------------------ */
function get(key)              { return M.normalize(validKey(key) ? readRaw(key) : null); }
function totalOf(key)          { return M.total(get(key)); }
function remainingOf(key)      { return M.remaining(get(key)); }
function headroomOf(key, stat) { return M.headroom(get(key), stat); }
function rankOf(key)           { return M.rank(get(key)); }
function statBonusOf(key)      { return M.statBonus(get(key)); }

/* ------------------------------------------------------------------ *
 * WRITES.
 * ------------------------------------------------------------------ */
function checkSource(opts) {
  const src = String((opts && opts.source) || '').toLowerCase();
  if (!src) return { ok: false, reason: 'a source is required (one of: ' + ALLOWED_SOURCES.join(', ') + ')' };
  if (DENIED_SOURCE_RE.test(src)) return { ok: false, reason: 'REFUSED — paid currency can never buy Resonance (doc §9)' };
  if (ALLOWED_SOURCES.indexOf(src) < 0) return { ok: false, reason: 'unknown source "' + src + '"' };
  return { ok: true, source: src };
}

/**
 * Add Resonance to one stat. THE DOOR THE HOUSE COMES THROUGH.
 * Enforces the 510 budget and the 252 per-stat cap; a grant that would exceed
 * either is trimmed, not refused, and `granted` tells the caller what landed.
 * There is no argument that can raise either cap.
 */
function grant(key, stat, amount, opts) {
  const src = checkSource(opts);
  if (!src.ok) return { ok: false, granted: 0, spread: get(key), rank: rankOf(key), reason: src.reason };
  if (!validKey(key)) return { ok: false, granted: 0, spread: M.empty(), rank: M.rank(null), reason: 'bad card key' };
  const before = get(key);
  const r = M.award(before, stat, amount);
  if (r.granted > 0) writeRaw(key, r.spread, opts && opts.save);
  const rk = M.rank(r.spread);
  if (r.granted > 0) emit(key, r.spread, { source: src.source, stat, granted: r.granted, rank: rk });
  return { ok: true, granted: r.granted, refused: r.refused, spread: r.spread, rank: rk, before };
}

/** Add a whole bag at once: grantMany(key, { atk: 3, def: 1 }, { source:'field' }). */
function grantMany(key, bag, opts) {
  const src = checkSource(opts);
  if (!src.ok) return { ok: false, granted: M.empty(), total: 0, spread: get(key), rank: rankOf(key), reason: src.reason };
  if (!validKey(key)) return { ok: false, granted: M.empty(), total: 0, spread: M.empty(), rank: M.rank(null), reason: 'bad card key' };
  const before = get(key);
  const r = M.awardMany(before, bag);
  if (r.total > 0) writeRaw(key, r.spread, opts && opts.save);
  const rk = M.rank(r.spread);
  if (r.total > 0) emit(key, r.spread, { source: src.source, granted: r.granted, rank: rk });
  return { ok: true, granted: r.granted, total: r.total, spread: r.spread, rank: rk, before };
}

/* ------------------------------------------------------------------ *
 * 🏠 THE HOUSE CONTRACT.
 * The House builder is working in parallel and duck-types three calls off
 * this object: `add(card, stat, amount) -> number granted`, `get(card)` and
 * `reset(card)` (see /src/resonance/house.city.js `model()`). Those are
 * thin, named adapters over grant()/reset() so the two pieces meet without
 * either one having to guess. `add` returns a NUMBER, not a result object,
 * because the House needs to know how much of its accrual actually landed so
 * it can leave the remainder pending rather than silently burning it.
 *
 * `source` defaults to 'house' here — but a source that is passed and looks
 * like currency is still refused, so the enforcement is not weakened: a shop
 * would have to actively lie about where the Resonance came from, and that
 * lie is one grep away in review.
 * ------------------------------------------------------------------ */
function add(key, stat, amount, opts) {
  const o = Object.assign({ source: 'house' }, opts || {});
  const r = grant(key, stat, amount, o);
  if (!r.ok) { try { console.warn('[resonance] add refused:', r.reason); } catch (e) {} return 0; }
  return r.granted | 0;
}

/** 🔁 Free and total. §9: resets must stay cheap or experimentation dies. */
function reset(key, opts) {
  const src = checkSource(Object.assign({ source: 'reflection' }, opts || {}));
  if (!src.ok) return { ok: false, spread: get(key), reason: src.reason };
  if (!validKey(key)) return { ok: false, spread: M.empty(), reason: 'bad card key' };
  const before = get(key);
  const spread = M.reset();
  writeRaw(key, spread, opts && opts.save);
  emit(key, spread, { source: src.source, reset: true, before });
  return { ok: true, spread, before, rank: M.rank(spread) };
}

/* ------------------------------------------------------------------ *
 * STAT APPLICATION — called from buildUnit in index.html, downstream of
 * applyEvBoosts and upstream of applyHeldItem.
 *
 * ⚠ SPD does not become movement range 1:1; see model.statBonus() for why
 * (the engine treats stats.spd as a 1–5 movement TIER and Trick Room mirrors
 * it with `6 - speed`, which breaks above 5). The tile gain is +1 at half the
 * stat cap and +2 at the cap, and the result is clamped to 5.
 * ------------------------------------------------------------------ */
function applyBoosts(stats, maxHp, spread) {
  const s = stats || {};
  const b = M.statBonus(spread);
  return {
    stats: Object.assign({}, s, {
      atk: (s.atk || 0) + b.atk,
      def: (s.def || 0) + b.def,
      mag: (s.mag || 0) + b.mag,
      res: (s.res || 0) + b.res,
      spd: Math.min(5, (s.spd || 1) + b.spdTiles),
    }),
    maxHp: (maxHp || 0) + b.hp,
  };
}

/* ------------------------------------------------------------------ *
 * ⚔ PATH B wiring. index.html emits into `record`; nothing is written to a
 * profile until `settleBattle()` runs at the real end-of-battle commit
 * (recordBattleProgress), which is already guarded against replays and
 * double-award by App.battleProgressRecorded.
 * ------------------------------------------------------------------ */
function record(ev) { try { return ledger.record(ev); } catch (e) { return false; } }

function beginBattle() { ledger = new Ledger(); return true; }

/**
 * Settle the battle ledger into real Resonance. Returns a per-card report:
 *   { 'u:goblin': { granted:{atk:3,...}, total:3, rank:'blooded', spread:{…} } }
 * Always clears the ledger, even if a write fails, so a second call cannot
 * pay twice.
 */
function settleBattle() {
  let bags = {};
  try { bags = ledger.settle(); } catch (e) { bags = {}; }
  const rawBefore = (() => { try { return ledger.raw(); } catch (e) { return {}; } })();
  ledger = new Ledger();
  const report = {};
  for (const key in bags) {
    const before = get(key);
    const r = grantMany(key, bags[key], { source: 'field', save: false });
    report[key] = {
      raw: rawBefore[key] || null,
      asked: bags[key],
      granted: r.granted,
      total: r.total,
      before,
      spread: r.spread,
      rank: r.rank ? r.rank.id : 'unproven',
    };
  }
  try {
    const b = bridge();
    if (b && typeof b.saveProfile === 'function' && Object.keys(report).length) b.saveProfile();
  } catch (e) {}
  return report;
}

/* ------------------------------------------------------------------ *
 * REGISTER
 * ------------------------------------------------------------------ */
const API = {
  VERSION,
  MODEL: M,
  SOURCES: ALLOWED_SOURCES.slice(),
  get, total: totalOf, remaining: remainingOf, headroom: headroomOf,
  rank: rankOf, statBonus: statBonusOf,
  grant, grantMany, reset, applyBoosts,
  add,                                   // 🏠 the House's door — see above
  // The House also wants to know when to stop accruing into a stat.
  isFull: (key) => M.total(get(key)) >= M.TOTAL_CAP,
  statFull: (key, stat) => M.headroom(get(key), stat) <= 0,
  face: FACE,
  field: {
    record, begin: beginBattle, settle: settleBattle,
    raw: () => { try { return ledger.raw(); } catch (e) { return {}; } },
    pending: () => { try { return ledger.settle(); } catch (e) { return {}; } },
    stats: () => ({ events: ledger.events, dropped: ledger.dropped, cards: Object.keys(ledger.cards).length }),
  },
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicResonance = API;
    /* Drain anything index.html emitted before this deferred module evaluated.
       A battle cannot start before boot finishes, so in practice this is
       empty — but dropping events silently is exactly how save bugs start. */
    const q = window.MythicResonanceEvents;
    if (Array.isArray(q)) { while (q.length) record(q.shift()); }
    window.MythicResonanceEvents = { push: record, length: 0 };
    try { FACE.injectStyle(document); } catch (e) {}
    try { console.info('[resonance] ' + VERSION + ' ready — 510 budget / 252 cap / 4:1.'); } catch (e) {}
  }
} catch (e) {
  try { console.warn('[resonance] registration failed', e); } catch (_) {}
}

export default API;
