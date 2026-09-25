// The 10 residual "misses" are all HIDDEN BACKING INPUTS of the click-to-add
// card picker (163015: "lives as a CSV on a hidden input"), so element
// visibility is the wrong question. Ask whether the picker's VISIBLE host —
// the .editor-field that wraps it — is on screen for that effect.
import { bootPage, openCardEditor } from './_forge-harness.mjs';
const CASES = [
  ['sendMatching', 'searchcards'], ['searchDeck', 'searchcards'], ['millSearch', 'searchcards'],
  ['reviveGrave', 'searchcards'], ['graveToHand', 'salvage-cards'], ['deckToGrave', 'filter-cards'],
  ['summonFromZone', 'summoncards'], ['setFromZone', 'filter-cards'], ['setFromZone', 'summoncards'],
  ['sacrificeToSummon', 'summoncards'],
  // negative control: an effect that must NOT show the allow-list
  ['drawCards', 'searchcards'], ['drawCards', 'summoncards'], ['boardWipe', 'salvage-cards'],
];
const ctx = await bootPage({ cwd: process.argv[2] || 'D:/game-deploy', viewport: { width: 1400, height: 1200 } });
const { page } = ctx;
await openCardEditor(page, 'NEW', {});
await page.evaluate(() => document.querySelectorAll('.card-editor details').forEach(d => d.open = true));
const gateOn = await page.evaluate(() => typeof _fxApplyEffectGate === 'function');
const out = await page.evaluate((cases) => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  return cases.map(([eff, suf]) => {
    const s = document.getElementById('ed-onplay-type');
    s.value = eff; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    const el = document.getElementById('ed-onplay-' + suf);
    if (!el) return { eff, suf, exists: false };
    const wrap = el.closest('.editor-field');
    const rows = wrap ? wrap.querySelectorAll('.searchpick-row, .searchpick-chip, input[type="text"], select, button').length : 0;
    const visRows = wrap ? [...wrap.querySelectorAll('.searchpick-row, .searchpick-chip, input, select, button')].filter(e => e.checkVisibility(CV)).length : 0;
    const r = wrap ? wrap.getBoundingClientRect() : null;
    return {
      eff, suf,
      wrapVisible: wrap ? wrap.checkVisibility(CV) : null,
      wrapFxOff: wrap ? wrap.classList.contains('fx-off') : null,
      wrapH: r ? Math.round(r.height) : null,
      label: wrap ? (wrap.querySelector('label') || {}).textContent?.trim().slice(0, 46) : null,
      controlsInWrap: rows, visibleControlsInWrap: visRows,
    };
  });
}, CASES);
console.log('gate present:', gateOn);
out.forEach(r => console.log(JSON.stringify(r)));
await ctx.close();
