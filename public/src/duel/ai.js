/* ═══════════════════════════════════════════════════════════════════════════
   ai.js — the rival for the Duel of Roses prototype.

   A one-ply greedy opponent, on purpose: the point of the prototype is to feel
   the RULES, and a rival that plays them plainly exposes them better than a
   clever one. It never peeks at hidden information — a face-down enemy card is
   scored as an average unit, exactly what a human at the table knows.

   Produces a list of actions via the SAME exported rules functions the human
   UI calls, so there is no second path through the engine. `takeTurn` returns
   the concatenated events so the UI can animate the whole turn in order.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as R from './rules.js';

const avgUnit = () => ({ stats: { hp: 22, atk: 13, def: 9, mag: 10, res: 10, spd: 1 }, elements: [], statusEffects: [], stance: 'defense', facing: 'down', maxHp: 22, currentHp: 22, flying: false, isLeader: false, pos: { x: 0, y: 0 } });

function expectedDamage(state, move, attacker, target) {
  if (!move.power) return 0;
  const seen = target.facing === 'down' && target.owner !== attacker.owner ? { ...avgUnit(), pos: target.pos, owner: target.owner } : target;
  const r = R.resolveAttack(state, move, attacker, seen, true);
  const acc = Math.min(100, Math.max(0, move.accuracy != null ? move.accuracy : 100));
  return r.damage * acc / 100;
}

/** Score a (move, target) pair from a hypothetical position. */
function scoreAttack(state, unit, move, target) {
  const dmg = expectedDamage(state, move, unit, target);
  let score = dmg;
  if (target.isLeader) score = dmg * 2.2;                    // the only thing that wins
  else if (dmg >= target.currentHp && target.facing !== 'down') score += 12; // kill
  score -= (move.cost || 0) * 1.5;                           // energy is finite
  return score;
}

function bestActionFrom(state, unit, pos) {
  // Temporarily stand the unit on `pos` to evaluate terrain and range there.
  const saved = unit.pos;
  unit.pos = pos;
  let best = null;
  try {
    for (const move of R.usableMoves(state, unit)) {
      if (move.kind !== 'attack') continue;
      for (const t of R.targetsFor(state, unit, move)) {
        const s = scoreAttack(state, unit, move, t);
        if (!best || s > best.score) best = { score: s, move, target: t };
      }
    }
  } finally { unit.pos = saved; }
  return best;
}

export function takeTurn(state, side) {
  const events = [];
  const p = state.players[side];
  const run = (res) => { if (res && res.ok) events.push(...res.events); return res; };
  if (state.gameOver || state.active !== side) return events;

  const enemyLeader = R.leaderOf(state, R.other(side));

  // 1. Summon: strongest card in hand, on the summon tile closest to the foe.
  if (p.summonsLeft > 0 && p.hand.length) {
    const tiles = R.summonTiles(state, side);
    if (tiles.length) {
      const card = p.hand.map(R.cardById).filter(Boolean).sort((a, b) => b.cost - a.cost)[0];
      const tile = tiles.slice().sort((a, b) => R.dist(a, enemyLeader.pos) - R.dist(b, enemyLeader.pos))[0];
      if (card) run(R.summon(state, side, card.id, tile));
    }
  }

  // 2. Each unit: flip → stance → (move +) attack, or advance.
  for (const u of state.units.slice()) {
    if (state.gameOver) break;
    if (!u.alive || u.owner !== side || u.isLeader || !R.canAct(state, u)) continue;
    if (u.facing === 'down') run(R.flip(state, u.uid));
    if (u.facing === 'down') continue;                      // set this turn

    // Decide stance: attack unless badly hurt with no kill in reach.
    const hurt = u.currentHp <= u.maxHp * 0.3;
    const wantAttack = !hurt || R.usableMoves(state, u).length === 0;
    if (u.stance !== (wantAttack ? 'attack' : 'defense')) run(R.setStance(state, u.uid, wantAttack ? 'attack' : 'defense'));

    const candidates = [{ x: u.pos.x, y: u.pos.y, stay: true }].concat(R.validMoves(state, u));
    let best = null;
    for (const pos of candidates) {
      const a = bestActionFrom(state, u, pos);
      if (a && (!best || a.score > best.score)) best = { ...a, pos };
    }
    if (best && best.score > 0) {
      if (!best.pos.stay) run(R.moveUnit(state, u.uid, best.pos));
      run(R.useMove(state, u.uid, best.move.id, best.target.uid));
      continue;
    }
    // Nothing worth hitting: close on the enemy leader, preferring good ground.
    const moves = R.validMoves(state, u);
    if (moves.length) {
      const scored = moves.map((m) => {
        const saved = u.pos; u.pos = m; const te = R.terrainEffect(state, u); u.pos = saved;
        return { m, s: -R.dist(m, enemyLeader.pos) * 2 + te };
      }).sort((a, b) => b.s - a.s);
      if (scored[0].s > -R.dist(u.pos, enemyLeader.pos) * 2 + R.terrainEffect(state, u)) run(R.moveUnit(state, u.uid, scored[0].m));
    }
  }

  // 3. Leader: step away from the nearest enemy if one is adjacent.
  const L = R.leaderOf(state, side);
  if (L && !state.gameOver) {
    const threats = state.units.filter((e) => e.alive && e.owner !== side && !e.isLeader && R.dist(e.pos, L.pos) <= 2);
    if (threats.length) {
      const opts = R.validMoves(state, L).map((m) => ({ m, s: Math.min(...threats.map((t) => R.dist(t.pos, m))) }));
      const bestOpt = opts.sort((a, b) => b.s - a.s)[0];
      if (bestOpt && bestOpt.s > Math.min(...threats.map((t) => R.dist(t.pos, L.pos)))) run(R.moveUnit(state, L.uid, bestOpt.m));
    }
  }

  if (!state.gameOver) run(R.endTurn(state));
  return events;
}
