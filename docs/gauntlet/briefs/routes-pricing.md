# BRIEF — routes.js — hops, reach, the quote, and the Meridian Haulage ceiling

## GOAL
Write ONE new file, /home/user/Playmythicspellbook/public/src/transport/routes.js: pure, total route and pricing maths. Hop count between two nodes, whether a depot's radius reaches both endpoints, the tariff cap derived from the live median player tariff, the player quote (price, ETA, risk) and the Meridian Haulage NPC quote that is always available and always worse. No I/O, no async, no randomness, no clock-dependent branching, no bridge, no Supabase, nothing that can throw. This is the file that guarantees a shipper can never be left with zero carriers, and it must say so.

## FILES YOU OWN (write ONLY these)
- public/src/transport/routes.js

## ACCEPTANCE CRITERIA (a critic verifies each against your real output)
1. File exists at public/src/transport/routes.js; `node --check` passes. (Do NOT cite `node _synckcheck.mjs` on a .js path — it extracts inline <script> blocks from HTML only and prints ALL CLEAN on a .js file. False green.)
2. Exports exactly: PHASE, MERIDIAN, MERIDIAN_TARIFF_MULT, MERIDIAN_TIME_MULT, hops(fromId,toId,nodes), inReach(depot,fromId,toId,nodes), tariffCap(medianTariff), quote(input), meridianQuote(input), and (optionally) medianTariff(carriers).
3. MERIDIAN_TARIFF_MULT === 2.5 and MERIDIAN_TIME_MULT === 1.6 exactly, as named constants with a WHY comment, not inline literals and not tunables defaulting elsewhere.
4. meridianQuote() is derived from the LIVE median player tariff passed in, never from a hardcoded price. A fixed Meridian price is a fail.
5. meridianQuote() is strictly worse than any rational player quote on BOTH price and time, offers no escort and no illicit cargo class, and the file asserts this relationship in code (a guard that raises the Meridian price/time if the inputs would ever make it competitive) rather than merely claiming it in a comment.
6. meridianQuote() returns a usable quote for EVERY input, including: an empty carrier list, a zero/NaN/negative median, a blacklisted shipper, and a caller with no depot. There is no input for which the quote path returns null/undefined/throws. A comment states this as the design requirement — a shipper with zero carriers has had their game ended by another player's choice, and that must be impossible.
7. tariffCap() enforces the ceiling at the Meridian rate and is a pure function; a comment states that this is only the DISPLAY half and the binding cap is enforced server-side in transport_quote()/transport_dispatch(), naming that as the authority.
8. `export const PHASE = 1;` with the promotion criteria written beside it as a comment: Phase 2 (Hand-hauled: 35% cargo, +25 risk, 1.6× trip) ships at ≥3 active carriers; Phase 3 (long-haul 2+ hops requires a carrier, local 1-hop stays hand-haulable forever) at ≥5 carriers covering ≥80% of live node pairs. NO Phase 2 or 3 penalty is implemented or reachable in this file.
9. Every export is pure and total: no `await`, no `async`, no `fetch`, no `Math.random`, no `Date.now`-dependent result, no `.from(`, no `.rpc(`, no `window`/`document`/`Profile`/`Corp`/`Forge`, no throws. Grep-checkable.
10. hops() returns -1 (not null, not a throw) for unreachable or unknown ids, and the sentinel is documented. inReach() returns false for a null/absent depot rather than defaulting to true.
11. Absence has a designed value: a missing node list, a missing depot, a missing carrier list and a missing rig each resolve through ONE place that decides what 'no X' means, and that place is named in a comment.
12. A rejected alternative is recorded with an operational reason (e.g. why the cap is a hard ceiling rather than a max/min blend, or why Meridian is a ceiling rather than a bypass, or why reach is a hop radius rather than a distance).
13. Representation choices are justified: whichever unit tariff is stored in (Cinder per unit·hop) is stated, and the reason given is what the UI prints.
14. Sign/bounds are guarded — the risk figure is clamped to a stated range and a comment says what a sign flip here would do to a player.
15. No 'discord'/'webhook' anywhere including comments; no upload/FormData/storage.from(.

## CONTEXT
You are writing ONE new file: /home/user/Playmythicspellbook/public/src/transport/routes.js. You may write no other file. Served at /src/transport/routes.js.

WHAT IT IS FOR. Transportation Companies move other players' freight between map nodes for Cinder. A carrier's Freight Depot stands in one node (the origin) and has a `radius` in hops (reach). A shipper with cargo at node A wanted at node B picks a carrier whose depot reaches both, and sees a quote — price, ETA, risk — before committing. This file is all of that arithmetic and nothing else. It is deliberately the only file in the feature with no seams: it takes plain data in and returns plain data out, so it can be reasoned about and tested with no game present.

PINNED EXPORT CONTRACT — other builders are importing these right now; match names and arities exactly:
  export const PHASE = 1;
  export const MERIDIAN;                    // { id:'meridian', name:'Meridian Haulage', npc:true, … }
  export const MERIDIAN_TARIFF_MULT = 2.5;
  export const MERIDIAN_TIME_MULT  = 1.6;
  export function hops(fromId, toId, nodes)              // integer hop count, -1 if unreachable
  export function inReach(depot, fromId, toId, nodes)    // boolean
  export function tariffCap(medianTariff)                // number
  export function quote(input)                           // quote object
  export function meridianQuote(input)                   // quote object with carrierId 'meridian'
`nodes` is an array of `{ id, name, regionId, parentId?, resourceYield }` handed in by the caller (it comes from the bridge's twNodes(); you never fetch it). `depot` is `{ nodeId, level, radius, bays }`. `input` for quote/meridianQuote is `{ fromId, toId, nodes, carrier, rigCargo, rigSpeed, rigRisk, medianTariff, cargoUnits, escort }`. The quote object you return must contain at least: `{ carrierId, carrierName, price, capped, hops, tripMs, etaText, riskPct, meridian }`.

⚠ Node adjacency: this repo's node hierarchy (sql/033) is main/town with a city per node; `Profile.campNodeId` names the player's camp node and Territory Wars nodes carry `regionId`. You are given a flat array, so define your adjacency rule explicitly in a comment (e.g. same regionId = 1 hop, different region = 2, unknown = -1) and make it the single place the rule lives. Do not invent a graph structure the caller cannot supply.

═══ RATIFIED, SETTLED, NOT OPEN FOR RELITIGATION ═══
Meridian Haulage is the NPC fallback carrier and it exists to remove a monopolist's kill switch while keeping their power. The design doc, ratified by the owner:
  "NPC fallback: Meridian Haulage. Always available, deliberately bad — 2.5× the median player tariff, 1.6× trip time, no escort, no illicit freight. Meridian already dominates fuel in AI_CORP_RESOURCE, so it is the natural carrier. It is a price ceiling, not a bypass: a monopolist can charge 2.4× and get rich."
And the reasoning it replaces: "a sole carrier can set an infinite price or simply refuse to serve someone they are at war with — and that player's game is now over through no action of their own."
So: 2.5 and 1.6 exactly. Meridian must never be cheaper or faster than a rational player quote on any route — if it were, the player business would be pointless. And there must be no input, including a shipper blacklisted by every carrier and a build where sql/038 has not been pasted in yet, for which the quote path returns nothing. Do not argue the other side of this in a comment.
(Meridian is a real NPC corp already: `AI_CORP_RESOURCE` at index.html:219038. You cannot read it — it is a top-level const, see the globals trap below — so treat that only as the reason for the name.)

PHASE 1 ONLY. The gating ladder is phased and only Phase 1 ships:
  Phase 1 — Optional. Node→camp freight works exactly as today; hiring a carrier is a BONUS (bigger loads, lower risk, faster). Ships first because nothing can break.
  Phase 2 — Soft gate. Runs 'Hand-hauled': 35% cargo, +25 risk, 1.6× trip. Painful, never fatal. Ships at ≥3 active carriers.
  Phase 3 — Hard gate. Long-haul (2+ hops) requires a carrier; local 1-hop stays hand-haulable FOREVER. Ships at ≥5 carriers covering ≥80% of live node pairs.
The measured population when this was written was 22 players and 4 node owners, so Phase 2's precondition cannot be true on day one. Export `PHASE = 1`, write the promotion criteria beside it, and implement NO penalty. A player with no carrier must get exactly today's behaviour.
⚠ Phase 2's fallback is ALREADY NAMED in the live code: index.html:164244's `_garageRig()` returns `{ owned:false, name:'Hand-hauled', icon:'🧺', load:1, risk:0, speed:1, tier:0 }` from both the no-rig path and the catch. If you refer to the unhired case at all, use that exact label. Do not invent a parallel 'no carrier' name.

═══ THE BAR: what tiers.js does that you must match ═══
You are judged blind against /home/user/Playmythicspellbook/public/src/nodes/tiers.js. Read it. It is the cleanest small module in the repo and its properties are:
- The header declares up front which consumer is which and exactly what the module does and does not touch — its resource share is "added ON TOP… it never taxes a player's existing yield."
- The degradation contract is absolute and stated as a design REQUIREMENT, not an accident: "🔴 AND IT MUST DEGRADE TO NOTHING… An absent module must never change a payout. That is why every export is pure and total — no throws, no async, no I/O." Your equivalent: an absent transport module must never change what a player can already do, and an unreachable route must produce a refusal with a reason, never an exception.
- Absence is given a REAL VALUE, not null: "🆓 THE DEFAULT, AND IT IS LOAD-BEARING", funnelled through one `resolve()` "so there is exactly one place that decides what 'no node' means." Do the same for no-depot / no-carrier / no-nodes.
- A rejected alternative is recorded with the operational reason: the admin override wins outright rather than taking a max, because "an admin must be able to move a node DOWN as well as up (a refund, a chargeback, a correction). Taking the max here would make demotion impossible and would be the harder bug to find later." Record your own equivalent — the obvious one is why the tariff cap is a hard ceiling rather than a blend, and why Meridian is a ceiling rather than a bypass.
- Two input shapes are accepted on purpose "so one resolver serves both call sites instead of two that can disagree about a player's rate."
- Representation choices are justified (rate stored as a percent "because that is what the UI prints"; the +1 is named rather than inlined "because it is the one number most likely to be retuned").
- Omissions are documented rather than silently defaulted, and the sign is guarded because "a bug here that flipped the sign would quietly delete player output."

═══ HARD RULES ═══
- THE GLOBALS TRAP (CLAUDE.md, and it has already cost real time twice): Profile, Cloud, App, Corp, Forge, RESOURCES, AI_CORP_RESOURCE and every _tw*/_jb* helper are top-level `const`/function declarations in index.html — global LEXICAL bindings, NOT properties of window. `window.Profile` is undefined even though `const Profile` is right there. This file must reference none of them, with or without a `window.` prefix. It takes everything as arguments.
- CLAUDE.md: "All operation pricing goes through `_opEcon()`. Never hardcode economy numbers." OPS_ECON lives at index.html:79732 and the transport charter's startup/rate/salary numbers go there and only there. This file prices FREIGHT, not the business, and it must take the tariff sheet and the median as arguments so an admin retune reaches it.
- The binding cap is SERVER-SIDE. sql/038's transport_quote()/transport_dispatch() re-derive the price and clamp it against a config row; the client's number is display and instant feedback only. Say this in a comment — the same discipline CLAUDE.md records for chat, where the client keeps its profanity list "purely as instant feedback" and never as enforcement.
- Nothing may throw at import time; this file is loaded on every page load and a failure here would take a 223k-line app down with it.
- No npm dependencies, no bare-specifier or CDN imports; if you import at all it is a relative path ending in .js. This file should need none.
- Never write 'discord' or 'webhook', including in a comment — that decision is settled and a comment proposing it counts as re-proposing it. No image/video/upload anything.
- Do NOT touch, reference, wrap or gate `_convoyCanSend()` (index.html:66347). It is the player's own squad going out on scout/raid/deep-run/Covert Action. Gating it would let a monopolist stop other people from playing the game at all. Freight is freight; a squad is not cargo.
