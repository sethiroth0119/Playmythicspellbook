// ============================================================================
// 🔐 Supabase JWT verification — the only way a client can join a room.
// ----------------------------------------------------------------------------
// Client sends its Supabase access_token in the room.join options. We verify
// it against Supabase's published JWKS (rotated keys, no shared-secret to
// leak server-side). On success we attach { userId, email } to the client
// for downstream use; on failure we reject the join.
//
// Supabase JWT shape (relevant claims):
//   { sub: <userId UUID>, email: <email>, aud: 'authenticated',
//     role: 'authenticated', exp: <unix>, iat: <unix>, ... }
// ============================================================================

import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

export interface AuthResult {
  userId: string;
  email: string | null;
  role: string;
  raw: JWTPayload;
}

// JWKS endpoint follows Supabase's public schema.
function jwksUrl(supabaseUrl: string): URL {
  return new URL('/auth/v1/.well-known/jwks.json', supabaseUrl);
}

// Memoize the JWKS set — jose caches keys + handles rotation internally.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks) return _jwks;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL env var is not set — auth bridge cannot verify tokens.');
  }
  _jwks = createRemoteJWKSet(jwksUrl(supabaseUrl), {
    // Defaults: ~5 minutes between key refreshes is fine for us.
  });
  return _jwks;
}

/**
 * Verify a Supabase JWT. Throws if invalid/expired/wrong-audience.
 * Returns the userId + email for the authenticated player.
 */
export async function verifySupabaseToken(token: string): Promise<AuthResult> {
  if (!token || typeof token !== 'string') {
    throw new Error('No auth token provided.');
  }
  const audience = process.env.SUPABASE_JWT_AUDIENCE || 'authenticated';
  const jwks = getJwks();
  const { payload } = await jwtVerify(token, jwks, {
    audience,
    // issuer is the Supabase URL by default; we don't enforce it strictly so
    // self-hosted Supabase deployments still work without env tuning.
  });
  const userId = String(payload.sub || '');
  if (!userId) throw new Error('JWT missing sub claim — invalid user.');
  return {
    userId,
    email:  (payload as any).email || null,
    role:   String(payload.role || 'authenticated'),
    raw:    payload,
  };
}

// 🩹 Optional: skip verification for local dev. NEVER true in production.
// Toggled by setting AUTH_DEV_BYPASS=true on the env. Useful when running
// the server locally + a client that hasn't been wired to forward tokens yet.
export function isDevAuthBypass(): boolean {
  return process.env.AUTH_DEV_BYPASS === 'true';
}
