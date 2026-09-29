/* 🕵 SET CARDS ARE SECRET — from the other player AND from the AI.

   Asked for: "Cards that are set face down: only the player that owns them
   should be able to see them on the board. The card back that fits the title
   should be the image the player sees; make the card back glow; and make sure
   the AI or the enemy player cannot see set face-down cards and traps until
   they are flipped up."

   What this file defends, headless, through the shipped index.html:
     · the identity rule (_isHiddenFaceDown) and the name a stranger reads;
     · the token an enemy sees carries no name, wears the game's card back
       (the Secure · Contain · Protect crest) and the enemy glow class;
     · the owner's token names the unit and wears their own sleeve;
     · the board draws no HP bar on an enemy set card;
     · the AI's threat map reads a set card as 0 and its target scoring
       values one at a flat poke, never through its real stats;
     · the card back glows (CSS keyframes on both sides).

   Run: node _facedown_smoke.mjs */
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

console.log('\n=== 1. who may read a set card ===');
{
  const env = { escapeHtml: (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
                getCardBackImage: (owner) => (owner === 'player' ? 'sleeves/mine.png' : 'assets/artwork/cardback.png?v=5') };
  const code = ['_isHiddenFaceDown', '_unitNameHtml', '_setCardBackStyle', '_subterfugeTokenHtml'].map(fnText).join('\n')
    + '\nreturn { hidden: _isHiddenFaceDown, name: _unitNameHtml, token: _subterfugeTokenHtml, back: _setCardBackStyle };';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  const mine = { isFaceDown: true, owner: 'player', name: 'Cave Troll', currentHp: 40 };
  const theirs = { isFaceDown: true, owner: 'ai', name: 'Cave Troll', currentHp: 40 };
  const up = { isFaceDown: false, owner: 'ai', name: 'Cave Troll' };
  ok(!F.hidden(mine) && F.hidden(theirs) && !F.hidden(up), 'only an ENEMY face-down unit is hidden; your own and a flipped one are not');
  ok(F.name(theirs) === 'Set' && F.name(mine) === 'Cave Troll', 'a stranger reads "Set", the owner reads the name');
  const et = F.token(theirs), mt = F.token(mine);
  ok(et.indexOf('Cave Troll') < 0 && /tcb-enemy/.test(et), 'the enemy token carries no name and the enemy glow class', et);
  ok(/cardback\.png/.test(et), 'and wears the game card back (Secure · Contain · Protect)');
  ok(/Cave Troll/.test(mt) && !/tcb-enemy/.test(mt) && /sleeves\/mine\.png/.test(mt), 'the owner token names the unit and wears their own sleeve');
  ok(/hidden enemy card/.test(et) && !/Cave Troll/.test(et), 'the hover title on an enemy set card says nothing about it');
}

console.log('\n=== 2. the board and the trap tile ===');
{
  ok(/if \(occupant && !_isHiddenFaceDown\(occupant\)\) \{/.test(SRC), 'an ENEMY set unit draws NOTHING on the board — the tile looks empty until it flips');
  ok(/\} else if \(tile\.trap && tile\.trap\.owner === 'player'\) \{/.test(SRC), 'an ENEMY set trap draws NOTHING on the board');
  ok(/<div class="trap-card-back" style="\$\{_setCardBackStyle\(true\)\}"/.test(SRC) && /<div class="tcb-label">\$\{escapeHtml\(trapName\)\}<\/div>/.test(SRC), 'your own set trap still shows you its glowing back and its name');
  ok(/if \(tile\.trap && tile\.trap\.owner === 'player'\) tileClasses\.push\('has-trap'\);/.test(SRC), 'the has-trap tile glow is owner-only too');
  ok(/\$\{_isHiddenFaceDown\(occupant\) \? '' : `<div class="unit-hp">/.test(SRC), 'no HP bar on an enemy set unit (belt and braces)');
  ok(/background-image: url\('assets\/artwork\/cardback\.png\?v=5'\);/.test(SRC) && !/Settrap\.png\?v=4/.test(SRC), 'the CSS fallback is the game card back, not the old Settrap frame');
  ok(/@keyframes tcbGlow \{/.test(SRC) && /@keyframes tcbGlowEnemy \{/.test(SRC) && /animation: tcbGlow 2\.4s ease-in-out infinite;/.test(SRC) && /animation: tcbGlowEnemy 2\.4s/.test(SRC), 'the card back glows — gold for yours, red for theirs');
  ok(/prefers-reduced-motion: reduce\) \{ \.trap-card-back, \.tcb-enemy \{ animation: none; \}/.test(SRC), 'and stays still for reduced-motion players');
  ok(/if \(u\.isFaceDown\) continue;\s*\/\/ subterfuge stays DOM/.test(readFileSync('./public/sprite-live/sprite-engine-integration.js', 'utf8')), 'the 3D sprite overlay never draws a face-down unit');
  ok(/if \(t && t\.trap && t\.trap\.owner === 'player'\) list\.push\(\{ x: x \| 0, z: y \| 0, side: 'you' \}\);/.test(SRC) && /if \(u && u\.alive && u\.isFaceDown && u\.pos && u\.owner === 'player'\) \{/.test(SRC) && !/side: \(t\.trap\.owner === 'ai'\) \? 'foe' : 'you'/.test(SRC), 'the 3D stage is told about the player\'s OWN set traps and face-down units only — an enemy set card never reaches it');
}

console.log('\n=== 3. the AI is blind to a set card ===');
{
  const th = fnText('aiEstimateThreat');
  ok(/if \(attacker\.isFaceDown\) return 0;/.test(th), 'a face-down unit threatens nothing in the AI threat map (its moves are not read)');
  ok(/^const AI_SET_CARD_POKE = 30;/m.test(SRC), 'the poke value exists');
  ok(/let sc = t\.isFaceDown \? AI_SET_CARD_POKE : aiScoreAttack\(probe, t, move, App\.state, playerProf\);/.test(SRC), 'a face-down target is scored flat — never through aiScoreAttack (real HP, DEF, hero)');
  /* drive the threat function far enough to prove the early return fires before any stat is read */
  let read = 0;
  const env = { getAvailableMoves: () => { read++; return []; }, _aiThreatReachFor: () => null, distance: () => 0, calculateDamage: () => ({ damage: 99 }) };
  const T = new Function(...Object.keys(env), th + '\nreturn aiEstimateThreat;')(...Object.values(env));
  const v = T({ alive: true, isFaceDown: true, pos: { x: 0, y: 0 } }, { alive: true, pos: { x: 1, y: 0 } }, { weather: null });
  ok(v === 0 && read === 0, 'threat 0, and the set unit\'s move list was never even asked for');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
