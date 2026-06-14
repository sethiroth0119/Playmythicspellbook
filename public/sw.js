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
// v52 — litRoutes added to cloudPublishCatalog __territory_wars__ payload so
//        the marketing site (and all players) see the same admin-lit gold
//        supply lines. Marketing site reads litRoutes from card_catalog and
//        renders gold-glowing routes matching the game. Background updated.
// v51 — litRoutes localStorage fast-path: hg_tw_litRoutes saved in saveForge()
//        chunks + restored in loadForge() so routes survive refresh before the
//        10s-debounced cloud sync completes. _twForge() guard ensures litRoutes
//        is always an array. Cloud-merge unconditionally restores local routes.
// v50 — litRoutes persistence: save/restore Forge.territoryWars.litRoutes around
//        _preferRicherObj cloud-merge so admin-set lit supply lines survive refresh.
//        litRoutes: [] added to initial Forge.territoryWars default.
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
// v46 — Hide world-event banner (mountWorldEventBanner) on territoryWars screen.
//        The badge was position:fixed so removing _twDarkBanner alone wasn't
//        enough — the FR event pill (City Collapse etc.) is a separate global
//        overlay removed now when App.screen === 'territoryWars'.
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
// v60 — Deathcry (on-death trigger: aoeDamage/aoeStatus/heal/buffAllies/energyGain/summon),
//        Momentum (per-turn stat-stage growth while alive, fires in startTurn),
//        Card History Trophies (Bronze 10+, Silver 25+, Gold 50+, Platinum 100+, Mythic 250+
//        — badges in World Data bestiary + battle-anim stat chips).
// v59 — Sacrifice Moves: new sacrifice:true move mechanic (target=sacrificeAlly) with
//        three effect variants (buffSelf, damage, allEnemy-status). executeSacrificeMove
//        engine + tile-highlight branch + tile-click handler added. 5 example catalog
//        moves (bloodOffering, soulExplosion, cursedOffering, voidPact, deathRattle).
//        Inspire Passives: inspireAtk/inspireDef/inspireMag/inspireRes PASSIVES entries;
//        _triggerInspirePassives fires on player + AI unit placement; buildUnit now
//        carries cost:cardData.cost so inspire cost-check works.
// v58 — Rage move-blank fix: getAvailableMoves now only filters to attack-kind
//        moves when the unit actually has at least one attack move; support-only
//        units (e.g. Medic Drone) keep their full moveset visible so it never
//        goes blank. Battle modal adds rageBlocked flag: non-attack moves shown
//        but disabled with "😡 Raged" tooltip when unit is raged.
// v57 — World Data bestiary: STARTER_HEROES and UNIT_CARDS (built-in mock-ups)
//        removed from hero and unit lists for all users. Only admin-published
//        custom cards (Forge.customCards) appear in Heroes and Units sections.
// v56 — Gym Core Wars admin-only gate: hub portal tile hidden from non-admins
//        (same null/.filter(Boolean) pattern as War Map), screen router
//        redirects gymWars+gymLivePing to title for non-admins, gymLoreToast
//        early-returns for non-admins so "Core Wars whisper" toasts never
//        surface in PvE screens for regular players.
// v55 — Roguelite hero-sync fix: renderRlcDeckPick() onclick now derives
//        run.heroId from the chosen deck's heroId (Profile.decks → starter
//        decks → App.selectedHero fallback chain) so Vex players stay Vex
//        instead of silently defaulting to Cedric (getAllHeroes()[0]).
//        Campaign-forced heroes (startingHeroId) are still honoured.
// v39 — War Map node detail panel redesign (5 tabs: OVERVIEW / CAMPAIGNS /
//        EVENTS / RESOURCES / CHARTER), vital signs + reconstruction progress
//        + foundation reserve cinder sections. Missing TW functions implemented
//        (tw_collectNode 1-hr cooldown, _twHireFlow inline guard picker,
//        _twShopFlow inline upgrade shop, TW_GUARD_DAILY_UPKEEP constant).
//        Sprite Atelier DEATH tab: _injectDeathSprite() plays death frames
//        before renderBattle() removes the unit / shows tombstone.
//        ANIMATION_TYPES now includes 'death'.
// v62 — Empower (double cost = double on-play effect), Scrounge (consume graveyard
//        units as cost for bonus effect triggers), Assault (hand cards trigger bonus
//        on ally attack), Frostform (alt cheap deploy: DEF→1, gains Elemental subtype).
//        Card Forge editor updated for all 4 mechanics.
// v65 — Equipment item sub-type (weapon/armor/accessory/trinket, grants moves).
//        Per-card gemSlots (0–3) set in Card Forge controls how many loadout slots
//        each unit has. Slot picker shows both Node Shards + Equipment. Profile.
//        unitSlots now cloud-synced via __unitSlots__ forge key (survives login/device).
// v64 — Node Shards (gem system): 3-slot unit loadout (shared gems+equipment), admin
//        creates shards via Item Forge (slotType:nodeShard, rarity, passive, stats).
//        5% drop on battle win (2× boost when War Map node lit for 24h), 10% from
//        Covert Actions. Unit card detail shows 3 slot pickers in Collection/Bestiary.
// v63 — Tunneling (unit hides underground N turns, untargetable, surfaces with Speed),
//        Prophecy (on-trigger: boost top deck cards or add graveyard copy to deck),
//        Runic (spell persists as Runic Constant, re-pulses each player turn).
//        Card Forge editor updated for all 3 mechanics.
// v61 — Verdict (target chooses 1-of-2 negative effects; AI auto-picks, player gets choice modal),
//        Escalation (per-unit move counter: +20% power per use beyond first, up to +80%),
//        Shift (ability transfers a passive from caster to target ally permanently).
//        Card Forge move editor gains Verdict options, Escalation checkbox, Shift passive picker.
// v66 — Card Forge UI redesign: dramatic dark gradient container, section dividers
//        (Identity / Combat Stats / Abilities / Hex Mechanics), portrait card-art
//        frames, fixed Energy Cost dead space (now full-width), polished inputs
//        with focus glow, themed actions bar.
// v67 — SW auto-reload fix: controllerchange listener + reg.update() on every load
//        so fresh deploys replace stale cached HTML immediately without manual
//        hard-refresh. Version badge added to Forge header for confirmation.
// v68 — SW activate now calls client.navigate() on all open tabs so fresh HTML
//        is served immediately on deploy. Items tab restored to Forge tab strip
//        with full renderForgeItems() list view (Node Shards + Equipment).
// v69 — Remove dead duplicate renderForgeItems() (was being overridden at runtime).
//        Real Items list now shows rarity-coloured borders, slotType badge,
//        passive name, and grantsMove for Node Shards + Equipment.
// v70 — Navigation requests (HTML) are NO LONGER intercepted by the SW.
//        The browser fetches index.html directly from the server every time,
//        so new deploys are always visible immediately without any hard-refresh.
//        Static assets (artwork, audio) still use cache-first for speed.
// v71 — Full-page Forge redesign: min-height:100vh flex-column layout, sticky
//        60px header bar, modern underline tab strip, full-width card editor,
//        3-column editor grid on desktop, polished section panels + dividers.
// v72 — Counter-negate bug fix: when player counters an AI spell the card was
//        NOT removed from the AI's hand, so the AI re-cast it immediately on
//        the next doAIStep. Now countered spells are discarded + energy deducted.
// v86o — Arcane Tempo passive (inspireDrawTimer): draw 1 extra card every 3
//         turns while unit is alive. Items tab restored to Forge tab strip
//         (renderForgeItems + bindForgeItems re-wired, back-button handles
//         editingItemId). Forge back-button now catches item-editor exits.
// v86p — Root-cause fix for "flash then nothing" on War Map + Side Deck Done:
//         TW router now wraps renderTerritoryWars() in its own try/catch and
//         ALWAYS returns for TW screens (never falls through to _origRender).
//         Main render fallback no longer resets App.screen to 'title' on crash.
//         Both button handlers call their target render function DIRECTLY,
//         bypassing the dispatch chain entirely so no error can override the
//         screen change.
// v86q — Gem/Item system expansion: Item Forge gains slot-type selector
//         (gem / item / nodeShard / relic), Grant Passive dropdown (all PASSIVES),
//         Grant Move dropdown (all custom moves), On-Play Effect picker
//         (damage / heal / draw / gainEnergy / buffSelf + amount). When a unit
//         enters play its socketed gems apply: stat mods, passive IDs pushed to
//         unit.passives[], move IDs pushed to unit.knownMoves[], and on-play
//         effects fire immediately (damage to nearby enemies, heal, draw cards,
//         gain energy, buff self ATK).
// v86r — Two crash fixes: (1) _isAdm hoisted to renderTerritoryWars() function
//         scope — was defined inside the nodeDrawerHtml IIFE but referenced
//         outside it in root.innerHTML, causing ReferenceError on every War Map
//         open. (2) _ensureGemInventory (undefined) + Forge.gemCatalog (dead
//         reference) replaced inline in renderPreBattleLoadout — gem picker
//         now uses Forge.customItems as the canonical item list with count 99.
// v86s — Deck Builder restored: Side Deck panel + 💎 Gems panel added as tabs
//         in the right column. "→ Side" button on main deck rows moves cards
//         to Profile.sideDeck; "← Main" moves back. Gem slots socket gems from
//         Forge.customItems into Profile.socketedGems (persisted). Pre-battle
//         loadout seeds bp.socketedGems from Profile.socketedGems so deck-
//         builder gem selections carry into battle automatically.
// v86t — Card / Move Forge editor enhancements: (1) ✨ Inspire Effect now
//         behind an enable checkbox — only stored when explicitly checked, so
//         units don't accidentally inherit the inspire passive. (2) ⚖️ Verdict
//         sub-effect block now behind an enable checkbox with verdictEnabled
//         flag persisted on onPlay. (3) ⚔ Assault Card checkbox extended to
//         spell cards (was unit/trap/custom only). (4) 💀 Sacrifice Move
//         section added to the Move Forge editor — checkbox enables sacrifice
//         mode; sacrifice effect dropdown (buffSelf/damage/allEnemyStatus/
//         draw/healSelf/gainEnergy) sets what fires after the ally is consumed.
// v86u — Battle-engine fixes from the full-game audit: (1) 💀 Sacrifice Move is
//         now wired into combat — it routes through ally-targeting and resolves
//         in executeMove (consumes the picked ally, applies buffSelf/damage/
//         allEnemyStatus/draw/healSelf/gainEnergy). Previously saved but inert.
//         (2) 🛡️ Ward / elemental-immunity now deals 0 damage instead of leaking
//         1 chip — calculateDamage no longer floors an immune hit up to 1.
//         (3) On-play Sacrifice (_executeSacrifice) gained the damage + apply-
//         status-to-all-enemies effects to match the move editor. (4) AI weather
//         scoring keyed on 'sandstorm' but the real weatherType is 'sand', so the
//         AI never valued sandstorm for earth heroes — key corrected to 'sand'.
//         Persistence (Side Deck + socketed Gems) added to the load whitelist +
//         cloud sync so they survive reload and device switches.
// v86v — Deck Builder Side Deck + Gem Deck rules. (1) 📋 Side Deck: the 3-copy
//         limit is now COMBINED across main + side (1 copy in main → at most 2
//         of that card in the side deck), enforced on both add paths. You can
//         add cards to the side deck DIRECTLY from the Inventory while the Side
//         tab is active. Fixed a data-loss bug where "← Main" removed a card
//         from the side deck even when the main deck rejected it (full / cap).
//         (2) 🔮 Gem Deck: new pool of up to 8 gems on the Gems tab — only gems
//         that are in your gem deck can be socketed onto units (still capped at
//         5 socketed total). The pool can't drop below what's currently socketed.
//         AI/Starter admin decks keep the old full-catalog gem behavior.
// v86w — 🛒 Player Market visual remodel (Phase 1), CS-Float-inspired. The
//         Browse + My Listings tabs now render as a responsive card GRID
//         instead of stacked rows: each tile shows the card's full uploaded
//         art (falling back to animated sprite frames, then emoji) so cards,
//         items and gems all show their images. New toolbar adds a live
//         search box + sort dropdown (price/name/recency/ending), and the
//         filter + auction/fixed toggles became rounded chips. Buy / Bid /
//         Buy Now / History / Cancel, auctions, timers and right-click detail
//         all work unchanged (same data-* hooks). Nothing removed —
//         renderListingCard is still defined for any other caller.
// v86x — 💎 Digital Valuation System (DVS), Phase 2. New "💎 Valuation" tab in
//         The Market (6th tab; Browse/Sell/My Listings/Resources/Stock all
//         preserved). A 100% client-side, stock-market-style engine scores every
//         card 0–100 from six weighted sub-scores (Power .20 / Meta .20 /
//         WinRate .15 / Scarcity .20 / Demand .20 / Historical .05) into a
//         Suggested Cinder Value + USD value + asset classification (Common →
//         Legendary). Tab shows a live exchange header, a Market Dashboard of
//         leaderboards (Highest Valued / Gainers / Losers / Most Played /
//         Highest Win Rate / Most Traded / Rarest), and a searchable+sortable
//         asset grid; tapping a card opens a detail modal with sub-score bars,
//         supply + integrity, recent sales and an hourly price-history chart.
//         Recalculates hourly, persists to localStorage ('hg_dvs'). Pure read —
//         no gameplay state is mutated.
// v86y — 💎 DVS Phase 3 + exchange-rate change. (1) Cinder→USD reference rate
//         is now 5000 🔥 ≈ $1 (was 100); USD now renders with extra decimals so
//         low-value cards don't all flatten to "$0.00", and is computed live off
//         the current rate so a table cached at the old rate still displays
//         correctly. (2) Listing tiles (Browse + My Listings) now surface the
//         valuation inline: a 💎 value-score chip in the corner plus a body line
//         with the asset classification, suggested Cinder value, and a deal
//         indicator (deal / fair / over) comparing the asking price to the
//         suggested value. Cards only; deal badge shown only for Cinder-priced
//         listings. Nothing removed.
// v86z — ⚙️ Pre-Battle "Side Deck & Gem Setup" upgrades (renderPreBattleLoadout).
//         (1) Lock-in is now gated: "✓ Done — Return to Match" only proceeds when
//         the main deck holds EXACTLY 40 cards AND the side deck holds EXACTLY 15
//         (button dims + a toast explains the live counts otherwise). The main/side
//         swap buttons ("Side →" / "← Main") already moved cards between decks and
//         still do. (2) Right-clicking any main- or side-deck row opens the full
//         card-detail panel (the same context modal used in the Deck Builder).
//         (3) The gem dropdowns now only offer gems from the player's own Gem Deck
//         (Profile.sideDeck.gems), gated by pool count vs. copies socketed
//         elsewhere, capped at 5 connected gems — sockets carried over from a prior
//         session stay selected so nothing is lost. Nothing removed.
// v87a — The Market: removed 📈 Stock tab (folded into 💎 Valuation), card tiles
//        now open the full DVS Valuation modal on left-click, the modal renders
//        in a body-level portal so it appears in the player's viewport (no more
//        scrolling to the top), card art shows whole (object-fit:contain, no
//        cropping) across Browse / My Listings / All Assets / leaderboard, and
//        the How-To panel literal-template bugs were fixed. Nothing removed.
// v87b — ⚔ Assault Cards: the Assault toggle now appears for SPELL (and trap)
//        cards in the Forge — it was previously trapped inside the unit-only
//        block. Assault activation is now ENERGY-GATED (prompt disables cards
//        you can't afford and spends the cost on use), and assault now applies
//        the card's full Effect Type (damage/heal/draw/restoreEnergy/restoreKalon/
//        kalonLock/summon) with buffAll respecting Target so it can debuff
//        enemies, not just buff allies. Unit assault toggle unchanged.
// v87c — Black River missions can now launch CREATED campaigns: the Campaign
//        Builder's "Where this campaign appears" dropdown gains Black River →
//        Oil Extraction / Convoy Escort / VIP Rescue slots (placement
//        br_oil/br_convoy/br_vip, kept off the Roguelite list). A mission's
//        Deploy button launches the campaign routed to that slot (rlcStartRun);
//        with none assigned it falls back to the built-in skirmish, unchanged.
//        Tiles show the campaign name + a 🗺️ CAMPAIGN badge when one is set.
// v87d — 🪦 Consume-from-Graveyard extra play cost: a new Forge field (spells +
//        units) makes playing a card ALSO remove N cards from your graveyard, on
//        top of energy. You can't play it unless the graveyard holds that many
//        (gated in the shared _checkPlayRequirement → every play path). Paid in
//        placeUnit, spell resolution, and assault activation; the played card
//        never pays for itself. Set 0 to disable.
// v87e — ⚔ Assault Cards get a DEDICATED Assault Effect picker (revealed when
//        the toggle is checked): Deal Damage, Heal, 🩸 Life Drain (damage enemy
//        + heal the attacker), Buff Allies, Debuff Enemies, Draw, Restore Energy,
//        ⚡ Drain Enemy Energy, Summon. Stored as card.assaultEffect; activation
//        prefers it and falls back to the card's normal Effect Type so existing
//        assault cards are unchanged.
// v87f — 🪖 Market listings now capture the SELLER's exact unit instance
//        (level, XP, rolled trait, nature, scaled stats, moveset) at list time.
//        Clicking a listed UNIT opens its detail modal with a "Seller's unit —
//        this exact copy" section + full moveset, so buyers can judge price by
//        the actual leveled/trait/move loadout. NPC + pre-update listings show a
//        side-effect-free base profile. Purely additive — nothing removed.
// v87g — 💎 Suggested Cinder value now SCALES with the listed unit's instance:
//        level (+5%/lvl, cap +60%), trait rarity (uncommon/rare/legendary), and
//        moveset power. The listing tile's "sugg." price + deal badge use the
//        per-copy value, and the detail modal shows a "This copy — suggested"
//        line (base × instance). The base per-card valuation engine is unchanged.
// v88a — 🃏 PLAYER MARKET goes CLOUD (Stage 1, fixed-price): NPC "mockup"
//        traders retired; Browse + My Listings now read the shared
//        card_market_listings Supabase table so EVERY signed-in player's card
//        listings appear to everyone. Sell posts to the cloud; buy = atomic
//        claim + pay + grant copy (carries the seller's unit instance); cancel
//        refunds the escrow. One-time SQL setup panel on Browse if the table is
//        missing. Local market kept as offline fallback. Auctions = Stage 2.
// v88b — Pre-battle Side Deck & Gem Setup FIXES: (1) Side↔Main swap no longer
//        deadlocks when both decks are full (40/40 + 15/15) — cards move freely
//        while editing and the Done button still requires exactly 40 main + 15
//        side. (2) Gem connection now falls back to ALL your gems when you have
//        no gem deck set, so gems are always socketable (units still need gem
//        slots set in the Card Forge). Clearer empty-state guidance.
// v88c — 💎 GEM SLOTS end-to-end: new "Gem Slots (0-3)" field in the Card Forge
//        (units) → card.gemSlots; a "💎 Gem Slots" section in the card detail
//        panel with one dropdown per slot to connect gems (from your gem deck,
//        falling back to all owned gems); each connection writes the shared
//        socket store and counts toward the 5-gem cap (shows "N/5 connected"),
//        wired in BOTH the Deck Builder (Profile.socketedGems) and pre-battle
//        (App.battlePrep.socketedGems). Nothing removed.
// v88d — 🔨 Cloud Market Stage 2: AUCTIONS go cross-player. Sell→Auction posts
//        to card_market_listings (cinders bid track); bids are race-safe atomic
//        compare-and-set with self-escrow (Profile.lockedGems); outbid players
//        self-release on fetch; the winner claims + pays on expiry; sellers
//        collect payouts; Buy-Now is an atomic claim; cancel only with no bids.
//        Stage-1 'auctions coming' guard removed. No new migration (table already
//        has the auction columns).
// v88e — 🪐 MP #65 client wiring (flag-gated, USE_COLYSEUS_MP still false):
//        the Colyseus path now sends the board as a 'snapshot' the server relays
//        to the opponent (sendColyseusSnapshot on every action + end-turn + an
//        initial push), applies relayed opponent snapshots via the shared
//        _onRemoteStateArrived path, and reports the result through the server's
//        single-writer 'claimResult' (no client double-submit). 'welcome' syncs
//        our authoritative userId. Zero impact until the flag is flipped.
// v88f — 🧰 Browse is now the UNIFIED player marketplace: cross-player RESOURCE
//        listings (cinder-priced, from the resource_listings table) appear in
//        Browse as item-style tiles alongside cards/items, buyable in place
//        (routes to resMarketBuy). Resources are fetched + kept subscribed
//        whenever you're in the market (not just the Resources tab). Stale
//        'NPC traders' / 'refresh NPC stock' copy replaced with real-player text.
// v88g — 🛡 Crash/Exchange safety net: the router now wraps renderCrashExchange
//        in try/catch so a render error shows the actual error + a Back button
//        (and logs the stack to console) instead of the hub button silently
//        doing nothing / leaving a dead screen. Surfaces the real failing line.
// v88h — 🐛 FIX: Crash/Exchange crashed (TypeError reading 'cat' in
//        _cxEventList). Root cause: `Date.now() >> 16` truncates to a 32-bit
//        SIGNED int and Date.now() overflows it, going negative for ~half of
//        every ~49.7-day cycle → negative modulo → CX_EVENT_POOL[-n] undefined
//        → crash. Now uses Math.floor(/65536) (always ≥0) + positive-modulo
//        normalize + empty-pool / undefined-entry guards. Crash/Exchange opens
//        again. (v88g error-surface kept as a backstop.)
const CACHE_VERSION = 'mythic-v96y-turnbadge-' + Date.now().toString(36);
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
    // NOTE: We intentionally do NOT call _c.navigate() here. The fetch handler
    // already passes navigation requests straight to the network (isNav → return),
    // so every hard-reload fetches fresh HTML. Force-navigating from activate was
    // causing the blank-black-screen bug: the SW activated mid page-load,
    // _c.navigate() kicked the tab, and the interrupted boot produced an empty
    // #app div. Removed in v84b — the opt-in "Reload now" toast in index.html
    // is the only way a tab reloads after a SW update.
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

  // 🌐 Navigations / HTML — let the browser handle these directly.
  // By NOT calling event.respondWith() the browser fetches index.html from
  // the network every single time, bypassing the SW cache entirely.
  // This guarantees every deploy is visible immediately without a hard-refresh.
  const isNav = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');
  if (isNav) return; // ← SW steps aside; browser fetches fresh HTML normally

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
