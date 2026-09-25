/* 🎚 MISSION MAP STATE — who holds what, and how hard.
   ═══════════════════════════════════════════════════════════════════════════
   ONE CITY, SHARED BY EVERYONE. Ethos Heights lives in Supabase
   (sql/040_mission_map_coop.sql): every player's survived raid pushes the
   factions back on the same map, and the factions push back on a clock the
   SERVER owns. The local board below is still here and still correct — it is
   what a signed-out or offline player plays, and what everyone plays if the
   migration is never applied.

   🔴 THE PORT COST NOTHING, WHICH WAS THE POINT. This module's original
      header said the local shape was chosen so it would move to an
      append-only ledger 'without a rewrite'. It did: grip is still
      { f, g } per site to every reader in render.js and graph.js, and the
      cloud path just fills that same object from mission_state(). Not one
      renderer changed.

   🔴 WHEN THE CLOUD IS LIVE, THE LOCAL TICK MUST NOT RUN. The server already
      applied those pushes; running them again on top would advance the
      factions at double rate for anyone who had the game open, and the
      next sync would silently throw the difference away. CLOUD gates it.

   ⚠ THE SERVER IS THE ONLY WRITER. Nothing here POSTs a grip value — it
     calls mission_raid(id) and the server decides the cut. A client that
     could name its own number could clear the city from the console.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge } from './bridge.js';
import { SITES, SITE_BY_ID, FACTIONS, FACTION_IDS, ADJACENCY, isSealed } from './poi.js';
import * as TRN from './train.js';
import * as CIT from './citizens.js';

/* 🔴 A DAY IS 24 REAL HOURS, AND IT BELONGS TO EVERYONE. It used to be a
   personal counter on each player's train that ticked when they travelled —
   so your day 14 and someone else's day 3 were both true and neither meant
   anything to the other. For a city everyone raids, "day 6 in Ethos Heights"
   has to mean ONE thing. The server owns it (sql/042); this constant is the
   offline board's copy of the same rule. */
const DAY_MS    = 24 * 60 * 60 * 1000;
const TICK_MS   = DAY_MS;               // the factions move once a day, together
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
  /* 🧍 …and what each district's people think of you. Backfilled the same
     way, and deliberately WITHOUT bumping `s.v`: the version test above
     RESEEDS the whole map, so bumping it to add a field would wipe every
     player's grip, fortifications and credited runs to add an empty
     object. A new key with a default is not a new schema. */
  if (!s.cit || typeof s.cit !== 'object') s.cit = {};
  return s;
}
export function save() { try { bridge().saveProfile(); } catch (e) {} }

/* ── the shared city ────────────────────────────────────────────────────── */

/* Latches true the first time the server answers. Everything that would
   otherwise simulate the world locally checks this. */
let CLOUD = false;
let syncing = false;
let lastSyncAt = 0;
/* 📓 THE JOURNAL. Server news, travel days and raid results all land here and
   STAY here for a while.
   🔴 THIS WAS A ONE-SHOT QUEUE AND THAT WAS WRONG. drainLog() emptied it on
      read, so a line survived exactly one paint: cross the city, read what
      happened out there, click any district — and the log was back to "The
      city is quiet." The player's own journey erased itself as they looked
      at it. Selecting a district is not an acknowledgement that you have
      finished reading.
   ⚠ BOUNDED, because it rides the profile save. Twelve lines is a session's
     worth of news and a rounding error in the save. */
const JOURNAL_MAX = 12;
let journalLines = [];
export function note(line) { if (line) { journalLines.push(line); if (journalLines.length > JOURNAL_MAX) journalLines = journalLines.slice(-JOURNAL_MAX); } }
export function noteAll(lines) { (lines || []).forEach(note); }
export function journal() { return journalLines.slice(); }
/* kept as the name the rest of the module already used for "tell the player" */
export function pushLog(line) { note(line); }
/* 🎲 A player's own news — what happened to THEM on a travel day — goes into
   the same journal the server's news does, so the log reads as one story
   instead of two feeds the player has to reconcile. (pushLog is defined
   above, beside the journal itself.) */
/* The shared board, applied from outside this module — an encounter's faction
   push comes back as a whole board from the server and the map must redraw
   from THAT rather than from a local guess about what the push did. */
export function applyBoardPublic(board) { return applyBoard(board); }
export function isShared() { return CLOUD; }

/* Fold a server board into the local grip shape. Returns the lines worth
   telling the player about — computed by DIFFING what they last saw against
   what is true now, because the pushes happened while they were away and
   there is no other way to narrate them. */
