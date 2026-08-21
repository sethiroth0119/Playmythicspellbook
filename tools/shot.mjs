#!/usr/bin/env node
/**
 * tools/shot.mjs — render any menu page of Mythic Spellbook to a PNG.
 *
 *   node tools/shot.mjs <page> <out.png> [--budget=ms] [--size=WxH] [--keep] [--quiet]
 *
 *   page: main | battle | forge | exchange | codex | field | arcanum | cardshop
 *
 * WHY this exists: design work on the menus has to be LOOKED at, and this
 * environment has no Playwright and no compositing browser pane. So we drive the
 * pre-installed headless Chromium directly (no npm install, ever) and hand back a
 * PNG that an agent can Read.
 *
 * HOW the full app is captured:
 *   public/index.html boots into App.screen='authGate' and only reaches a hub
 *   through async sign-in. We do NOT try to log in. Instead we copy the page to a
 *   throwaway file, add:
 *     1. <base href=".../public/">  — the copy lives outside public/, so every
 *        relative asset URL (assets/artwork/…, src/battle/*.css) would 404 without it.
 *     2. a requestAnimationFrame shim (setTimeout) — RAF is unreliable in the
 *        headless/virtual-time environment and render() is RAF-batched, so without
 *        the shim the page paints nothing.
 *     3. a bootstrap that repeatedly sets App.screen / App.titleHub and calls
 *        render() directly for the first few seconds, then stops so the final
 *        frame is a settled render.
 *   App / Profile / Forge are top-level `const` (a global LEXICAL binding, not
 *   window.*) — see CLAUDE.md. A CLASSIC <script> shares that lexical scope and can
 *   read them; an ES module cannot. The bootstrap is therefore a classic script.
 *
 * Google Fonts (Cinzel — the whole typographic identity of the menu) are fetched
 * through the agent proxy with curl and inlined as data: URIs, cached under
 * work/.fonts/. Chromium itself does not trust the proxy CA, so a live <link> to
 * fonts.googleapis.com fails and the page silently falls back to Georgia — which
 * makes every screenshot lie about the typography. Never fix that by disabling TLS
 * verification; curl already trusts the bundle, so we let curl do the fetching.
 *
 * Exits non-zero with a readable message if the PNG is missing, blank or black.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PUBLIC = path.join(REPO, 'public');

const CHROME = process.env.SHOT_CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Throwaway copies + font cache live here (never inside the repo — a 13 MB copy of
// index.html in public/ would get deployed).
const WORK = process.env.SHOT_WORK
  || '/tmp/claude-0/-home-user-Playmythicspellbook/100f27e2-18bc-569c-9c2a-7fd9365dc961/scratchpad/work';

// page id -> what to bootstrap. 'main' is the standalone painted menu; everything
// else is the full app forced onto a title hub (or a screen, for the Card Shop).
const PAGES = {
  main:     { kind: 'standalone', file: path.join(PUBLIC, 'main-menu', 'index.html') },
  battle:   { kind: 'app', screen: 'title', hub: 'battle' },
  forge:    { kind: 'app', screen: 'title', hub: 'forge' },
  exchange: { kind: 'app', screen: 'title', hub: 'exchange' },
  codex:    { kind: 'app', screen: 'title', hub: 'codex' },
  field:    { kind: 'app', screen: 'title', hub: 'field' },
  arcanum:  { kind: 'app', screen: 'title', hub: 'arcanum' },
  // The Card Shop is a SCREEN, not a hub — the main menu's portal sets
  // App.screen='cardShop' (see PORTALS.main in index.html). Same bootstrap, no hub.
  cardshop: { kind: 'app', screen: 'cardShop', hub: 'main' },
};

// ---------------------------------------------------------------- cli
function die(msg, code = 1) {
  process.stderr.write('shot: ' + msg + '\n');
  process.exit(code);
}

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of argv) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags[k] = v === undefined ? true : v;
  } else positional.push(a);
}
if (flags.help || positional.length < 1) {
  process.stdout.write(
    'usage: node tools/shot.mjs <page> <out.png> [options]\n' +
    '       pages: ' + Object.keys(PAGES).join(' | ') + '\n' +
    '   or: node tools/shot.mjs check <file.png>   (blank/black test, no render)\n' +
    '\n' +
    '  --budget=ms   virtual-time budget before the shot (default 12000)\n' +
    '  --size=WxH    viewport (default 1920x1080)\n' +
    '  --full        grow the viewport to the whole page (hubs with 3+ tile rows\n' +
    '                are cut off at 1080; costs a second render pass)\n' +
    '  --admin       render as an admin — reveals admin-only tiles on some hubs\n' +
    '  --banner      keep the "Playing offline" banner (hidden by default: it is\n' +
    '                an artefact of the harness and sits over the page title)\n' +
    '  --keep        keep the throwaway HTML copy for inspection\n' +
    '  --quiet       no progress on stderr (the PNG path still prints on stdout)\n');
  process.exit(positional.length < 1 ? 2 : 0);
}
const page = String(positional[0]).toLowerCase();
if (page === 'check') {
  // node tools/shot.mjs check <file.png> — run the blank/black test on an existing
  // PNG (same code path the capture uses). Handy when another tool produced the shot.
  const f = positional[1];
  if (!f) die('check needs a PNG path', 2);
  let s;
  try { s = pngStats(path.resolve(f)); } catch (e) { die(`cannot read ${f}: ${e.message}`); }
  const d = `${s.w}x${s.h} meanLum=${s.meanLum.toFixed(1)} colors=${s.colors} modal=${(s.modalFrac * 100).toFixed(1)}%`;
  if (isBlank(s)) die(`BLANK — ${d}`);
  process.stdout.write(`ok — ${d}\n`);
  process.exit(0);
}
const spec = PAGES[page];
if (!spec) die(`unknown page "${page}". Known pages: ${Object.keys(PAGES).join(', ')}`, 2);

const out = path.resolve(positional[1] || path.join(WORK, `${page}.png`));
const budget = Number(flags.budget || 12000);
const size = String(flags.size || '1920,1080').replace('x', ',');
const [vw, vh] = size.split(',').map(n => parseInt(n, 10));
const quiet = !!flags.quiet;
const log = (...a) => { if (!quiet) process.stderr.write('shot: ' + a.join(' ') + '\n'); };

if (!fs.existsSync(CHROME)) die(`headless chromium not found at ${CHROME} (set SHOT_CHROME)`);
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });

// ---------------------------------------------------------------- fonts
// Fetch a URL with curl (curl trusts the agent-proxy CA; Chromium does not).
function curl(url, binary) {
  const r = spawnSync('curl', [
    '-sSL', '--max-time', '40',
    '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    url,
  ], { maxBuffer: 64 * 1024 * 1024, encoding: binary ? 'buffer' : 'utf8' });
  if (r.status !== 0) return null;
  const body = r.stdout;
  if (!body || !body.length) return null;
  return body;
}

const FONTDIR = path.join(WORK, '.fonts');
function cached(key, ext, produce) {
  fs.mkdirSync(FONTDIR, { recursive: true });
  const f = path.join(FONTDIR, crypto.createHash('sha1').update(key).digest('hex').slice(0, 16) + ext);
  if (fs.existsSync(f) && fs.statSync(f).size > 0) return fs.readFileSync(f);
  const v = produce();
  if (v == null) return null;
  fs.writeFileSync(f, v);
  return Buffer.isBuffer(v) ? v : Buffer.from(v);
}

/** Build a <style> with every Google-Fonts family the page asks for, inlined. */
function inlineGoogleFonts(html) {
  const urls = [...new Set(
    (html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"'\s>]+/g) || [])
      .map(u => u.replace(/&amp;/g, '&'))
  )];
  if (!urls.length) return '';
  let css = '';
  for (const u of urls) {
    const sheet = cached('css:' + u, '.css', () => curl(u, false));
    if (!sheet) { log(`WARN could not fetch ${u} — falling back to system serif`); continue; }
    let text = sheet.toString('utf8');
    const fontUrls = [...new Set(text.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [])];
    for (const fu of fontUrls) {
      const bin = cached('bin:' + fu, path.extname(fu) || '.woff2', () => curl(fu, true));
      if (!bin) { log(`WARN could not fetch font file ${fu}`); continue; }
      const mime = fu.endsWith('.woff2') ? 'font/woff2' : fu.endsWith('.woff') ? 'font/woff' : 'font/ttf';
      text = text.split(fu).join(`data:${mime};base64,${bin.toString('base64')}`);
    }
    css += text + '\n';
  }
  if (!css) return '';
  return '<style id="shot-fonts">\n' + css + '\n</style>\n';
}

// ---------------------------------------------------------------- page prep
const RAF_SHIM = `<script>
/* shot.mjs — RAF shim. render() is RAF-batched and RAF never fires reliably in this
   headless/virtual-time setup, so without this the app paints nothing at all.
   Keeps the timestamp argument: callers that read it would otherwise get undefined. */
(function () {
  var _t = 0;
  window.requestAnimationFrame = function (cb) {
    return setTimeout(function () { try { cb(performance.now()); } catch (e) {} }, 16);
  };
  window.cancelAnimationFrame = function (id) { clearTimeout(id); };
  void _t;
})();
<\/script>
`;

// --full needs the page's real height, and there is no CDP here. So the page
// publishes it in its <title>, and the measure pass reads it back out of
// --dump-dom output (grepped in the shell so node never buffers 13 MB of DOM).
const MEASURE_SCRIPT = `<script>
setInterval(function () {
  try {
    var h = Math.max(
      document.documentElement.scrollHeight || 0,
      (document.body && document.body.scrollHeight) || 0);
    document.title = 'SHOTMEASURE:' + h;
  } catch (e) {}
}, 250);
<\/script>
`;

function bootstrapScript(screen, hub) {
  return `<script>
/* shot.mjs — bootstrap. Drives the app onto one screen/hub without signing in.
   App / render / Profile are global LEXICAL consts, so this MUST stay a classic
   script (an ES module cannot see them — see CLAUDE.md "the globals trap").
   We force repeatedly for a few seconds because the app's own async boot keeps
   re-rendering (auth gate, cloud load), then stop so the final frame is settled. */
(function () {
  var SCREEN = ${JSON.stringify(screen)}, HUB = ${JSON.stringify(hub)};
  var KEEP_BANNER = ${flags.banner ? 'true' : 'false'};
  var ADMIN = ${flags.admin ? 'true' : 'false'};
  var S = window.__SHOT = { forced: 0, errors: [], screen: null, hub: null, ready: false };
  window.addEventListener('error', function (e) {
    try { S.errors.push(String((e && e.message) || e)); } catch (_) {}
  });
  function hideSplash() {
    try {
      var b = document.getElementById('boot-splash');
      if (b) b.parentNode.removeChild(b);
      if (window.BootSplash && typeof window.BootSplash.done === 'function') window.BootSplash.done();
    } catch (_) {}
  }
  function clearGates() {
    // The first-run onboarding ("WELCOME TO ETHOS HEIGHTS") is a full-screen
    // z-index 2147483270 overlay and shouldRunOnboarding() returns true for any
    // offline player with no battles — i.e. always, here. Satisfy the gate the
    // same way _onbFinish does instead of fighting it.
    try {
      if (typeof Profile !== 'undefined' && Profile) {
        Profile.onboarding = Profile.onboarding || {};
        Profile.onboarding.complete = true;
        Profile.onboarding.forceNew = false;
        Profile.onboarding.step = 'complete';
      }
      if (typeof Onboarding === 'object' && Onboarding) {
        Onboarding.step = null; Onboarding._forceNew = false; Onboarding._adminPreview = false;
      }
      App._tutorialWelcomeDismissed = true;
    } catch (_) {}
    // 🚧 The other first-run interceptors that sit IN FRONT of every menu for a
    // fresh offline profile: the starter-deck picker (_mustPickStarter), the wiped-
    // player rescue (_isWipedNewPlayer), the onboarding gate and the maintenance
    // lock. They are plain function DECLARATIONS, so — unlike App/Profile — they
    // are real window properties and can be stubbed. Stubbing the predicate is
    // honest: it changes which screen we land on, and nothing about how that
    // screen is drawn. Faking a profile instead would invent badges and counts.
    var STUBS = {
      shouldRunOnboarding: false, _mustPickStarter: false, needsStarterPick: false,
      _isWipedNewPlayer: false, _maintenanceOn: false, hasPickedStarter: true,
    };
    // --admin: several hubs hide whole tiles from non-admins (Card Forge, Move
    // Forge, Sprite Studio, pricing…). Opt in when you need to see those tiles.
    if (ADMIN) STUBS.isAdmin = true;
    Object.keys(STUBS).forEach(function (k) {
      try {
        if (typeof window[k] === 'function' && !window[k].__shotStub) {
          var v = STUBS[k];
          var f = function () { return v; };
          f.__shotStub = true;
          window[k] = f;
        }
      } catch (_) {}
    });
    scrub();
  }
  // Overlays that are ARTEFACTS OF THIS HARNESS, not of the design: the onboarding
  // screen, and the "Playing offline" banner — which only exists because we forced
  // offlineMode to get past the auth gate, and which parks itself over the page
  // title at z-index 2147483400. Nothing else is removed.
  function scrub() {
    try { document.querySelectorAll('.onb-screen').forEach(function (n) { n.remove(); }); } catch (_) {}
    try {
      var b = document.getElementById('offline-warn-banner');
      if (b && !KEEP_BANNER) b.remove();
    } catch (_) {}
  }
  function force() {
    try {
      if (typeof App === 'undefined' || typeof render !== 'function') return false;
      // Offline mode: keeps the auth gate from bouncing us back to sign-in and
      // stops cloud calls (which cannot succeed from file://) from gating the UI.
      try { if (typeof Profile !== 'undefined' && Profile && Profile.cloud) Profile.cloud.offlineMode = true; } catch (_) {}
      clearGates();
      App.screen = SCREEN;
      App.titleHub = HUB;
      render();
      clearGates();
      S.forced++; S.ready = true;
      S.screen = App.screen; S.hub = App.titleHub;
      hideSplash();
      return true;
    } catch (e) {
      try { S.errors.push('force: ' + ((e && e.stack) || e)); } catch (_) {}
      return false;
    }
  }
  // Force on a decaying schedule: early attempts land before/while the app boots,
  // later ones win back the screen if boot re-rendered over us. The last one is
  // ~3.2s in, leaving the rest of the virtual-time budget for art to load and for
  // entrance animations to settle.
  [0, 60, 150, 300, 600, 900, 1400, 2000, 2600, 3200].forEach(function (t) {
    setTimeout(force, t);
  });
  // Async app code re-mounts the offline banner after our last force, so keep
  // scrubbing for the whole capture. Idempotent and cheap.
  setInterval(scrub, 120);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', force);
  window.addEventListener('load', force);
})();
<\/script>
`;
}

/** Write the throwaway page under WORK and return its path. */
function preparePage() {
  const srcFile = spec.kind === 'standalone'
    ? spec.file
    : path.join(PUBLIC, 'index.html');
  if (!fs.existsSync(srcFile)) die(`source page not found: ${srcFile}`);

  let html = fs.readFileSync(srcFile, 'utf8');
  const baseDir = path.dirname(srcFile);
  const baseHref = 'file://' + baseDir.replace(/\/?$/, '/');

  const head = [
    `<base href="${baseHref}">`,
    RAF_SHIM,
    MEASURE_SCRIPT,
    inlineGoogleFonts(html),
  ].join('\n');

  // <base> has to be the first thing in <head> or the relative URLs above it resolve
  // against the throwaway file's own directory and 404.
  const headTag = html.match(/<head[^>]*>/i);
  if (!headTag) die(`no <head> in ${srcFile} — cannot inject the harness`);
  html = html.replace(headTag[0], headTag[0] + '\n' + head);

  if (spec.kind === 'app') {
    const boot = bootstrapScript(spec.screen, spec.hub);
    const i = html.lastIndexOf('</body>');
    html = i === -1 ? html + boot : html.slice(0, i) + boot + html.slice(i);
  }

  const dest = path.join(WORK, `shot-${page}.html`);
  fs.writeFileSync(dest, html);
  return dest;
}

// ---------------------------------------------------------------- png checking
/** Minimal PNG reader — enough to tell "real UI" from "blank/black". */
function readPngPixels(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0), h: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('PNG has no IHDR');
  if (ihdr.depth !== 8 || ihdr.interlace !== 0 || (ihdr.color !== 2 && ihdr.color !== 6)) {
    throw new Error(`unsupported PNG (depth ${ihdr.depth} color ${ihdr.color})`);
  }
  const ch = ihdr.color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * ch;
  const outBuf = Buffer.alloc(ihdr.h * stride);
  let p = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = outBuf.subarray(y * stride, (y + 1) * stride);
    const prev = y ? outBuf.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= ch) ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { ...ihdr, ch, stride, px: outBuf };
}

