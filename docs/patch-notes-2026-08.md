# Mythic Spellbook — Patch Notes

## Builds v119r8 → v120w6 · 30 July – 13 August 2026

The largest run of changes the game has had. Four brand-new systems (Communities,
the Crafting Station, player-owned banks and the Node hierarchy), two new card
types, a real supply chain underneath the whole economy, and a long list of fixes
to saves, wallets and vaults that were quietly costing players things they had
paid for.

---

## Headlines

- **Communities** — a civic layer above corporations, with binding votes, announcements, shared objectives and a reward pot.
- **Enchantments and Curses** — two new card types. Permanents that stay on the field and keep working.
- **Trigger Chains** — when several effects fire at once they now form a visible chain, and when they are all yours, *you* choose the order.
- **The Crafting Station** — salvage spare furniture into Craft Parts, then build booster packs, boxes, sleeves and dice skins.
- **Player-owned banks** — charter a bank, design your own loan products, and run the underwriting desk.
- **The Node hierarchy** — one capital, the rest towns. Towns feed the capital, and every node now has its own city.
- **A supply chain** — businesses consume what other businesses produce. Fuel and metal are load-bearing now.
- **Your account is safer** — a save bug that was wiping players who changed devices has been found and killed.

---

## ⚔ Battle

### New card types

- **Enchantment** — a permanent that stays on the field and keeps working. Unlike Location and Weather (one slot each), **any number of Enchantments can be out at once**, and each projects its auras until it is removed. They still cost energy, can still be negated, and can carry a one-shot arrival effect alongside their continuous auras. Eleven cards authored, including three **Enchantment Units** — living permanents that hold the field while projecting an aura.
- **Curse** — an Enchantment hung on the *opponent*. Curses can target the enemy hero, an enemy unit, or the whole enemy board, and carry a release condition so every curse has an exit.

### Trigger Chains

- Several effects firing off the same event now form **one visible chain** — LINK 1 / LINK 2 / LINK 3, with real card art — and resolve last-in-first-out.
- **Choose your trigger order.** When every link in the chain is yours, you order them yourself. The enemy's triggers are never yours to order. There's an AUTO button and a 20-second deadline, and clicking a picked card un-picks it and everything after it, so a misclick costs one click.
- **⚡ Energy Surge** — the connector between links is an animated gold beam with a charge travelling along it, and each link pulses as the charge lands. Honours reduced-motion settings.

### Rules and combat

- **Hand limit of 7.** You may hold more than seven cards *during* your turn, but you cannot **end** your turn over the limit — and **you** choose what goes. The AI plays by the same rule and pitches its cheapest cards. Both hand counters now read `/7` and turn amber when you're over. (If the turn timer force-ends your turn, the discard is automatic — a picker you can't answer would hang the match.)
- **Corrupted** — a new status. A Corrupted unit can only attack *allied* units, and must attack.
- **Born Ascended** — a passive that lets a base unit count as a Kalon at all times without ever transforming. It gets the Kalon buffs, and it is a legal target for "destroy all Kalons" effects. That counterplay is the point.
- **Global targeting** — the radius clamp has been lifted.
- **Absorption Kalon** — many forms on one base.
- **Milled cards now trigger.** A card milled out of your deck fires its full "when this is sent to the graveyard" effect, exactly like one that died on the board. This is the entire engine behind send-to-graveyard archetypes, and it had never worked.
- **Alternate play costs** can now be paid from your **hand**, or from hand and graveyard as one pool. Plus Sacrifice Self, a Card Filter on Summon From Zone, and a summon-zone picker in every ability editor.
- **Spells and traps get the full effect engine** — every effect a unit could use is now available to them, and self-damage effects correctly hit your own hero.
- **Every card type now charges the same play costs.** A rejected play no longer eats its discard cost.
- **Face-down cards** — a new Set Face-Down effect, face-down flips now fire their effect instead of fizzling, and enemy set cards are visible on the board.
- **Counters** — counters can now be filtered by effect category (`counterScope`), plus punish counters and counter redirection.
- **Multiplayer Verdict.** When you cast a Verdict card in multiplayer, the ruling now goes to the **human opponent** instead of running the AI's heuristic on their behalf. If they don't answer within 20 seconds it falls back to the AI so the turn can never hang.
- **New effect building blocks** — Burn on Activation, Buff Per Card, Summon Lock, "for EACH named card in the graveyard", and one general "…FOR EACH matching card" modifier that works with every effect.
- **Weather and day/night effects** now drive card behaviour.

