
/* ══════════════════════════════════════════════════════════════════════════
   🎬 SCENE — the containment lab, in three.js.
   ──────────────────────────────────────────────────────────────────────────
   🔴 IT REUSES THE LEGACY GLOBAL `window.THREE` (r128 from cdnjs), NOT the
   `three` import-map entry. index.html carries BOTH: an import map pointing at
   the 0.171 WebGPU build for /sprite-live, and a lazily-injected r128 global
   for the VFX, the battlemap and the pack opener. This file is loaded as a
   classic module from index.html AND could be opened from the city page, and
   only the global is reachable from both. `ensureThree()` is a copy of
   index.html's `_vfxEnsureThree` for exactly that reason — do not "modernise"
   it to a bare `import * as THREE from 'three'` unless you have checked every
   page that mounts this.

   🔴 IT MUST BE ABLE TO FAIL. `build()` returns null if WebGL is unavailable
   or the CDN is blocked, and index.js falls back to the 2D bench (see
   `open({ flat: true })`). A player on a locked-down device or an old phone
   still gets the whole cure/ship/outbreak loop; what they lose is the room.
   The 3D layer is the presentation of a feature, never the feature.

   ⚠ THE BROWSER PANE IN THIS ENVIRONMENT DOES NOT COMPOSITE (CLAUDE.md):
   requestAnimationFrame never fires, so `frame(dt)` is exported and driven by
   index.js's loop rather than being a closed-over RAF callback. A driver can
   step the scene by hand.
   ══════════════════════════════════════════════════════════════════════════ */

/* ⚠ ALIASED, because build() can be handed ANOTHER building's floor plan.
   /src/hospital passes its own room, hot line and station table; these three
   are the DEFAULTS for the lab, not the only answer. */
import { ROOM as ROOM_LAB, HOT_Z as HOT_Z_LAB, STATIONS as STATIONS_LAB } from './stations.js';

/* ── the character models ─────────────────────────────────────────────────
   Two GLBs, one per state: the researcher you arrive as, and the Hazard
   Sentinel you become once the suit is sealed. Each carries BOTH clips
   (walking + running) — the four uploaded files were 30 MB together and 95%
   of every byte was one 2048² PNG, so `_glbpack.mjs` merged each walk/run
   pair and recompressed the texture to 1024px WebP. 30 MB → 1.31 MB, and one
   fetch per character instead of two.

   🔴 THE SUIT COSTS YOU SPEED, and that is why both clips are used rather
   than just the walk. A sealed hazmat suit is heavy: suited you move at
   SUIT_SPEED of normal, which lands you in the walk cycle, while the unsuited
   researcher runs. So the suit is a real trade — it protects the batch and it
   slows you down — and the animation is the readout for it rather than
   decoration. Set SUIT_SPEED to 1 to remove the penalty; the crossfade then
   simply never reaches the walk end. */
/* ⚠ ROOT-RELATIVE, matching CS_ROOM_MODEL / CS_STATIONS in index.html. A bare
   `models/…` would resolve against the PAGE's url rather than the origin, so it
   would work from `/` and quietly 404 from anywhere else. */
export const MODELS = {
  bare: { url: '/models/lab/researcher.glb', key: 'researcher' },
  suit: { url: '/models/lab/sentinel.glb', key: 'sentinel' },
};
export const SUIT_SPEED = 0.72;

/* Clip names as exported. Matched loosely (case-insensitive substring) so a
   re-export from Meshy with a slightly different name still binds instead of
   silently animating nothing. */
const CLIP_WALK = 'walk';
const CLIP_RUN = 'run';
/* 🧍 IDLE. Without it a standing character renders in its BIND POSE, because
   the walk and run weights are both driven to 0 at a standstill — which is why
   the scientist stood in the room with their arms held stiffly out. Optional:
   a model packed before this existed simply has no idle clip, `char.idle` is
   null, and the blend below behaves exactly as it did. */
const CLIP_IDLE = 'idle';
/* 📦 CARRY. Only the sentinel has one — you carry crates in the suit, and the
   unsuited researcher has no business in the hot zone with a sealed batch.
   A model without it falls back to the walk cycle, which reads as "carrying
   nothing" but never as a broken character. */
const CLIP_CARRY = 'carry';
/* 🗣 🛏 THE HOSPITAL'S TWO. A patient talks at the intake desk and lies in a
   bed, and both are real clips rather than poses faked by rotating the whole
   figure onto its side. Optional like the two above: a model without them
   returns null and /src/hospital falls back to what it did before. */
const CLIP_TALK = 'talk';
const CLIP_LIE = 'lie';

/* Carrying is heavier than the suit alone. Slower than SUIT_SPEED so the walk
   back to the bay costs something, which is what makes the bay's position in
   the room a design decision rather than decoration.

   🔴 THIS NUMBER IS SET BY THE CLIP, not by feel. The supplied carry cycle
      covers 0.80 m/s of ground on its own (measureCarry reports it at run
      time), and the playback rate that keeps the feet planted is
      playerSpeed / 0.80. At the original 0.55 — 2.86 m/s — that was 3.6×, a
      laden walk played like a scramble. 0.36 lands near 2.3×, which reads as
      a brisk haul and still crosses the room in about ten seconds.
   ⚠ Raise this and the character speeds up but CARRY_RATE_MAX starts clamping,
     which brings the sliding back. Retune them together. */
export const CARRY_SPEED = 0.36;

/* The band the carry cycle may be played at. The clamp exists so a future clip
   with a very short stride cannot produce a blur — beyond this the feet slide
   again, and a little slide beats an unreadable animation. */
const CARRY_RATE_MIN = 0.5;
const CARRY_RATE_MAX = 2.4;

/* 🔴 WHICH WAY THE MODEL FACES. `avatar.rotation.y` is set to
   `atan2(vx, vz)`, which is 0 when walking toward +z — so at yaw 0 the mesh
   must face +z. Exporters disagree about this and there is no way to detect it
   from the file, so it is ONE constant with a live setter
   (`MythicBioLab._setModelYaw`) rather than something buried in a matrix. If
   the character moonwalks, this is the only thing to change. */
