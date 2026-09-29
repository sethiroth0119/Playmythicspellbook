# ✉  Welcome Email — Setup

Sends a styled HTML welcome email through **Resend** the moment a player
confirms their signup email. Triggered by a Postgres trigger on
`auth.users`, fired only on the `email_confirmed_at` NULL→not-null
transition (so password changes, sign-ins, and re-confirms don't re-send).

```
auth.users UPDATE
   │
   ▼
_email.handle_new_confirmed_user()    ← DB trigger, idempotent
   │  (inserts row in _email.welcome_emails_sent, ON CONFLICT DO NOTHING)
   ▼
net.http_post(function_url, body, X-Welcome-Secret)
   │
   ▼
welcome_email Edge Function           ← this folder
   │  (verifies shared secret, builds email)
   ▼
Resend REST API (api.resend.com)      ← actual delivery
```

---

## Files in this change

| Path | Purpose |
| --- | --- |
| `supabase/migrations/20260523000000_welcome_email_trigger.sql` | Creates the `_email` schema, config table, idempotency ledger, trigger function, and trigger |
| `supabase/functions/welcome_email/index.ts` | Edge Function — verifies the shared secret, calls Resend |
| `supabase/functions/welcome_email/README.md` | This file |
| `supabase/config.toml` | Add `[functions.welcome_email]` block (see step 3) |

---

## Setup — run these steps in order

### 1. Prerequisites

- A verified **Resend domain** (e.g. `welcome.mythicspellbook.xyz`). Without
  it Resend will refuse to send to anyone but your own account email.
  Setup: https://resend.com/domains → click **Add Domain**, paste in the
  SPF / DKIM / DMARC DNS records it gives you, wait for verification.
- A Resend API key — `re_…` — created at https://resend.com/api-keys with
  the **Sending access** scope.

### 2. Run the SQL migration

Open the Supabase SQL editor (Dashboard → SQL → New query) and paste the
contents of `supabase/migrations/20260523000000_welcome_email_trigger.sql`.
Click **Run**. You should see:

```
CREATE EXTENSION
CREATE SCHEMA
CREATE TABLE
INSERT 0 1
CREATE TABLE
ALTER TABLE
CREATE FUNCTION
DROP TRIGGER
CREATE TRIGGER
CREATE VIEW
```

This creates:
- `_email.config` (1 row, with a placeholder shared secret that you'll rotate next)
- `_email.welcome_emails_sent` (the idempotency ledger)
- `_email.handle_new_confirmed_user()` (the trigger function)
- `on_email_confirmation_send_welcome` (the trigger on `auth.users`)

### 3. Register the function in `config.toml`

Append this block to `supabase/config.toml`:

```toml
[functions.welcome_email]
# Called from the database (pg_net), not from a signed-in user. We gate on
# the X-Welcome-Secret header instead of a JWT.
verify_jwt = false
```

### 4. Deploy the Edge Function

```powershell
cd H:\aiTcgbattler\game-deploy
supabase functions deploy welcome_email --no-verify-jwt
```

(`--no-verify-jwt` is also enforced by the `config.toml` block — both belt
and suspenders.)

### 5. Set the function secrets

Generate a fresh random shared secret first — anything works as long as it
matches the value in `_email.config`:

```powershell
# PowerShell — print a random 48-char base64 secret
[Convert]::ToBase64String((1..36 | ForEach-Object { Get-Random -Maximum 256 }))
```

Then set the three required secrets:

```powershell
supabase secrets set RESEND_API_KEY=re_PASTE_YOUR_RESEND_KEY_HERE
supabase secrets set WELCOME_EMAIL_SECRET=PASTE_THE_BASE64_STRING_FROM_ABOVE
supabase secrets set WELCOME_EMAIL_FROM="Mythic Spellbook <welcome@your-verified-domain.com>"
```

Optional overrides (defaults baked into `index.ts`):

```powershell
supabase secrets set PLAY_URL=https://playmythicspellbook.play-a3d.workers.dev
supabase secrets set MARKETING_URL=https://mythicspellbook.xyz
```

### 6. Sync the same secret into `_email.config`

The SQL migration seeded a random placeholder. Replace it with the **exact
same value** you set as `WELCOME_EMAIL_SECRET`. In the SQL editor:

```sql
update _email.config
   set shared_secret = 'PASTE_THE_SAME_BASE64_STRING_HERE',
       updated_at    = now()
 where id = 1;
```

If the two don't match, the Edge Function returns `403 bad_secret` and
the email never sends.

### 7. Smoke test

Create a brand-new test account in the game (a real email you own, **not**
an alias of an existing account). Click the confirmation link. Within ~3
seconds the welcome email should land. Then:

```sql
-- Did the trigger fire?
select * from _email.welcome_emails_recent limit 5;
```

You should see one row per confirmed user with `status = 'queued'` and a
`response_id`. To check the actual HTTP delivery:

```sql
-- pg_net response log — joined to the queued requests above
select r.id, r.status_code, r.content, q.email
  from net._http_response r
  join _email.welcome_emails_sent q on q.response_id = r.id::text
 order by r.created desc
 limit 5;
```

A `200` here means the Edge Function accepted the post. Look in **Resend →
Logs** for the actual delivery receipt and any bounces.

---

## Operations

### Re-send a welcome email (manual)

If a player tells you they never got the welcome email (spam folder, etc.):

```sql
-- 1) Remove the idempotency row
delete from _email.welcome_emails_sent where email = 'them@example.com';
-- 2) Bump their confirmation back and forward, OR just call the function directly:
select net.http_post(
  url := (select function_url from _email.config),
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'X-Welcome-Secret', (select shared_secret from _email.config)
  ),
  body := jsonb_build_object(
    'user_id', (select id from auth.users where email='them@example.com'),
    'email',   'them@example.com',
    'display_name', 'TheirName'
  )
);
```

### Rotate the shared secret

```powershell
# Generate a new one
$new = [Convert]::ToBase64String((1..36 | ForEach-Object { Get-Random -Maximum 256 }))
$new
supabase secrets set WELCOME_EMAIL_SECRET=$new
```

Then in the SQL editor:

```sql
update _email.config set shared_secret = 'PASTE_NEW_VALUE', updated_at = now() where id = 1;
```

Brief window where the two are out of sync — usually <10s — during which
welcome emails will 403. Schedule rotations during low signup volume.

### Disable the welcome email entirely

```sql
drop trigger if exists on_email_confirmation_send_welcome on auth.users;
```

The Edge Function + migration tables stay; recreating the trigger re-arms
the pipeline. To wipe the whole thing:

```sql
drop trigger if exists on_email_confirmation_send_welcome on auth.users;
drop schema _email cascade;
```

(Edge Function can be torn down with `supabase functions delete welcome_email`.)

---

## Why this design

- **Trigger, not Auth Hook.** Supabase's Auth Hooks intercept the
  confirmation _request_ (good for blocking signups) but don't have a clean
  "after confirmation completed" event. A trigger on `auth.users` runs only
  after the row is committed, which is exactly what we want — we email the
  player only when their account is real and live.
- **pg_net is async.** The `net.http_post` returns immediately with a
  request id; the actual HTTP round-trip happens on a background worker.
  This means a Resend outage or a 5-second cold start on the Edge Function
  **never** blocks `auth.users` writes. Email failures don't block signups.
- **Idempotency ledger.** `_email.welcome_emails_sent.user_id` is the PK.
  The trigger uses `INSERT … ON CONFLICT DO NOTHING` and only fires the
  HTTP post when the insert actually lands. So replays / re-confirms can
  never double-send.
- **Shared secret, not JWT.** The caller is the database — there's no user
  JWT in scope. A long random secret in the `X-Welcome-Secret` header lets
  the Edge Function reject anything that didn't come from our trigger. The
  comparison is constant-time to avoid trivial timing attacks.
- **Security-definer in a private schema.** Per Supabase security guidance,
  `SECURITY DEFINER` functions never live in `public`. `_email` has no Data
  API exposure and explicit `revoke from anon, authenticated`, so even if
  the function gets compromised it can't be invoked by a random REST call.
- **Display name is read from `raw_user_meta_data`.** Safe here because we
  only render it in an HTML email (escaped) — we never use it for any
  authorization decision. The Supabase skill explicitly flags
  `raw_user_meta_data` as user-editable and unsafe for auth logic; we're
  not making auth decisions, just personalising the greeting.

---

## Cost & limits

- Resend free tier: 100 emails/day, 3,000/month. Plenty for early-game
  signups. Above that, $20/mo for 50,000 emails — still pennies per signup.
- pg_net: bundled free with Supabase. Has a default queue cap; if you
  somehow hit it, `SELECT net.flush_response_queue()` clears stale responses.
- Edge Function invocation: free up to 500k/month on the free tier.
