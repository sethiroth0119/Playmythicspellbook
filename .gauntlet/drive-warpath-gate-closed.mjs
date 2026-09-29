/* ══════════════════════════════════════════════════════════════════════════
   🔒 DRIVE-WARPATH-GATE-CLOSED — is the Warpath VISIBLE, GREY AND GENUINELY
   DEAD, for everyone, in a real browser?

   The static gate (tools/mp-tests/warpath-gate.mjs) proves the predicates and
   the anchors. It cannot prove the thing a player actually meets: a button that
   looks disabled, animates like a real one, and posts mm:nav anyway. Grey CSS
   is not enforcement, and "the parent refuses it" is not the same as "nothing
   happened" — the player still watched a gold sweep promise them a screen.

   WHAT IS ASSERTED, all against a real boot of the real 14.8 MB index.html:
     1  warpathVisible() === true and warpathEnabled() === false, and the
        drain predicate is NOT dragged down with it.
     2  the cinematic menu receives warpathLocked: true, and its button carries
        BOTH `disabled` and aria-disabled="true".
     3  clicking that button — real .click() AND a synthetic dispatch that a
        disabled control cannot stop — posts ZERO mm:nav and lights nothing.
        CONTROL: the same button, re-sent warpathLocked:false, must post
        EXACTLY ONE. Without that control "zero posts" would also be the
        reading for a menu that was simply broken.
     4  re-sending warpathLocked:true puts `disabled` back — the flag is
        reversible from the parent, with no second edit in the menu.
     5  the classic fallback renders a .md-mlocked Warpath tile whose text says
        neither "ADMIN" nor "admin only", and clicking it mounts no overlay.
     6  openWarpathGate() creates no #warpath-gate; __mg.warpath.open() — the
        exposed back door, and the call warpathAfterBattle() makes — creates no
        #warpath-host and raises no pageerror.

   ⚠ EVERY ONE OF THOSE HAS A CONTROL. The last phase stubs
     `warpathEnabled = () => true` in the page (plus the two cloud values
     openWarpathGate demands, or its refusal would be the sign-in refusal
     rather than the gate) and requires all of them to FLIP. An assertion that
     cannot be made to fail is decoration.

   ⚠ THE AUTH GATE. index.html boots to screen 'authGate' with no Supabase
     (the CDN is blocked here on purpose), so the harness sets App.screen and
     renders the hub directly. That is the only staging done: nothing about the
     Warpath predicates or either menu surface is faked.

   Run:  node .gauntlet/drive-warpath-gate-closed.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 7700 + (process.pid % 90);
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

// index.html is ~14.8 MB — the long goto and the long settle are not padding.
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);

/* ── the hub, without an account ────────────────────────────────────────── */
const toHub = async () => page.evaluate(async () => {
  App.screen = 'title'; App.titleHub = 'main'; App._mmBroken = false;
  try { const g = document.getElementById('warpath-gate'); if (g) g.remove(); } catch (e) {}
  try { const h = document.getElementById('warpath-host'); if (h) h.remove(); } catch (e) {}
  try { _WP.host = null; _WP.frame = null; } catch (e) {}
  render();
  await new Promise((r) => setTimeout(r, 600));
  return App.screen;
});

/* Everything this driver looks at, in one read, so the sealed pass and the
   stubbed control pass are literally the same measurement. */
