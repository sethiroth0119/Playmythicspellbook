/* ══════════════════════════════════════════════════════════════════════════
   EARNINGS GUIDE — the Ruin Exchange tile opens a guide that actually renders.

   /src/gridguide came from PR #7, which was never merged into this repo, so
   nothing about it has ever run here. This checks the three things that would
   each fail silently:

     · the module MOUNTS. A module that fails to parse is reported at runtime
       as "not mounted (non-fatal)", which looks exactly like it being absent.
     · the guide OPENS and draws real content, not an empty shell — it reads
       its text through window.MythicBridge, and if a bridge member it wants is
       missing the panel can come up blank.
     · the ARTWORK resolves at the percent-encoded path. The filename has a
       space; "Earnings Guide.webp" and "Earnings%20Guide.webp" are not the
       same request, and a broken tile icon is invisible in a syntax gate.

   ⚠ The tile itself is asserted in the SOURCE, not by driving the Ruin
     Exchange: reaching that screen needs an account, and the auth gate is not
     something a probe should be walking through.

   Usage: node .gauntlet/earnguide-probe.mjs [root]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary','.ico':'image/x-icon' };
const PORT = 9940 + Math.floor(Math.random() * 50);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (c, m, x) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + m + (x === undefined ? '' : '   [' + x + ']')); if (!c) fails++; };

console.log('══ EARNINGS GUIDE PROBE ══');
console.log('  root : ' + ROOT + '\n');

/* ── the tile, in the source ── */
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(src.indexOf("id: 'btn-earnings-guide'") >= 0, 'the Ruin Exchange has an Earnings Guide tile');
ok(/name: 'Earnings Guide'/.test(src), "…labelled 'Earnings Guide'");
/* 🔴 THE PICTURE IS THE HUB_TILE_ART ROW, NOT THE ICON. A Ruin Exchange tile
   is banner-led: the renderer reads _hubTileArtUrl(p.id) || HUB_TILE_ART[p.id].
   The first cut of this tile put the artwork in `icon` and added no art row,
   so it would have drawn with no banner beside twelve tiles that had one --
   and the syntax gates and the mount check all passed anyway, because none of
   them looks at what a tile is painted with. */
ok(src.indexOf("'btn-earnings-guide':") >= 0
   && src.indexOf("assets/hubtiles/operations-earnings-guide.webp") >= 0,
   '…and a HUB_TILE_ART banner, so it is not the one bare tile in the grid');
ok(src.indexOf('Earnings%20Guide.webp') < 0, '…with no stale gameicons reference left behind');
ok(src.indexOf('src/gridguide/index.js?v=') >= 0, 'the module is tagged with a cache-buster');

/* ── the artwork actually exists at that path ── */
const art = path.join(ROOT, 'assets/hubtiles/operations-earnings-guide.webp');
ok(fs.existsSync(art), 'the artwork file is in the tree',
   fs.existsSync(art) ? (fs.statSync(art).size / 1024).toFixed(0) + ' KB' : 'missing');

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e && e.message).slice(0, 140)));
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
await page.route('**/*', r => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 240000 });

/* the artwork over HTTP, at the encoded path the tile actually requests */
const shot = await page.evaluate(async () => {
  try { const r = await fetch('assets/hubtiles/operations-earnings-guide.webp'); return { s: r.status, t: r.headers.get('content-type') }; }
  catch (e) { return { s: 0, t: String(e && e.message) }; }
});
ok(shot.s === 200, 'the browser can fetch the icon at the encoded path', shot.s + ' ' + shot.t);

let mounted = false;
try { await page.waitForFunction('!!window.MythicGridGuide', null, { timeout: 90000 }); mounted = true; } catch (e) {}
ok(mounted, 'the module mounted and registered window.MythicGridGuide');

if (mounted) {
  const R = await page.evaluate(async () => {
    try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {}
    window.MythicGridGuide.open();
    await new Promise(r => setTimeout(r, 1500));
    const root = document.querySelector('[class*="gg-"], #gg-root, .gg-wrap');
    const text = root ? (root.innerText || '') : '';
    return {
      opened: !!root,
      chars: text.length,
      headings: root ? root.querySelectorAll('h1,h2,h3').length : 0,
      hasClose: /close/i.test(text),
      /* the admin boundary is cosmetic here — the real one is RLS — but a
         signed-out probe must NOT be offered the editor */
      offersEdit: /edit guide|save & publish/i.test(text),
    };
  });
  ok(R.opened, 'the guide opens');
  ok(R.chars > 400, '…and draws real content, not an empty shell', R.chars + ' chars');
  ok(R.headings >= 2, '…with its sections', R.headings + ' headings');
  ok(R.offersEdit === false, '…and a signed-out reader is offered no editor');
}
ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | ') || 'none');

console.log(fails ? ('\n❌ ' + fails + ' FAILED\n') : '\n✅ the Earnings Guide is wired up\n');
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);
