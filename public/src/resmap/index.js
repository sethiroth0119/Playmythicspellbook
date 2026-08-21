/* ════════════════════════════════════════════════════════════════════════════
   🗺 THE RESOURCE MAP — module entry point. Registers window.MythicResourceMap.
   ----------------------------------------------------------------------------
   "A resource map, like Cities Skylines 2. The player cannot see where anything
    IS. Show resources on the ground — above all GROUNDWATER, because a water
    station has to be sited on it and right now siting is blind guessing."

   FIVE THINGS, AND NOT ONE MORE:
     1. It DRAWS the ground the city already models — groundwater and geothermal
        heat — by asking their owners, never by re-deriving them.
     2. It GENERATES the per-tile ground nobody modelled — ore, rift-gas, stone,
        fertile land, standing timber — as a pure function of the city id, to
        the template /src/water/endowment.js and /src/power/geology.js already
        run (fields.js).
     3. It PAINTS all of it on one plane, one texture (overlay.js).
     4. It EXPLAINS it, with a per-tile readout and a named deposit table
        (panel.js).
     5. It MOVES ONE NUMBER: a soft yield multiplier per tile, applied by the
        host at the one line where it banks a resource. Nothing else.

   ── 🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost this project real time) ──
   `game`, `BUILDINGS`, `THREE`, `scene`, `GRID`, `key` are top-level `const` in
   node-city's module script — global LEXICAL bindings, NOT properties of
   `window`. This module therefore reads NOTHING of the host by itself: THREE
   and the scene arrive once in mount(), and every fact about the city arrives
   per tick in the solve() snapshot, the same seam /src/water and /src/power
   already are.

   ── 🔴 AND IT MUST DEGRADE TO NOTHING ───────────────────────────────────────
   A 404 on /src/resmap/* costs the player the map and nothing else. node-city's
   production is byte-identical to what it was before this module existed,
   because the host multiplies by a factor that DEFAULTS TO 1 and the pre-pass
   is wrapped in the same try/catch the water one is. That is not a hope; it is
   the shape of the hook, and it is the reason a soft ladder was chosen over a
   gate (see tuning.js ③).

   ── WHAT THIS MODULE REFUSES TO DO, WRITTEN DOWN SO IT STAYS REFUSED ────────
     · NO SECOND WATERLINE. Groundwater is read from
       `MythicWater.endowment().groundAt`. If /src/water is absent the row is
       DISABLED, names the global, and NOTHING is drawn in its place — the
       /src/ocean discipline, which refuses to draw a coastline rather than
       guess one. A second groundwater field would render perfectly and
       disagree with the Water Station's placement gate forever, visibly.
     · NO SECOND HEAT FIELD. Same, from `MythicPower.heatAt`.
     · NO NEW HARD GATE. /src/economy owns `canExtract` and /src/city/terroir
       carries the SOLO promise. This can only ever multiply, between a floor
       and a top.
     · NO WATER YIELD. `water` is deliberately absent from every field's `res`
       list: /src/water already owns that multiplier (`_wtFac`), and a second
       one here would charge the same ground twice through two modules.
     · NO TABLE, NO /sql. Every field is derived; the only thing persisted is
       the city's IDENTITY (see the latch below), which is one string.
   ════════════════════════════════════════════════════════════════════════════ */

import { RES } from './tuning.js';
import * as Fields from './fields.js';
import * as Overlay from './overlay.js';
import * as Panel from './panel.js';

let mounted = false;
let grid = 24;
let warned = false;
let at = null;                       // the tile under the cursor, or null
const stats = { refused: '', noLine: '', painted: 0, solves: 0, sites: 0 };

function warnOnce(m) { if (warned) return; warned = true; try { console.warn('[resmap] ' + m); } catch (e) {} }

