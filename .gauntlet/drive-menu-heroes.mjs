/* ══════════════════════════════════════════════════════════════════════════
   🎭 DRIVE-MENU-HEROES — "Do not reset these ever, do not erase them."

   THE REPORT: the Main-Menu Characters manager showed "No characters yet" while
   FIFTEEN characters were published and live (`mm:0`…`mm:14` in the catalogMedia
   shards; their PNGs still in the card-art bucket, uploaded 2026-08-03). Nothing
   had been deleted. The panel paints `Forge.mainMenuHeroes` — the admin's LOCAL
   working copy — which is empty on another device, another admin account, or
   simply before ~65 MB of shards has finished downloading.

   🔥 AND THAT PANEL WAS ONE CLICK FROM MAKING THE REPORT TRUE. Publish ships the
      working copy as the WHOLE roster: the `mm:N` keys are rebuilt from it, so
      an admin who saw "No characters yet", added one image and pressed Publish
      would have replaced fifteen with one — for every player, with no undo,
      because the published bundle is the only copy the game reads back.

   WHAT THIS PINS, in the real page:
     1. the reader sees a published roster in BOTH shapes it is stored in —
        flat `mm:N` keys and the unflattened array
     2. the panel never says "No characters yet" when a roster is live
     3. Restore pulls the live roster into the working copy, by VALUE
     4. 🔴 Publish with an empty working copy is REFUSED — cloudPublishCatalog
        is never called
     5. 🔴 THE CONTROL: with a matching roster the same button publishes
        normally, so (4) is a guard and not a broken button.

   Run:  node .gauntlet/drive-menu-heroes.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8530 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _mdOpenCharManager === "function" && typeof _mdPublishedHeroes === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof _mdOpenCharManager === 'function' && typeof _mdPublishedHeroes === 'function';
  if (!o.reachable) return o;

  // A 1x1 transparent PNG, long enough to pass the `src.length > 12` test that
  // separates a real image from a stripped placeholder.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const hero = (n) => ({ name: 'Hero ' + n, src: PNG });

  // ── 1 · the reader, in both stored shapes ────────────────────────────────
  Forge.catalogMedia = { 'mm:0': hero(1), 'mm:1': hero(2), 'mm:2': hero(3) };
  o.readsFlatKeys = _mdPublishedHeroes().length;
  Forge.catalogMedia = { mainMenuHeroes: [hero(1), hero(2), hero(3)] };
  o.readsUnflattened = _mdPublishedHeroes().length;

  // Admin, so the manager opens at all. isAdmin() reads Profile.cloud.email
  // against ADMIN_EMAILS — a function declaration, so it is reassignable here.
  const _realAdmin = isAdmin;
  isAdmin = () => true;

  // ── 2 · the panel does not lie ───────────────────────────────────────────
  Forge.mainMenuHeroes = [];
  _mdOpenCharManager();
  const box = document.getElementById('md-char-mgr');
  o.opened = !!box;
  const listText = () => (document.querySelector('#md-char-mgr .mdcm-list') || {}).textContent || '';
  o.emptyPanelText = listText().replace(/\s+/g, ' ').trim().slice(0, 120);
  o.saysNoCharacters = /No characters yet/i.test(listText());
  o.offersRestore = !!document.querySelector('#md-char-mgr [data-restore]');

  // ── 3 · restore, by value ────────────────────────────────────────────────
  document.querySelector('#md-char-mgr [data-restore]').click();
  o.afterRestore = (Forge.mainMenuHeroes || []).length;
  Forge.mainMenuHeroes[0].name = 'EDITED LOCALLY';
  o.publishedUntouched = Forge.catalogMedia.mainMenuHeroes[0].name === 'Hero 1';

  // ── 4 · the refusal. Stub the publish so nothing leaves the page. ────────
  let published = 0;
  const _realPub = window.cloudPublishCatalog;
  cloudPublishCatalog = async () => { published++; return { ok: true }; };
  cloudPublishCatalogArt = async () => ({ ok: true });

  Forge.mainMenuHeroes = [];                    // the exact state in the report
  document.querySelector('#md-char-mgr [data-pub]').click();
  await new Promise(r => setTimeout(r, 400));
  o.publishedOnEmpty = published;               // must stay 0

  // ── 5 · THE CONTROL — a matching roster publishes normally ───────────────
  Forge.mainMenuHeroes = [hero(1), hero(2), hero(3)];
  document.querySelector('#md-char-mgr [data-pub]').click();
  await new Promise(r => setTimeout(r, 600));
  o.publishedOnMatch = published;               // must be 1

  try { document.getElementById('md-char-mgr').remove(); } catch (e) {}
  isAdmin = _realAdmin; window.cloudPublishCatalog = _realPub;
  return o;
});

const bad = [];
const need = (k, ok) => { if (!ok) bad.push(k); };
if (!out.reachable) bad.push('the manager or the reader is not in this build');
else {
  need('reader sees flat mm:N keys', out.readsFlatKeys === 3);
  need('reader sees the unflattened array', out.readsUnflattened === 3);
  need('the manager opened', out.opened === true);
  need('panel does NOT claim "No characters yet"', out.saysNoCharacters === false);
  need('panel offers to load the live roster', out.offersRestore === true);
  need('restore loaded all three', out.afterRestore === 3);
  need('restore copied by value, not by reference', out.publishedUntouched === true);
  need('REFUSED: publish with an empty roster', out.publishedOnEmpty === 0);
  need('CONTROL: a matching roster still publishes', out.publishedOnMatch === 1);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 5) }, null, 2));
console.log(bad.length ? '\n❌ FAIL: ' + bad.join(' | ')
                       : '\n✅ PASS — a live roster can be seen and reloaded, and cannot be published away by an empty panel.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
