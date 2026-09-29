/* 🧹 FOUR OPEN REPORTS, FOUR DIFFERENT SHAPES OF WRONG.

   1. 🛡 "I upgraded defense to level 10 and actually paid for level 10, three
      times, before realising I was paying for the same level. The Reinforce
      button should not be active at level 10."
      Both halves were true, and the cause is that ONE ACTION HAS TWO
      IMPLEMENTATIONS. campFortify() refuses at CAMP_DEFENSE_MAX and says so.
      The Camp Workshop's own button did not: it spent the resources FIRST and
      clamped AFTERWARDS, so at the cap it took the metal and the supplies and
      moved nothing.

   2. 🤝 "If somebody signs up but doesn't use your referral link, if you
      manually enter their code into your referral page, the function is then
      blocked — you are unable to refer any more people."
      ⚠ THE SECOND HALF DID NOT HAPPEN and the fix must not pretend it did.
      Their own code is printed at the top of that panel and keeps working;
      referring is unaffected. The box records who invited THEM, once, and
      irreversibly — and sitting under their own referral stats it read as
      "credit a referral I made". The defect is that it never said which
      direction it ran until after it had run.

   3. ♻️ "Both the transport company and trash crusher have the same name in the
      Operations menu — 'Haulage Board' — and both open the Haulage Board; the
      Trash Crusher mini-game isn't available."
      ⚠ THE DESTINATION IS CORRECT AND STAYS. shell.jsx records the reason: the
      crusher POSTS a scrap run and a player-owned Transport Depot takes it,
      "one screen, two businesses, opposite sides of the same contract". There
      is no Trash Crusher mini-game to be missing. Two rows sharing one name is
      the real defect.

   4. 🎴 "10 card hunts in a row, now 9 of 11 returned the exact same card."
      ⚠ THE ROLL WAS ALREADY FAIR — a flat pick. The POOL is small, invisible to
      the player, and each hunt costs twelve hours of real waiting, so a run of
      repeats reads as a broken generator. Fixed by never repeating the previous
      card WHEN THERE IS SOMETHING ELSE TO GIVE, and by saying so when there is
      not — rather than by touching odds that were not wrong.

   Run: node _openfour_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const IDX = readFileSync('./public/index.html', 'utf8');
const SHELL = readFileSync('./public/corp/shell.jsx', 'utf8');

/* ── 1. THE CAP IS ENFORCED WHERE THE SPEND HAPPENS ──────────────────────── */
{
  ok(/const CAMP_DEFENSE_MAX = 10;/.test(IDX), 'there is one authority for the cap');
  ok(!/Profile\.campDefense = Math\.min\(10, \(Profile\.campDefense \| 0\) \+ 1\);/.test(IDX),
    'the workshop no longer repeats the literal 10 — a cap written twice is a cap that drifts');
  const guard = /if \(\(Profile\.campDefense \| 0\) >= CAMP_DEFENSE_MAX\) \{[\s\S]{0,200}?return;\s*\}\s*if \(!spendResources\(defCost\)\) return;/.test(IDX);
  ok(guard, 'and it REFUSES BEFORE IT SPENDS — the order is the whole bug');
  ok(/nothing was spent/.test(IDX), 'and says nothing was taken, because the complaint was being charged');
  ok(/const defMaxed = def >= CAMP_DEFENSE_MAX;/.test(IDX), 'the button knows it is maxed');
  ok(/defMaxed \? '🛡 Maximum' : '🔧 Reinforce', !defMaxed && can\(defCost\)/.test(IDX),
    'so it is disabled and relabelled rather than looking available');
  /* The other implementation must still guard — this fix is about making the
     two agree, not about moving the guard from one to the other. */
  ok(/if \(lv >= CAMP_DEFENSE_MAX\) \{ showToast\('🛡 Defenses already at maximum/.test(IDX),
    'campFortify(), the OTHER implementation, still refuses at the cap as it always did');
}

/* ── 2. THE REFERRAL BOX SAYS WHICH WAY IT RUNS ──────────────────────────── */
{
  ok(/WERE YOU INVITED BY SOMEONE\?/.test(IDX), 'the redeem box names its direction before it is used');
  ok(/This is <b>not<\/b> how you claim someone you invited/.test(IDX),
    'and rules out the misreading that produced the report');
  ok(/You can only do this <b>once<\/b>, and it cannot be undone/.test(IDX),
    'and warns that it is irreversible — it is, and it was not said anywhere');
  ok(/that recorded who invited <b>you<\/b>\. Your own code above still works/.test(IDX),
    'afterwards it states plainly that referring others is unaffected — the half of the report that was not true');
  ok(/id="prof-ref-copy"/.test(IDX) && /id="prof-ref-link"/.test(IDX),
    'and the player\'s own code and invite link are still there, because they never stopped working');
}

/* ── 3. TWO ROWS, TWO NAMES, SAME CORRECT DOOR ───────────────────────────── */
{
  const rows = SHELL.match(/label: '[^']*',\s*ico: '[^']*', action: 'openHaulBoard'/g) || [];
  ok(rows.length === 2, 'two operations open the haulage board', String(rows.length));
  const labels = (SHELL.match(/label: '([^']*)',\s*ico: '[^']*', action: 'openHaulBoard'/g) || [])
    .map(r => /label: '([^']*)'/.exec(r)[1]);
  ok(new Set(labels).size === 2, 'and they no longer share a name', labels.join(' | '));
  ok(labels.includes('Haulage Board'), 'the Transportation Company keeps the board\'s own name', labels.join(' | '));
  /* v121v117 (owner): the crusher's FIRST door is its own mini-game, the Foundry; posting a scrap
     run to the shared board is the second door, so the design above still holds. */
  ok(/\{ label: 'Post a Scrap Run',\s+ico: '🚛', action: 'openHaulBoard' \}/.test(SHELL.slice(SHELL.indexOf('trashcrusher: ['), SHELL.indexOf('trashcrusher: [') + 400)),
    'and the crusher\'s scrap-run row says what the crusher does there');
  ok(/\{ label: 'Trash Crusher',\s+ico: '🗜️', action: 'openFoundry' \}/.test(SHELL.slice(SHELL.indexOf('trashcrusher: ['), SHELL.indexOf('trashcrusher: [') + 400)),
    'the crusher\'s own mini-game (the Foundry) is the first door; the board stays the second');
}

