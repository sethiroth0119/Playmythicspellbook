/* ════════════════════════════════════════════════════════════════════════════
   📊 SUPPLY CHAIN VIEW — "tools that let you see WHY something isn't working."
   ----------------------------------------------------------------------------
   Instead of:
       Factory efficiency: 42%
   this produces:
       Workers:        96%
       Electricity:   100%
       Water:         100%
       Iron Supply:    31% ⚠
       Freight:        78%
       Primary Bottleneck: Iron Supply
   ...and then traces it:
       Iron Mine → Warehouse → Freight Route → Steel Mill

   🔴 THE TRACE IS THE FEATURE, NOT THE PERCENTAGE.
   A number tells a player something is wrong. A trace tells them where to
   build. So `trace()` walks UP the recipe graph from the binding constraint
   until it finds the step that is actually failing, and reports the FIRST
   ACTIONABLE CAUSE — "no iron deposit on this node, you must import it" is a
   different instruction from "you have iron but no smelter", and both are
   different from "you have both but no freight to move it between them".

   This module is PURE ANALYSIS. It reads state and returns findings; it moves
   no Cinder, changes no firm, and has no side effects. That is deliberate —
   diagnosis that mutates is diagnosis you cannot safely run from a render path.
   ════════════════════════════════════════════════════════════════════════════ */

import { DEPOSITS, RECIPES, legsOf, industryOf, INDUSTRIES } from './recipes.js';
import * as Endow from './endowment.js';
import * as Firms from './firms.js';
import * as Sim from './sim.js';
import * as Logistics from './logistics.js';
import * as Prices from './prices.js';

/* The reasons a step can be blocked, worst first. Order is load-bearing:
   `classify()` returns the FIRST match, so a resource with no deposit AND no
   producer reports the deposit problem, which is the one the player cannot
   solve by building harder. */
export const CAUSES = {
  NO_DEPOSIT:   { key: 'NO_DEPOSIT',   ico: '🚫', label: 'Not in this ground',
                  fix: 'This node has no deposit. It must be imported — open Trade.' },
  NO_PRODUCER:  { key: 'NO_PRODUCER',  ico: '🏗️', label: 'Nobody makes it',
                  fix: 'No business in the city produces this. Build one, or import it.' },
  NO_INPUT:     { key: 'NO_INPUT',     ico: '📦', label: 'Starved of inputs',
                  fix: 'Its own suppliers are short. Trace upstream.' },
  NO_WORKERS:   { key: 'NO_WORKERS',   ico: '👷', label: 'Understaffed',
                  fix: 'Not enough workers. Add housing, or a higher-paying rival is outbidding it.' },
  NO_POWER:     { key: 'NO_POWER',     ico: '⚡', label: 'Brownout',
                  fix: 'Generation is short of demand. Build power.' },
  NO_WATER:     { key: 'NO_WATER',     ico: '💧', label: 'Water short',
                  fix: 'Water supply is short of demand.' },
  NO_FREIGHT:   { key: 'NO_FREIGHT',   ico: '🚚', label: 'Freight congested',
                  fix: 'More is booked than the network can carry. Build warehouses or a terminal.' },
  NO_DEMAND:    { key: 'NO_DEMAND',    ico: '💤', label: 'No orders',
                  fix: 'Nobody is buying. This is not a supply problem — it needs customers.' },
  NO_CASH:      { key: 'NO_CASH',      ico: '💸', label: 'Out of cash',
                  fix: 'It cannot pay for inputs or wages. It is failing, not blocked.' },
  OK:           { key: 'OK',           ico: '✅', label: 'Running',
                  fix: '' },
};

/* ── ONE FIRM ───────────────────────────────────────────────────────────────
   The constraint table for a single business, sorted worst-first, plus the
   binding constraint and what to do about it. */
