/* ══════════════════════════════════════════════════════════════════════════
   BATTLE REPORT ON THE LEFT RAIL — a real battle screen, a real report.

   Owner: "Move the battle report over here … over the red panel" — the dark,
   empty stretch of the left rail above the opponent's cluster.

   Boots a solo battle the way _probe-banner-geom.mjs does, raises one report
   row through Juice.eventChip, screenshots the page and prints the rects of the
   left rail's children, the report and the board so the placement is measured,
   not eyeballed.

   Usage: node .gauntlet/feed-rail-shot.mjs out.png [--w 1920 --h 1080]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'feed-rail.png';
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const W = +flag('w', 1920), H = +flag('h', 1080);
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const P = 7950 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: W, height: H } });
pg.on('pageerror', () => {});
await pg.route('**/*', (r) => { const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('fonts.g')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof initGame==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4500);
const info = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  try { localStorage.setItem('mg_onboarded', '1');
    document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.auth-gate,#auth-overlay,.modal-overlay').forEach(e => e.remove()); } catch (e) {}
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null); App.screen = 'battle';
  try { if (typeof _uiAutoScale === 'function') _uiAutoScale(); } catch (e) {}
  renderBattleNow(); await sleep(2500);
  try { document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.modal-overlay').forEach(e => e.remove()); } catch (e) {}
  window.Juice.eventChip({ icon: '🔍', label: 'Searched the deck and added Cabrakan Knight protector of Realms to hand.', kind: 'event' });
  await sleep(600);
  const rc = (e) => { const q = e.getBoundingClientRect(); return { x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height), b: Math.round(q.bottom) }; };
  const left = document.querySelector('.battle-screen .battle-left') || document.querySelector('.battle-left');
  const kids = left ? [...left.children].map(e => ({ cls: String(e.className).slice(0, 50), ...rc(e), bg: getComputedStyle(e).backgroundColor })) : [];
  const feed = document.getElementById('battle-event-feed');
  const board = document.querySelector('.board-area') || document.querySelector('.board');
  return { left: left ? rc(left) : null, kids, feed: feed ? rc(feed) : null, board: board ? rc(board) : null,
    rail: getComputedStyle(document.documentElement).getPropertyValue('--btl-rail-w'),
    banner: getComputedStyle(document.documentElement).getPropertyValue('--hud-banner-h') };
});
await pg.screenshot({ path: out });
await b.close(); srv.close();
console.log(JSON.stringify(info, null, 1));
/* the placement the owner pointed at: right of the rail, inside the board
   column, in its upper sky (above the dock), never centred over the tiles */
const f = info.feed, L = info.left, B = info.board;
const checks = [
  ['report is right of the left rail', f && L && f.x >= L.x + L.w],
  ['…and starts at the board column', f && B && f.x >= B.x - 12],
  ['…in the left third of the board column', f && B && f.x + f.w <= B.x + B.w / 3],
  /* the board-area box includes the dome sky, so measure against the viewport */
  ['…in the upper third of the screen (the sky)', f && f.b <= H / 3],
];
let bad = 0;
for (const [l, c] of checks) { if (!c) bad++; console.log((c ? '  ok   ' : '  FAIL ') + l); }
process.exit(bad ? 1 : 0);
