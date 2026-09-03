/* ══════════════════════════════════════════════════════════════════════════
   🎬 SCENE · PATIENTS AND BEDS — the people in the building, in three.js.
   ──────────────────────────────────────────────────────────────────────────
   Sits on top of the lab's scene builder (build() hands back `scene` and
   `THREE`) and owns two kinds of object: the BEDS standing in the ward bay's
   slots, and the PATIENTS — walking in from the door, queueing in the lobby,
   lying in a bed, walking out again. It reads the hospital's state every
   frame and never writes it; the simulation is state.js's.

   Patients wear one of PATIENT_MODELS (patients.models.js), chosen at
   arrival. While a model is missing or still loading they are a tinted box
   figure, which is also the permanent answer on a device that cannot fetch.

   ⚠ Skinned meshes cannot be cloned without SkeletonUtils, which r128's core
     does not carry, so each patient parses their own copy — from a shared
     byte cache after the first fetch, so a look downloads once. A few
     patients is a few parses; fine. A hundred would not be, and the lobby
     cap in patients.js keeps it a few.
   ══════════════════════════════════════════════════════════════════════════ */

import { ensureGltfLoader, loadCharacter } from '../biolab/scene.js';
import { PATIENT_MODELS, FALLBACK_TINTS } from './patients.models.js';
import { SLOTS, BED_SIZE, lieAt, queueSpot, DOOR, slotAt } from './beds.js';

const WALK = 2.2;      // m/s, an unhurried patient
const BYTES = {};      // url -> ArrayBuffer, fetched once

function box(THREE, mat, w, h, d, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }

/* A person made of six boxes, in a tint. Same silhouette as the lab's
   fallback avatar so the two read as the same species. */
function boxPerson(THREE, tint) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: tint });
  const cloth = new THREE.MeshLambertMaterial({ color: 0xbfc8d4 });
  g.add(box(THREE, cloth, 0.56, 0.86, 0.34, 0, 0.9, 0));
  g.add(box(THREE, skin, 0.36, 0.36, 0.34, 0, 1.55, 0));
  g.add(box(THREE, skin, 0.15, 0.7, 0.16, -0.37, 0.95, 0));
  g.add(box(THREE, skin, 0.15, 0.7, 0.16, 0.37, 0.95, 0));
  g.add(box(THREE, cloth, 0.2, 0.84, 0.22, -0.15, 0.42, 0));
  g.add(box(THREE, cloth, 0.2, 0.84, 0.22, 0.15, 0.42, 0));
  return g;
}

/* The built-in cot, and the fallback for a catalogue bed whose model did not
   load: frame, mattress, pillow, a blanket in the ward's teal. */
function cotMesh(THREE) {
  const g = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0x5a6675 });
  const mattress = new THREE.MeshLambertMaterial({ color: 0xe4e6ea });
  const blanket = new THREE.MeshLambertMaterial({ color: 0x3f8f84 });
  const pillow = new THREE.MeshLambertMaterial({ color: 0xf4f4f6 });
  const { w, d, h } = BED_SIZE;
  for (const [x, z] of [[-w / 2 + 0.05, -d / 2 + 0.05], [w / 2 - 0.05, -d / 2 + 0.05], [-w / 2 + 0.05, d / 2 - 0.05], [w / 2 - 0.05, d / 2 - 0.05]]) g.add(box(THREE, steel, 0.08, h, 0.08, x, h / 2, z));
  g.add(box(THREE, steel, w, 0.06, d, 0, h - 0.1, 0));
  g.add(box(THREE, mattress, w - 0.06, 0.16, d - 0.06, 0, h + 0.02, 0));
  g.add(box(THREE, blanket, w - 0.1, 0.06, d * 0.55, 0, h + 0.13, d * 0.12));
  g.add(box(THREE, pillow, w * 0.6, 0.1, 0.4, 0, h + 0.15, -d / 2 + 0.35));
  g.add(box(THREE, steel, w, h + 0.5, 0.06, 0, (h + 0.5) / 2, -d / 2));   // headboard
  return g;
}

async function fetchBytes(url) {
  if (BYTES[url]) return BYTES[url];
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ab = await r.arrayBuffer();
  BYTES[url] = ab;
  return ab;
}

/* A catalogue bed: load its .glb and scale it to the slot's length. */
async function loadProp(THREE, url) {
  if (!(await ensureGltfLoader())) return null;
  const ab = await fetchBytes(url);
  return new Promise((resolve) => {
    try {
      new THREE.GLTFLoader().parse(ab, '', (gltf) => {
        try {
          const root = gltf.scene || gltf.scenes[0];
          const b = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3(); b.getSize(size);
          const s = BED_SIZE.d / Math.max(0.01, Math.max(size.x, size.z));
          root.scale.setScalar(s);
          const b2 = new THREE.Box3().setFromObject(root);
          root.position.y = -b2.min.y;
          const c = new THREE.Vector3(); b2.getCenter(c);
          root.position.x = -c.x; root.position.z = -c.z;
          const g = new THREE.Group(); g.add(root);
          resolve(g);
        } catch (e) { resolve(null); }
      }, () => resolve(null));
    } catch (e) { resolve(null); }
  });
}

