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
  tab: 'camp', fogKey: 0, deadlineAt: null, quality: 'high', meta: null, encDismissed: false, seenEvents: null,
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
  turn_already_ended: 'You have ended your turn — wait for the others.',
  target_regrouping: 'That Hero was just beaten and is regrouping.',
  need_2_moves_to_attack: 'Challenging a Hero costs 2 movement.',
  already_fought_this_turn: 'You have already fought them this turn.',
  already_scouted_this_turn: 'Your scout has already reported this turn.',
  turn_already_ended: 'You have ended your turn — wait for the others.',
};
function why(r) {
  if (!r) return 'That did not work.';
  if (r.reason === 'insufficient') {
    /* ⚠ Name the wallet. "you have 0" was the message a player got while
       standing on 500 secured wood, because recruiting spends CARRIED — and it
       was the failure on 122 site visits against 34 successful hires. */
    var m = M.RESOURCES[r.kind] || { icon: '', name: r.kind };
    var w = r.wallet === 'secured' ? 'secured (in your camp vault)'
          : r.wallet === 'carried' ? 'carried (on your Hero)' : '';
    var other = r.wallet === 'carried' ? 'secured' : r.wallet === 'secured' ? 'carried' : null;
    var otherHave = null;
    try {
      var inv = (S.state && S.state.inventory && S.state.inventory[r.kind]) || null;
      if (inv && other) otherHave = inv[other];
    } catch (e) {}
    return 'Not enough ' + m.icon + ' ' + m.name + (w ? ' ' + w : '')
      + ' — need ' + r.need + ', you have ' + r.have + '.'
      + (otherHave ? ' You have ' + otherHave + ' ' + other + ' — '
          + (other === 'secured' ? 'the vault cannot pay for recruits.'
                                 : 'deposit it at camp to build with it.') : '');
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
    /* ⚠ B9 — THE LOSER WAS TOLD NOTHING. `hero_defeated` has always been in
       warpath_state, but nothing read it and the poll was 12s, so a player
       raided mid-run found out by noticing their own resource bar had moved.
       Anything that happened TO me since the last read is surfaced now. */
    try { announceNewEvents(st); } catch (e) {}
    renderAll();
    /* A pending encounter on the tile we are standing on re-opens itself
       unless the player explicitly dismissed it this session. This is what
       makes a mid-draft reload — or a dropped connection, which is normal
       live — recoverable rather than a silently lost pick. */
    try {
      var e = st.encounter;
      if (e && !S.encDismissed && st.me && e.x === st.me.x && e.y === st.me.y
          && !$('modal').firstChild) showEncounter(e);
    } catch (e2) {}
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
  // Height first: viewH() and fitZoom() both read the sheet's real box.
  sizeSheet();
  if (!S.userZoom) { S.cam.z = fitZoom(); clampCam(); }
  draw();
}
function viewW() { return window.innerWidth - (window.innerWidth > 900 && !$('side').classList.contains('hidden') ? 334 : 0); }
/* ⚠ viewH() RETURNED window.innerHeight UNCONDITIONALLY while viewW() above it
   correctly subtracts the 334px desktop column — so nothing ever told the camera
   about the 56vh bottom sheet. With the panel open the visible map band was
   838px at 1440x900, 314px at 820x1180, 137px at 390x844, 64px at 899x600, 12px
   at 360x640 and ZERO rotated at 844x390: the world was gone. Worse, clampCam
   then compared the map height against the WRONG viewport, decided it fitted,
   pinned cam.y and made dragging do nothing — a phone player saw world rows 1-7
   of 30, permanently. */
function sheetH() {
  var side = $('side');
  if (!side || side.classList.contains('hidden')) return 0;
  if (window.innerWidth > 900) return 0;              // desktop: it is a column, see viewW
  if (!side.classList.contains('open')) return 0;     // collapsed to its handle
  var r = side.getBoundingClientRect();
  // Measured, not assumed: sizeSheet() computes the height and safe areas can
  // still trim it.
  return Math.max(0, Math.min(window.innerHeight, Math.round(r.height)));
}
function viewH() { return Math.max(120, window.innerHeight - sheetH()); }

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

  /* ⏱ THE TURN CLOCK, and who the barrier is waiting on.
     "Why is nothing happening" with no visible answer is most of the harm a
     stalled player does — it reads as a broken game rather than as a person
     who walked away. The countdown and the dots turn both into information. */
  var secs = st.run.seconds_left;
  var clock = $('t-clock');
  /* ⚠ OFFLINE THERE IS NO SHARED CLOCK, and the pill sat at 0:00 pulsing
     `critical` forever — the poll that would refresh it is gated on
     NET.mode === 'live', so it counted to zero once and then lied for the rest
     of the session. A turn timer only means something when somebody else is
     waiting on you. */
  if (NET.mode !== 'live') { S.deadlineAt = null; clock.style.display = 'none'; } else
  if (secs != null && st.me.status !== 'extracted' && st.me.status !== 'lost') {
    S.deadlineAt = Date.now() + secs * 1000;
    clock.style.display = '';
    /* ⚠ IT IS THE RUN'S DEADLINE, NOT YOURS. The pill kept counting down and
       pulsing `critical` after the player had already ended their turn, under
       a tooltip that said "Time left in this turn" — so the one thing left to
       do was panic about a clock that could not cost them anything. Once your
       turn is in, the same number means "how long the others have". */
    S.clockIsMine = !st.me.turn_ended;
    clock.title = st.me.turn_ended
      ? 'Your turn is in — this is how long the run waits for the others'
      : 'Time left in this turn';
    clock.classList.toggle('waiting', !!st.me.turn_ended);
  } else { S.deadlineAt = null; clock.style.display = 'none'; }

  var dots = '';
  var seats = [{ hero_name: st.me.hero_name || 'You', turn_ended: st.me.turn_ended,
                 away: st.me.away, self: true, status: st.me.status }]
    .concat(st.others || []);
  seats.forEach(function (o) {
    var cls = o.away ? 'away' : (o.turn_ended ? 'done' : 'thinking');
    if (o.status === 'extracted' || o.status === 'lost') cls = 'gone';
    dots += '<i class="' + cls + (o.self ? ' me' : '') + '" title="' + esc(o.hero_name || 'Hero') + ' — '
         + (o.away ? 'away' : o.turn_ended ? 'turn ended' : 'still moving') + '"></i>';
  });
  $('t-seats').innerHTML = dots;
  var waiting = st.run.waiting_for | 0;
  $('t-seats').setAttribute('title', waiting
    ? 'Waiting for ' + waiting + ' Hero' + (waiting === 1 ? '' : 'es') + ' to end their turn'
    : 'Everyone has ended their turn');
  $('t-moves').textContent = me.moves_left;
  $('t-hp').textContent = me.hp;
  var used = 0;
  M.EXTRACTION_MATERIALS.forEach(function (m) {
    used += ((st.inventory[m] || {}).secured) || 0;
  });
  $('t-vault').textContent = used + '/' + me.vault_slots;
  $('t-vault').parentNode.classList.toggle('warn', me.vault_slots > 0 && used >= me.vault_slots);

  /* The deck ladder. Two bugs here: the bar was scaled to DECK_FULL (40) while
     DECK_MILESTONES runs to 60, so the 46/52/60 ticks piled onto the last
     pixel; and the markup hardcoded "→ 25" when the starter pool is 24. Scale
     to the LAST milestone, and mark DECK_FULL as its own line — that is the
     one that matters, because it is where the engine stops padding. */
  var n = st.cards.length;
  $('t-deck').textContent = n;
  var ms = D.DECK_MILESTONES, span = Math.max(D.DECK_FULL, ms[ms.length - 1]);
  var next = ms.filter(function (m) { return m > n; })[0];
  $('t-decknext').textContent = next ? ('→ ' + next) : 'FULL DECK';
  var track = $('decktrack');
  if (!track.dataset.ticked) {
    ms.forEach(function (m) {
      var i = document.createElement('i');
      i.style.left = Math.min(100, (m / span) * 100) + '%';
      track.appendChild(i);
    });
    var full = document.createElement('i');
    full.className = 'full';
    full.style.left = Math.min(100, (D.DECK_FULL / span) * 100) + '%';
    full.title = 'A full battle deck';
    track.appendChild(full);
    track.dataset.ticked = '1';
  }
  $('deckfill').style.width = Math.min(100, (n / span) * 100) + '%';
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
            + ['I', 'II', 'III'][lvl] + '</span><b>' + (line || 'free')
            + ' <span class="wallet sec">secured</span></b></div>';
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
  /* The two wallets are a real rule and were never stated: BUILDING spends
     secured stock, RECRUITING spends carried stock, and "Deposit & secure"
     sweeps everything into the vault with no way back. A player could
     permanently convert their hiring money into building money and never be
     told why the recruits had become unaffordable. */
  var h = '<h3 class="sec">Expedition resources</h3>'
    + '<p class="hint">Spent out here, gone when the Warpath ends.</p>'
    + '<div class="wallets">'
    + '<div><b style="color:var(--ember)">Carried</b><span>on your Hero · pays for RECRUITS · '
    + 'can be taken from you</span></div>'
    + '<div><b style="color:var(--sky)">Secured</b><span>in the camp vault · pays for BUILDING · '
    + 'safe from raids</span></div></div>'
    + '<p class="hint" style="margin-top:-4px">Depositing moves carried → secured, and there is no '
    + 'way back this expedition — keep enough on your Hero to hire with.</p>';
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
    var m = cardMeta(c.key) || {};
    h += '<div class="card-chip' + (c.secured ? '' : ' unsecured') + '" title="'
      + esc((m.d || '') + (m.c != null ? ' (cost ' + m.c + ')' : '')) + '">'
      + '<span>' + (m.i || '') + ' ' + esc(cardName(c.key)) + '</span>'
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

/* ── Cards ────────────────────────────────────────────────────────────────
   S.meta is the real catalog: posted by the parent game over
   `warpath:cardmeta` when embedded, or the generated fallback in
   warpath-data.js when standalone. Everything below degrades to the old
   prettified id if a key is somehow unknown, rather than rendering blank. */
function cardMeta(key) { return (S.meta && S.meta[key]) || D.CARD_META[key] || null; }
function cardName(key) {
  var m = cardMeta(key);
  if (m && m.n) return m.n;
  var id = String(key || '').slice(String(key || '').indexOf(':') + 1);
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); });
}
var STAT_LABELS = ['HP', 'ATK', 'DEF', 'MAG', 'RES', 'SPD'];
var TYPE_WORD = { unit: 'Unit', spell: 'Equipment', trap: 'Trigger',
                  location: 'Resource', weather: 'Weather' };
