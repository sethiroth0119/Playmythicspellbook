/* ══════════════════════════════════════════════════════════════════════════
   🛣 /src/roads — THE ROAD CLASS CATALOGUE.  window.MythicRoadClasses

   Nine classes of carriageway on ONE tile type, laid with a CS2-style drag,
   priced as a ladder against node-city's own road price, metered against the
   road maintenance cap, and drawn into the SIX merged buckets makeRoad already
   emits — so a highway costs the same six draw calls a street costs.

   ── WHAT THE HOST HANDS OVER, AND WHY IT HAS TO ──────────────────────────
   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `THREE`, `scene`,
      `GRID`, `key`, `tileAt`, `isRoad`, `costOf`, `payCost`, `toast`,
      `refreshRoadArea`, `roadCapParts` and the entire rd* road kit are
      top-level `const` in node-city's module script. NONE of them is on
      `window`. The ctx object passed to mount() IS the hand-over; there is no
      `window.game` and this module never reaches for one.

   ⚠ WHAT DOES NOT CROSS IT: nothing that mints. Every coin this module spends
     goes through the host's own payCost, and every road it lays on empty ground
     goes through the SHIPPED tryPlace gate (cap, progression, ground, siting,
     population, the _placing lock) via ctx.place — the same one-line closure
     /src/zoning develops through. This module has no ledger call of its own and
     cannot acquire one.

   ── WHAT HAPPENS IF THIS FILE 404s ───────────────────────────────────────
   Everything. Every road in the city is a road: node-city renders it with the
   shipped recipe, prices it at costOf('road'), meters it at one cap unit,
   paths agents over it, lets /src/power route cables along it, lets /src/zoning
   bound fills on it and lets the player demolish it. The class string sitting
   in `t.rc` is written straight back out by serialize() and picked up again by
   the next build that has this module — the same erase-guard instinct the
   `power`, `water` and `pollution` save fields carry. A save is never stranded.

   That is not a consolation prize, it is the reason the class is not a tile
   type. See classes.js's header for the eight things a second type would break
   silently.
   ══════════════════════════════════════════════════════════════════════════ */

import { ROADS, rd } from './tuning.js';
import { CLASSES, ALL, DEFAULT, known, defOf, classOf, capWeightOf, stampOf } from './classes.js';
import { isRoadTile } from './types.js';
import { quote, convertQuote, label as priceText } from './price.js';
import { decorate as decorateMesh } from './mesh.js';
/* 🔴 drag.js IS IMPORTED DYNAMICALLY, AND THAT IS A DEPENDENCY DECISION, NOT A
   STYLE ONE. It imports /src/netdrag/rig.js — the shared map-pointer arbiter —
   because a fifth capture-phase listener stack would re-create the exact bug
   that registry exists to close. But a STATIC import of it would make the whole
   of this module, meshes included, die if /src/netdrag ever 404s: the class
   recipes are the valuable half and they need no pointer at all. Dynamic, so a
   missing arbiter costs the player the palette and nothing else, and every road
   they have already paid for still renders as the class it is. */

let C = null;          // the ctx
let ui = null;
let kit = null;
let preview = null;    // one Mesh, rebuilt on change — see previewSet()

/* 🔴 THE CLASS THE HOST IS ABOUT TO LAY.
   tryPlace is asynchronous (payCost is a bridge round trip) and it prices the
   tile BEFORE the await and stamps the tile AFTER it. Both reads have to see
   the same class or the player is charged for a highway and gets a street, so
   the host captures this ONCE at the top of the order exactly as it already
   captures `ptype` — and for exactly the reason its comment there gives: "the
   player can switch the palette while payCost is in flight".
   Never read directly. pending() is the accessor and it is what node-city calls. */
let _pending = DEFAULT;

/* ── the resolver, in the two shapes the host and mesh.js each need ─────── */
function tileOf(x, z) {
  if (!C || !C.tileAt) return null;
  try { return C.tileAt(x, z); } catch (e) { return null; }
}
function classAtXZ(x, z) { return classOf(tileOf(x, z)); }

/* ── the cap ────────────────────────────────────────────────────────────────
   node-city's roadUsed() counts tiles; with classes it sums weights. This is
   the sum, and the host calls it INSTEAD of counting — one place, so the
   refusal, the meter and the panel can never disagree about how full the
   network is. Absent module ⇒ the host's own count, i.e. one per tile. */
function capUsed() {
  if (!C || !C.game) return 0;
  let n = 0;
  for (const k in C.game.tiles) n += capWeightOf(C.game.tiles[k]);
  return n;
}
function capInfo() {
  let cap = 0;
  try { cap = (C.roadCapParts ? C.roadCapParts().cap : 0) | 0; } catch (e) { cap = 0; }
  return { used: capUsed(), cap };
}

