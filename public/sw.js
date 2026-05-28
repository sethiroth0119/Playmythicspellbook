// Mythic Spellbook — Service Worker
// ----------------------------------------------------------------------------
// The game is one giant index.html (~5MB) + a folder of assets. Two strategies:
//
//   1. NETWORK-FIRST for navigations / index.html → so an updated deploy is
//      reflected on next refresh without aggressive cache invalidation.
//   2. CACHE-FIRST for everything else (artwork, audio, supabase JS) → fast
//      cold-loads after install + offline playback of the title/cached pages.
//
// The cache version below is bumped automatically each deploy via the build
// scripts (they replace the literal CACHE_VERSION below). For now the version
// is the deploy timestamp at the time the SW is written — every fresh deploy
// flushes the prior cache so the new asset versions are picked up.
// ============================================================================

// Version history (2026-05-25 → 2026-05-27, v1–v19):
//   Battle-hang defenses, Card Forge soft-gate, War Map admin gate,
//   Colyseus MP bridge (disabled by flag), charge-move range check,
//   guide system hardening, Crash Exchange share-market exploit fix,
//   admin auto-publish, CX-holdings triple-persistence, bunker hero
//   sprites, stress mechanic (cost surcharge + camp relief), cross-
//   device cloud sync, onboarding race-condition fix, tutorial auto-
//   complete on battle exit.
//
// v20 — Card access policy: new players receive only their chosen
// starter deck. _grantAllCatalogCardsToNewPlayer() is admin-only.
// v21 — Terms of Service modal: ToS button in hub footer, full ToS text
// from Hidn Studios, scrollable modal, Escape/backdrop/accept to close.
// v22 — Founder &amp; Node Packages pledge screen: all 9 tiers (FREE → $10k),
// feature lists, node power boxes, per-tier accent colors. Hub portal tile
// hidden (screen + data kept for marketing site use).
// v24 — Vendor Market cleanup: removed Tombstones tab, Foundation Reserve
// Stock section, and Structure Decks section. Card Packs tab now shows
// only admin-published custom packs (no default built-in packs).
// v25 — Pack art display fix: uploaded pack image now fills the tile at
// 280px height with object-fit:contain so full portrait art shows; emoji
// icon hidden entirely when cover art is present.
// v26 — Starter deck art persistence: images stored in Forge.starterDeckArt
//   (IDB + Storage pipeline, same as packArt) so they survive _stripDataUrls()
//   on every localStorage save. Vendor Market starter tile shows 280px art.
// v27 — Pack image full-bleed: object-fit:cover fills box edge-to-edge (no
//   black bars), accent stripe hidden when art present, soft bottom fade.
// v28 — Starter deck tiles same full-bleed treatment: cover + center + fade
//   on both Vendor Market shop tiles and the free starter-pick screen.
// v29 — Rebrand: "Node" / "Nodes" → "PRN" / "PRNs" (Planetary Reconstruction
//   Networks) across all user-facing UI text (57 replacements).
// v30 — AI turn hard-deadline fix: tryPromptCounter no longer poisons the
//   per-step watchdog timestamp; a new 45s absolute cap (_aiTurnDeadline)
//   force-ends the turn regardless of counter-prompt state.
// v31 — War Map visual chrome: Foundation Bar HUD, scanline, grid, corner stamps,
//        node state colors (thriving/stable/strained/failing/collapsing), pulse/flicker
//        animations, field-report feed header. All overlaid on existing warmap.png bg.
// v32 — Auto-seed 16 starter PRNs (Kiln-7, Emberfall … Last Wick) across 6 regions /
//        6 sectors when TW data is empty on first open; supply-line connections wired.
//        Admin panel: "Reset to 16-PRN Starter Map" button; "✎ Rename / Edit" label.
const CACHE_VERSION = 'mythic-v32-2026-05-28';
const STATIC_CACHE = 'mythic-static-' + CACHE_VERSION;

// Bare-minimum boot shell — these are the files we want available even if
// the player is offline. The giant index.html is included so the splash +
// last-known game state can render without network.
const BOOT_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // Best-effort: don't fail install if a shell file 404s in dev.
    await Promise.all(BOOT_SHELL.map(async (url) => {
      try { await cache.add(url); } catch (e) {}
    }));
    // Activate immediately on first install so the install button can
    // disappear without a hard refresh.
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Reap any stale caches from previous versions.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('mythic-static-') && n !== STATIC_CACHE)
        .map((n) => caches.delete(n))
    );
    // Take control of open clients without waiting for a navigation.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin GETs. Cross-origin (Supabase, fonts CDN, etc.)
  // goes through the network untouched so the SW never breaks live calls.
  if (url.origin !== self.location.origin) return;

  // 🌐 Navigations / HTML → network-first. Live deploys reach the player
  // on next refresh; falls back to the cached index when offline.
  const isNav = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');
  if (isNav) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // Update the cached HTML so the next offline open has the latest.
        try {
          const cache = await caches.open(STATIC_CACHE);
          cache.put('/', fresh.clone());
        } catch (e) {}
        return fresh;
      } catch (e) {
        const cached = await caches.match('/') || await caches.match('/index.html');
        if (cached) return cached;
        // Last resort — a minimal offline page so the screen isn't blank.
        return new Response(
          '<html><body style="background:#03020a;color:#d4c89a;font-family:Cinzel,serif;text-align:center;padding:4rem"><h1>🌐 Offline</h1><p>Reconnect to continue. Local progress is safe.</p></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
    })());
    return;
  }

  // 🖼 Static assets → cache-first. Heaviest path is /assets/* art + audio
  // which never change once published; serving them from cache makes the
  // game feel instant on every subsequent open.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      // Only cache successful, opaque-friendly responses.
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        try {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, fresh.clone());
        } catch (e) {}
      }
      return fresh;
    } catch (e) {
      // No cache + no network = bubble the error.
      throw e;
    }
  })());
});

// Hot-reload trigger — the main app can send {type:'skip-waiting'} via
// postMessage so a fresh SW takes over immediately on update.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') {
    self.skipWaiting();
  }
});
