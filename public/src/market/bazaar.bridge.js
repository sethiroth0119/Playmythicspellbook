/* ═══════════════════════════════════════════════════════════════════════════
   bazaar.bridge.js — THE SEAM between /src/market and the legacy app.

   🔴 WHY THIS FILE EXISTS. index.html declares Profile, Cloud and App as
   top-level `const` — global LEXICAL bindings, NOT properties of window. An
   ES module cannot see them; `window.Profile` is undefined even though
   `const Profile` is right there. See CLAUDE.md. Everything this module needs
   is handed over explicitly on `window.MythicBridge`.

   ⚠ THE BAZAAR IS A REAL-MONEY SURFACE, so the bridge it uses is deliberately
   NARROW. It can escrow an item off the player and grant one to them, and it
   can read the auth token. It cannot touch Cinder, Aza, or any in-game
   balance — a real-money screen must never be a path into the soft economy,
   because that turns every pricing bug into a dollar-denominated one.
   ═══════════════════════════════════════════════════════════════════════════ */

const NULL_BRIDGE = {
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',
  token: async () => null,
  toast: (m) => { try { console.log('[bazaar]', m); } catch (e) {} },
  confirm: async () => false,
  render: () => {},
  // Sellable inventory, as [{ uid, kind, title, card, unit }].
  bazaarInventory: () => [],
  // Escrow returns true when the copy actually left the player. The listing is
  // only posted after that, and _restore puts it back if the post fails —
  // "escrow first, row second, in that order, always" (the Cinder market's
  // rule, and it matters more here).
  bazaarEscrow: () => false,
  bazaarRestore: () => {},
  // Deliver a claimed purchase into the buyer's collection.
  bazaarGrant: () => false,
  _null: true,
};

export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicBridge;
    return (b && typeof b.bazaarInventory === 'function') ? b : NULL_BRIDGE;
  } catch (e) { return NULL_BRIDGE; }
}

export function bridgeReady() { return !bridge()._null; }

export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 💵 Money is formatted from INTEGER CENTS, always. There is no float dollar
// value anywhere in this module — cents in, string out — because a rounded
// display value that gets sent back as an amount is the classic way a
// marketplace loses a cent per transaction in one direction only.
export function usd(cents) {
  const n = Math.round(Number(cents) || 0);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return sign + '$' + Math.floor(a / 100).toLocaleString() + '.' + String(a % 100).padStart(2, '0');
}

// Parse a typed price into cents. Rejects anything that is not plainly a
// dollar amount rather than coercing it — Number('') is 0, and a silent 0
// would post a free listing.
export function centsFromInput(s) {
  const t = String(s == null ? '' : s).trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  const [d, c] = t.split('.');
  return (parseInt(d, 10) * 100) + (c ? parseInt(c.padEnd(2, '0'), 10) : 0);
}
