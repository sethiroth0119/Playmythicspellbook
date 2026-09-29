/* ══════════════════════════════════════════════════════════════════════════
   🔎 _C3-FW — THIRD critic, fresh context, own measurement code.
   Deliberately written without reusing _crit-fw.mjs's reductions:
     · line counts are reported THREE ways (raw box/lh, padding-corrected
       box/lh, and range-rect line tops) and every DISAGREEING label is dumped
       with its own geometry, so "that measure is a false positive" has to be
       proven from the dump rather than asserted;
     · overflow is hunted explicitly — any visible element whose border box
       sticks out past .fx-props, any zero-width visible field (grid-auto-
       columns:0 can make an implicit column that swallows content), any
       label/control clipped vertically;
     · the asset rail is checked for REACHABILITY, not just height: a
       max-height on an overflow:auto box is fine, on a clip box it deletes
       controls.
   Run: node .gauntlet/_c3-fw.mjs      prints one __C3FW__<json> line.
   ══════════════════════════════════════════════════════════════════════════ */
import path from 'node:path';
import fs from 'node:fs';
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const WIDTHS = [1600, 1280, 1080, 720];
const HEIGHT = 1000;
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];
const SHOTDIR = process.env.C3_SHOTS
  || path.join(process.env.TEMP || process.env.TMP || '.', 'c3-fw-shots');
const TAG = path.basename(process.cwd());

const SEED = () => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'c3_probe'; c.type = 'unit';
  Forge.customCards = [c];
  return { ok: true, id: c.id, name: c.name };
};

