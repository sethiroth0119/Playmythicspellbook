/* 🎴 v121v134 — the acting card's ART, on all three ability surfaces, and no
   empty black square when there is none. Run: node _abilityart_smoke.mjs

   Owner: "It is this black transparent box line here you can remove this for
   me" (the ⚡ ABILITY ACTIVATED panel), and "When Heros or units use their
   ability show the card art right now it is show the old card frame and an
   emoji".

   ONE BUG, THREE FACES. The panel, the cinematic and the battle log all asked
   _abilityCardArt for the acting card's picture, and it refused every `blob:`
   URL — which is what _lazyLoadCardArt stores EVERY streamed card art as
   (`Forge.cardArt[id] = _artBlobToUrl(v)`). So the art the board was already
   drawing was resident, usable, and thrown away; each surface then showed its
   own fallback: an empty .ab-card (background #0c0a12 in a coloured border =
   the black box), the frame PNG, and the emoji. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the resolver ─────────────────────────────────────────────────────────── */
ok(/function _abilityArtBest\(cardId, big\) \{/.test(SRC), 'one resolver serves the panel, the cinematic and the log');
/* 4d33c03a49 appended a `catalog` tier (getCardArt / _polyArtSrc — where a
   Kalon form's art lives) LAST in both orders; the caches still come first. */
ok(/const order = big \? \[stable, resident, thumb, mp, catalog\] : \[stable, thumb, resident, mp, catalog\];/.test(SRC),
  'a stable cloud URL always wins; `big` only decides whether full art or the 160px thumb comes next');
{
  const f = SRC.slice(SRC.indexOf('function _abilityArtBest(cardId, big) {'), SRC.indexOf('function _abilityArtKnown(cardId) {'));
  ok(/_lazyTouch\('car', i\)/.test(f),
    'reading the resident art LRU-TOUCHES it — that is what makes a blob: safe to hand out: newest of 500, so a 14s panel cannot outlive it');
  ok(!/slice\(0, 5\) !== 'blob:'/.test(f),
    'the blob: refusal is GONE from the resolver — it was rejecting the very art the board is drawing');
  ok(/_lazyLoadCardArt\(i, true\)/.test(f),
    'nothing resident → the disk read is kicked, FORCED, so the next paint has it (the _carIds index is not proof of absence)');
}
ok(/return id \? \[id, 'u_' \+ id, 'h_' \+ id\] : \[\];/.test(SRC),
  'the hero and unit sibling ids are tried — the Forge saves art under h_/u_ and a battle unit carries only the bare card id');

/* ── the panel: art, or nothing ───────────────────────────────────────────── */
ok(/if \(!art && !_abilityArtKnown\(cid\)\) return '';/.test(SRC),
  'NO ART AND NONE COMING → NO BOX. This is the black square the owner pointed at, and it is not emitted at all');
ok(/\(art \? '' : ';display:none'\)/.test(SRC),
  '…and while a streamed read is still in flight the box is emitted HIDDEN, so the square cannot flash up on that path either');
ok(/function _abilityArtWatch\(domId, cardId\) \{/.test(SRC) && /let tries = 12;/.test(SRC),
  'the panel is a one-shot DOM node that never repaints, so the art is polled in and filled when it lands');
{
  const w = SRC.slice(SRC.indexOf('function _abilityArtWatch(domId, cardId) {'), SRC.indexOf('function _abilityArtWatch(domId, cardId) {') + 700);
  ok(/if \(!box\) return;/.test(w), '…and the poll stops dead when the panel closes — no timer outlives the thing it was filling');
  ok(/img\.src = String\(art\); box\.style\.display = '';/.test(w), '…revealing the frame only once there is something in it');
}
ok(/onerror="this\.style\.display=\\'none\\'"/.test(SRC),
  'every art <img> still hides itself on a failed load — the guarantee that makes a revocable URL acceptable');

/* ── the cinematic ────────────────────────────────────────────────────────── */
ok(/let _ar = \(typeof _abilityArtBest === 'function'\) \? _abilityArtBest\(cardId, true\) : null;/.test(SRC),
  'the full-screen cinematic asks for FULL art, not the 160px thumb');
ok(/artUrl: \(typeof _abilityArtBest === 'function'\) \? _abilityArtBest\(cardId, true\) : null,/.test(SRC),
  '…and so does its canvas fallback');
ok(/const _fr = \(typeof _abilityFrameUrl === 'function'\)/.test(SRC),
  'the cinematic keeps a frame for a card that has NO art anywhere — an empty spotlight is worse than a card back');

/* ── the battle log ───────────────────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function _bcLogArt(l) {'), SRC.indexOf('function _bcLogRow(l) {'));
  ok(/_abilityArtBest\(l\.cardId, false\)/.test(f), 'the log row asks the same resolver');
  ok(!/_abilityFrameUrl/.test(f),
    'THE FRAME FALLBACK IS REMOVED from the log — the owner named it as the wrong thing to show, and it cost the row its emoji too');
  ok(/if \(!art\) return '';/.test(f), '…and no art at all still falls through to the emoji, as before');
}

/* ── run the order for real ───────────────────────────────────────────────── */
{
  const block = SRC.slice(SRC.indexOf('function _abilityArtIds(cardId) {'), SRC.indexOf('/* Is a read worth WAITING for?'));
  const touched = [];
  const g = {
    Forge: { cardArtUrl: {}, cardArt: {}, _carIds: new Set(), _thumbIds: new Set() },
    App: { _mpViz: { art: {} } },
    getThumb: (id) => g.Forge._thumbs[id] || null,
    _lazyTouch: (k, i) => touched.push(i),
    _frameUrl: (v) => v,
    _lazyLoadCardArt: () => {},
  };
  g.Forge._thumbs = {};
  const api = new Function('g', 'with (g) { ' + block + ' return { _abilityArtIds, _abilityArtBest }; }')(g);

  ok(api._abilityArtBest('', false) === null && api._abilityArtBest(null, true) === null, 'run for real: no card id, no art');
  ok(api._abilityArtBest('c1', false) === null, 'run for real: an id with nothing anywhere resolves to nothing — the caller draws no box');

  g.Forge.cardArt['c1'] = 'blob:xyz';
  ok(api._abilityArtBest('c1', false) === 'blob:xyz',
    'run for real: THE BUG — a resident blob: is now returned instead of being thrown away for a frame');
  ok(touched.includes('c1'), 'run for real: …and returning it touched the LRU, which is what makes it safe to use');

  g.Forge._thumbs['c1'] = 'data:thumb';
  ok(api._abilityArtBest('c1', false) === 'data:thumb', 'run for real: the small panel prefers the tiny thumb over a full-res decode');
  ok(api._abilityArtBest('c1', true) === 'blob:xyz', 'run for real: …and the full-screen cinematic prefers the full art');

  g.Forge.cardArtUrl['c1'] = 'https://cdn/art.png';
  ok(api._abilityArtBest('c1', false) === 'https://cdn/art.png' && api._abilityArtBest('c1', true) === 'https://cdn/art.png',
    'run for real: a stable cloud URL outranks both, either way — nothing can revoke it');

  g.Forge.cardArt['h_hero1'] = 'blob:hero';
  ok(api._abilityArtBest('hero1', true) === 'blob:hero',
    'run for real: a hero whose art is filed under h_<id> is found from the bare battle-unit id');
  g.Forge.cardArt['u_u9'] = 'blob:unit';
  ok(api._abilityArtBest('u9', true) === 'blob:unit', 'run for real: …and so is a unit filed under u_<id>');

  g.App._mpViz.art['mp1'] = 'data:mp';
  ok(api._abilityArtBest('mp1', false) === 'data:mp', 'run for real: an opponent card the multiplayer visualiser carried still resolves');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 134, 'BUILD_VERSION is v121v134 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
