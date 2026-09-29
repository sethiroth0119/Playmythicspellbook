// DRIVER 5 — DRIVE THE REAL CONTOUR TRACER.
//
// The merge hybrid at battle-board/index.html:8056 hands the PAINT.move region
// to public/src/battle/stage/tilefx.js (measured live in d4: tilefx present ->
// theirs' teleWash/teleStroke suppressed). tilefx traces that region's outline
// with boundaryEdges(), which is module-internal, so this driver serves the
// SAME file with two lines appended that publish the internals on window. No
// behaviour is changed — the functions executed below are the shipped ones.
import { OVERLAY, bootMatch } from './boot.mjs';

OVERLAY.set('/src/battle/stage/tilefx.js', src =>
  src + '\n/* probe: publish internals, no behaviour change */\n' +
  'try { window.__TFX = { boundaryEdges, jitQuad, cells, stateRegions }; } catch (e) { window.__TFXERR = String(e); }\n');

const { page, close, pageErrors } = await bootMatch();

await page.waitForFunction(() => {
  try {
    const f = document.querySelector('#bb-stage-host iframe');
    return !!(f && f.contentWindow && f.contentWindow.__TFX);
  } catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});

const R = await page.evaluate(() => {
  const res = [];
  const T = (name, fn) => {
    try { const r = fn(); res.push({ name, ...r }); }
    catch (e) { res.push({ name, pass: false, note: 'THREW: ' + (e && e.message) }); }
  };
  const f = document.querySelector('#bb-stage-host iframe');
  const bw = f && f.contentWindow;
  const TFX = bw && bw.__TFX;

  T('the real tilefx internals are reachable (probe overlay only appends)', () =>
    ({ pass: !!(TFX && TFX.boundaryEdges && TFX.jitQuad),
       note: TFX ? 'boundaryEdges/jitQuad/cells/stateRegions published' : ('not published: ' + (bw && bw.__TFXERR)) }));
  if (!TFX) return res;

  // ---- build a REAL reachable region from the REAL rules ----
  const S = App.state, W = BOARD_W, H = BOARD_H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S.board[y][x].wall = null;
  const h0 = S.units.find(u => u.isHero && u.owner === 'player');
  S.units = S.units.map(u => u.id === h0.id ? { ...u, pos: { x: 6, y: 6 }, stats: { ...u.stats, spd: 4 } }
                                            : { ...u, pos: { x: 13, y: 0 } });
  const hero = S.units.find(u => u.id === h0.id);
  const moves = getValidMoves(hero, S.units, S.weather, S.board);
  // exactly what drawStates does: the move set with the selected tile folded in
  const region = moves.map(p => ({ x: p.x, z: p.y })).concat([{ x: hero.pos.x, z: hero.pos.y }]);
  const set = new Set(region.map(t => t.x + ',' + t.z));

  // the TRUE hex adjacency, HEXSPEC §5, evaluated with the GAME's own function
  const trueNb = (x, z) => hexNeighbors(x, z).map(n => [n.x, n.y]);

  // C1 — does every tile of a real move region even GET a polygon?
  T('jitQuad returns a polygon for every tile of a real 61-tile move region', () => {
    const api = { MAP: bw.MAP, tileElev: bw.tileElev, gw: bw.gw, project: bw.project,
                  tilePoly: bw.tilePoly, hash: bw.BBXHASH || ((a,b,c)=>0.5), W: bw.innerWidth, H: bw.innerHeight };
    let nulls = 0, ok = 0, sizes = {};
    for (const t of region) {
      let q = null;
      try { q = TFX.jitQuad(bw.__TFXAPI || api, t.x, t.z, 0.02, 0.06); } catch (e) {}
      if (!q) nulls++; else { ok++; sizes[q.length] = (sizes[q.length] || 0) + 1; }
    }
    return { pass: nulls === 0, note: `region ${region.length} tiles: polygons ${ok}, NULL ${nulls}, vertexCounts ${JSON.stringify(sizes)}` };
  });

  // C2 — THE CONTOUR ITSELF. boundaryEdges emits an edge for a side whose
  //      neighbour is not in the region, using the FOUR square-lattice
  //      neighbours (x,z-1) (x+1,z) (x,z+1) (x-1,z). All four are genuine hex
  //      neighbours on both parities — but there are SIX, and the two that
  //      change with row parity are never tested at all.
  T('boundaryEdges makes one adjacency test per hex side (must be 6, was 4)', () => {
    // read the rule out of the shipped function rather than asserting it
    const src = String(TFX.boundaryEdges);
    const tested = (src.match(/g\.set\.has\([^)]*\)/g) || []);
    const hasDiag = /z\s*-\s*1[^)]*\)\s*\)|x\s*[+-]\s*1\)\s*\+\s*','\s*\+\s*\(z/.test(src);
    return { pass: tested.length === 6,
      note: `boundaryEdges makes ${tested.length} adjacency tests (a hex tile has 6 sides): ${tested.join(' , ')}` };
  });

  // ---- CALL THE SHIPPED boundaryEdges FOR REAL ----
  // It takes g = { list:[{q,x,z}], set:Set<"x,z"> }. Build that from real
  // jitQuad polygons over the real region, then measure what it EMITS. (An
  // earlier version of this driver re-implemented the 4-side rule inline and
  // kept reporting the old numbers after the source was fixed — the whole point
  // of this file is to execute the shipped function, so it now does.)
  const api = { MAP: { cols: W, rows: H }, tileElev: bw.tileElev, gw: bw.gw, project: bw.project,
                tilePoly: bw.tilePoly, hash: (a, b, c) => 0.5, W: bw.innerWidth, H: bw.innerHeight };
  const buildG = (tiles) => {
    const list = [];
    for (const t of tiles) { const q = TFX.jitQuad(api, t.x, t.z, 0.02, 0.06); if (q) list.push({ q, x: t.x, z: t.z }); }
    return { list, set: new Set(tiles.map(t => t.x + ',' + t.z)) };
  };

  // C3 — the shipped tracer must emit exactly one segment per genuinely
  //      exposed hex side of the region. No more, no fewer.
  T('shipped boundaryEdges emits one segment per exposed hex side', () => {
    const g = buildG(region);
    const edges = TFX.boundaryEdges(g);
    let exposed = 0;
    for (const t of region) for (const [nx, nz] of trueNb(t.x, t.z)) if (!set.has(nx + ',' + nz)) exposed++;
    const shapes = {}; for (const e of edges) shapes[e.p.length] = (shapes[e.p.length] || 0) + 1;
    const badShape = edges.filter(e => !e.p || e.p.length !== 3 || e.p.some(p => !p || !isFinite(p.x) || !isFinite(p.y))).length;
    return { pass: edges.length === exposed && badShape === 0,
      note: `region ${region.length} tiles | exposed hex sides ${exposed} | segments emitted ${edges.length} | untraced ${exposed - edges.length} | point-counts ${JSON.stringify(shapes)} (the rim loop indexes p[0..2]), malformed ${badShape}` };
  });

  // C4 — THE CONTOUR MUST CLOSE. Every vertex the emitted segments touch must
  //      have EVEN degree; an odd one is a loose end, i.e. a visible gap.
  //      Vertices are taken on the exact integer lattice (cols x4, rows x2), not
  //      from the projected floats, so the test cannot be fooled by rounding.
  T('shipped boundaryEdges: the contour CLOSES (no loose ends)', () => {
    const g = buildG(region);
    const edges = TFX.boundaryEdges(g);
    const vid = (x, z, c, r) => {
      const s = (z & 1) ? 2 : 0;
      return (x * 4 + s + (c === 'L' ? -2 : c === 'R' ? 2 : 0)) + ':' + (z * 2 + (r === 'T' ? -1 : 1));
    };
    // k -> the lattice segment it represents (see the boundaryEdges source)
    const K = { 0: ['L','T','M','T'], 1: ['M','T','R','T'], 2: ['R','T','R','B'],
                3: ['R','B','M','B'], 4: ['M','B','L','B'], 5: ['L','B','L','T'] };
    const deg = new Map(); let unknownK = 0;
    for (const e of edges) {
      const s = K[e.k]; if (!s) { unknownK++; continue; }
      const a = vid(e.it.x, e.it.z, s[0], s[1]), b = vid(e.it.x, e.it.z, s[2], s[3]);
      deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1);
    }
    let loose = 0; for (const v of deg.values()) if (v % 2) loose++;
    return { pass: loose === 0 && unknownK === 0,
      note: `${edges.length} segments over ${deg.size} vertices | LOOSE ENDS ${loose} | unrecognised k ${unknownK}` };
  });

  return res;
});

let pass = 0, fail = 0;
for (const r of R) { r.pass ? pass++ : fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.note}`); }
console.log(`\nD5 CONTOUR: ${pass} pass / ${fail} fail   pageErrors ${pageErrors.length}`);
if (pageErrors.length) console.log(pageErrors.slice(0, 6));
await close();
