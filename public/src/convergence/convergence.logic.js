/* ══════════════════════════════════════════════════════════════════════════
   ⟁ CONVERGENCE — the pure rules. No DOM, no globals, no App.

   Owner-approved summon type, our spin on a Synchro:
     · a unit card may carry the trait ANCHOR (card.anchor === true)
     · a Convergence card is a Realm-Deck summon carrying
         card.convergence = { enabled: true, value: N (1..20), element?: '<id>' }
     · to Converge you use your OWN living, non-hero units on the field:
         EXACTLY ONE Anchor + ONE OR MORE non-Anchors, whose PRINTED CARD COSTS
         sum EXACTLY to N, standing as ONE CONNECTED CHAIN of adjacent tiles
     · the Convergence unit lands ON THE ANCHOR'S TILE; every material goes to
       its owner's graveyard
     · LEY: if the card names an element and EVERY material stood on a ley hex
       of that element, the new unit arrives ready to act this turn

   WHY THE NAME. Not "Attunement" — that word already means the ley-line damage
   bonus ("attuned ground", ley.js ATTUNE_ATK). Not "Resonance" — src/resonance
   is a different system. Two features answering to one word is how a rules
   question gets the wrong answer from the right person.

   🔴 THE GLOBALS TRAP (CLAUDE.md). Everything this file needs from the legacy
   app arrives in `api`, which index.js builds from window.MythicConvergenceBridge.
   In particular ADJACENCY IS NOT COMPUTED HERE: `api.neighbours(x, y)` is
   index.html's hexNeighbors — the one single source of truth for the odd-r
   board (HEXSPEC §5). A second copy of the offsets in this file would be right
   today and wrong the first time the lattice changes, which is exactly how the
   eight-way loops that hexNeighbors replaced all went wrong at once.

   ⚠ IMMUTABLE. applyConvergence returns a NEW state and never touches the one
   it was handed — the same contract as _applyArchonSummon, because the caller
   commits by ASSIGNING App.state and that assignment is what runs
   _reconcileUnitCards (the graveyard filing). Mutating in place would skip it.
   ══════════════════════════════════════════════════════════════════════════ */

export const CV_MIN = 1;
export const CV_MAX = 20;
/* Search bounds. A set larger than this is not a chain anyone builds on
   purpose, and the ESU walk below is exponential in the worst case (a solid
   blob of zero-cost units). Both caps make a full board a bounded cost for
   the AI step rather than a hang. */
export const CV_MAX_UNITS = 8;
export const CV_MAX_WORK = 40000;
export const CV_MAX_SETS = 32;

/* ── the card side ────────────────────────────────────────────────────────── */
export function isConvergence(card) {
  return !!(card && card.convergence && typeof card.convergence === 'object' && card.convergence.enabled);
}
export function isAnchor(card) {
  return !!(card && card.anchor === true);
}
/* The recipe, clamped. A value outside 1..20 is clamped rather than refused so
   a hand-edited card still reads the same number the editor would have saved. */
export function specOf(card) {
  if (!isConvergence(card)) return null;
  const c = card.convergence;
  let v = parseInt(c.value, 10);
  if (!isFinite(v)) v = CV_MIN;
  v = Math.max(CV_MIN, Math.min(CV_MAX, v));
  const el = (typeof c.element === 'string' && c.element.trim()) ? c.element.trim().toLowerCase() : '';
  return { value: v, element: el };
}

/* ── the unit side ────────────────────────────────────────────────────────── */
/* The PRINTED cost of the unit's source card — never an effective or reduced
   cost. 0 counts as 0 (a free unit is a legal zero-weight link in the chain);
   a missing cost is 0 too rather than a guess. */
export function unitCost(u, api) {
  let def = null;
  try { def = api.cardOf(u); } catch (e) { def = null; }
  const raw = (def && def.cost != null) ? def.cost : (u ? u.cost : 0);
  const n = +raw;
  return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
}
export function unitIsAnchor(u, api) {
  if (!u) return false;
  if (u.anchor === true) return true;
  let def = null;
  try { def = api.cardOf(u); } catch (e) { def = null; }
  return isAnchor(def);
}
/* How much board presence a material represents. Used ONLY to order the
   candidate sets so "prefer the cheapest / weakest units" has a meaning; it
   never decides legality. */
export function unitWeight(u) {
  if (!u) return 0;
  const st = u.stats || {};
  return (u.maxHp || st.hp || 0) + (st.atk || 0) + (st.mag || 0) + (st.def || 0) + (st.res || 0);
}
function eligible(u, side) {
  return !!(u && u.alive && !u.isHero && u.owner === side && u.pos
    && !(typeof u.currentHp === 'number' && u.currentHp <= 0));
}
const keyOf = (x, y) => (x | 0) + ',' + (y | 0);

