/* every <details> open — beyond the bar's fixed open-set, to see whether the
   2-line result survives a user who hits EXPAND ALL. */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';
const M = () => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const vis = e => e.checkVisibility(CV);
  const ed = document.querySelector('.card-editor.fx-two');
  ed.querySelectorAll('details').forEach(d => { d.open = true; });
  const o = { editorW: +parseFloat(getComputedStyle(ed).width).toFixed(1) };
  const p = ed.querySelector('.fx-props'); o.propsH = p.scrollHeight;
  o.minCol = Infinity; ed.querySelectorAll('.editor-grid').forEach(g => {
    if (!vis(g)) return;
    const c = getComputedStyle(g).gridTemplateColumns.split(/\s+/).map(parseFloat).filter(isFinite);
    if (c.length) o.minCol = Math.min(o.minCol, Math.min.apply(null, c));
  });
  o.minCol = isFinite(o.minCol) ? +o.minCol.toFixed(1) : null;
  o.labs = 0; o.over2 = 0; o.trunc = 0; o.names = []; o.minCtlH = Infinity; o.under28 = 0;
  ed.querySelectorAll('label').forEach(el => {
    if (!vis(el)) return; o.labs++;
    const st = getComputedStyle(el), f = parseFloat(st.fontSize);
    if (el.scrollWidth > el.clientWidth) o.trunc++;
    const tops = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (!/\S/.test(n.nodeValue||'')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n); const rc = rg.getClientRects();
      for (let i=0;i<rc.length;i++) if (rc[i].width>0) tops.push(rc[i].top); }
    tops.sort((a,b)=>a-b); const tol = Math.max(6, f*0.6); let rows=0,last=-1e9;
    for (const t of tops) if (t-last>tol) { rows++; last=t; }
    if (rows > 2) { o.over2++; if (o.names.length<8) o.names.push(rows + 'ln @' + Math.round(el.getBoundingClientRect().width) + 'px: ' + (el.textContent||'').trim().replace(/\s+/g,' ').slice(0,60)); }
  });
  ed.querySelectorAll('input,select').forEach(el => { if (el.type==='hidden'||el.type==='file'||!vis(el)) return;
    const h = parseFloat(getComputedStyle(el).height); if (h < o.minCtlH) o.minCtlH = h; if (h < 28) o.under28++; });
  o.minCtlH = isFinite(o.minCtlH) ? +o.minCtlH.toFixed(2) : null;
  return o;
};
const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO, viewport: { width: 1600, height: 1000 } });
try {
  const id = await page.evaluate(() => { const c = JSON.parse(JSON.stringify(UNIT_CARDS[0])); c.id='c2ao'; c.type='unit'; Forge.customCards=[c]; return c.id; });
  for (const w of [1600, 1080, 720]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await openCardEditor(page, id);
    await page.evaluate(M); await page.waitForTimeout(200);
    const m = await page.evaluate(M);
    console.log(w + ' ' + JSON.stringify(m));
  }
} finally { await close(); }
