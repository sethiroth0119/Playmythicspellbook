/* ════════════════════════════════════════════════════════════════════════════
   🏰 CAMP DEFENCE — module entry. Registers window.MythicCampDefense.
   ----------------------------------------------------------------------------
   STATUS: the derivation and the Athena adapter are COMPLETE and tested
   (_campdefense_smoke.mjs). The battle hand-off is a documented contract with
   a working `preview()` but is NOT yet wired into a live raid — by request, so
   the 3D map can be built in Athena Engine first and the fight can be tuned
   against the real thing rather than a guess.

   WHAT WORKS NOW:
     MythicCampDefense.preview()      the derived map + fortify score, for the
                                      camp panel — playable-shaped data today
     MythicCampDefense.map()          the full battle map (tiles/cover/spawns)
     MythicCampDefense.registerAthena()  makes the camp a buildable 3D world

   WHAT IS LEFT, and it is deliberately ONE function:
     `startDefense(raid)` below. It has the map, the spawns and the structures;
     it needs the battle to accept an externally-supplied grid. When that seam
     exists in index.html, this is where it plugs in — nothing else in this
     folder changes.

   🔴 A DEFENCE IS A READ OF THE CAMP, NEVER A WRITE. See campdefense.map.js.
   Losing a raid may destroy structures IN THE BATTLE; persisting that damage
   back to Forge.campLayout is a separate, deliberate decision and is not done
   here. Until it is, a lost defence costs what raids already cost.
   ════════════════════════════════════════════════════════════════════════════ */

import { buildBattleMap, entryPoints, fortifyScore, athenaAdapter, TILE, DEFAULT_DIMS } from './campdefense.map.js';

function b() { try { return window.MythicCampDefenseBridge || null; } catch (e) { return null; } }

let _warned = false;
function ready() {
  if (b()) return true;
  if (!_warned) { _warned = true; try { console.warn('[campdefense] window.MythicCampDefenseBridge absent — camp layout will not drive defence.'); } catch (e) {} }
  return false;
}

function layout() { try { return (b() && b().campLayout && b().campLayout()) || null; } catch (e) { return null; } }
function zone() { try { return (b() && b().activeZone && b().activeZone()) || null; } catch (e) { return null; } }

/* The full derived battle map. */
function map() {
  try { return buildBattleMap(layout(), zone(), { source: 'campLayout' }); }
  catch (e) {
    try { console.warn('[campdefense] derivation failed — falling back to an empty yard', e); } catch (e2) {}
    return buildBattleMap(null, null, { source: 'fallback' });
  }
}

/* A compact summary for the camp panel: how defensible is this camp, and why.
   The "why" matters more than the score — "3 breaches on the north side" tells
   a player what to build next; "Fortify: 41" tells them nothing. */
function preview() {
  const m = map();
  const bySide = {};
  for (const br of m.breaches) bySide[br.side] = (bySide[br.side] | 0) + 1;

  const advice = [];
  if (!m.structures.length) advice.push('Nothing built yet — any raid walks straight in.');
  if (m.breaches.length > 4) advice.push(`${m.breaches.length} ways in. Walls would funnel them.`);
  else if (m.breaches.length) advice.push(`Raiders enter from: ${Object.keys(bySide).join(', ')}.`);
  if (m.cover.length < m.w * m.h * 0.08) advice.push('Almost no cover — buildings placed closer together would give your defenders something to fight behind.');
  if (!m.spawns.defender.length) advice.push('No doorways to deploy from.');

  return {
    w: m.w, h: m.h,
    score: m.fortifyScore,
    structures: m.structures.length,
    coverTiles: m.cover.length,
    breaches: m.breaches,
    breachesBySide: bySide,
    defenderPosts: m.spawns.defender.length,
    advice,
  };
}

/* ── THE REMAINING SEAM ──────────────────────────────────────────────────
   Hand the derived map to the battle. Returns { ok:false, why } until the
   battle exposes a "start with this grid" entry point.

   `raid` is whatever the raid system already knows: { attackers, tier, at }.
   The mapping is done here so the battle never learns what a camp is. */
function startDefense(raid) {
  if (!ready()) return { ok: false, why: 'bridge absent' };
  const m = map();

  const req = {
    kind: 'campDefense',
    grid: { w: m.w, h: m.h, tiles: Array.from(m.tiles) },
    cover: m.cover,
    structures: m.structures,
    spawns: m.spawns,
    objective: { type: 'survive', turns: (raid && raid.turns) || 8,
                 loseIf: 'structuresDestroyed', threshold: Math.ceil(m.structures.length * 0.5) },
    attackers: (raid && raid.attackers) || [],
    defenders: (() => { try { return (b().roster && b().roster()) || []; } catch (e) { return []; } })(),
  };

  let start = null;
  try { start = b().startBattleWithGrid; } catch (e) {}
  if (typeof start !== 'function') {
    try { console.info('[campdefense] battle grid hand-off not wired yet — map derived and ready:', req); } catch (e) {}
    return { ok: false, why: 'battle does not accept an external grid yet', request: req };
  }
  try { return { ok: true, result: start(req) }; }
  catch (e) { return { ok: false, why: String((e && e.message) || e), request: req }; }
}

/* ⚒ Make the camp a buildable Athena world. Safe to call before Athena loads —
   it queues on window.__athenaGames, which Athena drains at boot (see
   src/mapforge/mapforge.games.js). */
function registerAthena() {
  const adapter = athenaAdapter(layout);
  try {
    if (window.AthenaEngine && window.AthenaEngine.games && window.AthenaEngine.games.register) {
      return !!window.AthenaEngine.games.register(adapter);
    }
  } catch (e) {}
  try {
    window.__athenaGames = window.__athenaGames || [];
    window.__athenaGames.push(adapter);
    return true;
  } catch (e) { return false; }
}

try {
  window.MythicCampDefense = {
    map, preview, startDefense, registerAthena,
    buildBattleMap, entryPoints, fortifyScore,
    TILE, DEFAULT_DIMS,
    available: () => ready(),
    VERSION: 'campdefense-1.0.0-prep',
  };
  registerAthena();
  try { console.info('%c🏰 MythicCampDefense%c ready — camp layout derives a battle map; Athena world registered.', 'color:#c9a24a;font-weight:700', 'color:inherit'); } catch (e) {}
} catch (e) {}
