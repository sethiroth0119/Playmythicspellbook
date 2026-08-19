/* ════════════════════════════════════════════════════════════════════════════
   🧬 LIFEPATH — module entry point. Registers window.MythicLifepath.
   ----------------------------------------------------------------------------
   WHAT IT IS FOR. /src/citizen/facts.js prints a citizen's dossier and marks
   two rows UNAVAILABLE, with the real reason:

       Age        the roster has no age and never had one.
       Job level  this city keeps no rank for a person.

   This module is the model that earns them. It is READ-ONLY over every other
   layer — it sets no job, mints no citizen, moves no Cinder, writes no tile —
   and it owns exactly one piece of state: an integer birth stamp per named
   citizen. See model.js's header for the whole argument, and tuning.js's for
   the derivation of how long a year is (about eight hours of play, and the
   header says why that is the honest answer rather than a nicer one).

   🔴 DEGRADES TO NOTHING. A 404 on /src/lifepath, a host that never calls
      mount(), or a city with no demographics layer all produce the same thing:
      window.MythicLifepath is absent or answers ok:false with a sentence, and
      facts.js falls back to the two UNAVAILABLE rows it printed before, word
      for word. Nothing else in the game changes.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game` is a top-level `const` in node-city's
      module script and is NOT on window, so the module cannot read the clock by
      itself. `mount(ctx)` IS the hand-over, and it is deliberately the smallest
      one in the tree — three read-only closures and not one writer:

        now()        game.cityAge, in seconds. The clock everything ages on.
        tileBorn(k)  that tile's `born` stamp, or null. The FALLBACK tenure
                     ceiling — used only for a firm that carries no founding
                     stamp of its own (an old save). The real ceiling is the
                     employer's age, read off MythicEconomy, because a rebuilt
                     building does not end anybody's employment. See model.js.
        cycleMin()   CITY_DAY_MIN, used ONLY if ECON.clock.dayMin is unreadable.

      Nothing that writes crosses it. No saveSoon, no tile writer, no citizen
      writer, no THREE object.

   🔴 IT MINTS NOTHING AND PAYS NOBODY. There is no addCinders, no addRes and no
      payCost in this module or the two beside it. `cardSeam()` below REPORTS
      and does not cross the bridge — same rule, same shape and the same reason
      as MythicEconomy.cardOutput() and MythicDistricts.cardSeam().
   ════════════════════════════════════════════════════════════════════════════ */

import * as Model from './model.js';
import { LIFE, V as TUNE_V } from './tuning.js';

export const V = 1;

let mounted = false;
let shelved = false;

/* ── 💾 THE SAVE SHELF ────────────────────────────────────────────────────
   One field on `ext`, no edit to node-city's serialize() literal — the whole
   point of /src/naming/save.js. Registering LATE is safe by design: SaveShelf
   stashes the payload restore() saw and replays it to a provider that arrives
   afterwards, and a build where this module never loaded keeps the slice rather
   than erasing it. So the retry below is about the shelf not existing YET, not
   about load order. */
function shelfRegister() {
  if (shelved) return true;
  try {
    const shelf = (typeof window !== 'undefined') && window.MythicCitySave;
    if (!shelf || typeof shelf.register !== 'function') return false;
    shelved = shelf.register('lifepath', {
      save: () => Model.save(),
      load: (p) => { Model.load(p); },
    });
  } catch (e) {
    try { console.warn('[Lifepath] save shelf unavailable (non-fatal):', e); } catch (e2) {}
  }
  return shelved;
}

/* ── 🃏 THE CARD SEAM — A MEASUREMENT, NOT A PAYMENT ──────────────────────
   The brief this module was built to asks for a citizen's "collection value"
   alongside their age and career. That half cannot be built here and must not
   be faked here: `Profile`, `Corp` and `Forge` are top-level `const` in the
   MAIN app (public/index.html), which is a different document from node-city
   and, per CLAUDE.md's globals trap, invisible to an ES module either way. So
   the DECISION belongs over there and only the MEASUREMENT belongs here.

   What this reports is the shape of the citizenry a host could price: how many
   named people the city has, how they fall across the age pyramid, and how far
   up their employers' ladders they have got. It reads nothing it does not
   already print on the dossier.

   🔴 WHAT A HOST WOULD HAVE TO HAND OVER to turn this into a collection value,
      and it is a short list: a per-citizen card or holding lookup, and the
      Cinder price of one. Both live behind `window.MythicBridge` on the main
      app's side (CLAUDE.md names that as the seam for /src/community). Until
      one exists this returns `value: null` — deliberately null and not zero,
      because zero is a number and this is an absence. */
