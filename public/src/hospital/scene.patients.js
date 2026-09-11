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
import { SLOTS, BED_SIZE, MATTRESS_TOP, lieAt, queueSpot, DOOR, slotAt, deskBypass, BED_MODEL, bedYaw } from './beds.js';

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
  /* ⚠ Centred so its TOP lands exactly on MATTRESS_TOP, which is also where
     lieAt() puts the patient. One number, two consumers. */
  g.add(box(THREE, mattress, w - 0.06, 0.16, d - 0.06, 0, MATTRESS_TOP - 0.08, 0));
  g.add(box(THREE, blanket, w - 0.1, 0.06, d * 0.55, 0, h + 0.13, d * 0.12));
  g.add(box(THREE, pillow, w * 0.6, 0.1, 0.4, 0, h + 0.15, -d / 2 + 0.35));
  g.add(box(THREE, steel, w, h + 0.5, 0.06, 0, (h + 0.5) / 2, -d / 2));   // headboard
  return g;
}

/* 🛏 HOW HIGH THE LIE CLIP ALREADY SITS, per model, measured once.
   ──────────────────────────────────────────────────────────────────────────
   A lie-down clip is authored against whatever surface its animator had in
   mind, and the four supplied ones disagree: two rest with the body at y≈0 and
   two put it a metre up. Dropping every one of them on the mattress height
   would leave half the ward floating a metre over the bed and the other half
   correct — the kind of bug that looks like a bad model rather than a missing
   offset.
   So the pose is MEASURED and subtracted. CPU-skinning a sample of the
   vertices is the only honest way to ask where a skinned mesh actually IS
   (Box3 reports the bind pose), and it runs once per model key, not per
   patient and not per frame.
   ⚠ Returns 0 on any failure, which is exactly the old behaviour. */
const LIE_DROP = {};
function lieDropFor(THREE, key, m) {
  if (LIE_DROP[key] != null) return LIE_DROP[key];
  let drop = 0;
  try {
    if (!m || !m.lie) { LIE_DROP[key] = 0; return 0; }
    let sm = null;
    m.root.traverse((o) => { if (o.isSkinnedMesh && !sm) sm = o; });
    if (!sm) { LIE_DROP[key] = 0; return 0; }
    const saved = m.mixer._actions.map((a) => a.getEffectiveWeight());
    for (const a of m.mixer._actions) a.setEffectiveWeight(a === m.lie ? 1 : 0);
    m.mixer.update(0.5);
    m.holder.updateMatrixWorld(true);
    const pos = sm.geometry.attributes.position, v = new THREE.Vector3();
    const step = Math.max(1, Math.floor(pos.count / 600));
    let min = Infinity;
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      if (sm.applyBoneTransform) sm.applyBoneTransform(i, v); else sm.boneTransform(i, v);
      // The HOLDER's frame, not the world's: the patient group has not been
      // positioned yet and its own y is what we are about to compute.
      v.applyMatrix4(sm.matrixWorld);
      if (v.y < min) min = v.y;
    }
    m.mixer._actions.forEach((a, i) => a.setEffectiveWeight(saved[i] || 0));
    if (Number.isFinite(min)) drop = min;
  } catch (e) { drop = 0; }
  LIE_DROP[key] = drop;
  return drop;
}

async function fetchBytes(url) {
  if (BYTES[url]) return BYTES[url];
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ab = await r.arrayBuffer();
  BYTES[url] = ab;
  return ab;
}

/* A bed model: load its .glb and scale it to the slot's length.
   `yaw` turns the model so its headboard lands where the cot's is (local -z)
   — the built-in bed's is measured at pack time (beds.js bedYaw); a
   catalogue bed passes 0, as before.
   ⚠ THREE LEVELS, ON PURPOSE. ensureBed sets the OUTER group's rotation to
     the slot's; the yaw lives on a holder inside it; the root inside that
     carries the centring offset. Putting the yaw on the outer group would be
     overwritten by the slot rotation, and putting it on the root would swing
     the centring offset round with it. */
