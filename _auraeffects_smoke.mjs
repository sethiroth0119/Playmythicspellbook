/* 🔇⚰️💥 v121v128 — the three card effects the owner asked for, run for real,
   plus the assault-prompt cost bug.

     1. "Aura: While this unit is on the field Enemy players cannot use spells,
        or activate units passive, or on play abilities."
     2. "If this unit wasn't called from your hand, send this unit to the
        graveyard at the end of your turn."
     3. "Whenever an enemy unit enters the battlefield this unit deals 10 damage
        to it, deal an extra 10 damage if it is weak to this unit faction or
        element."

   The engine halves are SLICED OUT OF index.html and evaluated here, so these
   are not regex pins on code that might not run — the rules are executed.
   Run: node _auraeffects_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* Pull one top-level `function name(...) { … }` out of the monolith by matching
   braces from its opening one. Nothing else in this file can be trusted to be
   at a fixed offset. */
function slice(name) {
  const i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  let j = SRC.indexOf('{', i), d = 0, k = j;
  for (; k < SRC.length; k++) {
    const ch = SRC[k];
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) break; }
  }
  return SRC.slice(i + 1, k + 1);
}
/* …and one whole top-level line, by its opening text. Slicing a fixed number
   of characters cut the object literal in half. */
function line(head) {
  const i = SRC.indexOf('\n' + head);
  if (i < 0) throw new Error('no line ' + head);
  return SRC.slice(i + 1, SRC.indexOf('\n', i + 1) + 1);
}

