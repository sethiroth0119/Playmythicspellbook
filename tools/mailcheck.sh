#!/usr/bin/env bash
# ── Hidn Studios SMTP check ──────────────────────────────────────────────────
# Proves the Cloudflare Email Sending credentials BEFORE they go into Supabase,
# so a failure is one curl to read instead of a silent dashboard setting.
#
#   export CLOUDFLARE_API_TOKEN=...        # Email Sending : Edit
#   bash tools/mailcheck.sh you@yourrealaddress.com
#
# The token is read from the environment and never written to disk.
set -u

TO="${1:-}"
FROM="${MAIL_FROM:-no-reply@playmythicspellbook.com}"
NAME="${MAIL_FROM_NAME:-Hidn Studios}"

if [ -z "$TO" ]; then
  echo "usage: bash tools/mailcheck.sh <your-own-address>" >&2
  echo "  (use a real inbox you control — bounces from fake addresses hurt sender reputation)" >&2
  exit 2
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set." >&2
  echo "  Cloudflare dashboard -> My Profile -> API Tokens -> Create Token" >&2
  echo "  Custom token, one permission: Email Sending : Edit" >&2
  exit 2
fi

MAIL="$(mktemp)"
trap 'rm -f "$MAIL"' EXIT
cat > "$MAIL" <<EOF
From: $NAME <$FROM>
To: $TO
Subject: $NAME SMTP test
Content-Type: text/plain; charset=utf-8

If this arrived and the sender reads "$NAME", the credentials work.

Next: Supabase -> Authentication -> Emails -> SMTP Settings
  Host      smtp.mx.cloudflare.net
  Port      465          (implicit TLS, NOT 587/STARTTLS)
  Username  api_token
  Password  this same Cloudflare API token
  Sender    $FROM
  Name      $NAME
EOF

echo "sending  $FROM  ->  $TO"
if curl --ssl-reqd --silent --show-error --fail \
     --url "smtps://smtp.mx.cloudflare.net:465" \
     --user "api_token:$CLOUDFLARE_API_TOKEN" \
     --mail-from "$FROM" \
     --mail-rcpt "$TO" \
     --upload-file "$MAIL"; then
  echo "OK — accepted by Cloudflare. Check the inbox (and spam) for the sender name."
else
  code=$?
  echo "FAILED (curl exit $code)." >&2
  case $code in
    67) echo "  67 = auth rejected. The username must be the literal string 'api_token'," >&2
        echo "       and the password a token with Email Sending : Edit." >&2;;
    55|56) echo "  Transport error — retry; if it persists check port 465 is not blocked." >&2;;
    *)  echo "  A 5xx from the server usually means the From domain is not onboarded" >&2
        echo "  for Email Sending on the account that owns this token." >&2;;
  esac
  exit 1
fi
