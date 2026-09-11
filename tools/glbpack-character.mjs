/* ══════════════════════════════════════════════════════════════════════════
   🧍 GLB CHARACTER PACKER — several one-clip exports → one multi-clip model.

   Meshy (and every other generator like it) exports ONE FILE PER ANIMATION,
   each carrying a full copy of the mesh, the skin and the texture. Three
   animations of the Guardian of the Rig came to 25 MB, and 95% of every byte
   was the same 2048² PNG three times over.

   This takes the first file as the base — mesh, skeleton, material, texture —
   copies ONLY the animation out of each of the others, renames every clip to
   the name the game looks for (idle / walk / run / carry), and recompresses
   the texture once. One fetch instead of three, and a fraction of the bytes.

   🔴 THE SKELETONS MUST MATCH, and it verifies rather than assumes. Every
      exported file from one generator run shares a node order, but an
      animation copied onto a DIFFERENT skeleton animates the wrong joints and
      the failure looks like a bug in the game, not in the asset. If the node
      names differ, this refuses.

   Usage:
     node tools/glbpack-character.mjs out.glb clip=file.glb [clip=file.glb …]

   Example:
     node tools/glbpack-character.mjs public/models/refinery/guardian.glb \
       walk=Walking.glb run=Running.glb carry=Carry.glb
   ══════════════════════════════════════════════════════════════════════════ */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, mergeDocuments, clearNodeTransform } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('usage: node tools/glbpack-character.mjs <out.glb> <clip>=<file.glb> [...]');
  process.exit(1);
}
const OUT = args[0];
const PAIRS = args.slice(1).map((a) => {
  const i = a.indexOf('=');
  if (i < 0) throw new Error('expected clip=file, got: ' + a);
  return { clip: a.slice(0, i), file: a.slice(i + 1) };
});

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/* Joint names in skin order. Two files are compatible when these match
   exactly — same joints, same order, so a channel that targets joint 7 in one
   file targets the same bone in the other. */
function skeletonKey(doc) {
  const skins = doc.getRoot().listSkins();
  if (!skins.length) return null;
  return skins[0].listJoints().map((j) => j.getName()).join('|');
}

const base = await io.read(PAIRS[0].file);
const baseKey = skeletonKey(base);
console.log('base   : ' + path.basename(PAIRS[0].file));
console.log('joints : ' + (baseKey ? baseKey.split('|').length : 0));

/* 🔁 `base=file.glb` — KEEP THE CLIPS THE BASE ALREADY HAS and add to them.
   Without this the only way to add a fourth animation to an already-packed
   character is to re-pack from the original one-clip exports, and those are
   generator downloads that do not live in the repo. Naming the first pair
   `base` means "this file is the mesh AND its clips are already correct";
   any other name means the old behaviour, where the base is just geometry and
   every clip is (re)named by the caller.
   ⚠ The retarget block below walks EVERY animation in the document, so kept
     clips are checked against the surviving skeleton exactly like copied ones.
     They come out as "already correct" rather than being trusted. */
const KEEP_BASE = PAIRS[0].clip === 'base';
/* Opt-in height bake — see the block that uses it. It is broken; do not turn
   this on without re-measuring the ANIMATED bounds with boneTransform(). */
const BAKE = args.some((a) => String(a).toLowerCase() === 'bake');
if (!KEEP_BASE) {
  /* Drop whatever clips the base arrived with — they are re-added below under
     the names the caller asked for, so a file listed twice cannot leave a stray
     original-name clip behind. */
  base.getRoot().listAnimations().forEach((a) => a.dispose());
} else {
  console.log('keep   : ' + base.getRoot().listAnimations().map((a) => a.getName()).join(', '));
}

/* The joints the MESH is actually skinned to, by name, captured before any
   merge brings in look-alike copies. Every copied clip is re-pointed at these
   — see the retarget block in the loop below. */
