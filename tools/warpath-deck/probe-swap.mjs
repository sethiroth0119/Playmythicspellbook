// ─────────────────────────────────────────────────────────────────────────────
// 🔬 Harness validity: does the perspective-swap loop give both sides the same
// game? Plays one match and prints, per half-turn, which REAL side acted and
// what its side-block looked like. Both columns must show the same cadence:
// one draw per turn, energy climbing 1,2,3…10, and no side acting twice.
//
//   node tools/warpath-deck/probe-swap.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { openEngine } from './engine.mjs';
import { Data } from './draft.mjs';

const E = await openEngine({ workers: 1 });
const starter = await E.pad(Data.STARTER_POOL);

const trace = await E.pages[0].evaluate(async (keys) => {
  const hA = getAllHeroes()[0], hB = getAllHeroes()[0];
  window.__wpd.neutralise([hA.id], window.__wpd.cardIdsOf(keys));
  App.battlePrep = { hero: hA, opponent: hB, customCards: [], multiplayer: false };
  App.activeCampaignNode = null; App.activeDailyChallenge = null;
  App.screen = 'battle';
  App.ui = Object.assign({}, App.ui, { aiBusy: false, counterPrompt: null });
  const st = initGame(hA, hB, [], true, null);
  const d1 = buildDeckFromKeys(keys), d2 = buildDeckFromKeys(keys);
  st.player = Object.assign({}, st.player, { hand: d1.slice(0, STARTING_HAND_SIZE), deck: d1.slice(STARTING_HAND_SIZE) });
  st.ai = Object.assign({}, st.ai, { hand: d2.slice(0, STARTING_HAND_SIZE), deck: d2.slice(STARTING_HAND_SIZE) });
  App.state = st;

  const rows = [];
  let swapped = false, half = 0;
  const snap = (phase) => {
    const forA = swapped ? App.state.ai : App.state.player;
    const forB = swapped ? App.state.player : App.state.ai;
    return { phase, half, turnNumber: App.state.turnNumber,
             A: { hand: forA.hand.length, deck: forA.deck.length, en: forA.energy, max: forA.maxEnergy },
             B: { hand: forB.hand.length, deck: forB.deck.length, en: forB.energy, max: forB.maxEnergy } };
  };
  while (!App.state.gameOver && half < 24) {
    if (App.state.turn === 'player') { App.state = swapBattlePerspective(App.state); swapped = !swapped; }
    // whoever is 'ai' right now is about to act; in the unswapped frame that is B.
    const actor = swapped ? 'A' : 'B';
    rows.push(Object.assign(snap('before'), { actor }));
    App.ui.aiBusy = true;
    App.state = Object.assign({}, App.state, {
      units: App.state.units.map(u => u && u.owner === 'ai' ? Object.assign({}, u, { aiActed: false }) : u) });
    scheduleAIStep(0);
    await new Promise(res => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (!App.ui.aiBusy) { clearInterval(iv); res(); }
        else if (App.state.gameOver && Date.now() - t0 > 250) { clearInterval(iv); res(); }
        else if (Date.now() - t0 > 12000) { clearInterval(iv); try { finishAIPhase(); } catch (e) {} res(); }
      }, 2);
    });
    half++;
  }
  return rows;
}, starter);

console.log('half  actor  turn#   A hand/deck en/max     B hand/deck en/max');
for (const r of trace) {
  console.log(String(r.half).padStart(4), '  ', r.actor, '   ', String(r.turnNumber).padStart(3), '   ',
    `${r.A.hand}/${r.A.deck} ${r.A.en}/${r.A.max}`.padEnd(20),
    `${r.B.hand}/${r.B.deck} ${r.B.en}/${r.B.max}`);
}
const actors = trace.map(r => r.actor).join('');
console.log('\nactor sequence:', actors);
console.log('alternates cleanly:', !/AA|BB/.test(actors));
await E.close();
