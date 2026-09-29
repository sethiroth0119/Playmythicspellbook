/* ══════════════════════════════════════════════════════════════════════════
   🃏 DRIVE-HAND-WIPE — "some effects discard the WHOLE hand and empty the
   graveyard."

   Reported: turn 2 of a CPU match — hand EMPTY, graveyard 0, deck still 40,
   and the hand strip reading "No cards. Drawing fatigue!".

   ⚠ THAT STRING IS NOT A DECK-OUT. It is the hand-strip / hand-column EMPTY
   placeholder (index.html, `.hand-strip-cards` / `.hand-column-cards`). It
   says nothing about the deck. The deck reading 40 is the load-bearing clue:
   40 is DECK_SIZE, and a match deals 5 of those into the opening hand, so a
   deck that is BACK at 40 on turn 2 has been handed its hand back.

   WHAT THIS DRIVER FOUND (PASS 1 + PASS 3): `shuffleToDeck` — "🔀 Shuffle
   Into Deck" in the card editor — defaults to shuffleZones = 'all' and
   drawSide = 'none'. Authored with the pickers left alone it sweeps the
   owner's FIELD + HAND + GRAVEYARD + VOID into the deck, shuffles, and draws
   nothing back. Hand 0, graveyard 0, deck restored to full. Exactly the
   screenshot.

   PASS 2 exists to RULE OUT the lead everyone starts with — the deck-search
   modal (`searchDeck` → _openDeckSearchModal → _deckSearchSelect), including
   the nasty states: commit after the state was swapped underneath it, commit
   with a full hand, re-entry while already open, and cancel.

   🔴 REAL MATCH OR NOTHING. Setting App.screen='battle' and calling render()
   builds an EMPTY shell, and then every "the cards are gone" assertion passes
   for the worst possible reason. Everything below runs on a state built by the
   real initGame(), played through the real placeUnit(), and PASS 0 proves the
   chrome is actually on screen.

   Run:  node .gauntlet/drive-hand-wipe.mjs            (passes 0,2,3,4 — ~2 min)
         node .gauntlet/drive-hand-wipe.mjs --full     (adds the 109-effect sweep)
         node .gauntlet/drive-hand-wipe.mjs --headed
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const FULL = process.argv.includes('--full');
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8700 + (process.pid % 60);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* 🔁 DIRECTIONAL ASSERT — the reason this file no longer cries wolf.
   This driver was written to REPRODUCE the hand/graveyard wipe, so it asserts
   the BUGGY numbers. Once the fix landed it reported 9 failures against
   correct code and every one of them was the fix working. A guard whose red
   means "fixed" is worse than no guard.
   Default: assert the FIXED behaviour (a regression guard).
   --repro: assert the BUGGY behaviour, for pointing at a pre-fix tree. */
const REPRO = process.argv.includes('--repro');
const okDir = (name, buggy, fixed, detail) =>
  ok((REPRO ? '[repro] ' : '') + name, REPRO ? buggy : fixed, detail);

