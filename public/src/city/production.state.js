/* ════════════════════════════════════════════════════════════════════════════
   🏭 PRODUCTION STATE — placement, accrual, and the four halt conditions.
   ----------------------------------------------------------------------------
   Spec: CLAUDE_TASK_buildings.md §4. Every legacy binding arrives via the host
   (window.MythicCityBridge) — see the globals-trap note in cost.js.
   ════════════════════════════════════════════════════════════════════════════ */

import { CITY_PRODUCTION, cityProdDef, CITY_PREREQ, missingPrereqs } from './production.data.js';
import { buildingCostAt, canAfford, spendCost } from './cost.js';
import { yieldMul as terroirYieldMul, stackMul as terroirStackMul, chainCeiling } from './terroir.js';

/* 🗺 TERROIR — WHICH PLANT IS THIS, OF THE ONES YOU HAVE MAKING `resId`?
   1-based, in PLACEMENT order, so the ranking is stable and a player can never
   lose ground by placing a new building (the newest is always the one that
   takes the worst saturation slot). Order comes from s.placed, which is
   append-only in build() — 🔴 nothing here removes, reorders or rewrites a
   placed row. This project deleted paid-for buildings four rounds running; this
   function only READS the array. */
function chainRank(host, p, resId) {
  try {
    const rows = placed(host);
    let n = 0;
    for (const r of rows) {
      const d = cityProdDef(r && r.defId);
      if (!d || !d.yields || !(resId in d.yields)) continue;
      n++;
      if (r === p || (r && p && r.id === p.id)) return n;
    }
    return Math.max(1, n);
  } catch (e) { return 1; }
}

/* The combined terroir factor for one resource out of one building.
   Exported so the panel can show the same number the payout uses — a figure the
   UI recomputes its own way is a figure that eventually lies. */
export function terroirFactor(host, p, resId) {
  const f = terroirYieldMul(resId) * terroirStackMul(resId, chainRank(host, p, resId));
  return (typeof f === 'number' && isFinite(f) && f >= 0) ? f : 1;
}

/* 📈 The ceiling this city's ground puts on a whole chain, as a multiple of one
   base building — the number the design rests on, readable from the UI. */
export function chainCeilingFor(resId) { return chainCeiling(resId); }

/* ════════════════════════════════════════════════════════════════════════════
   🔴 TERROIR SCALES THE WHOLE CYCLE — OUTPUT *AND* INPUTS. THE ONE NUMBER.
   ----------------------------------------------------------------------------
   THE DEFECT THIS EXISTS FOR, MEASURED END-TO-END THROUGH collect() ITSELF, not
   modelled: `pending()` multiplied the yield by the terroir factor and
   `collect()` charged the inputs FLAT. So one cycle's value ratio was

       ratio(player) = ratio(catalogue) × tf

   and `tf` reaches RICH.yieldMul × SEAM_BONUS_MUL = 1.60 × 3 = 4.80 on the
   node's own seam. Driven on the shipped payout path, 36 h / 6 cycles, ledger
   deltas priced at index.html's RESOURCE_CINDER_VALUE:

       chain_aluminumOre @seam   240🔥 of fuel in → 1,152🔥 of ore out   4.800×
       wellhead          @seam    90🔥 in         → 3,456🔥 out         38.400×
       ALL 56 chain producers and ALL 14 legacy producers Cinder-positive.

   The Refinery sells any ledger id for Cinder through addCinders → addGems →
   Profile.gems, so that was REAL currency created by standing on good ground,
   for free, forever. Repricing could not fix it: the amplification is a
   MULTIPLIER on whatever the price is, it hits the legacy shelf hardest (the
   shelf a price change here cannot reach), and pricing against 4.80 puts a
   tier-0 good at 0.208🔥 — which `addGems()`'s `Math.floor` pays as literally 0
   for every ordinary-ground sale under 5 units. So the fix is here: charge the
   cycle's inputs by the same factor its output was scaled by.

   ⚠ WHAT TERROIR STILL MEANS, because this deliberately does NOT nerf it. Rich
   ground still gives 4.8× the THROUGHPUT per cycle, per crew slot, per tile and
   per 6 h — "a fuel node IS a fuel city" is intact. What it stops doing is
   manufacturing VALUE out of nothing: a cycle now converts inputs into output at
   the catalogue's own ratio on every ground, and the payoff for good ground is
   volume, which is what the design says it is.

   🔴 ONE NUMBER, THREE CALL SITES, COMPUTED ONCE. haltState() checks one cycle,
   pending()'s inputCap loop decides how many cycles it can PROMISE, and
   collect() CHARGES. If any two of those disagree the panel promises cycles the
   spend path then refuses — verbatim the "banked 🥫 270 (6 cycles) → Not enough
   Water" bug documented at the inputCap loop below. So all three go through
   these two functions and nothing multiplies by `tf` by hand.

   ⚠ MAX over the yields, not the first one. Every building in CITY_PRODUCTION is
   single-output today, so max === the only value; the loop is written for the
   general case, and MAX is the conservative side — charging by the largest
   factor can only make the cycle's ratio ≤ the catalogue's, never more. */
