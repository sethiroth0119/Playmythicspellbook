/* ══════════════════════════════════════════════════════════════════════════
   🔎 PROBE-FORM-TARGETS — turn the form audit's percentages into a work list

   audit-form.mjs says WHAT FRACTION of a screen's panels miss the bar. It does
   not say WHICH ones, and on a 14.5 MB single file that is the whole difference
   between a targeted rule and a guess. This walks the same elements the audit
   walks and writes down, per screen:

       · every failing panel's class list, what it fails, and whether the
         offending value came from an INLINE style (which decides whether the
         fix needs !important)
       · every failing heading's class list and its resolved font family

   Output → tmp/form-targets.json  (and a ranked summary on stdout)

   ⚠ Same caveat as the audit: screens are rendered in sequence and state
     carries between them, so a screen that painted nothing is skipped, not
     passed. The `panels` count per screen is printed so a zero is visible.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9600 + Math.floor(Math.random() * 300);
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
await pg.waitForFunction('typeof render === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(3000);

await pg.evaluate(() => {
  window.__targetScan = function () {
    const panels = [], heads = [];
    const sig = (el) => {
      const c = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
      return String(c).trim().split(/\s+/).filter(Boolean).join('.') || ('<' + el.tagName.toLowerCase() + '>');
    };
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 60) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const hasBd = cs.borderTopWidth !== '0px';
      if (!hasBg || !hasBd) continue;
      const rad = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
      const tex = /url\(|gradient/.test(cs.backgroundImage || '');
      const ins = /inset/.test(cs.boxShadow || '');
      if (rad <= 4 && tex && ins) continue;                    // already at the bar
      const st = el.getAttribute('style') || '';
      panels.push({
        sel: sig(el), rad, tex, ins,
        inlineRadius: /border-radius/i.test(st),
        inlineBg:     /background(-image|-color)?\s*:/i.test(st),
        inlineShadow: /box-shadow/i.test(st),
      });
    }
    for (const el of document.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="-h"],[class*="head"]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 12) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || !el.textContent.trim()) continue;
      const cinzel = /cinzel/i.test(cs.fontFamily || '');
      const ls = parseFloat(cs.letterSpacing);
      const caps = /uppercase/.test(cs.textTransform) || /small-caps/.test(cs.fontVariant + ' ' + cs.fontVariantCaps);
      const tracked = caps && ls >= 0.8;
      if (cinzel && tracked) continue;
      const st = el.getAttribute('style') || '';
      heads.push({
        sel: sig(el), tag: el.tagName.toLowerCase(), cinzel, tracked,
        fam: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
        inlineFont: /font-family/i.test(st),
        inlineTrack: /letter-spacing/i.test(st),
      });
    }
    return { panels, heads };
  };
});

const SCREENS = ONLY.length ? ONLY : await pg.evaluate(() => {
  const set = new Set();
  const re = /App\.screen === '([a-zA-Z-]+)'/g;
  const src = document.documentElement.innerHTML;
  let m; while ((m = re.exec(src))) set.add(m[1]);
  return Array.from(set);
});

const out = {};
for (const scr of SCREENS) {
  const res = await pg.evaluate(async (s) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    try { App.screen = s; render(); await sleep(90); return { ok: true, ...window.__targetScan() }; }
    catch (e) { return { ok: false }; }
  }, scr);
  if (res.ok && (res.panels.length || res.heads.length)) out[scr] = { panels: res.panels, heads: res.heads };
}
await b.close(); srv.close();

/* Roll the per-element rows up into per-selector counts — a selector that
   appears 14 times is one rule that fixes 14 panels. */
const roll = (key, pick) => {
  const t = {};
  for (const scr in out) for (const row of out[scr][key]) {
    const k = row.sel;
    t[k] ||= { sel: k, n: 0, screens: new Set(), ...pick.init };
    t[k].n++; t[k].screens.add(scr); pick.acc(t[k], row);
  }
  return Object.values(t).map(x => ({ ...x, screens: Array.from(x.screens) })).sort((a, b2) => b2.n - a.n);
};
const panelSel = roll('panels', {
  init: { badRad: 0, noTex: 0, noIns: 0, inline: 0, radii: {} },
  acc: (t, r) => { if (r.rad > 4) { t.badRad++; t.radii[r.rad] = (t.radii[r.rad] || 0) + 1; }
                   if (!r.tex) t.noTex++; if (!r.ins) t.noIns++;
                   if (r.inlineRadius || r.inlineBg || r.inlineShadow) t.inline++; },
});
const headSel = roll('heads', {
  init: { noCinzel: 0, noTrack: 0, inline: 0, fams: {} },
  acc: (t, r) => { if (!r.cinzel) { t.noCinzel++; t.fams[r.fam] = (t.fams[r.fam] || 0) + 1; }
                   if (!r.tracked) t.noTrack++; if (r.inlineFont || r.inlineTrack) t.inline++; },
});

fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync('tmp/form-targets.json', JSON.stringify({ byScreen: out, panelSel, headSel }, null, 2));

console.log('\n🔎 FORM TARGETS · the selectors behind the percentages\n');
console.log('  ── PANELS below the bar, by selector (n = failing instances)');
console.log('     n  radius!  no-tex  no-inset  inline  selector');
for (const s of panelSel.slice(0, 45)) {
  console.log('  ' + String(s.n).padStart(4) + String(s.badRad).padStart(8) + String(s.noTex).padStart(8)
    + String(s.noIns).padStart(10) + String(s.inline).padStart(8) + '  .' + s.sel
    + '   [' + s.screens.slice(0, 4).join(' ') + (s.screens.length > 4 ? ' +' + (s.screens.length - 4) : '') + ']');
}
console.log('\n  ── HEADINGS below the bar, by selector');
console.log('     n  no-cinzel  no-track  inline  selector');
for (const s of headSel.slice(0, 45)) {
  console.log('  ' + String(s.n).padStart(4) + String(s.noCinzel).padStart(11) + String(s.noTrack).padStart(10)
    + String(s.inline).padStart(8) + '  .' + s.sel
    + '   [' + s.screens.slice(0, 4).join(' ') + (s.screens.length > 4 ? ' +' + (s.screens.length - 4) : '') + ']');
}
console.log('\n  full report → tmp/form-targets.json');