const M = ({ open }) => {
  const vis = (el) => (typeof el.checkVisibility === 'function')
    ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
    : el.offsetParent !== null;
  const ed = document.querySelector('.card-editor.fx-two');
  const o = { ok: !!ed, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
              editors: document.querySelectorAll('.card-editor').length };
  if (!ed) return o;

  /* THE FIXED OPEN-SET, applied element by element, then reported back */
  o.openApplied = []; o.closedN = 0; o.detailsN = 0;
  ed.querySelectorAll('details').forEach((d) => {
    o.detailsN++;
    const want = open.indexOf(d.id) >= 0;
    d.open = want;
    if (want) o.openApplied.push(d.id + ':' + getComputedStyle(d).display + ':open=' + d.open);
    else o.closedN++;
  });
  o.openMissing = open.filter(id => !ed.querySelector('#' + id));

  const cs = getComputedStyle(ed);
  o.edW = +parseFloat(cs.width).toFixed(1);
  o.edMaxW = cs.maxWidth;
  o.edRectW = +ed.getBoundingClientRect().width.toFixed(1);
  o.edTpl = cs.gridTemplateColumns;

  /* anti-cheat: nothing may be scaled, faded, clipped or hidden */
  o.chrome = [];
  for (const sel of ['html', 'body', '#app', '.card-editor.fx-two', '.fx-props', '.fx-assets']) {
    const n = document.querySelector(sel); if (!n) { o.chrome.push(sel + ':MISSING'); continue; }
    const s = getComputedStyle(n);
    o.chrome.push(sel + ' zoom=' + s.zoom + ' tr=' + s.transform + ' op=' + s.opacity + ' vis=' + s.visibility
      + ' filt=' + s.filter + ' cont=' + (s.contain || '-') + ' ovf=' + s.overflow + ' disp=' + s.display
      + ' clip=' + (s.clipPath || '-') + ' maxH=' + s.maxHeight);
  }

  const props = ed.querySelector('.fx-props');
  const rail = ed.querySelector('.fx-assets');
  o.propsScrollH = props ? props.scrollHeight : -1;
  o.propsClientH = props ? props.clientHeight : -1;
  o.propsScrollW = props ? props.scrollWidth : -1;
  o.propsClientW = props ? props.clientWidth : -1;
  o.propsW = props ? +parseFloat(getComputedStyle(props).width).toFixed(1) : null;
  o.propsTop = props ? Math.round(props.getBoundingClientRect().top) : null;
  o.railH = rail ? Math.round(rail.getBoundingClientRect().height) : null;
  o.railScrollH = rail ? rail.scrollHeight : null;
  o.railClientH = rail ? rail.clientHeight : null;
  o.railOvfY = rail ? getComputedStyle(rail).overflowY : null;
  o.railMaxH = rail ? getComputedStyle(rail).maxHeight : null;
  o.railPos = rail ? getComputedStyle(rail).position : null;
  o.railReachable = rail ? (o.railOvfY === 'auto' || o.railOvfY === 'scroll' || o.railScrollH <= o.railClientH + 1) : null;
  /* how many of the rail's own controls are inside its visible box */
  if (rail) {
    const rr = rail.getBoundingClientRect();
    const ctl = Array.prototype.slice.call(rail.querySelectorAll('button,input,select,.image-slot'));
    o.railCtlN = ctl.length;
    o.railCtlBelowFold = ctl.filter(c => c.getBoundingClientRect().top > rr.bottom + 1).length;
  }

  /* CONTENT PRESERVED */
  const txt = props ? (props.innerText || '').replace(/\s+/g, ' ').trim() : '';
  o.txtLen = txt.length;
  o.txtHash = 0; for (let i = 0; i < txt.length; i++) o.txtHash = (o.txtHash * 33 + txt.charCodeAt(i)) | 0;
  o.fieldsAll = ed.querySelectorAll('.editor-field').length;
  o.fieldsVis = Array.prototype.filter.call(ed.querySelectorAll('.editor-field'), vis).length;
  o.ctlsVis = Array.prototype.filter.call(ed.querySelectorAll('input,select,textarea'),
    e => e.type !== 'hidden' && vis(e)).length;
  o.labelsVis = Array.prototype.filter.call(ed.querySelectorAll('label'), vis).length;
  o.optionsN = ed.querySelectorAll('option').length;

  o.docScrollW = document.documentElement.scrollWidth;
  o.docClientW = document.documentElement.clientWidth;
  o.hScroll = o.docScrollW > o.docClientW;
  o.bodyScrollW = document.body.scrollWidth;
  o.bodyClientW = document.body.clientWidth;

  /* ── grid columns — EXACTLY the bar's selector ───────────────────────── */
  o.minCol = Infinity; o.colCounts = {}; o.gridDetail = []; o.gridsVis = 0;
  ed.querySelectorAll('.editor-grid').forEach((g) => {
    if (!vis(g)) return;
    o.gridsVis++;
    const cols = getComputedStyle(g).gridTemplateColumns.split(/\s+/).map(parseFloat).filter(isFinite);
    if (!cols.length) return;
    const mn = Math.min.apply(null, cols);
    if (mn < o.minCol) o.minCol = mn;
    o.colCounts[cols.length] = (o.colCounts[cols.length] || 0) + 1;
    if (o.gridDetail.length < 40) o.gridDetail.push({
      owner: (g.closest('details') && g.closest('details').id) || (g.parentElement && (g.parentElement.id || g.parentElement.className || '').toString().slice(0, 24)) || '?',
      n: cols.length, min: +mn.toFixed(1), cols: cols.map(c => +c.toFixed(1)).slice(0, 6) });
  });
  o.minCol = isFinite(o.minCol) ? +o.minCol.toFixed(1) : null;

  /* ── controls ─────────────────────────────────────────────────────────── */
  o.minCtlH = Infinity; o.under28 = []; o.under28N = 0; o.minCtlFont = Infinity; o.ctlFonts = {};
  o.boxMinH = Infinity; o.nonBoxMinH = Infinity;
  ed.querySelectorAll('input,select,textarea').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file' || !vis(el)) return;
    const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return;
    const st = getComputedStyle(el);
    const h = parseFloat(st.height), f = parseFloat(st.fontSize);
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select') {
      if (h < o.minCtlH) o.minCtlH = h;
      if (h < 28) { o.under28N++; if (o.under28.length < 8)
        o.under28.push({ tag, type: el.type, id: el.id || '', h: +h.toFixed(2) }); }
    }
    if (el.type === 'checkbox' || el.type === 'radio') { if (h < o.boxMinH) o.boxMinH = h; }
    else if (h < o.nonBoxMinH) o.nonBoxMinH = h;
    if (f < o.minCtlFont) o.minCtlFont = f;
    const k = f.toFixed(2); o.ctlFonts[k] = (o.ctlFonts[k] || 0) + 1;
  });
  const fin = v => isFinite(v) ? +v.toFixed(2) : null;
  o.minCtlH = fin(o.minCtlH); o.minCtlFont = fin(o.minCtlFont);
  o.boxMinH = fin(o.boxMinH); o.nonBoxMinH = fin(o.nonBoxMinH);

  /* ── labels: three line measures + geometry for every disagreement ───── */
  o.minLabFont = Infinity; o.labFonts = {};
  o.trunc = []; o.truncN = 0;
  o.overRaw = 0; o.overAdj = 0; o.overRect = 0;
  o.clippedY = 0;
  o.labels = [];            /* [text, rectLines, rawLines, adjLines, chars] */
  o.disagree = [];          /* rawLines>2 but rectLines<=2 — with the geometry */
  o.overRectList = [];
  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    const st = getComputedStyle(el);
    const f = parseFloat(st.fontSize);
    if (f < o.minLabFont) o.minLabFont = f;
    const k = f.toFixed(2); o.labFonts[k] = (o.labFonts[k] || 0) + 1;
    const raw = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (el.scrollWidth > el.clientWidth) { o.truncN++;
      if (o.trunc.length < 12) o.trunc.push({ t: raw.slice(0, 44), cw: el.clientWidth, sw: el.scrollWidth }); }
    if (el.scrollHeight > el.clientHeight + 1) o.clippedY++;
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const box = el.getBoundingClientRect().height;
    const inset = parseFloat(st.paddingTop) + parseFloat(st.paddingBottom)
      + parseFloat(st.borderTopWidth) + parseFloat(st.borderBottomWidth);
    const rawLines = Math.max(1, Math.round(box / lh));
    const adjLines = Math.max(1, Math.round((box - inset) / lh));
    /* the honest one: distinct line-box tops of this label's OWN text nodes */
    let rectLines = 1, tops = [];
    try {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!/\S/.test(n.nodeValue || '')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rects = rg.getClientRects();
        for (let i = 0; i < rects.length; i++) if (rects[i].width > 0.5) tops.push(+rects[i].top.toFixed(1));
      }
      tops.sort((a, b) => a - b);
      const tol = Math.max(4, f * 0.5);
      let lines = 0, last = -1e9;
      for (const t of tops) if (t - last > tol) { lines++; last = t; }
      rectLines = Math.max(1, lines);
    } catch (e) {}
    if (rawLines > 2) o.overRaw++;
    if (adjLines > 2) o.overAdj++;
    if (rectLines > 2) { o.overRect++;
      if (o.overRectList.length < 12) o.overRectList.push({ t: raw.slice(0, 56), lines: rectLines, chars: raw.length,
        w: Math.round(el.getBoundingClientRect().width) }); }
    if (rawLines > 2 && rectLines <= 2 && o.disagree.length < 10) {
      o.disagree.push({ t: raw.slice(0, 40), box: +box.toFixed(1), lh: +lh.toFixed(2), inset: +inset.toFixed(1),
        raw: rawLines, adj: adjLines, rect: rectLines, disp: st.display,
        kids: el.children.length, hasBox: !!el.querySelector('input[type="checkbox"],input[type="radio"]') });
    }
    o.labels.push([raw.slice(0, 44), rectLines, rawLines, adjLines, raw.length]);
  });
  o.minLabFont = fin(o.minLabFont);

  /* ── OVERFLOW HUNT ────────────────────────────────────────────────────── */
  o.stickOut = []; o.stickOutN = 0; o.zeroW = []; o.zeroWN = 0;
  if (props) {
    const pr = props.getBoundingClientRect();
    ed.querySelectorAll('.fx-props *').forEach((el) => {
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      if (r.right > pr.right + 2 || r.left < pr.left - 2) {
        o.stickOutN++;
        if (o.stickOut.length < 8) o.stickOut.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 30),
          l: Math.round(r.left), rt: Math.round(r.right), pl: Math.round(pr.left), pr: Math.round(pr.right) });
      }
    });
    Array.prototype.forEach.call(ed.querySelectorAll('.editor-field'), (el) => {
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 40) { o.zeroWN++;
        if (o.zeroW.length < 8) o.zeroW.push({ w: +r.width.toFixed(1), t: (el.textContent || '').trim().slice(0, 36) }); }
    });
  }
  const fulls = Array.prototype.filter.call(ed.querySelectorAll('.editor-field.full'), vis);
  o.fullN = fulls.length;
  o.fullMaxW = fulls.length ? Math.round(Math.max.apply(null, fulls.map(f => f.getBoundingClientRect().width))) : null;
  o.fullMinW = fulls.length ? Math.round(Math.min.apply(null, fulls.map(f => f.getBoundingClientRect().width))) : null;
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
    /* the shared-CSS blast radius: this editor's own grids and checkboxes */
    const grids = Array.prototype.map.call(e0.querySelectorAll('.editor-grid'),
      g => getComputedStyle(g).gridTemplateColumns).slice(0, 4);
    const box = e0.querySelector('input[type="checkbox"]');
    return { n: eds.length, w: +parseFloat(s.width).toFixed(1), maxW: s.maxWidth,
             tpl: s.gridTemplateColumns, fxTwo: e0.classList.contains('fx-two'),
             grids, boxH: box ? getComputedStyle(box).height : null,
             fieldsVis: e0.querySelectorAll('.editor-field').length,
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
      trap.push(a.tagName + (a.id ? '#' + a.id : '') + '{tr:' + s.transform + ';fl:' + s.filter
        + ';ct:' + (s.contain || '-') + ';bd:' + s.backdropFilter + '}');
    }
  }
  const panel = m.firstElementChild;
  const pr = panel ? panel.getBoundingClientRect() : null;
  const out = { present: true, parentTag: m.parentElement ? m.parentElement.tagName : null,
    parentIsBody: m.parentElement === document.body,
    offsetParentIsBody: m.offsetParent === document.body,
    offsetParent: m.offsetParent ? m.offsetParent.tagName : 'null',
    position: st.position, zIndex: st.zIndex,
    rect: { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.top >= -1 && r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    panelRect: pr ? { t: Math.round(pr.top), l: Math.round(pr.left), w: Math.round(pr.width), h: Math.round(pr.height) } : null,
    panelInVp: pr ? (pr.top >= -1 && pr.left >= -1 && pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1) : null,
    vw: innerWidth, vh: innerHeight, trapAncestors: trap };
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
      await page.evaluate(M, { open: OPEN });     /* apply the open-set */
      await page.waitForTimeout(200);
      const m = await page.evaluate(M, { open: OPEN });   /* then measure it settled */
      const f = path.join(SHOTDIR, 'c3-' + TAG + '-' + w + '.png');
      await page.screenshot({ path: f, fullPage: false }); m.shot = f;
      await page.evaluate(() => { const p = document.querySelector('.fx-props'); if (p) p.scrollIntoView({ block: 'start' }); });
      await page.waitForTimeout(150);
      const f2 = path.join(SHOTDIR, 'c3-' + TAG + '-' + w + '-props.png');
      await page.screenshot({ path: f2, fullPage: false }); m.shotProps = f2;
      /* and one deeper in, where the chip strips and the .full blocks live */
      await page.evaluate(() => { const p = document.querySelector('.fx-props'); if (p) scrollBy(0, 900); });
      await page.waitForTimeout(150);
      const f3 = path.join(SHOTDIR, 'c3-' + TAG + '-' + w + '-deep.png');
      await page.screenshot({ path: f3, fullPage: false }); m.shotDeep = f3;
      m.others = await page.evaluate(OTHERS);
      await openCardEditor(page, out.seed.id);
      m.modal = await page.evaluate(MODAL, { cardId: out.seed.id });
      out.widths[w] = m;
    }
    out.pageErrors = errors.slice(0, 6);
  } finally { await close(); }
  console.log('__C3FW__' + JSON.stringify(out));
  for (const w of WIDTHS) {
    const m = out.widths[w] || {};
    console.error(`[${TAG}] ${w} edW=${m.edW}(max ${m.edMaxW}) props=${m.propsScrollH} txt=${m.txtLen} `
      + `fieldsVis=${m.fieldsVis} minCol=${m.minCol} cols=${JSON.stringify(m.colCounts)} `
      + `minCtlH=${m.minCtlH}(u28:${m.under28N}) labFont=${m.minLabFont} ctlFont=${m.minCtlFont} trunc=${m.truncN} `
      + `over[rect/adj/raw]=${m.overRect}/${m.overAdj}/${m.overRaw} clipY=${m.clippedY} stickOut=${m.stickOutN} `
      + `zeroW=${m.zeroWN} hScroll=${m.hScroll} propsTop=${m.propsTop} railH=${m.railH} railReach=${m.railReachable} `
      + `railBelowFold=${m.railCtlBelowFold}/${m.railCtlN}`);
  }
  return out;
};
await run();
