/* ══════════════════════════════════════════════════════════════════════════
   PACK PRICE PROBE — bug-mudymwdb: "card pack prices used to be 20,000 cinders
   and have dropped really low — 100 or 299."

   The fixture is not invented. It is the shape MEASURED on the live database
   on 2026-09-25:
     · card_catalog (the shared publish)  Birth Of Universe One = 25000,
       Revealing Realms = 24944, plus two Booster Boxes the old profiles never had
     · five players' profiles (07-29 → 09-18)  the same two packs at 299 and 100

   What must be true afterwards:
     · an ordinary player sees the PUBLISHED price, not their cached one;
     · the author (admin) still sees their own local draft, because that is where
       a pack is priced before it is published;
     · a pack that exists only locally still appears — the fix must not make
       anything vanish;
     · no id appears twice, for anyone.

   Usage: node .gauntlet/packprice-probe.mjs [root] [--index candidate.html]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r186/public');
const INDEX = flag('index', null);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const PORT = 9050 + Math.floor(Math.random() * 90);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (INDEX && p === '/index.html') f = path.resolve(INDEX);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof getAllCustomPacks === "function"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(1500);

const checks = [];
const ok = (name, pass, note) => { checks.push({ pass }); console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name + (note ? '   [' + note + ']' : '')); };

console.log('══ PACK PRICE PROBE ══');
console.log('  index : ' + (INDEX || "(the root's own)") + '\n');

const R = await page.evaluate(async () => {
  const out = {};
  const P1 = 'cpack_1779940171219';   // Birth Of Universe One
  const P2 = 'cpack_1780128552490';   // Revealing Realms
  const BOX = 'cpack_1785524759479';  // a Booster Box the old profiles never had
  const DRAFT = 'cpack_local_only';   // never published

  const setup = (adminEmail) => {
    Forge.customPacks = [
      { id: P1, name: 'Birth Of Universe One', cost: 299 },     // the stale cached copy
      { id: P2, name: 'Revealing Realms',      cost: 100 },     // the stale cached copy
      { id: DRAFT, name: 'Unpublished Draft',  cost: 1234 },    // local only
    ];
    Catalog.packs = [
      { id: P1, name: 'Birth Of Universe One', cost: 25000 },   // the publish
      { id: P2, name: 'Revealing Realms',      cost: 24944 },   // the publish
      { id: BOX, name: 'Booster Box',          cost: 45000 },
    ];
    Profile.cloud = { signedIn: true, userId: 'u', email: adminEmail || 'player@example.com' };
  };
  const costOf = (list, id) => { const p = list.find(x => x && x.id === id); return p ? p.cost : null; };

  /* ── an ordinary player ── */
  setup(null);
  out.playerIsAdmin = (typeof isAdmin === 'function') ? isAdmin() : null;
  const asPlayer = getAllCustomPacks();
  out.player = { p1: costOf(asPlayer, P1), p2: costOf(asPlayer, P2), box: costOf(asPlayer, BOX), draft: costOf(asPlayer, DRAFT), n: asPlayer.length };
  const ids = asPlayer.map(p => p.id);
  out.playerDupes = ids.length - new Set(ids).size;

  /* ── the author ── */
  const adminEmail = (typeof ADMIN_EMAILS !== 'undefined' && ADMIN_EMAILS.size)
    ? Array.from(ADMIN_EMAILS)[0] : null;
  out.adminEmail = adminEmail;
  if (adminEmail) {
    setup(adminEmail);
    out.adminIsAdmin = (typeof isAdmin === 'function') ? isAdmin() : null;
    const asAdmin = getAllCustomPacks();
    out.admin = { p1: costOf(asAdmin, P1), p2: costOf(asAdmin, P2), box: costOf(asAdmin, BOX), draft: costOf(asAdmin, DRAFT), n: asAdmin.length };
    const aids = asAdmin.map(p => p.id);
    out.adminDupes = aids.length - new Set(aids).size;
  }
  return out;
});

console.log('  as a player: ' + JSON.stringify(R.player));
if (R.admin) console.log('  as the author: ' + JSON.stringify(R.admin));

ok('1a a player sees the PUBLISHED price, not their cached 299', R.player.p1 === 25000, 'got ' + R.player.p1);
ok('1b …for the second stale pack too (was 100)', R.player.p2 === 24944, 'got ' + R.player.p2);
ok('1c …and a pack only the publish has still appears', R.player.box === 45000, 'got ' + R.player.box);
ok('1d …and a pack only they have locally is NOT lost', R.player.draft === 1234, 'got ' + R.player.draft);
ok('1e no id appears twice', R.playerDupes === 0, R.playerDupes + ' duplicate(s)');
ok('1f the fixture really is a non-admin', R.playerIsAdmin === false, 'isAdmin()=' + R.playerIsAdmin);

if (R.admin) {
  ok('2a the AUTHOR still sees their own local draft price', R.admin.p1 === 299 && R.admin.p2 === 100, 'got ' + R.admin.p1 + ' / ' + R.admin.p2);
  ok('2b …and the publish still fills in what they do not hold', R.admin.box === 45000, 'got ' + R.admin.box);
  ok('2c …with no duplicates either', R.adminDupes === 0, R.adminDupes + ' duplicate(s)');
  ok('2d the fixture really is the admin', R.adminIsAdmin === true, 'isAdmin()=' + R.adminIsAdmin);
} else {
  console.log('  note: ADMIN_EMAILS is empty in this build — the author half could not be staged');
}

const passed = checks.filter(c => c.pass).length;
console.log('\n  ' + passed + '/' + checks.length + ' checks passed' + (passed === checks.length ? '   ✅' : '   ❌'));
await browser.close(); srv.close();
process.exit(passed === checks.length ? 0 : 1);
