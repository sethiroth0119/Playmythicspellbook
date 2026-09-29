/* ════════════════════════════════════════════════════════════════════════════
   SUPPLY CHAIN · graph.js — the ONE view model every view reads.

   buildGraph({catalog, businesses, recipes, coverage, shipping, loot}) merges the
   wave-1 truth files into nodes / edges / lanes and, just as importantly, a
   report that says where those files disagree with each other.

   WHY THIS FILE AUTHORS NOTHING. Every fact on the map already has exactly one
   owner: businesses.js (the owner's PDF), recipes.js (what rides each lane),
   coverage.js (who uses each resource), loot.js (where it drops), shipping.js
   (how it travels). If graph.js "helpfully" filled a gap — an empty truck, a
   need nobody makes — the map would look finished while the data underneath
   was wrong, and the defect would never reach the piece that can fix it. So a
   gap is never patched here: it becomes a report.errors row that names the
   owning piece. Rejected: a lenient merge with defaults. It is how a business
   that can never be supplied ends up looking healthy on a map.

   WHY THE SIBLINGS ARE PARAMETERS, NOT IMPORTS. The contract keeps pure files
   importable alone and lets a test hand in a MUTATED copy of one sibling to
   prove the matching report row turns red. data.js is the only file that
   imports the real modules. Each parameter may be the module namespace (what
   data.js passes) or, for the catalogue, a bare row array.

   WHY SHIPPING DRAWS THE LANES. A supply edge never gets `via:'transport'`
   because this file says so. It gets it because shipping.route() returned the
   four legs with the haul on the carrier. shipping.js has no code path that
   returns a direct A -> B goods lane, so a direct lane can only appear here as
   an error ('supply-not-via-transport'), never as a drawing.

   WHAT "live" MEANS ON AN EDGE (contract hard rule 3). `live:true` = at least
   one cargo id really moves between those two tiles in the shipped game
   (`liveIds`). It NEVER means the player is forced to hire Transport for it —
   that is `enforcedToday` on the lane, which is false everywhere except the two
   medical waybill lanes shipping.js cites. A view must show both.

   WHY EVERY EDGE CARRIES `pdf`. The owner said "follow the map I made". Edges
   the owner DREW (needs icons, Marketplace icons, system arrows, the battler
   card) have pdf:true. Edges that are true in the game or implied by the
   written goal but not drawn (what an op burns today, buying from the
   Marketplace, battle loot into a business) have pdf:false, so a view can keep
   the owner's picture clean and still answer "where do I get this".

   OPTIONAL INPUTS BESIDE THE SIX (all handed in, none authored here):
     data.systemMakes   {sysId:[{id,by,alsoBy,live,cite}]} what a SYSTEM's own
                        facilities make (data.js derives the City Builder's from
                        the game's building catalogue)
     data.channelScope  {channelId:{families,why,cite}} what a specialised
                        counter sells (the PDF legend, quoted in data.js)
     data.ownerExamples the owner's named routes, checked hard
     data.ctx / data.opsEcon / data.pin   session facts, live re-check, no-pin

   Pure: no window, no DOM, no imports, no clock, no randomness. Same input,
   byte-identical JSON. There is not one economy number in this file.
   ════════════════════════════════════════════════════════════════════════════ */

const CARRIER_FALLBACK = 'transport';
const KIND_ORDER = ['system', 'supply', 'channel', 'service', 'loot'];

const isObj = (v) => v !== null && typeof v === 'object';
const arr = (v) => (Array.isArray(v) ? v : []);
const uniq = (a) => Array.from(new Set(a));

/* !! STALENESS — READ THIS BEFORE CALLING neighbours(id) / resourceFlow(id) WITH
   ONE ARGUMENT. The contract asks for one-argument helpers, so they fall back
   to the last graph this module PINNED. That is module-level state and it is
   shared by everything in the realm: a live re-assemble in the shell, or a
   mutant test, replaces it under a view that is still on screen.
     - Views MUST call g.neighbours(id) / g.resourceFlow(id) / g.stats on the
       graph they were handed. Those are bound to that graph and cannot go stale.
     - A build that was not given all six siblings is never pinned (round 1: a
       failed live re-assemble ran buildGraph({}) and every later
       resourceFlow('cloth') answered known:false although the map on screen was
       fine).
     - A test that builds a deliberately broken graph passes {pin:false}. */
let LAST = null;

/* ---------------------------------------------------------------- report -- */

function makeReport() {
  const errors = [], warnings = [], notes = [];
  /* ONE Set PER SEVERITY, not one shared Set. A shared Set dedupes across
     severities, so a note or warning pushed first would swallow a later ERROR
     that happened to share the same code|piece|refs triple — and swallow it
     silently, leaving a green report over a real defect. No code is reused
     across severities today, so this was latent rather than live when it was
     found (round 6 review), but the next reused code would have cost a bar. */
  const seenBy = [new Set(), new Set(), new Set()];
  /* `piece` = who has to fix it. The lead routes each row to that builder. */
  /* Dedupe on WHAT the row is about (code + owner + the ids), not on the
     sentence. Two sites legitimately report the same defect in different words —
     the per-resource audit and coverage.uncovered() both raise
     resource-no-consumer for the same id — and keying on `msg` silently let the
     count double the moment one of those sentences was reworded (round 5: 8
     errors became 12 with no new defect). Rows with no refs still key on msg,
     which is all they have. */
  const push = (list, sev) => (code, piece, msg, refs) => {
    const key = refs && refs.length ? code + '|' + piece + '|' + refs.join('\u0000') : code + '|' + piece + '|' + msg;
    const seen = seenBy[sev];
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ code, piece, msg, refs: refs || [] });
  };
  /* notes = true observations that are NOBODY'S defect (a curated choice a
     sibling is entitled to make). They never fail the bar and never reach a
     player; they exist so the owning piece can read them. */
  return { errors, warnings, notes, err: push(errors, 0), warn: push(warnings, 1), note: push(notes, 2) };
}

/* ------------------------------------------------------------- normalise -- */

const run0 = (fn) => { try { return fn(); } catch (_) { return null; } };

function catalogRows(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (isObj(catalog)) {
    if (Array.isArray(catalog.CATALOG)) return catalog.CATALOG;
    if (typeof catalog.all === 'function') { try { const r = catalog.all(); if (Array.isArray(r)) return r; } catch (_) { /* fall through */ } }
    if (Array.isArray(catalog.rows)) return catalog.rows;
  }
  return null;
}

function phantomIds(data) {
  /* Three siblings each carry a phantom list in a different shape. The union is
     used: an id any of them calls a phantom must never ride an edge. */
  const out = new Set();
  const take = (p) => {
    if (Array.isArray(p)) for (const x of p) out.add(typeof x === 'string' ? x : x && x.id);
    else if (isObj(p)) for (const k of Object.keys(p)) out.add(k);
  };
  take(data.catalog && data.catalog.PHANTOMS);
  take(data.coverage && data.coverage.PHANTOMS);
  take(data.recipes && data.recipes.PHANTOMS);
  take(data.loot && data.loot.PHANTOM_IDS);
  out.delete(undefined); out.delete(null);
  return out;
}

function deepFreeze(o) {
  if (!isObj(o) || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.keys(o)) deepFreeze(o[k]);
  return o;
}

/* --------------------------------------------------------------- builder -- */

