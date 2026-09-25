import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = (await import('node:fs')).readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load' });
await p.waitForFunction(() => typeof window.renderUnitModal === 'function' && !!window.MythicCardSheet);
const out = await p.evaluate(() => {
  const ids = [];
  try { for (const k of Object.keys(MOVES)) { if (ids.length >= 7) break; if (lookupMove(k)) ids.push(k); } } catch (e) { return { err: 'MOVES: ' + e.message }; }
  const mk = (o) => Object.assign({ alive: true, currentHp: 30, maxHp: 30, level: 5, xp: 0, statusEffects: [],
    stats: { hp: 30, atk: 10, def: 10, mag: 10, res: 10, spd: 1 }, atk: 10, def: 10, mag: 10, res: 10, spd: 1,
    hasMoved: false, hasAttacked: false, pos: { x: 1, y: 1 } }, o);
  const side = () => ({ hand: [], deck: [], graveyard: [], void: [], energy: 5, maxEnergy: 5 });
  const res = {};
  const cases = {
    playerHero6: mk({ id: 'H', name: 'Hero', owner: 'player', isHero: true, heroId: 'h1', knownMoves: ids.slice(0, 6) }),
    playerUnit4: mk({ id: 'U', name: 'Knight', owner: 'player', cardId: 'knight', knownMoves: ids.slice(0, 4) }),
    enemyHero4:  mk({ id: 'E', name: 'Foe', owner: 'ai', isHero: true, heroId: 'h2', knownMoves: ids.slice(0, 4), pos: { x: 6, y: 6 } }),
  };
  for (const [k, u] of Object.entries(cases)) {
    try {
      App.state = { turn: 'player', turnNumber: 2, phase: 'setup', log: [], player: side(), ai: side(), units: Object.values(cases), timeOfDay: 'day', scanned: { E: true } };
      App.ui = App.ui || {}; App.ui.modalUnitId = u.id;
      const h = renderUnitModal();
      const m = /class="tts-slots">([^<]*)</.exec(h);
      res[k] = m ? m[1] : (h.indexOf('tts-moves') >= 0 ? '(no counter)' : '(no sheet)');
    } catch (e) { res[k] = 'THREW ' + e.message; }
  }
  App.ui.modalUnitId = null;
  return res;
});
await b.close();
console.log(JSON.stringify({ out, errs: errs.slice(0, 3) }, null, 1));