var ELEMENT_TONE = {
  fire: '#ff7a2f', water: '#4fa3ff', nature: '#4caf7a', earth: '#a3854f',
  shadow: '#9b4dff', light: '#f3e7c8', storm: '#7fb8ff', wind: '#8fe3d0',
};

/* One offer card, rendered from real data. This is the mode's whole identity —
   "Explore → Discover Opportunity → Make Choice" — and it used to be the biome
   icon three times over a title-cased id. */
function cardFace(key, extra) {
  var m = cardMeta(key) || {};
  var kind = m.t || String(key).slice(0, String(key).indexOf(':'));
  var stats = '';
  if (m.s) {
    stats = '<div class="cstats">' + m.s.map(function (v, i) {
      return '<span><b>' + v + '</b>' + STAT_LABELS[i] + '</span>';
    }).join('') + '</div>';
  }
  var els = (m.el || []).map(function (e) {
    return '<span class="cel" style="--e:' + (ELEMENT_TONE[e] || '#8f87a3') + '">' + esc(e) + '</span>';
  }).join('');
  var tags = [];
  if (m.p) tags.push(esc(m.p));
  if (m.fly) tags.push('flying');
  return '<div class="pi">' + (m.i || '🃏') + '</div>'
    + '<div class="pn">' + esc(cardName(key)) + '</div>'
    + '<div class="pt">' + esc(TYPE_WORD[kind] || kind)
      + (m.c != null ? ' · cost ' + m.c : '') + '</div>'
    + (els ? '<div class="cels">' + els + '</div>' : '')
    + stats
    + (tags.length ? '<div class="ctags">' + tags.map(esc).join(' · ') + '</div>' : '')
    + (m.d ? '<div class="pd">' + esc(m.d) + '</div>' : '')
    + (extra || '');
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
/* Events the player must not miss. Keyed on turn+kind so a repoll cannot
   re-announce the same thing; only the first sighting speaks. */
var LOUD = { hero_defeated: 1, extraction_started: 1, extraction_broken: 1,
             guardian_defeated: 1, run_closed: 1, watchtower_report: 1,
             rival_camp_struck: 1, landmark_sighted: 1, hero_away: 1 };

/* ⚠ "DO NOT SHOUT HISTORY" WAS SILENCING THE ONLY THING WORTH SHOUTING.
   Baselining on the first read is right for a page the player opened. It is
   fatal here, because A BATTLE TEARS THIS SCREEN DOWN: warpathStartBattle
   removes the iframe from the DOM and warpathAfterBattle builds a brand-new one
   with a cache-busted src. So the outcome of every battle always landed on the
   first refresh of a NEW session, S.seenEvents was empty, and hero_defeated,
   guardian_defeated and extraction_broken were all swallowed as history. The
   remount is the NORMAL path, not an edge case.

   So the baseline outlives the frame. It is keyed per run in sessionStorage, so
   a rebuilt frame continues the session it is really part of, and a genuinely
   new run still starts quiet. */
function _seenKey(st) {
  var run = st && st.run && st.run.id;
  return run ? ('wp_seen_' + run) : null;
}
function _loadSeen(st) {
  try {
    var k = _seenKey(st); if (!k) return null;
    var raw = sessionStorage.getItem(k);
    if (!raw) return null;
    var o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : null;
  } catch (e) { return null; }
}
function _saveSeen(st) {
  try {
    var k = _seenKey(st); if (!k) return;
    var keys = Object.keys(S.seenEvents);
    // Bounded: the feed itself is capped at 40, so this cannot grow unbounded
    // over a 60-turn run, but be explicit about it anyway.
    if (keys.length > 400) {
      var trimmed = {};
      keys.slice(-400).forEach(function (x) { trimmed[x] = 1; });
      S.seenEvents = trimmed;
    }
    sessionStorage.setItem(k, JSON.stringify(S.seenEvents));
  } catch (e) {}
}

function announceNewEvents(st) {
  var evs = (st && st.events) || [];
  if (!S.seenEvents) {
    var carried = _loadSeen(st);
    if (carried) {
      // A rebuilt frame. Carry on from where the torn-down one left off, so the
      // battle that caused the rebuild is NEWS.
      S.seenEvents = carried;
    } else {
      // A genuinely first read of this run establishes the baseline.
      S.seenEvents = {};
      evs.forEach(function (e) { S.seenEvents[e.turn + ':' + e.kind + ':' + JSON.stringify(e.payload || {})] = 1; });
      _saveSeen(st);
      return;
    }
  }
  var me = st.me, mine = (me && me.hero_name) || '';
  for (var i = evs.length - 1; i >= 0; i--) {
    var e = evs[i];
    var k = e.turn + ':' + e.kind + ':' + JSON.stringify(e.payload || {});
    if (S.seenEvents[k]) continue;
    S.seenEvents[k] = 1;
    if (!LOUD[e.kind]) continue;
    var p = e.payload || {};
    if (e.kind === 'hero_defeated') {
      if (p.loser && p.loser === mine) {
        ribbon('You were beaten', (p.winner || 'Another Hero') + ' took what you were carrying. '
          + 'Your vault held. You wake at your camp, injured.');
      } else if (p.winner && p.winner === mine) {
        ribbon('Victory', 'You beat ' + (p.loser || 'a rival') + ' and took their carried loot.');
      }
    } else if (e.kind === 'extraction_broken') {
      if (p.hero === mine) ribbon('Extraction broken', 'You were stopped before you could leave. '
        + 'Reach a gate again to restart the countdown.');
    } else if (e.kind === 'extraction_started') {
      if (p.hero !== mine) ribbon('⚠ A Hero is leaving the Warpath',
        (p.hero || 'Someone') + ' is holding ' + (p.gate || 'a gate') + ' for ' + (p.turns || 2)
        + ' turn' + ((p.turns || 2) === 1 ? '' : 's') + '.');
    } else if (e.kind === 'watchtower_report') {
      ribbon('⚠ Enemy camp discovered', 'Your Watchtower has spotted ' + (p.hero || 'a rival')
        + "'s camp " + (p.dist != null ? p.dist + ' tiles from yours' : 'nearby') + '.');
    } else if (e.kind === 'landmark_sighted') {
      /* The one authored PvE encounter in the mode, and 2 of every 3 players
         who were shown it walked past. It is already painted in your fog —
         this only makes sure you looked. No coordinates: the event is private
         and finding it again is the point. */
      ribbon('Something is out there', p.guarded
        ? 'You have seen a structure that should not exist, and something is standing at its door. '
          + 'It is on your map now. Nobody else has been told.'
        : 'You have seen a structure that should not exist. It is on your map now. '
          + 'Nobody else has been told.');
    } else if (e.kind === 'rival_camp_struck') {
      ribbon('A camp has struck', (p.hero || 'A rival') + ' packed up and left ' + p.x + ',' + p.y + '.');
    } else if (e.kind === 'hero_away') {
      // Being dropped from the barrier used to be announced by a dashed dot.
      if (p.hero === mine) {
        ribbon('You have been marked away', 'Three turns passed without you, so the run no longer '
          + 'waits for you. Your Hero is still on the map — and still lootable. Act to come back.');
      } else {
        ribbon('A Hero has stopped responding', (p.hero || 'Someone')
          + ' is no longer holding up the turn. They are still out there.');
      }
    } else if (e.kind === 'run_closed') {
      ribbon('The Warpath closed', 'Anything not extracted is gone.');
    }
  }
  _saveSeen(st);
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
    case 'extraction_started':  return '⚠ ' + (p.hero || 'A Hero') + ' is preparing to leave the Warpath'
                                     + (p.gate ? ' at ' + p.gate : '') + '.';
    case 'turn_timed_out':      return (p.hero || 'A Hero') + ' ran out of time and their turn was ended.';
    case 'hero_away':           return '⚠ ' + (p.hero || 'A Hero') + ' has stopped responding — the run no longer waits for them.';
    case 'rival_camp_struck':   return (p.hero || 'A rival') + ' packed their camp at '
                                     + p.x + ',' + p.y + ' and moved on.';
    case 'battle_abandoned':    return 'A battle nobody reported expired — both Heroes went free.';
    case 'battle_disputed':     return 'Two Heroes each claimed the same victory.';
    case 'watchtower_report':   return '🗼 Watchtower: ' + (p.hero || 'a rival') + ' is camped '
                                     + (p.dist != null ? p.dist + ' tiles away' : 'nearby') + '.';
    case 'landmark_sighted':    return '❓ You have sighted an unidentified structure'
                                     + (p.guarded ? ' — something is guarding it.' : '.');
    case 'scout_report':        return '🔭 Scout report — ' + (p.count || 0) + ' known camp'
                                     + ((p.count || 0) === 1 ? '' : 's') + ' located.';
    case 'extraction_broken':   return (p.hero || 'A Hero') + ' was stopped mid-extraction by ' + (p.by || 'someone') + '.';
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
  // 🔭 One movement, once a turn, at your own campfire. Surfaces rival camps
  // you have ALREADY discovered — direction and distance band, never a pin.
  if (atCamp && me.status === 'active') {
    h += '<button class="btn sm" id="f-scout" title="1 movement · once per turn">'
       + '🔭 Scout report</button>';
  }
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
      /* ⚠ "Nothing to deposit." used to be shown whenever `moved` was empty —
         which is EXACTLY the case where the player is standing in camp with a
         full vault (or no vault) and materials they cannot bank. They were told
         nothing was happening while quietly losing the ore at extraction. The
         vault warning now fires on its own, not only when something else moved,
         and it names the building that fixes it. */
      var moved = Object.keys(r.moved || {}).length;
      var stuck = 0;
      var inv = (S.state && S.state.inventory) || {};
      M.EXTRACTION_MATERIALS.forEach(function (k) { stuck += ((inv[k] || {}).carried) || 0; });
      if (r.no_vault && stuck) {
        ribbon('No vault', 'You are carrying ' + stuck + ' extraction material'
          + (stuck === 1 ? '' : 's') + ' with nowhere to put ' + (stuck === 1 ? 'it' : 'them')
          + '. Build the Supply Tent, or ' + (stuck === 1 ? 'it is' : 'they are') + ' lost at extraction.');
        return;
      }
      if (r.vault_full && stuck) {
        ribbon('Vault full', stuck + ' material' + (stuck === 1 ? '' : 's')
          + ' still on your Hero with no room to secure ' + (stuck === 1 ? 'it' : 'them')
          + '. Upgrade the Supply Tent — anything carried is lost at extraction.');
        return;
      }
      if (!moved && !r.cards_secured) { ribbon('Vault', 'Nothing to deposit.'); return; }
      ribbon('Vault', 'Secured ' + moved + ' resource type' + (moved === 1 ? '' : 's')
        + (r.cards_secured ? ' and ' + r.cards_secured + ' card' + (r.cards_secured === 1 ? '' : 's') : '')
        + '.' + (r.vault_full ? ' The vault is now full — upgrade the Supply Tent.' : ''));
    });
  };
  var sc = $('f-scout');
  if (sc) sc.onclick = function () {
    act('warpath_scout_report', {}, function (r) {
      var reps = r.reports || [];
      if (!reps.length) { ribbon('Scout report', r.summary || 'No sign of anyone.'); return; }
      ribbon('Scout report', reps.map(function (x) {
        return x.hero + ' — ' + x.band + ', to the ' + x.dir;
      }).join(' · '));
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

  var pendingEnc = st.encounter;
  var encHere = pendingEnc && pendingEnc.x === me.x && pendingEnc.y === me.y;

  if (pendingBattle) {
    /* ⚠ THIS SAID "FIGHT" FOR A BATTLE YOU HAD ALREADY PLAYED AND REPORTED.
       A bare win claim waits for the opponent, so the battle stays open — and
       the only thing on screen invited you to play the same match again, which
       would have been a second whole card game for one result. */
    if (pendingBattle.i_claimed) {
      actBtn.textContent = pendingBattle.they_claimed ? 'Result disputed' : 'Waiting on your opponent';
      actBtn.disabled = true;
      actBtn.onclick = null;
    } else {
      actBtn.textContent = 'Fight'; actBtn.disabled = false;
      actBtn.onclick = function () { launchBattle(pendingBattle); };
    }
  } else if (encHere && canAct) {
    // Recovery path for a draft that was closed or interrupted.
    actBtn.textContent = 'Open encounter'; actBtn.disabled = false;
    actBtn.onclick = function () { S.encDismissed = false; showEncounter(pendingEnc); };
  } else if (adjacent && canAct) {
    /* ⚠ The button has to know what the attack COSTS. Challenging spends 2
       movement (B4/B5) and this was enabled regardless, so a hero that had
       walked all turn could press Challenge, get need_2_moves_to_attack and
       never reach the battle bridge — which is exactly how the browser harness
       lost a battle it thought it had started. Every other action's enabled
       state agrees with the server; this one has to as well. */
    var canAfford = me.moves_left >= 2;
    actBtn.textContent = canAfford
      ? 'Challenge ' + adjacent.hero_name.split(' ')[0]
      : 'Challenge · needs 2 \uD83D\uDC63';
    actBtn.disabled = !canAfford;
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
        // The reciprocal half: how many rivals have explored THIS gate, i.e.
        // how many of them the broadcast is actually actionable for.
        var w = r.watchers | 0;
        ribbon('Extraction started', 'Hold ' + (r.gate || 'this gate') + ' for ' + r.turns
          + ' turn' + (r.turns === 1 ? '' : 's') + '. '
          + (w === 0 ? 'No rival has found this gate — nobody can act on the warning.'
             : w + ' rival' + (w === 1 ? ' has' : 's have') + ' explored this gate and just heard you.'));
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
    return '<div class="pick" data-pick="' + i + '">' + cardFace(o.key) + '</div>';
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
          S.encDismissed = false;
          closeModal();
          act('warpath_encounter_pick', { p_enc: enc.id, p_idx: +el.dataset.pick }, function (r) {
            ribbon('Added to your pool', cardName(r.card_key) + ' — carry it home to keep it.');
          });
        };
      });
      /* ⚠ Closing is NOT declining. The server keeps the encounter with
         picked:null forever, so Escape, a stray backdrop tap or a page reload
         used to strand the pick: refresh() never re-opened it and the action
         button offered nothing on that tile. It is recoverable now — the
         action button re-opens it, and a fresh page load opens it for you,
         because a dropped connection mid-draft is normal and losing the card
         to it is not acceptable. */
      $('enc-skip').onclick = function () { S.encDismissed = true; closeModal(); };
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
      + (locked ? '<div class="lockbadge">🔒</div>' : '')
      + cardFace(o.key)
      + '<div class="pt">Rank ' + o.rank + ' · hired as ' + esc(o.label) + '</div>'
      + '<div class="pd">' + esc(o.note) + '</div>'
      + '<div class="pc ' + (locked || !afford ? 'bad' : 'ok') + '">' + costLine
      + ' <span class="wallet">carried</span></div>'
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
    // WHICH landmark, not just that it is one. The Guardian's deck is authored
    // per landmark in the parent game, so the Black Pyramid and the Drowned
    // Choir have to be distinguishable here or they fight identically.
    landmark_id: (battle.kind === 'guardian'
      ? ((battle.landmark || (S.world && S.world.landmark) || {}).id || null) : null),
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

/* The parent posts the engine's verdict back here, after it has reported it.

   ⚠ THIS USED TO REPORT THE BATTLE ITSELF, AND NOTHING EVER SENT IT THE
   MESSAGE — the whole handler was dead code, and the parent reported the result
   and dropped the answer. So the one screen in the mode whose job is to tell
   you what just happened said nothing at all: the loser was teleported home,
   docked 30 HP, injured for two turns, stripped of half their carried
   resources and their newest unsecured card, and came back to silence.

   The parent reports (it is the one holding the verdict); this renders it. And
   it renders the THIRD outcome as well as the two obvious ones: a bare win
   claim waits for the opponent by design, and telling the player "Victory, the
   Warpath has recorded it" while the server still says status=open is a lie
   the client used to tell every time. */
window.addEventListener('message', function (ev) {
  var d = ev.data;
  if (!d || d.type !== 'warpath:battleResult') return;
  closeModal();
  if (!d.reported) {
    ribbon('Not reported yet', 'The Warpath could not be reached to record that battle. '
      + 'It will settle when the connection comes back.');
  } else if (d.awaiting) {
    ribbon(d.won ? 'You won — waiting on your opponent' : 'Reported',
      'Your result is in. A win only counts once the other Hero reports the same thing, '
      + 'so being quick buys nothing. Until then neither of you can move.');
  } else if (d.won) {
    ribbon('Victory', 'The Warpath has recorded it.');
  } else {
    ribbon('Defeat', 'You wake at your camp, injured. Your vault held — only what you were '
      + 'carrying is gone.');
  }
  refresh();
});

/* ── Extraction & the EXPEDITION COMPLETE sheet ────────────────────────────
   ⚠ CONFIRM BEFORE COMMITTING. Extraction is irreversible and used to fire on
   one click, with the player only finding out what came home on the summary
   afterwards — a critic extracted with "Cards Discovered 3 / New Cards Secured
   0" and was told only in a tab it had never opened. The numbers below come
   from state the client already has, so it costs nothing to show them first,
   and the empty-handed case gets a warning rather than a surprise. */
function extractPreview() {
  var st = S.state, cap = st.me.extract_cap;
  var eligible = st.cards.filter(function (c) { return c.secured && c.source !== 'starter'; });
  var carriedCards = st.cards.filter(function (c) { return !c.secured && c.source !== 'starter'; });
  var mats = {}, carriedMats = {};
  M.EXTRACTION_MATERIALS.forEach(function (k) {
    var v = st.inventory[k] || {};
    if (v.secured) mats[k] = v.secured;
    if (v.carried) carriedMats[k] = v.carried;
  });
  return { cap: cap, cards: eligible.slice(0, cap), overflow: Math.max(0, eligible.length - cap),
           carriedCards: carriedCards, mats: mats, carriedMats: carriedMats };
}
function doExtract() {
  var pv = extractPreview();
  var lost = pv.carriedCards.length + Object.keys(pv.carriedMats).length;
  var listing = pv.cards.length
    ? '<div class="haul">' + pv.cards.map(function (c) {
        var m = cardMeta(c.key) || {};
        return '<div class="h">' + (m.i || '🃏') + ' ' + esc(cardName(c.key)) + '</div>';
      }).join('') + '</div>'
    : '<div class="lede" style="color:var(--invalid)">Nothing you found out here is secured, so '
      + '<b>no cards will come home</b>. Cards have to be deposited at your camp to be extractable.</div>';
  var matList = Object.keys(pv.mats).length
    ? '<div class="haul">' + Object.keys(pv.mats).map(function (k) {
        return '<div class="h">' + (M.RESOURCES[k] || {}).icon + ' '
             + esc((M.RESOURCES[k] || {}).name || k) + ' ×' + pv.mats[k] + '</div>';
      }).join('') + '</div>' : '';
  var warn = '';
  if (lost) {
    warn = '<div class="lede" style="color:var(--ember)">⚠ You are still carrying '
      + (pv.carriedCards.length ? pv.carriedCards.length + ' unsecured card'
          + (pv.carriedCards.length === 1 ? '' : 's') : '')
      + (pv.carriedCards.length && Object.keys(pv.carriedMats).length ? ' and ' : '')
      + (Object.keys(pv.carriedMats).length ? Object.keys(pv.carriedMats).map(function (k) {
          return pv.carriedMats[k] + ' ' + ((M.RESOURCES[k] || {}).name || k); }).join(', ') : '')
      + '. None of it comes home.</div>';
  }
  if (pv.overflow) {
    warn += '<div class="lede" style="color:var(--mist)">Your extraction capacity is '
      + pv.cap + ' cards; ' + pv.overflow + ' secured card'
      + (pv.overflow === 1 ? '' : 's') + ' will be left behind. Upgrade the Supply Tent to raise it.</div>';
  }
  openModal(
    '<div class="eyebrow">Extraction</div><h2>Leave the Warpath?</h2>'
    + '<div class="lede">This is final. Here is exactly what goes into your permanent collection.</div>'
    + '<h3 class="sec" style="text-align:center;border:0">Cards coming home · ' + pv.cards.length
      + ' / ' + pv.cap + '</h3>' + listing
    + (matList ? '<h3 class="sec" style="text-align:center;border:0">Materials</h3>' + matList : '')
    + warn
    + '<div class="sheet-foot">'
    + '<button class="btn gold" id="ex-go">Extract and go home</button>'
    + '<button class="btn" id="ex-stay">Stay out here</button></div>',
    function () {
      $('ex-go').onclick = function () {
        closeModal();
        act('warpath_extract_finish', { p_keep: null }, function (r) { showSummary(r); });
      };
      $('ex-stay').onclick = closeModal;
    });
}
function showSummary(r) {
  var s = (r && r.summary) || {};
  var rows = [
    ['Cards Discovered', s.cards_discovered || 0],
    ['New Cards Secured', s.cards_secured || 0],
    ['Resources Gathered', s.resources_gathered || 0],
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
    // On a phone the tab strip is the visible lip of a closed sheet; pressing
    // one has to raise it, or the tabs look broken.
    if (isNarrow() && !sheetOpen()) setPanel(true);
  };
});
/* ── The dossier panel ────────────────────────────────────────────────────
   ⚠ TWO DIFFERENT CONTROLS, ONE BUTTON. On desktop the panel is a right-hand
   column and `hidden` slides it off the edge. Under 900px it is a bottom
   sheet, and the class that raises it is `open` — which NOTHING EVER ADDED.
   `hidden` and the default state resolve to the same transform at that
   breakpoint, so the only toggle shipped was a no-op on every phone: the camp
   builder, both wallet explanations, the extraction cap readout, Deposit &
   secure and Complete extraction were all unreachable, and since #b-endturn
   disables once status is 'ready', a phone run could not be finished at all.

   The button now drives whichever control the current viewport actually uses,
   and the rail is pushed clear of the sheet instead of being covered by it. */
