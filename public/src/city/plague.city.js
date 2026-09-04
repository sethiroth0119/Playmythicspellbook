/* ═══════════════════════════════════════════════════════════════════════════
   🦠 THE OUTBREAK ENGINE — catch → spread → research → SHIP → administer.

   The catalog and all of the maths live in `plague.data.js`; this file is the
   state machine, the city wiring and the panel. Mounted from
   `public/node-city/index.html` the same way the House and the Stadium are.

   ─────────────────────────────────────────────────────────────────────────
   🔴 THE GLOBALS TRAP (CLAUDE.md), and this is the FIFTH module to hit it.
   `game`, `vitals`, `wellbeing`, `BUILDINGS`, `cityPop`, `popCap` and
   `MythicCityBridge` are top-level `const` in node-city's module script and
   are invisible from here. There is no `window.game` and there never will be.
   The ctx object passed to mount() IS the hand-over — if this module needs
   something new from the city, it gets ADDED TO THE CTX, never reached for.

   ⚠ Note what is NOT handed over: no raw write access to `game.stock`. The
     module gets `spendStock`/`addStock` accessors with an inverse, exactly the
     way the Stadium gets its four money calls, because a cure batch has to be
     able to fail and leave the city's books where it found them.

   ─────────────────────────────────────────────────────────────────────────
   🏭 THE TWO-BUILDING PIPELINE, which is the whole reason this system exists
      in the shape it does:

        RESEARCH FACILITY  🔬   synthesises doses      →  vault (at the lab)
                                       ↓ shipDoses()
        MEDICAL CORP.      💊   administers doses      →  citizens recover

   A player with a Research Facility and no Medical Corp. can make every cure
   in the game and cure NOBODY. That is not an oversight to be smoothed over
   later — it is the mechanic. Doses sitting in the vault are inert, and the
   panel says so in as many words.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  PLAGUE_VIRUSES, PLAGUE_CURES, PLAGUE_IDS, cureForVirus,
  PLAGUE_SEED_FRAC, PLAGUE_CLEAR_FRAC, PLAGUE_GRACE_CITY_MIN,
  PLAGUE_RECATCH_CD_MIN, PLAGUE_MAX_ACTIVE,
  spreadStep, deathsStep, administer, labourMul, severity,
} from './plague.data.js';

/* 🏥 Doses one Medical Corp. gets into arms per city-minute. Scales linearly
   with clinics, because "build a second clinic" must be a real answer to a big
   outbreak — otherwise the only lever is research speed and the Medical Corp.
   goes back to being a Health-coverage trinket. */
const DOSES_PER_CLINIC_MIN = 6;

/* 🔒 QUARANTINE. Multiplies r0, and costs labour on top of whatever the virus
   is already taking. It is the ONLY thing a player can do in the gap between
   detection and the first shipment, and that gap is 6–22 city-minutes of
   research plus travel — long enough that having no lever at all would make
   detection feel like a cutscene. Priced so it is a real decision: halving
   spread for a fifth of your output is worth it for Violet Wither and a bad
   trade for Ashlung. */
const QUARANTINE_R_MUL = 0.45, QUARANTINE_LABOUR = 0.80;

/* ⏱ How often the vector test runs, in city-minutes. Not every tick: `catch`
   is six pure functions over a snapshot and running them 20×/second is free,
   but ROLLING against them that often turns a 3%/check pressure into a
   certainty within seconds. The check cadence IS part of the tuning. */
const CATCH_CHECK_MIN = 5;

/* 🎲 The one and only random roll in this system, and it is deliberately
   bounded: pressure (0..1 from the vector) × this = chance per check. At full
   pressure that is a ~28%/check chance, i.e. a city sitting at the bottom of a
   vector catches the virus within a few checks — reliably, but not on the
   exact tick it crosses the line, so the player gets a beat to react to the
   red vital before the outbreak lands. Pressure 0 can never fire: see the
   `below()`/`above()` note in plague.data.js. */
const CATCH_ROLL = 0.28;

/* Deaths accumulate as a float and are only taken out of the citizenry when a
   whole person has died — see deathsStep's note on why rounding per tick makes
   small cities immortal. */
const DEATH_EPS = 1;

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── module-scope state. One city per page, same as the House and Stadium. ── */
let C = null;                 // the ctx hand-over
let PL = null;                // the saved state slice
let _catchAcc = 0;            // city-minutes since the last vector check
let _panelOpen = false;

