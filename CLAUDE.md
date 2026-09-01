# Mythic Spellbook — working notes for Claude Code

## Architecture
Single-page app. Legacy code lives in `public/index.html` (~215k lines, ~11.6 MB).
**NEW features go in `public/src/<feature>/` as ES modules.** Never add a new top-level
system to index.html.

⚠ `public/` is the deploy root (Cloudflare Workers Assets). A module at
`public/src/community/x.js` is served as `/src/community/x.js`.

### 🔴 The globals trap — read this before writing any module
`Profile`, `Cloud`, `App`, `Corp`, `Forge` are declared as **top-level `const`** in
index.html. Those are global *lexical* bindings — they are **NOT on `window`**, so an ES
module cannot see them. This has already cost real time twice (FoundationReserve and
Profile, both in the Node City bridge).

The fix is the proven one: index.html explicitly hands a module what it needs.
`window.MythicBridge` is that seam for `/src/community`. If a module needs something new
from the legacy app, **add it to the bridge** — never reach for a bare global and never
assume `window.Foo` exists because `const Foo` does.

## Non-negotiables
- All Supabase access is guarded. The app MUST still work offline / before tables exist,
  degrading to mock or empty data. Follow the `Corp.*` pattern.
- Ledgers are append-only. Balance = `sum(amount)`. Never UPDATE a balance column.
  See `corp_treasury` / `corpTreasuryDeposit()`.
- Every table needs RLS policies in the same migration. No exceptions.
- Colyseus client must match server 0.16.x + schema v3 exactly.
- All operation pricing goes through `_opEcon()`. Never hardcode economy numbers.

## Conventions
- Comments explain WHY, including past bugs and rejected designs. Preserve this.
- Currency: Cinder is `Profile.gems`. Use `spendGems()` / `addGems()`, never mutate directly.
- User-facing errors use `showToast()`. Confirmations use `gcConfirm()` (async).
- No new npm dependencies without asking.

## 🏙 The city economy (`public/src/economy/`)
Registered as `window.MythicEconomy`; wired into `node-city/index.html` via one tick hook,
one save field and one panel. **See ECONOMY.md before changing any of it.**
- **Cinder is never minted.** `sim.js` asserts a closed loop every tick and suspends the
  payout if it breaks. This is the structural guard against the retired Cinder Forge bug.
- **All economy numbers live in `ECON` (`tuning.js`)** — the `_opEcon()` pattern.
- **No resource price is written down anywhere.** Prices derive from the recipe graph.
- **Never `addRes()` a chain resource.** The 258 ids in `/src/resources/chain.js` are not in
  index.html's `RESOURCES`; the economy holds its own inventory. Only the audited Cinder
  payout crosses the bridge.
- `economy/bank.js` is simulated firm credit and is **not** `player_banks` — never join them.

## Existing systems to reuse, not rebuild
- `Corp.*` — roster, requests, roles, treasury. **Communities sit ABOVE corps.**
- `chat_messages` — rooms + DMs + RLS already exist. Community channels are rooms.
- `frApplyTax()` — civic tax. Territory: `tw_regionControlPct(regionId, corpId)`.

## Out of scope
- **No image or video upload. Text only.** Hosting UGC carries a non-deferrable legal
  obligation to detect and report CSAM. If images are ever wanted, use a third party that
  handles scanning as part of its product.
- **🚫 No Discord webhooks / no Discord integration.** Decided 2026-08-05. The community
  design doc argues hard for outbound webhooks as its highest-value item — **that
  recommendation is overruled and must not be re-proposed.** Do not build it, and do not
  re-derive it from the doc.
- Do not modify battle, card, or economy code while working on Community.

## ⚠ Corrections to the community-feature design doc
The doc is accurate about the shape of the app, but two claims are out of date — do not
act on them:
1. **"Chat has a 10-word profanity list, 280-char cap and a 1.5s cooldown"** — that was
   true when it was written and is client-side no longer. As of **v120g0** world chat goes
   through the `chat_send()` RPC: server-side profanity mask (`chat_clean`), server-side
   1.5s rate limit, 500-char cap, and the direct INSERT policy on `chat_messages` was
   DROPPED. **Never re-implement any of that in JS as enforcement.** The client keeps its
   copies purely as instant feedback.
   ⚠ `guild_chat` (the Guild Wire) did NOT get this treatment and still inserts directly.
2. **"CHAT_SQL is a giant escaped string literal"** — migrations for new work go in `/sql`
   as numbered files (see below). The legacy string constants are not the pattern to copy.

## Migrations
Numbered `.sql` files in `/sql`, applied **by hand in the Supabase SQL editor** for project
`ktsiasyjusesawtrwrjc` (there is no CLI login configured in this repo, and the Supabase MCP
is not always authenticated). Each file is idempotent and re-runnable, ends with a verify
query, and ships its RLS in the same file.

**RLS is the entire security boundary — review every policy line by line.** A missing
`using (auth.uid() = …)` is a data breach and looks fine in review.

⚠ **RLS recursion:** a policy on `community_members` that itself queries
`community_members` can recurse. Membership/leadership checks go through `SECURITY DEFINER`
helper functions (`is_community_member` / `is_community_leader`), which bypass RLS and
therefore terminate.

## Verifying (this environment)
- Syntax-check index.html with `node _synckcheck.mjs` — **not** `build.mjs`.
- Also check every ES module with `node .gauntlet/modcheck.mjs` — `_synckcheck.mjs` does
  NOT look under `public/src`, and a module that fails to parse is reported at runtime as
  "not mounted (non-fatal)", which is indistinguishable from the module being absent.
- Before committing a tree other agents are writing to, run `node .gauntlet/precommit-scan.mjs`.
  It refuses a line marked as deliberately broken. Both syntax gates pass on those.
- The Browser pane barely composites: `requestAnimationFrame` fires at about **0.56 Hz**
  (measured: 3 callbacks in 5,343 ms) — **not "never", which is worse than never, because
  it makes the failure intermittent.** `render()` is RAF-batched, so it effectively does
  nothing inside a synchronous driver and canvas rects read 0×0. Call renderers directly,
  and for canvas work inject a `requestAnimationFrame = cb => setTimeout(cb,16)` shim into
  a throwaway copy of the page.
  🔴 **Any A/B of the rendered frame MUST call `renderer.render()` between the two reads,
  and must `drawImage` in the same task** (`preserveDrawingBuffer` is off, so the buffer is
  gone by the next task and `readPixels` returns zeros). An A/B that flips `.visible` and
  reads the framebuffer returns the frame from *before* the flip — for **any** layer — and
  reports a confident, wrong zero. That cost two overlays a "cannot be photographed"
  verdict; driven properly they move 78% of the crop against a control of exactly 0.
  See `.gauntlet/README.md` item 6.
- Deploy bumps **four** knobs together or the update check breaks — the list said three
  and was wrong, which cost a round: `public/version.txt`, `window.BUILD_VERSION`,
  `sw.js` `CACHE_VERSION`, and `node-city/index.html`'s `window.NC_BUILD` (the city is a
  separate page with its own module imports; leave it and the city serves stale modules
  while every other knob says the deploy landed).
  ⚠ There *was* a fifth — the `?v=` on the node-city iframe `src` in index.html. It is now
  derived from `BUILD_VERSION` and needs no bump. Do not turn it back into a literal: it
  sat stale twice, and because sw.js is cache-first for iframe SUB-RESOURCES a stale value
  serves the whole old city inside a new shell, with nothing to indicate it.
  Verify the EDGE with curl, never the deploy log, and poll — propagation across PoPs
  takes up to a couple of minutes.
