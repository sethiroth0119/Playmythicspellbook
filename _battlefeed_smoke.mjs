/* ══════════════════════════════════════════════════════════════════════════
   📣 BATTLE REPORT — the event panel and the "undefined wears off" fix

   Owner: "I want this information in a modal where its clear and keep it up
   for 4 seconds longer so players can read what is going on." (screenshot: five
   loose pills, one of them reading "Aroa Stormrider Survivor — undefined wears
   off").

   The panel itself was measured in real Chromium by .gauntlet/feed-shot.mjs,
   driving the real Juice.eventChip: five rows still up at 3.2s (the pills were
   gone at 2.4s) and at 6.0s, all gone and the frame hidden by 7.3s, no page
   errors, fits a 390px phone. This file pins what makes that true so it cannot
   quietly stop being true.

   Run: node _battlefeed_smoke.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import * as acorn from 'acorn';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('./public/src/battle/feed.css', import.meta.url), 'utf8');
let fails = 0, passes = 0;
const has = (t) => SRC.indexOf(t) >= 0;
const count = (t) => SRC.split(t).length - 1;
function ok(label, cond, why) {
  if (cond) { passes++; console.log('  ok   ' + label); }
  else { fails++; console.log('  FAIL ' + label + (why ? '\n         ' + why : '')); }
}

/* Top-level-ness by PARSE, not grep: a const declared one line inside a function
   parses, greps, and is invisible outside it (TRAP_MODES). Walk the classic
   scripts and collect the names declared as top-level statements. */
function topLevelConsts(html) {
  const names = new Set();
  const re = /<script(?![^>]*type="module")(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let ast;
    try { ast = acorn.parse(m[1], { ecmaVersion: 'latest', sourceType: 'script' }); } catch (e) { continue; }
    for (const st of ast.body) if (st.type === 'VariableDeclaration') for (const d of st.declarations) if (d.id && d.id.name) names.add(d.id.name);
  }
  return names;
}

console.log('\n── negative control for the parse walk ──');
{
  const ctl = topLevelConsts('<script>const A = 1; function f(){ const B = 2; }</script>');
  ok('the walker sees a top-level const', ctl.has('A'));
  ok('…and does NOT count one declared inside a function', !ctl.has('B'),
     'if this fails, every "is top-level" answer below is meaningless');
}

console.log('\n── the panel ──');
const TOP = topLevelConsts(SRC);
ok('BATTLE_FEED_EXTRA_MS is a top-level const', TOP.has('BATTLE_FEED_EXTRA_MS'));
ok('…and it is 4000 — the owner\'s "4 seconds longer"', has('const BATTLE_FEED_EXTRA_MS = 4000;'));
ok('BATTLE_FEED_MAX_ROWS is a top-level const', TOP.has('BATTLE_FEED_MAX_ROWS'));
ok('every row\'s life includes the extra', has("const life = ((typeof opts.ms === 'number') ? opts.ms : 2600) + BATTLE_FEED_EXTRA_MS;"),
   'applied in ONE place, so a caller passing its own ms is extended too');
ok('the old un-extended lifetime is gone', !has("      const life = (typeof opts.ms === 'number') ? opts.ms : 2600;\n"));
ok('rows are .bef-row, NOT .bevt-chip', has("chip.className = 'bef-row bevt-' + kind;") && !has("chip.className = 'bevt-chip bevt-' + kind;"),
   'hud.css clips .bevt-chip into a pill; a row carrying it would be clipped');
ok('the row label is escaped', has("'<span class=\"bef-txt\">' + esc(opts.label) + '</span>'"));
ok('the frame is marked empty when the last row leaves', has("if (!rows.children.length) feed.classList.add('bef-empty');"));
ok('the header is rebuilt if a sweep emptied the feed', has("let rows = feed.querySelector('.bef-rows');") && has('if (!rows) {'));
ok('the memory sweep leaves the feed marked empty', has("feed.classList.add('bef-empty'); }"),
   'without this, a sweep leaves a visible empty frame on screen');
ok('the announcer presents the panel', has("'<img class=\"bef-herald\" src=\"' + esc(ANNOUNCER_ART)"));
ok('…guarded, so a build without the announcer still renders', has("(typeof ANNOUNCER_ART !== 'undefined' && ANNOUNCER_ART)"));
ok('feed.css is loaded AFTER hud.css', SRC.indexOf('src/battle/feed.css?v=') > SRC.indexOf('src/battle/hud.css?v='),
   'hud.css also targets #battle-event-feed; source order is part of the contract');

console.log('\n── 🕵 a face-down card never shows its art ──');
ok('log rows pass no card id for a hidden line', has('cardId: e.hidden ? null : (e.cardId || null)'),
   'the words were redacted when logged; the art beside them would undo that');
ok('status rows use _unitArtId, guarded', has("cardId: (typeof _unitArtId === 'function') ? _unitArtId(u) : null"));

console.log('\n── 🩹 "undefined wears off" ──');
ok('applyStatusEffect refuses a missing id', has("if (statusId == null || statusId === '' || statusId === 'undefined' || statusId === 'null') {"));
ok('…and says so, so the caller can be found', has("[status] applyStatusEffect called with no status id"));
ok('the expiry line resolves the name once', has('const _stName = (eff && eff.name) || e.type;'));
ok('…and never announces an unnamed status', has("if (_stName && _stName !== 'undefined' && _stName !== 'null') try {"));
ok('the raw "|| e.type) + \' wears off\'" expression is gone', count("((eff && eff.name) || e.type) + ' wears off'") === 0,
   'that expression is what printed "undefined"');

console.log('\n── CSS that was the point ──');
ok('rows WRAP (the pills were nowrap and ran off a phone)', /\.bef-txt\s*\{[^}]*white-space:\s*normal/.test(CSS));
ok('the panel does not block clicks', !/pointer-events:\s*auto/.test(CSS),
   'it appears every phase step; a click-eating panel would stall the player\'s own turn');
ok('the life bar drains', /@keyframes bef-drain/.test(CSS) && /\.bef-life\s*\{[^}]*animation:\s*bef-drain/.test(CSS));
ok('reduced motion is respected', /prefers-reduced-motion/.test(CSS));

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ all ' + passes + ' passed') + ' (' + passes + '/' + (passes + fails) + ')');
process.exit(fails ? 1 : 0);
