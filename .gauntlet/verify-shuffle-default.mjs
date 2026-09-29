/* ══════════════════════════════════════════════════════════════════════════
   ✅ VERIFY-SHUFFLE-DEFAULT — the FIX side of drive-hand-wipe.mjs.

   drive-hand-wipe.mjs reproduced the report: an on-grave `shuffleToDeck` with
   no `shuffleZones` (the on-grave editor slot has no input for it) read as
   zones='all' and swept the owner's field + hand + graveyard + Void into the
   deck. This driver asserts the OPPOSITE, on the same live card, through the
   same shipped `renderBattle() -> _sweepCardOnGrave` path:

     A  the hand SURVIVES, the graveyard is what gets swept, and the trigger
        still fires (so the green is not a silent no-op)
     B  an EXPLICIT shuffleZones:'all' still wipes everything — the destructive
        reading was made unauthorable-by-accident, not deleted
     C  banishGrave / the deterministic searchDeck no longer write through to
        the caller's own snapshot (PASS 6 of the repro driver, inverted)
     D  the card text agrees with the engine for a knobless effect

   🔴 HOW TO SEE THIS GO RED (it does — measured):
     public/index.html, in applyOnPlayEffect's shuffleToDeck branch, change
        const zones = eff.shuffleZones || 'grave';
     back to `|| 'all'` and re-run: A fails and B still passes.
     Change `state = { ...state, [t]: … }` in banishGrave back to
     `state[t] = …` and C fails.

   🔴 REAL MATCH OR NOTHING — same rule as the repro driver. PASS 0 proves the
   chrome is on screen before any "the cards are still there" claim is made,
   because on the empty shell those claims pass for the worst possible reason.

   Run:  node .gauntlet/verify-shuffle-default.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8760 + (process.pid % 40);
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

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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

await page.evaluate(() => {
  window.__hw = {};
  window.__hw.startMatch = function () {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle'; App.ui = App.ui || {}; App.ui.deckSearch = null;
    render();
  };
  window.__hw.snap = function () {
    const p = (App.state && App.state.player) || {};
    return { hand: (p.hand || []).length, deck: (p.deck || []).length,
      grave: (p.graveyard || []).length, void: (p.void || []).length,
      total: (p.hand || []).length + (p.deck || []).length + (p.graveyard || []).length + (p.void || []).length,
      turn: App.state && App.state.turnNumber };
  };
  window.__hw.deckSize = function () { try { return DECK_SIZE; } catch (e) { return null; } };
});

/* ══ PASS 0 — the match is REAL (the empty-shell guard) ════════════════ */
await page.evaluate(() => window.__hw.startMatch());
await page.waitForTimeout(2500);
const real = await page.evaluate(() => ({
  screen: App.screen, units: (App.state.units || []).length,
  hand: App.state.player.hand.length, deck: App.state.player.deck.length,
  deckSize: window.__hw.deckSize(),
  endTurnText: [...document.querySelectorAll('button')].some(b => /end turn/i.test(b.textContent || '')),
  handCards: document.querySelectorAll('.hand-strip-cards *, .hand-column-cards *').length,
}));
console.log('\n═══ PASS 0 — is this a real match? ═══');
console.log('  ' + JSON.stringify(real));
ok('0 screen is battle', real.screen === 'battle');
ok('0 two heroes on the board', real.units >= 2, 'units=' + real.units);
ok('0 opening hand dealt', real.hand === 5, 'hand=' + real.hand);
ok('0 deck is DECK_SIZE − opening hand', real.deck === real.deckSize - 5, `deck=${real.deck}`);
ok('0 END TURN chrome rendered (not the empty shell)', real.endTurnText === true);
ok('0 hand strip has card nodes', real.handCards > 0, 'nodes=' + real.handCards);

/* ══ A — THE LIVE CARD, THE SHIPPED SWEEP, THE FIXED DEFAULT ══════════
   onGrave copied VERBATIM from card_catalog cc_1786100226074 ("Ualti's Secret
   library"). Note what is NOT in it: no shuffleZones / shuffleSide / drawSide /
   shuffleSelf — the on-grave editor cannot write them. This is the exact object
   that produced hand 5→0 / grave 1→0 / deck 34→40 in PASS 7 of the repro. */
