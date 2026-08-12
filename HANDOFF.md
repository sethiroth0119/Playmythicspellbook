# Handoff — Mythic Spellbook (written 2026-08-12)

Everything below is verified against production and the live database, not from memory.

## Where things stand

| | |
|---|---|
| Branch | `v120t9-economy-security-gpu` |
| HEAD | `a3ed2ec585` |
| `main` | same commit — branch was fast-forwarded into it |
| Pushed | yes, branch **and** `main` are on GitHub |
| Live version | **v120v9**, verified at the Cloudflare edge |
| Working tree | clean |

Nothing is half-finished. Every code item from the last run is written, tested,
committed, pushed, deployed, and edge-verified.

## Setting up the new PC

```bash
git clone https://github.com/sethiroth0119/Playmythicspellbook.git
```

```bash
cd Playmythicspellbook && npm install
```

Then you need, outside the repo:

- **Cloudflare** — `npx wrangler login` (deploys go to worker `playmythicspellbook`).
- **Supabase** — project `ktsiasyjusesawtrwrjc`. There is no CLI login in this repo;
  migrations in `/sql` are pasted into the Supabase SQL editor **by hand**. Every file
  is idempotent and re-runnable, so re-running one is safe.
- **Art assets** — a large amount of `public/assets/**` is untracked and lives **only on
  the old disk**. Copy `public/assets/` across before you decommission it. This is the
  one thing a clone will not give you.

⚠ **Copy the assets folder off the old machine first.** It is not in git.

## Deploying

```bash
node deploy.mjs
```

Three version knobs must move **together** or the in-app update check breaks:
`public/version.txt`, `window.BUILD_VERSION` in `public/index.html`, and `CACHE_VERSION`
in `public/sw.js`.

Syntax-check with `node _synckcheck.mjs` — **not** `build.mjs`.

Verify at the **edge** with curl, never the deploy log, and poll: propagation across PoPs
takes a couple of minutes. `version.txt` alone is not proof — it is a static file. Check a
runtime marker inside the served page.

### 🔴 The deploy-restore trap — this bit us today

`deploy.mjs` minifies `public/index.html` in place, uploads, then restores the source from
a backup. **If the machine dies mid-deploy, the restore never runs and your working tree
is left holding the 9 MB minified build.** It looks like a normal file; `git status` just
says `M public/index.html`.

Symptom: greps stop finding readable code, and the file has one ~7-million-character line.

Recovery, assuming you committed before deploying (always do):

```bash
git checkout -- public/index.html
```

Sanity check — real source is ~223,000 lines with a longest line under ~17,000 chars:

```bash
node -e "const s=require('fs').readFileSync('public/index.html','utf8');let m=0;for(const l of s.split('\n'))if(l.length>m)m=l.length;console.log(s.split('\n').length+' lines, longest '+m)"
```

**Commit before every deploy.** That commit is the only thing that makes this recoverable.

---

## Open items

### 1. Revoke `wallet_credit` from `authenticated` — the real prize, blocked on data

This is the last client-controlled money path. A player can currently ask the server to
credit an arbitrary number; the ceilings in `sql/034` bound the damage but do not close it.

It cannot be revoked until nothing legitimate still calls it with a client-chosen amount.
The blocker was `reconcile_local_gain_on_fetch` — the client compares its balance to the
server's and asks for the difference. The replacement (a credit **outbox** that replays the
specific reward with an idempotency ref, `sql/035`) is live and working:

| day | reconcile cinder | outbox replays |
|---|---|---|
| 08-10 | 704,708 | 0 |
| 08-11 | 139,526 | 0 |
| 08-12 | 9,860 | 86 |

93% drop the day the outbox shipped. v120v9 then attributed the last two unmirrored
faucets (roguelite run cash-out, reconstruction events), which should account for most of
the remaining 9,860.

**What to do:** watch the query below for a few days. Once reconcile sits at ~0:

1. Delete the difference-credit in `reconcile_local_gain_on_fetch`.
2. Change the `MAX(server, local)` adopt to a plain server adopt.
3. `revoke execute on function public.wallet_credit(bigint, text, text) from authenticated;`

Do **not** revoke early — it strands anyone mid-divergence today.