export function diagnose(firm) {
  if (!firm) return null;
  const rows = (firm.lastConstraints || []).map(c => ({
    key: c.key,
    label: prettyLabel(c.key, c.label),
    pct: Math.max(0, Math.min(1, c.pct)),
  }));

  /* "No orders" is not a constraint the production loop can see — the firm was
     ALLOWED to run and chose not to, because nothing was on the books. Without
     this row a demand-idled plant reports "Workers 100%, Power 100%" and looks
     healthy while producing nothing, which is the most confusing possible
     screen. */
  if ((firm.idleForDemand || 0) > 0.01) {
    rows.push({ key: '__demand__', label: 'Orders', pct: Math.max(0, 1 - firm.idleForDemand) });
  }
  rows.sort((a, b) => a.pct - b.pct);

  const worst = rows[0] || null;
  const cause = classify(firm, worst);
  return {
    firmId: firm.id, name: firm.name, out: firm.out,
    level: firm.level, rung: firm.rung,
    efficiency: firm.lastFill != null ? firm.lastFill : 1,
    produced: firm.lastProduced || 0,
    rows,
    bottleneck: worst && worst.pct < 0.995 ? worst : null,
    cause,
    leg: firm.lastLeg ? (firm.lastLeg.tag || 'default') : null,
    cash: firm.cash, inventory: firm.inventory,
  };
}

function prettyLabel(key, fallback) {
  if (key === 'workers') return 'Workers';
  if (key === 'freight') return 'Freight Capacity';
  if (key === '__demand__') return 'Orders';
  const r = RECIPES[key] || DEPOSITS[key];
  if (!r) return fallback || key;
  // Turn a camelCase id into words: ironOre → "Iron Ore Supply"
  const words = String(key).replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
  return words.trim() + ' Supply';
}

/* Why is this the binding constraint? */
export function classify(firm, worst) {
  if (firm.rung === 'BANKRUPT') return CAUSES.NO_CASH;
  if (!worst || worst.pct >= 0.995) return CAUSES.OK;
  if (worst.key === '__demand__') return CAUSES.NO_DEMAND;
  if (worst.key === 'workers') return CAUSES.NO_WORKERS;
  if (worst.key === 'freight') return CAUSES.NO_FREIGHT;
  if (worst.key === 'electricity' && !Firms.byOutput('electricity').length) return CAUSES.NO_PRODUCER;
  if (worst.key === 'electricity') return CAUSES.NO_POWER;
  if (worst.key === 'freshWater') return CAUSES.NO_WATER;
  if (firm.cash <= 0) return CAUSES.NO_CASH;

  // It is a material. Which kind of material problem?
  const id = worst.key;
  if (DEPOSITS[id] && !Endow.canExtract(Sim.state().nodeId, id)) return CAUSES.NO_DEPOSIT;
  if (!Firms.byOutput(id).length) return CAUSES.NO_PRODUCER;
  return CAUSES.NO_INPUT;
}

/* ── THE TRACE ──────────────────────────────────────────────────────────────
   Walk upstream from a blocked resource to the first step that is actually the
   problem, and return the path so the UI can print:
       Iron Mine → Warehouse → Freight Route → Steel Mill

   ⚠ DEPTH-CAPPED. The recipe graph has real cycles (recipes.js documents
     steel ⇄ recycledMetal and electricity ⇄ its fuels), so an uncapped walk
     would not terminate. `seen` handles the common case and the cap is the
     backstop. */