/* ── 🔴 THE CITY'S IDENTITY IS LATCHED, AND THAT IS A CORRECTNESS RULE ──────
   The fields are a pure function of this string, so the string had better not
   change. The host derives it exactly as it does for /src/water and
   /src/economy — `game.anchors[0].node.id` falling back to the save key — and
   BOTH of those can move under a live city: an anchor list can be reordered or
   re-linked during play, and the fallback differs between a signed-in and a
   guest session. A city whose ore bodies move because the player linked a
   second node is not a deterministic endowment, it is a re-roll with extra
   steps.

   So the FIRST non-empty id this module is ever given wins for the lifetime of
   the page, and it is WRITTEN INTO THE SAVE — which means a loaded city keeps
   the ground it was founded on for ever, whatever the host derives today.

   ⚠ THE SAVE SLICE HOLDS THE IDENTITY AND NOT THE FIELD, AND THAT DISTINCTION
     IS THE WHOLE "no storage, no migration" CLAIM. `{v:1, cityId:'…'}` is one
     string. There is no deposit list on disk, so there is nothing to migrate
     when the tuning table changes, and a save written before this module
     existed simply latches today's id — which for a city that has never been
     re-linked is the same id it would have derived anyway. */
let cityId = '';
let pinned = false;
function setCityId(id) {
  const s = String(id == null ? '' : id);
  if (!s || pinned) return false;
  cityId = s; pinned = true;
  Fields.invalidate(); Overlay.repaintNext();
  return true;
}

function F() { return Fields.fieldsFor(cityId, grid); }

/* ── THE READ-THROUGH OWNERS ────────────────────────────────────────────────
   Asked LIVE on every paint rather than captured at mount, because /src/water
   and /src/power may mount after this module and because /src/water's own city
   id is latched from ITS save — going through the published API means this
   layer draws whatever the owner says today, and can never drift from the gate
   the owner enforces.
   ⚠ A THROWING OWNER IS AN ABSENT OWNER. The probe below actually CALLS the
     function once at (0,0): a module that exists but whose endowment refused
     would otherwise pass a truthiness test and then paint a field of NaN, which
     ramp() renders as the first stop — a confident, uniform, wrong colour. */
function probe(fn) {
  if (typeof fn !== 'function') return null;
  try { const v = Number(fn(0, 0)); return isFinite(v) ? fn : null; } catch (e) { return null; }
}

/* ── 📏 THE OWNER'S LINE, AND WHY IT IS ASKED FOR RATHER THAN TYPED ─────────
   A read-through layer draws a field this module does not own and does not
   gate. The THRESHOLD on that field belongs to the same owner as the field, so
   it is read from the owner's published tuning on every paint — never copied
   into RES.

   🐞 THE DEFECT THIS EXISTS TO FIX, RECORDED BECAUSE IT SHIPPED. `markFrom`
      was declared on both read rows and then read by nothing, so the outline
      was a hardcoded 0.12 while /src/water's gate cuts at 0.10, and the PAINT
      was cut at the generated fields' alpha floor of 0.02. Measured over 60
      cities: 98.5 tiles painted per city, of which 27.5 (27.9%) the Water
      Station gate refuses, and 5.1 legal sites per city left outside the
      outline. A player reading 💧 off this map and clicking there got a
      refusal that then pointed them back at this map. /src/water/overlay.js had
      already learned it: "an overlay that disagrees with the model it draws is
      worse than no overlay."

   TWO NUMBERS, AND THEY ARE NOT THE SAME QUESTION:
     mark  the SITE LINE the owner's placement gate enforces → the outline.
     cut   the value below which the OWNER'S OWN overlay paints nothing. `null`
           means the owner paints its whole field, and this layer then uses the
           shared alpha floor so the two pictures agree.

   🔴 AND IT REFUSES RATHER THAN GUESSING. An owner that publishes a field but
      no line gets NOTHING drawn and a recorded refusal, the /src/ocean
      discipline. A contour this module invented would be a second opinion about
      a gate it does not enforce — which is the very bug above, wearing a
      different number. */
