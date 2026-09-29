/* 🔎 _CRIT2-720PROBE — the four labels at 720 where my vertical-SPAN line
   measure disagrees with the distinct-tops one. Dumps geometry AND crops a
   picture of each, because the whole point of the 2-line clause is what a
   person sees. */
import path from 'node:path';
import fs from 'node:fs';
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];
const OUT = process.env.C2FW_SHOTS || '.';

const FIND = ({ open }) => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const vis = el => el.checkVisibility(CV);
  const ed = document.querySelector('.card-editor.fx-two');
  ed.querySelectorAll('details').forEach(d => { d.open = open.indexOf(d.id) >= 0; });
  const out = [];
  ed.querySelectorAll('label').forEach((el, i) => {
    if (!vis(el)) return;
    const st = getComputedStyle(el);
    const f = parseFloat(st.fontSize);
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const rects = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!/\S/.test(n.nodeValue || '')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rc = rg.getClientRects();
      for (let k = 0; k < rc.length; k++) if (rc[k].width > 0)
        rects.push({ t: +rc[k].top.toFixed(1), b: +rc[k].bottom.toFixed(1), w: Math.round(rc[k].width), txt: (n.nodeValue || '').trim().slice(0, 30) });
    }
    if (!rects.length) return;
    const span = Math.max.apply(null, rects.map(r => r.b)) - Math.min.apply(null, rects.map(r => r.t));
    const tops = rects.map(r => r.t).sort((a, b) => a - b);
    const tol = Math.max(6, f * 0.6);
    let rows = 0, last = -1e9; for (const t of tops) if (t - last > tol) { rows++; last = t; }
    if (span / lh <= 2.4) return;              // only the disputed ones
    const r = el.getBoundingClientRect();
    out.push({ i, txt: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      fs: f, lh, span: +span.toFixed(1), spanOverLh: +(span / lh).toFixed(2), rows,
      rect: { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
      display: st.display, kids: el.children.length,
      html: el.innerHTML.replace(/\s+/g, ' ').slice(0, 220),
      rects: rects.slice(0, 8) });
  });
  return out;
};

const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO, viewport: { width: 720, height: 1000 } });
try {
  const seed = await page.evaluate(() => {
    const c = JSON.parse(JSON.stringify(UNIT_CARDS[0])); c.id = 'c2_probe'; c.type = 'unit';
    Forge.customCards = [c]; return c.id;
  });
  await openCardEditor(page, seed);
  await page.evaluate(FIND, { open: OPEN });
  await page.waitForTimeout(200);
  const hits = await page.evaluate(FIND, { open: OPEN });
  console.log(JSON.stringify(hits, null, 1));
  fs.mkdirSync(OUT, { recursive: true });
  for (let k = 0; k < hits.length && k < 6; k++) {
    const idx = hits[k].i;
    const box = await page.evaluate((i) => {
      const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
      const ed = document.querySelector('.card-editor.fx-two');
      const labs = Array.prototype.filter.call(ed.querySelectorAll('label'), e => e.checkVisibility(CV));
      const el = ed.querySelectorAll('label')[i] || labs[0];
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: Math.min(700, r.width + 24), height: Math.min(200, r.height + 24) };
    }, idx);
    await page.waitForTimeout(120);
    const f = path.join(OUT, 'lab720-' + k + '.png');
    await page.screenshot({ path: f, clip: box });
    console.log('shot ' + k + ': ' + f + '  ' + JSON.stringify(box));
  }
} finally { await close(); }
