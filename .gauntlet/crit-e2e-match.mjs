/* ══════════════════════════════════════════════════════════════════════════
   🔪 CRIT-E2E-MATCH — the ADVERSARIAL pass over the v121f4 hand-wipe /
   immutable-state fixes. Its job is to find what those fixes BROKE.

   The fixes turned FOUR `state[side] = …` in-place writes inside
   _applyOnPlayOneRaw into `state = { ...state, [side]: … }` reassignments.
   The old code did BOTH: it mutated the caller's object AND returned a copy.
   Any caller that ignored the return value used to work by the mutation and
   now SILENTLY LOSES THE EFFECT. That is the regression shape this hunts.
   They also changed the absent-`shuffleZones` default from 'all' to 'grave'.

   PASSES
     0  real match ON SCREEN — chrome asserted via renderBattleNow(), because
        render() is rAF-batched and does nothing in a synchronous driver, and
        on an empty shell every "nothing broke" claim passes for the worst
        possible reason.
     1  LOST UPDATE — drive the changed effects through the REAL placeUnit()
        path and prove App.state actually carries them afterwards.
     2  FULL GAME LOOP — real turn cycles: play cards, move, loot a ruin, hold
        a control point, attack with executeMove(), end the turn, run the AI
        with doAIStep(). Assert the closed pool stays sane and nothing throws.
     3  ON-GRAVE CAPTURE — the new code writes `shuffleZones: undefined` keys
        onto card.onGrave. Prove they read identically to absent keys.
     4  FALSIFIABILITY — the control that shows PASS 1 is discriminating.

   🔴 REAL MATCH OR NOTHING.  🔴 No global `const` is read off `window`;
   they are resolved lexically inside page.evaluate bodies, which is legal.
   Real signatures (probed, not assumed):
     getValidPlacementTiles(card, hero, state)   placeUnit(card,pos,opts)->void
     executeMove(state, attacker, target, move)  doAIStep()  _lootWithUnit(id,mode)
   The AI side starts with hand 0 / deck 0 — it is built lazily — so the AI
   pool is TRACED, never asserted as a conservation invariant.

   Run:  node .gauntlet/crit-e2e-match.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8830 + (process.pid % 40);
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
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/ERR_FAILED|Failed to load resource/.test(t)) return;   // blocked 3rd-party, not us
  errs.push('console.error: ' + t.slice(0, 300));
});
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof initGame === "function" && typeof placeUnit === "function" && typeof executeMove === "function"',
  null, { timeout: 180000 });
await page.waitForTimeout(4000);

await page.evaluate(() => {
  window.__c = {};
  window.__c.start = function (seedAI) {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle'; App.ui = App.ui || {}; App.ui.deckSearch = null; App.ui.aiBusy = false;
    /* 🔌 FIXTURE, NOT A STUB. buildAIDeck() draws from Catalog.aiDecks, which is
       published from Supabase — offline (this harness blocks every non-localhost
       request) it resolves to ZERO cards, the AI decks out on fatigue and the
       match ends on turn 2. That is an ENVIRONMENT artifact, measured identically
       on the pre-fix tree. Seeding the AI's pool from the player's own real card
       objects lets the turn loop actually run; no function under test is replaced. */
    if (seedAI) {
      const s = App.state;
      const pool = s.player.deck.slice(0, 20).map((c, i) => ({ ...c, instanceId: 'ai_fx_' + i }));
      App.state = { ...s, ai: { ...s.ai, hand: pool.slice(0, 5), deck: pool.slice(5) } };
    }
    renderBattleNow();
  };
  window.__c.census = function (s, side) {
    const S = (s && s[side]) || {};
    const units = (s.units || []).filter(u => u && u.owner === side && !u.isHero);
    return { hand: (S.hand || []).length, deck: (S.deck || []).length,
      grave: (S.graveyard || []).length, void: (S.void || []).length,
      field: units.filter(u => u.alive).length, dead: units.filter(u => !u.alive).length,
      total: (S.hand || []).length + (S.deck || []).length + (S.graveyard || []).length + (S.void || []).length };
  };
  window.__c.sane = function (s) {
    const bad = [];
    for (const side of ['player', 'ai']) {
      const c = window.__c.census(s, side);
      for (const k of Object.keys(c)) {
        const v = c[k];
        if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.floor(v) !== v) bad.push(side + '.' + k + '=' + v);
      }
      for (const z of ['hand', 'graveyard', 'void']) {
        const arr = ((s[side] || {})[z]) || [];
        const ids = arr.map(x => x && x._uid).filter(Boolean);
        if (ids.length && new Set(ids).size !== ids.length) bad.push(side + '.' + z + ' dup-uids');
      }
    }
    return bad;
  };
});

