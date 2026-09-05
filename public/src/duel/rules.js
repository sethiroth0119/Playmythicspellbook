/* ═══════════════════════════════════════════════════════════════════════════
   rules.js — DUEL OF ROSES prototype: the pure rules engine.

   WHAT THIS IS
   A Yu-Gi-Oh! "Duelists of the Roses" style match layered ON TOP of the live
   Mythic Spellbook combat system. The combat maths here is a faithful port of
   `calculateDamage` / `getMoveRange` / `getStatBonus` in public/index.html —
   same power×ATK/(DEF×4)+2 core, same type chart, STAB, crit, pierce, status
   mods, Infected halving. The DotR layer adds what the live game does not have:

     • a 7×7 board of TERRAIN, each tile carrying an element. A unit standing
       on its own element is Empowered (+25% all four combat stats); standing
       on terrain whose element beats it is Hindered (−25%). Flyers ignore
       terrain, as they do in DotR.
     • a DECK LEADER per side that stands ON the board. It cannot attack; it is
       the only thing that needs to die. Summons happen in the tiles around it.
     • every summon lands FACE-DOWN in defense. Face-down units are hidden from
       the opponent, cannot act, and flip (get revealed) when attacked or when
       their owner turns them over.
     • a STANCE per unit — attack or defense. Defense halves incoming damage
       but the unit cannot attack. One free stance change per turn.
     • summoning sickness: a unit cannot move or attack the turn it arrives.
     • one summon per turn, and summoning is FREE (DotR). Energy — the Mythic
       resource — is spent only on moves, so the two systems don't double-tax.
     • you lose when your leader dies OR when you must draw from an empty deck.

   WHAT THIS IS NOT (deliberately out of scope for a rules prototype)
   Weather, location cards, spells/traps/walls, Kalon transforms, skill trees,
   held items, cosmic keystones, lane/AoE attacks beyond simple radius splash.
   Every omitted branch of calculateDamage is named in `resolveAttack` so the
   port can be widened rather than rewritten.

   PURITY CONTRACT (same as engine/): no DOM, no globals, no Math.random.
   Every random roll goes through `state.rng` (seeded), so a duel can be
   replayed from (seed, inputs) — the property the server-authority design
   wants. All state mutation goes through the exported action functions, which
   return `{ ok, reason?, events[] }`; `events` is what the UI animates and
   logs, so the UI never has to diff state.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  STATUS_EFFECTS, PASSIVES, ELEMENTS, STRONG_VS, TYPE_CHART, TYPE_IMMUNITIES,
  MOVES, UNIT_CARDS,
} from './catalogs.gen.js';

export { STATUS_EFFECTS, PASSIVES, ELEMENTS, STRONG_VS, TYPE_CHART, TYPE_IMMUNITIES, MOVES, UNIT_CARDS };

/* ─── Tunables. Everything a designer might want to poke lives here. ─────── */
export const RULES = Object.freeze({
  COLS: 7, ROWS: 7,             // DotR board
  HAND_START: 5, HAND_MAX: 7,
  DECK_SIZE: 24,
  MAX_COPIES: 3,
  SUMMONS_PER_TURN: 1,
  SUMMON_RANGE: 1,              // Chebyshev distance from the leader
  UNIT_LEVEL: 3,                // learnset level units arrive at (DotR has no levels; lvl 1 gives many units a single move)
  LEADER: { hp: 60, def: 10, res: 10, spd: 1 },
  TERRAIN_BOOST: 0.25,          // Empowered / Hindered magnitude (DotR's ±500 in our scale)
  DEFENSE_STANCE_MULT: 0.5,
  ENERGY_MAX: 6,
  energyForRound: (round) => Math.min(6, 1 + round),   // round 1 → 2, grows one per own turn
  TURN_CAP: 80,                 // hard stop → draw
});

