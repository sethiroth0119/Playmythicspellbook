/* ══════════════════════════════════════════════════════════════════════════
   🧊 GLB — the .glb reader, lifted out of /dwelling so a second room can use it

   The Dwelling has parsed .glb by hand since it shipped: container → JSON +
   BIN chunk → accessors → BufferGeometry, with textures pulled out of the
   buffer views as blob URLs. It does NOT use three's GLTFLoader, and that is a
   deliberate choice this module inherits rather than revisits: the loader is a
   separate ~150 KB script that would have to be fetched, and the subset of
   glTF a piece of furniture uses is small enough to read directly.

   🔴 WHY IT IS A MODULE NOW. The Warehouse needs the same reader for the same
      reason — an admin drops in a .glb and players place it. Copying forty
      lines of binary parsing into a second file guarantees the two drift, and
      the one that drifts is the one nobody is looking at when a model fails to
      load.

   ⚠ THREE IS PASSED IN, NEVER IMPORTED. The Dwelling and the Warehouse each
     load their own THREE build from their own import map, and a module that
     imported a third copy would mean geometry from one build handed to a
     renderer from another — which fails as "nothing is drawn" with no error.
     makeGlb(THREE) binds to whichever build the calling page already has.

   ⚠ THE DWELLING STILL HAS ITS OWN COPY TODAY. This module is byte-faithful to
     it, but I have not yet switched /dwelling over — that page is load-bearing
     and has its own driver, and migrating it belongs in its own change with
     that driver run against it. THIS is the canonical copy; when the Dwelling
     moves, its inline version goes.
   ══════════════════════════════════════════════════════════════════════════ */

