/* ════════════════════════════════════════════════════════════════════════════
   🔌 THE INTERCONNECTOR — electricity crossing the outside connection.
   ----------------------------------------------------------------------------
   This file answers three questions and nothing else:
       CAN the city trade power right now, and if not, WHAT does it build?
       HOW MUCH may cross the link in each direction?
       WHAT is that energy worth, in Cinder?
   grid.js decides how much actually flows; index.js hands the bill to
   /src/economy. Nothing here moves money, paints anything or touches a tile.

   🔴 WHY THIS EXISTS NOW AND DID NOT BEFORE.
      The CS2 reference panel this module was built against carries an
      ELECTRICITY TRADE meter — "Import: 0 kW / Export: 0 kW". panel.js dropped
      that row deliberately and said why: node-city had no neighbour grid to
      import from, so the row could only ever read 0 kW forever, which is the
      decorative fallback this integration refuses. `/src/outside` shipped after
      that decision: a highway past the map, a Highway Interchange the player
      builds, a cached connection test over node-city's OWN road graph, and a
      gate that already stops caravans, shipments and cross-city deals when the
      city is cut off. That is the neighbour link the meter needed.

   🔴 AND IT IS GATED ON EXACTLY THE SAME RULE AS THE CARAVAN.
      `window.MythicOutside.state().connected` — the same field
      `MythicOutside.gate('caravan')` tests, read through the same cached
      compute. A city that cannot send a caravan cannot import a watt, for the
      identical reason, and this file does not re-derive that test: a second
      definition of "connected" is guaranteed to drift the first time a road
      tile gains a property, which is the argument /src/outside/link.js makes
      for not writing its own BFS.
      ⚠ INCLUDING THE GRANDFATHER WAIVER. `connected` is true for a live city
        that predates /src/outside and could not be auto-linked, for the length
        of one expiring grace period. Reading `st.real` instead would cut the
        power link on exactly the cities the waiver exists to protect, while
        leaving their caravans running — two different answers to one question.

   🔴 THREE ABSENCES, THREE DIFFERENT READINGS, AND NEVER A SILENT ZERO.
      "A guarded read that silently substitutes a plausible value is
      indistinguishable from a working integration" is this branch's most
      expensive lesson (every address in the game was fictional for a while).
      A trade meter reading 0 kW is a CLAIM — that the link is live and idle.
      So:
        · no window.MythicOutside  -> `why` says the connection cannot be
                                      tested, and nothing is traded
        · no window.MythicEconomy  -> `why` says the energy cannot be priced,
                                      and nothing is traded. There is nowhere
                                      for the money to go, and inventing
                                      somewhere is the retired Cinder Forge.
        · connected and balanced   -> a REAL 0 kW, and the ONLY one of the
                                      three the panel is allowed to draw as 0.
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER } from './tuning.js';

/* ── The two globals this file reads. Both are genuine `window` properties
   (module registrations), unlike node-city's `game`/`BUILDINGS`, which are
   top-level `const` and invisible from here — see index.js's globals-trap
   header. Re-asked every call rather than cached, because either module can
   land or fail after this one has already mounted. */
function outside() { try { return (typeof window !== 'undefined' && window.MythicOutside) || null; } catch (e) { return null; } }
function economy()  { try { return (typeof window !== 'undefined' && window.MythicEconomy) || null; } catch (e) { return null; } }

/* The tariff, both directions, from POWER.trade. The spread runs AGAINST the
   city in both directions — that is what makes a round trip through the battery
   a loss and stops two cities laundering electricity between them, the same job
   ECON.trade.spreadPct does for goods. */
export function tariffs() {
  const T = POWER.trade;
  return { imp: T.tariff * (1 + T.spread), exp: T.tariff * (1 - T.spread) };
}

/* ── THE REFUSAL ──────────────────────────────────────────────────────────────
   House style is node-city's own, and the model is tryPlace()'s road-cap
   message: say WHAT is refused, WHY, and exactly what fixes it. "Cannot import
   power" on its own reads as a bug and gets reported as one.
   ⚠ THE FIX TEXT IS NOT WRITTEN HERE. /src/outside owns the wording of "build a
     Highway Interchange on the north edge and run road to it" — one place, one
     wording — and hands it over as `st.fix`. Copying it would be a second copy
     to keep in step with a building that may be renamed. */
const SUBJECT = '⛔ No electricity can cross the city boundary';