function isNarrow() {
  try { return window.matchMedia('(max-width:900px)').matches; }
  catch (e) { return window.innerWidth <= 900; }
}
function sheetOpen() { return $('side').classList.contains('open'); }
/* THE MINIMUM WORLD. Below this the map stops being a map: you cannot see where
   you are relative to anything, and dragging it is guesswork. Asserted as a
   permanent test at four viewports — see _selftest.js. */
var MIN_MAP_BAND = 120;

/* Size the bottom sheet against what is actually left, rather than against a
   fraction of the screen. 56vh is a ceiling, not a height. */
function sizeSheet() {
  var side = $('side');
  if (!side) return;
  if (!isNarrow()) { side.style.removeProperty('--wp-sheet-h'); return; }
  /* offsetHeight, NOT getBoundingClientRect().bottom. #top is absolutely
     positioned at top:0, so its height IS its bottom edge — but a rect is
     measured against the visual viewport, and on a short rotated screen that
     can be scrolled or pinch-shifted out from under us. Reading a layout
     property instead means the sheet cannot be sized off a transient offset:
     at 844x390 the rect said 51 where the element is 78, so the sheet took its
     56vh ceiling and left a 94px band. */
  var hud = $('top');
  var hudBottom = hud ? Math.round(hud.offsetHeight) : 0;
  var ceiling = Math.round(window.innerHeight * 0.56);
  // The rail lives INSIDE the sheet while it is open, so it costs nothing here.
  var room = window.innerHeight - hudBottom - MIN_MAP_BAND;
  /* ⚠ WHEN THE SHEET AND THE MAP COMPETE, THE MAP WINS — and that is a decision,
     not an accident. This used to read Math.max(120, ...), which gave the SHEET
     a 120px floor: on a screen short enough for the two to fight, the sheet
     would have taken its floor out of the map's. They are not symmetric. A
     sheet that is too short still scrolls internally and every control in it
     stays reachable; a map band that is too short cannot be recovered by any
     action the player can take, because the camera has been clamped against a
     viewport that is not there. So `room` is a hard subtraction and the sheet
     takes what is left, down to nothing. On the shortest screen anyone has
     tested (844x390) that leaves 192px, so this floor is a guard rather than a
     mode. */
  side.style.setProperty('--wp-sheet-h', Math.max(0, Math.min(ceiling, room)) + 'px');
  /* html and body are overflow:hidden, but focusing the sheet handle can still
     scroll the window — measured at 53px on a 844x390 screen, which slides the
     top HUD out of sight. Nothing on this page is ever meant to scroll. */
  if (window.scrollY || window.scrollX) { try { window.scrollTo(0, 0); } catch (e) {} }
}

