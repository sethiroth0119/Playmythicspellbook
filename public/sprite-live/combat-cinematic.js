/* =====================================================================
 * ⚔️ COMBAT CINEMATIC — three.js / WebGPU close-up battle scene
 * =====================================================================
 *
 * Replaces the DOM sprites inside the "X used Y!" attack overlay
 * (renderBattleAnim) with a choreographed GPU scene:
 *
 *   intro    → both fighters slide onto glowing platforms, embers drift
 *   windup   → attacker anticipates (pull back), attack anim starts
 *   LUNGE    → attacker dashes at the defender with motion streaks
 *   IMPACT   → element-colored flash + expanding shockwave ring +
 *              particle burst + camera shake; defender knockback,
 *              hurt anim, red flash; damage number punches in
 *   settle   → attacker returns; on a kill the defender plays its death
 *              anim and dissolves
 *   miss     → defender side-steps, "MISS" floats instead
 *
 * WHY THIS ALSO *FIXES* THE FLICKER / MISSING SPRITES
 * ---------------------------------------------------
 * The DOM overlay resolved frames ONCE at render time: if they weren't
 * resident yet it silently fell back (blank slots), and its <img> stack
 * ran on blob: URLs the art LRU could revoke mid-animation (flicker).
 * Here frames are fetched + decoded into a GPU atlas up front — once the
 * pixels are on the GPU nothing can revoke them — and the cinematic
 * awaits / streams the atlas in rather than racing it, so the fighters
 * always appear.
 *
 * Everything else in the overlay (banner, HP bars, stat chips) stays DOM.
 * ===================================================================== */

import * as THREE from 'three';
import { SpriteAtlas } from './sprite-engine.js';

const DEFAULT_FRAME_MS = 62;

/* small helpers ------------------------------------------------------- */
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/** Text → billboard texture (damage numbers, MISS, CRIT). */
function textSprite(text, opts) {
  const o = Object.assign({ size: 120, color: '#ffe08a', stroke: '#3a1200', font: '900 %spx Georgia, serif' }, opts || {});
  const pad = 40;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = o.font.replace('%s', o.size);
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w; c.height = o.size + pad * 2;
  const x = c.getContext('2d');
  x.font = font;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = o.size * 0.14; x.lineJoin = 'round';
  x.strokeStyle = o.stroke;
  x.strokeText(text, w / 2, c.height / 2);
  x.fillStyle = o.color;
  x.fillText(text, w / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.scale.set((w / c.height), 1, 1);
  mesh.userData._dispose = () => { tex.dispose(); mat.dispose(); };
  return mesh;
}

/** Soft round particle sprite texture (shared). */
let _dotTex = null;
function dotTexture() {
  if (_dotTex) return _dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}

/* ---------------------------------------------------------------------
 * PARTICLES — CPU-advanced THREE.Points (a few hundred at most; the GPU
 * only ever sees one buffer upload per frame).
 * ------------------------------------------------------------------- */
class Particles {
  constructor(scene, max, color, size) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);   // seconds remaining; ≤0 = dead
    this.ttl = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      map: dotTexture(), color, size, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.9,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // park dead particles far away instead of at the origin
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
  }
  emit(n, at, spread, speed, up, ttl) {
    let spawned = 0;
    for (let i = 0; i < this.max && spawned < n; i++) {
      if (this.life[i] > 0) continue;
      const a = Math.random() * Math.PI * 2, r = Math.random();
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = Math.cos(a) * speed * r;
      this.vel[i * 3 + 1] = up + Math.random() * speed * 0.8;
      this.vel[i * 3 + 2] = Math.sin(a) * speed * r * 0.5;
      this.life[i] = this.ttl[i] = ttl * (0.5 + Math.random() * 0.5);
      spawned++;
    }
  }
  tick(dt, gravity) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.vel[i * 3 + 1] -= gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.points); this.geo.dispose(); this.mat.dispose(); }
}

/* ---------------------------------------------------------------------
 * FIGHTER — atlas-backed billboard with the same anim semantics the
 * board engine uses (per-anim fps, one-shots, clock idle).
 * ------------------------------------------------------------------- */
