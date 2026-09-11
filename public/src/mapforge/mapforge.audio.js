/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.audio.js — positional sound for Athena worlds (three.js WebAudio).

   One AudioListener rides on the active camera; a Sound emitter component
   (objects[].bp.comps: { type: 'sound', s, vol, dist, loop, auto }) becomes
   a THREE.PositionalAudio child of the object's root, so it pans and fades
   with distance as the player walks; the graph's Play sound node fires a
   one-shot at an actor, at the player, or in 2D (UI-style). Buffers are
   decoded once per URL and shared.

   Sounds are URLs of files the game already ships under /assets/Audio (or
   any CORS host) — nothing is uploaded, per the repo rule. The map keeps a
   `sounds` list ({ id, label, url }) exactly like `assets` does for models.

   Browsers gate audio behind a user gesture: the context is resumed on the
   first pointer/key event on the page, so a Begin Play sound in a game the
   player opened by clicking simply works, and the editor's Play (a key
   press) counts too. Runs only while playing; stop() silences everything. */

const buffers = new Map();   // url → Promise<AudioBuffer>
let unlocked = false;

export function createAudio(THREE) {
  const listener = new THREE.AudioListener();
  let camera = null, loader = null, running = false;
  const live = new Set();      // every THREE.Audio / PositionalAudio we created

  function unlock() {
    if (unlocked) return;
    const ctx = listener.context; if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    unlocked = true;
  }
  try { ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, unlock, { once: true, capture: true })); } catch (e) {}

  function load(url) {
    if (!buffers.has(url)) {
      if (!loader) loader = new THREE.AudioLoader();
      const p = new Promise((res, rej) => loader.load(url, res, undefined, rej));
      p.catch(() => buffers.delete(url));
      buffers.set(url, p);
    }
    return buffers.get(url);
  }
  function attach(cam) { if (camera === cam) return; if (camera) camera.remove(listener); camera = cam; if (camera) camera.add(listener); }
  /* an emitter on an Object3D (positional) or none (2D) */
  async function play(url, opts) {
    opts = opts || {};
    if (!running || !url) return null;
    let buf; try { buf = await load(url); } catch (e) { try { console.warn('[mapforge] sound failed', url, e && e.message); } catch (x) {} return null; }
    if (!running) return null;
    const snd = opts.root ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener);
    snd.setBuffer(buf); snd.setLoop(!!opts.loop); snd.setVolume(opts.vol == null ? 1 : Math.max(0, Math.min(2, opts.vol)));
    if (opts.root) { snd.setRefDistance(Math.max(0.5, opts.dist || 10)); snd.setRolloffFactor(1.5); snd.setDistanceModel('inverse'); opts.root.add(snd); }
    snd.userData = { url, tag: opts.tag || null };
    try { snd.play(); } catch (e) {}
    live.add(snd);
    if (!opts.loop) { const dur = (buf.duration || 1) * 1000 + 200; setTimeout(() => stopOne(snd), dur / Math.max(0.1, snd.playbackRate || 1)); }
    return snd;
  }
  function stopOne(snd) { if (!live.has(snd)) return; try { if (snd.isPlaying) snd.stop(); } catch (e) {} try { if (snd.parent) snd.parent.remove(snd); } catch (e) {} live.delete(snd); }
  function stopWhere(pred) { Array.from(live).forEach(s => { if (pred(s)) stopOne(s); }); }
  return {
    listener, load, attach, play, stopOne, stopWhere,
    get camera() { return camera; }, get running() { return running; }, get count() { return live.size; },
    start() { running = true; },
    stop() { running = false; Array.from(live).forEach(stopOne); },
    unlock,
    dispose() { this.stop(); if (camera) camera.remove(listener); camera = null; },
  };
}
