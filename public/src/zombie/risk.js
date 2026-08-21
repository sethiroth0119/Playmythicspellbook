/* ════════════════════════════════════════════════════════════════════════════
   🧟 THE OUTBREAK RISK MODEL — pure, seeded, and node-importable.
   ----------------------------------------------------------------------------
   "Unburied dead carry a CHANCE of a zombie outbreak. It should be a
    consequence the player can see coming and prevent, not a coin flip."

   THIS FILE HAS NO DOM, NO `window`, NO THREE AND NO HOST. That is deliberate
   and it is the same split /src/water/network.js drew: the graph is importable
   from node, so the mains are testable at all. Everything here is a function of
   its arguments, which is what makes .gauntlet/drive-zombie-risk.mjs able to
   run ten thousand ticks and check that the forecast on screen is the forecast
   the model actually delivers.

   ── 🔴 WHAT IS NOT BUILT HERE, STATED AS PLAINLY AS THE TWO EXISTING BLOCKS ─
   node-city/index.html:35285 — "There is no infection state machine, no
   district spread, no global contamination and no world events here. Those are
   steps 10-13 of the doc and they are deliberately NOT built."
   node-city/index.html:36561 says it again for containment.

   THAT IS STILL TRUE AFTER THIS FILE. What this adds is a RISK, a FORECAST, a
   PREVENTION and a WAVE. It does NOT add:
     · an infection state machine — no tile, citizen or district carries an
       infected state, and none is stored;
     · district spread — there is one city-wide number, not a field. If spread
       is ever wanted it is /src/pollution/field.js's object with a different
       source term reaching the player through healthLoad() raising DEMAND,
       never a second field (the direction argument at index.html:31220);
     · a walking horde — no agent is spawned. spawnAgent/agentMesh exist and
       /src/crowd shows how to be numerous cheaply, but despawnAgent's header
       documents a real 17-geometries-per-civilian leak, and a wave that leaks
       is worse than a wave that is narrated. Raids have no visuals either; the
       outbreak reads through the same card, toasts, log and phone feed.
     · a source document. `smuggling-and-contamination.md` is referenced at
       index.html:35270 and is NOT in this repository. Nothing here implements
       "the doc"; anything that claimed to would be an invention wearing the
       doc's authority.

   ── THE MODEL IN SIX LINES ─────────────────────────────────────────────────
       unburied += deaths reported this tick
       interred  = min(unburied, capacityPerDay × days, room);  unburied -= interred
       pressure  = unburied / reference(pop);  target = 100 × p/(p + knee)
       risk     += (target - risk) × (1 - e^(-dt/tau))
       warning latches when risk ≥ ZOM.watch, and the roll is refused until the
       warning has stood for one full ZOM.interval
       at the beat: p = f(risk), draw = draw(cityId, 'zombie-roll', n)

   ── 🔴 THE THIRD TERM IS `room`, AND LEAVING IT OUT PRINTS A CONFIDENT LIE ─
   BURIAL RATE AND BURIAL GROUND ARE TWO DIFFERENT LIMITS AND THEY ARE NOT
   INTERCHANGEABLE. A city can be burying fast enough and still be out of holes.
   node-city:3585 designs for exactly this in writing — "COVERAGE is what bites
   in a session … PLOTS are what bite over the life of a save" — and
   /src/mortality's own interment line has always had three terms:

       model.js:136   interred = min(waiting, capPerMin × dt, room)

   The forecast here used to have TWO. The measured consequence, against a real
   host: one Graveyard at 21/24 plots, deaths 4/day against a burial rate of
   5/day. The card printed "No outbreak in the next 60 city days at this rate"
   (firstIn/p50In/p90In all null) and the first outbreak landed at 12.0 city
   days — because the projection went on burying 5 a day into three remaining
   holes for ever. The card contradicted ITSELF in adjacent lines: "3/24 plots
   free" carries no time, and the line that carried the time said the player was
   fine. The divergence band is not an edge case, it is every state where
   0 < plotsFree < rate × horizon — i.e. the entire back half of a graveyard's
   life. A forecast that is decoration fails this piece outright, so the third
   term is now here, the projection SPENDS the ground as it buries into it, and
   the panel prints when it runs out.
   ⚠ `room` DEFAULTS TO Infinity, not to zero. A host that cannot say how much
     ground it has (the fallback `deathcare: { inter }` contract has no plots at
     all) must get byte-identical behaviour to before this term existed —
     refusing to bury because nobody mentioned ground would be the same class of
     bug in the other direction.

   ── 🔴 WHY PREVENTION IS MONOTONE, AS A PROOF AND NOT A HOPE ───────────────
   Burial capacity enters the model in EXACTLY ONE PLACE: the `interred` line.
   So does burial ground. Raising EITHER can only lower `unburied` — min() is
   monotone non-decreasing in every one of its three arguments, and the result
   is subtracted. `target` is monotone non-decreasing in `unburied`. The easing
   coefficient `a = 1 - e^(-dt/tau)` mentions neither capacity nor ground, and
   lies in (0, 1], so
       risk' = risk + (target - risk)·a
   is monotone non-decreasing in `target`. Composing three monotone maps:
   MORE CAPACITY ⇒ NEVER MORE RISK, and MORE GROUND ⇒ NEVER MORE RISK, ON THE
   VERY NEXT TICK AND EVERY TICK AFTER.
   It is STRICTLY less whenever the extra capacity actually bites: there must be
   a backlog left to bury (unburied > 0) AND ground to put it in (room > 0) AND
   the old capacity must have been the binding term. A real burial building
   raises BOTH terms at once — a graveyard row carries `plots` as well as its
   `svc.supply` — so building one is never the case where capacity is added into
   a city with no room for it.
   ⚠ THE TEMPTATION THIS RULES OUT, WRITTEN DOWN SO IT IS NOT RE-ADDED: a
     second channel where cemeteries also grant a flat "civic order" bonus, or
     where an OVER-capacity city gets a risk floor. Either one puts capacity on
     two paths and the proof above stops holding — and the failure mode is a
     player who builds a cemetery and watches the meter tick up.
   ════════════════════════════════════════════════════════════════════════════ */

