/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — the model registry
   ---------------------------------------------------------------------------
   EVERY visual object in the yard is a SLOT. A slot has a procedural builder
   (pure three.js primitives, always available, never fails) and an optional
   GLB url. When a url is set the loaded model replaces the primitives; when it
   is absent, or 404s, or is malformed, the primitives stand in and the yard
   still reads correctly. There is no state in which the player sees nothing.

   HOW AN ADMIN CHANGE REACHES EVERY PLAYER
     The urls live on `Forge.refineryModels`, handed over by the bridge.
     `Forge` is the game's ADMIN-AUTHORED, CLOUD-SYNCED catalogue — the same
     object that already carries Black River's machine models, the map photos
     and the tuned economy tables. An admin sets a url, saveForge() pushes it,
     and every player's next load pulls the same model. Nothing is per-device.
     (Uploaded BYTES are a different matter and deliberately not done here: the
     Extraction Field keeps uploads in IndexedDB, which is per-device by
     definition and cannot be what "changes it for everyone" means.)

   ⚠ SCALE AND ORIENTATION ARE NORMALISED, NOT TRUSTED. A model exported from
   Blender at metres, one at centimetres and one Z-up would otherwise land in
   the yard at 1×, 100× and lying on its face. Every load is measured, scaled
   to the slot's declared height and re-seated on the ground plane.
   ═════════════════════════════════════════════════════════════════════════ */

let T = null;   // window.THREE, captured on first use

/* ── THE SLOTS ────────────────────────────────────────────────────────────
   height — the world height the model is normalised to, in yard units. This
            is what makes a swapped model sit correctly without the admin
            having to guess an export scale.
   ground — 'base' seats the model's lowest point on y=0 (tanks, buildings);
            'origin' keeps the model's own origin (characters, which usually
            author with feet at 0 and need their root left alone for
            animation).
   yaw    — extra rotation, radians, applied after load. Some exporters face
            +Z, some face -Z; a slot that cares says so.
   anim   — animation clip names this slot looks for, in priority order. Only
            the character uses them today. */
export const SLOTS = {
  // ── The operator ──────────────────────────────────────────────────────
  /* 🧭 yaw 0, NOT Math.PI. walk.js aims the avatar with atan2(vx, vz), which
     is 0 when travelling toward +Z, so at yaw 0 the mesh must face +Z. The
     Guardian is authored facing +Z, and the half-turn that used to be here
     made him walk backwards — the animation was right, the model was simply
     pointed the wrong way. If a future character moonwalks, this is the one
     line to change. */
  character:  { label: 'Player Character', group: 'People',  height: 1.85, ground: 'origin', yaw: 0,
                /* Matching is a case-insensitive substring test, so 'walk'
                   also finds 'Armature|Walking' and 'Carry_Heavy_Object_Walk'.
                   ⚠ ORDER MATTERS INSIDE A LIST, and 'carry' is listed before
                     'walk' on its own row for that reason: the shipped carry
                     clip has the word "walk" in its original name, so a walk
                     lookup that ran first would claim it. */
                anim: { idle: ['idle', 'Idle', 'idle_loop', 'Armature|idle'],
                        walk: ['walk', 'Walk', 'walking', 'Armature|walk'],
                        run:  ['run', 'Run', 'running', 'Armature|run'],
                        carry: ['carry', 'Carry', 'carry_walk', 'Carry_Heavy_Object_Walk'] },
                note: 'Rig it Y-up with feet at the origin, facing −Z. Clips named idle / walk / run / carry are picked up automatically. Ships with the Guardian of the Rig; paste a url to replace it, or "-" for the procedural figure.' },

  // ── Process units. Each one is a platform the player can walk up to. ───
  column:     { label: 'Distillation Column', group: 'Process', height: 21,  ground: 'base' },
  cracker:    { label: 'Cracking Unit',       group: 'Process', height: 9.5, ground: 'base' },
  reformer:   { label: 'Catalytic Reformer',  group: 'Process', height: 9.5, ground: 'base' },
  treater:    { label: 'Hydrotreater',        group: 'Process', height: 9.5, ground: 'base' },
  alky:       { label: 'Alkylation Unit',     group: 'Process', height: 9.5, ground: 'base' },
  pumps:      { label: 'Pump & Valve Skid',   group: 'Process', height: 1.6, ground: 'base' },
  flare:      { label: 'Flare Stack',         group: 'Process', height: 18,  ground: 'base' },

  // ── Storage ───────────────────────────────────────────────────────────
  crudeTank:  { label: 'Crude Tank',          group: 'Storage', height: 4.2, ground: 'base' },
  storeTank:  { label: 'Product Tank',        group: 'Storage', height: 5.0, ground: 'base' },
  blendTank:  { label: 'Blending Tank',       group: 'Storage', height: 5.6, ground: 'base' },

  // ── Logistics ─────────────────────────────────────────────────────────
  bay:        { label: 'Loading Bay',         group: 'Logistics', height: 5.5, ground: 'base' },
  truck:      { label: 'Tanker Truck',        group: 'Logistics', height: 3.4, ground: 'base', yaw: 0 },

  // ── The office, and what is in it ─────────────────────────────────────
  office:     { label: 'Office Building',     group: 'Office', height: 6.4, ground: 'base',
                note: 'The roof is a separate slot so it can fade out when the player walks in.' },
  officeRoof: { label: 'Office Roof',         group: 'Office', height: 1.2, ground: 'origin',
                note: 'Fades to nothing while the player is inside. Model it as the roof alone, origin at eaves height.' },
  door:       { label: 'Office Door',         group: 'Office', height: 2.6, ground: 'base',
                note: 'Hinged on its LEFT edge — model it with the hinge at x=0 so it swings correctly.' },
  desk:       { label: 'Office Desk',         group: 'Office', height: 0.78, ground: 'base' },
  computer:   { label: 'Contract Terminal',   group: 'Office', height: 0.52, ground: 'base' },
  chair:      { label: 'Office Chair',        group: 'Office', height: 1.05, ground: 'base' },

  // ── Site furniture ────────────────────────────────────────────────────
  lab:        { label: 'Laboratory',          group: 'Site', height: 3.2, ground: 'base' },
  automation: { label: 'Automation Suite',    group: 'Site', height: 3.2, ground: 'base' },
  buildPad:   { label: 'Build Plot Marker',   group: 'Site', height: 0.3, ground: 'base' },
};
export const SLOT_IDS = Object.keys(SLOTS);
export const SLOT_GROUPS = [...new Set(SLOT_IDS.map(k => SLOTS[k].group))];

