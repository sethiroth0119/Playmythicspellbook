/* ══════════════════════════════════════════════════════════════════════════
   BOARD EFFECT VFX PROBE (src/effectfx). Owner: "Update Grave Reach in Effect
   VFX with this Zombie arm, also add the deck shuffle VFX … make them smaller
   to fit the game board".
     1. the Effect VFX picker offers Grave Reach and Deck Shuffle;
     2. the REAL _playEffectVfx routes both to the board canvas — NOT to the
        old full-screen cinematic iframe — and the canvas removes itself;
     3. SIZE: the drawn pixels of each, at its fullest frame, fit inside a box
        a few tiles across around the tile it fired on (tile = 64 px here);
     4. each has a visible middle and empty ends (it plays, then clears).
   Frames are drawn by hand (MythicEffectFx.frame) — the Browser pane throttles
   RAF. EFX_STRIP=<png> writes a strip of frames over a mock board.
   Usage: node .gauntlet/effectfx-probe.mjs <candidate.html>  (needs :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: effectfx-probe.mjs <candidate.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  return route.continue();
});
let R;
try {
  await page.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.MythicEffectFx && typeof _playEffectVfx === 'function', null, { timeout: 30000 });
  R = await page.evaluate(async () => {
    const out = {}, err = {};
    const T = async (k, f) => { try { out[k] = await f(); } catch (e) { err[k] = String(e && e.stack || e).slice(0, 300); out[k] = false; } };
    const M = window.MythicEffectFx, TILE = 64;
    await T('picker_offers_both', () => { const h = _effectVfxOptionsHtml('deckShuffle'); return /value="graveReach"/.test(h) && /value="deckShuffle"\s+selected/.test(h); });
    /* 2. routing through the real player */
    await T('routes_to_board_not_cinematic', async () => {
      const before = document.querySelectorAll('iframe').length;
      _playEffectVfx('graveReach', { x: 640, y: 400, w: TILE });
      _playEffectVfx('deckShuffle', { x: 400, y: 400, w: TILE });
      const n = document.querySelectorAll('canvas.effectfx-canvas').length, ifr = document.querySelectorAll('iframe').length - before;
      await new Promise(r => setTimeout(r, 4200));
      const left = document.querySelectorAll('canvas.effectfx-canvas').length;
      out._route = { canvases: n, newIframes: ifr, leftAfter: left };
      return n === 2 && ifr === 0 && left === 0; });
    /* 3 + 4. size and life, drawn by hand */
    const measure = async (id, t) => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
      await M.frame(id, c, { x: 640, y: 400, w: TILE }, t);
      const d = c.getContext('2d').getImageData(0, 0, 1280, 800).data;
      let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < 800; y += 2) for (let x = 0; x < 1280; x += 2) if (d[(y * 1280 + x) * 4 + 3] > 24) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      return { n, w: n ? (x1 - x0) / TILE : 0, h: n ? (y1 - y0) / TILE : 0 };
    };
    await T('grave_reach_fits_board', async () => { const m = await measure('graveReach', 1.2); out._arm = m; return m.n > 500 && m.w <= 4 && m.h <= 3.2 && m.h >= 1.5; });
    await T('shuffle_fits_board', async () => { const m = await measure('deckShuffle', 1.6); out._shuffle = m; return m.n > 500 && m.w <= 4.5 && m.h <= 3.5; });
    await T('grave_reach_plays_and_clears', async () => (await measure('graveReach', 0.02)).n < 50 && (await measure('graveReach', 2.69)).n < 400);
    await T('shuffle_plays', async () => (await measure('deckShuffle', 0.02)).n > 100);   // the deck is there from the start, as in the pack
    /* strip: five frames of each over a mock board */
    const ts = { graveReach: [0.25, 0.5, 1.0, 1.8, 2.3], deckShuffle: [0.2, 0.7, 1.4, 2.1, 2.9] };
    const cw = 320, ch = 260, sheet = document.createElement('canvas'); sheet.width = cw * 5; sheet.height = ch * 2; const g = sheet.getContext('2d');
    let row = 0;
    for (const id of ['graveReach', 'deckShuffle']) {
      for (let i = 0; i < 5; i++) {
        const ox = i * cw, oy = row * ch;
        for (let ty = 0; ty < ch; ty += TILE) for (let tx = 0; tx < cw; tx += TILE) { g.fillStyle = ((tx + ty) / TILE) % 2 ? '#2f4a33' : '#36553a'; g.fillRect(ox + tx, oy + ty, TILE, TILE); }
        g.strokeStyle = '#ffd76a'; g.lineWidth = 2; g.strokeRect(ox + cw / 2 - TILE / 2, oy + 160 - TILE / 2, TILE, TILE);
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        await M.frame(id, c, { x: cw / 2, y: 160, w: TILE }, ts[id][i]); g.drawImage(c, ox, oy);
        g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(id + '  t=' + ts[id][i] + 's', ox + 6, oy + 14);
        g.strokeStyle = '#0b0f14'; g.lineWidth = 2; g.strokeRect(ox, oy, cw, ch);
      }
      row++;
    }
    out._strip = sheet.toDataURL('image/png');
    return { out, err };
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const strip = R.out._strip; delete R.out._strip;
if (strip && process.env.EFX_STRIP) fs.writeFileSync(process.env.EFX_STRIP, Buffer.from(strip.split(',')[1], 'base64'));
const fails = Object.keys(R.out).filter(k => !k.startsWith('_') && R.out[k] !== true);
console.log(JSON.stringify({ ok: !fails.length, fails, errors: R.err, detail: Object.fromEntries(Object.entries(R.out).filter(([k]) => k.startsWith('_'))), pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(fails.length ? 1 : 0);
