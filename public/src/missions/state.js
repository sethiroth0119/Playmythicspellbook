/* 🎚 MISSION MAP STATE — who holds what, and how hard.
   ═══════════════════════════════════════════════════════════════════════════
   LOCAL ONLY, DELIBERATELY. Grip lives in Profile.missionMap and rides the
   existing profile save. There is no Supabase here and no table for it yet:
   the co-op layer (everyone's raids summing against one shared map) is a
   separate decision with its own migration and its own RLS, and shipping the
   single-player half first means the map is playable before any of that
   exists — and still plays if it never does.

   ⚠ WHEN THE SHARED VERSION LANDS, THE TICK MOVES SERVER-SIDE. A client-side
     regrow means a player who doesn't open the game has a map that never
     decays, and two clients disagreeing about who holds Elm Street is a
     desync you debug for a week. The shape below (append a delta, sum for
     grip) is chosen so it ports to an append-only ledger without a rewrite.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge } from './bridge.js';
import { SITES, SITE_BY_ID, FACTIONS, FACTION_IDS, ADJACENCY, isSealed } from './poi.js';

const TICK_MS   = 4 * 60 * 60 * 1000;   // the factions move every 4 real hours
const MAX_CATCH = 6;                    // …but a month away is not 180 pushes
const RAID_CUT  = [12, 22];             // grip a survived run takes off

/* The opening board. A survivor pocket in the middle, pressure from both ends
   and something very wrong in the park. */
function seed() {
  return {
    v: 1, day: 1, lastTick: Date.now(), credited: [], fort: {},
    grip: {
      harlem:{f:'scum',g:38},      uws:{f:'anomalies',g:22}, park:{f:'anomalies',g:96},
      ues:{f:null,g:0},            hells:{f:'scum',g:71},    midtown:{f:'scp',g:88},
      chelsea:{f:null,g:0},        village:{f:null,g:0},     soho:{f:'scum',g:14},
      battery:{f:'scp',g:57},
    },
  };
}

export function mm() {
  const p = bridge().profile() || {};
  let s = p.missionMap;
  if (!s || typeof s !== 'object' || s.v !== 1) { s = seed(); p.missionMap = s; }
  // Defensive backfill — a site added to SITES after a profile was written
  // must not read as undefined and crash a renderer.
  if (!s.grip || typeof s.grip !== 'object') s.grip = seed().grip;
  SITES.forEach(site => { if (!s.grip[site.id]) s.grip[site.id] = { f:null, g:0 }; });
  if (!Array.isArray(s.credited)) s.credited = [];
  if (!s.fort || typeof s.fort !== 'object') s.fort = {};
  return s;
}
export function save() { try { bridge().saveProfile(); } catch (e) {} }

export function hold(siteId) { return mm().grip[siteId] || { f:null, g:0 }; }
export function gripOf(siteId) { const h = hold(siteId); return h.f ? (h.g|0) : 0; }
export function holderOf(siteId) { const h = hold(siteId); return h.f || 'survivors'; }

/* Share of the city's blocks each faction is wearing. Counted off the real
   building list so the readout can never drift from what is on screen. */
export function census(builds) {
  const out = { survivors:0, scum:0, anomalies:0, scp:0 };
  builds.forEach(b => {
    const h = hold(b.id);
    out[(h.f && b.roll*100 < h.g) ? h.f : 'survivors']++;
  });
  const n = builds.length || 1;
  Object.keys(out).forEach(k => { out[k] = Math.round(out[k]/n*100); });
  return out;
}

/* ── the tick ───────────────────────────────────────────────────────────── */

function pushOnce(s, log) {
  const held = SITES.filter(site => s.grip[site.id].f);
  held.forEach(site => {
    const g = s.grip[site.id], p = FACTIONS[g.f].push;
    const before = g.g;
    g.g = Math.min(100, g.g + p.rate[0] + Math.round(Math.random()*(p.rate[1]-p.rate[0])));
    if (before < 90 && g.g >= 90) log.push(FACTIONS[g.f].name + ' now holds ' + site.name + ' outright.');
    if (Math.random() < p.spread) {
      const open = (ADJACENCY[site.id] || []).filter(n =>
        !s.grip[n].f && !((s.fort[n]|0) > 0 && Math.random() < 0.5));
      if (open.length) {
        const n = open[Math.floor(Math.random()*open.length)];
        s.grip[n].f = g.f;
        s.grip[n].g = p.seed[0] + Math.round(Math.random()*(p.seed[1]-p.seed[0]));
        log.push(FACTIONS[g.f].name + ' pushed into ' + SITE_BY_ID[n].name + '.');
      }
    }
  });
  Object.keys(s.fort).forEach(k => { if (--s.fort[k] <= 0) delete s.fort[k]; });
  s.day++;
}

/* Catch up however many ticks are owed since the player last looked. Returns
   the lines worth telling them about, newest last. */
export function tick(force) {
  const s = mm(), now = Date.now();
  let owed = force ? 1 : Math.floor((now - (s.lastTick || now)) / TICK_MS);
  if (owed <= 0) return [];
  owed = Math.min(owed, MAX_CATCH);
  const log = [];
  for (let i = 0; i < owed; i++) pushOnce(s, log);
  s.lastTick = now;
  save();
  return log;
}

/* ── crediting a survived run ────────────────────────────────────────────
   Deliberately a POLL, not a hook. A run is credited when the map next
   renders and sees its id sitting in Profile.rlcCompleted — which the engine
   only writes when a finalBoss node is cleared. Dying never lands there, so
   "you only take ground by getting out alive" is true by construction rather
   than by a check we could forget. It also means zero new call sites inside
   the run flow, which is the part of index.html least safe to touch. */
export function creditRuns(completedIds) {
  const s = mm(), log = [];
  (completedIds || []).forEach(id => {
    if (typeof id !== 'string' || id.indexOf('msn_') !== 0) return;
    if (s.credited.indexOf(id) >= 0) return;
    s.credited.push(id);
    const siteId = id.split('_')[1];
    const g = s.grip[siteId];
    if (!g || !g.f) return;
    const cut = RAID_CUT[0] + Math.round(Math.random()*(RAID_CUT[1]-RAID_CUT[0]));
    const fac = FACTIONS[g.f].name;
    g.g = Math.max(0, g.g - cut);
    if (!g.g) { g.f = null; log.push(SITE_BY_ID[siteId].name + ' is clear — ' + fac + ' driven out.'); }
    else log.push(SITE_BY_ID[siteId].name + ' raided — ' + fac + ' grip down ' + cut + '.');
  });
  if (log.length) save();
  return log;
}

export function fortify(siteId) {
  const s = mm();
  if (s.grip[siteId] && s.grip[siteId].f) return false;   // can't dig in under fire
  s.fort[siteId] = 2;
  save();
  return true;
}
export function isFortified(siteId) { return (mm().fort[siteId]|0) > 0; }
export function sealed(siteId) { return isSealed(hold(siteId)); }

/* Admin/dev handles. Mirrors the __mg.* console surface the rest of the app
   uses rather than inventing a second convention. */
export function debugSet(siteId, factionId, grip) {
  const s = mm();
  if (!s.grip[siteId]) return false;
  s.grip[siteId].f = FACTION_IDS.indexOf(factionId) >= 0 ? factionId : null;
  s.grip[siteId].g = Math.max(0, Math.min(100, grip|0));
  if (!s.grip[siteId].f) s.grip[siteId].g = 0;
  save();
  return true;
}
export function debugReset() {
  const p = bridge().profile() || {};
  p.missionMap = seed();
  save();
  return true;
}
