/* ══════════════════════════════════════════════════════════════════════════
   🔄 TURN EFFECTS — reset combat, return-this-unit, turn triggers, REQUIRED

   Owner:
     "Make an effect and triggers type for start and end of the turn while units
      are on the field for example: At the end of the turn send this unit back to
      your hand."
     "Reset the combat stage and all of your unit's only action points ... also
      make it where it is one where heros can reset also."
     "Destroy 1 target unit your enemy control, then you must add an Eclipse
      weather card from your deck to your hand ... If the player cannot it cannot
      use the card or effect."

   BEHAVIOUR is proved by .gauntlet/turnfx-probe.mjs, which runs the real
   reducers in the loaded page: 26/26 on the current page, and 15 of 26 FAIL on
   the page before this change — including "a player unit's start-of-turn
   trigger fires", which is how the dead turnStart was confirmed rather than
   assumed. That probe needs the preview server, so this file pins the source
   facts it depends on, and runs in the fast gate.

   Run: node _turnfx_smoke.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
let fails = 0, passes = 0;
const has = (t) => SRC.indexOf(t) >= 0;
const count = (t) => SRC.split(t).length - 1;
function ok(label, cond, why) {
  if (cond) { passes++; console.log('  ok   ' + label); }
  else { fails++; console.log('  FAIL ' + label + (why ? '\n         ' + why : '')); }
}
/* the body of one top-level function or const arrow, by name */
function body(head) {
  const i = SRC.indexOf(head);
  if (i < 0) return '';
  const j = SRC.indexOf('\n}', i);
  const k = SRC.indexOf('\n};', i);
  const end = [j, k].filter(x => x > i).sort((a, b) => a - b)[0];
  return SRC.slice(i, end > 0 ? end : i + 4000);
}

console.log('\n── the catalogue ──');
for (const id of ['resetCombat', 'resetCombatHeroes', 'returnSelf']) {
  ok(id + ' is in ONPLAY_TYPES', new RegExp("\\{ id: '" + id + "',\\s+label: ").test(SRC));
  ok('…has an engine branch', has("eff.type === '" + id + "'"));
  ok('…has card text', has("case '" + id + "':"));
  ok('…sits in a picker group', new RegExp("ids: \\[[^\\]]*'" + id + "'").test(SRC),
     'an ungrouped effect is missing from the categorised picker');
}
ok('hero reset is a TYPE, not a checkbox (reachable from every editor)',
   !has("ed-onplay-resetheroes") && has("const withHeroes = eff.type === 'resetCombatHeroes';"));

console.log('\n── reset combat ──');
ok('it does nothing on the opponent\'s turn', has("if (state.turn && state.turn !== owner) {"),
   'rewinding `phase` on their turn would rewind THEIR turn');
ok('the phase only moves BACK to combat, never forward past Setup', has("if (_phaseIndex(state) > ci) { state = { ...state, phase: 'combat' }; rewound = true; }"));
ok('it refreshes exactly the three action flags', has("return { ...u, hasMoved: false, hasAttacked: false, usedPriority: false };"));
ok('heroes only with the hero variant', has("if (u.isHero && !withHeroes) return u;"));

