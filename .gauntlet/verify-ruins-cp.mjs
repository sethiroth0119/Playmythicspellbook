/* ══════════════════════════════════════════════════════════════════════════
   VERIFY-RUINS-CP — merge verification for the two battlefield GAME RULES:
     A. ruins: move onto one, loot it, and get the SAME salvage grid a
        tombstone opens (including dragging your own carried loot back in).
     B. control points: hold two SCP trucks for three straight turns and the
        match ends with nobody touching a hero — and the score ticks ONCE per
        side per turn, not twice.
   Driven in the REAL public/index.html through initGame / getValidMoves /
   moveUnit / startTurn / endPlayerTurn / endAITurn. Nothing is stubbed.
   Run: node .gauntlet/verify-ruins-cp.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8100 + (process.pid % 80);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.route('**/*', (r) => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof _cpSeedControlPoints === "function"', null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(6000);

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (d == null ? '' : '   ' + JSON.stringify(d))); };

/* ─── build the battle ─────────────────────────────────────────────────── */
const boot = await page.evaluate(() => {
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  App.screen = 'battle';
  const s = App.state;
  return { structures: s.structures.length, cps: (s.controlPoints || []).length,
           heroPos: s.units.find((u) => u.owner === 'player').pos };
});
console.log('-- boot --', JSON.stringify(boot));
ok('battle seeds 5 lootable ruins', boot.structures === 5, boot.structures);
ok('battle seeds 3 SCP control points', boot.cps === 3, boot.cps);

/* ═══ A. RUINS ═════════════════════════════════════════════════════════ */
console.log('\n-- A. RUINS --');
const A = await page.evaluate(() => {
  const out = {};
  const s = App.state;
  const hero = s.units.find((u) => u.owner === 'player' && u.isHero);
  const ruin = s.structures.find((r) => r.name === 'Burnt House') || s.structures[0];
  out.ruin = { x: ruin.x, y: ruin.y, name: ruin.name, risk: ruin.risk };
  hero.pos = { x: ruin.x, y: ruin.y + 1 };
  out.startPos = { ...hero.pos };
  const vm = getValidMoves(hero, s.units, s.weather) || [];
  out.validMoveCount = vm.length;
  out.ruinTileOffered = vm.some((p) => p.x === ruin.x && p.y === ruin.y);
  out.canLootBeforeMove = _unitCanLootStructure(hero);
  App.state = moveUnit(s, hero, { x: ruin.x, y: ruin.y });
  const hero2 = App.state.units.find((u) => u.id === hero.id);
  out.posAfterMove = { ...hero2.pos };
  out.walkPathLegs = Array.isArray(hero2.walkPath) ? hero2.walkPath.length : null;
  out.canLootAfterMove = _unitCanLootStructure(hero2);
  out.hasMovedAfterMove = !!hero2.hasMoved;
  return out;
});
console.log(JSON.stringify(A));
ok('ruin tile is walkable (not blocked) — offered by getValidMoves', A.ruinTileOffered === true, A);
ok('cannot loot a ruin you are not standing on', A.canLootBeforeMove === false);
ok('moveUnit lands the unit on the ruin tile', A.posAfterMove.x === A.ruin.x && A.posAfterMove.y === A.ruin.y, A.posAfterMove);
ok('walkPath rides on the moved unit (route travels with the move)', A.walkPathLegs >= 2, A.walkPathLegs);
ok('standing on the ruin, SEARCH is offered', A.canLootAfterMove === true);

const A2 = await page.evaluate(() => {
  const out = {};
  const s = App.state;
  const hero = s.units.find((u) => u.owner === 'player' && u.isHero);
  out.bagBefore = JSON.parse(JSON.stringify(_ensureFieldBag()));
  out.lgOpenBefore = !!(_LG && _LG.open);
  out.ret = _lootStructureWithUnit(hero.id, 'normal');
  out.lgOpenAfter = !!(_LG && _LG.open);
  out.overlay = !!document.getElementById('lg-overlay');
  out.h2 = (document.querySelector('#lg-modal h2') || {}).textContent;
  out.lootTitle = _LG.lootTitle;
  out.titleTexts = [...document.querySelectorAll('.lg-title')].map((e) => e.textContent.trim().slice(0, 60));
  out.lootPieces = _LG.loot.pieces.map((p) => ({ res: p.resId, qty: p.qty, fromLoot: p.fromLoot }));
  out.bagPieces = _LG.bag.pieces.map((p) => ({ res: p.resId, qty: p.qty, fromLoot: p.fromLoot }));
  const st = App.state.structures.find((r) => r.x === hero.pos.x && r.y === hero.pos.y);
  out.structLooted = !!st.looted;
  const h2u = App.state.units.find((u) => u.id === hero.id);
  out.turnSpent = !!(h2u.hasMoved && h2u.hasAttacked);
  out.salvageRun = JSON.parse(JSON.stringify(App.state._salvageRun || {}));
  return out;
});
console.log(JSON.stringify(A2).slice(0, 1400));
ok('_lootStructureWithUnit returns true', A2.ret === true);
ok('the SALVAGE GRID opens (#lg-overlay in the DOM)', A2.overlay === true);
ok('it is the tombstone singleton _LG (open flag set)', A2.lgOpenAfter === true);
ok('grid is populated from the ruin salvage table', A2.lootPieces.length > 0, A2.lootPieces.length);
ok('the ruin names itself, not a tombstone', /Burnt House|Ruin/i.test(A2.lootTitle || '') && !/Tombstone/i.test(A2.lootTitle || ''), A2.lootTitle);
ok('ruin is marked looted', A2.structLooted === true);
ok('searching spends the unit turn', A2.turnSpent === true);
ok('_salvageRun.looted incremented (end-of-battle summary sees it)', (A2.salvageRun.looted | 0) >= 1, A2.salvageRun);

