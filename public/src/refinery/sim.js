/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — crude intake, pre-treatment, and the live refinery run
   ---------------------------------------------------------------------------
   The run is the part of the session that is ACTIVE but not the main puzzle.
   It earns its keep by being a moving target: the column's sweet spot DRIFTS
   as the feed heats through and the heavy ends come over. A player who sets a
   setpoint and walks away gets a mediocre cut — which is exactly why the
   Automation Suite is a convenience and not a win button.

   Severity is the single knob everything hangs off:
       severity = (T/Tideal) · (P/Pideal) · (flow/flowSafe)
   Below 1 you are slow and safe. Above 1 you are fast, and wear plus incident
   probability climb on the SQUARE of the excess so pushing to 1.4 is very
   different from pushing to 1.1. That curve is the whole risk/reward.
   ═════════════════════════════════════════════════════════════════════════ */

import { CRUDES, CRUDE_BY_ID, cutYield, envelope, INCIDENTS, COSTS } from './data.js';
import * as St from './state.js';

/* ⏱ TIME COMPRESSION. Flow is quoted in litres per MINUTE because that is
   what a control panel says, but a player is not going to sit through a
   38-minute column run. One real second of panel time is SIM_SPEED simulated
   minutes' worth of throughput, which puts a full 30,000 L barrel at roughly
   two to four minutes of hands-on work — the shape of session the brief asks
   for. Two consequences that are deliberate, not oversights:
     · THROUGHPUT, power and wages run on SIM time (a run costs what a run of
       that length would cost).
     · WEAR and the INCIDENT ROLL run on REAL time, because those are the
       player's exposure to risk, and risk you can fast-forward past is not
       risk. Holding 1.4 severity for a real minute should hurt whether the
       column is big or small.
   Units: simulated SECONDS per real second. At 17, a 30,000 L barrel at a
   comfortable 600 L/min is ~50 column-minutes and ~3 minutes of panel time. */
export const SIM_SPEED = 17;

/* ── CRUDE INTAKE ─────────────────────────────────────────────────────────
   A shipment carries its TRUE assay plus the variance that makes inspecting
   it worth doing. Two parcels of the same grade are not identical; the grade
   is a promise about the average, not a guarantee about the barrel. */
export function rollShipment(gradeId, marketIndex, capL) {
  const g = CRUDE_BY_ID[gradeId] || CRUDES[1];
  const j = (spread) => (Math.random() * 2 - 1) * spread;
  /* ⚠ SIZE THE PARCEL TO THE YARD, NOT TO A CONSTANT. Shipments used to roll a
     flat 18,000–44,000 L, which meant a starting player — one 30,000 L crude
     tank — was shown a board where most offers, and sometimes ALL of them,
     read "No tank space". A board of things you cannot buy is not a choice.
     Sellers quote against the space you have: the biggest parcel offered is
     the biggest one that fits, and the smallest is a quarter of it so there is
     always something affordable early. */
  const cap = Math.max(8000, capL || 30000);
  const lo = Math.max(4000, cap * 0.26), hi = cap;
  const litres = Math.round((lo + Math.random() * (hi - lo)) / 1000) * 1000;
  const api = +(g.api + j(2.6)).toFixed(1);
  const sulfur = Math.max(0.05, +(g.sulfur * (1 + j(0.30))).toFixed(2));
  const bsw = Math.max(0.1, +(g.bsw * (1 + j(0.42))).toFixed(2));
  /* Contamination is the wildcard the assay stage exists for: a parcel that
     looks like a bargain can carry metals or chlorides that poison the
     catalyst downstream. It is priced in, badly, by the seller — so a player
     with a good lab can spot the ones worth taking. */
  const contam = Math.random() < 0.22 ? +(0.4 + Math.random() * 3.1).toFixed(2) : +(Math.random() * 0.35).toFixed(2);
  // Sellers discount visibly-bad parcels, but not by enough.
  const quality = 1 - (bsw / 100) * 3.1 - (contam / 100) * 2.4;
  const price = Math.round((litres / 1000) * g.price * (marketIndex || 1) * Math.max(0.55, quality) * (1 + j(0.07)));
  return {
    id: 'shp_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e5).toString(36),
    grade: g.id, gradeName: g.name, litres, api, sulfur, bsw, contam, price,
    inspected: false, treated: 0,
  };
}

/* What the player is ALLOWED to see. The lab does not change the shipment, it
   changes the error bars — which is the honest way to make "a better lab" a
   capability instead of a bonus. Tier 4 returns exact numbers and no range. */
