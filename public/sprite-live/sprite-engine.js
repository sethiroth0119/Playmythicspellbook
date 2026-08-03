/* =====================================================================
 * ⚔️ SPRITE ENGINE — three.js / WebGPU battlefield sprite renderer
 * =====================================================================
 *
 * WHAT THIS REPLACES
 * ------------------
 * The old system animated units by swapping <img src> on a 33ms interval.
 * Every swap = a fresh image decode = the whole blob-URL LRU / pin /
 * revoke / onerror-self-heal machinery, and still stuttered at the loop
 * boundary.
 *
 * THE NEW MODEL
 * -------------
 *  1. Each sprite id's animation frames are decoded ONCE (createImageBitmap)
 *     and packed into a single GPU texture atlas.
 *  2. Every unit is a textured quad. Animating = moving the quad's UV
 *     window over the atlas. Zero decodes per frame. Zero DOM churn.
 *  3. One requestAnimationFrame loop drives everything; per-anim FPS,
 *     clock-anchored idle loops (with a per-id phase so units aren't in
 *     lockstep — same trick the old ticker used), one-shot cinematics
 *     (attack / hurt / death / summon) that settle back to idle.
 *
 * RENDERER
 * --------
 * three.js WebGPURenderer. On browsers without WebGPU it transparently
 * falls back to WebGL2 inside renderer.init() — same API, same code path.
 *
 * TWO MOUNT MODES
 * ---------------
 *  'overlay' — orthographic screen-space camera measured in CSS pixels.
 *              Meant to sit on top of the existing DOM board: the host
 *              reads each tile's getBoundingClientRect() and feeds the
 *              engine screen coordinates. Game logic / clicks / HP bars
 *              stay in the DOM, only the sprites move to the GPU.
 *  'world'   — a tilted perspective camera + ground grid, for a full
 *              3D battlefield (the demo uses this).
 *
 * PUBLIC API (all methods safe to call before atlases finish loading)
 * ------------------------------------------------------------------
 *   const engine = await SpriteEngine.create(opts)
 *   engine.upsertUnit({ id, spriteId, x, y, w, h, facing, elevation })
 *   engine.moveUnit(id, x, y, ms)          // tweened glide between tiles
 *   engine.play(id, anim, opts)            // one-shot cine → back to idle
 *   engine.setAnim(id, anim)               // hard-set the looping anim
 *   engine.removeUnit(id, opts)            // opts.death plays death first
 *   engine.sync(units)                     // bulk reconcile (add/update/remove)
 *   engine.flash(id, color, ms)            // hit-flash tint
 *   engine.releaseSprite(spriteId)         // free a sprite's atlas (GPU + RAM)
 *   engine.stats()
 *   engine.dispose()
 *
 * The engine never touches the host's storage. It pulls frames through
 * the injected `resolveFrames(spriteId, anim) -> Promise<string[]|null>`
 * so it plugs straight into an existing getSpriteFrames().
 * ===================================================================== */

import * as THREE from 'three';

const DEFAULT_FRAME_MS = 62;            // ≈16fps — matches DEFAULT_SPRITE_FRAME_MS
const ANIMS = ['idle', 'attack', 'hurt', 'death', 'summon', 'walk'];
const ONE_SHOT_HOLD_LAST = new Set(['death']);   // death freezes on its last frame
const MAX_ATLAS_DIM = 4096;             // safe on every WebGPU/WebGL2 device

/* ---------------------------------------------------------------------
 * Stable 0..1 phase per sprite id — keeps idle loops out of lockstep and
 * survives re-syncs (the frame index is a pure function of the clock, so
 * rebuilding a unit never restarts its idle animation).
 * ------------------------------------------------------------------- */
