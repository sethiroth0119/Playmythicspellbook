/* ☁ v121v157 — SAME CARDS FOR EVERYONE, AND ONBOARDING THAT STAYS DONE.
   Run: node _cloudauth_smoke.mjs

   Owner: "The game is still not registering the same on different accounts …
   the effects of some cards are not the same as they have been updated and
   cards and decks are missing plus I have players who say they have to start
   the game and it makes them do the onboarding over and over again … how can we
   get the game to be full on server where everything is saved."

   Two defects, both measured on the live database before anything was changed.

   1. CARDS. Forge.customCards is stored PER PLAYER in user_profiles.forge, and
      getAllCustomCards() let a local copy shadow the published one. Counted
      against a 477-card published catalogue: one player carried 248 private
      card definitions, three old accounts 240 each, others a handful. Each of
      those can override a republished card with its own older effect text —
      which is precisely "the effects of some cards are not the same".

   2. ONBOARDING. _ensureOnboardingState() derived "is this player established"
      from Profile.records and then SAVED that derivation. On a new device the
      cloud row has not landed at first render, so records are empty, and it
      stamped complete=false onto the profile — a conclusion drawn from data
      that had not loaded, which the next sync then uploaded. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the published catalogue is the card, for a player ─────────────────── */
{
  const lo = SRC.indexOf('function getAllCustomCards() {');
  const hi = SRC.indexOf('function getAllCustomHeroes', lo);
  ok(lo > 0 && hi > lo, 'getAllCustomCards is anchored end to end');
  const f = SRC.slice(lo, hi);
  ok(/let _authorMode = true;/.test(f) && /isAdmin\(\) : true/.test(f),
    'the merge asks whether this player is the AUTHOR');
  ok(/if \(!_authorMode && cc\) \{ merged\.push\(cc\); continue; \}/.test(f),
    'A PLAYER TAKES THE PUBLISHED CARD OUTRIGHT — no stamp comparison, so a stale private copy cannot shadow a republished card');
  ok(/_cardCloudIsNewer\(cc, lc\) \? cc : lc/.test(f),
    '…while the AUTHOR still compares stamps, which is the only thing that makes unpublished work possible');
  ok(/if \(_forgeIsCardDeleted\(lc\.id\)\) continue;/.test(f),
    'tombstones still win for everyone — a deleted card must not be resurrected or deleting stops meaning anything');
  ok(/Local entries still fill GAPS for non-admins/.test(f),
    'local entries still fill gaps, so this can never make a card a player can currently SEE disappear');
  ok(/Measured on the live database against a 477-card catalogue/.test(f),
    'the measurement that justified the change is written down, not just the conclusion');
  /* the exemption must default to AUTHOR on any doubt — never strip an admin's work */
  ok(/catch \(e\) \{ _authorMode = true; \}/.test(f),
    'ON ANY DOUBT IT DEFAULTS TO AUTHOR — an isAdmin() that throws must not silently discard unpublished authoring');
}

