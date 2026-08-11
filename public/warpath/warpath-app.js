/* ============================================================================
   WARPATH — the screen.
   ----------------------------------------------------------------------------
   Canvas map with fog of war, a dossier panel, and the four modals the mode
   actually turns on: the ENCOUNTER draft, the recruitment pick-1-of-3, the
   landmark, and EXPEDITION COMPLETE.

   THREE rules this file keeps:
     • It does NOT paint terrain. public/warpath/warpath-render.js owns every
       pixel of the world — relief, biome texture, shorelines, structures, the
       fog veil and the finish passes. This file owns fog STATE, the actor
       list, the camera, input, panels and modals, and hands the renderer a
       seed + fog accessor + actors. If the renderer is missing or throws, a
       deliberately plain fallback painter keeps the screen usable rather than
       leaving a black canvas.
     • It owns NO rules. Every state change is a WarpathNet.rpc() round trip
       and then a re-read of warpath_state(). The client never decides that a
       harvest succeeded, what a node contained, or how far a hero may walk —
       it asks, and re-renders whatever comes back. That is what makes the
       server authoritative rather than merely present.
     • It contains NO combat. Colliding with a hero posts 'warpath:battle' to
       the parent game, which runs the existing engine. Search this file for
       damage or HP-of-a-unit: there is none.
   ========================================================================= */
