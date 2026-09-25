/* ============================================================================
 * _realmtarget_smoke.mjs — 🌟 REALM DECKS + 🎯 PLAYER-PICKED TARGETING.
 *                                             node _realmtarget_smoke.mjs
 * ----------------------------------------------------------------------------
 * Owner, two requests that turned out to share a shape:
 *   "Add Realm Decks for structure decks and Ai decks…"
 *   "We do not have a player select target destroy, banish, bounce etc… also
 *    add a global radius… show the targeted check box on (All) Card types."
 *
 * 🔴 IN BOTH CASES THE ENGINE ALREADY DID THE WORK AND NOTHING COULD REACH IT.
 *   • destroy / bounce / execute all honour eff._targetId — but the dropdown
 *     labels said "the strongest enemy in radius", so the feature read as
 *     auto-only and the owner reasonably concluded it did not exist.
 *   • _targetCandidates has lifted the distance test on eff.global since
 *     v120c3 — but the only way to SET it was typing 99 into a Radius box every
 *     editor clamps to 4.
 *   • isRealmOnlyCard has named Archons/Fusion/Evo for two releases — but a
 *     structure deck granted them to the collection and stopped, and an AI deck
 *     naming one SHUFFLED IT INTO THE DRAW PILE.
 * A feature nothing can reach is indistinguishable from a feature nobody built.
 * ==========================================================================*/
import fs from 'fs';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : '   <-- ' + extra)); if (!c) fails++; };

/* ══ REALM DECKS ═══════════════════════════════════════════════════════════ */
const sp = /function _realmSplitIds\(ids\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_realmSplitIds exists', !!sp);
if (sp) {
  ok('it resolves both bare ids and kind:id deck keys', /indexOf\(':'\) > -1\) \? raw\.slice\(raw\.indexOf\(':'\) \+ 1\) : raw/.test(sp[0]),
     'AI decks store kind:id keys, structure decks store bare ids — one rule has to read both');
  ok('…and an unresolvable id falls to MAIN, not to the realm',
     /if \(def && typeof isRealmOnlyCard === 'function' && isRealmOnlyCard\(def\)\) realm\.push\(raw\);\n\s*else main\.push\(raw\);/.test(sp[0]),
     'guessing realm for an unknown id would silently delete a card from a deck');
}

/* the AI */
ok("the AI's realm list is captured when its deck is picked", /_AI_REALM_IDS = _sp\.realm\.length \? _sp\.realm\.slice\(\) : null;/.test(SRC));
ok('…BEFORE the copy cap and the size slice',
   SRC.indexOf('_AI_REALM_IDS = _sp.realm') < SRC.indexOf('keys = _capCopies(keys'),
   'a realm card is not a deck card — counting it toward DECK_SIZE or the 3-copy cap is wrong twice over');
ok('🔴 no list means the AI is UNRESTRICTED, exactly as before',
   /const list = \(typeof _aiRealmIds === 'function'\) \? _aiRealmIds\(\) : null;\n\s*if \(!list\) return true;/.test(SRC),
   'every AI deck authored before this field names none — gating them would silently delete the Archon mechanic from every existing fight');