/* Move the action rail in and out of the sheet. The buttons keep their handlers
   — moving a node does not detach them — so this is purely where it is drawn. */
function railInSheet(inside) {
  var rail = $('rail'), side = $('side'), foot = $('sidefoot');
  if (!rail || !side || !foot) return;
  var want = !!inside;
  if (document.body.classList.contains('rail-in-sheet') === want
      && (want ? rail.parentNode === side : rail.parentNode === document.body)) return;
  if (want) side.insertBefore(rail, foot);
  else      document.body.insertBefore(rail, side);
  document.body.classList.toggle('rail-in-sheet', want);
}

function setPanel(show) {
  var s = $('side'), t = $('sidetoggle'), rail = $('rail');
  if (isNarrow()) {
    s.classList.remove('hidden');
    s.classList.toggle('open', !!show);
    document.body.classList.toggle('sheet-open', !!show);
    t.textContent = show ? '⌄' : '⌃';
    t.setAttribute('aria-label', show ? 'Close panel' : 'Open panel');
    rail.style.right = '0';
    railInSheet(!!show);
    sizeSheet();
  } else {
    railInSheet(false);
    sizeSheet();
    s.classList.remove('open');
    document.body.classList.remove('sheet-open');
    s.classList.toggle('hidden', !show);
    t.textContent = show ? '›' : '‹';
    t.setAttribute('aria-label', show ? 'Collapse panel' : 'Expand panel');
    rail.style.right = show ? '334px' : '0';
  }
  setTimeout(resize, 360);
}
$('sidetoggle').onclick = function () {
  setPanel(isNarrow() ? !sheetOpen() : $('side').classList.contains('hidden'));
};
// Crossing the breakpoint has to re-normalise, or a rotated phone inherits the
// desktop rail offset and a resized desktop inherits the sheet transform.
var _wasNarrow = isNarrow();
window.addEventListener('resize', function () {
  var now = isNarrow();
  if (now !== _wasNarrow) { _wasNarrow = now; setPanel(!now); }
});

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

