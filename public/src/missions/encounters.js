/* 🎲 THE ROAD BETWEEN DISTRICTS — what a crossing turns up.
   ═══════════════════════════════════════════════════════════════════════════
   Moving the train costs FUEL. Crossing the city takes you past things:
   sometimes nothing, sometimes a tanker nobody drained, sometimes raiders at a
   junction — and sometimes scouts spot a faction massing for the next push.

   🔴 NOTHING HERE WRITES TO THE SHARED CITY, AND THAT IS THE DESIGN.
      An earlier version let a travel encounter push grip directly, capped per
      account. The DAY does that now — 24 real hours, one rollover, the same
      new board for every player at the same moment (sql/042). Keeping both
      would have moved the map twice for one reason: once collectively, and
      once more for whoever happened to be out riding.

   🔴 SO A SIGHTING IS INTELLIGENCE, NOT A NUDGE. "The Scum are massing at
      SoHo — they move at first light" tells the player where tomorrow's
      rollover will land, which is worth more than a private grip change
      nobody else can see, and cannot be farmed by shuttling back and forth.

   ⚠ THIS MODULE OWNS NO STATE. It rolls, it narrates, and the caller applies
     and saves — which is why it can be exercised 400 times in a driver
     without touching a profile or a database.
   ═══════════════════════════════════════════════════════════════════════════ */

import { SITES, SITE_BY_ID, FACTIONS, FACTION_IDS, ADJACENCY } from './poi.js';

/* Weighted, and weighted to be QUIET most of the time. A random event on every
   single hop stops being an event and becomes a toll — the player would learn
   to dread moving, and the train exists to be moved. */
export const TABLE = [
  { id: 'quiet',    w: 34, kind: 'none' },
  { id: 'scav',     w: 14, kind: 'fuel', amount: +2 },
  { id: 'tanker',   w: 6,  kind: 'fuel', amount: +4 },
  { id: 'leak',     w: 10, kind: 'fuel', amount: -1 },
  { id: 'ambush',   w: 8,  kind: 'fuel', amount: -2 },
  { id: 'refugees', w: 8,  kind: 'none' },
  { id: 'push',     w: 20, kind: 'push' },
];

const TEXT = {
  quiet:    () => 'A quiet run. Empty track, empty streets, nothing on the scopes.',
  scav:     () => 'A stalled service truck on the siding — two cans of fuel still in the bed.',
  tanker:   () => 'A tanker car nobody had drained. Four cans, and the pump still works.',
  leak:     () => 'A weld gave out somewhere past the junction. A can of fuel gone before anyone noticed.',
  ambush:   (f) => (f ? f.name : 'Raiders') + ' hit the train at a junction. Driven off — two cans burned getting clear.',
  refugees: () => 'Survivors flagged the train down. Fed, watered, and pointed at the camp.',
  push:     (f, s) => 'Scouts report ' + (f ? f.name : 'someone') + ' massing at ' + (s ? s.name : 'the edge of the city') + '. They will move at first light.',
};

function pick(rng) {
  const total = TABLE.reduce((a, e) => a + e.w, 0);
  let r = (rng || Math.random)() * total;
  for (const e of TABLE) { r -= e.w; if (r <= 0) return e; }
  return TABLE[0];
}

/* Where a faction is massing — somewhere they could plausibly reach next, i.e.
   beside ground they already hold. That is also where the DAY's push is most
   likely to land, which is what makes the sighting worth reading. Falling back
   to any district keeps the line from naming nowhere on a nearly-clear map. */
function pushTarget(gripOf, holderOf) {
  const held = SITES.filter(s => gripOf(s.id) > 0);
  const opts = [];
  held.forEach(s => {
    (ADJACENCY[s.id] || []).forEach(n => {
      if (gripOf(n) <= 0) opts.push({ site: n, faction: holderOf(s.id) });
    });
  });
  if (opts.length) return opts[Math.floor(Math.random() * opts.length)];
  /* nowhere to spread — lean on a district they already hold */
  if (held.length) { const s = held[Math.floor(Math.random() * held.length)]; return { site: s.id, faction: holderOf(s.id) }; }
  const s = SITES[Math.floor(Math.random() * SITES.length)];
  return { site: s.id, faction: FACTION_IDS[Math.floor(Math.random() * FACTION_IDS.length)] };
}

/* Roll one crossing.
   ctx — { gripOf, holderOf, refuel }
   Returns { id, line, fuel, push } — `push` is a SIGHTING (where a faction is
   massing), not an instruction to change anything. The caller narrates and the
   caller saves, because this module deliberately owns no state. */
export function roll(ctx, rng) {
  const e = pick(rng);
  const out = { id: e.id, line: '', fuel: 0, push: null };

  if (e.kind === 'fuel') {
    const moved = ctx.refuel ? ctx.refuel(e.amount) : 0;
    out.fuel = moved;
    const fac = FACTIONS[FACTION_IDS[Math.floor(Math.random() * FACTION_IDS.length)]];
    out.line = TEXT[e.id](fac);
    /* ⚠ SAY SO WHEN NOTHING MOVED. An empty tank absorbing a fuel loss reads as
       a bug if the line still claims cans were burned. */
    if (e.amount < 0 && moved === 0) out.line = 'A rough crossing, but the tanks were already dry.';
    return out;
  }

  if (e.kind === 'push') {
    const t = pushTarget(ctx.gripOf, ctx.holderOf);
    out.push = t;
    out.line = TEXT.push(FACTIONS[t.faction], SITE_BY_ID[t.site]);
    return out;
  }

  out.line = TEXT[e.id]();
  return out;
}

/* 🔴 A SIGHTING, NOT A WRITE — AND THAT IS THE WHOLE CHANGE HERE.
   A travel encounter used to push the shared city itself, rate-limited per
   account. The day now does that for EVERYONE at once, at the same moment
   (sql/042), so keeping both would move the map twice for the same reason:
   once collectively and once more for whoever happened to be travelling.
   What the player sees out there is now intelligence — the factions massing
   where they will push at the rollover — which is worth more than a private
   nudge nobody else can see. mission_encounter() is dropped server-side
   rather than left callable: a SECURITY DEFINER function that can write to
   the pressure ledger and is called by nothing is an attack surface with no
   upside. */