/* ─── Terrain. Each carries one Mythic element; that is the whole mechanic. ── */
export const TERRAINS = Object.freeze({
  plain:    { id: 'plain',    name: 'Plain',        icon: '·',  element: null,     hue: 40,  desc: 'No effect.' },
  meadow:   { id: 'meadow',   name: 'Meadow',       icon: '🌾', element: 'light',  hue: 60,  desc: 'Sunlit field — Light.' },
  forest:   { id: 'forest',   name: 'Forest',       icon: '🌲', element: 'nature', hue: 120, desc: 'Deep woods — Nature.' },
  mountain: { id: 'mountain', name: 'Mountain',     icon: '⛰️', element: 'earth',  hue: 25,  desc: 'High stone — Earth.' },
  sea:      { id: 'sea',      name: 'Sea',          icon: '🌊', element: 'water',  hue: 205, desc: 'Open water — Water.' },
  ashland:  { id: 'ashland',  name: 'Ashland',      icon: '🔥', element: 'fire',   hue: 10,  desc: 'Scorched cinders — Fire.' },
  marsh:    { id: 'marsh',    name: 'Umbral Marsh', icon: '🌑', element: 'shadow', hue: 270, desc: 'Lightless bog — Shadow.' },
  cliffs:   { id: 'cliffs',   name: 'Windcliffs',   icon: '🌬️', element: 'wind',   hue: 170, desc: 'Howling heights — Wind.' },
  stormfield:{ id: 'stormfield', name: 'Stormfield', icon: '⚡', element: 'storm', hue: 230, desc: 'Charged ground — Storm.' },
  labyrinth:{ id: 'labyrinth', name: 'Labyrinth',   icon: '🧱', element: null,     hue: 0,   desc: 'Impassable.', blocked: true },
});

/* ─── Seeded RNG (mulberry32). `rng()` ∈ [0,1). ──────────────────────────── */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const fn = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.seed = seed;
  return fn;
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffle = (rng, arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/* ─── Geometry. Chebyshev everywhere: the live engine moves and ranges in 8
   directions (getValidMoves expands dx,dy ∈ {-1,0,1}), so a DotR 4-direction
   grid would silently change every unit's reach. ─────────────────────────── */
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < RULES.COLS && y < RULES.ROWS;
export const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const key = (x, y) => x + ',' + y;
export const tileAt = (state, x, y) => (inBounds(x, y) ? state.board[y][x] : null);
export const unitAt = (state, x, y) => state.units.find((u) => u.alive && u.pos.x === x && u.pos.y === y) || null;
export const other = (side) => (side === 'p1' ? 'p2' : 'p1');
export const unitById = (state, uid) => state.units.find((u) => u.uid === uid) || null;
export const leaderOf = (state, side) => state.units.find((u) => u.isLeader && u.owner === side) || null;
export const cardById = (id) => UNIT_CARDS.find((c) => c.id === id) || null;

/* ─── Board generation — a few terrain blobs on a plain, mirrored top↔bottom
   so neither side starts with the better ground. ─────────────────────────── */
export function generateBoard(rng) {
  const { COLS, ROWS } = RULES;
  const board = [];
  for (let y = 0; y < ROWS; y++) { board.push([]); for (let x = 0; x < COLS; x++) board[y].push({ x, y, terrain: 'plain' }); }
  const kinds = ['meadow', 'forest', 'mountain', 'sea', 'ashland', 'marsh', 'cliffs', 'stormfield'];
  const blobs = 3 + Math.floor(rng() * 2);
  const chosen = shuffle(rng, kinds).slice(0, blobs);
  const half = Math.floor(ROWS / 2);
  for (const t of chosen) {
    // Seed in the top half, grow a 3–5 tile blob, then mirror to the bottom.
    let cx = Math.floor(rng() * COLS), cy = Math.floor(rng() * half);
    const size = 3 + Math.floor(rng() * 3);
    const cells = [[cx, cy]];
    for (let i = 1; i < size; i++) {
      const [bx, by] = pick(rng, cells);
      const nx = bx + [-1, 0, 1][Math.floor(rng() * 3)], ny = by + [-1, 0, 1][Math.floor(rng() * 3)];
      if (inBounds(nx, ny) && ny < half) cells.push([nx, ny]);
    }
    for (const [x, y] of cells) { board[y][x].terrain = t; board[ROWS - 1 - y][x].terrain = t; }
  }
  // A couple of labyrinth walls on the middle row so movement has to route.
  const walls = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < walls; i++) {
    const x = Math.floor(rng() * COLS);
    if (x !== Math.floor(COLS / 2)) board[half][x].terrain = 'labyrinth';
  }
  // Leader tiles must be plain and open.
  board[0][Math.floor(COLS / 2)].terrain = 'plain';
  board[ROWS - 1][Math.floor(COLS / 2)].terrain = 'plain';
  return board;
}

/* ─── Decks. Duplicates capped; a fixed list can be handed in (deck builder,
   URL param) and is validated against the catalog rather than trusted. ───── */
