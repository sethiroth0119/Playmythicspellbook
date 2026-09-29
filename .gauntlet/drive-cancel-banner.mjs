/* ══════════════════════════════════════════════════════════════════════════
   📐 DRIVE-CANCEL-BANNER — what does the "Summoning: …" pill actually cover?

   THE ASK: "move the summoning button where it isn't blocking the battlefield."

   The pill is `position:fixed; left:50%; bottom:260px` — centred on the
   VIEWPORT, which on a three-column battle layout is the middle of the hex
   board. And the pill's own copy is "Click a highlighted tile to confirm", so
   the banner sits on top of the very tiles it is telling the player to click.

   This measures that instead of arguing it:

     · every `.tile.placement` (the highlighted, legal drop tiles) is boxed
     · the pill is boxed
     · overlap is counted BY TILE, and separately as area, and the worst-covered
       tile is named
     · elementFromPoint is asked at each covered tile's centre — "click the
       middle of this tile; what do you actually hit?" — because a box overlap
       is geometry and this is the question the player is asking

   ⚠ THE TILES ARE THE TEST, NOT THE BOARD. Overlapping the sky at the top of
     the battlefield art blocks nothing playable; overlapping one legal tile
     blocks a move. A pass is ZERO covered tiles, not "less board than before".

   Run: node .gauntlet/drive-cancel-banner.mjs [width] [height]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const W = +(process.argv[2] || 1920), H = +(process.argv[3] || 1080);
const SHOT = process.argv.find(a => a.endsWith(".png"));   // optional: write a picture too
const P = 7820 + (process.pid % 60);
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
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('fonts.g')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof initGame==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(5000);

const out = await pg.evaluate(async () => {
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
  App.state.turn = 'player';
  App.state.player.energy = 9;

  /* Select a UNIT card from hand — that is the state the pill appears in. */
  let card = (App.state.player.hand || []).find(c => c && c.type === 'unit');
  if (!card) {
    const pool = (App.state.player.deck || []).find(c => c && c.type === 'unit');
    if (pool) { App.state.player.hand.push(pool); card = pool; }
  }
  if (!card) return { fatal: 'no unit card to place' };
  App.ui.selectedCardId = card.instanceId;
  renderBattleNow();
  await sleep(600);

  const box = (el) => { const q = el.getBoundingClientRect();
    return { x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height),
             l: q.left, t: q.top, r: q.right, b: q.bottom }; };
  const banner = document.querySelector('.card-cancel-banner');
  if (!banner) return { fatal: 'banner not rendered' };
  const bb = box(banner);
  const tiles = [...document.querySelectorAll('.tile.placement')].map(box);
  const board = document.querySelector('.board, .battle-grid, .board-wrap');
  const hand = document.querySelector('.hand-strip, .hand-strip-cards, .hand-column');

  const inter = (a, c) => {
    const x = Math.max(0, Math.min(a.r, c.r) - Math.max(a.l, c.l));
    const y = Math.max(0, Math.min(a.b, c.b) - Math.max(a.t, c.t));
    return x * y;
  };
  let covered = 0, area = 0, worst = null, worstPct = 0, buried = 0;
  for (const t of tiles) {
    const ov = inter(bb, t);
    if (ov <= 0) continue;
    covered++; area += ov;
    const pct = ov / Math.max(1, t.w * t.h);
    if (pct > worstPct) { worstPct = pct; worst = t; }
    /* the honest question: click the middle of this tile — what do you hit? */
    const hit = document.elementFromPoint(t.x + t.w / 2, t.y + t.h / 2);
    if (hit && hit.closest && hit.closest('.card-cancel-banner')) buried++;
  }
  /* Two more questions a box overlap does not answer: is the pill itself
     reachable, and did moving it up tuck it under the fixed top HUD? */
  const cancelBtn = document.getElementById("btn-cancel-card-select");
  let cancelHit = false, cancelBox = null;
  if (cancelBtn) { const q = cancelBtn.getBoundingClientRect(); cancelBox = { x: Math.round(q.left), y: Math.round(q.top) };
    const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    cancelHit = !!(hit && hit.closest && hit.closest("#btn-cancel-card-select")); }
  let chromeBottom = 0, chromeWho = null;
  document.querySelectorAll("body *").forEach(e => { const cs = getComputedStyle(e);
    if (cs.position !== "fixed" && cs.position !== "sticky") return;
    const q = e.getBoundingClientRect();
    if (q.top > 40 || q.height < 20 || q.width < 200 || q.bottom > innerHeight * 0.5) return;
    if (q.bottom > chromeBottom) { chromeBottom = q.bottom; chromeWho = String(e.className).slice(0, 40); } });
  return {
    vw: innerWidth, vh: innerHeight,
    cancelHit, cancelBox, chromeBottom: Math.round(chromeBottom), chromeWho,
    diag: { hudVar: getComputedStyle(document.documentElement).getPropertyValue("--hud-banner-h").trim(),
            pillTopCss: getComputedStyle(banner).top, zoom: getComputedStyle(document.documentElement).zoom,
            bandRect: (() => { const e = document.querySelector(".hudx-topband"); if (!e) return null; const q = e.getBoundingClientRect();
              return { y: Math.round(q.top), h: Math.round(q.height), b: Math.round(q.bottom) }; })() },
    banner: bb,
    board: board ? box(board) : null,
    hand: hand ? box(hand) : null,
    tiles: tiles.length,
    covered, coveredArea: Math.round(area), buried,
    worst: worst ? { x: worst.x, y: worst.y, pct: Math.round(worstPct * 100) } : null,
    tileBand: tiles.length ? {
      top: Math.min(...tiles.map(t => t.y)), bottom: Math.max(...tiles.map(t => t.y + t.h)),
      left: Math.min(...tiles.map(t => t.x)), right: Math.max(...tiles.map(t => t.x + t.w)),
    } : null,
  };
});
if (SHOT) { fs.mkdirSync(path.dirname(SHOT), { recursive: true }); await pg.screenshot({ path: SHOT }); console.log("  wrote " + SHOT); }

