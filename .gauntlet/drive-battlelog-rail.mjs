/* ══════════════════════════════════════════════════════════════════════════
   📜 DRIVE-BATTLELOG-RAIL — the log is out of the left rail, and still reachable.

   Asked for: "remove the battle log on this side and only show the battle log
   modal when the button is clicked on the right. This will make room on the
   left UI, right now it is sloppy."

   🔴 THE TRAP THIS EXISTS TO CATCH. #bsxLog — the tool in the right sidebar —
   did NOT call the modal. It RELAYED a synthetic click to #btn-open-battle-log,
   which lived inside the left rail's log block. Delete the block and the relay
   finds no target, does nothing, logs nothing, and the button simply feels
   dead. index.html already records the clip recorder being bitten by exactly
   this. So "the log is gone from the left" is only half the check; the other
   half is that the right-hand button still opens it.

   Run:  node .gauntlet/drive-battlelog-rail.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8600 + (process.pid % 60);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

/* 1100px is the width the gauntlet's blocker was found at — END TURN rendered
   off the bottom of a scroll-locked rail. Freeing the log's block is meant to
   help exactly that, so it is measured here rather than assumed. */
for (const VP of [{ w: 1600, h: 900, tag: 'desktop' }, { w: 1100, h: 800, tag: 'narrow (the blocker width)' }]) {
  const page = await browser.newPage({ viewport: { width: VP.w, height: VP.h } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
    return r.abort();
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction("typeof initGame === \"function\" && typeof findHeroById === \"function\"", null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const r = await page.evaluate(async () => {
    const out = {};
    /* 🔴 BUILD A REAL MATCH — initGame(), the same call verify-ruins-cp uses.
       The first draft of this driver just set App.screen = 'battle' and
       rendered. That produces an EMPTY battle shell: no right sidebar, no End
       Turn, no units. Every "the inline log is gone" check then passed for the
       worst possible reason — nothing rendered at all — while the checks that
       needed real chrome failed and looked like real defects. An absent DOM is
       not an absent feature. */
    try {
      App.battlePrep = App.battlePrep || {};
      const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
      App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
      App.state = initGame(me, foe, [], true, null);
      App.screen = 'battle';
      render();
    } catch (e) { out.startErr = String(e).slice(0, 160); }
    await new Promise((res) => setTimeout(res, 3000));
    out.screen = App.screen;
    out.units = (App.state && App.state.units) ? App.state.units.length : 0;
    out.railFound = !!document.querySelector('.bc-rail, .bcp');
    out.sidebarFound = !!document.querySelector('.bp-wrap.bsx');

    out.inlineLog = document.querySelectorAll('.logrows').length;
    out.inlineLogHead = document.querySelectorAll('.loghead').length;
    out.bsxLog = !!document.getElementById('bsxLog');
    out.relayTarget = !!document.getElementById('btn-open-battle-log');
    out.modalBefore = !!(App.ui && App.ui.battleLogOpen);

    /* THE REAL CHECK — click the right-hand tool and see if the modal opens. */
    const b = document.getElementById('bsxLog');
    if (b) { b.click(); await new Promise((res) => setTimeout(res, 700)); }
    out.modalAfter = !!(App.ui && App.ui.battleLogOpen);
    out.modalInDom = document.querySelectorAll('[class*="logmodal"], .bc-log-modal, #battle-log-modal').length;

    /* Room on the left: is End Turn actually reachable in the viewport? */
    const et = document.getElementById('btn-end-turn') || document.querySelector('.etwrap button');
    if (et) {
      const q = et.getBoundingClientRect();
      out.endTurn = { top: Math.round(q.top), bottom: Math.round(q.bottom), h: Math.round(q.height) };
      out.endTurnOnScreen = q.bottom <= window.innerHeight + 1 && q.top >= -1 && q.height > 0;
    }
    return out;
  });

  console.log('\n\u{1F4DC} ' + VP.tag + ' — ' + VP.w + 'x' + VP.h);
  console.log('   ' + JSON.stringify(r).slice(0, 320));
  ok('[' + VP.tag + '] no inline log rows in the left rail', (r.inlineLog | 0) === 0, r.inlineLog + ' .logrows');
  ok('[' + VP.tag + '] no inline log header either', (r.inlineLogHead | 0) === 0, r.inlineLogHead + ' .loghead');
  ok('[' + VP.tag + '] the right-hand tool exists', r.bsxLog === true);
  ok('[' + VP.tag + '] the old relay TARGET is gone (proves the relay would have died)',
     r.relayTarget === false, 'btn-open-battle-log present: ' + r.relayTarget);
  ok('[' + VP.tag + '] \u{1F4D6} clicking it OPENS the battle log',
     r.modalBefore === false && r.modalAfter === true,
     'battleLogOpen ' + r.modalBefore + ' -> ' + r.modalAfter);
  if (r.endTurn) {
    ok('[' + VP.tag + '] END TURN is on screen (the freed space)', r.endTurnOnScreen === true,
       JSON.stringify(r.endTurn) + ' vs viewport h ' + VP.h);
  } else console.log('  ~    END TURN not found in the DOM — not asserted');
  if (errs.length) console.log('   page errors: ' + errs.slice(0, 2).join(' | '));
  await page.close();
}

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
