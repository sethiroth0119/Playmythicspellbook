/* ══════════════════════════════════════════════════════════════════════════
   BOARD SCREENSHOT HARNESS — the battle board, on this machine.

   Boots public/battle-board/index.html in real Chromium, serving public/ from
   an in-process loopback server, and writes a PNG. It exists because the two
   ways of looking at the board that this repo already had do not work here:

     • .gauntlet/shot.mjs imports playwright from /opt/node22 and boots
       node-city. Both are Linux-container assumptions; on Windows the import
       resolves to nothing and the target is the wrong page.
     • The editor's own preview pane can be pinned to a different project, in
       which case every URL 404s and the board is simply unreachable.

   Without it, a change to how tiles are drawn can only be argued about. With
   it, an A/B is two files you can put side by side. CLAUDE.md's note about the
   pane compositing at ~0.56 Hz does NOT apply here — this is real Chromium with
   a real rAF, so the board bakes and renders normally.

   Usage:
     node .gauntlet/boardshot.mjs out.png [--wait ms] [--w px] [--h px]
                                          [--eval "js run before the shot"]

   Prints JSON: {out, diag, logs}. `diag` carries the board build, the surface
   count and the canvas size, so a caller can tell "rendered a board" from
   "rendered a blank page" — the same reason shot.mjs reports its scene count.
   `diag.frame` says whether those numbers were read from the top document or
   from the stage iframe; see THE DIAG FRAME note further down. `--page
   /battle-board/_harness.html?scene=…&shot=1` is a supported target and now
   reports real numbers — before 2026-09-14 it reported a blank page for every
   harness capture regardless of what the PNG contained.

   The standalone board has no host map, so every tile is `dirt`. To see real
   ground, post one:
     --eval "window.postMessage({type:'board:map',map:{cols:14,rows:12,
              tiles:[{x:0,z:0,surf:'lava'}, …]}},location.origin)"
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.txt':'text/plain', '.webp':'image/webp',
  '.avif':'image/avif', '.gif':'image/gif', '.mp3':'audio/mpeg', '.woff2':'font/woff2' };

const args  = process.argv.slice(2);
const out   = args[0] || 'board.png';
const argOf = (k, d) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : d; };
const WAIT  = +argOf('--wait', 6000);
const W     = +argOf('--w', 1600);
const H     = +argOf('--h', 900);
const EVAL  = argOf('--eval', '');
/* --page lets this boot node-city (or any page under public/) instead of the
   board. The flicker hunt needed the city; everything else wants the board. */
const PAGE  = argOf('--page', '/battle-board/index.html');

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  /* never serve outside public/ — this listens on loopback but the rule is
     cheap and a path traversal here would read the whole repo */
  if (!path.resolve(f).startsWith(path.resolve(ROOT))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end('404 ' + p); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(b);
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

const browser = await chromium.launch({
  /* SwiftShader so this works on a box with no GPU, same as shot.mjs */
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text']
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));

await page.goto('http://127.0.0.1:' + PORT + PAGE,
                { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(WAIT);
if (EVAL) {
  /* a map push re-bakes the terrain, which is staged across several tasks —
     give it room or the shot catches the board mid-bake */
  try { await page.evaluate(EVAL); await page.waitForTimeout(2500); }
  catch (e) { logs.push('EVAL: ' + e.message); }
}

/* --watch <ms>: arm a DOM-write counter, wait, and report the busiest
   targets. A flicker is a write that lands often and changes nothing. */
const WATCH = +argOf('--watch', 0);
let flick = null;
if (WATCH > 0) {
  try {
    await page.evaluate(fs.readFileSync(new URL('./flickerwatch.js', import.meta.url), 'utf8'));
    await page.waitForTimeout(WATCH);
    flick = await page.evaluate('window.__flick && window.__flick()');
  } catch (e) { logs.push('WATCH: ' + e.message); }
}
/* 🖼 FIND THE DOCUMENT THE BOARD IS ACTUALLY IN.
   The diag below used to run in the TOP document only. That is correct for
   --page /battle-board/index.html, where the board IS the top document — but
   `_harness.html` mounts the stage in an IFRAME, exactly the way the game's
   `_bbStageMount()` does, which is the whole reason the harness is trustworthy.
   So every harness capture reported {build:undefined, surfaces:'n/a', canvas:0,
   size:null} — the diag's own "rendered a board vs rendered a blank page" test
   answering "blank page" while the PNG beside it was perfect. A rig that cannot
   tell those two apart is not evidence, and the harness is the ONLY honest view
   of the in-game framing (the standalone board zeroes CONFIG.SAFE).

   ⚠ FALL BACK, DO NOT THROW. `--page` also boots node-city, which has no
   BB_BUILD in any frame and never will. A missing board is not an error here:
   we return to the main frame and report what it has, and the run still exits
   0. Making this throw would break the flicker hunt that --page exists for. */
const boardFrame = await (async () => {
  const has = async f => { try { return !!(await f.evaluate(() => window.BB_BUILD)); } catch (e) { return false; } };
  if (await has(page.mainFrame())) return page.mainFrame();
  for (const f of page.frames()) if (f !== page.mainFrame() && await has(f)) return f;
  return page.mainFrame();          // node-city, or a board that failed to boot
})();
const inIframe = boardFrame !== page.mainFrame();

/* --report <expr>: evaluate an expression AFTER the watch window and carry
   the result out. Pairs with an --eval that armed a counter.
   Runs in the BOARD's frame for the same reason the diag does — the expressions
   callers pass are board globals (CAM_BASE, TSEC, camCheck(), __bbHexCheck),
   none of which exist in the harness's top document. --eval deliberately stays
   on the top document: it speaks the board:* postMessage protocol AT the stage
   the way the host does, so it must run where the host runs. */
const REPORT = argOf('--report', '');
let report = null;
if (REPORT) { try { report = await boardFrame.evaluate(REPORT); } catch (e) { logs.push('REPORT: ' + e.message); } }
const diag = await boardFrame.evaluate(() => {
  const o = {};
  try { o.build = window.BB_BUILD; } catch (e) {}
  try { o.surfaces = (typeof _SURF_ORDER !== 'undefined') ? _SURF_ORDER.length : 'n/a'; } catch (e) { o.surfaces = 'n/a'; }
  try { o.paintings = (typeof tileArtSrcs === 'function') ? tileArtSrcs().length : 'n/a'; } catch (e) { o.paintings = 'n/a'; }
  try { o.canvas = document.querySelectorAll('canvas').length; } catch (e) {}
  try { const c = document.querySelector('canvas'); o.size = c ? (c.width + 'x' + c.height) : null; } catch (e) {}
  return o;
});
/* Say WHERE these numbers came from. Without this a reader cannot tell a board
   that booted in an iframe from one that failed to boot and fell back to the
   top document — the two used to be indistinguishable in the output. */
diag.frame = inIframe ? 'iframe' : 'top';

await page.screenshot({ path: out });
await browser.close();
srv.close();
console.log(JSON.stringify({ out, diag, report, flick, logs: logs.slice(0, 25) }, null, 1));
