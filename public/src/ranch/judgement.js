/* ══════════════════════════════════════════════════════════════════════════
   👏 JUDGEMENT — praise, silence, scold.        ranch / piece: the missing verb
   ──────────────────────────────────────────────────────────────────────────
   PURE LOGIC. No DOM, no globals, no imports. Everything is a function of its
   arguments (CLAUDE.md's globals trap: `Profile`, `App`, `adjustBond` are
   top-level `const`/`function` in index.html and an ES module cannot see them).
   The caller hands in a plain profile entry and applies the returned deltas
   through the game's OWN `adjustBond()` — see WHY below.

   🔴 WHAT THIS FIXES
   The banter dialog already had the hard part: after a battle a companion
   speaks to the value your tactics touched (`_lqValuesEval` → `p._banter`).
   But the player's only reply was ONE button — "…I hear you". The unit spoke
   and nothing came back. Monster Rancher's entire loop is the other half of
   that exchange: the monster does a thing, and *you judge it*. That judgement
   is what makes the relationship two-directional instead of a readout.

   🔴 THE THREE BUTTONS MEAN ONE THING, NOT TWO
   It is tempting to read Praise as "well done" and Scold as "badly done" —
   but the unit is not reporting a result here, it is stating an OPINION
   ("a blade in the back is still a coward's blade"). So the axis is:

       praise  = I endorse what you believe.   bond ↑   conviction ↑
       silence = I am not going to discuss it.  bond ↓ a little
       scold   = you are wrong to believe it.  bond ↓↓  conviction ↓

   That holds identically whether the unit APPROVED or OPPOSED the battle,
   which is what makes it teachable in one sentence. The verdict only changes
   the button WORDING (`labels()`) and the size of the numbers — praising a
   unit that is already pleased is cheap agreement; conceding to one that is
   aggrieved costs you nothing today and locks the conflict in for good.

   ⚖ THE ACTUAL DECISION (this is the design, the rest is bookkeeping)
   Scolding is the ONLY way to soften a value you cannot live with. A Zealous
   unit whose pole your whole deck violates accrues grievance until it sets
   `refuseDeploy` and stops fighting for you. Overruling discharges that
   grievance AND grinds the conviction down so it re-accrues at half speed —
   but it is paid for in loyalty, and loyalty is the XP multiplier (up to 2.0×
   at Sworn) and the gate on how much of itself the companion will show you.
   Praise is the reverse trade: instant warmth, grievance eased, and the value
   HARDENS, so every future battle that offends it hits up to 1.5× as hard.
   Neither is the "good" button. That is the point.

   🔴 WHY THIS FILE DOES NOT MULTIPLY BY temper.gain / temper.loss
   `adjustBond()` (index.html) already scales EVERY bond change in the game by
   the unit's temperament, at one choke point, deliberately. If this file also
   applied gain/loss the multiplier would land twice and a Vain unit would
   take a 2.25× scolding. `TEMPER_JUDGE` below is a SECOND, DIFFERENT axis —
   how much a unit cares about being spoken to at all, as opposed to how it
   weighs what you did. A Stoic barely registers either word; a Guarded unit
   discounts praise specifically (it has been flattered before) while taking a
   rebuke at full weight. Multiplied together with adjustBond's own factor,
   that is intended: words land differently than deeds.
   ══════════════════════════════════════════════════════════════════════════ */

export const CHOICES = ['praise', 'silence', 'scold'];

/* Conviction is bounded hard and symmetrically. ±12 with the /24 divisor puts
   the reaction multiplier in 0.50 … 1.50 and no further: a companion can be
   talked into caring half again as much, or half as much, and never into
   caring nothing at all. An unbounded version lets a patient player delete a
   unit's personality entirely, which is the anti-pattern — the values ARE the
   character, and a character you can zero out is a stat, not a person. */
export const CONVICTION_CAP = 12;
export const CONVICTION_DIVISOR = 24;