const BASE_JOINTS = (() => {
  const m = new Map();
  const root = base.getRoot();
  const mesh = root.listMeshes()[0];
  let node = null;
  root.listNodes().forEach((n) => { if (n.getMesh() === mesh) node = n; });
  const skin = node && node.getSkin();
  if (!skin) { console.warn('⚠ the base mesh has no skin — clips cannot be retargeted'); return m; }
  skin.listJoints().forEach((j) => m.set(j.getName(), j));
  console.log('skin   : ' + m.size + ' joints on "' + (node.getName() || 'mesh') + '"');
  return m;
})();

/* 🖼 Textures are NOT touched here. Importing @gltf-transform/functions
   (above) breaks sharp's encoder in this environment — see the header of
   tools/glbtexture.mjs for the measurement. The pack step therefore spawns
   that script as a SEPARATE PROCESS at the end. */

for (const { clip, file } of PAIRS) {
  if (clip === 'base') continue;          // geometry + its own clips, already in `base`
  const src = await io.read(file);
  const key = skeletonKey(src);
  if (baseKey && key && key !== baseKey) {
    console.error('\n❌ ' + path.basename(file) + ' has a DIFFERENT skeleton than the base.');
    console.error('   Copying its animation would animate the wrong joints. Refusing.');
    process.exit(2);
  }
  const anims = src.getRoot().listAnimations();
  if (!anims.length) { console.error('❌ ' + file + ' has no animation'); process.exit(2); }
  // Take the longest clip when a file somehow carries several — the extras
  // from these exporters are static one-frame poses.
  let pick = anims[0], best = -1;
  for (const a of anims) {
    let d = 0;
    for (const s of a.listSamplers()) {
      const inp = s.getInput();
      if (!inp) continue;
      const arr = inp.getArray();
      if (arr && arr.length) d = Math.max(d, arr[arr.length - 1]);
    }
    if (d > best) { best = d; pick = a; }
  }
  pick.setName(clip);
  // Move the animation (with its samplers' accessors) into the base document.
  mergeDocuments(base, src);

  console.log('clip   : ' + clip.padEnd(6) + ' ← ' + path.basename(file) + '  (' + best.toFixed(2) + 's, ' + pick.listChannels().length + ' channels)');
}

/* Scene pruning happens AFTER the transform chain — see the block below. It
   used to run here, keeping listScenes()[0], and that shipped a broken model:
   the surviving scene was a different Armature, so the mesh node and all 24
   joints ended up outside it. */

await base.transform(
  resample(),                    // drop redundant keyframes  ⚠ see the note above
  dedup(),                       // one mesh, one material, one texture
  prune({ keepLeaves: false }),  // …and delete what the merge left orphaned
);

/* 🔴 RETARGET EVERY CLIP ONTO THE SKELETON THE MESH IS ACTUALLY BOUND TO.
   ═══════════════════════════════════════════════════════════════════════════
   THE FAILURE THIS PREVENTS IS SILENT. mergeDocuments() deep-copies the
   source, so each clip arrives pointing at COPIES of the joints. The file
   validates, every clip still lists its 72 channels, and the character stands
   perfectly still in game — the bones being animated are not the bones the
   mesh is skinned to. Nothing anywhere reports a problem.

   ⚠ IT MUST RUN HERE, AFTER dedup(). Doing it inside the merge loop was tried
     and looked like it worked — the console said "retargeted 72 channels"
     three times — but dedup() then collapses the four identical skins into
     one and re-points the mesh at a DIFFERENT joint set, undoing all of it.
     Measured after that version: 0 of 216 channels on-skeleton.

   Joint names are identical across one generator's exports (skeletonKey()
   asserted that above), so matching by name is exact. Anything that does not
   resolve is counted and printed rather than dropped quietly. */
{
  const r2 = base.getRoot();
  const mesh2 = r2.listMeshes()[0];
  let node2 = null;
  r2.listNodes().forEach((n) => { if (n.getMesh() === mesh2) node2 = n; });
  const skin2 = node2 && node2.getSkin();
  if (!skin2) {
    console.warn('⚠ no skin on the surviving mesh — clips left as-is');
  } else {
    const live = new Map();
    skin2.listJoints().forEach((j) => live.set(j.getName(), j));
    let moved = 0, lost = 0, ok = 0;
    for (const a of r2.listAnimations()) {
      for (const ch of a.listChannels()) {
        const t = ch.getTargetNode();
        if (!t) continue;
        if (live.get(t.getName()) === t) { ok++; continue; }
        const want = live.get(t.getName());
        if (!want) { lost++; continue; }
        ch.setTargetNode(want); moved++;
      }
    }
    console.log('retarget: ' + moved + ' channel(s) moved, ' + ok + ' already correct' + (lost ? ', ⚠ ' + lost + ' unmatched' : ''));
    // prune() ran before this, so the now-unreferenced duplicate skins and
    // their joint trees are still in the document. Drop them explicitly.
    r2.listSkins().forEach((s) => { if (s !== skin2) s.dispose(); });
  }
}

