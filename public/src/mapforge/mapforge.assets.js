/* mapforge.assets.js — the asset browser behind Library.

   Unreal's Content Browser and Unity's Project window do three things the
   flat Library list could not: search everything at once, filter by tag, and
   show what a thing LOOKS like before you place it. This module is the pure
   half of that (an index over every placeable thing, search + scoring,
   favourites/recents) plus a small offscreen thumbnail renderer. The editor
   owns the DOM; games never import this.

   What is indexed (all of it read-only sources — nothing is uploaded):
     prop     built-in procedural props (mapforge.props.js)
     model    .glb assets already in this map (`map.assets`)
     project  /models/manifest.json → models (files the game ships)
     prefab   this map's prefabs
     shelf    prefabs kept on this device (localStorage)
     sound    this map's sounds
     psound   /models/manifest.json → sounds

   Tags are the search vocabulary. Built-in props carry hand-written tags
   below (a "tree" is also "plant", "wood", "forest"); manifest entries may
   carry `tags: []`; prefabs get `tags` the author types in the details
   panel. Every entry also gets its category, kind and label words, so an
   untagged thing is still findable by name. */

/* Hand-written tags for built-ins. Keep them lower-case, one concept each;
   `search()` matches on prefixes so "for" already hits "forest". */
export const PROP_TAGS = {
  tree: ['plant', 'wood', 'forest', 'oak'], pine: ['plant', 'wood', 'forest', 'conifer'], deadtree: ['plant', 'wood', 'dead', 'spooky'],
  bush: ['plant', 'shrub', 'green'], grass: ['plant', 'ground', 'cover'], flowers: ['plant', 'ground', 'cover', 'colour'],
  rock: ['stone', 'boulder', 'grey'], boulder: ['stone', 'rock', 'large'], log: ['wood', 'fallen', 'debris'], stump: ['wood', 'cut'],
  mushroom: ['plant', 'fungus', 'small'], crystal: ['gem', 'glow', 'magic', 'mineral'],
  house: ['building', 'home', 'roof', 'village'], cottage: ['building', 'home', 'small', 'village'], tower: ['building', 'tall', 'castle', 'stone'],
  wall: ['stone', 'barrier', 'castle'], fence: ['wood', 'barrier', 'farm'], arch: ['gate', 'entrance', 'stone'], bridge: ['crossing', 'wood', 'river'],
  well: ['water', 'stone', 'village'], pillar: ['stone', 'column', 'temple'], ruin: ['stone', 'broken', 'old'], altar: ['magic', 'stone', 'temple', 'ritual'],
  statue: ['stone', 'monument', 'figure'], tent: ['camp', 'cloth', 'shelter'], stall: ['market', 'shop', 'wood', 'village'],
  barrel: ['wood', 'container', 'storage'], crate: ['wood', 'container', 'storage', 'box'], chest: ['loot', 'treasure', 'container'],
  lantern: ['light', 'lamp', 'glow', 'night'], campfire: ['fire', 'light', 'camp', 'warm'], banner: ['cloth', 'flag', 'faction'], signpost: ['wood', 'sign', 'road'],
  ruintower: ['building', 'city', 'tall', 'broken', 'concrete'], collapsed: ['building', 'city', 'broken', 'concrete'], rubble: ['debris', 'stone', 'concrete', 'broken'],
  road: ['ground', 'asphalt', 'city', 'street'], overpass: ['road', 'concrete', 'city', 'bridge'], wreckcar: ['vehicle', 'car', 'metal', 'broken'],
  lamppost: ['light', 'metal', 'street', 'city'], barrier: ['concrete', 'road', 'block'], barricade: ['wood', 'block', 'defence'], container: ['metal', 'shipping', 'storage', 'box'],
  radiotower: ['metal', 'tall', 'antenna', 'signal'], billboard: ['sign', 'metal', 'city'], burnttree: ['plant', 'dead', 'fire', 'smoke'], drum: ['metal', 'container', 'oil'],
  scrap: ['metal', 'debris', 'junk'], crater: ['ground', 'blast', 'toxic', 'hole'], generator: ['machine', 'metal', 'power', 'sparks'], pylon: ['power', 'energy', 'tall', 'glow'],
  dronewreck: ['machine', 'metal', 'broken', 'scifi'], bunker: ['door', 'concrete', 'military'], sfcrate: ['container', 'box', 'scifi', 'supply'],
  fx_fire: ['effect', 'fire', 'light'], fx_bigfire: ['effect', 'fire', 'light', 'large'], fx_smoke: ['effect', 'smoke'], fx_darksmoke: ['effect', 'smoke', 'black'],
  fx_steam: ['effect', 'steam', 'white'], fx_fog: ['effect', 'fog', 'mist', 'ground'], fx_sparks: ['effect', 'sparks', 'electric'], fx_toxic: ['effect', 'gas', 'poison', 'green'],
  fx_dust: ['effect', 'dust', 'wind'], fx_motes: ['effect', 'light', 'magic', 'glow'],
  spawn: ['marker', 'player', 'start'], enemy: ['marker', 'enemy', 'ai'], waypoint: ['marker', 'path', 'patrol'], zone: ['marker', 'area', 'trigger'],
};

