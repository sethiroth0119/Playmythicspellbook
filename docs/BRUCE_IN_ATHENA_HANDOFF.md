# 🤖 Bruce inside Athena Engine — build & deploy handoff

**Give this file to the agent that will build it.** It is self-contained. Every number and
path below was verified against this repository with the tools, not recalled — where a
claim is a decision rather than a fact, it says so.

- Branch: `claude/magical-edison-kx2o64`
- Bruce: `.claude/agents/bruce.md` + `.claude/skills/*` (10) + `tools/gamedev/` (14 tools)
- Live-game MCP: `tools/gamedev/mcp.mjs`, registered in `.mcp.json` as `mythic-game`
- Project law: `CLAUDE.md` — it outranks this file. Read it first.
- Engine reference: `docs/athena-engine.md` (894 lines)

---

## 0. Read this before you plan anything

**Bruce is not being written. Bruce already exists and works.** The job is to give him a
door inside the game. Do not re-implement him, do not write a "game dev assistant" in the
browser, do not copy his skills into prompts. Any design that recreates his behaviour
instead of *hosting* him is the wrong design and will be rejected.

The reason this is cheap: the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) is
Claude Code as a library, and it **loads `.claude/agents`, `.claude/skills` and
`.claude/settings` from the project directory automatically** — same as the CLI. Point it
at this repo and Bruce is there, with his gate, his skills, his permission model and
`CLAUDE.md` as law. That is the whole trick.

---

## 1. 🔴 The constraint that decides the architecture

From the Agent SDK documentation:

> *"Unless previously approved, Anthropic does not allow third party developers to offer
> claude.ai login or rate limits for their products, including agents built on the Claude
> Agent SDK. Use the API key authentication methods."*

**Therefore: the Bruce panel is a DEVELOPER TOOL that runs on a developer's machine
against that developer's own API key. It is never shipped to players.** Not behind an
admin flag, not "just for staff accounts on prod" — the bridge process does not exist on
the deployed site at all.

Two consequences you must design for:

1. `public/` is the Cloudflare deploy root. Anything you put there ships to every player.
   The panel code may live there **only if it is inert without a local bridge** — it must
   detect the bridge is absent and not render, exactly as `mapforge.bridge.js` degrades
   when `window.MythicBridge` is missing. Prefer serving the panel from the dev harness.
2. Branding: the product may say "Powered by Claude". It may **not** be called "Claude
   Code", use Claude Code branding, or mimic its ASCII/visual identity. Call it **Bruce**.

---

## 2. Architecture — three processes

```
┌──────────────────────────┐   WebSocket    ┌────────────────────────┐
│ The game in a browser    │  (127.0.0.1)   │ Bruce bridge (Node)    │
│  Athena panel UI         │ ◄────────────► │  @anthropic-ai/        │
│  src/mapforge/…          │   NDJSON       │   claude-agent-sdk     │
└──────────────────────────┘                │  query({ agent:'bruce'│
                                            │    , cwd: repo })      │
                                            └───────────┬────────────┘
                                                        │ stdio (MCP)
                                            ┌───────────▼────────────┐
                                            │ tools/gamedev/mcp.mjs  │
                                            │ (already built)        │
                                            └────────────────────────┘
```

A browser cannot write `index.html`. The bridge is the only thing with filesystem access,
and it is the only new process. The MCP server already exists and Bruce already has it.

---

## 3. What exists today (verified — do not re-check, build on it)

| Fact | Value |
|---|---|
| `public/index.html` | 264,875 lines, 16 MB, one inline `<script>` of 13.3 MB |
| ES module tags in index.html | **30 — all 30 load, 0 fail** (`mcp.mjs` `modules`) |
| `window.MythicBridge` | **37 top-level keys**, live (not 85 — that was a source-reading error) |
| `window.AthenaEngine` | v1, 22 API keys, alias `MythicMapForge` intact |
| Athena registered game scenes | 6: `farm`, `battle`, `models-fishing`, `models-auction`, `models-extraction`, `models-city` |
| Mini-games with a world slot | 33 (`ATHENA_MINI_GAMES`) |
| Distinct `App.screen` values | 91 |
| Live catalogs | 200 moves, 60 statuses |
| Gate (`node tools/gamedev/check.mjs`) | **7 of 11 green** — see §8 |

Existing patterns to copy rather than invent:

- **Admin-gated surface:** `src/widgets/live-editor.js:38` —
  `if (!api.isAdmin() && !opts.force) { bridgeToast('… is admin-only.'); return null; }`
- **Full-screen overlay outside `#app`:** `src/mapforge/mapforge.pill.js:54,126` —
  `position:fixed; inset:0; z-index:10000`, appended to `document.body`, restores
  `body.style.overflow` on close.
- **Graceful degradation:** `src/mapforge/mapforge.bridge.js` header — every accessor
  optional, works with no bridge at all. Your panel must do the same for the *Bruce*
  bridge.
