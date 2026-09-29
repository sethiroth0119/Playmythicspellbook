// ============================================================================
// 🛡️ mp_resolve_match — server-authoritative winner_id arbitration.
// ----------------------------------------------------------------------------
// Replaces the client-side "UPDATE matches SET winner_id=… WHERE winner_id IS
// NULL" call. The Edge Function calls the SECURITY DEFINER RPC mp_resolve_match
// with the user's JWT, so auth.uid() inside the RPC is the real signed-in
// caller. The RPC enforces:
//   • caller is a match participant
//   • claimed winner is a match participant
//   • atomic conditional update on winner_id (race-safe)
// Returns: { ok, winnerId, weWonRace, reason }
//
// Body schema:
//   { matchId: string, winnerId: string, turns?: number, endReason?: string }
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders, handlePreflight, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  // 🌐 CORS preflight — browser fires OPTIONS before the POST.
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);
  }

  // 🔑 Auth — every request must carry an Authorization: Bearer <jwt> header,
  // which Supabase already validates BEFORE the function runs (verify_jwt=true
  // is the default for deployed functions). The supabase-js client below
  // forwards the same header so RLS / auth.uid() resolve to the real user.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, reason: 'missing_auth' }, 401);
  }

  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, reason: 'bad_json' }, 400); }

  const matchId   = String(body?.matchId   ?? '').trim();
  const winnerId  = String(body?.winnerId  ?? '').trim();
  const turns     = Math.max(0, Math.floor(Number(body?.turns ?? 0)));
  const endReason = typeof body?.endReason === 'string' ? body.endReason.slice(0, 32) : 'normal';

  if (!matchId || !winnerId) {
    return jsonResponse({ ok: false, reason: 'bad_input' }, 400);
  }

  // Forward the caller's JWT into supabase-js so the RPC's auth.uid() matches
  // the signed-in user. NOT the service role — that would bypass the
  // participant check inside the RPC.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await supabase.rpc('mp_resolve_match', {
    p_match_id:   matchId,
    p_winner_id:  winnerId,
    p_turns:      turns,
    p_end_reason: endReason,
  });

  if (error) {
    // Surface the SQL error name so the client can decide whether to retry.
    return jsonResponse({ ok: false, reason: 'rpc_error', detail: error.message }, 500);
  }

  // RPC returns a setof row — supabase-js unwraps to an array. Take row 0.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return jsonResponse({ ok: false, reason: 'empty_result' }, 500);
  }

  return jsonResponse({
    ok:         !!row.ok,
    winnerId:   row.winner_id ?? null,
    weWonRace:  !!row.we_won_race,
    reason:     row.reason ?? '',
  });
});
