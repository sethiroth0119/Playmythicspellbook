/* ============================================================================
   WARPATH — transport.
   ----------------------------------------------------------------------------
   The screen never talks to Supabase itself. It calls WarpathNet.rpc(fn, args)
   and gets a promise back. Two things can be on the other end:

   LIVE — we are in an iframe. The request is posted to the parent game, which
     owns the authenticated Cloud client and forwards it to the matching
     `warpath_*` RPC. Same pattern as public/base/_bridge.js and the pack-opener
     bridge (public/index.html:41492): the sub-app never holds a session.

   OFFLINE — we were opened directly. A local mock plays the run in memory so
     the screen can be developed, screenshotted and reviewed without a database.

   ⚠ THE MOCK IS A UI HARNESS, NOT A SECOND SERVER. It implements enough rules
   to drive the screen honestly (movement budgets, node depletion, vault caps,
   the extraction cap) but it is NOT the authority and is NOT kept in lockstep
   with the migration. When the mode is live, every one of these calls is
   answered by Postgres, which re-derives the world from the seed and re-checks
   the claim. Do not port a rule from here into production; the rules live in
   supabase/migrations/20260811000000_warpath_milestone_1.sql.
   ========================================================================= */
(function (root) {
'use strict';

var M = root.WarpathMap || (typeof require !== 'undefined' && require('./warpath-mapgen.js').WarpathMap);
var D = root.WarpathData || (typeof require !== 'undefined' && require('./warpath-data.js').WarpathData);

var EMBEDDED = (function () {
  try { return !!(window.parent && window.parent !== window); } catch (e) { return false; }
})();

// ── LIVE: post to the parent and wait for the matching reply ──────────────
var _seq = 0, _waiting = {};
function rpcParent(fn, args) {
  return new Promise(function (resolve, reject) {
    var id = 'wp' + (++_seq);
    _waiting[id] = { resolve: resolve, reject: reject };
    try {
      window.parent.postMessage({ type: 'warpath:rpc', id: id, fn: fn, args: args || {} },
                                window.location.origin);
    } catch (e) { delete _waiting[id]; reject(e); return; }
    // A parent that never answers must not hang the UI forever.
    setTimeout(function () {
      if (_waiting[id]) { delete _waiting[id]; reject(new Error('warpath: no reply from the game for ' + fn)); }
    }, 20000);
  });
}
if (EMBEDDED) {
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.type !== 'warpath:rpc:result' || !_waiting[d.id]) return;
    var w = _waiting[d.id]; delete _waiting[d.id];
    if (d.error) w.reject(new Error(d.error)); else w.resolve(d.result);
  });
}

/* ── OFFLINE MOCK ─────────────────────────────────────────────────────────
   One player, three scripted rivals who wander, and the same map generator the
   real thing uses — so what you see offline is a real world, just refereed by
   the browser instead of Postgres. */
