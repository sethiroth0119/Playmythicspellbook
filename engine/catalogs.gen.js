// ╔══════════════════════════════════════════════════════════════════════╗
// ║  GENERATED FILE — DO NOT EDIT BY HAND.                                ║
// ║  Source of truth: public/index.html (the inline battle engine).       ║
// ║  Regenerate: node tools/extract-engine-data.mjs                       ║
// ║  This is the SHARED engine data the Node/Colyseus server imports so   ║
// ║  it runs the exact same definitions as the browser — no drift.        ║
// ╚══════════════════════════════════════════════════════════════════════╝
export const STATUS_EFFECTS = {
  poison:    { id: 'poison',    name: 'Poison',    icon: '☠️',  dmgMin: 1, dmgMax: 5, when: 'turnStart', desc: 'Takes 1-5 dmg/turn' },
  burn:      { id: 'burn',      name: 'Burn',      icon: '🔥',  dmgMin: 3, dmgMax: 3, when: 'turnStart', desc: 'Takes 3 dmg/turn' },
  bleed:     { id: 'bleed',     name: 'Bleed',     icon: '🩸',  dmgMin: 2, dmgMax: 4, when: 'turnStart', desc: 'Takes 2-4 dmg/turn' },
  // Life-drain DoT — themed as parasitic roots/tendrils sapping vitality. Heavier
  // damage range than poison, but uses the same turn-start tick mechanism so no
  // engine changes needed beyond the catalog entry.
  siphoned:  { id: 'siphoned',  name: 'Siphoned',  icon: '🌿',  dmgMin: 3, dmgMax: 6, when: 'turnStart', desc: 'Tendrils drain 3-6 HP/turn' },
  stun:      { id: 'stun',      name: 'Stunned',   icon: '💫',  skipTurn: true, desc: 'Cannot act' },
  // 😱 PANIC — XCOM 2 morale break. Will check failure after a friendly
  // dies nearby. Panicked units take a DEFENSE + ACCURACY hit (used to also
  // discard a hand card, but that was punishing enough to feel unfair — moved
  // hand-discard to a generic 'discardCards' on-play / status effect type
  // admins can opt into instead).
  panicked:  { id: 'panicked',  name: 'Panicked',  icon: '😱', defMod: -3, accMod: -25, desc: 'Shaken after a nearby ally fell — -3 DEF and -25% accuracy for 2 turns.' },
  slow:      { id: 'slow',      name: 'Slow',      icon: '🐌',  spdMod: -1, desc: '-1 movement, -1 attack range, -15% accuracy' },
  haste:     { id: 'haste',     name: 'Haste',     icon: '💨',  spdMod: 1, desc: '+1 movement' },
  weak:      { id: 'weak',      name: 'Weak',      icon: '💔',  atkMod: -3, desc: '-3 attack' },
  // 🎯 Universal weakness — Weak Point Scan / scan-reveal effect that
  // bumps every incoming hit by 25%. Read by calculateDamage AFTER the
  // base def calc so it stacks with elemental matchup but the spec's
  // "universal" promise (works regardless of element / faction) still holds.
  vulnerable:{ id: 'vulnerable',name: 'Vulnerable', icon: '🎯', damageTakenMult: 1.25, desc: 'Marked vulnerable — takes +25% damage from all sources.' },
  strong:    { id: 'strong',    name: 'Strong',    icon: '💪',  atkMod: 4, desc: '+4 attack' },
  shielded:  { id: 'shielded',  name: 'Shielded',  icon: '🛡️', defMod: 5, resMod: 5, desc: '+5 def & res' },
  focused:   { id: 'focused',   name: 'Focused',   icon: '🎯',  magMod: 4, desc: '+4 magic' },
  frozen:    { id: 'frozen',    name: 'Frozen',    icon: '🧊',  skipTurn: true, desc: 'Cannot act' },
  // Pokemon-inspired conditions
  sleep:     { id: 'sleep',     name: 'Asleep',    icon: '💤',  skipTurn: true, wakeChance: 0.35, desc: 'Skips turn; 35% chance to wake each turn' },
  confusion: { id: 'confusion', name: 'Confused',  icon: '❓',  selfHitChance: 0.33, desc: '33% chance to hit self when attacking' },
  paralysis: { id: 'paralysis', name: 'Paralyzed', icon: '⚡',  spdMod: -1, skipChance: 0.25, desc: '-1 SPD (movement / attack range / accuracy); 25% chance to skip each action' },
  dispel:    { id: 'dispel',    name: 'Dispelled', icon: '🚫',  silencesCostMoves: true, desc: 'Cannot use moves that cost energy' },
  // Support / utility
  assisted:  { id: 'assisted',  name: 'Assisted',  icon: '🤝',  atkMod: 6, magMod: 6, desc: '+6 ATK and +6 MAG for the next strike' },
  // 👻 Ghost hex — every attack the cursed unit makes misses 100% of the
  // time. Enforced in calculateDamage (forced 'miss' result for any
  // attacker carrying this). Wears off when its turn counter expires.
  spectralHaze: { id: 'spectralHaze', name: 'Spectral Haze', icon: '👻', forceMiss: true, desc: '👻 Haunted by ghostly fog — every attack this unit makes MISSES until it clears.' },
  // Flinch-style — same effect as stun mechanically, but its own flavor and shorter common duration
  stumble:   { id: 'stumble',   name: 'Stumbling', icon: '💫',  skipTurn: true, desc: 'Tripped — skips their next turn' },
  // Protect (Pokemon-style) — blocks ALL incoming damage and status for one full turn cycle
  protected: { id: 'protected', name: 'Protected', icon: '🛡️',  blocksAll: true, desc: 'Immune to all damage and effects until next turn' },
  // Counter stance — next incoming enemy attack is blocked, the attacker takes a counter hit,
  // then the stance falls. Set duration to 1 so it persists for one turn cycle.
  countering: { id: 'countering', name: 'Countering', icon: '↩️',  countersAttack: true, desc: 'Blocks the next enemy attack and counters back' },
  // 🎯 Ambush Guard — Overwatch-style watch stance set by a move. While held,
  // the FIRST enemy that moves within the watch radius during the enemy turn
  // takes a free reaction strike (once per enemy turn; the stance is then
  // consumed and must be re-cast). Two radii: short (1) and long (3). These
  // persist without decaying until consumed (special-cased in the turn tick).
  ambushGuard1: { id: 'ambushGuard1', name: 'Ambush Guard', icon: '🎯', desc: 'Watching (range 1) — reaction-strikes the first enemy that moves adjacent this enemy turn.' },
  ambushGuard3: { id: 'ambushGuard3', name: 'Ambush Guard', icon: '🎯', desc: 'Watching (range 3) — reaction-strikes the first enemy that moves within 3 tiles this enemy turn.' },
  // Rage — the unit may only use ATTACK moves, and must target the nearest reachable enemy.
  // Ability/heal moves are locked out for the duration. If no enemy is reachable, the unit
  // may still move freely.
  rage:       { id: 'rage',       name: 'Raged',      icon: '😡',  forceAttackNearest: true, atkMod: 3, defMod: -2, desc: 'Must attack the nearest enemy; can only use attack moves (+3 ATK, -2 DEF)' },
  // Infected — themed for zombies, aliens, plague-bearers. Halves ALL of the victim's
  // combat stats (ATK, MAG, DEF, RES, SPD) via the `statMult` field, which is read by
  // `getStatusStatMultiplier(unit)` and applied at damage-formula + speed-calc time.
  // Stacking multiple statMult-bearing statuses multiplies them together (so a future
  // -25% debuff stacked with Infected would become 0.5 × 0.75 = 0.375).
  infected:   { id: 'infected',   name: 'Infected',   icon: '🧬',  statMult: 0.5,            desc: 'All stats reduced by 50% — ATK / MAG / DEF / RES / SPD halved' },
  // ===== Source-tracked statuses =====
  // These statuses remember WHICH unit applied them (stored on the status entry
  // as `sourceUnitId`). Used by canAttackTarget() and the movement validator.
  // The `tracksSource: true` flag is the signal for applyStatusEffect call sites
  // to thread the attacker id through into the new status entry.
  happy:      { id: 'happy',      name: 'Happy',      icon: '😊',  tracksSource: true,       desc: 'Cannot attack the unit that applied this status (3 turns by default)' },
  followLead: { id: 'followLead', name: 'Following',  icon: '🐑',  tracksSource: true,       desc: 'Can only move toward the unit that applied this status. Cannot attack anyone (1-3 turns)' },

  // ===== ✨ COMPETITIVE TOOLKIT — sustained buffs / debuffs / countdown / revive =====
  // Six new statuses that expand competitive deckbuilding. Each ties into a
  // small engine hook (see notes per entry) and stacks naturally with the
  // existing DoTs and short-window buffs.

  // 🙏 BLESSED — broad all-stat buff. Distinct from `assisted` (next-strike
  // only) and `shielded` (DEF/RES only): blessed is a sustained +3 across
  // ATK/MAG/DEF/RES while it lasts.
  blessed:    { id: 'blessed',    name: 'Blessed',    icon: '🙏',  atkMod: 3, magMod: 3, defMod: 3, resMod: 3, desc: '+3 ATK / MAG / DEF / RES while blessed.' },
  // 💀 CURSED — the mirror of blessed.
  cursed:     { id: 'cursed',     name: 'Cursed',     icon: '💀',  atkMod: -3, magMod: -3, defMod: -3, resMod: -3, desc: '-3 ATK / MAG / DEF / RES while cursed.' },
  // 👻 PHANTOM VEIL — 50% dodge chance. Engine wires this in calculateDamage:
  // defender with `mirror` rolls dodge before the damage formula runs (same
  // hook lane as Faewish, but flat 50%).
  mirror:     { id: 'mirror',     name: 'Phantom Veil', icon: '👻', dodgeChance: 0.5, desc: 'Illusory duplicates flicker around the unit — 50% chance to dodge any incoming attack.' },
  // ☢️ NECROTIC BLOOM — ramping DoT. Status tick reads `escalating: true`
  // and multiplies the damage by the number of turns the status has been
  // active (1× first turn, 2× second, etc.). Hits hard late if not cleansed.
  toxic:      { id: 'toxic',      name: 'Necrotic Bloom', icon: '☢️', dmgMin: 3, dmgMax: 3, when: 'turnStart', escalating: true, desc: 'A necrotic infection that worsens — 3 dmg/turn × turns active (3, 6, 9, 12…). Cleanse to stop the spiral.' },
  // 🪦 MORTAL SENTENCE — countdown KO. Engine: when the status duration
  // expires AND the entry has `koOnExpire: true`, the unit is slain. The
  // countdown is visible in the status pill so the player knows what's
  // coming. Cleanse cancels it.
  doom:       { id: 'doom',       name: 'Mortal Sentence', icon: '🪦',  koOnExpire: true, desc: 'A death sentence with a countdown — when the timer expires, this unit dies. Cleanse to dispel.' },
  // ✨ SOUL ANCHOR — one-time auto-revive on KO at 50% max HP. Engine: in
  // the death-trigger path, if the unit has the status, we restore HP and
  // consume the entry. Limited by duration so the buff window is the lever.
  reraise:    { id: 'reraise',    name: 'Soul Anchor', icon: '✨',  revivesOnKO: true, reviveAtPct: 0.5, desc: 'A tether to the living world — revives at 50% max HP the first time this unit would be KO\'d.' },
  // ⚔️ KILLER INSTINCT — stackable +2 ATK after each KO. Distinct from a
  // passive: this is the buff PILE that the matching passive grants on each
  // kill. Implemented as a flat status with atkMod scaled by a `stack` field.
  moxie:      { id: 'moxie',      name: 'Killer Instinct', icon: '⚔️',  stackable: true, desc: 'Each stack grants +2 ATK. Stacks build on KO; capped at 5 stacks (+10 ATK).' },

  // ===== 🆕 EXPANDED CATALOG — all declarative (reuse engine-interpreted
  // fields only: dmgMin/dmgMax+when, skipTurn, skipChance, spdMod, atkMod,
  // magMod, defMod, resMod, statMult, dodgeChance, escalating). Auto-listed
  // in the "All Status Effects" modal + the move-editor status picker. =====

  // 💥 PUSH / KNOCKDOWN — the status form of a shove: the target is knocked
  // off balance and loses their next turn. (Literal tile-displacement still
  // lives on moves via the `knockback` property — e.g. Air Slash.)
  knockdown:  { id: 'knockdown',  name: 'Knocked Down', icon: '💥',  skipTurn: true, desc: 'Shoved off balance and knocked prone — skips their next turn.' },
  // 🌀 OFF-BALANCE — milder push aftermath: sluggish footing.
  offBalance: { id: 'offBalance', name: 'Off-Balance',  icon: '🌀',  spdMod: -2, defMod: -2, desc: 'Stumbling from the impact — -2 movement/range and -2 DEF.' },
  // 💨 KNOCKBACK / 🪝 GRAPPLING HOOK — displacement "pseudo-statuses". Picked
  // from the move editor's status dropdown, but they are NOT real statuses:
  // the move save handler translates them to the engine's move.knockback /
  // move.pull tile-displacement (Status Duration = tiles, Status Chance =
  // proc %). Listed here only so they appear in the status picker.
  knockback:  { id: 'knockback',  name: 'Knockback',      icon: '💨',  displacement: 'away',   desc: 'Shoves the hit target AWAY from the attacker. Status Duration = tiles pushed (1-4); Status Chance = proc %.' },
  grappleHook:{ id: 'grappleHook',name: 'Grappling Hook', icon: '🪝',  displacement: 'toward', desc: 'Yanks the hit target TOWARD the attacker. Status Duration = tiles pulled (1-4); Status Chance = proc %.' },
  // ❄️ FROSTBITE — chilling DoT that also slows.
  frostbite:  { id: 'frostbite',  name: 'Frostbite',    icon: '❄️',  dmgMin: 1, dmgMax: 3, when: 'turnStart', spdMod: -1, desc: 'Freezing rot — 1-3 dmg/turn and -1 movement.' },
  // 🔥 SCORCHED — searing DoT that softens armor.
  scorched:   { id: 'scorched',   name: 'Scorched',     icon: '🔥',  dmgMin: 2, dmgMax: 2, when: 'turnStart', defMod: -3, desc: 'Charred plating — 2 dmg/turn and -3 DEF.' },
  // 🩹 HEMORRHAGE — escalating bleed that ramps each turn.
  hemorrhage: { id: 'hemorrhage', name: 'Hemorrhage',   icon: '🩹',  dmgMin: 2, dmgMax: 2, when: 'turnStart', escalating: true, desc: 'A worsening wound — 2 dmg/turn × turns active (2, 4, 6…). Cleanse to stop it.' },
  // ⚡ ELECTRIFIED — arc damage with a chance to drop the action.
  electrified:{ id: 'electrified',name: 'Electrified',  icon: '⚡',  dmgMin: 1, dmgMax: 3, when: 'turnStart', skipChance: 0.3, desc: 'Crackling current — 1-3 dmg/turn and 30% chance to fumble each action.' },
  // 🛡️ VULNERABLE — defenses cracked wide open (mirror of Shielded).
  vulnerable: { id: 'vulnerable', name: 'Vulnerable',   icon: '🪓',  defMod: -5, resMod: -5, desc: '-5 DEF & RES — armor and wards shattered.' },
  // 💪 EMPOWERED — sustained offensive buff (mirror of Vulnerable).
  empowered:  { id: 'empowered',  name: 'Empowered',    icon: '✊',  atkMod: 4, magMod: 4, desc: '+4 ATK and +4 MAG while empowered.' },
  // 💨 SWIFT — strong mobility buff (stronger than Haste).
  swift:      { id: 'swift',      name: 'Swift',        icon: '🪶',  spdMod: 2, desc: '+2 movement / attack range.' },
  // 🦴 PETRIFIED — turned to stone: cannot act, but extremely tanky.
  petrified:  { id: 'petrified',  name: 'Petrified',    icon: '🗿',  skipTurn: true, defMod: 8, resMod: 8, desc: 'Encased in stone — cannot act, but +8 DEF & RES.' },
  // 🤡 DISARMED — weapon stripped: heavy attack penalty.
  disarmed:   { id: 'disarmed',   name: 'Disarmed',     icon: '🗡️', atkMod: -7, desc: '-7 ATK — weapon knocked away.' },
  // 🌫️ BLINDED — flailing: high chance to fumble actions.
  blinded:    { id: 'blinded',    name: 'Blinded',      icon: '🌫️', skipChance: 0.4, atkMod: -2, desc: 'Cannot see — 40% chance to fumble each action and -2 ATK.' },
  // 🔮 HEXED — magic crippled.
  hexed:      { id: 'hexed',      name: 'Hexed',        icon: '🔮',  magMod: -6, resMod: -3, desc: '-6 MAG and -3 RES — arcane channels fouled.' },
  // 😤 BERSERK — all-out aggression (heavier rage variant).
  berserk:    { id: 'berserk',    name: 'Berserk',      icon: '😤',  forceAttackNearest: true, atkMod: 6, defMod: -5, desc: 'Blind fury — must attack the nearest enemy; +6 ATK, -5 DEF.' },
  // 🌿 ENTANGLED — held fast: cannot act while the vines hold.
  entangled:  { id: 'entangled',  name: 'Entangled',    icon: '🌿',  skipTurn: true, desc: 'Bound by roots/webbing — cannot act until it breaks.' },
  // ☁️ DAZED — concussed: may stumble an action and slower.
  dazed:      { id: 'dazed',      name: 'Dazed',        icon: '😵', skipChance: 0.3, spdMod: -1, desc: 'Head ringing — 30% chance to fumble each action and -1 movement.' },
  // 🍀 LUCKY — fortune's favor: solid dodge chance.
  lucky:      { id: 'lucky',      name: 'Lucky',        icon: '🍀',  dodgeChance: 0.3, desc: 'Fortune shields the unit — 30% chance to dodge any incoming attack.' },
  // 🜁 REBORN — a brief, purely-visual marker placed on a unit that returned
  // via Rebirth Shift / Phoenix Rebirth. No mechanical effect; drives the
  // golden "reborn" glow + lets the player see who just came back.
  reborn:     { id: 'reborn',     name: 'Reborn',       icon: '🜁',  desc: 'Recently returned to the battlefield from death.' },
  // 🔥 BURNING RESURRECTION — Phoenix advanced option: temporary fire fury.
  burningRes: { id: 'burningRes', name: 'Burning Resurrection', icon: '🔥', atkMod: 4, magMod: 4, desc: 'Risen in flame — +4 ATK & +4 MAG while it burns.' },
  // 🛡️ SOUL FLAME — Phoenix advanced option: a protective revive ward.
  soulFlame:  { id: 'soulFlame',  name: 'Soul Flame',   icon: '🕯️', defMod: 4, resMod: 4, desc: 'Wreathed in soul-fire — +4 DEF & +4 RES while it lasts.' },
  // ❄️ FROST FORM — granted by the Frost Form passive on near-KO. While
  // active the unit is encased in magical frost: tougher but slower.
  frostForm:  { id: 'frostForm',  name: 'Frost Form',   icon: '❄️', defMod: 4, resMod: 3, spdMod: -1, desc: 'Encased in frost: +4 DEF, +3 RES, -1 SPD. Fades after a few turns.' },
};

