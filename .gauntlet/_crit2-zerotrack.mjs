/* the 0px grid track that appears with EVERY details open: which grid, and
   does anything sit in it? */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';
const M = () => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const vis = e => e.checkVisibility(CV);
  const ed = document.querySelector('.card-editor.fx-two');
  ed.querySelectorAll('details').forEach(d => { d.open = true; });
  const out = [];
  ed.querySelectorAll('.editor-grid').forEach(g => {
    if (!vis(g)) return;
    const tpl = getComputedStyle(g).gridTemplateColumns;
    const c = tpl.split(/\s+/).map(parseFloat).filter(isFinite);
    if (!c.length || Math.min.apply(null, c) >= 260) return;
    const kids = Array.prototype.map.call(g.children, k => {
      const r = k.getBoundingClientRect();
      return { cls: (k.className||'').slice(0,28), w: Math.round(r.width), h: Math.round(r.height), col: getComputedStyle(k).gridColumn };
    });
    out.push({ owner: (g.closest('details')&&g.closest('details').id)||'?', tpl: tpl.slice(0,120),
      gw: Math.round(g.getBoundingClientRect().width), kidsN: kids.length,
      minKidW: kids.length ? Math.min.apply(null, kids.map(k=>k.w)) : null,
      narrowKids: kids.filter(k=>k.w<260).slice(0,6) });
  });
  /* narrowest VISIBLE field anywhere, all-open */
  let minF = Infinity, where = null;
  ed.querySelectorAll('.editor-field').forEach(f => { if (!vis(f)) return;
    const w = f.getBoundingClientRect().width;
    if (w > 0 && w < minF) { minF = w; where = (f.textContent||'').trim().slice(0,40); } });
  return { grids: out, minFieldW: +minF.toFixed(1), minFieldWhere: where };
};
const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO, viewport: { width: 1600, height: 1000 } });
try {
  const id = await page.evaluate(() => { const c = JSON.parse(JSON.stringify(UNIT_CARDS[0])); c.id='c2z'; c.type='unit'; Forge.customCards=[c]; return c.id; });
  await openCardEditor(page, id);
  await page.evaluate(M); await page.waitForTimeout(200);
  console.log(JSON.stringify(await page.evaluate(M), null, 1));
} finally { await close(); }