var mock = null;
function mockInit(seed) {
  var world = M.generate(seed >>> 0);
  var sp = world.spawns[0];
  var inv = {};
  M.EXPEDITION_RESOURCES.concat(M.EXTRACTION_MATERIALS).forEach(function (k) {
    inv[k] = { carried: 0, secured: (D.STARTING_STIPEND[k] || 0) };
  });
  var cards = D.STARTER_POOL.map(function (k, i) {
    return { id: 's' + i, key: k, source: 'starter', secured: true, turn: 1 };
  });
  mock = {
    seed: seed >>> 0, world: world, turn: 1, maxTurns: D.ENTRY.turns_per_run,
    me: {
      expedition_id: 'mock-exp', slot: 0, hero_id: 'mock_hero', hero_name: 'Your Hero',
      x: sp.x, y: sp.y, hp: 100, max_hp: 100,
      moves_left: D.ENTRY.moves_per_turn, injured_turns: 0,
      status: 'active', extract_left: 0, turn_ended: false,
      stats: { distance: 0, defeated: 0, raided: 0, bosses: 0 },
    },
    camp: null, inv: inv, cards: cards, cardSeq: 100, gathered: 0,
    recruited: [], claimed: {}, encounters: {}, encounter: null,
    battles: [], events: [], grants: [],
    fog: new Uint8Array(Math.ceil(world.w * world.h / 8)),
    others: world.spawns.slice(1).map(function (s, i) {
      return { expedition_id: 'mock-rival-' + i, slot: s.slot,
               hero_name: ['Vex the Unpaid', 'Sister Ord', 'The Cartographer'][i],
               x: s.x, y: s.y, status: 'active' };
    }),
  };
  reveal(sp.x, sp.y, vision());
  // You came in through the Warpath Gate — mirrors warpath_enter().
  var g0 = world.gates.filter(function (g) { return g.main; })[0];
  if (g0) reveal(g0.x, g0.y, 1);
  log('entered', { hero: 'Your Hero', slot: 0 });
  return mock;
}
function vision() {
  return D.BASE_VISION + (level('watchtower') >= 2 ? 1 : 0);
}
function level(b) { return (mock.camp && mock.camp.buildings[b]) || 0; }
function vaultSlots() { return D.VAULT_SLOTS[level('supply')] || 0; }
function extractCap() { return D.EXTRACT_BASE_CARDS + D.EXTRACT_CARDS_PER_VAULT_LEVEL * level('supply'); }
function reveal(cx, cy, r) {
  for (var y = Math.max(0, cy - r); y <= Math.min(mock.world.h - 1, cy + r); y++) {
    for (var x = Math.max(0, cx - r); x <= Math.min(mock.world.w - 1, cx + r); x++) {
      var b = y * mock.world.w + x;
      mock.fog[b >> 3] |= (1 << (b & 7));
    }
  }
}
function explored(x, y) { var b = y * mock.world.w + x; return !!(mock.fog[b >> 3] & (1 << (b & 7))); }
function log(kind, payload) {
  mock.events.unshift({ turn: mock.turn, kind: kind, payload: payload || {} });
  if (mock.events.length > 40) mock.events.pop();
}
function fail(reason, extra) {
  return Object.assign({ ok: false, reason: reason }, extra || {});
}

