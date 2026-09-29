/* =====================================================================
 * 🔌 COMBAT CINEMATIC ⇄ GAME INTEGRATION
 * =====================================================================
 * Watches for the "X used Y!" attack overlay (#battle-anim-backdrop),
 * hides its DOM sprite slots + damage label, and plays the GPU cinematic
 * inside .battle-anim-stage using the snap already sitting on
 * App.ui.battleAnim. Banner, HP bars, and stat chips stay DOM.
 *
 * Install once at boot:
 *   import installCombatCinematic from './combat-cinematic-integration.js';
 *   installCombatCinematic();
 *
 * Add this CSS once:
 *   .battle-anim-backdrop.three-cine-on .battle-anim-sprite,
 *   .battle-anim-backdrop.three-cine-on .battle-anim-fx { visibility: hidden; }
 * ===================================================================== */

import CombatCinematic from './combat-cinematic.js?v=118i5';

const g = (n) => (typeof window !== 'undefined' ? window[n] : undefined);

/* Frame resolver — same brains as the DOM path, minus the race:
 *  1. the game's getSpriteFrames (h_/u_ sibling logic included)
 *  2. Kalon k_ id → base unit fallback (mirrors spriteHtml)
 *  3. force the lazy disk load and retry — this is why slots can't be empty
 *  4. idle only: single-frame card-art fallback so there's ALWAYS a fighter */
function makeResolver(unitSnap) {
  return async (spriteId, anim) => {
    const getFrames = g('getSpriteFrames');
    const grab = (id) => {
      try { const f = getFrames && getFrames(id, anim); return f && f.length ? f : null; } catch (e) { return null; }
    };
    let f = grab(spriteId);
    if (!f && String(spriteId).indexOf('k_') === 0 && unitSnap) {
      f = grab('u_' + (unitSnap.originalCardId || unitSnap.cardId || ''));
    }
    if (!f) {
      const lazy = g('_lazyLoadSprite');
      if (typeof lazy === 'function') {
        try { await Promise.resolve(lazy(spriteId, true)); } catch (e) {}
        f = grab(spriteId);
      }
    }
    if (!f && anim === 'idle' && unitSnap) {
      // static card art as a one-frame "animation" — never a blank slot
      const getArt = g('getCardArt');
      if (typeof getArt === 'function') {
        const cid = unitSnap.cardId || unitSnap.originalCardId || '';
        const art = getArt(cid)
          || (unitSnap.heroId ? (getArt(unitSnap.heroId) || getArt('h_' + unitSnap.heroId)) : null)
          || getArt('u_' + cid);
        if (typeof art === 'string' && art) return [art];
      }
    }
    return f;
  };
}

