/* ══════════════════════════════════════════════════════════════════════════
   MILLED-EFFECT PROBE. Owner: "Make an effect where when the unit is milled
   from the top of the deck something happens, like summon, destroy a unit,
   draw a card".
   Built as a "Fires on" choice on the On-Grave trigger (onGrave.when:
   'any' | 'milled' | 'milledTop'). Loads a candidate index.html as the real
   page and runs the REAL mill paths. A card whose on-grave effect is
   "draw 1" is put on top of the deck; the hand size says whether it fired.
     1. when:'milledTop', milled off the top (millSelf) → FIRES (hand +1);
     2. when:'milledTop', sent by an entomb (src not 'top') → does NOT fire;
     3. when:'milledTop', the unit dies on the board → does NOT fire;
     4. when:'milled', sent by an entomb → FIRES;
     5. no `when` (every card written before this), milled off the top → FIRES,
        i.e. the old behaviour is unchanged;
     6. a destroy effect fired by the mill really destroys: when:'milledTop'
        with aoeKill-style "destroy the nearest enemy" kills the enemy unit.
   Usage:  node .gauntlet/milledfx-probe.mjs <candidate.html> [--url base]
   Needs the `public` preview server (port 8787). Exit 0 / 1 / 2 (2 = the
   feature is not in this file).
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: milledfx-probe.mjs <candidate.html>'); process.exit(2); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--url') || 'http://localhost:8787';
const html = fs.readFileSync(file, 'utf8');
if (!html.includes('function _onGraveWhenOk')) { console.log(JSON.stringify({ ok: false, missing: 'onGrave.when is not in this file' })); process.exit(2); }
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
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof _processMilledCards === 'function' && typeof applyOnPlayEffect === 'function', null, { timeout: 30000 });
  R = await page.evaluate(() => {
    const W = BOARD_W, H = BOARD_H;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });
    const filler = (i) => ({ id: 'pf_' + i, name: 'Filler ' + i, type: 'spell', cost: 1, instanceId: 'iid_f' + i });
    const mk = (topCard) => {
      const st = { player: side(), ai: side(), board: board(), turn: 'player', turnNumber: 2, round: 1, gameOver: false, log: [],
        units: [ { id: 'h_p', name: 'Hero', owner: 'player', isHero: true, alive: true, pos: { x: 6, y: 10 }, currentHp: 300 },
                 { id: 'u_c', name: 'Miller', owner: 'player', alive: true, pos: { x: 6, y: 8 }, currentHp: 20 },
                 { id: 'h_a', name: 'AI Hero', owner: 'ai', isHero: true, alive: true, pos: { x: 6, y: 0 }, currentHp: 300 },
                 { id: 'a_x', name: 'Victim', owner: 'ai', alive: true, pos: { x: 6, y: 6 }, currentHp: 10 } ] };
      st.player.deck = [topCard, filler(1), filler(2), filler(3)];
      return st;
    };
    const drawer = (when) => ({ id: 'pm_draw', name: 'Omen', type: 'unit', instanceId: 'iid_omen_' + Math.random(),
      onGrave: Object.assign({ type: 'drawCards', amount: 1 }, when ? { when } : {}) });
    const millTop = (st) => applyOnPlayEffect(st, st.units[1], { id: 'pm_host', name: 'Mill Host', type: 'unit', onPlay: { type: 'millSelf', amount: 1 } });
    const entomb = (st) => {           // a deck → graveyard send that is NOT off the top
      const c = st.player.deck[0];
      st.player = { ...st.player, deck: st.player.deck.slice(1), graveyard: [...st.player.graveyard, c] };
      return _processMilledCards(st, 'player', [c], 'search');
    };
    const hand = (st) => (st.player.hand || []).length;
    const out = {};
    let st;
    App.state = st = mk(drawer('milledTop')); st = millTop(st); out.topFires = hand(st);
    App.state = st = mk(drawer('milledTop')); st = entomb(st); out.topNotOnEntomb = hand(st);
    /* 3. the same card as a unit that dies on the board */
    App.state = st = mk(filler(0));
    const dieCard = drawer('milledTop');
    st.units.push({ id: 'u_die', name: 'Omen', owner: 'player', alive: true, pos: { x: 3, y: 8 }, currentHp: 1, cardId: 'pm_draw', onGrave: dieCard.onGrave });
    try { st = _fireOnGrave(st, { ...dieCard, id: 'u_die', cardId: 'pm_draw' }, 'player', { x: 3, y: 8 }); } catch (e) {}
    out.topNotOnDeath = hand(st);
    App.state = st = mk(drawer('milled')); st = entomb(st); out.milledOnEntomb = hand(st);
    App.state = st = mk(drawer(null)); st = millTop(st); out.legacyFires = hand(st);
    /* 6. a destroy effect off the top */
    const killer = { id: 'pm_kill', name: 'Doom Omen', type: 'unit', instanceId: 'iid_k',
      onGrave: { type: 'singleKill', chance: 100, radius: 12, aoeAll: true, when: 'milledTop' } };
    App.state = st = mk(killer); st = millTop(st);
    out.killVictim = !!(st.units.find(u => u.id === 'a_x') || {}).alive;
    return out;
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const f = [];
if (R.topFires !== 1) f.push('1 milled off the top: fires');
if (R.topNotOnEntomb !== 0) f.push('2 top-only: an entomb must not fire it');
if (R.topNotOnDeath !== 0) f.push('3 top-only: a death must not fire it');
if (R.milledOnEntomb !== 1) f.push('4 milled: an entomb fires it');
if (R.legacyFires !== 1) f.push('5 no `when`: behaviour unchanged (fires on a mill)');
if (R.killVictim !== false) f.push('6 a destroy effect off the top really destroys');
console.log(JSON.stringify({ ok: !f.length, fails: f, result: R, pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(f.length ? 1 : 0);
