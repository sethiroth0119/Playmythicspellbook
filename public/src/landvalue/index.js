/* ════════════════════════════════════════════════════════════════════════════
   🏷 LAND VALUE — module entry point. Registers window.MythicLandValue.
   ----------------------------------------------------------------------------
   "Land value should determine what develops. A downtown commercial lot
    shouldn't produce the same businesses as cheap suburban land."

   node-city already had `lotValue(x, z)`. It DESCRIBED a tile — one row in the
   dossier and one chip in the inspector's meta line — and it looked exactly one
   tile in each direction. This module makes it DECIDE, in three moves:

     1. field.js EXTENDS it with four spatial terms the game already models
        (amenity in a window, who lives nearby, served transit, waterfront) and
        one multiplier it already computes (pollution). Its header measures what
        the shipped function could and could not separate, and why.
     2. bands.js turns the location premium into one of FIVE BANDS, and each
        band admits a different set of tenants — the brief's own ladder,
        expressed in buildings this game actually has.
     3. /src/zoning's `typeFor()` — the single point where "what goes on this
        plot" is decided — filters its zone mix through `admits()`. That is the
        enforcement. Without it this would be a readout with an opinion.

   🔴 ONE NUMBER, NOT TWO. node-city's `lotValue()` now delegates here and falls
      back to its own (unchanged) body when this module is absent. The dossier's
      "Lot value" row therefore prints THIS model's answer, never a second
      opinion about the same tile — the failure /src/economy's terroir header
      names and this codebase has already paid for.

   🔴 IT MOVES NO MONEY, AND THAT WAS CHECKED RATHER THAN ASSUMED. `lotValue()`
      is read by exactly two surfaces in node-city and neither of them pays
      anybody; the one place a tile IS priced per minute (the Lease Plot's rent)
      reads /src/pollution's multiplier and is untouched here. So none of this
      is inside ECONOMY.md's closed loop and sim.js's audit has nothing to see.
      If a future consumer wants to price rent off a band, that belongs on the
      economy's side of the bridge with the audit watching, not here.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost this project real time twice).
      `game`, `BUILDINGS`, `GRID`, `THREE`, `scene`, `lotValue` and `bldSite`
      are top-level `const` in node-city's module script — global LEXICAL
      bindings, NOT properties of `window`. This module reads none of them by
      itself: `mount(ctx)` IS the hand-over. What crosses it is READ-ONLY —
      there is no tile writer, no `addRes`, no `saveSoon`, and no `spend`
      anything. This layer is a reader by construction.

   🔴 AND IT MUST DEGRADE TO NOTHING. A 404 on /src/landvalue/* costs the player
      the land value info view and the tenant filter, and nothing else:
      `lotValue()` falls back to exactly what it computed before, /src/zoning
      develops from its unfiltered mix, and no save field changes — THERE IS NO
      SAVE FIELD. Every fact here is derived from state that is already
      persisted, the same contract /src/dossier ships under.

   ── EVERY HOOK THIS NEEDS IN node-city/index.html ──────────────────────────
     1. `lotValue()` split into `lotValueCity()` + `lotValueStencil()`, with one
        guarded delegation at the top of `lotValue()`
     2. one dynamic import + mount() in boot(), AFTER /src/pollution
     3. one launcher — the 🏷 chip in the vitals card, and the `V` key
     4. `__nc.landValue()` / `__nc.landValuePanel()` on the diagnostics seam
   ════════════════════════════════════════════════════════════════════════════ */

import { LV } from './tuning.js';
import { BANDS, BAND_BY_ID, compile, premiumFull } from './bands.js';
import { makeField } from './field.js';
import * as Panel from './panel.js';
import * as Overlay from './overlay.js';

let mounted = false;
let F = null;                 // the field
let SETS = null;              // the compiled tenant table
let BUILDINGS = {};
let GRID = 24;
let refreshTimer = 0;
let _game = null;

const W = () => (typeof window !== 'undefined' ? window : {});
const PROG = () => { try { return W().MythicProgress || null; } catch (e) { return null; } };