export function readAssay(shipment) {
  const t = St.lab();
  const e = t.err;
  if (e <= 0) {
    return { exact: true, tier: t, api: shipment.api, sulfur: shipment.sulfur, bsw: shipment.bsw, contam: shipment.contam };
  }
  // A stable per-shipment offset — re-reading the same parcel must not let a
  // player average the noise away by clicking Inspect repeatedly.
  const seed = hash(shipment.id);
  const off = (n) => ((seed >> (n * 5)) & 31) / 31 * 2 - 1;
  return {
    exact: false, tier: t,
    api:    { lo: +(shipment.api - e * 1.6 + off(1) * e).toFixed(1), hi: +(shipment.api + e * 1.6 + off(1) * e).toFixed(1) },
    sulfur: { lo: Math.max(0, +(shipment.sulfur * (1 - e * 0.20 + off(2) * e * 0.05)).toFixed(2)), hi: +(shipment.sulfur * (1 + e * 0.20 + off(2) * e * 0.05)).toFixed(2) },
    bsw:    { lo: Math.max(0, +(shipment.bsw * (1 - e * 0.24 + off(3) * e * 0.06)).toFixed(2)),    hi: +(shipment.bsw * (1 + e * 0.24 + off(3) * e * 0.06)).toFixed(2) },
    // Contamination is the LAST thing a cheap lab can see. Below tier 2 you
    // get a word, not a number, and the word is sometimes wrong.
    contam: t.t >= 2 ? { lo: Math.max(0, +(shipment.contam - e * 0.4).toFixed(2)), hi: +(shipment.contam + e * 0.4).toFixed(2) }
                     : (shipment.contam > 1.6 ? 'ELEVATED' : shipment.contam > 0.5 ? 'TRACE' : 'CLEAN'),
  };
}
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function buyShipment(shipment) {
  const s = St.S();
  if (St.crudeHeld(s) + shipment.litres > St.crudeCap(s)) {
    St.toast('🛢 No tank space — you can hold ' + St.crudeCap(s).toLocaleString() + ' L of crude. Buy a Crude Tank.', 4200);
    return false;
  }
  if (!St.spend(shipment.price, 'Refinery: crude')) {
    St.toast('Not enough Cinder for that shipment.', 3000); return false;
  }
  St.charge('crude', shipment.price);
  s.crude.push(shipment);
  St.log('info', 'Received ' + shipment.litres.toLocaleString() + ' L ' + shipment.gradeName + ' for ' + shipment.price.toLocaleString() + ' 🔥.');
  St.save();
  return true;
}

/* ── PRE-TREATMENT ────────────────────────────────────────────────────────
   The desalter is a genuine trade, not a chore. Each pass:
     · removes ~55% of the remaining water/sediment
     · removes ~30% of the remaining contamination
     · costs Cinder and power
     · destroys ~0.4% of the volume, every time
   So over-treating a clean parcel burns money and litres for nothing, and
   under-treating a filthy one fouls the column and caps the purity of every
   product that comes off it. There is no "always press this" answer. */
export function pretreatCost(shipment) {
  return Math.round(COSTS.desalterPerPass * (shipment.litres / 20000) * (1 + shipment.treated * 0.35));
}
export function pretreat(shipment) {
  const cost = pretreatCost(shipment);
  if (!St.spend(cost, 'Refinery: desalting')) { St.toast('Desalting needs ' + cost.toLocaleString() + ' 🔥.', 3000); return false; }
  St.charge('power', Math.round(cost * 0.4));
  St.charge('maintenance', Math.round(cost * 0.6));
  shipment.bsw = +(shipment.bsw * 0.45).toFixed(3);
  shipment.contam = +(shipment.contam * 0.70).toFixed(3);
  shipment.litres = Math.round(shipment.litres * 0.996);
  shipment.treated = (shipment.treated | 0) + 1;
  St.log('info', 'Desalter pass ' + shipment.treated + ' on ' + shipment.gradeName + ' — BS&W now ' + shipment.bsw + '%.');
  St.save();
  return true;
}

/* ── THE RUN ══════════════════════════════════════════════════════════════
   A run is a live object owned by the UI, ticked on a timer. It is NOT put on
   the save: an interrupted run is abandoned, which is the correct outcome for
   a column somebody walked away from, and it keeps the save free of a state
   that only makes sense while the panel is open. */
