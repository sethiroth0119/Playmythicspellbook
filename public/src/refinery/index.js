/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — THE CRACKING YARD · entry point
   ---------------------------------------------------------------------------
   Registers window.MythicRefinery and does NOTHING else until opened. Loading
   this file must never cost the game a frame, and a failure inside it must
   never be able to take the game down — hence the wrapper below and the fact
   that every single call into the legacy app goes through
   window.MythicRefineryBridge (defined in index.html next to MythicCityBridge).

   WHERE THIS SITS IN THE GAME
     Black River Petroleum extracts crude.  ← Profile.blackRiver.crude
     THIS refines, blends, tests and ships it.
     Ethos Fuel Command sells it at the pump. ← Profile.fuelCommand
   BRP's own "Refine Batch ×1" button (40 crude → fixed yield, 18% fire) still
   exists and is untouched: it is the one-click version for a player who does
   not want to run a refinery. This is what that button was standing in for.

   ⚠ Bump ?v= on the <script> tag in index.html on EVERY change — the service
     worker caches /src/* like any other static asset and a missed bump ships
     invisibly.
   ═════════════════════════════════════════════════════════════════════════ */

import * as St from './state.js';
import * as UI from './ui.js';
import * as C from './contracts.js';
import { GRADES } from './data.js';
import * as Models from './models.js';
import * as Yard from './scene.js';

const CSS_ID = 'hp-refinery-css';
const CSS_HREF = new URL('./refinery.css', import.meta.url).href;

/* The stylesheet is injected on first open rather than shipped in index.html,
   so a player who never opens the yard never pays for it. import.meta.url
   resolves it correctly whatever path /src/refinery/ is served from — this
   file has no idea whether it is at the root or under a version prefix. */
function ensureCss() {
  return new Promise(resolve => {
    if (document.getElementById(CSS_ID)) return resolve(true);
    const l = document.createElement('link');
    l.id = CSS_ID; l.rel = 'stylesheet'; l.href = CSS_HREF;
    l.onload = () => resolve(true);
    // A missing stylesheet must not block the game. The overlay will look
    // wrong and still be entirely operable.
    l.onerror = () => { try { console.warn('[refinery] stylesheet failed to load'); } catch (e) {} resolve(false); };
    document.head.appendChild(l);
    // Never hang: if the load event does not fire, open anyway.
    setTimeout(() => resolve(true), 2500);
  });
}

let opening = false;

export async function open(onClose) {
  if (opening) return;
  opening = true;
  try {
    await ensureCss();
    UI.open(onClose);
  } catch (e) {
    try { console.warn('[refinery] open failed:', e); } catch (e2) {}
    St.toast('⚠ The refinery could not open. Nothing was charged.', 4000);
  } finally { opening = false; }
}

export function close() { try { UI.close(); } catch (e) {} }

/* Is the yard available to this player? Gated behind Black River Petroleum,
   because a refinery with no source of crude is not a business — it is a
   locked door with no key. Admins always pass, matching brIsUnlocked(). */
export function unlocked() {
  const b = St.bridge();
  try { if (b && b.isAdmin && b.isAdmin()) return true; } catch (e) {}
  try { if (b && b.brOwned && b.brOwned()) return true; } catch (e) {}
  return !!St.S().owned;
}

/* A one-line summary for the BRP screen's entry card, so the button can say
   something true about the yard rather than just "Enter". */
export function summary() {
  const s = St.S();
  const jobs = s.contracts.length;
  const rolling = s.convoy.length;
  const bits = [];
  if (s.crude.length) bits.push(St.crudeHeld(s).toLocaleString() + ' L crude in tank');
  if (jobs) bits.push(jobs + ' contract' + (jobs === 1 ? '' : 's') + ' in hand');
  if (rolling) bits.push(rolling + ' load' + (rolling === 1 ? '' : 's') + ' on the road');
  if (!bits.length) bits.push('idle — no crude, no contracts');
  return bits.join(' · ');
}

/* Read-only status for anything in the game that wants to show the refinery's
   standing without opening it (the Fuel Command screen, a corp roster, a
   reputation card). Returns plain data — no live objects escape this module. */
export function status() {
  const s = St.S();
  return {
    unlocked: unlocked(),
    cinderRep: St.repWholesale(),
    stars: St.repStars(),
    safety: St.repSafetyLetter(),
    delivery: Math.round(s.rep.delivery),
    completion: Math.round(s.rep.completion),
    marketIndex: s.marketIndex,
    lifetimeL: s.lifetimeL | 0,
    lifetimeRevenue: s.lifetimeRevenue | 0,
    contracts: s.contracts.length,
    convoy: s.convoy.length,
    crudeL: St.crudeHeld(s),
    productL: St.storeHeld(s),
  };
}

/* Wholesale price index, exported so the rest of the economy can read the same
   number the yard prices against. A fuel shortage should raise the price on
   the station screen too, or the market is not a market. */
export function wholesaleIndex() {
  try { return C.refreshMarket(); } catch (e) { return 1; }
}

/* Grade table, for any screen that wants to describe a fuel grade the same way
   the refinery does. Frozen — nothing outside this module may retune a spec. */
export const grades = Object.freeze(Object.fromEntries(
  Object.entries(GRADES).map(([k, g]) => [k, Object.freeze({ ...g })])
));

try {
  window.MythicRefinery = { open, close, unlocked, summary, status, wholesaleIndex, grades, version: 'r1' };
  try {
    window.__mg = window.__mg || {};
    window.__mg.refinery = window.MythicRefinery;
    /* The model registry, exposed for admin scripting and for testing a
       replacement model without clicking through the panel. Read-only in
       spirit: setUrl still refuses a non-admin at the bridge. */
    window.__mgModels = Models;
    /* The live yard, for debugging a placement or a walk path from the
       console. `where()` is the one people actually want. */
    window.__mgYard = {
      scene: Yard,
      player: () => Yard.getPlayer(),
      where: () => { const p = Yard.getPlayer(); return p ? { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1), inside: p.inside, facing: +(p.group.rotation.y).toFixed(2), focus: p.focus && p.focus.label } : null; },
      teleport: (x, z) => { const p = Yard.getPlayer(); if (p) { p.pos.x = x; p.pos.z = z; } },
    };
  } catch (e) {}
} catch (e) {
  try { console.warn('[refinery] could not register:', e); } catch (e2) {}
}
