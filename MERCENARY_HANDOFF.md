# ⚔ Mercenaries — handoff

Built 2026-09-07 on `claude/mercenary-escrow-system-n5o46z`, build **v120x0**.
Commit `95ea989`.

**Nothing is live yet.** The code ships inert; the feature turns on when
`sql/038_mercenary_board.sql` is run by hand in the Supabase editor for project
`ktsiasyjusesawtrwrjc`. Until then the hub renders "not set up on this world
yet" and nothing else in the game is affected. See **DEPLOY**, bottom.

---

## THE PINNED DESIGN DECISION

> **Delivery auto-settles. The employer gets no Accept button.**

The obvious build is *mercenary delivers → employer presses Accept → money
moves*. That hands the employer a free option: take the goods, never press the
button, and the mercenary is out a stash with no recourse but a support ticket.

The manifest is written down at post time, so the server can tell whether it was
met **without asking anyone's opinion** — so it does, and the employer's
judgement is removed from the payment path entirely. The employer is protected
on the other side by the manifest itself: they wrote it, and a delivery that
does not match it does not settle (`merc_deliver` refuses both over-delivery and
off-manifest items outright).

If someone later asks for an approval step, this is the paragraph to re-read
before saying yes.

### The second pinned decision
> **Escrow is a real `wallet_charge`, not a promise to pay.**

Posting a contract *charges* the reward inside the same transaction that writes
the row. There is no "posted but unpaid" state anywhere in the schema, and
therefore nothing to reconcile if a client dies mid-post.

---

## VERIFIED ANCHORS (checked against the live file at v120x0)

| What | Where |
|---|---|
| Migration | `sql/038_mercenary_board.sql` — 1006 lines, 7 tables, 13 RPCs, RLS + verify queries in the same file |
| Module | `public/src/mercenary/` — 7 files, ~1570 lines |
| **The seam** | **`window.MythicMercBridge`, `public/index.html` L207461** |
| `adoptBalance()` — the only Cinder write | `public/index.html` L207532 |
| Main-menu tile | `public/index.html` L114630 (directly under 📡 Emergency Broadcast) |
| `<script type="module">` tag | `public/index.html` L223241, `?v=v120x0merc1` |
| Canonical wallet (what escrow rides on) | `wallet_charge` / `wallet_credit`, `user_progress.cinder` |
| Adoption pattern this copies | `chargeCinderAtomic()` `public/index.html` L57025 |
| Forge resources (incl. customs) | `RESOURCES` + `SALVAGE_RES`, mutated in place by `_applyResourceCustomization()` L75533 |
| Custom cards | `getAllCustomCards()` L51006 |
| Card / item ownership | `_resOwnCount` / `_resTakeOwned` / `_resGiveOwned` L55334 |
| Uncapped refund path | `_refundRes()` L39571 |
| EB feed precedent | `openShareToBroadcast()` L60052 → `eb_posts` / `eb_clips` |

---

## THE FLOW, END TO END

```
EMPLOYER                          SERVER                         MERCENARY
   │
   │ merc_post_contract ─────────►  wallet_charge(reward)   ← the escrow IS this
   │                                merc_contracts (open)
   │                                merc_escrow +reward
   │                                eb_posts (kind='merc_job')  ──► network feed
   │                                                                    │
   │                              ◄──────────────────── merc_apply ─────┤
   │  eb_notifications ('merc_apply')                                   │
   │                                                                    │
   │ merc_hire ──────────────────►  contract → 'hired'                  │
   │                                eb_notifications ────► 'merc_hired' ┤
   │                                                                    │
   │                              ◄──────────────── merc_deliver ───────┤ (goods leave
   │                                merc_deliveries (append-only)       │  the stash
   │                                                                    │  FIRST)
   │                                ── manifest still short? ──► return, keep going
   │                                ── manifest MET? ──► contract 'settled'
   │                                                   merc_escrow -reward
   │                                                   merc_award_badges()
   │                                                   eb_notifications ×2
   │                                                                    │
   │ merc_claim('employer_goods') ►  claim PK insert ◄ merc_claim('merc_cinder')
   │   goods land in the stash        = the lock         wallet_credit(ref)
```

