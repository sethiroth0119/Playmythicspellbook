# BRIEF — depot.render.js — the depot, fleet and Freight Exchange UI as pure string builders

## GOAL
Write ONE new file, /home/user/Playmythicspellbook/public/src/transport/depot.render.js: the exported stylesheet plus pure functions that turn a plain view object into HTML strings for the three tabs — Depot, Fleet, and the Freight Exchange rate board. No DOM writes, no listeners, no imports of the bridge, no data fetching. Every failure state the rest of the feature can produce must have a corresponding VISIBLE banner that names the reason and the fix; every empty state must be an instruction rather than a blank; and every player-supplied string must be escaped. A silent refusal or a blank panel is the defect this file exists to prevent.

## FILES YOU OWN (write ONLY these)
- public/src/transport/depot.render.js

## ACCEPTANCE CRITERIA (a critic verifies each against your real output)
1. File exists at public/src/transport/depot.render.js; `node --check` passes. (Do NOT cite `node _synckcheck.mjs` on a .js path — it extracts inline <script> blocks from HTML only and prints ALL CLEAN. False green.)
2. Exports exactly: TRANSPORT_CSS (a template-literal string) and renderTransport(view). Optionally also renderDepot(view) / renderFleet(view) / renderExchange(view) as the three internals, exported for testing.
3. Every exported render function is PURE: it returns a string and performs no DOM writes and attaches no listeners. `grep -nE "addEventListener|onclick *=|innerHTML *=|document\\." ` returns zero hits (a `document.getElementById` guard belongs in index.js, not here).
4. Interactive elements are emitted as `data-mt="<action>"` (+ `data-mt-id` where needed) attributes only; index.js binds ONE delegated handler. A comment states why: paint() replaces the markup and a direct listener would not survive it.
5. TRANSPORT_CSS is exported as a string for one-shot lazy injection by the entry module, so a never-opened panel costs nothing. It is not injected here.
6. A local `esc()` is defined in this file and EVERY interpolation of player-supplied text (company name, carrier name, tariff note, blacklist reason, rig name, error text) goes through it. A comment says esc lives here rather than being imported from the legacy app because every render path needs it and it must never be the reason a module fails to load.
7. Every state the feature can be in produces a distinct, visible banner: no bridge; not signed in; sql/038 not applied ('missing' — the copy must say run the SQL, not 'something went wrong'); a real error (the error text is SHOWN, trimmed, not replaced with a guess); no charter; no depot; depot out of reach; no rig staffed; rig out of runs today; no free bay; blacklisted by this carrier. Each carries both a reason and a fix.
8. The CSS carries WHY on at least the warning chrome, in the bar's own terms — a stopped/refused thing that looks the same as a working one is the single most common 'the game is broken' report.
9. Every empty state is an instruction, not a blank: an empty fleet says where rigs are bought (the Prince Portfolios auction floor); an empty rate board says Meridian Haulage is still available; no depot says to build one.
10. The Meridian Haulage row is ALWAYS rendered on the rate board, visibly marked as the NPC fallback and visibly worse (2.5× the median tariff, 1.6× trip time, no escort, no illicit freight). It renders even when the carrier list is empty, missing, offline or errored.
11. A quote shows every component it is built from — base tariff, per-hop multiplier, escort surcharge, cap applied — and a capped price is flagged rather than silently clamped. An unknown resource id in a cargo line SHOWS, flagged with ⚠, rather than vanishing.
12. Rarity colours come from the view's supplied rarity data (the six ids common/uncommon/rare/epic/legendary/mythic), not from a second hardcoded ladder in this file.
13. Nothing in the file reads a global: `grep -nE "\\b(Profile|Cloud|App|Corp|Forge|RESOURCES|Operations|showToast|window)\\b" ` returns zero non-comment hits. No `.from(`, no `.rpc(`, no `await`, no imports other than (optionally) a relative .js.
14. Nothing throws for any view shape, including `renderTransport(undefined)`, `renderTransport({})`, a view whose arrays are missing, and a fleet row with null fields.
15. No 'discord'/'webhook' anywhere including comments; no `<img src>` pointing at anything user-controlled, no upload/FormData/storage.from(. Visuals are emoji, CSS and text only.

## CONTEXT
You are writing ONE new file: /home/user/Playmythicspellbook/public/src/transport/depot.render.js. You may write no other file. Served at /src/transport/depot.render.js.

WHAT IT DRAWS. A Transportation Company is a player-run business that hauls other players' freight for Cinder. Its screen is an overlay with three tabs:
  DEPOT    — the charter (owned? drivers staffed?), the Freight Depot building (level, bays, fleet cap, reach in hops), and what is missing.
  FLEET    — the carrier's rigs: name, rarity, condition, runs/day, runs used today, runs left, whether it is assigned, and what to do about a rig that cannot run.
  EXCHANGE — the public rate board: every active carrier ranked, showing tariff (Cinder per unit·hop), reliability %, coverage (node pairs served), free bays now — plus the shipper's in-flight contracts and the current quote.

PINNED CONTRACT — index.js is being written in parallel and calls you like this; match exactly:
  export const TRANSPORT_CSS;                  // string, injected once by index.js under id 'mt-css'
  export function renderTransport(view);       // returns the full HTML string for the overlay body
The `view` object is assembled by index.js and is the ONLY thing you receive. Its shape is fixed:
  {
    ready,      // boolean — the index.html bridge is present
    offline,    // boolean — not signed in
    missing,    // boolean — sql/038 has not been pasted into the Supabase editor yet
    error,      // string|null — the raw server error, already trimmed to 160 chars
    tab,        // 'depot' | 'fleet' | 'exchange'
    charter:  { owned, workers, label, startup },
    depot:    { ok, why, fix, level, bays, fleetCap, radius },
    garage:   { owned, name, tier, slotBonus, runBonus },
    fleet:    [ { vehicleId, name, rarity, rarityName, rarityColor, condition, runs, runsUsed, runsLeft, assignedTo, status } ],
    carriers: [ { id, name, tariff, reliability, coverage, freeBays, meridian } ],
    contracts:[ { id, fromName, toName, cargoText, price, etaText, progress, status, risk } ],
    quote:    { carrierId, carrierName, price, capped, hops, etaText, riskPct, meridian } | null,
    cinder,
  }
Any field may be absent or null; render correctly anyway. Emit every clickable element as `<button class="mt-btn" data-mt="dispatch" data-mt-id="…">`; index.js binds one delegated `click` on the overlay root and dispatches on `ev.target.closest('[data-mt]')`.

═══ THE BAR: what production.render.js does that you must match ═══
Judged blind against /home/user/Playmythicspellbook/public/src/city/production.render.js. Read it. Its header states the two rules that drive every choice, the second being: "A halted building SAYS WHY, in the card, in words. An invisible halt reads as a bug and this project has shipped that mistake before." It carries WHY into the CSS itself, verbatim:
  /* 🛑 The halt banner is deliberately loud. A stopped building that looks the
     same as a running one is the single most common "the game is broken" report. */
  .cprod-halt{margin-top:6px;padding:6px 8px;border-radius:4px;font-size:0.78rem;line-height:1.5;
    background:rgba(224,85,106,0.12);border:1px solid rgba(224,85,106,0.45);color:#ffb3c0}
  .cprod-halt.is-warn{background:rgba(255,194,74,0.10);border-color:rgba(255,194,74,0.45);color:#ffd79a}
Its banner block is:
  <div class="cprod-halt ${cls}">${esc(halt.reason)}${halt.fix ? `<span class="cprod-fix">→ ${esc(halt.fix)}</span>` : ''}</div>
and every failure state the state module can produce has a matching banner — halt reason + fix, accrual cap, storage clip, input-limited cycles. Its cost line shows every leg including unknown resource ids flagged with ⚠ "rather than silently dropped", because "a cost naming a resource the ledger has never heard of must SHOW, flagged, not silently vanish from the render while still blocking the build." Its empty state is an instruction — "No production buildings yet. Open the blueprints and start with the Warehouse." Its `esc` is a local 4-char escaper defined at the top of the file. Its stylesheet is a flat `.cprod-*` namespace exported as a template literal for one-shot lazy injection by the entry module. Use `.mt-*` for yours.

Use the SAME CSS grammar so this reads as one system with the city panel: dark card gradients `linear-gradient(180deg,#0c1118,#070a0f)`, `1px solid rgba(255,255,255,0.12)` borders with a 3px accent left border, `font-family:'Cinzel',serif` on headings, gold `#ffd166` / `#d4af37` for values, red `#e0556a` for shortfalls, the `is-bad` / `is-warn` / `is-ok` modifier convention, and `.mt-btn[disabled]{opacity:0.4;cursor:not-allowed;border-color:#555;color:#777}`. The transport accent colour is `#e0a45c` and its emoji is 🚛.

═══ THE STATES YOU MUST DRAW, AND THE WORDS THAT ARE ALREADY DECIDED ═══
- NOT SET UP YET. `view.missing` means sql/038 has not been applied by hand in the Supabase SQL editor. Say that — "run the SQL" — not "something went wrong". The repo distinguishes 'missing table' from 'empty market' deliberately, and a missing-check must never be used to decide a market is empty.
- A REAL ERROR. `view.error` is shown VERBATIM (already trimmed). Do not replace it with a guessed cause. index.html:79921-79926 records four wasted debugging sessions from a toast that told an admin to run a .sql file they had already run: "Name the real error instead of guessing at a cause."
- NO BRIDGE (`!view.ready`). Say the module loaded but the game did not hand it anything, and that this is a load problem — legible degradation, not silence.
- MERIDIAN HAULAGE is the NPC carrier and is ALWAYS on the board, including when `carriers` is empty/missing/offline. It is deliberately worse: 2.5× the median player tariff, 1.6× trip time, no escort, no illicit freight. It exists so a monopolist cannot end another player's game by refusing service, so the row must never be conditional on anything. Mark it visibly as the fallback and show WHY it costs more.
- 'HAND-HAULED' is the already-shipped name for the no-rig case (index.html:164244 returns `{ owned:false, name:'Hand-hauled', icon:'🧺', … }` from both the no-rig path and the catch). If you refer to the unhired case, use that exact label. Do not invent a parallel one.
- THE GARAGE PERK is a positive, and the UI should say so where it applies: owning a real-money Garage rig grants a FLEET-WIDE perk (tier 1 +1 fleet slot, tier 2 +1 run/day on every rig, tier 3 both). Render it as a credit on the depot/fleet header. Never render a Garage rig as a fleet rig.
- RARITY is the game's existing six-id ladder with these colours: common #9aa0a6, uncommon #5eb37a, rare #5a9bd4, epic #a070d9, legendary #d4af37, mythic #e85d3c. They arrive on each fleet row as `rarityColor`/`rarityName`; do not hardcode a second ladder.

═══ HARD RULES ═══
- THE GLOBALS TRAP: Profile, Cloud, App, Corp, Forge, RESOURCES, showToast, escapeHtml and `root` (index.html:110871, `const root = document.getElementById('app')`) are top-level `const`/function declarations in index.html — lexical bindings, NOT window properties. This file must reference none of them. It receives a view object and returns a string.
- ESCAPE EVERYTHING PLAYER-SUPPLIED. Carrier names, company names, tariff notes and error text all reach this file from other players or from a server. Define esc() locally (escape at least & < > " and preferably ') and use it on every interpolation.
- No DOM, no listeners, no fetch, no async, no npm dependencies, no bare-specifier or CDN imports.
- Nothing may throw for any input; this module is loaded on every page load.
- Never write 'discord' or 'webhook', including in a comment — that decision is settled and a comment proposing it counts as re-proposing it.
- No image or video upload of any kind and no `<img src>` bound to user-controlled text: hosting UGC carries a non-deferrable legal obligation this project has ruled out. Visuals are emoji + CSS.