/* ── URL REGISTRY ─────────────────────────────────────────────────────────
   Read through the bridge every time rather than cached: an admin who pastes
   a url expects the next rebuild to use it, not the next page load. */
export function urls() {
  try {
    const b = (typeof window !== 'undefined' && window.MythicRefineryBridge) || null;
    const m = b && b.modelUrls && b.modelUrls();
    return (m && typeof m === 'object') ? m : {};
  } catch (e) { return {}; }
}
/* 🧍 SHIPPED DEFAULTS — models that come with the game rather than being
   pasted in by an admin.

   The Guardian of the Rig is the yard's operator: a FIXTURE, not a per-owner
   upload, so it belongs here where it works on a fresh install with nothing
   published. An admin who pastes a url still overrides it, and '-' clears the
   slot back to the procedural figure (see urlFor).

   Packed by tools/glbpack-character.mjs from three Meshy exports — walking,
   running and carry-heavy-object — into one 0.73 MB file with clips named
   walk / run / carry, down from 24.3 MB across three files.

   ── THE HISTORY, because it cost several rounds ──────────────────────────
   This looked for a long time like a broken asset: the character rendered as
   a smear filling the screen, or vanished. It was NOT the asset. Verified in a
   standalone viewer (public/model-test.html) running the same three.js r128 and
   GLTFLoader: the model loads at 1.85 m, all 24 bones bind, and all three clips
   play correctly. What was actually wrong was measurement — a skinned mesh's
   bounding box is the BIND pose, so anything that frames or scales by it is
   working from the wrong number the moment a clip plays.
   Ruled out along the way, so nobody repeats them: cloning, frustum culling,
   weights not summing to 1, a second bone-influence set, and the armature's
   0.01 export scale.
   ⚠ Any future "the model is broken" report should start at model-test.html.
     If it walks there, the asset is fine and the fault is on this side. */
/* 🚚 The tanker is a real model now, not the boxes-and-a-cylinder mock-up.
   Same slot the admin can override or clear back to procedural with '-', so
   the fallback in scene.js (truckMesh) stays the answer when the file 404s. */
