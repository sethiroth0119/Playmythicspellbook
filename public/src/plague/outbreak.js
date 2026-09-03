/* ══════════════════════════════════════════════════════════════════════════
   🤒 OUTBREAK — viruses moving through the city builder's NAMED CITIZENS.
   ──────────────────────────────────────────────────────────────────────────
   The city already has people with names, jobs at real building tiles and a
   mood computed from vitals (node-city's CITIZENS_API / citizens.city.js).
   This module gives a subset of them an INFECTION and moves it around. It is
   pure logic over a handed-in host; the node-city adapter is outbreak.city.js.

   🔴 THE THREE RULES IT INHERITS FROM citizens.city.js, VERBATIM, BECAUSE
   BREAKING ANY OF THEM IS A DATA-LOSS BUG DRESSED AS A GAME MECHANIC:
     1. NEVER DELETE A PLAYER'S PLACED THING. Nothing here reads-modify-writes
        game.tiles. Not once. An infection at a workplace does not damage,
        demolish or downgrade the workplace.
     2. NEVER KILL A CITIZEN. The roster is a SUBSET of a population counter
        this module does not own; removing a citizen would desync the HUD's
        population against the staffing ratio. `critical` is the worst stage
        and it recovers. Severity's punishment is misery and lost output.
     3. THE ONLY WRITE INTO THE CITIZEN IS `nudge(id, delta)` — the sanctioned
        mood seam. No new fields are welded onto their records; infections live
        in THIS module's own map, keyed by citizen id.

   ⚠ IT MUST BE ABLE TO DO NOTHING. A city with no clinics, a player who never
   opens the lab, a host that returns [] for citizens — all of those are
   ordinary states, and all of them mean this module ticks and changes nothing.
   An outbreak that a player cannot answer is a punishment, so emergence is
   gated hard (see EMERGE) and the first strain of a city is always mild.
   ══════════════════════════════════════════════════════════════════════════ */

import { makeStrain, familyOf, rngFrom, hash32 } from './strains.js';

export const V = 1;

/* ══ TUNING ════════════════════════════════════════════════════════════════
   🔴 RETUNED TO BITE. The first pass was epidemiologically tidy and dramatically
   inert: stages ran on 40/90/150 real minutes and R₀ landed near 1.1, so a
   typical outbreak infected about one extra person and burned out before the
   player finished a session. Nothing visibly happened while you watched, and
   the cure you had just built had nothing to be urgent about.

   The shape of the fix is that an outbreak now runs on a SESSION clock rather
   than an afternoon clock, and each case reliably makes more than one more.
   What did NOT change is every safety rail: nobody dies, no tile is touched,
   the ceiling still stops it short of the whole city, and immunity still lets
   an ignored outbreak burn itself out rather than running forever.
   ══════════════════════════════════════════════════════════════════════════ */