export function mountPatients(sceneApi) {
  const THREE = sceneApi.THREE, scene = sceneApi.scene;
  const beds = {};       // slot -> { group, itemId }
  const people = {};     // patientId -> { group, model, look, x, z, target, lying, walkW }
  const slotRings = [];

  // Faint outlines where beds can go, so an empty ward reads as a ward.
  for (const s of SLOTS) {
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(BED_SIZE.w + 0.3, BED_SIZE.d + 0.3),
      new THREE.MeshBasicMaterial({ color: 0x8fd4c8, transparent: true, opacity: 0.08, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.rotation.z = s.rot;
    ring.position.set(s.x, 0.02, s.z);
    scene.add(ring); slotRings.push(ring);
  }

  function ensureBed(b) {
    const key = b.slot | 0;
    if (beds[key] && beds[key].itemId === b.itemId) return;
    if (beds[key]) { scene.remove(beds[key].group); }
    const s = slotAt(key); if (!s) return;
    const g = cotMesh(THREE);
    g.position.set(s.x, 0, s.z); g.rotation.y = s.rot;
    scene.add(g);
    beds[key] = { group: g, itemId: b.itemId };
    if (b.url) {
      loadProp(THREE, b.url).then((prop) => {
        if (!prop || !beds[key] || beds[key].itemId !== b.itemId) return;
        scene.remove(beds[key].group);
        prop.position.set(s.x, 0, s.z); prop.rotation.y = s.rot;
        scene.add(prop); beds[key].group = prop;
      }).catch(() => {});
    }
  }

  function ensurePerson(p) {
    if (people[p.id]) return people[p.id];
    const def = PATIENT_MODELS.length ? PATIENT_MODELS[(p.look | 0) % PATIENT_MODELS.length] : null;
    const tint = FALLBACK_TINTS[(p.look | 0) % FALLBACK_TINTS.length];
    const group = new THREE.Group();
    const fallback = boxPerson(THREE, tint);
    group.add(fallback);
    group.position.set(DOOR.x, 0, DOOR.z);
    scene.add(group);
    const rec = { group, fallback, model: null, x: DOOR.x, z: DOOR.z, target: null, lying: false, moving: false };
    people[p.id] = rec;
    if (def && def.url) {
      (async () => {
        try {
          const bank = (window.MythicBioLabModels = window.MythicBioLabModels || {});
          if (!bank[def.key]) bank[def.key] = await fetchBytes(def.url);
          const m = await loadCharacter(THREE, def);
          if (!m || !people[p.id]) return;
          group.remove(fallback);
          group.add(m.holder);
          rec.model = m;
          for (const a of [m.walk, m.run]) if (a) a.setEffectiveWeight(0);
        } catch (e) {}
      })();
    }
    return rec;
  }

  /* Where a patient should be right now. Waiting: their spot in the lobby
     line. In bed: lying on it. Done or left: the door, then gone. */
  function targetOf(p, queueIndex) {
    if (p.status === 'waiting') return Object.assign({ lying: false }, queueSpot(queueIndex));
    if (p.status === 'inbed' || p.status === 'treating') { const l = lieAt(p.bedSlot); return l ? { x: l.x, z: l.z, y: l.y, rot: l.rot, lying: true } : { x: 0, z: -8, lying: false }; }
    return { x: DOOR.x, z: DOOR.z, lying: false, leaving: true };
  }

  return {
    /* Called every frame with the live patient list, the placed beds and dt. */
    sync(patients, placedBeds, dtMs) {
      const dt = Math.max(0, Math.min(100, +dtMs || 0)) / 1000;
      // beds
      const want = {};
      for (const b of (placedBeds || [])) { want[b.slot | 0] = 1; ensureBed(b); }
      for (const k of Object.keys(beds)) if (!want[k]) { scene.remove(beds[k].group); delete beds[k]; }
      // people
      const live = {};
      let qi = 0;
      for (const p of (patients || [])) {
        live[p.id] = 1;
        const rec = ensurePerson(p);
        const t = targetOf(p, p.status === 'waiting' ? qi++ : 0);
        rec.leaving = !!t.leaving;
        const dx = t.x - rec.x, dz = t.z - rec.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.05) {
          const step = Math.min(dist, WALK * dt);
          rec.x += dx / dist * step; rec.z += dz / dist * step;
          rec.group.rotation.y = Math.atan2(dx, dz);
          rec.moving = true;
        } else rec.moving = false;
        rec.lying = !!t.lying && dist <= 0.1;
        rec.group.position.set(rec.x, rec.lying ? (t.y || 0.6) + 0.02 : 0, rec.z);
        if (rec.lying) { rec.group.rotation.x = -Math.PI / 2; rec.group.rotation.y = t.rot || 0; }
        else rec.group.rotation.x = 0;
        if (rec.model) {
          const w = rec.moving && !rec.lying ? 1 : 0;
          if (rec.model.walk) rec.model.walk.setEffectiveWeight(w);
          if (rec.model.run) rec.model.run.setEffectiveWeight(0);
          rec.model.mixer.update(dt);
        } else if (rec.moving) {
          // the box figure bobs a little so it reads as walking
          rec.group.position.y += Math.abs(Math.sin(Date.now() / 140)) * 0.05;
        }
        if (rec.leaving && dist <= 0.1) { scene.remove(rec.group); delete people[p.id]; }
      }
      for (const id of Object.keys(people)) if (!live[id]) { scene.remove(people[id].group); delete people[id]; }
    },
    dispose() {
      for (const k of Object.keys(beds)) scene.remove(beds[k].group);
      for (const k of Object.keys(people)) scene.remove(people[k].group);
      for (const r of slotRings) scene.remove(r);
    },
  };
}
