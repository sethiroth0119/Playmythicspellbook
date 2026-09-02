/* mapforge.engine.js — mount a World Forge map as a playable scene.

   This is the "game engine" entry for mini-games. One call gives a running
   scene in any container:

     const g = await MythicMapForge.engine.mount(hostEl, { game: 'card-shop' });
     g.on('frame', (dt) => { ... });          // your game loop
     g.world.find('enemy')                     // spawn markers placed in the editor
     g.player.pos / g.camera / g.scene / g.world.heightAt(x, z)
     g.stop();                                 // tear everything down

   Source of the map, in order of what you pass: `map` (a document), `id` +
   `source`, or `game` (that game's LIVE world — the one the admin marked
   "live" in the Maps tab; falls back to the newest map tagged with the game,
   then to an empty flat world so a mini-game never crashes on a missing map).

   Mode: 'fps' (default) walks from the first Player Spawn with pointer lock
   on click; 'orbit' gives an inspect camera; 'none' leaves the camera to you. */

import { ensureThree } from './mapforge.three.js';
import { buildWorld } from './mapforge.world.js';
import { createPlayer } from './mapforge.player.js';
import { newMap, normalize } from './mapforge.format.js';
import * as api from './mapforge.api.js';

export async function mountWorld(host, opts) {
  opts = opts || {};
  const { THREE } = await ensureThree();
  let map = null, source = null;
  if (opts.map) map = normalize(opts.map);
  else if (opts.id) { const r = await api.loadMap(opts.id, opts.source || 'cloud'); if (r.ok) { map = r.map; source = opts.source || 'cloud'; } }
  else if (opts.game) { const r = await api.loadLive(opts.game); if (r.ok) { map = r.map; source = r.source; } }
  if (!map) { map = newMap({ name: 'empty', game: opts.game || 'sandbox' }); if (opts.onMissing) opts.onMissing(); }

  const renderer = new THREE.WebGLRenderer({ antialias: opts.antialias !== false, powerPreference: 'high-performance', alpha: !!opts.alpha });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio || 2));
  renderer.shadowMap.enabled = opts.shadows !== false; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement; canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.tabIndex = 0;
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov || 60, 1, 0.1, 3000);
  const world = buildWorld(THREE, map, { scene, markers: !!opts.markers, gltfLoader: opts.gltfLoader });
  scene.add(world.group);

  const listeners = { frame: [], resize: [] };
  const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => { listeners[ev] = listeners[ev].filter(f => f !== fn); }; };

  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    listeners.resize.forEach(f => f(w, h));
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  const mode = opts.mode || 'fps';
  let player = null, controls = null, clickToLock = null;
  if (mode === 'fps') {
    player = createPlayer(THREE, { world, camera, dom: canvas, pointerLock: opts.pointerLock !== false, onUnlock: opts.onUnlock, onFrame: opts.onPlayerFrame, eye: opts.eye, speed: opts.speed });
    player.start(opts.spawn);
    if (opts.pointerLock !== false) { clickToLock = () => { try { canvas.requestPointerLock(); } catch (e) {} }; canvas.addEventListener('click', clickToLock); }
  } else if (mode === 'orbit') {
    const size = world.terrain.size;
    camera.position.set(size * 0.55, size * 0.4, size * 0.55);
    if (THREE.OrbitControls) { controls = new THREE.OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.target.set(0, 0, 0); controls.update(); }
    else camera.lookAt(0, 0, 0);
  }

  let raf = 0, last = performance.now(), running = true;
  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (player) player.frame(dt);
    if (controls) controls.update();
    world.update(dt, camera);
    listeners.frame.forEach(f => f(dt, now));
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  const g = {
    THREE, map, source, scene, camera, renderer, canvas, world, player, controls, on,
    resize,
    stop() {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      if (player) player.stop(); if (clickToLock) canvas.removeEventListener('click', clickToLock);
      try { world.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
  return g;
}
