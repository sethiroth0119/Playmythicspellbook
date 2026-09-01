/* ══════════════════════════════════════════════════════════════════════════
   👷 THE WORK CREW — the city half of work suitability.
   ──────────────────────────────────────────────────────────────────────────
   Units are enlisted onto a crew (beds cap it) and then POSTED, by the player,
   to a specific building. What a post is worth is decided by the unit's
   suitability for THAT building's trade, its level, its passives and its
   condition — so the interesting question is never "do I have enough units", it
   is "my one Lv 4 Kindling hand: Smelting Works, or Power Station?"

   🔴 ASSIGNMENT IS THE PLAYER'S, NOT THE SOLVER'S — and that is a reversal of
   how this shipped a round ago. The first version matched the whole crew to the
   whole city automatically, greedily, on every change. It worked, and it was
   boring: a city with enough units played itself, and the only decision left was
   how many units to enlist. Handing the matching back to the player turns three
   flat facts (a unit's trades, a building's trade, the bed cap) into a real
   allocation problem with scarcity on both sides.

   What survives from the automatic version is `autoFill()`, and it is
   deliberately weak: it fills EMPTY posts with UNPOSTED units and never moves
   anybody the player placed. It is a first-turn convenience and a way to mop up
   after building six things at once, not a solver — it is greedy, it cannot see
   which resource the player is actually short of, and a player who cares will
   beat it. That is the intended relationship.

   What this file owns:
     · the roster and its cap (beds — see crewCap)
     · the posts, and the rules about what may be posted where
     · upkeep: rations in, CONDITION out
     · the crew panel, the crew dialog and both assignment pickers
   What it does NOT own: the rules. Suitabilities, passives, levels, the
   arithmetic and the ×2.00 ceiling are all /src/work/work.js, which index.html
   also imports so the game and the city can never disagree about a unit.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `CARDS`, `cardById`
   and `MythicCityBridge` are top-level `const` inside node-city/index.html's
   module script. They are NOT on window. Every one arrives in the `ctx` object
   the host builds by hand; nothing here may reach for a bare global, and a
   missing ctx field must degrade rather than throw.
   ══════════════════════════════════════════════════════════════════════════ */
import * as W from './work.js';
/* Re-exported so a caller holding only this module's namespace (a test, a
   console probe) can reach the rules without a second import. The city itself
   uses the object mount() returns, which carries the same reference. */
export * as work from './work.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let CTX = null;
let OPEN = false;            // is the manage dialog up

/* ── Capacity: BEDS, not a flat number ────────────────────────────────────
   A crew has to sleep somewhere, so the roster cap is bought with the two
   buildings that already mean "beds" in this city rather than with a new
   currency or a new structure. That makes the first real decision of the
   system a CITY decision — Housing you were going to build anyway now also
   buys you another pair of hands — instead of a menu the player unlocks.
   CREW_MAX is a hard stop so the assignment pass, which is O(crew × jobs),
   cannot be driven somewhere pathological by a player with fifty Housings. */
export const CREW_BASE = 3;
export const CREW_PER_HOUSING = 2;
export const CREW_PER_RESTHOUSE = 2;
export const CREW_MAX = 20;

/* ⏱ UPKEEP. A crew member eats rations, and falls back to raw food at the
   city's existing RAW_FALLBACK_MULT penalty exactly like a kitchen does —
   the host passes its own svcDraw in, so there is one feeding rule in the
   city and this is not a second one.
   0.10/min against a Restaurant's 0.80 and a Cannery's 2.60 output: a crew of
   four is about half a Restaurant's draw. Real, payable early, and it means a
   big crew is a commitment rather than a free upgrade. */
export const CREW_EAT_PER_MIN = 0.10;
const COND_FALL_PER_MIN = 3.0;   // toward the fed fraction, × the unit's condWear
const COND_RISE_PER_MIN = 4.0;   // recovery is faster than decay, on purpose:
                                 // a shortage the player has FIXED should stop
                                 // punishing them within a minute or two, or the
                                 // fix reads as having done nothing.

function G() { return (CTX && CTX.game) || { tiles: {} }; }
function defOf(type) { return (CTX && CTX.BUILDINGS && CTX.BUILDINGS[type]) || null; }
function salt() { try { return (CTX.salt && CTX.salt()) || ''; } catch (e) { return ''; } }
function night() { try { return !!(CTX.isNight && CTX.isNight()); } catch (e) { return false; } }
function cardOf(id) { try { return (CTX.cardById && CTX.cardById(id)) || null; } catch (e) { return null; } }

/* ── State, absent-tolerant ───────────────────────────────────────────────
   🔴 EVERY FIELD DEFAULTED, NO SHAPE ASSUMED. This project has shipped silent
   save bugs three times (see production.state.js's ensureState). A save written
   before the crew existed must load as "no crew", never as a throw, and a roster
   row whose card has since been sold, consumed or traded away must be dropped
   here rather than rendered as `undefined` in the panel. */
export function state() {
  const g = G();
  if (!Array.isArray(g.crew)) g.crew = [];
  g.crew = g.crew.filter(m => m && typeof m === 'object' && m.card);
  for (const m of g.crew) {
    if (typeof m.cond !== 'number' || !isFinite(m.cond)) m.cond = W.WORK.COND_MAX;
    m.cond = Math.max(0, Math.min(W.WORK.COND_MAX, m.cond));
    // `post` is a tile key or null. Never trusted on load — validate() is what
    // decides whether the tile it names still exists and still wants work.
    if (typeof m.post !== 'string' || !m.post) m.post = null;
  }
  return g.crew;
}
export function crewIds() { return new Set(state().map(m => m.card)); }
export function count() { return state().length; }

export function crewCap() {
  let cap = CREW_BASE;
  for (const t of Object.values(G().tiles || {})) {
    if (!t || t.damaged) continue;
    if (t.type === 'housing')   cap += CREW_PER_HOUSING * (t.lvl || 1);
    if (t.type === 'resthouse') cap += CREW_PER_RESTHOUSE * (t.lvl || 1);
  }
  return Math.min(CREW_MAX, cap);
}
export function capParts() {
  let housing = 0, rest = 0;
  for (const t of Object.values(G().tiles || {})) {
    if (!t || t.damaged) continue;
    if (t.type === 'housing')   housing += CREW_PER_HOUSING * (t.lvl || 1);
    if (t.type === 'resthouse') rest    += CREW_PER_RESTHOUSE * (t.lvl || 1);
  }
  return { base: CREW_BASE, housing, rest, cap: crewCap(), capped: CREW_BASE + housing + rest > CREW_MAX };
}

