/* ════════════════════════════════════════════════════════════════════════════
   🕯 MEMORIAL — module entry. Registers window.MythicMemorial.
   ----------------------------------------------------------------------------
   index.html contributes `window.MythicMemorialBridge` and calls ONE function
   at the moment of a permadeath, BEFORE the hero is deleted:

       MythicMemorial.record(hero, { cause:'bledOut', killedBy, battleName })

   …plus `MythicMemorial.open()` for the wall itself.

   🔴 CALL `record()` BEFORE THE DELETION. `_stabilizePermadeath` in index.html
   removes the unit from Profile.units, its equipment, and every deck entry
   referencing it. Once that has run, the level, kill count and bond this module
   engraves are gone with no way to recover them. The call site is one line
   above the delete for exactly this reason — do not move it below.

   🔴 APPEND-ONLY. There is no remove(), no edit(), no clear(). See the note in
   memorial.data.js. Ledgers in this codebase are append-only and a memorial is
   the most obviously append-only thing in it.

   ⚠ Writes to the SAME `Profile.memorial` array the camp's existing wall
   already uses, so old survivor rows and new hero rows appear on one wall, in
   one order. Nothing about the legacy rows changes.
   ════════════════════════════════════════════════════════════════════════════ */

import { recordFor, normalise, sorted, summarise, causeOf, CAUSES, epitaphFor } from './memorial.data.js';
import { openWall } from './memorial.ui.js';

function b() { try { return window.MythicMemorialBridge || null; } catch (e) { return null; } }

let _warned = false;
function ready() {
  if (b()) return true;
  if (!_warned) { _warned = true; try { console.warn('[memorial] window.MythicMemorialBridge absent — hero deaths will not be recorded.'); } catch (e) {} }
  return false;
}

function rows() {
  try { return (b() && b().memorial && b().memorial()) || []; } catch (e) { return []; }
}

/* Engrave a hero. Returns the row written, or null.
   Wrapped to the point of paranoia: a throw here would be inside the death
   path, and losing a hero AND crashing the battle is strictly worse than
   losing a hero. */
function record(hero, ctx) {
  if (!ready() || !hero) return null;
  try {
    const row = recordFor(hero, ctx || {});

    // Supports the fallen hero had — the relationship context is most of what
    // makes a death land, and it is about to become unreachable too.
    try {
      const S = window.MythicSupports;
      if (S && S.roster) {
        row.supports = S.roster()
          .filter(r => (r.a === row.heroId || r.b === row.heroId) && r.unlocked !== 'none')
          .map(r => ({
            with: r.a === row.heroId ? r.bName : r.aName,
            rank: r.unlocked,
          }));
      }
    } catch (e) {}

    const list = rows();
    list.push(row);
    try { b().setMemorial && b().setMemorial(list); } catch (e) {}
    try { b().save && b().save(); } catch (e) {}

    try {
      b().toast && b().toast(`🕯 ${row.name} added to the Memorial Wall — ${row.epitaph}`, 6000);
    } catch (e) {}

    return row;
  } catch (e) {
    try { console.warn('[memorial] record failed — the hero is still lost, the record is not', e); } catch (e2) {}
    return null;
  }
}

/* Record a camp survivor (the legacy path), in the richer shape. index.html's
   existing `_campMemorial().push(...)` calls keep working untouched; this is
   for new call sites that have more to say. */
function recordSurvivor(meta, ctx) {
  if (!ready() || !meta) return null;
  try {
    const list = rows();
    const row = {
      id: 'mem_' + Date.now().toString(36),
      kind: 'survivor',
      name: meta.name || 'Survivor',
      icon: meta.icon || '❔',
      causeKey: (ctx && ctx.cause) || 'run',
      ts: Date.now(),
      daysServed: (ctx && ctx.daysServed) || null,
    };
    list.push(row);
    try { b().setMemorial && b().setMemorial(list); } catch (e) {}
    try { b().save && b().save(); } catch (e) {}
    return row;
  } catch (e) { return null; }
}

function all() { return sorted(rows()); }
function stats() { return summarise(rows()); }

/* The count for a camp badge. Cheap — called on every camp render. */
function count() { try { return rows().length; } catch (e) { return 0; } }

function open(filter) {
  if (!ready()) return;
  try { openWall(all(), stats(), filter); }
  catch (e) { try { console.warn('[memorial] wall failed to open', e); } catch (e2) {} }
}

try {
  window.MythicMemorial = {
    record, recordSurvivor,
    all, stats, count, open,
    normalise, causeOf, epitaphFor, CAUSES,
    available: () => ready(),
    VERSION: 'memorial-1.0.0',
  };
  try { console.info('%c🕯 MythicMemorial%c ready.', 'color:#e0879a;font-weight:700', 'color:inherit'); } catch (e) {}
} catch (e) {}