- **Dev servers already present:** `.claude/launch.json` (serves `public/` on 8787) and
  `tools/athena-harness/serve.mjs` (8765).

---

## 4. Build this

### 4.1 `tools/bruce-bridge/server.mjs` — the new process

- Node, ESM, house style (heavy header comment explaining WHY; see `tools/gamedev/mcp.mjs`).
- HTTP + WebSocket on **127.0.0.1 only**. Never bind `0.0.0.0`. Refuse a request whose
  `Origin` is not the local dev origin.
- On a client message `{type:'ask', text, sessionId?}`, call:

```js
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const msg of query({
  prompt: text,
  options: {
    cwd: REPO_ROOT,          // so .claude/agents, .claude/skills and CLAUDE.md load
    agent: 'bruce',          // the existing .claude/agents/bruce.md
    resume: sessionId,       // continue the panel's conversation
    permissionMode: 'default',
  },
})) { send(clientWs, msg); }
```

- Stream every `SDKMessage` to the browser as NDJSON. Do not buffer to completion — the
  point is watching him work.
- Expose `listSessions` / `getSessionMessages` so the panel can reopen a past conversation.
- `startup()` pre-warm on boot is worth it: the first `query` otherwise pays init cost
  while the user watches a spinner.

**Auth:** read `ANTHROPIC_API_KEY` from the environment. Never read it in the browser,
never send it over the socket, never write it to a file in the repo. If it is unset, the
bridge must refuse to start with a clear message.

**New dependency:** `@anthropic-ai/claude-agent-sdk` is the *only* npm package this work
may add, and CLAUDE.md requires asking first — **that permission is granted for this
package and nothing else.** Put it in `devDependencies`; it must never reach `public/`.

### 4.2 `public/src/bruce/index.js` — the panel

- An ES module, registered as `window.BrucePanel`, **inert until opened** (copy
  `src/mapforge/index.js`: three.js is not fetched until `open()`).
- Discovery: try the bridge on its port; on failure **render nothing at all and log
  nothing user-visible**. A player must never see a trace of it.
- Gate on `MythicBridge.isAdmin()` *as well* — belt and braces.
- UI: transcript of Bruce's messages with tool calls visible, an input, a session picker,
  and a stop button. Match the engine's existing CSS language (`src/mapforge/mapforge.css`).
- Entry point: a new tab or button in the Athena editor chrome. Follow whatever
  `docs/athena-engine.md` describes for the current tab set — do **not** add a new global
  pill; there is already one (`#athena-pill`) and a second would fight it.

### 4.3 Wiring

- `package.json`: `"bruce": "node tools/bruce-bridge/server.mjs"`.
- Bump `?v=` on the new module tag per CLAUDE.md's Athena rule.
- `docs/athena-engine.md`: add the panel to the Files table and a short section.

---

## 5. 🔴 Safety rules — non-negotiable

1. **Bruce writes drafts. Only a human flips live.** `world_maps` and `ui_widgets` both
   carry a live flag, and `widgets.runtime.js` applies live page docs *to every player*.
   Bruce may create and edit draft documents freely; the panel must not expose any
   set-live action to him, and his agent definition must say so. Publishing to players is
   a human action taken deliberately.
2. **Never expose the bridge off localhost.** No tunnel, no LAN bind, no "just for
   testing" flag. It has full filesystem write access to the repo.
3. **Do not relax `mcp.mjs`'s off-origin block.** It aborts every non-local request so it
   can never reach Supabase, the worker, Colyseus or a CDN. That is what makes it safe to
   let an agent poke the live page. Read its header before touching it.
4. **Real-money paths stay manual.** `worker.js` is the payment authority. Bruce must not
   be given a path that exercises `/api/buy`, `/api/cashout` or Stripe from the panel.
5. **Migrations are still pasted by hand** into the Supabase SQL editor (CLAUDE.md).
   Nothing in the panel applies SQL.
6. Bruce's own standing orders already say to ask before anything irreversible or
   outward-facing — pushing to `main`, deploying, opening a PR, deleting data. The panel
   must surface those prompts, not auto-approve them. Do **not** set
   `permissionMode: 'bypassPermissions'`.

---

## 6. Acceptance tests

Ship nothing until all of these pass.

1. `npm run bruce` with `ANTHROPIC_API_KEY` unset → refuses to start, says why.
2. Game loaded with the bridge **down** → no panel, no console noise, no network error
   visible to a player. `node tools/gamedev/mcp.mjs` `boot` reports **0 page errors**.
3. Game loaded as a non-admin with the bridge **up** → no panel.
4. As admin with the bridge up → panel opens; ask *"how many moves are in the game?"* →
   Bruce answers **200**, and the transcript shows him using a tool to find out rather
   than asserting it.
