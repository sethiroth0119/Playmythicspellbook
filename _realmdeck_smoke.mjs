/* 🜂🧬 v121v138 — Evo units, and the Realm-deck-only rule enforced for all three.
   Run: node _realmdeck_smoke.mjs

   Owner: "This will be the new card type that can only go into Realm decks and
   show the Fusions and Archon cards in the deck builder list so players can add
   them to the deck but they will go into the realm deck (Fusions, Archons, Evo
   Units)" — and, restating it unprompted: "Evo Units can only be in the realm
   deck they do not get added to the main deck they are like the fusions and
   Archons."

   ⚠ THE RULE WAS NOT BEING ENFORCED FOR THE TWO TYPES THAT ALREADY EXISTED.
     addToDeck gates deck size, copy limits, ownership and one-hero-per-deck, and
     said nothing about Archons or Fusion Kalons. An Archon is an ordinary unit
     carrying archonSummon.enabled, so getAllDeckableCards buckets it as a unit
     and the MAIN deck accepted it. A card in the main deck is a card you can
     DRAW, and drawing the thing the Realm Deck exists to summon makes the summon
     condition that pays for it free. The Realm Deck's own add button has always
     checked its half; nothing checked the other direction. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the type ─────────────────────────────────────────────────────────────── */
ok(/function isEvoCard\(card\) \{/.test(SRC), 'an Evo unit is identifiable');
ok(/if \(card\.isEvoUnit\) return true;/.test(SRC) && /String\(card\.type \|\| ''\)\.toLowerCase\(\) === 'evo'/.test(SRC),
  '…by type OR by flag, so a card saved either way answers the same');
ok(/function getAllEvoCards\(\) \{/.test(SRC), 'and the pool can be listed, like Archons and Fusions');
/* 🌌 2026-09-18 — owner: "Make Realm Deck a card type where Fusions, Convergence,
   Evo Units, Archons are all in that." The separate 'evo' dropdown entry this
   pinned is gone ON PURPOSE: the author now picks type 🌌 Realm and then the Evo
   kind (#ed-realm-kind). The guarded behaviour — an author CAN make an Evo card
   in the Forge — is what is pinned now; realmtype-probe E1–E5 render, save and
   reload a Realm/Evo card for real. */
ok(/\{ id: 'realm',    label: '🌌 Realm \(Realm Deck — Fusion \/ Archon \/ Evo \/ Convergence\)' \}/.test(SRC)
   && /\['evo', '🧬 Evo unit — a Cocoon of Evolution becomes it'\]/.test(SRC),
   'the author can pick the type in the Forge (🌌 Realm → kind Evo)');

/* ── one predicate for all three ──────────────────────────────────────────── */
ok(/function _realmOnlyKind\(card\) \{/.test(SRC) && /function isRealmOnlyCard\(card\) \{ return !!_realmOnlyKind\(card\); \}/.test(SRC),
  'ONE predicate answers for Evo units, Archons and Fusions — a fourth Realm type is one line, not a hunt');
{
  const f = SRC.slice(SRC.indexOf('function _realmOnlyKind(card) {'), SRC.indexOf('function isRealmOnlyCard(card)'));
  ok(/isEvoCard\(card\)\) return 'Evo unit'/.test(f) && /isArchonCard\(card\)\) return 'Archon'/.test(f) && /isFusionKalon\(card\)\) return 'Fusion'/.test(f),
    '…and it NAMES the type, so the refusal can say which rule was hit');
}

/* ── the main deck refuses them, at the choke point ───────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function addToDeck(cardKeys, key) {'), SRC.indexOf('function removeFromDeck(cardKeys, key) {'));
  ok(/const _kind = \(typeof _realmOnlyKind === 'function'\) \? _realmOnlyKind\(_rc\) : null;/.test(f),
    'THE MAIN DECK REFUSES A REALM CARD — the gate that was missing entirely');
  ok(/live in your Realm Deck, not your main deck\./.test(f), '…and says so rather than failing silently');
  ok(/This gate was MISSING, not merely missing for Evo units/.test(f),
    'the note records that Archons were reaching the main deck BEFORE Evo units existed — this is a fix, not just a new feature');
  ok(/A card in the main deck is a card you can DRAW/.test(f),
    '…and why it matters: drawing the thing the Realm Deck summons makes the summon condition free');
  ok(/addToDeck is the choke point every deck source funnels/.test(f),
    '…and why the gate lives here: buildDeckFromKeys, the AI builders and _legalizeDeck all funnel through it, so a hand-edited save is covered too');
  /* the pre-existing rules must still be there */
  /* 📏 v177: a player deck runs to DECK_MAX (80), so the gate reads DECK_MAX now
     (owner: "up to 80, minimum is 40"). It must still be a hard gate. */
  ok(/if \(cardKeys\.length >= DECK_MAX\) return cardKeys;/.test(f), 'deck size is still gated (at DECK_MAX)');
  ok(/if \(isHeroCardKey\(key\) && deckHasHero\(cardKeys\)\)/.test(f), 'one hero per deck is still gated');
  ok(/const owned = deckKeyOwnedCount\(key\);/.test(f), 'ownership is still gated');
}