export function startRun(shipment) {
  const s = St.S();
  const env = envelope(shipment.api, s.equip);
  return {
    shipment,
    env,
    t: 0,                      // real seconds elapsed
    simSec: 0,                 // simulated seconds of column time
    processed: 0,              // litres through the column
    temp: env.tempIdeal,       // player-controlled
    pres: env.presIdeal,
    flow: Math.round(env.flowSafe * 0.7),
    /* DRIFT is what makes this active work. The ideal point walks as the feed
       heats through and the barrel's own composition changes across the run —
       light ends first, heavy ends last. The player is tracking a target, not
       holding a number. Automation follows the setpoint but NOT the drift. */
    driftT: 0, driftP: 0, driftPhase: Math.random() * Math.PI * 2,
    quality: 1,                // rolling cut quality 0..1, feeds purity
    qualitySamples: 0,        // litres weighted into `quality` so far
    wearAccum: 0,
    kwh: 0,
    incidents: [],
    lost: 0,
    auto: false,
    done: false,
    aborted: false,
  };
}

export function idealTemp(run) { return run.env.tempIdeal + run.driftT; }
export function idealPres(run) { return run.env.presIdeal + run.driftP; }

export function severity(run) {
  const tRatio = run.temp / Math.max(1, run.env.tempIdeal);
  const pRatio = run.pres / Math.max(0.1, run.env.presIdeal);
  const fRatio = run.flow / Math.max(1, run.env.flowSafe);
  return tRatio * pRatio * fRatio;
}

/* Safety index 0–100, the number on the panel. Condition matters as much as
   how hard you are pushing — a worn yard is unsafe at settings a new one
   shrugs off, which is what makes maintenance a decision rather than a habit. */
export function safetyIndex(run) {
  const sev = severity(run);
  const over = Math.max(0, sev - 1);
  const cond = St.worstCondition() / 100;
  return Math.max(0, Math.min(100, Math.round(100 * cond * Math.exp(-over * 2.3) - (run.incidents.length * 4))));
}

export function powerDraw(run) {
  // kW. Flow dominates; temperature and pressure add a superlinear tail so
  // "run it hot" shows up on the electricity bill before it shows up as fire.
  const base = run.flow * 2.4;
  const heat = Math.pow(Math.max(0, run.temp - 300) / 100, 1.8) * 620;
  const comp = Math.pow(Math.max(0, run.pres) / 2, 1.5) * 240;
  return Math.round(base + heat + comp);
}

/* One tick. dt is REAL seconds; the caller decides the pace. */
export function tick(run, dt) {
  if (run.done || run.aborted) return run;
  const s = St.S();
  run.t += dt;

  // ── Throughput first: the drift below is a function of how far through the
  //    barrel we are, so `processed` has to be current before it is read.
  const simSec = dt * SIM_SPEED;                  // real s → simulated column seconds
  run.simSec = (run.simSec || 0) + simSec;
  const moved = Math.min(run.flow * (simSec / 60), run.shipment.litres - run.processed);
  run.processed += moved;
  const kw = powerDraw(run);
  run.kwh += kw * simSec / 3600;

  /* ── Drift. Two sinusoids at incommensurate periods so it never reads as a
     pattern to memorise, plus a one-way ramp for the heavy ends arriving late
     in the barrel.
     ⚠ DRIFT IS DRIVEN BY BARREL PROGRESS, NOT BY THE WALL CLOCK. It used to
     advance on dt, which quietly inverted the whole risk curve: a player who
     ran flat out spent less TIME in front of the column, so a barrel they
     never touched came out with BETTER cut quality than one run slowly. Tying
     the phase to how much feed has gone through means every barrel walks the
     same drift path — running fast just gives you less time to chase it,
     which is the pressure this stage is supposed to apply. */
  const prog = run.processed / Math.max(1, run.shipment.litres);
  run.driftPhase = prog * 21.5;
  run.driftT = Math.sin(run.driftPhase) * 7.5 + Math.sin(run.driftPhase * 0.41) * 4.5 + prog * 9.0;
  run.driftP = Math.sin(run.driftPhase * 0.73 + 1.1) * 0.19 + prog * 0.14;

  // ── Automation holds the SETPOINT, not the target. It is genuinely useful
  //    for a low-value batch and genuinely inferior for a high-value one.
  if (run.auto && (s.equip.automation | 0) > 0) {
    const skill = Math.min(0.72, 0.30 + (s.equip.automation | 0) * 0.14);
    run.temp += (idealTemp(run) - run.temp) * skill * dt * 0.55;
    run.pres += (idealPres(run) - run.pres) * skill * dt * 0.55;
  }

  // ── Cut quality. Distance from the moving ideal, in band-widths.
  const tErr = Math.abs(run.temp - idealTemp(run)) / run.env.tempBand;
  const pErr = Math.abs(run.pres - idealPres(run)) / run.env.presBand;
  const err = Math.sqrt(tErr * tErr + pErr * pErr);
  //  err 0 → 1.00 · err 1 → 0.88 · err 2 → 0.63 · err 4 → 0.20
  const instant = Math.exp(-0.13 * err * err);
  /* ⚠ WEIGHTED BY LITRES THROUGH THE COLUMN, NOT BY SECONDS ON THE CLOCK.
     Cut quality is a property of the FEED — it is how well separated the stuff
     that actually came over was. Averaging on wall time made a slow run score
     worse than a fast one at the same (wrong) setpoint, purely because it sat
     there longer, which handed a non-steering player a reason to run hot. On
     litres, the score answers only the question it should: how well did you
     track the column while this barrel went through it? */
  const qw = Math.max(1e-6, moved);
  run.quality = (run.quality * run.qualitySamples + instant * qw) / (run.qualitySamples + qw);
  run.qualitySamples += qw;


  // ── Wear. Square of the excess severity, scaled by flow, so the punishment
  //    for 1.5× is not 1.5× the punishment for 1.0× — it is roughly five.
  const sev = severity(run);
  const over = Math.max(0, sev - 1);
  const w = (0.010 + over * over * 0.62) * dt;
  run.wearAccum += w;
  St.wear('cdu', w);
  St.wear('pumps', w * 0.7);

  // ── Incidents. Base rate is near zero inside the envelope; it climbs with
  //    severity AND with how worn the yard already is. Dirty feed (BS&W left
  //    in by a skipped desalter pass) is its own multiplier, which is the
  //    delayed consequence that makes pre-treatment matter.
  const cond = St.worstCondition() / 100;
  const dirt = 1 + run.shipment.bsw * 0.42 + run.shipment.contam * 0.30;
  const rate = (0.0007 + over * over * 0.040) * (2 - cond) * Math.min(1.9, dirt);
  if (Math.random() < rate * dt) fireIncident(run, over, sev);

  if (run.processed >= run.shipment.litres - 0.5) run.done = true;
  return run;
}

