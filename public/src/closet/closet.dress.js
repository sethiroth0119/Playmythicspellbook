/* closet.dress.js — WEARING an outfit: the runtime every scene shares.

   dress(THREE, body, outfit, catalog) hangs each worn item on the body:
   measure the body once (closet.rig.js), then per item: load its .glb
   (cached by URL, one template per file, cloned per wearer), put a socket
   on the right bone, place the item from its fit record. The same call
   dresses the studio's mannequin, the Character Creator's preview, the
   player's own avatar and every peer in a hub — so a watch that fits in the
   creator fits in the world, because it is the same code and the same tape
   measure.

   Nothing here knows where the catalog came from (cloud, device, a packet);
   it gets plain item records and URLs. Loading is best-effort: a 404'd item
   is simply not worn, the body still is. */

import { CAT_BY_ID, normalizeOutfit } from './closet.model.js';
import { measure, socketFor, placeItem, partKey, itemDims } from './closet.rig.js';

const templates = new Map();   // url → Promise<{ scene, size }>
let loaderInst = null;

function loader(THREE) {
  if (loaderInst) return loaderInst;
  if (THREE.GLTFLoader) { try { loaderInst = new THREE.GLTFLoader(); } catch (e) { loaderInst = null; } }
  return loaderInst;
}
/* Load a .glb once per URL and hand out CLONES: the same jacket on twelve
   people in a hub is one download and one parse. Skinned clothing (rare —
   a shirt with its own bones) is cloned like any mesh; it follows the
   chest bone as one rigid piece, which is the deliberate v1 limit. */
export function loadModel(THREE, url) {
  if (!url) return Promise.reject(new Error('no url'));
  if (templates.has(url)) return templates.get(url);
  const p = (async () => {
    const L = loader(THREE); if (!L) throw new Error('GLTFLoader unavailable');
    const g = await new Promise((res, rej) => L.load(url, res, undefined, rej));
    const scene = g.scene || (g.scenes && g.scenes[0]);
    if (!scene) throw new Error('empty glb');
    scene.updateMatrixWorld(true);
    // centre on XZ and on Y: an item is placed by its box, so its origin is its middle
    const bb = new THREE.Box3().setFromObject(scene), c = new THREE.Vector3(); bb.getCenter(c);
    const wrap = new THREE.Group(); scene.position.set(-c.x, -c.y, -c.z); wrap.add(scene);
    wrap.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
    const size = new THREE.Vector3(); bb.getSize(size);
    return { scene: wrap, size: [size.x, size.y, size.z], clips: g.animations || [] };
  })();
  p.catch(() => {});
  templates.set(url, p);
  return p;
}
export function forget(url) { templates.delete(url); }
/* 🔴 SkinnedMesh + clone: Object3D.clone does not rebind skeletons, so a
   plain clone of a rigged body still points at the TEMPLATE's bones — its
   own bones never move it, and a measurement keyed on them finds nothing.
   This is the SkeletonUtils algorithm inlined (the same one
   mapforge.world.js uses for placed characters). Materials stay shared. */
export function cloneModel(tpl) {
  const src = tpl.scene, clone = src.clone(true);
  const srcBones = {}, dstBones = {};
  src.traverse(n => { if (n.isBone) srcBones[n.uuid] = n; });
  clone.traverse(n => { if (n.isBone) dstBones[n.name] = n; });
  const srcSkinned = [], dstSkinned = [];
  src.traverse(n => { if (n.isSkinnedMesh) srcSkinned.push(n); });
  clone.traverse(n => { if (n.isSkinnedMesh) dstSkinned.push(n); });
  dstSkinned.forEach((dst, i) => {
    const s = srcSkinned[i]; if (!s || !s.skeleton) return;
    const bones = s.skeleton.bones.map(b => dstBones[b.name] || b);
    /* ⚠ bind with the COPIED bindMatrix, not matrixWorld: a glTF skin is bound
       at identity, and binding at the mesh's 0.01-scaled world matrix shrinks
       every skinned vertex a hundredfold (measured: a 1.8 m soldier read 4 mm) */
    dst.bind(new THREE_Skeleton(dst, bones, s.skeleton.boneInverses), dst.bindMatrix);
  });
  return clone;
}
// the Skeleton constructor off the mesh's own THREE (r128 global) without importing it here
function THREE_Skeleton(mesh, bones, inverses) { const S = mesh.skeleton.constructor; return new S(bones, inverses); }

