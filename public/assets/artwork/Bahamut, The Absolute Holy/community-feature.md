# THE COMMUNITY FEATURE — Honest Read + Claude Code Prep

## 1. What you already have

The document treats Organizations as an existing system to build above. In your code they're **Corporations**, and they're further along than the doc assumes:

```js
const Corp = { mine, roster, requests, vault, directory, licenses,
               compliance, complianceParts, treasury, amOwner };
```

- **Roster and join requests** — `cityHallApply()` already writes `{corp_id, user_id, user_name, role, status:'pending'}`. Roles and applications exist.
- **Treasury** — `corp_treasury`, an append-only ledger where balance is `sum(amount)`. Deposits, refund-on-failure, confirm dialogs. Done.
- **Corp Operations** — funded industry paying salaries out of Treasury, 6h collection cadence, 36h accrual cap.
- **Territory** — `tw_regionControlPct(regionId, corpId)`. Corps already hold ground.
- **Licenses, compliance, civic tax** — `frApplyTax(gross, {market:'corp', corpId})`.

And chat exists:

```sql
chat_messages (id, room, sender_id, recipient_id, sender_name, body, created_at)
```
Rooms `world` and `trade`, DMs via `recipient_id`, RLS policies written, optional Realtime, a 10-word profanity list, 280-char cap, 1.5s send cooldown.

**So the real statement is: Communities sit above Corporations.** And two of the document's biggest asks — treasury and roles — already have working patterns you should copy rather than reinvent.

---

## 2. Honest read on the document

It's competent, well-organised social-platform design. Three problems with it *for your game specifically*:

### It's enormous
Eighteen database entities. Feeds with video, events, missions, treasuries, stores, taxes, moderation, appeals, audit logs. Even the "MVP" at the end is ten systems. That's a multi-quarter build for a team, on top of a 212,000-line single-file app you're already maintaining.

### It duplicates what you have
Community Treasury is a second treasury alongside `corp_treasury`. Community Missions overlap Territory Wars objectives. Community roles duplicate corp roles. Building parallel systems that do the same thing is how a codebase becomes unmaintainable — and yours is already a single file.

### It's a worse Discord
This is the important one. The doc describes channels, feeds, roles, moderation, pinned posts, polls. **Discord already does all of that, for free, and every gaming community you want is already on it.** Nobody is going to abandon a Discord where their friends are to use an in-game feed with 40 people in it.

> A community feature that competes with Discord loses. A community feature that does what Discord **cannot** wins.

---

## 3. The reframe: build the civic layer, not the chat app

Discord cannot see your game state. It doesn't know who controls Ashfall Row, which corp's convoy got hit last night, or that a player's card shop turned 400,000 Cinder this week. **That's your entire opportunity.**

| Don't build | Build instead |
|---|---|
| A message feed | A **standings board** — live territory, corp revenue, war results |
| Channels and threads | A **Discord webhook** that posts your game events into their existing server |
| Polls | **Community votes** that actually change game state (set a tax rate, declare a war target) |
| A community store | **Community-owned businesses** — a district block held collectively |
| Posting XP | **Contribution ledger** — Cinder given, territory taken, matches won |
| Event calendar | **Tournament brackets** wired to real match results |

The single highest-value integration in this whole document isn't in the document: **outbound Discord webhooks.** Let a community paste a webhook URL and receive "Vance Holdings seized Ironworks," "Your convoy was ambushed," "Tournament round 2 starts in 1 hour." That's ten hours of work, it makes your game present in the place players already live, and it costs you no moderation liability at all.

---

## 4. What I'd actually build

### Phase 1 — Community as a corp alliance (small)
A Community is a named container that Corporations affiliate with. No feed, no posts.

- Name, tag, banner, description, join policy
- Affiliated corps list, with each corp's live stats pulled from systems you already have
- **Standings** — territory held, combined treasury, war record, weekly revenue
- Contribution ledger, copying the `corp_treasury` append-only pattern exactly
- **Discord webhook** for announcements

This is genuinely useful at 30 concurrent players. A feed is not.

### Phase 2 — Coordination (medium)
- Community missions, but sourced from **existing** Territory Wars objectives rather than a new system
- Shared war targets and defence calls
- Reward distribution from a community ledger, by contribution
- Roles with permission toggles — copy the corp role pattern

### Phase 3 — Social surface (large, and only if 1–2 succeed)
- Announcements (leadership-only posting — one-to-many, not many-to-many)
- Community channels, implemented as **`room = 'community:<id>'` in the existing `chat_messages` table**. That's a schema you already have and RLS you've already written.
- Text only. See below.

---

## 5. The moderation reality — read this before you commit

Your current moderation is a hardcoded array of ten words and a 1.5-second cooldown. The document asks for image and video posts.

Those are not adjacent problems. They are different categories of risk:

- **User-uploaded images and video means you are hosting UGC.** That brings a legal obligation to detect and report child sexual abuse material, and it is not optional or deferrable. It requires hash-matching against known material, a reporting pipeline, and a retention policy.
- **Harassment and doxxing** need an actual response process, not just a report button.
- **Storage and bandwidth cost real money** and scale with abuse, not with revenue.

**My recommendation: text only, indefinitely.** Announcements from leadership, plus the existing chat rooms. If you want images in communities later, use a third-party service that handles the scanning and the legal obligations as part of its product, rather than building it yourself.

The document lists moderation as item 9 of 10. For a solo developer shipping UGC, it's item 1, and it's the reason to keep the surface as small as possible.

---