function fireIncident(run, over, sev) {
  /* Which incident you get is weighted by how hard you were pushing. A Unit
     Fire is genuinely rare and genuinely only reachable by someone who chose
     to run past 1.35 severity — the player is never blindsided by one. */
  let pool = INCIDENTS.filter(i => i.sev <= 1);
  if (over > 0.12) pool = INCIDENTS.filter(i => i.sev <= 2);
  if (over > 0.30) pool = INCIDENTS.filter(i => i.sev <= 3);
  if (over > 0.55) pool = INCIDENTS.slice();
  const inc = pool[Math.floor(Math.random() * pool.length)] || INCIDENTS[0];
  run.incidents.push({ ...inc, at: run.t });

  const s = St.S();
  const repair = Math.round((320 + Math.random() * 500) * inc.sev * (1 + sev * 0.4));
  St.spend(repair, 'Refinery: incident');
  St.charge('maintenance', repair);
  St.wear('cdu', inc.sev * 5.5);
  St.nudgeRep('safety', -inc.sev * 2.4);

  if (inc.id === 'seal' || inc.id === 'spill') {
    /* ⚠ LOSS IS A FRACTION OF WHAT IS LEFT, NOT A MULTIPLE OF THE FLOW RATE.
       This used to be `flow * (6 + sev*5)` — flow is quoted per MINUTE, so at
       a high throughput a single Containment Spill deleted 35,000 L of a
       53,000 L barrel. One bad roll wiped a whole session's feed, which is not
       a risk/reward curve, it is a coin flip. A leak now costs a proportional
       slice of the remaining barrel, weighted by how hard the yard was being
       pushed when it let go: painful, legible, survivable. */
    const remaining = Math.max(0, run.shipment.litres - run.processed);
    const frac = (0.015 + inc.sev * 0.018) * (0.7 + Math.min(2.2, sev) * 0.5);
    const lost = Math.round(remaining * Math.min(0.30, frac));
    run.lost += lost;
    run.processed = Math.min(run.shipment.litres, run.processed + lost);
  }
  if (inc.id === 'trip') {
    run.flow = Math.max(run.env.flowMin, run.flow * 0.35);
    /* The panel has to SHOW the trip. Without this the slider still reads the
       old setpoint while the column coasts at a third of it, and the player
       spends the rest of the run wondering why nothing is moving. */
    run.flowChanged = true;
  }
  if (inc.id === 'foul') { run.quality *= 0.82; }
  if (inc.id === 'fire') {
    run.aborted = true;
    St.charge('scrapped', Math.round(run.shipment.price * (1 - run.processed / Math.max(1, run.shipment.litres))));
    St.nudgeRep('safety', -9);
  }
  St.log(inc.sev >= 3 ? 'bad' : 'warn', inc.ico + ' ' + inc.name + ' — ' + inc.msg + ' Repairs ' + repair.toLocaleString() + ' 🔥.');
  St.toast(inc.ico + ' ' + inc.name + ' — ' + inc.msg, 4600);
  return inc;
}