function cardSeam() {
  if (!mounted) return { ok: false, why: 'lifepath not mounted' };
  const d = Model.distribution();
  const out = {
    ok: true,
    citizens: d.ok ? d.n : 0,
    byBand: d.ok ? d.rosterCount : null,
    careers: { graded: 0, capped: 0, topGrade: 0, ladder: 0 },
    value: null,
    needs: ['a per-citizen card/holding lookup', 'the Cinder price of one holding'],
    note: 'read-only measurement; nothing here crosses the bridge, prices anything or pays anybody',
  };
  try {
    const M = window.MythicCitizens;
    const roster = (M && typeof M.list === 'function') ? (M.list() || []) : [];
    for (const c of roster) {
      const cr = Model.careerOf(c.id);
      if (!cr.ok) continue;
      out.careers.graded++;
      if (cr.capped) out.careers.capped++;
      if (cr.grade > out.careers.topGrade) out.careers.topGrade = cr.grade;
      out.careers.ladder = cr.ladder;
    }
  } catch (e) {}
  return out;
}

/* ── the read API ─────────────────────────────────────────────────────────
   Everything is guarded and everything answers ok:false with a SENTENCE rather
   than throwing, because every caller is another module's panel. */
const api = {
  V, TUNE_V,
  ready: () => mounted,
  /* The derived clock, with every input it was derived from named. A panel that
     prints an age has to be able to say how long a year is. */
  clock: () => Model.clock(),
  /* The city's own age pyramid, straight off MythicDemographics.report().ages —
     exposed so a reader can compare it with `distribution()` without having to
     find the demographics seam themselves. */
  pyramid: () => Model.pyramid(),
  age: (id) => Model.ageOf(id),
  career: (id) => Model.careerOf(id),
  explain: (id) => Model.explain(id),
  /* 📊 The falsifiability seam: the roster's ages and the city's pyramid in one
     object, with the largest share deviation between them and the bound that
     deviation is supposed to obey. */
  distribution: () => Model.distribution(),
  /* Deal any unstamped citizen into the pyramid. Idempotent, never re-deals,
     and called automatically by every read above — this is here so a driver can
     run it explicitly and count what it did. */
  sync: () => Model.seed(),
  cardSeam,
  // save/load are the shelf's; these are the test seam onto the same functions.
  save: () => Model.save(),
  load: (p) => Model.load(p),
  stamps: () => Model.stamps(),
  tuning: () => ({ workAge: LIFE.workAge, retireAge: LIFE.retireAge }),
  shelved: () => shelved,
  _ctx: () => Model.bound(),
};

export async function mount(ctx) {
  Model.bind(ctx);
  mounted = true;
  if (!shelfRegister()) {
    /* The shelf is created by /src/naming, which node-city mounts earlier — so
       this path is belt and braces. Bounded retries, never a permanent timer. */
    let tries = 0;
    const again = () => { if (shelfRegister() || ++tries > 20) return; setTimeout(again, 250); };
    setTimeout(again, 120);
  }
  try { if (typeof window !== 'undefined') window.MythicLifepath = api; } catch (e) {}
  return api;
}

/* ⚠ DELIBERATELY NOT REGISTERED AT IMPORT TIME. Several modules here publish
   themselves on window as a top-level side effect; this one must not, because
   without mount()'s ctx it has no clock and every read would answer "no city
   clock" — a reason that is true but that reads to a player like a broken
   feature rather than an absent one. Absent until mounted is the honest state,
   and it is the state facts.js already knows how to print. */

export default { V, mount, api };