export function buildDeck(rng, cardIds) {
  const pool = UNIT_CARDS.map((c) => c.id);
  let ids = Array.isArray(cardIds) ? cardIds.filter((id) => pool.includes(id)) : [];
  const counts = {};
  ids = ids.filter((id) => (counts[id] = (counts[id] || 0) + 1) <= RULES.MAX_COPIES).slice(0, RULES.DECK_SIZE);
  while (ids.length < RULES.DECK_SIZE) {
    const id = pick(rng, pool);
    if ((counts[id] || 0) >= RULES.MAX_COPIES) continue;
    counts[id] = (counts[id] || 0) + 1;
    ids.push(id);
  }
  return shuffle(rng, ids);
}

/* ─── Unit construction ──────────────────────────────────────────────────── */
let _uid = 0;
export function learnedMoves(card, level) {
  const lvl = level == null ? RULES.UNIT_LEVEL : level;
  const seen = new Set();
  const out = [];
  for (const e of card.learnset || []) {
    if (e.lvl <= lvl && MOVES[e.m] && !seen.has(e.m)) { seen.add(e.m); out.push(e.m); }
  }
  return out;
}
export function makeUnit(card, owner, pos, turn) {
  return {
    uid: 'u' + (++_uid),
    cardId: card.id, name: card.name, icon: card.icon,
    owner, pos: { x: pos.x, y: pos.y },
    elements: (card.elements || []).slice(), factions: (card.factions || []).slice(),
    passive: card.passive && card.passive !== 'none' ? card.passive : null,
    flying: !!card.flying,
    stats: { ...card.stats },
    maxHp: card.stats.hp, currentHp: card.stats.hp,
    moves: learnedMoves(card),
    statusEffects: [],
    facing: 'down', stance: 'defense',
    hasMoved: false, hasAttacked: false, stanceChanged: false,
    summonedTurn: turn, alive: true, isLeader: false,
  };
}
export function makeLeader(owner, pos, name) {
  const L = RULES.LEADER;
  return {
    uid: 'L_' + owner, cardId: null, name: name || (owner === 'p1' ? 'Your Leader' : 'Rival Leader'),
    icon: owner === 'p1' ? '👑' : '🏴', owner, pos: { x: pos.x, y: pos.y },
    elements: [], factions: ['leader'], passive: null, flying: false,
    stats: { hp: L.hp, atk: 0, def: L.def, mag: 0, res: L.res, spd: L.spd },
    maxHp: L.hp, currentHp: L.hp, moves: [], statusEffects: [],
    facing: 'up', stance: 'defense',
    hasMoved: false, hasAttacked: false, stanceChanged: false,
    summonedTurn: 0, alive: true, isLeader: true,
  };
}

/* ─── New duel ───────────────────────────────────────────────────────────── */
export function newDuel(opts = {}) {
  const seed = (opts.seed >>> 0) || ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  const rng = makeRng(seed);
  _uid = 0;
  const board = generateBoard(rng);
  const mid = Math.floor(RULES.COLS / 2);
  const state = {
    seed, rng, board,
    turn: 0, active: 'p1', round: { p1: 0, p2: 0 },
    players: {
      p1: { deck: buildDeck(rng, opts.p1Deck), hand: [], graveyard: [], energy: 0, summonsLeft: 0, name: opts.p1Name || 'You' },
      p2: { deck: buildDeck(rng, opts.p2Deck), hand: [], graveyard: [], energy: 0, summonsLeft: 0, name: opts.p2Name || 'Rival' },
    },
    units: [makeLeader('p1', { x: mid, y: RULES.ROWS - 1 }, opts.p1Name && opts.p1Name + "'s Leader"),
            makeLeader('p2', { x: mid, y: 0 }, opts.p2Name && opts.p2Name + "'s Leader")],
    log: [], gameOver: false, winner: null, reason: null,
  };
  for (const side of ['p1', 'p2']) for (let i = 0; i < RULES.HAND_START; i++) drawCard(state, side);
  const first = opts.first || (rng() < 0.5 ? 'p1' : 'p2');
  state.active = other(first);          // startTurn flips it
  const ev = startTurn(state);
  state.log.push({ t: 'start', seed, first, msg: 'Duel begins. ' + state.players[first].name + ' goes first.' });
  return state;
}

/* ─── Turn flow ──────────────────────────────────────────────────────────── */
export function drawCard(state, side) {
  const p = state.players[side];
  if (!p.deck.length) return null;
  if (p.hand.length >= RULES.HAND_MAX) return null;
  const id = p.deck.shift();
  p.hand.push(id);
  return id;
}

