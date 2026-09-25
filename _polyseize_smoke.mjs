/* 🌌 v121v151 — A SEIZED ENEMY UNIT SHOWS UP IN THE POLYCREATION MODAL.
   Run: node _polyseize_smoke.mjs

   Owner: "When stealing a unit from your enemy to use for PolyCreation Make
   sure to show the unit in the modal if it qualify to be used."

   What was wrong was not a filter. Polycreation has two resolution paths, and
   ticking the 'enemy' material source moved the card from the one WITH a modal
   to the one without: _polyFuseFromSources resolves deterministically and opens
   nothing. So the unit was never missing from the modal — the modal was never
   opened. These checks pin the narrowed diversion, the two places that would
   otherwise disagree about legality, and the two rules boundaries the change
   runs into. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const slice = (a, b, label) => {
  const lo = SRC.indexOf(a); const hi = SRC.indexOf(b, lo + 1);
  ok(lo > 0 && hi > lo, 'slice is anchored: ' + label);
  return (lo > 0 && hi > lo) ? SRC.slice(lo, hi) : '';
};

/* ── one source of truth for "may this body be taken" ─────────────────────── */
{
  const f = slice('function _polyEnemySpec(card) {', 'function _polyMatUsable', '_polyEnemySpec');
  ok(/const none = \{ enemyOk: false, alias: '' \};/.test(f),
    'DEFAULT IS NO — every card that exists today does not name the enemy source, so nothing changes for them');
  ok(/srcs\.indexOf\('enemy'\) !== -1/.test(f), 'the permission comes from the card\'s own matSources');
  ok(/alias: String\(e\.seizeTreatAs \|\| ''\)\.trim\(\)/.test(f),
    'seizeTreatAs rides along — it is what lets a seized unit stand in for a material it is not');
  ok(/card\.flipEffect/.test(f) && /card\.onPlayExtra/.test(f),
    'a trap flip and an extra on-play carry the permission too, not just the first effect');
}
{
  const f = slice('function _polyMatUsable(u, side, opts) {', 'function _polyMatShape', '_polyMatUsable');
  ok(/if \(u\.owner === side\) return true;/.test(f), 'your own units are legal exactly as before');
  ok(/if \(!\(opts && opts\.enemyOk\)\) return false;/.test(f), '…and an enemy body only with the card\'s permission');
  ok(/_unitProtectedFrom\(u, 'target'\) \|\| _unitProtectedFrom\(u, 'destroy'\)/.test(f),
    'THE PROTECTION RULE IS THE DETERMINISTIC PATH\'S OWN — re-deriving what may be torn off a board would be a second opinion');
}

