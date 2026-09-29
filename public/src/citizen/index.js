/* ══════════════════════════════════════════════════════════════════════════
   👤 THE CITIZEN DOSSIER — who this person is, and one click to everywhere
      they touch.
   ──────────────────────────────────────────────────────────────────────────
   node-city could already TALK to a citizen: openCitTalk() gives you four
   sentences in their own voice, the four weighted terms behind their mood and
   the building they crew. What it could not do is the thing the reference
   panel does in one screen — say who they live with, where that is, who pays
   them and where they are going, and let you CLICK any of it.

   That is all this module adds. It is a READOUT and a set of doors:

     · a mood strip and what they are doing right now;
     · CITIZEN — age, education;
     · HOUSEHOLD — the family, their wealth, their address;
     · OCCUPATION — the work, its band, the employer;
     · DESTINATION — where the person walking as them is headed.

   🔍 THE CROSS-LINKS ARE THE FEATURE, and they run both ways. The building
   dossier's household rows already open a citizen (`.wfrow[data-cit]`,
   delegated on #inspanes by index.html). This panel is the other end: the
   residence, the employer and the destination open THAT BUILDING'S dossier,
   and a household member opens THAT PERSON'S. One-click navigation between
   people and places is what makes a city feel populated rather than counted.

   🔴 WHAT IT DOES NOT DO.
     · It never writes. Not to a citizen, not to a tile, not to the save.
       There is no new save field: every fact here is derived from state that
       is already persisted, so a save written before this module opens with
       the dossier in it and a save written after opens in a build without it.
     · It mints no citizen and stores no person. There is exactly ONE citizen
       store in this game — `window.MythicCitizens` — and this reads it. Where
       that roster is silent (age, schooling, rank) the panel says UNAVAILABLE
       and why. See facts.js's table.
     · It never throws into openCitTalk. `dossierHtml()` returns '' on any
       fault, and the dialogue then prints exactly what it printed before.

   🔴 THE GLOBALS TRAP (CLAUDE.md), and this module is the next one to hit it.
      `game`, `BUILDINGS`, `agents`, `openInspect`, `openCitTalk`, `ctBand`,
      `logEsc` and `insPctCol` are top-level `const`/`function` bindings in
      node-city's module script. They are LEXICAL — they are NOT on `window`,
      and an ES module cannot see them. `mount(ctx)` IS the hand-over.
      ⚠ Note what does NOT cross it: nothing that writes, and no agent object.
        `agentOf(id)` hands over a SNAPSHOT of one agent's state — state,
        phase, path ends — so no mesh, no THREE object and nothing the render
        loop owns is ever reachable from here.
      The sibling layers this module reads (MythicCitizens, MythicDossier,
      MythicEconomy) ARE on window, which is the direction that works, and
      every one of them is probed and absence-tolerant.
   ══════════════════════════════════════════════════════════════════════════ */

import { factsOf, bindHousehold, residenceOf, activityOf } from './facts.js';
import { render, CITIZEN_CSS } from './render.js';

export const V = 1;

let C = null;                     // the ctx hand-over. null ⇒ not mounted.
let wired = false;                // the one delegated listener

function esc(s) {
  try { return C && C.esc ? C.esc(s) : String(s == null ? '' : s); }
  catch (e) { return ''; }
}

function ensureCss() {
  try {
    if (typeof document === 'undefined') return;
    if (document.getElementById('cz-css')) return;
    const s = document.createElement('style');
    s.id = 'cz-css';
    s.textContent = CITIZEN_CSS;
    document.head.appendChild(s);
  } catch (e) {}
}