(function () {
'use strict';

var M = window.WarpathMap, D = window.WarpathData, NET = window.WarpathNet;

var S = {
  world: null, state: null, seed: 0,
  fog: null,                 // Uint8Array — bit y*W+x
  sel: null,                 // selected tile {x,y}
  reach: {},                 // reachable set for the hero this turn
  cam: { x: 0, y: 0, z: 22 }, userZoom: false,
  tab: 'camp', fogKey: 0, quality: 'high',
  busy: false, ended: false,
  hover: null,
};

var $ = function (id) { return document.getElementById(id); };
var cv = $('map'), ctx = cv.getContext('2d');

/* ── Small helpers ──────────────────────────────────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function explored(x, y) {
  if (!S.fog) return true;
  var b = y * M.WORLD_W + x;
  return !!(S.fog[b >> 3] & (1 << (b & 7)));
}
function inVision(x, y) {
  var me = S.state && S.state.me; if (!me) return false;
  return Math.max(Math.abs(x - me.x), Math.abs(y - me.y)) <= (me.vision || D.BASE_VISION);
}
var errT = null;
function toast(msg) {
  var e = $('err'); e.textContent = msg; e.classList.add('show');
  clearTimeout(errT); errT = setTimeout(function () { e.classList.remove('show'); }, 3600);
}
var ribT = null;
function ribbon(title, body) {
  var r = $('ribbon');
  r.querySelector('.rt').textContent = title;
  r.querySelector('.rb').textContent = body;
  r.classList.add('show');
  clearTimeout(ribT); ribT = setTimeout(function () { r.classList.remove('show'); }, 5200);
}
// Turn an RPC refusal code into something a player can act on.
var REASONS = {
  no_ticket: 'You have no Warpath Ticket.', not_active: 'Your Hero cannot act right now.',
  battle_pending: 'Resolve the battle first.', out_of_range: 'Too far for the movement you have left.',
  impassable: 'You cannot cross water.', out_of_bounds: 'That is off the map.',
  no_node_here: 'There is nothing to harvest on this tile.',
  already_harvested: 'This node has already been stripped.',
  no_moves_left: 'No movement left this turn.', no_camp: 'You have not pitched a camp yet.',
  not_at_camp: 'You have to be standing in your camp.',
  camp_already_here: 'Your camp is already here.',
  need_2_moves_to_pack: 'Packing the camp costs 2 movement.',
  not_at_site: 'You are not at that recruitment site.',
  site_already_recruited: 'You already hired from this site.',
  tent_too_small: 'Your Recruitment Tent is not big enough for that one.',
  max_level_or_unknown: 'Already at its highest level.',
  not_at_a_gate: 'Extraction only happens at a gate or portal.',
  not_ready: 'The extraction countdown has not finished.',
  out_of_reach: 'That Hero is not adjacent.', nothing_to_fight: 'There is nothing here to fight.',
  guardian_already_faced: 'You have already faced this Guardian.',
  battle_already_open: 'A battle is already pending.',
  already_in_a_warpath: 'You are already on a Warpath.',
};
function why(r) {
  if (!r) return 'That did not work.';
  if (r.reason === 'insufficient') {
    var m = M.RESOURCES[r.kind] || { icon: '', name: r.kind };
    return 'Not enough ' + m.icon + ' ' + m.name + ' — need ' + r.need + ', you have ' + r.have + '.';
  }
  if (r.reason === 'tent_too_small') {
    return 'Recruitment Tent ' + ['', 'I', 'II', 'III'][r.need_tent] + ' is needed for that recruit'
         + (r.tent ? ' (yours is ' + ['', 'I', 'II', 'III'][r.tent] + ').' : ' — you have not built one.');
  }
  return REASONS[r.reason] || ('That did not work (' + (r.reason || 'unknown') + ').');
}

/* ── Server round trip ──────────────────────────────────────────────────── */
function rpc(fn, args) {
  return NET.rpc(fn, args).catch(function (e) {
    toast(String(e && e.message || e));
    return { ok: false, reason: 'transport' };
  });
}
// Every mutating call goes through here: run it, re-read state, re-render.
function act(fn, args, onOk) {
  if (S.busy) return Promise.resolve();
  S.busy = true;
  return rpc(fn, args).then(function (r) {
    if (!r || !r.ok) { if (r && r.reason !== 'transport') toast(why(r)); S.busy = false; return r; }
    return refresh().then(function () { S.busy = false; if (onOk) onOk(r); return r; });
  }).catch(function (e) { S.busy = false; toast(String(e)); });
}

function refresh() {
  return rpc('warpath_state', {}).then(function (st) {
    if (!st || !st.ok || !st.in_run) return;
    S.state = st;
    if (!S.world || S.seed !== st.run.seed) {
      S.seed = st.run.seed;
      S.world = M.generate(st.run.seed);
      baked = null; bakedSeed = -1;      // a new world needs a new bake
    }
    // Fog arrives as base64 from the server; the offline mock hands over the
    // raw array. Bit n is byte[n>>3] & (1<<(n&7)) — the convention Postgres's
    // set_bit() uses, mirrored here so the two never disagree.
    var prev = S.fog;
    if (st._fog) S.fog = st._fog;
    else if (st.me && st.me.fog) {
      var bin = atob(st.me.fog), a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      S.fog = a;
    }
    // Cheap change token for the renderer's fog-mask cache: count revealed
    // bytes rather than diffing 165 bytes every frame.
    if (S.fog) {
      var sum = 0;
      for (var q = 0; q < S.fog.length; q++) sum += S.fog[q];
      S.fogKey = sum;
    }
    if (prev !== S.fog) { /* new buffer identity is fine — fogKey covers it */ }
    recomputeReach();
    renderAll();
  });
}
function recomputeReach() {
  var me = S.state && S.state.me;
  S.reach = (me && me.status === 'active' && S.world)
    ? M.reachable(S.world, me.x, me.y, me.moves_left) : {};
}

/* ── Structures on a tile ───────────────────────────────────────────────── */
function structureAt(x, y) {
  if (!S.world) return null;
  var w = S.world, i;
  for (i = 0; i < w.gates.length; i++) if (w.gates[i].x === x && w.gates[i].y === y) return { k: 'gate', s: w.gates[i] };
  for (i = 0; i < w.sites.length; i++) if (w.sites[i].x === x && w.sites[i].y === y) return { k: 'site', s: w.sites[i] };
  if (w.landmark.x === x && w.landmark.y === y) return { k: 'landmark', s: w.landmark };
  return null;
}
function nodeClaimed(x, y) {
  var c = (S.state && S.state.claimed_nodes) || [];
  for (var i = 0; i < c.length; i++) if (c[i].x === x && c[i].y === y) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
   MAP RENDERING
   Unexplored tiles are drawn as void. Explored-but-not-currently-visible
   tiles are drawn dimmed — you remember the terrain but not who is standing
   on it, which is exactly what the server enforces by refusing to send you
   an unseen hero's coordinates.
   ══════════════════════════════════════════════════════════════════════ */
function resize() {
  var r = window.devicePixelRatio || 1;
  cv.width = Math.floor(window.innerWidth * r);
  cv.height = Math.floor(window.innerHeight * r);
  cv.style.width = window.innerWidth + 'px';
  cv.style.height = window.innerHeight + 'px';
  ctx.setTransform(r, 0, 0, r, 0, 0);
  if (!S.userZoom) { S.cam.z = fitZoom(); clampCam(); }
  draw();
}
function viewW() { return window.innerWidth - (window.innerWidth > 900 && !$('side').classList.contains('hidden') ? 334 : 0); }
function viewH() { return window.innerHeight; }

// Zoom that shows the whole world without letterboxing it into a stamp in the
// corner. The first draft left z at a fixed 22, which on a 1440px viewport drew
// a 968px map floating off-centre — the world looked like a bug.
function fitZoom() {
  // Defer to the renderer when it is present — it knows its own legible zoom
  // floor. Otherwise fit the world at no less than 24px/tile.
  var mod = renderer();
  if (mod && typeof mod.fitZoom === 'function') {
    try { return Math.max(24, mod.fitZoom(viewW(), viewH())); } catch (e) {}
  }
  return Math.max(24, Math.min(46, Math.min(viewW() / M.WORLD_W, viewH() / M.WORLD_H)));
}
function centreOnHero() {
  var me = S.state && S.state.me; if (!me) return;
  S.cam.x = me.x * S.cam.z - viewW() / 2 + S.cam.z / 2;
  S.cam.y = me.y * S.cam.z - viewH() / 2 + S.cam.z / 2;
  clampCam();
}
/* When the world is WIDER than the view we clamp to its edges; when it is
   narrower we centre it. The first version did neither and pinned the map to
   one side. */
function clampCam() {
  var mw = M.WORLD_W * S.cam.z, mh = M.WORLD_H * S.cam.z;
  S.cam.x = mw <= viewW() ? (mw - viewW()) / 2 : Math.max(0, Math.min(S.cam.x, mw - viewW()));
  S.cam.y = mh <= viewH() ? (mh - viewH()) / 2 : Math.max(0, Math.min(S.cam.y, mh - viewH()));
}
/* Hit testing. If the renderer exposes screenToTile we use it — it may
   letterbox, rotate or apply a projection we know nothing about, and the
   click has to land on the tile the player actually sees. */
function tileFromEvent(ev) {
  var r = cv.getBoundingClientRect();
  var cx = ev.clientX - r.left, cy = ev.clientY - r.top;
  var mod = renderer(), t = null;
  if (mod && typeof mod.screenToTile === 'function') {
    try { t = mod.screenToTile({ x: S.cam.x, y: S.cam.y, z: S.cam.z }, cx, cy); } catch (e) { t = null; }
  }
  if (!t) {
    t = { x: Math.floor((cx + S.cam.x) / S.cam.z), y: Math.floor((cy + S.cam.y) / S.cam.z) };
  }
  if (!t || t.x < 0 || t.y < 0 || t.x >= M.WORLD_W || t.y >= M.WORLD_H) return null;
  return { x: t.x | 0, y: t.y | 0 };
}

function shade(hex, mul) {
  var n = parseInt(hex.slice(1), 16);
  var r = Math.min(255, ((n >> 16) & 255) * mul) | 0;
  var g = Math.min(255, ((n >> 8) & 255) * mul) | 0;
  var b = Math.min(255, (n & 255) * mul) | 0;
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

/* ── The render adapter ───────────────────────────────────────────────────
   warpath-render.js is presentation-only and knows nothing about turns, rules
   or networking. We give it four things and it paints:

     seed      — the world is a pure function of it, same as everywhere else
     camera    — {x,y} world-pixel offset and {z} pixels-per-tile
     fog       — fogState(x,y) → 0 unseen · 1 remembered · 2 live
     actors    — heroes, camps and the selection cursor, in world coordinates

   ⚠ The renderer must never decide what is AT a coordinate. Everything it
   draws is a layer on top of WarpathMap.tileAt(), and any sub-tile detail it
   invents (where a tree sits, where a ridge runs) has to come from wpHash32
   with its own salts so it is identical for every player and stable across
   reloads. The Postgres mirror re-derives the same tile from the same seed,
   and that agreement is the entire anti-cheat claim — a renderer that moved a
   node by a pixel of "artistic licence" would quietly break it.            */
var R = null;                 // resolved WarpathRender, or null → fallback
var baked = null, bakedSeed = -1;

function renderer() {
  if (R !== null) return R;
  var m = window.WarpathRender;
  R = (m && typeof m.draw === 'function') ? m : false;
  return R;
}

// 0 unseen · 1 remembered (explored, not currently in vision) · 2 live.
// The three states the map bar asks for, decided here because fog is STATE.
function fogState(x, y) {
  if (!explored(x, y)) return 0;
  return inVision(x, y) ? 2 : 1;
}

function actorList() {
  var st = S.state, out = [];
  if (!st) return out;
  if (st.camp) out.push({ kind: 'camp', x: st.camp.x, y: st.camp.y, self: true,
                          label: 'Your camp', color: '#ff7a2f',
                          buildings: st.camp.buildings });
  (st.others || []).forEach(function (o) {
    if (o.camp) out.push({ kind: 'camp', x: o.camp.x, y: o.camp.y, self: false,
                           label: o.hero_name + "'s camp", color: '#6b5f80' });
    // Only ever drawn from coordinates the SERVER chose to send. An unseen
    // hero has x === null and simply is not in this list.
    if (o.visible && o.x != null) {
      out.push({ kind: 'hero', x: o.x, y: o.y, self: false,
                 label: o.hero_name, color: '#c0473f', slot: o.slot });
    }
  });
  if (st.me) out.push({ kind: 'hero', x: st.me.x, y: st.me.y, self: true,
                        label: st.me.hero_name || 'Your Hero', color: '#d4af37',
                        slot: st.me.slot, status: st.me.status });
  return out;
}

/* The opts contract warpath-render.js actually reads:
     cam {x,y,z} · view {w,h} · baked · world · fogState(x,y)→0|1|2 · fogKey
     reach {'x,y':cost} · path · actors[] · markers[] · sel · hover · quality
   fogKey is a cheap cache token: the renderer rebuilds its fog masks only when
   it changes, so we bump it whenever the revealed set or the hero moves. */
function drawOpts() {
  var me = S.state && S.state.me;
  return {
    world: S.world,
    baked: baked,
    cam: { x: S.cam.x, y: S.cam.y, z: S.cam.z },
    view: { w: viewW(), h: viewH() },
    fogState: fogState,
    fogKey: S.fogKey + '|' + (me ? me.x + ',' + me.y + ',' + (me.vision || 2) : ''),
    reach: reachableExplored(),
    actors: actorList(),
    markers: markerList(),
    sel: S.sel,
    hover: S.hover,
    quality: S.quality,
  };
}

/* Node pips. The renderer paints the world; WHICH nodes are still unclaimed is
   run state, so the app supplies them — and only for tiles the player has
   actually explored, for the same reason the reach set is filtered. */
function markerList() {
  var st = S.state; if (!st || !S.world || S.cam.z < 14) return [];
  var out = [], me = st.me;
  var x0 = Math.max(0, Math.floor(S.cam.x / S.cam.z) - 1);
  var y0 = Math.max(0, Math.floor(S.cam.y / S.cam.z) - 1);
  var x1 = Math.min(M.WORLD_W - 1, Math.ceil((S.cam.x + viewW()) / S.cam.z));
  var y1 = Math.min(M.WORLD_H - 1, Math.ceil((S.cam.y + viewH()) / S.cam.z));
  for (var y = y0; y <= y1; y++) {
    for (var x = x0; x <= x1; x++) {
      if (!explored(x, y)) continue;
      var t = S.world.at(x, y);
      if (!t || !t.node || nodeClaimed(x, y)) continue;
      out.push({ x: x, y: y, glyph: t.node.icon,
                 big: t.node.tier === 'extraction',
                 color: t.node.tier === 'extraction' ? 'rgba(190,140,255,.95)' : 'rgba(226,196,110,.92)' });
    }
  }
  return out;
}

/* The reachable overlay is filtered to EXPLORED tiles before it ever reaches
   the renderer. S.reach is computed against the real world, so handing over
   the raw set would let the paint layer reveal which unexplored tiles are
   water — a fog leak in the renderer that the renderer could not know to
   avoid. Filtering here keeps that decision with the state owner. */
function reachableExplored() {
  var out = {};
  for (var k in S.reach) {
    var p = k.split(',');
    if (explored(+p[0], +p[1])) out[k] = S.reach[k];
  }
  return out;
}

function draw() {
  if (!S.world) { ctx.fillStyle = '#07060b'; ctx.fillRect(0, 0, window.innerWidth, window.innerHeight); return; }
  var mod = renderer();
  if (mod) {
    try {
      if (bakedSeed !== S.seed && typeof mod.bakeTerrain === 'function') {
        // One bake per world. It is the expensive call; everything after is a
        // blit plus the live layers.
        baked = mod.bakeTerrain(S.seed, { world: S.world, quality: S.quality });
        bakedSeed = S.seed;
      }
      mod.draw(ctx, drawOpts());
      return;
    } catch (e) {
      // A broken painter must not take the whole expedition down with it.
      try { console.warn('[warpath] render module failed, falling back:', e); } catch (e2) {}
      R = false;
    }
  }
  drawFallback();
}

/* ── Fallback painter ─────────────────────────────────────────────────────
   Deliberately plain: flat biome tone, fog, tokens. It exists so the screen
   still works if warpath-render.js is absent or throws — NOT as a second
   renderer to maintain. It does not meet the map bar and is not supposed to.
   ══════════════════════════════════════════════════════════════════════ */
function shade(hex, mul) {
  var n = parseInt(hex.slice(1), 16);
  var r = Math.min(255, ((n >> 16) & 255) * mul) | 0;
  var g = Math.min(255, ((n >> 8) & 255) * mul) | 0;
  var b = Math.min(255, (n & 255) * mul) | 0;
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function drawFallback() {
  var z = S.cam.z;
  ctx.fillStyle = '#07060b';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  var me = S.state && S.state.me;
  var x0 = Math.max(0, Math.floor(S.cam.x / z)), y0 = Math.max(0, Math.floor(S.cam.y / z));
  var x1 = Math.min(M.WORLD_W - 1, Math.ceil((S.cam.x + window.innerWidth) / z));
  var y1 = Math.min(M.WORLD_H - 1, Math.ceil((S.cam.y + window.innerHeight) / z));

  for (var y = y0; y <= y1; y++) {
    for (var x = x0; x <= x1; x++) {
      var sx = Math.round(x * z - S.cam.x), sy = Math.round(y * z - S.cam.y);
      var fs = fogState(x, y);
      if (fs === 0) {
        ctx.fillStyle = '#131020';
        ctx.fillRect(sx, sy, z + 1, z + 1);
        continue;
      }
      var t = S.world.at(x, y);
      var base = t.water ? '#12233d' : M.BIOMES[t.biome].tone;
      var v = 0.82 + (M.wpRoll(S.seed, x, y, 2, 26)) / 100;
      ctx.fillStyle = shade(base, v * (fs === 2 ? 1 : 0.5));
      ctx.fillRect(sx, sy, z + 1, z + 1);
      if (z >= 15) {
        var stru = structureAt(x, y), gl = null;
        if (stru) gl = stru.s.icon || (stru.k === 'gate' ? '🚪' : '❓');
        else if (t.node && !nodeClaimed(x, y)) gl = t.node.icon;
        if (gl) {
          ctx.globalAlpha = fs === 2 ? 1 : 0.5;
          ctx.font = Math.floor(z * 0.66) + 'px serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(gl, sx + z / 2, sy + z / 2 + 1);
          ctx.globalAlpha = 1;
        }
      }
    }
  }
  var reach = reachableExplored();
  if (me && me.status === 'active') {
    ctx.strokeStyle = 'rgba(212,175,55,.34)'; ctx.lineWidth = 1;
    for (var k in reach) {
      var p = k.split(','), rx = +p[0], ry = +p[1];
      if (rx === me.x && ry === me.y) continue;
      var ax = Math.round(rx * z - S.cam.x), ay = Math.round(ry * z - S.cam.y);
      ctx.fillStyle = 'rgba(212,175,55,.10)';
      ctx.fillRect(ax, ay, z, z);
      ctx.strokeRect(ax + .5, ay + .5, z - 1, z - 1);
    }
  }
  actorList().forEach(function (a) {
    drawToken(a.x, a.y, a.kind === 'camp' ? '⛺' : (a.self ? '🧙' : '🗡'), a.color, a.self);
  });
  if (S.sel) {
    var sxx = Math.round(S.sel.x * z - S.cam.x), syy = Math.round(S.sel.y * z - S.cam.y);
    ctx.strokeStyle = '#f3e7c8'; ctx.lineWidth = 2;
    ctx.strokeRect(sxx + 1, syy + 1, z - 2, z - 2);
  }
  var bx = Math.round(-S.cam.x), by = Math.round(-S.cam.y);
  ctx.strokeStyle = 'rgba(212,175,55,.30)'; ctx.lineWidth = 2;
  ctx.strokeRect(bx - 1, by - 1, M.WORLD_W * z + 2, M.WORLD_H * z + 2);
  var g = ctx.createRadialGradient(viewW() / 2, viewH() / 2, Math.min(viewW(), viewH()) * 0.32,
                                   viewW() / 2, viewH() / 2, Math.max(viewW(), viewH()) * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(3,2,6,.62)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

function drawToken(x, y, glyph, ring, big) {
  var z = S.cam.z;
  var sx = Math.round(x * z - S.cam.x), sy = Math.round(y * z - S.cam.y);
  if (sx < -z || sy < -z || sx > window.innerWidth || sy > window.innerHeight) return;
  ctx.beginPath();
  ctx.arc(sx + z / 2, sy + z / 2, z * (big ? 0.46 : 0.4), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(9,7,15,.82)'; ctx.fill();
  ctx.strokeStyle = ring; ctx.lineWidth = big ? 2.2 : 1.6; ctx.stroke();
  ctx.font = Math.floor(z * (big ? 0.62 : 0.52)) + 'px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(glyph, sx + z / 2, sy + z / 2 + 1);
}

/* ══════════════════════════════════════════════════════════════════════════
   PANELS
   ══════════════════════════════════════════════════════════════════════ */
function renderAll() { draw(); renderTop(); renderSide(); renderRail(); }

function renderTop() {
  var st = S.state; if (!st) return;
  var me = st.me;
  $('t-turn').textContent = st.run.turn;
  $('t-turn').nextElementSibling.textContent = '/' + st.run.max_turns + ' turns';
  $('t-moves').textContent = me.moves_left;
  $('t-hp').textContent = me.hp;
  var used = 0;
  M.EXTRACTION_MATERIALS.forEach(function (m) {
    used += ((st.inventory[m] || {}).secured) || 0;
  });
  $('t-vault').textContent = used + '/' + me.vault_slots;
  $('t-vault').parentNode.classList.toggle('warn', me.vault_slots > 0 && used >= me.vault_slots);

  var n = st.cards.length;
  $('t-deck').textContent = n;
  var ms = D.DECK_MILESTONES, next = ms.filter(function (m) { return m > n; })[0];
  $('t-decknext').textContent = next ? ('→ ' + next) : 'FULL DECK';
  var track = $('decktrack');
  if (!track.dataset.ticked) {
    ms.forEach(function (m) {
      var i = document.createElement('i');
      i.style.left = Math.min(100, (m / D.DECK_FULL) * 100) + '%';
      track.appendChild(i);
    });
    track.dataset.ticked = '1';
  }
  $('deckfill').style.width = Math.min(100, (n / D.DECK_FULL) * 100) + '%';
  $('t-mode').firstElementChild.textContent = NET.mode === 'live' ? 'live' : 'offline demo';
  var lm = S.world && S.world.landmark;
  $('runname').textContent = 'Warpath · seed ' + (S.seed >>> 0).toString(36).toUpperCase();
  if (lm) { /* landmark identity stays hidden until it is walked into */ }
}

function renderSide() {
  var body = $('sidebody'), foot = $('sidefoot'), st = S.state;
  if (!st) return;
  var h = '';
  if (S.tab === 'camp')      h = tabCamp(st);
  else if (S.tab === 'hold') h = tabHold(st);
  else if (S.tab === 'pool') h = tabPool(st);
  else                       h = tabFeed(st);
  body.innerHTML = h;
  foot.innerHTML = footFor(st);
  bindSide();
}

/* The camp, drawn in the shape the brief drew it:
        WATCHTOWER
            |
   BLACKSMITH — CAMPFIRE — SUPPLY TENT
            |
     RECRUITMENT TENT
   plus the Arcane Tent hanging off the corner. Clicking a node builds it. */
function tabCamp(st) {
  if (!st.camp) {
    return '<h3 class="sec">No camp</h3>'
      + '<p class="hint">Your Hero is still carrying everything they own. Pitch a camp to '
      + 'open the vault, and to start building the things that decide what kind of deck '
      + 'you can draft out here.</p>'
      + '<div class="kv"><span>Carrying</span><b>' + carriedCount(st) + ' items</b></div>'
      + '<div class="kv"><span>At risk if you lose a fight</span><b style="color:var(--invalid)">all of it</b></div>';
  }
  var b = st.camp.buildings || {};
  var atCamp = st.me.x === st.camp.x && st.me.y === st.camp.y;
  var cell = function (id) {
    if (!id) return '<div class="cnode cspacer"></div>';
    var spec = D.CAMP_BUILDINGS[id], lvl = b[id] || 0;
    var maxed = lvl >= spec.maxLevel;
    var cls = 'cnode' + (lvl ? ' built' : '') + (id === 'campfire' ? ' core' : '')
            + (!atCamp || maxed ? ' locked' : '');
    return '<div class="' + cls + '" data-build="' + id + '" title="' + esc(spec.desc) + '">'
      + '<div class="ci">' + spec.icon + '</div>'
      + '<div class="cn">' + esc(spec.name) + '</div>'
      + '<div class="cl' + (lvl ? '' : ' none') + '">'
      + (lvl ? ['', 'I', 'II', 'III'][lvl] : '—') + '</div></div>';
  };
  var grid = '<div id="campgrid">'
    + cell(null) + cell('watchtower') + cell('arcane')
    + cell('blacksmith') + cell('campfire') + cell('supply')
    + cell(null) + cell('recruitment') + cell(null)
    + '</div>';
  var next = '';
  if (atCamp) {
    D.CAMP_BUILD_ORDER.forEach(function (id) {
      var spec = D.CAMP_BUILDINGS[id], lvl = b[id] || 0;
      if (lvl >= spec.maxLevel || id === 'campfire') return;
      var cost = spec.levels[lvl].cost;
      var line = Object.keys(cost).map(function (k) {
        var have = ((st.inventory[k] || {}).secured) || 0;
        return '<span style="color:' + (have >= cost[k] ? 'var(--valid)' : 'var(--invalid)') + '">'
             + M.RESOURCES[k].icon + cost[k] + '</span>';
      }).join(' ');
      next += '<div class="kv"><span>' + spec.icon + ' ' + esc(spec.name) + ' '
            + ['I', 'II', 'III'][lvl] + '</span><b>' + (line || 'free') + '</b></div>';
    });
  }
  return '<h3 class="sec">Expedition camp</h3>'
    + '<p class="hint">' + (atCamp
        ? 'You cannot finish everything in one expedition. What you build is what kind of deck you get to draft.'
        : 'Your camp is at ' + st.camp.x + ',' + st.camp.y + '. Walk back to build, deposit or secure.') + '</p>'
    + grid
    + (next ? '<h3 class="sec">Next upgrades</h3>' + next : '')
    + '<div class="kv"><span>Vault slots</span><b>' + st.me.vault_slots + '</b></div>'
    + '<div class="kv"><span>Extraction capacity</span><b>' + st.me.extract_cap + ' cards</b></div>'
    + '<div class="kv"><span>Camp moved</span><b>' + (st.camp.moved || 0) + '×</b></div>';
}

function carriedCount(st) {
  var n = 0;
  for (var k in st.inventory) n += st.inventory[k].carried || 0;
  return n;
}

function tabHold(st) {
  var h = '<h3 class="sec">Expedition resources</h3>'
    + '<p class="hint">Spent out here, gone when the Warpath ends. '
    + '<span style="color:var(--ember)">Carried</span> can be taken from you; '
    + '<span style="color:var(--sky)">secured</span> cannot.</p>';
  M.EXPEDITION_RESOURCES.forEach(function (k) {
    var r = M.RESOURCES[k], v = st.inventory[k] || { carried: 0, secured: 0 };
    h += '<div class="res-row"><div class="nm">' + r.icon + ' ' + esc(r.name) + '</div>'
      + '<div class="amt"><span class="c">' + v.carried + '</span>'
      + '<span class="d"> / </span><span class="s">' + v.secured + '</span></div></div>';
  });
  var used = 0, any = false;
  M.EXTRACTION_MATERIALS.forEach(function (k) {
    var v = st.inventory[k]; if (v) used += v.secured || 0;
    if (v && (v.carried || v.secured)) any = true;
  });
  h += '<h3 class="sec" style="margin-top:16px">Extraction materials</h3>'
    + '<p class="hint">These cannot be found anywhere in your city. Only what is '
    + 'in the vault comes home — the vault holds ' + st.me.vault_slots + '.</p>';
  if (!any) h += '<p class="hint" style="opacity:.7">Nothing yet. Look in the mountains, the graveyard and the facility.</p>';
  M.EXTRACTION_MATERIALS.forEach(function (k) {
    var v = st.inventory[k]; if (!v || (!v.carried && !v.secured)) return;
    var r = M.RESOURCES[k];
    h += '<div class="res-row mat"><div class="nm">' + r.icon + ' ' + esc(r.name) + '</div>'
      + '<div class="amt"><span class="c">' + v.carried + '</span>'
      + '<span class="d"> / </span><span class="s">' + v.secured + '</span></div></div>';
  });
  h += '<div class="kv" style="margin-top:10px"><span>Vault</span><b class="' +
       (used >= st.me.vault_slots ? '' : '') + '">' + used + ' / ' + st.me.vault_slots + '</b></div>';
  return h;
}

function tabPool(st) {
  var by = { starter: [], recruit: [], discovery: [], boss: [], battle: [] };
  st.cards.forEach(function (c) { (by[c.source] || by.discovery).push(c); });
  var n = st.cards.length;
  var found = n - by.starter.length;
  var h = '<h3 class="sec">Warpath deck pool</h3>'
    + '<p class="hint">You entered with ' + by.starter.length + ' loaner cards. '
    + (found ? ('You have found <b style="color:var(--gold)">' + found + '</b> more out here.')
             : 'Everything else, you have to find.')
    + ' Only what you found — and only what is secured — can be extracted.</p>'
    + '<div class="kv"><span>Pool size</span><b>' + n + ' / ' + D.DECK_FULL + '</b></div>'
    + '<div class="kv"><span>Extractable now</span><b style="color:var(--gold)">'
    + Math.min(st.me.extract_cap, st.cards.filter(function (c) {
        return c.secured && c.source !== 'starter';
      }).length) + ' / ' + st.me.extract_cap + '</b></div>'
    + '<h3 class="sec" style="margin-top:16px">Found out here</h3>';
  var found_cards = st.cards.filter(function (c) { return c.source !== 'starter'; });
  if (!found_cards.length) h += '<p class="hint" style="opacity:.7">Nothing yet.</p>';
  found_cards.forEach(function (c) {
    h += '<div class="card-chip' + (c.secured ? '' : ' unsecured') + '">'
      + '<span>' + esc(cardName(c.key)) + '</span>'
      + '<span class="src ' + esc(c.source) + '">' + esc(c.source) + '</span></div>';
  });
  h += '<h3 class="sec" style="margin-top:16px">Loaner deck</h3>';
  var counts = {};
  by.starter.forEach(function (c) { counts[c.key] = (counts[c.key] || 0) + 1; });
  Object.keys(counts).forEach(function (k) {
    h += '<div class="card-chip"><span>' + esc(cardName(k))
      + (counts[k] > 1 ? ' ×' + counts[k] : '') + '</span>'
      + '<span class="src starter">starter</span></div>';
  });
  return h;
}

// The catalogs live in the parent game, not here, so a key is prettified
// rather than resolved. The parent shows the real card when it builds the deck.
function cardName(key) {
  var i = key.indexOf(':');
  var id = key.slice(i + 1);
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); });
}

function tabFeed(st) {
  var h = '<h3 class="sec">Run feed</h3>'
    + '<p class="hint">Four Heroes are in this world. You will hear about some of what they do.</p>'
    + '<div class="feed">';
  if (!st.events.length) h += '<div>Nothing has happened yet.</div>';
  st.events.forEach(function (e) {
    h += '<div><span class="t">T' + e.turn + '</span> ' + esc(feedLine(e)) + '</div>';
  });
  return h + '</div>';
}
function feedLine(e) {
  var p = e.payload || {};
  switch (e.kind) {
    case 'entered':             return (p.hero || 'A Hero') + ' entered the Warpath.';
    case 'camp_placed':         return 'Camp pitched at ' + p.x + ',' + p.y + '.';
    case 'camp_moved':          return 'Camp packed and moved to ' + p.x + ',' + p.y + '.';
    case 'built':               return 'Built ' + (D.CAMP_BUILDINGS[p.building] || {}).name
                                     + ' ' + ['', 'I', 'II', 'III'][p.level] + '.';
    case 'recruited':           return 'Recruited ' + p.label + '.';
    case 'discovered':          return 'Discovered ' + cardName(p.key || '') + '.';
    case 'material_found':      return 'Unearthed ' + ((M.RESOURCES[p.kind] || {}).name || p.kind) + '.';
    case 'battle_opened':       return p.kind === 'guardian' ? 'A Guardian was challenged.' : 'Two Heroes collided.';
    case 'guardian_defeated':   return 'The Guardian fell. It was carrying ' +
                                     ((M.RESOURCES[p.material] || {}).name || 'something') + '.';
    case 'hero_defeated':       return (p.winner || 'A Hero') + ' beat ' + (p.loser || 'someone') + '.';
    case 'extraction_started':  return '⚠ ' + (p.hero || 'A Hero') + ' is preparing to leave the Warpath.';
    case 'extracted':           return (p.hero || 'A Hero') + ' made it home with ' + (p.cards || 0) + ' cards.';
    case 'abandoned':           return (p.hero || 'A Hero') + ' walked away with nothing.';
    case 'run_closed':          return 'The Warpath closed.';
    default:                    return e.kind;
  }
}

function footFor(st) {
  var me = st.me;
  if (me.status === 'ready') {
    return '<button class="btn gold" id="f-extract">Complete extraction</button>';
  }
  if (me.status === 'extracting') {
    return '<div class="kv"><span>Extracting</span><b style="color:var(--ember)">'
      + me.extract_left + ' turn' + (me.extract_left === 1 ? '' : 's') + ' left</b></div>'
      + '<p class="hint" style="margin:0">Everyone in this world knows you are leaving.</p>';
  }
  if (me.status === 'extracted' || me.status === 'lost') {
    return '<p class="hint" style="margin:0">This expedition is over.</p>';
  }
  var camp = st.camp, atCamp = camp && me.x === camp.x && me.y === camp.y;
  var h = '';
  if (atCamp) h += '<button class="btn ember" id="f-secure">Deposit &amp; secure</button>';
  h += '<button class="btn danger sm" id="f-abandon">Abandon expedition</button>';
  return h;
}

function bindSide() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-build]'), function (el) {
    if (el.classList.contains('locked')) return;
    el.onclick = function () { act('warpath_camp_build', { p_building: el.dataset.build }); };
  });
  var s = $('f-secure');
  if (s) s.onclick = function () {
    act('warpath_secure', {}, function (r) {
      var moved = Object.keys(r.moved || {}).length;
      ribbon('Vault', moved || r.cards_secured
        ? ('Secured ' + moved + ' resource type' + (moved === 1 ? '' : 's')
           + (r.cards_secured ? ' and ' + r.cards_secured + ' card' + (r.cards_secured === 1 ? '' : 's') : '')
           + '.' + (r.vault_full ? ' The vault is full — upgrade the Supply Tent.' : ''))
        : 'Nothing to deposit.');
    });
  };
  var a = $('f-abandon');
  if (a) a.onclick = function () {
    if (!window.confirm('Abandon the expedition? Everything you found is lost.')) return;
    act('warpath_abandon', {}, function () { showSummary(null); });
  };
  var f = $('f-extract');
  if (f) f.onclick = doExtract;
}

/* ── Bottom rail ────────────────────────────────────────────────────────── */
function renderRail() {
  var st = S.state; if (!st) return;
  var me = st.me, sel = S.sel;
  var info = $('tileinfo');
  var canAct = me.status === 'active';

  if (!sel || !explored(sel.x, sel.y)) {
    info.innerHTML = '<div class="tn">' + (sel ? 'Unexplored' : '—') + '</div>'
      + '<div class="td">' + (sel ? 'You have not been here. Anything could be here.'
                                  : 'Click a tile to inspect it.') + '</div>';
  } else {
    var t = S.world.at(sel.x, sel.y);
    var stru = structureAt(sel.x, sel.y);
    var b = M.BIOMES[t.biome] || { name: 'Deep Water', icon: '🌊', pack: 'Impassable.' };
    var name = stru ? (stru.s.name || 'Structure') : b.name;
    var desc = stru ? (stru.s.blurb || (stru.k === 'gate' ? 'An extraction point. Reach it, hold it, and go home.' : ''))
                    : b.pack;
    if (stru && stru.k === 'landmark' && !inVision(sel.x, sel.y)) {
      name = '??? Unidentified Structure'; desc = 'You can see it from here. You cannot see what it is.';
    }
    var extra = '';
    if (t.node) {
      extra = nodeClaimed(sel.x, sel.y)
        ? '<div class="td" style="color:var(--edge)">Already stripped.</div>'
        : '<div>' + t.node.icon + ' ' + esc(t.node.name) + ' ×' + t.node.amount
          + (t.node.tier === 'extraction' ? ' <span style="color:var(--arcane)">· extraction material</span>' : '')
          + '</div>';
    }
    var d = S.reach[sel.x + ',' + sel.y];
    info.innerHTML = '<div class="tn">' + esc(name) + '</div>'
      + '<div class="td">' + esc(desc) + '</div>' + extra
      + '<div class="td">' + (t.water ? 'Impassable'
          : ('Move cost ' + t.moveCost + (d != null ? ' · ' + d + ' to reach' : ' · out of range')))
      + '</div>';
  }
  $('bearings').innerHTML = bearings(st);

  /* You may step into the unknown. For an EXPLORED tile we know the true cost
     and can enable precisely; for an unexplored one we only check the crude
     Chebyshev bound and let the server refuse if it is water — otherwise the
     greyed-out button would tell the player what is under the fog. */
  var onMe = sel && sel.x === me.x && sel.y === me.y;
  var canWalk = sel && !onMe && (explored(sel.x, sel.y)
    ? S.reach[sel.x + ',' + sel.y] != null
    : Math.max(Math.abs(sel.x - me.x), Math.abs(sel.y - me.y)) <= me.moves_left);
  $('b-move').disabled = !canAct || !canWalk;
  $('b-move').onclick = function () { act('warpath_move', { p_x: sel.x, p_y: sel.y }, afterMove); };

  var here = S.world.at(me.x, me.y);
  $('b-harvest').disabled = !canAct || !here.node || nodeClaimed(me.x, me.y) || me.moves_left < 1;
  $('b-harvest').onclick = function () {
    act('warpath_harvest', {}, function (r) {
      var m = M.RESOURCES[r.kind];
      ribbon(r.tier === 'extraction' ? 'Extraction material' : 'Harvested',
             m.icon + ' ' + r.amount + ' ' + m.name
             + (r.tier === 'extraction' ? ' — get it into the vault.' : ''));
    });
  };

  var camp = st.camp;
  var atCamp = camp && camp.x === me.x && camp.y === me.y;
  $('b-camp').textContent = !camp ? 'Pitch camp' : (atCamp ? 'Camp is here' : 'Move camp here');
  $('b-camp').disabled = !canAct || atCamp;
  $('b-camp').onclick = function () { act('warpath_camp_place', {}); };

  // The contextual button: recruit / gate / guardian / challenge a rival.
  var actBtn = $('b-act');
  var s2 = structureAt(me.x, me.y);
  var adjacent = ((st.others) || []).filter(function (o) {
    return o.visible && o.x != null && Math.max(Math.abs(o.x - me.x), Math.abs(o.y - me.y)) <= 1;
  })[0];
  var pendingBattle = (st.battles || [])[0];

  if (pendingBattle) {
    actBtn.textContent = 'Fight'; actBtn.disabled = false;
    actBtn.onclick = function () { launchBattle(pendingBattle); };
  } else if (adjacent && canAct) {
    actBtn.textContent = 'Challenge ' + adjacent.hero_name.split(' ')[0];
    actBtn.disabled = false;
    actBtn.onclick = function () {
      act('warpath_battle_open', { p_target: adjacent.expedition_id }, function (r) {
        launchBattle({ id: r.battle_id, kind: r.kind, defender: r.defender });
      });
    };
  } else if (s2 && s2.k === 'site' && canAct) {
    var done = (st.recruited || []).indexOf(s2.s.id) >= 0;
    actBtn.textContent = done ? 'Already hired' : 'Recruit';
    actBtn.disabled = done;
    actBtn.onclick = function () { showRecruit(s2.s); };
  } else if (s2 && s2.k === 'gate' && canAct) {
    actBtn.textContent = 'Begin extraction'; actBtn.disabled = false;
    actBtn.onclick = function () {
      act('warpath_extract_begin', {}, function (r) {
        ribbon('Extraction started', 'Hold this gate for ' + r.turns + ' turn'
               + (r.turns === 1 ? '' : 's') + '. Everyone has been told.');
      });
    };
  } else if (s2 && s2.k === 'landmark' && canAct) {
    actBtn.textContent = s2.s.guardian ? 'Face the Guardian' : 'Enter';
    actBtn.disabled = false;
    actBtn.onclick = function () { showLandmark(s2.s); };
  } else {
    actBtn.textContent = '—'; actBtn.disabled = true; actBtn.onclick = null;
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (el) {
    el.onclick = function () {
      var p = el.dataset.goto.split(',');
      S.sel = { x: +p[0], y: +p[1] };
      S.cam.x = S.sel.x * S.cam.z - viewW() / 2;
      S.cam.y = S.sel.y * S.cam.z - viewH() / 2;
      clampCam(); renderRail(); draw();
    };
  });

  $('b-endturn').disabled = !(me.status === 'active' || me.status === 'extracting');
  $('b-endturn').onclick = function () {
    act('warpath_end_turn', {}, function (r) {
      if (r.waiting_for) ribbon('Turn ended', 'Waiting for ' + r.waiting_for + ' more Hero(es).');
    });
  };
}

/* Bearings. A hero standing in the dark needs to know which way home is and
   which way out is, or the map is just a dark field with a token on it. Only
   places you actually KNOW about appear here: the gate you walked in through,
   your own camp, and any portal or site you have personally explored. */
function bearings(st) {
  var me = st.me, out = [];
  var add = function (icon, name, x, y) {
    var dx = x - me.x, dy = y - me.y;
    var dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (!dist) { out.push('<span class="bear here">' + icon + ' ' + esc(name) + ' · here</span>'); return; }
    var dir = (Math.abs(dy) > Math.abs(dx) * 2 ? (dy < 0 ? 'N' : 'S')
             : Math.abs(dx) > Math.abs(dy) * 2 ? (dx < 0 ? 'W' : 'E')
             : (dy < 0 ? 'N' : 'S') + (dx < 0 ? 'W' : 'E'));
    out.push('<span class="bear" data-goto="' + x + ',' + y + '">' + icon + ' ' + esc(name)
             + ' <b>' + dist + '</b> ' + dir + '</span>');
  };
  if (st.camp) add('⛺', 'Camp', st.camp.x, st.camp.y);
  (S.world.gates || []).forEach(function (g) {
    if (explored(g.x, g.y)) add('🚪', g.main ? 'Warpath Gate' : g.name, g.x, g.y);
  });
  (S.world.sites || []).forEach(function (r) {
    if (explored(r.x, r.y) && (st.recruited || []).indexOf(r.id) < 0) add(r.icon, r.name, r.x, r.y);
  });
  if (S.world.landmark && explored(S.world.landmark.x, S.world.landmark.y)) {
    add('❓', 'Unknown structure', S.world.landmark.x, S.world.landmark.y);
  }
  return out.join('');
}

function afterMove(r) {
  S.sel = { x: r.x, y: r.y };
  centreOnHero(); draw();
  if (r.encounter) showEncounter(r.encounter);
}

/* ══════════════════════════════════════════════════════════════════════════
   MODALS
   ══════════════════════════════════════════════════════════════════════ */
function closeModal() { $('modal').innerHTML = ''; }
function openModal(html, onBind) {
  $('modal').innerHTML = '<div class="veil"><div class="sheet">' + html + '</div></div>';
  if (onBind) onBind();
}

/* The draft. "Explore → Discover Opportunity → Make Choice → Add Card." */
function showEncounter(enc) {
  var tbl = D.DISCOVERY[enc.biome] || {};
  var b = M.BIOMES[enc.biome] || {};
  var picks = enc.offers.map(function (o, i) {
    return '<div class="pick" data-pick="' + i + '">'
      + '<div class="pi">' + (b.icon || '❔') + '</div>'
      + '<div class="pn">' + esc(cardName(o.key)) + '</div>'
      + '<div class="pt">' + esc(o.key.slice(0, o.key.indexOf(':'))) + '</div>'
      + '</div>';
  }).join('');
  openModal(
    '<div class="eyebrow">Encounter</div>'
    + '<h2>' + esc(tbl.title || 'Something offers') + '</h2>'
    + '<div class="lede">' + esc(b.pack || '') + ' You may take <b>one</b>.</div>'
    + '<div class="picks">' + picks + '</div>'
    + '<div class="sheet-foot"><button class="btn" id="enc-skip">Take nothing</button></div>',
    function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-pick]'), function (el) {
        el.onclick = function () {
          closeModal();
          act('warpath_encounter_pick', { p_enc: enc.id, p_idx: +el.dataset.pick }, function (r) {
            ribbon('Added to your pool', cardName(r.card_key) + ' — carry it home to keep it.');
          });
        };
      });
      $('enc-skip').onclick = closeModal;
    });
}