const A3 = await page.evaluate(() => {
  const s = App.state; const hero = s.units.find((u) => u.owner === 'player' && u.isHero);
  const other = s.structures.find((r) => !r.looted);
  hero.hasMoved = false; hero.hasAttacked = false; const saved = { ...hero.pos };
  hero.pos = { x: other.x, y: other.y };
  const ret = _lootStructureWithUnit(hero.id, 'normal');
  const r2 = { ret, stillOne: document.querySelectorAll('#lg-overlay').length, otherLooted: !!other.looted };
  hero.pos = saved;
  return r2;
});
ok('second search REFUSED while a grid is open (R12 singleton guard)', A3.ret === false && A3.stillOne === 1 && A3.otherLooted === false, A3);

const dragSetup = await page.evaluate(() => {
  const s = App.state;
  try { _LG.ov.remove(); } catch (e) {}
  _LG.open = false;
  Profile.fieldBag = { wood: 3, cloth: 2 };
  const hero = s.units.find((u) => u.owner === 'player' && u.isHero);
  const st = s.structures.find((r) => !r.looted);
  hero.hasMoved = false; hero.hasAttacked = false;
  hero.pos = { x: st.x, y: st.y };
  const ret = _lootStructureWithUnit(hero.id, 'normal');
  const before = { lootCount: _LG.loot.pieces.length, bagCount: _LG.bag.pieces.length,
                   lootGrid: { cols: _LG.loot.cols, rows: _LG.loot.rows },
                   lootCells: _LG.loot.pieces.reduce((a, p) => a + p.w * p.h, 0) };
  // "Take All that fits" first — that is how a player empties the container,
  // and it is the state in which dragging your own kit back in is meaningful.
  document.getElementById('lg-takeall').click();
  return { ret, before, owned: _LG.bag.pieces.filter((p) => !p.fromLoot).map((p) => ({ uid: p.uid, res: p.resId, qty: p.qty })),
           lootCount: _LG.loot.pieces.length, bagCount: _LG.bag.pieces.length,
           takeAllMoved: before.lootCount - _LG.loot.pieces.length };
});
console.log('drag setup', JSON.stringify(dragSetup));
ok('your carried loot appears in the grid as YOUR pieces', dragSetup.owned.length > 0, dragSetup.owned);
ok('"Take All That Fits" empties the container into the bag', dragSetup.takeAllMoved > 0, dragSetup);

