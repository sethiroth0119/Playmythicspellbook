/* ════════════════════════════════════════════════════════════════════════════
   ⛓ CHAIN BRIDGE — the ONLY thing /src/chain reads the legacy app through.
   ----------------------------------------------------------------------------
   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `App`, `Forge` are top-level
   `const` in index.html — lexical globals that are NOT on `window`, so nothing
   in this folder can see them. index.html hands us `window.MythicChainBridge`
   and that object is the whole seam. A missing bridge makes the chain inert,
   which is exactly right: the battle then behaves as it did before this folder
   existed (traps spring immediately, nothing opens a response window).

   ⚠ EVERY READER IS A FUNCTION, NEVER A SNAPSHOT. The hand is re-read on every
   single window; a captured array would offer the player a card they discarded
   two links ago.
   ════════════════════════════════════════════════════════════════════════════ */

export function bridge() {
  try { return window.MythicChainBridge || null; } catch (e) { return null; }
}

let _warned = false;
export function bridgeReady() {
  const b = bridge();
  if (b) return true;
  if (!_warned) {
    _warned = true;
    try { console.warn('[chain] window.MythicChainBridge absent — response windows disabled (battle falls back to immediate resolution).'); } catch (e) {}
  }
  return false;
}

/* A no-op shaped like the bridge, so call sites never branch on null. */
const NOOP = {
  hand: () => [],
  field: () => [],
  grave: () => [],
  canPay: () => false,
  pay: () => false,
  cardDef: () => null,
  cardArt: () => '',
  isAiTurn: () => false,
  aiHoldsResponse: () => null,
  toast: () => {},
  sfx: () => {},
  settings: () => ({}),
  save: () => {},
};

export function bx() { return bridge() || NOOP; }

/* HTML escape — the chain UI prints card names and player-authored deck names,
   and this file is the only place either becomes markup. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