/* Recruitment — the brief's Goblin Encampment, three offers you cannot all
   afford, with the tent gate and the price shown honestly against what you
   are actually carrying. */
function showRecruit(site) {
  var st = S.state, pool = D.RECRUIT_POOLS[site.id];
  if (!pool) { toast('No recruits here.'); return; }
  var tent = (st.camp && st.camp.buildings.recruitment) || 0;
  var maxRank = [0, 2, 4, 5][Math.min(tent, 3)];
  var picks = pool.offers.map(function (o, i) {
    var afford = true, costLine = Object.keys(o.cost).map(function (k) {
      var have = ((st.inventory[k] || {}).carried) || 0;
      if (have < o.cost[k]) afford = false;
      return M.RESOURCES[k].icon + o.cost[k];
    }).join('  ');
    var locked = o.rank > maxRank;
    var reason = locked
      ? 'Needs Recruitment Tent ' + ['', 'I', 'II', 'III'][o.rank <= 2 ? 1 : o.rank <= 4 ? 2 : 3]
      : (afford ? '' : 'You cannot afford this');
    return '<div class="pick' + (locked || !afford ? ' no' : '') + '" data-recruit="' + i + '">'
      + '<div class="pi">' + (locked ? '🔒' : '🗡') + '</div>'
      + '<div class="pn">' + esc(o.label) + '</div>'
      + '<div class="pt">Rank ' + o.rank + '</div>'
      + '<div class="pd">' + esc(o.note) + '</div>'
      + '<div class="pc ' + (locked || !afford ? 'bad' : 'ok') + '">' + costLine + '</div>'
      + (reason ? '<div class="pd" style="color:var(--invalid)">' + esc(reason) + '</div>' : '')
      + '</div>';
  }).join('');
  openModal(
    '<div class="eyebrow">Recruitment</div>'
    + '<h2>' + esc(site.name) + '</h2>'
    + '<div class="lede">' + esc(pool.flavour) + ' You may hire <b>one</b>, and this site will not '
    + 'offer again.</div>'
    + '<div class="picks">' + picks + '</div>'
    + '<div class="sheet-foot"><button class="btn" id="rec-skip">Walk on</button></div>',
    function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-recruit]'), function (el) {
        if (el.classList.contains('no')) return;
        el.onclick = function () {
          closeModal();
          act('warpath_recruit', { p_site: site.id, p_idx: +el.dataset.recruit }, function (r) {
            ribbon('Recruited', r.label + ' joins your Warpath deck pool.');
          });
        };
      });
      $('rec-skip').onclick = closeModal;
    });
}

