// ============================================================================
// 🌐 cors.ts — shared CORS headers for browser-invoked Edge Functions.
// Allows the deployed game (any origin — Cloudflare Worker, localhost dev)
// to call /functions/v1/* with the user's JWT.
// ============================================================================
export const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Preflight handler — returns 204 with CORS headers for OPTIONS requests.
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

// Standard JSON response with CORS headers attached.
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