export const PASSIVES = {
  none:         { id: 'none',         name: 'None',         desc: 'No passive ability' },
  regeneration: { id: 'regeneration', name: 'Regeneration', desc: 'Heal 2 HP at start of your turn' },
  // 🜂 ARCHON SUMMON — CATALYST RANKS. A unit with a Catalyst passive holds a
  // fragment of Primordial Energy and can initiate an Archon Summon ritual:
  // surround it with the Offering units an Archon requires (within range), pay
  // the Kalon Source cost, and the Archon answers the call. Higher ranks unlock
  // higher Archon tiers. The required rank is set per-Archon in the Forge.
  catalyst:           { id: 'catalyst',           name: 'Catalyst (Lesser)',      desc: '🜂 Holds Primordial Energy — can initiate an Archon Summon, summoning Lesser Archons.' },
  catalystAscended:   { id: 'catalystAscended',   name: 'Ascended Catalyst',      desc: '🜂 Can initiate an Archon Summon, summoning up to Greater Archons.' },
  catalystDivine:     { id: 'catalystDivine',     name: 'Divine Catalyst',        desc: '🜂 Can initiate an Archon Summon, summoning up to Divine Archons.' },
  catalystPrimordial: { id: 'catalystPrimordial', name: 'Primordial Catalyst',    desc: '🜂 Can initiate an Archon Summon, summoning up to Creator Avatars & Primordial-class entities.' },
  // 🚫 SUPPRESSION AURAS — while a unit carrying one of these is alive on the
  // field, the named mechanic is shut off for BOTH players (a static "stax"
  // lockdown). Put both on one card for a total Kalon + Archon null-field.
  kalonSuppress:  { id: 'kalonSuppress',  name: 'Null Awakening',  desc: '🚫 While this unit lives, NEITHER player can Kalon Transform.' },
  archonSuppress: { id: 'archonSuppress', name: 'Seal the Source', desc: '🚫 While this unit lives, NEITHER player can perform an Archon Summon.' },
  // 🪦 RAISE FROM DEAD
  // On death, leave a GLOWING tombstone that blocks the tile for 1-3 turns.
  // When the timer expires, the unit revives on that tile at 60% HP.
  // Each unit gets 1-3 uses (configurable per-unit via `unit.raiseFromDead =
  // { maxUses, reviveTurns }`). Useful for boss units, undead, lich-style
  // characters. Configurable per card in the Forge.
  raiseFromDead:{ id: 'raiseFromDead', name: 'Raise From Dead', desc: 'On death: leave a glowing tombstone for 2 turns. If the tile stays clear, the unit rises at 60% HP. (1-3 charges per unit.)' },
  // 🜂 FORCED ASCENSION — auto Kalon-transforms at a set turn timing.
  forcedAscension:{ id: 'forcedAscension', name: 'Forced Ascension', desc: '🜂 Automatically Kalon-transforms at the configured timing (start of its own turn by default) — no charge spent. Configure in the Forge.' },
  // 🜁 REBIRTH SHIFT — on death, returns next turn as a different unit.
  rebirthShift:{ id: 'rebirthShift', name: 'Rebirth Shift', desc: '🜁 When this unit dies, at the start of its owner\'s next turn it returns as a unit from its admin-defined Rebirth Pool (summoning sick, no inherited buffs unless allowed).' },
  // 🔥 PHOENIX REBIRTH AURA — triggered aura: nearby allies that die have a
  // chance to be revived in flame.
  phoenixRebirth:{ id: 'phoenixRebirth', name: 'Phoenix Rebirth Aura', desc: '🔥 When an allied unit dies within this unit\'s aura, a % chance (default 30%) to revive it at a % HP (default 25%). Configure range / chance / limits in the Forge.' },
  thorns:       { id: 'thorns',       name: 'Thorns',       desc: 'Reflect 25% damage taken' },
  lifesteal:    { id: 'lifesteal',    name: 'Lifesteal',    desc: 'Heal 30% of damage dealt' },
  swift:        { id: 'swift',        name: 'Swift',        desc: '+1 movement range' },
  tough:        { id: 'tough',        name: 'Tough',        desc: '+3 Defense' },
  magicWard:    { id: 'magicWard',    name: 'Magic Ward',   desc: '+3 Magic Resist' },
  warlord:      { id: 'warlord',      name: 'Warlord',      desc: 'Your units gain +2 Attack' },
  archmage:     { id: 'archmage',     name: 'Archmage',     desc: 'Spells cost 1 less energy' },
  guardian:     { id: 'guardian',     name: 'Guardian',     desc: 'Adjacent allies take 25% less damage' },
  inspire:      { id: 'inspire',      name: 'Inspire',      desc: 'When an allied unit enters play whose cost ≥ this unit\'s cost, that unit gains the configured Inspire Effect (Swift / stat buff / buff-all-stats / draw / energy). Buff All Stats requires the new unit to cost strictly MORE.' },
  venomous:     { id: 'venomous',     name: 'Venomous',     desc: 'Attacks have 30% chance to poison' },
  bloodthirst:  { id: 'bloodthirst',  name: 'Bloodthirst',  desc: 'Heal 5 HP after killing a unit' },
  sunbather:    { id: 'sunbather',    name: 'Sunbather',    desc: 'Heal 4 HP at start of turn during ☀️ Sunny weather' },
  rainmaker:    { id: 'rainmaker',    name: 'Rainmaker',    desc: '+5 Magic during 🌧️ Rainstorm' },
  dustcloak:    { id: 'dustcloak',    name: 'Dustcloak',    desc: 'Immune to 🏜️ Sandstorm; +1 SPD in Sandstorm' },
  stormborn:    { id: 'stormborn',    name: 'Stormborn',    desc: 'Damage +25% during any active weather' },
  weatherweaver:{ id: 'weatherweaver',name: 'Weatherweaver',desc: 'Your weather cards last 2 extra turns' },
  weatherSummoner:{ id: 'weatherSummoner',name: 'Weather Summoner',desc: 'When summoned from hand, calls weather matching this unit\'s primary element (4 turns).' },
  energySpring:   { id: 'energySpring',  name: 'Energy Spring', desc: '+1 energy at the start of your turn while this unit is on the field.' },
  kalonChannel:   { id: 'kalonChannel',  name: 'Kalon Channel', desc: 'When this unit KOs an enemy, refunds 1 Kalon use to your pool (cap 3).' },
  taunt:        { id: 'taunt',        name: 'Taunt',        desc: 'Enemies in range must attack this unit before any other target.' },
  // ❄️ FROST FORM — survive one KO from non-ice damage, enter Frost Form.
  frostForm:    { id: 'frostForm',    name: 'Frost Form',   desc: 'Once per battle: when this unit would be KO\'d by non-ice damage, survive at 1 HP and gain Frost Form status for 3 turns (more DEF/RES, less SPD).' },
  // 🍖 CONSUME — absorb ATK + DEF from units you kill.
  consume:      { id: 'consume',      name: 'Consume',      desc: 'When this unit KOs an enemy, absorb their ATK and DEF (+1 each per kill, capped at +5 total stacks).' },
  // ===== HEX TCG KEYWORD PASSIVES =====
  // 🏃 SPEED — enters play with no summoning sickness (Hex TCG: Speed keyword).
  speed:        { id: 'speed',        name: 'Speed',        desc: 'Enters play with no summoning sickness — can move and attack immediately on the turn it is deployed.' },
  // ⚡ SWIFTSTRIKE — deals damage before the target can retaliate (Hex TCG: Swiftstrike).
  // Strips Countering stance when attacking; if the target dies the retribution also cannot fire.
  swiftstrike:  { id: 'swiftstrike',  name: 'Swiftstrike',  desc: 'Attacks land before the target can counter. Strips the Countering stance on hit. If the target is killed, Lethal Retribution is also silenced.' },
  // 💥 CRUSH — overkill damage carries through to the enemy hero (Hex TCG: Crush).
  crush:        { id: 'crush',        name: 'Crush',        desc: 'Excess damage from a killing blow carries over to the enemy hero. If this unit kills with 4 overkill, the hero takes 4 damage.' },
  // 🗡️ STEADFAST — one free bonus attack per turn (Hex TCG: Steadfast).
  // The unit does not exhaust on its first attack; a second attack marks it as used.
  steadfast:    { id: 'steadfast',    name: 'Steadfast',    desc: 'Does not exhaust on its first attack each turn — can attack a second time. The bonus resets every turn.' },
  // 🛡️ SPELLSHIELD — immune to enemy on-play AoE effects and consumable targeting (Hex TCG: Spellshield).
  spellshield:  { id: 'spellshield',  name: 'Spellshield',  desc: 'Cannot be targeted by opponent on-play AoE effects or consumables. Board-wipes and direct attacks still resolve normally.' },

  // ===== HEX TCG KEYWORD PASSIVES (v86g) =====
  // ☠️ LETHAL — any damage dealt instantly kills a non-hero target (Hex TCG: Lethal).
  lethal:       { id: 'lethal',       name: 'Lethal',       desc: 'Any damage this unit deals to a non-hero unit is instantly fatal, regardless of remaining HP.' },
  // ⚔️ DEFENDER — cannot attack; holds the line as a defensive blocker (Hex TCG: Defender).
  defender:     { id: 'defender',     name: 'Defender',     desc: 'This unit cannot attack. It holds the line as a defensive blocker and cannot be directed to strike.' },
  // 🌀 UNBLOCKABLE — bypasses Bodyguard/Guardian intercepts and can hit flying units (Hex TCG: Unblockable).
  unblockable:  { id: 'unblockable',  name: 'Unblockable',  desc: 'Ignores Bodyguard and Guardian intercepts. Can hit flying units without needing aerial reach.' },
  // 🔥 ATTACK RAGE — permanently gains +N ATK each time this unit attacks (Hex TCG: Rage N).
  attackRage:   { id: 'attackRage',   name: 'Attack Rage',  desc: 'Each time this unit attacks, it permanently gains +1 ATK (or +N if rageN is set on the card). Stacks every swing.' },
  // 🤝 MOBILIZE — costs 2 less energy when at least 1 allied non-hero unit is on the field (Hex TCG: Mobilize).
  mobilize:     { id: 'mobilize',     name: 'Mobilize',     desc: 'Costs 2 less energy to play when at least 1 allied non-hero unit is already on the battlefield.' },
  // 🔮 PROPHECY — when this unit enters play, the next unit you deploy gains +2 ATK and +2 DEF (Hex TCG: Prophecy).
  prophecy:     { id: 'prophecy',     name: 'Prophecy',     desc: 'When this unit enters play, your next deployed unit gains +2 ATK and +2 DEF.' },

  // ===== HEX TCG KEYWORD PASSIVES (v86h) =====
  // 🩸 LIFEDRAIN — heal HP equal to 100% of combat damage dealt (Hex TCG: Lifedrain).
  lifedrain:    { id: 'lifedrain',   name: 'Lifedrain',    desc: 'Heals this unit for HP equal to all combat damage it deals — full 1:1 drain (stronger than the 30% Lifesteal passive).' },
  // 🌤️ SKYGUARD — can target and hit flying units with any attack (Hex TCG: Skyguard).
  skyguard:     { id: 'skyguard',    name: 'Skyguard',     desc: 'This unit can target and hit flying units with any attack, regardless of move type or range. Anti-air specialist.' },
  // 🌟 INVINCIBLE — cannot be killed by damage; all hits floor at 1 HP (Hex TCG: Invincible).
  invincible:   { id: 'invincible',  name: 'Invincible',   desc: 'Cannot be destroyed by damage. Every attack, spell, or DoT that would reduce HP to 0 stops at 1 HP instead. Removal effects still work.' },

  // ===== 🛡️ BODYGUARD / GUARDIAN — unit-level intercept passives =====
  // Any unit (not just tank/warrior heroes) can now carry these. The intercept
  // engine checks both the hero skill-tree flags (legacy) AND these passives so
  // custom cards created in the Forge work identically.
  //
  // BODYGUARD — intercept any attack aimed at an ally within 1 tile. No limit.
  bodyguard:    { id: 'bodyguard',   name: 'Bodyguard',    desc: 'Steps in front of attacks targeting allies within 1 tile. Redirects enemy hits to this unit instead. No use limit.' },
  // GUARDIAN — intercept the FIRST incoming attack on any ally within 2 tiles (once per match).
  // The one-shot limit is tracked via _guardianUsed on the unit object.
  guardian:     { id: 'guardian',    name: 'Guardian',     desc: 'Once per match, redirects the first incoming attack on any ally within 2 tiles to this unit instead. Consumed after use.' },

  // ===== 💀 IMMORTAL — cannot be killed by a damage TYPE =====
  // Damage of the matching type can still drain the unit all the way to 1 HP,
  // but never below. Crits, combos, status DoT, splash all respect the cap as
  // long as the damage source is of the matching type. Damage of the OTHER
  // type still kills normally (Magic kills a Physical-Immortal, Physical kills
  // a Magical-Immortal) — these are designed as paired counterplay levers.
  // Both fire INSIDE applyDamageTriggers right before alive=false flips, so
  // every callsite (attacks, AoE, spell cards, splash, counter) honors them.
  physicalImmortal: { id: 'physicalImmortal', name: 'Unbreakable Body', desc: '🛡️ Cannot die from PHYSICAL damage — drops to 1 HP instead. Magical damage kills normally.' },
  magicalImmortal:  { id: 'magicalImmortal',  name: 'Soul Shield',      desc: '🔮 Cannot die from MAGICAL damage — drops to 1 HP instead. Physical damage kills normally.' },

  // ===== ☠️ LETHAL RETALIATION — slay the attacker on contact =====
  // When this unit is struck by a damaging attack of the matching type,
  // the ATTACKER is instantly slain. The ONLY thing immune is an enemy
  // HERO (heroes can't be one-shot by walking into a retaliator). Fires
  // right after the Thorns hook so it sees the resolved hit + damage type.
  physicalRetribution: { id: 'physicalRetribution', name: 'Spiked Carapace', desc: '☠️ When hit by a PHYSICAL attack, the attacker is instantly slain. Enemy heroes are immune.' },
  magicalRetribution:  { id: 'magicalRetribution',  name: 'Mana Feedback',   desc: '☠️ When hit by a MAGICAL attack, the attacker is instantly slain. Enemy heroes are immune.' },
  // 👁 Predator's Eye — built-in Overwatch. Whenever an enemy unit or hero
  // MOVES within 2 tiles, this unit/hero makes a free reaction strike. Once
  // per enemy turn (re-arms automatically each enemy turn — no move slot used).
  predatorsEye: { id: 'predatorsEye', name: "Predator's Eye", desc: "👁 Reaction: when an enemy moves within 2 tiles, strike them for free. Once per enemy turn." },
  // 🎯 Hair Trigger — XCOM-2 trait. Overwatch / Ambush reaction shots
  // CAN crit. Without this passive reaction shots have their crit chance
  // forced to 0.
  hairTrigger:       { id: 'hairTrigger',       name: 'Hair Trigger',         desc: "🎯 Overwatch + Ambush reactions can crit (default reactions cannot)." },
  // 🧊 Cool Under Pressure — XCOM-2 trait. Bypass the 25% damage penalty
  // that reaction shots normally suffer. Reaction shots hit at full power.
  coolUnderPressure: { id: 'coolUnderPressure', name: 'Cool Under Pressure',  desc: "🧊 Overwatch + Ambush reactions ignore the 25% damage penalty — full-power reaction shots." },
  // 🩸 STABILIZE — XCOM-2-style bleed-out. When this NON-hero unit would
  // hit 0 HP, they go to "Bleeding" instead of dying. Bleeding units lie on
  // their tile for 3 turns, can't act, can't be targeted, and can be walked
  // over. ANY adjacent ally can spend an action to Stabilize them (restores
  // to 1 HP). A Combat Medkit consumable can revive from anywhere on the
  // board (+5 HP). If the 3-turn bleed-out timer expires without rescue, the
  // unit dies permanently AND is removed from the player's collection.
  // Heroes ignore this passive — they use the standard hero-death rules.
  stabilize: { id: 'stabilize', name: 'Stabilize', desc: '🩸 Bleed-Out — When this non-hero unit hits 0 HP, they enter Bleeding for 3 turns instead of dying. Any adjacent ally can Stabilize them (revive to 1 HP). Combat Medkit consumable also revives. Unstabilized after 3 turns → PERMADEATH (removed from your collection).' },
  // 🔭 SQUAD SIGHT — XCOM-2 sniper trait. When this unit attacks, its
  // effective range extends to include every tile an ally can already
  // see (radius 3 around any ally). Lets snipers reach back-line targets
  // without moving up.
  squadSight: { id: 'squadSight', name: 'Squad Sight', desc: '🔭 Attack range extends to any tile a teammate can see (radius 3 around any ally).' },
  // 🛡 IRON WILL — Resists the panic Will check after a friendly death.
  // Without it, a 30% bond/morale failure rate panics the unit; with it,
  // the unit is immune to panic.
  ironWill: { id: 'ironWill', name: 'Iron Will', desc: '🛡 Immune to Panic. Other panic-resist sources stack into this.' },
  // 🆘 UNDERDOG / OUTNUMBERED MIRACLE — applies to the CARD that carries
  // the passive (in hand). When the opponent controls MORE alive units on
  // the field than YOU do, THIS card costs 0 energy to play. Other cards
  // in the same hand keep their normal cost. Counts alive non-bleeding
  // units (heroes count). The discount turns off the instant unit counts
  // equalize. Designed as a comeback lever — slap it on a tide-turning
  // unit or hero so the player has a free deploy when behind on tempo.
  outnumbered: { id: 'outnumbered', name: 'Underdog', desc: '🆘 While the enemy controls MORE alive units than you do, THIS card costs 0 energy to play from your hand. Only this card — other cards in your hand keep their normal cost. The discount turns off the instant unit counts equalize.' },

  // ===== ⚔️ COMPETITIVE TOOLKIT — damage/survival engine passives =====
  // Five archetypal engine pieces (mostly damage amplifiers or one-shot
  // survival levers). Each lives at a single engine hook so they compose
  // cleanly with existing passives.
  sturdy:        { id: 'sturdy',        name: 'Bedrock',            desc: '🪨 If at full HP, any attack that would KO this unit leaves it at 1 HP instead. Once per battle.' },
  moxie:         { id: 'moxie',         name: 'Killer Instinct',    desc: '⚔️ Each KO this unit lands grants +2 ATK permanently (max 5 stacks / +10 ATK).' },
  divineSmite:   { id: 'divineSmite',   name: 'Daybreaker',         desc: '✨ The FIRST attack each turn deals +25% damage. Resets each turn-start.' },
  adaptability:  { id: 'adaptability',  name: 'Elemental Affinity', desc: '🔄 Matching-element attacks (STAB) deal +75% damage instead of the normal +50%.' },
  sneakAttack:   { id: 'sneakAttack',   name: 'Flanker',            desc: '🗡️ +30% damage on attacks when at least one ALLY is adjacent to the target.' },

  // ===== TRIBAL FACTION PASSIVES =====
  // Each passive is themed to a faction. Bonuses scale with the count of OTHER same-faction allies on your side.
  warriorOath:   { id: 'warriorOath',   name: "Warrior's Oath", faction: 'warrior',   desc: '+1 ATK per other ally Warrior on the field (max +5)' },
  arcaneBond:    { id: 'arcaneBond',    name: 'Arcane Bond',    faction: 'mage',      desc: '+1 MAG per other ally Mage on the field (max +5)' },
  packTactics:   { id: 'packTactics',   name: 'Pack Tactics',   faction: 'rogue',     desc: '+5% crit per other ally Rogue (max +20%)' },
  packLeader:    { id: 'packLeader',    name: 'Pack Leader',    faction: 'beast',     desc: '+1 SPD if any other ally Beast is on the field' },
  flockFlight:   { id: 'flockFlight',   name: 'Flock Flight',   faction: 'bird',      desc: 'Becomes Flying while another ally Bird is alive' },
  swarmInstinct: { id: 'swarmInstinct', name: 'Swarm Instinct', faction: 'bug',       desc: '+10% poison-on-hit chance per other ally Bug (max +30%)' },
  mobTactics:    { id: 'mobTactics',    name: 'Mob Tactics',    faction: 'goblinoid', desc: '+1 ATK per other ally Goblinoid (max +5)' },
  hellbound:     { id: 'hellbound',     name: 'Hellbound',      faction: 'demon',     desc: '+1 ATK and +1 MAG per other ally Demon (max +4 each)' },
  deathlyVigil:  { id: 'deathlyVigil',  name: 'Deathly Vigil',  faction: 'undead',    desc: 'Heal 2 HP at start of turn per other ally Undead (max 6)' },
  elementBond:   { id: 'elementBond',   name: 'Element Bond',   faction: 'elemental', desc: '+1 MAG per other ally Elemental (max +4)' },
  faewish:       { id: 'faewish',       name: 'Faewish',        faction: 'fairy',     desc: '10% dodge chance per other ally Fairy (max 30%)' },
  dragonsBoon:   { id: 'dragonsBoon',   name: "Dragon's Boon",  faction: 'dragonkin', desc: '+2 ATK and +2 MAG per other ally Dragonkin (max +6 each)' },
  constructed:   { id: 'constructed',   name: 'Constructed',    faction: 'construct', desc: 'Immune to poison, burn, bleed, and infected' },
  holyAura:      { id: 'holyAura',      name: 'Holy Aura',      faction: 'celestial', desc: 'Heal 1 HP at start of turn per other ally Celestial (max 4)' },
  rootsOfLife:   { id: 'rootsOfLife',   name: 'Roots of Life',  faction: 'plant',     desc: 'Heal 3 HP at start of every turn' },
  coldScales:    { id: 'coldScales',    name: 'Cold Scales',    faction: 'reptile',   desc: '+2 DEF and +2 RES per other ally Reptile (max +6 each); immune to slow and frozen' },
  // Alien faction passive — carriers of the plague are immune to it. Bonus is the
  // contagion theme: on a melee hit, 25% chance to infect the target (handled in
  // computeDamage's post-hit hook just like venomous/bloodthirst).
  xenoBond:      { id: 'xenoBond',      name: 'Xeno Bond',      faction: 'alien',     desc: 'Immune to Infected; 25% chance to Infect targets on hit (3t)' },
  // 🪨 Geomancer — anti-field passive. Carriers shatter enemy locations.
  geomancer:     { id: 'geomancer',     name: 'Geomancer',                            desc: '20% chance/turn to destroy the opponent\'s active Location field' },

  // 🪤 ===== TRAP / WALL / SURFACE / WEATHER COUNTER-PLAY PASSIVES =====
  // These give players reactive tools so battlefield hazards (traps, walls,
  // weather, surfaces) become two-sided. Without these passives, a player
  // playing 5 traps could lock the board forever. The counter-play kit:
  //   trapHunter  — knows traps are out there, hits harder while they are
  //   trapDog     — reveals enemy traps when this unit enters play
  //   trapBreaker — disarms an adjacent enemy trap at the start of each turn
  //   wallBreaker — +50% damage to wall structures
  //   surfaceWalker — immune to surface hazards; clears the tile you step on
  //   weatherWarden — clears active weather over 3 turns (1 turn/round)
  // The engine checks these flags wherever it makes sense; the modal shows
  // them as proper effects so admins can attach them to specific cards.
  trapHunter:    { id: 'trapHunter',    name: 'Trap Hunter',    desc: '🪤 +2 ATK and +1 SPD while ANY trap is on the field (yours OR theirs). The unit thrives when the board is dangerous.' },
  trapDog:       { id: 'trapDog',       name: 'Trap Dog',       desc: '🐕 On entering play: reveals every enemy trap on the board for the rest of the match.' },
  trapBreaker:   { id: 'trapBreaker',   name: 'Trap Breaker',   desc: '🔧 At the start of your turn: disarms one adjacent enemy trap (random pick from those in Chebyshev radius 1).' },
  wallBreaker:   { id: 'wallBreaker',   name: 'Wall Breaker',   desc: '🧱 +50% damage to walls/structures (any wall tile attacked).' },
  surfaceWalker: { id: 'surfaceWalker', name: 'Surface Walker', desc: '🧹 Immune to surface hazards. When this unit moves onto a tile with a surface, that surface is cleared (oil / fire / water / glass / mud).' },
  weatherWarden: { id: 'weatherWarden', name: 'Weather Warden', desc: '🌤 Active weather ends 1 turn sooner each round this unit is on the field. Clears calm weather windows.' },
  // 👁 ===== X-RAY VISION — passive scan for the whole match =====
  // While this unit is alive on your side, every enemy unit + hero is
  // treated as scanned: type / faction / element / passives / moves /
  // stats are all visible in the unit detail modal. Synergizes with
  // moves like Aimed Strike that key off scanned targets.
  xrayVision:    { id: 'xrayVision',    name: 'X-Ray Vision',   desc: '👁 While this unit is alive: ALL enemy units + heroes are auto-scanned. Their type, faction, element, passives, moves, and full stats are visible.' },

  // ===== 🛡️ ELEMENT WARDS — full immunity to a specific element's damage =====
  // Damage from moves with the warded element is dropped to 0 (typeMul = 0).
  // Status effects + stat-mod moves with that element still apply normally.
  fireWard:      { id: 'fireWard',      name: 'Fire Ward',      wardElement: 'fire',   desc: '🛡️🔥 Immune to all fire-element damage.' },
  waterWard:     { id: 'waterWard',     name: 'Water Ward',     wardElement: 'water',  desc: '🛡️💧 Immune to all water-element damage.' },
  earthWard:     { id: 'earthWard',     name: 'Earth Ward',     wardElement: 'earth',  desc: '🛡️🪨 Immune to all earth-element damage.' },
  windWard:      { id: 'windWard',      name: 'Wind Ward',      wardElement: 'wind',   desc: '🛡️🌪️ Immune to all wind-element damage.' },
  lightWard:     { id: 'lightWard',     name: 'Light Ward',     wardElement: 'light',  desc: '🛡️✨ Immune to all light-element damage.' },
  shadowWard:    { id: 'shadowWard',    name: 'Shadow Ward',    wardElement: 'shadow', desc: '🛡️🌑 Immune to all shadow-element damage.' },
  natureWard:    { id: 'natureWard',    name: 'Nature Ward',    wardElement: 'nature', desc: '🛡️🌿 Immune to all nature-element damage.' },
  stormWard:     { id: 'stormWard',     name: 'Storm Ward',     wardElement: 'storm',  desc: '🛡️⚡ Immune to all storm-element damage.' },
  iceWard:       { id: 'iceWard',       name: 'Ice Ward',       wardElement: 'ice',    desc: '🛡️❄️ Immune to all ice-element damage.' },
  arcaneWard:    { id: 'arcaneWard',    name: 'Arcane Ward',    wardElement: 'arcane', desc: '🛡️🔮 Immune to all arcane-element damage.' },
  voidWard:      { id: 'voidWard',      name: 'Void Ward',      wardElement: 'void',   desc: '🛡️🕳️ Immune to all void-element damage.' },
  bloodWard:     { id: 'bloodWard',     name: 'Blood Ward',     wardElement: 'blood',  desc: '🛡️🩸 Immune to all blood-element damage.' },

  // ===== 🛡️ FACTION WARDS — full immunity to attacks from a specific faction =====
  // Move damage is dropped to 0 if the ATTACKER has the warded faction. Status
  // effects + utility moves still go through (only the damage is nullified).
  wardVsWarrior:   { id: 'wardVsWarrior',   name: 'Champion\'s Bane',    wardFaction: 'warrior',   desc: '🛡️⚔️ Immune to damage from Warrior attackers.' },
  wardVsMage:     { id: 'wardVsMage',      name: 'Spellbreaker',        wardFaction: 'mage',      desc: '🛡️🔮 Immune to damage from Mage attackers.' },
  wardVsRogue:    { id: 'wardVsRogue',     name: 'Eagle Eye',           wardFaction: 'rogue',     desc: '🛡️🗡️ Immune to damage from Rogue attackers.' },
  wardVsBeast:    { id: 'wardVsBeast',     name: 'Hunter\'s Mark',      wardFaction: 'beast',     desc: '🛡️🐺 Immune to damage from Beast attackers.' },
  wardVsBird:     { id: 'wardVsBird',      name: 'Falconer\'s Net',     wardFaction: 'bird',      desc: '🛡️🦅 Immune to damage from Bird attackers.' },
  wardVsBug:      { id: 'wardVsBug',       name: 'Exterminator',        wardFaction: 'bug',       desc: '🛡️🐛 Immune to damage from Bug attackers.' },
  wardVsDemon:    { id: 'wardVsDemon',     name: 'Sanctified',          wardFaction: 'demon',     desc: '🛡️😈 Immune to damage from Demon attackers.' },
  wardVsUndead:   { id: 'wardVsUndead',    name: 'Hallowed Flesh',      wardFaction: 'undead',    desc: '🛡️💀 Immune to damage from Undead attackers.' },
  wardVsDragon:   { id: 'wardVsDragon',    name: 'Dragon Slayer',       wardFaction: 'dragonkin', desc: '🛡️🐉 Immune to damage from Dragonkin attackers.' },
  wardVsConstruct:{ id: 'wardVsConstruct', name: 'Rust Touch',          wardFaction: 'construct', desc: '🛡️🤖 Immune to damage from Construct attackers.' },
  wardVsCelestial:{ id: 'wardVsCelestial', name: 'Heretic\'s Armor',    wardFaction: 'celestial', desc: '🛡️😇 Immune to damage from Celestial attackers.' },
  wardVsGoblinoid:{ id: 'wardVsGoblinoid', name: 'Tribal Defense',      wardFaction: 'goblinoid', desc: '🛡️👺 Immune to damage from Goblinoid attackers.' },
  wardVsFairy:    { id: 'wardVsFairy',     name: 'Cold Iron',           wardFaction: 'fairy',     desc: '🛡️🧚 Immune to damage from Fairy attackers.' },

  // ===== 🌦️ WEATHER-TRIGGERED PASSIVES =====
  // Each fires only when the matching weather is active (turnsLeft > 0). The
  // intent is to give weather decks identity beyond raw damage tuning — a unit
  // can be middling on a clear field and devastating once its element's sky
  // rolls in. Wording in `desc` uses the weather emoji + name so the player
  // can quickly scan which sky activates the bonus.

  // ☀️ Sun
  solarFlare:      { id: 'solarFlare',      name: 'Solar Flare',      desc: '☀️ Sun: this unit may attack TWICE per turn (first attack each turn is free).' },
  radiantAegis:    { id: 'radiantAegis',    name: 'Radiant Aegis',    desc: '☀️ Sun: adjacent allies take 25% less damage (aura).' },
  sunforged:       { id: 'sunforged',       name: 'Sunforged',        desc: '☀️ Sun: immune to elemental weakness — super-effective hits are capped at 1× damage.' },

  // 🌧️ Rain
  monsoonMight:    { id: 'monsoonMight',    name: 'Monsoon Might',    desc: '🌧️ Rain: +3 ATK and +3 MAG.' },
  tideHealer:      { id: 'tideHealer',      name: 'Tide Healer',      desc: '🌧️ Rain: heal ALL allied units 2 HP at the start of your turn.' },
  stormChannel:    { id: 'stormChannel',    name: 'Storm Channel',    desc: '🌧️ Rain: gain +1 energy at the start of your turn (stacks with other channelers).' },

  // 🏜️ Sandstorm
  sandShroud:      { id: 'sandShroud',      name: 'Sand Shroud',      desc: '🏜️ Sandstorm: enemies have +30% miss chance when attacking this unit.' },
  dustForged:      { id: 'dustForged',      name: 'Dust Forged',      desc: '🏜️ Sandstorm: +4 DEF and +4 RES.' },

  // 🌫️ Mist
  mistDancer:      { id: 'mistDancer',      name: 'Mist Dancer',      desc: '🌫️ Mist: your attacks cannot miss, and crit chance +20%.' },
  ambushSoul:      { id: 'ambushSoul',      name: 'Ambush Soul',      desc: '🌫️ Mist: the FIRST attack you make each turn deals +50% damage.' },

  // 🌑 Eclipse
  eclipseLord:     { id: 'eclipseLord',     name: 'Eclipse Lord',     desc: '🌑 Eclipse: +30% damage; attacks ignore 50% of target DEF / RES.' },
  shadowMeld:      { id: 'shadowMeld',      name: 'Shadow Meld',      desc: '🌑 Eclipse: ranged attacks (range > 1) automatically miss this unit.' },

  // 🩸 Bloodmoon
  bloodLord:       { id: 'bloodLord',       name: 'Blood Lord',       desc: '🩸 Bloodmoon: lifesteal 50% of damage dealt (replaces normal lifesteal in bloodmoon).' },
  crimsonCovenant: { id: 'crimsonCovenant', name: 'Crimson Covenant', desc: '🩸 Bloodmoon: adjacent allies gain +2 ATK and +2 MAG (aura).' },

  // 🧠 Mind Realm
  lucidThinker:    { id: 'lucidThinker',    name: 'Lucid Thinker',    desc: '🧠 Mind Realm: your moves cost 1 less energy (min 0).' },

  // 🌍 Parallel World
  paradoxGuard:    { id: 'paradoxGuard',    name: 'Paradox Guard',    desc: '🌍 Parallel World: your SPD inversion is canceled — keep your normal speed.' },

  // 🌪️ Any active weather
  tempestSoul:     { id: 'tempestSoul',     name: 'Tempest Soul',     desc: '🌪️ Any weather: +2 SPD, +1 ATK, +1 MAG, +1 DEF, +1 RES.' },
  weatherWalker:   { id: 'weatherWalker',   name: 'Weather Walker',   desc: '🌪️ Any weather: +1 movement; immune to sandstorm damage and weather-applied status effects.' },
  // 💸 WEATHERBORN — free to play while a weather is active. The generic one
  // fires for ANY sky; the per-weather variants only fire for that specific
  // weather. All handled in getEffectiveCardCost via WEATHERBORN_PASSIVES.
  weatherborn:          { id: 'weatherborn',          name: 'Weatherborn',            desc: '🌪️ Any weather: this card costs 0 energy to play (free while any sky is active).' },
  weatherbornRain:      { id: 'weatherbornRain',      name: 'Weatherborn — Rain',     desc: '🌧️ Rain only: this card costs 0 energy to play while it is raining.' },
  weatherbornSun:       { id: 'weatherbornSun',       name: 'Weatherborn — Sun',      desc: '☀️ Sun only: this card costs 0 energy to play while the sun is out.' },
  weatherbornSand:      { id: 'weatherbornSand',      name: 'Weatherborn — Sandstorm',desc: '🏜️ Sandstorm only: this card costs 0 energy to play during a sandstorm.' },
  weatherbornStorm:     { id: 'weatherbornStorm',     name: 'Weatherborn — Storm',    desc: '⚡ Lightning Storm only: this card costs 0 energy to play during a storm.' },
  weatherbornMist:      { id: 'weatherbornMist',      name: 'Weatherborn — Mist',     desc: '🌫️ Mist only: this card costs 0 energy to play while mist is up.' },
  weatherbornEclipse:   { id: 'weatherbornEclipse',   name: 'Weatherborn — Eclipse',  desc: '🌑 Eclipse only: this card costs 0 energy to play during an eclipse.' },
  weatherbornBloodmoon: { id: 'weatherbornBloodmoon', name: 'Weatherborn — Bloodmoon',desc: '🌕 Bloodmoon only: this card costs 0 energy to play under a bloodmoon.' },
  weatherbornMind:      { id: 'weatherbornMind',      name: 'Weatherborn — Mind Realm',desc: '🧠 Mind Realm only: this card costs 0 energy to play in the Mind Realm.' },
  weatherbornParallel:  { id: 'weatherbornParallel',  name: 'Weatherborn — Parallel World', desc: '🔮 Parallel World only: this card costs 0 energy to play in a Parallel World.' },

  // ===== ✨ PER-STAT INSPIRE PASSIVES (v86m) =====
  // Each triggers when an ally that costs STRICTLY MORE than this unit enters
  // play. That ally gains +1 in the respective stat. These are separate passive
  // IDs from 'inspire' — they work independently and can stack with each other
  // and with the main inspire passive.
  inspireAtk: { id: 'inspireAtk', name: 'Inspire ATK', desc: '✨ When an allied unit that costs STRICTLY MORE than this unit enters play, that ally gains +1 ATK.' },
  inspireDef: { id: 'inspireDef', name: 'Inspire DEF', desc: '✨ When an allied unit that costs STRICTLY MORE than this unit enters play, that ally gains +1 DEF.' },
  inspireMag: { id: 'inspireMag', name: 'Inspire MAG', desc: '✨ When an allied unit that costs STRICTLY MORE than this unit enters play, that ally gains +1 MAG.' },
  inspireRes: { id: 'inspireRes', name: 'Inspire RES', desc: '✨ When an allied unit that costs STRICTLY MORE than this unit enters play, that ally gains +1 RES.' },
  // ✨ ARCANE TEMPO — draw 1 extra card every 3 turns while this unit is alive (v86o).
  // Fires in startTurn. Uses the per-side drawCounter (no new state needed).
  inspireDrawTimer: { id: 'inspireDrawTimer', name: 'Arcane Tempo', desc: '✨ While this unit is alive, you draw 1 extra card at the start of every 3rd turn.' },
};