export const KINDS = {
  prop:    { label: 'Prop',       icon: '🧊', source: 'built-in' },
  model:   { label: 'Model',      icon: '🗿', source: 'this map' },
  project: { label: 'Model',      icon: '🗂', source: 'project' },
  prefab:  { label: 'Prefab',     icon: '🧱', source: 'this map' },
  shelf:   { label: 'Prefab',     icon: '📚', source: 'this device' },
  sound:   { label: 'Sound',      icon: '🔊', source: 'this map' },
  psound:  { label: 'Sound',      icon: '🗂', source: 'project' },
  spline:  { label: 'Spline',     icon: '〰️', source: 'built-in' },
};

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const uniq = (a) => Array.from(new Set(a));
export function tokenize(q) { return words(q).slice(0, 8); }

/* Build the flat index. Each entry: { key, kind, id, label, icon, cat, tags,
   words, ref } — `ref` is the source record (prop def, asset, prefab, …) so
   the editor can act on a hit without a second lookup. Slots and the prefab
   type-entry are skipped: they are never placed from the Library. */
export function buildIndex(src) {
  const out = [];
  const push = (kind, id, label, icon, cat, tags, ref, extra) => {
    const t = uniq([...(tags || []).map(x => String(x).toLowerCase().trim()).filter(Boolean)]);
    const w = uniq([...words(label), ...words(cat), ...t.flatMap(words), ...words(KINDS[kind].label), ...words(KINDS[kind].source)]);
    out.push(Object.assign({ key: kind + ':' + id, kind, id: String(id), label: String(label || id), icon: icon || KINDS[kind].icon, cat: cat || KINDS[kind].label, tags: t, words: w, ref }, extra || {}));
  };
  (src.props || []).forEach(p => {
    if (p.slot || p.prefab || p.id === 'placeholder') return;
    const t = [...(PROP_TAGS[p.id] || [])];
    if (p.tint) t.push('tintable'); if (p.fx || p.fxKind) t.push('effect'); if (p.marker) t.push('marker'); if (p.col === false) t.push('no-collision');
    push('prop', p.id, p.label, p.icon, p.cat, t, p);
  });
  (src.splines || []).forEach(p => push('spline', p.id, p.label, p.icon, 'Splines', [...(p.tags || []), p.mode, 'spline', 'curve'], p));
  (src.assets || []).forEach(a => push('model', a.id, a.label, a.data ? '📦' : '🧊', 'Models', [...(a.tags || []), a.data ? 'embedded' : 'url', ...(a.anims && a.anims.length ? ['animated'] : [])], a, { url: a.url }));
  (src.project || []).forEach((m, i) => push('project', m.id || String(i), m.label || m.id || m.url, '🗂', m.cat || 'Models', [...(m.tags || []), ...(m.anims && m.anims.length ? ['animated'] : [])], m, { url: m.url, inMap: !!(src.assets || []).find(a => a.url === m.url) }));
  (src.prefabs || []).forEach(p => push('prefab', p.id, p.name, p.icon || '🧱', 'Prefabs', [...(p.tags || []), p.objects.length + ' parts'], p, { parts: p.objects.length }));
  (src.shelf || []).forEach(e => { if ((src.prefabs || []).find(p => p.id === e.id)) return; push('shelf', e.id, e.name, e.icon || '🧱', 'Prefabs', [...(e.tags || []), 'shelf'], e, { parts: (e.objects || []).length }); });
  (src.sounds || []).forEach(s => push('sound', s.id, s.label, '🔊', 'Sounds', s.tags || [], s, { url: s.url }));
  (src.projectSounds || []).forEach((m, i) => push('psound', m.id || String(i), m.label || m.url, '🗂', 'Sounds', m.tags || [], m, { url: m.url, inMap: !!(src.sounds || []).find(s => s.url === m.url) }));
  return out;
}

/* Search: every token must prefix-match some word of the entry (label, tag,
   category, kind). Score rewards label hits over tag hits and exact words
   over prefixes, so "rock" lists Rock before Boulder (tagged rock) before
   Rubble (tagged stone… no — it doesn't match at all, which is the point).
   Filters: kind (or array), tag (exact), cat, favourites (a Set of keys). */
export function search(index, q, f) {
  f = f || {};
  const toks = tokenize(q);
  const kinds = f.kind ? (Array.isArray(f.kind) ? f.kind : [f.kind]) : null;
  const res = [];
  for (const e of index) {
    if (kinds && !kinds.includes(e.kind)) continue;
    if (f.cat && e.cat !== f.cat) continue;
    if (f.tag && !e.tags.includes(f.tag)) continue;
    if (f.fav && !f.fav.has(e.key)) continue;
    let score = 0, ok = true;
    const lw = words(e.label);
    for (const t of toks) {
      let best = 0;
      for (const w of lw) { if (w === t) best = Math.max(best, 10); else if (w.startsWith(t)) best = Math.max(best, 6); }
      if (!best) for (const w of e.words) { if (w === t) best = Math.max(best, 4); else if (w.startsWith(t)) best = Math.max(best, 2); }
      if (!best) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    if (String(e.label).toLowerCase() === toks.join(' ')) score += 20;
    res.push({ e, score });
  }
  res.sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label));
  return res.map(r => r.e);
}