function freshState() {
  return {
    active: {},      // virusId -> { id, inf, imm, since, deaths, quarantine }
    cured: {},       // virusId -> cityAge at cure, for the re-catch cooldown
    research: null,  // { cureId, left, doses } — `left` is city-minutes REMAINING
    vault: {},       // cureId -> doses held AT THE RESEARCH FACILITY (inert)
    clinic: {},      // cureId -> doses held AT THE MEDICAL CORP. (administering)
    toll: 0,         // lifetime deaths, whole people
    _pend: 0,        // sub-person death accumulator (never shown)
  };
}

/* ═══ 1. THE CITY SNAPSHOT ══════════════════════════════════════════════════
   Every `catch` function in the catalog is pure over this object, which means
   the vector tests can be driven by the diagnostics harness with a fabricated
   city and no DOM. Everything is read through ctx accessors and every one of
   them is guarded — a half-built city mid-load must produce a snapshot that
   simply catches nothing, not a throw inside economyTick. */
function snapshot() {
  const cov = (C.game.cov && C.game.cov.pct) || {};
  const pop = Math.max(1, C.pop());
  const cap = Math.max(1, C.popCap());
  let lab = { sited: false, containment: 100, tier: 1 };
  try { const l = C.lab && C.lab(); if (l) lab = { sited: !!l.sited, containment: +l.containment || 0, tier: Math.max(1, l.tier | 0) }; } catch (e) {}
  return {
    cov: {
      food:   clamp01(cov.food   != null ? cov.food   : 1),
      water:  clamp01(cov.water  != null ? cov.water  : 1),
      health: clamp01(cov.health != null ? cov.health : 1),
    },
    vitals: C.vitals,
    pop, popFrac: clamp01(pop / cap),
    stock: { remedies: C.stockOf('remedies'), reagents: C.stockOf('reagents') },
    heavyOps: (() => { try { return C.heavyOps() | 0; } catch (e) { return 0; } })(),
    shardsHandled: (() => { try { return !!C.shardsHandled(); } catch (e) { return false; } })(),
    lab,
    activeCount: Object.keys(PL.active).length,
  };
}

/* ═══ 2. CATCHING ══════════════════════════════════════════════════════════ */
function tryCatch(dtMin) {
  _catchAcc += dtMin;
  if (_catchAcc < CATCH_CHECK_MIN) return;
  _catchAcc = 0;
  /* 🚪 A city cannot be born mid-plague. See PLAGUE_GRACE_CITY_MIN. */
  const age = +C.game.cityAge || 0;
  if (age < PLAGUE_GRACE_CITY_MIN) return;

  const snap = snapshot();
  const activeIds = Object.keys(PL.active);

  for (const id of PLAGUE_IDS) {
    const v = PLAGUE_VIRUSES[id];
    if (PL.active[id]) continue;
    /* ⏳ Re-catch cooldown — a cure the player can watch fail to hold is worse
       than no cure. */
    const curedAt = PL.cured[id];
    if (curedAt != null && age - curedAt < PLAGUE_RECATCH_CD_MIN) continue;
    /* 🔒 The concurrent cap, and Grey Marrow's exemption. Capping the
       opportunist out would mean the worst virus in the catalog can only land
       on a city that is not yet in trouble — exactly backwards. */
    if (activeIds.length >= PLAGUE_MAX_ACTIVE && id !== 'greymarrow') continue;

    let pressure = 0;
    try { pressure = clamp01(v.catch(snap)); } catch (e) { pressure = 0; }
    if (pressure <= 0) continue;
    if (Math.random() >= pressure * CATCH_ROLL) continue;

    PL.active[id] = { id, inf: PLAGUE_SEED_FRAC, imm: 0, since: age, deaths: 0, quarantine: false };
    activeIds.push(id);
    const cure = cureForVirus(id);
    C.logEvent('raid', v.ico + ' OUTBREAK — <b>' + esc(v.name) + '</b> detected in the city. ' +
      esc(v.vector) + ' Synthesise <b>' + esc(cure ? cure.name : 'a cure') +
      '</b> at a Research Facility, then ship it to your Medical Corp.');
    C.toast(v.ico + ' Outbreak: ' + v.name + ' — open the Outbreak panel.', 'bad');
    renderPanel();
  }
}

/* ═══ 3. THE TICK ══════════════════════════════════════════════════════════
   Called from node-city's economyTick with the SAME dtMin the economy ran on,
   so an offline catch-up slices an epidemic at exactly the resolution it
   slices production — no parallel offline formula, nothing to keep in sync.
   (Same reasoning as the House's placement inside economyTick.) */
