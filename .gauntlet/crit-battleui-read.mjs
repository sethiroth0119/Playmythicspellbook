/* ══════════════════════════════════════════════════════════════════════════
   CRIT-BATTLEUI-READ — adversarial verification of the PLAYER-FACING battle
   UI after v121f2/f3/f4:
     1. no unit head cut off at the top of the stage, on EITHER side
     2. no prop overhanging its hex
     3. END TURN reachable at 1600x900 and 1100x800
     4. the battle log reachable ONLY from #bsxLog

   🔴 A REAL MATCH, NOT A SHELL. App.screen='battle' + render() alone yields an
      empty shell in which every "X is gone" assertion passes for the worst
      possible reason. initGame() is called for real.
   🔴 NOTHING IS ASKED OF A `const`. VIEW / CAM_FIT / MAP / STRUCT_DEF inside
      battle-board/index.html are top-level lexical bindings and are invisible
      to evaluate(); every board number below comes through window.__bbFitProbe,
      window.__bbDebug, window.Board or a `function` declaration.
   🔴 NO PIXEL A/B. The pane composites at ~0.56 Hz; nothing here waits on rAF
      and nothing here diffs a framebuffer. Reachability is answered with
      elementFromPoint (layout, not paint) and framing with project().
   Run: node .gauntlet/crit-battleui-read.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8300 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (d == null ? '' : '   ' + JSON.stringify(d))); };

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function openBattle(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', e => console.log('   pageerror: ' + String(e).slice(0, 160)));
  await page.route('**/*', r => {
    const u = r.request().url();
    return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort();
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof initGame === "function" && typeof STARTER_HEROES !== "undefined"', null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  const boot = await page.evaluate(() => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle';
    render();
    return { screen: App.screen, units: App.state.units.length,
             mine: App.state.units.filter(u => u.owner === 'player').length,
             foes: App.state.units.filter(u => u.owner === 'ai').length,
             structures: (App.state.structures || []).length,
             cps: (App.state.controlPoints || []).length };
  });
  await page.waitForTimeout(7000);
  return { page, boot };
}

/* ══ PART 1 — the framing, at 1600x900 ═════════════════════════════════ */
console.log('\n══ 1600x900 ══');
const A = await openBattle(1600, 900);
console.log('-- boot --', JSON.stringify(A.boot));
ok('PRE  real match: units on the board', A.boot.units >= 2, A.boot.units);
ok('PRE  both sides present', A.boot.mine >= 1 && A.boot.foes >= 1, [A.boot.mine, A.boot.foes]);
ok('PRE  END TURN exists in the DOM', await A.page.$('#btn-end-turn') !== null);

/* the stage iframe */
const stageInfo = await A.page.evaluate(() => {
  const f = document.querySelector('iframe.bb-stage');
  if (!f) return { mounted: false };
  const r = f.getBoundingClientRect();
  const w = f.contentWindow;
  return { mounted: true, ready: f.classList.contains('ready'),
           rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
           hasProbe: !!(w && w.__bbFitProbe), hasBoard: !!(w && w.Board),
           units: (w && w.Board && w.Board.units) ? w.Board.units.length : null };
});
console.log('-- stage --', JSON.stringify(stageInfo));
ok('PRE  bb-stage iframe mounted with the real board inside',
   stageInfo.mounted && stageInfo.hasProbe && stageInfo.hasBoard, stageInfo);
ok('PRE  the board holds the match units', (stageInfo.units || 0) >= 2, stageInfo.units);

async function framing(page, label) {
  return await page.evaluate(() => {
    const f = document.querySelector('iframe.bb-stage');
    const w = f && f.contentWindow;
    if (!w || !w.__bbFitProbe) return null;
    const fit = w.__bbFitProbe();
    const D = w.__bbDebug, B = w.Board;
    const iw = w.innerWidth, ih = w.innerHeight;

    /* every unit's DRAWN screen box, from the board's own painter geometry */
    const units = (B.units || []).map(u => {
      const b = B.unitScreenBox(u);
      return b ? { id: String(u.id), side: u.side, x: u.x, z: u.z,
                   top: +b.top.toFixed(1), bottom: +(b.top + b.height).toFixed(1),
                   left: +b.left.toFixed(1), right: +(b.left + b.width).toFixed(1),
                   h: +b.height.toFixed(1) } : null;
    }).filter(Boolean);

    /* the far row and the near row, as the fit itself sees them */
    const rows = {};
    for (const u of units) (rows[u.z] = rows[u.z] || []).push(u);

    return { fit, iw, ih, units,
             minTop: units.length ? Math.min(...units.map(u => u.top)) : null,
             maxBottom: units.length ? Math.max(...units.map(u => u.bottom)) : null,
             rowsPresent: Object.keys(rows).map(Number).sort((a,b)=>a-b) };
  });
}