/* 🔴 KEEP THE SCENE THAT ACTUALLY CONTAINS THE MESH — not scene 0.
   ═══════════════════════════════════════════════════════════════════════════
   THE BUG THIS FIXES SHIPPED ONCE AND WAS EXPENSIVE TO FIND. Each merge
   appends the source's scenes, so the document ends up with several roots
   named "Armature". Keeping listScenes()[0] kept the WRONG one: the mesh node
   and all 24 joints were left outside it, GLTFLoader therefore built a
   SkinnedMesh with `skeleton === undefined`, and three.js threw
   "Cannot read properties of undefined (reading 'frame')" from inside
   renderer.render() — a black yard with a stack that names three.js and not
   the asset. The file validated cleanly the whole time.

   So: find the node carrying the mesh, walk up to its scene, keep that. Then
   assert the joints are inside it before writing, because this is exactly the
   class of breakage that is invisible until the model is in the game. */
{
  const r3 = base.getRoot();
  const mesh3 = r3.listMeshes()[0];
  let node3 = null;
  r3.listNodes().forEach((n) => { if (n.getMesh() === mesh3) node3 = n; });
  const scenes = r3.listScenes();
  let keep = null;
  for (const s of scenes) {
    let found = false;
    const walk = (n) => { if (found) return; if (n === node3) { found = true; return; } n.listChildren().forEach(walk); };
    s.listChildren().forEach(walk);
    if (found) { keep = s; break; }
  }
  if (!keep) { console.error('❌ no scene contains the mesh node — refusing to write a broken model'); process.exit(3); }
  r3.setDefaultScene(keep);
  scenes.forEach((s) => { if (s !== keep) s.dispose(); });

  // Assert: every joint the skin uses must be reachable from the kept scene.
  const inScene = new Set();
  const mark = (n) => { inScene.add(n); n.listChildren().forEach(mark); };
  keep.listChildren().forEach(mark);
  const skin3 = node3 && node3.getSkin();
  const joints = skin3 ? skin3.listJoints() : [];
  const missing = joints.filter((j) => !inScene.has(j)).length;
  console.log('scene  : kept "' + (keep.getName() || 'scene') + '" of ' + scenes.length + ' · mesh in scene: yes · joints in scene: ' + (joints.length - missing) + '/' + joints.length);
  if (!skin3) { console.error('❌ the mesh lost its skin — refusing to write'); process.exit(3); }
  if (missing) { console.error('❌ ' + missing + ' joint(s) are outside the kept scene — the model would render unskinned. Refusing.'); process.exit(3); }
}

/* 🧹 PRUNE AGAIN, NOW THAT THE EXTRA SKINS AND SCENES ARE GONE.
   The first prune() ran while three duplicate skins and three duplicate scenes
   still referenced the merged copies of the mesh, so it kept all of them —
   104 nodes and four "char1" mesh nodes in a file that needs 26 and one.
   That is not merely wasted bytes: a loader that measures the model to
   normalise its height sees the orphans' bounds too, computes the wrong
   scale, and the operator arrives twenty times life size. */
