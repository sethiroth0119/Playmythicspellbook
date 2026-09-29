/* ══════════════════════════════════════════════════════════════════════════
   TRAP-COST PROBE — does a counter trap set for free, pay on use, and negate?
   Owner (v173), on "Biggest Fear" (trap, trapMode 'counter', activationCost
   payLifeHero 100): "when I try to play the card it deals damage to me first
   before the card can be set … Play should set it, it do not have me play the
   cost and then when enemies do whats on the requirement then it triggers a
   response modal and then if it is yes it negate and destroy."

   Loads a candidate index.html as the real page and drives the REAL placeTrap
   and _battleActivateTrapResponse. The only stub is the cost MODAL
   (_promptCostPayment), replaced with one that pays through the real
   _applyCostPayment, so a run needs no clicks. Checks:
     1. setting the counter trap charges NO life, and the trap is on the tile;
     2. answering the window charges the life ONCE, resolves TRUE (negated),
        clears the tile and puts the card in the graveyard;
     3. cancelling the cost modal declines (FALSE) and leaves the trap set;
     4. a WALK-ON trap with a cost still asks for it at set time (unchanged).

   Usage:  node .gauntlet/trapcost-probe.mjs <candidate.html> [--url base]
   Needs the `public` preview server (port 8787).
   Exit 0 = all pass, 1 = a check failed, 2 = could not run.
   🔴 Run it against the pre-fix file first: check 1 must FAIL there.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: trapcost-probe.mjs <candidate.html>'); process.exit(2); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--url') || 'http://localhost:8787';
const html = fs.readFileSync(file, 'utf8');

const FEAR = { id: 'cc_1788238299312', name: 'Biggest Fear', type: 'trap', icon: '🦄', cost: 2, air: true,
  trapMode: 'counter', effect: { type: 'damage', amount: 12 },
  activationCost: { banish: 0, discard: 0, tribute: 0, payLifeHero: 100 } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') {
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  }
  return route.continue();
});
let out;
try {
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.placeTrap === 'function' || typeof placeTrap === 'function', null, { timeout: 30000 });
  out = await page.evaluate(async (FEAR) => {
    const R = {};
    const W = BOARD_W, H = BOARD_H;   // inBounds reads the real board size
    const mkBoard = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });
    const hero = { id: 'h_p', name: 'Hero', owner: 'player', isHero: true, alive: true, pos: { x: 4, y: 5 }, currentHp: 300, maxHp: 300, hp: 300 };
    const foe = { id: 'u_ai_1', name: 'Enemy Grunt', owner: 'ai', alive: true, pos: { x: 4, y: 1 }, currentHp: 50, maxHp: 50, hp: 50, cardId: 'x' };
    const aiHero = { id: 'h_a', name: 'AI Hero', owner: 'ai', isHero: true, alive: true, pos: { x: 4, y: 0 }, currentHp: 300, maxHp: 300, hp: 300 };
    const fresh = () => {
      const s = { player: side(), ai: side(), units: [ { ...hero }, { ...foe }, { ...aiHero } ], board: mkBoard(),
        turn: 'player', turnNumber: 1, round: 1, gameOver: false, log: [] };
      return s;
    };
    const heroHp = () => (App.state.units.find(u => u.id === 'h_p') || {}).currentHp;
    try { renderBattle = () => {}; } catch (e) {}
    try { checkPostAction = () => {}; } catch (e) {}
    try { playSpellActivationVfx = () => {}; } catch (e) {}
    let modalCalls = 0, modalAnswer = 'pay';
    _promptCostPayment = (state, sd, src, cost) => {
      modalCalls++;
      if (modalAnswer !== 'pay') return Promise.resolve(null);
      return Promise.resolve(_applyCostPayment(state, sd, src, cost, {}));
    };

    /* 1. set it */
    App.state = fresh();
    const card = { ...FEAR, instanceId: 'iid_fear_1' };
    App.state.player.hand = [card];
    const pos = { x: 4, y: 4 };
    try { placeTrap(card, pos); } catch (e) { R.setErr = String(e); }
    await new Promise(r => setTimeout(r, 50));
    const t1 = App.state.board[pos.y][pos.x].trap;
    R.set = { modalCalls, heroHp: heroHp(), trapSet: !!t1, deferred: !!(t1 && t1.costDeferred), inHand: App.state.player.hand.length };

    /* 2. answer an enemy action with it */
    if (t1) t1.setTurn = 0;
    App.state.turnNumber = 3;
    modalCalls = 0;
    let resolved = 'pending';
    App.ui = App.ui || {};
    App.ui.counterPrompt = { trigger: 'summon', sourceName: 'Enemy Grunt', _sourceId: 'u_ai_1', _timer: null,
      resolve: (v) => { resolved = v; } };
    try { await _battleActivateTrapResponse(pos.x + ',' + pos.y); } catch (e) { R.answerErr = String(e); }
    await new Promise(r => setTimeout(r, 50));
    R.answer = { modalCalls, resolved, heroHp: heroHp(),
      tileCleared: !App.state.board[pos.y][pos.x].trap,
      inGrave: (App.state.player.graveyard || []).some(c => c && c.id === FEAR.id) };

    /* 3. cancel at the cost modal */
    App.state = fresh();
    const card3 = { ...FEAR, instanceId: 'iid_fear_3' };
    App.state.player.hand = [card3];
    placeTrap(card3, pos);
    await new Promise(r => setTimeout(r, 50));
    const t3 = App.state.board[pos.y][pos.x].trap;
    if (t3) t3.setTurn = 0;
    App.state.turnNumber = 3;
    modalAnswer = 'cancel'; resolved = 'pending';
    App.ui.counterPrompt = { trigger: 'summon', sourceName: 'Enemy Grunt', _sourceId: 'u_ai_1', _timer: null,
      resolve: (v) => { resolved = v; } };
    try { await _battleActivateTrapResponse(pos.x + ',' + pos.y); } catch (e) { R.cancelErr = String(e); }
    await new Promise(r => setTimeout(r, 50));
    R.cancel = { resolved, heroHp: heroHp(), stillSet: !!App.state.board[pos.y][pos.x].trap };

    /* 4. a walk-on trap still pays when set */
    App.state = fresh();
    modalAnswer = 'pay'; modalCalls = 0;
    const walk = { ...FEAR, trapMode: undefined, instanceId: 'iid_walk_1' };
    App.state.player.hand = [walk];
    try { placeTrap(walk, pos); } catch (e) { R.walkErr = String(e); }
    await new Promise(r => setTimeout(r, 50));
    R.walk = { modalCalls, heroHp: heroHp(), trapSet: !!App.state.board[pos.y][pos.x].trap };
    return R;
  }, FEAR);
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close();
  process.exit(2);
}
await browser.close();
const fails = [];
const r = out;
if (!r.set || r.set.heroHp !== 300 || r.set.modalCalls !== 0 || !r.set.trapSet) fails.push('1 set: must not charge, must be set');
if (!r.answer || r.answer.resolved !== true || r.answer.heroHp !== 200 || r.answer.modalCalls !== 1 || !r.answer.tileCleared || !r.answer.inGrave) fails.push('2 answer: pay once, negate, destroy');
if (!r.cancel || r.cancel.resolved !== false || r.cancel.heroHp !== 300 || !r.cancel.stillSet) fails.push('3 cancel: decline, nothing spent, stays set');
if (!r.walk || r.walk.modalCalls !== 1 || r.walk.heroHp !== 200 || !r.walk.trapSet) fails.push('4 walk-on: still pays at set');
console.log(JSON.stringify({ ok: !fails.length, fails, result: r, pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(fails.length ? 1 : 0);
