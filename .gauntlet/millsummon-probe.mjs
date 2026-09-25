/* ══════════════════════════════════════════════════════════════════════════
   MILL & SUMMON PROBE. Owner: "mill x from your deck, Summon any Savage Demon
   unit from the top of your deck."
   Loads a candidate index.html as the real page and runs the REAL
   applyOnPlayEffect with { type:'millSummon', amount:4, filter:{ nameIncludes:
   'Savage Demon' } } against a deck whose top four are
       Savage Demon Grunt · Goblin · Savage Demon Brute · Fire Spell
   with one more Savage Demon at position five (it must NOT be touched). Checks:
     1. both demons in the top four are summoned onto the board;
     2. the Goblin and the Spell go to the graveyard (not the demons);
     3. the deck lost exactly four cards and the fifth demon is still on top;
     4. the fifth card is not summoned (only the top N are turned over);
     5. with NO filter, the Goblin is summoned too and only the Spell is milled;
     6. an empty deck fizzles with no error.
   Usage:  node .gauntlet/millsummon-probe.mjs <candidate.html> [--url base]
   Needs the `public` preview server (port 8787). Exit 0 / 1 / 2 (2 = the
   effect is not in this file — run it on HEAD~ first to see that).
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: millsummon-probe.mjs <candidate.html>'); process.exit(2); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--url') || 'http://localhost:8787';
const html = fs.readFileSync(file, 'utf8');
if (!html.includes("eff.type === 'millSummon'")) { console.log(JSON.stringify({ ok: false, missing: 'millSummon is not in this file' })); process.exit(2); }
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
  await page.waitForFunction(() => typeof applyOnPlayEffect === 'function', null, { timeout: 30000 });
  R = await page.evaluate(() => {
    const unit = (id, name) => ({ id, name, type: 'unit', cost: 2, icon: '👹', stats: { hp: 20, atk: 8, def: 4, mag: 2, res: 2, spd: 1 }, learnset: [{ lvl: 1, m: 'slash' }] });
    const DEFS = [unit('pr_sd1', 'Savage Demon Grunt'), unit('pr_gob', 'Goblin Rando'), unit('pr_sd2', 'Savage Demon Brute'),
      { id: 'pr_spl', name: 'Fire Spell', type: 'spell', cost: 1, icon: '🔥' }, unit('pr_sd3', 'Savage Demon Tyrant')];
    Forge.customCards = (Forge.customCards || []).filter(c => !/^pr_/.test(c.id)).concat(DEFS);
    const W = BOARD_W, H = BOARD_H;
    const board = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ({ x, y, terrain: 'plain' })));
    const side = () => ({ deck: [], hand: [], graveyard: [], void: [], energy: 9, maxEnergy: 9, hp: 30 });
    const caster = { id: 'u_caster', name: 'Summoner', owner: 'player', alive: true, pos: { x: 6, y: 8 }, currentHp: 20 };
    const mk = (deckIds) => {
      const st = { player: side(), ai: side(), board: board(), turn: 'player', turnNumber: 2, round: 1, gameOver: false, log: [],
        units: [ { id: 'h_p', name: 'Hero', owner: 'player', isHero: true, alive: true, pos: { x: 6, y: 10 }, currentHp: 300 }, { ...caster },
                 { id: 'h_a', name: 'AI Hero', owner: 'ai', isHero: true, alive: true, pos: { x: 6, y: 0 }, currentHp: 300 } ] };
      st.player.deck = deckIds.map((id, i) => ({ ...DEFS.find(d => d.id === id), instanceId: 'iid_' + id + '_' + i }));
      return st;
    };
    const names = (arr) => (arr || []).map(c => c.name);
    const onBoard = (st) => (st.units || []).filter(u => u.alive && u.owner === 'player' && !u.isHero && u.id !== 'u_caster').map(u => u.name);
    const card = (filter) => ({ id: 'pr_host', name: 'Demon Caller', type: 'unit', onPlay: { type: 'millSummon', amount: 4, ...(filter ? { filter } : {}) } });
    const out = {};
    App.state = mk(['pr_sd1', 'pr_gob', 'pr_sd2', 'pr_spl', 'pr_sd3']);
    let st = applyOnPlayEffect(App.state, App.state.units[1], card({ nameIncludes: 'Savage Demon' }));
    out.filtered = { board: onBoard(st), grave: names(st.player.graveyard), deck: names(st.player.deck) };
    App.state = mk(['pr_sd1', 'pr_gob', 'pr_sd2', 'pr_spl', 'pr_sd3']);
    st = applyOnPlayEffect(App.state, App.state.units[1], card(null));
    out.unfiltered = { board: onBoard(st), grave: names(st.player.graveyard), deck: names(st.player.deck) };
    App.state = mk([]);
    try { st = applyOnPlayEffect(App.state, App.state.units[1], card({ nameIncludes: 'Savage Demon' })); out.empty = { ok: true, log: (st.log || []).map(l => l.msg).slice(-1)[0] }; }
    catch (e) { out.empty = { ok: false, err: String(e) }; }
    return out;
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const f = [], F = R.filtered || {}, U = R.unfiltered || {};
const has = (a, n) => (a || []).includes(n);
if (!(has(F.board, 'Savage Demon Grunt') && has(F.board, 'Savage Demon Brute'))) f.push('1 both demons in the top four are summoned');
if (!(has(F.grave, 'Goblin Rando') && has(F.grave, 'Fire Spell') && !has(F.grave, 'Savage Demon Grunt') && !has(F.grave, 'Savage Demon Brute'))) f.push('2 the rest are milled, the demons are not');
if (!((F.deck || []).length === 1 && F.deck[0] === 'Savage Demon Tyrant')) f.push('3 exactly four turned over; the fifth stays on top');
if (has(F.board, 'Savage Demon Tyrant')) f.push('4 the fifth card must not be summoned');
if (!(has(U.board, 'Goblin Rando') && (U.grave || []).length === 1 && U.grave[0] === 'Fire Spell')) f.push('5 no filter: every unit summoned, only the spell milled');
if (!(R.empty && R.empty.ok && /fizzles/.test(R.empty.log || ''))) f.push('6 empty deck fizzles cleanly');
console.log(JSON.stringify({ ok: !f.length, fails: f, result: R, pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(f.length ? 1 : 0);
