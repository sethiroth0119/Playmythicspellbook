// ─────────────────────────────────────────────────────────────────────────────
// 🔎 What the SHIPPED battle bridge actually builds.
//
// run.mjs measures decks the harness hands the engine. This asks a different
// question: when public/index.html turns a Warpath collision into a battle,
// what are the two decks?
//
//   node tools/warpath-deck/probe-bridge.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { openEngine } from './engine.mjs';
import { Data } from './draft.mjs';

const E = await openEngine({ workers: 1 });
const page = E.pages[0];

const out = await page.evaluate((starter) => {
  const r = {};
  // 1. The opponent's deck in a Warpath battle. warpathStartBattle
  //    (index.html:215656) sets enemyDeckOverride: null and campaignNode: null,
  //    so initGame fills state.ai from buildAIDeck() and nothing else.
  const ai = buildAIDeck();
  r.buildAIDeck = { length: ai.length, sample: ai.slice(0, 6).map(c => c && c.id) };
  r.catalogAiDecks = ((typeof Catalog !== 'undefined' && Catalog.aiDecks) || []).length;
  r.forgeAiDecks = ((typeof Forge !== 'undefined' && Forge.aiDecks) || []).length;
  r.customCards = ((typeof getAllCustomCards === 'function') ? getAllCustomCards() : []).length;

  // 2. Drive the real bridge end to end with a real-looking battle payload.
  const heroes = getAllHeroes();
  window.__lastPrep = null;
  const realRender = window.render;
  window.render = function () {};                 // the bridge ends on render()
  warpathStartBattle({
    battle_id: 'probe-0001', kind: 'pvp',
    expedition_id: 'e1', opponent_expedition_id: 'e2',
    hero_id: heroes[0].id, opponent_name: 'A rival Hero',
    card_keys: starter,
  });
  const bp = App.battlePrep || {};
  r.prep = {
    hero: bp.hero && bp.hero.id, opponent: bp.opponent && bp.opponent.id,
    deckId: bp.deckId, enemyDeckOverride: bp.enemyDeckOverride,
    enemyLevel: bp.enemyLevel, screen: App.screen,
  };
  const saved = (Profile.decks || []).find(d => d.id === 'warpath_run_deck');
  r.savedDeck = saved ? { n: saved.cards.length } : null;
  if (saved) {
    const counts = {};
    saved.cards.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
    r.savedOver3 = Object.entries(counts).filter(([, v]) => v > MAX_COPIES_PER_CARD);
  }
  // 3. What does the deck builder hand the engine for that saved deck?
  const built = buildStarterDeck([], heroes[0].id, 'warpath_run_deck');
  const bc = {};
  built.forEach(c => { bc[c.id] = (bc[c.id] || 0) + 1; });
  r.builtDeck = { n: built.length, over3: Object.entries(bc).filter(([, v]) => v > MAX_COPIES_PER_CARD) };

  // 4. Which hero does a PvP collision pick as the opponent? (index.html:215666)
  r.pvpFoeIsAlwaysSame = heroes.filter(h => h.id !== heroes[0].id)[0].id;
  window.render = realRender;
  return r;
}, Data.STARTER_POOL);

console.log(JSON.stringify(out, null, 1));
console.log('page errors:', [...new Set(E.pageErrors)].slice(0, 5));
await E.close();
