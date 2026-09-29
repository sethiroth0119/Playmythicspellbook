import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';
import path from 'node:path';
const OPEN = ['fx-identity','fx-kind','fx-effects','fx-onplay'];
const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO, viewport: { width: 360, height: 844 } });
const seed = await page.evaluate(() => { const c = JSON.parse(JSON.stringify(UNIT_CARDS[0])); c.id='c3m'; c.type='unit'; Forge.customCards=[c]; return c.id; });
for (const w of [360, 390]) {
  await page.setViewportSize({ width: w, height: 844 });
  await openCardEditor(page, seed);
  const info = await page.evaluate((open) => {
    document.querySelectorAll('.card-editor.fx-two details').forEach(d => { d.open = open.indexOf(d.id) >= 0; });
    const sub = document.querySelector('.fx-two .fx-sub > .editor-grid');
    if (sub) sub.scrollIntoView({ block: 'center' });
    const ed = document.querySelector('.card-editor.fx-two');
    const er = ed.getBoundingClientRect();
    const out = [];
    document.querySelectorAll('.fx-two .fx-sub > .editor-grid > *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > er.right + 2 && out.length < 6)
        out.push({ t: (el.textContent||'').trim().slice(0,30), right: Math.round(r.right), edRight: Math.round(er.right), w: Math.round(r.width) });
    });
    return { out, subTpl: sub ? getComputedStyle(sub).gridTemplateColumns : null,
             subW: sub ? Math.round(sub.getBoundingClientRect().width) : null,
             subScrollW: sub ? sub.scrollWidth : null, subClientW: sub ? sub.clientWidth : null };
  }, OPEN);
  await page.waitForTimeout(200);
  const f = path.join(process.env.TEMP || '.', 'c3-onplay-' + w + '.png');
  await page.screenshot({ path: f });
  console.log(w, JSON.stringify(info), f);
}
await close();
