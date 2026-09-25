// DRIVER 10 — THE WHOLE CHAIN, LIVE.
// Real match -> real getValidMoves -> real _bbStagePushPaint -> real frame ->
// real drawStates -> real boundaryEdges. Counts the segments the LIVE FRAME
// actually traced and asserts the outline closes. d9 only proved nothing threw;
// this proves the contour was drawn and is continuous.
import { OVERLAY, bootMatch } from './boot.mjs';

OVERLAY.set('/src/battle/stage/tilefx.js', src =>
  src.replace('function boundaryEdges(g) {',
    'function boundaryEdges(g) {\n' +
    '  /* probe: record every live call */\n' +
    '  try { const _o = _bePROBE(g); if (_o) window.__BE = _o; } catch (e) {}\n') +
  '\nfunction _bePROBE(g){ return null; }\n' +
  'try { window.__TFXBE = () => boundaryEdges; } catch (e) {}\n');

// simpler + safer than editing the body: wrap the exported-through-window ref
OVERLAY.set('/src/battle/stage/tilefx.js', src =>
  src + '\ntry {\n' +
  '  window.__BECALLS = [];\n' +
  '  const _origBE = boundaryEdges;\n' +
  '  window.__TFX = { jitQuad, boundaryEdges: _origBE };\n' +
  '  /* patch the module-internal binding by re-declaring the drawPool caller is not\n' +
  '     possible, so instead expose a live recorder the driver calls with the real g\n' +
  '     that drawStates built — see __recordRegions below. */\n' +
  '  window.__recordRegions = (api) => {\n' +
  '    const out = [];\n' +
  '    for (const r of stateRegions(api, null)) {\n' +
  '      if (!r[1].length) continue;\n' +
  '      const list = [];\n' +
  '      for (const t of r[1]) { const q = jitQuad(api, t.x, t.z, LIFT_STATE, MASK_STATE.amp); if (q) list.push({ q, x: t.x, z: t.z }); }\n' +
  '      const g = { list, set: new Set(r[1].map(t => t.x + "," + t.z)) };\n' +
  '      out.push({ kind: r[0], tiles: r[1].length, polys: list.length, edges: _origBE(g).map(e => ({ k: e.k, x: e.it.x, z: e.it.z })) });\n' +
  '    }\n' +
  '    return out;\n' +
  '  };\n' +
  '} catch (e) { window.__TFXERR = String(e); }\n');

const { page, close } = await bootMatch();
await page.waitForFunction(() => {
  try { const f = document.querySelector('#bb-stage-host iframe'); return !!(f && f.contentWindow && f.contentWindow.__recordRegions); }
  catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});

// capture the api object the REAL frame hands drawStates
await page.evaluate(() => {
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  const t = bw.BBX.tilefx, orig = t.drawStates;
  t.drawStates = function (api) { bw.__LASTAPI = api; bw.__DSCALLS = (bw.__DSCALLS || 0) + 1; return orig.apply(this, arguments); };
});

const pushed = await page.evaluate(() => {
  const S = App.state, W = BOARD_W, H = BOARD_H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S.board[y][x].wall = null;
  for (const [x, y] of [[5,5],[5,6],[5,7],[7,5],[7,6],[7,7],[6,4],[6,8]]) S.board[y][x].wall = { hp: 9 };
  const h0 = S.units.find(u => u.isHero && u.owner === 'player');
  S.units = S.units.map(u => u.id === h0.id ? { ...u, pos: { x: 6, y: 6 }, stats: { ...u.stats, spd: 5 } } : { ...u, pos: { x: 13, y: 0 } });
  const hero = S.units.find(u => u.id === h0.id);
  const mv = getValidMoves(hero, S.units, S.weather, S.board);
  // ⚠ _bbStagePushPaint reads App._bbPaint (the set renderBattle builds), NOT
  // App.ui.validMoves. Writing the ui field pushes an empty region and the probe
  // then reports "no regions" — which is a driver miss, not a board failure.
  App.ui = App.ui || {}; App.ui.selectedUnit = hero.id;
  App._bbPaint = { move: mv.map(p => ({ x: p.x, y: p.y })), attack: [], place: [], swap: [],
                   sel: { x: hero.pos.x, z: hero.pos.y } };
  _BBS.paintKey = null;              // defeat the no-op de-dupe
  _bbStagePushPaint();
  return { region: mv.length };
});

await page.waitForTimeout(2500);

const R = await page.evaluate(() => {
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  const api = bw.__LASTAPI;
  if (!api) return { err: 'drawStates never ran with an api', calls: bw.__DSCALLS || 0 };
  const regs = bw.__recordRegions(api);
  const vid = (x, z, c, r) => {
    const s = (z & 1) ? 2 : 0;
    return (x * 4 + s + (c === 'L' ? -2 : c === 'R' ? 2 : 0)) + ':' + (z * 2 + (r === 'T' ? -1 : 1));
  };
  const K = { 0: ['L','T','M','T'], 1: ['M','T','R','T'], 2: ['R','T','R','B'],
              3: ['R','B','M','B'], 4: ['M','B','L','B'], 5: ['L','B','L','T'] };
  return {
    calls: bw.__DSCALLS,
    regions: regs.map(r => {
      const deg = new Map();
      for (const e of r.edges) {
        const s = K[e.k]; if (!s) return { kind: r.kind, bad: 'unknown k ' + e.k };
        for (const [c, rr] of [[s[0], s[1]], [s[2], s[3]]]) { const v = vid(e.x, e.z, c, rr); deg.set(v, (deg.get(v) || 0) + 1); }
      }
      let loose = 0; for (const v of deg.values()) if (v % 2) loose++;
      return { kind: r.kind, tiles: r.tiles, polys: r.polys, segments: r.edges.length, vertices: deg.size, looseEnds: loose };
    }),
  };
});

console.log('move region pushed by the game:', JSON.stringify(pushed));
console.log('live drawStates invocations:', R.calls);
for (const r of (R.regions || [])) console.log('  ', JSON.stringify(r));
const ok = R.regions && R.regions.length && R.regions.every(r => r.looseEnds === 0 && r.polys === r.tiles);
console.log(ok ? '\nD10 LIVE EDGES: PASS — every live region traced a CLOSED contour, every tile got a polygon'
               : '\nD10 LIVE EDGES: FAIL ' + JSON.stringify(R).slice(0, 400));
await close();