function phaseOf(id) {
  let h = 0; const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

/* ---------------------------------------------------------------------
 * ATLAS — one per spriteId. All animations for the sprite share a single
 * texture; each animation owns a run of equally-sized cells inside it.
 * ------------------------------------------------------------------- */
export class SpriteAtlas {
  constructor(spriteId) {
    this.spriteId = spriteId;
    this.texture = null;          // THREE.CanvasTexture (uploaded once)
    this.anims = new Map();       // anim -> { start, count }
    this.cellW = 0; this.cellH = 0;
    this.cols = 0; this.rows = 0;
    this.aspect = 1;              // cellW / cellH — hosts can size quads with it
    this.ready = false;
    this.failed = false;
    this._promise = null;
  }

  /** Decode every frame of every animation once and pack into one canvas. */
  async build(resolveFrames) {
    // 1) Resolve + decode ---------------------------------------------------
    const sets = [];   // [{ anim, bitmaps: ImageBitmap[] }]
    for (const anim of ANIMS) {
      let urls = null;
      try { urls = await resolveFrames(this.spriteId, anim); } catch (e) { urls = null; }
      if (!urls || !urls.length) continue;
      // Skip anims that resolved to the exact same frame list as idle —
      // the host's getSpriteFrames falls back to idle for missing anims,
      // and duplicating those cells would bloat the atlas for nothing.
      if (anim !== 'idle') {
        const idle = sets.find(s => s.anim === 'idle');
        if (idle && idle.srcKey === urls.join('|')) continue;
      }
      const bitmaps = [];
      for (const u of urls) {
        if (typeof u !== 'string' || !u) continue;
        try {
          const resp = await fetch(u);
          const blob = await resp.blob();
          bitmaps.push(await createImageBitmap(blob));
        } catch (e) { /* skip unreadable frame — mirrors filter(Boolean) */ }
      }
      if (bitmaps.length) sets.push({ anim, bitmaps, srcKey: urls.join('|') });
    }
    if (!sets.length) { this.failed = true; return this; }

    // 2) Cell size = max frame dims, clamped so the atlas fits the GPU ------
    let cw = 1, ch = 1, total = 0;
    for (const s of sets) for (const b of s.bitmaps) { cw = Math.max(cw, b.width); ch = Math.max(ch, b.height); total += s.bitmaps.length; }
    let cols = Math.ceil(Math.sqrt(total));
    let rows = Math.ceil(total / cols);
    let scale = Math.min(1, MAX_ATLAS_DIM / (cols * cw), MAX_ATLAS_DIM / (rows * ch));
    cw = Math.max(1, Math.floor(cw * scale));
    ch = Math.max(1, Math.floor(ch * scale));

    // 3) Pack ---------------------------------------------------------------
    const canvas = document.createElement('canvas');
    canvas.width = cols * cw; canvas.height = rows * ch;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    let cell = 0;
    for (const s of sets) {
      const start = cell;
      for (const b of s.bitmaps) {
        const cx = (cell % cols) * cw, cy = Math.floor(cell / cols) * ch;
        // contain-fit each frame in its cell, centered on the baseline
        const fit = Math.min(cw / b.width, ch / b.height);
        const dw = b.width * fit, dh = b.height * fit;
        ctx.drawImage(b, cx + (cw - dw) / 2, cy + (ch - dh), dw, dh);
        try { b.close(); } catch (e) {}
        cell++;
      }
      this.anims.set(s.anim, { start, count: s.bitmaps.length });
    }

    // 4) Upload once --------------------------------------------------------
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // linear filtering — the old system's hard-won lesson: `pixelated`
    // garbles high-res frames; smooth scaling is what made sprites "clean".
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    this.texture = tex;
    this.cellW = cw; this.cellH = ch; this.cols = cols; this.rows = rows;
    this.aspect = cw / ch;
    this.ready = true;
    return this;
  }

  /** Set a texture clone's UV window to a given animation frame. */
  applyFrame(tex, anim, frameIdx, flipX) {
    const a = this.anims.get(anim) || this.anims.get('idle');
    if (!a) return;
    const i = a.start + (((frameIdx % a.count) + a.count) % a.count);
    const cx = i % this.cols, cy = Math.floor(i / this.cols);
    const uw = this.cellW / (this.cols * this.cellW);
    const vh = this.cellH / (this.rows * this.cellH);
    // three.js UV origin is bottom-left; canvas rows count from the top.
    const u0 = cx * uw;
    const v0 = 1 - (cy + 1) * vh;
    if (flipX) { tex.offset.set(u0 + uw, v0); tex.repeat.set(-uw, vh); }
    else       { tex.offset.set(u0, v0);      tex.repeat.set(uw, vh); }
  }

  frameCount(anim) {
    const a = this.anims.get(anim) || this.anims.get('idle');
    return a ? a.count : 0;
  }

  has(anim) { return this.anims.has(anim); }

  dispose() {
    try { if (this.texture) this.texture.dispose(); } catch (e) {}
    this.texture = null;
    this.anims.clear();
    this.ready = false;
  }
}

/* ---------------------------------------------------------------------
 * UNIT — one billboard quad + animation state machine.
 * ------------------------------------------------------------------- */
class UnitActor {
  constructor(id, spriteId) {
    this.id = id;
    this.spriteId = spriteId;
    this.mesh = null;             // built once its atlas is ready
    this.tex = null;              // per-unit texture clone (shares GPU Source)
    this.mat = null;

    // logical placement (host units: tile coords in world mode,
    // CSS pixels in overlay mode) + tween state for gliding moves
    this.x = 0; this.y = 0; this.w = 1; this.h = 1;
    this.elevation = 0;           // flying units hover
    this.facing = 1;              // 1 = art as authored, -1 = mirrored
    this._from = null;            // {x,y,t0,t1} while tweening

    // animation state
    this.anim = 'idle';
    this.loop = true;
    this._oneShot = null;         // { anim, t0, frameMs, holdLast, resolve }
    this._lastFrame = -1;
    this._flash = null;           // { color:THREE.Color, until }
    this._dead = false;
    this.phase = phaseOf(spriteId || id);
  }
}

/* ---------------------------------------------------------------------
 * ENGINE
 * ------------------------------------------------------------------- */
export class SpriteEngine {
  /**
   * @param {Object}   opts
   * @param {Element}  opts.mount           container the canvas is appended to
   * @param {'overlay'|'world'} [opts.mode='world']
   * @param {Function} opts.resolveFrames   (spriteId, anim) => Promise<string[]|null>
   * @param {Function} [opts.resolveFps]    (spriteId, anim) => fps|null
   * @param {number}   [opts.defaultFrameMs=62]
   * @param {number}   [opts.gridW=8]       world mode: board columns
   * @param {number}   [opts.gridH=7]       world mode: board rows
   * @param {boolean}  [opts.forceWebGL=false]
   * @param {Function} [opts.onBackend]     called with 'webgpu' | 'webgl2'
   */
  static async create(opts) {
    const e = new SpriteEngine(opts);
    await e._init();
    return e;
  }

  constructor(opts) {
    this.opts = Object.assign({
      mode: 'world', defaultFrameMs: DEFAULT_FRAME_MS,
      gridW: 8, gridH: 7, forceWebGL: false,
    }, opts || {});
    if (typeof this.opts.resolveFrames !== 'function') {
      throw new Error('SpriteEngine: opts.resolveFrames(spriteId, anim) is required');
    }
    this.units = new Map();       // id -> UnitActor
    this.atlases = new Map();     // spriteId -> SpriteAtlas
    this.backend = 'none';
    this._raf = 0;
    this._disposed = false;
    this._running = false;
  }

  async _init() {
    const { mount, mode, forceWebGL } = this.opts;
    this.renderer = new THREE.WebGPURenderer({
      antialias: true, alpha: true, forceWebGL: !!forceWebGL,
    });
    // init() negotiates the backend — WebGPU where available, else WebGL2.
    await this.renderer.init();
    this.backend = this.renderer.backend && this.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    if (typeof this.opts.onBackend === 'function') { try { this.opts.onBackend(this.backend); } catch (e) {} }

    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    if (mode === 'overlay') {
      // sits over the DOM board; the DOM keeps all pointer interaction
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.pointerEvents = 'none';
    }
    mount.appendChild(canvas);

    this.scene = new THREE.Scene();
    if (mode === 'overlay') {
      // Screen-space ortho: 1 unit = 1 CSS pixel, origin top-left, so the
      // host can feed tile getBoundingClientRect() coords directly.
      this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000);
    } else {
      this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
      this._buildWorldStage();
    }

    this._sizeToMount();
    this._ro = new ResizeObserver(() => this._sizeToMount());
    this._ro.observe(mount);

    this._onVis = () => { if (document.hidden) this._stop(); else this._start(); };
    document.addEventListener('visibilitychange', this._onVis);
    this._start();
  }

  /* ----- world-mode stage: tilted chess-board look ------------------- */
  _buildWorldStage() {
    const { gridW, gridH } = this.opts;
    // camera: low, pulled back, tilted ~ the 2.5D chess angle
    this.camera.position.set(gridW / 2 - 0.5, gridH * 1.05, gridH * 1.35);
    this.camera.lookAt(gridW / 2 - 0.5, 0.6, gridH / 2 - 0.9);

    const amb = new THREE.AmbientLight(0xffffff, 2.4);
    this.scene.add(amb);

    // ground plane + tile grid (subtle — hosts usually restyle this)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(gridW, gridH),
      new THREE.MeshBasicMaterial({ color: 0x14161f, transparent: true, opacity: 0.92 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(gridW / 2 - 0.5, -0.001, gridH / 2 - 0.5);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(Math.max(gridW, gridH), Math.max(gridW, gridH), 0x3a4056, 0x262b3d);
    grid.scale.set(gridW / Math.max(gridW, gridH), 1, gridH / Math.max(gridW, gridH));
    grid.position.set(gridW / 2 - 0.5, 0, gridH / 2 - 0.5);
    this.scene.add(grid);
  }

  _sizeToMount() {
    if (this._disposed) return;
    const m = this.opts.mount;
    const w = Math.max(1, m.clientWidth), h = Math.max(1, m.clientHeight);
    this.renderer.setSize(w, h, false);
    if (this.camera.isOrthographicCamera) {
      this.camera.left = 0; this.camera.right = w;
      this.camera.top = 0;  this.camera.bottom = h;
      this.camera.updateProjectionMatrix();
    } else {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /* =====================================================================
   * ATLAS LIFECYCLE
   * =================================================================== */
  _atlasFor(spriteId) {
    let a = this.atlases.get(spriteId);
    if (a) return a;
    a = new SpriteAtlas(spriteId);
    this.atlases.set(spriteId, a);
    a._promise = a.build(this.opts.resolveFrames).then(() => {
      if (this._disposed) { a.dispose(); return a; }
      if (a.ready) {
        // attach every unit that was waiting on this atlas
        for (const u of this.units.values()) {
          if (u.spriteId === spriteId && !u.mesh) this._attachMesh(u, a);
        }
      }
      return a;
    });
    return a;
  }

  /** Free a sprite's atlas (GPU texture + CPU canvas). Units using it go blank
   *  until the atlas is requested again — call after a battle, not during. */
  releaseSprite(spriteId) {
    const a = this.atlases.get(spriteId);
    if (!a) return;
    for (const u of this.units.values()) {
      if (u.spriteId === spriteId) this._detachMesh(u);
    }
    a.dispose();
    this.atlases.delete(spriteId);
  }

  /* =====================================================================
   * UNITS
   * =================================================================== */
  /**
   * Create or update a unit.
   * overlay mode: x,y = CSS px of the sprite's bottom-center; w,h = CSS px box.
   * world mode:   x,y = tile coords (float ok); w,h = size in tiles.
   */
  upsertUnit(def) {
    if (!def || def.id == null) return null;
    let u = this.units.get(def.id);
    if (!u) {
      u = new UnitActor(def.id, def.spriteId);
      this.units.set(def.id, u);
    }
    if (def.spriteId && def.spriteId !== u.spriteId) {
      // sprite swapped (e.g. Kalon transformation) — rebind to the new atlas
      this._detachMesh(u);
      u.spriteId = def.spriteId;
      u.phase = phaseOf(def.spriteId);
    }
    if (def.x != null) u.x = def.x;
    if (def.y != null) u.y = def.y;
    if (def.w != null) u.w = def.w;
    if (def.h != null) u.h = def.h;
    if (def.elevation != null) u.elevation = def.elevation;
    if (def.facing != null) u.facing = def.facing < 0 ? -1 : 1;

    const atlas = this._atlasFor(u.spriteId);
    if (atlas.ready && !u.mesh) this._attachMesh(u, atlas);
    return u;
  }

  _attachMesh(u, atlas) {
    if (!atlas.texture) return;
    // texture.clone() shares the underlying Source → ONE GPU upload per
    // atlas no matter how many units use it; each clone just carries its
    // own offset/repeat (the UV window = current frame).
    const tex = atlas.texture.clone();
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      alphaTest: 0.02, side: THREE.DoubleSide,
    });
    const geo = SpriteEngine._quadGeo || (SpriteEngine._quadGeo = (() => {
      // unit quad anchored at bottom-center — sprites "stand" on their tile
      const g = new THREE.PlaneGeometry(1, 1);
      g.translate(0, 0.5, 0);
      return g;
    })());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10;
    u.mesh = mesh; u.tex = tex; u.mat = mat;
    atlas.applyFrame(tex, 'idle', 0, u.facing < 0);
    this.scene.add(mesh);
    this._layout(u);
  }

  _detachMesh(u) {
    if (!u.mesh) return;
    try { this.scene.remove(u.mesh); } catch (e) {}
    try { if (u.mat) u.mat.dispose(); } catch (e) {}
    try { if (u.tex) u.tex.dispose(); } catch (e) {}
    u.mesh = null; u.tex = null; u.mat = null;
  }

  /** Glide a unit to a new logical position over `ms` (default 260). */
  moveUnit(id, x, y, ms) {
    const u = this.units.get(id);
    if (!u) return;
    u._from = { x: u.x, y: u.y, t0: performance.now(), t1: performance.now() + (ms || 260) };
    u.x = x; u.y = y;
  }

  /**
   * Play a one-shot animation, then settle back to idle.
   * Returns a promise that resolves when it finishes.
   * opts.durationMs caps/stretches it; opts.holdLast freezes the final frame.
   */
  play(id, anim, opts) {
    const u = this.units.get(id);
    if (!u) return Promise.resolve(false);
    const o = opts || {};
    return new Promise((resolve) => {
      const start = () => {
        const atlas = this.atlases.get(u.spriteId);
        const frames = atlas && atlas.ready ? atlas.frameCount(anim) : 0;
        if (!frames || !(atlas.has(anim))) { resolve(false); return; }
        let frameMs = this._frameMs(u.spriteId, anim);
        if (o.durationMs > 0) frameMs = Math.max(16, o.durationMs / frames);
        u._oneShot = {
          anim, t0: performance.now(), frameMs,
          holdLast: o.holdLast != null ? !!o.holdLast : ONE_SHOT_HOLD_LAST.has(anim),
          resolve,
        };
      };
      const atlas = this._atlasFor(u.spriteId);
      if (atlas.ready) start();
      else if (atlas._promise) atlas._promise.then(start); // stream-in, then play
      else resolve(false);
    });
  }

  /** Hard-set the looping animation (e.g. 'walk' while tweening a move). */
  setAnim(id, anim) {
    const u = this.units.get(id);
    if (u) { u.anim = anim || 'idle'; u._oneShot = null; }
  }

  /** Tint the unit toward `color` for `ms` — the classic hit flash. */
  flash(id, color, ms) {
    const u = this.units.get(id);
    if (!u) return;
    u._flash = { color: new THREE.Color(color == null ? 0xff5252 : color), until: performance.now() + (ms || 140) };
  }

  /**
   * Remove a unit. { death:true } plays its death anim (held on the last
   * frame briefly) before the mesh is removed.
   */
  removeUnit(id, opts) {
    const u = this.units.get(id);
    if (!u) return Promise.resolve();
    if (opts && opts.death && !u._dead) {
      u._dead = true;
      return this.play(id, 'death', { holdLast: true }).then(() =>
        new Promise(r => setTimeout(r, opts.lingerMs != null ? opts.lingerMs : 350))
      ).then(() => this._destroy(id));
    }
    this._destroy(id);
    return Promise.resolve();
  }

  _destroy(id) {
    const u = this.units.get(id);
    if (!u) return;
    this._detachMesh(u);
    this.units.delete(id);
  }

  /**
   * Bulk reconcile against the host's unit list — the one call a render
   * pass needs. Adds new units, updates positions/facing, removes gone ones.
   * Each entry: { id, spriteId, x, y, w, h, facing, elevation }
   */
  sync(list) {
    const keep = new Set();
    for (const def of list || []) {
      if (!def || def.id == null) continue;
      keep.add(def.id);
      const existing = this.units.get(def.id);
      // Glide only on a REAL move (≥ ~1/3 of the unit's own height). Layout
      // jitter — a resize, the iso transform settling, sub-pixel rect drift —
      // snaps instead, so a window resize doesn't send every unit gliding.
      const threshold = (def.h || existing && existing.h || 1) * 0.34;
      const moved = existing && Math.hypot(def.x - existing.x, def.y - existing.y) > threshold;
      if (moved && def.glideMs !== 0) {
        const gx = def.x, gy = def.y;
        this.upsertUnit(Object.assign({}, def, { x: existing.x, y: existing.y }));
        this.moveUnit(def.id, gx, gy, def.glideMs || 260);
      } else {
        this.upsertUnit(def);
      }
    }
    for (const id of [...this.units.keys()]) {
      if (!keep.has(id)) this._destroy(id);
    }
  }

  /* =====================================================================
   * FRAME LOOP
   * =================================================================== */
  _frameMs(spriteId, anim) {
    let ms = this.opts.defaultFrameMs || DEFAULT_FRAME_MS;
    try {
      const fps = this.opts.resolveFps ? this.opts.resolveFps(spriteId, anim) : null;
      if (fps > 0) ms = 1000 / fps;
    } catch (e) {}
    return Math.max(20, ms); // ≤50fps clamp — a runaway value can't pin the loop
  }

  _start() {
    if (this._running || this._disposed) return;
    this._running = true;
    const tick = () => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(tick);
      this._tick(performance.now());
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stop() {
    this._running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }

  _tick(now) {
    const world = this.opts.mode !== 'overlay';
    for (const u of this.units.values()) {
      const atlas = this.atlases.get(u.spriteId);
      if (!u.mesh || !atlas || !atlas.ready) continue;

      // ---- animation ---------------------------------------------------
      let anim = u.anim, frame = 0, flip = u.facing < 0;
      if (u._oneShot) {
        const os = u._oneShot;
        const n = atlas.frameCount(os.anim);
        const i = Math.floor((now - os.t0) / os.frameMs);
        if (i >= n) {
          if (os.holdLast) { anim = os.anim; frame = n - 1; }
          else { u._oneShot = null; try { os.resolve(true); } catch (e) {} anim = u.anim; }
          if (os.holdLast && !os._resolved) { os._resolved = true; try { os.resolve(true); } catch (e) {} }
        } else { anim = os.anim; frame = i; }
      }
      if (!u._oneShot) {
        // CLOCK-ANCHORED idle: frame index is a pure function of the global
        // clock + per-id phase — re-syncs / rebuilds never restart the loop.
        const n = atlas.frameCount(anim);
        if (n > 1) {
          const ms = this._frameMs(u.spriteId, anim);
          frame = Math.floor(now / ms + u.phase * n) % n;
        }
      }
      if (frame !== u._lastFrame || anim !== u._lastAnim || flip !== u._lastFlip) {
        atlas.applyFrame(u.tex, anim, frame, flip);
        u._lastFrame = frame; u._lastAnim = anim; u._lastFlip = flip;
      }

      // ---- flash tint --------------------------------------------------
      if (u._flash) {
        if (now >= u._flash.until) { u._flash = null; u.mat.color.setRGB(1, 1, 1); }
        else {
          const k = 1 - (u._flash.until - now) / 140;
          u.mat.color.copy(u._flash.color).lerp(new THREE.Color(1, 1, 1), Math.min(1, Math.max(0, k)));
        }
      }

      // ---- position (with glide tween) ---------------------------------
      let px = u.x, py = u.y;
      if (u._from) {
        const f = u._from;
        const t = Math.min(1, (now - f.t0) / Math.max(1, f.t1 - f.t0));
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
        px = f.x + (u.x - f.x) * e;
        py = f.y + (u.y - f.y) * e;
        if (t >= 1) u._from = null;
      }
      this._layout(u, px, py);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _layout(u, px, py) {
    if (!u.mesh) return;
    const atlas = this.atlases.get(u.spriteId);
    const aspect = atlas && atlas.ready ? atlas.aspect : 1;
    const x = px != null ? px : u.x;
    const y = py != null ? py : u.y;
    if (this.opts.mode === 'overlay') {
      // screen space: ortho top-left origin → flip Y into three's space
      const h = u.h || 64;
      const w = u.w || h * aspect;
      u.mesh.scale.set(w, -h, 1);              // -h: quad grows downward-up in flipped ortho
      u.mesh.position.set(x, y - u.elevation, -y / 10000); // farther-down = drawn later
      u.mesh.renderOrder = 10 + y;             // painter's order by screen Y
    } else {
      const h = u.h || 1.15;
      const w = u.w || h * aspect;
      u.mesh.scale.set(w, h, 1);
      u.mesh.position.set(x, u.elevation, y);
      u.mesh.quaternion.copy(this.camera.quaternion); // billboard toward camera
      u.mesh.renderOrder = 10 + y;
    }
  }

  /* =====================================================================
   * HOUSEKEEPING
   * =================================================================== */
  stats() {
    let gpuBytes = 0;
    for (const a of this.atlases.values()) {
      if (a.ready) gpuBytes += a.cols * a.cellW * a.rows * a.cellH * 4;
    }
    return {
      backend: this.backend,
      units: this.units.size,
      atlases: this.atlases.size,
      approxAtlasMB: +(gpuBytes / (1024 * 1024)).toFixed(1),
    };
  }

  dispose() {
    this._disposed = true;
    this._stop();
    try { document.removeEventListener('visibilitychange', this._onVis); } catch (e) {}
    try { if (this._ro) this._ro.disconnect(); } catch (e) {}
    for (const id of [...this.units.keys()]) this._destroy(id);
    for (const [id, a] of this.atlases) { a.dispose(); }
    this.atlases.clear();
    try { this.renderer.dispose(); } catch (e) {}
    try { this.renderer.domElement.remove(); } catch (e) {}
  }
}

export default SpriteEngine;