/* ── pricing. Every quote in the feature comes out of here and nowhere else,
      and every one of them starts at the host's costOf(<carriageway type>).
   ⚠ THE TYPE, NOT THE LITERAL 'road'. node-city publishes a TABLE of
     carriageway types (ROAD_CLASSES: road, roadlane, …) and each has its own
     BUILDINGS row and its own price. A class is a ladder on WHICHEVER of those
     the tile is, so re-laying a Lane as a highway is priced off the Lane's row
     and re-laying a Road off the Road's — the only reading under which the two
     axes stay independent. `roadType` is what the palette lays on empty ground;
     a conversion quotes the tile's own type. */
const roadType = () => (C && C.roadType) || 'road';
function baseCost(type) {
  try { return C && C.costOf ? C.costOf(type || roadType()) : {}; } catch (e) { return {}; }
}
function quoteFor(cls, type) { return quote(baseCost(type), cls); }
function priceLabel(cls) { return priceText(quoteFor(cls)); }

/* ══ THE PREVIEW ═══════════════════════════════════════════════════════════
   ONE mesh, one material, one draw call, rebuilt only when the cell list
   actually changes — the same rule /src/power's and /src/water's overlays keep
   ("ONE plane + one CanvasTexture, never 576 meshes"). It lives at
   ROADS.drag.previewY, chosen to sit ABOVE node-city's hover plane (.020) and
   gridHelper (.0145) and BELOW /src/power's overlay (.060), which is the only
   free slot left in a crowded y-stack.
   ⚠ The geometry is disposed on every rebuild. A merged geometry owns its
     buffers — the same reason makeRoad keeps RD_OWNED and disposes per tile. */
function previewSet(cells, col) {
  if (!C || !C.THREE || !C.scene) return;
  const THREE = C.THREE;
  if (!cells || !cells.length) { if (preview) preview.visible = false; return; }
  const sig = col + '|' + cells.map(c => c.x + ',' + c.z).join(';');
  if (preview && preview.userData.sig === sig) { preview.visible = true; return; }
  const y = rd('drag.previewY', 0.052);
  const pos = new Float32Array(cells.length * 4 * 3);
  const idx = new Uint32Array(cells.length * 6);
  let vo = 0, io = 0;
  for (const c of cells) {
    const wx = c.x - C.HALF + 0.5, wz = c.z - C.HALF + 0.5, h = 0.46;
    const q = [[wx - h, wz - h], [wx + h, wz - h], [wx + h, wz + h], [wx - h, wz + h]];
    for (let i = 0; i < 4; i++) { pos[(vo + i) * 3] = q[i][0]; pos[(vo + i) * 3 + 1] = y; pos[(vo + i) * 3 + 2] = q[i][1]; }
    idx[io] = vo; idx[io + 1] = vo + 2; idx[io + 2] = vo + 1;
    idx[io + 3] = vo; idx[io + 4] = vo + 3; idx[io + 5] = vo + 2;
    vo += 4; io += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  if (!preview) {
    preview = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide,
    }));
    preview.renderOrder = 3;
    preview.frustumCulled = false;
    C.scene.add(preview);
  } else {
    const old = preview.geometry;
    preview.geometry = geo;
    if (old && old.dispose) old.dispose();
    preview.material.color.setHex(col);
  }
  preview.userData.sig = sig;
  preview.visible = true;
}

/* ══ LAYING ════════════════════════════════════════════════════════════════
   🍞 ONE LINE FOR THE WHOLE DRAG, AND IT IS NOT OPTIONAL.
   Every cell is an awaited tryPlace with a bridge round trip and a
   refreshRoadArea that rebuilds five tiles — /src/zoning's applyRect is
   synchronous and writes one data map, and this is not that. node-city's toast
   rail holds THREE, so a 20-tile drag that hit the road cap would show three
   arbitrary refusals and no account of the other seventeen. window.__ncToastSink
   is the three-line hook in node-city's toast() that /src/zoning's develop()
   already uses for exactly this; identical reasons are counted and printed
   once at the end.
   ⚠ The previous sink is SAVED AND RESTORED, never assumed to be null. Two bulk
     operations can overlap (a zoning develop run is on a timer) and clobbering
     the other one's sink would silently unmute it mid-run. */
