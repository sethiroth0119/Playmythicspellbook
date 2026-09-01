/* ══════════════════════════════════════════════════════════════════════════
   👷 THE WORK CREW — the city half of work suitability.
   ──────────────────────────────────────────────────────────────────────────
   You do not staff a building. You keep a CREW, and the crew finds its own
   work: every reassignment matches each unit to the job it is best at, across
   the whole city, and a building's output rises with the workers standing in
   it. Take a unit out and the city re-shuffles around the hole.

   That is the entire design, and it is deliberately NOT "slot a card into a
   building". Per-building slots make the player do the optimiser's job by hand
   — thirty buildings, twenty units, re-solved every time they build anything —
   and the busywork scales with how well the city is doing, which is exactly
   backwards. Assignment is a matching problem; the game should solve it.

   What this file owns:
     · the roster and its cap (beds — see crewCap)
     · the assignment pass, and the cache the tick reads
     · upkeep: rations in, CONDITION out
     · the crew panel and dialog
   What it does NOT own: the rules. Suitabilities, passives, levels, the
   arithmetic and the ceiling are all /src/work/work.js, which index.html also
   imports so the game and the city can never disagree about a unit.

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

/* ── THE ASSIGNMENT PASS ──────────────────────────────────────────────────
   Greedy, deterministic, and re-run only when something structural changes —
   never per tick. On each pass:

     1. Every undamaged building whose output the tick multiplies offers
        `def.crew` job slots (min 1). Reusing the building's OWN crew figure is
        the whole reason a Farm takes two hands and a Gas Station one without a
        second table to keep in step with the first.
     2. Score every (member, slot) pair by workPower.
     3. Repeatedly take the best remaining pair. Stop when nothing scores.

   🔴 GREEDY, NOT OPTIMAL, AND THAT IS THE RIGHT CALL. The optimal assignment is
   the Hungarian algorithm; on ≤20 workers and ≤60 slots it would be perfectly
   affordable. It is not used because a player has to be able to PREDICT this.
   "My best miner went to the mine" is a rule someone can hold in their head and
   plan around. An optimal solver will happily move that miner to the quarry to
   free a better global total, and the player — who cannot see the objective
   function — reads it as the game shuffling their crew at random. Legibility
   beats a few percent of throughput.

   ⚠ TIES BREAK ON ROSTER ORDER, which is enlist order, which is stable. Without
     that a re-render could reorder two equal workers and make the panel flicker
     between two correct answers. */
let _jobs = {};              // tileKey -> [cardId, …]
let _idle = [];              // cardIds with no job
let _multCache = null;       // tileKey -> mult, invalidated once per tick

function jobSlots() {
  const out = [];
  for (const [k, t] of Object.entries(G().tiles || {})) {
    if (!t || t.damaged) continue;
    const def = defOf(t.type); if (!def) continue;
    if (!W.workNeeds(t.type).length) continue;
    // A building the tick does not multiply cannot use a crew, whatever the
    // work table says. work.js's auditBuildings warns about the mismatch at
    // mount; this is the belt to that braces.
    if (!def.gen && !def.svc) continue;
    const slots = Math.max(1, def.crew | 0);
    for (let i = 0; i < slots; i++) out.push(k);
  }
  return out;
}

export function assign() {
  const crew = state();
  _jobs = {}; _idle = []; _multCache = null;
  const slots = jobSlots();
  const free = crew.map(m => m.card);
  const taken = new Set();
  const usedSlot = new Map();          // tileKey -> how many of its slots are filled

  const slotCount = {};
  for (const k of slots) slotCount[k] = (slotCount[k] | 0) + 1;

  while (true) {
    let best = null;
    for (const id of free) {
      if (taken.has(id)) continue;
      const prof = profileOf(id); if (!prof) continue;
      const m = memberOf(id);
      for (const k in slotCount) {
        if ((usedSlot.get(k) | 0) >= slotCount[k]) continue;
        const t = G().tiles[k]; if (!t) continue;
        const p = W.workPower(null, prof, t.type, { night: night(), condition: m ? m.cond : 100 });
        if (p.power <= 0) continue;
        if (!best || p.power > best.power + 1e-12) best = { id, k, power: p.power };
      }
    }
    if (!best) break;
    taken.add(best.id);
    usedSlot.set(best.k, (usedSlot.get(best.k) | 0) + 1);
    (_jobs[best.k] = _jobs[best.k] || []).push(best.id);
  }
  _idle = free.filter(id => !taken.has(id));
  try { G().crewJobs = Object.assign({}, _jobs); } catch (e) {}
  return { jobs: _jobs, idle: _idle };
}

