/* ============================================================================
   🎖 INFLUENCE — the server path. Wraps sql/038's three RPCs.
   ============================================================================
   WHY THIS FILE EXISTS. Everything /src/influence pays out used to be decided
   in the browser against a clock the player owns. sql/038 moved the clock, the
   RNG, the level, the standing and every amount onto the server; this is the
   client half of that seam and it deliberately computes NOTHING. It asks, it
   renders what came back, and it applies the non-monetary half locally.

   🔴 THE CLIENT NEVER ADDS CINDER ON THIS PATH. influence_resolve() has already
   credited the canonical wallet (user_progress.cinder, via wallet_credit) by
   the time it returns. Calling addGems() here as well would credit the same
   envoy twice — once server-side for real and once client-side into the mirror
   that later reconciles UP. `balance` in the reply is the post-credit canonical
   figure, and the only correct thing to do with it is raise the local display
   to match.

   🔴 THE THREE THINGS THE CLIENT STILL SUPPLIES, and why none of them pays:
     • card_id     — which card sits at the rarity the SERVER rolled. The custom
                     catalogue is client-held, so the server has no list to
                     check. Safe because the sale price is bounded by the
                     server's stored rarity, not by the card sent.
     • sale_price  — the DVS valuation. CLAMPED server-side to that rarity's
                     band; asking a million for a common pays 500.
     • free_space  — stash headroom. Can only ever make a delivery smaller.

   ⚠ DEGRADES, NEVER THROWS. Signed out, offline, or sql/038 not yet applied →
     every function here returns { ok:false, offline:true } and index.js falls
     back to the local envoy, which can hand out cards and resources but never
     Cinder. See CLAUDE.md: the app must work before the tables exist.
   ============================================================================ */

/* Sticky, because a missing RPC is not a transient error. Once we learn sql/038
   has not been applied there is no point paying a network round trip on every
   single open — the answer will not change until someone runs the file. Reset
   only by a reload, which is exactly when it might have changed. */
let _absent = false;
let _lastError = '';

export function serverKnownAbsent() { return _absent; }
export function lastError() { return _lastError; }

/* A missing function, a missing table, or a schema cache that has not caught up
   yet. PGRST202 is PostgREST's "no such function"; 42883 is Postgres's own. */
function looksAbsent(err) {
  const m = ((err && (err.message || err.code || err.hint)) || '') + '';
  return /PGRST202|PGRST205|42883|42P01|does not exist|schema cache|Could not find the function/i.test(m);
}

function offline(reason) {
  _lastError = reason || '';
  return { ok: false, offline: true, error: reason || 'offline' };
}

async function rpc(b, fn, args) {
  if (_absent) return offline('sql/038 not applied');
  try {
    if (!b || typeof b.rpc !== 'function') return offline('no bridge');
    if (typeof b.signedIn === 'function' && !b.signedIn()) return offline('signed out');
    const r = await b.rpc(fn, args || {});
    if (!r) return offline('no response');
    if (r.error) {
      if (looksAbsent(r.error)) { _absent = true; return offline('sql/038 not applied'); }
      return offline((r.error.message || 'rpc failed') + '');
    }
    const d = r.data;
    if (!d || typeof d !== 'object') return offline('bad payload');
    if (d.ok === false) {
      // A legitimate server answer, not a transport failure — "no envoy yet" is
      // information the modal must show, NOT a reason to fall back to the local
      // path and quietly deal one anyway.
      return Object.assign({ offline: false }, d);
    }
    return Object.assign({ offline: false }, d);
  } catch (e) {
    if (looksAbsent(e)) { _absent = true; return offline('sql/038 not applied'); }
    return offline((e && e.message) || 'threw');
  }
}

/* Read-only. Feeds the CAMP STATUS bar; deals nothing, spends nothing. */
export function peek(b) { return rpc(b, 'influence_peek', {}); }

/* Deals one envoy, or returns the one already dealt. The resume is enforced
   server-side — reopening the modal cannot reroll the rarity table. */
export function claim(b) { return rpc(b, 'influence_claim', {}); }

/* choice: 'take' | 'accept' | 'sell' | 'decline' */
export function resolve(b, choice, opts) {
  opts = opts || {};
  return rpc(b, 'influence_resolve', {
    p_choice: String(choice || ''),
    p_card_id: opts.cardId != null ? String(opts.cardId) : null,
    p_sale_price: Math.max(0, Math.round(Number(opts.salePrice) || 0)),
    /* null means "do not check" — the server then always delivers. Only send a
       real number when we actually know the headroom, so an unknown cap can
       never be read as a full stash and refuse a legitimate convoy. */
    p_free_space: (opts.freeSpace == null || opts.freeSpace === Infinity)
      ? null : Math.max(0, Math.round(Number(opts.freeSpace) || 0)),
  });
}