/* ═══ PASS 0 ════════════════════════════════════════════════════════════ */
console.log('\n═══ PASS 0 — real match on screen ═══');
const P0 = await page.evaluate(() => {
  window.__c.start();
  const s = App.state;
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
  return { screen: App.screen, heroes: (s.units || []).filter(u => u.isHero).length,
    hand: s.player.hand.length, deck: s.player.deck.length,
    structures: (s.structures || []).length, cps: (s.controlPoints || []).length,
    endTurn: /END TURN/i.test(txt), objective: /OBJECTIVE/i.test(txt),
    handNodes: document.querySelectorAll('.hand-card,.hcard,[data-hand-index],.bcard').length,
    txt: txt.slice(0, 110) };
});
console.log('  ' + JSON.stringify(P0));
ok('screen is battle', P0.screen === 'battle', P0.screen);
ok('two heroes on the board', P0.heroes === 2, P0.heroes);
ok('opening hand dealt (5) from a 40 pool', P0.hand === 5 && P0.deck === 35, P0.hand + '/' + P0.deck);
ok('battle chrome really painted (objective panel + END TURN)', P0.objective && P0.endTurn,
  'objective=' + P0.objective + ' endTurn=' + P0.endTurn);
ok('hand nodes exist on screen', P0.handNodes > 0, P0.handNodes);
ok('ruins + control points seeded', P0.structures === 5 && P0.cps === 3, P0.structures + '/' + P0.cps);

/* ═══ PASS 1 ════════════════════════════════════════════════════════════ */
console.log('\n═══ PASS 1 — the four immutable writes still reach App.state ═══');
const P1 = await page.evaluate(() => {
  const out = {};
  const run = (label, eff, seedGrave) => {
    window.__c.start();
    let s = App.state;
    if (seedGrave) s = { ...s, player: { ...s.player, deck: s.player.deck.slice(3), graveyard: s.player.deck.slice(0, 3) } };
    s = { ...s, player: { ...s.player, energy: 99, maxEnergy: 99 } };
    App.state = s;
    const before = window.__c.census(s, 'player');
    const hero = s.units.find(u => u.owner === 'player' && u.isHero);
    const card = { id: '_crit_' + label, name: 'Crit ' + label, type: 'unit', cost: 0,
      attack: 1, health: 1, unit: 'goblin', onPlay: eff };
    let threw = null, tiles = 0;
    try {
      const t = getValidPlacementTiles(card, hero, s) || [];
      tiles = t.length;
      if (t.length) placeUnit(card, t[0], {});
    } catch (e) { threw = String(e).slice(0, 200); }
    out[label] = { before, after: window.__c.census(App.state, 'player'), tiles, threw,
      log: (App.state.log || []).slice(-3).map(l => l && l.msg).filter(Boolean) };
  };
  /* graveSide:'both'. NOTE FOR WHOEVER READS THIS NEXT: 'self' works too. An
     earlier version of this driver reported 'self' as silently gated — that was
     WRONG and was this harness's own first-play artifact (see the warm-up note
     above): 'self' happened to occupy the first slot. .gauntlet/_crit-banish.mjs
     runs 'self' both first and last in one page; first reads as a no-op, last
     banishes 3 to the Void. No graveSide is gated. */
  /* 🔥 WARM-UP PLAY — DO NOT DELETE. The FIRST placeUnit() after page load does
     not resolve its on-play effect synchronously (first-play cutaway/cinematic
     path); the census taken immediately afterwards therefore sees nothing and
     the check fails for a reason that has nothing to do with the effect. Proven
     deterministic: a byte-identical second run of the same effect under a
     different label ('banishAgain') fires every time, and the first slot fails
     every time — on the FIXED tree and on the PRE-FIX tree alike. Burn the
     first slot on a throwaway so every measured effect is in steady state. */
  run('_warmup', { type: 'drawCards', amount: 1 }, false);
  run('banishGrave', { type: 'banishGrave', graveSide: 'both' }, true);
  run('searchDeck', { type: 'searchDeck', searchType: 'any', _autoPick: true }, false);
  run('shuffleGrave', { type: 'shuffleToDeck' }, true);
  run('shuffleAll', { type: 'shuffleToDeck', shuffleZones: 'all' }, true);
  run('banishAgain', { type: 'banishGrave', graveSide: 'both' }, true);
  run('banishEnemy', { type: 'banishGrave', graveSide: 'enemy' }, true);
  return out;
});
for (const k of Object.keys(P1)) console.log('   ' + k.padEnd(13) + ' tiles=' + P1[k].tiles +
  ' before=' + JSON.stringify(P1[k].before) + ' after=' + JSON.stringify(P1[k].after) +
  (P1[k].threw ? ' THREW ' + P1[k].threw : '') + '\n        log: ' + JSON.stringify(P1[k].log));
