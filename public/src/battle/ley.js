/* ============================================================================
 * Mythic Spellbook — LEYLINES.                        public/src/battle/ley.js
 * ----------------------------------------------------------------------------
 * Duelists-of-the-Roses terrain, adapted to a board that has 11 terrain paints
 * and 23 elements. A straight 1:1 port is not available to us: DotR had six
 * terrains for six attributes, we would need twelve new tile arts and a table
 * nobody could hold in their head.
 *
 * SO THE PAINT AND THE CHARGE ARE TWO DIFFERENT THINGS.
 *
 *     tile.terrain -> 'lava'                    the ART. Athena owns it. Static.
 *     tile.ley     -> { elem, power, owner }    the MECHANIC. Fought over.
 *
 * Terrain SEEDS ley when the board is first read (lava -> fire, snow -> ice,
 * blight -> corruption, ...). After that the ley layer is the live thing, and
 * every one of the 23 elements is representable without shipping one new
 * sprite. road / rubble / dirt seed NEUTRAL on purpose: they are most of the
 * board, and they are the contested ground the match is actually decided on.
 *
 * THE THREE RULES
 *   1. ATTUNEMENT   a unit fighting on ley matching one of its elements hits
 *                   harder and takes less. On ley its element is WEAK to (read
 *                   from the game's own TYPE_CHART, not a second table) it hits
 *                   softer. Elements own the damage numbers.
 *   2. TERRITORY    every living unit converts the hex it is standing on to its
 *                   own primary element, one power step per tick, automatically
 *                   and for free. Unheld ley decays back toward neutral. This
 *                   is the whole game: a map-painting war fought underneath the
 *                   fight. Automatic was a deliberate call over costed — the
 *                   chaos IS the feature.
 *   3. AFFINITY     factions get TACTICS on their home ground, never damage:
 *                   movement, regen, hazard immunity, a defensive ward. Keeping
 *                   factions off the damage axis is what stops
 *                   2.0x chart * 1.5x ley * crit from one-shotting through the
 *                   whole roster.
 *
 * 🔴 ONE CLAMP, ONE PLACE. Everything this file hands back to calculateDamage
 * goes through clampMod(), capped at LEY.CAP. The damage formula in index.html
 * already stacks type chart * weather * time-of-day * STAB * keystones * crit;
 * a positional modifier with no ceiling on top of that is how a 40-damage move
 * becomes a 300-damage move on a lava map. Tune LEY, never a call site — the
 * _opEcon() rule, applied to combat.
 *
 * 🔴 THE GLOBALS TRAP (CLAUDE.md). index.html declares TYPE_CHART, distance,
 * getElementsOf and friends as top-level `const`, which are lexical bindings
 * and NOT on window. This file therefore cannot see them, and does not try:
 * index.html hands them over through MythicLey.wire() at boot. Every one has a
 * safe local fallback so an unwired module degrades to "no ley" rather than
 * throwing inside the damage formula. Same seam, same reason, as MythicSea in
 * src/battle/effects.js.
 *
 * Registered as window.MythicLey. Loaded as a classic deferred script exactly
 * like effects.js — index.html calls into it behind `typeof` guards and no-ops
 * when it is absent, so a parse failure here costs the ley layer and nothing
 * else.
 * ==========================================================================*/
