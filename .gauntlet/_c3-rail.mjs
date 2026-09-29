import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';
const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO, viewport: { width: 1080, height: 1000 } });
const seed = await page.evaluate(() => { const c = JSON.parse(JSON.stringify(UNIT_CARDS[0])); c.id='c3r'; c.type='unit'; Forge.customCards=[c]; return c.id; });
for (const w of [1080, 720]) {
  await page.setViewportSize({ width: w, height: 1000 });
  await openCardEditor(page, seed);
  const r = await page.evaluate(() => {
    const a = document.querySelector('.fx-assets');
    const cs = getComputedStyle(a);
    return { offsetW: a.offsetWidth, clientW: a.clientWidth, scrollbarPx: a.offsetWidth - a.clientWidth - 2,
             offsetH: a.offsetHeight, clientH: a.clientHeight, scrollH: a.scrollHeight,
             overflowY: cs.overflowY, maxH: cs.maxHeight,
             canScroll: a.scrollHeight > a.clientHeight + 1,
             /* prove it actually scrolls */ moved: (() => { a.scrollTop = 9999; const t = a.scrollTop; a.scrollTop = 0; return t; })() };
  });
  console.log(w, JSON.stringify(r));
}
await close();
