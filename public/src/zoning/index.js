/* ══════════════════════════════════════════════════════════════════════════
   🗺 ZONING — land use, the three CS2 tools, and the bulk build.
   Registered as window.MythicZoning. Mounted from node-city/index.html's
   boot(), BEFORE loadState() — see the mount site for why the order matters.

   WHAT THIS LAYER IS
   A zone is an intent recorded against a tile: "this is where the row housing
   goes". It is not a building, it costs nothing, and painting one never
   demolishes anything. Two things read it:
     1. buildMesh, for housing — a zoned plot builds the archetype the player
        chose instead of the one makeHousing's district roll would have rolled
        (see seed.js for how that is done without editing makeHousing).
     2. develop(), which raises buildings on zoned, road-fronted, empty land
        through the SHIPPED tryPlace gate.

   🔴 THE GLOBALS TRAP (CLAUDE.md). Everything this module needs — game, THREE,
   scene, BUILDINGS, tryPlace, buildMesh, rdRng — is a top-level `const` in
   node-city's module script and is therefore invisible here. `ctx` IS the
   hand-over. Never reach for a bare global, and never assume window.Foo exists
   because `const Foo` does.

   DEGRADING (all four cases are real and all four are handled):
     • module 404s        → node-city's guarded import warns, zones ride the
                            save untouched in game.zones, houses roll as before.
     • save predates this → afterLoad() adopts what is standing (see below).
     • a BUILDINGS id in a zone mix is retired → it drops out of that mix.
     • three/scene missing → the overlay is skipped, the data layer still works.
   ══════════════════════════════════════════════════════════════════════════ */

import { ZONES, ZONE_BY_ID, CATS, ADOPT_BY_TYPE } from './zones.js';
import { makeSeeder } from './seed.js';
import { makeOverlay } from './overlay.js';
import { mountUI } from './ui.js';

/* A fill that is not bounded by roads or by a zone edge would swallow the
   board on one click. Roads DO bound it (that is what makes a fill mean "this
   block"), but open ground does not, so the flood also carries a hard cap and
   says when it hit it. 400 ≈ two thirds of a 24x24 board. */
const FILL_MAX = 400;

