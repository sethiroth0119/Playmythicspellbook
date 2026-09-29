/* 📸 SHOT-MOVERING — a picture of the move ring as the player sees it, with the
   range on every chip. Boots a real battle, opens the ring on a player unit and
   crops to it. Run: node .gauntlet/_shot-movering.mjs [out.png] */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const OUT = process.argv[2] || 'tmp/move-ring.png';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 7700 + (process.pid % 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
pg.on('pageerror', () => {});
await pg.route('**/*', (r) => { const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('fonts.g')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof initGame==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(5000);
const info = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  try {
    localStorage.setItem('mg_onboarded', '1');
    document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.auth-gate,#auth-overlay,.modal-overlay').forEach(e => e.remove());
  } catch (e) {}
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null); App.screen = 'battle';
  try { if (typeof _uiAutoScale === 'function') _uiAutoScale(); } catch (e) {}
  renderBattleNow();
  await sleep(1400);
  try { document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.modal-overlay').forEach(e => e.remove()); } catch (e) {}
  App.state.turn = 'player'; App.state.player.energy = 9;
  const u = (App.state.units || []).find(x => x && x.alive && x.owner === 'player' && (x.knownMoves || []).length);
  if (!u) return { err: 'no unit' };
  /* Give it a self-buff too, so the shot shows an ability chip beside the attacks. */
  try {
    const all = (typeof MOVES === 'object' && MOVES) ? Object.values(MOVES) : [];
    const ab = all.find(m => m && _moveIsNoTarget(m) && (m.cost | 0) <= 3 && m.kind !== 'summon');
    if (ab && !(u.knownMoves || []).includes(ab.id)) u.knownMoves = [ab.id].concat(u.knownMoves || []);
  } catch (e) {}
  const el = document.querySelector('[data-unit-id="' + u.id + '"]') || document.querySelector('.battle-screen');
  window.__anchorRect = el.getBoundingClientRect();
  eval('_uhmRect = window.__anchorRect');            // top-level `let` — see the note in drive-move-range
  App.ui.selectedUnitId = u.id;
  const opened = _openMoveRing(u.id);
  await sleep(500);
  const r = document.getElementById('move-ring');
  const chips = [...document.querySelectorAll('#move-ring .mvr-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim());
  let bx = null;
  if (r) {
    let l = 1e9, t = 1e9, rt = -1e9, bt = -1e9;
    document.querySelectorAll('#move-ring .mvr-chip').forEach(c => {
      const q = c.getBoundingClientRect();
      l = Math.min(l, q.left); t = Math.min(t, q.top); rt = Math.max(rt, q.right); bt = Math.max(bt, q.bottom);
    });
    bx = { x: Math.max(0, l - 24), y: Math.max(0, t - 24), width: Math.min(1600, rt - l + 48), height: Math.min(950, bt - t + 48) };
  }
  return { opened: !!opened, chips, bx, unit: u.name || u.id };
});
if (info.err) { console.log('FATAL ' + info.err); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await pg.screenshot({ path: OUT, clip: info.bx || undefined });
await b.close(); srv.close();
console.log('\n  unit  : ' + info.unit + '   ring opened: ' + info.opened);
info.chips.forEach(c => console.log('  chip  : ' + c));
console.log('\n  → ' + OUT + '\n');
