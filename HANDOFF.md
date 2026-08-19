# Handoff — 2026-08-19

**Branch:** `city-construction-timers` · **HEAD** `e403bb7fb7` · tree clean, nothing unpushed
**Live:** `v120y6` (Cloudflare) · MP server live on Fly, **not** redeployed this session

---

## 1. The one decision that gates the next job

**How far does board authority go?**

| | |
|---|---|
| **A — enforce the host role** | Small. The client already computes `amIHost = String(myId) < String(oppId)` and calls it *"the single engine of record"*, but **never enforces it** (5 refs in 215k lines, none gating snapshots). Enforcing it server-side in the `snapshot` handler turns two racing engines into one engine + a follower. |
| **B — the server owns the board** | The engine already exists and is proven clean at 200 clients. Move the remaining board reads off the relay onto the `@type` schema, field by field. Weeks, not hours. |

**A is a strict subset of B**, so A-then-B wastes nothing.

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
| Authoritative combat sync | ✅ **100/100 pairs byte-identical at 200 clients**, 0 disagreements |
| Join latency | p50 5ms · p95 8ms · max 32ms · 400/400 snapshots, zero loss |
| Horizontal scaling | ⚠ Wired but **OFF**. **Do not `fly scale count 2` without `REDIS_URL`** — two processes without a shared registry silently fail to pair players holding the same matchId. |
| Board-state relay | ❌ **200/200 relayed snapshots contradicted the server** — this is the desync |

Guard for all of it: `cd colyseus-server && npm run loadtest`.
**Check `no-units` first** — if non-zero the run compared nothing and the green
means "I never looked".

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

1. **Board-state relay** — see §1 and the plan file.
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
