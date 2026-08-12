// ─────────────────────────────────────────────────────────────────────────────
// 🤖 Four WARPATH players with four different ideas about what the mode is for.
//
// public/warpath/warpath-net.js fakes rivals as random-walk tokens that never
// challenge, never build, never extract and hardcode `camp: null`. That is why
// 120+ scripted runs produced zero battles: nothing in the fixture was ever
// trying to have one. These bots play the actual RPCs, and they play them
// DIFFERENTLY from each other on purpose — a lobby of four identical bots
// surfaces nothing about interaction.
//
//   BOLT  (rusher)   beelines to the Warpath Gate and leaves early.
//   ANVIL (builder)  camps, hauls, and maxes the camp before it goes home.
//   RAKE  (hunter)   hunts heroes: line of sight, discovered camps, and the
//                    extraction broadcast, which carries coordinates.
//   DELVE (greedy)   pushes deep for extraction materials and banks late.
// ─────────────────────────────────────────────────────────────────────────────
import { reach, fogReader, cheb, key, W, H, rng } from './warpath-client.mjs';

const BUILD_PLAN = [
  ['supply', 1], ['recruitment', 1], ['watchtower', 1], ['supply', 2],
  ['arcane', 1], ['watchtower', 2], ['recruitment', 2], ['supply', 3],
  ['blacksmith', 1], ['arcane', 2],
];

export class Bot {
  constructor({ session, name, hero, strategy, map, seed, sim }) {
    this.s = session; this.name = name; this.hero = hero;
    this.strategy = strategy; this.map = map; this.sim = sim;
    this.rand = rng(seed);
    this.exp = null; this.runId = null;
    this.lastSeen = new Map();      // expedition_id -> {x, y, turn}
    this.rivalCamps = new Map();    // expedition_id -> {x, y}
    this.done = false;
    this.stallRounds = 0;           // >0 ⇒ skip end_turn this round (a player who wandered off)
    this.log = [];
    this.counters = {
      moves: 0, harvests: 0, harvest_taken: 0, builds: 0, secures: 0, recruits: 0,
      picks: 0, pvp_opened: 0, pvp_refused: 0, guardian_opened: 0, wins: 0, losses: 0,
      extract_begin: 0, extracted: 0, refusals: {},
    };
  }

  refuse(op, reason) {
    const k = `${op}:${reason}`;
    this.counters.refusals[k] = (this.counters.refusals[k] || 0) + 1;
  }

  async state() { return this.s.rpc('warpath_state', [this.runId]); }

  async enter() {
    await this.s.rpc('warpath_claim_free_ticket');
    const r = await this.s.rpc('warpath_enter', [this.hero, this.name, 'ticket']);
    if (!r.ok) throw new Error(`${this.name} could not enter: ${JSON.stringify(r)}`);
    this.exp = r.expedition_id; this.runId = r.run_id; this.slot = r.slot;
    return r;
  }

  // ── observation ───────────────────────────────────────────────────────────
  observe(st) {
    const turn = st.run.turn;
    for (const o of st.others || []) {
      if (o.visible && o.x != null) this.lastSeen.set(o.expedition_id, { x: o.x, y: o.y, turn });
      if (o.camp) this.rivalCamps.set(o.expedition_id, { x: o.camp.x, y: o.camp.y, buildings: o.camp.buildings });
    }
    // The extraction broadcast is public and carries coordinates — see the
    // wp_log() call in warpath_extract_begin (migration:1828).
    for (const ev of st.events || []) {
      if (ev.kind === 'extraction_started' && ev.payload?.x != null && turn - ev.turn <= 3) {
        this.extractionBeacon = { x: ev.payload.x, y: ev.payload.y, turn: ev.turn };
      }
    }
  }

  // ── movement helpers ──────────────────────────────────────────────────────
  stepToward(st, tx, ty, { adjacent = false } = {}) {
    const me = st.me;
    const d = reach(this.map, me.x, me.y, me.moves_left);
    let best = null, bestScore = Infinity;
    const goal = adjacent ? 1 : 0;
    const here = Math.max(goal, cheb(me.x, me.y, tx, ty));
    for (const [k, cost] of d) {
      if (cost === 0) continue;
      const x = k % W, y = (k / W) | 0;
      const dist = Math.max(goal, cheb(x, y, tx, ty));
      const score = dist * 100 + cost;
      if (dist < here && score < bestScore) { bestScore = score; best = { x, y, cost }; }
    }
    return best;
  }