import { ZOM } from './tuning.js';

/* ── The seed contract ──────────────────────────────────────────────────────
   FNV-1a over `id + ':' + salt`, byte-identical to the copies in
   /src/economy/endowment.js, /src/water/endowment.js and /src/power/geology.js.
   Stable across sessions, machines and JS engines, which Math.random() and
   object key order are not. Every draw this feature takes goes through here:
   the outbreak roll AND the per-strike quarantine roll, so a headless run of a
   given city id and roll counter reproduces the outcome exactly. */
export function hash01(id, salt) {
  const s = String(id == null ? '' : id) + ':' + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 8) / 0x01000000;
}

/* The same walk, kept as a 32-bit seed rather than a fraction. */
function fnv32(id, salt) {
  const s = String(id == null ? '' : id) + ':' + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ══ 🔴 WHY THE DRAW IS NOT hash01(cityId, 'roll:' + n) ════════════════════
   BECAUSE IT DOES NOT WORK, AND IT LOOKS PERFECT. This was written the obvious
   way first — reuse the project's seed contract, vary the salt by the roll
   index — and the driver caught it as a distribution that would not match its
   own forecast: the model said 90% of cities would have had an outbreak by the
   sixth check and only 38% had.

   FNV-1a's final step is `h ^= c; h = h × prime`. Two salts differing only in
   the last character therefore differ by roughly `prime`, i.e. about 1/256 of
   the 32-bit range, and hash01 keeps the TOP 24 bits. Measured, for one city:

       roll:0 → 0.795215   roll:1 → 0.791309   roll:2 → 0.803028
       roll:3 → 0.799122   roll:4 → 0.810841   roll:5 → 0.806935

   Every draw that city will ever take is 0.80 ± 0.01. It is not a random
   sequence, it is a LUCK NUMBER: a city seeded above pMax can never have an
   outbreak however high the risk climbs, and a city seeded at 0.05 has one at
   the first permitted check, for ever. That is the exact "coin flip" this piece
   is not allowed to be — worse, actually, because it is not even a flip.
   ⚠ THE SAME DEFECT HIT THE STRIKE TARGETING, and it was visible in the log
     long before it was understood: three consecutive strikes on tile "2,2",
     because `target:<n>:0`, `:1`, `:2` all landed in the same bucket.

   hash01 is still the SEED — it is the project's contract for turning a city id
   into a number and it stays byte-identical. What changes is that the STREAM is
   drawn with an avalanching finalizer (splitmix32's), so consecutive indices
   are decorrelated. The result is still a pure function of (cityId, kind,
   index) — same city, same roll number, same draw, for ever.
   🔗 The four other hash01 users (/src/economy/endowment.js,
      /src/water/endowment.js, /src/power/geology.js, /src/pollution/wind.js)
      index it by NAME, not by a running counter, so none of them is exposed to
      this. Anything that ever wants a SEQUENCE should use draw() below. */
function mix32(x) {
  x = (x + 0x9e3779b9) | 0;
  x ^= x >>> 16; x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15; x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}
export function draw(cityId, kind, index) {
  return mix32(fnv32(cityId, kind) ^ mix32((index | 0) + 1)) / 4294967296;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/* 🔴 num() IS NOT A NULL CHECK AND THAT HAS ALREADY COST ONE NUMBER.
   `+null` is 0, which is finite, so `num(null, fallback)` returns 0 and the
   fallback never runs. /src/mortality's demandPerMin() deliberately returns
   null — its own header reads "never a plausible zero" — and passing that
   through num() converted the honest refusal into a confident 0/day on the
   card. Anything that must distinguish "no answer" from "zero" asks this. */
const isNum = (v) => v != null && v !== '' && Number.isFinite(+v);

/* ── BURIAL GROUND, in bodies. See the third-term block in the header.
   Absent ⇒ Infinity: a host that cannot say how much ground it has is stating
   no constraint, not stating a constraint of zero. Negative ⇒ 0. */
const roomOf = (v) => (isNum(v) ? Math.max(0, +v) : Infinity);

/* The deaths-per-day EMA. Half-life expressed in city days so the constant in
   tuning.js reads as a duration and not as an alpha. Shared by both tick()
   branches — the mirrored one needs it whenever the sibling cannot derive a
   rate of its own, which is not the same thing as the rate being zero. */
function emaRate(S, deaths, days) {
  if (!(days > 0)) return;
  const hl = Math.max(1e-6, ZOM.rateHalfLifeDays);
  const a = 1 - Math.pow(0.5, days / hl);
  S.rate += ((deaths / days) - S.rate) * a;
  if (S.rate < 1e-6) S.rate = 0;
}

/* ══ STATE ═════════════════════════════════════════════════════════════════
   Everything persisted, and nothing else. `clock` is ACCUMULATED SIMULATED
   SECONDS — see the units note in tuning.js. `rolls` is what makes the seeded
   draw reproducible across a save/load: it is the draw counter, so reloading
   does not hand the city the same die twice. */
export function makeState(cityId) {
  return {
    v: 1,
    cityId: String(cityId == null ? '' : cityId),
    unburied: 0,       // bodies with nowhere to go
    risk: 0,           // 0..100, the meter
    clock: 0,          // simulated seconds since this state was created
    timer: ZOM.interval,
    rolls: 0,          // draws taken — the seed counter
    waves: 0,          // outbreaks resolved
    warnAt: null,      // clock reading when the warning latched, or null
    rate: 0,           // EMA of deaths per city day
    deaths: 0,         // lifetime deaths reported, for the panel's provenance line
    interred: 0,       // lifetime interments, ditto
    src: '',           // who is reporting deaths — see index.js's single-ingress rule
  };
}

/* A blob from a DIFFERENT city is REFUSED, not merged — /src/water/network.js's
   rule, for the same reason: a backlog is a fact about one city's ground. */
export function loadState(blob, cityId) {
  const S = makeState(cityId);
  if (!blob || typeof blob !== 'object') return S;
  if (String(blob.cityId || '') !== S.cityId) return S;
  S.unburied = Math.max(0, num(blob.unburied));
  S.risk     = clamp(num(blob.risk), 0, 100);
  S.clock    = Math.max(0, num(blob.clock));
  S.timer    = clamp(num(blob.timer, ZOM.interval), 0, ZOM.interval);
  S.rolls    = Math.max(0, num(blob.rolls) | 0);
  S.waves    = Math.max(0, num(blob.waves) | 0);
  S.rate     = Math.max(0, num(blob.rate));
  S.deaths   = Math.max(0, num(blob.deaths));
  S.interred = Math.max(0, num(blob.interred));
  S.src      = String(blob.src || '');
  /* 🔴 THE LOAD-TIME NO-SURPRISE GUARD. A save written at risk 90 restores with
     no warning history, and without this line the very next beat could fire an
     outbreak on a card the player has never seen amber. Re-latching the warning
     to NOW buys them a full interval, exactly as a fresh crossing would. The
     alternative — trusting a persisted warnAt — is worse: it is a wall-clock
     promise across an arbitrary absence. */
  S.warnAt = (num(blob.risk) >= ZOM.watch) ? S.clock : null;
  return S;
}

export function saveState(S) {
  return {
    v: 1, cityId: S.cityId,
    unburied: +S.unburied.toFixed(3), risk: +S.risk.toFixed(3),
    clock: Math.round(S.clock), timer: Math.round(S.timer),
    rolls: S.rolls, waves: S.waves,
    rate: +S.rate.toFixed(4), deaths: Math.round(S.deaths), interred: Math.round(S.interred),
    src: S.src,
  };
}

/* ══ BURIAL CAPACITY ═══════════════════════════════════════════════════════
   🔴 THE FLAG LIVES ON THE BUILDINGS ROW, NEVER IN A LIST INSIDE THIS MODULE.
   node-city has corrected that exact bug three times (see the `aquifer` note at
   index.html:28917). Any row carrying

       deathcare: { inter: <interments per city day, per level> }

   contributes. So the cemeteries/graveyards round adds its capacity with ZERO
   edits here — it writes one field on its own row and this function finds it.

   A DAMAGED or UNDER-CONSTRUCTION building buries nobody: the same rule
   staticDefense() and serviceMorale() already apply ("half a wall stops
   nothing"), and it is the interesting case — the outbreak that damages your
   clinic has just cut the capacity that was holding it back. */
export function capacityOf(tiles, BUILDINGS, isSite) {
  const out = { perDay: 0, sources: [], any: false };
  if (!BUILDINGS) return out;
  /* `any` answers a different question from `perDay`: does a burial building
     EXIST IN THIS BUILD AT ALL. It is what arms the engine — see armed(). */
  for (const k in BUILDINGS) {
    const d = BUILDINGS[k];
    if (d && d.deathcare && num(d.deathcare.inter) > 0) { out.any = true; break; }
  }
  const per = {};
  for (const k in (tiles || {})) {
    const t = tiles[k];
    if (!t) continue;
    const d = BUILDINGS[t.type];
    if (!d || !d.deathcare || !(num(d.deathcare.inter) > 0)) continue;
    if (t.damaged) continue;
    if (typeof isSite === 'function' && isSite(t)) continue;
    const lvl = Math.max(1, t.lvl | 0);
    const add = num(d.deathcare.inter) * lvl;
    out.perDay += add;
    per[t.type] = per[t.type] || { type: t.type, name: d.name || t.type, ico: d.ico || '', n: 0, perDay: 0 };
    per[t.type].n++; per[t.type].perDay += add;
  }
  out.sources = Object.values(per).sort((a, b) => b.perDay - a.perDay);
  return out;
}

/* The REFERENCE backlog — the one that reads 70, not the one that reads 100.
   Nothing reads 100: see riskTarget. */
export function saturate(pop) {
  return Math.max(ZOM.floorBacklog, num(pop) * ZOM.perPop);
}

/* 🔴 STRICTLY INCREASING, WITH NO FLAT TOP. See ZOM.knee for the measurement
   that forced this shape: a clamped ramp is monotone but not STRICTLY monotone
   above its reference, and a player who builds a second morgue during a famine
   is exactly the person standing on the flat part. p/(p+k) has a positive
   derivative everywhere — 100·k/(p+k)² > 0 — so every body buried moves the
   meter, however bad things are. */
export function riskTarget(unburied, pop) {
  const p = Math.max(0, num(unburied)) / saturate(pop);
  return 100 * p / (p + ZOM.knee);
}

/* The published probability at a check. Zero below the arming threshold, so
   the panel can print "0%" and mean it. */
export function probOf(risk) {
  const r = clamp(num(risk), 0, 100);
  if (r < ZOM.arm) return 0;
  const span = 100 - ZOM.arm;
  return ZOM.pMax * Math.pow((r - ZOM.arm) / span, ZOM.curve);
}

/* ══ 🔴 THE NO-SURPRISE GATE ═══════════════════════════════════════════════
   ONE function, and it is the ONLY thing that may authorise a roll. resolve()
   calls it; forecast() calls the SAME function on its projection, which is what
   makes the forecast honest rather than a second opinion.

   Three conditions, all hard:
     1. the engine is armed at all (a burial building exists in this build);
     2. risk ≥ ZOM.arm;
     3. the warning has stood for one FULL ZOM.interval of simulated time.
   (3) is measured against S.clock, not wall clock, and warnAt is re-latched on
   load, so there is no path — fresh city, restored save, fast-forward, or a
   sudden mass casualty — where an outbreak precedes a full interval of warning. */
export function permit(S, armedFlag) {
  /* 🔴 SHIPPED DARK. T.live is false until the outbreak has been played and
     until building burial capacity visibly moves the meter — see tuning.js.
     Refusing HERE rather than at the mount keeps the whole read-only half of
     the feature alive: the card still renders, the forecast still computes, the
     deathcare shortfall still reads. Only the roll is withheld. */
  if (!ZOM.live) return { ok: false, why: 'disabled' };
  if (!armedFlag) return { ok: false, why: 'dormant' };
  if (S.risk < ZOM.arm) return { ok: false, why: 'below-arm' };
  if (S.warnAt == null) return { ok: false, why: 'no-warning' };
  const stood = S.clock - S.warnAt;
  if (stood < ZOM.interval) return { ok: false, why: 'warn-dwell', stood, need: ZOM.interval };
  return { ok: true, stood };
}

/* Is the engine live? Not "has the player built one" — "can the player build
   one at all". A city that cannot yet raise a single grave must not be rolled
   against; that is a punishment for a feature that does not exist.
   The cemeteries round flipping this on is one BUILDINGS row. */
export function armed(cap) { return !!(cap && cap.any); }

/* ══ THE TICK ══════════════════════════════════════════════════════════════
   inp = { deaths, pop, capPerDay, room, daySec, armed }
     …or, when a deathcare system owns the dead:
   inp = { unburied, ratePerDay, pop, capPerDay, room, daySec, armed }

   `room` is BURIAL GROUND in bodies — free plots, not a rate. Omit it and it
   is Infinity, which is what the pre-plots contract meant. See the header.

   🔴 TWO MODES, AND THE SECOND ONE IS THE REAL ONE. /src/mortality ships the
   city's graves: it counts deaths, holds a `waiting` list, works the backlog
   off against real plots, and its own step() is where interment happens. When
   that module is live it is THE AUTHORITY on how many bodies are above ground,
   and this file MIRRORS its number instead of integrating a second one.

   Keeping a private backlog beside it would be the failure this codebase has
   corrected four times by name — two modules each individually correct and
   permanently disagreeing about the same street. The player would watch a
   graveyard fill on the Deathcare card while the Outbreak card insisted the
   dead were still in the road.

   THE MONOTONICITY PROOF SURVIVES THE HAND-OVER, one level down: mortality's
   own line is `interred = min(waiting, capPerMin × dt, room)`, monotone
   non-decreasing in capacity and in room and subtracted from `waiting`;
   riskTarget is strictly increasing in `unburied`; the easing mentions neither.
   More graves ⇒ never more risk, whichever module is holding the bodies.

   The self-owned path below is what runs when /src/mortality is absent, and it
   is what the forecast's PROJECTION always uses — a projection has to be able
   to run the backlog forward itself, since no other module will project on its
   behalf. 🔴 WHICH IS WHY THE THIRD TERM HAD TO REACH THIS FILE. In mirror
   mode the ground limit is applied by the sibling and never seen here; the
   projection has no sibling to apply it, so a two-term projection kept burying
   into a graveyard that had been full for fifty days. The lines below are now
   the same three terms mortality/model.js:136 has always had.

   Returns a DELTA REPORT — every number the panel needs to name what just
   moved, which is the difference between a meter and a forecast. */
export function tick(S, inp, dtSec) {
  const dt = Math.max(0, num(dtSec));
  const daySec = Math.max(1, num(inp && inp.daySec, ZOM.daySec));
  const days = dt / daySec;
  const before = { risk: S.risk, unburied: S.unburied };
  const mirrored = inp && inp.unburied != null && Number.isFinite(+inp.unburied);

  S.clock += dt;

  let deaths = 0, interred = 0;
  const capPerDay = Math.max(0, num(inp && inp.capPerDay));
  const room = roomOf(inp && inp.room);

  if (mirrored) {
    /* MIRROR. The delta is reported for the card's "▼2 since you opened the
       second graveyard" line; it is never re-derived, only observed. */
    const now = Math.max(0, +inp.unburied);
    const d = now - S.unburied;
    if (d > 0) { deaths = d; S.deaths += d; } else { interred = -d; S.interred += interred; }
    S.unburied = now;
    /* THE RATE, IF THE SIBLING HAS ONE. It is already a true per-day figure, so
       there is nothing to estimate and no EMA is run over it.
       ⚠ null IS NOT ZERO. /src/mortality returns null from demandPerMin() when
         nothing can be derived — "never a plausible zero", its own words — and
         a card that renders that as "deaths 0/day" forecasts immortality for a
         city that is losing people. When the sibling declines to answer, the
         backlog's own arrivals are the observation left, so the EMA runs on
         those instead. It UNDER-reads while burials are keeping up (a body that
         arrives and is interred inside one tick never shows), which is why it
         is the fallback and not the primary. */
    if (isNum(inp.ratePerDay)) S.rate = Math.max(0, +inp.ratePerDay);
    else emaRate(S, deaths, days);
  } else {
    deaths = Math.max(0, num(inp && inp.deaths));
    S.unburied += deaths;
    S.deaths += deaths;

    /* ── THE ONE PLACE CAPACITY AND GROUND ENTER THE MODEL ──────────────────
       Three terms, the same three as /src/mortality/model.js:136: you cannot
       bury more people than you have, faster than you can dig, or into ground
       you do not own. Dropping the third is what made the forecast lie. */
    interred = Math.min(S.unburied, capPerDay * days, room);
    S.unburied -= interred;
    S.interred += interred;
    if (S.unburied < 1e-9) S.unburied = 0;

    emaRate(S, deaths, days);
  }

  const target = riskTarget(S.unburied, inp && inp.pop);
  const ease = dt > 0 ? (1 - Math.exp(-dt / Math.max(1e-6, ZOM.tau))) : 0;
  S.risk += (target - S.risk) * ease;
  S.risk = clamp(S.risk, 0, 100);

  /* The warning latch. Hysteresis so a meter hovering on the line does not
     flicker the card — and, more importantly, does not keep resetting the
     dwell clock and thereby make the city permanently un-rollable. */
  if (S.risk >= ZOM.watch) { if (S.warnAt == null) S.warnAt = S.clock; }
  else if (S.risk < ZOM.watch - ZOM.hysteresis) S.warnAt = null;

  S.timer -= dt;
  let due = false;
  if (S.timer <= 0) { due = true; S.timer = ZOM.interval; }

  return {
    due, deaths, interred, days, target,
    dRisk: S.risk - before.risk,
    dUnburied: S.unburied - before.unburied,
    /* WHICH TERM IS BINDING. `backlogged` is the rate losing to the death rate;
       `groundbound` is the rate being irrelevant because there is nowhere left
       to put anybody. They are different problems with different fixes (staff
       vs land), so the card is allowed to name them separately. */
    backlogged: capPerDay * days < deaths,
    groundbound: !mirrored && room <= 0 && S.unburied > 0,
    roomLeft: room === Infinity ? Infinity : Math.max(0, room - interred),
  };
}

/* ══ THE SEEDED DRAW ═══════════════════════════════════════════════════════
   Reproducible from (cityId, roll index). The index is SAVED, so a reload does
   not re-roll the same die, and a headless run of the same city id sees the
   same sequence. */
export function drawFor(S, kind, i) {
  /* The stream index is (roll counter, sub-index) flattened. 64 is a hard
     ceiling on sub-draws per beat — ZOM.maxStrikes is 4 — so two beats can
     never collide on an index. */
  return draw(S.cityId, 'zombie-' + kind, S.rolls * 64 + (i == null ? 0 : (i | 0)));
}

/* ══ RESOLVE THE BEAT ══════════════════════════════════════════════════════
   Called by index.js when tick() reports `due`. This function decides; it does
   NOT act. It returns a plan, and index.js is the only thing that touches the
   city — through ctx.damageTile() and nothing else.

   `def` is the host's OWN raid tally, handed in. It is not recomputed here and
   it must not be: node-city:31172 carries the standing warning that a second
   defence number "promises a defence the raid does not deliver". */
export function resolve(S, inp, def) {
  const gate = permit(S, inp && inp.armed);
  const p = probOf(S.risk);
  if (!gate.ok) return { fired: false, rolled: false, p, gate };

  const r = drawFor(S, 'roll');
  S.rolls++;
  if (r >= p) return { fired: false, rolled: true, p, r, gate };

  /* ── THE HORDE IS THE BACKLOG ── */
  const strength = Math.round(ZOM.strBase + S.unburied * ZOM.strPerBody + S.waves * ZOM.strPerWave);
  const eff = Math.max(0, Math.round(num(def && def.effDefense)));
  const held = eff >= strength;
  const shortfall = Math.max(0, strength - eff);

  const out = {
    fired: true, rolled: true, p, r, gate,
    wave: S.waves + 1, strength, held, shortfall,
    def, strikes: [], newDead: 0, cleared: 0,
  };

  if (held) {
    /* Putting the horde down is also, finally, burying it. */
    out.cleared = S.unburied * ZOM.clearOnHold;
    S.unburied -= out.cleared;
    S.interred += out.cleared;
    S.risk *= ZOM.riskAfterHold;
  } else {
    /* Bounded by the living, not by the horde — see ZOM.deadCapFrac. */
    out.newDead = Math.round(Math.min(shortfall * ZOM.deadPerBreach,
                                      Math.max(0, num(inp && inp.pop)) * ZOM.deadCapFrac));
    S.unburied += out.newDead;
    S.deaths += out.newDead;
    S.risk *= ZOM.riskAfterBreach;
    const n = Math.min(ZOM.maxStrikes, Math.max(1, Math.ceil(shortfall / ZOM.strPerStrike)));
    const raze = eff > 0 ? (shortfall / eff) >= ZOM.razeRatio : true;
    /* 🔴 THE COUNTER-BUILDING IS ONE WX_SHIELD ROW AND NOTHING ELSE.
       `shield` is the host's own _wxShieldStrength('outbreak') — the same
       per/cap arithmetic fire, tornado and anomaly use, read off the same
       table. There is no bespoke mitigation branch anywhere in this feature.
       The DRAW is taken here rather than through the host's _wxShield() for
       one reason only: _wxShield() uses Math.random() and a per-weather-front
       dedupe, and an outbreak has no weather front and must be reproducible
       from a seed. Same rule, seeded draw. */
    const shield = clamp01(num(inp && inp.shield));
    for (let i = 0; i < n; i++) {
      const sr = drawFor(S, 'shield', i);
      out.strikes.push({ absorbed: sr < shield, destroy: raze, shield });
    }
  }
  S.waves++;
  S.rolls++;   // the shield draws consumed this index too; never reuse it
  return out;
}

/* ══ THE FORECAST ══════════════════════════════════════════════════════════
   🔴 THIS IS THE PIECE THAT MUST NOT BE DECORATION. It runs the SAME model
   forward — the same tick(), the same permit(), the same probOf() — on a COPY
   of the state, and accumulates the survival probability across the checks it
   projects. It therefore cannot drift from the engine: there is one model and
   the panel is reading it, not a parallel estimate.

   THE ASSUMPTIONS ARE STATED IN THE RETURN VALUE, because a projection whose
   assumptions are hidden is a promise the game did not make:
     · deaths continue at S.rate (the EMA), evenly;
     · burial capacity stays exactly as it is now — the number the player is
       about to change;
     · 🔴 AND SO DOES BURIAL GROUND. The projection SPENDS `room` as it buries
       into it and never digs a new plot, because the player has not built one.
       This is the term that was missing: without it the projection interred at
       the current rate for sixty city days into a graveyard with three holes
       left, and printed "no outbreak" over a city that had one in twelve. The
       ground is carried forward below in exactly the same way the backlog is;
     · no outbreak occurs during the projection (so the escalation from a
       breach is NOT baked in; the window is the optimistic one, and the real
       first outbreak therefore cannot land EARLIER than `firstIn`).

   Returns seconds-until for five events. `p50In`/`p90In` are the checkable
   claim: across many seeds, the first outbreak lands at or after `firstIn`,
   and by `p90In` about nine cities in ten have had one. `groundOutIn` is the
   new one and it is the answer to "3/24 plots free — so how long is that?". */
export function forecast(S, inp) {
  const daySec = Math.max(1, num(inp && inp.daySec, ZOM.daySec));
  const isArmed = !!(inp && inp.armed);
  const P = {
    v: 1, cityId: S.cityId, unburied: S.unburied, risk: S.risk, clock: S.clock,
    timer: S.timer, rolls: S.rolls, waves: S.waves, warnAt: S.warnAt,
    rate: S.rate, deaths: 0, interred: 0, src: '',
  };
  const room0 = roomOf(inp && inp.room);
  let room = room0;
  const step = { deaths: 0, pop: num(inp && inp.pop), capPerDay: num(inp && inp.capPerDay),
                 room, daySec, armed: isArmed };

  let t = 0, survive = 1;
  let watchIn = null, firstIn = null, p50In = null, p90In = null, groundOutIn = null;
  /* SUB-STEPPED — see ZOM.forecastStep for the measurement that forced it. The
     beat itself is not scheduled here: P.timer is the live one and tick()
     decrements it, so the projected checks fall exactly where the real ones
     will, starting from however much of the current interval is left. */
  const chunk = Math.max(1, ZOM.forecastStep);
  const steps = Math.ceil(ZOM.horizon * ZOM.interval / chunk);

  for (let i = 0; i < steps; i++) {
    step.deaths = P.rate * (chunk / daySec);
    /* THE GROUND THE PROJECTION HAS LEFT, handed in and then spent. Infinity
       minus anything is still Infinity, so a host that stated no ground limit
       walks the identical arithmetic it walked before this term existed. */
    step.room = room;
    const rep = tick(P, step, chunk);
    room = room === Infinity ? Infinity : Math.max(0, room - rep.interred);
    t += chunk;
    if (groundOutIn == null && room <= 0 && room0 > 0) groundOutIn = t;
    if (watchIn == null && P.risk >= ZOM.watch) watchIn = t;
    if (!rep.due) continue;
    const g = permit(P, isArmed);
    const p = g.ok ? probOf(P.risk) : 0;
    if (p > 0) {
      if (firstIn == null) firstIn = t;
      survive *= (1 - p);
      if (p50In == null && (1 - survive) >= 0.5) p50In = t;
      if (p90In == null && (1 - survive) >= 0.9) p90In = t;
    }
    if (p90In != null) break;
  }

  /* The two limits, named separately, because they have different fixes: a
     rate shortfall wants another building or more staff, and a ground shortfall
     wants land. `effCapPerDay` is what the city can ACTUALLY perform once the
     ground is accounted for — which is 0 when the last plot is taken, and is
     the number that makes "net" honest. */
  const capPerDay = num(inp && inp.capPerDay);
  const effCapPerDay = room0 <= 0 ? 0 : capPerDay;
  return {
    armed: isArmed,
    risk: S.risk,
    unburied: S.unburied,
    ratePerDay: S.rate,
    capPerDay,
    effCapPerDay,
    room: room0, roomKnown: room0 !== Infinity, roomLeft: room, groundOutIn,
    netPerDay: S.rate - effCapPerDay,
    pNext: permit(S, isArmed).ok ? probOf(S.risk) : 0,
    nextCheckIn: S.timer,
    gate: permit(S, isArmed),
    watchIn, firstIn, p50In, p90In,
    horizonSec: t,
    exhausted: p90In == null,
    daySec,
    assumes: 'deaths continue at ' + S.rate.toFixed(2) + '/day, burial capacity unchanged' +
      (room0 === Infinity ? '' : ', no new plots dug beyond the ' + Math.round(room0) + ' free now') +
      ', no outbreak in between',
  };
}

/* ══ SELF-CHECK ════════════════════════════════════════════════════════════
   Reported ONLY when it fails, like every neighbour's verify(). A check that
   logs on success is one everybody learns to scroll past.

   It asserts the properties this feature is allowed to be judged on:
     1. MONOTONICITY — over a sweep of backlogs, populations, capacities and
        burial GROUND, raising capacity never raises next-tick risk, and
        neither does raising ground.
     2. NO SURPRISE — permit() refuses for a full interval after the warning
        latches, from a cold state and from a loaded one.
     4. THE GROUND IS IN THE FORECAST — the regression this file shipped
        without once, stated as the pair of runs that separates the two. */
export function verify() {
  const problems = [];

  // 1a. capacity up ⇒ risk never up, next tick — at every level of ground.
  for (const pop of [4, 25, 90, 400]) {
    for (const back of [0, 3, 12, 60, 300]) {
      for (const rate of [0, 2, 20]) {
        for (const room of [0, 1, 9, 1000, undefined]) {
          let prev = null;
          for (const cap of [0, 1, 4, 12, 40, 500]) {
            const S = makeState('verify');
            S.unburied = back; S.risk = riskTarget(back, pop);
            tick(S, { deaths: rate * 0.05, pop, capPerDay: cap, room, daySec: ZOM.daySec, armed: true }, 60);
            if (prev != null && S.risk > prev + 1e-9) {
              problems.push('monotonicity(cap): pop=' + pop + ' backlog=' + back + ' room=' + room +
                            ' cap=' + cap + ' risk ' + prev.toFixed(6) + ' -> ' + S.risk.toFixed(6));
            }
            prev = S.risk;
          }
        }
      }
    }
  }

  /* 1b. GROUND up ⇒ risk never up, next tick. The same argument as capacity
     and it needs the same sweep, because `room` is now a term in the same
     min() and a sign error there would look exactly like a working feature. */
  for (const pop of [4, 60, 400]) {
    for (const back of [0, 3, 40, 300]) {
      for (const cap of [0, 2, 12, 500]) {
        let prev = null;
        for (const room of [0, 0.5, 3, 25, 400, undefined]) {
          const S = makeState('verify-room');
          S.unburied = back; S.risk = riskTarget(back, pop);
          tick(S, { deaths: 1, pop, capPerDay: cap, room, daySec: ZOM.daySec, armed: true }, 60);
          if (prev != null && S.risk > prev + 1e-9) {
            problems.push('monotonicity(room): pop=' + pop + ' backlog=' + back + ' cap=' + cap +
                          ' room=' + room + ' risk ' + prev.toFixed(6) + ' -> ' + S.risk.toFixed(6));
          }
          prev = S.risk;
        }
      }
    }
  }

  // 2. the dwell gate, cold and loaded.
  const S = makeState('verify-dwell');
  S.unburied = 1000; S.risk = 99;
  tick(S, { deaths: 0, pop: 20, capPerDay: 0, daySec: ZOM.daySec, armed: true }, 1);
  if (permit(S, true).ok) problems.push('dwell: a fresh crossing was rollable immediately');
  let guard = 0;
  while (!permit(S, true).ok && guard++ < 10000) {
    tick(S, { deaths: 0, pop: 20, capPerDay: 0, daySec: ZOM.daySec, armed: true }, 60);
  }
  const stood = S.clock - S.warnAt;
  if (stood < ZOM.interval) problems.push('dwell: permitted after only ' + stood + 's');
  const L = loadState({ ...saveState(S), warnAt: 0 }, 'verify-dwell');
  if (permit(L, true).ok) problems.push('dwell: a loaded high-risk save was rollable immediately');

  // 3. a dormant build never rolls, whatever the risk.
  if (permit(S, false).ok) problems.push('dormant: rolled with no burial building in the table');

  /* ── 4. 🔴 THE GROUND REGRESSION, AS THE PAIR THAT SEPARATES THE TWO ──────
     THE MEASURED DEFECT, re-run here every boot: one Graveyard at 21/24 plots,
     deaths 4/day against a burial rate of 5/day. On rate alone the city is
     comfortably ahead and the honest answer is "no outbreak inside the
     horizon" — that is the UNCONSTRAINED case below and it must stay null.
     With three holes left in the ground it is not ahead at all: burials stop
     after three bodies and the backlog climbs at the full 4/day. The
     CONSTRAINED case must therefore name a finite date, and the two differ ONLY
     in `room`. If the third term is ever dropped again these two collapse onto
     each other and this fires. */
  const groundCase = (room) => {
    const G = makeState('verify-ground');
    G.rate = 4;
    return forecast(G, { pop: 60, capPerDay: 5, room, daySec: ZOM.daySec, armed: true });
  };
  const unlimited = groundCase(undefined);
  const threeLeft = groundCase(3);
  if (unlimited.firstIn != null) {
    problems.push('ground: with burial outrunning deaths and no plot limit the forecast still ' +
                  'named an outbreak at ' + unlimited.firstIn + 's');
  }
  if (threeLeft.firstIn == null) {
    problems.push('ground: 3 plots left against 4 deaths/day forecast NO outbreak in ' +
                  Math.round(threeLeft.horizonSec / ZOM.daySec) + ' city days — the burial ' +
                  'GROUND term is missing from the projection (see risk.js\'s third-term block)');
  }
  if (threeLeft.groundOutIn == null) {
    problems.push('ground: the projection never reported the ground running out');
  }
  if (threeLeft.roomKnown !== true || unlimited.roomKnown !== false) {
    problems.push('ground: roomKnown does not distinguish "no plots left" from "no plot limit stated"');
  }

  return { ok: problems.length === 0, problems };
}

export default { makeState, loadState, saveState, capacityOf, tick, resolve, forecast, permit, probOf, armed, verify, hash01, draw };