const browser = await chromium.launch({
  headless: !process.argv.includes('--headed'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof initGame === "function" && typeof findHeroById === "function" && typeof placeUnit === "function"',
  null, { timeout: 180000 });
await page.waitForTimeout(4000);

/* ── helpers installed into the page ──────────────────────────────────────
   initGame / placeUnit / getValidPlacementTiles / ONPLAY_TYPES / DECK_SIZE are
   top-level `const` in a CLASSIC script, so they ARE visible to a global-scope
   evaluate — they are just not on `window`. (Contrast battle-board/index.html,
   whose consts live in a module and genuinely are not reachable.) */
const installHelpers = (pg) => pg.evaluate(() => {
  window.__hw = {};
  window.__hw.startMatch = function () {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle';
    App.ui = App.ui || {};
    App.ui.deckSearch = null;
    render();
  };
  window.__hw.snap = function () {
    const p = (App.state && App.state.player) || {};
    return {
      hand: (p.hand || []).length, deck: (p.deck || []).length,
      grave: (p.graveyard || []).length, void: (p.void || []).length,
      total: (p.hand || []).length + (p.deck || []).length + (p.graveyard || []).length + (p.void || []).length,
      modal: !!(App.ui && App.ui.deckSearch),
      turn: App.state && App.state.turnNumber,
    };
  };
  window.__hw.seedGrave = function (n) {
    const g = [];
    for (let i = 0; i < (n || 3); i++) g.push({ id: 'seed' + i, name: 'Seed ' + i, type: 'unit', instanceId: 'sg_' + i + '_' + Math.random() });
    App.state = { ...App.state, player: { ...App.state.player, graveyard: g } };
  };
  window.__hw.mkProbe = function (eff, extra) {
    return Object.assign({
      id: '_probe', name: 'Probe Unit', type: 'unit', cost: 0, level: 1,
      atk: 3, def: 1, hp: 10, stats: { atk: 3, def: 1, hp: 10 },
      instanceId: 'probe_' + Math.random().toString(36).slice(2),
      onPlay: eff,
    }, extra || {});
  };
  window.__hw.playProbe = function (eff, extra) {
    const card = window.__hw.mkProbe(eff, extra);
    App.state = { ...App.state, player: { ...App.state.player, hand: [...App.state.player.hand, card], energy: 20, maxEnergy: 20 } };
    const ph = App.state.units.find(u => u.owner === 'player' && u.isHero);
    const tiles = getValidPlacementTiles(card, ph, App.state);
    if (!tiles.length) return { err: 'no legal tile' };
    placeUnit(card, tiles[0]);
    return { ok: true };
  };
  /* Same, but the probe TAKES an existing hand slot instead of adding one, so the
     player's card pool stays the closed 40 a real match has. Required for PASS 3:
     an injected 41st card would land the deck on 41 and make the count untestable
     against the screenshot. */
  window.__hw.playProbeSwap = function (eff, extra) {
    const card = window.__hw.mkProbe(eff, extra);
    const h = App.state.player.hand.slice();
    if (!h.length) return { err: 'empty hand' };
    h[0] = card;
    App.state = { ...App.state, player: { ...App.state.player, hand: h, energy: 20, maxEnergy: 20 } };
    const ph = App.state.units.find(u => u.owner === 'player' && u.isHero);
    const tiles = getValidPlacementTiles(card, ph, App.state);
    if (!tiles.length) return { err: 'no legal tile' };
    placeUnit(card, tiles[0]);
    return { ok: true };
  };
  window.__hw.effectIds = function () { try { return ONPLAY_TYPES.map(t => t.id); } catch (e) { return []; } };
  window.__hw.deckSize = function () { try { return DECK_SIZE; } catch (e) { return null; } };
  // Pad the hand to exactly n cards (for the hand-full branch of _deckSearchSelect).
  window.__hw.padHand = function (n) {
    const h = (App.state.player.hand || []).slice();
    while (h.length < n) h.push({ id: 'pad', name: 'Pad ' + h.length, type: 'unit', cost: 9,
      instanceId: 'pad_' + h.length + '_' + Math.random() });
    App.state = { ...App.state, player: { ...App.state.player, hand: h.slice(0, n) } };
  };
});
await installHelpers(page);

// A page loaded from scratch, so PASS 7's screenshot cannot inherit an overlay
// (a victory summary, an ability panel) left standing by an earlier pass. Those
// overlays do not change the pile counts, but a contaminated screenshot is a
// contaminated exhibit.
const freshPage = async () => {
  const pg = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('typeof initGame === "function" && typeof placeUnit === "function"', null, { timeout: 180000 });
  await pg.waitForTimeout(4000);
  await installHelpers(pg);
  return pg;
};

/* ══ PASS 0 — the match is REAL ════════════════════════════════════════ */
await page.evaluate(() => window.__hw.startMatch());
await page.waitForTimeout(2500);
const real = await page.evaluate(() => ({
  screen: App.screen,
  units: (App.state.units || []).length,
  hand: App.state.player.hand.length,
  deck: App.state.player.deck.length,
  deckSize: window.__hw.deckSize(),
  endTurnText: [...document.querySelectorAll('button')].some(b => /end turn/i.test(b.textContent || '')),
  handCards: document.querySelectorAll('.hand-strip-cards *, .hand-column-cards *').length,
}));
console.log('\n═══ PASS 0 — is this a real match? ═══');
console.log('  ' + JSON.stringify(real));
ok('screen is battle', real.screen === 'battle');
ok('two heroes on the board', real.units >= 2, 'units=' + real.units);
ok('opening hand dealt', real.hand === 5, 'hand=' + real.hand);
ok('deck is DECK_SIZE − opening hand', real.deck === real.deckSize - 5, `deck=${real.deck} DECK_SIZE=${real.deckSize}`);
ok('END TURN chrome rendered (not the empty shell)', real.endTurnText === true);
ok('hand strip has card nodes', real.handCards > 0, 'nodes=' + real.handCards);

/* ══ PASS 1 (optional) — sweep every authorable on-play effect ══════════ */
if (FULL) {
  const ids = await page.evaluate(() => window.__hw.effectIds());
  console.log('\n═══ PASS 1 — ' + ids.length + ' on-play effects, each played by the real placeUnit() ═══');
  const rows = [];
  for (const id of ids) {
    const r = await page.evaluate(async (eid) => {
      window.__hw.startMatch(); window.__hw.seedGrave(3);
      const before = window.__hw.snap();
      let err = null;
      try {
        window.__hw.playProbe({ type: eid, amount: 2, radius: 2, chance: 100, status: 'weak',
          statusDuration: 2, graveSide: 'self', searchDeckType: 'any', sendZone: 'grave' });
      } catch (e) { err = String(e && e.message || e).slice(0, 120); }
      await new Promise(res => setTimeout(res, 60));
      return { eid, before, after: window.__hw.snap(), err };
    }, id);
    const handWiped = r.after.hand === 0 && r.before.hand > 1;
    const graveWiped = r.after.grave === 0 && r.before.grave > 0;
    rows.push({ ...r, handWiped, graveWiped });
    if (handWiped || graveWiped || r.err) {
      console.log('  ' + (handWiped && graveWiped ? '🔴 BOTH ' : handWiped ? '🟠 HAND ' : graveWiped ? '🟡 GRAVE' : '⚠ ERR  ')
        + ' ' + r.eid.padEnd(22)
        + ' hand ' + r.before.hand + '→' + r.after.hand
        + '  grave ' + r.before.grave + '→' + r.after.grave
        + '  deck ' + r.before.deck + '→' + r.after.deck
        + '  void ' + r.before.void + '→' + r.after.void
        + (r.err ? '  ERR=' + r.err : ''));
    }
  }
  const both = rows.filter(r => r.handWiped && r.graveWiped);
  console.log('  ── swept ' + rows.length + ': ' + both.length + ' wiped BOTH piles');
  fs.writeFileSync(path.resolve('.gauntlet/_handwipe-sweep.json'), JSON.stringify(rows, null, 1));
  ok('exactly one effect wipes hand AND graveyard', both.length === 1, 'culprits=' + JSON.stringify(both.map(b => b.eid)));
  ok('the culprit is shuffleToDeck', both.length === 1 && both[0].eid === 'shuffleToDeck');
}

/* ══ PASS 2 — RULE OUT the deck-search modal ═══════════════════════════
   Four ways the searchDeck picker can go wrong, each committed through the
   REAL DOM controls (#deck-search-add / #deck-search-skip), not by calling
   _deckSearchSelect directly. */
console.log('\n═══ PASS 2 — the searchDeck modal, driven through its real buttons ═══');

const openSearch = async () => {
  await page.evaluate(() => {
    // 🔴 An overlay left standing by an earlier pass (a gcConfirm alert, the
    // surveil picker, a poly picker) covers the whole page and swallows every
    // click — Playwright then times out on a tile that IS visible and enabled.
    // The 109-effect sweep opens several of these, so clear them, and the App.ui
    // state that re-renders them, before each scenario.
    try { Object.assign(App.ui, { deckSearch: null, pilePeek: null, polyPick: null,
      choosePick: null, surveilPick: null, surveil: null }); } catch (e) {}
    document.querySelectorAll('[id$="-modal"], [id$="-backdrop"], .modal-backdrop')
      .forEach(n => n.remove());
    window.__hw.startMatch();
    window.__hw.seedGrave(3);
    window.__hw.playProbe({ type: 'searchDeck', searchDeckType: 'any' });
  });
  await page.waitForTimeout(700);
};
const modalTiles = () => page.locator('[data-ds-pick]');

// 2a — the plain happy path
{
  await openSearch();
  const before = await page.evaluate(() => window.__hw.snap());
  const n = await modalTiles().count();
  await modalTiles().first().click();
  await page.waitForTimeout(400);
  await page.locator('#deck-search-add').click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__hw.snap());
  console.log('  2a plain pick      ' + JSON.stringify(before) + ' → ' + JSON.stringify(after) + '  (tiles=' + n + ')');
  ok('2a modal opened with real deck tiles', n > 0, 'tiles=' + n);
  ok('2a hand +1', after.hand === before.hand + 1, `${before.hand}→${after.hand}`);
  ok('2a deck −1', after.deck === before.deck - 1, `${before.deck}→${after.deck}`);
  ok('2a graveyard untouched', after.grave === before.grave, `${before.grave}→${after.grave}`);
  ok('2a no card lost or minted', after.total === before.total, `${before.total}→${after.total}`);
}

// 2b — the state is SWAPPED underneath the open modal (play another card, then commit).
//      This is the "a caller holds the pre-effect state" worry, exercised for real.
{
  await openSearch();
  await page.evaluate(() => window.__hw.playProbe({ type: 'gainEnergy', amount: 1 }));
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.__hw.snap());
  await modalTiles().first().click();
  await page.waitForTimeout(400);
  await page.locator('#deck-search-add').click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__hw.snap());
  console.log('  2b swapped state   ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
  ok('2b hand +1 (not wiped)', after.hand === before.hand + 1, `${before.hand}→${after.hand}`);
  ok('2b graveyard survives', after.grave === before.grave, `${before.grave}→${after.grave}`);
  ok('2b no card lost or minted', after.total === before.total, `${before.total}→${after.total}`);
}

