// DRIVER 2 — the reachable AREA and the BENDING path.
//
// Builds real obstacle layouts on the live App.state, then drives the shipping
// getValidMoves() / getMovePath() and checks them against an independent BFS
// oracle written straight from HEXSPEC §5.
import { bootMatch } from './boot.mjs';

const { page, close, pageErrors } = await bootMatch();

const R = await page.evaluate(() => {
  const res = [];
  const T = (name, fn) => {
    try { const r = fn(); res.push({ name, ...r }); }
    catch (e) { res.push({ name, pass: false, note: 'THREW: ' + (e && e.message) }); }
  };
  const W = BOARD_W, H = BOARD_H, S = App.state;

  // --- helpers that reset the board to a clean slate between scenarios ---
  const clearBoard = () => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { S.board[y][x].wall = null; }
  };
  const wall = (x, y) => { S.board[y][x].wall = { hp: 99, canBePushed: false }; };
  const hero = () => S.units.find(u => u.isHero && u.owner === 'player' && u.alive);
  const key = p => p.x + ',' + p.y;

  // independent 6-way BFS oracle, offsets straight from HEXSPEC §5
  const DE = [[1,0],[-1,0],[0,-1],[-1,-1],[0,1],[-1,1]];
  const DO = [[1,0],[-1,0],[1,-1],[0,-1],[1,1],[0,1]];
  const oNb = (x, y) => ((y & 1) ? DO : DE).map(d => [x + d[0], y + d[1]]);
  const oBFS = (sx, sy, speed, blocked) => {
    const dist = new Map(); dist.set(sx + ',' + sy, 0);
    const q = [[sx, sy, 0]];
    while (q.length) {
      const [x, y, d] = q.shift();
      if (d >= speed) continue;
      for (const [nx, ny] of oNb(x, y)) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = nx + ',' + ny;
        if (dist.has(k)) continue;
        if (blocked(nx, ny)) continue;
        dist.set(k, d + 1); q.push([nx, ny, d + 1]);
      }
    }
    dist.delete(sx + ',' + sy);
    return dist;
  };

  // ================= REACHABLE AREA =================

  // R1 — open field: the reachable set is the hex disc minus the origin
  T('getValidMoves on an OPEN field is the hex disc 3N^2+3N (not the square)', () => {
    clearBoard();
    const h = hero();
    // park the hero centrally and out of everyone's way
    S.units = S.units.map(u => u.id === h.id ? { ...u, pos: { x: 6, y: 6 } } : u);
    const other = S.units.find(u => u.id !== h.id);
    if (other) S.units = S.units.map(u => u.id === other.id ? { ...u, pos: { x: 13, y: 0 } } : u);
    const hh = S.units.find(u => u.id === h.id);
    const spd = getMoveRange(hh, S.weather);
    const mv = getValidMoves(hh, S.units, S.weather, S.board);
    const want = 3 * spd * spd + 3 * spd;            // hex disc minus origin
    const sq = (2 * spd + 1) * (2 * spd + 1) - 1;    // what Chebyshev would give
    const maxd = Math.max(...mv.map(p => distance(hh.pos, p)));
    const dupes = mv.length - new Set(mv.map(key)).size;
    const oob = mv.filter(p => !inBounds(p.x, p.y)).length;
    return { pass: mv.length === want && maxd === spd && dupes === 0 && oob === 0,
      note: `spd ${spd}: got ${mv.length}, hex want ${want}, square would be ${sq}; maxDist ${maxd}, dupes ${dupes}, oob ${oob}` };
  });

  // R1b — the starter hero is spd 1, which is a weak disc. Re-run at 2..5 so
  //       the shape assertion has real teeth (a Chebyshev leak at spd 1 differs
  //       by only 2 tiles; at spd 5 it differs by 30).
  T('getValidMoves is the hex disc at spd 2,3,4,5 (open field, centred)', () => {
    clearBoard();
    const h = S.units.find(u => u.isHero && u.owner === 'player');
    const other = S.units.find(u => u.id !== h.id);
    if (other) S.units = S.units.map(u => u.id === other.id ? { ...u, pos: { x: 13, y: 0 } } : u);
    const rows = []; let ok = true;
    for (const spd of [2, 3, 4, 5]) {
      S.units = S.units.map(u => u.id === h.id ? { ...u, pos: { x: 6, y: 6 }, stats: { ...u.stats, spd } } : u);
      const hh = S.units.find(u => u.id === h.id);
      const eff = getMoveRange(hh, S.weather);
      const mv = getValidMoves(hh, S.units, S.weather, S.board);
      const want = 3 * eff * eff + 3 * eff;
      const sq = (2 * eff + 1) * (2 * eff + 1) - 1;
      const maxd = Math.max(...mv.map(p => distance(hh.pos, p)));
      if (mv.length !== want || maxd !== eff) ok = false;
      rows.push(`spd${eff}: ${mv.length}/${want} (sq ${sq}) maxD ${maxd}`);
    }
    return { pass: ok, note: rows.join(' | ') };
  });

  // R2 — the shipping set must equal the independent BFS oracle, exactly
  T('getValidMoves == independent HEXSPEC-§5 BFS oracle (open field)', () => {
    clearBoard();
    const hh = S.units.find(u => u.isHero && u.owner === 'player');
    const spd = getMoveRange(hh, S.weather);
    const occ = new Set(S.units.filter(u => u.alive && u.id !== hh.id).map(u => key(u.pos)));
    const mv = new Set(getValidMoves(hh, S.units, S.weather, S.board).map(key));
    const or = oBFS(hh.pos.x, hh.pos.y, spd, (x, y) => occ.has(x + ',' + y));
    let onlyShip = 0, onlyOracle = 0;
    for (const k of mv) if (!or.has(k)) onlyShip++;
    for (const k of or.keys()) if (!mv.has(k)) onlyOracle++;
    return { pass: onlyShip === 0 && onlyOracle === 0,
      note: `ship ${mv.size} oracle ${or.size}; ship-only ${onlyShip}, oracle-only ${onlyOracle}` };
  });

  // R3 — THE CONTOUR PRECONDITION. "One continuous contour around everywhere it
  //      can reach" is only a truthful drawing if the reachable set (plus the
  //      origin, which the renderer folds in) is a SINGLE 6-connected region.
  //      Checked on a maze, not just open ground.
  T('reachable set + origin is ONE 6-connected region (open field AND a maze)', () => {
    const runs = [];
    let allOk = true;
    for (const scenario of ['open', 'maze']) {
      clearBoard();
      if (scenario === 'maze') {
        // a comb of walls that forces the region to wrap round them
        for (const [x, y] of [[5,5],[5,6],[5,7],[7,5],[7,6],[7,7],[6,4],[6,8]]) wall(x, y);
      }
      const h0 = S.units.find(u => u.isHero && u.owner === 'player');
      S.units = S.units.map(u => u.id === h0.id ? { ...u, pos: { x: 6, y: 6 }, stats: { ...u.stats, spd: 5 } } : u);
      const hh = S.units.find(u => u.isHero && u.owner === 'player');
      const mv = getValidMoves(hh, S.units, S.weather, S.board);
      const set = new Set(mv.map(key)); set.add(key(hh.pos));
      // flood the set with the shipping hexNeighbors
      const seen = new Set([key(hh.pos)]); const st = [hh.pos];
      while (st.length) {
        const p = st.pop();
        for (const n of hexNeighbors(p.x, p.y)) {
          const k = key(n);
          if (set.has(k) && !seen.has(k)) { seen.add(k); st.push(n); }
        }
      }
      const ok = seen.size === set.size;
      allOk = allOk && ok;
      runs.push(`${scenario}: region ${set.size}, connected ${seen.size}${ok ? '' : ' ← SPLIT'}`);
    }
    return { pass: allOk, note: runs.join(' | ') };
  });

  // R4 — walls and bodies are never offered
  T('getValidMoves never offers a wall tile or an occupied tile', () => {
    clearBoard();
    const hh = S.units.find(u => u.isHero && u.owner === 'player');
    for (const n of hexNeighbors(hh.pos.x, hh.pos.y)) if (inBounds(n.x, n.y)) wall(n.x, n.y);
    const mv = getValidMoves(hh, S.units, S.weather, S.board);
    const onWall = mv.filter(p => S.board[p.y][p.x].wall).length;
    const onUnit = mv.filter(p => getOccupant(p, S.units)).length;
    clearBoard();
    return { pass: onWall === 0 && onUnit === 0 && mv.length === 0,
      note: `fully walled in: ${mv.length} tiles offered (want 0), onWall ${onWall}, onUnit ${onUnit}` };
  });

  // ================= THE BENDING PATH =================

  // P1 — every step of getMovePath is a TRUE hex neighbour, never a diagonal
  T('getMovePath: every consecutive pair is a real hex neighbour (12 random targets, open)', () => {
    clearBoard();
    const hh = S.units.find(u => u.isHero && u.owner === 'player');
    let bad = 0, n = 0, worst = null;
    const mv = getValidMoves(hh, S.units, S.weather, S.board);
    for (const t of mv.slice(0, 40)) {
      const p = getMovePath(hh, S.units, S.weather, t);
      if (!p.length) continue;
      n++;
      let cur = hh.pos;
      for (const step of p) {
        if (distance(cur, step) !== 1) { bad++; if (!worst) worst = `${cur.x},${cur.y}->${step.x},${step.y}`; }
        cur = step;
      }
    }
    return { pass: bad === 0, note: `${n} routes, ${bad} non-neighbour steps${worst ? ' e.g. ' + worst : ''}` };
  });

  // P2 — THE HEADLINE. A wall between the unit and its destination must make
  //      the route BEND: longer than the hex distance, and touching no wall.
  T('getMovePath BENDS around a wall (does not cut straight through)', () => {
    clearBoard();
    const hh0 = S.units.find(u => u.isHero && u.owner === 'player');
    S.units = S.units.map(u => u.id === hh0.id ? { ...u, pos: { x: 6, y: 9 } } : u);
    const other = S.units.find(u => u.id !== hh0.id);
    if (other) S.units = S.units.map(u => u.id === other.id ? { ...u, pos: { x: 0, y: 0 } } : u);
    const hh = S.units.find(u => u.id === hh0.id);
    // a wall across the whole of row 7 except one gap at x=1 — the only way
    // north is a long detour west. Give the hero the speed to make it.
    for (let x = 0; x < W; x++) if (x !== 1) wall(x, 7);
    S.units = S.units.map(u => u.id === hh.id ? { ...u, stats: { ...u.stats, spd: 20 } } : u);
    const h2 = S.units.find(u => u.id === hh.id);
    const target = { x: 6, y: 5 };
    const p = getMovePath(h2, S.units, S.weather, target);
    const straight = distance(h2.pos, target);
    const hitsWall = p.filter(s => S.board[s.y][s.x].wall).length;
    const arrives = p.length && p[p.length - 1].x === target.x && p[p.length - 1].y === target.y;
    let stepsOk = true; let cur = h2.pos;
    for (const s of p) { if (distance(cur, s) !== 1) stepsOk = false; cur = s; }
    // the oracle's own shortest route through the same maze
    const or = oBFS(h2.pos.x, h2.pos.y, 40, (x, y) => !!S.board[y][x].wall);
    const optimal = or.get(target.x + ',' + target.y);
    const route = [`${h2.pos.x},${h2.pos.y}`].concat(p.map(key)).join(' → ');
    clearBoard();
    return { pass: arrives && hitsWall === 0 && p.length > straight && stepsOk && p.length === optimal,
      note: `hexDistance ${straight}, route ${p.length} steps (oracle optimum ${optimal}), wallTiles ${hitsWall}, arrives ${arrives}, allStepsNeighbours ${stepsOk}\n        ${route}` };
  });

  // P3 — the same, around a wall of BODIES rather than walls
  T('getMovePath BENDS around a wall of BODIES', () => {
    clearBoard();
    const hh0 = S.units.find(u => u.isHero && u.owner === 'player');
    S.units = S.units.map(u => u.id === hh0.id ? { ...u, pos: { x: 6, y: 9 }, stats: { ...u.stats, spd: 20 } } : u);
    const base = S.units.find(u => !u.isHero) || S.units.find(u => u.id !== hh0.id);
    // synthesise a row of bodies across row 7, gap at x=11
    const bodies = [];
    for (let x = 0; x < W; x++) if (x !== 11)
      bodies.push({ ...base, id: 90000 + x, isHero: false, alive: true, owner: 'ai', pos: { x, y: 7 } });
    const saved = S.units;
    S.units = S.units.filter(u => u.isHero && u.owner === 'player').concat(bodies);
    const h2 = S.units.find(u => u.isHero);
    const target = { x: 6, y: 5 };
    const p = getMovePath(h2, S.units, S.weather, target);
    const straight = distance(h2.pos, target);
    const onBody = p.filter(s => bodies.some(b => b.pos.x === s.x && b.pos.y === s.y)).length;
    const arrives = p.length && p[p.length - 1].x === target.x && p[p.length - 1].y === target.y;
    const route = [`${h2.pos.x},${h2.pos.y}`].concat(p.map(key)).join(' → ');
    S.units = saved;
    return { pass: arrives && onBody === 0 && p.length > straight,
      note: `hexDistance ${straight}, route ${p.length} steps, stepsOnABody ${onBody}, arrives ${arrives}\n        ${route}` };
  });

  // P4 — the path BFS and the highlight BFS must agree about the lattice
  //      (CONTRACT R31: two near-duplicate BFS bodies).
  T('every getValidMoves tile is reachable by getMovePath in <= speed steps', () => {
    clearBoard();
    for (const [x, y] of [[5,5],[5,6],[5,7],[7,5],[7,6],[7,7],[6,4]]) wall(x, y);
    const hh = S.units.find(u => u.isHero && u.owner === 'player');
    const spd = getMoveRange(hh, S.weather);
    const mv = getValidMoves(hh, S.units, S.weather, S.board);
    let noPath = 0, tooLong = 0, wrongEnd = 0;
    for (const t of mv) {
      const p = getMovePath(hh, S.units, S.weather, t);
      if (!p.length) { noPath++; continue; }
      if (p.length > spd) tooLong++;
      const e = p[p.length - 1];
      if (e.x !== t.x || e.y !== t.y) wrongEnd++;
    }
    clearBoard();
    return { pass: noPath === 0 && tooLong === 0 && wrongEnd === 0,
      note: `${mv.length} highlighted tiles: noPath ${noPath}, longerThanSpeed ${tooLong}, wrongEndpoint ${wrongEnd}` };
  });

  return res;
});

let pass = 0, fail = 0;
for (const r of R) { r.pass ? pass++ : fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.note}`); }
console.log(`\nD2 REACH+PATH: ${pass} pass / ${fail} fail   pageErrors ${pageErrors.length}`);
if (pageErrors.length) console.log(pageErrors.slice(0, 5));
await close();
