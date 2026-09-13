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
  function clampMod(m) {
    if (!isFinite(m)) return 0;
    return Math.max(-LEY.CAP, Math.min(LEY.CAP, m));
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
    }
    return { elem: ley.elem, power: clampPower(ley.power), owner: ley.owner, color: W.elementColor(ley.elem), label: txt };
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
  };
})(typeof window !== 'undefined' ? window : this);
