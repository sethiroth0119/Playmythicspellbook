/* ══════════════════════════════════════════════════════════════════════════
   🖼 SHOT-MENUS — render every menu surface on THIS machine and grade it.

   tools/shot.mjs is the harness the hub redesign was built against and it is
   the right authority for WHAT to render and HOW to grade it. It cannot run
   here: it spawns a chromium at a hardcoded Linux container path and writes its
   scratch HTML to a POSIX scratchpad. Rather than re-implement its judgement,
   this driver imports nothing from it but COPIES ITS TWO DECISIONS —
     · the page map (which screen + which hub each name means), and
     · pngStats + the blank test, verbatim, including the 5-bit colour quantise
   and drives them through the local Playwright the rest of .gauntlet uses.

   🔴 WHAT THE NUMBERS MEAN (from the handoff, not invented here):
     healthy hubs sit around meanLum 12-20 and modal 15-35%.
     A meanLum near zero, or a modal share near 100%, means the page rendered
     BLANK — the failure this redesign hit twice. That is why a screenshot alone
     is not the check: a black PNG looks like a moody menu until it is measured.

   Run:  node .gauntlet/shot-menus.mjs [page]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(process.cwd(), 'public');
const OUT = path.resolve(process.cwd(), 'tmp/shots');
fs.mkdirSync(OUT, { recursive: true });

/* ── the page map, copied from tools/shot.mjs PAGES ───────────────────────── */
const PAGES = {
  main:     { kind: 'standalone', url: '/main-menu/index.html' },
  battle:   { kind: 'app', screen: 'title', hub: 'battle' },
  forge:    { kind: 'app', screen: 'title', hub: 'forge' },
  exchange: { kind: 'app', screen: 'title', hub: 'exchange' },
  codex:    { kind: 'app', screen: 'title', hub: 'codex' },
  field:    { kind: 'app', screen: 'title', hub: 'field' },
  arcanum:  { kind: 'app', screen: 'title', hub: 'arcanum' },
  cardshop: { kind: 'app', screen: 'cardShop', hub: 'main' },
  /* 📜 index.html AT the main hub — NOT the same as `main`. The Herald's
     Dispatch mounts at BODY level, so `main` (the iframe standalone) cannot see
     it. That blind spot let a footer regression survive a whole review round. */
  hubmain:  { kind: 'app', screen: 'title', hub: 'main' },
};

/* ── pngStats + isBlank, copied verbatim from tools/shot.mjs ──────────────── */
function readPngPixels(buf) {
  let p = 8; const idat = []; let ihdr = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ihdr.color === 6 ? 4 : ihdr.color === 2 ? 3 : 1;
  const stride = ihdr.w * ch;
  const outBuf = Buffer.alloc(stride * ihdr.h);
  let q = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[q++];
    const line = raw.subarray(q, q + stride); q += stride;
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
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b; n++;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let modal = 0;
  for (const c of counts.values()) if (c > modal) modal = c;
  return { w: img.w, h: img.h, meanLum: lum / n, colors: counts.size, modalFrac: modal / n };
}
const isBlank = (s) => s.colors < 12 || s.modalFrac > 0.995 || (s.meanLum < 2 && s.colors < 64);

/* ── serve public/ ───────────────────────────────────────────────────────── */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.woff2': 'font/woff2' };
const PORT = 9500 + (process.pid % 60);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* 1920x993 padded to 1080 is the harness viewport — a hard height:1080px
   silently loses its bottom 87px, which is why the sheets must use 100vh. */
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const only = process.argv[2];
const names = only ? [only] : Object.keys(PAGES);
let fails = 0;

console.log('\n\u{1F5BC} MENU RENDERS — meanLum 12-20 and modal 15-35% is healthy;');
console.log('   near-zero luminance or a modal share near 100% means it rendered BLANK.\n');
console.log('   page       size         meanLum  colors  modal    verdict');

