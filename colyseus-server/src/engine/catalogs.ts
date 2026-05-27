// ============================================================================
// 🗂 Engine catalogs — STATUS_EFFECTS + PASSIVES + ELEMENTS + TYPE_CHART
// ----------------------------------------------------------------------------
// Pure-data ports of the client's STATUS_EFFECTS / PASSIVES / TYPE_CHART /
// TYPE_IMMUNITIES dictionaries. Kept as plain objects so callers can read
// them the same way the JS client does (STATUS_EFFECTS[id], etc.).
//
// SOURCE OF TRUTH stays in public/index.html — when an entry is added /
// changed there, MIRROR it here. A future Session 3 pass can codegen this
// file from index.html to remove the manual sync burden.
// ============================================================================

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

export const STATUS_EFFECTS: Record<string, StatusEffectDef> = {
  // ───── Damage-over-time ─────
  poison:    { id: 'poison',    name: 'Poison',    icon: '☠️',  dmgMin: 1, dmgMax: 5, when: 'turnStart', desc: '1-5 dmg/turn' },
  burn:      { id: 'burn',      name: 'Burn',      icon: '🔥',  dmgMin: 3, dmgMax: 3, when: 'turnStart', desc: '3 dmg/turn' },
  bleed:     { id: 'bleed',     name: 'Bleed',     icon: '🩸',  dmgMin: 2, dmgMax: 4, when: 'turnStart', desc: '2-4 dmg/turn' },
  siphoned:  { id: 'siphoned',  name: 'Siphoned',  icon: '🌿',  dmgMin: 3, dmgMax: 6, when: 'turnStart', desc: '3-6 HP drained/turn' },
  toxic:     { id: 'toxic',     name: 'Necrotic Bloom', icon: '☢️', dmgMin: 3, dmgMax: 3, when: 'turnStart', escalating: true, desc: 'Escalating 3/6/9/12' },
  frostbite: { id: 'frostbite', name: 'Frostbite', icon: '❄️',  dmgMin: 1, dmgMax: 3, when: 'turnStart', spdMod: -1, desc: '1-3 dmg/turn + slow' },
  scorched:  { id: 'scorched',  name: 'Scorched',  icon: '🔥',  dmgMin: 2, dmgMax: 2, when: 'turnStart', defMod: -3, desc: '2 dmg/turn + armor crack' },
  hemorrhage:{ id: 'hemorrhage',name: 'Hemorrhage',icon: '🩹',  dmgMin: 2, dmgMax: 2, when: 'turnStart', escalating: true, desc: 'Escalating bleed' },
  electrified:{ id: 'electrified',name: 'Electrified', icon: '⚡', dmgMin: 1, dmgMax: 3, when: 'turnStart', skipChance: 0.3, desc: 'Crackling DoT' },

  // ───── Hard control (skip turn) ─────
  stun:       { id: 'stun',       name: 'Stunned',      icon: '💫',  skipTurn: true, desc: 'Cannot act' },
  frozen:     { id: 'frozen',     name: 'Frozen',       icon: '🧊',  skipTurn: true, desc: 'Cannot act' },
  sleep:      { id: 'sleep',      name: 'Asleep',       icon: '💤',  skipTurn: true, wakeChance: 0.35, desc: 'Skip turn, 35% wake' },
  stumble:    { id: 'stumble',    name: 'Stumbling',    icon: '💫',  skipTurn: true, desc: 'Skip next turn — flinch' },
  knockdown:  { id: 'knockdown',  name: 'Knocked Down', icon: '💥',  skipTurn: true, desc: 'Knocked prone — skip next turn' },
  entangled:  { id: 'entangled',  name: 'Entangled',    icon: '🌿',  skipTurn: true, desc: 'Bound — cannot act' },
  petrified:  { id: 'petrified',  name: 'Petrified',    icon: '🗿',  skipTurn: true, defMod: 8, resMod: 8, desc: 'Stone-bound + tanky' },

  // ───── Soft control (skip chance / interference) ─────
  confusion:  { id: 'confusion',  name: 'Confused',     icon: '❓',  selfHitChance: 0.33, desc: '33% self-hit' },
  paralysis:  { id: 'paralysis',  name: 'Paralyzed',    icon: '⚡',  spdMod: -1, skipChance: 0.25, desc: '-1 SPD + 25% fumble' },
  dazed:      { id: 'dazed',      name: 'Dazed',        icon: '😵',  skipChance: 0.3, spdMod: -1, desc: '30% fumble + slow' },
  blinded:    { id: 'blinded',    name: 'Blinded',      icon: '🌫️', skipChance: 0.4, atkMod: -2, desc: '40% fumble + weak' },
  spectralHaze: { id: 'spectralHaze', name: 'Spectral Haze', icon: '👻', forceMiss: true, desc: 'Every attack misses' },
  dispel:     { id: 'dispel',     name: 'Dispelled',    icon: '🚫',  silencesCostMoves: true, desc: 'No energy moves' },

  // ───── Negative stat mods ─────
  weak:       { id: 'weak',       name: 'Weak',         icon: '💔',  atkMod: -3, desc: '-3 ATK' },
  slow:       { id: 'slow',       name: 'Slow',         icon: '🐌',  spdMod: -1, desc: '-1 SPD' },
  disarmed:   { id: 'disarmed',   name: 'Disarmed',     icon: '🗡️', atkMod: -7, desc: '-7 ATK' },
  hexed:      { id: 'hexed',      name: 'Hexed',        icon: '🔮',  magMod: -6, resMod: -3, desc: '-6 MAG / -3 RES' },
  vulnerable: { id: 'vulnerable', name: 'Vulnerable',   icon: '🪓',  defMod: -5, resMod: -5, damageTakenMult: 1.25, desc: '-5 DEF/RES + 25% more incoming' },
  cursed:     { id: 'cursed',     name: 'Cursed',       icon: '💀',  atkMod: -3, magMod: -3, defMod: -3, resMod: -3, desc: '-3 to all' },
  panicked:   { id: 'panicked',   name: 'Panicked',     icon: '😱',  defMod: -3, accMod: -25, desc: '-3 DEF, -25% acc' },
  offBalance: { id: 'offBalance', name: 'Off-Balance',  icon: '🌀',  spdMod: -2, defMod: -2, desc: '-2 SPD/DEF' },
  infected:   { id: 'infected',   name: 'Infected',     icon: '🧬',  statMult: 0.5, desc: 'All stats halved' },

  // ───── Positive stat / defensive ─────
  strong:     { id: 'strong',     name: 'Strong',       icon: '💪',  atkMod: 4, desc: '+4 ATK' },
  focused:    { id: 'focused',    name: 'Focused',      icon: '🎯',  magMod: 4, desc: '+4 MAG' },
  empowered:  { id: 'empowered',  name: 'Empowered',    icon: '✊',  atkMod: 4, magMod: 4, desc: '+4 ATK/MAG' },
  assisted:   { id: 'assisted',   name: 'Assisted',     icon: '🤝',  atkMod: 6, magMod: 6, desc: '+6 next strike' },
  blessed:    { id: 'blessed',    name: 'Blessed',      icon: '🙏',  atkMod: 3, magMod: 3, defMod: 3, resMod: 3, desc: '+3 all' },
  shielded:   { id: 'shielded',   name: 'Shielded',     icon: '🛡️', defMod: 5, resMod: 5, desc: '+5 DEF/RES' },
  haste:      { id: 'haste',      name: 'Haste',        icon: '💨',  spdMod: 1, desc: '+1 SPD' },
  swift:      { id: 'swift',      name: 'Swift',        icon: '🪶',  spdMod: 2, desc: '+2 SPD' },
  lucky:      { id: 'lucky',      name: 'Lucky',        icon: '🍀',  dodgeChance: 0.3, desc: '30% dodge' },
  mirror:     { id: 'mirror',     name: 'Phantom Veil', icon: '👻',  dodgeChance: 0.5, desc: '50% dodge' },
  protected:  { id: 'protected',  name: 'Protected',    icon: '🛡️', blocksAll: true, desc: 'Full immunity 1 cycle' },
  countering: { id: 'countering', name: 'Countering',   icon: '↩️',  countersAttack: true, desc: 'Blocks + counters' },

  // ───── Marking / engine hooks ─────
  doom:       { id: 'doom',       name: 'Mortal Sentence', icon: '🪦', koOnExpire: true, desc: 'Dies on timer expire' },
  reraise:    { id: 'reraise',    name: 'Soul Anchor',  icon: '✨',  revivesOnKO: true, reviveAtPct: 0.5, desc: 'Revives at 50% on KO' },
  moxie:      { id: 'moxie',      name: 'Killer Instinct', icon: '⚔️', stackable: true, desc: '+2 ATK per stack' },
  ambushGuard1: { id: 'ambushGuard1', name: 'Ambush Guard I', icon: '🎯', desc: 'Watch radius 1' },
  ambushGuard3: { id: 'ambushGuard3', name: 'Ambush Guard III', icon: '🎯', desc: 'Watch radius 3' },

  // ───── Aggression ─────
  rage:       { id: 'rage',       name: 'Raged',        icon: '😡',  forceAttackNearest: true, atkMod: 3, defMod: -2, desc: 'Attack nearest, +3 ATK/-2 DEF' },
  berserk:    { id: 'berserk',    name: 'Berserk',      icon: '😤',  forceAttackNearest: true, atkMod: 6, defMod: -5, desc: 'Attack nearest, +6 ATK/-5 DEF' },

  // ───── Source-tracked ─────
  happy:      { id: 'happy',      name: 'Happy',        icon: '😊',  tracksSource: true, desc: "Can't attack source" },
  followLead: { id: 'followLead', name: 'Following',    icon: '🐑',  tracksSource: true, desc: 'Must move toward source' },

  // ───── Visual / phoenix ─────
  reborn:     { id: 'reborn',     name: 'Reborn',       icon: '🜁',  desc: 'Just revived' },
  burningRes: { id: 'burningRes', name: 'Burning Resurrection', icon: '🔥', atkMod: 4, magMod: 4, desc: 'Phoenix risen' },
  soulFlame:  { id: 'soulFlame',  name: 'Soul Flame',   icon: '🕯️', defMod: 4, resMod: 4, desc: 'Phoenix ward' },

  // ───── Pseudo-statuses (translated to displacement at save time) ─────
  knockback:  { id: 'knockback',  name: 'Knockback',    icon: '💨',  displacement: 'away',   desc: 'Push away' },
  grappleHook:{ id: 'grappleHook',name: 'Grappling Hook', icon: '🪝', displacement: 'toward', desc: 'Pull in' },
};

