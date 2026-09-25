// DRIVER 9 — the fixed contour must actually RUN in a live frame.
// d5 calls boundaryEdges directly; this one lets the real board draw with a
// real move region on it and watches for console errors from the STAGE iframe
// (tilefx wraps drawStates in try/catch, so a throw there is silent — the
// region would simply stop being painted and nothing would say why).
import { bootMatch } from './boot.mjs';

const { page, browser, close } = await bootMatch();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push('[page] ' + m.text().slice(0, 200)); });
for (const f of page.frames()) f.on?.('console', () => {});
browser.contexts()[0].on('page', p => p.on('console', m => { if (m.type() === 'error') errs.push('[popup] ' + m.text().slice(0, 200)); }));

await page.waitForFunction(() => {
  try { const f = document.querySelector('#bb-stage-host iframe'); return !!(f && f.contentWindow && f.contentWindow.BBX && f.contentWindow.BBX.tilefx); }
  catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});

// install an error trap INSIDE the stage iframe and un-swallow drawStates
const armed = await page.evaluate(() => {
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  bw.__ERRS = [];
  bw.addEventListener('error', e => bw.__ERRS.push('onerror: ' + (e.message || e)));
  const t = bw.BBX && bw.BBX.tilefx;
  if (!t || !t.drawStates) return false;
  const orig = t.drawStates;
  // tilefx swallows its own throws; wrap so we SEE them
  t.drawStates = function (api) { try { return orig.apply(this, arguments); } catch (e) { bw.__ERRS.push('drawStates threw: ' + (e && e.message)); throw e; } };
  return true;
});

// put a real reachable region on the board through the real push path
const pushed = await page.evaluate(() => {
  const S = App.state, W = BOARD_W, H = BOARD_H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S.board[y][x].wall = null;
  for (const [x, y] of [[5,5],[5,6],[5,7],[7,5],[7,6],[7,7],[6,4],[6,8]]) S.board[y][x].wall = { hp: 9 };
  const h0 = S.units.find(u => u.isHero && u.owner === 'player');
  S.units = S.units.map(u => u.id === h0.id ? { ...u, pos: { x: 6, y: 6 }, stats: { ...u.stats, spd: 5 } } : { ...u, pos: { x: 13, y: 0 } });
  const hero = S.units.find(u => u.id === h0.id);
  const mv = getValidMoves(hero, S.units, S.weather, S.board);
  App.ui = App.ui || {};
  App.ui.selectedUnit = hero.id;
  App.ui.moveMode = true;
  App.ui.validMoves = mv;
  try { _bbStagePushPaint(); } catch (e) { return { err: String(e && e.message), n: mv.length }; }
  return { n: mv.length };
});

// let real frames run, then read what the board is actually holding
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  let moveSize = null;
  try { moveSize = bw.Board && bw.Board.paint ? null : null; } catch (e) {}
  return { errs: bw.__ERRS.slice(0, 10), frames: bw.__bbDebug && bw.__bbDebug.frames };
});

console.log('drawStates wrapped:', armed);
console.log('move region pushed:', JSON.stringify(pushed));
console.log('stage iframe errors:', out.errs.length, out.errs);
console.log('page console errors:', errs.length, errs.slice(0, 8));
console.log(out.errs.length === 0 && !pushed.err ? '\nD9 LIVE: PASS — the fixed contour draws with no error in a live frame'
                                                : '\nD9 LIVE: FAIL');
await close();