export let MODEL_YAW = 0;
export function setModelYaw(rad) { MODEL_YAW = +rad || 0; return MODEL_YAW; }

/* Target height in metres. The room is built to human scale and the uploads
   are not, so every model is normalised to this rather than trusting its
   export units. */
const MODEL_HEIGHT = 1.75;

/* ── the chase camera ─────────────────────────────────────────────────────
   Offset from the player, in metres. This was (0, 15.5, -13.5) — framed when
   the avatar was six boxes and the room was the only thing worth looking at.
   A 1.75 m character at that distance is about thirty pixels tall: you cannot
   tell the researcher from the sentinel, which defeats the entire point of the
   suit being the model.
   Pulled in twice, to a little over half the original distance. The character
   now reads as a person rather than a smudge, which is the entire point of
   the suit BEING the model.
   ⚠ TUNE HERE, live, with `MythicBioLab._setCamera(y, back)`. This is about
     as close as the 52° FOV takes without the bench you are standing at
     leaving frame; `_setCamera(15.5, 13.5)` restores the original wide shot. */
export let CAM_HEIGHT = 8.4;
export let CAM_BACK = -7.2;
export function setCamera(y, back) {
  if (Number.isFinite(+y)) CAM_HEIGHT = +y;
  if (Number.isFinite(+back)) CAM_BACK = -Math.abs(+back);
  return { height: CAM_HEIGHT, back: CAM_BACK };
}

/* ── GLTFLoader ───────────────────────────────────────────────────────────
   Not in the three.min.js bundle — it is an example file, and it must be
   loaded AFTER the r128 core because its body touches THREE.Loader.prototype
   at definition time.

   🔴 THE VENDORED COPY IS TRIED FIRST, AND THAT ORDER IS THE FIX. This used to
   go straight to jsDelivr, and a CDN that does not answer produced a SILENT
   failure indistinguishable from a broken model: the box avatar stayed, with
   nothing on screen saying why. Reported twice as "the model has not loaded"
   when the models were fine.

   Three sources, in order:
     1. already present — another system in the game may have loaded it
        (the Card Shop does, and patches it for Draco);
     2. `window.MythicBioLabLibs.gltf`, source text handed over in memory —
        how the self-contained preview supplies it, since an Artifact page
        cannot fetch its own assets;
     3. the vendored copy at /src/biolab/, same-origin;
     4. jsDelivr, last, as a courtesy for a build where the vendored file was
        pruned.
   Only if ALL of them fail does it give up — and the caller now says so on
   screen rather than in the console. */
const GLTF_VENDOR = '/src/biolab/gltfloader.vendor.js';
const GLTF_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
/* Which route actually worked, for the diagnostic readout. Three rounds of
   "it still shows a box" went by without anyone being able to see which of
   four sources had been tried, so it is recorded rather than inferred. */
export let GLTF_VIA = null;
export function gltfVia() { return GLTF_VIA; }

function injectScript(src) {
  return new Promise((resolve) => {
    try {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(!!(window.THREE && window.THREE.GLTFLoader));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    } catch (e) { resolve(false); }
  });
}

export async function ensureGltfLoader() {
  try {
    if (window.THREE && window.THREE.GLTFLoader) { GLTF_VIA = GLTF_VIA || 'already-present'; return true; }

    /* 2 — source text handed over in memory (the preview build).
       🔴 INLINE FIRST, BLOB SECOND, AND THAT ORDER IS A CSP FIX. A page served
       with a strict Content-Security-Policy refuses `blob:` script URLs unless
       blob: is explicitly in script-src — measured: "Refused to load the
       script 'blob:…' because it violates the following Content Security
       Policy directive". Assigning the source to a script element's
       textContent is governed by 'unsafe-inline' instead, which any page that
       already runs its own inline scripts must have. Blob is kept as the
       fallback for the reverse policy (nonce-based CSP with blob: allowed). */
    try {
      const libs = window.MythicBioLabLibs;
      const src = libs && typeof libs.gltf === 'string' ? libs.gltf : '';
      if (src) {
        try {
          const s = document.createElement('script');
          s.textContent = src;
          document.head.appendChild(s);
          if (window.THREE && window.THREE.GLTFLoader) { GLTF_VIA = 'inline'; return true; }
        } catch (e) {}
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const ok = await injectScript(url);
        try { URL.revokeObjectURL(url); } catch (e) {}
        if (ok) { GLTF_VIA = 'blob'; return true; }
      }
    } catch (e) {}

    // 3 — the copy that ships with the game.
    if (await injectScript(GLTF_VENDOR)) { GLTF_VIA = 'vendored'; return true; }
    try { console.warn('[biolab] vendored GLTFLoader did not load — falling back to the CDN.'); } catch (e) {}

    // 4 — last resort.
    if (await injectScript(GLTF_CDN)) { GLTF_VIA = 'cdn'; return true; }
    return false;
  } catch (e) { return false; }
}

export function ensureThree() {
  return new Promise((resolve) => {
    try {
      if (window.THREE) { resolve(window.THREE); return; }
      if (window.__vfxThreeLoading) {
        const iv = setInterval(() => { if (window.THREE) { clearInterval(iv); resolve(window.THREE); } }, 120);
        setTimeout(() => { clearInterval(iv); resolve(window.THREE || null); }, 9000);
        return;
      }
      window.__vfxThreeLoading = true;
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      s.onload = () => resolve(window.THREE || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    } catch (e) { resolve(null); }
  });
}

const COL_LAB = {
  floorClean: 0x1c2430,
  floorHot: 0x2a1d24,
  wall: 0x141a23,
  trim: 0x2e3a4a,
  hazard: 0xd8a13a,
  glass: 0x7fd6ff,
};

/* One shared material cache. A station is a handful of boxes and there are six
   of them; building fresh materials per mesh would be forty draw-call state
   changes for a room that should be one. */
function mats(THREE, COL) {
  const m = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
  return {
    floorClean: m(COL.floorClean),
    floorHot: m(COL.floorHot),
    wall: m(COL.wall),
    trim: m(COL.trim),
    hazard: m(COL.hazard),
    glass: new THREE.MeshLambertMaterial({ color: COL.glass, transparent: true, opacity: 0.22 }),
    suitOff: m(0xd8dce4),
    suitOn: m(0xffd166),
    visor: m(0x1a2430),
  };
}

function box(THREE, mat, w, h, d, x, y, z) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  g.position.set(x, y, z);
  return g;
}