const OWNER_LINE = {
  /* WATER.aquifer.minRead. It is BOTH numbers: `basinAt()` returns null below
     it (so `siteRefusal` refuses a Water Station there) and
     /src/water/overlay.js cuts its own aquifer paint at exactly it, with the
     reason written beside the line. */
  water() {
    const W = typeof window !== 'undefined' && window.MythicWater;
    const t = W && W.tuning && W.tuning.aquifer;
    const v = t && Number(t.minRead);
    if (!isFinite(v) || v <= 0 || v >= 1) return null;
    return { mark: v, cut: v, from: 'MythicWater.tuning.aquifer.minRead' };
  },
  /* POWER.plants.geothermal.minHeat — the Geothermal Plant's licence line.
     `cut` is null ON PURPOSE: /src/power/overlay.js paints heat across all 576
     tiles from its alpha floor and draws the contour at minHeat, so cutting the
     paint here would make this panel show a different picture from the panel
     beside it. Two sources tried, because `tuning` is a convenience and
     `endowment().minHeat` is the one the gate itself reports. */
  power() {
    const P = typeof window !== 'undefined' && window.MythicPower;
    if (!P) return null;
    let v = NaN;
    try { const g = P.tuning && P.tuning.plants && P.tuning.plants.geothermal; v = Number(g && g.minHeat); } catch (e) {}
    if (!isFinite(v)) { try { const e = P.endowment(); v = Number(e && e.minHeat); } catch (e) {} }
    if (!isFinite(v) || v <= 0 || v >= 1) return null;
    return { mark: v, cut: null, from: 'MythicPower.tuning.plants.geothermal.minHeat' };
  },
};

function readers() {
  const out = { groundwater: null, heat: null, lines: {}, why: {} };
  try {
    const W = typeof window !== 'undefined' && window.MythicWater;
    if (W && W.endowment) {
      const e = W.endowment();
      out.groundwater = probe(e && e.groundAt);
    }
  } catch (e) {}
  try {
    const P = typeof window !== 'undefined' && window.MythicPower;
    if (P && P.heatAt) out.heat = probe((x, z) => P.heatAt(x, z));
  } catch (e) {}
  /* THE LINE IS PART OF THE CAPABILITY, not a decoration on it. A row whose
     owner answers `groundAt` but will not say where its gate cuts is dropped
     here — the reader is nulled — so the panel disables it and names what it is
     waiting for, and the overlay is never handed a field it cannot honestly
     threshold. One place, so the panel and the paint cannot disagree about
     which rows are live. */
  let noLine = '';
  for (const spec of RES.read) {
    if (!out[spec.id]) continue;
    let line = null;
    try { const g = OWNER_LINE[spec.markFrom]; line = g ? g() : null; } catch (e) { line = null; }
    if (!line) {
      out[spec.id] = null;
      out.why[spec.id] = spec.from + ' answered, but its threshold did not';
      noLine += (noLine ? '; ' : '') + spec.id + ' (' + spec.markFrom + ')';
      continue;
    }
    out.lines[spec.id] = line;
  }
  /* Recomputed every call, and kept OFF `stats.refused` — that one belongs to
     the overlay's mount and must not be clobbered by a transient. */
  stats.noLine = noLine;
  return out;
}
function caps() {
  const r = readers();
  return { water: !!r.groundwater, power: !!r.heat };
}

/* Every layer's value at a tile — generated fields from fields.js, read-through
   ones from their owners. `null` means "nobody can answer", which the panel
   prints as an absent row rather than as a zero. */
function valueOf(id, x, z) {
  for (const f of RES.fields) if (f.id === id) return F().valueAt(id, x, z);
  const r = readers();
  const fn = r[id];
  if (typeof fn !== 'function') return null;
  try { const v = Number(fn(x, z)); return isFinite(v) ? Math.max(0, Math.min(1, v)) : null; }
  catch (e) { return null; }
}

