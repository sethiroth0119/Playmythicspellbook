/* ══════════════════════════════════════════════════════════════════════════
   🕯 AUDIT-THEME — which screens the Ruin skin has NOT reached

   DESIGN-BAR.md asks for failures that are NUMBERS, not taste: "where a rule
   is a measurement it is written as one, so a critic can fail a screen on a
   number rather than on taste." This is that critic.

   THE MEASUREMENT. The old theme was violet — the bar names it outright, "
   --border #3a2f5c ← PURPLE. This is the tell." Violet has BLUE above RED.
   The Ruin palette is warm: every ground, frame and raised surface has RED at
   or above BLUE. So for each rendered screen this walks every visible element
   and flags any painted surface whose blue channel exceeds its red channel by
   a real margin. That is mechanical, it needs no screenshot, and it cannot be
   argued with.

   ⚠ WHAT IT DELIBERATELY DOES NOT FLAG. Colour used for MEANING is allowed by
     the bar — a blue "info" pill, a cyan link, a rarity tint on a card. So the
     scan ignores text colour and small elements, and only judges STRUCTURAL
     surfaces: things with real area, a background, or a border. Card art and
     images are skipped entirely.

   ⚠ IT RENDERS. Per CLAUDE.md, grep says which classes exist; only rendering
     says what is on the glass. Every screen is really painted through the
     game's own render() before it is measured.

   Run:  node .gauntlet/audit-theme.mjs            (all screens)
         node .gauntlet/audit-theme.mjs camp deck  (just these)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9100 + Math.floor(Math.random() * 400);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
pg.on('pageerror', () => {});
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g') || u.includes('unpkg')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof render === "function" && typeof App === "object"', null, { timeout: 180000 });
await pg.waitForTimeout(3000);

/* The scanner, installed once and reused per screen. */
await pg.evaluate(() => {
  window.__themeScan = function () {
    const parse = (c) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || '');
      if (!m) return null;
      const a = m[4] == null ? 1 : parseFloat(m[4]);
      if (!(a > 0.06)) return null;                       // effectively invisible
      return { r: +m[1], g: +m[2], b: +m[3], a };
    };
    /* Violet/cool cast.
       ⚠ `b > r + 8` ALONE IS WRONG and the first run proved it: rgb(106,216,128)
         is the Book of Knowledge's GREEN element chip, and it tripped the test
         because blue beats red — while green dominates both. The bar explicitly
         permits colour used for MEANING, so a green chip failing a violet test
         is a false accusation, and 88 of them poisoned the ranking.
       So blue must be the DOMINANT channel, not merely above red. That admits
       violet (122,95,174) and cool grey (85,88,95) and rejects every green,
       amber, and teal-leaning-green in the game. */
    const cool = (p) => p && (p.b - p.r) > 8 && p.b >= p.g;
    /* 🎨 COLOUR USED FOR MEANING IS NOT DRIFT.
       DESIGN-BAR.md allows colour that carries information, and a machine
       cannot tell a violet FRAME from a violet FACT. These were each read and
       judged by hand; retoning them would score better here and make the game
       worse, so they are excluded from the count rather than left to be
       "fixed" by the next person who runs this and sees a red number.
         · element / card-type chips  — the water chip is blue because it is water
         · Aza (sovereign) purple     — the currency's brand, used consistently
         · crash-exchange state chips — cyan/amber/red are the three states
         · pledge tier identity       — per-tier colours
       Anything added here needs a REASON written next to it. */
    const MEANING = [
      '.bok-elem-chip', '.bok-card-icon', '.type-badge', '.elem-chip',
      '.sov-pkg', '.sov-info-card', '.profile-currency-sov',
      '.csx-chip', '.pledge-tier', '.pledge-cta', '.rarity', '.affinity',
      // Aza's purple on the controls that BUY AND SELL Aza. Same reason as
      // .sov-pkg: it is the currency's brand, not a frame that drifted.
      '.cx-aza-block', '#cx-aza-buy', '#cx-aza-sell',
      // Cyan that MARKS something: 'this is your progress' and 'read this
      // first'. Their grounds were warmed in part 5; the accent stays, because
      // in gold neither would read as anything but more chrome.
      '.profile-level-block', '.bok-intro',
      // 🖼 UNLOCKABLE CARD FRAMES. The three same-size cards in the frame
      // picker carry three DIFFERENT colours because that is the product —
      // 'Arcane Sigil: violet rune-trim' is literally what the CSS calls it.
      // Retoning them to gold would make every frame a player can earn look
      // identical and delete the feature. Verified in source, not assumed.
      '.frame-pick', '.frame-card', '[class*=\"frame-\"]',
    ];
    const out = { surfaces: 0, offenders: [], byKey: {}, excused: 0 };
    const seen = new Set();
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('#lg-overlay, .no-theme-audit')) continue;
      const tag = el.tagName;
      if (tag === 'IMG' || tag === 'CANVAS' || tag === 'SVG' || tag === 'PATH' || tag === 'VIDEO') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 22) continue;         // not a structural surface
      if (r.bottom < 0 || r.top > innerHeight * 3) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) continue;
      const bg = parse(cs.backgroundColor);
      const bd = (cs.borderTopWidth !== '0px') ? parse(cs.borderTopColor) : null;
      /* 🔴 THE BLIND SPOT THIS AUDIT SHIPPED WITH.
         It read backgroundColor and borderTopColor and nothing else. A panel
         painted with `linear-gradient(135deg, rgba(45,30,70,.85), …)` has a
         TRANSPARENT backgroundColor — the violet lives entirely in
         backgroundImage — so it was skipped outright and scored as clean.
         Round 2 of the skin pass found surfaces sitting at 100% on BOTH audits
         while still being visibly violet, which is exactly the "it is still the
         same" report this tool was built to answer. An audit that cannot see
         the paint is worse than no audit, because it certifies the thing it
         missed. Every colour stop in the gradient is now tested too. */
      const stops = [];
      const bi = cs.backgroundImage || '';
      if (bi && bi !== 'none') {
        for (const m of bi.matchAll(/rgba?\([^)]*\)/g)) {
          const p = parse(m[0]);
          if (p) stops.push({ p, raw: m[0] });
        }
      }
      if (!bg && !bd && !stops.length) continue;
      out.surfaces++;
      const bad = [];
      if (cool(bg)) bad.push('bg ' + cs.backgroundColor);
      if (cool(bd)) bad.push('border ' + cs.borderTopColor);
      for (const st of stops) {
        if (cool(st.p)) { bad.push('gradient ' + st.raw); break; }
      }
      if (!bad.length) continue;
      if (MEANING.some((sel) => { try { return el.matches(sel) || el.closest(sel); } catch (e) { return false; } })) {
        out.excused++; continue;
      }
      /* 🖼 THE COSMETIC CARD FRAMES, EXCUSED BY VALUE RATHER THAN BY SELECTOR.
         index.html defines seven unlockable frames — foil, holo, premium, crit,
         diamond, arcane, eternal — and the picker renders them as bare <div>s
         with the frame colour INLINE, so there is no class to match on. Three
         of them are blue-dominant, including the one the CSS itself calls
         "Arcane Sigil: violet rune-trim".
         Retoning these would make every frame a player can earn look the same
         and delete the feature, so the colours themselves are the allowlist.
         Verified against `body.frame-* .hand-card::before` in source. */
      const FRAME_HUES = ['155, 139, 255', '122, 95, 174', '159, 180, 198', '220, 235, 255'];
      if (FRAME_HUES.some((h) => bad.join('|').includes(h))) { out.excused++; continue; }
      const key = (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : (el.id ? '#' + el.id : tag.toLowerCase())).slice(0, 60);
      const sig = key + '|' + bad.join('|');
      out.byKey[key] = (out.byKey[key] || 0) + 1;
      if (seen.has(sig)) continue;
      seen.add(sig);
      if (out.offenders.length < 8) out.offenders.push({ key, why: bad.join(' · '), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  };
});

