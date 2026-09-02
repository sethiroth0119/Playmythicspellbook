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
  group.add(terrain.mesh, water.mesh, sky, sun, sun.target, hemi, objectsGroup);

  const objects = new Map();        // id → root Object3D
  const colliders = new Map();      // id → world-space collider (see updateCollider)
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

  function makeBody(o) {
    if (o.t === 'glb') { const body = buildProp(THREE, 'placeholder'); body.userData.mfPending = true; return body; }
    return buildProp(THREE, o.t, o.c);
  }

  function addObject(o) {
    if (objects.has(o.id)) removeObject(o.id);
    const root = new THREE.Group();
    root.name = 'mf-obj-' + o.id;
    root.userData = { mfId: o.id, mfType: o.t, mfMarker: !!(PROP_BY_ID[o.t] && PROP_BY_ID[o.t].marker) };
    const body = makeBody(o);
    root.add(body);
    applyTransform(root, o);
    if (root.userData.mfMarker) root.visible = markersVisible;
    objectsGroup.add(root);
    root.updateMatrixWorld(true);   // raycastable NOW, not after the next render — a click right after placing must hit
    objects.set(o.id, root);
    updateCollider(o.id);
    if (o.t === 'glb') {
      loadAsset(o.a).then(({ template, clips }) => {
        if (objects.get(o.id) !== root) return;      // removed while loading
        root.remove(body);
        const real = cloneTemplate(template);
        root.add(real);
        root.userData.mfPending = false; root.userData.mfClips = clips;
        root.updateMatrixWorld(true);
        updateCollider(o.id);
        setAnim(o.id, o.anim);
        if (opts.onAssetLoaded) opts.onAssetLoaded(o.id, root);
      }).catch(() => { root.userData.mfError = true; });
    }
    return root;
  }
  function removeObject(id) {
    const root = objects.get(id); if (!root) return;
    stopAnim(id);
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
    if (o.t !== 'glb' && root.children[0] && root.children[0].userData.mfProp === o.t) {
      root.remove(root.children[0]); root.add(buildProp(THREE, o.t, o.c));
    }
    applyTransform(root, o);
    root.updateMatrixWorld(true);
    updateCollider(o.id);
    if (o.t === 'glb') setAnim(o.id, o.anim);
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
  function objDoc(id) { return map.objects.find(o => o.id === id) || null; }
  function updateCollider(id) {
    const root = objects.get(id), o = objDoc(id);
    if (!root || !o || !collides(o)) { colliders.delete(id); return null; }
    root.updateMatrixWorld(true);
    _bb.setFromObject(root);
    if (_bb.isEmpty()) { colliders.delete(id); return null; }
    const c = { id, shape: o.cs === 'cyl' ? 'cyl' : 'box', minX: _bb.min.x, maxX: _bb.max.x, minZ: _bb.min.z, maxZ: _bb.max.z, bottom: _bb.min.y, top: _bb.max.y,
      cx: (_bb.min.x + _bb.max.x) / 2, cz: (_bb.min.z + _bb.max.z) / 2, r: Math.max(_bb.max.x - _bb.min.x, _bb.max.z - _bb.min.z) / 2 };
    colliders.set(id, c);
    return c;
  }
  function updateAllColliders() { colliders.clear(); objects.forEach((r, id) => updateCollider(id)); }
  function footprint(c, x, z, pad) {
    if (c.shape === 'cyl') { const dx = x - c.cx, dz = z - c.cz; const rr = c.r + pad; return dx * dx + dz * dz < rr * rr; }
    return x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad;
  }
  /* Ground under a point for something standing at `feet`: terrain, or the
     top of any collider it is on / can step onto. */
  function groundAt(x, z, feet) {
    let g = terrain.heightAt(x, z);
    if (feet == null) return g;
    colliders.forEach(c => { if (c.top > g && c.top <= feet + STEP && c.bottom <= feet + STEP && footprint(c, x, z, 0.1)) g = c.top; });
    return g;
  }
  /* Slide a capsule-ish body (radius, height) from (x0,z0) toward (x1,z1);
     axis-separated so walls are slid along, not stuck to. */
  function resolveMove(x0, z0, x1, z1, feet, height, radius) {
    height = height || 1.7; radius = radius || 0.35;
    const blocked = (x, z) => { let hit = false; colliders.forEach(c => { if (hit) return; if (c.bottom < feet + height && c.top > feet + STEP && footprint(c, x, z, radius)) hit = true; }); return hit; };
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
    const root = objects.get(id); if (!root) return false;
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
    sun.castShadow = env.shadows !== false && opts.shadows !== false;
    const ext = terrain.half + 12;
    const sc = sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = dist * 2 + ext * 2;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03; sc.updateProjectionMatrix();
    hemi.color.set(env.ambient); hemi.groundColor.set(env.groundColor); hemi.intensity = env.ambientIntensity;
    sky.material.uniforms.uTop.value.set(env.skyTop); sky.material.uniforms.uBottom.value.set(env.skyBottom);
    sky.material.uniforms.uSun.value.copy(sunDir); sky.material.uniforms.uSunColor.value.set(env.sunColor);
    if (opts.scene) {
      opts.scene.fog = new THREE.Fog(new THREE.Color(env.fogColor), env.fogNear, env.fogFar);
      opts.scene.background = new THREE.Color(env.skyBottom);
    }
  }

  const api = {
    map, group, terrain, water, sky, sun, hemi, objects, objectsGroup, mixers,
    addObject, removeObject, refreshObject, applyTransform, loadAsset, setAnim, stopAnim,
    colliders, updateCollider, updateAllColliders, groundAt, resolveMove, setCollision, isSolid: (o) => collides(o),
    /* clips available on a placed .glb (empty until it has loaded) */
    clipsOf: (id) => { const r = objects.get(id); return r && r.userData.mfClips ? r.userData.mfClips.map(c => c.name) : []; },
    applyEnv, applyWater: (w) => water.apply(w),
    heightAt: (x, z) => terrain.heightAt(x, z),
    spawns: () => map.objects.filter(o => o.t === 'spawn'),
    /* every object of a type — e.g. world.find('enemy') for a mini-game's spawner */
    find: (type) => map.objects.filter(o => o.t === type),
    setMarkersVisible(v) { markersVisible = !!v; objects.forEach(r => { if (r.userData.mfMarker) r.visible = markersVisible; }); },
    /* After the grid is resized or regenerated: water covers the new size,
       shadows cover it, grounded objects land on the new surface. */
    onTerrainRebuilt() { water.resize(terrain.size); applyEnv(map.env); },
    update(dt, camera) {
      time += dt;
      water.update(time, sunDir);
      mixers.forEach(m => m.mixer.update(dt));
      if (camera) sky.position.copy(camera.position);
    },
    dispose() {
      mixers.forEach((m, id) => stopAnim(id));
      terrain.dispose(); water.dispose();
      try { sky.geometry.dispose(); sky.material.dispose(); } catch (e) {}
      objects.clear();
    },
  };
  map.objects.forEach(addObject);
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