// ───── Passives (lightweight reference — flag presence only, no per-passive logic in MVP) ─────
// Engine logic for most passives stays client-side until Session 3.
// We mirror the IDs + flag fields the damage formula reads.
export interface PassiveDef {
  id: string;
  name: string;
  desc: string;
  wardElement?: string;
  wardFaction?: string;
  faction?: string;
}

export const PASSIVES: Record<string, PassiveDef> = {
  none:              { id: 'none',              name: 'None',                desc: '' },
  regeneration:      { id: 'regeneration',      name: 'Regeneration',        desc: 'Heal 2 HP/turn' },
  thorns:            { id: 'thorns',            name: 'Thorns',              desc: 'Reflect 25% dmg taken' },
  lifesteal:         { id: 'lifesteal',         name: 'Lifesteal',           desc: 'Heal 30% dmg dealt' },
  swift:             { id: 'swift',             name: 'Swift',               desc: '+1 movement' },
  tough:             { id: 'tough',             name: 'Tough',               desc: '+3 DEF' },
  magicWard:         { id: 'magicWard',         name: 'Magic Ward',          desc: '+3 RES' },
  sturdy:            { id: 'sturdy',            name: 'Bedrock',             desc: 'Survives lethal once at full HP' },
  physicalImmortal:  { id: 'physicalImmortal',  name: 'Unbreakable Body',    desc: 'Cannot die from physical' },
  magicalImmortal:   { id: 'magicalImmortal',   name: 'Soul Shield',         desc: 'Cannot die from magic' },
  divineSmite:       { id: 'divineSmite',       name: 'Daybreaker',          desc: '+25% first attack/turn' },
  adaptability:      { id: 'adaptability',      name: 'Elemental Affinity',  desc: 'STAB +75% instead of +50%' },
  // (Full passive catalog mirrored from index.html lives in Session 3.
  //  For Session 2 only the flag-driving ones above are honored on server.)
};