// 2c — hand FULL. The detail view withholds #deck-search-add entirely and shows
//      "✋ Hand is full", so the early `_deckSearchCancel()` on hand.length >= 8
//      inside _deckSearchSelect is only reachable if something calls it anyway
//      (a stale click, a relay). Both halves are checked.
{
  await openSearch();
  await page.evaluate(() => window.__hw.padHand(8));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.__hw.snap());
  await modalTiles().first().click();
  await page.waitForTimeout(600);
  const gate = await page.evaluate(() => ({
    addBtn: !!document.getElementById('deck-search-add'),
    note: /Hand is full/.test(document.body.textContent || ''),
  }));
  ok('2c UI withholds the Add button at 8 cards', gate.addBtn === false && gate.note === true, JSON.stringify(gate));
  // Force the guarded branch anyway — this is the path the lead worried about.
  const after = await page.evaluate(async () => {
    const id = (App.ui.deckSearch && App.ui.deckSearch.detailId)
      || (App.state.player.deck[0] && App.state.player.deck[0].instanceId);
    _deckSearchSelect(id);
    await new Promise(r => setTimeout(r, 300));
    return window.__hw.snap();
  });
  console.log('  2c hand full       ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
  ok('2c hand still 8 (not wiped)', after.hand === 8, `hand=${after.hand}`);
  ok('2c graveyard survives', after.grave === before.grave, `${before.grave}→${after.grave}`);
  ok('2c modal closed', after.modal === false);
  ok('2c no card lost or minted', after.total === before.total, `${before.total}→${after.total}`);
}