export function profileOf(id) {
  const c = cardOf(id);
  if (!c) return null;
  return W.profileFor(c, salt());
}
function memberOf(id) { return state().find(m => m.card === id) || null; }

/* ── POSTS ────────────────────────────────────────────────────────────────
   One crew member, one building. A building offers `def.crew` posts (min 1) —
   reusing the building's OWN crew figure is the whole reason a Farm takes two
   hands and a Gas Station one without a second table to keep in step with the
   first.

   🔴 A UNIT MAY ONLY BE POSTED WHERE IT CAN ACTUALLY WORK. Letting the player
   put a Lv 4 miner in a Restaurant "for zero" is not freedom, it is a trap: the
   post looks filled, the building looks staffed, and the output does not move.
   post() refuses it and says why, and the pickers show unsuitable units greyed
   with the reason rather than hiding them — "why can't I use this one" has to
   be answerable from the screen where the question occurs.

   ⚠ EVERY READ GOES THROUGH validate() FIRST. A post is a reference to a tile,
     and tiles are demolished, replaced and damaged behind its back. An unchecked
     post survives as a worker standing in a building that no longer exists,
     occupying a slot nothing can free. */
let _multCache = null;       // tileKey -> mult, invalidated once per tick

export function slotsAt(k) {
  const t = G().tiles[k]; if (!t) return 0;
  const def = defOf(t.type); if (!def) return 0;
  if (!W.workNeeds(t.type).length) return 0;
  // A building the tick does not multiply cannot use a crew, whatever the work
  // table says. work.js's auditBuildings warns about the mismatch at mount;
  // this is the belt to that braces.
  if (!def.gen && !def.svc) return 0;
  return Math.max(1, def.crew | 0);
}
export function takesWork(k) { return slotsAt(k) > 0; }
export function postsAt(k) { return state().filter(m => m.post === k).map(m => m.card); }
export function freeSlotsAt(k) { return Math.max(0, slotsAt(k) - postsAt(k).length); }
export function postOf(cardId) { const m = memberOf(cardId); return m ? m.post : null; }
/** Crew with no post. Surfaced loudly — an idle unit is a decision not yet made. */
export function idleIds() { return state().filter(m => !m.post).map(m => m.card); }

/** Can this unit work that building, and what at? {ok, why, work, level} */
export function canWorkAt(cardId, k) {
  const t = G().tiles[k];
  if (!t) return { ok: false, why: 'That building is gone.' };
  const def = defOf(t.type);
  if (!takesWork(k)) return { ok: false, why: (def ? def.name : 'This building') + ' has no work a crew can do.' };
  if (t.damaged) return { ok: false, why: 'Damaged — repair it before posting anyone.' };
  /* 🔴 THE HOST'S VETO, asked before anything about the unit. The city knows
     states this module must never learn — a foundation pad with nothing
     standing on it yet is the first, and there will be others. Asking rather
     than re-deriving is the same rule `postWarning` follows: coverage, build
     phases and the vitals clamp are city internals, and a copy of them in here
     is a copy that goes stale the round after somebody adds a third state. */
  try {
    const veto = CTX.postBlocked && CTX.postBlocked(k);
    if (veto) return { ok: false, why: veto };
  } catch (e) {}
  const prof = profileOf(cardId);
  if (!prof) return { ok: false, why: 'Not in your collection.' };
  const best = W.bestWorkAt(prof, t.type);
  if (!best) {
    const needs = W.workNeeds(t.type).map(x => { const w = W.getWork(x); return w ? w.name : x; }).join(' or ');
    return { ok: false, why: 'No ' + needs + ' suitability.' };
  }
  return { ok: true, work: best.type, level: best.level };
}

/* Post a unit. Moving one that is already posted is a post to the new tile —
   no recall step, because "recall then post" is two clicks for one decision. */
export function post(cardId, k) {
  const m = memberOf(cardId);
  if (!m) return 'That unit is not on the work crew.';
  if (m.post === k) return null;
  const chk = canWorkAt(cardId, k);
  if (!chk.ok) return chk.why;
  if (freeSlotsAt(k) <= 0) {
    const def = defOf((G().tiles[k] || {}).type);
    const n = slotsAt(k);
    return (def ? def.name : 'That building') + ' is fully staffed (' + n + ' post' + (n === 1 ? '' : 's') + '). Recall someone first.';
  }
  m.post = k;
  invalidate();
  return null;
}
export function unpost(cardId) {
  const m = memberOf(cardId);
  if (!m || !m.post) return false;
  m.post = null;
  invalidate();
  return true;
}

/* ── VALIDATE ─────────────────────────────────────────────────────────────
   Run on every structural change (the host hangs it off computeLinks, which
   already fires on place / demolish / repair / failure). Clears posts that have
   become impossible and REPORTS them, because a worker who quietly stopped
   working is indistinguishable from a bug — the host toasts the list. */
export function validate() {
  const cleared = [];
  const seen = {};
  for (const m of state()) {
    if (!m.post) continue;
    const chk = canWorkAt(m.card, m.post);
    let why = chk.ok ? null : chk.why;
    if (!why) {
      // Over-capacity can only happen when a building is DOWNGRADED or replaced
      // under standing posts; the last ones in are the ones that lose the post.
      const n = (seen[m.post] = (seen[m.post] | 0) + 1);
      if (n > slotsAt(m.post)) why = 'There is no longer a post free there.';
    }
    if (why) { cleared.push({ card: m.card, name: (cardOf(m.card) || {}).name || m.card, why }); m.post = null; }
  }
  invalidate();
  return cleared;
}

