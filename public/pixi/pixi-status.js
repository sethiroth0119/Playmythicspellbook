// ============================================================
// PIXI STATUS — Per-unit looping status-effect overlays
// ------------------------------------------------------------
// Each registered status returns a factory that produces a tiny
// state machine: { display, tick(now) }. Unlike VFX, status
// overlays loop indefinitely until pixi-board removes them
// (when the corresponding statusEffect drops off the unit).
//
// pixi-board attaches `display` as a child of the unit container
// so the overlay follows the unit through movement tweens, fades
// with the unit on death, and is destroyed when the status expires.
//
// Public surface:
//   MSPixiStatus.effects[type]            — built-in factories
//   MSPixiStatus.register(type, factory)  — add a new status visual
//   MSPixiStatus.iconForStatus(type)      — emoji fallback lookup
//
// Adding a custom status visual (extension example):
//
//   MSPixiStatus.register('cursed', () => {
//     const g = new PIXI.Graphics();
//     // ...build initial display...
//     return {
//       display: g,
//       tick(now) {
//         // ...mutate g based on now (loops forever)...
//       },
//     };
//   });
// ============================================================
(function () {
  // Tunables — exposed so future tweaks don't require rebuilding individual
  // factories. Loop periods are in ms; sizes are in Pixi pixels.
  const OVERLAY_OFFSET_Y = -56; // overlay anchor (unit container is anchored near bottom)
  const PARTICLE_PERIOD = 1200; // particle re-spawn cycle for looping emitters

  function _circle(g, r, color, alpha) {
    g.circle(0, 0, r).fill({ color, alpha: alpha == null ? 1 : alpha });
    return g;
  }

  function _makeText(emoji, size) {
    return new PIXI.Text({
      text: emoji,
      style: {
        fontFamily: 'system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif',
        fontSize: size || 18,
        fill: 0xffffff,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Helper: a generic "looping particle emitter" used by many
  // status visuals. Spawns N particles with staggered lifetimes
  // so the column is continuously populated without ever being
  // re-allocated. Each particle is a small Graphics node that
  // resets to its start state when its lifetime wraps.
  // ─────────────────────────────────────────────────────────────
  function makeLoopingEmitter(opts) {
    const display = new PIXI.Container();
    display.y = OVERLAY_OFFSET_Y;
    const count = opts.count || 6;
    const lifetime = opts.lifetime || PARTICLE_PERIOD;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const g = new PIXI.Graphics();
      const r = (opts.minR || 2) + Math.random() * ((opts.maxR || 4) - (opts.minR || 2));
      _circle(g, r, opts.color, 1);
      display.addChild(g);
      parts.push({
        g,
        seed: Math.random(),
        xJitter: (Math.random() - 0.5) * (opts.spreadX || 22),
      });
    }
    return {
      display,
      tick(now) {
        for (const p of parts) {
          // Phase 0..1 advances continuously; mod 1 to wrap.
          const phase = ((now / lifetime) + p.seed) % 1;
          const drift = opts.drift || ((px, ph) => {
            return { x: px.xJitter, y: -ph * 36 };
          });
          const pos = drift(p, phase, now);
          p.g.x = pos.x;
          p.g.y = pos.y;
          // Bell-curve alpha: fade in then out across lifetime.
          p.g.alpha = phase < 0.15
            ? phase / 0.15
            : phase > 0.85 ? (1 - (phase - 0.85) / 0.15) : 1;
          if (opts.scaleFn) p.g.scale.set(opts.scaleFn(phase));
        }
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Built-in status visuals
  // ─────────────────────────────────────────────────────────────
  function burn() {
    return makeLoopingEmitter({
      count: 7, lifetime: 900, color: 0xff7a32, minR: 2, maxR: 4, spreadX: 26,
      drift: (p, ph) => ({
        x: p.xJitter + Math.sin(ph * Math.PI * 2) * 4,
        y: -ph * 42 - 6,
      }),
      scaleFn: (ph) => 1.1 - ph * 0.7,
    });
  }

  function poison() {
    return makeLoopingEmitter({
      count: 6, lifetime: 1400, color: 0x9af04b, minR: 2.5, maxR: 4.5, spreadX: 22,
      drift: (p, ph) => ({ x: p.xJitter + Math.sin(ph * Math.PI * 3) * 3, y: -ph * 38 }),
      scaleFn: (ph) => 0.6 + ph * 0.5,
    });
  }

  function bleed() {
    // Drops fall downward off the unit.
    return makeLoopingEmitter({
      count: 4, lifetime: 800, color: 0xa02828, minR: 2, maxR: 3.5, spreadX: 18,
      drift: (p, ph) => ({ x: p.xJitter, y: ph * 32 + 28 }),
      scaleFn: (ph) => 0.5 + ph * 0.7,
    });
  }

  function siphoned() {
    // Tendrils pulse up and curl.
    return makeLoopingEmitter({
      count: 5, lifetime: 1500, color: 0x3aa86b, minR: 2, maxR: 3, spreadX: 18,
      drift: (p, ph) => ({
        x: p.xJitter + Math.sin(ph * Math.PI * 4) * 5,
        y: -ph * 30 - Math.cos(ph * Math.PI * 2) * 5,
      }),
      scaleFn: (ph) => 0.7 + ph * 0.4,
    });
  }

  function frozen() {
    // Ice crust + slow drifting frost specks.
    const display = new PIXI.Container();
    display.y = OVERLAY_OFFSET_Y;
    const ice = new PIXI.Graphics();
    ice.rect(-20, 14, 40, 36).fill({ color: 0x9be4ff, alpha: 0.2 });
    ice.poly([-22, 14, -10, 6, 0, 14, 10, 6, 22, 14, 22, 50, -22, 50]).fill({ color: 0x9be4ff, alpha: 0.28 });
    ice.stroke({ color: 0xffffff, width: 1, alpha: 0.55 });
    display.addChild(ice);
    const emitter = makeLoopingEmitter({
      count: 4, lifetime: 2000, color: 0xffffff, minR: 1, maxR: 2, spreadX: 24,
      drift: (p, ph) => ({ x: p.xJitter + Math.sin(ph * 6) * 4, y: -ph * 24 - 6 }),
    });
    display.addChild(emitter.display);
    return { display, tick(now) { emitter.tick(now); } };
  }

  function stun() {
    // Stars circle the unit's head.
    const display = new PIXI.Container();
    display.y = OVERLAY_OFFSET_Y;
    const stars = [];
    for (let i = 0; i < 3; i++) {
      const t = _makeText('✨', 18);
      t.anchor.set(0.5, 0.5);
      display.addChild(t);
      stars.push({ t, offset: (i / 3) * Math.PI * 2 });
    }
    return {
      display,
      tick(now) {
        const speed = 0.003;
        for (const s of stars) {
          const a = now * speed + s.offset;
          s.t.x = Math.cos(a) * 18;
          s.t.y = Math.sin(a) * 6 - 4;
          s.t.alpha = 0.6 + 0.4 * Math.sin(a * 2);
        }
      },
    };
  }

  function sleep() {
    // "💤" symbols drift up and fade.
    const display = new PIXI.Container();
    display.y = OVERLAY_OFFSET_Y;
    const zs = [];
    for (let i = 0; i < 3; i++) {
      const t = _makeText('💤', 16);
      t.anchor.set(0.5, 0.5);
      display.addChild(t);
      zs.push({ t, seed: i / 3 });
    }
    return {
      display,
      tick(now) {
        for (const z of zs) {
          const ph = ((now / 2200) + z.seed) % 1;
          z.t.x = Math.sin(ph * Math.PI * 2) * 8 + 14;
          z.t.y = -ph * 36 - 6;
          z.t.alpha = ph < 0.2 ? ph / 0.2 : ph > 0.8 ? (1 - (ph - 0.8) / 0.2) : 1;
          z.t.scale.set(0.6 + ph * 0.4);
        }
      },
    };
  }

  function paralysis() {
    // Random electric sparks.
    const display = new PIXI.Container();
    display.y = OVERLAY_OFFSET_Y;
    const sparks = [];
    for (let i = 0; i < 5; i++) {
      const g = new PIXI.Graphics();
      g.poly([0, -6, 2, -1, 5, -1, 2, 2, 3, 6, 0, 3, -3, 6, -2, 2, -5, -1, -2, -1])
       .fill({ color: 0xfff66e, alpha: 0.95 });
      display.addChild(g);
      sparks.push({ g, seed: Math.random() });
    }
    return {
      display,
      tick(now) {
        for (const s of sparks) {
          const ph = ((now / 280) + s.seed) % 1;
          // Each spark flashes briefly then disappears, then re-randomizes.
          if (ph < 0.2) {
            s.g.alpha = ph / 0.2;
          } else if (ph < 0.45) {
            s.g.alpha = 1 - (ph - 0.2) / 0.25;
          } else {
            s.g.alpha = 0;
            if (ph < 0.5) { // re-roll position only when invisible
              s.g.x = (Math.random() - 0.5) * 40;
              s.g.y = (Math.random() - 0.5) * 40;
              s.g.rotation = Math.random() * Math.PI * 2;
            }
          }
        }
      },
    };
  }

  function vulnerable() {
    // A red crosshair fixed on the unit.
    const display = new PIXI.Container();
    display.y = OVERLAY_OFFSET_Y;
    const ring = new PIXI.Graphics();
    ring.circle(0, 18, 18).stroke({ color: 0xff4444, width: 2, alpha: 0.9 });
    ring.moveTo(-22, 18).lineTo(-12, 18).stroke({ color: 0xff4444, width: 2 });
    ring.moveTo(12, 18).lineTo(22, 18).stroke({ color: 0xff4444, width: 2 });
    ring.moveTo(0, -4).lineTo(0, 6).stroke({ color: 0xff4444, width: 2 });
    ring.moveTo(0, 30).lineTo(0, 40).stroke({ color: 0xff4444, width: 2 });
    display.addChild(ring);
    return {
      display,
      tick(now) {
        ring.scale.set(1 + Math.sin(now * 0.005) * 0.05);
        ring.alpha = 0.7 + Math.sin(now * 0.008) * 0.2;
      },
    };
  }

  function spectralHaze() {
    // Soft cyan/purple fog blobs drifting around the unit.
    const display = new PIXI.Container();
    display.y = OVERLAY_OFFSET_Y;
    const blobs = [];
    for (let i = 0; i < 4; i++) {
      const g = new PIXI.Graphics();
      _circle(g, 10 + Math.random() * 6, 0xb0a8ff, 0.35);
      display.addChild(g);
      blobs.push({ g, seed: Math.random() * Math.PI * 2 });
    }
    return {
      display,
      tick(now) {
        for (const b of blobs) {
          const ph = now * 0.0008 + b.seed;
          b.g.x = Math.sin(ph) * 22;
          b.g.y = Math.cos(ph * 0.7) * 12 + 14;
          b.g.alpha = 0.25 + Math.sin(ph * 2) * 0.15;
        }
      },
    };
  }

  // Default fallback — shows the status emoji bobbing gently.
  function _generic(emoji) {
    return () => {
      const display = new PIXI.Container();
      display.y = OVERLAY_OFFSET_Y;
      const t = _makeText(emoji || '✨', 18);
      t.anchor.set(0.5, 0.5);
      display.addChild(t);
      return {
        display,
        tick(now) {
          t.y = Math.sin(now * 0.004) * 3;
          t.alpha = 0.75 + Math.sin(now * 0.006) * 0.2;
        },
      };
    };
  }

  const registry = {
    burn, poison, bleed, siphoned, frozen, stun, sleep, paralysis, vulnerable, spectralHaze,
    // Stumble shares the visual with stun (both are flinch-style).
    stumble: stun,
  };

  // Read the game's emoji table once at load (best-effort — it might not
  // be defined yet if scripts loaded out of order; we re-check per call).
  function iconForStatus(type) {
    try {
      if (typeof STATUS_EFFECTS !== 'undefined' && STATUS_EFFECTS[type] && STATUS_EFFECTS[type].icon) {
        return STATUS_EFFECTS[type].icon;
      }
    } catch (e) {}
    return '✨';
  }

  window.MSPixiStatus = {
    effects: registry,
    register(type, factory) { registry[type] = factory; },
    iconForStatus,
    // Used by pixi-board when no registered factory matches — produces a
    // generic emoji-bob overlay so unknown statuses still get *something*.
    getFactory(type) {
      if (registry[type]) return registry[type];
      return _generic(iconForStatus(type));
    },
  };
})();
