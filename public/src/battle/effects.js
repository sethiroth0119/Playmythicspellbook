/* ============================================================================
 * Mythic Spellbook — battle effect types, round 2.   public/src/battle/effects.js
 * ----------------------------------------------------------------------------
 * Three NEW mechanics, authored here rather than in index.html per the
 * architecture rule ("new features go in public/src/<feature>/"):
 *
 *   ⛽ FUEL          — a unit burns one Fuel counter at the end of every one of
 *                      its owner's turns. Hitting 0 DESTROYS it. Between ticks
 *                      a unit sitting at 0 is stalled (cannot move or act); in
 *                      ordinary play it never survives to be seen that way,
 *                      because the end-of-turn sweep destroys it in the same
 *                      pass that emptied it. HEROES are the one exception —
 *                      they stall instead of dying, for the same reason every
 *                      other destroy effect in the game exempts them: hero
 *                      death is the loss condition, and losing the match to a
 *                      counter running out is not a play anyone can answer.
 *   🟢 FUEL RESTORE  — an aura unit. Every ALLY (itself included) inside its
 *                      green circle is topped back up to full at the end of the
 *                      owner's turn.
 *                      ⚠ ORDER MATTERS AND IT IS BURN → RESTORE → DESTROY.
 *                      Destroying on the burn would kill a 1-tank unit standing
 *                      in the circle before the circle could refill it, which
 *                      makes Fuel Restore useless for exactly the units that
 *                      need it most. Only a unit still empty AFTER the refill
 *                      is destroyed, so the circle is a real lifeline at every
 *                      tank size.
 *   🌊 SEA           — a deep-water surface. Ground units cannot enter it at
 *                      all. Fliers pass over and stay hittable by anything that
 *                      can already hit a flier. An AQUATIC unit standing in the
 *                      Sea is untouchable except by STORM-element moves.
 *   🔵 COUNTERS      — Yu-Gi-Oh-style named counters (Spell Counters, Charge
 *                      Counters, …). ANY card type can hold them — units,
 *                      locations, walls, traps, enchantments — and a card may
 *                      hand them to itself or to other cards. A card that
 *                      declares `canCounter` can then REMOVE them to pay for a
 *                      negation instead of paying energy.
 *
 * 🔴 WHY THIS FILE TOUCHES NO GLOBALS
 * `PASSIVES`, `SURFACE_TYPES`, `hasPassive`, `App` and friends are top-level
 * `const` declarations inside index.html — lexical globals that are NOT on
 * `window`, so nothing here can see them (the globals trap; see CLAUDE.md).
 * Rather than build a bridge for it, every predicate below reads PLAIN DATA off
 * the objects it is handed: `unit.passives` (an array), `unit.factions` (an
 * array), `tile.surface.type` (a string). That keeps this file loadable in any
 * order relative to index.html and impossible to break by renaming a const.
 *
 * All state lives on the battle state object so it travels with save / load /
 * multiplayer snapshots exactly like `state.board[y][x].surface` does:
 *   state._counters = { '<holderKey>': { '<tokenId>': n } }
 *   unit.fuel       = { left, max }
 *
 * Every entry point is total: bad input returns a harmless value, never throws.
 * Battle code calls these from inside `try` blocks anyway, but a mechanic that
 * silently no-ops is far better than one that strands a turn.
 * ==========================================================================*/
