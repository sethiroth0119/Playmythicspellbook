/* ═══════════════════════════════════════════════════════════════════════════
   🎬 THREE BOOT — get a renderer, or fail politely.

   The app already lazy-loads three.js r128 for the impact VFX
   (_vfxEnsureThree, index.html:90198). This does the same job for the bench,
   with one improvement: it tries the LOCAL vendored copy first.

   ⚠ WHY LOCAL FIRST. public/assets/vfx/three.min.js has been sitting in the
     repo unreferenced — every existing loader reaches for cdnjs instead. This
     app is a PWA served off Cloudflare and CLAUDE.md requires it to work
     offline; a core feature that only renders when a third-party CDN is
     reachable does not meet that bar. Same r128 UMD build, so window.THREE
     ends up identical either way and the CDN stays as the fallback.

   🔴 NO WEBGL IS NOT AN ERROR. Every entry point here resolves to null rather
      than throwing, and the DOM bench keeps working exactly as it does today.
      The 3D view is a garnish on a feature that is already complete and
      tested — it must never be able to take the bench down with it.
   ═══════════════════════════════════════════════════════════════════════════ */

const LOCAL_URL = 'assets/vfx/three.min.js';
const CDN_URL   = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

let _booting = null;

function _inject(src) {
  return new Promise((resolve) => {
    try {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(!!window.THREE);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    } catch (e) { resolve(false); }
  });
}

/* Resolves to window.THREE, or null. Memoised — a second bench open must not
   inject the library twice. */
export function boot() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.THREE) return Promise.resolve(window.THREE);
  if (_booting) return _booting;

  _booting = (async () => {
    if (await _inject(LOCAL_URL)) return window.THREE;
    // Local copy missing or corrupt — fall back to the same CDN every other
    // loader in this app uses, so behaviour is no worse than the status quo.
    if (await _inject(CDN_URL)) return window.THREE;
    try { console.warn('[weaponsmith] three.js unavailable — the bench stays 2D.'); } catch (e) {}
    return null;
  })();
  return _booting;
}

/* Is a WebGL context even obtainable? Checked BEFORE building a scene, because
   constructing a WebGLRenderer on a machine without WebGL throws, and a throw
   inside the bench's paint would take the whole overlay down. */
export function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch (e) { return false; }
}

/* Honour the user's own setting. A workshop that animates forever is exactly
   the kind of thing prefers-reduced-motion exists for; the scene still renders,
   it just stops idling. */
export function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}
