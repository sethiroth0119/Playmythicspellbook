/* ══════════════════════════════════════════════════════════════════════════
   🛏 TRIAGE — who gets the dose. Pure: no DOM, no I/O, no globals.
   ──────────────────────────────────────────────────────────────────────────
   A crate arrives with a fixed number of doses and the ward has more patients
   than doses. That gap IS the minigame: there is no allocation that helps
   everyone, so the player has to decide who they are not treating.

   🔴 THE ONE RULE THAT MAKES DOSES MATTER: a viable cure only RETIRES a strain
   if enough of the people carrying it were actually reached. Under-dose and
   the untreated are a reservoir — they keep spreading, and the strain survives
   a cure that was chemically perfect. Without this rule, dose count is
   decoration: one dose would clear an outbreak and the whole crate would be
   surplus. See `coverage()` and CLEAR_THRESHOLD.

   🔴 CRITICAL PATIENTS COST MORE THAN THEY RETURN. Two doses each against one
   for the symptomatic, and treating them does not slow the outbreak — a
   critical patient is already too ill to be at work infecting anyone. So the
   efficient play is to abandon the sickest and treat the spreaders, and the
   humane play costs you the strain. The game does not resolve that for the
   player and must not: `defaultPlan()` treats critical first because that is
   what a ward with nobody watching would do, and it is deliberately NOT the
   optimal play.

   ⚠ NOBODY DIES HERE EITHER. Untreated patients stay ill and recover on the
   outbreak's own clock (outbreak.js's three inherited rules). The cost of not
   treating someone is that they go on spreading and go on dragging the city's
   labour, never that they are removed.
   ══════════════════════════════════════════════════════════════════════════ */

export const V = 1;

/* Doses by stage. Incubating patients are NOT treatable — you cannot see them
   yet, which is what stops the player from pre-emptively solving an outbreak
   with one well-timed crate. */
export const DOSE_COST = { symptomatic: 1, critical: 2 };

/* The share of a strain's ACTIVE cases that must be cleared for the strain
   itself to be retired. Below it the survivors carry it on.
   ⚠ 0.8 not 1.0 on purpose: demanding every last case would mean a single
     incubating patient could defeat a perfect cure, which reads as the game
     cheating rather than as under-dosing. */
export const CLEAR_THRESHOLD = 0.8;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── the ward roster ───────────────────────────────────────────────────────
   Built from the outbreak state plus the citizen roster. Critical first, then
   symptomatic, then longest-ill — the order a triage nurse would work, and the
   order the list should already be in when the player opens it.

   Returns [] rather than throwing for every missing input, because the ward is
   openable from the Operations screen with no city loaded at all. */
export function patients(outbreakState, roster, strainId) {
  try {
    const st = outbreakState || {};
    const infections = st.infections || {};
    const byId = {};
    for (const c of (roster || [])) if (c && c.id != null) byId[String(c.id)] = c;

    const out = [];
    for (const czId of Object.keys(infections)) {
      const inf = infections[czId];
      if (!inf) continue;
      if (strainId && inf.strainId !== strainId) continue;
      if (inf.stage !== 'symptomatic' && inf.stage !== 'critical') continue;   // incubating is invisible
      const c = byId[czId];
      out.push({
        id: czId,
        name: (c && c.name) || 'Unnamed',
        job: (c && c.job) || null,
        stage: inf.stage,
        since: inf.since || 0,
        strainId: inf.strainId,
        cost: DOSE_COST[inf.stage] || 1,
      });
    }
    out.sort((a, b) =>
      (b.stage === 'critical') - (a.stage === 'critical') || a.since - b.since);
    return out;
  } catch (e) { return []; }
}

/* What a plan costs, and whether it fits in the crate. `assign` is a list of
   citizen ids — an ORDER, not a set, because a player who over-assigns should
   be told which patient fell off the end rather than have the whole plan
   rejected. */
export function priceOf(list, assign) {
  const want = new Set((assign || []).map(String));
  let doses = 0, treated = 0;
  const rows = [];
  for (const p of list) {
    if (!want.has(String(p.id))) continue;
    doses += p.cost;
    treated++;
    rows.push(p);
  }
  return { doses, treated, rows };
}

/* Trim a plan to what the crate can actually cover, preserving the player's
   own ordering. Returns the accepted ids and the ones that did not fit, so the
   UI can grey them rather than silently dropping them. */
export function fit(list, assign, doses) {
  const budget = Math.max(0, doses | 0);
  const byId = {};
  for (const p of list) byId[String(p.id)] = p;
  const accepted = [], dropped = [];
  let spent = 0;
  for (const raw of (assign || [])) {
    const p = byId[String(raw)];
    if (!p) continue;
    if (spent + p.cost <= budget) { accepted.push(p.id); spent += p.cost; }
    else dropped.push(p.id);
  }
  return { accepted, dropped, spent, budget, left: budget - spent };
}

/* ── coverage ──────────────────────────────────────────────────────────────
   The number the whole feature turns on. `activeCases` is every case of this
   strain the city currently has — INCLUDING the incubating ones the ward
   cannot see, because a reservoir you cannot see is still a reservoir. That is
   why a crate that arrives late into a spreading outbreak cannot retire it
   however good the chemistry was: the answer is to ship sooner, not to ship
   better. */
export function coverage(activeCases, treatedCount) {
  const total = Math.max(0, activeCases | 0);
  if (total <= 0) return { share: 1, clears: true, total: 0, treated: 0, shortfall: 0 };
  const treated = clamp(treatedCount | 0, 0, total);
  const share = treated / total;
  return {
    share: +share.toFixed(3),
    clears: share >= CLEAR_THRESHOLD,
    total,
    treated,
    // How many more would have to be treated to retire the strain.
    shortfall: Math.max(0, Math.ceil(total * CLEAR_THRESHOLD) - treated),
  };
}

/* What the ward staff do when the player never turns up. Critical first, then
   symptomatic by longest-ill, until the doses run out.
   🔴 IT IS NOT THE OPTIMAL PLAY, and that is the point — see the header. An
   auto-plan that maximised coverage would make opening the ward pointless. */
export function defaultPlan(list, doses) {
  const budget = Math.max(0, doses | 0);
  const out = [];
  let spent = 0;
  for (const p of list) {
    if (spent + p.cost > budget) continue;    // skip, don't stop: a 1-dose gap can still take a symptomatic
    out.push(p.id);
    spent += p.cost;
  }
  return out;
}

/* A plan that treats the most PEOPLE rather than the sickest — the efficient
   play, offered as a button so the trade-off is legible instead of something
   the player has to discover by arithmetic. */
export function widestPlan(list, doses) {
  const budget = Math.max(0, doses | 0);
  const cheapFirst = list.slice().sort((a, b) => a.cost - b.cost || a.since - b.since);
  const out = [];
  let spent = 0;
  for (const p of cheapFirst) {
    if (spent + p.cost > budget) continue;
    out.push(p.id);
    spent += p.cost;
  }
  return out;
}

export function stageLabel(s) {
  return s === 'critical' ? 'Critical' : s === 'symptomatic' ? 'Symptomatic' : 'Incubating';
}
export function stageColor(s) {
  return s === 'critical' ? '#ff5b6e' : s === 'symptomatic' ? '#e0a860' : '#8b93a3';
}
