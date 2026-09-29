/* ═══════════════════════════════════════════════════════════════════════════
   📸 shoot — the camera every Supply Chain builder and critic uses.

       import { withPage, shot } from './shoot.mjs';
       await withPage(async (page, t) => {
         await t.goto('/__sc/harness-modal.html?owns=mining');
         await shot(page, 'C:/…/sc/shots/modal/round1/open.png');
         console.log(t.logs);
       }, { w: 1600, h: 900 });

   WHAT IT GUARANTEES
   • Its OWN server on an ephemeral port, in-process (serve.mjs, port 0). Two
     critics running at the same second can never collide or photograph each
     other's page. Nothing to start, nothing to kill, nothing to install.
   • Playwright's Chromium from node_modules with the SwiftShader flags from
     crit-harness.mjs — software WebGL, so a three.js canvas renders on this
     Windows box headlessly with no GPU involved. `--no-proxy-server` matters:
     without it Chromium can spend seconds on proxy auto-discovery for 127.0.0.1.
   • A FRESH context with serviceWorkers:'block'. public/sw.js caches the shell;
     a registered worker would hand a critic the previous round's files and the
     verdict would be about code that no longer exists.
   • console + pageerror + failed requests captured into t.logs / t.errors, so
     "the module 404'd and the page silently fell back" is visible, not guessed.
   • Everything is closed in a finally, including on a throw inside fn — a
     leaked headless Chromium per failed critic adds up fast in a gauntlet.

   webgl:false does not try to switch the GPU off (flag behaviour differs
   between Chromium builds and `--disable-gpu` still leaves SwiftShader on).
   It removes the contexts at the API: getContext('webgl*') returns null, which
   is precisely what three.boot.js `webglOk()` probes — so the fallback view is
   tested through the same door a real no-WebGL player comes in by.

   This is REAL headless Chromium, so requestAnimationFrame runs at full rate.
   The 0.56 Hz RAF trap in CLAUDE.md is about the desktop Browser pane, not
   this. Frame A/B work still has to render() and read in the same task.

   CLI  — ⚠ WRITE THE URL PATH WITHOUT A LEADING SLASH.
     node tools/supplychain/shoot.mjs --selftest [out.png]
     node tools/supplychain/shoot.mjs __sc/harness-scene3d.html out.png
          [--w 1600] [--h 900] [--wait 800] [--wait-for "css"] [--no-webgl]
          [--full] [--eval "js expr"] [--allow-errors]

   🔴 TWO TRAPS THIS CLI USED TO WALK INTO, both of which hand back a CONFIDENT
   WRONG GREEN — the exact failure class CLAUDE.md warns about. Every other
   piece's verdict in this gauntlet is built on this camera, so read both.

   1. GIT BASH REWRITES A LEADING-SLASH ARGUMENT. The agents in this repo get
      Git Bash, whose MSYS layer turns an argv that starts with `/` into a
      Windows path: `/__sc/harness-scene3d.html` arrived here as
      `/C:/Program Files/Git/__sc/harness-scene3d.html`, the server 404'd, and a
      black PNG was saved. Reproduced, not theorised. So: the documented form
      has NO leading slash (`abs()` adds it), and unmangle() below repairs a
      mangled one anyway, loudly, on stderr. PowerShell is unaffected either way.
   2. `errors` WAS REPORTED BUT NOT EXITED ON. The JSON always carried
      `"errors": [...]`, and the process still exited 0 — so a photograph of a
      404, of a module that failed to parse, or of a page that threw, read as a
      pass to any script (or agent) that checked the exit code. The CLI now
      exits 1 on a non-empty `t.errors` OR a main navigation status >= 400, with
      the errors on stderr. `--allow-errors` is the opt-out for a test that is
      deliberately photographing a broken state; in code, set `t.allowErrors`.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

export const SWIFTSHADER_ARGS = [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server',
];

/* Undo the MSYS/Git-Bash path rewrite described in trap 1. The mangling is
   "prefix the argument with the Git installation root", so the repair is
   exactly: drop the longest leading run of segments that REALLY EXISTS as a
   directory on this disk, and keep the rest. `/C:/Program Files/Git/__sc/x.html`
   → C:/ ✓, C:/Program Files ✓, C:/Program Files/Git ✓, …/__sc ✗ → `__sc/x.html`.
   This never fires on a URL, on a relative path, or on a Windows path that
   genuinely exists (someone photographing a file:// page), because those all
   fail the first test. Returns the path unchanged when it is not mangled. */
