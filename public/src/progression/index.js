/* ══════════════════════════════════════════════════════════════════════════
   🌳 PROGRESSION — window.MythicProgress.

   The research tree, the milestones that pay for it, and the two gates it
   actually holds: a node can require a City Hall LICENCE, and a node can open
   a ZONE TYPE.

   ── THE READ API, AND ITS ONE CONTRACT ─────────────────────────────────────
       window.MythicProgress.has(nodeId)          -> bool
       window.MythicProgress.unlockedZones()      -> [zoneId]
       window.MythicProgress.zoneUnlocked(id)     -> bool
       window.MythicProgress.unlockedSpecs()      -> [specId]     (🏙 layer 2)
       window.MythicProgress.specUnlocked(id)     -> bool         (🏙 layer 2)
       window.MythicProgress.specBlockedBy(id)    -> { node, name, cost } | null
       window.MythicProgress.buildingUnlocked(t)  -> bool
       window.MythicProgress.zoneBlockedBy(id)    -> { node, name, cost } | null
       window.MythicProgress.points()             -> { earned, spent, available }

   🔴 ABSENT MODULE ⇒ EVERYTHING UNLOCKED. Every consumer writes the guard as

         const P = window.MythicProgress;
         if (P && !P.zoneUnlocked(id)) refuse();

     so a 404 on /src/progression costs the player the progression screen and
     NEVER their city. That direction is not negotiable and it is the reason
     none of these functions is allowed to throw: /src/zoning and node-city's
     build bar must be able to call them without a try/catch and get an
     answer that fails OPEN.

   ── WHAT THIS MODULE ACTUALLY ENFORCES TODAY, stated plainly ───────────────
     ✔ ZONES. Enforced, by wrapping the four zone writers on
       window.MythicZoning (setZone / applyPaint / applyRect / applyFill).
       Wrapped rather than edited because /src/zoning is another workflow's
       file this round — and because a wrapper survives a rewrite of what it
       wraps, which node-city's own transit and naming hooks say in exactly
       those words.
     ✔ DISTRICT SPECIALISATIONS (🏙 layer 2, /src/districts). Enforced, and
       enforced THERE rather than by another wrapper here: `arm()` in that
       module is the single point where a player picks one, it refuses a locked
       id and names the node, and its store refuses a locked write again behind
       that. Two wrappers around the same gate is how two modules come to
       disagree about whether a thing is open — so this module owns the ANSWER
       and /src/districts owns the REFUSAL, which is the same split /src/zoning
       and /src/landvalue already use for the tenant filter.
     ✔ LICENCES. Enforced as a prerequisite on unlocking a node.
     ✖ BUILDINGS. Declared in the tree and answerable through
       buildingUnlocked(), but NOT enforced: the build bar lives inside
       node-city's module script behind the globals trap, and gating it needs a
       hook in a file two other workflows are editing this round. The data and
       the read API are here so that hook is one line when someone wants it.
       ⚠ The panel does not pretend otherwise — a building unlock is listed as
         what the node opens, and nothing on screen claims a building is
         currently refused.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `cityPop`,
      `builtCount`, `prodPerMin`, `toast`, `opsRowsOf`, `opsPriceOf` and
      `opsCityHall` are all top-level bindings inside node-city's module script
      and are invisible from here. The `ctx` object mount() is handed IS the
      hand-over. Nothing in this module reads a bare global, and nothing here
      can move Cinder: no addCinders, no spendCinders, no addRes. Development
      points are not a currency and never cross the bridge.
   ══════════════════════════════════════════════════════════════════════════ */

import { NODES, NODE_BY_ID, CATS, totalCost, unlocksOf, validate } from './tree.js';
import { METRICS, MILESTONES, ACHIEVEMENTS, totalPointsOnOffer } from './milestones.js';
import { makeState } from './state.js';
import { makePanel } from './panel.js';

let st = null, panel = null, ctx = null, ticker = null, _hostReaders = null;

