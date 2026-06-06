// ============================================================================
// ⚔ BattleRoom — one room per multiplayer match
// ----------------------------------------------------------------------------
// Lifecycle (Colyseus):
//   onCreate(options)   — room is being created. options.matchId comes from
//                         the joinOrCreate call; we tag the room so the
//                         filterBy in index.ts pairs both clients here.
//   onAuth(client, opts) — verifies the Supabase JWT in opts.authToken and
//                         returns the userId/email. Rejecting throws.
//   onJoin(client, opts, authResult) — auth has passed. Add player to state.
//   onMessage(handlers) — every action the client can send.
//   onLeave(client, consented) — client disconnected. If consented, remove;
//                         otherwise hold a 30s reconnect window before
//                         declaring DC.
//   onDispose() — room is closing. Persist final winner_id to Supabase if
//                 the match ended naturally; otherwise mark it abandoned.
//
// Source of truth for game logic stays HERE. Clients send action payloads;
// we validate + mutate BattleState. Colyseus auto-broadcasts deltas.
// ============================================================================

import { Room, Client } from '@colyseus/core';
import { ArraySchema }   from '@colyseus/schema';
import {
  BattleState, PlayerState, Unit, StatusEffect,
} from '../schema/BattleState';
import { verifySupabaseToken, isDevAuthBypass, AuthResult } from '../auth';
import {
  calculateDamage, applyDamageTriggers, tickStatusDamage,
  MoveInput, UnitInput, StatusEntry,
} from '../engine/damage';

const MAX_CLIENTS        = 2;
// Reconnect grace before a dropped client forfeits. Env-tunable so tests can
// shorten it and ops can adjust without a code change. Defaults to 30s.
const RECONNECT_WINDOW_S = parseInt(process.env.RECONNECT_WINDOW_S || '30', 10);
const TURN_TIMEOUT_MS    = 120_000; // 2 minutes per turn

// ─── Join options ─────────────────────────────────────────────────────────────
export interface BattleRoomCreateOptions {
  matchId: string;
  player1Id?: string;
  player2Id?: string;
}

export interface BattleRoomJoinOptions {
  matchId: string;
  authToken: string;
  displayName?: string;
  heroId?: string;
  deckCardIds?: string[];
}

// ─── Action payload shapes ───────────────────────────────────────────────────
// Clients send typed 'action' messages. The `type` field dispatches to the
// correct handler. All fields beyond `type` are validated server-side before
// any state mutation happens.

interface AttackAction {
  type: 'attack';
  attackerId: string;   // unit ID in BattleState.units (server validates owner)
  targetId:   string;   // unit ID in BattleState.units
  move: {               // move def echoed from client (thin-trust in Session 2)
    id: string;
    name?: string;
    power?: number;
    accuracy?: number;
    type?: 'physical' | 'magic';
    element?: string;
    crit?: number;
    effect?: string;
  };
}

interface PlayUnitAction {
  type: 'playUnit';
  cardId:   string;
  name:     string;
  icon?:    string;
  posX:     number;
  posY:     number;
  energyCost: number;
  isHero?:  boolean;
  stats: {
    hp:  number;
    atk: number;
    def: number;
    mag: number;
    res: number;
    spd: number;
  };
  elements?: string[];   // stored on Unit.elementsJson
  passives?: string[];   // stored on Unit.passivesJson
}

interface MoveUnitAction {
  type: 'move';
  unitId: string;
  posX:   number;
  posY:   number;
}

type ActionPayload = AttackAction | PlayUnitAction | MoveUnitAction | { type: string };

// ─── Room class ───────────────────────────────────────────────────────────────
export class BattleRoom extends Room<BattleState> {
  maxClients = MAX_CLIENTS;
  autoDispose = true;

  private turnTimer: NodeJS.Timeout | null = null;

