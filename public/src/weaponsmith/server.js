/* ═══════════════════════════════════════════════════════════════════════════
   ☁ SERVER — the authoritative half.

   sql/040_weaponsmith.sql is the record for three things the client may not
   decide for itself:
     · crafted weapon STATS  — because crafted weapons are sellable, and a
       client-computed stat block on a sellable item is a forged stat block
     · blueprint ENTITLEMENTS — because one of them is bought with real money
     · REPUTATION            — because it gates content

   ⚠ EVERY FUNCTION HERE MUST DEGRADE. CLAUDE.md: the app has to work offline
     and before the tables exist. So each returns null on any failure and the
     caller falls back to the local path — which mints with `local: true` and
     is therefore never tradeable. Nothing here may throw.
   ═══════════════════════════════════════════════════════════════════════════ */

import { rpc, signedIn } from './ws.bridge.js';
import { ensureWeaponSmith, wsSave } from './state.js';

/* True when there is any point trying. Not a guarantee the tables exist — that
   is what the null returns below are for. */
export function online() { return signedIn(); }

/* Unwrap a supabase rpc result into the payload, or null. The RPCs all answer
   { ok:false, error } rather than throwing, so a transport error and a refusal
   both land here and both mean "fall back". */
function payload(r) {
  try {
    if (!r || r.error || !r.data) return null;
    const d = r.data;
    return (d && d.ok) ? d : null;
  } catch (e) { return null; }
}

/* Refill the client's mirror. The rep / contracts / blueprints fields on
   Profile.weaponSmith are a CACHE and this is the only thing that writes them.
   ⚠ A failed sync must leave the mirror ALONE rather than blanking it. A
     blanked mirror reads to the player as "my reputation was reset", which is
     a far worse lie than a slightly stale number. */
export async function syncState() {
  if (!online()) return null;
  const d = payload(await rpc('ws_state', {}));
  if (!d) return null;

  const s = ensureWeaponSmith();
  s.rep = d.rep | 0;
  s.slots = d.slots | 0 || 1;
  if (Array.isArray(d.claimable)) s.claimable = d.claimable;
  s.repQuality = d.repQuality | 0;
  s.repSpeed = d.repSpeed | 0;
  s.repSpec = d.repSpec | 0;
  s.repSyncedAt = Date.now();
  if (Array.isArray(d.contracts)) { s.contracts = d.contracts; s.contractsSyncedAt = Date.now(); }
  if (Array.isArray(d.blueprints)) { s.blueprints = d.blueprints; s.blueprintsSyncedAt = Date.now(); }
  wsSave();
  return d;
}

/* Mint server-side. Posts WHAT THE BENCH DID — blueprint, part ids, the build
   quality, the allocation — and the server recomputes the stats and clamps to
   the blueprint budget.

   🔴 THE CLIENT'S STAT BLOCK IS NOT A PARAMETER. There is deliberately nothing
      here to send it in, so there is nothing for a tampered client to lie
      about. What comes back is what the weapon IS.

   ⚠ The part ids ARE sent, and that is not a trust hole — condition is a tier
     baked into the id (…_shot / _worn / _pristine), so the server derives the
     quality ceiling from them rather than believing a reported cap. Claiming
     pristine parts you do not hold is a separate problem, addressed when parts
     move server-side; today it would let a player skip cleaning, not exceed a
     budget. */
export async function mintServer(itemId, blueprintId, parts, quality, alloc) {
  if (!online()) return null;
  const d = payload(await rpc('ws_mint', {
    p_blueprint_id: String(blueprintId),
    p_item_id: String(itemId),
    p_parts: Array.isArray(parts) ? parts : [],
    p_quality: Math.round(Math.max(0, Math.min(100, Number(quality) || 0))),
    p_alloc: alloc && typeof alloc === 'object' ? alloc : {},
  }));
  if (!d) return null;
  return { id: d.id, itemId: d.item_id, quality: d.quality | 0, stats: d.stats || {}, weapon: d.weapon || {}, budget: d.budget | 0, spent: d.spent | 0 };
}

/* Claim a blueprint. `source` is 'loot' | 'rep' | 'aza'.

   🔴 THE AZA PATH IS REAL MONEY AND IS NOT CALLED FROM HERE. It needs the
      ledger id handed back by spendSovereigns(), which resolves on a promise
      AFTER the local debit — so the purchase flow has to await the charge and
      refund on a failed grant. That belongs with the store UI (phase 8), not
      buried in a generic helper where a caller could reach it without the
      refund half. */
export async function grantBlueprint(blueprintId, source, ledgerId) {
  if (!online()) return null;
  const d = payload(await rpc('ws_grant_blueprint', {
    p_blueprint_id: String(blueprintId),
    p_source: String(source || 'loot'),
    p_ledger_id: ledgerId || null,
  }));
  if (!d) return null;
  try { await syncState(); } catch (e) {}
  return d;
}

/* Deliver against a contract. Scoring and the rep move both happen server-side
   — the client learns the outcome, it does not decide it. */
export async function deliverContract(contractId, itemId) {
  if (!online()) return null;
  const r = await rpc('ws_deliver', { p_contract_id: String(contractId), p_item_id: String(itemId) });
  const d = payload(r);
  try { await syncState(); } catch (e) {}
  // A refusal is a real answer here, not a fallback case — the caller needs to
  // show WHY the delivery bounced.
  if (!d) return (r && r.data && r.data.error) ? { ok: false, error: r.data.error } : null;
  return d;
}

/* Does the player own this blueprint? Reads the mirror, which syncState keeps
   fresh. Offline this is whatever last synced — acceptable, because ws_mint
   re-checks ownership server-side and refuses regardless of what the client
   believed. */
export function ownsBlueprint(blueprintId) {
  try {
    const s = ensureWeaponSmith();
    return (s.blueprints || []).indexOf(blueprintId) >= 0;
  } catch (e) { return false; }
}

/* Refill the order board. Server-generated, always — a client that could write
   its own contracts would write itself "minAtk 1, pays 999999". `throttled`
   is a normal answer, not a failure: it means the board is unchanged. */
export async function rollBoard() {
  if (!online()) return null;
  const d = payload(await rpc('ws_roll_board', {}));
  if (!d) return null;
  const s = ensureWeaponSmith();
  if (Array.isArray(d.contracts)) { s.contracts = d.contracts; s.contractsSyncedAt = Date.now(); }
  if (typeof d.rep === 'number') s.rep = d.rep | 0;
  if (typeof d.slots === 'number') s.slots = d.slots | 0;
  wsSave();
  return d;
}

/* Claim a blueprint the player has earned through reputation. The server
   re-checks rep_required, so this cannot be talked into an early unlock. */
export async function claimRepBlueprint(blueprintId) {
  return grantBlueprint(blueprintId, 'rep');
}

/* The rep ladder's names, matching ws_contract_slots in sql/041. Presentation
   only — the SLOT COUNT comes from the server, this just labels it. */
export const REP_TIERS = [
  { at: 90, name: 'Guild Master' },
  { at: 70, name: 'Master Armorer' },
  { at: 45, name: 'Registered Armorer' },
  { at: 20, name: 'Jobbing Smith' },
  { at: 0,  name: 'Unproven' },
];
export const repTier = (rep) => (REP_TIERS.find((t) => (rep | 0) >= t.at) || REP_TIERS[REP_TIERS.length - 1]).name;