export function startTurn(state) {
  const events = [];
  if (state.gameOver) return events;
  state.turn++;
  state.active = other(state.active);
  const side = state.active;
  const p = state.players[side];
  p.round = (p.round || 0) + 1;
  p.energy = RULES.energyForRound(p.round);
  p.summonsLeft = RULES.SUMMONS_PER_TURN;

  // DotR: drawing from an empty deck is a loss. Checked before any tick so the
  // player never gets a phantom turn.
  if (!p.deck.length) {
    endGame(state, other(side), 'deck-out');
    events.push({ t: 'gameover', winner: state.winner, reason: state.reason });
    return events;
  }
  if (state.turn > 1) { // the opening hands were already dealt
    const id = drawCard(state, side);
    if (id) events.push({ t: 'draw', side, cardId: id });
  }

  // Status ticks + passives for the active side's units. Mirrors the live
  // turn-start order: DoT first, then regeneration, then expiry.
  for (const u of state.units) {
    if (!u.alive || u.owner !== side) continue;
    u.hasMoved = false; u.hasAttacked = false; u.stanceChanged = false;
    for (const e of u.statusEffects) {
      const def = STATUS_EFFECTS[e.type];
      if (def && def.when === 'turnStart' && def.dmgMax) {
        const dmg = def.dmgMin + Math.floor(state.rng() * (def.dmgMax - def.dmgMin + 1));
        u.currentHp = Math.max(0, u.currentHp - dmg);
        events.push({ t: 'tick', uid: u.uid, status: e.type, dmg });
        state.log.push({ t: 'tick', msg: u.name + ' takes ' + dmg + ' from ' + def.name + '.' });
      }
    }
    if (u.alive && u.currentHp > 0 && hasPassive(u, 'regeneration') && u.currentHp < u.maxHp) {
      const heal = Math.min(2, u.maxHp - u.currentHp);
      u.currentHp += heal;
      events.push({ t: 'heal', uid: u.uid, amount: heal, source: 'regeneration' });
    }
    for (const e of u.statusEffects) e.turnsLeft--;
    u.statusEffects = u.statusEffects.filter((e) => e.turnsLeft > 0);
    if (u.currentHp <= 0) events.push(...killUnit(state, u, null));
  }
  state.log.push({ t: 'turn', msg: '— Turn ' + state.turn + ': ' + p.name + ' (' + p.energy + ' energy) —' });
  events.push({ t: 'turnStart', side, turn: state.turn });
  if (state.gameOver) events.push({ t: 'gameover', winner: state.winner, reason: state.reason });
  else if (state.turn > RULES.TURN_CAP) { endGame(state, null, 'turn-cap'); events.push({ t: 'gameover', winner: null, reason: 'turn-cap' }); }
  return events;
}

export function endTurn(state) {
  if (state.gameOver) return { ok: false, reason: 'Game over', events: [] };
  return { ok: true, events: startTurn(state) };
}

function endGame(state, winner, reason) {
  state.gameOver = true; state.winner = winner; state.reason = reason;
  state.log.push({ t: 'end', msg: winner ? state.players[winner].name + ' wins (' + reason + ').' : 'Draw (' + reason + ').' });
}

/* ─── Stat helpers — ports of getStatBonus / getStatusStatMultiplier /
   getMoveRange, minus the App.state-reading branches (auras, weather, traps,
   skill trees), plus the one DotR addition: terrain. ────────────────────── */
export function hasPassive(unit, id) { return !!unit && unit.passive === id; }

export function terrainEffect(state, unit) {
  // Empowered: own element under foot. Hindered: the ground's element beats one
  // of ours. Flyers touch neither. Leaders have no element so are never affected.
  if (!unit || unit.flying || !unit.elements.length) return 0;
  const t = tileAt(state, unit.pos.x, unit.pos.y);
  const el = t && TERRAINS[t.terrain] && TERRAINS[t.terrain].element;
  if (!el) return 0;
  if (unit.elements.includes(el)) return 1;
  if (unit.elements.some((ue) => (STRONG_VS[el] || []).includes(ue))) return -1;
  return 0;
}

export function statusStatMultiplier(unit) {
  let m = 1;
  for (const e of unit.statusEffects || []) { const d = STATUS_EFFECTS[e.type]; if (d && typeof d.statMult === 'number') m *= d.statMult; }
  return m;
}

export function statBonus(unit, statKey) {
  let bonus = 0;
  for (const e of unit.statusEffects || []) {
    const d = STATUS_EFFECTS[e.type];
    if (d && d[statKey + 'Mod']) bonus += d[statKey + 'Mod'];
  }
  if (hasPassive(unit, 'tough') && statKey === 'def') bonus += 3;
  if (hasPassive(unit, 'magicWard') && statKey === 'res') bonus += 3;
  return bonus;
}