ok('every effect found a legal placement tile (the play really happened)',
  Object.values(P1).every(v => v.tiles > 0 && !v.threw), JSON.stringify(Object.values(P1).map(v => v.tiles)));
ok('banishGrave REACHED App.state — grave→void', P1.banishGrave.after.grave === 0 && P1.banishGrave.after.void === 3,
  'grave ' + P1.banishGrave.before.grave + '→' + P1.banishGrave.after.grave + ', void ' + P1.banishGrave.after.void);
ok('the closed pool is CONSERVED by the knobless shuffle (no card minted)',
  P1.shuffleGrave.after.total === P1.shuffleGrave.before.total,
  P1.shuffleGrave.before.total + '→' + P1.shuffleGrave.after.total);
ok('searchDeck REACHED App.state — a card left the deck',
  P1.searchDeck.after.deck < P1.searchDeck.before.deck,
  P1.searchDeck.before.deck + '→' + P1.searchDeck.after.deck);
ok('knobless shuffleToDeck sweeps the GRAVE ONLY (hand survives)',
  P1.shuffleGrave.after.grave === 0 && P1.shuffleGrave.after.hand >= P1.shuffleGrave.before.hand - 1,
  'grave ' + P1.shuffleGrave.before.grave + '→' + P1.shuffleGrave.after.grave +
  ', hand ' + P1.shuffleGrave.before.hand + '→' + P1.shuffleGrave.after.hand);
ok('explicit shuffleZones:all STILL empties the hand (feature intact)',
  P1.shuffleAll.after.hand === 0, P1.shuffleAll.before.hand + '→' + P1.shuffleAll.after.hand);