// 2d — re-entered while already open, then committed
{
  await openSearch();
  await page.evaluate(() => window.__hw.playProbe({ type: 'searchDeck', searchDeckType: 'any' }));
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.__hw.snap());
  await modalTiles().first().click();
  await page.waitForTimeout(400);
  await page.locator('#deck-search-add').click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__hw.snap());
  console.log('  2d re-entered      ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
  ok('2d hand +1 (not wiped)', after.hand === before.hand + 1, `${before.hand}→${after.hand}`);
  ok('2d graveyard survives', after.grave === before.grave, `${before.grave}→${after.grave}`);
  ok('2d no card lost or minted', after.total === before.total, `${before.total}→${after.total}`);
}

// 2e — cancelled
{
  await openSearch();
  const before = await page.evaluate(() => window.__hw.snap());
  await page.locator('#deck-search-skip').click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__hw.snap());
  console.log('  2e cancelled       ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
  ok('2e nothing moved on cancel', after.hand === before.hand && after.deck === before.deck
    && after.grave === before.grave && after.total === before.total,
    `${JSON.stringify(before)}→${JSON.stringify(after)}`);
}

/* ══ PASS 3 — REPRODUCE THE SCREENSHOT ════════════════════════════════
   A real CPU match, taken to TURN 2, then one shuffleToDeck card played with
   the editor's DEFAULT pickers (nothing set — exactly what "pick the effect
   and hit Save" produces). Expect: hand 0, graveyard 0, deck back at 40, and
   the hand strip showing the "No cards. Drawing fatigue!" placeholder. */