```sql
select to_char(date_trunc('day', created_at),'MM-DD') as day,
       count(*) filter (where reason ilike '%reconcile%')            as reconcile_rows,
       coalesce(sum(delta) filter (where reason ilike '%reconcile%'),0) as reconcile_cinder,
       count(distinct user_id) filter (where reason ilike '%reconcile%') as players,
       count(*) filter (where ref is not null)                       as outbox_refs
  from public.wallet_ledger
 where created_at > now() - interval '14 days'
 group by 1 order by 1 desc;
```

### 2. Reconstruction penalties are silently refunded — a real leak, needs your decision

Found while fixing the faucets, **not yet fixed** because it is an economy call, not a bug fix.

Reconstruction events can fine the player (`cinder:-800`, `cinder:-600`). That debit is
applied **locally only** — the server never hears about it. Then the `MAX(server, local)`
adopt sees the server's higher number and **hands the money back**. Penalties don't stick.

The obvious fix is `_serverMirrorCharge`, which is the established convention. But it books
**civic tax** on whatever it charges, so billing a *fine* through it would inflate the
Foundation Reserve tax pool from a non-market event. That's a design decision.

Two options:

- **A** — accept the tax side-effect, one-line fix using the existing helper.
- **B** — add a no-tax charge path (`wallet_charge` without the `_frTaxLedger` write) and
  use it for penalties.

I'd take **B**: a fine is not spending, and tax revenue that appears from nowhere is the
kind of thing that quietly distorts the Reserve numbers.

Note this survives the change in item 1 — a plain server adopt refunds penalties too.

Location: `_reconApplyEffects` in `public/index.html` (search `Reconstruction event`).

### 3. Vault restitution — tool is live, zero grants issued

`sql/031` deployed `admin_grant_vault_rows` (ref-idempotent, so a double-click cannot
double-grant), `admin_find_vault`, and `vault_grant_log`. You chose manual grants against
player reports. **0 grants have been issued**, so this is waiting on reports reaching you,
not on code. Worth checking players actually know where to report.

```sql
select count(*) as grants_issued from public.vault_grant_log;
```

### 4. Credit ceilings — quiet, just don't forget they exist

`sql/034` caps credits at 5,000,000 per call and 10,000,000 per hour. Refusals are recorded
rather than thrown. Currently **0 refusals**, so the limits are sized right. If someone ever
reports a large reward silently not landing, look here first.

```sql
select count(*), max(created_at) from public.wallet_ledger where op = 'refused';
```

### 5. Cosmetic — two dead fallback branches

`_wf3AddCinder` and one `addCinders` catch block fall back to a raw `Profile.gems` write if
`addCinders` is undefined. It never is (it's a plain function calling `addGems`). Harmless,
but they show up in every faucet audit as false positives. Delete when convenient.

---

## Things that are settled — please don't re-derive them

- **No Discord webhooks / no Discord integration.** Decided 2026-08-05. The community
  design doc argues hard for it; that recommendation is overruled.
- **No image or video upload. Text only.** Hosting UGC creates a non-deferrable legal
  obligation to detect and report CSAM.
- The design doc's claims about client-side chat profanity/rate limits are **out of date** —
  world chat goes through the `chat_send()` RPC and is enforced server-side. Never
  re-implement that in JS as enforcement.

## Gotchas that have each cost real time

- **The globals trap.** `Profile`, `Cloud`, `App`, `Corp`, `Forge` are top-level `const` in
  `index.html` — they are lexical bindings, **not on `window`**, so an ES module cannot see
  them. Modules get what they need through `window.MythicBridge` / `window.MythicCityBridge`.
  Add to the bridge; never reach for a bare global.
- **Bitwise `|` in searches.** `(Profile.gems | 0)` is a pipe, not an alternation. A grep
  for credit sites undercounted 44 as 16 because of this.
- **Never blanket-delete "duplicate" ledger rows.** 425 client rows looked like duplicates;
  only 77 had server partners. A blanket delete would have destroyed 348 rows of
  irreplaceable history.
- **The Browser pane does not composite** — `requestAnimationFrame` never fires, so
  RAF-batched `render()` does nothing and canvas rects read 0×0. Call renderers directly.
- **RLS is the entire security boundary.** Review every policy line by line; a missing
  `using (auth.uid() = …)` is a data breach that looks fine in review.
- **RLS recursion** — a policy on `community_members` that queries `community_members`
  recurses. Go through the `SECURITY DEFINER` helpers (`is_community_member`,
  `is_community_leader`).
