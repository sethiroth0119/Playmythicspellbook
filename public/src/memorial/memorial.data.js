/* ════════════════════════════════════════════════════════════════════════════
   🕯 THE MEMORIAL — where the dead go, and what they did.
   ----------------------------------------------------------------------------
   A Memorial Wall already existed for camp SURVIVORS (the workforce NPCs lost
   on runs and raids) — `Profile.memorial`, rows of `{name, icon, cause, ts}`.
   It is a list of names with no history, and HEROES never reached it at all:
   `_stabilizePermadeath` in index.html deletes a bled-out hero from
   Profile.units and the player's collection, and that is the end of them.

   This module keeps that wall and gives it a memory.

   🔴 THE EXISTING ROWS MUST KEEP WORKING. `Profile.memorial` stays exactly
   where it is and keeps its old shape; this module READS it and writes richer
   rows alongside. A migration that rewrote those rows would throw away the only
   record of every survivor already lost, on a wall whose entire purpose is that
   nothing is thrown away. So: new fields are ADDITIVE and every reader treats
   them as optional. `normalise()` below is what makes a 4-field legacy row and
   a 20-field hero row render through one code path.

   🔴 THE RECORD IS WRITTEN BEFORE THE DELETION.
   A hero's stats live on the object `_stabilizePermadeath` is about to delete.
   Capture first, delete second — reversing that order gives you a tombstone
   with no name on it, and there is no way to recover it afterwards.

   ⚠ Deaths are APPEND-ONLY, like every ledger in this codebase. Nothing here
   edits or removes a row. A wall you can clear is not a memorial.
   ════════════════════════════════════════════════════════════════════════════ */

export const CAUSES = {
  bledOut:    { icon: '🩸', label: 'Bled out',        color: '#e0556a' },
  killed:     { icon: '⚔',  label: 'Killed in action', color: '#e0556a' },
  raid:       { icon: '🔥', label: 'Camp raid',        color: '#ff8c4a' },
  run:        { icon: '🗺', label: 'Lost on a run',    color: '#c9a24a' },
  rival:      { icon: '🗡', label: 'Rival strike',     color: '#c05a8a' },
  rescue:     { icon: '🚑', label: 'Rescue op',        color: '#5aa0c0' },
  deserted:   { icon: '🚪', label: 'Deserted',         color: '#7a8090' },
  turned:     { icon: '☣',  label: 'Turned',           color: '#8ac05a' },
  factionWar: { icon: '⚑',  label: 'Faction war',      color: '#a05ac0' },
  overrun:    { icon: '💀', label: 'Camp overrun',     color: '#e0556a' },
  unknown:    { icon: '❔', label: 'Lost',             color: '#7a8090' },
};

export function causeOf(key) {
  if (!key) return CAUSES.unknown;
  if (CAUSES[key]) return CAUSES[key];
  // Legacy rows store a free-text cause ('Rival Strike', 'Camp Overrun', …).
  // Match loosely so old entries still get an icon instead of falling to '❔'.
  const k = String(key).toLowerCase().replace(/[^a-z]/g, '');
  for (const id of Object.keys(CAUSES)) {
    if (id.toLowerCase() === k) return CAUSES[id];
    if (CAUSES[id].label.toLowerCase().replace(/[^a-z]/g, '') === k) return CAUSES[id];
  }
  return { ...CAUSES.unknown, label: String(key) };
}

/* 🔴 NEVER `| 0` A TIMESTAMP. Date.now() is ~1.76e12, well past the 2^31 that
   a bitwise OR truncates to — `1758946334000 | 0` is -1758946334, a NEGATIVE
   number that sorts every row to the wrong end of the wall and makes
   `summarise()` report a first loss before the epoch. The browser mount probe
   caught exactly that. `| 0` is used freely elsewhere in this codebase for
   counts and levels, where it is correct and idiomatic; it is never correct
   for a millisecond timestamp. */
