/* 🚂 THE TRAIN — your mobile base in Ethos Heights.
   ═══════════════════════════════════════════════════════════════════════════
   The city is SHARED; the train is YOURS. Grip lives in Supabase because every
   player raids the same districts (sql/040), but where your train is parked is
   nobody else's business and rides the ordinary profile save. Two different
   questions, two different homes — putting the train in the shared ledger
   would have meant every player shoving one locomotive around.

   🔴 WHAT THE TRAIN IS FOR: it makes the map a POSITION, not a menu.
      Without it every district is one click away and you simply pick the
      weakest one — the map is a list with a nicer background. With it you can
      only deploy where the train can reach, so taking the north of the city
      means MOVING there, through districts the factions are pushing into while
      you travel. That is the whole design; everything below serves it.

   ⚠ FUEL IS NOT A NEW CURRENCY, AND THAT IS DELIBERATE. The game already has
     seven and the handoff explicitly warns against an eighth. Fuel was already
     in the map's own fiction: poi.js lists fuel first in the haul of a Fire
     Station raid, printed on the district panel long before this file existed, so
     raiding for fuel and burning it to move is a loop the player has already
     been told about. It is stored on the train, spent by the train, and
     nothing else in the game can see it.

   ⚠ THIS FILE NEVER TOUCHES THE RUN ENGINE. It gates which district you may
     deploy TO; rlcStartRun and everything after it are untouched, exactly as
     the map itself is. The train is a layer above the run, not inside it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge } from './bridge.js';
import { SITES, SITE_BY_ID, ADJACENCY } from './poi.js';

/* 🎨 THE MODEL SLOT. The map is a 2D canvas, so "the model" is art, not a
   mesh: `art` points at an image and the marker draws it instead of the vector
   locomotive below. The drawn train is still a real fallback rather than a
   placeholder box, so a missing file costs the map a nice sprite and nothing
   else. */
export const TRAIN = {
  /* 🚂 THE COSMIC STEAMLINER, baked from the supplied .glb by tools/bake-train.mjs.
     ⚠ A PNG, NOT THE MESH, AND FOR TWO REASONS EITHER OF WHICH DECIDES IT:
       · the model is 37.8 MB and Cloudflare aborts an ENTIRE deploy on one
         asset over 25 MiB — public/.assetsignore carries that warning because
         it is why production once sat frozen on a stale build;
       · this map is a 2D canvas drawing the train at ONE fixed angle, so a
         sprite baked at that angle is identical on screen for 333 KB, no
         loader and no WebGL context.
     ⚠ The bake angle is the map's own: city.js sets TW=18/TH=9, a 2:1
       isometric, so the camera sat at 45° azimuth and atan(0.5) elevation.
       Re-bake with tools/bake-train.mjs if the model changes; do not eyeball a
       replacement at a different angle or the train will sit in the scene at
       an angle nothing else shares. */
  art: 'assets/artwork/train-ironhold.png',
  name: 'The Ironhold',
  MAX_FUEL: 12,
  /* ⚠ TWO FUEL, AND NO DAY. Travel used to cost a day, back when a day was a
     private counter on this train. The day is the WORLD's now — 24 real hours,
     the same for everyone — so a move cannot spend one without letting one
     player drag the whole city's calendar. Fuel is the cost; the day is the
     drumbeat everybody hears. */
  HOP_COST: 2,             // one adjacent district
  RAID_FUEL: 2,            // what a survived raid brings back
  START_AT: 'chelsea',     // a quiet district in the middle, next to the pocket
  START_FUEL: 6,
};

function mm() {
  const p = bridge().profile() || {};
  if (!p.missionMap || typeof p.missionMap !== 'object') p.missionMap = {};
  return p.missionMap;
}

/* The train, with every field backfilled. A profile written before this file
   existed must not read as undefined and strand the player with no base. */
export function get() {
  const s = mm();
  let t = s.train;
  if (!t || typeof t !== 'object') { t = { at: TRAIN.START_AT, fuel: TRAIN.START_FUEL, legs: 0 }; s.train = t; }
  if (!SITE_BY_ID[t.at]) t.at = TRAIN.START_AT;
  if (typeof t.fuel !== 'number' || !isFinite(t.fuel)) t.fuel = TRAIN.START_FUEL;
  t.fuel = Math.max(0, Math.min(TRAIN.MAX_FUEL, Math.round(t.fuel)));
  if (typeof t.legs !== 'number') t.legs = 0;
  /* 🗓 THE TRAIN NO LONGER KEEPS A CALENDAR. It used to, and that was the
     mistake: a personal day in a shared city means nothing to anyone else.
     The day is the world's now (state.js day(), sql/042). The field is left
     backfilled rather than deleted only so an older profile does not read as
     undefined somewhere downstream; nothing consults it. */
  if (typeof t.day !== 'number' || t.day < 1) t.day = 1;
  return t;
}
function save() { try { bridge().saveProfile(); } catch (e) {} }

export function at() { return get().at; }
export function fuel() { return get().fuel; }
export function day() { return get().day; }

/* 🔴 REACH IS PARKED-OR-ADJACENT, AND NOTHING ELSE. A wider reach makes the
   train decorative; a narrower one (parked district only) makes every raid
   cost a move and turns the map into a chore. One hop out is the smallest
   reach that still leaves a real choice on the board. */
export function reaches(siteId) {
  const t = get();
  if (siteId === t.at) return true;
  return (ADJACENCY[t.at] || []).indexOf(siteId) >= 0;
}
export function reachable() {
  const t = get();
  return [t.at].concat(ADJACENCY[t.at] || []);
}

/* Can the train move to this district right now, and if not, why not? The
   reason is returned rather than logged: the panel prints it on the button, so
   "why is this greyed out" is answerable from the screen where it is asked. */
