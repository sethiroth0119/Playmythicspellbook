/* ══════════════════════════════════════════════════════════════════════════
   🧍 PATIENT MODELS — the looks patients rotate through at random.
   ──────────────────────────────────────────────────────────────────────────
   Drop .glb files into /public/models/hospital/patients/ and list them here.
   A patient's `look` (patients.js) is an index into this list, fixed at
   arrival, so the same person keeps the same face across reloads. Until a
   file is present the scene shows a tinted box figure — the game keeps
   working with an empty list.

   ⚠ Same rules as the lab's characters (/src/biolab/scene.js header):
     root-relative URLs, run _glbpack.mjs on any export over a few MB, and
     keep each file under Cloudflare's per-asset cap. Clips named "walk" and
     "idle" are picked up if present; anything else still stands and lies.
   ⚠ Bump the ?v= on /src/hospital/index.js in index.html when this changes —
     the service worker caches /src/* like any other static asset. */

/* Four wasteland civilians, each packed from four one-clip Meshy exports by
   tools/glbpack-character.mjs into ONE file carrying all four:

     walk  crossing the lobby
     run   unused here, kept because the packer's ladder expects it and a
           future "rush the door" state costs nothing to add
     talk  waiting at the intake desk
     lie   in a bed

   ⚠ THE CLIP NAMES ARE THE CONTRACT. scene.patients.js picks by state and
     /src/biolab/scene.js binds by name (substring, case-insensitive), so a
     re-export whose clips are called something else will load, stand there
     and animate nothing. Re-pack rather than renaming by hand.
   ⚠ 0.5–0.9 MB each, from ~23 MB of raw export apiece — the texture was 95%
     of every source file and the packer dedupes it to one 1024px WebP. */
export const PATIENT_MODELS = [
  { key: 'pilgrim',  url: '/models/hospital/patients/pilgrim.glb' },
  { key: 'survivor', url: '/models/hospital/patients/survivor.glb' },
  { key: 'wanderer', url: '/models/hospital/patients/wanderer.glb' },
  { key: 'denim',    url: '/models/hospital/patients/denim.glb' },
];

/* Box-figure tints used while a model is missing, one per look. */
export const FALLBACK_TINTS = [0xc8a27a, 0x8fb3d8, 0xd8c08f, 0x9fd8a0, 0xd89fb8, 0xb8a0d8];