/* The landmark. The brief's "??? Unidentified Structure" — you learn what it
   is by walking into it, and if it is guarded you have to win a real battle. */
function showLandmark(lm) {
  openModal(
    '<div class="eyebrow">Secret location discovered</div>'
    + '<h2>' + esc(lm.name) + '</h2>'
    + '<div class="lede">' + esc(lm.blurb) + '</div>'
    + '<div class="sheet-foot">'
    + (lm.guardian
        ? '<button class="btn ember" id="lm-fight">Face the Guardian</button>'
        : '<button class="btn gold" id="lm-take">Take what is here</button>')
    + '<button class="btn" id="lm-leave">Leave it</button></div>',
    function () {
      var f = $('lm-fight');
      if (f) f.onclick = function () {
        closeModal();
        act('warpath_battle_open', {}, function (r) {
          launchBattle({ id: r.battle_id, kind: 'guardian', landmark: r.landmark || lm });
        });
      };
      var t = $('lm-take');
      if (t) t.onclick = function () {
        closeModal();
        // An unguarded landmark still resolves through the battle bridge, with
        // the attacker declared the winner — so there is exactly ONE path that
        // can award landmark loot, and it is the one the server audits.
        act('warpath_battle_open', {}, function (r) {
          act('warpath_battle_report', { p_battle: r.battle_id, p_winner: S.state.me.expedition_id },
              function (rr) {
                ribbon('The Garden', 'You take ' +
                  ((M.RESOURCES[(rr.spoils || {}).material] || {}).name || 'something') + '.');
              });
        });
      };
      $('lm-leave').onclick = closeModal;
    });
}

