// DRIVER 3 — SIX-DIRECTION BEHAVIOUR for the abilities that shove, pull and
// hit an area. Every case drives the REAL resolver (executeMove /
// applyOnPlayEffect / _slideOnIce) against the live App.state and reads the
// unit's position back out of the returned state.
import { bootMatch } from './boot.mjs';

const { page, close, pageErrors } = await bootMatch();

const R = await page.evaluate(() => {
  const res = [];
  const T = (name, fn) => {
    try { const r = fn(); res.push({ name, ...r }); }
    catch (e) { res.push({ name, pass: false, note: 'THREW: ' + (e && e.message) }); }
  };
  const W = BOARD_W, H = BOARD_H;

  // A throwaway state built from the live one, so the resolvers see a real
  // board object with real tiles.
  const mkState = (units) => {
    const s = JSON.parse(JSON.stringify(App.state));
    s.units = units;
    // ⚠ SURFACES LIVE ON THE TILE, not on a state.surfaces map (_setSurface,
    // index.html: `state.board[y][x].surface`). Clearing `s.surfaces` looks
    // right and clears nothing — the live match's leftover ice then slides the
    // shove targets and scores a false FAIL. Found by driving, not by reading.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { s.board[y][x].wall = null; delete s.board[y][x].surface; }
    s.tombstones = [];
    s.log = [];
    return s;
  };
  const proto = JSON.parse(JSON.stringify(App.state.units.find(u => u.isHero)));
  const mkUnit = (id, owner, x, y, extra) => Object.assign(
    JSON.parse(JSON.stringify(proto)),
    { id, owner, isHero: false, alive: true, pos: { x, y }, currentHp: 9999,
      stats: { ...proto.stats, hp: 9999, atk: 0, def: 999, mag: 0, res: 999 },
      statusEffects: [], knownMoves: ['slash'] }, extra || {});

  const posOf = (s, id) => { const u = s.units.find(v => v.id === id); return u && u.pos; };

  // ============ 1. KNOCKBACK — every direction, every parity ============
  // The attacker is placed on each of the target's six neighbours in turn, so
  // the shove is asked to resolve all six directions from BOTH row parities.
  T('move.knockback 1 tile: 12 attacker positions (6 dirs x 2 parities) land exactly 1 hex, on the true neighbour', () => {
    let bad = 0, n = 0, notNeighbour = 0, rows = [];
    for (const ty of [6, 7]) {                       // even row, odd row
      const tx = 6;
      for (let i = 0; i < 6; i++) {
        // attacker on neighbour i; the away direction is therefore the opposite
        const a = hexStep(tx, ty, i);
        if (!inBounds(a.x, a.y)) continue;
        const A = mkUnit(1, 'player', a.x, a.y);
        const B = mkUnit(2, 'ai', tx, ty);
        const s = mkState([A, B]);
        const mv = { id: 'shovetest', name: 'Shove', kind: 'attack', type: 'physical',
                     power: 0, range: 1, cost: 0, knockback: 1, knockbackChance: 100 };
        const out = executeMove(s, A, B, mv);
        const p = posOf(out, 2); n++;
        const d = distance({ x: tx, y: ty }, p);
        if (d !== 1) { bad++; rows.push(`row${ty} dir${i} moved ${d} hexes`); }
        // and it must be the tile directly AWAY from the attacker
        const away = hexDirToward(a.x, a.y, tx, ty);
        const want = hexStep(tx, ty, away);
        if (p.x !== want.x || p.y !== want.y) { notNeighbour++; rows.push(`row${ty} dir${i} landed ${p.x},${p.y} want ${want.x},${want.y}`); }
      }
    }
    return { pass: bad === 0 && notNeighbour === 0 && n === 12,
      note: `${n} shoves; movedMoreThan1Hex ${bad}, wrongTile ${notNeighbour}${rows.length ? ' | ' + rows.slice(0,4).join('; ') : ''}` };
  });

  // 2. A MULTI-TILE shove must be a STRAIGHT HEX RAY, not a zigzag. This is the
  //    exact OPEN-BREAKS §1 failure: a repeated offset pair walks off the line
  //    and passes THROUGH an occupied tile.
  T('move.knockback 3 tiles is a straight hex ray from every start row parity', () => {
    let bad = 0, n = 0, rows = [];
    for (const ty of [5, 6]) for (let i = 0; i < 6; i++) {
      const tx = 6;
      const a = hexStep(tx, ty, i);
      if (!inBounds(a.x, a.y)) continue;
      const away = hexDirToward(a.x, a.y, tx, ty);
      // the ray we EXPECT, walked with per-step parity
      let ex = { x: tx, y: ty }, expected = ex, blocked = false;
      for (let k = 0; k < 3; k++) { const nx = hexStep(ex.x, ex.y, away); if (!inBounds(nx.x, nx.y)) { blocked = true; break; } ex = nx; }
      if (blocked) continue;
      expected = ex;
      const A = mkUnit(1, 'player', a.x, a.y);
      const B = mkUnit(2, 'ai', tx, ty);
      const s = mkState([A, B]);
      const out = executeMove(s, A, B, { id: 'k3', name: 'K3', kind: 'attack', type: 'physical',
        power: 0, range: 1, cost: 0, knockback: 3, knockbackChance: 100 });
      const p = posOf(out, 2); n++;
      const d = distance({ x: tx, y: ty }, p);
      if (d !== 3 || p.x !== expected.x || p.y !== expected.y) {
        bad++; rows.push(`row${ty} dir${i}: landed ${p.x},${p.y} d${d} want ${expected.x},${expected.y}`);
      }
    }
    return { pass: bad === 0, note: `${n} 3-tile shoves, ${bad} off the ray${rows.length ? ' | ' + rows.slice(0,3).join('; ') : ''}` };
  });

  // 3. THE TEETH. A blocker standing on the true hex neighbour must STOP the
  //    shove. If the walk ever leaves the hex line it steps past the blocker.
  T('a body on the true hex neighbour STOPS a 3-tile shove (no walking through)', () => {
    let leaked = 0, n = 0, rows = [];
    for (const ty of [5, 6]) for (let i = 0; i < 6; i++) {
      const tx = 6;
      const a = hexStep(tx, ty, i); if (!inBounds(a.x, a.y)) continue;
      const away = hexDirToward(a.x, a.y, tx, ty);
      const blockTile = hexStep(tx, ty, away);
      if (!inBounds(blockTile.x, blockTile.y)) continue;
      const A = mkUnit(1, 'player', a.x, a.y);
      const B = mkUnit(2, 'ai', tx, ty);
      const C = mkUnit(3, 'ai', blockTile.x, blockTile.y);
      const s = mkState([A, B, C]);
      const out = executeMove(s, A, B, { id: 'k3b', name: 'K3B', kind: 'attack', type: 'physical',
        power: 0, range: 1, cost: 0, knockback: 3, knockbackChance: 100 });
      const p = posOf(out, 2); n++;
      if (p.x !== tx || p.y !== ty) { leaked++; rows.push(`row${ty} dir${i}: moved to ${p.x},${p.y} past the blocker at ${blockTile.x},${blockTile.y}`); }
    }
    return { pass: leaked === 0, note: `${n} blocked shoves, ${leaked} walked through the blocker${rows.length ? ' | ' + rows.slice(0,3).join('; ') : ''}` };
  });

  // 4. PULL — mirror of the above, toward the attacker
  T('move.pull 2 tiles travels the hex line TOWARD the attacker and never lands on it', () => {
    let bad = 0, onAttacker = 0, n = 0, rows = [];
    for (const ty of [5, 6]) for (const ax of [1, 11]) {
      const tx = 6;
      const A = mkUnit(1, 'player', ax, ty);
      const B = mkUnit(2, 'ai', tx, ty);
      const s = mkState([A, B]);
      const out = executeMove(s, A, B, { id: 'p2', name: 'P2', kind: 'attack', type: 'physical',
        power: 0, range: 9, cost: 0, pull: 2, pullChance: 100 });
      const p = posOf(out, 2); n++;
      const before = distance({ x: ax, y: ty }, { x: tx, y: ty });
      const after = distance({ x: ax, y: ty }, p);
      const dir = hexDirToward(tx, ty, ax, ty);
      let ex = { x: tx, y: ty }; for (let k = 0; k < 2; k++) ex = hexStep(ex.x, ex.y, dir);
      if (p.x === ax && p.y === ty) onAttacker++;
      if (after !== before - 2 || p.x !== ex.x || p.y !== ex.y) { bad++; rows.push(`row${ty} ax${ax}: ${tx},${ty}->${p.x},${p.y} (want ${ex.x},${ex.y})`); }
    }
    return { pass: bad === 0 && onAttacker === 0, note: `${n} pulls, ${bad} off the line, ${onAttacker} landed on the attacker${rows.length ? ' | ' + rows.join('; ') : ''}` };
  });

  // 5. VORTEX / SHOCKWAVE — the AOE displacement copy (a SECOND implementation)
  T('pushUnits (Shockwave) shoves every target along a real hex ray, 6 dirs, both parities', () => {
    const rows = []; let bad = 0, n = 0;
    for (const oy of [5, 6]) {
      const ox = 6;
      const caster = mkUnit(1, 'player', ox, oy);
      const targets = [];
      for (let i = 0; i < 6; i++) { const t = hexStep(ox, oy, i); if (inBounds(t.x, t.y)) targets.push(mkUnit(10 + i, 'ai', t.x, t.y)); }
      const s = mkState([caster].concat(targets));
      const out = applyOnPlayEffect(s, caster,
        { id: 'sw', name: 'Shockwave', type: 'spell', onPlay: { type: 'pushUnits', radius: 3, tSide: 'enemy', amount: 2 } });
      for (const t of targets) {
        const p = posOf(out, t.id); n++;
        const dir = hexDirToward(ox, oy, t.pos.x, t.pos.y);
        let ex = { x: t.pos.x, y: t.pos.y }, ok = true;
        for (let k = 0; k < 2; k++) { const nx = hexStep(ex.x, ex.y, dir); if (!inBounds(nx.x, nx.y)) { ok = false; break; } ex = nx; }
        if (!ok) continue;                       // ran off the board — legitimately short
        if (p.x !== ex.x || p.y !== ex.y) { bad++; rows.push(`row${oy} ${t.pos.x},${t.pos.y}->${p.x},${p.y} want ${ex.x},${ex.y}`); }
      }
    }
    return { pass: bad === 0, note: `${n} shockwave targets, ${bad} off the hex ray${rows.length ? ' | ' + rows.slice(0,4).join('; ') : ''}` };
  });

  T('pullUnits (Vortex) drags every target along a real hex ray and never onto the caster', () => {
    const rows = []; let bad = 0, onCaster = 0, n = 0;
    for (const oy of [5, 6]) {
      const ox = 6;
      const caster = mkUnit(1, 'player', ox, oy);
      const targets = [];
      for (let i = 0; i < 6; i++) {
        let t = { x: ox, y: oy };
        for (let k = 0; k < 3; k++) t = hexStep(t.x, t.y, i);
        if (inBounds(t.x, t.y)) targets.push(mkUnit(20 + i, 'ai', t.x, t.y));
      }
      const s = mkState([caster].concat(targets));
      const out = applyOnPlayEffect(s, caster,
        { id: 'vx', name: 'Vortex', type: 'spell', onPlay: { type: 'pullUnits', radius: 4, tSide: 'enemy', amount: 2 } });
      for (const t of targets) {
        const p = posOf(out, t.id); n++;
        if (p.x === ox && p.y === oy) { onCaster++; continue; }
        const dir = hexDirToward(t.pos.x, t.pos.y, ox, oy);
        let ex = { x: t.pos.x, y: t.pos.y };
        for (let k = 0; k < 2; k++) ex = hexStep(ex.x, ex.y, dir);
        if (p.x !== ex.x || p.y !== ex.y) { bad++; rows.push(`row${oy} ${t.pos.x},${t.pos.y}->${p.x},${p.y} want ${ex.x},${ex.y}`); }
      }
    }
    return { pass: bad === 0 && onCaster === 0, note: `${n} vortex targets, ${bad} off the hex ray, ${onCaster} landed on the caster${rows.length ? ' | ' + rows.slice(0,4).join('; ') : ''}` };
  });

  // 6. ICE SLIDE — carries the same direction index, per-step parity
  T('_slideOnIce skids along the hex ray and refuses a non-index direction', () => {
    const rows = []; let bad = 0, n = 0;
    for (const sy of [5, 6]) for (let i = 0; i < 6; i++) {
      const sx = 6;
      const s = mkState([]);
      // lay ice on the 3 tiles along direction i
      let c = { x: sx, y: sy }; const lane = [{ x: sx, y: sy }];
      let ok = true;
      for (let k = 0; k < 3; k++) { const nx = hexStep(c.x, c.y, i); if (!inBounds(nx.x, nx.y)) { ok = false; break; } c = nx; lane.push({ ...c }); }
      if (!ok) continue;
      for (const t of lane) _setSurface(s, t.x, t.y, 'ice', 5);
      const r = _slideOnIce(s, sx, sy, i); n++;
      // it should skid to the last ice tile (it stops when it steps off ice)
      const last = lane[lane.length - 1];
      const allNeighbour = r.tiles.every((t, k) => distance(k === 0 ? { x: sx, y: sy } : r.tiles[k - 1], t) === 1);
      if (!allNeighbour || distance({ x: sx, y: sy }, { x: r.x, y: r.y }) !== r.steps) {
        bad++; rows.push(`row${sy} dir${i}: ${r.steps} steps to ${r.x},${r.y}`);
      }
    }
    // the hardened guard: an old-style (dx,dy) offset pair must be refused
    const guard = _slideOnIce(mkState([]), 6, 6, -1);
    const guard2 = _slideOnIce(mkState([]), 6, 6, 9);
    const guardOk = guard.steps === 0 && guard2.steps === 0;
    return { pass: bad === 0 && guardOk, note: `${n} slides, ${bad} off the ray; out-of-range dir refused ${guardOk}${rows.length ? ' | ' + rows.slice(0,3).join('; ') : ''}` };
  });

  // ============ 7. AREA effects use the hex disc, not a square box ============
  T('move.aoeRadius splash hits the hex disc (r=1 -> 6 neighbours, r=2 -> 18), not 8/24', () => {
    const rows = []; let ok = true;
    for (const r of [1, 2]) for (const ay of [5, 6]) {
      const ax = 6;
      const A = mkUnit(1, 'player', ax, ay, { stats: { ...proto.stats, atk: 500, hp: 9999 } });
      // ring every tile within square radius r of the attacker with a victim,
      // so the splash has both hex-disc AND square-only candidates to choose from
      const victims = []; let id = 100;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (!dx && !dy) continue;
        const x = ax + dx, y = ay + dy;
        if (!inBounds(x, y)) continue;
        victims.push(mkUnit(id++, 'ai', x, y, { currentHp: 9999, stats: { ...proto.stats, hp: 9999, def: 0, res: 0 } }));
      }
      // the PRIMARY target is hit by definition, wherever it stands, so it must
      // be excluded from the splash-shape count — pick one INSIDE the disc and
      // exclude it, or the test scores its own directly-targeted victim as a leak.
      const primary = victims.find(v => distance({ x: ax, y: ay }, v.pos) <= r);
      const s = mkState([A].concat(victims));
      const out = executeMove(s, A, primary, { id: 'aoe', name: 'AOE', kind: 'attack', type: 'physical',
        power: 40, range: 3, cost: 0, aoeRadius: r, splashDamagePct: 1, accuracy: 100 });
      const hurt = out.units.filter(u => u.id >= 100 && u.id !== primary.id && u.currentHp < 9999).map(u => u.pos);
      const inDisc = hurt.filter(p => distance({ x: ax, y: ay }, p) <= r).length;
      const outDisc = hurt.filter(p => distance({ x: ax, y: ay }, p) > r).length;
      const discSize = victims.filter(v => v.id !== primary.id && distance({ x: ax, y: ay }, v.pos) <= r).length;
      if (outDisc !== 0 || inDisc !== discSize) ok = false;
      rows.push(`r${r} row${ay}: hurt ${hurt.length} (inDisc ${inDisc}/${discSize}, outsideDisc ${outDisc}); square candidates were ${victims.length}`);
    }
    return { pass: ok, note: rows.join(' | ') };
  });

  // 8. surface paint radius — the other "area" primitive
  T('_paintSurface r=1 paints 7 tiles and r=2 paints 19 (hex disc incl. centre)', () => {
    const rows = []; let ok = true;
    for (const r of [1, 2]) for (const cy of [5, 6]) {
      const s = mkState([]);
      _paintSurface(s, 6, cy, 'ice', r, 5);
      const keys = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (s.board[y][x].surface) keys.push(x + ',' + y);
      const outside = keys.filter(k => { const [x, y] = k.split(',').map(Number); return distance({ x: 6, y: cy }, { x, y }) > r; }).length;
      const want = 3 * r * r + 3 * r + 1;
      if (keys.length !== want || outside !== 0) ok = false;
      rows.push(`r${r} row${cy}: ${keys.length}/${want}, outsideDisc ${outside}`);
    }
    return { pass: ok, note: rows.join(' | ') };
  });

  // 9. laneDepth — measured, and reported honestly rather than assumed.
  //    ⚠ endDist === depth proves only that the lane is a GEODESIC, not that it
  //    is straight. An earlier revision of this test called that "cube-collinear
  //    (straight ray)" and it was overclaiming: see d13-lane.mjs, which reads the
  //    cube direction of each step and finds TWO, alternating. The lane is a
  //    legal 6-connected shortest chain that zigzags; it is not one of the six.
  T('move.laneDepth column sweep is 6-connected and geodesic (it is NOT a single hex direction)', () => {
    const cube = (x, y) => { const cx = x - ((y - (y & 1)) / 2); return [cx, -cx - y, y]; };
    const ax = 6, ay = 8, depth = 3;
    const lane = []; for (let s = 1; s <= depth; s++) lane.push({ x: ax, y: ay - s });
    const chain = [{ x: ax, y: ay }].concat(lane);
    const connected = chain.slice(1).every((p, i) => distance(chain[i], p) === 1);
    const endDist = distance({ x: ax, y: ay }, lane[lane.length - 1]);
    const dirs = new Set(chain.slice(1).map((p, i) => {
      const A = cube(chain[i].x, chain[i].y), B = cube(p.x, p.y);
      return [B[0] - A[0], B[1] - A[1], B[2] - A[2]].join(',');
    }));
    return { pass: connected && endDist === depth,
      note: `lane ${chain.map(p => p.x + ',' + p.y).join(' → ')}: every step a hex neighbour ${connected}; geodesic ${endDist === depth} (${endDist} hexes over ${depth} steps); distinct cube directions used ${dirs.size} — a straight ray would use 1, so the lane ZIGZAGS. Disclosed, not failed: the source calls it "the COLUMN directly in front".` };
  });

  return res;
});

let pass = 0, fail = 0;
for (const r of R) { r.pass ? pass++ : fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.note}`); }
console.log(`\nD3 ABILITIES: ${pass} pass / ${fail} fail   pageErrors ${pageErrors.length}`);
if (pageErrors.length) console.log(pageErrors.slice(0, 5));
await close();
