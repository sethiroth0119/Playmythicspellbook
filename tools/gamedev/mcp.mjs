#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   mcp.mjs — the LIVE GAME as an MCP server, so Bruce can ask the running
   page questions instead of reconstructing it from source.

   tools/gamedev/headless.mjs loads the inline engine in a Node sandbox in
   ~0.3 s, which is the right tool for catalog and formula questions. It
   cannot answer anything that only exists once a BROWSER has run the page:
   which ES modules actually mounted, what window.MythicBridge really returns,
   whether AthenaEngine registered its game scenes, what a screen renders.
   This server boots the real page in headless Chromium and answers those.

   ⚠ THE REASON THIS EARNS ITS KEEP. CLAUDE.md: a module that fails to parse
   is reported at runtime as "not mounted (non-fatal)" and is INDISTINGUISH-
   ABLE from the module being absent. The check it names for this,
   .gauntlet/modcheck.mjs, is not in this branch — .gauntlet/ holds only
   _forge-harness.mjs. So right now nothing catches a dead module. The
   `modules` tool below does: it boots the page and reports, per module, the
   real outcome with the real error.

   🔴 SAFETY, same rule as the smoke suite (_forgesave_proof.mjs): the page is
   served from a local http server and EVERY off-origin request is aborted.
   This never reaches Supabase, the worker, Colyseus or a CDN. It cannot
   mutate a player's data because it can never talk to anything that stores
   it. Do not "fix" that by allowing the origin through — the whole point is
   that Bruce can poke the live page without touching production.

   NO NPM DEPENDENCY (CLAUDE.md: none without asking). MCP over stdio is
   JSON-RPC 2.0 in newline-delimited JSON, which is ~40 lines of plain Node;
   playwright is already a devDependency and every *_smoke.mjs drives it.

   Wire it up in .mcp.json:
     "mythic-game": { "command": "node", "args": ["tools/gamedev/mcp.mjs"] }

   Run it by hand to check it serves (it will sit waiting on stdin):
     echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node tools/gamedev/mcp.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PUBLIC = path.join(ROOT, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

/* ── the page, booted once and reused ────────────────────────────────────────
   index.html is 16 MB and parses for seconds; booting per tool call would make
   every question cost that. One page is kept alive for the life of the server
   and `reset` reboots it when a tool run has dirtied the state. */
let BOOT = null;                       // Promise of { browser, page, server, port, log }

async function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
    if (!f.startsWith(PUBLIC) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

async function boot() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (e) { throw new Error('playwright is not installed. It is a declared devDependency — run: npm install'); }

  const { server, port } = await serve();
  let browser;
  try { browser = await chromium.launch({ args: ['--no-sandbox'] }); }
  catch (e) {
    /* playwright pins a browser BUILD, so a machine whose installed browser
       predates the installed playwright fails here with "Executable doesn't
       exist at …-1243/…" while a perfectly good …-1194 sits next to it. That
       is an environment drift, not a missing browser — find one and use it
       rather than making the caller run `npx playwright install`. */
    const exe = findChrome();
    if (!exe) { server.close(); throw new Error('cannot launch chromium: ' + short(e) + '\nInstall it with: npx playwright install chromium'); }
    try { browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: exe }); }
    catch (e2) { server.close(); throw new Error('cannot launch chromium even at ' + exe + ': ' + short(e2)); }
  }
  const page = await browser.newPage();
  const log = { pageErrors: [], console: [], blocked: new Set(), missing: new Set() };
  page.on('pageerror', e => log.pageErrors.push(short(e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(m.type()[0].toUpperCase() + ': ' + m.text().slice(0, 300)); });
  /* A same-origin non-200 is a file index.html asks for that is not in public/.
     The console only says "404 (Not Found)" without the path, which is useless;
     record the path so the report can name it. */
  page.on('response', r => { try { if (r.url().startsWith('http://127.0.0.1:' + port) && r.status() >= 400) log.missing.add(r.status() + ' ' + new URL(r.url()).pathname); } catch (e) {} });

  /* 🔴 every off-origin request dies here. See the header. */
  const OWN = 'http://127.0.0.1:' + port;
  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith(OWN)) return r.continue();
    try { log.blocked.add(new URL(u).host); } catch (e) {}
    return r.abort();
  });

  await page.goto(OWN + '/index.html', { waitUntil: 'domcontentloaded' });
  /* Modules are type="module": they run after the parser finishes and some
     mount on load. Give them a beat rather than racing them. */
  await page.waitForTimeout(1500);
  return { browser, page, server, port, log };
}