const BUILT_IN = {
  character: '/models/refinery/guardian.glb',
  truck: '/models/trucks/tanker.glb',
};

export function urlFor(slot) {
  const u = urls()[slot];
  if (typeof u === 'string' && u.trim()) return u.trim();
  // The admin can clear a slot back to the procedural shape by setting '-'.
  if (u === '-') return null;
  return BUILT_IN[slot] || null;
}
export function setUrl(slot, url) {
  try {
    const b = window.MythicRefineryBridge;
    if (!b || !b.setModelUrl) return false;
    return !!b.setModelUrl(slot, url);
  } catch (e) { return false; }
}

/* ── LOAD CACHE ═══════════════════════════════════════════════════════════
   slot → { status, root, clips, err }. A model is fetched ONCE per session
   however many copies of it the yard places; every placement clones it.
   ⚠ Failures are cached too, deliberately. Without that, a 404 url on a slot
   with six instances is six requests per rebuild, forever. */
const cache = new Map();
export function status(slot) {
  const c = cache.get(slot);
  if (!c) return urlFor(slot) ? 'pending' : 'procedural';
  return c.status;
}
export function errorFor(slot) { const c = cache.get(slot); return (c && c.err) || null; }

/* Drop a slot's cached load so the next build refetches. Called when an admin
   changes or clears a url — otherwise the old model persists until reload. */
export function invalidate(slot) {
  if (slot) cache.delete(slot); else cache.clear();
}

function loader() {
  T = T || window.THREE;
  if (!T || !T.GLTFLoader) return null;
  return new T.GLTFLoader();
}

/* Fetch + normalise one slot. Resolves to null on ANY failure — a bad model is
   a procedural model, never an exception and never an empty patch of ground. */
export function preload(slot) {
  const url = urlFor(slot);
  if (!url) { cache.set(slot, { status: 'procedural', root: null, clips: [] }); return Promise.resolve(null); }
  const hit = cache.get(slot);
  if (hit && hit.url === url) return hit.promise || Promise.resolve(hit.root);
  const L = loader();
  if (!L) { cache.set(slot, { status: 'error', root: null, clips: [], err: '3D loader unavailable', url }); return Promise.resolve(null); }

  const p = new Promise(resolve => {
    /* ⚠ ONE SETTLE GATE, AND THE SUCCESS PATH DOES NOT CLAIM IT EARLY.
       This used to set `settled = true` before normalise() ran, so a model
       that FAILED to normalise — an export with no visible geometry, a flat
       one, anything the guards below reject — reached fail(), hit its own
       `if (settled) return`, and the promise NEVER RESOLVED. The slot stuck on
       'pending' forever, preloadAll() never settled, and the .then(rebuild)
       that redraws the yard with everyone's other models never fired. One bad
       url from an admin would have quietly frozen the model registry for every
       player, with a spinner and no error. */
    let settled = false;
    const settle = (fn) => { if (settled) return; settled = true; fn(); };
    const fail = (msg) => settle(() => {
      cache.set(slot, { status: 'error', root: null, clips: [], err: String(msg || 'load failed'), url });
      try { console.warn('[refinery/models] ' + slot + ': ' + msg); } catch (e) {}
      resolve(null);
    });
    const ready = (root, clips) => settle(() => {
      cache.set(slot, { status: 'ready', root, clips: clips || [], url });
      resolve(root);
    });
    /* A url that never answers would leave the slot 'pending' forever and the
       admin panel would show a spinner with no explanation. */
    const timer = setTimeout(() => fail('timed out after 20s'), 20000);
    try {
      L.load(url, (gltf) => {
        clearTimeout(timer);
        try {
          ready(normalise(gltf.scene || gltf.scenes[0], SLOTS[slot], gltf.animations), gltf.animations);
        } catch (e) { fail((e && e.message) || 'could not be prepared'); }
      }, null, (e) => { clearTimeout(timer); fail((e && (e.message || e.type)) || 'network error'); });
    } catch (e) { clearTimeout(timer); fail(e && e.message); }
  });
  cache.set(slot, { status: 'pending', root: null, clips: [], url, promise: p });
  return p;
}

/* Warm every slot that has a url. One call at yard-open; the placements that
   follow all hit the cache. */