export function makeGlb(THREE) {
  if (!THREE) throw new Error('makeGlb(THREE): the calling page must pass its own THREE');

  const b64ToAb = (b64) => {
    const bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };
  const abToB64 = (buf) => {
    const bytes = new Uint8Array(buf); let s = ''; const ch = 0x8000;
    for (let i = 0; i < bytes.length; i += ch) s += String.fromCharCode.apply(null, bytes.subarray(i, i + ch));
    return btoa(s);
  };

  /* Container. A .glb is a 12-byte header then length-prefixed chunks; a .gltf
     is bare JSON whose buffer may be a data: URI. Both are accepted, but a
     .gltf pointing at a SEPARATE .bin file is refused with a message that says
     so — there is no second file to fetch here. */
  function parseModel(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength >= 12 && dv.getUint32(0, true) === 0x46546C67) {
      const len = dv.getUint32(8, true);
      let off = 12, json = null, bin = null;
      while (off < len) {
        const cl = dv.getUint32(off, true), ct = dv.getUint32(off + 4, true);
        const data = buf.slice(off + 8, off + 8 + cl);
        if (ct === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(data));
        else if (ct === 0x004E4942) bin = data;
        off += 8 + cl;
      }
      if (!json) throw new Error('no glTF JSON chunk');
      return { json, bin };
    }
    const json = JSON.parse(new TextDecoder().decode(buf));
    let bin = null;
    if (json.buffers && json.buffers[0] && json.buffers[0].uri && json.buffers[0].uri.startsWith('data:')) {
      bin = b64ToAb(json.buffers[0].uri.split(',')[1]);
    }
    if (!bin) throw new Error('use a .glb file (a .gltf with a separate .bin cannot be read here)');
    return { json, bin };
  }

  function readAccessor(gltf, bin, idx) {
    const acc = gltf.accessors[idx], bv = gltf.bufferViews[acc.bufferView];
    const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type] || 1;
    const count = acc.count, stride = bv.byteStride || 0;
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const dv = new DataView(bin);
    const sz = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
    const out = new Float32Array(count * NC);
    for (let i = 0; i < count; i++) {
      const eo = base + (stride ? i * stride : i * NC * sz);
      for (let j = 0; j < NC; j++) {
        const o = eo + j * sz; let v;
        switch (acc.componentType) {
          case 5126: v = dv.getFloat32(o, true); break;
          case 5125: v = dv.getUint32(o, true); break;
          case 5123: v = dv.getUint16(o, true); break;
          case 5121: v = dv.getUint8(o); break;
          case 5122: v = dv.getInt16(o, true); break;
          default: v = dv.getInt8(o);
        }
        out[i * NC + j] = v;
      }
    }
    return out;
  }

  function getImageURL(gltf, bin, ii) {
    const img = gltf.images && gltf.images[ii];
    if (!img) return null;
    if (img.uri) return img.uri.startsWith('data:') ? img.uri : null;
    if (img.bufferView == null) return null;
    const bv = gltf.bufferViews[img.bufferView];
    const slice = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    return URL.createObjectURL(new Blob([slice], { type: img.mimeType || 'image/png' }));
  }

  const TEXLOADER = new THREE.TextureLoader();
  function getTexture(gltf, bin, ti, srgb, cache) {
    const key = ti + '_' + (srgb ? 1 : 0);
    if (cache[key]) return cache[key];
    const tex = gltf.textures && gltf.textures[ti];
    if (!tex) return null;
    const url = getImageURL(gltf, bin, tex.source);
    if (!url) return null;
    /* The blob URL is revoked in the load callback — a texture per model per
       session otherwise leaks the decoded image for the life of the page. */
    const t = TEXLOADER.load(url, () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
    t.flipY = false;
    if (srgb) { if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace || 'srgb'; else t.encoding = THREE.sRGBEncoding; }
    const W = { 10497: THREE.RepeatWrapping, 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping };
    if (tex.sampler != null && gltf.samplers) {
      const s = gltf.samplers[tex.sampler];
      t.wrapS = W[s.wrapS] || THREE.RepeatWrapping; t.wrapT = W[s.wrapT] || THREE.RepeatWrapping;
    } else { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    cache[key] = t;
    return t;
  }

  function buildPrimitive(gltf, bin, prim, tc) {
    if (prim.mode != null && prim.mode !== 4) return null;      // triangles only
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(readAccessor(gltf, bin, prim.attributes.POSITION), 3));
    if (prim.attributes.NORMAL != null) geo.setAttribute('normal', new THREE.BufferAttribute(readAccessor(gltf, bin, prim.attributes.NORMAL), 3));
    let hasUV = false;
    if (prim.attributes.TEXCOORD_0 != null) {
      const uv = readAccessor(gltf, bin, prim.attributes.TEXCOORD_0);
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('uv2', new THREE.BufferAttribute(uv, 2));
      hasUV = true;
    }
    if (prim.indices != null) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(readAccessor(gltf, bin, prim.indices)), 1));
    if (prim.attributes.NORMAL == null) geo.computeVertexNormals();
    const params = { color: 0xb4b4b4, metalness: 0.1, roughness: 0.85, emissive: 0x000000, side: THREE.DoubleSide };
    if (prim.material != null && gltf.materials) {
      const m = gltf.materials[prim.material] || {}, pbr = m.pbrMetallicRoughness || {};
      if (pbr.baseColorFactor) { const c = pbr.baseColorFactor; params.color = new THREE.Color(c[0], c[1], c[2]).getHex(); }
      if (pbr.metallicFactor != null) params.metalness = pbr.metallicFactor;
      if (pbr.roughnessFactor != null) params.roughness = pbr.roughnessFactor;
      if (m.emissiveFactor) { const e = m.emissiveFactor; params.emissive = new THREE.Color(e[0], e[1], e[2]).getHex(); }
      if (hasUV && gltf.textures) {
        if (pbr.baseColorTexture) { const t = getTexture(gltf, bin, pbr.baseColorTexture.index, true, tc); if (t) params.map = t; }
        if (m.emissiveTexture) { const t = getTexture(gltf, bin, m.emissiveTexture.index, true, tc); if (t) params.emissiveMap = t; }
        if (m.normalTexture) { const t = getTexture(gltf, bin, m.normalTexture.index, false, tc); if (t) params.normalMap = t; }
      }
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(params));
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  function buildNode(gltf, bin, ni, tc) {
    const n = gltf.nodes[ni] || {}, g = new THREE.Group();
    if (n.matrix) { g.applyMatrix4(new THREE.Matrix4().fromArray(n.matrix)); }
    else {
      if (n.translation) g.position.fromArray(n.translation);
      if (n.rotation) g.quaternion.fromArray(n.rotation);
      if (n.scale) g.scale.fromArray(n.scale);
    }
    if (n.mesh != null && gltf.meshes && gltf.meshes[n.mesh]) {
      (gltf.meshes[n.mesh].primitives || []).forEach((p) => {
        const m = buildPrimitive(gltf, bin, p, tc); if (m) g.add(m);
      });
    }
    (n.children || []).forEach((c) => g.add(buildNode(gltf, bin, c, tc)));
    return g;
  }

  function buildGLTFScene(gltf, bin) {
    const tc = {}, root = new THREE.Group();
    const scn = gltf.scenes ? gltf.scenes[gltf.scene || 0] : null;
    const nodes = scn ? scn.nodes : (gltf.nodes || []).map((_, i) => i);
    nodes.forEach((n) => root.add(buildNode(gltf, bin, n, tc)));
    return root;
  }

  /* Centre on X/Z, sit on Y=0, and wrap. The wrap matters: the caller sets
     position and rotation on the WRAPPER, so the recentring offset inside is
     never clobbered by a later .position.set(). */
  function normalizeModel(group, scale) {
    group.scale.setScalar(scale || 1);
    group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(group);
    const c = bb.getCenter(new THREE.Vector3());
    group.position.x -= c.x; group.position.z -= c.z; group.position.y -= bb.min.y;
    const wrap = new THREE.Group(); wrap.add(group);
    return wrap;
  }

  return {
    b64ToAb, abToB64, parseModel,
    /** ArrayBuffer → a THREE.Group ready to clone and place. */
    glbToTemplate(buf, scale) { const { json, bin } = parseModel(buf); return normalizeModel(buildGLTFScene(json, bin), scale); },
    /** Largest world dimension — used to suggest a sane default scale on import. */
    maxDimOf(buf) {
      const { json, bin } = parseModel(buf);
      const g = buildGLTFScene(json, bin);
      g.updateMatrixWorld(true);
      const s = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
      return Math.max(s.x, s.y, s.z) || 1;
    },
    /** Footprint radius for collision — floor props block, everything else does not. */
    footprintRadius(g, declared, mount) {
      if (mount && mount !== 'floor') return 0;
      let r = +declared || 0;
      if (r > 0) return r;
      try {
        const bb = new THREE.Box3().setFromObject(g);
        const sz = bb.getSize(new THREE.Vector3());
        r = Math.max(sz.x, sz.z) * 0.42;
      } catch (e) {}
      return Math.max(0.35, r || 0.45);
    },
  };
}

export default makeGlb;