/* prune() will not take these: a Node carrying a Mesh is not a leaf, and the
   duplicates sit at the top of their own detached hierarchies rather than
   being unreferenced properties. So they are disposed by hand — anything not
   reachable from the kept scene is, by definition, not part of the model. */
{
  const r4 = base.getRoot();
  const keep = r4.getDefaultScene() || r4.listScenes()[0];
  const live = new Set();
  const mark = (n) => { live.add(n); n.listChildren().forEach(mark); };
  keep.listChildren().forEach(mark);
  let dropped = 0;
  for (const n of r4.listNodes()) { if (!live.has(n)) { n.dispose(); dropped++; } }
  if (dropped) console.log('cleanup: dropped ' + dropped + ' orphan node(s)');
}
await base.transform(prune({ keepLeaves: false }));
{
  const r4 = base.getRoot();
  const meshNodes = r4.listNodes().filter((n) => n.getMesh());
  console.log('cleanup: ' + r4.listNodes().length + ' nodes, ' + meshNodes.length + ' mesh node(s), ' + r4.listSkins().length + ' skin(s), ' + r4.listScenes().length + ' scene(s)');
  if (meshNodes.length !== 1) {
    console.error('❌ expected exactly one mesh node after cleanup, found ' + meshNodes.length + ' — refusing to write a model that would mis-scale.');
    process.exit(3);
  }
}

/* 📏 BAKE THE ARMATURE'S SCALE INTO THE MODEL — so the file is natively
   metre-sized and the game does not have to correct it.
   ═══════════════════════════════════════════════════════════════════════════
   Meshy (and Blender's glTF exporter generally) writes the rig at centimetre
   scale under an armature node scaled to 0.01. The file is self-consistent and
   renders correctly on its own. But a loader that MEASURES the model and
   normalises its height then multiplies that hierarchy by ~109×, and a skinned
   mesh does not follow an ancestor's scale for free: the bones' world matrices
   change while the mesh's stored bindMatrixInverse does not, so the GPU
   deforms the mesh by the ratio and the character draws as a smear.

   That was the whole bug, and it is unfixable from the game side without
   re-binding every frame. clearNodeTransform() pushes the armature's transform
   down into its children — joint translations, the mesh, the inverse-bind
   matrices and the animation tracks all move together — leaving a model that
   is already ~1.7 m at scale 1. The normalisation factor then lands near 1 and
   there is nothing left to break.

   ⚠ Verified below rather than assumed: the model's measured height must come
     out in metres, or the pack refuses. */
/* 🔴 NOT IN `base=` MODE, AND THIS ONE SHIPPED BROKEN ONCE. The base is a model
   already in the game, whose units the runtime loader is known to handle. This
   bake removes the armature's 0.01 scale and compensates joints, geometry, IBM
   TRANSLATIONS and animation tracks by one factor — but an inverse-bind matrix
   in this rig also carries a SCALE component bridging a metre-scale mesh to a
   centimetre-scale skeleton, and that part is not compensated. The result
   measures perfectly in bind pose and explodes the moment a clip plays.
   Measured on the packed lab scientist: Box3.setFromObject said 1.77 m — which
   is why every check passed — while the true animated height was 169 m in a
   4.4 m room. `Box3.setFromObject` reports BIND-POSE bounds for a SkinnedMesh,
   so it cannot see this class of breakage at all; CPU-skin the vertices with
   boneTransform() if you need to check.
   Re-normalising a model that already works is how a working model stops
   working, so in base mode the units are left exactly as they are. */
