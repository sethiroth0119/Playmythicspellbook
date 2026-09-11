/* 🔵✦ FIELD ABILITIES PAID WITH COUNTERS.

   Asked for: "field abilities need a way for units to use their counter
   effects in triggers — the game takes counters from the unit, knows if the
   unit can use it, and what happens when the counters are spent."

   Runs the REAL gate (_fieldAbilityCounterCost / _canUseFieldAbility) and the
   real after-clause (_fieldAbilityAfterCounters) against the real Counters
   engine (src/battle/effects.js) in a sandbox, then checks the editor,
   the save path, the activation, the AI and the hover row by shape.

   Run: node _fieldcounter_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const FX = readFileSync('./public/src/battle/effects.js', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
  throw new Error('unbalanced ' + name);
}

console.log('\n=== 1. the gate and the after-clause, on the real Counters engine ===');
{
  const window = {}; const ctx = { window, console, App: { ui: {} }, _unitReturnToHandCard: (u) => ({ card: { id: u.cardId, name: u.name } }) };
  ctx.window.window = window;
  vm.createContext(ctx);
  vm.runInContext(FX.replace(/\(function \(global\) \{/, '(function (global) {').replace(/\}\)\(typeof window[^;]*;\s*$/, '})(window);'), ctx);
  ok(!!window.MythicCounters && typeof window.MythicCounters.get === 'function', 'effects.js registers MythicCounters in the sandbox');
  vm.runInContext(fnText('_ctrSlug') + '\n' + fnText('_fieldAbilityOf') + '\n' + fnText('_canUseFieldAbility') + '\n' + fnText('_fieldAbilityCounterCost') + '\n' + fnText('_fieldAbilityAfterCounters'), ctx);
  const mk = (fa, start) => ({
    state: { turn: 'player', turnNumber: 3, player: { energy: 2, hand: [] }, units: [] },
    unit: { id: 'u1', name: 'Rune Adept', owner: 'player', alive: true, pos: { x: 1, y: 1 }, cardId: 'c1', fieldActive: fa, counterToken: { id: 'spellcounter', name: 'Spell Counter', icon: '🔮', start: start } },
  });
  const run = (code, t) => { ctx.__t = t; return vm.runInContext(code, ctx); };
  /* pays with its own counters */
  let t = mk({ label: 'Rune Burst', energyCost: 1, oncePerTurn: true, effect: { type: 'aoeDamage', amount: 5, radius: 1 }, counters: { n: 2, id: '', from: 'self', mode: 'also', onEmpty: 'destroySelf' } }, 3);
  t.state.units = [t.unit];
  let g = run('_canUseFieldAbility(__t.state, __t.unit)', t);
  ok(g.ok && g.cost === 1 && g.counters && g.counters.n === 2 && g.counters.have === 3 && g.counters.id === 'spellcounter' && g.counters.icon === '🔮', 'a unit with 3 of its own counters can pay 2 (energy still 1)', JSON.stringify(g));
  /* short on counters */
  t = mk({ label: 'Rune Burst', energyCost: 0, effect: { type: 'aoeDamage', amount: 5, radius: 1 }, counters: { n: 2, id: '', from: 'self', mode: 'also', onEmpty: 'none' } }, 1);
  t.state.units = [t.unit];
  g = run('_canUseFieldAbility(__t.state, __t.unit)', t);
  ok(!g.ok && /Needs 2 🔮 Spell Counters · it holds 1/.test(g.why), 'one counter short: refused, and the row says what it needs and holds', g.why);
  /* counters waive energy */
  t = mk({ label: 'Rune Burst', energyCost: 5, effect: { type: 'aoeDamage', amount: 5, radius: 1 }, counters: { n: 1, id: '', from: 'self', mode: 'instead', onEmpty: 'none' } }, 2);
  t.state.units = [t.unit]; t.state.player.energy = 0;
  g = run('_canUseFieldAbility(__t.state, __t.unit)', t);
  ok(g.ok && g.cost === 0 && g.counters.waivesEnergy === true, '"instead": counters pay and the 5-energy cost is waived even at 0 energy', JSON.stringify(g));
  /* pool: another card's counters count */
  t = mk({ label: 'Rune Burst', energyCost: 0, effect: { type: 'aoeDamage', amount: 5, radius: 1 }, counters: { n: 3, id: 'spellcounter', name: 'Spell Counter', from: 'pool', mode: 'also', onEmpty: 'none' } }, 1);
  const ally = { id: 'u2', name: 'Rune Pillar', owner: 'player', alive: true, pos: { x: 2, y: 2 }, cardId: 'c2', counterToken: { id: 'spellcounter', name: 'Spell Counter', icon: '🔮', start: 2 } };
  t.state.units = [t.unit, ally];
  g = run('_canUseFieldAbility(__t.state, __t.unit)', t);
  ok(g.ok && g.counters.from === 'pool' && g.counters.have === 3, '"any of your cards": 1 + 2 across two units pays 3', JSON.stringify(g));
  /* the after-clause: last counter spent → destroyed */
  t = mk({ label: 'Rune Burst', energyCost: 0, effect: { type: 'aoeDamage', amount: 5, radius: 1 }, counters: { n: 2, id: '', from: 'self', mode: 'also', onEmpty: 'destroySelf' } }, 2);
  t.state.units = [t.unit];
  g = run('_canUseFieldAbility(__t.state, __t.unit)', t);
  ctx.__g = g;
  const after = run('(function(){ const MC = window.MythicCounters; MC.add(__t.state, __t.unit, -__g.counters.n, __g.counters.id); return _fieldAbilityAfterCounters(__t.state, __t.unit, __g.counters, "player"); })()', t);
  ok(after.units[0].alive === false && /last Spell Counter is spent — it is destroyed/.test(after.log.map(l => l.msg).join('\n')), 'spending the last counter with "destroyed" kills the unit, and says so', after.log.map(l => l.msg).join(' | '));
  /* return to hand */
  t = mk({ label: 'Rune Burst', energyCost: 0, effect: { type: 'aoeDamage', amount: 5, radius: 1 }, counters: { n: 1, id: '', from: 'self', mode: 'also', onEmpty: 'returnHand' } }, 1);
  t.state.units = [t.unit];
  g = run('_canUseFieldAbility(__t.state, __t.unit)', t); ctx.__g = g;
  const back = run('(function(){ const MC = window.MythicCounters; MC.add(__t.state, __t.unit, -1, __g.counters.id); return _fieldAbilityAfterCounters(__t.state, __t.unit, __g.counters, "player"); })()', t);
  ok(back.units.length === 0 && back.player.hand.length === 1 && back.player.hand[0].id === 'c1', '"returns to hand": the body leaves the board and the card is in hand');
  /* counters left → nothing happens; heroes never self-destruct */
  t = mk({ label: 'Rune Burst', energyCost: 0, effect: { type: 'aoeDamage', amount: 5, radius: 1 }, counters: { n: 1, id: '', from: 'self', mode: 'also', onEmpty: 'destroySelf' } }, 3);
  t.state.units = [t.unit];
  g = run('_canUseFieldAbility(__t.state, __t.unit)', t); ctx.__g = g;
  const still = run('(function(){ const MC = window.MythicCounters; MC.add(__t.state, __t.unit, -1, __g.counters.id); return _fieldAbilityAfterCounters(__t.state, __t.unit, __g.counters, "player"); })()', t);
  ok(still.units[0].alive === true, 'with counters left the unit stays');
  t = mk({ label: 'Rune Burst', energyCost: 0, effect: { type: 'aoeDamage', amount: 5, radius: 1 }, counters: { n: 1, id: '', from: 'self', mode: 'also', onEmpty: 'destroySelf' } }, 1);
  t.unit.isHero = true; t.state.units = [t.unit];
  g = run('_canUseFieldAbility(__t.state, __t.unit)', t); ctx.__g = g;
  const hero = run('(function(){ const MC = window.MythicCounters; MC.add(__t.state, __t.unit, -1, __g.counters.id); return _fieldAbilityAfterCounters(__t.state, __t.unit, __g.counters, "player"); })()', t);
  ok(hero.units[0].alive === true, 'a hero is never destroyed by its own empty counters');
  /* no counter cost → old behaviour */
  t = mk({ label: 'Plain', energyCost: 1, effect: { type: 'aoeDamage', amount: 5, radius: 1 } }, 0);
  t.state.units = [t.unit];
  g = run('_canUseFieldAbility(__t.state, __t.unit)', t);
  ok(g.ok && g.cost === 1 && g.counters === null, 'an ability with no counter cost behaves as before');
}