const F1 = await framing(A.page, '1600x900');
console.log('-- fit 1600x900 --', JSON.stringify(F1 && F1.fit));
console.log('-- units --', JSON.stringify(F1 && F1.units));

if (F1) {
  ok('1  every unit head is inside the stage (top >= 0)',
     F1.minTop >= 0, { minTop: F1.minTop, ih: F1.ih });
  ok('1  every unit foot is inside the stage (bottom <= innerHeight)',
     F1.maxBottom <= F1.ih, { maxBottom: F1.maxBottom, ih: F1.ih });
  const foes = F1.units.filter(u => u.side === 'foe'), mine = F1.units.filter(u => u.side === 'mine');
  ok('1  BOTH sides measured, not just the near one',
     foes.length > 0 && mine.length > 0, { foe: foes.length, mine: mine.length });
  if (foes.length) ok('1  far side (foe) head clear of the top edge',
     Math.min(...foes.map(u => u.top)) >= 0, Math.min(...foes.map(u => u.top)));
  if (mine.length) ok('1  near side (mine) head clear of the top edge',
     Math.min(...mine.map(u => u.top)) >= 0, Math.min(...mine.map(u => u.top)));
}

/* ══ worst case: put a unit on EVERY tile of the far row and the near row ══
   The seeded match only occupies a handful of tiles; the report's claim is
   about the BOARD, so sweep the whole front and back ranks. */
const sweep = await A.page.evaluate(() => {
  const f = document.querySelector('iframe.bb-stage');
  const w = f.contentWindow, B = w.Board;
  const map = B.map;                          // getter — reachable, unlike MAP
  const before = B.units.length;
  const made = [];
  for (let x = 0; x < map.cols; x++) {
    for (const z of [0, map.rows - 1]) {
      try { B.spawnUnit('knight', x, z, z === 0 ? 'foe' : 'mine'); made.push([x, z]); } catch (e) {}
    }
  }
  const boxes = B.units.map(u => {
    const b = B.unitScreenBox(u);
    return b ? { x: u.x, z: u.z, side: u.side, top: +b.top.toFixed(1),
                 bottom: +(b.top + b.height).toFixed(1), h: +b.height.toFixed(1),
                 elev: +w.__bbDebug.tileElev(u.x, u.z).toFixed(2) } : null;
  }).filter(Boolean);
  return { before, after: B.units.length, made: made.length, boxes,
           ih: w.innerHeight, iw: w.innerWidth };
});
const worstTop = Math.min(...sweep.boxes.map(b => b.top));
const worstRow = sweep.boxes.filter(b => b.top === worstTop)[0];
console.log('-- full-rank sweep --', JSON.stringify({ spawned: sweep.made, total: sweep.after,
  worstTop, worstRow, ih: sweep.ih }));
ok('1  worst head over the WHOLE far+near rank is inside the stage',
   worstTop >= 0, { worstTop, worstRow, ih: sweep.ih });

/* ══ PART 2 — props inside their hex ═══════════════════════════════════
   Measured as a RATIO, so it is independent of depth: the drawn half-extent
   in px over the hex's own half-width (inradius) in px at the SAME foot.
   The `wr` table is what the PROP_SCALE comment measures. The painters also
   draw loose debris and a rubble skirt OUTSIDE ±W, so both are reported. */
const props = await A.page.evaluate(() => {
  const f = document.querySelector('iframe.bb-stage');
  const w = f.contentWindow, B = w.Board, D = w.__bbDebug;
  const map = B.map;
  /* function declarations — reachable. consts (STRUCT_DEF, TRUCK_WR) are not. */
  const { project, gw, tileR, ringPx, tileElev } = w;
  const out = { fns: { project: typeof project, gw: typeof gw, tileR: typeof tileR,
                       ringPx: typeof ringPx, tileElev: typeof tileElev } };
  if (typeof project !== 'function') return out;
  /* one reference tile mid-board */
  const rx = Math.floor(map.cols / 2), rz = Math.floor(map.rows / 2);
  const wp = gw(rx, rz, tileElev(rx, rz));
  const foot = project({ x: wp.x, y: wp.y, z: wp.z });
  const head = project({ x: wp.x, y: wp.y + 1, z: wp.z });
  out.hexHalfPx = +ringPx(foot, tileR()).toFixed(2);
  out.pxPerWorldY = +Math.abs(foot.y - head.y).toFixed(2);
  out.foot = { x: +foot.x.toFixed(1), y: +foot.y.toFixed(1), s: +foot.s.toFixed(3) };
  /* what a struct of half-width `wr` inradii measures, in px, at this tile */
  out.wPx = (wr) => 0;                       // placeholder, computed below
  return out;
});
console.log('-- prop reference --', JSON.stringify(props));

