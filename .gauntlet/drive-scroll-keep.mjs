/* ══════════════════════════════════════════════════════════════════════════
   📜 DRIVE-SCROLL-KEEP — the screen stops snapping back to the top.

   THE REPORT: "Fix the rubber banding of the scroll wheels, it is frustrating
   when you scroll down and it shoots you back to the top — or when you are in
   forge and working on the tabs to create and the tab closes while you are
   working."

   Both are one cause: render() rebuilds the screen's HTML, and anything held in
   the DOM rather than in the model dies with the old nodes. render() already
   snapshotted FOCUS for exactly this reason ("handled ONCE here, for every
   caller"); scroll and the Forge accordion are the same bug wearing different
   clothes.

   Pinned, each with a control:

     · a same-screen re-render keeps the scroll position
       CONTROL: navigating to a DIFFERENT screen still starts at the top —
       restoring there would be a worse bug than the one being fixed
     · the restore survives content that lays out late (the multi-frame retry
       withDeckScrollPreserved had to learn); a single frame silently collapses
     · the Forge accordion reopens the sections that were open
       CONTROL: with nothing recorded the editor opens all-closed, as before
     · AND IT IS CHEAP. The snapshot runs on EVERY render, including background
       ones from the sprite ticker and cloud sync, so its cost is measured here
       rather than assumed — a fix for a jitter complaint that adds jitter is
       not a fix.

   Run:  node .gauntlet/drive-scroll-keep.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8670 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof render === "function" && typeof _fxOpen === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof render === 'function' && typeof _fxOpen === 'function';
  if (!o.reachable) return o;
  const frames = (n) => new Promise(r => {
    let i = 0; const step = () => (++i >= n ? r() : requestAnimationFrame(step)); requestAnimationFrame(step);
  });

  /* ── COST. The snapshot runs on every render; it must be ~free. ───────── */
  o.domNodes = document.querySelectorAll('*').length;
  {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) { render(); }
    o.renderMsEach = +((performance.now() - t0) / 50).toFixed(3);
  }

  /* ── 1 · a scrolled panel survives a same-screen re-render ──────────────
     ⚠ THE OBVIOUS TEST IS VACUOUS, and the first draft of this was: a panel
       appended to <body> is NOT rebuilt by render(), so its scrollTop is kept
       by the browser whether or not any of this code runs — the control
       "passed" while measuring nothing.
     So the panel is zeroed AFTER render() is called and BEFORE the restore
       frames elapse. If the restore fires it pushes the value back; if it
       declines, the zero stands. That distinguishes the two outcomes. */
  const host = document.createElement('div');
  host.id = 'scrolltest-panel';
  host.style.cssText = 'height:120px;overflow-y:auto';
  host.innerHTML = '<div style="height:2000px"></div>';
  document.body.appendChild(host);

  const trial = async (screenKey) => {
    App.screen = screenKey;
    host.scrollTop = 400;
    host.dispatchEvent(new Event('scroll', { bubbles: false }));  // record it
    await frames(1);
    render();
    host.scrollTop = 0;              // …and knock it down before the restore runs
    await frames(8);
    return host.scrollTop;
  };

  const screenWas = App.screen;
  o.afterSameScreen = await trial(screenWas);        // restore fires → back to 400
  /* CONTROL: the position was recorded on one screen; render() then runs with a
     DIFFERENT screen key, so the restore must decline and the zero must stand. */
  App.screen = screenWas;
  host.scrollTop = 400;
  host.dispatchEvent(new Event('scroll', { bubbles: false }));
  await frames(1);
  App.screen = '__a_different_screen__';
  render();
  host.scrollTop = 0;
  await frames(8);
  o.afterScreenChange = host.scrollTop;
  App.screen = screenWas;
  try { host.remove(); } catch (e) {}
  /* ── 2 · the Forge accordion ───────────────────────────────────────────── */
  App._fxOpen = null;
  o.closedByDefault = _fxOpen('fx-effects');          // '' — unchanged behaviour
  App._fxOpen = { 'fx-effects': true, 'fx-kind': false };
  o.remembersOpen = _fxOpen('fx-effects');            // ' open'
  o.remembersClosed = _fxOpen('fx-kind');             // ''
  o.unknownStaysClosed = _fxOpen('fx-identity');      // ''

  /* …and the markup actually carries it. */
  App.editingCardId = 'NEW';
  try { App._newCardDraft = makeNewCardDraft(); } catch (e) {}
  let html = '';
  try { html = renderCardEditor() || ''; } catch (e) { o.editorErr = String(e).slice(0, 160); }
  o.markupOpensRemembered = /id="fx-effects" open/.test(html);
  o.markupLeavesOthersShut = /id="fx-kind">/.test(html);
  App._fxOpen = null;
  let html2 = '';
  try { html2 = renderCardEditor() || ''; } catch (e) {}
  o.markupDefaultAllShut = !/ open>/.test(html2);
  App.editingCardId = null;
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('render / _fxOpen are not reachable');
else {
  need('THE REPORT: a same-screen re-render keeps the scroll position', out.afterSameScreen === 400, out.afterSameScreen);
  need('CONTROL: on a different screen the restore declines — the top stands', out.afterScreenChange === 0, out.afterScreenChange);
  need('a render stays cheap — the snapshot is O(1), not a DOM scan (<8ms)', out.renderMsEach < 8,
       { ms: out.renderMsEach, nodes: out.domNodes });
  need('CONTROL: with nothing recorded the accordion is all-closed', out.closedByDefault === '', out.closedByDefault);
  need('an open section is remembered', out.remembersOpen === ' open', out.remembersOpen);
  need('…a closed one stays closed', out.remembersClosed === '', out.remembersClosed);
  need('…and one never touched stays closed', out.unknownStaysClosed === '', out.unknownStaysClosed);
  need('the editor markup reopens the remembered section', out.markupOpensRemembered, out);
  need('…and leaves the others shut', out.markupLeavesOthersShut, out);
  need('CONTROL: a fresh editor opens with everything shut, as before', out.markupDefaultAllShut, out);
  need('the editor did not throw', !out.editorErr, out.editorErr);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the screen stays where the player left it, a new screen still starts at the top, and the Forge keeps its sections open.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
