// ─────────────────────────────────────────────────────────────────────────────
// Turning a drafted run into the thing the engine is actually handed.
//
// The ONLY path a Warpath pool takes into a battle is:
//   warpath-app.js:1256  card_keys = every card in the pool, secured or not
//   index.html:215643    warpathPadDeck(keys) — cycle the pool up to DECK_SIZE
//   index.html:215677    saved as a normal 40-card deck, played as a normal deck
// so `padded()` here calls the game's own warpathPadDeck through the browser
// rather than reproducing it.
// ─────────────────────────────────────────────────────────────────────────────
import { runExpedition, Data } from './draft.mjs';

/** A pool truncated to exactly `nGained` drafted cards on top of the starter.
 *  Lets a measured distribution (the four-player sim saw 3–13 discovered) and
 *  the brief's intended 40 be tested against the SAME real draft stream. */
export function poolWithGains(run, nGained) {
  const gains = run.gains;
  return Data.STARTER_POOL.concat(gains.slice(0, nGained));
}

/** Draft `n` independent runs. Each gets its own map seed and spawn slot, so
 *  two pools are as independent as two players entering different worlds. */
export function draftPools(n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const seed = ((opts.seed0 || 1) + i * 7919) >>> 0;
    out.push(runExpedition({
      seed, slot: i % 4, turns: opts.turns != null ? opts.turns : 60,
      pick: opts.pick || 'value', target: opts.target || null,
      style: opts.style || 'explore', buildOrder: opts.buildOrder,
    }));
  }
  return out;
}

/** Static shape of a pool — the parts you can know without playing it. */
export function shape(keys, meta) {
  const byType = {}, curve = {}, counts = {};
  let unknown = 0;
  for (const k of keys) {
    const m = meta[k];
    if (!m) { unknown++; continue; }
    byType[m.type] = (byType[m.type] || 0) + 1;
    curve[m.cost | 0] = (curve[m.cost | 0] || 0) + 1;
    counts[m.id] = (counts[m.id] || 0) + 1;
  }
  const over = Object.entries(counts).filter(([, v]) => v > 3);
  return {
    size: keys.length, unknown, distinct: Object.keys(counts).length,
    units: byType.unit || 0, spells: byType.spell || 0, traps: byType.trap || 0,
    locations: byType.location || 0, weather: byType.weather || 0,
    curve,
    avgCost: keys.length ? keys.reduce((a, k) => a + ((meta[k] || {}).cost | 0), 0) / keys.length : 0,
    overLimit: over.map(([id, v]) => `${id}×${v}`),
    // Only ONE location and ONE weather can be in play at a time
    // (state.activeLocation / state.weather), so every copy past the first is
    // competing for the same single slot.
    singleSlotSurplus: Math.max(0, (byType.location || 0) - 1) + Math.max(0, (byType.weather || 0) - 1),
  };
}
