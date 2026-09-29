// ============================================================================
// 💥 Damage engine — server-authoritative port of calculateDamage +
//                    applyDamageTriggers from public/index.html
// ----------------------------------------------------------------------------
// Pure, deterministic-when-seeded math. No DOM, no VFX, no toasts — just the
// numbers + a log of human-readable events for the room to broadcast.
//
// Design choices for the server port:
//   - Functions take plain `UnitInput` / `MoveInput` objects so the BattleRoom
//     can read fields off both the schema state AND the static card catalog
//     (the schema only carries runtime state; elements/passives come from the
//     card data and get passed in alongside).
//   - The room passes in a `weather` object explicitly — no global App.state.
//   - Returns a `DamageResult` matching the client's shape (damage / missed /
//     crit / typeMul / effectiveness / stab) so future client/server parity
//     checks can diff the two paths line-for-line.
//
// SESSION 2 scope:
//   - Core formula, type chart, STAB, weather mods, crit, status mods,
//     stat-stage offsets, vulnerable damage-taken multiplier.
//   - applyDamageTriggers: HP subtract + Immortal/Sturdy/Stabilize clamps.
//
// SESSION 3 scope (deferred):
//   - Location auras, camp traits, held items, Evasive Roll, Phantom Presence,
//     Sneak Attack adjacency, Squad Cohesion, Chosen Defender traits,
//     loadout-stamped armor reduction, the full passive catalog.
// ============================================================================

import {
  STATUS_EFFECTS,
  getTypeMultiplier,
} from './catalogs';

// ───── Public types ─────────────────────────────────────────────────────────

export interface MoveInput {
  id: string;
  name: string;
  /** Base power. 0 / undefined = non-damaging move (heal, buff, status, etc.). */
  power?: number;
  /** Hit chance 0..100. Defaults to 100 if omitted. */
  accuracy?: number;
  /** Channel — physical reads ATK/DEF, magic reads MAG/RES. */
  type?: 'physical' | 'magic';
  /** Element id ('fire' / 'water' / ... / 'neutral'). */
  element?: string;
  /** Crit chance 0..100. Defaults to 6 if omitted (matches client). */
  crit?: number;
  /** Special effect tag — 'pierce' halves defender's relevant defense stat. */
  effect?: string;
}

export interface StatusEntry {
  id: string;
  turns: number;
  sourceUnitId?: string;
  tickCount?: number;
  stack?: number;
}

export interface UnitInput {
  // ─── Runtime state (mirrored from BattleState.Unit schema) ──────────────
  id: string;
  currentHp: number;
  maxHp: number;
  atk: number;
  def: number;
  mag: number;
  res: number;
  spd: number;
  isHero: boolean;
  alive: boolean;
  hasAttacked: boolean;
  statusEffects: StatusEntry[];

  // Stat-stage offsets (Pokemon-style, -6..+6)
  stageAtk: number;
  stageDef: number;
  stageMag: number;
  stageRes: number;
  stageSpd: number;

  // ─── Card-static fields (caller passes these in from the card catalog) ──
  /** Element ids this unit carries. Used by type chart + STAB + immunities. */
  elements?: string[];
  /** Passive ids active on the unit. Used by damage hooks (sturdy, etc.). */
  passives?: string[];

  // Internal mutation flags (server-set during damage resolution).
  sturdyUsed?: boolean;
  _bleeding?: boolean;
  _bleedTurnsLeft?: number;
}

export interface WeatherInput {
  /** 'sun' | 'rain' | 'lightningStorm' | 'eclipse' | 'mist' | 'sand' | 'bloodmoon' | 'mindRealm' | ... */
  type: string;
  turnsLeft: number;
}

export interface DamageResult {
  damage: number;
  missed: boolean;
  crit: boolean;
  typeMul: number;
  effectiveness: 'normal' | 'super' | 'weak' | 'miss' | 'none';
  stab: boolean;
}

export interface DamageTriggerResult {
  unit: UnitInput;
  log: Array<{ msg: string; color?: string }>;
}

// ───── Internal helpers ─────────────────────────────────────────────────────

type StatKey = 'atk' | 'def' | 'mag' | 'res' | 'spd';

function hasPassive(unit: UnitInput | undefined, id: string): boolean {
  if (!unit || !Array.isArray(unit.passives)) return false;
  return unit.passives.includes(id);
}

function hasStatus(unit: UnitInput | undefined, id: string): boolean {
  if (!unit || !Array.isArray(unit.statusEffects)) return false;
  return unit.statusEffects.some((e) => e && e.id === id);
}

/**
 * Pokemon-style stat-stage multiplier. -6..0 = 2/(2+|n|), 0..+6 = (2+n)/2.
 * Mirrors getStageMultiplier from the client.
 */