function pngStats(file) {
  const img = readPngPixels(fs.readFileSync(file));
  const counts = new Map();
  let lum = 0, n = 0;
  for (let y = 0; y < img.h; y += 4) {
    for (let x = 0; x < img.w; x += 4) {
      const i = y * img.stride + x * img.ch;
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++;
      // Quantise to 5 bits/channel so JPEG-ish gradients don't read as "lots of colours".
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let modal = 0;
  for (const c of counts.values()) if (c > modal) modal = c;
  return { w: img.w, h: img.h, meanLum: lum / n, colors: counts.size, modalFrac: modal / n };
}

/** "Nothing was drawn" — a flat fill, a near-black frame, or a handful of colours.
    Deliberately loose: these menus are legitimately dark (meanLum ~15) and the real
    failure mode is a page that never rendered at all. */
function isBlank(s) {
  return s.colors < 12 || s.modalFrac > 0.995 || (s.meanLum < 2 && s.colors < 64);
}

// ---------------------------------------------------------------- run
const pageFile = preparePage();
log(`page ${page} -> ${pageFile}`);
try { fs.unlinkSync(out); } catch (_) {}

const COMMON = [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--allow-file-access-from-files',
  '--run-all-compositor-stages-before-draw',
];

let height = vh;
if (flags.full) {
  // Measure pass: render once at the nominal size and read the height the page
  // published into its <title>. grep runs in the shell so the DOM dump never
  // lands in a node buffer.
  const cmd = [JSON.stringify(CHROME), ...COMMON, `--virtual-time-budget=${Math.min(budget, 9000)}`,
    `--window-size=${vw},${vh}`, '--dump-dom', JSON.stringify('file://' + pageFile)]
    .join(' ') + " 2>/dev/null | grep -ao 'SHOTMEASURE:[0-9]*' | tail -1";
  const m = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const got = parseInt(((m.stdout || '').match(/SHOTMEASURE:(\d+)/) || [])[1] || '0', 10);
  if (got > vh) height = Math.min(got + 24, 6000);   // +24 so the last row isn't shaved
  log(`--full: measured ${got || 'nothing'} -> capturing ${vw}x${height}`);
}

const args = [
  ...COMMON,
  `--virtual-time-budget=${budget}`,
  `--window-size=${vw},${height}`,
  `--screenshot=${out}`,
  'file://' + pageFile,
];
const r = spawnSync(CHROME, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: Math.max(60000, budget * 8) });
// SSL handshake noise on stderr is expected here (Chromium does not trust the agent
// proxy CA) and is harmless — the fonts were already inlined above.
if (r.error) die(`chromium failed to run: ${r.error.message}`);

if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
  const tail = (r.stderr || '').split('\n').filter(l => !/handshake failed|ssl_client_socket/i.test(l)).slice(-12).join('\n');
  die(`no screenshot written for "${page}" (chromium exit ${r.status}).\n${tail}`);
}

let stats;
try { stats = pngStats(out); }
catch (e) { die(`screenshot written but unreadable: ${e.message}`); }

const blank = isBlank(stats);

const desc = `${stats.w}x${stats.h} meanLum=${stats.meanLum.toFixed(1)} colors=${stats.colors} modal=${(stats.modalFrac * 100).toFixed(1)}%`;

if (!flags.keep && spec.kind === 'app') {
  // Keep the standalone copies (cheap); drop the 13 MB app copies unless asked.
  try { fs.unlinkSync(pageFile); } catch (_) {}
}

if (blank) {
  die(`"${page}" rendered BLANK — ${desc}. The PNG is at ${out}; re-run with --keep to inspect ${path.join(WORK, 'shot-' + page + '.html')}.`);
}

log(`ok ${out} — ${desc}`);
process.stdout.write(out + '\n');
