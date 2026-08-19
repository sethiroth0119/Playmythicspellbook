# Handoff — 2026-08-19

**Branch:** `city-construction-timers` · **HEAD** `e403bb7fb7` · tree clean, nothing unpushed
**Live:** `v120y6` (Cloudflare) · MP server live on Fly, **not** redeployed this session

---

## 1. The one decision that gates the next job

**How far does board authority go?**

| | |
|---|---|
| **A — enforce the host role** | ~~Small.~~ **Not viable as written — verified 2026-08-19.** The client computes `amIHost` and never enforces it, true. But a guest's play reaches the host **only inside its snapshot** (`sendColyseusAction()` has 0 callers; the `action` channel is dead), so host-only relay would silently break every guest turn. A now costs "wire the action channel first" — it is step 3, not step 1. See the plan file. |
| **B — the server owns the board** | The engine exists and is deterministic under load, but **has never seen a real match** (see the correction in §2). Wire the `action` channel, reconcile the two engines against real play, then move board reads onto the `@type` schema field by field. Weeks, not hours — and steps 1–2 are now shared with A. |

**A is a strict subset of B**, so A-then-B wastes nothing.

> **2026-08-19 — this decision is no longer the gate.** Both A and B now begin
> with the *same* first step: give `sendColyseusAction()` its callers, so the
> server's board is populated by real play at all. Until that lands there is
> nothing to enforce (A) and nothing to migrate onto (B). Seth's A-vs-B call is
> still needed, but it can be made *after* step 1 rather than before it — and
> step 1 needs no decision, because neither path can skip it.
> Detail and verification: `colyseus-server/RELAY_CLOSURE_PLAN.md`.

⚠ **Why this is not a free choice:** Aza is real withdrawable money (1 ◈ = $1 =
5,000 ₵, the same rate the cashout vault settles at). Under A, the host is a
player's browser and can make the board say anything. If a PvP outcome ever
touches currency or ranking, **A alone is not safe**.

**Also needed from Seth:** two real test accounts in one corporation (the load
test uses `AUTH_DEV_BYPASS`, which never runs in production, so a real
two-player match cannot be self-served), and whether PvP may be briefly
disrupted or needs a feature flag.

---

## 2. Multiplayer status — measured, not assumed

| | |
|---|---|
| Auth | ✅ Production **rejects a tokenless join** — *"No auth token provided."* JWTs verified via `jose` + `createRemoteJWKSet`. |
| Matchmaking (1 process) | ✅ Exact, via `.filterBy(['matchId'])`. Supabase pairs; Colyseus hosts. |
| Server combat engine | ⚠ **Correct but never driven.** 100/100 pairs byte-identical at 200 clients — but those units were played by the *load test*. `sendColyseusAction()` has **0 callers**, so in production `state.units` is empty and this engine does not run. |
| Join latency | p50 5ms · p95 8ms · max 32ms · 400/400 snapshots, zero loss |
| Horizontal scaling | ⚠ Wired but **OFF**. **Do not `fly scale count 2` without `REDIS_URL`** — two processes without a shared registry silently fail to pair players holding the same matchId. |
| Board-state relay | ❌ **200/200 relayed snapshots contradicted the server** — this is the desync |

Guard for all of it: `cd colyseus-server && npm run loadtest`.
**Check `no-units` first** — if non-zero the run compared nothing and the green
means "I never looked".
⚠ Necessary but **not sufficient** — `no-units` is clean precisely because the
test plays its own units. It says nothing about whether the real client does.

Next steps and the gating question are in `colyseus-server/RELAY_CLOSURE_PLAN.md`.

---

## 3. Shipped this session

| Build | What |
|---|---|
| v120x4–x9 | board freeze (negative `arc` radius latching `frameErr`), sprite relight, backdrop, opening reveal, Aza mint closed, card backs, target colours, corpse→owner graveyard |
| **v120y0** | Assets: images **2.85 GB → 0.25 GB**, GLB 975 → 270 MB, audio 319 → 10.1 MB, GIF 113 → 0.30 MB, all 3D self-hosted |
| **v120y1** | AI step 4.35 → 2.02 ms (−54%), decisions byte-identical across 7 scenarios |
| **v120y2** | Corp payroll wired end to end (backend existed, UI never called it) |
| **v120y3** | `__mg.gradeAB()` harness |
| **v120y4** | **Fresh-device sign-in no longer overwrites the cloud save** |
| **v120y5–y6** | Opening deal + phase banners |

---

## 4. Open work, in priority order