export function mount(host) {
  ctx = host || {};

  const problems = validate();
  if (problems.length) for (const p of problems) console.warn('[Progress] tree: ' + p);

  /* Held so the driver seam below can blind one reader. It is the object the
     state layer holds, not a copy — see `_blind`. */
  _hostReaders = {
    pop: ctx.pop, built: ctx.built, cinderRate: ctx.cinderRate,
    hasLicence: ctx.hasLicence, licenceLabel: ctx.licenceLabel,
    licencePrice: ctx.licencePrice, licences: ctx.licences,
    zones: ctx.zones, tileTypes: ctx.tileTypes,
    toast: ctx.toast, logEvent: ctx.logEvent,
    save: () => { try { ctx.saveSoon && ctx.saveSoon(); } catch (e) {} },
  };
  st = makeState(_hostReaders);

  panel = makePanel(api, ctx);
  shelfRegister();
  wrapZoning();
  keys();

  /* ⏱ SELF-TICKED, ON PURPOSE. Evaluating three integers every four seconds
     is cheaper than a hook in node-city's economyTick, and one fewer edit to a
     file three workflows are in this round. It is also honest about cadence:
     a milestone is not a simulation step, it is an observation. */
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => { try { st.tick(); if (panel.isOpen()) panel.refresh(); } catch (e) {} }, 4000);

  window.MythicProgress = api;
  return api;
}

/* ── the save shelf ────────────────────────────────────────────────────────
   `MythicCitySave.register()` — the shelf, so node-city's serialize() literal
   needs no edit at all. `load(undefined)` is the LEGACY case and is what arms
   adoption; see state.js. */
let _shelved = false;
function shelfRegister() {
  if (_shelved) return true;
  try {
    const shelf = window.MythicCitySave;
    if (!shelf || typeof shelf.register !== 'function') return false;
    _shelved = shelf.register('progress', {
      save: () => st.save(),
      load: (p) => {
        const r = st.load(p);
        /* Adoption cannot run here: /src/zoning adopts standing buildings into
           zones AFTER loadState, so the zone map is not final yet. afterLoad()
           is the second half and node-city calls it one line later. */
        if (r && r.legacy) try { console.info('[Progress] no progression slice in this save — legacy city, adopting'); } catch (e) {}
      },
    });
  } catch (e) { console.warn('[Progress] save shelf unavailable (non-fatal):', e); }
  return _shelved;
}

/* ══ THE ZONE GATE ════════════════════════════════════════════════════════
   Wraps the four functions on window.MythicZoning that write a zone. Every
   one of them is a NEW paint; nothing here can remove or alter a zone that is
   already on the map (state.js header, "what is deliberately not done").

   ⚠ THE REFUSAL NAMES THE NODE. A gate whose message is "locked" teaches a
     player that the tool is broken. This one says which node opens the zone,
     what it costs, and opens the screen. */
let _wrapped = false;
function wrapZoning() {
  if (_wrapped) return false;
  const Z = window.MythicZoning;
  if (!Z) return false;
  /* 🔴 FAILS OPEN, AND THE try/catch IS THE POINT. This wrapper sits between a
     player and their own zoning tool. If anything in this module throws — a
     future edit, a corrupt slice, a host reader that started answering
     nonsense — the player must still be able to zone. A gate that refuses on
     an internal error is indistinguishable from a gate that refuses on
     purpose, and the player has no way to tell or to fix it. */
  const guard = (id) => {
    try {
      if (!id) return true;                     // de-zoning is always allowed
      if (st.zoneUnlocked(id)) return true;
      /* Last chance before a refusal: the map may already carry this zone (a
         hand-edited save, a load order nobody predicted). Adopt, then re-ask. */
      st.adopt('zone-refusal');
      return st.zoneUnlocked(id);
    } catch (e) { console.warn('[Progress] zone gate failed open:', e); return true; }
  };
  const refuse = (id) => {
    const n = st.nodeForZone(id);
    const zn = zoneName(id);
    try {
      ctx.toast && ctx.toast('🔒 ' + zn + ' is not unlocked yet' +
        (n ? ' — ' + n.name + ' opens it, for ' + (n.cost | 0) + ' ⬡ in Progression (K).' : '.'), 'bad');
    } catch (e) {}
    return false;
  };
  const wrap4 = (name, fn, idArgIndex, zero) => {
    Z[name] = function () {
      const id = arguments[idArgIndex];
      if (id && !guard(id)) { refuse(id); return zero; }
      return fn.apply(this, arguments);
    };
  };
  if (typeof Z.setZone === 'function') wrap4('setZone', Z.setZone, 2, false);
  if (typeof Z.applyPaint === 'function') wrap4('applyPaint', Z.applyPaint, 2, { changed: 0, total: 1, locked: true });
  if (typeof Z.applyRect === 'function') wrap4('applyRect', Z.applyRect, 4, { changed: 0, total: 0, locked: true });
  if (typeof Z.applyFill === 'function') wrap4('applyFill', Z.applyFill, 2, { changed: 0, total: 0, locked: true });
  _wrapped = true;
  return true;
}

