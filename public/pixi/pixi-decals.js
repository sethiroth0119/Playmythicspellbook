// ============================================================
// PIXI DECALS — Persistent ground marks (blood, scorch, footprints)
// ------------------------------------------------------------
// Decals are static-position graphics painted onto the decalLayer.
// They differ from VFX (which animate then disappear) and from
// surfaces (which are gameplay-relevant tile state in App.state)
// — decals are pure visual residue that lingers AFTER an event.
//
// Each factory returns { display, born, lifetime, fade(now) }:
//   display  — PIXI display object positioned in world coords
//   born     — set by board.spawnDecal() (timestamp)
//   lifetime — ms before the decal is culled, or Infinity for "permanent"
//   fade(now) — optional per-frame mutation (alpha decay etc.)
//
// Public surface:
//   MSPixiDecals.effects[kind]            — built-in factories
//   MSPixiDecals.register(kind, factory)  — extension hook
//
// Extension example — a chalk-circle decal that lingers 30 seconds:
//
//   MSPixiDecals.register('chalk-ring', (opts) => {
//     const g = new PIXI.Graphics();
//     g.circle(0, 0, 28).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
//     return { display: g, born: 0, lifetime: 30000, fade(now) {
//       const age = (now - this.born) / this.lifetime;
//       g.alpha = 1 - age * 0.8;
//     } };
//   });
// ============================================================
(function () {
  function _rand(n) { return (Math.random() - 0.5) * n; }

  // ─────────────────────────────────────────────────────────────
  // BLOODSTAIN — irregular dark red splatter. Permanent. Used
  // when a unit dies; the painter at the unit's tile is the
  // last thing left of them.
  // Opts: { color? = dark blood red, size? = 38 }
  // ─────────────────────────────────────────────────────────────
  function bloodstain(opts) {
    const color = opts.color != null ? opts.color : 0x6a0a0a;
    const baseSize = opts.size || 38;
    const g = new PIXI.Graphics();
    // Main splat — a fat irregular circle.
    g.circle(0, 0, baseSize * 0.45).fill({ color, alpha: 0.7 });
    // Outer halo — softer red bleed-through.
    g.circle(0, 0, baseSize * 0.7).fill({ color, alpha: 0.18 });
    // Random off-axis droplets — adds the "splatter" feel.
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = baseSize * (0.5 + Math.random() * 0.6);
      const r = 2 + Math.random() * 4;
      g.circle(Math.cos(ang) * dist, Math.sin(ang) * dist, r)
       .fill({ color, alpha: 0.55 - Math.random() * 0.25 });
    }
    return { display: g, born: 0, lifetime: Infinity };
  }

  // ─────────────────────────────────────────────────────────────
  // SCORCH — irregular dark brown/black burn mark. Permanent.
  // Used when a fire surface decays or is extinguished. A subtle
  // ember halo hints at the heat that was there.
  // Opts: { size? = 44 }
  // ─────────────────────────────────────────────────────────────
  function scorch(opts) {
    const baseSize = opts.size || 44;
    const g = new PIXI.Graphics();
    // Dark charcoal core.
    g.circle(0, 0, baseSize * 0.4).fill({ color: 0x1a0a05, alpha: 0.85 });
    // Brown burn ring.
    g.circle(0, 0, baseSize * 0.55).fill({ color: 0x3a1a0a, alpha: 0.35 });
    // Cool ember sparkles (fewer than burst — these are tiny embers in ash).
    for (let i = 0; i < 4; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = baseSize * (0.25 + Math.random() * 0.4);
      g.circle(Math.cos(ang) * dist, Math.sin(ang) * dist, 1.2)
       .fill({ color: 0xff7a32, alpha: 0.5 });
    }
    // Soft warm halo for the first second — subtle. After lifetime ticks,
    // we just leave the dark core.
    const halo = new PIXI.Graphics();
    halo.circle(0, 0, baseSize * 0.7).fill({ color: 0xff5a2a, alpha: 0.15 });
    const display = new PIXI.Container();
    display.addChild(halo, g);
    return {
      display,
      born: 0,
      lifetime: Infinity,
      // Halo decays in the first ~2.5s, then the scorch itself is permanent.
      fade(now) {
        if (!halo) return;
        const age = (now - this.born);
        if (age < 2500) halo.alpha = 0.15 * (1 - age / 2500);
        else if (halo.alpha !== 0) halo.alpha = 0;
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // FOOTPRINT — small low-alpha mark at the start of a movement
  // tween. Fades over ~3 seconds. Lots of these can stack as the
  // battle progresses; the board's per-pool cap keeps the count
  // bounded.
  // Opts: { color? }
  // ─────────────────────────────────────────────────────────────
  function footprint(opts) {
    const color = opts.color != null ? opts.color : 0x6a5b3f;
    const g = new PIXI.Graphics();
    // Two oval prints, slightly offset, suggesting boots.
    g.ellipse(-5, -2, 4, 6).fill({ color, alpha: 0.45 });
    g.ellipse(5, 2, 4, 6).fill({ color, alpha: 0.45 });
    // Rotate randomly so successive footprints don't look mechanical.
    g.rotation = _rand(Math.PI);
    return {
      display: g,
      born: 0,
      lifetime: 3000,
      fade(now) {
        const t = (now - this.born) / this.lifetime;
        g.alpha = Math.max(0, 1 - t);
      },
    };
  }

  const registry = { bloodstain, scorch, footprint };

  window.MSPixiDecals = {
    effects: registry,
    register(kind, factory) { registry[kind] = factory; },
  };
})();
