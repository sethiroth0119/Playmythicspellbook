/* ═══════════════════════════════════════════════════════════════════════════
   🔧 WEAPON SMITH — the module side of the seam.

   🔴 READ THIS BEFORE ADDING A GLOBAL LOOKUP ANYWHERE IN /src/weaponsmith.
   Profile, Cloud, App, Corp and Forge are declared as top-level `const` in
   index.html. Those are global LEXICAL bindings — they are NOT properties of
   window — so `window.Profile` is undefined even though `const Profile` is
   right there. An ES module cannot see them, at all, ever. That trap has
   already cost real time twice on the Node City bridge (FoundationReserve,
   then Profile), which is why CLAUDE.md calls it out by name.

   So: everything this feature needs is handed over explicitly by index.html on
   `window.WeaponSmithBridge`, and this file is the ONLY place in the feature
   that touches `window`. If the bench needs something new from the legacy app,
   ADD IT TO THE BRIDGE — never reach for a bare global, and never assume
   `window.Foo` exists because `const Foo` does.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The bridge is installed by index.html in ordinary source order, before the
   module scripts at the bottom of the file. It is still read lazily on every
   call rather than captured once: a captured reference would go stale across a
   hot reload, and — more importantly — capturing at import time would make a
   load-order regression fail SILENTLY at import instead of loudly at use. */
export function bridge() {
  try { return (typeof window !== 'undefined' && window.WeaponSmithBridge) || null; }
  catch (e) { return null; }
}

/* True when the seam is actually present. Every entry point checks this and
   bails quietly rather than throwing — a missing bridge must degrade the
   Weapon Smith to "not there", never take the page down with it. */
export function ready() {
  const b = bridge();
  return !!(b && typeof b.getWeaponSmith === 'function');
}

/* One warning, once, if the seam is missing. Loud enough to find in a console,
   quiet enough not to spam a render loop. */
let _warned = false;
export function warnMissing(where) {
  if (_warned) return;
  _warned = true;
  try { console.warn('[weaponsmith] window.WeaponSmithBridge is missing — the bench is disabled.', where || ''); } catch (e) {}
}

/* ── Thin, total accessors ────────────────────────────────────────────────
   Every one of these is safe to call with no bridge and returns a harmless
   empty value. Callers therefore never need their own try/catch, which is what
   keeps the guard from being forgotten in one place out of thirty. */

export const owns        = ()        => { const b = bridge(); try { return !!(b && b.ownsWeaponSmith()); } catch (e) { return false; } };
export const isAdmin     = ()        => { const b = bridge(); try { return !!(b && b.isAdmin());        } catch (e) { return false; } };
export const save        = ()        => { const b = bridge(); try { b && b.saveProfile(); } catch (e) {} };
export const toast       = (m, ms)   => { const b = bridge(); try { b && b.toast(m, ms);  } catch (e) {} };
export const confirmAsync= async (m) => { const b = bridge(); try { return b ? !!(await b.confirm(m)) : false; } catch (e) { return false; } };
export const render      = ()        => { const b = bridge(); try { b && b.render(); } catch (e) {} };

// 🔥 Cinder. Routed through the real helpers — Profile.gems is never mutated
// directly, per CLAUDE.md.
export const gems        = ()  => { const b = bridge(); try { return b ? (b.gems() | 0) : 0; } catch (e) { return 0; } };
export const spendGems   = (n) => { const b = bridge(); try { return b ? !!b.spendGems(n) : false; } catch (e) { return false; } };
export const addGems     = (n) => { const b = bridge(); try { b && b.addGems(n); } catch (e) {} };

// 🧰 Resources. getRes/addRes go through the legacy salvage ledger, which is
// the one place resource counts are allowed to live.
export const getRes      = (id)    => { const b = bridge(); try { return b ? (b.getRes(id) | 0) : 0; } catch (e) { return 0; } };
export const addRes      = (id, n) => { const b = bridge(); try { b && b.addRes(id, n); } catch (e) {} };
export const spendRes    = (cost)  => { const b = bridge(); try { return b ? !!b.spendRes(cost) : false; } catch (e) { return false; } };
export const produce     = (map)   => { const b = bridge(); try { b && b.produce(map); } catch (e) {} };

// ☁ Cloud. BOTH return null when the player is offline or not signed in, and
// every caller must handle that — the app has to work before the tables exist.
export const signedIn    = ()             => { const b = bridge(); try { return b ? !!b.signedIn() : false; } catch (e) { return false; } };
export const userId      = ()             => { const b = bridge(); try { return b ? b.userId() : null; } catch (e) { return null; } };
export const rpc         = async (n, a)   => { const b = bridge(); try { return b ? await b.rpc(n, a) : null; } catch (e) { return null; } };
export const table       = (n)            => { const b = bridge(); try { return b ? b.table(n) : null; } catch (e) { return null; } };

/* 📦 The persisted blob. index.html hands back the raw object and nothing
   more — the SHAPE of it is owned by state.js in this folder, deliberately, so
   there is exactly one definition of what a Weapon Smith save looks like. */
export const rawState    = () => { const b = bridge(); try { return b ? b.getWeaponSmith() : null; } catch (e) { return null; } };

/* 🔧 The crafted item book + the two writes that make a minted weapon real.
   `craftedBook` hands back the live map so a mint can key straight into it;
   `grantCrafted` puts the matching count into the ordinary inventory. BOTH are
   required for one weapon — the vault prunes placements whose itemId the
   inventory does not hold, and the loadout resolves the def through
   getItemById, so either half on its own is an invisible weapon. */
export const craftedBook = ()            => { const b = bridge(); try { return b ? b.craftedBook() : null; } catch (e) { return null; } };
export const grantCrafted= (id)          => { const b = bridge(); try { return b ? !!b.grantCrafted(id) : false; } catch (e) { return false; } };
export const equipToUnit = (uid, itemId) => { const b = bridge(); try { return b ? !!b.equipToUnit(uid, itemId) : false; } catch (e) { return false; } };
export const getItem     = (id)          => { const b = bridge(); try { return b ? b.getItem(id) : null; } catch (e) { return null; } };