**Cancel:** employer may cancel an `open` contract any time, and a `hired` one
only once its deadline has passed. Escrow refunds immediately (`wallet_credit`
with `ref = merc:refund:<id>`); anything already delivered goes back to the
mercenary via a `merc_return` claim.

---

## WHY THE TWO SIDES MOVE IN OPPOSITE ORDERS

This is the single most important thing to understand before touching
`merc.api.js`.

- **Money moves SERVER-FIRST.** `merc_post_contract` charges inside its own
  transaction. The client's `Profile.gems` is stale *high* the instant it
  returns, so the RPC hands back `new_balance` / `tax_amount` / `wallet_seq` and
  `adoptBalance()` applies all three. That is why the money RPCs return `jsonb`
  and not a row.
- **Goods move CLIENT-FIRST.** `Profile.salvage` and `Profile.cardCollection`
  are *client* state — the server cannot debit them — so `deliver()` takes the
  goods out **before** writing the delivery row, and unwinds leg by leg if the
  write fails. Same escrow-first order `/src/trading` uses, and for the same
  reason: writing the row first and discovering the player never had the goods
  mints them from nothing.

### `refundRes` vs `addRes` — do not "simplify" these into one call
- `refundRes` is **uncapped** and is only ever an UNDO of a deduction the same
  call stack just made (a delivery the server refused).
- `addRes` **CREATES** units and respects the stash cap.

The board checks `M.acceptable()` for room **before** it claims, because a claim
is a one-shot PK insert — a clamp discovered afterwards is goods that no longer
exist anywhere. `Collect` disables its own button and says why.

---

## SECURITY MODEL

**RLS is the entire boundary. Review every policy line by line.**

| Table | Policies |
|---|---|
| `merc_profiles` | SELECT (public) · INSERT/UPDATE/DELETE, all `user_id = auth.uid()` |
| `merc_contracts` | **SELECT only** — open board is public; closed rows only to the two parties |
| `merc_applications` | **SELECT only** — applicant sees theirs, employer sees their contract's |
| `merc_escrow` | **SELECT only** — the two parties |
| `merc_deliveries` | **SELECT only** — the two parties |
| `merc_claims` | **SELECT only** — `claimed_by = auth.uid()` |
| `merc_badges` | **SELECT only, world-readable** (the EB site renders these signed-out) |

Every write goes through a `SECURITY DEFINER` RPC. A direct `UPDATE` from a
client matches zero rows, and the table grants are revoked on top of that so a
future policy added in haste cannot open a write path by itself. The badge
writers (`merc_award_badges`, `_merc_badge`) are **not executable by any client
role at all** — they are invoked inside `merc_deliver`'s settling transaction.

### Three traps that are load-bearing, not tidiness

1. **No counter columns on `merc_profiles`.** RLS gates *rows*, never *columns*
   (sql/029, sql/031 both say so). A player must be able to UPDATE their own
   bio, so a `jobs_done` column beside it would be a badge you can type into
   yourself. Standing is derived by `merc_public_stats()` instead.
2. **`on conflict on constraint merc_claims_pkey`**, not `on conflict
   (contract_id, party)`. `merc_claim` declares `RETURNS TABLE` columns with
   those names, and plpgsql exposes them as *variables* — a bare column
   reference raises "column reference is ambiguous" at runtime and **every claim
   in the game fails**. Exactly the trap `wallet_charge` documents about its own
   `wallet_seq`.
3. **`merc_public_stats` is `SECURITY DEFINER`.** Under `security_invoker` the
   view's own subqueries obey `mc_sel`, which hides settled contracts from
   everyone but the two parties — so the board reported *0 jobs, 0 Cinder* to
   exactly the signed-out visitors it exists for. The definer function bypasses
   RLS and can express nothing else: two integers, and only for a player who has
   a `merc_profiles` row (i.e. who opted in to being listed).

⚠ **The view depends on `eb_profiles` being anon-readable.** Verified against
the live project: `anon` holds SELECT and `eb_prof_read` is `using (true)`. If
that is ever tightened, drop the join and serve `p.label` alone — do **not**
"fix" it by turning `security_invoker` off, which would hand the view every row
`merc_profiles`' RLS is there to gate.

---

## WHAT THIS DELIBERATELY DID NOT DO