/* ── dress a body ──
   opts.onItem(cat, side, obj)  called when each piece is on
   opts.onMeasure(meas)          the measurement, for a camera or a readout
   Returns { meas, pieces: Map<cat[.side], { socket, obj, item }>, refresh(outfit), dispose(), setOutfit(outfit) } */
export function dress(THREE, body, outfit, catalog, opts) {
  opts = opts || {};
  const H = { meas: null, pieces: new Map(), outfit: normalizeOutfit(outfit), disposed: false, gen: 0 };
  const byId = (id) => (catalog && catalog.items || []).find(i => i.id === id) || null;
  function ensureMeasure() { if (!H.meas) { H.meas = measure(THREE, body); if (opts.onMeasure) { try { opts.onMeasure(H.meas); } catch (e) {} } } return H.meas; }
  function removePiece(key) {
    const p = H.pieces.get(key); if (!p) return;
    try { if (p.socket.parent) p.socket.parent.remove(p.socket); } catch (e) {}
    H.pieces.delete(key);
  }
  async function wear(cat, item, side, gen) {
    const C = CAT_BY_ID[cat]; if (!C || !item || !item.url) return;
    const key = cat + (side ? '.' + side : '');
    let tpl; try { tpl = await loadModel(THREE, item.url); } catch (e) { return; }
    if (H.disposed || gen !== H.gen) return;
    const meas = ensureMeasure();
    const pk = partKey(C, side);
    const part = meas.parts[pk]; if (!part) return;
    removePiece(key);
    const socket = socketFor(THREE, meas, part, body);
    const obj = cloneModel(tpl); obj.name = 'closet:' + key;
    socket.add(obj);
    const dims = (item.dims && item.dims[0] > 0) ? item.dims : tpl.size;
    placeItem(THREE, Object.assign({}, item, { dims }), obj, part, C, item.fit, side);
    H.pieces.set(key, { socket, obj, item, part: pk, side });
    if (opts.onItem) { try { opts.onItem(cat, side, obj, H.pieces.get(key)); } catch (e) {} }
  }
  function apply(outfit) {
    H.outfit = normalizeOutfit(outfit); H.gen++;
    const gen = H.gen;
    const want = new Set();
    Object.keys(H.outfit.wear).forEach(cat => {
      const C = CAT_BY_ID[cat]; const item = byId(H.outfit.wear[cat]); if (!C || !item) return;
      const sides = C.pair ? ['l', 'r'] : [''];
      sides.forEach(side => {
        const key = cat + (side ? '.' + side : ''); want.add(key);
        const cur = H.pieces.get(key);
        if (cur && cur.item.id === item.id && JSON.stringify(cur.item.fit) === JSON.stringify(item.fit)) return;
        wear(cat, item, side, gen);
      });
    });
    Array.from(H.pieces.keys()).forEach(k => { if (!want.has(k)) removePiece(k); });
  }
  /* measure NOW, synchronously, while the caller still has the body at rest
     — the item files arrive later, and by then a mixer may be posing it */
  if (Object.keys(H.outfit.wear).length) { try { ensureMeasure(); } catch (e) {} }
  apply(H.outfit);
  return {
    get meas() { return ensureMeasure(); },
    pieces: H.pieces,
    get outfit() { return H.outfit; },
    setOutfit: apply,
    /* the body's pose or scale changed: measure again and re-place everything */
    refit() { H.meas = null; const o = H.outfit; Array.from(H.pieces.keys()).forEach(removePiece); apply(o); },
    /* one item's fit changed in the studio: re-place it without reloading */
    replace(cat, item) {
      const C = CAT_BY_ID[cat]; if (!C) return;
      (C.pair ? ['l', 'r'] : ['']).forEach(side => {
        const key = cat + (side ? '.' + side : ''); const p = H.pieces.get(key); if (!p) return;
        const meas = ensureMeasure(); const part = meas.parts[p.part]; if (!part) return;
        p.item = item; placeItem(THREE, item, p.obj, part, C, item.fit, side);
      });
    },
    dispose() { H.disposed = true; Array.from(H.pieces.keys()).forEach(removePiece); },
  };
}

/* the size a freshly loaded item has, for the studio's import step */
export async function measureItem(THREE, url) {
  const tpl = await loadModel(THREE, url);
  const obj = cloneModel(tpl);
  const scene = new THREE.Group(); scene.add(obj);
  const d = itemDims(THREE, obj);
  scene.remove(obj);
  return d;
}
