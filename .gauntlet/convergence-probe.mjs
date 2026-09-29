/* ══════════════════════════════════════════════════════════════════════════
   ⟁ CONVERGENCE PROBE — the Realm Deck summon built from a chain of units.

   Real code in the loaded page: the Forge editor (renderCardEditor +
   captureEditorIntoCard), the real battle boot (initGame), real buildUnit /
   hexNeighbors / _reconcileUnitCards through window.MythicConvergenceBridge,
   the module's search + resolver, the Realm Deck view and the AI step.

     E  editor: Anchor + Convergence fields save, survive a JSON reload, clear
     L  legality: the one legal set is found; every illegal shape is refused
        (sum wrong, not connected, no Anchor, two Anchors) by BOTH the search
        and the validator
     S  resolve: on the Anchor's tile; every material dead and in the OWNER's
        graveyard (incl. one with no _card); the card text / realm-only rules
     Y  ley: ready only when EVERY material stands on matching ley
     U  UI: Realm Deck tile + detail offer ⟁ Converge; picker opens, Cancel
        changes nothing, Confirm converges
     A  AI: aiTry and a real doAIStep converge on the AI's turn, no UI opened
     P  perf: a 12-unit board answers inside a time bound

   The page sits on a sign-in gate, so everything is driven by calling the
   game's own functions — no clicks through the gate.

   Usage: node .gauntlet/convergence-probe.mjs [candidate.html]   (:8787 up)
   /src/convergence/* is served from disk by the dev server, so the module
   under test is always the working copy.
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
// A string, not a closure: initGame may be a lexical binding, invisible as window.initGame.
await p.waitForFunction('typeof initGame === "function" && !!window.MythicConvergence && !!window.MythicConvergenceBridge', null, { timeout: 120000 })
  .catch(async (e) => {
    const why = await p.evaluate('({ initGame: typeof initGame, mod: !!window.MythicConvergence, bridge: !!window.MythicConvergenceBridge })').catch(() => null);
    console.log('boot wait failed: ' + JSON.stringify(why) + ' errors: ' + errs.slice(0, 3).join(' | '));
    throw e;
  });
await p.waitForTimeout(1500);

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const MC = window.MythicConvergence;
  try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {}

  // ── fixtures: cards ──────────────────────────────────────────────────────
  const st6 = { hp: 30, atk: 8, def: 4, mag: 3, res: 3, spd: 1 };
  const mkCard = (id, extra) => Object.assign({ id, name: id, icon: '🧪', type: 'unit', rarity: 'common', cost: 1,
    elements: ['fire'], factions: [], stats: { ...st6 }, learnset: [{ lvl: 1, m: 'slash' }] }, extra || {});
  const C = {
    anc2: mkCard('cvp_anchor2', { name: 'Probe Anchor', cost: 2, anchor: true }),
    anc3: mkCard('cvp_anchor3', { name: 'Probe Anchor Three', cost: 3, anchor: true }),
    u3:   mkCard('cvp_unit3', { name: 'Probe Three', cost: 3 }),
    u2:   mkCard('cvp_unit2', { name: 'Probe Two', cost: 2 }),
    u1:   mkCard('cvp_unit1', { name: 'Probe One', cost: 1 }),
    u0:   mkCard('cvp_unit0', { name: 'Probe Zero', cost: 0, stats: { hp: 10, atk: 1, def: 1, mag: 1, res: 1, spd: 1 } }),
    cv5:  mkCard('cvp_conv5', { name: 'Probe Convergent', type: 'summon', cost: 5, stats: { hp: 60, atk: 20, def: 10, mag: 10, res: 10, spd: 2 },
            convergence: { enabled: true, value: 5, element: 'fire' } }),
    cv20: mkCard('cvp_conv20', { name: 'Probe Twenty', type: 'summon', cost: 9, convergence: { enabled: true, value: 20, element: '' } }),
  };
  Forge.customCards = (Forge.customCards || []).filter(c => !String(c.id).startsWith('cvp_')).concat(Object.values(C));
  Profile.cardCollection = Profile.cardCollection || {};
  Profile.cardCollection[C.cv5.id] = 1;
  Profile.archonDeck = { cards: ['custom:' + C.cv5.id] };

  // ══ E. the editor ═══════════════════════════════════════════════════════
  const host = document.createElement('div'); host.id = 'cvp-editor-host'; document.body.appendChild(host);
  const edit = (id) => { App.editingCardId = id; host.innerHTML = renderCardEditor(); };
  try {
    const ed1 = mkCard('cvp_ed_unit', { name: 'Editor Anchor' });
    /* A Realm card since the Realm type landed: the Convergence block only shows
       on type 'realm' (realmKind convergence) — a plain summon is a token now. */
    const ed2 = mkCard('cvp_ed_sum', { name: 'Editor Convergent', type: 'realm', realmKind: 'convergence' });
    Forge.customCards.push(ed1, ed2);
    edit(ed1.id);
    ok('E1a the unit editor renders the ⚓ Anchor checkbox', !!document.getElementById('ed-anchor'));
    ok('E1b …unticked for a card without the trait', document.getElementById('ed-anchor') && !document.getElementById('ed-anchor').checked);
    document.getElementById('ed-anchor').checked = true;
    captureEditorIntoCard(ed1);
    ok('E1c ticked + saved → card.anchor === true', ed1.anchor === true, JSON.stringify(ed1.anchor));
    const re1 = JSON.parse(JSON.stringify(ed1));
    Forge.customCards = Forge.customCards.map(c => c.id === re1.id ? re1 : c);
    edit(re1.id);
    ok('E1d reloaded (JSON round trip) → the box comes back ticked', document.getElementById('ed-anchor').checked);
    document.getElementById('ed-anchor').checked = false;
    captureEditorIntoCard(re1);
    ok('E1e unticked + saved → the field is removed, not stored false', !('anchor' in re1));

    edit(ed2.id);
    ok('E2a the summon editor renders the ⟁ Convergence fields', !!(document.getElementById('ed-cv-on') && document.getElementById('ed-cv-value') && document.getElementById('ed-cv-element')));
    document.getElementById('ed-cv-on').checked = true;
    document.getElementById('ed-cv-value').value = '7';
    document.getElementById('ed-cv-element').value = 'fire';
    captureEditorIntoCard(ed2);
    ok('E2b saved → card.convergence = { enabled, value 7, element fire }',
      JSON.stringify(ed2.convergence) === JSON.stringify({ enabled: true, value: 7, element: 'fire' }), JSON.stringify(ed2.convergence));
    const re2 = JSON.parse(JSON.stringify(ed2));
    Forge.customCards = Forge.customCards.map(c => c.id === re2.id ? re2 : c);
    edit(re2.id);
    ok('E2c reloaded → enable ticked, number 7, element fire',
      document.getElementById('ed-cv-on').checked && document.getElementById('ed-cv-value').value === '7' && document.getElementById('ed-cv-element').value === 'fire',
      [document.getElementById('ed-cv-on').checked, document.getElementById('ed-cv-value').value, document.getElementById('ed-cv-element').value].join(','));
    document.getElementById('ed-cv-value').value = '99';
    document.getElementById('ed-cv-element').value = '';
    captureEditorIntoCard(re2);
    ok('E2d an out-of-range number is clamped to 20, empty element saved as ""', re2.convergence && re2.convergence.value === 20 && re2.convergence.element === '', JSON.stringify(re2.convergence));
    document.getElementById('ed-cv-on').checked = false;
    captureEditorIntoCard(re2);
    ok('E2e unticked + saved → card.convergence removed', !('convergence' in re2));
    Forge.customCards = Forge.customCards.filter(c => c.id !== ed1.id && c.id !== ed2.id);
  } catch (e) { ok('E ran', false, e.stack || e.message); }
  host.remove(); App.editingCardId = null;

  // ══ battle boot (feed-rail-shot recipe) ═══════════════════════════════════
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null); App.screen = 'battle';
  try { renderBattleNow(); } catch (e) {}
  await sleep(300);
  const dims = _boardDims(App.state);
  const heroes = () => App.state.units.filter(u => u && u.isHero);
  const heroKeys = () => new Set(heroes().map(h => h.pos.x + ',' + h.pos.y));
  let _n = 0;
  const mk = (card, owner, x, y, withCard) => {
    const u = buildUnit(card, owner, { x, y });
    u.alive = true; u.owner = owner; u.pos = { x, y };
    if (withCard !== false) u._card = { ...card, instanceId: 'iid_cvp_' + (++_n) };
    return u;
  };
  /* Reset to the heroes + the given units; the turn is the player's unless said. */
  const board = (units, turn) => {
    const hs = heroes().map(h => ({ ...h, alive: true }));
    App.state = { ...App.state, units: hs.concat(units), turn: turn || 'player',
      player: { ...App.state.player, graveyard: [], void: [] }, ai: { ...App.state.ai, graveyard: [], void: [] }, log: [] };
    App.ui.aiBusy = false;
  };
  // A clear mid-board row, away from both heroes.
  const my = Math.floor(dims.H / 2), mx = Math.max(1, Math.floor(dims.W / 2) - 2);
  const hk = heroKeys();
  ok('boot: board is big enough and the mid row is clear', dims.W >= 6 && dims.H >= 4 && ![0, 1, 2, 3].some(d => hk.has((mx + d) + ',' + my)), JSON.stringify(dims));
  const nb = hexNeighbors(mx, my);
  const E = nb[0];                              // the E neighbour (x+1, y)
  const far = { x: mx + 3, y: my };             // distance 3, same row
  ok('boot: hexNeighbors puts (x+1,y) next door and (x+3,y) three away', distance({ x: mx, y: my }, E) === 1 && distance({ x: mx, y: my }, far) === 3);

  // ══ L. legality ═══════════════════════════════════════════════════════════
  try {
    const a = mk(C.anc2, 'player', mx, my), t = mk(C.u3, 'player', E.x, E.y);
    board([a, t]);
    const r = MC.findSets(App.state, 'player', C.cv5);
    ok('L1a Anchor (2) + adjacent unit (3) → exactly one legal set for Convergence 5', r.sets.length === 1, JSON.stringify(r.sets.map(s => s.unitIds)));
    ok('L1b …made of exactly those two units, Anchor first', r.sets[0] && r.sets[0].anchorId === a.id && r.sets[0].unitIds.length === 2 && r.sets[0].unitIds.includes(t.id));
    ok('L1c the validator agrees', MC.validate(App.state, 'player', C.cv5, [a.id, t.id]).ok);
    ok('L1d the rail knows a Convergence is available', MC.availableIds('player').includes(C.cv5.id), JSON.stringify(MC.availableIds('player')));
  } catch (e) { ok('L1 ran', false, e.stack || e.message); }
  const refuse = (label, units, ids, why) => {
    try {
      board(units);
      const r = MC.findSets(App.state, 'player', C.cv5);
      ok(label + ' — the search finds nothing', r.sets.length === 0, JSON.stringify(r.sets.map(s => s.unitIds)));
      const v = MC.validate(App.state, 'player', C.cv5, ids(units));
      ok(label + ' — the validator refuses (' + why + ')', !v.ok && new RegExp(why, 'i').test(v.reason || ''), v.reason);
    } catch (e) { ok(label + ' ran', false, e.stack || e.message); }
  };
  refuse('L2 costs 2 + 1 ≠ 5', [mk(C.anc2, 'player', mx, my), mk(C.u1, 'player', E.x, E.y)], (u) => u.map(x => x.id), 'total');
  refuse('L3 not connected (2 + 3 = 5, three tiles apart)', [mk(C.anc2, 'player', mx, my), mk(C.u3, 'player', far.x, far.y)], (u) => u.map(x => x.id), 'connected');
  refuse('L4 no Anchor (2 + 3, neither an Anchor)', [mk(C.u2, 'player', mx, my), mk(C.u3, 'player', E.x, E.y)], (u) => u.map(x => x.id), 'no anchor');
  refuse('L5 two Anchors (2 + 3, both Anchors)', [mk(C.anc2, 'player', mx, my), mk(C.anc3, 'player', E.x, E.y)], (u) => u.map(x => x.id), 'exactly one anchor');
  try {
    // An enemy unit and a hero never count as material.
    const a = mk(C.anc2, 'player', mx, my), t = mk(C.u3, 'ai', E.x, E.y);
    board([a, t]);
    ok('L6 an ENEMY unit is never your material', MC.findSets(App.state, 'player', C.cv5).sets.length === 0);
    // A chain THROUGH a third tile counts when the middle unit belongs to the set.
    const a2 = mk(C.anc2, 'player', mx, my), z = mk(C.u0, 'player', E.x, E.y), t2 = mk(C.u3, 'player', mx + 2, my);
    board([a2, z, t2]);
    const r = MC.findSets(App.state, 'player', C.cv5);
    ok('L7 a 0-cost link bridges the chain (2 + 0 + 3) and counts as 0', r.sets.some(s => s.unitIds.length === 3 && s.unitIds.includes(z.id)), JSON.stringify(r.sets.map(s => s.unitIds)));
  } catch (e) { ok('L6/7 ran', false, e.stack || e.message); }

  // ══ S. resolve ═══════════════════════════════════════════════════════════
  let spawned = null;
  try {
    const a = mk(C.anc2, 'player', mx, my), t = mk(C.u3, 'player', E.x, E.y, false);   // t has NO _card
    board([a, t]);
    const aIid = a._card.instanceId;
    const res = MC.converge('player', C.cv5, [a.id, t.id]);
    const s = App.state;
    spawned = res && (s.units || []).find(u => u.id === res.spawnedId);
    ok('S1 the Convergence unit exists, is the player\'s, and is flagged', !!spawned && spawned.owner === 'player' && spawned.isConvergence && spawned.summonSource === 'Convergence');
    ok('S2 …on the Anchor\'s tile', spawned && spawned.pos.x === mx && spawned.pos.y === my, spawned && JSON.stringify(spawned.pos));
    ok('S3 …as the printed Convergence card', spawned && (spawned.cardId === C.cv5.id || spawned.originalCardId === C.cv5.id), spawned && spawned.cardId);
    ok('S4 every material is dead (off the board)', !(s.units || []).some(u => (u.id === a.id || u.id === t.id) && u.alive));
    ok('S5 nothing else alive stands on either material tile', (s.units || []).filter(u => u.alive && ((u.pos.x === E.x && u.pos.y === E.y) || (u.pos.x === mx && u.pos.y === my))).length === 1);
    const g = (s.player.graveyard || []);
    ok('S6 the Anchor\'s card is in the player\'s graveyard (filed by the reconciler)', g.some(c => c && c.instanceId === aIid), JSON.stringify(g.map(c => c && c.instanceId)));
    ok('S7 …and so is the material that had no _card (given its printed card)', g.some(c => c && c.id === C.u3.id), JSON.stringify(g.map(c => c && c.id)));
    ok('S8 exactly two graveyard cards — no double filing', g.length === 2, g.length);
    const view = (typeof _graveViewCards === 'function') ? _graveViewCards(s, 'player') : null;
    ok('S9 the graveyard VIEW shows two cards too', !view || view.length === 2, view && view.length);
    ok('S10 without ley, it arrives summoning-sick', spawned && spawned.hasMoved === true && spawned.hasAttacked === true);
    ok('S11 the battle log names it', (s.log || []).some(l => /Convergence 5/.test(l.msg || '')), JSON.stringify((s.log || []).slice(-3)));
    ok('S12 materials are refused a second time (they are gone)', !!(MC.converge('player', C.cv5, [a.id, t.id]) || {}).refused);
  } catch (e) { ok('S ran', false, e.stack || e.message); }
  try {
    const txt = _archonReqDetailHtml(C.cv5);
    ok('S13 card text: "Convergence 5 · 1 Anchor + non-Anchor units, costs total 5, in a connected chain"', txt.indexOf('Convergence 5 · 1 Anchor + non-Anchor units, costs total 5, in a connected chain') >= 0, txt.slice(0, 200));
    ok('S14 …plus "Ley: fire — arrives ready"', txt.indexOf('Ley: fire — arrives ready') >= 0);
    ok('S15 an Anchor unit\'s detail names the trait', /⚓ Anchor/.test(_archonReqDetailHtml(C.anc2)));
    ok('S16 realm-only: a Convergence card is Realm Deck only, never main deck', _realmOnlyKind(C.cv5) === 'Convergence' && isRealmOnlyCard(C.cv5) && !isRealmOnlyCard(C.anc2));
    const back = _unitReturnToHandCard(spawned || { isConvergence: true });
    ok('S17 bounced, it goes home to the Realm Deck, not the hand', back && back.archon === true && back.card === null && back.realmLabel === 'Convergence');
  } catch (e) { ok('S13+ ran', false, e.stack || e.message); }

  // ══ Y. ley ═══════════════════════════════════════════════════════════════
  try {
    if (window.MythicLey && !window.MythicLey.enabled()) window.MythicLey.configure({ enabled: true });
    const setLey = (x, y, elem) => { const t = App.state.board[y][x]; App.state.board[y][x] = { ...t, ley: elem ? { elem, power: 1, owner: null } : null }; };
    const run = (e1, e2) => {
      const a = mk(C.anc2, 'player', mx, my), t = mk(C.u3, 'player', E.x, E.y);
      board([a, t]);
      App.state = { ...App.state, board: App.state.board.map(r => r.slice()) };
      setLey(mx, my, e1); setLey(E.x, E.y, e2);
      const set = MC.findSets(App.state, 'player', C.cv5).sets[0];
      const res = MC.converge('player', C.cv5, [a.id, t.id]);
      const u = res && App.state.units.find(x => x.id === res.spawnedId);
      return { set, res, u };
    };
    const both = run('fire', 'fire');
    ok('Y1 both materials on fire ley → the set is marked ley ✓', both.set && both.set.ley === true);
    ok('Y2 …and the unit arrives READY (hasMoved/hasAttacked false)', both.u && both.u.hasMoved === false && both.u.hasAttacked === false, both.u && [both.u.hasMoved, both.u.hasAttacked].join(','));
    ok('Y3 …and the log says so', (App.state.log || []).some(l => /ley/.test(l.msg || '') && /ready/.test(l.msg || '')));
    const one = run('fire', null);
    ok('Y4 only ONE material on fire ley → no bonus, summoning-sick', one.set && one.set.ley === false && one.u && one.u.hasMoved === true);
    const wrong = run('water', 'water');
    ok('Y5 both on WATER ley (card is fire) → no bonus', wrong.set && wrong.set.ley === false && wrong.u && wrong.u.hasMoved === true);
    for (const [x, y] of [[mx, my], [E.x, E.y]]) setLey(x, y, null);
  } catch (e) { ok('Y ran', false, e.stack || e.message); }

  // ══ U. the Realm Deck + picker ═══════════════════════════════════════════
  try {
    const a = mk(C.anc2, 'player', mx, my), t = mk(C.u3, 'player', E.x, E.y);
    board([a, t]);
    App._pileView = 'realm'; App._realmDetail = null;
    renderBattleNow(); await sleep(150);
    const btn = document.querySelector('[data-realm-card="' + C.cv5.id + '"] [data-converge-open]');
    ok('U1 the Realm Deck lists the Convergence card with a ⟁ Converge button', !!btn);
    App._realmDetail = C.cv5.id; renderBattleNow(); await sleep(150);
    const det = document.getElementById('bp-modal-bd');
    ok('U2 the card\'s detail shows the recipe and a Converge button', det && /Convergence 5/.test(det.textContent) && !!det.querySelector('[data-converge-open]'), det && det.textContent.slice(0, 160));
    det.querySelector('[data-converge-open]').click();
    await sleep(200);
    const ov = document.getElementById('cv-overlay');
    ok('U3 Converge opens the picker (the Realm Deck closes)', !!ov && App._pileView == null, App._pileView);
    ok('U4 exactly one set → a confirm listing both materials', ov && ov.querySelectorAll('.cv-set').length === 1 && /Probe Anchor/.test(ov.textContent) && /Probe Three/.test(ov.textContent));
    ok('U5 the chain is drawn', ov && !!ov.querySelector('svg.cv-chain polygon'));
    document.getElementById('cv-cancel').click();
    ok('U6 Cancel closes it and changes nothing', !document.getElementById('cv-overlay') && App.state.units.filter(u => u.alive && (u.id === a.id || u.id === t.id)).length === 2);
    MC.open(C.cv5.id);
    document.getElementById('cv-confirm').click();
    await sleep(200);
    ok('U7 Confirm converges', App.state.units.some(u => u.alive && u.isConvergence && u.pos.x === mx && u.pos.y === my) && !document.getElementById('cv-overlay'));
    // Several legal sets → a choice.
    const a2 = mk(C.anc2, 'player', mx, my), t2 = mk(C.u3, 'player', E.x, E.y), t3 = mk(C.u3, 'player', nb[1].x, nb[1].y);
    board([a2, t2, t3]);
    MC.open(C.cv5.id);
    const ov2 = document.getElementById('cv-overlay');
    ok('U8 two legal chains → the picker offers both', ov2 && ov2.querySelectorAll('.cv-set').length === 2);
    ov2.querySelectorAll('.cv-set')[1].click();
    ok('U9 choosing Set 2 selects it', document.querySelectorAll('#cv-overlay .cv-set.on').length === 1 && document.querySelectorAll('#cv-overlay .cv-set')[1].classList.contains('on'));
    MC.cancel();
    App.state = { ...App.state, turn: 'ai' };
    ok('U10 refused off your turn', MC.open(C.cv5.id) === false && !document.getElementById('cv-overlay'));
    App._pileView = null;
  } catch (e) { ok('U ran', false, e.stack || e.message); }

  // ══ A. the AI ═══════════════════════════════════════════════════════════
  try {
    const a = mk(C.anc2, 'ai', mx, my), t = mk(C.u3, 'ai', E.x, E.y);
    board([a, t], 'ai');
    const r = MC.aiTry(t.id);
    ok('A1 aiTry converges when the acting unit is in a legal chain', r && r.spawnedId && App.state.units.some(u => u.id === r.spawnedId && u.owner === 'ai' && u.pos.x === mx && u.pos.y === my), JSON.stringify(r));
    ok('A2 …the AI\'s materials go to the AI graveyard', (App.state.ai.graveyard || []).length === 2 && (App.state.player.graveyard || []).length === 0);
    ok('A3 …and no UI was opened', !document.getElementById('cv-overlay'));
    const a2 = mk(C.anc2, 'ai', mx, my), t2 = mk(C.u3, 'ai', E.x, E.y), lone = mk(C.u1, 'ai', far.x, far.y);
    board([a2, t2, lone], 'ai');
    ok('A4 aiTry does nothing for a unit that is not in the chain', MC.aiTry(lone.id) === null && App.state.units.filter(u => u.alive && !u.isHero).length === 3);
  } catch (e) { ok('A ran', false, e.stack || e.message); }
  try {
    // The real AI step. Everyone else has acted; the AI has nothing to cast.
    const a = mk(C.anc2, 'ai', mx, my), t = mk(C.u3, 'ai', E.x, E.y);
    board([a, t], 'ai');
    App.state = { ...App.state, turnNumber: Math.max(1, App.state.turnNumber | 0),
      ai: { ...App.state.ai, hand: [], energy: 0 },
      units: App.state.units.map(u => (u.isHero && u.owner === 'ai') ? { ...u, aiActed: true } : u) };
    App.ui.aiBusy = true;
    const rnd = Math.random; Math.random = () => 0;
    let threw = null;
    try { doAIStep(); } catch (e) { threw = e; }
    Math.random = rnd;
    const cvU = App.state.units.find(u => u.alive && u.owner === 'ai' && u.isConvergence);
    ok('A5 a real doAIStep converges on the AI\'s turn', !threw && !!cvU && cvU.pos.x === mx && cvU.pos.y === my, threw ? threw.message : JSON.stringify((App.state.log || []).slice(-2)));
    ok('A6 …and never opened the picker', !document.getElementById('cv-overlay'));
    App.ui.aiBusy = false;
    try { if (App._aiHangTimer) clearTimeout(App._aiHangTimer); } catch (e) {}
  } catch (e) { ok('A5 ran', false, e.stack || e.message); }

  // ══ P. a full board ═════════════════════════════════════════════════════
  try {
    // 12 units in a compact blob, two Anchors, every cost 0 or 1: the worst
    // shape for the search (many connected subsets, weak pruning).
    const spots = [];
    /* a 4-wide × 3-tall block around the middle — a BLOB, not a line. A line
       of 12 has only intervals for connected subsets and would flatter the
       search (the first cut of this probe did exactly that: 34 steps). */
    for (let y = my - 1; y <= my + 1; y++) for (let x = mx - 1; x <= mx + 2; x++) {
      if (inBoundsOf(App.state, x, y) && !heroKeys().has(x + ',' + y)) spots.push({ x, y });
    }
    const us = spots.map((s, i) => mk(i === 0 || i === 7 ? C.anc2 : (i % 2 ? C.u1 : C.u0), 'player', s.x, s.y));
    board(us);
    const t0 = performance.now();
    const rNone = MC.findSets(App.state, 'player', C.cv20);   // unreachable sum → the full walk
    const dt1 = performance.now() - t0;
    const t1 = performance.now();
    const rSome = MC.findSets(App.state, 'player', C.cv5);
    const dt2 = performance.now() - t1;
    ok('P1 12 units, unreachable total: answers within 400 ms', dt1 < 400, dt1.toFixed(1) + ' ms, work capped=' + rNone.truncated);
    ok('P2 12 units, Convergence 5: finds sets within 400 ms', rSome.sets.length > 0 && dt2 < 400, dt2.toFixed(1) + ' ms, ' + rSome.sets.length + ' sets');
    ok('P3 every set it returns validates', rSome.sets.every(s => MC.validate(App.state, 'player', C.cv5, s.unitIds).ok));
    ok('P4 weakest materials first', rSome.sets.every((s, i, a) => i === 0 || a[i - 1].weight <= s.weight));
    // The pathological blob: every link free, so cost never prunes and only
    // the depth / work caps stop the walk.
    board(spots.map((s, i) => mk(i === 5 ? C.anc2 : C.u0, 'player', s.x, s.y)));
    const t2 = performance.now();
    const rZero = MC.findSets(App.state, 'player', C.cv20);
    const dt3 = performance.now() - t2;
    ok('P5 12 units, all cost 0 (no pruning), unreachable total: within 400 ms', dt3 < 400 && rZero.sets.length === 0, dt3.toFixed(1) + ' ms, work ' + rZero.work + (rZero.truncated ? ' (capped)' : ''));
    R.push({ label: 'info: all-zero blob ' + dt3.toFixed(1) + ' ms, work ' + rZero.work + (rZero.truncated ? ' (capped)' : ''), pass: true });
    R.push({ label: 'info: 12-unit timings ' + dt1.toFixed(1) + ' / ' + dt2.toFixed(1) + ' ms; search work ' + rNone.work + ' / ' + rSome.work + (rNone.truncated ? ' (capped)' : '') + '; ' + us.length + ' units on ' + dims.W + 'x' + dims.H + ', ' + rSome.sets.length + ' sets', pass: true });
  } catch (e) { ok('P ran', false, e.stack || e.message); }

  Forge.customCards = (Forge.customCards || []).filter(c => !String(c.id).startsWith('cvp_'));
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? (r.detail && /^info/.test(r.label) ? '' : '') : '   ← ' + r.detail)); }
if (errs.length) console.log('page errors (' + errs.length + '): ' + errs.slice(0, 4).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
