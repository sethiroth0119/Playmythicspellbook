/* ════════════════════════════════════════════════════════════════════════════
   🌬 THE WIND — a per-city endowment, plus a live reading.
   ----------------------------------------------------------------------------
   /src/economy/endowment.js answers "what is in the ground under THIS node" as
   a PURE DETERMINISTIC FUNCTION of the node id: no storage, no migration, no
   dice roll at claim time, so two players see the same ground for ever and an
   old save gets the same answer as a new one. This file is that idea applied to
   the air instead of the ground.

   A city's PREVAILING WIND is a pure function of its id. It is never stored, it
   never migrates, it cannot be re-rolled, and it is the single most useful thing
   a player can know before they spend 150🔥 on a Coal Plant: which side of town
   is downwind. /src/water and /src/power both latch the city id for exactly this
   reason and this module latches it the same way (see index.js).

   ⚠ AND IT COEXISTS WITH THE OTHER TWO ENDOWMENTS WITHOUT BECOMING A SECOND
     TRUTH. It answers a question neither of them asks. /src/water owns what is
     in the ground, /src/power owns how hot the rock is, and this owns which way
     the air moves. The one place they touch is SPEED, and that is settled in
     tuning.js's wind header: /src/power defers to this module's `speed`, this
     module carries the same table its fallback uses, and index.js checks the two
     have not drifted.

   ════════════════════════════════════════════════════════════════════════════
   🔴 THE BEARING CONVENTION, WRITTEN DOWN TWICE BECAUSE IT IS THE MOST
      REVERSIBLE THING IN THE MODULE.

        `deg` is degrees CLOCKWISE FROM NORTH, and it is the direction the wind
        BLOWS TOWARD — the direction the PLUME goes, the direction the arrows
        point. It is NOT the meteorological convention (which names the
        direction wind comes FROM), because every consumer here — the advection
        step, the arrow glyphs, the "downwind of" test — wants the plume
        direction, and converting at four call sites is four chances to get it
        backwards.

        The panel prints BOTH: "NE ➜ blowing toward the north-east", so a player
        who knows the weather-report convention is not misled either.

        In tile space North is −z and East is +x (canvas row 0 is tile z 0 and
        the overlay plane is laid flat with no flip — see overlay.js), so

            dx =  sin(deg)      dz = −cos(deg)

      Everything downstream reads `dx`/`dz` and never re-derives them.
   ════════════════════════════════════════════════════════════════════════════ */

import { POLLUTE } from './tuning.js';

const W = POLLUTE.wind;
const DEG = Math.PI / 180;

/* ── THE HASH ───────────────────────────────────────────────────────────────
   FNV-1a over `id + ':' + salt`, returned as 0..1. The same shape /src/water
   and /src/power use for their endowments, and deliberately NOT Math.random:
   the whole promise of an endowment is that it is reproducible from the id
   alone, on any machine, in any session, for ever. */
export function hash01(id, salt) {
  const s = String(id == null ? '' : id) + ':' + String(salt == null ? '' : salt);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  // >>> 8 drops the low byte, which is the one that correlates most strongly
  // with the last character of the salt — without it 'wind0'..'wind9' come out
  // suspiciously evenly spaced.
  return ((h >>> 8) & 0xffffff) / 0x1000000;
}

/* Compass label for a bearing. `points` has 8 entries so each covers 45°, and
   the +22.5 rotates the bucket boundaries to the midpoints. */
export function pointOf(deg) {
  const n = W.points.length;
  const i = Math.floor((((deg % 360) + 360) % 360) / (360 / n) + 0.5) % n;
  return W.points[i];
}
/* …and the reverse label, for the "blowing FROM" half of the panel line. */
export function fromPointOf(deg) { return pointOf(deg + 180); }

/* ── THE ENDOWMENT ──────────────────────────────────────────────────────────
   Two numbers and a name, derived from the id and nothing else.

   ⚠ THE PREVAILING BEARING IS SNAPPED TO 15°, and that is a design decision
     rather than a rounding. A prevailing wind of 037.4° is a number; one of 45°
     is "north-easterly", which is a thing a player can hold in their head and
     plan a city around. The veer (live, ±veerDeg) puts the fractional degrees
     back and is where the day-to-day variation lives.

   `steadiness` is how reliable that prevailing direction is — a steady city
   veers half as much as a fickle one. It is the second axis of variation, so
   two cities with the same bearing are still different places to build in: in a
   steady city you can put the works hard downwind and forget about it, and in a
   fickle one you need margin. */
