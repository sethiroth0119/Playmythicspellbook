/* ══════════════════════════════════════════════════════════════════════════
   🎴 CARD SHEET — the wiring contract

   WHAT THIS EXISTS TO CATCH. The tabletop sheet (src/cardsheet/) is a SKIN over
   two renderers that already had working binders. Nothing about it is safe
   because it "looks right": the sheet renders buttons, and bindCardDetailModal /
   bindUnitModal find those buttons BY ID. Rename one id on either side and you
   get a modal that opens, looks finished, and does nothing when clicked — the
   worst possible failure, because every visual check passes.

   🔴 I could not click this in the live app. index.html opens on an auth gate
   and signing in is not something this session does, so the sheet was verified
   visually against fixtures and the wiring is verified HERE, statically. That is
   a real limit and this header says so rather than implying a play-through
   happened. What is pinned below is the contract; what is NOT pinned is that a
   real battle renders — a human has to look at that once.

   Run: node _cardsheet_smoke.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const MOD = fs.readFileSync(new URL('./public/src/cardsheet/index.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('./public/src/cardsheet/sheet.css', import.meta.url), 'utf8');

let fails = 0, passes = 0;
const has = (t) => SRC.indexOf(t) >= 0;
const count = (hay, t) => hay.split(t).length - 1;
function ok(label, cond, why) {
  if (cond) { passes++; console.log('  ok   ' + label); }
  else { fails++; console.log('  FAIL ' + label + (why ? '\n         ' + why : '')); }
}

console.log('\n── the module is actually loaded ──');
ok('sheet.css is linked', has('src/cardsheet/sheet.css?v='));
ok('index.js is loaded as a module', has('<script type="module" src="src/cardsheet/index.js?v='));
ok('…and both carry a cache-busting ?v=', /cardsheet\/sheet\.css\?v=\w/.test(SRC) && /cardsheet\/index\.js\?v=\w/.test(SRC),
   'a battle surface that ships without a version bump serves stale bytes from the SW cache');
ok('the bridge is a window global, not an export the host cannot see',
   MOD.indexOf('window.MythicCardSheet') > 0,
   'index.html is a classic script and cannot import; CLAUDE.md, the globals trap');

console.log('\n── 🔴 THE ID CONTRACT ──');
/* Each row: the id a binder looks up, and the binder that looks it up. If the
   sheet stops emitting one of these, the button goes dead silently. */
for (const [id, binder] of [
  ['card-detail-backdrop',    'bindCardDetailModal'],
  ['card-detail-close',       'bindCardDetailModal'],
  ['card-detail-cancel',      'bindCardDetailModal'],
  ['card-detail-play',        'bindCardDetailModal'],
  ['card-detail-hand-ability','bindCardDetailModal'],
  ['card-detail-read-note',   'bindCardDetailModal'],
  ['modal-backdrop',          'bindUnitModal'],
  ['modal-close',             'bindUnitModal'],
  ['modal-btn-close',         'bindUnitModal'],
  ['modal-btn-move',          'bindUnitModal'],
  ['modal-btn-swap',          'bindUnitModal'],
  ['modal-btn-kalon',         'bindUnitModal'],
  ['modal-btn-archon',        'bindUnitModal'],
  ['modal-btn-flip',          'bindUnitModal'],
  ['modal-btn-loot',          'bindUnitModal'],
]) {
  /* Twice or more: once in the sheet branch, once in the legacy fallback, plus
     the getElementById in the binder. Never once — one occurrence means only the
     binder mentions it and NEITHER renderer emits it. */
  ok('"' + id + '" is still emitted (' + binder + ' binds it)', count(SRC, id) >= 2,
     'found ' + count(SRC, id) + ' occurrence(s) — a button the binder cannot find is a dead button');
}
ok('the move binder matches the sheet rows too',
   has(".modal-move[data-move], .tts-move[data-move]"),
   'the sheet renders .tts-move; a selector pinned to .modal-move alone binds nothing on the new sheet');
ok('…and the sheet really does emit data-move', MOD.indexOf('data-move="${esc(m.id)}"') > 0);

console.log('\n── the unit-modal body is hoisted, not duplicated ──');
ok('_uBody exists', has('const _uBody = '));
ok('_uStatsHtml exists', has('const _uStatsHtml = '));
ok('_uMovesHtml exists', has('const _uMovesHtml = '));
ok('the legacy markup renders the hoisted body', has('        ${_uBody}'),
   'if this is gone the legacy fallback renders an empty modal');
/* The removal the sheet performs is by exact substring. If either section stops
   being interpolated into the body, the removal silently stops removing and the
   sheet shows the legacy stat bars UNDER its own stat panel. */
