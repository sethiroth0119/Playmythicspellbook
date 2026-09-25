/* 🚶 CIVILIAN MODELS in the city builder (v121v55).

   Asked for: "Change the mock-up NPCs in the city builder for the models and
   have them using their walking animations, and still make them the size of
   the mock-up where they are small."

   Defends:
     · the four packed characters exist, are small (< 600 KB each), and each
       carries one skin and one animation clip (read with gltf-transform);
     · node-city imports SkeletonUtils, keeps a rig cache that preserves the
       clips (loadModel drops them), fits every instance to the MEASURED
       mock-up height (civMockHeight), clones through SkeletonUtils, and swaps
       the placeholder for the rig in agentMesh when no admin slot is set;
     · both animation sites advance the mixer only while the agent moves, and
       the procedural bob is off for a rig; despawn stops the mixer;
     · the standing crowd bakes the SAME rigs on the CPU through
       applyBoneTransform (posed, textured, static) and the host rebuilds the
       crowd once the rigs land; the mock-up remains the fallback.

   Run: node _civmodels_smoke.mjs */
import { readFileSync, statSync, existsSync } from 'fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const CW = readFileSync('./public/src/crowd/index.js', 'utf8');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const n of ['regal', 'survivor', 'pilgrim', 'wanderer']) {
  const f = './public/models/civilians/' + n + '.glb';
  ok(existsSync(f) && statSync(f).size < 600 * 1024, n + '.glb is packed under 600 KB', existsSync(f) ? statSync(f).size : 'missing');
  try {
    const doc = await io.read(f); const root = doc.getRoot();
    let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const idx = p.getIndices(); tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
    ok(root.listSkins().length === 1 && root.listAnimations().length === 1 && tris < 6000, n + ': one skin, one walking clip, under 6k triangles', 'skins ' + root.listSkins().length + ' anims ' + root.listAnimations().length + ' tris ' + tris);
    ok(root.listTextures().every(t => /webp/.test(t.getMimeType() || '')), n + ': textures are WebP');
  } catch (e) { ok(false, n + ' reads', String(e).slice(0, 120)); }
}

ok(/import \* as SkeletonUtils from 'three\/addons\/utils\/SkeletonUtils\.js'/.test(NC), 'node-city imports SkeletonUtils');
ok(/const CIV_MODELS = \['\.\.\/models\/civilians\/regal\.glb', '\.\.\/models\/civilians\/survivor\.glb', '\.\.\/models\/civilians\/pilgrim\.glb', '\.\.\/models\/civilians\/wanderer\.glb'\];/.test(NC), 'the four models are the civilian roster');
ok(/function loadRig\(url\)/.test(NC) && /res\(\{ scene: g\.scene, animations: g\.animations \|\| \[\] \}\)/.test(NC), 'loadRig keeps the animation clips');
ok(/function civMockHeight\(\)/.test(NC) && /const m = makeCivilian\(CIV_COLORS\[0\], 4\);\n\s*m\.scale\.setScalar\(CIV_SCALE\);/.test(NC), 'the target height is MEASURED from the mock-up at CIV_SCALE');
ok(/function fitRigToHeight\(inst, height\)/.test(NC) && /inst\.position\.y = -b\.min\.y \* s;/.test(NC), 'a rig is fitted to that height with its feet on the ground');
ok(/const inst = SkeletonUtils\.clone\(gltf\.scene\);/.test(NC) && /new THREE\.AnimationMixer\(inst\)/.test(NC) && /action\.play\(\);/.test(NC), 'instances clone through SkeletonUtils and play the clip');
ok(/if \(kind === 'civilian' && !reg\) \{ try \{ civRigSwap\(g\); \} catch \(e\) \{\} \}/.test(NC), 'agentMesh swaps the placeholder for a rig when no admin slot is set');
ok(/if \(g\.userData\.gone\) return;/.test(NC), 'a rig that lands after despawn is dropped');
ok(/a\.mesh\.userData\.mixer\.update\(dt\);/.test(NC) && /a\.mesh\.userData\.mixer\.update\(\(dx \|\| dz\) \? dt : 0\);/.test(NC), 'the mixer advances while moving, holds while waiting');
ok((NC.match(/if \(a\.kind === 'civilian' && a\.mesh\.userData\.mixer\) \{ py = 0;/g) || []).length === 2, 'the procedural bob is off for a rig at both sites');
ok(/mx\.stopAllAction\(\); mx\.uncacheRoot\(mx\.getRoot\(\)\);/.test(NC), 'despawn stops and uncaches the mixer');
ok(/civRigs: \[\], civHeight: 0, SkeletonUtils,/.test(NC) && /Promise\.all\(CIV_MODELS\.map\(loadRig\)\)\.then\(list => \{/.test(NC) && /window\.MythicCrowd\.rebuild\(\)/.test(NC), 'the standing crowd is handed the rigs and rebuilt when they land');
ok(/function bakeRig\(wx, wz, yaw, seed, out, dayOnly\)/.test(CW) && /o\.applyBoneTransform\(i, v\)/.test(CW) && /geo\.computeVertexNormals\(\);/.test(CW), 'the standing crowd bakes the posed skin on the CPU');
ok(/if \(CTX\.civRigs && CTX\.civRigs\.length && CTX\.SkeletonUtils\) \{ try \{ return bakeRig/.test(CW), 'bake() prefers the rigs and falls back to the mock-up');
ok(/rebuild\(\) \{ sig = ''; return api\.refresh\(\); \}/.test(CW) && /ctx: \(\) => CTX,/.test(CW), 'the crowd exposes ctx() and rebuild()');
{ const IG = readFileSync('./public/.assetsignore', 'utf8'); ok(['regal', 'survivor', 'pilgrim', 'wanderer'].every((n) => IG.indexOf('!models/civilians/' + n + '.glb') >= 0), 'the four civilians are allow-listed past the blanket **/*.glb ignore (or the deploy ships nothing)'); }
ok(/window\.NC_BUILD = "v121v(5[5-9]|[6-9]\d|\d{3,})-/.test(NC), 'city build v121v55 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