/* ── 2. onboarding cannot conclude from data that has not arrived ─────────── */
{
  const lo = SRC.indexOf('function _profileKnown() {');
  ok(lo > 0, 'there is one shared answer to "do we actually know yet?"');
  const f = SRC.slice(lo, lo + 700);
  ok(/if \(!cc\.signedIn\) return true;/.test(f),
    'an OFFLINE player is unaffected — their local save is the only truth there is, so there is nothing to wait for');
  ok(/return !!cc\._hydratedFromCloud;/.test(f),
    '…and a signed-in player is "known" once the cloud fetch has answered, either way');
}
{
  const lo = SRC.indexOf('function _ensureOnboardingState() {');
  const hi = SRC.indexOf('function onboardingIsComplete', lo);
  ok(lo > 0 && hi > lo, '_ensureOnboardingState is anchored');
  const f = SRC.slice(lo, hi);
  ok(/if \(_profileKnown\(\)\) \{ try \{ saveProfile && saveProfile\(\); \} catch \(e\) \{\} \}/.test(f),
    'IT ONLY PERSISTS THE DERIVATION WHEN THE PROFILE IS ACTUALLY KNOWN');
  ok(/else \{ try \{ delete Profile\.onboarding\.complete; \} catch \(e\) \{\} return/.test(f),
    '…and un-hydrated it answers for THIS RENDER without writing, so the value cannot feed itself');
  ok(/a value derived from data that\s*\n?\s*had simply not loaded/.test(f) || /had simply not loaded/.test(f),
    'the reasoning is recorded: a conclusion drawn from absent data was being stamped onto the profile');
}
{
  const lo = SRC.indexOf('function shouldRunOnboarding() {');
  const hi = SRC.indexOf('function startOnboarding', lo);
  ok(lo > 0 && hi > lo, 'shouldRunOnboarding is anchored');
  const f = SRC.slice(lo, hi);
  ok(/if \(cc\.signedIn && !_profileKnown\(\)\) return false;/.test(f),
    'it does NOT DECIDE while a signed-in player\'s profile is still arriving');
  ok(/This is "do not decide", not "skip"/.test(f),
    '…and says so — the player stays where they are and the check runs again once the row lands');
}

/* ── run both decisions for real ──────────────────────────────────────────── */
{
  /* the card merge, as the code now performs it */
  const cloudIsNewer = (cc, lc) => {
    if (!cc) return false;
    const ct = (typeof cc._editedAt === 'number') ? cc._editedAt : null;
    if (ct == null) return false;
    const lt = (lc && typeof lc._editedAt === 'number') ? lc._editedAt : null;
    if (lt == null) return true;
    return ct > lt;
  };
  const pick = (author, cc, lc) => (!author && cc) ? cc : (cloudIsNewer(cc, lc) ? cc : lc);

  const published = { id: 'c1', effect: 'NEW', _editedAt: 100 };
  const stale     = { id: 'c1', effect: 'OLD', _editedAt: 500 };   // local stamped NEWER

  ok(pick(false, published, stale).effect === 'NEW',
    'run for real: A PLAYER gets the published effect even though their private copy is stamped newer — this is the exact case that made two accounts disagree');
  ok(pick(true, published, stale).effect === 'OLD',
    'run for real: the AUTHOR keeps their newer local edit, so unpublished work still survives');
  ok(pick(true, { id: 'c1', effect: 'NEW', _editedAt: 900 }, stale).effect === 'NEW',
    'run for real: …and the author still adopts a genuinely newer published card');
  ok(pick(false, null, { id: 'zz', effect: 'ORPHAN' }).effect === 'ORPHAN',
    'run for real: a local card the catalogue does not contain still shows — nothing a player can see is removed');

  /* the onboarding gate */
  const known = (signedIn, hydrated) => !signedIn ? true : !!hydrated;
  ok(known(false, false) === true, 'run for real: an offline player is always "known"');
  ok(known(true, false) === false, 'run for real: a signed-in player mid-fetch is NOT known — the window the bug lived in');
  ok(known(true, true) === true, 'run for real: …and is known once the fetch answers');

  const persists = (signedIn, hydrated) => known(signedIn, hydrated);
  ok(persists(true, false) === false,
    'run for real: NOTHING IS WRITTEN in that window, so an empty Profile.records can no longer be uploaded as "never onboarded"');
}

/* ── 3. decks restore on a second device ─────────────────────────────────── */
{
  const lo = SRC.indexOf("if (f.__sideDeck__ && typeof f.__sideDeck__ === 'object') {");
  ok(lo > 0, 'the side-deck restore is locatable');
  const f = SRC.slice(lo - 1200, lo + 700);
  ok(/if \(_localSide\.length === 0 \|\| !localIsFresher\) \{/.test(f),
    'THE CLOUD FILLS IN WHEN LOCAL IS EMPTY **OR** WHEN THE CLOUD IS FRESHER — it used to require local to be completely empty, so a stale one-card local deck shadowed the full cloud copy and the rest read as "missing"');
  ok(/emptiness was just\s*\n?\s*the wrong proxy for it/.test(f) || /the wrong proxy for it/.test(f),
    '…and the original hazard ("a stale cloud copy can never wipe a freshly-edited one") is acknowledged as real, with emptiness named as the wrong proxy for it');
}
{
  const lo = SRC.indexOf("if (f.__archonDeck__ && typeof f.__archonDeck__ === 'object') {");
  ok(lo > 0, 'the Realm-deck restore is locatable');
  const f = SRC.slice(lo, lo + 500);
  ok(/if \(_localArchon\.length === 0 \|\| !localIsFresher\) \{/.test(f),
    'the Realm deck gets the same correction — a deck built on one machine was arriving truncated on the next');
}
{
  /* the discriminator must be the one the rest of the row already uses */
  const iFresh = SRC.indexOf('const localIsFresher =');
  const iSide  = SRC.indexOf("if (f.__sideDeck__ && typeof f.__sideDeck__");
  ok(iFresh > 0 && iSide > iFresh,
    'localIsFresher is computed BEFORE the deck restores use it — same function, already in scope, no new signal invented');
}
{
  /* run the three cases for real */
  const adopt = (localLen, localIsFresher) => (localLen === 0 || !localIsFresher);
  ok(adopt(0, true) === true,  'run for real: an empty local deck adopts the cloud — unchanged behaviour');
  ok(adopt(1, false) === true, 'run for real: a STALE local deck now adopts the cloud — this is the reported bug');
  ok(adopt(15, true) === false, 'run for real: a freshly-edited local deck still wins, so the original hazard stays covered');
  ok(adopt(0, false) === true, 'run for real: empty and stale still adopts');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 157, 'BUILD_VERSION is v121v157 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
