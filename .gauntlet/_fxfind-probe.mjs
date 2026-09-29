/* 📊 BASELINE PROBE — how many ONPLAY_TYPES-shaped <select>s the real editor
   renders per card type, and how big each rendered <optgroup> is. */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const { page, close } = await bootPage({ assetsFrom: REPO });
const rows = [];
for (const type of ['unit', 'spell', 'trap']) {
  await page.evaluate((t) => { window.__fxProbeType = t; }, type);
  await openCardEditor(page, 'NEW', { paintSettleMs: 900 });
  await page.evaluate((t) => {
    const d = App._newCardDraft; if (d) d.type = t;
    App.editingCardId = 'NEW';
    renderForge();
  }, type);
  const r = await page.evaluate(() => {
    const ids = new Set(ONPLAY_TYPES.map(x => x.id));
    const sels = Array.from(document.querySelectorAll('.card-editor select')).filter(s => {
      let n = 0; for (const o of s.options) if (ids.has(o.value)) n++;
      return n >= 40;
    });
    const groups = [];
    sels.forEach(s => { for (const g of s.querySelectorAll('optgroup')) groups.push([g.label, g.children.length]); });
    const first = sels[0];
    const firstGroups = first ? Array.from(first.querySelectorAll('optgroup')).map(g => [g.label, g.children.length]) : [];
    return {
      cardType: (App._newCardDraft || {}).type,
      selects: sels.length,
      selectIds: sels.map(s => s.id || '(no id)'),
      firstOptionCount: first ? first.options.length : 0,
      firstGroups,
      maxGroup: groups.length ? Math.max(...groups.map(g => g[1])) : 0,
      totalOptionsAcross: sels.reduce((a, s) => a + s.options.length, 0),
      fields: document.querySelectorAll('.editor-field').length,
    };
  });
  r.type = type; rows.push(r);
}
console.log(JSON.stringify(rows, null, 1));
await close();