var MOCK = {
  warpath_enter: function (a) {
    mockInit(a.p_seed != null ? a.p_seed : (Math.random() * 4294967295) >>> 0);
    return { ok: true, run_id: 'mock-run', seed: mock.seed,
             expedition_id: mock.me.expedition_id, slot: 0, x: mock.me.x, y: mock.me.y };
  },

  warpath_state: function () {
    if (!mock) return { ok: true, in_run: false };
    var v = vision();
    return {
      ok: true, in_run: true,
      run: { id: 'mock-run', seed: mock.seed, turn: mock.turn,
             max_turns: mock.maxTurns, status: 'active', players: 4 },
      me: Object.assign({}, mock.me, {
        vision: v, vault_slots: vaultSlots(), extract_cap: extractCap(),
        fog: null,
      }),
      camp: mock.camp,
      inventory: mock.inv,
      cards: mock.cards,
      recruited: mock.recruited,
      claimed_nodes: Object.keys(mock.claimed).map(function (k) {
        var p = k.split(','); return { x: +p[0], y: +p[1] };
      }),
      encounter: mock.encounter,
      battles: mock.battles.filter(function (b) { return b.status === 'open'; }),
      others: mock.others.map(function (o) {
        var seen = Math.max(Math.abs(o.x - mock.me.x), Math.abs(o.y - mock.me.y)) <= v;
        return { expedition_id: o.expedition_id, slot: o.slot, hero_name: o.hero_name,
                 status: o.status, visible: seen,
                 x: seen ? o.x : null, y: seen ? o.y : null, camp: null };
      }),
      events: mock.events.slice(0, 40),
      grants_waiting: mock.grants.length,
      _fog: mock.fog,        // offline only — the live path sends base64
    };
  },

  warpath_move: function (a) {
    var me = mock.me;
    if (me.status !== 'active') return fail('not_active');
    if (me.turn_ended) return fail('turn_already_ended');
    if (mock.battles.some(function (b) { return b.status === 'open'; })) return fail('battle_pending');
    var t = mock.world.at(a.p_x, a.p_y);
    if (!t) return fail('out_of_bounds');
    if (!t.passable) return fail('impassable');
    var dist = M.reachable(mock.world, me.x, me.y, me.moves_left);
    var cost = dist[a.p_x + ',' + a.p_y];
    if (cost == null) return fail('out_of_range');
    me.stats.distance += Math.max(Math.abs(a.p_x - me.x), Math.abs(a.p_y - me.y));
    me.x = a.p_x; me.y = a.p_y; me.moves_left -= cost;
    reveal(me.x, me.y, vision());
    var enc = MOCK.warpath_encounter_open({});
    return { ok: true, x: me.x, y: me.y, cost: cost, moves_left: me.moves_left,
             encounter: enc.ok ? enc.encounter : null };
  },

  warpath_encounter_open: function () {
    var me = mock.me, key = me.x + ',' + me.y;
    if (mock.encounters[key]) {
      var e = mock.encounters[key];
      return e.picked != null ? fail('already_resolved') : { ok: true, encounter: e, title: e.title };
    }
    var t = mock.world.at(me.x, me.y);
    var tbl = D.DISCOVERY[t.biome];
    if (!tbl) return fail('no_table');
    if (M.wpRoll(mock.seed, me.x, me.y, 20, 100) >= tbl.encounterChance) return fail('nothing_here');
    var total = tbl.cards.reduce(function (s, c) { return s + c[1]; }, 0);
    var offers = [], used = {};
    for (var i = 0; i < 3; i++) {
      for (var tries = 0; tries < 12; tries++) {
        var r = M.wpRoll(mock.seed, me.x * 97 + i * 7 + tries, me.y, 21, total), acc = 0;
        for (var j = 0; j < tbl.cards.length; j++) {
          acc += tbl.cards[j][1];
          if (r < acc) {
            if (!used[j]) { used[j] = 1; offers.push({ key: tbl.cards[j][0] }); }
            break;
          }
        }
        if (offers.length === i + 1) break;
      }
    }
    if (!offers.length) return fail('nothing_here');
    var enc = { id: 'enc' + key, x: me.x, y: me.y, biome: t.biome, offers: offers,
                title: tbl.title, picked: null };
    mock.encounters[key] = enc; mock.encounter = enc;
    return { ok: true, encounter: enc, title: enc.title };
  },

  warpath_encounter_pick: function (a) {
    var enc = mock.encounter;
    if (!enc || enc.picked != null) return fail('already_picked');
    if (a.p_idx < 0 || a.p_idx >= enc.offers.length) return fail('bad_index');
    enc.picked = a.p_idx;
    var k = enc.offers[a.p_idx].key;
    mock.cards.push({ id: 'c' + (mock.cardSeq++), key: k, source: 'discovery',
                      secured: false, turn: mock.turn });
    mock.encounter = null;
    log('discovered', { key: k });
    return { ok: true, card_key: k };
  },

  warpath_harvest: function () {
    var me = mock.me, t = mock.world.at(me.x, me.y);
    if (me.moves_left < 1) return fail('no_moves_left');
    if (!t || !t.node) return fail('no_node_here');
    var key = me.x + ',' + me.y;
    if (mock.claimed[key]) return fail('already_harvested');
    mock.claimed[key] = true;
    mock.inv[t.node.kind].carried += t.node.amount;
    if (t.node.tier === 'expedition') mock.gathered = (mock.gathered || 0) + t.node.amount;
    me.moves_left -= 1;
    if (t.node.tier === 'extraction') log('material_found', { kind: t.node.kind });
    return { ok: true, kind: t.node.kind, amount: t.node.amount, tier: t.node.tier,
             moves_left: me.moves_left };
  },

  warpath_camp_place: function () {
    var me = mock.me;
    if (!mock.world.at(me.x, me.y).passable) return fail('impassable');
    if (!mock.camp) {
      mock.camp = { x: me.x, y: me.y, buildings: { campfire: 1 }, moved: 0 };
      log('camp_placed', { x: me.x, y: me.y });
      return { ok: true, placed: true, x: me.x, y: me.y };
    }
    if (mock.camp.x === me.x && mock.camp.y === me.y) return fail('camp_already_here');
    if (me.moves_left < 2) return fail('need_2_moves_to_pack');
    mock.camp.x = me.x; mock.camp.y = me.y; mock.camp.moved++;
    me.moves_left -= 2;
    log('camp_moved', { x: me.x, y: me.y });
    return { ok: true, moved: true, x: me.x, y: me.y };
  },

  warpath_camp_build: function (a) {
    var me = mock.me, b = a.p_building;
    if (!mock.camp) return fail('no_camp');
    if (mock.camp.x !== me.x || mock.camp.y !== me.y) return fail('not_at_camp');
    var lvl = (mock.camp.buildings[b] || 0) + 1;
    var spec = D.CAMP_BUILDINGS[b];
    if (!spec || lvl > spec.maxLevel) return fail('max_level_or_unknown');
    var cost = spec.levels[lvl - 1].cost, k;
    for (k in cost) if ((mock.inv[k].secured || 0) < cost[k]) {
      return fail('insufficient', { kind: k, need: cost[k], have: mock.inv[k].secured,
                                    wallet: 'secured' });
    }
    for (k in cost) mock.inv[k].secured -= cost[k];
    mock.camp.buildings[b] = lvl;
    if (b === 'watchtower') reveal(mock.camp.x, mock.camp.y, D.WATCHTOWER_VISION[Math.min(lvl, 2)]);
    log('built', { building: b, level: lvl });
    return { ok: true, building: b, level: lvl };
  },

  warpath_secure: function () {
    var me = mock.me;
    if (!mock.camp) return fail('no_camp');
    if (mock.camp.x !== me.x || mock.camp.y !== me.y) return fail('not_at_camp');
    var slots = vaultSlots(), used = 0, moved = {}, k;
    M.EXTRACTION_MATERIALS.forEach(function (m) { used += mock.inv[m].secured; });
    M.EXPEDITION_RESOURCES.forEach(function (r) {
      if (mock.inv[r].carried > 0) {
        moved[r] = mock.inv[r].carried;
        mock.inv[r].secured += mock.inv[r].carried; mock.inv[r].carried = 0;
      }
    });
    M.EXTRACTION_MATERIALS.forEach(function (m) {
      var room = Math.max(0, slots - used);
      if (room > 0 && mock.inv[m].carried > 0) {
        var take = Math.min(room, mock.inv[m].carried);
        mock.inv[m].secured += take; mock.inv[m].carried -= take;
        used += take; moved[m] = take;
      }
    });
    var n = 0;
    mock.cards.forEach(function (c) { if (!c.secured) { c.secured = true; n++; } });
    return { ok: true, moved: moved, cards_secured: n, vault_used: used,
             vault_slots: slots, no_vault: slots === 0,
             vault_full: slots > 0 && used >= slots };
  },

  warpath_recruit: function (a) {
    var me = mock.me;
    var site = mock.world.sites.filter(function (s) { return s.x === me.x && s.y === me.y; })[0];
    if (!site || site.id !== a.p_site) return fail('not_at_site');
    if (mock.recruited.indexOf(a.p_site) >= 0) return fail('site_already_recruited');
    var offer = D.RECRUIT_POOLS[a.p_site].offers[a.p_idx];
    if (!offer) return fail('bad_offer');
    var tent = level('recruitment'), maxRank = [0, 2, 4, 5][Math.min(tent, 3)];
    if (offer.rank > maxRank) {
      return fail('tent_too_small', { tent: tent,
        need_tent: offer.rank <= 2 ? 1 : offer.rank <= 4 ? 2 : 3 });
    }
    var k;
    for (k in offer.cost) if ((mock.inv[k].carried || 0) < offer.cost[k]) {
      return fail('insufficient', { kind: k, need: offer.cost[k], have: mock.inv[k].carried,
                                    wallet: 'carried' });
    }
    for (k in offer.cost) mock.inv[k].carried -= offer.cost[k];
    mock.cards.push({ id: 'c' + (mock.cardSeq++), key: offer.key, source: 'recruit',
                      secured: true, turn: mock.turn });
    mock.recruited.push(a.p_site);
    log('recruited', { site: a.p_site, label: offer.label });
    return { ok: true, card_key: offer.key, label: offer.label };
  },

  warpath_battle_open: function (a) {
    var me = mock.me;
    if (mock.battles.some(function (b) { return b.status === 'open'; })) return fail('battle_already_open');
    var kind, foe = null, lm = null;
    if (a.p_target) {
      foe = mock.others.filter(function (o) { return o.expedition_id === a.p_target; })[0];
      if (!foe) return fail('no_such_hero');
      if (Math.max(Math.abs(foe.x - me.x), Math.abs(foe.y - me.y)) > 1) return fail('out_of_reach');
      kind = 'pvp';
    } else {
      lm = mock.world.landmark;
      if (lm.x !== me.x || lm.y !== me.y || !lm.guardian) return fail('nothing_to_fight');
      if (mock.battles.some(function (b) { return b.kind === 'guardian' && b.status === 'resolved'; })) {
        return fail('guardian_already_faced');
      }
      kind = 'guardian';
    }
    var b = { id: 'b' + mock.battles.length, kind: kind, status: 'open',
              attacker: me.expedition_id, defender: a.p_target || null, x: me.x, y: me.y };
    mock.battles.push(b);
    log('battle_opened', { battle_id: b.id, kind: kind });
    return { ok: true, battle_id: b.id, kind: kind, defender: a.p_target || null,
             x: me.x, y: me.y, landmark: lm };
  },

  warpath_battle_report: function (a) {
    var b = mock.battles.filter(function (z) { return z.id === a.p_battle; })[0];
    if (!b) return fail('no_such_battle');
    if (b.status !== 'open') return { ok: true, we_won_race: false, winner: b.winner };
    b.status = 'resolved'; b.winner = a.p_winner;
    var me = mock.me, spoils = {}, iWon = a.p_winner === me.expedition_id;
    if (b.kind === 'guardian') {
      if (iWon) {
        var mat = mock.world.landmark.reward;
        mock.inv[mat].secured += 1; me.stats.bosses++;
        spoils = { material: mat };
        log('guardian_defeated', spoils);
      } else { me.injured_turns = 2; me.hp = Math.max(1, me.hp - 25); }
    } else if (iWon) {
      me.stats.defeated++; me.stats.raided++;
      log('hero_defeated', { winner: me.hero_name });
    } else {
      M.EXPEDITION_RESOURCES.forEach(function (r) {
        var take = Math.floor(mock.inv[r].carried / 2);
        if (take) { mock.inv[r].carried -= take; spoils[r] = take; }
      });
      M.EXTRACTION_MATERIALS.forEach(function (m) {
        if (mock.inv[m].carried > 0) { mock.inv[m].carried -= 1; spoils[m] = 1; }
      });
      // Unsecured cards drop as well — mirrors warpath_battle_report. This is
      // what makes walking loot home a decision rather than a formality.
      for (var ci = mock.cards.length - 1; ci >= 0; ci--) {
        if (!mock.cards[ci].secured) { spoils.card_lost = 1; mock.cards.splice(ci, 1); break; }
      }
      me.injured_turns = 2; me.hp = Math.max(1, me.hp - 30); me.moves_left = 0;
      // mirrors B3/B4 in the migration
      if (me.status === 'extracting' || me.status === 'ready') { me.status = 'active'; me.extract_left = 0; }
      me.protected_until = mock.turn + 2;
      if (mock.camp) { me.x = mock.camp.x; me.y = mock.camp.y; }
      log('hero_defeated', { loser: me.hero_name, spoils: spoils });
    }
    return { ok: true, we_won_race: true, winner: a.p_winner, spoils: spoils };
  },

  warpath_extract_begin: function () {
    var me = mock.me;
    // ⚠ The status guard mirrors warpath_extract_begin in the migration, which
    // refuses anything that is not 'active'. Without it here a client could
    // call this every turn and reset its own countdown forever — the server
    // was never vulnerable, but the mock is what the screen is developed
    // against, so a rule missing here is a rule nobody sees break.
    if (me.status !== 'active') return fail('not_active', { status: me.status });
    var g = mock.world.gates.filter(function (z) { return z.x === me.x && z.y === me.y; })[0];
    if (!g) return fail('not_at_a_gate');
    var turns = level('arcane') >= 2 ? 1 : D.EXTRACT_TURNS;
    me.status = 'extracting'; me.extract_left = turns;
    log('extraction_started', { hero: me.hero_name, gate: g.name, turns: turns });
    // watchers: the mock has no rival fog to consult, so it reports 0 honestly.
    return { ok: true, turns: turns, gate: g.name, watchers: 0 };
  },

  warpath_extract_finish: function (a) {
    var me = mock.me;
    if (me.status !== 'ready') return fail('not_ready', { status: me.status, extract_left: me.extract_left });
    var cap = extractCap();
    var eligible = mock.cards.filter(function (c) {
      return c.secured && c.source !== 'starter' && (!a.p_keep || a.p_keep.indexOf(c.id) >= 0);
    }).sort(function (p, q) {
      var rank = function (c) { return c.source === 'boss' ? 0 : c.source === 'recruit' ? 1 : 2; };
      return rank(p) - rank(q) || p.turn - q.turn;
    }).slice(0, cap);
    var mats = {};
    M.EXTRACTION_MATERIALS.forEach(function (m) { if (mock.inv[m].secured) mats[m] = mock.inv[m].secured; });
    var summary = {
      cards_discovered: mock.cards.filter(function (c) { return c.source !== 'starter'; }).length,
      cards_secured: eligible.length,
      resources_gathered: mock.gathered || 0,
      bosses_defeated: me.stats.bosses, players_defeated: me.stats.defeated,
      camps_raided: me.stats.raided, distance_travelled: me.stats.distance, turns: mock.turn,
    };
    me.status = 'extracted';
    var grant = { card_keys: eligible.map(function (c) { return c.key; }), materials: mats, summary: summary };
    mock.grants.push(grant);
    return { ok: true, card_keys: grant.card_keys, materials: mats, summary: summary, cap: cap };
  },

  warpath_abandon: function () { mock.me.status = 'lost'; return { ok: true }; },

  // 🔭 Mirrors warpath_scout_report. No new information — direction and band
  // for camps already in explored fog.
  warpath_scout_report: function () {
    var me = mock.me;
    if (me.status !== 'active') return fail('not_active');
    if (me.turn_ended) return fail('turn_already_ended');
    if (!mock.camp) return fail('no_camp');
    if (mock.camp.x !== me.x || mock.camp.y !== me.y) return fail('not_at_camp');
    if (mock.scoutedTurn === mock.turn) return fail('already_scouted_this_turn');
    if (me.moves_left < 1) return fail('no_moves_left');
    mock.scoutedTurn = mock.turn; me.moves_left -= 1;
    // The offline mock has no rival camps at all (see the note in warpath_state),
    // so this honestly reports nothing rather than inventing a target.
    return { ok: true, reports: [], moves_left: me.moves_left,
             summary: 'Your scout finds no sign of anyone. Nobody you have seen is camped near here.' };
  },

  warpath_grants_claim: function () {
    var g = mock.grants.slice(); mock.grants = [];
    return { ok: true, grants: g };
  },

  /* End turn also walks the three rivals one step, so the map is not a still
     life while you are testing. They wander; they do not think. */
  warpath_end_turn: function () {
    var me = mock.me;
    if (me.status !== 'active' && me.status !== 'extracting') return fail('not_active');
    mock.turn++;
    me.turn_ended = false;
    me.moves_left = me.injured_turns > 0 ? 4 : D.ENTRY.moves_per_turn;
    me.injured_turns = Math.max(0, me.injured_turns - 1);
    me.hp = Math.min(me.max_hp, me.hp + 5);
    if (me.status === 'extracting') {
      me.extract_left = Math.max(0, me.extract_left - 1);
      if (me.extract_left <= 0) me.status = 'ready';
    }
    mock.others.forEach(function (o, i) {
      var ns = M.neighbours(o.x, o.y).filter(function (n) {
        var t = mock.world.at(n[0], n[1]); return t && t.passable;
      });
      if (ns.length) {
        var pick = ns[M.wpRoll(mock.seed, mock.turn * 13 + i, o.x + o.y, 30, ns.length)];
        o.x = pick[0]; o.y = pick[1];
      }
    });
    if (mock.turn > mock.maxTurns) {
      if (me.status !== 'extracted') me.status = 'lost';
      log('run_closed', {});
    }
    return { ok: true, turn: mock.turn, advanced: true };
  },
};

