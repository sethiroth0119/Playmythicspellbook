/* ══════════════════════════════════════════════════════════════════════════
   SW UPDATE MEMORY — what an update costs the BROWSER process. (bug-mui2j3wd)

   GreyDragon's minidump (2026-09-26) says the crash was
   0xE0000008 OUT_OF_MEMORY, software-raised and noncontinuable, in Chrome's
   BROWSER process — 65 threads, dhcpcsvc/firewallapi/winhttp/directmanipulation
   loaded, no d3d11/opengl32, so neither a renderer nor the GPU process. It held
   3.09 GB committed / 2.17 GB private when it died. That is why the report says
   "browser closes with no warning" rather than an Aw-Snap tab.

   The owner confirms it was the update BEFORE the most recent, i.e. the load
   into v121v191 — which the v190 worker served, and the v190 worker still had
   the `await copy.text()` populate path. (The fix landed in v192 and could not
   protect its own rollout: the v191 worker served that update too. The first
   protected update is the one into v193.)

   So the question this answers is narrow and measurable: HOW MUCH does the
   browser process grow across one update, with the old worker versus the new?

   🔴 WHY THE BROWSER PROCESS AND NOT THE RENDERER. cache.put() does not keep
      the body in the worker's renderer — it ships it over mojo to the
      CacheStorage backend, which lives in the browser process. A body built
      from a 17-million-character JS string is materialised in the renderer AND
      buffered in the browser process. Renderer-side leak hunts cannot see the
      second half, which is why every earlier probe came back clean.

   ⚠ THIS RIG MUST HAVE A CONTROL AND BOTH ARMS MUST ACTUALLY TAKE THE PATH.
     An arm that never runs the populate branch reports a flattering zero for
     code it did not execute — the same failure the first shellcache-probe had.
     Each arm therefore asserts the shell cache was (re)written before its
     numbers are believed.

   Usage:
     node .gauntlet/swupdate-mem.mjs                    # both arms
     node .gauntlet/swupdate-mem.mjs --arm old          # v190 -> v191 only
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ONLY = flag('arm', null);
const LOOPS = Number(flag('loops', 3));

const ARMS = [
  { key: 'old', label: 'v190 -> v191   (old worker: await copy.text())', from: 'C:/r190/public', to: 'C:/r191/public' },
  { key: 'new', label: 'v192 -> v193   (new worker: streamed body)    ', from: 'C:/r192/public', to: 'C:/r193/public' },
].filter(a => !ONLY || a.key === ONLY);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary','.ico':'image/x-icon' };

/* ── the OS is the only honest source for browser-process memory ── */
function procMem(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-Process -Id ${pid} -ErrorAction Stop; ` +
      `$k=(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSetSize -Sum).Sum; ` +
      `"{0},{1},{2}" -f $p.PrivateMemorySize64, $p.WorkingSet64, [int64]$k`
    ], { encoding: 'utf8', timeout: 30000 }).trim();
    const [priv, ws, kids] = out.split(',').map(Number);
    return { priv, ws, kids: kids || 0 };
  } catch (e) { return null; }
}
const MB = n => (n / 1048576).toFixed(0).padStart(6) + ' MB';

/* browser.process() is not exposed in this Playwright build, so find the
   browser process the way the minidump identified it: the chromium process
   with NO --type= on its command line. Every renderer, GPU and utility process
   carries one. Taken as a delta against a pre-launch snapshot so a Chrome the
   owner has open is never sampled. */
function chromiumPids() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|chromium|msedge|chrome-headless-shell)' ` +
      `-and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }`
    ], { encoding: 'utf8', timeout: 30000 }).trim();
    return out ? out.split(/\s+/).map(Number).filter(Boolean) : [];
  } catch (e) { return []; }
}