### Battle fixes

- 🐛 **Debuff auras were completely dead.** Negative auras never applied to anything. Fixed.
- 🐛 **Player-side silence and root were never applied.** Fixed.
- 🐛 **Archmage never discounted a single spell** — and behind it, a shadowed function was silently killing *every* cost discount in the game.
- 🐛 The AI can now **pay alternate costs** on spells, traps and weather. Previously it declined every non-unit alternate-cost card outright, so it could never use an archetype's alt-cost cards at all.
- 🐛 **Graveyard duplicates** — a corpse and its own card were both being listed.
- 🐛 The board **flickered on every click and every loot drop**. Fixed.
- 🐛 **Cinematics could show a white screen**, and the weather system could white out the board. Both fixed.
- 🐛 The **Mimic Beacon** was broken and has been removed.

---

## 🧬 Units, Traits and Decks

### Temperament

Every unit already had a nature (what it's good at), a value profile (what it approves of), and a bond (how much it trusts you). **Temperament is the fourth layer: *how* a unit forms that trust, plus one distinguishing quirk.** Two units can share a nature and a value profile and still feel nothing alike.

Eight temperaments, each with a different bonding curve:

| Temperament | Quirk |
|---|---|
| **Stoic** | Never suffers on the bench |
| **Ardent** | Burns bright on a kill |
| **Guarded** | Gains nothing for three battles, then opens up |
| **Vain** | Spotlight bonus, heavy fall penalty |
| **Devout** | Will never refuse to deploy |
| **Grim** | Hardens instead of grieving when an ally falls |
| **Kindly** | A win lifts every unit beside it |
| **Restless** | Bench hurts double, back-to-back fights reward |

Temperament is **derived from the card**, not rolled — every player meets the same unit with the same temperament, so it's a knowable property rather than a slot-machine pull. It shows on every unit surface and in the Deck Builder.

### Shared history and Rapport

- **Shared history** — units now log real milestones: first battle, 10 / 25 / 50 / 100 battles together, first kill, 25 kills, a last stand, each tier gained, sold, bought back, and surviving where others did not.
- **Rapport** — units now bond with *each other*, which loyalty never covered. Fighting and winning together builds it; surviving together builds it faster. Past the threshold, the pair gets **+2 ATK / +2 DEF when deployed side by side**.

### Faction Concord

A deck cohesion layer. Twenty factions rated across six tiers — **sworn, warm, neutral, wary, hostile, feud** — and a deck score computed from how your factions actually feel about each other, with a band and a breakdown of *which pairs* are helping or hurting.

- 20 warrior + 20 mage scores **+15 (Sworn Company)**. 20 goblinoid + 20 fairy scores **−35 (At War With Itself)**.
- Mono-faction decks score neutral — a pure warrior deck is not a Sworn Company. The system rewards thoughtful multi-faction building.
- Dragonkin is wary of everything it has no explicit stance toward. A dragon deck wants to be mono, and that's deliberate.
- There's a **Faction Concord page in the Codex** so you can read the whole relationship table.

### Conditional traits

Ten new traits that **read the world** rather than baking a flat stat bonus at build time — evaluated live on every stat read:

**Sunlit · Nocturne · Stormborn · Dry Ground · Cornered · Rearguard · Outcast · Oathkeeper · Vanguard · Glass Blade**

They key off real state: time of day, weather, whether you're indoors, how many enemies are adjacent, whether any enemy is within 3, whether you have faction kin nearby, and whether you're the furthest-forward unit on the board. Trait count goes from 24 to 33.

### Deck building

- **Owned / not-owned filters** in the deck editor.
- 🐛 The deck list **no longer jumps to the top** every time you add or remove a card.
- **Draft cards** — new cards now stay invisible to players until they're deliberately released, so cards still being tested and still waiting on art can't go live by accident.
- Card sets are **published as downloadable JSON** on the game origin.

---

## 🏛 Communities — brand new

Corporations hold ground. **Communities hold corporations together.** Everything on a community's standings board is derived from systems that already exist in the game — territory held, contributions made, real activity.

**Founding a community requires owning a corporation.** Being a *member* of someone else's corp doesn't qualify; only its founder. If you don't have one, the app tells you what you need and where to get it rather than showing you a form it will refuse.

### The hub

The Guild Wire *is* the Community hub now. Nine tabs, with the Wire first and default:

**Wire · Standings · Announcements · Votes · Objectives · Members · Corporations · Contributions · Rewards**

### What's in it

- **📣 Announcements** — leadership posts, every member reads.
- **🗳 Votes that actually change game state.** Closing a vote *writes the winner onto the community* and the game reads it. Two binding kinds: **war target** sets the node the community pushes on, and **levy** sets the cut the community keeps from reward distributions (fixed rungs: 0 / 5 / 10 / 20%). Advisory votes are offered too, and the UI says plainly that they change nothing on their own. One member, one ballot; the tally is computed from the ballots and is readable community-wide, so anyone can audit it.
- **🎯 Objectives** point at real Territory Wars nodes. "Held" is read live from the war on every render, so it can never drift from the real map.
- **💰 Rewards** distribute from the community ledger by contribution share, and are **claimed** rather than pushed. Nothing here can reach into another player's wallet.
- **Live everything.** The wire, announcements, votes and payouts now arrive **without a reload**, with typing indicators on the wire.
- **Notifications** name the community first — "Ashfall Compact · A vote is open" — because "new announcement" tells a player in four communities nothing. You are never notified for your own action.

### Community owners earn

- **100 Cinder** for each member who joins from a new address, and **10 Cinder** per member who talks on the wire (at most once per 5 hours). Both paid to the owner, through the gift inbox, with a Claim button.
- An owner earns **nothing** from their own joining or talking, and spamming the wire earns nobody anything extra.
- The Rewards tab shows owners what their community earned them and why.

### Chat and org vault

- **World chat now posts through the server.** Server-side profanity filtering, a server-side rate limit and a 500-character cap. The client can no longer write chat directly.
- **The Guild Wire is server-only too** — nothing but the server can post to it.
- **Org vault** — any member can withdraw, every move is logged, and members can trade with each other.

---

## 🔔 Notifications

- **Web Push.** Announcements, open votes and payouts can now reach your phone **with the game closed**, not just with a tab open in the background.
- Notifications carry the community name so they're actionable from a lock screen, and repeat events replace rather than stack, so ten events aren't ten things to dismiss.
- Permission is asked by a **button that says what it will do**, never by a prompt on load.

---

## 🏙 Node City

### Thirteen new buildings

**Restaurant · Food Truck · Grocery · Club · Streetlight · Motor Pool · Fire Station · Smelter · Cannery · Warehouse · Power Station · Machine Shop · Clinic** — shipped together with the demand economy behind them.

### The city is alive

- **Civilian traffic.** Saloons, hatchbacks, taxis and SUVs now drive your streets. Four vehicle classes had been built and were unable to appear in play; they're scaled off housing, so a residential city gets real street life.
- **Hover on any placed building** to read its live output, crew, wear, socketed card and all three adjacency bonuses.

### Performance — the freeze is gone

- 🐛 **Opening a big city froze the game.** A full 24×24 city builds 5,482 meshes, and it was doing all of them in one uninterrupted block — the tab couldn't paint or accept input for the whole run, so the browser went white and the OS offered to kill the page. **It scaled with city size, so it hit the players who had built the most, hardest.** The load now yields every grid row.
- The quality governor was **discarding exactly the stall frames** that represent the freezing players actually report. It sees them now.
- Citizens were the most expensive thing on the field — in a 60-agent crowd, 41 civilians cost more than three times what 19 vehicles did. Rebuilt to share materials, so bigger crowds cost far less.

### City management

- **Repairs card.** After a siege or a fire-rain storm the damage is scattered across a 24×24 map. Every damaged building is now listed with its cost and tile, **cheapest first**, with a per-row button and **Repair ALL**. If the ledger runs dry mid-sweep it stops and tells you how many are still down.
- **Road limits.** Roads are cheap and buff every neighbour, so the optimal play was to pave the map. Roads now answer to a **maintenance cap** — base 40, **+10 per Supply Depot**, **+8 per road-linked Convoy anchor** — shown where roads are bought, on the road tile in the inspector, and in the needs panel at 85%. Existing roads over the cap are never removed; the limit only blocks new placement.
- **A real city log.** Toasts vanish in four seconds, so a raid that landed while you were in the build shop left no trace. Raids now log the **defence breakdown** behind the single number (static / soldiers / cards), the ammo shortfall and what it cost, the **itemised loot**, and which anchor was overrun against the soldier defence it needed. Weather logs what the front actually does to production. Filter chips split raids from weather, and the last 40 lines are saved with your city.
- **The city can bank**, and the city ledger **holds earnings while the manager connects** instead of dropping them.
- **Autosave** every 60 seconds, plus a flush when you leave the page.

### The Financial District

The retired Cinder Forge is back — as a **financial district**. Buildings that lift your Cinder earners, invest a slice of the takings across invented firms and **other players' PRN nodes**, and settle every 72 hours with real gains and **real losses**.

Three risk tiers:

| Tier | Range | Mean | Losing cycles |
|---|---|---|---|
| **Conservative** | −10% … +35% | +13.8% | 2.7% |
| **Balanced** | −35% … +80% | +18.8% | 16.5% |

This is not the old Forge. The old one minted currency out of fuel and metal with no customer, which is how one player reached ~16,000,000 🔥/day. These buildings generate nothing on their own — they only move money that the city actually earned.

### City fixes and balance

- 🐛 **Storms were out-damaging Fire Rain by 2.3×.** Storm frequency was never the problem — a storm is supposed to be a *production modifier* (farms and outdoor work slow down) with lightning as flavour, and it was behaving like the worst destroyer in the game. Rebalanced to what it says it does.
- 🐛 **Producers now idle when the vault is full.** Eight farms and no Cannery banked ~45 food/minute regardless of how much the population ate — and everything over the cap was **silently discarded on arrival** while "STASH FULL" spammed and food crowded every other resource out of a shared cap.
- **Food balance** — demand now scales with the same multiplier that supply already enjoyed.
- **Node seam ×3.** A node advertises what it is — "PRN — FUEL PRODUCTION" — and the city on top of it produced fuel at exactly the same rate as anyone else's. A city now starts with **×3 on the resource its own node produces**, so specialising is the obvious play. The buff lands on the payout *and* on every rate preview in the UI.
- **Two missing resources** added, and **Cinder finally shows its production** in the city.
- The **city tier pill** now says FREE only when you're actually on a free camp.
- 🐛 Node City **white screen** on load — fixed.

### Coming: the resource chain

A **258-entry industrial catalogue** has been added behind the scenes — 26 categories, 60 raw / 98 intermediate / 100 finished goods — as the supply chain the city builder will run on. **Nothing reads it yet, and that's deliberate:** a resource you can loot and be capped by but cannot sell, spend, make or see is worse than a missing one. Each resource goes live *with* its producer, one at a time.

Groundwork that's live now: the **stash cap floor scales with the number of resource kinds**, so collecting broadly will never get you trimmed as the catalogue rolls out.

---

## 🗺 Nodes, Territory and the District Map

### The Node hierarchy

- **One capital, the rest towns.** A new **🏛 Make capital** control in the node drawer (owner only — a mayor runs a city, they don't choose your capital).
- **Towns feed the capital.** Your capital's accrual scales with the **tier of every town you own**, on the same Free → Eternal ladder that already decides a node's share. Capped at +60%. Three Eternal towns is +21%. Towns aren't lesser copies of the capital; they're what makes having one worth it.
- **Capital and town badges** are visible to everyone.
- **Every node has its own city.** City saves are now node-scoped, so opening a town loads and saves *that town's* city.

### Empire

- **City vs Town** derived from earliest capture, plus an **empire score and five tiers**.
- **Capital Cinder multiplier** — city yield × nodes owned.
- An **owner-only green surge** on the map, computed on your own device so it can never leak who owns what.
- **Node Power scales with dollars** — **+100 Power per $10** for owners, **+25 per $10** for players. A $50 owner purchase is 500 Power, exactly one node level.
- **Node owners are past every Ruin Exchange gate.**

### AI corporations on the map

- **Six AI rivals** now appear on the district map, each with an icon, a colour, a temperament and a plain-language dossier. They're placed below the node markers so a corp badge can never intercept a click meant for a node, and every one carries an explicit AI tag so it's never mistaken for another player's holding.
- **Player standing** — seven tiers from **Allied** to **Blacklisted**, derived from live world state. Nodes held and camp registration lift it with everyone; then each corp reads a resource it actually cares about. The Trust and the Vein are mutually exclusive — corrupted essence pleases one and costs you the other.
- **Startups** and a real **dossier drawer**.
- 🐛 The corp pins are **actually clickable** now, and the node hover card no longer covers them.

### Trading with the AI corps

Two ways to do business, deliberately different in commitment:

- **Spot trade** — one sale per corp per day. They buy the resource they deal in at a price bent by your standing (the same ±15% band the market already uses), worth **+2 rep**. The offer rotates daily and every player sees the same one.
- **Supply contract** — "enter business". Three timed deliveries, better per-unit than spot, 24 hours per run. Each delivery is **+5 rep**, and seeing the whole thing through is **+8 more**, because finishing should be worth more than the sum of the runs. Signing is gated on having the *first* delivery, not the whole run.
- **Missing a window is the point.** An overdue contract is torn up and costs **12 standing** — and that check runs whenever you come back, not only if you happen to open that one drawer.

### Convoys and logistics

- **Real convoys.** The Logistics screen is wired to actual freight, and the trucks on the map haul real cargo.
- **Rigs now haul** — the Garage is wired into the convoy engine.
- The convoy cap now covers **every** outbound run, including rescues and rival raids.

### Mayors

- 🐛 **Mayors manage the owner's city, not their own.** Node managers spend the **owner's** ledger, not theirs.
- 🐛 **Your own city is yours again** — a shared local cache was crossing them over.
- 🐛 **Mayors were locked out** of cities they'd been hired to run. Fixed.

---

## 🏦 Banking

### Player-owned banks

Charter your own bank. Cinder never moves on the client — the **30% reserve requirement** and per-teller approval ceilings are enforced server-side.

- **The Office of the Mint** — tier cards, a burn-vs-stake split bar, an over-stake slider driving deposit capacity and seals, an acknowledgement gate, a medallion, and a sale listing.
- **The Underwriting Desk** — an in-tray, dossiers in four sections, collateral haircuts, an ember dial, and approve / counter / deny with a seal and a receipt. It opens for the **owner and for tellers**, which is how hiring feeds the desk.
- **Charter ladder** — 2,000 / 7,500 / 21,000 MT staked. Tier 1 burns nothing, so the advertised price is exactly what leaves your wallet. Cinder is *spent*; MT is *staked*, and the stake settles before the bank exists so a failed stake can never leave you owning a bank you didn't pay for.
- **Bank Row** — the public directory.
- **Hire Bank Tellers** from your guild, in Guild & Hiring — and the hire actually staffs the desk.
- A bank earns **interest, not resources**, so it never feeds the commodity market.

### The Bank Back Office

Bank owners now build their own **loan products** — standing offers on their bank's rate board.

- The builder covers name, structure, currency, min/max principal, rate, term, minimum Ember score, concurrent-loan cap, accepted collateral classes and a note, with a live **"as borrowers will see it"** preview including a worked 100k example at the effective advance rate.
- **Currency ceilings tighten as the money hardens:**

| Currency | Max rate | Max LTV | Max term | Requires |
|---|---|---|---|---|
| Cinder | 5% | 100% | 30 days | — |
| Aza | 3.5% | 75% | 21 days | Charter II |
| Mythic | 3% | 60% | 14 days | Charter III |

- **Collateral policy** — per-class haircut and max LTV, with the reason stated: real estate recovers best, cards worst. Bound and untradeable items are never eligible; if you can't sell it after a default, it isn't security.
- **Bank identity** — sigil, name, motto, and a live Registry preview.

### Bank of Ethos

- **A statement you can actually read.** Every market sale, purchase and listing had always been recorded — there was just no way to see it. Now: **All / Market / Bank filter chips**, depth raised from 10 rows to **40**, and a **sales rollup in the header** ("you sold 6 things for 12,400").
- **Token & Blockchain disclaimer** shown before wallet linking.
- 🐛 **The exchange counter had never worked once.** Fixed.
- 🐛 **Withdrawals were minting Cinder.** Fixed.
- 🐛 **Cinder was accumulating in the wrong server table.** Fixed.
- 🐛 A **Cinder-bought bank was never actually chartered**. Fixed.
- 🐛 Transfers were being **double-logged**, and 77 duplicate ledger rows have been cleaned up.
- 🐛 The bank was broken behind a table that had never existed, and the bank door / nav chain has been repaired.
- **Money moved server-side.** Bank of Ethos transfers and **Aza** — the real-money currency — are now settled atomically on the server.

---

## 🏭 Business, Operations and the Economy

### The supply chain

Before this, every business produced from nothing. Mining and construction were unrelated islands and no operation depended on any other. The economy is now **two-tier**:

- **Primary extractors** — mining, oil, agriculture, salvage, gas — have no inputs. They're where matter enters the world, alongside node resource yield.
- **Secondary industry** consumes it — **construction and fishing burn fuel, cars burn metal and fuel, research burns metal and fuel, medical burns food, smuggling burns fuel**.

**It throttles, it doesn't stall.** Hold half the fuel a run needs and the operation runs at **half**, visibly, so you can go solve it. An operation that silently produced nothing would just read as broken. Wages are **not** throttled — pay is owed whether or not the supply line held.

This makes fuel and metal load-bearing across the whole economy instead of being sellable numbers, and it wires node output directly into business viability. The supply chain is surfaced in the Operations UI.

### The live market

- **Business gross now tracks what its output is actually worth**, in a 0.5× – 2.2× band. Salaries are not scaled, so **glutting your own output actually hurts**.
- Rarity is derived from base price, so rare goods are more fragile — their price assumes scarcity.
- A 24-hour inflow at 3× normal flow trips a **glut crash**, with a tape entry explaining why.
- 🐛 Cards were priced at a flat 100 each regardless of rarity. Now priced by rarity.

### The Genetics Lab and the DNA Lab

- **New business: the Genetics Lab.** It yields **DNA** — 2.0 per worker-hour across 8 staff, so 16/hour.
- **DNA Lab cloning is now priced by rarity:** common 180 · uncommon 300 · rare 600 · epic 900 · legendary 1200 · mythic 3600. At the old prices a single Memory Transfer bought a common outright, so cloning wasn't a sink, it was a formality.
- **Cloning now requires owning a Genetics Lab.** The gating business is also the source: a common clone is about **11 hours** of a running lab, a mythic about **9 days**.

### Economy fixes — currency that was being minted from nothing

- 🐛 **The car dealership NPC buyer queue has been removed.** It was a Cinder faucet, and NPCs now pay **market value**, which kills the buy-low/flip-to-NPC loop.
- 🐛 **Camp Workshop now pays in resources, never currency.** Two projects were straight alchemy — Memory Transfer turned 8 Memory Shards into Aza, and Forbidden Refinement turned 6 Corrupted Essence into 120 Cinder. Aza is bought with real money; that one was worse than an economy bug.
- 🐛 **Fuel no longer claims to affect price** — it hasn't for a while, and the UI was still saying so.
- 🐛 **Base Construction** — a blank cost override no longer makes an upgrade resource-free.
- 🐛 **A refused business purchase no longer takes your Cinder.**
- **Foundation Tax removed.**
- **The Crafting Station now runs on looted resources**, not furniture salvage.

### Admin economy tools

Every economy number is now **authored, not hardcoded** — a generic economy tuner, an Operations business editor, a crafting recipe editor, and full editability for the fishing fleet, the reclaim board and Black River.

---

## 🔨 Crafting, Cosmetics and the Shop

### The Crafting Station

Its own screen off the Card Shop tab strip, with three benches:

- **SALVAGE** breaks spare furniture down into 🔩 **Craft Parts**.
- **CRAFT** turns parts into **booster packs (30)**, **booster boxes (210 for 8 — cheaper per pack)**, **card sleeves (120)** and **dice skins (150)**.
- **LOADOUT** equips what you made.

Parts are deliberately a **separate currency** and only flow one way: furniture → parts → product. Salvage yield scales with what the piece cost but returns well under it — it's for spares you regret, not a refund counter. Packs come from the live pack catalogue, so crafting always yields the **current** set. **Exclusive cosmetics stay uncraftable** — that promise is what makes them exclusive. Every failure refunds in full, and the message distinguishes "you own them all" from "none exist yet".

### Cosmetics

- **🎲 Dice skins** — earned from crafting or the shop. Only *your* die is skinned; your opponent's is untouched, and the pips stay readable over any art.
- **Deck sleeves** render on your card backs, with an equip picker in Settings.
- **Exclusive cosmetics** and **Founder Drops**.
- **Tier entitlements**, including cash-out allowance.

### Shop and items

- 🐛 **The held-item picker now shows only what you own.** Custom items were bypassing the inventory gate entirely, so every forged item in the game appeared in every player's Held Item dropdown whether they owned it or not. (An item you have equipped but no longer own is still listed, so a loadout can't silently break.)
- **The Cinder Shop now sells held items**, and is Camp-only.
- 🐛 **An audit found 11 unpaid rewards and an unbuyable shop.** All fixed.
- 🐛 **Vault container images** actually save now.
- **Founder & Node packages** available through the shop, with exactly-once fulfilment.

### The Garage

Three convoy rigs, bought once with real money and **owned permanently**:

| Rig | Price |
|---|---|
| **Ironback Runner** | $20 |
| **Ash Convoy Rig** | $60 |
| **Warden Longhaul** | $99 |

Ownership is stored in three places — your local profile for instant offline reads, your cloud profile so it crosses your devices, and server-side, which is the only copy a wiped browser can be restored *from*. **Restore runs on every sign-in**, not just after a purchase, because a new device has a purchase record and an empty profile.

There is now exactly **one** storefront for these. They had briefly been sold in two places, in two currencies, with two ownership records — that's been unified onto the real-money rail.

### Referrals

- **A referral card in your game profile** — your code, a redeem box, and MT airdrop progress.
- **Both sides are rewarded.** Invite copy, local credit and an instant pack open when a friend redeems in-game.
- Referral pack gifts land **sealed in your Pack Opening inventory** instead of auto-opening, so you get to open them yourself.
- **Claim buttons on your profile** for gift-inbox rewards.
- 🐛 Friendly errors for address-lock rejections instead of a raw failure.

---

## 🗡 Roguelite and Campaign

- **The 3D Ascent map is now the default roguelite map.** All 14 node types, relics, currency, heat/haul, dialogue and every placement keep working — the campaign model is still authoritative.
- **A visual Campaign Builder** — the node-graph editor reworked around the real 14 node types, with start/boss validation and per-node Name and Story fields. Edits merge by ID, so a visual change never drops enemy config, rewards, dialogue, infection zones or random-event pools.
- **Story chaining** — campaign outro text now appears on the victory screen above the next-chapter buttons, and the 3D departure node carries your camp intro.
- **Onboarding rewritten.**
- 🐛 The **Main Hub tutorial** is no longer consumed by a sub-hub.
- **Polycreation** — a new modal, plus material sources and triggered hand abilities.

---

## 🎨 Interface

- **The bunker console** rebuilt — three columns and a command bar, with the room cards rebuilt to the reference design.
- **The victory / defeat screen** rebuilt.
- **Deploy Slots** rebuilt.
- **The node modal** reskinned — crest, stat triple and loss pills.
- **Hero portraits and hero frame art fill their frames** instead of letterboxing.
- **Back buttons** are in flow, under the title, and never overlap anything.
- **Six capped page containers widened**, and the Concord page now holds an even grid at every width.
- **The camp resource strip** stays one row tall on narrow screens.
- 🐛 **The auction listing modal could not be closed** — neither the X nor Cancel worked. Fixed, and the auction modal now always opens dead centre.
- **1,000,000 listing cap** on auctions.
- 🐛 The **giant gold pill on Choose Your Deck** and a stranded AI pill — fixed.
- **Battlefield art restored**, and the admin's battlefield art is wired into the board stage. The 3D map backdrop and the bank door are back.
- 🐛 **The cinematic main menu never loaded** — it was requesting a three.js version that doesn't exist. Fixed.
- 🐛 **The main menu was serving a stale cached copy.** Fixed.
- **Leaderboards have been removed** from the game and camp.

### Broadcast

- **An Emergency Broadcast tile** in the game menu, linking to your web profile and the feed.
- **Share to Broadcast from the victory screen** — post your result, with an optional clip.
- **Clip recorder.**

---

## 🛡 Accounts, Saves and Stability

This is the section that matters most, because these were costing players real things.

### The one that was wiping accounts

🔴 **Stale reset directives were wiping players who changed devices.** A season reset published in July was still being applied — in August — to anyone who had missed it at the time: a new account, a new device, cleared storage, or a phone that hadn't been opened in a week. The system was asking "has this player already taken this reset?" when it should have been asking whether the reset was still current.

The measured exposure before the fix was **379 player/directive pairs across 82 of 97 players**. Five accounts in four days each applied all five historical resets within a single minute — the fingerprint of a device with no local record — every one ending on zero Cinder.

**Both halves of this fault are now closed**, and a related bug where a purge one-shot re-ran on every new device is fixed too.

### Your vault

🔴 **Bought Vault Containers were vanishing.** Two bugs, and the second is why it kept happening rather than happening once:

1. A one-time gear clean was throwing away the whole vault layout object — which holds two unrelated things: your **items** (correct to clear) and the **size of your vault**, bought with Aza at 25 / 60 / 120 per container. So a gear clean silently repossessed paid capacity, and a repossessed vault looks exactly like a normal new one, which is why this surfaced as player reports rather than as an error.
2. The "already done this" flag was never actually saved, so a new device, cleared site data or Safari's storage eviction re-ran the "one-time" clean on an account that had already had it.

**Contents clear, capacity survives.** And vault rows can now be restored from the admin panel without touching the database.

### Your wallet

- **Cinder and Aza are now server-owned.** Every faucet in the game routes through the wallet, and the last client-asserted money number has been closed out.
- **A credit outbox** — when a credit fails, the game now remembers **what** failed and how much, instead of just that something did. That's the difference between a retry for the right amount and a "make my balance match" guess.
- **Admin care packages** — 500,000 Cinder plus 500 each of metal, supplies, water and food, delivered to your gift inbox and claimed like any other reward. Sent as five separate gifts so a player with a full vault can take the Cinder now and the resources later.
- Every reward path is bounded and every refusal is recorded.

### Cross-device

- 🐛 **A stale pending flag can no longer beat newer cloud data**, so signing in on a second device won't overwrite what you did on the first.

### Performance and delivery

- 🔴 **The minifier was compressing the wrong script** — 3.7 MB was shipping raw on every single deploy. Fixed.
- **WebGL contexts** are now released when panels close, instead of being held.
- **A GPU soak test** confirms the title screen does not leak (94 samples, −0.5 MB/hr).
- 🐛 **Multiplayer** — four owner/position fields the perspective swap never swapped, so some effects read the wrong side of the board.

---

## 🔧 For creators — the Card Forge

- **Enchantment and Curse** are both authorable from the Forge type dropdown.
- **Zero-cost-in-hand** can be authored from the card editor, and is signposted from the Effect Type dropdown.
- **Spell and trap effect pickers are grouped**, as are the effect dropdowns generally.
- **A summon-zone picker** in every ability editor.
- **The draft flag** — mark a card draft and it's excluded from the published catalogue and hidden from every non-admin deck pool, while staying fully editable in the Forge.
- **Card art overhaul** — art now persists properly (including animated art), pasted URLs are verified before they're stored and re-hosted onto our own storage, and there's a proxy so a host that blocks us can't hold our art hostage. The Card Art panel shows your sign-in state.
- **Card set import** — `importCards()` plus five authored archetype batches (control, counters, the lock/continuous shell, Verdict, and enchantments).

---

*Mythic Spellbook · builds v119r8 → v120w6*
