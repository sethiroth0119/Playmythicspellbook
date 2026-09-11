/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.editor.js — Athena Engine (World Forge), the in-game 3D map creator.

   A full-screen overlay: sculpt + paint a heightfield, place props and .glb
   models with a gizmo, set water / sky / sun, walk the map in Play mode,
   save to the cloud (sql/091) or this device, export JSON.

   Layering, so it stays understandable:
     format.js  the document        world.js   document → scene (runtime)
     terrain.js the heightfield     water.js   the water plane
     props.js   built-in assets     api.js     saving/loading
     this file  the UI + tools on top of all that. Nothing below imports it.

   Rejected: editing the legacy Battlemap Editor (index.html) into this. It
   is a fixed-grid tile painter tied to Forge.battleMap3d and the battle
   board's cell size; a free-form world with a heightfield, water and a
   gizmo is a different tool, and CLAUDE.md forbids new top-level systems in
   index.html anyway. The two can coexist; this one exposes buildWorld() so
   the board can consume a World Forge map later without a port.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ensureThree } from './mapforge.three.js';
import { buildWorld, bufferToB64 } from './mapforge.world.js';
import { createPlayer } from './mapforge.player.js';
import { newMap, normalize, serialize, clone, uid, PAINT, ENV_PRESETS, LOOP_MODES, resampleTerrain, gameId, assetBytes, embeddedBytes, HUBS, normalizeMenu, normalizeAct, normalizePlayer, PLAYER_ANIMS, PLAYER_CAST_MAX, normalizeTags } from './mapforge.format.js';
import * as assetsApi from './mapforge.files.js';   // the uploaded files (world_assets, sql/112) — build B's FILES tab
import { refreshMenu } from './mapforge.menu.js';
import { EMITTERS } from './mapforge.vfx.js';
import { createAvatar, VIEWS } from './mapforge.avatar.js';
import { miniGames } from './mapforge.bridge.js';
import { refreshLive } from './mapforge.pill.js';
import * as games from './mapforge.games.js';
import { invalidate as invalidateOverlay } from './mapforge.overlay.js';
import { COMPONENTS, ACTOR_NODES, newBlueprint, newGraphNode, hasBehaviour } from './mapforge.actors.js';
import { createGraphEditor } from '../widgets/graph-editor.js';
import * as quality from './mapforge.quality.js';
import * as assetsMod from './mapforge.assets.js';
import { SPLINE_PRESETS, SPLINE_PRESET_BY_ID, SPLINE_MODES, sampleSpline, applySplineToTerrain, normalizeSpline } from './mapforge.spline.js';
import { createPost } from './mapforge.post.js';
import { applyTone } from './mapforge.engine.js';
import { PROP_CATALOG, PROP_BY_ID, buildProp } from './mapforge.props.js';
import { WEATHERS } from './mapforge.vfx.js';
import * as api from './mapforge.api.js';
import { confirm as askConfirm, signedIn, displayName, isAdmin, bridge, hubs as bridgeHubs, guides as bridgeGuides } from './mapforge.bridge.js';

let ED = null;
export function isOpen() { return !!ED; }
export function current() { return ED; }