class Fighter {
  constructor(scene, atlas, home, facing) {
    this.atlas = atlas;
    this.home = home.clone();
    this.facing = facing;                  // +1 faces right, -1 mirrored
    this.tex = atlas.texture.clone(); this.tex.needsUpdate = true;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, alphaTest: 0.02, side: THREE.DoubleSide });
    const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(g, this.mat);
    const H = 2.5;
    this.mesh.scale.set(H * atlas.aspect, H, 1);
    this.mesh.position.copy(home);
    scene.add(this.mesh);
    this.anim = 'idle'; this.oneShot = null; this._last = null;
  }
  play(anim, frameMs, holdLast) {
    if (!this.atlas.has(anim)) return 0;
    const n = this.atlas.frameCount(anim);
    this.oneShot = { anim, t0: performance.now(), frameMs, holdLast, n };
    return n * frameMs;
  }
  tick(now, frameMsOf) {
    let anim = this.anim, frame = 0;
    if (this.oneShot) {
      const os = this.oneShot;
      const i = Math.floor((now - os.t0) / os.frameMs);
      if (i >= os.n) {
        if (os.holdLast) { anim = os.anim; frame = os.n - 1; }
        else { this.oneShot = null; anim = this.anim; }
      } else { anim = os.anim; frame = i; }
    }
    if (!this.oneShot || (this.oneShot.holdLast && frame === this.oneShot.n - 1)) {
      if (!this.oneShot) {
        const n = this.atlas.frameCount(anim);
        if (n > 1) frame = Math.floor(now / frameMsOf(anim)) % n;
      }
    }
    const key = anim + ':' + frame;
    if (key !== this._last) { this.atlas.applyFrame(this.tex, anim, frame, this.facing < 0); this._last = key; }
  }
  flash(color) { this.mat.color.set(color); }
  unflash() { this.mat.color.setRGB(1, 1, 1); }
  dispose(scene) { scene.remove(this.mesh); this.mat.dispose(); this.tex.dispose(); this.mesh.geometry.dispose(); }
}

/* =====================================================================
 * THE CINEMATIC
 * =================================================================== */
export class CombatCinematic {
  /**
   * @param {Object} opts
   * @param {Element} opts.mount               container (canvas fills it, pointer-events none)
   * @param {string}  opts.attackerSpriteId
   * @param {string}  opts.defenderSpriteId
   * @param {Function} opts.resolveFrames      (spriteId, anim) => Promise<string[]|null>
   * @param {Function} [opts.resolveFps]
   * @param {boolean} [opts.attackerIsPlayer=true]  player attacks from bottom-left
   * @param {string|number} [opts.elementColor='#f5c453']
   * @param {number}  [opts.dmg=0]
   * @param {boolean} [opts.crit=false]
   * @param {boolean} [opts.missed=false]
   * @param {boolean} [opts.killed=false]
   * @param {number}  [opts.durationMs=2600]
   * @param {boolean} [opts.forceWebGL=false]
   * Resolves when the sequence completes (or dispose() is called).
   */
  static async play(opts) {
    const c = new CombatCinematic(opts);
    // 🩹 Expose the live instance (set BEFORE the first await, so callers can
    // grab it synchronously right after invoking play). The host needs a
    // handle mid-flight to dispose/re-adopt on overlay rebuilds.
    CombatCinematic.current = c;
    try {
      await c._init();
      return await c._run();
    } finally {
      if (CombatCinematic.current === c) CombatCinematic.current = null;
    }
  }

  constructor(opts) {
    this.o = Object.assign({
      attackerIsPlayer: true, elementColor: '#f5c453', dmg: 0,
      crit: false, missed: false, killed: false, durationMs: 2600,
    }, opts || {});
    this.disposed = false;
    this._temp = [];   // meshes to auto-dispose
  }

