/* 🔒 A CARD WITH NO WAY IN DOES NOT GET IN.  Run: node _cardgate_smoke.mjs
   ═══════════════════════════════════════════════════════════════════════════
   Owner: "players are obtaining cards they should not get meaning they cannot
   get them at all not from card haunt not from resource runs, loot drops etc."

   🔴 TWO HOLES, MEASURED ON THE LIVE CATALOGUE BEFORE THE FIX.

   1. THE FLAG WAS IN THE DATA AND NOTHING READ IT. An obtainability rule is
      { craftable, lootable, adminOnly, unreleased }. Only the last two were
      ever enforced. A card set craftable:false + lootable:false +
      adminOnly:false is unobtainable BY DESIGN and was refused by nothing —
      it is neither admin-only nor unreleased, so it passed every grant path.
      38 cards were in that state, held by 82 players across 351 copies, and
      every one of the 38 was in circulation. Packs are the likeliest route:
      they carry filter + weights and NO explicit card list, so pack contents
      are rolled from a filtered pool, and that pool was filtered on the two
      flags that did not cover this.

   2. BUYING A CARD LAUNDERED IT. The market mints the bought copy a fresh id,
      'cc_bought_<ts>_<rand>'. Obtainability is keyed 'card:<id>', so the copy
      matched no rule and every check answered "allow" for it forever. A
      restricted card became unrestricted by being sold. Only 7 such copies
      existed, which measures how long it had been quiet rather than how bad it
      was: it converts one leaked card into an unlimited supply.

   ⚠ §3 ASSERTS THE SEAM, NOT THE OUTCOME. The market path must CALL the shared
     predicate — not reproduce the rule. A test on the outcome passes the day
     someone re-implements the check inline and it drifts; grantCard's own
     header records that this rule was once enforced at 4 of 39 sites, which is
     exactly what inline copies produce.

   ⚠ §5 IS A NEGATIVE CONTROL. It mutates the shipped predicate and requires the
     locked-card check to fail. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

function fnText(name, src) {
  const s = src || SRC;
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, started = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return s.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* Drive the real predicate against a stubbed obtainability table. */
function buildPredicate(src) {
  const rules = Object.create(null);
  const env = {
    isForgeAdminOnly: (kind, id) => !!(rules[id] && rules[id].adminOnly),
    isCardReleased:   (id) => !(rules[id] && rules[id].unreleased),
    getForgeObt:      (kind, id) => Object.assign({ craftable: true, lootable: true, adminOnly: false }, rules[id] || {}),
  };
  const fn = new Function(...Object.keys(env),
    fnText('cardGrantRefusalReason', src) + '\nreturn cardGrantRefusalReason;')(...Object.values(env));
  return { fn, rules };
}