export async function openEditor(opts) {
  opts = opts || {};
  if (ED) return ED;
  const root = document.createElement('div');
  root.id = 'mf-root';
  root.innerHTML = TEMPLATE;
  ensureCss();
  document.body.appendChild(root);
  const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));
  const loading = $('.mf-loading');
  const toastEl = $('.mf-toast');
  let toastT = 0;
  const toast = (m, ms) => { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), ms || 2600); };

  const S = {
    splinePreset: 'road', splinePt: -1, lastSrc: null,   // splines (round 13): picked preset, selected handle, last prop/model pick for Custom
    THREE: null, map: null, source: null, isPublic: false, mine: true, dirty: false,
    tool: 'select', sculptMode: 'raise', brush: { radius: 6, strength: 0.5, falloff: 0.6 },
    paintIdx: 0, propId: 'tree', propTint: null, assetId: null,
    scatter: { count: 6, jitterRot: true, jitterScale: 0.3, avoidWater: true },
    selectedId: null, gizmoMode: 'translate', snap: false, undo: [], redo: [], playing: false,
    showGrid: false, showMarkers: true, showColliders: false, showNav: false,
    hotkeys: (() => { try { return localStorage.getItem('mf_hotkeys') === 'default' ? 'default' : 'unreal'; } catch (e) { return 'unreal'; } })(),
    rmb: false, gizmoSpace: 'world', snapSize: 1,
    audioUrl: null, audioName: null, fxPreset: null,   // picked in the Files tab, consumed by makeObject
    folderId: null,     // the content folder new objects land in (null = root)
    game: null,         // registered game adapter id when this map is a game scene
    multi: new Set(),   // multi-selection (Ctrl/Shift+click); selectedId is the primary
    prefabId: null,     // the prefab the Place tool drops when propId === 'prefab'
    editingPrefab: null, // { pf, ids } while a prefab is unpacked for editing (Apply repacks it)
    bpOpen: false,      // the blueprint graph panel
  };
  const teardown = [];
  let outlinerT = 0, renaming = null;   // outliner redraw timer + the folder being renamed (declared early: loadDoc runs before the outliner section)
  ED = { root, S, close: () => close(false), toast, get map() { return S.map; }, get world() { return world; }, camera: null, scene: null, renderer: null };

  // ── three.js ──
  let THREE, missing;
  try { ({ THREE, missing } = await ensureThree()); } catch (e) {
    loading.innerHTML = '<div>three.js failed to load</div><div class="sub">Check your connection and try again.</div><button class="primary" style="margin-top:12px">Close</button>';
    loading.querySelector('button').onclick = () => close(true);
    return ED;
  }
  S.THREE = THREE;
  if (!ED) return null;   // closed while loading

  // ── document ──
  let doc = null;
  if (opts.map) doc = normalize(opts.map);
  else if (opts.id) {
    const r = await api.loadMap(opts.id, opts.source || 'local');
    if (r.ok) { doc = r.map; S.source = opts.source || 'local'; S.isPublic = !!r.is_public; S.mine = r.mine !== false; }
    else toast('Could not load that map: ' + (r.error || 'unknown error'), 4000);
  }
  let freshStart = false;
  // Opened FOR a mini-game (the ⚒ pill on that screen): its live world when
  // there is one, otherwise a fresh map already tagged with the game. Someone
  // else's live world opens read-only-ish: the first save makes your copy.
  if (!doc && opts.game) {
    const g = games.get(opts.game);
    const r = await api.loadLive(opts.game);
    if (r.ok && r.map) { doc = r.map; S.source = r.source || 'cloud'; S.isPublic = true; S.mine = r.mine !== false; }
    else if (g) { try { doc = normalize(g.build(THREE)); doc.game = g.id; S.source = null; setTimeout(() => toast('Built the ' + g.label + ' scene from the game — arrange it, Save, then ★ Set live so the game loads it.', 5600), 600); } catch (e) { toast('The ' + g.label + ' adapter failed to build its scene: ' + ((e && e.message) || e), 5000); } }
    else { doc = newMap({ author: displayName(), game: gameId(opts.game) || 'sandbox' }); freshStart = true; }
  }
  if (!doc) {
    const draft = api.loadDraft();
    if (draft) { doc = draft; S.source = null; setTimeout(() => toast('Restored your unsaved draft — save it or start a New map.', 4200), 600); }
  }
  if (!doc) { doc = newMap({ author: displayName() }); freshStart = true; }
  if (!ED) return null;

  // ── scene ──
  const canvasHost = $('.mf-canvas');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  quality.apply(renderer, null);
  const post = createPost(THREE, renderer);
  canvasHost.insertBefore(renderer.domElement, canvasHost.firstChild);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  let world = null, gridHelper = null;
  ED.camera = camera; ED.scene = scene; ED.renderer = renderer;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const brushRing = makeBrushRing(THREE); scene.add(brushRing);
  let ghost = null;
  // collider outlines: the selected object's (gold) and, on demand, everyone's
  const colSel = new THREE.Box3Helper(new THREE.Box3(), 0xffd23f); colSel.visible = false; colSel.material.depthTest = false; colSel.material.transparent = true; colSel.material.opacity = 0.9; scene.add(colSel);
  const colAll = new THREE.Group(); colAll.visible = false; scene.add(colAll);
  const splineG = new THREE.Group(); splineG.name = 'mf-spline-ui'; scene.add(splineG);
  let splineDraft = null;                       // { preset, pts: [[x,y,z]…] } while drawing — declared here, not with the spline code below: select() runs during loadDoc and reads splineH (TDZ otherwise)
  const splineH = { handles: [], line: null, draft: null };   // control-point handles + curve line of the selected spline, and the drawing preview
  // the trigger volume of the selected actor, drawn as a ring on the ground (blueprints section below); declared here because loadDoc runs first
  const trigRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })); trigRing.rotation.x = -Math.PI / 2; trigRing.visible = false; trigRing.renderOrder = 18; scene.add(trigRing);
  let bpGraph = null, bpFor = null;   // the blueprint graph editor instance and the object it shows
  let navMesh = null, navVer = -1;    // the navmesh overlay (Terrain tab → View → Navmesh)
  function drawNav() {
    if (navMesh && (!S.showNav || S.playing)) { scene.remove(navMesh); navMesh.geometry.dispose(); navMesh.material.dispose(); navMesh = null; navVer = -1; }
    if (!S.showNav || S.playing || !world) return;
    const nav = world.nav; if (!nav.baked) nav.bake();
    if (navMesh && navVer === nav.version) return;
    if (navMesh) { scene.remove(navMesh); navMesh.geometry.dispose(); navMesh.material.dispose(); }
    navMesh = nav.debugMesh(THREE); navVer = nav.version; scene.add(navMesh);
  }
  function drawColliders() {
    const o = objById(S.selectedId), c = o && world.colliders.get(o.id);
    colSel.visible = !!c && !S.playing;
    if (c) colSel.box.set(new THREE.Vector3(c.minX, c.bottom, c.minZ), new THREE.Vector3(c.maxX, c.top, c.maxZ));
    while (colAll.children.length) { const k = colAll.children.pop(); k.geometry && k.geometry.dispose(); }
    colAll.visible = S.showColliders && !S.playing;
    if (colAll.visible) world.colliders.forEach(c => { const h = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(c.minX, c.bottom, c.minZ), new THREE.Vector3(c.maxX, c.top, c.maxZ)), 0x5fd38a); h.material.transparent = true; h.material.opacity = 0.55; colAll.add(h); });
  }

  // camera controls — real OrbitControls when the addon loaded, a small
  // built-in orbit otherwise, both driven through the same `controls` shape
  const controls = makeControls(THREE, camera, renderer.domElement);
  let gizmo = null;
  if (THREE.TransformControls) {
    gizmo = new THREE.TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.9); gizmo.setSpace('world');
    gizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; if (e.value) beginObjectEdit(); else endObjectEdit(); });
    gizmo.addEventListener('objectChange', onGizmoChange);
    scene.add(gizmo);
  }
  ED.gizmo = gizmo;
  if (missing && missing.length) setTimeout(() => toast('Some editor addons did not load (' + missing.join(', ') + ') — using built-in fallbacks.', 4500), 900);

  // ── the Mini-game field: a select fed by the game's own registry ──
  // window.MythicBridge.miniGames() (index.html's ATHENA_MINI_GAMES), plus
  // 'sandbox', every game a saved map already carries, the current value if
  // it is none of those, and a Custom… entry for an id not on the list.
  let _knownGames = [];
  function setGameField(value, extra) {
    const sel = $('#mf-game'); if (!sel) return;
    if (extra) _knownGames = extra.slice();
    const opts = []; const seen = new Set();
    const add = (val, label) => { val = gameId(val); if (!val || seen.has(val)) return; seen.add(val); opts.push({ val, label: label || val }); };
    add('sandbox', 'sandbox · no game');
    miniGames().forEach(g => add(g.key || g.id, (g.name || g.id) + ' · ' + gameId(g.key || g.id)));
    _knownGames.forEach(g => add(g));
    add(value);
    // build A's registered game adapters (farm, battle, the showrooms) are choices too
    try { games.list().forEach(g => add(g.id, (g.icon ? g.icon + ' ' : '') + (g.label || g.id))); } catch (e) {}
    /* a free-text input with a datalist (build A's field): every known id is a
       suggestion, and an id nobody listed can still be typed — the "Custom id…"
       prompt of the old <select> is no longer needed */
    const dl = $('#mf-games'); if (dl) dl.innerHTML = opts.map(o => '<option value="' + esc(o.val) + '">' + esc(o.label) + '</option>').join('');
    sel.value = gameId(value) || 'sandbox';
  }
  function currentGameField() { const sel = $('#mf-game'); const v = sel ? sel.value : ''; return v === '__custom__' ? (S.map.game || 'sandbox') : v; }

  function loadDoc(map, source) {
    if (world) { scene.remove(world.group); world.dispose(); }
    if (gridHelper) { scene.remove(gridHelper); gridHelper = null; }
    S.map = map; S.source = source == null ? S.source : source;
    world = buildWorld(THREE, map, { scene, camera, slotBody: (o, T) => { const g = map.game && games.get(map.game); return g && typeof g.slotBody === 'function' ? g.slotBody(o, T) : null; }, shadowMap: quality.get().settings.shadowMap, fx: quality.get().settings.fx, fxRange: quality.get().settings.fxRange, onEnv: (env) => applyTone(THREE, renderer, env), onAssetLoaded: () => {}, toast: (m, ms) => toast(m, ms), onPrompt: (p) => { const el = $('#mf-prompt'); el.hidden = !p; el.textContent = p ? '⚡ ' + p : ''; } });
    S.editingPrefab = null; S.multi.clear(); S.bpOpen = false; if (bpGraph) { bpGraph.destroy(); bpGraph = null; bpFor = null; }
    scene.add(world.group);
    world.setMarkersVisible(S.showMarkers);
    if (S.showGrid) toggleGrid(true);
    S.undo.length = 0; S.redo.length = 0; select(null);
    frameOverview();
    $('.mf-top .name input').value = map.name;
    $('#mf-desc').value = map.description || '';
    setGameField(map.game || 'sandbox');
    S.game = games.get(map.game) ? games.get(map.game).id : null; S.folderId = null;
    renderGameTag();
    renderTerrainTab(); renderWaterTab(); renderSkyTab(); renderStats(); renderOutliner(true); renderSceneFlags();
    setDirty(false);
  }
  function renderGameTag() { const el = $('.mf-top .gametag'); const g = S.game && games.get(S.game); el.textContent = g ? g.icon + ' ' + g.label + ' scene' : ''; el.style.display = g ? '' : 'none'; }
  function frameOverview() {
    const size = world.terrain.size;
    let sum = 0; const h = S.map.terrain.heights; for (let i = 0; i < h.length; i += 7) sum += h[i];
    const avg = sum / Math.ceil(h.length / 7);
    controls.target.set(0, avg, 0);
    camera.position.set(size * 0.55, Math.max(12, size * 0.42 + avg), size * 0.55);
    controls.update();
  }

  loadDoc(doc, S.source);
  if (freshStart) { world.terrain.generate({ type: 'hills', seed: (Math.random() * 1e6) | 0, amplitude: 6, scale: 0.35 }); regroundAll(); }

  // ── sizing ──
  function resize() {
    const w = canvasHost.clientWidth || 1, h = canvasHost.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvasHost); resize();
  teardown.push(() => ro.disconnect());

  /* ═══ TOOLS ═══ */
  const stroke = { active: false, hit: null, target: 0, before: null, lastX: 0, lastZ: 0, dist: 0 };

  function setTool(t) {
    if (t !== 'place' && splineDraft) splineDraftCancel();
    S.tool = t;
    try { drawSplineHandles(); } catch (e) {}
    $$('.mf-tools button[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    const gs = $('#mf-gm-select'); if (gs) gs.classList.toggle('on', t === 'select');
    if (t !== 'select' && gizmo) gizmo.detach();
    if (t === 'select' && gizmo && S.selectedId) { const r = world.objects.get(S.selectedId); if (r) gizmo.attach(r); }
    refreshGhost();
    renderHud();
  }
  function setSculptMode(m) { S.sculptMode = m; $$('button[data-sculpt]').forEach(b => b.classList.toggle('on', b.dataset.sculpt === m)); renderHud(); }

  function effectiveSculptMode(ev) {
    if (ev && ev.altKey) return 'flatten';
    if (ev && ev.ctrlKey) return 'smooth';
    if (ev && ev.shiftKey) return S.sculptMode === 'lower' ? 'raise' : 'lower';
    return S.sculptMode;
  }

  function updatePointer(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  function hitTerrain() { const h = raycaster.intersectObject(world.terrain.mesh, false); return h.length ? h[0].point : null; }
  function hitObject() {
    world.objectsGroup.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(world.objectsGroup.children, true);
    for (const h of hits) { let o = h.object; while (o && !(o.userData && o.userData.mfId && !o.userData.mfPart)) o = o.parent; if (o && o.visible && !isLocked(o.userData.mfId)) return o; }
    // Near-miss pick: thin things (lantern posts, fences, a bird's wing) are
    // easy to click past. Take the nearest object whose centre projects within
    // a few pixels of the pointer, the way most editors forgive a miss.
    const r = renderer.domElement.getBoundingClientRect(), tol = 14, px = (pointer.x + 1) / 2 * r.width, py = (1 - pointer.y) / 2 * r.height;
    let best = null, bestD = tol * tol; const c = new THREE.Vector3(), bb = new THREE.Box3();
    world.objects.forEach(root => {
      if (!root.visible || isLocked(root.userData.mfId)) return;
      bb.setFromObject(root); if (bb.isEmpty()) return; bb.getCenter(c); c.project(camera);
      if (c.z > 1) return;
      const dx = (c.x + 1) / 2 * r.width - px, dy = (1 - c.y) / 2 * r.height - py, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = root; }
    });
    return best;
  }

  let lastMods = { shiftKey: false, ctrlKey: false, altKey: false };
  function onPointerDown(ev) {
    if (S.playing) return;
    renderer.domElement.focus();
    if (ev.button === 2) S.rmb = true;
    if (ev.button !== 0) return;
    if (gizmo && gizmo.dragging) return;
    if (gizmo && gizmo.object && gizmo.axis) return;     // clicked the gizmo itself (axis goes stale after detach — hence the .object check)
    updatePointer(ev);
    lastMods = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey };
    if (S.tool === 'select' && splineH.handles.length) {
      const hh = raycaster.intersectObjects(splineH.handles, false);
      if (hh.length) { S.splinePt = hh[0].object.userData.mfSplinePt; drawSplineHandles(true); if (gizmo) { gizmo.attach(hh[0].object); gizmo.setMode('translate'); } renderInspector(); return; }
    }
    if (S.tool === 'select') {
      const o = hitObject();
      if (o && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) { toggleMulti(o.userData.mfId); return; }
      select(o ? o.userData.mfId : null);
      if (o && !gizmo) { stroke.active = true; stroke.dragObj = o; beginObjectEdit(); }
      return;
    }
    if (S.tool === 'erase') { const o = hitObject(); if (o) { beginObjectEdit(); removeObject(o.userData.mfId); endObjectEdit(); } return; }
    const p = hitTerrain(); if (!p) return;
    if (S.tool === 'place' && S.propId === 'spline') { splineDraftAdd(p); return; }
    if (S.tool === 'place') { beginObjectEdit(); placeAt(p, true); endObjectEdit(); return; }
    if (S.tool === 'scatter') { beginObjectEdit(); stroke.active = true; stroke.dist = 1e9; stroke.hit = p; stroke.lastX = p.x; stroke.lastZ = p.z; scatterAt(p); return; }
    if (S.tool === 'sculpt' || S.tool === 'paint') {
      stroke.active = true; stroke.hit = p; stroke.before = world.terrain.snapshot(); stroke.target = world.terrain.heightAt(p.x, p.z);
      renderer.domElement.setPointerCapture(ev.pointerId);
    }
  }
  function onPointerMove(ev) {
    if (S.playing) return;
    updatePointer(ev);
    lastMods = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey };
    const p = hitTerrain();
    stroke.hit = p;
    if (stroke.active && stroke.dragObj && p) {
      const o = objById(stroke.dragObj.userData.mfId); if (!o) return;
      o.p[0] = p.x; o.p[2] = p.z; if (o.g) o.p[1] = world.heightAt(p.x, p.z);
      world.applyTransform(stroke.dragObj, o); setDirty(true); renderInspector();
    }
    if (stroke.active && S.tool === 'scatter' && p) {
      stroke.dist += Math.hypot(p.x - stroke.lastX, p.z - stroke.lastZ); stroke.lastX = p.x; stroke.lastZ = p.z;
      if (stroke.dist > S.brush.radius * 0.8) { stroke.dist = 0; scatterAt(p); }
    }
  }
  function onPointerUp(ev) {
    if (ev.button === 2) { S.rmb = false; fly.keys = {}; }
    if (!stroke.active) return;
    stroke.active = false;
    try { renderer.domElement.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (stroke.dragObj) { stroke.dragObj = null; endObjectEdit(); return; }
    if (S.tool === 'scatter') { endObjectEdit(); return; }
    if (stroke.before) {
      pushUndo({ type: 'terrain', before: stroke.before, after: world.terrain.snapshot() });
      stroke.before = null; regroundAll(); setDirty(true); world.navInvalidate(); drawNav();
    }
  }
  const cv = renderer.domElement;
  cv.tabIndex = 0;
  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('dblclick', (e) => { if (splineDraft) { e.preventDefault(); splineDraftFinish(false); } });
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('pointerleave', () => { stroke.hit = null; });
  window.addEventListener('pointerup', (e) => { if (e.button === 2) { S.rmb = false; fly.keys = {}; } });
  cv.addEventListener('contextmenu', e => e.preventDefault());

  /* Sculpting runs per FRAME while the button is held so the rate is
     time-based, not event-based: a fast mouse and a slow one raise the same
     hill per second. */
  function applyStrokeFrame(dt) {
    if (!stroke.active || !stroke.hit || !(S.tool === 'sculpt' || S.tool === 'paint')) return;
    const b = S.brush, p = stroke.hit;
    if (S.tool === 'paint') { world.terrain.applyBrush({ x: p.x, z: p.z, radius: b.radius, strength: b.strength, falloff: b.falloff, mode: 'paint', paint: S.paintIdx }); return; }
    const mode = effectiveSculptMode(lastMods);
    const rate = mode === 'raise' || mode === 'lower' ? b.strength * 9 * dt : b.strength * 6 * dt;
    world.terrain.applyBrush({ x: p.x, z: p.z, radius: b.radius, strength: rate, falloff: b.falloff, mode, target: stroke.target });
  }

  /* ═══ OBJECTS ═══ */
  function objById(id) { return S.map.objects.find(o => o.id === id) || null; }
  function beginObjectEdit() { stroke.objBefore = { objects: clone(S.map.objects), assets: clone(S.map.assets), folders: clone(S.map.folders || []), prefabs: clone(S.map.prefabs || []) }; }
  function endObjectEdit() {
    if (!stroke.objBefore) return;
    const after = { objects: clone(S.map.objects), assets: clone(S.map.assets), folders: clone(S.map.folders || []), prefabs: clone(S.map.prefabs || []) };
    if (JSON.stringify(after) !== JSON.stringify(stroke.objBefore)) { pushUndo({ type: 'objects', before: stroke.objBefore, after }); setDirty(true); }
    stroke.objBefore = null;
    drawColliders(); renderOutliner(); drawNav();
  }

  /* ═══ CONTENT FOLDERS ═══ — the World Outliner. Objects carry `f`; folders nest. */
  function folderById(id) { return (S.map.folders || []).find(f => f.id === id) || null; }
  function folderDepth(id) { let d = 0, f = folderById(id); while (f && f.parent && d < 200) { d++; f = folderById(f.parent); } return d; }
  function isLocked(objId) { const o = objById(objId); let f = o && o.f ? folderById(o.f) : null, hops = 0; while (f && hops++ < 200) { if (f.lock) return true; f = f.parent ? folderById(f.parent) : null; } return false; }
  function folderChildren(parent) { return (S.map.folders || []).filter(f => (f.parent || null) === (parent || null)); }
  function folderObjects(id) { return S.map.objects.filter(o => (o.f || null) === (id || null)); }
  function folderDescendants(id) { const out = [id]; for (let i = 0; i < out.length; i++) folderChildren(out[i]).forEach(f => out.push(f.id)); return out; }
  function isAncestor(maybeAncestor, id) { let f = folderById(id), hops = 0; while (f && hops++ < 200) { if (f.id === maybeAncestor) return true; f = f.parent ? folderById(f.parent) : null; } return false; }
  function newFolder(parent, name) {
    beginObjectEdit();
    const f = { id: uid('f_'), name: (name || 'New folder').slice(0, 60), parent: parent || null, open: true, vis: true, lock: false };
    S.map.folders.push(f);
    if (parent) { const pf = folderById(parent); if (pf) pf.open = true; }
    endObjectEdit(); setDirty(true); S.folderId = f.id; renderOutliner(); renderInspector();
    return f;
  }
  function renameFolder(id, name) { const f = folderById(id); if (!f) return; name = String(name || '').trim().slice(0, 60); if (!name || name === f.name) { renderOutliner(); return; } beginObjectEdit(); f.name = name; endObjectEdit(); setDirty(true); renderOutliner(); }
  function deleteFolder(id) {
    const f = folderById(id); if (!f) return;
    beginObjectEdit();
    // children fold up into the parent; nothing is ever deleted with a folder
    folderChildren(id).forEach(c => { c.parent = f.parent || null; });
    S.map.objects.forEach(o => { if (o.f === id) { if (f.parent) o.f = f.parent; else delete o.f; } });
    S.map.folders = S.map.folders.filter(x => x.id !== id);
    if (S.folderId === id) S.folderId = f.parent || null;
    endObjectEdit(); setDirty(true); world.applyFolderVisibility(); renderOutliner(); renderInspector();
  }
  function moveToFolder(objIds, folderId) {
    if (folderId && !folderById(folderId)) folderId = null;
    beginObjectEdit();
    objIds.forEach(id => { const o = objById(id); if (!o) return; if (folderId) o.f = folderId; else delete o.f; });
    endObjectEdit(); setDirty(true); world.applyFolderVisibility(); renderOutliner(); renderInspector();
  }
  function moveFolder(id, parent) {
    if (id === parent || (parent && isAncestor(id, parent))) return;   // never into itself
    const f = folderById(id); if (!f) return;
    beginObjectEdit(); f.parent = parent || null; endObjectEdit(); setDirty(true); renderOutliner();
  }
  function setFolderFlag(id, key, v) {
    const f = folderById(id); if (!f) return; f[key] = v;
    if (key === 'vis') { world.applyFolderVisibility(); if (S.selectedId && !v && folderDescendants(id).includes((objById(S.selectedId) || {}).f)) select(null); }
    if (key === 'lock' && v && S.selectedId && isLocked(S.selectedId)) select(null);
    setDirty(true); renderOutliner();
  }
  function selectFolderObjects(id) { const ids = folderDescendants(id); const objs = S.map.objects.filter(o => o.f && ids.includes(o.f)); if (objs.length) { select(objs[0].id); focusSelected(); toast(objs.length + ' object' + (objs.length === 1 ? '' : 's') + ' in this folder — first one selected.'); } else toast('This folder is empty.'); }
  function objLabel(o) {
    if (o.n) return o.n;
    if (o.t === 'glb') return (S.map.assets.find(a => a.id === o.a) || {}).label || 'Model';
    if (o.t === 'prefab') { const p = prefabById(o.pf); return p ? p.name : 'Prefab'; }
    if (o.k) { const sl = slotMeta(o.k); if (sl) return sl.label; }
    return (PROP_BY_ID[o.t] || {}).label || o.t;
  }
  function objIcon(o) { if (o.k) return '🧩'; if (o.t === 'glb') return '🧊'; if (o.t === 'prefab') return '🧱'; return ((PROP_BY_ID[o.t] || {}).icon || '🧱') + (hasBehaviour(o) ? '⚡' : ''); }
  function slotMeta(k) { const g = S.game && games.get(S.game); return (g && (g.slots || []).find(x => x.k === k)) || null; }
  function renderOutliner(force) {
    // Only draw when the tab is showing (a scatter stroke adds dozens of objects a second).
    const panel = $('.mf-tab[data-tab="scene"]'); if (!panel || (!panel.classList.contains('on') && !force)) return;
    clearTimeout(outlinerT); outlinerT = setTimeout(drawOutliner, 0);
  }
  function drawOutliner() {
    if (!ED) return;
    const box = $('#mf-outliner'); if (!box) return;
    const MAX = 200;
    const objRow = (o) => `<div class="mf-ol-o ${o.id === S.selectedId ? 'sel' : (S.multi.has(o.id) ? 'multi' : '')} ${isLocked(o.id) ? 'locked' : ''}" draggable="true" data-oid="${esc(o.id)}" title="${esc(objLabel(o))}"><span class="ic">${objIcon(o)}</span><span class="lb">${esc(objLabel(o))}</span>${o.k ? '<span class="tag">' + esc(o.k) + '</span>' : ''}</div>`;
    const objList = (fid) => { const os = folderObjects(fid); return os.slice(0, MAX).map(objRow).join('') + (os.length > MAX ? '<div class="mf-empty">… ' + (os.length - MAX) + ' more</div>' : ''); };
    const countIn = (fid) => { const ids = folderDescendants(fid); return S.map.objects.filter(o => o.f && ids.includes(o.f)).length; };
    const folderRow = (f, depth) => {
      const kids = folderChildren(f.id), n = countIn(f.id);
      const head = `<div class="mf-ol-f ${f.id === S.folderId ? 'active' : ''} ${f.vis === false ? 'hidden' : ''} ${f.lock ? 'locked' : ''}" draggable="true" data-fid="${esc(f.id)}" style="--d:${depth}">
        <button class="tw" data-act="toggle" title="Expand / collapse">${f.open ? '▾' : '▸'}</button>
        <span class="ic">📁</span>
        ${renaming === f.id ? `<input type="text" class="rn" value="${esc(f.name)}" maxlength="60">` : `<span class="lb" data-act="pick" title="Click: place new objects here · double-click: rename">${esc(f.name)}</span>`}
        <span class="n">${n}</span>
        <button data-act="vis" title="${f.vis === false ? 'Show' : 'Hide'} folder">${f.vis === false ? '🙈' : '👁'}</button>
        <button data-act="lock" title="${f.lock ? 'Unlock' : 'Lock'} (locked objects cannot be picked in the viewport)">${f.lock ? '🔒' : '🔓'}</button>
        <button data-act="sel" title="Select the objects in this folder">◎</button>
        <button data-act="sub" title="New sub-folder">＋</button>
        <button data-act="pf" title="Make a prefab from everything in this folder">📦</button>
        <button data-act="del" title="Delete folder (its contents move up a level)">✕</button>
      </div>`;
      const body = f.open ? `<div class="mf-ol-body" style="--d:${depth + 1}">${kids.map(k => folderRow(k, depth + 1)).join('')}${objList(f.id)}</div>` : '';
      return head + body;
    };
    const roots = folderChildren(null), loose = folderObjects(null);
    box.innerHTML = `<div class="mf-ol-root ${S.folderId ? '' : 'active'}" data-fid=""><span class="ic">🗂</span><span class="lb" data-act="pickroot" title="Click: place new objects at the root">Scene root</span><span class="n">${S.map.objects.length}</span></div>`
      + roots.map(f => folderRow(f, 0)).join('')
      + (loose.length ? `<div class="mf-ol-loose"><div class="mf-sub">Loose objects (${loose.length})</div>${loose.slice(0, MAX).map(objRow).join('')}${loose.length > MAX ? '<div class="mf-empty">… ' + (loose.length - MAX) + ' more</div>' : ''}</div>` : '')
      + (!roots.length && !loose.length ? '<div class="mf-empty">Nothing placed yet. Make a folder, pick it, and everything you place lands inside it.</div>' : '');
    // wiring
    box.querySelectorAll('.mf-ol-f').forEach(row => {
      const fid = row.dataset.fid;
      row.querySelectorAll('button[data-act]').forEach(b => b.onclick = (e) => {
        e.stopPropagation(); const a = b.dataset.act, f = folderById(fid); if (!f) return;
        if (a === 'toggle') { f.open = !f.open; drawOutliner(); }
        else if (a === 'vis') setFolderFlag(fid, 'vis', f.vis === false);
        else if (a === 'lock') setFolderFlag(fid, 'lock', !f.lock);
        else if (a === 'sel') selectFolderObjects(fid);
        else if (a === 'sub') newFolder(fid);
        else if (a === 'pf') { const ids = folderDescendants(fid); const objs = S.map.objects.filter(x => x.f && ids.includes(x.f)).map(x => x.id); if (objs.length) createPrefab(objs, f.name); else toast('This folder is empty.'); }
        else if (a === 'del') { if (countIn(fid) > 0 || folderChildren(fid).length) { askConfirm('Delete folder "' + f.name + '"? Its ' + countIn(fid) + ' objects move up a level (nothing is removed from the map).').then(ok => { if (ok) deleteFolder(fid); }); } else deleteFolder(fid); }
      });
      const lb = row.querySelector('.lb[data-act="pick"]');
      if (lb) { lb.onclick = () => { S.folderId = fid; drawOutliner(); renderHud(); }; lb.ondblclick = () => { renaming = fid; drawOutliner(); const inp = box.querySelector('.mf-ol-f[data-fid="' + fid + '"] input.rn'); if (inp) { inp.focus(); inp.select(); } }; }
      const rn = row.querySelector('input.rn');
      if (rn) { rn.onblur = () => { renaming = null; renameFolder(fid, rn.value); }; rn.onkeydown = (e) => { if (e.key === 'Enter') rn.blur(); if (e.key === 'Escape') { renaming = null; drawOutliner(); } e.stopPropagation(); }; }
      row.ondragstart = (e) => { e.dataTransfer.setData('text/mf-folder', fid); e.stopPropagation(); };
      row.ondragover = (e) => { e.preventDefault(); row.classList.add('over'); };
      row.ondragleave = () => row.classList.remove('over');
      row.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); row.classList.remove('over'); const oid = e.dataTransfer.getData('text/mf-object'), mf = e.dataTransfer.getData('text/mf-folder'); if (oid) moveToFolder([oid], fid); else if (mf) moveFolder(mf, fid); };
    });
    const rootRow = box.querySelector('.mf-ol-root');
    rootRow.querySelector('.lb').onclick = () => { S.folderId = null; drawOutliner(); renderHud(); };
    rootRow.ondragover = (e) => { e.preventDefault(); rootRow.classList.add('over'); };
    rootRow.ondragleave = () => rootRow.classList.remove('over');
    rootRow.ondrop = (e) => { e.preventDefault(); rootRow.classList.remove('over'); const oid = e.dataTransfer.getData('text/mf-object'), mf = e.dataTransfer.getData('text/mf-folder'); if (oid) moveToFolder([oid], null); else if (mf) moveFolder(mf, null); };
    box.querySelectorAll('.mf-ol-o').forEach(row => {
      const oid = row.dataset.oid;
      row.onclick = (e) => { if (S.tool !== 'select') setTool('select'); if (e.ctrlKey || e.metaKey || e.shiftKey) toggleMulti(oid); else select(oid); };
      row.ondblclick = () => { select(oid); focusSelected(); };
      row.ondragstart = (e) => { e.dataTransfer.setData('text/mf-object', oid); e.stopPropagation(); };
    });
    const sel = box.querySelector('.mf-ol-o.sel'); if (sel && sel.scrollIntoView) { try { sel.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }
  function folderOptions(current) {
    const rows = []; const walk = (parent, depth) => folderChildren(parent).forEach(f => { rows.push('<option value="' + esc(f.id) + '"' + (f.id === current ? ' selected' : '') + '>' + '\u00a0\u00a0'.repeat(depth) + '📁 ' + esc(f.name) + '</option>'); walk(f.id, depth + 1); });
    walk(null, 0); return '<option value="">🗂 Scene root</option>' + rows.join('');
  }

  /* ═══ GAME SCENES ═══ — a mini-game's own map: slots the game draws, pieces it renders. */
  function renderSceneFlags() {
    const box = $('#mf-scene-flags'); if (!box) return;
    const sc = S.map.scene || { ground: true, water: true, sky: true };
    const g = S.game && games.get(S.game);
    box.innerHTML = `<p class="mf-hint" style="margin:0 0 6px">${g ? 'What <b>' + esc(g.label) + '</b> renders from this map (it keeps its own for anything unticked). Objects, effects and weather always apply.' : 'For a game that loads this map as an overlay: which pieces it takes from here.'}</p>
      <div class="mf-row"><label>Ground</label><input type="checkbox" data-scene="ground" ${sc.ground ? 'checked' : ''}><span class="mf-hint" style="margin:0">terrain + paint</span></div>
      <div class="mf-row"><label>Water</label><input type="checkbox" data-scene="water" ${sc.water ? 'checked' : ''}></div>
      <div class="mf-row"><label>Sky</label><input type="checkbox" data-scene="sky" ${sc.sky ? 'checked' : ''}><span class="mf-hint" style="margin:0">sky, sun, fog</span></div>`;
    box.querySelectorAll('input[data-scene]').forEach(inp => inp.onchange = () => { S.map.scene = S.map.scene || {}; S.map.scene[inp.dataset.scene] = inp.checked; setDirty(true); });
  }
  function renderGamesList() {
    const box = $("#mf-gamescenes"); if (!box) return;
    const list = games.list();
    box.innerHTML = list.length ? list.map(g => `<div class="mf-map ${S.map.game === g.id ? 'cur' : ''}" data-game="${esc(g.id)}">
        <div class="t"><span>${g.icon}</span><span>${esc(g.label)}</span><span class="tag">${esc(g.id)}</span></div>
        <div class="m">${esc(g.describe || '')}</div>
        <div class="acts"><button data-act="open">Open scene</button><button data-act="rebuild" title="Build a fresh scene from the game's current layout">↻ Rebuild from game</button>${S.map.game === g.id ? '<button data-act="slots" title="Add back any game asset this map no longer has a slot for">🧩 Restore missing slots</button>' : ''}</div>
      </div>`).join('') : '<div class="mf-empty">No game has registered a scene yet. Open the Homestead Farm once (it registers on load), or see docs/athena-engine.md → Game scenes.</div>';
    box.querySelectorAll('.mf-map').forEach(el => {
      const id = el.dataset.game;
      el.querySelector('[data-act="open"]').onclick = () => openGame(id, false);
      el.querySelector('[data-act="rebuild"]').onclick = () => openGame(id, true);
      const sl = el.querySelector('[data-act="slots"]'); if (sl) sl.onclick = () => restoreSlots(id);
    });
  }
  async function openGame(id, rebuild) {
    const g = games.get(id); if (!g) return;
    if (S.dirty && !(await askConfirm('Discard unsaved changes and open the ' + g.label + ' scene?'))) return;
    if (!rebuild) {
      const r = await api.loadLive(id);
      if (r.ok) { S.isPublic = !!r.is_public; S.mine = r.mine !== false; loadDoc(r.map, r.source); api.clearDraft(); renderMapsTab(); toast('Opened the live ' + g.label + ' scene' + (r.source === 'cloud' ? ' from the cloud.' : ' from this device.'), 3200); return; }
    }
    let doc; try { doc = normalize(g.build(THREE)); } catch (e) { toast('The ' + g.label + ' adapter failed: ' + ((e && e.message) || e), 5000); return; }
    doc.game = g.id; doc.name = doc.name || g.label;
    S.isPublic = false; S.mine = true; loadDoc(doc, null); setDirty(true); renderMapsTab();
    toast('Built the ' + g.label + ' scene from the game. Move the slots, replace them with props or models, add anything — then Save and ★ Set live.', 6000);
  }
  function restoreSlots(id) {
    const g = games.get(id); if (!g) return;
    let doc; try { doc = normalize(g.build(THREE)); } catch (e) { toast('Adapter failed: ' + ((e && e.message) || e), 4000); return; }
    const have = new Set(S.map.objects.filter(o => o.k).map(o => o.k));
    const missing = doc.objects.filter(o => o.k && !have.has(o.k));
    if (!missing.length) { toast('Every game asset already has a slot.'); return; }
    beginObjectEdit();
    // keep the adapter's folders for the restored slots when this map lacks them
    missing.forEach(o => { if (o.f) { const src = doc.folders.find(f => f.id === o.f); if (src && !folderById(src.id)) S.map.folders.push(clone(src)); } S.map.objects.push(o); world.addObject(o); });
    endObjectEdit(); setDirty(true); renderStats(); toast('Restored ' + missing.length + ' slot' + (missing.length === 1 ? '' : 's') + '.');
  }
  function replaceSlot(o) {
    const isGlb = S.propId === 'glb';
    if (isGlb && !S.assetId) { toast('Pick a model in the Library first.'); return; }
    if (!isGlb && (S.propId === 'slot' || (PROP_BY_ID[S.propId] && PROP_BY_ID[S.propId].marker))) { toast('Pick a prop or model in the Library to stand in for this asset.'); return; }
    beginObjectEdit();
    o.t = isGlb ? 'glb' : S.propId; if (isGlb) o.a = S.assetId; else delete o.a;
    delete o.anim; delete o.c; if (!isGlb && S.propTint && PROP_BY_ID[o.t] && PROP_BY_ID[o.t].tint) o.c = S.propTint;
    if (isGlb) { const fit = assetFit.get(S.assetId); if (fit) o.s = [fit, fit, fit]; }
    world.removeObject(o.id); world.addObject(o);
    endObjectEdit(); setDirty(true); select(o.id);
    toast('Slot replaced — the game now draws ' + objLabel(o) + ' here.');
  }
  function restoreSlot(o) {
    beginObjectEdit(); o.t = 'slot'; delete o.a; delete o.anim; delete o.c; o.s = [1, 1, 1];
    world.removeObject(o.id); world.addObject(o);
    endObjectEdit(); setDirty(true); select(o.id); toast('Restored — the game draws its own asset here again.');
  }
  /* ═══ ACTOR BLUEPRINTS ═══ — components + an event graph on the selected object. */
  function renderBpSection(o) {
    const bp = o.bp;
    const comps = bp ? bp.comps.map((c, i) => { const C = COMPONENTS[c.type]; const E = C.enums || {}; return `<div class="mf-comp" data-ci="${i}" title="${esc(C.help || '')}"><span class="ic">${C.icon}</span><span class="lb">${esc(C.label)}</span>${Object.keys(C.fields).map(k => `<label>${esc(k)}${(c.type === 'sound' && k === 's') ? '<select data-ck="s"><option value="">— pick —</option>' + (S.map.sounds || []).map(x => '<option value="' + esc(x.id) + '"' + (c.s === x.id ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select>' : E[k] ? '<select data-ck="' + k + '">' + E[k].map(v => '<option value="' + v + '"' + (c[k] === v ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>' : `<input type="${k === 'c' ? 'color' : (typeof C.fields[k] === 'number' ? 'number' : 'text')}" data-ck="${k}" value="${esc(c[k])}" ${typeof C.fields[k] === 'number' ? 'step="0.1"' : ''}>`}</label>`).join('')}<button data-cdel="${i}" title="Remove">✕</button></div>`; }).join('') : '';
    const vars = bp ? Object.keys(bp.vars).map(k => `<div class="mf-comp var" data-vk="${esc(k)}"><code>$${esc(k)}</code><select data-vt><option value="number" ${bp.vars[k].type === 'number' ? 'selected' : ''}>num</option><option value="string" ${bp.vars[k].type === 'string' ? 'selected' : ''}>text</option><option value="bool" ${bp.vars[k].type === 'bool' ? 'selected' : ''}>bool</option></select><input type="text" data-vv value="${esc(bp.vars[k].value == null ? '' : bp.vars[k].value)}"><button data-vdel title="Remove">✕</button></div>`).join('') : '';
    const n = bp ? bp.graph.nodes.length : 0;
    return `<div class="mf-bp"><div class="mf-row" style="margin-bottom:5px"><label>Blueprint</label><span class="st">⚡ ${bp ? (bp.comps.length + ' component' + (bp.comps.length === 1 ? '' : 's') + ' · ' + n + ' node' + (n === 1 ? '' : 's')) : 'none — static prop'}</span></div>
      ${bp ? `<div class="mf-sub">Components</div>${comps || '<div class="mf-empty">No components.</div>'}` : ''}
      <div class="mf-btns" style="margin:6px 0"><select id="mf-bp-addc"><option value="">＋ Add component…</option>${Object.keys(COMPONENTS).map(k => '<option value="' + k + '">' + COMPONENTS[k].icon + ' ' + esc(COMPONENTS[k].label) + '</option>').join('')}</select></div>
      ${bp ? `<div class="mf-sub">Variables</div>${vars}<div class="mf-btns" style="margin:4px 0"><input type="text" id="mf-bp-vname" placeholder="variable" maxlength="40"><button id="mf-bp-vadd">＋</button></div>` : ''}
      <div class="mf-btns" style="margin-top:6px"><button id="mf-bp-graph" class="${S.bpOpen ? 'on' : 'primary'}">⚡ ${bp ? 'Event graph' : 'Add blueprint'}</button>${bp ? '<button id="mf-bp-clear" class="danger" title="Remove the blueprint">✕</button>' : ''}</div>
      <p class="mf-hint" style="margin:6px 0 0">Runs in Play (P) and in the game: Begin Play, Tick, the player entering a Trigger volume, pressing <b>E</b> inside it, a Physics body hitting something, the player coming into view → move, rotate, spin, impulse, walk the navmesh (Move To / Chase / Patrol / Wander), tint, animate, spawn, destroy, toast, variables, game actions.</p></div>`;
  }
  function ensureBp(o) { if (!o.bp) { o.bp = newBlueprint(); } return o.bp; }
  function wireBpSection(box, o) {
    const commitBp = (fn) => { beginObjectEdit(); fn(); endObjectEdit(); setDirty(true); renderInspector(); renderBpPanel(); };
    const addc = box.querySelector('#mf-bp-addc'); if (addc) addc.onchange = () => { const t = addc.value; if (!t) return; commitBp(() => { ensureBp(o).comps.push(Object.assign({ type: t }, COMPONENTS[t].fields)); }); if (t === 'light' || t === 'trigger') drawTriggerRing(); };
    box.querySelectorAll('.mf-comp[data-ci]').forEach(row => {
      const i = +row.dataset.ci;
      row.querySelectorAll('[data-ck]').forEach(inp => inp.onchange = () => commitBp(() => { const c = o.bp.comps[i]; c[inp.dataset.ck] = inp.type === 'number' ? (+inp.value || 0) : inp.value; }));
      row.querySelector('[data-cdel]').onclick = () => commitBp(() => { o.bp.comps.splice(i, 1); });
    });
    box.querySelectorAll('.mf-comp[data-vk]').forEach(row => {
      const k = row.dataset.vk;
      row.querySelector('[data-vt]').onchange = (e) => commitBp(() => { o.bp.vars[k].type = e.target.value; });
      row.querySelector('[data-vv]').onchange = (e) => commitBp(() => { const t = o.bp.vars[k].type; o.bp.vars[k].value = t === 'number' ? (+e.target.value || 0) : t === 'bool' ? /^(true|1|yes|on)$/i.test(e.target.value) : e.target.value; });
      row.querySelector('[data-vdel]').onclick = () => commitBp(() => { delete o.bp.vars[k]; });
    });
    const va = box.querySelector('#mf-bp-vadd'); if (va) va.onclick = () => { const k = String(box.querySelector('#mf-bp-vname').value || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40); if (!k) return; commitBp(() => { ensureBp(o).vars[k] = { type: 'number', value: 0 }; }); };
    const gb = box.querySelector('#mf-bp-graph'); if (gb) gb.onclick = () => { if (!o.bp) commitBp(() => ensureBp(o)); S.bpOpen = !S.bpOpen; renderBpPanel(); renderInspector(); };
    const cb = box.querySelector('#mf-bp-clear'); if (cb) cb.onclick = () => { S.bpOpen = false; commitBp(() => { delete o.bp; }); drawTriggerRing(); };
  }
  function drawTriggerRing() {
    const o = objById(S.selectedId); const tr = o && o.bp && o.bp.comps.find(c => c.type === 'trigger'); const r = o && world.objects.get(o.id);
    trigRing.visible = !!(tr && r && !S.playing);
    if (trigRing.visible) { const rad = tr.r * Math.max(0.01, o.s[0]); trigRing.position.set(r.position.x, world.heightAt(r.position.x, r.position.z) + 0.08, r.position.z); trigRing.scale.set(rad, rad, 1); }
  }
  function renderBpPanel() {
    const panel = $('#mf-bp'); const o = objById(S.selectedId);
    drawTriggerRing();
    if (!S.bpOpen || !o || !o.bp) { panel.hidden = true; if (bpGraph) { bpGraph.destroy(); bpGraph = null; bpFor = null; } return; }
    panel.hidden = false;
    $('#mf-bp-title').textContent = '⚡ ' + (o.n || objLabel(o)) + ' — event graph';
    if (bpFor !== o.id || !bpGraph) {
      if (bpGraph) bpGraph.destroy();
      bpFor = o.id;
      bpGraph = createGraphEditor($('#mf-bp-canvas'), {
        catalog: ACTOR_NODES, get: () => (objById(bpFor) || {}).bp ? objById(bpFor).bp.graph : { nodes: [], links: [] },
        newNode: (t, x, y) => newGraphNode(t, x, y),
        onChange: () => { setDirty(true); renderInspector(); },
        onSelect: (n) => renderBpNodeDetails(n),
      });
      renderBpNodeDetails(null);
    }
    bpGraph.render();
  }
  function renderBpNodeDetails(n) {
    const box = $('#mf-bp-details'); const o = objById(S.selectedId);
    if (!n) { box.innerHTML = '<div class="mf-empty">Right-click the graph (or ＋ Node) to add nodes. Drag a header to move it, drag from an out-pin ● to an in-pin to wire, click a wire to cut it. Select a node to edit its fields here.</div>'; return; }
    const G = ACTOR_NODES[n.type];
    const names = S.map.objects.filter(x => x.n).map(x => x.n);
    const parts = o && o.t === 'prefab' && prefabById(o.pf) ? prefabById(o.pf).objects.map(c => 'self.' + (c.n || c.id)) : [];
    const rows = Object.keys(G.props || {}).map(k => {
      let ctl;
      if (k === 'target') ctl = `<input type="text" data-k="${k}" list="mf-bp-targets" value="${esc(n.props[k])}">`;
      else if (k === 'loop') ctl = `<select data-k="${k}">${LOOP_MODES.map(l => '<option value="' + l + '"' + (n.props[k] === l ? ' selected' : '') + '>' + l + '</option>').join('')}</select>`;
      else if (k === 'what') ctl = `<input type="text" data-k="${k}" list="mf-bp-spawnables" value="${esc(n.props[k])}">`;
      else if (k === 'sound') ctl = `<input type="text" data-k="${k}" list="mf-bp-sounds" value="${esc(n.props[k])}" placeholder="Library → Sounds"><datalist id="mf-bp-sounds">${(S.map.sounds || []).map(x => '<option value="' + esc(x.label) + '">').join('')}</datalist>`;
      else if (k === 'at') ctl = `<input type="text" data-k="${k}" list="mf-bp-at" value="${esc(n.props[k])}"><datalist id="mf-bp-at"><option value="self"><option value="player"><option value="2d"><option value="all">${names.map(x => '<option value="' + esc(x) + '">').join('')}</datalist>`;
      else if (k === 'points') ctl = `<input type="text" data-k="${k}" placeholder="wp1, wp2  or  folder:Route" value="${esc(n.props[k])}" title="Waypoint names: ${esc(S.map.objects.filter(x => x.t === 'waypoint' && x.n).map(x => x.n).join(', ') || 'name some Waypoint markers first')}">`;
      else if (k === 'color') ctl = `<input type="color" data-k="${k}" value="${esc(n.props[k])}">`;
      else if (k === 'message' || k === 'value' || k === 'cond' || k === 'args') ctl = `<textarea data-k="${k}" rows="2">${esc(n.props[k])}</textarea>`;
      else ctl = `<input type="text" data-k="${k}" value="${esc(n.props[k])}">`;
      return `<div class="mf-row"><label>${esc(k)}</label>${ctl}</div>`;
    }).join('');
    box.innerHTML = `<h4><span class="aw-gdot" style="background:${G.color}"></span> ${esc(G.label)}</h4>${G.help ? '<p class="mf-hint" style="margin:0 0 6px">' + esc(G.help) + '</p>' : ''}${rows || '<div class="mf-empty">No fields.</div>'}
      <datalist id="mf-bp-targets"><option value="self"><option value="player">${names.map(x => '<option value="' + esc(x) + '">').join('')}${parts.map(x => '<option value="' + esc(x) + '">').join('')}</datalist>
      <datalist id="mf-bp-spawnables">${(S.map.prefabs || []).map(p => '<option value="' + esc(p.name) + '">').join('')}${PROP_CATALOG.filter(p => !p.marker && !p.slot && !p.prefab).map(p => '<option value="' + p.id + '">').join('')}</datalist>
      <div class="mf-btns" style="margin-top:8px"><button id="mf-bp-ndel" class="danger">✕ Delete node</button></div>
      <p class="mf-hint">Expressions: <code>{$hp} - 1</code>, <code>{dist} < 3</code>, <code>{self.x}</code>, <code>{player.z}</code>, <code>{gems|num}</code> — same language as the widgets.</p>`;
    box.querySelectorAll('[data-k]').forEach(el => { el.onchange = () => { beginObjectEdit(); n.props[el.dataset.k] = el.value; endObjectEdit(); setDirty(true); if (bpGraph) bpGraph.render(); }; el.onkeydown = (e) => e.stopPropagation(); });
    box.querySelector('#mf-bp-ndel').onclick = () => { beginObjectEdit(); bpGraph.deleteSelected(); endObjectEdit(); };
  }
  function notifyGame(kind) {
    try { if (S.map.game) invalidateOverlay(S.map.game); window.dispatchEvent(new CustomEvent('athena:' + kind, { detail: { game: S.map.game || 'sandbox', id: S.map.id, source: S.source, map: clone(S.map) } })); } catch (e) {}   // `map`: adapters that write the scene back into their own format (the battle board) read it here
  }
  function makeObject(p, extra) {
    const isGlb = S.propId === 'glb', isPf = S.propId === 'prefab';
    const o = { id: uid('o_'), t: isGlb ? 'glb' : S.propId, p: [p.x, world.heightAt(p.x, p.z), p.z], r: [0, 0, 0], s: [1, 1, 1], g: true };
    if (isGlb) { o.a = S.assetId; const fit = assetFit.get(S.assetId); if (fit) o.s = [fit, fit, fit]; }
    if (isPf) o.pf = S.prefabId;
    else if (S.propTint && PROP_BY_ID[o.t] && PROP_BY_ID[o.t].tint) o.c = S.propTint;
    if (o.t === 'audio' && S.audioUrl) { o.au = { url: S.audioUrl, vol: 1, r: 20, loop: true }; o.n = (S.audioName || 'Sound').slice(0, 60); }
    if (S.fxPreset && o.t === 'fx_' + S.fxPreset.kind) { if (S.fxPreset.c) o.c = S.fxPreset.c; if (S.fxPreset.fx) o.fx = S.fxPreset.fx; if (S.fxPreset.label) o.n = S.fxPreset.label.slice(0, 60); }
    if (S.folderId && folderById(S.folderId)) o.f = S.folderId;
    Object.assign(o, extra || {});
    return o;
  }
  function placeAt(p, selectIt) {
    if (S.propId === 'glb' && !S.assetId) { toast('Add a model URL in the Library first.'); return; }
    if (S.propId === 'audio' && !S.audioUrl) { toast('Pick an audio file in the Files tab first — the marker plays that file.', 3600); showTab('files'); return; }
    if (S.propId === 'prefab' && !prefabById(S.prefabId)) { toast('Pick a prefab in the Library first.'); return; }
    const o = makeObject(p, S.scatter.jitterRot && S.tool === 'scatter' ? { r: [0, Math.random() * Math.PI * 2, 0] } : null);
    S.map.objects.push(o); world.addObject(o);
    if (selectIt && S.tool === 'select') select(o.id);
    renderStats();
    return o;
  }
  function scatterAt(p) {
    if (S.propId === 'spline') { toast('Splines are drawn with Place (4): click points on the ground.'); stroke.active = false; return; }
    if (S.propId === 'glb' && !S.assetId) { toast('Add a model URL in the Library first.'); stroke.active = false; return; }
    if (S.propId === 'prefab' && !prefabById(S.prefabId)) { toast('Pick a prefab in the Library first.'); stroke.active = false; return; }
    const R = S.brush.radius, half = world.terrain.half;
    for (let i = 0; i < S.scatter.count; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const y = world.heightAt(x, z);
      if (S.scatter.avoidWater && S.map.water.on && y < S.map.water.level) continue;
      const o = makeObject({ x, z }, {});
      o.p = [x, y, z];
      if (S.scatter.jitterRot) o.r = [0, Math.random() * Math.PI * 2, 0];
      if (S.scatter.jitterScale > 0) { const k = 1 + (Math.random() * 2 - 1) * S.scatter.jitterScale; o.s = o.s.map(v => v * k); }
      S.map.objects.push(o); world.addObject(o);
    }
    renderStats();
  }
  function removeObject(id) {
    const i = S.map.objects.findIndex(o => o.id === id); if (i < 0) return;
    S.map.objects.splice(i, 1); world.removeObject(id);
    if (S.selectedId === id) select(null);
    renderStats();
  }
  function select(id, keepMulti) { if (tabOn('scene')) setTimeout(renderSceneTab, 0);
    S.selectedId = id;
    if (!keepMulti) { S.multi.clear(); if (id) S.multi.add(id); }
    setTimeout(drawColliders, 0); renderOutliner(); renderBpPanel();
    if (gizmo) { const r = id ? world.objects.get(id) : null; if (r && S.tool === 'select') { gizmo.attach(r); gizmo.setMode(S.gizmoMode); } else gizmo.detach(); }
    S.splinePt = -1; drawSplineHandles();
    renderInspector();
  }
  ED.drawSplineHandles = () => drawSplineHandles();
  function onGizmoChange() {
    const o = objById(S.selectedId), r = world.objects.get(S.selectedId); if (!o || !r) return;
    if (gizmo.object && gizmo.object.userData.mfSplinePt != null && o.t === 'spline') {
      const h = gizmo.object, i = h.userData.mfSplinePt; if (!o.sp.pts[i]) return;
      if (o.g) h.position.y = world.heightAt(h.position.x, h.position.z);
      o.sp.pts[i] = [h.position.x - o.p[0], h.position.y - o.p[1], h.position.z - o.p[2]];
      world.refreshObject(o); drawSplineHandles(true); setDirty(true); renderInspector(); return;
    }
    if (gizmo.mode === 'translate' && o.g) {
      if (gizmo.axis === 'Y') o.g = false;      // lifting it = they want it off the ground
      else r.position.y = world.heightAt(r.position.x, r.position.z);
    }
    o.p = [r.position.x, r.position.y, r.position.z]; o.r = [r.rotation.x, r.rotation.y, r.rotation.z]; o.s = [r.scale.x, r.scale.y, r.scale.z];
    if (o.t === 'spline') { world.refreshObject(o); drawSplineHandles(true); }   // grounded pieces re-read the terrain under the moved curve
    world.updateCollider(o.id); drawColliders(); drawTriggerRing();
    setDirty(true); renderInspector();
  }
  function regroundAll() {
    S.map.objects.forEach(o => { if (o.g) { o.p[1] = world.heightAt(o.p[0], o.p[2]); const r = world.objects.get(o.id); if (r) r.position.y = o.p[1]; } if (o.t === 'spline' && o.g !== false) world.refreshObject(o); });
    drawSplineHandles(true);
    world.updateAllColliders(); drawColliders();
  }
  function selectedIds() { return S.multi.size > 1 ? Array.from(S.multi).filter(objById) : (S.selectedId && objById(S.selectedId) ? [S.selectedId] : []); }
  function toggleMulti(id) {
    if (S.multi.has(id) && S.multi.size > 1) { S.multi.delete(id); if (S.selectedId === id) S.selectedId = Array.from(S.multi)[0]; }
    else { S.multi.add(id); if (!S.selectedId || !objById(S.selectedId)) S.selectedId = id; }
    if (gizmo) { const r = world.objects.get(S.selectedId); if (r && S.tool === 'select') gizmo.attach(r); }
    setTimeout(drawColliders, 0); renderOutliner(); renderInspector();
  }
  function deleteSelected() { const ids = selectedIds(); if (!ids.length) return; beginObjectEdit(); ids.forEach(removeObject); endObjectEdit(); select(null); }
  function duplicateSelected() {
    const ids = selectedIds(); if (!ids.length) return;
    beginObjectEdit();
    const made = ids.map(id => { const o = objById(id); const c = clone(o); c.id = uid('o_'); c.p[0] += 1.5; c.p[2] += 1.5; if (c.g) c.p[1] = world.heightAt(c.p[0], c.p[2]); S.map.objects.push(c); world.addObject(c); return c.id; });
    select(made[0]); made.forEach(id => S.multi.add(id)); endObjectEdit(); renderStats(); renderInspector();
  }

  /* ═══ SPLINES ═══ — draw a curve on the ground, a mesh follows it (mapforge.spline.js).
     Drawing: Library → Splines picks a preset, every ground click adds a point,
     Enter / double-click / clicking the first point finishes. Editing: a selected
     spline shows gold handles; click one and the gizmo moves that point. Handles
     live in WORLD space (scene root) so the gizmo can drive them directly. */
  function splineSrcFromPick() {
    if (S.propId === 'glb' && S.assetId) return { t: 'glb', a: S.assetId };
    if (S.propId && S.propId !== 'spline' && S.propId !== 'prefab' && PROP_BY_ID[S.propId] && !PROP_BY_ID[S.propId].marker && !PROP_BY_ID[S.propId].fxKind) return Object.assign({ t: S.propId }, S.propTint && PROP_BY_ID[S.propId].tint ? { c: S.propTint } : {});
    return S.lastSrc || null;
  }
  function splineDraftAdd(p) {
    const preset = SPLINE_PRESET_BY_ID[S.splinePreset] || SPLINE_PRESETS[0];
    if (!splineDraft) splineDraft = { preset, pts: [] };
    if (splineDraft.pts.length >= 3) { const f = splineDraft.pts[0]; if (Math.hypot(f[0] - p.x, f[2] - p.z) < Math.max(0.8, S.map.terrain.cell * 0.6)) { splineDraftFinish(true); return; } }   // clicking the first point closes the loop
    splineDraft.pts.push([p.x, world.heightAt(p.x, p.z), p.z]);
    if (splineDraft.pts.length > 200) { splineDraftFinish(false); return; }
    drawSplineDraft(); renderHud();
  }
  function splineDraftCancel() { splineDraft = null; drawSplineDraft(); renderHud(); }
  function splineDraftFinish(closed) {
    const d = splineDraft; splineDraft = null; drawSplineDraft();
    if (!d || d.pts.length < 2) { toast('A spline needs at least two points.'); return null; }
    const pr = d.preset, o0 = d.pts[0];
    const sp = { pts: d.pts.map(q => [q[0] - o0[0], q[1] - o0[1], q[2] - o0[2]]), closed: !!closed, mode: pr.mode, gap: pr.gap, w: pr.w, tension: 0.5 };
    if (pr.mode === 'mesh') { sp.deform = pr.deform !== false; sp.stretch = pr.stretch !== false; }
    if (pr.mode === 'scatter') { sp.jitter = pr.jitter == null ? 0.3 : pr.jitter; sp.align = !!pr.align; sp.seed = (Math.random() * 1e9) | 0; }
    if (pr.mode === 'terrain') { sp.paint = pr.paint; sp.dy = pr.dy || 0; }
    if (pr.mode !== 'terrain') { sp.src = pr.src ? Object.assign({}, pr.src) : (S.lastSrc || { t: 'placeholder' }); if (!pr.src && !S.lastSrc) toast('Custom spline: pick a prop or model in the Library, then "Use library pick" in the inspector.', 4200); }
    const o = { id: uid('o_'), t: 'spline', p: [o0[0], o0[1], o0[2]], r: [0, 0, 0], s: [1, 1, 1], g: true, n: pr.label, sp: normalizeSpline(sp) };   // through the schema: presets omit fields their mode does not use
    if (S.folderId && folderById(S.folderId)) o.f = S.folderId;
    beginObjectEdit(); S.map.objects.push(o); world.addObject(o); endObjectEdit();
    setTool('select'); select(o.id); renderStats();
    toast(pr.label + ' — ' + sp.pts.length + ' points. Drag the gold handles to reshape it.', 3000);
    return o;
  }
  function splineLineGeo(ptsWorld, closed) {
    const c = sampleSpline(ptsWorld, closed, 0.5, 0.5);
    const arr = new Float32Array(c.pts.length * 3);
    c.pts.forEach((q, i) => { arr[i * 3] = q.x; arr[i * 3 + 1] = world.heightAt(q.x, q.z) + 0.15; arr[i * 3 + 2] = q.z; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return g;
  }
  function clearSplineUi(keepHandles) {
    if (splineH.line) { splineG.remove(splineH.line); splineH.line.geometry.dispose(); splineH.line = null; }
    if (!keepHandles) { splineH.handles.forEach(h => splineG.remove(h)); splineH.handles = []; }
  }
  function drawSplineDraft() {
    if (splineH.draft) { splineG.remove(splineH.draft); splineH.draft.traverse(m => { if (m.geometry) m.geometry.dispose(); }); splineH.draft = null; }
    if (!splineDraft || !splineDraft.pts.length) return;
    const g = new THREE.Group();
    splineDraft.pts.forEach((q, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 0.45 : 0.3, 10, 8), handleMat(i === 0 ? 0x5fd38a : 0xd4af37)); m.renderOrder = 21; m.position.set(q[0], q[1] + 0.2, q[2]); g.add(m); });
    if (splineDraft.pts.length > 1) { const ln = new THREE.Line(splineLineGeo(splineDraft.pts, false), new THREE.LineBasicMaterial({ color: 0xffe9a8, depthTest: false, transparent: true, opacity: 0.95 })); ln.renderOrder = 20; g.add(ln); }
    splineH.draft = g; splineG.add(g);
  }
  const handleMats = {}; function handleMat(c) { return handleMats[c] || (handleMats[c] = new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 })); }
  function drawSplineHandles(reposition) {
    const o = objById(S.selectedId);
    const show = !!o && o.t === 'spline' && !S.playing && S.tool === 'select';
    if (!show) { clearSplineUi(false); return; }
    const wp = o.sp.pts.map(q => [q[0] + o.p[0], q[1] + o.p[1], q[2] + o.p[2]]);
    if (!reposition || splineH.handles.length !== wp.length) {
      clearSplineUi(false);
      wp.forEach((q, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), handleMat(0xd4af37)); m.userData.mfSplinePt = i; m.renderOrder = 21; splineG.add(m); splineH.handles.push(m); });
    } else clearSplineUi(true);
    splineH.handles.forEach((m, i) => { const q = wp[i]; m.position.set(q[0], o.g ? world.heightAt(q[0], q[2]) : q[1], q[2]); m.material = handleMat(i === S.splinePt ? 0x4aa3ff : i === 0 ? 0x5fd38a : 0xd4af37); });
    splineH.line = new THREE.Line(splineLineGeo(wp, o.sp.closed), new THREE.LineBasicMaterial({ color: 0xffe9a8, depthTest: false, transparent: true, opacity: 0.8 })); splineH.line.renderOrder = 20; splineG.add(splineH.line);
  }
  function splineCommit(o, fn) { beginObjectEdit(); fn(); world.refreshObject(o); endObjectEdit(); setDirty(true); drawSplineHandles(true); renderInspector(); }
  function splineInsertPoint(o) {
    const n = o.sp.pts.length, i = S.splinePt >= 0 ? S.splinePt : n - 1, a = o.sp.pts[i], b = o.sp.pts[(i + 1) % n];
    let q;
    if (i < n - 1 || o.sp.closed) q = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    else { const pr = o.sp.pts[i - 1] || [a[0] - 3, a[1], a[2]]; const dx = a[0] - pr[0], dz = a[2] - pr[2], L = Math.hypot(dx, dz) || 1; q = [a[0] + dx / L * 3, a[1], a[2] + dz / L * 3]; }
    if (o.g) q[1] = world.heightAt(q[0] + o.p[0], q[2] + o.p[2]) - o.p[1];
    splineCommit(o, () => { o.sp.pts.splice(i + 1, 0, q); }); S.splinePt = i + 1; drawSplineHandles(true);
    if (gizmo && splineH.handles[S.splinePt]) gizmo.attach(splineH.handles[S.splinePt]);
    renderInspector();
  }
  function splineDeletePoint() {
    const o = objById(S.selectedId); if (!o || o.t !== 'spline' || S.splinePt < 0) return;
    if (o.sp.pts.length <= 2) { toast('A spline keeps at least two points — delete the object instead.'); return; }
    const i = S.splinePt; S.splinePt = -1; if (gizmo) gizmo.attach(world.objects.get(o.id));
    splineCommit(o, () => { o.sp.pts.splice(i, 1); });
  }
  function splineApplyTerrain(o) {
    const before = world.terrain.snapshot();
    const n = applySplineToTerrain(world.terrain, o);
    if (!n) return;
    pushUndo({ type: 'terrain', before, after: world.terrain.snapshot() });
    regroundAll(); setDirty(true); world.navInvalidate(); drawNav(); renderTerrainTab();
    toast('Terrain shaped under the spline (undo with Ctrl+Z).', 2600);
  }
  function renderSplineSection(o) {
    const sp = o.sp; const lbl = (src) => src ? (src.t === 'glb' ? ((S.map.assets.find(a => a.id === src.a) || {}).label || 'model') : ((PROP_BY_ID[src.t] || {}).label || src.t)) : '—';
    const pick = splineSrcFromPick();
    const opt = (v, cur, lb) => '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(lb == null ? v : lb) + '</option>';
    return `<div class="mf-spline"><div class="mf-row" style="margin-bottom:5px"><label>Spline</label><span class="st">〰️ ${sp.pts.length} points · ${sp.closed ? 'loop' : 'open'}</span></div>
      <div class="mf-row"><label>Mode</label><select id="mf-sp-mode">${SPLINE_MODES.map(m => opt(m, sp.mode, { mesh: 'Mesh — repeat & bend', scatter: 'Scatter — drop along', terrain: 'Terrain — shape the ground' }[m])).join('')}</select></div>
      ${sp.mode !== 'terrain' ? `<div class="mf-row"><label>Source</label><div style="flex:1;color:#cfc7ad;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lbl(sp.src))}</div>${pick ? '<button id="mf-sp-usepick" title="Use what the Library has picked">⇄ ' + esc(lbl(pick)) + '</button>' : ''}</div>` : ''}
      <div class="mf-row"><label>${sp.mode === 'mesh' ? 'Piece length' : sp.mode === 'scatter' ? 'Spacing' : 'Sample'}</label><input type="range" id="mf-sp-gap" min="0.2" max="30" step="0.1" value="${sp.gap}"><span class="v" id="mf-sp-gap-v">${sp.gap.toFixed(1)}m</span></div>
      <div class="mf-row"><label>Width</label><input type="range" id="mf-sp-w" min="0" max="20" step="0.1" value="${sp.w}"><span class="v" id="mf-sp-w-v">${sp.w.toFixed(1)}m</span></div>
      ${sp.mode === 'mesh' ? `<div class="mf-row"><label>Bend</label><input type="checkbox" id="mf-sp-deform" ${sp.deform ? 'checked' : ''}><span class="mf-hint" style="margin:0">deform the mesh along the curve (off = rigid pieces)</span></div>
        <div class="mf-row"><label>Stretch</label><input type="checkbox" id="mf-sp-stretch" ${sp.stretch ? 'checked' : ''}><span class="mf-hint" style="margin:0">fit a whole number of pieces exactly</span></div>
        <div class="mf-row"><label>Forward</label><select id="mf-sp-axis">${opt('', sp.axis || '', 'auto (longer side)')}${opt('x', sp.axis || '', 'X')}${opt('z', sp.axis || '', 'Z')}</select></div>` : ''}
      ${sp.mode === 'scatter' ? `<div class="mf-row"><label>Jitter</label><input type="range" id="mf-sp-jitter" min="0" max="1" step="0.05" value="${sp.jitter}"><span class="v" id="mf-sp-jitter-v">${Math.round(sp.jitter * 100)}%</span></div>
        <div class="mf-row"><label>Align</label><input type="checkbox" id="mf-sp-align" ${sp.align ? 'checked' : ''}><span class="mf-hint" style="margin:0">face along the curve (off = random yaw)</span></div>
        <div class="mf-row"><label>Seed</label><button id="mf-sp-reseed" style="flex:1">🎲 Reshuffle</button></div>` : ''}
      ${sp.mode === 'terrain' ? `<div class="mf-row"><label>Paint</label><select id="mf-sp-paint">${PAINT.map((p, i) => opt(i, sp.paint, p.label)).join('')}</select></div>
        <div class="mf-row"><label>Depth</label><input type="range" id="mf-sp-dy" min="-6" max="6" step="0.1" value="${sp.dy}"><span class="v" id="mf-sp-dy-v">${sp.dy >= 0 ? '+' : ''}${sp.dy.toFixed(1)}m</span></div>` : ''}
      <div class="mf-row"><label>Tension</label><input type="range" id="mf-sp-tension" min="0" max="1" step="0.05" value="${sp.tension}"><span class="v" id="mf-sp-tension-v">${sp.tension.toFixed(2)}</span></div>
      <div class="mf-row"><label>Loop</label><input type="checkbox" id="mf-sp-closed" ${sp.closed ? 'checked' : ''}><span class="mf-hint" style="margin:0">join the last point to the first</span></div>
      <div class="mf-btns"><button id="mf-sp-add">＋ Add point${S.splinePt >= 0 ? ' after #' + (S.splinePt + 1) : ''}</button>${S.splinePt >= 0 ? '<button id="mf-sp-del" class="danger">－ Delete point #' + (S.splinePt + 1) + '</button>' : ''}<button id="mf-sp-terrain" class="${sp.mode === 'terrain' ? 'primary' : ''}">⛰ Apply to terrain</button></div>
      <p class="mf-hint" style="margin:6px 0 0">Click a gold handle and drag the gizmo to reshape. ${sp.mode === 'terrain' ? 'Apply flattens the ground to the curve and paints the layer under it — an ordinary terrain edit, undoable.' : 'Apply flattens the ground under the curve so the pieces sit in it, not on it.'} Splines never collide.</p></div>`;
  }
  function wireSplineSection(box, o) {
    const sp = o.sp; const q = (id) => box.querySelector('#' + id);
    const live = (id, fn, fmt) => { const el = q(id); if (!el) return; el.oninput = () => { fn(parseFloat(el.value)); world.refreshObject(o); drawSplineHandles(true); const v = q(id + '-v'); if (v && fmt) v.textContent = fmt(parseFloat(el.value)); }; el.onpointerdown = () => beginObjectEdit(); el.onchange = () => { endObjectEdit(); setDirty(true); }; };
    const mode = q('mf-sp-mode'); if (mode) mode.onchange = () => splineCommit(o, () => { const m = mode.value; sp.mode = m; if (m === 'mesh') { if (sp.deform == null) sp.deform = true; if (sp.stretch == null) sp.stretch = true; } if (m === 'scatter') { if (sp.jitter == null) sp.jitter = 0.3; if (sp.align == null) sp.align = false; if (sp.seed == null) sp.seed = (Math.random() * 1e9) | 0; } if (m !== 'terrain' && !sp.src) sp.src = splineSrcFromPick() || { t: 'placeholder' }; if (m === 'terrain') { if (sp.paint == null) sp.paint = 2; if (sp.dy == null) sp.dy = 0; } });
    const up = q('mf-sp-usepick'); if (up) up.onclick = () => splineCommit(o, () => { const src = splineSrcFromPick(); if (src) sp.src = src; });
    live('mf-sp-gap', v => { sp.gap = v; }, v => v.toFixed(1) + 'm'); live('mf-sp-w', v => { sp.w = v; }, v => v.toFixed(1) + 'm');
    live('mf-sp-jitter', v => { sp.jitter = v; }, v => Math.round(v * 100) + '%'); live('mf-sp-dy', v => { sp.dy = v; }, v => (v >= 0 ? '+' : '') + v.toFixed(1) + 'm'); live('mf-sp-tension', v => { sp.tension = v; }, v => v.toFixed(2));
    const cb = (id, fn) => { const el = q(id); if (el) el.onchange = () => splineCommit(o, () => fn(el.checked)); };
    cb('mf-sp-deform', v => { sp.deform = v; }); cb('mf-sp-stretch', v => { sp.stretch = v; }); cb('mf-sp-align', v => { sp.align = v; }); cb('mf-sp-closed', v => { sp.closed = v; });
    const ax = q('mf-sp-axis'); if (ax) ax.onchange = () => splineCommit(o, () => { if (ax.value) sp.axis = ax.value; else delete sp.axis; });
    const pt = q('mf-sp-paint'); if (pt) pt.onchange = () => splineCommit(o, () => { sp.paint = +pt.value; });
    const rs = q('mf-sp-reseed'); if (rs) rs.onclick = () => splineCommit(o, () => { sp.seed = (Math.random() * 1e9) | 0; });
    const ad = q('mf-sp-add'); if (ad) ad.onclick = () => splineInsertPoint(o);
    const dl = q('mf-sp-del'); if (dl) dl.onclick = splineDeletePoint;
    const tr = q('mf-sp-terrain'); if (tr) tr.onclick = () => splineApplyTerrain(o);
  }
  ED.spline = { get draft() { return splineDraft; }, add: splineDraftAdd, finish: splineDraftFinish, cancel: splineDraftCancel, insert: () => { const o = objById(S.selectedId); if (o && o.t === 'spline') splineInsertPoint(o); }, deletePoint: splineDeletePoint, applyTerrain: () => { const o = objById(S.selectedId); if (o && o.t === 'spline') splineApplyTerrain(o); }, handles: () => splineH.handles, srcFromPick: splineSrcFromPick };

  /* ═══ CLOUD FILES + RENAME + CONTENT BROWSER (round 17) ═══
     Cloud files are the game's `models` bucket through MythicBridge.files
     (upload / list / rename / remove — admin-only writes): one URL every
     player loads, unlike a .glb embedded in the map. Rename covers every
     library item that has a name of its own: map models and sounds
     (labels), prefabs, cloud files (a storage move — references in the map
     are rewritten to the new URL). The content browser is Unreal's: a dock
     over the bottom of the viewport with a folder tree, breadcrumb, search,
     tile size, tiles with type bars, a context menu — the same index, cards
     and picks as the sidebar Library. */
  let cloudFiles = null, cloudSounds = null, cloudLoading = null;
  function filesApi() { const b = bridge(); return b && b.files ? b.files : null; }
  function cloudReady() { try { const f = filesApi(); return !!(f && f.ready()); } catch (e) { return false; } }
  function cloudCanWrite() { try { const f = filesApi(); return !!(f && f.canWrite && f.canWrite()); } catch (e) { return false; } }
  async function loadCloud(force) {
    const f = filesApi(); if (!f || !cloudReady()) { cloudFiles = cloudFiles || []; cloudSounds = cloudSounds || []; return; }
    if (cloudLoading && !force) return cloudLoading;
    cloudLoading = (async () => { try { const [m, a] = await Promise.all([f.list('models'), f.list('audio')]); cloudFiles = m || []; cloudSounds = a || []; } catch (e) { cloudFiles = cloudFiles || []; cloudSounds = cloudSounds || []; } finally { cloudLoading = null; } if (root.isConnected) { renderLibrary(); renderContentBrowser(); } })();
    return cloudLoading;
  }
  async function uploadToCloud(file, kind) {
    const f = filesApi(); if (!f) { toast('Cloud files need the game (no bridge here).'); return null; }
    if (!cloudReady()) { toast('Sign in to upload shared files.'); return null; }
    if (!cloudCanWrite()) { toast('Uploading shared files is admin-only.'); return null; }
    kind = kind || (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name) ? 'audio' : 'models');
    toast('☁ Uploading ' + file.name + '…', 4000);
    try {
      const r = await f.upload(file, kind);
      await loadCloud(true);
      if (kind === 'audio') addSound(r.url, r.name.replace(/\.[a-z0-9]+$/i, '')); else { await addAsset(r.url, r.name.replace(/\.(glb|gltf)$/i, '')); wantPlace(); }
      toast('☁ ' + r.name + ' is in the cloud — every player loads it from there.', 3600);
      return r;
    } catch (e) { toast('Upload failed: ' + ((e && e.message) || e), 5000); return null; }
  }
  function rewriteUrl(oldUrl, newUrl) {
    let n = 0;
    (S.map.assets || []).forEach(a => { if (a.url === oldUrl) { a.url = newUrl; n++; } });
    (S.map.sounds || []).forEach(s => { if (s.url === oldUrl) { s.url = newUrl; n++; } });
    return n;
  }
  /* Rename whatever the library entry is. Returns true when something changed. */
  async function renameEntry(e, name) {
    if (!e) return false;
    const cur = e.kind === 'prefab' || e.kind === 'shelf' ? e.ref.name : e.kind === 'cloud' || e.kind === 'csound' ? e.ref.name : e.label;
    if (name == null) { name = window.prompt('Rename “' + cur + '” to:', cur); if (name == null) return false; }
    name = String(name).trim().slice(0, 60); if (!name || name === cur) return false;
    if (e.kind === 'model') { beginObjectEdit(); e.ref.label = name; endObjectEdit(); setDirty(true); }
    else if (e.kind === 'sound') { beginObjectEdit(); e.ref.label = name; endObjectEdit(); setDirty(true); }
    else if (e.kind === 'prefab') { renamePrefab(e.id, name); }
    else if (e.kind === 'shelf') { const list = shelfList(); const it = list.find(x => x.id === e.id); if (it) { it.name = name; shelfWrite(list); } }
    else if (e.kind === 'cloud' || e.kind === 'csound') {
      const f = filesApi(); if (!f || !cloudCanWrite()) { toast('Renaming shared files is admin-only.'); return false; }
      const ext = (/\.[a-z0-9]+$/i.exec(e.ref.name) || [''])[0]; const withExt = /\.[a-z0-9]+$/i.test(name) ? name : name + ext;
      try { const r = await f.rename(e.ref.path, withExt); const n = rewriteUrl(e.ref.url, r.url); if (n) { beginObjectEdit(); endObjectEdit(); setDirty(true); (S.map.assets || []).forEach(a => { if (a.url === r.url) a.label = name; }); (S.map.sounds || []).forEach(s => { if (s.url === r.url) s.label = name; }); } await loadCloud(true); libSel = e.kind + ':' + r.path; }
      catch (x) { toast('Rename failed: ' + ((x && x.message) || x), 4000); return false; }
    }
    else { toast('Built-in props keep their names — rename the placed object in the inspector instead.'); return false; }
    renderLibrary(); renderContentBrowser(); renderOutliner(); renderInspector();
    return true;
  }
  async function removeCloudFile(e) {
    const f = filesApi(); if (!f || !cloudCanWrite()) { toast('Deleting shared files is admin-only.'); return; }
    const used = (S.map.assets || []).filter(a => a.url === e.ref.url).length + (S.map.sounds || []).filter(s => s.url === e.ref.url).length;
    if (!(await askConfirm('Delete “' + e.ref.name + '” from the cloud for everyone?' + (used ? ' This map still references it (' + used + ').' : '')))) return;
    try { await f.remove(e.ref.path); prefs.forget(e.key); if (libSel === e.key) libSel = null; await loadCloud(true); toast('Deleted from the cloud.'); } catch (x) { toast('Delete failed: ' + ((x && x.message) || x), 4000); }
  }

  /* ── the dock ── */
  const CB = { open: false, path: ['Content'], q: '', size: 96, sel: null, menu: null };
  const CB_TREE = [
    { id: 'Content', label: 'Content', icon: '📁', children: [
      { id: 'Content/Props', label: 'Props', icon: '📁', children: ['Nature', 'Structures', 'Props', 'Ruins', 'VFX', 'Markers'].map(c => ({ id: 'Content/Props/' + c, label: c, icon: '📁', filter: { kind: 'prop', cat: c } })), filter: { kind: 'prop' } },
      { id: 'Content/Splines', label: 'Splines', icon: '📁', filter: { kind: 'spline' } },
      { id: 'Content/Models', label: 'Models', icon: '📁', filter: { kind: ['model', 'project', 'cloud'] }, children: [
        { id: 'Content/Models/In map', label: 'In this map', icon: '📁', filter: { kind: 'model' } }, { id: 'Content/Models/Project', label: 'Project', icon: '📁', filter: { kind: 'project' } }, { id: 'Content/Models/Cloud', label: 'Cloud', icon: '☁', filter: { kind: 'cloud' } } ] },
      { id: 'Content/Prefabs', label: 'Prefabs', icon: '📁', filter: { kind: ['prefab', 'shelf'] }, children: [
        { id: 'Content/Prefabs/In map', label: 'In this map', icon: '📁', filter: { kind: 'prefab' } }, { id: 'Content/Prefabs/Shelf', label: 'Shelf', icon: '📚', filter: { kind: 'shelf' } } ] },
      { id: 'Content/Sounds', label: 'Sounds', icon: '📁', filter: { kind: ['sound', 'psound', 'csound'] }, children: [
        { id: 'Content/Sounds/In map', label: 'In this map', icon: '📁', filter: { kind: 'sound' } }, { id: 'Content/Sounds/Project', label: 'Project', icon: '📁', filter: { kind: 'psound' } }, { id: 'Content/Sounds/Cloud', label: 'Cloud', icon: '☁', filter: { kind: 'csound' } } ] },
    ] },
    { id: 'Favourites', label: 'Favourites', icon: '★', filter: { fav: true } },
    { id: 'Recent', label: 'Recent', icon: '🕘', filter: { recent: true } },
  ];
  function cbNode(id) { let found = null; const walk = (n) => { if (n.id === id) found = n; (n.children || []).forEach(walk); }; CB_TREE.forEach(walk); return found; }
  const KIND_BAR = { prop: '#4fb3d9', spline: '#6fd3a1', model: '#5aa5ff', project: '#5aa5ff', cloud: '#5aa5ff', prefab: '#b07cff', shelf: '#b07cff', sound: '#ff9f43', psound: '#ff9f43', csound: '#ff9f43' };
  function toggleContentBrowser(on) { CB.open = on == null ? !CB.open : !!on; const d = $('#mf-cb'); if (d) d.hidden = !CB.open; const b = $('#mf-cb-btn'); if (b) b.classList.toggle('on', CB.open); if (CB.open) renderContentBrowser(); }
  function renderContentBrowser() {
    const d = $('#mf-cb'); if (!d || !CB.open) return;
    rebuildIndex();
    const node = cbNode(CB.path.join('/')) || CB_TREE[0];
    const f = Object.assign({}, node.filter || {}); let hits;
    if (f.fav) hits = assetsMod.search(libIndex, CB.q, { fav: prefs.favs });
    else if (f.recent) hits = prefs.recent.map(entryByKey).filter(Boolean).filter(e => !CB.q || assetsMod.search([e], CB.q, {}).length);
    else hits = assetsMod.search(libIndex, CB.q, f);
    // tree
    const treeHtml = (n, depth) => { const on = CB.path.join('/') === n.id, inPath = CB.path.join('/').startsWith(n.id); return '<div class="mf-cb-node ' + (on ? 'on' : '') + '" data-node="' + esc(n.id) + '" style="padding-left:' + (8 + depth * 14) + 'px">' + (n.children ? '<span class="tw">' + (inPath ? '▾' : '▸') + '</span>' : '<span class="tw"></span>') + '<span class="ic">' + n.icon + '</span>' + esc(n.label) + '</div>' + ((n.children && inPath) ? n.children.map(c => treeHtml(c, depth + 1)).join('') : ''); };
    d.querySelector('.mf-cb-tree').innerHTML = CB_TREE.map(n => treeHtml(n, 0)).join('');
    d.querySelectorAll('.mf-cb-node').forEach(el => el.onclick = () => { CB.path = el.dataset.node.split('/'); CB.sel = null; renderContentBrowser(); });
    // crumbs
    d.querySelector('.mf-cb-crumbs').innerHTML = CB.path.map((p, i) => '<span class="crumb" data-i="' + i + '">' + esc(p) + '</span>').join('<span class="sep">›</span>');
    d.querySelectorAll('.mf-cb-crumbs .crumb').forEach(el => el.onclick = () => { CB.path = CB.path.slice(0, +el.dataset.i + 1); renderContentBrowser(); });
    // tiles
    const grid = d.querySelector('.mf-cb-grid'); grid.style.setProperty('--tile', CB.size + 'px');
    const folders = (node.children || []).map(c => '<div class="mf-cb-tile folder" data-folder="' + esc(c.id) + '"><div class="th"><span class="ic">' + c.icon + '</span></div><div class="nm">' + esc(c.label) + '</div></div>').join('');
    grid.innerHTML = folders + hits.slice(0, 300).map(e => { const t = thumbOf(e); const picked = isPicked(e); return '<div class="mf-cb-tile ' + (CB.sel === e.key ? 'sel ' : '') + (picked ? 'on' : '') + '" data-key="' + esc(e.key) + '" title="' + esc(e.label + ' · ' + assetsMod.KINDS[e.kind].label + ' · ' + assetsMod.KINDS[e.kind].source) + '"><div class="th">' + (t.img ? '<img src="' + t.img + '" alt="">' : '<span class="ic">' + e.icon + '</span>') + '<span class="fav ' + (prefs.isFav(e.key) ? 'on' : '') + '" data-fav="' + esc(e.key) + '">★</span></div><div class="bar" style="background:' + (KIND_BAR[e.kind] || '#888') + '"></div><div class="nm">' + esc(e.label) + '</div><div class="kd">' + esc(assetsMod.KINDS[e.kind].label) + (e.inMap ? ' · in map' : '') + '</div></div>'; }).join('') || '<div class="mf-cb-empty">' + (CB.q ? 'Nothing matches “' + esc(CB.q) + '”.' : 'Empty folder.') + '</div>';
    grid.querySelectorAll('.mf-cb-tile.folder').forEach(el => el.ondblclick = el.onclick = () => { CB.path = el.dataset.folder.split('/'); renderContentBrowser(); });
    grid.querySelectorAll('.mf-cb-tile[data-key]').forEach(el => {
      el.onclick = (ev) => { if (ev.target.dataset.fav) { prefs.toggleFav(el.dataset.key); renderContentBrowser(); renderLibrary(); return; } CB.sel = el.dataset.key; libSel = el.dataset.key; renderContentBrowser(); renderDetails(); };
      el.ondblclick = () => { pickEntry(entryByKey(el.dataset.key)); renderContentBrowser(); };
      el.oncontextmenu = (ev) => { ev.preventDefault(); CB.sel = el.dataset.key; libSel = el.dataset.key; renderContentBrowser(); cbMenu(ev.clientX, ev.clientY, entryByKey(el.dataset.key)); };
    });
    d.querySelector('.mf-cb-status').textContent = hits.length + ' item' + (hits.length === 1 ? '' : 's') + (CB.sel ? ' · 1 selected' : '') + (cloudReady() ? '' : ' · cloud offline');
    const q = d.querySelector('#mf-cb-q'); if (q && q.value !== CB.q) q.value = CB.q;
    const add = d.querySelector('#mf-cb-addcloud'); if (add) add.disabled = !cloudReady();
  }
  function cbMenu(x, y, e) {
    cbCloseMenu(); if (!e) return;
    const items = [];
    if (['prop', 'model', 'project', 'cloud', 'prefab', 'shelf', 'spline'].includes(e.kind)) items.push(['place', '🎯 Place / pick']);
    if (['sound', 'psound', 'csound'].includes(e.kind)) items.push(['play', '▶ Preview'], ['add', '＋ Add to map']);
    if (['model', 'sound', 'prefab', 'shelf', 'cloud', 'csound'].includes(e.kind)) items.push(['rename', '✎ Rename (F2)']);
    items.push(['fav', prefs.isFav(e.key) ? '☆ Unfavourite' : '★ Favourite']);
    if (e.url) items.push(['copy', '⧉ Copy URL']);
    if (e.kind === 'model') items.push(['remove', '✕ Remove from map']);
    if (e.kind === 'prefab') items.push(['remove', '✕ Delete prefab']);
    if (e.kind === 'sound') items.push(['remove', '✕ Remove from map']);
    if (e.kind === 'cloud' || e.kind === 'csound') items.push(['remove', '✕ Delete from cloud']);
    const m = document.createElement('div'); m.className = 'mf-cb-menu'; m.style.left = Math.min(x, window.innerWidth - 200) + 'px'; m.style.top = Math.min(y, window.innerHeight - items.length * 28 - 10) + 'px';
    m.innerHTML = '<div class="hd">' + esc(e.label) + '</div>' + items.map(([a, l]) => '<button data-a="' + a + '">' + l + '</button>').join('');
    document.body.appendChild(m); CB.menu = m;
    m.querySelectorAll('button').forEach(b => b.onclick = async () => {
      const a = b.dataset.a; cbCloseMenu();
      if (a === 'place' || a === 'add') pickEntry(e);
      else if (a === 'play') previewSound(e.url);
      else if (a === 'rename') renameEntry(e);
      else if (a === 'fav') { prefs.toggleFav(e.key); renderContentBrowser(); renderLibrary(); }
      else if (a === 'copy') { try { await navigator.clipboard.writeText(e.url); toast('URL copied.'); } catch (x) { window.prompt('URL:', e.url); } }
      else if (a === 'remove') {
        if (e.kind === 'model') removeAsset(e.id);
        else if (e.kind === 'prefab') { if (await askConfirm('Delete this prefab and every placed instance?')) deletePrefab(e.id); }
        else if (e.kind === 'sound') { beginObjectEdit(); S.map.sounds = S.map.sounds.filter(y => y.id !== e.id); endObjectEdit(); setDirty(true); renderLibrary(); }
        else removeCloudFile(e);
        renderContentBrowser();
      }
    });
    setTimeout(() => document.addEventListener('pointerdown', cbCloseMenu, { once: true, capture: true }), 0);
  }
  function cbCloseMenu() { if (CB.menu) { CB.menu.remove(); CB.menu = null; } }
  function wireContentBrowser() {
    const d = $('#mf-cb'); if (!d) return;
    d.querySelector('#mf-cb-q').oninput = (e) => { CB.q = e.target.value; renderContentBrowser(); };
    d.querySelector('#mf-cb-q').onkeydown = (e) => { if (e.key === 'Escape') { CB.q = ''; renderContentBrowser(); e.target.blur(); } e.stopPropagation(); };
    d.querySelector('#mf-cb-size').oninput = (e) => { CB.size = +e.target.value; d.querySelector('.mf-cb-grid').style.setProperty('--tile', CB.size + 'px'); };
    d.querySelector('#mf-cb-close').onclick = () => toggleContentBrowser(false);
    d.querySelector('#mf-cb-addcloud').onclick = () => d.querySelector('#mf-cb-cloudfile').click();
    d.querySelector('#mf-cb-cloudfile').onchange = (e) => { Array.from(e.target.files || []).forEach(f => uploadToCloud(f)); e.target.value = ''; };
    d.querySelector('#mf-cb-embed').onclick = () => $('#mf-glb-file').click();
    d.querySelector('#mf-cb-url').onclick = () => { const u = window.prompt('Model or sound URL (https://… or /models/…):'); if (!u) return; if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(u)) addSound(u); else addAsset(u); renderContentBrowser(); };
    d.querySelector('#mf-cb-refresh').onclick = () => loadCloud(true);
    $('#mf-cb-btn').onclick = () => toggleContentBrowser();
  }
  ED.content = { toggle: toggleContentBrowser, get state() { return CB; }, render: renderContentBrowser, rename: (key, name) => renameEntry(entryByKey(key), name), upload: uploadToCloud, cloud: () => ({ models: cloudFiles || [], sounds: cloudSounds || [] }), reloadCloud: () => loadCloud(true), menu: (key) => cbMenu(20, 20, entryByKey(key)) };

  /* ═══ PREFABS ═══ — Unity's prefab: a definition, many instances, edit one → all follow. */
  const SHELF_KEY = 'mf_prefabs_v1';
  function prefabById(id) { return (S.map.prefabs || []).find(p => p.id === id) || null; }
  function shelfList() { try { const x = JSON.parse(localStorage.getItem(SHELF_KEY) || '[]'); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  function shelfWrite(list) { try { localStorage.setItem(SHELF_KEY, JSON.stringify(list.slice(0, 100))); } catch (e) { toast('Could not save to the prefab shelf (storage full?).'); } }
  /* Children become relative to the group's footprint: XZ centroid, lowest Y. */
  function createPrefab(ids, name, pfId) {
    const objs = ids.map(objById).filter(o => o && o.t !== 'prefab' && o.t !== 'slot');
    if (!objs.length) { toast('Select some objects first (prefab instances and game slots cannot be nested).'); return null; }
    const cx = objs.reduce((a, o) => a + o.p[0], 0) / objs.length, cz = objs.reduce((a, o) => a + o.p[2], 0) / objs.length, by = Math.min.apply(null, objs.map(o => o.p[1]));
    const def = { id: pfId || uid('pf_'), name: (name || 'Prefab ' + ((S.map.prefabs || []).length + 1)).slice(0, 60), icon: '🧱', objects: objs.map(o => { const c = clone(o); c.id = c.id.replace(/^o_/, 'c_'); c.p = [o.p[0] - cx, o.p[1] - by, o.p[2] - cz]; delete c.f; delete c.k; c.g = false; return c; }) };
    const folder = objs[0].f;
    beginObjectEdit();
    if (pfId) { const i = S.map.prefabs.findIndex(p => p.id === pfId); if (i >= 0) S.map.prefabs[i] = def; else S.map.prefabs.push(def); } else S.map.prefabs.push(def);
    objs.forEach(o => removeObject(o.id));
    const inst = { id: uid('o_'), t: 'prefab', pf: def.id, p: [cx, by, cz], r: [0, 0, 0], s: [1, 1, 1], g: objs.every(o => o.g !== false), n: def.name };
    if (folder) inst.f = folder;
    S.map.objects.push(inst); world.addObject(inst);
    // every other instance of a re-applied definition is rebuilt
    if (pfId) S.map.objects.filter(o => o.t === 'prefab' && o.pf === pfId && o.id !== inst.id).forEach(o => world.addObject(o));
    endObjectEdit(); setDirty(true); renderStats(); renderLibrary(); select(inst.id);
    return def;
  }
  /* Unpack: children get world transforms (yaw + uniform-ish scale composed) and the instance goes. */
  function unpackPrefab(instId, keepLink) {
    const inst = objById(instId), def = inst && prefabById(inst.pf); if (!def) return [];
    const yaw = inst.r[1], cs = Math.cos(yaw), sn = Math.sin(yaw);
    beginObjectEdit();
    const ids = def.objects.map(c => {
      const o = clone(c); o.id = uid('o_');
      const x = c.p[0] * inst.s[0], z = c.p[2] * inst.s[2];
      o.p = [inst.p[0] + x * cs + z * sn, inst.p[1] + c.p[1] * inst.s[1], inst.p[2] - x * sn + z * cs];
      o.r = [c.r[0], c.r[1] + yaw, c.r[2]]; o.s = [c.s[0] * inst.s[0], c.s[1] * inst.s[1], c.s[2] * inst.s[2]];
      if (inst.f) o.f = inst.f;
      S.map.objects.push(o); world.addObject(o); return o.id;
    });
    removeObject(instId);
    endObjectEdit(); setDirty(true); renderStats();
    S.editingPrefab = keepLink ? { pf: def.id, ids, name: def.name } : null;
    select(ids[0]); ids.forEach(id => S.multi.add(id)); renderInspector(); renderOutliner();
    if (keepLink) toast('Editing "' + def.name + '" — change the pieces, then ⤴ Apply to prefab. Every instance follows.', 5200);
    return ids;
  }
  function applyPrefab() {
    const ed = S.editingPrefab; if (!ed) return;
    const ids = ed.ids.filter(objById);
    S.editingPrefab = null;
    if (!ids.length) { toast('Nothing left of the prefab to apply.'); renderInspector(); return; }
    invalidatePrefabThumb(ed.pf);   // parts moved — the picture is stale even when the part count is not
    createPrefab(ids, ed.name, ed.pf);
    toast('Applied — ' + S.map.objects.filter(o => o.t === 'prefab' && o.pf === ed.pf).length + ' instance(s) updated.');
  }
  function renamePrefab(id, name) { const d = prefabById(id); if (!d) return; name = String(name || '').trim().slice(0, 60); if (!name) return; beginObjectEdit(); d.name = name; endObjectEdit(); setDirty(true); renderLibrary(); renderInspector(); }
  function deletePrefab(id) {
    const d = prefabById(id); if (!d) return;
    const inst = S.map.objects.filter(o => o.t === 'prefab' && o.pf === id);
    beginObjectEdit(); inst.forEach(o => removeObject(o.id)); S.map.prefabs = S.map.prefabs.filter(p => p.id !== id); endObjectEdit(); setDirty(true); renderLibrary(); renderStats();
    if (S.propId === 'prefab' && S.prefabId === id) { S.propId = 'tree'; S.prefabId = null; refreshGhost(); }
  }
  /* The shelf: prefabs kept on this device across maps. Embedded models are
     not copied (they belong to a map); URL assets travel with the prefab. */
  function shelfSave(id) {
    const d = prefabById(id); if (!d) return;
    const assets = []; d.objects.forEach(c => { if (c.t === 'glb') { const a = S.map.assets.find(x => x.id === c.a); if (a && a.url && !assets.find(x => x.id === a.id)) assets.push({ id: a.id, label: a.label, url: a.url, anims: a.anims }); } });
    const entry = { id: d.id, name: d.name, icon: d.icon, objects: clone(d.objects).filter(c => c.t !== 'glb' || assets.find(a => a.id === c.a)), assets, saved: Date.now() };
    const list = shelfList().filter(x => x.id !== d.id); list.unshift(entry); shelfWrite(list); renderLibrary(); toast('📚 "' + d.name + '" is on your prefab shelf — available in every map on this device.');
  }
  function shelfImport(entryId) {
    const e = shelfList().find(x => x.id === entryId); if (!e) return;
    beginObjectEdit();
    (e.assets || []).forEach(a => { if (!S.map.assets.find(x => x.id === a.id)) S.map.assets.push({ id: a.id, label: a.label, url: a.url, anims: a.anims }); });
    let def = prefabById(e.id);
    if (!def) { def = { id: e.id, name: e.name, icon: e.icon || '🧱', objects: clone(e.objects) }; S.map.prefabs.push(def); }
    endObjectEdit(); setDirty(true);
    S.propId = 'prefab'; S.prefabId = def.id; if (S.tool === 'select' || S.tool === 'erase') setTool('place'); renderLibrary(); refreshGhost(); renderHud();
    toast('Prefab ready — click the ground to place it.');
  }
  function shelfRemove(entryId) { shelfWrite(shelfList().filter(x => x.id !== entryId)); renderLibrary(); }
  function focusSelected() {
    const r = world.objects.get(S.selectedId); if (!r) return;
    const bb = new THREE.Box3().setFromObject(r), size = new THREE.Vector3(); bb.getSize(size);
    const c = new THREE.Vector3(); bb.getCenter(c);
    const d = Math.max(4, size.length() * 2.2);
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    controls.target.copy(c); camera.position.copy(c).addScaledVector(dir, d); controls.update();
  }

  /* custom .glb assets: remember a "fit to 2 m" scale per asset so the first
     placement is a sane size no matter what units the file was exported in */
  const assetFit = new Map();
  async function addAsset(url, label, hints) {
    url = String(url || '').trim(); if (!url) return;
    const dup = S.map.assets.find(a => a.url === url); if (dup) { S.propId = 'glb'; S.assetId = dup.id; renderLibrary(); refreshGhost(); return; }
    if (!/^(https?:\/\/|\/|\.\/)/i.test(url)) { toast('Model URL must start with https:// or /'); return; }
    if (!/\.gl(b|tf)(\?|#|$)/i.test(url)) toast('Expected a .glb / .gltf URL — trying anyway.', 3000);
    if (!THREE.GLTFLoader) { toast('GLTFLoader did not load — custom models unavailable right now.', 3600); return; }
    beginObjectEdit();
    const a = { id: uid('a_'), label: (label || url.split('/').pop().split('?')[0] || 'Model').slice(0, 60), url };
    if (hints && Array.isArray(hints.anims)) a.anims = hints.anims.slice(0, 64);
    S.map.assets.push(a);
    endObjectEdit();
    S.propId = 'glb'; S.assetId = a.id; renderLibrary(); refreshGhost();
    toast('Loading ' + a.label + '…', 2000);
    try {
      const { size, clips } = await world.loadAsset(a.id);
      const m = Math.max(size.x, size.y, size.z) || 1;
      assetFit.set(a.id, Math.min(50, Math.max(0.01, 2 / m)));
      toast(a.label + ' ready' + (clips.length ? ' · ' + clips.length + ' animation' + (clips.length > 1 ? 's' : '') : '') + ' — click the ground to place it.', 3000);
      renderLibrary(); refreshGhost();
    } catch (e) { toast('Could not load ' + a.label + ' (' + ((e && e.message) || 'network/CORS') + ').', 4200); }
  }
  /* Models from disk: embedded into the document as base64 so the map stays a
     single self-contained file. Admin-only (the editor button is admin-only
     too): embedded files end up in a cloud row, and this repo does not host
     player-uploaded binaries — see CLAUDE.md. Production assets belong in
     /models/ (the Project list) — Relink converts an embed to that URL. */
  const EMBED_MAX = 2.5 * 1024 * 1024;
  async function addAssetFile(file) {
    if (!file) return;
    if (!/\.(glb|gltf)$/i.test(file.name)) { if (/\.json$/i.test(file.name)) { importJson(file); return; } toast('Only .glb / .gltf files can be dropped here.'); return; }
    if (bridge() && !isAdmin()) { toast('Embedding model files is admin-only — reference a URL instead.', 3600); return; }
    if (!THREE.GLTFLoader) { toast('GLTFLoader did not load — custom models unavailable right now.', 3600); return; }
    if (file.size > EMBED_MAX) { toast(file.name + ' is ' + (file.size / 1048576).toFixed(1) + ' MB — over the ' + (EMBED_MAX / 1048576) + ' MB embed limit. Put it in /models/ and add it by URL.', 5200); return; }
    if (/\.gltf$/i.test(file.name)) { toast('.gltf with external files cannot be embedded — export as a single .glb.', 4200); return; }
    const buf = await file.arrayBuffer();
    beginObjectEdit();
    const a = { id: uid('a_'), label: file.name.replace(/\.glb$/i, '').slice(0, 60), data: bufferToB64(buf), size: file.size };
    S.map.assets.push(a);
    endObjectEdit();
    S.propId = 'glb'; S.assetId = a.id; libCat = 'Models'; renderLibrary(); refreshGhost();
    if (S.tool === 'select' || S.tool === 'erase') setTool('place');
    toast('Embedding ' + a.label + ' (' + (file.size / 1024).toFixed(0) + ' KB)…', 2000);
    try {
      const { size, clips } = await world.loadAsset(a.id);
      const m = Math.max(size.x, size.y, size.z) || 1;
      assetFit.set(a.id, Math.min(50, Math.max(0.01, 2 / m)));
      toast(a.label + ' ready' + (clips.length ? ' · ' + clips.length + ' animation' + (clips.length > 1 ? 's' : '') : '') + ' — click the ground to place it.', 3200);
      renderLibrary(); refreshGhost(); setDirty(true);
    } catch (e) { toast('Could not read ' + a.label + ' (' + ((e && e.message) || 'bad file') + ').', 4200); }
  }
  function relinkAsset(id) {
    const a = S.map.assets.find(x => x.id === id); if (!a) return;
    const url = window.prompt('URL this model is served from (e.g. /models/' + a.label.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() + '.glb):', a.url || '');
    if (!url) return;
    beginObjectEdit(); a.url = url.trim(); delete a.data; delete a.size; endObjectEdit();
    renderLibrary(); setDirty(true); toast('Relinked — it will load from the URL on next open.');
  }
  let projectLib = null, projectSounds = null;   // /models/manifest.json (models + sounds), fetched once per session
  async function loadProjectLib() {
    if (projectLib) return projectLib;
    try { const r = await fetch('/models/manifest.json', { cache: 'no-cache' }); const j = r.ok ? await r.json() : null; projectLib = (j && Array.isArray(j.models)) ? j.models.filter(m => m && m.url) : []; projectSounds = (j && Array.isArray(j.sounds)) ? j.sounds.filter(m => m && m.url) : []; }
    catch (e) { projectLib = []; projectSounds = []; }
    return projectLib;
  }
  /* editor-only 2D preview through a throwaway listener (the world's audio only runs in Play) */
  let previewAudio = null;
  function previewSound(url) {
    try { if (!previewAudio) { previewAudio = new THREE.Audio(new THREE.AudioListener()); } const ctx = previewAudio.listener.context; if (ctx.state === 'suspended') ctx.resume(); new THREE.AudioLoader().load(url, (buf) => { try { if (previewAudio.isPlaying) previewAudio.stop(); previewAudio.setBuffer(buf); previewAudio.setLoop(false); previewAudio.setVolume(0.9); previewAudio.play(); } catch (e) {} }, undefined, () => toast('Could not load that sound.', 3000)); } catch (e) { toast('Audio is not available here.', 2600); }
  }
  function removeAsset(id) {
    beginObjectEdit();
    S.map.assets = S.map.assets.filter(a => a.id !== id);
    S.map.objects.filter(o => o.t === 'glb' && o.a === id).map(o => o.id).forEach(removeObject);
    S.map.objects.forEach(o => { if (o.t === 'spline' && o.sp && o.sp.src && o.sp.src.t === 'glb' && o.sp.src.a === id) { o.sp.src = { t: 'placeholder' }; world.refreshObject(o); } });   // a spline built from that model falls back to the placeholder instead of a dead reference
    if (S.assetId === id) { S.assetId = null; if (S.propId === 'glb') S.propId = 'tree'; }
    if (S.lastSrc && S.lastSrc.a === id) S.lastSrc = null;
    endObjectEdit(); renderLibrary(); refreshGhost();
  }

  /* placement ghost — a see-through preview under the cursor */
  function refreshGhost() {
    if (ghost) { scene.remove(ghost); ghost = null; }
    if (!(S.tool === 'place' || S.tool === 'scatter') || S.propId === 'spline') return;
    const g = (S.propId === 'glb' || S.propId === 'prefab') ? buildProp(THREE, 'placeholder') : buildProp(THREE, S.propId, S.propTint);
    g.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.45; o.material.depthWrite = false; o.castShadow = false; } });
    if (S.propId === 'glb') { const f = assetFit.get(S.assetId); if (f) g.scale.setScalar(f); }
    ghost = g; ghost.visible = false; scene.add(ghost);
  }

  /* ═══ UNDO ═══ */
  function pushUndo(e) { S.undo.push(e); if (S.undo.length > 60) S.undo.shift(); S.redo.length = 0; renderUndo(); }
  function applyEntry(e, dir) {
    const snap = dir < 0 ? e.before : e.after;
    if (e.type === 'terrain') {
      const resized = snap.n !== S.map.terrain.n || snap.cell !== S.map.terrain.cell;
      world.terrain.restore(snap); if (resized) world.onTerrainRebuilt(); regroundAll(); renderTerrainTab();
    } else if (e.type === 'objects') {
      S.map.objects = clone(snap.objects); S.map.assets = clone(snap.assets); S.map.folders = clone(snap.folders || []); S.map.prefabs = clone(snap.prefabs || []);
      if (S.folderId && !folderById(S.folderId)) S.folderId = null;
      Array.from(world.objects.keys()).forEach(id => world.removeObject(id));
      S.map.objects.forEach(o => world.addObject(o)); renderOutliner();
      if (S.selectedId && !objById(S.selectedId)) select(null); else select(S.selectedId);
      renderLibrary(); renderStats();
    } else if (e.type === 'settings') {
      Object.assign(S.map, clone(snap)); world.applyEnv(S.map.env); world.applyWater(S.map.water); renderWaterTab(); renderSkyTab();
    }
    setDirty(true);
  }
  function undo() { const e = S.undo.pop(); if (!e) return; S.redo.push(e); applyEntry(e, -1); renderUndo(); }
  function redo() { const e = S.redo.pop(); if (!e) return; S.undo.push(e); applyEntry(e, +1); renderUndo(); }
  function renderUndo() { $('#mf-undo').disabled = !S.undo.length; $('#mf-redo').disabled = !S.redo.length; }
  // settings edits (water/sky) coalesce: one undo step per slider drag
  let settingsBefore = null, settingsT = 0;
  function settingsChanged() {
    if (!settingsBefore) settingsBefore = { water: clone(S.map.water), env: clone(S.map.env) };
    clearTimeout(settingsT);
    settingsT = setTimeout(() => { pushUndo({ type: 'settings', before: settingsBefore, after: { water: clone(S.map.water), env: clone(S.map.env) } }); settingsBefore = null; }, 700);
    setDirty(true);
  }

  /* ═══ PLAY MODE ═══ — the shared first-person walker (mapforge.player.js) */
  const play = { savedCam: null, savedTarget: null };
  const player = createPlayer(THREE, { world: { get map() { return S.map; }, get terrain() { return world.terrain; }, heightAt: (x, z) => world.heightAt(x, z), groundAt: (x, z, f) => world.groundAt(x, z, f), resolveMove: (...a) => world.resolveMove(...a), spawns: () => world.spawns() }, camera, dom: renderer.domElement, onUnlock: () => stopPlay() });
  ED.play = player;
  function startPlay() {
    if (S.playing) return;
    S.playing = true; canvasHost.classList.add('play');
    play.savedCam = camera.position.clone(); play.savedTarget = controls.target.clone();
    controls.enabled = false; if (gizmo) gizmo.detach(); brushRing.visible = false; if (ghost) ghost.visible = false;
    world.setMarkersVisible(false); colSel.visible = false; colAll.visible = false;
    const sp = world.spawns()[0];
    /* 🎥 Play uses the map's point of view and character, exactly as the game will */
    S.map.player = normalizePlayer(S.map.player);
    if (play.avatar) { try { play.avatar.dispose(); } catch (e) {} play.avatar = null; }
    if (S.map.player.model && S.map.player.model.a) { try { play.avatar = createAvatar(THREE, { world, scene, player: S.map.player }); } catch (e) { play.avatar = null; } }
    player.setView(S.map.player.view, play.avatar);
    player.start(sp ? null : { pos: new THREE.Vector3(controls.target.x, 0, controls.target.z), yaw: Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z) + Math.PI });
    trigRing.visible = false; S.bpOpen = false; renderBpPanel(); drawNav();
    world.startPlay({ get pos() { return player.pos; }, setPos: (x, z) => { player.pos.x = x; player.pos.z = z; player.pos.y = world.heightAt(x, z); } });
    $('#mf-play').classList.add('on'); $('#mf-play').textContent = '■ Stop';
    // 🔊 sound markers play in Play mode: pressing Play is itself the gesture
    // 🔊 build B's sound MARKERS (t:'audio') get their listener only when the map has any — a second AudioListener on the camera slowed build A's component emitters (pw-test9)
    try { if (world.sounds && world.sounds.size) { world.attachAudio(camera); world.startAudio(); } } catch (e) {}
  }
  function stopPlay() {
    if (!S.playing) return;
    try { world.stopAudio(); } catch (e) {}
    S.playing = false; canvasHost.classList.remove('play');
    world.stopPlay(); $('#mf-prompt').hidden = true; drawNav();
    player.stop(); drawColliders(); renderStats(); renderOutliner();
    if (play.avatar) { try { play.avatar.dispose(); } catch (e) {} play.avatar = null; }
    controls.enabled = true; camera.position.copy(play.savedCam); controls.target.copy(play.savedTarget); controls.update();
    world.setMarkersVisible(S.showMarkers);
    $('#mf-play').classList.remove('on'); $('#mf-play').textContent = '▶ Play';
    if (S.selectedId) select(S.selectedId);
  }
  function playFrame(dt) { player.frame(dt); }

  /* ═══ KEYBOARD ═══ */
  const fly = { keys: {} };
  function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function onKeyDown(e) {
    if (S.playing && (e.key === 'e' || e.key === 'E') && !isTyping(e)) { try { player.interact(); } catch (x) {} }
    if (!ED) return;
    if ($('.mf-help').classList.contains('on') && e.key === 'Escape') { $('.mf-help').classList.remove('on'); return; }
    if (isTyping(e)) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key.toLowerCase();
    if (S.playing) { if (k === 'escape') stopPlay(); else if (k === 'e' && !mod0(e)) world.interact(); return; }   // movement keys belong to the player
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (k === 'f2') { e.preventDefault(); const o = S.selectedId ? objById(S.selectedId) : null; if (o) { const nm = window.prompt('Name this object:', o.n || ''); if (nm != null) { beginObjectEdit(); o.n = nm.trim().slice(0, 60) || undefined; endObjectEdit(); setDirty(true); renderInspector(); renderOutliner(); } } else { const sel = libSel ? entryByKey(libSel) : null; if (sel) renameEntry(sel); } return; }   // F2: the selected object first (Unreal's outliner), else the library item
    if ((e.ctrlKey || e.metaKey) && k === ' ') { e.preventDefault(); toggleContentBrowser(); return; }
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (S.hotkeys === 'unreal') {
      // Unreal: W/A/S/D fly only while the right mouse button is held; otherwise
      // Q select, W move, E rotate, R scale — the viewport hotkeys Unreal users have in their hands.
      if (S.rmb && ['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(k) && !mod) { fly.keys[k] = true; if (k !== 'shift') e.preventDefault(); return; }
      if (!mod) { switch (k) { case 'q': setTool('select'); e.preventDefault(); return; case 'w': setGizmoMode('translate'); e.preventDefault(); return; case 'e': setGizmoMode('rotate'); e.preventDefault(); return; case 'r': setGizmoMode('scale'); e.preventDefault(); return; case 'end': dropSelected(); e.preventDefault(); return; } }
    } else if (['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(k) && !mod) { fly.keys[k] = true; if (k !== 'shift') e.preventDefault(); return; }
    if (splineDraft) { if (k === 'enter') { splineDraftFinish(false); e.preventDefault(); return; } if (k === 'escape') { splineDraftCancel(); e.preventDefault(); return; } if (k === 'backspace' || k === 'delete') { splineDraft.pts.pop(); if (!splineDraft.pts.length) splineDraftCancel(); else drawSplineDraft(); e.preventDefault(); return; } }
    if (S.splinePt >= 0 && (k === 'delete' || k === 'backspace')) { splineDeletePoint(); e.preventDefault(); return; }
    switch (k) {
      case '1': setTool('select'); break; case '2': setTool('sculpt'); break; case '3': setTool('paint'); break;
      case '4': setTool('place'); break; case '5': setTool('scatter'); break; case '6': setTool('erase'); break;
      case 't': setGizmoMode('translate'); break; case 'r': setGizmoMode('rotate'); break; case 'c': setGizmoMode('scale'); break;
      case 'x': S.snap = !S.snap; applySnap(); renderHud(); break;
      case 'f': focusSelected(); break;
      case 'delete': case 'backspace': deleteSelected(); break;
      case 'escape': select(null); break;
      case '[': S.brush.radius = Math.max(0.5, S.brush.radius * 0.85); renderBrush(); break;
      case ']': S.brush.radius = Math.min(60, S.brush.radius * 1.18); renderBrush(); break;
      case 'p': togglePlay(); break;
      case 'h': $('.mf-help').classList.toggle('on'); break;
      default: return;
    }
    e.preventDefault();
  }
  function onKeyUp(e) { const k = e.key.toLowerCase(); fly.keys[k] = false; }
  function mod0(e) { return e.ctrlKey || e.metaKey || e.altKey; }
  window.addEventListener('keydown', onKeyDown, true); window.addEventListener('keyup', onKeyUp, true);
  teardown.push(() => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true); });
  function flyFrame(dt) {
    const k = fly.keys; if (!(k.w || k.a || k.s || k.d || k.q || k.e)) return;
    const speed = (k.shift ? 3 : 1) * Math.max(6, camera.position.distanceTo(controls.target) * 0.6) * dt;
    const fwd = new THREE.Vector3().subVectors(controls.target, camera.position); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x), mv = new THREE.Vector3();
    if (k.w) mv.add(fwd); if (k.s) mv.sub(fwd); if (k.d) mv.add(right); if (k.a) mv.sub(right); if (k.e) mv.y += 1; if (k.q) mv.y -= 1;
    mv.multiplyScalar(speed); camera.position.add(mv); controls.target.add(mv);
  }
  function setGizmoMode(m) { S.gizmoMode = m; if (gizmo) gizmo.setMode(m); if (S.tool !== 'select') setTool('select'); $$('.mf-gizmo button[data-gm]').forEach(b => b.classList.toggle('on', b.dataset.gm === m)); }
  function applySnap() { if (!gizmo) return; gizmo.setTranslationSnap(S.snap ? S.snapSize : null); gizmo.setRotationSnap(S.snap ? THREE.MathUtils.degToRad(15) : null); gizmo.setScaleSnap(S.snap ? 0.25 : null); $('#mf-snap').classList.toggle('on', S.snap); }
  function setGizmoSpace(sp) { S.gizmoSpace = sp; if (gizmo) gizmo.setSpace(sp); $('#mf-space').textContent = sp === 'local' ? '⟲ Local' : '🌐 World'; }
  function dropSelected() { const o = objById(S.selectedId); if (!o) return; beginObjectEdit(); o.p[1] = world.heightAt(o.p[0], o.p[2]); o.g = true; world.refreshObject(o); endObjectEdit(); setDirty(true); renderInspector(); }
  function setHotkeys(h) { S.hotkeys = h === 'default' ? 'default' : 'unreal'; try { localStorage.setItem('mf_hotkeys', S.hotkeys); } catch (e) {} $('#mf-hotkeys').value = S.hotkeys; renderToolbar(); renderHud(); }
  function renderToolbar() {
    const u = S.hotkeys === 'unreal';
    $('#mf-gm-select').innerHTML = '↖ Select <kbd>' + (u ? 'Q' : '1') + '</kbd>';
    $$('.mf-gizmo button[data-gm]').forEach(b => { const m = b.dataset.gm; b.innerHTML = (m === 'translate' ? '✥ Move' : m === 'rotate' ? '⟳ Rotate' : '⤢ Scale') + ' <kbd>' + (u ? { translate: 'W', rotate: 'E', scale: 'R' }[m] : { translate: 'T', rotate: 'R', scale: 'C' }[m]) + '</kbd>'; });
  }
  function togglePlay() { S.playing ? stopPlay() : startPlay(); }

  /* ═══ SAVE / LOAD ═══ */
  let draftT = 0;
  function setDirty(d) {
    S.dirty = d;
    const st = $('.mf-top .state'); st.textContent = d ? '● Unsaved changes' : (S.source === 'cloud' ? '☁ Saved to cloud' : S.source === 'local' ? '💾 Saved on this device' : 'New map');
    st.classList.toggle('dirty', d);
    if (d) { clearTimeout(draftT); draftT = setTimeout(() => api.saveDraft(S.map), 3000); }
  }
  async function save(forceSource) {
    if (!S.mine && S.source === 'cloud') {
      // someone else's public map — saving makes YOUR copy
      S.map.id = uid('map_'); S.map.name = (S.map.name + ' (copy)').slice(0, 80); S.mine = true; S.isPublic = false;
      $('.mf-top .name input').value = S.map.name;
    }
    S.map.name = ($('.mf-top .name input').value || 'Untitled world').trim().slice(0, 80);
    S.map.description = ($('#mf-desc').value || '').slice(0, 2000);
    S.map.game = gameId(currentGameField()) || 'sandbox'; setGameField(S.map.game);
    const source = forceSource || S.source || (signedIn() ? 'cloud' : 'local');
    S.map.menu = normalizeMenu(S.map.menu);
    if (S.map.menu.on && source === 'cloud' && !S.isPublic) { S.isPublic = true; toast('This map is a menu button, so it is saved public.', 2600); }
    const btn = $('#mf-save'); btn.disabled = true;
    const r = await api.saveMap(S.map, source, source === 'cloud' ? S.isPublic : undefined);
    btn.disabled = false;
    if (!r.ok) { toast('Save failed: ' + (r.error || 'unknown error'), 5000); return false; }
    S.source = r.source; setDirty(false); api.clearDraft(); notifyGame('saved');
    if (r.fellBack) toast(r.missing ? 'Cloud maps are not set up yet (run sql/091) — saved on this device instead.' : r.offline ? 'Not signed in — saved on this device.' : 'Cloud save failed (' + r.error + ') — saved on this device instead.', 5200);
    else toast(r.source === 'cloud' ? '☁ Saved to the cloud.' : '💾 Saved on this device.');
    if (S.map.menu.on && r.source !== 'cloud') toast('The menu button only shows once the map is saved to the cloud.', 4200);
    try { refreshMenu(); } catch (e) {}
    renderMapsTab();
    return true;
  }
  function exportJson() {
    const doc = serialize(S.map);
    const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (doc.name || 'world').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.world.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Exported ' + a.download);
  }
  function importJson(file) {
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const m = normalize(JSON.parse(rd.result));
        m.id = uid('map_'); m.name = (m.name + ' (imported)').slice(0, 80);
        if (S.dirty && !(await askConfirm('Discard unsaved changes and open the imported map?'))) return;
        loadDoc(m, null); setDirty(true); toast('Imported — save it to keep it.');
      } catch (e) { toast('That file is not an Athena Engine map.', 3200); }
    };
    rd.readAsText(file);
  }
  async function newMapFlow() {
    if (S.dirty && !(await askConfirm('Discard unsaved changes and start a new map?'))) return;
    const m = newMap({ author: displayName(), game: gameId(currentGameField()) || 'sandbox' });
    loadDoc(m, null); world.terrain.generate({ type: 'hills', seed: (Math.random() * 1e6) | 0, amplitude: 6, scale: 0.35 }); regroundAll(); renderTerrainTab();
    api.clearDraft(); setDirty(false); S.isPublic = false; S.mine = true; renderMapsTab();
  }
  async function openMap(id, source) {
    if (S.dirty && !(await askConfirm('Discard unsaved changes and open that map?'))) return;
    const r = await api.loadMap(id, source);
    if (!r.ok) { toast('Could not open: ' + (r.error || 'unknown'), 4000); return; }
    S.isPublic = !!r.is_public; S.mine = r.mine !== false;
    loadDoc(r.map, source); api.clearDraft(); renderMapsTab();
    if (!S.mine) toast('This is someone else\'s public map — saving creates your own copy.', 4200);
  }
  async function close(force) {
    if (!ED) return;
    if (!force && S.dirty && !(await askConfirm('You have unsaved changes. Close anyway? (A draft is kept on this device.)'))) return;
    if (S.dirty) api.saveDraft(S.map);
    stopPlay();
    try { cancelAnimationFrame(raf); } catch (e) {}   // raf is declared at the very end; a close during a failed open must not throw
    teardown.forEach(f => { try { f(); } catch (e) {} });
    try { post.dispose(); if (world) world.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
    try { if (thumbs) thumbs.dispose(); } catch (e) {}
    root.remove(); document.body.style.overflow = prevOverflow;
    const closedGame = S.map && S.map.game;
    ED = null;
    // The ⚒ pill hid itself while the editor covered the screen; a live map may
    // also have been set or unset in here. Reload the live index and redraw it.
    try { refreshLive(); } catch (e) {}
    try { if (closedGame) invalidateOverlay(closedGame); window.dispatchEvent(new CustomEvent('athena:closed', { detail: { game: closedGame || 'sandbox' } })); } catch (e) {}
    try { if (opts.onClose) opts.onClose(); } catch (e) {}
  }
  ED.close = () => close(false);
  // For code that edits S.map directly (tests, future game hooks): refresh the chrome.
  ED.refresh = () => { renderStats(); renderInspector(); renderLibrary(); };

  /* ═══ UI RENDERERS ═══ */
  function renderHud() {
    const b = S.brush;
    const tool = { select: 'Select', sculpt: 'Sculpt · ' + S.sculptMode, paint: 'Paint · ' + PAINT[S.paintIdx].label, place: 'Place · ' + propLabel(), scatter: 'Scatter · ' + propLabel(), erase: 'Erase' }[S.tool];
    const fld = S.folderId && folderById(S.folderId);
    $('#mf-hud-tool').innerHTML = '<b>' + esc(tool) + '</b>' + (S.tool === 'sculpt' || S.tool === 'paint' || S.tool === 'scatter' ? ' · radius ' + b.radius.toFixed(1) + 'm' : '') + (S.snap ? ' · snap' : '') + (fld && (S.tool === 'place' || S.tool === 'scatter') ? ' · into 📁 ' + esc(fld.name) : '');
    const gk = S.hotkeys === 'unreal' ? '<b>W/E/R</b> move/rotate/scale · <b>RMB+WASD</b> fly' : '<b>T/R/C</b> move/rotate/scale · <b>WASD</b> fly';
    $('#mf-hud-help').innerHTML = { select: 'Click an object · ' + gk + ' · <b>F</b> focus · <b>Del</b> remove · <b>Ctrl+D</b> duplicate', sculpt: 'Drag to raise · <b>Shift</b> lower · <b>Ctrl</b> smooth · <b>Alt</b> flatten · <b>[ ]</b> radius', paint: 'Drag to paint the selected layer · <b>[ ]</b> radius', place: S.propId === 'spline' ? 'Click the ground to add points · <b>Enter</b> or double-click finishes · click the first point to close a loop · <b>Backspace</b> removes the last · <b>Esc</b> cancels' : 'Click the ground to place · pick a prop in the Library', scatter: 'Drag to scatter several props · <b>[ ]</b> radius', erase: 'Click an object to remove it' }[S.tool];
  }
  function propLabel() { if (S.propId === 'glb') { const a = S.map.assets.find(x => x.id === S.assetId); return a ? a.label : 'model'; } if (S.propId === 'prefab') { const p = prefabById(S.prefabId); return p ? '🧱 ' + p.name : 'prefab'; } return (PROP_BY_ID[S.propId] || {}).label || S.propId; }
  function renderBrush() {
    const b = S.brush; $('#mf-radius').value = b.radius; $('#mf-radius-v').textContent = b.radius.toFixed(1) + 'm';
    $('#mf-strength').value = b.strength; $('#mf-strength-v').textContent = Math.round(b.strength * 100) + '%';
    $('#mf-falloff').value = b.falloff; $('#mf-falloff-v').textContent = Math.round(b.falloff * 100) + '%';
    renderHud();
  }
  function renderPalette() {
    $('#mf-palette').innerHTML = PAINT.map((p, i) => '<button data-paint="' + i + '" class="' + (i === S.paintIdx ? 'on' : '') + '"><span class="sw" style="background:' + p.color + '"></span>' + esc(p.label) + '</button>').join('');
    $$('#mf-palette button').forEach(b => b.onclick = () => { S.paintIdx = +b.dataset.paint; if (S.tool !== 'paint') setTool('paint'); renderPalette(); renderHud(); });
  }
  /* ═══ LIBRARY / ASSET BROWSER ═══
     Two views over one index (mapforge.assets.js). With no search text and a
     prop category picked, the classic grid (buttons, now with thumbnails).
     With text, or on All / ★, a unified card grid over props, models, prefabs
     and sounds. The management forms (add .glb, URL, shelf, sounds by URL)
     stay under their own categories. `libSel` is the card the details panel
     describes — it follows whatever was last picked. */
  let libCat = 'Nature', libQ = '', libTag = '', libSel = null, libIndex = [];
  const prefs = assetsMod.createPrefs();
  let thumbs = null;
  function thumbsRenderer() { if (thumbs === null) { try { thumbs = assetsMod.createThumbs(THREE, { size: 96 }); } catch (e) { thumbs = false; } } return thumbs || null; }
  ED.thumbs = () => thumbsRenderer();
  const tplCache = new Map();        // assetId → template Object3D once the world has loaded it
  const thumbBusy = new Set();       // asset/project keys with a load in flight (or failed) — never retried in a loop
  function cacheTemplate(a) {
    if (!a || tplCache.has(a.id) || thumbBusy.has('model:' + a.id)) return;
    thumbBusy.add('model:' + a.id);
    world.loadAsset(a.id).then(({ template }) => { tplCache.set(a.id, template); thumbBusy.delete('model:' + a.id); const th = thumbsRenderer(); if (th) th.invalidate('model:' + a.id); if (root.isConnected) renderLibrary(); }).catch(() => {});
  }
  /* A project model not yet in the map: load it once for its picture (no asset is created). */
  let projectThumbLoads = 0;
  function cacheProjectTemplate(key, m) {
    if (thumbBusy.has(key) || tplCache.has(key) || !THREE.GLTFLoader || projectThumbLoads >= 24) return;
    thumbBusy.add(key); projectThumbLoads++;
    try {
      new THREE.GLTFLoader().load(m.url, (g) => {
        const sc = g.scene || (g.scenes && g.scenes[0]); if (!sc) return;
        sc.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(sc), c = new THREE.Vector3(); bb.getCenter(c);
        const wrap = new THREE.Group(); sc.position.set(-c.x, -bb.min.y, -c.z); wrap.add(sc);
        tplCache.set(key, wrap); thumbBusy.delete(key); if (root.isConnected) renderLibrary();
      }, undefined, () => {});
    } catch (e) {}
  }
  function prefabPreview(def) {
    const g = new THREE.Group();
    (def.objects || []).slice(0, 60).forEach(c => {
      let body;
      if (c.t === 'glb') { const tpl = tplCache.get(c.a); body = tpl ? tpl.clone() : buildProp(THREE, 'placeholder'); }
      else if (c.t.startsWith('fx_')) body = buildProp(THREE, 'fxmarker');
      else body = buildProp(THREE, c.t, c.c);
      body.position.set(c.p[0], c.p[1], c.p[2]); body.rotation.set(c.r[0], c.r[1], c.r[2]); body.scale.set(c.s[0], c.s[1], c.s[2]);
      g.add(body);
    });
    return g;
  }
  /* { img } or { icon } for a card; builds and caches the picture on first ask. */
  function thumbOf(e) {
    const th = thumbsRenderer();
    if (e.kind === 'prop') return assetsMod.thumbFor(th, e.key, e.icon, () => (e.ref.fxKind || e.ref.marker) ? null : buildProp(THREE, e.id));
    if (e.kind === 'model') { const tpl = tplCache.get(e.id); if (!tpl) cacheTemplate(e.ref); return assetsMod.thumbFor(th, e.key, e.icon, () => tpl || null); }
    if (e.kind === 'project' || e.kind === 'cloud') { const inMap = S.map.assets.find(a => a.url === e.url); if (inMap) return thumbOf({ kind: 'model', key: 'model:' + inMap.id, id: inMap.id, icon: e.icon, ref: inMap }); if (!tplCache.has(e.key)) cacheProjectTemplate(e.key, e.ref); return assetsMod.thumbFor(th, e.key, e.icon, () => tplCache.get(e.key) || null); }
    if (e.kind === 'prefab' || e.kind === 'shelf') return assetsMod.thumbFor(th, e.key + ':' + (e.ref.objects || []).length, e.icon, () => prefabPreview(e.ref));
    return { icon: e.icon };
  }
  function invalidatePrefabThumb(id) { const th = thumbsRenderer(); if (!th) return; Array.from(th.cache.keys()).filter(k => k.startsWith('prefab:' + id + ':') || k.startsWith('shelf:' + id + ':')).forEach(k => th.invalidate(k)); }
  function rebuildIndex() {
    libIndex = assetsMod.buildIndex({ props: PROP_CATALOG, assets: S.map.assets, project: projectLib || [], cloud: cloudFiles || [], cloudSounds: cloudSounds || [], prefabs: S.map.prefabs || [], shelf: shelfList(), sounds: S.map.sounds || [], projectSounds: projectSounds || [], splines: SPLINE_PRESETS });
    if (cloudFiles === null && !cloudLoading) loadCloud();
    return libIndex;
  }
  function entryByKey(k) { return libIndex.find(e => e.key === k) || null; }
  const KIND_CATS = { Models: ['model', 'project', 'cloud'], Prefabs: ['prefab', 'shelf'], Sounds: ['sound', 'psound', 'csound'], Splines: ['spline'] };
  function libFilters() {
    const f = {};
    if (libCat === '★') f.fav = prefs.favs;
    else if (KIND_CATS[libCat]) f.kind = KIND_CATS[libCat];
    else if (libCat !== 'All' && !libQ.trim() && !libTag) f.cat = libCat;   // typing searches everything; a prop category only scopes the idle grid
    if (libTag) f.tag = libTag;
    return f;
  }
  function addSound(url, label) { url = String(url || '').trim(); if (!url) return; if (!/^(https?:\/\/|\/|\.\/|assets\/)/i.test(url)) { toast('Sound URL must start with https://, / or assets/'); return; } if (S.map.sounds.find(x => x.url === url)) { toast('Already in this map.'); return; } beginObjectEdit(); S.map.sounds.push({ id: uid('s_'), label: (label || decodeURIComponent(url.split('/').pop().replace(/\.[a-z0-9]+$/i, '')) || 'Sound').slice(0, 60), url }); endObjectEdit(); setDirty(true); renderLibrary(); }
  const wantPlace = () => { if (S.tool === 'select' || S.tool === 'erase') setTool('place'); };
  /* Act on a card: props/models/prefabs become the placement pick, project
     entries are added to the map first, sounds preview. */
  function pickEntry(e) {
    if (!e) return;
    libSel = e.key; prefs.touch(e.key);
    if (e.kind === 'prop') { S.propId = e.id; if (!e.ref.marker && !e.ref.fxKind) S.lastSrc = Object.assign({ t: e.id }, S.propTint && e.ref.tint ? { c: S.propTint } : {}); wantPlace(); }
    else if (e.kind === 'model') { S.propId = 'glb'; S.assetId = e.id; S.lastSrc = { t: 'glb', a: e.id }; wantPlace(); }
    else if (e.kind === 'spline') { if (splineDraft) splineDraftCancel(); S.propId = 'spline'; S.splinePreset = e.id; wantPlace(); }
    else if (e.kind === 'cloud') { const inMap = S.map.assets.find(a => a.url === e.url); if (inMap) { S.propId = 'glb'; S.assetId = inMap.id; } else addAsset(e.url, e.label); if (S.assetId) { libSel = 'model:' + S.assetId; prefs.touch(libSel); S.lastSrc = { t: 'glb', a: S.assetId }; } wantPlace(); }
    else if (e.kind === 'csound') { if (!S.map.sounds.find(s => s.url === e.url)) addSound(e.url, e.label); else previewSound(e.url); const snd = S.map.sounds.find(s => s.url === e.url); if (snd) { libSel = 'sound:' + snd.id; prefs.touch(libSel); } }
    else if (e.kind === 'project') { const inMap = S.map.assets.find(a => a.url === e.url); if (inMap) { S.propId = 'glb'; S.assetId = inMap.id; } else addAsset(e.url, e.label || e.id, { anims: e.ref.anims }); if (S.assetId) { libSel = 'model:' + S.assetId; prefs.touch(libSel); S.lastSrc = { t: 'glb', a: S.assetId }; } wantPlace(); }
    else if (e.kind === 'prefab') { S.propId = 'prefab'; S.prefabId = e.id; wantPlace(); }
    else if (e.kind === 'shelf') { shelfImport(e.id); return; }
    else if (e.kind === 'sound') previewSound(e.url);
    else if (e.kind === 'psound') { if (!S.map.sounds.find(s => s.url === e.url)) addSound(e.url, e.label); else previewSound(e.url); const snd = S.map.sounds.find(s => s.url === e.url); if (snd) { libSel = 'sound:' + snd.id; prefs.touch(libSel); } }
    renderLibrary(); refreshGhost(); renderHud();
  }
  function isPicked(e) {
    if (e.kind === 'prop') return S.propId === e.id;
    if (e.kind === 'model') return S.propId === 'glb' && S.assetId === e.id;
    if (e.kind === 'project' || e.kind === 'cloud') { const a = S.map.assets.find(x => x.url === e.url); return !!a && S.propId === 'glb' && S.assetId === a.id; }
    if (e.kind === 'prefab') return S.propId === 'prefab' && S.prefabId === e.id;
    if (e.kind === 'spline') return S.propId === 'spline' && S.splinePreset === e.id;
    return false;
  }
  function cardHtml(e, extraClass) {
    const t = thumbOf(e);
    const pic = t.img ? '<img class="th" src="' + t.img + '" alt="">' : '<span class="th ic">' + e.icon + '</span>';
    const badge = e.kind === 'cloud' || e.kind === 'csound' ? (e.inMap ? 'in map' : 'cloud') : e.kind === 'project' || e.kind === 'psound' ? (e.inMap || (e.kind === 'project' && S.map.assets.find(a => a.url === e.url)) ? 'in map' : 'project') : e.kind === 'shelf' ? 'shelf' : e.kind === 'model' ? (e.ref.data ? 'embedded' : 'url') : e.kind === 'prefab' ? e.parts + ' parts' : e.kind === 'sound' ? 'sound' : '';
    return '<div class="mf-card ' + (isPicked(e) ? 'on ' : '') + (libSel === e.key ? 'sel ' : '') + (extraClass || '') + '" data-key="' + esc(e.key) + '" title="' + esc(e.label + ' · ' + assetsMod.KINDS[e.kind].label + ' · ' + assetsMod.KINDS[e.kind].source) + '">' + pic + '<span class="lb">' + esc(e.label) + '</span>' + (badge ? '<span class="bd">' + esc(badge) + '</span>' : '') + '<span class="fav ' + (prefs.isFav(e.key) ? 'on' : '') + '" data-fav="' + esc(e.key) + '" title="Favourite">★</span></div>';
  }
  function wireCards(box) {
    box.querySelectorAll('.mf-card').forEach(el => el.onclick = (ev) => {
      const key = el.dataset.key;
      if (ev.target.dataset.fav) { prefs.toggleFav(key); renderLibrary(); return; }
      pickEntry(entryByKey(key));
    });
  }
  function renderLibrary() {
    rebuildIndex();
    const cats = ['All', '★', 'Nature', 'Structures', 'Props', 'Ruins', 'VFX', 'Markers', 'Splines', 'Models', 'Prefabs', 'Sounds'];
    $('#mf-cats').innerHTML = cats.map(c => '<button data-cat="' + c + '" class="' + (c === libCat ? 'on' : '') + '" title="' + (c === '★' ? 'Favourites' : c === 'All' ? 'Everything, searchable' : c) + '">' + c + '</button>').join('');
    $$('#mf-cats button').forEach(b => b.onclick = () => { libCat = b.dataset.cat; libTag = ''; renderLibrary(); });
    const qEl = $('#mf-lib-q'); if (qEl && qEl.value !== libQ) qEl.value = libQ;
    const vEl = $('#mf-lib-view'); if (vEl) { vEl.textContent = prefs.view === 'list' ? '☰' : '▦'; vEl.title = prefs.view === 'list' ? 'Switch to grid' : 'Switch to list'; }
    const grid = $('#mf-props'), models = $('#mf-models');
    const browsing = !!libQ.trim() || libCat === 'All' || libCat === '★' || libCat === 'Splines' || !!libTag;
    const show = (id, on) => { const el = $('#' + id); if (el) el.style.display = on ? '' : 'none'; };
    let sbox = $('#mf-search'); if (!sbox) { sbox = document.createElement('div'); sbox.id = 'mf-search'; sbox.className = 'mf-cards'; grid.parentNode.insertBefore(sbox, grid); }
    // recent row — only when idle on a category, never while searching
    const rec = $('#mf-recent');
    if (rec) {
      const items = browsing ? [] : prefs.recent.map(entryByKey).filter(Boolean).slice(0, 6);
      rec.style.display = items.length ? '' : 'none';
      rec.innerHTML = items.length ? '<div class="mf-sub">Recent</div><div class="mf-cards row">' + items.map(e => cardHtml(e, 'mini')).join('') + '</div>' : '';
      if (items.length) wireCards(rec);
    }
    if (browsing) {
      show('mf-prefabbox', false); show('mf-soundbox', false); models.style.display = 'none'; grid.innerHTML = '';
      const hits = assetsMod.search(libIndex, libQ, libFilters());
      const tags = assetsMod.collectTags(hits, 14);
      $('#mf-tags').innerHTML = (libTag ? '<button class="on" data-tag="">✕ ' + esc(libTag) + '</button>' : '') + tags.filter(t => t.tag !== libTag).map(t => '<button data-tag="' + esc(t.tag) + '">' + esc(t.tag) + ' <small>' + t.n + '</small></button>').join('');
      $$('#mf-tags button').forEach(b => b.onclick = () => { libTag = b.dataset.tag; renderLibrary(); });
      $('#mf-lib-n').textContent = hits.length + ' / ' + libIndex.length;
      sbox.style.display = ''; sbox.className = 'mf-cards ' + (prefs.view === 'list' ? 'list' : '');
      sbox.innerHTML = hits.length ? hits.slice(0, 120).map(e => cardHtml(e)).join('') + (hits.length > 120 ? '<div class="mf-empty">…and ' + (hits.length - 120) + ' more — narrow the search.</div>' : '') : '<div class="mf-empty">' + (libCat === '★' ? 'No favourites yet — hover a card and click ★.' : 'Nothing matches "' + esc(libQ) + '". Try a tag: wood, stone, building, light, effect, animated.') + '</div>';
      wireCards(sbox);
    } else {
      sbox.style.display = 'none'; $('#mf-tags').innerHTML = ''; $('#mf-lib-n').textContent = '';
      if (libCat === 'Models') {
        show('mf-prefabbox', false); show('mf-soundbox', false);
        grid.innerHTML = ''; models.style.display = '';
        $('#mf-assets').innerHTML = S.map.assets.length ? S.map.assets.map(a => { const t = thumbOf(entryByKey('model:' + a.id) || { kind: 'model', key: 'model:' + a.id, id: a.id, icon: a.data ? '📦' : '🧊', ref: a }); return '<div class="mf-asset ' + (S.propId === 'glb' && S.assetId === a.id ? 'on' : '') + '" data-asset="' + a.id + '">' + (t.img ? '<img class="th" src="' + t.img + '" alt="">' : '<span>' + t.icon + '</span>') + '<span class="lb" title="' + esc(a.url || 'embedded in this map') + '">' + esc(a.label) + (a.anims && a.anims.length ? ' <small>🎞 ' + a.anims.length + '</small>' : '') + '</span>' + (a.data ? '<span class="tag" title="Embedded in the map (' + (assetBytes(a) / 1024).toFixed(0) + ' KB). Relink to a /models/ URL for production.">' + (assetBytes(a) / 1024).toFixed(0) + 'K</span><span class="rl" title="Relink to a URL">↗</span>' : '') + '<span class="x" title="Remove model and every placed copy">✕</span></div>'; }).join('') : '<div class="mf-empty">No models in this map yet. Drop a <b>.glb</b> on the canvas, pick one from the Project list, or paste a URL.</div>';
        const eb = embeddedBytes(S.map); $('#mf-embed-note').textContent = eb ? 'Embedded models: ' + (eb / 1048576).toFixed(2) + ' MB of 3.5 MB cloud limit' : '';
        $$('#mf-assets .mf-asset').forEach(el => {
          el.onclick = (e) => { if (e.target.classList.contains('x')) { removeAsset(el.dataset.asset); return; } if (e.target.classList.contains('rl')) { relinkAsset(el.dataset.asset); return; } pickEntry(entryByKey('model:' + el.dataset.asset)); };
        });
        { const cb = $('#mf-cloud'); if (cb) { const list = cloudFiles || []; cb.innerHTML = !cloudReady() ? '<div class="mf-empty">Sign in to the game to see shared cloud models.</div>' : cloudFiles === null ? '<div class="mf-empty">Loading…</div>' : list.length ? list.map(m => { const e = libIndex.find(x => x.kind === 'cloud' && x.ref === m); const t = e ? thumbOf(e) : { icon: '☁' }; return '<div class="mf-asset" data-cloud="' + esc(m.path) + '" title="' + esc(m.url) + '">' + (t.img ? '<img class="th" src="' + t.img + '" alt="">' : '<span>' + t.icon + '</span>') + '<span class="lb">' + esc(m.name) + '</span><span class="tag">' + (S.map.assets.find(a => a.url === m.url) ? 'in map' : 'cloud') + '</span></div>'; }).join('') : '<div class="mf-empty">No shared models yet — ☁ Upload one.</div>'; cb.querySelectorAll('[data-cloud]').forEach(el => el.onclick = () => pickEntry(entryByKey('cloud:' + el.dataset.cloud))); } }
        loadProjectLib().then(lib => {
          const box = $('#mf-project'); if (!box || libCat !== 'Models') return;
          if (!libIndex.find(e => e.kind === 'project') && lib.length) rebuildIndex();
          box.innerHTML = lib.length ? lib.map((m, i) => { const e = libIndex.find(x => x.kind === 'project' && x.ref === m); const t = e ? thumbOf(e) : { icon: '🗂' }; return '<div class="mf-asset" data-proj="' + i + '" title="' + esc(m.url) + '">' + (t.img ? '<img class="th" src="' + t.img + '" alt="">' : '<span>' + t.icon + '</span>') + '<span class="lb">' + esc(m.label || m.id || m.url) + (m.anims && m.anims.length ? ' <small>🎞 ' + m.anims.length + '</small>' : '') + '</span><span class="tag">' + esc(S.map.assets.find(a => a.url === m.url) ? 'in map' : (m.cat || 'model')) + '</span></div>'; }).join('') : '<div class="mf-empty">No project models listed. Add .glb files to /models/ and list them in /models/manifest.json.</div>';
          box.querySelectorAll('[data-proj]').forEach(el => el.onclick = () => { const m = lib[+el.dataset.proj]; const e = libIndex.find(x => x.kind === 'project' && x.ref === m); if (e) pickEntry(e); else { addAsset(m.url, m.label || m.id, { anims: m.anims }); wantPlace(); } });
        });
      } else if (libCat === 'Sounds') {
        show('mf-prefabbox', false);
        models.style.display = 'none'; grid.innerHTML = '';
        let box = $('#mf-soundbox'); if (!box) { box = document.createElement('div'); box.id = 'mf-soundbox'; grid.parentNode.insertBefore(box, models); }
        box.style.display = '';
        const list = S.map.sounds || [];
        box.innerHTML = `<div class="mf-assets" id="mf-sounds">${list.length ? list.map(x => `<div class="mf-asset ${libSel === 'sound:' + x.id ? 'on' : ''}" data-snd="${esc(x.id)}" title="${esc(x.url)}"><span>🔊</span><span class="lb">${esc(x.label)}</span><span class="rl" data-sact="play" title="Preview">▶</span><span class="x" data-sact="del" title="Remove from this map">✕</span></div>`).join('') : '<div class="mf-empty">No sounds in this map. Add one from the project list or by URL, then put a <b>Sound emitter</b> on an object or use <b>Play sound</b> in a graph.</div>'}</div>
          <div class="mf-sub" style="margin-top:8px">Project (/models/manifest.json → sounds)</div><div class="mf-assets" id="mf-projsounds"><div class="mf-empty">Loading…</div></div>
          <div class="mf-sub" style="margin-top:8px">By URL</div><div><input type="text" id="mf-snd-url" placeholder="/assets/Audio/Rain sound.mp3"></div>
          <div style="display:flex;gap:5px;margin-top:5px"><input type="text" id="mf-snd-label" placeholder="Label (optional)" maxlength="60"><button id="mf-snd-add">Add</button></div>
          <p class="mf-hint">Files the game already ships (assets/Audio) or any CORS host. Nothing is uploaded. Positional sounds pan and fade with distance in Play and in the game.</p>`;
        box.querySelector('#mf-snd-add').onclick = () => { addSound(box.querySelector('#mf-snd-url').value, box.querySelector('#mf-snd-label').value); };
        box.querySelectorAll('[data-snd]').forEach(el => el.onclick = (e) => { const id = el.dataset.snd, act = e.target.dataset.sact; const x = S.map.sounds.find(y => y.id === id); if (!x) return; if (act === 'del') { beginObjectEdit(); S.map.sounds = S.map.sounds.filter(y => y.id !== id); endObjectEdit(); setDirty(true); renderLibrary(); return; } libSel = 'sound:' + id; prefs.touch(libSel); if (act === 'play') previewSound(x.url); renderLibrary(); });
        loadProjectLib().then(() => { const pj = $('#mf-projsounds'); if (!pj || libCat !== 'Sounds') return; const snds = projectSounds || []; pj.innerHTML = snds.length ? snds.map((m, i) => '<div class="mf-asset" data-ps="' + i + '" title="' + esc(m.url) + '"><span>🗂</span><span class="lb">' + esc(m.label || m.url) + '</span><span class="tag">' + (S.map.sounds.find(x => x.url === m.url) ? 'in map' : 'add') + '</span></div>').join('') : '<div class="mf-empty">No project sounds listed. Add a `sounds` array to /models/manifest.json.</div>'; pj.querySelectorAll('[data-ps]').forEach(el => el.onclick = () => { const m = snds[+el.dataset.ps]; addSound(m.url, m.label); }); });
      } else if (libCat === 'Prefabs') {
        show('mf-soundbox', false);
        models.style.display = 'none';
        const defs = S.map.prefabs || [], shelf = shelfList();
        grid.innerHTML = '';
        const pic = (e) => { const t = thumbOf(e); return t.img ? '<img class="th" src="' + t.img + '" alt="">' : '<span>' + t.icon + '</span>'; };
        const html = `<div class="mf-assets" id="mf-prefabs">${defs.length ? defs.map(p => `<div class="mf-asset ${S.propId === 'prefab' && S.prefabId === p.id ? 'on' : ''}" data-pf="${esc(p.id)}">${pic(entryByKey('prefab:' + p.id))}<span class="lb">${esc(p.name)} <small>${p.objects.length} parts · ${S.map.objects.filter(o => o.t === 'prefab' && o.pf === p.id).length} placed</small></span><span class="rl" data-pfact="rename" title="Rename">✎</span><span class="rl" data-pfact="shelf" title="Save to shelf">📚</span><span class="x" data-pfact="del" title="Delete prefab and its instances">✕</span></div>`).join('') : '<div class="mf-empty">No prefabs in this map. Select objects (Ctrl+click) → <b>Create prefab</b> in the inspector, or pull one from the shelf below.</div>'}
          <div class="mf-sub" style="margin-top:8px">Shelf (this device)</div>
          ${shelf.length ? shelf.map(e => `<div class="mf-asset" data-shelf="${esc(e.id)}">${prefabById(e.id) ? pic(entryByKey('prefab:' + e.id)) : pic(entryByKey('shelf:' + e.id) || { kind: 'shelf', key: 'shelf:' + e.id, icon: e.icon || '🧱', ref: e })}<span class="lb">${esc(e.name)} <small>${e.objects.length} parts</small></span><span class="tag">${prefabById(e.id) ? 'in map' : 'add'}</span><span class="x" data-shelfact="del" title="Remove from shelf">✕</span></div>`).join('') : '<div class="mf-empty">Empty. 📚 on a prefab keeps it here for other maps.</div>'}</div>`;
        let box = $('#mf-prefabbox'); if (!box) { box = document.createElement('div'); box.id = 'mf-prefabbox'; grid.parentNode.insertBefore(box, models); }
        box.style.display = ''; box.innerHTML = html;
        box.querySelectorAll('[data-pf]').forEach(el => el.onclick = (e) => {
          const id = el.dataset.pf, act = e.target.dataset.pfact;
          if (act === 'del') { askConfirm('Delete this prefab and every placed instance?').then(ok => { if (ok) deletePrefab(id); }); return; }
          if (act === 'rename') { const nm = window.prompt('Prefab name:', prefabById(id).name); if (nm) renamePrefab(id, nm); return; }
          if (act === 'shelf') { shelfSave(id); return; }
          pickEntry(entryByKey('prefab:' + id));
        });
        box.querySelectorAll('[data-shelf]').forEach(el => el.onclick = (e) => { const id = el.dataset.shelf; if (e.target.dataset.shelfact === 'del') { shelfRemove(id); return; } shelfImport(id); });
      } else {
        show('mf-prefabbox', false); show('mf-soundbox', false);
        models.style.display = 'none';
        grid.className = 'mf-props ' + (prefs.view === 'list' ? 'list' : '');
        grid.innerHTML = PROP_CATALOG.filter(p => p.cat === libCat).map(p => { const e = entryByKey('prop:' + p.id); const t = e ? thumbOf(e) : { icon: p.icon }; return '<button data-prop="' + p.id + '" class="' + (S.propId === p.id ? 'on' : '') + '" title="' + esc(p.label) + '">' + (t.img ? '<img class="ic th" src="' + t.img + '" alt="">' : '<span class="ic">' + p.icon + '</span>') + '<span>' + esc(p.label) + '</span></button>'; }).join('');
        $$('#mf-props button').forEach(b => b.onclick = () => pickEntry(entryByKey('prop:' + b.dataset.prop)));
      }
    }
    renderDetails();
    if (CB.open) renderContentBrowser();
    const tintable = S.propId !== 'glb' && PROP_BY_ID[S.propId] && PROP_BY_ID[S.propId].tint;
    $('#mf-tint-row').style.display = tintable ? '' : 'none';
    $('#mf-tint-on').checked = !!S.propTint;
  }
  /* Details panel: what the picked card is, where it comes from, its tags
     (editable on this map's models and prefabs), size, and its actions. */
  function renderDetails() {
    const box = $('#mf-details'); if (!box) return;
    let e = libSel ? entryByKey(libSel) : null;
    if (!e) { const k = S.propId === 'glb' ? 'model:' + S.assetId : S.propId === 'prefab' ? 'prefab:' + S.prefabId : 'prop:' + S.propId; e = entryByKey(k); }
    if (!e) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    const t = thumbOf(e), K = assetsMod.KINDS[e.kind];
    const rows = [];
    if (e.kind === 'prop') { const p = e.ref; rows.push(['Type', p.fxKind ? 'Effect emitter' : p.marker ? 'Gameplay marker' : 'Procedural prop']); rows.push(['Collision', p.col === false ? 'none' : 'solid']); if (p.tint) rows.push(['Tint', 'yes — Tint row below']); if (p.fx) rows.push(['Effect', p.fx.kind + ' (built in)']); rows.push(['Placed', S.map.objects.filter(o => o.t === p.id).length]); }
    if (e.kind === 'model') { const a = e.ref; rows.push(['Source', a.data ? 'embedded · ' + (assetBytes(a) / 1024).toFixed(0) + ' KB' : a.url]); if (a.anims && a.anims.length) rows.push(['Clips', a.anims.join(', ')]); const tpl = tplCache.get(a.id); if (tpl) { const bb = new THREE.Box3().setFromObject(tpl), sz = new THREE.Vector3(); bb.getSize(sz); let tris = 0; tpl.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry; tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0); } }); rows.push(['Size', sz.x.toFixed(2) + ' × ' + sz.y.toFixed(2) + ' × ' + sz.z.toFixed(2) + ' m']); rows.push(['Triangles', Math.round(tris).toLocaleString()]); } rows.push(['Placed', S.map.objects.filter(o => o.t === 'glb' && o.a === a.id).length]); }
    if (e.kind === 'project') { rows.push(['Source', e.url]); if (e.ref.anims && e.ref.anims.length) rows.push(['Clips', e.ref.anims.join(', ')]); rows.push(['In map', S.map.assets.find(a => a.url === e.url) ? 'yes' : 'no — click to add']); }
    if (e.kind === 'prefab') { rows.push(['Parts', e.ref.objects.map(o => (PROP_BY_ID[o.t] || {}).label || o.t).slice(0, 8).join(', ') + (e.ref.objects.length > 8 ? '…' : '')]); rows.push(['Placed', S.map.objects.filter(o => o.t === 'prefab' && o.pf === e.id).length]); }
    if (e.kind === 'shelf') rows.push(['Parts', (e.ref.objects || []).length + ' · on this device, not yet in this map']);
    if (e.kind === 'sound' || e.kind === 'psound') rows.push(['Source', e.url]);
    if (e.kind === 'cloud' || e.kind === 'csound') { rows.push(['File', e.ref.name]); rows.push(['Size', e.ref.size ? (e.ref.size / 1024).toFixed(0) + ' KB' : '?']); rows.push(['Source', e.url]); rows.push(['In map', e.inMap ? 'yes' : 'no — click to add']); }
    const editableTags = e.kind === 'model' || e.kind === 'prefab';
    const acts = [];
    acts.push('<button data-act="fav" class="' + (prefs.isFav(e.key) ? 'on' : '') + '">★ Favourite</button>');
    if (['model', 'sound', 'prefab', 'shelf', 'cloud', 'csound'].includes(e.kind)) acts.push('<button data-act="rename" title="F2">✎ Rename</button>');
    if ((e.kind === 'cloud' || e.kind === 'csound') && !e.inMap) acts.push('<button data-act="pick" class="primary">＋ Add to map</button>');
    if (e.kind === 'cloud' || e.kind === 'csound') acts.push('<button data-act="rmcloud" class="danger">✕ Delete from cloud</button>');
    if (e.kind === 'model') { if (e.ref.data) acts.push('<button data-act="relink">↗ Relink</button>'); acts.push('<button data-act="rmmodel" class="danger">✕ Remove</button>'); }
    if (e.kind === 'project' && !S.map.assets.find(a => a.url === e.url)) acts.push('<button data-act="pick" class="primary">＋ Add to map</button>');
    if (e.kind === 'prefab') { acts.push('<button data-act="shelf">📚 Shelf</button>'); acts.push('<button data-act="rmprefab" class="danger">✕ Delete</button>'); }
    if (e.kind === 'shelf') { acts.push('<button data-act="pick" class="primary">＋ Add to map</button>'); acts.push('<button data-act="rmshelf" class="danger">✕ Forget</button>'); }
    if (e.kind === 'sound') { acts.push('<button data-act="play">▶ Preview</button>'); acts.push('<button data-act="rmsound" class="danger">✕ Remove</button>'); }
    if (e.kind === 'psound') acts.push(S.map.sounds.find(s => s.url === e.url) ? '<button data-act="play">▶ Preview</button>' : '<button data-act="pick" class="primary">＋ Add to map</button>');
    box.innerHTML = '<div class="mf-dhead">' + (t.img ? '<img class="th" src="' + t.img + '" alt="">' : '<span class="th ic">' + e.icon + '</span>') + '<div><div class="nm">' + esc(e.label) + '</div><div class="kd">' + esc(K.label) + ' · ' + esc(K.source) + '</div></div></div>'
      + '<div class="mf-dtags">' + e.tags.filter(x => !/^\d+ parts$/.test(x)).map(x => '<button data-tag="' + esc(x) + '">' + esc(x) + '</button>').join('') + (editableTags ? '<input type="text" id="mf-dtag-in" placeholder="add tags, comma-separated" value="' + esc((e.ref.tags || []).join(', ')) + '">' : '') + '</div>'
      + (rows.length ? '<table class="mf-dtable">' + rows.map(r => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>' : '')
      + '<div class="mf-btns">' + acts.join('') + '</div>';
    box.querySelectorAll('.mf-dtags button').forEach(b => b.onclick = () => { libTag = b.dataset.tag; if (!(libQ.trim() || libCat === 'All' || libCat === '★')) libCat = 'All'; renderLibrary(); });
    const tin = box.querySelector('#mf-dtag-in');
    if (tin) tin.onchange = () => { beginObjectEdit(); const tags = normalizeTags(tin.value); if (tags.length) e.ref.tags = tags; else delete e.ref.tags; endObjectEdit(); setDirty(true); renderLibrary(); };
    box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'fav') { prefs.toggleFav(e.key); renderLibrary(); }
      else if (act === 'pick') pickEntry(e);
      else if (act === 'relink') relinkAsset(e.id);
      else if (act === 'rmmodel') { libSel = null; prefs.forget(e.key); removeAsset(e.id); }
      else if (act === 'rename') renameEntry(e);
      else if (act === 'rmcloud') removeCloudFile(e);
      else if (act === 'shelf') shelfSave(e.id);
      else if (act === 'rmprefab') askConfirm('Delete this prefab and every placed instance?').then(ok => { if (ok) { libSel = null; prefs.forget(e.key); deletePrefab(e.id); } });
      else if (act === 'rmshelf') { libSel = null; prefs.forget(e.key); shelfRemove(e.id); }
      else if (act === 'play') previewSound(e.url);
      else if (act === 'rmsound') { beginObjectEdit(); S.map.sounds = S.map.sounds.filter(y => y.id !== e.id); endObjectEdit(); setDirty(true); libSel = null; prefs.forget(e.key); renderLibrary(); }
    });
  }
  ED.library = { get index() { return libIndex; }, search: (q, f) => assetsMod.search(rebuildIndex(), q, f), pick: (key) => pickEntry(entryByKey(key)), setQuery(q) { libQ = String(q || ''); renderLibrary(); }, setCat(c) { libCat = c; libTag = ''; renderLibrary(); }, get selected() { return libSel; }, prefs, thumb: (key) => { const e = entryByKey(key); return e ? thumbOf(e) : null; } };
  function renderInspector() {
    const box = $('#mf-inspector'); const o = objById(S.selectedId);
    if (!o) { box.innerHTML = '<div class="mf-empty">Nothing selected. Use <b>Select</b> (1) and click an object, or pick a prop from the Library and click the ground to place it.</div>'; return; }
    const meta = PROP_BY_ID[o.t] || { label: o.t === 'glb' ? 'Model' : o.t, icon: o.t === 'glb' ? '🧊' : '🧩' };
    const label = o.t === 'glb' ? ((S.map.assets.find(a => a.id === o.a) || {}).label || 'Model') : meta.label;
    const slot = o.k ? (slotMeta(o.k) || { k: o.k, label: o.k, icon: '🧩' }) : null;
    const pf = o.t === 'prefab' ? prefabById(o.pf) : null;
    const ids = selectedIds(); const multiN = ids.length;
    if (multiN > 1) {
      box.innerHTML = `<div class="mf-row"><label>Selected</label><div style="flex:1;color:#cfc7ad">${multiN} objects</div></div>
        <div class="mf-row"><label>Folder</label><select id="mf-m-folder">${folderOptions('')}</select></div>
        <div class="mf-pf"><div class="mf-row" style="margin-bottom:5px"><label>Prefab</label><span class="st">📦 Group them into a reusable prefab</span></div>
          <div class="mf-btns"><input type="text" id="mf-pf-name" placeholder="Prefab name" maxlength="60" style="flex:2"><button id="mf-pf-create" class="primary">📦 Create prefab</button></div></div>
        ${S.editingPrefab ? '<div class="mf-btns" style="margin-top:6px"><button id="mf-pf-apply" class="primary">⤴ Apply to prefab "' + esc(S.editingPrefab.name) + '"</button><button id="mf-pf-cancel">Stop editing</button></div>' : ''}
        <div class="mf-btns" style="margin-top:8px"><button id="mf-m-dup">⧉ Duplicate all</button><button id="mf-m-del" class="danger">✕ Delete all</button></div>
        <p class="mf-hint">Ctrl/Shift+click adds to the selection. The gizmo moves the last-clicked object.</p>`;
      box.querySelector('#mf-m-folder').onchange = (e) => moveToFolder(ids, e.target.value || null);
      box.querySelector('#mf-pf-create').onclick = () => createPrefab(ids, box.querySelector('#mf-pf-name').value);
      box.querySelector('#mf-m-dup').onclick = duplicateSelected; box.querySelector('#mf-m-del').onclick = deleteSelected;
      const ap = box.querySelector('#mf-pf-apply'); if (ap) ap.onclick = applyPrefab;
      const cn = box.querySelector('#mf-pf-cancel'); if (cn) cn.onclick = () => { S.editingPrefab = null; renderInspector(); };
      return;
    }
    const deg = (r) => Math.round(r * 180 / Math.PI * 10) / 10;
    const f = (v) => Math.round(v * 100) / 100;
    box.innerHTML = `
      <div class="mf-row"><label>Name</label><input type="text" id="mf-o-name" value="${esc(o.n || '')}" placeholder="${esc(label)}" maxlength="60"></div>
      <div class="mf-row"><label>Type</label><div style="flex:1;color:#cfc7ad">${pf ? '🧱 Prefab instance' : (meta.icon || '') + ' ' + esc(label)}</div></div>
      <div class="mf-row"><label>Folder</label><select id="mf-o-folder">${folderOptions(o.f || '')}</select></div>
      ${pf ? `<div class="mf-pf"><div class="mf-row" style="margin-bottom:5px"><label>Prefab</label><span class="st">📦 ${esc(pf.name)} <small>${pf.objects.length} part${pf.objects.length === 1 ? '' : 's'} · ${S.map.objects.filter(x => x.t === 'prefab' && x.pf === pf.id).length} placed</small></span></div>
        <div class="mf-btns"><button id="mf-pf-edit" class="primary">✎ Edit prefab</button><button id="mf-pf-unpack">⤵ Unpack</button><button id="mf-pf-shelf" title="Keep on this device for other maps">📚 Shelf</button></div>
        <p class="mf-hint" style="margin:6px 0 0">Edit unpacks the pieces here; <b>Apply</b> afterwards rewrites the prefab and every instance follows. Unpack just breaks the link.</p></div>` : (o.t !== 'slot' ? `<div class="mf-pf"><div class="mf-btns"><input type="text" id="mf-pf-name" placeholder="Prefab name" maxlength="60" style="flex:2"><button id="mf-pf-create">📦 Make prefab</button></div>${S.editingPrefab ? '<div class="mf-btns" style="margin-top:6px"><button id="mf-pf-apply" class="primary">⤴ Apply to prefab "' + esc(S.editingPrefab.name) + '"</button><button id="mf-pf-cancel">Stop editing</button></div>' : ''}</div>` : '')}
      ${o.t === 'spline' ? renderSplineSection(o) : ''}
      ${o.t !== 'slot' ? renderBpSection(o) : ''}
      ${slot ? `<div class="mf-slot"><div class="mf-row" style="margin-bottom:5px"><label>Game slot</label><span class="st">${slot.icon || '🧩'} ${esc(slot.label)} <small>(${esc(o.k)})</small></span></div>
        ${o.t === 'slot' ? '<p class="mf-hint" style="margin:0 0 6px">The game draws its own asset here; move, turn or scale it and the game follows. To swap the asset, pick a prop or model in the Library, then:</p>' : '<p class="mf-hint" style="margin:0 0 6px">Replaced — the game draws <b>' + esc(label) + '</b> in place of its own asset.</p>'}
        <div class="mf-btns"><button id="mf-o-slot-replace" class="primary">⇄ Replace with ${esc(propLabel())}</button>${o.t !== 'slot' ? '<button id="mf-o-slot-restore">↺ Restore game asset</button>' : ''}</div></div>` : ''}
      <div class="mf-row3"><label>Position</label><input type="number" step="0.1" data-f="p" data-i="0" value="${f(o.p[0])}"><input type="number" step="0.1" data-f="p" data-i="1" value="${f(o.p[1])}"><input type="number" step="0.1" data-f="p" data-i="2" value="${f(o.p[2])}"></div>
      <div class="mf-row3"><label>Rotation°</label><input type="number" step="5" data-f="r" data-i="0" value="${deg(o.r[0])}"><input type="number" step="5" data-f="r" data-i="1" value="${deg(o.r[1])}"><input type="number" step="5" data-f="r" data-i="2" value="${deg(o.r[2])}"></div>
      <div class="mf-row3"><label>Scale</label><input type="number" step="0.1" min="0.01" data-f="s" data-i="0" value="${f(o.s[0])}"><input type="number" step="0.1" min="0.01" data-f="s" data-i="1" value="${f(o.s[1])}"><input type="number" step="0.1" min="0.01" data-f="s" data-i="2" value="${f(o.s[2])}"></div>
      <div class="mf-row"><label>Uniform</label><input type="range" id="mf-o-uni" min="0.05" max="6" step="0.05" value="${Math.max(0.05, Math.min(6, o.s[0]))}"><span class="v" id="mf-o-uni-v">${f(o.s[0])}×</span></div>
      ${meta.tint ? `<div class="mf-row"><label>Tint</label><input type="color" id="mf-o-tint" value="${o.c || '#ffffff'}"><button id="mf-o-untint" style="flex:1">Default colour</button></div>` : ''}
      <div class="mf-row"><label>Grounded</label><input type="checkbox" id="mf-o-ground" ${o.g ? 'checked' : ''}><span class="mf-hint" style="margin:0">follows the terrain height</span></div>
      ${(meta.fxKind || meta.fx) ? (() => { const f = o.fx || { i: 1, s: 1 }; const built = !!meta.fx; return `
      <div class="mf-fx"><div class="mf-row" style="margin-bottom:5px"><label>Effect</label><span class="st">✨ ${esc(meta.fxKind ? (PROP_BY_ID[o.t].label) : meta.fx.kind)}${built ? ' (built in)' : ''}</span>${built ? '<input type="checkbox" id="mf-o-fxon" ' + (f.off ? '' : 'checked') + ' title="Effect on/off">' : ''}</div>
        <div class="mf-row"><label>Intensity</label><input type="range" id="mf-o-fxi" min="0.1" max="4" step="0.1" value="${f.i}"><span class="v" id="mf-o-fxi-v">${f.i.toFixed(1)}×</span></div>
        <div class="mf-row"><label>Size</label><input type="range" id="mf-o-fxs" min="0.2" max="6" step="0.1" value="${f.s}"><span class="v" id="mf-o-fxs-v">${f.s.toFixed(1)}×</span></div>
        ${meta.fxKind ? '<div class="mf-row"><label>Tint</label><input type="color" id="mf-o-fxc" value="' + (o.c || '#ff8a1a') + '"><button id="mf-o-fxuntint" style="flex:1">Default colour</button></div>' : ''}
      </div>`; })() : ''}
      ${(o.t !== 'slot' && o.t !== 'spline' && !o.t.startsWith('fx_') && !(meta.marker)) ? (() => { const mt = o.mat || {}; return `
      <div class="mf-mat"><div class="mf-row" style="margin-bottom:5px"><label>Material</label><span class="st">🎨 ${o.mat ? 'override' : 'prop default'}</span>${o.mat ? '<button id="mf-o-mat-reset" class="small">Reset</button>' : ''}</div>
        <div class="mf-row"><label>Roughness</label><input type="range" id="mf-o-rough" min="0" max="1" step="0.02" value="${mt.rough == null ? 0.85 : mt.rough}"><span class="v" id="mf-o-rough-v">${(mt.rough == null ? 0.85 : mt.rough).toFixed(2)}</span></div>
        <div class="mf-row"><label>Metalness</label><input type="range" id="mf-o-metal" min="0" max="1" step="0.02" value="${mt.metal == null ? 0 : mt.metal}"><span class="v" id="mf-o-metal-v">${(mt.metal == null ? 0 : mt.metal).toFixed(2)}</span></div>
        <div class="mf-row"><label>Emissive</label><input type="color" id="mf-o-em" value="${mt.em || '#000000'}"><input type="range" id="mf-o-ei" min="0" max="8" step="0.1" value="${mt.ei == null ? 1 : mt.ei}" title="Emissive intensity"><span class="v" id="mf-o-ei-v">${(mt.ei == null ? 1 : mt.ei).toFixed(1)}×</span></div>
      </div>`; })() : ''}
      <div class="mf-col ${world.isSolid(o) ? 'solid' : ''}">
        <div class="mf-row" style="margin-bottom:5px"><label>Collision</label><span class="st">${world.isSolid(o) ? '● Solid — blocks the player' : '○ None — walk through'}</span></div>
        <div class="mf-btns">${world.isSolid(o) ? '<button id="mf-o-col-off">－ Remove collision</button>' : '<button id="mf-o-col-on" class="primary">＋ Add collision</button>'}<select id="mf-o-cs" ${world.isSolid(o) ? '' : 'disabled'}><option value="box" ${o.cs !== 'cyl' ? 'selected' : ''}>Box</option><option value="cyl" ${o.cs === 'cyl' ? 'selected' : ''}>Cylinder</option></select></div>
      </div>
      ${o.t === 'glb' ? (() => { const clips = world.clipsOf(o.id); const known = clips.length ? clips : ((S.map.assets.find(a => a.id === o.a) || {}).anims || []); const cur = o.anim && o.anim.clip; return `
      <div class="mf-anim"><div class="mf-row" style="margin-bottom:4px"><label>Animations</label><span class="st">🎞 ${known.length} clip${known.length === 1 ? '' : 's'}${o.anim && o.anim.src ? ' · + file' : ''}</span></div>
        ${known.length ? '<div class="mf-clips">' + known.map(c => '<button data-clip="' + esc(c) + '" class="' + (c === cur ? 'on' : '') + '" title="Play ' + esc(c) + '">▶ ' + esc(c) + '</button>').join('') + '</div>' : ''}
        <div class="mf-btns"><button id="mf-o-upanim">⤒ Upload animation for this model</button><button id="mf-o-pickanim" title="Choose an uploaded animation in the Files tab">🎞 From Files</button><input type="file" id="mf-o-animfile" accept=".glb,.gltf" hidden></div>
      </div>` + (known.length ? `
      <div class="mf-row"><label>Animation</label><select id="mf-o-anim"><option value="">— none —</option>${known.map(c => '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>').join('')}</select></div>
      <div class="mf-row"><label>Speed</label><input type="range" id="mf-o-aspeed" min="0" max="4" step="0.05" value="${o.anim ? o.anim.speed : 1}"><span class="v" id="mf-o-aspeed-v">${(o.anim ? o.anim.speed : 1).toFixed(2)}×</span></div>
      <div class="mf-row"><label>Loop</label><select id="mf-o-aloop">${LOOP_MODES.map(l => '<option value="' + l + '"' + (o.anim && o.anim.loop === l ? ' selected' : '') + '>' + l + '</option>').join('')}</select></div>` : (world.objects.get(o.id) && world.objects.get(o.id).userData.mfPending ? '<p class="mf-hint">Loading model…</p>' : '<p class="mf-hint">This model has no animation clips of its own — upload an animation file for it.</p>')); })() : ''}
      ${o.t === 'audio' ? (() => { const au = o.au || { url: '', vol: 1, r: 20, loop: true }; return `
      <div class="mf-fx"><div class="mf-row" style="margin-bottom:5px"><label>Sound</label><span class="st" title="${esc(au.url)}">🔊 ${au.url ? esc(au.url.split('/').pop().replace(/^[a-z0-9]+_/, '')) : 'no file — pick one in Files'}</span></div>
        <div class="mf-row"><label>Volume</label><input type="range" id="mf-o-auv" min="0" max="1" step="0.05" value="${au.vol}"><span class="v" id="mf-o-auv-v">${Math.round(au.vol * 100)}%</span></div>
        <div class="mf-row"><label>Range</label><input type="range" id="mf-o-aur" min="1" max="200" step="1" value="${au.r}"><span class="v" id="mf-o-aur-v">${au.r} m</span></div>
        <div class="mf-row"><label>Loop</label><input type="checkbox" id="mf-o-aul" ${au.loop !== false ? 'checked' : ''}><span class="mf-hint" style="margin:0">plays in Play mode and in the game</span></div>
      </div>`; })() : ''}
      ${!(PROP_BY_ID[o.t] && PROP_BY_ID[o.t].marker && o.t !== 'zone') && !o.t.startsWith('fx_') ? (() => { const act = o.act || { kind: 'none' }; const hubs = bridgeHubs(), gl = bridgeGuides(), games = miniGames(); const opt = (list, cur, idk, namek) => list.map(x => '<option value="' + esc(x[idk]) + '"' + (x[idk] === cur ? ' selected' : '') + '>' + esc(x[namek] || x[idk]) + '</option>').join(''); return `
      <div class="mf-act ${act.kind !== 'none' ? 'on' : ''}"><div class="mf-row" style="margin-bottom:5px"><label>Interaction</label><select id="mf-o-act"><option value="none" ${act.kind === 'none' ? 'selected' : ''}>${o.t === 'zone' ? 'Map default (Menu tab)' : 'None'}</option><option value="screen" ${act.kind === 'screen' ? 'selected' : ''}>Enter → open a screen</option><option value="hub" ${act.kind === 'hub' ? 'selected' : ''}>Enter → open a menu</option><option value="guide" ${act.kind === 'guide' ? 'selected' : ''}>Talk → play a guide</option></select></div>
        ${act.kind === 'screen' ? '<div class="mf-row"><label>Screen</label><select id="mf-o-act-target"><option value="">— pick —</option>' + opt(games, act.target, 'id', 'name') + '</select></div>' : ''}
        ${act.kind === 'hub' ? '<div class="mf-row"><label>Menu</label><select id="mf-o-act-hub">' + opt(hubs, act.hub || 'main', 'id', 'name') + '</select></div>' : ''}
        ${act.kind === 'guide' ? '<div class="mf-row"><label>Guide</label><select id="mf-o-act-guide"><option value="">— pick —</option>' + opt(gl, act.guide, 'id', 'title') + '</select></div>' : ''}
        ${act.kind !== 'none' ? '<div class="mf-row"><label>Prompt</label><input type="text" id="mf-o-act-prompt" maxlength="40" value="' + esc(act.prompt || '') + '" placeholder="' + (act.kind === 'guide' ? 'Talk' : 'Enter') + '"></div>' + (o.t === 'zone' ? '<div class="mf-row"><label>Trigger</label><input type="checkbox" id="mf-o-act-auto" ' + (act.auto === false ? '' : 'checked') + '><span class="mf-hint" style="margin:0">fires on entry (off: press E inside)</span></div>' : '') : ''}
        <p class="mf-hint">${o.t === 'zone' ? 'Walking into the zone runs this.' : 'Standing beside it and pressing <b>E</b> runs this.'}</p>
      </div>`; })() : ''}
      <div class="mf-btns" style="margin-top:8px"><button id="mf-o-drop">⤓ Drop to ground</button><button id="mf-o-dup">⧉ Duplicate</button><button id="mf-o-focus">◎ Focus</button><button id="mf-o-del" class="danger">✕ Delete</button></div>`;
    const commit = (fn) => { beginObjectEdit(); fn(); world.refreshObject(o); if (gizmo && gizmo.object) gizmo.object.updateMatrixWorld(); endObjectEdit(); setDirty(true); };
    box.querySelectorAll('input[data-f]').forEach(inp => inp.onchange = () => commit(() => {
      const v = parseFloat(inp.value); if (!Number.isFinite(v)) return;
      const fld = inp.dataset.f, i = +inp.dataset.i;
      if (fld === 'r') o.r[i] = v * Math.PI / 180; else if (fld === 's') o.s[i] = Math.max(0.01, v); else { o.p[i] = v; if (i === 1) o.g = false; }
    }));
    const uni = box.querySelector('#mf-o-uni');
    uni.oninput = () => { const v = parseFloat(uni.value); o.s = [v, v, v]; world.refreshObject(o); box.querySelector('#mf-o-uni-v').textContent = f(v) + '×'; box.querySelectorAll('input[data-f="s"]').forEach(x => x.value = f(v)); setDirty(true); };
    uni.onpointerdown = () => beginObjectEdit(); uni.onchange = () => endObjectEdit();
    box.querySelector('#mf-o-name').onchange = (e) => commit(() => { o.n = e.target.value.trim().slice(0, 60) || undefined; });
    box.querySelector('#mf-o-folder').onchange = (e) => moveToFolder([o.id], e.target.value || null);
    const pfe = box.querySelector('#mf-pf-edit'); if (pfe) pfe.onclick = () => unpackPrefab(o.id, true);
    const pfu = box.querySelector('#mf-pf-unpack'); if (pfu) pfu.onclick = () => unpackPrefab(o.id, false);
    const pfs = box.querySelector('#mf-pf-shelf'); if (pfs) pfs.onclick = () => shelfSave(o.pf);
    const pfc = box.querySelector('#mf-pf-create'); if (pfc) pfc.onclick = () => createPrefab([o.id], box.querySelector('#mf-pf-name').value);
    const pfa = box.querySelector('#mf-pf-apply'); if (pfa) pfa.onclick = applyPrefab;
    const pfx = box.querySelector('#mf-pf-cancel'); if (pfx) pfx.onclick = () => { S.editingPrefab = null; renderInspector(); };
    wireBpSection(box, o);
    if (o.t === 'spline') wireSplineSection(box, o);
    const sr = box.querySelector('#mf-o-slot-replace'); if (sr) sr.onclick = () => replaceSlot(o);
    const ss = box.querySelector('#mf-o-slot-restore'); if (ss) ss.onclick = () => restoreSlot(o);
    const tint = box.querySelector('#mf-o-tint'); if (tint) { tint.oninput = () => { o.c = tint.value; world.refreshObject(o); setDirty(true); }; tint.onpointerdown = () => beginObjectEdit(); tint.onchange = () => endObjectEdit(); box.querySelector('#mf-o-untint').onclick = () => commit(() => { delete o.c; }); }
    box.querySelector('#mf-o-ground').onchange = (e) => commit(() => { o.g = e.target.checked; if (o.g) o.p[1] = world.heightAt(o.p[0], o.p[2]); });
    if (o.t === 'glb') {
      const applyClip = (clip, src) => { beginObjectEdit(); o.anim = clip ? { clip, speed: (o.anim && o.anim.speed) || 1, loop: (o.anim && o.anim.loop) || 'repeat', src: src || (o.anim && o.anim.src) || undefined } : undefined; const okp = world.setAnim(o.id, o.anim); endObjectEdit(); setDirty(true); renderInspector(); if (clip && okp === false) toast('That clip does not fit this model\'s skeleton.', 3600); };
      box.querySelectorAll('[data-clip]').forEach(b => { b.onclick = () => applyClip(b.dataset.clip === (o.anim && o.anim.clip) ? '' : b.dataset.clip); });
      const upb = box.querySelector('#mf-o-upanim'), pkb = box.querySelector('#mf-o-pickanim'), fin = box.querySelector('#mf-o-animfile');
      if (upb) upb.onclick = () => fin.click();
      if (fin) fin.onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const r = await assetsApi.upload(f, { inspect: inspectFile, kind: 'anim' }); if (!ED) return; if (!r.ok) { toast(r.missing ? 'The files table is not set up yet — run sql/112_world_assets.sql.' : 'Upload failed: ' + (r.error || 'unknown error'), 5200); return; } filesCache = null; select(o.id); useFile(r.row); };
      if (pkb) pkb.onclick = () => { filesFilter = 'anim'; showTab('files'); toast('Pick an animation — ▶ Apply puts it on the selected model.', 3600); };
    }
    const animSel = box.querySelector('#mf-o-anim');
    if (animSel) {
      const applyAnim = () => { const clip = animSel.value; o.anim = clip ? { clip, speed: +box.querySelector('#mf-o-aspeed').value, loop: box.querySelector('#mf-o-aloop').value, src: (o.anim && o.anim.src) || undefined } : undefined; world.setAnim(o.id, o.anim); box.querySelector('#mf-o-aspeed-v').textContent = (+box.querySelector('#mf-o-aspeed').value).toFixed(2) + '×'; };
      animSel.onchange = () => commit(applyAnim);
      box.querySelector('#mf-o-aloop').onchange = () => commit(applyAnim);
      const sp = box.querySelector('#mf-o-aspeed'); sp.oninput = () => { applyAnim(); setDirty(true); }; sp.onpointerdown = () => beginObjectEdit(); sp.onchange = () => endObjectEdit();
    }
    box.querySelector('#mf-o-drop').onclick = () => commit(() => { o.p[1] = world.heightAt(o.p[0], o.p[2]); });
    const auv = box.querySelector('#mf-o-auv');
    if (auv) {
      const aur = box.querySelector('#mf-o-aur'), aul = box.querySelector('#mf-o-aul');
      const applyAu = () => { o.au = Object.assign(o.au || { url: '' }, { vol: +auv.value, r: +aur.value, loop: aul.checked }); box.querySelector('#mf-o-auv-v').textContent = Math.round(+auv.value * 100) + '%'; box.querySelector('#mf-o-aur-v').textContent = aur.value + ' m'; world.refreshObject(o); setDirty(true); };
      [auv, aur].forEach(el => { el.onpointerdown = () => beginObjectEdit(); el.oninput = applyAu; el.onchange = () => endObjectEdit(); });
      aul.onchange = () => { beginObjectEdit(); applyAu(); endObjectEdit(); };
    }
    const actSel = box.querySelector('#mf-o-act');
    if (actSel) {
      const applyAct = () => {
        const kind = actSel.value; const cur = o.act || {};
        const raw = kind === 'none' ? null : { kind, prompt: (box.querySelector('#mf-o-act-prompt') || {}).value || cur.prompt || '', target: (box.querySelector('#mf-o-act-target') || {}).value || cur.target || '', hub: (box.querySelector('#mf-o-act-hub') || {}).value || cur.hub || 'main', guide: (box.querySelector('#mf-o-act-guide') || {}).value || cur.guide || '', auto: box.querySelector('#mf-o-act-auto') ? box.querySelector('#mf-o-act-auto').checked : cur.auto !== false };
        o.act = normalizeAct(raw);
      };
      const onAct = () => { beginObjectEdit(); applyAct(); endObjectEdit(); setDirty(true); renderInspector(); };
      actSel.onchange = onAct;
      ['#mf-o-act-target', '#mf-o-act-hub', '#mf-o-act-guide', '#mf-o-act-prompt', '#mf-o-act-auto'].forEach(id => { const el = box.querySelector(id); if (el) el.onchange = onAct; });
    }
    const fxi = box.querySelector('#mf-o-fxi');
    if (fxi) {
      const fxs = box.querySelector('#mf-o-fxs'), fxon = box.querySelector('#mf-o-fxon'), fxc = box.querySelector('#mf-o-fxc');
      const applyFx = () => { o.fx = { i: +fxi.value, s: +fxs.value }; if (fxon && !fxon.checked) o.fx.off = true; box.querySelector('#mf-o-fxi-v').textContent = (+fxi.value).toFixed(1) + '×'; box.querySelector('#mf-o-fxs-v').textContent = (+fxs.value).toFixed(1) + '×'; world.refreshFx(o.id); setDirty(true); };
      [fxi, fxs].forEach(el => { el.onpointerdown = () => beginObjectEdit(); el.oninput = applyFx; el.onchange = () => endObjectEdit(); });
      if (fxon) fxon.onchange = () => { beginObjectEdit(); applyFx(); endObjectEdit(); };
      if (fxc) { fxc.onpointerdown = () => beginObjectEdit(); fxc.oninput = () => { o.c = fxc.value; world.refreshFx(o.id); setDirty(true); }; fxc.onchange = () => endObjectEdit(); box.querySelector('#mf-o-fxuntint').onclick = () => commit(() => { delete o.c; world.refreshFx(o.id); }); }
    }
    const rough = box.querySelector('#mf-o-rough');
    if (rough) {
      const metal = box.querySelector('#mf-o-metal'), em = box.querySelector('#mf-o-em'), ei = box.querySelector('#mf-o-ei');
      const applyM = () => { const m = { rough: +rough.value, metal: +metal.value }; if (em.value !== '#000000') { m.em = em.value; m.ei = +ei.value; } o.mat = m; world.refreshMat(o.id); box.querySelector('#mf-o-rough-v').textContent = (+rough.value).toFixed(2); box.querySelector('#mf-o-metal-v').textContent = (+metal.value).toFixed(2); box.querySelector('#mf-o-ei-v').textContent = (+ei.value).toFixed(1) + '×'; setDirty(true); };
      [rough, metal, ei, em].forEach(el => { el.onpointerdown = () => beginObjectEdit(); el.oninput = applyM; el.onchange = () => { endObjectEdit(); renderInspector(); }; });
      const rs = box.querySelector('#mf-o-mat-reset'); if (rs) rs.onclick = () => commit(() => { delete o.mat; world.refreshMat(o.id); });
    }
    const colOn = box.querySelector('#mf-o-col-on'), colOff = box.querySelector('#mf-o-col-off'), cs = box.querySelector('#mf-o-cs');
    if (colOn) colOn.onclick = () => { beginObjectEdit(); world.setCollision(o.id, true); endObjectEdit(); setDirty(true); renderInspector(); toast('Collision added — it now blocks the player in Play.'); };
    if (colOff) colOff.onclick = () => { beginObjectEdit(); world.setCollision(o.id, false); endObjectEdit(); setDirty(true); renderInspector(); toast('Collision removed — the player walks through it.'); };
    cs.onchange = () => { beginObjectEdit(); world.setCollision(o.id, null, cs.value); endObjectEdit(); setDirty(true); };
    box.querySelector('#mf-o-dup').onclick = duplicateSelected;
    box.querySelector('#mf-o-focus').onclick = focusSelected;
    box.querySelector('#mf-o-del').onclick = () => { beginObjectEdit(); removeObject(o.id); endObjectEdit(); select(null); };
  }
  function renderStats() {
    const m = S.map; if (!m) return;
    if (tabOn('scene')) renderSceneTab();
    const nb = m.objects.filter(hasBehaviour).length;
    $('#mf-hud-stats').innerHTML = '<b>' + m.objects.length + '</b> objects · <b>' + (m.folders || []).length + '</b> folders · <b>' + (m.prefabs || []).length + '</b> prefabs' + (nb ? ' · <b>' + nb + '</b> ⚡' : '') + ' · <b>' + m.terrain.n + '×' + m.terrain.n + '</b> · ' + (m.terrain.n * m.terrain.cell) + 'm';
    renderOutliner();
  }
  function renderTerrainTab() {
    const t = S.map.terrain; $('#mf-t-n').value = t.n; $('#mf-t-cell').value = t.cell;
    $('#mf-t-size').textContent = (t.n * t.cell) + ' m × ' + (t.n * t.cell) + ' m';
    $('#mf-t-grid').checked = S.showGrid; $('#mf-t-markers').checked = S.showMarkers; $('#mf-t-nav').checked = S.showNav;
  }
  function renderWaterTab() {
    const w = S.map.water; $('#mf-w-on').checked = w.on; $('#mf-w-level').value = w.level; $('#mf-w-level-v').textContent = w.level.toFixed(1) + 'm';
    $('#mf-w-color').value = w.color; $('#mf-w-opacity').value = w.opacity; $('#mf-w-opacity-v').textContent = Math.round(w.opacity * 100) + '%';
    $('#mf-w-wave').value = w.wave; $('#mf-w-wave-v').textContent = w.wave.toFixed(2); $('#mf-w-speed').value = w.speed; $('#mf-w-speed-v').textContent = w.speed.toFixed(1) + '×';
  }
  function renderSkyTab() {
    const e = S.map.env; $('#mf-e-preset').value = e.preset;
    ['skyTop', 'skyBottom', 'fogColor', 'sunColor', 'ambient', 'groundColor'].forEach(k => { $('#mf-e-' + k).value = e[k]; });
    [['fogNear', 0], ['fogFar', 0], ['sunEl', 0], ['sunAz', 0], ['sunIntensity', 2], ['ambientIntensity', 2], ['weatherIntensity', 1], ['windDir', 0], ['windSpeed', 1], ['exposure', 2], ['bloom', 2], ['bloomThreshold', 2], ['vignette', 2], ['terrainDetail', 2], ['terrainTile', 2]].forEach(([k, d]) => { $('#mf-e-' + k).value = e[k]; $('#mf-e-' + k + '-v').textContent = (+e[k]).toFixed(d) + (k === 'windDir' ? '°' : k === 'windSpeed' ? ' m/s' : k === 'weatherIntensity' ? '×' : k === 'terrainTile' ? '/m' : ''); });
    $('#mf-e-tone').value = e.tone || 'aces';
    $('#mf-e-weather').value = e.weather || 'none';
    $('#mf-e-shadows').checked = e.shadows !== false;
  }
  async function renderMapsTab() {
    const list = $('#mf-maps'); list.innerHTML = '<div class="mf-empty">Loading…</div>';
    const r = await api.listMaps();
    if (!ED) return;
    $('#mf-storage').textContent = r.cloudOk ? '☁ Cloud maps on · signed in as ' + displayName() : r.offline ? '💾 Not signed in — maps save on this device only' : r.cloudMissing ? '💾 Cloud table not set up yet (run sql/091_world_maps.sql) — saving on this device' : '⚠ Cloud unavailable: ' + (r.error || '') + ' — saving on this device';
    if (!r.rows.length) { list.innerHTML = '<div class="mf-empty">No saved maps yet. Build something and press Save.</div>'; return; }
    const games = Array.from(new Set(r.rows.map(x => x.game || 'sandbox').concat([S.map.game || 'sandbox']))).sort();
    setGameField(S.map.game || 'sandbox', games);
    const onlyMine = $('#mf-maps-game').checked, curGame = S.map.game || 'sandbox';
    const rows = onlyMine ? r.rows.filter(x => (x.game || 'sandbox') === curGame) : r.rows;
    const byGame = {}; rows.forEach(x => { (byGame[x.game || 'sandbox'] = byGame[x.game || 'sandbox'] || []).push(x); });
    list.innerHTML = Object.keys(byGame).sort().map(g => '<div class="mf-gamehead">🎮 ' + esc(g) + '</div>' + byGame[g].map(row => `
      <div class="mf-map ${row.id === S.map.id ? 'cur' : ''}" data-id="${esc(row.id)}" data-src="${row.source}">
        <div class="t"><span>${row.source === 'cloud' ? '☁' : '💾'}</span><span>${esc(row.name)}</span>${row.live ? '<span class="tag live" title="The world this mini-game loads">LIVE</span>' : ''}${row.is_public && !row.live ? '<span class="tag pub">public</span>' : ''}${!row.mine ? '<span class="tag">by ' + esc(row.owner_name || 'someone') + '</span>' : '<span class="tag ' + (row.source === 'cloud' ? 'cloud' : '') + '">' + row.source + '</span>'}</div>
        <div class="m">${esc(row.description || '')}${row.description ? ' · ' : ''}${row.updated_at ? new Date(row.updated_at).toLocaleString() : ''}</div>
        <div class="acts"><button data-act="open">Open</button>${row.mine ? (row.live ? '<button data-act="unlive">Unset live</button>' : '<button data-act="live" title="Make this the world ' + esc(row.game || 'sandbox') + ' loads">★ Set live</button>') + (row.source === 'local' && r.cloudOk ? '<button data-act="upload">☁ Upload</button>' : '') + (row.source === 'cloud' && !row.live ? '<button data-act="pub">' + (row.is_public ? 'Make private' : 'Make public') + '</button>' : '') + '<button data-act="del" class="danger">Delete</button>' : ''}</div>
      </div>`).join('')).join('');
    list.querySelectorAll('.mf-map').forEach(el => {
      const id = el.dataset.id, src = el.dataset.src;
      el.querySelector('[data-act="open"]').onclick = () => openMap(id, src);
      const del = el.querySelector('[data-act="del"]'); if (del) del.onclick = async () => { if (!(await askConfirm('Delete this map permanently?'))) return; const d = await api.deleteMap(id, src); toast(d.ok ? 'Deleted.' : 'Delete failed: ' + d.error); if (d.ok && id === S.map.id) { S.source = null; setDirty(true); } renderMapsTab(); };
      const up = el.querySelector('[data-act="upload"]'); if (up) up.onclick = async () => { const m = api.localLoad(id); if (!m) return; const s = await api.cloudSave(m, false); if (s.ok) { api.localDelete(id); if (id === S.map.id) { S.source = 'cloud'; setDirty(S.dirty); } toast('☁ Uploaded.'); } else toast('Upload failed: ' + (s.error || 'unknown'), 4000); renderMapsTab(); };
      const lv = el.querySelector('[data-act="live"], [data-act="unlive"]'); if (lv) lv.onclick = async () => { const on = lv.dataset.act === 'live'; const s = await api.setLive(id, src, on); if (s.ok) notifyGame('live'); try { refreshLive(); } catch (_) {} toast(s.ok ? (on ? '★ Live — mini-game "' + (r.rows.find(x => x.id === id) || {}).game + '" now loads this world.' : 'No longer live.') : 'Failed: ' + (s.error || 'unknown'), 3600); renderMapsTab(); };
      const pub = el.querySelector('[data-act="pub"]'); if (pub) pub.onclick = async () => { const row = r.rows.find(x => x.id === id); const s = await api.cloudSetPublic(id, !row.is_public); if (s.ok) { if (id === S.map.id) S.isPublic = !row.is_public; toast(row.is_public ? 'Map is now private.' : 'Map is public — other players can open it.'); } else toast('Failed: ' + s.error); renderMapsTab(); };
    });
  }
  function toggleGrid(on) {
    S.showGrid = on;
    if (gridHelper) { scene.remove(gridHelper); gridHelper = null; }
    if (on) { const s = world.terrain.size; gridHelper = new THREE.GridHelper(s, Math.round(s / world.terrain.cell), 0xd4af37, 0x30343f); gridHelper.material.transparent = true; gridHelper.material.opacity = 0.35; gridHelper.position.y = 0.05; scene.add(gridHelper); }
  }

  /* ═══ WIRING ═══ */
  $$('.mf-tools button[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $$('button[data-sculpt]').forEach(b => b.onclick = () => { setSculptMode(b.dataset.sculpt); if (S.tool !== 'sculpt') setTool('sculpt'); });
  $('#mf-radius').oninput = e => { S.brush.radius = +e.target.value; renderBrush(); };
  $('#mf-strength').oninput = e => { S.brush.strength = +e.target.value; renderBrush(); };
  $('#mf-falloff').oninput = e => { S.brush.falloff = +e.target.value; renderBrush(); };
  $('#mf-tint-on').onchange = e => { S.propTint = e.target.checked ? $('#mf-tint').value : null; refreshGhost(); };
  $('#mf-tint').oninput = e => { if ($('#mf-tint-on').checked) { S.propTint = e.target.value; refreshGhost(); } };
  $('#mf-sc-count').oninput = e => { S.scatter.count = Math.max(1, Math.min(40, +e.target.value | 0)); $('#mf-sc-count-v').textContent = S.scatter.count; };
  $('#mf-sc-scale').oninput = e => { S.scatter.jitterScale = +e.target.value; $('#mf-sc-scale-v').textContent = Math.round(S.scatter.jitterScale * 100) + '%'; };
  $('#mf-sc-rot').onchange = e => { S.scatter.jitterRot = e.target.checked; };
  $('#mf-sc-water').onchange = e => { S.scatter.avoidWater = e.target.checked; };
  $('#mf-lib-q').oninput = () => { libQ = $('#mf-lib-q').value; libTag = ''; renderLibrary(); };
  $('#mf-lib-q').onkeydown = e => { if (e.key === 'Escape') { libQ = ''; libTag = ''; renderLibrary(); e.target.blur(); } e.stopPropagation(); };
  $('#mf-lib-view').onclick = () => { prefs.view = prefs.view === 'list' ? 'grid' : 'list'; renderLibrary(); };
  $('#mf-asset-add').onclick = () => { addAsset($('#mf-asset-url').value, $('#mf-asset-label').value); $('#mf-asset-url').value = ''; $('#mf-asset-label').value = ''; };
  $('#mf-asset-url').onkeydown = e => { if (e.key === 'Enter') $('#mf-asset-add').click(); };

  $$('.mf-tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  function showTab(t) { $$('.mf-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $$('.mf-tab').forEach(p => p.classList.toggle('on', p.dataset.tab === t)); if (t === 'maps') { renderMapsTab(); renderGamesList(); renderSceneFlags(); } if (t === 'scene') { renderOutliner(true); renderSceneTab(); } if (t === 'files') renderFilesTab(); if (t === 'menu') { renderPlayerTab(); renderMenuTab(); } }
  // a function declaration: select() runs during loadDoc, before this line executes
  function tabOn(t) { const p = $('.mf-tab[data-tab="' + t + '"]'); return !!(p && p.classList.contains('on')); }

  /* ═══ SCENE — everything that is in the map ═══
     Asked for: "a section where it shows everything that is in the map, like
     assets." Grouped by category; click a row to select and focus it. */
  function renderSceneTab() {
    const box = $('#mf-scene'); if (!box) return;
    const m = S.map, objs = m.objects;
    const groups = {}; const catOf = (o) => o.t === 'glb' ? 'Models' : o.t.startsWith('fx_') ? 'VFX' : ((PROP_BY_ID[o.t] || {}).cat || 'Other');
    objs.forEach(o => { (groups[catOf(o)] = groups[catOf(o)] || []).push(o); });
    const label = (o) => o.n || (o.t === 'glb' ? ((m.assets.find(a => a.id === o.a) || {}).label || 'Model') : ((PROP_BY_ID[o.t] || {}).label || (EMITTERS[o.t.slice(3)] || {}).label || o.t));
    const icon = (o) => o.t === 'glb' ? '🧊' : o.t.startsWith('fx_') ? ((EMITTERS[o.t.slice(3)] || {}).icon || '✨') : ((PROP_BY_ID[o.t] || {}).icon || '🧩');
    const flags = (o) => (o.act ? '<span class="tag" title="Interaction">⚡ ' + esc(o.act.kind) + '</span>' : '') + (o.au ? '<span class="tag">🔊</span>' : '') + (o.anim && o.anim.clip ? '<span class="tag">🎞 ' + esc(o.anim.clip) + '</span>' : '') + (world.isSolid(o) ? '' : '<span class="tag" title="No collision">○</span>');
    const size = m.terrain.n * m.terrain.cell;
    const menu = m.menu || normalizeMenu(null);
    box.innerHTML = '<div class="mf-scn-sum">' +
      '<div><b>' + esc(m.name) + '</b> <span class="mf-hint" style="display:inline">· ' + esc(m.game || 'sandbox') + (menu.on ? ' · 🌍 menu button on ' + esc(menu.hub) : '') + '</span></div>' +
      '<div class="mf-scn-grid"><span>Terrain</span><span>' + m.terrain.n + '×' + m.terrain.n + ' · ' + size + ' m</span>' +
      '<span>Water</span><span>' + (m.water.on ? 'on · level ' + m.water.level.toFixed(1) + ' m' : 'off') + '</span>' +
      '<span>Sky</span><span>' + esc(m.env.preset) + (m.env.weather && m.env.weather !== 'none' ? ' · ' + esc(m.env.weather) : '') + '</span>' +
      '<span>Models</span><span>' + m.assets.length + ' file' + (m.assets.length === 1 ? '' : 's') + (embeddedBytes(m) ? ' · ' + (embeddedBytes(m) / 1048576).toFixed(2) + ' MB embedded' : '') + '</span>' +
      '<span>Objects</span><span>' + objs.length + '</span></div></div>' +
      (m.assets.length ? '<div class="mf-scn-head">🧊 Model files <span class="n">' + m.assets.length + '</span></div><div class="mf-scn-list">' + m.assets.map(a => '<div class="mf-scn-row" data-asset="' + esc(a.id) + '" title="' + esc(a.url || 'embedded') + '"><span class="ic">' + (a.data ? '📦' : '🧊') + '</span><span class="lb">' + esc(a.label) + '</span><span class="tag">' + objs.filter(o => o.t === 'glb' && o.a === a.id).length + ' placed</span>' + (a.anims && a.anims.length ? '<span class="tag">🎞 ' + a.anims.length + '</span>' : '') + '</div>').join('') + '</div>' : '') +
      (objs.length ? Object.keys(groups).sort().map(c => '<div class="mf-scn-head">' + esc(c) + ' <span class="n">' + groups[c].length + '</span></div><div class="mf-scn-list">' + groups[c].map(o => '<div class="mf-scn-row ' + (o.id === S.selectedId ? 'on' : '') + '" data-obj="' + esc(o.id) + '"><span class="ic">' + icon(o) + '</span><span class="lb">' + esc(label(o)) + '</span>' + flags(o) + '<span class="pos">' + Math.round(o.p[0]) + ', ' + Math.round(o.p[2]) + '</span></div>').join('') + '</div>').join('') : '<div class="mf-empty" style="padding:10px 12px">Nothing placed yet. Pick something in the Library and click the ground.</div>');
    box.querySelectorAll('[data-obj]').forEach(el => { el.onclick = () => { select(el.dataset.obj); focusSelected(); renderSceneTab(); showTab('scene'); }; });
    box.querySelectorAll('[data-asset]').forEach(el => { el.onclick = () => { S.propId = 'glb'; S.assetId = el.dataset.asset; libCat = 'Models'; renderLibrary(); refreshGhost(); renderHud(); if (S.tool === 'select' || S.tool === 'erase') setTool('place'); toast('Click the ground to place another.'); }; });
  }

  /* ═══ FILES — everything uploaded to the engine ═══
     Asked for: "the second where all of the files that were uploaded to the
     engine; allow me to upload GLB, audio, animations and VFX files."
     Rows come from world_assets (sql/112) through mapforge.assets.js. Using a
     file: a model joins the Library; an animation applies to the selected
     model; audio arms the 🔊 marker; a VFX preset arms its emitter. */
  let filesCache = null, filesFilter = 'all';
  async function renderFilesTab(force) {
    const box = $('#mf-files'); if (!box) return;
    if (!filesCache || force) {
      box.innerHTML = '<div class="mf-empty" style="padding:10px 12px">Loading…</div>';
      const r = await assetsApi.list(); if (!ED) return;
      filesCache = r;
    }
    const r = filesCache;
    const note = $('#mf-files-note');
    if (note) note.textContent = r.offline ? 'Sign in to upload and see uploaded files.' : r.missing ? 'The files table is not set up yet — run sql/112_world_assets.sql, then reopen.' : r.ok ? (r.rows.length + ' file' + (r.rows.length === 1 ? '' : 's') + ' · up to 60 MB each · stored in the models bucket') : ('Could not list files: ' + (r.error || 'unknown error'));
    const rows = (r.rows || []).filter(x => filesFilter === 'all' || x.kind === filesFilter);
    $$('#mf-files-kinds button').forEach(b => b.classList.toggle('on', b.dataset.kind === filesFilter));
    const sel = objById(S.selectedId);
    box.innerHTML = rows.length ? rows.map(a => {
      const inMap = a.kind === 'model' && S.map.assets.some(x => x.url === a.url);
      const act = a.kind === 'model' ? (inMap ? 'Place' : '＋ Library') : a.kind === 'anim' ? (sel && sel.t === 'glb' ? '▶ Apply' : 'Pick model') : a.kind === 'audio' ? '🔊 Arm' : '✨ Arm';
      const extra = a.kind === 'anim' ? '<button data-act="player" title="Add this file\'s clips to the player character">🧍 For player</button>' : '';
      const armed = (a.kind === 'audio' && S.audioUrl === a.url) || (a.kind === 'vfx' && S.fxPreset && S.fxPreset.url === a.url) || (a.kind === 'model' && S.propId === 'glb' && S.assetId && (S.map.assets.find(x => x.id === S.assetId) || {}).url === a.url);
      return '<div class="mf-file ' + (armed ? 'on' : '') + '" data-id="' + esc(a.id) + '"><span class="ic" title="' + esc(assetsApi.KIND_LABEL[a.kind] || a.kind) + '">' + (assetsApi.KIND_ICON[a.kind] || '📄') + '</span><div class="body"><div class="lb" title="' + esc(a.url) + '">' + esc(a.name) + '</div><div class="m">' + esc(assetsApi.KIND_LABEL[a.kind] || a.kind) + ' · ' + (a.bytes / 1024 >= 1024 ? (a.bytes / 1048576).toFixed(1) + ' MB' : (a.bytes / 1024).toFixed(0) + ' KB') + (a.meta && a.meta.clips && a.meta.clips.length ? ' · 🎞 ' + a.meta.clips.length : '') + (a.meta && a.meta.preset ? ' · ' + esc(a.meta.preset) : '') + (a.owner_name && !a.mine ? ' · by ' + esc(a.owner_name) : '') + '</div></div><button data-act="use" class="' + (armed ? '' : 'primary') + '">' + act + '</button>' + extra + (a.mine ? '<button data-act="del" class="danger" title="Delete this file for everyone">✕</button>' : '') + '</div>';
    }).join('') : '<div class="mf-empty" style="padding:10px 12px">' + (r.ok ? 'No files uploaded yet. Use <b>⤒ Upload</b> above — .glb models and animations, .mp3 / .wav / .ogg audio, .json VFX presets.' : '') + '</div>';
    box.querySelectorAll('.mf-file').forEach(el => {
      const a = (r.rows || []).find(x => x.id === el.dataset.id); if (!a) return;
      el.querySelector('[data-act="use"]').onclick = () => useFile(a);
      const pb = el.querySelector('[data-act="player"]'); if (pb) pb.onclick = () => addPlayerAnimFile(a.url, a.name);
      const del = el.querySelector('[data-act="del"]'); if (del) del.onclick = async () => { if (!(await askConfirm('Delete ' + a.name + ' for everyone? Maps that use it will lose it.'))) return; const d = await assetsApi.remove(a); toast(d.ok ? 'Deleted.' : 'Delete failed: ' + d.error, 3200); if (d.ok) { filesCache = null; renderFilesTab(); } };
    });
  }
  async function useFile(a) {
    if (a.kind === 'model') {
      const have = S.map.assets.find(x => x.url === a.url);
      if (have) { S.propId = 'glb'; S.assetId = have.id; }
      else { await addAsset(a.url, a.name, { anims: a.meta && a.meta.clips }); }
      libCat = 'Models'; renderLibrary(); refreshGhost(); renderHud(); if (S.tool === 'select' || S.tool === 'erase') setTool('place');
      toast('Click the ground to place ' + a.name + '.', 2600); renderFilesTab();
    } else if (a.kind === 'anim') {
      const o = objById(S.selectedId);
      if (!o || o.t !== 'glb') { toast('Select a placed model first, then apply the animation to it.', 3600); return; }
      toast('Loading clips from ' + a.name + '…', 2000);
      try {
        const clips = await world.loadExtClips(a.url); if (!ED) return;
        if (!clips.length) { toast(a.name + ' has no animation clips.', 3200); return; }
        const root = world.objects.get(o.id); if (root) { const have = new Set((root.userData.mfClips || []).map(c => c.name)); root.userData.mfClips = (root.userData.mfClips || []).concat(clips.filter(c => !have.has(c.name))); }
        beginObjectEdit(); o.anim = { clip: clips[0].name, speed: 1, loop: 'repeat', src: a.url }; const okp = world.setAnim(o.id, o.anim); endObjectEdit(); setDirty(true); renderInspector();
        toast(okp ? '▶ ' + clips[0].name + ' on ' + (o.n || 'the model') + (clips.length > 1 ? ' — ' + clips.length + ' clips in the inspector' : '') : 'The clip does not fit this model\'s skeleton (bone names differ).', 4000);
      } catch (e) { toast('Could not load ' + a.name + ': ' + ((e && e.message) || e), 4000); }
    } else if (a.kind === 'audio') {
      S.audioUrl = a.url; S.audioName = a.name; S.propId = 'audio'; libCat = 'Markers'; renderLibrary(); refreshGhost(); renderHud(); if (S.tool === 'select' || S.tool === 'erase') setTool('place');
      const o = objById(S.selectedId);
      if (o && o.t === 'audio') { beginObjectEdit(); o.au = Object.assign(o.au || { vol: 1, r: 20, loop: true }, { url: a.url }); o.n = a.name.slice(0, 60); world.refreshObject(o); endObjectEdit(); setDirty(true); renderInspector(); toast('🔊 ' + a.name + ' now plays from the selected marker.', 3000); }
      else toast('🔊 armed — click the ground to place a sound marker for ' + a.name + '.', 3600);
      renderFilesTab();
    } else if (a.kind === 'vfx') {
      try {
        const res = await fetch(a.url, { cache: 'no-cache' }); const p = await res.json(); if (!ED) return;
        const kind = p && EMITTERS[p.kind] ? p.kind : null;
        if (!kind) { toast('Preset kind "' + (p && p.kind) + '" is not an emitter. Kinds: ' + Object.keys(EMITTERS).join(', '), 5000); return; }
        S.fxPreset = { kind, url: a.url, c: (typeof p.tint === 'string' && /^#[0-9a-f]{6}$/i.test(p.tint)) ? p.tint.toLowerCase() : null, fx: { i: Math.max(0.1, Math.min(4, +p.i || 1)), s: Math.max(0.2, Math.min(6, +p.s || 1)) }, label: String(p.label || a.name) };
        S.propId = 'fx_' + kind; libCat = 'VFX'; renderLibrary(); refreshGhost(); renderHud(); if (S.tool === 'select' || S.tool === 'erase') setTool('place');
        toast('✨ ' + S.fxPreset.label + ' armed — click the ground to place it.', 3200); renderFilesTab();
      } catch (e) { toast('Could not read the preset: ' + ((e && e.message) || e), 4000); }
    }
  }
  /* what a GLB holds, without loading it twice: clip names and mesh count */
  async function inspectFile(file) {
    if (!/\.gl(b|tf)$/i.test(file.name) || !THREE.GLTFLoader) return {};
    try {
      const buf = await file.arrayBuffer();
      const g = await new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, '', res, rej));
      let meshes = 0; const scene = g.scene || (g.scenes && g.scenes[0]); if (scene) scene.traverse(o => { if (o.isMesh) meshes++; });
      return { clips: (g.animations || []).filter(a => a && a.duration > 0).map(a => a.name || 'clip').slice(0, 64), meshes };
    } catch (e) { return {}; }
  }
  async function uploadFiles(files) {
    const kind = $('#mf-up-kind').value || '';
    for (const f of files) {
      toast('Uploading ' + f.name + '…', 60000);
      const r = await assetsApi.upload(f, { inspect: inspectFile, kind: kind || undefined }); if (!ED) return;
      if (!r.ok) { toast(r.missing ? 'The files table is not set up yet — run sql/112_world_assets.sql.' : 'Upload failed: ' + (r.error || 'unknown error'), 5200); continue; }
      toast('⤒ ' + r.row.name + ' uploaded as ' + (assetsApi.KIND_LABEL[r.row.kind] || r.row.kind) + '.', 3200);
      filesCache = null;
    }
    renderFilesTab();
  }

  /* ═══ PLAYER & CAMERA — how the map is played ═══
     Asked for: "a setting to change the game mode — top-down, over the
     shoulder third person like Resident Evil, or first person — the character
     model the players use, and idle / interact / walk / run animations." */
  const extClipNames = new Map();   // animation file url → clip names (loaded once)
  async function extClips(url) {
    if (extClipNames.has(url)) return extClipNames.get(url);
    try { const c = await world.loadExtClips(url); const names = c.map(x => x.name); extClipNames.set(url, names); return names; } catch (e) { extClipNames.set(url, []); return []; }
  }
  function renderPlayerTab() {
    const box = $('#mf-player'); if (!box) return;
    const pl = S.map.player = normalizePlayer(S.map.player);
    const models = S.map.assets;
    const cur = pl.model && models.find(a => a.id === pl.model.a);
    const own = cur ? (cur.anims || []) : [];
    const opt = (list, v, lab) => list.map(x => '<option value="' + esc(x) + '"' + (x === v ? ' selected' : '') + '>' + esc(lab ? lab(x) : x) + '</option>').join('');
    const animRow = (k, label, hint) => {
      const a = pl.anim[k] || {};
      const val = a.clip ? (a.src ? a.src + '|' + a.clip : 'own|' + a.clip) : '';
      return '<div class="mf-row"><label>' + label + '</label><select data-pa="' + k + '"><option value="">— none —</option>' +
        (own.length ? '<optgroup label="' + esc(cur.label) + '">' + own.map(c => '<option value="own|' + esc(c) + '"' + ('own|' + c === val ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</optgroup>' : '') +
        pl.animFiles.map(f => { const names = extClipNames.get(f.url); return names && names.length ? '<optgroup label="🎞 ' + esc(f.name) + '">' + names.map(c => '<option value="' + esc(f.url) + '|' + esc(c) + '"' + (f.url + '|' + c === val ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</optgroup>' : ''; }).join('') +
        '</select><span class="v" title="' + esc(hint) + '">' + (a.clip ? '' : '·') + '</span></div>';
    };
    box.innerHTML =
      '<div class="mf-row"><label>View</label><select id="mf-pl-view">' + opt(Object.keys(VIEWS), pl.view, v => VIEWS[v]) + '</select></div>' +
      '<p class="mf-hint" style="margin:0 0 8px">' + (pl.view === 'fps' ? 'First person: the character is not drawn; the camera is the eyes.' : pl.view === 'tps' ? 'Over the shoulder: the camera rides behind and to the right of the character, mouse to look.' : 'Top-down: the camera hangs above; WASD walks on the map\'s axes and the character turns to face where it goes.') + '</p>' +
      '<div class="mf-row"><label>Character</label><select id="mf-pl-model"><option value="">— none (invisible) —</option>' + models.map(a => '<option value="' + esc(a.id) + '"' + (cur && cur.id === a.id ? ' selected' : '') + '>' + esc(a.label) + (a.anims && a.anims.length ? ' · 🎞 ' + a.anims.length : '') + '</option>').join('') + '</select></div>' +
      (cur ? '<div class="mf-row"><label>Scale</label><input type="number" id="mf-pl-scale" step="0.05" min="0.01" max="50" value="' + (pl.model.scale) + '"><label style="flex:0 0 auto">Faces</label><select id="mf-pl-faces" style="flex:0 0 90px"><option value="-z"' + (pl.model.faces !== 'z' ? ' selected' : '') + '>−Z (three.js)</option><option value="z"' + (pl.model.faces === 'z' ? ' selected' : '') + '>+Z</option></select></div>' : '<p class="mf-hint">Add a model in the Library (or from Files) and pick it here. A character is needed for third person and top-down.</p>') +
      (cur ? '<div class="mf-sub">Animations</div>' + animRow('idle', 'Idle', 'standing still') + animRow('walk', 'Walk', 'moving') + animRow('run', 'Run', 'moving with Shift (walk at 1.6× if empty)') + animRow('interact', 'Interact', 'pressing E') +
        '<div class="mf-btns" style="margin-top:6px"><button id="mf-pl-upanim">⤒ Upload animation file</button><button id="mf-pl-pickanim" title="Choose an uploaded animation in the Files tab">🎞 From Files</button><input type="file" id="mf-pl-animfile" accept=".glb,.gltf" hidden></div>' +
        (pl.animFiles.length ? '<p class="mf-hint">Animation files: ' + pl.animFiles.map(f => esc(f.name)).join(', ') + '</p>' : '<p class="mf-hint">Clips from a separate animation file need the same bone names as the character.</p>') : '') +
      /* 🧍 THE CAST — what a PLAYER may choose to be in this map.
          The row above sets the character the author gets and the one everybody
          falls back to; this is the list they can pick from instead. Empty is
          the normal case and means "everyone is the default character", which
          is exactly how every map behaved before this existed. */
      '<div class="mf-sub">Characters players can pick</div>' +
      (pl.cast.length
        ? '<div class="mf-cast">' + pl.cast.map((c, i) => {
            const a = models.find(x => x.id === c.a);
            return '<div class="mf-row mf-cast-row"><label>' + esc(a ? a.label : '⚠ missing asset') + '</label>' +
              '<input type="text" data-cast-label="' + i + '" placeholder="Name players see" maxlength="40" value="' + esc(c.label || '') + '">' +
              '<input type="number" data-cast-scale="' + i + '" step="0.05" min="0.01" max="50" style="flex:0 0 72px" value="' + c.scale + '">' +
              '<select data-cast-faces="' + i + '" style="flex:0 0 78px"><option value="-z"' + (c.faces !== 'z' ? ' selected' : '') + '>−Z</option><option value="z"' + (c.faces === 'z' ? ' selected' : '') + '>+Z</option></select>' +
              '<button data-cast-del="' + i + '" title="Remove from the roster">✕</button></div>';
          }).join('') + '</div>'
        : '<p class="mf-hint">No roster — everyone who enters is the character above. Add one or more here and players get a 🧍 Character button in the hub.</p>') +
      (pl.cast.length < PLAYER_CAST_MAX
        ? '<div class="mf-row"><label>Add</label><select id="mf-cast-add"><option value="">— choose a model —</option>' +
          models.filter(a => !pl.cast.some(c => c.a === a.id)).map(a => '<option value="' + esc(a.id) + '">' + esc(a.label) + '</option>').join('') + '</select></div>'
        : '<p class="mf-hint">That is the maximum of ' + PLAYER_CAST_MAX + ' — a picker past a dozen is a wardrobe, and every entry is a model each visitor may have to download.</p>') +
      '<p class="mf-hint">A player\u2019s choice is remembered on their account and used in every hub that offers it. Animations above apply to whichever character they wear, so the clips need the same bone names.</p>' +
      '<p class="mf-hint">Press <b>▶ Play</b> to test exactly what players get.</p>';
    const commit = () => { S.map.player = normalizePlayer(pl); setDirty(true); renderPlayerTab(); };
    $('#mf-pl-view').onchange = (e) => { pl.view = e.target.value; commit(); };
    $('#mf-pl-model').onchange = (e) => { pl.model = e.target.value ? { a: e.target.value, scale: 1, faces: '-z' } : null; pl.anim = {}; commit(); };
    const sc = $('#mf-pl-scale'); if (sc) sc.onchange = () => { pl.model.scale = +sc.value || 1; commit(); };
    /* 🧍 the roster's own handlers */
    const add = $('#mf-cast-add');
    if (add) add.onchange = () => { if (!add.value) return; pl.cast = (pl.cast || []).concat([{ a: add.value, label: '', scale: 1, faces: '-z' }]); commit(); };
    box.querySelectorAll('[data-cast-del]').forEach(b => { b.onclick = () => { pl.cast.splice(+b.dataset.castDel, 1); commit(); }; });
    box.querySelectorAll('[data-cast-label]').forEach(i => { i.onchange = () => { pl.cast[+i.dataset.castLabel].label = i.value; commit(); }; });
    box.querySelectorAll('[data-cast-scale]').forEach(i => { i.onchange = () => { pl.cast[+i.dataset.castScale].scale = +i.value || 1; commit(); }; });
    box.querySelectorAll('[data-cast-faces]').forEach(sel => { sel.onchange = () => { pl.cast[+sel.dataset.castFaces].faces = sel.value; commit(); }; });
    const fc = $('#mf-pl-faces'); if (fc) fc.onchange = () => { pl.model.faces = fc.value; commit(); };
    box.querySelectorAll('[data-pa]').forEach(sel => { sel.onchange = () => { const v = sel.value; if (!v) { delete pl.anim[sel.dataset.pa]; } else { const i = v.indexOf('|'); const src = v.slice(0, i), clip = v.slice(i + 1); pl.anim[sel.dataset.pa] = src === 'own' ? { clip } : { clip, src }; } commit(); }; });
    const up = $('#mf-pl-upanim'), pick = $('#mf-pl-pickanim'), fi = $('#mf-pl-animfile');
    if (up) up.onclick = () => fi.click();
    if (fi) fi.onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { const r = await assetsApi.upload(f, { inspect: inspectFile, kind: 'anim' }); if (!ED) return; if (!r.ok) { toast(r.missing ? 'The files table is not set up yet — run sql/112_world_assets.sql.' : 'Upload failed: ' + (r.error || 'unknown error'), 5200); return; } filesCache = null; addPlayerAnimFile(r.row.url, r.row.name); } };
    if (pick) pick.onclick = () => { filesFilter = 'anim'; showTab('files'); toast('Pick an animation file — "For player" adds it to the character.', 3600); };
    // clip names for the animation files may still be loading: render again when they land
    pl.animFiles.forEach(f => { if (!extClipNames.has(f.url)) extClips(f.url).then(() => { if (ED && tabOn('menu')) renderPlayerTab(); }); });
  }
  async function addPlayerAnimFile(url, name) {
    const pl = S.map.player = normalizePlayer(S.map.player);
    if (!pl.animFiles.some(f => f.url === url)) pl.animFiles.push({ url, name: String(name || 'animation').slice(0, 80) });
    const names = await extClips(url); if (!ED) return;
    S.map.player = normalizePlayer(pl); setDirty(true);
    toast(names.length ? '🎞 ' + names.length + ' clip' + (names.length > 1 ? 's' : '') + ' from ' + name + ' — assign them under Player & camera.' : name + ' has no animation clips.', 4200);
    showTab('menu');
  }

  /* ═══ MENU — the map as a button on a game menu ═══ */
  function renderMenuTab() {
    const box = $('#mf-menu'); if (!box) return;
    const mn = S.map.menu = normalizeMenu(S.map.menu);
    const hubs = bridgeHubs(), gl = bridgeGuides(), games = miniGames();
    const opt = (list, cur, idk, namek) => list.map(x => '<option value="' + esc(x[idk]) + '"' + (x[idk] === cur ? ' selected' : '') + '>' + esc(x[namek] || x[idk]) + '</option>').join('');
    box.innerHTML = `
      <div class="mf-row"><label>Button</label><input type="checkbox" id="mf-mn-on" ${mn.on ? 'checked' : ''}><span class="mf-hint" style="margin:0">this map is a button on a game menu</span></div>
      <div class="mf-mn ${mn.on ? '' : 'off'}">
        <div class="mf-row"><label>Menu</label><select id="mf-mn-hub">${opt(hubs, mn.hub, 'id', 'name')}</select></div>
        <div class="mf-row"><label>Name</label><input type="text" id="mf-mn-label" maxlength="40" value="${esc(mn.label)}" placeholder="${esc(S.map.name)}"></div>
        <div class="mf-row"><label>Subtitle</label><input type="text" id="mf-mn-sub" maxlength="80" value="${esc(mn.sub)}" placeholder="one line under the name"></div>
        <div class="mf-row"><label>Icon</label><input type="text" id="mf-mn-icon" maxlength="4" value="${esc(mn.icon)}" placeholder="🌍" style="width:64px;flex:0 0 64px"><span class="mf-hint" style="margin:0">an emoji</span></div>
        <div class="mf-row"><label>Kind</label><select id="mf-mn-mode"><option value="interact" ${mn.mode === 'interact' ? 'selected' : ''}>Interaction — single player</option><option value="hub" ${mn.mode === 'hub' ? 'selected' : ''}>Player hub — multiplayer</option></select></div>
        <div id="mf-mn-hubopts" style="display:${mn.mode === 'hub' ? '' : 'none'}">
          <div class="mf-row"><label>Chat</label><input type="checkbox" id="mf-mn-text" ${mn.chatText ? 'checked' : ''}><span class="mf-hint" style="margin:0">typed chat</span><input type="checkbox" id="mf-mn-voice" ${mn.chatVoice ? 'checked' : ''}><span class="mf-hint" style="margin:0">proximity voice</span></div>
          <p class="mf-hint">Everyone who opens the button meets in this world. They see each other, type in the chat box, and hear whoever is within 16 m when voice is on.</p>
        </div>
        <div id="mf-mn-intopts" style="display:${mn.mode === 'interact' ? '' : 'none'}">
          <div class="mf-row"><label>Default</label><select id="mf-mn-kind"><option value="enter" ${mn.kind === 'enter' ? 'selected' : ''}>Enter a building → open a menu</option><option value="dialog" ${mn.kind === 'dialog' ? 'selected' : ''}>Dialogue → play a Forge guide</option></select></div>
          <div class="mf-row" id="mf-mn-target-row" style="display:${mn.kind === 'enter' ? '' : 'none'}"><label>Opens</label><select id="mf-mn-target"><option value="">— pick a menu —</option><optgroup label="Menus">${opt(hubs.map(h => ({ id: 'hub:' + h.id, name: h.name })), mn.target && HUBS.includes(mn.target) ? 'hub:' + mn.target : '', 'id', 'name')}</optgroup><optgroup label="Screens">${opt(games, mn.target, 'id', 'name')}</optgroup></select></div>
          <div class="mf-row" id="mf-mn-guide-row" style="display:${mn.kind === 'dialog' ? '' : 'none'}"><label>Guide</label><select id="mf-mn-guide"><option value="">— pick a guide —</option>${opt(gl, mn.guide, 'id', 'title')}</select></div>
          <p class="mf-hint">This is what a <b>⭕ Zone</b> marker does when the player walks into it. Any object can carry its own interaction instead — select it and set <b>Interaction</b> in the inspector.${gl.length ? '' : ' No guides yet: create one in the Forge → Guides.'}</p>
        </div>
        <p class="mf-hint">Saving to the cloud makes the map public and puts the button on the <b>${esc((hubs.find(h => h.id === mn.hub) || {}).name || mn.hub)}</b> menu for every player.</p>
      </div>`;
    const g = (id) => box.querySelector(id);
    const upd = () => {
      mn.on = g('#mf-mn-on').checked; mn.hub = g('#mf-mn-hub').value; mn.label = g('#mf-mn-label').value.trim().slice(0, 40); mn.sub = g('#mf-mn-sub').value.trim().slice(0, 80); mn.icon = g('#mf-mn-icon').value.trim().slice(0, 4);
      mn.mode = g('#mf-mn-mode').value; mn.chatText = g('#mf-mn-text').checked; mn.chatVoice = g('#mf-mn-voice').checked; mn.kind = g('#mf-mn-kind').value;
      const t = g('#mf-mn-target').value; mn.target = t.startsWith('hub:') ? t.slice(4) : t; mn.guide = g('#mf-mn-guide').value;
      S.map.menu = normalizeMenu(mn); setDirty(true);
    };
    box.querySelectorAll('input,select').forEach(el => { el.onchange = () => { upd(); renderMenuTab(); }; });
  }
  $('#mf-newfolder').onclick = () => newFolder(S.folderId && folderById(S.folderId) ? (folderById(S.folderId).parent || null) : null);
  $('#mf-newsub').onclick = () => newFolder(S.folderId || null);
  const offReg = games.onRegister(() => { if (!ED) return; if (!S.game && games.get(S.map.game)) { S.game = S.map.game; renderGameTag(); } renderGamesList(); renderSceneFlags(); });
  teardown.push(offReg);

  // terrain tab
  $('#mf-t-apply').onclick = () => {
    const n = Math.max(16, Math.min(160, +$('#mf-t-n').value | 0)), cell = Math.max(0.5, Math.min(8, +$('#mf-t-cell').value || 2));
    const before = world.terrain.snapshot();
    world.terrain.setData(resampleTerrain(S.map.terrain, n, cell)); world.onTerrainRebuilt(); regroundAll();
    pushUndo({ type: 'terrain', before, after: world.terrain.snapshot() }); setDirty(true); renderTerrainTab(); renderStats(); if (S.showGrid) toggleGrid(true);
  };
  $('#mf-t-gen').onclick = () => {
    const before = world.terrain.snapshot();
    world.terrain.generate({ type: $('#mf-t-type').value, seed: +$('#mf-t-seed').value || 1, amplitude: +$('#mf-t-amp').value || 6, scale: +$('#mf-t-scale').value || 0.35 });
    regroundAll(); pushUndo({ type: 'terrain', before, after: world.terrain.snapshot() }); setDirty(true);
  };
  $('#mf-t-seed-rnd').onclick = () => { $('#mf-t-seed').value = (Math.random() * 1e6) | 0; $('#mf-t-gen').click(); };
  $('#mf-t-flat').onclick = () => { const before = world.terrain.snapshot(); world.terrain.generate({ type: 'flat' }); regroundAll(); pushUndo({ type: 'terrain', before, after: world.terrain.snapshot() }); setDirty(true); };
  $('#mf-t-grid').onchange = e => toggleGrid(e.target.checked);
  $('#mf-t-markers').onchange = e => { S.showMarkers = e.target.checked; world.setMarkersVisible(S.showMarkers); };
  $('#mf-t-nav').onchange = e => { S.showNav = e.target.checked; world.navInvalidate(); drawNav(); if (S.showNav) toast('Navmesh: green cells are walkable for agents; red are too steep, under water or blocked.', 3600); };
  $('#mf-t-amp').oninput = e => { $('#mf-t-amp-v').textContent = (+e.target.value).toFixed(1) + 'm'; };
  $('#mf-t-scale').oninput = e => { $('#mf-t-scale-v').textContent = (+e.target.value).toFixed(2); };

  // water tab
  const wBind = (id, key, fmt) => { const el = $('#mf-w-' + id); el.oninput = () => { const w = S.map.water; w[key] = el.type === 'checkbox' ? el.checked : el.type === 'color' ? el.value : +el.value; world.applyWater(w); settingsChanged(); renderWaterTab(); }; el.onchange = el.oninput; };
  wBind('on', 'on'); wBind('level', 'level'); wBind('color', 'color'); wBind('opacity', 'opacity'); wBind('wave', 'wave'); wBind('speed', 'speed');
  // sky tab
  const eBind = (key) => { const el = $('#mf-e-' + key); const h = () => { const e = S.map.env; e[key] = el.type === 'checkbox' ? el.checked : el.type === 'color' ? el.value : +el.value; world.applyEnv(e); settingsChanged(); renderSkyTab(); }; el.oninput = h; el.onchange = h; };
  ['skyTop', 'skyBottom', 'fogColor', 'fogNear', 'fogFar', 'sunEl', 'sunAz', 'sunIntensity', 'sunColor', 'ambient', 'ambientIntensity', 'groundColor', 'shadows', 'weatherIntensity', 'windDir', 'windSpeed', 'exposure', 'bloom', 'bloomThreshold', 'vignette', 'terrainDetail', 'terrainTile'].forEach(eBind);
  $('#mf-e-tone').onchange = e => { S.map.env.tone = e.target.value; world.applyEnv(S.map.env); settingsChanged(); };
  $('#mf-e-weather').onchange = e => { S.map.env.weather = e.target.value; world.applyEnv(S.map.env); settingsChanged(); };
  $('#mf-e-preset').onchange = e => { const p = ENV_PRESETS[e.target.value]; if (!p) return; Object.assign(S.map.env, p, { preset: e.target.value }); world.applyEnv(S.map.env); settingsChanged(); renderSkyTab(); };

  // maps tab
  $('#mf-new').onclick = newMapFlow;
  $('#mf-desc').onchange = e => { S.map.description = e.target.value.slice(0, 2000); setDirty(true); };
  // Picking a mini-game TAKES YOU TO ITS WORLD: the live map for that game
  // opens for editing (asking first if this map has unsaved changes). Only when
  // the game has no world yet does the pick fall back to tagging the current
  // map with it — which is how a game gets its first world.
  $('#mf-game').onchange = async e => {
    let v = e.target.value;
    if (v === '__custom__') v = gameId(window.prompt('Mini-game id (letters, digits, - and _):', S.map.game || '') || '') || S.map.game || 'sandbox';
    const game = gameId(v) || 'sandbox';
    if (game === (S.map.game || 'sandbox')) { setGameField(game); return; }
    const r = game === 'sandbox' ? { ok: false } : await api.loadLive(game);
    if (!ED) return;
    if (r.ok && r.map && r.map.id !== S.map.id) {
      if (S.dirty && !(await askConfirm('Discard unsaved changes and open the ' + game + ' world?'))) { setGameField(S.map.game || 'sandbox'); return; }
      S.isPublic = true; S.mine = r.mine !== false;
      loadDoc(r.map, r.source || 'cloud'); api.clearDraft(); renderMapsTab();
      toast(S.mine ? '⚒ Editing the live world for ' + game + '.' : 'This is someone else\'s live world for ' + game + ' — saving creates your own copy.', 4200);
      return;
    }
    S.map.game = game; setGameField(game); setDirty(true); renderMapsTab();
    if (game !== 'sandbox') toast('No world for ' + game + ' yet — this map is now tagged for it. Save, then ★ Set live.', 4200);
  };
  $('#mf-maps-game').onchange = () => renderMapsTab();
  $('#mf-glb-btn').onclick = () => $('#mf-glb-file').click();
  $('#mf-up-btn').onclick = () => $('#mf-up-file').click();
  $('#mf-up-file').onchange = e => { const fl = Array.from(e.target.files || []); e.target.value = ''; if (fl.length) uploadFiles(fl); };
  $('#mf-files-refresh').onclick = () => renderFilesTab(true);
  $$('#mf-files-kinds button').forEach(b => b.onclick = () => { filesFilter = b.dataset.kind; renderFilesTab(); });
  $('#mf-cloud-up').onclick = () => $('#mf-cloud-file').click();
  $('#mf-cloud-file').onchange = e => { Array.from(e.target.files || []).forEach(f => uploadToCloud(f, 'models')); e.target.value = ''; };
  $('#mf-glb-file').onchange = e => { Array.from(e.target.files || []).forEach(addAssetFile); e.target.value = ''; };
  // drag a .glb (or a .world.json) onto the canvas
  canvasHost.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; canvasHost.classList.add('drop'); });
  canvasHost.addEventListener('dragleave', () => canvasHost.classList.remove('drop'));
  canvasHost.addEventListener('drop', e => { e.preventDefault(); canvasHost.classList.remove('drop'); Array.from((e.dataTransfer && e.dataTransfer.files) || []).forEach(addAssetFile); });
  $('.mf-top .name input').onchange = e => { S.map.name = e.target.value.trim().slice(0, 80) || 'Untitled world'; setDirty(true); };
  $('#mf-save').onclick = () => save();
  $('#mf-save-local').onclick = () => save('local');
  $('#mf-export').onclick = exportJson;
  $('#mf-import').onclick = () => $('#mf-file').click();
  $('#mf-file').onchange = e => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; };
  $('#mf-play').onclick = togglePlay;
  $('#mf-undo').onclick = undo; $('#mf-redo').onclick = redo;
  $('#mf-help-btn').onclick = () => $('.mf-help').classList.toggle('on');
  $('.mf-help').onclick = e => { if (e.target === e.currentTarget || e.target.dataset.close) $('.mf-help').classList.remove('on'); };
  $('#mf-close').onclick = () => close(false);
  $('#mf-overview').onclick = frameOverview;
  $('#mf-bp-close').onclick = () => { S.bpOpen = false; renderBpPanel(); renderInspector(); };
  $('#mf-bp-add').onclick = (e) => { if (bpGraph) bpGraph.openMenu(e.clientX, e.clientY + 8); };
  $('#mf-widgets').onclick = () => { try { if (window.AthenaUI && window.AthenaUI.openDesigner) window.AthenaUI.openDesigner(); else toast('Athena Widgets has not loaded (src/widgets/index.js).', 3200); } catch (e) { toast('Could not open the Widget Designer.', 3000); } };
  $$('.mf-gizmo button[data-gm]').forEach(b => b.onclick = () => setGizmoMode(b.dataset.gm));
  $('#mf-gm-select').onclick = () => setTool('select');
  $('#mf-snap').onclick = () => { S.snap = !S.snap; applySnap(); renderHud(); };
  $('#mf-snapsize').onchange = e => { S.snapSize = +e.target.value || 1; applySnap(); };
  $('#mf-space').onclick = () => setGizmoSpace(S.gizmoSpace === 'world' ? 'local' : 'world');
  $('#mf-colview').onclick = () => { S.showColliders = !S.showColliders; $('#mf-colview').classList.toggle('on', S.showColliders); drawColliders(); };
  $('#mf-hotkeys').onchange = e => setHotkeys(e.target.value);
  $('#mf-quality').value = quality.get().pref;
  $('#mf-quality').onchange = e => { quality.set(e.target.value); quality.apply(renderer, world); resize(); toast('Quality: ' + quality.get().settings.label + (quality.get().pref === 'auto' ? ' (auto — steps down when the frame rate drops)' : ''), 3000); };
  const offQ = quality.onChange(() => { quality.apply(renderer, world); resize(); $('#mf-quality').value = quality.get().pref; }); teardown.push(offQ);
  const qTuner = quality.createTuner();
  $('#mf-hotkeys').value = S.hotkeys; renderToolbar();
  if (!gizmo) { $$('.mf-gizmo button[data-gm]').forEach(b => { b.disabled = true; b.title = 'TransformControls did not load — drag objects on the ground, or type values in the inspector'; }); }

  renderBrush(); renderPalette(); renderLibrary(); renderInspector(); setTool('select'); setGizmoMode('translate'); showTab('object'); renderUndo();
  wireContentBrowser();
  setDirty(freshStart ? false : S.dirty);
  loading.remove();
  if (freshStart) setTimeout(() => toast('Welcome to Athena Engine — press H for the controls.', 4000), 400);

  /* ═══ LOOP ═══ */
  let raf = 0, last = performance.now(), fpsN = 0, fpsT = 0;
  const ringPts = brushRing.geometry.attributes.position;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.playing) playFrame(dt);
    else { flyFrame(dt); controls.update(); applyStrokeFrame(dt); }
    if (gizmo && gizmo.object && !gizmo.object.parent) gizmo.detach();   // object removed from under the gizmo (undo, API) — never let it complain
    // brush ring + ghost follow the cursor over the terrain
    const showRing = !S.playing && stroke.hit && (S.tool === 'sculpt' || S.tool === 'paint' || S.tool === 'scatter');
    brushRing.visible = !!showRing;
    if (showRing) {
      const p = stroke.hit, R = S.brush.radius, N = ringPts.count;
      for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, x = p.x + Math.cos(a) * R, z = p.z + Math.sin(a) * R; ringPts.setXYZ(i, x, world.heightAt(x, z) + 0.12, z); }
      ringPts.needsUpdate = true;
      brushRing.material.color.set(S.tool === 'paint' ? PAINT[S.paintIdx].color : S.tool === 'scatter' ? '#5fd38a' : effectiveSculptMode(lastMods) === 'lower' ? '#ff6b83' : '#d4af37');
    }
    if (ghost) { const on = !S.playing && !!stroke.hit && (S.tool === 'place' || S.tool === 'scatter'); ghost.visible = on; if (on) ghost.position.set(stroke.hit.x, world.heightAt(stroke.hit.x, stroke.hit.z), stroke.hit.z); }
    world.update(dt, camera);
    post.enabled = quality.get().settings.post !== false;
    post.render(scene, camera, S.map.env);
    if (S.playing) qTuner.frame(dt);
    fpsN++; fpsT += dt; if (fpsT >= 0.5) { $('#mf-hud-fps').textContent = Math.round(fpsN / fpsT) + ' fps · ' + renderer.info.render.triangles.toLocaleString() + ' tris · ' + renderer.info.render.calls + ' calls'; fpsN = 0; fpsT = 0; }
  }
  raf = requestAnimationFrame(frame);
  return ED;
}

/* Resolves when the editor is actually gone (a dirty map asks first) — `await close(); open(…)` is safe. */
export function closeEditor() { return ED ? Promise.resolve(ED.close()) : Promise.resolve(); }

/* ── helpers ── */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ensureCss() {
  if (document.getElementById('mf-css')) return;
  const l = document.createElement('link'); l.id = 'mf-css'; l.rel = 'stylesheet'; l.href = new URL('./mapforge.css', import.meta.url).href;
  document.head.appendChild(l);
}
function makeBrushRing(THREE) {
  const N = 64, pos = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xd4af37, depthTest: false, transparent: true, opacity: 0.95 }));
  m.renderOrder = 20; m.frustumCulled = false; m.visible = false; return m;
}
/* OrbitControls when available; otherwise a minimal right-drag orbit / middle
   pan / wheel zoom with the same .target/.update/.enabled surface. */
function makeControls(THREE, camera, dom) {
  if (THREE.OrbitControls) {
    const c = new THREE.OrbitControls(camera, dom);
    c.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    c.enableDamping = true; c.dampingFactor = 0.12; c.maxPolarAngle = Math.PI * 0.495; c.minDistance = 1; c.maxDistance = 1500; c.screenSpacePanning = false;
    return c;
  }
  // The camera position is the source of truth (the editor moves it directly
  // for fly/overview/focus); spherical coords are derived at the start of
  // each interaction, never kept — that is what broke the first version.
  const c = { target: new THREE.Vector3(), enabled: true, update() { camera.lookAt(c.target); } };
  const sph = new THREE.Spherical(); let drag = null;
  const sync = () => { const off = new THREE.Vector3().subVectors(camera.position, c.target); sph.setFromVector3(off); if (sph.radius < 1) sph.radius = 1; };
  const place = () => { const off = new THREE.Vector3().setFromSpherical(sph); camera.position.copy(c.target).add(off); camera.lookAt(c.target); };
  dom.addEventListener('pointerdown', e => { if (!c.enabled || e.button === 0) return; sync(); drag = { b: e.button, x: e.clientX, y: e.clientY, shift: e.shiftKey }; });
  window.addEventListener('pointermove', e => {
    if (!drag || !c.enabled) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.b === 2 && !drag.shift) { sph.theta -= dx * 0.005; sph.phi = Math.max(0.05, Math.min(Math.PI * 0.495, sph.phi - dy * 0.005)); }
    else { const fwd = new THREE.Vector3().subVectors(c.target, camera.position); fwd.y = 0; fwd.normalize(); const right = new THREE.Vector3(fwd.z, 0, -fwd.x); const k = sph.radius * 0.0015; c.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k); }
    place();
  });
  window.addEventListener('pointerup', () => { drag = null; });
  dom.addEventListener('wheel', e => { if (!c.enabled) return; e.preventDefault(); sync(); sph.radius = Math.max(1, Math.min(1500, sph.radius * (e.deltaY > 0 ? 1.12 : 0.89))); place(); }, { passive: false });
  return c;
}

const TEMPLATE = `
<div class="mf-top">
  <span class="brand">⚒ Athena Engine</span>
  <span class="name"><input type="text" maxlength="80" placeholder="Map name"></span>
  <span class="state">New map</span>
  <span class="gametag" style="display:none"></span>
  <span class="spacer"></span>
  <span class="grp"><button id="mf-undo" title="Undo (Ctrl+Z)">↶</button><button id="mf-redo" title="Redo (Ctrl+Y)">↷</button></span>
  <span class="grp"><button id="mf-overview" title="Frame the whole map">⌂ Overview</button><button id="mf-play" title="Walk the map (P)">▶ Play</button></span>
  <span class="grp"><button id="mf-save" class="primary" title="Save (Ctrl+S)">💾 Save</button><button id="mf-save-local" title="Save a copy on this device only">⇩ Device</button><button id="mf-export" title="Download as JSON">⤓ Export</button><button id="mf-import" title="Open a JSON export">⤒ Import</button><input type="file" id="mf-file" accept=".json,application/json" hidden></span>
  <span class="grp"><button id="mf-cb-btn" title="Content browser (Ctrl+Space)">🗂 Content</button><button id="mf-widgets" title="Open the Widget Designer (Blueprint-style UI)">🧩 Widgets</button></span>
  <span class="grp"><select id="mf-quality" title="Quality: pixel ratio, shadows, effects (auto steps down on low fps)"><option value="auto">Quality: auto</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></span>
  <span class="grp"><select id="mf-hotkeys" title="Hotkey scheme"><option value="unreal">Unreal hotkeys</option><option value="default">Simple hotkeys</option></select><button id="mf-help-btn" title="Controls (H)">?</button><button id="mf-close" class="danger" title="Close the editor">✕</button></span>
</div>
<div class="mf-left">
  <div class="mf-sec"><h3>Tools</h3>
    <div class="mf-tools">
      <button data-tool="select">🖱️ Select<kbd>1</kbd></button><button data-tool="sculpt">⛰️ Sculpt<kbd>2</kbd></button>
      <button data-tool="paint">🖌️ Paint<kbd>3</kbd></button><button data-tool="place">🧱 Place<kbd>4</kbd></button>
      <button data-tool="scatter">🌲 Scatter<kbd>5</kbd></button><button data-tool="erase">🧹 Erase<kbd>6</kbd></button>
    </div>
  </div>
  <div class="mf-sec"><h3>Brush</h3>
    <div class="mf-tools" style="margin-bottom:8px">
      <button data-sculpt="raise">▲ Raise</button><button data-sculpt="lower">▼ Lower</button><button data-sculpt="smooth">≈ Smooth</button><button data-sculpt="flatten">▬ Flatten</button>
    </div>
    <div class="mf-row"><label>Radius</label><input type="range" id="mf-radius" min="0.5" max="60" step="0.5"><span class="v" id="mf-radius-v"></span></div>
    <div class="mf-row"><label>Strength</label><input type="range" id="mf-strength" min="0.05" max="1" step="0.05"><span class="v" id="mf-strength-v"></span></div>
    <div class="mf-row"><label>Softness</label><input type="range" id="mf-falloff" min="0.05" max="1" step="0.05"><span class="v" id="mf-falloff-v"></span></div>
    <p class="mf-hint">Hold <b>Shift</b> to lower, <b>Ctrl</b> to smooth, <b>Alt</b> to flatten. <b>[</b> / <b>]</b> change the radius.</p>
  </div>
  <div class="mf-sec"><h3>Paint layers</h3><div class="mf-pal" id="mf-palette"></div></div>
  <div class="mf-sec"><h3>Library <span class="n" id="mf-lib-n"></span></h3>
    <div class="mf-libbar"><input type="text" id="mf-lib-q" placeholder="🔍 Search everything — names and tags (wood, light, animated…)" autocomplete="off"><button id="mf-lib-view" title="Grid / list">▦</button></div>
    <div class="mf-cats" id="mf-cats"></div>
    <div class="mf-tags" id="mf-tags"></div>
    <div class="mf-recent" id="mf-recent" style="display:none"></div>
    <div class="mf-props" id="mf-props"></div>
    <div id="mf-models" style="display:none">
      <div class="mf-assets" id="mf-assets"></div>
      <div class="mf-btns" style="margin:8px 0"><button id="mf-glb-btn" class="primary">📂 Add .glb file</button><input type="file" id="mf-glb-file" accept=".glb,.gltf,model/gltf-binary" multiple hidden></div>
      <p class="mf-hint" id="mf-embed-note" style="margin:0 0 8px"></p>
      <div class="mf-btns" style="margin:0 0 8px"><button id="mf-cloud-up" title="Upload to the shared cloud (admin) — one URL every player loads">☁ Upload to cloud</button><input type="file" id="mf-cloud-file" accept=".glb,.gltf,model/gltf-binary" multiple hidden></div>
      <div class="mf-sub">Cloud (shared)</div>
      <div class="mf-assets" id="mf-cloud"><div class="mf-empty">Loading…</div></div>
      <div class="mf-sub" style="margin-top:8px">Project (/models/)</div>
      <div class="mf-assets" id="mf-project"><div class="mf-empty">Loading…</div></div>
      <div class="mf-sub" style="margin-top:8px">By URL</div>
      <div><input type="text" id="mf-asset-url" placeholder="https://…/model.glb  or  /models/x.glb"></div>
      <div style="display:flex;gap:5px;margin-top:5px"><input type="text" id="mf-asset-label" placeholder="Label (optional)" maxlength="60"><button id="mf-asset-add">Add</button></div>
      <p class="mf-hint">Drop a .glb on the canvas to embed it in this map (quick tests). For production put the file in /models/, list it in /models/manifest.json, and it appears under Project. Y-up, metres, origin at the base. Animated models keep their clips — pick one in the inspector.</p>
    </div>
    <div class="mf-details" id="mf-details" style="display:none"></div>
    <div class="mf-row" id="mf-tint-row" style="margin-top:8px"><label>Tint</label><input type="checkbox" id="mf-tint-on"><input type="color" id="mf-tint" value="#c0392b"><span class="mf-hint" style="margin:0">colour new props</span></div>
  </div>
  <div class="mf-sec"><h3>Scatter</h3>
    <div class="mf-row"><label>Per stroke</label><input type="range" id="mf-sc-count" min="1" max="40" step="1" value="6"><span class="v" id="mf-sc-count-v">6</span></div>
    <div class="mf-row"><label>Size jitter</label><input type="range" id="mf-sc-scale" min="0" max="0.8" step="0.05" value="0.3"><span class="v" id="mf-sc-scale-v">30%</span></div>
    <div class="mf-row"><label>Random spin</label><input type="checkbox" id="mf-sc-rot" checked></div>
    <div class="mf-row"><label>Avoid water</label><input type="checkbox" id="mf-sc-water" checked></div>
  </div>
</div>
<div class="mf-canvas">
  <div class="mf-gizmo"><button id="mf-gm-select" title="Select tool">↖ Select</button><button data-gm="translate" title="Move">✥ Move</button><button data-gm="rotate" title="Rotate">⟳ Rotate</button><button data-gm="scale" title="Scale">⤢ Scale</button><span class="sep"></span><button id="mf-snap" title="Snap to grid (X)">⌗ Snap</button><select id="mf-snapsize" title="Snap size"><option value="0.25">¼ m</option><option value="0.5">½ m</option><option value="1" selected>1 m</option><option value="2">2 m</option><option value="5">5 m</option></select><button id="mf-space" title="Gizmo space: world / local">🌐 World</button><span class="sep"></span><button id="mf-colview" title="Show every collider">▢ Colliders</button></div>
  <div class="mf-hud"><div class="chip" id="mf-hud-tool"></div><div class="chip" id="mf-hud-help"></div><div class="chip"><span id="mf-hud-stats"></span> · <span id="mf-hud-fps"></span></div></div>
  <div class="mf-playhud"><div class="ret"></div><div class="msg"><b>W</b> forward · <b>S</b> back · <b>A</b> left · <b>D</b> right · <b>Space</b> jump · <b>Shift</b> run · mouse looks · <b>Esc</b> back to the editor</div></div>
  <div id="mf-cb" class="mf-cb" hidden>
    <div class="mf-cb-head"><span class="brand">🗂 CONTENT BROWSER</span>
      <button id="mf-cb-addcloud" class="primary" title="Upload a .glb or a sound to the shared cloud (admin) — every player loads it from there">☁ Upload</button><input type="file" id="mf-cb-cloudfile" accept=".glb,.gltf,.mp3,.wav,.ogg,.m4a,model/gltf-binary,audio/*" multiple hidden>
      <button id="mf-cb-embed" title="Embed a .glb in this map only">⤒ Embed .glb</button><button id="mf-cb-url" title="Add a model or sound by URL">🔗 URL</button><button id="mf-cb-refresh" title="Refresh the cloud lists">↻</button>
      <span class="mf-cb-crumbs"></span>
      <input type="text" id="mf-cb-q" placeholder="🔍 Search content…" autocomplete="off"><input type="range" id="mf-cb-size" min="56" max="160" step="8" value="96" title="Tile size"><button id="mf-cb-close" title="Close (Ctrl+Space)">✕</button></div>
    <div class="mf-cb-body"><div class="mf-cb-tree"></div><div class="mf-cb-grid"></div></div>
    <div class="mf-cb-status"></div>
  </div>
  <div class="mf-toast"></div>
  <div class="mf-prompt" id="mf-prompt" hidden></div>
  <div class="mf-bppanel" id="mf-bp" hidden>
    <div class="mf-bp-head"><span id="mf-bp-title">⚡ Event graph</span><span class="spacer"></span><button id="mf-bp-add">＋ Node</button><button id="mf-bp-close" title="Close">✕</button></div>
    <div class="mf-bp-body"><div class="mf-bp-canvas" id="mf-bp-canvas"></div><div class="mf-bp-details" id="mf-bp-details"></div></div>
  </div>
  <div class="mf-help"><div class="box">
    <h2>Athena Engine — controls</h2>
    <table>
      <tr><td>Camera</td><td><kbd>Right-drag</kbd> orbit · <kbd>Middle-drag</kbd> / <kbd>Shift</kbd>+right pan · <kbd>Wheel</kbd> zoom · <kbd>W A S D</kbd> fly, <kbd>Q</kbd>/<kbd>E</kbd> down/up, <kbd>Shift</kbd> faster</td></tr>
      <tr><td>Tools</td><td><kbd>1</kbd> Select <kbd>2</kbd> Sculpt <kbd>3</kbd> Paint <kbd>4</kbd> Place <kbd>5</kbd> Scatter <kbd>6</kbd> Erase</td></tr>
      <tr><td>Sculpt</td><td>Left-drag raises. Hold <kbd>Shift</kbd> to lower, <kbd>Ctrl</kbd> to smooth, <kbd>Alt</kbd> to flatten to the height you started on. <kbd>[</kbd> <kbd>]</kbd> brush radius</td></tr>
      <tr><td>Objects</td><td>Click to select · Unreal hotkeys: <kbd>Q</kbd> select <kbd>W</kbd> move <kbd>E</kbd> rotate <kbd>R</kbd> scale, <kbd>RMB</kbd>+<kbd>WASD</kbd> fly, <kbd>End</kbd> drop to floor (Simple scheme: <kbd>T</kbd>/<kbd>R</kbd>/<kbd>C</kbd>, WASD always flies) · <kbd>X</kbd> snap · <kbd>F</kbd> focus · <kbd>Ctrl+D</kbd> duplicate · <kbd>Del</kbd> remove · drag the green arrow to lift an object</td></tr>
      <tr><td>VFX</td><td>Library → <b>VFX</b> places fire, smoke, steam, fog, sparks, gas, dust and motes; select one for intensity, size and tint. Campfires, craters, generators and wrecks carry their own effect (switch it off in the inspector). Sky tab → <b>Weather</b>: rain, storm with lightning, snow, ash, dust storm, plus wind.</td></tr>
      <tr><td>Collision</td><td>Select an object → <b>Add / Remove collision</b> in the inspector (box or cylinder). Solid things block you in Play; low ones are stepped onto, so crates and bridges are walkable. <b>▢ Colliders</b> shows them all.</td></tr>
      <tr><td>Play</td><td><kbd>P</kbd> walk the map from the first Player Spawn marker · <kbd>W</kbd> forward <kbd>S</kbd> back <kbd>A</kbd> left <kbd>D</kbd> right (arrow keys too) · <kbd>Space</kbd> jump · <kbd>Shift</kbd> run · mouse looks · <kbd>Esc</kbd> returns</td></tr>
      <tr><td>File</td><td><kbd>Ctrl+S</kbd> save · <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> undo / redo · Export writes a .world.json you can Import anywhere</td></tr>
      <tr><td>Water</td><td>One global water level (Water tab). Sculpt below it to make lakes and rivers; Scatter skips underwater ground.</td></tr>
      <tr><td>Models</td><td>Drag a <kbd>.glb</kbd> onto the canvas, or Library → Models → Project / URL. Animated models: select the object and pick a clip, speed and loop in the inspector.</td></tr>
      <tr><td>Blueprints</td><td>Select an object → <b>⚡ Add blueprint</b>: components (Trigger volume, Point light, Rotating, Floating, Tag) and an <b>event graph</b> — Begin Play, On Tick, On Enter / Exit / Interact (E) → Move, Rotate, Scale, Spin, Set visible / tint, Play animation, Effect, Light, Spawn, Destroy, Teleport, Toast, Set variable, Branch, Delay, Call game action. Runs in Play and in the game; the map is untouched afterwards.</td></tr>
      <tr><td>Look</td><td>Sky tab → <b>Look</b>: filmic tone mapping + exposure, bloom (threshold), vignette, ground detail texturing and tile size. Inspector → <b>Material</b>: roughness, metalness and an emissive colour/intensity per object (props and .glb models) — a glowing relic is a slider, not a second prop.</td></tr>
      <tr><td>Performance</td><td>Top bar → <b>Quality</b>: auto (steps down when the frame rate drops), high, medium, low — pixel ratio, shadows, effects. In the game repeated static props are drawn as instanced batches (one draw call per prop mesh, not per placement) and far effects pause; the HUD shows fps, triangles and draw calls.</td></tr>
      <tr><td>Audio</td><td>Library → <b>Sounds</b>: add files the game ships (assets/Audio) or a URL, ▶ previews. A <b>Sound emitter</b> component plays positionally on an object (auto from Begin Play, or via <b>Play sound</b>); Play sound also fires one-shots at the player or in 2D; <b>Stop sound</b> silences a target. Browsers need one click/key before audio starts.</td></tr>
      <tr><td>AI</td><td>Add a <b>Nav agent</b> component and use <b>Move To</b>, <b>Chase</b>, <b>Patrol</b> (waypoint names or <code>folder:Route</code>), <b>Wander</b>, <b>Stop moving</b>, <b>Look at</b>; event <b>On See</b> (range + field of view). Agents walk a navmesh baked from the terrain and colliders — Terrain tab → View → <b>Navmesh</b> shows it. Spawn a prefab whose blueprint chases the player and you have an enemy.</td></tr>
      <tr><td>Physics</td><td>Add a <b>Physics body</b> component (dynamic: mass and gravity; kinematic: moved by the graph, pushes things; box / sphere / cylinder). In Play the terrain, every solid collider and the player are part of the simulation — barrels fall, roll, get shoved. Graph: <b>Impulse</b>, <b>Set velocity</b>, <b>Set body kind</b>, event <b>On Hit</b> (<code>{hit.impact}</code>, <code>{hit.other}</code>). cannon-es, vendored at /vendor.</td></tr>
      <tr><td>Prefabs</td><td><kbd>Ctrl</kbd>+click several objects → <b>📦 Create prefab</b> (or 📦 on a folder). Place instances from Library → Prefabs. <b>✎ Edit prefab</b> unpacks one; <b>⤴ Apply</b> rewrites the prefab and every instance follows. 📚 keeps a prefab on this device for other maps.</td></tr>
      <tr><td>Folders</td><td>Scene tab: content folders hold what you place. Click a folder to target it, drag objects between folders, 👁 hide / 🔒 lock a whole folder. Games read them with <code>world.inFolder('name')</code>.</td></tr>
      <tr><td>Game scenes</td><td>Maps tab → <b>Game scenes</b>: open the Homestead Farm (or any registered game) as a map of 🧩 slots. Move a slot to move that building in the game; select it → <b>Replace</b> to swap in a prop or .glb; add anything else around it. Save → ★ Set live → the game shows it.</td></tr>
      <tr><td>Mini-games</td><td>Maps tab: tag the map with a game and <b>★ Set live</b>. A mini-game then loads it with <code>MythicMapForge.engine.mount(el, { game: 'name' })</code>.</td></tr>
    </table>
    <div style="text-align:right;margin-top:10px"><button data-close="1" class="primary">Got it</button></div>
  </div></div>
  <div class="mf-loading"><div>⚒ Loading Athena Engine</div><div class="sub">fetching three.js…</div></div>
</div>
<div class="mf-right">
  <div class="mf-tabs"><button data-tab="object">Object</button><button data-tab="scene">Scene</button><button data-tab="files">Files</button><button data-tab="terrain">Terrain</button><button data-tab="water">Water</button><button data-tab="sky">Sky</button><button data-tab="menu">Menu</button><button data-tab="maps">Maps</button></div>
  <div class="mf-tab" data-tab="object"><div class="mf-sec"><h3>Inspector</h3><div id="mf-inspector"></div></div></div>
  <div class="mf-tab" data-tab="scene">
    <div class="mf-sec"><h3>Content folders <span class="n">outliner</span></h3>
      <div class="mf-btns" style="margin-bottom:8px"><button id="mf-newfolder">＋ Folder</button><button id="mf-newsub" title="Inside the highlighted folder">＋ Sub-folder</button></div>
      <div class="mf-outliner" id="mf-outliner"></div>
      <p class="mf-hint">Click a folder name to make it the <b>target</b>: everything you place or scatter lands inside it. Drag objects between folders, or set the folder in the inspector. 👁 hides a folder's objects (in the game too), 🔒 keeps them from being picked in the viewport.</p>
    </div>
    <div class="mf-sec" style="padding:0"><h3 style="padding:10px 12px 0">In this map</h3><div id="mf-scene"></div></div>
  </div>
  <div class="mf-tab" data-tab="files">
    <div class="mf-sec"><h3>Uploaded files</h3>
      <div class="mf-btns"><button id="mf-up-btn" class="primary">⤒ Upload</button><select id="mf-up-kind" title="Detected from the file unless you choose"><option value="">auto-detect</option><option value="model">Model</option><option value="anim">Animation</option><option value="audio">Audio</option><option value="vfx">VFX preset</option></select><button id="mf-files-refresh" title="Reload the list">↻</button><input type="file" id="mf-up-file" accept=".glb,.gltf,.mp3,.wav,.ogg,.m4a,.json" multiple hidden></div>
      <p class="mf-hint" id="mf-files-note"></p>
      <div class="mf-cats" id="mf-files-kinds"><button data-kind="all" class="on">All</button><button data-kind="model">🧊 Models</button><button data-kind="anim">🎞 Anims</button><button data-kind="audio">🔊 Audio</button><button data-kind="vfx">✨ VFX</button></div>
    </div>
    <div id="mf-files"></div>
    <div class="mf-sec"><p class="mf-hint" style="margin:0">A model joins this map's Library. An animation applies to the selected model (bone names must match). Audio arms the <b>🔊 Sound</b> marker. A VFX preset is JSON: <code>{"kind":"fire","tint":"#ff8a1a","s":1.5,"i":1,"label":"Torch"}</code>.</p></div>
  </div>
  <div class="mf-tab" data-tab="menu"><div class="mf-sec"><h3>Player &amp; camera</h3><div id="mf-player"></div></div><div class="mf-sec"><h3>Menu button</h3><div id="mf-menu"></div></div></div>
  <div class="mf-tab" data-tab="terrain">
    <div class="mf-sec"><h3>Size</h3>
      <div class="mf-row"><label>Grid</label><select id="mf-t-n"><option>32</option><option>48</option><option>64</option><option>96</option><option>128</option><option>160</option></select></div>
      <div class="mf-row"><label>Cell (m)</label><input type="number" id="mf-t-cell" min="0.5" max="8" step="0.5"></div>
      <div class="mf-row"><label>World</label><span id="mf-t-size" style="color:#cfc7ad"></span></div>
      <button id="mf-t-apply" style="width:100%">Apply size (keeps the shape)</button>
    </div>
    <div class="mf-sec"><h3>Generate</h3>
      <div class="mf-row"><label>Type</label><select id="mf-t-type"><option value="hills">Rolling hills</option><option value="island">Island</option><option value="valley">Valley</option><option value="mountains">Mountains</option></select></div>
      <div class="mf-row"><label>Seed</label><input type="number" id="mf-t-seed" value="1337"><button id="mf-t-seed-rnd" title="Random seed">🎲</button></div>
      <div class="mf-row"><label>Height</label><input type="range" id="mf-t-amp" min="0.5" max="40" step="0.5" value="6"><span class="v" id="mf-t-amp-v">6.0m</span></div>
      <div class="mf-row"><label>Detail</label><input type="range" id="mf-t-scale" min="0.1" max="1.5" step="0.05" value="0.35"><span class="v" id="mf-t-scale-v">0.35</span></div>
      <div class="mf-btns"><button id="mf-t-gen" class="primary">Generate</button><button id="mf-t-flat">Flatten all</button></div>
      <p class="mf-hint">Generating replaces the whole terrain (undo works). Props stay where they are and drop onto the new ground.</p>
    </div>
    <div class="mf-sec"><h3>View</h3>
      <div class="mf-row"><label>Grid</label><input type="checkbox" id="mf-t-grid"></div>
      <div class="mf-row"><label>Markers</label><input type="checkbox" id="mf-t-markers" checked><span class="mf-hint" style="margin:0">spawns, zones, waypoints</span></div>
      <div class="mf-row"><label>Navmesh</label><input type="checkbox" id="mf-t-nav"><span class="mf-hint" style="margin:0">where agents can walk (baked from terrain + colliders)</span></div>
    </div>
  </div>
  <div class="mf-tab" data-tab="water">
    <div class="mf-sec"><h3>Water</h3>
      <div class="mf-row"><label>Enabled</label><input type="checkbox" id="mf-w-on"></div>
      <div class="mf-row"><label>Level</label><input type="range" id="mf-w-level" min="-40" max="40" step="0.1"><span class="v" id="mf-w-level-v"></span></div>
      <div class="mf-row"><label>Colour</label><input type="color" id="mf-w-color"></div>
      <div class="mf-row"><label>Opacity</label><input type="range" id="mf-w-opacity" min="0.1" max="1" step="0.02"><span class="v" id="mf-w-opacity-v"></span></div>
      <div class="mf-row"><label>Waves</label><input type="range" id="mf-w-wave" min="0" max="1.2" step="0.02"><span class="v" id="mf-w-wave-v"></span></div>
      <div class="mf-row"><label>Speed</label><input type="range" id="mf-w-speed" min="0" max="4" step="0.1"><span class="v" id="mf-w-speed-v"></span></div>
      <p class="mf-hint">Water is a single level across the map. Lower the ground beneath it with Sculpt to carve lakes, rivers and coasts.</p>
    </div>
  </div>
  <div class="mf-tab" data-tab="sky">
    <div class="mf-sec"><h3>Time of day</h3>
      <div class="mf-row"><label>Preset</label><select id="mf-e-preset"><option value="day">Day</option><option value="dawn">Dawn</option><option value="dusk">Dusk</option><option value="night">Night</option><option value="overcast">Overcast</option><option value="wasteland">Wasteland</option><option value="fallout">Fallout night</option></select></div>
      <div class="mf-row"><label>Sun height</label><input type="range" id="mf-e-sunEl" min="-10" max="90" step="1"><span class="v" id="mf-e-sunEl-v"></span></div>
      <div class="mf-row"><label>Sun angle</label><input type="range" id="mf-e-sunAz" min="0" max="360" step="1"><span class="v" id="mf-e-sunAz-v"></span></div>
      <div class="mf-row"><label>Sun power</label><input type="range" id="mf-e-sunIntensity" min="0" max="3" step="0.05"><span class="v" id="mf-e-sunIntensity-v"></span></div>
      <div class="mf-row"><label>Sun colour</label><input type="color" id="mf-e-sunColor"></div>
      <div class="mf-row"><label>Shadows</label><input type="checkbox" id="mf-e-shadows"></div>
    </div>
    <div class="mf-sec"><h3>Sky &amp; fog</h3>
      <div class="mf-row"><label>Sky top</label><input type="color" id="mf-e-skyTop"></div>
      <div class="mf-row"><label>Horizon</label><input type="color" id="mf-e-skyBottom"></div>
      <div class="mf-row"><label>Fog</label><input type="color" id="mf-e-fogColor"></div>
      <div class="mf-row"><label>Fog near</label><input type="range" id="mf-e-fogNear" min="1" max="600" step="1"><span class="v" id="mf-e-fogNear-v"></span></div>
      <div class="mf-row"><label>Fog far</label><input type="range" id="mf-e-fogFar" min="10" max="1500" step="5"><span class="v" id="mf-e-fogFar-v"></span></div>
    </div>
    <div class="mf-sec"><h3>Weather &amp; wind</h3>
      <div class="mf-row"><label>Weather</label><select id="mf-e-weather">${Object.keys(WEATHERS).map(k => '<option value="' + k + '">' + WEATHERS[k] + '</option>').join('')}</select></div>
      <div class="mf-row"><label>Amount</label><input type="range" id="mf-e-weatherIntensity" min="0.2" max="3" step="0.1"><span class="v" id="mf-e-weatherIntensity-v"></span></div>
      <div class="mf-row"><label>Wind dir</label><input type="range" id="mf-e-windDir" min="0" max="360" step="5"><span class="v" id="mf-e-windDir-v"></span></div>
      <div class="mf-row"><label>Wind</label><input type="range" id="mf-e-windSpeed" min="0" max="20" step="0.5"><span class="v" id="mf-e-windSpeed-v"></span></div>
      <p class="mf-hint">Storm adds lightning. Wind bends every smoke column and drives rain, snow and ash. Place local effects from Library → VFX: fire, smoke, steam, ground fog, sparks, toxic gas, dust, motes.</p>
    </div>
    <div class="mf-sec"><h3>Look</h3>
      <div class="mf-row"><label>Tone map</label><select id="mf-e-tone"><option value="aces">Filmic (ACES)</option><option value="reinhard">Reinhard</option><option value="linear">Linear</option></select></div>
      <div class="mf-row"><label>Exposure</label><input type="range" id="mf-e-exposure" min="0.2" max="3" step="0.05"><span class="v" id="mf-e-exposure-v"></span></div>
      <div class="mf-row"><label>Bloom</label><input type="range" id="mf-e-bloom" min="0" max="2" step="0.05"><span class="v" id="mf-e-bloom-v"></span></div>
      <div class="mf-row"><label>Threshold</label><input type="range" id="mf-e-bloomThreshold" min="0" max="1" step="0.02"><span class="v" id="mf-e-bloomThreshold-v"></span></div>
      <div class="mf-row"><label>Vignette</label><input type="range" id="mf-e-vignette" min="0" max="1" step="0.02"><span class="v" id="mf-e-vignette-v"></span></div>
      <div class="mf-row"><label>Ground detail</label><input type="range" id="mf-e-terrainDetail" min="0" max="1" step="0.02"><span class="v" id="mf-e-terrainDetail-v"></span></div>
      <div class="mf-row"><label>Ground tile</label><input type="range" id="mf-e-terrainTile" min="0.1" max="2" step="0.05"><span class="v" id="mf-e-terrainTile-v"></span></div>
      <p class="mf-hint">Filmic tone mapping and exposure shape the whole image; bloom makes emissive props, fire and the sun glow (Low quality skips it); ground detail is the per-layer texture on the terrain, tile = repeats per metre.</p>
    </div>
    <div class="mf-sec"><h3>Ambient</h3>
      <div class="mf-row"><label>Sky light</label><input type="color" id="mf-e-ambient"></div>
      <div class="mf-row"><label>Ground</label><input type="color" id="mf-e-groundColor"></div>
      <div class="mf-row"><label>Amount</label><input type="range" id="mf-e-ambientIntensity" min="0" max="2" step="0.05"><span class="v" id="mf-e-ambientIntensity-v"></span></div>
    </div>
  </div>
  <div class="mf-tab" data-tab="maps">
    <div class="mf-sec"><h3>Game scenes</h3>
      <div class="mf-maps" id="mf-gamescenes"></div>
      <p class="mf-hint">A game that draws its own world (the Homestead Farm) registers its scene here. <b>Open scene</b> loads the live map for it, or builds one from the game's layout with one 🧩 <b>slot</b> per game asset. Move a slot and the game moves that asset; select it and <b>Replace</b> it with any prop or model. Save, then ★ Set live and the game loads it.</p>
      <div id="mf-scene-flags"></div>
    </div>
    <div class="mf-sec"><h3>This map</h3>
      <div class="mf-row"><label>Mini-game</label><input type="text" id="mf-game" list="mf-games" maxlength="40" placeholder="sandbox"><datalist id="mf-games"></datalist></div>
      <p class="mf-hint" style="margin:0 0 8px">Pick the mini-game this world belongs to. <b>★ Set live</b> in the list below makes it that game's world: its screen then shows players a <b>🌍 Enter world</b> pill, and you an <b>⚒ Edit map</b> pill that opens the world right here.</p>
      <textarea id="mf-desc" rows="3" maxlength="2000" placeholder="Description (shown in the list)"></textarea>
      <div class="mf-btns" style="margin-top:8px"><button id="mf-new">✦ New map</button></div>
      <p class="mf-hint" id="mf-storage"></p>
    </div>
    <div class="mf-sec"><h3>Saved maps</h3>
      <div class="mf-row"><label>Filter</label><input type="checkbox" id="mf-maps-game"><span class="mf-hint" style="margin:0">only this mini-game</span></div>
      <div class="mf-maps" id="mf-maps"></div></div>
  </div>
</div>`;
