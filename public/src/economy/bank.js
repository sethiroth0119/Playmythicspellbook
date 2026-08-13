/* ════════════════════════════════════════════════════════════════════════════
   🏦 BANK — simulated commercial credit for firms.
   ----------------------------------------------------------------------------
   "Businesses may be able to borrow Cinder to expand... But debt creates risk.
    A company that expands too aggressively could end up unable to repay."

   🔴 THIS IS NOT `player_banks`. READ THIS BEFORE WIRING ANYTHING.
   The repo already ships a player-facing bank — player_banks.sql,
   bank_products.sql, bank_charter_pricing.sql, bank_cinder_charter.sql — which
   moves REAL player Cinder (`Profile.gems`) through chartered institutions.
   Nothing in this file touches it, reads it, or writes to it.

   These loans are INTERNAL to the city simulation: simulated NPC firms
   borrowing simulated Cinder from a simulated lender inside the closed loop.
   Connecting the two would let an NPC bakery draw on a real player's chartered
   reserves — a duplication bug wearing a feature's clothes, and one that would
   be very hard to see because both sides would look correct in isolation.

   If a future round DOES want player banks to fund city firms, the seam is a
   deliberate deposit into `LENDER.reserve` from a real bank withdrawal, audited
   on both sides — never a shared balance.

   ── THE CLOSED LOOP ────────────────────────────────────────────────────────
   The lender holds a reserve. A loan moves reserve → firm cash. Repayments move
   firm cash → reserve. Interest is NOT minted: it moves from the firm to the
   reserve like everything else, which means aggregate firm cash falls as
   interest accrues and the lender's reserve grows. That is what makes debt
   genuinely risky rather than free money with a cosmetic counter.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from './tuning.js';
import * as Firms from './firms.js';

const LENDER = {
  /* Seeded once, from the city treasury, when the first bank is built. A
     lender with no reserve makes no loans — which is correct, and is why a
     brand-new city cannot borrow its way out of its first bad week. */
  reserve: 0,
  loans: [],       // {id, firmId, principal, owed, rate, dueDay, openedDay}
  nextId: 1,
  hasBank: false,
  lifetimeLent: 0, lifetimeRepaid: 0, lifetimeWritten: 0,
};

export function state() { return LENDER; }
export function reset() {
  LENDER.reserve = 0; LENDER.loans = []; LENDER.nextId = 1; LENDER.hasBank = false;
  LENDER.lifetimeLent = 0; LENDER.lifetimeRepaid = 0; LENDER.lifetimeWritten = 0;
}

/* The city builds a bank; the treasury capitalises it. Returns the amount
   actually moved so sim.js can debit the treasury by exactly that. */
export function capitalise(amount) {
  const a = Math.max(0, amount || 0);
  LENDER.reserve += a;
  if (a > 0) LENDER.hasBank = true;
  return a;
}
export function setHasBank(v) { LENDER.hasBank = !!v; }

/* Annual rate for a firm, by level. A level-5 industry leader borrows cheaply;
   a level-1 corner shop does not. */
export function rateFor(firm) {
  const risk = ECON.bank.riskPremium[firm.level] != null
             ? ECON.bank.riskPremium[firm.level]
             : ECON.bank.riskPremium[1];
  return ECON.bank.baseRate + risk;
}

/* Most this firm could borrow: a multiple of its daily revenue, less what it
   already owes. A firm with no revenue cannot borrow — which is the correct
   answer and the one that stops a dying business from borrowing itself into a
   bigger crater. */
export function creditLimit(firm) {
  const rev = firm.revenueAvg || 0;
  const cap = rev * ECON.bank.maxLoanToRevenueDays;
  return Math.max(0, cap - (firm.debt || 0));
}

export function canBorrow(firm, day) {
  if (!LENDER.hasBank) return { ok: false, why: 'No bank in the city' };
  if (firm.rung === 'BANKRUPT') return { ok: false, why: 'Bankrupt' };
  if ((firm.blacklistUntil || 0) > day) return { ok: false, why: 'Defaulted recently' };
  if (creditLimit(firm) < 1) return { ok: false, why: 'No borrowing capacity' };
  if (LENDER.reserve < 1) return { ok: false, why: 'Bank has no reserves' };
  return { ok: true };
}

export function borrow(firm, amount, day) {
  const chk = canBorrow(firm, day);
  if (!chk.ok) return { ok: false, why: chk.why, amount: 0 };
  const amt = Math.min(Math.max(0, amount || 0), creditLimit(firm), LENDER.reserve);
  if (amt < 1) return { ok: false, why: 'Below minimum', amount: 0 };

  const rate = rateFor(firm);
  const loan = {
    id: LENDER.nextId++, firmId: firm.id, principal: amt,
    owed: amt, rate, openedDay: day, dueDay: day + ECON.bank.termDays,
  };
  LENDER.loans.push(loan);
  LENDER.reserve -= amt;
  firm.cash += amt;
  firm.debt = (firm.debt || 0) + amt;
  firm.loanId = loan.id;
  LENDER.lifetimeLent += amt;
  return { ok: true, amount: amt, loan };
}

/* One economic day of interest and scheduled repayment.
   Returns a list of events (repaid / missed / defaulted / written off) so the
   city log can report them — a firm quietly defaulting off-screen is exactly
   the kind of thing this project's comments keep warning about. */
