/* ============================================================================
 * _heroart_smoke.mjs — 🧙 HERO ABILITIES SHOW THEIR CARD ART.
 *                                                node _heroart_smoke.mjs
 * ----------------------------------------------------------------------------
 * Owner: "make it where all hero Abilities show their card art and not this
 * emoji stuff."
 *
 * 🔴 THE ART LAYER WAS NEVER BROKEN. A hero's battle unit is built as
 * `{ id: uid(), isHero: true, heroId, name, icon }` — it carries NO cardId and
 * NO originalCardId. Every ability announcement resolved its art with
 * `unit.originalCardId || unit.cardId || null`, which for a hero is null every
 * single time. _abilityArtBest(null) returns nothing, _abilityCardHtml draws no
 * frame at all, and the row falls back to the passive's description — which
 * begins with an emoji. That emoji is what the owner was looking at.
 *
 * Nothing threw. No art was missing. The lookup was simply handed nothing.
 *
 * ⚠ AND THE CODEBASE ALREADY KNEW THE ANSWER, in exactly one place:
 *   `unit.isHero ? ('h_' + unit.heroId) : ('u_' + (unit.originalCardId || …))`
 * The ability surfaces never used it. This suite pins the rule to ONE function
 * so a third derivation cannot appear.
 * ==========================================================================*/
import fs from 'fs';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : '   <-- ' + extra)); if (!c) fails++; };

/* ── the rule, named once ────────────────────────────────────────────────── */
const fn = /function _unitArtId\(u\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_unitArtId exists', !!fn);
if (fn) {
  ok('it prefers originalCardId, then cardId', /u\.originalCardId \|\| u\.cardId/.test(fn[0]));
  ok('🧙 …and falls back to heroId for a HERO', /u\.isHero \? \(u\.heroId \|\| null\) : null/.test(fn[0]),
     'this is the whole fix — without it every hero ability resolves null');
  ok('🔴 a NON-hero never borrows heroId', /u\.isHero \?/.test(fn[0]) && !/u\.heroId \|\| null\)\s*\|\|\s*u\.heroId/.test(fn[0]),
     'a unit standing next to a hero must not wear the hero portrait');
  ok('it returns the BARE id, not the h_ form', !/'h_' \+/.test(fn[0]),
     "_abilityArtIds already expands to [id,'u_'+id,'h_'+id] — a prefixed id would look for h_h_cedric");
}
ok('the art id expander still produces the hero key',
   /return id \? \[id, 'u_' \+ id, 'h_' \+ id\] : \[\];/.test(SRC),
   'the fallback is only useful because this expands it to the key hero art is stored under');

/* ── every announce site that takes a UNIT goes through it ───────────────── */
const sites = [
  ["a passive firing",      /cardId: _unitArtId\(unit\),\s*\/\* \u{1F9D9} heroes have heroId, not cardId \*\//u],
  ["a silenced unit",       /kind: 'status', cardId: _unitArtId\(_sil\)/],
  ["a status landing",      /kind: 'status', cardId: _unitArtId\(u\)/],
  /* 🔴 GUARDED, and the guard is the point. This site is inside _punishEntry,
     which wraps its whole body in one try/catch that returns the state
     UNCHANGED — so an unresolved name in this LOG field silently cancelled
     damage that had already been calculated. Five _auraeffects assertions went
     red reporting "no damage" rather than "unknown identifier". Asserting the
     guarded form rather than the bare call is the stronger property: it pins
     that a presentational field cannot abort a rules effect. */
  ["a counter response",    /cardId: \(typeof _unitArtId === 'function'\) \? _unitArtId\(p\) : \(p\.originalCardId \|\| p\.cardId \|\| null\),/],
  ["an attack negated",     /cardId: _unitArtId\(reactant\)/],
  ["a sealed unit",         /cardId: _unitArtId\(u\), cardType: u\.isWall/],
  ["a listed unit",         /cardId: _unitArtId\(u\) \|\| u\.id/],
  ["the ActivateFX announce", /typeof _unitArtId === 'function' \? _unitArtId\(unit\) : null/],
];
for (const [name, re] of sites) ok(name + ' resolves through _unitArtId', re.test(SRC));

/* 🔴 THE REGRESSION GUARD. The old expression is the bug; if it comes back at an
   ability-announce site the hero goes silent again and nothing throws. This
   counts the remaining copies rather than forbidding the string outright —
   several are on CARD objects, where there is no hero to resolve and the
   expression is correct. The number is the tripwire: if it moves, look. */
{
  const n = (SRC.match(/cardId: [a-zA-Z_.]+\.originalCardId \|\| [a-zA-Z_.]+\.cardId/g) || []).length;
  ok('the old unit→cardId expression is down to its legitimate uses', n === 3,
     'found ' + n + ' — was 8 before this fix. A NEW one at an ability-announce site is the bug coming back; '
     + 'confirm each remaining copy is on a card or a face-down reveal, not on a unit that could be a hero');
}

/* ── the surfaces that consume it are unchanged ──────────────────────────── */
ok('the ⚡ panel still draws art or NOTHING, never an empty frame',
   /if \(!art && !_abilityArtKnown\(cid\)\) return '';/.test(SRC),
   "the owner already asked for the black box to go — this fix must not bring it back for heroes with no art");
ok('…and still watches for a late streamed read', /function _abilityArtWatch\(domId, cardId\)/.test(SRC));

console.log('');
if (fails) { console.log('❌ ' + fails + ' FAILED'); process.exit(1); }
console.log('✅ ALL PASS');