async function applyRun(cells, cls) {
  if (!C || !cells || !cells.length) return { laid: 0, converted: 0, refused: 0 };
  const wanted = known(cls) ? cls : DEFAULT;
  const d = defOf(wanted);
  const reasons = new Map();
  const prevSink = window.__ncToastSink || null;
  let laid = 0, converted = 0, spent = 0;
  const note = (msg) => reasons.set(msg, (reasons.get(msg) || 0) + 1);

  window.__ncToastSink = (msg) => { note(String(msg || '')); };
  try {
    for (const c of cells) {
      if (!C.inGrid(c.x, c.z)) { note('Off the map.'); continue; }
      const t = tileOf(c.x, c.z);
      if (t && !isRoadTile(t)) { note('Something is already built there.'); continue; }

      if (t) {
        // ── convert an existing road ──────────────────────────────────────
        const was = classOf(t);
        if (was === wanted) continue;                       // silent: already right
        const info = capInfo();
        const delta = rd('cls.' + wanted + '.capWeight', 1) - rd('cls.' + was + '.capWeight', 1);
        if (delta > 0 && info.used + delta > info.cap) {
          note('🛤️ Road network is at capacity (' + info.used + '/' + info.cap + ').');
          continue;
        }
        const price = convertQuote(baseCost(t.type), wanted);
        let ok = false;
        try { ok = await C.payCost(price); } catch (e) { ok = false; }
        if (!ok) { note('Cannot afford ' + d.name + ' (' + priceText(price) + ').'); continue; }
        // Re-read: the tile could have been demolished across the await.
        const t2 = tileOf(c.x, c.z);
        if (!isRoadTile(t2)) { note('That road was cleared while it was being paid for.'); continue; }
        t2.rc = wanted;
        t2.spent = Math.round((t2.spent || 0) + (price.cinder || 0));
        spent += price.cinder || 0;
        try { C.refreshRoadArea(c.x, c.z); } catch (e) {}
        converted++;
        continue;
      }

      /* ── lay on empty ground, THROUGH THE SHIPPED GATE ──────────────────
         ctx.place is node-city's own one-line wrapper over tryPlace, the same
         one /src/zoning builds through. It runs the cap, the progression gate,
         the ground gate, the siting gate, the population charge, payCost and
         the _placing lock. Nothing here re-implements any of them, and the
         class surcharge is applied inside that gate rather than here, so the
         price the player is charged and the price the tile records are the
         same number by construction. */
      _pending = wanted;
      let before = 0;
      try { before = Object.keys(C.game.tiles).length; } catch (e) {}
      try { await C.place('road', c.x, c.z); } catch (e) { note('Could not lay that tile.'); }
      const now = tileOf(c.x, c.z);
      if (isRoadTile(now)) {
        // tryPlace stamps t.rc from pending(); belt-and-braces for the case
        // where an older host has no such line — an unstamped road is a street,
        // which is exactly what it would have been before this module existed.
        if (!known(now.rc)) now.rc = wanted;
        laid++;
      } else if (before === (C.game ? Object.keys(C.game.tiles).length : before)) {
        // tryPlace refused and said why through the sink; nothing to add.
      }
    }
  } finally {
    window.__ncToastSink = prevSink;
    _pending = DEFAULT;
  }

  try { if (C.computeLinks) C.computeLinks(); } catch (e) {}
  try { if (C.updateHUD) C.updateHUD(); } catch (e) {}
  try { if (C.saveSoon) C.saveSoon(); } catch (e) {}

  // ── the one line ────────────────────────────────────────────────────────
  const done = laid + converted;
  const parts = [];
  if (laid) parts.push(laid + ' laid');
  if (converted) parts.push(converted + ' re-laid');
  let msg;
  if (done) {
    msg = d.ico + ' ' + d.name + ' — ' + parts.join(', ') + '.';
    if (spent) msg += ' Re-laying charged ' + Math.round(spent).toLocaleString() + ' 🔥.';
  } else {
    msg = d.ico + ' Nothing laid.';
  }
  const skipped = [];
  for (const [why, n] of reasons) skipped.push(n > 1 ? why + ' (×' + n + ')' : why);
  if (skipped.length) msg += ' ' + skipped.slice(0, 3).join(' ') + (skipped.length > 3 ? ' …' : '');
  try { if (C.toast) C.toast(msg, done ? 'good' : 'bad'); } catch (e) {}
  if (done) { try { if (C.logEvent) C.logEvent('city', d.name + ': ' + parts.join(', ') + '.'); } catch (e) {} }
  return { laid, converted, refused: reasons.size };
}