/* ══════════════════════════════════════════════════════════════════════════
   THE BATTLE BRIDGE — client side.
   This function is the ENTIRE extent of this screen's involvement in a card
   battle: it hands the battle id and the deck pool to the parent game and
   waits. The engine, the board, the AI and the result all live in
   public/index.html. Offline, there is no engine to hand it to, so the mock
   flips a coin and reports it — clearly labelled, so nobody mistakes the demo
   for the real thing.
   ══════════════════════════════════════════════════════════════════════ */
function launchBattle(battle) {
  var st = S.state;
  var payload = {
    battle_id: battle.id, kind: battle.kind,
    expedition_id: st.me.expedition_id,
    opponent_expedition_id: battle.defender || null,
    opponent_name: (function () {
      if (battle.kind === 'guardian') {
        return ((battle.landmark || (S.world && S.world.landmark) || {}).name || 'The Guardian');
      }
      var o = (st.others || []).filter(function (z) { return z.expedition_id === battle.defender; })[0];
      return (o && o.hero_name) || 'A rival Hero';
    })(),
    hero_id: st.me.hero_id,
    // The pool, not a deck. The parent pads it to DECK_SIZE for the engine.
    card_keys: st.cards.map(function (c) { return c.key; }),
    hero_hp: st.me.hp, hero_max_hp: st.me.max_hp,
  };
  if (NET.mode === 'live') {
    try {
      window.parent.postMessage({ type: 'warpath:battle', battle: payload }, window.location.origin);
      openModal('<div class="eyebrow">Battle</div><h2>Loading the battlefield</h2>'
        + '<div class="lede">' + esc(payload.opponent_name)
        + ' stands in your way. The Warpath does not decide this — your deck does.</div>');
    } catch (e) { toast('Could not hand the battle to the game.'); }
    return;
  }
  // OFFLINE DEMO ONLY.
  openModal(
    '<div class="eyebrow">Offline demo</div><h2>' + esc(payload.opponent_name) + '</h2>'
    + '<div class="lede">There is no battle engine attached to this page. In the game this '
    + 'launches a real Mythic Spellbook match with your Warpath pool. Pick an outcome so you '
    + 'can see what the Warpath does with it.</div>'
    + '<div class="sheet-foot">'
    + '<button class="btn gold" id="bt-win">I won</button>'
    + '<button class="btn danger" id="bt-lose">I lost</button></div>',
    function () {
      var send = function (won) {
        closeModal();
        act('warpath_battle_report', {
          p_battle: battle.id,
          p_winner: won ? st.me.expedition_id : (battle.defender || null),
        }, function (r) {
          ribbon(won ? 'Victory' : 'Defeat', won
            ? ('You take ' + (Object.keys(r.spoils || {}).length ? 'their carried loot.' : 'the field.'))
            : 'You drop what you were carrying and wake at your camp. The vault held.');
        });
      };
      $('bt-win').onclick = function () { send(true); };
      $('bt-lose').onclick = function () { send(false); };
    });
}