function applyBoard(board) {
  const s = mm(), log = [];
  if (!board || !Array.isArray(board.sites)) return log;
  const next = {};
  board.sites.forEach(r => { if (r && r.site) next[r.site] = { f: r.faction || null, g: Math.max(0, Math.min(100, r.grip | 0)) }; });
  SITES.forEach(site => {
    const was = s.grip[site.id] || { f: null, g: 0 };
    const now = next[site.id] || { f: null, g: 0 };
    if (was.f && !now.f) log.push(site.name + ' is clear — ' + FACTIONS[was.f].name + ' driven out.');
    else if (!was.f && now.f) log.push(FACTIONS[now.f].name + ' pushed into ' + site.name + '.');
    else if (was.f && now.f && was.f !== now.f) log.push(FACTIONS[now.f].name + ' took ' + site.name + ' from ' + FACTIONS[was.f].name + '.');
    else if (now.f && was.g < 90 && now.g >= 90) log.push(FACTIONS[now.f].name + ' now holds ' + site.name + ' outright.');
    s.grip[site.id] = now;
  });
  noteAll(log);
  if (board.day) s.day = board.day | 0;
  /* 🕛 WHEN THE SERVER'S DAY STARTED, so the map can say how long is left of
     it. Parsed from the server's own clock rather than stamped locally — a
     client's idea of "now" is exactly the thing that must not decide when
     the shared day rolls over. */
  if (board.lastTick) { const t = Date.parse(board.lastTick); if (!isNaN(t)) s.dayStart = t; }
  s.lastTick = Date.now();
  save();
  return log;
}

/* Pull the shared city. mission_tick() is SELF-THROTTLED server-side — it
   applies only the 4h windows actually owed and returns the board either way
   — so calling it on every map open is both the read AND the world's
   heartbeat, with no cron to run and no client trusted to say what time it
   is. */
/* Called on every map render. Cheap when it declines, which is most of the
   time: the server's own tick is self-throttled to 4h windows, so polling it
   harder than a player can act would buy nothing. */
export function maybeSync(onNews) {
  /* 🔴 DO NOT BURN THE WINDOW WHEN THERE IS NOTHING TO ASK. Stamping the
     throttle before checking for a database meant a player who opened the map
     signed-out — which is the ordinary first paint, before auth resolves —
     then signed in, sat looking at a LOCAL board for twenty seconds while the
     shared city was one call away. The check is cheap; the stamp is not. */
  let db = null;
  try { db = bridge().cloud(); } catch (e) { db = null; }
  if (!db) return;
  const now = Date.now();
  if (now - lastSyncAt < 20000) return;
  lastSyncAt = now;
  sync().then(lines => { if (lines.length && typeof onNews === 'function') onNews(lines); });
}

export async function sync() {
  if (syncing) return [];
  const db = (() => { try { return bridge().cloud(); } catch (e) { return null; } })();
  if (!db) return [];
  syncing = true;
  try {
    const { data, error } = await db.rpc('mission_tick');
    if (error || !data) return [];
    CLOUD = true;
    return applyBoard(data);
  } catch (e) { return []; }
  finally { syncing = false; }
}

/* A survived raid, posted to the shared ledger. The server decides the cut,
   refuses a mission id this player already credited, and returns the whole
   board so the map redraws from truth rather than from a local guess. */
async function creditShared(ids) {
  const db = (() => { try { return bridge().cloud(); } catch (e) { return null; } })();
  if (!db || !ids.length) return [];
  let board = null;
  for (const id of ids) {
    try {
      const { data, error } = await db.rpc('mission_raid', { p_mission_id: id });
      if (!error && data) { CLOUD = true; board = data; }
    } catch (e) {}
  }
  return board ? applyBoard(board) : [];
}

/* The shared day, and how much of it is left. Falls back to the local board's
   own clock when signed out, so an offline player still sees a day turn. */
