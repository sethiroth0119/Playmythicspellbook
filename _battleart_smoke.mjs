/* 🖼⚰️🗺 BATTLE ART · GRAVEYARD COSTS · NODE PUBLISH (v121v50).

   Asked for: "show the card art in all modals that show cards in battle, not
   emojis"; "a card that must vanish two mages from the graveyard plays without
   removing them / cost-becomes-0-if-X-is-in-graveyard sometimes fails";
   "I am adding new nodes and they are not saving".

   Defends, headless:
     · _battleCardArtHtml renders an <img> when the card has art and the emoji
       otherwise, with an emoji fallback on a broken URL; the activation-cost
       modal, the assault prompt, the search picker and the hand glyph use it
       and pass card ids;
     · the alternate costs (banishGraveCost / vanishUnit) are paid BEFORE and
       OUTSIDE the consumeGrave block on both the unit and the spell play path;
     · the zero-cost graveyard test matches exact name, id, or a containing name;
     · _twPublishSoon exists, create-node calls it, _adminAutoPublish covers the
       map on the Territory Wars screen, and the shared-map fetch keeps a dirty
       admin edit.

   Run: node _battleart_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── art helper, run for real ── */
{
  const ctx = { getCardArt: (id) => (id === 'c1' ? 'https://cdn/x.png' : null), _polyArtSrc: () => null, escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), document: { getElementById: () => ({}) }, window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fnText('_battleCardArtHtml'), ctx);
  const withArt = vm.runInContext(`_battleCardArtHtml('c1', '🐉')`, ctx);
  const noArt = vm.runInContext(`_battleCardArtHtml('c2', '🐉')`, ctx);
  ok(/^<img class="bca-img" src="https:\/\/cdn\/x\.png"/.test(withArt) && /data-ico="🐉"/.test(withArt) && /onerror=/.test(withArt), 'art present → <img> with an emoji fallback on error', withArt);
  ok(noArt === '🐉', 'no art → the emoji', noArt);
  ok(vm.runInContext(`_battleCardArtHtml(null, '')`, ctx) === '🂠', 'no id, no icon → card back');
}
ok(/const itemHtml = \(kind, id, icon, name, cardId\) =>/.test(SRC) && /_battleCardArtHtml\(cardId, icon \|\| '🂠'\)/.test(SRC), 'activation-cost modal items render art');
ok(/itemHtml\('discard', c\.instanceId, c\.icon, c\.name, c\.id\)/.test(SRC) && /itemHtml\('banish', b\.idx, b\.card && b\.card\.icon, b\.card && b\.card\.name, b\.card && \(b\.card\.id \|\| b\.card\.cardId\)\)/.test(SRC) && /itemHtml\('tribute', u\.id, u\.icon, u\.name, u\.originalCardId \|\| u\.cardId\)/.test(SRC), 'discard / banish / tribute pass card ids');
ok(/<div class="assault-prompt-card-icon">\$\{_battleCardArtHtml\(c\.id, c\.icon \|\| '⚔'\)\}<\/div>/.test(SRC), 'assault prompt renders art');
ok(/<span class="searchpick-row-icon">\$\{_battleCardArtHtml\(c\.id, c\.icon \|\| '🃏'\)\}<\/span>/.test(SRC), 'search picker renders art');
ok(/<span class="hand-card-glyph">\$\{_battleCardArtHtml\(c\.id, c\.icon\)\}<\/span>/.test(SRC), 'hand fallback glyph renders art');
ok(/window\.MythicBattleArt = \{ html: _battleCardArtHtml \}/.test(SRC), 'seam on window');