/* 🔴 OFF BY DEFAULT NOW, ON TWO INDEPENDENT PROOFS. This bake produces a model
   that measures perfectly in BIND POSE and is ~100× too large the moment a clip
   plays. Measured twice, on completely unrelated assets:
       Cracking Yard tanker   Box3 said 1.77 m · animated 169 m
       hospital patient       Box3 said 1.75 m · animated 175 m
   It rescales joint translations, geometry, inverse-bind TRANSLATIONS and the
   animation tracks by one factor — but an inverse-bind matrix also carries a
   SCALE component bridging a metre-scale mesh to a centimetre-scale skeleton,
   and that part is never compensated. Box3.setFromObject reports bind-pose
   bounds for a SkinnedMesh, so nothing catches it without CPU-skinning the
   vertices with boneTransform().
   Every model in this game verified correct was packed with this SKIPPED, and
   the run-time loaders normalise height anyway (MODEL_HEIGHT in
   biolab/scene.js, the slot heights in refinery/models.js) — so the bake was
   only ever an optimisation, and one that cost two shipped bugs.
   Pass `bake` as an argument if you are fixing it and want to test. */
if (KEEP_BASE || !BAKE) {
  console.log('bake   : skipped — the run-time loaders normalise height (see the note in this file)');
} else {
  const r5 = base.getRoot();
  const scene5 = r5.getDefaultScene() || r5.listScenes()[0];
  for (const rootNode of scene5.listChildren()) {
    const s = rootNode.getScale();
    const k = s[0];
    if (!(k > 0) || Math.abs(k - 1) < 1e-6) continue;
    if (Math.abs(s[1] - k) > 1e-6 || Math.abs(s[2] - k) > 1e-6) {
      console.warn('⚠ "' + rootNode.getName() + '" scale is non-uniform — left alone');
      continue;
    }

    /* ⚠ clearNodeTransform() ALONE IS NOT ENOUGH, and half-doing this is worse
       than not doing it at all. It bakes the transform into the mesh geometry
       but leaves the JOINT translations, the inverse-bind matrices and the
       animation translation tracks in the old units — a mesh in metres bound
       to a skeleton in centimetres, which explodes far more violently than the
       original mismatch. Measured: mesh height 1.700 m, Hips still at 92.923.
       So every place a length is stored is scaled here, by hand, by the same
       factor. */
    /* 🔴 SCALE TO A TARGET HEIGHT, not merely by the armature's own factor.
       Folding 0.01 in and stopping leaves a self-consistent but 1.7 CENTIMETRE
       character — which is what this source actually is: geometry ~1.7 units
       under an armature scaled to 0.01. The game then normalises it up by
       ~109×, and that large scale on a skinned hierarchy is the thing that
       breaks the deformation in the first place. Choosing the factor to make
       the model natively TARGET_H metres leaves the game almost nothing to do. */
    const TARGET_H = 1.85;
    let meshH = 0;
    (function findH(n) {
      const m = n.getMesh();
      if (m) for (const p of m.listPrimitives()) {
        const a = p.getAttribute('POSITION');
        if (a) meshH = Math.max(meshH, a.getMax([])[1] - a.getMin([])[1]);
      }
      n.listChildren().forEach(findH);
    })(rootNode);
    if (!(meshH > 0)) { console.warn('⚠ no geometry under "' + rootNode.getName() + '" — left alone'); continue; }
    const S = TARGET_H / meshH;

    rootNode.setScale([1, 1, 1]);
    rootNode.setTranslation(rootNode.getTranslation().map((v) => v * S));

    // 1. joint local translations
    const joints = new Set();
    r5.listSkins().forEach((sk) => sk.listJoints().forEach((j) => joints.add(j)));
    for (const j of joints) j.setTranslation(j.getTranslation().map((v) => v * S));

    /* 2. mesh vertex positions — ONLY for meshes actually under this root.
       🔴 In this rig the mesh node is a SIBLING of the armature, not a child:
          the geometry is already in metres (1.70 m) and only the SKELETON is
          authored in centimetres under the 0.01 armature, with the skin's
          inverse-bind matrices bridging the two. Scaling the mesh as well
          shrank it to 0.017 m — a correct skeleton driving a mesh a hundred
          times too small. Descend from rootNode and scale nothing else. */
    const under = new Set();
    (function descend(n) { under.add(n); n.listChildren().forEach(descend); })(rootNode);
    const meshesUnder = new Set();
    for (const n of under) { const m = n.getMesh(); if (m) meshesUnder.add(m); }
    for (const mesh of meshesUnder) {
      for (const prim of mesh.listPrimitives()) {
        const p = prim.getAttribute('POSITION');
        if (p) { const a = p.getArray(); for (let i = 0; i < a.length; i++) a[i] *= S; p.setArray(a); }
        for (const t of prim.listTargets()) {
          const tp = t.getAttribute('POSITION');
          if (tp) { const a = tp.getArray(); for (let i = 0; i < a.length; i++) a[i] *= S; tp.setArray(a); }
        }
      }
    }

    // 3. inverse-bind matrices — column-major, translation is elements 12..14
    for (const sk of r5.listSkins()) {
      const ibm = sk.getInverseBindMatrices();
      if (!ibm) continue;
      const a = ibm.getArray();
      for (let i = 0; i < a.length; i += 16) { a[i + 12] *= S; a[i + 13] *= S; a[i + 14] *= S; }
      ibm.setArray(a);
    }

    // 4. animation translation tracks
    for (const anim of r5.listAnimations()) {
      for (const ch of anim.listChannels()) {
        if (ch.getTargetPath() !== 'translation') continue;
        const out = ch.getSampler().getOutput();
        if (!out) continue;
        const a = out.getArray();
        for (let i = 0; i < a.length; i++) a[i] *= S;
        out.setArray(a);
      }
    }

    console.log('bake   : "' + (rootNode.getName() || 'root') + '" scale ' + (+k.toFixed(4)) + ' → 1, everything under it × ' + S.toFixed(3) + ' (native height now ' + TARGET_H + ' m)');
  }
}

