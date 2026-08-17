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
    const out = [], grow = [], skip = { occupied: 0, noroad: 0, nomix: 0, building: 0 };
    const keys = Object.keys(G.zones).sort();
    for (const k of keys) {
      const d = ZONE_BY_ID[G.zones[k]];
      if (!d) continue;
      if (only && d.id !== only) continue;
      const c = k.split(','), x = +c[0], z = +c[1];
      if (!isFinite(x) || !isFinite(z) || !inGrid(x, z)) continue;
      const t = tileAt(x, z);
      if (t) {
        /* 🏗 A TILE WITH A BUILD ORDER ON IT IS A HOLE IN THE GROUND, and it is
           counted apart from `occupied` because it is the one skip that clears
           itself: the development run keeps ticking while sites are open and
           picks these up the moment they land. Growing one would also be a real
           bug rather than a wasted click — the upgrade button's own first line
           is `if (bldBusy(t)) return`, because a second paid order on a tile
           overwrites the first one's refund basis. */
        if (t.bld) { skip.building++; continue; }
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

  /* ══ DEVELOPMENT: HOW A ZONED DISTRICT ACTUALLY GETS BUILT ════════════════
     🔴 THE COLLISION THIS RESOLVES, WRITTEN DOWN SO IT IS NOT "FIXED" AGAIN.
     This used to be one loop: press Develop, and every zoned plot was ordered
     back to back. Measured, that produced a 476-tile rectangle that planned 107
     buildings, RAISED TWO, and refused the other 105 with "🏗 Every crew is
     working — 2 / 2 on site". Both halves of that are working as designed.
     node-city's Municipal Works crews are deliberately scarce (ECON
     construction.municipal.slots = 2) — the crew limit is the cost the player
     plays hand placement against. Zoning is the tool that develops a DISTRICT.
     A district is a hundred buildings. Two crews and a hundred buildings cannot
     both be right in the same gesture.

     ✗ REJECTED — raise the crew count. It re-tunes hand placement and the
       entire construction feature for the whole game to fix one button.
     ✗ REJECTED — a paid queue the crews work through. The order gate rejected
       exactly this in its own header ("paying now for something that starts in
       twenty hours is the worst possible shape for a 24-hour timer, and a queue
       adds a paid-but-unstarted persisted state with its own cancel, load and
       reconciliation paths"), and nothing about zoning makes that objection any
       less true — it multiplies it by a hundred.
     ✗ REJECTED — raise zoned buildings instantly. A house that pops the moment
       it is permitted, next to a hand-placed farm serving a nine-minute timer,
       reads as two different games; and it would delete the only thing that
       makes density feel like it costs something other than money.

     ✅ THE ANSWER IS CS2's, AND IT IS A DIFFERENT PATH RATHER THAN A BIGGER ONE.
     The mayor's crews build what the MAYOR places. Zoned land is built out by
     PRIVATE developers: the player permits the land use, and buildings go up
     over time on their own — one permit every ECON.construction.zoned.permitSec,
     at most `sites` under construction at once, each still paying the shipped
     price through payCost and each still serving its full build timer. Those
     sites are counted OUT of the crew load by node-city (bldCrewLoad), so a
     district building itself can never starve the player's own two crews, and
     bldSlots() is untouched.

     WHAT MAKES IT HONEST RATHER THAN A CHEAT CODE:
       • it can only raise what a zone MIX lists, never anything else on the
         shelf, and every other refusal still applies — the municipal ceiling
         included, so a pre-Co. city still cannot grow a zone full of Cinder
         earners;
       • NOTHING IS EVER PAID IN ADVANCE. The plan is re-derived from the zone
         map on every single permit, so there is no queue on disk: nothing to
         cancel, nothing to refund, nothing to reconcile on load. De-zone the
         rest of the district mid-run and the run simply has less to do;
       • the run stops itself after `stopAfterRefusals` refusals in a row and
         says why. Money is the refusal that repeats, and a drip that kept
         asking would empty a treasury one plot at a time in silence;
       • it only runs while the city is open, and the panel says so. Permits
         are never issued for time the player was away — that would be an
         unattended spend, which is the one thing a bulk tool must not do. (The
         SITES themselves finish offline; a build deadline is wall-clock.)

     🍞 STILL ONE SUMMARY, NEVER FORTY TOASTS. tryPlace reports every refusal as
     a toast and the rail holds three, so a run redirects toast into a sink
     (window.__ncToastSink, a three-line hook in node-city's toast()), keeps the
     SHIPPED refusal text, counts identical reasons, and prints one line when
     the run ends. The panel carries the live count in between. ═══════════ */

  /* The pacing, or null when there is no economy module. That case is not a
     missing feature, it is a DIFFERENT CITY: with /src/economy absent
     bldDuration() returns 0, nothing writes a timer, there is no crew gate at
     all, and one press correctly builds the whole district exactly as it did
     before this feature existed. Hence the "everything, now" shape below rather
     than a fallback literal (Rule 4). */
  const DEV_BURST = { sites: Infinity, permitSec: 0, perPermit: Infinity, stopAfterRefusals: 3 };
  function devCfg() {
    try {
      const C = window.MythicEconomy && window.MythicEconomy.ECON && window.MythicEconomy.ECON.construction;
      if (C && C.on && C.zoned && C.zoned.on) return C.zoned;
    } catch (e) {}
    return null;
  }

  /* ── DEVELOPMENT SITES ────────────────────────────────────────────────────
     The plots THIS layer permitted that are still under construction. node-city
     asks for this count (bldDevSites / bldIsDev) to keep them out of the crew
     load, so it has to be right in both directions: a site missed here charges
     a private build to the player's crews, and a stale key here hands the
     player a crew slot that is not free.
     ⚠ MEMBERSHIP IS REMEMBERED, THE COUNT IS DERIVED. The set is a list of keys
       this layer ordered; every read re-verifies each one against live `t.bld`
       and drops it the moment the build lands, is cancelled or is demolished.
       It cannot be stored on the record instead — node-city's bldLoad() rebuilds
       `bld` field by field, so a flag written there would not survive a reload.
     ⚠ `k === 0` (a SITE): an upgrade order is never one of ours. growTo() pays
       for its levels directly and writes no build record at all. */
  const _sites = new Set();
  function siteLive(k) { const t = (G.tiles || {})[k]; return !!(t && t.bld && (t.bld.k | 0) === 0); }
  function devSite(k) {
    if (!_sites.has(k)) return false;
    if (siteLive(k)) return true;
    _sites.delete(k);
    return false;
  }
  function devSites() { let n = 0; for (const k of Array.from(_sites)) if (devSite(k)) n++; return n; }

  /* ── THE RUN ──────────────────────────────────────────────────────────────
     `_run` IS the whole persisted state of development, and it is one intent
     plus counters — no queue, by design (see above). */
  let _run = null, _developing = false, _lastRefusal = null;
  const runCfg = () => devCfg() || DEV_BURST;

  /* The next thing to build: a vacant plot first, a too-short building second.
     A district wants BUILDINGS before it wants storeys — a run that spent its
     first ten permits adding floors to one street while the rest of the
     rectangle stayed bare would read as broken. Re-derived every permit, never
     cached: that is what makes de-zoning mid-run work. */
  function nextJob(run) {
    const p = plan(run.zone);
    for (const j of p.out) if (!run.skip.has(key(j.x, j.z))) return { kind: 'raise', job: j, plan: p };
    for (const j of p.grow) if (!run.skip.has(key(j.x, j.z))) return { kind: 'grow', job: j, plan: p };
    return { kind: null, job: null, plan: p };
  }

  function noteRefusal(run, k, why) {
    run.refused++;
    run.streak++;
    run.skip.add(k);                       // never ask the same plot twice in one run
    const r = why || 'Refused with no reason given.';
    run.reasons[r] = (run.reasons[r] || 0) + 1;
  }

  /* ONE PERMIT. Everything a single plot costs the run, including the decision
     not to issue it. Returns true if something was ordered. */
  async function permitOne(run, cfg) {
    const { kind, job } = nextJob(run);
    if (!job) return false;
    const k = key(job.x, job.z);
    if (kind === 'raise') {
      if (devSites() >= cfg.sites) return false;         // no room on site — wait for the next tick
      _lastRefusal = null;
      const place = ctx.placeZoned || ctx.place;
      try { await place(job.type, job.x, job.z); } catch (e) { _lastRefusal = _lastRefusal || String(e && e.message || e); }
      const t = tileAt(job.x, job.z);
      if (!t) { noteRefusal(run, k, _lastRefusal); return true; }
      run.built++; run.streak = 0;
      if (t.bld) _sites.add(k);
      /* No timer ⇒ the building is finished the instant it is placed, so the
         zone's density can be applied here. With a timer it CANNOT be: an
         upgrade on a site would overwrite that order's refund basis (see
         plan()). The tile comes back through the grow half of the plan on a
         later permit, once its scaffolding is down. */
      else if (await growTo(t, job.x, job.z, job.zone.lvl || 1)) run.grown++;
      return true;
    }
    if (tileAt(job.x, job.z) !== job.t) return true;      // it moved under us; re-plan next permit
    if (await growTo(job.t, job.x, job.z, targetLvl(job.zone, job.t))) { run.grown++; run.raised++; run.streak = 0; }
    else noteRefusal(run, k, 'Could not afford to grow ' + ((BUILDINGS[job.t.type] || {}).name || job.t.type) + ' any taller.');
    return true;
  }

  async function tickDev() {
    if (!_run || _developing) return;
    const run = _run, cfg = runCfg();
    _developing = true;
    const prevSink = window.__ncToastSink;
    window.__ncToastSink = (msg) => { _lastRefusal = msg; };
    let issued = 0;
    try {
      while (_run === run && issued < cfg.perPermit) {
        if (run.streak >= (cfg.stopAfterRefusals | 0 || 3)) break;
        if (!(await permitOne(run, cfg))) break;
        issued++;
      }
    } finally {
      window.__ncToastSink = prevSink || null;
      _developing = false;
    }
    if (_run !== run) return;                            // stopped from under us
    if (run.streak >= (cfg.stopAfterRefusals | 0 || 3)) { stopDev('stalled'); return; }
    /* NOTHING LEFT TO ORDER is not the same as FINISHED: the last few permits
       may still be standing as scaffolding, and the storeys their zones ask for
       can only be added once they land. So the run idles until its own sites are
       clear, and only then declares the district done. */
    if (!nextJob(run).job && !devSites()) { stopDev('done'); return; }
    if (issued) { if (ctx.updateHUD) { try { ctx.updateHUD(); } catch (e) {} } sync(); saveSoon(); }
  }

  function runSummary(run) {
    const top = Object.entries(run.reasons).sort((a, b) => b[1] - a[1]);
    return { built: run.built, grown: run.grown, raised: run.raised, refused: run.refused,
             reasons: run.reasons, top };
  }

  /* Stop, and say what happened ONCE. `why` is why we are stopping, not a
     failure: 'done' (nothing left), 'stalled' (refused too many times in a
     row), 'paused' (the player pressed the button). */
  function stopDev(why) {
    const run = _run;
    if (!run) return null;
    _run = null;
    if (run.timer) { try { clearInterval(run.timer); } catch (e) {} }
    const s = runSummary(run);
    const open = devSites();
    const head = '🏗 Zoned development ' +
      (why === 'done' ? 'complete' : why === 'stalled' ? 'paused' : 'paused') + ' — ' +
      s.built + ' plot' + (s.built === 1 ? '' : 's') + ' raised' +
      (s.grown ? ', ' + s.grown + ' grown taller' : '') +
      (open ? ' · ' + open + ' still under construction' : '');
    const tail = s.top.length
      ? ' — ' + (why === 'stalled' ? 'stopped after ' + s.top[0][1] + ' refusals in a row: ' : '') +
        s.top.slice(0, 2).map(([m, n]) => '“' + m + '”' + (n > 1 ? ' ×' + n : '')).join(' ') +
        (why === 'stalled' ? ' Fix that and press Develop again.' : '')
      : '';
    toast(head + tail, s.built || why === 'done' ? 'good' : 'bad');
    logEvent('city', head + (s.top.length ? ' · refusals: ' + s.top.map(([m, n]) => m + ' ×' + n).join(' | ') : ''));
    if (ctx.computeLinks) { try { ctx.computeLinks(); } catch (e) {} }
    if (ctx.updateHUD) { try { ctx.updateHUD(); } catch (e) {} }
    // The zone map did not change, but what is STANDING on it did — the panel
    // counts built vs vacant plots and would otherwise still show the board as
    // it was before the run.
    sync();
    saveSoon();
    return { ...s, why, running: false };
  }

  function startRun(zone, quiet) {
    const cfg = runCfg();
    _run = { zone: zone || null, built: 0, grown: 0, raised: 0, refused: 0,
             reasons: {}, streak: 0, skip: new Set(), timer: 0, started: Date.now() };
    /* setInterval, not a chain of timeouts: a permit that takes longer than the
       interval is covered by the `_developing` latch in tickDev, so ticks can
       never overlap or compound. permitSec 0 ⇒ no economy module ⇒ no timers to
       pace against, and the single call below does the lot. */
    if (cfg.permitSec > 0) _run.timer = setInterval(() => { tickDev(); }, cfg.permitSec * 1000);
    if (!quiet) sync();
    return _run;
  }

  /* THE BUTTON. Starts development (and issues the first permit immediately —
     a button that does nothing for ten seconds reads as broken), or, with
     `toggle`, pauses a run that is already going. */
  async function develop(opt) {
    opt = opt || {};
    if (_run) {
      if (opt.toggle) return stopDev('paused');
      return { running: true, ...runSummary(_run) };
    }
    const cfg = runCfg();
    const p = plan(opt.zone || null);
    if (!p.out.length && !p.grow.length) {
      const why = p.skip.building ? p.skip.building + ' zoned ' + (p.skip.building === 1 ? 'plot is' : 'plots are') + ' already under construction — they finish on their own.'
        : p.skip.noroad ? p.skip.noroad + ' zoned ' + (p.skip.noroad === 1 ? 'tile is' : 'tiles are') + ' waiting on road frontage — draw a road beside them.'
        : p.skip.occupied ? 'Every zoned tile is already built to the density its zone asks for.'
        : 'Nothing is zoned yet — pick a zone and paint some land.';
      toast('🗺 Nothing to raise. ' + why, 'bad');
      return { built: 0, grown: 0, planned: 0, skip: p.skip, reasons: {}, running: false };
    }
    const run = startRun(opt.zone || null, true);
    if (cfg.permitSec > 0) {
      const work = p.out.length + p.grow.length;
      toast('🏗 Development approved — ' + work + ' plot' + (work === 1 ? '' : 's') +
            ' zoned and waiting. Buildings go up on their own from here, up to ' + cfg.sites +
            ' at a time, while the city is open. Press ⏸ to pause.', 'good');
      logEvent('city', '🗺 Development approved on ' + work + ' zoned plot' + (work === 1 ? '' : 's') + '.');
    }
    await tickDev();
    return { started: true, running: !!_run, planned: p.out.length, growPlanned: p.grow.length,
             skip: p.skip, ...runSummary(run) };
  }

  /* ── THE ONE FIELD DEVELOPMENT PUTS ON DISK ───────────────────────────────
     The intent ("this city is open for development") and the site list, through
     the module save shelf — never a queue of orders (see the header). A run
     therefore survives a reload without a single paid-but-unstarted plot on
     disk: the plan is re-derived from the zone map on the next permit.
     ⚠ REGISTERED FROM afterLoad(), NOT FROM mount(). /src/naming owns the shelf
       and is imported AFTER this module in node-city's boot, so
       window.MythicCitySave does not exist yet at mount. By afterLoad() it does,
       and register() replays the restored payload to a late arrival — which is
       exactly the case the shelf was built for. */
  let _shelved = false, _resume = null;
  function shelfRegister() {
    if (_shelved) return false;
    try {
      const shelf = window.MythicCitySave;
      if (!shelf || typeof shelf.register !== 'function') return false;
      _shelved = shelf.register('zoning', {
        save: () => ({ v: 1, on: _run ? 1 : 0, zone: _run ? _run.zone : null, sites: Array.from(_sites) }),
        load: (p) => {
          _sites.clear();
          if (!p || typeof p !== 'object') { _resume = null; return; }
          for (const k of (Array.isArray(p.sites) ? p.sites : [])) if (typeof k === 'string') _sites.add(k);
          _resume = p.on ? { zone: typeof p.zone === 'string' ? p.zone : null } : null;
        },
      });
    } catch (e) { console.warn('[Zoning] save shelf unavailable (non-fatal):', e); }
    return _shelved;
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
    /* 🏗 Development picks up where it left off — the intent only. Nothing is
       ordered here: the first permit is issued one interval later, from the
       zone map as it stands NOW. A city reopened after a week therefore starts
       one plot at a time exactly as it did before, and never spends a penny for
       the week nobody was watching. */
    shelfRegister();
    /* ⚠ NOT RESUMED WITHOUT PACING. With no economy module a run has no
       interval to sit on and would fire the whole remaining district in one
       burst — on the load path, before the player has touched anything. An
       unattended spend is the one thing a bulk tool must never do, so the
       intent is dropped and the button is left to the player. */
    if (_resume && runCfg().permitSec <= 0) _resume = null;
    if (_resume && !_run) {
      const zone = _resume.zone; _resume = null;
      const p = plan(zone);
      if (p.out.length || p.grow.length) {
        startRun(zone, true);
        logEvent('city', '🗺 Development is still approved here — ' + (p.out.length + p.grow.length) +
          ' zoned plot' + (p.out.length + p.grow.length === 1 ? '' : 's') + ' left to build out.');
      }
    }
    sync();
    return { zoned: Object.keys(G.zones).length, developing: !!_run, sites: devSites() };
  }

  function stats() {
    const per = {};
    let developed = 0, empty = 0;
    for (const k in G.zones) {
      const id = G.zones[k];
      per[id] = (per[id] || 0) + 1;
      if ((G.tiles || {})[k]) developed++; else empty++;
    }
    const cfg = devCfg();
    return { zoned: Object.keys(G.zones).length, per, developed, empty,
             overlay: !!(ov && ov.visible()),
             /* The panel's whole read of the run — one call, so the button, the
                status line and a diagnostic all quote the same numbers. */
             developing: !!_run, sites: devSites(),
             siteCap: cfg ? (cfg.sites | 0) : 0, permitSec: cfg ? (cfg.permitSec | 0) : 0,
             built: _run ? _run.built : 0, grownRun: _run ? _run.grown : 0 };
  }

  const api = {
    ZONES, ZONE_BY_ID, CATS,
    zoneAt, zoneDef, setZone,
    applyPaint, applyRect, applyFill,
    housingSeed, afterLoad, develop, plan: (only) => plan(only || null), planCost,
    /* 🏗 DEVELOPMENT. `devSite` / `devSites` are read by node-city's order gate
       (bldIsDev / bldDevSites) to keep private building sites out of the crew
       load — they are part of this module's contract with the host, not a
       diagnostic. `step()` issues the next permit NOW, which is what a driver
       needs in order to watch a run without waiting out the interval. */
    developing: () => !!_run,
    stopDevelop: () => stopDev('paused'),
    devSite, devSites, step: () => tickDev(),
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
