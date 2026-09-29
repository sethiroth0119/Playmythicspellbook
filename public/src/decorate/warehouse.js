/* ══════════════════════════════════════════════════════════════════════════
   🏗 WAREHOUSE DECORATION — buy it, place it, and the computer is the door in

   Three things at once, and they are one feature rather than three:

     1. A DECORATE MODE, the same shape the Dwelling already has: a catalogue
        down the left, a ghost that follows the floor, R to turn, click to
        place, click a placed piece to pick it up again. Saved per warehouse.
     2. A WORKSTATION that is a real placed object rather than a fixed prop —
        bought, positioned wherever the owner wants, and rendered from an
        admin-imported .glb when one exists.
     3. THE WORKSTATION IS THE ONLY WAY IN. The two buttons that used to float
        at the top of the screen are gone. Weight Lifters and the Warehouse
        upgrade are reached by walking to a computer and pressing E.

   🔴 (3) IS A GATE, AND A GATE CAN LOCK PEOPLE OUT. A warehouse whose owner has
      not placed a workstation would have NO route to the upgrade screen — and
      the upgrade screen is where you buy the bays the whole building is for.
      So every warehouse is guaranteed at least one: `ensureSeedWorkstation()`
      plants a free one by the office wall the first time a layout is loaded
      with none in it, and `sell()` refuses to remove the last one. The player
      can move it anywhere; they cannot end up with a warehouse they cannot
      administer.

   ⚠ THE MODEL LIBRARY IS SHARED WITH THE DWELLING, DELIBERATELY. It reads the
     same `mythic_custom_models_v1` index and the same `mythic_glb_<id>` blobs
     the Dwelling's importer writes, so a .glb imported once is placeable in
     both rooms and there is one importer to maintain rather than two. A model
     tagged `wh` shows in the warehouse catalogue; anything else is ignored
     here rather than cluttering it.

   ⚠ IT DEGRADES TO THE BLOCK MODEL. Every prop has a built-from-primitives
     mesh. The .glb is an OVERRIDE — if the library is empty, the file failed to
     parse, or storage is unavailable, the piece still builds and still works.
     A missing decoration must never be a missing upgrade button.
   ══════════════════════════════════════════════════════════════════════════ */

import { makeGlb } from './glb.js';

const LAYOUT_KEY = 'mythic_wh_layout_v1';
const MODELS_KEY = 'mythic_custom_models_v1';   // shared with /dwelling
const GLB_PREFIX = 'mythic_glb_';               // shared with /dwelling
const GRID = 0.5;

/* The shelf. `fn` marks a prop that DOES something — today only the
   workstation. Prices are in the warehouse's own wallet (Cinder / Aza), which
   is the real economy when the page is bridged. */
export const PROPS = [
  { id: 'workstation', name: 'Workstation', ico: '🖥', fn: 'terminal', r: 0.55,
    cinder: 250000, aza: 1,
    desc: 'A terminal wired into the building. Weight Lifters and the warehouse upgrade are opened from here.' },
  { id: 'rack',    name: 'Pallet Rack',   ico: '🗄', r: 0.9,  cinder: 120000, aza: 0, desc: 'Two bays of steel shelving.' },
  { id: 'pallet',  name: 'Pallet Stack',  ico: '📦', r: 0.55, cinder: 40000,  aza: 0, desc: 'Stacked and shrink-wrapped.' },
  { id: 'barrel',  name: 'Drum',          ico: '🛢', r: 0.34, cinder: 25000,  aza: 0, desc: 'Forty gallons of something.' },
  { id: 'lamp',    name: 'Floor Lamp',    ico: '💡', r: 0.28, cinder: 60000,  aza: 0, desc: 'A caged work light on a stand.' },
  { id: 'sign',    name: 'Hanging Sign',  ico: '🪧', r: 0.30, cinder: 80000,  aza: 0, desc: 'Your name over the floor.' },
  { id: 'plant',   name: 'Dead Fern',     ico: '🪴', r: 0.30, cinder: 15000,  aza: 0, desc: 'Nobody waters it. It stays anyway.' },
];
const PROP_BY_ID = Object.fromEntries(PROPS.map((p) => [p.id, p]));

