// ============================================================
// PIXI AMBIENT — Weather-driven board-wide particle ambience
// ------------------------------------------------------------
// One global ambient effect lives over the whole 8×7 board at
// any moment. The kind is picked from App.state.weather (when
// set) and the active location (fallback). When weather changes
// mid-battle, pixi-board swaps the effect.
//
// Each factory returns { display, tick(now) }. The display is
// 768×672 (board pixel dimensions) so particles can roam freely
// across the canvas. pixi-board adds it to an `ambientLayer`
// that sits between the tile grid and the markers so units and
// markers render IN FRONT of the ambient drift.
//
// Public surface:
//   MSPixiAmbient.effects[kind]              — built-in factories
//   MSPixiAmbient.register(kind, factory)    — add a new kind
//   MSPixiAmbient.kindForWeather(weather)    — weather → kind lookup
//   MSPixiAmbient.create(kind)               — instantiate one
//
// Built-in kinds: motes, embers, rain, sand, snow, eclipse, fog,
// bloodmoon, mindRealm, parallelWorld
//
// Adding a custom ambient (extension example):
//
//   MSPixiAmbient.register('volcanic', () => {
//     const display = new PIXI.Container();
//     // ...build looping system inside display...
//     return { display, tick(now) { /* drive it */ } };
//   });
// ============================================================
(function () {
  const BOARD_W_PX = 768;  // 8 × TILE (TILE = 96 in pixi-board.js)
  const BOARD_H_PX = 672;  // 7 × TILE

  function _newDisplay() {
    const d = new PIXI.Container();
    // Particle systems write into screen-space within the board, so we render
    // straight into this container without any extra transform.
    return d;
  }

  // ─────────────────────────────────────────────────────────────
  // Helper: floating particle field. Generic enough to back motes,
  // embers, sand, dust — anything that drifts in a roughly steady
  // direction with per-particle wobble. Each particle re-spawns
  // off-screen on the opposite edge when it exits, so the density
  // is constant without re-allocating Graphics objects.
  // ─────────────────────────────────────────────────────────────
  function floatingField(opts) {
    const display = _newDisplay();
    const count = opts.count || 60;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const g = new PIXI.Graphics();
      const r = (opts.minR || 1) + Math.random() * ((opts.maxR || 2.5) - (opts.minR || 1));
      g.circle(0, 0, r).fill({ color: opts.color, alpha: opts.alpha || 0.4 });
      g.x = Math.random() * BOARD_W_PX;
      g.y = Math.random() * BOARD_H_PX;
      display.addChild(g);
      parts.push({
        g,
        vx: (opts.vx != null ? opts.vx : 0.06) + (Math.random() - 0.5) * (opts.vxJitter || 0.04),
        vy: (opts.vy != null ? opts.vy : -0.05) + (Math.random() - 0.5) * (opts.vyJitter || 0.03),
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleAmp: opts.wobble || 0,
      });
    }
    let lastNow = 0;
    return {
      display,
      tick(now) {
        const dt = lastNow ? Math.min(64, now - lastNow) : 16;
        lastNow = now;
        for (const p of parts) {
          p.g.x += p.vx * dt + (p.wobbleAmp ? Math.cos(now * 0.003 + p.wobblePhase) * 0.3 : 0);
          p.g.y += p.vy * dt;
          // Wrap off-screen — particles re-enter from opposite edge.
          if (p.g.x < -8) p.g.x = BOARD_W_PX + 8;
          else if (p.g.x > BOARD_W_PX + 8) p.g.x = -8;
          if (p.g.y < -8) p.g.y = BOARD_H_PX + 8;
          else if (p.g.y > BOARD_H_PX + 8) p.g.y = -8;
        }
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Built-in ambient kinds
  // ─────────────────────────────────────────────────────────────
  function motes() {
    // Default — warm gold dust slowly drifting up-right.
    return floatingField({
      count: 45, color: 0xf5d76e, alpha: 0.28,
      minR: 1, maxR: 2.4,
      vx: 0.04, vy: -0.03, wobble: 1,
    });
  }

  function embers() {
    return floatingField({
      count: 50, color: 0xff6b3c, alpha: 0.5,
      minR: 1.2, maxR: 3,
      vx: 0.02, vy: -0.09, wobble: 1.5, vxJitter: 0.06,
    });
  }

  function rain() {
    const display = _newDisplay();
    const count = 90;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const g = new PIXI.Graphics();
      g.rect(0, 0, 1, 8).fill({ color: 0xa8d8ff, alpha: 0.65 });
      g.x = Math.random() * BOARD_W_PX;
      g.y = Math.random() * BOARD_H_PX;
      display.addChild(g);
      parts.push({ g, vy: 0.5 + Math.random() * 0.4, vx: -0.04 });
    }
    let lastNow = 0;
    return {
      display,
      tick(now) {
        const dt = lastNow ? Math.min(64, now - lastNow) : 16;
        lastNow = now;
        for (const p of parts) {
          p.g.x += p.vx * dt;
          p.g.y += p.vy * dt;
          if (p.g.y > BOARD_H_PX + 8) { p.g.y = -10; p.g.x = Math.random() * BOARD_W_PX; }
          if (p.g.x < -8) p.g.x = BOARD_W_PX;
        }
      },
    };
  }

  function sand() {
    return floatingField({
      count: 80, color: 0xd8b878, alpha: 0.45,
      minR: 0.8, maxR: 2,
      vx: 0.25, vy: -0.02, wobble: 0.8, vxJitter: 0.05,
    });
  }

  function snow() {
    return floatingField({
      count: 70, color: 0xffffff, alpha: 0.7,
      minR: 1.2, maxR: 2.6,
      vx: -0.02, vy: 0.08, wobble: 2, vxJitter: 0.03,
    });
  }

  function eclipse() {
    // Dark wisps drifting + occasional tiny purple stars.
    const display = _newDisplay();
    const wisps = floatingField({
      count: 28, color: 0x4a2a6a, alpha: 0.3,
      minR: 4, maxR: 8,
      vx: 0.02, vy: -0.04, wobble: 1.4,
    });
    display.addChild(wisps.display);
    const stars = floatingField({
      count: 18, color: 0xb29cff, alpha: 0.6,
      minR: 0.8, maxR: 1.5,
      vx: 0, vy: 0, wobble: 0.4,
    });
    display.addChild(stars.display);
    return {
      display,
      tick(now) {
        wisps.tick(now);
        stars.tick(now);
        // Star twinkle.
        const opacity = 0.5 + Math.sin(now * 0.001) * 0.3;
        stars.display.alpha = opacity;
      },
    };
  }

  function fog() {
    // Slow wide drifting fog blobs.
    return floatingField({
      count: 30, color: 0xcfd4dd, alpha: 0.18,
      minR: 14, maxR: 24,
      vx: 0.06, vy: -0.01, wobble: 1.4,
    });
  }

  function bloodmoon() {
    return floatingField({
      count: 40, color: 0xa02828, alpha: 0.4,
      minR: 1.5, maxR: 3,
      vx: 0.01, vy: -0.06, wobble: 1.8,
    });
  }

  function mindRealm() {
    // Soft floating magenta orbs (psychic feel).
    return floatingField({
      count: 35, color: 0xff6ec7, alpha: 0.45,
      minR: 1.8, maxR: 3.5,
      vx: 0.03, vy: -0.04, wobble: 1.6,
    });
  }

  function parallelWorld() {
    // Inverted-color cyan drift to feel mirror-world.
    return floatingField({
      count: 40, color: 0x6ef5e0, alpha: 0.4,
      minR: 1, maxR: 2.5,
      vx: -0.05, vy: 0.04, wobble: 1.5,
    });
  }

  const registry = {
    motes, embers, rain, sand, snow, eclipse, fog, bloodmoon, mindRealm, parallelWorld,
  };

  // Map of game-world weatherType → registered ambient kind. Anything not
  // in the map falls back to 'motes' so every battle has *some* ambience.
  const WEATHER_MAP = {
    sun: 'embers',
    rain: 'rain',
    lightningStorm: 'rain', // close enough; future slice could add bolts
    sand: 'sand',
    snow: 'snow',
    eclipse: 'eclipse',
    mist: 'fog',
    bloodmoon: 'bloodmoon',
    mindRealm: 'mindRealm',
    parallelWorld: 'parallelWorld',
  };

  function kindForWeather(weather) {
    if (!weather) return 'motes';
    const type = weather.type || weather.weatherType || weather;
    if (typeof type === 'string' && WEATHER_MAP[type]) return WEATHER_MAP[type];
    return 'motes';
  }

  function create(kind) {
    const factory = registry[kind] || motes;
    return factory();
  }

  window.MSPixiAmbient = {
    effects: registry,
    register(kind, factory) { registry[kind] = factory; },
    kindForWeather,
    create,
    _BOARD_W_PX: BOARD_W_PX,
    _BOARD_H_PX: BOARD_H_PX,
  };
})();
