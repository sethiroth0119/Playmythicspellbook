/* ══════════════════════════════════════════════════════════════════════════
   📥 INTAKE — what is in the crate, and whether you open it. Pure.
   ──────────────────────────────────────────────────────────────────────────
   🔴 THIS FILE IS WHERE THE MORAL LOOP CLOSES. Until now the SHIPPER ate every
   consequence of a bad cure: they mixed it, they shipped it, and the mutant
   came out of their own crate. The lab at the far end was a mailbox that got
   paid. Moving the last call here — administer, or refuse — makes the medical
   player the one who decides whether a suspect batch reaches people, which
   means two players can each have genuinely acted, and each can genuinely
   blame the other. That is the tension a player-run economy is for.

   The decision only exists because SCREENING IS OPTIONAL. A crate arrives
   opaque: you know its manifest (who sent it, how many doses, what strain) and
   nothing about what the drive did to it. Screening reveals the arrived grade.
   Administering unscreened is a real gamble, and it is a gamble a busy or
   greedy player will take, because the lab is not paid until the doses go in.

   ⚠ NOTHING HERE MUTATES. state.js owns every write; this decides what the
   player is looking at and what each choice would cost them.
   ══════════════════════════════════════════════════════════════════════════ */

import { GRADES } from '../plague/cures.js';

export const V = 1;

/* Screening costs one Medicine per ten doses — a real cost, small enough that
   skipping it is greed rather than poverty, and denominated in the resource
   the ward already deals in.
   ⚠ Priced in RESOURCES, never Cinder: a Cinder price would go through
     _opEcon (CLAUDE.md) and this is a reagent draw, not an operation. */
export const SCREEN_COST_PER_10 = 1;

export function screenCost(doses) {
  return Math.max(1, Math.ceil(Math.max(0, doses | 0) / 10) * SCREEN_COST_PER_10);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── the crate at the door ─────────────────────────────────────────────────
   `shipment` is a delivered waybill; `batch` is the formulation that left the
   bench. What the ward may SEE depends on whether it has been screened.

   🔴 THE UNSCREENED VIEW MUST NOT LEAK THE ANSWER. It shows the dispatch grade
   — what the shipper claimed when they sent it — and never the arrived grade.
   Those two differ exactly when the cold chain broke, which is the case that
   matters, so showing the arrived grade for free would delete the decision.
   The only free signal is the carrier's integrity, which is a reason to be
   suspicious rather than a fact about this crate. */
export function crateView(shipment, batch, screened) {
  const r = (shipment && shipment.result) || {};
  const dispatchGrade = GRADES[(batch && batch.f && batch.f.grade)] || GRADES.inert;
  const arrivedGrade = GRADES[r.arrivedGrade] || dispatchGrade;
  const integrity = clamp(+shipment.integrity || 0, 0, 1);

  const view = {
    id: shipment.id,
    from: shipment.carrierName || 'Unknown haulier',
    shipper: shipment.shipperName || null,
    strainName: (batch && batch.strainName) || 'Unknown isolate',
    strainIsolate: (batch && batch.strainIsolate) || '',
    strainId: shipment.strainId,
    doses: Math.max(0, r.dosesDelivered | 0),
    dosesLost: Math.max(0, r.dosesLost | 0),
    integrity,
    screened: !!screened,
    // Always visible: this is what the shipper put on the manifest.
    dispatchGrade,
    // The carrier's own record. A reason for suspicion, not a measurement.
    suspicion: integrity < 0.55 ? 'high' : integrity < 0.78 ? 'some' : 'low',
  };

  if (screened) {
    view.arrivedGrade = arrivedGrade;
    view.stability = r.arrivedStability != null ? r.arrivedStability : (batch && batch.f ? batch.f.stability : 0);
    view.purity = r.arrivedPurity != null ? r.arrivedPurity : (batch && batch.f ? batch.f.purity : 0);
    view.risk = r.arrivedRisk != null ? r.arrivedRisk : (batch && batch.f ? batch.f.risk : 0);
    view.degraded = arrivedGrade.key !== dispatchGrade.key;
    view.coldChainBroken = !!r.coldChainBroken;
  }
  return view;
}

/* What each choice is worth, so the UI can state both rather than making the
   player infer one. Refusing is not free and administering is not safe — if
   either were, there would be no decision. */
export function options(view, labCut) {
  const cut = Math.max(0, labCut | 0);
  const known = view.screened;
  const bad = known && (view.arrivedGrade.key === 'iatrogenic');

  return {
    administer: {
      label: 'ADMINISTER',
      pays: cut,
      /* 🔴 The lab is paid ON ADMINISTRATION, not on arrival. That is what
         gives refusal a price and stops "refuse everything" being free. */
      why: known
        ? (bad
          ? 'It is not a cure. Putting this into people is how a new strain gets out.'
          : 'Cleared by assay. Put it into people.')
        : 'You have not screened it. Whatever the drive did to this crate, it goes into people.',
      danger: bad || !known,
    },
    refuse: {
      label: 'REFUSE THE CRATE',
      pays: 0,
      forfeits: cut,
      why: bad
        ? 'Destroy it. Nobody is treated, the strain runs on, and you are not paid — and nothing comes out of this crate.'
        : 'Destroy it unopened. Nobody is treated and you are not paid.',
      danger: false,
    },
    screen: {
      label: 'RUN THE ASSAY',
      cost: screenCost(view.doses),
      why: 'Reads what actually arrived. The dispatch grade is what the shipper claimed before the drive.',
    },
  };
}

/* The line the ward prints about a carrier before the crate is opened. It is
   the only pre-screening signal and it is deliberately soft — a suspicion,
   never a verdict, or screening would be pointless. */
export function carrierNote(view) {
  if (view.suspicion === 'high') {
    return '⚠ ' + view.from + ' ran this at ' + Math.round(view.integrity * 100) +
      '% cold-chain integrity. Crates off this route have arrived spoiled.';
  }
  if (view.suspicion === 'some') {
    return '· ' + view.from + ' held ' + Math.round(view.integrity * 100) + '% integrity. Adequate, not cold.';
  }
  return '· ' + view.from + ' held ' + Math.round(view.integrity * 100) + '% integrity. A clean run.';
}
