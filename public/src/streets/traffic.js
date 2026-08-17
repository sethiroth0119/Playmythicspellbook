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

   ── THE 24 BUCKETS ────────────────────────────────────────────────────────
   Bucket index is the hour of the CITY clock — hourOf(), which is real EST wall
   time and the same clock that drives the sky, so the chart's 00:00/06:00/12:00/
   18:00 axis is the axis the player's own city runs on.

   Each bucket carries the absolute hour it was written in. Entering an hour
   whose bucket was last written in a different hour ZEROES that bucket first,
   which is what makes the window rolling — otherwise the chart would slowly
   become a lifetime average wearing an hourly axis.

   ── OBSERVED TIME IS GLOBAL, NOT PER TILE ─────────────────────────────────
   Vehicles-per-hour needs to know how much of the hour was actually watched: a
   player who plays four minutes has not observed an hour, and dividing their
   passes by a full hour would understate every street by 15x. Observed seconds
   are accumulated ONCE per frame for the whole city (every tile is watched for
   exactly as long as the city is on screen), so this costs one addition per
   frame rather than one per road tile.

   ⚠ A bucket with less than STREET.MIN_OBSERVED_SEC of observed time is NOT
     plotted. Two seconds of observation turns a single pass into "1,800/h", and
     that spike is sampling noise, not traffic.                                */

import { STREET } from './tuning.js';

const B = STREET.BUCKETS;
const absHour = () => Math.floor(Date.now() / 3600000);

export function createMeter(ctx) {
  /* rings: tileKey -> { v: Int32Array(24) vehicles, p: Int32Array(24) peds,
                         life: lifetime vehicle passes (drives wear) }         */
  const rings = new Map();
  const obs = new Float64Array(B);      // observed seconds per bucket, city-wide
  const stamp = new Int32Array(B);      // absolute hour each bucket was written
  let lastBucket = -1;

  const hourNow = () => {
    let h = 0;
    try { h = +ctx.hour(); } catch (e) { h = new Date().getHours(); }
    if (!Number.isFinite(h)) h = 0;
    return ((h % 24) + 24) % 24;
  };
  const bucketNow = () => Math.min(B - 1, Math.floor(hourNow()));

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
      /* A bucket is stale when the hour it holds is no longer inside the last
         24 hours — and the bucket we are about to WRITE is stale the moment it
         holds anything other than this exact hour, which is what stops last
         night's 14:00 being added to this afternoon's. */
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
       stops, and no observed time is credited for a city nobody is watching. */
    tick(dt) {
      const b = roll(false);
      const d = +dt;
      if (Number.isFinite(d) && d > 0) obs[b] += Math.min(d, 0.5);
    },

    /* ── read side ────────────────────────────────────────────────────────
       Everything the panel draws comes out of here, and every field says how it
       was derived. `tiles` is a street's tile list.

       volume  vehicles per hour past a POINT on the street — the per-tile mean,
               not the sum, so a long street is not automatically "busier" than
               a short one and the number is comparable to lane capacity.
       flow    volume / capacity, as a percentage, clamped to 0..100 for display
               (a value above 100 means the street is over saturation, and the
               panel reports that in words rather than by letting the chart run
               off the top).
       seen    which buckets have enough observed time to be plotted at all. */
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
        if (obs[i] < STREET.MIN_OBSERVED_SEC) continue;
        seen[i] = true;
        const hours = obs[i] / 3600;
        volume[i] = (veh[i] / n) / hours;
        flow[i] = (volume[i] / cap) * 100;
      }
      let vehTotal = 0, pedTotal = 0, obsTotal = 0;
      for (let i = 0; i < B; i++) { vehTotal += veh[i]; pedTotal += ped[i]; obsTotal += obs[i]; }
      return { volume, flow, seen, veh, ped, vehTotal, pedTotal, obsSec: obsTotal, capacity: cap,
               observedBuckets: seen.reduce((a, s) => a + (s ? 1 : 0), 0) };
    },
    /* Lane capacity in vehicles/hour, derived from the sim's own car speed.
       See STREET.HEADWAY_TILES for the one judgement in it. */
    capacity() {
      let sp = 0;
      try { sp = +ctx.carSpeed(); } catch (e) { sp = 0; }
      if (!Number.isFinite(sp) || sp <= 0) return STREET.MIN_CAPACITY_VPH;
      return Math.max(STREET.MIN_CAPACITY_VPH, (sp * 3600) / STREET.HEADWAY_TILES);
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
      rings.clear(); obs.fill(0); stamp.fill(0); lastBucket = -1;
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
          // shown as if it were this morning's traffic.
          if (!(s > 0) || ah - s >= B) continue;
          obs[i] = Math.max(0, Math.min(3600, parseInt(sec, 36) || 0));
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
       24-hour profile takes 24 hours to accumulate — so without them the only
       way to see the chart geometry is to leave the game open for a day. The
       harness uses `_debugProfile` to PROVE THE RENDERER, and any screenshot
       taken that way has to say so. A player never reaches this code. */
    _debugProfile(tiles, profile, secondsPerBucket) {
      roll(true);
      const ah = absHour();
      for (let i = 0; i < B; i++) {
        obs[i] = Math.max(0, +secondsPerBucket || 0);
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