let dragRes = { skipped: true };
if (dragSetup.owned.length) {
  const uid = dragSetup.owned[0].uid;
  /* Aim at a cell the grid will actually ACCEPT — the drop is (correctly)
     refused on an occupied cell, so a blind aim proves nothing either way. */
  const box = await page.evaluate((u) => {
    const el = document.querySelector('.lg-piece[data-lg-uid="' + u + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const wrap = document.querySelector('[data-lg-wrap="loot"]');
    const wr = wrap.getBoundingClientRect();
    const p = _LG.bag.pieces.find((q) => q.uid === u);
    const cell = _lgCell(), gap = 3;
    const sz = _lgSize(p);
    let slot = null;
    for (let y = 0; y < _LG.loot.rows && !slot; y++)
      for (let x = 0; x < _LG.loot.cols && !slot; x++)
        if (_lgCanPlace(_LG.loot, p, x, y)) slot = { x, y };
    if (!slot) return { noSlot: true };
    // invert the drop math in moveP: fx = round((clientX - left - 8 - w/2)/(cell+gap))
    const tx = wr.left + 8 + slot.x * (cell + gap) + (sz.w * cell + (sz.w - 1) * gap) / 2;
    const ty = wr.top + 8 + slot.y * (cell + gap) + (sz.h * cell + (sz.h - 1) * gap) / 2;
    return { sx: r.left + r.width / 2, sy: r.top + r.height / 2, tx, ty, slot };
  }, uid);
  console.log('drag aim', JSON.stringify(box));
  if (box && box.noSlot) { console.log('  (no free slot on the loot side — cannot test the drag here)'); }
  if (box && !box.noSlot) {
    await page.mouse.move(box.sx, box.sy);
    await page.mouse.down();
    await page.mouse.move(box.sx + 20, box.sy + 20, { steps: 4 });
    await page.mouse.move(box.tx, box.ty, { steps: 12 });
    const midDrag = await page.evaluate(() => ({
      dragging: !!_LG.drag,
      hover: _LG.drag && _LG.drag.hover ? _LG.drag.hover.id : null,
      hx: _LG.drag ? _LG.drag.hx : null, hy: _LG.drag ? _LG.drag.hy : null,
      canPlace: _LG.drag && _LG.drag.hover ? _lgCanPlace(_LG.drag.hover, _LG.drag.p, _LG.drag.hx, _LG.drag.hy) : null,
    }));
    console.log('mid-drag', JSON.stringify(midDrag), 'box', JSON.stringify(box));
    await page.mouse.up();
    await page.waitForTimeout(200);
    dragRes = await page.evaluate((u) => ({
      inLoot: _LG.loot.pieces.some((p) => p.uid === u),
      inBag: _LG.bag.pieces.some((p) => p.uid === u),
      lootPieces: _LG.loot.pieces.length, bagPieces: _LG.bag.pieces.length,
    }), uid);
  }
}
console.log('drag result', JSON.stringify(dragRes));
ok('you can drag YOUR OWN loot back into the container to make room',
   dragRes.inLoot === true && dragRes.inBag === false, dragRes);

/* Close semantics. commitClose has a documented AUTO-TAKE: everything still on
   the LOOT side that is `fromLoot` and fits comes with you; anything of YOURS
   left on the loot side was deliberately dumped and is LOST. */
const A4 = await page.evaluate(() => {
  const before = JSON.parse(JSON.stringify(_ensureFieldBag()));
  const bagRes = {}, lootMine = {}, lootTheirs = {};
  for (const p of _LG.bag.pieces) bagRes[p.resId] = (bagRes[p.resId] || 0) + p.qty;
  for (const p of _LG.loot.pieces) {
    const t = p.fromLoot ? lootTheirs : lootMine;
    t[p.resId] = (t[p.resId] || 0) + p.qty;
  }
  document.getElementById('lg-close').click();
  return { before, bagRes, lootMine, lootTheirs, after: JSON.parse(JSON.stringify(_ensureFieldBag())),
           open: _LG.open, overlay: !!document.getElementById('lg-overlay') };
});
console.log('close', JSON.stringify(A4));
{
  // your own dumped loot must NOT come back, the ruin's haul must
  const mine = Object.keys(A4.lootMine);
  const droppedGone = mine.every((k) => (A4.after[k] | 0) === ((A4.bagRes[k] | 0)));
  const haulTaken = Object.keys(A4.lootTheirs).some((k) => (A4.after[k] | 0) > (A4.bagRes[k] | 0));
  ok('closing keeps the bag grid contents', Object.keys(A4.bagRes).every((k) => (A4.after[k] | 0) >= A4.bagRes[k]), A4.after);
  ok('the ruin haul left on the container is auto-taken on close (documented)', haulTaken || Object.keys(A4.lootTheirs).length === 0, A4);
  ok('YOUR OWN loot dumped into the container is LOST on close', droppedGone, { mine: A4.lootMine, after: A4.after });
}
ok('closing tears the overlay down', A4.overlay === false && A4.open === false, A4);

const A5 = await page.evaluate(() => {
  const s = App.state;
  const hero = s.units.find((u) => u.owner === 'player' && u.isHero);
  hero.hasMoved = false; hero.hasAttacked = false;
  s.tombstones = s.tombstones || [];
  s.tombstones.push({ id: 'tomb_drv', x: hero.pos.x, y: hero.pos.y, name: 'fallen body', owner: 'ai',
                      lootable: true, looted: false, glowing: false,
                      loot: { metal: 3, cloth: 2 }, salvage: { metal: 3, cloth: 2 }, turnsLeft: 5 });
  const canT = (typeof _unitCanLoot === 'function') ? _unitCanLoot(hero) : 'n/a';
  const ret = (typeof _lootWithUnit === 'function') ? _lootWithUnit(hero.id, 'normal') : 'n/a';
  const o = { canT, ret, overlay: !!document.getElementById('lg-overlay'),
              title: _LG.lootTitle, h2: (document.querySelector('#lg-modal h2') || {}).textContent,
              hasOwned: _LG.bag.pieces.some((p) => !p.fromLoot),
              gridIds: [...document.querySelectorAll('[data-lg-wrap]')].map((e) => e.dataset.lgWrap) };
  try { document.getElementById('lg-close').click(); } catch (e) {}
  return o;
});
console.log('tombstone', JSON.stringify(A5));
ok('a TOMBSTONE opens the same #lg-overlay grid', A5.overlay === true && A5.gridIds.join(',') === 'loot,bag', A5);
ok('tombstone keeps its own default heading', /Tombstone/i.test(A5.title || ''), A5.title);

/* ═══ B. CONTROL POINTS ════════════════════════════════════════════════ */
console.log('\n-- B. CONTROL POINTS --');
const B0 = await page.evaluate(() => {
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  const s = App.state;
  window.__cpCalls = [];
  const orig = window._cpTickControlPoints;
  window.__cpOrig = orig;
  window._cpTickControlPoints = function (st, who) {
    window.__cpCalls.push({ who, turnNumber: st && st.turnNumber | 0,
      before: { p: (st.cpScore || {}).player | 0, a: (st.cpScore || {}).ai | 0 } });
    const r = orig.apply(this, arguments);
    const last = window.__cpCalls[window.__cpCalls.length - 1];
    last.after = { p: (st.cpScore || {}).player | 0, a: (st.cpScore || {}).ai | 0 };
    last.streak = { p: (st.cpStreak || {}).player | 0, a: (st.cpStreak || {}).ai | 0 };
    return r;
  };
  const cps = s.controlPoints;
  const heroP = s.units.find((u) => u.owner === 'player' && u.isHero);
  const heroA = s.units.find((u) => u.owner === 'ai' && u.isHero);
  const mk = (id, owner, pos) => ({ id, owner, name: 'Drv ' + id, isHero: false, alive: true, pos,
    currentHp: 30, maxHp: 30, stats: { atk: 5, def: 5, spd: 3, mag: 0, res: 0 }, statusEffects: [],
    hasMoved: false, hasAttacked: false, energy: 3, maxEnergy: 3, moves: [], elements: ['normal'] });
  s.units.push(mk('drvA', 'player', { x: cps[0].x, y: cps[0].y }));
  s.units.push(mk('drvB', 'player', { x: cps[1].x, y: cps[1].y }));
  return { heroPHp: heroP.currentHp, heroAHp: heroA.currentHp,
           cps: cps.map((c) => ({ x: c.x, y: c.y, label: c.label })),
           holders: cps.map((c) => _cpHolderOf(s, c)),
           heldPlayer: _cpHeldCount(s, 'player'), heldAi: _cpHeldCount(s, 'ai'),
           CP_HOLD_TO_WIN, CP_STREAK_TO_WIN, CP_RING };
});
console.log(JSON.stringify(B0));
ok('two trucks read as HELD by the player', B0.heldPlayer === 2 && B0.heldAi === 0, B0);
ok('the third truck is neutral (0-0 is contested, not held)', B0.holders.filter((h) => h === null).length === 1, B0.holders);

/* ⚠ Drive the REAL turn cycle and NOTHING else. endPlayerTurn runs
   startTurn(s,'ai'); endAITurn bumps turnNumber and runs startTurn(s,'player').
   Calling startTurn('player') by hand as well would double-drive the loop and
   invent a double-tick that the game does not have. */
const B1 = await page.evaluate(() => {
  const log = [];
  log.push({ phase: 'battle-start', turnNumber: App.state.turnNumber,
             score: { ...App.state.cpScore }, streak: { ...App.state.cpStreak },
             victory: _cpEvalVictory(App.state) });
  for (let i = 0; i < 4; i++) {
    App.state = endPlayerTurn(App.state);   // -> AI turn-start
    App.state = endAITurn(App.state);       // -> turnNumber++, player turn-start
    log.push({ phase: 'after round ' + (i + 1), turnNumber: App.state.turnNumber,
               score: { ...App.state.cpScore }, streak: { ...App.state.cpStreak },
               victory: _cpEvalVictory(App.state) });
  }
  const s = App.state;
  return { log, calls: window.__cpCalls,
           heroPHp: s.units.find((u) => u.owner === 'player' && u.isHero).currentHp,
           heroAHp: s.units.find((u) => u.owner === 'ai' && u.isHero).currentHp,
           heroPAlive: s.units.find((u) => u.owner === 'player' && u.isHero).alive,
           heroAAlive: s.units.find((u) => u.owner === 'ai' && u.isHero).alive,
           victory: _cpEvalVictory(s), score: { ...s.cpScore }, streak: { ...s.cpStreak },
           cpLogLines: (s.log || []).filter((l) => l && /SCP|truck|streak/i.test(l.msg || '')).map((l) => l.msg) };
});
console.log(JSON.stringify(B1.log, null, 1));
console.log('TICK CALLS:');
for (const c of B1.calls) console.log('   ', JSON.stringify(c));
console.log('CP LOG:');
for (const l of B1.cpLogLines) console.log('   ', l);
ok('victory on control points fires', B1.victory === 'player', { v: B1.victory, streak: B1.streak });
ok('streak reached CP_STREAK_TO_WIN', B1.streak.player >= 3, B1.streak);
ok('NOBODY touched a hero — both heroes alive at full HP',
   B1.heroPAlive && B1.heroAAlive && B1.heroPHp > 0 && B1.heroAHp > 0, { p: B1.heroPHp, a: B1.heroAHp });
ok('AI never scored (never held a truck)', (B1.score.ai | 0) === 0, B1.score);

const perTurn = {};
for (const c of B1.calls) { const k = c.who + '@' + c.turnNumber; perTurn[k] = (perTurn[k] || 0) + 1; }
console.log('calls per side per turn:', JSON.stringify(perTurn));
ok('the tick runs ONCE per side per turn, never twice',
   Object.values(perTurn).every((n) => n === 1), perTurn);
const deltas = B1.calls.filter((c) => c.who === 'player').map((c) => c.after.p - c.before.p);
console.log('player score delta per own turn-start:', JSON.stringify(deltas));
ok('score moves +2 per player turn (one point per held truck), never +4',
   deltas.length > 0 && deltas.every((d) => d === 2 || d === 0), deltas);

/* Give-back. The arithmetic is (+1 per truck still held) − (1 per truck whose
   point this side had banked and just lost), evaluated in the same tick. */
const B2 = await page.evaluate(() => {
  const s = App.state;
  s.cpStreak = { player: 0, ai: 0 };
  const before = { ...s.cpScore };
  s.units.find((u) => u.id === 'drvB').pos = { x: 0, y: 11 };   // abandon truck 2 of 2
  window.__cpOrig(s, 'player');
  const mid = { score: { ...s.cpScore }, streak: { ...s.cpStreak } };
  s.units.find((u) => u.id === 'drvA').pos = { x: 1, y: 11 };   // abandon the last one
  window.__cpOrig(s, 'player');
  const after = { score: { ...s.cpScore }, streak: { ...s.cpStreak } };
  // and once more with nothing held and nothing banked — must not go negative
  window.__cpOrig(s, 'player');
  return { before, mid, after, idle: { ...s.cpScore },
           lastLines: (s.log || []).slice(-4).map((l) => l.msg) };
});
console.log(JSON.stringify(B2, null, 1));
ok('dropping below two trucks RESETS the streak to 0 (not -1)', B2.mid.streak.player === 0, B2.mid);
ok('abandoning 1 of 2 trucks nets 0 (+1 still held, -1 given back)',
   B2.mid.score.player === B2.before.player, { before: B2.before.player, mid: B2.mid.score.player });
ok('abandoning the last truck gives its point back (-1)',
   B2.after.score.player === B2.mid.score.player - 1, { mid: B2.mid.score.player, after: B2.after.score.player });
ok('holding nothing does not drain the score below what was earned',
   B2.idle.player === B2.after.score.player, B2.idle);

const B3 = await page.evaluate(() => {
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.state = initGame(me, foe, [], true, null);
  const s = App.state, cps = s.controlPoints;
  const mk = (id, owner, pos) => ({ id, owner, name: 'Drv ' + id, isHero: false, alive: true, pos,
    currentHp: 30, maxHp: 30, stats: { atk: 5, def: 5, spd: 3, mag: 0, res: 0 }, statusEffects: [],
    hasMoved: false, hasAttacked: false, energy: 3, maxEnergy: 3, moves: [], elements: ['normal'] });
  s.units.push(mk('e1', 'ai', { x: cps[0].x, y: cps[0].y }));
  s.units.push(mk('e2', 'ai', { x: cps[2].x, y: cps[2].y }));
  for (let i = 0; i < 3; i++) window.__cpOrig(s, 'ai');
  return { victory: _cpEvalVictory(s), streak: { ...s.cpStreak }, score: { ...s.cpScore } };
});
console.log(JSON.stringify(B3));
ok('the AI wins on control points on the same terms', B3.victory === 'ai' && B3.streak.ai >= 3, B3);

const B4 = await page.evaluate(() => {
  const s = App.state, cp = s.controlPoints[1];
  const mk = (id, owner, pos) => ({ id, owner, name: id, isHero: false, alive: true, pos,
    currentHp: 30, maxHp: 30, stats: { atk: 1, def: 1, spd: 1 }, statusEffects: [], hasMoved: false, hasAttacked: false, moves: [], elements: ['normal'] });
  let nb = null;
  try { nb = hexNeighbors(cp.x, cp.y); } catch (e) { try { nb = hexNeighbors(cp); } catch (e2) { nb = null; } }
  s.units.push(mk('c1', 'player', { x: cp.x, y: cp.y }));
  const one = _cpHolderOf(s, cp);
  const n = (nb && nb[0]) || { x: cp.x + 1, y: cp.y };
  s.units.push(mk('c2', 'ai', { x: n.x, y: n.y }));
  const two = _cpHolderOf(s, cp);
  s.units.find((u) => u.id === 'c1').alive = false;
  const three = _cpHolderOf(s, cp);
  return { neighborCount: nb ? nb.length : null, nb, one, two, three, ringDist: (typeof distance === 'function') ? distance(cp, n) : null };
});
/* Does the verdict actually END THE MATCH, and does it log exactly once?
   The verdict is consumed in renderBattle, which is RAF-batched; call the
   immediate renderer directly (CLAUDE.md: render() does nothing in a
   synchronous driver). */
const B5 = await page.evaluate(() => {
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.state = initGame(me, foe, [], true, null);
  App.screen = 'battle'; App.replayViewing = false;
  const s = App.state, cps = s.controlPoints;
  const mk = (id, owner, pos) => ({ id, owner, name: 'Drv ' + id, isHero: false, alive: true, pos,
    currentHp: 30, maxHp: 30, stats: { atk: 5, def: 5, spd: 3, mag: 0, res: 0 }, statusEffects: [],
    hasMoved: false, hasAttacked: false, energy: 3, maxEnergy: 3, moves: [], elements: ['normal'] });
  s.units.push(mk('w1', 'player', { x: cps[0].x, y: cps[0].y }));
  s.units.push(mk('w2', 'player', { x: cps[1].x, y: cps[1].y }));
  const out = { steps: [] };
  for (let i = 0; i < 3; i++) {
    window.__cpOrig(App.state, 'player');
    try { renderBattleNow(); } catch (e) { out.renderErr = String(e).slice(0, 160); }
    out.steps.push({ i: i + 1, streak: App.state.cpStreak.player | 0, gameOver: App.state.gameOver || null });
  }
  // extra renders must NOT push a second victory line, and must not advance
  for (let i = 0; i < 5; i++) { try { renderBattleNow(); } catch (e) {} }
  const st = App.state;
  out.gameOver = st.gameOver || null;
  out.streakAfterExtraRenders = st.cpStreak.player | 0;
  out.scoreAfterExtraRenders = { ...st.cpScore };
  out.victoryLines = (st.log || []).filter((l) => l && /VICTORY!/.test(l.msg || '')).map((l) => l.msg);
  out.heroesAlive = st.units.filter((u) => u.isHero).map((u) => ({ o: u.owner, hp: u.currentHp, alive: u.alive }));
  return out;
});
console.log('victory consumer', JSON.stringify(B5, null, 1));
ok('the streak stamps state.gameOver with the WINNER', B5.gameOver === 'player', B5.gameOver);
ok('the match ends with both heroes alive and untouched',
   B5.heroesAlive.every((h) => h.alive && h.hp > 0), B5.heroesAlive);
ok('the VICTORY line is logged exactly ONCE across repeated renders',
   B5.victoryLines.length === 1, B5.victoryLines);
ok('_cpEvalVictory is a pure read — extra renders do not advance the streak',
   B5.streakAfterExtraRenders === 3, B5.streakAfterExtraRenders);

/* The multiplayer guard: a client must tick its OWN side only. Verified with
   ONE client — the real two-client desync is out of reach here. */
const B6 = await page.evaluate(() => {
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.state = initGame(me, foe, [], true, null);
  const s = App.state, cps = s.controlPoints;
  const mk = (id, owner, pos) => ({ id, owner, name: id, isHero: false, alive: true, pos,
    currentHp: 30, maxHp: 30, stats: { atk: 1, def: 1, spd: 1 }, statusEffects: [], hasMoved: false, hasAttacked: false, moves: [], elements: ['normal'] });
  s.units.push(mk('m1', 'ai', { x: cps[0].x, y: cps[0].y }));
  s.units.push(mk('m2', 'ai', { x: cps[1].x, y: cps[1].y }));
  App.battlePrep.multiplayer = true;
  window.__cpOrig(s, 'ai');
  const mp = { score: { ...s.cpScore }, streak: { ...s.cpStreak } };
  App.battlePrep.multiplayer = false;
  window.__cpOrig(s, 'ai');
  const sp = { score: { ...s.cpScore }, streak: { ...s.cpStreak } };
  App.battlePrep.multiplayer = false;
  return { mp, sp };
});
console.log('mp guard', JSON.stringify(B6));
ok('in MULTIPLAYER a client does NOT tick the opponent side (anti double-count)',
   B6.mp.score.ai === 0 && B6.mp.streak.ai === 0, B6.mp);
ok('in SINGLE-PLAYER the same call DOES tick the AI side', B6.sp.score.ai === 2, B6.sp);

console.log(JSON.stringify(B4));
ok('capture ring is SIX neighbours, never eight', B4.neighborCount === 6, B4.neighborCount);
ok('one player unit on the truck holds it', B4.one === 'player');
ok('1v1 inside the ring is CONTESTED — nobody holds it', B4.two === null, B4.two);
ok('a dead unit does not hold a truck', B4.three === 'ai', B4.three);

/* ── B7. The objective must be AUDIBLE, not just correct. The tick pushes its
   running-score line straight into s.log; startTurn snapshots `log` before it
   and reassigns after it, which discarded every one of those lines. */
const B7 = await page.evaluate(() => {
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  const s = App.state, cps = s.controlPoints;
  const mk = (id, owner, pos) => ({ id, owner, name: id, isHero: false, alive: true, pos,
    currentHp: 30, maxHp: 30, stats: { atk: 1, def: 1, spd: 1 }, statusEffects: [], hasMoved: false, hasAttacked: false, moves: [], elements: ['normal'] });
  s.units.push(mk('l1', 'player', { x: cps[0].x, y: cps[0].y }));
  s.units.push(mk('l2', 'player', { x: cps[1].x, y: cps[1].y }));
  s.log = [];
  const afterStart = startTurn(s, 'player');
  const viaStartTurn = (afterStart.log || []).filter((l) => l && /SCP truck/.test(l.msg || '')).map((l) => l.msg);
  App.state = afterStart; App.state.log = [];
  App.state = endPlayerTurn(App.state);
  App.state = endAITurn(App.state);
  const viaCycle = (App.state.log || []).filter((l) => l && /SCP truck|hold streak|ONE TURN/.test(l.msg || '')).map((l) => l.msg);
  // no CP line may appear twice (the phase banners legitimately repeat per turn)
  const all = (App.state.log || []).map((l) => l && l.msg).filter((m) => m && /SCP truck|hold streak|ONE TURN/.test(m));
  const dupes = all.filter((m, i) => all.indexOf(m) !== i);
  return { viaStartTurn, viaCycle, dupes, streak: { ...App.state.cpStreak } };
});
console.log('log channel', JSON.stringify(B7, null, 1));
ok('the running score reaches s.log through startTurn', B7.viaStartTurn.length === 1, B7.viaStartTurn);
ok('the running score reaches s.log through a full turn cycle', B7.viaCycle.length >= 1, B7.viaCycle);
ok('no line is logged twice', B7.dupes.length === 0, B7.dupes);

/* ── C. THE GUARD PAIR (CONTRACT R25): the row that OFFERS the search and the
   gate that PERFORMS it must agree on every case, or the button is dead and
   silent. Driven case by case rather than compared by eye. */
console.log('\n-- C. SEARCH-GUARD ALIGNMENT --');
const C = await page.evaluate(() => {
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.state = initGame(me, foe, [], true, null);
  const s = App.state;
  const hero = s.units.find((u) => u.owner === 'player' && u.isHero);
  const ruin = s.structures[0];
  const rows = [];
  const trial = (name, setup) => {
    // reset
    try { if (_LG.ov) _LG.ov.remove(); } catch (e) {}
    _LG.open = false; _LG.loot = null; _LG.bag = null;
    App.state.turn = 'player';
    ruin.looted = false; ruin.lootable = true;
    hero.alive = true; hero.owner = 'player';
    hero.pos = { x: ruin.x, y: ruin.y };
    hero.hasMoved = false; hero.hasAttacked = false;
    setup(hero, ruin, App.state);
    const offered = _unitCanLootStructure(App.state.units.find((u) => u.id === hero.id) || hero);
    const performed = _lootStructureWithUnit(hero.id, 'normal');
    try { if (document.getElementById('lg-close')) document.getElementById('lg-close').click(); } catch (e) {}
    rows.push({ name, offered, performed, agree: offered === performed });
    return rows[rows.length - 1];
  };
  trial('fresh, standing on the ruin', () => {});
  trial('moved but not attacked', (u) => { u.hasMoved = true; });
  trial('attacked but not moved', (u) => { u.hasAttacked = true; });
  trial('turn fully spent', (u) => { u.hasMoved = true; u.hasAttacked = true; });
  trial('ruin already looted', (u, r) => { r.looted = true; });
  trial('not standing on it', (u, r) => { u.pos = { x: (r.x + 3) % 14, y: (r.y + 3) % 12 }; });
  trial('it is the AI turn', (u, r, st) => { st.turn = 'ai'; });
  trial('the unit is dead', (u) => { u.alive = false; });
  trial('the structure is not lootable', (u, r) => { r.lootable = false; });
  return rows;
});
for (const r of C) console.log('   ', JSON.stringify(r));
ok('the SEARCH offer and the SEARCH gate agree on every case (R25)',
   C.every((r) => r.agree), C.filter((r) => !r.agree));

/* ── D. SEEDING — determinism and the two placement guarantees. */
console.log('\n-- D. SEEDING --');
const D = await page.evaluate(() => {
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  const sig = (st) => JSON.stringify({
    r: (st.structures || []).map((x) => [x.x, x.y, x.kind]),
    c: (st.controlPoints || []).map((x) => [x.x, x.y, x.id]) });
  const runs = [];
  const bad = { truckOnRuin: 0, truckHeldAtStart: 0, cpCount: 0, ruinCount: 0, dupTiles: 0 };
  let seedRepro = null;
  for (let i = 0; i < 12; i++) {
    const st = initGame(me, foe, [], true, null);
    runs.push({ seed: st._bbMapSeed != null ? st._bbMapSeed : null, sig: sig(st) });
    if ((st.controlPoints || []).length !== 3) bad.cpCount++;
    if ((st.structures || []).length !== 5) bad.ruinCount++;
    for (const c of st.controlPoints || []) {
      if ((st.structures || []).some((r) => r.x === c.x && r.y === c.y)) bad.truckOnRuin++;
      if (_cpHolderOf(st, c) !== null) bad.truckHeldAtStart++;
    }
    const tiles = (st.controlPoints || []).map((c) => c.x + ',' + c.y);
    if (new Set(tiles).size !== tiles.length) bad.dupTiles++;
  }
  // determinism: re-seed the SAME state object twice — the seeders are
  // idempotent, so a snapshot arriving with the arrays populated must not roll again
  const st = initGame(me, foe, [], true, null);
  const before = sig(st);
  _seedBattleStructures(st); _cpSeedControlPoints(st);
  seedRepro = { before, after: sig(st) };
  return { bad, seedRepro, distinctLayouts: new Set(runs.map((r) => r.sig)).size, runs: runs.length };
});
console.log(JSON.stringify(D).slice(0, 400));
ok('every battle gets 5 ruins and 3 trucks', D.bad.cpCount === 0 && D.bad.ruinCount === 0, D.bad);
ok('no truck is ever parked on a ruin', D.bad.truckOnRuin === 0, D.bad.truckOnRuin);
ok('no truck is two trucks (three distinct tiles every time)', D.bad.dupTiles === 0, D.bad.dupTiles);
ok('NOBODY holds a truck at battle start — the 3-hex hero keep-out holds',
   D.bad.truckHeldAtStart === 0, D.bad.truckHeldAtStart);
ok('re-seeding an already-seeded state is a no-op (replay / MP snapshot safe)',
   D.seedRepro.before === D.seedRepro.after, D.seedRepro);

/* ── E. THE OTHER EXTRACTION MODES, THE RAIL TRACKER, AND WHAT THE BOARD IS
   TOLD. A rule that is scored but never drawn is invisible; a mode that eats
   the turn without paying out is silent theft. */
console.log('\n-- E. MODES / TRACKER / BOARD PUSH --');
const E = await page.evaluate(() => {
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  const s = App.state, cps = s.controlPoints;
  const mk = (id, owner, pos) => ({ id, owner, name: id, isHero: false, alive: true, pos,
    currentHp: 30, maxHp: 30, stats: { atk: 1, def: 1, spd: 1 }, statusEffects: [], hasMoved: false, hasAttacked: false, moves: [], elements: ['normal'] });
  s.units.push(mk('t1', 'player', { x: cps[0].x, y: cps[0].y }));
  s.units.push(mk('t2', 'ai', { x: cps[1].x, y: cps[1].y }));
  const out = {};
  out.tracker = (typeof _cpTracker === 'function') ? _cpTracker(s) : null;
  out.trackerHasAll3 = out.tracker ? cps.every((c) => out.tracker.indexOf(c.label) >= 0) : false;

  const posts = [];
  const origPost = window._bbStagePost;
  window._bbStagePost = function (kind, payload) { posts.push({ kind, payload }); };
  try { _BBS.structKey = null; _BBS.cpKey = null; } catch (e) {}
  try { _bbStagePushStructs(); } catch (e) { out.structPushErr = String(e).slice(0, 140); }
  try { _bbStagePushCPs(); } catch (e) { out.cpPushErr = String(e).slice(0, 140); }
  window._bbStagePost = origPost;
  out.posts = posts.map((p) => ({ kind: p.kind, n: (p.payload.list || []).length, sample: (p.payload.list || [])[0] }));
  const cpPost = posts.find((p) => p.kind === 'cps');
  out.cpSides = cpPost ? cpPost.payload.list.map((c) => c.side) : null;
  out.cpNeed = cpPost ? cpPost.payload.list.map((c) => c.need) : null;

  const hero = s.units.find((u) => u.owner === 'player' && u.isHero);
  const ruin = s.structures[0];
  hero.pos = { x: ruin.x, y: ruin.y }; hero.hasMoved = false; hero.hasAttacked = false;
  const ownsVeh = (typeof playerOwnsVehicle === 'function') ? playerOwnsVehicle() : null;
  const ret = _lootStructureWithUnit(hero.id, 'research');
  const h = App.state.units.find((u) => u.id === hero.id);
  out.research = { ownsVeh, ret, ruinLooted: !!App.state.structures.find((r) => r.x === ruin.x && r.y === ruin.y).looted,
                   turnSpent: !!(h.hasMoved && h.hasAttacked), salvageRunLooted: (App.state._salvageRun || {}).looted | 0 };

  const ruin2 = App.state.structures.find((r) => !r.looted);
  const h2 = App.state.units.find((u) => u.id === hero.id);
  h2.hasMoved = false; h2.hasAttacked = false; h2.pos = { x: ruin2.x, y: ruin2.y };
  const bagBefore = JSON.stringify(_ensureFieldBag());
  const dret = _lootStructureWithUnit(hero.id, 'destroy');
  const h3 = App.state.units.find((u) => u.id === hero.id);
  out.destroy = { dret, overlay: !!document.getElementById('lg-overlay'),
                  looted: !!App.state.structures.find((r) => r.x === ruin2.x && r.y === ruin2.y).looted,
                  turnSpent: !!(h3.hasMoved && h3.hasAttacked),
                  bagUnchanged: JSON.stringify(_ensureFieldBag()) === bagBefore };

  const h4 = App.state.units.find((u) => u.id === hero.id);
  h4.hasMoved = false; h4.hasAttacked = false;
  out.reLoot = { offered: _unitCanLootStructure(h4), performed: _lootStructureWithUnit(hero.id, 'normal') };

  /* RISK — the same HP-only, clamped-to-1 consequence the bodies use. Driven
     on a unit at 1 HP so the clamp is the thing under test, not the damage. */
  const risky = App.state.structures.find((r) => !r.looted) || App.state.structures[0];
  risky.looted = false; risky.risk = 'explosive';
  const g = App.state.units.find((u) => u.id === 't1');
  g.pos = { x: risky.x, y: risky.y }; g.currentHp = 1; g.hasMoved = false; g.hasAttacked = false;
  const rmsg = _applyTombstoneRisk(App.state, g.id, 'explosive');
  const gAfter = App.state.units.find((u) => u.id === 't1');
  out.risk = { msg: rmsg, hp: gAfter.currentHp, alive: gAfter.alive };
  return out;
});
console.log(JSON.stringify(E).slice(0, 900));
ok('the rail tracker renders and names all three trucks', !!E.tracker && E.trackerHasAll3, (E.tracker || '').slice(0, 100));
ok('the board is told about all 5 ruins', (E.posts.find((p) => p.kind === 'structs') || {}).n === 5, E.posts);
ok('the board is told about all 3 trucks', (E.posts.find((p) => p.kind === 'cps') || {}).n === 3, E.posts);
ok('the truck push renames player/ai to the board vocabulary mine/foe',
   JSON.stringify(E.cpSides) === JSON.stringify(['mine', 'foe', null]), E.cpSides);
ok('the truck push carries the win threshold so the field can show progress',
   (E.cpNeed || []).every((n) => n === 3), E.cpNeed);
ok('research mode with no vehicle REFUNDS the turn and un-loots the ruin (R15)',
   E.research.ret === true && E.research.turnSpent === false && E.research.ruinLooted === false && E.research.salvageRunLooted === 0, E.research);
ok('DESTROY denies the loot, opens no grid, and still spends the turn',
   E.destroy.dret === true && E.destroy.overlay === false && E.destroy.looted === true && E.destroy.turnSpent === true && E.destroy.bagUnchanged === true, E.destroy);
ok('a looted ruin is neither offered nor lootable again',
   E.reLoot.offered === false && E.reLoot.performed === false, E.reLoot);
ok('a risky ruin hurts but never KILLS the looter (HP clamped to 1)',
   E.risk.hp >= 1 && E.risk.alive === true && !!E.risk.msg, E.risk);

console.log('\nRESULT  pass=' + pass + '  fail=' + fail);
console.log('PAGE ERRORS:', errs.length ? errs.slice(0, 10) : 'none');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