// ───── Element type chart ─────
// Mirrors STRONG_VS / TYPE_CHART from index.html. 2.0 = super-effective,
// 0.5 = resisted, 1.0 = neutral.
const ELEMENTS = [
  'fire', 'water', 'earth', 'wind', 'light', 'shadow', 'nature', 'storm',
  'ice', 'metal', 'poison', 'psychic', 'arcane', 'void', 'blood', 'crystal',
  'corruption', 'spirit', 'lava', 'sound', 'gravity',
];

const STRONG_VS: Record<string, string[]> = {
  fire:    ['nature', 'wind', 'ice', 'metal'],
  water:   ['fire', 'earth', 'blood'],
  earth:   ['fire', 'storm', 'poison'],
  wind:    ['earth', 'nature', 'poison'],
  nature:  ['water', 'shadow', 'crystal'],
  shadow:  ['light', 'nature', 'psychic'],
  light:   ['shadow', 'storm', 'void'],
  storm:   ['water', 'wind', 'metal'],
  ice:     ['nature', 'water', 'blood'],
  metal:   ['earth', 'ice', 'crystal'],
  poison:  ['nature', 'water', 'light'],
  psychic: ['poison', 'fire', 'void'],
  arcane:  ['shadow', 'ice', 'metal'],
  void:    ['psychic', 'arcane', 'crystal'],
  blood:   ['light', 'ice', 'nature'],
  crystal: ['storm', 'fire', 'arcane'],
  corruption: ['nature', 'light', 'water'],
  spirit:  ['metal', 'shadow', 'psychic'],
  lava:    ['ice', 'metal', 'nature'],
  sound:   ['crystal', 'ice', 'psychic'],
  gravity: ['wind', 'fire', 'spirit'],
};

