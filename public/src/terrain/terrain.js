/* ═══════════════════════════════════════════════════════════════════════════
   MythicTerrain — elemental terrain for the battle board.          v1.0.0

   THE RULE (the whole system, in four lines)
     • Every tile carries one element (or none).
     • A unit standing on its OWN element is EMPOWERED: +25% ATK/DEF/MAG/RES.
     • A unit standing on ground whose element BEATS one of its elements
       (per STRONG_VS) is HINDERED: −25% to the same four stats.
     • Flyers ignore terrain. Labyrinth tiles block movement and placement.
   Plus FLUX: every few turns a handful of tiles change to a new terrain, so
   good ground never stays good for long and positioning is a live decision.

   HOW IT PLUGS IN (see INTEGRATION.md for the exact lines)
     Data lives on the board the engine already has — `state.board[y][x].terrain`
     — exactly the way surfaces live on `.surface`. So it serialises with the
     match state, survives rewind, and syncs over multiplayer for free.
     The host calls FIVE things:
       MythicTerrain.configure({ strongVs: STRONG_VS })     once, at boot
       MythicTerrain.seed(state, { rng, protect })          when a match is built
       MythicTerrain.statBonus(unit, key, base, state)      inside getStatBonus
       MythicTerrain.blocks(state, x, y)                    in move + placement
       MythicTerrain.tick(state, { rng })                   in startTurn (flux)
     and paints with MythicTerrain.cellHtml / cellClass in renderBoard.

   WHY AN IIFE ON window AND NOT AN ES MODULE
     The battle engine is one inline classic <script> in index.html, and it
     calls these helpers SYNCHRONOUSLY from getStatBonus / getValidMoves. An ES
     module loads deferred, after that script has already run — the engine
     would see `undefined` on the first battle. public/src/battle/combat.js
     (FEBattle) had the same problem and solved it the same way: a classic
     script that assigns one global. Every host call site is written
     `typeof MythicTerrain !== 'undefined' && …`, so if this file fails to
     load the game plays exactly as it does today, with no terrain.

   PURITY
     No DOM reads, no App.*, no Math.random. Randomness comes in as `rng`
     (a function returning [0,1)) so the server can be the only roller.
     STRONG_VS is INJECTED via configure() because it is a top-level `const`
     in index.html — a lexical binding this file cannot see (CLAUDE.md, the
     globals trap).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* ─── Tunables. One object, so balance lives in one place. ─────────────── */
  var RULES = {
    BOOST: 0.25,          // Empowered / Hindered magnitude
    STATS: ['atk', 'def', 'mag', 'res'],   // stats terrain touches (never hp / spd)
    BLOBS_MIN: 3, BLOBS_MAX: 4,            // terrain patches per board
    BLOB_MIN: 3, BLOB_MAX: 6,              // tiles per patch
    WALLS_MIN: 1, WALLS_MAX: 2,            // labyrinth tiles per board
    MIRROR: true,                          // top↔bottom symmetry so neither side gets better ground
    FLUX_EVERY: 2,                         // shift every N turns (both sides' turns count)
    FLUX_COUNT: 2,                         // tiles that change per shift
    FLUX_WALL_CHANCE: 0.08,                // chance a shifted tile becomes a labyrinth wall
    FLUX_NEIGHBOUR_BIAS: 0.6,              // chance a shifted tile copies a neighbour (patches drift rather than sparkle)
  };

  /* ─── Catalog. `element` is the Mythic element the ground answers to. ───── */
  var TERRAINS = {
    plain:      { id: 'plain',      name: 'Plain',        icon: '',   element: null,     hue: 40,  desc: 'Open ground. No effect.' },
    meadow:     { id: 'meadow',     name: 'Meadow',       icon: '🌾', element: 'light',  hue: 58,  desc: 'Sunlit field — Light ground.' },
    forest:     { id: 'forest',     name: 'Forest',       icon: '🌲', element: 'nature', hue: 120, desc: 'Deep woods — Nature ground.' },
    mountain:   { id: 'mountain',   name: 'Mountain',     icon: '⛰️', element: 'earth',  hue: 25,  desc: 'High stone — Earth ground.' },
    sea:        { id: 'sea',        name: 'Sea',          icon: '🌊', element: 'water',  hue: 205, desc: 'Open water — Water ground.' },
    ashland:    { id: 'ashland',    name: 'Ashland',      icon: '🔥', element: 'fire',   hue: 8,   desc: 'Scorched cinders — Fire ground.' },
    marsh:      { id: 'marsh',      name: 'Umbral Marsh', icon: '🌑', element: 'shadow', hue: 268, desc: 'Lightless bog — Shadow ground.' },
    cliffs:     { id: 'cliffs',     name: 'Windcliffs',   icon: '🌬️', element: 'wind',   hue: 172, desc: 'Howling heights — Wind ground.' },
    stormfield: { id: 'stormfield', name: 'Stormfield',   icon: '⚡', element: 'storm',  hue: 232, desc: 'Charged ground — Storm ground.' },
    glacier:    { id: 'glacier',    name: 'Glacier',      icon: '❄️', element: 'ice',    hue: 190, desc: 'Ancient ice — Ice ground.' },
    ironfield:  { id: 'ironfield',  name: 'Ironfield',    icon: '⚙️', element: 'metal',  hue: 210, desc: 'Rust and slag — Metal ground.' },
    labyrinth:  { id: 'labyrinth',  name: 'Labyrinth',    icon: '🧱', element: null,     hue: 0,   desc: 'Impassable wall.', blocked: true },
  };
  // Terrains the generator and flux may choose from (walls handled separately).
  var ELEMENTAL = Object.keys(TERRAINS).filter(function (k) { return TERRAINS[k].element; });

  var cfg = { strongVs: null, getElements: null };

  /* ─── configure({ strongVs, getElements? }) ─────────────────────────────
     strongVs:    the engine's STRONG_VS table ({ fire: ['nature', …], … }).
     getElements: optional (unit) → string[]; defaults to unit.elements /
                  unit.element, which is what getElementsOf does upstream. */
  function configure(opts) {
    opts = opts || {};
    if (opts.strongVs) cfg.strongVs = opts.strongVs;
    if (typeof opts.getElements === 'function') cfg.getElements = opts.getElements;
    if (opts.rules) for (var k in opts.rules) if (Object.prototype.hasOwnProperty.call(RULES, k)) RULES[k] = opts.rules[k];
    return api;
  }

  function elementsOf(unit) {
    if (!unit) return [];
    if (cfg.getElements) { try { return cfg.getElements(unit) || []; } catch (e) { return []; } }
    if (Array.isArray(unit.elements) && unit.elements.length) return unit.elements;
    if (unit.element) return [unit.element];
    return [];
  }

  /* ─── Board access. Same shape as _surfaceAt / _setSurface. ─────────────── */
  function dims(state) {
    var H = (state && Array.isArray(state.board)) ? state.board.length : 0;
    var W = (H && state.board[0]) ? state.board[0].length : 0;
    return { W: W, H: H };
  }
  function at(state, x, y) {
    if (!state || !state.board || !state.board[y] || !state.board[y][x]) return null;
    return state.board[y][x].terrain || null;
  }
  function def(state, x, y) { var t = at(state, x, y); return t ? TERRAINS[t] || null : null; }
  function set(state, x, y, id) {
    if (!state || !state.board || !state.board[y] || !state.board[y][x]) return;
    if (!id || id === 'plain') delete state.board[y][x].terrain;
    else state.board[y][x].terrain = id;
  }
  function blocks(state, x, y) { var d = def(state, x, y); return !!(d && d.blocked); }
  function occupied(state, x, y) {
    if (!state || !Array.isArray(state.units)) return false;
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u && u.alive !== false && u.pos && u.pos.x === x && u.pos.y === y) return true;
    }
    return false;
  }
  function hasAnything(state, x, y) {
    // Never overwrite a tile that carries something else the engine placed
    // (location marker, trap, event, wall, tombstone) — those systems own it.
    var t = state.board[y][x];
    return !!(t.location || t.trap || t.event || t.wall || t.tombstone);
  }

  /* ─── The rule ───────────────────────────────────────────────────────────
     effect(unit, state) → +1 Empowered, −1 Hindered, 0 nothing.
     Empowered wins if both apply (a Nature/Water unit on Forest is at home).
     Flyers, leaders/heroes with no element, and off-board units get 0. */
  function effect(unit, state) {
    if (!unit || !unit.pos || unit.flying) return 0;
    var d = def(state, unit.pos.x, unit.pos.y);
    if (!d || !d.element) return 0;
    var els = elementsOf(unit);
    if (!els.length) return 0;
    if (els.indexOf(d.element) !== -1) return 1;
    var beats = cfg.strongVs && cfg.strongVs[d.element];
    if (beats) for (var i = 0; i < els.length; i++) if (beats.indexOf(els[i]) !== -1) return -1;
    return 0;
  }

  /* statBonus(unit, statKey, baseValue, state) → additive delta for getStatBonus.
     Computed off the BASE stat (unit.stats[key]) so it stacks additively with
     the other flat bonuses rather than compounding on them — the same choice
     the continuous-aura system makes upstream. */
  function statBonus(unit, statKey, baseValue, state) {
    if (RULES.STATS.indexOf(statKey) === -1) return 0;
    var e = effect(unit, state);
    if (!e) return 0;
    var base = (typeof baseValue === 'number') ? baseValue : ((unit.stats && unit.stats[statKey]) || 0);
    return e * Math.floor(base * RULES.BOOST);
  }

  /* describe(unit, state) → { effect, terrain, label, title } for a unit panel. */
  function describe(unit, state) {
    var d = unit && unit.pos ? def(state, unit.pos.x, unit.pos.y) : null;
    var e = effect(unit, state);
    var pct = Math.round(RULES.BOOST * 100);
    var label = e > 0 ? 'Empowered +' + pct + '%' : e < 0 ? 'Hindered −' + pct + '%' : (unit && unit.flying && d && d.element ? 'Flying — unaffected' : '');
    return { effect: e, terrain: d, label: label,
      title: d ? d.name + (label ? ' — ' + label : '') : '' };
  }

  /* ─── Seeding ────────────────────────────────────────────────────────────
     seed(state, { rng, protect: [{x,y}], mirror, blobs, walls })
     Paints patches onto the existing board. `protect` tiles (hero spawns,
     objective tiles) always stay plain and never become walls. Mirrored
     top↔bottom by default so the two spawn rows see the same ground. */
  function seed(state, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var d = dims(state), W = d.W, H = d.H;
    if (!W || !H) return [];
    var mirror = opts.mirror != null ? opts.mirror : RULES.MIRROR;
    var protect = protectedSet(state, opts.protect);
    var half = mirror ? Math.ceil(H / 2) : H;
    var pool = shuffle(rng, ELEMENTAL.slice());
    var nBlobs = opts.blobs != null ? opts.blobs : rint(rng, RULES.BLOBS_MIN, RULES.BLOBS_MAX);
    var changed = [];
    for (var b = 0; b < nBlobs && b < pool.length; b++) {
      var id = pool[b];
      var cells = [[rint(rng, 0, W - 1), rint(rng, 0, half - 1)]];
      var size = rint(rng, RULES.BLOB_MIN, RULES.BLOB_MAX);
      for (var i = 1; i < size; i++) {
        var from = cells[Math.floor(rng() * cells.length)];
        var nx = from[0] + rint(rng, -1, 1), ny = from[1] + rint(rng, -1, 1);
        if (nx >= 0 && nx < W && ny >= 0 && ny < half) cells.push([nx, ny]);
      }
      for (var c = 0; c < cells.length; c++) {
        var cx = cells[c][0], cy = cells[c][1], my = H - 1 - cy;
        // A mirrored pair is painted together or not at all: if one half is a
        // hero / protected tile, painting only the other half would hand one
        // side ground the other side cannot have.
        if (mirror && (protect[cx + ',' + cy] || protect[cx + ',' + my])) continue;
        paint(state, cx, cy, id, protect, changed);
        if (mirror) paint(state, cx, my, id, protect, changed);
      }
    }
    var nWalls = opts.walls != null ? opts.walls : rint(rng, RULES.WALLS_MIN, RULES.WALLS_MAX);
    var midRow = Math.floor(H / 2), tries = 0;
    for (var w = 0; w < nWalls && tries < 20; tries++) {
      var wx = rint(rng, 0, W - 1);
      var wy = mirror ? midRow : rint(rng, 1, H - 2);
      if (protect[wx + ',' + wy] || occupied(state, wx, wy) || hasAnything(state, wx, wy)) continue;
      if (mirror && (protect[wx + ',' + (H - 1 - wy)] || occupied(state, wx, H - 1 - wy) || hasAnything(state, wx, H - 1 - wy))) continue;
      paint(state, wx, wy, 'labyrinth', protect, changed);
      if (mirror && H - 1 - wy !== wy) paint(state, wx, H - 1 - wy, 'labyrinth', protect, changed);
      w++;
    }
    return changed;
  }

  function paint(state, x, y, id, protect, changed) {
    if (protect[x + ',' + y]) return;
    if (hasAnything(state, x, y)) return;
    if (id === 'labyrinth' && occupied(state, x, y)) return;
    var from = at(state, x, y) || 'plain';
    if (from === id) return;
    set(state, x, y, id);
    changed.push({ x: x, y: y, from: from, to: id });
  }

  function protectedSet(state, list) {
    var p = {};
    (list || []).forEach(function (t) { if (t && t.x != null) p[t.x + ',' + t.y] = true; });
    // Every hero's tile is always protected, whether or not the host said so:
    // a hero walled in at spawn is a lost match.
    (state.units || []).forEach(function (u) { if (u && u.isHero && u.pos) p[u.pos.x + ',' + u.pos.y] = true; });
    return p;
  }

  /* ─── FLUX — the ground moves ────────────────────────────────────────────
     tick(state, { rng, force, count }) → [{x,y,from,to}]
     Call once per startTurn. Shifts RULES.FLUX_COUNT tiles every
     RULES.FLUX_EVERY turns (uses state.turnNumber if present, else an internal
     counter on state._terrainTurn). Rules of the shift:
       • a wall tile always opens (walls are temporary by design);
       • an occupied tile never becomes a wall, and a wall never lands beside
         BOTH heroes' only exits — kept simple: never on a protected tile;
       • with FLUX_NEIGHBOUR_BIAS the tile copies a neighbour's terrain, so
         patches creep instead of sparkling at random;
       • otherwise it picks a fresh terrain (or plain).
     Returns the list of changes; the host logs and animates them. */
  function tick(state, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var turn = (typeof state.turnNumber === 'number') ? state.turnNumber : (state._terrainTurn = (state._terrainTurn | 0) + 1);
    if (!opts.force && (turn % RULES.FLUX_EVERY) !== 0) return [];
    var d = dims(state), W = d.W, H = d.H;
    if (!W || !H) return [];
    var protect = protectedSet(state, opts.protect);
    var count = opts.count != null ? opts.count : RULES.FLUX_COUNT;
    var changed = [], tries = 0;
    while (changed.length < count && tries++ < count * 12) {
      var x = rint(rng, 0, W - 1), y = rint(rng, 0, H - 1);
      if (protect[x + ',' + y] || hasAnything(state, x, y)) continue;
      var from = at(state, x, y) || 'plain';
      var to;
      if (from === 'labyrinth') to = 'plain';
      else if (!occupied(state, x, y) && rng() < RULES.FLUX_WALL_CHANCE) to = 'labyrinth';
      else if (rng() < RULES.FLUX_NEIGHBOUR_BIAS) {
        var nb = neighbourTerrains(state, x, y);
        to = nb.length ? nb[Math.floor(rng() * nb.length)] : ELEMENTAL[Math.floor(rng() * ELEMENTAL.length)];
      } else to = (rng() < 0.2) ? 'plain' : ELEMENTAL[Math.floor(rng() * ELEMENTAL.length)];
      if (to === from) continue;
      set(state, x, y, to);
      changed.push({ x: x, y: y, from: from, to: to });
    }
    if (changed.length && Array.isArray(state.log)) {
      state.log.push({ msg: '🌍 The ground shifts — ' + changed.map(function (c) {
        return coord(c) + ' ' + (TERRAINS[c.to].icon || '·') + ' ' + TERRAINS[c.to].name;
      }).join(', '), color: 'amber' });
    }
    return changed;
  }

  function neighbourTerrains(state, x, y) {
    var out = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var t = at(state, x + dx, y + dy);
      if (t && t !== 'labyrinth') out.push(t);
    }
    return out;
  }

  /* ─── Rendering helpers (strings only; the host owns the DOM) ───────────── */
  /* cellClass(state, x, y, changed?) — `changed` is the array tick() returned
     for the turn being rendered; tiles in it get `terrain-shift` so the CSS
     flashes them once. */
  function cellClass(state, x, y, changed) {
    var t = at(state, x, y);
    var cls = t ? ' has-terrain terrain-' + t : '';
    if (Array.isArray(changed)) for (var i = 0; i < changed.length; i++) {
      if (changed[i] && changed[i].x === x && changed[i].y === y) { cls += ' terrain-shift'; break; }
    }
    return cls;
  }
  function cellHtml(state, x, y) {
    var d = def(state, x, y);
    if (!d) return '';
    return '<div class="tile-terrain terr-' + d.id + '" style="--terr-hue:' + d.hue + '" aria-hidden="true">'
      + (d.icon ? '<span class="tile-terrain-icon">' + d.icon + '</span>' : '') + '</div>';
  }
  function cellTitle(state, x, y) { var d = def(state, x, y); return d ? d.name + ' — ' + d.desc : ''; }
  function unitBadge(unit, state) {
    var e = effect(unit, state);
    return e > 0 ? '<span class="terrain-badge up" title="Empowered">▲</span>' : e < 0 ? '<span class="terrain-badge dn" title="Hindered">▽</span>' : '';
  }

  /* ─── utils ─────────────────────────────────────────────────────────────── */
  function rint(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function shuffle(rng, arr) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function coord(p) { return String.fromCharCode(65 + p.x) + (p.y + 1); }
  function makeRng(seed) {   // mulberry32 — same generator the duel prototype uses
    var a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var api = {
    VERSION: VERSION, RULES: RULES, TERRAINS: TERRAINS, ELEMENTAL: ELEMENTAL,
    configure: configure, seed: seed, tick: tick,
    at: at, def: def, set: set, blocks: blocks, effect: effect, statBonus: statBonus, describe: describe,
    cellClass: cellClass, cellHtml: cellHtml, cellTitle: cellTitle, unitBadge: unitBadge,
    makeRng: makeRng, coord: coord,
  };
  global.MythicTerrain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