/* ── graveyard costs ── */
{
  const unitI = SRC.indexOf('THE ALTERNATE COSTS ARE PAID FIRST AND ALWAYS');
  const seg = SRC.slice(unitI, unitI + 2200);
  const a = seg.indexOf("type === 'vanishUnit'"), b = seg.indexOf("type === 'banishGraveCost'"), c = seg.indexOf('if (card.consumeGrave) {');
  ok(unitI > 0 && a > 0 && b > a && c > b, 'unit play: vanish, then banish, then consume — outside the consume block');
  const spellI = SRC.indexOf('Alternate costs first and always — see the unit path');
  const seg2 = SRC.slice(spellI, spellI + 1600);
  const a2 = seg2.indexOf("type === 'vanishUnit'"), b2 = seg2.indexOf("type === 'banishGraveCost'"), c2 = seg2.indexOf('if (card.consumeGrave) {');
  ok(spellI > 0 && a2 > 0 && b2 > a2 && c2 > b2, 'spell play: same order, outside the consume block');
  /* the old shape — alt cost nested under consumeGrave — is gone everywhere */
  const nested = /if \(card\.consumeGrave\) \{\n\s*const _cg = _applyConsumeGrave\([^)]*\);\n\s*\/\/ 🌌 vanishUnit play-cost/.test(SRC);
  ok(!nested, 'no play path still nests the alternate cost under consumeGrave');
}
{
  const ctx = { _zcNorm: (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(), _isKalonUnit: () => false, console };
  vm.createContext(ctx);
  vm.runInContext(fnText('_zeroCostConditionMet'), ctx);
  const card = { zeroCostIf: { graveyardHasNamed: 'Fire Mage' } };
  const st = (grave) => ({ units: [], player: { graveyard: grave } });
  ok(vm.runInContext(`_zeroCostConditionMet(${JSON.stringify(card)}, ${JSON.stringify(st([{ name: 'fire  mage' }]))}, 'player')`, ctx) === true, 'zero cost: exact name (case/space-insensitive)');
  ok(vm.runInContext(`_zeroCostConditionMet(${JSON.stringify(card)}, ${JSON.stringify(st([{ name: 'Fire Mage Apprentice' }]))}, 'player')`, ctx) === true, 'zero cost: a graveyard name that contains the condition');
  ok(vm.runInContext(`_zeroCostConditionMet(${JSON.stringify(card)}, ${JSON.stringify(st([{ name: 'Ice Mage', cardId: 'fire mage' }]))}, 'player')`, ctx) === true, 'zero cost: the card id matches');
  ok(vm.runInContext(`_zeroCostConditionMet(${JSON.stringify(card)}, ${JSON.stringify(st([{ name: 'Ice Mage' }]))}, 'player')`, ctx) === false, 'zero cost: no match stays full price');
}

/* ── nodes ── */
ok(/function _twPublishSoon\(ms\)/.test(SRC) && /tw_cloudPublishWorldMap\(\{ allowConfirm: false \}\)/.test(fnText('_twPublishSoon')), '_twPublishSoon debounces a non-forcing publish');
ok(/try \{ _twPublishSoon\(1500\); \} catch \(e\) \{\}\n      showToast\(`✨ Created \$\{newId\}/.test(SRC), 'creating a node publishes it');
ok(/if \(App && App\.screen === 'territoryWars' && typeof _twPublishSoon === 'function'\) _twPublishSoon\(600\);/.test(SRC), 'admin auto-publish covers the map on the Territory Wars screen');
ok(/t\.nodes   = doc\.nodes;/.test(SRC), 'the fetch adopts the canonical list once the early guards have passed');
ok(/reload before editing nodes, or this edit will not publish/.test(SRC), 'an unseen map warns instead of silently skipping');
/* ── the shared map never steps back ── */
ok(/if \(row && \(row\.version \| 0\) < \(App\._twWorldMapVersion \| 0\)\) row = null;/.test(SRC) && /if \(row && \(row\.version \| 0\) < \(App\._twWorldMapVersion \| 0\)\) return null;/.test(SRC), 'a stale edge copy falls back to the table, and an older table row is ignored');
/* The guard is a block since v121v69 (it now logs once), so this asserts the
   BEHAVIOUR — dirty admin ⇒ back off and return without adopting — rather than
   one exact line. It is also why the shrink refusal had to stop dead-ending:
   this is what stopped a behind device ever catching up. */
{
  const i = SRC.indexOf("if (App._twMapDirty && typeof isAdmin === 'function' && isAdmin()) {");
  const seg = SRC.slice(i, i + 700);
  ok(i > 0 && /_twWorldMapAt = now - 50000; return null;/.test(seg), 'an unpublished admin edit is never overwritten by a fetch');
}
ok(/App\._twWorldMapDoc = \{ regions: t\.regions \|\| \[\], sectors: t\.sectors \|\| \[\], nodes: t\.nodes \};/.test(SRC) && /App\._twLastPubJson = _pubJson;/.test(SRC), 'a successful publish becomes the held map');
ok(/if \(!opts\.force && _pubJson === App\._twLastPubJson\)/.test(SRC) && /4000 - \(Date\.now\(\) - \(App\._twLastPubAt \|\| 0\)\)/.test(SRC), 'identical publishes are skipped and publishes are 4 s apart');
{ const W = readFileSync('./worker.js', 'utf8'); ok(/function _wmNoStore\(res\)/.test(W) && /if \(hit\) return _wmNoStore\(hit\);/.test(W) && /return _wmNoStore\(res\);/.test(W) && !/'cache-control', 'public, max-age=30'/.test(W), 'the worker marks every worldmap response no-store for the HTTP layer'); }
ok(/window\.BUILD_VERSION = 'v121v(5[1-9]|[6-9]\d|\d{3,})'/.test(SRC), 'build v121v51 or later');

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
