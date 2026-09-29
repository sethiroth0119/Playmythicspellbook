/* 🔬 _FW-ALLOPEN — the two things the fixed open-set cannot answer.
   (a) EVERY <details> open on 7 real card types at 4 widths: labels past two
       lines by the client-rect measure, min visible field, min column.
   (b) WHY THE HEIGHT MEASURE DISAGREES. round(box height / line-height) flags
       ~84 labels at 1600 where the client-rect measure flags 0. This dumps the
       flagged ones with their real text-line count and box height so the
       disagreement is a fact on the page, not an assertion.
   Run: node .gauntlet/_fw-allopen.mjs                                        */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const WIDTHS = [1600, 1280, 1080, 720];
const HEIGHT = 1000;
const TYPES = ['unit', 'spell', 'trap', 'weather', 'location', 'counter', 'wall'];
const FIXED = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];

const SEED = ({ type }) => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'fw_ao_' + type; c.type = type;
  Forge.customCards = [c];
  return { ok: true, id: c.id };
};

const M = ({ open }) => {
  const vis = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const ed = document.querySelector('.card-editor.fx-two');
  if (!ed) return { ok: false };
  ed.querySelectorAll('details').forEach(d => { d.open = open === 'ALL' ? true : open.indexOf(d.id) >= 0; });
  const o = { ok: true, over2r: 0, over2h: 0, labels: 0, disagree: [], minCol: Infinity,
    minField: Infinity, minCtlH: Infinity, trunc: 0 };
  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    o.labels++;
    const st = getComputedStyle(el); const f = parseFloat(st.fontSize);
    if (el.scrollWidth > el.clientWidth) o.trunc++;
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const box = el.getBoundingClientRect().height;
    const hL = Math.max(1, Math.round(box / lh));
    const tops = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!/\S/.test(n.nodeValue || '')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rects = rg.getClientRects();
      for (let i = 0; i < rects.length; i++) if (rects[i].width > 0) tops.push(rects[i].top);
    }
    tops.sort((a, b) => a - b);
    const tol = Math.max(6, f * 0.6); let lines = 0, last = -1e9;
    for (const t of tops) if (t - last > tol) { lines++; last = t; }
    const rL = Math.max(1, lines);
    if (rL > 2) { o.over2r++; if (!o.overList) o.overList = [];
      o.overList.push(`${rL} lines @${Math.round(el.getBoundingClientRect().width)}px :: `
        + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 66)); }
    if (hL > 2) { o.over2h++;
      if (rL <= 2 && o.disagree.length < 4) o.disagree.push({ h: hL, r: rL, box: Math.round(box), lh: +lh.toFixed(1),
        disp: st.display, boxKid: !!el.querySelector('input[type="checkbox"],input[type="radio"]'),
        t: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) }); }
  });
  ed.querySelectorAll('.editor-grid').forEach((g) => {
    if (!vis(g)) return;
    const cols = getComputedStyle(g).gridTemplateColumns.split(/\s+/).map(parseFloat).filter(isFinite);
    cols.forEach(c => { if (c > 0 && c < o.minCol) o.minCol = c; });   /* 0 = auto-fit collapsed empty track */
  });
  ed.querySelectorAll('.editor-field').forEach((el) => {
    if (!vis(el)) return;
    const w = el.getBoundingClientRect().width;
    if (w > 0 && w < o.minField) o.minField = w;
  });
  ed.querySelectorAll('input,select').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file' || !vis(el)) return;
    const h = parseFloat(getComputedStyle(el).height);
    if (h < o.minCtlH) o.minCtlH = h;
  });
  const fin = v => isFinite(v) ? +v.toFixed(1) : null;
  o.minCol = fin(o.minCol); o.minField = fin(o.minField); o.minCtlH = fin(o.minCtlH);
  return o;
};

const run = async () => {
  const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO,
    viewport: { width: WIDTHS[0], height: HEIGHT } });
  try {
    console.log('=== EVERY <details> OPEN, 7 card types x 4 widths ===');
    console.log('  width type      labels over2(rect) over2(height) trunc minCol minField minCtlH');
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: HEIGHT });
      for (const ty of TYPES) {
        const seed = await page.evaluate(SEED, { type: ty });
        await openCardEditor(page, seed.id);
        await page.evaluate(M, { open: 'ALL' });
        await page.waitForTimeout(90);
        const r = await page.evaluate(M, { open: 'ALL' });
        console.log(`  ${String(w).padEnd(6)}${ty.padEnd(10)}${String(r.labels).padEnd(7)}${String(r.over2r).padEnd(13)}`
          + `${String(r.over2h).padEnd(14)}${String(r.trunc).padEnd(6)}${String(r.minCol).padEnd(7)}${String(r.minField).padEnd(9)}${r.minCtlH}`);
        if (process.env.FW_LIST && r.overList) r.overList.forEach(x => console.log('        ' + x));
      }
    }
    console.log('\n=== WHY THE HEIGHT MEASURE DISAGREES (fixed open-set, unit card) ===');
    const seed = await page.evaluate(SEED, { type: 'unit' });
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: HEIGHT });
      await openCardEditor(page, seed.id);
      await page.evaluate(M, { open: FIXED });
      await page.waitForTimeout(90);
      const r = await page.evaluate(M, { open: FIXED });
      console.log(`  ${w}: rect-measure ${r.over2r}, height-measure ${r.over2h}, of which ${r.over2h - r.over2r} disagree`);
      r.disagree.forEach(d => console.log(`     box ${d.box}px / lh ${d.lh} = ${d.h} "lines", real text lines ${d.r},`
        + ` display:${d.disp}, holds a checkbox: ${d.boxKid}  :: ${d.t}`));
    }
  } finally { await close(); }
};
await run();