/** What the link can do this tick.
    Returns, always, with every field populated:
      ok            may anything cross at all
      why / fix     the refusal, in node-city's voice (empty when ok)
      importCap     units/min the city may draw in   (0 when refused/curtailed)
      exportCap     units/min the city may push out  (0 when refused)
      arrears       unpaid electricity bill, in Cinder, from /src/economy
      curtailed     import specifically stopped by that debt
      present/priced/connected   which of the three absences applies    */
export function read() {
  const O = outside(), E = economy();
  const T = POWER.trade;
  const out = { ok: false, why: '', fix: '', importCap: 0, exportCap: 0,
                arrears: 0, curtailed: false,
                present: !!O, priced: false, connected: false,
                viaLabel: '', rating: T.linkUnitMin };

  if (!O || typeof O.state !== 'function') {
    out.why = SUBJECT + ' — the outside-connection module is not loaded, so there is no way to test whether this city is joined to the national grid.';
    out.fix = 'This is a missing script (/src/outside), not something you can build. Reload the city; if it persists the highway, the interchange and the trade gate are all absent, not just this meter.';
    return out;
  }

  /* /src/outside caches this and drops the cache from refreshRoadArea, which is
     the choke point every road placement, demolition and load already funnels
     through — so this is a field read, not a BFS, and is safe per tick. */
  let st = null;
  try { st = O.state(); } catch (e) { st = null; }
  if (!st) {
    out.why = SUBJECT + ' — the outside-connection test did not answer this tick.';
    out.fix = 'Nothing to build. The link will report again on the next tick.';
    return out;
  }
  out.connected = !!st.connected;
  out.viaLabel = st.viaLabel || '';

  if (!st.connected) {
    /* THE SAME REFUSAL SHAPE MythicOutside.gate() USES for caravans, shipments
       and cross-city deals: subject, reason, fix, in that order. */
    out.why = SUBJECT + ' — it has no outside connection. ' + (st.reason || '');
    out.fix = st.fix || '';
    return out;
  }

  if (!E || typeof E.utilityTrade !== 'function' || !E.ready || !E.ready()) {
    /* 🔴 CONNECTED, BUT UNPRICEABLE. This is the branch that must never quietly
       become "trade 0 kW": the wires are there and the city is refusing to use
       them because there is nowhere honest to put the money. Trading anyway
       would credit the player for exported power out of nothing — the retired
       Cinder Forge, exactly. */
    out.why = SUBJECT + ' — the city economy is not running, so imported power could not be paid for and exported power could not be banked anywhere.';
    out.fix = 'Nothing to build: the economy module (/src/economy) has not started. The link comes back on its own the moment it does.';
    return out;
  }
  out.priced = true;

  /* 💸 THE UNPAID BILL. /src/economy settles the day's energy out of the
     treasury and reports whatever it could not pay. Until that clears the link
     imports NOTHING — a city that keeps drawing power it cannot pay for is a
     city being handed free electricity, which is the "credited whether or not
     the shop could pay" shape of the third leak ECONOMY.md documents.
     ⚠ EXPORT IS DELIBERATELY LEFT OPEN while in arrears. Selling the surplus is
       how the debt gets paid off; cutting both legs would strand the city with
       no way back, which is a dead end, not a consequence. */
  try {
    const r = E.utilityReport ? E.utilityReport() : null;
    if (r && isFinite(r.arrears) && r.arrears > 0) out.arrears = r.arrears;
  } catch (e) {}

  out.ok = true;
  out.exportCap = T.linkUnitMin;
  if (out.arrears > 0 && T.curtailOnArrears) {
    out.curtailed = true;
    out.importCap = 0;
    out.why = '⛔ The neighbouring grid has cut this city\'s import — ' + out.arrears.toFixed(2) +
              ' 🔥 of electricity was delivered and not paid for. Export is still open: sell your surplus, or raise the treasury, and the import comes back on the next economic day.';
    out.fix = 'Clear the bill. Any Cinder in the city treasury goes to it first at the close of the economic day.';
  } else {
    out.importCap = T.linkUnitMin;
  }
  return out;
}

/** The Cinder value of energy that crossed the link, given a tick length in
    minutes. One place, so grid.js and the panel cannot disagree about it. */
export function value(importUnitMin, exportUnitMin) {
  const t = tariffs();
  return { importValue: Math.max(0, importUnitMin) * t.imp,
           exportValue: Math.max(0, exportUnitMin) * t.exp };
}

export default { read, value, tariffs };
