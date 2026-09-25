// ============================================================
// PIXI BOARD — slice 2 (tweens, frame cycling, damage flash, death fade)
// ------------------------------------------------------------
// A PixiJS v8 Application that renders Mythic Spellbook's 8×7
// battlefield. Sprite pool keyed by unit.id — sync() reads
// App.state and creates/updates/destroys sprites to match.
//
// SYNC vs TICKER split (important):
//   sync()   — runs after each renderBattle(). Sets TARGETS: new
//              position triggers a tween, HP drop triggers a flash
//              timer, death triggers a fade-out timer.
//   ticker   — runs every frame. Advances tweens, decays flash,
//              cycles frame textures, destroys faded-out sprites.
//
//   This separation means a 60Hz visual update doesn't depend on
//   renderBattle() firing — combat looks smooth even if the game
//   only re-renders on state changes.
//
// What this DOES (slice 2):
//   * 8×7 tile grid (background per tile)
//   * Unit sprites with HP bar (Graphics)
//   * Selection ring on App.ui.selectedUnitId
//   * Tweened movement between tiles (~280ms ease-out)
//   * Sprite frame cycling (idle anim loop, ~150ms/frame)
//   * Damage flash (red tint + shake when HP drops)
//   * Death fade-out (alpha→0 + scale up over ~400ms)
//   * Click forwarding → window.onTileClick / window.onUnitClick
//
// What this does NOT do yet:
//   * Status badges, bleed counters, decoy stars, overwatch eyes
//     (still rendered as DOM overlays positioned over the canvas)
//   * Wall / location / trap tile markers
//   * Cinematic full-screen attack animations (existing DOM handles)
//   * Ambient (drifting ash, fog, lightning) — DOM keeps it
// ============================================================
(function () {
  const TILE = 96;
  const HP_BAR_H = 6;
  const SELECT_RING_COLOR = 0xf5d76e;
  const PLAYER_TINT = 0x88bb88;
  const ENEMY_TINT = 0xe85d3c;
  const FLASH_TINT = 0xff4444;
  const FLASH_MS = 260;
  const SHAKE_MS = 220;
  const SHAKE_AMPLITUDE = 3;
  const TWEEN_MS = 280;
  const FRAME_MS = 150;
  const DEATH_MS = 400;

  let app = null;
  let stage = null;
  let tileLayer = null;       // grid background quads
  let decalLayer = null;      // persistent residue (blood, scorch, footprints)
  let ambientLayer = null;    // weather-driven board-wide particles (slice 5)
  let markerLayer = null;     // walls, locations, traps, events, tombstones
  let highlightLayer = null;  // selection ring, valid-move tiles
  let unitLayer = null;       // unit sprites (sortable by row)
  let vfxLayer = null;        // particles / spell impacts (slice 4)
  let ambientFx = null;       // current ambient effect ({ display, tick })
  let lastAmbientKind = null; // last instantiated ambient kind — guards swap
  // Decals — FIFO-bounded so a long battle doesn't accumulate hundreds of
  // bloodstains and stall the GPU. Each entry: { display, born, lifetime, fade? }.
  const decals = [];
  const DECAL_CAP = 100;

  const unitPool = new Map(); // unit.id → entry (see _ensureUnitSprite)
  // Tile markers — keyed by "x,y:kind" so one tile can host multiple stacked
  // markers (e.g. a wall on a location, or a tombstone on top of an event).
  const tilePool = new Map();
  // Tombstones — keyed by "x,y" since at most one body sits on a tile.
  const tombstonePool = new Map();
  // Active VFX — each is a state machine from MSPixiVfx. The ticker calls
  // tick() each frame and destroys+removes when done() returns true.
  const activeFx = [];
  // BattleAnim watcher — remembers the last `startedAt` we already reacted to
  // so we only fire VFX on the *transition* into a new attack cinematic.
  let lastBattleAnimStartedAt = 0;
  // AI move-trail watcher — remembers the last from/to we showed so a stale
  // trail in App.ui doesn't re-fire every frame.
  let lastAiTrailKey = '';
  // Stage-level screen shake timer (set on crit). The ticker dampens app.stage
  // .x/.y while this is in the future, snaps back to (0,0) once it passes.
  let cinemShakeUntil = 0;
  // Hero-ult cinematic watcher — same single-fire-per-transition pattern as
  // battleAnim. The composite ult-cine VFX runs ~1100ms; this gate prevents
  // a lingering App.ui.heroUltCinematic from re-firing every frame.
  let lastHeroUltStartedAt = 0;
  // 🃏 Summon animation gate — every unit present at the FIRST sync after a
  // mount is treated as pre-existing (battle initial state — heroes, starters).
  // Subsequent syncs that introduce new units trigger the summon-portal VFX
  // + per-unit alpha/scale tween. Reset on destroy() so a fresh battle starts
  // fresh.
  let firstSyncComplete = false;
  const SUMMON_MS = 600;
  // Polycreation Fusion cinematic watcher — same pattern. The DOM cinematic
  // sets App.ui.polyCine = { startedAt, phase, totalMs }; we mirror the
  // startedAt to dedupe.
  let lastPolyCineStartedAt = 0;
  // Victory-moment watcher — fires once when App.state.gameOver transitions
  // from null/undefined to a winner string. The DOM results modal still
  // pops up; this just adds an in-board flourish before/under it.
  let lastGameOver = null;
  let selectionRing = null;
  let mounted = false;
  let mountEl = null;
  let tickerBound = false;

  function _baseTintFor(owner) {
    return owner === 'player' ? 0xffffff : 0xffd0c0;
  }

  // 🩹 SLICE 15 FIX — Apply the desired logical sprite size in a way that's
  // SAFE against PIXI v8's `Texture.EMPTY` (which is 1×1). Using the raw
  // `sprite.width = N` setter computes `scale = N / texture.width`, so a
  // sprite created against EMPTY gets scale=81.6 baked in. The lazy texture
  // upgrade later swaps `sprite.texture` but does NOT reset scale → the new
  // 256×256 texture renders at 256 × 81.6 ≈ 20,000px wide and the unit
  // disappears off the canvas. THIS WAS THE LIVE BUG that forced the rollback.
  //
  // Fix: re-derive scale every time the texture changes. Called on initial
  // create, on the lazy upgrade in _updateUnit, AND on every frame-cycle
  // texture swap in _tick. Guards against any non-positive texture dimension.
  function _applySpriteSize(sprite, targetW, targetH) {
    if (!sprite || !sprite.texture) return;
    const tw = sprite.texture.width;
    const th = sprite.texture.height;
    if (tw > 0 && th > 0) {
      sprite.scale.set(targetW / tw, targetH / th);
    } else {
      // Truly degenerate texture — hide the sprite rather than letting it
      // explode to Infinity scale. The lazy upgrade will retry next sync.
      sprite.scale.set(0, 0);
    }
  }

  // Tiny deterministic hash so each unit's frame cycle starts at a different
  // phase — prevents the whole board from blinking in lockstep.
  function _phaseOffset(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h % 1000);
  }

  function easeOutCubic(t) {
    const u = 1 - t;
    return 1 - u * u * u;
  }

  async function _initApp(el) {
    if (app) return;
    app = new PIXI.Application();
    await app.init({
      width: TILE * 8,
      height: TILE * 7,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    stage = app.stage;
    tileLayer = new PIXI.Container();
    decalLayer = new PIXI.Container();
    ambientLayer = new PIXI.Container();
    markerLayer = new PIXI.Container();
    highlightLayer = new PIXI.Container();
    unitLayer = new PIXI.Container();
    unitLayer.sortableChildren = true;
    vfxLayer = new PIXI.Container();
    // Order matters: grid → decals → ambient → markers → highlights → units → vfx.
    // Decals (bloodstains, scorch) sit ON the ground above the bare grid but
    // below ambient drift, so weather visibly floats over them. Markers and
    // units sit above everything ground-level.
    stage.addChild(tileLayer, decalLayer, ambientLayer, markerLayer, highlightLayer, unitLayer, vfxLayer);
    _buildTileGrid();
    el.appendChild(app.canvas);
    app.canvas.classList.add('pixi-board-canvas');
    app.canvas.style.width = '100%';
    app.canvas.style.height = 'auto';
    app.canvas.style.maxWidth = '100%';
    if (!tickerBound) {
      app.ticker.add(_tick);
      tickerBound = true;
    }
  }

  function _buildTileGrid() {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 8; x++) {
        const g = new PIXI.Graphics();
        const dark = (x + y) % 2 === 0;
        g.rect(0, 0, TILE, TILE).fill({ color: dark ? 0x1a1530 : 0x221a3a, alpha: 0.6 });
        g.rect(0, 0, TILE, TILE).stroke({ color: 0x3a2f5c, width: 1, alpha: 0.8 });
        g.x = x * TILE;
        g.y = y * TILE;
        g.eventMode = 'static';
        g.cursor = 'pointer';
        const cx = x, cy = y;
        g.on('pointerdown', (e) => {
          if (e.target !== g) return;
          if (typeof window.onTileClick === 'function') window.onTileClick(cx, cy);
        });
        tileLayer.addChild(g);
      }
    }
  }

  async function mount(el) {
    if (!el) return;
    mountEl = el;
    if (!app) {
      await _initApp(el);
    } else if (app.canvas.parentNode !== el) {
      el.appendChild(app.canvas);
    }
    mounted = true;
    sync();
  }

  function _ensureUnitSprite(unit) {
    let entry = unitPool.get(unit.id);
    if (entry) return entry;
    // First-sync gate: if the board hasn't completed its first sync yet
    // (battle initial state), we still create the sprite — but the summon
    // animation only triggers when firstSyncComplete is true.
    const isLateArrival = firstSyncComplete;
    const container = new PIXI.Container();
    const sprite = new PIXI.Sprite(MSPixiLoader.textureForUnit(unit));
    sprite.anchor.set(0.5, 0.85);
    // 🩹 SLICE 15 FIX — use scale-from-texture-size instead of width/height
    // so an EMPTY initial texture doesn't bake in a bad scale (see
    // _applySpriteSize). targetW/H stashed on the entry below so every
    // subsequent texture swap can re-derive scale.
    const _targetW = TILE * 0.85;
    const _targetH = TILE * 0.85;
    _applySpriteSize(sprite, _targetW, _targetH);
    const hpBarBg = new PIXI.Graphics();
    const hpBar = new PIXI.Graphics();
    container.addChild(sprite, hpBarBg, hpBar);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointerdown', (e) => {
      e.stopPropagation();
      if (typeof window.onUnitClick === 'function') window.onUnitClick(unit.id);
    });
    unitLayer.addChild(container);
    entry = {
      container,
      sprite,
      hpBar,
      hpBarBg,
      // Position state — used by _tick to drive tweens and the death y-pop.
      currentX: unit.pos.x * TILE + TILE / 2,
      currentY: unit.pos.y * TILE + TILE,
      lastPosKey: null,
      // Tween state — null when at rest.
      tween: null,
      // HP tracking for damage-flash detection.
      lastHp: null,
      lastHpPct: null,
      // Frame-cycling state.
      frames: [],
      frameIdx: 0,
      phase: _phaseOffset(unit.id),
      // VFX timers (Date.now() ms when effect ends).
      flashUntil: 0,
      shakeUntil: 0,
      // Death fade-out.
      dying: null,    // { startMs, duration } when fading
      // 🃏 Summon animation — set when this sprite is a late arrival (a card
      // was played AFTER first sync). The ticker tweens container.alpha +
      // container.scale until the animation completes. Null = no summon active.
      summonStart: null,
      // Cached owner tint (avoids string compare per tick).
      baseTint: _baseTintFor(unit.owner),
      ownerKey: unit.owner,
      lastTextureMissing: true,
      // 🩹 SLICE 15 FIX — desired logical sprite size in canvas units.
      // Read by every texture-swap path (lazy upgrade + frame cycle) so
      // scale is always re-derived from the new texture's actual dims.
      targetW: _targetW,
      targetH: _targetH,
    };
    container.x = entry.currentX;
    container.y = entry.currentY;
    unitPool.set(unit.id, entry);
    // 🃏 Late arrival → start the summon animation. We trigger the portal
    // VFX immediately (separately, on vfxLayer) and set summonStart so the
    // ticker pulls the sprite from invisible up to full size in sync.
    if (isLateArrival) {
      entry.summonStart = performance.now();
      // Element-tint the portal if we can read a card def — for now use a
      // neutral gold + owner accent. Future slice could look up move element.
      const portalColor = unit.owner === 'player' ? 0xf5d76e : 0xff8844;
      try {
        playFx({
          kind: 'summon-portal',
          wx: entry.currentX,
          wy: entry.currentY - TILE * 0.4,
          color: portalColor,
          duration: SUMMON_MS,
        });
      } catch (e) {}
      // 🩹 SLICE 15 FIX — start at a *visible* alpha and a non-trivial
      // scale so a stalled ticker (WebGL context loss, tab backgrounded
      // during transition, etc.) can never leave a unit permanently
      // invisible. The summon flourish still looks dramatic — the unit
      // pops from 40% size up to overshoot 1.15, then settles at 1.0 —
      // but the floor is "always at least partially visible."
      container.alpha = 0.4;
      container.scale.set(0.4, 0.4);
    }
    return entry;
  }

  function _updateUnit(unit) {
    // Death: kick off fade-out, don't recreate.
    if (!unit.alive || !unit.pos) {
      const existing = unitPool.get(unit.id);
      if (existing && !existing.dying) {
        existing.dying = { startMs: performance.now(), duration: DEATH_MS };
      }
      return;
    }
    const entry = _ensureUnitSprite(unit);
    if (entry.dying) {
      // State says alive again (revive). Cancel the fade-out and snap visible.
      entry.dying = null;
      entry.container.alpha = 1;
      entry.container.scale.set(1, 1);
    }
    const { sprite, hpBar, hpBarBg } = entry;

    // Lazy texture upgrade.
    if (entry.lastTextureMissing) {
      const tex = MSPixiLoader.textureForUnit(unit);
      if (tex && tex !== PIXI.Texture.EMPTY) {
        sprite.texture = tex;
        // 🩹 SLICE 15 FIX — re-derive scale from the NEW texture dims.
        // Without this the sprite renders at ~20,000px wide and the unit
        // visually disappears (the original live regression).
        _applySpriteSize(sprite, entry.targetW, entry.targetH);
        entry.lastTextureMissing = false;
      }
    }

    // Animation frames — refresh if we don't have them yet (textures may have
    // arrived asynchronously after the first sync).
    if (entry.frames.length === 0) {
      const frames = MSPixiLoader.framesForUnit(unit, 'idle');
      if (frames.length) {
        entry.frames = frames;
        entry.frameIdx = 0;
      }
    }

    // Owner change (rare — Kalon swap, charm effects). Re-cache tint.
    if (entry.ownerKey !== unit.owner) {
      entry.ownerKey = unit.owner;
      entry.baseTint = _baseTintFor(unit.owner);
    }

    // Position — start a tween if the tile changed and this isn't a fresh spawn.
    const targetX = unit.pos.x * TILE + TILE / 2;
    const targetY = unit.pos.y * TILE + TILE;
    const posKey = unit.pos.x + ',' + unit.pos.y;
    if (entry.lastPosKey === null) {
      // First placement — snap, don't tween.
      entry.currentX = targetX;
      entry.currentY = targetY;
      entry.container.x = targetX;
      entry.container.y = targetY;
    } else if (entry.lastPosKey !== posKey) {
      entry.tween = {
        startMs: performance.now(),
        fromX: entry.currentX,
        fromY: entry.currentY,
        toX: targetX,
        toY: targetY,
        duration: TWEEN_MS,
      };
      // 👣 Footprint at the starting tile — short-lived (3s) faint mark
      // so chasing the AI's path is visible without permanent clutter.
      // Heroes get a slightly larger print for character; decoys/units
      // share the default. Skipped for flying units — they don't track.
      if (!unit.flying) {
        try {
          spawnDecal('footprint', entry.currentX, entry.currentY - TILE * 0.08, {
            color: unit.owner === 'player' ? 0x6a5b3f : 0x5a3a3a,
          });
        } catch (e) {}
      }
    }
    entry.lastPosKey = posKey;

    // HP — detect damage and queue flash + shake.
    const hpPct = Math.max(0, Math.min(1, unit.currentHp / Math.max(1, unit.maxHp)));
    if (entry.lastHp != null && unit.currentHp < entry.lastHp) {
      const now = performance.now();
      entry.flashUntil = now + FLASH_MS;
      entry.shakeUntil = now + SHAKE_MS;
      // 💥 Damage burst — also catches damage from sources OTHER than the
      // attack cinematic (DoT, traps, environment, recoil). The battleAnim
      // hook already covers direct attacks; this is the catch-all so any
      // HP loss is visible. Color hints at HP severity: red on serious hits.
      const dmg = entry.lastHp - unit.currentHp;
      const heavy = dmg >= Math.max(2, unit.maxHp * 0.15);
      playFx({
        kind: 'burst',
        toUnit: unit.id,
        color: heavy ? 0xff4444 : 0xff8844,
        count: heavy ? 14 : 8,
        spread: heavy ? 52 : 38,
        duration: 420,
      });
      // 🔢 Damage number — read crit from the current battleAnim snapshot
      // if it targets this same unit, so the gold "crit" treatment lines up
      // with the cinematic. Otherwise treat as plain damage.
      const ba = window.App && App.ui && App.ui.battleAnim;
      const isCritOnMe = ba && ba.defender && ba.defender.id === unit.id && ba.crit;
      playFx({
        kind: 'damage-text',
        toUnit: unit.id,
        amount: dmg,
        variant: isCritOnMe ? 'crit' : 'damage',
      });
    } else if (entry.lastHp != null && unit.currentHp > entry.lastHp) {
      // 💚 Heal sparkles — also fires for any HP gain (regen passives,
      // location heal-zones, consumables, ally support).
      const heal = unit.currentHp - entry.lastHp;
      playFx({
        kind: 'heal',
        toUnit: unit.id,
        color: 0x88e088,
        count: 10,
        duration: 720,
      });
      playFx({
        kind: 'damage-text',
        toUnit: unit.id,
        amount: heal,
        variant: 'heal',
      });
    }
    if (entry.lastHpPct !== hpPct) {
      hpBarBg.clear();
      hpBar.clear();
      const barW = TILE * 0.7;
      const barX = -barW / 2;
      const barY = 8;
      hpBarBg.rect(barX, barY, barW, HP_BAR_H).fill({ color: 0x000000, alpha: 0.6 });
      const fillColor = unit.owner === 'player' ? PLAYER_TINT : ENEMY_TINT;
      hpBar.rect(barX, barY, barW * hpPct, HP_BAR_H).fill({ color: fillColor });
      entry.lastHpPct = hpPct;
    }
    entry.lastHp = unit.currentHp;

    // Status visibility — fade vanished / bleeding so the board reads at a glance.
    // (Only set when not in a flash window; flash decay handles its own alpha.)
    if (!entry.dying) {
      let alpha = 1;
      if (typeof isVanished === 'function' && isVanished(unit)) alpha = 0.35;
      if (unit._bleeding) alpha = Math.min(alpha, 0.55);
      entry.container.alpha = alpha;
    }

    // Z-sort by row so front-row units render over back-row.
    entry.container.zIndex = unit.pos.y * 100 + (unit.isHero ? 50 : 0);

    // Persistent status visuals (burn embers, poison bubbles, etc.).
    _syncStatusOverlays(entry, unit);
  }

  function _destroyUnitImmediate(id) {
    const entry = unitPool.get(id);
    if (!entry) return;
    entry.container.destroy({ children: true });
    unitPool.delete(id);
  }

  function _updateSelection() {
    const id = (window.App && App.ui && App.ui.selectedUnitId) || null;
    if (!id) {
      if (selectionRing) selectionRing.visible = false;
      return;
    }
    const unit = (App.state.units || []).find(u => u.id === id);
    if (!unit || !unit.pos || !unit.alive) {
      if (selectionRing) selectionRing.visible = false;
      return;
    }
    if (!selectionRing) {
      selectionRing = new PIXI.Graphics();
      selectionRing.circle(0, 0, TILE * 0.42).stroke({ color: SELECT_RING_COLOR, width: 3, alpha: 0.9 });
      highlightLayer.addChild(selectionRing);
    }
    selectionRing.visible = true;
    // Selection ring follows the sprite's tweened position, not the logical
    // tile, so it slides along during movement instead of teleporting ahead.
    const entry = unitPool.get(id);
    if (entry) {
      selectionRing.x = entry.currentX;
      selectionRing.y = entry.currentY - TILE * 0.4;
    } else {
      selectionRing.x = unit.pos.x * TILE + TILE / 2;
      selectionRing.y = unit.pos.y * TILE + TILE * 0.6;
    }
  }

  // ============================================================
  // PER-FRAME TICKER — runs at the display refresh rate. Advances
  // all visual effects without depending on renderBattle() firing.
  // ============================================================
  function _tick() {
    if (!mounted) return;
    const now = performance.now();

    // Decals fade/cull first — they're ground residue, lowest priority.
    _tickDecals(now);
    // Drive ambient particles next so they sit behind everything else.
    _tickAmbient(now);
    // Status overlays loop continuously while their statuses are present.
    _tickStatusOverlays(now);
    // Drive active VFX so they layer above units but below the unit z-sort.
    _tickVfx(now);
    // React to attack cinematics fired by the game.
    _watchBattleAnim();
    // React to hero ultimate cinematics — composite VFX + stage shake.
    _watchHeroUltCinematic();
    // React to Polycreation Fusion cinematics — multi-phase composite VFX.
    _watchPolyCine();
    // React to game over — brief flourish before/under the results modal.
    _watchGameOver();
    // React to AI movement — fire a fading arrow on the ghost tile.
    _watchAiMoveTrail();

    for (const [id, entry] of unitPool) {
      // ─── Summon animation (late arrivals) ────────────────────
      // Overrides the death fade-out check below because a unit
      // can't be both summoning and dying. Fades alpha 0→1 and
      // scales 0.1 → overshoot 1.15 → settle at 1.0 over SUMMON_MS.
      if (entry.summonStart != null) {
        const t = Math.min(1, (now - entry.summonStart) / SUMMON_MS);
        // 🩹 SLICE 15 FIX — alpha ramps 0.4 → 1.0 over the first 30% of the
        // animation. Pairs with the visible-floor initial alpha so a stalled
        // ticker never produces a permanently invisible unit.
        entry.container.alpha = t < 0.3 ? 0.4 + (t / 0.3) * 0.6 : 1;
        // Overshoot scale: 0..0.7 grows to 1.15, then 0.7..1 settles to 1.
        let s;
        if (t < 0.7) {
          s = 0.4 + (t / 0.7) * 0.75; // 0.4 → 1.15
        } else {
          const tt = (t - 0.7) / 0.3;
          s = 1.15 - tt * 0.15; // 1.15 → 1.0
        }
        entry.container.scale.set(s, s);
        if (t >= 1) {
          entry.summonStart = null;
          entry.container.alpha = 1;
          entry.container.scale.set(1, 1);
        }
      }

      // ─── Death fade-out ──────────────────────────────────────
      if (entry.dying) {
        const t = Math.min(1, (now - entry.dying.startMs) / entry.dying.duration);
        entry.container.alpha = 1 - t;
        const s = 1 + 0.15 * t;
        entry.container.scale.set(s, s);
        if (t >= 1) {
          // 🩸 Bloodstain decal at the unit's last position — left BEFORE
          // destroy so we read the entry's final world coords. Permanent
          // until the FIFO cap evicts it or the board unmounts.
          try {
            spawnDecal('bloodstain', entry.currentX, entry.currentY - TILE * 0.1, {
              size: entry.container && entry.container.scale && entry.container.scale.x > 1.2 ? 46 : 38,
            });
          } catch (e) {}
          _destroyUnitImmediate(id);
          continue;
        }
      }

      // ─── Cinematic dash (attacker lunge + recoil) ────────────
      // Takes priority over the regular tile-to-tile tween while active so
      // the dash motion isn't fought by the underlying position update.
      if (entry.cinemDash) {
        const cd = entry.cinemDash;
        const t = Math.min(1, (now - cd.startMs) / cd.duration);
        if (t < 0.5) {
          const tt = t / 0.5;
          const e = easeOutCubic(tt);
          entry.currentX = cd.fromX + (cd.dashX - cd.fromX) * e;
          entry.currentY = cd.fromY + (cd.dashY - cd.fromY) * e;
        } else {
          const tt = (t - 0.5) / 0.5;
          const e = easeOutCubic(tt);
          entry.currentX = cd.dashX + (cd.fromX - cd.dashX) * e;
          entry.currentY = cd.dashY + (cd.fromY - cd.dashY) * e;
        }
        if (t >= 1) entry.cinemDash = null;
      } else if (entry.tween) {
        // ─── Movement tween ──────────────────────────────────────
        const tw = entry.tween;
        const t = Math.min(1, (now - tw.startMs) / tw.duration);
        const e = easeOutCubic(t);
        entry.currentX = tw.fromX + (tw.toX - tw.fromX) * e;
        entry.currentY = tw.fromY + (tw.toY - tw.fromY) * e;
        if (t >= 1) entry.tween = null;
      }

      // ─── Damage shake (X jitter) ─────────────────────────────
      let shakeX = 0;
      if (now < entry.shakeUntil) {
        // Diminishing wobble — strongest at the start of the window.
        const remain = (entry.shakeUntil - now) / SHAKE_MS;
        shakeX = Math.sin(now * 0.08) * SHAKE_AMPLITUDE * remain;
      }
      entry.container.x = entry.currentX + shakeX;
      entry.container.y = entry.currentY;

      // ─── Damage flash (red tint) ─────────────────────────────
      if (now < entry.flashUntil) {
        entry.sprite.tint = FLASH_TINT;
      } else {
        entry.sprite.tint = entry.baseTint;
      }

      // ─── Frame cycling (idle anim) ───────────────────────────
      if (entry.frames.length > 1) {
        const idx = Math.floor((now + entry.phase) / FRAME_MS) % entry.frames.length;
        if (idx !== entry.frameIdx) {
          entry.sprite.texture = entry.frames[idx];
          // 🩹 SLICE 15 FIX — re-derive scale on every texture swap so
          // frames of different intrinsic sizes (rare but it happens with
          // dynamically-resolved card-art fallbacks) don't produce a
          // jumping or off-canvas sprite.
          _applySpriteSize(entry.sprite, entry.targetW, entry.targetH);
          entry.frameIdx = idx;
        }
      }
    }

    // Selection ring follows tweened position too.
    if (selectionRing && selectionRing.visible) {
      const id = window.App && App.ui && App.ui.selectedUnitId;
      const entry = id ? unitPool.get(id) : null;
      if (entry) {
        selectionRing.x = entry.currentX;
        selectionRing.y = entry.currentY - TILE * 0.4;
      }
    }
    // 🎬 Stage-level screen shake — applied LAST so every layer (units,
    // markers, ambient, decals, VFX) shakes together. Decays with the
    // remaining time so the wobble is strongest at the impact moment.
    if (stage) {
      if (now < cinemShakeUntil) {
        const remain = (cinemShakeUntil - now) / 360;
        stage.x = Math.sin(now * 0.06) * 6 * remain;
        stage.y = Math.cos(now * 0.07) * 4 * remain;
      } else if (stage.x !== 0 || stage.y !== 0) {
        stage.x = 0;
        stage.y = 0;
      }
    }
  }

  // ============================================================
  // TILE MARKERS — walls, locations, traps, events. Each tile can
  // host multiple stacked markers, so the pool key is "x,y:kind".
  //
  // The render here is intentionally minimal: an emoji glyph (or
  // an image sprite when uploaded art is present) plus, for walls,
  // an HP bar. We skip the rich decorative chrome the DOM renderer
  // adds (rarity glows, "MAINFRAME" labels, tier badges) — those
  // belong on the DOM overlay layer that floats over the canvas.
  // ============================================================
  const MARKER_KIND = { LOCATION: 'loc', WALL: 'wall', TRAP: 'trap', EVENT: 'event', SURFACE: 'surf' };

  // 🌋 Surface palette — color + icon per surface type. Mirrors the SURFACE_TYPES
  // table in the game's data layer; kept here as a tiny local lookup so the Pixi
  // renderer doesn't need to introspect the full SURFACE_TYPES definition. New
  // surface types added to the game just need an entry here.
  const SURFACE_VISUAL = {
    oil:      { color: 0x2a1b08, icon: '🛢', alpha: 0.55 },
    grease:   { color: 0x4a3f2a, icon: '🫧', alpha: 0.45 },
    water:    { color: 0x3a7fbf, icon: '💧', alpha: 0.42 },
    fire:     { color: 0xff5a2a, icon: '🔥', alpha: 0.55 },
    toxin:    { color: 0x4ca838, icon: '☠️', alpha: 0.40 },
    web:      { color: 0xc4c8d0, icon: '🕸', alpha: 0.35 },
    caltrops: { color: 0x8a7050, icon: '🌵', alpha: 0.40 },
    ice:      { color: 0x9be4ff, icon: '🧊', alpha: 0.40 },
    blood:    { color: 0x6a1a1a, icon: '🩸', alpha: 0.45 },
    steam:    { color: 0xcbd6df, icon: '💨', alpha: 0.35 },
  };

  function _markerKey(x, y, kind) { return x + ',' + y + ':' + kind; }

  function _makeEmojiText(emoji, size) {
    // Pixi v8 Text — uses system font for emoji glyphs. Cached internally so
    // repeated identical emoji are cheap.
    return new PIXI.Text({
      text: emoji || '?',
      style: {
        fontFamily: 'system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif',
        fontSize: size || 36,
        fill: 0xffffff,
        align: 'center',
      },
    });
  }

  function _placeAtTile(node, x, y) {
    // Tile markers sit centered on their cell. Anchor at 0.5/0.5 puts the
    // glyph's optical center on the tile center regardless of glyph width.
    if (node.anchor) node.anchor.set(0.5, 0.5);
    else { node.pivot && node.pivot.set(node.width / 2, node.height / 2); }
    node.x = x * TILE + TILE / 2;
    node.y = y * TILE + TILE / 2;
  }

  function _ensureMarker(x, y, kind) {
    const key = _markerKey(x, y, kind);
    let entry = tilePool.get(key);
    if (entry) return entry;
    const container = new PIXI.Container();
    container.x = x * TILE + TILE / 2;
    container.y = y * TILE + TILE / 2;
    markerLayer.addChild(container);
    entry = { container, kind, _sig: null, _glyph: null, _bar: null, _barBg: null, _label: null };
    tilePool.set(key, entry);
    return entry;
  }

  function _removeMarker(key) {
    const entry = tilePool.get(key);
    if (!entry) return;
    entry.container.destroy({ children: true });
    tilePool.delete(key);
  }

  function _updateLocationMarker(x, y, locationId) {
    const card = (typeof LOCATION_CARDS !== 'undefined')
      ? LOCATION_CARDS.find(c => c && c.id === locationId) : null;
    const icon = (card && card.icon) || '📍';
    // Prefer uploaded board image when available; falls back to emoji glyph.
    const uploaded = (typeof getLocationBoardImage === 'function') ? getLocationBoardImage(locationId) : null;
    const sig = uploaded ? 'img:' + uploaded : 'emoji:' + icon;
    const entry = _ensureMarker(x, y, MARKER_KIND.LOCATION);
    if (entry._sig === sig) return;
    if (entry._glyph) { entry._glyph.destroy(); entry._glyph = null; }
    if (uploaded) {
      const sprite = PIXI.Sprite.from(uploaded);
      sprite.anchor.set(0.5, 0.5);
      sprite.width = TILE * 0.7;
      sprite.height = TILE * 0.7;
      sprite.alpha = 0.85;
      entry.container.addChild(sprite);
      entry._glyph = sprite;
    } else {
      const txt = _makeEmojiText(icon, 32);
      txt.anchor.set(0.5, 0.5);
      txt.alpha = 0.85;
      entry.container.addChild(txt);
      entry._glyph = txt;
    }
    entry._sig = sig;
  }

  function _updateWallMarker(x, y, wall) {
    const entry = _ensureMarker(x, y, MARKER_KIND.WALL);
    const icon = wall.icon || '🧱';
    const pct = Math.max(0, Math.min(1, wall.hp / Math.max(1, wall.maxHp || 1)));
    // Signature captures every visible field — when nothing changed we
    // skip the redraw entirely.
    const sig = icon + '|' + pct.toFixed(3) + '|' + wall.owner;
    if (entry._sig === sig) return;
    if (entry._glyph) { entry._glyph.destroy(); entry._glyph = null; }
    if (entry._bar) { entry._bar.destroy(); entry._bar = null; }
    if (entry._barBg) { entry._barBg.destroy(); entry._barBg = null; }

    const txt = _makeEmojiText(icon, 36);
    txt.anchor.set(0.5, 0.5);
    txt.y = -6;
    entry.container.addChild(txt);
    entry._glyph = txt;

    // HP bar under the icon.
    const barW = TILE * 0.5;
    const barX = -barW / 2;
    const barY = 18;
    const bg = new PIXI.Graphics();
    bg.rect(barX, barY, barW, 5).fill({ color: 0x000000, alpha: 0.6 });
    const fill = new PIXI.Graphics();
    const color = wall.owner === 'player' ? PLAYER_TINT : ENEMY_TINT;
    fill.rect(barX, barY, barW * pct, 5).fill({ color });
    entry.container.addChild(bg, fill);
    entry._barBg = bg;
    entry._bar = fill;
    entry._sig = sig;
  }

  function _updateTrapMarker(x, y, trap) {
    // Match the DOM rule: only the trap's owner sees the marker. Enemy traps
    // are invisible until they fire (event-driven; nothing on the board to
    // render until then).
    if (!trap || trap.owner !== 'player') return false;
    const entry = _ensureMarker(x, y, MARKER_KIND.TRAP);
    const name = (trap.card && trap.card.name) || 'Trap';
    const sig = 'trap:' + name;
    if (entry._sig === sig) return true;
    if (entry._glyph) { entry._glyph.destroy(); entry._glyph = null; }
    // Face-down trap — render as a small dark plaque with the trap symbol.
    const plaque = new PIXI.Graphics();
    const w = TILE * 0.7, h = TILE * 0.55;
    plaque.roundRect(-w / 2, -h / 2, w, h, 6)
          .fill({ color: 0x1a1530, alpha: 0.85 })
          .stroke({ color: 0xa02828, width: 2, alpha: 0.9 });
    entry.container.addChild(plaque);
    const txt = _makeEmojiText('⚠️', 24);
    txt.anchor.set(0.5, 0.5);
    txt.y = -4;
    entry.container.addChild(txt);
    entry._glyph = plaque;     // hold the plaque as the primary visual
    entry._label = txt;
    entry._sig = sig;
    return true;
  }

  function _updateSurfaceMarker(x, y, surface) {
    if (!surface || !surface.type) return false;
    const vis = SURFACE_VISUAL[surface.type];
    if (!vis) return false;
    const turns = Math.max(0, surface.turnsLeft | 0);
    // Surfaces fade as their timer winds down — full alpha at 3+ turns,
    // tapering to a faint stain at 1 turn left. A timer of 0 means cleared
    // (caller should remove from state, but we render nothing just in case).
    if (turns <= 0) return false;
    const lifeFactor = Math.min(1, turns / 3);
    const sig = surface.type + '|' + turns;
    const entry = _ensureMarker(x, y, MARKER_KIND.SURFACE);
    if (entry._sig === sig) return true;
    // Tile container is centered on the tile (TILE/2, TILE/2). To fill the
    // cell with a colored quad we offset back to the corner.
    if (entry._glyph) { entry._glyph.destroy(); entry._glyph = null; }
    if (entry._label) { entry._label.destroy(); entry._label = null; }
    const quad = new PIXI.Graphics();
    quad.rect(-TILE / 2, -TILE / 2, TILE, TILE)
        .fill({ color: vis.color, alpha: vis.alpha * lifeFactor });
    entry.container.addChild(quad);
    entry._glyph = quad;
    const icon = _makeEmojiText(vis.icon, 22);
    icon.anchor.set(0.5, 0.5);
    icon.alpha = 0.85 * lifeFactor;
    icon.x = TILE / 2 - 16;
    icon.y = TILE / 2 - 16;
    entry.container.addChild(icon);
    entry._label = icon;
    entry._sig = sig;
    return true;
  }

  function _updateEventMarker(x, y, event) {
    const entry = _ensureMarker(x, y, MARKER_KIND.EVENT);
    const bi = event && event.boardIcon;
    let imageUrl = null;
    if (bi && bi.dataUrl) imageUrl = bi.dataUrl;
    else if (bi && bi.file) imageUrl = 'assets/artwork/Eventlocations/' + bi.file;
    const emoji = (event && event.def && event.def.icon) || '✨';
    const sig = imageUrl ? 'img:' + imageUrl : 'emoji:' + emoji;
    if (entry._sig === sig) return;
    if (entry._glyph) { entry._glyph.destroy(); entry._glyph = null; }
    if (imageUrl) {
      const sprite = PIXI.Sprite.from(imageUrl);
      sprite.anchor.set(0.5, 0.5);
      sprite.width = TILE * 0.75;
      sprite.height = TILE * 0.75;
      entry.container.addChild(sprite);
      entry._glyph = sprite;
    } else {
      const txt = _makeEmojiText(emoji, 32);
      txt.anchor.set(0.5, 0.5);
      entry.container.addChild(txt);
      entry._glyph = txt;
    }
    entry._sig = sig;
  }

  // Tracks which tiles currently host a fire surface, so when fire is
  // removed (decayed, doused, burnsAway) we can drop a scorch decal at
  // the right tile. Lives in renderer state — not gameplay state.
  const lastFireTiles = new Set();
  // 🧱 Per-tile wall HP tracking — fires burst VFX when HP drops and a bigger
  // explosion when the wall is destroyed. Keyed by "x,y", value is last HP.
  const lastWallHp = new Map();
  // 💣 Trap presence — set of "x,y" keys we've already rendered a trap marker
  // for. When a trap disappears (fires or expires), we play impact VFX.
  const lastTrapTiles = new Set();
  // ✨ Event-tile presence — same idea: when an event tile vanishes (player
  // moved onto it and the encounter triggered), play an arcane sparkle.
  const lastEventTiles = new Set();

  function _syncTiles() {
    if (!App.state || !Array.isArray(App.state.board)) return;
    const seen = new Set();
    // Snapshot current fire tiles so we can diff against lastFireTiles below.
    const currentFireTiles = new Set();
    // Snapshots for impact-VFX diffing — wall HP, trap presence, event presence.
    const currentWallHp = new Map();
    const currentTrapTiles = new Set();
    const currentEventTiles = new Set();
    for (let y = 0; y < App.state.board.length; y++) {
      const row = App.state.board[y];
      if (!Array.isArray(row)) continue;
      for (let x = 0; x < row.length; x++) {
        const tile = row[x];
        if (!tile) continue;
        if (tile.surface) {
          if (_updateSurfaceMarker(x, y, tile.surface)) {
            seen.add(_markerKey(x, y, MARKER_KIND.SURFACE));
          }
          if (tile.surface.type === 'fire') currentFireTiles.add(x + ',' + y);
        }
        if (tile.location) {
          _updateLocationMarker(x, y, tile.location);
          seen.add(_markerKey(x, y, MARKER_KIND.LOCATION));
        }
        if (tile.wall) {
          _updateWallMarker(x, y, tile.wall);
          seen.add(_markerKey(x, y, MARKER_KIND.WALL));
          currentWallHp.set(x + ',' + y, tile.wall.hp | 0);
        }
        if (tile.trap) {
          const rendered = _updateTrapMarker(x, y, tile.trap);
          if (rendered) seen.add(_markerKey(x, y, MARKER_KIND.TRAP));
          // Track presence regardless of who owns the trap — enemy traps
          // aren't rendered as markers but their disappearance (firing) is
          // still worth a VFX. We only get to know about enemy traps here
          // because they're stored in App.state.board[y][x].trap.
          currentTrapTiles.add(x + ',' + y);
        }
        if (tile.event) {
          _updateEventMarker(x, y, tile.event);
          seen.add(_markerKey(x, y, MARKER_KIND.EVENT));
          currentEventTiles.add(x + ',' + y);
        }
      }
    }
    // Remove any markers whose tile no longer hosts them (wall destroyed,
    // trap fired, location washed away, event consumed).
    for (const key of Array.from(tilePool.keys())) {
      if (!seen.has(key)) _removeMarker(key);
    }
    // 🔥 Scorch decals — any tile that HAD fire last sync but doesn't now
    // gets a permanent scorch mark. Catches fire decaying, being doused
    // by water (steam reaction), or burning out grease/web.
    for (const key of lastFireTiles) {
      if (!currentFireTiles.has(key)) {
        const [x, y] = key.split(',').map(n => +n);
        const wx = x * TILE + TILE / 2;
        const wy = y * TILE + TILE / 2;
        try { spawnDecal('scorch', wx, wy); } catch (e) {}
      }
    }
    lastFireTiles.clear();
    for (const key of currentFireTiles) lastFireTiles.add(key);

    // 🧱 Wall impact VFX — burst on HP drop, bigger explosion on destruction.
    // Wall HP drops can come from attacks (the battleAnim hook already fires
    // a projectile/burst on the attack target), but standalone wall damage
    // (e.g. AOE spell wash, environment) also belongs here.
    for (const [key, prevHp] of lastWallHp) {
      const curHp = currentWallHp.has(key) ? currentWallHp.get(key) : 0;
      if (curHp < prevHp) {
        const [x, y] = key.split(',').map(n => +n);
        const wx = x * TILE + TILE / 2;
        const wy = y * TILE + TILE / 2;
        if (curHp === 0) {
          // Wall destroyed — big stone-dust burst + bright flash. Stage
          // shake briefly because a wall coming down is a board-level event.
          playFx({ kind: 'burst', wx, wy, color: 0xc89a5f, count: 22, spread: 70, duration: 600 });
          playFx({ kind: 'flash', wx, wy, color: 0xe8d8c8, radius: 50, duration: 240 });
          playFx({ kind: 'ring',  wx, wy, color: 0xa88860, maxRadius: 60, duration: 380 });
          cinemShakeUntil = Math.max(cinemShakeUntil, performance.now() + 220);
        } else {
          // Wall damaged — small dust burst at the impact point.
          playFx({ kind: 'burst', wx, wy, color: 0xa88860, count: 8, spread: 38, duration: 360 });
        }
      }
    }
    lastWallHp.clear();
    for (const [key, hp] of currentWallHp) lastWallHp.set(key, hp);

    // 💣 Trap impact VFX — when a trap was on a tile last sync but isn't
    // now, it fired (or expired). Fire an element-colored burst + flash.
    // Use the trap's underlying card element if we can read it from the
    // OLD state, but we don't have a previous-state snapshot here — fall
    // back to red (blood/danger) which matches most trap art.
    for (const key of lastTrapTiles) {
      if (!currentTrapTiles.has(key)) {
        const [x, y] = key.split(',').map(n => +n);
        const wx = x * TILE + TILE / 2;
        const wy = y * TILE + TILE / 2;
        playFx({ kind: 'flash', wx, wy, color: 0xa02828, radius: 42, duration: 220 });
        playFx({ kind: 'burst', wx, wy, color: 0xff6b3c, count: 14, spread: 52, duration: 480 });
      }
    }
    lastTrapTiles.clear();
    for (const key of currentTrapTiles) lastTrapTiles.add(key);

    // ✨ Event-tile impact VFX — when an event icon disappears (player
    // moved onto it and the encounter triggered), play an arcane sparkle:
    // expanding ring + a small heal-like sparkle field. Purely cosmetic —
    // the game's own event modal still pops up.
    for (const key of lastEventTiles) {
      if (!currentEventTiles.has(key)) {
        const [x, y] = key.split(',').map(n => +n);
        const wx = x * TILE + TILE / 2;
        const wy = y * TILE + TILE / 2;
        playFx({ kind: 'ring', wx, wy, color: 0x8b5cf6, maxRadius: 64, duration: 520 });
        playFx({ kind: 'burst', wx, wy, color: 0xb29cff, count: 16, spread: 46, duration: 540 });
      }
    }
    lastEventTiles.clear();
    for (const key of currentEventTiles) lastEventTiles.add(key);
  }

  // ============================================================
  // TOMBSTONES — separate from tiles, lives in App.state.tombstones.
  // Glowing tombstones get a halo + countdown; lootable bodies get a
  // 💰 / risk-tier badge. Looted bodies stay greyed out.
  // ============================================================
  function _ensureTombstone(x, y) {
    const key = x + ',' + y;
    let entry = tombstonePool.get(key);
    if (entry) return entry;
    const container = new PIXI.Container();
    container.x = x * TILE + TILE / 2;
    container.y = y * TILE + TILE / 2;
    markerLayer.addChild(container);
    entry = { container, _sig: null, _glyph: null, _halo: null, _badge: null, _timer: null };
    tombstonePool.set(key, entry);
    return entry;
  }

  function _updateTombstone(ts) {
    const x = ts.x, y = ts.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const canLoot = ts.lootable && !ts.looted && !ts.glowing;
    const sig = [
      ts.image ? 'img' : 'emoji',
      ts.image || '',
      ts.glowing ? 'g' : '',
      canLoot ? 'l' : '',
      ts.looted ? 'd' : '',
      ts.turnsLeft || 0,
    ].join('|');
    const entry = _ensureTombstone(x, y);
    if (entry._sig === sig) return;
    if (entry._glyph) { entry._glyph.destroy(); entry._glyph = null; }
    if (entry._halo) { entry._halo.destroy(); entry._halo = null; }
    if (entry._badge) { entry._badge.destroy(); entry._badge = null; }
    if (entry._timer) { entry._timer.destroy(); entry._timer = null; }

    // Glow halo — drawn first so it sits behind the body.
    if (ts.glowing) {
      const halo = new PIXI.Graphics();
      halo.circle(0, 0, TILE * 0.42).fill({ color: 0xf5d76e, alpha: 0.22 });
      halo.circle(0, 0, TILE * 0.34).fill({ color: 0xf5d76e, alpha: 0.18 });
      entry.container.addChild(halo);
      entry._halo = halo;
    }

    // Body sprite or fallback emoji.
    if (ts.image) {
      const sprite = PIXI.Sprite.from(ts.image);
      sprite.anchor.set(0.5, 0.5);
      sprite.width = TILE * 0.7;
      sprite.height = TILE * 0.7;
      if (ts.looted) sprite.alpha = 0.4;
      entry.container.addChild(sprite);
      entry._glyph = sprite;
    } else {
      const txt = _makeEmojiText('🪦', 36);
      txt.anchor.set(0.5, 0.5);
      if (ts.looted) txt.alpha = 0.4;
      entry.container.addChild(txt);
      entry._glyph = txt;
    }

    // Loot / looted / glowing badge in the top-right.
    let badgeEmoji = null;
    if (ts.looted) badgeEmoji = '✅';
    else if (canLoot) badgeEmoji = '💰';
    if (badgeEmoji) {
      const b = _makeEmojiText(badgeEmoji, 18);
      b.anchor.set(0.5, 0.5);
      b.x = TILE * 0.28;
      b.y = -TILE * 0.28;
      entry.container.addChild(b);
      entry._badge = b;
    }
    // Countdown number on glowing tombstones.
    if (ts.glowing) {
      const t = new PIXI.Text({
        text: String(ts.turnsLeft || 0),
        style: { fontFamily: 'Cinzel, serif', fontSize: 18, fill: 0xf5d76e, fontWeight: 'bold' },
      });
      t.anchor.set(0.5, 0.5);
      t.y = TILE * 0.3;
      entry.container.addChild(t);
      entry._timer = t;
    }
    entry._sig = sig;
  }

  function _syncTombstones() {
    const list = (App.state && Array.isArray(App.state.tombstones)) ? App.state.tombstones : [];
    const seen = new Set();
    for (const ts of list) {
      if (!ts || typeof ts.x !== 'number') continue;
      seen.add(ts.x + ',' + ts.y);
      _updateTombstone(ts);
    }
    for (const key of Array.from(tombstonePool.keys())) {
      if (!seen.has(key)) {
        const entry = tombstonePool.get(key);
        entry.container.destroy({ children: true });
        tombstonePool.delete(key);
      }
    }
  }

  // ============================================================
  // DECALS — Persistent ground residue from MSPixiDecals registry.
  // Pool is FIFO-bounded at DECAL_CAP. Each frame the ticker calls
  // fade(now) on every decal (when defined) and culls finite-lifetime
  // decals whose age exceeds their lifetime.
  // ============================================================
  function spawnDecal(kind, wx, wy, opts) {
    if (typeof MSPixiDecals === 'undefined' || !MSPixiDecals.effects[kind]) return null;
    if (!decalLayer) return null;
    const decal = MSPixiDecals.effects[kind](opts || {});
    if (!decal || !decal.display) return null;
    decal.born = performance.now();
    decal.display.x = wx;
    decal.display.y = wy;
    decalLayer.addChild(decal.display);
    decals.push(decal);
    // Evict the oldest to keep the pool bounded. Permanent decals (lifetime
    // === Infinity) are still subject to the cap — old bloodstains fade out
    // of memory when new ones arrive past the cap, by design.
    while (decals.length > DECAL_CAP) {
      const old = decals.shift();
      try { old.display.destroy({ children: true }); } catch (e) {}
    }
    return decal;
  }

  function _tickDecals(now) {
    if (!decals.length) return;
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i];
      if (d.fade) {
        try { d.fade(now); } catch (e) {}
      }
      if (Number.isFinite(d.lifetime) && (now - d.born) >= d.lifetime) {
        try { d.display.destroy({ children: true }); } catch (e) {}
        decals.splice(i, 1);
      }
    }
  }

  // ============================================================
  // AMBIENT — weather-driven board-wide particle drift. We instantiate
  // one effect from MSPixiAmbient at a time. _updateAmbient() picks the
  // right kind from App.state.weather; when the kind changes (or the
  // first time it runs), we swap the active effect.
  // ============================================================
  function _updateAmbient() {
    if (typeof MSPixiAmbient === 'undefined' || !ambientLayer) return;
    const weather = (window.App && App.state && App.state.weather) || null;
    const kind = MSPixiAmbient.kindForWeather(weather);
    if (kind === lastAmbientKind && ambientFx) return;
    // Swap. Destroy the previous effect's display before creating a new one
    // so a long mid-battle change (e.g. Sandstorm wears off → motes) doesn't
    // leak particles into the canvas.
    if (ambientFx && ambientFx.display) {
      ambientFx.display.destroy({ children: true });
      ambientFx = null;
    }
    ambientFx = MSPixiAmbient.create(kind);
    if (ambientFx && ambientFx.display) ambientLayer.addChild(ambientFx.display);
    lastAmbientKind = kind;
  }

  function _tickAmbient(now) {
    if (ambientFx && ambientFx.tick) {
      try { ambientFx.tick(now); } catch (e) { /* a bad ambient should never break the board */ }
    }
  }

  // ============================================================
  // STATUS OVERLAYS — per-unit looping visuals attached to the
  // unit container. Matched against unit.statusEffects each sync;
  // missing entries are removed, new ones get a factory from
  // MSPixiStatus.getFactory(type). Loops run on the main ticker.
  // ============================================================
  function _syncStatusOverlays(entry, unit) {
    if (typeof MSPixiStatus === 'undefined') return;
    if (!entry.statusOverlays) entry.statusOverlays = new Map();
    const wanted = new Set();
    const list = Array.isArray(unit.statusEffects) ? unit.statusEffects : [];
    // Stack overlays horizontally above the unit so multiple statuses
    // don't pile on top of each other. We assign x-offsets in iteration
    // order; for 1-2 overlays we keep them roughly centered.
    let idx = 0;
    for (const eff of list) {
      if (!eff || !eff.type) continue;
      wanted.add(eff.type);
      let ov = entry.statusOverlays.get(eff.type);
      if (!ov) {
        const factory = MSPixiStatus.getFactory(eff.type);
        const built = factory();
        if (!built || !built.display) continue;
        entry.container.addChild(built.display);
        ov = built;
        entry.statusOverlays.set(eff.type, ov);
      }
      idx++;
    }
    // Position the overlays — fan them out a bit when there are several.
    const total = entry.statusOverlays.size;
    let i = 0;
    for (const [, ov] of entry.statusOverlays) {
      if (!ov.display) { i++; continue; }
      const center = (total - 1) / 2;
      ov.display.x = (i - center) * 14;
      i++;
    }
    // Remove overlays whose status dropped off.
    for (const [type, ov] of Array.from(entry.statusOverlays)) {
      if (!wanted.has(type)) {
        try { ov.display.destroy({ children: true }); } catch (e) {}
        entry.statusOverlays.delete(type);
      }
    }
  }

  function _tickStatusOverlays(now) {
    for (const [, entry] of unitPool) {
      if (!entry.statusOverlays) continue;
      for (const [, ov] of entry.statusOverlays) {
        if (ov && ov.tick) {
          try { ov.tick(now); } catch (e) {}
        }
      }
    }
  }

  // ============================================================
  // VFX — generic effect player. Translates unit refs / tile coords
  // to world pixel coords, dispatches to MSPixiVfx.effects[kind],
  // and registers the resulting state machine with the ticker.
  //
  // Callable from anywhere:
  //   MSPixiBoard.playFx({ kind: 'burst', fromUnit: 'unit-id', color: 0xff6b3c })
  //   MSPixiBoard.playFx({ kind: 'projectile', fromUnit, toUnit })
  //   MSPixiBoard.playFx({ kind: 'flash', wx: 300, wy: 200 })
  //
  // opts:
  //   kind       — registered kind in MSPixiVfx.effects
  //   fromUnit   — unit.id; resolved to its current tweened world pos
  //   toUnit     — unit.id; resolved to its current tweened world pos
  //   tile       — { x, y }; resolved to tile center world pos
  //   wx, wy     — explicit world coords (override unit/tile)
  //   color      — explicit hex; otherwise factory default
  //   element    — element name; resolves to color when color absent
  //   ...rest    — passed through to the effect factory
  // ============================================================
  function _unitWorldPos(unitId) {
    if (!unitId) return null;
    const entry = unitPool.get(unitId);
    if (entry) return { x: entry.currentX, y: entry.currentY - TILE * 0.4 };
    // Fall back to state lookup when sprite hasn't been pooled yet.
    const u = (App.state.units || []).find(x => x && x.id === unitId);
    if (u && u.pos) {
      return { x: u.pos.x * TILE + TILE / 2, y: u.pos.y * TILE + TILE - TILE * 0.4 };
    }
    return null;
  }

  function _tileWorldCenter(tile) {
    if (!tile) return null;
    return { x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2 };
  }

  function playFx(opts) {
    if (!mounted || !opts || !opts.kind) return null;
    if (typeof MSPixiVfx === 'undefined' || !MSPixiVfx.effects[opts.kind]) {
      console.warn('[pixi-board] unknown VFX kind:', opts && opts.kind);
      return null;
    }
    // Resolve source/target coords.
    let from = null, to = null;
    if (opts.fromUnit) from = _unitWorldPos(opts.fromUnit);
    if (opts.toUnit) to = _unitWorldPos(opts.toUnit);
    if (!from && opts.fromTile) from = _tileWorldCenter(opts.fromTile);
    if (!to && opts.tile) to = _tileWorldCenter(opts.tile);
    // World coords override everything when explicitly given.
    const wx = opts.wx != null ? opts.wx : (to ? to.x : (from ? from.x : 0));
    const wy = opts.wy != null ? opts.wy : (to ? to.y : (from ? from.y : 0));
    const color = opts.color != null
      ? opts.color
      : (opts.element ? MSPixiVfx.colorForElement(opts.element) : undefined);
    // Build the factory-specific opts.
    const factoryOpts = Object.assign({}, opts, {
      wx, wy,
      fx: from ? from.x : wx,
      fy: from ? from.y : wy,
      tx: to ? to.x : wx,
      ty: to ? to.y : wy,
      color,
    });
    const fx = MSPixiVfx.effects[opts.kind](factoryOpts);
    if (!fx || !fx.display) return null;
    fx.startMs = performance.now();
    vfxLayer.addChild(fx.display);
    activeFx.push(fx);
    return fx;
  }

  function _tickVfx(now) {
    if (!activeFx.length) return;
    for (let i = activeFx.length - 1; i >= 0; i--) {
      const fx = activeFx[i];
      try { fx.tick(now); } catch (e) { /* never let one bad effect break the loop */ }
      if (fx.done(now)) {
        fx.display.destroy({ children: true });
        activeFx.splice(i, 1);
      }
    }
  }

  // ============================================================
  // AUTO-HOOK — react to App.ui.battleAnim transitions. The DOM
  // cinematic still fires its overlay; we add board-level VFX so
  // the action is also visible in the play area, not just in the
  // modal. Only fires once per unique `startedAt` so a stuck/lingering
  // battleAnim doesn't spam projectiles every frame.
  // ============================================================
  function _watchBattleAnim() {
    const ba = window.App && App.ui && App.ui.battleAnim;
    if (!ba || !ba.startedAt) return;
    if (ba.startedAt === lastBattleAnimStartedAt) return;
    lastBattleAnimStartedAt = ba.startedAt;
    const move = ba.move || {};
    const color = MSPixiVfx.colorForElement(move.element);
    const atkId = ba.attacker && ba.attacker.id;
    const defId = ba.defender && ba.defender.id;
    if (!atkId || !defId) return;
    if (ba.missed) {
      // Whiffed swing — small flash at the defender + a "MISS" tag so the
      // outcome is unmistakable. The flash hints at the element they tried.
      playFx({ kind: 'flash', fromUnit: defId, toUnit: defId, color, radius: 28, duration: 180 });
      playFx({ kind: 'damage-text', toUnit: defId, amount: 0, variant: 'miss' });
      // Still play the attacker dash so the action reads as an attempt.
      _startCinemDash(atkId, defId);
      _showMoveBanner(defId, move, color);
      return;
    }
    // 🎬 In-board cinematic — attacker dashes forward, banner labels the
    // move, projectile travels, impact burst lands, crit gets a shockwave
    // ring + stage-level screen shake. The DOM full-screen overlay is
    // suppressed in this mode (see index.html renderBattleAnim gate).
    _startCinemDash(atkId, defId);
    _showMoveBanner(defId, move, color);
    playFx({ kind: 'projectile', fromUnit: atkId, toUnit: defId, color, duration: 280 });
    setTimeout(() => {
      playFx({ kind: 'burst', toUnit: defId, color, count: ba.crit ? 18 : 12, spread: ba.crit ? 64 : 48 });
      if (ba.crit) {
        playFx({ kind: 'ring', toUnit: defId, color, maxRadius: 70, duration: 420 });
        // Stage shake — the biggest visceral payoff for crits, lasts ~360ms.
        cinemShakeUntil = performance.now() + 360;
      }
    }, 240);
  }

  function _startCinemDash(atkId, defId) {
    if (!atkId || !defId) return;
    const atk = unitPool.get(atkId);
    const def = unitPool.get(defId);
    if (!atk || !def) return;
    // Dash 35% of the way toward the defender, then return. Total ~560ms so
    // the recoil completes BEFORE the projectile/burst lands (~520ms after
    // start), which makes the strike read as a single committed motion.
    const dx = def.currentX - atk.currentX;
    const dy = def.currentY - atk.currentY;
    atk.cinemDash = {
      startMs: performance.now(),
      duration: 560,
      fromX: atk.currentX,
      fromY: atk.currentY,
      dashX: atk.currentX + dx * 0.35,
      dashY: atk.currentY + dy * 0.35,
    };
  }

  function _showMoveBanner(defId, move, color) {
    const def = unitPool.get(defId);
    if (!def) return;
    // 🎯 Use the move's element-emoji if we can resolve it from STATUS_EFFECTS
    // -style data; otherwise leave it out. The move object snapshotted into
    // battleAnim carries { id, name, element, kind, type } — name is the key
    // user-facing string.
    const icon = _moveIconFor(move);
    playFx({
      kind: 'move-banner',
      wx: def.currentX,
      wy: def.currentY - TILE * 0.75,
      name: move && move.name ? String(move.name) : '?',
      icon,
      color,
      duration: 1100,
    });
  }

  // Element → emoji mapping for the banner. Mirrors common element names
  // game-side; falls back to a generic ✦ when unknown.
  const _ELEMENT_GLYPH = {
    fire: '🔥', water: '💧', nature: '🌿', earth: '⛰', air: '🌬', wind: '🌬',
    arcane: '✨', void: '🌀', light: '☀', holy: '☀', dark: '🌑', shadow: '🌑',
    ice: '❄', frost: '❄', lightning: '⚡', electric: '⚡', storm: '⚡',
    poison: '☠', blood: '🩸', physical: '⚔', neutral: '⚔',
  };
  function _moveIconFor(move) {
    if (!move) return '✦';
    const el = move.element ? String(move.element).toLowerCase() : null;
    if (el && _ELEMENT_GLYPH[el]) return _ELEMENT_GLYPH[el];
    return '✦';
  }

  // ============================================================
  // HERO ULT CINEMATIC — watches App.ui.heroUltCinematic and fires
  // the composite ult-cine VFX targeting the hero's current world
  // position. Also kicks the stage shake at the climax so the
  // unleash moment shakes the entire board (same juice as a crit).
  // The DOM full-screen overlay is suppressed in Pixi mode (see
  // index.html renderHeroUltCinematic gate).
  // ============================================================
  function _watchHeroUltCinematic() {
    const cine = window.App && App.ui && App.ui.heroUltCinematic;
    if (!cine || !cine.startedAt) return;
    if (cine.startedAt === lastHeroUltStartedAt) return;
    lastHeroUltStartedAt = cine.startedAt;
    const heroId = cine.heroUnitId;
    const def = cine.def || {};
    if (!heroId) return;
    const entry = unitPool.get(heroId);
    let wx, wy;
    if (entry) {
      wx = entry.currentX;
      wy = entry.currentY - TILE * 0.4;
    } else {
      // Fall back to state lookup if the unit isn't pooled yet.
      const hero = (App.state.units || []).find(u => u && u.id === heroId);
      if (!hero || !hero.pos) return;
      wx = hero.pos.x * TILE + TILE / 2;
      wy = hero.pos.y * TILE + TILE * 0.6;
    }
    const hero = (App.state.units || []).find(u => u && u.id === heroId);
    // Element-color the cinematic: prefer the ult's element if it has one,
    // fall back to the hero's first element, fall back to legendary gold.
    let color = 0xf5d76e;
    try {
      const el = def.element || (hero && hero.elements && hero.elements[0]);
      if (el) color = MSPixiVfx.colorForElement(el);
    } catch (e) {}
    playFx({
      kind: 'ult-cine',
      wx, wy,
      heroName: hero ? hero.name : 'Hero',
      ultName: def.name || 'ULTIMATE',
      color,
      boardW: 8 * TILE,
      boardH: 7 * TILE,
      duration: 1100,
    });
    // Stage shake at the climax — the same effect we use for crits, scheduled
    // ~700ms into the cinematic so the shockwave + shake land together.
    setTimeout(() => {
      cinemShakeUntil = performance.now() + 460;
    }, 700);
  }

  // ============================================================
  // POLYCREATION FUSION CINEMATIC — watches App.ui.polyCine for a
  // new startedAt and fires the composite poly-cine VFX centered
  // on the board. Reads the active fusion card + kalon name from
  // App.ui.fusionMode so the result reveal shows the right unit.
  // ============================================================
  function _watchPolyCine() {
    const pc = window.App && App.ui && App.ui.polyCine;
    if (!pc || !pc.startedAt) {
      lastPolyCineStartedAt = 0; // arm for next fusion
      return;
    }
    if (pc.startedAt === lastPolyCineStartedAt) return;
    lastPolyCineStartedAt = pc.startedAt;
    const fm = App.ui.fusionMode || {};
    // Best-effort name + icon lookup for the Kalon being summoned.
    let kalonName = 'KALON';
    let kalonIcon = '🌌';
    try {
      const card = App.state && App.state.player && App.state.player.hand
        && App.state.player.hand.find(c => c && c.instanceId === fm.cardInstanceId);
      const kalon = card && typeof getFusionKalonForSpell === 'function'
        ? getFusionKalonForSpell(card) : null;
      if (kalon) {
        kalonName = String(kalon.name || kalonName);
        if (kalon.icon) kalonIcon = String(kalon.icon);
      }
    } catch (e) {}
    playFx({
      kind: 'poly-cine',
      wx: 8 * TILE / 2,  // board center
      wy: 7 * TILE / 2,
      kalonName,
      kalonIcon,
      color: 0x8b5cf6,
      boardW: 8 * TILE,
      boardH: 7 * TILE,
      duration: pc.totalMs || 5200,
    });
    // Two stage shakes — one at the climax (~58% of 5200ms = 3000ms), and
    // a smaller one at the final reveal (~78% = 4060ms).
    setTimeout(() => { cinemShakeUntil = performance.now() + 360; }, 3000);
    setTimeout(() => { cinemShakeUntil = performance.now() + 200; }, 4060);
  }

  // ============================================================
  // VICTORY MOMENT — fires when App.state.gameOver transitions from
  // falsy to a winner string ('player' or 'ai'). Adds an in-board
  // flourish before/under the existing DOM results modal: golden
  // rays + rings on the player's hero for wins, red dim for losses.
  // ============================================================
  function _watchGameOver() {
    const go = window.App && App.state && App.state.gameOver;
    if (go === lastGameOver) return;
    if (!lastGameOver && go) {
      // Transition from no-game-over → game-over. Fire the flourish.
      const isWin = go === 'player';
      // Anchor on the WINNER's hero so the rays burst from them. If we
      // can't find a hero (mid-game weirdness), center on the board.
      const winnerOwner = isWin ? 'player' : 'ai';
      const hero = (App.state.units || []).find(u => u && u.isHero && u.owner === winnerOwner && u.alive);
      let wx, wy;
      if (hero) {
        const entry = unitPool.get(hero.id);
        if (entry) { wx = entry.currentX; wy = entry.currentY - TILE * 0.4; }
        else { wx = hero.pos.x * TILE + TILE / 2; wy = hero.pos.y * TILE + TILE / 2; }
      } else {
        wx = 8 * TILE / 2;
        wy = 7 * TILE / 2;
      }
      playFx({
        kind: 'victory-moment',
        wx, wy,
        variant: isWin ? 'win' : 'loss',
        color: isWin ? 0xf5d76e : 0xa02828,
        boardW: 8 * TILE,
        boardH: 7 * TILE,
        duration: 1400,
      });
      // Final stage shake on wins for emphasis. Losses skip the shake — feels
      // wrong to "celebrate" a defeat with screen-shake juice.
      if (isWin) cinemShakeUntil = performance.now() + 280;
    }
    lastGameOver = go;
  }

  // ============================================================
  // AI MOVE TRAIL — watches App.ui.aiMoveTrail and fires a one-shot
  // arrow VFX from the AI's previous tile to its current one. Clears
  // the watcher when the trail is removed so a fresh trail fires.
  // ============================================================
  function _watchAiMoveTrail() {
    const t = window.App && App.ui && App.ui.aiMoveTrail;
    if (!t || !t.from || !t.to) {
      lastAiTrailKey = ''; // trail cleared — arm for the next one
      return;
    }
    const key = t.from.x + ',' + t.from.y + '->' + t.to.x + ',' + t.to.y;
    if (key === lastAiTrailKey) return;
    lastAiTrailKey = key;
    const fx = t.from.x * TILE + TILE / 2;
    const fy = t.from.y * TILE + TILE / 2;
    const tx = t.to.x * TILE + TILE / 2;
    const ty = t.to.y * TILE + TILE / 2;
    playFx({ kind: 'move-trail', wx: fx, wy: fy, fx, fy, tx, ty, color: 0xe85d3c, duration: 1100 });
  }

  function sync() {
    if (!mounted || !window.App || !App.state || !Array.isArray(App.state.units)) return;
    // 🩹 SLICE 15 FIX — fresh-battle detection. If none of the units in the
    // current state are already known to the pool (i.e. the previous
    // battle's units are all gone), reset firstSyncComplete so the
    // about-to-be-created sprites are treated as initial spawns rather
    // than late arrivals. Without this, returning to the battle screen
    // after exiting one battle would fire the summon animation on every
    // unit of the next battle, and any ticker stall mid-animation would
    // leave them invisible. Belt-and-suspenders with the scale floor in
    // _ensureUnitSprite.
    if (firstSyncComplete && App.state.units.length > 0) {
      const anyKnown = App.state.units.some(u => u && u.id && unitPool.has(u.id));
      if (!anyKnown) firstSyncComplete = false;
    }
    _updateAmbient();
    _syncTiles();
    _syncTombstones();
    const seen = new Set();
    for (const u of App.state.units) {
      if (!u || !u.id) continue;
      seen.add(u.id);
      _updateUnit(u);
    }
    // Anything in the pool but not in state — kick off death fade if not already.
    for (const [id, entry] of unitPool) {
      if (!seen.has(id) && !entry.dying) {
        entry.dying = { startMs: performance.now(), duration: DEATH_MS };
      }
    }
    _updateSelection();
    // 🃏 Mark first sync as complete AFTER processing — so the units present
    // at battle init don't trigger summon animations, but any unit added on
    // a later sync (a played card) does.
    firstSyncComplete = true;
  }

  function destroy() {
    mounted = false;
    if (selectionRing) { selectionRing.destroy(); selectionRing = null; }
    for (const id of Array.from(unitPool.keys())) _destroyUnitImmediate(id);
    for (const key of Array.from(tilePool.keys())) _removeMarker(key);
    for (const [key, entry] of tombstonePool) {
      entry.container.destroy({ children: true });
    }
    tombstonePool.clear();
    // Tear down any in-flight VFX so a flag flip mid-battle doesn't leak
    // orphaned displays into the next mount.
    for (const fx of activeFx) {
      try { fx.display.destroy({ children: true }); } catch (e) {}
    }
    activeFx.length = 0;
    lastBattleAnimStartedAt = 0;
    lastAiTrailKey = '';
    cinemShakeUntil = 0;
    lastHeroUltStartedAt = 0;
    lastPolyCineStartedAt = 0;
    lastGameOver = null;
    firstSyncComplete = false;
    // Ambient effect — destroy and forget so a fresh mount re-selects
    // based on the new battle's weather state.
    if (ambientFx && ambientFx.display) {
      try { ambientFx.display.destroy({ children: true }); } catch (e) {}
    }
    ambientFx = null;
    lastAmbientKind = null;
    // Decals — wipe on unmount so a fresh battle isn't pre-littered with
    // the previous battle's residue.
    for (const d of decals) {
      try { d.display.destroy({ children: true }); } catch (e) {}
    }
    decals.length = 0;
    lastFireTiles.clear();
    lastWallHp.clear();
    lastTrapTiles.clear();
    lastEventTiles.clear();
    if (app) {
      if (app.canvas.parentNode) app.canvas.parentNode.removeChild(app.canvas);
    }
    mountEl = null;
  }

  window.MSPixiBoard = {
    mount, sync, destroy, playFx, spawnDecal,
    _internals: { unitPool, tilePool, tombstonePool, activeFx, decals },
  };
})();
