/* ══════════════════════════════════════════════════════════════════════════
   🪦 MORTALITY — THE MODEL. Pure, node-importable: no DOM, no window, no
   THREE, no imports from the host. Everything it needs arrives as plain data,
   which is what lets .gauntlet/drive-mortality.mjs age a city through a
   hundred deaths in a millisecond and check the books balance.

   WHAT IT OWNS: graves. One integer per graveyard tile — how many of its plots
   are taken — plus the people who are waiting for one.

   🔴 A GRAVE IS NOT A TILE, AND A PLOT IS NOT A RESOURCE. Same argument
   /src/water/network.js makes about pipes, for the same reasons: minting a
   tile type for a grave would render an invisible building (buildMesh has no
   default arm), despawn agents standing on it, fall out of the road cap and
   need a line in two dozen `=== 'road'` comparisons. And a plot is not a
   CITY_STOCK resource because it is not fungible, not tradeable and not
   movable — it is a hole in one specific field.

   🔴 THE CONSERVATION LAW, and audit() is the function that proves it:

         lifetime deaths  ===  Σ plots used  +  plotDebt  +  waiting

   Every person who has ever died in this city is either in a grave, part-way
   into the next grave (plotDebt — interment is a rate, graves are integers),
   or still waiting for one. There is no fourth place, nothing decays, and
   nothing is rounded away. /src/pollution/field.js keeps the same discipline
   for the same reason: a field that silently loses mass is a field whose
   numbers nobody can check.

   🪓 AND DEMOLISHING A GRAVEYARD PUTS ITS DEAD BACK ON THE WAITING LIST.
   That is not a punishment bolted on; it falls straight out of the law above.
   The plots are gone, the deaths still happened, so the only place the
   difference can go is `waiting`. It also means the obvious exploit — bulldoze
   the full graveyard, rebuild on the same tile, fresh plots — costs exactly
   what it should: you get the plots back AND the bodies back.
   ══════════════════════════════════════════════════════════════════════════ */

export const V = 1;

export function makeState() {
  return {
    v: V,
    city: null,          // the city id this state belongs to; a foreign blob is refused
    used: {},            // tile key -> whole plots taken (integer)
    waiting: 0,          // people who have died and have no grave (float)
    plotDebt: 0,         // 0..1 — interment already paid for, not yet a whole grave
    lifetime: 0,         // every death this city has ever had (float, monotone)
    interredLife: 0,     // every interment this city has ever performed (float, monotone)
    lost: 0,             // graves returned to `waiting` by demolition (float, monotone)
    lastSites: null,     // Set of keys seen last step — see reconcile()
  };
}