console.log('\n=== 1. the predicate exists and is the single rule ===');
{
  ok(/function cardGrantRefusalReason\(/.test(SRC), 'cardGrantRefusalReason is defined');
  const g = fnText('grantCard');
  /* ⚠ THE ARGUMENT LIST IS NOT THE RULE. This read `cardGrantRefusalReason(id)`
     and went red the day grantCard started forwarding its options —
     `cardGrantRefusalReason(id, o)` — while the seam it protects was untouched.
     A check that fails on a signature change and passes on a re-implementation
     is the wrong way round, so it matches the CALL and the next check asserts
     the thing the extra argument was added for. */
  ok(/cardGrantRefusalReason\(id[,)]/.test(g), 'grantCard asks it');
  ok(/cardGrantRefusalReason\(id,\s*o\)/.test(g),
    '…and hands over its options, so a caller holding a server-issued serial can say so');
  ok(!/isForgeAdminOnly\('card', id\)/.test(g), '…and no longer carries its own copy of the admin-only test');
  ok(!/isCardReleased\(id\)/.test(g), '…or its own copy of the release test');
}

console.log('\n=== 2. what it refuses, run for real ===');
{
  const { fn, rules } = buildPredicate();
  rules.plain = {};
  ok(fn('plain') === null, 'a card with no rule at all is allowed (default is obtainable)');
  rules.lootOnly = { craftable: false, lootable: true };
  ok(fn('lootOnly') === null, 'lootable-but-not-craftable is allowed');
  rules.craftOnly = { craftable: true, lootable: false };
  ok(fn('craftOnly') === null, 'craftable-but-not-lootable is allowed');
  rules.locked = { craftable: false, lootable: false, adminOnly: false };
  ok(fn('locked') === 'no obtainment route', 'THE BUG: no craft, no loot, not admin-only → refused', String(fn('locked')));
  rules.adm = { adminOnly: true };
  ok(fn('adm') === 'admin-only', 'admin-only is still refused, with its own reason');
  rules.unrel = { unreleased: true };
  ok(fn('unrel') === 'unreleased', 'unreleased is still refused, with its own reason');
  ok(fn('') === 'no id' && fn(null) === 'no id', 'a missing id is refused rather than allowed');
}

console.log('\n=== 3. THE SEAM — every gate calls the predicate ===');
{
  const pool = fnText('playerObtainablePool');
  ok(/cardGrantRefusalReason\(cid\) === null/.test(pool),
    'playerObtainablePool asks the predicate — this is what stands between a locked card and a booster pack');
  ok(!/isCardReleased\(cid\)/.test(pool), '…and no longer carries its own release test to drift from it');

  /* The market is the path that was walking past grantCard entirely.
     ⚠ THIS USED TO READ THE 1,400 BYTES BEFORE THE MINT LINE, and that window
       is not a fact about the code — it is a guess about how far apart two
       statements sit. The serialized-card branch landed between them and pushed
       the predicate call out of the window, so the check went red against a file
       where the rule was intact and enforced in one more place than before.
       Reading the whole FUNCTION and comparing positions asserts the same thing
       — the test happens first — without caring how much is written between. */
  const gp = fnText('_cmGrantPurchase');
  const iMint = gp.indexOf("const copy = { ...snap, id: 'cc_bought_'");
  const iAsk  = gp.indexOf('cardGrantRefusalReason(_srcId)');
  ok(iMint > 0, 'the cloud market purchase path is findable');
  ok(iAsk > 0 && iAsk < iMint, 'the market checks the predicate BEFORE minting the copy');
  ok(/const _srcId = snap && snap\.id;/.test(gp.slice(0, iMint)),
    '…against the SOURCE card id, not the minted one — the minted id matches no rule by construction');
  /* ⚠ AND THE REFUSAL HAS TO BE A REFUSAL. This read `/return;/` over the same
     1,400-byte window, which any `return;` anywhere nearby satisfied — it could
     not tell "refuse and stop" from "log it and carry on". Tied to the branch
     now: the bail-out must sit inside the `if (_why)` block and before the
     mint. */
  const iWhy = gp.indexOf('if (_why) {');
  const iRet = gp.indexOf('return;', iWhy);
  ok(iWhy > 0 && iRet > iWhy && iRet < iMint,
    '…and returns without granting when it is refused — the bail-out is inside the refusal branch, ahead of the mint');
}

console.log('\n=== 4. the rules that were already enforced still are ===');
{
  const g = fnText('grantCard');
  ok(/if \(!o\.adminGrant\)/.test(g), 'an explicit adminGrant still bypasses every check');
  ok(/Profile\.cardCollection\[id\] = \(Profile\.cardCollection\[id\] \| 0\) \+ n;/.test(g),
    'the grant itself is unchanged');
  const { fn, rules } = buildPredicate();
  rules.both = { craftable: false, lootable: false, adminOnly: true };
  ok(fn('both') === 'admin-only',
    'a card that is BOTH admin-only and routeless reports admin-only — one refusal, one reason', String(fn('both')));
}

console.log('\n=== 5. NEGATIVE CONTROL — break the rule, prove §2 fails ===');
{
  const mutant = SRC.replace('if (o && !o.craftable && !o.lootable) return \'no obtainment route\';',
                             'if (false) return \'no obtainment route\';');
  ok(mutant !== SRC, 'the no-route clause is where the suite thinks it is');
  let reproduced = false;
  try {
    const { fn, rules } = buildPredicate(mutant);
    rules.locked = { craftable: false, lootable: false, adminOnly: false };
    reproduced = (fn('locked') === null);
  } catch (e) { reproduced = false; }
  ok(reproduced, 'with the clause disabled a routeless card is allowed again — the bug reproduces');
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURES' : '✅ a card with no way in does not get in'));
process.exit(fails ? 1 : 0);