export function trace(resId, maxDepth) {
  const cap = maxDepth || 8;
  const path = [];
  const seen = new Set();
  let cur = resId;

  for (let d = 0; d < cap; d++) {
    if (!cur || seen.has(cur)) break;
    seen.add(cur);

    const producers = Firms.byOutput(cur);
    const nodeId = Sim.state().nodeId;

    if (DEPOSITS[cur] && !Endow.canExtract(nodeId, cur)) {
      path.push({ res: cur, step: 'Deposit', cause: CAUSES.NO_DEPOSIT, ok: false,
                  detail: 'This node has no ' + prettyLabel(cur) + '.' });
      break;
    }
    if (!producers.length) {
      path.push({ res: cur, step: (INDUSTRIES[industryOf(cur)] || {}).name || 'Producer',
                  cause: CAUSES.NO_PRODUCER, ok: false,
                  detail: 'Nothing in the city produces ' + cur + '.' });
      break;
    }

    // There ARE producers. Are they managing?
    const worstFirm = producers.slice().sort((a, b) => (a.lastFill || 0) - (b.lastFill || 0))[0];
    const d2 = diagnose(worstFirm);
    path.push({
      res: cur, step: worstFirm.name, firmId: worstFirm.id,
      cause: d2.cause, ok: !d2.bottleneck,
      pct: d2.efficiency,
      detail: d2.bottleneck ? (d2.bottleneck.label + ' at ' + Math.round(d2.bottleneck.pct * 100) + '%') : 'Running',
    });
    if (!d2.bottleneck) break;                         // this link is fine
    if (d2.cause === CAUSES.NO_FREIGHT) {
      path.push({ res: cur, step: 'Freight Network', cause: CAUSES.NO_FREIGHT, ok: false,
                  detail: Math.round(Logistics.load() * 100) + '% of capacity booked.' });
      break;
    }
    const nextKey = d2.bottleneck.key;
    if (nextKey === 'workers' || nextKey === '__demand__') break;   // not a material chain
    cur = nextKey;
  }
  return path;
}

/* ── THE CITY VIEW ──────────────────────────────────────────────────────────
   Every struggling business, worst first, with its cause — the screen a player
   opens when the city "feels wrong" and they do not know why. */
export function cityReport(limit) {
  const out = [];
  for (const f of Firms.alive()) {
    const d = diagnose(f);
    if (!d) continue;
    if (!d.bottleneck && f.rung === 'HEALTHY') continue;    // nothing to say
    out.push(d);
  }
  /* Sort by how badly it is running, but push demand-idled businesses DOWN:
     a shop with no customers is a real problem and a different one, and it
     should not bury the factory that is actually starved of steel. */
  out.sort((a, b) => {
    const ax = a.cause === CAUSES.NO_DEMAND ? 1 : 0;
    const bx = b.cause === CAUSES.NO_DEMAND ? 1 : 0;
    if (ax !== bx) return ax - bx;
    return a.efficiency - b.efficiency;
  });
  return limit ? out.slice(0, limit) : out;
}

/* The single most important thing wrong with this city right now, in one line.
   Returns null when nothing is wrong, so the caller can say so plainly rather
   than inventing a problem to fill a panel. */
export function primary() {
  const rep = cityReport();
  if (!rep.length) return null;
  const top = rep[0];
  return {
    firm: top.name, res: top.out,
    cause: top.cause,
    at: top.bottleneck ? top.bottleneck.label : top.cause.label,
    pct: top.bottleneck ? top.bottleneck.pct : top.efficiency,
    fix: top.cause.fix,
    path: top.bottleneck ? trace(top.bottleneck.key) : [],
  };
}

/* What the city is structurally missing — the strategic view, independent of
   any one business. Drives the "you must trade for these" prompt. */
export function structuralGaps() {
  const nodeId = Sim.state().nodeId;
  const gaps = Endow.strategicGaps(nodeId);
  return gaps.map(id => ({
    res: id,
    price: Prices.priceOf(id),
    consumers: consumersInCity(id),
    imported: (Sim.state().observed[id] || {}).supply || 0,
  })).sort((a, b) => b.consumers - a.consumers);
}

function consumersInCity(id) {
  let n = 0;
  for (const f of Firms.alive()) {
    const leg = f.lastLeg || legsOf(f.out)[0];
    if (leg && leg.in && leg.in[id]) n++;
  }
  return n;
}

export default { diagnose, trace, cityReport, primary, structuralGaps, CAUSES };
