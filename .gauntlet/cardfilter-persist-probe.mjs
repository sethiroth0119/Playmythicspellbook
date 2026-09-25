/* ══════════════════════════════════════════════════════════════════════════
   CARD FILTER PERSIST PROBE — every 🎴 Card Filter field saves, reloads and is
   honoured by the engine.

   Owner: "Make sure these type of filters save and stick so if I set it to 4<
   and keep it there that is the effect — that it can only raise a unit cost 4
   or lower."

   Drives the REAL Forge card editor in the loaded page (renderForge →
   bindCardEditor → captureEditorIntoCard), with isAdmin stubbed so the admin
   gate lets it draw. For every editor block that carries a Card Filter:
     E.  set it through the COST ROW (at most 4) + element + type + name,
         save, JSON round-trip (what storage does), re-open, and check both the
         saved effect object and the controls on screen;
     P.  set it through the SPECIFIC CARDS picker's rule bar ("Cost ≤" + 4,
         Unit) with the Cost row left blank — the controls in the owner's
         screenshot — and check the same;
     K.  specific card ids picked in the block survive a save → reopen → save;
   and then the engine:
     G.  _cardMatchesFilter / _effCardFilter for max / min / exact at 0..6;
     R.  the real resolvers — Raise from Grave, Salvage, Entomb, Search Deck,
         Summon From Zone, Filtered Draw, Vanish Tribe, Send Matching — pull only
         cost 0–4 when the saved filter says "at most 4";
     T.  the summonGrave trap path (applyTrapToUnit) and the grave picker
         (_openDeckSearchModal source 'grave') only offer matching cards.

   Usage: node .gauntlet/cardfilter-persist-probe.mjs [candidate.html]   (:8787 up)
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
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof window.bindCardEditor === 'function' && typeof window.captureEditorIntoCard === 'function'
  && typeof window._cardMatchesFilter === 'function', null, { timeout: 60000 });

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  window.isAdmin = () => true;
  try { window.saveForge = () => {}; } catch (e) {}
  try { window._persistForgeNow = () => {}; } catch (e) {}
  try { window.showToast = () => {}; } catch (e) {}

  const EL = (typeof ELEMENTS !== 'undefined' && ELEMENTS.length) ? ELEMENTS[1] || ELEMENTS[0] : 'fire';

  // Where each prefix's effect object lives on the card.
  const PATH = {
    'ed-onplay':  (c) => c.onPlay,
    'ed-ongrave': (c) => c.onGrave,
    'ed-ig':      (c) => c.inGrave || c.inVoid,
    'ed-grave':   (c) => c.graveActive && c.graveActive.effect,
    'ed-field':   (c) => c.fieldActive && c.fieldActive.effect,
    'ed-hand':    (c) => c.handActive && c.handActive.effect,
    'ed-onatk':   (c) => c.onAttack,
    'ed-onkill':  (c) => c.onKill,
    'ed-milled':  (c) => c.onMilled,
    'ed-kalon-onx': (c) => c.kalonForm && c.kalonForm.onTransform,
  };
  for (let i = 0; i < 6; i++) PATH['ed-onplayx-' + i] = ((k) => (c) => Array.isArray(c.onPlayExtra) ? c.onPlayExtra[k] : null)(i);

  const IG_TRIG = (IN_GRAVE_TRIGGERS[0] || {}).id;
  const IG_EFF = ((typeof _extendEffects === 'function' ? _extendEffects(IN_GRAVE_EFFECTS) : IN_GRAVE_EFFECTS)[0] || {}).id;
  let seq = 0;
  const mkCard = () => {
    const id = 'cfprobe_' + (++seq) + '_' + Date.now();
    return {
      id, name: 'CF Probe ' + seq, type: 'unit', rarity: 'common', icon: '🧪', cost: 3, elements: [EL],
      stats: { hp: 10, atk: 2, def: 1, mag: 1, res: 1, spd: 1 }, learnset: [],
      onPlay:   { type: 'reviveGrave', amount: 1 },
      onPlayExtra: [{ type: 'graveToHand', amount: 1 }, { type: 'reviveGrave', amount: 1 }, { type: 'millSearch', amount: 1 },
                    { type: 'searchDeck', amount: 1 }, { type: 'drawFiltered', amount: 1 }, { type: 'reviveGrave', amount: 1 }],
      onGrave:  { type: 'reviveGrave', amount: 1 },
      // In-Grave is {trigger, effect}, and saves nothing unless both are set.
      inGrave:  { trigger: IG_TRIG, effect: IG_EFF, amount: 1 },
      graveActive: { effect: { type: 'reviveGrave', amount: 1 } },
      fieldActive: { effect: { type: 'reviveGrave', amount: 1 } },
      handActive:  { effect: { type: 'reviveGrave', amount: 1 } },
      onAttack: { type: 'reviveGrave', amount: 1 },
      onKill:   { type: 'reviveGrave', amount: 1 },
      onMilled: { type: 'deploySelf', amount: 0 },   // its own four-option list
      kalonForm: { name: 'CF Kalon', icon: '🧪', stats: { hp: 20, atk: 12, def: 8, mag: 8, res: 8, spd: 1 }, learnset: [],
                   onTransform: { type: 'reviveGrave', amount: 1 } },
    };
  };
  const openEditor = (card) => {
    const i = Forge.customCards.findIndex(c => c && c.id === card.id);
    if (i >= 0) Forge.customCards[i] = card; else Forge.customCards.push(card);
    /* ⚠ Wipe the editor first. renderForge snapshots every input by id and
       restores it after the re-render (_captureForgeFormState), so reopening
       over the old DOM would read back what the probe TYPED, not what saved. */
    App.editingCardId = null; document.getElementById('app').innerHTML = '';
    App.screen = 'forge'; App.forgeTab = 'cards'; App.editingCardId = card.id;
    renderForge();
    return Forge.customCards.find(c => c && c.id === card.id);
  };
  // Save the way the Save button does (minus persistence), then reload from JSON.
  const saveAndReload = (card) => {
    captureEditorIntoCard(card);
    const back = JSON.parse(JSON.stringify(card));
    return openEditor(back);
  };
  const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const setv = (id, v) => { const e = document.getElementById(id); if (!e) return false; e.value = v; fire(e); return true; };
  const getv = (id) => { const e = document.getElementById(id); return e ? e.value : null; };

  const card0 = openEditor(mkCard());
  const prefixes = Object.keys(PATH).filter(pre => document.getElementById(pre + '-filter-element') || document.getElementById(pre + '-felem'));
  const missing = Object.keys(PATH).filter(pre => !prefixes.includes(pre));
  ok('E0 every effect editor has a Card Filter on screen', missing.length === 0, 'missing: ' + missing.join(','));

  // No block may exist that no save path reads: the completion pass used to
  // append ONE Card Filter under the bare prefix "ed-onplayx" for all six
  // extra slots, and nothing ever saved it.
  ok('E0b no orphan shared "ed-onplayx-filter-*" block on screen',
    !document.getElementById('ed-onplayx-filter-costmode') && !document.getElementById('ed-onplayx-filter-element'));

  // The extra slots name their first three filter fields -fname/-felem/-ftype.
  const fid = (pre, k) => /^ed-onplayx-\d$/.test(pre)
    ? pre + ({ name: '-fname', element: '-felem', type: '-ftype' }[k] || ('-filter-' + k))
    : pre + '-filter-' + k;

  // ── E. through the Cost row ───────────────────────────────────────────
  for (const pre of Object.keys(PATH)) {
    try {
      let card = openEditor(mkCard());
      const hasRow = !!document.getElementById(pre + '-filter-costmode');
      ok('E1 ' + pre + ': Cost row (mode + number) is on screen', hasRow);
      if (!hasRow) continue;
      setv(fid(pre, 'name'), 'probe');
      setv(fid(pre, 'element'), EL);
      setv(fid(pre, 'type'), 'unit');
      setv(pre + '-filter-costmode', 'max');
      setv(pre + '-filter-cost', '4');
      card = saveAndReload(card);
      const eff = PATH[pre](card) || {};
      const f = eff.filter || {};
      ok('E2 ' + pre + ': saved filter = at most 4, unit, ' + EL + ', "probe"',
        f.costMode === 'max' && f.cost === 4 && f.cardType === 'unit' && f.element === EL && f.nameIncludes === 'probe',
        JSON.stringify(f));
      ok('E3 ' + pre + ': reopened controls show it',
        getv(pre + '-filter-costmode') === 'max' && getv(pre + '-filter-cost') === '4' && getv(fid(pre, 'type')) === 'unit'
          && getv(fid(pre, 'element')) === EL && getv(fid(pre, 'name')) === 'probe',
        [getv(pre + '-filter-costmode'), getv(pre + '-filter-cost'), getv(fid(pre, 'type')), getv(fid(pre, 'element')), getv(fid(pre, 'name'))].join('|'));
      // a SECOND save without touching anything must keep it (no blank overwrite)
      card = saveAndReload(card);
      const f2 = (PATH[pre](card) || {}).filter || {};
      ok('E4 ' + pre + ': still at most 4 after a second untouched save', f2.costMode === 'max' && f2.cost === 4, JSON.stringify(f2));
      // cost 0 is a real value, not "any"
      setv(pre + '-filter-costmode', 'exact'); setv(pre + '-filter-cost', '0');
      card = saveAndReload(card);
      const f3 = (PATH[pre](card) || {}).filter || {};
      ok('E5 ' + pre + ': "exactly 0" saves as cost 0 and reopens as 0', f3.cost === 0 && f3.costMode === 'exact' && getv(pre + '-filter-cost') === '0', JSON.stringify(f3) + ' ui=' + getv(pre + '-filter-cost'));
    } catch (e) { ok('E ' + pre + ' ran', false, e && e.stack || e); }
  }

  // ── P. through the Specific Cards picker's rule bar ───────────────────
  for (const pre of Object.keys(PATH)) {
    try {
      let card = openEditor(mkCard());
      const cont = document.querySelector('[data-searchpick="' + pre + '-filter-cards"]');
      ok('P1 ' + pre + ': Specific Cards picker is on screen', !!cont);
      if (!cont) continue;
      const q = (s) => cont.querySelector(s);
      q('[data-searchpick-ty]').value = 'unit'; fire(q('[data-searchpick-ty]'));
      q('[data-searchpick-costmode]').value = 'max'; fire(q('[data-searchpick-costmode]'));
      q('[data-searchpick-cost]').value = '4'; fire(q('[data-searchpick-cost]'));
      card = saveAndReload(card);
      const eff = PATH[pre](card) || {};
      const eff2 = (typeof _effCardFilter === 'function') ? _effCardFilter(eff) : null;
      const cheap = { id: 'x1', name: 'Cheap', type: 'unit', cost: 4 }, dear = { id: 'x2', name: 'Dear', type: 'unit', cost: 5 }, spell = { id: 'x3', name: 'Sp', type: 'spell', cost: 1 };
      const eng = (c) => { const f = eff.filter || eff2; return _cardMatchesFilter(c, f); };
      ok('P2 ' + pre + ': picker rule is saved on the effect (Unit, cost ≤ 4)',
        eng(cheap) && !eng(dear) && !eng(spell),
        'filter=' + JSON.stringify(eff.filter) + ' rule=' + JSON.stringify(eff.filterCardRule));
      const c2 = document.querySelector('[data-searchpick="' + pre + '-filter-cards"]');
      const rv = (s) => c2 ? (c2.querySelector(s) || {}).value : null;
      ok('P3 ' + pre + ': reopened picker bar shows Cost ≤ 4, Unit',
        rv('[data-searchpick-costmode]') === 'max' && rv('[data-searchpick-cost]') === '4' && rv('[data-searchpick-ty]') === 'unit',
        [rv('[data-searchpick-costmode]'), rv('[data-searchpick-cost]'), rv('[data-searchpick-ty]')].join('|'));
      // A BACKGROUND re-render mid-edit (cloud sync, upload) rebuilds the
      // editor from the live-captured draft; the bar must come back as set.
      {
        const c3 = document.querySelector('[data-searchpick="' + pre + '-filter-cards"]');
        const q3 = (s) => c3.querySelector(s);
        q3('[data-searchpick-costmode]').value = 'min'; fire(q3('[data-searchpick-costmode]'));
        renderForge();          // no wipe: exactly what a background render does
        const c4 = document.querySelector('[data-searchpick="' + pre + '-filter-cards"]');
        const v4 = c4 ? (c4.querySelector('[data-searchpick-costmode]') || {}).value : null;
        ok('P5 ' + pre + ': an unsaved picker edit survives a background re-render', v4 === 'min', String(v4));
        const q4 = (s) => c4.querySelector(s);
        if (c4) { q4('[data-searchpick-costmode]').value = 'max'; fire(q4('[data-searchpick-costmode]')); }
      }
      card = saveAndReload(Forge.customCards.find(c => c && c.id === card.id) || card);
      const eff3 = PATH[pre](card) || {};
      ok('P4 ' + pre + ': rule survives a second untouched save', _cardMatchesFilter(cheap, eff3.filter) && !_cardMatchesFilter(dear, eff3.filter), JSON.stringify(eff3.filter));
    } catch (e) { ok('P ' + pre + ' ran', false, e && e.stack || e); }
  }

  // ── K. picked card ids survive ────────────────────────────────────────
  ['cfprobe_pick_a', 'cfprobe_pick_b'].forEach((id, i) => {
    if (!Forge.customCards.some(c => c && c.id === id)) Forge.customCards.push({ id, name: 'Pick ' + i, type: 'unit', cost: i + 1, elements: [EL], stats: { hp: 5, atk: 1, def: 1, mag: 1, res: 1, spd: 1 } });
  });
  const pickIds = ['cfprobe_pick_a', 'cfprobe_pick_b'];
  for (const pre of Object.keys(PATH)) {
    try {
      if (pickIds.length < 1) { ok('K ' + pre + ': have cards to pick', false); break; }
      let card = mkCard();
      const eff0 = PATH[pre](card); if (eff0) eff0.filterCardIds = pickIds.slice();
      card = openEditor(card);
      const h = document.getElementById(pre + '-filter-cards');
      ok('K1 ' + pre + ': saved picked ids render into the picker', h && h.value === pickIds.join(','), h ? h.value : '(no picker)');
      card = saveAndReload(card);
      const got = (PATH[pre](card) || {}).filterCardIds || [];
      ok('K2 ' + pre + ': picked ids survive save → reopen', JSON.stringify(got) === JSON.stringify(pickIds), JSON.stringify(got));
    } catch (e) { ok('K ' + pre + ' ran', false, e && e.stack || e); }
  }
  // ── X. a TRAP's Card Filter (its On-Play type left blank) ─────────────
  try {
    let t = { id: 'cfprobe_trap_' + Date.now(), name: 'CF Trap', type: 'trap', rarity: 'common', icon: '🪤', cost: 1, elements: [EL],
              effect: { type: 'summonGrave', amount: 0 } };
    t = openEditor(t);
    setv('ed-onplay-filter-type', 'unit'); setv('ed-onplay-filter-costmode', 'max'); setv('ed-onplay-filter-cost', '4');
    t = saveAndReload(t);
    const ef = (t.effect && t.effect.filter) || {};
    ok('X1 trap "Summon from Owner\'s Graveyard": Card Filter saved on its Effect Type (at most 4)', ef.costMode === 'max' && ef.cost === 4, JSON.stringify(t.effect));
    ok('X2 trap: reopened Cost row shows at most 4', getv('ed-onplay-filter-costmode') === 'max' && getv('ed-onplay-filter-cost') === '4',
      getv('ed-onplay-filter-costmode') + '|' + getv('ed-onplay-filter-cost'));
  } catch (e) { ok('X ran', false, e && e.stack || e); }

  App.editingCardId = null;
  document.getElementById('app').innerHTML = '';

  // ── G. the matcher ───────────────────────────────────────────────────
  const F = { element: 'any', faction: 'any', cardType: 'unit', costMode: 'max', cost: 4 };
  const at = (c) => ({ id: 'g' + c, name: 'G' + c, type: 'unit', cost: c });
  for (const [mode, want, ok04, bad] of [['max', 4, [0, 1, 2, 3, 4], [5, 6, 9]], ['min', 4, [4, 5, 9], [0, 3]], ['exact', 4, [4], [0, 3, 5]], ['exact', 0, [0], [1, 4]]]) {
    const f = { cardType: 'unit', costMode: mode, cost: want };
    ok(`G ${mode} ${want}: allows ${ok04.join(',')} refuses ${bad.join(',')}`,
      ok04.every(c => _cardMatchesFilter(at(c), f)) && bad.every(c => !_cardMatchesFilter(at(c), f)));
  }
  ok('G _effCardFilter returns the saved filter', JSON.stringify(_effCardFilter({ filter: F })) === JSON.stringify(F));

  // ── R. the real resolvers, cost "at most 4" ──────────────────────────
  let _n = 0;
  const mkc = (cost, extra) => {
    const id = 'cfprobe_e' + (++_n) + '_c' + cost;
    const c = Object.assign({ id, name: 'Eng' + _n + ' c' + cost, type: 'unit', rarity: 'common', icon: '🧪', cost, elements: [EL],
      stats: { hp: 5, atk: 1, def: 1, mag: 1, res: 1, spd: 1 }, learnset: [] }, extra || {});
    Forge.customCards.push(Object.assign({}, c));
    return Object.assign({}, c, { instanceId: 'i_' + id });
  };
  const board = () => Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({})));
  const hero = (owner, y) => ({ id: 'hero_' + owner, name: 'Hero ' + owner, owner, isHero: true, alive: true, pos: { x: 3, y }, hp: 50, maxHp: 50, stats: { hp: 50, atk: 1, def: 1, mag: 1, res: 1, spd: 1 }, elements: [EL] });
  const st = (p, extra) => Object.assign({
    turn: 'ai', log: [], board: board(), units: [hero('player', 7), hero('ai', 0)],
    player: Object.assign({ hand: [], deck: [], graveyard: [], void: [], energy: 5, maxEnergy: 5 }, p || {}),
    ai: { hand: [], deck: [], graveyard: [], void: [], energy: 5, maxEnergy: 5 },
  }, extra || {});
  const src = { id: 'u_src', name: 'Src', owner: 'player', alive: true, pos: { x: 3, y: 6 } };
  const run = (s, eff) => _applyOnPlayOneRaw(s, src, { id: 'cf_src', name: 'Src', onPlay: Object.assign({ amount: 1 }, eff) });
  const costs = (arr) => (arr || []).map(c => c && c.cost);
  const offered = () => {        // what the player's picker modal actually lists
    const d = document.createElement('div'); d.innerHTML = renderDeckSearchModal() || '';
    const s = App.state; const ds = App.ui.deckSearch;
    const pile = (s.player[_summonZone(ds.source).key] || []);
    return Array.from(d.querySelectorAll('[data-ds-pick]')).map(b => (pile.find(c => c.instanceId === b.dataset.dsPick) || {}).cost);
  };
  const withModal = (s, fn) => { const o = App.state, u = App.ui && App.ui.deckSearch; App.state = s; App.ui = App.ui || {}; App.ui.deckSearch = null; App.ui.deckSearchQueue = [];
    try { return fn(); } finally { App.state = o; App.ui.deckSearch = u || null; } };

  const cases = [];
  // ⚡️ Raise from Grave
  try {
    const s = st({ graveyard: [mkc(6), mkc(5), mkc(3), mkc(0)] });
    const ns = run(s, { type: 'reviveGrave', filter: F });
    const raised = (ns.units || []).filter(u => !u.isHero);
    ok('R1 Raise from Grave (at most 4): raises a 0-4, never the 5/6 ahead of it', raised.length === 1 && raised[0].cost <= 4, 'raised costs ' + JSON.stringify(raised.map(u => u.cost)));
    const ns2 = run(st({ graveyard: [mkc(5), mkc(7)] }), { type: 'reviveGrave', filter: F });
    ok('R2 Raise from Grave: nothing when the grave holds only 5+', !(ns2.units || []).some(u => !u.isHero));
  } catch (e) { ok('R1 ran', false, e && e.stack || e); }
  // ♻️ Salvage (deterministic)
  try {
    const ns = run(st({ graveyard: [mkc(2), mkc(6)] }), { type: 'graveToHand', filter: F, _autoPick: true });
    ok('R3 Salvage (at most 4): returns the 2, not the newer 6', JSON.stringify(costs(ns.player.hand)) === '[2]', JSON.stringify(costs(ns.player.hand)));
    const ns2 = run(st({ graveyard: [mkc(5), mkc(6)] }), { type: 'graveToHand', filter: F, _autoPick: true });
    ok('R4 Salvage (at most 4): grave holds only 5+ → salvages NOTHING', (ns2.player.hand || []).length === 0, 'hand costs ' + JSON.stringify(costs(ns2.player.hand)));
    const s3 = st({ graveyard: [mkc(1), mkc(4), mkc(5), mkc(6)] }, { turn: 'player' });
    const got = withModal(s3, () => { run(s3, { type: 'graveToHand', filter: F }); return offered(); });
    ok('R5 Salvage picker offers only 0-4', got.length === 2 && got.every(c => c <= 4), JSON.stringify(got));
  } catch (e) { ok('R3 ran', false, e && e.stack || e); }
  // ⚰️🔍 Entomb
  try {
    const ns = run(st({ deck: [mkc(6), mkc(5), mkc(3)] }), { type: 'millSearch', filter: F, _autoPick: true });
    ok('R6 Entomb (at most 4): buries the 3 only', JSON.stringify(costs(ns.player.graveyard)) === '[3]', JSON.stringify(costs(ns.player.graveyard)));
    const s2 = st({ deck: [mkc(6), mkc(2), mkc(4)] }, { turn: 'player' });
    const got = withModal(s2, () => { run(s2, { type: 'millSearch', filter: F }); return offered(); });
    ok('R7 Entomb picker offers only 0-4', got.length === 2 && got.every(c => c <= 4), JSON.stringify(got));
  } catch (e) { ok('R6 ran', false, e && e.stack || e); }
  // 🔍 Search Deck
  try {
    const ns = run(st({ deck: [mkc(7), mkc(4)] }), { type: 'searchDeck', searchDeckType: 'any', filter: F, _autoPick: true });
    ok('R8 Search Deck (at most 4): fetches the 4', JSON.stringify(costs(ns.player.hand)) === '[4]', JSON.stringify(costs(ns.player.hand)));
    const s2 = st({ deck: [mkc(7), mkc(1), mkc(5)] }, { turn: 'player' });
    const got = withModal(s2, () => { run(s2, { type: 'searchDeck', searchDeckType: 'any', filter: F }); return offered(); });
    ok('R9 Search Deck picker offers only 0-4', JSON.stringify(got) === '[1]', JSON.stringify(got));
  } catch (e) { ok('R8 ran', false, e && e.stack || e); }
  // 🌟 Summon From Zone (graveyard)
  try {
    const ns = run(st({ graveyard: [mkc(8), mkc(4)] }), { type: 'summonFromZone', summonZone: 'grave', filter: F, _autoPick: true });
    const sp = (ns.units || []).filter(u => !u.isHero);
    ok('R10 Summon From Zone (grave, at most 4): summons the 4 only', sp.length === 1 && sp[0].cost === 4, JSON.stringify(sp.map(u => u.cost)));
    const s2 = st({ graveyard: [mkc(8), mkc(0), mkc(5)] }, { turn: 'player' });
    const got = withModal(s2, () => { run(s2, { type: 'summonFromZone', summonZone: 'grave', filter: F }); return offered(); });
    ok('R11 Summon From Zone picker offers only 0-4', JSON.stringify(got) === '[0]', JSON.stringify(got));
  } catch (e) { ok('R10 ran', false, e && e.stack || e); }
  // 🎴 Filtered Draw
  try {
    const ns = run(st({ deck: [mkc(5), mkc(2)] }), { type: 'drawFiltered', filter: F });
    ok('R12 Filtered Draw (at most 4): draws the 2', JSON.stringify(costs(ns.player.hand)) === '[2]', JSON.stringify(costs(ns.player.hand)));
  } catch (e) { ok('R12 ran', false, e && e.stack || e); }
  // 🫳 Send Matching (hand)
  try {
    const ns = run(st({ hand: [mkc(5), mkc(1)] }), { type: 'sendMatching', sendZone: 'hand', filter: F, _autoPick: true });
    ok('R13 Send Matching (at most 4): sends the 1, keeps the 5', JSON.stringify(costs(ns.player.hand)) === '[5]', JSON.stringify(costs(ns.player.hand)));
  } catch (e) { ok('R13 ran', false, e && e.stack || e); }
  // 🌫 Vanish Tribe (enemy board)
  try {
    const s = st();
    const eu = (cost, x) => Object.assign(buildUnit(mkc(cost), 'ai', { x, y: 1 }), { alive: true });
    s.units = s.units.concat([eu(5, 1), eu(3, 2)]);
    const ns = run(s, { type: 'vanishTribe', filter: F });
    const left = (ns.units || []).filter(u => u.owner === 'ai' && !u.isHero && u.alive !== false).map(u => u.cost);
    ok('R14 Vanish Tribe (at most 4): the 3 goes, the 5 stays', JSON.stringify(left) === '[5]', JSON.stringify(left));
  } catch (e) { ok('R14 ran', false, e && e.stack || e); }
  // 🪦 summonGrave trap
  try {
    const trapCard = { id: 'cfprobe_trapc', name: 'Grave Trap', type: 'trap', effect: { type: 'summonGrave', amount: 0, filter: F } };
    const victim = Object.assign(buildUnit(mkc(1), 'ai', { x: 4, y: 4 }), { alive: true });
    const s = st({ graveyard: [mkc(3), mkc(6)] }, { turn: 'player' });
    s.units = s.units.concat([victim]);
    const got = withModal(s, () => { applyTrapToUnit(s, victim, { card: trapCard, owner: 'player', pos: { x: 4, y: 4 } }); return offered(); });
    ok('T1 summonGrave trap (own turn): picker offers only the 3', JSON.stringify(got) === '[3]', JSON.stringify(got));
    const s2 = st({ graveyard: [mkc(3), mkc(6)] }, { turn: 'ai' });
    const v2 = Object.assign(buildUnit(mkc(1), 'ai', { x: 4, y: 4 }), { alive: true });
    s2.units = s2.units.concat([v2]);
    const ns = applyTrapToUnit(s2, v2, { card: trapCard, owner: 'player', pos: { x: 4, y: 4 } });
    const nsS = (ns && ns.state) || ns;
    const rose = ((nsS && nsS.units) || []).filter(u => u.owner === 'player' && !u.isHero).map(u => u.cost);
    ok('T2 summonGrave trap (off-turn auto): raises the 3, never the newer 6', JSON.stringify(rose) === '[3]', JSON.stringify(rose) + ' grave=' + JSON.stringify(costs(nsS && nsS.player && nsS.player.graveyard)));
  } catch (e) { ok('T ran', false, e && e.stack || e); }

  Forge.customCards = Forge.customCards.filter(c => !(c && /^cfprobe_/.test(c.id)));
  return R;
});

let fail = 0;
for (const r of out) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.label + (r.pass || !r.detail ? '' : '   -> ' + r.detail)); }
if (errs.length) console.log('page errors:', errs.slice(0, 5).join(' | '));
console.log(`\n${out.length - fail}/${out.length} pass`);
await b.close();
process.exit(fail ? 1 : 0);
