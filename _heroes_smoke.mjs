/* 🦸 THE REAL HEROES, NEVER THE MOCKUPS.

   Asked for: "Make sure this shows the actual hero that we have set up —
   never show these mockups, show the real ones we made custom."

   What this file defends, headless, by lifting the shipped functions:
     · findHeroById prefers the custom hero by id, then by NAME (a rebuilt
       "Sir Cedric" under a new id stands in for the emoji starter), and only
       then the starter — whatever the pool toggle says;
     · getAllHeroes offers only custom heroes once any exist;
     · the normalizer keeps a custom hero's art (artUrl / img);
     · the VS card reaches for that art before the emoji;
     · no screen defaults to STARTER_HEROES[0] any more.

   Run: node _heroes_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

console.log('\n=== 1. the lookup ===');
{
  const STARTERS = [{ id: 'cedric', name: 'Sir Cedric', icon: '⚔️', hp: 32, stats: { atk: 18 } }, { id: 'vex', name: 'Vex', icon: '🗡', hp: 30, stats: {} }];
  const build = (customs, toggle) => {
    const env = { STARTER_HEROES: STARTERS, Forge: { useCustomOnlyPool: toggle, customCards: customs },
                  HERO_LIFE_POINTS: 250, getAllCustomCards: () => customs, _customHeroEntries: null };
    const code = fnText('normalizeHeroEntry') + '\n' + fnText('_customHeroEntries') + '\n' + fnText('getAllHeroes') + '\n' + fnText('findHeroById') + '\n' + fnText('_defaultHeroId')
      + '\nreturn { find: findHeroById, all: getAllHeroes, def: _defaultHeroId, norm: normalizeHeroEntry };';
    delete env._customHeroEntries;
    return new Function(...Object.keys(env), code)(...Object.values(env));
  };
  const cedricCustom = { id: 'cedric_real', type: 'hero', name: 'Sir Cedric', icon: '🛡', artUrl: 'https://cdn/sir-cedric.png', stats: { atk: 20 } };
  const vexCustom = { id: 'vex', type: 'hero', name: 'Vex Nightblade', img: 'data:image/png;base64,AAA', stats: {} };
  let F = build([cedricCustom, vexCustom], false);
  ok(F.find('vex').id === 'vex' && F.find('vex').name === 'Vex Nightblade', 'a custom hero with the starter id wins even with the pool toggle OFF');
  ok(F.find('cedric').id === 'cedric_real', 'a starter id with no custom twin resolves to the custom hero of the same NAME (Sir Cedric → cedric_real)');
  ok(F.find('cedric_real').artUrl === 'https://cdn/sir-cedric.png' && F.find('vex').img === 'data:image/png;base64,AAA', 'the normalized hero keeps its art');
  ok(F.all().every((h) => h.custom) && F.all().length === 2, 'getAllHeroes offers only the two custom heroes');
  ok(F.def() === 'cedric_real', 'the default hero is the first real one, not STARTER_HEROES[0]');
  F = build([], true);
  ok(F.find('cedric').name === 'Sir Cedric' && !F.find('cedric').custom && F.all().length === 2, 'with no custom heroes at all the starters still carry the game');
  ok(F.find('nope') === null, 'an unknown id is null');
}

console.log('\n=== 2. the surfaces ===');
{
  ok(!/STARTER_HEROES\[0\] && STARTER_HEROES\[0\]\.id/.test(SRC), 'nothing falls back to STARTER_HEROES[0] any more');
  ok((SRC.match(/_defaultHeroId\(\)/g) || []).length >= 4, 'the four old fallbacks call _defaultHeroId()');
  ok(/const heroData = findCustomHeroCard\(heroId\) \|\| STARTER_HEROES\.find/.test(SRC), 'buildHero reads the custom card before the starter table');
  ok(/const _hideStarters = _customHeroEntries\(\)\.length > 0;/.test(SRC), 'the deck picker hides starters whenever a custom hero exists');
  const vs = fnText('_vsHeroArt');
  ok(/hero\.artUrl \|\| hero\.img \|\| hero\.image \|\| \(raw && \(raw\.artUrl \|\| raw\.img \|\| raw\.image\)\)/.test(vs), 'the VS card reaches for the hero\'s own art before the emoji');
  /* drive it: cold art cache, custom art on the hero → the art div, not the emoji */
  const env = { getCardArt: () => null, findCustomHeroCard: () => null, _vsCssUrl: (u) => u, _lazyLoadCardArt: () => {}, _staticSpriteThumb: () => '', escapeHtml: (t) => String(t) };
  const A = new Function(...Object.keys(env), vs + '\nreturn _vsHeroArt;')(...Object.values(env));
  const h1 = A({ id: 'cedric_real', name: 'Sir Cedric', icon: '⚔️', artUrl: 'https://cdn/sir-cedric.png' }, 'mine');
  ok(/hasart/.test(h1) && /sir-cedric\.png/.test(h1) && !/data-emo/.test(h1), 'a custom hero with art renders the art, never the ⚔️ mockup tile');
  const h2 = A({ id: 'x', name: 'X', icon: '⚔️' }, 'mine');
  ok(/data-emo="⚔️"/.test(h2), 'only a hero with no art anywhere falls to its icon');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