/* 🔴 FILTERS ON urlFor(), NOT ON urls(). This read `u[s]` — the ADMIN OVERRIDE
   map — so a slot whose model is a SHIPPED DEFAULT (BUILT_IN) was never
   preloaded at all. build() then found nothing cached, drew the procedural
   shape and kicked off its own fetch for "the next rebuild", but the one
   rebuild the yard performs had already run, so the mock-up stayed on screen
   for the whole session with nothing reporting a problem.
   That is exactly how the Cracking Yard kept showing its boxes-and-a-cylinder
   tanker after the real model shipped. The operator escaped it only because
   scene.js preloads 'character' by name a few lines further down — a
   workaround for a race that was really this bug wearing a different hat.
   urlFor() is the same resolver build() uses, and it already returns null for
   a slot an admin cleared to '-', so the exclusion that mattered still holds. */
export function preloadAll() {
  return Promise.all(SLOT_IDS.filter(s => urlFor(s)).map(s => preload(s).catch(() => null)));
}

/* ── NORMALISE ════════════════════════════════════════════════════════════
   Measure, scale to the slot's declared height, re-seat, re-face. This is what
   lets an admin drop in any export without knowing the yard's units. */
/* 🔩 A FULLY METALLIC MATERIAL IN A SCENE WITH NO ENVIRONMENT MAP RENDERS
   BLACK, and that is physics rather than a bug in the file: a metal has no
   diffuse response, so all it can show is what it reflects — and this yard has
   a hemisphere light, a key light and nothing to reflect. Generator exports
   almost all arrive at metallicFactor 1.
   Measured on the Cracking Yard's tanker: base colour map bound, 1024², UVs
   intact, and it still drew as a flat grey slab. The operator escaped it only
   because that particular export happens to carry a white emissive.
   So the factor is pulled down to something that reads under direct light.
   ⚠ SCALED, NOT REPLACED. metalnessMap still multiplies against this, so a
     model that painted chrome trim against a painted body keeps the contrast —
     it just stops being uniformly unlit. A model authored for this scene
     (metalness already low) is left completely alone. */
function tameMetal(mat) {
  if (!mat) return;
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list) {
    if (!m || typeof m.metalness !== 'number' || m.envMap) continue;
    if (m.metalness > 0.6) m.metalness = 0.25;
    // Roughness 1 with no envMap is flat and dead; a little sheen reads as a
    // painted vehicle rather than a matte prop.
    if (typeof m.roughness === 'number' && m.roughness > 0.95) m.roughness = 0.72;
    m.needsUpdate = true;
  }
}