(function (global) {
  'use strict';
  if (!global) return;

  var VERSION = 'ley-1.0.0';

  /* ══════════════════════════════════════════════════════════════════════════
     LEY — every number the system has. The _opEcon() pattern: no ley constant
     is written down anywhere else in the codebase, so balancing is one edit
     here and never a hunt through index.html.
     ══════════════════════════════════════════════════════════════════════════ */
  var LEY = {
    POWER_MAX: 3,

    // Attacker standing on ley matching one of ITS elements. Index = power.
    ATTUNE_ATK: [0, 0.20, 0.35, 0.50],
    // Defender standing on matching ley — incoming damage cut. Index = power.
    ATTUNE_DEF: [0, 0.15, 0.25, 0.35],
    // Attacker standing on ley its element is WEAK to (per the game type chart).
    DISCORD_ATK: -0.15,

    // 🔴 The ceiling on everything above, combined, in either direction.
    CAP: 0.60,

    // Territory. A unit stamps the tile it occupies at each tick; power climbs
    // one step per tick it stays. Unheld ley loses a step every DECAY_TICKS.
    CONVERT_POWER: 1,
    ENTRENCH_STEP: 1,
    DECAY_TICKS: 3,

    // Faction affinity perks.
    PERK_MOVE: 1,        // tiles of extra movement on home ground
    PERK_REGEN: 4,       // HP restored per tick on home ground
    PERK_WARD: 0.15,     // extra incoming-damage cut on home ground

    // Seeded ley starts weaker than ley a unit has fought for.
    SEED_CAP: 2,
    // 🔴 THE PAINTED-MAP GUARD. An admin who paints a map 70% lava hands every
    // fire deck +35% damage on turn zero across most of the board, before
    // anyone has made a decision — and the other side cannot answer it, because
    // grinding a power-2 ley down takes two ticks per hex. That is not a map,
    // it is a result. When one element covers more than this share of the
    // SEEDED tiles, its seed power is knocked down to 1 (one tick to break
    // instead of two). The paint is untouched and the map still favours that
    // element — it just no longer decides the match on its own.
    SEED_SHARE_CAP: 0.45,

    /* ── phase 2 ──────────────────────────────────────────────────────────── */

    // ⛰ HIGH GROUND. Per rung of elevation difference, on RANGED attacks only
    // (distance > 1). Melee is two fighters in the same scrum and the rung they
    // are standing on does not decide it; an archer above you plainly does.
    // Shares the LEY.CAP clamp with attunement — see damageMod.
    ELEV_PER_RUNG: 0.08,
    ELEV_MAX_RUNGS: 3,     // a 4-rung cliff is not four times a 1-rung step
    // Shoved off a ledge: extra tiles of knockback when the target is pushed
    // from higher ground to lower.
    ELEV_KNOCKBACK: 1,

    // 🜂 LEY FOUNTS. Fixed, mirror-symmetric tiles. A unit that holds one floods
    // the hexes around it with its own element, at a power nothing else on the
    // board reaches. This is the objective layer: a reason to go somewhere that
    // is not "at the enemy".
    FOUNT_RADIUS: 2,
    FOUNT_POWER: 3,

    /* ── phase 3: making it playable as strategy ───────────────────────────── */

    // 🎚 MASTER SWITCH + DIAL. ENABLED off makes every public entry point inert
    // (no seeding, no tick, no modifier, no tint) so a mode can opt out whole.
    // INTENSITY scales every modifier this file produces — 0.5 for a casual or
    // story mode that wants the flavour without the swing, 1.5 for a skirmish
    // mode that wants positioning to dominate. It multiplies BEFORE the clamp,
    // so turning it up cannot breach LEY.CAP; raise the cap too if you mean it.
    ENABLED: true,
    INTENSITY: 1,

    // 🤖 AI WEIGHTS. The AI's destination scoring is in raw score points, where
    // roughly 100 ≈ "one good attack", so these are calibrated against that:
    // taking a fount is worth more than a swing, claiming a hex is worth less.
    // 🔴 The AI already values ATTACKING from attuned/high ground for free —
    // tryAttackFromPos probes calculateDamage at the hypothetical tile, which
    // runs damageMod. These weights cover only what that probe cannot see:
    // ground worth taking when there is nothing to hit.
    AI_FOUNT_OPEN: 130,      // step onto an unheld fount
    AI_FOUNT_ENEMY: 190,     // take one the enemy is drawing power from
    AI_FOUNT_HOLD: 90,       // stay on the one we already hold
    AI_CLAIM_NEUTRAL: 18,    // convert bare ground
    AI_CLAIM_ENEMY: 34,      // grind enemy ground down
    AI_STAND_OWN: 12,        // per power step of our own ley under us
    AI_DISCORD: -26,         // ground our element is weak to

    // 💥 COUNTERPLAY. A move flagged breakLey (or a unit with the leybreaker
    // passive) tears the ley out of the ground it lands on. Without this the
    // only answer to entrenched ley is to stand on it for three turns, and a
    // player who is behind on territory has no play at all.
    BREAK_RADIUS: 1,
    BREAK_POWER: 2,          // power steps torn out per hit

    /* ── phase 4: the elemental boons ──────────────────────────────────────── */

    // 🎁 Ley power at which an element's own boon starts paying out. Power 1 is
    // the damage bonus alone — the boon has to be EARNED by entrenching, which
    // is what makes holding a hex for a second turn a decision rather than a
    // formality.
    BOON_POWER: 2,
    // The two strongest boons (a free revive, a 50% dodge) only ever come from
    // fully entrenched ground.
    BOON_POWER_HIGH: 3,
    BOON_DURATION: 2,        // turns a granted status lasts; refreshed each tick
  };

  /* ══════════════════════════════════════════════════════════════════════════
     TERRAIN -> LEY SEED
     Two vocabularies, because the board has two terrain sources and they do not
     agree. Both are seeded so a match reads the same whether it is fought on a
     hand-painted Athena map or the procedural default.

       EDITOR_SEED    the 11 admin paint keys (_BME_TERRAIN in index.html), full
                      fidelity, used wherever the active map actually painted.
       SURF_SEED      the 5 surfaces _bbGenTerrain emits for every other tile
                      (asphalt / water / grass / rubble / dirt). Coarser, because
                      the generator genuinely does not distinguish snow from ash.

     `null` means NEUTRAL — unclaimed ground, and the point of the mode.
     ══════════════════════════════════════════════════════════════════════════ */
  var EDITOR_SEED = {
    lava:   { elem: 'lava',       power: 2 },
    water:  { elem: 'water',      power: 2 },
    snow:   { elem: 'ice',        power: 2 },
    blight: { elem: 'corruption', power: 2 },
    ash:    { elem: 'shadow',     power: 1 },
    grass:  { elem: 'nature',     power: 1 },
    dirt:   { elem: 'earth',      power: 1 },
    sand:   { elem: 'earth',      power: 1 },
    stone:  { elem: 'metal',      power: 1 },
    rubble: { elem: 'metal',      power: 1 },
    road:   null,
  };
  var SURF_SEED = {
    water:   { elem: 'water',  power: 2 },
    grass:   { elem: 'nature', power: 1 },
    dirt:    { elem: 'earth',  power: 1 },
    rubble:  { elem: 'metal',  power: 1 },
    asphalt: null,
  };

  /* ══════════════════════════════════════════════════════════════════════════
     FACTION AFFINITY — tactics, never damage.

       home   ley elements this faction calls home
       perk   'move' | 'regen' | 'ward' | 'hazard'
       hazard surface ids the faction ignores while on home ground

     A faction absent from this table simply has no home ground, which is a
     legitimate answer — Champion, Hero and Shapeshifter are meant to fight the
     same everywhere. Elements still apply to their units normally.
     ══════════════════════════════════════════════════════════════════════════ */
  var AFFINITY = {
    aquatic:     { home: ['water', 'ice'],              perk: 'move' },
    pirate:      { home: ['water'],                     perk: 'move' },
    beast:       { home: ['nature', 'earth'],           perk: 'move' },
    tribal:      { home: ['nature', 'earth'],           perk: 'move' },
    bird:        { home: ['wind', 'storm'],             perk: 'move' },
    rogue:       { home: ['shadow'],                    perk: 'move' },
    plant:       { home: ['nature'],                    perk: 'regen' },
    undead:      { home: ['shadow', 'corruption'],      perk: 'regen' },
    necromancer: { home: ['shadow', 'corruption'],      perk: 'regen' },
    corrupted:   { home: ['corruption', 'poison'],      perk: 'regen', hazard: ['toxin', 'poison', 'acid'] },
    slime:       { home: ['poison', 'water'],           perk: 'regen', hazard: ['acid', 'poison', 'toxin'] },
    vampire:     { home: ['blood', 'shadow'],           perk: 'regen' },
    demon:       { home: ['fire', 'lava'],              perk: 'hazard', hazard: ['fire'] },
    elemental:   { home: ['fire', 'lava', 'water', 'earth', 'wind', 'ice'], perk: 'hazard', hazard: ['fire', 'electrified'] },
    construct:   { home: ['metal'],                     perk: 'ward',  hazard: ['toxin', 'poison', 'acid', 'blood'] },
    artificer:   { home: ['metal'],                     perk: 'ward' },
    giant:       { home: ['earth', 'metal'],            perk: 'ward' },
    goblinoid:   { home: ['earth', 'shadow'],           perk: 'ward' },
    warrior:     { home: ['metal', 'earth'],            perk: 'ward' },
    soldier:     { home: ['metal', 'earth'],            perk: 'ward' },
    celestial:   { home: ['light'],                     perk: 'ward' },
    divine:      { home: ['light'],                     perk: 'ward' },
    monk:        { home: ['light', 'spirit'],           perk: 'ward' },
    spirit:      { home: ['spirit', 'shadow'],          perk: 'move' },
    fairy:       { home: ['nature', 'arcane'],          perk: 'move' },
    bug:         { home: ['poison', 'nature'],          perk: 'move', hazard: ['web'] },
    swarm:       { home: ['poison', 'nature'],          perk: 'move', hazard: ['web'] },
    reptile:     { home: ['earth', 'poison'],           perk: 'regen' },
    dragonkin:   { home: ['fire', 'lava', 'storm'],     perk: 'hazard', hazard: ['fire'] },
    mage:        { home: ['arcane'],                    perk: 'ward' },
    scholar:     { home: ['arcane', 'psychic'],         perk: 'ward' },
    eldritch:    { home: ['void', 'psychic'],           perk: 'ward' },
    cultist:     { home: ['void', 'blood'],             perk: 'regen' },
    alien:       { home: ['void', 'corruption'],        perk: 'regen', hazard: ['toxin', 'poison'] },
    berserker:   { home: ['blood'],                     perk: 'regen' },
    samurai:     { home: ['metal', 'wind'],             perk: 'ward' },
    werewolf:    { home: ['blood', 'nature'],           perk: 'regen' },
    scp:         { home: ['void', 'psychic'],           perk: 'ward' },
    merchant:    { home: ['crystal'],                   perk: 'ward' },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     🎁 ELEMENTAL BOONS — one for every element in ELEMENTS, all 21.

     Attunement (the damage number) is the same for every element by design:
     one clamped modifier, one ceiling, checkable. The BOON is the other half —
     what makes standing on fire ground feel different from standing on ice
     ground rather than just being a differently-coloured +35%.

     🔴 BUILT ON THE GAME'S REAL STATUS_EFFECTS, NOT A PARALLEL BUFF SYSTEM.
     Every `status` named here is an existing id (verified by _ley_smoke.mjs
     against index.html, because a typo'd status id throws nothing and simply
     never fires). That means each boon already draws its own chip on the unit,
     already counts down on the shared status timer, and already answers to
     cleanse, dispel and immunity exactly the way players have learned. Inventing
     21 new buffs would have meant 21 new things that none of that is true of.

     🔴 NO BOON TOUCHES DAMAGE DIRECTLY. Damage lives in the clamped attunement
     and nowhere else, so the ±60% ceiling stays the whole story for positional
     damage. A boon that granted "+20% fire damage" would be a second damage
     path with no clamp on it — which is the exact failure the single clamp
     exists to prevent. They grant stats, mobility, survivability and utility;
     the stat statuses (strong, shielded, …) feed the normal getStatBonus path.

     Gated at LEY.BOON_POWER (2), so a boon is EARNED by entrenching — power 1
     pays the damage bonus alone. The two strongest (a free revive, a 50% dodge)
     need fully entrenched ground at BOON_POWER_HIGH (3).

     Shape: { name, icon, status?, status2?, heal?, cleanse?, anchor?, min?, desc }
     ══════════════════════════════════════════════════════════════════════════ */
  var ELEM_BOON = {
    fire:       { name: 'Emberheat',        icon: '🔥', status: 'strong',
                  desc: 'The ground burns hot underfoot — +4 ATK.' },
    water:      { name: 'Tidal Mend',       icon: '💧', heal: 5,
                  desc: 'The tide closes your wounds — 5 HP restored each turn you hold the hex.' },
    earth:      { name: 'Bedrock Stance',   icon: '🪨', status: 'shielded',
                  desc: 'Rooted to the stone — +5 DEF and +5 RES.' },
    wind:       { name: 'Tailwind',         icon: '🌬️', status: 'swift',
                  desc: 'The air carries you — +2 movement and reach.' },
    light:      { name: 'Consecration',     icon: '✨', status: 'blessed',
                  desc: 'Hallowed ground — +3 to every stat.' },
    shadow:     { name: 'Umbral Veil',      icon: '🌑', status: 'lucky',
                  desc: 'The dark closes around you — 30% chance to dodge any attack.' },
    nature:     { name: 'Verdant Knit',     icon: '🌿', heal: 4, cleanse: 1,
                  desc: 'Green growth knits you back together — 4 HP and one affliction lifted.' },
    storm:      { name: 'Static Charge',    icon: '⚡', status: 'haste', status2: 'focused',
                  desc: 'Charged air — +1 movement and +4 MAG.' },
    ice:        { name: 'Frostmantle',      icon: '❄️', status: 'frostForm',
                  desc: 'Armoured in rime — +4 DEF, +3 RES, -1 SPD.' },
    metal:      { name: 'Tempered Guard',   icon: '⚙️', status: 'countering',
                  desc: 'Iron underfoot answers for you — the next enemy attack is blocked and countered.' },
    poison:     { name: 'Creeping Venom',   icon: '☠️', status: 'moxie',
                  desc: 'The toxin sharpens rather than sickens — a stacking +2 ATK.' },
    psychic:    { name: 'Mirrored Mind',    icon: '🧠', status: 'mirror', min: 3,
                  desc: 'Duplicates flicker around you — 50% chance to dodge. Needs fully entrenched ground.' },
    arcane:     { name: 'Mana Font',        icon: '🌟', status: 'empowered',
                  desc: 'Raw magic wells up through the hex — +4 ATK and +4 MAG.' },
    void:       { name: 'Nullfield',        icon: '⚫', cleanse: 99,
                  desc: 'The void eats what clings to you — every status effect stripped, good and bad alike.' },
    blood:      { name: 'Sanguine Feast',   icon: '🩸', heal: 6,
                  desc: 'The ground gives its blood back — 6 HP restored each turn.' },
    crystal:    { name: 'Prism Lattice',    icon: '💎', status: 'soulFlame',
                  desc: 'Facets turn the blow aside — +4 DEF and +4 RES.' },
    corruption: { name: 'Rotbloom',         icon: '☣️', status: 'berserk',
                  desc: 'The rot takes hold — +6 ATK, -5 DEF, and you must strike the nearest enemy.' },
    spirit:     { name: 'Soul Anchor',      icon: '👻', status: 'reraise', min: 3,
                  desc: 'The dead hold you here — revive once at half HP. Needs fully entrenched ground.' },
    lava:       { name: 'Molten Skin',      icon: '🌋', status: 'burningRes',
                  desc: 'Wreathed in the ground\'s own fire — +4 ATK and +4 MAG.' },
    sound:      { name: 'Resonance',        icon: '🔊', status: 'assisted',
                  desc: 'The hex rings in sympathy — +6 ATK and +6 MAG for the next strike.' },
    gravity:    { name: 'Anchored',         icon: '🌌', status: 'shielded', anchor: true,
                  desc: 'Pinned to the world — +5 DEF, +5 RES, and nothing can shove or drag you.' },
  };

  // The boon this element pays at this power, or null if the ground is not
  // charged enough yet.
  function boonFor(elem, power) {
    if (!LEY.ENABLED || !elem) return null;
    var b = ELEM_BOON[elem];
    if (!b) return null;
    var need = b.min || LEY.BOON_POWER;
    return (clampPower(power) >= need) ? b : null;
  }

  // 🌌 Gravity's half: a unit on entrenched gravity ley cannot be shoved or
  // dragged. Read by the knockback and pull blocks in index.html.
  function isAnchored(state, unit) {
    if (!LEY.ENABLED || !state || !unit || !unit.pos) return false;
    if (W.isFlying(unit)) return false;
    var ley = leyAt(state, unit.pos.x, unit.pos.y);
    if (!ley) return false;
    var els = W.getElementsOf(unit);
    if (els.indexOf(ley.elem) === -1) return false;
    var b = boonFor(ley.elem, ley.power);
    return !!(b && b.anchor);
  }

  // Pay one unit's boon. Returns the boon that fired, or null.
  function payBoon(state, unit, ley) {
    if (!unit || !ley) return null;
    var els = W.getElementsOf(unit);
    if (els.indexOf(ley.elem) === -1) return null;      // only YOUR element pays
    var b = boonFor(ley.elem, ley.power);
    if (!b) return null;
    if (b.heal && unit.maxHp && unit.currentHp > 0 && unit.currentHp < unit.maxHp) {
      unit.currentHp = Math.min(unit.maxHp, unit.currentHp + b.heal);
    }
    if (b.cleanse && typeof W.cleanse === 'function') { try { W.cleanse(unit, b.cleanse); } catch (e) {} }
    if (typeof W.applyStatus === 'function') {
      try {
        if (b.status)  W.applyStatus(unit, b.status,  LEY.BOON_DURATION);
        if (b.status2) W.applyStatus(unit, b.status2, LEY.BOON_DURATION);
      } catch (e) {}
    }
    return b;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     WIRING. index.html hands over the lexical `const`s this file cannot see.
     Every one has a fallback that makes the system inert rather than throwing —
     an exception raised from inside calculateDamage would take the whole match
     down, and "ley did nothing" is a survivable failure where that is not.
     ══════════════════════════════════════════════════════════════════════════ */
  var W = {
    getElementsOf: function (o) {
      if (!o) return [];
      if (Array.isArray(o.elements) && o.elements.length) return o.elements;
      return o.element ? [o.element] : [];
    },
    getTypeMultiplier: function () { return 1; },   // inert until wired
    elementColor: function () { return '#8899aa'; },
    elementName: function (e) { return e; },
    isFlying: function () { return false; },
    log: function () {},
    // 🎁 Status grant, wired from index.html. The boons below are built on the
    // game's REAL STATUS_EFFECTS ids (strong, shielded, blessed, frostForm,
    // reraise, …) rather than a parallel buff system, so every one of them
    // already renders its own chip on the unit, already expires on the shared
    // timer, and already interacts with cleanse, dispel and immunity the way
    // players expect. Inert until wired, which costs the boons and nothing else.
    applyStatus: null,
    // 🧼 Strip statuses — nature clears one, void clears the lot.
    cleanse: null,
    // 🔴 HEX distance, wired from index.html rather than reimplemented here.
    // The board is odd-r offset and its parity rules are subtle enough that
    // _paintSurface shipped a SQUARE disc on a hex board and nobody saw it for
    // a wave (CLAUDE.md, HEXSPEC §6). Reimplementing that maths in a second
    // file is volunteering for the same bug. Without it the fount falls back to
    // its own tile only, which is wrong but small and obvious — never a
    // silently oversized disc.
    distance: null,
  };
  function wire(fns) {
    if (!fns) return;
    for (var k in fns) {
      if (Object.prototype.hasOwnProperty.call(fns, k) && typeof fns[k] === 'function') W[k] = fns[k];
    }
  }

  /* ── small helpers ──────────────────────────────────────────────────────── */
  function tileAt(state, x, y) {
    if (!state || !state.board || !state.board[y]) return null;
    return state.board[y][x] || null;
  }
  function leyAt(state, x, y) {
    if (!LEY.ENABLED) return null;
    var t = tileAt(state, x, y);
    return (t && t.ley && t.ley.elem) ? t.ley : null;
  }
  function factionsOf(u) {
    if (!u) return [];
    if (Array.isArray(u.factions) && u.factions.length) return u.factions;
    return u.faction ? [u.faction] : [];
  }
  function primaryElementOf(u) {
    var e = W.getElementsOf(u);
    return (e && e.length) ? e[0] : null;
  }
  function clampPower(p) { return Math.max(0, Math.min(LEY.POWER_MAX, p | 0)); }
  // 🎚 INTENSITY is applied HERE, inside the clamp, so every modifier the file
  // produces is scaled and capped in one place. Scaling at the call sites would
  // mean a new modifier could be added later that quietly skips the dial.
  function clampMod(m) {
    if (!isFinite(m)) return 0;
    var scaled = m * (isFinite(LEY.INTENSITY) ? LEY.INTENSITY : 1);
    return Math.max(-LEY.CAP, Math.min(LEY.CAP, scaled));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ⛰ ELEVATION. The board generator has always written a per-tile `elev`
     (_BB_ELEV, five rungs 0..1.36 in world units) and gameplay has never read
     one of them — the height was scenery. Seeding copies it onto the game board
     as a discrete RUNG so the rules can talk about "one level up" instead of
     floating-point world height.
     ══════════════════════════════════════════════════════════════════════════ */
  var ELEV_STEP = 0.34;                       // _BB_ELEV rung spacing
  function rungOf(elev) {
    var n = Math.round((+elev || 0) / ELEV_STEP);
    return Math.max(0, Math.min(4, n));
  }
  function rungAt(state, x, y) {
    var t = tileAt(state, x, y);
    return t ? (t.elevRung | 0) : 0;
  }

  /* 🜂 LEY FOUNTS — deterministic and MIRROR-SYMMETRIC under
     (x,y) -> (W-1-x, H-1-y), which is the same 180° symmetry _bbGenTerrain
     folds its noise against. Two mirrored pairs, never a lone centre tile: on
     an even-sided board no single hex is its own mirror, so a "centre" fount
     would sit nearer one deployment zone than the other and hand that side the
     objective layer before the first turn.

     Derived from board DIMENSIONS only, so both multiplayer clients compute the
     same four tiles with nothing to sync — the same property seeding relies on. */
  function founts(state) {
    if (!LEY.ENABLED) return [];
    if (!state || !Array.isArray(state.board)) return [];
    var H = state.board.length;
    var Wd = (H && state.board[0]) ? state.board[0].length : 0;
    if (Wd < 5 || H < 5) return [];            // too small to place them fairly
    var pts = [
      { x: Math.floor(Wd * 0.25), y: Math.floor(H * 0.5) },
      { x: Math.floor(Wd * 0.5),  y: Math.floor(H * 0.25) },
    ];
    var out = [], seen = {};
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = { x: Wd - 1 - a.x, y: H - 1 - a.y };
      var pair = [a, b];
      for (var j = 0; j < 2; j++) {
        var k = pair[j].x + ',' + pair[j].y;
        if (seen[k]) continue;
        seen[k] = 1;
        out.push(pair[j]);
      }
    }
    return out;
  }
  function isFount(state, x, y) {
    var f = founts(state);
    for (var i = 0; i < f.length; i++) if (f[i].x === x && f[i].y === y) return true;
    return false;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     🜂 LEY REACTIONS. The surface engine in index.html already chains hazards
     against each other (fire on oil ignites the pool, storm on water
     electrifies it). This is the same idea one layer down: a move landing on
     ATTUNED GROUND leaves a hazard behind, so the ley layer does something
     other than move a number.

     Keyed [ley element][move element] -> the surface to paint. Deliberately
     sparse: every entry has to read as obvious the first time a player sees it,
     because an unexplained hazard appearing under your own unit is worse than
     no reaction at all.
     ══════════════════════════════════════════════════════════════════════════ */
  var REACTIONS = {
    ice:        { fire: { surf: 'water', turns: 4, msg: 'melts the frozen ground into meltwater' },
                  lava: { surf: 'water', turns: 4, msg: 'melts the frozen ground into meltwater' } },
    water:      { ice:   { surf: 'ice',         turns: 5, msg: 'freezes the waterlogged ground solid' },
                  storm: { surf: 'electrified', turns: 3, msg: 'sends current crawling through the wet ground' } },
    lava:       { water: { surf: 'steam',  turns: 3, msg: 'flashes across the molten rock into scalding steam' },
                  ice:   { surf: 'steam',  turns: 3, msg: 'cracks against the molten rock in a burst of steam' } },
    nature:     { fire: { surf: 'fire',  turns: 3, msg: 'catches the dry growth alight' },
                  lava: { surf: 'fire',  turns: 3, msg: 'catches the dry growth alight' } },
    corruption: { fire: { surf: 'toxin', turns: 3, msg: 'burns the rot into a cloud of poison gas' },
                  lava: { surf: 'toxin', turns: 3, msg: 'burns the rot into a cloud of poison gas' } },
    poison:     { fire: { surf: 'toxin', turns: 3, msg: 'ignites the tainted ground into choking fumes' } },
    blood:      { storm: { surf: 'electrified', turns: 3, msg: 'runs through the spilled blood' } },
    metal:      { storm: { surf: 'electrified', turns: 3, msg: 'earths itself through the iron underfoot' } },
  };

  /* What (if anything) a move of `moveElem` does to the ley at (x,y).
     Returns null, or { surf, turns, msg } for the caller to paint and log.
     Pure — index.html owns _setSurface, and the game owns every decision. */
  function reactionFor(state, x, y, moveElem) {
    if (!moveElem) return null;
    var ley = leyAt(state, x, y);
    if (!ley) return null;
    var row = REACTIONS[ley.elem];
    if (!row) return null;
    var r = row[moveElem];
    if (!r) return null;
    return { surf: r.surf, turns: r.turns, msg: r.msg, leyElem: ley.elem };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SEEDING. Lazy and idempotent, keyed on state._leySeeded.

     🔴 LAZY ON PURPOSE. index.html builds battle state in more than one place
     (solo, campaign, roguelite, the multiplayer snapshot path) and seeding at
     each constructor means finding all of them and finding every future one.
     Seeding on first read cannot be missed. The cost is one flag check per
     tick, which is nothing next to being silently absent from one game mode.

     Deterministic: it reads the same map both clients already agree on, so
     multiplayer seeds identically on each side without syncing anything. The
     ley then lives on state.board and travels inside the normal state snapshot.
     ══════════════════════════════════════════════════════════════════════════ */
  function seed(state, map) {
    if (!LEY.ENABLED) return state;
    if (!state || !Array.isArray(state.board)) return state;
    if (state._leySeeded) return state;
    state._leySeeded = true;

    var H = state.board.length;
    var Wd = (H && state.board[0]) ? state.board[0].length : 0;

    // Editor paint, at full 11-key fidelity, indexed with the dims it was
    // WRITTEN with — the same trap _bbMapFromEditor documents at length. An
    // array written 8x7 and read as 14x12 shears the paint diagonally.
    var ed = (map && Array.isArray(map.terrain)) ? map.terrain : null;
    var eCols = ed ? Math.max(1, (map.cols | 0) || Wd) : 0;
    var eRows = ed ? Math.max(1, (map.rows | 0) || H) : 0;

    // Generator surfaces for everything the editor did not paint.
    var seeded = [], counts = {};
    var surfByKey = null, elevByKey = null;
    if (map && Array.isArray(map.tiles)) {
      surfByKey = {}; elevByKey = {};
      for (var i = 0; i < map.tiles.length; i++) {
        var mt = map.tiles[i];
        if (!mt) continue;
        surfByKey[mt.x + ',' + mt.z] = mt.surf;
        elevByKey[mt.x + ',' + mt.z] = mt.elev;
      }
    }

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < Wd; x++) {
        var tile = state.board[y][x];
        if (!tile) continue;
        // ⛰ Elevation is copied EVERY pass, even onto a tile that already has
        // ley — it is a property of the ground, not of the claim on it, and
        // `continue`-ing past it below would leave the rung at 0 on any tile
        // the editor happened to paint.
        if (elevByKey && tile.elevRung == null) tile.elevRung = rungOf(elevByKey[x + ',' + y]);
        if (tile.ley) continue;
        var s = null;
        if (ed && x < eCols && y < eRows) {
          var key = Array.isArray(ed[x]) ? ed[x][y] : ed[x * eRows + y];
          if (key && Object.prototype.hasOwnProperty.call(EDITOR_SEED, key)) s = EDITOR_SEED[key];
        }
        if (!s && surfByKey) {
          var sf = surfByKey[x + ',' + y];
          if (sf && Object.prototype.hasOwnProperty.call(SURF_SEED, sf)) s = SURF_SEED[sf];
        }
        if (!s) continue;
        tile.ley = {
          elem: s.elem,
          power: Math.min(LEY.SEED_CAP, clampPower(s.power)),
          owner: null,      // seeded ground belongs to nobody
          held: 0,
          idle: 0,
        };
        seeded.push(tile);
        counts[s.elem] = (counts[s.elem] | 0) + 1;
      }
    }

    // ── the painted-map guard ────────────────────────────────────────────────
    // Share is measured against the WHOLE board, not against the seeded tiles
    // only: a map that is 45% lava and 55% road is exactly the lopsided case
    // this exists to catch, and measuring within the seeded subset would score
    // that as 100% and then knock down a perfectly balanced four-element map
    // for the same reading. Neutral ground is a real answer to attunement and
    // has to count as one.
    var total = Wd * H;
    if (total > 0) {
      for (var el in counts) {
        if (!Object.prototype.hasOwnProperty.call(counts, el)) continue;
        if (counts[el] / total <= LEY.SEED_SHARE_CAP) continue;
        for (var k = 0; k < seeded.length; k++) {
          if (seeded[k].ley && seeded[k].ley.elem === el) seeded[k].ley.power = 1;
        }
      }
    }
    return state;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ATTUNEMENT — what calculateDamage asks for.

     Returns a single multiplier for the attacker's outgoing damage, already
     clamped. Reads BOTH tiles: the attacker's ground decides whether they are
     empowered or discordant, the defender's ground decides how well they are
     dug in. One call, one number, one clamp.

     🔴 Reads the move's element for attunement, NOT the attacker's — a fire
     mage standing on fire ley and casting an ice spell is not attuned to what
     they are doing. This is the same reading STAB already takes in index.html,
     and keeping them consistent is what stops the two from arguing.
     ══════════════════════════════════════════════════════════════════════════ */
  function damageMod(state, attacker, defender, moveElem) {
    var out = { mul: 1, atkBonus: 0, defCut: 0, attuned: false, discordant: false, warded: false };
    if (!LEY.ENABLED) return out;
    if (!state || !attacker || !attacker.pos) return out;

    var mod = 0;

    // ── attacker's ground ──────────────────────────────────────────────────
    var aLey = W.isFlying(attacker) ? null : leyAt(state, attacker.pos.x, attacker.pos.y);
    if (aLey && moveElem && moveElem !== 'neutral') {
      if (aLey.elem === moveElem) {
        mod += LEY.ATTUNE_ATK[clampPower(aLey.power)] || 0;
        out.attuned = true;
      } else if (W.getTypeMultiplier(aLey.elem, moveElem) > 1) {
        // The ground's element beats the move's element — casting fire while
        // standing in a water ley. Flat, not power-scaled: being on hostile
        // ground should sting, but stacking it to -50% would make half the
        // board unusable for half the roster.
        mod += LEY.DISCORD_ATK;
        out.discordant = true;
      }
    }
    out.atkBonus = mod;

    // ── defender's ground ──────────────────────────────────────────────────
    var dCut = 0;
    if (defender && defender.pos && !W.isFlying(defender)) {
      var dLey = leyAt(state, defender.pos.x, defender.pos.y);
      if (dLey) {
        var dEl = W.getElementsOf(defender);
        for (var i = 0; i < dEl.length; i++) {
          if (dEl[i] === dLey.elem) { dCut += LEY.ATTUNE_DEF[clampPower(dLey.power)] || 0; break; }
        }
        // 🛡 Faction ward — a Construct on metal ley, a Celestial on light.
        // Tactics, not damage output: it only ever reduces incoming.
        if (perkOn(defender, dLey) === 'ward') { dCut += LEY.PERK_WARD; out.warded = true; }
      }
    }
    out.defCut = dCut;

    // ── ⛰ high ground ──────────────────────────────────────────────────────
    // RANGED only. Two fighters in a melee scrum are not decided by the rung
    // they stand on; an archer shooting down at you plainly is. Folded into the
    // SAME clamped modifier as attunement rather than applied as its own
    // multiplier, so the two together can never exceed LEY.CAP — one ceiling
    // for everything this file contributes, which is the only way the ceiling
    // stays checkable.
    if (defender && defender.pos && dist(attacker.pos, defender.pos) > 1) {
      var dr = rungAt(state, attacker.pos.x, attacker.pos.y) - rungAt(state, defender.pos.x, defender.pos.y);
      if (dr !== 0) {
        var capped = Math.max(-LEY.ELEV_MAX_RUNGS, Math.min(LEY.ELEV_MAX_RUNGS, dr));
        out.elevRungs = capped;
        mod += capped * LEY.ELEV_PER_RUNG;
        out.atkBonus = mod;
      }
    }

    out.mul = (1 + clampMod(mod)) * (1 - clampMod(dCut));
    return out;
  }

  // Hex distance, via the wired game function. Falls back to "not adjacent" for
  // anything that is not the same tile, which keeps the high-ground rule from
  // silently applying to melee if wiring ever fails.
  function dist(a, b) {
    if (!a || !b) return 0;
    if (typeof W.distance === 'function') { try { return W.distance(a, b); } catch (e) {} }
    return (a.x === b.x && a.y === b.y) ? 0 : 2;
  }

  // ⛰ Extra knockback tiles when the target is shoved from high ground to low.
  function knockbackBonus(state, attacker, target) {
    if (!state || !attacker || !attacker.pos || !target || !target.pos) return 0;
    var dr = rungAt(state, attacker.pos.x, attacker.pos.y) - rungAt(state, target.pos.x, target.pos.y);
    return dr > 0 ? LEY.ELEV_KNOCKBACK : 0;
  }

  // Which affinity perk (if any) this unit gets from standing on this ley.
  function perkOn(unit, ley) {
    if (!unit || !ley || !ley.elem) return null;
    var f = factionsOf(unit);
    for (var i = 0; i < f.length; i++) {
      var a = AFFINITY[f[i]];
      if (a && a.home.indexOf(ley.elem) !== -1) return a.perk;
    }
    return null;
  }

  // 🕊 Extra movement from faction affinity. Called from _getMoveRangeRaw.
  function moveBonus(state, unit) {
    if (!state || !unit || !unit.pos) return 0;
    var ley = leyAt(state, unit.pos.x, unit.pos.y);
    if (!ley) return 0;
    return perkOn(unit, ley) === 'move' ? LEY.PERK_MOVE : 0;
  }

  // 🔥 Does this unit ignore this hazard, standing where it is standing?
  // Called from tickSurfaces before standDamage lands.
  function ignoresHazard(state, unit, surfaceId) {
    if (!state || !unit || !unit.pos || !surfaceId) return false;
    var ley = leyAt(state, unit.pos.x, unit.pos.y);
    if (!ley) return false;
    var f = factionsOf(unit);
    for (var i = 0; i < f.length; i++) {
      var a = AFFINITY[f[i]];
      if (!a || !a.hazard || a.home.indexOf(ley.elem) === -1) continue;
      if (a.hazard.indexOf(surfaceId) !== -1) return true;
    }
    return false;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     TERRITORY TICK — the DotR engine. Runs once per turn start, beside
     tickSurfaces, and does three things in a fixed order:

       1. CONVERT   every living unit stamps its primary element onto its tile.
                    Free, automatic, no action cost. Contested ground (a tile a
                    unit of the OTHER element is standing on) flips down first
                    and only then flips over, so taking a dug-in tile costs the
                    same turns the defender spent digging in.
       2. ENTRENCH  a unit that has held its tile since last tick pushes power
                    up one step, to POWER_MAX.
       3. DECAY     a tile nobody is standing on loses one step every
                    DECAY_TICKS. Ley left alone goes back to being ground.

     Regen affinity is paid out here too, in the same walk, because it is the
     one perk with no other natural home.

     🔴 MUTATES state.board IN PLACE and returns state, matching tickSurfaces'
     contract exactly. index.html assigns the result (`s = tickLey(s)`), so
     returning undefined here would blank the battle state — the same footgun
     _cpTickControlPoints documents at the call site.
     ══════════════════════════════════════════════════════════════════════════ */
  function tick(state, map) {
    if (!LEY.ENABLED) return state;
    if (!state || !Array.isArray(state.board)) return state;
    seed(state, map);

    var occupied = {};
    var units = Array.isArray(state.units) ? state.units : [];
    var flips = 0, healed = 0, fountClaims = [];

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u || !u.alive || !u.pos) continue;
      // 🕊 A flier is not touching the ground and neither claims nor draws from
      // it — the same rule the surface engine already applies to hazards.
      if (W.isFlying(u)) continue;

      var tile = tileAt(state, u.pos.x, u.pos.y);
      if (!tile || tile.wall) continue;
      occupied[u.pos.x + ',' + u.pos.y] = true;

      var elem = primaryElementOf(u);
      if (!elem) continue;

      var ley = tile.ley;
      if (!ley || !ley.elem) {
        // Neutral ground: claimed outright at power 1.
        tile.ley = { elem: elem, power: LEY.CONVERT_POWER, owner: u.owner, held: 1, idle: 0 };
        flips++;
      } else if (ley.elem === elem) {
        // Own ground: dig in.
        ley.power = clampPower(ley.power + LEY.ENTRENCH_STEP);
        ley.owner = u.owner;
        ley.held = (ley.held | 0) + 1;
        ley.idle = 0;
      } else {
        // Hostile ground: grind it down, then flip it. A power-3 enemy ley
        // takes three ticks to break and one to claim — which is what makes
        // holding a fount worth doing rather than something you walk past.
        ley.power = clampPower(ley.power - 1);
        ley.idle = 0;
        if (ley.power <= 0) {
          tile.ley = { elem: elem, power: LEY.CONVERT_POWER, owner: u.owner, held: 1, idle: 0 };
          flips++;
        }
      }

      // 🌱 Regen affinity, paid on the ley as it now stands.
      var lp = tile.ley;
      if (lp && perkOn(u, lp) === 'regen' && u.currentHp > 0 && u.maxHp && u.currentHp < u.maxHp) {
        u.currentHp = Math.min(u.maxHp, u.currentHp + LEY.PERK_REGEN);
        healed++;
      }

      // 🎁 Elemental boon — the other half of attunement. Paid only on ley
      // matching one of the unit's OWN elements and only once the hex is
      // entrenched to LEY.BOON_POWER, so it is earned by holding ground.
      // Re-granted every tick rather than tracked: the statuses carry
      // BOON_DURATION, so stepping off the hex lets the buff lapse on its own
      // through the game's ordinary status timer instead of needing a
      // bookkeeping pass here that could get out of step with it.
      if (lp) {
        var boon = payBoon(state, u, lp);
        if (boon && !u._leyBoonSeen) {
          u._leyBoonSeen = lp.elem;
          W.log(state, (boon.icon || '🎁') + ' ' + (u.name || 'A unit') + ' draws ' + boon.name +
                ' from the ' + (W.elementName(lp.elem) || lp.elem) + ' ley.',
                u.owner === 'player' ? 'green' : 'red');
        } else if (!boon) { u._leyBoonSeen = null; }
      } else { u._leyBoonSeen = null; }

      // 🜂 FOUNT — holding one floods the hexes around it at FOUNT_POWER. Queued
      // rather than painted here: two units of different elements can hold two
      // founts whose discs overlap, and painting inside this loop would give the
      // overlap to whichever unit happened to sit earlier in state.units — an
      // outcome decided by array order, which is not a rule anyone can play
      // around. Resolved together after the loop, where the tie can be seen.
      if (isFount(state, u.pos.x, u.pos.y)) {
        fountClaims.push({ x: u.pos.x, y: u.pos.y, elem: elem, owner: u.owner, name: u.name });
      }
    }

    // ── fount flooding ───────────────────────────────────────────────────────
    // A hex inside two rival founts' discs is CONTESTED and is left exactly as
    // it is — neither side gets it while both stand. Ties go to nobody, never to
    // whoever the loop reached first.
    if (fountClaims.length) {
      var claimed = {};
      for (var fi = 0; fi < fountClaims.length; fi++) {
        var fc = fountClaims[fi];
        for (var fy = 0; fy < state.board.length; fy++) {
          var rowLen = state.board[fy] ? state.board[fy].length : 0;
          for (var fx = 0; fx < rowLen; fx++) {
            if (dist({ x: fx, y: fy }, { x: fc.x, y: fc.y }) > LEY.FOUNT_RADIUS) continue;
            var kk = fx + ',' + fy;
            if (claimed[kk] === undefined) claimed[kk] = fc.elem;
            else if (claimed[kk] !== fc.elem) claimed[kk] = null;   // contested
          }
        }
      }
      for (var key in claimed) {
        if (!Object.prototype.hasOwnProperty.call(claimed, key)) continue;
        var ce = claimed[key];
        if (!ce) continue;
        var parts = key.split(',');
        var cx = parts[0] | 0, cy = parts[1] | 0;
        var ct = tileAt(state, cx, cy);
        if (!ct || ct.wall) continue;
        ct.ley = { elem: ce, power: LEY.FOUNT_POWER, owner: null, held: 0, idle: 0, fount: true };
        // Held ground does not decay. Without this the decay pass below would
        // count idle turns on every flooded hex and chip it to power 2 between
        // floods, so a fount the player is actively standing on would visibly
        // flicker. Released, the mark is gone and the disc decays normally.
        occupied[key] = true;
      }
      for (var fj = 0; fj < fountClaims.length; fj++) {
        W.log(state, '🜂 ' + (fountClaims[fj].name || 'A unit') + ' holds a leyline fount — the ground answers.',
              fountClaims[fj].owner === 'player' ? 'green' : 'red');
      }
    }

    // ── decay ────────────────────────────────────────────────────────────────
    var H = state.board.length;
    var Wd = (H && state.board[0]) ? state.board[0].length : 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < Wd; x++) {
        var t = state.board[y][x];
        if (!t || !t.ley || !t.ley.elem) continue;
        if (occupied[x + ',' + y]) continue;
        t.ley.held = 0;
        t.ley.idle = (t.ley.idle | 0) + 1;
        if (t.ley.idle < LEY.DECAY_TICKS) continue;
        t.ley.idle = 0;
        t.ley.power = clampPower(t.ley.power - 1);
        if (t.ley.power <= 0) delete t.ley;
      }
    }

    if (flips) W.log(state, '🜂 The leylines shift — ' + flips + ' hex' + (flips === 1 ? '' : 'es') + ' changed hands.', 'amber');
    return state;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PRESENTATION. The board must SHOW this or it does not exist: a positional
     modifier the player cannot see is a modifier they will read as the damage
     numbers being random. Returns everything the renderer needs for one hex.
     ══════════════════════════════════════════════════════════════════════════ */
  function describe(state, x, y, viewer) {
    var ley = leyAt(state, x, y);
    if (!ley) return null;
    var name = W.elementName(ley.elem) || ley.elem;
    var pips = '';
    for (var i = 0; i < clampPower(ley.power); i++) pips += '◆';
    var txt = name + ' ley ' + pips + ' (power ' + clampPower(ley.power) + ')';
    if (viewer) {
      var d = damageMod(state, viewer, null, primaryElementOf(viewer));
      if (d.attuned) txt += ' — ' + (viewer.name || 'this unit') + ' attuned: +' + Math.round(clampMod(d.atkBonus) * 100) + '% damage';
      else if (d.discordant) txt += ' — ' + (viewer.name || 'this unit') + ' discordant: ' + Math.round(clampMod(d.atkBonus) * 100) + '% damage';
      var pk = perkOn(viewer, ley);
      if (pk) txt += ' · home ground (' + pk + ')';
      var vb = (W.getElementsOf(viewer).indexOf(ley.elem) !== -1) ? boonFor(ley.elem, ley.power) : null;
      if (vb) txt += ' · ' + (vb.icon || '🎁') + ' ' + vb.name + ' — ' + vb.desc;
    }
    return { elem: ley.elem, power: clampPower(ley.power), owner: ley.owner, color: W.elementColor(ley.elem), label: txt };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     📊 CONTROL — the scoreboard for the map-painting war. Without it the
     territory fight is invisible attrition: the player can see individual
     hexes but has no way to read whether they are winning the board, which is
     the one number the whole mode is about.

     Counted by the ELEMENT under each hex matched against each side's living
     units, not by ley.owner — owner records who last flipped a hex, and a hex
     your dead unit flipped six turns ago is not yours any more. Seeded ground
     nobody has claimed correctly reads as neutral to both sides.
     ══════════════════════════════════════════════════════════════════════════ */
  function control(state) {
    var out = { player: 0, ai: 0, neutral: 0, total: 0, playerPct: 0, aiPct: 0 };
    if (!LEY.ENABLED || !state || !Array.isArray(state.board)) return out;
    var mine = {}, theirs = {};
    var units = Array.isArray(state.units) ? state.units : [];
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u || !u.alive) continue;
      var es = W.getElementsOf(u);
      for (var e = 0; e < es.length; e++) {
        if (u.owner === 'player') mine[es[e]] = 1; else theirs[es[e]] = 1;
      }
    }
    var H = state.board.length;
    var Wd = (H && state.board[0]) ? state.board[0].length : 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < Wd; x++) {
        var t = state.board[y][x];
        if (!t || t.wall) continue;
        out.total++;
        var l = t.ley;
        if (!l || !l.elem) { out.neutral++; continue; }
        var p = !!mine[l.elem], a = !!theirs[l.elem];
        // Ground both sides are attuned to counts for neither — it is as much
        // theirs as ours and calling it "controlled" would double-count it.
        if (p && !a) out.player++;
        else if (a && !p) out.ai++;
        else out.neutral++;
      }
    }
    if (out.total > 0) {
      out.playerPct = Math.round(out.player / out.total * 100);
      out.aiPct = Math.round(out.ai / out.total * 100);
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     🤖 AI TILE SCORE — what a destination is worth for reasons the attack probe
     cannot see.

     🔴 SCOPE, AND WHY IT IS THIS NARROW. The AI's destination loop already
     scores each tile by the best attack reachable from it, and that probe runs
     the real calculateDamage at the hypothetical position — which means
     attunement and high ground are ALREADY priced in on the offensive side, for
     free, today. Adding them here too would double-count them and make the AI
     over-value attuned tiles by exactly the amount it already values them.

     So this covers only the part with no attack attached: founts, territory,
     and not standing somewhere that weakens us.
     ══════════════════════════════════════════════════════════════════════════ */
  function aiTileScore(state, unit, dest) {
    if (!LEY.ENABLED || !state || !unit || !dest) return 0;
    if (W.isFlying(unit)) return 0;        // fliers neither claim nor draw
    var elem = primaryElementOf(unit);
    if (!elem) return 0;
    var sc = 0;
    var ley = leyAt(state, dest.x, dest.y);

    // 🜂 Founts first — the objective. An AI that cannot see these lets the
    // player take every one uncontested, and an objective the opponent ignores
    // is not an objective, it is decoration.
    if (isFount(state, dest.x, dest.y)) {
      if (!ley || !ley.elem) sc += LEY.AI_FOUNT_OPEN;
      else if (ley.elem === elem) sc += LEY.AI_FOUNT_HOLD;
      else sc += LEY.AI_FOUNT_ENEMY;
    }

    if (!ley || !ley.elem) {
      sc += LEY.AI_CLAIM_NEUTRAL;
    } else if (ley.elem === elem) {
      sc += LEY.AI_STAND_OWN * clampPower(ley.power);
    } else {
      // Hostile ground is worth TAKING (that is the territory war) but standing
      // on ground that beats our element while we do it is a real cost. Both
      // terms apply: grinding down a strong enemy ley is worth more, and the
      // discord penalty is what stops the AI doing it with a unit that suffers
      // for it when a better-suited one is available.
      sc += LEY.AI_CLAIM_ENEMY;
      if (W.getTypeMultiplier(ley.elem, elem) > 1) sc += LEY.AI_DISCORD;
    }
    return Math.round(sc);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     💥 BREAK — counterplay. Tears BREAK_POWER steps of ley out of a disc.
     Returns the number of hexes actually changed so the caller can decide
     whether the event is worth a log line.

     Deliberately element-agnostic: it does NOT convert the ground to the
     breaker's element, it strips it toward neutral. A break that also claimed
     would just be a stronger version of walking there, and the point of a
     counter is to deny, not to leapfrog.
     ══════════════════════════════════════════════════════════════════════════ */
  function breakLey(state, cx, cy, radius, power) {
    if (!LEY.ENABLED || !state || !Array.isArray(state.board)) return 0;
    var r = (radius == null) ? LEY.BREAK_RADIUS : (radius | 0);
    var amt = (power == null) ? LEY.BREAK_POWER : (power | 0);
    var hit = 0;
    var H = state.board.length;
    var Wd = (H && state.board[0]) ? state.board[0].length : 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < Wd; x++) {
        if (dist({ x: x, y: y }, { x: cx, y: cy }) > r) continue;
        var t = state.board[y][x];
        if (!t || !t.ley || !t.ley.elem) continue;
        t.ley.power = clampPower(t.ley.power - amt);
        t.ley.idle = 0;
        if (t.ley.power <= 0) delete t.ley;
        hit++;
      }
    }
    return hit;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     🔭 PROJECTION — "what do I get if I stand THERE?", for the move-tile
     preview. This is the piece that turns positioning into a decision instead
     of a surprise: the ley layer moves damage by up to LEY.CAP based on where a
     unit is standing, and without a projection the player can only discover
     that after committing the move.

     Returns null when the tile would change nothing, so the caller can render
     nothing rather than a row of "+0%" noise.
     ══════════════════════════════════════════════════════════════════════════ */
  function project(state, unit, dest) {
    if (!LEY.ENABLED || !state || !unit || !dest) return null;
    if (W.isFlying(unit)) return null;
    var elem = primaryElementOf(unit);
    var ley = leyAt(state, dest.x, dest.y);
    var out = { elem: null, power: 0, color: null, atk: 0, perk: null, fount: false, claims: false, rung: rungAt(state, dest.x, dest.y) };
    if (isFount(state, dest.x, dest.y)) out.fount = true;
    if (ley) {
      out.elem = ley.elem; out.power = clampPower(ley.power); out.color = W.elementColor(ley.elem);
      if (elem && ley.elem === elem) out.atk = clampMod(LEY.ATTUNE_ATK[clampPower(ley.power)] || 0);
      else if (elem && W.getTypeMultiplier(ley.elem, elem) > 1) out.atk = clampMod(LEY.DISCORD_ATK);
      out.perk = perkOn(unit, ley);
      out.claims = !!(elem && ley.elem !== elem);
      // 🎁 The boon this hex would pay THIS unit — the whole reason a player
      // walks onto their own colour rather than merely fighting from it.
      if (elem && ley.elem === elem) out.boon = boonFor(ley.elem, ley.power);
    } else if (elem) {
      out.claims = true;   // bare ground: standing here claims it
    }
    if (!out.elem && !out.fount && !out.rung && !out.claims) return null;
    return out;
  }

  global.MythicLey = {
    version: VERSION,
    LEY: LEY,
    AFFINITY: AFFINITY,
    EDITOR_SEED: EDITOR_SEED,
    SURF_SEED: SURF_SEED,
    wire: wire,
    seed: seed,
    tick: tick,
    at: leyAt,
    damageMod: damageMod,
    moveBonus: moveBonus,
    ignoresHazard: ignoresHazard,
    perkOn: perkOn,
    describe: describe,
    founts: founts,
    isFount: isFount,
    rungAt: rungAt,
    knockbackBonus: knockbackBonus,
    reactionFor: reactionFor,
    REACTIONS: REACTIONS,
    control: control,
    aiTileScore: aiTileScore,
    breakLey: breakLey,
    project: project,
    ELEM_BOON: ELEM_BOON,
    boonFor: boonFor,
    isAnchored: isAnchored,
    enabled: function () { return !!LEY.ENABLED; },
    configure: function (o) {
      if (!o) return;
      if (typeof o.enabled === 'boolean') LEY.ENABLED = o.enabled;
      if (isFinite(o.intensity)) LEY.INTENSITY = Math.max(0, Math.min(3, +o.intensity));
    },
  };
})(typeof window !== 'undefined' ? window : this);
