/* ══════════════════════════════════════════════════════════════════════════
   TURN EFFECTS PROBE — the three v121 asks, run through the REAL reducers.

   Loads public/index.html (public server on :8787) and drives the game's own
   functions against hand-built battle states. No battle UI is needed: these are
   pure state → state functions, reachable by name from page-evaluated code
   (top-level const/function bindings live in the global lexical scope).

     A. resetCombat / resetCombatHeroes — phase rewinds, flags refresh, heroes only
        with the hero variant, nothing on the opponent's turn
     B. returnSelf — the unit leaves the board and its card lands in hand; a hero
        is refused; a stolen unit goes to its ORIGINAL owner
     C. triggers — "at the end of your turn, return this unit" fires on
        endPlayerTurn; a player's turnStart trigger now fires on endAITurn
     D. required effects — the Eclipse card is unplayable without an Eclipse
        weather card in the deck and playable with one; an unmarked copy is
        never blocked

   Usage: node .gauntlet/turnfx-probe.mjs [candidate.html]      exit 0 = all pass
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));
/* optional: a candidate file served as the page (negative control / release check) */
if (process.argv[2]) {
  const html = (await import('node:fs')).readFileSync(process.argv[2], 'utf8');
  await page.route(/\/index\.html(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await page.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => typeof window.applyOnPlayEffect === 'function', null, { timeout: 30000 });

const out = await page.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail === undefined ? '' : String(detail) });
  const unit = (o) => Object.assign({ alive: true, currentHp: 20, maxHp: 20, atk: 5, def: 5, mag: 5, res: 5, spd: 1,
    statusEffects: [], hasMoved: true, hasAttacked: true, usedPriority: true, level: 1 }, o);
  const side = (o) => Object.assign({ hand: [], deck: [], graveyard: [], void: [], energy: 5, maxEnergy: 5 }, o);
  const base = (o) => Object.assign({
    turn: 'player', turnNumber: 3, phase: 'followup', log: [], timeOfDay: 'day',
    player: side(), ai: side(),
    units: [
      unit({ id: 'ph', name: 'Hero', owner: 'player', isHero: true, heroId: 'h1', pos: { x: 1, y: 1 } }),
      unit({ id: 'p1', name: 'Knight', owner: 'player', cardId: 'knight', pos: { x: 2, y: 1 } }),
      unit({ id: 'p2', name: 'Archer', owner: 'player', cardId: 'archer', pos: { x: 3, y: 1 } }),
      unit({ id: 'eh', name: 'Foe Hero', owner: 'ai', isHero: true, heroId: 'h2', pos: { x: 8, y: 8 } }),
      unit({ id: 'e1', name: 'Goblin', owner: 'ai', cardId: 'goblin', pos: { x: 7, y: 8 }, hasMoved: false, hasAttacked: false, usedPriority: false }),
    ],
  }, o);
  const U = (s, id) => (s.units || []).find(u => u && u.id === id);
  const run = (s, casterId, eff, extra) => {
    const caster = U(s, casterId);
    const card = Object.assign({ id: 'fx', name: 'Probe', type: 'spell', onPlay: eff }, extra || {});
    return applyOnPlayEffect(s, caster, card);
  };

  /* ── A. reset combat ───────────────────────────────────────────────────── */
  try {
    const s = run(base(), 'ph', { type: 'resetCombat' });
    ok('A1 resetCombat rewinds a PAST combat phase to combat', s.phase === 'combat', s.phase);
    ok('A2 …and refreshes your units', !U(s, 'p1').hasMoved && !U(s, 'p1').hasAttacked && !U(s, 'p2').hasAttacked && !U(s, 'p1').usedPriority);
    ok('A3 …but NOT your hero', U(s, 'ph').hasAttacked === true && U(s, 'ph').hasMoved === true);
    ok('A4 …and never the enemy\'s units', U(s, 'e1').hasAttacked === false && U(s, 'e1').hasMoved === false);
  } catch (e) { ok('A resetCombat ran', false, e.message); }
  try {
    const s = run(base(), 'ph', { type: 'resetCombatHeroes' });
    ok('A5 resetCombatHeroes refreshes the hero too', !U(s, 'ph').hasAttacked && !U(s, 'ph').hasMoved && !U(s, 'p1').hasAttacked);
  } catch (e) { ok('A5 ran', false, e.message); }
  try {
    const s = run(base({ phase: 'setup' }), 'ph', { type: 'resetCombat' });
    ok('A6 before Combat the phase is left alone (no skipping Setup)', s.phase === 'setup', s.phase);
  } catch (e) { ok('A6 ran', false, e.message); }
  try {
    const s0 = base({ turn: 'ai' });
    const s = run(s0, 'ph', { type: 'resetCombatHeroes' });
    ok('A7 on the OPPONENT\'s turn nothing changes', s.phase === 'followup' && U(s, 'p1').hasAttacked === true && U(s, 'ph').hasAttacked === true);
    ok('A8 …and the log says why', /not your turn/.test(JSON.stringify(s.log)));
  } catch (e) { ok('A7 ran', false, e.message); }

  /* ── B. return this unit ───────────────────────────────────────────────── */
  try {
    const s0 = base();
    const s = applyOnPlayEffect(s0, U(s0, 'p1'), { id: 'knight', name: 'Knight', type: 'unit', onPlay: { type: 'returnSelf' } });
    ok('B1 the unit leaves the board', !U(s, 'p1'), JSON.stringify((s.units || []).map(u => u.id)));
    ok('B2 …its card is in YOUR hand', (s.player.hand || []).length === 1, (s.player.hand || []).length);
    ok('B3 …and nothing went to the graveyard (a return is not a death)', (s.player.graveyard || []).length === 0);
  } catch (e) { ok('B returnSelf ran', false, e.message); }
  try {
    const s0 = base();
    const s = applyOnPlayEffect(s0, U(s0, 'ph'), { id: 'x', name: 'Spell', type: 'spell', onPlay: { type: 'returnSelf' } });
    ok('B4 a spell anchored on the hero does NOT bounce the hero', !!U(s, 'ph') && (s.player.hand || []).length === 0);
  } catch (e) { ok('B4 ran', false, e.message); }
  try {
    const s0 = base();
    s0.units = s0.units.map(u => u.id === 'p2' ? Object.assign({}, u, { _originalOwner: 'ai' }) : u);   // stolen from the AI
    const s = applyOnPlayEffect(s0, U(s0, 'p2'), { id: 'archer', name: 'Archer', type: 'unit', onPlay: { type: 'returnSelf' } });
    ok('B5 a STOLEN unit returns to its original owner\'s hand', (s.ai.hand || []).length === 1 && (s.player.hand || []).length === 0,
       'ai ' + (s.ai.hand || []).length + ' / player ' + (s.player.hand || []).length);
  } catch (e) { ok('B5 ran', false, e.message); }

  /* ── C. triggers at the turn boundary ──────────────────────────────────── */
  try {
    const s0 = base();
    s0.units = s0.units.map(u => u.id === 'p1'
      ? Object.assign({}, u, { triggers: [{ id: 't1', event: 'turnEnd', who: 'owner', effect: 'returnSelf', name: 'Retreat' }] }) : u);
    const s = endPlayerTurn(s0);
    ok('C1 "at the end of your turn, return this unit" fires on endPlayerTurn', !U(s, 'p1') && (s.player.hand || []).length >= 1,
       'p1 on board: ' + !!U(s, 'p1'));
  } catch (e) { ok('C1 ran', false, e.message); }
  try {
    const s0 = base({ turn: 'ai' });
    s0.units = s0.units.map(u => u.id === 'p1'
      ? Object.assign({}, u, { triggers: [{ id: 't2', event: 'turnEnd', who: 'owner', effect: 'returnSelf', name: 'Retreat' }] }) : u);
    const s = endAITurn(s0);
    ok('C2 …and does NOT fire at the end of the ENEMY\'s turn (who: owner)', !!U(s, 'p1'));
  } catch (e) { ok('C2 ran', false, e.message); }
  try {
    const s0 = base({ turn: 'ai' });
    s0.units = s0.units.map(u => u.id === 'p2'
      ? Object.assign({}, u, { triggers: [{ id: 't3', event: 'turnStart', who: 'owner', effect: 'gainEnergy', amount: 3, name: 'Dawn' }] }) : u);
    s0.player = Object.assign({}, s0.player, { energy: 0 });
    const s = endAITurn(s0);
    ok('C3 a PLAYER unit\'s start-of-turn trigger now fires (was dead)', /Dawn/.test(JSON.stringify(s.log)),
       (s.log || []).slice(-6).map(l => l.msg).join(' | '));
  } catch (e) { ok('C3 ran', false, e.message); }

  /* ── D. required effects ───────────────────────────────────────────────── */
  const eclipse = { id: 'wx_eclipse', name: 'Eclipse', type: 'weather', weatherType: 'eclipse', cost: 1, instanceId: 'i-ecl' };
  const filler  = { id: 'u_filler', name: 'Filler', type: 'unit', cost: 1, instanceId: 'i-fil' };
  const mkCard = (required) => ({
    id: 'c_eclipse_hunt', name: 'Eclipse Hunt', type: 'spell', cost: 2, instanceId: 'i-card',
    onPlay: { type: 'destroyTarget', radius: 99, targeted: true },
    onPlayExtra: [{ type: 'searchDeck', filter: { nameIncludes: 'Eclipse', cardType: 'weather', element: 'any' }, required: required || undefined }],
  });
  try {
    const noEcl = base({ player: side({ deck: [filler] }) });
    const r1 = _checkPlayRequirement(mkCard(true), noEcl, 'player');
    ok('D1 no Eclipse in the deck → the card CANNOT be played', typeof r1 === 'string' && r1.length > 0, r1);
    ok('D2 …and the reason names what is missing', /No matching card in your deck/.test(String(r1)), r1);
    const withEcl = base({ player: side({ deck: [filler, eclipse] }) });
    ok('D3 Eclipse in the deck → playable', _checkPlayRequirement(mkCard(true), withEcl, 'player') == null,
       _checkPlayRequirement(mkCard(true), withEcl, 'player'));
    ok('D4 an UNMARKED copy is never blocked (opt-in)', _checkPlayRequirement(mkCard(false), noEcl, 'player') == null);
    ok('D5 the AI obeys the same rule', _aiPlayReqOk(mkCard(true), base({ ai: side({ deck: [filler] }) })) === false
       && _aiPlayReqOk(mkCard(true), base({ ai: side({ deck: [eclipse] }) })) === true);
    // a required DESTROY with nothing to destroy
    const reqDestroy = { id: 'c_rd', name: 'Culling', type: 'spell', onPlay: { type: 'destroyTarget', required: true } };
    const noFoe = base(); noFoe.units = noFoe.units.filter(u => u.owner !== 'ai' || u.isHero);
    ok('D6 required destroy with no enemy unit → blocked', !!_checkPlayRequirement(reqDestroy, noFoe, 'player'));
    ok('D7 …with an enemy unit → playable', _checkPlayRequirement(reqDestroy, base(), 'player') == null);
    ok('D8 the enemy HERO does not count as a destroy target', !!_checkPlayRequirement(reqDestroy, noFoe, 'player'));
    // existing abilities keep their old pre-flight: an UNMARKED draw with an empty deck is not refused
    ok('D9 unmarked effects keep the old pre-flight (no silent change)', _effectCanResolve(base(), 'player', { type: 'drawCards', amount: 1 }, null).ok === true);
    ok('D10 card text shows the requirement', /⛔ Must:/.test(describeOnPlayEffect({ type: 'searchDeck', required: true })));
  } catch (e) { ok('D ran', false, e.message); }

  return R;
});

await browser.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
if (errors.length) console.log('page errors: ' + errors.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