/** Effective combat stat: base + bonuses, terrain ±25%, status multiplier. */
export function effectiveStat(state, unit, statKey) {
  let v = (unit.stats[statKey] || 0) + statBonus(unit, statKey);
  const te = terrainEffect(state, unit);
  if (te) v = Math.floor(v * (1 + te * RULES.TERRAIN_BOOST));
  return Math.max(1, Math.floor(v * statusStatMultiplier(unit)));
}

export function moveRange(unit) {
  if (unit.isLeader) return RULES.LEADER.spd;
  let speed = unit.stats.spd || 1;
  if (hasPassive(unit, 'swift')) speed += 1;
  for (const e of unit.statusEffects || []) { const d = STATUS_EFFECTS[e.type]; if (d && d.spdMod) speed += d.spdMod; }
  speed = Math.max(1, Math.floor(speed * statusStatMultiplier(unit)));
  return Math.max(1, speed);
}

export function isStunned(unit) {
  return (unit.statusEffects || []).some((e) => STATUS_EFFECTS[e.type] && STATUS_EFFECTS[e.type].skipTurn);
}

export function attackRange(unit, move) {
  let r = move.range || 0;
  if (r > 0) for (const e of unit.statusEffects || []) { const d = STATUS_EFFECTS[e.type]; if (d && d.spdMod < 0) r += d.spdMod; }
  return Math.max(r > 0 ? 1 : 0, r);
}

/* ─── Queries the UI and AI share ────────────────────────────────────────── */
export function canAct(state, unit) {
  return !!unit && unit.alive && unit.owner === state.active && !state.gameOver
    && unit.summonedTurn !== state.turn && !isStunned(unit);
}

export function summonTiles(state, side) {
  const L = leaderOf(state, side);
  const out = [];
  if (!L) return out;
  for (let y = 0; y < RULES.ROWS; y++) for (let x = 0; x < RULES.COLS; x++) {
    if (dist({ x, y }, L.pos) > RULES.SUMMON_RANGE || dist({ x, y }, L.pos) === 0) continue;
    const t = state.board[y][x];
    if (TERRAINS[t.terrain].blocked || unitAt(state, x, y)) continue;
    out.push({ x, y });
  }
  return out;
}

export function validMoves(state, unit) {
  if (!canAct(state, unit) || unit.hasMoved || unit.hasAttacked || unit.facing === 'down') return [];
  const speed = moveRange(unit);
  const visited = new Set([key(unit.pos.x, unit.pos.y)]);
  const queue = [{ x: unit.pos.x, y: unit.pos.y, d: 0 }];
  const out = [];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.d >= speed) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!inBounds(nx, ny) || visited.has(key(nx, ny))) continue;
      if (unitAt(state, nx, ny)) continue;
      if (TERRAINS[state.board[ny][nx].terrain].blocked) continue;
      visited.add(key(nx, ny));
      out.push({ x: nx, y: ny });
      queue.push({ x: nx, y: ny, d: cur.d + 1 });
    }
  }
  return out;
}

/** Moves this unit can actually use right now (energy, stance, kind). */
export function usableMoves(state, unit) {
  if (!canAct(state, unit) || unit.hasAttacked || unit.facing === 'down' || unit.isLeader) return [];
  const p = state.players[unit.owner];
  return unit.moves.map((id) => MOVES[id]).filter((m) => m && (m.kind === 'attack' || m.kind === 'ability'))
    .filter((m) => (m.cost || 0) <= p.energy)
    .filter((m) => m.kind !== 'attack' || unit.stance === 'attack');
}

export function targetsFor(state, unit, move) {
  const r = attackRange(unit, move);
  const tgt = move.target || 'enemy';
  const out = [];
  for (const t of state.units) {
    if (!t.alive) continue;
    const d = dist(unit.pos, t.pos);
    if (tgt === 'self') { if (t === unit) out.push(t); continue; }
    if (d > r || d === 0) continue;
    if (tgt === 'ally' && t.owner === unit.owner) out.push(t);
    else if (tgt === 'enemy' && t.owner !== unit.owner) out.push(t);
  }
  if (tgt === 'self' && !out.length) out.push(unit);
  return out;
}

/* ─── Damage — the port. Every removed branch is called out. ─────────────── */
export function typeMultiplierFor(move, defender) {
  const moveElem = move.element || 'neutral';
  let mul = 1;
  if (moveElem !== 'neutral') for (const de of defender.elements || []) {
    const row = TYPE_CHART[moveElem];
    mul *= (row && row[de] != null) ? row[de] : 1;
  }
  return mul;
}

