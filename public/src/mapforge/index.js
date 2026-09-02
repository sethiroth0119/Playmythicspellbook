/* ⚒ ATHENA ENGINE (World Forge) — the 3D map creator + mini-game engine. Entry point.

   Registers window.MythicMapForge and stays INERT until open() is called
   (the admin panel button in index.html, or ?mapforge=1 on the URL). three.js
   is not fetched until then, so this costs the game nothing at boot.

   For the game side, buildWorld() is exported too: hand it the r128
   window.THREE and a saved map document and it returns terrain, water, sky,
   lights, every placed object and heightAt(x, z). See docs/map-forge.md. */

import { openEditor, closeEditor, isOpen, current } from './mapforge.editor.js';
import { buildWorld } from './mapforge.world.js';
import { mountWorld } from './mapforge.engine.js';
import { createPlayer } from './mapforge.player.js';
import { newMap, normalize, serialize, PAINT, ENV_PRESETS, MAP_VERSION } from './mapforge.format.js';
import { PROP_CATALOG } from './mapforge.props.js';
import * as api from './mapforge.api.js';

const MythicMapForge = {
  version: MAP_VERSION,
  open: (opts) => openEditor(opts).catch(e => { try { console.warn('[mapforge] open failed', e); } catch (_) {} return null; }),
  close: closeEditor,
  isOpen,
  editor: current,
  buildWorld,
  /* the engine entry for mini-games: await MythicMapForge.engine.mount(el, { game: 'card-shop' }) */
  engine: { mount: mountWorld, createPlayer },
  format: { newMap, normalize, serialize, PAINT, ENV_PRESETS, PROP_CATALOG },
  maps: { list: api.listMaps, load: api.loadMap, save: api.saveMap, remove: api.deleteMap, setLive: api.setLive, loadLive: api.loadLive },
};

// Athena Engine is the product name; MythicMapForge stays as the API alias index.html already wires.
try { window.AthenaEngine = MythicMapForge; window.MythicMapForge = MythicMapForge; } catch (e) {}

// Deep link: /?mapforge=1 (optionally &map=<id>&src=cloud|local) opens straight
// into the editor once the page has settled.
try {
  const q = new URLSearchParams(location.search);
  if (q.get('mapforge') === '1') {
    const go = () => setTimeout(() => MythicMapForge.open(q.get('map') ? { id: q.get('map'), source: q.get('src') || 'local' } : {}), 800);
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  }
} catch (e) {}

export default MythicMapForge;