/* 🔒 PROGRESSION IS ASKED AT CALL TIME, NEVER BAKED IN AT COMPILE TIME.
   The tree unlocks buildings during a session; a tenant table frozen at boot
   would keep refusing a Club the player unlocked ten minutes ago, and would
   keep offering one in a build where /src/progression is present but the node
   is not taken. The default is OPEN in both directions — no module, or a
   building the tree has never heard of, is not gated — which is the same
   safety argument /src/progression's own `buildingUnlocked` states. */
function unlocked(type) {
  const P = PROG();
  if (!P || typeof P.buildingUnlocked !== 'function') return true;
  try { return !!P.buildingUnlocked(type); } catch (e) { return true; }
}

function bandDef(i) { return BANDS[Math.max(0, Math.min(BANDS.length - 1, i | 0))]; }

/* The tenant sets for one band, split into what is available now and what is
   locked. Both are published: a set that silently omitted the locked half would
   tell a player their prime land takes nothing, when in fact it takes a Holding
   Company they have not researched — and "why is nothing developing" has to
   have an answer. */
function setsFor(bandId) {
  const raw = (SETS && SETS.tenants[bandId]) || { com: [], off: [], ind: [], res: [] };
  const out = { com: [], off: [], ind: [], res: [], locked: [] };
  for (const cat of ['com', 'off', 'ind', 'res']) {
    for (const t of raw[cat]) {
      if (unlocked(t)) out[cat].push(t);
      else if (out.locked.indexOf(t) < 0) out.locked.push(t);
    }
  }
  out.all = out.com.concat(out.off, out.ind, out.res).filter((v, i, a) => a.indexOf(v) === i);
  out.grades = (SETS && SETS.grades[bandId]) || [];
  return out;
}

const nameOf = (id) => (BUILDINGS[id] && BUILDINGS[id].name) || id;

/* ══ MOUNT ═══════════════════════════════════════════════════════════════ */
export function mount(ctx) {
  if (mounted) return true;
  ctx = ctx || {};
  BUILDINGS = ctx.BUILDINGS || {};
  GRID = ctx.GRID || 24;

  /* Validate the tenant table against the LIVE tables, once. An id that is not
     in BUILDINGS, or a zone /src/zoning does not know, is dropped and reported
     — never advertised. See bands.js `compile`. */
  let zoneIds = [];
  try {
    const Z = W().MythicZoning;
    if (Z && Array.isArray(Z.ZONES)) zoneIds = Z.ZONES.map(z => z.id);
  } catch (e) { zoneIds = []; }
  /* An empty list means /src/zoning is not there to be asked, and `compile`
     reads that as "drop nothing" rather than "drop everything". A sibling
     module that has not mounted yet must never be read as a hostile fact. */
  SETS = compile(BUILDINGS, zoneIds);

  /* The ONE reference this module keeps to host state, and it is read-only:
     the overlay's marker layer has to find transit stops on the board. */
  _game = ctx.game || null;
  F = makeField(ctx);
  try { Overlay.mount({ THREE: ctx.THREE, scene: ctx.scene, grid: GRID }); }
  catch (e) { console.warn('[LandValue] overlay unavailable (non-fatal):', e); }
  Panel.mount({ onLayers: () => refresh(), close: () => API.closePanel() });
  mounted = true;

  /* The field moves on the CITY's clock, not on the player's clicks — a
     building finishing, a household moving in and a plume drifting all change
     it with nobody touching anything. Polled rather than pushed, and only while
     the panel is open, because an info view is a MODE: leaving the bands
     painted across the city after the player closed the panel is the fastest
     way to make an overlay feel like a bug. */
  try {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if (Panel.isOpen()) refresh(); }, LV.field.ttlMs);
  } catch (e) {}
  return true;
}

