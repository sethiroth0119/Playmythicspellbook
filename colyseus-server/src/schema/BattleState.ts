// ============================================================================
// 🧬 Battle state schema — what every client sees + automatic delta sync
// ----------------------------------------------------------------------------
// Colyseus's @colyseus/schema package handles the heavy lifting:
//   - Every @type field is automatically diffed and delta-broadcast to clients.
//   - When a new client joins, the FULL state is sent automatically.
//   - Schema versions are negotiated so a stale client gets an error instead
//     of silently desyncing.
// On the CLIENT side, the same schema is reconstructed; @colyseus/schema's
// JS runtime keeps an identical object tree updated in real time as deltas
// arrive. No manual state-merging code needed.
// ============================================================================

import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

// ─── A status effect on a unit ───────────────────────────────────────────────
export class StatusEffect extends Schema {
  @type('string')  id: string = '';
  @type('number')  turns: number = 0;
  @type('string')  sourceUnitId: string = '';
  @type('number')  tickCount: number = 0;
}

// ─── A unit on the field (hero or summoned creature) ─────────────────────────
export class Unit extends Schema {
  @type('string')  id: string = '';
  @type('string')  cardId: string = '';
  @type('string')  ownerUserId: string = '';     // Supabase user id of controller
  @type('string')  name: string = '';
  @type('string')  icon: string = '';
  @type('boolean') isHero: boolean = false;
  @type('boolean') alive: boolean = true;

  // Position
  @type('number')  posX: number = 0;
  @type('number')  posY: number = 0;

  // Vitals
  @type('number')  currentHp: number = 0;
  @type('number')  maxHp: number = 0;

  // Combat stats (base — buffs/debuffs apply on top via statusEffects)
  @type('number')  atk: number = 0;
  @type('number')  def: number = 0;
  @type('number')  mag: number = 0;
  @type('number')  res: number = 0;
  @type('number')  spd: number = 1;

  // Turn flags
  @type('boolean') hasMoved: boolean = false;
  @type('boolean') hasAttacked: boolean = false;
  @type('boolean') usedPriority: boolean = false;

  // Status effects
  @type([StatusEffect]) statusEffects = new ArraySchema<StatusEffect>();

  // Stat-stage offsets (Pokemon-style, -6 to +6)
  @type('number')  stageAtk: number = 0;
  @type('number')  stageDef: number = 0;
  @type('number')  stageMag: number = 0;
  @type('number')  stageRes: number = 0;
  @type('number')  stageSpd: number = 0;
}

// ─── A card sitting in a player's hand / deck / graveyard ────────────────────
export class CardRef extends Schema {
  @type('string') instanceId: string = '';   // per-card unique id (survives moves between zones)
  @type('string') cardId: string = '';       // the catalog id (e.g. cc_1234...)
}

// ─── Per-player game state (hand size, energy, etc.) ─────────────────────────
export class PlayerState extends Schema {
  @type('string')  userId: string = '';
  @type('string')  displayName: string = '';
  @type('string')  heroId: string = '';
  @type('number')  energy: number = 1;
  @type('number')  maxEnergy: number = 1;
  @type('number')  handSize: number = 0;          // # cards in hand (opponent sees count, not contents)
  @type('number')  deckSize: number = 0;
  @type('number')  graveyardSize: number = 0;
  @type('number')  kalonsRemaining: number = 3;

  // Hand contents are PRIVATE — only sent to the owning client. Stored as
  // a JSON string here so we can use the @colyseus/schema `filter` feature
  // at room registration time to scope visibility. The owner sees their
  // full hand; the opponent only sees `handSize`.
  @type('string') privateHandJson: string = '[]';

  @type('boolean') connected: boolean = false;
  @type('number')  lastSeenAt: number = 0;
}

// ─── Top-level state for one BattleRoom ──────────────────────────────────────
export class BattleState extends Schema {
  @type('string')  matchId: string = '';
  @type('string')  currentTurnUserId: string = '';
  @type('number')  turnNumber: number = 1;
  @type('string')  weather: string = '';             // 'sun' | 'rain' | etc. — empty when none
  @type('number')  weatherTurnsLeft: number = 0;

  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: Unit })        units   = new MapSchema<Unit>();

  // Match-end fields. Set ONCE when a hero dies; clients render the
  // victory/defeat screen off these. winnerUserId !== '' means the match
  // is over and no further actions are valid.
  @type('string') winnerUserId: string = '';
  @type('string') endReason: string = '';            // 'hero-killed' | 'forfeit' | 'disconnect' | 'doom-expired'
  @type('number') endedAt: number = 0;
}
