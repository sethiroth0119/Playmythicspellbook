import { bootPage, openCardEditor } from './_forge-harness.mjs';
const ROOT = process.argv[2];
const ctx = await bootPage({ cwd: ROOT, viewport: { width: 1400, height: 1200 } });
const { page } = ctx;
await openCardEditor(page, 'NEW', {});
await page.evaluate(() => document.querySelectorAll('.card-editor details').forEach(d => d.open = true));
const r = await page.evaluate(() => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const s = document.getElementById('ed-onplay-type');
  const go = v => { s.value = v; s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true})); };
  const rd = () => { const c = document.getElementById('ed-onplay-chance');
    const w = c.closest('.editor-field');
    return { off: c.classList.contains('fx-off'), wrapOff: w.classList.contains('fx-off'),
      cv: c.checkVisibility(CV), cvBare: c.checkVisibility(), offsetParent: !!c.offsetParent,
      h: Math.round(w.getBoundingClientRect().height), val: c.value }; };
  go('aoeStatus'); const a = rd();
  const c = document.getElementById('ed-onplay-chance'); c.value = '25';
  c.dispatchEvent(new Event('input',{bubbles:true})); c.dispatchEvent(new Event('change',{bubbles:true}));
  go('intimidate'); const b = rd();
  const cap = {}; captureEditorIntoCard(cap);
  return { aoeStatus: a, intimidate: b, captured: cap.onPlay && cap.onPlay.chance };
});
console.log(ROOT.padEnd(18), JSON.stringify(r));
await ctx.close();