export function tick(dtMin) {
  if (!C || !PL || !(dtMin > 0)) return;
  try {
    researchTick(dtMin);
    clinicTick(dtMin);
    spreadTick(dtMin);
    tryCatch(dtMin);
  } catch (e) { console.warn('[plague] tick', e); }
}

function spreadTick(dtMin) {
  const ids = Object.keys(PL.active);
  if (!ids.length) return;
  const pop = Math.max(1, C.pop());
  let died = 0;

  for (const id of ids) {
    const a = PL.active[id], v = PLAGUE_VIRUSES[id];
    if (!v) { delete PL.active[id]; continue; }
    const r = v.r0 * (a.quarantine ? QUARANTINE_R_MUL : 1);
    a.inf = spreadStep(a.inf, a.imm || 0, r, dtMin);
    const d = deathsStep(pop, a.inf, v.lethality, dtMin);
    a.deaths += d; died += d;

    /* 🛡 THE ALL-CLEAR. Doses drive `inf` DOWN in clinicTick; this is where an
       outbreak that has been pushed under the floor is actually struck off. */
    if (a.inf <= PLAGUE_CLEAR_FRAC) {
      delete PL.active[id];
      PL.cured[id] = +C.game.cityAge || 0;
      C.logEvent('city good', '✅ <b>' + esc(v.name) + '</b> has been contained — the last cases have recovered. ' +
        (a.deaths >= 1 ? Math.floor(a.deaths).toLocaleString() + ' did not.' : 'Nobody died.'));
      C.toast('✅ ' + v.name + ' contained.', 'good');
      renderPanel();
    }
  }

  /* ⚰️ Deaths come out of the SOFT citizenry (`game.pop.npc`), the same number
     the coverage model already grows and shrinks. Accumulated as a float and
     only spent a whole person at a time — see DEATH_EPS. */
  if (died > 0) {
    PL._pend += died;
    if (PL._pend >= DEATH_EPS) {
      const whole = Math.floor(PL._pend);
      PL._pend -= whole;
      PL.toll += whole;
      try { C.killPop(whole); } catch (e) {}
    }
  }

  /* 🩺 The vitals drag. Pushed as a RATE onto the existing health vital rather
     than written as a level, so the city's own VITAL_LERP still owns the
     number and a cured city climbs back out on its own schedule. Same for
     morale. Scaled by infected fraction for the same reason labourMul is —
     a 3% outbreak is not yet a health crisis. */
  let dHealth = 0, dMorale = 0;
  for (const id of Object.keys(PL.active)) {
    const a = PL.active[id], v = PLAGUE_VIRUSES[id];
    dHealth += v.effects.health * Math.min(1, a.inf) * dtMin;
    dMorale += v.effects.morale * Math.min(1, a.inf) * dtMin;
  }
  if (dHealth) C.nudgeVital('health', dHealth);
  if (dMorale) C.nudgeMorale(dMorale);
}

/* ═══ 4. RESEARCH — the Research Facility half ═════════════════════════════ */
function researchTick(dtMin) {
  const R = PL.research; if (!R) return;
  /* 🔬 Speed scales with STAFFED Research Facilities. Zero facilities does not
     cancel the batch — the player may have unsited the lab mid-run and the
     cost is already spent (see the charge-on-start note in plague.data.js) —
     it simply stops the clock, and the panel says "no Research Facility". */
  const labs = C.countOp('research');
  if (labs <= 0) return;
  R.left -= dtMin * labs;
  if (R.left > 0) return;

  const cure = PLAGUE_CURES[R.cureId];
  PL.research = null;
  if (!cure) return;
  PL.vault[cure.id] = (PL.vault[cure.id] || 0) + R.doses;
  C.logEvent('city good', '🔬 <b>' + esc(cure.name) + '</b> synthesised — ' + R.doses +
    ' doses are in the lab vault. <b>They cure nobody until they are shipped to your Medical Corp.</b>');
  C.toast('🔬 ' + cure.name + ' ready — ship it to the Medical Corp.', 'good');
  C.saveSoon(); renderPanel();
}

/* ⚠ ASYNC because Memory Shards live in the GAME ledger, not city stock, and
   the bridge's spendRes is a round trip to the parent frame. City stock is
   spent first (synchronous, local); if the shard leg then fails, the stock is
   put straight back with addStock — that inverse is exactly why the ctx hands
   this module a paired spend/add rather than raw access to `game.stock`. */
