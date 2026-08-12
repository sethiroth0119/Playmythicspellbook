// ─────────────────────────────────────────────────────────────────────────────
// 🗺 THE DRAFT — a real Warpath run, played for its card pool.
//
// This is not a model of drafting; it re-implements the SERVER's own draft
// rules against the SERVER's own map. The map, the encounter roll and the
// three-card offer all come from public/warpath/warpath-mapgen.js and
// warpath-data.js, which are the JS mirrors of the SQL in
// supabase/migrations/20260811000000_warpath_milestone_1.sql:
//
//   biome / water / move cost   wp_biome_at, wp_is_water, wp_move_cost
//   encounter fires at all      wp_roll(seed, x, y, 20, 100) < biome.chance
//   the three offers            wp_roll(seed, x*97 + i*7 + tries, y, 21, total)
//                               walking warpath_discovery in `ord` order
//   one encounter per tile      unique (expedition_id, x, y)
//   movement                    8-neighbour, cost = destination tile's move
//                               cost, budget = moves_left (wp_path_cost)
//
// `verify.mjs` re-runs the same tiles through the actual Postgres functions and
// asserts the two agree, so the mirror is checked rather than asserted.
//
// What is NOT the server: the POLICY. Where the hero walks, which of the three
// offers it takes, what it builds and what it recruits are this file's own
// decisions, because the server has no opinion about those — a player does.
// Each policy is stated explicitly so a result can be attributed to it.
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from './stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);

export const Map_ = require(path.join(REPO, 'public/warpath/warpath-mapgen.js')).WarpathMap;
export const Data = require(path.join(REPO, 'public/warpath/warpath-data.js')).WarpathData;

const { WORLD_W, WORLD_H, BIOMES, wpRoll, isWater, moveCostAt, biomeAt, biomeCores,
        nodeAt, spawns, recruitSites, chebyshev, neighbours } = Map_;

const S_ENCOUNTER = 20;      // migration: "Salt 20 is the encounter roll"
const S_OFFER     = 21;

/* ── The three-card offer, exactly as warpath_encounter_open builds it ──── */
export function rollEncounter(seed, x, y, biome) {
  const tbl = Data.DISCOVERY[biome];
  if (!tbl) return null;
  if (wpRoll(seed, x, y, S_ENCOUNTER, 100) >= tbl.encounterChance) return null;
  const cards = tbl.cards;                       // [[key, weight], …] in `ord` order
  const total = cards.reduce((a, c) => a + c[1], 0);
  const picks = new Set(), offers = [];
  for (let i = 0; i < 3; i++) {
    let k = null;
    for (let tries = 0; k === null && tries < 12; tries++) {
      const r = wpRoll(seed, x * 97 + i * 7 + tries, y, S_OFFER, total);
      let acc = 0;
      for (let ord = 0; ord < cards.length; ord++) {
        acc += cards[ord][1];
        if (r < acc) {
          if (!picks.has(ord)) { k = cards[ord][0]; picks.add(ord); }
          break;
        }
      }
    }
    if (k !== null) offers.push(k);
  }
  return offers.length ? offers : null;
}

/* ── A cached view of one map, so a run does not re-hash every tile ─────── */
function world(seed) {
  const cores = biomeCores(seed);
  const cache = new Map();
  return {
    seed,
    at(x, y) {
      if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return null;
      const k = y * WORLD_W + x;
      let t = cache.get(k);
      if (t === undefined) {
        const water = isWater(seed, x, y);
        const biome = biomeAt(seed, cores, x, y);
        t = { x, y, water, biome, moveCost: water ? 99 : moveCostAt(seed, biome, x, y),
              node: water ? null : nodeAt(seed, biome, x, y) };
        cache.set(k, t);
      }
      return t;
    },
  };
}

/* ── Pick policies ─────────────────────────────────────────────────────────
   Which of the three offers a player takes. `value` is the one place a policy
   expresses a deckbuilding opinion, and it only ever reads CARD_META — the
   same table the draft modal shows the player. */
const META = Data.CARD_META;

function baseValue(key) {
  const m = META[key];
  if (!m) return 0;
  if (m.t === 'unit') {
    const s = m.s || [0, 0, 0, 0, 0, 0];      // [hp,atk,def,mag,res,spd]
    const body = s[0] + Math.max(s[1], s[3]) * 1.5 + (s[2] + s[4]) * 0.5;
    return body / Math.max(1, m.c);            // stats per energy
  }
  if (m.t === 'trap')     return 6;
  if (m.t === 'spell')    return 6;
  if (m.t === 'location') return 5;
  if (m.t === 'weather')  return 4;
  return 3;
}