const _warnedPaths = new Set();
export function unmangle(p) {
  const s = String(p == null ? '' : p);
  if (/^https?:/i.test(s)) return s;
  const m = s.match(/^\/?([A-Za-z]:[\\/].*)$/);
  if (!m) return s;
  const win = m[1].replace(/\\/g, '/');
  try { if (fs.existsSync(win)) return s; } catch (e) { /* unreadable → treat as mangled */ }
  const seg = win.split('/');
  let keep = 1;                                  // seg[0] is "C:" — the drive alone always "exists"
  for (let i = 1; i < seg.length; i++) {
    const probe = seg.slice(0, i + 1).join('/');
    let ok = false;
    try { ok = fs.existsSync(probe) && fs.statSync(probe).isDirectory(); } catch (e) { ok = false; }
    if (!ok) break;
    keep = i + 1;
  }
  const rest = seg.slice(keep).join('/');
  if (!rest || keep === seg.length) return s;    // nothing recoverable — hand it back and let the 404 speak
  // Warn ONCE per path: abs() is called again to report the url, and a doubled
  // warning reads like two different repairs.
  if (!_warnedPaths.has(s)) { _warnedPaths.add(s); try { console.error('[shoot] repaired a Git-Bash-mangled path: ' + s + '  →  /' + rest + '   (pass it WITHOUT a leading slash to avoid this)'); } catch (e) {} }
  return '/' + rest;
}

const NO_WEBGL = () => {
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    if (/^(webgl2?|experimental-webgl)$/.test(String(kind))) return null;
    return real.call(this, kind, ...rest);
  };
  if (typeof OffscreenCanvas !== 'undefined') {
    const realOff = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (kind, ...rest) {
      if (/^(webgl2?|experimental-webgl)$/.test(String(kind))) return null;
      return realOff.call(this, kind, ...rest);
    };
  }
};

/* Save a PNG, creating the round directory. Accepts a page OR a locator, so a
   critic can crop to the hover card without doing clip arithmetic. Returns the
   absolute path so it can go straight into the progress log. */
export async function shot(target, file, opts = {}) {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await target.screenshot({ path: abs, animations: 'disabled', ...opts });
  return abs;
}

export async function withPage(fn, { w = 1600, h = 900, webgl = true, reducedMotion = false, dpr = 1, touch = false } = {}) {
  let srv = null, browser = null;
  const logs = [], errors = [];
  try {
    srv = await startServer({ port: 0 });
    browser = await chromium.launch({ args: SWIFTSHADER_ARGS });
    const context = await browser.newContext({
      viewport: { width: w, height: h }, deviceScaleFactor: dpr,
      serviceWorkers: 'block', colorScheme: 'dark', hasTouch: touch,
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    });
    if (!webgl) await context.addInitScript(NO_WEBGL);
    /* One Chromium, many pages. A launch costs ~1.7 s; a suite that walks six
       states of one view should pay it once. t.newPage() gives another page in
       the SAME fresh context with the same capture wired, logs prefixed with
       its label so two pages' errors cannot be confused. */
    const wire = (page, label) => {
    const tag = label ? '[' + label + '] ' : '';
    page.on('console', (m) => { const l = m.type()[0] + ':' + m.text().slice(0, 400); logs.push(tag + l); if (m.type() === 'error') errors.push(tag + l); });
    page.on('pageerror', (e) => { const l = tag + 'E:' + String(e && e.stack || e).slice(0, 600); logs.push(l); errors.push(l); });
    page.on('requestfailed', (r) => { logs.push(tag + 'F:' + r.url().replace(srv.base, '') + ' ' + ((r.failure() || {}).errorText || '')); });
    page.on('response', (r) => { if (r.status() >= 400) { const l = tag + 'H:' + r.status() + ' ' + r.url().replace(srv.base, ''); logs.push(l); errors.push(l); } });
    return page;
    };
    const page = wire(await context.newPage(), '');
    const abs = (p0) => { const p = unmangle(p0); return /^https?:/.test(p) ? p : srv.base + (p.startsWith('/') ? p : '/' + p); };
    const t = {
      base: srv.base, port: srv.port, logs, errors, browser, context, shot,
      /* The MAIN navigation's status, kept separately from `errors` because it
         is the one failure that makes every later assertion meaningless: a
         404'd harness still renders a page, still screenshots, still reports
         zero page errors. null until the first goto. */
      navStatus: null,
      /* Set to true by a test that is deliberately photographing a broken
         state; the CLI's --allow-errors sets it too. It suppresses nothing
         during the run (errors/logs are still collected and still printed) —
         it only stops assertClean()/the CLI from failing on them. */
      allowErrors: false,
      // 'load', not 'networkidle': the real index.html holds sockets open and
      // never goes idle. Callers wait on their own ready signal.
      goto: async (p, o) => {
        const res = await page.goto(abs(p), { waitUntil: 'load', timeout: 60000, ...o });
        try { t.navStatus = res ? res.status() : null; } catch (e) { t.navStatus = null; }
        return res;
      },
      url: abs,
      /* Throw unless the photograph is of a healthy page. Call it in a suite
         that asserts on pixels; the CLI applies the same rule to its exit code
         so a shell script gets the verdict without parsing the JSON. */
      assertClean: () => {
        if (t.allowErrors) return t;
        if (t.navStatus !== null && t.navStatus >= 400) throw new Error('shoot: main navigation returned HTTP ' + t.navStatus + ' — the screenshot is of an error page');
        if (errors.length) throw new Error('shoot: the page reported ' + errors.length + ' error(s):\n' + errors.join('\n'));
        return t;
      },
      newPage: async (label) => wire(await context.newPage(), label || 'p' + context.pages().length),
      /* Wait for a harness page's ready flag. NOT waitForSelector: its default
         state is 'visible', and a page whose only content is a fixed/absolute
         overlay (#sc-overlay is exactly that) has a zero-height <body>, so
         body[data-ready="1"] counts as hidden and the wait burns 30 s and
         fails on a page that is fine. waitForFunction asks the DOM, not the
         layout. `sel` may be any selector; `pg` defaults to the first page. */
      ready: (sel = '[data-ready="1"]', { timeout = 30000, page: pg = page } = {}) =>
        pg.waitForFunction((q) => !!document.querySelector(q), sel, { timeout }),
    };
    return await fn(page, t);
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { if (srv) await srv.close(); } catch (e) {}
  }
}