/* 🔴 ONE BUFFER. A GLB may carry at most one, and every merged document
   arrived with its own — so this must run after the merges or the write
   throws "GLB must have 0–1 buffers", which reads like a corrupt asset. */
{
  const buffers = base.getRoot().listBuffers();
  if (buffers.length > 1) {
    const keep = buffers[0];
    for (const acc of base.getRoot().listAccessors()) acc.setBuffer(keep);
    buffers.slice(1).forEach((b) => b.dispose());
    console.log('buffers: ' + buffers.length + ' → 1');
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, base);

/* 🖼 …and now the textures, in a process that has never imported
   @gltf-transform/functions. See tools/glbtexture.mjs for why this cannot be
   done inline. A failure here is reported and non-fatal: the model is already
   written and correct, it is just large. */
try {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'glbtexture.mjs'), OUT], { encoding: 'utf8' });
  const out = String(r.stdout || '').split('\n').filter((l) => /^texture|^file/.test(l));
  out.forEach((l) => console.log(l));
  if (r.status !== 0) console.warn('⚠ texture pass exited ' + r.status + ' — model kept uncompressed.');
} catch (e) {
  console.warn('⚠ texture pass could not run: ' + (e && e.message));
}

const inBytes = PAIRS.reduce((n, p) => n + fs.statSync(p.file).size, 0);
const outBytes = fs.statSync(OUT).size;
const d = await io.read(OUT);
console.log('\nclips  : ' + d.getRoot().listAnimations().map((a) => a.getName()).join(', '));
console.log('meshes : ' + d.getRoot().listMeshes().length + '   textures: ' + d.getRoot().listTextures().length);
console.log('in     : ' + (inBytes / 1048576).toFixed(2) + ' MB');
console.log('out    : ' + (outBytes / 1048576).toFixed(2) + ' MB  (' + (100 - (outBytes / inBytes) * 100).toFixed(1) + '% smaller)');
console.log('wrote  : ' + OUT);