/**
 * Port of calculateDamage(move, attacker, defender, weather) with weather=null.
 * Omitted, in the order they appear upstream: spectralHaze, smoke tiles, mist /
 * sand / eclipse passives, camp traits, skill-tree dodge/flags, riposte,
 * faewish, mirror-image dodge, evasive roll, ghost, body-press, weather stat
 * bumps, location auras, wards, thunderlord, weather damage mods, stormborn,
 * ambush, radiant aegis, elem field mods, day/night, adaptability, cosmic
 * auras, divine smite, loyalty crit, overwatch, squad cohesion. Kept: accuracy
 * (with status accMod + SPD penalty), the core formula, pierce, sunder, type
 * chart, damageTakenMult, STAB, crit. Added: terrain (inside effectiveStat)
 * and the defense-stance halving, both DotR.
 * `preview` = no rolls (accuracy 100, crit 0) for AI scoring and UI hints.
 */
export function resolveAttack(state, move, attacker, defender, preview) {
  if (!move.power) return { damage: 0, missed: false, crit: false, typeMul: 1, stab: false, effectiveness: 'none' };
  let accuracy = move.accuracy != null ? move.accuracy : 100;
  let spdPen = 0;
  for (const e of attacker.statusEffects || []) {
    const d = STATUS_EFFECTS[e.type];
    if (d && d.spdMod < 0) spdPen += -d.spdMod;
    if (d && typeof d.accMod === 'number') accuracy += d.accMod;
  }
  accuracy -= 15 * spdPen;
  if (!preview && accuracy < 100 && state.rng() * 100 >= accuracy) {
    return { damage: 0, missed: true, crit: false, typeMul: 1, stab: false, effectiveness: 'miss' };
  }
  const offKey = move.type === 'physical' ? 'atk' : 'mag';
  const defKey = move.type === 'physical' ? 'def' : 'res';
  const atkStat = effectiveStat(state, attacker, offKey);
  let defStat = effectiveStat(state, defender, defKey);
  if (move.effect === 'pierce') defStat = Math.floor(defStat / 2);
  if (hasPassive(attacker, 'sunder')) defStat = Math.max(1, Math.floor(defStat / 2));
  let dmg = Math.max(1, Math.floor((move.power * atkStat) / (Math.max(1, defStat) * 4)) + 2);

  const typeMul = typeMultiplierFor(move, defender);
  dmg = Math.floor(dmg * typeMul);
  if (dmg < 1 && typeMul > 0) dmg = 1;

  let takenMul = 1;
  for (const e of defender.statusEffects || []) { const d = STATUS_EFFECTS[e.type]; if (d && d.damageTakenMult) takenMul *= d.damageTakenMult; }
  if (takenMul !== 1) dmg = Math.max(1, Math.round(dmg * takenMul));

  const moveElem = move.element || 'neutral';
  const stab = moveElem !== 'neutral' && (attacker.elements || []).includes(moveElem);
  if (stab) dmg = Math.floor(dmg * 1.5);

  let critChance = move.crit != null ? move.crit : 6;
  const crit = !preview && state.rng() * 100 < critChance;
  if (crit) dmg = Math.floor(dmg * 1.5);

  // DotR layer: a defending (or face-down) unit takes half. Leaders always
  // defend — they have no attack stance to be caught in.
  const guarded = defender.stance === 'defense' || defender.facing === 'down';
  if (guarded) dmg = Math.max(1, Math.floor(dmg * RULES.DEFENSE_STANCE_MULT));

  const effectiveness = typeMul > 1 ? 'super' : typeMul < 1 ? 'resisted' : 'neutral';
  return { damage: dmg, missed: false, crit, typeMul, stab, guarded, effectiveness, terrainA: terrainEffect(state, attacker), terrainD: terrainEffect(state, defender) };
}

function immuneToStatus(unit, statusId) {
  for (const el of unit.elements || []) if ((TYPE_IMMUNITIES[el] || []).includes(statusId)) return true;
  if (statusId === 'infected' && (unit.factions || []).includes('alien')) return true;
  if (unit.isLeader) return true;
  return false;
}

export function applyStatus(state, unit, statusId, duration, events) {
  if (!STATUS_EFFECTS[statusId] || !unit.alive || immuneToStatus(unit, statusId)) return false;
  const cur = unit.statusEffects.find((e) => e.type === statusId);
  if (cur) cur.turnsLeft = Math.max(cur.turnsLeft, duration);
  else unit.statusEffects.push({ type: statusId, turnsLeft: duration });
  events.push({ t: 'status', uid: unit.uid, status: statusId, duration });
  state.log.push({ t: 'status', msg: unit.name + ' is ' + STATUS_EFFECTS[statusId].name + '.' });
  return true;
}