/* ── the button routes instead of refusing ────────────────────────────────── */
ok(/window\._realmDeckAdd = function \(key\) \{/.test(SRC), 'there is ONE way into the Realm Deck');
{
  /* Starts at the DOC COMMENT, not the assignment: the reasoning for reusing
     the Realm Deck's own rules lives above the function, and that reasoning is
     half of what this pin exists to protect. */
  const f = SRC.slice(SRC.indexOf('🜂 v121v138 — ONE WAY INTO THE REALM DECK'), SRC.indexOf("document.querySelectorAll('[data-archonpool-add]')"));
  ok(/ARCHON_DECK_MAX/.test(f), '…and it applies the Realm Deck cap');
  ok(/deckKeyOwnedCount\(key\)/.test(f), '…ownership');
  ok(/_cardCopyLimit\(card\)/.test(f) && /if \(limit === 0\)/.test(f), '…the ban list and the per-card copy limit');
  ok(/second-source-of-truth/.test(f),
    'the reason it reuses the Realm Deck\'s own rules is written down — a second entrance that skipped them is the exact failure the copy-cap note in this file describes');
  ok(/→ Realm Deck \(' \+ kind \+ 's are never in your main deck\)\./.test(f), '…and it tells the player where the card went');
}
ok(/&& typeof _realmDeckAdd === 'function'\) \{\n\s*_realmDeckAdd\(key\);/.test(SRC),
  'the card-list + button routes a Realm card, guarded explicitly rather than relying on bind order');
ok(/const _ok = _rd && \(typeof isRealmOnlyCard === 'function'\) && isRealmOnlyCard\(_rd\);/.test(SRC),
  'the Realm Deck\'s own gate now uses the same predicate, so it accepts Evo units too');
/* 🌌 2026-09-18 — Convergence became the fourth Realm kind (owner: "Fusions,
   Convergence, Evo Units, Archons are all in that"), so the message that named
   three now names four. Same guard, one more kind. */
ok(/Only Realm cards \(Fusion, Archon, Evo, Convergence\) can enter the Realm Deck\./.test(SRC), '…and its message names all four kinds (was three before Convergence)');

/* ── run the rule for real ────────────────────────────────────────────────── */
{
  const block = SRC.slice(SRC.indexOf('function isEvoCard(card) {'), SRC.indexOf('function isRealmOnlyCard(card)'))
              + '\nfunction isRealmOnlyCard(card) { return !!_realmOnlyKind(card); }';
  const g = {
    Forge: { customCards: [] },
    isArchonCard: (c) => !!(c && c.archonSummon && c.archonSummon.enabled),
    isFusionKalon: (c) => !!(c && (c.summonMethod === 'fusion' || c.requiresPolycreation)),
  };
  const api = new Function('g', 'with (g) { ' + block + ' return { isEvoCard, _realmOnlyKind, isRealmOnlyCard, getAllEvoCards }; }')(g);

  ok(api.isEvoCard({ type: 'evo' }) === true, 'run for real: type evo is an Evo unit');
  ok(api.isEvoCard({ type: 'EVO' }) === true, 'run for real: …case-insensitively');
  ok(api.isEvoCard({ isEvoUnit: true, type: 'unit' }) === true, 'run for real: …and so is the flag, whatever the type says');
  ok(api.isEvoCard({ type: 'unit' }) === false && api.isEvoCard(null) === false, 'run for real: an ordinary unit is not');

  ok(api._realmOnlyKind({ type: 'evo' }) === 'Evo unit', 'run for real: the Evo unit is named');
  ok(api._realmOnlyKind({ archonSummon: { enabled: true } }) === 'Archon',
    'run for real: AN ARCHON IS REALM-ONLY — this is the case the main deck was silently accepting');
  ok(api._realmOnlyKind({ summonMethod: 'fusion' }) === 'Fusion', 'run for real: so is a Fusion Kalon');
  ok(api._realmOnlyKind({ archonSummon: { enabled: false } }) === null,
    'run for real: an Archon card with the summon DISABLED is an ordinary unit and may be decked');
  ok(api._realmOnlyKind({ type: 'unit' }) === null && api._realmOnlyKind({ type: 'spell' }) === null,
    'run for real: ordinary cards are untouched — this must not quietly shrink the main-deck pool');
  ok(api._realmOnlyKind(null) === null, 'run for real: a missing card is not Realm-only');
  ok(api.isRealmOnlyCard({ type: 'evo' }) === true && api.isRealmOnlyCard({ type: 'trap' }) === false,
    'run for real: the boolean agrees with the name');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 138, 'BUILD_VERSION is v121v138 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
