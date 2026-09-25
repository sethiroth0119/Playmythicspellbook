/* ══════════════════════════════════════════════════════════════════════════
   🏥 SCENE · STATION MODELS — the counters, as models.
   ──────────────────────────────────────────────────────────────────────────
   The lab's scene builder draws every station as a cabinet + worktop + a
   machine on top (scene.js, "── stations"). That is right for a bench and
   wrong for a reception counter, so once the building is built this swaps
   the boxes of every station that carries a `model` (floor.js: the Front
   Desk's DESK_MODEL, the Ward Bay's BAY_MODEL) for its .glb — the same shape
   of swap scene.patients.js makes when a catalogue bed replaces the cot.

   ⚠ THE BOX STAYS UNTIL THE MODEL IS READY, and stays for good on a device
     that cannot fetch. Nothing in the building depends on the model: the
     collider and the prompt come from floor.js, not from the mesh.
   ⚠ THE RING IS NOT TOUCHED. The builder's per-station highlight works on
     `ring` (opacity + scale), which is a separate object in the scene; only
     the group's children are replaced, so the reach highlight keeps working.
   ⚠ SCALED FROM WHAT IS MEASURED, NOT FROM raw. Each counter is scaled so
     its measured height is model.height. floor.js sizes the COLLIDER from
     model.raw, and the smoke pins raw to the packed file's sidecar, so the
     two agree — but the mesh never trusts a number it can measure.
   ⚠ MESHY CENTRES ITS EXPORTS AT THE MIDDLE, not the base: raw bounds run
     y −0.69 → +0.70. Floored here, like every other prop in the game.
   ⚠ ONE FETCH PER URL. Two stations sharing a file would download it once.
   ══════════════════════════════════════════════════════════════════════════ */

import { ensureGltfLoader } from '../biolab/scene.js';
import { STATIONS } from './floor.js';

const BYTES = {};   // url -> Promise<ArrayBuffer>

function fetchBytes(url) {
  if (!BYTES[url]) BYTES[url] = fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .catch((e) => { delete BYTES[url]; throw e; });
  return BYTES[url];
}

function parse(THREE, ab) {
  return new Promise((resolve, reject) => {
    try { new THREE.GLTFLoader().parse(ab, '', (g) => resolve(g.scene || g.scenes[0]), reject); }
    catch (e) { reject(e); }
  });
}

/* Load one station's model and stand it in the builder's group. */
async function place(THREE, st, model, isAlive) {
  if (!(await ensureGltfLoader())) return;
  const root = await parse(THREE, await fetchBytes(model.url));
  if (!isAlive() || !root) return;

  // Scale to the real counter height, floor at y = 0, centre on x/z.
  const b = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); b.getSize(size);
  root.scale.setScalar(model.height / Math.max(0.01, size.y));
  const b2 = new THREE.Box3().setFromObject(root);
  const c = new THREE.Vector3(); b2.getCenter(c);
  root.position.set(-c.x, -b2.min.y, -c.z);

  /* The yaw goes on a HOLDER, not the root: the root's offset above is what
     centres it, and a rotation applied there would swing that offset round
     with it. Rotating the holder turns a centred counter in place. */
  const holder = new THREE.Group();
  holder.add(root);
  holder.rotation.y = model.yaw || 0;

  if (!isAlive()) return;
  // Out with the builder's cabinet, worktop and machine; in with the counter.
  while (st.group.children.length) st.group.remove(st.group.children[0]);
  st.group.add(holder);
}

export function mountStationModels(sceneApi) {
  const THREE = sceneApi && sceneApi.THREE;
  const stations = sceneApi && sceneApi.stations;
  if (!THREE || !stations) return { dispose() {} };
  let alive = true;
  const isAlive = () => alive;
  for (const s of STATIONS) {
    const st = s.model && stations[s.key];
    if (!st || !st.group) continue;
    place(THREE, st, s.model, isAlive).catch(() => {
      /* The box is still standing. Same answer as a device that cannot fetch. */
    });
  }
  return { dispose() { alive = false; } };
}