export function inputTerroirScale(host, p, def) {
  try {
    const ys = (def && def.yields) ? Object.keys(def.yields) : [];
    let m = 0;
    for (const k of ys) m = Math.max(m, terroirFactor(host, p, k));
    return (typeof m === 'number' && isFinite(m) && m > 0) ? m : 1;
  } catch (e) { return 1; }
}

/* The charge for `cycles` cycles of one input leg, at `perCycle` already scaled
   by level. Rounds UP so a fractional charge can never be farmed to zero.
   ⚠ THE ε IS NOT DECORATION. tf 1.6 is 1.6000000000000000888 in IEEE 754, so
     10 × 6 × 1.6 evaluates to 96.00000000000001 and a bare Math.ceil would take
     97 — one unit of silent over-charge per collect, on the commonest ground in
     the game. Snap to the integer when we are within 1e-9 of one. */
export function inputCharge(perCycle, cycles, tf) {
  const n = (perCycle || 0) * (cycles || 0) * (typeof tf === 'number' && isFinite(tf) && tf > 0 ? tf : 1);
  if (!(n > 0)) return 0;
  const r = Math.round(n);
  return (Math.abs(n - r) < 1e-9) ? r : Math.ceil(n);
}

/* ⏱ THE IDLE CONTRACT IS NOT REDECLARED HERE.
   6h collection / 36h offline cap are the game's EXISTING policy
   (OP_COLLECT_CD_MS, OP_ACCRUAL_CAP_H) and arrive through the bridge, exactly
   as MythicHouseBridge passes them to the Bunkhouse. Copying the numbers into
   this file would give the project a THIRD idle policy that silently drifts
   from the other two the first time anyone retunes. The fallbacks below exist
   only so the module degrades rather than dividing by undefined if the bridge
   is ever mounted incomplete — they are not an authority. */
function collectCdMs(host) { return (host && host.collectCdMs) || 6 * 3600000; }
function accrualCapH(host) { return (host && host.accrualCapH) || 36; }

/* ── Persistence ────────────────────────────────────────────────────────────
   🔴 ABSENT-TOLERANT ON LOAD. This project has shipped silent save bugs three
   times, so every field is defaulted and no shape is assumed. A save written
   before this feature existed must load as "no buildings", never as a throw. */
