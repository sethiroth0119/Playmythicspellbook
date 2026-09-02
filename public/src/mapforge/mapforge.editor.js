/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.editor.js — World Forge, the in-game 3D map creator.

   A full-screen overlay: sculpt + paint a heightfield, place props and .glb
   models with a gizmo, set water / sky / sun, walk the map in Play mode,
   save to the cloud (sql/038) or this device, export JSON.

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
import { buildWorld } from './mapforge.world.js';
import { newMap, normalize, serialize, clone, uid, PAINT, ENV_PRESETS, resampleTerrain } from './mapforge.format.js';
import { PROP_CATALOG, PROP_BY_ID, buildProp } from './mapforge.props.js';
import * as api from './mapforge.api.js';
import { confirm as askConfirm, signedIn, displayName } from './mapforge.bridge.js';

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
    THREE: null, map: null, source: null, isPublic: false, mine: true, dirty: false,
    tool: 'select', sculptMode: 'raise', brush: { radius: 6, strength: 0.5, falloff: 0.6 },
    paintIdx: 0, propId: 'tree', propTint: null, assetId: null,
    scatter: { count: 6, jitterRot: true, jitterScale: 0.3, avoidWater: true },
    selectedId: null, gizmoMode: 'translate', snap: false, undo: [], redo: [], playing: false,
    showGrid: false, showMarkers: true,
  };
  const teardown = [];
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
  if (!doc) {
    const draft = api.loadDraft();
    if (draft) { doc = draft; S.source = null; setTimeout(() => toast('Restored your unsaved draft — save it or start a New map.', 4200), 600); }
  }
  let freshStart = false;
  if (!doc) { doc = newMap({ author: displayName() }); freshStart = true; }
  if (!ED) return null;

  // ── scene ──
  const canvasHost = $('.mf-canvas');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasHost.insertBefore(renderer.domElement, canvasHost.firstChild);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  let world = null, gridHelper = null;
  ED.camera = camera; ED.scene = scene; ED.renderer = renderer;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const brushRing = makeBrushRing(THREE); scene.add(brushRing);
  let ghost = null;

  // camera controls — real OrbitControls when the addon loaded, a small
  // built-in orbit otherwise, both driven through the same `controls` shape
  const controls = makeControls(THREE, camera, renderer.domElement);
  let gizmo = null;
  if (THREE.TransformControls) {
    gizmo = new THREE.TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.9);
    gizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; if (e.value) beginObjectEdit(); else endObjectEdit(); });
    gizmo.addEventListener('objectChange', onGizmoChange);
    scene.add(gizmo);
  }
  ED.gizmo = gizmo;
  if (missing && missing.length) setTimeout(() => toast('Some editor addons did not load (' + missing.join(', ') + ') — using built-in fallbacks.', 4500), 900);

  function loadDoc(map, source) {
    if (world) { scene.remove(world.group); world.dispose(); }
    if (gridHelper) { scene.remove(gridHelper); gridHelper = null; }
    S.map = map; S.source = source == null ? S.source : source;
    world = buildWorld(THREE, map, { scene, onAssetLoaded: () => {} });
    scene.add(world.group);
    world.setMarkersVisible(S.showMarkers);
    if (S.showGrid) toggleGrid(true);
    S.undo.length = 0; S.redo.length = 0; select(null);
    frameOverview();
    $('.mf-top .name input').value = map.name;
    $('#mf-desc').value = map.description || '';
    renderTerrainTab(); renderWaterTab(); renderSkyTab(); renderStats();
    setDirty(false);
  }
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
    S.tool = t;
    $$('.mf-tools button[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
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
    for (const h of hits) { let o = h.object; while (o && !(o.userData && o.userData.mfId)) o = o.parent; if (o && o.visible) return o; }
    return null;
  }

  let lastMods = { shiftKey: false, ctrlKey: false, altKey: false };
  function onPointerDown(ev) {
    if (S.playing) return;
    renderer.domElement.focus();
    if (ev.button !== 0) return;
    if (gizmo && gizmo.dragging) return;
    if (gizmo && gizmo.object && gizmo.axis) return;     // clicked the gizmo itself (axis goes stale after detach — hence the .object check)
    updatePointer(ev);
    lastMods = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey };
    if (S.tool === 'select') {
      const o = hitObject();
      select(o ? o.userData.mfId : null);
      if (o && !gizmo) { stroke.active = true; stroke.dragObj = o; beginObjectEdit(); }
      return;
    }
    if (S.tool === 'erase') { const o = hitObject(); if (o) { beginObjectEdit(); removeObject(o.userData.mfId); endObjectEdit(); } return; }
    const p = hitTerrain(); if (!p) return;
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
    if (!stroke.active) return;
    stroke.active = false;
    try { renderer.domElement.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (stroke.dragObj) { stroke.dragObj = null; endObjectEdit(); return; }
    if (S.tool === 'scatter') { endObjectEdit(); return; }
    if (stroke.before) {
      pushUndo({ type: 'terrain', before: stroke.before, after: world.terrain.snapshot() });
      stroke.before = null; regroundAll(); setDirty(true);
    }
  }
  const cv = renderer.domElement;
  cv.tabIndex = 0;
  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('pointerleave', () => { stroke.hit = null; });
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
  function beginObjectEdit() { stroke.objBefore = { objects: clone(S.map.objects), assets: clone(S.map.assets) }; }
  function endObjectEdit() {
    if (!stroke.objBefore) return;
    const after = { objects: clone(S.map.objects), assets: clone(S.map.assets) };
    if (JSON.stringify(after) !== JSON.stringify(stroke.objBefore)) { pushUndo({ type: 'objects', before: stroke.objBefore, after }); setDirty(true); }
    stroke.objBefore = null;
  }
  function makeObject(p, extra) {
    const isGlb = S.propId === 'glb';
    const o = { id: uid('o_'), t: isGlb ? 'glb' : S.propId, p: [p.x, world.heightAt(p.x, p.z), p.z], r: [0, 0, 0], s: [1, 1, 1], g: true };
    if (isGlb) { o.a = S.assetId; const fit = assetFit.get(S.assetId); if (fit) o.s = [fit, fit, fit]; }
    else if (S.propTint && PROP_BY_ID[o.t] && PROP_BY_ID[o.t].tint) o.c = S.propTint;
    Object.assign(o, extra || {});
    return o;
  }
  function placeAt(p, selectIt) {
    if (S.propId === 'glb' && !S.assetId) { toast('Add a model URL in the Library first.'); return; }
    const o = makeObject(p, S.scatter.jitterRot && S.tool === 'scatter' ? { r: [0, Math.random() * Math.PI * 2, 0] } : null);
    S.map.objects.push(o); world.addObject(o);
    if (selectIt && S.tool === 'select') select(o.id);
    renderStats();
    return o;
  }
  function scatterAt(p) {
    if (S.propId === 'glb' && !S.assetId) { toast('Add a model URL in the Library first.'); stroke.active = false; return; }
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
  function select(id) {
    S.selectedId = id;
    if (gizmo) { const r = id ? world.objects.get(id) : null; if (r && S.tool === 'select') { gizmo.attach(r); gizmo.setMode(S.gizmoMode); } else gizmo.detach(); }
    renderInspector();
  }
  function onGizmoChange() {
    const o = objById(S.selectedId), r = world.objects.get(S.selectedId); if (!o || !r) return;
    if (gizmo.mode === 'translate' && o.g) {
      if (gizmo.axis === 'Y') o.g = false;      // lifting it = they want it off the ground
      else r.position.y = world.heightAt(r.position.x, r.position.z);
    }
    o.p = [r.position.x, r.position.y, r.position.z]; o.r = [r.rotation.x, r.rotation.y, r.rotation.z]; o.s = [r.scale.x, r.scale.y, r.scale.z];
    setDirty(true); renderInspector();
  }
  function regroundAll() {
    S.map.objects.forEach(o => { if (o.g) { o.p[1] = world.heightAt(o.p[0], o.p[2]); const r = world.objects.get(o.id); if (r) r.position.y = o.p[1]; } });
  }
  function duplicateSelected() {
    const o = objById(S.selectedId); if (!o) return;
    beginObjectEdit();
    const c = clone(o); c.id = uid('o_'); c.p[0] += 1.5; c.p[2] += 1.5; if (c.g) c.p[1] = world.heightAt(c.p[0], c.p[2]);
    S.map.objects.push(c); world.addObject(c); select(c.id); endObjectEdit(); renderStats();
  }
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
  async function addAsset(url, label) {
    url = String(url || '').trim(); if (!url) return;
    if (!/^(https?:\/\/|\/|\.\/)/i.test(url)) { toast('Model URL must start with https:// or /'); return; }
    if (!/\.gl(b|tf)(\?|#|$)/i.test(url)) toast('Expected a .glb / .gltf URL — trying anyway.', 3000);
    if (!THREE.GLTFLoader) { toast('GLTFLoader did not load — custom models unavailable right now.', 3600); return; }
    beginObjectEdit();
    const a = { id: uid('a_'), label: (label || url.split('/').pop().split('?')[0] || 'Model').slice(0, 60), url };
    S.map.assets.push(a);
    endObjectEdit();
    S.propId = 'glb'; S.assetId = a.id; renderLibrary(); refreshGhost();
    toast('Loading ' + a.label + '…', 2000);
    try {
      const { size } = await world.loadAsset(a.id);
      const m = Math.max(size.x, size.y, size.z) || 1;
      assetFit.set(a.id, Math.min(50, Math.max(0.01, 2 / m)));
      toast(a.label + ' ready — click the ground to place it.', 2600);
      refreshGhost();
    } catch (e) { toast('Could not load ' + a.label + ' (' + ((e && e.message) || 'network/CORS') + ').', 4200); }
  }
  function removeAsset(id) {
    beginObjectEdit();
    S.map.assets = S.map.assets.filter(a => a.id !== id);
    S.map.objects.filter(o => o.t === 'glb' && o.a === id).map(o => o.id).forEach(removeObject);
    if (S.assetId === id) { S.assetId = null; if (S.propId === 'glb') S.propId = 'tree'; }
    endObjectEdit(); renderLibrary(); refreshGhost();
  }

  /* placement ghost — a see-through preview under the cursor */
  function refreshGhost() {
    if (ghost) { scene.remove(ghost); ghost = null; }
    if (!(S.tool === 'place' || S.tool === 'scatter')) return;
    const g = S.propId === 'glb' ? buildProp(THREE, 'placeholder') : buildProp(THREE, S.propId, S.propTint);
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
      S.map.objects = clone(snap.objects); S.map.assets = clone(snap.assets);
      Array.from(world.objects.keys()).forEach(id => world.removeObject(id));
      S.map.objects.forEach(o => world.addObject(o));
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

  /* ═══ PLAY MODE ═══ */
  const play = { yaw: 0, pitch: 0, vy: 0, pos: new THREE.Vector3(), keys: {}, savedCam: null, savedTarget: null, grounded: false, lockedAt: 0 };
  ED.play = play;
  function startPlay() {
    if (S.playing) return;
    S.playing = true; canvasHost.classList.add('play');
    play.savedCam = camera.position.clone(); play.savedTarget = controls.target.clone();
    controls.enabled = false; if (gizmo) gizmo.detach(); brushRing.visible = false; if (ghost) ghost.visible = false;
    world.setMarkersVisible(false);
    const sp = world.spawns()[0];
    if (sp) { play.pos.set(sp.p[0], sp.p[1], sp.p[2]); play.yaw = sp.r[1] + Math.PI; }
    else { play.pos.set(controls.target.x, 0, controls.target.z); play.yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z) + Math.PI; }
    play.pos.y = world.heightAt(play.pos.x, play.pos.z); play.pitch = 0; play.vy = 0;
    $('#mf-play').classList.add('on'); $('#mf-play').textContent = '■ Stop';
    try { cv.requestPointerLock(); } catch (e) {}
    cv.focus();
  }
  function stopPlay() {
    if (!S.playing) return;
    S.playing = false; canvasHost.classList.remove('play');
    if (document.pointerLockElement === cv) { try { document.exitPointerLock(); } catch (e) {} }
    controls.enabled = true; camera.position.copy(play.savedCam); controls.target.copy(play.savedTarget); controls.update();
    world.setMarkersVisible(S.showMarkers); play.keys = {};
    $('#mf-play').classList.remove('on'); $('#mf-play').textContent = '▶ Play';
    if (S.selectedId) select(S.selectedId);
  }
  function onPointerLockChange() { if (document.pointerLockElement === cv) play.lockedAt = performance.now(); else if (S.playing) stopPlay(); }
  document.addEventListener('pointerlockchange', onPointerLockChange);
  teardown.push(() => document.removeEventListener('pointerlockchange', onPointerLockChange));
  function onMouseMovePlay(e) {
    if (!S.playing || document.pointerLockElement !== cv) return;
    // Browsers can emit one huge synthetic movement as the cursor recentres on
    // lock; taking it as input snaps the view to the sky. Ignore that burst.
    if (performance.now() - play.lockedAt < 150 || Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
    play.yaw -= e.movementX * 0.0022; play.pitch = Math.max(-1.5, Math.min(1.5, play.pitch - e.movementY * 0.0022)); }
  document.addEventListener('mousemove', onMouseMovePlay);
  teardown.push(() => document.removeEventListener('mousemove', onMouseMovePlay));
  function playFrame(dt) {
    const k = play.keys, speed = (k.shift ? 11 : 6), fwd = new THREE.Vector3(-Math.sin(play.yaw), 0, -Math.cos(play.yaw)), right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const mv = new THREE.Vector3();
    if (k.w) mv.add(fwd); if (k.s) mv.sub(fwd); if (k.d) mv.add(right); if (k.a) mv.sub(right);
    const half = world.terrain.half - 0.5;
    const inWater = S.map.water.on && play.pos.y + 0.9 < S.map.water.level;
    if (mv.lengthSq()) { mv.normalize().multiplyScalar(speed * (inWater ? 0.45 : 1) * dt); play.pos.x = Math.max(-half, Math.min(half, play.pos.x + mv.x)); play.pos.z = Math.max(-half, Math.min(half, play.pos.z + mv.z)); }
    const ground = world.heightAt(play.pos.x, play.pos.z);
    if (inWater) { play.vy += (k.space ? 6 : -2) * dt; play.vy *= 0.92; if (play.pos.y + 0.9 > S.map.water.level - 0.2 && play.vy > 0 && !k.space) play.vy = 0; }
    else { play.vy -= 22 * dt; if (play.grounded && k.space) { play.vy = 7.5; play.grounded = false; } }
    play.pos.y += play.vy * dt;
    if (play.pos.y <= ground) { play.pos.y = ground; play.vy = 0; play.grounded = true; } else play.grounded = inWater ? true : false;
    camera.position.set(play.pos.x, play.pos.y + 1.7, play.pos.z);
    const look = new THREE.Vector3(-Math.sin(play.yaw) * Math.cos(play.pitch), Math.sin(play.pitch), -Math.cos(play.yaw) * Math.cos(play.pitch));
    camera.lookAt(camera.position.clone().add(look));
  }

  /* ═══ KEYBOARD ═══ */
  const fly = { keys: {} };
  function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function onKeyDown(e) {
    if (!ED) return;
    if ($('.mf-help').classList.contains('on') && e.key === 'Escape') { $('.mf-help').classList.remove('on'); return; }
    if (isTyping(e)) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key.toLowerCase();
    if (S.playing) {
      if (k === 'escape') { stopPlay(); return; }
      if (k === ' ') { play.keys.space = true; e.preventDefault(); }
      if (['w', 'a', 's', 'd', 'shift'].includes(k)) { play.keys[k] = true; e.preventDefault(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(k) && !e.ctrlKey && !e.metaKey && !e.altKey) { fly.keys[k] = true; if (k !== 'shift') e.preventDefault(); return; }
    switch (k) {
      case '1': setTool('select'); break; case '2': setTool('sculpt'); break; case '3': setTool('paint'); break;
      case '4': setTool('place'); break; case '5': setTool('scatter'); break; case '6': setTool('erase'); break;
      case 't': setGizmoMode('translate'); break; case 'r': setGizmoMode('rotate'); break; case 'c': setGizmoMode('scale'); break;
      case 'x': S.snap = !S.snap; applySnap(); renderHud(); break;
      case 'f': focusSelected(); break;
      case 'delete': case 'backspace': if (S.selectedId) { beginObjectEdit(); removeObject(S.selectedId); endObjectEdit(); } break;
      case 'escape': select(null); break;
      case '[': S.brush.radius = Math.max(0.5, S.brush.radius * 0.85); renderBrush(); break;
      case ']': S.brush.radius = Math.min(60, S.brush.radius * 1.18); renderBrush(); break;
      case 'p': togglePlay(); break;
      case 'h': $('.mf-help').classList.toggle('on'); break;
      default: return;
    }
    e.preventDefault();
  }
  function onKeyUp(e) { const k = e.key.toLowerCase(); fly.keys[k] = false; play.keys[k] = false; if (k === ' ') play.keys.space = false; }
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
  function setGizmoMode(m) { S.gizmoMode = m; if (gizmo) gizmo.setMode(m); $$('.mf-gizmo button[data-gm]').forEach(b => b.classList.toggle('on', b.dataset.gm === m)); }
  function applySnap() { if (!gizmo) return; gizmo.setTranslationSnap(S.snap ? 1 : null); gizmo.setRotationSnap(S.snap ? THREE.MathUtils.degToRad(15) : null); gizmo.setScaleSnap(S.snap ? 0.25 : null); $('#mf-snap').classList.toggle('on', S.snap); }
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
    const source = forceSource || S.source || (signedIn() ? 'cloud' : 'local');
    const btn = $('#mf-save'); btn.disabled = true;
    const r = await api.saveMap(S.map, source, source === 'cloud' ? S.isPublic : undefined);
    btn.disabled = false;
    if (!r.ok) { toast('Save failed: ' + (r.error || 'unknown error'), 5000); return false; }
    S.source = r.source; setDirty(false); api.clearDraft();
    if (r.fellBack) toast(r.missing ? 'Cloud maps are not set up yet (run sql/038) — saved on this device instead.' : r.offline ? 'Not signed in — saved on this device.' : 'Cloud save failed (' + r.error + ') — saved on this device instead.', 5200);
    else toast(r.source === 'cloud' ? '☁ Saved to the cloud.' : '💾 Saved on this device.');
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
      } catch (e) { toast('That file is not a World Forge map.', 3200); }
    };
    rd.readAsText(file);
  }
  async function newMapFlow() {
    if (S.dirty && !(await askConfirm('Discard unsaved changes and start a new map?'))) return;
    const m = newMap({ author: displayName() });
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
    cancelAnimationFrame(raf);
    teardown.forEach(f => { try { f(); } catch (e) {} });
    try { if (world) world.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
    root.remove(); document.body.style.overflow = prevOverflow;
    ED = null;
    try { if (opts.onClose) opts.onClose(); } catch (e) {}
  }
  ED.close = () => close(false);
  // For code that edits S.map directly (tests, future game hooks): refresh the chrome.
  ED.refresh = () => { renderStats(); renderInspector(); renderLibrary(); };

  /* ═══ UI RENDERERS ═══ */
  function renderHud() {
    const b = S.brush;
    const tool = { select: 'Select', sculpt: 'Sculpt · ' + S.sculptMode, paint: 'Paint · ' + PAINT[S.paintIdx].label, place: 'Place · ' + propLabel(), scatter: 'Scatter · ' + propLabel(), erase: 'Erase' }[S.tool];
    $('#mf-hud-tool').innerHTML = '<b>' + esc(tool) + '</b>' + (S.tool === 'sculpt' || S.tool === 'paint' || S.tool === 'scatter' ? ' · radius ' + b.radius.toFixed(1) + 'm' : '') + (S.snap ? ' · snap' : '');
    $('#mf-hud-help').innerHTML = { select: 'Click an object · <b>T/R/C</b> move/rotate/scale · <b>F</b> focus · <b>Del</b> remove · <b>Ctrl+D</b> duplicate', sculpt: 'Drag to raise · <b>Shift</b> lower · <b>Ctrl</b> smooth · <b>Alt</b> flatten · <b>[ ]</b> radius', paint: 'Drag to paint the selected layer · <b>[ ]</b> radius', place: 'Click the ground to place · pick a prop in the Library', scatter: 'Drag to scatter several props · <b>[ ]</b> radius', erase: 'Click an object to remove it' }[S.tool];
  }
  function propLabel() { if (S.propId === 'glb') { const a = S.map.assets.find(x => x.id === S.assetId); return a ? a.label : 'model'; } return (PROP_BY_ID[S.propId] || {}).label || S.propId; }
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
  let libCat = 'Nature';
  function renderLibrary() {
    const cats = ['Nature', 'Structures', 'Props', 'Markers', 'Models'];
    $('#mf-cats').innerHTML = cats.map(c => '<button data-cat="' + c + '" class="' + (c === libCat ? 'on' : '') + '">' + c + '</button>').join('');
    $$('#mf-cats button').forEach(b => b.onclick = () => { libCat = b.dataset.cat; renderLibrary(); });
    const grid = $('#mf-props'), models = $('#mf-models');
    if (libCat === 'Models') {
      grid.innerHTML = ''; models.style.display = '';
      $('#mf-assets').innerHTML = S.map.assets.length ? S.map.assets.map(a => '<div class="mf-asset ' + (S.propId === 'glb' && S.assetId === a.id ? 'on' : '') + '" data-asset="' + a.id + '"><span>🧊</span><span class="lb" title="' + esc(a.url) + '">' + esc(a.label) + '</span><span class="x" title="Remove model and every placed copy">✕</span></div>').join('') : '<div class="mf-empty">No custom models yet. Paste a .glb URL below — files in /models/ work too (see /models/README.md).</div>';
      $$('#mf-assets .mf-asset').forEach(el => {
        el.onclick = (e) => { if (e.target.classList.contains('x')) { removeAsset(el.dataset.asset); return; } S.propId = 'glb'; S.assetId = el.dataset.asset; if (S.tool === 'select' || S.tool === 'erase') setTool('place'); renderLibrary(); refreshGhost(); renderHud(); };
      });
    } else {
      models.style.display = 'none';
      grid.innerHTML = PROP_CATALOG.filter(p => p.cat === libCat).map(p => '<button data-prop="' + p.id + '" class="' + (S.propId === p.id ? 'on' : '') + '" title="' + esc(p.label) + '"><span class="ic">' + p.icon + '</span>' + esc(p.label) + '</button>').join('');
      $$('#mf-props button').forEach(b => b.onclick = () => { S.propId = b.dataset.prop; if (S.tool === 'select' || S.tool === 'erase') setTool('place'); renderLibrary(); refreshGhost(); renderHud(); });
    }
    const tintable = S.propId !== 'glb' && PROP_BY_ID[S.propId] && PROP_BY_ID[S.propId].tint;
    $('#mf-tint-row').style.display = tintable ? '' : 'none';
    $('#mf-tint-on').checked = !!S.propTint;
  }
  function renderInspector() {
    const box = $('#mf-inspector'); const o = objById(S.selectedId);
    if (!o) { box.innerHTML = '<div class="mf-empty">Nothing selected. Use <b>Select</b> (1) and click an object, or pick a prop from the Library and click the ground to place it.</div>'; return; }
    const meta = PROP_BY_ID[o.t] || { label: o.t === 'glb' ? 'Model' : o.t, icon: o.t === 'glb' ? '🧊' : '🧩' };
    const label = o.t === 'glb' ? ((S.map.assets.find(a => a.id === o.a) || {}).label || 'Model') : meta.label;
    const deg = (r) => Math.round(r * 180 / Math.PI * 10) / 10;
    const f = (v) => Math.round(v * 100) / 100;
    box.innerHTML = `
      <div class="mf-row"><label>Name</label><input type="text" id="mf-o-name" value="${esc(o.n || '')}" placeholder="${esc(label)}" maxlength="60"></div>
      <div class="mf-row"><label>Type</label><div style="flex:1;color:#cfc7ad">${meta.icon || ''} ${esc(label)}</div></div>
      <div class="mf-row3"><label>Position</label><input type="number" step="0.1" data-f="p" data-i="0" value="${f(o.p[0])}"><input type="number" step="0.1" data-f="p" data-i="1" value="${f(o.p[1])}"><input type="number" step="0.1" data-f="p" data-i="2" value="${f(o.p[2])}"></div>
      <div class="mf-row3"><label>Rotation°</label><input type="number" step="5" data-f="r" data-i="0" value="${deg(o.r[0])}"><input type="number" step="5" data-f="r" data-i="1" value="${deg(o.r[1])}"><input type="number" step="5" data-f="r" data-i="2" value="${deg(o.r[2])}"></div>
      <div class="mf-row3"><label>Scale</label><input type="number" step="0.1" min="0.01" data-f="s" data-i="0" value="${f(o.s[0])}"><input type="number" step="0.1" min="0.01" data-f="s" data-i="1" value="${f(o.s[1])}"><input type="number" step="0.1" min="0.01" data-f="s" data-i="2" value="${f(o.s[2])}"></div>
      <div class="mf-row"><label>Uniform</label><input type="range" id="mf-o-uni" min="0.05" max="6" step="0.05" value="${Math.max(0.05, Math.min(6, o.s[0]))}"><span class="v" id="mf-o-uni-v">${f(o.s[0])}×</span></div>
      ${meta.tint ? `<div class="mf-row"><label>Tint</label><input type="color" id="mf-o-tint" value="${o.c || '#ffffff'}"><button id="mf-o-untint" style="flex:1">Default colour</button></div>` : ''}
      <div class="mf-row"><label>Grounded</label><input type="checkbox" id="mf-o-ground" ${o.g ? 'checked' : ''}><span class="mf-hint" style="margin:0">follows the terrain height</span></div>
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
    const tint = box.querySelector('#mf-o-tint'); if (tint) { tint.oninput = () => { o.c = tint.value; world.refreshObject(o); setDirty(true); }; tint.onpointerdown = () => beginObjectEdit(); tint.onchange = () => endObjectEdit(); box.querySelector('#mf-o-untint').onclick = () => commit(() => { delete o.c; }); }
    box.querySelector('#mf-o-ground').onchange = (e) => commit(() => { o.g = e.target.checked; if (o.g) o.p[1] = world.heightAt(o.p[0], o.p[2]); });
    box.querySelector('#mf-o-drop').onclick = () => commit(() => { o.p[1] = world.heightAt(o.p[0], o.p[2]); });
    box.querySelector('#mf-o-dup').onclick = duplicateSelected;
    box.querySelector('#mf-o-focus').onclick = focusSelected;
    box.querySelector('#mf-o-del').onclick = () => { beginObjectEdit(); removeObject(o.id); endObjectEdit(); };
  }
  function renderStats() {
    const m = S.map; if (!m) return;
    $('#mf-hud-stats').innerHTML = '<b>' + m.objects.length + '</b> objects · <b>' + m.terrain.n + '×' + m.terrain.n + '</b> · ' + (m.terrain.n * m.terrain.cell) + 'm';
  }
  function renderTerrainTab() {
    const t = S.map.terrain; $('#mf-t-n').value = t.n; $('#mf-t-cell').value = t.cell;
    $('#mf-t-size').textContent = (t.n * t.cell) + ' m × ' + (t.n * t.cell) + ' m';
    $('#mf-t-grid').checked = S.showGrid; $('#mf-t-markers').checked = S.showMarkers;
  }
  function renderWaterTab() {
    const w = S.map.water; $('#mf-w-on').checked = w.on; $('#mf-w-level').value = w.level; $('#mf-w-level-v').textContent = w.level.toFixed(1) + 'm';
    $('#mf-w-color').value = w.color; $('#mf-w-opacity').value = w.opacity; $('#mf-w-opacity-v').textContent = Math.round(w.opacity * 100) + '%';
    $('#mf-w-wave').value = w.wave; $('#mf-w-wave-v').textContent = w.wave.toFixed(2); $('#mf-w-speed').value = w.speed; $('#mf-w-speed-v').textContent = w.speed.toFixed(1) + '×';
  }
  function renderSkyTab() {
    const e = S.map.env; $('#mf-e-preset').value = e.preset;
    ['skyTop', 'skyBottom', 'fogColor', 'sunColor', 'ambient', 'groundColor'].forEach(k => { $('#mf-e-' + k).value = e[k]; });
    [['fogNear', 0], ['fogFar', 0], ['sunEl', 0], ['sunAz', 0], ['sunIntensity', 2], ['ambientIntensity', 2]].forEach(([k, d]) => { $('#mf-e-' + k).value = e[k]; $('#mf-e-' + k + '-v').textContent = (+e[k]).toFixed(d); });
    $('#mf-e-shadows').checked = e.shadows !== false;
  }
  async function renderMapsTab() {
    const list = $('#mf-maps'); list.innerHTML = '<div class="mf-empty">Loading…</div>';
    const r = await api.listMaps();
    if (!ED) return;
    $('#mf-storage').textContent = r.cloudOk ? '☁ Cloud maps on · signed in as ' + displayName() : r.offline ? '💾 Not signed in — maps save on this device only' : r.cloudMissing ? '💾 Cloud table not set up yet (run sql/038_world_maps.sql) — saving on this device' : '⚠ Cloud unavailable: ' + (r.error || '') + ' — saving on this device';
    if (!r.rows.length) { list.innerHTML = '<div class="mf-empty">No saved maps yet. Build something and press Save.</div>'; return; }
    list.innerHTML = r.rows.map(row => `
      <div class="mf-map ${row.id === S.map.id ? 'cur' : ''}" data-id="${esc(row.id)}" data-src="${row.source}">
        <div class="t"><span>${row.source === 'cloud' ? '☁' : '💾'}</span><span>${esc(row.name)}</span>${row.is_public ? '<span class="tag pub">public</span>' : ''}${!row.mine ? '<span class="tag">by ' + esc(row.owner_name || 'someone') + '</span>' : '<span class="tag ' + (row.source === 'cloud' ? 'cloud' : '') + '">' + row.source + '</span>'}</div>
        <div class="m">${esc(row.description || '')}${row.description ? ' · ' : ''}${row.updated_at ? new Date(row.updated_at).toLocaleString() : ''}</div>
        <div class="acts"><button data-act="open">Open</button>${row.mine ? (row.source === 'local' && r.cloudOk ? '<button data-act="upload">☁ Upload</button>' : '') + (row.source === 'cloud' ? '<button data-act="pub">' + (row.is_public ? 'Make private' : 'Make public') + '</button>' : '') + '<button data-act="del" class="danger">Delete</button>' : ''}</div>
      </div>`).join('');
    list.querySelectorAll('.mf-map').forEach(el => {
      const id = el.dataset.id, src = el.dataset.src;
      el.querySelector('[data-act="open"]').onclick = () => openMap(id, src);
      const del = el.querySelector('[data-act="del"]'); if (del) del.onclick = async () => { if (!(await askConfirm('Delete this map permanently?'))) return; const d = await api.deleteMap(id, src); toast(d.ok ? 'Deleted.' : 'Delete failed: ' + d.error); if (d.ok && id === S.map.id) { S.source = null; setDirty(true); } renderMapsTab(); };
      const up = el.querySelector('[data-act="upload"]'); if (up) up.onclick = async () => { const m = api.localLoad(id); if (!m) return; const s = await api.cloudSave(m, false); if (s.ok) { api.localDelete(id); if (id === S.map.id) { S.source = 'cloud'; setDirty(S.dirty); } toast('☁ Uploaded.'); } else toast('Upload failed: ' + (s.error || 'unknown'), 4000); renderMapsTab(); };
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
  $('#mf-asset-add').onclick = () => { addAsset($('#mf-asset-url').value, $('#mf-asset-label').value); $('#mf-asset-url').value = ''; $('#mf-asset-label').value = ''; };
  $('#mf-asset-url').onkeydown = e => { if (e.key === 'Enter') $('#mf-asset-add').click(); };

  $$('.mf-tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  function showTab(t) { $$('.mf-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $$('.mf-tab').forEach(p => p.classList.toggle('on', p.dataset.tab === t)); if (t === 'maps') renderMapsTab(); }

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
  $('#mf-t-amp').oninput = e => { $('#mf-t-amp-v').textContent = (+e.target.value).toFixed(1) + 'm'; };
  $('#mf-t-scale').oninput = e => { $('#mf-t-scale-v').textContent = (+e.target.value).toFixed(2); };

  // water tab
  const wBind = (id, key, fmt) => { const el = $('#mf-w-' + id); el.oninput = () => { const w = S.map.water; w[key] = el.type === 'checkbox' ? el.checked : el.type === 'color' ? el.value : +el.value; world.applyWater(w); settingsChanged(); renderWaterTab(); }; el.onchange = el.oninput; };
  wBind('on', 'on'); wBind('level', 'level'); wBind('color', 'color'); wBind('opacity', 'opacity'); wBind('wave', 'wave'); wBind('speed', 'speed');
  // sky tab
  const eBind = (key) => { const el = $('#mf-e-' + key); const h = () => { const e = S.map.env; e[key] = el.type === 'checkbox' ? el.checked : el.type === 'color' ? el.value : +el.value; world.applyEnv(e); settingsChanged(); renderSkyTab(); }; el.oninput = h; el.onchange = h; };
  ['skyTop', 'skyBottom', 'fogColor', 'fogNear', 'fogFar', 'sunEl', 'sunAz', 'sunIntensity', 'sunColor', 'ambient', 'ambientIntensity', 'groundColor', 'shadows'].forEach(eBind);
  $('#mf-e-preset').onchange = e => { const p = ENV_PRESETS[e.target.value]; if (!p) return; Object.assign(S.map.env, p, { preset: e.target.value }); world.applyEnv(S.map.env); settingsChanged(); renderSkyTab(); };

  // maps tab
  $('#mf-new').onclick = newMapFlow;
  $('#mf-desc').onchange = e => { S.map.description = e.target.value.slice(0, 2000); setDirty(true); };
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
  $$('.mf-gizmo button[data-gm]').forEach(b => b.onclick = () => setGizmoMode(b.dataset.gm));
  $('#mf-snap').onclick = () => { S.snap = !S.snap; applySnap(); renderHud(); };
  if (!gizmo) { $$('.mf-gizmo button[data-gm]').forEach(b => { b.disabled = true; b.title = 'TransformControls did not load — drag objects on the ground, or type values in the inspector'; }); }

  renderBrush(); renderPalette(); renderLibrary(); renderInspector(); setTool('select'); setGizmoMode('translate'); showTab('object'); renderUndo();
  setDirty(freshStart ? false : S.dirty);
  loading.remove();
  if (freshStart) setTimeout(() => toast('Welcome to World Forge — press H for the controls.', 4000), 400);

  /* ═══ LOOP ═══ */
  let raf = 0, last = performance.now(), fpsN = 0, fpsT = 0;
  const ringPts = brushRing.geometry.attributes.position;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.playing) playFrame(dt);
    else { flyFrame(dt); controls.update(); applyStrokeFrame(dt); }
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
    renderer.render(scene, camera);
    fpsN++; fpsT += dt; if (fpsT >= 0.5) { $('#mf-hud-fps').textContent = Math.round(fpsN / fpsT) + ' fps · ' + renderer.info.render.triangles.toLocaleString() + ' tris'; fpsN = 0; fpsT = 0; }
  }
  raf = requestAnimationFrame(frame);
  return ED;
}

export function closeEditor() { if (ED) ED.close(); }

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
  <span class="brand">⚒ World Forge</span>
  <span class="name"><input type="text" maxlength="80" placeholder="Map name"></span>
  <span class="state">New map</span>
  <span class="spacer"></span>
  <span class="grp"><button id="mf-undo" title="Undo (Ctrl+Z)">↶</button><button id="mf-redo" title="Redo (Ctrl+Y)">↷</button></span>
  <span class="grp"><button id="mf-overview" title="Frame the whole map">⌂ Overview</button><button id="mf-play" title="Walk the map (P)">▶ Play</button></span>
  <span class="grp"><button id="mf-save" class="primary" title="Save (Ctrl+S)">💾 Save</button><button id="mf-save-local" title="Save a copy on this device only">⇩ Device</button><button id="mf-export" title="Download as JSON">⤓ Export</button><button id="mf-import" title="Open a JSON export">⤒ Import</button><input type="file" id="mf-file" accept=".json,application/json" hidden></span>
  <span class="grp"><button id="mf-help-btn" title="Controls (H)">?</button><button id="mf-close" class="danger" title="Close the editor">✕</button></span>
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
  <div class="mf-sec"><h3>Library</h3>
    <div class="mf-cats" id="mf-cats"></div>
    <div class="mf-props" id="mf-props"></div>
    <div id="mf-models" style="display:none">
      <div class="mf-assets" id="mf-assets"></div>
      <div style="margin-top:8px"><input type="text" id="mf-asset-url" placeholder="https://…/model.glb  or  /models/x.glb"></div>
      <div style="display:flex;gap:5px;margin-top:5px"><input type="text" id="mf-asset-label" placeholder="Label (optional)" maxlength="60"><button id="mf-asset-add">Add</button></div>
      <p class="mf-hint">Models load from a URL, so they must allow cross-origin requests (files under /models/ always do). Y-up, metres, origin at the base — see /models/README.md.</p>
    </div>
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
  <div class="mf-gizmo"><button data-gm="translate" title="Move (T)">✥ Move</button><button data-gm="rotate" title="Rotate (R)">⟳ Rotate</button><button data-gm="scale" title="Scale (C)">⤢ Scale</button><button id="mf-snap" title="Snap to grid (X)">⌗ Snap</button></div>
  <div class="mf-hud"><div class="chip" id="mf-hud-tool"></div><div class="chip" id="mf-hud-help"></div><div class="chip"><span id="mf-hud-stats"></span> · <span id="mf-hud-fps"></span></div></div>
  <div class="mf-playhud"><div class="ret"></div><div class="msg">WASD move · Space jump · Shift run · <b>Esc</b> back to the editor</div></div>
  <div class="mf-toast"></div>
  <div class="mf-help"><div class="box">
    <h2>World Forge — controls</h2>
    <table>
      <tr><td>Camera</td><td><kbd>Right-drag</kbd> orbit · <kbd>Middle-drag</kbd> / <kbd>Shift</kbd>+right pan · <kbd>Wheel</kbd> zoom · <kbd>W A S D</kbd> fly, <kbd>Q</kbd>/<kbd>E</kbd> down/up, <kbd>Shift</kbd> faster</td></tr>
      <tr><td>Tools</td><td><kbd>1</kbd> Select <kbd>2</kbd> Sculpt <kbd>3</kbd> Paint <kbd>4</kbd> Place <kbd>5</kbd> Scatter <kbd>6</kbd> Erase</td></tr>
      <tr><td>Sculpt</td><td>Left-drag raises. Hold <kbd>Shift</kbd> to lower, <kbd>Ctrl</kbd> to smooth, <kbd>Alt</kbd> to flatten to the height you started on. <kbd>[</kbd> <kbd>]</kbd> brush radius</td></tr>
      <tr><td>Objects</td><td>Click to select · <kbd>T</kbd> move <kbd>R</kbd> rotate <kbd>C</kbd> scale <kbd>X</kbd> snap · <kbd>F</kbd> focus · <kbd>Ctrl+D</kbd> duplicate · <kbd>Del</kbd> remove · drag the green gizmo arrow up to lift an object off the ground</td></tr>
      <tr><td>Play</td><td><kbd>P</kbd> walk the map from the first Player Spawn marker · <kbd>Esc</kbd> returns</td></tr>
      <tr><td>File</td><td><kbd>Ctrl+S</kbd> save · <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> undo / redo · Export writes a .world.json you can Import anywhere</td></tr>
      <tr><td>Water</td><td>One global water level (Water tab). Sculpt below it to make lakes and rivers; Scatter skips underwater ground.</td></tr>
    </table>
    <div style="text-align:right;margin-top:10px"><button data-close="1" class="primary">Got it</button></div>
  </div></div>
  <div class="mf-loading"><div>⚒ Loading World Forge</div><div class="sub">fetching three.js…</div></div>
</div>
<div class="mf-right">
  <div class="mf-tabs"><button data-tab="object">Object</button><button data-tab="terrain">Terrain</button><button data-tab="water">Water</button><button data-tab="sky">Sky</button><button data-tab="maps">Maps</button></div>
  <div class="mf-tab" data-tab="object"><div class="mf-sec"><h3>Inspector</h3><div id="mf-inspector"></div></div></div>
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
      <div class="mf-row"><label>Preset</label><select id="mf-e-preset"><option value="day">Day</option><option value="dawn">Dawn</option><option value="dusk">Dusk</option><option value="night">Night</option><option value="overcast">Overcast</option></select></div>
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
    <div class="mf-sec"><h3>Ambient</h3>
      <div class="mf-row"><label>Sky light</label><input type="color" id="mf-e-ambient"></div>
      <div class="mf-row"><label>Ground</label><input type="color" id="mf-e-groundColor"></div>
      <div class="mf-row"><label>Amount</label><input type="range" id="mf-e-ambientIntensity" min="0" max="2" step="0.05"><span class="v" id="mf-e-ambientIntensity-v"></span></div>
    </div>
  </div>
  <div class="mf-tab" data-tab="maps">
    <div class="mf-sec"><h3>This map</h3>
      <textarea id="mf-desc" rows="3" maxlength="2000" placeholder="Description (shown in the list)"></textarea>
      <div class="mf-btns" style="margin-top:8px"><button id="mf-new">✦ New map</button></div>
      <p class="mf-hint" id="mf-storage"></p>
    </div>
    <div class="mf-sec"><h3>Saved maps</h3><div class="mf-maps" id="mf-maps"></div></div>
  </div>
</div>`;
