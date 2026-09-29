// ============================================================================
// 🔄 mp_end_turn — server-authoritative turn sequencer.
// ----------------------------------------------------------------------------
// The client calls this when the local player presses END TURN. The Edge
// Function invokes the SECURITY DEFINER RPC mp_end_turn which:
//   • verifies the caller currently holds the turn
//   • verifies the turn_number matches (catches dupe-send / re-entrancy)
//   • atomically flips current_player_id to the opponent
//   • increments turn_number
//   • optionally stores the post-DoT state snapshot
//   • if the snapshot shows end-of-turn DoT killed a hero, also closes the
//     match by setting winner_id atomically (same transaction)
// Returns: { ok, currentPlayerId, turnNumber, winnerId, reason }
//
// Body schema:
//   {
//     matchId: string,
//     expectedTurn: number,           // turn the client THINKS it's ending
//     stateSnapshot?: object,         // small post-DoT state diff (optional)
//     gameoverWinner?: string|null,   // uuid if end-of-turn DoT killed someone
//   }
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders, handlePreflight, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, reason: 'missing_auth' }, 401);
  }

  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, reason: 'bad_json' }, 400); }

  const matchId        = String(body?.matchId ?? '').trim();
  const expectedTurn   = Math.max(1, Math.floor(Number(body?.expectedTurn ?? 0)));
  const stateSnapshot  = (body?.stateSnapshot && typeof body.stateSnapshot === 'object')
                         ? body.stateSnapshot : null;
  const gameoverWinner = (typeof body?.gameoverWinner === 'string' && body.gameoverWinner.trim())
                         ? body.gameoverWinner.trim() : null;

  if (!matchId || !expectedTurn) {
    return jsonResponse({ ok: false, reason: 'bad_input' }, 400);
  }

  // 🛡️ Cap snapshot payload size — without a guard, a runaway state JSON
  // could blow past Postgres' 1MB statement limit (the bug that caused the
  // 115MB cloud-upload incident). 64KB is plenty for a turn-end delta.
  let snapshotForRpc = stateSnapshot;
  if (snapshotForRpc) {
    try {
      const json = JSON.stringify(snapshotForRpc);
      if (json.length > 65536) snapshotForRpc = null;
    } catch { snapshotForRpc = null; }
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await supabase.rpc('mp_end_turn', {
    p_match_id:        matchId,
    p_expected_turn:   expectedTurn,
    p_state_snapshot:  snapshotForRpc,
    p_gameover_winner: gameoverWinner,
  });

  if (error) {
    return jsonResponse({ ok: false, reason: 'rpc_error', detail: error.message }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return jsonResponse({ ok: false, reason: 'empty_result' }, 500);
  }

  return jsonResponse({
    ok:               !!row.ok,
    currentPlayerId:  row.current_player_id ?? null,
    turnNumber:       row.turn_number ?? 0,
    winnerId:         row.winner_id ?? null,
    reason:           row.reason ?? '',
  });
});