export function accrue(days, day) {
  const events = [];
  const per = Math.max(0, days || 0);
  if (!per) return events;

  for (const loan of LENDER.loans.slice()) {
    const firm = Firms.byId(loan.firmId);
    if (!firm || firm.rung === 'BANKRUPT') {
      // Write-off. The reserve eats it — that is what a bad loan book costs.
      LENDER.lifetimeWritten += loan.owed;
      events.push({ kind: 'writeoff', firmId: loan.firmId, amount: loan.owed, name: firm ? firm.name : 'a closed business' });
      LENDER.loans = LENDER.loans.filter(l => l !== loan);
      if (firm) { firm.debt = Math.max(0, (firm.debt || 0) - loan.owed); firm.loanId = null; }
      continue;
    }

    // Interest, prorated over an economic year.
    const interest = loan.owed * (loan.rate / 365) * per;
    loan.owed += interest;

    // Scheduled amortisation over the remaining term.
    const left = Math.max(1, loan.dueDay - day);
    const due = (loan.owed / left) * per;
    const paid = Firms.pay(firm, due);
    loan.owed = Math.max(0, loan.owed - paid);
    firm.debt = Math.max(0, (firm.debt || 0) - paid);
    LENDER.reserve += paid;
    LENDER.lifetimeRepaid += paid;

    if (paid < due * 0.5) {
      events.push({ kind: 'missed', firmId: firm.id, name: firm.name, shortfall: due - paid });
      /* A firm that cannot service its debt is pushed DOWN the ladder directly.
         Without this, a business could carry an unpayable loan forever at
         REDUCED and never actually fail, which makes the whole debt mechanic
         decorative. */
      firm.badDays = Math.max(firm.badDays, ECON.firm.distress.debtAfterDays);
    }

    if (loan.owed <= 0.01) {
      events.push({ kind: 'repaid', firmId: firm.id, name: firm.name, amount: loan.principal });
      LENDER.loans = LENDER.loans.filter(l => l !== loan);
      firm.loanId = null;
    } else if (day > loan.dueDay + 30) {
      // Term blown by a month. Default.
      events.push({ kind: 'default', firmId: firm.id, name: firm.name, amount: loan.owed });
      LENDER.lifetimeWritten += loan.owed;
      LENDER.loans = LENDER.loans.filter(l => l !== loan);
      firm.debt = Math.max(0, (firm.debt || 0) - loan.owed);
      firm.loanId = null;
      firm.blacklistUntil = day + ECON.bank.blacklistDays;
      firm.badDays = Math.max(firm.badDays, ECON.firm.distress.defaultAfterDays);
    }
  }
  return events;
}

/* A firm at the DEBT rung asks for help automatically. Borrows enough to cover
   a few days of operating cost — not enough to fix a broken business, which is
   the point: credit buys time, it does not buy demand. */
export function autoBorrow(firm, day) {
  if (firm.rung !== 'DEBT' && firm.rung !== 'DEFAULT') return null;
  if (firm.loanId) return null;
  const need = Firms.dailyOperatingCost(firm) * 5;
  const r = borrow(firm, need, day);
  return r.ok ? r : null;
}

export function totalOwed() { let n = 0; for (const l of LENDER.loans) n += l.owed; return n; }
export function loanCount() { return LENDER.loans.length; }

export function report() {
  return {
    hasBank: LENDER.hasBank, reserve: LENDER.reserve, loans: LENDER.loans.length,
    owed: totalOwed(), lent: LENDER.lifetimeLent, repaid: LENDER.lifetimeRepaid,
    written: LENDER.lifetimeWritten,
  };
}

export function serialize() {
  return {
    v: 1, reserve: Math.round(LENDER.reserve * 100) / 100, hasBank: LENDER.hasBank,
    nextId: LENDER.nextId,
    loans: LENDER.loans.map(l => ({ ...l, owed: Math.round(l.owed * 100) / 100 })),
    lifetimeLent: LENDER.lifetimeLent, lifetimeRepaid: LENDER.lifetimeRepaid,
    lifetimeWritten: LENDER.lifetimeWritten,
  };
}
export function load(raw) {
  reset();
  if (!raw || typeof raw !== 'object') return;
  LENDER.reserve = Math.max(0, Number(raw.reserve) || 0);
  LENDER.hasBank = !!raw.hasBank;
  LENDER.nextId = Math.max(1, raw.nextId | 0 || 1);
  LENDER.lifetimeLent = Number(raw.lifetimeLent) || 0;
  LENDER.lifetimeRepaid = Number(raw.lifetimeRepaid) || 0;
  LENDER.lifetimeWritten = Number(raw.lifetimeWritten) || 0;
  if (Array.isArray(raw.loans)) {
    for (const l of raw.loans) {
      if (!l || !l.firmId) continue;
      LENDER.loans.push({
        id: l.id || LENDER.nextId++, firmId: l.firmId,
        principal: Math.max(0, Number(l.principal) || 0),
        owed: Math.max(0, Number(l.owed) || 0),
        rate: Number(l.rate) || ECON.bank.baseRate,
        openedDay: l.openedDay | 0, dueDay: l.dueDay | 0,
      });
    }
  }
}

export default { borrow, accrue, capitalise, creditLimit, report, state };