/* ── AUTO-FILL ────────────────────────────────────────────────────────────
   The old automatic matcher, kept on a short leash. It places UNPOSTED units
   into EMPTY posts, greedily, best pair first — and it never touches a unit the
   player posted or a post the player filled. That boundary is the whole design:
   the convenience exists so a fresh city and a six-building spree do not cost
   twenty dialogs, and it must never quietly undo a decision.

   It is also, deliberately, not very good. It optimises one number (total
   contribution) and cannot see which resource the city is actually short of, so
   a player who is paying attention will beat it. That is the intended
   relationship between the button and the game. */
export function autoFill() {
  const crew = state();
  const free = crew.filter(m => !m.post).map(m => m.card);
  if (!free.length) return 0;
  const open = Object.keys(G().tiles || {}).filter(k => freeSlotsAt(k) > 0);
  if (!open.length) return 0;
  const room = {}; for (const k of open) room[k] = freeSlotsAt(k);
  const taken = new Set();
  let placed = 0;
  while (true) {
    let best = null;
    for (const id of free) {
      if (taken.has(id)) continue;
      const prof = profileOf(id); if (!prof) continue;
      const m = memberOf(id);
      for (const k in room) {
        if (room[k] <= 0) continue;
        const t = G().tiles[k]; if (!t || t.damaged) continue;
        const p = W.workPower(null, prof, t.type, { night: night(), condition: m ? m.cond : 100 });
        if (p.power <= 0) continue;
        // Ties break on roster order, which is enlist order, which is stable —
        // so the same city always auto-fills the same way and the button is not
        // a source of churn.
        if (!best || p.power > best.power + 1e-12) best = { id, k, power: p.power };
      }
    }
    if (!best) break;
    taken.add(best.id); room[best.k]--; memberOf(best.id).post = best.k; placed++;
  }
  invalidate();
  return placed;
}

/* ── Suggestions, for the two pickers ─────────────────────────────────────
   Both return everything the UI needs to explain a choice, INCLUDING the
   options that are refused: a picker that silently omits a unit leaves the
   player wondering where it went. */

/** Every crew member scored for one building. Best first, blocked ones last. */
export function candidatesFor(k) {
  const t = G().tiles[k];
  const out = [];
  for (const m of state()) {
    const prof = profileOf(m.card); if (!prof) continue;
    const chk = canWorkAt(m.card, k);
    const p = (chk.ok && t) ? W.workPower(null, prof, t.type, { night: night(), condition: m.cond }) : null;
    out.push({
      card: m.card, name: (cardOf(m.card) || {}).name || m.card, profile: prof,
      cond: m.cond, here: m.post === k, postedAt: m.post,
      ok: chk.ok, why: chk.why || '', power: p ? p.power : 0, work: p ? p.work : null, suit: p ? p.suit : 0,
      speed: p ? p.speed : 1,
    });
  }
  return out.sort((a, b) => (b.ok - a.ok) || (b.power - a.power));
}

/** Every building scored for one unit. Best first, full/blocked ones last. */
export function postsFor(cardId) {
  const prof = profileOf(cardId);
  const m = memberOf(cardId);
  const out = [];
  for (const k of Object.keys(G().tiles || {})) {
    if (!takesWork(k)) continue;
    const t = G().tiles[k], def = defOf(t.type);
    const chk = canWorkAt(cardId, k);
    const p = (chk.ok && prof) ? W.workPower(null, prof, t.type, { night: night(), condition: m ? m.cond : 100 }) : null;
    const full = freeSlotsAt(k) <= 0 && m && m.post !== k;
    out.push({
      key: k, name: def ? def.name : t.type, ico: def ? def.ico : '🏭',
      here: m && m.post === k, full, ok: chk.ok && !full, why: full ? 'Fully staffed' : (chk.why || ''),
      slots: slotsAt(k), used: postsAt(k).length,
      power: p ? p.power : 0, work: p ? p.work : null, suit: p ? p.suit : 0,
    });
  }
  return out.sort((a, b) => (b.ok - a.ok) || (b.power - a.power));
}

/** Which cards are working this tile. */
export function workersAt(k) { return postsAt(k); }
/** Where one card is posted, or null. */
export function jobOf(id) { return postOf(id); }

/** Every worker's contribution at this tile, decomposed for the UI. */
export function powersAt(k) {
  const t = G().tiles[k]; if (!t) return [];
  const out = [];
  for (const id of postsAt(k)) {
    const prof = profileOf(id); if (!prof) continue;
    const m = memberOf(id);
    const p = W.workPower(null, prof, t.type, { night: night(), condition: m ? m.cond : 100 });
    p.card = id; p.name = (cardOf(id) || {}).name || id; p.cond = m ? m.cond : 100;
    p.condMul = W.condMul(m ? m.cond : 100);
    p.profile = prof;
    out.push(p);
  }
  return out;
}

/* The multiplier the tick applies. Memoised per tick because tileMult() is
   called for every tile from three places (the power pre-pass, the main pass
   and cityDemandScale) and this would otherwise re-roll every worker's maths
   three times per building per second. Invalidated by upkeep() — the only thing
   that moves condition — and by every post change. */
export function multAt(k) {
  if (!_multCache) _multCache = {};
  if (k in _multCache) return _multCache[k];
  const ps = powersAt(k);
  const m = ps.length ? W.multFrom(ps) : 1;
  _multCache[k] = m;
  return m;
}
export function invalidate() { _multCache = null; }

/* ── UPKEEP ───────────────────────────────────────────────────────────────
   Called from inside economyTick with the host's own `svcDraw`, so the crew
   eats through the SAME rations-then-raw-food path a kitchen does. Passing the
   closure in rather than re-implementing it is what stops this becoming a
   second, divergent feeding rule the next time somebody retunes the fallback.

   Condition drifts toward the fraction of its ration the crew actually got:
   fully fed → climbs to 100, half fed → settles near 50, unfed → falls to 0 and
   the crew works at COND_FLOOR. See work.js on why that floor is not zero. */
