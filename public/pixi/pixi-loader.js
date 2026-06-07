// ============================================================
// PIXI ASSET LOADER — slice 1 hybrid port
// ------------------------------------------------------------
// Bridges Mythic Spellbook's runtime sprite store (Forge.sprites,
// Forge.cardArt) to PixiJS v8's Assets cache. Sprite URLs are
// already resolved at runtime (data URIs or /assets/* paths), so
// we just call Assets.load(url) on whatever the existing helpers
// hand back — no filesystem walking, no manifest.
//
// Public surface:
//   MSPixiLoader.warmForBattle(state)  → Promise<void>
//     Preloads every sprite/art URL referenced by units currently
//     on the board. Idempotent and cached across battles.
//
//   MSPixiLoader.textureForUnit(unit)  → PIXI.Texture | null
//     Synchronous lookup once warmForBattle resolved. Returns a
//     placeholder Texture.EMPTY if the asset hasn't loaded yet,
//     so the board never throws on stragglers.
// ============================================================
(function () {
  const cache = new Map(); // url → Promise<PIXI.Texture>
  const ready = new Map(); // url → PIXI.Texture (resolved)

  function urlsForUnit(unit) {
    if (!unit) return [];
    const urls = new Set();
    try {
      const sId = (typeof getSpriteId === 'function') ? getSpriteId(unit) : null;
      if (sId && typeof getSpriteFrames === 'function') {
        const idle = getSpriteFrames(sId, 'idle');
        if (idle) idle.forEach(u => u && urls.add(u));
        const atk = getSpriteFrames(sId, 'attack');
        if (atk) atk.forEach(u => u && urls.add(u));
      }
      // Static card art fallback.
      const ids = [unit.heroId, unit.originalCardId, unit.cardId, unit.id].filter(Boolean);
      if (typeof getCardArt === 'function') {
        for (const id of ids) {
          const art = getCardArt(id);
          if (art) { urls.add(art); break; }
        }
      }
    } catch (e) { /* defensive — never break the existing renderer */ }
    return Array.from(urls);
  }

  function loadOne(url) {
    if (!url) return Promise.resolve(null);
    if (ready.has(url)) return Promise.resolve(ready.get(url));
    if (cache.has(url)) return cache.get(url);
    const p = PIXI.Assets.load(url)
      .then(tex => { ready.set(url, tex); return tex; })
      .catch(err => {
        console.warn('[pixi-loader] failed:', url, err);
        return null;
      });
    cache.set(url, p);
    return p;
  }

  async function warmForBattle(state) {
    if (!state || !Array.isArray(state.units)) return;
    const urls = new Set();
    for (const u of state.units) {
      for (const url of urlsForUnit(u)) urls.add(url);
    }
    await Promise.all(Array.from(urls).map(loadOne));
  }

  function textureForUnit(unit) {
    if (!unit) return PIXI.Texture.EMPTY;
    // Prefer the first idle frame if loaded; fall back through the same
    // priority order the DOM unitBoardVisual() uses.
    try {
      const sId = (typeof getSpriteId === 'function') ? getSpriteId(unit) : null;
      if (sId && typeof getSpriteFrames === 'function') {
        const frames = getSpriteFrames(sId, 'idle') || getSpriteFrames(sId, 'attack');
        if (frames && frames.length) {
          const url = frames[0];
          if (ready.has(url)) return ready.get(url);
          loadOne(url); // kick off lazy load for next render
        }
      }
      const ids = [unit.heroId, unit.originalCardId, unit.cardId, unit.id].filter(Boolean);
      if (typeof getCardArt === 'function') {
        for (const id of ids) {
          const art = getCardArt(id);
          if (art) {
            if (ready.has(art)) return ready.get(art);
            loadOne(art);
            break;
          }
        }
      }
    } catch (e) {}
    return PIXI.Texture.EMPTY;
  }

  // 🎞 Returns the array of loaded Textures for a unit's animation (idle by
  // default, falls back to attack frames). Used by the board's frame-cycle
  // ticker — swaps sprite.texture in order to play sheet animations. Returns
  // an empty array when no frames are ready yet (caller keeps current texture).
  function framesForUnit(unit, anim) {
    if (!unit) return [];
    try {
      const sId = (typeof getSpriteId === 'function') ? getSpriteId(unit) : null;
      if (!sId || typeof getSpriteFrames !== 'function') return [];
      const urls = getSpriteFrames(sId, anim || 'idle') || getSpriteFrames(sId, 'attack');
      if (!urls || !urls.length) return [];
      const out = [];
      for (const url of urls) {
        if (!url) continue;
        if (ready.has(url)) out.push(ready.get(url));
        else loadOne(url); // lazy-warm anything missed
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  window.MSPixiLoader = { warmForBattle, textureForUnit, framesForUnit, _cache: cache, _ready: ready };
})();