## 6. Preparing Claude Code

This is the part that will make or break the build. Your app is **one 12.8 MB HTML file with 212,000 lines.** Claude Code cannot hold that in context, and pointing it at `index.html` and saying "add communities" will produce a mess.

### 6.1 Stop adding to index.html
Do not put 8,000 lines of community code into the single file. Before writing any feature code:

```
/src
  /community
    community.state.js      # Community object, fetch/cache, mirrors the Corp pattern
    community.api.js        # every Supabase call, one file, nothing else touches the client
    community.render.js     # UI
    community.roles.js      # permission checks
  /sql
    001_community_core.sql
    002_community_roles.sql
    003_community_ledger.sql
index.html                  # loads modules
```

Even if the rest of the app stays monolithic, **the new feature starts modular.** That single decision is what makes Claude Code viable here — it can work inside `/src/community` with the whole feature in context.

### 6.2 Write a `CLAUDE.md`
Claude Code reads this automatically. It should contain the things that aren't inferable from any one file:

```markdown
# Mythic Spellbook — working notes for Claude Code

## Architecture
Single-page app. Legacy code lives in index.html (~212k lines). NEW features
go in /src/<feature>/ as ES modules. Never add new top-level systems to index.html.

## Non-negotiables
- All Supabase access is guarded. The app MUST still work offline / before
  tables exist, degrading to mock data. Follow the Corp.* pattern.
- Ledgers are append-only. Balance = sum(amount). Never UPDATE a balance column.
  See corp_treasury.
- Every table needs RLS policies in the same migration. No exceptions.
- Colyseus client must match server 0.16.x + schema v3 exactly.
- All operation pricing goes through _opEcon(). Never hardcode economy numbers.

## Conventions
- Comments explain WHY, including past bugs and rejected designs. Preserve this.
- Currency: Cinder is Profile.gems. Use spendGems()/addGems(), never mutate directly.
- User-facing errors use showToast(). Confirmations use gcConfirm() (async).
- No new npm dependencies without asking.

## Existing systems to reuse, not rebuild
- Corp.* — roster, requests, roles, treasury. Communities sit ABOVE corps.
- chat_messages — rooms + DMs + RLS already exist. Community channels are rooms.
- frApplyTax() — civic tax. Territory: tw_regionControlPct().

## Out of scope
- No image or video upload. Text only.
- Do not modify battle, card, or economy code while working on Community.
```

### 6.3 Migrations as files, not string literals
Right now `CHAT_SQL` is a giant escaped string inside a JS constant, shown to the user to paste into the Supabase editor. That works for one table. It will not work for twelve.

Move to numbered `.sql` files under `/sql`, applied through the Supabase CLI. Claude Code handles migration files well and handles escaped SQL string literals badly.

### 6.4 Give it a schema contract before it writes code
Write the tables and RLS policies yourself — or have Claude Code propose them and **review every policy line by line**. RLS is your entire security boundary. A missing `using (auth.uid() = ...)` clause is a data breach, and it's exactly the kind of thing that looks fine in review.

Minimum viable schema for Phase 1:

```
communities            (id, name, tag, owner_id, join_policy, banner_url, created_at)
community_members      (community_id, user_id, role, status, joined_at)
community_corps        (community_id, corp_id, status, affiliated_at)
community_ledger       (id, community_id, user_id, amount, kind, note, created_at)
community_audit        (id, community_id, actor_id, action, target, created_at)
```

Five tables, not eighteen. Add the rest when something actually needs them.

### 6.5 Slice the work vertically
Claude Code performs far better on "make this one thing work end to end" than "build the community system." Write the tickets yourself:

1. `communities` table + RLS + create-a-community flow + it appears in a list
2. Join / apply / approve, with roles
3. Corp affiliation — a corp owner applies, community leadership approves
4. Standings board reading live from existing corp/territory functions
5. Contribution ledger, copying `corpTreasuryDeposit()` exactly
6. Discord webhook out
7. Permissions matrix + audit log

Each slice ships. Each is reviewable in one sitting.

### 6.6 Guardrails worth setting explicitly
- **"Do not touch index.html except to add the module loader."** Say it in `CLAUDE.md` and repeat it per session.
- **"Never invent economy numbers."** Anything with a Cinder value routes through existing helpers.
- **"Every Supabase call is wrapped in try/catch and degrades gracefully."** Your existing code is disciplined about this; a new contributor won't be unless told.
- **Read-only first.** Have Claude Code build the standings board (pure reads) before anything that writes money.

---

## 7. Build order

| # | Step | Why first |
|---|---|---|
| 1 | `CLAUDE.md` + `/src` module scaffold | Everything else is worse without it |
| 2 | 5-table schema + RLS, as migration files | The security boundary. Review by hand. |
| 3 | Create / join / roles | The smallest thing that is a Community |
| 4 | Corp affiliation | The actual point — communities of corps |
| 5 | Standings board (read-only) | Delivers value at 30 players. Discord can't do it. |
| 6 | **Discord webhook out** | Ten hours, enormous reach, zero moderation liability |
| 7 | Contribution ledger | Copies a proven pattern |
| 8 | Announcements (leadership-only, text) | One-to-many. Low abuse surface. |
| 9 | Everything else in the document | Only if 1–8 are being used |

---

## The one-line version

The document's closing line is *"Guilds run operations. Communities build civilizations."* That's the right ambition and the wrong first build. Start with **"Corps hold ground. Communities hold corps together"** — a civic layer over the systems you already shipped — and let Discord keep doing the chat.