function rpcMock(fn, args) {
  return new Promise(function (resolve, reject) {
    var f = MOCK[fn];
    if (!f) { reject(new Error('warpath: no mock for ' + fn)); return; }
    // A small delay keeps the UI's pending states honest instead of instant.
    setTimeout(function () {
      try { resolve(f(args || {})); } catch (e) { reject(e); }
    }, 40);
  });
}

/* Card metadata. Live, the PARENT is authoritative — it holds the real
   catalogs including anything an admin forged, and it is what the battle
   engine will actually deal. Offline we use the generated fallback in
   warpath-data.js so the draft is still readable standalone. */
function cardMeta() {
  if (!EMBEDDED) return Promise.resolve(D.CARD_META);
  return new Promise(function (resolve) {
    var done = false;
    var onMeta = function (ev) {
      var d = ev.data;
      if (!d || d.type !== 'warpath:cardmeta') return;
      window.removeEventListener('message', onMeta);
      done = true;
      // Merge over the fallback so a key the parent does not know about still
      // renders something rather than blanking.
      resolve(Object.assign({}, D.CARD_META, d.meta || {}));
    };
    window.addEventListener('message', onMeta);
    try { window.parent.postMessage({ type: 'warpath:cardmeta:req' }, window.location.origin); }
    catch (e) {}
    setTimeout(function () {
      if (done) return;
      window.removeEventListener('message', onMeta);
      resolve(D.CARD_META);           // parent never answered — degrade, do not hang
    }, 4000);
  });
}

root.WarpathNet = {
  cardMeta: cardMeta,
  embedded: EMBEDDED,
  mode: EMBEDDED ? 'live' : 'offline',
  rpc: function (fn, args) { return EMBEDDED ? rpcParent(fn, args) : rpcMock(fn, args); },
  // Offline only: the screen reads the fog bitmap straight out of the mock.
  mockFog: function () { return mock && mock.fog; },
};

})(typeof window !== 'undefined' ? window : this);
