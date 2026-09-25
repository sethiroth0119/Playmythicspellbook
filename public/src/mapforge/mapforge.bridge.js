/* mapforge.bridge.js — the ONLY place World Forge touches the legacy app.

   index.html's Profile/Cloud/App are top-level `const`s — invisible to a
   module (see CLAUDE.md, "the globals trap"). index.html hands us what we
   need on window.MythicBridge. Everything here is optional: with no bridge
   at all (opened from a bare page, or before index.html finished booting)
   the editor still runs, saving to localStorage and using its own toasts. */

export function bridge() {
  try { return window.MythicBridge || null; } catch (e) { return null; }
}

export function signedIn() { try { const b = bridge(); return !!(b && b.signedIn()); } catch (e) { return false; } }
export function userId() { try { const b = bridge(); return (b && b.userId()) || null; } catch (e) { return null; } }
export function displayName() { try { const b = bridge(); return (b && b.displayName()) || 'Builder'; } catch (e) { return 'Builder'; } }
export function isAdmin() { try { const b = bridge(); return !!(b && b.isAdmin()); } catch (e) { return false; } }

/* The mini-games a world can belong to: [{ id, name }], where `id` is the
   App.screen the game runs on (index.html's ATHENA_MINI_GAMES). Empty with no
   bridge — the picker then offers only 'sandbox' and a custom id. */
export function miniGames() {
  try { const b = bridge(); const l = b && b.miniGames ? b.miniGames() : []; return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
export function currentScreen() { try { const b = bridge(); return (b && b.screen && b.screen()) || ''; } catch (e) { return ''; } }

export function supabase() {
  try { const b = bridge(); return (b && b.cloud && b.cloud.client && b.signedIn()) ? b.cloud.client : null; }
  catch (e) { return null; }
}

/* ── the game's menus, screens and guides — for the Menu tab and interactions ── */
export function hubs() {
  try { const b = bridge(); const l = b && b.hubs ? b.hubs() : null; if (Array.isArray(l) && l.length) return l; } catch (e) {}
  return [{ id: 'main', name: 'Main menu' }, { id: 'battle', name: 'Battle Hall' }, { id: 'forge', name: 'Forge Sanctum' }, { id: 'exchange', name: 'Ruin Exchange' }, { id: 'codex', name: 'Codex' }, { id: 'field', name: 'The Field' }, { id: 'arcanum', name: 'Arcanum' }];
}
export function guides() {
  try { const b = bridge(); const l = b && b.guides ? b.guides() : []; return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
export function playGuide(id) { try { const b = bridge(); return !!(b && b.playGuide && b.playGuide(id)); } catch (e) { return false; } }
export function openHub(h) { try { const b = bridge(); return !!(b && b.openHub && b.openHub(h)); } catch (e) { return false; } }
export function openScreen(id) { try { const b = bridge(); return !!(b && b.openScreen && b.openScreen(id)); } catch (e) { return false; } }

/* 🧍 THE PLAYER'S CHOSEN CHARACTER, ACCOUNT-WIDE.
   One character represents a person in every hub they walk into, so it lives on
   the PROFILE and not on the map — index.html owns Profile (the globals trap:
   a module cannot see it), so it crosses here like everything else.
   ⚠ BOTH DEGRADE TO A NO-OP, deliberately. A build whose bridge predates this
     pair, or a signed-out visitor, reads '' and writes nothing — and `''`
     resolves to the map author's default character in resolveCharacter(), so
     the hub still has people in it rather than an error. */
export function avatarPick() { try { const b = bridge(); return (b && b.avatarPick && b.avatarPick()) || ''; } catch (e) { return ''; } }
export function setAvatarPick(id) { try { const b = bridge(); return !!(b && b.setAvatarPick && b.setAvatarPick(id)); } catch (e) { return false; } }

export async function confirm(msg) {
  try { const b = bridge(); if (b && b.confirm) return !!(await b.confirm(msg)); } catch (e) {}
  try { return window.confirm(msg); } catch (e) { return false; }
}
