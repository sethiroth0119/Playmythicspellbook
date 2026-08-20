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

import { craftedBook, heroes, equipToHero, ready, itemCount } from './ws.bridge.js';
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