function copies(pool, key) { let n = 0; for (const k of pool) if (k === key) n++; return n; }

export const PICK_POLICIES = {
  /* `value` — a competent drafter. Best stats-per-energy, keeps a floor of
     bodies, and REFUSES a fourth copy of anything, because the main game caps
     a deck at MAX_COPIES_PER_CARD = 3 and a player who has ever built a deck
     knows that. (The Warpath draft modal does not enforce it — see `greedy`
     for what happens when the player does not know either.) */
  value: (offers, pool) => {
    const units = pool.filter(k => (META[k] || {}).t === 'unit').length;
    let best = offers[0], bestV = -Infinity;
    for (const k of offers) {
      const m = META[k] || {};
      let v = baseValue(k);
      if (m.t === 'unit' && units < pool.length * 0.5) v *= 1.6;   // don't starve on bodies
      const have = copies(pool, k);
      if (have >= 3) v -= 100;                                     // a 4th copy is unplayable
      else if (have === 2) v *= 0.7;                               // and a 3rd is the last one
      if (v > bestV) { bestV = v; best = k; }
    }
    return best;
  },
  /* `greedy` — the same value function with NO copy awareness. This is what
     the shipped draft modal actually permits, and the gap between it and
     `value` is the cost of the missing copy counter. */
  greedy: (offers, pool) => {
    let best = offers[0], bestV = -Infinity;
    for (const k of offers) { const v = baseValue(k); if (v > bestV) { bestV = v; best = k; } }
    return best;
  },
  // "Whatever, first one." The floor: a player who does not think.
  first: offers => offers[0],
  // Random pick — the spread between this and `value` is how much drafting skill
  // is actually worth.
  random: (offers, pool, r) => offers[Math.floor(r() * offers.length)],
};

/* ── Movement policies ─────────────────────────────────────────────────────
   `target` is the biome the hero is trying to draft out of. 'roam' takes the
   nearest unexplored tile regardless of biome, which is what a player who has
   not learned the map does. */
/* Two playstyles, because the number of cards a run yields turns out to be
   dominated by how much NEW GROUND the hero covers — an encounter can only fire
   on a tile this expedition has never stood on. `explore` is a player drafting
   on purpose; `harvest` is a player farming resource nodes and camp upgrades,
   which is what the four-player sim's bots do and why they see far fewer cards. */
const STYLE = {
  explore: { fresh: 10, node: 4 },
  harvest: { fresh: 2, node: 14 },
};

function stepScore(t, ctx) {
  if (!t || t.water) return -Infinity;
  const w = STYLE[ctx.style] || STYLE.explore;
  let s = 0;
  if (!ctx.seen.has(t.y * WORLD_W + t.x)) s += w.fresh;            // new ground
  if (ctx.target && t.biome === ctx.target) s += 14;               // the right pack
  if (t.node) s += w.node;
  s -= t.moveCost;
  // Pull toward the nearest recruit site the camp can currently use.
  if (ctx.recruitGoal) s += Math.max(0, 12 - chebyshev(t.x, t.y, ctx.recruitGoal.x, ctx.recruitGoal.y));
  return s;
}

/* ── The run ───────────────────────────────────────────────────────────────
   One expedition, `turns` turns, from one map seed and one spawn slot. */