/* Any chrome/chrome-headless-shell under the browsers dir, newest build first.
   MYTHIC_MCP_CHROME overrides when a machine keeps its browser elsewhere. */
function findChrome() {
  if (process.env.MYTHIC_MCP_CHROME && existsSync(process.env.MYTHIC_MCP_CHROME)) return process.env.MYTHIC_MCP_CHROME;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return null;
  const builds = readdirSync(base).filter(d => /^chromium/.test(d))
    .sort((a, b) => (+(b.match(/(\d+)$/) || [0, 0])[1]) - (+(a.match(/(\d+)$/) || [0, 0])[1]));
  for (const d of builds) {
    for (const rel of [['chrome-linux', 'chrome'], ['chrome-headless-shell-linux64', 'chrome-headless-shell'], ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'], ['chrome-win', 'chrome.exe']]) {
      const p = path.join(base, d, ...rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function live() { return (BOOT = BOOT || boot()); }

async function reset() {
  if (!BOOT) return 'not booted';
  const b = await BOOT.catch(() => null);
  BOOT = null;
  if (b) { try { await b.browser.close(); } catch (e) {} try { b.server.close(); } catch (e) {} }
  return 'page closed — the next call boots a fresh one';
}

const short = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);

/* ── the tools ─────────────────────────────────────────────────────────────
   Each returns a plain string; the transport wraps it. Keep the output terse
   and grep-able — it is read by an agent with a context budget, not a human
   with a scrollbar. */
const TOOLS = {
  boot: {
    description: 'Boot the real game page in headless Chromium and report how it went: page errors, console errors/warnings, and which off-origin hosts were blocked. Call this first when something "works in source but not in the game". The page stays alive for later calls.',
    schema: { type: 'object', properties: {} },
    async run() {
      const { log, port } = await live();
      const out = ['page booted on 127.0.0.1:' + port + ' (off-origin blocked)'];
      out.push('', 'pageerrors (' + log.pageErrors.length + '):');
      out.push(...(log.pageErrors.length ? log.pageErrors.map(e => '  ✗ ' + e) : ['  none']));
      out.push('', 'console errors/warnings (' + log.console.length + '):');
      out.push(...(log.console.length ? log.console.slice(0, 40).map(e => '  ' + e) : ['  none']));
      if (log.console.length > 40) out.push('  … ' + (log.console.length - 40) + ' more');
      out.push('', 'MISSING same-origin files (' + log.missing.size + ') — these are real, the page asked public/ for them:');
      out.push(...(log.missing.size ? [...log.missing].map(m => '  ✗ ' + m) : ['  none']));
      out.push('', 'blocked off-origin hosts (expected — this server never talks to them): ' + ([...log.blocked].join(', ') || 'none'));
      return out.join('\n');
    },
  },

  modules: {
    description: 'Which ES modules under public/src actually MOUNTED in the live page, and which failed with what error. This is the check CLAUDE.md calls mandatory but whose script (.gauntlet/modcheck.mjs) is missing from this branch — a module that fails to parse looks exactly like a module that was never added.',
    schema: { type: 'object', properties: {} },
    async run() {
      const { page } = await live();
      /* The <script type="module" src=...> tags in index.html are the roster.
         A module that parsed and ran leaves its global; one that threw does
         not. We cannot see "did this file parse" from inside, so we re-import
         each one and report what the browser says — an already-loaded module
         resolves from cache, a broken one throws the real parse error. */
      const res = await page.evaluate(async () => {
        const tags = [...document.querySelectorAll('script[type="module"][src]')].map(s => s.getAttribute('src'));
        const out = [];
        for (const src of tags) {
          const url = new URL(src, location.href).href;
          try { await import(/* webpackIgnore: true */ url); out.push({ src, ok: true }); }
          catch (e) { out.push({ src, ok: false, err: String((e && e.message) || e).slice(0, 200) }); }
        }
        return out;
      });
      const bad = res.filter(r => !r.ok);
      const lines = [res.length + ' module tags · ' + (res.length - bad.length) + ' loaded · ' + bad.length + ' FAILED'];
      if (bad.length) { lines.push(''); bad.forEach(b => lines.push('  ✗ ' + b.src + '\n      ' + b.err)); }
      lines.push('', 'loaded:');
      res.filter(r => r.ok).forEach(r => lines.push('  ✓ ' + r.src));
      return lines.join('\n');
    },
  },

  bridge: {
    description: 'The LIVE window.MythicBridge surface — every key, its type, and for zero-arg getters the value it actually returns right now. The globals trap (CLAUDE.md) means a module can only see what the bridge hands it, so this answers "can my module get X" definitively instead of by reading index.html.',
    schema: { type: 'object', properties: { call: { type: 'string', description: 'Optional dotted path to invoke, e.g. "miniGames" or "ui.data". Zero-arg only.' } } },
    async run(args) {
      const { page } = await live();
      const res = await page.evaluate((callPath) => {
        const b = window.MythicBridge;
        if (!b) return { missing: true };
        if (callPath) {
          let cur = b;
          for (const seg of callPath.split('.')) { if (cur == null) break; cur = cur[seg]; }
          if (cur == null) return { called: callPath, err: 'no such path' };
          try { const v = typeof cur === 'function' ? cur() : cur; return { called: callPath, value: JSON.parse(JSON.stringify(v ?? null)) }; }
          catch (e) { return { called: callPath, err: String((e && e.message) || e).slice(0, 200) }; }
        }
        const keys = Object.keys(b).map(k => {
          let t = typeof b[k], note = '';
          if (t === 'function') { try { const v = b[k].length === 0 ? b[k]() : '(needs args)'; note = b[k].length === 0 ? ' → ' + brief(v) : ' (arity ' + b[k].length + ')'; } catch (e) { note = ' → THREW: ' + String((e && e.message) || e).slice(0, 80); } }
          else if (t === 'object' && b[k]) note = ' {' + Object.keys(b[k]).join(', ').slice(0, 200) + '}';
          return { k, t, note };
        });
        function brief(v) {
          if (v == null) return String(v);
          if (Array.isArray(v)) return 'Array(' + v.length + ')';
          if (typeof v === 'object') return '{' + Object.keys(v).slice(0, 8).join(',') + '}';
          return String(v).slice(0, 80);
        }
        return { keys };
      }, args && args.call ? String(args.call) : '');
      if (res.missing) return 'window.MythicBridge is not defined — index.html has not reached the bridge block, or it threw before it.';
      if (res.called) return res.err ? res.called + ' → ERROR: ' + res.err : res.called + ' →\n' + JSON.stringify(res.value, null, 2).slice(0, 4000);
      return 'MythicBridge: ' + res.keys.length + ' keys\n' + res.keys.map(x => '  ' + x.k.padEnd(22) + x.t + x.note).join('\n');
    },
  },

  athena: {
    description: 'Live ⚒ Athena Engine status: API surface, version, which mini-games registered a game scene, the quality ladder, and whether the editor is open. Answers "did Athena actually come up" without opening the editor.',
    schema: { type: 'object', properties: {} },
    async run() {
      const { page } = await live();
      const res = await page.evaluate(() => {
        const A = window.AthenaEngine;
        if (!A) return { missing: true };
        const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
        return {
          version: A.version,
          alias: window.MythicMapForge === A,
          api: Object.keys(A),
          isOpen: safe(() => !!A.isOpen(), null),
          games: safe(() => (A.games.list() || []).map(g => g && (g.id || g)), []),
          quality: safe(() => A.quality.get(), null),
          miniGames: safe(() => (window.MythicBridge.miniGames() || []).length, null),
          inWorld: safe(() => !!A.inWorld(), null),
        };
      });
      if (res.missing) return 'window.AthenaEngine is not defined — src/mapforge/index.js did not mount. Run the `modules` tool to see why.';
      return [
        'AthenaEngine v' + res.version + (res.alias ? '  (MythicMapForge alias OK)' : '  ⚠ alias MISSING'),
        'editor open: ' + res.isOpen + '   in a world: ' + res.inWorld,
        'registered game scenes (' + res.games.length + '): ' + (res.games.join(', ') || 'none'),
        'mini-games with a world slot: ' + res.miniGames,
        'quality: ' + JSON.stringify(res.quality),
        'api (' + res.api.length + '): ' + res.api.join(', '),
      ].join('\n');
    },
  },

  screen: {
    description: 'Navigate the live game to a screen id (an App.screen value, e.g. "title", "camp", "cardShop") and report what rendered: heading text, control counts, and any new page errors. Use to see whether a screen actually paints.',
    schema: { type: 'object', properties: { id: { type: 'string', description: 'App.screen id to open' } }, required: ['id'] },
    async run(args) {
      const { page, log } = await live();
      const before = log.pageErrors.length;
      const res = await page.evaluate((id) => {
        const b = window.MythicBridge;
        let navd = false;
        try { navd = !!(b && b.openScreen && b.openScreen(id)); } catch (e) {}
        const app = document.getElementById('app');
        const txt = (el) => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          navd,
          screen: (() => { try { return b.screen(); } catch (e) { return '?'; } })(),
          heading: txt(app && app.querySelector('h1,h2,h3')).slice(0, 160),
          buttons: app ? app.querySelectorAll('button').length : 0,
          inputs: app ? app.querySelectorAll('input,select,textarea').length : 0,
          chars: app ? (app.textContent || '').trim().length : 0,
        };
      }, String(args.id));
      await page.waitForTimeout(400);
      const fresh = log.pageErrors.slice(before);
      return [
        'openScreen("' + args.id + '") → ' + (res.navd ? 'accepted' : 'REFUSED (bridge returned false — unknown id?)'),
        'App.screen is now: ' + res.screen,
        'heading: ' + (res.heading || '(none)'),
        'controls: ' + res.buttons + ' buttons, ' + res.inputs + ' inputs · ' + res.chars + ' chars of text',
        fresh.length ? 'NEW page errors:\n' + fresh.map(e => '  ✗ ' + e).join('\n') : 'no new page errors',
      ].join('\n');
    },
  },

  eval: {
    description: 'Evaluate a JavaScript expression inside the live page and return the JSON result. The escape hatch for anything the other tools do not cover — reads the real in-memory catalogs, module state, DOM. Runs in the sandboxed page with all off-origin traffic blocked.',
    schema: { type: 'object', properties: { expr: { type: 'string', description: 'Expression to evaluate. Async is awaited. Example: Object.keys(MOVES).length' } }, required: ['expr'] },
    async run(args) {
      const { page } = await live();
      const res = await page.evaluate(async (src) => {
        try {
          // eslint-disable-next-line no-new-func
          const v = await (new Function('return (' + src + ')'))();
          if (typeof v === 'function') return { ok: true, out: 'ƒ ' + (v.name || 'anonymous') + '/' + v.length };
          return { ok: true, out: JSON.stringify(v ?? null, (k, x) => (typeof x === 'function' ? 'ƒ ' + (x.name || '') : x), 2) };
        } catch (e) { return { ok: false, out: String((e && e.stack) || e).slice(0, 800) }; }
      }, String(args.expr));
      const body = String(res.out == null ? 'undefined' : res.out);
      return (res.ok ? '' : 'ERROR: ') + (body.length > 8000 ? body.slice(0, 8000) + '\n… truncated (' + body.length + ' chars)' : body);
    },
  },

  reset: {
    description: 'Close the booted page so the next call starts from a clean boot. Use after a tool run has dirtied game state, or to re-read index.html after editing it.',
    schema: { type: 'object', properties: {} },
    run: () => reset(),
  },
};

/* ── MCP over stdio: JSON-RPC 2.0, newline-delimited ───────────────────────── */
let INFLIGHT = 0;                       // tools/call runs still awaiting an answer; shutdown drains these
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    /* Echo the client's protocol version when it sends one — this server has no
       version-specific behaviour, so agreeing is always correct and avoids a
       mismatch rejection from a newer or older client than we guessed. */
    return ok(id, {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'mythic-game', version: '1.0.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;  // no reply to a notification
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') {
    return ok(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) });
  }
  if (method === 'tools/call') {
    const t = TOOLS[params && params.name];
    if (!t) return err(id, -32602, 'no such tool: ' + (params && params.name));
    INFLIGHT++;
    try {
      const text = await t.run((params && params.arguments) || {});
      return ok(id, { content: [{ type: 'text', text: String(text) }] });
    } catch (e) {
      /* A tool that throws is a RESULT with isError, not a protocol error — the
         agent should see the message and adapt, not get a dead transport. */
      return ok(id, { content: [{ type: 'text', text: 'tool failed: ' + short(e) }], isError: true });
    } finally { INFLIGHT--; }
  }
  if (id !== undefined) err(id, -32601, 'method not found: ' + method);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }   // a partial or junk line is not worth killing the server over
    Promise.resolve(handle(msg)).catch(e => { if (msg && msg.id !== undefined) err(msg.id, -32603, short(e)); });
  }
});
/* Shut down only once the in-flight calls have answered. stdin ends the moment
   a piped batch is consumed, long before a boot-and-query pair has finished —
   tearing the browser down there kills the very call the caller is waiting on
   ("Target page, context or browser has been closed"). A real client holds
   stdin open, so this only bites scripted use, which is exactly how the tool
   gets tested. */
async function shutdown() {
  for (let i = 0; INFLIGHT > 0 && i < 600; i++) await new Promise(r => setTimeout(r, 100));
  await reset();
  process.exit(0);
}
process.stdin.on('end', shutdown);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
