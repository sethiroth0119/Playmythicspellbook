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
import * as pill from './mapforge.pill.js';
import { currentScreen } from './mapforge.bridge.js';
import * as session from './mapforge.session.js';
import * as menu from './mapforge.menu.js';
import * as assets from './mapforge.files.js';
import * as games from './mapforge.games.js';
import * as overlay from './mapforge.overlay.js';
import * as quality from './mapforge.quality.js';
import * as showroom from './mapforge.showroom.js';

const MythicMapForge = {
  version: MAP_VERSION,
  // The editor is full-screen: hide the ⚒ pill first, whichever door opened it
  // (hub tile, Pricing Admin, the pill itself, ?mapforge=1). It redraws on close.
  open: (opts) => { try { pill.hide(); } catch (e) {} return openEditor(opts).catch(e => { try { console.warn('[mapforge] open failed', e); } catch (_) {} return null; }); },
  close: closeEditor,
  isOpen,
  editor: current,
  buildWorld,
  /* the engine entry for mini-games: await MythicMapForge.engine.mount(el, { game: 'card-shop' }) */
  engine: { mount: mountWorld, createPlayer },
  format: { newMap, normalize, serialize, PAINT, ENV_PRESETS, PROP_CATALOG },
  maps: { list: api.listMaps, load: api.loadMap, save: api.saveMap, remove: api.deleteMap, setLive: api.setLive, loadLive: api.loadLive, liveGames: api.liveGames },
  /* the mini-game door: render() calls pill.sync(App.screen); play(game) walks a
     live world in an overlay; closePlay() tears it down. See mapforge.pill.js. */
  pill: { sync: pill.sync, refresh: pill.refreshLive, hide: pill.hide },
  play: pill.play,
  closePlay: pill.closePlay,
  /* 🌍 maps as MENU BUTTONS (mapforge.menu.js / mapforge.session.js):
     renderTitle() asks menuTiles(hub) for the tiles to add; a tile's click
     calls enter(mapId) — a hub with other players, or an interactive walk. */
  menuTiles: menu.menuTiles,
  refreshMenu: menu.refreshMenu,
  enter: session.enter,
  leave: session.exit,
  inWorld: session.isActive,
  /* the uploaded files (world_assets, sql/112) */
  assets: { list: assets.list, upload: assets.upload, remove: assets.remove, kinds: assets.KINDS },
  /* game scenes: a mini-game registers an adapter, its map opens in the editor (open({ game })),
     and the game reads the result back as an overlay — docs/athena-engine.md → Game scenes */
  games: { register: games.register, get: games.get, list: games.list, onRegister: games.onRegister },
  /* 🎮 every mini-game's model slots as showroom scenes (round 18, mapforge.showroom.js) */
  showrooms: { list: showroom.listGames, open: showroom.open, pick: showroom.pick, register: showroom.registerAll, build: showroom.buildShowroom, diff: showroom.diffShowroom, lastWrite: showroom.lastWrite },
  overlay: { forGame: overlay.forGame, liveMap: overlay.liveMap, invalidate: overlay.invalidate },
  /* 👕 the Player Closet (/src/closet, window.MythicCloset): the creator for players, the studio for authors — see docs/athena-engine.md → Player Closet */
  closet: { open: (o) => { try { return window.MythicCloset ? window.MythicCloset.open(o) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }, openStudio: (o) => { try { return window.MythicCloset ? window.MythicCloset.openStudio(o) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } } },
  /* the quality ladder: get() / set('auto'|'low'|'medium'|'high') / onChange(fn) — remembered per device, auto steps down on low fps */
  quality: { get: quality.get, set: quality.set, onChange: quality.onChange, apply: quality.apply, LEVELS: quality.LEVELS },
};
games.drainQueue();

// Athena Engine is the product name; MythicMapForge stays as the API alias index.html already wires.
try { window.AthenaEngine = MythicMapForge; window.MythicMapForge = MythicMapForge; } catch (e) {}

// The module loads after the first screen has drawn, so sync once now; every
// later screen change reaches pill.sync through render().
try { pill.sync(currentScreen()); } catch (e) {}

// Deep link: /?mapforge=1 (optionally &map=<id>&src=cloud|local) opens straight
// into the editor once the page has settled.
try {
  const q = new URLSearchParams(location.search);
  if (q.get('mapforge') === '1') {
    const go = () => setTimeout(() => MythicMapForge.open(q.get('map') ? { id: q.get('map'), source: q.get('src') || 'local' } : q.get('game') ? { game: q.get('game') } : {}), 800);
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  }
} catch (e) {}

export default MythicMapForge;