export function installCombatCinematic(options) {
  const opts = options || {};
  let active = null;         // current CombatCinematic instance (live handle)
  let activeFor = 0;         // snap.startedAt we're playing
  let wrapEl = null;         // our own mount wrapper — survives overlay rebuilds
  let gpuLive = false;       // true once the GPU has rendered its first frame

  const cleanup = () => {
    try { if (active) active.dispose(); } catch (e) {}
    try { if (wrapEl) wrapEl.remove(); } catch (e) {}
    active = null; wrapEl = null; activeFor = 0; gpuLive = false;
  };

  const tryPlay = () => {
    const App = g('App');
    const snap = App && App.ui && App.ui.battleAnim;
    const back = document.getElementById('battle-anim-backdrop');
    if (!snap || !back) {
      // Overlay closed — NOW the cinematic ends (it holds its last frame until
      // this moment, so fighters never vanish before the overlay does).
      if (active || wrapEl) cleanup();
      return;
    }
    if (activeFor === snap.startedAt) {
      // 🩹 SAME attack, but renderBattle() rebuilt the overlay's DOM (HP ticks,
      // log lines — happens many times per attack). The rebuild threw away our
      // canvas' parent and the hide-DOM class, so the DOM sprites popped back
      // in over the GPU ones — THE flicker. Re-adopt: re-hide the DOM sprites
      // and re-parent our live wrapper into the fresh stage. The engine keeps
      // rendering the whole time; nothing restarts.
      try {
        if (wrapEl) {
          // Hide the DOM sprites only once the GPU is actually painting.
          if (gpuLive && !back.classList.contains('three-cine-on')) back.classList.add('three-cine-on');
          const st = back.querySelector('.battle-anim-stage') || back;
          if (getComputedStyle(st).position === 'static') st.style.position = 'relative';
          if (wrapEl.parentElement !== st) st.appendChild(wrapEl);
        }
      } catch (e) {}
      return;
    }
    if (active || wrapEl) cleanup();            // a NEW attack replaces the old one
    activeFor = snap.startedAt;

    const stage = back.querySelector('.battle-anim-stage') || back;
    const cs = getComputedStyle(stage);
    if (cs.position === 'static') stage.style.position = 'relative';

    const getId = g('getSpriteId');
    const atkId = typeof getId === 'function' ? getId(snap.attacker) : null;
    const defId = typeof getId === 'function' ? getId(snap.defender) : null;
    if (!atkId && !defId) return;  // pure-emoji matchup → leave the DOM path alone
    // NOTE: the DOM sprites are NOT hidden yet — they stay visible while the
    // GPU decodes/inits and are swapped out in onFirstFrame below, so there is
    // never a blank stage ("fighters appear late") at the start of an attack.
    // Mount into OUR wrapper (not the stage directly) so an overlay rebuild
    // can't destroy the canvas — we just re-parent the wrapper (above).
    wrapEl = document.createElement('div');
    wrapEl.className = 'three-cine-wrap';
    Object.assign(wrapEl.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    stage.appendChild(wrapEl);

    let elemColor = '#f5c453';
    try {
      const ED = g('ELEMENT_DATA');
      const e = snap.move && snap.move.element;
      if (ED && ED[e] && ED[e].color) elemColor = ED[e].color;
    } catch (e) {}

    const resolveFps = (sid, anim) => {
      const fn = g('getSpriteAnimFps');
      try { return typeof fn === 'function' ? fn(sid, anim) : null; } catch (e) { return null; }
    };

    const dur = g('BATTLE_ANIM_DURATION') || 2600;
    CombatCinematic.play({
      mount: wrapEl,
      attackerSpriteId: atkId || 'none',
      defenderSpriteId: defId || 'none',
      resolveFrames: (sid, anim) =>
        (sid === atkId ? makeResolver(snap.attacker) : makeResolver(snap.defender))(sid, anim),
      resolveFps,
      attackerIsPlayer: snap.attacker.owner === 'player',
      elementColor,
      dmg: snap.dmg || 0,
      crit: !!snap.crit,
      missed: !!snap.missed,
      killed: (snap.newDefHp || 0) <= 0,
      durationMs: Math.max(1600, dur - 150),
      // 🩹 Keep rendering the final frame until WE dispose (when the overlay
      // actually closes) — self-disposing at duration end removed the fighters
      // ~150ms early over hidden DOM sprites = the end-of-attack pop-out.
      holdUntilDispose: true,
      // 🩹 Single clean swap: hide the DOM sprites only once the GPU has
      // painted its first frame (cached fighters = effectively instant).
      onFirstFrame: () => {
        gpuLive = true;
        try {
          if (activeFor !== snap.startedAt) return;
          const b = document.getElementById('battle-anim-backdrop');
          if (b) b.classList.add('three-cine-on');
        } catch (e) {}
      },
      forceWebGL: !!opts.forceWebGL,
    }).catch(() => {
        // 🩹 GPU init/play failed (no WebGPU/WebGL2, OOM, …) — unhide the DOM
        // sprites so the player still sees the classic cinematic, not a blank.
        try { const b = document.getElementById('battle-anim-backdrop'); if (b) b.classList.remove('three-cine-on'); } catch (e) {}
        cleanup();
      });
    // play() sets CombatCinematic.current synchronously (before its first
    // await) — capture the live handle so overlay-close can dispose it.
    try { active = CombatCinematic.current; } catch (e) { active = null; }
  };

  // The overlay is injected by renderBattle()'s innerHTML swap — watch for it.
  const mo = new MutationObserver(tryPlay);
  mo.observe(document.body, { childList: true, subtree: true });
  tryPlay();

  try {
    window.__mg = window.__mg || {};
    window.__mg.combatCine = { uninstall: () => {
      mo.disconnect();
      try { const b = document.getElementById('battle-anim-backdrop'); if (b) b.classList.remove('three-cine-on'); } catch (e) {}
      cleanup();
    } };
  } catch (e) {}
  return true;
}

export default installCombatCinematic;
