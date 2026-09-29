/* ══════════════════════════════════════════════════════════════════════════
   🔎 _CRIT-FW — an INDEPENDENT re-measurement of the Forge-width piece.
   Written by a critic with fresh context. It deliberately does NOT reuse
   drive-forge-width.mjs's softenings (min-of-two line counts, the caption
   subset, the checkbox split) — it prints the RAW bar numbers first and the
   split ones second, so a clause that is only met after a redefinition is
   visible as such.
   Extra falsifications this adds, because a density number can be faked:
     · total visible text length + visible field/label/control counts, so a
       shorter .fx-props that dropped content is caught;
     · overflow/clip on .fx-props and every ancestor;
     · zoom / transform / opacity on <html>, <body>, #app and .card-editor,
       so "shorter" cannot mean "scaled down" or "invisible";
     · font-size histogram, not just the minimum.
   Run:  node .gauntlet/_crit-fw.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import path from 'node:path';
import fs from 'node:fs';
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const WIDTHS = [1600, 1280, 1080, 720];
const HEIGHT = 1000;
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];
const SHOTDIR = process.env.CRIT_FW_SHOTS
  || path.join(process.env.TEMP || process.env.TMP || '.', 'crit-fw-shots');
const TAG = path.basename(process.cwd());

const SEED = () => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'fw_probe'; c.type = 'unit';
  Forge.customCards = [c];
  return { ok: true, id: c.id, name: c.name };
};

const M = ({ open }) => {
  const vis = (el) => (typeof el.checkVisibility === 'function')
    ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
    : el.offsetParent !== null;
  const ed = document.querySelector('.card-editor.fx-two');
  const o = { ok: !!ed, vw: window.innerWidth, vh: window.innerHeight,
              editors: document.querySelectorAll('.card-editor').length };
  if (!ed) return o;

  /* the fixed open-set — every <details> in the editor, explicitly */
  o.detailsTotal = 0; o.opened = []; o.closed = 0; o.openedDisplay = [];
  ed.querySelectorAll('details').forEach((d) => {
    o.detailsTotal++;
    const want = open.indexOf(d.id) >= 0;
    d.open = want;
    if (want) { o.opened.push(d.id); o.openedDisplay.push(d.id + ':' + getComputedStyle(d).display); }
    else o.closed++;
  });
  o.openMissing = open.filter(id => !ed.querySelector('#' + id));

  const cs = getComputedStyle(ed);
  o.editorW = +(parseFloat(cs.width)).toFixed(1);
  o.editorMaxW = cs.maxWidth;
  o.editorRectW = +(ed.getBoundingClientRect().width).toFixed(1);
  o.editorTpl = cs.gridTemplateColumns;

  /* ── scale / visibility falsification: none of these may differ ───────── */
  o.scale = [];
  for (const sel of ['html', 'body', '#app', '.card-editor.fx-two', '.fx-props']) {
    const n = document.querySelector(sel); if (!n) { o.scale.push(sel + ':MISSING'); continue; }
    const s = getComputedStyle(n);
    o.scale.push(sel + ' zoom=' + s.zoom + ' transform=' + s.transform + ' opacity=' + s.opacity
      + ' visibility=' + s.visibility + ' filter=' + s.filter + ' contain=' + (s.contain || '-')
      + ' overflow=' + s.overflow + ' display=' + s.display);
  }

  const props = ed.querySelector('.fx-props');
  const assets = ed.querySelector('.fx-assets');
  o.propsScrollH = props ? props.scrollHeight : -1;
  o.propsClientH = props ? props.clientHeight : -1;
  o.propsScrollW = props ? props.scrollWidth : -1;
  o.propsClientW = props ? props.clientWidth : -1;
  o.propsW = props ? +(parseFloat(getComputedStyle(props).width)).toFixed(1) : null;
  o.propsTop = props ? Math.round(props.getBoundingClientRect().top) : null;
  o.propsOverflow = props ? getComputedStyle(props).overflow : null;
  o.assetsTop = assets ? Math.round(assets.getBoundingClientRect().top) : null;
  o.assetsH = assets ? Math.round(assets.getBoundingClientRect().height) : null;
  o.assetsPos = assets ? getComputedStyle(assets).position : null;
  o.assetsMaxH = assets ? getComputedStyle(assets).maxHeight : null;

  /* CONTENT PRESERVED? A shorter column that dropped content is not density. */
  o.propsTextLen = props ? (props.innerText || '').replace(/\s+/g, ' ').trim().length : -1;
  o.propsTextHash = 0;
  if (props) { const t = (props.innerText || '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < t.length; i++) { o.propsTextHash = (o.propsTextHash * 31 + t.charCodeAt(i)) | 0; } }
  o.fieldsAll = ed.querySelectorAll('.editor-field').length;
  o.fieldsVis = Array.prototype.filter.call(ed.querySelectorAll('.editor-field'), vis).length;
  o.ctlsVis = Array.prototype.filter.call(ed.querySelectorAll('input,select,textarea'),
    e => e.type !== 'hidden' && vis(e)).length;
  o.labelsVis = Array.prototype.filter.call(ed.querySelectorAll('label'), vis).length;

  o.docScrollW = document.documentElement.scrollWidth;
  o.docClientW = document.documentElement.clientWidth;
  o.hScroll = o.docScrollW > o.docClientW;
  o.docScrollH = document.documentElement.scrollHeight;

  /* ── grid columns ─────────────────────────────────────────────────────── */
  o.grids = []; o.minCol = Infinity; o.colCounts = {};
  ed.querySelectorAll('.editor-grid').forEach((g) => {
    if (!vis(g)) return;
    const cols = getComputedStyle(g).gridTemplateColumns.split(/\s+/).map(parseFloat).filter(isFinite);
    if (!cols.length) return;
    const mn = Math.min.apply(null, cols);
    o.grids.push({ owner: (g.closest('details') && g.closest('details').id) || (g.parentElement && g.parentElement.id) || '?',
                   n: cols.length, cols: cols.map(c => +c.toFixed(1)) });
    if (mn < o.minCol) o.minCol = mn;
    o.colCounts[cols.length] = (o.colCounts[cols.length] || 0) + 1;
  });
  o.minCol = isFinite(o.minCol) ? +o.minCol.toFixed(1) : null;

  /* ── controls: RAW bar reading first (every input/select, no exemption) ── */
  o.rawMinCtlCssH = Infinity; o.rawUnder28 = []; o.rawUnder28N = 0;
  o.nonBoxMinCssH = Infinity; o.boxMinCssH = Infinity;
  o.minCtlFont = Infinity; o.ctlFonts = {};
  ed.querySelectorAll('input,select,textarea').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file') return;
    if (!vis(el)) return;
    const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return;
    const st = getComputedStyle(el);
    const h = parseFloat(st.height), f = parseFloat(st.fontSize);
    const isBox = el.type === 'checkbox' || el.type === 'radio';
    const tag = el.tagName.toLowerCase();
    /* THE BAR SAYS "input or select" — textarea is outside it, boxes are not */
    if (tag === 'input' || tag === 'select') {
      if (h < o.rawMinCtlCssH) o.rawMinCtlCssH = h;
      if (h < 28) { o.rawUnder28N++; if (o.rawUnder28.length < 6)
        o.rawUnder28.push({ tag, type: el.type, h: +h.toFixed(1), cls: (el.className || '').slice(0, 30) }); }
    }
    if (isBox) { if (h < o.boxMinCssH) o.boxMinCssH = h; }
    else { if (h < o.nonBoxMinCssH) o.nonBoxMinCssH = h; }
    if (f < o.minCtlFont) o.minCtlFont = f;
    const k = f.toFixed(2); o.ctlFonts[k] = (o.ctlFonts[k] || 0) + 1;
  });
  const fin = (v) => isFinite(v) ? +v.toFixed(2) : null;
  o.rawMinCtlCssH = fin(o.rawMinCtlCssH); o.nonBoxMinCssH = fin(o.nonBoxMinCssH);
  o.boxMinCssH = fin(o.boxMinCssH); o.minCtlFont = fin(o.minCtlFont);

  /* ── labels: truncation + line counts, BOTH measures reported raw ─────── */
  o.minLabFont = Infinity; o.labFonts = {};
  o.trunc = []; o.truncN = 0;
  o.hLinesOver2 = 0; o.rLinesOver2 = 0; o.minLinesOver2 = 0; o.maxLinesSeen = 0;
  o.overList = []; o.labels = [];
  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    const st = getComputedStyle(el);
    const f = parseFloat(st.fontSize);
    if (f < o.minLabFont) o.minLabFont = f;
    const k = f.toFixed(2); o.labFonts[k] = (o.labFonts[k] || 0) + 1;
    const raw = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (el.scrollWidth > el.clientWidth) { o.truncN++; if (o.trunc.length < 10)
      o.trunc.push({ t: raw.slice(0, 40), cw: el.clientWidth, sw: el.scrollWidth }); }
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const hL = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
    let rL = 1;
    try {
      const tops = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!/\S/.test(n.nodeValue || '')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rects = rg.getClientRects();
        for (let i = 0; i < rects.length; i++) if (rects[i].width > 0) tops.push(rects[i].top);
      }
      tops.sort((a, b) => a - b);
      const tol = Math.max(6, f * 0.6);
      let lines = 0, last = -1e9;
      for (const t of tops) if (t - last > tol) { lines++; last = t; }
      rL = Math.max(1, lines);
    } catch (e) {}
    if (hL > 2) o.hLinesOver2++;
    if (rL > 2) o.rLinesOver2++;
    const mn = Math.min(hL, rL);
    if (mn > 2) { o.minLinesOver2++; if (o.overList.length < 8)
      o.overList.push({ t: raw.slice(0, 44), h: hL, r: rL, len: raw.length }); }
    if (mn > o.maxLinesSeen) o.maxLinesSeen = mn;
    o.labels.push([raw.slice(0, 44), mn, hL, rL, raw.length]);
  });
  o.minLabFont = fin(o.minLabFont);

  const fulls = Array.prototype.filter.call(ed.querySelectorAll('.editor-field.full'), vis);
  o.fullN = fulls.length;
  o.fullMaxW = fulls.length ? Math.round(Math.max.apply(null, fulls.map(f => f.getBoundingClientRect().width))) : null;
  return o;
};