// The parent posts the engine's verdict back here.
window.addEventListener('message', function (ev) {
  var d = ev.data;
  if (!d || d.type !== 'warpath:battleResult') return;
  closeModal();
  act('warpath_battle_report', { p_battle: d.battle_id, p_winner: d.won ? S.state.me.expedition_id : d.loser_is_me === false ? null : (d.winner_expedition_id || null) }, function (r) {
    ribbon(d.won ? 'Victory' : 'Defeat',
      d.won ? 'The Warpath has recorded it.' : 'You wake at your camp. The vault held.');
  });
});

/* ── Extraction & the EXPEDITION COMPLETE sheet ──────────────────────────── */
function doExtract() {
  act('warpath_extract_finish', { p_keep: null }, function (r) { showSummary(r); });
}
function showSummary(r) {
  var s = (r && r.summary) || {};
  var rows = [
    ['Cards Discovered', s.cards_discovered || 0],
    ['New Cards Secured', s.cards_secured || 0],
    ['Resources Extracted', s.resources_extracted || 0],
    ['Bosses Defeated', s.bosses_defeated || 0],
    ['Players Defeated', s.players_defeated || 0],
    ['Camps Raided', s.camps_raided || 0],
    ['Distance Travelled', s.distance_travelled || 0],
  ].map(function (p) {
    return '<div class="row"><span>' + p[0] + '</span><b>' + p[1] + '</b></div>';
  }).join('');
  var mats = Object.keys((r && r.materials) || {}).map(function (k) {
    return '<div class="h">' + (M.RESOURCES[k] || {}).icon + ' ' + esc((M.RESOURCES[k] || {}).name || k)
         + ' ×' + r.materials[k] + '</div>';
  }).join('');
  var cards = ((r && r.card_keys) || []).map(function (k) {
    return '<div class="h">🃏 ' + esc(cardName(k)) + '</div>';
  }).join('');
  S.ended = true;
  openModal(
    '<div class="eyebrow">' + (r ? 'Expedition complete' : 'Expedition abandoned') + '</div>'
    + '<h2>' + (r ? 'You made it home' : 'You walked away') + '</h2>'
    + (r ? '' : '<div class="lede">Nothing you found out there came back with you.</div>')
    + '<div class="summary">' + rows + '</div>'
    + (cards ? '<h3 class="sec" style="margin-top:18px;text-align:center;border:0">Cards secured</h3><div class="haul">' + cards + '</div>' : '')
    + (mats ? '<h3 class="sec" style="margin-top:8px;text-align:center;border:0">Materials extracted</h3><div class="haul">' + mats + '</div>' : '')
    + '<div class="sheet-foot"><button class="btn gold" id="sum-done">Return to the city</button></div>',
    function () {
      $('sum-done').onclick = function () {
        closeModal();
        if (NET.mode === 'live') {
          try { window.parent.postMessage({ type: 'warpath:done' }, window.location.origin); } catch (e) {}
        } else {
          location.reload();
        }
      };
    });
}

