/* ══════════════════════════════════════════════════════════════════════════
   🏙 OUTBREAK ↔ CITY — the node-city adapter.
   ──────────────────────────────────────────────────────────────────────────
   node-city/index.html mounts this the same way it mounts the House and the
   Stadium: `mount(ctx)`, with the ctx object as the hand-over.

   🔴 THE GLOBALS TRAP, for the fifth time in this codebase (CLAUDE.md, and
   the identical note above the Stadium mount in node-city/index.html). `game`,
   `vitals`, `BUILDINGS`, `cityPop`, `popCap` and `computeCoverage` are
   top-level `const` inside node-city's own module script. They are NOT on
   window. There is no `window.game` and there never will be. Everything this
   file reads arrives through ctx.

   🔴 WHAT IS NOT IN THE CTX, AND WHY. Nothing that writes to `game.tiles`.
   Not one thing. A virus in this game cannot damage, demolish, downgrade or
   un-crew a building the player placed — the citizens module's first rule,
   inherited whole (see the header of outbreak.js). The adapter reads tiles
   only through the citizen roster, which already names the tile a person
   works at, and it never touches the store.

   ⚠ THE PENALTY IS REPORTED, NOT APPLIED. `workforceLoss` is handed back to
   the city so the city can decide what to do with it. This module does not
   reach into the economy it does not own — that is how two systems end up
   both applying the same multiplier and nobody can find the second one.
   ══════════════════════════════════════════════════════════════════════════ */

import * as PL from './state.js';
import * as OB from './outbreak.js';
import { familyOf, severityLabel } from './strains.js';

export const V = 1;

let CTX = null;
let ACC = 0;
let LAST = 0;

/* How often the outbreak advances. 20 real seconds — slow enough that it is
   never the reason a frame stutters, fast enough that a player watching a
   spike sees it move. The tick itself is driven off absolute timestamps
   (outbreak.js), so this cadence only decides how often we LOOK. */
export const TICK_SEC = 20;

function host() {
  const c = CTX || {};
  return {
    citizens: () => { try { return (c.citizens && c.citizens()) || []; } catch (e) { return []; } },
    vitals: () => { try { return (c.vitals && c.vitals()) || {}; } catch (e) { return {}; } },
    coverage: () => { try { return (c.coverage && c.coverage()) || {}; } catch (e) { return {}; } },
    pop: () => { try { return (c.pop && c.pop()) || 0; } catch (e) { return 0; } },
    popCap: () => { try { return (c.popCap && c.popCap()) || 1; } catch (e) { return 1; } },
    /* The ONE write into a citizen, and it is the sanctioned mood seam. If the
       city ever stops exposing nudge(), infections still run — people just
       stop looking miserable about it. Degrading, never throwing. */
    nudge: (id, d) => { try { return !!(c.nudge && c.nudge(id, d)); } catch (e) { return false; } },
    cityId: () => { try { return (c.cityId && c.cityId()) || 'city'; } catch (e) { return 'city'; } },
    /* 💊 What the pharmacy counter sold recently, as a 0..1 discount on wild
       pressure. Resolved late and by duck type — the pharmacy mounts after
       this module — and 0 whenever it is absent. */
    prophylaxis: () => {
      try {
        const P = (typeof window !== 'undefined') && window.MythicPharmacy;
        return (P && typeof P.prophylaxis === 'function') ? (+P.prophylaxis() || 0) : 0;
      } catch (e) { return 0; }
    },
  };
}

export function mount(ctx) {
  CTX = ctx || {};
  LAST = Date.now();
  ACC = 0;

  /* An immediate reconcile so a returning player's report is truthful before
     they have looked at anything. The elapsed time is capped inside
     outbreak.js at 36h, which is the game's existing unattended-accrual
     contract (OP_ACCRUAL_CAP_H) — passed through, never redeclared, for the
     same reason house.core.js asserts it. */
  try {
    const away = Math.max(0, +ctx.awayMs || 0);
    if (away > 60000) PL.cityTick(host(), away);
  } catch (e) {}

  try { if (typeof window !== 'undefined') window.MythicOutbreak = api; } catch (e) {}
  return api;
}

/* Called from node-city's animate() economy block. `dtSec` is real seconds. */
export function tick(dtSec) {
  if (!CTX) return null;
  ACC += Math.max(0, +dtSec || 0);
  if (ACC < TICK_SEC) return null;
  ACC = 0;
  const now = Date.now();
  const dt = Math.max(0, now - LAST);
  LAST = now;
  let r = null;
  try { r = PL.cityTick(host(), dt); } catch (e) { try { console.warn('[outbreak] tick', e); } catch (e2) {} }
  // Refreshed on this beat rather than per call — see healthDrag's header.
  refreshDrag();
  if (r && r.events && r.events.length) announce(r.events);
  return r;
}