function normalise(scene, slot, clips) {
  T = T || window.THREE;
  const g = new T.Group();
  g.add(scene);

  /* 🦴 A RIGGED MODEL IS SCALED ON THE WRAPPER, NOT ON ITSELF.
     ═══════════════════════════════════════════════════════════════════════
     THE BUG THIS FIXES made every skinned character unusable, and it was in
     the loader — not in any asset. Proven by loading a completely unmodified
     Meshy export: it failed exactly like the packed one.

     Skinning does not use the mesh's own world matrix. It uses the mesh's
     bindMatrixInverse — captured once, at load, in the pose the file was
     authored in — together with each bone's CURRENT world matrix. Writing a
     scale onto `scene`, which sits between the wrapper and the armature,
     changes the bones' world matrices while that stored inverse stays at the
     old scale. The two disagree by the scale factor and the GPU deforms the
     mesh by it: at ~109x the operator became a smear across the screen, and
     at other factors vanished off-camera. Every CPU-side check passes while
     it happens, because Box3 measures the bind pose, not the GPU result.

     Scaling the WRAPPER instead keeps the mesh and its bones in exactly the
     relationship they were bound in — the whole object is scaled from
     outside, which three.js handles correctly — so the deformation stays
     valid at any size.
     ⚠ Non-rigged props keep the old path: they have no bind matrix to
       invalidate, and several of them rely on the per-model recentring below. */
  let rigged = false;
  scene.traverse((n) => { if (n.isSkinnedMesh) rigged = true; });
  if (rigged) return normaliseRigged(g, scene, slot, clips);

  const box = new T.Box3().setFromObject(scene);
  /* ⚠ REJECT A MODEL WITH NO GEOMETRY, LOUDLY.
     An empty scene (a glTF that exported only lights or cameras, a file whose
     meshes are all hidden) gives an EMPTY Box3 — min at +Infinity, max at
     -Infinity — and getSize() reports zero. Clamping that to 0.0001 and
     dividing produced a perfectly finite scale factor, so the model was
     accepted, reported "● custom" in the admin panel, and rendered a
     zero-height nothing where the tank used to be. The admin would have seen a
     hole in the yard and a green tick telling them it worked. */
  if (box.isEmpty()) throw new Error('the file contains no visible geometry');
  const size = box.getSize(new T.Vector3());
  const tall = size.y;
  if (!(tall > 1e-6)) throw new Error('the model is flat — it has no height to scale by');

  const want = (slot && slot.height) || 4;
  const k = want / tall;
  if (!isFinite(k) || k <= 0) throw new Error('model has no measurable size');
  scene.scale.setScalar(k);

  const box2 = new T.Box3().setFromObject(scene);
  const c = box2.getCenter(new T.Vector3());
  // Centre on X/Z so the model sits where the yard puts it, not where its
  // author happened to leave the origin.
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  if (!slot || slot.ground !== 'origin') scene.position.y -= box2.min.y;

  if (slot && typeof slot.yaw === 'number') g.rotation.y = slot.yaw;

  /* 🦴 REBIND AFTER SCALING — a skinned mesh does not follow its ancestors'
     scale for free.
     Skinning is computed from each bone's world matrix and the mesh's
     bindMatrixInverse, which was captured when the model was authored. Scaling
     an ancestor changes the bones' world matrices but NOT the stored inverse,
     so the two disagree and the GPU deforms the mesh by the ratio — which for
     this rig (a 0.01-scaled armature normalised back up by ~109×) drew the
     operator as a smear filling the screen. Every CPU-side check passed while
     it happened: bind pose correct, bones in scene, bounding box a correct
     1.85 m, because Box3 measures the bind pose and not the GPU result.
     Recomputing the world matrices and re-binding each skinned mesh to its own
     current matrixWorld makes the inverse agree with the new scale. */
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      try { o.bind(o.skeleton, o.matrixWorld); } catch (e) {}
    }
  });

  g.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      // Exported materials are frequently double-sided and depth-writing in
      // ways that fight the yard's fog; leave the material alone but make sure
      // it is not culling the model into invisibility.
      if (o.material && o.material.side === undefined) o.material.side = T.FrontSide;
      tameMetal(o.material);
    }
  });
  return g;
}

/* ── PLACEMENT ════════════════════════════════════════════════════════════
   The one function the scene calls. Returns a Group either way, so callers
   never branch on whether a custom model exists. */
/* 📐 THE TRUE SIZE OF A POSED SKINNED MESH.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 Box3.setFromObject() IS USELESS HERE AND THAT IS THE TRAP. For a
      SkinnedMesh it transforms `geometry.boundingBox` — which is the BIND
      pose — by the node's world matrix. It does not know the GPU is about to
      deform the vertices, so it returns the same tidy figure whatever the
      character is doing. Measured on the Guardian: 1.85 m at rest and 1.85 m
      mid-stride, while the screen showed a character many times the size of
      the office. Two rounds of "but every measurement says it is correct"
      came from trusting it.

   So the vertices are skinned on the CPU, the way the shader does it:
   boneTransform() applies the bone matrices and bind matrices to one vertex.
   Sampling is enough — a stride across the buffer catches the extremities
   without walking tens of thousands of points on the load path. */
function skinnedBounds(mesh, target) {
  try {
    const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    if (!pos || typeof mesh.boneTransform !== 'function') return target;
    const v = new T.Vector3();
    // ~400 samples is plenty to find the extremes of a humanoid.
    const stride = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += stride) {
      mesh.boneTransform(i, v);
      target.expandByPoint(mesh.localToWorld(v));
    }
  } catch (e) {}
  return target;
}

/* The rigged path: measure, then scale and seat the WRAPPER. `scene` itself is
   never touched, so the bind relationship the file was authored with survives
   intact — see the note in normalise() for what happens when it does not. */
