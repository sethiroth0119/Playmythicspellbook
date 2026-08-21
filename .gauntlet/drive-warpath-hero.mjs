/* ══════════════════════════════════════════════════════════════════════════
   🦸 DRIVE-WARPATH-HERO — is the player's own hero drawn as ITSELF?

   st.me.hero_id has been in the warpath state all along (the battle bridge
   already sends it); nothing ever drew with it, so every hero on the map was
   the same anonymous cloak. The art lives in the parent, so it crosses the
   same request/reply seam the card draft uses.

   WHAT IS ASSERTED:
     1  THE SUB-APP ASKS — a `warpath:heroart:req` goes up, carrying the id.
     2  IT ASKS ONCE. draw() runs on every input; a request per frame would
        make the parent base64 an image per frame. The guard is the whole
        reason this is not a performance bug.
     3  THE PIXELS CHANGE — with art supplied, the hero's tile renders
        differently from the same frame with no art. CONTROL: the no-art frame
        must still draw SOMETHING (the cloak), or "different" would just mean
        "we broke the hero".
     4  A MISS IS FINAL — answering `art: null` must not produce a retry storm.

   ⚠ THE A/B IS ON A 2D CANVAS, so .gauntlet/README.md item 6 does not apply:
     there is no preserveDrawingBuffer to lose and no render() to interleave.
     Both frames are captured with getImageData in the same task.

   Run:  node .gauntlet/drive-warpath-hero.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 7900 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 240)));

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* Warpath standalone runs on its own mock (warpath-net.js supplies
   hero_id: 'mock_hero'). We stand in for the PARENT so the request/reply seam
   is exercised end to end: the harness answers `warpath:heroart:req` exactly
   as index.html does, and records what was asked for. */
