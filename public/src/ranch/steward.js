/* ══════════════════════════════════════════════════════════════════════════
   🎖 THE QUARTERMASTER — one line, on the way in.
   ──────────────────────────────────────────────────────────────────────────
   PURE LOGIC. No DOM, no globals, no imports. The host hands in a roster and
   gets back at most one line; the host shows it. (CLAUDE.md's globals trap:
   `Profile`, `showToast` are top-level declarations in index.html and an ES
   module cannot see them.)

   🔴 WHY THIS EXISTS
   Monster Rancher's ranch is warm largely because somebody is standing in it
   telling you things — Colt notices the monster is tired before you open a
   single menu. This camp already tracks trauma, corruption, fatigue, morale,
   refusals, open requests and queued banter across the whole roster, and
   surfaces all of it only if you go looking, one unit at a time. A roster of
   twenty means the one companion who is actually in trouble is invisible.

   ⚖ IT REPORTS, IT NEVER NAGS. Three rules keep it a voice rather than a
   notification system:
     1. ONE line, about ONE companion — the single most actionable thing.
     2. Actionable outranks atmospheric. A unit refusing to deploy or an open
        request you can fill TODAY beats low morale, because the player can do
        something about it right now. A steward who leads with mood while a
        companion is on strike is decoration.
     3. It repeats neither the companion nor the subject it raised last time
        (see `shouldSpeak`), so walking in and out of camp does not turn it
        into a stuck alarm. Nothing worth saying → it says nothing.
   ══════════════════════════════════════════════════════════════════════════ */

export const SPEAKER = '🎖 Quartermaster';

/* A floor between remarks, so re-entering camp four times in a minute does
   not produce four lines even when the SUBJECT legitimately changed. */
export const QUIET_MS = 30 * 60 * 1000;

/* Thresholds. Deliberately HIGHER than the Table's own greeting cut-offs:
   the Table is showing you one companion you already chose to look at, so it
   can mention a mild problem. This interrupts you about the whole roster and
   should only do so when something is genuinely wrong. */
export const T = { trauma: 45, corruption: 45, fatigue: 65, morale: 30 };

/* Ordered best-first. The first matching topic for the first matching unit
   wins outright — that ordering IS the design (see rule 2 above). */
export const TOPICS = [
  { k: 'refuse',  test: u => !!u.prof.refuseDeploy,
    line: n => `${n} won't take the field. Says it's how you've been fighting — you'll want to settle that with them.` },
  { k: 'request', test: u => !!(u.prof.request && u.hasRequested),
    line: (n, u) => `${n} has been asking after ${u.requestName}. You're carrying one.` },
  { k: 'banter',  test: u => !!u.prof._banter,
    line: n => `${n} has been waiting to speak with you.` },
  { k: 'corruption', test: u => (u.prof.corruption || 0) >= T.corruption,
    line: n => `Something followed ${n} back. It's under the skin, and it isn't getting better on its own.` },
  { k: 'trauma',  test: u => (u.prof.trauma || 0) >= T.trauma,
    line: n => `${n} isn't sleeping. Whatever they saw out there is still with them.` },
  { k: 'fatigue', test: u => (u.prof.fatigue || 0) >= T.fatigue,
    line: n => `${n} is running on nothing. Push them much further and they'll break.` },
  { k: 'morale',  test: u => (u.prof.morale != null ? u.prof.morale : 80) <= T.morale,
    line: n => `${n}'s spirits are on the floor. A word from you would go further than you'd think.` },
  { k: 'gift',    test: u => !!u.giftReady,
    line: (n, u) => `You've ${u.giftName} sitting in the stores. ${n} would be glad of it.` },
  /* The warm one, and the reason the list does not end at 'morale'. A camp
     where the quartermaster only ever speaks to deliver bad news teaches the
     player to dread the line. This fires when the roster is genuinely fine. */
  { k: 'well',    test: u => u.isBest && (u.prof.together | 0) >= 10,
    line: n => `${n} asked after you. That's all — just asked.` },
];

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* How badly off a unit is, for ordering WITHIN a topic — two companions can
   both be traumatised and the worse one should be the one named. */
export function severity(prof) {
  const p = prof || {};
  return num(p.trauma) + num(p.corruption) + num(p.fatigue)
       + Math.max(0, 80 - (p.morale != null ? num(p.morale) : 80))
       + (p.refuseDeploy ? 200 : 0);
}

/**
 * Pick the one thing worth saying. PURE.
 * @param {Array} roster [{ id, name, prof, hasRequested, requestName, giftReady, giftName }]
 * @returns {{id, name, kind, text}|null}
 */
export function pick(roster) {
  const list = (Array.isArray(roster) ? roster : []).filter(u => u && u.id && u.prof);
  if (!list.length) return null;

  // `isBest` drives the warm topic only, and is resolved here rather than by
  // the host so the caller cannot accidentally mark two.
  let best = null;
  for (const u of list) if (!best || (u.prof.bond | 0) > (best.prof.bond | 0)) best = u;
  for (const u of list) u.isBest = (u === best);

  for (const t of TOPICS) {
    const hits = list.filter(u => { try { return t.test(u); } catch (e) { return false; } });
    if (!hits.length) continue;
    // Worst first within the topic; ties break on id so the same roster always
    // produces the same line rather than flickering between two equals.
    hits.sort((a, b) => (severity(b.prof) - severity(a.prof)) || String(a.id).localeCompare(String(b.id)));
    const u = hits[0];
    return { id: u.id, name: u.name, kind: t.k, text: t.line(u.name, u) };
  }
  return null;
}

/**
 * Should this remark actually be spoken? Compares against what was said last.
 * @param {object} sel   the pick() result
 * @param {object} last  { id, kind, at } from the profile, or null
 * @returns {boolean}
 */
export function shouldSpeak(sel, last, now) {
  if (!sel) return false;
  const L = last || {};
  const n = num(now) || Date.now();
  const at = num(L.at);
  /* Same companion AND same subject as last time → stay quiet, however long
     it has been. The player heard it; repeating it is nagging, and the
     condition itself is still visible on the camp row and at the Table.
     ⚠ Checked BEFORE the quiet window, not after: a stuck condition would
       otherwise start repeating every 30 minutes forever, which is the exact
       failure this guard exists to prevent. */
  if (L.id === sel.id && L.kind === sel.kind) return false;
  // A future-dated stamp (clock skew, a doctored save) must not mute the
  // quartermaster permanently.
  if (at > 0 && at <= n && (n - at) < QUIET_MS) return false;
  return true;
}

/** The rendered remark, speaker included. */
export function say(sel) {
  return sel ? `${SPEAKER}: “${sel.text}”` : '';
}
