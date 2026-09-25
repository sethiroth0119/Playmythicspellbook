import { bootPage, openCardEditor } from './_forge-harness.mjs';
import fs from 'fs';
const ROOT = process.argv[2] || 'D:/game-deploy';
const TAG = process.argv[3] || 'tree';
const ctx = await bootPage({ cwd: ROOT, viewport: { width: 1400, height: 1200 } });
const { page } = ctx;
await openCardEditor(page, 'NEW', {});
await page.evaluate(() => document.querySelectorAll('.card-editor details').forEach(d => d.open = true));

// nine ability drawers, BY NAME, on a unit card
const drawers = await page.evaluate(() => {
  const t = document.getElementById('ed-type');
  if (t) { t.value = 'unit'; t.dispatchEvent(new Event('change', { bubbles: true })); }
  const g = document.querySelector('#fx-ingrave .editor-grid');
  if (!g) return { err: 'no #fx-ingrave .editor-grid' };
  const kids = [...g.children];
  return {
    topLevel: kids.length,
    withIgIds: kids.filter(k => k.querySelector('[id^="ed-ig-"]') || (k.id || '').indexOf('ed-ig-') === 0).length,
    names: kids.map(k => {
      const s = k.querySelector('summary, label, .fx-drawer-title');
      return (s ? s.textContent : k.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44);
    }),
  };
});

// re-check the sendMatching picker in isolation (it read 0 visible controls as
// the FIRST pick of a sequence — order artefact or real?)
const sendM = await page.evaluate(() => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const s = document.getElementById('ed-onplay-type');
  const go = v => { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); };
  const read = () => {
    const w = document.getElementById('ed-onplay-searchcards').closest('.editor-field');
    return { vis: w.checkVisibility(CV), h: Math.round(w.getBoundingClientRect().height),
      ctrls: [...w.querySelectorAll('input,select,button')].filter(e => e.checkVisibility(CV)).length,
      rows: [...w.querySelectorAll('.searchpick-row')].filter(e => e.checkVisibility(CV)).length };
  };
  go('drawCards'); const off = read();
  go('sendMatching'); const on1 = read();
  go('boardWipe'); go('sendMatching'); const on2 = read();
  return { off, on1, on2 };
});

// clause: a slot revealed AFTER bind by the real ➕
const slot = await page.evaluate(() => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const cnt = i => [...document.querySelectorAll('.card-editor input[id],.card-editor select[id]')]
    .filter(e => e.id.indexOf('ed-onplayx-' + i + '-') === 0 && e.checkVisibility(CV)).length;
  const before = cnt(1);
  const btn = document.getElementById('ed-onplayx-add') || document.querySelector('[id*="onplayx-add"]');
  if (btn) btn.click();
  document.querySelectorAll('.card-editor details').forEach(d => d.open = true);
  const after = cnt(1);
  // now sweep every effect on the freshly revealed slot
  const ids = (typeof ONPLAY_TYPES !== 'undefined' ? ONPLAY_TYPES : []).map(t => t.id);
  const seen = new Set(); let min = 999, max = 0;
  for (const e of ids) {
    const s = document.getElementById('ed-onplayx-1-type');
    if (!s) break;
    s.value = e; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    const n = cnt(1); if (n < min) min = n; if (n > max) max = n; seen.add(n);
  }
  return { btn: !!btn, before, after, sweepMin: min, sweepMax: max };
});

// SCREENSHOTS of the on-play drawer, for real eyes
for (const eff of ['drawCards', 'boardWipe', 'intimidate', 'reviveGrave']) {
  await page.evaluate((e) => {
    const s = document.getElementById('ed-onplay-type');
    s.value = e; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    const sec = document.getElementById('fx-onplay');
    if (sec) sec.scrollIntoView({ block: 'start' });
  }, eff);
  await page.waitForTimeout(400);
  const el = await page.$('#fx-onplay');
  const f = ROOT.replace(/\\/g, '/') + '/.gauntlet/_crit3-' + TAG + '-' + eff + '.png';
  await el.screenshot({ path: f });
  const h = await page.evaluate(() => Math.round(document.getElementById('fx-onplay').getBoundingClientRect().height));
  console.log(eff.padEnd(12), 'drawerPx', String(h).padStart(6), 'png', fs.statSync(f).size, 'B');
}
console.log('DRAWERS', JSON.stringify(drawers));
console.log('SENDMATCHING', JSON.stringify(sendM));
console.log('SLOT+', JSON.stringify(slot));
console.log('pageerrors', ctx.errors.length, ctx.errors.slice(0, 3));
await ctx.close();