const LIVE_ONGRAVE = { vfx: 'none', type: 'shuffleToDeck', amount: 0, aoeAll: false, chance: 100,
  filter: { element: 'any', faction: 'any', cardType: 'any', costMode: 'exact' },
  radius: 1, status: 'ambushGuard1', useLimit: 'none', searchDeckType: 'any',
  statusDuration: 2, searchDeckCardIds: [] };

const liveRun = (onGrave, tag) => page.evaluate(async ([og, t]) => {
  document.querySelectorAll('#gc-alert-backdrop, .modal-backdrop').forEach(n => n.remove());
  window.__hw.startMatch();
  const cardInGrave = { id: 'cc_1786100226074', name: "Ualti's Secret library",
    type: 'location', icon: '📚', instanceId: t + '_' + Math.random(), onGrave: og };
  const h = App.state.player.hand.slice(); h.shift();
  App.state = { ...App.state, player: { ...App.state.player, hand: h,
    graveyard: [...(App.state.player.graveyard || []), cardInGrave] } };
  const before = window.__hw.snap();
  renderBattle();                       // ← the shipped trigger, nothing else
  await new Promise(r => setTimeout(r, 1200));
  renderBattle();
  await new Promise(r => setTimeout(r, 900));
  const strip = document.querySelector('.hand-strip-cards, .hand-column-cards');
  return { before, after: window.__hw.snap(),
    placeholder: strip ? strip.textContent.trim().slice(0, 40) : '(no hand strip)',
    fired: (App.state.log || []).some(l => /graveyard trigger fires/.test(l.msg || '')),
    logTail: (App.state.log || []).slice(-2).map(l => l.msg) };
}, [onGrave, tag]);

console.log("\n═══ A — Ualti's Secret library on-grave, NO shuffle knobs ═══");
const a = await liveRun(LIVE_ONGRAVE, 'A');
console.log('  before: ' + JSON.stringify(a.before));
console.log('  after : ' + JSON.stringify(a.after));
console.log('  hand strip reads: "' + a.placeholder + '"');
console.log('  log tail: ' + JSON.stringify(a.logTail));
ok('A the trigger DID fire (this green is not a no-op)', a.fired === true, 'fired=' + a.fired);
ok('A the HAND SURVIVES the sweep', a.after.hand === a.before.hand && a.before.hand > 0,
  `${a.before.hand}→${a.after.hand}`);
ok('A the hand strip is NOT the reported placeholder',
  !/No cards\. Drawing fatigue/.test(a.placeholder), a.placeholder);
ok('A the graveyard IS swept (the effect really ran)', a.after.grave === 0 && a.before.grave > 0,
  `${a.before.grave}→${a.after.grave}`);
ok('A the deck grew by exactly the graveyard, not by the hand too',
  a.after.deck === a.before.deck + a.before.grave, `${a.before.deck}→${a.after.deck} (+${a.before.grave})`);
ok('A no card left the closed pool', a.after.total === a.before.total,
  `${a.before.total}→${a.after.total}`);

/* ══ B — THE DESTRUCTIVE READING IS STILL AUTHORABLE ══════════════════
   The fix narrowed the ABSENT-key default. An author who explicitly picks
   ♾ EVERYTHING in the On-Play editor must still get the board wipe, or the fix
   deleted a feature instead of disarming a footgun. */
console.log("\n═══ B — explicit shuffleZones:'all' still sweeps everything ═══");
const b = await liveRun({ ...LIVE_ONGRAVE, shuffleZones: 'all' }, 'B');
console.log('  before: ' + JSON.stringify(b.before) + ' → after: ' + JSON.stringify(b.after));
ok('B explicit all: hand EMPTIED (feature intact)', b.after.hand === 0 && b.before.hand > 0,
  `${b.before.hand}→${b.after.hand}`);