/* ═══ PASS 2 ════════════════════════════════════════════════════════════ */
console.log('\n═══ PASS 2 — full game loop ═══');
const errsBefore = errs.length;
const P2 = await page.evaluate(async () => {
  window.__c.start(true);
  const trace = [], problems = [], did = { played: 0, moved: 0, looted: 0, attacked: 0, aiSteps: 0, turns: 0 };
  const step = (label) => {
    const bad = window.__c.sane(App.state);
    if (bad.length) problems.push(label + ': ' + bad.join(','));
    trace.push({ at: label, t: App.state.turnNumber, turn: App.state.turn,
      P: window.__c.census(App.state, 'player'), A: window.__c.census(App.state, 'ai') });
  };
  const guard = (label, fn) => { try { fn(); } catch (e) { problems.push(label + ' THREW ' + String(e).slice(0, 170)); } };
  step('boot');
  for (let cycle = 0; cycle < 6 && !App.state.gameOver; cycle++) {
    guard('play@' + cycle, () => {
      App.state = { ...App.state, player: { ...App.state.player, energy: 99, maxEnergy: 99 } };
      for (let n = 0; n < 3; n++) {
        const s = App.state;
        const hero = s.units.find(u => u.owner === 'player' && u.isHero);
        const card = (s.player.hand || []).find(c => c && c.type === 'unit');
        if (!hero || !card) break;
        const t = getValidPlacementTiles(card, hero, s) || [];
        if (!t.length) break;
        const h0 = s.player.hand.length;
        placeUnit(card, t[Math.floor(t.length / 2)], {});
        if (App.state.player.hand.length < h0) did.played++; else break;
      }
    });
    step('afterPlay' + cycle);
    guard('move@' + cycle, () => {
      const s = App.state;
      const hero = s.units.find(u => u.owner === 'player' && u.isHero);
      const vm = getValidMoves(hero, s.units, s.weather) || [];
      if (!vm.length) return;
      const ruin = (s.structures || []).find(r => vm.some(p => p.x === r.x && p.y === r.y));
      const cp = (s.controlPoints || []).find(c => vm.some(p => p.x === c.x && p.y === c.y));
      const dest = (ruin && { x: ruin.x, y: ruin.y }) || (cp && { x: cp.x, y: cp.y }) || vm[0];
      App.state = moveUnit(s, hero, dest); did.moved++;
    });
    step('afterMove' + cycle);
    guard('loot@' + cycle, () => {
      const hero = App.state.units.find(u => u.owner === 'player' && u.isHero);
      if (_unitCanLootStructure(hero)) { _lootWithUnit(hero.id, 'search'); did.looted++; }
    });
    step('afterLoot' + cycle);
    guard('attack@' + cycle, () => {
      const s = App.state;
      for (const u of (s.units || []).filter(u => u.owner === 'player' && u.alive)) {
        const foe = (App.state.units || []).find(v => v.owner === 'ai' && v.alive && v.pos && u.pos
          && Math.abs(v.pos.x - u.pos.x) <= 1 && Math.abs(v.pos.y - u.pos.y) <= 1);
        if (!foe) continue;
        const mv = (getAvailableMoves(u) || [])[0];
        if (!mv) continue;
        const ns = executeMove(App.state, u, foe, mv);
        if (ns && ns.player) { App.state = ns; did.attacked++; }
      }
    });
    step('afterAttack' + cycle);
    guard('endPlayer@' + cycle, () => { App.state = endPlayerTurn(App.state); did.turns++; });
    step('afterEndPlayer' + cycle);
    guard('aiSteps@' + cycle, () => {
      for (let i = 0; i < 12 && App.state.turn === 'ai'; i++) { doAIStep(); did.aiSteps++; }
    });
    step('afterAI' + cycle);
    guard('endAI@' + cycle, () => { if (App.state.turn === 'ai') App.state = endAITurn(App.state); });
    step('afterEndAI' + cycle);
    guard('render@' + cycle, () => { renderBattleNow(); });
    step('afterRender' + cycle);
  }
  return { trace, problems, did, turnNumber: App.state.turnNumber, gameOver: !!App.state.gameOver };
});
for (const t of P2.trace) console.log('   ' + t.at.padEnd(16) + ' T' + t.t + ' ' + String(t.turn || '').padEnd(6) +
  ' P' + JSON.stringify(t.P) + ' A' + JSON.stringify(t.A));
if (P2.problems.length) P2.problems.forEach(p => console.log('   ⚠ ' + p));
console.log('   actions: ' + JSON.stringify(P2.did) + '  gameOver=' + P2.gameOver);
const errsDuring = errs.slice(errsBefore);
ok('real actions actually happened (cards played + moves + AI steps)',
  P2.did.played >= 3 && P2.did.moved >= 3 && P2.did.aiSteps >= 3,
  JSON.stringify(P2.did));