await page.goto(`http://127.0.0.1:${PORT}/warpath/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);

/* Standalone boots its own offline mock — a real generated world with a real
   hero at a real spawn (warpath-net.js mockInit). That is the fixture; nothing
   here has to drive an RPC.

   THE PARENT IS INSTALLED AFTER BOOT, deliberately. The app tests
   `window.parent === window` to decide it is standalone, so a stub present at
   load time would send it down the embedded path and it would never build the
   mock — which is exactly how the first run of this driver found no hero.
   heroArtFor() reads window.parent at CALL time, so a late stub exercises the
   real request/reply seam against a real map. */
const entered = await page.evaluate(async () => {
  const out = { hadCanvas: !!document.querySelector('canvas') };
  out.hasMe = !!(window.__wp && __wp.state().state && __wp.state().state.me);
  out.heroId = (window.__wp && __wp.state().state && __wp.state().state.me
                && __wp.state().state.me.hero_id) || null;
  window.__askedFor = [];
  window.__answerWith = null;
  try {
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get() {
        return {
          postMessage(msg) {
            if (!msg || msg.type !== 'warpath:heroart:req') return;
            window.__askedFor.push(msg.id);
            const art = window.__answerWith;
            setTimeout(() => {
              window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'warpath:heroart', id: msg.id, art: art },
                origin: window.location.origin,
              }));
            }, 10);
          },
        };
      },
    });
    out.parentStubbed = window.parent !== window;
  } catch (e) { out.err = String(e).slice(0, 120); }
  /* The standalone boot already resolved the hero art to "no parent, no art".
     Clear that so the seam is exercised now that a parent exists. */
  try { __wp.resetHeroArt(); } catch (e) {}
  return out;
});
console.log('\n0. a run with a hero on the map');
console.log('   ' + JSON.stringify(entered));
ok('the map canvas exists', !!entered.hadCanvas);
ok('the offline mock produced a hero with an id', !!entered.hasMe && !!entered.heroId, String(entered.heroId));
ok('the parent stub is installed (after boot, on purpose)', !!entered.parentStubbed);
if (!entered.hasMe) {
  console.log('\ncannot proceed — no expedition state');
  console.log(logs.slice(0, 4).join('\n'));
  await browser.close(); server.close(); process.exit(1);
}

/* ── 1 & 2. THE REQUEST, AND ONLY ONE OF THEM ──────────────────────────── */
console.log('\n1. the sub-app asks the parent for its hero art — once');
const asked = await page.evaluate(async () => {
  window.__askedFor = [];
  window.__answerWith = null;              // reply "no art" for this phase
  // force many draws — draw() runs on every input in this app
  for (let i = 0; i < 30; i++) __wp.draw();
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < 30; i++) __wp.draw();
  await new Promise((r) => setTimeout(r, 400));
  return { asked: window.__askedFor.slice() };
});
console.log('   requests: ' + JSON.stringify(asked.asked));
ok('a heroart request was sent', asked.asked.length > 0, asked.asked.length + ' request(s)');
ok('...carrying the hero id', asked.asked[0] === entered.heroId, String(asked.asked[0]));
ok('...and 60 draws produced ONE request, not sixty',
   asked.asked.length === 1, asked.asked.length + ' — a per-frame request would base64 an image per frame');

/* ── 4. A MISS IS FINAL ────────────────────────────────────────────────── */
console.log('\n2. a hero with no art is not asked for again');
const afterMiss = await page.evaluate(async () => {
  window.__askedFor = [];
  for (let i = 0; i < 40; i++) __wp.draw();
  await new Promise((r) => setTimeout(r, 400));
  return window.__askedFor.length;
});
ok('no further requests after an art:null answer', afterMiss === 0, afterMiss + ' extra request(s)');

/* ── 3. THE PIXELS ─────────────────────────────────────────────────────── */
console.log('\n3. the hero tile actually renders differently once art arrives');
const ab = await page.evaluate(async () => {
  const cvs = document.querySelector('canvas');
  const g = cvs.getContext('2d');
  const me = __wp.state().state.me;
  // the hero's screen box, from the same camera maths the renderer uses
  const z = __wp.state().cam.z;
  const hx = Math.round((me.x + 0.5) * z - __wp.state().cam.x);
  const hy = Math.round((me.y + 0.9) * z - __wp.state().cam.y);
  const bw = Math.max(24, Math.round(z * 1.6)), bh = Math.max(24, Math.round(z * 1.8));
  const x0 = Math.max(0, hx - (bw >> 1)), y0 = Math.max(0, hy - bh);
  const grab = () => {
    const d = g.getImageData(x0, y0, bw, bh).data;
    let ink = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 8) ink++; sum += d[i] + d[i + 1] + d[i + 2]; }
    return { ink, sum };
  };
  __wp.draw();
  const before = grab();

  /* A deliberately unmistakable sprite: solid magenta. Real art would also
     work, but a colour nothing else on this map uses makes the delta
     attributable rather than merely present. */
  const c2 = document.createElement('canvas'); c2.width = c2.height = 48;
  const g2 = c2.getContext('2d'); g2.fillStyle = '#ff00ff'; g2.fillRect(0, 0, 48, 48);
  const art = c2.toDataURL('image/png');

  // clear the remembered miss so the app asks again, then answer with art
  window.__answerWith = art;
  try { __wp.resetHeroArt(); } catch (e) {}
  __wp.draw();
  await new Promise((r) => setTimeout(r, 700));
  __wp.draw();
  const after = grab();

  // is there magenta in the box now?
  const d = g.getImageData(x0, y0, bw, bh).data;
  let magenta = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] > 200 && d[i + 3] > 40) magenta++;
  }
  return { before, after, magenta, box: [x0, y0, bw, bh] };
});
console.log('   ' + JSON.stringify(ab));
ok('CONTROL — the no-art frame already draws a hero (the cloak)',
   ab.before.ink > 0, ab.before.ink + ' inked px — "different" would be meaningless without this');
ok('the frame changed once the art arrived',
   ab.after.ink !== ab.before.ink || ab.after.sum !== ab.before.sum,
   'ink ' + ab.before.ink + ' -> ' + ab.after.ink);
ok('...and the hero tile now contains the supplied sprite',
   ab.magenta > 0, ab.magenta + ' px of the supplied art on the hero tile');

console.log('\npage errors: ' + logs.length);
logs.slice(0, 5).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
