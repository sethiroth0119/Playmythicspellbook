/* one-off: where are the rails, the board and the legal tiles, at three widths? */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 7900 + (process.pid % 50);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
for (const [W, H] of [[1920, 1080], [1440, 900], [1100, 800]]) {
  const pg = await b.newPage({ viewport: { width: W, height: H } });
  pg.on('pageerror', () => {});
  await pg.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('fonts.g')) return r.continue(); return r.abort(); });
  await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('typeof initGame==="function"', null, { timeout: 180000 }).catch(() => {});
  await pg.waitForTimeout(4500);
  const r = await pg.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    try { localStorage.setItem('mg_onboarded', '1');
      document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.auth-gate,#auth-overlay,.modal-overlay').forEach(e => e.remove()); } catch (e) {}
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null); App.screen = 'battle';
    try { if (typeof _uiAutoScale === 'function') _uiAutoScale(); } catch (e) {}
    renderBattleNow(); await sleep(1300);
    try { document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.modal-overlay').forEach(e => e.remove()); } catch (e) {}
    App.state.turn = 'player'; App.state.player.energy = 9;
    let card = (App.state.player.hand || []).find(c => c && c.type === 'unit');
    if (!card) { const p = (App.state.player.deck || []).find(c => c && c.type === 'unit'); if (p) { App.state.player.hand.push(p); card = p; } }
    App.ui.selectedCardId = card ? card.instanceId : null;
    renderBattleNow(); await sleep(500);
    const bx = (sel) => { for (const s of sel.split('|')) { const e = document.querySelector(s.trim()); if (e) { const q = e.getBoundingClientRect();
      return { sel: s.trim(), x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) }; } } return null; };
    const tiles = [...document.querySelectorAll('.tile.placement')].map(e => { const q = e.getBoundingClientRect();
      return { x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) }; });
    const allTiles = [...document.querySelectorAll('.tile')].map(e => { const q = e.getBoundingClientRect(); return { x: q.left, y: q.top, r: q.right, b: q.bottom }; });
    return {
      vw: innerWidth, vh: innerHeight,
      left:  bx('aside.battle-left | .battle-left | .bc-rail'),
      right: bx('.bp-wrap.bsx | aside.battle-right | .battle-right'),
      board: bx('.board | .battle-grid | .board-wrap'),
      topbar: (() => { let bot = 0, who = null;
        document.querySelectorAll('body *').forEach(e => { const cs = getComputedStyle(e); if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
          const q = e.getBoundingClientRect(); if (q.top > 40 || q.height < 20 || q.width < 200 || q.bottom > innerHeight * 0.5) return;
          if (q.bottom > bot) { bot = q.bottom; who = e.className || e.id; } });
        return { bottom: Math.round(bot), who: String(who).slice(0, 60) }; })(),
      hand:  bx('.hand-strip | .hand-column'),
      banner: bx('.card-cancel-banner'),
      chain: (() => { const out=[]; let e=document.querySelector('.board'); let i=0;
        while (e && i++ < 6) { const q=e.getBoundingClientRect(); const cs=getComputedStyle(e);
          out.push({ tag:e.tagName.toLowerCase(), cls:String(e.className).slice(0,42), pos:cs.position, ov:cs.overflow, x:Math.round(q.left), y:Math.round(q.top), w:Math.round(q.width), h:Math.round(q.height) });
          e=e.parentElement; } return out; })(),
      placement: tiles,
      tileHull: allTiles.length ? { l: Math.round(Math.min(...allTiles.map(t => t.x))), r: Math.round(Math.max(...allTiles.map(t => t.r))),
                                    t: Math.round(Math.min(...allTiles.map(t => t.y))), b: Math.round(Math.max(...allTiles.map(t => t.b))) } : null,
    };
  });
  console.log('\n=== ' + W + '×' + H);
  console.log('  left rail  ' + JSON.stringify(r.left));
  console.log('  right rail ' + JSON.stringify(r.right));
  console.log('  board      ' + JSON.stringify(r.board));
  console.log('  topchrome  ' + JSON.stringify(r.topbar));
  console.log('  hand       ' + JSON.stringify(r.hand));
  console.log('  banner     ' + JSON.stringify(r.banner));
  console.log('  all tiles  ' + JSON.stringify(r.tileHull));
  console.log('  legal      ' + JSON.stringify(r.placement));
  (r.chain||[]).forEach(n=>console.log('   ↑ '+n.tag+'.'+n.cls+'  pos:'+n.pos+' ov:'+n.ov+'  '+n.x+','+n.y+' '+n.w+'×'+n.h));
  await pg.close();
}
await b.close(); srv.close();