export function endowmentFor(cityId) {
  const id = String(cityId == null ? '' : cityId);
  const deg = Math.round(hash01(id, 'bearing') * 24) * 15 % 360;
  const steadiness = 0.35 + hash01(id, 'steady') * 0.60;      // 0.35 … 0.95
  const speedBias = (hash01(id, 'gust') - 0.5) * 2 * W.cityVar;
  return {
    cityId: id,
    deg, point: pointOf(deg), from: fromPointOf(deg),
    dx: Math.sin(deg * DEG), dz: -Math.cos(deg * DEG),
    steadiness, speedBias,
    /* The one-line description the panel opens with. It is the answer to "where
       do I put the coal plant" before the player has built anything at all. */
    blurb: 'The prevailing wind here blows toward the ' + longName(pointOf(deg)) +
           '. Anything you burn ends up ' + longName(pointOf(deg)) + ' of where you burn it' +
           (steadiness > 0.75 ? ', and it rarely swings — you can plan around it.'
            : steadiness < 0.5 ? ', but it is a fickle wind and swings widely, so leave margin.'
            : '.'),
  };
}

const LONG = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east',
               S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };
export function longName(p) { return LONG[p] || String(p); }

/* ── THE LIVE READING ───────────────────────────────────────────────────────
   Prevailing bearing + a slow veer + the weather's speed. `ctx` is the host's
   own clock and weather, handed over per tick — the globals trap again: `wx`
   and `hourOf()` are top-level `const`/functions in node-city's module script
   and are invisible here.

   ⚠ IT MUST ANSWER BEFORE THE FIRST TICK. /src/power calls
     `MythicPollution.wind()` from its SITING PREVIEW, which runs on pointer
     move — sixty times a second, and possibly before this module has ever been
     ticked. With no context it answers from the `clear` row plus the city's own
     bias, which is exactly what /src/power's own fallback would have said, so
     the turbine preview does not jump the first time the player opens the build
     menu. */
export function read(cityId, ctx) {
  const E = endowmentFor(cityId);
  const c = ctx || {};
  const weather = c.weather || 'clear';
  const hour = Number.isFinite(c.hour) ? c.hour : 12;

  // ── SPEED. The shared table (see tuning.js's wind header), the same diurnal
  //    swing /src/power applies, and the city's own offset.
  let speed = W.byWeather[weather];
  if (!Number.isFinite(speed)) speed = W.byWeather.clear;
  speed += W.diurnal * Math.sin((hour - 9) / 24 * Math.PI * 2);
  speed += E.speedBias;
  speed = Math.max(0, Math.min(1, speed));

  /* ── DIRECTION. A slow sinusoidal veer about the prevailing bearing, scaled
     by how fickle this city's wind is. Driven by the city CLOCK rather than by
     an accumulator, so it is a pure function of (id, hour) — which means it
     survives a reload, an offline catch-up and a __nc.step() fast-forward
     without needing a single byte of save. A veer stored in a save would be one
     more thing to migrate for a quantity nobody can remember the value of. */
  const t = (Number.isFinite(c.day) ? c.day * 24 : 0) + hour;
  const swing = W.veerDeg * (1 - E.steadiness * 0.75);
  let deg = E.deg
          + Math.sin(t * W.veerPerHour) * swing
          + Math.sin(t * W.veerPerHour * 0.37 + 2.1) * swing * 0.45;
  /* ⛈ A STORM IS THE ONE TIME THE WIND DOES SOMETHING YOU DID NOT PLAN FOR —
     and it is also the one time it scours the city clean fastest (air.windScour
     plus air.rainScour). Both halves of that trade are deliberate: severe
     weather moves the problem around, it does not make it worse. */
  const severe = weather === 'storm' || weather === 'tornado';
  if (severe) deg += Math.sin(t * W.veerPerHour * 2.9 + 0.7) * W.stormVeerDeg;
  deg = ((deg % 360) + 360) % 360;

  return {
    deg, speed,
    point: pointOf(deg), from: fromPointOf(deg),
    dx: Math.sin(deg * DEG), dz: -Math.cos(deg * DEG),
    prevailing: E.deg, steadiness: E.steadiness, weather,
    // How far a parcel of air travels this minute, in tiles. Floored so a dead
    // calm still drifts — real air always does, and a perfectly static plume
    // reads as a frozen simulation rather than as a still day.
    tilesPerMin: W.tilesPerMin * Math.max(W.calmFloor, speed),
  };
}