/** Which cards are working this tile. */
export function workersAt(k) { return (_jobs[k] || []).slice(); }
/** Which cards have no job — shown in the panel, because idle hands are a bug the player can fix. */
export function idleIds() { return _idle.slice(); }
/** Where one card is working, or null. */
export function jobOf(id) { for (const k in _jobs) if (_jobs[k].indexOf(id) >= 0) return k; return null; }

/** Every worker's contribution at this tile, decomposed for the UI. */
export function powersAt(k) {
  const t = G().tiles[k]; if (!t) return [];
  const out = [];
  for (const id of (_jobs[k] || [])) {
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
   three times per building per second. Invalidated by upkeep() — the only
   thing that moves condition — and by assign(). */
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

/* ── Roster changes ───────────────────────────────────────────────────────
   Both paths reassign immediately: a player who enlists a miner must see the
   mine's number move in the same frame, or they cannot tell the system worked. */
export function enlist(cardId) {
  const crew = state();
  if (!cardId || crew.some(m => m.card === cardId)) return 'Already on the crew.';
  if (crew.length >= crewCap()) return 'No beds left — build Housing or a Resting House.';
  crew.push({ card: cardId, cond: W.WORK.COND_MAX });
  assign();
  return null;
}
export function dismiss(cardId) {
  const crew = state();
  const i = crew.findIndex(m => m.card === cardId);
  if (i < 0) return false;
  crew.splice(i, 1);
  assign();
  return true;
}
/* 🔴 A CARD THAT LEAVES THE COLLECTION MUST LEAVE THE CREW. Sold, traded or
   consumed cards are removed by the host on the next card refresh; without this
   the roster keeps a ghost that occupies a bed and a job slot forever, and the
   panel renders its raw id. Returns how many were dropped. */
export function reconcile() {
  const crew = state();
  const before = crew.length;
  const alive = new Set((CTX && CTX.cards ? CTX.cards() : []).map(c => c && c.id).filter(Boolean));
  const kept = crew.filter(m => alive.has(m.card));
  if (kept.length !== before) { G().crew = kept; assign(); }
  return before - kept.length;
}

/* ── Persistence ──────────────────────────────────────────────────────────
   Condition rides the save. It is the one piece of crew state the city cannot
   recompute — the roster is ids and the assignment is derived, but "this unit
   has been on short rations for an hour" exists nowhere else, and dropping it
   would hand every returning player a perfectly-rested crew regardless of the
   city they left behind. */
export function save() {
  return state().map(m => ({ c: m.card, k: Math.round(m.cond) }));
}
export function load(raw) {
  const g = G();
  g.crew = Array.isArray(raw)
    ? raw.filter(r => r && r.c).slice(0, CREW_MAX).map(r => ({
        card: String(r.c),
        cond: Math.max(0, Math.min(W.WORK.COND_MAX, Number(r.k) == null ? W.WORK.COND_MAX : Number(r.k))),
      }))
    : [];
  state();
  assign();
}

/* ══ UI ═══════════════════════════════════════════════════════════════════ */
const CSS = `
#crewbody .ccap{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;
  color:var(--mist);margin-bottom:6px;}
#crewbody .ccap b{color:var(--gold);font-size:12.5px;}
#crewbody .cm{display:flex;flex-direction:column;gap:2px;padding:5px 0;
  border-top:1px solid rgba(255,255,255,.06);}
#crewbody .cm:first-of-type{border-top:none;}
#crewbody .cmtop{display:flex;justify-content:space-between;gap:6px;font-size:11.5px;color:var(--bone);}
#crewbody .cmjob{font-size:10px;color:var(--gold);}
#crewbody .cmjob.idle{color:#e08a80;}
#crewbody .cmsuit{font-size:10px;color:var(--mist);}
#crewbody .cbar{height:4px;background:rgba(255,255,255,.10);border-radius:2px;overflow:hidden;margin-top:2px;}
#crewbody .cbar i{display:block;height:100%;background:#7ad68c;}
#crewbody .cbar.low i{background:#e0a85f;} #crewbody .cbar.crit i{background:#e08a80;}
#crewbody .cempty{font-size:11px;color:var(--mist);line-height:1.45;padding:4px 0 6px;}
#crewbody .cfoot{font-size:10px;color:var(--mist);margin-top:6px;line-height:1.4;}

#crewmod{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  background:rgba(8,6,12,.78);backdrop-filter:blur(3px);}
#crewmod .cbox{width:min(560px,94vw);max-height:86vh;overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:12px;padding:16px 18px;}
#crewmod h3{font-size:13px;color:var(--gold);margin-bottom:4px;}
#crewmod .csub{font-size:11px;color:var(--mist);line-height:1.5;margin-bottom:10px;}
#crewmod .cstat{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--mist);
  border:1px solid var(--edge);border-radius:8px;padding:7px 10px;margin-bottom:10px;}
#crewmod .cstat b{color:var(--bone);}
#crewmod .row{border:1px solid var(--edge);border-radius:9px;padding:8px 10px;margin-bottom:6px;}
#crewmod .row.idle{border-color:rgba(224,138,128,.45);}
#crewmod .rtop{display:flex;justify-content:space-between;align-items:center;gap:8px;}
#crewmod .rn{font-size:12.5px;color:var(--bone);}
#crewmod .rlv{font-size:10px;color:var(--mist);}
#crewmod .rjob{font-size:10.5px;color:var(--gold);margin-top:3px;}
#crewmod .rjob.idle{color:#e08a80;}
#crewmod .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;}
#crewmod .chip{font-size:10px;border:1px solid var(--edge);border-radius:5px;padding:1px 6px;color:var(--bone);}
#crewmod .chip.suit{border-color:rgba(212,175,55,.5);color:#e8d49a;}
#crewmod .chip.good{border-color:rgba(122,214,140,.5);color:#7ad68c;}
#crewmod .chip.bad{border-color:rgba(224,138,128,.5);color:#e08a80;}
#crewmod .cbar2{height:5px;background:rgba(255,255,255,.10);border-radius:3px;overflow:hidden;margin-top:6px;}
#crewmod .cbar2 i{display:block;height:100%;background:#7ad68c;}
#crewmod .cbar2.low i{background:#e0a85f;} #crewmod .cbar2.crit i{background:#e08a80;}
#crewmod .cbtn{background:#1a1530;border:1px solid var(--edge);border-radius:6px;color:var(--bone);
  font-size:10.5px;padding:3px 9px;cursor:pointer;}
#crewmod .cbtn:hover:not(:disabled){border-color:var(--gold);}
#crewmod .cbtn:disabled{opacity:.4;cursor:default;}
#crewmod .cfoot2{display:flex;gap:8px;margin-top:12px;}
#crewmod .cfoot2 .pbtn{margin-top:0;flex:1;}
#crewmod .cnote{font-size:10.5px;color:var(--mist);margin-top:9px;line-height:1.45;}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  try { const s = document.createElement('style'); s.id = 'crew-css'; s.textContent = CSS; document.head.appendChild(s); } catch (e) {}
}

function condClass(c) { return c < 30 ? ' crit' : c < 65 ? ' low' : ''; }
function jobLabel(id) {
  const k = jobOf(id);
  if (!k) return { txt: 'Idle — nothing here suits it', idle: true };
  const t = G().tiles[k]; const def = defOf(t && t.type);
  const prof = profileOf(id);
  const best = prof && W.bestWorkAt(prof, t && t.type);
  const w = best && W.getWork(best.type);
  return { txt: (def ? def.ico + ' ' + def.name : k) + (w ? ' · ' + w.icon + ' ' + w.name + ' ' + best.level : ''), idle: false };
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
  const crew = state(), cap = crewCap();
  let h = '<div class="ccap"><span>👷 On the crew</span><span><b>' + crew.length + '</b> / ' + cap + ' beds</span></div>';
  if (!crew.length) {
    h += '<div class="cempty">Nobody is working the city yet. Put units on the crew and they will find their own jobs — a Kindling unit walks to the furnace, a Planting unit to the fields.</div>';
  } else {
    for (const m of crew.slice(0, 6)) {
      const c = cardOf(m.card), prof = profileOf(m.card);
      const j = jobLabel(m.card);
      h += '<div class="cm">' +
        '<div class="cmtop"><span>' + esc(c ? c.name : m.card) + '</span><span class="cmsuit">' + Math.round(m.cond) + '%</span></div>' +
        '<div class="cmjob' + (j.idle ? ' idle' : '') + '">' + esc(j.txt) + '</div>' +
        (prof ? '<div class="cmsuit">' + esc(W.suitsLabel(prof)) + '</div>' : '') +
        '<div class="cbar' + condClass(m.cond) + '"><i style="width:' + Math.round(m.cond) + '%"></i></div>' +
        '</div>';
    }
    if (crew.length > 6) h += '<div class="cfoot">…and ' + (crew.length - 6) + ' more.</div>';
    h += '<div class="cfoot">🍱 Eats <b>' + demandPerMin().toFixed(2) + '</b> rations/min. Short rations lower Condition, and a worn crew works slower.</div>';
  }
  h += '<button class="hbtn ember" id="crew-open" style="width:100%;margin-top:8px">👷 Manage crew</button>';
  el.innerHTML = h;
  const b = document.getElementById('crew-open');
  if (b) b.onclick = () => open();
}

function dialogHtml() {
  const crew = state(), cap = crewCap(), parts = capParts();
  const rows = crew.map(m => {
    const c = cardOf(m.card), prof = profileOf(m.card);
    if (!prof) return '';
    const j = jobLabel(m.card);
    const k = jobOf(m.card);
    const p = k ? powersAt(k).find(x => x.card === m.card) : null;
    return '<div class="row' + (j.idle ? ' idle' : '') + '">' +
      '<div class="rtop"><span class="rn">' + esc(c ? c.name : m.card) +
        ' <span class="rlv">Lv ' + prof.level + (c && c.element ? ' · ' + esc(c.element) : '') + '</span></span>' +
        '<button class="cbtn" data-crew-drop="' + esc(m.card) + '">Dismiss</button></div>' +
      '<div class="rjob' + (j.idle ? ' idle' : '') + '">' + (j.idle ? '💤 ' : '🏭 ') + esc(j.txt) +
        (p ? ' — worth <b>+' + Math.round(p.power * 100) + '%</b> to it' : '') + '</div>' +
      '<div class="chips">' + suitChips(prof) + passiveChips(prof) + '</div>' +
      '<div class="cbar2' + condClass(m.cond) + '"><i style="width:' + Math.round(m.cond) + '%"></i></div>' +
      '</div>';
  }).join('');
  return '<div class="cbox">' +
    '<h3>👷 WORK CREW</h3>' +
    '<div class="csub">Units on the crew work the city on their own. Every time you build, demolish or change the roster, ' +
      'each of them is matched to the job it is <b>best</b> at — a unit\'s element decides what it is born to do, its ' +
      '<b>suitability level</b> decides how good it is, and its own level and condition scale the rest. ' +
      'A fully-worked building tops out at <b>' + W.multLabel(1 + W.WORK.BOOST_CAP) + '</b> output.</div>' +
    '<div class="cstat">' +
      '<span>🛏 Beds <b>' + crew.length + ' / ' + cap + '</b> <span style="opacity:.7">(' + parts.base + ' base + ' +
        parts.housing + ' housing + ' + parts.rest + ' resting house' + (parts.capped ? ', capped at ' + CREW_MAX : '') + ')</span></span>' +
      '<span>🍱 Rations <b>' + demandPerMin().toFixed(2) + '/min</b></span>' +
      '<span>❤️ Condition <b>' + Math.round(avgCondition()) + '%</b></span>' +
      '<span>💤 Idle <b>' + idleIds().length + '</b></span>' +
    '</div>' +
    (rows || '<div class="csub">The crew is empty. Enlist a unit and it will walk to whichever building suits it.</div>') +
    '<div class="cfoot2">' +
      '<button class="pbtn" id="crew-add"' + (crew.length >= cap ? ' disabled' : '') + '>' +
        (crew.length >= cap ? '🛏 No beds left — build Housing' : '➕ Enlist a unit') + '</button>' +
      '<button class="pbtn" id="crew-close">Close</button>' +
    '</div>' +
    '<div class="cnote">Beds come from 🏠 Housing (+' + CREW_PER_HOUSING + ' a level) and 🛏 the Resting House (+' +
      CREW_PER_RESTHOUSE + ' a level). A crew member on short rations loses Condition and slows down, but never stops — ' +
      'the floor is ' + Math.round(W.WORK.COND_FLOOR * 100) + '% of its normal pace. Units on the crew cannot also be ' +
      'socketed, billeted or stood in the defense deck.</div>' +
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

function onClick(ev) {
  const box = document.getElementById('crewmod');
  if (ev.target === box || ev.target.id === 'crew-close') { close(); return; }
  const drop = ev.target.closest('[data-crew-drop]');
  if (drop) {
    const id = drop.dataset.crewDrop;
    const c = cardOf(id);
    if (dismiss(id)) {
      try { CTX.assignCard(id, false); } catch (e) {}
      try { CTX.toast('👷 ' + ((c && c.name) || id) + ' left the crew.', 'good'); } catch (e) {}
      try { CTX.saveSoon(); } catch (e) {}
      render(); renderPanel(); try { CTX.updateHUD && CTX.updateHUD(); } catch (e) {}
    }
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
        const j = jobLabel(c.id);
        try {
          CTX.toast(j.idle
            ? '👷 ' + c.name + ' joined the crew — but nothing standing suits it yet. Build something in its trade.'
            : '👷 ' + c.name + ' joined the crew and went straight to the ' + j.txt.replace(/^\S+\s/, '') + '.', 'good');
        } catch (e) {}
        try { CTX.saveSoon(); } catch (e) {}
        render(); renderPanel(); try { CTX.updateHUD && CTX.updateHUD(); } catch (e) {}
      }, true);
    } catch (e) {}
  }
}

export function open() { if (!CTX) return; ensureCss(); OPEN = true; render(); }
export function close() { const b = document.getElementById('crewmod'); if (b) b.remove(); OPEN = false; }

/* One line for the tile hover card. Empty when nobody is working the tile —
   the hover card is already dense and a row that always reads ×1.00 is noise. */
export function tipLine(k) {
  const ps = powersAt(k);
  if (!ps.length) return '';
  const m = W.multFrom(ps);
  if (m <= 1.0001) return '';
  return '👷 ' + ps.length + ' on the crew — output <span class="hl">' + W.multLabel(m) + '</span><br>';
}

export function mount(ctx) {
  CTX = ctx || {};
  ensureCss();
  const bad = W.auditBuildings((CTX.BUILDINGS) || {});
  if (bad.length) { try { console.warn('[Crew] work table vs BUILDINGS:', bad); } catch (e) {} }
  assign();
  const api = {
    work: W, state, crewIds, count, crewCap, capParts, assign, workersAt, idleIds, jobOf,
    powersAt, multAt, invalidate, upkeep, demandPerMin, avgCondition,
    enlist, dismiss, reconcile, save, load, open, close, render, renderPanel, tipLine,
    profileOf, suitsLabel: (id) => { const p = profileOf(id); return p ? W.suitsLabel(p) : ''; },
    // 🔬 test seam — the driver cannot reach CTX or the assignment cache.
    _ctx: () => CTX, _jobs: () => Object.assign({}, _jobs),
  };
  try { window.MythicCrew = api; } catch (e) {}
  return api;
}