  frontierStep(st) {
    const me = st.me, explored = fogReader(st.me.fog);
    const d = reach(this.map, me.x, me.y, me.moves_left);
    let best = null, bestScore = -1;
    for (const [k, cost] of d) {
      if (cost === 0) continue;
      const x = k % W, y = (k / W) | 0;
      let dark = 0;
      for (let yy = y - 3; yy <= y + 3; yy++) for (let xx = x - 3; xx <= x + 3; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (!explored(xx, yy)) dark++;
      }
      const score = dark - cost * 2 + this.rand() * 3;
      if (score > bestScore) { bestScore = score; best = { x, y, cost }; }
    }
    return best;
  }

  /** Unclaimed nodes this player has actually explored. Fog-gated on purpose. */
  knownNodes(st, { materialsOnly = false } = {}) {
    const explored = fogReader(st.me.fog);
    const taken = new Set((st.claimed_nodes || []).map(n => key(n.x, n.y)));
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n = this.map.node[y][x];
      if (!n) continue;
      if (taken.has(key(x, y))) continue;
      if (!explored(x, y)) continue;
      if (materialsOnly && n.tier !== 'extraction') continue;
      out.push({ x, y, ...n });
    }
    return out;
  }

  nearestGate(st) {
    let best = null, bd = Infinity;
    for (const g of this.map.gates) {
      const explored = fogReader(st.me.fog);
      if (!g.main && !explored(g.x, g.y)) continue;   // wandering portals must be found
      const d = cheb(st.me.x, st.me.y, g.x, g.y);
      if (d < bd) { bd = d; best = g; }
    }
    return best || this.map.gates.find(g => g.main);
  }

  carried(st) {
    let bulk = 0, mats = 0;
    for (const [k, v] of Object.entries(st.inventory || {})) {
      const tier = this.sim.tierOf(k);
      if (tier === 'extraction') mats += v.carried; else bulk += v.carried;
    }
    return { bulk, mats, unsecuredCards: (st.cards || []).filter(c => !c.secured).length };
  }

  // ── the turn ──────────────────────────────────────────────────────────────
  async playTurn() {
    if (this.done) return;
    this.blockedBuild = new Set();
    let st = await this.state();
    if (!st.in_run) { this.done = true; return; }
    this.observe(st);

    if (st.me.status === 'extracted' || st.me.status === 'lost') { this.done = true; return; }

    // A refused RPC must not end the turn — a client that gave up on the first
    // "insufficient" would never build anything. Instead the same proposal made
    // twice from the same tile is treated as "stuck", which is the real signal.
    const tried = new Set();
    for (let act = 0; act < 24; act++) {
      const action = await this.strategy.call(this, st);
      if (!action) break;
      const sig = `${JSON.stringify(action)}@${st.me.x},${st.me.y}`;
      if (tried.has(sig)) break;
      tried.add(sig);
      const cont = await this.perform(action, st);
      if (cont === 'stop') break;
      st = await this.state();
      this.observe(st);
      if (st.me.status === 'extracted' || st.me.status === 'lost') { this.done = true; return; }
    }

    if (this.stallRounds > 0) {
      this.stallRounds--;
      this.sim.noteStall(this.name, st.run.turn);
      return;
    }
    const r = await this.s.rpc('warpath_end_turn', [this.exp]);
    if (r.ok && r.waiting_for != null) this.sim.noteWaiting(this.name, st.run.turn, r.waiting_for);
    if (r.ok && r.advanced) this.sim.noteAdvance(this.name, r.turn);
    if (!r.ok) this.refuse('end_turn', r.reason);
  }

  async perform(a, st) {
    const c = this.counters;
    switch (a.op) {
      case 'move': {
        const r = await this.s.rpc('warpath_move', [this.exp, a.x, a.y]);
        if (r.ok) c.moves++; else this.refuse('move', r.reason);
        return 'go';
      }
      case 'harvest': {
        const r = await this.s.rpc('warpath_harvest', [this.exp]);
        c.harvests++;
        if (r.ok) { c.harvest_taken++; return 'go'; }
        this.refuse('harvest', r.reason);
        // ⚠ First hero to a node takes it for the whole run (migration:1355).
        // With four players that is the commonest form of interference there is,
        // and it happens without the two ever seeing each other.
        if (r.reason === 'already_harvested') this.sim.noteNodeRace(this.name, st.me.x, st.me.y, st.run.turn);
        return 'go';
      }
      case 'pick': {
        const r = await this.s.rpc('warpath_encounter_pick', [a.enc, a.idx]);
        if (r.ok) c.picks++; else this.refuse('pick', r.reason);
        return 'go';
      }
      case 'camp': {
        const r = await this.s.rpc('warpath_camp_place', [this.exp]);
        if (!r.ok) this.refuse('camp', r.reason);
        return 'go';
      }
      case 'build': {
        const r = await this.s.rpc('warpath_camp_build', [this.exp, a.building]);
        if (r.ok) c.builds++; else this.refuse('build', `${a.building}/${r.reason}`);
        return 'go';
      }
      case 'secure': {
        const r = await this.s.rpc('warpath_secure', [this.exp]);
        if (r.ok) {
          c.secures++;
          this.vaultFull = !!(r.vault_full || r.no_vault);
          if (r.vault_full) c.vault_full = (c.vault_full || 0) + 1;
          if (r.no_vault)   c.no_vault   = (c.no_vault   || 0) + 1;
        }
        else this.refuse('secure', r.reason);
        return 'go';
      }
      case 'recruit': {
        const r = await this.s.rpc('warpath_recruit', [this.exp, a.site, a.idx]);
        if (r.ok) c.recruits++; else this.refuse('recruit', r.reason);
        return 'go';
      }
      case 'battle': {
        const r = await this.s.rpc('warpath_battle_open', [this.exp, a.target]);
        if (!r.ok) { c.pvp_refused++; this.refuse('battle', r.reason); return 'go'; }
        c.pvp_opened++;
        this.sim.notePvpOpen(this.name, a.target, st.run.turn, st.me.x, st.me.y);
        // ⚠ Client-authoritative, exactly like the shipping game: the battle is
        // played by the Mythic Spellbook engine (App.battlePrep -> vsScreen) and
        // only the verdict comes back here. The harness stands in for that engine
        // with a weighted coin, which is all warpath_battle_report can tell apart.
        const iWin = this.rand() < 0.55;
        const winner = iWin ? this.exp : a.target;
        const rep = await this.s.rpc('warpath_battle_report', [r.battle_id, winner]);
        if (rep.ok) { if (iWin) c.wins++; else c.losses++; this.sim.notePvpResolved(r.battle_id, winner, rep.spoils, this.name); }
        else this.refuse('battle_report', rep.reason);
        return 'go';
      }
      case 'guardian': {
        const r = await this.s.rpc('warpath_battle_open', [this.exp, null]);
        if (!r.ok) { this.refuse('guardian', r.reason); return 'go'; }
        c.guardian_opened++;
        const iWin = this.rand() < 0.5;
        await this.s.rpc('warpath_battle_report', [r.battle_id, iWin ? this.exp : null]);
        return 'go';
      }
      case 'resolve_stuck': {
        // I am a participant in an open battle nobody has reported. A real client
        // would be sitting on the vs-screen; this measures whether it can dig out,
        // because until it does warpath_move refuses with `battle_pending`.
        const rep = await this.s.rpc('warpath_battle_report', [a.battle, a.winner]);
        if (!rep.ok) this.refuse('battle_report', rep.reason);
        this.sim.noteStuckBattle(this.name, a.battle, rep.ok);
        return 'go';
      }
      case 'extract_begin': {
        const r = await this.s.rpc('warpath_extract_begin', [this.exp]);
        if (r.ok) c.extract_begin++; else this.refuse('extract_begin', r.reason);
        return 'go';
      }
      case 'extract_finish': {
        const r = await this.s.rpc('warpath_extract_finish', [this.exp, null]);
        if (r.ok) { c.extracted++; this.grant = r; this.done = true; return 'stop'; }
        this.refuse('extract_finish', r.reason);
        return 'go';
      }
      default: return 'stop';
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared opening moves every strategy wants: pitch the camp, take the free
// draft pick, clear a battle that is blocking movement.
// ─────────────────────────────────────────────────────────────────────────────
function common(st) {
  if (st.me.status === 'ready') return { op: 'extract_finish' };
  if (st.me.status === 'extracting') return null;
  if (st.me.status !== 'active') return null;

  // A battle open against me blocks warpath_move entirely (migration:1229-1232).
  const open = (st.battles || []).find(b => b.status === 'open');
  if (open) {
    const winner = open.attacker === st.me.expedition_id ? st.me.expedition_id : open.attacker;
    return { op: 'resolve_stuck', battle: open.id, winner };
  }
  if (!st.camp) return { op: 'camp' };
  if (st.encounter) {
    return { op: 'pick', enc: st.encounter.id,
             idx: Math.floor(this.rand() * st.encounter.offers.length) };
  }
  return undefined;   // undefined = "nothing common to do", null = "stop"
}

const nodeHere = (bot, st) => {
  const n = bot.map.node[st.me.y]?.[st.me.x];
  if (!n) return null;
  if ((st.claimed_nodes || []).some(c => c.x === st.me.x && c.y === st.me.y)) return null;
  return n;
};
const structHere = (bot, st) => bot.map.structures.find(s => s.x === st.me.x && s.y === st.me.y);

// ── BOLT: get to the gate, get out. ─────────────────────────────────────────
export async function rusher(st) {
  const c = common.call(this, st); if (c !== undefined) return c;
  const g = this.map.gates.find(x => x.main);

  if (st.me.status === 'extracting') return null;
  const s = structHere(this, st);
  if (s && s.k === 'gate' && st.run.turn >= 5) return { op: 'extract_begin' };

  if (nodeHere(this, st) && st.me.moves_left >= 1) return { op: 'harvest' };
  if (st.me.moves_left <= 0) return null;

  const step = this.stepToward(st, g.x, g.y);
  if (step) return { op: 'move', x: step.x, y: step.y };
  // Standing on the gate before turn 5 — bank whatever is nearby.
  const nodes = this.knownNodes(st);
  if (nodes.length) {
    const n = nodes.sort((a, b) => cheb(st.me.x, st.me.y, a.x, a.y) - cheb(st.me.x, st.me.y, b.x, b.y))[0];
    const t = this.stepToward(st, n.x, n.y);
    if (t) return { op: 'move', x: t.x, y: t.y };
  }
  return null;
}

// ── ANVIL: haul it home, build everything, leave last. ──────────────────────
export async function builder(st) {
  const c = common.call(this, st); if (c !== undefined) return c;
  if (st.me.status === 'extracting') return null;

  const camp = st.camp, atCamp = camp && camp.x === st.me.x && camp.y === st.me.y;
  const load = this.carried(st);

  if (atCamp) {
    if (load.bulk > 0 || load.mats > 0 || load.unsecuredCards > 0) return { op: 'secure' };
    for (const [b, lvl] of BUILD_PLAN) {
      const have = (camp.buildings || {})[b] || 0;
      if (have === lvl - 1 && !this.blockedBuild.has(`${b}${lvl}`)) {
        this.blockedBuild.add(`${b}${lvl}`);   // one attempt per turn
        return { op: 'build', building: b };
      }
    }
  }

  if (st.run.turn >= 50) {
    const g = this.nearestGate(st);
    const s = structHere(this, st);
    if (s && s.k === 'gate') return { op: 'extract_begin' };
    const step = this.stepToward(st, g.x, g.y);
    if (step) return { op: 'move', x: step.x, y: step.y };
    return null;
  }

  if (st.me.moves_left <= 0) return null;
  if (nodeHere(this, st)) return { op: 'harvest' };

  const s2 = structHere(this, st);
  if (s2 && s2.k === 'site' && !(st.recruited || []).includes(s2.id)) {
    const offer = this.sim.recruitOffers.filter(o => o.site_id === s2.id)
      .sort((a, b) => a.rank - b.rank)[0];
    if (offer) return { op: 'recruit', site: s2.id, idx: offer.idx };
  }

  // Full pack, or a lull: walk it home.
  if ((load.bulk >= 30 || load.mats >= 1 || load.unsecuredCards >= 2) && camp) {
    const step = this.stepToward(st, camp.x, camp.y);
    if (step) return { op: 'move', x: step.x, y: step.y };
    if (!atCamp) return null;
  }

  const nodes = this.knownNodes(st)
    .filter(n => !camp || cheb(camp.x, camp.y, n.x, n.y) <= 9)
    .sort((a, b) => cheb(st.me.x, st.me.y, a.x, a.y) - cheb(st.me.x, st.me.y, b.x, b.y));
  if (nodes.length) {
    const step = this.stepToward(st, nodes[0].x, nodes[0].y);
    if (step) return { op: 'move', x: step.x, y: step.y };
  }
  const f = this.frontierStep(st);
  return f ? { op: 'move', x: f.x, y: f.y } : null;
}

/* ── RAKE: hunt heroes. ──────────────────────────────────────────────────────
   ⚠ A hunter is not blind at the start of a run. wp_structures() is a pure
   function of the seed and warpath_state() hands the seed to every client, so
   the four spawn points — including the three that are not yours — are public
   knowledge on turn 1. warpath-mapgen.js already computes them in the browser.
   RAKE therefore patrols the other three spawns and the Warpath Gate rather
   than wandering, which is the strongest possible version of "someone actually
   tried to find you". If PvP still does not happen under this, it is not
   because the hunter was lazy. */
export async function hunter(st) {
  const c = common.call(this, st); if (c !== undefined) return c;
  if (st.me.status === 'extracting') return null;
  if (st.run.turn >= 54) {
    const s = structHere(this, st);
    if (s && s.k === 'gate') return { op: 'extract_begin' };
    const g = this.nearestGate(st);
    const step = this.stepToward(st, g.x, g.y);
    if (step) return { op: 'move', x: step.x, y: step.y };
  }
  if (st.me.moves_left <= 0) return null;

  // 1. Someone in line of sight.
  const seen = (st.others || []).filter(o => o.visible && o.x != null
                                          && (o.status === 'active' || o.status === 'extracting'));
  if (seen.length) {
    const foe = seen.sort((a, b) => cheb(st.me.x, st.me.y, a.x, a.y) - cheb(st.me.x, st.me.y, b.x, b.y))[0];
    if (cheb(st.me.x, st.me.y, foe.x, foe.y) <= 1) {
      if (st.me.moves_left >= 2) return { op: 'battle', target: foe.expedition_id };
      return null;
    }
    const step = this.stepToward(st, foe.x, foe.y, { adjacent: true });
    if (step) return { op: 'move', x: step.x, y: step.y };
  }

  // 2. The extraction broadcast — public, and it carries coordinates.
  if (this.extractionBeacon && st.run.turn - this.extractionBeacon.turn <= 3) {
    const b = this.extractionBeacon;
    if (cheb(st.me.x, st.me.y, b.x, b.y) > 1) {
      const step = this.stepToward(st, b.x, b.y, { adjacent: true });
      if (step) return { op: 'move', x: step.x, y: step.y };
    }
  }

  // 3. A camp I have discovered — rivals come home to it.
  let target = null, bd = Infinity;
  for (const [, v] of this.rivalCamps) {
    const d = cheb(st.me.x, st.me.y, v.x, v.y);
    if (d < bd) { bd = d; target = v; }
  }
  // 4. A stale sighting.
  for (const [, v] of this.lastSeen) {
    if (st.run.turn - v.turn > 8) continue;
    const d = cheb(st.me.x, st.me.y, v.x, v.y);
    if (d < bd) { bd = d; target = v; }
  }
  if (target && bd > 2) {
    const step = this.stepToward(st, target.x, target.y, { adjacent: true });
    if (step) return { op: 'move', x: step.x, y: step.y };
  }
  // Stake it out. Wandering off a rival's camp is how a hunter with real intel
  // still never meets anyone: 2-tile vision means you have to be standing where
  // they will be, not near where they were.
  if (target && bd <= 2) {
    if (nodeHere(this, st)) return { op: 'harvest' };
    return null;
  }

  if (nodeHere(this, st)) return { op: 'harvest' };
  const s3 = structHere(this, st);
  if (s3 && s3.k === 'landmark' && s3.guardian) return { op: 'guardian' };

  // 5. Patrol: the three rival spawn points, then the Warpath Gate, on a loop.
  if (!this.patrol) {
    const mine = this.map.structures.find(s => s.k === 'spawn' && s.slot === this.slot);
    this.patrol = this.map.structures
      .filter(s => s.k === 'spawn' && s.slot !== this.slot)
      .sort((a, b) => cheb(mine.x, mine.y, a.x, a.y) - cheb(mine.x, mine.y, b.x, b.y))
      .concat(this.map.gates.filter(g => g.main));
    this.patrolAt = 0;
  }
  const wp = this.patrol[this.patrolAt % this.patrol.length];
  if (cheb(st.me.x, st.me.y, wp.x, wp.y) <= 2) { this.patrolAt++; }
  const step = this.stepToward(st, wp.x, wp.y);
  if (step) return { op: 'move', x: step.x, y: step.y };
  const f = this.frontierStep(st);
  return f ? { op: 'move', x: f.x, y: f.y } : null;
}

// ── DELVE: push deep for materials, bank late. ──────────────────────────────
export async function greedy(st) {
  const c = common.call(this, st); if (c !== undefined) return c;
  if (st.me.status === 'extracting') return null;
  const load = this.carried(st);
  const camp = st.camp;

  if (st.run.turn >= 46 || (load.mats >= 4 && st.run.turn >= 30)) {
    const s = structHere(this, st);
    if (s && s.k === 'gate' && (load.mats === 0 || st.run.turn >= 52)) return { op: 'extract_begin' };
    // Bank first if there is anything to bank AND a vault with room in it.
    // A full vault is a dead end: warpath_secure leaves the overflow carried
    // (migration:1498-1505), so a bot that keeps walking home never leaves.
    if (camp && !this.vaultFull && (load.mats > 0 || load.unsecuredCards > 0)) {
      if (camp.x === st.me.x && camp.y === st.me.y) return { op: 'secure' };
      const step = this.stepToward(st, camp.x, camp.y);
      if (step) return { op: 'move', x: step.x, y: step.y };
    }
    const g = this.nearestGate(st);
    const step = this.stepToward(st, g.x, g.y);
    if (step) return { op: 'move', x: step.x, y: step.y };
    return null;
  }

  if (st.me.moves_left <= 0) return null;
  if (nodeHere(this, st)) return { op: 'harvest' };

  if (camp && camp.x === st.me.x && camp.y === st.me.y
      && (load.bulk > 0 || load.mats > 0 || load.unsecuredCards > 0)) return { op: 'secure' };

  // A Supply Tent is the only thing that makes a material survive a mugging,
  // so even the greedy bot buys one — once.
  if (camp && camp.x === st.me.x && camp.y === st.me.y && !(camp.buildings || {}).supply
      && !this.triedSupply) { this.triedSupply = true; return { op: 'build', building: 'supply' }; }

  const mats = this.knownNodes(st, { materialsOnly: true });
  if (mats.length) {
    const n = mats.sort((a, b) => cheb(st.me.x, st.me.y, a.x, a.y) - cheb(st.me.x, st.me.y, b.x, b.y))[0];
    const step = this.stepToward(st, n.x, n.y);
    if (step) return { op: 'move', x: step.x, y: step.y };
  }
  const s4 = structHere(this, st);
  if (s4 && s4.k === 'landmark' && s4.guardian) return { op: 'guardian' };

  const nodes = this.knownNodes(st)
    .sort((a, b) => cheb(st.me.x, st.me.y, a.x, a.y) - cheb(st.me.x, st.me.y, b.x, b.y));
  if (nodes.length && this.rand() < 0.5) {
    const step = this.stepToward(st, nodes[0].x, nodes[0].y);
    if (step) return { op: 'move', x: step.x, y: step.y };
  }
  const f = this.frontierStep(st);
  return f ? { op: 'move', x: f.x, y: f.y } : null;
}

export const STRATEGIES = { rusher, builder, hunter, greedy };
export { BUILD_PLAN };
