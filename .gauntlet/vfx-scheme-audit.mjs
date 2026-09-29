/* ══════════════════════════════════════════════════════════════════════════
   VFX COLOR-SCHEME AUDIT — does any effect page paint a sheet over the board?

   Mounts every public/assets/vfx/*.html the way index.html mounts its
   cinematics — a full-screen transparent iframe with color-scheme:dark, over a
   page that declares <meta name="color-scheme" content="dark"> — onto a flat
   green board, and samples five pixels at the screen edges ~1.2s in.
     WHITE  = Chromium's mismatch backdrop (the owner's white-background report)
     GREEN  = the board shows through, as it should
     other  = the page paints its own opaque backdrop (by design or not)
   Usage: node .gauntlet/vfx-scheme-audit.mjs   (public server on :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const DIR = new URL('../public/assets/vfx/', import.meta.url);
const pages = fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort();
const W = 1280, H = 720, GREEN = [30, 110, 60];
const FAR = [[12, 12], [W - 12, 12], [12, H - 12], [W - 12, H - 12], [W / 2, 12]];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent('<!doctype html><html><head><meta name="color-scheme" content="dark">'
  + '<style>html,body{margin:0;height:100%;background:rgb(' + GREEN.join(',') + ')}</style></head><body></body></html>');

const sample = async () => {
  const buf = await page.screenshot();
  return page.evaluate(async ({ b64, pts }) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode();
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    return pts.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)));
  }, { b64: buf.toString('base64'), pts: FAR });
};
const kind = (p) => (p[0] > 245 && p[1] > 245 && p[2] > 245) ? 'WHITE'
  : (Math.abs(p[0] - GREEN[0]) < 8 && Math.abs(p[1] - GREEN[1]) < 8 && Math.abs(p[2] - GREEN[2]) < 8) ? 'green' : 'other';

/* The two anchored pages are PREVIEWS unless given their host query — the game
   never loads them bare, so audit them the way it does. */
const EMBED_QUERY = { 'vfx-elements.html': '?fx=1&x=0.5&y=0.5', 'vfx-attacks.html': '?atk=4&x=0.5&y=0.5' };
const rows = [];
for (const f of pages) {
  await page.evaluate((src) => {
    document.body.innerHTML = '';
    const w = document.createElement('div');
    w.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:transparent';
    const ifr = document.createElement('iframe');
    ifr.src = src;
    ifr.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;color-scheme:dark';
    w.appendChild(ifr); document.body.appendChild(w);
  }, 'http://localhost:8787/assets/vfx/' + f + (EMBED_QUERY[f] || ''));
  await page.waitForTimeout(1200);
  const px = await sample();
  const k = px.map(kind);
  const verdict = k.every(x => x === 'green') ? 'ok' : k.includes('WHITE') ? 'WHITE SHEET' : 'opaque/other';
  rows.push({ f, verdict, k: k.join(','), first: px[0].join(',') });
}
await browser.close();
for (const r of rows) console.log((r.f + ' '.repeat(34)).slice(0, 34) + (r.verdict + ' '.repeat(14)).slice(0, 14) + r.k + '   [' + r.first + ']');
const white = rows.filter(r => r.verdict === 'WHITE SHEET').length;
console.log('\n' + white + ' of ' + rows.length + ' pages paint a WHITE SHEET');