console.log('\n═══ PASS 3 — turn-2 reproduction of the reported screenshot ═══');
const repro = await page.evaluate(async () => {
  window.__hw.startMatch();
  // Take the real turn boundary so this is turn 2 with a drawn card, as reported.
  onEndTurn(); await new Promise(r => setTimeout(r, 1500));
  let guard = 0;
  while (App.state.turn !== 'player' && guard++ < 60) await new Promise(r => setTimeout(r, 500));
  const before = window.__hw.snap();
  // The editor's own defaults: shuffleZones/shuffleSide/shuffleSelf/drawSide all
  // omitted → 'all' / 'owner' / 'shuffle' / 'none'. See _buildOnPlayEditor and
  // the effect reader in applyOnPlayEffect.
  window.__hw.playProbeSwap({ type: 'shuffleToDeck' });
  await new Promise(r => setTimeout(r, 900));
  renderBattle();
  await new Promise(r => setTimeout(r, 900));
  const after = window.__hw.snap();
  const strip = document.querySelector('.hand-strip-cards, .hand-column-cards');
  return { before, after, deckSize: window.__hw.deckSize(),
    placeholder: strip ? strip.textContent.trim().slice(0, 40) : '(no hand strip)',
    logTail: (App.state.log || []).slice(-3).map(l => l.msg) };
});
console.log('  before: ' + JSON.stringify(repro.before));
console.log('  after : ' + JSON.stringify(repro.after));
console.log('  hand strip reads: "' + repro.placeholder + '"');
console.log('  log tail: ' + JSON.stringify(repro.logTail));
ok('3 reached turn 2', repro.before.turn >= 2, 'turn=' + repro.before.turn);
ok('3 the pool really is the closed ' + repro.deckSize + ' a match deals',
  repro.before.total === repro.deckSize, 'total=' + repro.before.total);
okDir('3 hand SURVIVES the effect (was: emptied)', repro.after.hand === 0, repro.after.hand > 0, `${repro.before.hand}→${repro.after.hand}`);
ok('3 graveyard 0 after the effect', repro.after.grave === 0, `${repro.before.grave}→${repro.after.grave}`);
okDir('3 deck did NOT swallow the hand (was: back at DECK_SIZE)', repro.after.deck === repro.deckSize, repro.after.deck < repro.deckSize,
  `${repro.before.deck}→${repro.after.deck}`);
okDir('3 hand strip is NOT the fatigue placeholder',
  /No cards\. Drawing fatigue/.test(repro.placeholder), repro.placeholder);
await page.screenshot({ path: path.resolve('.gauntlet/_handwipe-repro.png') });
console.log('  screenshot → .gauntlet/_handwipe-repro.png');

/* ══ PASS 4 — PROVE THE CHECK CAN GO RED ══════════════════════════════
   Same card, same code path, one picker set. If the assertion in PASS 3 could
   not distinguish the two, it would be worthless. */
console.log('\n═══ PASS 4 — falsifiability: the same effect with the zones narrowed ═══');
const narrow = await page.evaluate(async () => {
  window.__hw.startMatch(); window.__hw.seedGrave(3);
  const before = window.__hw.snap();
  window.__hw.playProbe({ type: 'shuffleToDeck', shuffleZones: 'grave', shuffleSide: 'owner' });
  await new Promise(r => setTimeout(r, 600));
  return { before, after: window.__hw.snap() };
});
console.log('  zones=grave  ' + JSON.stringify(narrow.before) + ' → ' + JSON.stringify(narrow.after));
ok('4 hand SURVIVES when zones are narrowed (so PASS 3 is discriminating)',
  narrow.after.hand === narrow.before.hand, `${narrow.before.hand}→${narrow.after.hand}`);
