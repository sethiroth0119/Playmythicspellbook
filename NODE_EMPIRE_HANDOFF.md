# 🏙 District Node Empire — handoff for items 1–3

Start here. Items 1–3 are self-contained and ship in one pass. Items 4–7 are scoped at the
bottom; do not start them in the same session.

## THE PINNED DESIGN DECISION
> *"each node multiplies how much cinder they get for the main node"*

**The CITY's Cinder yield is multiplied by the number of nodes the player owns. Towns yield
normally.** 3 nodes ⇒ the city pays ×3 Cinder; the two towns pay ×1 each. This is deliberately a
*city* bonus, not a per-node bonus — it makes the capital worth defending and keeps total income
linear in node count rather than quadratic.

⚠ **Cinder only.** Do NOT multiply the other resources — the node economy is server-authoritative
and shared, and multiplying every resource compounds with the existing Quality × Defense × Corp ×
Population × Region chain into runaway numbers.

---

## VERIFIED ANCHORS (checked against the live file, v119v8)

| What | Where |
|---|---|
| Node ownership | `Profile.tw_state.ownedNodes = { [nodeId]: { capturedAt, lastCollectAt, stability, guards[], upgrades[], ownerCorpId, … } }` |
| State accessor | `_twState()` · node defs via `_twForge().nodes` |
| **Yield choke point** | **`tw_collectNode(nodeId)` ~L202664** — one function, already carries the documented `Base × Quality × Defense × Corp × Population × Region` formula. All yield changes go HERE. |
| Node def fields | `node.resourceYield{}`, `node.quality`, `node.population`, `node.sectorId`, `node.connections[]` |
| Chart render | District Nodes chart (v118r5 skin) — connection lines drawn into `#tw-connections` |
| Collect cooldown | `TW_COLLECTION_MS` (5h30m) |

---

## ITEM 1 — City vs Towns + Empire stat

**Fully derived. No new storage, no migration.** The city is simply the earliest-captured node.

```js
// 🏙 The player's CITY is their first-claimed node; every other node is a TOWN.
// Derived from capturedAt so it needs no new field and can never drift out of
// sync with ownership. Ties break on node id so the answer is stable.
function twCityNodeId() {
  try {
    const owned = (_twState().ownedNodes) || {};
    let best = null, bestAt = Infinity;
    for (const id of Object.keys(owned)) {
      const at = (owned[id] && owned[id].capturedAt) || 0;
      if (at < bestAt || (at === bestAt && (best === null || id < best))) { bestAt = at; best = id; }
    }
    return best;
  } catch (e) { return null; }
}
function twIsCity(nodeId) { return !!nodeId && twCityNodeId() === nodeId; }
function twOwnedCount() {
  try { return Object.keys((_twState().ownedNodes) || {}).length; } catch (e) { return 0; }
}
function twNodeRank(nodeId) { return twIsCity(nodeId) ? 'city' : 'town'; }

// 👑 EMPIRE — one score that says "this player is building something".
// Weighted so BREADTH (nodes) and DEPTH (population, upgrades, stability) both
// count; a lone maxed node should not out-rank a real network.
function twEmpireScore() {
  try {
    const st = _twState(), t = _twForge();
    const owned = st.ownedNodes || {};
    let pop = 0, upg = 0, stab = 0, n = 0;
    for (const id of Object.keys(owned)) {
      const o = owned[id] || {};
      const def = (t.nodes || []).find(x => x.id === id) || {};
      n++;
      pop  += (typeof def.population === 'number') ? def.population : 100;
      upg  += (o.upgrades || []).length;
      stab += (o.stability | 0);
    }
    if (!n) return 0;
    return Math.round(n * 100 + pop * 0.5 + upg * 25 + (stab / n) * 2);
  } catch (e) { return 0; }
}
function twEmpireTier(score) {
  if (score >= 2500) return { label: 'DYNASTY',   color: '#ffd166' };
  if (score >= 1500) return { label: 'EMPIRE',    color: '#e0b23c' };
  if (score >= 800)  return { label: 'DOMINION',  color: '#c29a3a' };
  if (score >= 300)  return { label: 'HOLDING',   color: '#9d917c' };
  return { label: 'OUTPOST', color: '#8d8272' };
}
try { window.__mg = window.__mg || {}; window.__mg.empire = { city: twCityNodeId, rank: twNodeRank, score: twEmpireScore }; } catch (e) {}
```