export async function startResearch(cureId) {
  const cure = PLAGUE_CURES[cureId];
  if (!C || !cure) return { ok: false, error: 'no-cure' };
  if (PL.research) return { ok: false, error: 'busy' };
  if (C.countOp('research') <= 0) return { ok: false, error: 'no-lab' };
  /* 💸 Charged HERE, on start. A batch that started will always finish. */
  if (!C.spendStock(cure.cost)) return { ok: false, error: 'stock' };
  if (cure.shards > 0) {
    let paid = false;
    try { paid = await C.spendShards(cure.shards); } catch (e) { paid = false; }
    if (!paid) {
      C.addStock(cure.cost);        // the inverse — the books go back untouched
      return { ok: false, error: 'shards' };
    }
  }
  PL.research = { cureId: cure.id, left: cure.minutes, doses: cure.doses };
  C.logEvent('city', '🔬 Research started — <b>' + esc(cure.name) + '</b>, ' + cure.minutes +
    ' city-minutes at one facility.');
  C.saveSoon(); renderPanel();
  return { ok: true };
}

export async function cancelResearch() {
  if (!C || !PL.research) return false;
  const cure = PLAGUE_CURES[PL.research.cureId];
  /* 🔴 DESTRUCTIVE AND UNREFUNDED, so it asks. See plague.data.js. */
  const ok = await C.confirm('Scrap the ' + (cure ? cure.name : 'current') +
    ' batch? The reagents are already spent and will NOT come back.');
  if (!ok) return false;
  PL.research = null;
  C.logEvent('city', '🔬 Research batch scrapped.');
  C.saveSoon(); renderPanel();
  return true;
}

/* ═══ 5. SHIPPING — the seam the whole system is built around ══════════════
   Doses in the VAULT are inert. This is the only thing that moves them into
   the CLINIC, and it requires a sited Medical Corp. If a player never buys
   one, every cure they synthesise stays in a freezer at the lab. */
export function shipDoses(cureId, n) {
  if (!C) return { ok: false, error: 'no-city' };
  const have = PL.vault[cureId] || 0;
  const send = Math.min(have, Math.max(0, n | 0) || have);
  if (send <= 0) return { ok: false, error: 'empty' };
  const clinics = C.countOp('medical');
  if (clinics <= 0) {
    C.toast('💊 No Medical Corp. in this city — there is nobody to administer them.', 'bad');
    return { ok: false, error: 'no-clinic' };
  }
  PL.vault[cureId] = have - send;
  PL.clinic[cureId] = (PL.clinic[cureId] || 0) + send;
  const cure = PLAGUE_CURES[cureId];
  C.logEvent('city good', '🚚 ' + send + ' doses of <b>' + esc(cure ? cure.name : cureId) +
    '</b> delivered to the Medical Corp. Administering now.');
  C.toast('🚚 ' + send + ' doses delivered to the Medical Corp.', 'good');
  C.saveSoon(); renderPanel();
  return { ok: true, sent: send };
}

/* ═══ 6. ADMINISTERING — the Medical Corp. half ════════════════════════════ */
function clinicTick(dtMin) {
  const clinics = C.countOp('medical');
  if (clinics <= 0) return;
  const budget = DOSES_PER_CLINIC_MIN * clinics * dtMin;
  const pop = Math.max(1, C.pop());
  let left = budget;

  /* Triage by severity, so a clinic short on throughput treats Violet Wither
     before Cinder Pox rather than whichever virus happens to sort first. */
  const order = Object.keys(PL.active).sort((a, b) => severity(PL.active[b]) - severity(PL.active[a]));
  for (const vid of order) {
    if (left <= 0) break;
    const a = PL.active[vid], cure = cureForVirus(vid);
    if (!cure) continue;
    const stock = PL.clinic[cure.id] || 0;
    if (stock <= 0) continue;
    const offer = Math.min(stock, left);
    const { used, cured } = administer(pop, a.inf, offer);
    if (used <= 0) continue;
    PL.clinic[cure.id] = stock - used;
    left -= used;
    /* 🔴 Recovered citizens move into the IMMUNE pool, not back into the
       susceptible one. They are NOT removed from the population — they got
       better. Without the `imm` half the clinic refills the pool it is
       draining and a fully-cured city re-infects itself; see spreadStep's
       header for the measured run that proved it. */
    const frac = cured / pop;
    a.inf = Math.max(0, a.inf - frac);
    a.imm = Math.min(1, (a.imm || 0) + frac);
  }
}

/* ═══ 7. WHAT THE CITY ASKS US ════════════════════════════════════════════
   Read by node-city's economy so an outbreak actually costs output, and by the
   demand model so a fever really does drink more water. Both are pure reads
   with a safe default — if this module never mounted, the city behaves exactly
   as it did before it existed. */