function panelState() {
  /* ONE readers() call, and the panel's caps/why/lines all come out of it. Two
     calls could straddle a mount by /src/water and hand the legend a row it
     disabled and a value it drew — the panel and the paint must be one read. */
  const r = readers();
  return { F: F(), readers: r, caps: { water: !!r.groundwater, power: !!r.heat },
           why: r.why, lines: r.lines, at, valueOf, grid };
}

/* The overlay is only painted while the panel is open. An info view is a MODE,
   not a permanent decoration: leaving five resource fields painted across the
   city after the player closed the panel is the fastest way to make an overlay
   feel like a bug — the rule /src/water, /src/pollution and /src/landvalue all
   state. (The one shipped exception is an EDITING surface — the water mains —
   and this layer is not one: nothing here is placed by the player.) */
function refresh() {
  if (!Panel.isOpen()) { Overlay.hide(); return; }
  const st = panelState();
  Panel.render(st);
  /* The SAME state object feeds both, so the legend's sentence about where the
     line is and the pixels that line was drawn at come from one read. */
  Overlay.sync({ F: st.F, readers: st.readers, lines: st.lines }, Panel.layers);
  stats.painted++;
}

const API = {
  ready: () => mounted,

  /* Called ONCE from boot with THREE + the scene for the overlay, the grid size
     and the city's id. Everything about the city's BUILDINGS arrives per tick
     through solve(). */
  mount(h) {
    if (mounted) return true;
    try {
      if (h && h.grid) grid = h.grid | 0;
      if (h && h.cityId != null) setCityId(h.cityId);
      Panel.mount(h, { onLayers: () => { Overlay.repaintNext(); refresh(); }, close: () => API.closePanel() });
      if (!Overlay.mount(h)) {
        /* 🔴 REFUSE AND RECORD, DO NOT INVENT. /src/ocean's discipline: a layer
           that cannot be drawn says so in `stats.refused` and draws nothing.
           The simulation half still runs — the yield ladder needs no renderer —
           so a headless host gets the numbers and no picture, which is exactly
           what it asked for. */
        stats.refused = 'no THREE/scene handed over — the overlay is not drawn';
      }
      /* 💾 THE SAVE SLICE RIDES THE SHELF, so node-city's serialize() literal is
         not touched (see /src/naming/save.js: "every one of those edits is a
         merge conflict and a chance to drop a field"). The shelf replays a
         stashed payload to a late registrant, which matters because this module
         mounts AFTER loadState. */
      try {
        const shelf = (typeof window !== 'undefined') && window.MythicCitySave;
        if (shelf && shelf.register) {
          shelf.register('resourceMap', {
            save: () => (cityId ? { v: 1, cityId } : undefined),
            load: (b) => {
              /* The saved id wins, and it is loaded before the first solve —
                 the other half of the latch. `pinned` is cleared first because
                 mount() has already latched today's derived id; a city founded
                 on another one keeps its ground. */
              if (b && b.cityId) { pinned = false; setCityId(b.cityId); }
            },
          });
        } else {
          warnOnce('no MythicCitySave — the city id is re-derived every session');
        }
      } catch (e) { warnOnce('save shelf: ' + (e && e.message)); }

      /* 🖱 THE READOUT'S ONE INPUT. A PASSIVE, BUBBLE-PHASE pointermove on the
         canvas, and deliberately not a claim on /src/netdrag/rig.js.
         🔴 WHY THIS IS NOT A rig.js CLAIMANT. rig.js arbitrates who OWNS the
            pointer — exactly one tool at a time, because two tools both laying
            pipe is the bug it exists to prevent. This reads the cursor and
            takes nothing: it never calls preventDefault, never stops
            propagation, never touches controls.enabled, and is registered in
            the BUBBLE phase so every capture-phase claimant has already had the
            event. Claiming here would STAND DOWN whatever tool the player was
            using the moment they opened this panel, which is the opposite of
            what a reference map is for.
         ⚠ It does nothing at all unless the panel is open. */
      try {
        const cv = h && h.canvas, pick = h && h.tileFromEvent;
        if (cv && typeof pick === 'function') {
          cv.addEventListener('pointermove', (ev) => {
            if (!Panel.isOpen()) return;
            let c = null;
            try { c = pick(ev); } catch (e) { c = null; }
            if (!c) { if (at) { at = null; refresh(); } return; }
            if (at && at.x === c.x && at.z === c.z) return;
            at = { x: c.x, z: c.z };
            refresh();
          }, { passive: true });
        }
      } catch (e) { warnOnce('no cursor readout: ' + (e && e.message)); }

      mounted = true;
      return true;
    } catch (e) { warnOnce('mount failed: ' + (e && e.message)); return false; }
  },

  /* ════════════════════════════════════════════════════════════════════════
     🌱 THE TICK. node-city's resource pre-pass calls this with one entry per
     (tile × generated resource) and applies `result.factor[k + '|' + res]` at
     the ONE line where it banks that resource. Returns null if it cannot
     answer, and the host then produces exactly what it did before this module
     existed.

     🔴 A FACTOR PER TILE, NEVER A RATE — the /src/water/hydro.js single-truth
        rule. The host owns the rate and always has; this module owns the
        ground and has never seen a rate. Neither can drift because only one of
        them knows what a Farm produces.

     🔴 KEYED `k|res` AND NOT `k`, BECAUSE A TILE CAN GENERATE TWO THINGS. The
        Quarry makes stone and the refiners make several goods at once; a map
        keyed by tile alone would silently apply the stone multiplier to
        whatever else that tile banked. This is the same class of bug as the
        bare `t.type === 'road'` comparisons node-city has numbered four times:
        it looks right, and it is wrong only for the rows nobody tested.
     ════════════════════════════════════════════════════════════════════════ */
  solve(snapshot) {
    if (!snapshot) return null;
    try {
      if (snapshot.cityId != null) setCityId(snapshot.cityId);
      if (snapshot.grid) grid = snapshot.grid | 0;
      const f = F();
      const factor = Object.create(null);
      const sites = snapshot.sites || [];
      for (const s of sites) {
        const spec = Fields.fieldForRes(s.res);
        if (!spec) continue;                       // a resource with no ground
        const v = f.valueAt(spec.id, s.x, s.z);
        const y = Fields.yieldOf(s.res, v, !!s.outdoor);
        factor[s.k + '|' + s.res] = y.factor;
      }
      stats.solves++; stats.sites = sites.length;
      if (Panel.isOpen()) refresh();
      return { ok: true, factor, cityId: f.cityId, grid: f.grid };
    } catch (e) { warnOnce('solve threw: ' + (e && e.message)); return null; }
  },

  /* ════════════════════════════════════════════════════════════════════════
     🚧 THE SITING GATE, written to the shipped MythicWater.siteRefusal(type,
     x, z, req) contract exactly: the module returns the refusal STRING so the
     reason lives where the rule does, and ABSENCE MEANS YES.

     ⚠ THE REQUIREMENT COMES FROM THE BUILDINGS ROW, NOT FROM A LIST HERE. The
       host reads `def.deposit` off the row and hands it over, so a
       deposit-sited building is one flag on one row and this file does not
       change. A list of type strings in a second file is the shape node-city
       has had to fix three times by number.

     🔴 NO ROW CARRIES `deposit` TODAY, AND THAT IS DELIBERATE, NOT UNFINISHED.
        Adding it to the Mine or the Quarry would RETRO-GATE every one of those
        buildings already standing in an existing save — a player who built
        four Mines before this map existed would load a city that refuses to let
        them be rebuilt. The structural argument /src/water made with `mains`
        and /src/power made with `metered`: the flag goes on NEW rows only, so
        nothing that can already be standing is subject to a rule its city never
        had. The seam is live and tested; the first building to use it is the
        first building that has never existed without it.

     🔴 THE REFUSAL MUST NAME A LEGAL SITE. "Cannot place here" is
        indistinguishable from a bug. This names the nearest body, its centre,
        AND the layer that draws it — so the player can find a site from the
        panel alone instead of clicking the map until it stops complaining.
     ════════════════════════════════════════════════════════════════════════ */
  siteRefusal(type, x, z, req) {
    try {
      if (!req || !req.deposit) return null;
      const spec = Fields.specOf(String(req.deposit));
      if (!spec) return null;                      // an unknown flag gates nothing
      const xx = Number(x) || 0, zz = Number(z) || 0;
      const f = F();
      if (f.bodyAt(spec.id, xx, zz)) return null;
      const name = req.name || 'This building';
      const bodies = f.bodies(spec.id);
      let near = null, nd = Infinity;
      for (const b of bodies) {
        const d = Math.hypot(xx - b.cx, zz - b.cz);
        if (d < nd) { nd = d; near = b; }
      }
      return spec.ico + ' ' + name + ' has to stand on ' + spec.label.toLowerCase() +
        ', and there is none under this tile. ' +
        (near ? 'The nearest is ' + near.name + ', centred near ' +
                Math.round(near.cx) + ',' + Math.round(near.cz) + ' — ' : '') +
        'open 🗺 Resources (M) and switch on “' + spec.label +
        '”: every tile inside the outline is a legal site.';
    } catch (e) { return null; }   // a gate that throws must not block a build
  },

  /* ── THE READ API. Mapped FIELD BY FIELD, never a spread ────────────────
     🔴 NO PASS-THROUGH, DELIBERATELY, and /src/water/index.js records why at
        length: returning the internal object verbatim satisfies every guarded
        read — one key matches by name and is truthy — while feeding `undefined`
        to every consumer, and it looks like a working feature forever. */

  /* Every field at one tile: the generated ones plus whatever the read-through
     owners answered. An owner that cannot answer is ABSENT from the object
     rather than zero, so a consumer can tell "no water here" from "no
     /src/water". */
  readAt(x, z) {
    const xx = Number(x) || 0, zz = Number(z) || 0;
    const out = {};
    for (const spec of RES.fields) out[spec.id] = F().valueAt(spec.id, xx, zz);
    for (const spec of RES.read) {
      const v = valueOf(spec.id, xx, zz);
      if (v != null) out[spec.id] = v;
    }
    return out;
  },

  /* The 0..1 value of ONE field at one tile. The number the overlay paints and
     the number the panel prints, from the same call — which is what makes
     "the map and the number agree" checkable rather than asserted. */
  valueAt(field, x, z) {
    const v = valueOf(String(field), Number(x) || 0, Number(z) || 0);
    return v == null ? null : v;
  },

  /* ── 📏 THE LINE, PUBLISHED ────────────────────────────────────────────────
     `{ mark, cut, from, owned }` for one layer, or null when nobody will state
     one. This is the number the outline is drawn at and — for a read-through
     row with a `cut` — the number the paint is cut at, so "the outline is the
     legal-site line" is a claim a test can check instead of a sentence in a
     comment. `owned: false` means the line came from another module and this
     one merely obeys it; `true` means it is this module's own richness contour
     and gates nothing but its own refusal (see RES.fields' `mark`). */
  siteLine(field) {
    const id = String(field);
    for (const spec of RES.fields) {
      if (spec.id !== id) continue;
      return { mark: spec.mark, cut: RES.overlay.fieldAlpha.floor, owned: true,
               from: 'RES.fields.' + id + '.mark', legal: RES.minRead };
    }
    for (const spec of RES.read) {
      if (spec.id !== id) continue;
      const l = readers().lines[id];
      return l ? { mark: l.mark, cut: l.cut, owned: false, from: l.from, legal: l.mark } : null;
    }
    return null;
  },
  siteLines() {
    const out = {};
    for (const spec of RES.fields.concat(RES.read)) out[spec.id] = API.siteLine(spec.id);
    return out;
  },

  /* What a producer of `res` on this tile would be multiplied by, with its
     decomposition — for the inspector row, a build-time preview, or a test.
     THE SAME CALL solve() MAKES. */
  yieldAt(x, z, res, outdoor) {
    try {
      const spec = Fields.fieldForRes(String(res));
      if (!spec) return { factor: 1, field: null, value: 0, gain: 0, exempt: false };
      const v = F().valueAt(spec.id, Number(x) || 0, Number(z) || 0);
      const y = Fields.yieldOf(String(res), v, outdoor === undefined ? true : !!outdoor);
      return { factor: y.factor, field: y.field, value: y.value, gain: y.gain,
               exempt: y.exempt, label: spec.label, ico: spec.ico };
    } catch (e) { return { factor: 1, field: null, value: 0, gain: 0, exempt: false }; }
  },

  /* Which ledger resource this field feeds, and vice versa — so a caller never
     has to keep a second copy of the mapping. */
  fieldForRes: (res) => { const s = Fields.fieldForRes(String(res)); return s ? s.id : null; },

  /* The named bodies of one field, for the panel, the diagnostics seam and the
     driven test. Mapped field by field. */
  deposits(field) {
    const f = F();
    return f.bodies(String(field)).map(b => ({
      i: b.i, name: b.name, x: b.cx, z: b.cz, r: b.r, strength: b.strength, area: b.area,
    }));
  },
  best(field) { const b = F().best(String(field)); return { x: b.x, z: b.z, value: b.v }; },
  fields: () => RES.fields.map(f => ({ id: f.id, label: f.label, ico: f.ico, res: f.res.slice(),
                                       surface: !!f.surface, mark: f.mark })),
  summary: () => F().summary(),
  cityId: () => cityId,

  /* 🔬 For a driven pixel test. The mesh is handed over so an A/B can flip
     `.visible` itself and know nothing will race it — this module repaints only
     on a panel event, a pointer move or a solve, never on a timer. That is the
     exact trap /src/landvalue/overlay.js records: its own refresh() interval
     sets visible=true whenever the panel is open, so an A/B that opened the
     panel and then hand-flipped visibility raced it and reported ~1% instead of
     ~61%. Nothing here has an interval. */
  overlayMesh: () => Overlay.object(),
  stats: () => ({ refused: stats.refused, noLine: stats.noLine, painted: stats.painted,
                  solves: stats.solves, sites: stats.sites, mounted, overlay: Overlay.mounted(),
                  cityId, lines: API.siteLines() }),

  at: () => (at ? { x: at.x, z: at.z } : null),
  layers: Panel.layers,
  openPanel() { if (!mounted) return false; Panel.show(panelState()); refresh(); return true; },
  closePanel() { Panel.hide(); Overlay.hide(); return true; },
  togglePanel() { return Panel.isOpen() ? API.closePanel() : API.openPanel(); },
  panelOpen: () => Panel.isOpen(),

  /* 🔍 The endowment self-check, so a tuning change can never silently leave a
     city with nowhere good to put an extractor. Reported at boot ONLY when it
     fails — a self-check that logs on success trains everyone to ignore the
     console. */
  verify: (ids) => Fields.verify(ids, grid),
  tuning: RES,
};

try {
  if (typeof window !== 'undefined') {
    window.MythicResourceMap = API;
    /* node-city may finish booting before or after this module evaluates —
       module scripts are deferred and import order is not guaranteed — so the
       host calls mount() when IT is ready and this line only announces that the
       API exists. The same handshake /src/water and /src/power use. */
    if (typeof window.__ncResMapReady === 'function') window.__ncResMapReady(API);
  }
} catch (e) {}

export default API;