console.log('\n=== 2. editor, save, activation, AI, hover row ===');
{
  ok(/id="ed-field-ctr-n"/.test(SRC) && /id="ed-field-ctr-name"/.test(SRC) && /id="ed-field-ctr-from"/.test(SRC) && /id="ed-field-ctr-mode"/.test(SRC) && /id="ed-field-ctr-empty"/.test(SRC), 'editor: counters to spend, counter name, taken from, energy mode, last-counter clause');
  ok(/counters: \(\(\) => \{\s*const n = num\('ed-field-ctr-n', 0, 99, 0\); if \(!n\) return undefined;/.test(SRC) && /id = name \? \(_ctrSlug\(name\) \|\| 'charge'\) : '';/.test(SRC) && /const _slug = _ctrSlug\(_name\) \|\| 'charge';/.test(SRC), 'save: absent at 0, name slugged the same way the counter block slugs it (one _ctrSlug on both sides, v121v114)');
  ok(/if \(_ctr\) \{ const MC = window\.MythicCounters; if \(_ctr\.from === 'pool'\) MC\.pay\(ns, 'player', _ctr\.id, _ctr\.n\); else MC\.add\(ns, unit, -_ctr\.n, _ctr\.id\); \}/.test(SRC), 'activation pays the counters before the effect fires');
  ok(/if \(_ctr\) ns = _fieldAbilityAfterCounters\(ns, unit, _ctr, 'player'\);/.test(SRC), 'activation applies the last-counter clause after the effect');
  ok(/_fieldAbilityCounterCost\(s, u, fa, 'ai'\)/.test(SRC) && /MC\.pay\(ns, 'ai', _ctr\.id, _ctr\.n\)/.test(SRC) && /_fieldAbilityAfterCounters\(ns, u, _ctr, 'ai'\)/.test(SRC), 'the AI gates, pays and settles the same way');
  ok(/const _cs = _g\.counters \? `\$\{_g\.counters\.n\} \$\{_g\.counters\.icon\} · ` : '';/.test(SRC), 'the hover row shows the counter cost');
  ok(!/_fieldAbilitySpendCounters/.test(SRC), 'no dead helper left behind');
}
ok(/window\.BUILD_VERSION = 'v12[1-9]v\d+'/.test(SRC), 'build version present');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
