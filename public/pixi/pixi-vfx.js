// ============================================================
// PIXI VFX — Effect registry + built-in effect kinds
// ------------------------------------------------------------
// A pluggable visual-effects system layered onto MSPixiBoard.
// Each "kind" is a self-contained factory that returns a tiny
// state machine: { display, tick(now), done(now) }.
//
// pixi-board.js owns the lifecycle — it adds `display` to the
// vfxLayer, calls tick() each frame, and destroys the display
// when done() returns true. This module just defines what each
// effect LOOKS LIKE.
//
// Public surface:
//   MSPixiVfx.effects[kind]     — built-in factory functions
//   MSPixiVfx.register(kind, fn) — add a new effect kind
//   MSPixiVfx.colorForElement(e) — map "fire"/"water"/etc. → hex
//
// Adding a new effect (extension example):
//
//   MSPixiVfx.register('lightning', (opts) => {
//     const g = new PIXI.Graphics();
//     // ...draw initial state...
//     return {
//       display: g,
//       startMs: 0, // set by board on play
//       tick(now) {
//         const t = (now - this.startMs) / 400;
//         // ...mutate g based on t...
//       },
//       done(now) { return (now - this.startMs) > 400; },
//     };
//   });
//
//   Then call it with:
//   MSPixiBoard.playFx({ kind: 'lightning', wx: 200, wy: 300 });
// ============================================================
(function () {
  // Element → hex color. Used by the auto-hook when a move has a known
  // element so projectiles/bursts pick up the right tint. Extend this as
  // new elements get added to the game's data files.
  const ELEMENT_COLOR = {
    fire:      0xff6b3c,
    water:     0x4a8fd4,
    nature:    0x3aa86b,
    earth:     0xc89a5f,
    air:       0xcfeaff,
    wind:      0xcfeaff,
    arcane:    0x8b5cf6,
    void:      0x6a3aa8,
    light:     0xf5d76e,
    holy:      0xf5d76e,
    dark:      0x4a2a6a,
    shadow:    0x4a2a6a,
    ice:       0x9be4ff,
    frost:     0x9be4ff,
    lightning: 0xfff66e,
    electric:  0xfff66e,
    poison:    0x9af04b,
    blood:     0xa02828,
    physical:  0xe8e0d0,
    neutral:   0xe8e0d0,
  };

  function colorForElement(el) {
    if (!el) return ELEMENT_COLOR.physical;
    return ELEMENT_COLOR[String(el).toLowerCase()] || ELEMENT_COLOR.physical;
  }

  // --- helpers shared by built-in effects ---
  function _circle(g, r, color, alpha) {
    g.circle(0, 0, r).fill({ color, alpha: alpha == null ? 1 : alpha });
    return g;
  }

  function _easeOut(t) { const u = 1 - t; return 1 - u * u; }
  function _easeIn(t)  { return t * t; }

  // ============================================================
  // PROJECTILE — bright orb travels from (fx, fy) → (tx, ty)
  // Opts: { fx, fy, tx, ty, color, duration?, size? }
  // ============================================================
  function projectile(opts) {
    const color = opts.color || 0xffffff;
    const duration = opts.duration || 320;
    const size = opts.size || 9;
    const display = new PIXI.Container();
    const orb = new PIXI.Graphics();
    _circle(orb, size, color, 1);
    _circle(orb, size * 1.8, color, 0.35); // glow
    display.addChild(orb);
    // Light trail — a series of fading echoes drawn each tick.
    const trail = new PIXI.Graphics();
    display.addChildAt(trail, 0);
    const fx = opts.fx, fy = opts.fy, tx = opts.tx, ty = opts.ty;
    display.x = fx;
    display.y = fy;
    return {
      display,
      startMs: 0,
      _last: [],
      tick(now) {
        const t = Math.min(1, (now - this.startMs) / duration);
        display.x = fx + (tx - fx) * t;
        display.y = fy + (ty - fy) * t;
        this._last.push({ x: display.x, y: display.y, age: 0 });
        if (this._last.length > 8) this._last.shift();
        trail.clear();
        for (let i = 0; i < this._last.length; i++) {
          const p = this._last[i];
          const a = (i + 1) / this._last.length * 0.5;
          trail.circle(p.x - display.x, p.y - display.y, size * 0.6 * (i / this._last.length))
               .fill({ color, alpha: a });
        }
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // BURST — radial particle spray from (wx, wy)
  // Opts: { wx, wy, color, count?, duration?, spread? }
  // ============================================================
  function burst(opts) {
    const color = opts.color || 0xffffff;
    const duration = opts.duration || 480;
    const count = opts.count || 12;
    const spread = opts.spread || 48;
    const display = new PIXI.Container();
    display.x = opts.wx;
    display.y = opts.wy;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const g = new PIXI.Graphics();
      const r = 3 + Math.random() * 3;
      _circle(g, r, color, 1);
      display.addChild(g);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = spread * (0.6 + Math.random() * 0.5);
      parts.push({ g, angle, dist });
    }
    return {
      display,
      startMs: 0,
      tick(now) {
        const t = Math.min(1, (now - this.startMs) / duration);
        const e = _easeOut(t);
        const fade = 1 - t;
        for (const p of parts) {
          p.g.x = Math.cos(p.angle) * p.dist * e;
          p.g.y = Math.sin(p.angle) * p.dist * e + 12 * e * e; // tiny gravity
          p.g.alpha = fade;
          p.g.scale.set(1 - 0.4 * t);
        }
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // RING — expanding ring shockwave at (wx, wy)
  // Opts: { wx, wy, color, duration?, maxRadius? }
  // ============================================================
  function ring(opts) {
    const color = opts.color || 0xffffff;
    const duration = opts.duration || 380;
    const maxR = opts.maxRadius || 60;
    const display = new PIXI.Graphics();
    display.x = opts.wx;
    display.y = opts.wy;
    return {
      display,
      startMs: 0,
      tick(now) {
        const t = Math.min(1, (now - this.startMs) / duration);
        const e = _easeOut(t);
        display.clear();
        display.circle(0, 0, maxR * e).stroke({ color, width: 3 * (1 - t * 0.6), alpha: 1 - t });
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // FLASH — soft circular pulse at (wx, wy) (for misses or casts)
  // Opts: { wx, wy, color, duration?, radius? }
  // ============================================================
  function flash(opts) {
    const color = opts.color || 0xffffff;
    const duration = opts.duration || 220;
    const radius = opts.radius || 36;
    const display = new PIXI.Graphics();
    display.x = opts.wx;
    display.y = opts.wy;
    return {
      display,
      startMs: 0,
      tick(now) {
        const t = Math.min(1, (now - this.startMs) / duration);
        const e = _easeIn(t);
        display.clear();
        display.circle(0, 0, radius * (0.4 + e * 0.6))
               .fill({ color, alpha: 0.55 * (1 - t) });
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // HEAL — rising green/light sparkles from (wx, wy)
  // Opts: { wx, wy, color, count?, duration? }
  // ============================================================
  function heal(opts) {
    const color = opts.color || 0x88e088;
    const duration = opts.duration || 720;
    const count = opts.count || 10;
    const display = new PIXI.Container();
    display.x = opts.wx;
    display.y = opts.wy;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const g = new PIXI.Graphics();
      const r = 2.5 + Math.random() * 2;
      _circle(g, r, color, 1);
      // Rising plus symbol on a fraction of particles for thematic clarity.
      if (Math.random() < 0.3) {
        const cross = new PIXI.Graphics();
        cross.rect(-1, -4, 2, 8).fill({ color: 0xffffff, alpha: 0.85 });
        cross.rect(-4, -1, 8, 2).fill({ color: 0xffffff, alpha: 0.85 });
        g.addChild(cross);
      }
      g.x = (Math.random() - 0.5) * 30;
      g.y = 20 + Math.random() * 10;
      display.addChild(g);
      parts.push({ g, x0: g.x, y0: g.y, drift: (Math.random() - 0.5) * 12, delay: Math.random() * 0.3 });
    }
    return {
      display,
      startMs: 0,
      tick(now) {
        const t = Math.min(1, (now - this.startMs) / duration);
        for (const p of parts) {
          const local = Math.max(0, Math.min(1, (t - p.delay) / Math.max(0.001, 1 - p.delay)));
          p.g.x = p.x0 + p.drift * local;
          p.g.y = p.y0 - 56 * local;
          p.g.alpha = local < 0.1 ? local / 0.1 : (1 - (local - 0.1) / 0.9);
        }
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // DAMAGE-TEXT — floating number that rises and fades.
  // Opts: { wx, wy, amount, variant?, duration?, color?, size? }
  //   variant: 'damage' (default red) | 'crit' (gold, bigger) | 'heal' (green) | 'miss' (grey "MISS")
  // Note: `variant` not `kind` — `kind` is reserved by playFx() for the
  // registry lookup ('damage-text' itself).
  // ============================================================
  function damageText(opts) {
    const duration = opts.duration || 900;
    const variant = opts.variant || 'damage';
    const KIND_STYLE = {
      damage: { color: 0xff4444, prefix: '-',  bold: true,  size: 28, outline: 0x3a0808 },
      crit:   { color: 0xfff066, prefix: '-',  bold: true,  size: 36, outline: 0x664400 },
      heal:   { color: 0x88e088, prefix: '+',  bold: true,  size: 26, outline: 0x0a3a14 },
      miss:   { color: 0xcccccc, prefix: '',   bold: false, size: 22, outline: 0x333333 },
    };
    const style = KIND_STYLE[variant] || KIND_STYLE.damage;
    const color = opts.color != null ? opts.color : style.color;
    const size = opts.size != null ? opts.size : style.size;
    const text = variant === 'miss' ? 'MISS' : (style.prefix + Math.abs(opts.amount | 0));
    const t = new PIXI.Text({
      text,
      style: {
        fontFamily: 'Cinzel, "Segoe UI", system-ui, sans-serif',
        fontSize: size,
        fontWeight: style.bold ? '900' : '600',
        fill: color,
        stroke: { color: style.outline, width: 3, alpha: 1 },
        align: 'center',
      },
    });
    t.anchor.set(0.5, 0.5);
    const display = new PIXI.Container();
    display.x = opts.wx;
    display.y = opts.wy;
    display.addChild(t);
    return {
      display,
      startMs: 0,
      tick(now) {
        const p = Math.min(1, (now - this.startMs) / duration);
        // Rises then drifts to a stop — Mario-style number popup.
        const rise = _easeOut(p);
        t.y = -rise * 38;
        t.alpha = p < 0.15 ? p / 0.15 : (1 - (p - 0.15) / 0.85);
        // Slight bounce-in scale at the start of the life cycle.
        const s = p < 0.18 ? 0.6 + (p / 0.18) * 0.4 : 1;
        t.scale.set(s);
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // MOVE-TRAIL — fading arrow from (fx, fy) → (tx, ty). Used by
  // the AI movement-trail hook so the player sees where the AI
  // just moved without the camera needing to follow it.
  // Opts: { fx, fy, tx, ty, color?, duration? }
  // ============================================================
  function moveTrail(opts) {
    const color = opts.color != null ? opts.color : 0xf5d76e;
    const duration = opts.duration || 900;
    const display = new PIXI.Graphics();
    const fx = opts.fx, fy = opts.fy, tx = opts.tx, ty = opts.ty;
    return {
      display,
      startMs: 0,
      tick(now) {
        const p = Math.min(1, (now - this.startMs) / duration);
        const fade = 1 - p;
        display.clear();
        // Trail line — thicker at start, tapers.
        display.moveTo(fx, fy).lineTo(tx, ty)
               .stroke({ color, width: 4 * fade, alpha: 0.7 * fade });
        // Arrowhead.
        const ang = Math.atan2(ty - fy, tx - fx);
        const ah = 14 * (0.8 + 0.2 * fade);
        const aw = 9 * (0.8 + 0.2 * fade);
        display.poly([
          tx, ty,
          tx - Math.cos(ang) * ah - Math.cos(ang - Math.PI / 2) * aw,
          ty - Math.sin(ang) * ah - Math.sin(ang - Math.PI / 2) * aw,
          tx - Math.cos(ang) * ah + Math.cos(ang - Math.PI / 2) * aw,
          ty - Math.sin(ang) * ah + Math.sin(ang - Math.PI / 2) * aw,
        ]).fill({ color, alpha: 0.9 * fade });
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // MOVE-BANNER — briefly flashes the move's name + element icon
  // above the defender. Replaces the context the DOM cinematic
  // provided (move name on the overlay) for the in-board Pixi
  // cinematic, so the player still sees WHAT just hit them.
  // Opts: { wx, wy, name, icon, color, duration? = 1100 }
  // ============================================================
  function moveBanner(opts) {
    const duration = opts.duration || 1100;
    const color = opts.color != null ? opts.color : 0xf5d76e;
    const display = new PIXI.Container();
    display.x = opts.wx;
    display.y = opts.wy;
    // Background plate — rounded rect tinted by element.
    const plate = new PIXI.Graphics();
    display.addChild(plate);
    // Element glyph (emoji) left of the text.
    const iconText = opts.icon
      ? new PIXI.Text({
          text: opts.icon,
          style: {
            fontFamily: 'system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif',
            fontSize: 18,
            fill: 0xffffff,
          },
        })
      : null;
    if (iconText) {
      iconText.anchor.set(0.5, 0.5);
      display.addChild(iconText);
    }
    const label = new PIXI.Text({
      text: String(opts.name || ''),
      style: {
        fontFamily: 'Cinzel, "Segoe UI", system-ui, sans-serif',
        fontSize: 16,
        fontWeight: '700',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3, alpha: 0.85 },
      },
    });
    label.anchor.set(0.5, 0.5);
    display.addChild(label);
    // Layout the plate around the measured label width.
    const padX = 12, padY = 6, iconW = iconText ? 22 : 0;
    const totalW = label.width + iconW + padX * 2;
    const totalH = Math.max(label.height, iconText ? iconText.height : 0) + padY * 2;
    plate.roundRect(-totalW / 2, -totalH / 2, totalW, totalH, 6)
         .fill({ color: 0x141022, alpha: 0.78 })
         .stroke({ color, width: 1.5, alpha: 0.9 });
    if (iconText) {
      iconText.x = -totalW / 2 + padX + iconW / 2 - 4;
      iconText.y = 0;
      label.x = -totalW / 2 + padX + iconW + label.width / 2;
    } else {
      label.x = 0;
    }
    label.y = 0;
    // The banner floats UP from the unit's head area, fading in then out.
    return {
      display,
      startMs: 0,
      tick(now) {
        const p = Math.min(1, (now - this.startMs) / duration);
        // Fade: snap in over 12%, hold to 70%, fade out remainder.
        let alpha;
        if (p < 0.12) alpha = p / 0.12;
        else if (p < 0.7) alpha = 1;
        else alpha = 1 - (p - 0.7) / 0.3;
        display.alpha = alpha;
        // Slight rise over the full lifetime — gives the banner a sense of motion.
        display.y = opts.wy - p * 12;
        // Subtle scale-up at the start.
        const s = p < 0.18 ? 0.85 + (p / 0.18) * 0.15 : 1;
        display.scale.set(s);
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // ULT-CINE — Hero Ultimate composite cinematic. Replaces the
  // full-screen DOM overlay with an in-board sequence:
  //   • a soft dim quad covers the board (focus pull)
  //   • a central radial pulse at the hero (charge-up)
  //   • 8 orbiting rune/card glyphs spin around the hero
  //   • a big banner above with "HERO unleashes ULTIMATE_NAME"
  //   • a shockwave ring fires at the climax (~700ms in)
  //
  // Opts: { wx, wy, heroName, ultName, color?, boardW?, boardH?, duration? = 1100 }
  // ============================================================
  function ultCine(opts) {
    const duration = opts.duration || 1100;
    const color = opts.color != null ? opts.color : 0xf5d76e;
    const boardW = opts.boardW || 768;
    const boardH = opts.boardH || 672;
    const display = new PIXI.Container();
    // Backdrop dim — a tinted quad covering the whole board. Centered on
    // the hero, sized to the full board so it doesn't leak past the canvas.
    const backdrop = new PIXI.Graphics();
    backdrop.rect(-boardW, -boardH, boardW * 2, boardH * 2)
            .fill({ color: 0x05040a, alpha: 0.55 });
    display.addChild(backdrop);
    // Central charge-up — concentric circles that pulse outward at the hero.
    const charge = new PIXI.Graphics();
    display.addChild(charge);
    // Orbital glyphs — 8 evenly spaced text nodes spinning around the hero.
    const glyphChars = ['🃏', '✦', '🃏', '⚝', '🃏', '☸', '🃏', '✺'];
    const glyphs = [];
    for (let i = 0; i < 8; i++) {
      const t = new PIXI.Text({
        text: glyphChars[i],
        style: {
          fontFamily: 'system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif',
          fontSize: 22,
          fill: 0xffffff,
        },
      });
      t.anchor.set(0.5, 0.5);
      display.addChild(t);
      glyphs.push({ t, angle: (i / 8) * Math.PI * 2 });
    }
    // Name banner — two-line text floating above the hero. Big & loud.
    const prefix = new PIXI.Text({
      text: String(opts.heroName || 'Hero') + ' unleashes',
      style: {
        fontFamily: 'Cinzel, "Segoe UI", system-ui, sans-serif',
        fontSize: 18,
        fontWeight: '500',
        fill: 0xa89878,
        stroke: { color: 0x000000, width: 3, alpha: 0.9 },
      },
    });
    prefix.anchor.set(0.5, 0.5);
    display.addChild(prefix);
    const ultName = new PIXI.Text({
      text: String(opts.ultName || 'ULTIMATE').toUpperCase(),
      style: {
        fontFamily: 'Cinzel, "Segoe UI", system-ui, sans-serif',
        fontSize: 32,
        fontWeight: '900',
        fill: color,
        stroke: { color: 0x000000, width: 4, alpha: 1 },
      },
    });
    ultName.anchor.set(0.5, 0.5);
    display.addChild(ultName);
    // Shockwave ring — drawn after the climax tick.
    const shock = new PIXI.Graphics();
    display.addChild(shock);
    return {
      display,
      startMs: 0,
      tick(now) {
        const p = Math.min(1, (now - this.startMs) / duration);
        // Backdrop fade — quick in, hold, quick out.
        backdrop.alpha = p < 0.12 ? (p / 0.12) * 0.55
                       : p > 0.85 ? Math.max(0, 0.55 * (1 - (p - 0.85) / 0.15))
                       : 0.55;
        // Central charge pulse — three rings expanding outward.
        charge.clear();
        for (let i = 0; i < 3; i++) {
          const phase = (p + i / 3) % 1;
          const r = phase * 90 + 12;
          charge.circle(opts.wx, opts.wy, r)
                .stroke({ color, width: 2 * (1 - phase), alpha: 0.9 * (1 - phase) });
        }
        // Center glow — bright at the climax (~0.65), dims after.
        const climaxStrength = Math.exp(-Math.pow((p - 0.65) * 4, 2));
        charge.circle(opts.wx, opts.wy, 28)
              .fill({ color, alpha: 0.5 * climaxStrength });
        // Orbital glyphs — spin around the hero, swelling toward the climax.
        const radius = 90 + Math.sin(p * Math.PI) * 14;
        const spin = p * Math.PI * 2;
        for (const g of glyphs) {
          const a = g.angle + spin;
          g.t.x = opts.wx + Math.cos(a) * radius;
          g.t.y = opts.wy + Math.sin(a) * radius;
          g.t.alpha = p < 0.12 ? p / 0.12 : p > 0.85 ? (1 - (p - 0.85) / 0.15) : 1;
          g.t.scale.set(0.8 + climaxStrength * 0.4);
        }
        // Banner — rises above the hero, peaks at the climax.
        const bannerRise = -110 - p * 14;
        prefix.x = opts.wx;
        prefix.y = opts.wy + bannerRise - 22;
        ultName.x = opts.wx;
        ultName.y = opts.wy + bannerRise + 8;
        const bannerAlpha = p < 0.18 ? p / 0.18 : p > 0.88 ? (1 - (p - 0.88) / 0.12) : 1;
        prefix.alpha = bannerAlpha;
        ultName.alpha = bannerAlpha;
        const nameScale = p < 0.18 ? 0.6 + (p / 0.18) * 0.45 : 1 + climaxStrength * 0.1;
        ultName.scale.set(nameScale);
        // Shockwave — fires past the climax and expands outward.
        shock.clear();
        if (p > 0.62) {
          const sp = (p - 0.62) / 0.38;
          const sr = 30 + sp * 240;
          shock.circle(opts.wx, opts.wy, sr)
               .stroke({ color, width: 5 * (1 - sp), alpha: 0.85 * (1 - sp) });
        }
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // POLY-CINE — Polycreation Fusion cinematic. The DOM version
  // runs ~5200ms in five phases (initiate → converting → fusion →
  // summoned x2). The Pixi port collapses to one continuous loop
  // with a phase label that updates as time progresses, since the
  // phase number is tracked by the game and we observe it.
  //
  // Opts: { wx, wy, kalonName, kalonIcon, color, phase, boardW, boardH, duration? = 5200 }
  // ============================================================
  function polyCine(opts) {
    const duration = opts.duration || 5200;
    const color = opts.color != null ? opts.color : 0x8b5cf6; // violet — fusion default
    const boardW = opts.boardW || 768;
    const boardH = opts.boardH || 672;
    const display = new PIXI.Container();
    // Heavy dim backdrop so the fusion cinematic feels stage-lit.
    const backdrop = new PIXI.Graphics();
    backdrop.rect(-boardW, -boardH, boardW * 2, boardH * 2)
            .fill({ color: 0x05010f, alpha: 0.78 });
    display.addChild(backdrop);
    // Concentric ring system at the fusion center.
    const ringsG = new PIXI.Graphics();
    display.addChild(ringsG);
    // 12 rotating rune glyphs around the circle.
    const runeChars = ['☉','☽','✺','✦','⌬','☸','✧','⚛','✷','⌖','◈','✶'];
    const runes = [];
    for (let i = 0; i < runeChars.length; i++) {
      const t = new PIXI.Text({
        text: runeChars[i],
        style: {
          fontFamily: 'system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif',
          fontSize: 22,
          fill: 0xffffff,
        },
      });
      t.anchor.set(0.5, 0.5);
      display.addChild(t);
      runes.push({ t, angle: (i / runeChars.length) * Math.PI * 2 });
    }
    // Ash particles drifting upward — 18 of them, evenly stochastic.
    const ash = [];
    for (let i = 0; i < 18; i++) {
      const g = new PIXI.Graphics();
      g.circle(0, 0, 1.5 + Math.random() * 1.5).fill({ color: 0xc8b8e8, alpha: 0.55 });
      display.addChild(g);
      ash.push({ g, seed: Math.random(), xJitter: (Math.random() - 0.5) * 200 });
    }
    // Big phase label that changes as the cinematic progresses.
    const labels = ['POLYCREATION INITIATED', 'CONVERSION IN PROGRESS', 'FUSION COMPLETE', 'SUMMON UNIT CREATED'];
    const label = new PIXI.Text({
      text: labels[0],
      style: {
        fontFamily: 'Cinzel, "Segoe UI", system-ui, sans-serif',
        fontSize: 22,
        fontWeight: '700',
        fill: 0xe2d8ff,
        stroke: { color: 0x000000, width: 4, alpha: 1 },
      },
    });
    label.anchor.set(0.5, 0.5);
    display.addChild(label);
    // Kalon portrait icon + name — appears in the final phase.
    const kalonIcon = new PIXI.Text({
      text: opts.kalonIcon || '🌌',
      style: {
        fontFamily: 'system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif',
        fontSize: 64,
      },
    });
    kalonIcon.anchor.set(0.5, 0.5);
    kalonIcon.alpha = 0;
    display.addChild(kalonIcon);
    const kalonName = new PIXI.Text({
      text: String(opts.kalonName || 'KALON').toUpperCase(),
      style: {
        fontFamily: 'Cinzel, "Segoe UI", system-ui, sans-serif',
        fontSize: 32,
        fontWeight: '900',
        fill: color,
        stroke: { color: 0x000000, width: 4, alpha: 1 },
      },
    });
    kalonName.anchor.set(0.5, 0.5);
    kalonName.alpha = 0;
    display.addChild(kalonName);
    // Shockwave that fires at the climax (~60% of duration).
    const shock = new PIXI.Graphics();
    display.addChild(shock);
    return {
      display,
      startMs: 0,
      tick(now) {
        const p = Math.min(1, (now - this.startMs) / duration);
        // Backdrop hold then fade.
        backdrop.alpha = p < 0.08 ? (p / 0.08) * 0.78
                       : p > 0.92 ? Math.max(0, 0.78 * (1 - (p - 0.92) / 0.08))
                       : 0.78;
        // Three expanding rings.
        ringsG.clear();
        for (let i = 0; i < 3; i++) {
          const phase = (p * 2 + i / 3) % 1;
          const r = phase * 140 + 30;
          ringsG.circle(opts.wx, opts.wy, r)
                .stroke({ color, width: 2.5 * (1 - phase), alpha: 0.85 * (1 - phase) });
        }
        // Pulsing inner glow.
        const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * 6);
        ringsG.circle(opts.wx, opts.wy, 40)
              .fill({ color, alpha: 0.25 * pulse });
        // Runes spin + scale-pulse.
        const radius = 110 + Math.sin(p * Math.PI * 4) * 14;
        const spin = p * Math.PI * 2.5;
        for (const r of runes) {
          const a = r.angle + spin;
          r.t.x = opts.wx + Math.cos(a) * radius;
          r.t.y = opts.wy + Math.sin(a) * radius;
          r.t.alpha = p < 0.1 ? p / 0.1 : p > 0.9 ? (1 - (p - 0.9) / 0.1) : 1;
          r.t.scale.set(0.85 + 0.15 * Math.sin(p * Math.PI * 8 + r.angle));
        }
        // Ash particles — drift upward.
        for (let i = 0; i < ash.length; i++) {
          const a = ash[i];
          const ph = ((now / 2200) + a.seed) % 1;
          a.g.x = opts.wx + a.xJitter;
          a.g.y = opts.wy + 220 - ph * 440;
          a.g.alpha = ph < 0.15 ? ph / 0.15 : ph > 0.85 ? (1 - (ph - 0.85) / 0.15) * 0.55 : 0.55;
        }
        // Phase label switches per quarter — quartile of duration picks one of 4 labels.
        const phaseIdx = Math.min(labels.length - 1, Math.floor(p * labels.length));
        if (label.text !== labels[phaseIdx]) label.text = labels[phaseIdx];
        label.x = opts.wx;
        label.y = opts.wy - 200;
        label.alpha = p < 0.08 ? p / 0.08 : p > 0.92 ? (1 - (p - 0.92) / 0.08) : 1;
        // Kalon portrait + name appear in the final third.
        const finalReveal = Math.max(0, Math.min(1, (p - 0.6) / 0.25));
        kalonIcon.alpha = finalReveal;
        kalonIcon.x = opts.wx;
        kalonIcon.y = opts.wy;
        kalonIcon.scale.set(0.6 + finalReveal * 0.6);
        kalonName.alpha = finalReveal;
        kalonName.x = opts.wx;
        kalonName.y = opts.wy + 92;
        kalonName.scale.set(0.7 + finalReveal * 0.3);
        // Shockwave at the climax (~0.62).
        shock.clear();
        if (p > 0.58) {
          const sp = (p - 0.58) / 0.18;
          if (sp >= 0 && sp <= 1) {
            const sr = 40 + sp * 360;
            shock.circle(opts.wx, opts.wy, sr)
                 .stroke({ color, width: 6 * (1 - sp), alpha: 0.9 * (1 - sp) });
          }
        }
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // VICTORY-MOMENT — brief in-board flourish on s.gameOver.
  // For wins: golden rays + expanding gold ring on the winner.
  // For losses: red dim quad over the board.
  // DOES NOT replace the DOM results modal — runs alongside it,
  // gives the moment a visual punch before the modal opens.
  // Opts: { wx, wy, color, variant: 'win'|'loss', boardW, boardH, duration? = 1400 }
  // Note: `variant` not `kind` — `kind` is reserved by playFx() for the
  // registry lookup ('victory-moment' itself).
  // ============================================================
  function victoryMoment(opts) {
    const duration = opts.duration || 1400;
    const isWin = opts.variant !== 'loss';
    const color = opts.color != null ? opts.color : (isWin ? 0xf5d76e : 0xa02828);
    const boardW = opts.boardW || 768;
    const boardH = opts.boardH || 672;
    const display = new PIXI.Container();
    // Backdrop tint.
    const backdrop = new PIXI.Graphics();
    backdrop.rect(-boardW, -boardH, boardW * 2, boardH * 2)
            .fill({ color: isWin ? 0x1a1208 : 0x180404, alpha: 0.35 });
    display.addChild(backdrop);
    // Radial rays (8 wedges fanning out from the winner).
    const rays = new PIXI.Graphics();
    display.addChild(rays);
    // Expanding rings.
    const ringsG = new PIXI.Graphics();
    display.addChild(ringsG);
    return {
      display,
      startMs: 0,
      tick(now) {
        const p = Math.min(1, (now - this.startMs) / duration);
        backdrop.alpha = p < 0.15 ? (p / 0.15) * 0.35 : p > 0.7 ? Math.max(0, 0.35 * (1 - (p - 0.7) / 0.3)) : 0.35;
        // Radial rays — only for wins.
        rays.clear();
        if (isWin) {
          const rayRotation = p * Math.PI * 0.3;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 + rayRotation;
            const inner = 30;
            const outer = 30 + p * 240;
            const w = 0.05; // wedge width in radians
            rays.poly([
              opts.wx + Math.cos(a - w) * inner, opts.wy + Math.sin(a - w) * inner,
              opts.wx + Math.cos(a + w) * inner, opts.wy + Math.sin(a + w) * inner,
              opts.wx + Math.cos(a + w) * outer, opts.wy + Math.sin(a + w) * outer,
              opts.wx + Math.cos(a - w) * outer, opts.wy + Math.sin(a - w) * outer,
            ]).fill({ color, alpha: 0.55 * (1 - p * 0.6) });
          }
        }
        // Expanding rings.
        ringsG.clear();
        for (let i = 0; i < 2; i++) {
          const phase = Math.min(1, p * 1.4 - i * 0.18);
          if (phase <= 0) continue;
          const r = 20 + phase * 220;
          ringsG.circle(opts.wx, opts.wy, r)
                .stroke({ color, width: 4 * (1 - phase), alpha: 0.9 * (1 - phase) });
        }
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  // ============================================================
  // SUMMON-PORTAL — card-summons-unit animation. A card-shaped
  // rectangle materializes at the tile, expands and dissolves into
  // an expanding magic circle + radiant rays as the unit sprite
  // emerges beneath. Pairs with the per-unit `summonStart` field
  // in pixi-board so the unit's alpha/scale tween in sync with this.
  //
  // Opts: { wx, wy, color, duration? = 700 }
  // ============================================================
  function summonPortal(opts) {
    const duration = opts.duration || 700;
    const color = opts.color != null ? opts.color : 0xf5d76e;
    const display = new PIXI.Container();
    // Layered graphics: card silhouette, magic circle, radial rays.
    const card = new PIXI.Graphics();
    const circle = new PIXI.Graphics();
    const rays = new PIXI.Graphics();
    display.addChild(circle, rays, card);
    return {
      display,
      startMs: 0,
      tick(now) {
        const p = Math.min(1, (now - this.startMs) / duration);
        // Card silhouette — 50px × 70px rounded rect at center. Visible during
        // the first 40% of the animation, then dissolves up + outward.
        card.clear();
        if (p < 0.55) {
          const cp = p / 0.55;
          const cardW = 50 * (1 + cp * 0.4);
          const cardH = 70 * (1 + cp * 0.4);
          const cardAlpha = cp < 0.2 ? cp / 0.2 : (1 - (cp - 0.2) / 0.8);
          // Card body — translucent so the magic circle shows through.
          card.roundRect(opts.wx - cardW / 2, opts.wy - cardH / 2, cardW, cardH, 6)
              .fill({ color: 0x1a1530, alpha: 0.6 * cardAlpha })
              .stroke({ color, width: 2, alpha: cardAlpha });
          // Inner highlight stripe (gives the card a faint "art" suggestion).
          card.roundRect(opts.wx - cardW / 2 + 6, opts.wy - cardH / 2 + 8, cardW - 12, cardH * 0.4, 3)
              .fill({ color, alpha: 0.18 * cardAlpha });
          // Card rises and tilts as it dissolves.
          card.y = -cp * 8;
        }
        // Magic circle — expanding ring + inner glow. Fires throughout.
        circle.clear();
        const circR = 36 + p * 30;
        circle.circle(opts.wx, opts.wy, circR)
              .stroke({ color, width: 2.5 * (1 - p * 0.5), alpha: 0.85 * (1 - p * 0.5) });
        circle.circle(opts.wx, opts.wy, circR * 0.55)
              .stroke({ color, width: 1.5, alpha: 0.5 * (1 - p) });
        // Center glow peaks at 0.35.
        const glowStrength = Math.exp(-Math.pow((p - 0.35) * 3.5, 2));
        circle.circle(opts.wx, opts.wy, 28).fill({ color, alpha: 0.4 * glowStrength });
        // 8 radial rays — fan outward, brightest in the first half.
        rays.clear();
        const rayLen = 12 + p * 50;
        const rayInner = 18 + p * 4;
        const rayAlpha = p < 0.5 ? p * 1.6 : (1 - (p - 0.5) * 2);
        if (rayAlpha > 0) {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + p * 0.4;
            const w = 0.06;
            rays.poly([
              opts.wx + Math.cos(a - w) * rayInner, opts.wy + Math.sin(a - w) * rayInner,
              opts.wx + Math.cos(a + w) * rayInner, opts.wy + Math.sin(a + w) * rayInner,
              opts.wx + Math.cos(a + w / 2) * (rayInner + rayLen), opts.wy + Math.sin(a + w / 2) * (rayInner + rayLen),
              opts.wx + Math.cos(a - w / 2) * (rayInner + rayLen), opts.wy + Math.sin(a - w / 2) * (rayInner + rayLen),
            ]).fill({ color, alpha: 0.65 * rayAlpha });
          }
        }
      },
      done(now) { return (now - this.startMs) >= duration; },
    };
  }

  const registry = { projectile, burst, ring, flash, heal, 'damage-text': damageText, 'move-trail': moveTrail, 'move-banner': moveBanner, 'ult-cine': ultCine, 'poly-cine': polyCine, 'victory-moment': victoryMoment, 'summon-portal': summonPortal };

  window.MSPixiVfx = {
    effects: registry,
    register(kind, factory) { registry[kind] = factory; },
    colorForElement,
    _ELEMENT_COLOR: ELEMENT_COLOR,
  };
})();