/* Every screen the game declares, in the order it declares them. */
const SCREENS = await pg.evaluate(() => {
  const set = new Set();
  // Pulled from the shipped source so the list cannot drift from reality.
  const re = /App\.screen === '([a-zA-Z-]+)'/g;
  const src = document.documentElement.innerHTML;
  let m; while ((m = re.exec(src))) set.add(m[1]);
  return Array.from(set);
});
const list = (ONLY.length ? ONLY : SCREENS).filter(Boolean);

const rows = [];
for (const scr of list) {
  const res = await pg.evaluate(async (s) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    try {
      App.screen = s;
      if (typeof render === 'function') render();
      await sleep(90);
      const painted = document.body.innerText.trim().length;
      const scan = window.__themeScan();
      return { ok: true, painted, ...scan };
    } catch (e) { return { ok: false, err: String(e && e.message || e).slice(0, 90) }; }
  }, scr);
  rows.push({ screen: scr, ...res });
}

await b.close(); srv.close();

const rendered = rows.filter(r => r.ok && r.surfaces > 4);
const skipped  = rows.filter(r => !r.ok || r.surfaces <= 4);
const failing  = rendered.filter(r => r.offenders.length > 0)
                         .sort((a, b2) => b2.offenders.length - a.offenders.length);

console.log('\n\u{1F56F} THEME AUDIT · where the Ruin skin has not reached\n');
console.log('  screens declared : ' + SCREENS.length);
console.log('  measured         : ' + rendered.length + '   (a screen that paints nothing without game state is skipped, not passed)');
console.log('  skipped          : ' + skipped.length);
console.log('  CLEAN            : ' + (rendered.length - failing.length));
console.log('  with cool-cast surfaces : ' + failing.length);
console.log('  excused as meaning-colour : ' + rendered.reduce((a, r) => a + (r.excused || 0), 0) + '\n');

if (!failing.length) {
  console.log('  No structural surface on any measured screen has blue above red.');
} else {
  for (const f of failing.slice(0, 24)) {
    console.log('  \u{1F534} ' + f.screen.padEnd(22) + f.offenders.length + ' distinct offender(s) of ' + f.surfaces + ' surfaces');
    for (const o of f.offenders.slice(0, 4)) {
      console.log('        ' + o.key.padEnd(34) + o.why);
    }
  }
}

/* The most valuable output: which CLASSES to fix, ranked. One rule can clear
   many screens, and the ranking says which rule is worth writing first. */
const tally = {};
for (const f of failing) for (const k in f.byKey) tally[k] = (tally[k] || 0) + f.byKey[k];
/* Bare `span` / `div` are not actionable — there is no rule you can write
   against them. Rank only NAMED hooks, which is what a fix can target. */
const ranked = Object.entries(tally)
  .filter(([k]) => k.startsWith('.') || k.startsWith('#'))
  .sort((a, b2) => b2[1] - a[1]).slice(0, 24);
if (ranked.length) {
  console.log('\n  ── the classes to fix, by how many instances they account for');
  for (const [k, n] of ranked) console.log('     ' + String(n).padStart(5) + '  ' + k);
}

fs.writeFileSync('tmp/theme-audit.json', JSON.stringify({ rows, ranked }, null, 2));
console.log('\n  full report → tmp/theme-audit.json');
