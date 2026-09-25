import { bootPage, openCardEditor } from './_forge-harness.mjs';
const ctx = await bootPage({ cwd: 'D:/game-deploy', viewport: { width: 1400, height: 1200 } });
const { page } = ctx;
await openCardEditor(page, 'NEW', {});
await page.evaluate(() => document.querySelectorAll('.card-editor details').forEach(d => d.open = true));
const r1 = await page.evaluate(() => {
  const slots = [...document.querySelectorAll('[data-xslot]')];
  return { n: slots.length, styles: slots.map(s => s.getAttribute('style')) };
});
console.log('slots before:', JSON.stringify(r1));
// click the REAL button through the real event path
await page.click('#ed-onplayx-add');
await page.waitForTimeout(200);
const r2 = await page.evaluate(() => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const slots = [...document.querySelectorAll('[data-xslot]')];
  const cnt = i => [...document.querySelectorAll('.card-editor input[id],.card-editor select[id]')]
    .filter(e => e.id.indexOf('ed-onplayx-' + i + '-') === 0 && e.checkVisibility(CV)).length;
  return { styles: slots.map(s => s.getAttribute('style')), c0: cnt(0), c1: cnt(1), c2: cnt(2) };
});
console.log('slots after click:', JSON.stringify(r2));
// full 118 sweep on the freshly revealed slot 1
const sweep = await page.evaluate(() => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const ids = ONPLAY_TYPES.map(t => t.id);
  const out = {};
  for (const e of ids) {
    const s = document.getElementById('ed-onplayx-1-type');
    s.value = e; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    out[e] = [...document.querySelectorAll('.card-editor input[id],.card-editor select[id]')]
      .filter(x => x.id.indexOf('ed-onplayx-1-') === 0 && x.checkVisibility(CV))
      .map(x => x.id.slice('ed-onplayx-1-'.length)).sort();
  }
  const ns = Object.values(out).map(a => a.length);
  return { min: Math.min(...ns), max: Math.max(...ns), mean: (ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(1),
    dom: [...document.querySelectorAll('.card-editor input[id],.card-editor select[id]')].filter(x => x.id.indexOf('ed-onplayx-1-') === 0).length,
    drawCards: out.drawCards, boardWipe: out.boardWipe, intimidate: out.intimidate, damagePerCard: out.damagePerCard };
});
console.log('slot-1 sweep:', JSON.stringify(sweep));
// nine drawers, by NAME, after the split
const drawers = await page.evaluate(() => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const t = document.getElementById('ed-type');
  const ds = [...document.querySelectorAll('#fx-ingrave details[id^="fx-g-"]')];
  return { n: ds.length, cardType: t ? t.value : null,
    names: ds.map(d => ({ id: d.id, label: (d.querySelector('summary') || {}).textContent.replace(/\s+/g, ' ').trim().slice(0, 34), vis: d.checkVisibility(CV) })) };
});
console.log('drawers:', JSON.stringify(drawers, null, 1));
await ctx.close();