1. **Board-state relay — first concrete step is now known and needs no decision:**
   wire `sendColyseusAction()` (0 callers today) into the playUnit / attack /
   move sites so the server's board is populated by real play. Verify by
   checking `state.units` is non-empty after a real two-player match. Both
   authority options depend on it. See §1 and `colyseus-server/RELAY_CLOSURE_PLAN.md`.
2. **`fly scale memory 1024`** — one command, Seth's (changes the bill).
3. **The sync allowlist → denylist.** Camp roster, lab cores, city shop layouts
   and three currency ledgers (`hg_wallet_recon`, `hg_purge_owed`,
   `hg_economy_owed`) live **only in browsers**. The file calls the current
   design *"the FIFTH silent-save bug this project has shipped."* Needs a
   migration-on-login **before** local reads are removed — never destructive-first.
   Details: `remediation/identity-audit.md` Finding 2.
4. **`__mg.gradeAB()`** — never run. Two arms, 24s, from the top-level console.
   ~253 ms (dev pane) vs 8.7 ms (file's own note) are different decisions and
   only a compositing browser can tell them apart.
5. **Persistent simulation** — `simulation/tick-audit.md`. Worst: `_osimAnimate`
   runs production inside a RAF and has **two disagreeing rates** for the same
   field. Expeditions/caravans are **deleted on every F5** (session clock,
   unserialized) — live player loss, small fix.
6. **Decisions awaiting Seth** — `BRIEFS_DECISIONS.md`. C1 (offline raiding) is
   decided; its four constants are proposed, not confirmed.
7. **R2 migration** — `migration/audit-report.md`. Supabase Storage bucket sizes
   still unmeasured (needs S3 keys).

---

## 5. Traps that cost real time — do not re-learn

- **Nine deploy knobs, not four.** `sw.js` is network-first only for navigations
  and `/src/`. Anything loaded as a **sub-resource** is cache-first and its `?v=`
  is the only buster. **Grep `?v=` and read the values** — grepping the version
  string alone misses them. `corp/index.html` was found on `app.jsx?v=120p3`,
  which would have shipped a Pay button no player received.
- **A test not listed in `run.mjs` is not a gate.** `repairtrap.mjs` was reported
  green across two rounds while the runner never opened it.
- **The Browser pane does not composite** and its `setTimeout` is throttled when
  hidden. Drive `window.frame(t)` directly with a rising timestamp; confirm it
  ran by **counting calls**, never by diffing a pixel (a static scene diffs to
  zero and reads as "not repainting"). **Locate a sprite by differencing two
  renders**, never by computed coordinates — three measurements were void
  because the sample window was on ground, and the numbers looked plausible.
- **Verify against the thing that ships.** The opening-deal CSS targeted
  `.hand-column-cards`; battles render `renderHandStrip()` → `.hand-strip-cards`.
  The probe used the class just written, which only proved the CSS was live.
- **A load test that cannot fail is worse than none.** Its first version played
  no units, so the board was empty and both checks passed having compared
  nothing.
- **Ask who drove the test, not just whether it passed.** The load test's
  "100/100 byte-identical" measured the server engine — driven by units the
  *test itself* sent via `room.send('action')`. The shipping client sends no
  actions at all, so the green described a code path production never enters.
  `no-units` cannot catch this: the test populates the board itself. A guard
  only guards the caller it actually has.
- **Intent comments in the MP block are not descriptions of working code.**
  `index.html` asserted *"Actions were already forwarded to the server before
  being applied"* — false, and it is what the relay-closure plan was built on.
  `amIHost` calls itself *"the single engine of record"* and gates nothing.
  Enumerate call sites before believing a comment.
- **Perf intuition was wrong twice.** Raising `POST_CADENCE` 12→36 to make a
  rebuild rarer made it **3× worse** (20 → 76 spikes): a longer gap means more
  work queued when the readback forces a flush. Reverted.
- **`git log`/`status`/`commit` work fine on a corrupt object**; only
  `push`/`fsck`/`rev-list` fail.
- **node is not on PATH** — see `memory/node-not-on-path.md`.
- **`assets-source/` is 1.4 GB and gitignored** — masters for every conversion.
  Nothing was deleted.

---

## 6. Verify a release, always at the edge

```bash
curl -sL -H 'Cache-Control: no-cache' https://playmythicspellbook.com/version.txt
```

Poll — PoP propagation takes a couple of minutes, and the first read is often
the previous build. Never trust the deploy log.

Gates: `node _synckcheck.mjs` · `node tools/economy-tests/run.mjs` ·
`node _jsxcheck.js public/corp/app.jsx` · `cd colyseus-server && npx tsc --noEmit`