/* ── the doors ────────────────────────────────────────────────────────────
   🔴 ONE DELEGATED LISTENER, ON #citback, AND IT IS ADDED ONCE.
   #citbox is rebuilt with innerHTML on every citRefresh beat while the dialog
   is open (ctRender is wrapped onto the mood tick), so a per-row listener
   would be dead within four seconds — the same reason index.html delegates
   the Workforce roster on #inspanes rather than on its rows. The wrapper, not
   the box, because the wrapper is the element that is never replaced.

   ⚠ THE CITIZEN DIALOG IS CLOSED BEFORE A BUILDING IS OPENED. #citback sits at
     z-index 9865, above the dossier, so opening a tile underneath it would put
     the panel behind a blurred scrim and read as a dead click. This is exactly
     what the dialogue's own "Open the …" button does, and it goes through the
     same two calls in the same order. */
function wire() {
  if (wired || typeof document === 'undefined') return;
  const wrap = document.getElementById('citback');
  if (!wrap) return;
  wrap.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-tile],[data-cit]') : null;
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    const tile = el.getAttribute('data-tile');
    if (tile) {
      /* Gone since the panel drew — a building can be demolished while its
         resident's dossier is open. Say so; a dead click reads as a bug. */
      let exists = false;
      try { exists = !!(C && C.game.tiles[tile]); } catch (e) { exists = false; }
      if (!exists) { try { C.toast('That building is no longer there.', 'warn'); } catch (e) {} return; }
      try { C.closeCitizen(); } catch (e) {}
      try { C.openTile(tile); } catch (e) {}
      return;
    }
    const cit = el.getAttribute('data-cit');
    if (cit) {
      let ok = false;
      try { ok = !!C.openCitizen(cit); } catch (e) { ok = false; }
      if (!ok) { try { C.toast('That citizen is no longer on the roster.', 'warn'); } catch (e) {} }
    }
  });
  wired = true;
}

/* ── the one entry point node-city calls ──────────────────────────────────
   Returns '' rather than throwing, always. openCitTalk wraps this too, so a
   fault here costs the reader the dossier block and nothing else — they still
   get the name, the four sentences, the mood terms and the workplace. */
export function dossierHtml(id) {
  if (!C) return '';
  try {
    const F = factsOf(C, String(id));
    if (!F || !F.ok) return '';
    return render(F, esc, C.pctCol);
  } catch (e) {
    try { console.warn('[citizen] dossier', e); } catch (e2) {}
    return '';
  }
}

/* ── mount ────────────────────────────────────────────────────────────────
   /src/dossier/household.js is imported DYNAMICALLY and guarded, not statically,
   and that is deliberate: a static import would make a 404 on the dossier take
   this whole module down with it, and the contract every module here keeps is
   that a missing sibling costs the rows that need it and nothing else. Without
   it the residence, household and wealth rows say so out loud.

   It is imported at ALL rather than reimplemented because homesIndex() caches
   its deal on a signature of (roster, housing stock): calling the shipped
   function means this panel and the building panel read the SAME deal out of
   the SAME cache. A local copy would be a second opinion about who lives
   where — the class of bug this project keeps paying for. */
export async function mount(ctx) {
  C = ctx || null;
  ensureCss();
  wire();
  try {
    const mod = await import('../dossier/household.js?v=' + ((typeof window !== 'undefined' && window.NC_BUILD) || 'cz1'));
    bindHousehold(mod);
  } catch (e) {
    bindHousehold(null);
    try { console.warn('[citizen] no dossier household layer (non-fatal):', e); } catch (e2) {}
  }
  const api = {
    V,
    dossierHtml,
    /* The read seam. A driver wants the DERIVATIONS, not the HTML they render
       as — the same call the panel makes, so an assertion is about the shipped
       path rather than about a copy of it. */
    facts: (id) => { try { return factsOf(C, String(id)); } catch (e) { return null; } },
    residence: (id) => { try { return residenceOf(C, String(id)); } catch (e) { return null; } },
    activity: (id) => { try { return activityOf(C, String(id)); } catch (e) { return null; } },
    html: (id) => dossierHtml(id),
    wired: () => wired,
    _ctx: () => C,
  };
  try { window.MythicCitizen = api; } catch (e) {}
  return api;
}

export default { V, mount, dossierHtml };