/* The pool of possible materials for one side, with cost / anchor resolved
   once — the search below touches each unit many times. */
function buildPool(state, side, api, maxCost) {
  const units = ((state && state.units) || []).filter(u => eligible(u, side));
  const byKey = new Map();
  const nodes = [];
  for (const u of units) {
    const cost = unitCost(u, api);
    if (maxCost != null && cost > maxCost) continue;   // can never fit — prune up front
    const n = { u, id: u.id, cost, anchor: unitIsAnchor(u, api), x: u.pos.x | 0, y: u.pos.y | 0, adj: [] };
    nodes.push(n);
    byKey.set(keyOf(n.x, n.y), n);
  }
  for (const n of nodes) {
    let nb = [];
    try { nb = api.neighbours(n.x, n.y) || []; } catch (e) { nb = []; }
    for (const p of nb) {
      const m = byKey.get(keyOf(p.x, p.y));
      if (m && m !== n) n.adj.push(m);
    }
  }
  return nodes;
}

/* ══ THE SEARCH ═══════════════════════════════════════════════════════════
   Every connected set that contains exactly one given Anchor, enumerated once
   each with ESU (Wernicke 2006) rooted at that Anchor:

     extend(Sub, Ext):
       record Sub
       while Ext non-empty:
         w = pop(Ext)
         Ext' = Ext ∪ { n ∈ N(w) : n ∉ Sub, n ∉ N(Sub), n not excluded }
         extend(Sub ∪ {w}, Ext')

   The "n ∉ N(Sub)" exclusive-neighbourhood rule is what makes each set appear
   exactly once; popping w from Ext for good is what keeps later branches from
   re-adding it. Other Anchors are simply not in the graph for this root, which
   is how "exactly one Anchor" is enforced by construction rather than filtered
   afterwards.

   PRUNING. Costs are non-negative, so a partial set already over N can only
   get worse — a branch is abandoned the moment its sum passes N, and a w whose
   own cost would pass it is skipped (still popped, so the dedupe holds).
   CAPS. CV_MAX_UNITS bounds the depth; CV_MAX_WORK bounds the total number of
   extensions across every root, and the result says `truncated` when it hit
   it, so a caller can tell "none exist" from "stopped looking". */
export function findSets(state, side, card, api, opts) {
  const o = opts || {};
  const sp = specOf(card);
  const res = { sets: [], truncated: false, work: 0 };
  if (!sp || !state) return res;
  const N = sp.value;
  const maxUnits = Math.max(2, Math.min(12, o.maxUnits || CV_MAX_UNITS));
  const maxWork = Math.max(100, o.maxWork || CV_MAX_WORK);
  const maxSets = Math.max(1, o.maxSets || CV_MAX_SETS);
  const mustInclude = o.mustInclude || null;
  const nodes = buildPool(state, side, api, N);
  const anchors = nodes.filter(n => n.anchor);
  if (!anchors.length) return res;
  let work = 0;
  const found = [];

  for (const root of anchors) {
    if (work >= maxWork || found.length >= maxSets * 4) { res.truncated = work >= maxWork; break; }
    if (root.cost > N) continue;
    const inSub = new Set([root]);
    // N(Sub) — everything adjacent to the current set, for the exclusive rule.
    const nbCount = new Map();
    const addNb = (n, d) => { for (const m of n.adj) nbCount.set(m, (nbCount.get(m) || 0) + d); };
    addNb(root, +1);
    const allowed = (m) => !m.anchor;   // exactly one Anchor: the root
    const sub = [root];
    const initialExt = root.adj.filter(allowed);

    const extend = (ext, sum) => {
      if (sub.length >= 2 && sum === N) {
        if (!mustInclude || sub.some(n => n.id === mustInclude)) found.push(sub.slice());
      }
      if (sub.length >= maxUnits) return;
      const e = ext.slice();
      while (e.length) {
        if (++work > maxWork) { res.truncated = true; return; }
        const w = e.pop();
        if (sum + w.cost > N) continue;   // popped for good either way — dedupe holds
        const next = e.slice();
        for (const m of w.adj) {
          if (!allowed(m) || inSub.has(m) || m === w) continue;
          if ((nbCount.get(m) || 0) > 0) continue;   // already in N(Sub) — not exclusive
          if (next.indexOf(m) < 0) next.push(m);
        }
        inSub.add(w); sub.push(w); addNb(w, +1);
        extend(next, sum + w.cost);
        addNb(w, -1); sub.pop(); inSub.delete(w);
        if (res.truncated) return;
      }
    };
    extend(initialExt, root.cost);
    if (res.truncated) break;
  }
  res.work = work;

  // Order: the weakest material first (the owner's "prefer the cheapest /
  // weakest units"), then the fewest bodies, then a stable id order so two
  // clients looking at one board list the sets identically.
  const out = found.map(list => {
    const anchor = list[0];
    const ids = list.map(n => n.id);
    return {
      anchorId: anchor.id,
      unitIds: ids,
      tiles: list.map(n => ({ x: n.x, y: n.y, id: n.id, cost: n.cost, anchor: n.anchor })),
      total: list.reduce((s, n) => s + n.cost, 0),
      weight: list.reduce((s, n) => s + unitWeight(n.u), 0),
      ley: sp.element ? leyAligned(state, list.map(n => n.u), sp.element, api) : false,
    };
  });
  const idKey = (s) => s.unitIds.map(String).sort().join('|');
  out.sort((a, b) => (a.weight - b.weight) || (a.unitIds.length - b.unitIds.length)
    || (idKey(a) < idKey(b) ? -1 : idKey(a) > idKey(b) ? 1 : 0));
  res.sets = out.slice(0, maxSets);
  return res;
}

