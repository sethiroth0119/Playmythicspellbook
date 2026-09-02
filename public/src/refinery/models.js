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
  character:  { label: 'Player Character', group: 'People',  height: 1.85, ground: 'origin', yaw: Math.PI,
                anim: { idle: ['idle', 'Idle', 'idle_loop', 'Armature|idle'],
                        walk: ['walk', 'Walk', 'walking', 'Armature|walk'],
                        run:  ['run', 'Run', 'running', 'Armature|run'] },
                note: 'Rig it Y-up with feet at the origin, facing −Z. Clips named idle / walk / run are picked up automatically.' },

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
export function urlFor(slot) {
  const u = urls()[slot];
  return (typeof u === 'string' && u.trim()) ? u.trim() : null;
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
    let settled = false;
    const fail = (msg) => {
      if (settled) return; settled = true;
      cache.set(slot, { status: 'error', root: null, clips: [], err: String(msg || 'load failed'), url });
      try { console.warn('[refinery/models] ' + slot + ': ' + msg); } catch (e) {}
      resolve(null);
    };
    /* A url that never answers would leave the slot 'pending' forever and the
       admin panel would show a spinner with no explanation. */
    const timer = setTimeout(() => fail('timed out after 20s'), 20000);
    try {
      L.load(url, (gltf) => {
        clearTimeout(timer);
        if (settled) return; settled = true;
        try {
          const root = normalise(gltf.scene || gltf.scenes[0], SLOTS[slot]);
          cache.set(slot, { status: 'ready', root, clips: gltf.animations || [], url });
          resolve(root);
        } catch (e) { fail(e && e.message); }
      }, null, (e) => { clearTimeout(timer); fail((e && (e.message || e.type)) || 'network error'); });
    } catch (e) { clearTimeout(timer); fail(e && e.message); }
  });
  cache.set(slot, { status: 'pending', root: null, clips: [], url, promise: p });
  return p;
}

/* Warm every slot that has a url. One call at yard-open; the placements that
   follow all hit the cache. */
export function preloadAll() {
  const u = urls();
  return Promise.all(SLOT_IDS.filter(s => u[s]).map(s => preload(s).catch(() => null)));
}

/* ── NORMALISE ════════════════════════════════════════════════════════════
   Measure, scale to the slot's declared height, re-seat, re-face. This is what
   lets an admin drop in any export without knowing the yard's units. */
function normalise(scene, slot) {
  T = T || window.THREE;
  const g = new T.Group();
  g.add(scene);

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

  g.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      // Exported materials are frequently double-sided and depth-writing in
      // ways that fight the yard's fog; leave the material alone but make sure
      // it is not culling the model into invisibility.
      if (o.material && o.material.side === undefined) o.material.side = T.FrontSide;
    }
  });
  return g;
}

/* ── PLACEMENT ════════════════════════════════════════════════════════════
   The one function the scene calls. Returns a Group either way, so callers
   never branch on whether a custom model exists. */
export function build(slot, procedural) {
  T = T || window.THREE;
  const c = cache.get(slot);
  if (c && c.status === 'ready' && c.root) {
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
