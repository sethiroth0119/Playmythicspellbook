// DRIVER 1 — HEXSPEC §1/§2/§5/§6: the metric, the lattice, the six neighbours,
// and the direction primitive. Exhaustive where exhaustive is affordable.
//
// Everything here calls the SHIPPING function by bare identifier inside the
// real page. Nothing is reimplemented in this file except the independent
// oracles (cube maths written straight from HEXSPEC) that the shipping
// functions are checked AGAINST — that is the whole point of the file.
import { bootMatch } from './boot.mjs';

const { page, close, pageErrors } = await bootMatch();

const R = await page.evaluate(() => {
  const res = [];
  const T = (name, fn) => {
    try { const r = fn(); res.push({ name, ...r }); }
    catch (e) { res.push({ name, pass: false, note: 'THREW: ' + (e && e.message) }); }
  };
  const W = BOARD_W, H = BOARD_H;
  const all = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) all.push({ x, y });

  // ---- independent oracle, written from HEXSPEC §6, not from the app ----
  const oCube = (x, y) => { const cx = x - ((y - (y & 1)) / 2); return [cx, -cx - y, y]; };
  const oDist = (a, b) => { const A = oCube(a.x, a.y), B = oCube(b.x, b.y);
    return (Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2])) / 2; };

  // 1. cube invariant x+y+z===0, including negative rows (ring scans probe them)
  T('offsetToCube: x+y+z===0 over 168 tiles + off-board rows -3..14', () => {
    let bad = 0, n = 0;
    for (let y = -3; y < H + 3; y++) for (let x = -3; x < W + 3; x++) {
      const c = offsetToCube(x, y); n++;
      if (Math.abs(c.x + c.y + c.z) > 1e-12) bad++;
    }
    return { pass: bad === 0, note: `${n} samples, ${bad} violations` };
  });

  // 2. distance agrees with the independent oracle on every ordered pair
  T('distance == HEXSPEC cube oracle over all 28,224 ordered pairs', () => {
    let bad = 0, n = 0, worst = null;
    for (const a of all) for (const b of all) {
      n++; const d = distance(a, b), o = oDist(a, b);
      if (d !== o) { bad++; if (!worst) worst = `${a.x},${a.y}->${b.x},${b.y} got ${d} want ${o}`; }
    }
    return { pass: bad === 0, note: `${n} pairs, ${bad} mismatches${worst ? ' e.g. ' + worst : ''}` };
  });

  // 3. symmetry + identity
  T('distance symmetric and distance(a,a)===0', () => {
    let asym = 0, selfBad = 0;
    for (const a of all) { if (distance(a, a) !== 0) selfBad++;
      for (const b of all) if (distance(a, b) !== distance(b, a)) asym++; }
    return { pass: asym === 0 && selfBad === 0, note: `asymmetries ${asym}, self!=0 ${selfBad}` };
  });

  // 4. triangle inequality over a large random sample of triples
  T('distance triangle inequality (200k random triples)', () => {
    let bad = 0;
    const pick = () => all[(Math.random() * all.length) | 0];
    for (let i = 0; i < 200000; i++) {
      const a = pick(), b = pick(), c = pick();
      if (distance(a, c) > distance(a, b) + distance(b, c)) bad++;
    }
    return { pass: bad === 0, note: `${bad} violations / 200000` };
  });

  // 5. hexNeighbors: exactly 6, distinct, all at distance 1, and reciprocal
  T('hexNeighbors: 6 distinct, all at distance 1, reciprocal', () => {
    let cnt = 0, notSix = 0, dup = 0, notOne = 0, notRecip = 0;
    for (const a of all) {
      const ns = hexNeighbors(a.x, a.y); cnt += ns.length;
      if (ns.length !== 6) notSix++;
      const seen = new Set(ns.map(n => n.x + ',' + n.y));
      if (seen.size !== 6) dup++;
      for (const n of ns) {
        if (distance(a, n) !== 1) notOne++;
        const back = hexNeighbors(n.x, n.y);
        if (!back.some(b => b.x === a.x && b.y === a.y)) notRecip++;
      }
    }
    return { pass: notSix === 0 && dup === 0 && notOne === 0 && notRecip === 0,
      note: `${cnt} neighbours; notSix ${notSix}, dup ${dup}, dist!=1 ${notOne}, non-reciprocal ${notRecip}` };
  });

  // 6. THE CONVERSE, which is the half that catches an eight-way leak: every
  //    tile at distance 1 must BE one of the six. If any code path could see a
  //    diagonal, distance() would have to call it adjacent.
  T('exactly 6 tiles at distance 1 from every tile (no diagonals exist)', () => {
    let bad = 0, worst = null;
    for (const a of all) {
      const ring = [];
      for (let y = a.y - 2; y <= a.y + 2; y++) for (let x = a.x - 2; x <= a.x + 2; x++) {
        if (x === a.x && y === a.y) continue;
        if (distance(a, { x, y }) === 1) ring.push(x + ',' + y);
      }
      const six = new Set(hexNeighbors(a.x, a.y).map(n => n.x + ',' + n.y));
      if (ring.length !== 6 || ring.some(k => !six.has(k))) { bad++; if (!worst) worst = `${a.x},${a.y} -> ${ring.join('|')}`; }
    }
    return { pass: bad === 0, note: `${bad} tiles disagree${worst ? ' e.g. ' + worst : ''}` };
  });

  // 7. ring size 6N — the signature of a hex lattice (a square lattice gives 8N)
  T('ring at distance N has exactly 6N tiles (N=1..5, unbounded lattice)', () => {
    const o = { x: 20, y: 20 }; // far from any edge so nothing is clipped
    const got = [];
    for (let N = 1; N <= 5; N++) {
      let c = 0;
      for (let y = o.y - N - 2; y <= o.y + N + 2; y++)
        for (let x = o.x - N - 2; x <= o.x + N + 2; x++)
          if (distance(o, { x, y }) === N) c++;
      got.push(c);
    }
    const want = [6, 12, 18, 24, 30];
    return { pass: got.join() === want.join(), note: `got ${got.join('/')} want ${want.join('/')}` };
  });

  // 8. HEX_DIRS_EVEN[i] and HEX_DIRS_ODD[i] must be the SAME cube direction at
  //    the SAME index. The shove primitive's correctness rests entirely on this
  //    claim (the source comment says so); nothing else in the tree tests it.
  T('HEX_DIRS_EVEN[i] and HEX_DIRS_ODD[i] are the same cube direction', () => {
    const cubeOf = (x, y, d) => {
      const A = oCube(x, y), B = oCube(x + d[0], y + d[1]);
      return [B[0] - A[0], B[1] - A[1], B[2] - A[2]].join(',');
    };
    const rows = [];
    let bad = 0;
    for (let i = 0; i < 6; i++) {
      const e = cubeOf(4, 4, HEX_DIRS_EVEN[i]);   // even row
      const o = cubeOf(4, 5, HEX_DIRS_ODD[i]);    // odd row
      rows.push(`i${i} even[${e}] odd[${o}]`);
      if (e !== o) bad++;
    }
    return { pass: bad === 0, note: `${bad} index mismatches | ${rows.join(' ')}` };
  });

  // 9. hexDirs returns the right half by parity, for every row on the board
  T('hexDirs(y) picks ODD table iff y is odd, all rows', () => {
    let bad = 0;
    for (let y = 0; y < H; y++) {
      const want = (y & 1) ? HEX_DIRS_ODD : HEX_DIRS_EVEN;
      if (hexDirs(y) !== want) bad++;
    }
    return { pass: bad === 0, note: `${bad}/${H} rows wrong` };
  });

  // 10. hexStep: one step is always exactly one hex, from every tile, every dir
  T('hexStep(x,y,i) always lands exactly 1 hex away (168x6)', () => {
    let bad = 0, n = 0;
    for (const a of all) for (let i = 0; i < 6; i++) {
      const s = hexStep(a.x, a.y, i); n++;
      if (distance(a, { x: s.x, y: s.y }) !== 1) bad++;
    }
    return { pass: bad === 0, note: `${n} steps, ${bad} not-1-hex` };
  });

  // 11. THE RAY. Repeating the same direction INDEX must stay a straight hex
  //     line: each step 1 hex, and total distance == number of steps. This is
  //     the exact bug the merge inherited from OPEN-BREAKS §1 (a repeated
  //     offset PAIR zigzags on a staggered lattice).
  T('repeated hexStep with a fixed index is a straight ray (4 steps, all tiles, all dirs)', () => {
    let bad = 0, n = 0, worst = null;
    for (const a of all) for (let i = 0; i < 6; i++) {
      let cx = a.x, cy = a.y, ok = true;
      for (let k = 1; k <= 4; k++) {
        const s = hexStep(cx, cy, i);
        if (distance({ x: cx, y: cy }, s) !== 1) ok = false;
        cx = s.x; cy = s.y;
        if (distance(a, { x: cx, y: cy }) !== k) ok = false;
      }
      n++;
      if (!ok) { bad++; if (!worst) worst = `${a.x},${a.y} dir${i}`; }
    }
    return { pass: bad === 0, note: `${n} rays, ${bad} bent${worst ? ' e.g. ' + worst : ''}` };
  });

  // 12. hexDirToward answers only 0..5, never -1 for distinct tiles, and the
  //     away-step lands exactly one hex — over EVERY ordered pair on the board.
  T('hexDirToward: 0..5 for all 28,056 distinct ordered pairs; step is 1 hex', () => {
    let bad = 0, noDir = 0, n = 0; const used = new Set();
    for (const a of all) for (const b of all) {
      if (a.x === b.x && a.y === b.y) continue;
      n++;
      const d = hexDirToward(a.x, a.y, b.x, b.y);
      if (d < 0 || d > 5) { noDir++; continue; }
      used.add(d);
      const s = hexStep(a.x, a.y, d);
      if (distance(a, { x: s.x, y: s.y }) !== 1) bad++;
    }
    return { pass: bad === 0 && noDir === 0 && used.size === 6,
      note: `${n} pairs, outOfRange ${noDir}, badStep ${bad}, distinct dirs used ${used.size}` };
  });

  // 13. hexDirToward on a SAME tile must be -1 (callers must skip, not step 0)
  T('hexDirToward(a,a) === -1', () => {
    let bad = 0;
    for (const a of all) if (hexDirToward(a.x, a.y, a.x, a.y) !== -1) bad++;
    return { pass: bad === 0, note: `${bad}/168 did not return -1` };
  });

  // 14. hexDirToward is EXACT on a true hex neighbour: the direction it picks
  //     must be the index that actually reaches that neighbour.
  T('hexDirToward onto a real neighbour returns the index that reaches it', () => {
    let bad = 0, n = 0;
    for (const a of all) for (let i = 0; i < 6; i++) {
      const nb = hexStep(a.x, a.y, i); n++;
      const d = hexDirToward(a.x, a.y, nb.x, nb.y);
      const s = hexStep(a.x, a.y, d);
      if (s.x !== nb.x || s.y !== nb.y) bad++;
    }
    return { pass: bad === 0, note: `${n} neighbours, ${bad} wrong direction` };
  });

  // 15. tilesWithinRange is the hex disc, not the square (2N+1)^2.
  //     ⚠ IT EXCLUDES THE ORIGIN BY DESIGN (`if (dx===0 && dy===0) continue`),
  //     so the count is 3N²+3N, not 3N²+3N+1. An earlier revision of this driver
  //     asserted the +1 and scored a FAIL against correct code — the expectation
  //     was wrong, not the function.
  T('tilesWithinRange is the hex disc MINUS the origin (3N^2+3N), never the square', () => {
    const o = { x: 6, y: 6 }; const got = [], want = [], sq = [];
    for (let N = 1; N <= 3; N++) {
      got.push(tilesWithinRange(o, N).length);
      want.push(3 * N * N + 3 * N);
      sq.push((2 * N + 1) * (2 * N + 1) - 1);
    }
    let outside = 0, dupes = 0;
    for (let N = 1; N <= 3; N++) {
      const t = tilesWithinRange(o, N);
      dupes += t.length - new Set(t.map(p => p.x + ',' + p.y)).size;
      for (const p of t) if (distance(o, p) > N || !inBounds(p.x, p.y)) outside++;
    }
    return { pass: got.join() === want.join() && outside === 0 && dupes === 0,
      note: `got ${got.join('/')} want ${want.join('/')} (Chebyshev would give ${sq.join('/')}), outside ${outside}, dupes ${dupes}` };
  });

  // 15b. COMPLETENESS. tilesWithinRange enumerates a SQUARE box (cx±r, cy±r)
  //      and lets distance() carve the disc out of it. That is only safe if the
  //      box is a superset of the hex disc on a staggered lattice — check it,
  //      because a clipped disc is a range check that silently under-reaches.
  T('the square enumerator box is a superset of the hex disc (no clipping) r=1..5', () => {
    let missing = 0, n = 0, worst = null;
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      for (let r = 1; r <= 5; r++) {
        const box = new Set();
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) box.add(x + ',' + y);
        // brute-force the true disc from a much wider window
        for (let y = cy - r - 4; y <= cy + r + 4; y++) for (let x = cx - r - 4; x <= cx + r + 4; x++) {
          if (distance({ x: cx, y: cy }, { x, y }) > r) continue;
          n++;
          if (!box.has(x + ',' + y)) { missing++; if (!worst) worst = `centre ${cx},${cy} r${r} misses ${x},${y}`; }
        }
      }
    }
    return { pass: missing === 0, note: `${n} disc tiles checked over all 168 centres x r=1..5, ${missing} outside the enumerator box${worst ? ' e.g. ' + worst : ''}` };
  });

  // 16. HEXSPEC §3/§4 round trip on the GAME side's own world helpers
  T('HEXSPEC §3 world helpers _HEX_WX/_HEX_WZ match the spec formula', () => {
    let bad = 0; const S = 1, HEXW = S * Math.sqrt(3), HEXV = S * 1.5;
    for (const a of all) {
      const wx = _HEX_WX(a.x, a.y), wz = _HEX_WZ(a.y);
      if (Math.abs(wx - (a.x + (a.y & 1) * 0.5) * HEXW) > 1e-9) bad++;
      if (Math.abs(wz - a.y * HEXV) > 1e-9) bad++;
    }
    return { pass: bad === 0, note: `${bad} deviations over 168 tiles` };
  });

  // 17. §4 inverse by cube rounding — the round trip the spec DEMANDS the
  //     commit contain. Run it against the game-side world formula.
  T('HEXSPEC §4 inverse(worldX,worldZ) round-trips every tile (cube rounding)', () => {
    const S = 1;
    const inv = (wx, wz) => {
      const q = (Math.sqrt(3) / 3 * wx - wz / 3) / S;
      const r = (2 / 3 * wz) / S;
      let x = q, z = r, y = -x - z;
      let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
      const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
      if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
      return { x: rx + (rz - (rz & 1)) / 2, y: rz };
    };
    let bad = 0, jitterBad = 0;
    for (const a of all) {
      const wx = _HEX_WX(a.x, a.y), wz = _HEX_WZ(a.y);
      const b = inv(wx, wz);
      if (b.x !== a.x || b.y !== a.y) bad++;
      // and jittered 40% of the way to each vertex must still answer the same tile
      for (let k = 0; k < 6; k++) {
        const ang = k * Math.PI / 3 - Math.PI / 6;
        const j = inv(wx + Math.cos(ang) * 0.4, wz + Math.sin(ang) * 0.4);
        if (j.x !== a.x || j.y !== a.y) jitterBad++;
      }
    }
    return { pass: bad === 0 && jitterBad === 0, note: `centres wrong ${bad}/168, jittered wrong ${jitterBad}/1008` };
  });

  return res;
});

let pass = 0, fail = 0;
for (const r of R) { r.pass ? pass++ : fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.note}`); }
console.log(`\nD1 METRIC: ${pass} pass / ${fail} fail   pageErrors ${pageErrors.length}`);
if (pageErrors.length) console.log(pageErrors.slice(0, 5));
await close();