export function runExpedition(opts) {
  const seed = opts.seed >>> 0;
  const w = world(seed);
  const r = rng((seed ^ 0x5bf03635) + (opts.slot | 0) * 7919 + 1);
  const turns = opts.turns != null ? opts.turns : Data.ENTRY.turns_per_run;
  const movesPerTurn = Data.ENTRY.moves_per_turn;
  const pickFn = PICK_POLICIES[opts.pick || 'value'];
  const target = opts.target || null;              // biome id, or null to roam

  const sp = spawns(seed)[(opts.slot | 0) % 4];      // { slot, x, y }
  let hx = sp.x, hy = sp.y;
  const seen = new Set([hy * WORLD_W + hx]);
  const encountered = new Set();                   // one encounter per tile, ever
  const harvested = new Set();

  const carry = { ...Data.STARTING_STIPEND };
  const materials = [];
  const pool = [...Data.STARTER_POOL];
  const discovered = [];                           // keys added by encounters
  const recruited = [];
  const camp = { x: hx, y: hy, recruitment: 0, blacksmith: 0, supply: 0, watchtower: 0, arcane: 0 };
  const sites = recruitSites(seed);                // [{ id, name, biome, x, y }, …]
  const log = { encountersSeen: 0, encountersFired: 0, tilesWalked: 0, nodes: 0, builds: [] };

  const can = cost => Object.keys(cost || {}).every(k => (carry[k] | 0) >= cost[k]);
  const pay = cost => { for (const k in cost) carry[k] -= cost[k]; };

  function tryBuild() {
    // Build order is the policy's; every level is gated by the real cost table.
    const order = opts.buildOrder || ['supply', 'recruitment', 'recruitment', 'supply', 'watchtower', 'arcane', 'blacksmith'];
    for (const id of order) {
      const b = Data.CAMP_BUILDINGS[id];
      const lvl = camp[id] | 0;
      if (lvl >= b.maxLevel) continue;
      const cost = b.levels[lvl].cost;
      if (!can(cost)) continue;
      pay(cost); camp[id] = lvl + 1; log.builds.push(id + ' ' + (lvl + 1));
      return true;
    }
    return false;
  }

  function tryRecruit() {
    for (const s of sites) {
      if (s.x !== hx || s.y !== hy) continue;
      const p = Data.RECRUIT_POOLS[s.id];
      if (!p) continue;
      // Cheapest-first so a Tent I camp does not blow its food on nothing.
      const offers = [...p.offers].sort((a, b) => a.rank - b.rank);
      for (const o of offers) {
        const maxRank = [0, 2, 4, 5][camp.recruitment | 0];
        if (o.rank > maxRank) continue;
        if (!can(o.cost)) continue;
        pay(o.cost); pool.push(o.key); recruited.push(o.key);
      }
    }
  }

  for (let turn = 1; turn <= turns; turn++) {
    let budget = movesPerTurn;
    // Camp first: the stipend is meant to buy exactly one tent on turn 1.
    while (tryBuild()) { /* keep going while affordable */ }
    for (;;) {
      // Harvest whatever we are standing on before moving off it.
      const here = w.at(hx, hy);
      const hk = hy * WORLD_W + hx;
      if (here && here.node && !harvested.has(hk) && budget >= 1) {
        harvested.add(hk); budget -= 1; log.nodes++;
        const kind = here.node.kind;
        if (carry[kind] != null || ['wood', 'stone', 'iron', 'food', 'essence', 'gold'].includes(kind)) {
          carry[kind] = (carry[kind] | 0) + here.node.amount;
        } else {
          materials.push(kind);          // extraction material — carried, not spent
        }
        continue;
      }
      tryRecruit();
      if (budget < 1) break;
      const ctx = { seen, target, recruitGoal: null, style: opts.style || 'explore' };
      // Head for a usable recruit site when one is affordable-ish and near.
      if ((camp.recruitment | 0) > 0) {
        let best = null, bd = 1e9;
        for (const s of sites) {
          const d = chebyshev(hx, hy, s.x, s.y);
          if (d < bd && d > 0) { bd = d; best = { x: s.x, y: s.y }; }
        }
        if (best && bd <= 14) ctx.recruitGoal = best;
      }
      let bestT = null, bestS = -Infinity;
      for (const [nx, ny] of neighbours(hx, hy)) {
        const t = w.at(nx, ny);
        if (!t || t.water || t.moveCost > budget) continue;
        const s = stepScore(t, ctx) + r() * 2;      // tiny jitter breaks ties
        if (s > bestS) { bestS = s; bestT = t; }
      }
      if (!bestT) break;
      budget -= bestT.moveCost;
      hx = bestT.x; hy = bestT.y;
      log.tilesWalked++;
      const key = hy * WORLD_W + hx;
      seen.add(key);
      if (!encountered.has(key)) {
        encountered.add(key);
        log.encountersSeen++;
        const offers = rollEncounter(seed, hx, hy, bestT.biome);
        if (offers) {
          log.encountersFired++;
          const chosen = pickFn(offers, pool, r);
          pool.push(chosen); discovered.push(chosen);
        }
      }
    }
  }

  // Extraction capacity — the real formula from warpath-data.js.
  const cap = Data.EXTRACT_BASE_CARDS + Data.EXTRACT_CARDS_PER_VAULT_LEVEL * (camp.supply | 0);
  const gained = discovered.concat(recruited);
  const extracted = gained.slice(0, cap);

  return {
    seed, slot: opts.slot | 0, target, pick: opts.pick || 'value', style: opts.style || 'explore', turns,
    pool, discovered, recruited, extracted, extractCap: cap,
    materials, camp, carry, log,
  };
}
