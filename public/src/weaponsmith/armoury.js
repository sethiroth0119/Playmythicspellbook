/* ═══════════════════════════════════════════════════════════════════════════
   🏛 THE ARMOURY — what you built, how you built it, and who carries it.

   Two jobs:
     1. PROVENANCE. A crafted weapon carries `crafted: { blueprintId, quality,
        parts, at, serverId }` from the mint. Without somewhere to show it, all
        that survives of a two-minute build is a stat line — and the whole
        appeal of a gunsmith game is that the thing in your hands has a HISTORY.
     2. PARITY. Heroes equip crafted weapons through the same
        setHeroLoadoutSlot every shop weapon uses. There was no new equip code
        to write, which was the point of minting weapons as ordinary item ids;
        this is the UI that finally exercises it.

   ⚠ `local: true` on a def means it was minted OFFLINE and nothing verified
     it. Surfaced here rather than hidden — a player about to list a weapon
     needs to know it cannot be sold, and finding that out at the market is
     worse than finding it out here.
   ═══════════════════════════════════════════════════════════════════════════ */

import { craftedBook, heroes, equipToHero, ready, itemCount, corpDesk, deliverToCorpVault } from './ws.bridge.js';
import { partDef, tierOf } from './parts.js';
import { blueprint, isBlade } from './blueprints.js';

/* Every crafted weapon the player holds, newest first. Reads the item book and
   cross-checks the inventory: a def whose count has gone (sold, delivered) is
   not in the armoury even though the def lingers, because the def is kept
   deliberately — see the additive-only merge in the cloud-save whitelist. */
export function armoury() {
  if (!ready()) return [];
  const book = craftedBook() || {};
  const out = [];
  for (const id in book) {
    const d = book[id];
    if (!d || !d.crafted) continue;
    if (itemCount(id) < 1) continue;
    out.push(d);
  }
  return out.sort((a, b) => (b.crafted.at | 0) - (a.crafted.at | 0));
}

/* The same list, already resolved to provenance.
   ⚠ Exists because `armoury()` returns raw DEFS and every caller so far wanted
     provenance — having one name mean both shapes depending on which layer you
     asked was a confusion waiting to happen, and did in fact trip a test. One
     name, one shape: armoury() = what you own, armouryDetail() = what it is. */
export function armouryDetail() { return armoury().map(provenance).filter(Boolean); }

/* The provenance of one weapon, as plain data the renderer can lay out. */
export function provenance(def) {
  if (!def || !def.crafted) return null;
  const bp = blueprint(def.crafted.blueprintId);
  const parts = (def.crafted.parts || []).map((pid) => {
    const p = partDef(pid);
    if (!p) return { id: pid, name: pid, slot: '?', tier: '?', tierName: '?' };
    return { id: pid, name: p.name, slot: p.part.slot, mount: p.part.mount,
             tier: p.part.tier, tierName: tierOf(p.part.tier).name };
  });
  // The ceiling this build could not have beaten, recovered from its parts.
  // Shown because "why is my 100% build only 90%?" is otherwise unanswerable.
  let cap = 1;
  for (const p of parts) { const t = tierOf(p.tier); if (t.qualityCap < cap) cap = t.qualityCap; }

  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    slotType: def.slotType,
    stats: def.stats || {},
    weapon: def.weapon || {},
    quality: def.crafted.quality | 0,
    conditionCap: parts.length ? Math.round(cap * 100) : 100,
    blueprintName: (bp && bp.name) || def.crafted.blueprintId,
    budget: (bp && bp.budget) | 0,
    spent: Object.keys(def.stats || {}).reduce((a, k) => a + (def.stats[k] | 0), 0),
    forged: !!(bp && isBlade(bp)),
    parts: parts,
    at: def.crafted.at | 0,
    // 🔴 Unverified — minted offline, cannot be sold. See the header.
    unverified: !!def.local,
    serverId: def.crafted.serverId || null,
  };
}

/* Which hero slots this weapon can go into. Derived from slotType, the same
   field itemSlotFit reads, so this can never offer a slot the equip would
   then refuse. */
export function slotsFor(def) {
  const t = def && def.slotType;
  if (t === 'primeWeapon') return [{ key: 'primeWeapon', label: 'Prime' }];
  if (t === 'secondaryWeapon') return [{ key: 'secondaryWeapon', label: 'Secondary' }];
  return [];
}

/* Equip to a hero. Thin — setHeroLoadoutSlot does the validating, including
   the ownership check, and it is deliberately not re-implemented here. */
export function equip(heroId, slot, itemId) {
  return equipToHero(heroId, slot, itemId);
}

export function heroList() { return heroes(); }

/* Who is currently carrying this weapon, if anyone. A weapon can only be in
   one hero's hands, so the first match is the answer. */
export function carriedBy(itemId) {
  for (const h of heroes()) {
    if (h.primeWeapon === itemId) return { hero: h, slot: 'primeWeapon' };
    if (h.secondaryWeapon === itemId) return { hero: h, slot: 'secondaryWeapon' };
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   🏦 DELIVER TO THE CORPORATION VAULT.

   A hired Weapon Smith forges for the guild, not for a shelf, and until now
   there was no way for what came off the bench to reach the people who paid
   for it. This is that path: the weapon leaves this armoury and appears in
   corp_vault as kind 'item', attributed to the smith who made it.

   🔴 NOTHING HERE MINTS, AND NOTHING HERE DUPLICATES. The removal and the
   vault write are one operation, and index.html owns both halves — see
   _wsDeliverToCorpVault, including why its failure path re-reads the vault
   before refunding rather than trusting the error. The module deliberately
   does NOT get moveItem(id,-1) plus a separate write: that pairing is exactly
   how a lost response turns into two copies of a unique weapon.

   ⚠ A CARRIED weapon is refused HERE as well as in index.html. Not
     belt-and-braces for its own sake: this side has `carriedBy`, so it can
     name the hero, and "Kade is carrying it" is an answer a player can act on
     where "that weapon is equipped" is a riddle. The host check is the one
     that is load-bearing; this one is the one that is useful.
   ═══════════════════════════════════════════════════════════════════════════ */
export function vaultDesk() { return corpDesk(); }

export async function deliverToVault(itemId) {
  if (!ready()) return { ok: false, error: 'no_bridge' };
  const id = String(itemId || '');
  if (!id) return { ok: false, error: 'no_item' };
  const desk = corpDesk();
  if (!desk) return { ok: false, error: 'no_corp' };
  // The def is read BEFORE the delivery — afterwards itemCount() is 0 and the
  // weapon is out of armoury(), so this is the last moment its name is here.
  const book = craftedBook() || {};
  const def = book[id] || null;
  if (!def || itemCount(id) < 1) return { ok: false, error: 'not_held' };
  const holder = carriedBy(id);
  if (holder) return { ok: false, error: 'equipped', hero: holder.hero.name };
  /* 🔴 Unverified weapons are refused. `local: true` means it was minted
     OFFLINE and no server ever scored it — the same reason it cannot be sold.
     Letting one into a SHARED vault would hand the whole guild an item whose
     stats nothing has ever checked, which is a strictly worse version of the
     problem the sale ban exists to prevent. */
  if (def.local) return { ok: false, error: 'unverified' };
  const r = await deliverToCorpVault(id);
  if (r && r.ok) return { ok: true, name: def.name || id, icon: def.icon || '🔧', corp: r.corp || desk.name };
  return { ok: false, error: (r && r.error) || 'refused' };
}
