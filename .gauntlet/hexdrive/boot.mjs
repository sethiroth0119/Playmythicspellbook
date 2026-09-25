// Boot rig for the hex-contract drivers.
//
// WHY a bespoke server: there is no http-server binary in this repo and the app
// must be served over http:// (file:// breaks the module graph and the
// battle-board iframe). Node's own http + fs is enough and has no dependency.
//
// WHY bare identifiers in every probe: Profile / App / distance / BOARD_W are
// top-level `const` in index.html — LEXICAL globals, NOT window.*. Reading
// window.distance returns undefined and scores a silent false result. Every
// probe below therefore calls the shipping function by bare name, which is the
// only way to be sure we measured the merged code and not a copy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(process.env.SERVE_ROOT || 'D:/game-deploy/public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.jsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.ico': 'image/x-icon',
};

// Optional per-path source transform, so a probe can EXPOSE a module-internal
// function without editing the repo file. Pure additions only — the module the
// browser runs must still be the shipped one.
export const OVERLAY = new Map();   // '/src/battle/stage/tilefx.js' -> fn(srcString) => srcString

export async function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    if (OVERLAY.has(p)) {
      const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
      const out = OVERLAY.get(p)(src);
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(out); return;
    }
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + p); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

// Boots the real page and starts a real match. Returns { page, browser, close }.
export async function bootMatch({ headless = true, viewport = { width: 1600, height: 900 } } = {}) {
  const { server, port } = await serve();
  const browser = await chromium.launch({ headless, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 400)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Wait for the lexical globals to exist. `typeof X` on an undeclared lexical
  // const in TDZ throws, so this is wrapped.
  await page.waitForFunction(() => {
    try { return typeof BOARD_W === 'number' && typeof startBattleWithPrep === 'function'; }
    catch (e) { return false; }
  }, null, { timeout: 120000 });

  const started = await page.evaluate(() => {
    try {
      // `opponent`, not `aiHero` — startBattleWithPrep reads bp.opponent and
      // silently bounces to deckSelect otherwise (App.state stays null).
      App.battlePrep = App.battlePrep || {};
      App.battlePrep.hero = STARTER_HEROES[0];
      App.battlePrep.opponent = STARTER_HEROES[1];
      App.battlePrep._exhaustedWarned = true; // skip the async confirm gate
      startBattleWithPrep(true);
      return { ok: true, hasState: !!App.state };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  });

  await page.waitForFunction(() => {
    try { return !!(App.state && App.state.board && App.state.board.length); } catch (e) { return false; }
  }, null, { timeout: 60000 }).catch(() => {});

  const close = async () => { await browser.close(); await new Promise(r => server.close(r)); };
  return { page, browser, close, started, pageErrors, port };
}
