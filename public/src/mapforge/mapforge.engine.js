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
import { createAvatar, resolveCharacter } from './mapforge.avatar.js';
import { avatarPick } from './mapforge.bridge.js';
import * as quality from './mapforge.quality.js';
import { createPost } from './mapforge.post.js';
const TONE = { aces: 'ACESFilmicToneMapping', linear: 'LinearToneMapping', reinhard: 'ReinhardToneMapping' };
export function applyTone(THREE, renderer, env) { renderer.toneMapping = THREE[TONE[env.tone] || 'ACESFilmicToneMapping'] || THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = env.exposure == null ? 1 : env.exposure; }
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
  const Q = quality.get().settings;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Math.min(opts.maxPixelRatio || 2, Q.pixelRatio)));
  renderer.shadowMap.enabled = opts.shadows !== false && Q.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement; canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.tabIndex = 0;
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov || 60, 1, 0.1, 3000);
  /* instancing is on for games (draw calls, not picking, are what matter here); quality knobs follow the ladder and auto-tune */
  const post = createPost(THREE, renderer);
  const world = buildWorld(THREE, map, { scene, camera, markers: !!opts.markers, gltfLoader: opts.gltfLoader, onLightning: opts.onLightning, toast: opts.toast, onPrompt: opts.onPrompt, actions: opts.actions, instancing: opts.instancing !== false, shadows: opts.shadows !== false && Q.shadows, shadowMap: Q.shadowMap, fx: Q.fx, fxRange: Q.fxRange, onEnv: (env) => applyTone(THREE, renderer, env) });
  const tuner = quality.createTuner(opts.tuner);
  const offQ = quality.onChange(q => { quality.apply(renderer, world, q.level); resize(); });
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
  /* 🎥 the map's own point of view and character (map.player) — opts.view
     overrides for a game that insists. 'fps' mode means "walk it"; which
     camera that walk uses is the map's call. */
  const pv = map.player || { view: 'fps' };
  const view = opts.view || pv.view || 'fps';
  let avatar = null;
  /* 🧍 The character THIS player chose, if the map offers it, else the map
        author's own default — resolveCharacter() owns that reconciliation and
        is the same call the hub uses to draw everybody else. */
  const myModel = resolveCharacter(pv, avatarPick());
  if (mode === 'fps' && myModel) { try { avatar = createAvatar(THREE, { world, scene, player: { model: myModel, anim: pv.anim || {}, animFiles: pv.animFiles || [] } }); } catch (e) { avatar = null; } }
  let player = null, controls = null, clickToLock = null, gesture = null;
  // 🔊 sound markers: listener on the camera; audio starts on the first gesture
  if (opts.audio !== false && world.attachAudio(camera)) {
    gesture = () => { try { world.startAudio(); } catch (e) {} canvas.removeEventListener('pointerdown', gesture); window.removeEventListener('keydown', gesture, true); gesture = null; };
    canvas.addEventListener('pointerdown', gesture); window.addEventListener('keydown', gesture, true);
  }
  if (mode === 'fps') {
    player = createPlayer(THREE, { world, camera, dom: canvas, pointerLock: opts.pointerLock !== false && view !== 'top', onUnlock: opts.onUnlock, onFrame: opts.onPlayerFrame, eye: opts.eye, speed: opts.speed, view, avatar });
    player.start(opts.spawn);
    // requestPointerLock returns a promise in current browsers; a refusal (the
    // canvas already torn out of the document, a click during teardown) is a
    // rejection, not a throw, and an unhandled one trips the page's crashguard.
    if (opts.pointerLock !== false && view !== 'top') { clickToLock = () => { try { Promise.resolve(canvas.requestPointerLock()).catch(() => {}); } catch (e) {} }; canvas.addEventListener('click', clickToLock); }
  } else if (mode === 'orbit') {
    const size = world.terrain.size;
    camera.position.set(size * 0.55, size * 0.4, size * 0.55);
    if (THREE.OrbitControls) { controls = new THREE.OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.target.set(0, 0, 0); controls.update(); }
    else camera.lookAt(0, 0, 0);
  }

  // ⚡ actor blueprints run for the life of the mount; E (or opts.interactKey) is the interact key
  const onInteract = (e) => { if ((e.key || '').toLowerCase() === (opts.interactKey || 'e')) world.interact(); };
  window.addEventListener('keydown', onInteract);
  world.startPlay(player ? { get pos() { return player.pos; }, setPos: (x, z) => { player.pos.x = x; player.pos.z = z; player.pos.y = world.heightAt(x, z); } } : null);
  let raf = 0, last = performance.now(), running = true;
  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    tuner.frame(dt);
    if (player) player.frame(dt);
    if (controls) controls.update();
    world.update(dt, camera);
    listeners.frame.forEach(f => f(dt, now));
    post.enabled = quality.get().settings.post !== false && opts.post !== false;
    post.render(scene, camera, map.env);
  }
  raf = requestAnimationFrame(loop);

  const g = {
    THREE, map, source, scene, camera, renderer, canvas, world, player, controls, on, view, avatar, quality, post,
    resize,
    stop() {
      running = false; cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('keydown', onInteract); offQ(); try { world.stopPlay(); } catch (e) {}
      if (player) player.stop(); if (clickToLock) canvas.removeEventListener('click', clickToLock);
      if (avatar) { try { avatar.dispose(); } catch (e) {} }
      if (gesture) { canvas.removeEventListener('pointerdown', gesture); window.removeEventListener('keydown', gesture, true); }
      try { post.dispose(); world.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
  return g;
}
