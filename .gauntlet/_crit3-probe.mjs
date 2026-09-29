import { bootPage, openCardEditor } from './_forge-harness.mjs';
const CASES = [
  ['sendMatching', 'searchcards'], ['searchDeck', 'searchcards'], ['millSearch', 'searchcards'],
  ['reviveGrave', 'searchcards'], ['peekHand', 'amount'], ['peekDiscard', 'amount'],
  ['peekBanish', 'amount'], ['graveToHand', 'salvage-cards'], ['deckToGrave', 'filter-cards'],
  ['destroyLocation', 'amount'], ['destroyLocation', 'summoncards'], ['destroyLocation', 'summonzone'],
  ['summonFromZone', 'summoncards'], ['setTimeOfDay', 'amount'], ['setFromZone', 'filter-cards'],
  ['setFromZone', 'summoncards'], ['sacrificeToSummon', 'summoncards'],
  // controls: fields that MUST be visible
  ['drawCards', 'amount'], ['paintSurface', 'surface'], ['intimidate', 'chance'],
];
const ctx = await bootPage({ cwd: 'D:/game-deploy', viewport: { width: 1400, height: 1200 } });
const { page } = ctx;
await openCardEditor(page, 'NEW', {});
await page.evaluate(() => document.querySelectorAll('.card-editor details').forEach(d => d.open = true));
const out = await page.evaluate((cases) => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const res = [];
  for (const [eff, suf] of cases) {
    const s = document.getElementById('ed-onplay-type');
    s.value = eff; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    const el = document.getElementById('ed-onplay-' + suf);
    if (!el) { res.push({ eff, suf, exists: false }); continue; }
    const sec = el.closest('.fx-sec, .fx-sub');
    const offAnc = el.closest('.fx-off');
    res.push({
      eff, suf, exists: true, tag: el.tagName,
      visible: el.checkVisibility(CV),
      selfFxOff: el.classList.contains('fx-off'),
      offAncestor: offAnc ? (offAnc.id || offAnc.className) : null,
      secDisplay: sec ? (sec.style.display || '(default)') : null,
      secSwept: sec ? !!sec.dataset.fxSwept : null,
      inlineDisplay: el.style.display || '(default)',
      rect: Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height),
    });
  }
  return res;
}, CASES);
out.forEach(r => console.log(JSON.stringify(r)));
await ctx.close();
