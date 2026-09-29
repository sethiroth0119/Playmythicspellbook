// ============================================================================
// ✉  welcome_email — post-confirmation welcome email via Resend
// ----------------------------------------------------------------------------
// Trigger source:
//   Postgres trigger _email.handle_new_confirmed_user on auth.users.
//   The trigger fires only when email_confirmed_at flips NULL → not-null and
//   posts here with a shared secret in the X-Welcome-Secret header.
//
// This function is NOT user-callable. `verify_jwt = false` in config.toml
// because the caller is the database (not a logged-in user), and we gate on
// the shared secret instead. Treat the secret like a service-role key.
//
// Env vars (set with `supabase secrets set`):
//   RESEND_API_KEY         — Resend "re_..." API key (REQUIRED)
//   WELCOME_EMAIL_SECRET   — same value stored in _email.config.shared_secret
//   WELCOME_EMAIL_FROM     — verified sender, e.g. "Mythic Spellbook <welcome@yourdomain.com>"
//   PLAY_URL               — optional override; defaults to the prod worker URL
//   MARKETING_URL          — optional override; defaults to mythicspellbook.xyz
//
// Body schema (POST):
//   { user_id: string, email: string, display_name: string, confirmed_at: string }
// ============================================================================

import { corsHeaders, handlePreflight, jsonResponse } from '../_shared/cors.ts';

const RESEND_URL = 'https://api.resend.com/emails';