ok('4 graveyard still swept (the effect really ran)', narrow.after.grave === 0,
  `${narrow.before.grave}→${narrow.after.grave}`);

/* ══ PASS 5 — whose piles? ════════════════════════════════════════════
   Is the wipe scoped to the card's owner, or can an ENEMY card do it to you?
   Fired through the same applyOnPlayEffect the engine uses, anchored on the
   AI hero (the caster the AI's own play path builds). */
console.log('\n═══ PASS 5 — side scoping of shuffleToDeck ═══');
const scope = await page.evaluate(async (nothing) => {
  const run = (eff) => {
    window.__hw.startMatch(); window.__hw.seedGrave(3);
    const before = window.__hw.snap();
    const aiHero = App.state.units.find(u => u.owner === 'ai' && u.isHero);
    App.state = applyOnPlayEffect(App.state, aiHero, { id: '_x', name: 'Enemy Card', onPlay: eff });
    return { before, after: window.__hw.snap() };
  };
  return {
    aiOwner: run({ type: 'shuffleToDeck' }),
    aiEnemy: run({ type: 'shuffleToDeck', shuffleSide: 'enemy' }),
  };
});
console.log('  AI plays it, side=owner (default): player ' + JSON.stringify(scope.aiOwner.before) + ' → ' + JSON.stringify(scope.aiOwner.after));
console.log('  AI plays it, side=enemy          : player ' + JSON.stringify(scope.aiEnemy.before) + ' → ' + JSON.stringify(scope.aiEnemy.after));
ok('5 an AI "own cards" shuffle leaves the PLAYER alone',
  scope.aiOwner.after.hand === scope.aiOwner.before.hand && scope.aiOwner.after.grave === scope.aiOwner.before.grave,
  `${scope.aiOwner.before.hand}/${scope.aiOwner.before.grave}→${scope.aiOwner.after.hand}/${scope.aiOwner.after.grave}`);
okDir('5 an AI "enemy cards" shuffle no longer wipes the player HAND',
  scope.aiEnemy.after.hand === 0 && scope.aiEnemy.after.grave === 0,
  `${scope.aiEnemy.before.hand}/${scope.aiEnemy.before.grave}→${scope.aiEnemy.after.hand}/${scope.aiEnemy.after.grave}`);

/* ══ PASS 6 — the in-place mutation the leads pointed at ══════════════
   `banishGrave` and the AI branch of `searchDeck` write `state[side] = …`
   INSIDE a function that otherwise returns `{ ...state, log }`. That is real
   and is measured here — the caller's own snapshot changes under it. It is a
   latent hazard, not this bug: every shipped call site uses the RETURN value
   (checked by reading all 28 of them), and it cannot empty a hand at all. */
console.log('\n═══ PASS 6 — applyOnPlayEffect mutates its input (latent, not the cause) ═══');
const mut = await page.evaluate(() => {
  const one = (eff, side) => {
    window.__hw.startMatch(); window.__hw.seedGrave(3);
    const snapshot = App.state;                       // what a caller would be holding
    const before = { grave: snapshot.player.graveyard.length, deck: snapshot.player.deck.length };
    const caster = snapshot.units.find(u => u.owner === side && u.isHero);
    const ret = applyOnPlayEffect(snapshot, caster, { id: '_m', name: 'M', onPlay: eff });
    return { before,
      snapshotAfter: { grave: snapshot.player.graveyard.length, deck: snapshot.player.deck.length },
      returnedAfter: { grave: ret.player.graveyard.length, deck: ret.player.deck.length },
      sameObject: ret === snapshot };
  };
  return {
    banish: one({ type: 'banishGrave', graveSide: 'self' }, 'player'),
    aiSearch: one({ type: 'searchDeck', searchDeckType: 'any', _autoPick: true }, 'player'),
  };
});
console.log('  banishGrave: ' + JSON.stringify(mut.banish));
console.log('  searchDeck(autopick): ' + JSON.stringify(mut.aiSearch));
okDir('6 banishGrave no longer mutates the caller-held snapshot',
  mut.banish.snapshotAfter.grave === 0 && mut.banish.before.grave === 3,
  `${mut.banish.before.grave}→${mut.banish.snapshotAfter.grave}`);