  // 📸 STAGED "server-owns-match" path — latest authoritative board snapshot
  // each player has sent, keyed by userId. The client engine stays the source
  // of board truth in this stage; the SERVER owns only turn order, match end,
  // and disconnect handling. Snapshots are kept OFF the schema on purpose:
  // they are perspective-mirrored per client, so we forward them point-to-point
  // (relay) and replay the opponent's latest to a reconnecting client, instead
  // of broadcasting via state diffing. (The schema-driven engine handlers below
  // remain for the later "deepen toward full authority" stage.)
  private lastSnapshotByUser: Record<string, string> = {};

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  onCreate(options: BattleRoomCreateOptions) {
    console.log('[battle] onCreate', options);
    this.setState(new BattleState());
    this.state.matchId = String(options.matchId || '');

    // ─ Message handlers ──────────────────────────────────────────────────────
    this.onMessage('ready', (client, _payload) => {
      const p = this.state.players.get(client.userData?.userId);
      if (!p) return;
      // Session 2: once both players are ready, trigger startMatch again to
      // broadcast matchStart if both have joined but the coin flip was missed.
      if (this.state.players.size === MAX_CLIENTS && !this.state.currentTurnUserId) {
        this.startMatch();
      }
    });

    this.onMessage('endTurn', (client, _payload) => {
      this.handleEndTurn(client);
    });

    this.onMessage('action', (client, payload) => {
      this.handleAction(client, payload as ActionPayload);
    });

    this.onMessage('emote', (client, payload) => {
      this.broadcast('emote', {
        from: client.userData?.userId,
        emoji: String(payload?.emoji || '').slice(0, 8),
        ts: Date.now(),
      }, { except: client });
    });

    this.onMessage('forfeit', (client, _payload) => {
      const me = client.userData?.userId;
      if (!me || this.state.winnerUserId) return;
      const opp = this.opponentOf(me);
      if (opp) this.endMatch(opp, 'forfeit');
    });

    // 📸 Board snapshot relay (staged path) — the client that just acted sends
    // its authoritative board state; we remember it (for reconnect resync) and
    // forward it to the opponent. The payload is opaque to the server here: the
    // client engine remains the source of board truth, while the server owns
    // turn order, match end, and disconnect handling.
    this.onMessage('snapshot', (client, payload) => {
      const me = client.userData?.userId;
      if (!me || !this.state.players.has(me) || this.state.winnerUserId) return;
      const kind = (payload && typeof payload.kind === 'string') ? payload.kind : 'full';
      const body = (payload && typeof payload === 'object' && 'payload' in payload) ? payload.payload : payload;
      // Only remember FULL snapshots as the resync baseline — a lone delta can't
      // rebuild a reconnecting client. Deltas still relay live to the opponent.
      if (kind === 'full') {
        try { this.lastSnapshotByUser[me] = JSON.stringify(body); } catch { /* no-op */ }
      }
      // 2-client room → except-sender is exactly the opponent.
      this.broadcast('snapshot', { from: me, kind, payload: body }, { except: client });
    });

    // 🏁 Authoritative match result — the SINGLE writer. Either client may
    // report the outcome it observed on its synced board (typically the loser
    // reporting "my hero died"); the FIRST valid claim wins and is broadcast to
    // both. Replaces the old client-vs-client double-submit race that produced
    // wrong/duplicate win-loss results.
    this.onMessage('claimResult', (client, payload) => {
      const me = client.userData?.userId;
      if (!me || !this.state.players.has(me) || this.state.winnerUserId) return;
      const winner = String(payload?.winnerUserId || '');
      if (!winner || !this.state.players.has(winner)) {
        console.warn('[battle] claimResult: invalid winner', payload);
        return;
      }
      const reason = String(payload?.reason || 'hero-killed').slice(0, 32);
      console.log('[battle] claimResult accepted', { from: me, winner, reason });
      this.endMatch(winner, reason);
    });
  }

  async onAuth(_client: Client, options: BattleRoomJoinOptions): Promise<AuthResult> {
    if (isDevAuthBypass()) {
      return {
        userId: 'dev-' + Math.random().toString(36).slice(2, 10),
        email: 'dev@local',
        role: 'authenticated',
        raw: {} as any,
      };
    }
    return verifySupabaseToken(options.authToken);
  }

