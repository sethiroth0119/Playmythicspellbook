/* ══════════════════════════════════════════════════════════════════════════
   🧠 THE STATE — what is unlocked, what has been earned, and the one rule that
   outranks all of it: A LIVE CITY IS NEVER RETRO-LOCKED.

   ── 🔴 HOW GRANDFATHERING IS HANDLED. Read this before changing `adopt()`. ──
   This feature turns things that were free into things that must be unlocked.
   Applied naively to a save written yesterday, that is a player waking up
   unable to zone the towers their city is already made of. Three defences, and
   they are independent on purpose — any one of them failing still leaves a
   live city playable:

   1. ABSENT MODULE ⇒ EVERYTHING UNLOCKED. The read API is written so that
      every consumer's guard is `if (P && !P.zoneUnlocked(id)) refuse`. A 404
      on /src/progression means `window.MythicProgress` is undefined, every
      guard short-circuits, and the player loses the progression screen and
      nothing else. This is the same contract every other module here ships
      under and it is the only one that survives a bad deploy.

   2. A SAVE WITH NO PROGRESSION SLICE IS A LEGACY CITY, AND IT IS ADOPTED,
      NOT RESET. `load(undefined)` marks the city legacy. `adopt()` then walks
      the city AS IT ACTUALLY IS and grants, free and without spending a
      point, every node whose unlock the city can already demonstrate:
        · every zone id present in `game.zones` — the map the player already
          painted, read live rather than guessed at;
        · every node whose `licence` the player already holds at City Hall;
        · every node whose buildings are already standing on the map.
      The grant is recorded as `granted`, distinct from `unlocked`, so the
      panel can say "you already had this" rather than pretending the player
      spent points they did not spend.

   3. ADOPTION IS RE-RUN, NOT RUN ONCE. `adopt()` is idempotent and is called
      again whenever the city changes underneath us (after load, and before any
      refusal). So a zone that somehow exists on the map without its node —
      a hand-edited save, a module load order nobody predicted, a future
      /src/zoning that adds a twelfth id — is adopted the moment it is seen
      instead of being refused. THE MAP IS THE AUTHORITY ON WHAT THE PLAYER
      ALREADY HAS. This state is only ever the authority on what is NEW.

   ⚠ WHAT IS DELIBERATELY *NOT* DONE: nothing here ever removes a zone from the
     map, downgrades a building, or refuses a tile that is already standing.
     The only thing the gate can ever do is refuse a NEW zone paint. There is
     no code path in this module that destroys player state, and there must
     never be one.
   ══════════════════════════════════════════════════════════════════════════ */

import { NODES, NODE_BY_ID, CATS, AUTO_NODES, GOVERNED_ZONES, GOVERNED_BUILDINGS } from './tree.js';
import { METRICS, MILESTONES, ACHIEVEMENTS } from './milestones.js';

const SAVE_V = 1;

