/* ═══════════════════════════════════════════════════════════════════════════
   push.js — Web Push sender for the Cloudflare Worker.

   This is what makes a notification reach a CLOSED app. The realtime notifier
   (v120h0) only fires while a tab or its service worker is alive; this pushes
   through the browser vendor's push service instead.

   Two pieces of cryptography, both done with WebCrypto (no dependencies):

     1. VAPID (RFC 8292) — an ES256 JWT proving WE are the app server. Signed
        with the VAPID private key, which lives ONLY in a Worker secret.

     2. PAYLOAD ENCRYPTION (RFC 8291, aes128gcm) — the push service must never
        be able to read the message. We ECDH against the subscription's own
        public key, derive a content key, and AES-GCM the body.

   ⚠ WHY THE PAYLOAD IS ENCRYPTED AT ALL rather than sending an empty "tickle"
     and having the service worker fetch the content: a tickle cannot carry the
     community name, and a notification that says only "new activity" is
     useless to someone in four communities. The name has to survive to the
     lock screen, so it has to be in the payload, so the payload has to be
     encrypted properly.
   ═══════════════════════════════════════════════════════════════════════════ */

const enc = new TextEncoder();

/* ── base64url ───────────────────────────────────────────────────────────── */
function b64uToBytes(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(b) {
  let s = '';
  const a = new Uint8Array(b);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/* ── VAPID: an ES256 JWT for the push service's origin ───────────────────── */
async function vapidHeaders(endpoint, publicKeyB64u, privateKeyB64u, subject) {
  const aud = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const body = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,   // 12h; spec caps at 24
    sub: subject || 'mailto:admin@mythicspellbook.xyz',
  };
  const signingInput = bytesToB64u(enc.encode(JSON.stringify(header))) + '.' +
                       bytesToB64u(enc.encode(JSON.stringify(body)));

  // The private key is a raw 32-byte scalar; WebCrypto wants a JWK, and the
  // JWK needs the matching public coordinates or import fails.
  const pub = b64uToBytes(publicKeyB64u);          // 0x04 || X(32) || Y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: bytesToB64u(b64uToBytes(privateKeyB64u)),
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));

  return {
    Authorization: 'vapid t=' + signingInput + '.' + bytesToB64u(sig) + ', k=' + publicKeyB64u,
  };
}

/* ── HKDF ────────────────────────────────────────────────────────────────── */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/* ── RFC 8291 aes128gcm body ─────────────────────────────────────────────── */
async function encryptPayload(plaintext, p256dhB64u, authB64u) {
  const uaPublic = b64uToBytes(p256dhB64u);        // subscriber's public key
  const authSecret = b64uToBytes(authB64u);

  // Ephemeral sender keypair, fresh per message (required — reusing it leaks).
  const asKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));

  const uaKey = await crypto.subtle.importKey('raw', uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  // PRK from the auth secret, per the spec's key-combining step.
  const authInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, authInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 is the final-record delimiter; without it Chrome rejects the body.
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, padded));

  // header = salt(16) | rs(4, big-endian) | idlen(1) | as_public(65)
  const rs = new Uint8Array([0, 0, 16, 0]);        // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/* ── send one ────────────────────────────────────────────────────────────── */
export async function sendPush(sub, payloadObj, env) {
  const payload = JSON.stringify(payloadObj);
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  const headers = await vapidHeaders(sub.endpoint, env.VAPID_PUBLIC, env.VAPID_PRIVATE, env.VAPID_SUBJECT);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  // 404/410 mean the browser threw the subscription away — the caller should
  // mark it expired rather than retrying it forever.
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

/* ── the endpoint ────────────────────────────────────────────────────────────
   POST /api/push/send
     headers: x-push-secret: <PUSH_SEND_SECRET>
     body: { user_ids: [uuid], title, body, url?, tag?, source? }

   ⚠ The shared secret is the whole access control. Without it anyone could
     push arbitrary text to every player's lock screen — which is worse than a
     spam channel, it is a phishing channel wearing your game's icon.
   ───────────────────────────────────────────────────────────────────────── */
export async function handlePushSend(request, env) {
  const json = (o, s) => new Response(JSON.stringify(o), {
    status: s || 200, headers: { 'content-type': 'application/json' },
  });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!env.VAPID_PRIVATE || !env.VAPID_PUBLIC) return json({ error: 'push not configured' }, 503);
  if (!env.PUSH_SEND_SECRET || request.headers.get('x-push-secret') !== env.PUSH_SEND_SECRET) {
    return json({ error: 'forbidden' }, 403);
  }
  if (!env.SB_SERVICE_KEY) return json({ error: 'no service key' }, 503);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const ids = Array.isArray(b.user_ids) ? b.user_ids.filter(Boolean).slice(0, 500) : [];
  if (!ids.length || !b.title) return json({ error: 'user_ids and title required' }, 400);

  // Read subscriptions with the SERVICE role. These rows are owner-only under
  // RLS by design, so this is the one place allowed to see them.
  const q = env.SB_URL + '/rest/v1/push_subscriptions'
    + '?select=id,user_id,endpoint,p256dh,auth'
    + '&expired_at=is.null&user_id=in.(' + ids.join(',') + ')';
  const subRes = await fetch(q, {
    headers: { apikey: env.SB_SERVICE_KEY, Authorization: 'Bearer ' + env.SB_SERVICE_KEY },
  });
  if (!subRes.ok) return json({ error: 'subscription read failed', status: subRes.status }, 502);
  const subs = await subRes.json();
  if (!subs.length) return json({ ok: true, sent: 0, note: 'nobody subscribed' });

  const payload = {
    title: b.title,
    body: b.body || '',
    url: b.url || '/',
    tag: b.tag || 'mythic',
    source: b.source || '',
  };

  let sent = 0, gone = [];
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await sendPush(s, payload, env);
      if (r.ok) sent++;
      else if (r.gone) gone.push(s.id);
    } catch (e) { /* one bad endpoint must not fail the batch */ }
  }));

  // Retire dead endpoints so they are not retried forever.
  if (gone.length) {
    try {
      await fetch(env.SB_URL + '/rest/v1/push_subscriptions?id=in.(' + gone.join(',') + ')', {
        method: 'PATCH',
        headers: {
          apikey: env.SB_SERVICE_KEY, Authorization: 'Bearer ' + env.SB_SERVICE_KEY,
          'content-type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify({ expired_at: new Date().toISOString() }),
      });
    } catch (e) {}
  }
  return json({ ok: true, sent, expired: gone.length, targets: subs.length });
}