for (const name of names) {
  const spec = PAGES[name];
  if (!spec) { console.log('   unknown page ' + name); fails++; continue; }
  const page = await browser.newPage({ viewport: { width: 1920, height: 993 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
    /* fonts.googleapis.com is unreachable in the build container too — the
       handoff calls this out. Aborting keeps the render deterministic instead
       of hanging on a font that will never arrive. */
    return r.abort();
  });
  try {
    if (spec.kind === 'standalone') {
      await page.goto(`http://127.0.0.1:${PORT}${spec.url}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(4500);
    } else {
      await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction('typeof App !== "undefined" && typeof render === "function"', null, { timeout: 150000 }).catch(() => {});
      /* The harness's own bootstrap: offline so the auth gate cannot bounce us,
         then force the screen and hub and render. Forced repeatedly because boot
         re-renders over the first attempt. */
      for (let i = 0; i < 6; i++) {
        await page.evaluate(([S, H]) => {
          try { if (typeof Profile !== 'undefined' && Profile && Profile.cloud) Profile.cloud.offlineMode = true; } catch (e) {}
          /* 🔴 CLEAR THE FIRST-RUN GATES, or every hub renders "WELCOME TO ETHOS
             HEIGHTS" instead. Copied from tools/shot.mjs clearGates().
             This driver's FIRST version skipped it and every page still graded
             "ok" — meanLum 25.8, modal 10.8%, healthy-looking numbers — for
             SEVEN DIFFERENT HUBS THAT WERE ALL THE SAME ONBOARDING SCREEN. The
             pixel test cannot tell a healthy hub from a healthy-looking overlay;
             only asking the DOM what hub it is can. */
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
          } catch (e) {}
          /* The other first-run interceptors. They are function DECLARATIONS, so
             unlike App/Profile they ARE window properties and can be stubbed.
             Stubbing the predicate changes which screen we land on and nothing
             about how it is drawn; faking a profile would invent badges. */
          const STUBS = { shouldRunOnboarding: false, _mustPickStarter: false,
            needsStarterPick: false, _isWipedNewPlayer: false, _maintenanceOn: false,
            hasPickedStarter: true, isAdmin: true };
          Object.keys(STUBS).forEach((k) => {
            try {
              if (typeof window[k] === 'function' && !window[k].__shotStub) {
                const v = STUBS[k]; const f = () => v; f.__shotStub = true; window[k] = f;
              }
            } catch (e) {}
          });
          try { document.querySelectorAll('.onb-screen').forEach((n) => n.remove()); } catch (e) {}
          try { const b = document.getElementById('offline-warn-banner'); if (b) b.remove(); } catch (e) {}
          try { App.screen = S; App.titleHub = H; render(); } catch (e) {}
        }, [spec.screen, spec.hub]);
        await page.waitForTimeout(900);
      }
      await page.waitForTimeout(2500);
    }
    /* 🔴 ASK THE DOM WHAT IT IS, NOT JUST WHAT IT LOOKS LIKE. Identical pixel
       stats across seven "different" hubs is the signature of one screen
       rendered seven times, and it grades healthy. */
    const dom = await page.evaluate(() => {
      const t = (document.querySelector('.keep-title, .hub-title, .spellbook-hub h1, .spellbook-hub h2, h1') || {}).textContent || '';
      return {
        title: String(t).replace(/\s+/g, ' ').trim().slice(0, 44),
        tiles: document.querySelectorAll('.hub-portal').length,
        grid: document.querySelectorAll('.hub-portal-grid').length,
        art: document.querySelectorAll('.hub-portal-photo').length,
        promoted: document.querySelectorAll('.hub-portal.is-promoted').length,
        /* .hub-v2 + .is-sub are what the four sheets key off. Without them the
           stylesheets load and style NOTHING, which looks like the old design.*/
        v2: !!document.querySelector('.spellbook-hub.hub-v2'),
        isSub: !!document.querySelector('.spellbook-hub.is-sub'),
        onboarding: !!document.querySelector('.onb-screen'),
        hub: (typeof App !== 'undefined') ? App.titleHub : null,
        screen: (typeof App !== 'undefined') ? App.screen : null,
      };
    });
    const file = path.join(OUT, name + '.png');
    await page.screenshot({ path: file, fullPage: false });
    const st = pngStats(file);
    st._dom = dom;
    const blank = isBlank(st);
    const onb = st._dom.onboarding || /WELCOME TO ETHOS/i.test(st._dom.title);
    const healthy = !blank && !onb && st.meanLum >= 4 && st.modalFrac < 0.90;
    if (!healthy) fails++;
    console.log('   ' + name.padEnd(11) + (st.w + 'x' + st.h).padEnd(13) +
                st.meanLum.toFixed(1).padStart(6) + '  ' + String(st.colors).padStart(6) + '  ' +
                (st.modalFrac * 100).toFixed(1).padStart(5) + '%   ' +
                (onb ? 'ONBOARDING GATE — not the hub at all' : (blank ? 'BLANK' : (healthy ? 'ok' : 'suspect'))) +
                (errs.length ? '   [' + errs.length + ' err]' : ''));
    console.log('              -> ' + st._dom.tiles + ' tiles (' + st._dom.art + ' with art, ' + st._dom.promoted + ' promoted) · grid=' + st._dom.grid + ' · hub-v2=' + st._dom.v2 + ' is-sub=' + st._dom.isSub + ' · "' + st._dom.title + '"');
    if (errs.length) errs.slice(0, 2).forEach((e) => console.log('        ! ' + e));
  } catch (e) {
    fails++;
    console.log('   ' + name.padEnd(11) + 'THREW  ' + String(e).slice(0, 90));
  }
  await page.close();
}

console.log(fails ? '\n' + fails + ' page(s) did not render healthily' : '\nALL MENU PAGES RENDER');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