/* Base deltas, BEFORE temperament (both multipliers) is applied.
   `bond` feeds adjustBond(); `grief` adds to the same grievance counter
   `_lqValuesEval` maintains; `conv` moves the pole's conviction.
   ⚠ THE OPPOSE ROW IS NOT THE APPROVE ROW WITH SIGNS FLIPPED, and the
     grievance column is where that matters. BOTH replies to an aggrieved unit
     discharge grievance, because both are the argument actually happening —
     they just bill it differently:

       concede  −4 grievance, +3 conviction  → cheap now, dearer every battle
       overrule −10 grievance, −4 conviction → expensive now, cheaper forever

     Conceding is the pressure valve. Overruling is the ONLY tool that both
     clears a refuseDeploy AND softens the pole that caused it, and it is
     priced accordingly: −15 before temperament, which on a Vain companion is
     −21 and a dropped bond tier.

     🔴 THIS WAS +5 AND IT WAS WRONG. Scolding used to ADD grievance on the
     theory that resentment should get worse before it gets better. Driven
     against a Zealous refuser it meant the player could press Overrule five
     times, lose 155 loyalty, and watch `refuseDeploy` stay true the entire
     time — the button the design calls "how you break the spiral" did nothing
     but bleed. A cost with no mechanism attached is not a hard choice, it is a
     dead button. The loyalty hit is the price; the grievance discharge is what
     is being bought.

   ⚠ Scolding a unit that APPROVED still ADDS grievance (+2) — there was no
     argument to settle, so you are manufacturing one. Same button, opposite
     sign, because the unit's state is what differs. */
export const DELTAS = {
  approve: {
    praise:  { bond:  12, conv:  2, grief:   0 },
    silence: { bond:  -1, conv:  0, grief:   0 },
    scold:   { bond: -13, conv: -3, grief:   2 },
  },
  oppose: {
    praise:  { bond:   9, conv:  3, grief:  -4 },
    silence: { bond:  -3, conv:  0, grief:   1 },
    scold:   { bond: -15, conv: -4, grief: -10 },
  },
};

/* How much a temperament cares about WORDS. See the header for why this is a
   separate axis from temper.gain / temper.loss and why stacking is correct. */
export const TEMPER_JUDGE = {
  stoic:    { praise: 0.60, scold: 0.60 },   // takes the long view; a sentence is a sentence
  ardent:   { praise: 1.30, scold: 1.20 },
  guarded:  { praise: 0.50, scold: 1.00 },   // has been flattered before. Rebukes still land.
  vain:     { praise: 1.40, scold: 1.40 },   // wants the credit, remembers the slight
  devout:   { praise: 1.00, scold: 0.50 },   // decided about you early
  grim:     { praise: 0.70, scold: 0.80 },   // expects the worst, so hearing it costs little
  kindly:   { praise: 1.10, scold: 1.25 },   // holds the squad together; a rebuke stings
  restless: { praise: 1.00, scold: 1.00 },
};
const DEFAULT_JUDGE = { praise: 1, scold: 1 };

/* The reply. This is the payoff for the whole feature: you press a button and
   the companion ANSWERS, in its own voice, about being judged — not about the
   battle, which it already said its piece on. Keyed by temperament so the same
   press reads differently across the roster. Two lines each so a player who
   drills the same unit does not hear a recording. */
