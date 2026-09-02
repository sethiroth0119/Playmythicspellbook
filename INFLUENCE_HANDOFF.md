# 🎖 Influence — handoff (written 2026-08-27)

Everything below is verified against a real Postgres 16, a real Chromium, and the
live PR — not from memory. Where a claim was checked, this says how.

## Where things stand

| | |
|---|---|
| Branch | `claude/influence-card-rewards-c7fhgg` |
| HEAD | `9ec0b78` |
| Pushed | yes — local and remote identical |
| PR | [#1](https://github.com/sethiroth0119/Playmythicspellbook/pull/1), open, green, clean, 0 review threads |
| `main` | **NOT merged** — this is the one step left |
| `sql/038` | **applied** to project `ktsiasyjusesawtrwrjc` |
| Live version | `v120x5` in the repo; **not deployed** (deploy happens on merge) |
| Working tree | clean |
| Diff | +2,632 / −3 across 9 files, 7 commits |

⚠ **Merging auto-deploys.** `.github/workflows/deploy.yml` fires on push to `main`
and ships `./public` to Cloudflare. Since the SQL is already applied, merging lands
the feature paying Cinder rather than in its degraded offline mode.

⚠ There is **no PR-time test workflow** in this repo. The green check is Cloudflare's
build, not a test suite. The behavioural coverage is the local suites below.

## What the feature is

A standing track for a player and their camp. Envoys arrive at the gate on a **48h
clock** (banking up to 3) and carry one of four things. What they carry, and how rare
it is, follows three inputs blended into one `standing` dial: the player's node tier,
their Influence level, and their Foundation Reserve rep.

| Kind | What happens |
|---|---|
| 🪙 Cinder | Server-rolled, scaled by influence level, hard-capped at 50,000. Credited to the canonical wallet by the RPC itself. |
| 📜 A card | Spell / trap / weather / location / wall / unit. Custom cards preferred; Forge obtainment locks honoured. |
| 🧍 A recruit | Accept → collection. Sell → Cinder at player-market value, clamped to the rarity's band. |
| 🚚 A supply convoy | On a full stash the envoy says *"You do not have enough space maybe next time."* and delivers **nothing**. |
| 📬 Unreceivable | Nothing to hand over yet (empty card pool) — they wait at the gate rather than being spent. |

Entry point: one button in the **CAMP STATUS** bar, beside Fortify / Broker Truce.

## Where the code lives

New feature, so `public/src/influence/` as ES modules per CLAUDE.md — no new
top-level system in index.html.

| File | Owns |
|---|---|
| `model.js` | The curves and the ladder. Mirrors the SQL for the offline path and display. |
| `envoys.js` | Who turns up; hydrating a server encounter into the display shape. |
| `server.js` | The three RPCs, guarded. Computes nothing. |
| `render.js` | The modal, with its own injected styles. |
| `index.js` | Path selection (server vs offline), persistence, click handlers. |
| `sql/038_influence_server_authoritative.sql` | State, ledger, claim/resolve RPCs. RLS in the same file. |

index.html contributes exactly three things: `window.MythicInfluenceBridge` (next to
MythicCityBridge), one CAMP STATUS button, and the script tag. If `/src/influence`
404s the camp loses the button and nothing else.

🔴 **`sql/038` is canonical for the payout math.** `model.js` mirrors it for the
offline path and for display only; when the RPCs answer, the client renders what came
back and recomputes nothing. **Retune a curve in the SQL first, then mirror it.**

## The security model, and what it does not cover

`sql/038` exists because the first two commits put the whole rate limit in the
browser — `Date.now() - lastAt >= 48h`, against a clock the player owns. sql/034's
own header names the fix: *"per-faucet RPCs where the SERVER computes the amount from
state it owns."*

**Server-owned:** the clock (`now()`), the RNG (`random()`), the level, the standing,
and every amount. `influence_state` has no insert/update/delete policy for
`authenticated`. Verified against Postgres 16 with the **production RLS policies** —
every hostile write and internal call refused at the grant level:

```
xp forge .............. REFUSED     forge ledger row ...... REFUSED
clock rewind .......... REFUSED     call roll_cinder ...... REFUSED
self-dealt envoy ...... REFUSED     call roll_rarity ...... REFUSED
read another user ..... REFUSED     call sale_cap ......... REFUSED
```

**The client still supplies three things, all bounded by construction:**

| Input | Why it is safe |
|---|---|
| `p_card_id` | The card at the server's rolled rarity. Progression, not money — and the sale is priced off the server's stored rarity, so substituting a mythic buys nothing. |
| `p_sale_price` | The DVS valuation. Clamped to that rarity's band: 1,000,000 for a common pays **500**; for a mythic, **40,000**; a negative price floors. |
| `p_free_space` | Stash headroom. Can only ever make a delivery *smaller*. |

### 🔴 Two things this does NOT close — read before extending

**1. `reserve_contributions.points` is client-writable.**
`rc_upd: for update to authenticated using (user_id = auth.uid())` lets a player set
their own `points` to any number straight through PostgREST, and index.html performs
exactly that write on every deposit. Influence no longer pays for it — rep keeps only
its bounded 0.25 weight in `standing`, worth at most +7.5% Cinder — but **anything
else reading those points still trusts a forgeable number.** Closing it means
revoking UPDATE and moving deposits to an RPC: its own migration, on a live table
with an existing client write path.

**2. `economy_nodes.meta` is client-writable.**
`en_ins`/`en_upd` gate on `owner_id` only, with no constraint on `meta`, so a player
can stamp `meta.tier = 'eternal'` on a node they own. Influence therefore reads node
tier from `pledge_purchases` **only** (Stripe edge functions, service role — a paid
row cannot be forged). ⚠ **An admin tier override no longer feeds Influence.**
Restoring it means putting the override somewhere `authenticated` cannot write —
*not* `economy_nodes.meta`. PRN payouts still use their own resolution and are
untouched.

Left trusted, those two were a **~23× Cinder inflation**: forging both took a
brand-new camp to level 6 / standing 0.80 / node_rank 6, moving the per-envoy cap
from ~1,000 to **23,607**. Measured, not estimated. After the fix, same cluster, same
attack: level 1, standing 0.25, node_rank 0, max **1,075**.

### A design decision that was reversed for security

Rep used to set a **floor on the level** — a Civilization Builder started at
Influence 6 rather than 1. That is gone. Rep is forgeable and the level drives the
Cinder band directly, so the floor alone was worth ~19×. **The level now comes from
`influence_state.xp` and nothing else**; xp is written only by `influence_resolve`,
which makes it the one input with no forgery path. This is a real UX loss for
established contributors — if you want the head start back, it has to come from an
unforgeable source.

## Verifying

**SQL.** `sql/038` carries a **self-contained** verify block at the bottom — paste
and run it verbatim, no placeholders to substitute. It rolls back, so nothing
survives including the Cinder it credits. Expected output is recorded next to it:

```
a) 1/1   b) a kind   c) true   d) true   e) nothing_pending
f) no_envoy, 48.0   g) 500   h) true   i) REFUSED
```

⚠ An earlier version of that block had `'<a user_id>'` placeholders and failed with
`22P02: invalid input syntax for type uuid` from inside `influence_peek()`. That is a
placeholder error, **not** a migration failure — the function running at all proves
the migration applied.

**JavaScript.** `node _synckcheck.mjs` (not `build.mjs`) for index.html. The three
driven suites that covered this work lived in the session scratchpad and are **not in
the repo** — they were harnesses, not fixtures. What they asserted:

- the 50,000 ceiling over 200k rolls; the refusal path with the exact wording;
  resolve-time headroom re-check; anti-reroll persistence; absent-bridge inertness
- the server path: credited exactly once, `addGems` **never** called (no double
  credit), the sale clamp, refusal from the server's decision
- the offline path: 300 envoys, **zero** Cinder

**Browser.** Serve `public/` over http (ES modules will not load from `file://`) and
drive it with Playwright + the pre-installed Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Two gotchas that cost time:

- Screens inside `#app` **do not pixel-capture** in headless Chromium; body-level
  nodes (the modal, toasts) do. Verify in-app UI at the DOM level, not by screenshot.
- The camp screen is gated behind **Hero Lv 3** (`isCampUnlocked`). Set
  `Profile.heroes[x].level = 3` before expecting the CAMP STATUS bar to render.

## Gotchas worth knowing

- **An empty card pool is NOT a defect.** `Forge.useCustomOnlyPool` skips the entire
  built-in catalogue, and `getAllCustomCards()` is empty until the catalog fetch
  lands — so a signed-out or still-booting client has **zero** cards. Packs see the
  same pool. Influence handles it by showing the envoy as unreceivable and leaving
  the server row pending, rather than burning it.
- **Never call `addGems` on the server path.** `influence_resolve` credits the wallet
  before it returns. Crediting again pays one envoy twice — once for real, once into
  the mirror that later reconciles *up*. Use `bridge.syncCinder(balance)`, which only
  raises the local display.
- **`Profile.influence` rides the forge JSONB piggyback** in both the upload and
  restore whitelists. Without it the track is localStorage-only: the rewards are
  cloud-synced, so a second device would restore the payouts and lose the track that
  earned them — and a fresh clock is a free envoy per device.
- **The ladder is denominated in visits.** `INFLUENCE_LEVELS` was written for the 4h
  cadence; the 48h change required rescaling it or Mythic Authority would have sat
  475 days out. If you retune `ENVOY_INTERVAL_MS`, retune the ladder — both carry a
  comment pointing at the other.

## Not in this pass

- **The card-substitution gap.** The client picks *which* card sits at the server's
  rolled rarity. Bounded (the sale is priced off the server's rarity, so it cannot be
  monetised) but not eliminated — closing it needs a server-side card catalogue,
  which this repo does not have.
- **Locking down `reserve_contributions.points`** — see above.
- No admin UI for Influence; no per-player tuning; no push notification when an envoy
  arrives.

## The one step left

Merge [PR #1](https://github.com/sethiroth0119/Playmythicspellbook/pull/1). That
auto-deploys. Then verify at the **edge** with curl (never the deploy log) and poll —
propagation across PoPs takes a couple of minutes:

```bash
curl -s https://playmythicspellbook.play-a3d.workers.dev/version.txt   # expect v120x5
```

⚠ Per HANDOFF.md, **`version.txt` alone is not proof** — it is a static file. Check a
runtime marker inside the served page too:

```bash
curl -s https://playmythicspellbook.play-a3d.workers.dev/ | grep -o "BUILD_VERSION = '[^']*'"
curl -s https://playmythicspellbook.play-a3d.workers.dev/ | grep -o "src/influence/index.js?v=[^\"]*"
```

The second one is the real check for this feature: if the `?v=` is stale, the service
worker is serving the old module however green the deploy looked.

Then watch the faucet:

```sql
select left(user_id::text,8) usr, kind, choice, rarity, level, cinder, created_at
  from public.influence_ledger order by created_at desc limit 50;

select date_trunc('day', created_at) d, sum(cinder)
  from public.influence_ledger group by 1 order by 1 desc limit 14;
```
