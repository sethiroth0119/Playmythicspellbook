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
// Source of truth for game logic stays HERE (not on clients). Clients send
// "I want to play card X" / "I want to attack with unit Y"; we validate +
// mutate the BattleState. The mutation is automatically broadcast to all
// connected clients via @colyseus/schema deltas — no manual serialization.
// ============================================================================

import { Room, Client } from '@colyseus/core';
import { BattleState, PlayerState, Unit } from '../schema/BattleState';
import { verifySupabaseToken, isDevAuthBypass, AuthResult } from '../auth';

const MAX_CLIENTS = 2;
const RECONNECT_WINDOW_MS = 30000;
const TURN_TIMEOUT_MS = 120000; // 2 minutes per turn

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
  // Decks come from the existing Supabase matchmaking row — clients echo
  // them here on join so the server has the cards it needs to compute
  // damage / draws without an extra DB roundtrip per action.
  deckCardIds?: string[];
}

export class BattleRoom extends Room<BattleState> {
  maxClients = MAX_CLIENTS;
  autoDispose = true;

  // Turn timer per active player. Reset on every turn-flip.
  private turnTimer: NodeJS.Timeout | null = null;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────
  onCreate(options: BattleRoomCreateOptions) {
    console.log('[battle] onCreate', options);
    this.setState(new BattleState());
    this.state.matchId = String(options.matchId || '');

    // ─── Action handlers ─────────────────────────────────────────────────────
    // Every action the client can send. The handler is called with the
    // SENDING client + the message payload. We validate, mutate state,
    // and Colyseus auto-broadcasts deltas to all connected clients.

    this.onMessage('ready', (client, _payload) => {
      const p = this.state.players.get(client.userData?.userId);
      if (!p) return;
      // (Session 2: handle ready-up + flip first-turn when both ready.)
    });

    this.onMessage('endTurn', (client, _payload) => {
      this.handleEndTurn(client);
    });

    this.onMessage('action', (client, payload) => {
      // Placeholder for Session 2 — payload describes what the player did:
      //   { type: 'playUnit' | 'playSpell' | 'move' | 'attack' | 'useAbility', ... }
      // We'll validate against state + apply via the ported engine.
      this.handleAction(client, payload);
    });

    this.onMessage('emote', (client, payload) => {
      // Broadcast to the other client (and self for confirmation).
      // Pure ephemeral; never stored.
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

    // 🩹 Resync handshake — handled implicitly by Colyseus; new joins and
    // reconnects receive the full state. We don't need explicit 'resync'
    // events like the old Supabase Realtime layer.
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
    const auth = await verifySupabaseToken(options.authToken);
    // Optional gate: only allow joining the matchId if userId is one of the
    // two listed players. We trust the existing Supabase matchmaking row
    // for the pairing — Session 2 will fetch + verify the row here.
    return auth;
  }

  onJoin(client: Client, options: BattleRoomJoinOptions, auth: AuthResult) {
    console.log('[battle] onJoin', { matchId: this.state.matchId, userId: auth.userId });
    client.userData = { userId: auth.userId, email: auth.email };

    // Reconnect? If the player was already in state, just mark them connected.
    const existing = this.state.players.get(auth.userId);
    if (existing) {
      existing.connected = true;
      existing.lastSeenAt = Date.now();
      console.log('[battle] reconnect — restoring', auth.userId);
      return;
    }

    // Fresh join — create the player record.
    const p = new PlayerState();
    p.userId = auth.userId;
    p.displayName = String(options.displayName || auth.email || auth.userId.slice(0, 8));
    p.heroId = String(options.heroId || '');
    p.connected = true;
    p.lastSeenAt = Date.now();
    p.energy = 1;
    p.maxEnergy = 1;
    p.deckSize = Array.isArray(options.deckCardIds) ? options.deckCardIds.length : 0;
    this.state.players.set(auth.userId, p);

    // Once both players have joined, start the match.
    if (this.state.players.size === MAX_CLIENTS && !this.state.currentTurnUserId) {
      this.startMatch();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const userId = client.userData?.userId;
    if (!userId) return;
    const p = this.state.players.get(userId);
    if (!p) return;
    p.connected = false;
    p.lastSeenAt = Date.now();
    console.log('[battle] onLeave', { userId, consented });

    if (consented || this.state.winnerUserId) {
      // Clean exit OR match already ended — no DC handling.
      return;
    }

    // Hold a reconnect window — Colyseus has a built-in helper for this.
    try {
      await this.allowReconnection(client, RECONNECT_WINDOW_MS / 1000);
      console.log('[battle] reconnected', userId);
      p.connected = true;
      p.lastSeenAt = Date.now();
    } catch (_e) {
      // Timed out — opponent wins by disconnect.
      console.log('[battle] reconnect timeout — DC win for opponent');
      if (!this.state.winnerUserId) {
        const opp = this.opponentOf(userId);
        if (opp) this.endMatch(opp, 'disconnect');
      }
    }
  }

  async onDispose() {
    console.log('[battle] onDispose', { matchId: this.state.matchId, winner: this.state.winnerUserId });
    if (this.turnTimer) { try { clearTimeout(this.turnTimer); } catch (e) {} }
    // (Session 2) Persist winner_id to Supabase matches table.
  }

  // ─── Match flow ────────────────────────────────────────────────────────────
  private startMatch() {
    // Pick a first player deterministically by sorting userIds — same coin
    // flip both clients see. (Session 2: replace with a fair coin flip
    // broadcast + the existing Coin cinematic in the client.)
    const ids = Array.from(this.state.players.keys()).sort();
    this.state.currentTurnUserId = ids[0];
    this.state.turnNumber = 1;
    console.log('[battle] match start — first turn:', ids[0]);
    this.armTurnTimer();
    this.broadcast('matchStart', {
      first: ids[0],
      participants: ids,
    });
  }

  private handleEndTurn(client: Client) {
    const me = client.userData?.userId;
    if (!me || this.state.winnerUserId) return;
    if (this.state.currentTurnUserId !== me) {
      // 🛡 Server is the source of truth — silently ignore + notify the
      // sender. Their UI will resync from the next state update.
      try { client.send('reject', { reason: 'not-your-turn' }); } catch (e) {}
      return;
    }
    const opp = this.opponentOf(me);
    if (!opp) return;
    this.state.currentTurnUserId = opp;
    this.state.turnNumber++;
    // Reset per-turn flags on units owned by the now-active side.
    this.state.units.forEach(u => {
      if (u.ownerUserId === opp && u.alive) {
        u.hasMoved = false;
        u.hasAttacked = false;
        u.usedPriority = false;
      }
    });
    // Refresh the new active player's energy.
    const p = this.state.players.get(opp);
    if (p) {
      p.maxEnergy = Math.min(10, p.maxEnergy + 1);
      p.energy = p.maxEnergy;
    }
    this.armTurnTimer();
    console.log('[battle] turn → ' + opp + ' (turn ' + this.state.turnNumber + ')');
  }

  private handleAction(client: Client, payload: any) {
    const me = client.userData?.userId;
    if (!me || this.state.winnerUserId) return;
    if (this.state.currentTurnUserId !== me) {
      try { client.send('reject', { reason: 'not-your-turn' }); } catch (e) {}
      return;
    }
    // Session 2 — port the engine. For now we just log so the loop is
    // visible during local dev.
    console.log('[battle] action', { user: me, payload });
  }

  private armTurnTimer() {
    if (this.turnTimer) { try { clearTimeout(this.turnTimer); } catch (e) {} }
    this.turnTimer = setTimeout(() => {
      // 2-minute turn ran out — force end-of-turn.
      console.log('[battle] turn timer expired — auto-ending turn');
      if (this.state.winnerUserId) return;
      const opp = this.opponentOf(this.state.currentTurnUserId);
      if (opp) {
        this.state.currentTurnUserId = opp;
        this.state.turnNumber++;
        this.armTurnTimer();
      }
    }, TURN_TIMEOUT_MS);
  }

  private endMatch(winnerUserId: string, reason: string) {
    if (this.state.winnerUserId) return; // already ended
    this.state.winnerUserId = winnerUserId;
    this.state.endReason = reason;
    this.state.endedAt = Date.now();
    if (this.turnTimer) { try { clearTimeout(this.turnTimer); } catch (e) {} }
    console.log('[battle] endMatch', { winner: winnerUserId, reason });
    this.broadcast('matchEnd', {
      winnerUserId,
      reason,
      turnNumber: this.state.turnNumber,
    });
    // Auto-dispose after 10s so clients can render their victory screens
    // before the room is torn down.
    this.clock.setTimeout(() => this.disconnect(), 10000);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  private opponentOf(userId: string): string {
    for (const id of this.state.players.keys()) {
      if (id !== userId) return id;
    }
    return '';
  }
}