export function getTypeMultiplier(atkElem: string, defElem: string): number {
  if (!atkElem || !defElem || atkElem === 'neutral' || defElem === 'neutral') return 1;
  const atkStrong = STRONG_VS[atkElem]?.includes(defElem);
  const defStrong = STRONG_VS[defElem]?.includes(atkElem);
  if (atkStrong) return 2.0;
  if (defStrong) return 0.5;
  return 1.0;
}

// Status immunity by element.
export const TYPE_IMMUNITIES: Record<string, string[]> = {
  fire:    ['burn'],
  earth:   ['bleed'],
  wind:    ['slow'],
  nature:  ['poison'],
  storm:   ['stun'],
  ice:     ['slow', 'frozen'],
  metal:   ['bleed', 'poison'],
  poison:  ['poison'],
  psychic: ['confusion', 'sleep'],
  void:    ['dispel', 'bleed'],
  blood:   ['bleed'],
  crystal: ['stun', 'frozen'],
  arcane:  ['dispel'],
  corruption: ['poison', 'burn'],
  spirit:  ['bleed', 'stun'],
  lava:    ['burn', 'slow'],
  sound:   ['confusion'],
  gravity: ['frozen'],
};

export function isImmuneToStatus(unitElements: string[], statusId: string): boolean {
  for (const el of unitElements) {
    if (TYPE_IMMUNITIES[el]?.includes(statusId)) return true;
  }
  return false;
}
