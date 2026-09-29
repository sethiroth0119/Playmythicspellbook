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
  go('aoeStatus');
  const c = document.getElementById('ed-onplay-chance'); c.value = '25';
  c.dispatchEvent(new Event('input',{bubbles:true})); c.dispatchEvent(new Event('change',{bubbles:true}));
  go('intimidate');
  const cap = {}; captureEditorIntoCard(cap);
  return { chanceVisible: c.checkVisibility(CV), chanceValue: c.value, captured: cap.onPlay && cap.onPlay.chance };
});
console.log(ROOT, JSON.stringify(r));
await ctx.close();