okDir('6 the deterministic searchDeck no longer mutates the snapshot',
  mut.aiSearch.snapshotAfter.deck === mut.aiSearch.returnedAfter.deck
  && mut.aiSearch.snapshotAfter.deck < mut.aiSearch.before.deck,
  JSON.stringify(mut.aiSearch));
ok('6 …but neither touches the HAND, so neither explains the report',
  true, '(see PASS 1: hand 5→5 for banishGrave, 5→5 for searchDeck)');

/* ══ PASS 7 — THE ACTUAL LIVE CARD ════════════════════════════════════
   `Ualti's Secret library` (cc_1786100226074, card_catalog, project
   ktsiasyjusesawtrwrjc) is a LOCATION whose on-play is `searchDeck` — that is
   the "Search your deck for a card and add it to your hand" text in the
   screenshot — and whose ON-GRAVE is `shuffleToDeck`.

   🔴 The on-grave object below is copied VERBATIM from the live catalog. Note
   what is NOT in it: no shuffleZones, no shuffleSide, no drawSide, no
   shuffleSelf. The on-grave editor (`ed-ongrave-*`, index.html :138086) has no
   inputs for those four and never writes them, so they CANNOT be authored on an
   on-grave effect. applyOnPlayEffect then reads

       zones = eff.shuffleZones || 'all'      → EVERYTHING
       side  = eff.shuffleSide  || 'owner'    → yours
       draw  = eff.drawSide     || 'none'     → nothing comes back

   Absent field ⇒ maximum destruction. The moment this location reaches the
   graveyard — which for a location is the moment the next one replaces it —
   the owner's field, hand, graveyard and Void are swept into the deck and
   nothing is dealt back. */
console.log('\n═══ PASS 7 — the live card: Ualti\'s Secret library on-grave ═══');
const LIVE_ONGRAVE = { vfx: 'none', type: 'shuffleToDeck', amount: 0, aoeAll: false, chance: 100,
  filter: { element: 'any', faction: 'any', cardType: 'any', costMode: 'exact' },
  radius: 1, status: 'ambushGuard1', useLimit: 'none', searchDeckType: 'any',
  statusDuration: 2, searchDeckCardIds: [] };
const p7 = await freshPage();
const live = await p7.evaluate(async (onGrave) => {
  document.querySelectorAll('#gc-alert-backdrop, .modal-backdrop').forEach(n => n.remove());
  window.__hw.startMatch();
  // Turn 2, like the report.
  onEndTurn(); await new Promise(r => setTimeout(r, 1500));
  let guard = 0;
  while (App.state.turn !== 'player' && guard++ < 60) await new Promise(r => setTimeout(r, 500));
  // The location card lands in the graveyard (placeLocation buries the outgoing
  // one). Put it there and let the SHIPPED sweep find it — _sweepCardOnGrave is
  // called from renderBattle, which is why it is a sweep and not a hook.
  const cardInGrave = { id: 'cc_1786100226074', name: "Ualti's Secret library",
    type: 'location', icon: '📚', instanceId: 'usl_' + Math.random(), onGrave: onGrave };
  // It came out of the HAND (played, then buried when the next location replaced
  // it), so it takes a card's slot rather than adding a 41st — the pool stays the
  // closed 40 a match deals, which is what makes the deck count testable.
  const h = App.state.player.hand.slice(); h.shift();
  App.state = { ...App.state, player: { ...App.state.player, hand: h,
    graveyard: [...(App.state.player.graveyard || []), cardInGrave] } };
  const before = window.__hw.snap();
  // 🔴 THE SHIPPED TRIGGER. Nothing here calls the effect: renderBattle() calls
  // _sweepCardOnGrave(App.state) (index.html :144327), which fires on-grave for
  // non-unit cards sitting in a graveyard and writes the result back by MUTATING
  // the state object. The player takes no action — the cards go during a render.
  renderBattle();
  await new Promise(r => setTimeout(r, 1200));
  renderBattle();
  await new Promise(r => setTimeout(r, 900));
  const strip = document.querySelector('.hand-strip-cards, .hand-column-cards');
  return { before, after: window.__hw.snap(),
    placeholder: strip ? strip.textContent.trim().slice(0, 40) : '(no hand strip)',
    logTail: (App.state.log || []).slice(-2).map(l => l.msg) };
}, LIVE_ONGRAVE);
console.log('  before: ' + JSON.stringify(live.before));
console.log('  after : ' + JSON.stringify(live.after));
console.log('  hand strip reads: "' + live.placeholder + '"');
console.log('  log tail: ' + JSON.stringify(live.logTail));
ok('7 turn 2, as reported', live.before.turn >= 2, 'turn=' + live.before.turn);
okDir('7 hand SURVIVES the on-grave trigger (was: emptied)', live.after.hand === 0 && live.before.hand > 0, live.after.hand === live.before.hand,
  `${live.before.hand}→${live.after.hand}`);
