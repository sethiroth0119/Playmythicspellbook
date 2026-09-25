/* ══════════════════════════════════════════════════════════════════════════
   🌌 REALM DECK #2 PROBE — the Realm Deck is built like Main and Side, per deck.

   Owner: "the realm cards should be added to the realm deck like the other
   cards are added to the side and main deck, but only realm card types should
   go into the realm deck only. Realm cards can go into the side deck also."

   Real code in the loaded page, driven directly (sign-in gate — no clicks
   through it). The deck builder is rendered with render() and its real grid
   thumbs / tab buttons / detail-pane buttons are clicked by their handlers.
     M  migration: a saved deck with no realm list is seeded from the legacy
        global list (Profile.archonDeck)
     T  the Realm tab turns the Collection to the REALM filter
     A  targeting: Realm tab + Realm card → this deck's Realm Deck; non-Realm
        refused there; Main refuses a Realm card; Side ACCEPTS one; Side →
        Realm; unowned refused; 3-copy cap; 21-card cap
     V  the Realm tab shows the Realm Deck's contents; remove works
     S  💾 Save stores deck.realm, mirrors it to Profile.archonDeck (keeping the
        legacy list as .legacy); two decks keep separate lists
     B  battle reads the Realm Deck of the deck actually played
     P  no Realm card reaches a draw pile, even one hand-put in a deck list or
        sitting in the Side deck

   Usage: node .gauntlet/realmdeck2-probe.mjs [candidate.html]   (:8787 up)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 120000 });
await p.waitForFunction('typeof initGame === "function" && typeof renderDeckBuilder === "function"', null, { timeout: 120000 });
await p.waitForTimeout(1500);

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const J = (x) => JSON.stringify(x);
  try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {}
  window._persistForgeNow = () => {}; window.saveForge = () => {}; window.saveProfile = () => {};
  window.saveProgressCloud = async () => {};

  const st = { hp: 40, atk: 12, def: 6, mag: 4, res: 4, spd: 2 };
  const mk = (id, extra) => Object.assign({ id, name: id, icon: '🧪', type: 'unit', rarity: 'rare', cost: 2,
    elements: ['fire'], factions: [], stats: { ...st }, learnset: [{ lvl: 1, m: 'slash' }] }, extra || {});
  const arc = { enabled: true, catalystRank: 'lesser', tier: 'lesser', kalonCost: 0, offeringRange: 2, offerings: [{ count: 1 }] };
  const C = {
    arc: mk('rd2_arc', { name: 'RD Archon', type: 'realm', realmKind: 'archon', archonSummon: JSON.parse(J(arc)) }),
    evo: mk('rd2_evo', { name: 'RD Evo', type: 'realm', realmKind: 'evo', isEvoUnit: true }),
    cv:  mk('rd2_cv',  { name: 'RD Convergent', type: 'realm', realmKind: 'convergence', convergence: { enabled: true, value: 3, element: '' } }),
    un:  mk('rd2_un',  { name: 'RD Unowned', type: 'realm', realmKind: 'evo', isEvoUnit: true }),
    unit: mk('rd2_unit', { name: 'RD Unit', rarity: 'common' }),
  };
  const fill = [];
  for (let i = 0; i < 22; i++) fill.push(mk('rd2_f' + i, { name: 'RD Filler ' + i, type: 'realm', realmKind: 'evo', isEvoUnit: true }));
  Forge.customCards = (Forge.customCards || []).filter(c => !String(c && c.id).startsWith('rd2_')).concat(Object.values(C), fill);
  Profile.cardCollection = Profile.cardCollection || {};
  [C.arc, C.evo, C.cv, C.unit].concat(fill).forEach(c => { Profile.cardCollection[c.id] = 3; });
  delete Profile.cardCollection[C.un.id];
  Profile.sideDeck = { cards: [], gems: [] };
  // the LEGACY global Realm Deck, as every player has it before this change
  Profile.archonDeck = { cards: ['custom:rd2_arc'] };
  const hero = (typeof getAllHeroes === 'function' ? getAllHeroes() : [])[0] || STARTER_HEROES[0];
  const unitKeys = new Array(40).fill('custom:rd2_unit');
  const deckA = { id: 'rd2_deckA', name: 'Deck A', heroId: hero.id, cards: unitKeys.slice(), createdAt: 1 };
  const deckB = { id: 'rd2_deckB', name: 'Deck B', heroId: hero.id, cards: unitKeys.slice(), createdAt: 2 };
  Profile.decks = (Array.isArray(Profile.decks) ? Profile.decks : []).filter(d => !String(d.id).startsWith('rd2_')).concat([deckA, deckB]);
  const byD = (id) => (Profile.decks || []).find(d => d.id === id);

  const open = async (deckId) => {
    App.screen = 'deck'; App.deckBuilderHeroId = hero.id; App.editingDeckId = deckId;
    App.deckEdit = undefined; App.deckEditName = undefined; App.aiDeckEdit = null; App.starterDeckEdit = null;
    App.deckPanelTab = 'main'; App.deckBuilderFilter = 'all'; App.deckBuilderOwnFilter = 'any';
    render(); await sleep(120);
  };
  const tab = async (t) => { const btn = document.querySelector('[data-db-ptab="' + t + '"]'); if (btn) btn.onclick(); await sleep(80); };
  const dbl = async (key, zone) => {
    const th = document.querySelector('[data-sel-zone="' + (zone || 'collection') + '"][data-sel-key="' + key + '"]');
    if (th && th.ondblclick) th.ondblclick();
    await sleep(60);
    return !!th;
  };
  const RL = () => (App.deckEditRealm || []).slice();

  try {
    // ══ M / T ═══════════════════════════════════════════════════════════════
    await open(deckA.id);
    ok('M1 a saved deck with no realm list is seeded from the legacy global Realm Deck', J(RL()) === J(['custom:rd2_arc']), J(RL()));
    await tab('archon');
    ok('T1 opening the Realm tab turns the Collection to the REALM filter', App.deckBuilderFilter === 'realm' && App.deckPanelTab === 'archon', App.deckBuilderFilter + ' / ' + App.deckPanelTab);

    // ══ A ═══════════════════════════════════════════════════════════════════
    const sawEvo = await dbl('custom:rd2_evo');
    ok('A1 Realm tab open: a Realm card double-clicked in the Collection goes to THIS deck\'s Realm Deck',
      sawEvo && RL().includes('custom:rd2_evo') && App.deckEdit.length === 40, J(RL()) + ' main=' + App.deckEdit.length);
    ok('A2 a non-Realm card is refused for the Realm Deck', window._realmDeckAdd('custom:rd2_unit') === false && !RL().includes('custom:rd2_unit'), J(RL()));
    App.deckBuilderFilter = 'all'; render(); await sleep(80);
    await dbl('custom:rd2_unit');
    ok('A2b …also through the grid (non-Realm card double-clicked with the Realm tab open)', !RL().includes('custom:rd2_unit') && App.deckEdit.length === 40, J(RL()) + ' main=' + App.deckEdit.length);
    ok('A3 an UNOWNED Realm card is refused', window._realmDeckAdd('custom:rd2_un') === false && !RL().includes('custom:rd2_un'));
    window._realmDeckAdd('custom:rd2_evo'); window._realmDeckAdd('custom:rd2_evo');
    const fourth = window._realmDeckAdd('custom:rd2_evo');
    ok('A4 3-copy cap', fourth === false && RL().filter(k => k === 'custom:rd2_evo').length === 3, J(RL()));
    await tab('main');
    ok('T2 back to Main puts the Collection filter back to ALL', App.deckBuilderFilter === 'all', App.deckBuilderFilter);
    App.deckEdit = App.deckEdit.slice(0, 39); render(); await sleep(80);   // room for one more in Main
    const beforeMain = App.deckEdit.length, beforeRealm = RL().length;
    App.deckBuilderFilter = 'realm'; render(); await sleep(80);
    await dbl('custom:rd2_cv');
    ok('A5 Main tab open: a Realm card is REFUSED for the main deck (and does not slip into the Realm Deck either)',
      App.deckEdit.length === beforeMain && !App.deckEdit.includes('custom:rd2_cv') && RL().length === beforeRealm, 'main ' + App.deckEdit.length + ' realm ' + RL().length);
    App.deckEdit = App.deckEdit.concat(['custom:rd2_unit']);
    await tab('side');
    await dbl('custom:rd2_cv');
    ok('A6 Side tab open: a Realm card IS allowed in the Side deck', Profile.sideDeck.cards.includes('custom:rd2_cv'), J(Profile.sideDeck.cards));
    // Side → Realm through the detail pane
    render(); await sleep(80);
    const sth = document.querySelector('[data-sel-zone="side"][data-sel-key="custom:rd2_cv"]');
    if (sth && sth.onclick) sth.onclick();
    await sleep(60);
    const toRealm = document.querySelector('#db-detail [data-mv-side-to-realm]');
    const toMain = document.querySelector('#db-detail [data-mv-side-to-main]');
    ok('A7 a Realm card in the Side offers → Realm, not → Main', !!toRealm && !toMain, 'toRealm ' + !!toRealm + ' toMain ' + !!toMain);
    if (toRealm) toRealm.onclick();
    await sleep(60);
    ok('A8 → Realm moves it from the Side deck into the Realm Deck', RL().includes('custom:rd2_cv') && !Profile.sideDeck.cards.includes('custom:rd2_cv'), J(RL()) + ' side ' + J(Profile.sideDeck.cards));
    // 21 cap
    await tab('archon');
    const saved = RL();
    App.deckEditRealm.length = 0;
    for (let i = 0; i < 21; i++) App.deckEditRealm.push('custom:rd2_f' + i);
    const over = window._realmDeckAdd('custom:rd2_f21');
    ok('A9 21-card cap', over === false && RL().length === 21, RL().length);
    App.deckEditRealm.length = 0; saved.forEach(k => App.deckEditRealm.push(k));

    // ══ V ═══════════════════════════════════════════════════════════════════
    render(); await sleep(100);
    const panelKeys = Array.from(document.querySelectorAll('#db-archon-list [data-sel-zone="realm"]')).map(t => t.dataset.selKey);
    ok('V1 the Realm tab lists what is IN the Realm Deck (grid thumbs, like Side), not every Realm card',
      panelKeys.includes('custom:rd2_arc') && panelKeys.includes('custom:rd2_evo') && panelKeys.includes('custom:rd2_cv') && !panelKeys.includes('custom:rd2_f5'), J(panelKeys));
    const lbl = (document.querySelector('[data-db-ptab="archon"]') || {}).textContent || '';
    ok('V2 the tab counts it (n/21)', lbl.indexOf('(' + RL().length + '/21)') >= 0, lbl);
    await dbl('custom:rd2_evo', 'realm');
    ok('V3 double-click in the Realm tab removes one copy', RL().filter(k => k === 'custom:rd2_evo').length === 2, J(RL()));
    ok('V4 an edit to the Realm Deck makes the deck dirty (💾 Save enabled)', !!document.getElementById('btn-deck-save') && !document.getElementById('btn-deck-save').disabled);

    // ══ S ═══════════════════════════════════════════════════════════════════
    const want = RL();
    document.getElementById('btn-deck-save').onclick();
    await sleep(100);
    ok('S1 💾 Save stores the list on the deck entry (deck.realm)', J(byD(deckA.id).realm) === J(want), J(byD(deckA.id).realm));
    ok('S2 …mirrors it to Profile.archonDeck.cards for older clients, and keeps the legacy list as .legacy',
      J(Profile.archonDeck.cards) === J(want) && J(Profile.archonDeck.legacy) === J(['custom:rd2_arc']), J(Profile.archonDeck));
    ok('S3 the saved list survives a JSON round trip of Profile.decks (what the cloud stores)', J(JSON.parse(J(Profile.decks)).find(d => d.id === deckA.id).realm) === J(want));
    await open(deckB.id);
    ok('S4 a second deck opens with its OWN list — the legacy seed, not deck A\'s', J(RL()) === J(['custom:rd2_arc']), J(RL()));
    await tab('archon');
    window._realmDeckAdd('custom:rd2_cv');
    document.getElementById('btn-deck-save').onclick(); await sleep(100);
    ok('S5 two decks keep separate Realm Decks', J(byD(deckB.id).realm) === J(['custom:rd2_arc', 'custom:rd2_cv']) && J(byD(deckA.id).realm) === J(want),
      'A ' + J(byD(deckA.id).realm) + ' B ' + J(byD(deckB.id).realm));

    // ══ B ═══════════════════════════════════════════════════════════════════
    App.battlePrep = Object.assign({}, App.battlePrep || {}, { deckId: deckA.id, hero });
    const evoA = getBattleEvoCards('player').map(c => c.id), cvA = getBattleConvergenceCards('player').map(c => c.id);
    App.battlePrep.deckId = deckB.id;
    const evoB = getBattleEvoCards('player').map(c => c.id), cvB = getBattleConvergenceCards('player').map(c => c.id), arcB = getBattleArchonCards().map(c => c.id);
    ok('B1 battle reads the PLAYED deck\'s Realm Deck (A: Evo + Convergence; B: Convergence, no Evo)',
      evoA.includes('rd2_evo') && cvA.includes('rd2_cv') && !evoB.includes('rd2_evo') && cvB.includes('rd2_cv') && arcB.includes('rd2_arc'),
      J({ evoA, cvA, evoB, cvB, arcB }));
    ok('B2 …and the ownership gate reads it too', _realmDeckAllows(C.cv, 'player') === true && _realmDeckAllows(C.evo, 'player') === false);

    // ══ P ═══════════════════════════════════════════════════════════════════
    byD(deckA.id).cards = unitKeys.slice(0, 38).concat(['custom:rd2_evo', 'custom:rd2_cv']);   // hand-corrupted list
    Profile.sideDeck.cards = ['custom:rd2_evo', 'custom:rd2_arc'];
    App.battlePrep.deckId = deckA.id;
    const foe = findHeroById(STARTER_HEROES[1].id);
    const s = initGame(hero, foe, [], true, deckA.id);
    const pile = [].concat(s.player.hand || [], s.player.deck || []);
    const bad = pile.filter(c => c && isRealmOnlyCard(c)).map(c => c.id);
    ok('P1 no Realm card in the draw pile — not from a hand-put deck key, not from the Side deck', bad.length === 0 && pile.length > 0, 'leaked ' + J(bad) + ' of ' + pile.length);
  } catch (e) { ok('ran', false, e.stack || e.message); }

  Forge.customCards = (Forge.customCards || []).filter(c => !String(c && c.id).startsWith('rd2_'));
  Profile.decks = (Profile.decks || []).filter(d => !String(d.id).startsWith('rd2_'));
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
if (errs.length) console.log('page errors (' + errs.length + '): ' + errs.slice(0, 4).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED of ' + out.length : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