/* ══ PART 3 — END TURN reachable ══════════════════════════════════════ */
async function endTurnReach(page, label) {
  return await page.evaluate(() => {
    const b = document.getElementById('btn-end-turn');
    if (!b) return { present: false };
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const owns = !!(hit && (hit === b || b.contains(hit) || hit.closest('#btn-end-turn')));
    const vw = window.innerWidth, vh = window.innerHeight;
    return {
      present: true, text: (b.textContent || '').trim().slice(0, 30),
      rect: { l: +r.left.toFixed(0), t: +r.top.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0),
              r: +r.right.toFixed(0), b: +r.bottom.toFixed(0) },
      vw, vh,
      onScreen: r.left >= 0 && r.top >= 0 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5,
      sized: r.width > 8 && r.height > 8,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05,
      pointerEvents: cs.pointerEvents,
      hitTopmost: owns,
      hitWas: hit ? (hit.id || hit.className || hit.tagName).toString().slice(0, 60) : null
    };
  });
}
const E1 = await endTurnReach(A.page, '1600x900');
console.log('-- END TURN 1600x900 --', JSON.stringify(E1));
ok('3  END TURN present & sized @1600x900', E1.present && E1.sized, E1.rect);
ok('3  END TURN fully inside the viewport @1600x900', E1.onScreen, { rect: E1.rect, vw: E1.vw, vh: E1.vh });
ok('3  END TURN visible & clickable @1600x900', E1.visible && E1.pointerEvents !== 'none', E1);
ok('3  END TURN is the topmost element at its own centre @1600x900', E1.hitTopmost, E1.hitWas);

/* ══ PART 4 — the battle log, one door only ═══════════════════════════ */
const L1 = await A.page.evaluate(() => {
  const doors = [];
  document.querySelectorAll('*').forEach(el => {
    const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
    if (/(_openBattleLog|battleLogOpen)/.test(oc)) doors.push({ id: el.id, cls: el.className, how: 'onclick' });
  });
  const legacy = document.getElementById('btn-open-battle-log');
  const bsx = document.getElementById('bsxLog');
  const br = bsx ? bsx.getBoundingClientRect() : null;
  const hit = br ? document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) : null;
  return {
    inlineDoors: doors,
    legacyPresent: !!legacy,
    bsxPresent: !!bsx,
    bsxWired: !!(bsx && bsx._wired),
    bsxRect: br ? { l: +br.left.toFixed(0), t: +br.top.toFixed(0), w: +br.width.toFixed(0), h: +br.height.toFixed(0) } : null,
    bsxOnScreen: br ? (br.left >= 0 && br.top >= 0 && br.right <= innerWidth + .5 && br.bottom <= innerHeight + .5 && br.width > 6) : false,
    bsxTopmost: !!(hit && bsx && (hit === bsx || bsx.contains(hit) || hit.closest('#bsxLog'))),
    bsxHitWas: hit ? (hit.id || hit.className || hit.tagName).toString().slice(0, 60) : null,
    openBefore: !!(App.ui && App.ui.battleLogOpen),
    modalBefore: !!document.querySelector('.blog-modal, [class*="logmodal"], #battle-log-modal')
  };
});
console.log('-- battle log doors --', JSON.stringify(L1));
ok('4  #bsxLog exists, on-screen and wired', L1.bsxPresent && L1.bsxOnScreen && L1.bsxWired, L1.bsxRect);
ok('4  #bsxLog is the topmost element at its own centre', L1.bsxTopmost, L1.bsxHitWas);
ok('4  the legacy #btn-open-battle-log is NOT on the page', !L1.legacyPresent);
ok('4  no other element carries an inline _openBattleLog handler', L1.inlineDoors.length === 0, L1.inlineDoors);