/* EVERY material on a ley hex of the card's element. One off-ley link and the
   bonus is gone — "a chain of attuned ground", not "mostly". */
export function leyAligned(state, units, element, api) {
  if (!element || !units || !units.length) return false;
  const want = String(element).toLowerCase();
  for (const u of units) {
    if (!u || !u.pos) return false;
    let e = null;
    try { e = api.leyElemAt(state, u.pos.x | 0, u.pos.y | 0); } catch (err) { e = null; }
    if (!e || String(e).toLowerCase() !== want) return false;
  }
  return true;
}

/* ══ VALIDATION — the same rules, asked of ONE proposed set ══════════════════
   The search above only ever proposes legal sets; this exists so the resolver
   re-checks whatever it is handed (a stale overlay, a probe, a future caller)
   instead of trusting it. Returns { ok, reason, anchorId, total }. */
export function validateSet(state, side, card, unitIds, api) {
  const sp = specOf(card);
  if (!sp) return { ok: false, reason: 'Not a Convergence card.' };
  const ids = Array.isArray(unitIds) ? unitIds : [];
  if (new Set(ids).size !== ids.length) return { ok: false, reason: 'A unit is listed twice.' };
  if (ids.length < 2) return { ok: false, reason: 'Needs an Anchor and at least one other unit.' };
  const all = (state && state.units) || [];
  const units = ids.map(id => all.find(u => u && u.id === id) || null);
  if (units.some(u => !eligible(u, side))) return { ok: false, reason: 'Every material must be one of your living, non-hero units on the field.' };
  const anchors = units.filter(u => unitIsAnchor(u, api));
  if (anchors.length === 0) return { ok: false, reason: 'No Anchor among the materials.' };
  if (anchors.length > 1) return { ok: false, reason: 'Exactly one Anchor may be used — ' + anchors.length + ' were chosen.' };
  const total = units.reduce((s, u) => s + unitCost(u, api), 0);
  if (total !== sp.value) return { ok: false, reason: 'Printed costs total ' + total + ', not ' + sp.value + '.' };
  if (units.length > CV_MAX_UNITS) return { ok: false, reason: 'Too many materials (max ' + CV_MAX_UNITS + ').' };
  // Connected? Walk adjacency from the Anchor through the chosen tiles only.
  const byKey = new Map(units.map(u => [keyOf(u.pos.x, u.pos.y), u]));
  const seen = new Set([anchors[0]]);
  const q = [anchors[0]];
  while (q.length) {
    const u = q.shift();
    let nb = [];
    try { nb = api.neighbours(u.pos.x | 0, u.pos.y | 0) || []; } catch (e) { nb = []; }
    for (const p of nb) {
      const m = byKey.get(keyOf(p.x, p.y));
      if (m && !seen.has(m)) { seen.add(m); q.push(m); }
    }
  }
  if (seen.size !== units.length) return { ok: false, reason: 'The materials are not one connected chain of adjacent tiles.' };
  return { ok: true, anchorId: anchors[0].id, total, units };
}