export function day() { return mm().day | 0; }
export function msToNextDay() {
  const s = mm();
  const start = s.dayStart || s.lastTick || Date.now();
  return Math.max(0, DAY_MS - ((Date.now() - start) % DAY_MS));
}

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
  /* 🔴 THE SERVER ALREADY DID THIS. Running the local push on top of a synced
     board would advance the factions at double rate for whoever happened to
     have the game open, and the next sync would throw the difference away —
     so the city would move at a speed that depended on who was watching. */
  if (CLOUD && !force) return [];
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
  /* ☁ SHARED: hand the ids to the server and let it decide. It keeps its own
     per-player credit ledger, so the local `credited` list is not consulted —
     a player who clears the same district from two devices must still credit
     once, and only the server can know that. */
  if (CLOUD) {
    const s2 = mm();
    const fresh = (completedIds || []).filter(id =>
      typeof id === 'string' && id.indexOf('msn_') === 0 && s2.credited.indexOf(id) < 0);
    if (fresh.length) {
      fresh.forEach(id => s2.credited.push(id));   // don't re-post on every render
      /* 🧍 THE PEOPLE SAW YOU COME BACK. Earned on the SHARED path too —
         citizen standing is this player's own opinion-of-them, not part of
         the shared board, so it is credited here rather than waiting on the
         server round trip that decides the grip.
         ⚠ Whether the faction was actually driven out is the SERVER's call
           in this mode, so only the survival half is paid here. Cleared is
           paid on the local path below, where we know. */
      fresh.forEach((id) => {
        const sid = id.split('_')[1];
        const line = CIT.gain(s2, sid, CIT.CIT_GAIN.raidSurvived, 'you walked back out');
        if (line) note(line);
        TRN.refuel(CIT.fuelBonus(s2, sid));
      });
      /* 🚂 …and the run brings fuel home. Only a SURVIVED run reaches here
         (the engine writes rlcCompleted on a finalBoss clear and nowhere
         else), so dying costs the ground AND the fuel — which is what makes
         where the train is parked a decision rather than a formality. */
      TRN.refuel(TRN.TRAIN.RAID_FUEL * fresh.length);
      save();
      creditShared(fresh).then(lines => {
        if (lines.length) { try { bridge().render(); } catch (e) {} }
      });
    }
    return [];
  }
  const s = mm(), log = [];
  (completedIds || []).forEach(id => {
    if (typeof id !== 'string' || id.indexOf('msn_') !== 0) return;
    if (s.credited.indexOf(id) >= 0) return;
    s.credited.push(id);
    /* 🚂 FUEL COMES HOME FIRST, AND BEFORE THE GRIP GUARD. This sat below the
       'is anyone still holding this district' early-return, so surviving a run
       into a district that was ALREADY clear brought nothing back — the player
       did the work, got out alive, and the tank did not move. Fuel is paid for
       surviving, not for finding someone to fight. */
    TRN.refuel(TRN.TRAIN.RAID_FUEL);
    const siteId = id.split('_')[1];
    /* 🚂 …plus whatever this district's people chip in. Paid before the
       grip guard below returns, for the same reason the base fuel is:
       raiding a district that is already clear is still a run survived. */
    TRN.refuel(CIT.fuelBonus(s, siteId));
    const g = s.grip[siteId];
    if (!g || !g.f) return;
    const cut = RAID_CUT[0] + Math.round(Math.random()*(RAID_CUT[1]-RAID_CUT[0]));
    const fac = FACTIONS[g.f].name;
    g.g = Math.max(0, g.g - cut);
    if (!g.g) { g.f = null; log.push(SITE_BY_ID[siteId].name + ' is clear — ' + fac + ' driven out.'); }
    else log.push(SITE_BY_ID[siteId].name + ' raided — ' + fac + ' grip down ' + cut + '.');
    /* 🧍 …and the people of the district saw all of it. Clearing pays on TOP
       of surviving, because driving a faction out is the thing they will
       actually remember. */
    {
      const clr = !s.grip[siteId].f;
      const l1 = CIT.gain(s, siteId, CIT.CIT_GAIN.raidSurvived + (clr ? CIT.CIT_GAIN.raidCleared : 0),
                          clr ? 'you drove them out' : 'you walked back out');
      if (l1) log.push(l1);
    }
  });
  if (log.length) save();
  return log;
}

export function fortify(siteId) {
  const s = mm();
  if (s.grip[siteId] && s.grip[siteId].f) return false;   // can't dig in under fire
  s.fort[siteId] = 2;
  /* 🧍 Digging in for a district is done FOR the people living in it, so it
     is the other thing they notice. Worth less than a raid: it costs no
     blood and it is not a thing anybody watched you do. */
  { const line = CIT.gain(s, siteId, CIT.CIT_GAIN.fortified, 'you dug in for them'); if (line) note(line); }
  save();
  return true;
}
export function isFortified(siteId) { return (mm().fort[siteId]|0) > 0; }
/* 🧍 The panel's read-only window onto citizen standing. Exported from here
   rather than letting render.js reach into citizens.js with its own mm(),
   so there is exactly one place that knows where the store lives. */
export function citizens(siteId) {
  const s = mm(), v = CIT.of(s, siteId);
  return { value: v, max: CIT.CIT_MAX, band: CIT.bandOf(v), fuel: CIT.fuelBonus(s, siteId) };
}
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
