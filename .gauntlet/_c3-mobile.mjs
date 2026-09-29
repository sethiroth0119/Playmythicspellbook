/* 🔎 _C3-MOBILE — the widths the bar does NOT name.
   `@media (max-width: 600px) { .editor-grid { grid-template-columns: 1fr } }`
   (34134) is how this editor has always survived a phone. The new rules
   `.fx-two .editor-grid` and `.fx-two .fx-sub > .editor-grid` are specificity
   0,2,0 against that rule's 0,1,0 and sit OUTSIDE the media query, so they win
   at every width — including 390px, where minmax(340px,1fr) cannot fit.
   Does the page get a horizontal scrollbar an owner on a tablet/phone would
   see?  Run: node .gauntlet/_c3-mobile.mjs   prints __C3MOB__<json>        */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';
import path from 'node:path';
const TAG = path.basename(process.cwd());
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];
const SEED = () => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src)); c.id = 'c3m'; c.type = 'unit';
  Forge.customCards = [c]; return { ok: true, id: c.id };
};
const M = ({ open }) => {
  const vis = el => typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
    : el.offsetParent !== null;
  const ed = document.querySelector('.card-editor.fx-two');
  if (!ed) return { ok: false };
  ed.querySelectorAll('details').forEach(d => { d.open = open.indexOf(d.id) >= 0; });
  const o = { ok: true, vw: innerWidth, htmlZoom: getComputedStyle(document.documentElement).zoom,
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth, bodyClientW: document.body.clientWidth };
  o.hScroll = o.docScrollW > o.docClientW;
  const props = ed.querySelector('.fx-props');
  o.propsW = props ? Math.round(props.getBoundingClientRect().width) : null;
  o.propsScrollW = props ? props.scrollWidth : null;
  o.propsClientW = props ? props.clientWidth : null;
  o.propsOverflowsX = props ? props.scrollWidth > props.clientWidth + 1 : null;
  o.propsScrollH = props ? props.scrollHeight : null;
  o.grids = []; o.minCol = Infinity; o.widest = 0;
  ed.querySelectorAll('.editor-grid').forEach((g) => {
    if (!vis(g)) return;
    const cs = getComputedStyle(g);
    const cols = cs.gridTemplateColumns.split(/\s+/).map(parseFloat).filter(isFinite);
    const r = g.getBoundingClientRect();
    const parentW = g.parentElement.getBoundingClientRect().width;
    if (cols.length) o.minCol = Math.min(o.minCol, Math.min.apply(null, cols));
    if (r.width > o.widest) o.widest = r.width;
    o.grids.push({ owner: (g.closest('details') && g.closest('details').id) || (g.parentElement.className || '').toString().slice(0, 18),
      sub: !!g.parentElement.classList.contains('fx-sub'), tpl: cs.gridTemplateColumns,
      w: +r.width.toFixed(1), parentW: +parentW.toFixed(1), overflows: r.width > parentW + 1,
      scrollW: g.scrollWidth, clientW: g.clientWidth });
  });
  o.minCol = isFinite(o.minCol) ? +o.minCol.toFixed(1) : null;
  o.gridsOverflowing = o.grids.filter(g => g.overflows || g.scrollW > g.clientW + 1).length;
  /* anything painted outside the editor's own box */
  const er = ed.getBoundingClientRect();
  o.outside = 0; o.outsideEg = [];
  ed.querySelectorAll('*').forEach((el) => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > er.right + 2) { o.outside++;
      if (o.outsideEg.length < 5) o.outsideEg.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 26),
        right: Math.round(r.right), edRight: Math.round(er.right) }); }
  });
  return o;
};
const run = async () => {
  const { page, close, errors } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO,
    viewport: { width: 390, height: 844 } });
  const out = { tag: TAG, cwd: process.cwd(), w: {} };
  try {
    out.seed = await page.evaluate(SEED);
    for (const w of [600, 480, 390, 360]) {
      await page.setViewportSize({ width: w, height: 844 });
      await openCardEditor(page, out.seed.id);
      await page.evaluate(M, { open: OPEN });
      await page.waitForTimeout(150);
      out.w[w] = await page.evaluate(M, { open: OPEN });
      const f = path.join(process.env.TEMP || '.', 'c3-mob-' + TAG + '-' + w + '.png');
      await page.screenshot({ path: f }); out.w[w].shot = f;
    }
    out.pageErrors = errors.slice(0, 4);
  } finally { await close(); }
  console.log('__C3MOB__' + JSON.stringify(out));
  for (const w of Object.keys(out.w)) {
    const m = out.w[w];
    console.error(`[${TAG}] ${w} zoom=${m.htmlZoom} hScroll=${m.hScroll} (${m.docScrollW}/${m.docClientW}) `
      + `propsW=${m.propsW} propsOvfX=${m.propsOverflowsX} (${m.propsScrollW}/${m.propsClientW}) `
      + `minCol=${m.minCol} gridsOverflowing=${m.gridsOverflowing} outside=${m.outside} shot=${m.shot}`);
  }
};
await run();