export const TUNING = {
  /* Emergence. `MIN_POP` keeps a brand-new city from getting sick before it
     has anyone to get sick; `COOLDOWN_MS` is the floor between wild strains so
     a badly-run city degrades rather than avalanches.
     ⚠ The cooldown came down from 6h to 2h and the base chance more than
       doubled: a filthy city should be able to have a SECOND problem while the
       first is still running, because triage is the interesting decision and
       one-at-a-time never produces it. */
  MIN_POP: 40,
  COOLDOWN_MS: 2 * 3600000,
  BASE_CHANCE_PER_HR: 0.12,      // at zero pressure. Multiplied by pressure below.
  MAX_ACTIVE_WILD: 3,            // concurrent WILD strains. Iatrogenic ones ignore this.

  /* ── the stage clock, on a SESSION scale ────────────────────────────────
     Was 40 / 90 / 150 minutes, which meant a player who watched an outbreak
     start saw precisely nothing happen before they logged off. At 8 / 20 / 30
     a case incubates, turns symptomatic, spreads and resolves inside a single
     sitting — you can watch the curve move, which is the whole reason to model
     it per-citizen instead of as a counter. */
  INCUBATE_MS: 8 * 60000,
  SYMPTOM_MS: 20 * 60000,
  RECOVER_MS: 30 * 60000,
  /* Immunity is deliberately LONG relative to the new stage clock. It is the
     pressure valve: it is what lets an ignored outbreak burn out instead of
     cycling through the same people forever, and shortening it is how you turn
     a hard system into an unwinnable one. Left alone on purpose. */
  IMMUNE_MS: 24 * 3600000,

  /* ── transmission ───────────────────────────────────────────────────────
     🔴 R₀ IS THE NUMBER THAT MATTERS, and it is now explicit rather than
     buried in a magic 0.5. Expected secondary infections per case is

         contagion × CONTACTS_PER_HR × infectious_hours

     With the stage clock above, infectious_hours ≈ (20 + 0.4 × 30) / 60 ≈ 0.53,
     so a moderate strain (contagion 0.35) lands near R₀ 2.0 and a virulent one
     (0.8) near 4.5. Above 1 means it grows; 2 means it grows visibly without
     being instantly unmanageable. Retune THIS, not the coefficient it replaced. */
  CONTACTS_PER_HR: 11,
  SEED_INFECTIONS: 3,            // was 2 — two index cases fizzled too often
  /* Per-tick cap. It exists for the OFFLINE catch-up, where `hours` is large
     enough to saturate the roll for every sick citizen at once; online, at a
     20-second cadence, it effectively never binds. Raised with the rest so a
     long absence returns a proportionate problem rather than a token one. */
  SPREAD_PER_TICK_MAX: 5,

  // Mood cost per stage. Applied through nudge(), the sanctioned seam.
  MOOD: { incubating: -3, symptomatic: -12, critical: -26 },

  /* The share of the roster an outbreak may reach. Above this it burns out on
     its own — an outbreak that takes the whole city has no drama left in it,
     and there is no decision left to make once everyone is already sick.
     Raised, but the rail stays: it can never be 1. */
  CEILING_SHARE: 0.72,

  /* 🏭 THE ECONOMIC BITE. Sick citizens are a labour shortage, and the city
     already models labour as a Liebig minimum over food/water/HEALTH — so an
     outbreak is expressed as a drag on the health vital and flows through the
     multipliers the city already has. `WORKFORCE_DRAG_MAX` caps how far that
     can go: at 0.35 a total outbreak costs about a third of the health input,
     never the city. Set it to 0 to make outbreaks purely social again. */
  WORKFORCE_DRAG_MAX: 0.35,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── city pressure ─────────────────────────────────────────────────────────
   0..1, derived ONLY from vitals the city already computes. Nothing new is
   measured and no new number is stored on the city.

     health coverage    ← clinics per head. The dominant term, and the one the
                          player has a direct building answer for.
     water coverage     ← dirty water is the classic vector
     food coverage      ← malnutrition is an immune-system tax
     density            ← pop against cap; a packed city transmits

   🔴 IT IS DELIBERATELY POSSIBLE TO REACH ~0. A player who builds clinics,
   water and food and does not overcrowd should be able to stop wild outbreaks
   COMPLETELY. A system with an unavoidable floor teaches players that building
   correctly does not pay, and they stop. */
export function pressureOf(host) {
  try {
    const cov = (host.coverage && host.coverage()) || {};
    const vit = (host.vitals && host.vitals()) || {};
    const g = (k, d) => (Number.isFinite(+cov[k]) ? clamp(+cov[k], 0, 1.5) : d);
    const health = g('health', 0.5);
    const water = g('water', 0.7);
    const food = g('food', 0.7);
    const pop = Math.max(0, (host.pop && host.pop()) || 0);
    const cap = Math.max(1, (host.popCap && host.popCap()) || pop || 1);
    const density = clamp(pop / cap, 0, 1.4);
    // Sanitation reads off the city's `health` vital when the coverage map is
    // absent (the Browser pane's headless mode hands back {}).
    const hv = Number.isFinite(+vit.health) ? clamp(+vit.health / 100, 0, 1) : health;

    const p =
      (1 - clamp(Math.min(health, hv), 0, 1)) * 0.46 +
      (1 - clamp(water, 0, 1)) * 0.22 +
      (1 - clamp(food, 0, 1)) * 0.12 +
      clamp(density - 0.7, 0, 0.7) * 0.29;
    /* 💊 PROPHYLAXIS. Medicine the city's clinics actually SOLD to NPCs
       (/src/hospital/pharma.js prophylaxisOf) discounts the pressure. It
       arrives through the host, optional, 0 when no hospital exists — so a
       city with no Medical Corporation is exactly as it was. It is a
       multiplier, so it cannot lift a clean city's zero and cannot by itself
       take a filthy one to zero (capped inside pharma.js). */
    let proph = 0;
    try { proph = clamp(+(host.prophylaxis && host.prophylaxis()) || 0, 0, 0.9); } catch (e) { proph = 0; }
    return +clamp(p * (1 - proph), 0, 1).toFixed(3);
  } catch (e) { return 0; }
}

/* ── state ─────────────────────────────────────────────────────────────────
   Kept in the module, serialised through state.js. Infections are keyed by
   citizen id and are DISPOSABLE: a citizen who leaves the roster simply loses
   their infection on the next reconcile. Nothing chases them. */
export function emptyState() {
  return {
    v: V,
    strains: [],            // every strain this city has ever seen, wild + iatrogenic
    infections: {},         // czId -> { strainId, stage, since, until }
    immune: {},             // czId -> { strainId, until }
    /* 🔴 STRAINS WAITING FOR PEOPLE. A strain can be introduced while there is
       nobody to give it to — and that is the COMMON case, not an edge one: a
       cure shipment lands on the game's own poll, and the player is almost
       never standing in the city builder when it does. Without this queue a
       mutant born from a botched batch would be filed in the register, infect
       nobody, and quietly never happen — which would delete the entire "you
       can make it worse" promise for anyone who collects a crate from the
       Operations screen.
       Entries are drained by tick() the moment a roster exists. */
    pending: [],            // [{ strainId, count, why, at }]
    lastEmergeAt: 0,
    lastTickAt: 0,
    log: [],                // newest-first, capped
  };
}

export function normalise(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  try {
    if (Array.isArray(raw.strains)) s.strains = raw.strains.filter((x) => x && x.id).slice(0, 60);
    if (raw.infections && typeof raw.infections === 'object') s.infections = Object.assign({}, raw.infections);
    if (raw.immune && typeof raw.immune === 'object') s.immune = Object.assign({}, raw.immune);
    if (Array.isArray(raw.pending)) s.pending = raw.pending.filter((x) => x && x.strainId).slice(0, 20);
    s.lastEmergeAt = +raw.lastEmergeAt || 0;
    s.lastTickAt = +raw.lastTickAt || 0;
    if (Array.isArray(raw.log)) s.log = raw.log.slice(0, 40);
  } catch (e) {}
  return s;
}

export function strainById(st, id) {
  for (const s of st.strains) if (s && s.id === id) return s;
  return null;
}
export function activeStrains(st) {
  return st.strains.filter((s) => s && !s.curedAt);
}
export function activeWild(st) {
  return activeStrains(st).filter((s) => s.origin === 'wild');
}
export function infectedIds(st, strainId) {
  const out = [];
  for (const k of Object.keys(st.infections)) {
    const i = st.infections[k];
    if (i && i.stage !== 'recovered' && (!strainId || i.strainId === strainId)) out.push(k);
  }
  return out;
}
export function caseCount(st, strainId) { return infectedIds(st, strainId).length; }

function logIt(st, kind, text, strainId) {
  st.log.unshift({ at: Date.now(), kind, text, strainId: strainId || null });
  if (st.log.length > 40) st.log.length = 40;
}

/* ── introduce ─────────────────────────────────────────────────────────────
   The one entry point that puts a strain into a city. Used by BOTH the wild
   emergence path below and the iatrogenic path in state.js when a bad batch
   is administered — same code, so a mutant behaves exactly like any other
   virus once it is loose. That symmetry is why "you made this" lands. */
export function introduce(host, st, strain, seedCount, why) {
  if (!strain || !strain.id) return null;
  if (!strainById(st, strain.id)) st.strains.push(strain);
  const roster = safeCitizens(host);
  if (!roster.length) {
    /* 🔴 QUEUE IT, DO NOT DROP IT. See the `pending` note in emptyState(): the
       usual way a strain is introduced is a cure shipment landing while the
       player is nowhere near the city builder, and a strain that seeds nobody
       is a strain that never happened. It waits here and takes hold the first
       time the city ticks with people in it. */
    // Defensive: `introduce` is exported, and a state blob from an older save
    // (or a caller that built one by hand) may predate the queue.
    if (!Array.isArray(st.pending)) st.pending = [];
    if (!st.pending.some((p) => p.strainId === strain.id)) {
      st.pending.push({ strainId: strain.id, count: seedCount | 0 || TUNING.SEED_INFECTIONS, why: why || '', at: Date.now() });
      if (st.pending.length > 20) st.pending.splice(0, st.pending.length - 20);
    }
    logIt(st, strain.origin === 'iatrogenic' ? 'iatrogenic' : 'emerge',
      (strain.origin === 'iatrogenic' ? '☣️ ' : '🦠 ') + strain.name + ' (' + strain.isolate + ') is in the register — ' +
      'it takes hold the next time the city is running.', strain.id);
    return strain;
  }
  const r = rngFrom('seed:' + strain.id + ':' + roster.length);
  const want = Math.max(1, Math.min(seedCount | 0 || TUNING.SEED_INFECTIONS, roster.length));
  const picked = {};
  for (let tries = 0; Object.keys(picked).length < want && tries < want * 12; tries++) {
    const c = roster[Math.floor(r() * roster.length)];
    if (!c || picked[c.id] || st.infections[c.id]) continue;
    picked[c.id] = 1;
    infect(host, st, c.id, strain, 'index case');
  }
  logIt(st, strain.origin === 'iatrogenic' ? 'iatrogenic' : 'emerge',
    (strain.origin === 'iatrogenic' ? '☣️ ' : '🦠 ') + strain.name + ' (' + strain.isolate + ') — ' +
    (why || 'first cases reported') + '.', strain.id);
  return strain;
}

function infect(host, st, czId, strain, why) {
  const now = Date.now();
  const im = st.immune[czId];
  if (im && im.strainId === strain.id && im.until > now) return false;
  if (st.infections[czId]) return false;
  st.infections[czId] = {
    strainId: strain.id,
    stage: 'incubating',
    since: now,
    until: now + TUNING.INCUBATE_MS,
    why: why || '',
  };
  return true;
}

function safeCitizens(host) {
  try {
    const l = (host.citizens && host.citizens()) || [];
    return Array.isArray(l) ? l.filter((c) => c && c.id != null) : [];
  } catch (e) { return []; }
}

/* ── tick ══════════════════════════════════════════════════════════════════
   Advances stages, spreads, recovers, and MAYBE emerges a new wild strain.
   `dtMs` is real elapsed time, so the same function serves the live loop and
   the offline catch-up — there is no second, drifting "away" implementation.

   ⚠ IT IS IDEMPOTENT-ISH BY DESIGN: everything is driven off absolute `until`
   timestamps rather than accumulated counters, so a doubled tick (the live
   loop plus a catch-up that overlapped) advances nothing twice. Every other
   idle system in this codebase learned that the hard way. */
export function tick(host, st, dtMs) {
  const now = Date.now();
  const dt = clamp(+dtMs || 0, 0, 36 * 3600000);
  st.lastTickAt = now;
  const roster = safeCitizens(host);
  const byId = {}; for (const c of roster) byId[c.id] = c;
  const events = [];

  // ── 1. reconcile: drop infections for citizens who left the roster.
  for (const k of Object.keys(st.infections)) if (!byId[k]) delete st.infections[k];
  for (const k of Object.keys(st.immune)) {
    if (!byId[k] || st.immune[k].until <= now) delete st.immune[k];
  }

  /* ── 1b. drain the pending queue. Strains introduced while the city was not
     loaded (a cure shipment landing on the game's poll — the usual case) take
     hold HERE, the first tick with people in the roster.
     ⚠ Drained BEFORE stages advance, so a strain that has been waiting does
       not also skip a stage on the tick it lands. A cured strain in the queue
       is dropped rather than seeded: it was retired while it waited. */
  if (!Array.isArray(st.pending)) st.pending = [];
  if (st.pending.length && roster.length) {
    const still = [];
    for (const p of st.pending) {
      const s = strainById(st, p.strainId);
      if (!s || s.curedAt) continue;              // retired while it waited
      introduce(host, st, s, p.count, p.why || 'took hold');
      /* A seeding attempt can legitimately place nobody — every citizen may
         already be ill or immune. Retry on later ticks, but BOUNDED: an entry
         that has failed a dozen times on a saturated city is not going to
         succeed by being asked a thirteenth, and an unbounded retry is a queue
         that grows forever inside a save blob. */
      if (!infectedIds(st, s.id).length && (p.tries | 0) < 12) {
        still.push(Object.assign({}, p, { tries: (p.tries | 0) + 1 }));
      }
    }
    st.pending = still;
  }

  // ── 2. advance stages
  for (const k of Object.keys(st.infections)) {
    const inf = st.infections[k];
    const strain = strainById(st, inf.strainId);
    if (!strain) { delete st.infections[k]; continue; }
    /* A strain that has been CURED clears everyone still carrying it. The cure
       is retroactive on purpose: a player who beat the strain should not then
       watch a dozen stragglers suffer for two more hours of real time. */
    if (strain.curedAt) {
      st.immune[k] = { strainId: strain.id, until: now + TUNING.IMMUNE_MS };
      delete st.infections[k];
      continue;
    }
    if (now < inf.until) continue;
    if (inf.stage === 'incubating') {
      inf.stage = 'symptomatic';
      inf.since = now;
      inf.until = now + TUNING.SYMPTOM_MS;
      events.push({ kind: 'symptoms', czId: k, strainId: strain.id, name: (byId[k] || {}).name });
    } else if (inf.stage === 'symptomatic') {
      /* Severity decides whether they worsen or turn the corner. Deterministic
         per (citizen, strain, stage) so a reload cannot reroll someone's
         illness — the same reason administer() takes a seeded roll. */
      const r = rngFrom('prog:' + k + ':' + strain.id + ':' + inf.since)();
      const worsen = r < (0.10 + strain.severity * 0.07);
      if (worsen) {
        inf.stage = 'critical';
        inf.since = now;
        inf.until = now + TUNING.RECOVER_MS;
        events.push({ kind: 'critical', czId: k, strainId: strain.id, name: (byId[k] || {}).name });
      } else {
        clearOne(st, k, strain, now, events, byId);
      }
    } else if (inf.stage === 'critical') {
      // 🔴 CRITICAL ALWAYS RECOVERS. See rule 2 in this file's header.
      clearOne(st, k, strain, now, events, byId);
    }
  }

  // ── 3. spread. Coworkers first (they share a building tile), then the wider
  //    roster at a much lower rate. Capped per tick, hard.
  const hours = dt / 3600000;
  let spread = 0;
  const sick = infectedIds(st);
  for (const czId of sick) {
    if (spread >= TUNING.SPREAD_PER_TICK_MAX) break;
    const inf = st.infections[czId];
    if (!inf || inf.stage === 'incubating') continue;   // incubating does not transmit
    const strain = strainById(st, inf.strainId);
    if (!strain || strain.curedAt) continue;
    const cases = caseCount(st, strain.id);
    if (cases >= Math.ceil(roster.length * TUNING.CEILING_SHARE)) continue;
    // Expected secondary infections per hour for this carrier. See the R₀ note
    // on CONTACTS_PER_HR — this is the one line that decides whether an
    // outbreak grows or fizzles, and it is written to be read as that.
    const p = clamp(strain.contagion * TUNING.CONTACTS_PER_HR * hours, 0, 0.9);
    const r = rngFrom('spread:' + czId + ':' + Math.floor(now / 60000));
    if (r() > p) continue;
    const me = byId[czId];
    // Prefer a coworker — the workplace is the real transmission graph the
    // city already models (citizens hold a job at a specific tile key).
    let pool = [];
    if (me && me.job) pool = roster.filter((c) => c.job === me.job && c.id !== czId && !st.infections[c.id]);
    if (!pool.length) pool = roster.filter((c) => c.id !== czId && !st.infections[c.id]);
    if (!pool.length) continue;
    const target = pool[Math.floor(r() * pool.length)];
    if (!target) continue;
    if (infect(host, st, target.id, strain, me && me.job ? 'workplace contact' : 'community contact')) {
      spread++;
      events.push({ kind: 'spread', czId: target.id, strainId: strain.id, name: target.name, from: (me || {}).name });
    }
  }

  // ── 4. mood. The ONLY write into a citizen, and it is the sanctioned seam.
  try {
    if (host.nudge) {
      for (const k of Object.keys(st.infections)) {
        const inf = st.infections[k];
        const d = TUNING.MOOD[inf.stage] || 0;
        // Scaled by elapsed hours so a long absence does not slam everyone to
        // zero the instant the player returns.
        if (d) host.nudge(k, d * clamp(hours, 0, 1));
      }
    }
  } catch (e) {}

  // ── 5. emergence
  const emerged = maybeEmerge(host, st, hours, roster);
  if (emerged) events.push({ kind: 'emerge', strainId: emerged.id, name: emerged.name });

  return { events, pressure: pressureOf(host), cases: infectedIds(st).length };
}

function clearOne(st, czId, strain, now, events, byId) {
  st.immune[czId] = { strainId: strain.id, until: now + TUNING.IMMUNE_MS };
  delete st.infections[czId];
  events.push({ kind: 'recovered', czId, strainId: strain.id, name: (byId[czId] || {}).name });
}

function maybeEmerge(host, st, hours, roster) {
  const now = Date.now();
  if (now - (st.lastEmergeAt || 0) < TUNING.COOLDOWN_MS) return null;
  if (roster.length < 4) return null;
  const pop = (host.pop && host.pop()) || 0;
  if (pop < TUNING.MIN_POP) return null;
  if (activeWild(st).length >= TUNING.MAX_ACTIVE_WILD) return null;

  const pressure = pressureOf(host);
  if (pressure <= 0.05) return null;               // a clean city is genuinely safe
  const chance = clamp(TUNING.BASE_CHANCE_PER_HR * pressure * Math.max(0.25, hours) * 4, 0, 0.5);
  const r = rngFrom('emerge:' + Math.floor(now / TUNING.COOLDOWN_MS) + ':' + roster.length)();
  if (r > chance) return null;

  /* 🩹 THE FIRST STRAIN A CITY EVER SEES IS CAPPED AT MILD. A player meeting
     this system for the first time gets a problem they can solve with the
     starting resources; the fifth outbreak can be Catastrophic. Difficulty
     that ramps is difficulty players stay for. */
  const first = st.strains.length === 0;
  const strain = makeStrain('wild:' + (host.cityId ? host.cityId() : 'city') + ':' + now,
    { pressure: first ? Math.min(pressure, 0.2) : pressure, bornAt: now, origin: 'wild' });
  if (first) { strain.severity = Math.min(strain.severity, 2); strain.contagion = Math.min(strain.contagion, 0.3); }
  st.lastEmergeAt = now;
  introduce(host, st, strain, TUNING.SEED_INFECTIONS, 'emerged in the ' +
    (pressure > 0.6 ? 'overrun' : pressure > 0.3 ? 'strained' : 'crowded') + ' districts');
  return strain;
}

/* ── the readout the UIs share ─────────────────────────────────────────────
   One shape, so the city's HUD banner, the lab's strain picker and the
   dispatch board can never disagree about how bad things are. */
export function report(host, st) {
  const roster = safeCitizens(host);
  const strains = activeStrains(st).map((s) => {
    const ids = infectedIds(st, s.id);
    const stages = { incubating: 0, symptomatic: 0, critical: 0 };
    for (const k of ids) { const i = st.infections[k]; if (i && stages[i.stage] != null) stages[i.stage]++; }
    return {
      strain: s, cases: ids.length, stages,
      share: roster.length ? +(ids.length / roster.length).toFixed(3) : 0,
      family: familyOf(s.family),
    };
  }).sort((a, b) => b.cases - a.cases || b.strain.severity - a.strain.severity);

  const cases = infectedIds(st).length;
  return {
    pressure: pressureOf(host),
    roster: roster.length,
    cases,
    share: roster.length ? +(cases / roster.length).toFixed(3) : 0,
    strains,
    worst: strains.length ? strains[0] : null,
    log: st.log.slice(0, 12),
    /* The city's own output penalty from illness. Returned rather than
       applied: this module does not own the city's economy and must not reach
       into it. The adapter decides whether to use it. */
    workforceLoss: +clamp(cases / Math.max(1, roster.length) * 0.7, 0, 0.6).toFixed(3),
    /* 🏭 The health-vital drag the city should actually apply, 0..1. Separate
       from `workforceLoss` because that is the RAW measure (what share of the
       named workforce is down) while this is the BOUNDED penalty, capped by
       WORKFORCE_DRAG_MAX so a total outbreak can never zero a city's output.
       Critical cases count double: someone critically ill is not at work at
       all, where someone symptomatic is working badly. */
    healthDrag: +clamp(
      (strains.reduce((a, s) => a + s.stages.symptomatic + s.stages.critical * 2, 0)
        / Math.max(1, roster.length)) * TUNING.WORKFORCE_DRAG_MAX,
      0, TUNING.WORKFORCE_DRAG_MAX).toFixed(3),
  };
}

/* Retire a strain because a cure cleared it. Everyone carrying it becomes
   immune on the next tick (see the curedAt branch there). */
export function retire(st, strainId, when) {
  const s = strainById(st, strainId);
  if (!s || s.curedAt) return false;
  s.curedAt = +when || Date.now();
  logIt(st, 'cured', '💉 ' + s.name + ' (' + s.isolate + ') cleared.', s.id);
  return true;
}

export function addResistance(st, strainId, gain) {
  const s = strainById(st, strainId);
  if (!s) return 0;
  s.resistance = +clamp((+s.resistance || 0) + (+gain || 0), 0, 0.6).toFixed(3);
  return s.resistance;
}

export function relieve(st, strainId, relief) {
  /* A palliative dose does not clear anyone — it pulls the CRITICAL back to
     symptomatic and buys the symptomatic time. Modelled by pushing their
     `until` out, which is the same clock everything else here runs on. */
  const g = clamp(+relief || 0, 0, 1);
  let touched = 0;
  for (const k of Object.keys(st.infections)) {
    const i = st.infections[k];
    if (!i || i.strainId !== strainId) continue;
    if (i.stage === 'critical') { i.stage = 'symptomatic'; i.since = Date.now(); }
    i.until = Date.now() + TUNING.SYMPTOM_MS * (0.4 + g * 0.6);
    touched++;
  }
  return touched;
}