/* ── the panel's whole payload, derived once per refresh ─────────────────── */
function report() {
  if (!mounted || !F) return { ok: false, why: 'The land value model has not been mounted.' };
  try {
    F.rebuild(false);
    const stats = F.stats();
    const fields = F.fields();
    /* The causal list is shown for the BEST plot in the city, because that is
       the one a player wants explained — "why is that corner worth four times
       my street" is the question the ladder raises. */
    let best = 0;
    for (let i = 1; i < fields.premium.length; i++) if (fields.premium[i] > fields.premium[best]) best = i;
    const bx = best % GRID, bz = Math.floor(best / GRID);
    const sets = {};
    for (const b of BANDS) {
      const s = setsFor(b.id);
      sets[b.id] = { com: s.com, off: s.off, ind: s.ind, locked: s.locked, res: { grades: s.grades } };
    }
    const nonEmpty = stats.hist.filter(v => v > 0).length;
    return {
      ok: true, stats, sets, nameOf, full: F.full(),
      terms: F.termsAt(bx, bz), bestKey: bx + ',' + bz,
      sources: F.sources(), flat: nonEmpty <= 1,
    };
  } catch (e) {
    return { ok: false, why: 'The land value model threw: ' + (e && e.message) };
  }
}

function caps() {
  const c = {};
  try { c.MythicPollution = !!(W().MythicPollution && W().MythicPollution.ready && W().MythicPollution.ready()); } catch (e) { c.MythicPollution = false; }
  try { c.MythicTransit = !!W().MythicTransit; } catch (e) { c.MythicTransit = false; }
  try { c.MythicDemographics = !!W().MythicDemographics; } catch (e) { c.MythicDemographics = false; }
  return c;
}

/* The served stops, for the overlay's marker layer. Only when the network's
   mode share is actually above zero — the same gate the term itself uses. */
function servedStops() {
  try {
    const T = W().MythicTransit;
    if (!T || typeof T.jobAccess !== 'function') return [];
    const a = T.jobAccess();
    if (!a || !(a.served > 0)) return [];
    const g = (_game && _game.tiles) || {};
    const out = [];
    for (const k in g) {
      const t = g[k]; if (!t || !LV.transit.weight[t.type]) continue;
      const c = k.split(','); out.push({ x: +c[0], z: +c[1] });
    }
    return out;
  } catch (e) { return []; }
}

function refresh() {
  if (!Panel.isOpen()) { Overlay.hide(); return; }
  const r = report();
  Panel.render(r, caps());
  if (!r.ok) { Overlay.hide(); return; }
  Overlay.sync(Panel.layers, { fields: F.fields(), stats: r.stats, stops: servedStops() });
}

/* ══ THE PUBLIC API ══════════════════════════════════════════════════════════
   The next two agents build on this. Every call is safe to make before mount,
   during a 404 of a sibling module, and on a tile that does not exist.
   ══════════════════════════════════════════════════════════════════════════ */