/* ── Input ──────────────────────────────────────────────────────────────── */
var drag = null;
cv.addEventListener('pointerdown', function (e) {
  drag = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y, moved: false };
  cv.setPointerCapture(e.pointerId); cv.classList.add('dragging');
});
cv.addEventListener('pointermove', function (e) {
  if (!drag) {
    var h = tileFromEvent(e);
    var changed = (!!h !== !!S.hover) || (h && S.hover && (h.x !== S.hover.x || h.y !== S.hover.y));
    if (changed) { S.hover = h; draw(); }
    return;
  }
  var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
  S.cam.x = drag.cx - dx; S.cam.y = drag.cy - dy;
  clampCam(); draw();
});
cv.addEventListener('pointerup', function (e) {
  cv.classList.remove('dragging');
  if (drag && !drag.moved) {
    var t = tileFromEvent(e);
    if (t) { S.sel = t; renderRail(); draw(); }
  }
  drag = null;
});
cv.addEventListener('wheel', function (e) {
  e.preventDefault();
  var before = tileFromEvent(e);
  S.cam.z = Math.max(9, Math.min(46, S.cam.z * (e.deltaY < 0 ? 1.14 : 0.88)));
  S.userZoom = true;
  if (before) {
    var r = cv.getBoundingClientRect();
    S.cam.x = before.x * S.cam.z - (e.clientX - r.left);
    S.cam.y = before.y * S.cam.z - (e.clientY - r.top);
  }
  clampCam(); draw();
}, { passive: false });

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeModal();
  if (e.key === ' ' && !S.busy) { e.preventDefault(); $('b-endturn').click(); }
  if (e.key === 'c' || e.key === 'C') centreOnHero(), draw();
  if (e.key === 'l' || e.key === 'L') $('legend').classList.toggle('show');
});