const probe = async () => {
  await toHub();
  await page.waitForTimeout(2500);

  const base = await page.evaluate(async () => {
    const out = {};
    out.visible = (typeof warpathVisible === 'function') && warpathVisible();
    out.enabled = (typeof warpathEnabled === 'function') && warpathEnabled();
    out.drain = (typeof warpathDrainEnabled === 'function') && warpathDrainEnabled();
    const sec = MD_SECTIONS.find((s) => s && s.t === 'Warpath');
    out.secHidden = !!(sec && sec.hidden && sec.hidden());
    out.secLocked = !!(sec && sec.locked && sec.locked());
    out.mmFrame = !!document.getElementById('mm-frame');
    out.mmData = (typeof _mmData === 'function') ? (() => { const d = _mmData(); return { warpath: d.warpath, warpathLocked: d.warpathLocked }; })() : null;
    // count mm:nav arriving at the parent, from here on
    window.__navSeen = [];
    if (!window.__navHooked) {
      window.__navHooked = 1;
      window.addEventListener('message', (e) => {
        const d = e && e.data;
        if (d && d.type === 'mm:nav') window.__navSeen.push(d.label);
      });
    }
    return out;
  });

  /* ── the cinematic button ─────────────────────────────────────────────── */
  const frame = page.frames().find((f) => f.url().includes('main-menu'));
  base.hasMenuFrame = !!frame;
  if (frame) {
    // Make sure the child has this render's mm:data before we read the button.
    await page.evaluate(() => { try { _mmPost(); } catch (e) {} });
    await page.waitForTimeout(600);
    base.btn = await frame.evaluate(() => {
      const b = document.querySelector('.nav-item[data-label="Warpath"]');
      if (!b) return null;
      return { disabled: !!b.disabled, aria: b.getAttribute('aria-disabled'),
               display: b.style.display, opacity: b.style.opacity, title: b.getAttribute('title') || '' };
    });
    // A real click, then a synthetic one. A disabled <button> swallows the
    // first at the browser; only the second reaches the handler, which is the
    // path the in-file guard exists for.
    await frame.evaluate(async () => {
      const b = document.querySelector('.nav-item[data-label="Warpath"]');
      if (!b) return;
      b.click();
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(900);
    base.navAfterClick = await page.evaluate(() => (window.__navSeen || []).slice());
    base.btnLit = await frame.evaluate(() => {
      const b = document.querySelector('.nav-item[data-label="Warpath"]');
      return !!b && (b.classList.contains('active') || b.classList.contains('committing'));
    });
  }

  /* ── the classic fallback tile ────────────────────────────────────────── */
  const tile = await page.evaluate(async () => {
    App._mmBroken = true; render();
    await new Promise((r) => setTimeout(r, 900));
    const items = [...document.querySelectorAll('.md-mitem')];
    const el = items.find((e) => /Warpath/.test(e.textContent || ''));
    if (!el) return { found: false, count: items.length };
    const txt = (el.textContent || '').trim();
    el.click();
    await new Promise((r) => setTimeout(r, 900));
    return {
      found: true, cls: el.className, txt,
      hasAdmin: /admin/i.test(txt),
      gate: !!document.getElementById('warpath-gate'),
      host: !!document.getElementById('warpath-host'),
    };
  });
  base.tile = tile;

  /* ── the two direct doors ─────────────────────────────────────────────── */
  base.direct = await page.evaluate(async () => {
    try { const g = document.getElementById('warpath-gate'); if (g) g.remove(); } catch (e) {}
    try { const h = document.getElementById('warpath-host'); if (h) h.remove(); } catch (e) {}
    // _WP is a top-level `const` — a lexical binding, NOT a window property,
    // so it has to be reached by its bare name here.
    try { _WP.host = null; _WP.frame = null; } catch (e) {}
    const out = {};
    try { openWarpathGate(); } catch (e) { out.gateThrew = String(e).slice(0, 120); }
    await new Promise((r) => setTimeout(r, 500));
    out.gate = !!document.getElementById('warpath-gate');
    try { window.__mg.warpath.open(); } catch (e) { out.openThrew = String(e).slice(0, 120); }
    await new Promise((r) => setTimeout(r, 500));
    out.host = !!document.getElementById('warpath-host');
    try { out.wpUntouched = (_WP.host === null && _WP.frame === null); } catch (e) { out.wpUntouched = 'unreadable'; }
    return out;
  });
  return base;
};

console.log('\n1. the sealed state, as the page really boots');
const sealed = await probe();
console.log('   ' + JSON.stringify({ visible: sealed.visible, enabled: sealed.enabled, drain: sealed.drain,
  secHidden: sealed.secHidden, secLocked: sealed.secLocked, mmData: sealed.mmData }));
ok('warpathVisible() is TRUE — both menus still render the entry', sealed.visible === true);
ok('warpathEnabled() is FALSE — nobody may run it', sealed.enabled === false);
ok('the Warpath section is locked, NOT hidden', sealed.secLocked === true && sealed.secHidden === false);
ok('the extraction drain is NOT sealed with it', sealed.drain === true,
   'warpathDrainEnabled() — owed warpath_grants still drain');

console.log('\n2. the cinematic menu button');
console.log('   ' + JSON.stringify({ frame: sealed.hasMenuFrame, btn: sealed.btn, nav: sealed.navAfterClick }));
ok('the menu iframe mounted', sealed.hasMenuFrame === true);
ok('mm:data carries warpath:true + warpathLocked:true',
   !!sealed.mmData && sealed.mmData.warpath === true && sealed.mmData.warpathLocked === true);
ok('the Warpath button still RENDERS', !!sealed.btn && sealed.btn.display !== 'none');
ok('...and carries `disabled`', !!sealed.btn && sealed.btn.disabled === true);
ok('...and aria-disabled="true"', !!sealed.btn && sealed.btn.aria === 'true');
ok('...and says nothing about admins', !!sealed.btn && !/admin/i.test(sealed.btn.title), sealed.btn && sealed.btn.title);
ok('a click posts ZERO mm:nav', Array.isArray(sealed.navAfterClick) && sealed.navAfterClick.length === 0,
   JSON.stringify(sealed.navAfterClick));
ok('...and lights nothing (no .active, no sweep)', sealed.btnLit === false);

/* CONTROL for the click. "Zero posts" is also what a dead menu reads like. */
console.log('\n3. CONTROL — the SAME button, unlocked, must post exactly one');
/* probe() finishes on the classic fallback (that is phase 4's measurement), so
   the iframe is gone by now — bring the cinematic menu back before driving it. */
await page.evaluate(async () => {
  App._mmBroken = false; App.screen = 'title'; App.titleHub = 'main'; render();
  await new Promise((r) => setTimeout(r, 400));
});
await page.waitForTimeout(4000);
await page.evaluate(() => { try { _mmPost(); } catch (e) {} });
await page.waitForTimeout(600);
const control = await page.evaluate(async () => {
  const f = document.getElementById('mm-frame');
  window.__navSeen = [];
  const d = _mmData(); d.warpath = true; d.warpathLocked = false;
  f.contentWindow.postMessage(d, window.location.origin);
  await new Promise((r) => setTimeout(r, 500));
  return true;
});
let frame = page.frames().find((f) => f.url().includes('main-menu'));
const unlockedBtn = frame ? await frame.evaluate(() => {
  const b = document.querySelector('.nav-item[data-label="Warpath"]');
  return { disabled: !!b.disabled, aria: b.getAttribute('aria-disabled') };
}) : null;
ok('warpathLocked:false un-sets disabled', !!unlockedBtn && unlockedBtn.disabled === false,
   'reversible — the flag flips back with no second edit here');
ok('...and removes aria-disabled', !!unlockedBtn && unlockedBtn.aria === null);
if (frame) {
  await frame.evaluate(() => { document.querySelector('.nav-item[data-label="Warpath"]').click(); });
  await page.waitForTimeout(1200);
}
const navUnlocked = await page.evaluate(() => (window.__navSeen || []).slice());
ok('the unlocked button posts EXACTLY ONE mm:nav', navUnlocked.length === 1 && navUnlocked[0] === 'Warpath',
   JSON.stringify(navUnlocked) + ' — this is what makes the zero above mean something');

/* And back again, because a one-way flag is a flag nobody can turn off. */
const relocked = await page.evaluate(async () => {
  const f = document.getElementById('mm-frame');
  const d = _mmData(); d.warpath = true; d.warpathLocked = true;
  f.contentWindow.postMessage(d, window.location.origin);
  await new Promise((r) => setTimeout(r, 500));
  return true;
});
frame = page.frames().find((f) => f.url().includes('main-menu'));
const reBtn = frame ? await frame.evaluate(() => {
  const b = document.querySelector('.nav-item[data-label="Warpath"]');
  return { disabled: !!b.disabled, aria: b.getAttribute('aria-disabled') };
}) : null;
ok('re-locking puts `disabled` back', !!reBtn && reBtn.disabled === true && reBtn.aria === 'true');

console.log('\n4. the classic fallback tile');
console.log('   ' + JSON.stringify(sealed.tile));
ok('a Warpath tile is rendered', sealed.tile.found === true);
ok('...greyed via md-mlocked', /md-mlocked/.test(sealed.tile.cls || ''));
ok('...with no 👑 ADMIN badge and no "admin only" copy', sealed.tile.hasAdmin === false, sealed.tile.txt);
ok('...and clicking it mounts NO overlay', sealed.tile.gate === false && sealed.tile.host === false);

console.log('\n5. the two doors that used to bypass the gate');
console.log('   ' + JSON.stringify(sealed.direct));
ok('openWarpathGate() creates no #warpath-gate', sealed.direct.gate === false);
ok('__mg.warpath.open() creates no #warpath-host', sealed.direct.host === false);
ok('...and neither threw', !sealed.direct.gateThrew && !sealed.direct.openThrew,
   (sealed.direct.gateThrew || '') + (sealed.direct.openThrew || ''));
ok('..._WP is left untouched by the refusal', sealed.direct.wpUntouched === true);
const errsBeforeControl = errs.length;
ok('no page errors during the sealed pass', errsBeforeControl === 0, errs.slice(0, 3).join(' | '));

/* ── 6. THE CONTROL PASS ───────────────────────────────────────────────────
   Stub the predicate open and re-measure. Every assertion above has to flip;
   any that does not was never reading what it claimed to read.

   The two cloud values are stubbed alongside it because openWarpathGate()
   refuses an unauthenticated player SECOND, after the gate — without them its
   "no #warpath-gate" would stay true for a reason that has nothing to do with
   the seal, and that assertion would be unfalsifiable. */
console.log('\n6. CONTROL — with warpathEnabled() stubbed open, every check must FLIP');
await page.evaluate(() => {
  /* warpathEnabled and initCloud are function DECLARATIONS, so they are real
     window properties and a window assignment shadows them. Cloud is a top-level
     `const` object — lexical, not on window — so its client is set by mutating
     the object itself, which a const permits. Getting this wrong is silent: the
     stub lands on window, the page keeps reading the lexical binding, and the
     control looks like it flipped nothing. */
  window.warpathEnabled = () => true;
  window.initCloud = () => true;
  try { Cloud.client = Cloud.client || { rpc: async () => ({ data: null, error: null }) }; } catch (e) {}
  App._mmBroken = false;
});
const opened = await probe();
console.log('   ' + JSON.stringify({ enabled: opened.enabled, secLocked: opened.secLocked,
  mmData: opened.mmData, btn: opened.btn, nav: opened.navAfterClick, tile: { cls: opened.tile.cls },
  direct: opened.direct }));
ok('CONTROL warpathEnabled() now reads true', opened.enabled === true);
ok('CONTROL the section is no longer locked', opened.secLocked === false);
ok('CONTROL mm:data now says warpathLocked:false', !!opened.mmData && opened.mmData.warpathLocked === false);
ok('CONTROL the button is no longer disabled', !!opened.btn && opened.btn.disabled === false);
ok('CONTROL the button now posts an mm:nav', Array.isArray(opened.navAfterClick) && opened.navAfterClick.length > 0,
   JSON.stringify(opened.navAfterClick));
ok('CONTROL the classic tile is no longer md-mlocked', !/md-mlocked/.test(opened.tile.cls || ''));
ok('CONTROL openWarpathGate() now DOES mount #warpath-gate', opened.direct.gate === true);
ok('CONTROL __mg.warpath.open() now DOES mount #warpath-host', opened.direct.host === true);

console.log('\npage errors (whole run): ' + errs.length);
errs.slice(0, 5).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
