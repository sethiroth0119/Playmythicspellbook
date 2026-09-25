import { bootPage, openCardEditor } from './_forge-harness.mjs';
const ctx = await bootPage({ cwd: 'D:/game-deploy', viewport: { width: 1400, height: 1200 } });
const { page } = ctx;
await openCardEditor(page, 'NEW', {});
await page.evaluate(() => document.querySelectorAll('.card-editor details').forEach(d => d.open = true));
const rd = async () => page.evaluate(() => {
  const CV = { opacityProperty:true, visibilityProperty:true, contentVisibilityAuto:true };
  const ids = ['amount','radius','chance','status','surface','wipe-target'];
  const o = {};
  ids.forEach(i => { const e = document.getElementById('ed-onplay-' + i);
    o[i] = e ? (e.closest('.editor-field').classList.contains('fx-off') ? 'HIDDEN' : 'shown') : 'absent'; });
  return o;
});
// REAL user interaction: Playwright selectOption fires the browser's own change
for (const eff of ['drawCards','boardWipe','paintSurface','intimidate']) {
  await page.selectOption('#ed-onplay-type', eff);
  await page.waitForTimeout(120);
  console.log(eff.padEnd(14), JSON.stringify(await rd()));
}
console.log('pageerrors', ctx.errors.length);
await ctx.close();