function normaliseRigged(g, scene, slot, clips) {
  T = T || window.THREE;
  let box = new T.Box3().setFromObject(scene);
  if (box.isEmpty()) throw new Error('the file contains no visible geometry');

  /* 📏 MEASURE THE ANIMATED POSE, NOT THE BIND POSE — this is the whole fix.
     ═══════════════════════════════════════════════════════════════════════
     A SkinnedMesh reports the bounding box of the pose it was AUTHORED in.
     Scaling by that is correct only if the clips stay inside it, and for this
     rig they do not: the Guardian measures a tidy 1.85 m at rest and many
     times that once a clip plays, so `k` came out as 1 and the character
     arrived in the yard enormous. Every check said 1.85 m while the screen
     showed a giant, which is what made this so slow to find.

     So: step a mixer through the first clip and take the union of the boxes.
     That is the space the character actually occupies, and scaling by it puts
     it at the slot's declared height whatever the rig does.
     ⚠ The pose is reset afterwards. Leaving the model mid-clip would bake a
       frame of the walk cycle into the bind pose every consumer then sees. */
  try {
    if (Array.isArray(clips) && clips.length && T.AnimationMixer) {
      const probe = new T.AnimationMixer(scene);
      const clip = clips[0];
      const act = probe.clipAction(clip);
      act.play();
      const steps = 10;
      const dt = Math.max(0.02, (clip.duration || 1) / steps);
      const real = new T.Box3();
      for (let i = 0; i < steps; i++) {
        probe.update(dt);
        scene.updateMatrixWorld(true);
        scene.traverse((n) => { if (n.isSkinnedMesh) skinnedBounds(n, real); });
      }
      act.stop(); probe.stopAllAction();
      probe.uncacheRoot(scene);
      // Put the rig back where it started.
      scene.traverse((n) => { if (n.isSkinnedMesh && n.skeleton) { n.skeleton.pose(); n.skeleton.update(); } });
      scene.updateMatrixWorld(true);
      if (!real.isEmpty()) box = real;
    }
  } catch (e) { /* an un-probeable clip just falls back to the bind box */ }

  const size = box.getSize(new T.Vector3());
  const tall = size.y;
  if (!(tall > 1e-6)) throw new Error('the model is flat — it has no height to scale by');

  const want = (slot && slot.height) || 1.85;
  const k = want / tall;
  if (!isFinite(k) || k <= 0) throw new Error('model has no measurable size');
  g.scale.setScalar(k);
  /* 📏 What the bind pose measured, kept so measureAnimated() below can say
     whether the clips move the character outside it. */
  g.userData.bindHeight = tall;

  /* Recentre and seat using the measured box, expressed in the WRAPPER's own
     units — the box was measured before the scale, so the offsets are applied
     to `scene` as plain translations, which do not disturb skinning the way a
     scale does. */
  const c = box.getCenter(new T.Vector3());
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  if (!slot || slot.ground !== 'origin') scene.position.y -= box.min.y;

  if (slot && typeof slot.yaw === 'number') g.rotation.y = slot.yaw;

  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      if (o.material && o.material.side === undefined) o.material.side = T.FrontSide;
      tameMetal(o.material);   // same reason as the prop path — see tameMetal()
      /* A skinned mesh's bounding volumes are the BIND pose; an animated pose
         reaches outside them and three.js would cull the character the moment
         the bind box left the frustum. */
      if (o.isSkinnedMesh) o.frustumCulled = false;
    }
  });
  return g;
}

/* 🦴 SKELETON-AWARE CLONE — Object3D.clone() is NOT enough for a rigged model.
   ═══════════════════════════════════════════════════════════════════════════
   `.clone(true)` copies the bone hierarchy but leaves every cloned
   SkinnedMesh sharing the ORIGINAL Skeleton, whose `bones` array still points
   at the original bones. Two things follow, and the second one is brutal:

     1. a mixer driving the CLONE's bones moves nothing, because the mesh is
        skinned to the original's;
     2. once the original is detached — which is exactly what rebuilding the
        avatar does — the renderer walks a skeleton whose bones are no longer
        in any scene and throws
        "Cannot read properties of undefined (reading 'frame')" from inside
        renderer.render(). The whole yard goes black with a stack that names
        three.js and not this file.

   That is what happened here the moment the operator got a real rigged GLB.
   This is three.js's own SkeletonUtils.clone, inlined: it is an examples/
   file, and the yard runs on the r128 GLOBAL build where examples are not
   available (see the note at the top of scene.js about CapsuleGeometry).
   Rebinds each cloned SkinnedMesh to a Skeleton built from the CLONE's bones,
   matched by name. */