/* ── 4. THE HUNT STOPS HANDING BACK THE SAME CARD ────────────────────────── */
{
  ok(/const lastId = \(\(\) => \{ try \{ return String\(Profile\.lastHuntCard \|\| ''\); \}/.test(IDX),
    'the hunt remembers what it gave last time');
  ok(/const fresh = pool\.length > 1 \? pool\.filter\(c => c && c\.id !== lastId\) : pool;/.test(IDX),
    'and excludes it — but only when the pool has something else in it');
  ok(/const from = fresh\.length \? fresh : pool;/.test(IDX),
    'never leaving itself with nothing to draw from');
  ok(/Profile\.lastHuntCard = String\(pick\.id \|\| ''\);/.test(IDX), 'and records the new one');
  ok(/const onlyOne = pool\.length === 1;/.test(IDX) && /the only card currently eligible for a hunt/.test(IDX),
    'a one-card pool is explained rather than left looking broken — the roll was never the problem');
  /* ⚠ SCOPED TO THE HUNT'S OWN BLOCK. `pool[Math.floor(Math.random() * pool.length)]`
     is a plain idiom this file uses in about ten unrelated places, so asserting
     it is absent from the whole document tests other features, not this one. */
  const hunt = (() => {
    const i = IDX.indexOf("} else if (m.missionId === 'cv_cardhunt') {");
    return i < 0 ? '' : IDX.slice(i, i + 4000);
  })();
  ok(!!hunt, 'found the Card Hunt block');
  ok(!/pool\[Math\.floor\(Math\.random\(\) \* pool\.length\)\]/.test(hunt),
    'the hunt no longer draws straight from the unfiltered pool');
  ok(/from\[Math\.floor\(Math\.random\(\) \* from\.length\)\]/.test(hunt),
    'it draws from the filtered list — still a flat pick, because the odds were never the bug');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