const OTHERS = () => {
  const shot = (which) => {
    App.editingCardId = null; App.editingMoveId = null; App.editingEventId = null;
    App.editingEncounterId = null; App.editingPackId = null; App.editingStructDeckId = null;
    App.editingGuideId = null; App.editingItemId = null; App.editingTutorialId = null;
    App.forgeTab = which === 'move' ? 'moves' : 'events';
    if (which === 'move') App.editingMoveId = 'NEW'; else App.editingEventId = 'NEW';
    try { renderForge(); } catch (e) { return { err: String(e).slice(0, 160) }; }
    const eds = document.querySelectorAll('.card-editor');
    if (!eds.length) return { n: 0 };
    const e0 = eds[0], s = getComputedStyle(e0);
    return { n: eds.length, w: +(parseFloat(s.width)).toFixed(1), maxW: s.maxWidth,
             tpl: s.gridTemplateColumns, fxTwo: e0.classList.contains('fx-two'),
             hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  };
  return { move: shot('move'), event: shot('event') };
};

const MODAL = ({ cardId }) => {
  App.editingMoveId = null; App.editingEventId = null;
  App.forgeTab = 'cards'; App.editingCardId = cardId;
  App._traitPoolModal = true;
  try { renderForge(); } catch (e) { return { err: String(e).slice(0, 200) }; }
  const m = document.getElementById('traitpool-backdrop');
  if (!m) { App._traitPoolModal = false; return { present: false }; }
  const r = m.getBoundingClientRect(), st = getComputedStyle(m);
  const trap = [];
  for (let a = document.querySelector('.card-editor'); a && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none'
        || (s.contain && /paint|layout|strict|content/.test(s.contain))
        || (s.willChange && /transform|filter|perspective/.test(s.willChange))
        || (s.backdropFilter && s.backdropFilter !== 'none')) {
      trap.push(a.tagName + (a.id ? '#' + a.id : '') + ' {transform:' + s.transform
        + ';filter:' + s.filter + ';contain:' + (s.contain || '-') + ';backdrop:' + s.backdropFilter + '}');
    }
  }
  const out = { present: true, parentIsBody: m.parentElement === document.body,
    parentTag: m.parentElement ? m.parentElement.tagName + (m.parentElement.id ? '#' + m.parentElement.id : '') : null,
    offsetParentIsBody: m.offsetParent === document.body,
    offsetParent: m.offsetParent ? m.offsetParent.tagName : 'null',
    position: st.position,
    rect: { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.top >= -1 && r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
    vw: window.innerWidth, vh: window.innerHeight, trapAncestors: trap };
  App._traitPoolModal = false;
  document.querySelectorAll('#traitpool-backdrop').forEach(n => n.remove());
  return out;
};

const run = async () => {
  const { page, close, errors } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO,
    viewport: { width: WIDTHS[0], height: HEIGHT } });
  const out = { tag: TAG, cwd: process.cwd(), widths: {} };
  try {
    out.seed = await page.evaluate(SEED);
    if (!out.seed.ok) throw new Error('SEED failed');
    fs.mkdirSync(SHOTDIR, { recursive: true });
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: HEIGHT });
      await openCardEditor(page, out.seed.id);
      await page.evaluate(M, { open: OPEN });
      await page.waitForTimeout(150);
      const m = await page.evaluate(M, { open: OPEN });
      const f = path.join(SHOTDIR, 'crit-' + TAG + '-' + w + '.png');
      await page.screenshot({ path: f, fullPage: false });
      m.shot = f;
      /* a second shot scrolled into the properties column: the top of the page
         is the asset rail and a critic that only looks at the fold sees art. */
      await page.evaluate(() => { const p = document.querySelector('.fx-props');
        if (p) p.scrollIntoView({ block: 'start' }); });
      await page.waitForTimeout(120);
      const f2 = path.join(SHOTDIR, 'crit-' + TAG + '-' + w + '-props.png');
      await page.screenshot({ path: f2, fullPage: false });
      m.shotProps = f2;
      m.others = await page.evaluate(OTHERS);
      await openCardEditor(page, out.seed.id);
      m.modal = await page.evaluate(MODAL, { cardId: out.seed.id });
      out.widths[w] = m;
    }
    out.pageErrors = errors.slice(0, 6);
  } finally { await close(); }
  console.log('__CFW__' + JSON.stringify(out));
  for (const w of WIDTHS) {
    const m = out.widths[w] || {};
    console.error(`[${TAG}] ${w}  edW=${m.editorW}(max ${m.editorMaxW}) props=${m.propsScrollH} `
      + `txtLen=${m.propsTextLen} fieldsVis=${m.fieldsVis} ctls=${m.ctlsVis} labels=${m.labelsVis} `
      + `minCol=${m.minCol} cols=${JSON.stringify(m.colCounts)} rawMinCtlH=${m.rawMinCtlCssH}(under28:${m.rawUnder28N}) `
      + `nonBoxMinH=${m.nonBoxMinCssH} boxMinH=${m.boxMinCssH} labFont=${m.minLabFont} ctlFont=${m.minCtlFont} `
      + `trunc=${m.truncN} over2[min/h/r]=${m.minLinesOver2}/${m.hLinesOver2}/${m.rLinesOver2} `
      + `hScroll=${m.hScroll} propsTop=${m.propsTop} move=${JSON.stringify(m.others && m.others.move)} `
      + `event=${JSON.stringify(m.others && m.others.event)}`);
  }
  return out;
};
await run();