export const WEATHERBORN_PASSIVES = {
  weatherborn:          null,
  weatherbornRain:      'rain',
  weatherbornSun:       'sun',
  weatherbornSand:      'sand',
  weatherbornStorm:     'lightningStorm',
  weatherbornMist:      'mist',
  weatherbornEclipse:   'eclipse',
  weatherbornBloodmoon: 'bloodmoon',
  weatherbornMind:      'mindRealm',
  weatherbornParallel:  'parallelWorld',
};

export const ELEMENTS = [
  'fire', 'water', 'earth', 'wind', 'light', 'shadow', 'nature', 'storm',
  'ice', 'metal', 'poison', 'psychic', 'arcane', 'void', 'blood', 'crystal',
  'corruption', 'spirit', 'lava', 'sound', 'gravity',
];

export const STRONG_VS = {
  fire:    ['nature', 'wind', 'ice', 'metal'],   // burns plants, consumes air, melts ice, heats metal
  water:   ['fire', 'earth', 'blood'],           // douses, erodes, dilutes
  earth:   ['fire', 'storm', 'poison'],          // smothers, grounds lightning, absorbs toxins
  wind:    ['earth', 'nature', 'poison'],        // erodes stone, scatters seeds + clouds toxin
  nature:  ['water', 'shadow', 'crystal'],       // absorbs, life vs decay, roots crack gems
  shadow:  ['light', 'nature', 'psychic'],       // snuff, decay, corrupts mind
  light:   ['shadow', 'storm', 'void'],          // banish, dispel storms, illuminates the void
  storm:   ['water', 'wind', 'metal'],           // electricity through water, dominates wind, fries circuits
  // ===== New element matchups =====
  ice:        ['nature', 'water', 'blood'],         // freezes plants, freezes water, chills blood
  metal:      ['earth', 'ice', 'crystal'],          // refined ore splits stone, shatters ice & gems
  poison:     ['nature', 'water', 'light'],         // sickens life, taints water, corrupts purity
  psychic:    ['poison', 'fire', 'void'],           // purges toxin, controls flame, focuses against the abyss
  arcane:     ['shadow', 'ice', 'metal'],           // counter-magic over decay, melts frost, dispels enchanted metal
  void:       ['psychic', 'arcane', 'crystal'],     // negates mind, cancels spells, shatters lattices
  blood:      ['light', 'ice', 'nature'],           // life vs purity, warm blood thaws, drains vitality
  crystal:    ['storm', 'fire', 'arcane'],          // refracts lightning, deflects heat, focuses spells
  // ===== Newest elements =====
  corruption: ['nature', 'light', 'water'],         // rot consumes life, taints purity, sickens water
  spirit:     ['metal', 'shadow', 'psychic'],       // ghosts pass through metal, banish dark, touch the mind
  lava:       ['ice', 'metal', 'nature'],           // melts frost, smelts steel, scorches plants
  sound:      ['crystal', 'ice', 'psychic'],        // shatters lattice, vibrates frost, override mind
  gravity:    ['wind', 'fire', 'spirit'],           // pulls air down, smothers flame, anchors the ethereal
};

