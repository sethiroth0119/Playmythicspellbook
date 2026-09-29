/* ══════════════════════════════════════════════════════════════════════════
   DESTROY-EXCEPT PROBE (2026-09-19). Owner: "Make this effect destroy all none
   Aquatic and flying units on the field. Within 6 tiles radius of this trap
   card activation."
   Builds that exact card — a trap whose effect is Destroy by Type · EXCEPT,
   filter = faction Aquatic, both sides, radius 6, flying spared — and springs
   it on a REAL board through the REAL applyTrapToUnit, then checks who is
   standing: the Aquatic unit, the flyer, the far unit and both heroes live;
   the grounded non-Aquatic units inside 6 tiles do not.
   Every knob is A/B'd against its own control in the same run, so a rule that
   silently does nothing cannot read as a pass:
     flying 'spared' vs 'destroyed too'  ·  radius 6 vs 0 (whole board)
     EXCEPT vs its mirror destroyMatching (the same filter, opposite victims)
     a filter left empty destroys NOTHING (it is a Board Wipe otherwise)
   Plus the editor: the type is offered, the Destroy box shows the two new
   knobs for it, and a save/reopen round-trips them.
   Usage: node .gauntlet/destroyexcept-probe.mjs <candidate.html>  (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: destroyexcept-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1200 } });
const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
await p.route(/\/(index\.html)?(\?.*)?$/, r => { const u = new URL(r.request().url()); if (u.pathname === '/' || u.pathname === '/index.html') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); return r.continue(); });
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof applyTrapToUnit === 'function' && typeof applyOnPlayEffect === 'function'
  && typeof renderCardEditor === 'function' && typeof _purgeWhat === 'function', null, { timeout: 30000 });

const R = await p.evaluate(async () => {
  const out = [];
  const ok = (name, cond, note) => out.push({ name, pass: !!cond, note: note == null ? '' : String(note) });

  /* ── the board ──────────────────────────────────────────────────────────
     Anchor (where the trap sits) is (4,4). Distances are measured with the
     page's own distance(), never assumed. */
  const W = BOARD_W, H = BOARD_H;
  const mkBoard = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y })));
  const ANCHOR = { x: 4, y: 4 };
  const U = (id, owner, x, y, extra) => Object.assign({
    id, name: id, owner, alive: true, pos: { x, y }, currentHp: 30, maxHp: 30,
    stats: { hp: 30, atk: 5, def: 3, mag: 1, res: 1, spd: 2 }, statusEffects: [], factions: [], elements: ['fire'],
  }, extra || {});
  /* the cast list: two grounded non-Aquatic units (one per side), an Aquatic
     one, a flyer, one parked as far away as the board allows, and both heroes */
  const cast = () => [
    U('ground_ai', 'ai', 4, 3),
    U('ground_pl', 'player', 3, 4),
    U('aqua', 'ai', 5, 4, { factions: ['aquatic'] }),
    U('flyer', 'ai', 4, 5, { flying: true }),
    U('far', 'ai', W - 1, H - 1),
    U('hero_pl', 'player', 2, 2, { isHero: true }),
    U('hero_ai', 'ai', 6, 6, { isHero: true }),
  ];
  const farDist = distance({ x: W - 1, y: H - 1 }, ANCHOR);
  ok('A0 the board is big enough to park a unit outside 6 tiles', farDist > 6, 'far is ' + farDist + ' tiles from the trap (' + W + 'x' + H + ')');

  const EFF = (over) => Object.assign({
    type: 'destroyExcept', filter: { faction: 'aquatic' },
    purgeSide: 'both', purgeRadius: 6, purgeFly: 'spare',
  }, over || {});
  const anchorUnit = () => ({ id: '_trap_anchor_4_4', name: 'Tidewall Snare', owner: 'player', pos: { x: 4, y: 4 }, alive: true, isHero: false });
  const state = () => ({ turn: 'ai', log: [], board: mkBoard(), units: cast(), mods: {},
    player: { energy: 9, hand: [], graveyard: [], deck: [], void: [] },
    ai: { energy: 9, hand: [], graveyard: [], deck: [], void: [] } });
  /* run the effect the way a trap runs it: the anchor is the tile, not a hero */
  const run = (eff) => {
    const st = state();
    let ns = st, threw = '';
    try {
      ns = applyOnPlayEffect(st, anchorUnit(), { name: 'Tidewall Snare', onPlay: eff, onPlayExtra: null, _actZone: 'trap' });
    } catch (e) { threw = e.message; }
    const alive = (ns.units || []).filter(u => u.alive).map(u => u.id).sort();
    return { threw, alive, dead: (ns.units || []).filter(u => !u.alive).map(u => u.id).sort() };
  };

  /* B. the owner's card, exactly */
  const r1 = run(EFF());
  ok('B1 it runs', !r1.threw, r1.threw);
  ok('B2 the grounded non-Aquatic units inside the radius are destroyed',
    r1.dead.join(',') === 'ground_ai,ground_pl', 'dead=' + r1.dead.join(','));
  ok('B3 the Aquatic unit is spared', r1.alive.indexOf('aqua') >= 0, r1.alive.join(','));
  ok('B4 the flyer is spared', r1.alive.indexOf('flyer') >= 0, r1.alive.join(','));
  ok('B5 the unit outside 6 tiles is spared', r1.alive.indexOf('far') >= 0, r1.alive.join(','));
  ok('B6 both heroes are spared', r1.alive.indexOf('hero_pl') >= 0 && r1.alive.indexOf('hero_ai') >= 0, r1.alive.join(','));

  /* C. every knob against its own control */
  const rFly = run(EFF({ purgeFly: 'all' }));
  ok('C1 control: with flying "destroyed too" the flyer falls', rFly.dead.indexOf('flyer') >= 0, 'dead=' + rFly.dead.join(','));
  const rAir = run(EFF({ purgeFly: 'only' }));
  ok('C2 "only flying" hits the flyer and nothing else', rAir.dead.join(',') === 'flyer', 'dead=' + rAir.dead.join(','));
  const rAll = run(EFF({ purgeRadius: 0 }));
  ok('C3 control: radius 0 is the whole board — the far unit falls', rAll.dead.indexOf('far') >= 0, 'dead=' + rAll.dead.join(','));
  const rNoRad = run(EFF({ purgeRadius: undefined }));
  ok('C4 …and so is no radius at all (what every saved purge card has)', rNoRad.dead.indexOf('far') >= 0, 'dead=' + rNoRad.dead.join(','));
  const rMirror = run(EFF({ type: 'destroyMatching' }));
  ok('C5 the mirror type destroys the Aquatic unit instead', rMirror.dead.join(',') === 'aqua', 'dead=' + rMirror.dead.join(','));
  const rEmpty = run(EFF({ filter: {} }));
  ok('C6 an EMPTY filter destroys nothing (it would be a Board Wipe)', rEmpty.dead.length === 0, 'dead=' + rEmpty.dead.join(','));
  const rEnemy = run(EFF({ purgeSide: 'enemy' }));
  ok('C7 "your opponent\'s" spares your own grounded unit', rEnemy.dead.join(',') === 'ground_ai', 'dead=' + rEnemy.dead.join(','));

  /* D. the REAL trap path — the radius must be centred on the tile that sprang */
  const springAt = (tx, ty) => {
    const st = state();
    st.units.push(U('stepper', 'ai', tx, ty));
    const card = { id: 'cn_trap', name: 'Tidewall Snare', type: 'trap', cost: 2, effect: { type: '' }, onPlay: EFF() };
    st.board[ty][tx].trap = { card, owner: 'player' };
    const trap = st.board[ty][tx].trap;
    let ns = st, threw = '';
    try { ns = applyTrapToUnit(st, st.units.find(u => u.id === 'stepper'), trap); } catch (e) { threw = e.message; }
    return { threw, dead: (ns.units || []).filter(u => !u.alive).map(u => u.id).sort() };
  };
  const dNear = springAt(4, 4);
  ok('D1 the trap springs and sweeps from its own tile', !dNear.threw && dNear.dead.indexOf('ground_ai') >= 0, dNear.threw || ('dead=' + dNear.dead.join(',')));
  ok('D2 …sparing Aquatic, the flyer and the far unit',
    dNear.dead.indexOf('aqua') < 0 && dNear.dead.indexOf('flyer') < 0 && dNear.dead.indexOf('far') < 0, 'dead=' + dNear.dead.join(','));
  const dFar = springAt(W - 1, H - 1);
  ok('D3 control: the SAME trap sprung in the far corner catches the far unit instead',
    dFar.dead.indexOf('far') >= 0 && dFar.dead.indexOf('ground_pl') < 0, 'dead=' + dFar.dead.join(','));

  /* E. what the card says */
  const txt = describeOnPlayEffect(EFF());
  ok('E1 the card says it destroys what the filter does NOT match', /NOT/.test(txt), txt);
  ok('E2 …names the radius', /within 6 tiles/.test(txt), txt);
  ok('E3 …and says flying is spared', /flying units are spared/i.test(txt), txt);
  const txtPlain = describeOnPlayEffect({ type: 'destroyMatching', filter: { faction: 'aquatic' }, purgeSide: 'enemy' });
  ok('E4 control: the old wording is unchanged when neither knob is set', !/within|flying/i.test(txtPlain), txtPlain);

  /* F. the editor */
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:1400px';
  document.body.appendChild(host);
  const unitCard = () => ({ id: 'de_card', name: 'Probe', type: 'unit', cost: 3, rarity: 'common',
    stats: { hp: 30, atk: 6, def: 4, mag: 2, res: 2, spd: 2 }, learnset: [{ lvl: 1, m: 'slash' }],
    onPlay: { type: 'drawCards', amount: 1 } });
  const open = (card) => {
    Forge.customCards = (Forge.customCards || []).filter(c => c.id !== card.id).concat([card]);
    App.editingCardId = card.id;
    host.innerHTML = renderCardEditor();
    try { bindCardEditor(); } catch (e) {}
    return card;
  };
  const shown = (id) => {
    const el = document.getElementById(id); if (!el) return false;
    let n = el; while (n && n !== host) { if (getComputedStyle(n).display === 'none') return false; n = n.parentElement; }
    return true;
  };
  const pickType = (t) => {
    const sel = document.getElementById('ed-onplay-type');
    sel.value = t;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    try { _fxApplyEffectGate(); } catch (e) {}
    return sel.value === t;
  };
  const card = open(unitCard());
  ok('F1 the new type is offered in the on-play picker', pickType('destroyExcept'), document.getElementById('ed-onplay-type').value);
  ok('F2 the Destroy box shows its radius for it', shown('ed-onplay-purgeradius'));
  ok('F3 …and its flying rule', shown('ed-onplay-purgefly'));
  ok('F4 …and not the stat picker, which it does not read', !shown('ed-onplay-purgestat'));
  document.getElementById('ed-onplay-purgeradius').value = '6';
  document.getElementById('ed-onplay-purgefly').value = 'spare';
  document.getElementById('ed-onplay-purgeside').value = 'both';
  captureEditorIntoCard(card);
  ok('F5 both knobs save', card.onPlay.purgeRadius === 6 && card.onPlay.purgeFly === 'spare', JSON.stringify({ r: card.onPlay.purgeRadius, f: card.onPlay.purgeFly, s: card.onPlay.purgeSide }));
  open(card);
  ok('F6 …and reopen with what was saved',
    document.getElementById('ed-onplay-purgeradius').value === '6' && document.getElementById('ed-onplay-purgefly').value === 'spare',
    document.getElementById('ed-onplay-purgeradius').value + '/' + document.getElementById('ed-onplay-purgefly').value);
  pickType('drawCards');
  captureEditorIntoCard(card);
  ok('F7 switching to an effect that reads neither drops both',
    card.onPlay.purgeRadius === undefined && card.onPlay.purgeFly === undefined, JSON.stringify(card.onPlay));
  /* radius 0 is the absence of a radius, not a 0-tile sweep */
  open(card); pickType('destroyExcept');
  document.getElementById('ed-onplay-purgeradius').value = '0';
  captureEditorIntoCard(card);
  ok('F8 a radius of 0 is saved as no radius at all', card.onPlay.purgeRadius === undefined, JSON.stringify(card.onPlay.purgeRadius));
  ok('F9 the stat effects keep their own box', (() => { open(unitCard()); return pickType('destroyStatMax') && shown('ed-onplay-purgestat') && shown('ed-onplay-purgeradius'); })());

  host.remove();
  return out;
});
await b.close();
const bad = R.filter(r => !r.pass);
R.forEach(r => console.log((r.pass ? '  ok   ' : '  FAIL ') + r.name + (r.note ? '   [' + r.note + ']' : '')));
if (errs.length) console.log('\npage errors:\n' + errs.slice(0, 6).map(e => '  ' + e).join('\n'));
console.log(bad.length ? `\n${bad.length} of ${R.length} FAILED` : `\nALL ${R.length} PASS`);
process.exit(bad.length ? 1 : 0);