/* The server is the authority on the deadline; this only animates between
   polls so the number does not sit frozen for five seconds at a time. */
function tickClock() {
  var el = $('t-clock');
  if (!el || !S.deadlineAt) return;
  var left = Math.max(0, Math.round((S.deadlineAt - Date.now()) / 1000));
  var m = Math.floor(left / 60), ss = left % 60;
  el.querySelector('b').textContent = m + ':' + (ss < 10 ? '0' : '') + ss;
  // Only urgent while it is actually your turn — see the note in renderTop.
  el.classList.toggle('warn', S.clockIsMine !== false && left <= 20);
  el.classList.toggle('critical', S.clockIsMine !== false && left <= 5);
}
setInterval(tickClock, 1000);

function boot() {
  buildLegend();
  resize();
  // Real card data before the first encounter can fire.
  try { NET.cardMeta().then(function (m) { S.meta = m; renderAll(); }); } catch (e) {}
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
      // 5s, not 12s: a raid, an extraction warning or a broken countdown are
      // all things you need to hear about while you can still react.
      setInterval(function () { if (!S.busy && !S.ended) refresh(); }, 5000);
    }
  });
}
boot();

// Let the parent tell us to re-read (e.g. right after it applied a grant).
window.addEventListener('message', function (ev) {
  if (ev.data && ev.data.type === 'warpath:refresh') refresh();
});

})();