export function buildGraph(data) {
  const d = isObj(data) ? data : {};
  const rep = makeReport();

  for (const k of ['catalog', 'businesses', 'recipes', 'coverage', 'shipping', 'loot']) {
    if (!d[k]) rep.err('missing-data', 'graph', 'buildGraph was not given "' + k + '"', [k]);
  }

  const rows = catalogRows(d.catalog) || [];
  if (!rows.length) rep.err('missing-data', 'catalog', 'the resource catalogue is empty');
  const resById = new Map(rows.map((r) => [r.id, r]));
  const phantoms = phantomIds(d);

  const B = d.businesses || {};
  const R = (d.recipes && d.recipes.RECIPES) || {};
  const C = d.coverage || {};
  const S = d.shipping || {};
  const L = d.loot || {};
  const USES = C.USES || {};
  const CARRIER = typeof S.CARRIER === 'string' ? S.CARRIER : CARRIER_FALLBACK;

  /* ONE ctx for every route() call. Session facts (offline, signed out) come in
     through data.ctx from the shell; they can only ever LOWER what shipping.js
     reports as enforced, never raise it (see shipping.js). */
  const shipCtx = Object.assign({}, isObj(d.ctx) ? d.ctx : {}, {
    businesses: arr(B.BUSINESSES), recipes: R, coverage: C, catalog: rows,
  });
  const route = (args) => {
    if (typeof S.route !== 'function') return { ships: false, legs: [], reasonCode: 'no-shipping-module' };
    return S.route(args, shipCtx);
  };
  const isLootable = (id) => (typeof L.isLootable === 'function' ? L.isLootable(id, rows) === true : false);

  /* ---------------------------------------------------------------- nodes */

  const nodes = [];
  const nodeById = new Map();
  const addNode = (n) => {
    if (nodeById.has(n.id)) { rep.err('duplicate-node', 'pdfmap', 'node id "' + n.id + '" appears twice', [n.id]); return; }
    nodeById.set(n.id, n); nodes.push(n);
  };

  for (const s of arr(B.SYSTEMS).slice().sort((a, b) => (a.order || 0) - (b.order || 0))) {
    addNode({
      id: s.id, type: 'system', kind: 'system', label: s.label, pdfLabel: s.pdfLabel, opId: null,
      status: 'live', system: s.id, group: 'systems', page: s.page, order: nodes.length,
      blurb: s.blurb || null, bestBuyers: s.bestBuyers || null, bestBuyersNodes: arr(s.bestBuyersNodes).slice(),
      badges: { transport: false, market: false, carMarket: false, card: false }, badgeDoubt: [],
      truckDrawn: false, goalSaysTransport: false,
      caption: null, service: null, plannedNote: null, cityOnly: false,
      ambiguities: arr(s.ambiguities).slice(), pdfCite: s.pdfCite || null,
    });
  }
  for (const c of arr(B.CHANNELS)) {
    addNode({
      id: c.id, type: 'channel', kind: 'channel', label: c.label, pdfLabel: c.pdfLabel, opId: null,
      status: 'live', system: null, group: 'channels', page: c.pdfCite ? c.pdfCite.page : null, order: nodes.length,
      blurb: c.legend || null, bestBuyers: null, bestBuyersNodes: [],
      badges: { transport: false, market: false, carMarket: false, card: false }, badgeDoubt: [],
      truckDrawn: false, goalSaysTransport: false,
      caption: null, service: null, plannedNote: null, cityOnly: false,
      ambiguities: arr(c.ambiguities).slice(), pdfCite: c.pdfCite || null,
    });
  }
  /* 🔴 A TILE IS ONLY "LIVE" IF THIS BUILD REALLY HAS THE OPERATION.
     businesses.js records what the game had when the row was written, and that
     is not the same question as what the player in front of us can found today:
     a business can sit in the tree as somebody's unshipped work for weeks. The
     shell hands us `opsEcon` — every op id on the map that the RUNNING game
     answered `_opEcon` for — so an id with a row in our data and none in the
     game is demoted to planned here, once, rather than in each of the four
     views. It heals itself the moment that operation ships.
     ⚠ Only when the live table actually arrived (the shell omits it entirely if
       the bridge is missing). Treating "no table" as "no operations" would mark
       all 25 businesses planned on any page where the seam failed to load —
       a confident, wrong map, which is worse than no map. Caught on v193:
       Car Factory (owner's PDF, page 8) was printing LIVE in a build whose
       index.html has no carfactory op. */
  const liveOps = isObj(d.opsEcon) && Object.keys(d.opsEcon).length ? d.opsEcon : null;
  for (const b of arr(B.BUSINESSES)) {
    const rec = R[b.id];
    if (!rec) rep.err('no-recipe', 'recipes', 'tile "' + b.id + '" is on the PDF map but has no RECIPES row', [b.id]);
    const icons = b.icons || {};
    const opMissing = !!(liveOps && b.opId && !liveOps[b.opId]);
    if (opMissing) rep.warn('op-not-in-build', 'graph', b.label + ' is marked live in the data but this build has no "' + b.opId + '" operation — shown as planned', [b.id]);
    addNode({
      id: b.id, type: 'business', kind: b.kind, label: b.label, pdfLabel: b.pdfLabel, opId: b.opId || null,
      opMissing: opMissing,
      status: (b.status === 'planned' || opMissing) ? 'planned' : 'live', system: b.system || 'sys:business',
      /* group = the PDF page the owner drew the tile on. The scene lays tiles out
         in these clusters so the 3D map still reads as pages 6 to 9. */
      group: 'p' + b.page, page: b.page, order: nodes.length,
      blurb: null, bestBuyers: null, bestBuyersNodes: [],
      badges: { transport: icons.transport, market: icons.market, carMarket: icons.carMarket, card: icons.card },
      badgeDoubt: arr(b.iconDoubt).slice(),
      truckDrawn: icons.transport === true, goalSaysTransport: b.goalSaysTransport === true,
      caption: b.caption || null, service: (rec && rec.service) || null,
      plannedNote: (rec && rec.planned)
        || (b.status === 'planned' ? 'Not in the game yet: this tile exists only on the owner\'s map.' : null)
        || (opMissing ? 'Not in this build of the game yet — the map keeps it because the owner drew it.' : null),
      cityOnly: b.cityOnly === true,
      ambiguities: arr(b.ambiguities).slice(), pdfCite: b.pdfCite || null,
    });
  }
  for (const id of Object.keys(R)) if (!nodeById.has(id)) rep.err('dangling-id', 'recipes', 'RECIPES has a row for "' + id + '" which is not a tile on the map', [id]);
  if (!nodeById.has(CARRIER)) rep.err('dangling-id', 'shipping', 'the carrier "' + CARRIER + '" is not a node', [CARRIER]);

  /* WHAT A SYSTEM MAKES (round 4). Until now the only thing the map knew a system
     to make was ingots, through loot.js's "never drops" marker, so the City
     Builder was drawn producing one id while the game's own building catalogue
     banks 130 into the player's ledger — cloth among them. The rows are handed
     in (data.js derives them from src/city/production.data.js; a sibling may
     also export SYSTEM_MAKES / SYSTEM_MADE) and this file still authors none.
     Whether each system produces ANYTHING is checked after the needs pass. */
  const sysMakes = new Map();               // sysId -> [{id, by, alsoBy, live, cite}]
  const sysMadeBy = new Map();              // resId -> [{node, by, cite, live}]
  for (const bag of [d.systemMakes, d.recipes && d.recipes.SYSTEM_MAKES, d.loot && d.loot.SYSTEM_MADE]) {
    if (!isObj(bag)) continue;
    for (const sysId of Object.keys(bag)) {
      const owner = nodeById.get(sysId);
      if (!owner || owner.type !== 'system') { rep.err('dangling-id', 'graph', 'systemMakes names "' + sysId + '" which is not a system node', [sysId]); continue; }
      if (!sysMakes.has(sysId)) sysMakes.set(sysId, []);
      for (const r of arr(bag[sysId])) {
        if (!isObj(r) || sysMakes.get(sysId).some((x) => x.id === r.id)) continue;
        if (phantoms.has(r.id)) { rep.err('phantom-cargo', 'graph', 'systemMakes.' + sysId + ' lists phantom id "' + r.id + '"', [r.id]); continue; }
        if (!resById.has(r.id)) { rep.err('dangling-id', 'graph', 'systemMakes.' + sysId + ' lists "' + r.id + '" which is not in the catalogue', [r.id]); continue; }
        const row = { id: r.id, by: r.by || null, alsoBy: arr(r.alsoBy).slice(), live: r.live === true, cite: r.cite || null };
        sysMakes.get(sysId).push(row);
        if (!sysMadeBy.has(r.id)) sysMadeBy.set(r.id, []);
        sysMadeBy.get(r.id).push({ node: sysId, by: row.by, cite: row.cite, live: row.live });
      }
    }
  }

  /* ---------------------------------------------------------------- edges */

  const edges = [];
  const edgeById = new Map();
  const lanes = [];

  const checkCargo = (ids, where, piece) => {
    for (const id of ids) {
      if (phantoms.has(id)) rep.err('phantom-cargo', piece, where + ' uses phantom id "' + id + '"', [id]);
      else if (!resById.has(id)) rep.err('dangling-id', piece, where + ' names resource "' + id + '" which is not in the catalogue', [id]);
    }
  };

  function addEdge(e) {
    if (!nodeById.has(e.from)) rep.err('dangling-id', e.piece || 'graph', 'edge ' + e.id + ' starts at unknown node "' + e.from + '"', [e.from]);
    if (!nodeById.has(e.to)) rep.err('dangling-id', e.piece || 'graph', 'edge ' + e.id + ' ends at unknown node "' + e.to + '"', [e.to]);
    if (edgeById.has(e.id)) { rep.err('duplicate-edge', e.piece || 'graph', 'edge id "' + e.id + '" built twice', [e.id]); return edgeById.get(e.id); }
    delete e.piece;
    edgeById.set(e.id, e); edges.push(e);
    return e;
  }

  const truckCache = new Map();
  const truckOf = (id) => {
    if (!truckCache.has(id)) {
      const t = typeof S.pdfTruckDrawn === 'function' ? S.pdfTruckDrawn(id, arr(B.BUSINESSES), shipCtx) : null;
      truckCache.set(id, { drawn: isObj(t) ? t.drawn === true : null, label: isObj(t) ? t.label || null : null });
    }
    return truckCache.get(id);
  };

  /* A goods edge is routed by shipping.js once per cargo id (the rig class can
     differ per id: fuel rides a tanker, metal rides freight). The lane is drawn
     only if EVERY id gets the four legs with the haul on the carrier. */
  function shipEdge(e, channel) {
    const classes = []; let first = null; let bad = null;
    const ids = e.cargo.length ? e.cargo : [null];
    for (const resId of ids) {
      const args = resId ? { from: e.from, to: e.to, resId } : { from: e.from, to: e.to, cargo: true };
      if (channel) args.channel = channel;
      const r = route(args);
      const legs = arr(r && r.legs);
      const four = legs.map((l) => l.kind).join('>') === 'pickup>haul>depot>deliver' && legs.every((l) => l.kind !== 'haul' || l.node === CARRIER);
      if (!four) { bad = bad || { resId, reasonCode: r && r.reasonCode }; continue; }
      if (!first) first = r;
      if (r.cargoClass && classes.indexOf(r.cargoClass) < 0) classes.push(r.cargoClass);
    }
    if (bad || !first) {
      e.via = null;
      return bad || { resId: null, reasonCode: 'no-route' };
    }
    e.via = CARRIER;
    const path = [];
    for (const l of first.legs) if (path[path.length - 1] !== l.node) path.push(l.node);
    lanes.push({
      id: 'lane:' + e.id, edge: e.id, from: e.from, to: e.to, path,
      legs: first.legs.map((l) => ({ kind: l.kind, node: l.node })),
      cargoClasses: classes.sort(),
      selfHaul: first.selfHaul === true,
      carrierRequired: first.carrierRequired === true,
      /* The honest pair: the owner's rule is drawn, and whether the game makes
         you follow it today is said next to it. */
      tag: first.tag || 'proposed', enforcedToday: first.enforcedToday === true, phase: first.phase == null ? null : first.phase,
      /* owner decision D6: the written goal routes it through Transport even where
         the PDF draws no truck beside the sender. Both facts are kept. */
      truckDrawn: truckOf(e.from).drawn, truckLabel: truckOf(e.from).label,
      whatHappensToday: first.whatHappensToday || null,
      cite: first.cite || null,
    });
    return null;
  }

  /* 1 ─ the four-system loop (PDF p1). */
  for (const f of arr(B.SYSTEM_FLOW)) {
    const ch = f.carries && f.carries.channel ? f.carries.channel : null;
    addEdge({
      id: 'system:' + f.from + '>' + f.to, from: f.from, to: f.to, kind: 'system', cargo: [], via: null,
      /* The Marketplace exists and settles for Cinder today. Rounds 1 to 3 left
         the cargo empty ("the PDF does not fix which ids cross", ambiguity M) and
         the map therefore drew four arrows that carried nothing. The PDF does
         not list the ids, but the data does: what the sending system produces
         that the receiving system uses. Filled after the needs pass (step 4b). */
      live: true, liveIds: [], pdf: f.drawn === true, implied: f.drawn !== true,
      /* the hand-off drawn THROUGH the Marketplace, as a polyline a view can follow */
      path: ch ? [f.from, ch, f.to] : [f.from, f.to],
      channel: ch, currency: f.carries ? f.carries.currency || null : null,
      label: f.carries ? f.carries.label || null : null,
      basis: f.drawn === true ? 'pdf-arrow' : 'pdf-prose', why: f.basis || (f.carries && f.carries.reading) || null,
      confidence: f.confidence || null, ambiguity: f.ambiguity || null,
      cite: 'Resource Marketplace: resMarketPost / resMarketTake / _resSettleEntry (public/index.html) — lists ledger resources for Cinder, settles instantly',
      piece: 'pdfmap',
    });
    if (f.drawn === true && ch !== 'ch:market') rep.err('loop-no-market', 'pdfmap', 'drawn hand-off ' + f.from + ' -> ' + f.to + ' does not carry the Marketplace', [f.id]);
  }

  /* who makes what — built BEFORE the lanes so every lane can be checked against
     it. Round 1 left "the sender really makes this" to recipes.validateRecipes,
     which closes over the REAL RECIPES: a mutated copy handed to buildGraph was
     never checked and Mining shipped cloth to the Weapon Smith, live:true, in
     silence. A merge must not rely on a sibling policing itself. */
  const makersOf = new Map();               // resId -> [{biz, live, via, inStash}]
  for (const b of arr(B.BUSINESSES)) for (const m of arr(R[b.id] && R[b.id].makes)) {
    if (!makersOf.has(m.id)) makersOf.set(m.id, []);
    makersOf.get(m.id).push({ biz: b.id, live: m.live === true && b.status !== 'planned', via: m.via || null, inStash: m.live === true && m.via !== 'cityFirm' && b.status !== 'planned' });
    checkCargo([m.id], b.id + '.makes', 'recipes');
  }
  const makes = (biz, id) => arr(makersOf.get(id)).some((m) => m.biz === biz);
  const checkMade = (from, to, ids, liveIds, what) => {
    if (!nodeById.has(from)) return;        // already reported once as dangling-id (RECIPES row / edge start)
    for (const id of ids) if (!makes(from, id)) rep.err('cargo-not-made', 'recipes', what + ' ' + from + ' -> ' + to + ' ships "' + id + '" but RECIPES.' + from + '.makes does not list it', [from, to, id]);
    for (const id of liveIds) {
      if (ids.indexOf(id) < 0) rep.err('live-id-not-cargo', 'recipes', what + ' ' + from + ' -> ' + to + ' marks "' + id + '" live but it is not in the cargo', [from, to, id]);
    }
  };

  /* 2 ─ supply lanes: exactly recipes.js buys[] (= the PDF needs icons). */
  const pdfPairs = new Map();               // 'needer|needed' -> needs row from businesses.js
  for (const b of arr(B.BUSINESSES)) for (const n of arr(b.needs)) pdfPairs.set(b.id + '|' + n.biz, n);
  const pdfSeen = new Set();

  for (const b of arr(B.BUSINESSES)) {
    const rec = R[b.id]; if (!rec) continue;
    for (const l of arr(rec.buys)) {
      const from = l.from, to = b.id;
      const cargo = arr(l.ids).slice();
      /* which icon drew it: on the receiver (needs-as-supplier) or on the sender (needs-as-buyer) */
      const asSupplier = pdfPairs.get(to + '|' + from), asBuyer = pdfPairs.get(from + '|' + to);
      const need = asSupplier || asBuyer || null;
      if (asSupplier) pdfSeen.add(to + '|' + from);
      if (asBuyer) pdfSeen.add(from + '|' + to);
      if (!need) rep.err('lane-not-on-pdf', 'recipes', 'recipes lane ' + from + ' -> ' + to + ' has no needs icon on the owner\'s map', [from, to]);
      if (!cargo.length) rep.err('pdf-edge-no-cargo', 'recipes', 'PDF edge ' + from + ' -> ' + to + ' has an empty truck', [from, to]);
      checkCargo(cargo, 'lane ' + from + ' -> ' + to, 'recipes');
      checkMade(from, to, cargo, arr(l.liveIds), 'lane');
      /* WHICH WAY THE ICON POINTS. businesses.js records how the owner's icon
         reads (`direction`); recipes.js decides which way the truck drives. When
         the two differ somebody has re-read the owner's map. That is allowed
         only in the open: the needs row must carry an ambiguity id (the owner
         is then already being asked, see the pdf-ambiguity warning) or say
         'ambiguous'. Otherwise it is an error — round 1 drew
         "Salvage needs Trash Crusher" backwards from what businesses.js states
         as 'sure', and said nothing. */
      const drawnDir = need ? (asSupplier ? 'supplier' : 'buyer') : null;
      const drift = Boolean(need) && need.direction !== 'ambiguous' && need.direction !== drawnDir;
      if (drift && !need.ambiguity) {
        rep.err('direction-drift', 'pdfmap', 'the map says "' + (asSupplier ? to : from) + ' needs ' + (asSupplier ? from : to) + '" with direction "' + need.direction + '" (' + (need.directionConfidence || need.confidence) + ') and no ambiguity id, but recipes.js drives the lane as needs-' + drawnDir + ' (' + from + ' -> ' + to + '). Either businesses.js marks the row as an open reading (ambiguity C) or recipes.js follows the stated direction', [from, to, 'supply:' + from + '>' + to]);
      }
      const e = addEdge({
        id: 'supply:' + from + '>' + to, from, to, kind: 'supply', cargo, via: null,
        live: l.live === true, liveIds: arr(l.liveIds).slice(), liveVia: l.liveVia || null,
        pdf: Boolean(need), basis: 'pdf-needs',
        drawnOn: need ? (asSupplier ? to : from) : null,
        direction: need ? (asSupplier ? 'supplier' : 'buyer') : null,
        pdfDirection: need ? need.direction : null, directionDrift: drift,
        confidence: need ? need.confidence : null, ambiguity: need ? need.ambiguity || null : null,
        why: l.why || null, cite: l.cite || null, consumerCite: l.consumerCite || null,
        cargoIsItem: l.cargoIsItem === true, sourceToday: arr(l.sourceToday).slice(),
        upkeepCargo: [],
        piece: 'recipes',
      });
      const bad = shipEdge(e);
      if (bad) rep.err('supply-not-via-transport', 'shipping', 'supply edge ' + from + ' -> ' + to + ' is not routed through ' + CARRIER + ' (' + (bad.resId || 'cargo') + ': ' + bad.reasonCode + ')', [e.id]);
    }
  }
  for (const [key, n] of pdfPairs) {
    if (pdfSeen.has(key)) continue;
    const [needer, needed] = key.split('|');
    rep.err('pdf-edge-missing', 'recipes', 'the map draws "' + needer + ' needs ' + needed + '" but no recipes lane carries anything between them', [needer, needed, n.ambiguity || '']);
  }
  /* Drawn lanes, remembered for the "shared id left off the truck" pass in the
     needs loop (coverage is not known yet at this point). */
  const drawnLaneChecks = [];
  for (const e of edges) if (e.kind === 'supply' && e.basis === 'pdf-needs' && e.pdf) drawnLaneChecks.push(e.id);

  /* recipes.js keeps its own copy of the PDF table so it can self-check; if that
     copy and businesses.js ever differ, one of them has misread the map. */
  if (d.recipes && Array.isArray(d.recipes.PDF_NEEDS)) {
    const a = new Set(d.recipes.PDF_NEEDS.map((p) => p[0] + '|' + p[1]));
    for (const k of pdfPairs.keys()) if (!a.has(k)) rep.err('pdf-table-drift', 'recipes', 'businesses.js draws ' + k.replace('|', ' needs ') + ' but recipes.PDF_NEEDS does not list it', [k]);
    for (const k of a) if (!pdfPairs.has(k)) rep.err('pdf-table-drift', 'pdfmap', 'recipes.PDF_NEEDS lists ' + k.replace('|', ' needs ') + ' but businesses.js does not draw it', [k]);
  }

  /* 2b ─ what an op burns TODAY that the owner drew no lane for (recipes upkeep).
     True in the shipped game, so it has to be answerable ("Research needs metal:
     who makes metal?"), but it is NOT the owner's map: pdf:false, and folded into
     the drawn lane when one already joins the same two tiles. */
  for (const b of arr(B.BUSINESSES)) {
    const rec = R[b.id]; if (!rec) continue;
    const byMaker = new Map();
    for (const u of arr(rec.upkeep)) {
      checkCargo([u.id], 'upkeep of ' + b.id, 'recipes');
      for (const m of arr(u.madeBy)) {
        /* madeBy is derived inside recipes.js, but a copy handed in here is only
           as true as its makes[]: a lying madeBy would draw a live lane from a
           business that cannot fill it. */
        if (!nodeById.has(m)) { rep.err('dangling-id', 'recipes', 'upkeep of ' + b.id + ' says "' + u.id + '" is made by unknown tile "' + m + '"', [b.id, u.id, m]); continue; }
        if (!makes(m, u.id)) { rep.err('upkeep-maker-lies', 'recipes', 'upkeep of ' + b.id + ' says "' + u.id + '" is made by ' + m + ' but RECIPES.' + m + '.makes does not list it', [b.id, u.id, m]); continue; }
        if (!byMaker.has(m)) byMaker.set(m, []); byMaker.get(m).push(u.id);
      }
    }
    for (const maker of Array.from(byMaker.keys()).sort()) {
      const ids = uniq(byMaker.get(maker));
      const drawn = edgeById.get('supply:' + maker + '>' + b.id);
      if (drawn) { drawn.upkeepCargo = uniq(drawn.upkeepCargo.concat(ids.filter((x) => drawn.cargo.indexOf(x) < 0))); continue; }
      const e = addEdge({
        id: 'supply:' + maker + '>' + b.id, from: maker, to: b.id, kind: 'supply', cargo: ids, via: null,
        live: true, liveIds: ids.slice(), liveVia: 'upkeep',
        pdf: false, basis: 'upkeep', drawnOn: null, direction: 'supplier', pdfDirection: null, confidence: null, ambiguity: null,
        why: 'Not drawn on the map: ' + b.label + ' burns this today and ' + (nodeById.get(maker) ? nodeById.get(maker).label : maker) + ' is a business that makes it.',
        cite: arr(rec.upkeep).filter((u) => ids.indexOf(u.id) >= 0).map((u) => u.cite).filter(Boolean).join(' ; ') || null,
        consumerCite: null, cargoIsItem: false, sourceToday: [], upkeepCargo: [],
        piece: 'recipes',
      });
      const bad = shipEdge(e);
      if (bad) rep.err('supply-not-via-transport', 'shipping', 'upkeep lane ' + maker + ' -> ' + b.id + ' is not routed through ' + CARRIER + ' (' + bad.reasonCode + ')', [e.id]);
    }
  }

  /* 3 ─ where a business SELLS (recipes sellsTo, which follows the PDF icons):
        a channel            -> channel edge, hauled to the Marketplace
        Battle / "Business"  -> not a place a truck can unload (shipping.js
                                convention): the goods ride the channel edge with
                                finalBuyers, and the relationship itself is a
                                cargo-less 'service' edge (the battler card)
        City / Camp          -> a real delivery (that is where the depot stands) */
  const usedBy = (nodeId) => { const s = new Set(); for (const id of Object.keys(USES)) if (USES[id].some((u) => u.by === nodeId)) s.add(id); return s; };
  const usedByCache = new Map();
  const usesOf = (nodeId) => { if (!usedByCache.has(nodeId)) usedByCache.set(nodeId, usedBy(nodeId)); return usedByCache.get(nodeId); };

  function channelEdge(b, rec, ch, drawn) {
    const id = 'channel:' + b.id + '>' + ch;
    if (edgeById.has(id)) return edgeById.get(id);
    const allMakes = arr(rec.makes);
    /* A SPECIALISED COUNTER SELLS ITS OWN KIND OF GOODS. Round 3 copied the whole
       product list onto every counter, so the Car Marketplace sold wheat, eggs
       and asphalt. The scope is handed in (data.js CHANNEL_SCOPE quotes the PDF
       legend); families are the catalogue's. No scope, or no family(), = as before. */
    const scope = isObj(d.channelScope) && isObj(d.channelScope[ch]) ? d.channelScope[ch] : null;
    const famOf = d.catalog && typeof d.catalog.family === 'function' ? (x) => run0(() => d.catalog.family(x)) : null;
    const inScope = (m) => !scope || !famOf || arr(scope.families).indexOf(famOf(m.id)) >= 0;
    const makes = allMakes.filter(inScope);
    const outOfScope = allMakes.filter((m) => !inScope(m)).map((m) => m.id);
    const cargo = makes.map((m) => m.id);
    if (!cargo.length && allMakes.length) {
      const chNode = nodeById.get(ch);
      const open = arr(B.AMBIGUITIES).find((a) => a.resolved !== true && arr(a.affects).indexOf(b.id) >= 0 && chNode && arr(chNode.ambiguities).indexOf(a.id) >= 0);
      if (open) rep.note('channel-counter-empty', 'pdfmap', b.id + ' has the ' + (chNode ? chNode.label : ch) + ' icon (open reading ' + open.id + ') but makes nothing that counter sells; the edge is drawn with no cargo until the owner settles ' + open.id, [id, open.id]);
      else rep.err('channel-no-cargo-in-scope', 'recipes', b.id + ' sells on ' + ch + ' but makes nothing in that counter\'s scope (' + arr(scope && scope.families).join(', ') + ')', [id]);
    }
    /* live = a product that really reaches a player stash AND that the resource
       market can list today (ledger ids only — RESOURCE_IDS in index.html). */
    const liveIds = makes.filter((m) => m.live && m.via !== 'cityFirm' && resById.get(m.id) && resById.get(m.id).inLedger).map((m) => m.id);
    const e = addEdge({
      id, from: b.id, to: ch, kind: 'channel', cargo, via: null,
      live: liveIds.length > 0 && b.status !== 'planned', liveIds: b.status === 'planned' ? [] : liveIds,
      pdf: drawn, basis: drawn ? 'pdf-icon' : 'written-goal', direction: 'sell', finalBuyers: [],
      scope: scope ? { families: arr(scope.families).slice(), why: scope.why || null, cite: scope.cite || null } : null, outOfScope,
      why: drawn ? 'The owner drew this marketplace icon beside the tile: it sells here.' : 'Not drawn beside this tile. Its goods still reach battlers and other businesses through the Marketplace.',
      cite: null, piece: 'recipes',
    });
    if (cargo.length) {
      const bad = shipEdge(e, ch);
      if (bad) rep.err('channel-not-via-transport', 'shipping', 'sale ' + b.id + ' -> ' + ch + ' is not routed through ' + CARRIER + ' (' + bad.reasonCode + ')', [id]);
    }
    return e;
  }

  for (const b of arr(B.BUSINESSES)) {
    const rec = R[b.id]; if (!rec) continue;
    const icons = b.icons || {};
    const targets = arr(rec.sellsTo);
    /* an icon the owner drew must exist as an edge even if recipes forgot it */
    if (icons.market === true && targets.indexOf('ch:market') < 0) rep.err('icon-without-lane', 'recipes', b.id + ' has the Marketplace icon but recipes.sellsTo omits ch:market', [b.id]);
    if (icons.carMarket === true && targets.indexOf('ch:carmarket') < 0) rep.err('icon-without-lane', 'recipes', b.id + ' has the Car Marketplace icon but recipes.sellsTo omits ch:carmarket', [b.id]);
    for (const t of targets) {
      if (!nodeById.has(t)) { rep.err('dangling-id', 'recipes', b.id + '.sellsTo names unknown node "' + t + '"', [t]); continue; }
      const tn = nodeById.get(t);
      if (tn.type === 'business') {
        if (!edgeById.has('supply:' + b.id + '>' + t)) rep.err('sellsTo-without-lane', 'recipes', b.id + ' sells to ' + t + ' but ' + t + ' has no buys[] lane from it', [b.id, t]);
        continue;
      }
      if (tn.type === 'channel') {
        const drawn = t === 'ch:market' ? icons.market === true : icons.carMarket === true;
        if (!drawn) rep.err('lane-not-on-pdf', 'recipes', b.id + ' sells on ' + t + ' but the owner drew no such icon beside it', [b.id, t]);
        channelEdge(b, rec, t, drawn);
        continue;
      }
      /* a system */
      const wanted = usesOf(t);
      const goods = arr(rec.makes).map((m) => m.id).filter((id) => wanted.has(id));
      const probe = goods.length ? route({ from: b.id, to: t, resId: goods[0] }) : route({ from: b.id, to: t, cargo: true });
      const cardDrawn = (t === 'sys:battle' || t === 'sys:camp') && (icons.card === true || icons.card === '?');
      let onChannel = false;
      if (probe && probe.redirected && probe.deliverTo && nodeById.has(probe.deliverTo) && arr(rec.makes).length) {
        /* Battlers buy at whichever marketplace the owner drew beside the tile
           (a Car Dealer's buyers are at the Car Marketplace too); only a tile
           with no marketplace icon falls back to shipping.js's default. */
        const drawnCh = targets.filter((x) => nodeById.has(x) && nodeById.get(x).type === 'channel');
        for (const ch of (drawnCh.length ? drawnCh : [probe.deliverTo])) {
          const e = channelEdge(b, rec, ch, ch === 'ch:market' ? icons.market === true : icons.carMarket === true);
          if (e.finalBuyers.indexOf(t) < 0) e.finalBuyers.push(t);
        }
        onChannel = true;
      }
      if (goods.length && probe && probe.ships && !probe.redirected) {
        const e = addEdge({
          id: 'supply:' + b.id + '>' + t, from: b.id, to: t, kind: 'supply', cargo: goods, via: null,
          live: false, liveIds: [], liveVia: null,
          pdf: cardDrawn, basis: 'sellsTo', drawnOn: cardDrawn ? b.id : null, direction: 'buyer', pdfDirection: null,
          confidence: icons.card === '?' ? 'ambiguous' : null, ambiguity: icons.card === '?' ? 'A' : null,
          why: nodeById.get(t).label + ' uses what ' + b.label + ' makes; it is delivered there, not collected.',
          cite: null, consumerCite: null, cargoIsItem: false, sourceToday: [], upkeepCargo: [],
          piece: 'recipes',
        });
        /* live only where the consumer end is a real (non-simulated) use today
           AND the product really reaches a player stash. */
        const liveMakes = new Set(arr(rec.makes).filter((m) => m.live && m.via !== 'cityFirm').map((m) => m.id));
        e.liveIds = goods.filter((id) => liveMakes.has(id) && USES[id].some((u) => u.by === t && u.live && u.role !== 'sim'));
        e.live = e.liveIds.length > 0 && b.status !== 'planned';
        if (!e.live) e.liveIds = [];
        const bad = shipEdge(e);
        if (bad) rep.err('supply-not-via-transport', 'shipping', 'delivery ' + b.id + ' -> ' + t + ' is not routed through ' + CARRIER + ' (' + bad.reasonCode + ')', [e.id]);
      } else if (onChannel && !rec.service && !cardDrawn) {
        /* goods sold to that system's players over the marketplace counter:
           the channel edge (finalBuyers) already says it all */
      } else {
        /* nothing physical is delivered to that system: the tie is a service
           (training, a licence, credit, a bus seat) or the battler card. */
        addEdge({
          id: 'service:' + b.id + '>' + t, from: b.id, to: t, kind: 'service', cargo: [], via: null,
          live: b.status !== 'planned', liveIds: [],
          pdf: cardDrawn || b.cityOnly === true, basis: cardDrawn ? 'pdf-card-icon' : (b.cityOnly ? 'pdf-p9-rule' : 'recipes-service'),
          why: rec.service || (cardDrawn ? 'The owner drew the battler card beside this tile: what it makes is good for battlers and camps. The goods themselves are bought on the Marketplace.' : null),
          confidence: icons.card === '?' && cardDrawn ? 'ambiguous' : null, ambiguity: icons.card === '?' && cardDrawn ? 'A' : null,
          cite: null, piece: 'recipes',
        });
        if (!rec.service && !cardDrawn) rep.err('sellsTo-nothing', 'recipes', b.id + ' sells to ' + t + ' but makes nothing ' + t + ' uses and states no service', [b.id, t]);
      }
    }
    /* the battler card must show up as an edge somewhere */
    if ((icons.card === true || icons.card === '?') && !targets.some((t) => t === 'sys:battle' || t === 'sys:camp')) {
      rep.err('icon-without-lane', 'recipes', b.id + ' has the battler card but sells to neither sys:battle nor sys:camp', [b.id]);
    }
  }

  /* 4 ─ needs. For every node: what it uses (coverage), and for each id where a
     player would get it. This is the check the owner asked for in words: "make
     sure all of the businesses need what can be found in the loot system". */
  const sourceCache = new Map();
  const sourcesOf = (id) => {
    if (sourceCache.has(id)) return sourceCache.get(id);
    const all = typeof L.sourcesFor === 'function' ? arr(L.sourcesFor(id, { catalog: rows })) : [];
    const real = all.filter((s) => !s.notLootable && !s.unverified);
    const out = {
      loot: real.filter((s) => s.kind !== 'buy').map((s) => ({ id: s.id, label: s.label, system: s.system, via: s.via, themed: s.themed === true })),
      buy: real.filter((s) => s.kind === 'buy').map((s) => ({ id: s.id, label: s.label, system: s.system })),
      unverified: all.some((s) => s.unverified),
      madeByBiz: null, madeIn: null, madeInLabel: null, madeInCite: null,
    };
    /* loot.js's "never drops, it is made at <facility>" answer names a NODE. A
       business owner must show up in RECIPES.<biz>.makes (checked below as
       maker-missing). A SYSTEM owner cannot: systems have no RECIPES row, and
       the fact is loot.js's own (with its cite) — ingots are yielded by the
       city's Smelting Foundry and banked into the ledger. Round 2 treated every
       owner as a business, so the true answer could not be expressed at all and
       the critic's suggested fix was to list ingots under the Trash Crusher,
       which the game does not do (src/foundry casts metalIngot -> metal). */
    const marker = all.find((s) => s.notLootable && s.madeByBiz) || null;
    if (marker) {
      const owner = nodeById.get(marker.madeByBiz);
      if (!owner) rep.err('dangling-id', 'loot', 'loot.js says "' + id + '" is made at a facility of unknown node "' + marker.madeByBiz + '"', [id, marker.madeByBiz]);
      else if (owner.type === 'system') { out.madeIn = owner.id; out.madeInLabel = marker.label || null; out.madeInCite = marker.cite || null; }
      else out.madeByBiz = owner.id;
    }
    /* every system that MAKES it (systemMakes), the marker's owner first. An id
       can be looted AND city-made (cloth): both are sources and both are shown. */
    out.madeInAll = out.madeIn ? [{ node: out.madeIn, by: null, cite: out.madeInCite, live: true }] : [];
    for (const m of arr(sysMadeBy.get(id))) {
      const have = out.madeInAll.find((x) => x.node === m.node);
      if (have) { have.by = have.by || m.by; have.live = have.live || m.live; continue; }
      out.madeInAll.push({ node: m.node, by: m.by, cite: m.cite, live: m.live });
    }
    if (!out.madeIn && out.madeInAll.length) { out.madeIn = out.madeInAll[0].node; out.madeInCite = out.madeInAll[0].cite; }
    sourceCache.set(id, out);
    return out;
  };

  const marketBuys = new Map();             // nodeId -> [resId] bought on the Marketplace (made by a non-neighbour)
  const lootInto = new Map();               // 'sys|node' -> {ids, themed, liveIds}

  for (const n of nodes) {
    const rec = R[n.id] || null;
    const needs = typeof C.needsOf === 'function' ? arr(C.needsOf(n.id)) : [];
    const themedLoot = typeof C.lootNeedsOf === 'function' ? arr(C.lootNeedsOf(n.id, rows)) : [];
    const themedSet = new Set(themedLoot.map((x) => x.id));
    const inbound = edges.filter((e) => e.kind === 'supply' && e.to === n.id);

    /* one row per id: the strongest claim wins (live before proposed, as coverage sorts them) */
    const perId = new Map();
    for (const row of needs) {
      if (phantoms.has(row.id)) { rep.err('phantom-need', 'coverage', n.id + ' needs phantom id "' + row.id + '"', [row.id]); continue; }
      if (!resById.has(row.id)) { rep.err('dangling-id', 'coverage', n.id + ' needs "' + row.id + '" which is not in the catalogue', [row.id]); continue; }
      if (!perId.has(row.id)) perId.set(row.id, { id: row.id, roles: [], live: false, why: row.why || null, cite: row.cite || null });
      const p = perId.get(row.id);
      if (p.roles.indexOf(row.role) < 0) p.roles.push(row.role);
      if (row.live) p.live = true;
    }

    const lootNeeds = [], otherNeeds = [];
    for (const p of perId.values()) {
      const src = sourcesOf(p.id);
      const lanesIn = inbound.filter((e) => e.cargo.indexOf(p.id) >= 0 || e.upkeepCargo.indexOf(p.id) >= 0).map((e) => e.from);
      const makers = arr(makersOf.get(p.id)).filter((m) => m.biz !== n.id).map((m) => m.biz);
      const lootable = isLootable(p.id);
      p.lootable = lootable;
      p.themedLoot = themedSet.has(p.id);
      p.from = lanesIn;
      p.madeBy = makers;
      p.buyable = src.buy.length > 0;
      /* How would a player actually get it? First true answer wins. */
      p.madeIn = src.madeIn;
      /* 'system' = made inside one of the four systems and banked into the
         player's stores (today: ingots, from the city). Not loot, not a lane. */
      p.source = p.themedLoot ? 'loot' : lanesIn.length ? 'lane' : lootable ? 'loot' : makers.length ? 'market' : p.buyable ? 'trader'
        : src.madeIn ? (src.madeIn === n.id ? 'self' : 'system') : 'none';
      p.madeInAll = src.madeInAll.map((x) => x.node);
      /* A system that makes it -> this tile. PDF p4: a city "produces essential
         supplies for player camps and Just Business operations", so a business
         gets one made-edge per system that makes something it needs (round 3
         drew it only when the id had no other source at all, i.e. ingots).
         System -> system is NOT drawn here: that is the hand-off arrow (4b). */
      for (const mi of src.madeInAll) {
        if (mi.node === n.id || (n.type !== 'business' && p.source !== 'system')) continue;
        const k = mi.node + '|' + n.id;
        if (!lootInto.has(k)) lootInto.set(k, { sys: mi.node, node: n.id, ids: [], themed: [], liveIds: [], made: [] });
        const g = lootInto.get(k);
        if (g.ids.indexOf(p.id) < 0) g.ids.push(p.id);
        if (g.made.indexOf(p.id) < 0) g.made.push(p.id);
        if (p.live && mi.live && g.liveIds.indexOf(p.id) < 0) g.liveIds.push(p.id);
      }
      if (p.source === 'none') {
        const self = arr(makersOf.get(p.id)).some((m) => m.biz === n.id);
        if (self) p.source = 'self';
        else rep.err('need-no-source', src.madeByBiz ? 'recipes' : 'coverage', n.id + ' needs "' + p.id + '" which is neither battle loot, nor made by any business, nor sold by a camp trader', [n.id, p.id]);
      }
      if (src.unverified) rep.err('loot-unverified', 'loot', 'loot.sourcesFor("' + p.id + '") could not verify the id against the catalogue', [p.id]);
      if (lootable) {
        p.where = src.loot.slice(0, 3);
        lootNeeds.push(p);
        for (const sys of uniq(src.loot.map((s) => s.system)).sort()) {
          if (!sys || sys === n.id) continue;          // found and used in the same place: no edge to draw
          const k = sys + '|' + n.id;
          if (!lootInto.has(k)) lootInto.set(k, { sys, node: n.id, ids: [], themed: [], liveIds: [], made: [] });
          const g = lootInto.get(k);
          if (g.ids.indexOf(p.id) < 0) g.ids.push(p.id);
          if (p.live && g.liveIds.indexOf(p.id) < 0) g.liveIds.push(p.id);
          /* themed = THIS system has a place where the id is the point of the
             search, so a view can draw "fight for it here" heavier than "any
             chest, if you are lucky" */
          if (p.themedLoot && src.loot.some((s) => s.system === sys && s.themed)) g.themed.push(p.id);
        }
      } else {
        otherNeeds.push(p);
      }
      if (!lanesIn.length && makers.length && n.type === 'business') {
        if (!marketBuys.has(n.id)) marketBuys.set(n.id, []);
        marketBuys.get(n.id).push(p.id);
      }
    }
    /* themed loot first: "go and search a hospital" beats "any chest, if lucky" */
    lootNeeds.sort((a, b) => (a.themedLoot === b.themedLoot ? 0 : a.themedLoot ? -1 : 1) || (a.live === b.live ? 0 : a.live ? -1 : 1));

    /* the mirror of the check below: a DRAWN lane that leaves a shared id off the truck */
    if (n.type === 'business') for (const e of inbound) {
      if (drawnLaneChecks.indexOf(e.id) < 0 || !nodeById.has(e.from)) continue;
      for (const p of perId.values()) {
        if (!makes(e.from, p.id) || e.cargo.indexOf(p.id) >= 0 || e.upkeepCargo.indexOf(p.id) >= 0) continue;
        /* A NOTE, not an error. Tried as an error first: 30 rows on the real
           tree, nearly all of them deliberate (Home Feed makes cloth and a
           Restaurant uses cloth, but nobody wants napkins on the meat truck).
           Which shared ids ride a drawn lane is recipes.js's call. The ONE case
           the owner spelled out is checked hard below (owner-example-broken). */
        rep.note('drawn-lane-drops-need', 'recipes', 'the owner drew ' + e.from + ' -> ' + n.id + '; ' + e.from + ' makes "' + p.id + '" and ' + n.id + ' needs it, but the lane does not carry it', [e.id, p.id]);
      }
    }

    /* every lane's cargo must be something the receiver is said to need, or the
       modal prints a truck full of things the business does not use */
    if (n.type === 'business') for (const e of inbound) for (const id of e.cargo) {
      if (!perId.has(id)) rep.err('cargo-not-a-need', 'coverage', e.from + ' -> ' + n.id + ' ships "' + id + '" but coverage.needsOf("' + n.id + '") does not list it', [e.id, id]);
    }

    n.makes = rec ? arr(rec.makes).map((m) => ({ id: m.id, live: m.live === true && n.status !== 'planned', via: m.via || null, note: m.cite || m.why || null }))
      /* a system's makes = what its own facilities bank for the player (the city's buildings) */
      : arr(sysMakes.get(n.id)).map((m) => ({ id: m.id, live: m.live, via: 'systemFacility', by: m.by, alsoBy: m.alsoBy.slice(), note: m.cite }));
    n.produces = null;                       // systems only, filled in step 4b
    n.upkeep = rec ? arr(rec.upkeep).map((u) => ({ id: u.id, via: u.via || null, madeBy: arr(u.madeBy).slice(), cite: u.cite || null })) : [];
    n.lootNeeds = lootNeeds;
    n.otherNeeds = otherNeeds;
    n.bizNeeds = inbound.map((e) => ({
      biz: e.from, edge: e.id, cargo: e.cargo.slice(), upkeepCargo: e.upkeepCargo.slice(),
      live: e.live, liveIds: e.liveIds.slice(), pdf: e.pdf, direction: e.direction, confidence: e.confidence, ambiguity: e.ambiguity, why: e.why,
    }));
    /* ⚠ liveIds IS NOT OPTIONAL HERE. n.buyers is the same supply edge as
       n.bizNeeds one line above, seen from the seller's end, and for three
       rounds it dropped the per-id split on the floor: a lane is LIVE because
       ONE of its ids really ships (Fuel), and a view that prints the whole
       cargo under that one badge tells a player "Diesel LIVE" on the very card
       that badged Diesel "not in the game yet" three cells higher. Six such
       rows over four cards (gas, mining, cars, construction). The split already
       existed on the edge; only this projection forgot it. */
    n.buyers = edges.filter((e) => e.kind === 'supply' && e.from === n.id).map((e) => ({ biz: e.to, edge: e.id, cargo: e.cargo.slice(), liveIds: e.liveIds.slice(), live: e.live, pdf: e.pdf }));
    n.sellsTo = rec ? arr(rec.sellsTo).slice() : [];
    n.needsSummary = typeof C.liveSummary === 'function' ? C.liveSummary(n.id, rows) : null;

    if (n.type === 'business' && n.id !== CARRIER && !n.lootNeeds.some((p) => p.themedLoot)) {
      rep.err('business-no-loot-need', 'coverage', n.id + ' needs nothing a player can go and find in battle (no hand-authored loot id among its needs)', [n.id]);
    }
  }

  /* 4b ─ WHAT EACH SYSTEM PRODUCES, AND WHAT RIDES EACH HAND-OFF.
     produced = made by its facilities (systemMakes / the never-drops marker)
              + found there (loot.js sources in that system)
              + for Just Business, everything a tile makes.
     hand-off cargo = produced by the sender AND used by the receiver (for Just
     Business: used by any tile). Nothing is invented: both halves are sibling
     data, so an empty hand-off is THEIR defect and is reported, never padded.
     The implied Camp -> Battle arrow is exempt: battle consumes no resource in
     coverage.js, the arrow carries decks and units (ambiguity J). */
  const sysIds = nodes.filter((n) => n.type === 'system').map((n) => n.id);
  const producedBy = new Map(sysIds.map((id) => [id, { made: [], drops: [] }]));
  for (const r of rows) {
    const src = sourcesOf(r.id);
    for (const m of src.madeInAll) if (producedBy.has(m.node)) producedBy.get(m.node).made.push(r.id);
    for (const sys of uniq(src.loot.map((x) => x.system))) if (producedBy.has(sys)) producedBy.get(sys).drops.push(r.id);
    /* a business tile belongs to a system (businesses.js `system`, default Just Business) */
    for (const sys of uniq(arr(makersOf.get(r.id)).map((m) => nodeById.get(m.biz) && nodeById.get(m.biz).system))) {
      if (producedBy.has(sys) && producedBy.get(sys).made.indexOf(r.id) < 0) producedBy.get(sys).made.push(r.id);
    }
  }
  const tilesOf = (sys) => nodes.filter((n) => n.type === 'business' && n.system === sys).map((n) => n.id);
  const wantedBy = (sys) => { const s = new Set(usesOf(sys)); for (const t of tilesOf(sys)) for (const id of usesOf(t)) s.add(id); return s; };
  const liveUseAt = (sys, id) => arr(USES[id]).some((u) => u.live && u.role !== 'sim' && (u.by === sys || tilesOf(sys).indexOf(u.by) >= 0));
  const liveMadeAt = (sys, id) => sourcesOf(id).loot.some((x) => x.system === sys) || sourcesOf(id).madeInAll.some((m) => m.node === sys && m.live)
    || arr(makersOf.get(id)).some((m) => m.inStash && nodeById.get(m.biz) && nodeById.get(m.biz).system === sys);
  for (const n of nodes) if (n.type === 'system') {
    const p = producedBy.get(n.id);
    n.produces = { made: p.made.slice(), drops: p.drops.slice(), total: uniq(p.made.concat(p.drops)).length };
    if (!n.produces.total) rep.err('system-produces-nothing', n.id === 'sys:business' ? 'recipes' : 'loot', 'the map shows ' + n.label + ' producing nothing: no facility of it makes a resource (systemMakes), nothing drops there (loot.js) and no tile in it makes anything. The owner asked to see what each system produces', [n.id]);
  }
  for (const e of edges) if (e.kind === 'system') {
    const p = producedBy.get(e.from) || { made: [], drops: [] };
    const want = wantedBy(e.to);
    const out = new Set(p.made.concat(p.drops));
    e.cargo = rows.map((r) => r.id).filter((id) => out.has(id) && want.has(id));
    e.madeCargo = e.cargo.filter((id) => p.made.indexOf(id) >= 0);
    e.liveIds = e.cargo.filter((id) => liveMadeAt(e.from, id) && liveUseAt(e.to, id));
    if (e.pdf && !e.cargo.length) rep.err('system-handoff-no-cargo', 'coverage', 'the drawn hand-off ' + e.from + ' -> ' + e.to + ' carries nothing: ' + e.from + ' produces ' + out.size + ' ids and ' + e.to + ' uses ' + want.size + ', with none in common', [e.id]);
    /* An empty arrow is a dead end to a player, and this one is the leg that
       CLOSES the owner's loop. It is empty for a true reason — nothing in
       coverage.js records a battle as consuming a resource; the camp sends
       fighters, decks and missions the other way — so the honest fix is a
       caption, not invented cargo. cargoKind tells a view which of the two it
       is; emptyWhy is built from the OWNER'S OWN prose (edge.why, the
       businesses.js `basis` string) plus the measured counts, so graph still
       authors no claim about the game. Views MUST print emptyWhy instead of an
       empty manifest. */
    e.cargoKind = e.cargo.length ? 'resource' : 'non-resource';
    if (!e.cargo.length) {
      const ln = (id) => (nodeById.get(id) && nodeById.get(id).label) || id;
      e.emptyWhy = 'No resource rides this leg: ' + ln(e.to) + ' consumes no resource anywhere in the coverage data ('
        + ln(e.from) + ' produces ' + out.size + ' ids, ' + ln(e.to) + ' uses ' + want.size + ').'
        + (e.why ? ' What crosses instead, in the owner’s own words: “' + e.why + '”.' : '')
        + (e.implied ? ' The PDF draws no arrow here either — the loop closes in the prose (ambiguity ' + (e.ambiguity || 'J') + ').' : '');
      rep.note('system-handoff-non-resource', 'views', 'the ' + e.from + ' -> ' + e.to + ' leg carries no resource; show edge.emptyWhy, never an empty manifest', [e.id]);
    }
  }

  /* 4c ─ out of a marketplace, to the PLAYERS the seller's tile names (the battler
     card, recipes sellsTo a system). Round 3 stopped at the counter: five edges
     went into the Car Marketplace and none came out, although the PDF's own
     example ends "sells them to players for battles". Collected by the buyer,
     so via stays null (shipping.js: no second haul). */
  for (const c of nodes) if (c.type === 'channel') {
    const inbound = edges.filter((e) => e.kind === 'channel' && e.to === c.id);
    for (const t of nodes) {
      const mine = inbound.filter((e) => arr(e.finalBuyers).indexOf(t.id) >= 0);
      if (!mine.length) continue;
      const cargo = uniq(mine.reduce((a, e) => a.concat(e.cargo), []));
      const liveIds = uniq(mine.reduce((a, e) => a.concat(e.liveIds), []));
      addEdge({
        id: 'channel:' + c.id + '>' + t.id, from: c.id, to: t.id, kind: 'channel', cargo, via: null,
        live: liveIds.length > 0, liveIds, pdf: false, basis: 'market-sale', direction: 'buy', finalBuyers: [],
        sellers: mine.map((e) => e.from),
        why: 'Players in ' + t.label + ' buy these over the ' + c.label + ' counter and collect them themselves: no second haul.',
        cite: null, piece: 'graph',
      });
    }
  }

  /* 5 ─ Marketplace -> buyer. shipping.js: a lot bought on the market is
     collected by the buyer, no second haul, so via stays null. Not drawn by the
     owner; it answers "who makes this thing I need when no lane brings it". */
  for (const n of nodes) {
    const ids = marketBuys.get(n.id); if (!ids || !ids.length) continue;
    addEdge({
      id: 'channel:ch:market>' + n.id, from: 'ch:market', to: n.id, kind: 'channel', cargo: uniq(ids), via: null,
      live: false, liveIds: [], pdf: false, basis: 'market-buy', direction: 'buy', finalBuyers: [],
      why: 'No lane on the map brings these in. Another business makes them and lists them on the Marketplace; the buyer collects.',
      cite: null, piece: 'graph',
    });
  }
  for (const e of edges) if (e.basis === 'market-buy') {
    e.liveIds = e.cargo.filter((id) => resById.get(id).inLedger && arr(makersOf.get(id)).some((m) => m.inStash) && USES[id].some((u) => u.by === e.to && u.live && u.role !== 'sim'));
    e.live = e.liveIds.length > 0;
  }

  /* 6 ─ loot edges: Battle / Camp / City -> whoever uses the drop. Carried home
     by the player's own squad (shipping.js 'squad-not-cargo'), so via is null on
     purpose and that is NOT a breach of the Transport rule. */
  for (const k of Array.from(lootInto.keys()).sort((a, b) => {
    const A = lootInto.get(a), Z = lootInto.get(b);
    return (nodeById.get(A.sys).order - nodeById.get(Z.sys).order) || (nodeById.get(A.node).order - nodeById.get(Z.node).order);
  })) {
    const g = lootInto.get(k);
    if (!nodeById.has(g.sys)) { rep.err('dangling-id', 'loot', 'a loot source lives in unknown system "' + g.sys + '"', [g.sys]); continue; }
    addEdge({
      id: 'loot:' + g.sys + '>' + g.node, from: g.sys, to: g.node, kind: 'loot', cargo: g.ids.slice(), via: null,
      live: g.liveIds.length > 0, liveIds: g.liveIds.slice(), themedCargo: g.themed.slice(),
      /* ids on this edge that are MADE in that system rather than found there.
         The edge kind stays 'loot' (the contract's five kinds are frozen and the
         travel rule is the same: the player's own stores, no carrier), but a
         view must not caption these "fight for it". */
      madeCargo: g.made.slice(),
      /* THE OTHER WAY TO GET THE SAME DROP. The PDF labels Battle -> Just Business
         "Market Place Resources": a business owner who does not fight buys the
         drop from a player who does. The resource market lists ledger ids only,
         so that is the subset offered here. The edge itself stays the squad's
         own haul (via null); a view draws this as the dashed alternative. */
      market: { channel: 'ch:market', ids: g.ids.filter((id) => resById.get(id) && resById.get(id).inLedger === true), live: true,
        cite: 'Resource Marketplace: resMarketPost / resMarketTake (public/index.html) — ledger resources only' },
      pdf: false, basis: g.made.length && g.made.length === g.ids.length ? 'system-made' : 'loot',
      why: g.made.length && g.made.length === g.ids.length
        ? 'Made inside ' + nodeById.get(g.sys).label + ' and banked into your own stores — it is already yours, so no carrier is involved.'
        : 'Found by fighting or on camp runs and carried home by your own squad — a squad is not cargo, so no carrier is involved.',
      cite: null, piece: 'loot',
    });
  }

  /* stable order: kind, then the order they were built in (PDF order) */
  const builtAt = new Map(edges.map((e, i) => [e.id, i]));
  edges.sort((a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || (builtAt.get(a.id) - builtAt.get(b.id)));
  const edgeOrder = new Map(edges.map((e, i) => [e.id, i]));
  lanes.sort((a, b) => edgeOrder.get(a.edge) - edgeOrder.get(b.edge));

  /* ------------------------------------------------------- whole-map checks */

  for (const n of nodes) {
    n.degree = edges.filter((e) => e.from === n.id || e.to === n.id).length;
    if (!n.degree) rep.err('unreachable-node', 'pdfmap', 'node "' + n.id + '" has no edge at all', [n.id]);
  }
  for (const e of edges) if (e.kind === 'supply' && e.via !== CARRIER) {
    rep.err('supply-not-via-transport', 'shipping', 'supply edge ' + e.id + ' has via ' + JSON.stringify(e.via), [e.id]);
  }

  /* THE OWNER'S NAMED EXAMPLES ARE CHECKS, NOT COINCIDENCES. "Fashion makes cloth
     and sends it through Transport to Medical" held only because recipes.js
     happened to list cloth on that truck: a critic deleted it, fabric stayed on
     board, nothing turned red and resourceFlow('cloth') quietly re-routed to the
     Weapon Smith. The sentences come in as data (data.js OWNER_EXAMPLES, quoted
     from the goal) so this file still authors no fact. */
  for (const x of arr(d.ownerExamples)) {
    if (!isObj(x)) continue;
    const tag = 'the owner wrote "' + (x.quote || (x.from + ' makes ' + x.res + ' for ' + x.to)) + '" but ';
    const refs = [x.res, x.from, x.to];
    if (!resById.has(x.res) || !nodeById.has(x.from) || !nodeById.has(x.to)) { rep.err('owner-example-broken', 'graph', tag + 'one of ' + refs.join(' / ') + ' is not on the map', refs); continue; }
    if (x.sale === true) {
      /* "sells them to players": seller -> a marketplace (hauled) -> those players */
      const counters = edges.filter((c) => c.kind === 'channel' && c.from === x.from && c.cargo.indexOf(x.res) >= 0 && arr(c.finalBuyers).indexOf(x.to) >= 0);
      if (!makes(x.from, x.res)) rep.err('owner-example-broken', 'recipes', tag + 'RECIPES.' + x.from + '.makes does not list "' + x.res + '"', refs);
      if (!counters.length) rep.err('owner-example-broken', 'recipes', tag + 'no marketplace edge out of ' + x.from + ' carries "' + x.res + '" for ' + x.to, refs);
      else if (!counters.some((c) => c.via === CARRIER)) rep.err('owner-example-broken', 'shipping', tag + 'the sale is not hauled to the counter by ' + CARRIER, refs);
      else if (!counters.some((c) => { const o = edgeById.get('channel:' + c.to + '>' + x.to); return o && o.cargo.indexOf(x.res) >= 0; })) rep.err('owner-example-broken', 'graph', tag + 'nothing carries "' + x.res + '" from the counter on to ' + x.to, refs);
      continue;
    }
    const e = edgeById.get('supply:' + x.from + '>' + x.to);
    if (!makes(x.from, x.res)) rep.err('owner-example-broken', 'recipes', tag + 'RECIPES.' + x.from + '.makes does not list "' + x.res + '"', refs);
    if (!e) rep.err('owner-example-broken', 'recipes', tag + 'no lane runs ' + x.from + ' -> ' + x.to, refs);
    else {
      if (e.cargo.indexOf(x.res) < 0) rep.err('owner-example-broken', 'recipes', tag + 'the ' + x.from + ' -> ' + x.to + ' lane does not carry "' + x.res + '"', refs);
      if (e.via !== CARRIER) rep.err('owner-example-broken', 'shipping', tag + 'the lane is not hauled by ' + CARRIER, refs);
    }
    if (!arr(USES[x.res]).some((u) => u.by === x.to)) rep.err('owner-example-broken', 'coverage', tag + 'coverage gives ' + x.to + ' no use for "' + x.res + '"', refs);
  }

  /* the loop: follow the system arrows from Battle; it must visit all four and come home */
  const loop = (() => {
    const sys = nodes.filter((n) => n.type === 'system').map((n) => n.id);
    const next = new Map(edges.filter((e) => e.kind === 'system').map((e) => [e.from, e]));
    const order = []; let at = sys[0]; const hops = [];
    while (at && order.indexOf(at) < 0) { order.push(at); const e = next.get(at); if (!e) break; hops.push(e.id); at = e.to; }
    const closed = order.length === sys.length && at === sys[0];
    if (!closed) rep.err('loop-open', 'pdfmap', 'the system arrows do not form a closed loop through all ' + sys.length + ' systems (walked: ' + order.join(' -> ') + ')', order);
    const drawn = edges.filter((e) => e.kind === 'system' && e.pdf);
    return { closed, order, hops, marketOnEveryDrawnHandoff: drawn.length > 0 && drawn.every((e) => e.channel === 'ch:market'), impliedHops: edges.filter((e) => e.kind === 'system' && e.implied).map((e) => e.id) };
  })();

  /* every catalogue id: at least one way in (loot / a maker / a trader) and at
     least one way out (a consumer), each of them visible as an EDGE */
  const onEdgeOut = new Map(), onEdgeIn = new Map();
  for (const e of edges) for (const id of e.cargo.concat(e.upkeepCargo || [])) {
    /* the four hand-off arrows now carry cargo, but they are a SUMMARY of the map.
       Letting them count here would let an arrow hide a resource that no real
       edge (loot, lane, counter) brings in or takes out. */
    if (e.kind === 'system') continue;
    const src = nodeById.get(e.from), dst = nodeById.get(e.to);
    /* producer edge: leaves a system that drops it or a business that makes it */
    if (src && (e.kind === 'loot' || arr(makersOf.get(id)).some((m) => m.biz === e.from))) { if (!onEdgeOut.has(id)) onEdgeOut.set(id, []); onEdgeOut.get(id).push(e.id); }
    /* consumer edge: arrives at a node that uses it */
    if (dst && USES[id] && USES[id].some((u) => u.by === e.to)) { if (!onEdgeIn.has(id)) onEdgeIn.set(id, []); onEdgeIn.get(id).push(e.id); }
  }
  const selfServed = new Set();             // found and used inside the same system: no edge by design
  for (const id of Object.keys(USES)) for (const u of USES[id]) {
    if (sourcesOf(id).loot.some((s) => s.system === u.by) || sourcesOf(id).madeIn === u.by) selfServed.add(id + '|' + u.by);
    /* an intermediate its own maker burns (the Cracking Yard reprocesses its slop) */
    if (arr(makersOf.get(id)).some((m) => m.biz === u.by)) selfServed.add(id + '|' + u.by);
  }

  const resources = rows.map((r) => {
    const src = sourcesOf(r.id);
    const makers = arr(makersOf.get(r.id));
    const uses = arr(USES[r.id]);
    const consumers = uniq(uses.map((u) => u.by));
    const row = {
      id: r.id,
      lootSources: src.loot.length, themedSources: src.loot.filter((s) => s.themed).length, traders: src.buy.length,
      makers: makers.map((m) => m.biz), liveMakers: makers.filter((m) => m.inStash).map((m) => m.biz),
      madeIn: src.madeIn, madeInAll: src.madeInAll.map((m) => m.node),
      sources: src.loot.length + makers.length + src.buy.length + (src.madeIn ? 1 : 0),
      consumers, consumerCount: consumers.length,
      /* 'sim' rows are the closed city economy: a real line of code, but a unit in
         a player's stash cannot be spent there (coverage.js header). Kept apart. */
      playerConsumers: uniq(uses.filter((u) => u.role !== 'sim').map((u) => u.by)),
      liveConsumers: uniq(uses.filter((u) => u.live && u.role !== 'sim').map((u) => u.by)),
      producerEdges: arr(onEdgeOut.get(r.id)).length, consumerEdges: arr(onEdgeIn.get(r.id)).length,
      /* used only where it is found or made (the Cracking Yard burning its own
         slop): no edge to draw, and that is correct, not a gap */
      selfServed: consumers.length > 0 && consumers.every((c) => selfServed.has(r.id + '|' + c)),
    };
    if (src.madeByBiz && !makers.some((m) => m.biz === src.madeByBiz)) {
      rep.err('maker-missing', 'recipes', 'loot.js says "' + r.id + '" never drops and is made at a facility of ' + src.madeByBiz + ', but RECIPES.' + src.madeByBiz + '.makes does not list it', [r.id, src.madeByBiz]);
    }
    /* routed to coverage, never an error: a refinery intermediate is SUPPOSED to be
       burned where it is made (slop, gasOil). contraband is the one that is not. */
    if (consumers.length && makers.length && consumers.every((c) => makers.some((m) => m.biz === c))) {
      rep.note('only-consumer-is-maker', 'coverage', '"' + r.id + '" is used only by the business that makes it (' + consumers.join(', ') + '): it is sold on a counter with no buyer', [r.id].concat(consumers));
    }
    /* WHY the family is named in the message: an orphan id arrives here as a bare
       string, and the piece it is routed to then has to go hunting for where it
       even comes from. The catalogue already knows (it derived `from` while
       scanning the game), so spend it. The four shipyard ids landed as 8 bare
       rows in round 5 and cost the recipes piece a wrong conclusion ("there is no
       shipyard tile, so this is unabsorbable") when the Fishing Company's drydock
       is the live consumer. Never invent the fix here — just hand over the lead. */
    const fam = isObj(r.from) && r.from.name ? r.from.name : null;
    const famTail = fam ? ' (catalogue source family "' + fam + '")' : '';
    if (!row.sources) rep.err('resource-no-source', src.madeByBiz ? 'recipes' : 'loot', '"' + r.id + '" does not drop anywhere, no business makes it and no trader sells it' + famTail, [r.id]);
    if (!row.consumerCount) rep.err('resource-no-consumer', 'coverage', '"' + r.id + '" has no use anywhere' + famTail, [r.id]);
    else if (!row.playerConsumers.length) rep.err('resource-sim-only', 'coverage', '"' + r.id + '" is used only inside the simulated city economy — nothing a player holds can spend it', [r.id]);
    if (row.sources && !row.producerEdges) rep.err('resource-no-producer-edge', 'graph', '"' + r.id + '" has a source but rides no edge out of it', [r.id]);
    if (row.consumerCount && !row.consumerEdges && !consumers.every((c) => selfServed.has(r.id + '|' + c))) {
      rep.err('resource-no-consumer-edge', row.sources ? 'graph' : (src.madeByBiz ? 'recipes' : 'loot'), '"' + r.id + '" has a consumer but rides no edge into it', [r.id].concat(consumers));
    }
    return row;
  });
  /* Orphans arrive one id at a time, but they almost never arrive alone: a whole
     new source family lands in the catalogue in one generator run and every id in
     it is unsourced and unused on the same day. Eight separate rows hid that in
     round 5. Group them so the owner reads one sentence and the receiving piece
     knows it is looking for ONE place in the game, not four. Note, not error —
     the per-id errors above are still the thing that must go to zero. */
  (() => {
    const byFam = new Map();
    for (const row of resources) {
      if (row.sources && row.consumerCount) continue;
      const r = resById.get(row.id);
      const fam = isObj(r) && isObj(r.from) && r.from.name ? r.from.name : '(no family)';
      if (!byFam.has(fam)) byFam.set(fam, []);
      byFam.get(fam).push(row.id);
    }
    for (const fam of Array.from(byFam.keys()).sort()) {
      const ids = byFam.get(fam).slice().sort();
      if (ids.length < 2) continue;
      rep.note('orphan-family', 'coverage', ids.length + ' ids of the catalogue source family "' + fam + '" have no source, no use, or neither (' + ids.join(', ') + '): they entered the catalogue together, so they almost certainly share one home in the game — find that one place before writing ' + ids.length + ' separate rows', ids);
    }
  })();
  for (const id of Object.keys(USES)) {
    if (!resById.has(id)) rep.err('dangling-id', 'coverage', 'USES lists "' + id + '" which is not in the catalogue', [id]);
    for (const u of USES[id]) if (!nodeById.has(u.by)) rep.err('dangling-id', 'coverage', 'USES["' + id + '"] names consumer "' + u.by + '" which is not a node', [id, u.by]);
  }

  /* the drop tables themselves. sourcesFor() is asked per CATALOGUE id, so an id
     that is in a drop table but in no catalogue (the gunOil phantom) was never
     asked about and never seen. Walk the tables. */
  const lootRows = typeof L.resolveSources === 'function' ? arr(run0(() => L.resolveSources({ catalog: rows }))) : arr(L.LOOT_SOURCES);
  for (const srcRow of lootRows) {
    if (!isObj(srcRow)) continue;
    if (srcRow.system && !nodeById.has(srcRow.system)) rep.err('dangling-id', 'loot', 'loot source "' + srcRow.id + '" lives in unknown system "' + srcRow.system + '"', [srcRow.id, srcRow.system]);
    for (const id of uniq(arr(srcRow.always).concat(arr(srcRow.drops)))) {
      if (phantoms.has(id)) rep.err('phantom-loot', 'loot', 'loot source "' + srcRow.id + '" drops phantom id "' + id + '"', [srcRow.id, id]);
      else if (!resById.has(id)) rep.err('dangling-id', 'loot', 'loot source "' + srcRow.id + '" drops "' + id + '" which is not in the catalogue', [srcRow.id, id]);
    }
  }

  /* each sibling's own self-check, run against the REAL neighbours */
  const run = (piece, fn) => { try { return fn(); } catch (e) { rep.err('self-check-threw', piece, piece + ' self-check threw: ' + String(e && e.message)); return null; } };
  if (typeof B.validate === 'function') for (const m of arr(run('pdfmap', () => B.validate()))) rep.err('pdfmap-self-check', 'pdfmap', String(m && m.msg ? m.msg : m));
  if (d.recipes && typeof d.recipes.validateRecipes === 'function') {
    const v = run('recipes', () => d.recipes.validateRecipes({ ids: rows.map((r) => r.id), bizIds: arr(B.BUSINESSES).map((b) => b.id), businesses: arr(B.BUSINESSES), opsEcon: isObj(d.opsEcon) ? d.opsEcon : undefined })) || {};
    for (const m of arr(v.errors)) rep.err('recipes-self-check', 'recipes', String(m));
    for (const m of arr(v.warnings)) rep.err('recipes-self-warning', 'recipes', String(m));
  }
  if (typeof S.audit === 'function') for (const m of arr(run('shipping', () => S.audit({ businesses: arr(B.BUSINESSES), recipes: R, coverage: C, catalog: rows, ctx: isObj(d.ctx) ? d.ctx : undefined })))) rep.err('shipping-audit', 'shipping', String(m));
  if (typeof C.uncovered === 'function') for (const id of arr(run('coverage', () => C.uncovered(rows)))) rep.err('resource-no-consumer', 'coverage', '"' + id + '" has no use anywhere', [id]);
  if (typeof C.strays === 'function') for (const id of arr(run('coverage', () => C.strays(rows)))) rep.err('dangling-id', 'coverage', 'coverage has a stray / phantom id "' + id + '"', [id]);

  /* a tile nothing is trucked INTO. Not wrong by itself (a mine digs), but the
     recipes piece should look: the Airport burns aviationFuel and no lane brings it. */
  for (const n of nodes) if (n.type === 'business' && n.id !== CARRIER && !edges.some((e) => e.kind === 'supply' && e.to === n.id)) {
    rep.note('tile-no-inbound-lane', 'recipes', n.id + ' has no supply lane coming in; everything it needs is loot or a Marketplace purchase (' + n.otherNeeds.concat(n.lootNeeds).filter((p) => p.madeBy.length).map((p) => p.id).slice(0, 6).join(', ') + ' are made by other tiles)', [n.id]);
  }

  /* ---- warnings: ONLY what the owner has already been told about in writing.
     Anything unexpected is an error above, so a new warning cannot hide a defect. */
  for (const a of arr(B.AMBIGUITIES)) if (a.resolved !== true) {
    rep.warn('pdf-ambiguity', 'pdfmap', 'Open reading of the map (' + a.id + '): ' + a.title, ['AMBIGUITIES.' + a.id].concat(arr(a.affects)));
  }
  for (const n of nodes) if (n.status === 'planned') rep.warn('planned-tile', 'pdfmap', n.label + ' is on the owner\'s map but is not a business in the game yet', [n.id]);
  /* Each phantom carries its OWN adjudication into the warning. Round 5 shipped
     nine bare one-line warnings and a reader could not tell an adjudicated id
     (catalog.js PHANTOMS rows, each with evidence and a `near` suggestion) from
     one nobody had looked at — the list had just grown 4 -> 9 in a regeneration.
     The evidence is the catalogue's, quoted, never restated here; an id with no
     evidence row says so out loud, which is the only shape that should worry
     the lead. */
  const phantomRow = new Map(arr(d.catalog && d.catalog.PHANTOMS).filter(isObj).map((p) => [p.id, p]));
  for (const id of Array.from(phantoms).sort()) {
    const p = phantomRow.get(id);
    rep.warn('phantom-id', 'catalog', '"' + id + '" is referred to by game code but has no catalogue row; it is never drawn as cargo or as a need. '
      + (p && p.evidence ? 'Adjudicated by catalog.js: ' + p.evidence + (p.near ? ' Nearest real id: "' + p.near + '".' : '')
        : 'NOT adjudicated: no catalog.js PHANTOMS row explains where this id comes from.'), [id]);
  }
  if (B.P9_RULE && B.P9_RULE.enforcement !== 'live') rep.warn('planned-rule', 'pdfmap', 'The p9 hiring rule (a city needs a Bus, Airport or train station to hire from camps) is the owner\'s rule, not enforced by the game today', ['P9_RULE']);
  if (S.RULE && S.RULE.tag !== 'live') rep.warn('planned-rule', 'shipping', 'Every lane is drawn through Transport because the owner\'s goal asks for it; the game does not force a carrier today except on the two medical waybill lanes', ['RULE.' + (S.RULE.id || 'ship-via-transport')]);

  /* ------------------------------------------------------------------ stats */

  const count = (list, f) => list.filter(f).length;
  const supply = edges.filter((e) => e.kind === 'supply');
  const pdfSupply = supply.filter((e) => e.basis === 'pdf-needs');
  const statsObj = {
    nodes: { total: nodes.length, systems: count(nodes, (n) => n.type === 'system'), channels: count(nodes, (n) => n.type === 'channel'), businesses: count(nodes, (n) => n.type === 'business'), planned: count(nodes, (n) => n.status === 'planned') },
    edges: {
      total: edges.length,
      byKind: KIND_ORDER.reduce((o, k) => { o[k] = count(edges, (e) => e.kind === k); return o; }, {}),
      live: count(edges, (e) => e.live), proposed: count(edges, (e) => !e.live), onPdf: count(edges, (e) => e.pdf),
    },
    pdfNeeds: { drawn: pdfPairs.size, present: pdfSupply.length, withCargo: count(pdfSupply, (e) => e.cargo.length > 0), viaTransport: count(pdfSupply, (e) => e.via === CARRIER), live: count(pdfSupply, (e) => e.live) },
    lanes: { total: lanes.length, enforcedToday: count(lanes, (l) => l.enforcedToday), selfHaul: count(lanes, (l) => l.selfHaul), truckNotDrawn: count(lanes, (l) => l.truckDrawn === false) },
    loop,
    /* what each system produces and what each hand-off carries, as counts */
    systems: nodes.filter((n) => n.type === 'system').map((n) => ({ id: n.id, made: n.produces.made.length, drops: n.produces.drops.length, total: n.produces.total,
      handoff: edges.filter((e) => e.kind === 'system' && e.from === n.id).map((e) => ({ edge: e.id, to: e.to, cargo: e.cargo.length, live: e.liveIds.length, pdf: e.pdf }))[0] || null })),
    resources: {
      total: resources.length,
      withSource: count(resources, (r) => r.sources > 0), withConsumer: count(resources, (r) => r.consumerCount > 0),
      withPlayerConsumer: count(resources, (r) => r.playerConsumers.length > 0),
      /* the honest number behind "every resource has a use" */
      withLiveConsumer: count(resources, (r) => r.liveConsumers.length > 0),
      lootable: count(resources, (r) => r.lootSources > 0), made: count(resources, (r) => r.makers.length > 0),
      systemMade: count(resources, (r) => r.madeInAll.length > 0),
      /* can be listed on the resource market today (ledger ids) vs carry-home only */
      marketListable: count(rows, (r) => r.inLedger === true), notMarketListable: rows.filter((r) => r.inLedger !== true).map((r) => r.id),
      onProducerEdge: count(resources, (r) => r.producerEdges > 0), onConsumerEdge: count(resources, (r) => r.consumerEdges > 0),
      /* WHICH ids, in catalogue order — so a view or the audit can list them
         without parsing report messages. noLiveConsumer is the long honest one:
         the ids whose only uses are the owner's PROPOSED uses (or the simulated
         city). uncoveredIds = the bar's question, "no way in OR no way out". */
      noSource: resources.filter((r) => !r.sources).map((r) => r.id),
      noConsumer: resources.filter((r) => !r.consumerCount).map((r) => r.id),
      noPlayerConsumer: resources.filter((r) => !r.playerConsumers.length).map((r) => r.id),
      noLiveConsumer: resources.filter((r) => !r.liveConsumers.length).map((r) => r.id),
      noProducerEdge: resources.filter((r) => !r.producerEdges).map((r) => r.id),
      noConsumerEdge: resources.filter((r) => !r.consumerEdges && !r.selfServed).map((r) => r.id),
      uncoveredIds: resources.filter((r) => !r.sources || !r.consumerCount).map((r) => r.id),
      rows: resources,
    },
    report: { errors: rep.errors.length, warnings: rep.warnings.length, notes: rep.notes.length },
  };

  const graph = { nodes, edges, lanes, report: { errors: rep.errors, warnings: rep.warnings, notes: rep.notes }, stats: statsObj };

  /* Non-enumerable so JSON.stringify(graph), a structured clone or a spread see
     data only — the methods are a convenience, never part of the view model. */
  const priv = { nodeById, edgeById, resById, makersOf, sourcesOf, USES, CARRIER, route, phantoms };
  Object.defineProperty(graph, '_', { value: priv, enumerable: false });
  Object.defineProperty(graph, 'neighbours', { value: (id) => neighbours(id, graph), enumerable: false });
  Object.defineProperty(graph, 'resourceFlow', { value: (id) => resourceFlow(id, graph), enumerable: false });
  Object.defineProperty(graph, 'node', { value: (id) => nodeById.get(id) || null, enumerable: false });
  Object.defineProperty(graph, 'edge', { value: (id) => edgeById.get(id) || null, enumerable: false });

  /* Every view shares this one object. Frozen all the way down so a hover card
     sorting n.lootNeeds in place cannot reorder the modal's list (loot.js had
     exactly that bug with its drop tables in its round 1). */
  deepFreeze(graph);

  const complete = !rep.errors.some((e) => e.code === 'missing-data');
  if (complete && d.pin !== false) LAST = graph;
  return graph;
}

/* ------------------------------------------------------------ derivations -- */

const graphOf = (g) => (g && g._ ? g : LAST);

/* Everything one hop from a node, split the way the modal asks its questions:
   who supplies me, who buys from me, where do I sell, what do I find in battle,
   and who carries it. Transport is reported as `carrier`, never as a supplier,
   so "best partners" cannot mistake the haul for a product. */
export function neighbours(id, graph) {
  const g = graphOf(graph);
  const empty = { id, known: false, suppliers: [], customers: [], channels: [], loot: [], services: [], systems: [], carrier: null, all: [] };
  if (!g || !g._.nodeById.has(id)) return empty;
  const out = { id, known: true, suppliers: [], customers: [], channels: [], loot: [], services: [], systems: [], carrier: null, all: [] };
  let hauled = false;
  for (const e of g.edges) {
    if (e.from !== id && e.to !== id) continue;
    const other = e.from === id ? e.to : e.from;
    const dir = e.from === id ? 'out' : 'in';
    const row = { node: other, edge: e.id, dir, cargo: e.cargo.slice(), live: e.live, pdf: e.pdf, via: e.via };
    if (e.kind === 'supply') (dir === 'in' ? out.suppliers : out.customers).push(row);
    else if (e.kind === 'channel') out.channels.push(row);
    else if (e.kind === 'loot') out.loot.push(row);
    else if (e.kind === 'service') out.services.push(row);
    else out.systems.push(row);
    if (e.via) hauled = true;
  }
  if (id === g._.CARRIER) {
    /* the hub's neighbours are every tile whose freight it carries */
    out.hauls = uniq(g.lanes.reduce((a, l) => a.concat(l.from === id ? [] : [l.from], l.to === id ? [] : [l.to]), [])).filter((x) => x !== id);
  } else if (hauled) {
    const mine = g.lanes.filter((l) => l.from === id || l.to === id);
    out.carrier = { node: g._.CARRIER, lanes: mine.map((l) => l.id), enforcedToday: mine.some((l) => l.enforcedToday), selfHaul: mine.length > 0 && mine.every((l) => l.selfHaul) };
  }
  const seen = new Set();
  for (const k of ['suppliers', 'customers', 'channels', 'loot', 'services', 'systems']) for (const r of out[k]) seen.add(r.node);
  if (out.carrier) seen.add(out.carrier.node);
  for (const h of arr(out.hauls)) seen.add(h);
  out.all = g.nodes.map((n) => n.id).filter((x) => seen.has(x));
  return out;
}

/* One resource's whole journey: where it comes from (battle loot, a business
   that makes it, a camp trader) -> who carries it -> who uses it. This is what
   the search box lights up, and what the owner's example reads as:
   cloth = loot + Fashion Brand -> Transport -> Medical Corporation. */
export function resourceFlow(resId, graph) {
  const g = graphOf(graph);
  const none = { id: resId, known: false, phantom: false, marketable: false, sources: { loot: [], makers: [], traders: [], madeIn: null, madeInAll: [] }, carrier: null, consumers: [], lanes: [], routes: [], edges: [], nodes: [], viaMarket: [], viaLoot: [], summary: '' };
  if (!g) return none;
  const P = g._;
  if (P.phantoms.has(resId)) return Object.assign(none, { phantom: true, summary: 'Game code refers to this id but no catalogue defines it. It is never cargo.' });
  const row = P.resById.get(resId);
  if (!row) return none;

  const src = P.sourcesOf(resId);
  const makers = arr(P.makersOf.get(resId)).map((m) => ({ biz: m.biz, live: m.live, inStash: m.inStash, via: m.via }));
  const usesRows = arr(P.USES[resId]);
  const consumers = [];
  for (const u of usesRows) {
    let c = consumers.find((x) => x.by === u.by);
    if (!c) { c = { by: u.by, roles: [], live: false, simOnly: true, why: u.why || null }; consumers.push(c); }
    if (c.roles.indexOf(u.role) < 0) c.roles.push(u.role);
    if (u.live && u.role !== 'sim') c.live = true;
    if (u.role !== 'sim') c.simOnly = false;
  }
  const order = new Map(g.nodes.map((n, i) => [n.id, i]));
  consumers.sort((a, b) => (a.live === b.live ? 0 : a.live ? -1 : 1) || ((order.get(a.by) || 0) - (order.get(b.by) || 0)));

  const carrying = g.edges.filter((e) => e.cargo.indexOf(resId) >= 0 || arr(e.upkeepCargo).indexOf(resId) >= 0);
  const lanes = carrying.map((e) => {
    const lane = g.lanes.find((l) => l.edge === e.id) || null;
    return {
      edge: e.id, kind: e.kind, from: e.from, to: e.to, via: e.via, pdf: e.pdf,
      live: arr(e.liveIds).indexOf(resId) >= 0,
      path: lane ? lane.path.slice() : [e.from, e.to],
      enforcedToday: lane ? lane.enforcedToday : false,
    };
  });
  /* THE CARRIER ROW. Round 1 probed the FIRST hauled lane, which for 29 ids was
     the sale to the Marketplace, and printed required:true next to "Settles
     instantly with no haul". Both were true of different things: the owner's
     rule requires a carrier; the game does not. So (a) a business-to-business
     lane is preferred as the probe, and (b) the two facts get names that cannot
     be read as one: ruleRequires (the owner's goal) vs enforcedToday (the game). */
  const hauled = lanes.filter((l) => l.via);
  const hauledSupply = hauled.filter((l) => l.kind === 'supply');
  const probeLane = hauledSupply.find((l) => l.pdf) || hauledSupply[0] || hauled[0] || null;
  const probeArgs = probeLane ? { from: probeLane.from, to: probeLane.to, resId } : null;
  if (probeArgs && probeLane.kind === 'channel') probeArgs.channel = probeLane.to;
  const probe = probeArgs ? P.route(probeArgs) : null;
  const carrier = probeLane ? {
    node: P.CARRIER, cargoClass: probe ? probe.cargoClass || null : null,
    basis: probeLane.kind === 'supply' ? 'business-lane' : 'market-sale', probeEdge: probeLane.edge,
    ruleRequires: probe ? probe.carrierRequired === true : null,
    enforcedToday: hauled.some((l) => l.enforcedToday),
    tag: hauled.some((l) => l.enforcedToday) ? 'live' : 'proposed',
    today: probe ? probe.whatHappensToday || null : null,
  } : null;

  const makerSet = new Set(makers.map((m) => m.biz));
  /* HOW EACH CONSUMER GETS IT, one answer each, strongest first. Round 1's
     viaMarket was "no edge of any kind reaches it", which a loot edge always
     satisfied, so it was [] for every sourced id and listed buyers for an id
     nobody makes. */
  const supplyTo = new Set(lanes.filter((l) => l.kind === 'supply').map((l) => l.to));
  const lootTo = new Set(lanes.filter((l) => l.kind === 'loot').map((l) => l.to));
  const lootSystems = new Set(src.loot.map((x) => x.system));
  const sellable = makers.length > 0 || src.buy.length > 0;
  /* 'none' MUST MEAN "there is no way to get it". Round 2 printed it for 130
     id/consumer pairs, all of them the City Builder's simulated economy using a
     resource that drops in battle (electricity, aluminum, cotton): no loot edge
     is drawn into a 'sim' use, because a unit in a player's stash cannot be
     spent there, and the fall-through said "none". A view would have told the
     player a lootable resource cannot be had. So: a sim-only consumer reads
     'sim' (the closed city economy supplies itself), a lootable id with no drawn
     loot edge still reads 'loot', a system-made id reads 'system', and 'none' is
     left for an id with no source at all. */
  for (const c of consumers) {
    c.reach = (makerSet.has(c.by) || src.madeInAll.some((m) => m.node === c.by)) ? 'self'
      : supplyTo.has(c.by) ? 'lane'
        : (lootTo.has(c.by) || lootSystems.has(c.by)) ? (src.madeIn && !src.loot.length ? 'system' : 'loot')
          : c.simOnly ? 'sim'
            : src.loot.length ? 'loot'
              : makers.length ? 'market' : src.buy.length ? 'trader' : src.madeIn ? 'system' : 'none';
  }
  /* buys it over the Marketplace counter: a business makes it, and no lane
     brings it to this consumer (it may ALSO be lootable — then both are true) */
  /* ROUND 4: a DROP is sold there too. The PDF labels Battle -> Just Business
     "Market Place Resources", and the resource market lists any ledger id, so a
     lootable ledger id reaches a business either in the owner's own squad's
     packs or across the counter. Round 3 said only the first, for 328 ids. A
     simulated-only consumer is left out: nothing a player buys can be spent there. */
  const marketable = row.inLedger === true && (makers.length > 0 || src.loot.length > 0 || src.madeInAll.some((m) => m.live));
  const viaMarket = marketable ? consumers.filter((c) => !makerSet.has(c.by) && !supplyTo.has(c.by) && !c.simOnly && !src.madeInAll.some((m) => m.node === c.by)).map((c) => c.by) : [];
  const viaLoot = consumers.filter((c) => lootTo.has(c.by) || lootSystems.has(c.by)).map((c) => c.by);

  const nodeSet = new Set();
  for (const x of src.loot) if (x.system) nodeSet.add(x.system);
  for (const m of makers) nodeSet.add(m.biz);
  for (const m of src.madeInAll) nodeSet.add(m.node);
  if (viaMarket.length && P.nodeById.has('ch:market')) nodeSet.add('ch:market');
  for (const l of lanes) for (const p of l.path) nodeSet.add(p);
  for (const c of consumers) nodeSet.add(c.by);
  const name = (id) => (P.nodeById.get(id) ? P.nodeById.get(id).label : id);

  /* THE SENTENCE. Rules, each one a round-1 nonsense line it removes:
       - a maker is never its own destination ("Smuggling -> Transport -> Smuggling")
       - the carrier is never its own destination ("-> Transport -> Transport")
       - when the only truck goes to a Marketplace, the Marketplace is named and
         the buyers come after it
       - nothing hauled = no carrier in the sentence at all */
  const parts = [];
  if (src.loot.length) parts.push('loot (' + src.loot[0].label + (src.loot.length > 1 ? ' +' + (src.loot.length - 1) : '') + ')');
  /* makers with a route of their own are named IN that route, not in the head */
  const headMakers = () => makers.filter((m) => !routed.has(m.biz));
  /* "City Builder (Textile Mill)": the system AND the building, because "made in
     City Builder" does not tell a player what to place. */
  for (const m of src.madeInAll) parts.push(name(m.node) + (m.by ? ' (' + m.by + ')' : ''));
  if (src.buy.length && !parts.length) parts.push('camp traders');
  const okTarget = (id) => id !== P.CARRIER && !makerSet.has(id);
  /* EACH MAKER WITH ITS OWN DESTINATIONS. Round 2 joined every maker to the
     PDF-lane destinations: cloth read "Home Feed, Fashion Brand -> Transport ->
     Medical Corporation" although no feed -> medical lane exists, and the real
     feed lanes (Weapon Smith, City Builder) were left out. A sentence must not
     assert a route the edges do not contain. Routes the owner DREW come first,
     so the owner's own example still leads. */
  const routes = [];
  for (const m of makers) {
    /* A destination may itself be a maker: the Car Factory ships cars to the Car
       Dealer, which coverage lists as making (reselling) cars. Round 3 dropped
       every maker from every route and so lost the PDF's own example. Only the
       sender itself and the carrier are never a destination. */
    const mine = hauledSupply.filter((l) => l.from === m.biz && l.to !== m.biz && l.to !== P.CARRIER);
    if (!mine.length) continue;
    const to = uniq(mine.filter((l) => l.pdf).map((l) => l.to).concat(mine.filter((l) => !l.pdf).map((l) => l.to)));
    routes.push({ from: m.biz, to, pdf: mine.some((l) => l.pdf), live: mine.some((l) => l.live), edges: mine.map((l) => l.edge) });
  }
  routes.sort((a, b) => (a.pdf === b.pdf ? 0 : a.pdf ? -1 : 1));   // stable: maker order kept inside each half
  const routed = new Set(routes.map((r) => r.from));
  const laneTo = uniq(routes.reduce((a, r) => a.concat(r.to), []));
  const soldOn = uniq(hauled.filter((l) => l.kind === 'channel').map((l) => l.to));
  const others = consumers.filter((c) => okTarget(c.by)).map((c) => c.by);
  const list = (ids) => ids.slice(0, 3).map(name).join(', ') + (ids.length > 3 ? ' +' + (ids.length - 3) : '');
  let tail;
  let routeText = '';
  if (laneTo.length) {
    routeText = routes.map((r) => name(r.from) + ' -> ' + name(P.CARRIER) + ' -> ' + list(r.to)).join('; ');
    tail = '';
  } else if (soldOn.length) {
    const buyers = others.filter((id) => viaMarket.indexOf(id) >= 0);
    tail = ' -> ' + name(P.CARRIER) + ' -> ' + soldOn.map(name).join(', ') + (buyers.length ? ' -> ' + list(buyers) : '');
  } else {
    /* nothing is hauled, so Transport is not in the sentence as a carrier and may
       appear as the plain consumer it is */
    const plain = consumers.filter((c) => !makerSet.has(c.by) && !src.madeInAll.some((m) => m.node === c.by)).map((c) => c.by);
    const counter = viaMarket.length && P.nodeById.has('ch:market') ? 'your own haul, or the ' + name('ch:market') + ' -> ' : '';
    tail = plain.length ? ' -> ' + counter + list(plain) : '';
  }
  const carrierShown = Boolean(laneTo.length || soldOn.length);
  const asides = [];
  /* a maker already named as a route destination is not repeated as an aside */
  const selfUsers = consumers.filter((c) => makerSet.has(c.by) && c.by !== P.CARRIER && laneTo.indexOf(c.by) < 0).map((c) => c.by);
  if (selfUsers.length) asides.push(((tail || routeText) ? 'also used by its maker ' : 'used where it is made: ') + list(selfUsers));
  if (carrierShown && consumers.some((c) => c.by === P.CARRIER) && !makerSet.has(P.CARRIER)) asides.push(name(P.CARRIER) + ' also uses it itself');
  const usedInside = src.madeInAll.filter((m) => consumers.some((c) => c.by === m.node) && laneTo.indexOf(m.node) < 0).map((m) => m.node);
  if (usedInside.length) asides.push('also used inside ' + list(usedInside));
  if (carrierShown && viaMarket.length && src.loot.length) asides.push('drops are also sold on the ' + name('ch:market'));
  if (!consumers.length) asides.push('no consumer');
  /* a maker that ships on no lane of its own still makes it: say so, after the routes */
  const unrouted = headMakers().map((m) => m.biz);
  if (routeText) { if (unrouted.length) asides.unshift('also made by ' + list(unrouted)); parts.push(routeText); }
  else if (unrouted.length) parts.splice(src.loot.length ? 1 : 0, 0, unrouted.map(name).join(', '));
  const summary = (parts.join(' + ') || 'no source') + tail + (asides.length ? ((tail || routeText) ? ' (' + asides.join('; ') + ')' : ' -> ' + asides.join('; ')) : '');

  return {
    id: resId, known: true, phantom: false, name: row.name, icon: row.icon,
    sources: { loot: src.loot, makers, traders: src.buy, madeIn: src.madeIn ? { node: src.madeIn, label: src.madeInLabel, cite: src.madeInCite } : null,
      /* every system that makes it, with the building: [{node, by, cite, live}] */
      madeInAll: src.madeInAll.map((m) => ({ node: m.node, by: m.by, cite: m.cite, live: m.live })) },
    marketable,
    /* said out loud, because 249 lootable ids are NOT ledger resources and the
       resource market cannot list them today: those really are carry-home only */
    marketBlocked: !marketable && row.inLedger !== true ? 'The Resource Marketplace lists ledger resources only. This one is not in the ledger, so today it can only be carried home by the squad that found it.' : null,
    carrier, consumers, lanes, routes,
    edges: lanes.map((l) => l.edge),
    nodes: g.nodes.map((n) => n.id).filter((x) => nodeSet.has(x)),
    viaMarket, viaLoot, summary,
  };
}

/* Counts for the shell's footer and the audit. Part of the built graph (so it is
   in the deterministic JSON); this accessor exists for the contract's stats(). */
export function stats(graph) {
  const g = graphOf(graph);
  return g ? g.stats : null;
}

export default buildGraph;
