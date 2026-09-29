/* ══ 🛣 THE TRAFFIC METER ═══════════════════════════════════════════════════
   REAL DATA OR NOTHING. Every number the charts draw is a tile transition that
   an agent actually made, counted on the one line in agentTick() where an agent
   changes tile. There is no generator, no smoothing and no "typical daily
   profile" anywhere in this file, because a chart of invented numbers is worse
   than no chart — it looks like evidence.

   ── WHY PER TILE AND NOT PER STREET ───────────────────────────────────────
   The counter runs inside the agent loop, so it must be O(1) and it must not
   need the street graph. Counting into the TILE and summing over a street's
   tiles when the panel opens gives both: the hot path is one array increment,
   and a street that is later split, extended or crossed keeps every pass it
   ever collected, because the history lives on the tiles, not on a street id
   that changes shape.

   ── 🕰 WHICH CLOCK. THIS IS THE BUG THAT GUTTED THE CHARTS ────────────────
   node-city has TWO clocks and they do not agree, which renderVitals already
   says out loud where it prints "/ CYCLE" instead of "/ DAY":

     hourOf() / estClock()   real EST wall time, 1:1, no compression. The SKY
                             runs on it — sun, lamps, the 06:00 chip in the
                             top bar. A "day" on it is 24 REAL HOURS.
     game.cityAge            seconds the city has actually been simulated,
                             advanced by vitalsTick. CITY_DAY_MIN (20) real
                             minutes of it is ONE CYCLE, and a cycle is what
                             every production rate, rent, upkeep quote and
                             vitals trend in the game is priced per.

   ⚠ THE FIRST CUT BUCKETED ON hourOf(). It was defensible — that is the clock
     the sky runs on — and it made the charts UNFILLABLE: 24 buckets spanning 24
     real hours means one bucket per session, so a full scene build plus forty
     seconds measured "0 of 24 hours observed" with 19 genuinely counted passes
     sitting in the rings. The counting was never wrong; the axis was 1,440x too
     wide for anything a player does in one sitting.

   So a bucket here is ONE TWENTY-FOURTH OF A CYCLE — 50 real seconds at
   CITY_DAY_MIN = 20 — and the 24-slot axis is one city day on the clock the
   city itself advances. A 20-minute session fills the ring exactly once, which
   is the whole point: the profile is something a player's own play draws.
   The panel says which clock it is, in words, next to both charts. Nothing here
   touches the sky, and the top bar's EST chip is left alone.

   Each bucket carries the absolute city hour it was written in. Entering an
   hour whose bucket was last written in a different hour ZEROES that bucket
   first, which is what makes the window rolling — otherwise the chart would
   slowly become a lifetime average wearing an hourly axis.

   ── OBSERVED TIME IS GLOBAL, NOT PER TILE ─────────────────────────────────
   Vehicles-per-hour needs to know how much of the hour was actually watched: a
   player who plays four minutes has not observed a city hour, and dividing
   their passes by a whole one would understate every street. Observed seconds
   are accumulated ONCE per frame for the whole city (every tile is watched for
   exactly as long as the city is on screen), so this costs one addition per
   frame rather than one per road tile.

   ⚠ OBSERVED TIME IS COUNTED IN CITY SECONDS, off the same cityAge clock the
     buckets key on, NOT off the frame's dt. The two are 1:1 while the city is
     on screen, and they diverge in exactly the case that matters: offlineCatchUp
     advances cityAge by up to 36 hours in one lump for a city nobody was
     watching. Crediting that as "observed" would divide a session's real passes
     by a day and a half of imaginary observation. STREET.MAX_TICK_CREDIT_SEC is
     the clamp that refuses it.
     ⚠ AND IT CANNOT BE SMALLER THAN THE VITALS BEAT. cityAge does not advance
       smoothly — vitalsTick runs on a 2 s beat and moves it in 2 s lumps — so a
       clamp below 2 would throw away most of the clock and inflate every
       volume on the panel by the ratio it threw away.

   ⚠ A bucket with less than STREET.MIN_OBSERVED_FRAC of its own length observed
     is NOT plotted. Two seconds of a fifty-second slice turns a single pass into
     a 25x spike, and that is sampling noise, not traffic.                     */