/* ── naming things, always from the LIVE table ─────────────────────────── */
function zoneName(id) {
  try {
    const Z = window.MythicZoning;
    const d = Z && Z.ZONE_BY_ID && Z.ZONE_BY_ID[id];
    if (d && d.name) return d.name;
  } catch (e) {}
  return id;
}
/* 🏙 A specialisation's name, from /src/districts' live catalogue. */
function specName(id) {
  try {
    const D = window.MythicDistricts;
    const d = D && D.specDef && D.specDef(id);
    if (d) return d.ico + ' ' + d.name;
  } catch (e) {}
  return id + ' (not in the live district catalogue)';
}
function zoneKnown(id) {
  try {
    const Z = window.MythicZoning;
    return !!(Z && Z.ZONE_BY_ID && Z.ZONE_BY_ID[id]);
  } catch (e) { return false; }
}
function buildingName(t) {
  try { const n = ctx.buildingName && ctx.buildingName(t); if (n) return n; } catch (e) {}
  return t;
}

/* ── keyboard ─────────────────────────────────────────────────────────────
   ⚠ K, and it was checked rather than assumed against node-city's own list:
     W/A/S/D are the camera pan keys, E is the electricity view, G hydrology,
     P pollution, R rotates a building, Escape closes panels. K was free. */
function keys() {
  addEventListener('keydown', (ev) => {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'k' || ev.key === 'K') { panel.toggle(); return; }
    if (ev.key === 'Escape' && panel.isOpen()) panel.close();
  });
}

/* ══ THE VIEW MODEL ═══════════════════════════════════════════════════════
   Everything the panel prints is built here, from a live read, and every
   figure carries the sentence that says where it came from. panel.js computes
   nothing. */
