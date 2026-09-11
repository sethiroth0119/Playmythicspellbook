/* mapforge.world.js — turn a map document into a live three.js scene.

   This is the RUNTIME half and it is deliberately editor-free: the game can
   call buildWorld(window.THREE, mapJson, { scene }) from anywhere that has a
   scene (the 3D battle board, a hub, node-city, any mini-game) and get back
   terrain, water, sky, lights and every placed object, plus heightAt(x,z)
   for walking on it and animation playback for .glb models. The editor uses
   this exact function and layers its tools on top, which is what guarantees
   "what you built is what the game loads". */

import { createTerrain } from './mapforge.terrain.js';
import { createWater } from './mapforge.water.js';
import { buildProp, PROP_BY_ID, collides } from './mapforge.props.js';
import { createEmitter, createWeather, windVector, EMITTERS } from './mapforge.vfx.js';
import { createActors, hasBehaviour } from './mapforge.actors.js';
import { ensureCannon, createPhysics } from './mapforge.physics.js';
import { createNav } from './mapforge.nav.js';
import { createAudio } from './mapforge.audio.js';

export function buildWorld(THREE, map, opts) {
  opts = opts || {};
  const group = new THREE.Group(); group.name = 'mf-world';
  const objectsGroup = new THREE.Group(); objectsGroup.name = 'mf-objects';
  const terrain = createTerrain(THREE, map.terrain);
  const water = createWater(THREE, map.water, terrain.size);
  const sky = makeSky(THREE);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  sun.target.position.set(0, 0, 0);
  /* Pieces a host can leave out: a game-scene OVERLAY (Homestead Farm) keeps
     its own ground, sky and lights and only takes the objects. The map's own
     `scene` flags are the default; explicit opts win. The terrain object is
     still built (heightAt / grounding need it) — it is just not in the group. */
  const want = (k, dflt) => opts[k] != null ? !!opts[k] : dflt;
  const sceneFlags = map.scene || {};
  const pieces = { ground: want('ground', sceneFlags.ground !== false), water: want('water', sceneFlags.water !== false), sky: want('sky', sceneFlags.sky !== false), lights: want('lights', true) };
  if (pieces.ground) group.add(terrain.mesh);
  if (pieces.water) group.add(water.mesh);
  if (pieces.sky) group.add(sky);
  if (pieces.lights) group.add(sun, sun.target, hemi);
  group.add(objectsGroup);
  const folderOf = (id) => (map.folders || []).find(f => f.id === id) || null;
  /* A folder is visible only if every ancestor is; hidden folders hide their
     objects in the editor AND at runtime (a hidden folder is how a builder
     parks alternatives without deleting them). */
  function folderVisible(id) { let f = folderOf(id), hops = 0; while (f && hops++ < 200) { if (f.vis === false) return false; f = f.parent ? folderOf(f.parent) : null; } return true; }
  function applyFolderVisibility() { objects.forEach((r, id) => { const o = objDoc(id); const v = !o || !o.f || folderVisible(o.f); r.userData.mfFolderHidden = !v; r.visible = v && !(r.userData.mfMarker && !markersVisible); syncInstance(id); }); }

  const objects = new Map();        // id → root Object3D
  const parts = new Map();          // 'instanceId:childId' → a prefab instance's child root
  /* ── instancing (runtime only; the editor keeps per-object meshes for picking) ──
     Repeated STATIC props — same prop, same tint, no blueprint, no effect — are
     drawn as InstancedMesh batches: one draw call per template mesh instead of
     one per placement, which is what turns 400 scattered pines from 1,200 draw
     calls into three. Each object still has its root (transform, bounds → the
     collider); only its meshes are hidden and the batch draws in their place.
     Removing / hiding an instanced object collapses its instance to zero scale
     (sync); batches rebuild lazily when objects are added. */
  const INSTANCE_MIN = 3;
  let instancing = opts.instancing === true, batches = new Map(), batchDirty = false;
  const batchGroup = new THREE.Group(); batchGroup.name = 'mf-batches';
  group.add(batchGroup);   // (objectsGroup was added above, before this section is declared)
  const _m4 = new THREE.Matrix4(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function instanceKey(o) {
    if (!instancing || !o || o.t === 'glb' || o.t === 'prefab' || o.t === 'slot' || o.t.indexOf('fx_') === 0) return null;
    const m = PROP_BY_ID[o.t]; if (!m || m.marker || m.fx || m.fxKind) return null;
    if (o.bp && hasBehaviour(o)) return null;   // it may move, animate or be destroyed
    if (o.mat) return null;                     // its own material, not the template's
    return o.t + '|' + (o.c || '');
  }
  function rebuildBatches() {
    batchDirty = false;
    batches.forEach(b => { b.meshes.forEach(im => { batchGroup.remove(im); im.dispose(); }); b.ids.forEach(id => { const r = objects.get(id); if (r) { r.traverse(x => { if (x.isMesh) x.visible = true; }); delete r.userData.mfInstanced; } }); });
    batches.clear();
    if (!instancing) return;
    const groups = new Map();
    map.objects.forEach(o => { const k = instanceKey(o); if (!k || !objects.has(o.id)) return; (groups.get(k) || groups.set(k, []).get(k)).push(o.id); });
    groups.forEach((ids, key) => {
      if (ids.length < INSTANCE_MIN) return;
      const [t, c] = key.split('|'); const tpl = buildProp(THREE, t, c || undefined); tpl.updateMatrixWorld(true);
      const tplMeshes = []; tpl.traverse(x => { if (x.isMesh) tplMeshes.push(x); });
      const meshes = tplMeshes.map(src => { const im = new THREE.InstancedMesh(src.geometry, src.material, ids.length); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.userData = { mfBatch: key, local: src.matrixWorld.clone() }; batchGroup.add(im); return im; });
      ids.forEach((id, i) => { const r = objects.get(id); r.userData.mfInstanced = { key, index: i }; r.traverse(x => { if (x.isMesh) x.visible = false; }); });
      batches.set(key, { ids, meshes });
      ids.forEach(id => syncInstance(id));
      meshes.forEach(im => { im.instanceMatrix.needsUpdate = true; });
    });
  }
  function syncInstance(id) {
    const r = objects.get(id); const inst = r && r.userData.mfInstanced; if (!inst) return;
    const b = batches.get(inst.key); if (!b) return;
    const hidden = !r.visible || r.userData.mfFolderHidden;
    r.updateMatrixWorld(true);
    b.meshes.forEach(im => { if (hidden) im.setMatrixAt(inst.index, _zero); else { _m4.multiplyMatrices(r.matrixWorld, im.userData.local); im.setMatrixAt(inst.index, _m4); } im.instanceMatrix.needsUpdate = true; });
  }
  function dropInstance(id) { const r = objects.get(id); const inst = r && r.userData.mfInstanced; if (!inst) return; const b = batches.get(inst.key); if (b) b.meshes.forEach(im => { im.setMatrixAt(inst.index, _zero); im.instanceMatrix.needsUpdate = true; }); }
  const colliders = new Map();      // id → world-space collider (see updateCollider); prefab parts are keyed per part
  const emitters = new Map();       // id → emitter (fx_* objects and props with a built-in effect)
  let weather = null; const wind = new THREE.Vector3(); let fxOn = opts.fx !== false; let lightBudget = 0;
  const mixers = new Map();         // id → { mixer, action, clip }
  const assetCache = new Map();     // assetId → Promise<{ template, size, clips }>
  const sunDir = new THREE.Vector3(0, 1, 0);
  let time = 0, markersVisible = opts.markers !== false, gltfLoader = null;

  function loader() {
    if (gltfLoader) return gltfLoader;
    if (opts.gltfLoader) return (gltfLoader = opts.gltfLoader);
    if (THREE.GLTFLoader) { try { gltfLoader = new THREE.GLTFLoader(); } catch (e) { gltfLoader = null; } }
    return gltfLoader;
  }

  /* A .glb template: loaded once per asset — from its URL, or parsed from the
     embedded base64 when the file was dropped in from disk — recentred on XZ
     with its base at y = 0 (the /models/README.md convention) and NOT
     rescaled: the object's stored scale is the only scale, so editor and game
     agree. Animation clips ride along with the template. */
  function loadAsset(assetId) {
    if (assetCache.has(assetId)) return assetCache.get(assetId);
    const asset = (map.assets || []).find(a => a.id === assetId);
    const p = (async () => {
      const L = loader();
      if (!asset) throw new Error('unknown asset');
      if (!L) throw new Error('GLTFLoader unavailable');
      const g = asset.data
        ? await new Promise((res, rej) => L.parse(b64ToBuffer(asset.data), '', res, rej))
        : await new Promise((res, rej) => L.load(asset.url, res, undefined, rej));
      const scene = g.scene || (g.scenes && g.scenes[0]);
      if (!scene) throw new Error('empty glb');
      scene.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(scene), size = new THREE.Vector3(), c = new THREE.Vector3();
      bb.getSize(size); bb.getCenter(c);
      const wrap = new THREE.Group();
      scene.position.set(-c.x, -bb.min.y, -c.z);
      wrap.add(scene);
      wrap.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      const clips = (g.animations || []).filter(a => a && a.duration > 0);
      // remember the clip names on the asset so the UI can offer them next time
      // without loading the file (and so exports carry them)
      if (clips.length && !asset.anims) asset.anims = clips.map(cl => cl.name || 'clip');
      return { template: wrap, size, clips };
    })();
    p.catch(() => {});
    assetCache.set(assetId, p);
    return p;
  }

  /* SkinnedMesh + clone: three's Object3D.clone does not rebind skeletons, so
     an animated character must go through SkeletonUtils-style cloning. This is
     that algorithm inlined (r128 has it only as an example addon). */
  function cloneTemplate(tpl) {
    const clone = tpl.clone();
    const srcBones = {}, dstBones = {};
    tpl.traverse(n => { if (n.isBone) srcBones[n.name] = n; });
    clone.traverse(n => { if (n.isBone) dstBones[n.name] = n; });
    const srcSkinned = [], dstSkinned = [];
    tpl.traverse(n => { if (n.isSkinnedMesh) srcSkinned.push(n); });
    clone.traverse(n => { if (n.isSkinnedMesh) dstSkinned.push(n); });
    dstSkinned.forEach((dst, i) => {
      const src = srcSkinned[i]; if (!src) return;
      const bones = src.skeleton.bones.map(b => dstBones[b.name] || b);
      dst.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), dst.matrixWorld);
    });
    return clone;
  }

  /* ── prefabs ──
     An instance is one root with a child root per definition object, each
     built exactly like a top-level object (prop clone, .glb, effect) and
     collided per part, so a "ruined house" prefab of six pieces blocks the
     player piece by piece. Parts are addressable as 'instance:child' — the
     blueprint target `self.door` — through `parts`. */
  const prefabOf = (o) => (map.prefabs || []).find(p => p.id === o.pf) || null;
  function partDoc(id) { const i = id.indexOf(':'); if (i < 0) return null; const inst = map.objects.find(o => o.id === id.slice(0, i)); const def = inst && prefabOf(inst); return def ? (def.objects.find(c => c.id === id.slice(i + 1)) || null) : null; }
  function buildPartsInto(root, o, withColliders) {
    const def = prefabOf(o); if (!def) { root.add(buildProp(THREE, 'placeholder')); return; }
    def.objects.forEach(c => {
      const pid = o.id + ':' + c.id;
      const cr = new THREE.Group(); cr.name = 'mf-part-' + c.id; cr.userData = { mfId: pid, mfType: c.t, mfPart: true, mfOwner: o.id, mfMarker: !!(PROP_BY_ID[c.t] && PROP_BY_ID[c.t].marker) };
      const body = makeBody(c); cr.add(body);
      if (c.t.startsWith('fx_')) { cr.userData.mfFxHandle = body; body.visible = markersVisible; }
      attachFx(Object.assign({}, c, { id: pid }), cr);
      applyTransform(cr, c);
      if (cr.userData.mfMarker) cr.visible = markersVisible;
      root.add(cr); parts.set(pid, cr);
      if (c.t === 'glb') loadAsset(c.a).then(({ template, clips }) => { if (parts.get(pid) !== cr) return; cr.remove(body); const real = cloneTemplate(template); cr.add(real); cr.userData.mfClips = clips; cr.updateMatrixWorld(true); if (withColliders) updateCollider(pid); setAnim(pid, c.anim); }).catch(() => { cr.userData.mfError = true; });
    });
  }
  function removeParts(o) {
    Array.from(parts.keys()).forEach(pid => { if (pid.indexOf(o.id + ':') === 0) { stopAnim(pid); detachFx(pid); const cr = parts.get(pid); if (cr && cr.parent) cr.parent.remove(cr); parts.delete(pid); colliders.delete(pid); } });
  }
  /* ── material override ── clones each mesh's material once (templates share
     theirs through the prop cache — never mutate those) and applies the PBR
     knobs; `null` restores the original. */
  function applyMat(root, mat) {
    root.traverse(m => {
      if (!m.isMesh || !m.material) return;
      if (!mat) { if (m.userData.mfOrigMat) { m.material = m.userData.mfOrigMat; delete m.userData.mfOrigMat; } return; }
      if (!m.userData.mfOrigMat) { m.userData.mfOrigMat = m.material; m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone(); }
      [].concat(m.material).forEach(x => { if (mat.rough != null && 'roughness' in x) x.roughness = mat.rough; if (mat.metal != null && 'metalness' in x) x.metalness = mat.metal; if (x.emissive) { x.emissive.set(mat.em || '#000000'); x.emissiveIntensity = mat.em ? (mat.ei == null ? 1 : mat.ei) : 1; } x.needsUpdate = true; });
    });
  }
  function makeBody(o) {
    if (o.t === 'glb') { const body = buildProp(THREE, 'placeholder'); body.userData.mfPending = true; return body; }
    if (o.t.startsWith('fx_')) return buildProp(THREE, 'fxmarker');
    return buildProp(THREE, o.t, o.c);
  }

  /* ── VFX ──
     An fx_* object IS an emitter (its body is just the pickable handle); a
     prop with `fx` in the catalogue (campfire, crater, wrecked car…) carries
     its effect as a child at the declared offset. Point lights are budgeted
     (r128 recompiles every material when the light count changes, and eight
     is plenty) — the rest of the fires still glow through their additive
     flames, they just do not cast light. */
  const LIGHT_BUDGET = 8;
  let fxRange = opts.fxRange || 160, shadowMapSize = opts.shadowMap || 2048, shadowsOn = opts.shadows !== false;
  const _wp = new THREE.Vector3();
  function attachFx(o, root) {
    detachFx(o.id);
    if (!fxOn) return;
    const meta = PROP_BY_ID[o.t]; const tune = o.fx || {};
    let kind = null, off = { x: 0, y: 0, z: 0 }, base = 1;
    if (meta && meta.fxKind) kind = meta.fxKind;
    else if (meta && meta.fx && !tune.off) { kind = meta.fx.kind; off = meta.fx; base = meta.fx.scale || 1; }
    if (!kind || !EMITTERS[kind]) return;
    const wantsLight = !!EMITTERS[kind].light && lightBudget < LIGHT_BUDGET;
    const em = createEmitter(THREE, kind, { scale: base * (tune.s || 1), intensity: tune.i || 1, tint: o.t.startsWith('fx_') ? o.c : undefined, light: wantsLight });
    if (em.light) lightBudget++;
    em.group.position.set(off.x || 0, off.y || 0, off.z || 0);
    root.add(em.group);
    emitters.set(o.id, em);
  }
  function detachFx(id) {
    const em = emitters.get(id); if (!em) return;
    if (em.light) lightBudget = Math.max(0, lightBudget - 1);
    if (em.group.parent) em.group.parent.remove(em.group);
    em.dispose(); emitters.delete(id);
  }
  function setWeather(env) {
    if (weather) { group.remove(weather.group); weather.dispose(); weather = null; }
    wind.copy(windVector(THREE, env));
    if (!fxOn || !env.weather || env.weather === 'none') return;
    weather = createWeather(THREE, env.weather, { intensity: env.weatherIntensity || 1, onFlash: opts.onLightning });
    if (weather) group.add(weather.group);
  }

  function addObject(o) {
    if (objects.has(o.id)) removeObject(o.id);
    const root = new THREE.Group();
    root.name = 'mf-obj-' + o.id;
    root.userData = { mfId: o.id, mfType: o.t, mfMarker: !!(PROP_BY_ID[o.t] && PROP_BY_ID[o.t].marker) };
    let body = null;   // the placeholder / prop body — the .glb load below swaps it out (it was scoped inside the else once, which broke every model swap)
    if (o.t === 'prefab') { root.userData.mfPrefab = o.pf; buildPartsInto(root, o, true); }
    else {
      body = makeBody(o);
      root.add(body);
      if (o.t.startsWith('fx_')) { root.userData.mfFxHandle = body; body.visible = markersVisible; }
      attachFx(o, root);
      if (o.mat) applyMat(body, o.mat);
    }
    applyTransform(root, o);
    if (root.userData.mfMarker) root.visible = markersVisible;
    if (o.f && !folderVisible(o.f)) { root.visible = false; root.userData.mfFolderHidden = true; }
    objectsGroup.add(root);
    root.updateMatrixWorld(true);   // raycastable NOW, not after the next render — a click right after placing must hit
    objects.set(o.id, root);
    if (instancing && built && instanceKey(o)) batchDirty = true;
    if (o.t === 'prefab') { const def = prefabOf(o); if (def) def.objects.forEach(c => updateCollider(o.id + ':' + c.id)); }
    else updateCollider(o.id);
    if (o.t === 'glb') {
      loadAsset(o.a).then(({ template, clips }) => {
        if (objects.get(o.id) !== root) return;      // removed while loading
        root.remove(body);
        const real = cloneTemplate(template);
        root.add(real);
        if (o.mat) applyMat(real, o.mat);
        root.userData.mfPending = false; root.userData.mfClips = clips;
        root.updateMatrixWorld(true);
        updateCollider(o.id);
        setAnim(o.id, o.anim);
        if (opts.onAssetLoaded) opts.onAssetLoaded(o.id, root);
      }).catch((e) => { root.userData.mfError = true; try { console.warn('[mapforge] model ' + o.a + ' failed:', e && (e.message || e)); } catch (x) {} });
    }
    return root;
  }
  function removeObject(id) {
    const root = objects.get(id); if (!root) return;
    stopAnim(id); detachFx(id);
    if (root.userData.mfPrefab) removeParts({ id });
    dropInstance(id);
    objectsGroup.remove(root); objects.delete(id); colliders.delete(id);
  }
  function applyTransform(root, o) {
    root.position.set(o.p[0], o.p[1], o.p[2]);
    root.rotation.set(o.r[0], o.r[1], o.r[2]);
    root.scale.set(o.s[0], o.s[1], o.s[2]);
  }
  /* Re-tint means a new body (tint is baked into the template key). */
  function refreshObject(o) {
    const root = objects.get(o.id); if (!root) return addObject(o);
    if (o.t === 'prefab' || root.userData.mfPrefab) return addObject(o);   // a prefab instance is rebuilt whole
    if (o.t !== 'glb' && root.children[0] && root.children[0].userData.mfProp === o.t) {
      root.remove(root.children[0]); root.add(buildProp(THREE, o.t, o.c));
    }
    if (root.children[0]) applyMat(root.children[0], o.mat || null);
    attachFx(o, root);
    applyTransform(root, o);
    root.updateMatrixWorld(true);
    updateCollider(o.id);
    if (o.t === 'glb') setAnim(o.id, o.anim);
    if (root.userData.mfInstanced) { if (root.userData.mfInstanced.key !== instanceKey(o)) batchDirty = true; else syncInstance(o.id); }
    return root;
  }

  /* ── collision ──
     "Simple collision" the Unreal way: one world-space box (or cylinder) per
     solid object, taken from its rendered bounds. The player treats a
     collider as a wall where it is taller than a step and as ground where it
     is not, so crates are climbed, bridges are walked, walls stop you.
     Recomputed whenever an object is added, moved or reshaped (cheap: one
     Box3 per change, never per frame). */
  const STEP = 0.55, _bb = new THREE.Box3();
  function objDoc(id) { return map.objects.find(o => o.id === id) || partDoc(id); }
  const rootOf = (id) => objects.get(id) || parts.get(id) || null;
  function updateCollider(id) {
    if (nav && !actors.running) nav.invalidate();   // edit-time moves change walkability; agents moving in play do not (they avoid statics, not each other — a rebake per step would be 25k cells per frame)
    const root = rootOf(id), o = objDoc(id);
    if (!root || !o || !collides(o)) { colliders.delete(id); return null; }
    root.updateMatrixWorld(true);
    _bb.setFromObject(root);
    if (_bb.isEmpty()) { colliders.delete(id); return null; }
    const c = { id, shape: o.cs === 'cyl' ? 'cyl' : 'box', minX: _bb.min.x, maxX: _bb.max.x, minZ: _bb.min.z, maxZ: _bb.max.z, bottom: _bb.min.y, top: _bb.max.y,
      cx: (_bb.min.x + _bb.max.x) / 2, cz: (_bb.min.z + _bb.max.z) / 2, r: Math.max(_bb.max.x - _bb.min.x, _bb.max.z - _bb.min.z) / 2 };
    colliders.set(id, c);
    return c;
  }
  function updateAllColliders() { if (nav) nav.invalidate(); colliders.clear(); objects.forEach((r, id) => { if (r.userData.mfPrefab) return; updateCollider(id); }); parts.forEach((r, id) => updateCollider(id)); }
  function footprint(c, x, z, pad) {
    if (c.shape === 'cyl') { const dx = x - c.cx, dz = z - c.cz; const rr = c.r + pad; return dx * dx + dz * dz < rr * rr; }
    return x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad;
  }
  /* Ground under a point for something standing at `feet`: terrain, or the
     top of any collider it is on / can step onto. */
  /* `ignore`: an object id whose collider (and prefab parts, 'id:*') is skipped —
     an agent must not stand on or be blocked by its own body. */
  const owned = (c, ignore) => ignore && (c.id === ignore || c.id.indexOf(ignore + ':') === 0);
  function groundAt(x, z, feet, ignore) {
    let g = terrain.heightAt(x, z);
    if (feet == null) return g;
    colliders.forEach(c => { if (owned(c, ignore)) return; if (c.top > g && c.top <= feet + STEP && c.bottom <= feet + STEP && footprint(c, x, z, 0.1)) g = c.top; });
    return g;
  }
  /* Slide a capsule-ish body (radius, height) from (x0,z0) toward (x1,z1);
     axis-separated so walls are slid along, not stuck to. */
  function resolveMove(x0, z0, x1, z1, feet, height, radius, ignore) {
    height = height || 1.7; radius = radius || 0.35;
    const blocked = (x, z) => { let hit = false; colliders.forEach(c => { if (hit || owned(c, ignore)) return; if (c.bottom < feet + height && c.top > feet + STEP && footprint(c, x, z, radius)) hit = true; }); return hit; };
    let nx = x1; if (blocked(nx, z0)) nx = x0;
    let nz = z1; if (blocked(nx, nz)) nz = z0;
    return { x: nx, z: nz, blocked: nx !== x1 || nz !== z1 };
  }
  function setCollision(id, on, shape) {
    const o = objDoc(id); if (!o) return;
    if (on != null) o.col = on;
    if (shape != null) o.cs = shape === 'cyl' ? 'cyl' : undefined;
    updateCollider(id);
  }

  /* ── animation ──
     One AnimationMixer per animated object; `anim` = { clip, speed, loop }.
     Passing nothing stops the object. Mixers advance in update(dt). */
  function stopAnim(id) {
    const m = mixers.get(id); if (!m) return;
    try { m.mixer.stopAllAction(); m.mixer.uncacheRoot(m.mixer.getRoot()); } catch (e) {}
    mixers.delete(id);
  }
  function setAnim(id, anim) {
    const root = rootOf(id); if (!root) return false;
    const clips = root.userData.mfClips || [];
    const cur = mixers.get(id);
    if (!anim || !anim.clip) { stopAnim(id); return true; }
    const clip = clips.find(c => c.name === anim.clip) || (anim.clip === '*' ? clips[0] : null);
    if (!clip) { stopAnim(id); return false; }
    if (cur && cur.clip === clip) {
      cur.action.setEffectiveTimeScale(anim.speed == null ? 1 : anim.speed);
      applyLoop(cur.action, anim.loop);
      return true;
    }
    stopAnim(id);
    const body = root.children[0]; if (!body) return false;
    const mixer = new THREE.AnimationMixer(body);
    const action = mixer.clipAction(clip);
    action.setEffectiveTimeScale(anim.speed == null ? 1 : anim.speed);
    applyLoop(action, anim.loop);
    action.play();
    mixers.set(id, { mixer, action, clip });
    return true;
  }
  function applyLoop(action, loop) {
    if (loop === 'once') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    else if (loop === 'pingpong') action.setLoop(THREE.LoopPingPong, Infinity);
    else action.setLoop(THREE.LoopRepeat, Infinity);
  }

  function applyEnv(env) {
    const az = env.sunAz * Math.PI / 180, el = env.sunEl * Math.PI / 180;
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    const dist = Math.max(60, terrain.size * 0.9);
    sun.position.copy(sunDir).multiplyScalar(dist);
    sun.color.set(env.sunColor); sun.intensity = env.sunIntensity;
    sun.castShadow = env.shadows !== false && shadowsOn;
    const ext = terrain.half + 12;
    const sc = sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = dist * 2 + ext * 2;
    if (sun.shadow.mapSize.x !== shadowMapSize) { sun.shadow.mapSize.set(shadowMapSize, shadowMapSize); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03; sc.updateProjectionMatrix();
    hemi.color.set(env.ambient); hemi.groundColor.set(env.groundColor); hemi.intensity = env.ambientIntensity;
    sky.material.uniforms.uTop.value.set(env.skyTop); sky.material.uniforms.uBottom.value.set(env.skyBottom);
    sky.material.uniforms.uSun.value.copy(sunDir); sky.material.uniforms.uSunColor.value.set(env.sunColor);
    if (opts.scene && pieces.sky) {
      opts.scene.fog = new THREE.Fog(new THREE.Color(env.fogColor), env.fogNear, env.fogFar);
      opts.scene.background = new THREE.Color(env.skyBottom);
    }
    terrain.setDetail(env.terrainDetail == null ? 0.8 : env.terrainDetail); terrain.setTile(env.terrainTile == null ? 0.5 : env.terrainTile);
    if (opts.onEnv) { try { opts.onEnv(env); } catch (e) {} }   // the host owns the renderer: tone mapping, exposure, the post pass
    const w = weather ? weather.kind : 'none', wi = weather ? weather.intensity : 1;
    if ((env.weather || 'none') !== w || (env.weatherIntensity || 1) !== wi) setWeather(env); else wind.copy(windVector(THREE, env));
  }

  /* ── actors (blueprints) ──
     Live only between startPlay() and stopPlay(). Spawned objects are flagged
     _rt and removed at stop; a destroyed persistent object is hidden and
     restored at stop, so a play session never changes the document. */
  let playerRef = null, interactFlag = false; const rtHidden = new Set();
  /* physics: created on the first play of a map that has a Physics component,
     after cannon-es loads (async) — play starts at once, bodies join when ready */
  let physics = null, physicsWanted = 0;
  /* navigation: baked lazily from terrain + colliders; invalidated when either changes */
  let nav = null;
  /* audio: one listener on whatever camera the host hands over (engine / editor / overlay) */
  let audio = null;
  const needsAudio = () => map.objects.some(o => o.bp && (o.bp.comps.some(c => c.type === 'sound') || o.bp.graph.nodes.some(n => n.type === 'playsound')));
  const navNeeded = () => map.objects.some(o => o.bp && (o.bp.comps.some(c => c.type === 'agent') || o.bp.graph.nodes.some(n => /^(moveto|chase|patrol|wander)$/.test(n.type))));
  const needsPhysics = () => map.objects.some(o => o.bp && o.bp.comps.some(c => c.type === 'physics'));
  /* Bodies must exist BEFORE Begin Play runs (an Impulse on Begin Play would
     otherwise hit thin air), so a map that needs physics starts its actors
     only once cannon-es is in — a few hundred ms on the first play, instant
     after. stopPlay() during the load cancels via the generation counter. */
  function startWithPhysics() {
    const gen = ++physicsWanted;
    ensureCannon().then(CANNON => {
      if (gen !== physicsWanted) return;
      if (!physics) physics = createPhysics(THREE, CANNON, api, { gravity: opts.gravity });
      physics.start(); actors.start();
    }).catch(e => { try { console.warn('[mapforge] physics unavailable:', e && e.message); } catch (x) {} if (opts.toast) opts.toast('Physics could not load (/vendor/cannon-es.js) — bodies stay still.', 4000); if (gen === physicsWanted) actors.start(); });
  }
  const actors = createActors({
    THREE, map, get player() { return playerRef; },
    get world() { return api; },
    toast: opts.toast, onPrompt: opts.onPrompt, actions: opts.actions,
    spawn(what, p, name) {
      what = String(what || '').trim(); if (!what) return null;
      const pf = (map.prefabs || []).find(x => x.name === what || x.id === what);
      const o = { id: 'rt_' + Math.random().toString(36).slice(2, 9), t: pf ? 'prefab' : (PROP_BY_ID[what] ? what : 'crate'), pf: pf ? pf.id : undefined, p: [p[0], p[1], p[2]], r: [0, 0, 0], s: [1, 1, 1], g: false, n: name || undefined, _rt: true };
      map.objects.push(o); addObject(o); actors.adopt(o); return o;
    },
    destroy(id) {
      const o = map.objects.find(x => x.id === id);
      if (o && o._rt) { removeObject(id); map.objects.splice(map.objects.indexOf(o), 1); actors.forget(id); return; }
      const r = rootOf(id); if (r) { r.visible = false; rtHidden.add(id); colliders.delete(id); syncInstance(id); }
    },
  });
  const api = {
    map, group, terrain, water, sky, sun, hemi, objects, parts, objectsGroup, mixers,
    actors, hasBehaviour,
    setPlayer(p) { playerRef = p || null; },
    interact() { interactFlag = true; },
    get playing() { return actors.running; },
    get physics() { return physics && physics.running ? physics : null; },
    get nav() { if (!nav) nav = createNav(api, opts.nav); return nav; },
    get audio() { return audio && audio.running ? audio : null; },
    setAudioCamera(cam) { if (!needsAudio() && !audio) return; if (!audio) { try { audio = createAudio(THREE); } catch (e) { audio = null; return; } } audio.attach(cam); },
    navBake() { return api.nav.bake(); },
    navInvalidate() { if (nav) nav.invalidate(); },
    physicsReady: () => ensureCannon().then(() => true).catch(() => false),
    startPlay(player) { if (player !== undefined) playerRef = player; if (navNeeded()) api.nav.bake(); if (needsAudio()) { if (!audio) { try { audio = createAudio(THREE); } catch (e) { audio = null; } } if (audio) { audio.start(); if (!audio.camera && opts.camera) audio.attach(opts.camera); } } if (needsPhysics()) startWithPhysics(); else actors.start(); },
    stopPlay() {
      physicsWanted++; if (physics) physics.stop();
      if (audio) audio.stop();
      actors.stop();
      map.objects.filter(o => o._rt).forEach(o => removeObject(o.id)); map.objects = map.objects.filter(o => !o._rt);
      rtHidden.forEach(id => { const r = rootOf(id); if (r) r.visible = true; updateCollider(id); syncInstance(id); }); rtHidden.clear();
      playerRef = null;
    },
    rootOf, partDoc, prefabOf,
    addObject, removeObject, refreshObject, applyTransform, loadAsset, setAnim, stopAnim,
    colliders, updateCollider, updateAllColliders, groundAt, resolveMove, setCollision, isSolid: (o) => collides(o),
    /* clips available on a placed .glb (empty until it has loaded) */
    clipsOf: (id) => { const r = objects.get(id); return r && r.userData.mfClips ? r.userData.mfClips.map(c => c.name) : []; },
    applyEnv, applyWater: (w) => water.apply(w),
    heightAt: (x, z) => terrain.heightAt(x, z),
    spawns: () => map.objects.filter(o => o.t === 'spawn'),
    /* every object of a type — e.g. world.find('enemy') for a mini-game's spawner */
    find: (type) => map.objects.filter(o => o.t === type),
    pieces,
    /* ── content folders ── */
    folders: () => map.folders || [],
    folderVisible, applyFolderVisibility,
    /* objects inside a folder (by id or name), descendants included — e.g.
       world.inFolder('Enemies') for a spawner, world.inFolder('Night') to toggle a set */
    inFolder(idOrName, deep) {
      const fs = map.folders || []; const root = fs.find(f => f.id === idOrName) || fs.find(f => f.name === idOrName); if (!root) return [];
      const ids = new Set([root.id]);
      if (deep !== false) { let grew = true; while (grew) { grew = false; fs.forEach(f => { if (f.parent && ids.has(f.parent) && !ids.has(f.id)) { ids.add(f.id); grew = true; } }); } }
      return map.objects.filter(o => o.f && ids.has(o.f));
    },
    setFolderVisible(idOrName, v) { const f = (map.folders || []).find(x => x.id === idOrName || x.name === idOrName); if (!f) return false; f.vis = !!v; applyFolderVisibility(); return true; },
    /* ── game slots ── objects standing in for the host game's own assets */
    slots: () => map.objects.filter(o => o.k),
    slot: (key) => map.objects.find(o => o.k === key) || null,
    setMarkersVisible(v) { markersVisible = !!v; objects.forEach(r => { if (r.userData.mfMarker) r.visible = markersVisible && !r.userData.mfFolderHidden; if (r.userData.mfFxHandle) r.userData.mfFxHandle.visible = markersVisible; }); },
    emitters, get weather() { return weather; }, wind,
    /* re-tune an emitter after the inspector changes o.fx / o.c */
    refreshFx(id) { const o = objDoc(id), r = objects.get(id); if (o && r) attachFx(o, r); },
    setFxEnabled(v) { if (fxOn === !!v) return; fxOn = !!v; objects.forEach((r, id) => { const o = objDoc(id); if (o) attachFx(o, r); }); setWeather(map.env); },
    /* emitters farther than this from the camera are not updated or drawn */
    setFxRange(m) { fxRange = Math.max(5, +m || 160); },
    setShadowMapSize(n) { n = +n || 2048; if (n === shadowMapSize) return; shadowMapSize = n; applyEnv(map.env); },
    setShadows(v) { shadowsOn = !!v; applyEnv(map.env); },
    /* re-apply an object's material override after the inspector changes o.mat */
    refreshMat(id) { const r = objects.get(id), o = objDoc(id); if (!r || !o) return; r.children.forEach(ch => { if (!ch.isLight && !(ch.userData && ch.userData.mfPart)) applyMat(ch, o.mat || null); }); if (r.userData.mfInstanced) batchDirty = true; },
    /* instancing: on by default in the engine and overlays, off in the editor */
    get instancing() { return instancing; },
    setInstancing(v) { instancing = !!v; batchDirty = true; },
    batches, syncInstance,
    stats() { let inst = 0, draws = 0; batches.forEach(b => { inst += b.ids.length; draws += b.meshes.length; }); return { objects: objects.size, batches: batches.size, instanced: inst, batchDraws: draws, emitters: emitters.size, colliders: colliders.size }; },
    /* After the grid is resized or regenerated: water covers the new size,
       shadows cover it, grounded objects land on the new surface. */
    onTerrainRebuilt() { water.resize(terrain.size); applyEnv(map.env); if (nav) nav.invalidate(); },
    /* Build ONE object's body the way the world would (prop clone or a .glb
       template clone) without adding it to this world — a host game uses
       this to draw a slot's replacement inside its own scene graph.
       Returns { root, ready } where `ready` resolves once a model loaded. */
    buildDetached(o) {
      const root = new THREE.Group(); root.userData = { mfId: o.id, mfType: o.t, detached: true };
      let body = null;
      if (o.t === 'prefab') buildPartsInto(root, o, false); else { body = makeBody(o); root.add(body); attachFx(o, root); }
      root.scale.set(o.s[0], o.s[1], o.s[2]); root.rotation.set(o.r[0], o.r[1], o.r[2]);
      let ready = Promise.resolve(root);
      if (o.t === 'glb') ready = loadAsset(o.a).then(({ template, clips }) => { root.remove(body); const real = cloneTemplate(template); root.add(real); root.userData.mfClips = clips; if (o.anim && o.anim.clip) { const clip = clips.find(c => c.name === o.anim.clip) || clips[0]; if (clip) { const mixer = new THREE.AnimationMixer(real); const a = mixer.clipAction(clip); a.setEffectiveTimeScale(o.anim.speed == null ? 1 : o.anim.speed); applyLoop(a, o.anim.loop); a.play(); root.userData.mixer = mixer; } } return root; }).catch(() => root);
      return { root, ready, update(dt) { if (root.userData.mixer) root.userData.mixer.update(dt); const em = emitters.get(o.id); if (em) em.update(time, wind); } };
    },
    update(dt, camera) {
      time += dt;
      if (batchDirty) rebuildBatches();
      if (camera && audio && audio.running && audio.camera !== camera) audio.attach(camera);
      if (actors.running) { if (physics && physics.running) physics.step(dt, playerRef); actors.update(dt, interactFlag); interactFlag = false; }
      water.update(time, sunDir);
      mixers.forEach(m => m.mixer.update(dt));
      emitters.forEach(em => { if (camera) { em.group.getWorldPosition(_wp); const near = _wp.distanceTo(camera.position) < fxRange; if (em.group.visible !== near) em.group.visible = near; if (!near) return; } em.update(time, wind); });
      if (weather && camera) weather.update(time, dt, camera.position, wind);
      if (camera) sky.position.copy(camera.position);
    },
    dispose() {
      try { physicsWanted++; if (physics) physics.dispose(); if (audio) audio.dispose(); actors.stop(); } catch (e) {}
      mixers.forEach((m, id) => stopAnim(id));
      emitters.forEach((em, id) => detachFx(id)); if (weather) { weather.dispose(); weather = null; }
      batches.forEach(b => b.meshes.forEach(im => im.dispose())); batches.clear();
      terrain.dispose(); water.dispose();
      try { sky.geometry.dispose(); sky.material.dispose(); } catch (e) {}
      objects.clear();
    },
  };
  let built = false;
  map.objects.forEach(addObject);
  built = true;
  if (instancing) rebuildBatches();
  applyEnv(map.env);
  water.apply(map.water);
  return api;
}

export function b64ToBuffer(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
export function bufferToB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

/* Gradient sky dome with a soft sun glow. Camera-following, fog-free,
   depth-free: it is a backdrop, not geometry. Needs camera.far > 1000. */
function makeSky(THREE) {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color('#3f7fd6') }, uBottom: { value: new THREE.Color('#cfe6ff') }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color('#fff4dc') } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: 'uniform vec3 uTop, uBottom, uSun, uSunColor; varying vec3 vDir; void main(){ float h = clamp(vDir.y * 1.6 + 0.15, 0.0, 1.0); vec3 c = mix(uBottom, uTop, pow(h, 0.75)); float s = max(dot(normalize(vDir), normalize(uSun)), 0.0); c += uSunColor * (pow(s, 320.0) * 1.3 + pow(s, 48.0) * 0.12); gl_FragColor = vec4(c, 1.0); }',
  });
  const m = new THREE.Mesh(geo, mat); m.name = 'mf-sky'; m.frustumCulled = false; m.renderOrder = -10;
  return m;
}