export function outputMul() {
  if (!PL) return 1;
  const act = Object.values(PL.active);
  if (!act.length) return 1;
  let m = labourMul(act);
  for (const a of act) if (a.quarantine) m *= QUARANTINE_LABOUR;
  return m;
}
export function demandMul(need) {
  if (!PL) return 1;
  let m = 1;
  for (const a of Object.values(PL.active)) {
    const v = PLAGUE_VIRUSES[a.id]; if (!v) continue;
    const f = need === 'water' ? v.effects.waterMul : need === 'food' ? v.effects.foodMul : 1;
    m *= 1 + (f - 1) * Math.min(1, a.inf);
  }
  return m;
}
export function activeList() {
  return PL ? Object.values(PL.active).slice().sort((a, b) => severity(b) - severity(a)) : [];
}
/* 👤 One line for an infected citizen on the named roster, or null. The roster
   owns WHO is sick — this only says what it looks like. Deterministic on the
   citizen's own name so a given person does not flicker between symptoms. */
export function symptomFor(seed) {
  const act = activeList(); if (!act.length) return null;
  const a = act[0], v = PLAGUE_VIRUSES[a.id];
  if (!v) return null;
  let h = 0; const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 < a.inf ? v.symptom : null;
}

export function toggleQuarantine(vid) {
  const a = PL && PL.active[vid]; if (!a) return false;
  a.quarantine = !a.quarantine;
  const v = PLAGUE_VIRUSES[vid];
  C.logEvent('city', a.quarantine
    ? '🔒 Quarantine declared for <b>' + esc(v.name) + '</b> — spread slowed, the district has stopped working.'
    : '🔓 Quarantine lifted for <b>' + esc(v.name) + '</b>.');
  C.saveSoon(); renderPanel();
  return a.quarantine;
}

/* ═══ 8. SAVE / LOAD ══════════════════════════════════════════════════════
   ⚠ THIS MUST RIDE THE CITY SAVE. An epidemic that resets on reload is a
     refresh button that undoes the whole system — the same failure the
     coverage layer's `ramp` field exists to prevent (see the long note at
     node-city's saveState). Every field is read with a default, so a save
     written before this module existed loads as a healthy city. */
export function save() {
  if (!PL) return null;
  const act = {};
  for (const k in PL.active) {
    const a = PL.active[k];
    act[k] = { id: a.id, inf: +a.inf.toFixed(5), imm: +(a.imm || 0).toFixed(5),
               since: Math.round(a.since || 0),
               deaths: +(a.deaths || 0).toFixed(2), q: !!a.quarantine };
  }
  return { v: 1, active: act, cured: PL.cured, research: PL.research,
           vault: PL.vault, clinic: PL.clinic, toll: PL.toll | 0, pend: +(PL._pend || 0).toFixed(3) };
}
export function load(raw) {
  PL = freshState();
  if (!raw || typeof raw !== 'object') return;
  try {
    for (const k in (raw.active || {})) {
      const a = raw.active[k];
      if (!PLAGUE_VIRUSES[k] || !a) continue;   // a virus removed from the catalog just vanishes
      PL.active[k] = { id: k, inf: clamp01(+a.inf), imm: clamp01(+a.imm),
                       since: +a.since || 0,
                       deaths: +a.deaths || 0, quarantine: !!a.q };
    }
    for (const k in (raw.cured || {})) if (PLAGUE_VIRUSES[k]) PL.cured[k] = +raw.cured[k] || 0;
    for (const k in (raw.vault || {})) if (PLAGUE_CURES[k]) PL.vault[k] = Math.max(0, +raw.vault[k] || 0);
    for (const k in (raw.clinic || {})) if (PLAGUE_CURES[k]) PL.clinic[k] = Math.max(0, +raw.clinic[k] || 0);
    const R = raw.research;
    if (R && PLAGUE_CURES[R.cureId] && +R.left > 0) {
      PL.research = { cureId: R.cureId, left: +R.left, doses: Math.max(1, R.doses | 0) };
    }
    PL.toll = Math.max(0, raw.toll | 0);
    PL._pend = Math.max(0, +raw.pend || 0);
  } catch (e) { console.warn('[plague] load', e); PL = freshState(); }
}

/* ═══ 9. THE PANEL ════════════════════════════════════════════════════════
   Self-contained DOM and CSS under a `pl-` prefix, injected into body rather
   than woven into node-city's markup — the same additive stance the ops layer
   took, and for the same reason: several builders are inside that file. */
