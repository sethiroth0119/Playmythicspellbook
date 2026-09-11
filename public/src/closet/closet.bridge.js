/* closet.bridge.js — the PLAYER's side of the closet: what they own, what
   they wear, and paying for more. All of it is on the PROFILE, which
   index.html owns (the globals trap: a module cannot see `Profile`), so it
   crosses on window.MythicBridge.closet:

     outfit()            → { body, wear }        Profile.closet.outfit
     setOutfit(o)        → bool                   … + saveProfile()
     owned()             → [itemId]               Profile.closet.owned
     grant(itemId)       → bool                   append (never removes)
     charge(n, cur, why) → bool                   spendGems / spendSovereigns
     balance(cur)        → number
     signedIn()          → bool

   ⚠ Every one of these degrades to THIS DEVICE when the bridge is absent (a
     harness, a build older than the closet, a signed-out visitor): the outfit
     and the owned list go to localStorage, and charge() refuses anything
     that is not free — a visitor can try clothes on, not buy them. That is
     the Corp.* rule and also what keeps money honest: the only path that
     spends Cinder is index.html's spendGems(). */

import { normalizeOutfit } from './closet.model.js';

const LS = 'mythic_closet_profile_v1';
function b() { try { const B = window.MythicBridge; return B && B.closet ? B.closet : null; } catch (e) { return null; } }
function readLS() { try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
function writeLS(j) { try { localStorage.setItem(LS, JSON.stringify(j)); return true; } catch (e) { return false; } }

export function signedIn() { try { const B = b(); return !!(B && B.signedIn && B.signedIn()); } catch (e) { return false; } }
export function outfit() {
  try { const B = b(); if (B && B.outfit) return normalizeOutfit(B.outfit()); } catch (e) {}
  return normalizeOutfit(readLS().outfit);
}
export function setOutfit(o) {
  o = normalizeOutfit(o);
  try { const B = b(); if (B && B.setOutfit) { if (B.setOutfit(o)) return true; } } catch (e) {}
  const j = readLS(); j.outfit = o; return writeLS(j);
}
export function owned() {
  try { const B = b(); if (B && B.owned) { const l = B.owned(); if (Array.isArray(l)) return l.slice(); } } catch (e) {}
  const l = readLS().owned; return Array.isArray(l) ? l.slice() : [];
}
export function owns(itemId) { return owned().includes(itemId); }
export function grant(itemId) {
  try { const B = b(); if (B && B.grant) { if (B.grant(itemId)) return true; } } catch (e) {}
  const j = readLS(); j.owned = Array.isArray(j.owned) ? j.owned : []; if (!j.owned.includes(itemId)) j.owned.push(itemId); return writeLS(j);
}
export function balance(cur) { try { const B = b(); return B && B.balance ? (+B.balance(cur) || 0) : 0; } catch (e) { return 0; } }
/* Pay for an item. Free is always fine; anything else needs the real bridge. */
export function charge(amount, currency, reason) {
  amount = Math.floor(+amount || 0);
  if (amount <= 0 || currency === 'free') return true;
  try { const B = b(); if (B && B.charge) return !!B.charge(amount, currency, reason); } catch (e) {}
  return false;
}
export function toast(msg, ms) { try { const B = window.MythicBridge; if (B && B.toast) return B.toast(msg, ms); } catch (e) {} try { console.log('[closet]', msg); } catch (e) {} }
export async function confirm(msg) { try { const B = window.MythicBridge; if (B && B.confirm) return !!(await B.confirm(msg)); } catch (e) {} try { return window.confirm(msg.replace(/<[^>]+>/g, '')); } catch (e) { return false; } }
export function isAdmin() { try { const B = window.MythicBridge; return !!(B && B.isAdmin && B.isAdmin()); } catch (e) { return false; } }
