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
import { GRADES, EQUIPMENT } from './data.js';
import * as Models from './models.js';
import * as Yard from './scene.js';

const CSS_ID = 'hp-refinery-css';
/* 🔴 THE STYLESHEET NEEDS ITS OWN CACHE-BUSTER, and it did not have one.
   index.html bumps `?v=` on THIS module's <script> tag, which busts the module
   graph — but refinery.css is fetched by url, not imported, so the query
   string never reached it. The service worker caches /src/* like any other
   static asset, so a CSS fix shipped invisibly stale: the change was live in
   the file and the browser kept serving the old copy.
   ⚠ Bump CSS_V whenever refinery.css changes. It is deliberately a separate
     constant so the reason is impossible to miss. */
const CSS_V = 'v121r9';
const CSS_HREF = new URL('./refinery.css?v=' + CSS_V, import.meta.url).href;

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

/* 📄 THE CONTRACTS THE PLAYER HAS ACCEPTED, for surfaces outside the yard.
   ═══════════════════════════════════════════════════════════════════════════
   Asked for: the Logistics screen in the corporation should show accepted
   contracts, so a player can see what they signed up to, what it pays in
   Cinder, and what they have to do to get paid.

   The yard's own board is the place you ACCEPT work; this is the place you
   check what you already owe. So it reports the commitment, not the offer:
   what is still outstanding, how long is left, and the penalty for missing it.

   🔴 READ-ONLY AND DERIVED. Nothing here can accept, abandon or settle
      anything — those all live in contracts.js behind the yard's own UI, and
      a second path into them would be a second place for the ledger to go
      wrong. Every field is computed from the stored contract; the shape is
      plain data so it can cross the iframe boundary to /corp.
   ⚠ `msLeft` is computed at call time, not stored. The Logistics screen
     re-renders on a timer, so a stored countdown would sit still and then
     jump — the exact defect its own comments say that pass existed to end. */
export function acceptedContracts() {
  try {
    const s = St.S();
    const now = Date.now();
    return (s.contracts || []).filter((c) => c && c.status === 'open').map((c) => {
      const litres = c.litres | 0;
      const done = Math.max(0, Math.min(litres, c.delivered | 0));
      const g = (GRADES && GRADES[c.grade]) || null;
      return {
        id: c.id,
        station: c.station || 'Unknown station',
        place: c.place || '',
        own: !!c.own,
        player: !!c.player,
        km: c.km | 0,
        fleet: c.fleet || '',
        fleetIco: c.fleetIco || '⛽',
        rush: !!c.rush,
        grade: c.grade,
        gradeName: g ? g.name : String(c.grade || 'fuel'),
        /* What they have to DO to get paid, in the grade's own terms.
           ⚠ These are the *Min / *Max field names GRADES actually uses — the
             first version read g.octane / g.sulfur / g.purity, which do not
             exist, and shipped a silently empty spec object. */
        spec: g ? { octaneMin: g.octaneMin, sulfurMax: g.sulfurMax, purityMin: g.purityMin, rvpMax: g.rvpMax } : null,
        litres: litres,
        delivered: done,
        remaining: Math.max(0, litres - done),
        pct: litres > 0 ? Math.round((done / litres) * 100) : 0,
        /* 🔥 Cinder, both ways round: what it pays and what it costs to fail. */
        value: c.value | 0,
        penalty: c.penalty | 0,
        acceptedAt: c.acceptedAt || 0,
        dueAt: c.dueAt || 0,
        msLeft: c.dueAt ? (c.dueAt - now) : 0,
        overdue: !!(c.dueAt && c.dueAt < now),
        batched: !!c.batchId,
      };
    }).sort((a, b) => a.msLeft - b.msLeft);
  } catch (e) { return []; }
}

/* 🏗 HOW WELL BUILT THE YARD IS, as one 0..1 number.

   Asked for: "the extraction is based on the refinery, on how well it is built
   and how much the owner has built."

   Every unit the player owns counts toward its own maximum, and the categories
   are weighted by what they actually contribute to getting crude out of the
   ground and through the gate:

     · process   0.50  — the plant itself. Columns, crackers, treaters. This is
                          the refinery, so it carries half the number alone.
     · storage   0.25  — somewhere to put it. A field crew with nowhere to pour
                          the crude is a crew that comes home half loaded.
     · logistics 0.25  — bays and trucks. Nothing leaves the site without them.

   🔴 IT IS A RATIO OF OWNED TO MAXIMUM, NOT A COUNT. A player who has filled
      every slot they can afford at their stage reads the same as one who has
      filled every slot in the game at the category level — the weighting is
      what separates them. A raw count would make the number unreadable the
      moment the equipment table changed, and every consumer would silently
      re-scale.

   Returns { index, process, storage, logistics, units, maxUnits } so a caller
   can show the working rather than an unexplained multiplier. */
export function buildIndex() {
  const out = { index: 0, process: 0, storage: 0, logistics: 0, units: 0, maxUnits: 0 };
  try {
    const W = { process: 0.50, storage: 0.25, logistics: 0.25 };
    const sum = { process: [0, 0], storage: [0, 0], logistics: [0, 0] };
    Object.keys(EQUIPMENT_TABLE()).forEach((id) => {
      const e = EQUIPMENT_TABLE()[id];
      if (!e || !sum[e.cat]) return;
      const owned = Math.max(0, Math.min(e.max | 0, St.count(id)));
      sum[e.cat][0] += owned;
      sum[e.cat][1] += (e.max | 0);
      out.units += owned;
      out.maxUnits += (e.max | 0);
    });
    let idx = 0;
    Object.keys(W).forEach((k) => {
      const frac = sum[k][1] > 0 ? (sum[k][0] / sum[k][1]) : 0;
      out[k] = +frac.toFixed(4);
      idx += frac * W[k];
    });
    out.index = +Math.max(0, Math.min(1, idx)).toFixed(4);
  } catch (e) {}
  return out;
}
function EQUIPMENT_TABLE() { return EQUIPMENT; }

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
  window.MythicRefinery = { open, close, unlocked, summary, status, wholesaleIndex, buildIndex, acceptedContracts, grades, version: 'r3' };
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