function ts(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* One row, whatever it came from. THE compatibility seam — see the header. */
export function normalise(row) {
  if (!row) return null;
  const c = causeOf(row.causeKey || row.cause);
  return {
    id: row.id || (String(row.name || '?') + ':' + ts(row.ts)),
    kind: row.kind || (row.heroId || row.cardId ? 'hero' : 'survivor'),
    name: String(row.name || 'Unknown'),
    icon: row.icon || c.icon,
    cause: c.label,
    causeIcon: c.icon,
    causeColor: c.color,
    ts: ts(row.ts),
    // Everything below is OPTIONAL — a legacy row simply has none of it, and
    // every renderer must cope with that.
    heroId: row.heroId || null,
    level: row.level != null ? (row.level | 0) : null,
    kills: row.kills != null ? (row.kills | 0) : null,
    battles: row.battles != null ? (row.battles | 0) : null,
    wins: row.wins != null ? (row.wins | 0) : null,
    daysServed: row.daysServed != null ? (row.daysServed | 0) : null,
    bond: row.bond != null ? (row.bond | 0) : null,
    traits: Array.isArray(row.traits) ? row.traits : [],
    supports: Array.isArray(row.supports) ? row.supports : [],
    lastWords: row.lastWords || null,
    killedBy: row.killedBy || null,
    battleName: row.battleName || null,
    epitaph: row.epitaph || null,
  };
}

/* Build the record for a hero about to be lost. Called BEFORE the deletion —
   see the header. `hero` is the live object with all its accumulated stats. */
export function recordFor(hero, ctx) {
  const c = ctx || {};
  const firstSeen = hero && (hero.acquiredAt || hero.createdAt || 0);
  return {
    id: 'mem_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e4).toString(36),
    kind: 'hero',
    heroId: hero && (hero.id || hero.cardId) || null,
    name: (hero && hero.name) || 'Unknown',
    icon: (hero && hero.icon) || '🪦',
    causeKey: c.cause || 'killed',
    ts: Date.now(),
    level: (hero && hero.level) | 0,
    kills: (hero && hero.kills) | 0,
    battles: (hero && hero.battles) | 0,
    wins: (hero && hero.wins) | 0,
    bond: (hero && hero.bond) | 0,
    traits: (hero && hero.traits) || [],
    daysServed: firstSeen ? Math.max(0, Math.floor((Date.now() - firstSeen) / 86400000)) : null,
    killedBy: c.killedBy || null,
    battleName: c.battleName || null,
    supports: c.supports || [],
    lastWords: c.lastWords || null,
    epitaph: epitaphFor(hero, c),
  };
}

/* An epitaph generated from what they actually did. Deliberately terse — a
   sentence, not a eulogy — and chosen by their record rather than at random,
   so the line is TRUE of that hero and reads as earned. */
export function epitaphFor(hero, ctx) {
  const kills = (hero && hero.kills) | 0;
  const battles = (hero && hero.battles) | 0;
  const bond = (hero && hero.bond) | 0;
  const lvl = (hero && hero.level) | 0;
  const c = ctx || {};

  if (battles === 0) return 'Never saw a fight. Lost all the same.';
  if (c.cause === 'bledOut') return 'Nobody reached them in time.';
  if (c.revivedOthers) return `Pulled ${c.revivedOthers} back from the edge. Nobody pulled them.`;
  if (kills >= 100) return `${kills} confirmed. The camp will not need to be told who.`;
  if (bond >= 900) return 'Sworn to the end of it, and past.';
  if (bond >= 400) return 'Trusted. Which was not a thing they gave away.';
  if (battles >= 50) return `${battles} deployments. Walked out of all but one.`;
  if (lvl >= 20) return 'Learned every hard lesson this place teaches.';
  if (kills === 0) return 'Never took a life. Held the line anyway.';
  return `${battles} fight${battles === 1 ? '' : 's'}, ${kills} kill${kills === 1 ? '' : 's'}. Enough.`;
}

/* Aggregate stats for the header — the wall should say something about the
   cost of the campaign as a whole, not just list names. */
export function summarise(rows) {
  const list = (rows || []).map(normalise).filter(Boolean);
  const heroes = list.filter(r => r.kind === 'hero');
  return {
    total: list.length,
    heroes: heroes.length,
    survivors: list.length - heroes.length,
    kills: heroes.reduce((s, r) => s + (r.kills || 0), 0),
    battles: heroes.reduce((s, r) => s + (r.battles || 0), 0),
    firstLoss: list.length ? Math.min(...list.map(r => r.ts || Infinity)) : 0,
    lastLoss: list.length ? Math.max(...list.map(r => r.ts || 0)) : 0,
  };
}

/* Newest first, which is what a player opening the wall after a bad fight
   wants to see. */
export function sorted(rows) {
  return (rows || []).map(normalise).filter(Boolean).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
