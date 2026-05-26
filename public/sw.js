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

// Bumped 2026-05-25 — force-eject stale shells so the auth-modal diagnostic
// fixes reach players who were sitting on a long-cached version.
// Bumped again 2026-05-26 — ship the battle-hang defenses (8s watchdog,
// turn-start sanitization, force-unfreeze hotkey) immediately.
const CACHE_VERSION = 'mythic-v3-2026-05-26';
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