export function upkeep(dtMin, svcDraw) {
  const crew = state();
  _multCache = null;
  if (!crew.length || !(dtMin > 0)) return { fed: 1, want: 0, members: 0 };
  let want = 0;
  for (const m of crew) {
    const prof = profileOf(m.card);
    want += CREW_EAT_PER_MIN * (prof ? W.appetiteMul(prof) : 1) * dtMin;
  }
  let fed = 1;
  try { fed = (typeof svcDraw === 'function') ? svcDraw('rations', want) : 1; } catch (e) { fed = 1; }
  if (!(fed >= 0)) fed = 0;
  const target = Math.max(0, Math.min(1, fed)) * W.WORK.COND_MAX;
  for (const m of crew) {
    const prof = profileOf(m.card);
    if (m.cond > target) {
      m.cond = Math.max(target, m.cond - COND_FALL_PER_MIN * (prof ? W.condWearMul(prof) : 1) * dtMin);
    } else if (m.cond < target) {
      m.cond = Math.min(target, m.cond + COND_RISE_PER_MIN * dtMin);
    }
  }
  return { fed, want, members: crew.length };
}
/** Rations the crew wants per minute, for the panel. */
export function demandPerMin() {
  let want = 0;
  for (const m of state()) {
    const prof = profileOf(m.card);
    want += CREW_EAT_PER_MIN * (prof ? W.appetiteMul(prof) : 1);
  }
  return want;
}
export function avgCondition() {
  const c = state(); if (!c.length) return W.WORK.COND_MAX;
  return c.reduce((a, m) => a + m.cond, 0) / c.length;
}

/* ── Roster changes ──────────────────────────────────────────────────────
   🔴 ENLISTING NO LONGER PUTS ANYONE TO WORK. A new crew member arrives IDLE
   and stays idle until the player posts it, which is the point of the rework:
   the interesting act is the posting, so enlisting must not silently perform
   it. The dialog says so and offers Auto-fill for anyone who does not want to
   place this one by hand. */
export function enlist(cardId) {
  const crew = state();
  if (!cardId || crew.some(m => m.card === cardId)) return 'Already on the work crew.';
  if (crew.length >= crewCap()) return 'No beds left — build Housing or a Resting House.';
  crew.push({ card: cardId, cond: W.WORK.COND_MAX, post: null });
  invalidate();
  return null;
}
export function dismiss(cardId) {
  const crew = state();
  const i = crew.findIndex(m => m.card === cardId);
  if (i < 0) return false;
  crew.splice(i, 1);
  invalidate();
  return true;
}
/* 🔴 A CARD THAT LEAVES THE COLLECTION MUST LEAVE THE CREW. Sold, traded or
   consumed cards are removed by the host on the next card refresh; without this
   the roster keeps a ghost that occupies a bed and a post forever, and the panel
   renders its raw id. Returns how many were dropped. */
export function reconcile() {
  const crew = state();
  const before = crew.length;
  const alive = new Set((CTX && CTX.cards ? CTX.cards() : []).map(c => c && c.id).filter(Boolean));
  const kept = crew.filter(m => alive.has(m.card));
  if (kept.length !== before) { G().crew = kept; invalidate(); }
  return before - kept.length;
}

/* ── Persistence ──────────────────────────────────────────────────────────
   The POST and the CONDITION both ride the save, and both must.
   · The post IS the player's decision. Recomputing it on load — even with
     autoFill, which would look identical on a simple city — would silently
     overwrite a deliberate allocation with a greedy one every time they came
     back, which is the single worst thing this feature could do.
   · Condition is the one piece of crew state the city cannot recompute: "this
     unit has been on short rations for an hour" is not derivable from the
     tiles, and dropping it would hand every returning player a perfectly rested
     crew regardless of the city they left behind. */
export function save() {
  return state().map(m => ({ c: m.card, k: Math.round(m.cond), p: m.post || null }));
}
export function load(raw) {
  const g = G();
  g.crew = Array.isArray(raw)
    ? raw.filter(r => r && r.c).slice(0, CREW_MAX).map(r => ({
        card: String(r.c),
        cond: Math.max(0, Math.min(W.WORK.COND_MAX, Number(r.k) == null ? W.WORK.COND_MAX : Number(r.k))),
        post: (typeof r.p === 'string' && r.p) ? r.p : null,
      }))
    : [];
  state();
  // validate(), not autoFill(): a post whose building is gone is dropped, and
  // nothing else is touched. The host reports whatever came back.
  return validate();
}

/* ══ UI ═══════════════════════════════════════════════════════════════════
   Three surfaces, and they exist because assignment is now a decision:
     · the LEFT-COLUMN PANEL — who is posted where, and how many are idle.
     · the CREW DIALOG — the roster, with Post / Move / Recall on every row.
     · the two PICKERS — "who works here" (opened from a building) and "where
       does this one work" (opened from a crew row). Both are the same decision
       from opposite ends, and a player will want each at different moments:
       one when they have just built something, the other when they have just
       pulled a good card.
   Both pickers show REFUSED options with the reason rather than hiding them.
   "Why can't I use this unit here" has to be answerable on the screen where the
   question occurs, or the rule is folklore. */
