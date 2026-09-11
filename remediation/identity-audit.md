# Phase 0 — Cross-Device Identity Audit

**Date:** 2026-08-18 · **Status:** complete, read-only. No code changed.
**Brief:** `IDENTITY_FIX_BRIEF.md`

---

## VERDICT: Cause B — persistence leak. Cause A is ruled out.

Same UID on both devices; the save never reliably leaves the browser, and on a fresh device
the empty local profile is **uploaded over the cloud row**.

Ruling out Cause A (identity fracture):

- `signInAnonymously` — **zero hits repo-wide.** Auth is email/password only
  (`public/index.html:46562`, `:46605`). Phase 4 of the brief is therefore **not needed**.
- One browser Supabase client (`public/index.html:46193`); a second in
  `public/cloud-migrate.html:171` shares the default storageKey, so sessions do not split.
- One project ref (`ktsiasyjusesawtrwrjc`). No environment drift.
- No device-generated UUID is persisted as a player key. `_csNewId`
  (`public/index.html:164591`) mints shop-row ids only.

**Consequence for the plan:** Phases 1, 4, 5 and 6 of the brief are largely unnecessary.
The work is Phases 2 and 3. That is a big reduction in scope — but Phase 3 is now the
whole job, and it is the destructive one.

---

## Finding 1 — 🔴 THE FRESH-DEVICE ANTI-WIPE GATE CAN NEVER FIRE

This is the reported symptom, and it is worse than "progress doesn't follow you": it
**overwrites the cloud save with an empty profile.**

`_profileLooksEmpty(p)` (`public/index.html:47426`) exists to detect a brand-new local
profile so a fresh-device sign-in pulls the cloud account instead of pushing local up. Its
own comment states the intent:

> `// Better to err on the side of "looks empty" and pull cloud than to`
> `// wrongly believe local is fresh.`
> `if (typeof p.gems === 'number' && p.gems > 0) return false;`

But a default Profile ships **`gems: 30`** (`public/index.html:44901`) — the starting Cinder
grant. So a brand-new profile trips the guard on its very first field and
`_profileLooksEmpty` returns **false** for every fresh install that has ever booted.

Therefore `localEmpty && cloudHasProg` (`:47628`) is **dead code**. Control falls to
`localIsFresher` (`:47642`), which keeps the empty local profile, calls `saveProfile()`,
and fire-and-forget `cloudSyncProfile()`s it **up over the real account** (`:47652`).

**Confirmed live on the owner's machine.** Their console during a real session:

```
(index):47653 Cloud fetch skipped: local progression is newer than cloud snapshot.
              Uploading local instead.
```

`:47653` is that branch. This is not theoretical.

### Fix direction (Phase 2/3)
Do **not** simply drop the gems check — `sovereigns`, `itemInventory`, `resources` and
`salvage` below it have the same shape, and a default profile may seed any of them. The
honest predicate is "has this profile ever been *saved by a human action*", not "does it
hold any nonzero number". Options, to be decided:
- a `starterPicked` / first-save sentinel as the sole emptiness test (it is already checked
  at `:47433` and is a genuine human action), or
- compare against the *default* profile object rather than against zero, so the starting
  grant is not mistaken for progress.

⚠ Whatever replaces it, the failure must be **non-destructive**: if the gate is uncertain,
it must pull cloud and never push local. The current code fails the other way.

---

## Finding 2 — whole features never leave the browser

Illegitimate browser storage (per brief §0.2 item 4). None of these appear in the upload
allowlist (`:46791`–`:47174`), so they exist on exactly one machine:

| System | Key | Site |
|---|---|---|
| Camp roster / facilities / workers | `hg_camp` | `:66974` |
| Lab cores | `hg_lab` | `:68595` |
| City shop layouts | `csShopLayout:<shopId>` | `:163739` |
| Market | — | `:55526` |
| Dispatches | — | `:116868` |
| Black-market pass | — | `:186289` |
| **Wallet reconciliation ledger** | `hg_wallet_recon` | `:57714` |
| **Purge owed ledger** | `hg_purge_owed` | `:77541` |
| **Economy owed ledger** | `hg_economy_owed` | `:77576` |

The last three are the serious ones: they are **currency reconciliation state**. Living in
`localStorage` means they are both per-device and player-editable.

Legitimate (leave local, these *should* be per-device): graphics settings, audio volume, UI
layout, camera preferences.

---

## Finding 3 — sync is a hand-maintained allowlist

Cloud sync serialises an explicit field list (`:46791`–`:47174`) rather than the Profile
object. Any new progression field is silently unsynced until someone remembers to add it.
The file already says so, at `:47116`, calling it

> "the FIFTH silent-save bug this project has shipped"

This is the structural cause behind Finding 2, and it will keep producing new instances.
Phase 2 should invert it: serialise by default, with an explicit **deny**-list for
device-local settings.

---

## Finding 4 — 🔴 `user_profiles` has no CREATE TABLE and no RLS policy in the repo

`user_profiles` is the sole progression table. Across `/sql` and the root `.sql` files it
appears **only as `ALTER`s** (`SHARED_WORLD_SETUP.sql:228`, `sql/026_lock_wallet_columns.sql:83`).
There is no `create table`, and no `create policy` anywhere.

Either it was created by hand in the dashboard (likely, given migrations are applied
manually) or RLS is not enabled on it. **CLAUDE.md states RLS is the entire security
boundary.** This must be checked against production before anything else ships.

→ See query 5 below. If it returns `rowsecurity = false`, that is a data breach, not a
todo.

---

## Queries for Seth to run in the Supabase SQL editor

Read-only. Paste results back.

```sql
-- 1. Duplicate humans: same email, multiple accounts
select email, count(*) as accounts, array_agg(id) as uids, array_agg(created_at) as created
from auth.users
where email is not null
group by email having count(*) > 1
order by accounts desc;

-- 2. How much of the userbase is anonymous? (expect 0 — no signInAnonymously in code)
select
  count(*) filter (where is_anonymous) as anon,
  count(*) filter (where not is_anonymous) as permanent,
  count(*) as total
from auth.users;

-- 3. Accounts with more than one linked provider
select u.id, u.email, count(i.id) as identity_count, array_agg(i.provider) as providers
from auth.users u left join auth.identities i on i.user_id = u.id
group by u.id, u.email
order by identity_count asc
limit 50;

-- 4. Anonymous accounts holding real progress (MUST be preserved, never deleted)
select u.id, u.created_at, count(t.*) as rows_owned
from auth.users u join public.user_profiles t on t.user_id = u.id
where u.is_anonymous
group by u.id, u.created_at
having count(t.*) > 0;

-- 5. 🔴 THE IMPORTANT ONE — is RLS actually on the progression table?
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relname in ('user_profiles','profiles')
  and relnamespace = 'public'::regnamespace;

-- 6. …and what policies exist on it
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename in ('user_profiles','profiles');
```

---

## STOP conditions from the brief

- **Anonymous users holding progress:** structurally impossible here — no anonymous auth.
- **>100 duplicate-email accounts:** requires query 1. Cannot be determined from the repo.

---

## Note on the brief's assumptions

`IDENTITY_FIX_BRIEF` assumes Vite + TypeScript (`src/lib/supabase.ts`, `import.meta.env`,
`supabase/migrations/`). None of that maps: this is a plain `<script src>` UMD Supabase load
in a single-page app, with migrations applied by hand as numbered files in `/sql`. The
architecture applies; every code sample needs translating.
