/* ══════════════════════════════════════════════════════════════════════════
   CRIT-BATTLEUI-FALSIFY — drive the reach/door checks from crit-battleui-read
   RED on purpose. A green that cannot go red is not evidence.
   Two of the four are falsified here without touching a file (the DOM is
   perturbed live); the other two need a constant changed and are falsified in
   crit-battleui-headroom / crit-prop-shot with the file edited and restored.
   node .gauntlet/crit-battleui-falsify.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 9000 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.route('**/*', r => { const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort(); });
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
await page.waitForTimeout(5000);
await page.evaluate(() => {
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null); App.screen = 'battle'; render();
});
await page.waitForTimeout(7000);

const endTurn = () => page.evaluate(() => {
  const b = document.getElementById('btn-end-turn'); if (!b) return { present: false };
  const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
  const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return { present: true,
    onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + .5 && r.bottom <= innerHeight + .5,
    visible: cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > .05,
    topmost: !!(hit && (hit === b || b.contains(hit) || hit.closest('#btn-end-turn'))),
    hitWas: hit ? (hit.id || hit.className || hit.tagName).toString().slice(0, 40) : null };
});
const doors = () => page.evaluate(() => {
  const inline = [];
  document.querySelectorAll('*').forEach(el => {
    const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
    if (/(_openBattleLog|battleLogOpen)/.test(oc)) inline.push(el.id || el.className || el.tagName);
  });
  return { legacyPresent: !!document.getElementById('btn-open-battle-log'), inline };
});

console.log('── control (untouched) ──');
console.log('  END TURN  ', JSON.stringify(await endTurn()));
console.log('  log doors ', JSON.stringify(await doors()));

console.log('\n── perturbation A: a full-viewport overlay lands on top of END TURN ──');
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = '__falsify_veil';
  d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.01)';
  document.body.appendChild(d);
});
const A = await endTurn();
console.log('  END TURN  ', JSON.stringify(A));
console.log('  → "topmost" went ' + (A.topmost ? 'GREEN (check is NOT falsifiable)' : 'RED — the check discriminates'));
await page.evaluate(() => document.getElementById('__falsify_veil').remove());

console.log('\n── perturbation B: END TURN pushed off the bottom of the viewport ──');
await page.evaluate(() => { const b = document.getElementById('btn-end-turn');
  b.style.position = 'fixed'; b.style.top = (innerHeight + 40) + 'px'; b.style.left = '20px'; });
const B = await endTurn();
console.log('  END TURN  ', JSON.stringify(B));
console.log('  → "onScreen" went ' + (B.onScreen ? 'GREEN (NOT falsifiable)' : 'RED — the check discriminates'));
await page.evaluate(() => { const b = document.getElementById('btn-end-turn');
  b.style.position = ''; b.style.top = ''; b.style.left = ''; });

console.log('\n── perturbation C: a SECOND door to the battle log is put back on the page ──');
await page.evaluate(() => {
  const b = document.createElement('button'); b.id = 'btn-open-battle-log';
  b.setAttribute('onclick', 'try{_openBattleLog()}catch(e){}'); b.textContent = 'Battle Log';
  document.querySelector('.battle-left, body').appendChild(b);
});
const C = await doors();
console.log('  log doors ', JSON.stringify(C));
console.log('  → "no second door" went ' +
  ((!C.legacyPresent && C.inline.length === 0) ? 'GREEN (NOT falsifiable)' : 'RED — the check discriminates'));

await browser.close(); server.close();