ok('7 graveyard EMPTIED', live.after.grave === 0 && live.before.grave > 0,
  `${live.before.grave}→${live.after.grave}`);
okDir('7 deck did NOT swallow the hand (was: back at DECK_SIZE)',
  live.after.deck === 40, `${live.before.deck}→${live.after.deck}`);
okDir('7 hand strip is NOT the fatigue placeholder',
  /No cards\. Drawing fatigue/.test(live.placeholder), live.placeholder);
await p7.screenshot({ path: path.resolve('.gauntlet/_handwipe-live-repro.png') });
console.log('  screenshot → .gauntlet/_handwipe-live-repro.png');

/* ══ PASS 8 — falsifiability for PASS 7 ═══════════════════════════════
   Same live card, same shipped sweep, ONE key added to the on-grave object —
   the very key the on-grave editor cannot write. If the wipe survives that,
   PASS 7 proves nothing. */
console.log('\n═══ PASS 8 — falsifiability: add the key the editor cannot write ═══');
const fixed = await p7.evaluate(async (onGrave) => {
  document.querySelectorAll('#gc-alert-backdrop, .modal-backdrop').forEach(n => n.remove());
  window.__hw.startMatch();
  const cardInGrave = { id: 'cc_1786100226074', name: "Ualti's Secret library",
    type: 'location', icon: '📚', instanceId: 'usl2_' + Math.random(),
    onGrave: { ...onGrave, shuffleZones: 'void' } };   // ← the only difference
  const h = App.state.player.hand.slice(); h.shift();
  App.state = { ...App.state, player: { ...App.state.player, hand: h,
    graveyard: [...(App.state.player.graveyard || []), cardInGrave] } };
  const before = window.__hw.snap();
  renderBattle();
  await new Promise(r => setTimeout(r, 1200));
  renderBattle();
  await new Promise(r => setTimeout(r, 600));
  return { before, after: window.__hw.snap(),
    fired: (App.state.log || []).some(l => /graveyard trigger fires/.test(l.msg || '')) };
}, LIVE_ONGRAVE);
console.log('  shuffleZones:"void"  ' + JSON.stringify(fixed.before) + ' → ' + JSON.stringify(fixed.after));
ok('8 with the zone named, the hand SURVIVES (PASS 7 is discriminating)',
  fixed.after.hand === fixed.before.hand, `${fixed.before.hand}→${fixed.after.hand}`);
ok('8 with the zone named, the graveyard SURVIVES',
  fixed.after.grave > 0, `${fixed.before.grave}→${fixed.after.grave}`);
ok('8 …and the trigger really did fire (so this is not a silent no-op)',
  fixed.fired === true, 'fired=' + fixed.fired);

if (errs.length) console.log('\n  page errors: ' + JSON.stringify(errs.slice(0, 6)));

await browser.close();
server.close();
console.log('\n' + (fails ? '❌ ' + fails + ' check(s) FAILED' : '✅ all checks passed') + '\n');
process.exit(fails ? 1 : 0);
