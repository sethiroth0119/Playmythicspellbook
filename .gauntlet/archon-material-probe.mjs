/* ══════════════════════════════════════════════════════════════════════════
   ARCHON MATERIAL PROBE — an Archon's offerings can NAME a card.

   Owner: "Make it where a unit can be the material for an Archon — for example
   an Archon's materials can be 'Ualti Wizards Of Elements' + another unit.
   Our Archons are like Link Summons and Fusions are like Fusions in Yu-Gi-Oh."

   Real functions in the loaded page (the page sits on the sign-in gate, so
   everything is driven directly — no clicks):
     E. the Forge editor: renderCardEditor → pick Ualti in row 0's Specific
        Cards → captureEditorIntoCard → re-render shows it → re-capture is
        stable. Row 1 stays "any unit".
     G. canActivateArchonSummon / findArchonOfferings: Ualti + any unit is
        allowed (with the GENERIC row listed first, so a first-fit finder that
        lets "any unit" eat Ualti is caught); two non-Ualti units are refused;
        Ualti alone is refused; a legacy Title-only Archon still works; a Card
        Filter row (element) is honoured; the named slot holds Ualti.
     R. _applyArchonSummon: both materials leave the field, not to the Void,
        and _reconcileUnitCards files their cards in the owner's graveyard.
     A. _aiTryArchonSummon: the AI summons with Ualti + a unit and does not
        with two non-Ualti units.
     P. the PLAYER gate (Realm Deck + ownership) honours the named slot too.
     D. the card-detail rules text names Ualti.

   Usage: node .gauntlet/archon-material-probe.mjs [candidate.html]   (:8787 up)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 90000 });
await p.waitForFunction(() => typeof window.canActivateArchonSummon === 'function' && typeof window.renderCardEditor === 'function'
  && typeof window.captureEditorIntoCard === 'function', null, { timeout: 60000 });

const out = await p.evaluate(() => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });

  // ── fixtures ───────────────────────────────────────────────────────────
  const unitCard = (id, name, extra) => Object.assign({
    id, name, type: 'unit', cost: 3, rarity: 'common', icon: '🧙', elements: ['water'], factions: [],
    stats: { atk: 10, def: 5, mag: 5, res: 5, spd: 3 }, hp: 30, learnset: [{ lvl: 1, m: 'slash' }],
  }, extra || {});
  const UALTI = unitCard('probe_ualti', 'Ualti Wizards Of Elements', { elements: ['arcane'] });
  const GRUNT = unitCard('probe_grunt', 'Probe Grunt');
  const EMBER = unitCard('probe_ember', 'Probe Ember', { elements: ['fire'] });
  const CAT = unitCard('probe_cat', 'Probe Catalyst', { passive: 'catalyst', passives: ['catalyst'] });
  const archon = (id, offerings) => ({
    id, name: 'Probe Archon ' + id, type: 'summon', isSummon: true, cost: 0, rarity: 'rare', icon: '🜂',
    stats: { atk: 20, def: 10, mag: 10, res: 10, spd: 3 }, hp: 60, learnset: [{ lvl: 1, m: 'slash' }],
    archonSummon: { enabled: true, catalystRank: 'lesser', tier: 'lesser', kalonCost: 0, offeringRange: 2,
      creator: '', catalyst: { faction: '', element: '' }, catalystConsumed: false, offerings },
  });
  // Generic row FIRST — a first-fit finder gives "any unit" the Ualti and then
  // finds nothing for the Ualti row.
  const ARC = archon('probe_archon', [{ count: 1 }, { count: 1, filterCardIds: ['probe_ualti'] }]);
  const ARC_LEGACY = archon('probe_archon_legacy', [{ count: 2 }]);
  const ARC_FIRE = archon('probe_archon_fire', [{ count: 1, filter: { element: 'fire', cardType: 'any', faction: 'any', costMode: 'exact' } }]);

  // Isolate the Archon pool to the probe's cards; restored at the end.
  const saved = { custom: Forge.customCards, cat: (typeof Catalog !== 'undefined' && Array.isArray(Catalog.cards)) ? Catalog.cards : null,
    deck: Profile.archonDeck, coll: Profile.cardCollection, state: App.state, edit: App.editingCardId };
  Forge.customCards = [UALTI, GRUNT, EMBER, CAT, ARC, ARC_LEGACY, ARC_FIRE];
  if (saved.cat) Catalog.cards = saved.cat.filter(c => !(c && c.archonSummon && c.archonSummon.enabled));

  let seq = 0;
  const mk = (def, owner, x, y) => {
    const u = buildUnit(def, owner, { x, y });
    u.id = 'pu_' + def.id + '_' + (++seq);
    u.alive = true;
    if (def === CAT) { u.passives = ['catalyst']; u.passive = 'catalyst'; }
    u._card = Object.assign({}, def, { instanceId: 'iid_' + u.id });
    return u;
  };
  const side = (o) => Object.assign({ hand: [], deck: [], graveyard: [], void: [], energy: 5, maxEnergy: 5, kalonsRemaining: 3 }, o || {});
  const stateWith = (owner, defs) => {
    const cat = mk(CAT, owner, 4, 4);
    const spots = [[4, 5], [5, 4], [3, 4], [4, 3]];
    const units = [cat].concat(defs.map((d, i) => mk(d, owner, spots[i][0], spots[i][1])));
    // a 10×10 board of plain tiles — _boardDims reads state.board, and the
    // summon-tile search refuses every tile on a board it cannot measure
    const board = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ terrain: 'plains' })));
    return { st: { turn: owner, turnNumber: 3, log: [], units, board, player: side(), ai: side(), mods: {} }, cat, units };
  };
  const candIds = (g) => (g && g.candidates || []).map(c => c.archon && c.archon.id);
  const candFor = (g, id) => (g && g.candidates || []).find(c => c.archon && c.archon.id === id) || null;

  try {
    // ── E. editor save → reload ────────────────────────────────────────
    try {
      const ED = archon('probe_archon_ed', [{ faction: '', element: '', trait: '', minLevel: 0, count: 1 }, { count: 1 }]);
      Forge.customCards.push(ED);
      App.editingCardId = ED.id;
      const host = document.createElement('div');
      host.id = 'archon-probe-host';
      host.style.cssText = 'position:absolute;left:-99999px;top:0;width:900px';
      document.body.appendChild(host);
      host.innerHTML = renderCardEditor();
      const h0 = document.getElementById('ed-ar-0-filter-cards');
      ok('E1 each offering row renders a material-card picker (ed-ar-0 / ed-ar-1)', !!h0 && !!document.getElementById('ed-ar-1-filter-cards'));
      if (h0) h0.value = 'probe_ualti';              // what clicking Ualti in the picker writes
      captureEditorIntoCard(ED);
      const offs = (ED.archonSummon && ED.archonSummon.offerings) || [];
      ok('E2 saved: row 0 names Ualti', offs[0] && JSON.stringify(offs[0].filterCardIds) === '["probe_ualti"]', JSON.stringify(offs[0]));
      ok('E3 saved: row 1 stays "any unit" (no ids, no filter), ×1', offs[1] && !offs[1].filterCardIds && !offs[1].filter && offs[1].count === 1, JSON.stringify(offs[1]));
      ok('E4 saved: still an enabled Archon with 2 rows', ED.archonSummon && ED.archonSummon.enabled && offs.length === 2);
      host.innerHTML = renderCardEditor();
      const h0b = document.getElementById('ed-ar-0-filter-cards');
      const h1b = document.getElementById('ed-ar-1-filter-cards');
      ok('E5 reload: row 0 picker comes back holding Ualti', h0b && h0b.value === 'probe_ualti', h0b && h0b.value);
      ok('E6 reload: row 1 picker comes back empty', h1b && h1b.value === '', h1b && h1b.value);
      ok('E7 reload: row 0 summary says it is named Ualti', /Ualti Wizards Of Elements/.test((host.querySelector('.ar-card-details[data-ar-idx="0"] summary') || {}).textContent || ''));
      captureEditorIntoCard(ED);
      const offs2 = ED.archonSummon.offerings;
      ok('E8 re-save is stable', JSON.stringify(offs2) === JSON.stringify(offs), JSON.stringify(offs2));
      host.remove();
      Forge.customCards = Forge.customCards.filter(c => c !== ED);
    } catch (e) { ok('E ran', false, e && e.message); }

    // ── G. the gate (AI side: no Realm-Deck ownership involved) ───────────
    try {
      const a = stateWith('ai', [UALTI, GRUNT]);
      const g = canActivateArchonSummon(a.st, a.cat);
      const c = candFor(g, 'probe_archon');
      ok('G1 Ualti + any unit → the Archon is summonable (generic row listed first)', !!c, g && (g.reason || JSON.stringify(candIds(g))));
      const ualtiId = a.units[1].id, gruntId = a.units[2].id;
      ok('G1b …the named slot (row 2) holds Ualti, the generic slot the other unit', c && c.offerings[1] === ualtiId && c.offerings[0] === gruntId, c && JSON.stringify(c.offerings));
    } catch (e) { ok('G1 ran', false, e && e.message); }
    try {
      const a = stateWith('ai', [GRUNT, GRUNT]);
      const g = canActivateArchonSummon(a.st, a.cat);
      ok('G2 two non-Ualti units → refused', !candFor(g, 'probe_archon'), JSON.stringify(candIds(g)));
      ok('G2b …while the legacy Title-only Archon (×2 any unit) still works', !!candFor(g, 'probe_archon_legacy'), JSON.stringify(candIds(g)));
    } catch (e) { ok('G2 ran', false, e && e.message); }
    try {
      const a = stateWith('ai', [UALTI]);
      const g = canActivateArchonSummon(a.st, a.cat);
      ok('G3 Ualti alone → refused', !candFor(g, 'probe_archon'), JSON.stringify(candIds(g)));
    } catch (e) { ok('G3 ran', false, e && e.message); }
    try {
      const a = stateWith('ai', [GRUNT]);
      const b2 = stateWith('ai', [EMBER]);
      ok('G4 Card Filter row (Fire) refuses a Water unit', !candFor(canActivateArchonSummon(a.st, a.cat), 'probe_archon_fire'));
      ok('G4b …and accepts a Fire unit', !!candFor(canActivateArchonSummon(b2.st, b2.cat), 'probe_archon_fire'));
    } catch (e) { ok('G4 ran', false, e && e.message); }
    try {
      // a Ualti out of range does not count
      const a = stateWith('ai', [GRUNT]);
      const far = mk(UALTI, 'ai', 9, 9);
      a.st.units.push(far);
      ok('G5 a Ualti out of offering range does not count', !candFor(canActivateArchonSummon(a.st, a.cat), 'probe_archon'));
      ok('G6 _matchArchonOffering: the named row refuses a non-Ualti unit (drives the ⇄ swap list too)',
        _matchArchonOffering(a.units[1], ARC.archonSummon.offerings[1]) === false && _matchArchonOffering(far, ARC.archonSummon.offerings[1]) === true);
    } catch (e) { ok('G5 ran', false, e && e.message); }

    // ── R. resolution: materials leave the field to the graveyard ─────────
    try {
      const a = stateWith('ai', [UALTI, GRUNT]);
      const c = candFor(canActivateArchonSummon(a.st, a.cat), 'probe_archon');
      const res = c ? _applyArchonSummon(a.st, { catalystId: a.cat.id, archonCardId: 'probe_archon', offeringUnitIds: c.offerings, kalonCost: c.kalonCost }) : null;
      const ns = res && res.state;
      const byId = (id) => ns && ns.units.find(u => u.id === id);
      const uU = byId(a.units[1].id), uG = byId(a.units[2].id);
      ok('R1 the Archon was spawned', !!(ns && ns.units.some(u => u.alive && u.isArchon && u.cardId === 'probe_archon')));
      ok('R2 Ualti and the other unit left the field', uU && !uU.alive && uG && !uG.alive);
      ok('R3 …not to the Void', uU && !_unitWentToVoid(uU) && uG && !_unitWentToVoid(uG));
      ok('R4 the Catalyst stays', !!(byId(a.cat.id) && byId(a.cat.id).alive));
      const rec = ns ? _reconcileUnitCards(ns) : null;
      const gy = ((rec && rec.ai && rec.ai.graveyard) || []).map(x => x && x.id).sort();
      ok('R5 both material cards are filed in the owner\'s graveyard', JSON.stringify(gy) === '["probe_grunt","probe_ualti"]', JSON.stringify(gy));
    } catch (e) { ok('R ran', false, e && e.message); }

    // ── A. the AI path ────────────────────────────────────────────────────
    try {
      const a = stateWith('ai', [GRUNT, UALTI]);
      Forge.customCards = [UALTI, GRUNT, EMBER, CAT, ARC];
      App.state = a.st;
      const did = _aiTryArchonSummon(a.cat);
      const ns = App.state;
      ok('A1 the AI summons the Archon with Ualti + a unit', did === true && ns.units.some(u => u.alive && u.isArchon && u.cardId === 'probe_archon'));
      ok('A2 …spending Ualti', !(ns.units.find(u => u.id === a.units[2].id) || {}).alive);
      const b2 = stateWith('ai', [GRUNT, GRUNT]);
      App.state = b2.st;
      const did2 = _aiTryArchonSummon(b2.cat);
      ok('A3 the AI does NOT summon it with two non-Ualti units', did2 === false && !App.state.units.some(u => u.isArchon), 'did=' + did2);
      Forge.customCards = [UALTI, GRUNT, EMBER, CAT, ARC, ARC_LEGACY, ARC_FIRE];
    } catch (e) { ok('A ran', false, e && e.message); }

    // ── P. the player path (Realm Deck + ownership gate) ──────────────────
    try {
      Profile.archonDeck = { cards: ['custom:probe_archon'] };
      Profile.cardCollection = Object.assign({}, saved.coll || {}, { probe_archon: 1 });
      const a = stateWith('player', [UALTI, GRUNT]);
      const b2 = stateWith('player', [GRUNT, GRUNT]);
      const ga = canActivateArchonSummon(a.st, a.cat), gb = canActivateArchonSummon(b2.st, b2.cat);
      ok('P1 player: Ualti + a unit → summonable from the Realm Deck', !!candFor(ga, 'probe_archon'), ga && (ga.reason || JSON.stringify(candIds(ga))));
      ok('P2 player: two non-Ualti units → refused', !candFor(gb, 'probe_archon'), JSON.stringify(candIds(gb)));
    } catch (e) { ok('P ran', false, e && e.message); }

    // ── D. rules text ─────────────────────────────────────────────────────
    try {
      const h = _archonReqDetailHtml(ARC);
      ok('D1 the card detail names Ualti Wizards Of Elements as an offering', /1×<\/strong> Ualti Wizards Of Elements/.test(h), (h.match(/<li>.*?<\/li>/g) || []).join(' '));
      ok('D2 …and the other row still reads "any unit"', /1×<\/strong> any unit/.test(h));
    } catch (e) { ok('D ran', false, e && e.message); }
  } finally {
    Forge.customCards = saved.custom;
    if (saved.cat) Catalog.cards = saved.cat;
    Profile.archonDeck = saved.deck; Profile.cardCollection = saved.coll;
    App.state = saved.state; App.editingCardId = saved.edit;
  }
  return R;
});
await b.close();
let fails = 0;
for (const r of out) { if (!r.pass) fails++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.pass ? '' : '   <- ' + r.detail)); }
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + out.length + ' PASS'));
process.exit(fails ? 1 : 0);