function stageMultiplier(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage | 0));
  if (s >= 0) return (2 + s) / 2;
  return 2 / (2 + Math.abs(s));
}

/** Lowest statMult across active statuses (Infected = 0.5). */
function getStatusStatMultiplier(unit: UnitInput): number {
  let m = 1;
  for (const e of unit.statusEffects || []) {
    const sd = e && STATUS_EFFECTS[e.id];
    if (sd && typeof sd.statMult === 'number' && sd.statMult < m) m = sd.statMult;
  }
  return m;
}

/** Sum of additive stat mods from active statuses for a given stat key. */
function getStatusStatBonus(unit: UnitInput, key: StatKey): number {
  let sum = 0;
  const modField = (key + 'Mod') as 'atkMod' | 'defMod' | 'magMod' | 'resMod' | 'spdMod';
  for (const e of unit.statusEffects || []) {
    const sd = e && STATUS_EFFECTS[e.id];
    if (sd && typeof sd[modField] === 'number') sum += sd[modField] as number;
  }
  return sum;
}

/** Effective stat after stage offsets + status modifiers. Floor 1. */
function effectiveStat(unit: UnitInput, key: StatKey): number {
  let base = 0;
  let stage = 0;
  switch (key) {
    case 'atk': base = unit.atk; stage = unit.stageAtk; break;
    case 'def': base = unit.def; stage = unit.stageDef; break;
    case 'mag': base = unit.mag; stage = unit.stageMag; break;
    case 'res': base = unit.res; stage = unit.stageRes; break;
    case 'spd': base = unit.spd; stage = unit.stageSpd; break;
  }
  const staged = Math.max(1, Math.floor(base * stageMultiplier(stage)));
  return Math.max(1, staged + getStatusStatBonus(unit, key));
}

/** Count of negative SPD stages (used for accuracy penalty). */
function getSpeedPenalty(unit: UnitInput): number {
  const s = unit.stageSpd | 0;
  return s < 0 ? Math.abs(s) : 0;
}

// ───── calculateDamage ──────────────────────────────────────────────────────

/**
 * Server-authoritative damage calc. Pure: same inputs → same outputs
 * (excepting the RNG draws for accuracy / crit / dodge). Caller is
 * responsible for seeding RNG if determinism is required.
 *
 * Matches the client's calculateDamage shape so any future parity-check
 * harness can diff client and server line-for-line.
 */