  async _init() {
    const o = this.o;

    // --- atlases first, through a CROSS-ATTACK CACHE. Rebuilding both
    // fighters' atlases on every attack re-decoded every frame each time —
    // the blank "fighters appear late" window at the start of EVERY attack.
    // Cached sprites now come up instantly; only a unit's first-ever attack
    // pays the decode. LRU-capped so a long session can't hoard GPU memory.
    const cache = (CombatCinematic._atlasCache = CombatCinematic._atlasCache || new Map());
    const atlasFor = async (sid) => {
      if (cache.has(sid)) { const a = cache.get(sid); cache.delete(sid); cache.set(sid, a); return a; }  // LRU touch
      const a = await new SpriteAtlas(sid).build(o.resolveFrames);
      cache.set(sid, a);
      while (cache.size > 16) { const [oldK, oldA] = cache.entries().next().value; cache.delete(oldK); try { oldA.dispose(); } catch (e) {} }
      return a;
    };
    const [atkAtlas, defAtlas] = await Promise.all([atlasFor(o.attackerSpriteId), atlasFor(o.defenderSpriteId)]);
    this.atkAtlas = atkAtlas; this.defAtlas = defAtlas;

    // --- SHARED renderer. `new WebGPURenderer()` + init() per attack was a
    // full backend negotiation every swing (the other half of the start-blank).
    // One renderer/canvas is created lazily and reused for every cinematic.
    if (CombatCinematic._rend && CombatCinematic._rendGL === !!o.forceWebGL) {
      this.renderer = CombatCinematic._rend;
    } else {
      this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL: !!o.forceWebGL });
      await this.renderer.init();
      CombatCinematic._rend = this.renderer; CombatCinematic._rendGL = !!o.forceWebGL;
    }
    this._sharedRenderer = true;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    o.mount.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camBase = new THREE.Vector3(0, 1.7, 7.2);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, 1.15, 0);
    this._size();
    this._ro = new ResizeObserver(() => this._size());
    this._ro.observe(o.mount);

    // --- stage geometry: player bottom-left, foe upper-right (matches
    // the DOM layout so HP panels line up with their fighters)
    const P = new THREE.Vector3(-2.5, 0.0, 1.4);
    const E = new THREE.Vector3(2.5, 1.05, -1.9);
    this.atkHome = o.attackerIsPlayer ? P : E;
    this.defHome = o.attackerIsPlayer ? E : P;

    if (atkAtlas.ready) this.attacker = new Fighter(this.scene, atkAtlas, this.atkHome, this.atkHome.x < 0 ? 1 : -1);
    if (defAtlas.ready) this.defender = new Fighter(this.scene, defAtlas, this.defHome, this.defHome.x < 0 ? 1 : -1);

    // glowing element-colored platforms under each fighter
    const elem = new THREE.Color(o.elementColor);
    const platform = (at) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.25, 48),
        new THREE.MeshBasicMaterial({ color: elem, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(at.x, at.y + 0.02, at.z);
      ring.scale.set(1, 0.55, 1); // ellipse — perspective floor
      this.scene.add(ring); this._temp.push(ring);
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(0.95, 48),
        new THREE.MeshBasicMaterial({ color: elem, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(at.x, at.y + 0.01, at.z);
      glow.scale.set(1, 0.55, 1);
      this.scene.add(glow); this._temp.push(glow);
      return ring;
    };
    this.atkRing = platform(this.atkHome);
    this.defRing = platform(this.defHome);

    // particles: ambient embers (warm) + impact burst (element color)
    this.embers = new Particles(this.scene, 90, 0xffa552, 0.09);
    this.burst = new Particles(this.scene, 260, elem, 0.14);

    // shockwave ring + impact flash, hidden until impact
    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.6, 64),
      new THREE.MeshBasicMaterial({ color: elem, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.shock.position.copy(this.defHome).add(new THREE.Vector3(0, 1.1, 0.1));
    this.scene.add(this.shock); this._temp.push(this.shock);

    this.flashQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ color: elem, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.flashQuad.position.set(0, 1, -4);
    this.scene.add(this.flashQuad); this._temp.push(this.flashQuad);
  }

  _size() {
    if (this.disposed) return;
    const m = this.o.mount;
    const w = Math.max(1, m.clientWidth), h = Math.max(1, m.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _frameMs(spriteId) {
    return (anim) => {
      let ms = DEFAULT_FRAME_MS;
      try { const fps = this.o.resolveFps ? this.o.resolveFps(spriteId, anim) : null; if (fps > 0) ms = 1000 / fps; } catch (e) {}
      return Math.max(20, ms);
    };
  }

  _run() {
    const o = this.o;
    return new Promise((resolve) => {
      const T = o.durationMs;
      // choreography timestamps (fractions of total)
      const tWind = T * 0.18, tLunge = T * 0.34, tImpact = T * 0.46, tSettle = T * 0.72;
      const start = performance.now();
      let impactFired = false, dmgMesh = null, last = start;
      const atkMsOf = this._frameMs(o.attackerSpriteId);
      const defMsOf = this._frameMs(o.defenderSpriteId);

      // pre-arm attack anim so the swing lands on the impact beat
      if (this.attacker) {
        const framesMs = Math.max(30, (tImpact - tWind) / Math.max(1, this.atkAtlas.frameCount('attack')));
        setTimeout(() => { if (!this.disposed && this.attacker) this.attacker.play('attack', framesMs, false); }, tWind);
      }

      const lungeVec = new THREE.Vector3().subVectors(this.defHome, this.atkHome);
      const lungeTarget = this.atkHome.clone().add(lungeVec.clone().multiplyScalar(0.62));

      const tick = () => {
        if (this.disposed) { resolve(); return; }
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        const t = now - start;

        // ambient embers rise from the floor the whole time
        if (Math.random() < 0.35) this.embers.emit(1, new THREE.Vector3((Math.random() - 0.5) * 8, -0.3, (Math.random() - 0.5) * 3), 0.3, 0.25, 0.55, 2.8);
        this.embers.tick(dt, -0.05);   // negative gravity: embers float up
        this.burst.tick(dt, 2.2);

        // platform pulse
        const pulse = 0.35 + Math.sin(now / 260) * 0.1;
        this.atkRing.material.opacity = pulse;
        this.defRing.material.opacity = pulse;

        // ---- attacker movement -------------------------------------------
        if (this.attacker) {
          const m = this.attacker.mesh.position;
          if (t < tWind) m.copy(this.atkHome);
          else if (t < tLunge) { // anticipation: small pull-back
            const k = easeInCubic(clamp01((t - tWind) / (tLunge - tWind)));
            m.copy(this.atkHome).addScaledVector(lungeVec, -0.06 * k);
          } else if (t < tImpact) { // the dash
            const k = easeOutCubic(clamp01((t - tLunge) / (tImpact - tLunge)));
            m.lerpVectors(this.atkHome.clone().addScaledVector(lungeVec, -0.06), lungeTarget, k);
            if (Math.random() < 0.8) this.burst.emit(1, m.clone().add(new THREE.Vector3(0, 1.1, 0)), 0.15, 0.4, 0.1, 0.35); // motion streaks
          } else if (t < tSettle) m.copy(lungeTarget);
          else { // return home
            const k = easeOutCubic(clamp01((t - tSettle) / (T - tSettle)));
            m.lerpVectors(lungeTarget, this.atkHome, k);
          }
        }

        // ---- impact beat --------------------------------------------------
        if (!impactFired && t >= tImpact) {
          impactFired = true;
          if (o.missed) {
            // defender side-steps; MISS floats
            if (this.defender) {
              const dodge = this.defHome.clone().add(new THREE.Vector3(this.defHome.x < 0 ? -0.9 : 0.9, 0, 0));
              this._dodge = { from: this.defHome.clone(), to: dodge, t0: now };
            }
            dmgMesh = textSprite('MISS', { size: 110, color: '#cfd6e6', stroke: '#101522' });
          } else {
            this.burst.emit(160, this.defHome.clone().add(new THREE.Vector3(0, 1.1, 0.1)), 0.35, 3.2, 1.6, 0.9);
            this._shockT0 = now;
            this._flashT0 = now;
            this._shakeT0 = now;
            this._shakeAmp = o.crit ? 0.22 : 0.12;
            if (this.defender) {
              this.defender.flash(0xff5252);
              setTimeout(() => { if (!this.disposed && this.defender) this.defender.unflash(); }, 180);
              this.defender.play('hurt', 70, false);
              this._knock = { t0: now };
              if (o.killed) {
                setTimeout(() => {
                  if (this.disposed || !this.defender) return;
                  const n = Math.max(1, this.defAtlas.frameCount('death'));
                  this.defender.play('death', Math.max(50, 600 / n), true);
                  this._dying = now + 250;
                }, 420);
              }
            }
            const txt = (o.crit ? 'CRIT! ' : '') + '-' + (o.dmg || 0);
            dmgMesh = textSprite(txt, {
              size: o.crit ? 150 : 120,
              color: o.crit ? '#ffd34d' : '#ff6b5e',
              stroke: '#2a0500',
            });
          }
          if (dmgMesh) {
            dmgMesh.position.copy(this.defHome).add(new THREE.Vector3(0, 2.7, 0.4));
            dmgMesh.quaternion.copy(this.camera.quaternion);
            this.scene.add(dmgMesh);
            this._dmgT0 = now;
          }
        }

        // shockwave expand + fade
        if (this._shockT0) {
          const k = clamp01((now - this._shockT0) / 450);
          this.shock.scale.setScalar(0.4 + k * 5.5);
          this.shock.material.opacity = (1 - k) * 0.85;
          this.shock.quaternion.copy(this.camera.quaternion);
          if (k >= 1) this._shockT0 = 0;
        }
        // screen flash
        if (this._flashT0) {
          const k = clamp01((now - this._flashT0) / 200);
          this.flashQuad.material.opacity = (1 - k) * (o.crit ? 0.5 : 0.3);
          if (k >= 1) this._flashT0 = 0;
        }
        // camera shake, decaying
        if (this._shakeT0) {
          const k = clamp01((now - this._shakeT0) / 420);
          const amp = this._shakeAmp * (1 - k);
          this.camera.position.copy(this.camBase).add(new THREE.Vector3((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, 0));
          if (k >= 1) { this._shakeT0 = 0; this.camera.position.copy(this.camBase); }
        }
        // defender knockback → ease home
        if (this.defender && this._knock) {
          const k = clamp01((now - this._knock.t0) / 380);
          const away = new THREE.Vector3().subVectors(this.defHome, this.atkHome).normalize().multiplyScalar(0.55);
          const out = Math.sin(Math.min(1, k * 1.6) * Math.PI);
          this.defender.mesh.position.copy(this.defHome).addScaledVector(away, out);
          if (k >= 1) { this.defender.mesh.position.copy(this.defHome); this._knock = null; }
        }
        // dodge (miss)
        if (this.defender && this._dodge) {
          const k = clamp01((now - this._dodge.t0) / 500);
          const w = Math.sin(Math.min(1, k * 1.4) * Math.PI);
          this.defender.mesh.position.lerpVectors(this._dodge.from, this._dodge.to, w);
          if (k >= 1) { this.defender.mesh.position.copy(this._dodge.from); this._dodge = null; }
        }
        // death dissolve — sink + fade after the death anim starts
        if (this.defender && this._dying && now > this._dying) {
          const k = clamp01((now - this._dying) / (T - (this._dying - start)) * 1.4);
          this.defender.mat.opacity = 1 - k * 0.9;
          this.defender.mesh.position.y = this.defHome.y - k * 0.35;
        }
        // damage number: punch in, rise, fade
        if (dmgMesh && this._dmgT0) {
          const k = clamp01((now - this._dmgT0) / 900);
          const s = (o.crit ? 1.5 : 1.15) * easeOutBack(Math.min(1, k * 2.4));
          dmgMesh.scale.set(s * (dmgMesh.userData._aspect || dmgMesh.scale.x / Math.max(0.0001, dmgMesh.scale.y)), s, 1);
          if (!dmgMesh.userData._aspect) dmgMesh.userData._aspect = dmgMesh.scale.x / s;
          dmgMesh.position.y += dt * 0.5;
          dmgMesh.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          dmgMesh.quaternion.copy(this.camera.quaternion);
        }

        // fighter frames + billboard toward camera
        if (this.attacker) { this.attacker.tick(now, atkMsOf); this.attacker.mesh.quaternion.copy(this.camera.quaternion); }
        if (this.defender) { this.defender.tick(now, defMsOf); this.defender.mesh.quaternion.copy(this.camera.quaternion); }

        this.renderer.render(this.scene, this.camera);
        // 🩹 First rendered frame → tell the host, so it can hide the DOM
        // sprites only NOW (one clean swap; no blank stage while decoding).
        if (!this._firstFramed) { this._firstFramed = true; try { if (typeof o.onFirstFrame === 'function') o.onFirstFrame(); } catch (e) {} }
        if (t < T) requestAnimationFrame(tick);
        else if (o.holdUntilDispose && !this.disposed) {
          // 🩹 HOLD the final frame — keep rendering (idle loops alive) until the
          // host disposes us when its overlay actually closes. Self-disposing at
          // T removed the canvas ~150ms before the DOM overlay ended, and the
          // hidden DOM sprites underneath made the fighters "pop out" early.
          if (!this._runResolved) {
            this._runResolved = true;
            if (dmgMesh) { try { this.scene.remove(dmgMesh); if (dmgMesh.userData._dispose) dmgMesh.userData._dispose(); } catch (e) {} dmgMesh = null; }
            resolve();
          }
          requestAnimationFrame(tick);
        }
        else { if (dmgMesh) { this.scene.remove(dmgMesh); if (dmgMesh.userData._dispose) dmgMesh.userData._dispose(); } this.dispose(); resolve(); }
      };
      requestAnimationFrame(tick);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this._ro && this._ro.disconnect(); } catch (e) {}
    try { this.attacker && this.attacker.dispose(this.scene); } catch (e) {}
    try { this.defender && this.defender.dispose(this.scene); } catch (e) {}
    try { this.embers && this.embers.dispose(this.scene); } catch (e) {}
    try { this.burst && this.burst.dispose(this.scene); } catch (e) {}
    for (const m of this._temp) { try { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } catch (e) {} }
    // Atlases are owned by the cross-attack CACHE (LRU-evicted there) and the
    // renderer/canvas is SHARED — dispose neither; just unhook the canvas.
    if (!this._sharedRenderer) { try { this.renderer.dispose(); } catch (e) {} }
    try { this.renderer.domElement.remove(); } catch (e) {}
  }
}

export default CombatCinematic;
