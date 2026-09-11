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

export function supabase() {
  try { const b = bridge(); return (b && b.cloud && b.cloud.client && b.signedIn()) ? b.cloud.client : null; }
  catch (e) { return null; }
}

export async function confirm(msg) {
  try { const b = bridge(); if (b && b.confirm) return !!(await b.confirm(msg)); } catch (e) {}
  try { return window.confirm(msg); } catch (e) { return false; }
}