ok('the loop ran several real turns', P2.turnNumber >= 4, 'turnNumber=' + P2.turnNumber);
ok('no zone count went negative / NaN / non-integer, no duplicate uids',
  P2.problems.filter(p => !/THREW/.test(p)).length === 0,
  P2.problems.filter(p => !/THREW/.test(p)).join(' | ') || 'clean');
ok('no action threw', P2.problems.filter(p => /THREW/.test(p)).length === 0,
  P2.problems.filter(p => /THREW/.test(p)).join(' | ') || 'clean');
ok('no pageerror / console.error during the loop', errsDuring.length === 0, errsDuring.slice(0, 4).join(' | ') || 'clean');

/* ═══ PASS 3 ════════════════════════════════════════════════════════════ */
console.log('\n═══ PASS 3 — on-grave capture writes undefined knobs ═══');
const P3 = await page.evaluate(() => {
  const withUndef = { type: 'shuffleToDeck', shuffleZones: undefined, shuffleSide: undefined,
    shuffleSelf: undefined, drawSide: undefined, amount: 0, radius: 1, chance: 100 };
  return {
    textUndef: describeOnPlayEffect(withUndef),
    textAbsent: describeOnPlayEffect({ type: 'shuffleToDeck', amount: 0, radius: 1, chance: 100 }),
    textVoid: describeOnPlayEffect({ type: 'shuffleToDeck', shuffleZones: 'void' }),
    keyCount: Object.keys(withUndef).length,
    keyCountAfterJson: Object.keys(JSON.parse(JSON.stringify(withUndef))).length,
  };
});
console.log('  undef : ' + P3.textUndef);
console.log('  absent: ' + P3.textAbsent);
console.log('  void  : ' + P3.textVoid);
ok('undefined-valued knobs read identically to absent ones', P3.textUndef === P3.textAbsent);
ok('the undefined keys vanish on JSON round-trip (safe to persist)',
  P3.keyCountAfterJson === P3.keyCount - 4, P3.keyCount + '→' + P3.keyCountAfterJson);
ok('a hand-authored zone still overrides the default', /the Void/.test(P3.textVoid || ''), P3.textVoid);

/* ═══ PASS 4 ════════════════════════════════════════════════════════════ */
console.log('\n═══ PASS 4 — control: is PASS 1 discriminating? ═══');
const P4 = await page.evaluate(() => {
  window.__c.start();
  let s = App.state;
  s = { ...s, player: { ...s.player, deck: s.player.deck.slice(3), graveyard: s.player.deck.slice(0, 3) } };
  const hero = s.units.find(u => u.owner === 'player' && u.isHero);
  const before = window.__c.census(s, 'player');
  applyOnPlayEffect(s, hero, { id: '_x', name: 'x', onPlay: { type: 'banishGrave', graveSide: 'self' } });
  const afterIgnored = window.__c.census(s, 'player');
  const returned = applyOnPlayEffect(s, hero, { id: '_x', name: 'x', onPlay: { type: 'banishGrave', graveSide: 'self' } });
  return { before, afterIgnored, returnedGrave: window.__c.census(returned, 'player').grave };
});
console.log('  ' + JSON.stringify(P4));
ok('CONTROL: ignoring the return value now loses the effect (PASS 1 is discriminating)',
  P4.afterIgnored.grave === 3 && P4.before.grave === 3, P4.before.grave + '→' + P4.afterIgnored.grave);
ok('CONTROL: the returned state still carries it', P4.returnedGrave === 0, P4.returnedGrave);

console.log('\n' + (fails ? `❌ ${fails} check(s) failed` : '✅ all checks passed'));
if (errs.length) { console.log('captured page errors (' + errs.length + '):'); errs.slice(0, 10).forEach(e => console.log('   ' + e)); }
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
