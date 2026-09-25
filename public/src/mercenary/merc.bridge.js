/* ═══════════════════════════════════════════════════════════════════════════
   merc.bridge.js — THE SEAM between /src/mercenary and the legacy app.

   🔴 WHY THIS FILE EXISTS AT ALL.
   index.html declares Profile, Cloud, App, Forge and RESOURCES as top-level
   `const`. Those are global LEXICAL bindings — they are NOT properties of
   `window` — so an ES module genuinely cannot see them. `window.Profile` is
   undefined even though `const Profile` is right there. That trap has already
   cost real time twice on the Node City bridge (FoundationReserve, then
   Profile), and CLAUDE.md names it specifically.

   So index.html hands this module exactly what it needs, once, as
   `window.MythicMercBridge`. Nothing in /src/mercenary reads a bare global.
   If this module needs something new, ADD IT TO THE BRIDGE — here and in the
   index.html block that builds it. Do not reach around.

   ⚠ Every accessor is a FUNCTION, never a snapshot. Profile.gems changes
     constantly; a captured value goes stale the moment the player spends.
   ═══════════════════════════════════════════════════════════════════════════ */

/* A bridge-shaped object that does nothing, so this module can be imported and
   even rendered before index.html has published the real one (or on a test
   page with no game at all). Every consumer is written against THIS shape, so
   a missing method here is a missing method everywhere. */
const NULL_BRIDGE = {
  cloud: null,
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',

  // 🧰 Forge resources — the live RESOURCES/SALVAGE_RES tables, which already
  //    carry every admin-authored custom resource because
  //    _applyResourceCustomization() MUTATES those arrays in place.
  resources: () => [],
  meta: (id) => ({ id, name: id, icon: '📦' }),
  getRes: () => 0,
  spendRes: () => false,
  addRes: () => false,
  refundRes: () => false,
  resourceCap: () => 0,
  resourceUnits: () => 0,

  // 🃏 Custom cards — getAllCustomCards(), i.e. Forge-authored merged with the
  //    published catalog.
  customCards: () => [],
  ownCount: () => 0,
  takeOwned: () => false,
  giveOwned: () => false,

  // 🔥 Cinder. The board never mutates Profile.gems: the server moves the
  //    money and hands back the authoritative balance, which adoptBalance()
  //    applies through index.html's own (tax-exempt, seq-aware) path.
  gems: () => 0,
  adoptBalance: () => false,

  save: () => false,
  toast: (m) => { try { console.log('[mercenary]', m); } catch (e) {} },
  confirm: async () => false,
  render: () => {},
  isAdmin: () => false,
  ebUrl: () => 'https://mythicspellbook.xyz/',
  _null: true,
};

export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicMercBridge;
    return (b && typeof b.signedIn === 'function') ? b : NULL_BRIDGE;
  } catch (e) { return NULL_BRIDGE; }
}

export function bridgeReady() { return !bridge()._null; }

/* Small shared helpers. esc() lives here rather than being imported from the
   legacy app because every render path needs it and it must never be the
   reason a module fails to load. */
export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtNum(n) {
  const v = Number(n) || 0;
  return v >= 1000000 ? (v / 1000000).toFixed(1) + 'M'
       : v >= 10000 ? (v / 1000).toFixed(1) + 'k'
       : Math.round(v).toLocaleString();
}

export function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString(); } catch (e) { return '—'; }
}

/* "in 4h" / "2d ago" / "overdue". Deadlines are the whole tension of the
   board, so they are never rendered as a raw timestamp. */
export function fmtWhen(ts) {
  try {
    const d = new Date(ts).getTime();
    if (!isFinite(d)) return '—';
    const ms = d - Date.now();
    const a = Math.abs(ms);
    const n = a < 3600000 ? Math.round(a / 60000) + 'm'
            : a < 86400000 ? Math.round(a / 3600000) + 'h'
            : Math.round(a / 86400000) + 'd';
    return ms >= 0 ? 'in ' + n : n + ' ago';
  } catch (e) { return '—'; }
}

/* ── THE TWO PROJECTIONS OF THE BRIDGE ───────────────────────────────────────
   `ctx` is the READ surface the manifest maths and the renderers share; `io`
   is the WRITE surface the delivery and claim paths use. Both are thin
   projections of the bridge and live here, not in index.js, so that importing
   them cannot create a cycle (render → index → render).

   🔴 EVERY io MUTATOR RETURNS A BOOLEAN, and that is not decoration: deliver()
      decides whether to unwind a half-taken drop from these return values. A
      wrapper that returned `undefined` on success would make the rollback fire
      on a leg that actually worked — or, worse, not fire on one that did not.
      Every entry is also individually guarded, so a missing bridge method is a
      refused action rather than a thrown exception inside a render.          */

export function ctx() {
  const b = bridge();
  return {
    resources:     () => { try { return b.resources() || []; } catch (e) { return []; } },
    meta:          (id) => { try { return b.meta(id) || { id, name: id, icon: '📦' }; } catch (e) { return { id, name: id, icon: '📦' }; } },
    getRes:        (id) => { try { return b.getRes(id) | 0; } catch (e) { return 0; } },
    ownCount:      (k, id) => { try { return b.ownCount(k, id) | 0; } catch (e) { return 0; } },
    resourceCap:   () => { try { return b.resourceCap() | 0; } catch (e) { return 0; } },
    resourceUnits: () => { try { return b.resourceUnits() | 0; } catch (e) { return 0; } },
    customCards:   () => { try { return b.customCards() || []; } catch (e) { return []; } },
    gems:          () => { try { return b.gems() | 0; } catch (e) { return 0; } },
    userId:        () => { try { return b.userId(); } catch (e) { return null; } },
  };
}

export function io() {
  const b = bridge();
  return {
    spendRes:   (id, n) => { try { return !!b.spendRes(id, n | 0); } catch (e) { return false; } },
    addRes:     (id, n) => { try { return !!b.addRes(id, n | 0); } catch (e) { return false; } },
    refundRes:  (id, n) => { try { return !!b.refundRes(id, n | 0); } catch (e) { return false; } },
    takeOwned:  (k, id, n) => { try { return !!b.takeOwned(k, id, n | 0); } catch (e) { return false; } },
    giveOwned:  (k, id, n) => { try { return !!b.giveOwned(k, id, n | 0); } catch (e) { return false; } },
    save:       () => { try { return !!b.save(); } catch (e) { return false; } },
  };
}
