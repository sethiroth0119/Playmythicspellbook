/* ═══════════════════════════════════════════════════════════════════════════
   📜 SCHEMATICS — blueprints as tradeable items.

   RESOLVES design doc §12 open question 2, and in the direction it leaned:
   a blueprint DROPS AS AN ITEM which is CONSUMED to grant the entitlement.

   Why that shape and not a direct entitlement grant:
     · An item can be traded. A player who loots a Marksman schematic they will
       never build can sell it to someone who will, which is a whole secondary
       market for free — entitlements cannot do that.
     · It still ends as a row. Learning consumes the item and calls
       ws_grant_blueprint(source:'loot'), so ownership lives in
       ws_blueprints_owned like every other source. There is exactly one
       answer to "what may this player build".
     · The two states are meaningfully different: a schematic in the vault is
       an ASSET, and a learned blueprint is a CAPABILITY. Selling the first is
       reasonable; "selling" the second would mean un-learning, which nothing
       else in this game does.

   ⚠ LEARNING IS ONE-WAY AND THE ITEM IS GONE. So the entitlement write has to
     land before the item is consumed, and if the grant fails the item stays.
     See learnSchematic — the order there is the whole safety property.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge, ready, itemCount, moveItem } from './ws.bridge.js';
import { wsLog, wsSave, ensureWeaponSmith } from './state.js';
import { BLUEPRINTS, blueprint } from './blueprints.js';
import { grantBlueprint, online, ownsBlueprint } from './server.js';

/* A schematic's item id is derived from the blueprint id, so the two can never
   drift and no second table is needed to map between them. */
export const schematicId = (bpId) => 'wsbp_' + String(bpId || '').replace(/^ws_bp_/, '');
export const blueprintOf = (schemId) => {
  const key = 'ws_bp_' + String(schemId || '').replace(/^wsbp_/, '');
  return BLUEPRINTS[key] ? key : null;
};

/* Item defs for every blueprint, registered into getItemById alongside parts.
   Tier-1 frames are excluded: the Field Carbine and Sidearm are the starting
   frames every smith gets on founding the operation, and a schematic for
   something you already own is a dead item taking up a vault tile. */
export function schematicCatalog() {
  const out = {};
  for (const id in BLUEPRINTS) {
    const bp = BLUEPRINTS[id];
    if (bp.tier <= 1) continue;
    const sid = schematicId(id);
    out[sid] = {
      id: sid,
      name: bp.name + ' Schematic',
      icon: '📜',
      slotType: 'weaponPart',
      w: 2, h: 1,
      desc: 'Technical drawings for the ' + bp.name + ' (tier ' + bp.tier + ', ' + bp.budget +
            '-point frame). Learn it at the bench to build it — learning consumes the schematic. Tradeable until then.',
      schematic: { blueprintId: id, tier: bp.tier },
      // Priced against the Aza tier so the Cinder market and the store roughly
      // agree on what a frame is worth.
      value: bp.tier * 2200,
    };
  }
  return out;
}
export const SCHEMATICS = schematicCatalog();
export const isSchematic = (id) => !!SCHEMATICS[id];

/* Learn one. The ORDER HERE IS THE SAFETY PROPERTY.

   Grant FIRST, consume SECOND. If the entitlement write fails the player still
   holds the schematic and can retry; if it succeeds the item is spent. The
   other order — consume then grant — turns any dropped response into a
   destroyed item with nothing to show for it, and a schematic is worth
   thousands of Cinder.

   ⚠ ws_grant_blueprint is idempotent on (owner, blueprint), so the retry that
     this ordering makes possible is safe: a second call on an already-granted
     blueprint returns ok with already:true rather than an error. */
export async function learnSchematic(schemItemId) {
  if (!ready()) return { ok: false, reason: 'Bench unavailable.' };
  const bpId = blueprintOf(schemItemId);
  if (!bpId) return { ok: false, reason: 'That is not a schematic.' };
  if (itemCount(schemItemId) < 1) return { ok: false, reason: 'You do not have that schematic.' };

  const bp = blueprint(bpId);

  if (ownsBlueprint(bpId)) {
    return { ok: false, reason: 'You already know how to build the ' + bp.name + '. Sell the schematic instead.' };
  }

  /* 🔴 OFFLINE IS A REFUSAL, NOT A LOCAL GRANT. Blueprint ownership is a
     server row precisely so it survives a device change (§6.5); writing a
     local "learned" flag here would recreate the exact Oil Sim bug the whole
     design avoids — worse, the schematic would be consumed to produce a flag
     that vanishes on the next device. Better to tell the player to come back
     online than to eat a valuable item for nothing. */
  if (!online()) {
    return { ok: false, reason: 'Learning a schematic needs a connection — it is recorded to your account, not this device.' };
  }

  const g = await grantBlueprint(bpId, 'loot');
  if (!g || !g.ok) return { ok: false, reason: 'Could not record the blueprint. Your schematic is untouched — try again.' };

  // Granted. Now, and only now, the item is spent.
  if (!moveItem(schemItemId, -1)) {
    // The entitlement landed but the item did not clear. Harmless: the player
    // keeps a schematic they can no longer use, and learning it again is a
    // no-op. Logged rather than "fixed", because deleting the entitlement to
    // tidy up would be strictly worse than a spare item.
    wsLog('warn', 'Learned ' + bp.name + ' but the schematic did not clear from the vault.');
  }

  const s = ensureWeaponSmith();
  if ((s.blueprints || []).indexOf(bpId) < 0) s.blueprints = (s.blueprints || []).concat([bpId]);
  wsLog('learn', 'Learned the ' + bp.name + ' blueprint.');
  wsSave();
  return { ok: true, blueprintId: bpId, name: bp.name, already: !!g.already };
}

/* Drop a schematic into the player's vault. This is the hook a LOOT PATH
   calls — it grants the ITEM, never the entitlement, so a drop is exactly as
   valuable as the thing that dropped and nothing is recorded server-side until
   the player chooses to learn it.

   ⚠ Deliberately NOT wired into the battle reward table. That lives in the
     battle/encounter code (the `r.type === 'item'` arm), and CLAUDE.md puts
     battle code out of scope for this feature. Exposed as
     window.wsDropSchematic() so whoever owns the loot tables can call it in
     one line without this feature reaching into theirs. */
export function dropSchematic(bpIdOrSchemId) {
  if (!ready()) return null;
  const sid = SCHEMATICS[bpIdOrSchemId] ? bpIdOrSchemId : schematicId(bpIdOrSchemId);
  if (!SCHEMATICS[sid]) return null;
  if (!moveItem(sid, +1)) return null;
  wsLog('loot', 'Found ' + SCHEMATICS[sid].name + '.');
  wsSave();
  return sid;
}

/* Weighted pick for a loot roll, rarer as the tier climbs. Takes an rng so a
   drop table using it stays testable. */
export function rollSchematic(rng) {
  const pool = [];
  for (const sid in SCHEMATICS) {
    const w = Math.max(1, 5 - SCHEMATICS[sid].schematic.tier);   // t2 → 3, t3 → 2
    for (let i = 0; i < w; i++) pool.push(sid);
  }
  if (!pool.length) return null;
  const r = (typeof rng === 'function' ? rng() : Math.random());
  return pool[Math.floor(r * pool.length)];
}

/* Schematics the player is holding but has not learned. */
export function unlearned() {
  const out = [];
  for (const sid in SCHEMATICS) {
    if (itemCount(sid) > 0 && !ownsBlueprint(SCHEMATICS[sid].schematic.blueprintId)) out.push(sid);
  }
  return out;
}