(function (global) {
  'use strict';
  if (!global) return;

  // ── shared plain-data helpers ─────────────────────────────────────────────
  // Mirrors index.html's `hasPassive`, including its field-negation rule: a
  // unit nullified by negateField has NO passives while the negation holds.
  function hasP(unit, id) {
    if (!unit || !id) return false;
    if ((unit._negatedTurns | 0) > 0 || unit._negatedBy) return false;
    if (Array.isArray(unit.passives)) return unit.passives.indexOf(id) >= 0;
    return unit.passive === id;
  }
  function cheb(a, b) {
    if (!a || !b) return Infinity;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  function alive(u) { return !!(u && u.alive && u.pos); }
  function pushLog(state, msg, color) {
    try { (state.log = state.log || []).push({ msg: msg, color: color || 'amber' }); } catch (e) {}
  }

  // ==========================================================================
  // ⛽ FUEL
  // ==========================================================================
  // Three authorable strengths, exactly as specced: one, two or three counters.
  // Kept as three separate passives rather than one passive + a number field
  // because PASSIVES entries carry no per-card parameters — the picker in the
  // Forge is a flat dropdown, so the tank size has to BE the passive.
  var FUEL_PASSIVES = { fuel1: 1, fuel2: 2, fuel3: 3 };
  var FUEL_RESTORE_RADIUS = 2;   // Chebyshev — the green circle's reach.

  var Fuel = {
    PASSIVES: FUEL_PASSIVES,
    RESTORE_RADIUS: FUEL_RESTORE_RADIUS,

    /* Tank size for this unit, or 0 when it does not run on fuel. */
    maxFor: function (unit) {
      if (!unit) return 0;
      for (var id in FUEL_PASSIVES) {
        if (Object.prototype.hasOwnProperty.call(FUEL_PASSIVES, id) && hasP(unit, id)) return FUEL_PASSIVES[id];
      }
      return 0;
    },

    uses: function (unit) { return Fuel.maxFor(unit) > 0; },

    /* Lazily seed `unit.fuel` from the passive. Deliberately lazy instead of
       seeded in buildUnit: a Kalon transform, a clone, a revive and a
       multiplayer snapshot all produce units that never went through
       buildUnit, and every one of them still needs a full tank. Mutates in
       place — units are spread-copied constantly, and a fresh copy that lost
       its fuel would silently refill. */
    ensure: function (unit) {
      var max = Fuel.maxFor(unit);
      if (!max) { if (unit && unit.fuel) unit.fuel = null; return null; }
      if (!unit.fuel || typeof unit.fuel !== 'object' || (unit.fuel.max | 0) !== max) {
        unit.fuel = { left: max, max: max };
      }
      return unit.fuel;
    },

    left: function (unit) { var f = Fuel.ensure(unit); return f ? (f.left | 0) : 0; },

    /* Sitting at 0 fuel: no movement, no attacks. Reaching 0 at end of turn is
       DEATH (see tickSide), so in ordinary play nothing is ever seen in this
       state. It still exists, and the engine still gates on it, for two cases
       the destroy sweep does not cover: a hero, which is exempt from the
       destruction, and any future effect that drains fuel mid-turn — such a
       unit is inert until the sweep or a refuel reaches it, rather than
       acting on an empty tank. */
    isStalled: function (unit) { return Fuel.uses(unit) && Fuel.left(unit) <= 0; },

    /* Radius of a unit's green Fuel Restore circle, 0 when it has none. */
    restoreRadius: function (unit) {
      return hasP(unit, 'fuelRestore') ? FUEL_RESTORE_RADIUS : 0;
    },

    /* Every tile covered by a living Fuel Restore aura, for the board renderer.
       Returns [{ x, y, owner }] — the owner drives which side's green it is. */
    auraTiles: function (state) {
      var out = [];
      try {
        var units = (state && state.units) || [];
        for (var i = 0; i < units.length; i++) {
          var u = units[i];
          if (!alive(u)) continue;
          var r = Fuel.restoreRadius(u);
          if (!r) continue;
          for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
            out.push({ x: u.pos.x + dx, y: u.pos.y + dy, owner: u.owner });
          }
        }
      } catch (e) {}
      return out;
    },

    /* END OF `owner`'s TURN, in three phases: BURN → RESTORE → DESTROY.
       See the ORDER MATTERS note at the top of the file for why the destroy
       sweep runs last rather than folding into the burn.

       Units that ran out are marked dead here (alive:false, currentHp:0) and
       ALSO listed on `state._fuelKilled`. The caller in index.html reads that
       list and runs each one through `_battleOnUnitKilled`, because the death
       pipeline — panic rolls, ultimate charge, bond XP, on-death triggers —
       lives in index.html's lexical scope and nothing in this file can see it.
       Marking dead without firing that pipeline would produce a corpse the
       rest of the game never learns about.

       Mutates `state.units` in place and returns the state. */
    tickSide: function (state, owner) {
      try {
        var units = (state && state.units) || [];
        var i, u;
        state._fuelKilled = [];
        // 1) BURN one counter from every fuelled unit on this side.
        for (i = 0; i < units.length; i++) {
          u = units[i];
          if (!alive(u) || u.owner !== owner || !Fuel.uses(u)) continue;
          var f = Fuel.ensure(u);
          if (f.left <= 0) continue;
          f.left = Math.max(0, f.left - 1);
        }
        // 2) RESTORE — refill anything inside a friendly green circle. This is
        //    the last chance an empty unit gets before the sweep below.
        var sources = [];
        for (i = 0; i < units.length; i++) {
          u = units[i];
          if (alive(u) && u.owner === owner && Fuel.restoreRadius(u)) sources.push(u);
        }
        if (sources.length) {
          var refilled = 0, rescued = 0;
          for (i = 0; i < units.length; i++) {
            u = units[i];
            if (!alive(u) || u.owner !== owner || !Fuel.uses(u)) continue;
            var inCircle = false;
            for (var j = 0; j < sources.length; j++) {
              if (cheb(u.pos, sources[j].pos) <= Fuel.restoreRadius(sources[j])) { inCircle = true; break; }
            }
            if (!inCircle) continue;
            var fu = Fuel.ensure(u);
            if (fu.left >= fu.max) continue;
            if (fu.left === 0) rescued++;
            fu.left = fu.max;
            refilled++;
          }
          if (refilled) {
            pushLog(state, '🟢 Fuel Restore tops up ' + refilled + ' unit' + (refilled === 1 ? '' : 's') + ' to full'
                    + (rescued ? ' — ' + rescued + ' pulled back from an empty tank.' : '.'),
                    owner === 'player' ? 'green' : 'red');
          }
        }
        // 3) DESTROY anything still empty. Heroes are exempt (they stall), the
        //    same carve-out every other destroy effect in the game makes.
        for (i = 0; i < units.length; i++) {
          u = units[i];
          if (!alive(u) || u.owner !== owner || !Fuel.uses(u)) continue;
          if (Fuel.ensure(u).left > 0) continue;
          if (u.isHero) {
            pushLog(state, '⛽ ' + (u.name || 'The hero') + ' is out of Fuel — stalled until refuelled.',
                    owner === 'player' ? 'red' : 'green');
            continue;
          }
          u.alive = false;
          u.currentHp = 0;
          state._fuelKilled.push(u.id);
          pushLog(state, '⛽💥 ' + (u.name || 'A unit') + ' runs dry and is DESTROYED.',
                  owner === 'player' ? 'red' : 'green');
        }
      } catch (e) { try { console.warn('[fuel] tick failed', e); } catch (_) {} }
      return state;
    },

    /* Manual refuel — used by the Refuel on-play effect and by anything else
       that wants to top a unit up. Returns how many counters were added. */
    refuel: function (unit, amount) {
      var f = Fuel.ensure(unit);
      if (!f) return 0;
      var want = (amount == null) ? f.max : Math.max(0, amount | 0);
      var before = f.left;
      f.left = Math.min(f.max, f.left + want);
      return f.left - before;
    },
  };

  // ==========================================================================
  // 🌊 SEA
  // ==========================================================================
  var Sea = {
    TYPE: 'sea',

    isSeaTile: function (state, x, y) {
      try {
        var row = state && state.board && state.board[y];
        var t = row && row[x];
        return !!(t && t.surface && t.surface.type === 'sea');
      } catch (e) { return false; }
    },

    /* Aquatic is a FACTION in this game (FACTIONS: 'aquatic'), not a flag, so
       the test reads the faction list. `amphibious` is the explicit opt-in for
       anything that should wade without being a fish. */
    isAquatic: function (unit) {
      if (!unit) return false;
      if (Array.isArray(unit.factions) && unit.factions.indexOf('aquatic') >= 0) return true;
      return hasP(unit, 'amphibious');
    },

    /* Fliers pass over. `flockFlight` deliberately does NOT count here: it is a
       conditional flight granted by nearby birds and it can evaporate mid-path,
       which would strand a unit in open water with nowhere legal to stand. */
    isFlier: function (unit) { return !!(unit && unit.flying); },

    /* May this unit stand on the Sea at all? */
    canEnter: function (unit) { return Sea.isFlier(unit) || Sea.isAquatic(unit); },

    /* Movement gate used by getValidMoves / getMovePath. TRUE = keep out. */
    blocksMove: function (state, unit, x, y) {
      return Sea.isSeaTile(state, x, y) && !Sea.canEnter(unit);
    },

    /* THE aquatic rule: a fish in deep water cannot be attacked AT ALL — only
       Storm-element moves reach it. A FLYING unit over the Sea is NOT hidden;
       it keeps the ordinary flying rules (ranged and magic still hit it), which
       is why this checks `isAquatic` and not `canEnter`.
       Returns true when the attack must be refused. */
    hidesFromAttack: function (state, target, move, attacker) {
      try {
        if (!target || !target.pos) return false;
        if (attacker && attacker.id === target.id) return false;   // never block self-targeting
        if (!Sea.isAquatic(target)) return false;
        if (Sea.isFlier(target)) return false;                     // aloft, not submerged
        if (!Sea.isSeaTile(state, target.pos.x, target.pos.y)) return false;
        return !move || move.element !== 'storm';
      } catch (e) { return false; }
    },

    /* Soak up surface tiles in a Chebyshev radius. `type` null = every surface.
       Returns the number of tiles drained. Mutates state.board in place, which
       is what _paintSurface / _clearSurface already do. */
    absorb: function (state, cx, cy, radius, type) {
      var drained = 0;
      try {
        var b = state && state.board;
        if (!Array.isArray(b)) return 0;
        var r = Math.max(0, radius | 0);
        for (var y = cy - r; y <= cy + r; y++) {
          if (!Array.isArray(b[y])) continue;
          for (var x = cx - r; x <= cx + r; x++) {
            var t = b[y][x];
            if (!t || !t.surface || !t.surface.type) continue;
            if (type && t.surface.type !== type) continue;
            delete b[y][x].surface;
            drained++;
          }
        }
      } catch (e) {}
      return drained;
    },
  };

  // ==========================================================================
  // 🔵 COUNTERS
  // ==========================================================================
  // A card declares ONE counter kind in its `counterToken` block:
  //
  //   card.counterToken = {
  //     id, name, icon,
  //     start,        // counters it enters play holding
  //     max,          // cap (0 = uncapped)
  //     grantTo,      // 'self' | 'allies' | 'enemies' | 'any'  — who it may give to
  //     grantAmount,  // how many it hands out per grant
  //     grantOn,      // 'never' | 'onPlay' | 'turnEnd'
  //     canCounter,   // may these be REMOVED to pay for a negation?
  //     counterCost,  // how many to remove for one negation
  //     counterTargets// [] of COUNTER_TRIGGERS ids it may answer
  //   }
  //
  // Counters live in `state._counters`, NOT on the card objects, because
  // locations / weather / enchantments are re-created from their card data on
  // every perspective swap and multiplayer snapshot — a count stored on the
  // card itself would be silently reset. Units go through the same map so
  // there is exactly ONE place a counter can be.
  var DEFAULT_TOKEN = {
    id: 'charge', name: 'Counter', icon: '🔵',
    start: 0, max: 0,
    grantTo: 'self', grantAmount: 1, grantOn: 'never',
    canCounter: false, counterCost: 1, counterTargets: [],
  };

  var Counters = {
    DEFAULTS: DEFAULT_TOKEN,

    /* Normalise a card's / unit's authored counter block. Returns null when the
       card does not use counters at all. */
    tokenOf: function (entity) {
      if (!entity) return null;
      var raw = entity.counterToken;
      if (!raw || typeof raw !== 'object') return null;
      var t = {};
      for (var k in DEFAULT_TOKEN) if (Object.prototype.hasOwnProperty.call(DEFAULT_TOKEN, k)) t[k] = DEFAULT_TOKEN[k];
      for (var k2 in raw) if (Object.prototype.hasOwnProperty.call(raw, k2)) t[k2] = raw[k2];
      t.id = String(t.id || 'charge');
      t.name = String(t.name || 'Counter');
      t.start = Math.max(0, t.start | 0);
      t.max = Math.max(0, t.max | 0);
      t.grantAmount = Math.max(0, t.grantAmount | 0);
      t.counterCost = Math.max(1, t.counterCost | 0);
      if (!Array.isArray(t.counterTargets)) t.counterTargets = [];
      return t;
    },

    /* Stable key for anything that can hold counters. Units key by their battle
       instance id; card-shaped permanents get a kind prefix so a location and a
       unit built from the same card id can never collide. */
    key: function (holder, kind) {
      if (!holder) return '';
      if (typeof holder === 'string') return (kind ? kind + ':' : 'unit:') + holder;
      if (holder.id && (holder.pos || holder.isHero || holder.isWall) && !kind) return 'unit:' + holder.id;
      var k = kind || holder._counterKind || (holder.type ? holder.type : 'card');
      return k + ':' + String(holder.instanceId || holder.id || holder.cardId || 'anon');
    },

    _bag: function (state, create) {
      if (!state) return null;
      if (!state._counters || typeof state._counters !== 'object') {
        if (!create) return null;
        state._counters = {};
      }
      return state._counters;
    },

    /* Read. Seeds from `token.start` the first time a holder is asked about,
       so "enters play with 2 counters" needs no summon-time hook. */
    get: function (state, holder, tokenId, kind) {
      try {
        var key = Counters.key(holder, kind);
        if (!key) return 0;
        var tok = (typeof holder === 'object') ? Counters.tokenOf(holder) : null;
        var id = tokenId || (tok && tok.id) || DEFAULT_TOKEN.id;
        var bag = Counters._bag(state, true);
        var slot = bag[key];
        if (!slot) {
          slot = bag[key] = {};
          if (tok && tok.start > 0) slot[tok.id] = tok.start;
        }
        return slot[id] | 0;
      } catch (e) { return 0; }
    },

    /* Add (or, with a negative n, remove). Honours the token's `max` cap and
       never goes below zero. Returns the count actually applied. */
    add: function (state, holder, n, tokenId, kind) {
      try {
        var key = Counters.key(holder, kind);
        if (!key) return 0;
        var tok = (typeof holder === 'object') ? Counters.tokenOf(holder) : null;
        var id = tokenId || (tok && tok.id) || DEFAULT_TOKEN.id;
        var have = Counters.get(state, holder, id, kind);
        var want = have + (n | 0);
        if (want < 0) want = 0;
        if (tok && tok.max > 0 && want > tok.max) want = tok.max;
        Counters._bag(state, true)[key][id] = want;
        return want - have;
      } catch (e) { return 0; }
    },

    remove: function (state, holder, n, tokenId, kind) {
      return -Counters.add(state, holder, -Math.abs(n | 0), tokenId, kind);
    },

    /* Every counter of `tokenId` this side controls, across units AND
       card-shaped permanents. Used to answer "can you pay this?". */
    totalFor: function (state, owner, tokenId) {
      var total = 0;
      try {
        var units = (state && state.units) || [];
        for (var i = 0; i < units.length; i++) {
          var u = units[i];
          if (!alive(u) || u.owner !== owner) continue;
          total += Counters.get(state, u, tokenId);
        }
        var perms = Counters.permanentsFor(state, owner);
        for (var j = 0; j < perms.length; j++) {
          total += Counters.get(state, perms[j].card, tokenId, perms[j].kind);
        }
      } catch (e) {}
      return total;
    },

    /* Card-shaped permanents on a side that can hold counters. Location cards,
       enchantments/curses and the active weather are all real, addressable
       objects on the battle state — the spec's "location cards can have
       counters" is exactly this list. */
    permanentsFor: function (state, owner) {
      var out = [];
      try {
        if (state && state.activeLocation) {
          var loc = state.activeLocation;
          if (!owner || !loc.owner || loc.owner === owner) out.push({ card: loc, kind: 'location' });
        }
        var ench = (state && state.enchantments) || [];
        for (var i = 0; i < ench.length; i++) {
          var e = ench[i];
          if (!e) continue;
          if (owner && e.owner && e.owner !== owner) continue;
          out.push({ card: e, kind: 'enchantment' });
        }
        if (state && state.weather && state.weather.id) out.push({ card: state.weather, kind: 'weather' });
      } catch (e) {}
      return out;
    },

    /* Spend `n` counters of `tokenId` from anywhere `owner` controls, draining
       the fullest holder first so a single big stack is used up before the
       change is broken across several small ones. Returns TRUE only if the
       FULL cost was paid — a partial payment is rolled back, because a
       half-paid negation would eat counters and still let the action through. */
    pay: function (state, owner, tokenId, n) {
      var need = Math.max(0, n | 0);
      if (!need) return true;
      var holders = [];
      try {
        var units = (state && state.units) || [];
        for (var i = 0; i < units.length; i++) {
          var u = units[i];
          if (alive(u) && u.owner === owner) holders.push({ h: u, kind: null });
        }
        var perms = Counters.permanentsFor(state, owner);
        for (var j = 0; j < perms.length; j++) holders.push({ h: perms[j].card, kind: perms[j].kind });
      } catch (e) { return false; }

      var have = 0, k;
      for (k = 0; k < holders.length; k++) have += Counters.get(state, holders[k].h, tokenId, holders[k].kind);
      if (have < need) return false;

      holders.sort(function (a, b) {
        return Counters.get(state, b.h, tokenId, b.kind) - Counters.get(state, a.h, tokenId, a.kind);
      });
      var left = need;
      for (k = 0; k < holders.length && left > 0; k++) {
        var got = Counters.get(state, holders[k].h, tokenId, holders[k].kind);
        var take = Math.min(got, left);
        if (!take) continue;
        Counters.add(state, holders[k].h, -take, tokenId, holders[k].kind);
        left -= take;
      }
      return left === 0;
    },

    /* Can this card negate right now by REMOVING counters instead of paying
       energy? `trigger` is the COUNTER_TRIGGERS id of the action being
       answered — an empty `counterTargets` list means "answers anything it is
       already a legal counter for". */
    canPayWithCounters: function (state, owner, card, trigger) {
      try {
        var tok = Counters.tokenOf(card);
        if (!tok || !tok.canCounter) return false;
        if (trigger && tok.counterTargets.length && tok.counterTargets.indexOf(trigger) < 0) return false;
        return Counters.totalFor(state, owner, tok.id) >= tok.counterCost;
      } catch (e) { return false; }
    },

    /* Charge the counter cost for a negation. Returns TRUE when it was paid
       (and the caller must then NOT charge energy). */
    payForCounter: function (state, owner, card) {
      try {
        var tok = Counters.tokenOf(card);
        if (!tok || !tok.canCounter) return false;
        if (!Counters.pay(state, owner, tok.id, tok.counterCost)) return false;
        pushLog(state, '🔵 ' + (card.name || 'A card') + ' removes ' + tok.counterCost + ' '
                + tok.name + (tok.counterCost === 1 ? '' : 's') + ' to counter.',
                owner === 'player' ? 'green' : 'red');
        return true;
      } catch (e) { return false; }
    },

    /* Who a granting card may hand counters to. */
    _grantTargets: function (state, source, tok) {
      var out = [];
      try {
        if (tok.grantTo === 'self') return [{ h: source, kind: null }];
        var units = (state && state.units) || [];
        for (var i = 0; i < units.length; i++) {
          var u = units[i];
          if (!alive(u)) continue;
          if (tok.grantTo === 'allies' && u.owner !== source.owner) continue;
          if (tok.grantTo === 'enemies' && u.owner === source.owner) continue;
          out.push({ h: u, kind: null });
        }
        // Card-shaped permanents are legal recipients too — that is the whole
        // point of "not just units, as location cards can have counters".
        if (tok.grantTo === 'allies' || tok.grantTo === 'any') {
          var perms = Counters.permanentsFor(state, source.owner);
          for (var j = 0; j < perms.length; j++) out.push({ h: perms[j].card, kind: perms[j].kind });
        }
      } catch (e) {}
      return out;
    },

    /* END OF `owner`'s TURN — every card of theirs whose token grants on
       'turnEnd' hands out its counters. */
    grantTick: function (state, owner) {
      try {
        var units = (state && state.units) || [];
        for (var i = 0; i < units.length; i++) {
          var u = units[i];
          if (!alive(u) || u.owner !== owner) continue;
          var tok = Counters.tokenOf(u);
          if (!tok || tok.grantOn !== 'turnEnd' || !tok.grantAmount) continue;
          var targets = Counters._grantTargets(state, u, tok);
          var placed = 0;
          for (var j = 0; j < targets.length; j++) {
            placed += Counters.add(state, targets[j].h, tok.grantAmount, tok.id, targets[j].kind);
          }
          if (placed) {
            pushLog(state, (tok.icon || '🔵') + ' ' + (u.name || 'A card') + ' places ' + placed + ' '
                    + tok.name + (placed === 1 ? '' : 's') + '.', owner === 'player' ? 'green' : 'red');
          }
        }
      } catch (e) { try { console.warn('[counters] grant tick failed', e); } catch (_) {} }
      return state;
    },

    /* Everything a holder is carrying, as [{ id, n }] — for board badges and
       the unit detail panel. */
    listOn: function (state, holder, kind) {
      var out = [];
      try {
        var bag = Counters._bag(state, false);
        if (!bag) return out;
        var slot = bag[Counters.key(holder, kind)];
        if (!slot) return out;
        for (var id in slot) {
          if (!Object.prototype.hasOwnProperty.call(slot, id)) continue;
          if ((slot[id] | 0) > 0) out.push({ id: id, n: slot[id] | 0 });
        }
      } catch (e) {}
      return out;
    },
  };

  global.MythicFuel = Fuel;
  global.MythicSea = Sea;
  global.MythicCounters = Counters;
  global.MythicFX = { fuel: Fuel, sea: Sea, counters: Counters, version: 'effects-1.0.0' };
})(typeof window !== 'undefined' ? window : this);