/* ── the vocabulary ───────────────────────────────────────────────────────── */
ok(/\{ id: 'auraSilence',\s+label: '🔇 Suppression Aura/.test(SRC), '🔇 Suppression Aura is an effect type an author can pick');
ok(/\{ id: 'exileIfNotFromHand', label: '⚰️ Banish Unless Called From Hand/.test(SRC), '⚰️ Banish Unless Called From Hand is an effect type');
ok(/\{ id: 'punishEntry',\s+label: '💥 Punish Arrivals/.test(SRC) && /needs: \['amount'\] \},/.test(SRC.slice(SRC.indexOf("id: 'punishEntry'"), SRC.indexOf("id: 'punishEntry'") + 300)),
  '💥 Punish Arrivals is an effect type, and its damage is an authored number');
{
  /* An id in NO group is not cosmetic — the file says so itself: a scoped
     counter cannot answer an effect whose group it cannot resolve. */
  const g = SRC.slice(SRC.indexOf('const ONPLAY_TYPE_GROUPS'), SRC.indexOf('const ONPLAY_TYPE_GROUPS') + 3000);
  /* MEMBERSHIP, not position. This used to require each id to be the LAST
     entry of its array ('id']), which the Tunnel From Deck round broke by
     appending two ids after exileIfNotFromHand in 🌟 Summon & Sacrifice —
     a green-to-red with the three ids still grouped. What the line below it
     claims is what is now tested. */
  const inGroup = (id) => new RegExp("'" + id + "'\\s*[,\\]]").test(g);
  ok(inGroup('punishEntry') && inGroup('exileIfNotFromHand') && inGroup('auraSilence'),
    'all three are IN a picker group — an ungrouped id is unanswerable by any scoped counter card');
}

/* ── 1. 🔇 the suppression aura, executed ─────────────────────────────────── */
{
  const env = {
    _cardDefById: (id) => DEFS[id] || null,
    MATCHUPS: {}, getFactionMatchup: () => ({ strongVs: [], weakVs: [] }),
  };
  const DEFS = {
    silencer: { id: 'silencer', name: 'The Hush', onPlay: { type: 'auraSilence' } },
    plain:    { id: 'plain', name: 'A Rock', onPlay: { type: 'aoeDamage', amount: 5 } },
    /* authored in an EXTRA slot, not the primary one — the whole point of
       reading the card rather than the resolution */
    extra:    { id: 'extra', name: 'Late Hush', onPlay: { type: 'drawCards' }, onPlayExtra: [{ type: 'auraSilence' }] },
  };
  const code = slice('_authoredEffectsOf') + slice('_unitDeclaresEffect') + slice('_boardDeclarers')
    + 'var _silenceMemo = null;' + slice('_isSilencedBy')
    + line('const _SILENCED_CATS')
    + slice('_battleIsLocked')
    + '\nreturn { _isSilencedBy, _battleIsLocked, _unitDeclaresEffect, _boardDeclarers };';
  const F = new Function('_cardDefById', 'MATCHUPS', 'getFactionMatchup', code);
  const api = F(env._cardDefById, env.MATCHUPS, env.getFactionMatchup);

  const U = (o) => Object.assign({ id: 'u' + Math.random(), alive: true, owner: 'ai' }, o);
  const stateWith = (units) => ({ units, player: {}, ai: {} });

  const none = stateWith([U({ cardId: 'plain', owner: 'ai' })]);
  ok(!api._isSilencedBy(none, 'player'), 'run for real: an ordinary enemy board suppresses nothing');

  const hush = stateWith([U({ cardId: 'silencer', owner: 'ai', name: 'The Hush' })]);
  ok(!!api._isSilencedBy(hush, 'player'), 'run for real: an enemy Suppression Aura suppresses YOU');
  ok(!api._isSilencedBy(hush, 'ai'), '…and not its own side — the aura is one-directional, as the card reads');
  ok(api._battleIsLocked(hush, 'player', 'spell') === true
     && api._battleIsLocked(hush, 'player', 'passive') === true
     && api._battleIsLocked(hush, 'player', 'onplay') === true,
    'run for real: all THREE named restrictions answer through the one lock every path already calls');
  ok(api._battleIsLocked(hush, 'player', 'attack') === false && api._battleIsLocked(hush, 'player', 'move') === false,
    '…and nothing else: attacking and moving are untouched, because the card does not mention them');

  const dead = stateWith([U({ cardId: 'silencer', owner: 'ai', alive: false })]);
  ok(!api._isSilencedBy(dead, 'player'), 'run for real: the aura ends the instant the unit leaves the field (it is a board read, not a status stamped on your cards)');
  const down = stateWith([U({ cardId: 'silencer', owner: 'ai', isFaceDown: true })]);
  ok(!api._isSilencedBy(down, 'player'), '…a face-down unit declares nothing — the rule every trigger in the file follows');
  const neg = stateWith([U({ cardId: 'silencer', owner: 'ai', _negatedTurns: 2 })]);
  ok(!api._isSilencedBy(neg, 'player'), '…and a negated unit projects nothing, so the aura is answerable');
  const inExtra = stateWith([U({ cardId: 'extra', owner: 'ai' })]);
  ok(!!api._isSilencedBy(inExtra, 'player'), 'run for real: authored in an EXTRA effect slot, it still works — the engine reads the CARD, not the resolution');
  /* the existing counter-lock must keep working exactly as before */
  const counterLocked = { units: [], player: { _locks: { spell: true } }, ai: {} };
  ok(api._battleIsLocked(counterLocked, 'player', 'spell') === true, 'the lock-spells COUNTER still locks — the aura is a second source of truth, not a replacement');
}

/* ── 2. 💥 punish arrivals, executed ──────────────────────────────────────── */
{
  const DEFS = {
    punisher: { id: 'punisher', name: 'Gatewarden', onPlay: { type: 'punishEntry', amount: 10 } },
    plain:    { id: 'plain', name: 'A Rock' },
  };
  /* the real shape: MATCHUPS[e].weakTo lists the elements strong against e */
  const MATCHUPS = { water: { strongVs: ['fire'], weakTo: ['nature'] }, fire: { strongVs: ['nature'], weakTo: ['water'] }, nature: { strongVs: ['water'], weakTo: ['fire'] } };
  const FACM = { knight: { strongVs: [], weakVs: ['demon'] }, demon: { strongVs: ['knight'], weakVs: [] } };
  /* ⚠ _unitArtId — the THIRD time a suite has had to be taught a name its
     sliced function started reading (HF and MARKS were the first two, both in
     _daynightperf_smoke). When a suite lifts a function out of a living file,
     every new free variable that function learns is a new way for the slice to
     fail — and here it failed SILENTLY, because _punishEntry catches everything
     and returns the state untouched, so a ReferenceError in a log field read as
     'the effect did nothing'.
     Lifted from the source rather than stubbed, so the sandbox exercises the
     real resolution instead of a copy that can drift from it. */
  const code = slice('_authoredEffectsOf') + slice('_unitDeclaresEffect') + slice('_boardDeclarers')
    + slice('_unitArtId') + slice('_punishEntry')
    + '\nreturn { _punishEntry, _unitArtId };';
  const F = new Function('_cardDefById', 'MATCHUPS', 'getFactionMatchup', 'getElementsOf', 'getFactionsOf', 'applyDamageTriggers', code);
  const api = F(
    (id) => DEFS[id] || null, MATCHUPS, (f) => FACM[f] || { strongVs: [], weakVs: [] },
    (u) => u.elements || [], (u) => u.factions || [],
    (u, dmg) => { const hp = Math.max(0, (u.currentHp | 0) - dmg); return { unit: { ...u, currentHp: hp, alive: hp > 0 }, log: [] }; });

  const warden = { id: 'w', alive: true, owner: 'ai', name: 'Gatewarden', cardId: 'punisher', elements: ['water'], factions: ['demon'] };
  const run = (arrival) => {
    const st = { units: [warden, arrival], log: [] };
    const out = api._punishEntry(st, arrival);
    return out.units.find(u => u.id === arrival.id);
  };

  /* The warden is water / demon. Neutral therefore has to be weak on NEITHER
     axis: water is not weak to water, and demon is not weak to demon. */
  const neutral = run({ id: 'a', alive: true, owner: 'player', name: 'Neutral', currentHp: 100, elements: ['water'], factions: ['demon'] });
  ok(neutral.currentHp === 90, 'run for real: an arrival that is not weak takes the flat 10', neutral.currentHp);

  /* weak by ELEMENT only — fire is weak to water, demon is not weak to demon */
  const weakElem = run({ id: 'a', alive: true, owner: 'player', name: 'Ember', currentHp: 100, elements: ['fire'], factions: ['demon'] });
  ok(weakElem.currentHp === 80, 'run for real: fire is weak to water — 10 + 10, exactly as the card reads', weakElem.currentHp);

  /* weak by FACTION only — water is not weak to water, but knight is weak to
     demon. "its faction OR element" means either axis alone is enough. */
  const weakFac = run({ id: 'a', alive: true, owner: 'player', name: 'Paladin', currentHp: 100, elements: ['water'], factions: ['knight'] });
  ok(weakFac.currentHp === 80, 'run for real: knight is weak to demon by FACTION alone — the card says faction OR element, so either axis doubles it', weakFac.currentHp);

  const own = (() => {
    const ally = { id: 'a', alive: true, owner: 'ai', name: 'Friend', currentHp: 100, elements: ['fire'], factions: [] };
    const out = api._punishEntry({ units: [warden, ally], log: [] }, ally);
    return out.units.find(u => u.id === 'a');
  })();
  ok(own.currentHp === 100, 'run for real: it punishes ENEMY arrivals only — its own side walks in free');

  const twice = (() => {
    const arr = { id: 'a', alive: true, owner: 'player', currentHp: 100, elements: ['water'], factions: [] };
    let st = { units: [warden, arr], log: [] };
    st = api._punishEntry(st, arr);
    st = api._punishEntry(st, st.units.find(u => u.id === 'a'));   // a second arrival hook sees the same unit
    return st.units.find(u => u.id === 'a');
  })();
  ok(twice.currentHp === 90, 'run for real: two arrival hooks seeing the same unit punish it ONCE — the deploy path fires both', twice.currentHp);

  const lethal = run({ id: 'a', alive: true, owner: 'player', currentHp: 8, elements: ['water'], factions: [] });
  ok(lethal.alive === false, 'run for real: an arrival that cannot survive the toll dies on the doorstep');

  const noPunisher = (() => {
    const arr = { id: 'a', alive: true, owner: 'player', currentHp: 100, elements: ['fire'], factions: [] };
    const st = { units: [{ id: 'r', alive: true, owner: 'ai', cardId: 'plain' }, arr], log: [] };
    return api._punishEntry(st, arr) === st;
  })();
  ok(noPunisher, 'an empty sweep returns the SAME state object — no needless rebuild on a board with no punisher');
}

/* ── 3. ⚰️ not called from your hand, executed ────────────────────────────── */
{
  const DEFS = { fleeting: { id: 'fleeting', name: 'Borrowed Blade', onPlay: { type: 'exileIfNotFromHand' } } };
  const code = slice('_authoredEffectsOf') + slice('_unitDeclaresEffect') + slice('_boardDeclarers') + slice('_eotNotFromHandSweep')
    + '\nreturn { _eotNotFromHandSweep };';
  const F = new Function('_cardDefById', '_battleOnUnitKilled', code);
  const api = F((id) => DEFS[id] || null, () => {});

  const summoned = { id: 's', alive: true, owner: 'player', name: 'Token Blade', cardId: 'fleeting', currentHp: 20 };
  const played   = { id: 'p', alive: true, owner: 'player', name: 'Played Blade', cardId: 'fleeting', currentHp: 20, _fromHand: true };
  const out = api._eotNotFromHandSweep({ units: [summoned, played], log: [] }, 'player');
  ok(out.units.find(u => u.id === 's').alive === false, 'run for real: the one that was SUMMONED falls at the end of your turn');
  ok(out.units.find(u => u.id === 'p').alive === true, 'run for real: the one you CALLED FROM YOUR HAND stays — that is the whole condition');
  ok(/was not called from your hand/.test((out.log[0] || {}).msg || ''), '…and the log says why, rather than a silent disappearance');

  const other = api._eotNotFromHandSweep({ units: [summoned], log: [] }, 'ai');
  ok(other.units[0].alive === true, 'run for real: it falls at the end of ITS OWNER\'s turn, not the opponent\'s');
}

/* ── the wiring that makes all three reachable ────────────────────────────── */
ok(/unit\._fromHand = true;/.test(SRC), 'the player hand-deploy stamps where the unit came from — nothing recorded it before');
ok(/aiActed: false, _fromHand: true \};   \/\/ 🖐 the AI's hand play/.test(SRC), '…and so does the AI\'s, so the effect reads the same on both sides');
ok(/if \(event === 'summon' && ctx\.unit && typeof _punishEntry === 'function'\)/.test(SRC), 'an arrival announced through the existing summon event punishes');
ok(/if \(live2 && typeof _punishEntry === 'function'\)/.test(SRC), '…and so does one an EFFECT spawned, at the choke point every summon passes');
ok(/s = _eotNotFromHandSweep\(s, 'player'\)/.test(SRC) && /s = _eotNotFromHandSweep\(s, 'ai'\)/.test(SRC), 'both turn-end paths sweep');
ok(/suppresses your abilities\.' \};/.test(SRC), 'the field-ability row says WHY it is greyed out, not just that it is');
ok(/if \(typeof _battleIsLocked === 'function' && _battleIsLocked\(s, 'ai', 'passive'\)\) break;/.test(SRC), '…and the AI is suppressed by the same rule (a player-only lock would be a card that only works one way)');
ok(/is suppressed by ' \+ \(_sil\.name \|\| 'an enemy aura'\)/.test(SRC), 'an on-play fired under the aura is refused, with the source named');
{
  const i = SRC.indexOf('function applyOnPlayEffect(state, unit, card) {');
  const body = SRC.slice(i, i + 1400);
  ok(/const _z = card && card\._actZone;\n\s*if \(\(!_z \|\| _z === 'field'\)/.test(body),
    'the aura stops exactly the two things the card names — an arrival\'s on-play and a unit\'s activated ability — and leaves grave/hand abilities and traps alone');
}
ok(/_silenceMemo\.units === state\.units/.test(SRC), 'the board read is memoised on the units array by identity, so asking on every effect resolution costs nothing');

/* ── the assault-prompt cost bug ──────────────────────────────────────────── */
ok(/const _suspended = !!\(App\.ui && \(App\.ui\.assaultPrompt \|\| App\.ui\.costPrompt\)\);\n\s*if \(!_suspended\) App\._cardCostPaid = null;/.test(SRC),
  'the cost receipt outlives a play that was only SUSPENDED — clearing it meant Skip was charged the cost a second time and the spell never fired');
ok(/if \(App\._cardCostPaid === ap\.pendingSpellCard\.instanceId\) App\._cardCostPaid = null;/.test(SRC),
  '…and the hand that FINISHES the play tears the receipt up, so it cannot outlive the play either');
ok(/function _completeAssaultAttack\(\) \{\n\s*try \{ if \(!\(App\.ui && App\.ui\.assaultPrompt && App\.ui\.assaultPrompt\.kind === 'spell'\)\) App\._cardCostPaid = null; \}/.test(SRC),
  '…and the attack half of the same overlay releases it too');
{
  /* run the receipt rule for real — it is three booleans and an ordering */
  const App = { ui: {}, _cardCostPaid: null };
  const gate = (card, again) => {
    if (App._cardCostPaid === card.instanceId) return false;    // already paid
    App._cardCostPaid = card.instanceId;
    try { again(); } finally {
      const _suspended = !!(App.ui && (App.ui.assaultPrompt || App.ui.costPrompt));
      if (!_suspended) App._cardCostPaid = null;
    }
    return true;
  };
  const card = { instanceId: 'i1', name: 'Blood Pact' };
  let charged = 0, resolved = 0;
  const playSpell = (c) => {
    if (gate(c, () => { charged++; playSpell(c); })) return;
    if (!App._inAssaultResume && !App.ui.assaultPrompt && HAND_HAS_ASSAULT) { App.ui.assaultPrompt = { kind: 'spell', pendingSpellCard: c }; return; }
    resolved++;
  };
  const HAND_HAS_ASSAULT = true;
  playSpell(card);
  ok(charged === 1 && resolved === 0 && !!App.ui.assaultPrompt, 'run for real: the cost is paid once and the play parks on the prompt', 'charged=' + charged);
  /* Skip */
  const ap = App.ui.assaultPrompt; App.ui.assaultPrompt = null;
  App._inAssaultResume = true;
  playSpell(ap.pendingSpellCard);
  App._inAssaultResume = false;
  if (App._cardCostPaid === ap.pendingSpellCard.instanceId) App._cardCostPaid = null;
  ok(charged === 1 && resolved === 1, 'run for real: Skip RESOLVES the spell and is not charged again — the exact report ("you click skip and the spell do not play even though you paid the cost")', 'charged=' + charged + ' resolved=' + resolved);
  ok(App._cardCostPaid === null, 'run for real: and the receipt is gone afterwards, so the next play pays its own way');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 128, 'BUILD_VERSION is v121v128 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