5. Ask *"what is the Athena Engine?"* → he describes `src/mapforge`, 29 modules. If he
   says no such engine exists, he is reading a stale doc — see §9.
6. `/ship-check` typed in the panel runs the real gate and streams its output.
7. A write request ("fix the typo in X") produces a real file edit on disk, visible in
   `git status`.
8. `node tools/gamedev/check.mjs` is **no worse than 7 of 11** afterwards.
9. `git grep -i "ANTHROPIC_API_KEY" public/` returns nothing.

---

## 7. Do not do these

- Do not rebuild Bruce's knowledge as a system prompt.
- Do not add npm packages beyond `@anthropic-ai/claude-agent-sdk`.
- Do not put the bridge or the SDK inside `public/`.
- Do not touch battle, card, or economy code (CLAUDE.md, Community scope rule).
- Do not build Discord anything, and do not add image/video upload — both permanently out
  of scope, and the Community design doc's webhook recommendation is explicitly overruled.
- Do not "fix" the four failing gate steps as part of this work (§8). One behaviour per
  commit; they are separate jobs with their own decisions.
- Do not deploy. Deploy bumps three version knobs together and is verified at the edge
  with `curl` — a human does that.

---

## 8. The gate's current state — inherited, not yours

`node tools/gamedev/check.mjs` → **7 of 11 green.** Green: syntax, runtime, engine, damage,
economy, jsx, versions. Red, all pre-existing:

| Step | Count | Notes |
|---|---|---|
| `lint` | 3 errors | `MOVES.sunder` applies undefined status `armorBreak`; two unit cards use spell/trap words (`draw`→`drawCards`, `destroyUnit`→`destroyTarget`). **`armorBreak` needs a human balance decision on the number.** |
| `effects` | 7 quiet, unbaselined | Baseline was recorded against 109 effects; this branch has 119. New arrivals, not proven regressions — do not `--write-baseline` to silence them. |
| `sql` | 6 errors, 138 warnings | Mostly missing `DROP POLICY IF EXISTS` (files are pasted by hand, so re-runnability is a safety property). |
| `audit` | 9 errors, 147 warnings | 75 direct `Profile.gems` writes outside `spendGems`/`addGems`; native `alert()`/`confirm()`. |

**If you turn any of these green as a side effect, say so explicitly. Never weaken a step
to go green — fix the code, or fix the step and say so in the commit.**

---

## 9. Two stale documents — do not trust them

1. **`CLAUDE.md` names verification tools that are not in this branch.** It instructs
   running `.gauntlet/modcheck.mjs`, `.gauntlet/comment-scan.mjs`,
   `.gauntlet/precommit-scan.mjs` and reading `.gauntlet/README.md`. `.gauntlet/` contains
   exactly one file: `_forge-harness.mjs`. **The module check it calls mandatory does not
   exist** — use `mcp.mjs`'s `modules` tool instead, which does the same job against a real
   browser. Everything else in CLAUDE.md stands.
2. **Any copy of `BRUCE.md` outside this repo says "there is no Athena engine in this
   repository."** That was true only of the branch Bruce was authored on. It is false here
   and was corrected in `.claude/agents/bruce.md` and `docs/game-dev-agent.md`. If a Bruce
   you are talking to asks for external Athena documentation, he is running from the stale
   copy — point him at `docs/athena-engine.md`.

---

## 10. Decisions for the human, not the agent

Raise these; do not choose them yourself.

1. **Where the panel lives** — a tab inside the Athena editor, or a standalone dev page
   served by the harness that never enters `public/`. The second is safer; the first is
   what "work on the game inside the game" actually means. *Recommendation: build it as an
   Athena tab, but serve the panel module from the harness so it cannot ship by accident.*
2. **Does Bruce get write access from the panel on day one**, or read-and-propose only
   until the loop is trusted? *Recommendation: read-and-propose for the first week.*
3. **Model and cost.** Every panel turn is billed to the owner's API key. Decide whether
   there is a spend ceiling and who pays.
4. **The `armorBreak` number** (§8) — Bruce's proposal is `defMod: -4`; that is a balance
   call.

---

## 11. Where this is going

The panel is Tier 2 of a three-tier plan; the rest is context, not scope.

- **Tier 1 — documents.** Maps, widgets, cardsets and catalogs are already data. As more
  of the game becomes documents, more of it becomes editable in-engine without a
  filesystem. That is the `screen-as-document` work: today the game's 91 screens are HTML
  strings built inside a 13.3 MB function, and `live-editor.js` can only layer CSS-selector
  rules over them — it says so itself. Converting a screen into a document is the same work
  as shrinking the monolith.
- **Tier 2 — this panel.** Repo edits from inside the engine, dev machine only.
- **Tier 3 — cloud.** Browser → worker → agent → commits. Not now.

The reach of Tier 1 grows exactly as the monolith shrinks. "Too big", "Athena as our
engine", and "Bruce in the engine" are one project with one bottleneck.
