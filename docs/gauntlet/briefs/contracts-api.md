# BRIEF — contracts.js — every Supabase call, guarded, with the spend/refund discipline

## GOAL
Write ONE new file, /home/user/Playmythicspellbook/public/src/transport/contracts.js: the single place in /src/transport that touches Supabase. Every export returns a typed envelope and never throws; a missing table is distinguished from an empty market; every documented RPC error code gets its own message and an unknown code says its code out loud rather than inventing a cause; and every path that spends Cinder verifies first, spends through the bridge's boolean-returning helpers, and hands back a refund closure so a later failure can still unwind. It must work — degraded, legibly, saying what is wrong — before sql/038 has been pasted into the Supabase editor, which is a window that will last days.

## FILES YOU OWN (write ONLY these)
- public/src/transport/contracts.js

## ACCEPTANCE CRITERIA (a critic verifies each against your real output)
1. File exists at public/src/transport/contracts.js; `node --check` passes. (Do NOT cite `node _synckcheck.mjs` on a .js path — it extracts inline <script> blocks from HTML only and prints ALL CLEAN. False green.)
2. Exports exactly: MISSING_RE, OFFLINE, fail(e), myCompany(), listCarriers(limit), listMyRigs(), listContracts(role), createCompany(name, homeNodeId), setTariff(tariff), registerRig(vehicleId, rarity, condition), dispatch(carrierId, rigId, fromNode, toNode, cargo), settle(contractId), repair(rigId).
3. A `client()` helper returns null (never throws) when the bridge is absent, when `b.cloud.client` is absent, or when not signed in. Every exported function begins `const c = client(); if (!c) return { ...OFFLINE, rows: [] };` (or the row-shaped equivalent) on the same path.
4. `MISSING_RE` exists and distinguishes 'the migration has not been run' from a real failure. A comment states, in the file's own words, that it must NEVER be used to decide the market is empty.
5. Every DB call checks BOTH `r.error` AND is wrapped in try/catch — supabase-js returns errors on the object but network failures throw. A call with only one of the two is a fail.
6. No exported function throws. `grep -n "throw " ` finds throws only inside a documented internal chokepoint (see the record()/refund pattern below), never escaping an export.
7. Every list-shaped export returns its empty collection alongside the flags: `{ ok:false, missing, offline, error, rows: [] }`. Callers never have to branch on failure to find the array.
8. Every RPC's documented error codes get their own message, and the unknown-code branch prints the code verbatim rather than guessing a cause. A comment cites the recorded failure: 'does not exist' does not mean the RPC is missing — it also fires when the function exists but a table inside it does not, and that branch told an admin to run a .sql file they had already run, four separate times.
9. Any path that debits the player verifies every leg BEFORE deducting anything, deducts in a justified order, records what was taken, and returns a `refund` closure ON SUCCESS so a later record-failure can also unwind. Refunds go through the bridge's `refundRes` (uncapped undo), never `addRes` (capped add), and the distinction is explained as a safety property.
10. Every bridge mutator return value is CHECKED. `grep` finds no `b.spendGems(` / `b.spendRes(` / `b.addGems(` / `b.save(` whose boolean result is discarded. A `false` from a persist call is converted into a failure the caller can act on, at one chokepoint, so the refund branch stays live code.
11. `grep -rn "wallet_credit" public/src/transport/contracts.js` returns 0. No caller-supplied amount, price, user id, runs_used, day_key or reliability is ever sent to an RPC — the RPCs take ids and re-derive. A comment says so.
12. `grep -n "Profile\\.gems" ` returns 0, and there is no raw arithmetic on any balance. Cinder moves only through `bridge().spendGems(n)` / `bridge().addGems(n, '<named reason>')`, and every addGems call carries a reason string.
13. `grep -nE "\\b(Profile|Cloud|App|Corp|Forge|RESOURCES|Operations|Catalog|showToast|gcConfirm)\\b" ` returns zero non-comment hits — everything arrives through `bridge()` from './transport.bridge.js'.
14. No `.from(` or `.rpc(` exists in any other file under public/src/transport (this file is the only one). A header comment states that rule: if a query lives somewhere else, that is the bug.
15. A rejected design is recorded: the existing P2P vehicle market is NOT extended to sell rigs cross-player, because `_vmCreditSeller` (index.html:195581-195589) is a documented no-op — a 'sale' destroys the buyer's Cinder and pays nobody — and `Forge.vehicleMarket` rides each player's own profile row so listings never leave the account that made them.
16. A header states the degradation contract explicitly: the tables do not exist until sql/038 is pasted into the Supabase editor by hand, and the app must stay usable before that.
17. No 'discord'/'webhook' anywhere including comments; no upload/FormData/createObjectURL/storage.from(.

## CONTEXT
You are writing ONE new file: /home/user/Playmythicspellbook/public/src/transport/contracts.js. You may write no other file. Served at /src/transport/contracts.js.

WHAT IT IS FOR. Transportation Companies move other players' freight for Cinder. This file is the ONLY place in /src/transport that touches Supabase: the rate board read, the carrier's own company and rigs, the contracts on both sides, and the four RPCs. It is also where money crosses a seam, which is why it is judged against the repo's money-discipline exemplar.

PINNED CONTRACT — other builders are importing these right now; match names and arities exactly:
  export const MISSING_RE, OFFLINE
  export function fail(e)
  export async function myCompany()
  export async function listCarriers(limit)
  export async function listMyRigs()
  export async function listContracts(role)          // 'carrier' | 'shipper'
  export async function createCompany(name, homeNodeId)
  export async function setTariff(tariff)            // tariff is a plain object → jsonb
  export async function registerRig(vehicleId, rarity, condition)
  export async function dispatch(carrierId, rigId, fromNode, toNode, cargo)
  export async function settle(contractId)
  export async function repair(rigId)
Every one returns an envelope: `{ ok, missing?, offline?, error?, rows?, row? }`.
You import `{ bridge, bridgeReady }` from './transport.bridge.js' and nothing else from the feature.

THE SERVER SIDE, being written in parallel as sql/038_transport_companies.sql:
  tables: transport_companies, transport_rigs, transport_contracts, transport_ledger (append-only), transport_config (single row, id=1)
  RPCs:   transport_quote, transport_dispatch, transport_settle, transport_repair — all SECURITY DEFINER, EXECUTE revoked from public/anon, granted to authenticated.
All four return `jsonb_build_object('ok', boolean, 'error', '<code>', …)` plus the numbers a client needs to write a sentence (cap, used, remaining, needed). They take IDS ONLY and re-read price, tariff, reach, bay count, driver count, fuel and the run budget from the rows — so never send a price, an amount, a user id, a runs_used or a day_key. Parameter names are snake_case with a `p_` prefix and match the JS object keys exactly: `c.rpc('transport_dispatch', { p_carrier_id, p_rig_id, p_from_node, p_to_node, p_cargo })`.
⚠ The rig's runs/day counter and its day_key are SERVER-AUTHORITATIVE and computed from the database clock inside transport_dispatch(). The client's `bridge().todayKey()` (index.html:71039's getTodayKey(), local device time, no anchor) is optimistic display only. Same reasoning that moved world chat to the chat_send() RPC in v120g0.

═══ THE GUARDED-SUPABASE IDIOM — copy this skeleton ═══
From /home/user/Playmythicspellbook/public/src/community/community.api.js, which states the contract in its own header: "⚠ EVERY call degrades. The tables do not exist until sql/001..003 are run in the Supabase editor, and the app must stay usable before that. So no call here ever throws at its caller: it returns empty data plus a `missing` flag, and the UI says 'not set up yet' instead of breaking the hub. This mirrors how Corp.* already behaves." And: "Nothing else in /src/community touches the client. If a query lives somewhere else, that is the bug."
  const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache/i;
  function client() {
    const b = bridge();
    try { if (!b || !b.cloud || !b.cloud.client) return null; if (!b.signedIn()) return null; return b.cloud.client; }
    catch (e) { return null; }
  }
  function fail(e) { const msg = (e && (e.message || e.msg)) || String(e || ''); return { ok:false, missing: MISSING_RE.test(msg), error: msg }; }
  const OFFLINE = { ok:false, missing:false, offline:true, error:'not signed in' };
  export async function listCommunities(limit = 60) {
    const c = client(); if (!c) return { ...OFFLINE, rows: [] };
    try {
      const r = await c.from('communities').select('…').order('created_at',{ascending:false}).limit(limit);
      if (r.error) return { ...fail(r.error), rows: [] };
      return { ok: true, rows: r.data || [] };
    } catch (e) { return { ...fail(e), rows: [] }; }
  }
The three error families are distinct and mean different things: missing TABLE = PGRST205 / 42P01 / 'relation … does not exist'; missing FUNCTION = PGRST202 / 42883 / 'Could not find the function' / 'schema cache'; missing COLUMN = 42703 / PGRST204. index.html:55405-55411 carries the rule in a comment on its own version of this regex: it "must NEVER be used to decide that the market is empty."

🔴 THE MESSAGE TRAP, recorded in the live code at index.html:79921-79926 after four wasted debugging sessions: "'does not exist' does NOT mean the RPC is missing. It also fires when the function EXISTS but a table INSIDE it does not… so this branch told the admin to run a .sql file they had already run, four separate times. Name the real error instead of guessing at a cause." And sql/037:16-23 is the same lesson from the other side — an unhandled error code fell through to a generic 'nothing moved' message that hid a hard crash for the entire life of the feature. So: branch on the specific signal first (a named missing dependency), then PGRST202-style genuinely-absent-RPC, then fall through to showing the error text verbatim, trimmed. Every `{ok:false, error:'<code>'}` your RPCs can return gets its own message, and the unknown-code arm says the code out loud.

═══ THE BAR: what cost.js does that you must match ═══
You are judged blind against /home/user/Playmythicspellbook/public/src/city/cost.js. Read it. Four things put it at the ceiling and each has an analogue here:
1. THE ATOMIC SPEND. `spendCost(host, cost, opts)` verifies EVERY leg with a human message before touching a balance, then deducts resources first and Cinder LAST, with the order justified: "Cinder is the leg that can fail for reasons outside this function (a concurrent tab, a server wallet reconcile)… unwinding N resource legs is cheaper and safer than unwinding a Cinder spend that has already fired a cloud write-through." On SUCCESS it returns `{ ok:true, refund }` — handing the closure back "means that path can unwind too" when the caller fails while RECORDING the purchase. Your dispatch path is exactly this: verify the shipper can pay and the fuel is there, spend, call the RPC, and unwind on a failed write.
2. THE REFUND BUG, named and measured (cost.js:147-155): "🔴 REFUND USES host.refundRes, NOT host.addRes. addRes enforces the stash cap and returns WITHOUT ADDING when the vault is full… A driven test caught exactly that: 95 metal and 70 supplies deducted, 'refunded', and gone. A refund is an UNDO of units the player held moments ago, so it must bypass the ceiling. Unwound in reverse so the ledger retraces its steps." The transport bridge exposes both `refundRes` (uncapped undo) and `addRes` (capped payout). Use the right one and say why.
3. FAILURE IS REPORTED, NOT SWALLOWED. /src/city/index.js:63-74: "🔴 THESE TWO REPORT FAILURE. THEY USED TO SWALLOW IT. `setState: (s) => { try { B.setProdState(s); } catch (e) {} }` made build()'s refund-on-record-failure branch unreachable: a throw from setProdState or saveProfile died here, build() returned {ok:true}, and the player was charged 50,000 Cinder for a building that never persisted." And production.state.js's chokepoint: `function record(host, s) { if (host.setState(s) === false) throw new Error('setState refused'); if (host.save() === false) throw new Error('save refused'); }` — a `false` from the seam is converted into a throw at ONE place, precisely so the caller's refund path stays live. Do the same: one internal chokepoint that turns a false persist into a failure, caught inside your export so nothing escapes to the caller.
4. TEST SEAMS THAT CANNOT LEAK. cost.js's `simulateFailAt` "is a parameter rather than a global switch so no production call site can set it." If you add a fault-injection seam, make it a parameter.

═══ THE MONEY RULES (CLAUDE.md, non-negotiable) ═══
- "Currency: Cinder is `Profile.gems`. Use `spendGems()` / `addGems()`, never mutate directly." You cannot see Profile anyway (globals trap), so route everything through `bridge().spendGems(n)` and `bridge().addGems(n, 'transport_<something>')`. The reason string is not optional: index.html:64445-64452 records that every Cinder faucet used to land in wallet_ledger as an anonymous blob, "so the Cinder supply could not be audited: production shows +602,357 🔥 of reconcile gains in one week with nothing attributing a single unit of it to a source. A named reason per faucet is the prerequisite for ever noticing abuse."
- ⚠ There is a live counter-example NEXT DOOR that you must not copy. index.html:196020 (`ppBuyVehicle`) charges with `Profile.gems = (Profile.gems | 0) - v.price;` — a raw mutation that bypasses spendGems. index.html:195546-195549 documents the sibling bug: a misspelled `spendCinderS` "ALWAYS took the raw-subtraction fallback below and bypassed the real spend path (and with it whatever spendGems does about persistence and tax exemption)."
- The confirm-then-spend-then-unwind shape is `corpTreasuryDeposit()` at index.html:79679-79699: gcConfirm → spendGems (return value checked) → insert → on failure `addGems(amount)` + saveProfile + a toast that names the real error. Mirror it, using `bridge().confirm(...)` and `bridge().toast(...)`.
- `wallet_credit` is being revoked from `authenticated` as an open work item — it is the last client-controlled money path. A new caller re-blocks that revoke. Do not call it.
- Ledgers are append-only. Balance = sum(amount). Never UPDATE a balance column, never send a computed balance, and never derive reliability client-side and write it back — it is `delivered / (delivered + late + refused + lost)` recomputed from contract rows, server-side.

═══ OTHER HARD RULES ═══
- THE GLOBALS TRAP: Profile, Cloud, App, Corp, Forge, RESOURCES, Operations, showToast, gcConfirm and every _pp*/_vm*/_op* helper are top-level `const`/function declarations in index.html — lexical bindings, NOT window properties. `window.Profile` is undefined. Everything arrives through `bridge()`.
- Nothing may throw at import time.
- No npm dependencies; no bare-specifier or CDN imports; the only import is `./transport.bridge.js`.
- Never write 'discord' or 'webhook' anywhere including comments — settled, and a comment proposing it counts as re-proposing it. No outbound HTTP to anything but Supabase. No image/video upload, no FormData, no storage bucket.
- Do not build a cross-player rig market on the existing P2P vehicle market. `_vmCreditSeller` (index.html:195581-195589) is `if (sellerId === _vmMyId() …) addCinders(amount); // TODO: Supabase RPC for true cross-player credit.` — no Cinder ever reaches a seller, and `Forge.vehicleMarket` rides each player's own `user_profiles.forge` row, so listings never leave the account that made them. Record this as the rejected design it is.