/* ── the player avatar ─────────────────────────────────────────────────────
   Six boxes. It is deliberately crude and deliberately READABLE from the
   isometric camera: the whole job of this model is to answer "am I wearing
   the suit" at a glance, from thirty metres up, on a phone. The suit is a
   COLOUR CHANGE plus a visor, because a silhouette change would not survive
   that camera and a particle effect would not survive a mid-range GPU. */
function makeAvatar(THREE, M) {
  const g = new THREE.Group();
  const body = box(THREE, M.suitOff, 0.62, 0.92, 0.38, 0, 0.92, 0);
  const head = box(THREE, M.suitOff, 0.40, 0.38, 0.36, 0, 1.58, 0);
  const visor = box(THREE, M.visor, 0.30, 0.16, 0.04, 0, 1.60, 0.19);
  const armL = box(THREE, M.suitOff, 0.16, 0.72, 0.18, -0.40, 0.96, 0);
  const armR = box(THREE, M.suitOff, 0.16, 0.72, 0.18, 0.40, 0.96, 0);
  const legL = box(THREE, M.suitOff, 0.22, 0.86, 0.24, -0.16, 0.43, 0);
  const legR = box(THREE, M.suitOff, 0.22, 0.86, 0.24, 0.16, 0.43, 0);
  visor.visible = false;
  g.add(body, head, visor, armL, armR, legL, legR);
  g.userData = { body, head, visor, armL, armR, legL, legR };
  return g;
}

/* ── loading one character ────────────────────────────────────────────────
   Two sources, in order of preference:

     1. `window.MythicBioLabModels[key]` — an ArrayBuffer already in memory.
        The self-contained preview build embeds both GLBs this way and calls
        `parse()`, because an Artifact page cannot fetch its own assets.
     2. the URL, fetched normally. This is the path the game takes.

   Returns null on any failure. The caller keeps the box avatar, so a blocked
   CDN, a 404 on the model, or a GPU that refuses skinning all degrade to the
   lab that shipped before these models existed rather than to a blank room. */
/* ── inline a GLB's textures as data: URIs ────────────────────────────────
   🔴 THIS EXISTS BECAUSE OF `connect-src`. A GLB stores its texture inside the
   binary chunk, and three.js turns that into a `blob:` URL and then FETCHES
   it — r128 picks ImageBitmapLoader, which is fetch-based, on every browser
   but Firefox. A page served with a strict Content-Security-Policy refuses
   that: "Refused to connect to 'blob:…' because it violates the following
   Content Security Policy directive: connect-src". The GLB parses, the
   texture load rejects, the whole parse rejects, and the caller sees only
   "the model did not load" — pointing at the file, which is fine.

   Rewriting the image to a `data:` URI before parsing removes the blob and
   the fetch together: the image becomes an ordinary `<img src="data:…">`,
   which is what an Artifact page is explicitly built to allow. It is also
   harmless everywhere else — the game has no CSP and simply takes the same
   path.

   Returns the original buffer untouched on any doubt. A texture that fails to
   inline is a texture that still works the old way; a corrupted rewrite is a
   model that never loads again. */
function inlineGlbTextures(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) return buf;      // not a GLB
    const total = dv.getUint32(8, true);
    let off = 12, json = null, jsonStart = 0, jsonLen = 0, binStart = 0, binLen = 0;
    while (off < total && off + 8 <= buf.byteLength) {
      const len = dv.getUint32(off, true);
      const type = dv.getUint32(off + 4, true);
      if (type === 0x4e4f534a) {
        jsonStart = off + 8; jsonLen = len;
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, jsonStart, jsonLen)));
      } else if (type === 0x004e4942) { binStart = off + 8; binLen = len; }
      off += 8 + len;
    }
    if (!json || !json.images || !json.images.length || !binLen) return buf;

    let changed = false;
    for (const img of json.images) {
      if (img.uri || img.bufferView == null) continue;
      const v = json.bufferViews[img.bufferView];
      if (!v) continue;
      const bytes = new Uint8Array(buf, binStart + (v.byteOffset || 0), v.byteLength);
      // btoa needs a binary string; chunked so a megabyte texture cannot blow
      // the argument limit on String.fromCharCode.
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      img.uri = 'data:' + (img.mimeType || 'image/png') + ';base64,' + btoa(s);
      delete img.bufferView;
      delete img.mimeType;                 // a uri-based image must not carry one
      changed = true;
    }
    if (!changed) return buf;

    /* Re-emit the container. The BIN chunk is kept verbatim — the image's old
       bufferView is now unreferenced, which is legal and costs only the bytes
       we were shipping anyway. Rewriting the buffer to drop them would mean
       renumbering every accessor for no benefit at load time. */
    let jsonStr = JSON.stringify(json);
    while (jsonStr.length % 4) jsonStr += ' ';
    const jsonBytes = new TextEncoder().encode(jsonStr);
    const out = new ArrayBuffer(12 + 8 + jsonBytes.length + 8 + binLen);
    const o = new DataView(out);
    const ob = new Uint8Array(out);
    o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.byteLength, true);
    o.setUint32(12, jsonBytes.length, true); o.setUint32(16, 0x4e4f534a, true);
    ob.set(jsonBytes, 20);
    o.setUint32(20 + jsonBytes.length, binLen, true);
    o.setUint32(24 + jsonBytes.length, 0x004e4942, true);
    ob.set(new Uint8Array(buf, binStart, binLen), 28 + jsonBytes.length);
    return out;
  } catch (e) {
    try { console.warn('[biolab] texture inline skipped:', e); } catch (e2) {}
    return buf;
  }
}