export function mountWarehouseDecor(host) {
  const T = host.THREE;
  if (!T) throw new Error('warehouse decor: no THREE');
  const glb = makeGlb(T);
  const scene = host.scene, camera = host.camera, App = host.App;
  const store = host.storage;
  const toast = host.toast || function () {};
  const say = host.setHint || function () {};

  let mode = 'walk';
  let placed = [];               // {id, type, node, x, z, ry, sensor}
  let owned = {};                // type -> count bought and not yet placed
  let ghost = null, ghostType = null, ghostRy = 0;
  let grid = null;
  let models = [];               // shared custom-model index, filtered to `wh`
  const glbCache = {};           // modelId -> template Group
  let dirty = false, saveTimer = 0;
  let loaded = false;            // 🔒 nothing may be saved before a load resolves

  /* ── meshes ─────────────────────────────────────────────────────────── */
  const M = {
    steel: new T.MeshStandardMaterial({ color: 0x8d939c, metalness: 0.55, roughness: 0.55 }),
    dark:  new T.MeshStandardMaterial({ color: 0x2a2b31, metalness: 0.3, roughness: 0.7 }),
    wood:  new T.MeshStandardMaterial({ color: 0x8a6b41, roughness: 0.9 }),
    card:  new T.MeshStandardMaterial({ color: 0xb99566, roughness: 0.95 }),
    glow:  new T.MeshStandardMaterial({ color: 0x4aa0d8, emissive: 0x4aa0d8, emissiveIntensity: 1.15, roughness: 0.4 }),
    gold:  new T.MeshStandardMaterial({ color: 0xd4af37, emissive: 0x6b5416, emissiveIntensity: 0.4, roughness: 0.5 }),
    green: new T.MeshStandardMaterial({ color: 0x3f5c3a, roughness: 0.95 }),
  };
  const box = (w, h, d, mat) => new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  const cyl = (r, h, mat, seg) => new T.Mesh(new T.CylinderGeometry(r, r, h, seg || 14), mat);

  /* A prop's fallback body. Deliberately simple: these are the shapes a .glb
     replaces, and a block that reads clearly beats a block that tries to be
     a model and fails at both. */
  function buildBlock(type) {
    const g = new T.Group();
    if (type === 'workstation') {
      const desk = box(1.25, 0.06, 0.66, M.steel); desk.position.y = 0.74; g.add(desk);
      [[-0.55, -0.26], [0.55, -0.26], [-0.55, 0.26], [0.55, 0.26]].forEach(([x, z]) => {
        const l = box(0.06, 0.74, 0.06, M.dark); l.position.set(x, 0.37, z); g.add(l);
      });
      const scr = box(0.72, 0.46, 0.05, M.glow); scr.position.set(0, 1.05, -0.1); g.add(scr);
      const bez = box(0.78, 0.52, 0.03, M.dark); bez.position.set(0, 1.05, -0.13); g.add(bez);
      const stand = box(0.1, 0.2, 0.1, M.dark); stand.position.set(0, 0.87, -0.1); g.add(stand);
      const kb = box(0.5, 0.03, 0.18, M.dark); kb.position.set(0, 0.78, 0.16); g.add(kb);
      const twr = box(0.22, 0.46, 0.44, M.dark); twr.position.set(0.74, 0.23, 0); g.add(twr);
      const led = box(0.05, 0.05, 0.02, M.gold); led.position.set(0.74, 0.4, 0.23); g.add(led);
    } else if (type === 'rack') {
      [0, 1].forEach((bay) => {
        const ox = bay * 1.3 - 0.65;
        [-0.55, 0.55].forEach((z) => [-0.6, 0.6].forEach((x) => {
          const p = box(0.07, 2.2, 0.07, M.steel); p.position.set(ox + x, 1.1, z); g.add(p);
        }));
        [0.5, 1.2, 1.9].forEach((y) => { const s = box(1.32, 0.05, 1.18, M.steel); s.position.set(ox, y, 0); g.add(s); });
        [0.62, 1.32].forEach((y) => { const c = box(0.5, 0.36, 0.5, M.card); c.position.set(ox - 0.28, y + 0.2, 0); g.add(c); });
      });
    } else if (type === 'pallet') {
      const p = box(1.0, 0.12, 0.9, M.wood); p.position.y = 0.06; g.add(p);
      [0.34, 0.66, 0.94].forEach((y, i) => {
        const c = box(0.86 - i * 0.06, 0.3, 0.78 - i * 0.06, M.card); c.position.y = y; g.add(c);
      });
    } else if (type === 'barrel') {
      const b = cyl(0.3, 0.86, M.steel, 18); b.position.y = 0.43; g.add(b);
      [0.26, 0.6].forEach((y) => { const r = cyl(0.32, 0.05, M.dark, 18); r.position.y = y; g.add(r); });
    } else if (type === 'lamp') {
      const base = cyl(0.22, 0.05, M.dark, 16); base.position.y = 0.025; g.add(base);
      const pole = cyl(0.035, 1.6, M.steel, 10); pole.position.y = 0.82; g.add(pole);
      const head = cyl(0.2, 0.22, M.dark, 12); head.position.y = 1.66; g.add(head);
      const bulb = cyl(0.15, 0.04, M.gold, 12); bulb.position.y = 1.55; g.add(bulb);
    } else if (type === 'sign') {
      const post = box(0.06, 2.3, 0.06, M.steel); post.position.y = 1.15; g.add(post);
      const arm = box(0.9, 0.05, 0.05, M.steel); arm.position.set(0.42, 2.25, 0); g.add(arm);
      const plate = box(0.78, 0.4, 0.04, M.dark); plate.position.set(0.72, 2.0, 0); g.add(plate);
      const trim = box(0.82, 0.44, 0.02, M.gold); trim.position.set(0.72, 2.0, -0.02); g.add(trim);
    } else {                                            // plant
      const pot = cyl(0.2, 0.28, M.card, 14); pot.position.y = 0.14; g.add(pot);
      for (let i = 0; i < 7; i++) {
        const f = box(0.06, 0.5, 0.02, M.green);
        f.position.set(Math.cos(i) * 0.09, 0.5, Math.sin(i) * 0.09);
        f.rotation.set(0.35 * Math.cos(i), i, 0.35 * Math.sin(i));
        g.add(f);
      }
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /* An admin .glb wins over the block when one is tagged for this prop. */
  function buildProp(type) {
    const m = models.find((x) => x.propId === type && glbCache[x.id]);
    if (m) { const g = glbCache[m.id].clone(true); g.userData.fromGlb = m.id; return g; }
    return buildBlock(type);
  }

  /* ── the shared model library ────────────────────────────────────────── */
  async function loadModels() {
    try {
      const r = await store.get(MODELS_KEY);
      const all = (r && r.value) ? (JSON.parse(r.value) || []) : [];
      /* Only models the admin tagged for the warehouse. `propId` says WHICH
         prop the mesh replaces — a model tagged `workstation` becomes every
         workstation in the building. */
      models = all.filter((m) => m && m.kind === 'glb' && (m.room === 'wh' || m.propId));
    } catch (e) { models = []; }
    for (const m of models) {
      try {
        const g = await store.get(GLB_PREFIX + m.id);
        if (g && g.value) glbCache[m.id] = glb.glbToTemplate(glb.b64ToAb(g.value), m.scale || 1);
      } catch (e) { /* a model that will not parse simply leaves the block in place */ }
    }
  }

  /* ── persistence ─────────────────────────────────────────────────────── */
  function whKey() {
    let id = 'local';
    try { const s = host.WH && host.WH.state && host.WH.state(); id = (s && (s.warehouse_id || s.id)) || 'local'; } catch (e) {}
    return LAYOUT_KEY + ':' + id;
  }
  function serialise() {
    return { v: 1, savedAt: Date.now(),
             owned: { ...owned },
             items: placed.map((p) => ({ t: p.type, x: +p.x.toFixed(3), z: +p.z.toFixed(3), ry: +p.ry.toFixed(3) })) };
  }
  function saveSoon() {
    if (!loaded) return;                 // 🔒 see the load gate
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  async function save() {
    if (!loaded) return false;
    try { await store.set(whKey(), JSON.stringify(serialise())); dirty = false; return true; }
    catch (e) { return false; }
  }
  async function load() {
    let doc = null;
    try { const r = await store.get(whKey()); if (r && r.value) doc = JSON.parse(r.value); }
    catch (e) {
      /* 🔴 A FAILED READ IS NOT AN EMPTY WAREHOUSE. Marking `loaded` here would
         let the next autosave write an empty layout over a real one — the
         exact defect the Dwelling's own persistence pass was written to close.
         Stay unloaded; nothing saves; the player is told. */
      toast('⚠ Could not read your warehouse layout. Nothing has been changed — reload to try again.', 6000);
      return false;
    }
    if (doc && Array.isArray(doc.items)) {
      owned = (doc.owned && typeof doc.owned === 'object') ? { ...doc.owned } : {};
      doc.items.forEach((it) => { if (PROP_BY_ID[it.t]) spawn(it.t, +it.x || 0, +it.z || 0, +it.ry || 0, true); });
    }
    loaded = true;
    ensureSeedWorkstation();
    return true;
  }

  /* ── placing ─────────────────────────────────────────────────────────── */
  function spawn(type, x, z, ry, quiet) {
    const def = PROP_BY_ID[type]; if (!def) return null;
    const node = buildProp(type);
    node.position.set(x, 0, z); node.rotation.y = ry || 0;
    scene.add(node);
    const rec = { id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
                  type, node, x, z, ry: ry || 0, sensor: null, coll: null };
    /* A functional prop gets a sensor so the page's existing E-prompt finds it.
       Everything else is scenery and is walked past. */
    if (def.fn === 'terminal') {
      rec.sensor = { kind: 'workstation', x, z: z + 0.9, r: 2.2, _decor: rec.id };
      App.sensors.push(rec.sensor);
    }
    const r = glb.footprintRadius(node, def.r, 'floor');
    rec.coll = { x, z, hw: r, hd: r };
    App.colliders.push(rec.coll);
    placed.push(rec);
    if (!quiet) saveSoon();
    return rec;
  }
  function despawn(rec) {
    scene.remove(rec.node);
    if (rec.sensor) { const i = App.sensors.indexOf(rec.sensor); if (i >= 0) App.sensors.splice(i, 1); }
    if (rec.coll) { const i = App.colliders.indexOf(rec.coll); if (i >= 0) App.colliders.splice(i, 1); }
    const i = placed.indexOf(rec); if (i >= 0) placed.splice(i, 1);
    if (App.near && App.near._decor === rec.id) App.near = null;
  }

  function terminals() { return placed.filter((p) => (PROP_BY_ID[p.type] || {}).fn === 'terminal'); }

  /* 🔒 THE LOCKOUT GUARD. See the header: with the top buttons gone, a
     warehouse with no workstation has no route to its own upgrade screen. */
  function ensureSeedWorkstation() {
    if (terminals().length) return;
    spawn('workstation', -10.6, 0.2, -0.5, true);
    save();
  }

  const CHARGING = false;   // flips when a wh_buy_fitting RPC exists

  /* 💰 ═══ FITTINGS ARE NOT CHARGED FOR YET, AND THAT IS DELIBERATE ═════════
     The brief says players buy these. The prices below are the intended ones
     and they are already shown on the shelf — but there is NO WAY TO TAKE THE
     MONEY from this page today. WH exposes `wallet()` and `setWallet()` and
     nothing else: the wallet is a read-only mirror pushed in over postMessage,
     and every real purchase in this building (a bay, a tier, a lifter) goes
     through a server RPC — wh_buy_unit, wh_upgrade_tier — because the server is
     what owns the charge.

     🔴 SO THE CHOICE WAS: refuse every purchase until a wh_buy_fitting RPC
        exists, which ships a decoration feature nobody can use — or deduct from
        a local mirror, which is a number the server would hand straight back on
        the next state push and is therefore a FREE ITEM wearing a price tag.
        Both are worse than saying so. Fittings are free to the OWNER for now,
        the shelf says "free", and the prices stay in the table so the RPC has
        something to read when it lands.
     ⚠ DO NOT "FIX" THIS BY SUBTRACTING FROM host.WH.wallet(). That mirror is
       overwritten by the next wh:state message, so the deduction vanishes and
       the item stays — which is exactly the shape of the Bank of Ethos
       double-charge that cost eight players 14.6M Cinder, run in reverse. */
  function buy(type) {
    const def = PROP_BY_ID[type]; if (!def) return false;
    if (!host.isOwner || !host.isOwner()) { toast('🏗 Only the owner can furnish this warehouse.', 3000); return false; }
    owned[type] = (owned[type] | 0) + 1;
    saveSoon();
    return true;
  }
  /* What the shelf should print next to a piece. One function so the price and
     the charge can never disagree — when the RPC lands, both change here. */
  function priceLabel(def) {
    return CHARGING ? (def.cinder.toLocaleString() + ' 🔥' + (def.aza ? ' · ' + def.aza + ' 🪙' : '')) : 'free for now';
  }

  function startPlacing(type) {
    if ((owned[type] | 0) <= 0) { if (!buy(type)) return; }
    cancelPlacing();
    ghostType = type; ghostRy = 0;
    ghost = buildProp(type);
    ghost.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.transparent = true; o.material.opacity = 0.55;
    });
    scene.add(ghost);
    say('Move to aim · R to turn · click to set it down · Esc to cancel');
  }
  function cancelPlacing() {
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghostType = null;
  }
  /* The ghost sits on the floor a couple of metres in front of the camera and
     snaps to a half-metre grid — the same feel as the Dwelling, and it means a
     row of racks lines up without the player fighting it. */
  function moveGhost() {
    if (!ghost) return;
    const d = 2.6;
    const x = camera.position.x - Math.sin(host.yaw()) * d;
    const z = camera.position.z - Math.cos(host.yaw()) * d;
    ghost.position.set(Math.round(x / GRID) * GRID, 0, Math.round(z / GRID) * GRID);
    ghost.rotation.y = ghostRy;
  }
  function commit() {
    if (!ghost || !ghostType) return;
    const p = ghost.position;
    spawn(ghostType, p.x, p.z, ghostRy);
    owned[ghostType] = (owned[ghostType] | 0) - 1;
    const left = owned[ghostType] | 0;
    saveSoon();
    if (left <= 0) { cancelPlacing(); say('Placed. Pick another piece from the shelf.'); }
    host.refresh && host.refresh();
  }
  /* Pick the nearest placed piece up again — it goes back into `owned`, so the
     player is never charged twice for moving something. */
  function pickUpNearest() {
    let best = null, bd = 3.2;
    placed.forEach((p) => {
      const d = Math.hypot(camera.position.x - p.x, camera.position.z - p.z);
      if (d < bd) { bd = d; best = p; }
    });
    if (!best) { toast('Stand closer to the piece you want to move.', 2600); return; }
    if ((PROP_BY_ID[best.type] || {}).fn === 'terminal' && terminals().length <= 1) {
      toast('🖥 This is your only workstation — the upgrade and lifter screens are opened from it. ' +
            'Place another before taking this one up.', 5200);
      return;
    }
    owned[best.type] = (owned[best.type] | 0) + 1;
    despawn(best);
    saveSoon();
    host.refresh && host.refresh();
    toast('Picked up — it is back on your shelf.', 2200);
  }

  function setMode(m) {
    mode = m;
    if (m === 'walk') { cancelPlacing(); if (grid) grid.visible = false; }
    else {
      if (!grid) {
        grid = new T.GridHelper(40, 80, 0xc6a04a, 0x3a3428);
        grid.material.opacity = 0.25; grid.material.transparent = true;
        grid.position.y = 0.02; scene.add(grid);
      }
      grid.visible = true;
      say('Decorating · pick a piece · R turns it · click sets it down · F picks one up');
    }
    host.refresh && host.refresh();
  }

  const api = {
    PROPS,
    mode: () => mode,
    setMode,
    owned: () => ({ ...owned }),
    placedCount: () => placed.length,
    terminals: () => terminals().length,
    startPlacing, cancelPlacing, commit, pickUpNearest, buy, priceLabel,
    rotate() { ghostRy = (ghostRy + Math.PI / 8) % (Math.PI * 2); },
    tick() { if (mode === 'decorate') moveGhost(); },
    isPlacing: () => !!ghost,
    save, load: async () => { await loadModels(); return load(); },
    /* Exposed for the driver: the layout as it would be written. */
    serialise,
    /* Which admin .glb (if any) a prop is currently drawn from. Without this the
       only way to tell a custom workstation mesh from the block one is to
       photograph it, and the pane composites at 0.56 Hz. */
    glbFor: (type) => { const m = models.find((x) => x.propId === type && glbCache[x.id]); return m ? m.id : null; },
    modelCount: () => models.length,
  };
  try { window.WHDecor = api; } catch (e) {}
  return api;
}

export default mountWarehouseDecor;