- **Did not reuse `boe_merc_listings` / `boe_merc_contracts` / `boe_merc_posts`.**
  Those already exist and are **not this**: they are the Bank of Ethos *hourly
  wage clock* (`clocked_in_at`, `pause_ms_accum`, `rate_per_hour`), settled by
  `boe_merc_settle()` by the hour. This is piece-work against a goods manifest
  with escrow. Sharing tables would mean one status column meaning two different
  things. They stay separate on purpose; neither was touched.
- **Did not use `wallet_holds`.** The name is a trap — it is *not* an escrow
  ledger, it is the overflow buffer for `wallet_credit`'s 24h credit ceiling,
  drained by `wallet_holds_release()`. Parking contract escrow in it would put
  player money in a queue whose whole job is to hand it back to the same player.
- **Did not validate resource ids server-side.** The point of the feature is
  "every resource that was created in the Forge". `Forge.customResources` is
  authored client-side and published through the catalog row; `_wh_known_resource()`
  would reject exactly the custom resources this board exists to trade. Ids are
  length-checked and stored verbatim; the client resolves them via `_meta()`.
- **Did not add a platform cut or any new economy number.** `wallet_charge`
  already applies the 2% Foundation Tax on the employer's escrow funding, and
  100% of the reward reaches the mercenary. `_opEcon()` is for corp *operations*
  and does not apply here.
- **No image/video anywhere.** A mercenary "portfolio" upload would walk
  straight into the CSAM obligation CLAUDE.md puts out of scope. Text only.
- **No Discord.** Untouched, per the standing overrule.
- **Did not touch battle, card, or economy code.**

---

## BADGES

Six, three tiers each, awarded only by `merc_award_badges()` at settle. Tiers
only go up; re-awarding a held tier is a no-op, so it is safe to call on every
settle and safe to backfill by hand.

| id | icon | tiers | counts |
|---|---|---|---|
| `first_contract` | 🎖 | 1 | first settled contract |
| `runner` | 🏃 | 5 / 25 / 100 | contracts delivered |
| `quartermaster` | 📦 | 10k / 100k / 1M | resource units hauled |
| `archivist` | 🃏 | 10 / 50 / 250 | custom cards delivered |
| `punctual` | ⏱ | 5 / 20 / 50 | settled before the deadline |
| `bankroll` | 🔥 | 100k / 1M / 10M | Cinder earned |

`public/src/mercenary/merc.badges.js` is a **caption table, not an authority** —
it turns a `{badge_id, tier}` row the server already wrote into an icon and a
sentence, and mirrors the thresholds only so the UI can say "3 more runs to
Runner II". **If you change a threshold, change the SQL first.**

---

## EMERGENCY BROADCAST WIRING

Everything is written server-side, so the website needs no game client:

| Event | Writes |
|---|---|
| Post a contract | `eb_posts` `kind='merc_job'`; the id is stored back on `merc_contracts.eb_post_id` |
| Apply | `eb_notifications` `kind='merc_apply'` → employer |
| Hire | `kind='merc_hired'` → mercenary |
| Manifest met | `kind='merc_delivered'` → employer, `kind='merc_paid'` → mercenary |
| Badge earned | `kind='merc_badge'` → mercenary |
| Cancel | `kind='merc_cancelled'` → mercenary |
| Public profile | `merc_public_standing` view — `anon`-readable: handle, bio, rate, jobs_done, cinder_earned, badges |

⚠ Every EB write is wrapped in `exception when others then null`. Those tables
live with the mythicspellbook.xyz site; a missing one must cost the post its
publicity, **never** the contract or the player's Cinder.

**For the website author:** read `merc_public_standing` for the profile block,
and `merc_contracts where status='open'` for a jobs board — both are readable by
`anon`. `eb_posts.kind='merc_job'` are already in the existing feed query.

---

## HOW THIS WAS VERIFIED (and what that caught)

Reproduce with a throwaway Postgres 16 (`/usr/lib/postgresql/16/bin`, run as the
`postgres` user — it refuses to run as root):

1. Stub schema: `auth.users`, `auth.uid()` reading
   `request.jwt.claim.sub`, `user_progress`, `user_profiles`, `wallet_ledger`,
   `wallet_holds`, `reserve_tax_log`, `eb_profiles`/`eb_posts`/`eb_notifications`,
   roles `anon` + `authenticated`.
2. Load the **live** `wallet_charge` / `wallet_credit` via
   `pg_get_functiondef` — not a friendly mock.
