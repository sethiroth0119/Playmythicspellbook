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

export const PATIENT_MODELS = [
  // { key: 'patient-a', url: '/models/hospital/patients/patient-a.glb' },
  // { key: 'patient-b', url: '/models/hospital/patients/patient-b.glb' },
];

/* Box-figure tints used while a model is missing, one per look. */
export const FALLBACK_TINTS = [0xc8a27a, 0x8fb3d8, 0xd8c08f, 0x9fd8a0, 0xd89fb8, 0xb8a0d8];