function cloneRigged(src) {
  /* This is three.js's own SkeletonUtils.clone, transcribed. Getting any of
     the three details below subtly wrong produces a model that loads, reports
     a correct bounding box and renders as a smear:

       1. bones are matched by WALKING BOTH TREES IN LOCKSTEP, not by name. A
          glTF joint is not always loaded as a THREE.Bone (GLTFLoader promotes
          a node only when it is in a skin's joints and carries no mesh), so a
          name map built from `isBone` can come out empty — and a name map in
          general breaks on any rig with two nodes sharing a name.
       2. the skeleton is `.clone()`d and its bones REPLACED, so boneInverses
          are carried over intact rather than reused from a live skeleton.
       3. bind() is called with the source's bindMatrix — NOT the clone's
          matrixWorld, which is identity until the clone is added to a scene
          and parented. That was the smear: correct bones, wrong bind space. */
  const srcByClone = new Map();
  const cloneBySrc = new Map();
  const out = src.clone(true);
  (function pair(a, b) {
    srcByClone.set(b, a);
    cloneBySrc.set(a, b);
    for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]);
  })(src, out);

  out.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const sourceMesh = srcByClone.get(node);
    if (!sourceMesh || !sourceMesh.skeleton) return;
    const sourceBones = sourceMesh.skeleton.bones;
    node.skeleton = sourceMesh.skeleton.clone();
    node.bindMatrix.copy(sourceMesh.bindMatrix);
    node.skeleton.bones = sourceBones.map((b) => cloneBySrc.get(b) || b);
    node.bind(node.skeleton, node.bindMatrix);
  });
  return out;
}

export function build(slot, procedural) {
  T = T || window.THREE;
  const c = cache.get(slot);
  if (c && c.status === 'ready' && c.root) {
    let rigged = false;
    c.root.traverse((n) => { if (n.isSkinnedMesh) rigged = true; });
    /* 🔴 A RIGGED MODEL IS HANDED OVER, NOT COPIED.
       Cloning a SkinnedMesh correctly is genuinely hard — the skeleton, the
       bind matrix and the bone hierarchy all have to be rebuilt together, and
       getting any of it slightly wrong yields a model that loads, measures a
       correct bounding box, and renders as a smear across the screen. Three
       increasingly faithful clone implementations were tried here, including
       three.js's own SkeletonUtils.clone transcribed line for line, and each
       one still deformed wrongly against this rig.

       The yard does not need a copy. `character` is a SINGLE-INSTANCE slot —
       there is exactly one operator — so the cached root IS the model. It is
       re-parented on each rebuild, which is what the scene wanted anyway.

       ⚠ This is correct ONLY while the slot is single-instance. A rigged model
         that needs two simultaneous copies (a crowd, an NPC set) must not go
         through this path: both would share one skeleton and animate in
         lockstep. Non-rigged props still clone, which is what lets six
         identical tanks stand in six places. */
    if (rigged) {
      if (c.root.parent) c.root.parent.remove(c.root);
      c.root.userData.custom = true;
      return c.root;
    }
    const g = c.root.clone(true);
    g.userData.custom = true;
    return g;
  }
  // Not loaded (or failed): procedural now, and kick off the fetch so the NEXT
  // rebuild has it. This is what makes the yard appear instantly on a cold
  // load rather than waiting on a network round trip.
  if (!c && urlFor(slot)) preload(slot);
  const g = procedural ? procedural() : new T.Group();
  g.userData.custom = false;
  return g;
}

/* Animation clips for a slot, if its model brought any. Returns the raw
   THREE.AnimationClip array — the character controller does the mixing. */
export function clips(slot) {
  const c = cache.get(slot);
  return (c && c.clips) || [];
}

/* Find the clip a slot's convention calls `role` (idle / walk / run).
   Matching is case-insensitive and substring-based because exporters prefix
   clip names with the armature ("Armature|walk"), and an admin should not have
   to rename tracks in Blender to make a model work. */
export function clipFor(slot, role) {
  const list = clips(slot);
  if (!list.length) return null;
  const want = ((SLOTS[slot] && SLOTS[slot].anim && SLOTS[slot].anim[role]) || [role]);
  for (const name of want) {
    const exact = list.find(c => c.name === name);
    if (exact) return exact;
  }
  for (const name of want) {
    const lc = String(name).toLowerCase();
    const loose = list.find(c => String(c.name).toLowerCase().includes(lc));
    if (loose) return loose;
  }
  return null;
}