3. Apply `038` twice (idempotency), then drive it as two accounts with
   `set local role authenticated; set local request.jwt.claim.sub = …`.

**That harness caught three real bugs before this shipped:**

- The ambiguous `ON CONFLICT` target above — would have broken **every claim**.
- A missing `qty` key made `!~` evaluate to NULL, which `IF` treats as false, so
  the line sailed past *both* manifest validators. Now `is null or …` explicitly.
- The public standing view reporting 0 jobs to signed-out visitors. It read
  perfectly as the mercenary themselves, which is exactly why it would have
  shipped.

Also: **36 module assertions** (manifest maths, delivery unwind against real
balances, double-claim, escrow adoption, degradation) and **7 driven Chromium
interactions** (resource + card pickers, the focus-steal trap on the quantity
field, draft survival across tabs, the deliver-only-what-you-hold path).

### The regression tests worth keeping
- Escrow reconciliation: every `settled`/`cancelled` contract must net to **0**.
  ```sql
  select c.status, count(*), sum(e.bal) as escrow_total
    from public.merc_contracts c
    join lateral (select coalesce(sum(amount),0) bal from public.merc_escrow
                   where contract_id = c.id) e on true
   group by 1;
  ```
- The four attacks in the file's VERIFY block: direct `UPDATE` of a reward, a
  self-awarded badge, calling `merc_award_badges` directly, hand-writing an
  escrow row. All must be refused.

---

## DEPLOY

1. **Apply the migration.** Paste `sql/038_mercenary_board.sql` into the Supabase
   SQL editor for `ktsiasyjusesawtrwrjc` and run it. It is idempotent and
   re-runnable. Then run the numbered VERIFY queries at the bottom of the file —
   expect 7 tables, 13 `merc%` functions, RLS true on all seven, and SELECT-only
   policies on everything but `merc_profiles`.
2. **Ship the client.** The three version knobs are already bumped **together**
   to `v120x0` — `public/version.txt`, `window.BUILD_VERSION` (L36444),
   `sw.js CACHE_VERSION`. Verify the EDGE with curl, never the deploy log, and
   poll: propagation across PoPs takes a couple of minutes.
3. **Smoke test with two accounts.** Post a small contract, apply from the second
   account, hire, deliver a partial, deliver the rest, collect both sides. Watch
   `merc_escrow` net to zero.

⚠ Bump `?v=` on `src/mercenary/index.js` on every change to the module — the
service worker serves `/src/*` network-first but the HTTP cache still applies,
and a missed bump ships invisibly.

---

## KNOWN GAPS / NEXT PASS

Scoped, not started. Do not assume any of these are half-built.

1. **The tile badge only knows the waiting count after the hub has been opened
   once this session.** The module does not query on boot, deliberately — a
   Supabase round trip on every cold start for a feature most players never
   touch is not worth a number on a tile. Until then it reads as a label, which
   is honest. **Do not "fix" this by prefetching claims during boot.** If a live
   count is genuinely wanted, fold it into an existing boot query rather than
   adding one.
2. **No realtime.** The hub reloads on open and after each action. `/src/community`
   already has the subscribe pattern (`community.realtime.js`) if a live
   applicant list is wanted.
3. **No expiry sweep.** A contract past its deadline stays `open` until the
   employer cancels it. `rl_expire_mine()` (sql/019) is the precedent for a
   caller-driven sweep — it would be `merc_expire_mine()`, employer-scoped, and
   must refund through the same `wallet_credit` ref.
4. **No dispute path.** Deliberate: auto-settle plus the over-delivery refusal
   removes the two cases a dispute would exist for. If one is ever needed, it is
   a new status and a new claim party — **not** an edit to a settled contract.
5. **Tags on `merc_profiles` are stored but never surfaced.** The column and the
   RPC parameter exist; the UI passes `[]`. A specialty filter on the roster is
   the natural next step.
6. **`merc_contracts.reward` is capped at 2,000,000** to mirror `wallet_credit`'s
   `c_max_single`. A reward above it could be *charged* at post time and then
   refuse to *credit* at settle — the one shape of bug that eats a player's money
   outright. If the wallet ceiling ever moves, move this check with it, in both
   the SQL and `merc.manifest.js` `MAX_REWARD`.