const CSS = `
.pl-badge{position:fixed;right:12px;bottom:118px;z-index:60;background:#241016;border:1px solid #7d2740;
 color:#ffb3c1;border-radius:10px;padding:7px 11px;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer;
 box-shadow:0 4px 18px rgba(0,0,0,.5)}
.pl-badge.ok{background:#101c14;border-color:#2c5f3d;color:#9fe0b5}
.pl-wrap{position:fixed;inset:0;z-index:200;background:rgba(4,3,8,.72);display:flex;align-items:center;
 justify-content:center;padding:16px}
.pl-modal{width:min(760px,100%);max-height:88vh;overflow:auto;background:#14101c;border:1px solid #3b2f4d;
 border-radius:14px;padding:16px 18px;color:#e6e0f0;font:13px/1.5 system-ui,sans-serif}
.pl-modal h2{margin:0 0 2px;font-size:17px;color:#f0d78a}
.pl-sub{color:#9a90ad;font-size:12px;margin-bottom:12px}
.pl-card{border:1px solid #3b2f4d;border-radius:10px;padding:11px 12px;margin:9px 0;background:#1b1526}
.pl-card.t3{border-color:#7d2740;background:#221019}
.pl-card.t2{border-color:#7a5320}
.pl-h{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
.pl-h .pl-pct{margin-left:auto;font-variant-numeric:tabular-nums;color:#ffb3c1}
.pl-bar{height:6px;border-radius:4px;background:#2a2136;margin:7px 0;overflow:hidden}
.pl-bar i{display:block;height:100%;background:linear-gradient(90deg,#c8506e,#ff8aa0)}
.pl-vec{color:#9a90ad;font-size:12px;margin:4px 0}
.pl-sym{color:#c9b8e0;font-size:12px;font-style:italic}
.pl-btn{background:#2c2340;border:1px solid #4d3f66;color:#e6e0f0;border-radius:8px;padding:6px 11px;
 font:600 12px system-ui,sans-serif;cursor:pointer;margin:4px 5px 0 0}
.pl-btn:hover{background:#3a2f54}
.pl-btn.go{background:#1d4630;border-color:#2f7049;color:#b6f0cd}
.pl-btn.warn{background:#4a1f2c;border-color:#7d2740;color:#ffb3c1}
.pl-btn[disabled]{opacity:.42;cursor:not-allowed}
.pl-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pl-tag{background:#241c33;border:1px solid #40355a;border-radius:6px;padding:2px 7px;font-size:11px;color:#c9b8e0}
.pl-warnbox{border:1px dashed #7d2740;border-radius:8px;padding:8px 10px;margin:8px 0;color:#ffb3c1;font-size:12px}
.pl-x{float:right;cursor:pointer;color:#9a90ad;font-size:20px;line-height:1;margin:-4px -4px 0 0}
.pl-sec{margin-top:14px;font-weight:700;color:#f0d78a;font-size:13px;border-top:1px solid #2e2540;padding-top:11px}
`;