Array.prototype.forEach.call(document.querySelectorAll('#sidetabs button'), function (b) {
  b.onclick = function () {
    Array.prototype.forEach.call(document.querySelectorAll('#sidetabs button'), function (z) {
      z.classList.remove('on');
    });
    b.classList.add('on'); S.tab = b.dataset.tab; renderSide();
  };
});
$('sidetoggle').onclick = function () {
  var s = $('side'); s.classList.toggle('hidden');
  $('sidetoggle').textContent = s.classList.contains('hidden') ? '‹' : '›';
  $('rail').style.right = s.classList.contains('hidden') ? '0' : '334px';
  setTimeout(function () { resize(); }, 360);
};

function buildLegend() {
  var h = '';
  M.BIOME_ORDER.forEach(function (k) {
    h += '<div class="l"><span class="sw" style="background:' + M.BIOMES[k].tone + '"></span>'
       + esc(M.BIOMES[k].name) + '</div>';
  });
  h += '<div class="l"><span class="sw" style="background:#12233d"></span>Water — impassable</div>'
     + '<div class="l">🚪 gate · ⛺ camp · 🗡 rival · press L to hide</div>';
  $('legend').innerHTML = h;
}

/* ── Boot ───────────────────────────────────────────────────────────────── */
window.addEventListener('resize', resize);

function boot() {
  buildLegend();
  resize();
  rpc('warpath_state', {}).then(function (st) {
    // Not in a run yet: offline we start one immediately so the page is
    // reviewable; live, the parent only mounts us after warpath_enter().
    if (!st || !st.ok || !st.in_run) {
      return rpc('warpath_enter', { p_hero_id: 'mock_hero', p_hero_name: 'Your Hero', p_pay: 'ticket' })
        .then(function (r) {
          if (!r || !r.ok) { toast(why(r)); return; }
          return refresh();
        });
    }
    return refresh();
  }).then(function () {
    if (!S.state) return;
    centreOnHero(); renderAll();
    setTimeout(function () {
      $('boot').classList.add('done');
      ribbon('The Warpath', 'Four Heroes entered this world. Only what you secure comes home.');
    }, 900);
    // Live runs are shared, so poll for what the others are doing. Cheap: one
    // row-set per player, and only while the run is live.
    if (NET.mode === 'live') {
      setInterval(function () { if (!S.busy && !S.ended) refresh(); }, 12000);
    }
  });
}
boot();

// Let the parent tell us to re-read (e.g. right after it applied a grant).
window.addEventListener('message', function (ev) {
  if (ev.data && ev.data.type === 'warpath:refresh') refresh();
});

})();
