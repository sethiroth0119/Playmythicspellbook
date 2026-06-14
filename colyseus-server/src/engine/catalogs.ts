// ============================================================================
// 🗂 Engine catalogs — typed VIEW over the generated single source.
// ----------------------------------------------------------------------------
// The data (STATUS_EFFECTS / PASSIVES / TYPE_CHART / TYPE_IMMUNITIES / MOVES) is
// no longer hand-mirrored here — it is sourced from catalogs.gen.json, which is
// extracted VERBATIM from public/index.html by tools/extract-engine-data.mjs.
// That makes the client the ONE source of truth: an edit there + a regenerate
// keeps the server perfectly in sync, and drift is structurally impossible.
//
// This file now contributes only the TypeScript interfaces (typed views) and the
// two small lookup helpers the damage engine calls.
// ============================================================================

import {
  STATUS_EFFECTS as GEN_STATUS_EFFECTS,
  PASSIVES as GEN_PASSIVES,
  TYPE_CHART as GEN_TYPE_CHART,
  TYPE_IMMUNITIES as GEN_TYPE_IMMUNITIES,
} from './catalogs.gen';

export interface StatusEffectDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  // Damage-over-time hook (read by status tick at turn start).
  dmgMin?: number;
  dmgMax?: number;
  when?: 'turnStart' | 'turnEnd';
  escalating?: boolean;       // damage multiplies by tickCount each turn
  // Stat modifiers — applied additively into the effective stat.
  atkMod?: number;
  magMod?: number;
  defMod?: number;
  resMod?: number;
  spdMod?: number;
  accMod?: number;            // accuracy %
  // Multipliers
  statMult?: number;          // halves every stat at 0.5, etc.
  damageTakenMult?: number;   // incoming dmg multiplier (vulnerable mark)
  // Behavioral flags
  skipTurn?: boolean;         // unit cannot act
  skipChance?: number;        // 0..1 chance to fumble per action
  selfHitChance?: number;     // confusion — chance to hit self
  forceAttackNearest?: boolean;
  forceMiss?: boolean;        // every attack auto-misses
  blocksAll?: boolean;        // protected — immune to all damage + status
  countersAttack?: boolean;
  silencesCostMoves?: boolean;
  // Source-tracked (happy / followLead need to know who applied them)
  tracksSource?: boolean;
  // Win-or-die hooks
  koOnExpire?: boolean;       // doom
  revivesOnKO?: boolean;      // reraise
  reviveAtPct?: number;
  // Dodge mechanics
  dodgeChance?: number;
  // Wake mechanics
  wakeChance?: number;
  // Stackable buffs (moxie)
  stackable?: boolean;
  // Pseudo-statuses translated to displacement
  displacement?: 'away' | 'toward';
}

export interface PassiveDef {
  id: string;
  name: string;
  desc: string;
  wardElement?: string;
  wardFaction?: string;
  faction?: string;
}

// ── Data: the generated single source, presented through the typed views. ──
export const STATUS_EFFECTS = GEN_STATUS_EFFECTS as unknown as Record<string, StatusEffectDef>;
export const PASSIVES = GEN_PASSIVES as unknown as Record<string, PassiveDef>;
export const TYPE_CHART = GEN_TYPE_CHART;
export const TYPE_IMMUNITIES = GEN_TYPE_IMMUNITIES;

// Element effectiveness — reads the generated TYPE_CHART (2.0 super-effective,
// 0.5 resisted, 1.0 neutral). Unknown/neutral elements → 1.0.
export function getTypeMultiplier(atkElem: string, defElem: string): number {
  if (!atkElem || !defElem || atkElem === 'neutral' || defElem === 'neutral') return 1;
  const row = TYPE_CHART[atkElem];
  const m = row ? row[defElem] : undefined;
  return typeof m === 'number' ? m : 1;
}

// Status immunity by element.
export function isImmuneToStatus(unitElements: string[], statusId: string): boolean {
  for (const el of unitElements) {
    if (TYPE_IMMUNITIES[el]?.includes(statusId)) return true;
  }
  return false;
}
