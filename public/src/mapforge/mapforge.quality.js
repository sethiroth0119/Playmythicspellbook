/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.quality.js — the quality ladder, one place for every knob that
   trades looks for frame rate: pixel ratio, shadows and their map size,
   particle effects and how far away they still run.

   'auto' (the default) starts at high and steps DOWN while the measured
   frame rate stays under 28 fps for a few seconds — never up, so a laptop
   that dipped once does not flicker between levels. The choice is remembered
   per device (mf_quality). Nothing here touches the document: a map looks
   the same on every level, only cheaper.
   ═══════════════════════════════════════════════════════════════════════════ */

export const LEVELS = {
  low:    { pixelRatio: 1,   shadows: false, shadowMap: 1024, fx: false, fxRange: 40,  label: 'Low' },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMap: 1024, fx: true,  fxRange: 80,  label: 'Medium' },
  high:   { pixelRatio: 2,   shadows: true,  shadowMap: 2048, fx: true,  fxRange: 160, label: 'High' },
};
export const ORDER = ['low', 'medium', 'high'];
const KEY = 'mf_quality';
let pref = 'auto', current = 'high';
try { const v = localStorage.getItem(KEY); if (v === 'auto' || LEVELS[v]) pref = v; } catch (e) {}
current = pref === 'auto' ? 'high' : pref;
const listeners = [];

export function get() { return { pref, level: current, settings: LEVELS[current] }; }
export function set(v) {
  if (v !== 'auto' && !LEVELS[v]) return get();
  pref = v; current = v === 'auto' ? 'high' : v;
  try { localStorage.setItem(KEY, v); } catch (e) {}
  listeners.forEach(fn => { try { fn(get()); } catch (e) {} });
  return get();
}
export function onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

/* apply to a renderer + world pair; safe to call repeatedly */
export function apply(renderer, world, level) {
  const s = LEVELS[level || current]; if (!s) return;
  try { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio)); } catch (e) {}
  try { if (renderer.shadowMap.enabled !== s.shadows) { renderer.shadowMap.enabled = s.shadows; renderer.shadowMap.needsUpdate = true; } } catch (e) {}
  if (world) { try { world.setShadowMapSize(s.shadowMap); world.setFxEnabled(s.fx); world.setFxRange(s.fxRange); world.setShadows(s.shadows); } catch (e) {} }
  // a changed pixel ratio needs a resize to take effect — callers that own the size call it
}

/* auto-tune: feed it frame times; it steps the level down when the average
   over `windowSecs` is under `minFps`, at most once per `cooldownSecs`. */
export function createTuner(opts) {
  opts = Object.assign({ minFps: 28, windowSecs: 3, cooldownSecs: 8 }, opts || {});
  let acc = 0, frames = 0, cooldown = 4;   // the first seconds after a mount load assets — ignore them
  return {
    frame(dt) {
      if (pref !== 'auto') return null;
      if (cooldown > 0) { cooldown -= dt; return null; }
      acc += dt; frames++;
      if (acc < opts.windowSecs) return null;
      const fps = frames / acc; acc = 0; frames = 0;
      if (fps < opts.minFps) { const i = ORDER.indexOf(current); if (i > 0) { current = ORDER[i - 1]; cooldown = opts.cooldownSecs; listeners.forEach(fn => { try { fn(get()); } catch (e) {} }); return current; } }
      return null;
    },
    reset() { acc = 0; frames = 0; cooldown = 4; },
  };
}
