# Mythic Spellbook — MP Server

Authoritative multiplayer server for the TCG. **Colyseus** rooms over WebSocket, deployed on **Fly.io**.

The full architecture rationale + comparison vs the old Supabase Realtime approach lives in [`docs/multiplayer-architecture.md`](../docs/multiplayer-architecture.md).

## Quick start (local dev)

```bash
cd colyseus-server
npm install
cp .env.example .env       # then edit SUPABASE_URL etc.
npm run dev                # auto-reloads on save (tsx watch)
# server listens on http://localhost:2567 (WS + HTTP)
```

Health check: `curl http://localhost:2567/health` → `ok`

## Deploy to Fly

First time:

```bash
cd colyseus-server
fly launch --no-deploy        # picks region (use 'iad' or your closest), generates an app name
fly secrets set \
  SUPABASE_URL=https://ktsiasyjusesawtrwrjc.supabase.co \
  SUPABASE_JWT_AUDIENCE=authenticated \
  CORS_ORIGINS='https://playmythicspellbook.play-a3d.workers.dev,https://mythicspellbook.xyz'
fly deploy
```

After that:

```bash
fly deploy                    # ship new server versions
fly logs                      # tail live logs
fly status                    # see machine state
fly scale memory 1024         # bump RAM if you outgrow 256MB
```

## Required env vars

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Used to fetch the JWKS for verifying client auth tokens |
| `SUPABASE_JWT_AUDIENCE` | Usually `authenticated` (Supabase default) |
| `CORS_ORIGINS` | Comma-separated list of allowed origins (your game URL + marketing site) |
| `PORT` | Default `2567` |
| `MONITOR_USER` / `MONITOR_PASS` | (Optional) basic-auth credentials for `/colyseus` dashboard |
| `AUTH_DEV_BYPASS` | **Local dev only.** Set `true` to skip JWT verification |

## Architecture in one glance

```
Client ──WS── BattleRoom ──validates+mutates── BattleState
                  │                                │
                  └──── auto-broadcasts deltas to all clients (schema diff)
                  └──── on match end: writes winner_id to Supabase
```

- **Auth**: client sends Supabase JWT in the `joinOrCreate` options. Server verifies via JWKS. No JWT → no join.
- **State**: lives entirely on the server, in `BattleState` (schema-tracked). Clients receive automatic deltas.
- **Reconnect**: 30-second grace window via Colyseus's built-in `allowReconnection`.
- **Match end**: server determines winner (hero death / forfeit / DC). Writes back to Supabase `matches.winner_id`.

## Session roadmap

**Session 1 (current)**: Scaffold + auth + room skeleton. ✅ Done.

**Session 2**: Port the engine. Damage calc, status effects, move resolution, on-play effects all move from the client `index.html` to TypeScript here. The client becomes a thin "send action / render state" layer.

**Session 3**: Cutover. Flip the client's `USE_COLYSEUS` feature flag to default on. Keep the old Supabase Realtime path as fallback for one release in case of regression.