/* Parse with the <img>-based texture loader rather than ImageBitmapLoader.
   r128's GLTFParser picks ImageBitmapLoader whenever `createImageBitmap`
   exists, and that one uses fetch() — the exact call `connect-src` refuses.
   The parser is constructed synchronously inside parse(), so hiding the global
   for the duration of that call is enough, and it is restored immediately. */
function parseWithImgLoader(L, bytes, onLoad, onErr) {
  const had = Object.prototype.hasOwnProperty.call(window, 'createImageBitmap');
  const prev = window.createImageBitmap;
  try { window.createImageBitmap = undefined; } catch (e) {}
  try {
    L.parse(bytes, '', onLoad, onErr);
  } finally {
    try { if (had) window.createImageBitmap = prev; else delete window.createImageBitmap; } catch (e) {}
  }
}

/* Exported for /src/hospital, which loads patient models through the same
   path the lab loads its two characters — one loader, one cache, one set of
   normalisation rules for every rigged figure in either building. */
export function loadCharacter(THREE, def) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    // Never let a hung fetch keep the player staring at a box forever.
    setTimeout(() => finish(null), 15000);
    try {
      const L = new THREE.GLTFLoader();
      const onLoad = (gltf) => {
        try { finish(prepareCharacter(THREE, gltf)); }
        catch (e) { try { console.warn('[biolab] model prep', e); } catch (e2) {} finish(null); }
      };
      /* ⚠ SAY WHICH PATH FAILED. This used to print def.url whichever route ran,
         so a texture rejecting inside parse() was reported as the model file
         failing to download — and four rounds were spent looking at the file. */
      const onErr = (via) => (e) => {
        try { console.warn('[biolab] model ' + via + ' failed for ' + def.key + ':', e); } catch (e2) {}
        finish(null);
      };

      let bytes = null;
      try {
        const bank = (typeof window !== 'undefined') && window.MythicBioLabModels;
        if (bank && bank[def.key]) bytes = bank[def.key];
      } catch (e) {}

      if (bytes) {
        parseWithImgLoader(L, inlineGlbTextures(bytes), onLoad, onErr('parse'));
      } else {
        /* Fetched from the server: pull the bytes ourselves so the same
           texture-inlining runs on this path too, and fall back to the
           loader's own fetch if that is not possible. */
        fetch(def.url).then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        }).then((ab) => {
          parseWithImgLoader(L, inlineGlbTextures(ab), onLoad, onErr('parse'));
        }).catch(() => {
          try { L.load(def.url, onLoad, undefined, onErr('fetch ' + def.url)); }
          catch (e) { finish(null); }
        });
      }
    } catch (e) { finish(null); }
  });
}

/* Normalise an imported character: stand it on the floor, scale it to human
   height, and bind its two clips. Everything here is measured from the model
   rather than assumed, because these are third-party exports and their units,
   origin and clip names are all things that can move between re-exports. */
function prepareCharacter(THREE, gltf) {
  const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!root) return null;

  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = false; o.receiveShadow = false;
      /* Skinned meshes are culled against their bind-pose bounds, so a limb
         swinging outside them makes the whole character flicker out at the
         edge of frame. Cheaper to skip the test than to recompute bounds. */
      o.frustumCulled = false;
    }
  });

  /* ── scale ────────────────────────────────────────────────────────────
     🔴 MEASURE THE GEOMETRY, NOT THE WORLD BOX. `Box3.setFromObject` walks
     matrixWorld, which for these exports includes an armature scale of ~0.01
     — but a SKINNED mesh does not render at that size. GLTFLoader binds with
     `bindMatrix = mesh.matrixWorld` while the model is still unplaced, and the
     baked inverseBindMatrices then undo the armature scale, so the vertices
     come out in GEOMETRY space and are scaled only by what we set here.

     Measuring the world box (0.017 m) instead of the geometry box (1.7 m)
     asked for a 103x scale-up of something already the right size. The result
     was a 175-metre researcher with the camera inside its shin, drawing 3,043
     triangles the player could not identify as anything — the room looked
     empty, which reads exactly like a model that failed to load. It was fully
     loaded and fully drawn the whole time.

     ⚠ THE UNION IS OVER GEOMETRY BOUNDING BOXES IN BIND POSE. That is the
       space the skinned result lives in, so it is the only measurement that
       predicts the rendered height. */
  const gbox = new THREE.Box3();
  const tmp = new THREE.Box3();
  root.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh) || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.geometry.boundingBox) { tmp.copy(o.geometry.boundingBox); gbox.union(tmp); }
  });
  const size = new THREE.Vector3();
  gbox.getSize(size);
  const h = size.y > 0.0001 ? size.y : 1;
  const s = MODEL_HEIGHT / h;
  root.scale.setScalar(s);
  // Feet on the floor, in the same space the height was measured in.
  root.position.y = -gbox.min.y * s;

  // A wrapper so yaw can be applied to the character without fighting the
  // avatar group's own rotation, which follows the player's heading.
  const holder = new THREE.Group();
  holder.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const clips = gltf.animations || [];
  const pick = (want) => clips.find((c) => (c.name || '').toLowerCase().indexOf(want) >= 0) || null;
  const walkClip = pick(CLIP_WALK) || clips[0] || null;
  const runClip = pick(CLIP_RUN) || clips[1] || walkClip;

  /* ⚠ MATCHED BY SUBSTRING, so the order of these three matters less than the
     names not overlapping: 'walk' hits "walking_man", 'run' hits "running",
     and 'idle' hits only the clip the packer named exactly that. Deliberately
     NOT falling back to clips[n] the way walk/run do — a model with no idle
     must report none rather than animate its walk cycle on the spot. */
  const idleClip = pick(CLIP_IDLE);
  const carryClip = pick(CLIP_CARRY);
  const talkClip = pick(CLIP_TALK);
  const lieClip = pick(CLIP_LIE);

  const walk = walkClip ? mixer.clipAction(walkClip) : null;
  const run = runClip ? mixer.clipAction(runClip) : null;
  const idle = idleClip ? mixer.clipAction(idleClip) : null;
  const carry = carryClip ? mixer.clipAction(carryClip) : null;
  const talk = talkClip ? mixer.clipAction(talkClip) : null;
  const lie = lieClip ? mixer.clipAction(lieClip) : null;
  for (const a of [walk, run, idle, carry, talk, lie]) {
    if (!a) continue;
    a.play();
    a.setEffectiveWeight(0);        // weights are driven per frame by speed
    a.setLoop(THREE.LoopRepeat, Infinity);
  }
  return { holder, root, mixer, walk, run, idle, carry, talk, lie, height: MODEL_HEIGHT };
}

