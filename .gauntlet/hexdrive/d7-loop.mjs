// DRIVER 7 — IS THE CONTOUR A CLOSED LOOP?
//
// "One continuous contour around everywhere it can reach" has an exact test:
// the emitted boundary segments must form closed loops, i.e. EVERY vertex they
// touch must have EVEN degree. An odd-degree vertex is a loose end — a visible
// gap in the outline.
//
// The brick geometry (verified in d6 against the board's own gw()):
//   corners of brick (x,z) in shifted-column space are  col = x + s(z) ± 0.5,
//   row = z ± 0.5, with s(z) = (z&1)*0.5;  the N and S sides each carry a
//   midpoint at col = x + s(z). Scaled by 4 (cols) and 2 (rows) it is integral.
//
// Run with FIX=1 to score the proposed 6-side rule instead of the shipped one.
import { bootMatch } from './boot.mjs';

const FIXMODE = process.env.FIX === '1';
const { page, close, pageErrors } = await bootMatch();

const R = await page.evaluate((FIXMODE) => {
  const res = [];
  const T = (name, fn) => { try { const r = fn(); res.push({ name, ...r }); } catch (e) { res.push({ name, pass: false, note: 'THREW: ' + (e && e.message) }); } };
  const S = App.state, W = BOARD_W, H = BOARD_H;

  // --- the two rules, expressed as "which neighbour is across this segment" ---
  const shippedSides = (x, z) => [
    { nb: [x, z - 1],   seg: ['L', 'T', 'R', 'T'] },   // whole N side
    { nb: [x + 1, z],   seg: ['R', 'T', 'R', 'B'] },   // E
    { nb: [x, z + 1],   seg: ['R', 'B', 'L', 'B'] },   // whole S side
    { nb: [x - 1, z],   seg: ['L', 'B', 'L', 'T'] },   // W
  ];
  const fixedSides = (x, z) => {
    const odd = z & 1;
    return [
      { nb: odd ? [x, z - 1]     : [x - 1, z - 1], seg: ['L', 'T', 'M', 'T'] },
      { nb: odd ? [x + 1, z - 1] : [x,     z - 1], seg: ['M', 'T', 'R', 'T'] },
      { nb: [x + 1, z],                            seg: ['R', 'T', 'R', 'B'] },
      { nb: odd ? [x + 1, z + 1] : [x,     z + 1], seg: ['R', 'B', 'M', 'B'] },
      { nb: odd ? [x,     z + 1] : [x - 1, z + 1], seg: ['M', 'B', 'L', 'B'] },
      { nb: [x - 1, z],                            seg: ['L', 'B', 'L', 'T'] },
    ];
  };

  // exact integer lattice vertex ids
  const vid = (x, z, c, r) => {
    const s = (z & 1) ? 2 : 0;                        // 0.5 col * 4 = 2
    const col = x * 4 + s + (c === 'L' ? -2 : c === 'R' ? 2 : 0);
    const row = z * 2 + (r === 'T' ? -1 : 1);
    return col + ':' + row;
  };

  const scoreRegion = (set, tiles, sides) => {
    const deg = new Map();
    let edges = 0;
    for (const t of tiles) {
      for (const s of sides(t.x, t.z)) {
        if (set.has(s.nb[0] + ',' + s.nb[1])) continue;
        edges++;
        const a = vid(t.x, t.z, s.seg[0], s.seg[1]);
        const b = vid(t.x, t.z, s.seg[2], s.seg[3]);
        deg.set(a, (deg.get(a) || 0) + 1);
        deg.set(b, (deg.get(b) || 0) + 1);
      }
    }
    let odd = 0;
    for (const v of deg.values()) if (v % 2) odd++;
    return { edges, vertices: deg.size, looseEnds: odd };
  };

  // --- real reachable regions from the real rules, several shapes ---
  const scenarios = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S.board[y][x].wall = null;
  const h0 = S.units.find(u => u.isHero && u.owner === 'player');
  S.units = S.units.map(u => u.id === h0.id ? u : { ...u, pos: { x: 13, y: 0 } });

  const build = (label, spd, origin, walls) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S.board[y][x].wall = null;
    for (const [wx, wy] of (walls || [])) S.board[wy][wx].wall = { hp: 9, canBePushed: false };
    S.units = S.units.map(u => u.id === h0.id ? { ...u, pos: { x: origin[0], y: origin[1] }, stats: { ...u.stats, spd } } : u);
    const hero = S.units.find(u => u.id === h0.id);
    const mv = getValidMoves(hero, S.units, S.weather, S.board);
    const tiles = mv.map(p => ({ x: p.x, z: p.y })).concat([{ x: hero.pos.x, z: hero.pos.y }]);
    scenarios.push({ label, tiles, set: new Set(tiles.map(t => t.x + ',' + t.z)) });
  };
  build('spd2 open, even origin', 2, [6, 6]);
  build('spd3 open, odd origin', 3, [6, 7]);
  build('spd4 open, even origin', 4, [6, 6]);
  build('spd5 + wall comb', 5, [6, 6], [[5,5],[5,6],[5,7],[7,5],[7,6],[7,7],[6,4],[6,8],[4,3],[8,9]]);
  build('spd6 board-wide', 6, [7, 5]);

  const rule = FIXMODE ? fixedSides : shippedSides;
  const label = FIXMODE ? 'PROPOSED 6-side rule' : 'SHIPPED 4-side rule';

  T(`${label}: contour closes (every vertex even degree) on 5 real reachable regions`, () => {
    const rows = []; let bad = 0;
    for (const sc of scenarios) {
      const r = scoreRegion(sc.set, sc.tiles, rule);
      if (r.looseEnds) bad++;
      rows.push(`${sc.label}: ${sc.tiles.length} tiles, ${r.edges} segments, ${r.vertices} vertices, LOOSE ENDS ${r.looseEnds}`);
    }
    return { pass: bad === 0, note: rows.join('\n        ') };
  });

  // and the direct comparison of exposed-vs-traced
  T(`${label}: exposed hex sides vs sides the rule can trace`, () => {
    const rows = []; let bad = 0;
    for (const sc of scenarios) {
      let exposed = 0, traced = 0;
      for (const t of sc.tiles) {
        for (const n of hexNeighbors(t.x, t.z)) if (!sc.set.has(n.x + ',' + n.y)) exposed++;
        for (const s of rule(t.x, t.z)) if (!sc.set.has(s.nb[0] + ',' + s.nb[1])) traced++;
      }
      if (traced !== exposed) bad++;
      rows.push(`${sc.label}: exposed ${exposed}, traced ${traced}, untraced ${exposed - traced}`);
    }
    return { pass: bad === 0, note: rows.join('\n        ') };
  });

  return res;
}, FIXMODE);

let pass = 0, fail = 0;
for (const r of R) { r.pass ? pass++ : fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.note}`); }
console.log(`\nD7 LOOP (${FIXMODE ? 'PROPOSED' : 'SHIPPED'}): ${pass} pass / ${fail} fail   pageErrors ${pageErrors.length}`);
await close();
