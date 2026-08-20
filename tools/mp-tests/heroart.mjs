#!/usr/bin/env node
/* 🖼 HERO ART — _heroArtSrc / _heroArtIsSrc, the one resolver the main menu and
   the Warpath gate share.

   The bug this exists for: the Warpath gate drew every hero as its `icon`
   glyph, so a roster of forged custom heroes rendered as six identical
   unicorns while the main menu showed their real portraits — two places each
   resolving art their own way.

   ⚠ AND THE FAILURE MODE OF THE FIX. While extracting the resolver, a template
     literal ate the backslashes out of its regexes: /^\/?assets\//i shipped as
     /^/?assets//i. That is a SYNTAX error and got caught — but the neighbouring
     /\.(png|…)/ → /.(png|…)/ would NOT have been. It parses, matches almost
     anything, and the only symptom is portraits appearing where they should
     not. So this asserts the patterns BEHAVE, never that they merely exist. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.MP_SRC || join(ROOT, 'public', 'index.html');
const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

const start = src.indexOf('function _heroArtIsSrc');
const endMark = '  } catch (e) { return \'\'; }\n}\n';
const endAt = src.indexOf(endMark, start);
if (start < 0 || endAt < 0) { console.log('❌ could not extract _heroArtSrc from index.html'); process.exit(1); }
const body = src.slice(start, endAt + endMark.length);

const mk = (faceArt) => new Function(
  `const _cardFaceArt = ${faceArt};
   ${body}
   return { _heroArtIsSrc, _heroArtSrc };`)();

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

const G = mk('() => ""');
console.log('\n── hero art ──');

// Accepted: the shapes real artwork actually arrives in.
ok('data:image accepted',      G._heroArtIsSrc('data:image/png;base64,iVBORw0KGgo='));
ok('blob: accepted',           G._heroArtIsSrc('blob:https://x/9f8a-1'));
ok('https accepted',           G._heroArtIsSrc('https://cdn.example/hero.png'));
ok('assets/ path accepted',    G._heroArtIsSrc('assets/heroes/cedric.webp'));
ok('/assets/ path accepted',   G._heroArtIsSrc('/assets/heroes/cedric.webp'));
ok('extension + query accepted', G._heroArtIsSrc('art/lyra.png?v=3'));

/* Rejected. These are the whole point — an emoji in an <img> is a broken image,
   and it is what the gate was drawing. */
ok('the unicorn glyph is REJECTED', !G._heroArtIsSrc('🦄'));
ok('the mage glyph is REJECTED',    !G._heroArtIsSrc('🧙'));
ok('empty string rejected',         !G._heroArtIsSrc(''));
ok('a bare name rejected',          !G._heroArtIsSrc('cedric'));
ok('null rejected',                 !G._heroArtIsSrc(null));
/* The eaten-backslash case specifically: with /\.(png…)/ reduced to /.(png…)/
   this string matches and a non-image is accepted as art. */
ok('"heropng" is NOT art (dot-escape check)',    !G._heroArtIsSrc('heropng'));
ok('"unicornsvg" is NOT art (dot-escape check)', !G._heroArtIsSrc('unicornsvg'));
ok('"xassetsy" is NOT art (slash-escape check)', !G._heroArtIsSrc('xassetsy'));
ok('a real "a.png" IS art (the pattern still works)', G._heroArtIsSrc('art/a.png'));

// Resolution order: _cardFaceArt first, unwrapped from its CSS url(...) form.
const W = mk('(d) => d.face ? \'url("\' + d.face + \'")\' : ""');
ok('unwraps url("…") from _cardFaceArt', W._heroArtSrc({ face: 'assets/h/a.png' }) === 'assets/h/a.png');
ok('falls through to d.img', W._heroArtSrc({ img: 'assets/h/b.png' }) === 'assets/h/b.png');
ok('falls through to d.portrait', W._heroArtSrc({ portrait: 'https://x/c.jpg' }) === 'https://x/c.jpg');
ok('an icon-only hero resolves to ""', W._heroArtSrc({ icon: '🦄', name: 'Vex' }) === '');
ok('a missing def resolves to ""', W._heroArtSrc(null) === '');

// And the gate must actually call it.
ok('the Warpath gate uses _heroArtSrc', /_heroArtSrc === 'function'\) \? _heroArtSrc\(h\)/.test(src));
ok('a failed portrait removes itself', /onerror="this\.remove\(\)"/.test(src));
ok('_mdRoster delegates rather than copying', /const artOf = \(d\) => _heroArtSrc\(d\);/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
