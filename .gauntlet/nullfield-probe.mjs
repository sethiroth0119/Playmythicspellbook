/* ══════════════════════════════════════════════════════════════════════════
   NULL FIELD PROBE (2026-09-19). Owner: "Add this effect While this card is on
   the field all units and hero's cannot activate their abilities and all
   passives are disabled."
   Drives the REAL predicates every negation already flows through — hasPassive,
   _canUseFieldAbility, _isNegated, getStatBonus (auras), _isSilencedBy — with a
   Null Field card on the board and without it, in the same run:
     · both sides lose their passives, HEROES included, the source's controller
       too (it is symmetric on purpose);
     · a unit that ARRIVES while it stands is covered — the point of a live
       board read rather than negateField's stamp;
     · it ends the instant the card leaves the field;
     · it does NOT switch itself off: the source keeps declaring it, while
       every OTHER continuous declaration on the board (a suppression aura) is
       sealed;
     · it works from a unit, from a persistent enchantment, and from the
       active Location — the three shapes that sit on the field.
   Every check has its control in the same run, so a predicate that is simply
   broken cannot read as a pass.
   Usage: node .gauntlet/nullfield-probe.mjs <candidate.html>   (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: nullfield-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
await p.route(/\/(index\.html)?(\?.*)?$/, r => { const u = new URL(r.request().url()); if (u.pathname === '/' || u.pathname === '/index.html') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); return r.continue(); });
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof hasPassive === 'function' && typeof _canUseFieldAbility === 'function'
  && typeof _nullFieldSrc === 'function' && typeof getStatBonus === 'function', null, { timeout: 30000 });

const R = await p.evaluate(async () => {
  const out = [];
  const ok = (name, cond, note) => out.push({ name, pass: !!cond, note: note == null ? '' : String(note) });

  /* ── the cards ──────────────────────────────────────────────────────────
     The Null Field itself is authored the way a player would: an ordinary card
     whose on-play slot carries the effect. The board unit keeps only a cardId,
     so the declaration has to be resolved off the definition. */
  const NF = { id: 'nf_card', name: 'The Hollow Verdict', type: 'unit', cost: 5,
    stats: { hp: 40, atk: 5, def: 5, mag: 5, res: 5, spd: 2 }, learnset: [{ lvl: 1, m: 'slash' }],
    onPlay: { type: 'nullField' } };
  const SIL = { id: 'nf_sil', name: 'Hushbearer', type: 'unit', cost: 4,
    stats: { hp: 30, atk: 5, def: 3, mag: 1, res: 1, spd: 2 }, learnset: [{ lvl: 1, m: 'slash' }],
    onPlay: { type: 'auraSilence' } };
  /* a card with a FIELD ABILITY, so the activation gate has something to refuse */
  const ACT = { id: 'nf_act', name: 'Bell Ringer', type: 'unit', cost: 3,
    stats: { hp: 30, atk: 5, def: 3, mag: 1, res: 1, spd: 2 }, learnset: [{ lvl: 1, m: 'slash' }],
    fieldActive: { enabled: true, effect: { type: 'drawCards', amount: 1 }, energyCost: 0 } };
  const ENCH = { id: 'nf_ench', name: 'Sealing Chant', type: 'spell', cost: 4, onPlay: { type: 'nullField' } };
  const LOC = { id: 'nf_loc', name: 'The Quiet Waste', type: 'location', cost: 4, onPlay: { type: 'nullField' } };
  Forge.customCards = (Forge.customCards || []).filter(c => !/^nf_/.test(c.id)).concat([NF, SIL, ACT, ENCH, LOC]);

  const U = (id, owner, cardId, extra) => Object.assign({
    id, name: id, owner, alive: true, pos: { x: 3, y: 3 }, currentHp: 30, maxHp: 30,
    stats: { hp: 30, atk: 6, def: 3, mag: 1, res: 1, spd: 2 }, statusEffects: [],
    passives: ['tidalFury'], cardId, originalCardId: cardId,
  }, extra || {});
  const mkState = (units, extra) => Object.assign({
    turn: 'player', log: [], mods: {}, board: Array.from({ length: BOARD_H }, (_, y) => Array.from({ length: BOARD_W }, (_, x) => ({ x, y }))),
    units, player: { energy: 9, hand: [], graveyard: [], deck: [] }, ai: { energy: 9, hand: [], graveyard: [], deck: [] },
  }, extra || {});
  /* the engine rebuilds state.units for every board change, and both memos here
     key on that array's identity — so the probe rebuilds it too, rather than
     mutating in place, which is what the real board does. */
  const put = (units, extra) => { App.state = mkState(units, extra); App.ui = App.ui || {}; App.ui.aiBusy = false; return App.state; };

  const plain = () => [
    U('ally', 'player', 'nf_act', { pos: { x: 2, y: 3 } }),
    U('foe', 'ai', 'nf_act', { pos: { x: 6, y: 3 } }),
    U('hero_pl', 'player', 'nf_act', { isHero: true, pos: { x: 1, y: 1 }, passives: ['tidalFury'] }),
  ];
  const withNF = (owner) => plain().concat([U('nf', owner || 'player', 'nf_card', { name: 'The Hollow Verdict', pos: { x: 4, y: 4 }, passives: [] })]);
  const uOf = (id) => (App.state.units || []).find(u => u.id === id);

  /* A. the control: everything works with no Null Field on the board */
  put(plain());
  ok('A1 control: a unit has its passive', hasPassive(uOf('ally'), 'tidalFury'));
  ok('A2 control: so does the hero', hasPassive(uOf('hero_pl'), 'tidalFury'));
  ok('A3 control: a field ability can be activated', _canUseFieldAbility(App.state, uOf('ally')).ok,
    JSON.stringify(_canUseFieldAbility(App.state, uOf('ally'))));
  ok('A4 control: no Null Field is reported', !_nullFieldSrc(App.state));

  /* B. …and with one standing */
  put(withNF('player'));
  ok('B1 the Null Field is found', !!_nullFieldSrc(App.state), JSON.stringify(_nullFieldSrc(App.state)));
  ok('B2 your own unit loses its passive', !hasPassive(uOf('ally'), 'tidalFury'));
  ok('B3 the enemy unit loses its passive', !hasPassive(uOf('foe'), 'tidalFury'));
  ok('B4 the HERO loses its passive', !hasPassive(uOf('hero_pl'), 'tidalFury'));
  const gate = _canUseFieldAbility(App.state, uOf('ally'));
  ok('B5 an ability cannot be activated', !gate.ok, JSON.stringify(gate));
  ok('B6 …and the row says why, by name', /Null Field|Hollow Verdict/.test(gate.why || ''), gate.why);
  ok('B7 _isNegated agrees for every unit on the board',
    (App.state.units || []).every(u => _isNegated(u)), (App.state.units || []).filter(u => !_isNegated(u)).map(u => u.id).join(','));

  /* C. it is symmetric — an ENEMY Null Field seals its own controller too */
  put(withNF('ai'));
  ok('C1 an enemy Null Field seals your units', !hasPassive(uOf('ally'), 'tidalFury'));
  ok('C2 …and its own side', !hasPassive(uOf('foe'), 'tidalFury'));

  /* D. a unit that ARRIVES while it stands (negateField's blind spot) */
  put(withNF('player'));
  App.state = Object.assign({}, App.state, { units: App.state.units.concat([U('late', 'ai', 'nf_act', { pos: { x: 7, y: 7 } })]) });
  ok('D1 a unit that arrives later is covered too', !hasPassive(uOf('late'), 'tidalFury'));

  /* E. it ends when the card leaves the field */
  App.state = Object.assign({}, App.state, { units: App.state.units.filter(u => u.id !== 'nf') });
  ok('E1 the Null Field is gone with its card', !_nullFieldSrc(App.state));
  ok('E2 the passives come straight back', hasPassive(uOf('ally'), 'tidalFury') && hasPassive(uOf('hero_pl'), 'tidalFury'));
  ok('E3 …and so does the ability', _canUseFieldAbility(App.state, uOf('ally')).ok);
  /* a face-down card is not on the field yet — the rule every trigger follows */
  put(plain().concat([U('nf', 'player', 'nf_card', { name: 'The Hollow Verdict', pos: { x: 4, y: 4 }, passives: [], isFaceDown: true })]));
  ok('E4 a FACE-DOWN copy declares nothing', !_nullFieldSrc(App.state));
  put(plain().concat([U('nf', 'player', 'nf_card', { name: 'The Hollow Verdict', pos: { x: 4, y: 4 }, passives: [], alive: false })]));
  ok('E5 a dead one declares nothing', !_nullFieldSrc(App.state));

  /* F. it does not switch itself off, and it does seal the other continuous
        declarations on the board */
  put(plain().concat([U('sil', 'ai', 'nf_sil', { pos: { x: 5, y: 5 }, passives: [] })]));
  ok('F1 control: a suppression aura on the enemy side silences you', !!_isSilencedBy(App.state, 'player'));
  put(plain().concat([
    U('sil', 'ai', 'nf_sil', { pos: { x: 5, y: 5 }, passives: [] }),
    U('nf', 'player', 'nf_card', { name: 'The Hollow Verdict', pos: { x: 4, y: 4 }, passives: [] })]));
  ok('F2 the Null Field is still standing beside it', !!_nullFieldSrc(App.state));
  ok('F3 …and the suppression aura is sealed by it', !_isSilencedBy(App.state, 'player'));
  ok('F4 the source still declares its OWN effect', !!_unitDeclaresEffect(uOf('nf'), 'nullField'));

  /* G. auras are off too (the stat bonus is the observable) */
  const AURA = { id: 'nf_aura', name: 'Bannerman', type: 'unit', cost: 4,
    stats: { hp: 30, atk: 5, def: 3, mag: 1, res: 1, spd: 2 }, learnset: [{ lvl: 1, m: 'slash' }],
    auras: [{ enabled: true, amount: 3, mode: 'flat', stats: { atk: true }, tSide: 'allies', radius: 4 }] };
  Forge.customCards = Forge.customCards.filter(c => c.id !== 'nf_aura').concat([AURA]);
  const auraBoard = (withNull) => {
    const us = [U('ally', 'player', 'nf_act', { pos: { x: 2, y: 3 } }),
                U('banner', 'player', 'nf_aura', { pos: { x: 3, y: 3 }, passives: [] })];
    if (withNull) us.push(U('nf', 'player', 'nf_card', { name: 'The Hollow Verdict', pos: { x: 4, y: 4 }, passives: [] }));
    put(us);
    try { return getStatBonus(uOf('ally'), 'atk', App.state) | 0; } catch (e) { return 'THREW:' + e.message; }
  };
  const bOn = auraBoard(false), bOff = auraBoard(true);
  ok('G1 control: the aura gives its bonus', bOn > 0, 'atk bonus ' + bOn);
  ok('G2 …and gives nothing under a Null Field', bOff === 0, 'atk bonus ' + bOff);

  /* H. the other two shapes that sit on the field */
  put(plain(), { persistentSpells: [{ instanceId: 'e1', id: 'nf_ench', name: 'Sealing Chant', turnsLeft: 3 }] });
  ok('H1 a persistent enchantment is a Null Field source', !!_nullFieldSrc(App.state) && !hasPassive(uOf('ally'), 'tidalFury'));
  put(plain(), { activeLocation: { id: 'nf_loc', name: 'The Quiet Waste', ownerHint: 'player', fieldEffect: {} } });
  ok('H2 the active Location is one too', !!_nullFieldSrc(App.state) && !hasPassive(uOf('ally'), 'tidalFury'));
  put(plain(), { persistentSpells: [{ instanceId: 'e2', id: 'nf_act', name: 'Bell Ringer', turnsLeft: 3 }] });
  ok('H3 control: an enchantment that does NOT declare it changes nothing', !_nullFieldSrc(App.state) && hasPassive(uOf('ally'), 'tidalFury'));

  /* I. the card text */
  const lbl = (ONPLAY_TYPES.find(t => t.id === 'nullField') || {}).label || '';
  ok('I1 the effect is in the picker', !!lbl, lbl);
  ok('I2 it is in the Locks group', (ONPLAY_TYPE_GROUPS.find(g => /Locks/.test(g.label)) || { ids: [] }).ids.indexOf('nullField') >= 0);
  ok('I3 …and the suppression aura is still in it (the pinned neighbour)',
    (ONPLAY_TYPE_GROUPS.find(g => /Locks/.test(g.label)) || { ids: [] }).ids.indexOf('auraSilence') >= 0);

  App.state = null;
  return out;
});
await b.close();
const bad = R.filter(r => !r.pass);
R.forEach(r => console.log((r.pass ? '  ok   ' : '  FAIL ') + r.name + (r.note ? '   [' + r.note + ']' : '')));
if (errs.length) console.log('\npage errors:\n' + errs.slice(0, 6).map(e => '  ' + e).join('\n'));
console.log(bad.length ? `\n${bad.length} of ${R.length} FAILED` : `\nALL ${R.length} PASS`);
process.exit(bad.length ? 1 : 0);