async function runArm(arm) {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  ARM: ' + arm.label);
  console.log('══════════════════════════════════════════════════════════');
  for (const d of [arm.from, arm.to]) {
    if (!fs.existsSync(path.join(d, 'index.html'))) { console.log('  SKIP — missing ' + d); return null; }
  }

  /* one server, a swappable root: that is what a deploy looks like to a client */
  let ROOT = arm.from;
  let docHits = 0;
  const PORT = 9700 + Math.floor(Math.random() * 200);
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    if (p === '/index.html') docHits++;
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
    /* no-store on the worker so the update check is not masked by the HTTP cache */
    const h = { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' };
    if (p === '/sw.js' || p === '/version.txt') h['Cache-Control'] = 'no-store';
    r.writeHead(200, h);
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const URL_ = 'http://127.0.0.1:' + PORT + '/index.html';

  const pidsBefore = new Set(chromiumPids());
  /* the real Chrome when it is installed: the reporter's crash was in Chrome
     154's browser process, and chrome-headless-shell is not the same binary. */
  let browser = null;
  try { browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
  catch (e) { console.log('  (real Chrome unavailable — falling back to bundled chromium)'); }
  if (!browser) browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await new Promise(r => setTimeout(r, 2500));
  const fresh = chromiumPids().filter(p => !pidsBefore.has(p));
  const pid = fresh[0];
  if (!pid) { console.log('  cannot identify the browser process'); await browser.close(); srv.close(); return null; }
  console.log('  browser process pid ' + pid + (fresh.length > 1 ? '  (of ' + fresh.length + ' new)' : ''));

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
  /* only our own origin — no CDN, no Supabase */
  await page.route('**/*', r => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));

  const load = async (tag) => {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForTimeout(6000);
    return tag;
  };
  const swState = () => page.evaluate(async () => {
    const out = { controller: false, caches: [], shellVer: null, shellBytes: null };
    try {
      out.controller = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      const names = await caches.keys();
      out.caches = names;
      for (const n of names) {
        if (n.indexOf('shell') < 0) continue;
        const c = await caches.open(n);
        const res = await c.match('/__shell__');
        if (res) {
          out.shellVer = res.headers.get('x-shell-version');
          out.shellBytes = (await res.clone().arrayBuffer()).byteLength;
        }
      }
    } catch (e) { out.err = String(e && e.message); }
    return out;
  });

  /* ── 1. settle on the OLD build: register, activate, populate ── */
  await load('install');
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.register('/sw.js').catch(() => {}));
  await page.waitForTimeout(4000);
  await load('settle');           // now controlled, shell cached at the old version
  await page.waitForTimeout(5000);
  const before = await swState();
  const m0 = procMem(pid);
  console.log('  settled on ' + path.basename(path.dirname(arm.from)) +
              '   shell=' + before.shellVer + '  controller=' + before.controller);
  console.log('    browser private ' + MB(m0.priv) + '   ws ' + MB(m0.ws) + '   children ' + MB(m0.kids));

  /* ── 2. DEPLOY: swap the root under the running client ── */
  ROOT = arm.to;
  console.log('  ── deployed ' + path.basename(path.dirname(arm.to)) + ' ──');

  const samples = [];
  for (let i = 1; i <= LOOPS; i++) {
    await load('update' + i);
    await page.waitForTimeout(7000);
    const m = procMem(pid);
    const st = await swState();
    samples.push({ i, m, st });
    console.log('    load ' + i + ': private ' + MB(m.priv) + '   ws ' + MB(m.ws) +
                '   children ' + MB(m.kids) + '   shell=' + st.shellVer +
                (st.shellBytes ? ' (' + (st.shellBytes / 1048576).toFixed(1) + ' MB)' : ''));
  }

  const last = samples[samples.length - 1];
  const grew = last.m.priv - m0.priv;
  console.log('  ── browser-process private growth across the update: ' +
              (grew >= 0 ? '+' : '') + (grew / 1048576).toFixed(0) + ' MB');

  /* the arm is only believable if the populate branch actually ran */
  const rewrote = last.st.shellVer && before.shellVer && last.st.shellVer !== before.shellVer;
  console.log('  ── the shell cache was rewritten to the new version: ' + (rewrote ? 'YES' : 'NO  ⚠ this arm may not have taken the path'));
  console.log('  ── document fetches served: ' + docHits);

  await browser.close(); srv.close();
  return { arm, m0, samples, grew, rewrote, docHits };
}

const results = [];
for (const a of ARMS) { const r = await runArm(a); if (r) results.push(r); }

console.log('\n\n══ SUMMARY ══');
for (const r of results) {
  console.log('  ' + r.arm.key.padEnd(4) + '  ' + r.arm.label +
              '   growth ' + ((r.grew >= 0 ? '+' : '') + (r.grew / 1048576).toFixed(0) + ' MB').padStart(9) +
              '   path taken: ' + (r.rewrote ? 'yes' : 'NO'));
}
if (results.length === 2 && results[0].rewrote && results[1].rewrote) {
  const d = results[0].grew - results[1].grew;
  console.log('\n  the old worker costs the browser process ' + (d / 1048576).toFixed(0) +
              ' MB more per update than the new one.');
}
