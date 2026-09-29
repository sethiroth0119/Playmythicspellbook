/* ============================================================================
   🤝 CITY TRADE — the pure part: which cycles are due, and where cargo comes from
   ============================================================================
   No DOM, no Supabase, no globals. Everything here is a function of its
   arguments, which is the whole point: this is the half that decides how much
   of a player's property moves, and it is the half that has to be testable
   without a browser or a database. The wiring lives in index.js, the UI in
   modal.js, and the actual property movement goes through the host's existing
   atomic mover — see settleShipment()'s contract below.

   TWO JOBS.
     1. dueCycles()  — a standing deal fires every `cycleHours`. Nobody is
                       scheduling it, so on any given login we have to work out
                       which cycles SHOULD have fired and have not.
     2. planDraw()   — a shipment draws from three stores in order. This decides
                       how much comes from each, and refuses cleanly rather than
                       part-delivering.

   ⚠ TUNING LIVES HERE, NOT IN ECON. CLAUDE.md routes all operation PRICING
     through _opEcon(); these are not prices. `cycleHours` is a term of the
     contract (stored per agreement, defaulted at 12) and MAX_CATCHUP is a
     client safety bound, not an economy number. Nothing here mints, spends or
     values anything, so folding it into the economy's tuning table would put a
     non-economic knob in the place the closed-loop audit reads.
============================================================================ */

/* A long absence must not dump fifty shipments into one frame — that is both a
   UI stampede and, if any leg fails, fifty rollbacks. Settle at most this many
   cycles per sweep and leave the rest for the next one; they do not expire,
   because the cycle index is derived from the clock and not from a cursor. */
export const MAX_CATCHUP = 8;

/* ── 1. WHICH CYCLES ARE DUE ────────────────────────────────────────────────
   A cycle index is a pure function of (startedAt, cycleHours, now). It is NOT
   a counter that advances when someone settles — that distinction is what lets
   two clients, offline for different lengths of time, agree on which cycle is
   which without talking to each other. The server's
   `unique (agreement_id, cycle_index)` then makes the duplicate a no-op.

   Cycle 0 fires one full period AFTER the start, not at the start: accepting a
   deal should not instantly move cargo before either party has seen it listed.

   @param startedAt  ms epoch, when the partner accepted
   @param cycleHours term of the contract
   @param days       term of the contract
   @param now        ms epoch
   @param settled    array of cycle indices already recorded (from the server)
   @returns { due: number[], total: number, expired: boolean } */
export function dueCycles(startedAt, cycleHours, days, now, settled) {
  const start = Number(startedAt);
  const ch = Number(cycleHours);
  const dd = Number(days);
  if (!isFinite(start) || !isFinite(ch) || !isFinite(dd) || ch <= 0 || dd <= 0) {
    return { due: [], total: 0, expired: false };
  }
  const periodMs = ch * 3600 * 1000;
  // How many whole periods the contract runs for. A 2-day deal at 12h is 4.
  const total = Math.max(0, Math.floor((dd * 24) / ch));
  const endsAt = start + total * periodMs;
  const elapsed = Number(now) - start;
  if (!isFinite(elapsed)) return { due: [], total, expired: false };

  // Highest cycle whose due time has passed, capped by the contract length.
  const fired = Math.min(total, Math.floor(elapsed / periodMs));
  const done = new Set((settled || []).map(Number));
  const due = [];
  for (let i = 0; i < fired && due.length < MAX_CATCHUP; i++) {
    if (!done.has(i)) due.push(i);
  }
  return { due, total, expired: Number(now) >= endsAt };
}

/* When cycle `i` was due — recorded on the shipment so a late settle is honest
   about what it is settling rather than stamping it "now". */
export function cycleDueAt(startedAt, cycleHours, i) {
  return Number(startedAt) + (Number(i) + 1) * Number(cycleHours) * 3600 * 1000;
}

/* ── 2. WHERE THE CARGO COMES FROM ──────────────────────────────────────────
   Three stores, in this order, because they are three different kinds of thing
   to spend:
     city   the city's own economy inventory — the deal's natural source
     vault  the player's shared resource stash
     boe    the Bank of Ethos resource vault — the deepest and least expected,
            so it is drawn last and always reported
   `planDraw` decides the split. It does NOT move anything: moving is the
   caller's job, through the host's atomic mover, so that a failure can unwind.

   🔴 ALL OR NOTHING. If the three stores together cannot cover `units`, this
      returns ok:false and a plan of ZERO. It never proposes a part-shipment.
      A half-delivered leg is the shape that loses property: /src/trading's
      settle.js exists because addRes() silently swallowed a gain once and
      destroyed 215 units, and the lesson recorded there is that the preflight
      refuses before a single unit moves. Same rule here.

   @param units   how many are owed this cycle
   @param have    { city, vault, boe } — non-negative available amounts
   @returns { ok, plan: {city,vault,boe}, total, shortBy } */
export function planDraw(units, have) {
  const need = Math.max(0, Number(units) || 0);
  const src = {
    city: Math.max(0, Number(have && have.city) || 0),
    vault: Math.max(0, Number(have && have.vault) || 0),
    boe: Math.max(0, Number(have && have.boe) || 0),
  };
  const available = src.city + src.vault + src.boe;
  if (need === 0) return { ok: true, plan: { city: 0, vault: 0, boe: 0 }, total: 0, shortBy: 0 };
  if (available < need) {
    return { ok: false, plan: { city: 0, vault: 0, boe: 0 }, total: 0, shortBy: need - available };
  }
  let left = need;
  const plan = { city: 0, vault: 0, boe: 0 };
  for (const k of ['city', 'vault', 'boe']) {
    if (left <= 0) break;
    const take = Math.min(left, src[k]);
    plan[k] = take;
    left -= take;
  }
  return { ok: true, plan, total: plan.city + plan.vault + plan.boe, shortBy: 0 };
}

/* The outcome string the shipment row records, from the two legs' success.
   Kept here rather than at the call site so both clients label a cycle the
   same way — they each settle their own leg and either may write the row. */
export function outcomeOf(proposerOk, partnerOk) {
  if (proposerOk && partnerOk) return 'settled';
  if (!proposerOk && !partnerOk) return 'short_both';
  return proposerOk ? 'short_partner' : 'short_proposer';
}

/* What the two players are told when a leg comes up short. The defaulting side
   gets an obligation, the other gets a name and a reason — never a bare
   "trade failed", which tells neither of them what to do next. */
export function shortfallMessages(opts) {
  const o = opts || {};
  const res = o.resourceName || o.resource || 'resources';
  const partner = o.partnerName || 'Your trade partner';
  const units = Math.max(0, Number(o.shortBy) || 0);
  return {
    // → the player who could not deliver
    debtor: '⚠ You owe ' + units + '× ' + res + ' on your trade agreement and your city, '
          + 'vault and Bank of Ethos are all short. Top up before the next shipment '
          + 'or the deal will keep defaulting.',
    // → the player who was expecting cargo
    creditor: '📭 ' + partner + ' has no ' + res + ' to trade. The shipment did not '
            + 'arrive — reach out to the player.',
  };
}
