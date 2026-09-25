/* ══════════════════════════════════════════════════════════════════════════
   CLASSIC-FX "— None —" PROBE (2026-09-19). Owner: "Make it where I can make
   the spell and trap section here say none and it will show nothing on detail.
   Because these do not have the filters that the others have in the ability
   effect section have."
   Drives the REAL editor, the REAL save, the REAL renderers and the REAL cast
   and trap paths:
     · the option exists in both dropdowns and survives a save/reopen;
     · picking it hides the payload knobs that only the classic effect reads,
       and picking an effect again brings them back;
     · a saved None card carries NO amount / status / summon / filter residue;
     · nothing is printed for it — the hand card's stats line is empty where a
       Damage card says "12 DMG", and every describer returns '';
     · a None spell still CASTS (energy spent, card to graveyard, no damage)
       and its authored On-Play — the one with the Card Filter — still fires;
     · a None trap springs, hurts nobody, and still runs its On-Play.
   Controls in the same run prove the probe can see the difference: the same
   card with Damage deals its damage and prints its line.
   Fails on the pre-fix page (there is no '' option to pick).
   Usage: node .gauntlet/classicnone-probe.mjs <candidate.html>   (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: classicnone-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1200 } });
const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
await p.route(/\/(index\.html)?(\?.*)?$/, r => { const u = new URL(r.request().url()); if (u.pathname === '/' || u.pathname === '/index.html') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); return r.continue(); });
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof renderCardEditor === 'function' && typeof captureEditorIntoCard === 'function'
  && typeof _resolveSpellAfterChain === 'function' && typeof applyTrapToUnit === 'function', null, { timeout: 30000 });

const R = await p.evaluate(async () => {
  const out = [];
  const ok = (name, cond, note) => out.push({ name, pass: !!cond, note: note == null ? '' : String(note) });

  /* ── editor harness ─────────────────────────────────────────────────── */
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:1400px';
  document.body.appendChild(host);
  const spellCard = () => ({ id: 'cn_spell', name: 'None Spell', type: 'spell', cost: 2, rarity: 'common',
    elements: ['fire'], effect: { type: 'damage', amount: 12 }, target: 'enemy' });
  const trapCard = () => ({ id: 'cn_trap', name: 'None Trap', type: 'trap', cost: 2, rarity: 'common',
    elements: ['fire'], effect: { type: 'damage', amount: 15 } });
  const open = (card) => {
    Forge.customCards = (Forge.customCards || []).filter(c => c.id !== card.id).concat([card]);
    App.editingCardId = card.id;
    host.innerHTML = renderCardEditor();
    try { bindCardEditor(); } catch (e) {}
    return card;
  };
  const shown = (id) => {
    const el = document.getElementById(id); if (!el) return false;
    let n = el.closest('.editor-field') || el.parentElement;
    while (n && n !== host) { if (getComputedStyle(n).display === 'none') return false; n = n.parentElement; }
    return true;
  };
  const pick = (selId, val) => {
    const sel = document.getElementById(selId);
    sel.value = val;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    try { _fxApplyEffectGate(); } catch (e) {}
    return sel;
  };

  /* A. the option exists, and reads as None */
  open(spellCard());
  const sSel = document.getElementById('ed-spell-effect');
  const sNone = sSel && Array.from(sSel.options).find(o => o.value === '');
  ok('A1 spell Effect Type offers an empty option', !!sNone, sNone ? sNone.label : 'missing');
  ok('A2 …labelled None', !!sNone && /none/i.test(sNone.label), sNone && sNone.label);
  open(trapCard());
  const tSel = document.getElementById('ed-trap-effect');
  const tNone = tSel && Array.from(tSel.options).find(o => o.value === '');
  ok('A3 trap Effect Type offers an empty option', !!tNone, tNone ? tNone.label : 'missing');
  ok('A4 …labelled None', !!tNone && /none/i.test(tNone.label), tNone && tNone.label);

  /* B. the payload knobs follow the pick */
  const SPELL_KNOBS = ['ed-spell-amount', 'ed-spell-target', 'ed-spell-status', 'ed-spell-duration', 'ed-spell-summon-card'];
  const TRAP_KNOBS = ['ed-trap-amount', 'ed-trap-surface', 'ed-trap-surface-radius', 'ed-trap-status'];
  open(spellCard());
  ok('B1 spell knobs are visible under Damage', SPELL_KNOBS.every(shown), SPELL_KNOBS.filter(i => !shown(i)).join(','));
  pick('ed-spell-effect', '');
  ok('B2 …and every one hides under None', SPELL_KNOBS.every(i => !shown(i)), SPELL_KNOBS.filter(shown).join(','));
  pick('ed-spell-effect', 'damage');
  ok('B3 …and comes back when an effect is picked again', SPELL_KNOBS.every(shown), SPELL_KNOBS.filter(i => !shown(i)).join(','));
  /* the cast range is a card property, not payload — it must NOT hide */
  pick('ed-spell-effect', '');
  ok('B4 cast range survives None (a card property, not payload)', shown('ed-cast-range'));
  open(trapCard());
  ok('B5 trap knobs are visible under Damage', TRAP_KNOBS.every(shown), TRAP_KNOBS.filter(i => !shown(i)).join(','));
  pick('ed-trap-effect', '');
  ok('B6 …and every one hides under None', TRAP_KNOBS.every(i => !shown(i)), TRAP_KNOBS.filter(shown).join(','));
  ok('B7 how-it-springs survives None', shown('ed-trap-mode'));

  /* C. the save round-trip */
  const c1 = open(spellCard());
  pick('ed-spell-effect', '');
  captureEditorIntoCard(c1);
  ok('C1 a None spell saves a blank type', c1.effect && c1.effect.type === '', JSON.stringify(c1.effect));
  ok('C2 …as an OBJECT (the cast path reads .type unguarded)', c1.effect && typeof c1.effect === 'object');
  ok('C3 …with no payload residue', c1.effect && Object.keys(c1.effect).join(',') === 'type', JSON.stringify(c1.effect));
  open(c1);
  ok('C4 …and reopens showing None', document.getElementById('ed-spell-effect').value === '', document.getElementById('ed-spell-effect').value);
  pick('ed-spell-effect', 'damage');
  document.getElementById('ed-spell-amount').value = '9';
  captureEditorIntoCard(c1);
  ok('C5 switching back off None saves the payload again', c1.effect.type === 'damage' && c1.effect.amount === 9, JSON.stringify(c1.effect));
  const c2 = open(trapCard());
  pick('ed-trap-effect', '');
  captureEditorIntoCard(c2);
  ok('C6 a None trap saves a blank type, no residue', c2.effect && c2.effect.type === '' && Object.keys(c2.effect).join(',') === 'type', JSON.stringify(c2.effect));

  /* D. nothing is printed for it */
  const blank = { type: '' };
  ok('D1 describeOnPlayEffect says nothing', describeOnPlayEffect(blank) === '', describeOnPlayEffect(blank));
  ok('D2 the classic describer says nothing', _afxClassicLine(blank, { name: 'x' }) === '', _afxClassicLine(blank, { name: 'x' }));
  /* The surface that actually SPEAKS the classic effect is the activation
     cinematic's subtitle (_cineCardEffectText) and the band under it
     (_afxClassicLine) — measured, the card-detail modal never printed the
     classic effect for either card, and renderHandCard computes a statsLine it
     never emits. So the A/B is on the line the player really reads. */
  const cineOf = (eff) => {
    try { return _cineCardEffectText(Object.assign(spellCard(), { effect: eff })) || ''; } catch (e) { return 'THREW:' + e.message; }
  };
  const cDmg = cineOf({ type: 'damage', amount: 12 });
  const cNone = cineOf({ type: '' });
  ok('D3 control: a Damage card announces its effect', /12 damage/i.test(cDmg), cDmg);
  ok('D4 a None card claims no effect', !/\d/.test(cNone) && !/THREW/.test(cNone), cNone);
  /* …and the card detail panel reads the same for both, i.e. picking None costs
     the player nothing they were being shown. */
  const detailOf = (eff) => {
    const c = Object.assign(spellCard(), { instanceId: 'cn_d', effect: eff, onPlay: { type: 'drawCards', amount: 2 } });
    App.state = { turn: 'player', mods: {}, log: [], board: [], units: [],
      player: { energy: 9, hand: [c], graveyard: [], deck: [] }, ai: { energy: 9, hand: [], graveyard: [], deck: [] } };
    App.ui = App.ui || {}; App.ui.aiBusy = false; App.ui.cardDetailId = 'cn_d';
    let h = ''; try { h = renderCardDetailModal() || ''; } catch (e) { h = 'THREW:' + e.message; }
    App.state = null; App.ui.cardDetailId = null;
    return h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const dDmg = detailOf({ type: 'damage', amount: 12 });
  const dNone = detailOf({ type: '' });
  ok('D5 the detail panel renders', dDmg.length > 40 && !/THREW/.test(dDmg), dDmg.slice(0, 60));
  ok('D6 …and says nothing about a None effect', !/THREW/.test(dNone) && !/damage|12/i.test(dNone), dNone.slice(0, 120));
  ok('D7 …while still showing the ability effect', /Draws 2 cards/i.test(dNone), dNone.slice(0, 120));

  /* E. it still casts, and the ability effect still runs */
  const W = BOARD_W, H = BOARD_H;
  const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y })));
  const hero = (owner, x, y) => ({ id: owner + '_h', name: owner + ' hero', owner, isHero: true, alive: true, pos: { x, y }, currentHp: 60, maxHp: 60, stats: { hp: 60, atk: 5, def: 3, mag: 3, res: 3, spd: 2 }, statusEffects: [] });
  const foe = () => ({ id: 'foe', name: 'Foe', owner: 'ai', alive: true, pos: { x: 4, y: 3 }, currentHp: 40, maxHp: 40, stats: { hp: 40, atk: 5, def: 3, mag: 1, res: 1, spd: 2 }, statusEffects: [] });
  const castWith = (eff, onPlay) => {
    const card = Object.assign(spellCard(), { instanceId: 'cn_cast', cost: 2, effect: eff, range: 6 });
    if (onPlay) card.onPlay = onPlay;
    App.ui = App.ui || {}; App.ui.aiBusy = false; App.ui.selectedCardId = null;
    App.state = { turn: 'player', mods: {}, log: [],
      player: { energy: 9, hand: [card], graveyard: [], deck: [Object.assign(spellCard(), { id: 'cn_deck', instanceId: 'cn_d1' })] },
      ai: { energy: 9, hand: [], graveyard: [], deck: [] },
      board: board(), units: [hero('player', 2, 3), hero('ai', 7, 3), foe()] };
    let threw = '';
    try { _resolveSpellAfterChain(card); } catch (e) { threw = e.message; }
    const s = App.state;
    const r = { threw, foeHp: (s.units.find(u => u.id === 'foe') || {}).currentHp,
      energy: s.player.energy, grave: s.player.graveyard.length, hand: s.player.hand.length };
    App.state = null;
    return r;
  };
  const eDmg = castWith({ type: 'damage', amount: 11 }, null);
  ok('E1 control: a Damage spell hurts the foe', !eDmg.threw && eDmg.foeHp < 40, JSON.stringify(eDmg));
  const eNone = castWith({ type: '' }, null);
  ok('E2 a None spell casts without throwing', !eNone.threw, eNone.threw);
  ok('E3 …and hurts nobody', eNone.foeHp === 40, eNone.foeHp);
  ok('E4 …and still costs energy and goes to the graveyard', eNone.energy === 7 && eNone.grave === 1, JSON.stringify(eNone));
  const eOnPlay = castWith({ type: '' }, { type: 'drawCards', amount: 1 });
  ok('E5 …and its ability On-Play still fires', !eOnPlay.threw && eOnPlay.hand === 1, JSON.stringify(eOnPlay));

  /* F. the trap */
  const spring = (eff, onPlay) => {
    const card = Object.assign(trapCard(), { effect: eff });
    if (onPlay) card.onPlay = onPlay;
    const victim = foe();
    const st = { turn: 'ai', log: [], board: board(), units: [hero('player', 2, 3), victim],
      player: { energy: 9, hand: [], graveyard: [], deck: [] }, ai: { energy: 9, hand: [], graveyard: [], deck: [] } };
    st.board[3][4].trap = { card, owner: 'player' };
    const trap = st.board[3][4].trap;
    let threw = '', ns = st;
    try { ns = applyTrapToUnit(st, victim, trap); } catch (e) { threw = e.message; }
    return { threw, hp: (ns.units.find(u => u.id === 'foe') || {}).currentHp, grave: ns.player.graveyard.length };
  };
  const tDmg = spring({ type: 'damage', amount: 13 }, null);
  ok('F1 control: a Damage trap hurts the stepper', !tDmg.threw && tDmg.hp < 40, JSON.stringify(tDmg));
  const tBlank = spring({ type: '' }, null);
  ok('F2 a None trap springs without throwing', !tBlank.threw, tBlank.threw);
  ok('F3 …and hurts nobody', tBlank.hp === 40, tBlank.hp);
  ok('F4 …and is still spent to the graveyard', tBlank.grave === 1, tBlank.grave);

  host.remove();
  return out;
});
await b.close();
const bad = R.filter(r => !r.pass);
R.forEach(r => console.log((r.pass ? '  ok   ' : '  FAIL ') + r.name + (r.note ? '   [' + r.note + ']' : '')));
if (errs.length) console.log('\npage errors:\n' + errs.slice(0, 6).map(e => '  ' + e).join('\n'));
console.log(bad.length ? `\n${bad.length} of ${R.length} FAILED` : `\nALL ${R.length} PASS`);
process.exit(bad.length ? 1 : 0);