export function makeState(ctx) {
  const S = {
    unlocked: new Set(),     // nodes bought with points
    granted: new Set(),      // nodes adopted free — see (2) above
    reached: new Set(),      // milestone ids passed
    earned: new Set(),       // achievement ids earned
    spent: 0,                // points spent on `unlocked`
    legacy: false,           // this save predates the feature
    loaded: false,           // restore() has been called (even with nothing)
    adoptedAt: 0,
  };
  const listeners = { achievement: [], change: [] };

  for (const id of AUTO_NODES) S.granted.add(id);

  /* ── reading ─────────────────────────────────────────────────────────── */
  const has = (id) => S.unlocked.has(id) || S.granted.has(id);

  function unlockedZones() {
    const out = new Set();
    for (const n of NODES) if (has(n.id)) for (const z of (n.zones || [])) out.add(z);
    return Array.from(out);
  }
  function unlockedBuildings() {
    const out = new Set();
    for (const n of NODES) if (has(n.id)) for (const b of (n.buildings || [])) out.add(b);
    return Array.from(out);
  }
  /* ⚠ THE DEFAULT IS OPEN, IN BOTH OF THESE, AND THAT IS THE WHOLE SAFETY
     ARGUMENT. A zone or building this tree has never heard of is not gated —
     so a twelfth zone id added to /src/zoning next week is playable the day it
     lands, rather than silently locked behind a node nobody wrote. */
  function zoneUnlocked(id) {
    if (!id) return true;
    if (!GOVERNED_ZONES.has(id)) return true;
    return unlockedZones().indexOf(id) >= 0;
  }
  function buildingUnlocked(type) {
    if (!type) return true;
    if (!GOVERNED_BUILDINGS.has(type)) return true;
    return unlockedBuildings().indexOf(type) >= 0;
  }
  /* Which node opens a thing — the sentence a refusal has to be able to say. */
  function nodeForZone(id) { return NODES.find((n) => (n.zones || []).indexOf(id) >= 0) || null; }
  function nodeForBuilding(t) { return NODES.find((n) => (n.buildings || []).indexOf(t) >= 0) || null; }

  /* ── points ──────────────────────────────────────────────────────────── */
  function earnedPoints() {
    let t = 0;
    for (const m of MILESTONES) if (S.reached.has(m.id)) t += m.pts | 0;
    return t;
  }
  function points() {
    const e = earnedPoints();
    return { earned: e, spent: S.spent, available: Math.max(0, e - S.spent) };
  }

  /* ── the licence question, asked of the host and never guessed ────────── */
  function licenceState(key) {
    if (!key) return null;
    if (typeof ctx.hasLicence !== 'function') {
      return { key, held: null, why: 'the host did not hand over a licence reader (ctx.hasLicence)' };
    }
    const held = ctx.hasLicence(key);
    const label = (typeof ctx.licenceLabel === 'function' ? ctx.licenceLabel(key) : null) || key;
    const price = (typeof ctx.licencePrice === 'function' ? ctx.licencePrice(key) : null);
    if (held == null) return { key, label, price, held: null, why: 'the City Hall operations manifest has not been read yet' };
    return { key, label, price, held: !!held };
  }

  /* ── can this node be unlocked right now, and if not, exactly why ─────── */
  function status(node) {
    if (!node) return null;
    if (has(node.id)) {
      return { state: S.granted.has(node.id) && !S.unlocked.has(node.id) ? 'granted' : 'unlocked', blockers: [] };
    }
    const blockers = [];
    for (const r of (node.req || [])) {
      if (!has(r)) blockers.push({ kind: 'req', id: r, text: 'Requires ' + ((NODE_BY_ID[r] || {}).name || r) });
    }
    const lic = licenceState(node.licence);
    if (lic && lic.held !== true) {
      blockers.push({
        kind: 'licence', id: node.licence, licence: lic,
        text: lic.held === null
          ? 'Licence unreadable — ' + lic.why
          : 'Requires the ' + lic.label + ' licence from City Hall',
      });
    }
    const p = points();
    if (p.available < (node.cost | 0)) {
      blockers.push({ kind: 'points', text: 'Costs ' + (node.cost | 0) + ' development points — you have ' + p.available });
    }
    return { state: blockers.length ? 'locked' : 'available', blockers, licence: lic };
  }

  /* ── unlocking ───────────────────────────────────────────────────────── */
  function unlock(id) {
    const n = NODE_BY_ID[id];
    if (!n) return { ok: false, reason: 'no-such-node' };
    if (has(id)) return { ok: false, reason: 'already' };
    const st = status(n);
    if (st.state !== 'available') return { ok: false, reason: 'blocked', blockers: st.blockers };
    /* Spend LAST, after every refusal, and record it in one place. `spent` is
       the only number in this module that goes up on a player action; it is a
       counter of what was bought, not a balance — `available` is always
       re-derived from the milestones actually passed. There is nothing here to
       overflow and nothing to mint. */
    S.unlocked.add(id);
    S.spent += n.cost | 0;
    fire('change');
    ctx.save && ctx.save();
    return { ok: true, node: n, points: points() };
  }

  /* ── milestones + achievements: the tick ──────────────────────────────── */
  function readMetrics() {
    const out = {};
    for (const k in METRICS) {
      const m = METRICS[k];
      let r;
      try { r = m.read(ctx); } catch (e) { r = { ok: false, why: 'the reader threw: ' + (e && e.message || e) }; }
      out[k] = Object.assign({ id: k, label: m.label, unit: m.unit, source: m.source }, r);
    }
    return out;
  }

  /* The category roll-up, needed by the panel AND by the Specialist
     achievement, so it is computed once here rather than twice. */
  function catRollup() {
    return CATS.map((c) => {
      const ns = NODES.filter((n) => n.cat === c.id);
      return { id: c.id, ico: c.ico, name: c.name, blurb: c.blurb,
               total: ns.length, done: ns.filter((n) => has(n.id)).length };
    });
  }

  function tick() {
    const metrics = readMetrics();
    let changed = false;
    for (const m of MILESTONES) {
      if (S.reached.has(m.id)) continue;
      const v = metrics[m.metric];
      if (!v || !v.ok) continue;                       // unmeasurable ⇒ not passed, not failed
      if (v.value >= m.at) { S.reached.add(m.id); changed = true; onMilestone(m); }
    }
    const view = { metrics, cats: catRollup() };
    for (const a of ACHIEVEMENTS) {
      if (S.earned.has(a.id)) continue;
      let r;
      try { r = a.test(ctx, view); } catch (e) { r = { ok: false, why: 'the trigger threw: ' + (e && e.message || e) }; }
      if (r && r.ok && r.done) { S.earned.add(a.id); changed = true; onAchievementEarned(a); }
    }
    if (changed) { fire('change'); ctx.save && ctx.save(); }
    return { metrics, changed };
  }

  function onMilestone(m) {
    try { ctx.toast && ctx.toast('🏅 Milestone — ' + m.name + '. +' + m.pts + ' development points.', 'good'); } catch (e) {}
    try { ctx.logEvent && ctx.logEvent('city', '🏅 Milestone reached: ' + m.name + ' (+' + m.pts + ' development points).'); } catch (e) {}
  }
  /* 🃏 THE CARD SEAM FIRES HERE AND NOWHERE ELSE — on the EDGE, never on a
     load. See milestones.js for why replaying on load would re-grant a card
     every time the page opens. */
  function onAchievementEarned(a) {
    try { ctx.toast && ctx.toast(a.ico + ' Achievement — ' + a.name + '.', 'good'); } catch (e) {}
    try { ctx.logEvent && ctx.logEvent('city', a.ico + ' Achievement earned: ' + a.name + '.'); } catch (e) {}
    fire('achievement', { id: a.id, name: a.name, desc: a.desc, reward: a.reward || null });
  }

  function on(evt, fn) {
    if (!listeners[evt] || typeof fn !== 'function') return false;
    listeners[evt].push(fn); return true;
  }
  function fire(evt, arg) {
    for (const fn of (listeners[evt] || [])) { try { fn(arg); } catch (e) { console.warn('[Progress] listener', evt, e); } }
  }

  /* ══ ADOPTION — defence (2) and (3) of the retro-lock guard ════════════ */
  function adopt(why) {
    let added = 0;
    /* a) zones already painted on the map. `ctx.zones()` is the LIVE
          game.zones object, not a copy this module keeps — the map is the
          authority (see the header). */
    const seenZones = new Set();
    try {
      const z = (typeof ctx.zones === 'function') ? ctx.zones() : null;
      if (z && typeof z === 'object') for (const k in z) if (z[k]) seenZones.add(z[k]);
    } catch (e) {}
    /* b) buildings already standing.
       🔴 LEGACY CITIES ONLY, AND THIS IS THE ONE ASYMMETRY WORTH EXPLAINING.
          Zones ARE gated (the wrapper in index.js), so a zone on the map can
          only have come from an unlocked node — adopting it back is pure
          belt-and-braces and is safe on any city. Buildings are NOT gated
          today. On a city that started with progression, granting a node
          because a building of that type is standing would hand out free nodes
          for buildings nothing ever refused — a player plants a garden and
          collects Parks & Recreation. So the building evidence counts only
          where it is actually evidence: a save that predates this feature. */
    const seenTypes = new Set();
    if (S.legacy) {
      try {
        const t = (typeof ctx.tileTypes === 'function') ? ctx.tileTypes() : null;
        if (Array.isArray(t)) for (const ty of t) seenTypes.add(ty);
      } catch (e) {}
    }

    for (const n of NODES) {
      if (has(n.id)) continue;
      let owed = false;
      for (const z of (n.zones || [])) if (seenZones.has(z)) owed = true;
      for (const b of (n.buildings || [])) if (seenTypes.has(b)) owed = true;
      /* c) a licence the player already holds. Only for LEGACY cities: on a
            city that started with this feature, holding the licence is a
            PREREQUISITE, not an entitlement — you still spend the points. */
      if (!owed && S.legacy && n.licence) {
        const l = licenceState(n.licence);
        if (l && l.held === true) owed = true;
      }
      if (!owed) continue;
      /* Grant its prerequisites too, or the panel shows an unlocked node
         hanging off a locked one and the tree reads as broken. */
      grantWithReq(n.id);
      added++;
    }
    S.adoptedAt = Date.now();
    if (added) {
      try { console.info('[Progress] adopted ' + added + ' node(s) the city already had (' + (why || 'adopt') + ')'); } catch (e) {}
      fire('change');
      ctx.save && ctx.save();
    }
    return added;
  }
  function grantWithReq(id, depth) {
    if ((depth | 0) > 32) return;                      // cycles are impossible (validate()) — this is belt and braces
    const n = NODE_BY_ID[id];
    if (!n || has(id)) return;
    S.granted.add(id);
    for (const r of (n.req || [])) grantWithReq(r, (depth | 0) + 1);
  }

  /* ══ SAVE / LOAD ══════════════════════════════════════════════════════ */
  function save() {
    return {
      v: SAVE_V,
      u: Array.from(S.unlocked),
      g: Array.from(S.granted).filter((id) => AUTO_NODES.indexOf(id) < 0),
      m: Array.from(S.reached),
      a: Array.from(S.earned),
      s: S.spent | 0,
    };
  }
  /* Every field optional-with-a-default, per the shelf's contract. `p`
     absent — which is EVERY save written before this shipped — sets `legacy`
     and is what arms adoption. */
  function load(p) {
    S.loaded = true;
    if (!p || typeof p !== 'object') { S.legacy = true; return { legacy: true }; }
    S.legacy = false;
    const take = (arr, into) => { if (Array.isArray(arr)) for (const x of arr) if (typeof x === 'string' && NODE_BY_ID[x]) into.add(x); };
    S.unlocked.clear(); S.granted.clear(); S.reached.clear(); S.earned.clear();
    for (const id of AUTO_NODES) S.granted.add(id);
    take(p.u, S.unlocked); take(p.g, S.granted);
    if (Array.isArray(p.m)) for (const x of p.m) if (MILESTONES.some((m) => m.id === x)) S.reached.add(x);
    if (Array.isArray(p.a)) for (const x of p.a) if (ACHIEVEMENTS.some((a) => a.id === x)) S.earned.add(x);
    S.spent = Math.max(0, Math.round(+p.s || 0));
    /* 🔴 A CORRUPT OR OUT-OF-DATE SPEND MUST NEVER LOCK A NODE THE PLAYER HAS.
       If the recorded spend is larger than what the unlocked nodes actually
       cost — a retuned cost, a hand-edited save, a dropped field — re-derive
       it from the nodes themselves. The nodes are the truth; the counter is a
       convenience. Erring the other way would make a player's available
       points go negative and their tree freeze. */
    let real = 0;
    for (const id of S.unlocked) real += (NODE_BY_ID[id] || {}).cost | 0;
    if (S.spent !== real) {
      try { console.info('[Progress] spend counter ' + S.spent + ' re-derived from unlocked nodes as ' + real); } catch (e) {}
      S.spent = real;
    }
    return { legacy: false, unlocked: S.unlocked.size, reached: S.reached.size };
  }

  return {
    S, has, unlock, status, points, earnedPoints,
    unlockedZones, unlockedBuildings, zoneUnlocked, buildingUnlocked,
    nodeForZone, nodeForBuilding, licenceState,
    readMetrics, catRollup, tick, adopt, on, fire,
    save, load,
  };
}