/* Tag cloud for a result set: [{ tag, n }] most common first, part counts
   ("3 parts") and the kind words left out. */
export function collectTags(entries, max) {
  const n = new Map();
  entries.forEach(e => e.tags.forEach(t => { if (/^\d+ parts$/.test(t)) return; n.set(t, (n.get(t) || 0) + 1); }));
  return Array.from(n, ([tag, c]) => ({ tag, n: c })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).slice(0, max || 12);
}

/* Favourites + recents, per device. Keys are entry keys ('prop:tree',
   'project:duck'); a map's own models/prefabs use their ids, which are
   unique per map, so a favourite there is effectively per map — fine. */
export const PREFS_KEY = 'mf_assets_v1';
export function createPrefs(storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  let st = { fav: [], recent: [], view: 'grid' };
  try { const j = JSON.parse(storage && storage.getItem(PREFS_KEY) || 'null'); if (j && typeof j === 'object') st = Object.assign(st, j); } catch (e) {}
  st.fav = Array.isArray(st.fav) ? st.fav.filter(x => typeof x === 'string') : []; st.recent = Array.isArray(st.recent) ? st.recent.filter(x => typeof x === 'string') : [];
  const save = () => { try { storage && storage.setItem(PREFS_KEY, JSON.stringify(st)); } catch (e) {} };
  const favSet = () => new Set(st.fav);
  return {
    get view() { return st.view; }, set view(v) { st.view = v === 'list' ? 'list' : 'grid'; save(); },
    get favs() { return favSet(); },
    isFav: (k) => st.fav.includes(k),
    toggleFav(k) { if (st.fav.includes(k)) st.fav = st.fav.filter(x => x !== k); else st.fav = [k, ...st.fav].slice(0, 200); save(); return st.fav.includes(k); },
    get recent() { return st.recent.slice(); },
    touch(k) { st.recent = [k, ...st.recent.filter(x => x !== k)].slice(0, 12); save(); },
    forget(k) { st.recent = st.recent.filter(x => x !== k); st.fav = st.fav.filter(x => x !== k); save(); },
  };
}

/* ── Thumbnails ────────────────────────────────────────────────────────────
   One small offscreen WebGLRenderer, one scene, one camera; render(key, obj)
   frames `obj` from a 3/4 view, returns a data URL and caches it. The object
   is added to the thumb scene for the draw and given back to whatever parent
   it had (templates have none). preserveDrawingBuffer so toDataURL reads the
   frame just drawn. A context that fails to create → thumbs.ok = false and
   render() returns null: the Library falls back to icons. */
export function createThumbs(THREE, opts) {
  opts = opts || {};
  const size = opts.size || 96;
  const cache = new Map();
  let renderer = null, scene, camera, ok = true;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setSize(size, size, false); renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3020, 0.9); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.1); sun.position.set(3, 6, 4); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.35); fill.position.set(-4, 2, -3); scene.add(fill);
    camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
  } catch (e) { ok = false; renderer = null; }
  function frame(obj) {
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    if (bb.isEmpty()) bb.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const c = new THREE.Vector3(), s = new THREE.Vector3(); bb.getCenter(c); bb.getSize(s);
    const r = Math.max(s.x, s.y, s.z, 0.05) * 0.62;
    const d = r / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.15;
    const dir = new THREE.Vector3(1, 0.75, 1.25).normalize();
    camera.position.copy(c).addScaledVector(dir, d); camera.near = Math.max(0.01, d * 0.05); camera.far = d * 6; camera.lookAt(c); camera.updateProjectionMatrix();
  }
  return {
    get ok() { return ok && !!renderer; }, size, cache,
    get(key) { return cache.get(key) || null; },
    has(key) { return cache.has(key); },
    /* Render `obj` (an Object3D not currently in another scene) and cache under key. */
    render(key, obj) {
      if (!renderer || !obj) return null;
      if (cache.has(key)) return cache.get(key);
      const parent = obj.parent;
      try {
        scene.add(obj); frame(obj);
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL('image/png');
        cache.set(key, url);
        return url;
      } catch (e) { return null; }
      finally { scene.remove(obj); if (parent) parent.add(obj); }
    },
    invalidate(key) { cache.delete(key); },
    dispose() { cache.clear(); try { renderer && renderer.dispose(); } catch (e) {} renderer = null; },
  };
}

/* Editor-side helper: a synchronous "give me the picture or the emoji" for a
   card. Returns { img } or { icon }. `build` makes the object on demand. */
export function thumbFor(thumbs, key, icon, build) {
  if (thumbs && thumbs.ok) {
    let url = thumbs.get(key);
    if (!url && build) { try { const o = build(); if (o) url = thumbs.render(key, o); } catch (e) {} }
    if (url) return { img: url };
  }
  return { icon };
}