export function reset(S) {
  const f = makeState();
  for (const k in f) S[k] = f[k];
  return S;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nonneg = (v) => Math.max(0, num(v));

/* Plots taken across the whole city. Cheap: the map has one entry per
   graveyard tile, not one per grave. */
export function plotsUsed(S) {
  let n = 0;
  for (const k in S.used) n += S.used[k] | 0;
  return n;
}

/* ── 🪓 RECONCILE ──────────────────────────────────────────────────────────
   Called at the top of every step with the sites that exist RIGHT NOW. A key
   that has gone (demolished, damaged past use, replaced by something else)
   gives its dead back to `waiting`, which is what keeps the conservation law
   true. A key that is still there but has SHRUNK (a level was lost) gives back
   only the overflow.
   ⚠ `sites` is the caller's list and is trusted for shape only. A site with a
     non-positive plot count is treated as absent, not as an error — a damaged
     graveyard is genuinely not accepting anybody today. */
export function reconcile(S, sites) {
  const live = new Map();
  for (const s of (sites || [])) {
    if (!s || !s.key) continue;
    const p = Math.max(0, Math.floor(num(s.plots)));
    if (p > 0) live.set(String(s.key), p);
  }
  let returned = 0;
  for (const k in S.used) {
    const held = S.used[k] | 0;
    if (held <= 0) { delete S.used[k]; continue; }
    const cap = live.has(k) ? live.get(k) : 0;
    if (held > cap) {
      const back = held - cap;
      returned += back;
      if (cap > 0) S.used[k] = cap; else delete S.used[k];
    }
  }
  if (returned > 0) { S.waiting += returned; S.lost += returned; S.interredLife -= returned; }
  S.lastSites = live;
  return { returned, sites: live };
}

/* ── ⚰ ONE STEP ───────────────────────────────────────────────────────────
   inp = { dtMin, deaths, capPerMin, sites }
     dtMin      real minutes since the last step, already clamped by the caller
     deaths     people who died in this step. NOT a rate — the caller has
                already differenced the demographic counter, so this number is
                exact and is never re-derived here.
     capPerMin  interments per minute the city's deathcare buildings can
                perform. This is the HOST's own `game.cov.supply.deathcare` —
                the number printed on the vitals card — so the card, the feed
                and the backlog cannot tell three stories. See index.js.
     sites      [{ key, plots }] — plots is the WHOLE capacity of that tile at
                its current level, not the free capacity.

   Returns what happened, in people. Never throws, never negative. */
export function step(S, inp) {
  const dt = Math.max(0, num(inp && inp.dtMin));
  const dead = nonneg(inp && inp.deaths);
  const capMin = nonneg(inp && inp.capPerMin);

  const rec = reconcile(S, inp && inp.sites);

  S.waiting += dead;
  S.lifetime += dead;

  /* Free plots across the city, less the fraction of a grave already dug. */
  let free = 0;
  for (const [k, cap] of rec.sites) free += Math.max(0, cap - (S.used[k] | 0));
  const room = Math.max(0, free - S.plotDebt);

  /* 🔴 THE BACKLOG IS WORKED OFF BY THE SAME CAPACITY THAT KEEPS UP WITH THE
     PRESENT. `waiting` already includes this step's dead, so a city that
     builds a cemetery after letting the dead pile up clears the pile at the
     cemetery's own rate rather than instantly and rather than never. That is
     the whole reason the shortfall is a thing a player can dig out of. */
  const interred = Math.min(S.waiting, capMin * dt, room);
  S.waiting -= interred;
  S.interredLife += interred;
  S.plotDebt += interred;

  /* Whole graves, filled in the caller's site order — which index.js sorts by
     tile key, so the same graveyard fills first every session and a save
     round-trip does not shuffle who is buried where. */
  let dug = 0;
  if (S.plotDebt >= 1) {
    for (const [k, cap] of rec.sites) {
      if (S.plotDebt < 1) break;
      let held = S.used[k] | 0;
      while (S.plotDebt >= 1 && held < cap) { held++; dug++; S.plotDebt -= 1; }
      if (held > 0) S.used[k] = held;
    }
  }
  /* Floating-point crumbs: after the loop plotDebt is in [0,1) unless every
     plot in the city is full, in which case it is capped back into the
     waiting list so the law still balances. */
  if (S.plotDebt >= 1) { const spill = Math.floor(S.plotDebt); S.plotDebt -= spill; S.waiting += spill; S.interredLife -= spill; }
  if (S.plotDebt < 1e-9) S.plotDebt = Math.max(0, S.plotDebt);

  return {
    died: dead, interred, dug, returned: rec.returned,
    waiting: S.waiting, unburied: Math.floor(S.waiting + 1e-9),
    plotsUsed: plotsUsed(S), plotsFree: Math.max(0, free - dug),
  };
}

/* Does this tile still take anybody? 1 or 0 — a graveyard is not half-open.
   node-city multiplies its `svc.supply` by this, so a full graveyard stops
   contributing to Deathcare coverage and the vitals card goes red without
   anything else in the city changing. */
export function plotFactor(S, key, plots) {
  const cap = Math.max(0, Math.floor(num(plots)));
  if (cap <= 0) return 0;
  return ((S.used[String(key)] | 0) < cap) ? 1 : 0;
}

/* ── 🔍 THE AUDIT ─────────────────────────────────────────────────────────
   Silence is a pass. Returns ok:false with the two sides of the law and the
   gap between them, in the same idiom as pollution/field.js audit(). */
export function audit(S, tol) {
  const t = Number.isFinite(+tol) ? +tol : 1e-6;
  const held = plotsUsed(S);
  const accounted = held + S.plotDebt + S.waiting;
  const gap = accounted - S.lifetime;
  return {
    ok: Math.abs(gap) <= t,
    lifetime: S.lifetime, inGraves: held, plotDebt: S.plotDebt, waiting: S.waiting,
    accounted, gap,
    why: Math.abs(gap) <= t ? null
       : 'the mortality books do not balance: ' + S.lifetime.toFixed(6) + ' deaths against ' +
         accounted.toFixed(6) + ' accounted for (' + held + ' in graves, ' +
         S.plotDebt.toFixed(6) + ' part-dug, ' + S.waiting.toFixed(6) + ' waiting)',
  };
}

/* ── 💾 PERSISTENCE ───────────────────────────────────────────────────────
   Stamped with the city id and REFUSED rather than merged when it does not
   match — /src/water/network.js's rule, and for the same reason: a graveyard
   map from another city would put bodies under buildings that are not there.
   Floats are rounded to 4dp; the save is JSON and the sixth decimal of a
   part-dug grave is bytes nobody can spend. */
export function save(S, cityId) {
  const used = {};
  for (const k in S.used) if ((S.used[k] | 0) > 0) used[k] = S.used[k] | 0;
  const r4 = (v) => Math.round(num(v) * 1e4) / 1e4;
  return {
    v: V,
    city: cityId == null ? (S.city == null ? null : S.city) : String(cityId),
    used,
    w: r4(S.waiting), d: r4(S.plotDebt),
    t: r4(S.lifetime), i: r4(S.interredLife), l: r4(S.lost),
  };
}

export function load(S, raw, cityId) {
  reset(S);
  S.city = cityId == null ? null : String(cityId);
  if (!raw || typeof raw !== 'object') return { ok: true, adopted: false, why: 'no slice — a city with no dead yet' };
  if (raw.city != null && cityId != null && String(raw.city) !== String(cityId)) {
    return { ok: false, adopted: false, why: 'the graveyard map in this save belongs to city ' + raw.city + ', not ' + cityId };
  }
  const used = (raw.used && typeof raw.used === 'object') ? raw.used : {};
  for (const k in used) {
    if (!/^-?\d+,-?\d+$/.test(k)) continue;          // a tile key or nothing
    const n = Math.max(0, Math.floor(num(used[k])));
    if (n > 0) S.used[k] = n;
  }
  S.waiting = nonneg(raw.w);
  S.plotDebt = Math.min(1, nonneg(raw.d));
  S.interredLife = nonneg(raw.i);
  S.lost = nonneg(raw.l);
  /* 🔴 `lifetime` IS RECONSTRUCTED FROM THE LAW, NOT TRUSTED. It is the one
     field a hand-edited or truncated save could make inconsistent, and an
     inconsistent lifetime makes audit() fail forever on a city that is
     otherwise perfectly fine. The three terms on the right are all directly
     observable state; the total is defined as their sum, so a save can never
     load into a state that fails its own audit. */
  S.lifetime = plotsUsed(S) + S.plotDebt + S.waiting;
  return { ok: true, adopted: true, why: null };
}

export default { V, makeState, reset, reconcile, step, plotFactor, plotsUsed, audit, save, load };