const API = {
  ready: () => mounted && !!F,
  mount,

  /* THE NUMBER node-city's `lotValue()` PRINTS. City baseline + location
     premium, floored at LV.minValue, rounded — the host rounds it too and two
     roundings of the same figure must not be able to disagree by one. */
  valueAt(x, z) { return mounted && F ? Math.round(F.valueAt(x, z)) : null; },
  /* The location premium alone — the part that is not shared by every tile in
     the city, and the only part the band is taken on. */
  premiumAt(x, z) { return mounted && F ? F.premiumAt(x, z) : 0; },
  cityBase() { return mounted && F ? F.cityBase() : 0; },

  /* THE BAND OF A TILE. `{ i, id, ico, name, blurb, col, lo, hi }` — `i` is the
     index (0..4), `id` is stable and is what a consumer should key on. */
  bandAt(x, z) {
    const i = mounted && F ? F.bandAt(x, z) : 0;
    const b = bandDef(i);
    return { i, id: b.id, ico: b.ico, name: b.name, blurb: b.blurb, col: LV.col.band[i],
             lo: i === 0 ? 0 : Math.round(LV.bandCuts[i - 1] * premiumFull()),
             hi: i === BANDS.length - 1 ? null : Math.round(LV.bandCuts[i] * premiumFull()) };
  },

  /* THE TENANT SET A TILE ADMITS.
       { band, com, off, ind, res, all, locked, grades }
     `com/off/ind/res` are live BUILDINGS ids, filtered by the progression tree
     AT CALL TIME. `locked` is what this band would take but the tree has not
     opened — published rather than hidden, so "nothing is developing" always
     has an answer. `grades` is the residential half and is ADVISORY (see
     bands.js): nothing refuses a zone paint on account of it. */
  tenantsAt(x, z) {
    const b = API.bandAt(x, z);
    const s = setsFor(b.id);
    return { band: b, com: s.com, off: s.off, ind: s.ind, res: s.res,
             all: s.all, locked: s.locked, grades: s.grades };
  },

  /* Will this land take this building? The one predicate /src/zoning asks. */
  admits(x, z, type) {
    if (!mounted || !F || !type) return true;      // absent ⇒ open, never closed
    const b = bandDef(F.bandAt(x, z));
    const s = setsFor(b.id);
    return s.all.indexOf(type) >= 0;
  },

  /* Filter a candidate list, ORDER PRESERVED. /src/zoning picks out of its bag
     by a deterministic hash of the tile, so the order has to survive or the
     same plot develops as a different thing on a different day. */
  filterMix(x, z, ids) {
    if (!mounted || !F || !Array.isArray(ids)) return ids || [];
    const b = bandDef(F.bandAt(x, z));
    const s = setsFor(b.id);
    return ids.filter(t => s.all.indexOf(t) >= 0);
  },

  /* The sentence a refusal has to be able to say. Owned HERE rather than
     written into /src/zoning, so the model and its explanation cannot drift. */
  refusal(x, z) {
    const b = API.bandAt(x, z);
    return b.name.toUpperCase() + ' land (' + Math.round(API.premiumAt(x, z)) +
      ' ₵ premium) — nothing this zone builds wants a plot here. Raise the value ' +
      '(road frontage, an arena or a fountain nearby, shops and a served bus stop within ' +
      LV.radius + ' tiles) or zone it for something cheaper.';
  },

  /* The signed causal list for one tile — the rows sum to the premium exactly. */
  terms: (x, z) => (mounted && F ? F.termsAt(x, z) : []),
  stats: () => (mounted && F ? F.stats() : null),
  sources: () => (mounted && F ? F.sources() : null),
  field: () => (mounted && F ? F.fields() : null),
  bands: () => BANDS.map((b, i) => ({ ...b, col: LV.col.band[i], tenants: setsFor(b.id) })),
  report,

  /* 🔍 THE SELF-CHECK, REPORTED ONLY WHEN IT FAILS. A self-check that logs on
     success is one everyone learns to scroll past.
     It asks the one question that can silently invalidate the whole ladder: is
     `LV.stencilRef` still the host stencil's real ceiling? The bands are
     fractions of a span that includes it, so a stencil that outgrew it would
     push every well-sited tile into Prime and flatten the top of the map. */
  verify() {
    if (!mounted || !F) return { ok: false, why: 'not mounted' };
    F.rebuild(true);
    const s = F.stats();
    const problems = [];
    if (s.maxStencil > LV.stencilRef)
      problems.push('host stencil reaches ' + Math.round(s.maxStencil) +
                    ' but LV.stencilRef is ' + LV.stencilRef + ' — the band ladder is anchored short');
    if (!(s.full > 0)) problems.push('premiumFull is not positive');
    for (const b of BANDS) {
      const t = setsFor(b.id);
      if (!t.all.length) problems.push('band "' + b.id + '" admits nothing at all');
    }
    return { ok: !problems.length, problems, stats: s, dropped: SETS ? SETS.droppedB : [] };
  },

  openPanel() { if (!mounted) return false; Panel.show(report(), caps()); refresh(); return true; },
  closePanel() { Panel.hide(); Overlay.hide(); return true; },
  togglePanel() { return Panel.isOpen() ? API.closePanel() : API.openPanel(); },
  panelOpen: () => Panel.isOpen(),
  layers: Panel.layers,

  tuning: LV,
  BANDS, BAND_BY_ID,
};

try {
  if (typeof window !== 'undefined') {
    window.MythicLandValue = API;
    /* node-city may finish booting before or after this module evaluates —
       module scripts are deferred and import order is not guaranteed — so the
       host calls mount() when IT is ready and this line only announces that the
       API exists. Same handshake /src/economy, /src/water, /src/power and
       /src/pollution use. */
    if (typeof window.__ncLandValueReady === 'function') window.__ncLandValueReady(API);
  }
} catch (e) {}

export default API;
