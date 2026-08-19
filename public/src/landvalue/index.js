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

   🔴 THIS MODULE MOVES NO MONEY — BUT THE FEATURE CHANGES WHAT THE PLAYER
      SPENDS, AND THE FIRST DRAFT OF THIS PARAGRAPH DID NOT SAY SO. Both halves
      matter, so both are written down:
        · NOTHING HERE PAYS ANYBODY, and that was checked rather than assumed.
          There is no `payCost`, no `addRes`, no `spendGems` and no ledger call
          in /src/landvalue; `lotValue()` is read by exactly two surfaces in
          node-city and neither of them charges for anything, and the one place
          a tile IS priced per minute (the Lease Plot's rent) reads
          /src/pollution's multiplier and is untouched here.
        · THE BAND STILL DECIDES WHAT A DEVELOP RUN COSTS, because it decides
          WHICH BUILDING goes up: `filterMix` → `typeFor` → `develop()` →
          `costOf`, and a Club is 105 cinder against a Food Truck's 18. Raising
          a district's land value therefore makes its next develop pass more
          expensive, which is the mechanism working and not a leak — every coin
          of it is spent through node-city's own `placeZoned` → `tryPlace` →
          `payCost` path at the SHIPPED price, and no price anywhere is read
          from, scaled by, or derived from this model.
      So the loop ECONOMY.md audits is still closed and sim.js has nothing new
      to see: what changed is the SHOPPING LIST, not the till. If a future
      consumer wants to price rent off a band, THAT belongs on the economy's
      side of the bridge with the audit watching, and not here.

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
import { makeField, KERB } from './field.js';
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

/* ── WHAT A ZONED PLOT CAN EVER DEVELOP INTO ────────────────────────────────
   The union of every bag `typeFor()` can be handed: /src/zoning's zone mixes
   and /src/districts' specialisation mixes. Asked of the live catalogues, never
   mirrored — a mirrored table is how two modules come to disagree about the
   same street, and this one would disagree silently.

   🔴 AN EMPTY ANSWER MEANS "NOBODY WAS THERE TO ASK", NOT "NOTHING DEVELOPS".
      `compile()` reads it that way and marks nothing, which is the same
      contract `zoneIds` already had. Note what is checked: that a catalogue
      produced MIXES, not merely that a module object exists — a module halfway
      through mounting has `ZONES` before it has anything in them, and reading
      that as "no zone develops a Club" would put a hostile fact on the panel.
   ⚠ /src/districts genuinely may be absent, and then `arena`, `stadium`,
     `holdco`, `retail`, `railyard`, `papermill`, `printworks` and `gasstation`
     really are hand-placement-only in that build. Marking them is then CORRECT,
     which is the other reason this is a mark and not a drop: a mark that turns
     out to be conservative costs a line of panel text, a drop would have cost
     the specialisations that develop them. */
function developableIds() {
  const out = [];
  const add = (m) => { const t = Array.isArray(m) ? m[0] : m; if (t && out.indexOf(t) < 0) out.push(t); };
  const eat = (list) => { for (const d of (list || [])) for (const m of (d.mix || [])) add(m); };
  try { const Z = W().MythicZoning; if (Z && Array.isArray(Z.ZONES)) eat(Z.ZONES); } catch (e) {}
  try { const D = W().MythicDistricts; if (D && Array.isArray(D.SPECS)) eat(D.SPECS); } catch (e) {}
  return out;
}

function zoneIdsNow() {
  try {
    const Z = W().MythicZoning;
    if (Z && Array.isArray(Z.ZONES)) return Z.ZONES.map(z => z.id);
  } catch (e) {}
  return [];
}

/* Recompiled ONCE more if the mixes were not there to be read at mount. Import
   order between sibling modules is not a guarantee this module may rely on
   (node-city happens to mount /src/districts first today; a reshuffle must not
   silently re-label a rung), and `compile` warns on every call — so this fires
   at most one extra time, on the first read after the catalogues arrive. */
function ensureSets() {
  if (!SETS) return null;
  if (SETS.devKnown) return SETS;
  const dev = developableIds();
  if (dev.length) SETS = compile(BUILDINGS, zoneIdsNow(), dev);
  return SETS;
}

/* 🏠 THE ZONE'S OWN DISPLAY NAME, ASKED OF /src/zoning AT CALL TIME.
   The ladder printed `r_high, r_mixed` — internal ids, straight onto a panel a
   player reads, while every BUILDING on the same row went through `nameOf()`.
   Advisory-but-labelled is honest; advisory-but-unreadable is not actionable.
   ⚠ Asked live rather than compiled in, for the same reason `unlocked()` is:
     the catalogue is a live table, and a name cached at mount is a name that
     can go stale. Falling back to the raw id is deliberate — an id is a poor
     label but it is a TRUE one, and inventing a prettier string here would be a
     second name for a zone that /src/zoning already named. */
function gradeName(id) {
  try {
    const Z = W().MythicZoning;
    const d = Z && Z.ZONE_BY_ID && Z.ZONE_BY_ID[id];
    if (d && d.name) return d.name;
  } catch (e) {}
  return id;
}

/* The tenant sets for one band, split into what is available now and what is
   locked. Both are published: a set that silently omitted the locked half would
   tell a player their prime land takes nothing, when in fact it takes a Holding
   Company they have not researched — and "why is nothing developing" has to
   have an answer. */
function setsFor(bandId) {
  const S = ensureSets();
  const raw = (S && S.tenants[bandId]) || { com: [], off: [], ind: [], res: [], handOnly: [] };
  const out = { com: [], off: [], ind: [], res: [], locked: [] };
  for (const cat of ['com', 'off', 'ind', 'res']) {
    for (const t of raw[cat]) {
      if (unlocked(t)) out[cat].push(t);
      else if (out.locked.indexOf(t) < 0) out.locked.push(t);
    }
  }
  out.all = out.com.concat(out.off, out.ind, out.res).filter((v, i, a) => a.indexOf(v) === i);
  out.grades = (S && S.grades[bandId]) || [];
  /* 🏗 THE MARK, AND WHAT IT IS NOT. `handOnly` is what this band admits that no
     zone mix and no district specialisation can DEVELOP — a Duel Arena is a
     legal Prime-land building and a player can put one there by hand, but no
     bag `typeFor()` picks out of contains it in a build with no /src/districts.
     It is PRESENTATION ONLY and is deliberately still inside `all`: `admits()`
     and `filterMix()` must keep answering "yes, this land takes that", because
     /src/districts culls its own spec mixes against exactly that answer and a
     narrower one would empty Mythic Arena, Card Works and Corporate. See
     bands.js for the whole argument.
     ⚠ AND IT IS NOT FILTERED TO `all`. A tenant can be BOTH locked by the
       research tree and hand-only, and the panel prints the locked ones on
       their own line — a mark that fell off exactly the entries the player
       cannot build yet would leave Mine, Quarry and Lumber Camp reading as
       things Marginal land will eventually develop, which is the claim this
       mark exists to retract. `develops` is taken off `all`, so the half that
       IS unlockable stays honest. */
  out.handOnly = (raw.handOnly || []).slice();
  out.develops = out.all.filter(t => out.handOnly.indexOf(t) < 0);
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
     in BUILDINGS, or a zone /src/zoning does not know, is DROPPED and reported —
     never advertised; an id no live mix can develop into is MARKED and reported,
     because a hand placement of it on this land is still legal and dropping it
     would break the sibling that culls against this table. See bands.js. */
  /* An empty list means the catalogue is not there to be asked, and `compile`
     reads that as "drop nothing" / "mark nothing" rather than "drop everything".
     A sibling module that has not mounted yet must never be read as a hostile
     fact — and `ensureSets()` re-asks once, so a late mount is recoverable
     rather than frozen in. */
  SETS = compile(BUILDINGS, zoneIdsNow(), developableIds());

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
    const sp = spread();
    const sets = {};
    for (const b of BANDS) {
      const s = setsFor(b.id);
      sets[b.id] = { com: s.com, off: s.off, ind: s.ind, locked: s.locked,
                     handOnly: s.handOnly, res: { grades: s.grades } };
    }
    return {
      ok: true, stats, sets, nameOf, gradeOf: gradeName, full: F.full(),
      terms: F.termsAt(bx, bz), bestKey: bx + ',' + bz,
      sources: F.sources(), spread: sp, flat: sp.flat,
      remedy: remedies(),
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

/* ── 📏 DOES THIS MAP HAVE A SPREAD TO SHOW? ────────────────────────────────
   ONE definition, because there were two and both were wrong the same way. The
   panel's "every tile is in one band" note and node-city's 🏷 vitals chip each
   asked `hist.filter(v => v > 0).length >= 2` — a band with ONE tile in it
   counted as a second band. On a boot with no scene at all that is exactly what
   happens: three pre-placed anchors and the waterfront term put FOUR of 576
   tiles into band 1, and the chip cheerfully claimed a land-value story
   ("🏷 20–52") on a map that has none. A rule stated in two places is a rule
   that gets fixed in one of them; this is now the only copy, and the chip asks
   it rather than re-deriving it.

   🔴 THE FLOOR IS DERIVED, AND IT IS DERIVED FROM THE THING THAT CAUSED THE
      FALSE POSITIVE. A tile count needs a floor, and a floor needs a model or
      it is an invented number. The model is this: the HOST's stencil is the one
      term in the field with no window at all. It owns everything BELOW
      `LV.inner` — that is the whole non-overlap rule in tuning.js, and it is
      why every term this module computes starts at `LV.inner` and cannot
      double-count a fountain. So the biggest patch ONE point feature can
      colour by itself is the block d ≤ inner − 1, i.e. `(2·inner − 1)²` = 9
      tiles at the shipped setting. A band holding no more than that is not a
      district, it is the kerb of a single fountain — precisely the four-tile
      artefact above — and it does not make a map worth opening a panel for.
   ⚠ IT IS DELIBERATELY THE SMALLEST DEFENSIBLE FLOOR AND NOT A COMFORTABLE ONE.
     The obvious alternative was the model's whole 9×9 NEIGHBOURHOOD WINDOW (81
     tiles, 14% of the board), and it was rejected: a real downtown of three
     blocks is smaller than that, and hiding the panel on a city that HAS a
     story is a worse failure than showing it on one that barely does. */
function spread() {
  const st = (mounted && F) ? F.stats() : null;
  const hist = (st && st.hist) || [];
  const floor = Math.pow(2 * LV.inner - 1, 2);
  const bands = hist.filter(v => v > floor).length;
  return { bands, floor, hist: hist.slice(), flat: bands < 2 };
}

/* ── 🏪 THE REMEDIES, DERIVED FROM THE SCORER ───────────────────────────────
   What actually raises a tile's value, asked of the model instead of typed out
   beside it. This exists because the refusal sentence used to name three things
   and TWO OF THEM PROVABLY DID NOTHING: measured by injecting one building at
   Chebyshev distance 2 and re-reading `premiumAt`, an `arena` moved the number
   by +0.00 (it is +30 ADJACENT, in the host stencil) and a `fountain` by +0.00
   (+17 adjacent, same reason), while the Player Shop the sentence called
   "shops" scored ZERO AT EVERY DISTANCE INCLUDING ADJACENT — it has no `svc`
   block at all, so `amenityWeight()` returns 0 for it. Telling a stuck player
   to build a Player Shop nearby is advice that cannot work.

   So the two mechanisms are now named apart, because the game treats them
   apart: the KERB (`LV.inner` tiles, the host's stencil, adjacency only) and
   the WINDOW (`LV.radius` tiles, this module's reach term). The kerb half
   quotes field.js's single `KERB` string — the host stencil is a black box
   across `mount()` and cannot be derived. The window half IS derived, off
   `amenityWeight()` itself, so it can never again name something that scores
   nothing.
   ⚠ FILTERED BY THE RESEARCH TREE, at call time like everything else here.
     "Build a Club" is not a remedy for a player who cannot build a Club yet.
     If the tree has locked every one of them the unfiltered list comes back
     rather than an empty sentence — absent/blocked ⇒ say something true. */
function remedies() {
  const menu = (mounted && F) ? F.amenityMenu() : [];
  const open = menu.filter(m => unlocked(m.type));
  const use = open.length ? open : menu;
  return {
    kerb: KERB, inner: LV.inner, radius: LV.radius,
    range: use.map(m => m.type),
    top: use.slice(0, 3).map(m => nameOf(m.type)),
    more: Math.max(0, use.length - 3),
  };
}

/* The window half as one printable clause, so the refusal and the panel's own
   "nothing is separating anything yet" note cannot come to disagree about what
   raises land value. */
function rangeClause() {
  const r = remedies();
  if (!r.top.length) return '';
  return r.top.join(', ') + (r.more ? ' and ' + r.more + ' more service ' +
         (r.more === 1 ? 'building' : 'buildings') : '') + ', within ' + r.radius + ' tiles';
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
             all: s.all, locked: s.locked, grades: s.grades,
             /* `all` minus what no live mix develops, and the mark itself. A
                consumer asking "what will actually GO UP here" wants
                `develops`; `all` is still the answer to "what may STAND
                here", and the two are different questions. */
             develops: s.develops, handOnly: s.handOnly };
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
     written into /src/zoning, so the model and its explanation cannot drift —
     and every remedy in it now comes out of `remedies()`, which asks the scorer
     (see above for the three that were measured at +0.00). */
  refusal(x, z) {
    const rng = rangeClause();
    return API.bandAt(x, z).name.toUpperCase() + ' land (' + Math.round(API.premiumAt(x, z)) +
      ' ₵ premium) — nothing this zone builds wants a plot here. Frontage counts only what ' +
      'TOUCHES the plot (' + KERB + ')' +
      (rng ? '; what lifts it from further off is ' + rng : '') +
      '. Or zone it for something cheaper.';
  },

  /* The remedies, published so a consumer can build its own sentence out of the
     same derivation rather than a copy of this one. */
  remedies, spread,

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
    /* 🔴 THE OTHER HALF OF THE SAME QUESTION, AND IT WAS MISSING. The check
       above catches the host stencil OUTGROWING its anchor; nothing caught it
       DISAPPEARING. field.js reads a throw as 0, 0 is a legal reading for bare
       ground, and a new city legitimately sits near 0 — so no floor on the
       VALUE can separate "empty board" from "broken host call" without failing
       every fresh city. The signal that can is whether the call THREW, which
       field.js now counts where it happens. Both directions are now covered and
       the model's largest term can no longer vanish in silence. */
    if (!s.stencilHost)
      problems.push('no host stencil was handed to mount() — the largest term in the model is 0 on every tile');
    else if (s.stencilFails > 0)
      problems.push('the host stencil THREW on ' + s.stencilFails + ' of ' + s.tiles +
                    ' tiles (' + s.stencilErr + ') — the largest term in the model reads 0 there ' +
                    'and every band on those tiles is understated');
    if (!(s.full > 0)) problems.push('premiumFull is not positive');
    for (const b of BANDS) {
      const t = setsFor(b.id);
      if (!t.all.length) { problems.push('band "' + b.id + '" admits nothing at all'); continue; }
      /* A rung that lists tenants of which NO live mix can produce ONE is a rung
         the develop pass can never climb — advertisement with nothing behind
         it, which is the failure this whole table is written to avoid. Note it
         can only fire once the mixes have actually been read: `devKnown` false
         means nobody was there to ask, and an absent sibling is not a fault. */
      if (SETS && SETS.devKnown && !t.develops.length)
        problems.push('band "' + b.id + '" lists ' + t.all.length +
                      ' tenants and no zone or district mix develops any of them');
    }
    return { ok: !problems.length, problems, stats: s,
             dropped: SETS ? SETS.droppedB : [],
             /* Reported alongside, never as a problem: these are legal
                hand-placed tenants for the band and the panel marks them. */
             handOnly: SETS ? SETS.handOnly : [], devKnown: !!(SETS && SETS.devKnown),
             spread: spread() };
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
