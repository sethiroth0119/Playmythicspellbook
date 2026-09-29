/* ══════════════════════════════════════════════════════════════════════════
   🌌 REALM TYPE PROBE — Realm cards are a real card type.

   Owner: "Make the Realm deck just like cards that can be added to the deck.
   Move cards that are in the realm deck out of the summon card type, as Summons
   are like tokens. Make Realm Deck a card type where Fusions, Convergence, Evo
   Units, Archons are all in that. These cards can be found in card packs and
   booster boxes. Players have to own these cards to add them to their Realm
   deck." Decisions: convert automatically; normal pack odds; tokens NEVER drop.

   Real code in the loaded page, driven directly (the page sits on a sign-in
   gate, so nothing is clicked through it):
     N  the normaliser: summon+Fusion / summon+Archon / evo / summon+Convergence
        → type 'realm' + realmKind, idempotent; a plain token stays 'summon';
        heroes / spells untouched; lookupCustomCard hands back the new type
     E  the Forge editor: a Realm card of EACH kind renders its own section,
        saves through saveCardFromInputs and survives a JSON reload with its
        stats and recipe; a kind switch turns the other recipe off; Realm → unit
        strips the Realm flags so it does not convert back
     D  the deck builder: a REALM chip that lists Realm cards; the Realm panel
        lists all four kinds; unowned refused, owned added as 'custom:<id>';
        the main deck refuses a Realm card; a double-click on the grid routes
        to the Realm Deck; the Inventory has a Realm tab
     P  packs: Realm cards are in the pool as kind 'realm'; tokens are not; a
        pack authored for the old 'summon' kind still rolls Realm cards
     S  structure decks: the Realm grant is 'custom:<id>'; bare ids are repaired
     A  AI: no Realm card in any draw pile; the AI's Realm list is split out
        per battle and follows an override deck; getBattleEvoCards honours it
     B  bounce: every Realm kind (incl. Evo) returns to the Realm Deck
     R  summons still work from the Realm type: Archon / Fusion / Convergence
        battle pools; an Evo hatch; the battle rail shows Evo

   Usage: node .gauntlet/realmtype-probe.mjs [candidate.html]   (:8787 up)
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
await p.waitForFunction('typeof initGame === "function" && typeof renderCardEditor === "function"', null, { timeout: 120000 });
await p.waitForTimeout(1500);

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const J = (x) => JSON.stringify(x);
  try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {}
  // Nothing in this probe may reach the cloud or the real save.
  window._persistForgeNow = () => {};
  window.saveForge = () => {};
  window.saveProfile = () => {};

  const st = { hp: 40, atk: 12, def: 6, mag: 4, res: 4, spd: 2 };
  const mk = (id, extra) => Object.assign({ id, name: id, icon: '🧪', type: 'unit', rarity: 'rare', cost: 2,
    elements: ['fire'], factions: [], stats: { ...st }, learnset: [{ lvl: 1, m: 'slash' }] }, extra || {});
  const archonSpec = { enabled: true, catalystRank: 'lesser', tier: 'lesser', kalonCost: 0, offeringRange: 2, creator: '',
    catalyst: { faction: '', element: '' }, catalystConsumed: false, offerings: [{ count: 1 }] };
  // Legacy shapes, exactly as the Forge saved them before Realm was a type.
  const L = {
    arc:   mk('rtp_arc',   { name: 'Probe Archon', type: 'summon', isSummon: true, deckable: false, archonSummon: JSON.parse(J(archonSpec)) }),
    fus:   mk('rtp_fus',   { name: 'Probe Fusion', type: 'summon', isSummon: true, deckable: false, summonMethod: 'fusion', requiresPolycreation: true, fusionRequirements: [{ type: 'Unit' }] }),
    ufus:  mk('rtp_ufus',  { name: 'Probe Unit Fusion', type: 'unit', requiresPolycreation: true, fusionRequirements: [{ type: 'Unit' }] }),
    evo:   mk('rtp_evo',   { name: 'Probe Evo', type: 'evo' }),
    evo2:  mk('rtp_evo2',  { name: 'Probe Evo Two', type: 'unit', isEvoUnit: true }),
    cv:    mk('rtp_cv',    { name: 'Probe Convergent', type: 'summon', isSummon: true, deckable: false, convergence: { enabled: true, value: 5, element: '' } }),
    tok:   mk('rtp_tok',   { name: 'Probe Token', type: 'summon', isSummon: true, deckable: false }),
    unit:  mk('rtp_unit',  { name: 'Probe Unit', rarity: 'common' }),
    hero:  mk('rtp_hero',  { name: 'Probe Hero', type: 'hero', archonSummon: JSON.parse(J(archonSpec)) }),
    spell: { id: 'rtp_spell', name: 'Probe Spell', type: 'spell', cost: 1, rarity: 'common', requiresPolycreation: true, effect: { type: 'damage', amount: 3 } },
    cocoon: mk('rtp_cocoon', { name: 'Probe Cocoon', evoAt: 1, evoInto: 'rtp_evo' }),
  };
  const legacyCopy = J(L);
  Forge.customCards = (Forge.customCards || []).filter(c => !String(c && c.id).startsWith('rtp_')).concat(Object.values(L));
  const byId = (id) => (Forge.customCards || []).find(c => c && c.id === id);

  // ══ N. the normaliser ═════════════════════════════════════════════════
  try {
    const norm = window.__mg && window.__mg.realmNormalize;
    ok('N0 the normaliser exists', typeof norm === 'function');
    const all = getAllCustomCards();   // the merged pool normalises on the way out
    const t = (id) => { const c = all.find(x => x && x.id === id) || byId(id); return c ? (c.type + '/' + (c.realmKind || '')) : 'missing'; };
    ok('N1 summon + Archon recipe → realm/archon', t('rtp_arc') === 'realm/archon', t('rtp_arc'));
    ok('N2 summon + Fusion recipe → realm/fusion (and a unit-typed Fusion too)', t('rtp_fus') === 'realm/fusion' && t('rtp_ufus') === 'realm/fusion', t('rtp_fus') + ' ' + t('rtp_ufus'));
    ok('N3 type evo / isEvoUnit → realm/evo', t('rtp_evo') === 'realm/evo' && t('rtp_evo2') === 'realm/evo', t('rtp_evo') + ' ' + t('rtp_evo2'));
    ok('N4 summon + Convergence → realm/convergence', t('rtp_cv') === 'realm/convergence', t('rtp_cv'));
    ok('N5 a plain summon token stays a summon (isSummon kept)', t('rtp_tok') === 'summon/' && byId('rtp_tok').isSummon === true, t('rtp_tok'));
    ok('N6 heroes and spells are never converted', t('rtp_hero') === 'hero/' && t('rtp_spell') === 'spell/', t('rtp_hero') + ' ' + t('rtp_spell'));
    const a = byId('rtp_arc');
    ok('N7 a converted card is collectible (isSummon / deckable:false gone) and keeps its recipe',
      a && !a.isSummon && a.deckable !== false && a.archonSummon && a.archonSummon.enabled === true && isArchonCard(a), J({ isSummon: a && a.isSummon, deckable: a && a.deckable }));
    const snap = J(Forge.customCards.filter(c => String(c.id).startsWith('rtp_')));
    if (norm) Forge.customCards.forEach(c => norm(c));
    ok('N8 idempotent — a second pass changes nothing', J(Forge.customCards.filter(c => String(c.id).startsWith('rtp_'))) === snap);
    const lk = lookupCustomCard('rtp_fus');
    ok('N9 lookupCustomCard hands back the Realm type', lk && lk.type === 'realm', lk && lk.type);
    // a card that arrives later, straight into a lookup (an opponent's definition)
    const late = mk('rtp_late', { type: 'summon', isSummon: true, archonSummon: JSON.parse(J(archonSpec)) });
    Forge.customCards[Forge.customCards.length] = late;   // appended; the list pass may be cached
    const lk2 = lookupCustomCard('rtp_late');
    ok('N10 a card added after the list pass is normalised on lookup', lk2 && lk2.type === 'realm' && lk2.realmKind === 'archon', lk2 && (lk2.type + '/' + lk2.realmKind));
    ok('N11 realm-only rule names every kind', ['rtp_arc', 'rtp_fus', 'rtp_evo', 'rtp_cv'].map(id => _realmOnlyKind(byId(id))).join(',') === 'Archon,Fusion,Evo unit,Convergence',
      ['rtp_arc', 'rtp_fus', 'rtp_evo', 'rtp_cv'].map(id => _realmOnlyKind(byId(id))).join(','));
    ok('N12 the old predicates still answer for the Realm type', isArchonCard(byId('rtp_arc')) && isFusionKalon(byId('rtp_fus')) && isEvoCard(byId('rtp_evo')) && isConvergenceCard(byId('rtp_cv'))
      && !isFusionKalon(byId('rtp_arc')) && !isEvoCard(byId('rtp_fus')));
    ok('N13 isUnitLikeType("realm") — a Realm card has a body', isUnitLikeType('realm'));
  } catch (e) { ok('N ran', false, e.stack || e.message); }

  // ══ E. the editor ═════════════════════════════════════════════════════
  const host = document.createElement('div'); host.id = 'rtp-editor-host'; document.body.appendChild(host);
  const edit = (id) => { App.editingCardId = id; host.innerHTML = renderCardEditor(); };
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
  const secShown = () => Array.from(host.querySelectorAll('[data-rk-sec]')).filter(s => s.style.display !== 'none').map(s => s.dataset.rkSec).join(',');
  try {
    const E = {
      fusion: mk('rtp_ed_fusion', { name: 'Ed Fusion', type: 'realm', realmKind: 'fusion', summonMethod: 'fusion', requiresPolycreation: true, fusionRequirements: [{ type: 'Unit', count: 2 }] }),
      archon: mk('rtp_ed_archon', { name: 'Ed Archon', type: 'realm', realmKind: 'archon', archonSummon: JSON.parse(J(archonSpec)) }),
      evo:    mk('rtp_ed_evo',    { name: 'Ed Evo', type: 'realm', realmKind: 'evo' }),
      convergence: mk('rtp_ed_convergence', { name: 'Ed Convergence', type: 'realm', realmKind: 'convergence', convergence: { enabled: true, value: 7, element: 'fire' } }),
    };
    Forge.customCards.push(...Object.values(E));
    for (const k of ['fusion', 'archon', 'evo', 'convergence']) {
      const c = E[k];
      edit(c.id);
      ok('E1 ' + k + ': type select says Realm, kind select says ' + k + ', only its section shows',
        val('ed-type') === 'realm' && val('ed-realm-kind') === k && secShown() === k, [val('ed-type'), val('ed-realm-kind'), secShown()].join(' | '));
      ok('E2 ' + k + ': the unit body is offered (HP ' + st.hp + ')', val('ed-hp') === String(st.hp), val('ed-hp'));
      document.getElementById('ed-hp').value = '77';
      document.getElementById('ed-atk').value = '19';
      if (k === 'convergence') document.getElementById('ed-cv-value').value = '9';
      App.editingCardId = c.id;
      saveCardFromInputs(false);
      const saved = byId(c.id);
      const re = JSON.parse(J(saved));
      Forge.customCards = Forge.customCards.map(x => x.id === re.id ? re : x);
      edit(re.id);
      const recipe = k === 'fusion' ? isFusionKalon(re) : k === 'archon' ? isArchonCard(re) : k === 'evo' ? isEvoCard(re) : (isConvergenceCard(re) && re.convergence.value === 9);
      ok('E3 ' + k + ': saved + JSON reload → type realm/' + k + ', HP 77 / ATK 19 kept, recipe live',
        re.type === 'realm' && re.realmKind === k && re.stats && re.stats.hp === 77 && re.stats.atk === 19 && recipe && Array.isArray(re.learnset) && re.learnset.length > 0,
        J({ type: re.type, kind: re.realmKind, stats: re.stats, recipe, learnset: re.learnset && re.learnset.length }));
      ok('E4 ' + k + ': the reloaded form shows the same kind and HP', val('ed-realm-kind') === k && val('ed-hp') === '77', val('ed-realm-kind') + ' ' + val('ed-hp'));
      ok('E5 ' + k + ': collectible — no token flags', !re.isSummon && re.deckable !== false);
    }
    // kind switch: fusion → archon turns the fusion recipe off
    const fz = byId('rtp_ed_fusion');
    fz.realmKind = 'archon'; window.__mg.realmReconcile(fz);
    ok('E6 a kind switch turns the other recipe off (Fusion → Archon)', !isFusionKalon(fz) && fz.realmKind === 'archon' && _realmOnlyKind(fz) === 'Archon', J({ sm: fz.summonMethod, rp: fz.requiresPolycreation }));
    // Realm → unit strips the flags so the normaliser does not convert it back
    const ar = byId('rtp_ed_archon');
    ar.type = 'unit'; window.__mg.realmReconcile(ar); window.__mg.realmNormalize(ar);
    ok('E7 Realm → Unit sticks (flags stripped, not re-converted)', ar.type === 'unit' && !isArchonCard(ar) && !ar.realmKind, ar.type + ' ' + J(ar.archonSummon && ar.archonSummon.enabled));
    // a legacy summon-Archon opened in the editor is shown as a Realm card
    const leg = mk('rtp_ed_legacy', { type: 'summon', isSummon: true, archonSummon: JSON.parse(J(archonSpec)) });
    Forge.customCards.push(leg); edit(leg.id);
    ok('E8 a legacy summon-typed Archon opens as Realm / Archon', val('ed-type') === 'realm' && val('ed-realm-kind') === 'archon', val('ed-type') + ' ' + val('ed-realm-kind'));
    // a token shows only the token note — no recipe blocks
    edit('rtp_tok');
    ok('E9 a Summon token shows no Realm recipe blocks', val('ed-type') === 'summon' && !document.getElementById('ed-realm-kind') && !document.getElementById('ed-archon-on') && !document.getElementById('ed-fusion-on'));
    const opts = Array.from(document.querySelectorAll('#ed-type option')).map(o => o.value);
    ok('E10 the type dropdown has Realm, keeps Summon, drops the separate Evo type', opts.includes('realm') && opts.includes('summon') && !opts.includes('evo'), opts.join(','));
  } catch (e) { ok('E ran', false, e.stack || e.message); }
  host.remove(); App.editingCardId = null;

  // ══ D. the deck builder ═══════════════════════════════════════════════
  try {
    Profile.cardCollection = Profile.cardCollection || {};
    ['rtp_arc', 'rtp_fus', 'rtp_evo', 'rtp_cv', 'rtp_unit', 'rtp_cocoon'].forEach(id => { Profile.cardCollection[id] = 2; });
    delete Profile.cardCollection['rtp_evo2']; delete Profile.cardCollection['rtp_ufus'];
    Profile.archonDeck = { cards: [] };
    const heroes = (typeof getAllHeroes === 'function' ? getAllHeroes() : []) || [];
    App.screen = 'deck';
    App.deckBuilderHeroId = (heroes[0] && heroes[0].id) || STARTER_HEROES[0].id;
    App.editingDeckId = 'NEW'; App.deckEdit = []; App.deckEditName = 'Realm Probe';
    App.aiDeckEdit = null; App.starterDeckEdit = null;
    App.deckBuilderFilter = 'realm'; App.deckBuilderOwnFilter = 'any'; App.deckPanelTab = 'archon';
    render(); await sleep(200);
    const chip = document.querySelector('[data-deck-filter="realm"]');
    ok('D1 the deck builder has a REALM chip', !!chip, chip && chip.textContent);
    const keys = Array.from(document.querySelectorAll('[data-sel-zone="collection"]')).map(t => t.dataset.selKey);
    const want = ['rtp_arc', 'rtp_fus', 'rtp_ufus', 'rtp_evo', 'rtp_evo2', 'rtp_cv'].map(id => 'custom:' + id);
    ok('D2 the REALM chip lists the Realm cards (owned and not)', want.every(k => keys.includes(k)), 'missing: ' + want.filter(k => !keys.includes(k)).join(','));
    ok('D3 …and nothing else (no unit, no token)', !keys.includes('custom:rtp_unit') && !keys.includes('custom:rtp_tok') && keys.every(k => { const c = resolveDeckCard(k); return c && isRealmOnlyCard(c); }),
      keys.filter(k => { const c = resolveDeckCard(k); return !(c && isRealmOnlyCard(c)); }).join(','));
    const dk = (getAllDeckableCards() || []).filter(x => String(x.card && x.card.id).startsWith('rtp_'));
    ok('D4 getAllDeckableCards labels them kind "realm" (not "unit") and still hides the token',
      dk.filter(x => isRealmOnlyCard(x.card)).every(x => x.kind === 'realm') && !dk.some(x => x.card.id === 'rtp_tok'), dk.map(x => x.card.id + ':' + x.kind).join(','));
    /* 🌌 Realm Deck #2 (owner, 2026-09-18): the Realm tab is a deck-contents view
       like Main and Side, and the list belongs to the OPEN deck (App.deckEditRealm,
       saved with the deck). rl() reads whichever list this build edits, so the
       checks below hold for both the global and the per-deck design. The full
       per-deck behaviour is .gauntlet/realmdeck2-probe.mjs. */
    const rl = () => (Array.isArray(App.deckEditRealm) ? App.deckEditRealm : Profile.archonDeck.cards);
    const unownedOk = window._realmDeckAdd('custom:rtp_evo2');
    ok('D6 an UNOWNED Realm card is refused', unownedOk === false && rl().length === 0, J(rl()));
    const ownedOk = window._realmDeckAdd('custom:rtp_evo');
    ok('D7 an OWNED Realm card is added as custom:<id>', ownedOk === true && rl().includes('custom:rtp_evo'), J(rl()));
    const md = addToDeck([], 'custom:rtp_arc');
    ok('D8 the MAIN deck refuses a Realm card', Array.isArray(md) && md.length === 0, J(md));
    render(); await sleep(150);
    const th = document.querySelector('[data-sel-zone="collection"][data-sel-key="custom:rtp_cv"]');
    if (th && th.ondblclick) th.ondblclick();
    ok('D9 with the Realm tab open, a double-click on a Realm card in the grid adds it to the Realm Deck',
      rl().includes('custom:rtp_cv') && App.deckEdit.length === 0, J(rl()) + ' main=' + App.deckEdit.length);
    render(); await sleep(150);
    const panel = document.getElementById('db-archon-list');
    const rows = panel ? Array.from(panel.querySelectorAll('[data-ctx-key]')).map(r => r.dataset.ctxKey) : [];
    ok('D5 the Realm tab shows what is IN the Realm Deck (the two added), not every Realm card',
      rows.includes('custom:rtp_evo') && rows.includes('custom:rtp_cv') && !rows.includes('custom:rtp_arc'), rows.filter(r => r.indexOf('rtp_') >= 0).join(','));
    App.screen = 'collection'; App.collectionTab = 'realm'; App.collectionDetailCard = null;
    render(); await sleep(150);
    const tab = document.querySelector('.forge-tab[data-tab="realm"]');
    const inv = Array.from(document.querySelectorAll('[data-collection-kind="realm"]')).map(r => r.dataset.cardId);
    ok('D10 the Inventory has a Realm tab listing Realm cards', !!tab && ['rtp_arc', 'rtp_fus', 'rtp_evo', 'rtp_cv'].every(id => inv.includes(id)), (tab ? 'tab ok ' : 'no tab ') + inv.filter(i => i.indexOf('rtp_') === 0).join(','));
  } catch (e) { ok('D ran', false, e.stack || e.message); }

  // ══ P. packs ══════════════════════════════════════════════════════════
  try {
    const pool = getCardPoolForPacks().filter(x => x && x.card && String(x.card.id).startsWith('rtp_'));
    const kindOf = (id) => { const e = pool.find(x => x.card.id === id); return e ? e.kind : 'absent'; };
    ok('P1 every Realm kind is in the pack pool as kind "realm"', ['rtp_arc', 'rtp_fus', 'rtp_evo', 'rtp_cv'].every(id => kindOf(id) === 'realm'), ['rtp_arc', 'rtp_fus', 'rtp_evo', 'rtp_cv'].map(kindOf).join(','));
    ok('P2 a plain summon token is NOT in the pack pool', kindOf('rtp_tok') === 'absent', kindOf('rtp_tok'));
    ok('P3 an ordinary unit still is', kindOf('rtp_unit') === 'unit', kindOf('rtp_unit'));
    let realmHits = 0, tokHits = 0, legacyHits = 0;
    const full = getCardPoolForPacks();
    for (let i = 0; i < 60; i++) {
      const r1 = rollOneCardForSlot({ weights: { rare: 1 }, _packFilter: { kinds: ['realm'] } }, full);
      if (r1 && isRealmOnlyCard(r1.card)) realmHits++;
      if (r1 && r1.card && (r1.card.type === 'summon' || r1.card.isSummon)) tokHits++;
      const r2 = rollOneCardForSlot({ weights: { rare: 1 }, _packFilter: { kinds: ['summon'] } }, full);
      if (r2 && isRealmOnlyCard(r2.card)) legacyHits++;
    }
    ok('P4 a Realm-kind slot rolls Realm cards, never a token', realmHits === 60 && tokHits === 0, realmHits + ' realm / ' + tokHits + ' token of 60');
    ok('P5 a pack authored for the old "summon" kind still rolls Realm cards', legacyHits === 60, legacyHits + ' of 60');
  } catch (e) { ok('P ran', false, e.stack || e.message); }

  // ══ S. structure decks ════════════════════════════════════════════════
  try {
    const rep = window.__mg && window.__mg.realmRepairKeys;
    ok('S1 bare Realm Deck ids are repaired to custom:<id>', rep && J(rep(['rtp_arc', 'custom:rtp_fus', null, 'unit:rtp_x'])) === J(['custom:rtp_arc', 'custom:rtp_fus', 'unit:rtp_x']), rep && J(rep(['rtp_arc', 'custom:rtp_fus', null, 'unit:rtp_x'])));
    // the deck builder repairs a save it is handed
    Profile.archonDeck = { cards: ['rtp_arc'] };
    App.screen = 'deck'; App.deckBuilderFilter = 'realm'; render(); await sleep(100);
    ok('S2 a bare id already in a save is repaired when the deck builder opens', J(Profile.archonDeck.cards) === J(['custom:rtp_arc']), J(Profile.archonDeck.cards));
    ok('S3 …and a repaired key reaches the battle gate', getBattleArchonCards().some(c => c && c.id === 'rtp_arc'));
    // the real purchase handler
    Profile.archonDeck = { cards: [] };
    delete Profile.cardCollection['rtp_evo2'];
    Forge.structureDecks = (Forge.structureDecks || []).filter(d => d && d.id !== 'rtp_sd').concat([{ id: 'rtp_sd', name: 'Probe Structure', cost: 1, sovCost: 1, cards: ['rtp_evo2', 'rtp_unit'] }]);
    Profile.gems = Math.max(Profile.gems || 0, 1000);
    window.showGameConfirm = async () => true;
    window.spendGems = () => true;
    window.spendSovereigns = () => true;
    Profile.sovereigns = Math.max(Profile.sovereigns || 0, 1000);
    /* ⚠ The shop's structure-deck tile (renderStructTile in _buildPackShopBody)
       is built and never placed on the page, so there is no real button to
       find. The purchase HANDLER is still bound by the pack shop's bind pass,
       over document — so a button of the same shape, put on the page before
       that pass runs, is driven by the real handler. */
    const fake = document.createElement('button');
    fake.setAttribute('data-buy-sdeck', 'rtp_sd'); fake.setAttribute('data-buy-with', 'sovereigns');
    fake.style.display = 'none'; document.body.appendChild(fake);
    App.screen = 'vendorMarket'; App.vendorMarketTab = 'packs'; render(); await sleep(200);
    const btn = (typeof fake.onclick === 'function') ? fake : null;
    if (btn) { btn.disabled = false; await btn.onclick(); }
    fake.remove();
    ok('S4 buying a structure deck puts its Realm card in the Realm Deck as custom:<id> (never bare)',
      !!btn && Profile.archonDeck.cards.includes('custom:rtp_evo2') && !Profile.archonDeck.cards.includes('rtp_evo2') && (Profile.cardCollection['rtp_evo2'] | 0) > 0,
      (btn ? '' : 'no buy button · ') + J(Profile.archonDeck.cards));
  } catch (e) { ok('S ran', false, e.stack || e.message); }

  // ══ A. the AI ═════════════════════════════════════════════════════════
  try {
    const savedCat = Catalog.aiDecks, savedLoc = Forge.aiDecks;
    try {
      Catalog.aiDecks = [{ id: 'rtp_ai', name: 'rtp ai', cards: ['rtp_arc', 'rtp_fus', 'rtp_ufus', 'rtp_evo', 'rtp_cv', 'rtp_unit', 'rtp_unit', 'rtp_tok'] }];
      Forge.aiDecks = [];
      const deck = buildAIDeck();
      const bad = deck.filter(c => c && (isRealmOnlyCard(c) || c.type === 'summon' || c.isSummon)).map(c => c.id);
      ok('A1 buildAIDeck: no Realm card and no token in the AI draw pile', bad.length === 0 && deck.some(c => c && c.id === 'rtp_unit'), 'leaked: ' + bad.join(','));
      const rl = (_aiRealmIds() || []).map(k => String(k).replace(/^[^:]*:/, ''));
      ok('A2 …the Realm cards became the AI\'s Realm Deck for this battle', ['rtp_arc', 'rtp_fus', 'rtp_ufus', 'rtp_evo', 'rtp_cv'].every(id => rl.includes(id)), J(rl));
      Catalog.aiDecks = [{ id: 'rtp_ai2', name: 'rtp ai 2', cards: ['rtp_unit'] }];
      buildAIDeck();
      ok('A3 the next battle\'s AI deck resets it (no stale Realm list)', _aiRealmIds() === null, J(_aiRealmIds()));
      Catalog.aiDecks = [{ id: 'rtp_ai3', name: 'rtp ai 3', cards: ['rtp_evo', 'rtp_unit'] }];
      const keys = getAdminAIDeckKeys();
      ok('A4 getAdminAIDeckKeys: no Realm key in the draw keys', keys.every(k => { const c = resolveDeckCard(k); return !(c && isRealmOnlyCard(c)); }), keys.filter(k => { const c = resolveDeckCard(k); return c && isRealmOnlyCard(c); }).join(','));
      buildAIDeck();   // initGame always runs this before the override is applied
      const forOverride = (typeof _aiRealmForOverride === 'function') ? _aiRealmForOverride(keys) : undefined;
      ok('A5 the override path recovers that deck\'s Realm list', J(forOverride) === J(['custom:rtp_evo']), J(forOverride));
      const padded = (typeof _aiRealmForOverride === 'function') ? _aiRealmForOverride(keys.slice()) : undefined;
      ok('A6 …even from a copied / padded key list', J(padded) === J(['custom:rtp_evo']), J(padded));
      const nodeDeck = (typeof _aiRealmForOverride === 'function') ? _aiRealmForOverride(['custom:rtp_unit', 'custom:rtp_arc']) : undefined;
      ok('A7 a node-authored deck that names a Realm card: that card is its Realm list', J(nodeDeck) === J(['custom:rtp_arc']), J(nodeDeck));
      _AI_REALM_IDS = ['custom:rtp_evo'];
      const aiEvo = getBattleEvoCards('ai').map(c => c.id);
      ok('A8 getBattleEvoCards("ai") honours the AI Realm list', aiEvo.includes('rtp_evo') && !aiEvo.includes('rtp_evo2'), J(aiEvo.filter(i => i.indexOf('rtp_') === 0)));
      _AI_REALM_IDS = null;
      const bd = buildDeckFromKeys(['custom:rtp_arc', 'custom:rtp_evo', 'custom:rtp_cv', 'unit:rtp_ufus', 'custom:rtp_unit', 'custom:rtp_tok']);
      ok('A9 buildDeckFromKeys (every draw pile): Realm and token keys dropped', bd.length === 1 && bd[0].id === 'rtp_unit', bd.map(c => c.id).join(','));
      const sd = buildStarterDeck(Forge.customCards.filter(c => String(c.id).startsWith('rtp_')), null, null);
      const sdBad = (sd || []).filter(c => c && (isRealmOnlyCard(c) || c.type === 'summon')).map(c => c.id);
      ok('A10 buildStarterDeck mixes in no Realm card or token', sdBad.length === 0, sdBad.join(','));
    } finally { Catalog.aiDecks = savedCat; Forge.aiDecks = savedLoc; _AI_REALM_IDS = null; }
  } catch (e) { ok('A ran', false, e.stack || e.message); }

  // ══ B + R. battle ═════════════════════════════════════════════════════
  try {
    Profile.cardCollection['rtp_evo'] = 1; Profile.cardCollection['rtp_arc'] = 1; Profile.cardCollection['rtp_fus'] = 1; Profile.cardCollection['rtp_cv'] = 1;
    Profile.archonDeck = { cards: ['custom:rtp_arc', 'custom:rtp_fus', 'custom:rtp_evo', 'custom:rtp_cv'] };
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null); App.screen = 'battle';
    ok('R1 the Archon battle pool reads a realm-typed Archon', getBattleArchonCards().some(c => c.id === 'rtp_arc'));
    ok('R2 the Fusion battle pool reads a realm-typed Fusion', getBattleFusionKalons('player').some(c => c.id === 'rtp_fus'));
    ok('R3 the Evo battle pool reads a realm-typed Evo', getBattleEvoCards('player').some(c => c.id === 'rtp_evo'));
    if (typeof getBattleConvergenceCards === 'function') ok('R4 the Convergence battle pool reads a realm-typed Convergence', getBattleConvergenceCards('player').some(c => c.id === 'rtp_cv'));
    else ok('R4 the Convergence battle pool reads a realm-typed Convergence', false, 'getBattleConvergenceCards missing (Convergence patch not applied)');
    // Evo hatch from the Realm type
    const d = _boardDims(App.state);
    const hk = new Set(App.state.units.filter(u => u.isHero).map(h => h.pos.x + ',' + h.pos.y));
    let x = Math.floor(d.W / 2), y = Math.floor(d.H / 2); if (hk.has(x + ',' + y)) x++;
    const coc = buildUnit(byId('rtp_cocoon'), 'player', { x, y }); coc.alive = true; coc.pos = { x, y };
    App.state = { ...App.state, units: App.state.units.filter(u => u.isHero).concat([coc]) };
    const after = _evoAdd(App.state, coc, 1, 'probe');
    const born = (after.units || []).find(u => u && u.alive && u.cardId === 'rtp_evo');
    ok('R5 an Evo hatch summons the realm-typed Evo out of the Realm Deck, with its stats', !!born && born.pos.x === x && born.pos.y === y && (born.maxHp | 0) > 0,
      born ? ('hp ' + born.maxHp) : J((after.log || []).slice(-2)));
    // B. bounce — every kind goes home
    for (const id of ['rtp_evo', 'rtp_arc', 'rtp_fus', 'rtp_cv']) {
      const u = buildUnit(byId(id), 'player', { x: 1, y: 1 });
      const r = _unitReturnToHandCard(u);
      ok('B ' + id.replace('rtp_', '') + ' bounced → back to the Realm Deck, not the hand', r && r.archon === true && !r.card, J(r && { archon: r.archon, label: r.realmLabel, card: !!r.card }));
    }
    const plain = _unitReturnToHandCard(buildUnit(byId('rtp_unit'), 'player', { x: 1, y: 1 }));
    ok('B plain unit still returns to the hand', plain && plain.card && !plain.archon);
    // the battle rail shows Evo
    App.state = { ...App.state, turn: 'player' };
    App._pileView = 'realm'; App._realmDetail = null;
    try { renderBattleNow(); } catch (e) {}
    await sleep(300);
    const tiles = Array.from(document.querySelectorAll('[data-realm-card]')).map(t => t.dataset.realmCard);
    ok('R6 the Realm Deck view in battle shows all four kinds (Evo included)', ['rtp_arc', 'rtp_fus', 'rtp_evo', 'rtp_cv'].every(id => tiles.includes(id)), J(tiles));
    App._pileView = null;
  } catch (e) { ok('B/R ran', false, e.stack || e.message); }

  Forge.customCards = (Forge.customCards || []).filter(c => !String(c && c.id).startsWith('rtp_'));
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   ← ' + r.detail)); }
if (errs.length) console.log('page errors (' + errs.length + '): ' + errs.slice(0, 4).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED of ' + out.length : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