console.log('\n── return this unit ──');
ok('uses the same card rebuild as the enemy bounce', /if \(eff\.type === 'returnSelf'\) \{[\s\S]{0,900}_unitReturnToHandCard\(live\)/.test(SRC));
ok('a stolen unit goes to its ORIGINAL owner', has("const home = (live._originalOwner === 'player' || live._originalOwner === 'ai') ? live._originalOwner : live.owner;"));
ok('a hero / wall / face-down / off-board caster is refused', has("if (!live || live.isHero || live.isWall || live.isFaceDown || !live.pos"));
ok('a return is not a death — the body is removed, not killed', /if \(eff\.type === 'returnSelf'\) \{[\s\S]{0,1400}state\.units = \(state\.units \|\| \[\]\)\.filter\(u => u\.id !== live\.id\)/.test(SRC));

console.log('\n── 🔴 the start-of-YOUR-turn trigger ──');
{
  const ai = body('const endAITurn = (state) => {');
  const pl = body('const endPlayerTurn = (state, opts) => {');
  ok('endAITurn is locatable', ai.length > 200);
  ok('endAITurn fires turnStart for the PLAYER', ai.indexOf("_fireTriggers(s, 'turnStart', { actorOwner: 'player', side: 'player' })") > 0,
     'without it every "at the start of your turn" trigger on a player unit is dead');
  ok('…after startTurn(player), as the AI\'s fires after startTurn(ai)',
     ai.indexOf("s = startTurn(s, 'player');") < ai.indexOf("'turnStart', { actorOwner: 'player'"));
  ok('endPlayerTurn still fires the AI\'s', pl.indexOf("_fireTriggers(s, 'turnStart', { actorOwner: 'ai', side: 'ai' })") > 0);
  /* The multiplayer fix (P2d) added the PvP receiver's own player turnStart in
     _onRemoteStateArrived: the solo path (endAITurn) and the PvP path (turn flip)
     never both run for one turn, so the player side now has exactly TWO sites. */
  ok('turnStart fires once per side per path', count("'turnStart', { actorOwner: 'player'") === 2 && count("'turnStart', { actorOwner: 'ai'") === 1,
     'player sites ' + count("'turnStart', { actorOwner: 'player'") + ', ai sites ' + count("'turnStart', { actorOwner: 'ai'"));
  ok('…and the second player site is the PvP turn flip', /MatchBroadcast\._mpLastTurnStarted !== App\.state\.turnNumber[\s\S]{0,2500}'turnStart', \{ actorOwner: 'player'/.test(SRC));
  ok('turnEnd still fires for both sides', count("'turnEnd', { actorOwner: 'player'") === 1 && count("'turnEnd', { actorOwner: 'ai'") === 1);
}
ok('unit triggers still hand any catalogue effect to the engine', has("const eff = { ...trg, type: trg.effect };"),
   'this delegate is what makes returnSelf / resetCombat usable as trigger effects');

console.log('\n── ⛔ required effects ──');
ok('_requiredEffectsBlock exists', has('function _requiredEffectsBlock(card, state, side) {'));
ok('…reads the primary AND every extra slot', has("const list = [card.onPlay].concat(Array.isArray(card.onPlayExtra) ? card.onPlayExtra : []);"));
ok('…only for effects marked required (opt-in)', has("if (!eff || !eff.type || !eff.required) continue;"));
ok('…answers through the shared pre-flight', /function _requiredEffectsBlock[\s\S]{0,700}_effectCanResolve\(state, side \|\| 'player', eff, card\)/.test(SRC));
ok('the player play gate runs it first', has("function _checkPlayRequirement(card, state, side) {\n  { const _rq = _requiredEffectsBlock(card, state, side); if (_rq) return _rq; }"));
ok('the AI play gate runs it too', has("if (typeof _requiredEffectsBlock === 'function' && _requiredEffectsBlock(card, state, 'ai')) return false;"));
{
  const pf = body('function _effectCanResolve(state, side, eff, card) {');
  ok('_effectCanResolve is locatable', pf.length > 500);
  for (const c of ["case 'destroyTarget':", "case 'bounceUnit':", "case 'drawFiltered':", "case 'millSelf':", "case 'resetCombatHeroes':"]) {
    const i = pf.indexOf(c);
    ok('new dead end ' + c + ' is REQUIRED-only', i > 0 && pf.slice(i, i + 120).indexOf('if (!eff.required) return') > 0,
       'this function is also the pre-flight for existing abilities; an unguarded "no" turns their fizzles into refusals');
  }
  ok('the destroy check excludes heroes', pf.indexOf("u.owner === foe && !u.isHero && u.pos") > 0);
  ok('searchDeck keeps its long-standing (unconditional) check', pf.indexOf("case 'searchDeck':") > 0);
}
ok('card text marks a required effect', has("const _reqPre = eff.required ? '⛔ Must: ' : '';"));

console.log('\n── editor ──');
ok('the primary block has the Required box', has('id="ed-onplay-required"'));
ok('every extra slot has one', has('id="ed-onplayx-${i}-required"'));
ok('the primary capture writes it only when ticked', has("required:       (() => { const el = document.getElementById('ed-onplay-required'); return (el && el.checked) ? true : undefined; })(),"));
ok('the slot capture writes it only when ticked', has("required: (() => { const el = document.getElementById('ed-onplayx-' + i + '-required'); return (el && el.checked) ? true : undefined; })(),"));

console.log('\n── negative control ──');
ok('body() really can come back empty', body('const noSuchFunction_ = (') === '');

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ all ' + passes + ' passed') + ' (' + passes + '/' + (passes + fails) + ')');
process.exit(fails ? 1 : 0);