export const TYPE_CHART = (() => {
  const chart = {};
  for (const a of ELEMENTS) {
    chart[a] = {};
    for (const d of ELEMENTS) {
      const aStrong = STRONG_VS[a].includes(d);
      const dStrong = STRONG_VS[d].includes(a);
      if (aStrong) chart[a][d] = 2.0;       // super-effective (overrides resistance even if mutual)
      else if (dStrong) chart[a][d] = 0.5;  // resisted
      else chart[a][d] = 1.0;
    }
  }
  return chart;
})();

export const MOVES = {
  slash:        { id: 'slash',        name: 'Slash',        kind: 'attack',  type: 'physical', power: 22, range: 1, cost: 0, element: 'nature', basic: true, desc: 'Basic strike (free)' },
  heavyStrike:  { id: 'heavyStrike',  name: 'Heavy Strike', kind: 'attack',  type: 'physical', power: 42, range: 1, cost: 1, element: 'earth', accuracy: 90, desc: 'Devastating blow' },
  pierce:       { id: 'pierce',       name: 'Pierce',       kind: 'attack',  type: 'physical', power: 32, range: 1, cost: 1, element: 'wind',  desc: 'Ignores 50% defense', effect: 'pierce' },
  fireball:     { id: 'fireball',     name: 'Fireball',     kind: 'attack',  type: 'magic',    power: 36, range: 2, cost: 1, element: 'fire',  desc: 'Ball of fire',    applyStatus: { id: 'burn', chance: 30, duration: 2 } },
  lightning:    { id: 'lightning',    name: 'Lightning',    kind: 'attack',  type: 'magic',    power: 48, range: 3, cost: 2, element: 'storm', accuracy: 85, desc: 'Strike from afar' },
  quickJab:     { id: 'quickJab',     name: 'Quick Jab',    kind: 'attack',  type: 'physical', power: 14, range: 1, cost: 0, element: 'nature', basic: true, crit: 12, desc: 'Swift basic attack (free)' },
  arcaneBlast:  { id: 'arcaneBlast',  name: 'Arcane Blast', kind: 'attack',  type: 'magic',    power: 28, range: 2, cost: 1, element: 'light', desc: 'Pure magic damage' },
  bite:         { id: 'bite',         name: 'Savage Maul',  kind: 'attack',  type: 'physical', power: 18, range: 1, cost: 0, element: 'nature', basic: true, desc: 'Tear into the target with bared teeth (free)' },
  bash:         { id: 'bash',         name: 'Shield Bash',  kind: 'attack',  type: 'physical', power: 20, range: 1, cost: 1, element: 'earth', desc: 'Stuns target',    applyStatus: { id: 'stun', chance: 60, duration: 1 } },
  poisonSting:  { id: 'poisonSting',  name: 'Venom Lash',   kind: 'attack',  type: 'magic',    power: 12, range: 1, cost: 1, element: 'nature', desc: 'A venom-tipped strike — afflicts the target with Poison.',  applyStatus: { id: 'poison', chance: 100, duration: 3 } },
  smash:        { id: 'smash',        name: 'Smash',        kind: 'attack',  type: 'physical', power: 56, range: 1, cost: 2, element: 'earth', accuracy: 85, desc: 'Massive blow' },
  shadowBolt:   { id: 'shadowBolt',   name: 'Shadow Bolt',  kind: 'attack',  type: 'magic',    power: 32, range: 2, cost: 1, element: 'shadow', desc: 'Dark magic' },
  drainLife:    { id: 'drainLife',    name: 'Drain Life',   kind: 'attack',  type: 'magic',    power: 22, range: 1, cost: 1, element: 'shadow', desc: 'Heals attacker',  effect: 'drain' },
  cleave:       { id: 'cleave',       name: 'Cleave',       kind: 'attack',  type: 'physical', power: 26, range: 1, cost: 2, element: 'nature', desc: 'Hits adjacent units (friend + foe) for 75% damage', effect: 'aoe', aoeRadius: 1, splashDamagePct: 0.75 },
  // ===== Splash AOE attacks — hit every unit (friend + foe) within N tiles =====
  whirlwindSlash: {
    id: 'whirlwindSlash', name: 'Whirlwind Slash', kind: 'attack', type: 'physical',
    power: 22, range: 1, cost: 2, element: 'wind',
    aoeRadius: 1, splashDamagePct: 0.7,
    desc: 'Full spin — strike the target and every unit (friend or foe) in the 8 tiles around you (70% splash).',
  },
  frostNova: {
    id: 'frostNova', name: 'Frost Nova', kind: 'attack', type: 'magic',
    power: 18, range: 1, cost: 2, element: 'water',
    aoeRadius: 1, splashDamagePct: 0.8,
    applyStatus: { id: 'slow', chance: 80, duration: 2 },
    desc: 'Erupts in a frost ring — 80% splash to all adjacent units, 80% chance to Slow each.',
  },
  earthquake: {
    id: 'earthquake', name: 'Earthquake', kind: 'attack', type: 'physical',
    power: 16, range: 0, cost: 3, element: 'earth',
    aoeRadius: 2, splashDamagePct: 0.6,
    accuracy: 90,
    desc: 'Massive ground slam — every unit (friend + foe) within 2 tiles takes 60% damage.',
  },
  // ===== Lane attacks — sweep the COLUMN directly in front for N rows =====
  pierceLance: {
    id: 'pierceLance', name: 'Pierce Lance', kind: 'attack', type: 'physical',
    power: 24, range: 1, cost: 2, element: 'wind',
    laneDepth: 2, splashDamagePct: 0.85,
    desc: 'Drive the lance forward — hits the front 2 rows in the same column, friend or foe.',
  },
  frontalSweep: {
    id: 'frontalSweep', name: 'Frontal Sweep', kind: 'attack', type: 'physical',
    power: 22, range: 1, cost: 3, element: 'earth',
    laneDepth: 3, splashDamagePct: 0.7,
    desc: 'A sweeping advance — 3 rows of lane damage in front, hitting any unit (or hero) in the path.',
  },
  dragonsBreath: {
    id: 'dragonsBreath', name: "Dragon's Breath", kind: 'attack', type: 'magic',
    power: 26, range: 1, cost: 3, element: 'fire',
    laneDepth: 3, splashDamagePct: 0.75,
    applyStatus: { id: 'burn', chance: 50, duration: 2 },
    desc: 'Cone of dragonfire — burns 3 rows ahead, 50% Burn chance per victim.',
  },
  iceShard:     { id: 'iceShard',     name: 'Frost Splinter', kind: 'attack', type: 'magic',  power: 24, range: 2, cost: 1, element: 'water', desc: 'Hurls a sliver of ice — chills the target (Slow).',    applyStatus: { id: 'slow', chance: 80, duration: 2 } },

  // ===== Life-drain + lock-down (Leech Seed analog) =====
  // Siphon Grasp combines a HP-draining DoT (`siphoned` status) with a stun proc
  // on hit. Low base power so it's a control move, not a finisher.
  siphonGrasp: {
    id: 'siphonGrasp', name: 'Siphon Grasp', kind: 'attack', type: 'magic',
    power: 10, range: 2, cost: 2, element: 'nature',
    accuracy: 90,
    applyStatus:   { id: 'siphoned', chance: 100, duration: 4 },
    applyStatuses: [{ id: 'stun', chance: 50, duration: 1 }],
    desc: 'Parasitic tendrils sap 3-6 HP/turn for 4 turns; 50% chance to stun on contact.',
  },

  // ===== Freeze attacks =====
  // Blizzard: AOE magic. Modest base damage but high freeze proc — multiple
  // targets caught at once means the upside is locking down half the field.
  blizzard: {
    id: 'blizzard', name: 'Blizzard', kind: 'attack', type: 'magic',
    power: 22, range: 2, cost: 3, element: 'water',
    accuracy: 80,
    aoeRadius: 2, splashDamagePct: 0.7,
    applyStatus: { id: 'frozen', chance: 35, duration: 2 },
    desc: 'A howling icestorm — 22 dmg in a 2-tile ring (70% splash). 35% chance per victim to be Frozen (skips turn).',
  },
  // Ice Coffin: single-target lock-down. Pure status-focused (low power, very high freeze chance).
  iceCoffin: {
    id: 'iceCoffin', name: 'Ice Coffin', kind: 'attack', type: 'magic',
    power: 14, range: 1, cost: 2, element: 'water',
    accuracy: 90,
    applyStatus: { id: 'frozen', chance: 80, duration: 2 },
    desc: 'Encases the target in ice — 80% chance to Freeze for 2 turns.',
  },
  // Frost Nail: cheap freeze proc to pressure key targets without spending much energy.
  frostNail: {
    id: 'frostNail', name: 'Frost Nail', kind: 'attack', type: 'magic',
    power: 18, range: 2, cost: 1, element: 'water',
    accuracy: 85,
    applyStatus: { id: 'frozen', chance: 25, duration: 1 },
    applyStatuses: [{ id: 'slow', chance: 70, duration: 2 }],
    desc: 'A frigid bolt — 25% Freeze, 70% Slow. Cheap pressure tool.',
  },

  // ===== "Death" moves — hard-to-land one-hit-kills =====
  // Effect 'ohko' zeroes the target's HP when the attack lands. Low accuracy is
  // the balance lever. Hero KOs end the match instantly (handled by engine).
  deathStrike: {
    id: 'deathStrike', name: 'Death Strike', kind: 'attack', type: 'physical',
    power: 0, range: 1, cost: 4, element: 'shadow',
    accuracy: 30, effect: 'ohko', crit: 0,
    desc: '🪦 A killing blow — 30% accuracy, but if it lands, the target is instantly slain.',
  },
  graveSong: {
    id: 'graveSong', name: 'Grave Song', kind: 'attack', type: 'magic',
    power: 0, range: 3, cost: 4, element: 'shadow',
    accuracy: 25, effect: 'ohko', crit: 0,
    desc: '🪦 A ranged dirge that severs the soul — 25% accuracy, instant KO on hit.',
  },
  harvestSoul: {
    id: 'harvestSoul', name: 'Harvest Soul', kind: 'attack', type: 'magic',
    power: 0, range: 1, cost: 5, element: 'shadow',
    accuracy: 20, effect: 'ohko', crit: 0,
    // Note: effect: 'ohko' is the LANDING behavior. Drain healing relies on dmg > 0
    // which won't fire on a 0-power OHKO — so we add a passive-style heal handled
    // by the engine: when the OHKO lands and the move has gainEnergy, the attacker
    // also restores 50% of THEIR max HP (themed as soul harvest). Implemented as a
    // simple gainEnergy + healAmount pair — see drain/heal blocks in executeMove.
    gainEnergy: 1,
    desc: '🪦 Rip the soul straight out — 20% accuracy, instant KO + you regain 1 energy. The rarest finisher.',
  },
  voidPiercer: {
    id: 'voidPiercer', name: 'Void Piercer', kind: 'attack', type: 'magic',
    power: 0, range: 4, cost: 4, element: 'void',
    accuracy: 35, effect: 'ohko', crit: 0,
    desc: '🪦 A void-lance from across the field — 35% accuracy, instant KO. Cannot crit (already lethal).',
  },
  crippleStrike:{ id: 'crippleStrike',name: 'Cripple',      kind: 'attack',  type: 'physical', power: 18, range: 1, cost: 1, element: 'shadow', desc: 'Weakens target',  applyStatus: { id: 'weak', chance: 100, duration: 2 } },
  bleedSlash:   { id: 'bleedSlash',   name: 'Rending Slash',kind: 'attack',  type: 'physical', power: 20, range: 1, cost: 1, element: 'nature', desc: 'Causes bleeding', applyStatus: { id: 'bleed', chance: 100, duration: 2 } },
  meditate:     { id: 'meditate',     name: 'Inner Reverie',kind: 'ability', range: 0, cost: 1, element: 'light',  target: 'self',     healAmount: 12, desc: 'A moment of stillness — restore 12 HP.' },
  heal:         { id: 'heal',         name: 'Heal',         kind: 'ability', range: 1, cost: 2, element: 'light',  target: 'ally',     healAmount: 18, desc: 'Heal ally 18 HP' },
  rallyingCry:  { id: 'rallyingCry',  name: 'Rallying Cry', kind: 'ability', range: 0, cost: 2, element: 'light',  target: 'allAllies', applyStatus: { id: 'strong',   chance: 100, duration: 2 }, desc: 'Allies +4 ATK 2t' },
  gustingWinds: { id: 'gustingWinds', name: 'Gusting Winds',kind: 'ability', range: 0, cost: 2, element: 'wind',   target: 'allAllies', applyStatus: { id: 'haste',    chance: 100, duration: 2 }, desc: 'Allies +1 move 2t' },
  divineShield: { id: 'divineShield', name: 'Divine Shield',kind: 'ability', range: 1, cost: 2, element: 'light',  target: 'ally',      applyStatus: { id: 'shielded', chance: 100, duration: 2 }, desc: 'Shield ally' },
  focus:        { id: 'focus',        name: 'Focus',        kind: 'ability', range: 0, cost: 1, element: 'light',  target: 'self',      applyStatus: { id: 'focused',  chance: 100, duration: 2 }, desc: '+4 Magic 2t' },
  cleanse:      { id: 'cleanse',      name: 'Cleanse',      kind: 'ability', range: 1, cost: 1, element: 'light',  target: 'ally',      cleanse: true, desc: 'Remove status' },
  intimidate:   { id: 'intimidate',   name: 'Intimidate',   kind: 'ability', range: 1, cost: 1, element: 'shadow', target: 'enemy',     applyStatus: { id: 'weak',     chance: 100, duration: 2 }, desc: 'Weaken enemy' },
  battlePrep:   { id: 'battlePrep',   name: 'Battle Prep',  kind: 'ability', range: 0, cost: 1, element: 'earth',  target: 'self',      applyStatus: { id: 'strong',   chance: 100, duration: 2 }, desc: '+4 ATK 2t' },

  // ===== Movement: Teleport =====
  // Lets the user warp to ANY empty, unblocked tile on the board (skipping
  // pathing, range, and "Follow My Lead" constraints). Costs 2 energy and
  // counts as the unit's movement for the turn. Cannot land on a tile with
  // a wall, another unit, OR a glowing tombstone.
  teleport: {
    id: 'teleport', name: 'Teleport', kind: 'movement', range: 99, cost: 2, element: 'arcane',
    target: 'tile', accuracy: 100,
    teleport: true,
    desc: 'Vanish in a flash of arcane light and reappear on any empty tile on the battlefield.',
  },

  // ===== Kamikaze =====
  selfDetonate: {
    id: 'selfDetonate', name: 'Self Detonate', kind: 'attack', type: 'magic',
    power: 0, range: 1, cost: 2, element: 'fire',
    selfDetonate: true, accuracy: 100,
    desc: 'Detonate yourself — 99% max HP damage (100% if hurt). User is KO\'d.',
  },

  // ===== Slowing attacks — chip damage that cripples speed (less movement, shorter
  //       attack range, lower accuracy on the target for the duration of Slow) =====
  hamstring: {
    id: 'hamstring', name: 'Hamstring', kind: 'attack', type: 'physical',
    power: 14, range: 1, cost: 1, element: 'shadow',
    applyStatus: { id: 'slow', chance: 100, duration: 2 },
    desc: 'A crippling strike — guaranteed Slow (2t).',
  },
  webShot: {
    id: 'webShot', name: 'Web Shot', kind: 'attack', type: 'physical',
    power: 8, range: 2, cost: 1, element: 'nature',
    applyStatus: { id: 'slow', chance: 100, duration: 3 },
    desc: 'Sticky ranged web — locks the target down with Slow (3t).',
  },
  miredCurse: {
    id: 'miredCurse', name: 'Mired Curse', kind: 'ability',
    range: 2, cost: 1, element: 'shadow', target: 'enemy',
    applyStatus: { id: 'slow', chance: 100, duration: 3 },
    stageMods: [{ stat: 'spd', delta: -1 }],
    desc: 'Curse drags the target down — Slow (3t) AND SPD -1 stage.',
  },

  // ===== Assist (Pokemon Helping Hand style) =====
  helpingHand: {
    id: 'helpingHand', name: 'Lend Aid', kind: 'ability',
    range: 1, cost: 0, element: 'nature', target: 'ally',
    applyStatus: { id: 'assisted', chance: 100, duration: 2 },
    desc: 'Brace an ally — their next strike is +6 ATK / +6 MAG.',
  },
  rallyingCheer: {
    id: 'rallyingCheer', name: 'Rallying Cheer', kind: 'ability',
    range: 0, cost: 1, element: 'light', target: 'allAllies',
    applyStatus: { id: 'assisted', chance: 100, duration: 1 },
    desc: 'All allies +6 ATK / +6 MAG next strike.',
  },
  sharpen: {
    id: 'sharpen', name: 'Hone Edge', kind: 'ability',
    range: 1, cost: 1, element: 'wind', target: 'ally',
    applyStatus: { id: 'assisted', chance: 100, duration: 2 },
    desc: 'Sharpen an ally\'s blade — +6 ATK / +6 MAG for next strike.',
  },

  // ===== Stumble (flinch) =====
  tripStrike: {
    id: 'tripStrike', name: 'Trip Strike', kind: 'attack', type: 'physical',
    power: 14, range: 1, cost: 1, element: 'earth',
    applyStatus: { id: 'stumble', chance: 50, duration: 1 },
    desc: 'Sweep their legs — 50% chance to stumble (skip their next turn).',
  },
  thunderclap: {
    id: 'thunderclap', name: 'Thunderclap', kind: 'attack', type: 'magic',
    power: 12, range: 2, cost: 1, element: 'storm', accuracy: 100,
    applyStatus: { id: 'stumble', chance: 40, duration: 1 },
    desc: 'A deafening crack — 40% chance to stumble.',
  },
  shoulderCharge: {
    id: 'shoulderCharge', name: 'Shoulder Charge', kind: 'attack', type: 'physical',
    power: 20, range: 1, cost: 1, element: 'earth',
    applyStatus: { id: 'stumble', chance: 30, duration: 1 },
    desc: 'Plow forward — 30% chance to stumble the target.',
  },

  // ===== Charge-up moves =====
  solarBeam: {
    id: 'solarBeam', name: 'Sunfire Lance', kind: 'attack', type: 'magic',
    power: 90, range: 3, cost: 2, element: 'light',
    chargeTurns: 1, sunCharge: true,
    desc: 'Gather solar fire for a turn, then unleash a lancing pillar of flame. Fires instantly under ☀️ Sun.',
  },
  meteorCharge: {
    id: 'meteorCharge', name: 'Meteor Charge', kind: 'attack', type: 'magic',
    power: 80, range: 2, cost: 2, element: 'fire',
    chargeTurns: 1,
    desc: 'Gather cosmic fire — releases next turn for huge damage.',
  },
  shadowPulse: {
    id: 'shadowPulse', name: 'Umbral Lance', kind: 'attack', type: 'magic',
    power: 75, range: 3, cost: 2, element: 'shadow',
    chargeTurns: 1,
    desc: 'Tether a strand of darkness, then loose it at range.',
  },
  // ===== 🪶 FLY / ⛏️ DIG / 🌌 REALM — vanish-and-return strikes =====
  // Two-turn moves: the user vanishes off the board for a turn (untargetable,
  // but its tile stays blocked — nothing can move through where it was), then
  // returns and strikes. Built on the charge-move engine; `vanish:true` adds
  // the semi-invulnerable / hidden behavior. Physical + magic of each.
  flyStrike:   { id: 'flyStrike',   name: 'Sky Dive',     kind: 'attack', type: 'physical', power: 78, range: 3, cost: 2, element: 'wind',  air: true, chargeTurns: 1, vanish: true, vanishKind: 'fly',   icon: '🪶', desc: 'Soar out of reach for a turn — untargetable while aloft — then dive-bomb the target.' },
  flyStorm:    { id: 'flyStorm',    name: 'Storm Wing',   kind: 'attack', type: 'magic',    power: 80, range: 3, cost: 2, element: 'storm', air: true, chargeTurns: 1, vanish: true, vanishKind: 'fly',   icon: '🌪️', desc: 'Ride the gale skyward (untargetable), then call down a thunderous dive.' },
  digStrike:   { id: 'digStrike',   name: 'Burrow Fang',  kind: 'attack', type: 'physical', power: 80, range: 2, cost: 2, element: 'earth', chargeTurns: 1, vanish: true, vanishKind: 'dig',   icon: '⛏️', desc: 'Burrow underground for a turn — untargetable — then erupt beneath the target.' },
  digQuake:    { id: 'digQuake',    name: 'Geomancy',     kind: 'attack', type: 'magic',    power: 82, range: 2, cost: 2, element: 'earth', chargeTurns: 1, vanish: true, vanishKind: 'dig',   icon: '🌋', desc: 'Sink into the stone (untargetable), then rupture the earth under the target.' },
  realmStrike: { id: 'realmStrike', name: 'Rift Step',    kind: 'attack', type: 'physical', power: 84, range: 3, cost: 3, element: 'void',  air: true, chargeTurns: 1, vanish: true, vanishKind: 'realm', icon: '🌌', desc: 'Phase into the rift between realms (untargetable), then tear back into reality on the target.' },
  realmWarp:   { id: 'realmWarp',   name: 'Void Lance',   kind: 'attack', type: 'magic',    power: 86, range: 3, cost: 3, element: 'arcane', air: true, chargeTurns: 1, vanish: true, vanishKind: 'realm', icon: '🔮', desc: 'Slip into the void (untargetable), then lance back through with arcane force.' },

  // ===== Recovery moves =====
  recover: {
    id: 'recover', name: 'Recover', kind: 'ability',
    range: 0, cost: 2, element: 'light', target: 'self',
    healPercent: 0.5,
    desc: 'Restore 50% of max HP.',
  },
  softBoil: {
    id: 'softBoil', name: 'Soft-Boil', kind: 'ability',
    range: 1, cost: 2, element: 'water', target: 'ally',
    healPercent: 0.5,
    desc: 'Heal an ally for 50% of their max HP.',
  },
  synthesis: {
    id: 'synthesis', name: 'Synthesis', kind: 'ability',
    range: 0, cost: 1, element: 'nature', target: 'self',
    healPercent: 0.25, sunBoost: true,
    desc: 'Heal 25% max HP. Doubled under ☀️ Sun.',
  },
  roost: {
    id: 'roost', name: 'Roost', kind: 'ability',
    range: 0, cost: 1, element: 'wind', target: 'self',
    healPercent: 0.4,
    desc: 'Land and recover — heal 40% max HP.',
  },

  // ===== Trap-setting moves =====
  setSnare: {
    id: 'setSnare', name: 'Set Snare', kind: 'ability',
    range: 0, cost: 1, element: 'nature', target: 'self',
    setsTrap: { cardId: 'snare', placement: 'self' },
    desc: 'Lay a Snare trap on your tile.',
  },
  laySpikes: {
    id: 'laySpikes', name: 'Lay Spikes', kind: 'ability',
    range: 0, cost: 1, element: 'earth', target: 'self',
    setsTrap: { cardId: 'spikes', placement: 'self' },
    desc: 'Plant a Spike Trap (15 dmg) on your tile.',
  },
  layInferno: {
    id: 'layInferno', name: 'Inferno Mine', kind: 'ability',
    range: 0, cost: 2, element: 'fire', target: 'self',
    setsTrap: { cardId: 'flameBurst', placement: 'self' },
    desc: 'Plant a Flame Burst trap (25 dmg + burn) on your tile.',
  },

  // ===== Bulwark Stance =====
  protect: {
    id: 'protect', name: 'Bulwark Stance', kind: 'ability',
    range: 0, cost: 2, element: 'light', target: 'self',
    applyStatus: { id: 'protected', chance: 100, duration: 1 },
    desc: 'Brace behind an unbreakable guard — immune to all damage and effects until your next turn.',
  },

  // ===== Stat-stage tricks (sweeping lash / whirlwind drill family) =====
  tailWhip: {
    id: 'tailWhip', name: 'Sweeping Lash', kind: 'ability',
    range: 1, cost: 0, element: 'neutral', target: 'enemy',
    stageMods: [{ stat: 'def', delta: -1 }],
    desc: 'A low sweeping strike rattles the target\'s guard — DEF -1 stage.',
  },
  leer: {
    id: 'leer', name: 'Withering Gaze', kind: 'ability',
    range: 2, cost: 0, element: 'shadow', target: 'enemy',
    stageMods: [{ stat: 'def', delta: -1 }],
    desc: 'A cold stare cracks their resolve — DEF -1 stage from range.',
  },
  growl: {
    id: 'growl', name: "Wolf's Snarl", kind: 'ability',
    range: 1, cost: 0, element: 'nature', target: 'enemy',
    stageMods: [{ stat: 'atk', delta: -1 }],
    desc: 'A primal snarl shakes the target\'s nerve — ATK -1 stage.',
  },
  scaryFace: {
    id: 'scaryFace', name: 'Dread Visage', kind: 'ability',
    range: 1, cost: 1, element: 'shadow', target: 'enemy',
    stageMods: [{ stat: 'spd', delta: -1 }],
    applyStatus: { id: 'slow', chance: 60, duration: 2 },
    desc: 'Terror unmasked — SPD -1 stage and 60% chance to Slow.',
  },
  swordDance: {
    id: 'swordDance', name: 'Whirlwind Drill', kind: 'ability',
    range: 0, cost: 2, element: 'wind', target: 'self',
    stageMods: [{ stat: 'atk', delta: 2 }],
    desc: 'A practiced blade routine builds momentum — ATK +2 stages.',
  },
  ironDefense: {
    id: 'ironDefense', name: 'Iron Vow', kind: 'ability',
    range: 0, cost: 1, element: 'metal', target: 'self',
    stageMods: [{ stat: 'def', delta: 2 }],
    desc: 'Steel the body with an unbreakable oath — DEF +2 stages.',
  },
  calmMind: {
    id: 'calmMind', name: 'Inner Sanctum', kind: 'ability',
    range: 0, cost: 1, element: 'psychic', target: 'self',
    stageMods: [{ stat: 'mag', delta: 1 }, { stat: 'res', delta: 1 }],
    desc: 'Retreat into the mind\'s sanctum — MAG and RES +1 stage each.',
  },
  agility: {
    id: 'agility', name: 'Quicken Step', kind: 'ability',
    range: 0, cost: 1, element: 'wind', target: 'self',
    stageMods: [{ stat: 'spd', delta: 1 }],
    applyStatus: { id: 'haste', chance: 100, duration: 2 },
    desc: 'Sharpen your footwork — SPD +1 stage and grants Haste.',
  },

  // ===== Knockback / Pushback =====
  gust: {
    id: 'gust', name: 'Cyclone Push', kind: 'attack', type: 'magic',
    power: 18, range: 2, cost: 1, element: 'wind',
    knockback: 2,
    desc: 'A spiraling column of wind — 18 dmg and hurls the target 2 tiles back.',
  },
  airSlash: {
    id: 'airSlash', name: 'Razor Wind', kind: 'attack', type: 'physical',
    power: 24, range: 2, cost: 1, element: 'wind',
    knockback: 1,
    applyStatus: { id: 'stumble', chance: 25, duration: 1 },
    desc: 'A scything blade of compressed air — 24 dmg, knocks 1 back, 25% Stumble.',
  },
  shockwave: {
    id: 'shockwave', name: 'Quake Stomp', kind: 'attack', type: 'physical',
    power: 22, range: 1, cost: 1, element: 'earth',
    knockback: 2,
    desc: 'Slam the earth — 22 dmg and the shockwave throws the target 2 tiles back.',
  },
  hydroJet: {
    id: 'hydroJet', name: 'Tidal Spear', kind: 'attack', type: 'magic',
    power: 26, range: 3, cost: 2, element: 'water',
    knockback: 1,
    desc: 'A lance of pressurized water — 26 dmg, drives 1 tile back.',
  },

  // ===== 🪝 Pull / Grappling Hook moves — yank the target TOWARD the attacker.
  // Mirror of the knockback moves above; use `pull` (tiles) instead of
  // `knockback`. Great for dragging ranged foes into melee range.
  harpoonYank: {
    id: 'harpoonYank', name: 'Harpoon Yank', kind: 'attack', type: 'physical',
    power: 22, range: 3, cost: 1, element: 'metal',
    pull: 2,
    desc: 'Fire a barbed harpoon — 22 dmg and reels the target 2 tiles toward you.',
  },
  gravityWell: {
    id: 'gravityWell', name: 'Gravity Well', kind: 'attack', type: 'magic',
    power: 15, range: 3, cost: 2, element: 'void',
    pull: 3, applyStatus: { id: 'slow', chance: 60, duration: 2 },
    desc: 'Collapse space around the foe — 15 dmg, drags them 3 tiles closer, 60% Slow.',
  },
  vineSnare: {
    id: 'vineSnare', name: 'Vine Snare', kind: 'attack', type: 'physical',
    power: 16, range: 2, cost: 1, element: 'nature',
    pull: 1, applyStatus: { id: 'stumble', chance: 50, duration: 1 },
    desc: 'Lash out with a creeping vine — 16 dmg, yanks the target 1 tile in, 50% Stumble.',
  },

  // ===== 🌋 Surface-painting moves — lay battlefield hazards. Pair an Oil
  // Slick with a fire move to set off a chain blaze; Tide Pool + a storm
  // move electrifies the whole puddle.
  oilSlick: {
    id: 'oilSlick', name: 'Oil Slick', kind: 'attack', type: 'physical',
    power: 8, range: 3, cost: 1, element: 'metal',
    paintSurface: { type: 'oil', radius: 1, turns: 6 },
    desc: 'Hurl a burst flask — 8 dmg and coats a 3×3 area in flammable Oil (Slows units; ignites under fire).',
  },
  emberToss: {
    id: 'emberToss', name: 'Ember Toss', kind: 'attack', type: 'magic',
    power: 16, range: 3, cost: 1, element: 'fire',
    paintSurface: { type: 'fire', radius: 0, turns: 4 },
    desc: 'Lob a burning coal — 16 dmg and leaves Fire on the tile. Ignites any Oil it lands on.',
  },
  tidePool: {
    id: 'tidePool', name: 'Tide Pool', kind: 'attack', type: 'magic',
    power: 12, range: 3, cost: 1, element: 'water',
    paintSurface: { type: 'water', radius: 1, turns: 6 },
    desc: 'Splash a 3×3 area with conductive Water — 12 dmg. A storm attack electrifies the whole pool.',
  },

  // ===== Sleep / Mental =====
  hypnosis: {
    id: 'hypnosis', name: 'Dreamspell', kind: 'ability',
    range: 2, cost: 2, element: 'psychic', target: 'enemy',
    applyStatus: { id: 'sleep', chance: 70, duration: 3 },
    accuracy: 70,
    desc: 'Weave a sleeping enchantment — 70% chance to plunge the target into slumber for 3 turns.',
  },
  lullaby: {
    id: 'lullaby', name: "Dirge of Slumber", kind: 'ability',
    range: 2, cost: 2, element: 'sound', target: 'allEnemies',
    applyStatus: { id: 'sleep', chance: 40, duration: 2 },
    desc: 'A haunting melody — 40% chance to lull every enemy in range into sleep.',
  },
  confuseRay: {
    id: 'confuseRay', name: 'Mind Splinter', kind: 'ability',
    range: 2, cost: 1, element: 'shadow', target: 'enemy',
    applyStatus: { id: 'confusion', chance: 100, duration: 3 },
    desc: 'Drive a shard of madness into their thoughts — Confuses the target.',
  },

  // ===== Counter Stance =====
  counterStance: {
    id: 'counterStance', name: 'Parry Guard', kind: 'ability',
    range: 0, cost: 1, element: 'neutral', target: 'self',
    applyStatus: { id: 'countering', chance: 100, duration: 1 },
    desc: 'Settle into a parry stance — blocks the next enemy attack and ripostes for 80% of your offense.',
  },
  riposte: {
    id: 'riposte', name: 'Iron Riposte', kind: 'ability',
    range: 0, cost: 2, element: 'metal', target: 'self',
    applyStatus: { id: 'countering', chance: 100, duration: 2 },
    stageMods: [{ stat: 'def', delta: 1 }],
    desc: 'A disciplined defensive stance — counter for 2 turns and DEF +1 stage.',
  },

  // ===== 🎯 Ambush Guard (Overwatch-style watch stance) =====
  // Self-buff: enter a watch. The FIRST enemy that moves within the watch
  // radius during the enemy turn takes a free reaction strike (once per enemy
  // turn; the stance is then consumed — re-cast it next turn). Short = 1 tile,
  // Long = 3 tiles. Duration is large; it never decays on its own (handled in
  // the turn-start tick) and is removed the moment it fires.
  ambushGuardShort: {
    id: 'ambushGuardShort', name: 'Ambush Guard I', kind: 'ability',
    range: 0, cost: 1, element: 'neutral', target: 'self',
    applyStatus: { id: 'ambushGuard1', chance: 100, duration: 99 },
    desc: '🎯 Ready a close watch — the first enemy to move ADJACENT (1 tile) on the enemy turn eats a free reaction strike. Once per enemy turn; re-cast after it fires.',
  },
  ambushGuardLong: {
    id: 'ambushGuardLong', name: 'Ambush Guard III', kind: 'ability',
    range: 0, cost: 2, element: 'neutral', target: 'self',
    applyStatus: { id: 'ambushGuard3', chance: 100, duration: 99 },
    desc: '🎯 Ready a long watch — the first enemy to move within 3 tiles on the enemy turn eats a free reaction strike. Once per enemy turn; re-cast after it fires.',
  },
  // 🪝 Grappling Hook — teleport-to-tile movement move. Up to 4 tiles
  // (Chebyshev). Free action: does NOT consume the unit's move. Tile
  // must be empty. Range 4 means the action panel routes it through
  // the standard teleport target-picker.
  grapplingHook: {
    id: 'grapplingHook', name: 'Grappling Hook', kind: 'movement',
    range: 4, cost: 1, element: 'neutral', target: 'tile',
    teleport: true, freeAction: true,
    desc: '🪝 Teleport up to 4 tiles to an empty space. Free action — does not consume your move. Pairs with high ground.',
  },

  // ===== Weather-summoning moves =====
  rainDance: {
    id: 'rainDance', name: "Stormcaller's Chant", kind: 'ability',
    range: 0, cost: 2, element: 'water', target: 'self',
    setsWeather: { weatherType: 'rain', duration: 4, name: 'Rainstorm' },
    desc: 'Sing the clouds down — a 🌧 Rainstorm rolls in for 4 turns. Water +50%, Fire -50%.',
  },
  sunnyDay: {
    id: 'sunnyDay', name: 'Solar Hymn', kind: 'ability',
    range: 0, cost: 2, element: 'fire', target: 'self',
    setsWeather: { weatherType: 'sun', duration: 4, name: 'Sunny Day' },
    desc: 'Lift a hymn to the sun — the sky clears for 4 turns. Fire +50%, Water -50%.',
  },
  sandstormCall: {
    id: 'sandstormCall', name: 'Dust Tempest', kind: 'ability',
    range: 0, cost: 3, element: 'earth', target: 'self',
    setsWeather: { weatherType: 'sand', duration: 4, name: 'Sandstorm' },
    desc: 'Stir the desert into fury — a 🏜 Dust Tempest scours all but Earth/Storm for 3 dmg/turn.',
  },
  mistmaker: {
    id: 'mistmaker', name: 'Veil of Fog', kind: 'ability',
    range: 0, cost: 2, element: 'water', target: 'self',
    setsWeather: { weatherType: 'mist', duration: 4, name: 'Mistveil' },
    desc: 'Draw a thick 🌫 fog across the field for 4 turns. All attacks +25% miss.',
  },
  eclipseRite: {
    id: 'eclipseRite', name: 'Eclipse Rite', kind: 'ability',
    range: 0, cost: 3, element: 'shadow', target: 'self',
    setsWeather: { weatherType: 'eclipse', duration: 4, name: 'Eclipse' },
    desc: 'Call a 🌑 Eclipse — Shadow +50%, Light -50% for 4 turns.',
  },
  bloodmoonRite: {
    id: 'bloodmoonRite', name: 'Bloodmoon Rite', kind: 'ability',
    range: 0, cost: 3, element: 'blood', target: 'self',
    setsWeather: { weatherType: 'bloodmoon', duration: 4, name: 'Bloodmoon' },
    desc: 'Summon the 🌕 Bloodmoon — attackers heal 20% of damage dealt for 4 turns.',
  },
  mindWarp: {
    id: 'mindWarp', name: 'Mind Warp', kind: 'ability',
    range: 0, cost: 3, element: 'psychic', target: 'self',
    setsWeather: { weatherType: 'mindRealm', duration: 4, name: 'Mind Realm' },
    desc: 'Bend reality into the 🧠 Mind Realm — Magic +30%, status effects fail.',
  },

  // ===== Rage =====
  enrage: {
    id: 'enrage', name: 'Enrage', kind: 'ability',
    range: 2, cost: 1, element: 'shadow', target: 'enemy',
    applyStatus: { id: 'rage', chance: 100, duration: 3 },
    desc: 'Provoke the target — they must attack the nearest enemy and can only use attack moves (+3 ATK / -2 DEF, 3 turns).',
  },
  taunt: {
    id: 'taunt', name: 'Goading Slight', kind: 'ability',
    range: 2, cost: 1, element: 'nature', target: 'enemy',
    applyStatus: { id: 'rage', chance: 100, duration: 2 },
    desc: 'A cutting insult — the target locks into Rage (must attack the nearest enemy) for 2 turns.',
  },
  outrage: {
    id: 'outrage', name: "Berserker's Frenzy", kind: 'attack', type: 'physical',
    power: 38, range: 1, cost: 2, element: 'fire',
    applyStatus: { id: 'rage', chance: 100, duration: 2 },
    desc: 'A frenzied strike — 38 dmg. Locks YOU into Rage for 2 turns (can only attack closest enemy).',
  },
  berserkerRoar: {
    id: 'berserkerRoar', name: 'Berserker Roar', kind: 'ability',
    range: 0, cost: 2, element: 'blood', target: 'self',
    applyStatus: { id: 'rage', chance: 100, duration: 3 },
    stageMods: [{ stat: 'atk', delta: 1 }],
    desc: 'Embrace the frenzy — +1 ATK stage and 3 turns of Rage (must attack the nearest enemy).',
  },

  // ============ LOCATION REMOVAL ============
  // Destroys the active field spell. Useful against an opponent's Power Altar,
  // Sky Citadel, etc. Has no effect if no location is active.
  erosion: {
    id: 'erosion', name: 'Erosion', kind: 'ability',
    range: 0, cost: 2, element: 'earth', target: 'self',
    destroysLocation: true,
    desc: 'Shatters the active field — destroys whichever Location is on the board.',
  },
  dispelField: {
    id: 'dispelField', name: 'Dispel Field', kind: 'ability',
    range: 0, cost: 1, element: 'wind', target: 'self',
    destroysLocation: true,
    desc: 'Cheaper field-spell removal — costs 1⚡ but provides no other benefit.',
  },

  // ============ ⛔ KALON COUNTERS ============
  // Sever Awakening — single-target anti-Kalon move. Only works on units or
  // heroes with Kalon mode (has kalonForm, or already transformed via
  // kalonUsed). Two modes:
  //   • Target is already transformed → revert to base form, seal them so
  //     they can never re-awaken (kalonSealed flag).
  //   • Target hasn't transformed yet → seal them permanently — they can
  //     never trigger Kalon for the rest of the match.
  // Range 2 so it can reach enemy front-line bruisers. Cost 3 since it's a
  // hard-counter to one of the game's biggest swing mechanics.
  severAwakening: {
    id: 'severAwakening', name: 'Sever Awakening', kind: 'ability',
    range: 2, cost: 3, element: 'light', target: 'enemy',
    revertKalon: true,
    desc: 'If target has Kalon Mode: revert their transformation (if active) and seal them — they can never awaken again this match. Only works on Kalon-capable units / heroes.',
  },

  // ============ 🎭 CHARM / PACIFY MOVES ============
  // Source-tracked statuses. Happy = target can't attack the user. Follow My
  // Lead = target can only move toward the user and can't attack anyone at all.
  // Both rely on the engine's source-tracking system in applyStatusEffect().
  happyDance: {
    id: 'happyDance', name: 'Happy Dance', kind: 'ability',
    range: 2, cost: 1, element: 'light', target: 'enemy',
    applyStatus: { id: 'happy', chance: 100, duration: 3 },
    desc: 'Target becomes Happy — cannot attack you for 3 turns (still attacks other allies normally).',
  },
  cheerfulCharm: {
    id: 'cheerfulCharm', name: 'Cheerful Charm', kind: 'ability',
    range: 1, cost: 2, element: 'light', target: 'enemy',
    applyStatus: { id: 'happy', chance: 100, duration: 4 },
    desc: 'Single-target Happy for 4 turns — longer melee version.',
  },
  followMyLead: {
    id: 'followMyLead', name: 'Follow My Lead', kind: 'ability',
    range: 2, cost: 2, element: 'wind', target: 'enemy',
    applyStatus: { id: 'followLead', chance: 100, duration: 2 },
    desc: 'Target can only move TOWARD you and cannot attack anyone for 2 turns.',
  },
  pacifyingHymn: {
    id: 'pacifyingHymn', name: 'Pacifying Hymn', kind: 'ability',
    range: 1, cost: 3, element: 'light', target: 'enemy',
    applyStatus: { id: 'followLead', chance: 100, duration: 3 },
    desc: 'Stronger Follow My Lead — locks the target onto you for 3 turns.',
  },

  // ============ ALIEN / INFECTION MOVES ============
  // Status: 'infected' halves all stats for the duration. These are the four
  // primary delivery routes — a melee infect, a ranged spray, a heavy magic
  // burst, and a pure status-only spore that pairs with damage-focused moves.
  xenobite: {
    id: 'xenobite', name: 'Xenobite', kind: 'attack', type: 'physical',
    power: 26, range: 1, cost: 1, element: 'shadow',
    applyStatus: { id: 'infected', chance: 70, duration: 3 },
    desc: 'A parasitic bite — 70% chance to Infect for 3 turns.',
  },
  acidSpray: {
    id: 'acidSpray', name: 'Acid Spray', kind: 'attack', type: 'magic',
    power: 22, range: 2, cost: 1, element: 'nature',
    applyStatus:   { id: 'infected', chance: 50, duration: 2 },
    applyStatuses: [{ id: 'bleed', chance: 40, duration: 2 }],
    desc: 'Caustic xeno-fluid — 50% Infect, 40% Bleed.',
  },
  hivecall: {
    id: 'hivecall', name: 'Hive Call', kind: 'attack', type: 'magic',
    power: 34, range: 3, cost: 2, element: 'shadow',
    applyStatus: { id: 'infected', chance: 60, duration: 3 },
    desc: 'A psychic shriek — 34 dmg + 60% Infect (3t).',
  },
  sporeCloud: {
    id: 'sporeCloud', name: 'Spore Cloud', kind: 'ability',
    range: 1, cost: 2, element: 'nature', target: 'enemy',
    applyStatus: { id: 'infected', chance: 100, duration: 4 },
    desc: 'A guaranteed 4-turn Infection — no damage, but halves their stats hard.',
  },

  // ============================================================================
  // ✨ COMPETITIVE TOOLKIT — buff / debuff / heal / control / finisher
  // ----------------------------------------------------------------------------
  // Thirteen new moves curated to expand archetypes without overlapping
  // existing tools. See PASSIVES / STATUS_EFFECTS additions earlier for the
  // matching engine hooks (escalating DoT, countdown KO, on-KO revive, etc.).
  // ============================================================================

  // 🙏 SANCTIFY — broad-stat team buff. Compares well vs `rallyingCry`
  // (just +4 ATK) and `gustingWinds` (+1 SPD): sanctify gives +3 across the
  // four core combat stats, but for only 2 turns.
  bless: {
    id: 'bless', name: 'Sanctify', kind: 'ability',
    range: 0, cost: 2, element: 'light', target: 'allAllies',
    applyStatus: { id: 'blessed', chance: 100, duration: 2 },
    desc: 'Pour divine favor on every ally — +3 ATK / MAG / DEF / RES for 2 turns.',
  },
  // 💀 HEX OF WITHERING — broad-stat enemy debuff. Mirror of Sanctify.
  bane: {
    id: 'bane', name: 'Hex of Withering', kind: 'ability',
    range: 0, cost: 2, element: 'shadow', target: 'allEnemies',
    applyStatus: { id: 'cursed', chance: 100, duration: 2 },
    desc: 'Curse every enemy on the field — -3 ATK / MAG / DEF / RES for 2 turns.',
  },
  // ✨ RESTORATION — large single-target heal, but expensive.
  wish: {
    id: 'wish', name: 'Restoration', kind: 'ability',
    range: 1, cost: 3, element: 'light', target: 'ally', healAmount: 35,
    desc: 'Channel a tide of pure life — restore 35 HP to one ally.',
  },
  // 💚 MENDING WHISPER — free ranged trickle heal.
  healingWord: {
    id: 'healingWord', name: 'Mending Whisper', kind: 'ability',
    range: 3, cost: 0, element: 'light', target: 'ally', healAmount: 10,
    desc: 'A whispered prayer — free 10 HP heal at long range.',
  },
  // 🥁 BLOODFURY PACT — pay 50% of CURRENT HP to gain a massive four-turn
  // STRONG status (+4 ATK). Distinct from `battlePrep` which is the cheap
  // baseline. Engine reads `selfDamagePct`.
  bellyDrum: {
    id: 'bellyDrum', name: 'Bloodfury Pact', kind: 'ability',
    range: 0, cost: 0, element: 'fire', target: 'self', selfDamagePct: 0.5,
    applyStatus: { id: 'strong', chance: 100, duration: 4 },
    desc: 'Pay 50% of your current HP to enter a battle frenzy — +4 ATK for 4 turns.',
  },
  // 🛡️ MIRAGE DECOY — 25% HP cost for one turn of Protected (existing
  // status — blocks all incoming damage / status for one cycle).
  substitute: {
    id: 'substitute', name: 'Mirage Decoy', kind: 'ability',
    range: 0, cost: 1, element: 'nature', target: 'self', selfDamagePct: 0.25,
    applyStatus: { id: 'protected', chance: 100, duration: 1 },
    desc: 'Trade 25% HP for a shimmering decoy — fully immune to damage and status next turn cycle.',
  },
  // 🗡️ FLANKING STRIKE — physical attack with a damage bonus when a
  // friendly unit is adjacent to the target. Engine reads
  // `bonusIfAllyAdjacent` in calculateDamage.
  sneakAttack: {
    id: 'sneakAttack', name: 'Flanking Strike', kind: 'attack', type: 'physical',
    power: 26, range: 1, cost: 1, element: 'shadow', crit: 12,
    bonusIfAllyAdjacent: 0.5,
    desc: 'A precise stab from the side — +50% damage when a friendly unit is adjacent to the target.',
  },
  // 🪦 MORTAL SENTENCE — countdown to KO. Engine: status with `koOnExpire`
  // triggers death when its turn timer hits zero. Cleansable.
  doomMove: {
    id: 'doomMove', name: 'Mortal Sentence', kind: 'ability',
    range: 2, cost: 4, element: 'shadow', target: 'enemy', accuracy: 90,
    applyStatus: { id: 'doom', chance: 100, duration: 3 },
    desc: '⌛ Mark a target for death — they die when the 3-turn timer expires unless cleansed.',
  },
  // ☢️ NECROTIC BLOOM — ramping DoT. The status escalates damage by
  // tickCount × dmgMin (3, 6, 9, 12 HP over four turns).
  toxicMove: {
    id: 'toxicMove', name: 'Necrotic Bloom', kind: 'ability',
    range: 2, cost: 2, element: 'poison', target: 'enemy', accuracy: 90,
    applyStatus: { id: 'toxic', chance: 100, duration: 4 },
    desc: '☢️ Plant a necrotic seed — damage RAMPS each turn (3, 6, 9, 12 HP).',
  },
  // 👻 PHANTOM VEIL — self-cast 50% dodge for 2 turns.
  mirrorImage: {
    id: 'mirrorImage', name: 'Phantom Veil', kind: 'ability',
    range: 0, cost: 2, element: 'arcane', target: 'self',
    applyStatus: { id: 'mirror', chance: 100, duration: 2 },
    desc: '🪞 Conjure illusory duplicates — 50% dodge chance for 2 turns.',
  },
  // ✨ SOUL ANCHOR — single-target one-time auto-revive buff. Recipient
  // revives at 50% HP the first time they would be KO\'d while the status
  // holds. Long duration so the buff stays available even if the target
  // survives several turns first.
  reraiseMove: {
    id: 'reraiseMove', name: 'Soul Anchor', kind: 'ability',
    range: 1, cost: 3, element: 'light', target: 'ally',
    applyStatus: { id: 'reraise', chance: 100, duration: 5 },
    desc: '✨ Tether an ally\'s soul to the living world — first KO within 5 turns revives them at 50% HP.',
  },
  // 🧙 BINDING SIGIL — single-target stun with high reliability. Distinct
  // from `bash` (60% stun, melee): ranged + 90% reliable.
  holdMonster: {
    id: 'holdMonster', name: 'Binding Sigil', kind: 'ability',
    range: 3, cost: 3, element: 'arcane', target: 'enemy', accuracy: 90,
    applyStatus: { id: 'stun', chance: 90, duration: 2 },
    desc: '🪡 Inscribe a binding rune in the air — 90% chance to Stun the target for 2 turns.',
  },
  // 🌬️ STORMWAKE — team-wide speed/range/accuracy boost via Haste. Distinct
  // from `gustingWinds` (already +1 move, 2t) by paying more for a longer
  // duration; gives storm-decks a baseline tempo tool.
  tailwind: {
    id: 'tailwind', name: 'Stormwake', kind: 'ability',
    range: 0, cost: 2, element: 'wind', target: 'allAllies',
    applyStatus: { id: 'haste', chance: 100, duration: 4 },
    desc: '🌬️ Summon a favorable gale — every ally gains Haste for 4 turns.',
  },
  // 👻 SPECTRAL HAZE — a ghost hex: the target's strikes phase through
  // everything. Every attack it makes MISSES for the full duration. No
  // damage; pure denial. The hex itself never misses (accuracy 100).
  spectralHaze: {
    id: 'spectralHaze', name: 'Spectral Haze', kind: 'ability',
    range: 3, cost: 2, element: 'shadow', target: 'enemy', accuracy: 100,
    applyStatus: { id: 'spectralHaze', chance: 100, duration: 3 },
    desc: '👻 Wreathe the target in haunted fog — for 3 turns EVERY attack it makes misses 100% of the time.',
  },

  // ╔══════════════════════════════════════════════════════════════════════
  // 🪤 COUNTER-PLAY MOVESET — board-clear utility moves for units + heroes
  // ────────────────────────────────────────────────────────────────────────
  // These give every faction an option to break trap-heavy / wall-spam /
  // surface-stack strategies. Each is a `kind:'ability'` so they share the
  // ABILITY ACTIVATED cinematic + sound, and route through the new effect
  // flags wired into executeMove (clearsWeather, clearsTraps, revealsTraps,
  // smashesWalls, clearsSurfaces). Mix and match in unit learnsets to give
  // your survivors a way to deal with hazards.
  // ╚══════════════════════════════════════════════════════════════════════
  disperse: {
    id: 'disperse', name: 'Disperse', kind: 'ability',
    range: 0, cost: 2, element: 'wind', target: 'self', accuracy: 100,
    clearsWeather: true,
    desc: '🌤 Slash through the sky — instantly ends any active weather card. Cheap counter to weather-control decks.',
  },
  disarmSweep: {
    id: 'disarmSweep', name: 'Disarm Sweep', kind: 'ability',
    range: 0, cost: 1, element: 'metal', target: 'self', accuracy: 100,
    clearsTraps: true, clearsTrapsRadius: 2,
    desc: '🪤 Sweep the dirt — disarms every enemy trap within 2 tiles. One of the few answers to a hand full of traps.',
  },
  greatPurge: {
    id: 'greatPurge', name: 'Great Purge', kind: 'ability',
    range: 0, cost: 4, element: 'light', target: 'self', accuracy: 100,
    clearsTraps: true, clearsTrapsRadius: 0,
    desc: '☀ Holy detonation — disarms EVERY enemy trap on the board (whole field). Expensive, but resets a trap-locked match.',
  },
  reconPulse: {
    id: 'reconPulse', name: 'Recon Pulse', kind: 'ability',
    range: 0, cost: 1, element: 'storm', target: 'self', accuracy: 100,
    revealsTraps: true,
    desc: '🔍 Send out a ping — reveals every enemy trap on the board face-up for the rest of the match. Doesn\'t disarm; just lets you route around them.',
  },
  wreckingSwing: {
    id: 'wreckingSwing', name: 'Wrecking Swing', kind: 'ability',
    range: 0, cost: 2, element: 'earth', target: 'self', accuracy: 100,
    smashesWalls: true, smashesWallsRadius: 1,
    desc: '🧱 Mighty swing — destroys every enemy wall within 1 tile. The straightforward answer to wall-spam decks.',
  },
  shatterStrike: {
    id: 'shatterStrike', name: 'Shatter Strike', kind: 'ability',
    range: 0, cost: 3, element: 'earth', target: 'self', accuracy: 100,
    smashesWalls: true, smashesWallsRadius: 2,
    desc: '🧱💥 Devastating ground slam — destroys every enemy wall within 2 tiles. Crushes deep wall stacks in one cast.',
  },
  cleansingStomp: {
    id: 'cleansingStomp', name: 'Cleansing Stomp', kind: 'ability',
    range: 0, cost: 1, element: 'nature', target: 'self', accuracy: 100,
    clearsSurfaces: true, clearsSurfacesRadius: 1,
    desc: '🧹 Stomp the ground clean — wipes oil / fire / water / glass / mud within 1 tile. Walks your team through a surface stack safely.',
  },
  purifyingRing: {
    id: 'purifyingRing', name: 'Purifying Ring', kind: 'ability',
    range: 0, cost: 3, element: 'water', target: 'self', accuracy: 100,
    clearsSurfaces: true, clearsSurfacesRadius: 3,
    desc: '🧹💧 Cascading wave — wipes every surface hazard within 3 tiles. Big AoE counter to surface-paint specialists.',
  },
  // ╔══════════════════════════════════════════════════════════════════════
  // 🔍 SCAN MOVES — surface enemy unit/hero details
  // ────────────────────────────────────────────────────────────────────────
  // Use `scansTarget: true` for single-target scan, `scansAllEnemies: true`
  // for radius scan, `scansRadius: N` for the AoE radius. Scanned enemies
  // reveal type / faction / element / passives / moves / stats in the
  // unit-detail modal. Marks persist for the whole match.
  // ╚══════════════════════════════════════════════════════════════════════
  scanShot: {
    id: 'scanShot', name: 'Scan Shot', kind: 'ability',
    range: 4, cost: 1, element: 'storm', target: 'enemy', accuracy: 100,
    scansTarget: true,
    desc: '🔍 Pulse-mark one enemy at range 4 — instantly reveals their type, faction, element, passives, moves, and full stats. Stays scanned for the whole match.',
  },
  reconWave: {
    id: 'reconWave', name: 'Recon Wave', kind: 'ability',
    range: 0, cost: 2, element: 'storm', target: 'self', accuracy: 100,
    scansAllEnemies: true, scansRadius: 3,
    desc: '🔍 Send out a 3-tile recon wave — every enemy within is fully revealed for the rest of the match. Synergizes with weak-point comps.',
  },
  totalSurveillance: {
    id: 'totalSurveillance', name: 'Total Surveillance', kind: 'ability',
    range: 0, cost: 3, element: 'arcane', target: 'self', accuracy: 100,
    scansAllEnemies: true, scansRadius: 0,
    desc: '🛰 Deploy a satellite ping — scans EVERY enemy unit + hero on the board. The ultimate intel move.',
  },
  // ╔══════════════════════════════════════════════════════════════════════
  // 🔁 MULTI-HIT MOVES — strike multiple times in one action
  // ────────────────────────────────────────────────────────────────────────
  // dualHit: true          → always exactly 2 hits (each is an independent roll)
  // multiHit: { min, max } → random count each use; each hit rolls damage/crit separately
  // Recoil and drain both apply to the TOTAL damage dealt across all hits.
  // ╚══════════════════════════════════════════════════════════════════════
  dualSlice: {
    id: 'dualSlice', name: 'Dual Slice', kind: 'attack',
    type: 'physical', element: 'none', cost: 2, range: 1,
    power: 55, accuracy: 95, crit: 10,
    dualHit: true,
    desc: '⚔️⚔️ Two arcing blade swings delivered in one fluid motion. Always strikes exactly twice — each hit rolls crits independently.',
  },
  doubleKick: {
    id: 'doubleKick', name: 'Double Kick', kind: 'attack',
    type: 'physical', element: 'none', cost: 1, range: 1,
    power: 45, accuracy: 100, crit: 5,
    dualHit: true,
    desc: '🦵🦵 A swift two-kick combo that never misses. Guaranteed 2 hits — great for reliable chip damage.',
  },
  twinStrike: {
    id: 'twinStrike', name: 'Twin Strike', kind: 'attack',
    type: 'physical', element: 'none', cost: 2, range: 2,
    power: 50, accuracy: 95, crit: 12,
    dualHit: true,
    desc: '⚡⚡ Two rapid strikes at mid-range, both rolls fully independent. Higher crit chance than Dual Slice.',
  },
  furySwipes: {
    id: 'furySwipes', name: 'Fury Swipes', kind: 'attack',
    type: 'physical', element: 'none', cost: 2, range: 1,
    power: 30, accuracy: 85, crit: 5,
    multiHit: { min: 2, max: 5 },
    desc: '🐾 Relentless clawing frenzy — 2 to 5 hits per use, each rolled independently. Low power per claw, but 5-hit rolls are brutal.',
  },
  bulletSeed: {
    id: 'bulletSeed', name: 'Bullet Seed', kind: 'attack',
    type: 'physical', element: 'nature', cost: 2, range: 3,
    power: 30, accuracy: 100, crit: 5,
    multiHit: { min: 2, max: 5 },
    desc: '🌱💥 Fires 2 to 5 nature seeds at range 3. Never misses — each seed deals damage independently.',
  },
  pinMissile: {
    id: 'pinMissile', name: 'Pin Missile', kind: 'attack',
    type: 'physical', element: 'storm', cost: 2, range: 4,
    power: 28, accuracy: 90, crit: 8,
    multiHit: { min: 2, max: 5 },
    desc: '📌 A volley of razor-sharp needles fired at long range — 2 to 5 hits. Each spike rolls crits independently.',
  },
  doubleDragon: {
    id: 'doubleDragon', name: 'Double Dragon', kind: 'attack',
    type: 'magic', element: 'arcane', cost: 3, range: 3,
    power: 65, accuracy: 90, crit: 15,
    dualHit: true,
    desc: '🐉🐉 Conjure twin dragon maws that snap twice in sequence. Both hits are magical; each can crit. Best magic dual-hit in the catalog.',
  },
  rockBlast: {
    id: 'rockBlast', name: 'Rock Blast', kind: 'attack',
    type: 'physical', element: 'earth', cost: 2, range: 3,
    power: 32, accuracy: 90, crit: 5,
    multiHit: { min: 2, max: 5 },
    desc: '🪨 Hurls 2 to 5 jagged boulders in rapid succession. Breaks through barriers — each boulder is an independent earth hit.',
  },
};