await b.close(); srv.close();

if (out.fatal) { console.log('FATAL: ' + out.fatal); process.exit(1); }
const ok = (v) => v ? '[32mPASS[0m' : '[31mFAIL[0m';
console.log('\n📐 SUMMONING PILL vs THE TILES IT ASKS YOU TO CLICK   (' + out.vw + '×' + out.vh + ')\n');
console.log('  pill            ' + JSON.stringify(out.banner ? { x: out.banner.x, y: out.banner.y, w: out.banner.w, h: out.banner.h } : null));
console.log('  legal tiles     ' + out.tiles + (out.tileBand ? '   band x ' + out.tileBand.left + '–' + out.tileBand.right + ' · y ' + out.tileBand.top + '–' + out.tileBand.bottom : ''));
console.log('  hand strip      ' + JSON.stringify(out.hand ? { y: out.hand.y, h: out.hand.h } : null));
console.log('');
console.log('  tiles overlapped        ' + out.covered + '   ' + ok(out.covered === 0));
console.log('  tiles actually buried   ' + out.buried + '   ' + ok(out.buried === 0) + '   (elementFromPoint at tile centre)');
console.log('  covered area            ' + out.coveredArea + 'px²');
if (out.worst) console.log('  worst tile              ' + out.worst.pct + '% covered at (' + out.worst.x + ',' + out.worst.y + ')');
console.log("  cancel clickable        " + (out.cancelHit ? "PASS" : "FAIL") + "   (elementFromPoint on the button)");
console.log("  clear of the top HUD    " + ((out.banner.y >= out.chromeBottom) ? "PASS" : "FAIL") + "   (pill top " + out.banner.y + " vs " + out.chromeWho + " bottom " + out.chromeBottom + ")");
const pass = out.covered === 0 && out.buried === 0 && out.cancelHit && out.banner.y >= out.chromeBottom;
console.log('\n  VERDICT: ' + (pass ? '[32mTHE PILL BLOCKS NOTHING PLAYABLE[0m' : '[31mTHE PILL SITS ON THE BOARD[0m') + '\n');
process.exit(pass ? 0 : 1);