/* ══ RESOLUTION ══════════════════════════════════════════════════════════
   Mirrors _applyArchonSummon step for step, deliberately:
     · materials → { alive:false, currentHp:0 }. Nothing else. The graveyard
       filing is NOT done here: it happens when the caller assigns App.state,
       whose accessor runs _reconcileUnitCards and files each dead unit's
       `_card` exactly once, to its OWNER's graveyard. That is the one door
       every death in the game goes through; a hand-rolled push here would be
       the second copy that invariant was written to kill.
     · ⚠ ONE ADDITION: a material with no `_card` (board-seeded / older AI
       units) would leave no card for the reconciler to file, and "all
       materials go to the graveyard" would quietly be false for it. Such a unit
       is handed its own printed card first (a 'cv_' instanceId, unit cards
       only — a token has no card to file). That is data the reconciler already
       understands; no new filing path.
     · the new unit is built on the ANCHOR'S tile (freed by the line above),
       summoning-sick unless 🏃 Speed or the ley bonus says otherwise
     · the Convergence card's on-play fires, zone 'realm', like an Archon's.
   `api.buildUnit` is index.html's buildUnit; `api.applyOnPlay` its
   applyOnPlayEffect. Returns { state, spawnedId, ley, name } or null. */
export function applyConvergence(state, opts, api) {
  if (!state || !opts) return null;
  const side = opts.side || 'player';
  const card = opts.card;
  const sp = specOf(card);
  if (!sp) return null;
  const v = validateSet(state, side, card, opts.unitIds, api);
  if (!v.ok) return { refused: v.reason };
  const anchor = v.units.find(u => u.id === v.anchorId);
  const tile = { x: anchor.pos.x | 0, y: anchor.pos.y | 0 };
  const ley = !!(sp.element && leyAligned(state, v.units, sp.element, api));
  const ids = new Set(v.units.map(u => u.id));

  let ns = { ...state };
  ns.units = (ns.units || []).map(u => {
    if (!u || !ids.has(u.id)) return u;
    let card0 = u._card;
    if (!card0) {
      let def = null;
      try { def = api.cardOf(u); } catch (e) { def = null; }
      if (def && String(def.type || 'unit').toLowerCase() === 'unit') card0 = { ...def, instanceId: 'cv_' + u.id };
    }
    return { ...u, ...(card0 ? { _card: card0 } : {}), alive: false, currentHp: 0, _convergedInto: card.id };
  });

  let nu = null;
  try { nu = api.buildUnit(card, side, tile); } catch (e) { nu = null; }
  const log = [...(ns.log || [])];
  const mine = side === 'player';
  const names = v.units.map(u => (u.id === v.anchorId ? '⚓ ' : '') + (u.name || 'Unit')).join(' + ');
  if (!nu) {
    log.push({ msg: '⟁ ' + (card.name || 'Convergence') + ' could not manifest.', color: 'amber' });
    ns.log = log;
    return { state: ns, spawnedId: null, ley: false, name: card.name || 'Convergence' };
  }
  let speed = false;
  try { speed = !!api.hasPassive(nu, 'speed'); } catch (e) { speed = false; }
  let defender = false;
  try { defender = !!api.hasPassive(nu, 'defender'); } catch (e) { defender = false; }
  const ready = ley || speed;
  Object.assign(nu, {
    _summoned: true,
    isSummoned: true,
    isConvergence: true,
    cannotNormalDeploy: true,
    summonSource: 'Convergence',
    convergenceValue: sp.value,
    hasMoved: !ready,
    hasAttacked: ready ? defender : true,
    ...(ley ? { _convergenceLey: sp.element } : {}),
  });
  ns.units = [...ns.units, nu];
  log.push({ msg: '⟁ ' + (mine ? '' : 'Enemy ') + 'Convergence ' + sp.value + ': ' + names + ' → ' + (card.name || 'Convergence') + '!', color: mine ? 'green' : 'red' });
  if (ley) {
    let en = sp.element;
    try { en = api.elementName(sp.element) || sp.element; } catch (e) {}
    log.push({ msg: '🜂 Every link stood on ' + en + ' ley — ' + (card.name || 'it') + ' arrives ready to act.', color: 'purple' });
  }
  ns.log = log;
  if (card.onPlay && card.onPlay.type && typeof api.applyOnPlay === 'function') {
    try { ns = api.applyOnPlay(ns, nu, card) || ns; } catch (e) { try { console.warn('[convergence onPlay]', e); } catch (_) {} }
  }
  return { state: ns, spawnedId: nu.id, ley, name: card.name || 'Convergence', tile };
}

/* ── words ────────────────────────────────────────────────────────────────── */
export function ruleLine(card, elementName) {
  const sp = specOf(card);
  if (!sp) return '';
  let s = 'Convergence ' + sp.value + ' · 1 Anchor + non-Anchor units, costs total ' + sp.value + ', in a connected chain';
  if (sp.element) {
    let n = sp.element;
    try { n = (elementName && elementName(sp.element)) || sp.element; } catch (e) {}
    s += ' · Ley: ' + String(n).toLowerCase() + ' — arrives ready';
  }
  return s;
}