ok('…and a deck that DOES name them is held to them', /return list\.some\(k => \{/.test(SRC));
ok('the AI padder refuses every realm type, not just Archons',
   /!\(typeof isRealmOnlyCard === 'function' && isRealmOnlyCard\(c\)\)\)/.test(SRC),
   'it filtered archonSummon only, so a size top-up could hand the AI an Evo unit as a draw card');
ok("the AI's archon pool goes through the gate", /getAllArchonCards\(\)\.filter\(a => \{ try \{ return _realmDeckAllows\(a, side\); \}/.test(SRC));
ok("…and so does its fusion pool", /try \{ return all\.filter\(k => _realmDeckAllows\(k, side\)\); \} catch \(e\) \{ return all; \}/.test(SRC));
ok("the rail's FOE REALM count is the gated list, not every Archon in the game",
   /if \(_realmDeckAllows\(c, 'ai'\)\) push\(c, 'Archon'\);/.test(SRC));

/* structure decks */
/* 🌌 2026-09-18 — this pinned the BUG: the grant pushed the bare id, which
   parseCardKey cannot resolve, so the card was "in" the Realm Deck and never
   summonable (measured by realmtype-probe S4 before/after). It pushes the
   'custom:<id>' key now, and old bare ids are repaired on load. */
ok('a structure deck puts its realm cards in the Realm Deck — as a custom:<id> key',
   /Profile\.archonDeck\.cards\.push\('custom:' \+ _bare\);/.test(SRC) && !/Profile\.archonDeck\.cards\.push\(id\);/.test(SRC));
ok('…de-duped, because a Realm Deck is a SET not a pile',
   /if \(have\.has\(id\)\) continue;/.test(SRC),
   'buying the same deck twice must not stack an Archon in the roster — the collection count is where "how many" lives');
ok('…and the collection grant is untouched', /Profile\.cardCollection\[cardId\] = \(Profile\.cardCollection\[cardId\] \|\| 0\) \+ 1;/.test(SRC));
ok('the buy dialog says how many are Realm cards BEFORE the player pays',
   /of them are \u{1F31F} Realm cards \(Archon \/ Fusion \/ Evo\)/u.test(SRC),
   'they are the expensive half of most decks and they do not go in the main deck');

/* ══ TARGETING ═════════════════════════════════════════════════════════════ */
ok('banishUnit is targetable', /banishUnit: 1 \};/.test(SRC));
ok('…and its body puts the chosen unit first',
   /if \(eff\._targetId\) \{\n\s*const _i = enemies\.findIndex\(u => u\.id === eff\._targetId\);\n\s*if \(_i > 0\) enemies\.unshift\(enemies\.splice\(_i, 1\)\[0\]\);/.test(SRC),
   'without this the pick was computed, drawn on the board, and thrown away');
for (const [id, label] of [['destroyTarget', 'destroy'], ['banishUnit', 'banish'], ['bounceUnit', 'bounce'], ['singleKill', 'execute']]) {
  const row = new RegExp("id: '" + id + "',\\s*label: '[^']*\\u{1F3AF} you pick", 'u');
  ok('the ' + label + ' label tells the truth about the pick', row.test(SRC),
     'the old label said "the strongest enemy in radius", which reads as auto-only — that is why the owner thought the feature was missing');
}

/* global radius */
ok('the on-play editor has a Global control', /id="ed-onplay-global"/.test(SRC));
ok('…pre-ticked by a legacy radius of 99+', /\(onPlay\.global === true \|\| \(parseInt\(onPlay\.radius, 10\) \| 0\) >= 99\)/.test(SRC),
   '99 was the only way to author this before — a card that used it must not look unticked');
ok('…and it saves ONLY when true', /global:\s*\(\(\) => \{ const el = document\.getElementById\('ed-onplay-global'\); return \(el && el\.checked\) \? true : undefined; \}\)\(\),/.test(SRC),
   "the engine tests `eff.global === true`, so false and absent are already identical");

/* every card type */
ok('curses get the on-play block too', /const _isCurseCard = \(type === 'curse'\);/.test(SRC));
ok('…and it is in showOnPlay', /showOnPlay = isUnitLike \|\| _isFieldCard \|\| _isWallCard \|\| _isSpellCard \|\| _isTrapCard \|\| _isCounterCard \|\| _isEnchantCard \|\| _isCurseCard;/.test(SRC));

/* ══ THE ABILITY EDITORS ═══════════════════════════════════════════════════ */
ok('the ability targeting control is built ONCE', /function _abilityTargetHtml\(prefix, eff\) \{/.test(SRC),
   'three pasted copies is three places for the ids to drift from the save path that reads them');
ok('…with its read-back beside it', /function _captureAbilityTargeting\(prefix\) \{/.test(SRC));
for (const p of ['ed-field', 'ed-grave', 'ed-hand']) {
  ok(p + ' renders it', new RegExp("_abilityTargetHtml\\('" + p + "'").test(SRC));
  /* 🔴 THIS ASSERTION ONCE PASSED ON A COMMENT. It matched
     `..._captureAbilityTargeting('ed-field')`, and when that spread was replaced
     with inline reads the replacement's own comment quoted the removed code
     verbatim — so the regex kept matching prose describing the thing instead of
     the thing. Green for the wrong reason, ten minutes after the same shape was
     written up in .gauntlet/README.md.
     Now it asserts the READS THEMSELVES, at the ids the editor renders, which is
     what the save path has to do and what a comment cannot accidentally satisfy. */
  ok(p + ' saves targeted', new RegExp("getElementById\\('" + p + "-targeted'\\)").test(SRC));
  ok(p + ' saves the target count', new RegExp("getElementById\\('" + p + "-targetcount'\\)").test(SRC));
  ok(p + ' saves global', new RegExp("getElementById\\('" + p + "-global'\\)").test(SRC));
  ok(p + ' reads them INLINE, not behind a helper',
     new RegExp("targeted:\\s+\\(\\(\\) => \\{ const el = document\\.getElementById\\('" + p + "-targeted'\\)").test(SRC),
     '_forgeids instruments captureEditorIntoCard by wrapping its read sites and recompiling — a read behind a helper is invisible to that audit, and the spread that called one stopped the instrumented copy compiling at all');
}
ok('the target count is written only above 1', /return x > 1 \? x : undefined;/.test(SRC));

/* 🔴 the strip that would have made the field control inert */
ok('the field ability strip is CONDITIONAL on whose turn it is',
   /const _faOffTurn = !!\(ns && ns\.turn && ns\.turn !== \(unit && unit\.owner\)\);/.test(SRC),
   'it read `targeted: false` unconditionally — adding the checkbox alone would have shipped a control that does nothing');
ok('…keeping the deterministic path off-turn', /\? Object\.assign\(\{\}, fa\.effect, \{ _autoPick: true, targeted: false \}\)/.test(SRC),
   'an effect that waits for its owner to click cannot open a picker on someone else’s turn');
ok('on-grave keeps its UNCONDITIONAL strip', /onPlay: \{ \.\.\.eff, targeted: false \}, onPlayExtra: null, _actZone: 'grave' \}/.test(SRC),
   'it fires inside a reducer during a clash either side may have started — there is nobody to prompt');

/* ══ a log line must never cancel an effect ════════════════════════════════ */
ok('the punish log guards its art lookup',
   /cardId: \(typeof _unitArtId === 'function'\) \? _unitArtId\(p\) : \(p\.originalCardId \|\| p\.cardId \|\| null\),/.test(SRC),
   '_punishEntry catches everything and returns the state UNCHANGED, so an unresolved name in a LOG field silently cancelled the damage');

/* ══ the handbook button ═══════════════════════════════════════════════════ */
ok('Camp links to the Player’s Handbook', /href="\/handbook\/" target="_blank" rel="noopener"/.test(SRC));
ok('…root-relative, so it does not resolve against the Camp URL', /href="\/handbook\//.test(SRC));
ok('…with noopener, because _blank hands over window.opener', /rel="noopener"/.test(SRC));

console.log('');
if (fails) { console.log('❌ ' + fails + ' FAILED'); process.exit(1); }
console.log('✅ ALL PASS');