async function loadProp(THREE, url, yaw) {
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
          const holder = new THREE.Group(); holder.add(root); holder.rotation.y = yaw || 0;
          const g = new THREE.Group(); g.add(holder);
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
    /* 🛏 THE WARD COT IS A MODEL NOW (beds.js BED_MODEL). A cot placed
       before it had a url carries url '' in the saved state; it gets the
       model too rather than staying a box forever. Catalogue beds keep their
       own url, and their own (unrotated) orientation. */
    const isCot = b.itemId === 'cot';
    const url = b.url || (isCot ? BED_MODEL.url : '');
    if (url) {
      loadProp(THREE, url, isCot ? bedYaw() : 0).then((prop) => {
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
          rec.lieDrop = lieDropFor(THREE, def.key, m);
          /* Every clip starts silent; the frame loop above raises whichever one
             the patient's state calls for. Missing the two new ones here left
             a talk cycle running at full weight from the moment the model
             landed, on a patient who was still walking through the door. */
          for (const a of [m.walk, m.run, m.talk, m.lie]) if (a) a.setEffectiveWeight(0);
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
        let t = targetOf(p, p.status === 'waiting' ? qi++ : 0);
        /* 🚶 The desk stands between the lobby and everything else. A walk
           whose straight line would cut through it is bent round the side
           first — beds.js deskBypass() — and the real destination comes back
           the moment the line is clear.
           ⚠ `leaving` IS READ AFTER THE BEND, deliberately: the waypoint
             carries leaving:false, so a patient walking out is not removed
             from the scene the moment they reach the side of the desk. */
        const by = deskBypass(rec.x, rec.z, t.x, t.z);
        if (by) t = { x: by.x, z: by.z, lying: false, leaving: false };
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

        /* 🛏 A REAL LIE CLIP MEANS THE FIGURE IS NOT TIPPED OVER. Without one
           the only way to put someone in a bed was to rotate the whole group
           −90° on X and drop a STANDING pose on its back — legs straight,
           arms at the sides, visibly a felled statue. With the clip, the model
           lies down on its own, so the group stays upright and only the
           height and facing are set. The tip-over survives as the fallback
           for a model that has no lie clip, and for the box figures. */
        const hasLie = !!(rec.model && rec.model.lie);
        /* The mattress height, less whatever the lie clip already lifts the body
           by — see lieDropFor(). 0 for a standing pose and for the box figure. */
        /* lieAt() already includes LIE_CLEARANCE, so nothing is added here — the
           old +0.02 was compensating for a surface figure that was wrong. */
        const bedY = (t.y || 0.73);
        rec.group.position.set(rec.x, rec.lying ? bedY - (hasLie ? (rec.lieDrop || 0) : 0) : 0, rec.z);
        if (rec.lying && !hasLie) { rec.group.rotation.x = -Math.PI / 2; rec.group.rotation.y = t.rot || 0; }
        else {
          rec.group.rotation.x = 0;
          if (rec.lying) rec.group.rotation.y = t.rot || 0;
        }

        if (rec.model) {
          /* 🎭 ONE POSE AT A TIME, chosen by what the patient is DOING — these
             are whole-body clips (a talk gestures with both arms, a lie is
             horizontal), so blending any two of them produces a person doing
             neither. Whichever is live takes the full weight and the rest take
             none, exactly like the lab's carry cycle.
             The order is the priority: lying beats talking beats walking,
             because a patient in a bed is in a bed whatever else is true. */
          const m = rec.model;
          const lying = rec.lying && !!m.lie;
          // Arrived in the lobby queue and waiting to be seen — that is the
          // intake desk, and it is where they talk.
          const talking = !lying && !rec.moving && p.status === 'waiting' && !!m.talk;
          const walking = !lying && !talking && rec.moving;
          if (m.lie) m.lie.setEffectiveWeight(lying ? 1 : 0);
          if (m.talk) m.talk.setEffectiveWeight(talking ? 1 : 0);
          if (m.walk) m.walk.setEffectiveWeight(walking ? 1 : 0);
          if (m.run) m.run.setEffectiveWeight(0);
          /* ⚠ The mixer advances even when every weight is 0, so the clips stay
             in phase and the first frame after a pause is not a random pose. */
          m.mixer.update(dt);
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
