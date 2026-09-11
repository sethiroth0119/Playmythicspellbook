# Making password-reset mail come from Hidn Studios

The game side is done in code (v121v61). The *sender name* cannot be — it lives in
Supabase project settings. Out of the box Supabase sends from
`noreply@mail.app.supabase.io`, which cannot be renamed, is rate-limited to a
handful of mails per hour, and lands in spam. Both problems are fixed by the same
step: point Supabase Auth at your own SMTP.

## 1 · Onboard a domain to Cloudflare Email Sending

Cloudflare (where the game already lives) now offers authenticated SMTP, so no
third-party mail vendor is needed.

Dashboard → **Compute & AI → Email Service → Email Sending → Onboard Domain**
→ pick `playmythicspellbook.com` → **Add records and onboard**.
That writes the SPF and DKIM DNS records itself. Give it 5–15 minutes.

## 2 · Make an API token for SMTP

Dashboard → **My Profile → API Tokens → Create Token → Custom token**
Permission: **Email Sending : Edit**. Copy the token once; it is the SMTP password.

## 3 · Point Supabase at it

Supabase → project `ktsiasyjusesawtrwrjc` → **Authentication → Emails → SMTP Settings**
→ **Enable Custom SMTP**:

| Field | Value |
|---|---|
| Host | `smtp.mx.cloudflare.net` |
| Port | `465` (implicit TLS / SMTPS — **not** 587/STARTTLS) |
| Username | the literal string `api_token` |
| Password | the Cloudflare API token from step 2 |
| Sender email | `no-reply@playmythicspellbook.com` |
| **Sender name** | **Hidn Studios** ← this is the line the player sees |

Sender email must be on the domain onboarded in step 1, on the same Cloudflare
account that owns the token.

## 4 · Let the link land back in the game

**Authentication → URL Configuration**

- Site URL: `https://playmythicspellbook.com`
- Redirect URLs — add both:
  - `https://playmythicspellbook.com/?recover=1`
  - `https://playmythicspellbook.com/*`

The game now sends an explicit `redirectTo` of `…/?recover=1`. If that URL is not
on the allow-list Supabase **silently ignores it** and uses the Site URL instead,
so this step is not optional.

## 5 · Reword the template (optional but worth it)

**Authentication → Emails → Templates → Reset Password**. The default says
"Supabase". Replace the body with Hidn Studios wording; keep `{{ .ConfirmationURL }}`
exactly as-is — that is the link.

## 6 · Check it

Sign-in screen → **Forgot password?** → your own address. The mail should arrive
from **Hidn Studios**, and clicking it should drop you back in the game on the
"Choose a new password" step.