**Show it:** on the city's tile render a `🏙 CITY` badge, on the others `TOWN`; put
`twEmpireTier(twEmpireScore())` in the Reconstruction/Network header next to the node count.

---

## ITEM 2 — Green surge (owner-only)

⚠ **Compute client-side from YOUR ownership. Never put it in the shared node payload** — that
payload goes to every player, so a surge baked into it stops being private and leaks who owns what.

```css
/* 💚 OWNER SURGE — only ever added to a tile by the local client, for nodes the
   LOCAL player owns. Never serialize this class or its state. */
@keyframes tw-surge {
  0%,100% { box-shadow: 0 0 0 1px rgba(124,232,168,.55), 0 0 10px rgba(124,232,168,.18); }
  50%     { box-shadow: 0 0 0 1px rgba(124,232,168,.85), 0 0 22px rgba(124,232,168,.45); }
}
.tw-node.is-mine { animation: tw-surge 2.6s ease-in-out infinite; }
.tw-node.is-mine.is-city { animation-duration: 1.9s; }   /* the capital pulses harder */
@media (prefers-reduced-motion: reduce) { .tw-node.is-mine { animation: none;
  box-shadow: 0 0 0 1px rgba(124,232,168,.7); } }
```

In the tile renderer:
```js
const _mine = !!(_twState().ownedNodes || {})[n.id];
// class list: ... + (_mine ? ' is-mine' : '') + (_mine && twIsCity(n.id) ? ' is-city' : '')
```

---

## ITEM 3 — The city Cinder multiplier

**One edit, inside `tw_collectNode` (~L202664).** The existing `multiplier` line stays untouched;
add an empire factor applied to **Cinder only**, and only on the city.

Find:
```js
  const multiplier = quality * defense * (1 + sectorB.yieldPct) * population * (1 + regionB.yieldPct) * darkBM;
```
Add directly beneath it:
```js
  // 👑 EMPIRE BONUS — the CAPITAL pays Cinder per node in the empire. Towns are
  // unaffected, and no other resource is touched: the chain above already
  // multiplies six ways, and compounding every resource by node count turns a
  // 3-node player into a runaway economy.
  const _isCity   = (typeof twIsCity === 'function') && twIsCity(nodeId);
  const _empireX  = _isCity ? Math.max(1, (typeof twOwnedCount === 'function') ? twOwnedCount() : 1) : 1;
```
Then in the per-resource loop, replace the amount line:
```js
    const _isCinder = (k === 'cinder' || k === 'gems');
    const amt = Math.max(0, Math.round((yield_[k] | 0) * multiplier * (_isCinder ? _empireX : 1)));
```
⚠ Confirm the real Cinder key in `node.resourceYield` before shipping — check a live node def; the
ledger uses `Profile.gems` for Cinder, but the node yield map may key it `cinder`. Cover both, as
above, only if both actually occur.

Surface it in the collect toast: `👑 Capital bonus ×3` when `_empireX > 1`, or players won't know
the bonus exists.

---

## VERIFY BEFORE DEPLOY (headless, the pattern used all session)
```js
// seed 3 owned nodes with distinct capturedAt, then:
twCityNodeId()            // ⇒ the earliest-captured id
twNodeRank(otherId)       // ⇒ 'town'
twOwnedCount()            // ⇒ 3
twEmpireScore() > 0
// collect on the CITY ⇒ cinder ×3, every other resource unchanged
// collect on a TOWN   ⇒ everything ×1
// single-node player  ⇒ ×1 (no free bonus at 1 node)
```
Then: `node _synckcheck.mjs` → `node deploy.mjs` → curl the served build for the new symbols.

---

## NOT IN THIS PASS
4. City builder payout → Cinder bank + Base Vault (Node City iframe; make the two accessors
   explicit so it cannot double-credit).
5. Population-gated guard/civilian hiring + corruption defense (needs a balance pass on the
   numbers *before* code).
6–7. Player-to-player resource routes: new `node_routes` table + propose/accept/cancel RPCs (a
   trade agreement cannot live client-side or it is forgeable), then ride the EXISTING convoy
   trucks rather than a parallel loop. ⚠ The convoy check goes BEFORE the fuel gate.