function killUnit(state, u, killer) {
  const events = [];
  u.alive = false; u.currentHp = 0;
  events.push({ t: 'death', uid: u.uid, by: killer ? killer.uid : null });
  state.log.push({ t: 'death', msg: u.name + ' is destroyed.' });
  if (u.cardId) state.players[u.owner].graveyard.push(u.cardId);
  if (u.isLeader) { endGame(state, other(u.owner), 'leader'); events.push({ t: 'gameover', winner: state.winner, reason: 'leader' }); }
  return events;
}

function dealDamage(state, target, dmg, source, events) {
  if (dmg <= 0 || !target.alive) return;
  target.currentHp = Math.max(0, target.currentHp - dmg);
  events.push({ t: 'damage', uid: target.uid, dmg, by: source ? source.uid : null });
  if (target.currentHp <= 0) events.push(...killUnit(state, target, source));
}

/* ─── Actions ────────────────────────────────────────────────────────────── */
const fail = (reason) => ({ ok: false, reason, events: [] });

export function summon(state, side, cardId, pos) {
  if (state.gameOver || side !== state.active) return fail('Not your turn');
  const p = state.players[side];
  if (p.summonsLeft <= 0) return fail('Already summoned this turn');
  const hi = p.hand.indexOf(cardId);
  if (hi === -1) return fail('Card not in hand');
  if (!summonTiles(state, side).some((t) => t.x === pos.x && t.y === pos.y)) return fail('Must summon beside your leader');
  const card = cardById(cardId);
  if (!card) return fail('Unknown card');
  p.hand.splice(hi, 1);
  p.summonsLeft--;
  const u = makeUnit(card, side, pos, state.turn);
  state.units.push(u);
  state.log.push({ t: 'summon', msg: p.name + ' sets a card face-down.' , side });
  return { ok: true, unit: u, events: [{ t: 'summon', uid: u.uid, side, pos }] };
}

export function moveUnit(state, uid, pos) {
  const u = unitById(state, uid);
  if (!u || u.owner !== state.active) return fail('Not your unit');
  if (!validMoves(state, u).some((t) => t.x === pos.x && t.y === pos.y)) return fail('Cannot move there');
  const from = { ...u.pos };
  u.pos = { x: pos.x, y: pos.y };
  u.hasMoved = true;
  state.log.push({ t: 'move', msg: u.name + ' moves to ' + coord(pos) + '.' });
  return { ok: true, events: [{ t: 'move', uid, from, to: { ...pos }, terrain: terrainEffect(state, u) }] };
}

/** Flip a face-down unit face-up (free; keeps defense stance until changed). */
export function flip(state, uid) {
  const u = unitById(state, uid);
  if (!u || u.owner !== state.active || state.gameOver) return fail('Not your unit');
  if (u.facing !== 'down') return fail('Already face-up');
  if (u.summonedTurn === state.turn) return fail('Cannot flip the turn it was set');
  u.facing = 'up';
  state.log.push({ t: 'flip', msg: state.players[u.owner].name + ' flips ' + u.name + ' face-up.' });
  return { ok: true, events: [{ t: 'flip', uid, forced: false }] };
}

export function setStance(state, uid, stance) {
  const u = unitById(state, uid);
  if (!u || u.owner !== state.active || u.isLeader) return fail('Not your unit');
  if (!canAct(state, u)) return fail('Cannot act yet');
  if (u.facing === 'down') return fail('Flip it first');
  if (u.stanceChanged) return fail('Stance already changed this turn');
  if (u.hasAttacked) return fail('Already attacked');
  if (u.stance === stance) return fail('Already in that stance');
  u.stance = stance; u.stanceChanged = true;
  state.log.push({ t: 'stance', msg: u.name + ' switches to ' + stance + ' stance.' });
  return { ok: true, events: [{ t: 'stance', uid, stance }] };
}