function ensureCss() {
  if (document.getElementById('pl-css')) return;
  const s = document.createElement('style'); s.id = 'pl-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

function badge() {
  ensureCss();
  let b = document.getElementById('pl-badge');
  if (!b) {
    b = document.createElement('button'); b.id = 'pl-badge'; b.className = 'pl-badge';
    b.onclick = openPanel; document.body.appendChild(b);
  }
  const act = activeList();
  if (!act.length) {
    b.className = 'pl-badge ok';
    b.innerHTML = '🩺 Public Health — clear';
  } else {
    b.className = 'pl-badge';
    b.innerHTML = act[0].id === undefined ? '🩺' :
      PLAGUE_VIRUSES[act[0].id].ico + ' ' + act.length + ' outbreak' + (act.length > 1 ? 's' : '') +
      ' · ' + Math.round(act[0].inf * 100) + '% infected';
  }
  return b;
}

export function openPanel() { _panelOpen = true; renderPanel(); }
export function closePanel() {
  _panelOpen = false;
  const w = document.getElementById('pl-wrap'); if (w) w.remove();
}

function renderPanel() {
  try { badge(); } catch (e) {}
  if (!_panelOpen) return;
  ensureCss();
  let w = document.getElementById('pl-wrap');
  if (!w) {
    w = document.createElement('div'); w.id = 'pl-wrap'; w.className = 'pl-wrap';
    w.onclick = (e) => { if (e.target === w) closePanel(); };
    document.body.appendChild(w);
  }
  const labs = C.countOp('research'), clinics = C.countOp('medical');
  const act = activeList();
  const pop = Math.max(1, C.pop());

  let h = '<div class="pl-modal"><span class="pl-x" id="pl-close">×</span>' +
    '<h2>🩺 Public Health</h2>' +
    '<div class="pl-sub">Research Facility 🔬 ' + labs + ' · Medical Corp. 💊 ' + clinics +
    ' · lifetime deaths ' + (PL.toll | 0).toLocaleString() + '</div>';

  /* — active outbreaks — */
  if (!act.length) {
    h += '<div class="pl-card"><div class="pl-h">✅ No active outbreak</div>' +
      '<div class="pl-vec">Every virus in this city has a cause you can see on the Vital Signs panel. ' +
      'Keep Health, Water and Food coverage up, housing under 90% of cap, Hope above 30, and any Anomaly Lab above 55% containment, and nothing here can ever fire.</div></div>';
  }
  for (const a of act) {
    const v = PLAGUE_VIRUSES[a.id], cure = cureForVirus(a.id);
    const sick = Math.round(pop * a.inf);
    const held = cure ? (PL.clinic[cure.id] || 0) : 0;
    h += '<div class="pl-card t' + v.tier + '">' +
      '<div class="pl-h">' + v.ico + ' ' + esc(v.name) +
        '<span class="pl-pct">' + (a.inf * 100).toFixed(1) + '% · ~' + sick.toLocaleString() + ' sick</span></div>' +
      '<div class="pl-bar"><i style="width:' + (a.inf * 100).toFixed(1) + '%"></i></div>' +
      '<div class="pl-vec">🧭 ' + esc(v.vector) + '</div>' +
      '<div class="pl-sym">“' + esc(v.symptom) + '”</div>' +
      '<div class="pl-row" style="margin-top:6px">' +
        '<span class="pl-tag">☠ ' + Math.floor(a.deaths).toLocaleString() + ' dead</span>' +
        '<span class="pl-tag">🛡 ' + Math.round((a.imm || 0) * 100) + '% immune</span>' +
        '<span class="pl-tag">🏭 labour ×' + labourMul([a]).toFixed(2) + '</span>' +
        '<span class="pl-tag">💊 ' + esc(cure ? cure.name : '—') + '</span>' +
        (held > 0 ? '<span class="pl-tag">🏥 ' + held + ' doses at the clinic</span>' : '') +
      '</div>' +
      '<button class="pl-btn ' + (a.quarantine ? 'warn' : '') + '" data-q="' + a.id + '">' +
        (a.quarantine ? '🔓 Lift quarantine' : '🔒 Quarantine (spread ×0.45, output ×0.80)') + '</button>' +
      '</div>';
  }

  /* — research — */
  h += '<div class="pl-sec">🔬 Research Facility — synthesise doses</div>';
  if (labs <= 0) {
    h += '<div class="pl-warnbox">No Research Facility sited. Buy one at City Hall → Just Business, then place it. Nothing can be synthesised without one.</div>';
  }
  if (PL.research) {
    const cure = PLAGUE_CURES[PL.research.cureId];
    const mins = Math.max(0, PL.research.left / Math.max(1, labs));
    h += '<div class="pl-card"><div class="pl-h">' + cure.ico + ' ' + esc(cure.name) +
      '<span class="pl-pct">' + mins.toFixed(1) + ' min left</span></div>' +
      '<div class="pl-bar"><i style="width:' + (100 * (1 - PL.research.left / cure.minutes)).toFixed(1) + '%"></i></div>' +
      '<div class="pl-vec">Yields ' + PL.research.doses + ' doses into the lab vault. ' +
      (labs > 1 ? labs + ' facilities are working on it.' : '') + '</div>' +
      '<button class="pl-btn warn" id="pl-cancel">Scrap batch (no refund)</button></div>';
  } else {
    for (const cid of Object.keys(PLAGUE_CURES)) {
      const cure = PLAGUE_CURES[cid];
      const needed = act.some((a) => a.id === cure.cures);
      const costTxt = Object.keys(cure.cost).map((r) => cure.cost[r] + ' ' + r).join(' · ') +
        (cure.shards ? ' · ' + cure.shards + ' 🧠' : '');
      const afford = C.canAfford(cure.cost) && (!cure.shards || C.shardsOf() >= cure.shards);
      h += '<div class="pl-card' + (needed ? ' t2' : '') + '">' +
        '<div class="pl-h">' + cure.ico + ' ' + esc(cure.name) +
          (needed ? '<span class="pl-pct">needed now</span>' : '') + '</div>' +
        '<div class="pl-vec">' + esc(cure.desc) + '</div>' +
        '<div class="pl-row"><span class="pl-tag">cures ' + esc(PLAGUE_VIRUSES[cure.cures].name) + '</span>' +
        '<span class="pl-tag">' + esc(costTxt) + '</span>' +
        '<span class="pl-tag">' + cure.minutes + ' min → ' + cure.doses + ' doses</span></div>' +
        '<button class="pl-btn go" data-res="' + cid + '"' +
          (labs > 0 && afford ? '' : ' disabled') + '>Synthesise</button>' +
        (afford ? '' : '<span class="pl-vec">Not enough stock.</span>') +
        '</div>';
    }
  }

  /* — the vault, and the shipping seam — */
  const vaultIds = Object.keys(PL.vault).filter((k) => PL.vault[k] > 0);
  h += '<div class="pl-sec">🚚 Lab vault → Medical Corp.</div>';
  if (!vaultIds.length) {
    h += '<div class="pl-vec">Nothing in the vault. Finished batches land here.</div>';
  } else {
    if (clinics <= 0) {
      h += '<div class="pl-warnbox">⚠ You have no Medical Corp. in this city. <b>Doses in the vault cure nobody.</b> ' +
        'The Research Facility makes the cure; only a Medical Corp. can put it into people. Buy one at City Hall.</div>';
    }
    for (const cid of vaultIds) {
      const cure = PLAGUE_CURES[cid];
      h += '<div class="pl-card"><div class="pl-h">' + cure.ico + ' ' + esc(cure.name) +
        '<span class="pl-pct">' + PL.vault[cid] + ' doses held</span></div>' +
        '<button class="pl-btn go" data-ship="' + cid + '"' + (clinics > 0 ? '' : ' disabled') +
        '>Ship all to Medical Corp.</button></div>';
    }
  }
  const clinicIds = Object.keys(PL.clinic).filter((k) => PL.clinic[k] > 0);
  if (clinicIds.length) {
    h += '<div class="pl-sec">🏥 At the Medical Corp. — administering ' +
      (DOSES_PER_CLINIC_MIN * clinics) + ' doses/min</div><div class="pl-row">';
    for (const cid of clinicIds) h += '<span class="pl-tag">' + PLAGUE_CURES[cid].ico + ' ' +
      esc(PLAGUE_CURES[cid].name) + ' × ' + Math.floor(PL.clinic[cid]) + '</span>';
    h += '</div>';
  }

  h += '</div>';
  w.innerHTML = h;

  w.querySelector('#pl-close').onclick = closePanel;
  const cb = w.querySelector('#pl-cancel'); if (cb) cb.onclick = () => cancelResearch();
  w.querySelectorAll('[data-res]').forEach((b) => b.onclick = async () => {
    b.disabled = true;                        // one click, one batch — see charge-on-start
    const r = await startResearch(b.getAttribute('data-res'));
    if (!r.ok) C.toast(r.error === 'shards' ? 'Not enough 🧠 Memory Shards.'
      : r.error === 'stock' ? 'Not enough stock for that batch.'
      : r.error === 'no-lab' ? 'No Research Facility sited.' : 'Could not start that batch.', 'bad');
    renderPanel();
  });
  w.querySelectorAll('[data-ship]').forEach((b) => b.onclick = () => shipDoses(b.getAttribute('data-ship')));
  w.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => toggleQuarantine(b.getAttribute('data-q')));
}

/* ═══ 10. MOUNT ═══════════════════════════════════════════════════════════ */
export function mount(ctx) {
  C = ctx;
  PL = freshState();
  try { badge(); } catch (e) {}
  const api = {
    tick, save, load, outputMul, demandMul, activeList, symptomFor,
    startResearch, cancelResearch, shipDoses, toggleQuarantine, openPanel, closePanel,
    /* 🔬 Diagnostics seam, same stance as node-city's `__nc` and the game's
       `__mg`: this is a module, so without this nothing in here is reachable
       from a console to be stepped or regression-tested. `seed` forces an
       outbreak so the whole loop can be driven without waiting for a vector. */
    _state: () => PL,
    _snapshot: () => snapshot(),
    _seed: (id) => { if (PLAGUE_VIRUSES[id] && !PL.active[id]) { PL.active[id] = { id, inf: PLAGUE_SEED_FRAC, imm: 0, since: +C.game.cityAge || 0, deaths: 0, quarantine: false }; renderPanel(); } },
    _step: (mins) => { tick(mins); renderPanel(); return save(); },
  };
  try { window.MythicPlague = api; } catch (e) {}
  return api;
}