function report() {
  const metrics = st.readMetrics();
  const cats = st.catRollup();
  const pts = st.points();

  /* which nodes name each node as a prerequisite — so a node that unlocks
     nothing directly can still say what it is FOR, instead of reading as a
     dead end. */
  const gatesFor = {};
  for (const n of NODES) for (const r of (n.req || [])) (gatesFor[r] = gatesFor[r] || []).push(n.name);

  const nodeName = {};
  for (const n of NODES) nodeName[n.id] = n.name;

  const nodes = NODES.map((n) => {
    const s = st.status(n);
    const u = unlocksOf(n);
    return {
      id: n.id, cat: n.cat, name: n.name, desc: n.desc, cost: n.cost | 0,
      row: n.row | 0, col: n.col | 0, req: (n.req || []).slice(),
      state: s.state, blockers: s.blockers,
      done: s.state === 'unlocked' || s.state === 'granted',
      licence: n.licence ? st.licenceState(n.licence) : null,
      gatesFor: gatesFor[n.id] || [],
      unlocks: {
        /* ⚠ A zone id the live catalogue does not carry is shown as what it is
             — an id with no entry — rather than as a friendly name this file
             made up. Same rule as every figure on the screen. */
        zones: u.zones.map((z) => ({ id: z, name: zoneKnown(z) ? zoneName(z) : (z + ' (not in the live zone catalogue)') })),
        /* 🏙 Same rule as the zones above: named from the LIVE catalogue, and a
           spec id /src/districts does not carry is shown as what it is rather
           than under a friendly name this file invented. */
        specs: u.specs.map((p) => ({ id: p, name: specName(p) })),
        buildings: u.buildings.map((b) => ({ id: b, name: buildingName(b) })),
        ops: u.ops.map((o) => ({ id: o, name: (ctx.licenceLabel && ctx.licenceLabel(o)) || o })),
      },
    };
  });

  const milestones = MILESTONES.map((m) => {
    const met = metrics[m.metric] || { ok: false, why: 'unknown metric ' + m.metric };
    const reached = st.S.reached.has(m.id);
    let progress;
    if (!met.ok) progress = { ok: false, why: met.why };
    else {
      const pct = Math.max(0, Math.min(100, Math.round((met.value / m.at) * 100)));
      progress = { ok: true, pct, text: fmt(met.value) + ' / ' + fmt(m.at) + (met.unit || '') };
    }
    return { id: m.id, name: m.name, desc: m.desc, pts: m.pts, at: m.at,
             label: met.label || m.metric, source: met.source || '', reached, progress };
  });

  const view = { metrics, cats };
  const achievements = ACHIEVEMENTS.map((a) => {
    let s;
    try { s = a.test(ctx, view); } catch (e) { s = { ok: false, why: 'the trigger threw: ' + (e && e.message || e) }; }
    return { id: a.id, name: a.name, ico: a.ico, desc: a.desc, how: a.how,
             earned: st.S.earned.has(a.id), reward: a.reward || null, state: s || { ok: false, why: 'no answer' } };
  });

  const sources = Object.keys(METRICS).map((k) => ({ label: METRICS[k].label, source: METRICS[k].source }));
  sources.push({ label: 'Licences', source: 'the City Hall operations manifest — node-city opsRowsOf() / opsPriceOf(), handed over as ctx.hasLicence() and ctx.licencePrice()' });
  sources.push({ label: 'Zone names', source: 'window.MythicZoning.ZONE_BY_ID, read live at draw time' });
  sources.push({ label: 'District names', source: 'window.MythicDistricts.specDef(), read live at draw time' });

  return {
    points: pts,
    total: { nodes: NODES.length, cost: totalCost(), onOffer: totalPointsOnOffer() },
    cats, nodes, nodeName, metrics, milestones, achievements, sources,
    reachedCount: st.S.reached.size,
    unlockedCount: st.S.unlocked.size,
    legacy: st.S.legacy,
    legacyNote: 'This city was built before progression existed. Everything it already has — every zone on the map, ' +
      'every licence at City Hall, every building standing — was granted free and cost no points. Nothing you have ' +
      'built has been taken away.',
    footNote: NODES.length + ' nodes · ' + totalCost() + ' ⬡ to clear · ' + totalPointsOnOffer() + ' ⬡ on offer',
  };
}

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return (Math.abs(v) >= 1000) ? v.toLocaleString() : String(v);
}