/* ══ MOUNT ═════════════════════════════════════════════════════════════════ */
export function mount(ctx) {
  C = ctx || {};
  kit = C.kit || null;
  if (kit && typeof kit.classAt !== 'function') kit.classAt = classAtXZ;

  const api = {
    CLASSES, defOf, stampOf,
    priceLabel,
    capInfo,
    classAt: classAtXZ,
    preview: previewSet,
    apply: applyRun,
  };
  try {
    import('./drag.js')
      .then(m => { ui = m.mountUI(api, C); })
      .catch(e => { console.warn('[Roads] palette not mounted (non-fatal):', e); ui = null; });
  } catch (e) { console.warn('[Roads] palette not mounted (non-fatal):', e); ui = null; }

  const M = {
    /* ── what node-city calls ──────────────────────────────────────────── */

    /* The mesh hook, called ONCE per road tile from inside makeRoad, right
       before its six buckets merge. `cls` comes off the tile, so a tile with no
       class does not reach a recipe at all. Never throws (mesh.js guards). */
    decorate(info, buckets, contacts) {
      if (!kit || !info || !known(info.cls) || info.cls === DEFAULT) return false;
      return decorateMesh(info, buckets, kit, contacts);
    },

    /* The class the host is about to lay, captured once per order. */
    pending() { return _pending; },

    /* The road price for a class — the host's own costOf('road'), laddered. */
    costFor(base, cls) { return quote(base, known(cls) ? cls : _pending); },

    /* The weighted road-cap usage, replacing a bare tile count. */
    capUsed,
    capWeight: capWeightOf,

    /* The resolver, published so any other module can ask without minting a
       thirteenth copy of `t.type === 'road'`. */
    classOf, classAt: classAtXZ, defOf, known,
    classes: () => CLASSES.slice(),

    /* Streets segmentation reads this: a run of one class is one named street,
       so a segmenter can break a run where the class changes. Returns null for
       a non-road, which is what segment() already treats as "not part of a
       run". */
    classKeyOf(k) {
      if (!C || !C.game) return null;
      return classOf(C.game.tiles[k]);
    },

    /* ── the panel ─────────────────────────────────────────────────────── */
    panel(v) { if (ui) ui.open(v == null ? !ui.isOpen() : v); },
    panelOpen() { return !!(ui && ui.isOpen()); },
    arm(cls) { if (ui) ui.cls(cls); },

    /* ── self-check, printed only on failure. Same contract as /src/power's
          verify() and selfCheck(): silence is a pass. ─────────────────── */
    verify() {
      const bad = [];
      if (!kit) bad.push('no road kit handed over — every class will render as a plain street');
      else for (const need of ['slab', 'flat', 'lane', 'part', 'box', 'quad', 'tint', 'rng'])
        if (typeof kit[need] !== 'function') bad.push('kit.' + need + ' missing');
      if (kit && kit.Y) for (const need of ['Y', 'HW', 'PT', 'PY', 'QY', 'WY', 'DY'])
        if (typeof kit.Y[need] !== 'number') bad.push('kit.Y.' + need + ' missing');
      for (const id of ALL) {
        const d = ROADS.cls[id];
        if (!(d.costMult > 0)) bad.push(id + ': costMult must be positive');
        if (!(d.capWeight >= 1)) bad.push(id + ': capWeight must be at least 1');
      }
      if (typeof C.place !== 'function') bad.push('no place() — nothing can be laid');
      if (typeof C.payCost !== 'function') bad.push('no payCost() — conversions cannot be charged');
      if (typeof C.costOf !== 'function') bad.push('no costOf() — every quote would be invented here');
      return { ok: !bad.length, issues: bad };
    },

    /* Harness seams. Pure, no DOM, no pointer — .gauntlet drives these.
       ⚠ A GETTER, NOT A CAPTURED VALUE. The palette arrives on a dynamic
         import's microtask, so `ui` is still null at the moment this object is
         built; a captured `ui._plan` would be null forever. */
    _ui: () => ui,
    _plan: (a, b, mode, trail) => (ui && ui._plan ? ui._plan(a, b, mode, trail) : []),
    _stamp: (x, z, n) => (ui && ui._stamp ? ui._stamp(x, z, n) : []),
    _quote: quoteFor,
    _apply: applyRun,
  };

  /* 🔴 NOT `window.MythicRoads` — THAT NAME IS TAKEN, AND BY THE RIGHT OWNER.
     node-city publishes its carriageway TYPE table there, at the declaration
     rather than in boot(), because /src/roads/types.js is imported by modules
     that mount before boot's tail and "a resolver that is only correct late is
     worse than one that is wrong early, because the failure moves". Overwriting
     it from here would blind every one of those readers to the type table and
     they would all fail open to ['road'] — silently, and only in builds where
     this module happened to load first, which is the worst possible shape for a
     bug. Two axes, two globals: MythicRoads answers "is this a carriageway",
     MythicRoadClasses answers "which class of one". */
  window.MythicRoadClasses = M;
  return M;
}

export default { mount };