ok('B explicit all: graveyard EMPTIED', b.after.grave === 0, `${b.before.grave}→${b.after.grave}`);

/* ══ C — applyOnPlayEffect no longer mutates its input ════════════════ */
console.log('\n═══ C — the caller-held snapshot is left alone ═══');
const mut = await page.evaluate(() => {
  const one = (eff) => {
    window.__hw.startMatch();
    App.state = { ...App.state, player: { ...App.state.player, graveyard:
      [0, 1, 2].map(i => ({ id: 'seed' + i, name: 'Seed ' + i, type: 'unit', instanceId: 'sg_' + i })) } };
    const snapshot = App.state;                     // what a caller would be holding
    const before = { grave: snapshot.player.graveyard.length, deck: snapshot.player.deck.length };
    const caster = snapshot.units.find(u => u.owner === 'player' && u.isHero);
    const ret = applyOnPlayEffect(snapshot, caster, { id: '_m', name: 'M', onPlay: eff });
    return { before,
      snapshotAfter: { grave: snapshot.player.graveyard.length, deck: snapshot.player.deck.length },
      returnedAfter: { grave: ret.player.graveyard.length, deck: ret.player.deck.length } };
  };
  return {
    banish: one({ type: 'banishGrave', graveSide: 'self' }),
    aiSearch: one({ type: 'searchDeck', searchDeckType: 'any', _autoPick: true }),
    shuffle: one({ type: 'shuffleToDeck', shuffleZones: 'grave' }),
  };
});
for (const k of ['banish', 'aiSearch', 'shuffle']) console.log('  ' + k + ': ' + JSON.stringify(mut[k]));
ok('C banishGrave leaves the snapshot alone', mut.banish.snapshotAfter.grave === mut.banish.before.grave,
  `${mut.banish.before.grave}→${mut.banish.snapshotAfter.grave}`);
ok('C banishGrave still WORKS on the returned state', mut.banish.returnedAfter.grave === 0,
  'returned grave=' + mut.banish.returnedAfter.grave);
ok('C searchDeck(autopick) leaves the snapshot alone',
  mut.aiSearch.snapshotAfter.deck === mut.aiSearch.before.deck,
  `${mut.aiSearch.before.deck}→${mut.aiSearch.snapshotAfter.deck}`);
ok('C searchDeck still WORKS on the returned state',
  mut.aiSearch.returnedAfter.deck === mut.aiSearch.before.deck - 1,
  'returned deck=' + mut.aiSearch.returnedAfter.deck);
ok('C shuffleToDeck leaves the snapshot alone',
  mut.shuffle.snapshotAfter.grave === mut.shuffle.before.grave,
  `${mut.shuffle.before.grave}→${mut.shuffle.snapshotAfter.grave}`);
ok('C shuffleToDeck still WORKS on the returned state', mut.shuffle.returnedAfter.grave === 0,
  'returned grave=' + mut.shuffle.returnedAfter.grave);

/* ══ D — the card text agrees with the engine ═════════════════════════ */
console.log('\n═══ D — describeOnPlayEffect for a knobless shuffleToDeck ═══');
const desc = await page.evaluate(() => ({
  bare: describeOnPlayEffect({ type: 'shuffleToDeck' }),
  all: describeOnPlayEffect({ type: 'shuffleToDeck', shuffleZones: 'all' }),
}));
console.log('  bare: ' + desc.bare);
console.log('  all : ' + desc.all);
ok('D knobless text says graveyards, not EVERYTHING', /graveyard/i.test(desc.bare) && !/EVERYTHING/.test(desc.bare));
ok('D explicit all still says EVERYTHING', /EVERYTHING/.test(desc.all));

if (errs.length) console.log('\n  page errors: ' + JSON.stringify(errs.slice(0, 6)));
await browser.close();
server.close();
console.log('\n' + (fails ? '❌ ' + fails + ' check(s) FAILED' : '✅ all checks passed') + '\n');
process.exit(fails ? 1 : 0);
