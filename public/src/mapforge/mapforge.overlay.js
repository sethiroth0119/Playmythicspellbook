/* mapforge.overlay.js — the GAME side of game scenes.

   A host game (Homestead Farm today) that draws its own r128 scene asks for
   the live Athena map tagged with its id and gets back an OVERLAY: the map's
   objects built into a group it can add to its own scene, plus slot lookups
   so it can move / replace / hide its own assets the way the builder did.

     const ov = await AthenaEngine.overlay.forGame('farm', { THREE, scene });
     if (!ov) { … no map, draw as usual … }
     scene.add(ov.group);                        // props, models, VFX, weather
     const s = ov.slot('feedmill');              // { o, p, r, s, replaced }
     ov.buildReplacement('feedmill')             // Object3D for a replaced slot, or null
     ov.update(dt, camera);                      // animation, particles
     ov.dispose();

   Every call degrades: no Athena module, no map, an unsigned player → null.
   The overlay never touches the game's own state. */

import { ensureThree } from './mapforge.three.js';
import { buildWorld } from './mapforge.world.js';
import * as api from './mapforge.api.js';
import { normalize } from './mapforge.format.js';

const cache = new Map();   // game → { at, map, source }
const TTL = 30 * 1000;

export function invalidate(game) { if (game) cache.delete(game); else cache.clear(); }

export async function liveMap(game, force) {
  const hit = cache.get(game);
  if (!force && hit && Date.now() - hit.at < TTL) return hit;
  const r = await api.loadLive(game);
  const rec = { at: Date.now(), map: r.ok ? r.map : null, source: r.ok ? r.source : null };
  cache.set(game, rec);
  return rec;
}

export async function forGame(game, opts) {
  opts = opts || {};
  const rec = await liveMap(game, opts.force);
  if (!rec.map) return null;
  const map = normalize(rec.map);
  let THREE = opts.THREE || (typeof window !== 'undefined' && window.THREE);
  if (!THREE) { try { ({ THREE } = await ensureThree()); } catch (e) { return null; } }
  const world = buildWorld(THREE, map, {
    scene: opts.scene, markers: false,
    ground: opts.ground != null ? opts.ground : map.scene.ground, water: opts.water != null ? opts.water : map.scene.water, sky: opts.sky != null ? opts.sky : map.scene.sky,
    lights: opts.lights != null ? opts.lights : false,
    gltfLoader: opts.gltfLoader, onLightning: opts.onLightning,
  });
  // slot objects are the game's stand-ins: hide the placeholder body, the game draws the real thing
  world.objects.forEach((root, id) => { const o = map.objects.find(x => x.id === id); if (o && o.t === 'slot') root.visible = false; });
  const detached = [];
  const ov = {
    map, world, group: world.group, source: rec.source, THREE,
    pieces: world.pieces,
    slot(key) {
      const o = world.slot(key); if (!o) return null;
      return { o, p: o.p.slice(), r: o.r.slice(), s: o.s.slice(), hidden: !!(o.f && !world.folderVisible(o.f)), replaced: o.t !== 'slot' };
    },
    slots: () => world.slots().map(o => ov.slot(o.k)),
    /* An Object3D standing in for a replaced slot (prop or .glb), positioned
       at the origin: the host places it where its own asset was. */
    buildReplacement(key) {
      const o = world.slot(key); if (!o || o.t === 'slot') return null;
      const d = world.buildDetached(o); detached.push(d); return d.root;
    },
    update(dt, camera) { world.update(dt, camera); detached.forEach(d => d.update(dt)); },
    dispose() { try { world.dispose(); } catch (e) {} detached.length = 0; },
  };
  return ov;
}