  onJoin(client: Client, options: BattleRoomJoinOptions, auth: AuthResult) {
    console.log('[battle] onJoin', { matchId: this.state.matchId, userId: auth.userId });
    client.userData = { userId: auth.userId, email: auth.email };
    // Tell the joining client its own server-side userId + matchId. Handy for
    // clients that don't already know it (e.g. the dev-bypass test harness) and
    // a robust cross-check for the live client's perspective mapping.
    try { client.send('welcome', { userId: auth.userId, matchId: this.state.matchId }); } catch { /* no-op */ }

    const existing = this.state.players.get(auth.userId);
    if (existing) {
      existing.connected  = true;
      existing.lastSeenAt = Date.now();
      console.log('[battle] reconnect — restoring', auth.userId);
      // Resync the reconnecting client with the opponent's most recent FULL
      // board snapshot so it never lands on a stale/empty board.
      const opp = this.opponentOf(auth.userId);
      const snap = opp ? this.lastSnapshotByUser[opp] : '';
      if (snap) {
        try {
          client.send('snapshot', { from: opp, kind: 'full', payload: JSON.parse(snap), resync: true });
        } catch { /* no-op */ }
      }
      return;
    }

    const p = new PlayerState();
    p.userId      = auth.userId;
    p.displayName = String(options.displayName || auth.email || auth.userId.slice(0, 8));
    p.heroId      = String(options.heroId || '');
    p.connected   = true;
    p.lastSeenAt  = Date.now();
    p.energy      = 1;
    p.maxEnergy   = 1;
    p.deckSize    = Array.isArray(options.deckCardIds) ? options.deckCardIds.length : 0;
    this.state.players.set(auth.userId, p);

    if (this.state.players.size === MAX_CLIENTS && !this.state.currentTurnUserId) {
      this.startMatch();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const userId = client.userData?.userId;
    if (!userId) return;
    const p = this.state.players.get(userId);
    if (!p) return;
    p.connected  = false;
    p.lastSeenAt = Date.now();
    console.log('[battle] onLeave', { userId, consented });

    if (consented || this.state.winnerUserId) return;

    try {
      await this.allowReconnection(client, RECONNECT_WINDOW_S);
      p.connected  = true;
      p.lastSeenAt = Date.now();
    } catch {
      if (!this.state.winnerUserId) {
        const opp = this.opponentOf(userId);
        if (opp) this.endMatch(opp, 'disconnect');
      }
    }
  }

  async onDispose() {
    console.log('[battle] onDispose', { matchId: this.state.matchId, winner: this.state.winnerUserId });
    if (this.turnTimer) { try { clearTimeout(this.turnTimer); } catch { /* no-op */ } }
    // Winner is persisted to Supabase in endMatch() (race-gated). onDispose only
    // tears down timers — no extra write needed here.
  }

  // ─── Match flow ─────────────────────────────────────────────────────────────
  private startMatch() {
    const ids = Array.from(this.state.players.keys());
    // 🎲 One shared match seed — the single source of randomness both clients
    // derive from (coin flip, deck shuffle, draws, crits) so they compute the
    // SAME game. Synced via the schema (state.seed) AND echoed in matchStart.
    const seed = (Math.floor(Math.random() * 0x7ffffffe) + 1) | 0;
    this.state.seed = seed;
    // 🪙 Real coin flip — first mover derived from the seed: fair (random) AND
    // reproducible/verifiable from the shared seed. (Was a fixed sorted()[0],
    // which always handed the same player the opening turn.)
    const first = ids[seed % Math.max(1, ids.length)];
    this.state.firstUserId       = first;
    this.state.currentTurnUserId = first;
    this.state.turnNumber        = 1;
    console.log('[battle] match start — seed=' + seed + ' first=' + first);
    this.armTurnTimer();
    this.broadcast('matchStart', { first, seed, participants: ids });
  }

  private handleEndTurn(client: Client) {
    const me = client.userData?.userId;
    if (!me || this.state.winnerUserId) return;
    if (this.state.currentTurnUserId !== me) {
      try { client.send('reject', { reason: 'not-your-turn' }); } catch { /* no-op */ }
      return;
    }

    const opp = this.opponentOf(me);
    if (!opp) return;

    // Flip turn
    this.state.currentTurnUserId = opp;
    this.state.turnNumber++;

    // Reset per-turn flags on the units of the now-active player.
    this.state.units.forEach(u => {
      if (u.ownerUserId === opp && u.alive) {
        u.hasMoved     = false;
        u.hasAttacked  = false;
        u.usedPriority = false;
      }
    });

    // Refresh energy for the new active player.
    const p = this.state.players.get(opp);
    if (p) {
      p.maxEnergy = Math.min(10, p.maxEnergy + 1);
      p.energy    = p.maxEnergy;
    }

    // Run turn-start status ticks (DoTs, doom checks) on the now-active side.
    this.tickStatusesForPlayer(opp);

    this.armTurnTimer();
    console.log('[battle] turn → ' + opp + ' (turn ' + this.state.turnNumber + ')');
  }

  // ─── Action dispatcher ──────────────────────────────────────────────────────
  private handleAction(client: Client, payload: ActionPayload) {
    const me = client.userData?.userId;
    if (!me || this.state.winnerUserId) return;
    if (this.state.currentTurnUserId !== me) {
      try { client.send('reject', { reason: 'not-your-turn' }); } catch { /* no-op */ }
      return;
    }

    switch (payload.type) {
      case 'attack':   return this.handleAttack(me,  payload as AttackAction);
      case 'playUnit': return this.handlePlayUnit(me, payload as PlayUnitAction);
      case 'move':     return this.handleMoveUnit(me, payload as MoveUnitAction);
      default:
        console.warn('[battle] unknown action type:', payload.type);
    }
  }

  // ─── attack ─────────────────────────────────────────────────────────────────
  private handleAttack(userId: string, payload: AttackAction) {
    const attSchema = this.state.units.get(payload.attackerId);
    const defSchema = this.state.units.get(payload.targetId);

    // Basic ownership + liveness guards
    if (!attSchema || !defSchema) {
      console.warn('[battle] attack: unit not found', payload);
      return;
    }
    if (attSchema.ownerUserId !== userId) {
      console.warn('[battle] attack: attacker not owned by sender', payload.attackerId, userId);
      return;
    }
    if (!attSchema.alive || !defSchema.alive) {
      console.warn('[battle] attack: target/attacker is dead');
      return;
    }
    if (attSchema.hasAttacked) {
      console.warn('[battle] attack: unit already attacked this turn', payload.attackerId);
      return;
    }

    // Build UnitInput from schema state + stored card-static data
    const attInput  = unitToInput(attSchema);
    const defInput  = unitToInput(defSchema);
    const moveInput = buildMove(payload.move);
    const weather   = this.state.weather
      ? { type: this.state.weather, turnsLeft: this.state.weatherTurnsLeft }
      : undefined;

    // Server-authoritative damage calculation
    const dmgResult = calculateDamage(moveInput, attInput, defInput, weather);
    console.log(
      `[battle] attack ${payload.attackerId}→${payload.targetId}` +
      ` dmg=${dmgResult.damage} (${dmgResult.effectiveness})` +
      (dmgResult.crit ? ' CRIT' : '') + (dmgResult.missed ? ' MISS' : ''),
    );

    if (!dmgResult.missed && dmgResult.damage > 0) {
      const trigResult = applyDamageTriggers(defInput, dmgResult.damage, moveInput.type || 'physical');

      // Write damage + survival state back to the schema
      defSchema.currentHp  = trigResult.unit.currentHp;
      defSchema.alive       = trigResult.unit.alive;
      defSchema.sturdyUsed  = !!trigResult.unit.sturdyUsed;

      // Broadcast log lines to both clients so they can show the hit feedback
      if (trigResult.log.length) {
        this.broadcast('battleLog', { entries: trigResult.log });
      }
    }

    // Mark attacker as having attacked
    attSchema.hasAttacked = true;

    // Broadcast the resolved event (damage, miss, crit) for client animations
    this.broadcast('attackResult', {
      attackerId:    payload.attackerId,
      targetId:      payload.targetId,
      moveId:        payload.move.id,
      damage:        dmgResult.damage,
      missed:        dmgResult.missed,
      crit:          dmgResult.crit,
      typeMul:       dmgResult.typeMul,
      effectiveness: dmgResult.effectiveness,
      stab:          dmgResult.stab,
      defHp:         defSchema.currentHp,
      defAlive:      defSchema.alive,
    });

    // Win-condition: hero died?
    if (!defSchema.alive && defSchema.isHero) {
      this.endMatch(userId, 'hero-killed');
    }
  }

  // ─── playUnit ───────────────────────────────────────────────────────────────
  private handlePlayUnit(userId: string, payload: PlayUnitAction) {
    const p = this.state.players.get(userId);
    if (!p) return;

    // Energy guard
    const cost = Math.max(0, payload.energyCost | 0);
    if (p.energy < cost) {
      try {
        this.state.players.forEach((_v, _k) => {
          // noop — just need a reference; energy check is on `p`
        });
      } catch { /* no-op */ }
      console.warn('[battle] playUnit: not enough energy', { have: p.energy, need: cost });
      return;
    }

    // Validate stats
    const stats = payload.stats || {};
    const hp  = Math.max(1,  (stats.hp  || 10) | 0);
    const atk = Math.max(0,  (stats.atk || 5)  | 0);
    const def = Math.max(0,  (stats.def || 2)  | 0);
    const mag = Math.max(0,  (stats.mag || 3)  | 0);
    const res = Math.max(0,  (stats.res || 2)  | 0);
    const spd = Math.max(1,  (stats.spd || 1)  | 0);

    const u        = new Unit();
    u.id           = `unit_${userId.slice(0, 6)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    u.cardId       = String(payload.cardId || '');
    u.ownerUserId  = userId;
    u.name         = String(payload.name || payload.cardId || 'Unknown').slice(0, 40);
    u.icon         = String(payload.icon || '').slice(0, 8);
    u.isHero       = !!payload.isHero;
    u.alive        = true;
    u.posX         = Math.max(0, Math.min(15, payload.posX | 0));
    u.posY         = Math.max(0, Math.min(11, payload.posY | 0));
    u.currentHp    = hp;
    u.maxHp        = hp;
    u.atk          = atk;
    u.def          = def;
    u.mag          = mag;
    u.res          = res;
    u.spd          = spd;
    u.hasMoved     = false;
    u.hasAttacked  = false;
    u.usedPriority = false;
    u.sturdyUsed   = false;
    u.elementsJson = JSON.stringify(
      Array.isArray(payload.elements) ? payload.elements.filter(e => typeof e === 'string') : [],
    );
    u.passivesJson = JSON.stringify(
      Array.isArray(payload.passives) ? payload.passives.filter(e => typeof e === 'string') : [],
    );

    this.state.units.set(u.id, u);

    // Deduct energy
    p.energy -= cost;

    console.log('[battle] playUnit', { id: u.id, owner: userId, name: u.name, cost });

    this.broadcast('unitPlayed', {
      unitId:  u.id,
      cardId:  u.cardId,
      ownerId: userId,
      posX:    u.posX,
      posY:    u.posY,
    });
  }

  // ─── move ───────────────────────────────────────────────────────────────────
  private handleMoveUnit(userId: string, payload: MoveUnitAction) {
    const u = this.state.units.get(payload.unitId);
    if (!u || !u.alive || u.ownerUserId !== userId) {
      console.warn('[battle] move: invalid unit', payload.unitId);
      return;
    }
    if (u.hasMoved) {
      console.warn('[battle] move: unit already moved this turn', payload.unitId);
      return;
    }

    u.posX    = Math.max(0, Math.min(15, payload.posX | 0));
    u.posY    = Math.max(0, Math.min(11, payload.posY | 0));
    u.hasMoved = true;

    console.log('[battle] moveUnit', { id: u.id, posX: u.posX, posY: u.posY });
  }

  // ─── Status tick ────────────────────────────────────────────────────────────
  /**
   * Run turn-start DoT ticks on every living unit owned by `userId`.
   * Called by handleEndTurn after the turn flips to that player.
   */
  private tickStatusesForPlayer(userId: string) {
    const dead: string[] = [];
    this.state.units.forEach((u, unitId) => {
      if (u.ownerUserId !== userId || !u.alive) return;
      const input = unitToInput(u);
      const events = tickStatusDamage(input, 'turnStart');

      for (const ev of events) {
        const trig = applyDamageTriggers(input, ev.damage, ev.type);
        // Write results back to schema
        u.currentHp = trig.unit.currentHp;
        u.alive      = trig.unit.alive;
        u.sturdyUsed = !!trig.unit.sturdyUsed;

        if (trig.log.length) {
          this.broadcast('battleLog', { entries: trig.log });
        }

        // Increment tickCount on the status entry
        const se = Array.from(u.statusEffects).find(e => e.id === ev.statusId);
        if (se) se.tickCount++;

        if (!u.alive && u.isHero) dead.push(unitId);
      }

      // Doom: koOnExpire — die when turns reach 0
      const doomIdx = Array.from(u.statusEffects).findIndex(
        e => e.id === 'doom' && e.turns <= 0,
      );
      if (doomIdx >= 0) {
        u.alive      = false;
        u.currentHp  = 0;
        this.broadcast('battleLog', { entries: [{ msg: `💀 ${u.name} perished to Mortal Sentence!`, color: 'red' }] });
        if (u.isHero) dead.push(unitId);
      }

      // Decrement status turns
      const toRemove: string[] = [];
      u.statusEffects.forEach((se, idx) => {
        se.turns--;
        if (se.turns <= 0) toRemove.push(String(idx));
      });
      // Remove expired statuses (iterate backwards by index)
      for (let i = u.statusEffects.length - 1; i >= 0; i--) {
        if ((u.statusEffects[i]?.turns ?? 1) <= 0) {
          u.statusEffects.splice(i, 1);
        }
      }
    });

    // Hero death from DoT → opponent wins
    if (dead.length) {
      const heroUnit = this.state.units.get(dead[0]);
      if (heroUnit) {
        const opp = this.opponentOf(heroUnit.ownerUserId);
        if (opp && !this.state.winnerUserId) this.endMatch(opp, 'hero-killed');
      }
    }
  }

  // ─── Turn timer ─────────────────────────────────────────────────────────────
  private armTurnTimer() {
    if (this.turnTimer) { try { clearTimeout(this.turnTimer); } catch { /* no-op */ } }
    this.turnTimer = setTimeout(() => {
      if (this.state.winnerUserId) return;
      console.log('[battle] turn timer expired — auto-ending turn');
      const opp = this.opponentOf(this.state.currentTurnUserId);
      if (opp) {
        this.state.currentTurnUserId = opp;
        this.state.turnNumber++;
        this.armTurnTimer();
      }
    }, TURN_TIMEOUT_MS);
  }

  // ─── endMatch ───────────────────────────────────────────────────────────────
  private endMatch(winnerUserId: string, reason: string) {
    if (this.state.winnerUserId) return;
    this.state.winnerUserId = winnerUserId;
    this.state.endReason    = reason;
    this.state.endedAt      = Date.now();
    if (this.turnTimer) { try { clearTimeout(this.turnTimer); } catch { /* no-op */ } }
    console.log('[battle] endMatch', { winner: winnerUserId, reason });
    // 🏁 Persist the authoritative winner to Supabase (race-gated single write).
    // Fire-and-forget so the victory broadcast isn't delayed by the network call.
    void persistMatchWinner(this.state.matchId, winnerUserId);
    this.broadcast('matchEnd', {
      winnerUserId,
      reason,
      turnNumber: this.state.turnNumber,
    });
    // Tear down after 10s so clients can render victory screens.
    this.clock.setTimeout(() => this.disconnect(), 10_000);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  private opponentOf(userId: string): string {
    for (const id of this.state.players.keys()) {
      if (id !== userId) return id;
    }
    return '';
  }
}

// ─── Pure helpers (module-level, no `this`) ──────────────────────────────────

// 🏁 Persist the authoritative match winner to Supabase via a service-role,
// race-gated PATCH — it only writes when winner_id is still NULL, so a late
// legacy-client write can't clobber the server's verdict (and vice-versa).
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars; no-ops (with a
// warning) when unset so local/dev runs don't fail. Uses Node 20+ global fetch.
async function persistMatchWinner(matchId: string, winnerUserId: string): Promise<void> {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !key) { console.warn('[battle] winner persist skipped — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to enable'); return; }
  if (!matchId || !winnerUserId) return;
  try {
    const endpoint = `${base}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}&winner_id=is.null`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ winner_id: winnerUserId, status: 'complete' }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[battle] winner persist HTTP', res.status, txt);
      return;
    }
    const rows = await res.json().catch(() => []);
    console.log('[battle] winner persisted', { matchId, winnerUserId, rows: Array.isArray(rows) ? rows.length : 0 });
  } catch (e) {
    console.warn('[battle] winner persist error', e);
  }
}

/** Convert a schema Unit to the flat UnitInput shape the damage engine expects. */
function unitToInput(u: Unit): UnitInput {
  let elements: string[] = [];
  let passives: string[] = [];
  try { elements = JSON.parse(u.elementsJson || '[]'); } catch { /* noop */ }
  try { passives = JSON.parse(u.passivesJson || '[]'); } catch { /* noop */ }

  const statusEffects: StatusEntry[] = Array.from(u.statusEffects).map(
    (se: StatusEffect): StatusEntry => ({
      id:           se.id,
      turns:        se.turns,
      sourceUnitId: se.sourceUnitId || undefined,
      tickCount:    se.tickCount,
    }),
  );

  return {
    id:          u.id,
    currentHp:   u.currentHp,
    maxHp:       u.maxHp,
    atk:         u.atk,
    def:         u.def,
    mag:         u.mag,
    res:         u.res,
    spd:         u.spd,
    isHero:      u.isHero,
    alive:       u.alive,
    hasAttacked: u.hasAttacked,
    stageAtk:    u.stageAtk,
    stageDef:    u.stageDef,
    stageMag:    u.stageMag,
    stageRes:    u.stageRes,
    stageSpd:    u.stageSpd,
    statusEffects,
    elements,
    passives,
    sturdyUsed:  u.sturdyUsed,
  };
}

/** Coerce the client's move payload to the strongly-typed MoveInput shape. */
function buildMove(raw: AttackAction['move']): MoveInput {
  return {
    id:       String(raw.id || 'unknown'),
    name:     String(raw.name || raw.id || 'Unknown'),
    power:    typeof raw.power    === 'number' ? Math.max(0, raw.power    | 0)  : undefined,
    accuracy: typeof raw.accuracy === 'number' ? Math.max(0, raw.accuracy | 0)  : undefined,
    type:     raw.type === 'magic' ? 'magic' : 'physical',
    element:  typeof raw.element  === 'string' ? raw.element  : undefined,
    crit:     typeof raw.crit     === 'number' ? Math.max(0, raw.crit     | 0)  : undefined,
    effect:   typeof raw.effect   === 'string' ? raw.effect   : undefined,
  };
}