export function calculateDamage(
  move: MoveInput,
  attacker: UnitInput,
  defender: UnitInput,
  weather?: WeatherInput,
): DamageResult {
  if (!move.power) {
    return { damage: 0, missed: false, crit: false, typeMul: 1, effectiveness: 'none', stab: false };
  }

  // 👻 Spectral Haze — every attack from this attacker auto-misses.
  if (hasStatus(attacker, 'spectralHaze')) {
    return { damage: 0, missed: true, crit: false, typeMul: 1, effectiveness: 'miss', stab: false };
  }

  // ─── Accuracy ─────────────────────────────────────────────────────────
  let accuracy = move.accuracy != null ? move.accuracy : 100;

  // Mistveil weather: 25% extra miss on all attacks.
  if (weather && weather.type === 'mist' && weather.turnsLeft > 0) accuracy -= 25;

  // Speed-penalty accuracy hit: each negative SPD stage drops accuracy 15%.
  const spdPen = getSpeedPenalty(attacker);
  if (spdPen > 0) accuracy -= 15 * spdPen;

  // Status-driven accuracy mods (Panicked, etc.).
  for (const e of attacker.statusEffects || []) {
    const sd = e && STATUS_EFFECTS[e.id];
    if (sd && typeof sd.accMod === 'number') accuracy += sd.accMod;
  }

  if (accuracy < 100 && Math.random() * 100 >= accuracy) {
    return { damage: 0, missed: true, crit: false, typeMul: 1, effectiveness: 'miss', stab: false };
  }

  // Defender dodge chance (Lucky 30%, Mirror Image 50%).
  for (const e of defender.statusEffects || []) {
    const sd = e && STATUS_EFFECTS[e.id];
    if (sd && sd.dodgeChance && Math.random() < sd.dodgeChance) {
      return { damage: 0, missed: true, crit: false, typeMul: 1, effectiveness: 'miss', stab: false };
    }
  }

  // ─── Base damage formula ──────────────────────────────────────────────
  const isMagic = move.type === 'magic';
  let atkStat = effectiveStat(attacker, isMagic ? 'mag' : 'atk');
  atkStat = Math.max(1, Math.floor(atkStat * getStatusStatMultiplier(attacker)));

  let defStat = effectiveStat(defender, isMagic ? 'res' : 'def');
  defStat = Math.max(1, Math.floor(defStat * getStatusStatMultiplier(defender)));

  if (move.effect === 'pierce') defStat = Math.max(1, Math.floor(defStat / 2));

  let dmg = Math.max(1, Math.floor((move.power * atkStat) / (Math.max(1, defStat) * 4)) + 2);

  // ─── Element type chart ───────────────────────────────────────────────
  const moveElem = move.element || 'neutral';
  const defElems = Array.isArray(defender.elements) ? defender.elements : [];
  const atkElems = Array.isArray(attacker.elements) ? attacker.elements : [];

  let typeMul = 1;
  if (moveElem !== 'neutral' && defElems.length) {
    for (const de of defElems) typeMul *= getTypeMultiplier(moveElem, de);
  }
  dmg = Math.floor(dmg * typeMul);
  if (dmg < 1 && typeMul > 0) dmg = 1;
  if (typeMul === 0) dmg = 0;

  // Vulnerable (damageTakenMult) — stacks AFTER element matchup.
  if (dmg > 0) {
    let dmgMul = 1;
    for (const e of defender.statusEffects || []) {
      const sd = e && STATUS_EFFECTS[e.id];
      if (sd && sd.damageTakenMult) dmgMul *= sd.damageTakenMult;
    }
    if (dmgMul !== 1) dmg = Math.max(1, Math.round(dmg * dmgMul));
  }

  // ─── Weather elemental modifiers ──────────────────────────────────────
  if (weather && weather.turnsLeft > 0) {
    if (weather.type === 'sun') {
      if (moveElem === 'fire')  dmg = Math.floor(dmg * 1.5);
      if (moveElem === 'water') dmg = Math.floor(dmg * 0.5);
    } else if (weather.type === 'rain') {
      if (moveElem === 'water') dmg = Math.floor(dmg * 1.5);
      if (moveElem === 'fire')  dmg = Math.floor(dmg * 0.5);
      if (defElems.includes('metal')) dmg = Math.floor(dmg * 1.3);
    } else if (weather.type === 'lightningStorm') {
      if (moveElem === 'storm') {
        dmg = Math.floor(dmg * 1.5);
        if (defElems.includes('water')) dmg = Math.floor(dmg * 2.0);
      }
      if (moveElem === 'water') dmg = Math.floor(dmg * 1.5);
    } else if (weather.type === 'eclipse') {
      if (moveElem === 'shadow') dmg = Math.floor(dmg * 1.5);
      if (moveElem === 'light')  dmg = Math.floor(dmg * 0.5);
    } else if (weather.type === 'mindRealm' && move.type === 'magic') {
      dmg = Math.floor(dmg * 1.3);
    }
  }

  // ─── STAB ─────────────────────────────────────────────────────────────
  let stab = false;
  if (moveElem && moveElem !== 'neutral' && atkElems.includes(moveElem)) {
    const stabMul = hasPassive(attacker, 'adaptability') ? 1.75 : 1.5;
    dmg = Math.floor(dmg * stabMul);
    stab = true;
  }

  // ─── Divine Smite — +25% first attack of the turn ─────────────────────
  if (hasPassive(attacker, 'divineSmite') && !attacker.hasAttacked) {
    dmg = Math.floor(dmg * 1.25);
  }

  // ─── Moxie stacks — +5% damage per stack, cap 5 ───────────────────────
  for (const e of attacker.statusEffects || []) {
    if (e && e.id === 'moxie' && e.stack) {
      dmg = Math.floor(dmg * (1 + Math.min(5, e.stack | 0) * 0.05));
      break;
    }
  }

  // ─── Crit ─────────────────────────────────────────────────────────────
  const critChance = move.crit != null ? move.crit : 6;
  const isCrit = Math.random() * 100 < critChance;
  if (isCrit) dmg = Math.floor(dmg * 1.5);

  // ─── Effectiveness band (cosmetic for client) ─────────────────────────
  let effectiveness: DamageResult['effectiveness'] = 'normal';
  if (typeMul >= 2)        effectiveness = 'super';
  else if (typeMul <= 0.5 && typeMul > 0) effectiveness = 'weak';
  else if (typeMul === 0)  effectiveness = 'none';

  return {
    damage: Math.max(typeMul === 0 ? 0 : 1, dmg),
    missed: false,
    crit: isCrit,
    typeMul,
    effectiveness,
    stab,
  };
}

// ───── applyDamageTriggers ──────────────────────────────────────────────────

/**
 * Apply `incomingDmg` to `unit`, running the survival hooks (Immortal,
 * Sturdy, Stabilize, Lethal-Avoid items) before flipping `alive` to false.
 *
 * Returns the mutated unit and a list of log lines for the room to broadcast.
 * The caller is responsible for writing the new state back to the schema
 * (so we never touch the schema directly here — keeps this pure-ish for
 * testing).
 *
 * `damageType` is 'physical' | 'magic' | undefined (DoT / generic).
 */