export function ensureState(host) {
  let s = null;
  try { s = host.state(); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') s = {};
  if (!Array.isArray(s.placed)) s.placed = [];
  // Drop rows whose building no longer exists in the catalog rather than
  // rendering an undefined tile. A removed building must not brick the city.
  s.placed = s.placed.filter(p => p && typeof p === 'object' && cityProdDef(p.defId));
  s.placed.forEach(p => {
    if (typeof p.level !== 'number' || !(p.level > 0)) p.level = 1;
    if (typeof p.lastCollect !== 'number' || !isFinite(p.lastCollect)) p.lastCollect = Date.now();
    if (typeof p.buffer !== 'object' || !p.buffer) p.buffer = {};
    if (typeof p.workers !== 'number') p.workers = 0;
    // 📐 PLACEMENT REUSES THE shop_objects SHAPE — x, y, z, rotation_y, scale.
    // Not a second placement system (§4.1): the walkable shop, the city props
    // and this all describe "a thing standing somewhere" the same way, so one
    // editor and one persistence path can serve all three later.
    if (typeof p.x !== 'number') p.x = 0;
    if (typeof p.y !== 'number') p.y = 0;
    if (typeof p.z !== 'number') p.z = 0;
    if (typeof p.rotation_y !== 'number') p.rotation_y = 0;
    if (typeof p.scale !== 'number' || !(p.scale > 0)) p.scale = 1;
  });
  try { host.setState(s); } catch (e) {}
  return s;
}

export function placed(host) { return ensureState(host).placed; }

/* ── City-wide capacity ────────────────────────────────────────────────────
   Utilities produce the three budgets every producer draws on. */
export function cityBudget(host) {
  const rows = placed(host);
  let power = 0, workers = 0, storage = 0, population = 0;
  let powerDraw = 0, workerDraw = 0, waterDraw = 0, pollution = 0;
  for (const p of rows) {
    const def = cityProdDef(p.defId); if (!def) continue;
    if (typeof def.effect === 'function') {
      const e = def.effect(p.level) || {};
      power += e.power | 0; workers += e.workers | 0;
      storage += e.storage | 0; population += e.population | 0;
    }
    const d = def.draw || {};
    powerDraw += (d.power | 0) * p.level;
    /* 👷 CREW SCALES WITH LEVEL, like power and water. It did not, and that
       asymmetry was not a design call: a level-3 Foundry drew 105⚡ and 8
       workers, i.e. it tripled its power bill while staffing itself for free.
       ⚠ This is a real balance change — every level-2+ building now needs
       level × its listed crew, so a city that was exactly staffed can fall into
       the (correctly reported) NO CREW halt. Reported to the coordinator. */
    workerDraw += (d.workers | 0) * p.level;
    waterDraw += (d.water | 0) * p.level;
    pollution += (d.pollution | 0) * p.level;
  }
  // 👷 The camp's own labour pool counts too — a city is not staffed from
  // nowhere. Absent bridge accessor → 0, and the halt below explains it.
  let pool = 0;
  try { pool = host.workerPool ? (host.workerPool() | 0) : 0; } catch (e) { pool = 0; }
  return {
    power, powerDraw, powerFree: power - powerDraw,
    workers: workers + pool, workerDraw, workersFree: (workers + pool) - workerDraw,
    storage, population, waterDraw, pollution,
  };
}

/* ── Storage ───────────────────────────────────────────────────────────────
   🔴 THE CAP REPORTED HERE IS THE LEDGER'S OWN CAP, NOT A LOCAL BELIEF.

   This used to return `host.resourceCap() + cityBudget(host).storage` — the
   module added the Warehouse's storage effect to a number the ledger had never
   heard of. `pending()` then clipped against that inflated figure while
   `addRes()` still clamped to the REAL cap, so a collect promised 810 food and
   banked 540: 270 units destroyed, `clipped:false`, and the 36h timer reset.
   Measured, not theorised.

   The fix is on the other side of the bridge: index.html's `getResourceCap()`
   now adds `_cityProdStorage()` (→ `storageBonus()` → `cityBudget().storage`),
   so a placed Warehouse raises the cap that actually banks the payout. Adding
   it again here would double-count it and re-open the same hole in reverse.
   ⚠ If you ever need the raw bonus, use cityBudget(host).storage — do NOT add
   it to host.resourceCap(). */
export function storageState(host) {
  let cap = 0, used = 0;
  try { cap = host.resourceCap() | 0; } catch (e) { cap = 0; }
  try { used = host.resourceUnits() | 0; } catch (e) { used = 0; }
  return { cap, used, free: Math.max(0, cap - used) };
}

/* ════════════════════════════════════════════════════════════════════════════
   🛑 HALT CONDITIONS — §4.4, and each one gets a DISTINCT, VISIBLE reason.
   An invisible halt reads as a bug, and this project has shipped that mistake
   before (see the `intel` cost in index.html: a real blocker with no rendered
   explanation, which presented as "the button is broken"). Every return here
   carries a `reason` string the UI is required to print, plus a `fix` naming
   the concrete thing the player should go and do.
   ════════════════════════════════════════════════════════════════════════════ */
export const HALT = {
  NONE: 'running',
  NO_INPUTS: 'no_inputs',
  STORAGE_FULL: 'storage_full',
  NO_POWER: 'no_power',
  NO_STAFF: 'no_staff',
  BROWNOUT: 'brownout',
};

export function haltState(host, p) {
  const def = cityProdDef(p && p.defId);
  if (!def) return { code: HALT.NONE, running: false, reason: 'Unknown building.', fix: '' };

  const budget = cityBudget(host);
  const store = storageState(host);
  const lvl = p.level | 0 || 1;

  // 1️⃣ NO STAFF — checked first because an unstaffed building consumes nothing
  //    and should not be reported as short of inputs it never asked for.
  // Level-scaled, to match cityBudget's workerDraw. The two must agree or the
  // halt names a number the budget never charged.
  const needCrew = ((def.draw && def.draw.workers | 0) || 0) * lvl;
  if (needCrew > 0 && budget.workersFree < 0) {
    return {
      code: HALT.NO_STAFF, running: false,
      reason: `⛔ NO CREW — ${def.name} needs ${needCrew} workers and the city is ${Math.abs(budget.workersFree)} short.`,
      fix: 'Build Tenements (+25 workers each) or take crew off another building.',
    };
  }

  // 2️⃣ NO POWER / BROWNOUT. A total blackout halts; a partial deficit throttles
  //    to 40% rather than stopping, so a growing city degrades instead of
  //    falling off a cliff (§4.4: "unpowered (or runs at 40%)").
  const needPower = ((def.draw && def.draw.power | 0) || 0) * lvl;
  if (needPower > 0) {
    if (budget.power <= 0) {
      return {
        code: HALT.NO_POWER, running: false,
        reason: `⛔ NO POWER — ${def.name} draws ${needPower}⚡ and the city grid is dead.`,
        fix: 'Build a Power Plant (+250⚡, radius 4).',
      };
    }
    if (budget.powerFree < 0) {
      return {
        code: HALT.BROWNOUT, running: true, throttle: 0.4,
        reason: `⚠ BROWNOUT — the grid is ${Math.abs(budget.powerFree)}⚡ over capacity. ${def.name} is running at 40%.`,
        fix: 'Build or upgrade a Power Plant to clear the deficit.',
      };
    }
  }

  // 3️⃣ STORAGE FULL — the halt the Warehouse exists to prevent.
  if (store.free <= 0) {
    return {
      code: HALT.STORAGE_FULL, running: false,
      reason: `⛔ STORAGE FULL — the stash holds ${store.cap.toLocaleString()} units and every one is used. ${def.name} has nowhere to put its output.`,
      fix: 'Build a Warehouse (+2,000 storage), spend resources, or bank them in the Ops Vault.',
    };
  }

  // 4️⃣ NO INPUTS — named to the exact resource, because "missing inputs" on a
  //    building with three of them tells the player nothing actionable.
  const inputs = def.inputs || {};
  /* 🗺 …AT THE SAME TERROIR FACTOR THE PAYOUT USES. This check is what tells the
     player the cycle is short, so it has to name the number collect() will
     actually take — see the inputTerroirScale block. It said `× lvl` flat while
     the charge scaled by tf, which on rich ground reported "you have enough"
     for a cycle the spend path refuses. */
  const tfIn = inputTerroirScale(host, p, def);
  /* ⚠ AND IT SAYS WHY THE NUMBER IS NOT THE ONE ON THE CARD. The blueprint card
     prints the CATALOGUE per-cycle figures for both legs (production.render.js's
     ioLine is terroir-blind on purpose — it describes the building, not this
     ground), so a bare scaled figure here would look like a typo. Naming the
     factor turns a contradiction into the explanation of the buff. */
  const terrNote = (Math.abs(tfIn - 1) > 1e-9)
    ? ` 🗺 This ground runs it at ×${tfIn.toFixed(2)} — it eats ×${tfIn.toFixed(2)} the listed inputs and makes ×${tfIn.toFixed(2)} the listed output.`
    : '';
  for (const k in inputs) {
    const need = inputCharge((inputs[k] | 0) * lvl, 1, tfIn);
    const got = host.getRes(k) | 0;
    if (got < need) {
      return {
        code: HALT.NO_INPUTS, running: false,
        reason: `⛔ NO ${String(host.resName(k)).toUpperCase()} — ${def.name} burns ${need} ${host.resName(k)} per cycle and you have ${got}.${terrNote}`,
        fix: `Produce or loot ${need - got} more ${host.resName(k)}.`,
      };
    }
  }

  return { code: HALT.NONE, running: true, throttle: 1, reason: `◉ RUNNING — ${def.name} is producing.`, fix: '' };
}

/* ── Accrual ───────────────────────────────────────────────────────────────
   Deterministic time-accrual on the EXISTING 6h/36h contract. Whole cycles
   only: a building pays per completed cycle, so a player cannot farm by
   collecting every few seconds. */
export function pending(host, p) {
  const def = cityProdDef(p && p.defId);
  if (!def || !def.yields) return { cycles: 0, gain: {}, halt: null, cappedByTime: false };

  const cd = collectCdMs(host);
  const capMs = accrualCapH(host) * 3600000;
  const elapsedRaw = Math.max(0, Date.now() - (p.lastCollect || Date.now()));
  const elapsed = Math.min(elapsedRaw, capMs);
  let cycles = Math.floor(elapsed / cd);

  const halt = haltState(host, p);
  if (!halt.running || cycles <= 0) {
    return { cycles: 0, gain: {}, halt, cappedByTime: elapsedRaw > capMs, accruedMs: elapsed, elapsedMs: elapsedRaw, nextMs: cd - (elapsedRaw % cd) };
  }

  const lvl = p.level | 0 || 1;

  /* 🗺 THE TERROIR FACTORS, COMPUTED ONCE AND USED BY BOTH HALVES OF THE CYCLE.
     Hoisted above the affordability loop on purpose: the promise below and the
     yield below THAT must be scaled by the same numbers, and `collect()` charges
     off `tf` from this very return. Recomputing it anywhere else is how the
     promise and the charge drift apart. */
  const terr = {};
  for (const k in def.yields) terr[k] = terroirFactor(host, p, k);
  const tfIn = inputTerroirScale(host, p, def);

  /* 🔴 ONLY PROMISE CYCLES THE INPUTS CAN ACTUALLY FUND.
     haltState() checks ONE cycle of inputs; collect() charges inputs × level ×
     cycles. Measured consequence: the panel rendered "banked 🥫 270 (6 cycles)"
     with the Collect button enabled and clicking it returned "Not enough Water
     — need 180, have 40." Nothing was destroyed, but the UI advertised a payout
     the spend path refuses, which reads as a broken button.
     Clamping here (rather than halting on inputs × cycles) is the kinder half
     of the fix: a player with one cycle's water still gets that one cycle, and
     `inputLimited` lets the panel say why the other five are waiting. */
  /* 🗺 …AND IT COSTS `tf` TIMES AS MUCH, because the output is worth `tf` times
     as much. THIS LOOP IS HALF OF THE FIX, NOT AN AFTERTHOUGHT: if collect()
     charges by tf and this does not, `pending()` promises 6 cycles on rich
     ground and the spend path refuses them — the exact bug the paragraph above
     documents, re-created by the fix meant to be safe. Affordability is
     inverted through the SAME inputCharge() the spend uses, then verified
     against it, so a float edge can never leave the promise one unit over. */
  let inputLimited = false, inputCap = Infinity;
  const inputsFor1 = def.inputs || {};
  for (const k in inputsFor1) {
    const per = (inputsFor1[k] | 0) * lvl;
    if (per <= 0) continue;
    const have = host.getRes(k) | 0;
    let affordable = Math.max(0, Math.floor(have / (per * tfIn)));
    while (affordable > 0 && inputCharge(per, affordable, tfIn) > have) affordable--;
    if (affordable < inputCap) inputCap = affordable;
  }
  if (isFinite(inputCap) && inputCap < cycles) { cycles = Math.max(0, inputCap); inputLimited = true; }
  if (cycles <= 0) {
    return { cycles: 0, gain: {}, halt, inputLimited, tf: tfIn, terroir: terr, cappedByTime: elapsedRaw > capMs, accruedMs: elapsed, elapsedMs: elapsedRaw, nextMs: cd - (elapsedRaw % cd) };
  }
  const throttle = (typeof halt.throttle === 'number') ? halt.throttle : 1;
  /* 🏙 VITALS MULTIPLIER — HOOK ONLY, NOT IMPLEMENTED (§4.5).
     `cityOutputMultipliers()` DOES NOT EXIST in this codebase — I grepped the
     whole of index.html and every /src module and there is no definition and no
     caller. §4.5 says: apply it if it exists, otherwise leave a clearly marked
     hook and do not implement it here. This is that hook. When somebody adds
     the real function, expose it on the bridge as `outputMultipliers()` and it
     will be picked up here with no other change. */
  let vitals = 1;
  try { if (typeof host.outputMultipliers === 'function') vitals = Number(host.outputMultipliers(def.id)) || 1; } catch (e) { vitals = 1; }

  /* 🗺 TERROIR — the ground decides how much of THIS resource this city can
     make, and the saturation term is why a shortfall cannot be out-built.
     Applied here (not in the renderer) so the promise and the payout come from
     one expression; `pending()` is the only thing `collect()` trusts. */
  const gain = {};
  for (const k in def.yields) {
    const n = Math.floor((def.yields[k] | 0) * lvl * cycles * throttle * vitals * terr[k]);
    if (n > 0) gain[k] = n;
  }
  /* 🔴 BARREN GROUND MUST NOT CHARGE INPUTS FOR A ZERO PAYOUT.
     On the worst ground a single cycle can floor to 0 units (45 food × 0.015 =
     0.675 → 0), and collect() charges inputs × cycles BEFORE it banks anything —
     so without this the player would pay 30 water for nothing and have their
     accrual clock reset on top. That is the same shape as the 270-units-
     destroyed bug in this file's history, pointed the other way.
     Reporting cycles: 0 keeps the clock RUNNING (lastCollect is untouched), so
     barren output accumulates until a collect is actually worth something. It
     is slow, which is the design; it is never zero and never a charge for
     nothing, which is the guarantee. */
  if (!Object.keys(gain).length) {
    return {
      cycles: 0, gain: {}, halt, terroir: terr, tf: tfIn, terroirStalled: true,
      why: 'This ground is too poor to have produced a whole unit yet — the building keeps accruing.',
      inputLimited, cappedByTime: elapsedRaw > capMs, accruedMs: elapsed, elapsedMs: elapsedRaw,
      nextMs: cd - (elapsedRaw % cd),
    };
  }
  /* Never bank more than the stash can hold. `store.free` is now derived from
     the LEDGER'S cap (see storageState) — the same number addRes() enforces —
     so this clip and the clamp inside addRes agree instead of differing by the
     Warehouse's phantom bonus. Conservative on purpose: the inputs spent during
     collect() free up units that are not counted here, so a clip can only ever
     under-promise. */
  const store = storageState(host);
  let total = 0; for (const k in gain) total += gain[k];
  let clipped = false;
  if (total > store.free) {
    clipped = true;
    let room = store.free;
    for (const k of Object.keys(gain)) {
      const take = Math.min(gain[k], room);
      if (take > 0) { gain[k] = take; room -= take; } else delete gain[k];
    }
  }
  return { cycles, gain, halt, clipped, inputLimited, terroir: terr, tf: tfIn, cappedByTime: elapsedRaw > capMs, accruedMs: elapsed, elapsedMs: elapsedRaw, nextMs: cd - (elapsedRaw % cd) };
}

/* Collect one building. Inputs are consumed atomically with the payout — a
   collect that banks output without charging its inputs is the same class of
   bug as a partial spend, just pointed the other way. */
export function collect(host, placedId) {
  const s = ensureState(host);
  const p = s.placed.find(r => r.id === placedId);
  if (!p) return { ok: false, why: 'That building is not placed.' };
  const def = cityProdDef(p.defId);
  const pend = pending(host, p);
  if (!pend.cycles) {
    // 🗺 A terroir stall is RUNNING but sub-unit, so the halt reason says
    // "producing" and would read as a broken button. Prefer pending()'s own
    // explanation whenever it supplied one.
    return { ok: false, why: (pend.halt && !pend.halt.running) ? pend.halt.reason : (pend.why || 'Nothing banked yet.'), halt: pend.halt, terroirStalled: !!pend.terroirStalled };
  }
  /* Charge the inputs for the cycles actually paid out, atomically — AND AT THE
     SAME TERROIR FACTOR pending() SCALED THE OUTPUT BY. This statement is the
     one the whole inputTerroirScale block exists for: it read
     `(def.inputs[k]|0) * lvl * pend.cycles`, FLAT, against a yield multiplied by
     `tf`, and that asymmetry made every cycle on good ground create Cinder value
     out of nothing (4.800× chain / 38.400× legacy, measured).
     🔴 `pend.tf`, NEVER a fresh terroirFactor() call. The number that priced the
     promise is the number that charges, by construction — recomputing it here
     would reintroduce exactly the drift the shared helper prevents. */
  const inputCost = {};
  const tfIn = (typeof pend.tf === 'number' && isFinite(pend.tf) && pend.tf > 0) ? pend.tf : 1;
  for (const k in (def.inputs || {})) {
    const n = inputCharge((def.inputs[k] | 0) * (p.level | 0 || 1), pend.cycles, tfIn);
    if (n > 0) inputCost[k] = n;
  }
  if (Object.keys(inputCost).length) {
    const paid = spendCost(host, inputCost);
    if (!paid.ok) return { ok: false, why: paid.why, halt: pend.halt };
  }
  /* 🔴 MEASURE WHAT THE LEDGER ACTUALLY TOOK — never report the request.
     addRes() clamps to getResourceCap() and returns silently when there is no
     room. The old code assumed its request landed, so when the module's cap
     belief and the ledger's cap disagreed it reported `{ok:true, gain:810}`
     while 540 landed and 270 evaporated — and then reset lastCollect, burning
     36h of accrual on top. The cap belief is fixed above, but a payout must not
     depend on two numbers agreeing: this reads the balance back and reports the
     truth whatever the cap does. */
  const before = {}; for (const k in pend.gain) before[k] = host.getRes(k) | 0;
  for (const k in pend.gain) { try { host.addRes(k, pend.gain[k]); } catch (e) {} }
  const banked = {};
  let promisedTotal = 0, bankedTotal = 0;
  for (const k in pend.gain) {
    const got = Math.max(0, (host.getRes(k) | 0) - before[k]);
    promisedTotal += pend.gain[k] | 0;
    bankedTotal += got;
    if (got > 0) banked[k] = got;
  }

  /* ⏱ ADVANCE THE CLOCK BY WHAT WAS PAID FOR, NOT TO "NOW".
     Two reasons, both measured. (1) `= Date.now()` threw away the part-cycle
     remainder, so a player collecting at 13h lost the 1h of accrual past their
     second cycle. (2) If the bank comes up short the player must not be charged
     the full window for a part payout — cyclesPaid rounds UP so a shortfall can
     never be farmed by collecting repeatedly. */
  const cd = collectCdMs(host);
  const cyclesPaid = (promisedTotal > 0 && bankedTotal < promisedTotal)
    ? Math.max(1, Math.min(pend.cycles, Math.ceil(pend.cycles * (bankedTotal / promisedTotal))))
    : pend.cycles;
  const accrued = (typeof pend.accruedMs === 'number') ? pend.accruedMs : cyclesPaid * cd;
  p.lastCollect = Date.now() - Math.max(0, accrued - cyclesPaid * cd);
  try { host.setState(s); host.save(); } catch (e) {}
  const short = bankedTotal < promisedTotal;
  return {
    ok: true, gain: banked, cycles: cyclesPaid, clipped: !!pend.clipped || short,
    inputLimited: !!pend.inputLimited,
    // Stated, never silent. The stash-full toast comes from addRes; this is the
    // number the panel needs so it cannot print a payout that did not happen.
    shortfall: short ? (promisedTotal - bankedTotal) : 0,
    why: short ? `🏰 The stash could only take ${bankedTotal.toLocaleString()} of ${promisedTotal.toLocaleString()} units — the rest stayed in the building.` : undefined,
  };
}

/* 💾 RECORD THE PURCHASE, AND SAY WHETHER IT STUCK.
   🔴 THE REFUND-ON-RECORD-FAILURE PATH USED TO BE DEAD CODE. The host adapter
   wrapped setState/save in `try { … } catch (e) {}` — so a throw from
   setProdState or saveProfile was swallowed *below* this function and `catch`
   here could never fire. Driven: forcing setProdState to throw returned
   {ok:true} and charged 50,000 Cinder + 80 metal for a building that was never
   persisted. Both adapter methods now return FALSE on failure instead of
   swallowing (index.js), and this turns that false back into the throw the
   refund is written for. The module still cannot take the game down — the
   throw is caught two lines later. */
function record(host, s) {
  if (host.setState(s) === false) throw new Error('setState refused');
  if (host.save() === false) throw new Error('save refused');
}

/* ── Build / place ─────────────────────────────────────────────────────────
   The cost is paid ATOMICALLY, and if RECORDING the placement then fails the
   whole basket is refunded — a player must never be charged for a building
   that does not exist. */
export function build(host, defId, at) {
  const def = cityProdDef(defId);
  if (!def) return { ok: false, why: 'Unknown building.' };
  const s = ensureState(host);
  /* 🔗 PREREQUISITES — CHECKED BEFORE THE COST IS TAKEN, which is the only
     order that is safe: refusing after spendCost() would mean refunding, and
     every refund path is a chance to hand back more than was taken. Same
     {ok:false, why} shape the NO-CREW halt already uses, so the panel explains
     this in the voice it explains everything else. */
  const missing = missingPrereqs(defId, new Set((s.placed || []).map((p) => p && p.defId)));
  if (missing.length) {
    const names = missing.map((id) => (cityProdDef(id) || {}).name || id);
    return { ok: false, why: '⛔ Requires ' + names.join(' + ') + ' — build ' +
                             (names.length > 1 ? 'those' : 'that') + ' first.', missing };
  }
  const cost = buildingCostAt(def, 1);
  if (!canAfford(host, cost)) return { ok: false, why: 'You cannot afford it.', cost };
  const paid = spendCost(host, cost);
  if (!paid.ok) return { ok: false, why: paid.why, cost };
  try {
    at = at || {};
    s.placed.push({
      id: 'cp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      defId, level: 1, lastCollect: Date.now(), buffer: {}, workers: (def.draw && def.draw.workers | 0) || 0,
      // shop_objects shape — see ensureState.
      x: at.x | 0, y: at.y | 0, z: at.z | 0,
      rotation_y: Number(at.rotation_y) || 0, scale: Number(at.scale) || 1,
    });
    record(host, s);
  } catch (e) {
    // Take the row back out before refunding, or the player keeps a building
    // they were just repaid for. Best-effort: the write we are unwinding is the
    // one that just failed, so this may not stick either — but the in-memory
    // state must not carry a purchase that was refunded.
    try { s.placed.pop(); host.setState(s); } catch (e2) {}
    paid.refund();
    return { ok: false, why: 'Placement failed — every resource and all Cinder were refunded.', refunded: true };
  }
  return { ok: true, cost };
}

export function upgrade(host, placedId) {
  const s = ensureState(host);
  const p = s.placed.find(r => r.id === placedId);
  if (!p) return { ok: false, why: 'That building is not placed.' };
  const def = cityProdDef(p.defId);
  const target = (p.level | 0) + 1;
  if (target > def.maxLevel) return { ok: false, why: 'Already at max level.' };
  const cost = buildingCostAt(def, target);
  if (!canAfford(host, cost)) return { ok: false, why: 'You cannot afford it.', cost };
  const paid = spendCost(host, cost);
  if (!paid.ok) return { ok: false, why: paid.why, cost };
  const prev = p.level;
  try { p.level = target; record(host, s); }
  catch (e) {
    p.level = prev;
    try { host.setState(s); } catch (e2) {}
    paid.refund();
    return { ok: false, why: 'Upgrade failed — you were refunded.', refunded: true };
  }
  return { ok: true, cost, level: target };
}

export { CITY_PRODUCTION, cityProdDef, buildingCostAt, canAfford, spendCost };
