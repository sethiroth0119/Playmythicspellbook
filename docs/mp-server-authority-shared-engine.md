# Server-Authoritative MP via ONE Shared Battle Engine — design + plan

Status: **DESIGN LOCKED, extraction starting.** This is the roadmap for making the
Colyseus server authoritative over every battle action by running the SAME engine
the browser runs — no second engine to maintain, deterministic by construction,
and custom Forge cards work in MP for free.

All client line numbers are approximate (the single `public/index.html` shifts as
edits land) — re-grep the named functions before editing.

---

## Goal & non-negotiables

- **Server owns all actions.** Clients send INPUTS (play card X at pos, attack A→B,
  move U→pos, end turn). The server simulates with the shared engine and broadcasts
  authoritative state. No client-side simulation is trusted in MP.
- **ONE engine.** The battle core lives in a pure, synchronous JS module that BOTH
  the browser and the Node server import. No TS reimplementation, no drift.
- **Never destabilize single-player or the live Supabase MP path.** All new behavior
  is behind `USE_COLYSEUS_MP` (currently `false`, line ~33096) until verified.
- **Forge-safe.** The engine is data-driven (interprets card/move/effect DATA), so a
  single shared interpreter handles built-in AND custom cards. The server loads the
  published catalog for card/move defs.

## Why the client does NOT need its engine ripped out first

In MP, a server-authoritative client is a **thin input+render client** — it does not
run the resolver. Single-player keeps using the inline engine. So the sequence is:

1. Build the shared engine module (faithful extraction of the client core).
2. Server imports it → server-authoritative MP works behind the flag.
3. (Final, deferred) Migrate the client to load the SAME shared module for
   single-player too, deleting the inline copy → true single-source. This is the
   one risky client refactor, and it is done LAST, only after MP is proven.

Until step 3, the shared module is kept in sync with the client core by discipline +
a parity test harness. Step 3 removes that burden permanently.

---

## Engine boundary (from the extraction map)

### Pure / portable as-is (synchronous, no DOM)
- `calculateDamage(move, attacker, defender, weather)` — line ~59106
- `applyDamageTriggers(unit, dmg, type)` — line ~63218 (HP math pure; VFX via hook)
- `applyStatusEffect(unit, statusId, dur, src)` — line ~62993
- `drawCards(player, n, playSound?)` — line ~59599 (SFX via hook)
- `hasPassive` / `sideHasPassive` — line ~30637
- `getEffectiveMoveCost` — line ~30711; `getEffectiveCardCost` — line ~30750
- Catalogs (plain data): `STATUS_EFFECTS` (~27347), `PASSIVES` (~27511), `MOVES`
  (~28100), the type chart inside calculateDamage.

### Mostly pure — needs presentation/state injected
- `executeMove(state, attacker, target, move)` — line ~63578 (attack resolver; VFX
  `playMoveFx` is fire-and-forget, already decoupled)
- `_fireTriggers(state, event, ctx)` — line ~62376 (trigger bus; SFX/toast/summon
  via hooks)
- `startTurn(state, who)` — line ~65759 (calls tick helpers `_applyInGraveTick`,
  `_stabilizeTickBleeding`, `tickSurfaces`, … — port these as pure helpers)
