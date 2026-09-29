/* ══════════════════════════════════════════════════════════════════════════
   FETCH ROUND PROBE (2026-09-19). Owner, five asks:
     A. FETCH — "summon a card whose name contains x from your deck … give the
        unit Speed … If it still on the field destroy it at the end of your
        turn" + "add or summon from deck, vanish, or graveyard … a tab for the
        player to pick where";
     B. "If you control a x unit on the field, deal x damage to all of your
        enemy units and hero" — the condition's filter + AOE Damage/AOE All;
     C. Inspire honours the Card Filter;
     D. RETURN AN ALLY — "at the start of the turn, you can choose to send a
        Fire or Ice element unit you control back to your hand" (+ "…or element");
     E. the Hologram death VFX + the death sound on EVERY death.
   Every check drives the REAL functions (_applyOnPlayOne, the deck-search
   picker, _eotNotFromHandSweep, _targetCandidates, _aiPickTargetFor,
   processTombstoneDrops, _cardMatchesFilter) and most are A/B.
   Usage: node .gauntlet/fetchround-probe.mjs <candidate.html>  (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: fetchround-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
if (!html.includes("eff.type === 'fetchCard'")) { console.log(JSON.stringify({ ok: false, missing: 'the fetch round is not in this file' })); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  return route.continue();
});
let R;
try {
  await page.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof _applyOnPlayOne === 'function' && typeof processTombstoneDrops === 'function' && !!window.MythicEffectFx, null, { timeout: 30000 });
  R = await page.evaluate(async () => {
    const out = {}, err = {};
    const T = async (k, f) => { try { out[k] = await f(); } catch (e) { err[k] = String(e && e.stack || e).slice(0, 400); out[k] = false; } };
    const W = BOARD_W, H = BOARD_H;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });
    const stats = { hp: 20, atk: 8, def: 4, mag: 2, res: 2, spd: 2 };
    let iid = 0; const inst = (c) => Object.assign({}, c, { instanceId: 'fr_i' + (++iid) });
    const C = (id, name, extra) => Object.assign({ id, name, type: 'unit', cost: 2, stats, elements: ['neutral'], learnset: [{ lvl: 1, m: 'slash' }] }, extra || {});
    const DEMON = C('fr_demon', 'Savage Demon Grunt', { elements: ['fire'] });
    const DEMON2 = C('fr_demon2', 'Savage Demon Brute', { cost: 4, elements: ['fire'] });
    const GOB = C('fr_gob', 'Goblin Scout');
    const SPELL = { id: 'fr_spell', name: 'Savage Demon Rite', type: 'spell', cost: 1 };
    Forge.customCards = (Forge.customCards || []).filter(c => !/^fr_/.test(c.id)).concat([DEMON, DEMON2, GOB, SPELL]);
    const U = (id, name, owner, x, y, extra) => Object.assign({ id, name, owner, alive: true, pos: { x, y }, currentHp: 20, maxHp: 20, stats, cardId: id, elements: ['neutral'], passives: [], statusEffects: [] }, extra || {});
    const heroes = () => [U('h_p', 'Hero', 'player', 5, H - 1, { isHero: true, currentHp: 300, maxHp: 300 }), U('h_a', 'AI Hero', 'ai', 5, 0, { isHero: true, currentHp: 300, maxHp: 300 })];
    const mk = (turn, extraUnits) => ({ player: side(), ai: side(), board: board(), turn: turn || 'player', turnNumber: 3, round: 2, gameOver: false, log: [], tombstones: [], weather: null, units: heroes().concat(extraUnits || []) });
    const FETCH = { type: 'fetchCard', amount: 1, filter: { nameIncludes: 'Savage Demon' }, fetchZones: ['deck', 'grave'], fetchDest: 'summon', fetchSpeed: true, fetchDoom: true };

    /* ── A. FETCH ── */
    await T('A1_ai_fetch_summons_with_speed_and_doom', () => {
      const s = mk('ai'); s.ai.deck = [inst(GOB), inst(DEMON), inst(DEMON2)];
      const caster = s.units.find(u => u.id === 'h_a');
      App.state = s;
      const r = _applyOnPlayOne(s, caster, { id: 'fr_src', name: 'Summoner', onPlay: FETCH });
      const born = r.units.find(u => u.owner === 'ai' && !u.isHero && /Savage Demon/.test(u.name || ''));
      out._a1 = born && { name: born.name, speed: (born.passives || []).includes('speed'), hasMoved: born.hasMoved, doom: born._doomEndOf, deck: r.ai.deck.map(c => c.name) };
      /* a Savage Demon (the strongest by _summonCardPower; these two tie) — never the Goblin, which the name filter rules out */
      return !!born && (born.passives || []).includes('speed') && born.hasMoved === false
        && born._doomEndOf === 'ai' && r.ai.deck.length === 2 && r.ai.deck.some(c => c.name === 'Goblin Scout');
    });
    await T('A2_doom_destroys_at_end_of_that_turn_only', () => {
      const s = mk('ai'); const d = U('fr_d1', 'Savage Demon Brute', 'ai', 4, 2, { _doomEndOf: 'ai' }), keep = U('fr_k1', 'Goblin', 'ai', 3, 2);
      s.units.push(d, keep); App.state = s;
      const wrongSide = _eotNotFromHandSweep(s, 'player');
      const r = _eotNotFromHandSweep(s, 'ai');
      return wrongSide.units.find(u => u.id === 'fr_d1').alive === true && r.units.find(u => u.id === 'fr_d1').alive === false && r.units.find(u => u.id === 'fr_k1').alive === true;
    });
    await T('A3_player_picker_has_a_tab_per_zone', () => {
      const s = mk('player'); s.player.deck = [inst(GOB), inst(DEMON)]; s.player.graveyard = [inst(DEMON2)];
      App.state = s; App.ui = App.ui || {}; App.ui.deckSearch = null; App.ui.deckSearchQueue = [];
      const caster = s.units.find(u => u.id === 'h_p');
      _applyOnPlayOne(s, caster, { id: 'fr_src', name: 'Summoner', onPlay: FETCH });
      const ds = App.ui.deckSearch;
      const h1 = renderDeckSearchModal();
      const tabs = (h1.match(/data-ds-zone="/g) || []).length;
      const deckShowsGrunt = /Savage Demon Grunt/.test(h1) && !/Savage Demon Brute/.test(h1) && !/Goblin Scout/.test(h1);
      App.ui.deckSearch.source = 'grave'; const h2 = renderDeckSearchModal();
      out._a3 = { tabs, sources: ds && ds.sources, deckShowsGrunt, graveShowsBrute: /Savage Demon Brute/.test(h2) };
      return !!ds && tabs === 2 && deckShowsGrunt && /Savage Demon Brute/.test(h2) && ds.grantSpeed === true && ds.doom === true;
    });
    await T('A4_picker_summon_carries_speed_and_doom', () => {
      const ds = App.ui.deckSearch; const pick = App.state.player.graveyard[0];
      const rb = window.renderBattle; window.renderBattle = () => {};
      try { _deckSearchSelect(pick.instanceId); } finally { window.renderBattle = rb; }
      const born = App.state.units.find(u => u.owner === 'player' && !u.isHero && /Brute/.test(u.name || ''));
      out._a4 = born && { speed: (born.passives || []).includes('speed'), hasMoved: born.hasMoved, doom: born._doomEndOf, grave: App.state.player.graveyard.length };
      return !!born && (born.passives || []).includes('speed') && born.hasMoved === false && born._doomEndOf === 'player' && App.state.player.graveyard.length === 0;
    });
    await T('A5_player_chooses_add_to_hand', () => {
      const s = mk('player'); s.player.deck = [inst(DEMON), inst(SPELL)];
      App.state = s; App.ui.deckSearch = null; App.ui.deckSearchQueue = [];
      _applyOnPlayOne(s, s.units[0], { id: 'fr_src', name: 'Summoner', onPlay: { ...FETCH, fetchDest: 'either', fetchZones: ['deck'] } });
      const h = renderDeckSearchModal();
      const spellListed = /Savage Demon Rite/.test(h);   // a spell may be ADDED in "player chooses"
      App.ui.deckSearch.detailId = App.state.player.deck.find(c => c.id === 'fr_spell').instanceId;
      const hd = renderDeckSearchModal();
      const onlyAdd = /deck-search-add-hand/.test(hd) && !/id="deck-search-add"/.test(hd);
      const rb = window.renderBattle; window.renderBattle = () => {};
      try { _deckSearchSelect(App.ui.deckSearch.detailId, 'hand'); } finally { window.renderBattle = rb; }
      out._a5 = { spellListed, onlyAdd, hand: App.state.player.hand.map(c => c.name) };
      return spellListed && onlyAdd && App.state.player.hand.some(c => c.id === 'fr_spell');
    });
    await T('A6_add_to_hand_from_grave_fresh_instance', () => {
      const s = mk('ai'); const g = inst(DEMON); s.ai.graveyard = [g];
      App.state = s;
      const r = _applyOnPlayOne(s, s.units[1], { id: 'fr_src', name: 'Summoner', onPlay: { ...FETCH, fetchDest: 'hand', fetchZones: ['grave'] } });
      const h = r.ai.hand[0];
      return !!h && h.id === 'fr_demon' && h.instanceId !== g.instanceId && r.ai.graveyard.length === 0;
    });

    /* ── B. "if you control a X unit" ── */
    const AOE = { type: 'aoeDamage', amount: 7, aoeAll: true, condition: { conditionSide: 'ally', requireFilter: { nameIncludes: 'Savage Demon' } } };
    await T('B1_condition_blocks_without_the_unit', () => {
      const s = mk('player', [U('fr_e1', 'Orc', 'ai', 4, 3)]); App.state = s;
      const r = _applyOnPlayOne(s, s.units[0], { id: 'fr_src', name: 'Warcry', type: 'spell', onPlay: AOE });
      return r.units.find(u => u.id === 'fr_e1').currentHp === 20 && r.units.find(u => u.id === 'h_a').currentHp === 300;
    });
    await T('B2_condition_fires_with_it_and_hits_units_and_hero', () => {
      const s = mk('player', [U('fr_e1', 'Orc', 'ai', 4, 3), U('fr_sd', 'Savage Demon Grunt', 'player', 4, 8)]); App.state = s;
      const r = _applyOnPlayOne(s, s.units[0], { id: 'fr_src', name: 'Warcry', type: 'spell', onPlay: AOE });
      out._b2 = { orc: r.units.find(u => u.id === 'fr_e1').currentHp, hero: r.units.find(u => u.id === 'h_a').currentHp };
      return r.units.find(u => u.id === 'fr_e1').currentHp < 20 && r.units.find(u => u.id === 'h_a').currentHp < 300;
    });
    await T('B3_enemy_demon_does_not_satisfy_you_control', () => {
      const s = mk('player', [U('fr_e1', 'Orc', 'ai', 4, 3), U('fr_sd', 'Savage Demon Grunt', 'ai', 4, 2)]); App.state = s;
      const r = _applyOnPlayOne(s, s.units[0], { id: 'fr_src', name: 'Warcry', type: 'spell', onPlay: AOE });
      return r.units.find(u => u.id === 'fr_e1').currentHp === 20;
    });
    await T('B4_element_condition', () => {
      const cond = { ...AOE, condition: { conditionSide: 'ally', requireFilter: { element: 'fire' } } };
      const s1 = mk('player', [U('fr_e1', 'Orc', 'ai', 4, 3), U('fr_w', 'Wisp', 'player', 4, 8, { elements: ['water'] })]); App.state = s1;
      const a = _applyOnPlayOne(s1, s1.units[0], { id: 'fr_src', name: 'W', type: 'spell', onPlay: cond }).units.find(u => u.id === 'fr_e1').currentHp;
      const s2 = mk('player', [U('fr_e1', 'Orc', 'ai', 4, 3), U('fr_f', 'Imp', 'player', 4, 8, { elements: ['fire'] })]); App.state = s2;
      const b = _applyOnPlayOne(s2, s2.units[0], { id: 'fr_src', name: 'W', type: 'spell', onPlay: cond }).units.find(u => u.id === 'fr_e1').currentHp;
      return a === 20 && b < 20;
    });

    /* ── C. Inspire's filter ── */
    await T('C_inspire_only_the_filtered', () => {
      const s = mk('player'); s.player.deck = [inst(DEMON), inst(GOB)]; App.state = s;
      const r = _applyOnPlayOne(s, s.units[0], { id: 'fr_src', name: 'Muse', onPlay: { type: 'inspire', amount: 3, filter: { element: 'fire' } } });
      const d = r.player.deck.find(c => c.id === 'fr_demon'), g = r.player.deck.find(c => c.id === 'fr_gob');
      const r2 = _applyOnPlayOne(mk('player'), s.units[0], { id: 'x', name: 'x', onPlay: { type: 'inspire', amount: 3 } });   // no filter → old behaviour, no throw
      return d.stats.atk === 11 && g.stats.atk === 8 && !!r2;
    });

    /* ── D. "…or element" + Return an Ally ── */
    await T('D1_or_element', () => _cardMatchesFilter({ elements: ['ice'] }, { element: 'fire', element2: 'ice' })
      && _cardMatchesFilter({ elements: ['fire'] }, { element: 'fire', element2: 'ice' })
      && !_cardMatchesFilter({ elements: ['water'] }, { element: 'fire', element2: 'ice' })
      && _cardMatchesFilter({ elements: ['ice'] }, { element: 'any', element2: 'ice' })
      && _cardMatchesFilter({ elements: ['fire'] }, { element: 'fire' }));
    const RA = { type: 'returnAlly', filter: { element: 'fire', element2: 'ice' } };
    const raBoard = () => mk('player', [U('fr_f', 'Imp', 'player', 3, 8, { elements: ['fire'] }), U('fr_i', 'Frost', 'player', 4, 8, { elements: ['ice'], currentHp: 5 }),
      U('fr_w', 'Wisp', 'player', 5, 8, { elements: ['water'] }), U('fr_ef', 'Enemy Imp', 'ai', 4, 2, { elements: ['fire'] })]);
    await T('D2_candidates_are_your_fire_or_ice_units', () => {
      const s = raBoard(); const ids = _targetCandidates(s, s.units.find(u => u.id === 'fr_f'), RA).map(u => u.id).sort();
      out._d2 = ids; return JSON.stringify(ids) === JSON.stringify(['fr_f', 'fr_i']);
    });
    await T('D3_ai_saves_the_dying_one_or_keeps_its_board', () => {
      const s = raBoard().units.map(u => u.owner === 'player' && !u.isHero ? { ...u, owner: 'ai' } : u);
      const st = { ...raBoard(), units: s }; const caster = st.units.find(u => u.id === 'fr_f');
      const pick = _aiPickTargetFor(st, caster, RA);
      const healthy = { ...st, units: st.units.map(u => u.id === 'fr_i' ? { ...u, currentHp: 20 } : u) };
      return pick === 'fr_i' && _aiPickTargetFor(healthy, caster, RA) === null;
    });
    await T('D4_the_chosen_unit_returns_to_hand', () => {
      const s = raBoard(); App.state = s; const caster = s.units.find(u => u.id === 'fr_f');
      s.units.find(u => u.id === 'fr_i')._card = { id: 'fr_demon', name: 'Frost' };
      const r = _applyOnPlayOne(s, caster, { id: 'fr_demon', name: 'Imp', onPlay: { ...RA, _targetId: 'fr_i' } });
      return !r.units.some(u => u.id === 'fr_i') && r.player.hand.length === 1 && !r.player.graveyard.length;
    });
    await T('D5_player_gets_a_pick_on_their_turn', () => {
      const s = raBoard(); App.state = s; const caster = s.units.find(u => u.id === 'fr_f');
      const r = _applyOnPlayOne(s, caster, { id: 'fr_demon', name: 'Imp', onPlay: RA });
      out._d5 = (r._pendingTargets || []).length;
      return (r._pendingTargets || []).length === 1 && r.units.some(u => u.id === 'fr_i');
    });

    /* ── E. every death: the hologram + the sound ── */
    await T('E1_death_plays_sound_and_hologram_once', () => {
      const played = [], holo = [];
      const ps = window.playSfx, vi = window._vfxUnitImage, dth = window.MythicEffectFx.death;
      window.playSfx = (id) => played.push(id);
      window._vfxUnitImage = () => 'assets/vfx/effectfx/zombie-arm.webp';
      window.MythicEffectFx.death = (src, a) => { holo.push(src); return true; };
      try {
        const s = mk('player', [U('fr_dead', 'Victim', 'ai', 4, 3, { alive: false, currentHp: 0, _card: { id: 'fr_gob', name: 'Goblin Scout', instanceId: 'fr_x', _summonedUnitId: 'fr_dead' } })]);
        App.state = s; const live = App.state; processTombstoneDrops(live); processTombstoneDrops(live);   // twice: still once (the LIVE object, as the renderer passes it)
        const lookahead = mk('player', [U('fr_dead2', 'Clone', 'ai', 4, 3, { alive: false, currentHp: 0 })]);
        processTombstoneDrops(lookahead);                                     // not the live board: silent
        out._e1 = { played, holo };
        return played.filter(x => x === 'unitDeathHolo').length === 1 && holo.length === 1 && !played.includes('unitDeath');
      } finally { window.playSfx = ps; window._vfxUnitImage = vi; window.MythicEffectFx.death = dth; }
    });
    await T('E2_hologram_draws_and_clears', async () => {
      const im = new Image(); im.src = 'assets/vfx/effectfx/zombie-arm.webp'; await im.decode();
      const count = (t) => { const c = document.createElement('canvas'); c.width = 400; c.height = 400; MythicEffectFx.deathFrame(c, im, { x: 200, y: 250, w: 80 }, t);
        const d = c.getContext('2d').getImageData(0, 0, 400, 400).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 20) n++; return n; };
      const mid = count(0.6), end = count(1.6); out._e2 = { mid, end };
      return mid > 200 && end === 0;
    });
    await T('E3_sfx_slot_registered', () => !!(SFX.unitDeathHolo && /unit-death-holo\.mp3$/.test(SFX.unitDeathHolo.src)));

    /* ── F. the editor: the Fetch box + "…or element" are injected, gated and saved ── */
    await T('F_editor_injects_gates_and_saves', () => {
      const card = { id: 'fr_edcard', name: 'Fetch Test', type: 'spell', cost: 1, onPlay: { type: 'fetchCard', amount: 1, fetchZones: ['grave', 'void'], fetchDest: 'either', fetchSpeed: true, filter: { nameIncludes: 'Savage', element2: 'ice' } } };
      Forge.customCards = Forge.customCards.filter(c => c.id !== card.id).concat([card]);
      const host = document.createElement('div'); document.body.appendChild(host);
      App.editingCardId = card.id; host.innerHTML = renderCardEditor();
      try { bindCardEditor(); } catch (e) { err.F_bind = String(e).slice(0, 200); }
      const box = document.getElementById('ed-onplay-fetchbox'), e2 = document.getElementById('ed-onplay-filter-element2');
      const seeded = box && document.getElementById('ed-onplay-fz-grave').checked && !document.getElementById('ed-onplay-fz-deck').checked
        && document.getElementById('ed-onplay-fdest').value === 'either' && document.getElementById('ed-onplay-fspeed').checked && e2 && e2.value === 'ice';
      const shown = box && getComputedStyle(box).display !== 'none';
      document.getElementById('ed-onplay-fz-deck').checked = true; document.getElementById('ed-onplay-fdoom').checked = true; e2.value = 'fire';
      _fxCaptureFetchRound(card);
      const saved = card.onPlay;
      out._f = { seeded: !!seeded, shown: !!shown, saved: { z: saved.fetchZones, dest: saved.fetchDest, doom: saved.fetchDoom, e2: saved.filter && saved.filter.element2 } };
      host.remove();
      return !!seeded && !!shown && JSON.stringify(saved.fetchZones) === JSON.stringify(['deck', 'grave', 'void']) && saved.fetchDoom === true && saved.filter.element2 === 'fire';
    });
    App.state = null; if (App.ui) { App.ui.deckSearch = null; App.ui.deckSearchQueue = []; }
    return { out, err };
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const fails = Object.keys(R.out).filter(k => !k.startsWith('_') && R.out[k] !== true);
console.log(JSON.stringify({ ok: !fails.length, fails, errors: R.err, detail: Object.fromEntries(Object.entries(R.out).filter(([k]) => k.startsWith('_'))), pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(fails.length ? 1 : 0);