function announce(events) {
  const c = CTX || {};
  const say = (m, ms) => { try { if (c.toast) c.toast(m, ms || 5200); } catch (e) {} };
  const log = (m) => { try { if (c.logEvent) c.logEvent(m); } catch (e) {} };
  for (const ev of events) {
    if (ev.kind === 'emerge') {
      const s = OB.strainById(PL.outbreakState(), ev.strainId);
      if (!s) continue;
      const f = familyOf(s.family);
      say('🦠 OUTBREAK — ' + f.icon + ' ' + s.name + ' (' + s.isolate + '), ' +
          severityLabel(s.severity).toLowerCase() + '. Get to the Containment Lab.', 8000);
      log('🦠 ' + s.name + ' detected in the city.');
    } else if (ev.kind === 'critical') {
      say('🤒 ' + (ev.name || 'A citizen') + ' has taken a turn for the worse.', 4200);
    } else if (ev.kind === 'recovered') {
      log('💚 ' + (ev.name || 'A citizen') + ' recovered.');
    }
    // 'spread' and 'symptoms' are deliberately silent. A toast per case turns
    // an outbreak into a notification storm, and the player already has the
    // banner and the register.
  }
}

/* The banner the city HUD prints. Returns null when there is nothing to say,
   so the caller can skip the row entirely rather than render an empty one. */
export function banner() {
  if (!CTX) return null;
  const r = PL.cityReport(host());
  if (!r.strains.length) {
    // A clean city with real pressure still gets a warning — that is the
    // player's chance to build clinics BEFORE the first case.
    if (r.pressure > 0.45) {
      return { level: 'warn', icon: '⚠', text: 'Sanitation is failing — ' + Math.round(r.pressure * 100) +
        '% outbreak pressure. Clinics and clean water are the answer.', report: r };
    }
    return null;
  }
  const w = r.worst;
  return {
    level: r.share > 0.25 ? 'bad' : 'warn',
    icon: w.family.icon,
    text: w.strain.name + ' — ' + r.cases + ' of ' + r.roster + ' named citizens ill' +
      (r.strains.length > 1 ? ' across ' + r.strains.length + ' strains' : '') + '.',
    report: r,
  };
}

export function report() { return CTX ? PL.cityReport(host()) : null; }

/* 🏭 THE ECONOMIC BITE, cached. 0..1 drag on the city's HEALTH vital.
   ──────────────────────────────────────────────────────────────────────────
   The city's `labour` multiplier is a Liebig minimum over food / water /
   health, so a workforce that is off sick is most honestly expressed as a
   health shortfall — it flows through the multipliers the city already has,
   and the Vital Signs panel names HEALTH as the binding constraint on its own.
   No new economic term was invented for this.

   🔴 IT MUST BE CHEAP. node-city calls cityOutputMultipliers() for every tile
   every economy tick, and report() walks the whole roster. Recomputing it per
   call turned a 200-tile city into a stutter, so it is refreshed on the
   outbreak's own 20-second beat and read from cache in between.

   ⚠ NEVER SHIP AN INVISIBLE PENALTY (node-city:19217). The banner above says
   how many citizens are ill and the panel says HEALTH is what is limiting the
   city; between them the player can see the whole of this. */
let DRAG = 0;
export function healthDrag() { return DRAG; }
function refreshDrag() {
  try {
    const r = PL.cityReport(host());
    DRAG = (r && +r.healthDrag) || 0;
  } catch (e) { DRAG = 0; }
}

/* Is this citizen ill, and with what? node-city's citizen dossier and chat
   bubbles call this. Returns null for a healthy person — never a stub object,
   because a stub is what makes a caller print "Healthy: false". */
export function infectionOf(czId) {
  try {
    const st = PL.outbreakState();
    const inf = st.infections[String(czId)];
    if (!inf) return null;
    const s = OB.strainById(st, inf.strainId);
    if (!s) return null;
    return {
      stage: inf.stage,
      since: inf.since,
      strain: s,
      family: familyOf(s.family),
      label: inf.stage === 'incubating' ? 'Incubating' : inf.stage === 'critical' ? 'Critically ill' : 'Symptomatic',
    };
  } catch (e) { return null; }
}

/* A line for the citizen dossier, or ''. Kept here rather than in the city so
   the wording of an illness lives with the illness. */
export function tipLine(czId) {
  const i = infectionOf(czId);
  if (!i) return '';
  return '<div style="color:#ff8aa0">' + i.family.icon + ' ' + i.label + ' — ' +
    escapeHtml(i.strain.name) + ' (' + escapeHtml(i.strain.isolate) + ')</div>';
}

function escapeHtml(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const api = {
  mount, tick, banner, report, infectionOf, tipLine, healthDrag, TICK_SEC,
  /* 🔬 Test seam. The city's loop is RAF-driven and RAF does not fire in this
     environment's Browser pane (CLAUDE.md), so without these the outbreak is
     unobservable. `advance(ms)` runs the model directly at any elapsed time. */
  _advance: (ms) => PL.cityTick(host(), ms | 0),
  _state: () => PL.outbreakState(),
  _seed: (opts) => PL.seedStrain(host(), opts),
  _host: host,
};

export default api;