const CSS = `
#crewbody .ccap{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;
  color:var(--mist);margin-bottom:6px;}
#crewbody .ccap b{color:var(--gold);font-size:12.5px;}
#crewbody .cm{display:flex;flex-direction:column;gap:2px;padding:5px 0;
  border-top:1px solid rgba(255,255,255,.06);}
#crewbody .cm:first-of-type{border-top:none;}
#crewbody .cmtop{display:flex;justify-content:space-between;gap:6px;font-size:11.5px;color:var(--bone);}
#crewbody .cmjob{font-size:10px;color:var(--gold);}
#crewbody .cmjob.idle{color:#e0a85f;}
#crewbody .cmsuit{font-size:10px;color:var(--mist);}
#crewbody .cbar{height:4px;background:rgba(255,255,255,.10);border-radius:2px;overflow:hidden;margin-top:2px;}
#crewbody .cbar i{display:block;height:100%;background:#7ad68c;}
#crewbody .cbar.low i{background:#e0a85f;} #crewbody .cbar.crit i{background:#e08a80;}
#crewbody .cempty{font-size:11px;color:var(--mist);line-height:1.45;padding:4px 0 6px;}
#crewbody .cidle{font-size:10.5px;color:#e0a85f;margin-top:6px;}
#crewbody .cfoot{font-size:10px;color:var(--mist);margin-top:6px;line-height:1.4;}

#crewmod{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  background:rgba(8,6,12,.78);backdrop-filter:blur(3px);}
#crewmod .cbox{width:min(600px,94vw);max-height:86vh;overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:12px;padding:16px 18px;}
#crewmod h3{font-size:13px;color:var(--gold);margin-bottom:4px;}
#crewmod .csub{font-size:11px;color:var(--mist);line-height:1.5;margin-bottom:10px;}
#crewmod .cstat{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--mist);
  border:1px solid var(--edge);border-radius:8px;padding:7px 10px;margin-bottom:10px;}
#crewmod .cstat b{color:var(--bone);}
#crewmod .cstat .warn{color:#e0a85f;}
#crewmod .row{border:1px solid var(--edge);border-radius:9px;padding:8px 10px;margin-bottom:6px;}
#crewmod .row.idle{border-color:rgba(224,168,95,.5);background:rgba(224,168,95,.05);}
#crewmod .rtop{display:flex;justify-content:space-between;align-items:center;gap:8px;}
#crewmod .rn{font-size:12.5px;color:var(--bone);}
#crewmod .rlv{font-size:10px;color:var(--mist);}
#crewmod .racts{display:flex;gap:5px;flex:0 0 auto;}
#crewmod .rjob{font-size:10.5px;color:var(--gold);margin-top:3px;}
#crewmod .rjob.idle{color:#e0a85f;}
#crewmod .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;}
#crewmod .chip{font-size:10px;border:1px solid var(--edge);border-radius:5px;padding:1px 6px;color:var(--bone);}
#crewmod .chip.suit{border-color:rgba(212,175,55,.5);color:#e8d49a;}
#crewmod .chip.good{border-color:rgba(122,214,140,.5);color:#7ad68c;}
#crewmod .chip.bad{border-color:rgba(224,138,128,.5);color:#e08a80;}
#crewmod .cbar2{height:5px;background:rgba(255,255,255,.10);border-radius:3px;overflow:hidden;margin-top:6px;}
#crewmod .cbar2 i{display:block;height:100%;background:#7ad68c;}
#crewmod .cbar2.low i{background:#e0a85f;} #crewmod .cbar2.crit i{background:#e08a80;}
#crewmod .cbtn{background:#1a1530;border:1px solid var(--edge);border-radius:6px;color:var(--bone);
  font-size:10.5px;padding:3px 9px;cursor:pointer;white-space:nowrap;}
#crewmod .cbtn:hover:not(:disabled){border-color:var(--gold);}
#crewmod .cbtn.on{border-color:rgba(212,175,55,.75);color:var(--gold);}
#crewmod .cbtn:disabled{opacity:.4;cursor:default;}
#crewmod .cfoot2{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
#crewmod .cfoot2 .pbtn{margin-top:0;flex:1 1 30%;}
#crewmod .cnote{font-size:10.5px;color:var(--mist);margin-top:9px;line-height:1.45;}

#crewpick{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
  background:rgba(8,6,12,.8);backdrop-filter:blur(3px);}
#crewpick .pbox{width:min(520px,94vw);max-height:84vh;overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:12px;padding:15px 17px;}
#crewpick h3{font-size:12.5px;color:var(--gold);margin-bottom:3px;}
#crewpick .psub{font-size:10.5px;color:var(--mist);line-height:1.5;margin-bottom:9px;}
#crewpick .opt{display:block;width:100%;text-align:left;background:#120e1c;border:1px solid var(--edge);
  border-radius:8px;padding:8px 10px;margin-bottom:5px;color:var(--bone);cursor:pointer;}
#crewpick .opt:hover:not(:disabled){border-color:var(--gold);}
#crewpick .opt.good{border-color:rgba(122,214,140,.5);}
#crewpick .opt.here{border-color:rgba(212,175,55,.8);background:#1a1530;}
#crewpick .opt:disabled{opacity:.45;cursor:default;}
#crewpick .on1{display:flex;justify-content:space-between;gap:8px;font-size:12px;}
#crewpick .ogain{color:#7ad68c;font-variant-numeric:tabular-nums;}
#crewpick .ogain.nil{color:#e08a80;}
#crewpick .o2{display:block;font-size:10px;color:var(--mist);margin-top:2px;}
#crewpick .pwarn{font-size:10.5px;line-height:1.5;color:#e0a85f;border:1px solid rgba(224,168,95,.45);
  background:rgba(224,168,95,.08);border-radius:8px;padding:7px 9px;margin-bottom:9px;}
#crewpick .pfoot{display:flex;gap:8px;margin-top:10px;}
#crewpick .pfoot .pbtn{margin-top:0;flex:1;}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  try { const s = document.createElement('style'); s.id = 'crew-css'; s.textContent = CSS; document.head.appendChild(s); } catch (e) {}
}

function condClass(c) { return c < 30 ? ' crit' : c < 65 ? ' low' : ''; }
function tileName(k) {
  const t = G().tiles[k]; const def = defOf(t && t.type);
  return def ? def.ico + ' ' + def.name : (k || '—');
}
function jobLabel(id) {
  const k = postOf(id);
  if (!k) return { txt: 'Idle — not posted anywhere', idle: true };
  const t = G().tiles[k];
  const prof = profileOf(id);
  const best = prof && t && W.bestWorkAt(prof, t.type);
  const w = best && W.getWork(best.type);
  return { txt: tileName(k) + (w ? ' · ' + w.icon + ' ' + w.name + ' ' + best.level : ''), idle: false, key: k };
}
function suitChips(prof) {
  return (prof.suits || []).map(s => {
    const w = W.getWork(s.type);
    return '<span class="chip suit">' + (w ? w.icon + ' ' + esc(w.name) : esc(s.type)) + ' ' + s.level + '</span>';
  }).join('');
}
function passiveChips(prof) {
  return (prof.passives || []).map(p =>
    '<span class="chip ' + (p.good ? 'good' : 'bad') + '" title="' + esc(p.desc) + '">' + p.icon + ' ' + esc(p.name) + '</span>').join('');
}

/** The left-column card. Small, and only what a player needs at a glance. */
export function renderPanel() {
  const el = document.getElementById('crewbody');
  if (!el || !CTX) return;
  const crew = state(), cap = crewCap(), idle = idleIds().length;
  let h = '<div class="ccap"><span>👷 On the work crew</span><span><b>' + crew.length + '</b> / ' + cap + ' beds</span></div>';
  if (!crew.length) {
    h += '<div class="cempty">Nobody is on the work crew yet. Enlist units, then <b>post each one to a building</b> — a unit only helps the building you put it in, and only if it has the trade that building needs.</div>';
  } else {
    for (const m of crew.slice(0, 6)) {
      const c = cardOf(m.card), prof = profileOf(m.card);
      const j = jobLabel(m.card);
      h += '<div class="cm">' +
        '<div class="cmtop"><span>' + esc(c ? c.name : m.card) + '</span><span class="cmsuit">' + Math.round(m.cond) + '%</span></div>' +
        '<div class="cmjob' + (j.idle ? ' idle' : '') + '">' + (j.idle ? '💤 ' : '🏭 ') + esc(j.txt) + '</div>' +
        (prof ? '<div class="cmsuit">' + esc(W.suitsLabel(prof)) + '</div>' : '') +
        '<div class="cbar' + condClass(m.cond) + '"><i style="width:' + Math.round(m.cond) + '%"></i></div>' +
        '</div>';
    }
    if (crew.length > 6) h += '<div class="cfoot">…and ' + (crew.length - 6) + ' more.</div>';
    // 🔴 IDLE IS THE ONE THING THIS PANEL SHOUTS ABOUT. An unposted unit is a
    //    decision the player has not made and a bed they are paying rations for;
    //    it is the only state here that is always worth acting on.
    if (idle) h += '<div class="cidle">💤 <b>' + idle + '</b> idle — ' + (idle === 1 ? 'it is' : 'they are') + ' eating and doing nothing.</div>';
    h += '<div class="cfoot">🍱 Eats <b>' + demandPerMin().toFixed(2) + '</b> rations/min. Short rations lower Condition, and a worn work crew works slower.</div>';
  }
  h += '<button class="hbtn ember" id="crew-open" style="width:100%;margin-top:8px">👷 Manage work crew</button>';
  el.innerHTML = h;
  const b = document.getElementById('crew-open');
  if (b) b.onclick = () => open();
}

function dialogHtml() {
  const crew = state(), cap = crewCap(), parts = capParts(), idle = idleIds().length;
  const rows = crew.map(m => {
    const c = cardOf(m.card), prof = profileOf(m.card);
    if (!prof) return '';
    const j = jobLabel(m.card);
    const p = j.key ? powersAt(j.key).find(x => x.card === m.card) : null;
    return '<div class="row' + (j.idle ? ' idle' : '') + '">' +
      '<div class="rtop"><span class="rn">' + esc(c ? c.name : m.card) +
        ' <span class="rlv">Lv ' + prof.level + (c && c.element ? ' · ' + esc(c.element) : '') + '</span></span>' +
        '<span class="racts">' +
          '<button class="cbtn' + (j.idle ? ' on' : '') + '" data-crew-post="' + esc(m.card) + '">' + (j.idle ? '📍 Post' : '↔ Move') + '</button>' +
          (j.idle ? '' : '<button class="cbtn" data-crew-recall="' + esc(m.card) + '">Recall</button>') +
          '<button class="cbtn" data-crew-drop="' + esc(m.card) + '">Dismiss</button>' +
        '</span></div>' +
      '<div class="rjob' + (j.idle ? ' idle' : '') + '">' + (j.idle ? '💤 ' : '🏭 ') + esc(j.txt) +
        (p ? ' — worth <b>+' + Math.round(p.power * 100) + '%</b> to it' : '') + '</div>' +
      '<div class="chips">' + suitChips(prof) + passiveChips(prof) + '</div>' +
      '<div class="cbar2' + condClass(m.cond) + '"><i style="width:' + Math.round(m.cond) + '%"></i></div>' +
      '</div>';
  }).join('');
  return '<div class="cbox">' +
    '<h3>👷 WORK CREW</h3>' +
    '<div class="csub">Enlist units, then <b>post each one to a building</b>. A unit only lifts the building you put it in, and only if it has a trade that building needs — its <b>suitability level</b> decides how much, and its own level, its passives and its condition scale the rest. ' +
    'These are <b>not</b> the 👷 hired hands that staff the city, and not the 🏗 build gangs that raise it: a posted unit works on top of a building\'s staffing, never instead of it. ' +
      'A building takes as many posts as it has staffed jobs, and tops out at <b>' + W.multLabel(1 + W.WORK.BOOST_CAP) + '</b> output.</div>' +
    '<div class="cstat">' +
      '<span>🛏 Beds <b>' + crew.length + ' / ' + cap + '</b> <span style="opacity:.7">(' + parts.base + ' base + ' +
        parts.housing + ' housing + ' + parts.rest + ' resting house' + (parts.capped ? ', capped at ' + CREW_MAX : '') + ')</span></span>' +
      '<span>🍱 Rations <b>' + demandPerMin().toFixed(2) + '/min</b></span>' +
      '<span>❤️ Condition <b>' + Math.round(avgCondition()) + '%</b></span>' +
      '<span class="' + (idle ? 'warn' : '') + '">💤 Idle <b>' + idle + '</b></span>' +
    '</div>' +
    (rows || '<div class="csub">The work crew is empty. Enlist a unit, then post it to a building that needs its trade.</div>') +
    '<div class="cfoot2">' +
      '<button class="pbtn" id="crew-add"' + (crew.length >= cap ? ' disabled' : '') + '>' +
        (crew.length >= cap ? '🛏 No beds left — build Housing' : '➕ Enlist a unit') + '</button>' +
      '<button class="pbtn" id="crew-auto"' + (idle ? '' : ' disabled') + '>🪄 Auto-fill empty posts</button>' +
      '<button class="pbtn" id="crew-close">Close</button>' +
    '</div>' +
    '<div class="cnote">Beds come from 🏠 Housing (+' + CREW_PER_HOUSING + ' a level) and 🛏 the Resting House (+' +
      CREW_PER_RESTHOUSE + ' a level). <b>Auto-fill only fills EMPTY posts with IDLE units</b> — it never moves anyone you placed, and it cannot see which resource you are actually short of, so it is a starting point rather than an answer. ' +
      'A work-crew member on short rations loses Condition and slows down, but never stops — the floor is ' + Math.round(W.WORK.COND_FLOOR * 100) + '% of its normal pace. ' +
      'Units on the work crew cannot also be socketed, billeted or stood in the defense deck.</div>' +
    '</div>';
}

export function render() {
  if (!OPEN) return;
  const box = document.getElementById('crewmod');
  const html = dialogHtml();
  if (box) { box.innerHTML = html; return; }
  const el = document.createElement('div');
  el.id = 'crewmod'; el.innerHTML = html;
  (document.getElementById('wrap') || document.body).appendChild(el);
  el.addEventListener('click', onClick);
}

/* ── The two pickers ──────────────────────────────────────────────────────
   One component, two directions. `opts.forCard` asks "where does this unit
   work"; `opts.forTile` asks "who works here". Both list refused options,
   disabled, with the reason on the row. */
let PICK = null;
function closePick() { const b = document.getElementById('crewpick'); if (b) b.remove(); PICK = null; }

function pickHtml() {
  if (!PICK) return '';
  if (PICK.forCard) {
    const c = cardOf(PICK.forCard), prof = profileOf(PICK.forCard);
    const opts = postsFor(PICK.forCard);
    return '<div class="pbox"><h3>📍 Where does ' + esc(c ? c.name : PICK.forCard) + ' work?</h3>' +
      '<div class="psub">' + (prof ? esc(W.suitsLabel(prof)) : '') + ' · Lv ' + (prof ? prof.level : 1) +
      '<br>Only buildings that need one of its trades can take it. The figure is what this unit would add to that building right now.</div>' +
      (opts.length ? opts.map(o =>
        '<button class="opt' + (o.here ? ' here' : o.ok ? ' good' : '') + '"' + (o.ok || o.here ? '' : ' disabled') +
          ' data-pick-tile="' + esc(o.key) + '">' +
          '<span class="on1"><span>' + o.ico + ' ' + esc(o.name) + (o.here ? ' <b>· posted here</b>' : '') + '</span>' +
          '<span class="ogain' + (o.ok || o.here ? '' : ' nil') + '">' + (o.ok || o.here ? '+' + Math.round(o.power * 100) + '%' : '—') + '</span></span>' +
          '<span class="o2">' + o.used + ' / ' + o.slots + ' posts filled' +
            (o.work ? ' · ' + (W.getWork(o.work) || {}).icon + ' ' + (W.getWork(o.work) || {}).name + ' ' + o.suit : '') +
            (o.ok || o.here ? '' : ' · <b>' + esc(o.why) + '</b>') + '</span>' +
        '</button>').join('')
        : '<div class="psub">Nothing standing needs a work crew yet.</div>') +
      '<div class="pfoot">' + (postOf(PICK.forCard) ? '<button class="pbtn" id="pk-recall">↩ Recall to idle</button>' : '') +
        '<button class="pbtn" id="pk-close">Close</button></div></div>';
  }
  const k = PICK.forTile;
  const t = G().tiles[k], def = defOf(t && t.type);
  const needs = W.workNeeds(t ? t.type : '').map(x => { const w = W.getWork(x); return w ? w.icon + ' ' + w.name : x; }).join(' · ');
  const cands = candidatesFor(k);
  /* ⚠ The host's "this post would be waste" check, shown BEFORE the choice
     rather than after it. The decision point is this dialog; a warning that only
     appears on the dossier afterwards is a warning the player reads once they
     have already spent the post. */
  let warn = null;
  try { warn = (CTX.postWarning && CTX.postWarning(k)) || null; } catch (e) { warn = null; }
  return '<div class="pbox"><h3>👷 Who works the ' + esc(def ? def.name : k) + '?</h3>' +
    '<div class="psub">Needs ' + needs + ' · <b>' + postsAt(k).length + ' / ' + slotsAt(k) + '</b> posts filled' +
    '<br>The figure is what each unit would add to THIS building. Anyone already posted elsewhere moves here.</div>' +
    (warn ? '<div class="pwarn">⚠ ' + esc(warn) + '</div>' : '') +
    (cands.length ? cands.map(o =>
      '<button class="opt' + (o.here ? ' here' : o.ok ? ' good' : '') + '"' + (o.ok ? '' : ' disabled') +
        ' data-pick-card="' + esc(o.card) + '">' +
        '<span class="on1"><span>' + esc(o.name) + ' <span style="opacity:.7">Lv ' + o.profile.level + '</span>' +
          (o.here ? ' <b>· posted here</b>' : '') + '</span>' +
        '<span class="ogain' + (o.ok ? '' : ' nil') + '">' + (o.ok ? '+' + Math.round(o.power * 100) + '%' : '—') + '</span></span>' +
        '<span class="o2">' + esc(W.suitsLabel(o.profile)) + ' · ' + Math.round(o.cond) + '% condition' +
          (o.postedAt && !o.here ? ' · now at ' + esc(tileName(o.postedAt)) : '') +
          (o.ok ? '' : ' · <b>' + esc(o.why) + '</b>') + '</span>' +
      '</button>').join('')
      : '<div class="psub">Nobody is on the work crew. Enlist someone first.</div>') +
    '<div class="pfoot"><button class="pbtn" id="pk-close">Close</button></div></div>';
}

function renderPick() {
  if (!PICK) return;
  const box = document.getElementById('crewpick');
  const html = pickHtml();
  if (box) { box.innerHTML = html; return; }
  const el = document.createElement('div');
  el.id = 'crewpick'; el.innerHTML = html;
  (document.getElementById('wrap') || document.body).appendChild(el);
  el.addEventListener('click', onPickClick);
}

/** "Where does this unit work?" — opened from a crew row. */
export function openPostPicker(cardId) { if (!CTX) return; ensureCss(); PICK = { forCard: cardId }; renderPick(); }
/** "Who works here?" — opened from a building's dossier. */
export function openTilePicker(k) {
  if (!CTX) return;
  if (!takesWork(k)) { try { CTX.toast('👷 Nothing here for a crew to do.', 'bad'); } catch (e) {} return; }
  ensureCss(); PICK = { forTile: k }; renderPick();
}

function after(msg, bad) {
  try { if (msg) CTX.toast(msg, bad ? 'bad' : 'good'); } catch (e) {}
  try { CTX.saveSoon(); } catch (e) {}
  try { CTX.updateHUD && CTX.updateHUD(); } catch (e) {}
  try { CTX.refreshInspect && CTX.refreshInspect(); } catch (e) {}
  renderPanel(); render(); renderPick();
}

function onPickClick(ev) {
  const box = document.getElementById('crewpick');
  if (ev.target === box || ev.target.id === 'pk-close') { closePick(); render(); return; }
  if (ev.target.id === 'pk-recall' && PICK && PICK.forCard) {
    const c = cardOf(PICK.forCard);
    if (unpost(PICK.forCard)) after('👷 ' + ((c && c.name) || PICK.forCard) + ' is off duty.');
    closePick(); render(); return;
  }
  const tileBtn = ev.target.closest('[data-pick-tile]');
  if (tileBtn && PICK && PICK.forCard) {
    const err = post(PICK.forCard, tileBtn.dataset.pickTile);
    const c = cardOf(PICK.forCard);
    after(err || '👷 ' + ((c && c.name) || '') + ' posted to the ' + tileName(tileBtn.dataset.pickTile).replace(/^\S+\s/, '') + '.', !!err);
    if (!err) closePick();
    render();
    return;
  }
  const cardBtn = ev.target.closest('[data-pick-card]');
  if (cardBtn && PICK && PICK.forTile) {
    const id = cardBtn.dataset.pickCard;
    const c = cardOf(id);
    // Clicking the unit already posted here recalls it — the row says "posted
    // here", so the only thing left to do with it is take it off.
    if (postOf(id) === PICK.forTile) { unpost(id); after('👷 ' + ((c && c.name) || id) + ' is off duty.'); renderPick(); return; }
    const err = post(id, PICK.forTile);
    after(err || '👷 ' + ((c && c.name) || id) + ' posted to the ' + tileName(PICK.forTile).replace(/^\S+\s/, '') + '.', !!err);
    if (!err && freeSlotsAt(PICK.forTile) <= 0) closePick();
    return;
  }
}

function onClick(ev) {
  const box = document.getElementById('crewmod');
  if (ev.target === box || ev.target.id === 'crew-close') { close(); return; }
  const move = ev.target.closest('[data-crew-post]');
  if (move) { openPostPicker(move.dataset.crewPost); return; }
  const recall = ev.target.closest('[data-crew-recall]');
  if (recall) {
    const c = cardOf(recall.dataset.crewRecall);
    if (unpost(recall.dataset.crewRecall)) after('👷 ' + ((c && c.name) || '') + ' is off duty.');
    return;
  }
  const drop = ev.target.closest('[data-crew-drop]');
  if (drop) {
    const id = drop.dataset.crewDrop;
    const c = cardOf(id);
    if (dismiss(id)) {
      try { CTX.assignCard(id, false); } catch (e) {}
      after('👷 ' + ((c && c.name) || id) + ' left the work crew.');
    }
    return;
  }
  if (ev.target.id === 'crew-auto') {
    const n = autoFill();
    after(n ? '🪄 Auto-filled ' + n + ' post' + (n === 1 ? '' : 's') + ' with idle units. Nobody you posted was moved.'
            : '🪄 Nothing to fill — every idle unit lacks a trade any empty post needs.', !n);
    return;
  }
  if (ev.target.id === 'crew-add') {
    /* The picker shows each card's WORK profile, not just its power. Choosing a
       crew member on ⚡power would be choosing on the wrong number entirely —
       power is a battle stat and has nothing to do with how well a unit mills
       timber. `true` is the flag the host's picker reads to print suitabilities. */
    try {
      CTX.openCardPicker('Enlist a unit onto the work crew', c => c.type !== 'Structure', (c) => {
        const err = enlist(c.id);
        if (err) { try { CTX.toast('👷 ' + err, 'bad'); } catch (e) {} return; }
        try { CTX.assignCard(c.id, true); } catch (e) {}
        after('👷 ' + c.name + ' joined the work crew — idle. Post it to a building to put it to work.');
        // Straight into the "where does it work" question, because that is the
        // decision the player just created for themselves.
        openPostPicker(c.id);
      }, true);
    } catch (e) {}
  }
}

export function open() { if (!CTX) return; ensureCss(); OPEN = true; render(); }
export function close() { closePick(); const b = document.getElementById('crewmod'); if (b) b.remove(); OPEN = false; }

/* One line for the tile hover card. Says how many posts are FILLED, not just
   the multiplier — "1 / 2 posted" is the actionable half. */
export function tipLine(k) {
  if (!takesWork(k)) return '';
  const ps = powersAt(k), slots = slotsAt(k);
  if (!ps.length) return '👷 <span class="dn">no crew posted</span> — ' + slots + ' post' + (slots === 1 ? '' : 's') + ' free<br>';
  return '👷 ' + ps.length + ' / ' + slots + ' posted — output <span class="hl">' + W.multLabel(W.multFrom(ps)) + '</span><br>';
}

export function mount(ctx) {
  CTX = ctx || {};
  ensureCss();
  const bad = W.auditBuildings((CTX.BUILDINGS) || {});
  if (bad.length) { try { console.warn('[Crew] work table vs BUILDINGS:', bad); } catch (e) {} }
  validate();
  const api = {
    work: W, state, crewIds, count, crewCap, capParts,
    // posts
    slotsAt, takesWork, postsAt, freeSlotsAt, postOf, idleIds, canWorkAt, post, unpost,
    validate, autoFill, candidatesFor, postsFor, workersAt, jobOf,
    powersAt, multAt, invalidate, upkeep, demandPerMin, avgCondition,
    enlist, dismiss, reconcile, save, load,
    open, close, render, renderPanel, tipLine, openPostPicker, openTilePicker,
    profileOf, suitsLabel: (id) => { const p = profileOf(id); return p ? W.suitsLabel(p) : ''; },
    // 🔬 test seam — the driver cannot reach CTX from outside the module.
    _ctx: () => CTX,
  };
  try { window.MythicCrew = api; } catch (e) {}
  return api;
}