/* ── the finder and the swap list ask the SAME question ───────────────────── */
ok(/const inRange = \(state\.units \|\| \[\]\)\.filter\(u =>\n    _polyMatUsable\(u, side, opts\) &&/.test(SRC),
  'the material sweep asks _polyMatUsable');
ok(/_polyMatUsable\(u, side, opts\) && u\.id !== excludeId && !t\.has\(u\.id\) &&/.test(SRC),
  'AND SO DOES THE SWAP LIST — without this the modal would fill a slot with a seized unit and then offer no way back to it');
ok(/function _polySlotAlts\(state, side, center, radius, taken, match, excludeId, opts\) \{/.test(SRC),
  '…which is why _polySlotAlts takes the spec at all');
ok(/matchFusionMaterial\(_polyMatShape\(u, side, opts\), req\)/.test(SRC),
  'the field match runs a seized body through the alias, so the modal shows what the fusion will actually accept');

/* ── the diversion narrows ONLY where a modal can open ────────────────────── */
{
  const f = slice("if (Array.isArray(eff.matSources) && eff.matSources.length) {", '// 🌌 THE PLAYER ALWAYS GETS', 'the diversion');
  ok(/const _hasPile  = eff\.matSources\.some\(s => s && s !== 'field' && s !== 'enemy'\);/.test(f),
    'hand / deck / graveyard still divert for EVERY owner — they are piles, and the picker only speaks in board slots');
  ok(/const _canModal = \(owner === 'player'\) && !eff\._autoPick;/.test(f),
    'THE MODAL IS A PLAYER-ONLY, OWN-TURN FLOW, and _autoPick is the "resolving on the opponent\'s turn" case where a picker cannot open');
  ok(/if \(_hasPile \|\| \(_hasEnemy && !_canModal\)\) \{/.test(f),
    'so an AI card, or a player trap springing on the AI\'s turn, KEEPS the deterministic path');
  // ⚠ tested against SRC, not the slice: the reasoning lives in the doc comment
  // ABOVE the `if`, and the slice deliberately starts at the code.
  ok(/whose candidate scan is/.test(SRC) && /cannot see the enemy board at all/.test(SRC),
    'and the reason is written down: the branch below the diversion scans u.owner === owner, so falling through would LOSE materials the old path found');
}

/* ── the two rules boundaries ─────────────────────────────────────────────── */
ok(/const _eo = \(side === 'player' && typeof _polyEnemySpec === 'function'\) \? _polyEnemySpec\(polySpellCard\) : null;/.test(SRC),
  "THE PERMISSION IS PLAYER-ONLY — the AI's own resolver consumes materials by id and files nothing, so a seized PLAYER card would vanish from the game instead of reaching their graveyard");
{
  const f = slice('  if (destination === \'graveyard\') {\n    consumed.forEach(u => {', '// Spawn the Kalon.', 'the consume filing');
  ok(/const owner2 = \(u\.owner === 'player'\) \? 'player' : 'ai';/.test(f),
    'A SEIZED BODY IS FILED TO ITS OWN OWNER\'S PILE');
  ok(/ns\.ai = \{ \.\.\.ns\.ai, graveyard: \[\.\.\.\(\(ns\.ai && ns\.ai\.graveyard\) \|\| \[\]\), def\] \};/.test(f),
    '…because pushing everything into YOUR graveyard would hand you the opponent\'s card, recoverable by any of this engine\'s recursion effects');
}

/* ── the modal says whose body it is ──────────────────────────────────────── */
ok(/const _seized = !!\(filled && !filled\._fromZone && filled\.owner && filled\.owner !== 'player'\);/.test(SRC),
  'the modal knows a slot is holding an enemy unit');
ok(/· seized from the enemy/.test(SRC),
  '…AND SAYS SO — a slot that reads like one of your own units hides the most important fact about the play');
ok(/const _eSpec = \(typeof _polyEnemySpec === 'function'\) \? _polyEnemySpec\(card\) : null;/.test(SRC),
  'the modal derives the spec from the same card the gate did');
ok(/const _eSpec2 = \(typeof _polyEnemySpec === 'function'\)/.test(SRC),
  '…and so does the swap HANDLER, or the ⇄ button would be visibly present and silently do nothing');

/* ── run the decision for real ────────────────────────────────────────────── */
{
  const usable = (u, side, opts) => {
    if (!u || !u.alive || u.isHero || !u.pos) return false;
    if (u.owner === side) return true;
    if (!(opts && opts.enemyOk)) return false;
    if (u.protected) return false;
    return true;
  };
  const mine = { alive: 1, pos: {}, owner: 'player' };
  const foe  = { alive: 1, pos: {}, owner: 'ai' };
  const foeP = { alive: 1, pos: {}, owner: 'ai', protected: 1 };
  ok(usable(mine, 'player', null), 'run for real: your own unit is a material with no permission at all');
  ok(!usable(foe, 'player', null), 'run for real: an enemy unit is NOT — every card that exists today is unchanged');
  ok(usable(foe, 'player', { enemyOk: true }), 'run for real: …until the card names the enemy source');
  ok(!usable(foeP, 'player', { enemyOk: true }), 'run for real: a protected enemy unit still cannot be torn off');
  ok(!usable({ alive: 1, pos: {}, owner: 'ai', isHero: 1 }, 'player', { enemyOk: true }),
    'run for real: and never a hero');

  const shape = (u, side, opts) => (!u || u.owner === side) ? u : ((opts && opts.alias) ? { ...u, treatAs: opts.alias } : u);
  ok(shape(foe, 'player', { alias: 'Brain Jelly' }).treatAs === 'Brain Jelly',
    'run for real: seizeTreatAs is applied to a seized body');
  ok(shape(mine, 'player', { alias: 'Brain Jelly' }).treatAs === undefined,
    'run for real: …and never to one of your own, which must genuinely match');

  const divert = (srcs, owner, autoPick) => {
    const hasPile = srcs.some(x => x && x !== 'field' && x !== 'enemy');
    const hasEnemy = srcs.some(x => x === 'enemy');
    const canModal = owner === 'player' && !autoPick;
    return hasPile || (hasEnemy && !canModal);
  };
  ok(divert(['field', 'grave'], 'player', false), 'run for real: a pile source still resolves deterministically');
  ok(!divert(['field', 'enemy'], 'player', false), 'run for real: a player steal-fusion on their own turn gets the MODAL');
  ok(divert(['field', 'enemy'], 'ai', false), 'run for real: the AI keeps the deterministic path it already had');
  ok(divert(['field', 'enemy'], 'player', true), 'run for real: …and so does a player trap springing on the AI\'s turn');
  ok(!divert(['field'], 'player', false), 'run for real: the classic field fusion is untouched');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 151, 'BUILD_VERSION is v121v151 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