export const REPLIES = {
  stoic: {
    praise:  ['Noted.', 'You did not have to say it. But it is on the record now.'],
    silence: ['…', 'We understand each other well enough.'],
    scold:   ['You are the commander. I have been wrong before.', 'I will hold my tongue. I will not change my mind.'],
  },
  ardent: {
    praise:  ['THAT is what I wanted to hear. Point me at the next one.', 'You mean it? Then I will burn twice as bright.'],
    silence: ['Nothing? After all that?', 'Say something. Anything.'],
    scold:   ['So I am the problem now.', 'Fine. FINE. I heard you.'],
  },
  guarded: {
    praise:  ['Words are cheap. Show me at the next fight.', 'Everyone says the right thing. Not everyone means it.'],
    silence: ['That is the answer I expected.', 'As you like.'],
    scold:   ['There it is. I was waiting for it.', 'I knew this was coming eventually. They all do it.'],
  },
  vain: {
    praise:  ['Finally. Someone with sense.', 'Say it again where the others can hear.'],
    silence: ['Not even a word? After what I did out there?', 'Everyone saw. YOU saw. And nothing.'],
    scold:   ['In front of the others. Wonderful.', 'You will regret speaking to me like that.'],
  },
  devout: {
    praise:  ['I serve. That you noticed is more than I asked.', 'Then I was right to follow you.'],
    silence: ['I need no answer. I know my place.', 'It is enough that you heard it.'],
    scold:   ['Then I was wrong, and I thank you for the correction.', 'I will carry it differently. You have my word.'],
  },
  grim: {
    praise:  ['Do not waste kindness on me. Spend it on someone who will live.', 'Hm. That is new.'],
    silence: ['Sensible. There is nothing to say.', 'Good. Talking never buried anyone.'],
    scold:   ['I have heard worse from better.', 'You are not wrong. That is the irritating part.'],
  },
  kindly: {
    praise:  ['Thank you. I will tell the others you said so.', 'That will keep me warm through a cold march.'],
    silence: ['All right. You have a lot on you.', 'When you are ready to talk, I am here.'],
    scold:   ['…I am sorry. I thought I was helping.', 'I did not mean to make things harder for you.'],
  },
  restless: {
    praise:  ['Great — so put me back out there.', 'Talk later. Deploy me now.'],
    silence: ['Are we done? Because I am not.', 'Standing here is worse than the fight was.'],
    scold:   ['Then let me fix it in the field, not in a tent.', 'Yell at me on the way out.'],
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Button wording. The MECHANIC is identical across verdicts (see header) —
 *  only the wording moves, because "praise" is the wrong English word for
 *  agreeing with a companion who has just complained at you. */
export function labels(verdict) {
  return (verdict === 'oppose')
    ? { praise: '👏 Concede the point', silence: '— Say nothing', scold: '⚠ Overrule them' }
    : { praise: '👏 Praise them',       silence: '— Say nothing', scold: '⚠ Scold them' };
}

/** Read a pole's conviction off a profile entry. Absent-tolerant by
 *  construction — this project has shipped silent save bugs three times, so a
 *  missing / string / NaN / hand-edited `conviction` reads as 0, never throws. */
export function convictionOf(entry, pole) {
  try {
    const c = entry && entry.conviction;
    if (!c || typeof c !== 'object') return 0;
    return clamp(Math.round(num(c[pole])), -CONVICTION_CAP, CONVICTION_CAP);
  } catch (e) { return 0; }
}

/** 0.50 … 1.50. What index.html scales LQ_INTENSITY by when this unit's pole
 *  reacts to a battle. Exactly 1 when nothing has been said, so a roster that
 *  never uses the feature behaves precisely as it did before. */
export function convictionMul(entry, pole) {
  return 1 + (convictionOf(entry, pole) / CONVICTION_DIVISOR);
}

/**
 * Resolve one judgement. PURE — reads its arguments, writes nothing.
 * The caller applies `bond` through adjustBond() (never by assignment: the
 * bond ceiling and temperament live in there) and persists the rest.
 *
 * @param {object} o
 * @param {string} o.choice   'praise' | 'silence' | 'scold'
 * @param {string} o.verdict  'approve' | 'oppose' — what the unit said
 * @param {string} o.pole     the value pole it spoke about
 * @param {string} o.temperId unit temperament id
 * @param {number} o.conviction current conviction on that pole
 * @param {number} o.seed     any integer — picks which of the two replies
 * @returns {{ok, choice, pole, bond, grief, conviction, convictionNext, mul, line, tone}}
 */
export function resolve(o) {
  o = o || {};
  const choice = CHOICES.indexOf(o.choice) >= 0 ? o.choice : 'silence';
  const verdict = (o.verdict === 'oppose') ? 'oppose' : 'approve';
  const base = DELTAS[verdict][choice];
  const tj = TEMPER_JUDGE[o.temperId] || DEFAULT_JUDGE;
  // Silence is not scaled: being ignored is being ignored, and a temperament
  // multiplier on a −1 rounds it to −1 or −2 with no signal in the difference.
  const mul = choice === 'praise' ? tj.praise : choice === 'scold' ? tj.scold : 1;

  // Never let a multiplier round a real change away to nothing — the same rule
  // adjustBond() enforces, for the same reason: a 0.5× on a −13 should soften
  // the rebuke, not delete it.
  let bond = base.bond * mul;
  bond = bond > 0 ? Math.max(1, Math.round(bond)) : bond < 0 ? Math.min(-1, Math.round(bond)) : 0;

  const cur = clamp(Math.round(num(o.conviction)), -CONVICTION_CAP, CONVICTION_CAP);
  const next = clamp(cur + base.conv, -CONVICTION_CAP, CONVICTION_CAP);

  const pool = (REPLIES[o.temperId] && REPLIES[o.temperId][choice]) || REPLIES.stoic[choice];
  const line = pool[Math.abs(o.seed | 0) % pool.length];

  return {
    ok: true,
    choice, verdict, pole: o.pole || null,
    bond,
    grief: base.grief,
    conviction: next - cur,          // what actually landed after the cap
    convictionNext: next,
    mul,
    line,
    tone: choice === 'praise' ? 'warm' : choice === 'scold' ? 'cold' : 'flat',
  };
}

/** One sentence describing what the conviction shift MEANS, for the toast.
 *  Silent when nothing moved (at the cap, or on a silence) rather than
 *  printing "conviction +0", which reads as a bug. */
export function convictionNote(res, poleLabel) {
  if (!res || !res.conviction) return '';
  const up = res.conviction > 0;
  const p = poleLabel || 'that conviction';
  return up
    ? `${p} hardens — they will feel it more sharply next time.`
    : `${p} softens — they will not take it as hard from now on.`;
}