export function useMove(state, uid, moveId, targetUid) {
  const u = unitById(state, uid);
  const move = MOVES[moveId];
  if (!u || !move) return fail('Bad move');
  if (!usableMoves(state, u).some((m) => m.id === moveId)) return fail('Move not usable');
  const target = unitById(state, targetUid);
  if (!target || !targetsFor(state, u, move).some((t) => t.uid === targetUid)) return fail('Bad target');
  const p = state.players[u.owner];
  p.energy -= (move.cost || 0);
  u.hasAttacked = true;
  const events = [{ t: 'useMove', uid, moveId, targetUid }];

  // Attacking a face-down unit reveals it first (DotR flip). It still defends.
  if (target.facing === 'down' && target.owner !== u.owner) {
    target.facing = 'up';
    events.push({ t: 'flip', uid: target.uid, forced: true });
    state.log.push({ t: 'flip', msg: target.name + ' is flipped face-up!' });
  }

  if (move.kind === 'ability') {
    if (move.healAmount) {
      const heal = Math.min(move.healAmount, target.maxHp - target.currentHp);
      target.currentHp += heal;
      events.push({ t: 'heal', uid: target.uid, amount: heal, source: move.id });
      state.log.push({ t: 'heal', msg: u.name + ' heals ' + target.name + ' for ' + heal + '.' });
    }
    if (move.cleanse) { target.statusEffects = []; events.push({ t: 'cleanse', uid: target.uid }); }
    for (const st of statusesOf(move)) if (state.rng() * 100 < st.chance) applyStatus(state, target, st.id, st.duration, events);
    return { ok: true, events };
  }

  // Attack. Radius splash (whirlwind / frost nova / earthquake) hits every unit
  // around the ATTACKER at splashDamagePct; lane moves are treated as single
  // target in this prototype.
  const primary = resolveAttack(state, move, u, target, false);
  events.push({ t: 'hit', uid: target.uid, by: uid, ...primary });
  if (primary.missed) state.log.push({ t: 'miss', msg: u.name + "'s " + move.name + ' misses ' + target.name + '.' });
  else {
    state.log.push({ t: 'hit', msg: u.name + ' hits ' + target.name + ' with ' + move.name + ' for ' + primary.damage
      + (primary.crit ? ' CRIT' : '') + (primary.effectiveness === 'super' ? ' (super effective)' : primary.effectiveness === 'resisted' ? ' (resisted)' : '') + '.' });
    afterHit(state, u, target, move, primary.damage, events);
  }
  if (move.aoeRadius) {
    for (const s of state.units.slice()) {
      if (!s.alive || s === u || s === target || dist(u.pos, s.pos) > move.aoeRadius) continue;
      const r = resolveAttack(state, move, u, s, false);
      const splash = Math.floor(r.damage * (move.splashDamagePct || 1));
      if (!r.missed && splash > 0) { events.push({ t: 'hit', uid: s.uid, by: uid, ...r, damage: splash, splash: true }); afterHit(state, u, s, move, splash, events); }
    }
  }
  if (state.gameOver) events.push({ t: 'gameover', winner: state.winner, reason: state.reason });
  return { ok: true, events };
}

function statusesOf(move) {
  const out = [];
  if (move.applyStatus) out.push(move.applyStatus);
  if (Array.isArray(move.applyStatuses)) out.push(...move.applyStatuses);
  return out;
}

function afterHit(state, attacker, target, move, dmg, events) {
  dealDamage(state, target, dmg, attacker, events);
  // Passive riders — the ones the base roster actually carries.
  if (hasPassive(target, 'thorns') && !attacker.isLeader) {
    const back = Math.floor(dmg * 0.25);
    if (back > 0) { state.log.push({ t: 'thorns', msg: attacker.name + ' takes ' + back + ' from Thorns.' }); dealDamage(state, attacker, back, target, events); }
  }
  if (hasPassive(attacker, 'lifesteal') || move.effect === 'drain') {
    const pct = move.effect === 'drain' ? 0.5 : 0.3;
    const heal = Math.min(Math.floor(dmg * pct), attacker.maxHp - attacker.currentHp);
    if (heal > 0 && attacker.alive) { attacker.currentHp += heal; events.push({ t: 'heal', uid: attacker.uid, amount: heal, source: 'lifesteal' }); }
  }
  if (!target.alive) return;
  for (const st of statusesOf(move)) if (state.rng() * 100 < st.chance) applyStatus(state, target, st.id, st.duration, events);
  if (hasPassive(attacker, 'venomous') && state.rng() * 100 < 30) applyStatus(state, target, 'poison', 3, events);
  if (hasPassive(attacker, 'xenoBond') && state.rng() * 100 < 25) applyStatus(state, target, 'infected', 3, events);
}

export const coord = (p) => String.fromCharCode(65 + p.x) + (p.y + 1);

/* ─── Serialisation. `rng` is a closure, so snapshots carry the seed and the
   number of draws consumed; replaying that many draws restores the stream. ── */
export function snapshot(state) {
  const { rng, ...rest } = state;
  return JSON.parse(JSON.stringify(rest));
}