/* 🏥 `plan` IS ANOTHER BUILDING'S FLOOR, and without it this drew the LAB's
   room under the Medical Corporation's header — red hot-zone floor, the
   airlock, the lab's five pads. The hospital was passing its PLAN all along;
   this signature was simply ignoring the third argument.
   Everything below reads the LOCALS, never the module-level lab defaults. */
export function build(THREE, canvas, plan) {
  const P = plan || {};
  const ROOM = P.room || ROOM_LAB;
  const HOT_Z = Number.isFinite(+P.hotZ) ? +P.hotZ : HOT_Z_LAB;
  const STATIONS = Array.isArray(P.stations) ? P.stations : STATIONS_LAB;
  const COL = Object.assign({}, COL_LAB, P.colors || {});
  const BG = Number.isFinite(+P.bg) ? +P.bg : 0x0a0e14;
  /* The doorway you walk INTO rather than up to. The lab calls it the airlock;
     the hospital flags its scrub station `frame`. */
  const isFrame = (s) => s.key === 'suitup' || !!s.frame;
  const frameKey = (STATIONS.find(isFrame) || {}).key || 'suitup';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (e) { return null; }
  if (!renderer) return null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 26, 52);

  const M = mats(THREE, COL);

  // ── lighting. Cheap and flat: a hemisphere for the room, one key for shape,
  //    and a sickly green fill over the hot zone so the two halves of the room
  //    read differently even in a screenshot.
  scene.add(new THREE.HemisphereLight(0xbcd0ea, 0x161c26, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(8, 18, -6);
  scene.add(key);
  const hotFill = new THREE.PointLight(0x7fe0a0, 0.8, 30);
  hotFill.position.set(0, 5, 8);
  scene.add(hotFill);

  // ── floor, in two slabs so the hot/clean line is geometry, not a texture.
  const cleanD = (ROOM.d / 2) + HOT_Z;
  const hotD = ROOM.d - cleanD;
  scene.add(box(THREE, M.floorClean, ROOM.w, 0.2, cleanD, 0, -0.1, -ROOM.d / 2 + cleanD / 2));
  scene.add(box(THREE, M.floorHot, ROOM.w, 0.2, hotD, 0, -0.1, HOT_Z + hotD / 2));

  // The hazard stripe ON the boundary. This is the single most important line
  // in the room and it is painted, raised and lit so it cannot be missed.
  const stripe = box(THREE, M.hazard, ROOM.w, 0.06, 0.5, 0, 0.02, HOT_Z);
  scene.add(stripe);

  // ── walls
  const wh = ROOM.h;
  scene.add(box(THREE, M.wall, ROOM.w, wh, 0.4, 0, wh / 2, ROOM.d / 2));
  scene.add(box(THREE, M.wall, 0.4, wh, ROOM.d, -ROOM.w / 2, wh / 2, 0));
  scene.add(box(THREE, M.wall, 0.4, wh, ROOM.d, ROOM.w / 2, wh / 2, 0));
  // The airlock end: two stubs with a gap, so the entrance reads as a door.
  const stub = (ROOM.w - 5.2) / 2;
  scene.add(box(THREE, M.wall, stub, wh, 0.4, -(ROOM.w / 2) + stub / 2, wh / 2, -ROOM.d / 2));
  scene.add(box(THREE, M.wall, stub, wh, 0.4, (ROOM.w / 2) - stub / 2, wh / 2, -ROOM.d / 2));

  // A glass partition across the hot line, with the same 5.2m gap the airlock
  // has — you can SEE the hot zone from the clean side, which is what makes
  // walking into it a choice rather than an accident.
  const pw = (ROOM.w - 5.2) / 2;
  scene.add(box(THREE, M.glass, pw, 3.0, 0.16, -(ROOM.w / 2) + pw / 2, 1.5, HOT_Z));
  scene.add(box(THREE, M.glass, pw, 3.0, 0.16, (ROOM.w / 2) - pw / 2, 1.5, HOT_Z));

  // ── stations
  const stationMeshes = {};
  for (const s of STATIONS) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: s.color });
    const [w, d] = s.size;
    if (s.key === frameKey) {
      // The airlock is a frame you stand inside, not a bench.
      g.add(box(THREE, M.trim, w, 0.14, d, 0, 0.07, 0));
      g.add(box(THREE, mat, 0.3, 3.0, 0.3, -w / 2, 1.5, 0));
      g.add(box(THREE, mat, 0.3, 3.0, 0.3, w / 2, 1.5, 0));
      g.add(box(THREE, mat, w, 0.3, 0.3, 0, 3.0, 0));
      // Four seal lamps across the lintel — the suit's progress, in the world.
      const lamps = [];
      for (let i = 0; i < 4; i++) {
        const l = box(THREE, new THREE.MeshBasicMaterial({ color: 0x3a4250 }), 0.34, 0.2, 0.16,
          -w / 2 + 0.9 + i * ((w - 1.8) / 3), 2.62, 0.2);
        lamps.push(l); g.add(l);
      }
      g.userData.lamps = lamps;
    } else {
      g.add(box(THREE, M.trim, w, 0.9, d, 0, 0.45, 0));            // cabinet
      g.add(box(THREE, mat, w * 0.98, 0.12, d * 0.98, 0, 0.96, 0)); // worktop
      // A machine on top, sized off the bench so every station looks different
      // without a single bespoke model.
      g.add(box(THREE, mat, Math.min(1.4, w * 0.4), 0.9, Math.min(1.2, d * 0.6), 0, 1.47, 0));
    }
    g.position.set(s.pos[0], 0, s.pos[1]);
    // A ring on the floor marking the interaction radius. Players should never
    // have to guess how close "close enough" is.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(w, d) / 2 + 1.2, Math.max(w, d) / 2 + 1.45, 28),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.pos[0], 0.03, s.pos[1]);
    scene.add(ring);
    scene.add(g);
    stationMeshes[s.key] = { group: g, ring, mat };
  }

  const avatar = makeAvatar(THREE, M);
  scene.add(avatar);

  /* 🔴 THE BOX AVATAR IS THE FALLBACK, NOT A PLACEHOLDER TO BE DELETED. It is
     what the room shows while the GLBs are in flight, and what it keeps
     showing if they never arrive — a blocked CDN, a 404, an Artifact page that
     cannot fetch its own assets. It also still carries the suit read-out in
     its materials, so the hazmat rule stays legible in every one of those
     cases. Removing it turns a slow network into an invisible player. */
  const chars = { bare: null, suit: null, active: null, loaded: false };
  const charRig = new THREE.Group();
  avatar.add(charRig);

  /* 📦 THE CRATE IN THE PLAYER'S HANDS. The carry clip holds a box that does
     not exist — the animation was authored around one — so without this the
     character walks the room cradling thin air.
     ⚠ Parented to `avatar`, not to a hand bone. The hands are two bones that
       move independently through the cycle, so following either one makes the
       box swim; the clip already keeps them in a fixed cradle in FRONT of the
       chest, and a box pinned there reads as held. Values are eyeballed
       against the clip and the 1.75 m character, not derived. */
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.36, 0.34),
    new THREE.MeshLambertMaterial({ color: 0xc8b06a }),
  );
  /* The fallback seat, used only when the hand bones cannot be found (the box
     avatar, or a future model with different joint names). Eyeballed. */
  crate.position.set(0, 1.02, 0.34);
  crate.visible = false;
  avatar.add(crate);

  /* 🔴 THE BOX SITS WHERE THE HANDS ARE, MEASURED EVERY FRAME — not at a
     constant somebody eyeballed once. The first attempt hardcoded a position
     and put the crate at the character's hips while the clip held its arms at
     chest height; the hands turned out to be a metre further forward in avatar
     space than the guess. Reading the two hand bones and seating the box at
     their midpoint is self-correcting: it costs two matrix reads a frame and it
     cannot drift when the model or the clip is re-exported.
     ⚠ The MIDPOINT of both hands, never one of them — a single hand swims
       through the cycle, while the point between them is the cradle itself. */
  /* ══ THE CARRY CYCLE'S OWN STRIDE ═══════════════════════════════════════
     🔴 THE CLIP IS A *WALK* CYCLE, so playing it at a fixed rate makes the
        feet skate: they take one step per clip second no matter how fast the
        player is actually moving, and at a standstill they keep stepping on
        the spot. Reported as "they are sliding".

     Two numbers fix it, and both are MEASURED FROM THE CLIP rather than
     tuned by hand, so a re-export cannot silently break them:
       `speed`  — how far the feet travel per second of clip, which makes
                  timeScale = playerSpeed / speed the rate that plants them.
       `stance` — the time in the cycle where the feet are CLOSEST together.
                  That is the standing pose, and it is where the clip is held
                  when the player stops. Freezing wherever the clip happened
                  to be would leave the character mid-stride, one leg out.

     ⚠ MEASURED IN THE AVATAR'S FRAME, which is metres. This rig's bone space
       is ~100× its mesh space (see the crate note above), so measuring in
       model-local units reports a 1.5 m/s walk as 150 m/s and every clip comes
       out unplayably slow. Same trap the refinery hit. */
  function measureCarry(char) {
    const out = { speed: 0, stance: 0 };
    try {
      const clip = char.carry && char.carry.getClip();
      if (!clip || !clip.duration) return out;
      let sm = null;
      char.root.traverse((o) => { if (o.isSkinnedMesh && !sm) sm = o; });
      if (!sm || !sm.skeleton) return out;
      const bones = sm.skeleton.bones || [];
      const feet = bones.filter((b) => /foot|toe|ankle/i.test(b.name || ''));
      if (feet.length < 2) return out;
      const L = feet.find((b) => /left/i.test(b.name)) || feet[0];
      const R = feet.find((b) => /right/i.test(b.name)) || feet[1];

      const probe = new THREE.AnimationMixer(char.root);
      const act = probe.clipAction(clip);
      act.play();
      const steps = 24, dt = clip.duration / steps;
      const v = new THREE.Vector3(), inv = new THREE.Matrix4();
      let minZ = Infinity, maxZ = -Infinity, bestGap = Infinity, bestT = 0;
      for (let i = 0; i < steps; i++) {
        probe.update(dt);
        avatar.updateMatrixWorld(true);
        inv.copy(avatar.matrixWorld).invert();
        const lz = v.setFromMatrixPosition(L.matrixWorld).applyMatrix4(inv).z;
        const rz = v.setFromMatrixPosition(R.matrixWorld).applyMatrix4(inv).z;
        for (const z of [lz, rz]) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
        const gap = Math.abs(lz - rz);
        if (gap < bestGap) { bestGap = gap; bestT = act.time; }
      }
      act.stop(); probe.stopAllAction();
      try { probe.uncacheRoot(char.root); } catch (e) {}
      // One stride is peak-to-peak; a full cycle is two of them.
      const travel = (maxZ - minZ) * 2;
      if (travel > 0.01) out.speed = travel / clip.duration;
      out.stance = bestT;
    } catch (e) {}
    return out;
  }

  const _crateV = new THREE.Vector3();
  const _crateInv = new THREE.Matrix4();
  function seatCrate(char) {
    let sm = null;
    try { char.root.traverse((o) => { if (o.isSkinnedMesh && !sm) sm = o; }); } catch (e) {}
    if (!sm || !sm.skeleton) return;
    const bones = sm.skeleton.bones;
    let L = null, R = null;
    for (const b of bones) {
      if (!L && b.name === 'LeftHand') L = b;
      else if (!R && b.name === 'RightHand') R = b;
    }
    if (!L || !R) return;
    avatar.updateMatrixWorld(true);
    _crateInv.copy(avatar.matrixWorld).invert();
    const a = _crateV.setFromMatrixPosition(L.matrixWorld).applyMatrix4(_crateInv).clone();
    const b = _crateV.setFromMatrixPosition(R.matrixWorld).applyMatrix4(_crateInv);
    crate.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }

  function showCharacter(which) {
    const want = chars[which];
    if (!want || chars.active === want) return;
    for (const k of ['bare', 'suit']) {
      const c = chars[k];
      if (c && c.holder.parent) charRig.remove(c.holder);
    }
    charRig.add(want.holder);
    chars.active = want;
    // The boxes hand over the moment a real character is on screen.
    for (const k of Object.keys(avatar.userData)) {
      const o = avatar.userData[k];
      if (o && o.isMesh) o.visible = false;
    }
  }

  /* ── camera. Fixed isometric-ish follow, no orbit control on purpose: the
     room has one readable angle and letting a player rotate into a wall is a
     bug report waiting to happen. It LERPS toward the player rather than
     tracking exactly, which hides the collision resolver's tiny corrections. */
  const cam = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 200);
  // Read live from CAM_HEIGHT / CAM_BACK so _setCamera tunes it without a
  // reload — see the note on those constants.
  cam.position.set(0, CAM_HEIGHT, CAM_BACK);

  const api = {
    THREE, renderer, scene, camera: cam, avatar, stations: stationMeshes, mats: M,
    chars,
    /* Kicked off by index.js AFTER the room is already on screen and walkable.
       Loading these before the first frame would trade a playable lab for a
       loading screen, to gain a character the player cannot see yet anyway. */
    async loadCharacters() {
      if (chars.loaded) return chars;
      chars.loaded = true;
      /* 🔴 REPORT THE REASON, DO NOT JUST FALL BACK. Every failure below used
         to end as a console.warn and a box avatar, which is why "the model has
         not loaded" was reported twice with no way to tell whether the loader,
         the fetch or the model was at fault. `chars.why` carries it out to the
         caller, which puts it on screen. */
      if (!(await ensureGltfLoader())) {
        chars.why = 'GLTFLoader could not be loaded (vendored copy and CDN both failed).';
        try { console.warn('[biolab] ' + chars.why); } catch (e) {}
        return chars;
      }
      // Both at once: 1.3 MB together, and the suit one is needed the moment
      // the fourth seal closes, which can be eleven seconds in.
      const [bare, suit] = await Promise.all([
        loadCharacter(THREE, MODELS.bare),
        loadCharacter(THREE, MODELS.suit),
      ]);
      chars.bare = bare; chars.suit = suit;
      if (!bare && !suit) {
        chars.why = 'The character models did not load (' + MODELS.bare.url + ').';
        try { console.warn('[biolab] ' + chars.why); } catch (e) {}
      }
      // A single model loading is enough to use it for both states; better a
      // researcher in the hot zone than a box.
      if (!chars.bare) chars.bare = chars.suit;
      if (!chars.suit) chars.suit = chars.bare;
      return chars;
    },
    resize() {
      try {
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        cam.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        cam.updateProjectionMatrix();
      } catch (e) {}
    },
    /* Drive one frame. `st` is the whole run state — the scene reads it and
       never writes to it, so the simulation stays the single source of truth
       and this file can be deleted without taking the game with it. */
    frame(dt, st) {
      const p = st.player;
      avatar.position.set(p.x, 0, p.z);
      avatar.rotation.y = p.facing;

      const sealed = !!(st.suit && st.suit.sealed);

      /* 🔴 GATE ON WHAT LOADED, NOT ON WHAT IS SHOWING. This read
         `if (chars.active)` and was unreachable by construction: `active` is
         set ONLY by showCharacter(), which is called ONLY inside this branch,
         so it started null and stayed null forever. Both models could load
         perfectly and the player still saw the fallback boxes — which is
         exactly what shipped, and it looks identical to a failed download, so
         the symptom pointed at the assets instead of at four characters of
         condition. */
      /* 📦 The box is shown whenever a crate is in hand — set ABOVE the branch
         because the fallback box-avatar carries crates too, and a player on a
         slow network must not lose the object they are holding. */
      crate.visible = !!st.carrying;
      if (chars.bare || chars.suit) {
        /* ── the imported characters ──────────────────────────────────────
           Model choice IS the suit read-out: the researcher walks in, and the
           moment the fourth seal closes they are the Hazard Sentinel. No
           material swap, no icon — the thing on screen is a different person
           in a different suit, which reads at this camera distance in a way a
           colour change never did.

           Walk and run crossfade on actual speed rather than on a flag, so a
           suited player (SUIT_SPEED of normal) settles into the walk cycle and
           an unsuited one runs. Feet therefore match ground speed instead of
           sliding, which is the whole reason to blend rather than switch. */
        showCharacter(sealed ? 'suit' : 'bare');
        const c = chars.active;
        // showCharacter refuses a state it has no model for. Both are
        // backfilled by loadCharacters, so this should be unreachable — but a
        // throw here happens every frame, and the box is a fine answer.
        if (!c) { avatar.position.y = 0; renderer.render(scene, cam); return; }
        const speed = Math.hypot(p.vx, p.vz);
        const full = 5.2;                          // player.js SPEED
        const frac = Math.max(0, Math.min(1, speed / full));
        // 0 at a standstill, 1 at a full unsuited sprint.
        const runW = Math.max(0, Math.min(1, (frac - SUIT_SPEED * 0.9) / (1 - SUIT_SPEED * 0.9)));
        const moveW = Math.min(1, frac / 0.35);    // fade both out when idling
        /* 📦 CARRYING IS ITS OWN POSE, NOT A LAYER ON TOP. The carry clip has
           both arms out in front holding a crate; blending any part of the walk
           or run cycle into it puts one arm through the box. So it takes the
           whole weight while a crate is in hand, and the other three take none.
           A model with no carry clip falls through to the ordinary blend. */
        const carrying = !!st.carrying && !!c.carry;
        if (carrying) {
          /* Measured once per character, the first time it actually carries
             something — the bones have to be mounted and posed for the frame
             to be metres, which is not true at load. */
          if (!c.carryFit) c.carryFit = measureCarry(c);
          const fit = c.carryFit;
          if (fit.speed > 0.01) {
            if (speed > 0.12) {
              /* Feet planted: one clip second covers exactly the ground the
                 player covers in a second. */
              c.carry.paused = false;
              c.carry.timeScale = Math.max(CARRY_RATE_MIN, Math.min(CARRY_RATE_MAX, speed / fit.speed));
            } else {
              /* 🧍 STOPPED — HOLD THE STANCE POSE. Ease to the frame where the
                 feet are together and stop the clock there, so a standing
                 character stands instead of marching on the spot. */
              c.carry.timeScale = 0;
              const d = c.carry.getClip().duration;
              let delta = fit.stance - c.carry.time;
              if (delta > d / 2) delta -= d; else if (delta < -d / 2) delta += d;
              const stepTo = Math.max(0, Math.min(1, (dt / 1000) * 6));
              c.carry.time = ((c.carry.time + delta * stepTo) % d + d) % d;
            }
          }
          c.carry.setEffectiveWeight(1);
          if (c.walk) c.walk.setEffectiveWeight(0);
          if (c.run) c.run.setEffectiveWeight(0);
          if (c.idle) c.idle.setEffectiveWeight(0);
        } else {
          if (c.carry) c.carry.setEffectiveWeight(0);
          if (c.walk) c.walk.setEffectiveWeight(moveW * (1 - runW));
          if (c.run) c.run.setEffectiveWeight(moveW * runW);
          /* The idle takes exactly the weight the other two give up, so the
             three always sum to 1 and there is no window where the character
             falls back to its bind pose mid-blend. */
          if (c.idle) c.idle.setEffectiveWeight(1 - moveW);
        }
        /* ⚠ The mixer is advanced even while standing still. Both weights are
           0 then, but the clips must stay in phase or the first step after a
           pause snaps to a random pose. */
        c.mixer.update(Math.max(0, dt) / 1000);
        /* AFTER the mixer, never before: the bone world matrices only describe
           this frame once the clip has been advanced. */
        if (st.carrying) seatCrate(c);
        c.holder.rotation.y = MODEL_YAW;
        avatar.position.y = 0;
      } else {
        // Box fallback: hand-animated swing, and the suit shown in materials.
        const sw = p.moving ? Math.sin(p.bob) * 0.5 : 0;
        const u = avatar.userData;
        u.armL.rotation.x = sw; u.armR.rotation.x = -sw;
        u.legL.rotation.x = -sw * 0.8; u.legR.rotation.x = sw * 0.8;
        avatar.position.y = p.moving ? Math.abs(Math.sin(p.bob)) * 0.06 : 0;

        const partial = st.suit ? Object.keys(st.suit.seals || {}).length : 0;
        const suitMat = sealed ? M.suitOn : M.suitOff;
        u.body.material = partial >= 2 ? suitMat : M.suitOff;
        u.legL.material = u.legR.material = partial >= 1 ? suitMat : M.suitOff;
        u.armL.material = u.armR.material = partial >= 3 ? suitMat : M.suitOff;
        u.head.material = sealed ? suitMat : M.suitOff;
        u.visor.visible = sealed;
      }

      // Airlock seal lamps.
      try {
        const lamps = (stationMeshes.suitup && stationMeshes.suitup.group.userData.lamps) || [];
        const order = ['legs', 'torso', 'gloves', 'hood'];
        for (let i = 0; i < lamps.length; i++) {
          const on = !!(st.suit && st.suit.seals && st.suit.seals[order[i]]);
          lamps[i].material.color.setHex(on ? 0x86e08a : 0x3a4250);
        }
      } catch (e) {}

      // Highlight the station in reach.
      for (const k of Object.keys(stationMeshes)) {
        const sm = stationMeshes[k];
        const near = st.near && st.near.station && st.near.station.key === k;
        sm.ring.material.opacity = near ? 0.75 : 0.24;
        sm.ring.scale.setScalar(near ? 1.04 : 1);
      }

      // Hot-zone warning: the fill light pulses red while the player is in the
      // hot zone unsuited. It is peripheral, constant, and impossible to
      // misread as anything but "get out or suit up".
      const danger = st.suit && st.suit.inHot && !sealed;
      hotFill.color.setHex(danger ? 0xff4d5e : 0x7fe0a0);
      hotFill.intensity = danger ? 1.1 + Math.sin(Date.now() / 140) * 0.5 : 0.8;
      stripe.material.color.setHex(danger ? 0xff4d5e : COL.hazard);

      // Camera follow.
      const want = { x: p.x * 0.35, y: CAM_HEIGHT, z: p.z + CAM_BACK };
      const k2 = 1 - Math.pow(0.0025, Math.max(0, dt) / 1000);
      cam.position.x += (want.x - cam.position.x) * k2;
      cam.position.y += (want.y - cam.position.y) * k2;
      cam.position.z += (want.z - cam.position.z) * k2;
      cam.lookAt(p.x * 0.5, 1.1, p.z + 2.5);

      renderer.render(scene, cam);
    },
    dispose() {
      try {
        scene.traverse((o) => {
          if (o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
          if (o.material) {
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of list) { try { m.dispose(); } catch (e) {} }
          }
        });
        renderer.dispose();
        /* 🔴 forceContextLoss IS NOT OPTIONAL. Browsers cap live WebGL contexts
           (16 or so); opening and closing this lab twenty times without it
           kills the game's OTHER canvases — the battle board and the pack
           opener — and the report reads as "the board went black", nowhere
           near this file. */
        try { renderer.forceContextLoss(); } catch (e) {}
      } catch (e) {}
    },
  };
  return api;
}