- `executeKalonTransform(state, unit, opts)` — line ~63088 (needs card-def lookup hook)
- `getStatBonus(unit, statKey)` — line ~58979 (reads weather/persistentSpells/traps
  from state — pass these in, don't read `App.state`)
- `_resolveSpellAfterChain(card)` — line ~93963 (the SYNC spell body — extract as a
  pure `resolveSpell(state, card, ctx)`)

### Client-only (stay in index.html; NOT in the shared engine)
- `playSpell` (~93858) is **async** (`_runCounterChain`) — the interactive counter
  chain stays client-side; the server uses a deterministic resolve (no interactive
  counters in v1, or a server-driven counter window later).
- `playWeather` (~93822), `checkPostAction` (~94107) — UI/MP dispatch entry points.
- All `*Vfx`/`*Fx`, `renderBattle`, `showToast`, `playSfx`, `broadcastMyState`,
  `submitMatchResult`.

### The injected-presentation hook contract
The engine calls these only via `typeof hook === 'function'` (browser supplies real
ones; server supplies no-ops / data lookups):
```
onVfx(kind, payload)            onSound(id)            onToast(msg)
onLog(category, message)        getCardDef(cardId)     getKalonForm(unit)
getLocationStatAura(unit, stat) findInterceptor(state, target, attacker)
spawnSummon(state, caster, cardId, count)
```

### Async-removal pass
- The resolvers are synchronous except `playSpell`'s counter chain. The server NEVER
  calls `playSpell`; it calls the extracted sync `resolveSpell`. v1: no interactive
  counter chain server-side (deterministic). Counter-window-over-the-wire is a later
  enhancement.

---

## State shape (authoritative)
`state = { player, ai, units[], board, weather, activeLocation, persistentSpells[],
smokedTiles[], fieldElemMods[], turnNumber, log[], gameOver, mods, comboHits, ... }`
where each `player = { hand[], deck[], graveyard[], energy, maxEnergy,
kalonsRemaining, kalonLockedTurns, fatigue }` and each `unit` carries
`{id, owner, pos{x,y}, currentHp, maxHp, stats{atk,def,mag,res,spd}, statusEffects[],
passives[], hasMoved, hasAttacked, kalon flags, heldItem, ...}` (full list in the
extraction map). The shared engine operates ONLY on this object — never on `App.*`.

---

## Phased plan (each phase shippable + verified; SP never breaks)

**P0 — Module scaffold + parity harness.** Create `engine/` shared dir. Add a parity
harness that runs the same input through the client core and the shared module and
diffs the resulting state. Establishes the safety net before moving logic.

**P1 — Catalogs + pure helpers → shared.** Move `STATUS_EFFECTS`, `PASSIVES`,
`MOVES`, type chart, `calculateDamage`, `applyDamageTriggers`, `applyStatusEffect`,
`drawCards`, `hasPassive`, cost helpers into `engine/`. Server imports them (replacing
the hand-written `damage.ts`/`catalogs.ts`). Parity test green.

**P2 — Resolvers → shared.** Extract `executeMove`, `_fireTriggers`, `startTurn` (+
its tick helpers), `executeKalonTransform`, and a sync `resolveSpell` (from
`_resolveSpellAfterChain`). Hooks injected. Parity test covers attack, on-play
triggers, status ticks, kalon, spells.

**P3 — Server runs the engine authoritatively.** BattleRoom action handlers
(`playCard`, `attack`, `move`, `endTurn`) call the shared engine on the room's
`state`, then broadcast the new state (snapshot or schema delta). Deck/hand/draw
managed server-side from the joined decks. Win detection + `persistMatchWinner`
already exist.

**P4 — Client input+render in MP.** Behind `USE_COLYSEUS_MP`: card-play / attack /
move / end-turn sites send an INPUT message instead of simulating; the client renders
from the server's authoritative broadcast (reuse `_onRemoteStateArrived` /
`_onColyseusSnapshot`). VFX/animation play locally off the server result.

**P5 — Cutover + verify.** 2-client local harness (`colyseus-server/test`) for a full
match: coin flip → plays → attacks → statuses → kalon → spells → win. Then enable the
flag for a canary, watch, flip default.

**P6 — (Deferred) Client single-source.** Migrate single-player to load the SAME
shared module, delete the inline engine. Removes all dual-maintenance. Done last,
carefully, with the parity harness guarding every step.

---

## Module / build strategy for the single-file client
- The shared engine is authored as plain ES modules under `engine/` (so Node imports
  them directly).
- The browser client is one inline `<script>` in `index.html`. For P1–P5 the client
  keeps its inline engine for SINGLE-PLAYER and is a thin input+render client for MP,
  so no client module-loading change is required yet.
- P6 (deferred) introduces the build-inline step (concat `engine/` into the deployed
  `index.html`, or load via `<script type=module>`), guarded by the parity harness.

---

## Risks & mitigations
- **Desync (server vs client logic differ).** Mitigated by the parity harness (P0)
  and, ultimately, by P6 single-source. Every engine change runs the harness.
- **RNG determinism.** `calculateDamage` uses `Math.random`. For server authority the
  server is the only roller — clients render its results, so client RNG never
  diverges. (A seeded RNG in the shared engine is a nice-to-have for replays.)
- **Async counter chain.** Excluded from v1 server resolve; interactive counters stay
  client-only until a server counter-window is designed.
- **Live-path safety.** Everything behind `USE_COLYSEUS_MP`; Supabase remains the
  default and the fallback.

## Verification gates (must pass before flipping the default)
- [ ] Parity harness: identical end-state for attack / on-play / status-tick / kalon
      / spell across client core and shared module.
- [ ] 2-client harness: a full PvP match resolves identically on both clients with the
      server authoritative; no "died at full HP", no turn desync.
- [ ] Custom Forge card (unit with a custom on-play trigger) works in a server-auth
      match without any server-side per-card code.
- [ ] Single-player plays identically (unchanged) throughout.
