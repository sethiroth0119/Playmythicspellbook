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
// v33 — War Map canvas layout: replaced CSS-grid sectorBlocks with absolutely
//        positioned diamond node markers on a 16:9 map canvas. Supply-line routes
//        rendered as inline SVG quadratic bezier paths. Region labels float above
//        clusters. 16 starter PRNs get real x/y positions; one-time migration patch
//        fixes existing 0,0-seeded nodes. No more _twPaintConnections() on render.
// v34 — Covert Actions mission debrief modal: collecting a returned squad now
//        opens a styled mission-debrief modal showing squad roster, duration, and
//        exact rewards earned instead of just a toast. CSS + handler included.
//        Campaign node fix: _rlcAvailableNodeIds falls through to the union fallback
//        when the current node has no forward connections, preventing soft-locks on
//        final nodes with incomplete connection graphs.
// v35 — War Map canvas redesign: wireframe-diamond nodes (outer ring + inner
//        core, matching the standalone app visual), canvas fills full viewport
//        height instead of 16:9, overflow:visible so edge labels show, stage
//        stretches, side-pane scrolls. Routes use visible teal dashes. Region
//        labels use larger type with opacity. Cache bust forced.
// v36 — Crash Exchange Stock tab always populated: removed the factionOrder
//        that required activity > 0, so all factions show at launch (new players
//        no longer see blank ticker). Active factions sort to top by score.
// v37 — War Map complete layout redesign to match standalone app: full-screen
//        flex column, 260px left Field Reports feed, right map canvas fills
//        viewport, slide-in node drawer replaces static side pane, coordinate
//        ticks + dark backgrounds + standalone CSS design language applied.
// v38 — Multi-hit attack system: move.dualHit (exactly 2 hits) and
//        move.multiHit: { min, max } (random 2-5 hits). Each hit rolls damage
//        and crits independently. Recoil/drain apply to total dmg dealt.
//        8 catalog moves added (Dual Slice, Double Kick, Twin Strike,
//        Fury Swipes, Bullet Seed, Pin Missile, Double Dragon, Rock Blast).
//        Card Forge move editor gains Dual-Hit checkbox + min/max fields.
// v44 — War Map admin node editor: ADMIN tab in node drawer (rename, reposition,
//        edit yield JSON, set cinder override, delete). + New Node button in
//        top bar creates a scaffolded node at 50,50 and opens admin tab.
//        Cinder display uses selOwn.cinderOverride when set by admin.
// v45 — War Map admin UX: always show admin tab + New Node button (WM is already
//        admin-gated); remove City Collapse / dark-events banner from WM page;
//        fix node middle-click: background:rgba(0,0,0,0.001) forces paint layer
//        so pointer-events hit-test reliably across the full button border-box.
// v43 — War Map node click root-cause fix: App is const (not on window) so
//        inline onclick="App..." silently failed. Added window._twSelectNode
//        helper (window-scoped, accessible from inline handlers) + restored
//        per-button .onclick closure binding as belt-and-suspenders.
// v42 — War Map node click area: .tw-node-marker::after pseudo-element
//        covers the full button + 12px margin at z-index:9 so any click
//        on/near the node (not just the 24px diamond) fires correctly.
//        .tw-map-region overflow changed hidden->visible so edge nodes
//        are not clip-blocked. padding-bottom added to button (8px).
// v41 — War Map node full-button click: label pointer-events changed from
//        none→auto; per-button onclick loop replaced with single delegated
//        listener on #tw-map-canvas using e.target.closest('[data-tw-node]')
//        so any part of the node button (diamond, label, gap, badge) fires.
// v40 — War Map node click fix: drawer moved from position:absolute overlay
//        to a real 3rd grid column in .tw-workspace so no nodes are ever
//        blocked by the open panel. grid-template-columns expands to
//        260px 1fr 400px when .has-drawer class is present.
// v39 — War Map node detail panel redesign (5 tabs: OVERVIEW / CAMPAIGNS /
//        EVENTS / RESOURCES / CHARTER), vital signs + reconstruction progress
//        + foundation reserve cinder sections. Missing TW functions implemented
//        (tw_collectNode 1-hr cooldown, _twHireFlow inline guard picker,
//        _twShopFlow inline upgrade shop, TW_GUARD_DAILY_UPKEEP constant).
//        Sprite Atelier DEATH tab: _injectDeathSprite() plays death frames
//        before renderBattle() removes the unit / shows tombstone.
//        ANIMATION_TYPES now includes 'death'.
const CACHE_VERSION = 'mythic-v45-' + Date.now().toString(36);
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