/* ── SETTLE ═══════════════════════════════════════════════════════════════
   Turns a finished run into stream litres in the tanks. Cut quality lands on
   BOTH the split (a bad run smears the cuts into each other, so you get less
   of what you wanted) and on purity, which is carried into the blend as a
   per-stream contamination penalty the blender then has to live with. */
export function settleRun(run) {
  const s = St.S();
  const sh = run.shipment;
  const usable = Math.max(0, run.processed - run.lost);
  const q = Math.max(0.05, Math.min(1, run.quality));

  const base = cutYield(sh.api);
  /* Off-spec running smears the cuts. We move the difference into gas oil and
     heavy — the two streams nobody wants — because that is physically where a
     badly separated column dumps everything it failed to lift. */
  const smear = (1 - q) * 0.55;
  const out = {
    naphtha: usable * base.naphtha * (1 - smear),
    kero:    usable * base.kero    * (1 - smear),
    diesel:  usable * base.diesel  * (1 - smear * 0.7),
    gasoil:  usable * base.gasoil  + usable * (base.naphtha + base.kero) * smear * 0.5,
    heavy:   usable * base.heavy   + usable * (base.diesel * 0.7 + base.gasoil * 0) * smear,
  };

  // Power + wages for the run land on the statement now, in one line each.
  const powerCost = Math.round(run.kwh * COSTS.powerPerKwh);
  const labourCost = Math.round(((run.simSec || 0) / 60) * COSTS.labourPerMin);
  St.spend(powerCost + labourCost, 'Refinery: run costs');
  St.charge('power', powerCost);
  St.charge('labour', labourCost);

  if (run.aborted) {
    St.log('bad', '🔥 Run aborted. ' + Math.round(usable).toLocaleString() + ' L of feed lost with the batch.');
    St.save();
    return { aborted: true, out: {}, powerCost, labourCost, q };
  }

  for (const k in out) if (out[k] > 0.5) St.addStock(k, Math.round(out[k]));

  /* Sulfur and dirt carried by this parcel become a PROPERTY of the streams,
     not a number on the shipment that quietly disappears. We keep a running
     volume-weighted average per stream so the blend panel can tell the player
     the truth about stock they refined last week from a sour barrel. */
  const dirtPenalty = sh.bsw * 0.55 + sh.contam * 0.9 + (1 - q) * 3.2;
  noteStreamQuality(s, 'naphtha', out.naphtha, sh.sulfur, dirtPenalty);
  noteStreamQuality(s, 'diesel',  out.diesel,  sh.sulfur * 1.35, dirtPenalty);
  noteStreamQuality(s, 'kero',    out.kero,    sh.sulfur * 0.72, dirtPenalty);

  // Remove the shipment from the yard.
  const i = s.crude.findIndex(c => c.id === sh.id);
  if (i >= 0) s.crude.splice(i, 1);

  St.log('good', 'Run complete — ' + Math.round(usable).toLocaleString() + ' L processed at ' + Math.round(q * 100) + '% cut quality.');
  St.save();
  return { aborted: false, out, powerCost, labourCost, q };
}

/* Volume-weighted running average of a stream's sulfur (wt%) and dirt (pts).
   Stored on the save because it has to survive between sessions — otherwise a
   player could launder a sour barrel by logging out. */
function noteStreamQuality(s, id, litres, sulfurPct, dirt) {
  if (!(litres > 0)) return;
  if (!s.streamQ || typeof s.streamQ !== 'object') s.streamQ = {};
  const have = Math.max(0, (s.stock[id] || 0) - litres);
  const prev = s.streamQ[id] || { sulfur: sulfurPct, dirt: dirt };
  const tot = have + litres;
  s.streamQ[id] = {
    sulfur: (prev.sulfur * have + sulfurPct * litres) / Math.max(1, tot),
    dirt:   (prev.dirt   * have + dirt      * litres) / Math.max(1, tot),
  };
}
export function streamQuality(id) {
  const s = St.S();
  return (s.streamQ && s.streamQ[id]) || { sulfur: 0.5, dirt: 0 };
}