/* ══ THE PUBLIC API ═══════════════════════════════════════════════════════ */
const api = {
  /* the read API — none of these throws, all of them fail OPEN */
  has: (id) => { try { return st ? st.has(id) : true; } catch (e) { return true; } },
  unlockedZones: () => { try { return st ? st.unlockedZones() : []; } catch (e) { return []; } },
  zoneUnlocked: (id) => { try { return st ? st.zoneUnlocked(id) : true; } catch (e) { return true; } },
  /* 🏙 LAYER 2. Both fail OPEN for the same reason every other reader here
     does: a 404 or a throw must cost the player the research screen and never
     a district they have already painted. */
  unlockedSpecs: () => { try { return st ? st.unlockedSpecs() : []; } catch (e) { return []; } },
  specUnlocked: (id) => { try { return st ? st.specUnlocked(id) : true; } catch (e) { return true; } },
  specBlockedBy: (id) => {
    try {
      if (!st || st.specUnlocked(id)) return null;
      const n = st.nodeForSpec(id);
      return n ? { node: n.id, name: n.name, cost: n.cost | 0 } : null;
    } catch (e) { return null; }
  },
  buildingUnlocked: (t) => { try { return st ? st.buildingUnlocked(t) : true; } catch (e) { return true; } },
  zoneBlockedBy: (id) => {
    try {
      if (!st || st.zoneUnlocked(id)) return null;
      const n = st.nodeForZone(id);
      return n ? { node: n.id, name: n.name, cost: n.cost | 0 } : null;
    } catch (e) { return null; }
  },
  buildingBlockedBy: (t) => {
    try {
      if (!st || st.buildingUnlocked(t)) return null;
      const n = st.nodeForBuilding(t);
      return n ? { node: n.id, name: n.name, cost: n.cost | 0 } : null;
    } catch (e) { return null; }
  },
  points: () => { try { return st.points(); } catch (e) { return { earned: 0, spent: 0, available: 0 }; } },

  /* actions */
  unlock: (id) => {
    const r = st.unlock(id);
    if (!r.ok && r.reason === 'blocked') {
      const b = (r.blockers || [])[0];
      try { ctx.toast && ctx.toast('🔒 ' + (b ? b.text : 'Not available yet.'), 'bad'); } catch (e) {}
    } else if (r.ok) {
      try { ctx.toast && ctx.toast('⬡ ' + r.node.name + ' unlocked.', 'good'); } catch (e) {}
      try { ctx.logEvent && ctx.logEvent('city', '⬡ Development: ' + r.node.name + ' unlocked for ' + (r.node.cost | 0) + ' points.'); } catch (e) {}
      try { if (window.MythicZoning && window.MythicZoning.panel) window.MythicZoning.sync && window.MythicZoning.sync(); } catch (e) {}
    }
    if (panel) panel.refresh();
    return r;
  },
  openCityHall: (key) => { try { return ctx.cityHall ? ctx.cityHall(key) : null; } catch (e) { return null; } },

  /* the panel */
  panel: (v) => panel.open(v == null ? true : v),
  togglePanel: () => panel.toggle(),
  openPanel: () => panel.open(true),
  closePanel: () => panel.open(false),
  select: (id) => panel.select(id),

  /* lifecycle */
  afterLoad: () => {
    /* Registration may have raced the shelf; both are idempotent. */
    shelfRegister(); wrapZoning();
    const n = st.adopt('afterLoad');
    st.tick();
    if (panel && panel.isOpen()) panel.refresh();
    return { adopted: n, legacy: st.S.legacy, points: st.points() };
  },
  tick: () => st.tick(),
  report,
  nodeById: (id) => NODE_BY_ID[id] || null,

  /* 🃏 THE CARD SEAM. Fires once, on the edge, never on a load — see
     milestones.js. `fn` receives { id, name, desc, reward }. */
  onAchievement: (fn) => st.on('achievement', fn),
  onChange: (fn) => st.on('change', fn),

  /* diagnostics — this is a module, so nothing in it is on window otherwise */
  state: () => ({
    unlocked: Array.from(st.S.unlocked), granted: Array.from(st.S.granted),
    reached: Array.from(st.S.reached), earned: Array.from(st.S.earned),
    spent: st.S.spent, legacy: st.S.legacy, points: st.points(),
    zones: st.unlockedZones(), specs: st.unlockedSpecs(),
    wrappedZoning: _wrapped, shelved: _shelved,
  }),
  tree: { NODES, CATS, METRICS, MILESTONES, ACHIEVEMENTS, validate },
  /* ⚠ TEST SEAM ONLY, and it is deliberately not on the surface a player can
     reach: it grants a node without spending, so a driver can prove a
     downstream gate opens without first simulating 400 residents. */
  _grant: (id) => { if (!NODE_BY_ID[id]) return false; st.S.granted.add(id); st.fire('change'); if (panel) panel.refresh(); return true; },
  /* ⚠ TEST SEAM, and the ONLY way to see the unavailable branch without a
     broken deploy. It removes one host reader for the rest of the session, so
     a driver can prove that a figure with no model behind it is shown as
     unavailable WITH ITS REAL REASON rather than as a plausible number —
     which is the rule this whole panel is built under, and the one thing
     about it that cannot be checked by reading the code. */
  _blind: (k) => { if (!_hostReaders || !(k in _hostReaders)) return false; delete _hostReaders[k]; if (panel) panel.refresh(); return true; },
};
