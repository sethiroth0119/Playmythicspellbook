/* mapforge.world.js — turn a map document into a live three.js scene.

   This is the RUNTIME half and it is deliberately editor-free: the game can
   call buildWorld(window.THREE, mapJson, { scene }) from anywhere that has a
   scene (the 3D battle board, a hub, node-city) and get back terrain, water,
   sky, lights and every placed object, plus heightAt(x,z) for walking on it.
   The editor uses this exact function and layers its tools on top, which is
   what guarantees "what you built is what the game loads". */

import { createTerrain } from './mapforge.terrain.js';
import { createWater } from './mapforge.water.js';
import { buildProp, PROP_BY_ID } from './mapforge.props.js';

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
  const assetCache = new Map();     // assetId → Promise<{ template, size }>
  const sunDir = new THREE.Vector3(0, 1, 0);
  let time = 0, markersVisible = opts.markers !== false, gltfLoader = null;

  function loader() {
    if (gltfLoader) return gltfLoader;
    if (opts.gltfLoader) return (gltfLoader = opts.gltfLoader);
    if (THREE.GLTFLoader) { try { gltfLoader = new THREE.GLTFLoader(); } catch (e) { gltfLoader = null; } }
    return gltfLoader;
  }

  /* A .glb template: loaded once per asset, recentred on XZ with its base at
     y = 0 (the same convention as /models/README.md) and NOT rescaled — the
     object's stored scale is the only scale, so editor and game agree. */
  function loadAsset(assetId) {
    if (assetCache.has(assetId)) return assetCache.get(assetId);
    const asset = (map.assets || []).find(a => a.id === assetId);
    const p = (async () => {
      const L = loader();
      if (!asset || !L) throw new Error(asset ? 'GLTFLoader unavailable' : 'unknown asset');
      const g = await new Promise((res, rej) => L.load(asset.url, res, undefined, rej));
      const scene = g.scene || (g.scenes && g.scenes[0]);
      if (!scene) throw new Error('empty glb');
      scene.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(scene), size = new THREE.Vector3(), c = new THREE.Vector3();
      bb.getSize(size); bb.getCenter(c);
      const wrap = new THREE.Group();
      scene.position.set(-c.x, -bb.min.y, -c.z);
      wrap.add(scene);
      wrap.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return { template: wrap, size };
    })();
    p.catch(() => {});
    assetCache.set(assetId, p);
    return p;
  }

  function makeBody(o) {
    if (o.t === 'glb') {
      const body = buildProp(THREE, 'placeholder');
      body.userData.mfPending = true;
      return body;
    }
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
    if (o.t === 'glb') {
      loadAsset(o.a).then(({ template }) => {
        if (objects.get(o.id) !== root) return;      // removed while loading
        root.remove(body);
        const real = template.clone();
        root.add(real);
        root.userData.mfPending = false;
        if (opts.onAssetLoaded) opts.onAssetLoaded(o.id, root);
      }).catch(() => { root.userData.mfError = true; });
    }
    return root;
  }
  function removeObject(id) {
    const root = objects.get(id); if (!root) return;
    objectsGroup.remove(root); objects.delete(id);
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
    return root;
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
    group, terrain, water, sky, sun, hemi, objects, objectsGroup,
    addObject, removeObject, refreshObject, applyTransform, loadAsset,
    applyEnv, applyWater: (w) => water.apply(w),
    heightAt: (x, z) => terrain.heightAt(x, z),
    spawns: () => map.objects.filter(o => o.t === 'spawn'),
    setMarkersVisible(v) { markersVisible = !!v; objects.forEach(r => { if (r.userData.mfMarker) r.visible = markersVisible; }); },
    /* After the grid is resized or regenerated: water covers the new size,
       shadows cover it, grounded objects land on the new surface. */
    onTerrainRebuilt() { water.resize(terrain.size); applyEnv(map.env); },
    update(dt, camera) {
      time += dt;
      water.update(time, sunDir);
      if (camera) sky.position.copy(camera.position);
    },
    dispose() {
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