export function applyDamageTriggers(
  unit: UnitInput,
  incomingDmg: number,
  damageType?: string,
): DamageTriggerResult {
  const oldHp = (unit && typeof unit.currentHp === 'number') ? unit.currentHp : 0;
  const maxHp = (unit && typeof unit.maxHp === 'number')     ? unit.maxHp     : 0;
  const dmgIn = (typeof incomingDmg === 'number' && incomingDmg >= 0) ? (incomingDmg | 0) : 0;

  // Damage receipt — server log for any "I had 34 HP and died from 9" reports.
  // eslint-disable-next-line no-console
  console.info(
    `[damage] ${unit.id} HP ${oldHp}/${maxHp} - ${dmgIn} = ${oldHp - dmgIn}/${maxHp}` +
    ` (type: ${damageType || 'untyped'})`,
  );

  const nu: UnitInput = { ...unit, currentHp: unit.currentHp - dmgIn };
  const log: Array<{ msg: string; color?: string }> = [];

  // 💀 IMMORTAL passives — clamp HP to 1 instead of letting it hit 0 when the
  // damage type matches. Untyped status damage stays a kill for fairness.
  if (nu.currentHp <= 0 && damageType) {
    const isPhys = damageType === 'physical';
    const isMag  = damageType === 'magic' || damageType === 'magical';
    if (isPhys && hasPassive(nu, 'physicalImmortal')) {
      nu.currentHp = 1;
      log.push({ msg: `🛡️ Unbreakable Body endures — held at 1 HP!`, color: 'amber' });
    } else if (isMag && hasPassive(nu, 'magicalImmortal')) {
      nu.currentHp = 1;
      log.push({ msg: `🔮 Soul Shield endures — held at 1 HP!`, color: 'amber' });
    }
  }

  // 🪨 Sturdy — full-HP → 1 HP once per battle.
  if (nu.currentHp <= 0 && hasPassive(nu, 'sturdy') && !nu.sturdyUsed) {
    const wasFullHp = (unit.currentHp || 0) >= (unit.maxHp || 0);
    if (wasFullHp) {
      nu.currentHp = 1;
      nu.sturdyUsed = true;
      log.push({ msg: `🪨 Sturdy endures — held at 1 HP!`, color: 'amber' });
    }
  }

  // 🩸 STABILIZE — non-hero, non-bleeding units with the stabilize passive
  // go to Bleeding for 3 turns instead of dying. Permadeath when timer hits 0.
  if (nu.currentHp <= 0 && !nu.isHero && !nu._bleeding && hasPassive(nu, 'stabilize')) {
    nu._bleeding = true;
    nu._bleedTurnsLeft = 3;
    nu.alive = false;
    nu.currentHp = 0;
    log.push({ msg: `🩸 BLEEDING OUT — 3 turns until permadeath.`, color: 'amber' });
  }

  if (nu.currentHp <= 0) {
    nu.alive = false;
    nu.currentHp = 0;
  }

  return { unit: nu, log };
}

// ───── Convenience: status tick (turn-start DoT application) ────────────────

/**
 * Apply a single turn's worth of status damage (poison / burn / bleed / etc.)
 * to a unit. Returns the list of damage events so the caller can pipe each
 * through `applyDamageTriggers`. `when` filters to 'turnStart' or 'turnEnd'.
 *
 * The escalation factor (toxic, hemorrhage) is read off the entry's
 * `tickCount` — caller is expected to increment that AFTER applying damage
 * so the first tick lands at base damage.
 */
export function tickStatusDamage(
  unit: UnitInput,
  when: 'turnStart' | 'turnEnd',
): Array<{ statusId: string; damage: number; type: 'untyped' }> {
  const out: Array<{ statusId: string; damage: number; type: 'untyped' }> = [];
  if (!unit.alive) return out;
  for (const e of unit.statusEffects || []) {
    const sd = e && STATUS_EFFECTS[e.id];
    if (!sd || sd.when !== when) continue;
    if (sd.dmgMin == null || sd.dmgMax == null) continue;
    const lo = sd.dmgMin | 0;
    const hi = sd.dmgMax | 0;
    let dmg = lo + Math.floor(Math.random() * (hi - lo + 1));
    if (sd.escalating) {
      const ticks = Math.max(1, ((e.tickCount ?? 0) | 0) + 1);
      dmg = dmg * ticks;
    }
    if (dmg > 0) out.push({ statusId: e.id, damage: dmg, type: 'untyped' });
  }
  return out;
}
