/* mapforge.three.js — get a THREE that matches the rest of the game.

   The game runs the legacy r128 GLOBAL build (window.THREE) for the 3D
   battle board, the card shop and the battlemap editor, and index.html's
   import map points the bare 'three' specifier at the 0.171 WebGPU build for
   the sprite layer. World Forge deliberately uses the r128 global:
     • a map built here can be handed to the SAME THREE the battle board
       already has (no cross-version object soup),
     • ShaderMaterial (water, sky) exists there and not in the WebGPU build,
     • the r128 example addons (OrbitControls, TransformControls, GLTFLoader)
       are the proven CDN URLs index.html already loads from.
   Every piece is optional. Missing OrbitControls → built-in orbit; missing
   TransformControls → move by dragging on the ground + inspector fields;
   missing GLTFLoader → custom .glb assets show as placeholders.

   `window.MF_THREE_URLS` overrides the sources (used by the local test
   harness, and handy if a CDN is ever blocked for a player base). */

const DEFAULT_URLS = {
  core: [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    '/assets/vfx/three.min.js',   // same build, already deployed with the VFX pages
  ],
  addons: {
    OrbitControls:     'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
    TransformControls: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js',
    GLTFLoader:        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  },
};

const loading = new Map();
function loadScript(url) {
  if (loading.has(url)) return loading.get(url);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => res(true);
    s.onerror = () => { loading.delete(url); rej(new Error('failed ' + url)); };
    document.head.appendChild(s);
  });
  loading.set(url, p);
  return p;
}

let ready = null;
export function ensureThree() {
  if (ready) return ready;
  ready = (async () => {
    const cfg = (window.MF_THREE_URLS && typeof window.MF_THREE_URLS === 'object') ? window.MF_THREE_URLS : DEFAULT_URLS;
    if (!window.THREE) {
      let ok = false;
      for (const url of (cfg.core || DEFAULT_URLS.core)) {
        try { await loadScript(url); if (window.THREE) { ok = true; break; } } catch (e) {}
      }
      if (!ok) throw new Error('three.js could not be loaded');
    }
    const T = window.THREE;
    const addons = cfg.addons || DEFAULT_URLS.addons;
    const missing = [];
    await Promise.all(Object.keys(addons).map(async (name) => {
      if (T[name]) return;
      try { await loadScript(addons[name]); } catch (e) {}
      if (!T[name]) missing.push(name);
    }));
    return { THREE: T, missing };
  })();
  ready.catch(() => { ready = null; });   // allow a retry after a network failure
  return ready;
}