ok('the stats section is interpolated into the body exactly once', count(SRC, '        ${_uStatsHtml}') === 1,
   'found ' + count(SRC, '        ${_uStatsHtml}'));
ok('the moves section is interpolated into the body exactly once', count(SRC, '        ${_uMovesHtml}') === 1,
   'found ' + count(SRC, '        ${_uMovesHtml}'));
ok('…and the sheet removes both before rendering the body',
   has('_uBody.split(_uStatsHtml).join("").split(_uMovesHtml).join("")'),
   'without this the sheet draws two stat panels and two movesets, the second of which is unstyled');

console.log('\n── the fallback is real ──');
/* A deferred module can fail to mount and index.html reports that at runtime as
   "not mounted (non-fatal)" — indistinguishable from absent (CLAUDE.md). Both
   renderers must still return a working modal in that case. */
ok('both renderers guard on the module being present',
   count(SRC, 'if (window.MythicCardSheet && typeof window.MythicCardSheet.render === "function") {') === 2,
   'found ' + count(SRC, 'if (window.MythicCardSheet && typeof window.MythicCardSheet.render === "function") {') + ' of 2');
ok('both fall back rather than throwing', count(SRC, '[cardsheet] ') === 2,
   'a throw inside a renderer takes out the whole battle render, not just the modal');
ok('the legacy card-detail markup is still present',
   has('<div class="card-detail cd-aaa">'), 'the fallback has nothing to fall back TO');

console.log('\n── the move-slot law ──');
/* 📐 The owner's law: units 4, heroes up to 8 "due to the skill tree". The
   engine implements it in TWO places, and an earlier version of this comment
   read only the first and claimed the cap was a flat 4 for everyone:
     · MAX_KNOWN_MOVES = 4 — the base slots every unit has;
     · buildHeroUnit merges getHeroEquippedSkillMoves() — the 4-slot skill bay
       (HERO_SKILL_ATTACK_SLOTS: class moves + Learned Arts) — into a PLAYER
       hero's knownMoves, on top of the base 4.
   The sheet must quote both constants, never a typed number. */
ok('MAX_KNOWN_MOVES is still the single source of the cap', has('const MAX_KNOWN_MOVES = 4;'));
ok('the sheet is handed the engine constant, not a literal',
   has('((typeof MAX_KNOWN_MOVES !== "undefined") ? (MAX_KNOWN_MOVES | 0) : 0)'),
   'a 4 typed into the sheet would keep reading 4 after the engine changed');
ok('…PLUS the hero skill bay, for a player hero', has('(u.isHero && isPlayer && typeof HERO_SKILL_ATTACK_SLOTS !== "undefined") ? (HERO_SKILL_ATTACK_SLOTS | 0) : 0'),
   'without it a hero with six moves reads "6/4" — the law is units 4, heroes up to 8');
ok('the bay really is 4 slots', has('const HERO_SKILL_ATTACK_SLOTS = 4;'));
ok('…and the hero builder really merges it into knownMoves', has('const equipped = getHeroEquippedSkillMoves(heroData.id);'),
   'if this merge moves, the counter\'s +4 is describing a bay that no longer reaches battle');
ok('…and the module renders it rather than deciding it',
   MOD.indexOf('const slots = (cap > 0 && moves)') > 0);

console.log('\n── CSS invariants that were real bugs ──');
ok('.tts-track is display:block', /\.tts-track\{display:block/.test(CSS),
   'an inline span ignores height — six correct-width fills at zero height read as missing data, not as broken CSS');
ok('.tts-fill is display:block', /\.tts-fill\{display:block/.test(CSS));
ok('.tts-move-meta is display:block', /\.tts-move-meta\{display:block/.test(CSS),
   'without it the meta line and the flavour line run together into one string');
ok('the grid row is minmax(0,1fr)', CSS.indexOf('grid-template-rows:minmax(0,1fr)') > 0,
   'an auto row takes its minimum from the portrait image and pushes the stat block off screen');
ok('…and the narrow breakpoint releases it', CSS.indexOf('grid-template-rows:none') > 0,
   'stacked, a pinned first row makes the two columns draw on top of each other');

console.log('\n── negative control ──');
/* If the harness cannot fail, none of the above means anything. */
ok('a string that must not exist is absent', !has('cardsheet-canary-' + 'do-not-add'),
   'this is the control; it going red means the file was edited to contain it');
{
  const bogus = count(SRC, 'card-detail-play-nonexistent') >= 2;
  ok('…and the id check really can fail', bogus === false,
     'the id assertions above use the same count(); this proves a missing id scores 0, not a pass');
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ all ' + passes + ' passed') + ' (' + passes + '/' + (passes + fails) + ')');
process.exit(fails ? 1 : 0);