export function moveCheck(siteId) {
  const t = get();
  if (!SITE_BY_ID[siteId]) return { ok: false, why: 'No such district.' };
  if (siteId === t.at) return { ok: false, why: 'The train is already here.' };
  if ((ADJACENCY[t.at] || []).indexOf(siteId) < 0) {
    return { ok: false, why: 'No rail from ' + SITE_BY_ID[t.at].name + ' — move one district at a time.' };
  }
  if (t.fuel < TRAIN.HOP_COST) return { ok: false, why: 'Out of fuel. Raid a district in reach to bring some back.' };
  return { ok: true };
}

/* A move costs fuel and rolls an encounter — the encounter is rolled by the
   CALLER (render.js) rather than here, because narrating it needs the map's
   log and a redraw, and this module owns neither.
   🔴 IT NO LONGER SPENDS A DAY. The day is the world's, and one player's
      travel must not move a clock everybody else is reading. */
export function move(siteId) {
  const c = moveCheck(siteId);
  if (!c.ok) return c;
  const t = get();
  t.fuel -= TRAIN.HOP_COST;
  t.at = siteId;
  t.legs++;
  save();
  return { ok: true, to: SITE_BY_ID[siteId].name, fuel: t.fuel };
}

/* Fuel comes back from surviving a raid. Called from the same credit pass that
   pushes grip, so a run that was never survived brings nothing — dying costs
   you the ground AND the fuel, which is what makes the position matter. */
export function refuel(n) {
  const t = get();
  const before = t.fuel;
  t.fuel = Math.max(0, Math.min(TRAIN.MAX_FUEL, t.fuel + (n | 0)));
  if (t.fuel !== before) save();
  return t.fuel - before;
}

/* Dev handles, mirroring __mg.msn* rather than inventing a second convention. */
export function debugPark(siteId) {
  if (!SITE_BY_ID[siteId]) return false;
  const t = get(); t.at = siteId; save(); return true;
}
export function debugFuel(n) { const t = get(); t.fuel = Math.max(0, Math.min(TRAIN.MAX_FUEL, n | 0)); save(); return t.fuel; }
export function debugDay(n) { const t = get(); t.day = Math.max(1, n | 0); save(); return t.day; }

/* ── the marker ──────────────────────────────────────────────────────────── */

/* Drawn, not sprited, so the train exists before any art does. Reads as a
   locomotive at map scale: boiler, cab, stack, wheels, and a lamp throwing
   light down the rails. `TRAIN.art` replaces the whole thing when it is set. */
export function drawTrain(c, x, y, k, art) {
  const w = 46 * k, h = 22 * k;
  c.save();
  c.translate(x, y);

  /* 🔴 THE GLOW IS SIZED TO WHAT IS ACTUALLY DRAWN. It used to be sized to the
     vector train and then a sprite two and a half times wider was drawn over
     it, so the Steamliner sat in a puddle of light far too small for it and
     read as pasted on rather than parked. Work out the sprite's footprint
     first, then light that. */
  const hasArt = !!(art && art.complete && art.naturalWidth);
  /* ⚠ SMALL. The train is a MARKER on a city map, not the subject of it — at
     2.8 it covered three districts' worth of rooftops and the map started
     reading as a train with some buildings behind it. 1.25 keeps the
     Steamliner legible (you can still see the lit windows) while leaving the
     city the thing you are looking at. */
  const aw = hasArt ? w * 1.25 : 0;
  const ah = hasArt ? aw * (art.naturalHeight / art.naturalWidth) : 0;
  const glowW = hasArt ? aw * 0.52 : w * 1.15;

  /* the ground glow — the base is lit, and it reads as "you are here" at a
     glance without a label */
  const g = c.createRadialGradient(0, h * 0.55, 0, 0, h * 0.55, glowW);
  g.addColorStop(0, 'rgba(255,208,120,0.30)');
  g.addColorStop(1, 'rgba(255,208,120,0)');
  c.fillStyle = g;
  c.beginPath(); c.ellipse(0, h * 0.55, glowW, h * 0.62, 0, 0, Math.PI * 2); c.fill();

  if (hasArt) {
    /* ⚠ THE SPRITE IS TRIMMED TO ITS ALPHA BOX (tools/bake-train.mjs), so its
       bottom edge IS the train's wheels. Sitting it on the ground is therefore
       arithmetic — before the trim this was a fudge factor and the train
       floated above the city. */
    c.drawImage(art, -aw / 2, -ah + h * 0.5, aw, ah);
    c.restore();
    return;
  }

  const body = '#d8c48a', dark = '#7a6a45', hot = '#ffcf6a';
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.beginPath(); c.ellipse(0, h * 0.5, w * 0.52, h * 0.18, 0, 0, Math.PI * 2); c.fill();
  // boiler
  c.fillStyle = body;
  c.fillRect(-w * 0.46, -h * 0.34, w * 0.62, h * 0.62);
  // cab
  c.fillRect(w * 0.16, -h * 0.62, w * 0.30, h * 0.90);
  c.fillStyle = dark;
  c.fillRect(w * 0.22, -h * 0.52, w * 0.18, h * 0.30);   // cab window
  // stack
  c.fillStyle = body;
  c.fillRect(-w * 0.40, -h * 0.66, w * 0.12, h * 0.34);
  // lamp
  c.fillStyle = hot;
  c.beginPath(); c.arc(-w * 0.46, -h * 0.10, h * 0.13, 0, Math.PI * 2); c.fill();
  // wheels
  c.fillStyle = dark;
  [-0.34, -0.10, 0.16, 0.36].forEach(f => {
    c.beginPath(); c.arc(w * f, h * 0.30, h * 0.17, 0, Math.PI * 2); c.fill();
  });
  c.restore();
}