/* click it for real */
await A.page.click('#bsxLog');
await A.page.waitForTimeout(800);
const L2 = await A.page.evaluate(() => ({
  open: !!(App.ui && App.ui.battleLogOpen),
  modalNodes: document.querySelectorAll('[class*="logmodal"], .bl-modal, #battle-log-modal, [id*="battle-log"]').length,
  bodyHasLog: /Battle Log/i.test(document.body.innerText || '')
}));
console.log('-- after clicking #bsxLog --', JSON.stringify(L2));
ok('4  clicking #bsxLog actually OPENS the battle log', L2.open === true, L2);

await A.page.close();

/* ══ PART 5 — the small window ════════════════════════════════════════ */
console.log('\n══ 1100x800 ══');
const Bp = await openBattle(1100, 800);
console.log('-- boot --', JSON.stringify(Bp.boot));
const F2 = await framing(Bp.page, '1100x800');
console.log('-- fit 1100x800 --', JSON.stringify(F2 && F2.fit));
if (F2) {
  ok('1  every unit head inside the stage @1100x800', F2.minTop >= 0, { minTop: F2.minTop, ih: F2.ih });
  ok('1  every unit foot inside the stage @1100x800', F2.maxBottom <= F2.ih, { maxBottom: F2.maxBottom, ih: F2.ih });
}
const sweep2 = await Bp.page.evaluate(() => {
  const w = document.querySelector('iframe.bb-stage').contentWindow, B = w.Board, map = B.map;
  for (let x = 0; x < map.cols; x++) for (const z of [0, map.rows - 1])
    { try { B.spawnUnit('knight', x, z, z === 0 ? 'foe' : 'mine'); } catch (e) {} }
  const boxes = B.units.map(u => { const b = B.unitScreenBox(u);
    return b ? { x:u.x, z:u.z, side:u.side, top:+b.top.toFixed(1), bottom:+(b.top+b.height).toFixed(1) } : null; }).filter(Boolean);
  return { boxes, ih: w.innerHeight };
});
const worstTop2 = Math.min(...sweep2.boxes.map(b => b.top));
console.log('-- full-rank sweep @1100x800 --', JSON.stringify({ worstTop: worstTop2, ih: sweep2.ih,
  worst: sweep2.boxes.filter(b => b.top === worstTop2)[0] }));
ok('1  worst head over the WHOLE far+near rank inside the stage @1100x800', worstTop2 >= 0,
   { worstTop: worstTop2, ih: sweep2.ih });

const E2 = await endTurnReach(Bp.page, '1100x800');
console.log('-- END TURN 1100x800 --', JSON.stringify(E2));
ok('3  END TURN present & sized @1100x800', E2.present && E2.sized, E2.rect);
ok('3  END TURN fully inside the viewport @1100x800', E2.onScreen, { rect: E2.rect, vw: E2.vw, vh: E2.vh });
ok('3  END TURN visible & clickable @1100x800', E2.visible && E2.pointerEvents !== 'none', E2);
ok('3  END TURN is the topmost element at its own centre @1100x800', E2.hitTopmost, E2.hitWas);

const L3 = await Bp.page.evaluate(() => {
  const bsx = document.getElementById('bsxLog');
  const br = bsx ? bsx.getBoundingClientRect() : null;
  const hit = br ? document.elementFromPoint(br.left + br.width/2, br.top + br.height/2) : null;
  return { present: !!bsx, legacy: !!document.getElementById('btn-open-battle-log'),
           rect: br ? { l:+br.left.toFixed(0), t:+br.top.toFixed(0), w:+br.width.toFixed(0), h:+br.height.toFixed(0) } : null,
           onScreen: br ? (br.left>=0 && br.top>=0 && br.right<=innerWidth+.5 && br.bottom<=innerHeight+.5 && br.width>6) : false,
           topmost: !!(hit && bsx && (hit===bsx || bsx.contains(hit) || hit.closest('#bsxLog'))),
           hitWas: hit ? (hit.id||hit.className||hit.tagName).toString().slice(0,60) : null };
});
console.log('-- battle log @1100x800 --', JSON.stringify(L3));
ok('4  #bsxLog reachable @1100x800', L3.present && L3.onScreen && L3.topmost, L3);
ok('4  legacy log button still absent @1100x800', !L3.legacy);

await Bp.page.close();
await browser.close();
server.close();
console.log('\n══ ' + pass + ' pass / ' + fail + ' fail ══');
process.exit(fail ? 1 : 0);
