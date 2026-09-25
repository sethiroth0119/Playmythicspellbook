/* =====================================================================
 * 🔌 SPRITE ENGINE ⇄ GAME INTEGRATION (overlay mode)
 * =====================================================================
 *
 * Drops the three.js/WebGPU sprite layer ON TOP of the existing DOM
 * board — the same "hybrid port" idea the Pixi mount stub used, but
 * safer: tiles, click handling, HP bars, status icons, targeting
 * highlights all stay exactly as they are in the DOM. Only the animated
 * unit art moves to the GPU.
 *
 * HOW IT PLUGS IN (all of these already exist in index.html):
 *   getSpriteId(unit)                 → which sprite record a unit uses
 *   getSpriteFrames(spriteId, anim)   → frame URL list (data:/blob:/http)
 *   getSpriteAnimFps(spriteId, anim)  → per-animation speed override
 *   DEFAULT_SPRITE_FRAME_MS           → fallback cadence
 *   App.state.units / .tile[data-x][data-y] → positions
 *
 * USAGE
 * -----
 *   1. Load three.js via an import map (see README / demo.html).
 *   2. <script type="module"> import { installThreeSprites } from './sprite-engine-integration.js';
 *      installThreeSprites(); </script>
 *   3. Set App.flags.threeSprites = true and re-render the battle.
 *
 * The adapter re-syncs after every board render (MutationObserver on the
 * board container) and keeps positions pixel-locked to the DOM tiles via
 * getBoundingClientRect — so it lines up even under the iso-mode CSS 3D
 * transform.
 *
 * CINEMATICS: window.__mg.boardCine is wrapped, so every existing call
 * site (`_boardSpriteCine(unitId, 'attack', ms)` etc.) drives the GPU
 * sprites with zero further changes.
 * ===================================================================== */

import SpriteEngine from './sprite-engine.js';

const g = (name) => (typeof window !== 'undefined' ? window[name] : undefined);