/* The proof this file works on THIS machine: render three.js r128 through
   SwiftShader, read a pixel back in the same task, and check the fake bridge
   and sc.bridge.js answered. Returns the page's report; throws on failure. */
export async function selftest(out) {
  return withPage(async (page, t) => {
    await t.goto('/__sc/selftest.html?owns=mining');
    await t.ready('body[data-ready="1"]');
    const info = await page.evaluate(() => window.__selftest);
    if (out) info.shot = await shot(page, out);
    info.port = t.port; info.errors = t.errors;
    const lit = info.pixel && (info.pixel[0] + info.pixel[1] + info.pixel[2]) > 60;   // the gold cube, not the near-black clear colour
    if (!info.webgl || !lit) throw new Error('shoot selftest: WebGL did not render — ' + JSON.stringify(info));
    if (!info.bridgeReady) throw new Error('shoot selftest: fake bridge not ready — ' + JSON.stringify(info));
    return info;
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2);
  const flag = (n, d) => { const i = a.indexOf('--' + n); return i < 0 ? d : a[i + 1]; };
  const has = (n) => a.includes('--' + n);
  try {
    if (has('selftest')) {
      const i = a.indexOf('--selftest');
      const out = a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : null;
      console.log(JSON.stringify(await selftest(out), null, 1));
    } else {
      const positional = a.filter((x, i) => !x.startsWith('--') && !(a[i - 1] || '').match(/^--(w|h|wait|wait-for|eval|url)$/));
      const url = flag('url') || positional[0];
      const out = flag('url') ? positional[0] : positional[1];
      if (!url || !out) { console.error('usage: node tools/supplychain/shoot.mjs __sc/harness-scene3d.html out.png [--w n] [--h n] [--wait ms] [--wait-for css] [--no-webgl] [--full] [--eval js] [--allow-errors]\n       (the url path takes NO leading slash — Git Bash rewrites one into a Windows path)'); process.exit(2); }
      const res = await withPage(async (page, t) => {
        t.allowErrors = has('allow-errors');
        await t.goto(url);
        if (flag('wait-for')) await t.ready(flag('wait-for'));   // attached, not visible — see t.ready
        await page.waitForTimeout(+flag('wait', 800));
        const ev = flag('eval') ? await page.evaluate(flag('eval')) : undefined;
        const file = await shot(page, out, { fullPage: has('full') });
        return { file, url: t.url(url), status: t.navStatus, eval: ev, errors: t.errors, logs: t.logs.slice(-30), allowErrors: t.allowErrors };
      }, { w: +flag('w', 1600), h: +flag('h', 900), webgl: !has('no-webgl') });
      /* 🔴 The JSON goes to stdout EITHER WAY — a failed shot still tells you
         what it saw — but the exit code is now the verdict. Silence here was
         the round-1 hole: `errors` was printed and ignored, so a photograph of
         a 404 passed. stderr repeats the reason so a shell sees it too. */
      console.log(JSON.stringify(res, null, 1));
      if (!res.allowErrors && (res.errors.length || (res.status !== null && res.status >= 400))) {
        console.error('[shoot] FAILED — the screenshot is not of a healthy page' +
          (res.status !== null && res.status >= 400 ? ('\n  main navigation: HTTP ' + res.status + ' ' + res.url) : '') +
          (res.errors.length ? ('\n  ' + res.errors.join('\n  ')) : '') +
          '\n  (pass --allow-errors if you are photographing an error state on purpose)');
        process.exit(1);
      }
    }
  } catch (e) { console.error(String(e && e.stack || e)); process.exit(1); }
}