import { STREET } from './tuning.js';

const B = STREET.BUCKETS;

export function createMeter(ctx) {
  /* rings: tileKey -> { v: Int32Array(24) vehicles, p: Int32Array(24) peds,
                         life: lifetime vehicle passes (drives wear) }         */
  const rings = new Map();
  const obs = new Float64Array(B);      // observed CITY seconds per bucket, city-wide
  const stamp = new Int32Array(B);      // absolute city hour each bucket was written
  let lastBucket = -1;
  let lastCity = -1;                    // cityAge at the previous tick
  let netTiles = 1;                     // live road tile count; see setNetwork

  /* One cycle, from the host. CITY_DAY_MIN is a top-level `const` in index.html
     and therefore invisible to a module (the globals trap), so it is handed over
     — the fallback exists for the case where an older index.html mounts this
     module without the new field, and it is the same 20 that file uses. */
  const cycleSec = (() => {
    let m = 0;
    try { m = +ctx.cycleMin(); } catch (e) { m = 0; }
    if (!Number.isFinite(m) || m <= 0) m = STREET.CYCLE_MIN_FALLBACK;
    return m * 60;
  })();
  const hourSec = cycleSec / B;          // one bucket, in city seconds
  const minObsSec = hourSec * STREET.MIN_OBSERVED_FRAC;

  /* ctx.game is the same object index.js reads tiles from — no new hand-over is
     needed for the clock, only for the cycle length. */
  const cityNow = () => {
    let s = 0;
    try { s = +ctx.game.cityAge; } catch (e) { s = 0; }
    return (Number.isFinite(s) && s > 0) ? s : 0;
  };
  /* Absolute city hour, +1 so that 0 stays free as the "never written" sentinel
     — a brand-new city genuinely IS in absolute hour 0, and without the offset
     its first bucket would look unwritten to roll() and to load(). */
  const absHour = () => Math.floor(cityNow() / hourSec) + 1;
  /* Position within the current cycle, 0..24. Fractional, because the panel's
     "now" marker wants the exact position and not the bucket it fell in. */
  const cycleHour = () => (cityNow() / hourSec) % B;
  const bucketNow = () => Math.min(B - 1, Math.floor(cycleHour()));

  function ringFor(k) {
    let r = rings.get(k);
    if (!r) { r = { v: new Int32Array(B), p: new Int32Array(B), life: 0 }; rings.set(k, r); }
    return r;
  }

  /* Expire everything older than the rolling window. Called only when the
     bucket index actually changes, so it is 24 comparisons an hour, not per
     pass. `full` also sweeps the other 23 buckets, which is what catches the
     "closed the tab for three days" case on load. */
  function roll(force) {
    const b = bucketNow();
    if (b === lastBucket && !force) return b;
    lastBucket = b;
    const ah = absHour();
    for (let i = 0; i < B; i++) {
      /* A bucket is stale when the city hour it holds is no longer inside the
         last 24 — and the bucket we are about to WRITE is stale the moment it
         holds anything other than this exact hour, which is what stops the
         PREVIOUS cycle's 14:00 being added to this one's. */
      const stale = (i === b) ? (stamp[i] !== ah) : (stamp[i] !== 0 && ah - stamp[i] >= B);
      if (!stale) continue;
      obs[i] = 0;
      for (const r of rings.values()) { r.v[i] = 0; r.p[i] = 0; }
      stamp[i] = 0;
    }
    if (stamp[b] !== ah) stamp[b] = ah;
    return b;
  }

  return {
    /* ── the hot path ──────────────────────────────────────────────────────
       ONE array increment plus a bucket read. Called from agentTick for every
       agent that changed tile this frame. Anything expensive here is paid tens
       of times a frame. */
    count(k, kind) {
      if (!k) return;
      const b = (lastBucket >= 0) ? lastBucket : roll(true);
      const r = ringFor(k);
      if (kind === 'civilian') { r.p[b]++; return; }
      r.v[b]++; r.life++;
    },
    /* Once per frame. Also the only place the rolling window advances, so the
       meter cannot drift while the tab is in the background — RAF stops, this
       stops, and no observed time is credited for a city nobody is watching.

       ⚠ THE FRAME'S dt IS NOT USED, ON PURPOSE. What is credited is how far the
         CITY clock moved since the last frame, so the observed window and the
         bucket axis are the same clock and cannot drift apart. In ordinary play
         they are the same number — animate() feeds that same dt into vitalsTick,
         which is what advances cityAge — and they part company only where they
         should: a catch-up lump nobody watched is clamped away by
         MAX_TICK_CREDIT_SEC. dt stays in the signature because index.js's
         rescan timer is a real-time cadence and still wants it. */
    tick(dt) {
      const b = roll(false);
      const now = cityNow();
      if (lastCity < 0) { lastCity = now; return; }
      const d = now - lastCity;
      lastCity = now;
      if (d > 0) obs[b] += Math.min(d, STREET.MAX_TICK_CREDIT_SEC);
    },

    /* ── read side ────────────────────────────────────────────────────────
       Everything the panel draws comes out of here, and every field says how it
       was derived. `tiles` is a street's tile list.

       volume  vehicles per CITY hour past a POINT on the street — the per-tile
               mean, not the sum, so a long street is not automatically "busier"
               than a short one and the number is comparable to capacity.
       flow    volume / capacity, as a percentage, clamped to 0..100 for display
               (a value above 100 means the street is over saturation, and the
               panel reports that in words rather than by letting the chart run
               off the top).
       seen    which buckets have enough observed time to be plotted at all.

       ⚠ THE UNIT IS THE CITY HOUR, one bucket, hourSec real seconds — not the
         wall-clock hour. Dividing a session's passes by a REAL hour was the
         other half of the unfillable-chart bug: it quoted a rate for a window
         no session ever spans. flow is unchanged by the choice, because volume
         and capacity are converted together. */
    series(tiles) {
      roll(false);
      const n = Math.max(1, tiles.length);
      const veh = new Array(B).fill(0), ped = new Array(B).fill(0);
      for (const k of tiles) {
        const r = rings.get(k); if (!r) continue;
        for (let i = 0; i < B; i++) { veh[i] += r.v[i]; ped[i] += r.p[i]; }
      }
      const cap = this.capacity();
      const volume = new Array(B).fill(0), flow = new Array(B).fill(0), seen = new Array(B).fill(false);
      for (let i = 0; i < B; i++) {
        if (obs[i] < minObsSec) continue;
        seen[i] = true;
        const hours = obs[i] / hourSec;      // fraction of a CITY hour observed
        volume[i] = (veh[i] / n) / hours;
        flow[i] = (volume[i] / cap) * 100;
      }
      let vehTotal = 0, pedTotal = 0, obsTotal = 0;
      for (let i = 0; i < B; i++) { vehTotal += veh[i]; pedTotal += ped[i]; obsTotal += obs[i]; }
      return { volume, flow, seen, veh, ped, vehTotal, pedTotal, obsSec: obsTotal, capacity: cap,
               observedBuckets: seen.reduce((a, s) => a + (s ? 1 : 0), 0) };
    },
    /* How many road tiles the city currently has. Set by the street graph's
       rescan (it already walks the tiles) so this file never touches game. */
    setNetwork(n) { netTiles = Math.max(1, n | 0); },
    /* ── the clock, for everything that has to agree with the charts ──────── */
    cycleHour, hourSec: () => hourSec, cycleSec: () => cycleSec,
    /* Capacity past a point, in vehicles per CITY HOUR: the smaller of lane
       saturation and the city's whole vehicle fleet spread evenly over its road
       network. See the long note on STREET.HEADWAY_TILES for why both terms are
       here — and for why they are stated per real hour and converted last. */
    capacity() {
      let sp = 0, fleet = 0;
      try { sp = +ctx.carSpeed(); } catch (e) { sp = 0; }
      try { fleet = +ctx.fleetMax(); } catch (e) { fleet = 0; }
      const perCityHour = hourSec / 3600;
      if (!Number.isFinite(sp) || sp <= 0) return STREET.MIN_CAPACITY_VPH * perCityHour;
      const lane = (sp * 3600) / STREET.HEADWAY_TILES;
      const share = (Number.isFinite(fleet) && fleet > 0)
        ? (fleet * sp * 3600) / netTiles : Infinity;
      return Math.max(STREET.MIN_CAPACITY_VPH, Math.min(lane, share)) * perCityHour;
    },
    /* Both halves, so the panel can say which limit is binding rather than
       printing one number the player has to take on trust. Same unit as
       capacity() — a panel that mixed the two units would be worse than one
       that printed neither. */
    capacityParts() {
      let sp = 0, fleet = 0;
      try { sp = +ctx.carSpeed(); } catch (e) { sp = 0; }
      try { fleet = +ctx.fleetMax(); } catch (e) { fleet = 0; }
      const perCityHour = hourSec / 3600;
      const lane = (sp > 0) ? (sp * 3600) / STREET.HEADWAY_TILES : 0;
      const share = (sp > 0 && fleet > 0) ? (fleet * sp * 3600) / netTiles : 0;
      return { lane: lane * perCityHour, share: share * perCityHour, netTiles, fleet,
               bound: (share && share < lane) ? 'fleet' : 'lane' };
    },
    /* Lifetime counted vehicle passes on a tile — the input to road wear. */
    lifeOf(k) { const r = rings.get(k); return r ? r.life : 0; },

    /* ── save / load ──────────────────────────────────────────────────────
       Compact on purpose: the city save is ONE upserted row per user with no
       history, so every kilobyte here is a kilobyte of someone's city.
       A tile encodes as  "life|bucket:count,bucket:count"  with only the
       non-zero buckets present, in base 36. A short session writes ~14 bytes a
       tile; the pathological full-24-hour case is ~120. Tiles are capped by
       STREET.SAVE_MAX_TILES, busiest first, so a maxed-out road network cannot
       run the save away. */
    save() {
      roll(false);
      const rows = [];
      for (const [k, r] of rings) {
        let life = r.life, parts = '', any = 0;
        for (let i = 0; i < B; i++) {
          const v = r.v[i] + r.p[i];
          if (!v) continue;
          any += v;
          parts += (parts ? ',' : '') + i.toString(36) + ':' + r.v[i].toString(36) + ':' + r.p[i].toString(36);
        }
        if (!life && !any) continue;
        rows.push({ k, w: any, s: life.toString(36) + '|' + parts });
      }
      rows.sort((a, b) => b.w - a.w);
      const tr = {};
      for (const row of rows.slice(0, STREET.SAVE_MAX_TILES)) tr[row.k] = row.s;
      let ob = '';
      for (let i = 0; i < B; i++) {
        if (!obs[i] && !stamp[i]) continue;
        ob += (ob ? ',' : '') + i.toString(36) + ':' + Math.round(obs[i]).toString(36) + ':' + stamp[i].toString(36);
      }
      return { tr, ob };
    },
    load(blob) {
      rings.clear(); obs.fill(0); stamp.fill(0); lastBucket = -1; lastCity = -1;
      if (!blob || typeof blob !== 'object') return;
      try {
        const ah = absHour();
        for (const piece of String(blob.ob || '').split(',')) {
          if (!piece) continue;
          const [bi, sec, st] = piece.split(':');
          const i = parseInt(bi, 36);
          if (!(i >= 0 && i < B)) continue;
          const s = parseInt(st, 36) || 0;
          // Anything outside the rolling window is dropped on load rather than
          // shown as if it were this cycle's traffic.
          /* ⚠ AND ANYTHING FROM THE FUTURE, WHICH IS THE MIGRATION CASE. A save
             written by the build that bucketed on wall time carries stamps of
             ~490,000 (hours since 1970); the city clock's stamps are small and
             count from the city's own birth. Without the `s > ah` test such a
             stamp is not stale by the window rule, it is stale by 490,000
             hours — so roll() would never expire it and last week's wall-clock
             traffic would sit on the chart for the life of the city. */
          if (!(s > 0) || s > ah || ah - s >= B) continue;
          // Clamped to one bucket's worth — a hand-edited save cannot hand the
          // charts an hour that was observed for longer than an hour lasts.
          obs[i] = Math.max(0, Math.min(hourSec, parseInt(sec, 36) || 0));
          stamp[i] = s;
        }
        const trs = blob.tr && typeof blob.tr === 'object' ? blob.tr : {};
        for (const k in trs) {
          const raw = String(trs[k] || '');
          const bar = raw.indexOf('|');
          if (bar < 0) continue;
          const r = ringFor(k);
          r.life = Math.max(0, parseInt(raw.slice(0, bar), 36) || 0);
          for (const piece of raw.slice(bar + 1).split(',')) {
            if (!piece) continue;
            const [bi, v, p] = piece.split(':');
            const i = parseInt(bi, 36);
            if (!(i >= 0 && i < B)) continue;
            if (!stamp[i]) continue;               // that hour expired — drop its counts
            r.v[i] = Math.max(0, parseInt(v, 36) || 0);
            r.p[i] = Math.max(0, parseInt(p, 36) || 0);
          }
        }
      } catch (e) { /* a corrupt blob costs the charts their history, nothing else */ }
    },
    /* ── 🔬 DEBUG SEAMS. NOT A DATA SOURCE. ────────────────────────────────
       Nothing in the shipped paths calls either of these. They exist because
       the charts are fed by agentTick, agentTick only runs under RAF, and a
       full profile takes a whole cycle to accumulate — so without them the only
       way to see the chart geometry is to sit with the game open for twenty
       minutes. The harness uses `_debugProfile` to PROVE THE RENDERER, and any
       screenshot taken that way has to say so. A player never reaches this code.
       ⚠ A screenshot of the CHARTS should not need them any more: keyed on the
         city clock, a real session fills the ring, and the reference capture in
         .gauntlet/drive-streets.mjs is driven with counted passes only. */
    _debugProfile(tiles, profile, secondsPerBucket) {
      roll(true);
      const ah = absHour();
      for (let i = 0; i < B; i++) {
        // Clamped to a real bucket, so a caller passing "3600" (the old wall-hour
        // assumption) cannot silently divide the whole profile by 72.
        obs[i] = Math.min(hourSec, Math.max(0, +secondsPerBucket || hourSec));
        stamp[i] = ah;
      }
      for (const k of tiles) {
        const r = ringFor(k);
        for (let i = 0; i < B; i++) {
          const v = Math.max(0, Math.round(+profile[i % profile.length] || 0));
          r.v[i] = v; r.p[i] = Math.round(v * 0.4);
        }
      }
      lastBucket = bucketNow();
    },
    _debugInject(k, kind, n, seconds) {
      roll(true);
      const b = lastBucket;
      obs[b] = Math.max(obs[b], +seconds || 0);
      const r = ringFor(k);
      for (let i = 0; i < (n | 0); i++) {
        if (kind === 'civilian') r.p[b]++; else { r.v[b]++; r.life++; }
      }
    },
  };
}

export default { createMeter };