export async function installThreeSprites(options) {
  const opts = options || {};
  const state = {
    engine: null,
    mount: null,
    board: null,
    mo: null,
    rafSync: 0,
    installed: false,
  };

  /* ---- frame resolution: reuse the game's own resolver ---------------- */
  const resolveFrames = async (spriteId, anim) => {
    const fn = g('getSpriteFrames');
    if (typeof fn !== 'function') return null;
    let frames = null;
    try { frames = fn(spriteId, anim); } catch (e) {}
    if (frames && frames.length) return frames;
    // not resident — force a disk read (the game's lazy loader), then retry
    const lazy = g('_lazyLoadSprite');
    if (typeof lazy === 'function') {
      try { await Promise.resolve(lazy(spriteId, true)); } catch (e) {}
      try { frames = fn(spriteId, anim); } catch (e) {}
    }
    return frames && frames.length ? frames : null;
  };

  const resolveFps = (spriteId, anim) => {
    const fn = g('getSpriteAnimFps');
    try { return typeof fn === 'function' ? fn(spriteId, anim) : null; } catch (e) { return null; }
  };

  /* ---- mount over the board ------------------------------------------- */
  function ensureMount() {
    const board = document.querySelector('.board');
    if (!board) return false;
    if (state.board === board && state.mount && state.mount.isConnected) return true;
    state.board = board;
    // the overlay parents to the board so it inherits the iso transform's
    // on-screen footprint; position sprites in board-local pixels
    let mount = board.querySelector(':scope > .three-sprite-overlay');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'three-sprite-overlay';
      Object.assign(mount.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '30',
      });
      const cs = getComputedStyle(board);
      if (cs.position === 'static') board.style.position = 'relative';
      board.appendChild(mount);
    }
    state.mount = mount;
    board.classList.add('three-sprites-on'); // CSS hides the DOM sprite imgs
    return true;
  }

  /* ---- unit list → engine sync ---------------------------------------- */
  function unitDefs() {
    const App = g('App');
    const getId = g('getSpriteId');
    if (!App || !App.state || !App.state.units || typeof getId !== 'function') return [];
    const boardRect = state.board.getBoundingClientRect();
    const out = [];
    for (const u of App.state.units) {
      if (!u || !u.alive || !u.pos) continue;
      if (u.isFaceDown) continue;                        // subterfuge stays DOM
      const spriteId = getId(u);
      if (!spriteId) continue;                           // emoji-only → DOM fallback
      const tile = state.board.querySelector(
        '.tile[data-x="' + (u.pos.x | 0) + '"][data-y="' + (u.pos.y | 0) + '"]');
      if (!tile) continue;
      const r = tile.getBoundingClientRect();
      // bottom-center of the tile, board-local CSS pixels
      const x = (r.left + r.right) / 2 - boardRect.left;
      const y = r.bottom - boardRect.top - r.height * 0.06;
      const h = r.height * (u.isHero ? 1.45 : 1.25);     // sprites rise above the tile
      out.push({
        id: u.id, spriteId,
        x, y, h,
        facing: u.owner === 'player' ? 1 : -1,           // enemies mirrored
        elevation: u.isFlying ? r.height * 0.18 : 0,
      });
    }
    return out;
  }

  function syncNow() {
    if (!state.engine || !ensureMount()) return;
    try { state.engine.sync(unitDefs()); } catch (e) {}
  }

  function scheduleSync() {
    if (state.rafSync) return;
    state.rafSync = requestAnimationFrame(() => { state.rafSync = 0; syncNow(); });
  }

  /* ---- boot ------------------------------------------------------------ */
  if (!ensureMount()) {
    // no battle on screen yet — retry on the next board render
    const wait = new MutationObserver(() => {
      if (document.querySelector('.board')) { wait.disconnect(); installThreeSprites(options); }
    });
    wait.observe(document.body, { childList: true, subtree: true });
    return null;
  }

  state.engine = await SpriteEngine.create({
    mount: state.mount,
    mode: 'overlay',
    resolveFrames,
    resolveFps,
    defaultFrameMs: g('DEFAULT_SPRITE_FRAME_MS') || 62,
    forceWebGL: !!opts.forceWebGL,
    onBackend: (b) => { try { (console.info || console.log || function(){}).call(console, '[sprites] backend:', b); } catch (e) {} },
  });

  // Re-sync whenever the game re-renders the board (innerHTML swaps).
  state.mo = new MutationObserver(scheduleSync);
  state.mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleSync);
  syncNow();

  /* ---- wrap the cinematic hook so existing call sites just work -------- */
  try {
    window.__mg = window.__mg || {};
    const prevCine = window.__mg.boardCine;
    window.__mg.boardCine = (unitId, anim, durationMs) => {
      let handled = false;
      try {
        if (state.engine && state.engine.units.has(unitId)) {
          if (anim === 'death') state.engine.removeUnit(unitId, { death: true });
          else state.engine.play(unitId, anim, { durationMs });
          if (anim === 'hurt') state.engine.flash(unitId, 0xff5252, 160);
          handled = true;
        }
      } catch (e) {}
      if (!handled && typeof prevCine === 'function') { try { prevCine(unitId, anim, durationMs); } catch (e) {} }
    };
    window.__mg.threeSprites = {
      engine: state.engine,
      sync: syncNow,
      stats: () => state.engine.stats(),
      uninstall: () => {
        try { state.mo && state.mo.disconnect(); } catch (e) {}
        try { window.removeEventListener('resize', scheduleSync); } catch (e) {}
        try { state.board && state.board.classList.remove('three-sprites-on'); } catch (e) {}
        try { state.engine && state.engine.dispose(); } catch (e) {}
        try { state.mount && state.mount.remove(); } catch (e) {}
        window.__mg.boardCine = prevCine;
      },
    };
  } catch (e) {}

  state.installed = true;
  return state.engine;
}

/* ---------------------------------------------------------------------
 * CSS to add once (hides the old DOM sprite <img>s while the GPU layer
 * is on — everything else on the tile keeps rendering):
 *
 *   .board.three-sprites-on .unit .unit-icon .sprite-stack { visibility: hidden; }
 *
 * ------------------------------------------------------------------- */

export default installThreeSprites;
