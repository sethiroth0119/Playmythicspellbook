/* ============================================================================
   🛣 OUTSIDE CONNECTIONS — the published status record.
   ============================================================================
   node-city and the main app are two different documents. The connection test
   can only run where the city's tiles live (inside node-city/index.html), but
   the gate has to be readable from the Resource Exchange in public/index.html.
   This file is the seam: a tiny, dependency-free record in localStorage that
   node-city WRITES and anything else READS.

   🔴 THREE RULES, and they are what keep this from becoming a foot-gun.

   1. ABSENT MEANS ALLOWED. A player who has never opened Node City has no
      record. That is not "disconnected", it is "unknown", and unknown never
      refuses anything. Same for a malformed record, a disabled localStorage,
      or a browser in private mode — every failure path below returns
      `{ known:false }`.

   2. STALE MEANS ALLOWED. A record older than GATE.statusStaleMs is ignored.
      Without that rule, one visit to a half-built city would lock a player out
      of the market forever, on a device they might never bring the city back
      up on.

   3. AN EMPTY CITY IS NOT A CUT-OFF CITY. `tiles` rides the record and the gate
      requires tiles > 0, so opening Node City, looking at it and closing it
      again cannot cost anyone a trade.

   ⚠ NOT a security boundary and never pretend otherwise — it is localStorage,
     the player owns it. It is a UX gate that tells a player why their city
     cannot trade, in the same spirit as the road-capacity refusal. The real
     ledger rules still live behind RLS on the server.
   ============================================================================ */

import { GATE } from './tuning.js';

const KEY = GATE.statusKey;

/** Write the current state. Called by index.js whenever the cached link state
    is recomputed; cheap enough to be unconditional, and deliberately not
    debounced so the record can never lag the city the player is looking at. */
export function publish(rec) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(KEY, JSON.stringify({
      v: 1,
      at: Date.now(),
      connected: !!(rec && rec.connected),
      // A count, not a list — nothing downstream needs the tiles themselves.
      tiles: Math.max(0, (rec && rec.tiles) | 0),
      via: (rec && rec.via) || null,
      reason: String((rec && rec.reason) || ''),
      fix: String((rec && rec.fix) || ''),
    }));
    return true;
  } catch (e) { return false; }
}

/** Read it back. Never throws, never returns undefined.
    → { known, connected, tiles, via, reason, fix, ageMs } */
export function read() {
  const unknown = { known: false, connected: true, tiles: 0, via: null, reason: '', fix: '', ageMs: Infinity };
  try {
    if (typeof localStorage === 'undefined') return unknown;
    const raw = localStorage.getItem(KEY);
    if (!raw) return unknown;
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return unknown;
    const age = Date.now() - (+j.at || 0);
    if (!(age >= 0) || age > GATE.statusStaleMs) return unknown;   // rule 2 (and NaN)
    return { known: true, connected: !!j.connected, tiles: j.tiles | 0,
             via: j.via || null, reason: String(j.reason || ''), fix: String(j.fix || ''), ageMs: age };
  } catch (e) { return unknown; }
}

/** THE ONE QUESTION CALLERS ASK: may this player start a new cross-city deal?
    → { ok:true } | { ok:false, code, why }
    Refuses only on a fresh, explicit, non-empty "disconnected". Everything else
    — unknown, stale, empty, corrupt — is `ok:true`. */
export function allowTrade() {
  const s = read();
  if (!s.known || s.connected || s.tiles <= 0) return { ok: true, code: 'OK', why: '' };
  return {
    ok: false, code: 'NO_OUTSIDE_LINK',
    why: '🛣 Your city has no outside connection, so nothing can leave it. '
       + (s.reason ? s.reason + ' ' : '')
       + (s.fix || 'Open Node City and build a Highway Interchange on the north edge, then run road from it into your city.'),
  };
}

export default { publish, read, allowTrade, KEY };