// Safe HTML-escape — used in the templated greeting so an attacker who managed
// to register with an XSS payload in their display name can't render arbitrary
// HTML in the player's inbox (most clients sanitize anyway, but defense in
// depth is cheap here).
function esc(s: string): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Constant-time string compare so the shared-secret check can't be timing-
// attacked. Falls back to a length-aware sentinel if lengths differ.
function safeEq(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function buildEmail(opts: {
  displayName: string;
  email: string;
  playUrl: string;
  marketingUrl: string;
}): { html: string; text: string; subject: string } {
  const { displayName, email, playUrl, marketingUrl } = opts;
  const subject = `Welcome to Mythic Spellbook, ${displayName}! 🔥`;

  // Inline styles only — most email clients ignore <style> blocks.
  // Width capped at 600px (the de-facto safe ceiling for Gmail / Outlook).
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#1a0f1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffe6b0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1a0f1f;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:linear-gradient(180deg,#251733 0%,#15091f 100%);border:1px solid rgba(212,175,55,0.45);border-radius:14px;overflow:hidden">

        <!-- ── Header ─────────────────────────────────────────── -->
        <tr><td style="padding:36px 32px 16px 32px;text-align:center">
          <div style="font-family:'Cinzel','Times New Roman',serif;font-size:30px;font-weight:800;color:#ffcf5a;letter-spacing:0.08em;line-height:1.2">
            🔥 MYTHIC SPELLBOOK
          </div>
          <div style="margin-top:6px;font-size:13px;color:#b59a66;letter-spacing:0.18em;text-transform:uppercase">
            Your account is live
          </div>
        </td></tr>

        <!-- ── Greeting ────────────────────────────────────────── -->
        <tr><td style="padding:8px 32px 0 32px">
          <h1 style="margin:14px 0 6px 0;font-family:'Cinzel','Times New Roman',serif;font-size:26px;font-weight:700;color:#ffe6b0;line-height:1.3">
            Welcome to Mythic Spellbook, ${esc(displayName)}!
          </h1>
          <p style="margin:6px 0 18px 0;font-size:15px;line-height:1.65;color:#d8c8a6">
            Your email is confirmed and your account is ready. We're glad you're here.
          </p>
        </td></tr>

        <!-- ── Account reminder (the headline anti-support-ticket card) ── -->
        <tr><td style="padding:0 32px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.45);border-radius:10px">
            <tr><td style="padding:18px 20px">
              <div style="font-size:11px;color:#ffcf5a;letter-spacing:0.18em;text-transform:uppercase;font-weight:700">
                Save this email
              </div>
              <div style="margin-top:6px;font-size:14px;line-height:1.55;color:#ffe6b0">
                You signed up with:
              </div>
              <div style="margin-top:4px;font-size:18px;font-weight:700;color:#ffcf5a;letter-spacing:0.02em;font-family:'Courier New',monospace">
                ${esc(email)}
              </div>
              <div style="margin-top:10px;font-size:13px;line-height:1.55;color:#b59a66">
                If you ever forget your password, use this email on the
                <strong style="color:#ffe6b0">Forgot Password</strong> page —
                a reset link is sent here every time.
              </div>
            </td></tr>
          </table>
        </td></tr>

        <!-- ── Primary CTA ─────────────────────────────────────── -->
        <tr><td style="padding:24px 32px 0 32px;text-align:center">
          <a href="${esc(playUrl)}" target="_blank" rel="noopener"
             style="display:inline-block;padding:14px 36px;background:linear-gradient(180deg,#f5d76e 0%,#d4af37 50%,#a87b2d 100%);color:#1a0f1f;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.08em;text-transform:uppercase;border-radius:8px;border:1px solid #d4af37">
            ▶ Play Now
          </a>
          <div style="margin-top:10px;font-size:12px;color:#b59a66">
            Opens the game in a new tab
          </div>
        </td></tr>

        <!-- ── 3 Quickstart tips ───────────────────────────────── -->
        <tr><td style="padding:30px 32px 0 32px">
          <div style="font-family:'Cinzel','Times New Roman',serif;font-size:14px;color:#ffcf5a;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;border-bottom:1px solid rgba(212,175,55,0.3);padding-bottom:8px;margin-bottom:16px">
            Your first three steps
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 0 14px 0">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top" style="width:40px;font-size:22px;color:#ffcf5a">①</td>
                  <td valign="top" style="font-size:14px;line-height:1.55;color:#e0d2b3">
                    <strong style="color:#ffe6b0">Pick your starter deck.</strong>
                    On first sign-in the deck-picker pops up — choose the playstyle that calls you.
                    You can swap heroes any time in the Deck Builder.
                  </td>
                </tr>
              </table>
            </td></tr>
            <tr><td style="padding:0 0 14px 0">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top" style="width:40px;font-size:22px;color:#ffcf5a">②</td>
                  <td valign="top" style="font-size:14px;line-height:1.55;color:#e0d2b3">
                    <strong style="color:#ffe6b0">Visit Camp Heights.</strong>
                    Your home base — survivors, stash, hero rest beds, the Forge, and the Resource Traders all live here.
                  </td>
                </tr>
              </table>
            </td></tr>
            <tr><td style="padding:0 0 4px 0">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top" style="width:40px;font-size:22px;color:#ffcf5a">③</td>
                  <td valign="top" style="font-size:14px;line-height:1.55;color:#e0d2b3">
                    <strong style="color:#ffe6b0">Press Play Online when you're ready.</strong>
                    Queue against a real player. Earn Cinder + climb the ranked ladder.
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- ── Secondary link ──────────────────────────────────── -->
        <tr><td style="padding:24px 32px 8px 32px;text-align:center">
          <a href="${esc(marketingUrl)}" target="_blank" rel="noopener"
             style="display:inline-block;color:#9bd6ff;font-size:14px;text-decoration:underline">
            Visit the marketing site →
          </a>
        </td></tr>

        <!-- ── Footer ──────────────────────────────────────────── -->
        <tr><td style="padding:24px 32px 32px 32px;border-top:1px solid rgba(212,175,55,0.18);margin-top:18px">
          <div style="font-size:11px;line-height:1.6;color:#7a6647;text-align:center">
            You're receiving this because you confirmed the email
            <strong style="color:#b59a66">${esc(email)}</strong>
            for Mythic Spellbook.
            <br><br>
            If this wasn't you, reply to this email and we'll investigate.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Plain-text fallback (every email client may show it; some clients render
  // it preferentially in low-bandwidth previews). Mirrors the HTML content.
  const text = [
    `Welcome to Mythic Spellbook, ${displayName}!`,
    ``,
    `Your account is live. You signed up with:`,
    `  ${email}`,
    ``,
    `If you ever forget your password, use this email on the Forgot Password`,
    `page — a reset link is sent here every time.`,
    ``,
    `▶ Play now:  ${playUrl}`,
    ``,
    `Your first three steps:`,
    `  1. Pick your starter deck.`,
    `  2. Visit Camp Heights — survivors, stash, hero rest beds, the Forge,`,
    `     and the Resource Traders all live here.`,
    `  3. Press Play Online when you're ready.`,
    ``,
    `Marketing site: ${marketingUrl}`,
    ``,
    `If this wasn't you, reply to this email and we'll investigate.`,
  ].join('\n');

  return { html, text, subject };
}

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);
  }

  // ── 1. Auth — shared-secret check (constant-time) ────────────────────────
  const incomingSecret = req.headers.get('x-welcome-secret') ?? '';
  const expectedSecret = Deno.env.get('WELCOME_EMAIL_SECRET') ?? '';
  if (!expectedSecret) {
    // Misconfigured deploy — fail loud so the operator sees it in logs.
    return jsonResponse({ ok: false, reason: 'server_missing_secret' }, 500);
  }
  if (!safeEq(incomingSecret, expectedSecret)) {
    return jsonResponse({ ok: false, reason: 'bad_secret' }, 403);
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: { user_id?: string; email?: string; display_name?: string; confirmed_at?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, reason: 'bad_json' }, 400);
  }
  const email = String(body.email ?? '').trim();
  const displayName = String(body.display_name ?? '').trim() || (email.split('@')[0] || 'Survivor');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonResponse({ ok: false, reason: 'bad_email' }, 400);
  }

  // ── 3. Env config ────────────────────────────────────────────────────────
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const fromAddr  = Deno.env.get('WELCOME_EMAIL_FROM') ?? '';
  const playUrl   = Deno.env.get('PLAY_URL')      ?? 'https://playmythicspellbook.play-a3d.workers.dev';
  const marketingUrl = Deno.env.get('MARKETING_URL') ?? 'https://mythicspellbook.xyz';
  if (!resendKey || !fromAddr) {
    return jsonResponse({ ok: false, reason: 'server_missing_env',
      hint: 'Set RESEND_API_KEY and WELCOME_EMAIL_FROM with `supabase secrets set …`.' }, 500);
  }

  // ── 4. Build + send the email via Resend ─────────────────────────────────
  const { html, text, subject } = buildEmail({ displayName, email, playUrl, marketingUrl });

  try {
    const resp = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    fromAddr,
        to:      [email],
        subject,
        html,
        text,
        // Resend supports tags for analytics; tag the welcome flow so dashboard
        // filters are clean.
        tags: [
          { name: 'category', value: 'welcome' },
          { name: 'flow',     value: 'post-confirmation' },
        ],
      }),
    });

    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Surface the Resend error verbatim so the operator can see what failed
      // (domain not verified, key revoked, etc.). The trigger has already
      // recorded the queued attempt in _email.welcome_emails_sent.
      return jsonResponse({
        ok: false,
        reason: 'resend_error',
        status: resp.status,
        detail: (j && (j.error?.message ?? j.message)) || `HTTP ${resp.status}`,
      }, 502);
    }
    return jsonResponse({ ok: true, message_id: j?.id ?? null });
  } catch (e) {
    return jsonResponse({
      ok: false,
      reason: 'fetch_failed',
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 240),
    }, 502);
  }
});