export function mount(ctx) {
  ctx = ctx || {};
  const G = ctx.game || {};
  const GRID = ctx.GRID || 24, HALF = ctx.HALF != null ? ctx.HALF : GRID / 2;
  const BUILDINGS = ctx.BUILDINGS || {};
  const MAX_LVL = ctx.MAX_LVL || 3;
  const key = ctx.key || ((x, z) => x + ',' + z);
  const inGrid = ctx.inGrid || ((x, z) => x >= 0 && z >= 0 && x < GRID && z < GRID);
  const tileAt = ctx.tileAt || ((x, z) => (G.tiles || {})[key(x, z)] || null);
  const isRoad = ctx.isRoad || ((x, z) => { const t = tileAt(x, z); return !!t && t.type === 'road'; });
  const toast = ctx.toast || function () {};
  const logEvent = ctx.logEvent || function () {};
  const saveSoon = ctx.saveSoon || function () {};

  const seeder = makeSeeder(ctx.rdRng);

  /* ── the zone mixes, validated against the LIVE table ──────────────────── */
  const MIX = {};
  for (const z of ZONES) {
    const bag = [];
    for (const [type, w] of (z.mix || [])) {
      if (!BUILDINGS[type]) continue;                 // retired id — drop it
      for (let i = 0; i < w; i++) bag.push(type);
    }
    MIX[z.id] = bag;
  }

  /* ── the store. game.zones is owned HERE and serialised by node-city with
     one line, so a build where this module fails to load still round-trips a
     player's zoning instead of erasing it. ─────────────────────────────── */
  if (!G.zones || typeof G.zones !== 'object') G.zones = {};
  /* ⚠ EVERY read below goes through `G.zones`, never through a captured
     reference to the object. loadState REPLACES game.zones wholesale when a
     save comes off disk, and a module holding the old object would quietly
     write into a map nobody serialises. */

  const zoneAt = (x, z) => (G.zones[key(x, z)] || null);
  const zoneDef = (x, z) => ZONE_BY_ID[zoneAt(x, z)] || null;

  /* ── overlay ───────────────────────────────────────────────────────────── */
  // ⚠ Declared ABOVE sync(): a `let` is in the temporal dead zone until its own
  //   line runs, and sync() is hoisted, so any early caller would throw.
  let _overlayOn = false, _onChange = null;
  let ov = null;
  try {
    if (ctx.THREE && ctx.scene) ov = makeOverlay(ctx.THREE, ctx.scene, HALF);
  } catch (e) { console.warn('[Zoning] overlay unavailable (non-fatal):', e); }
  const colOf = (id) => (ZONE_BY_ID[id] ? ZONE_BY_ID[id].col : null);
  function sync() {
    if (ov) { ov.rebuild(G.zones, colOf); ov.setVisible(_overlayOn); }
    if (_onChange) { try { _onChange(); } catch (e) {} }
  }

  /* ══ RESTYLE ═══════════════════════════════════════════════════════════════
     Re-zoning a block that is ALREADY BUILT restyles its houses on the spot.
     This is not a flourish — it is the only way the feature can be honest.
     buildMesh consults the zone every time it builds a housing mesh, so without
     this the change would appear on the NEXT reload and not before, i.e. the
     player would zone towers, see terraces, refresh, and find towers. Rebuilt
     in small batches off a timer because a marquee across a built district can
     ask for a hundred rebuilds at once and buildMesh is the most expensive call
     in the game.
     Only the MESH changes. Type, level, wear, born, spent and earn are all
     untouched: a re-zone is a re-skin, never a demolition, and it costs
     nothing. ═══════════════════════════════════════════════════════════════ */
  const _restyle = [];
  let _restyleTimer = 0;
  function queueRestyle(x, z) {
    const k = key(x, z);
    if (_restyle.indexOf(k) < 0) _restyle.push(k);
    if (!_restyleTimer) _restyleTimer = setTimeout(drainRestyle, 0);
  }
  function rebuildMesh(t, x, z) {
    if (!ctx.buildMesh || !ctx.placeMeshAt) return false;
    try {
      if (ctx.dropTileMesh) ctx.dropTileMesh(t);
      // ⚠ Same expression loadState uses — a leased Lease Plot draws as the
      //    tenant's business, not as a plot, and re-deriving it here wrongly
      //    would blank a tenant's shopfront.
      t.mesh = ctx.buildMesh(t.type === 'lot' && t.tenant ? 'tenantbiz' : t.type, t.lvl, x, z);
      ctx.placeMeshAt(t.mesh, x, z, t.rot);
      // ⚠ A fresh mesh comes back UNDAMAGED. loadState re-applies the wreck skin
      //    for the same reason; without this, re-zoning a bombed-out block would
      //    silently repair it on screen while the tile stayed broken.
      if (t.damaged && ctx.applyDamagedLook) { try { ctx.applyDamagedLook(t); } catch (e) {} }
      return true;
    } catch (e) { console.warn('[Zoning] restyle failed', e); return false; }
  }
  function drainRestyle() {
    _restyleTimer = 0;
    let n = 0;
    while (_restyle.length && n < 16) {
      const k = _restyle.shift(); n++;
      const t = (G.tiles || {})[k]; if (!t || t.type !== 'housing') continue;
      const c = k.split(','); rebuildMesh(t, +c[0], +c[1]);
    }
    if (_restyle.length) _restyleTimer = setTimeout(drainRestyle, 0);
  }
  /* Which archetype a house on this plot ends up with — the zone's, or the
     district roll when the plot is unzoned or carries the grandfather zone.
     Used to decide whether a re-zone is even a visible change. */
  function archOn(x, z, id) {
    const d = ZONE_BY_ID[id];
    if (d && d.arch) return d.arch;
    return seeder.predict(x, z);
  }

  /* ══ WRITING ZONES ════════════════════════════════════════════════════════ */
  function setZone(x, z, id, opt) {
    if (!inGrid(x, z)) return false;
    // 🛤 Roads are not zoned. A carriageway is not land use, and letting the
    //    film cover it hides the markings that make the street readable.
    if (isRoad(x, z)) return false;
    if (id != null && !ZONE_BY_ID[id]) return false;
    const k = key(x, z), was = G.zones[k] || null;
    if ((was || null) === (id || null)) return false;
    if (id) G.zones[k] = id; else delete G.zones[k];
    const t = (G.tiles || {})[k];
    if (t && t.type === 'housing' && archOn(x, z, was) !== archOn(x, z, id)) queueRestyle(x, z);
    if (!opt || !opt.bulk) { sync(); saveSoon(); }
    return true;
  }

  /* PAINT — one cell. */
  function applyPaint(x, z, id) {
    const n = setZone(x, z, id) ? 1 : 0;
    return { changed: n, total: 1 };
  }

  /* MARQUEE — a rectangle of any size, inclusive of both corners. */
  function applyRect(x0, z0, x1, z1, id) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    const az = Math.min(z0, z1), bz = Math.max(z0, z1);
    let changed = 0, total = 0;
    for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) {
      if (!inGrid(x, z)) continue;
      total++;
      if (setZone(x, z, id, { bulk: true })) changed++;
    }
    if (changed) { sync(); saveSoon(); }
    return { changed, total };
  }

  /* FILL — flood the contiguous run of land that currently shares the clicked
     cell's zone (unzoned counts as a zone of its own), bounded by roads and by
     the board edge. That is what makes one click mean "this block". */
  function applyFill(x, z, id) {
    if (!inGrid(x, z) || isRoad(x, z)) return { changed: 0, total: 0, capped: false };
    const from = zoneAt(x, z);
    if ((from || null) === (id || null)) return { changed: 0, total: 0, capped: false };
    const seen = {}, stack = [[x, z]], hit = [];
    let capped = false;
    while (stack.length) {
      const [cx, cz] = stack.pop();
      const k = key(cx, cz);
      if (seen[k]) continue;
      seen[k] = 1;
      if (!inGrid(cx, cz) || isRoad(cx, cz)) continue;
      if ((zoneAt(cx, cz) || null) !== (from || null)) continue;
      hit.push([cx, cz]);
      if (hit.length >= FILL_MAX) { capped = true; break; }
      stack.push([cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]);
    }
    let changed = 0;
    for (const [hx, hz] of hit) if (setZone(hx, hz, id, { bulk: true })) changed++;
    if (changed) { sync(); saveSoon(); }
    return { changed, total: hit.length, capped };
  }

  /* ══ THE BUILDMESH HOOK ═══════════════════════════════════════════════════
     Returns surrogate seed coords for a zoned housing plot, or null to leave
     makeHousing exactly as it was. Called for EVERY housing mesh — placement,
     load, upgrade, repair, re-skin — which is precisely why it must be a pure
     function of the tile and the zone. See seed.js. ══════════════════════ */
  function housingSeed(tx, tz) {
    const d = zoneDef(tx, tz);
    if (!d || !d.arch) return null;
    return seeder.surrogate(tx, tz, d.arch);
  }

  /* ══ DEVELOP ══════════════════════════════════════════════════════════════
     Raise buildings on zoned land, through tryPlace — the shipped gate, with
     its costs, caps, population check and concourse clearance intact. Nothing
     here re-implements any of that.

     🍞 WHY ONE SUMMARY AND NOT FORTY TOASTS. tryPlace reports every refusal as
     a toast, and the rail holds three. A 40-tile marquee that half fails would
     therefore show the player three arbitrary refusals, drop the rest, and
     leave them with no idea what happened to the other 37 tiles. So a bulk run
     redirects toast into a sink (window.__ncToastSink, a three-line hook in
     node-city's toast()), keeps the SHIPPED refusal text — which already says
     what is wrong and how to fix it — counts identical reasons, and prints one
     line: how many went up, how many did not, and the two commonest reasons
     verbatim. Nothing is invented and nothing is swallowed: the full breakdown
     goes to the city log and is returned to the caller.

     🛤 ROAD FRONTAGE IS REQUIRED, and this is a deliberate rule of the zoning
     layer rather than of tryPlace (which allows an isolated building). It is
     what makes a marquee produce streets instead of a solid slab of buildings,
     it matches every reference frame in BAR.md, and it is reported rather than
     silent: "N waiting on road frontage" tells the player to draw a road. */
  function roadFront(x, z) {
    return isRoad(x + 1, z) || isRoad(x - 1, z) || isRoad(x, z + 1) || isRoad(x, z - 1);
  }
  function typeFor(zdef, x, z) {
    const bag = MIX[zdef.id] || [];
    if (!bag.length) return null;
    // Deterministic per plot: the same tile always develops as the same thing,
    // so a develop that was refused for money and retried later does not
    // shuffle the street into a different set of businesses.
    const h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ 0x7f4a7c15) >>> 0;
    return bag[h % bag.length];
  }
  /* Does what is STANDING on this plot belong to this zone? A tile the player
     built by hand inside a zone counts, which is what lets "high density" mean
     something on a block that is already there — see the grow half of plan(). */
  function belongs(zdef, t) {
    if (!t || !zdef) return false;
    if (zdef.arch && t.type === 'housing') return true;               // residential
    return (MIX[zdef.id] || []).indexOf(t.type) >= 0;
  }
  function targetLvl(zdef, t) {
    const def = BUILDINGS[t.type] || {};
    return Math.min(zdef.lvl | 0, def.maxLvl || MAX_LVL);
  }
  /* THE PLAN IS TWO LISTS, and the second one is the reason "high density"
     means anything on land that is already built: `out` is vacant plots to
     raise a building on, `grow` is buildings that already belong to their zone
     but are shorter than the zone asks for. Both are paid for at the shipped
     price and both are counted into the button's estimate, because a button
     that spends money it did not name is the worst kind of bulk action. */
  function plan(only) {
    const out = [], grow = [], skip = { occupied: 0, noroad: 0, nomix: 0 };
    const keys = Object.keys(G.zones).sort();
    for (const k of keys) {
      const d = ZONE_BY_ID[G.zones[k]];
      if (!d) continue;
      if (only && d.id !== only) continue;
      const c = k.split(','), x = +c[0], z = +c[1];
      if (!isFinite(x) || !isFinite(z) || !inGrid(x, z)) continue;
      const t = tileAt(x, z);
      if (t) {
        // ⚠ A damaged building is never grown: an upgrade on a wreck is money
        //    spent on something the player has to repair anyway.
        if (!t.damaged && belongs(d, t) && (t.lvl | 0) < targetLvl(d, t)) grow.push({ x, z, t, zone: d });
        else skip.occupied++;
        continue;
      }
      if (!roadFront(x, z)) { skip.noroad++; continue; }
      const type = typeFor(d, x, z);
      if (!type) { skip.nomix++; continue; }
      out.push({ x, z, type, zone: d });
    }
    return { out, grow, skip };
  }
  function planCost(list, grow) {
    let cin = 0;
    if (!ctx.costOf) return 0;
    for (const p of (list || [])) { try { const c = ctx.costOf(p.type, 1); cin += (c && c.cinder) | 0; } catch (e) {} }
    for (const p of (grow || [])) {
      try {
        for (let l = (p.t.lvl | 0) + 1; l <= targetLvl(p.zone, p.t); l++) {
          const c = ctx.costOf(p.t.type, l); cin += (c && c.cinder) | 0;
        }
      } catch (e) {}
    }
    return cin;
  }

  async function growTo(t, x, z, target) {
    const def = BUILDINGS[t.type] || {};
    const cap = Math.min(target | 0, def.maxLvl || MAX_LVL);
    let grew = false;
    while (t.lvl < cap) {
      let cost = null;
      try { cost = ctx.costOf ? ctx.costOf(t.type, t.lvl + 1) : null; } catch (e) { break; }
      if (!cost || !ctx.payCost) break;
      let paid = false;
      try { paid = await ctx.payCost(cost); } catch (e) { paid = false; }
      if (!paid) break;
      // Same two lines the inspector's upgrade button runs, lifetime spend
      // included — a building grown by the zoning pass must not have a hole in
      // its ledger next to one grown by hand.
      t.spent = (t.spent || 0) + ((cost && cost.cinder) | 0);
      t.lvl++;
      grew = true;
    }
    if (grew) rebuildMesh(t, x, z);
    return grew;
  }

  let _developing = false;
  async function develop(opt) {
    if (_developing) return null;
    opt = opt || {};
    const { out: list, grow, skip } = plan(opt.zone || null);
    if (!list.length && !grow.length) {
      const why = skip.noroad ? skip.noroad + ' zoned ' + (skip.noroad === 1 ? 'tile is' : 'tiles are') + ' waiting on road frontage — draw a road beside them.'
        : skip.occupied ? 'Every zoned tile is already built to the density its zone asks for.'
        : 'Nothing is zoned yet — pick a zone and paint some land.';
      toast('🗺 Nothing to raise. ' + why, 'bad');
      return { built: 0, grown: 0, planned: 0, skip, reasons: {} };
    }
    _developing = true;
    const reasons = {};
    let built = 0, grown = 0, raised = 0, last = null;   // `raised` = the grow list only
    const prevSink = window.__ncToastSink;
    window.__ncToastSink = (msg) => { last = msg; };
    try {
      for (const p of list) {
        last = null;
        try { await ctx.place(p.type, p.x, p.z); } catch (e) { last = last || String(e && e.message || e); }
        const t = tileAt(p.x, p.z);
        if (t) {
          built++;
          if (await growTo(t, p.x, p.z, p.zone.lvl || 1)) grown++;
        } else {
          const r = last || 'Refused with no reason given.';
          reasons[r] = (reasons[r] || 0) + 1;
        }
      }
      // Then bring what is already standing up to the density of its zone.
      // Same paid path, same rebuild, and it is what makes re-zoning a built
      // block to "high density towers" do anything at all.
      for (const p of grow) {
        if (tileAt(p.x, p.z) !== p.t) continue;    // it moved under us
        if (await growTo(p.t, p.x, p.z, targetLvl(p.zone, p.t))) { grown++; raised++; }
        else {
          const r = 'Could not afford to grow ' + ((BUILDINGS[p.t.type] || {}).name || p.t.type) + ' any taller.';
          reasons[r] = (reasons[r] || 0) + 1;
        }
      }
    } finally {
      window.__ncToastSink = prevSink || null;
      _developing = false;
    }
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
    const bits = [];
    if (skip.occupied) bits.push(skip.occupied + ' already built on');
    if (skip.noroad) bits.push(skip.noroad + ' with no road frontage');
    const head = '🏗 Zoned build: ' + built + ' of ' + list.length + ' plot' + (list.length === 1 ? '' : 's') + ' raised' +
                 (grow.length ? ' · ' + raised + ' of ' + grow.length + ' grown taller' : '') +
                 (bits.length ? ' · skipped ' + bits.join(', ') : '');
    const tail = top.length ? ' — ' + top.slice(0, 2).map(([m, n]) => '“' + m + '”' + (n > 1 ? ' ×' + n : '')).join(' ') : '';
    toast(head + tail, built ? 'good' : 'bad');
    logEvent('city', head + (top.length ? ' · refusals: ' + top.map(([m, n]) => m + ' ×' + n).join(' | ') : ''));
    if (ctx.computeLinks) { try { ctx.computeLinks(); } catch (e) {} }
    if (ctx.updateHUD) { try { ctx.updateHUD(); } catch (e) {} }
    // The zone map did not change, but what is STANDING on it did — the panel
    // counts built vs vacant plots and would otherwise still show the board as
    // it was before the run.
    sync();
    saveSoon();
    return { built, grown, raised, planned: list.length, growPlanned: grow.length, skip, reasons };
  }

  /* ══ GRANDFATHERING ═══════════════════════════════════════════════════════
     Called once, right after loadState. A city that predates zoning has no
     zone map, and two bad answers were rejected before this one:

       ✗ leave it blank — the overlay then paints a fully built city as
         unzoned wasteland, which is a lie about what is standing there;
       ✗ adopt housing into the matching density zone — that hands every
         existing house an archetype, and on the next mesh rebuild an entire
         city's streets silently change shape. makeHousing's own comment
         records this exact class of bug ("a street re-rolled its whole
         appearance on every reload") and it is not being reintroduced here.

     So: every built tile is adopted into the zone that matches what stands on
     it, and residential adopts into `r_asbuilt`, a real zone with NO archetype.
     The overlay tells the truth, nothing changes shape, and the player can
     re-zone any block to restyle it deliberately. It is logged, because a
     save that silently grew a field is worse than one that says so.

     ⚠ KNOWN AND ACCEPTED: a player who de-zones their ENTIRE city and reloads
       gets it adopted again, because "no zones at all" is indistinguishable
       from "never zoned" without spending a second save field on the question.
       The consequence is bounded — the overlay repopulates, no building changes
       shape (r_asbuilt has no archetype), and nothing is built or spent without
       the Develop button — so it is not worth a migration. */
  let _adopted = false;
  function afterLoad(opt) {
    // `force` is for the diagnostics seam only — grandfathering is a once-per-
    // load event and a test cannot otherwise reach it, because by the time a
    // test can run, boot() has already spent it on an empty board.
    if (opt && opt.force) _adopted = false;
    if (!G.zones || typeof G.zones !== 'object') G.zones = {};
    // Unknown ids are KEPT but not drawn: a save written by a newer build that
    // knows more zones must not be quietly stripped by an older one.
    if (!_adopted && !Object.keys(G.zones).length) {
      _adopted = true;
      let n = 0, res = 0;
      for (const k in (G.tiles || {})) {
        const t = G.tiles[k]; if (!t || t.type === 'anchor' || t.type === 'road') continue;
        const id = ADOPT_BY_TYPE[t.type]; if (!id) continue;
        G.zones[k] = id; n++;
        if (id === 'r_asbuilt') res++;
      }
      if (n) {
        logEvent('city', '🗺 Zoning arrived — ' + n + ' built tile' + (n === 1 ? '' : 's') +
          ' adopted into the land use that matches what stands there' +
          (res ? ', ' + res + ' of them as “Residential · as built”: those houses keep exactly the look they were built with until you re-zone them' : '') + '.');
      }
    }
    sync();
    return { zoned: Object.keys(G.zones).length };
  }

  function stats() {
    const per = {};
    let developed = 0, empty = 0;
    for (const k in G.zones) {
      const id = G.zones[k];
      per[id] = (per[id] || 0) + 1;
      if ((G.tiles || {})[k]) developed++; else empty++;
    }
    return { zoned: Object.keys(G.zones).length, per, developed, empty,
             overlay: !!(ov && ov.visible()) };
  }

  const api = {
    ZONES, ZONE_BY_ID, CATS,
    zoneAt, zoneDef, setZone,
    applyPaint, applyRect, applyFill,
    housingSeed, afterLoad, develop, plan: (only) => plan(only || null), planCost,
    stats, sync,
    overlay: (v) => { _overlayOn = v == null ? !_overlayOn : !!v; if (ov) { ov.rebuild(G.zones, colOf); ov.setVisible(_overlayOn); } return _overlayOn; },
    preview: (rect, hex) => { if (ov) ov.preview(rect, hex); },
    /* Diagnostics: predict() answers "what would the district roll build here",
       selfTest() checks this module's copy of makeHousing's weights against
       itself. Both are how the coupling documented in seed.js gets audited. */
    predict: (x, z) => seeder.predict(x, z),
    selfTest: (n) => seeder.selfTest(n),
    save: () => G.zones,
    onChange: (fn) => { _onChange = fn; },
    _ctx: ctx,
  };

  let ui = null;
  try { ui = mountUI(api, ctx); } catch (e) { console.warn('[Zoning] panel not mounted (non-fatal):', e); }
  /* The panel is a convenience over the data layer, never a gate on it: every
     one of these is a no-op if the DOM half failed to mount, and applyPaint /
     applyRect / applyFill / develop all work without it. */
  api.panel = (v) => (ui ? ui.open(v == null ? true : v) : null);
  api.tool = (t) => (ui ? ui.tool(t) : null);
  api.select = (z) => (ui ? ui.zone(z) : null);
  api.armed = (v) => (ui ? ui.armed(v) : false);

  window.MythicZoning = api;
  return api;
}
