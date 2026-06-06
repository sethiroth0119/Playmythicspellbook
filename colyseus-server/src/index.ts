// ============================================================================
// 🪐 Mythic Spellbook MP Server — entry point
// ----------------------------------------------------------------------------
// Boots Colyseus on top of an Express app so we can also serve a /health
// endpoint Fly checks against. The BattleRoom is registered as 'battle';
// clients connect via colyseus.client.joinOrCreate('battle', { authToken }).
//
// Run locally:   npm run dev            (tsx watch + auto-reload)
// Build + run:   npm run build && npm start
// Deploy to Fly: fly deploy             (see fly.toml)
//
// Endpoints:
//   GET  /health         — Fly health probe (returns 200 OK)
//   GET  /colyseus       — Colyseus monitor dashboard (use a strong PW in prod)
//   WS   /matchmake/*    — Colyseus client SDK matchmake / join / create
// ============================================================================

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { BattleRoom } from './rooms/BattleRoom';

const PORT = parseInt(process.env.PORT || '2567', 10);

// ---- Express app: health + monitor ------------------------------------------------
const app = express();

// Allow the live game origin(s) — comma-separated list in CORS_ORIGINS env.
const corsOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? '*' : corsOrigins,
  credentials: true,
}));

app.get('/', (_req, res) => {
  res.json({
    name: 'mythic-spellbook-mp',
    status: 'ok',
    rooms: ['battle'],
    timestamp: new Date().toISOString(),
  });
});

// Fly health probe — must be cheap + always 200 when the process is alive.
app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

// Colyseus monitor — basic-auth gated. Set MONITOR_USER/MONITOR_PASS to enable.
if (process.env.MONITOR_USER && process.env.MONITOR_PASS) {
  const basicAuth = (req: any, res: any, next: any) => {
    const header = String(req.headers.authorization || '');
    const expected = 'Basic ' + Buffer.from(
      process.env.MONITOR_USER + ':' + process.env.MONITOR_PASS
    ).toString('base64');
    if (header !== expected) {
      res.setHeader('WWW-Authenticate', 'Basic realm="monitor"');
      return res.status(401).send('Unauthorized');
    }
    next();
  };
  app.use('/colyseus', basicAuth, monitor());
}

// ---- Colyseus server --------------------------------------------------------------
const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // More tolerant heartbeat. A briefly-backgrounded browser tab (e.g. an admin
    // testing BOTH seats on one machine, or a player who alt-tabs) throttles JS
    // timers and can miss pings — the old 8s×3 = 24s window dropped the host the
    // moment it was backgrounded to set up the opponent. 8s × 12 = ~96s of
    // silence tolerated before a drop; the 30s reconnect window still covers
    // real network blips after that.
    // ⚠ NOTE: this does NOT fix the real ~20s host drop — Fly's EDGE PROXY closes
    // an idle WebSocket before this server-side budget ever applies, and the proxy
    // doesn't speak the Colyseus ping protocol. The load-bearing fix is the CLIENT
    // heartbeat (room.send('ping') every 5s, acked by BattleRoom's 'ping' handler),
    // which keeps the socket non-idle end-to-end. This is defense-in-depth only.
    pingInterval: 8000,
    pingMaxRetries: 12,
  }),
});

// Register the BattleRoom. Clients call client.joinOrCreate('battle', options).
gameServer.define('battle', BattleRoom)
  // Filter so two players with the same matchId join the SAME room. Without
  // this, joinOrCreate would matchmake by capacity only and put strangers
  // together. We want the existing Supabase matchmaking flow to dictate
  // pairing — Colyseus just hosts the room once both clients know the id.
  .filterBy(['matchId']);

httpServer.listen(PORT, () => {
  console.log('[mp] mythic-spellbook-mp server listening on :' + PORT);
  console.log('[mp] CORS origins:', corsOrigins);
  console.log('[mp] auth dev-bypass:', process.env.AUTH_DEV_BYPASS === 'true' ? 'ENABLED ⚠' : 'disabled');
});

// Graceful shutdown — Fly sends SIGTERM on deploys; finish active matches
// before dying so in-progress battles don't get cut off mid-action.
process.on('SIGTERM', async () => {
  console.log('[mp] SIGTERM — gracefully shutting down…');
  await gameServer.gracefullyShutdown(true);
  process.exit(0);
});
