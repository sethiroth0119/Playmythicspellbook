/* ══════════════════════════════════════════════════════════════════════════
   🔎 _CRIT2-FW — SECOND critic, fresh context, own measurement code.
   Deliberately does not import _crit-fw.mjs: every number below is computed
   here so a bug (or a convenient softening) in the first critic's driver
   cannot be inherited. Line counting is done THREE independent ways and all
   three are printed:
     rectLines  — distinct text-rect tops inside the label (Range per text node)
     boxLines   — round(box height / line-height)         [known to count a
                  29px checkbox inside a flex chip as "lines"]
     cloneLines — the label's OWN TEXT re-measured in a throwaway inline span
                  constrained to the label's content width, in the label's own
                  computed font. Immune to flex/checkbox geometry AND to
                  rect-merging: it asks "does this sentence fit two lines in
                  the space this label has?".
   Run:  node .gauntlet/_crit2-fw.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import path from 'node:path';
import fs from 'node:fs';
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const WIDTHS = [1600, 1280, 1080, 720];
const HEIGHT = 1000;
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];
const SHOTDIR = process.env.C2FW_SHOTS
  || path.join(process.env.TEMP || process.env.TMP || '.', 'crit2-fw-shots');
const TAG = process.env.C2FW_TAG || path.basename(process.cwd());

const SEED = () => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'c2_probe'; c.type = 'unit';
  Forge.customCards = [c];
  return { ok: true, id: c.id, name: c.name, srcName: src.name, keys: Object.keys(c).length };
};

const MEASURE = ({ open }) => {
  const CV = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  const vis = (el) => (typeof el.checkVisibility === 'function') ? el.checkVisibility(CV)
    : el.offsetParent !== null;
  const num = (v) => { const f = parseFloat(v); return isFinite(f) ? +f.toFixed(2) : null; };
  const ed = document.querySelector('.card-editor.fx-two');
  const o = { vw: innerWidth, vh: innerHeight, editorCount: document.querySelectorAll('.card-editor').length };
  if (!ed) { o.NOEDITOR = true; return o; }

  /* ── the fixed explicit open-set, applied here and reported back ──────── */
  o.details = []; o.openApplied = []; o.closedN = 0;
  ed.querySelectorAll('details').forEach((d) => {
    const want = open.indexOf(d.id) >= 0;
    d.open = want;
    o.details.push(d.id || '(no id)');
    if (want) o.openApplied.push(d.id); else o.closedN++;
  });
  o.openMissing = open.filter(id => !ed.querySelector('#' + id));
  /* …and PROOF the opened ones actually render content, so "open" cannot mean
     "open and empty". */
  o.openVisFields = o.openApplied.map(id => {
    const d = ed.querySelector('#' + id);
    const disp = getComputedStyle(d).display;
    const r = d.getBoundingClientRect();
    const n = Array.prototype.filter.call(d.querySelectorAll('.editor-field'), vis).length;
    return id + ':' + disp + ':h' + Math.round(r.height) + ':' + n + 'f';
  });

  const cs = getComputedStyle(ed);
  o.editorW = num(cs.width);
  o.editorMaxW = cs.maxWidth;
  o.editorTpl = cs.gridTemplateColumns;
  o.editorRectW = +ed.getBoundingClientRect().width.toFixed(1);

  /* ── anti-cheat: nothing scaled, faded, hidden or clipped ─────────────── */
  o.chain = [];
  for (const sel of ['html', 'body', '#app', '.card-editor.fx-two', '.fx-props', '.fx-assets']) {
    const n = document.querySelector(sel);
    if (!n) { o.chain.push(sel + ':MISSING'); continue; }
    const s = getComputedStyle(n);
    o.chain.push(sel + ' zoom=' + s.zoom + ' tf=' + s.transform + ' op=' + s.opacity + ' vis=' + s.visibility
      + ' filter=' + s.filter + ' contain=' + (s.contain || '-') + ' ovf=' + s.overflow
      + ' disp=' + s.display + ' fs=' + s.fontSize);
  }

  const props = ed.querySelector('.fx-props');
  const assets = ed.querySelector('.fx-assets');
  o.propsScrollH = props ? props.scrollHeight : -1;
  o.propsClientH = props ? props.clientHeight : -1;
  o.propsScrollW = props ? props.scrollWidth : -1;
  o.propsClientW = props ? props.clientWidth : -1;
  o.propsW = props ? num(getComputedStyle(props).width) : null;
  o.propsTop = props ? Math.round(props.getBoundingClientRect().top) : null;
  o.assetsH = assets ? Math.round(assets.getBoundingClientRect().height) : null;
  o.assetsTop = assets ? Math.round(assets.getBoundingClientRect().top) : null;
  o.assetsMaxH = assets ? getComputedStyle(assets).maxHeight : null;
  o.assetsPos = assets ? getComputedStyle(assets).position : null;

  /* content preserved */
  const txt = props ? (props.innerText || '').replace(/\s+/g, ' ').trim() : '';
  o.txtLen = txt.length;
  let h = 0; for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) | 0;
  o.txtHash = h;
  o.fieldsAll = ed.querySelectorAll('.editor-field').length;
  o.fieldsVis = Array.prototype.filter.call(ed.querySelectorAll('.editor-field'), vis).length;
  o.labelsVis = Array.prototype.filter.call(ed.querySelectorAll('label'), vis).length;
  o.ctlsVis = Array.prototype.filter.call(ed.querySelectorAll('input,select,textarea'),
    e => e.type !== 'hidden' && vis(e)).length;

  o.docScrollW = document.documentElement.scrollWidth;
  o.docClientW = document.documentElement.clientWidth;
  o.hScroll = o.docScrollW > o.docClientW;
  o.bodyScrollW = document.body.scrollWidth;

  /* ── every .fx-two .editor-grid computed column ───────────────────────── */
  o.minCol = Infinity; o.minColWhere = null; o.colCounts = {}; o.gridN = 0; o.gridHidden = 0;
  o.grids = [];
  ed.querySelectorAll('.editor-grid').forEach((g) => {
    if (!vis(g)) { o.gridHidden++; return; }
    const tpl = getComputedStyle(g).gridTemplateColumns;
    const cols = tpl.split(/\s+/).map(parseFloat).filter(x => isFinite(x));
    if (!cols.length) return;
    o.gridN++;
    const mn = Math.min.apply(null, cols);
    o.colCounts[cols.length] = (o.colCounts[cols.length] || 0) + 1;
    const owner = (g.closest('details') && g.closest('details').id) || (g.parentElement && g.parentElement.className) || '?';
    if (o.grids.length < 30) o.grids.push({ owner: String(owner).slice(0, 24), n: cols.length, min: +mn.toFixed(1) });
    if (mn < o.minCol) { o.minCol = mn; o.minColWhere = String(owner).slice(0, 40) + ' n=' + cols.length + ' tpl=' + tpl.slice(0, 80); }
  });
  o.minCol = isFinite(o.minCol) ? +o.minCol.toFixed(1) : null;

  /* ── controls ─────────────────────────────────────────────────────────── */
  o.minCtlH = Infinity; o.under28 = []; o.under28N = 0; o.minCtlFont = Infinity; o.ctlFonts = {};
  o.minNonBoxH = Infinity; o.minBoxH = Infinity;
  ed.querySelectorAll('input,select,textarea').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file') return;
    if (!vis(el)) return;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
    const st = getComputedStyle(el);
    const hh = parseFloat(st.height), f = parseFloat(st.fontSize);
    const tag = el.tagName.toLowerCase();
    const box = el.type === 'checkbox' || el.type === 'radio';
    if (tag === 'input' || tag === 'select') {
      if (hh < o.minCtlH) o.minCtlH = hh;
      if (hh < 28) { o.under28N++; if (o.under28.length < 8) o.under28.push(tag + '/' + el.type + '=' + hh.toFixed(2) + ' id=' + (el.id || '-')); }
    }
    if (box) { if (hh < o.minBoxH) o.minBoxH = hh; } else if (hh < o.minNonBoxH) o.minNonBoxH = hh;
    if (f < o.minCtlFont) o.minCtlFont = f;
    const k = f.toFixed(2); o.ctlFonts[k] = (o.ctlFonts[k] || 0) + 1;
  });
  const fin = v => isFinite(v) ? +v.toFixed(2) : null;
  o.minCtlH = fin(o.minCtlH); o.minCtlFont = fin(o.minCtlFont);
  o.minNonBoxH = fin(o.minNonBoxH); o.minBoxH = fin(o.minBoxH);

  /* ── labels: truncation + THREE line measures ─────────────────────────── */
  o.minLabFont = Infinity; o.labFonts = {}; o.trunc = []; o.truncN = 0;
  o.rectOver2 = 0; o.boxOver2 = 0; o.cloneOver2 = 0; o.bothOver2 = 0;
  o.overRect = []; o.overClone = []; o.labels = [];
  /* one ruler, reused: an inline-block span in the label's own font, given the
     label's own content width, holding the label's own text. */
  const ruler = document.createElement('span');
  ruler.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;display:block;';
  document.body.appendChild(ruler);
  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    const st = getComputedStyle(el);
    const f = parseFloat(st.fontSize);
    if (f < o.minLabFont) o.minLabFont = f;
    const fk = f.toFixed(2); o.labFonts[fk] = (o.labFonts[fk] || 0) + 1;
    const raw = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (el.scrollWidth > el.clientWidth) {
      o.truncN++;
      if (o.trunc.length < 12) o.trunc.push({ t: raw.slice(0, 44), cw: el.clientWidth, sw: el.scrollWidth });
    }
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const boxL = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
    /* rect measure */
    let rectL = 1;
    try {
      const tops = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!/\S/.test(n.nodeValue || '')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rc = rg.getClientRects();
        for (let i = 0; i < rc.length; i++) if (rc[i].width > 0) tops.push(rc[i].top);
      }
      tops.sort((a, b) => a - b);
      const tol = Math.max(6, f * 0.6);
      let lines = 0, last = -1e9;
      for (const t of tops) if (t - last > tol) { lines++; last = t; }
      rectL = Math.max(1, lines);
    } catch (e) {}
    /* THIRD measure — the vertical SPAN the label's own text occupies, in line
       heights. Independent of both: it does not group tops (so a tolerance
       cannot merge two rows) and it does not use the box (so a 29px checkbox
       inside a flex chip cannot inflate it). A label whose text really runs
       three rows spans >2 line heights whatever the rows are made of.
       ⚠ The first version of this third measure re-typeset the label's whole
         textContent into a ruler span. It over-counted wildly (a chip row of
         eight radio labels concatenates to 122 characters that are never on
         one line in the DOM, and subtracting the children's widths floored the
         available width at 40px). Recorded here because that wrong number is
         what a critic would otherwise have reported as 20 failures at 1600. */
    let cloneL = 1, avail = 0;
    try {
      const tops = [], bots = [];
      const w2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w2.nextNode(); n; n = w2.nextNode()) {
        if (!/\S/.test(n.nodeValue || '')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rc = rg.getClientRects();
        for (let i = 0; i < rc.length; i++) if (rc[i].width > 0) { tops.push(rc[i].top); bots.push(rc[i].bottom); }
      }
      if (tops.length) {
        const span = Math.max.apply(null, bots) - Math.min.apply(null, tops);
        avail = Math.round(span);
        cloneL = Math.max(1, Math.round(span / lh));
      }
    } catch (e) {}
    if (rectL > 2) { o.rectOver2++; if (o.overRect.length < 10) o.overRect.push({ t: raw.slice(0, 50), rect: rectL, box: boxL, clone: cloneL, len: raw.length, cw: el.clientWidth }); }
    if (boxL > 2) o.boxOver2++;
    if (cloneL > 2) { o.cloneOver2++; if (o.overClone.length < 10) o.overClone.push({ t: raw.slice(0, 50), rect: rectL, clone: cloneL, avail: Math.round(avail), len: raw.length }); }
    if (rectL > 2 && cloneL > 2) o.bothOver2++;
    o.labels.push([raw.slice(0, 44), rectL, boxL, cloneL, raw.length]);
  });
  ruler.remove();
  o.minLabFont = fin(o.minLabFont);

  const fulls = Array.prototype.filter.call(ed.querySelectorAll('.editor-field.full'), vis);
  o.fullN = fulls.length;
  o.fullMaxW = fulls.length ? Math.round(Math.max.apply(null, fulls.map(x => x.getBoundingClientRect().width))) : null;
  o.fullMinW = fulls.length ? Math.round(Math.min.apply(null, fulls.map(x => x.getBoundingClientRect().width))) : null;
  /* narrowest VISIBLE field of any kind — the clause is about columns, but a
     260px column holding a 120px cell is still an illegible cell. */
  const fieldsV = Array.prototype.filter.call(ed.querySelectorAll('.editor-field'), vis);
  o.minFieldW = fieldsV.length ? +Math.min.apply(null, fieldsV.map(x => x.getBoundingClientRect().width)).toFixed(1) : null;

  /* ── ink: is anything actually drawn where the editor says it is? ─────── */
  o.hit = { sampled: 0, painted: 0, blockers: [] };
  const sample = fieldsV.slice(0, 40);
  for (const n of sample) {
    const r = n.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    const x = Math.min(Math.max((Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max((Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2, 0), innerHeight - 1);
    o.hit.sampled++;
    const top = document.elementFromPoint(x, y);
    if (top && (top === n || n.contains(top) || top.contains(n))) o.hit.painted++;
    else if (o.hit.blockers.length < 4) o.hit.blockers.push(top ? (top.tagName + (top.id ? '#' + top.id : '') + '.' + String(top.className || '').slice(0, 24)) : 'null');
  }
  /* text colour vs background of the first few labels — the "transparent text"
     cheat a critic used earlier in this run. */
  o.inkColors = [];
  Array.prototype.slice.call(ed.querySelectorAll('label')).filter(vis).slice(0, 4).forEach((l) => {
    const s = getComputedStyle(l);
    o.inkColors.push(s.color + ' / bg ' + s.backgroundColor + ' / op ' + s.opacity);
  });
  return o;
};

const OTHERS = () => {
  const one = (which) => {
    App.editingCardId = null; App.editingMoveId = null; App.editingEventId = null;
    App.editingEncounterId = null; App.editingPackId = null; App.editingStructDeckId = null;
    App.editingGuideId = null; App.editingItemId = null; App.editingTutorialId = null;
    App.forgeTab = which === 'move' ? 'moves' : 'events';
    if (which === 'move') App.editingMoveId = 'NEW'; else App.editingEventId = 'NEW';
    try { renderForge(); } catch (e) { return { err: String(e).slice(0, 200) }; }
    const eds = document.querySelectorAll('.card-editor');
    if (!eds.length) return { n: 0 };
    const s = getComputedStyle(eds[0]);
    return { n: eds.length, w: +parseFloat(s.width).toFixed(1), maxW: s.maxWidth,
             fxTwo: eds[0].classList.contains('fx-two'), tpl: s.gridTemplateColumns.slice(0, 40),
             hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  };
  return { move: one('move'), event: one('event') };
};

const MODAL = ({ cardId }) => {
  App.editingMoveId = null; App.editingEventId = null;
  App.forgeTab = 'cards'; App.editingCardId = cardId;
  App._traitPoolModal = true;
  try { renderForge(); } catch (e) { return { err: String(e).slice(0, 200) }; }
  const m = document.getElementById('traitpool-backdrop');
  if (!m) { App._traitPoolModal = false; return { present: false }; }
  const r = m.getBoundingClientRect(), st = getComputedStyle(m);
  /* every ancestor of the EDITOR that would re-trap a fixed child */
  const traps = [];
  for (let a = document.querySelector('.card-editor'); a && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    const bad = s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none'
      || (s.contain && /paint|layout|strict|content/.test(s.contain))
      || (s.willChange && /transform|filter|perspective/.test(s.willChange))
      || (s.backdropFilter && s.backdropFilter !== 'none');
    if (bad) traps.push(a.tagName + (a.id ? '#' + a.id : '') + ' tf=' + s.transform + ' filter=' + s.filter + ' contain=' + (s.contain || '-'));
  }
  const out = { present: true,
    parentIsBody: m.parentElement === document.body,
    parentTag: m.parentElement ? m.parentElement.tagName + (m.parentElement.id ? '#' + m.parentElement.id : '') : null,
    offsetParentIsBody: m.offsetParent === document.body,
    offsetParent: m.offsetParent ? m.offsetParent.tagName : 'null',
    position: st.position, zIndex: st.zIndex,
    rect: { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.top >= -1 && r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    vw: innerWidth, vh: innerHeight, traps };
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
      await page.evaluate(MEASURE, { open: OPEN });     // apply open-set
      await page.waitForTimeout(200);
      const m = await page.evaluate(MEASURE, { open: OPEN });   // measure settled
      const f = path.join(SHOTDIR, TAG + '-' + w + '-top.png');
      await page.screenshot({ path: f });
      m.shotTop = f; m.shotTopBytes = fs.statSync(f).size;
      await page.evaluate(() => { const p = document.querySelector('.fx-props'); if (p) p.scrollIntoView({ block: 'start' }); });
      await page.waitForTimeout(150);
      const f2 = path.join(SHOTDIR, TAG + '-' + w + '-props.png');
      await page.screenshot({ path: f2 });
      m.shotProps = f2; m.shotPropsBytes = fs.statSync(f2).size;
      m.others = await page.evaluate(OTHERS);
      await openCardEditor(page, out.seed.id);
      m.modal = await page.evaluate(MODAL, { cardId: out.seed.id });
      out.widths[w] = m;
    }
    out.pageErrors = errors.slice(0, 8);
  } finally { await close(); }
  console.log('__C2FW__' + JSON.stringify(out));
  for (const w of WIDTHS) {
    const m = out.widths[w] || {};
    console.error(`[${TAG}] ${w}  edW=${m.editorW}(max ${m.editorMaxW}) props=${m.propsScrollH} txt=${m.txtLen}/${m.txtHash} `
      + `fieldsVis=${m.fieldsVis} labels=${m.labelsVis} ctls=${m.ctlsVis} minCol=${m.minCol} cols=${JSON.stringify(m.colCounts)} `
      + `minCtlH=${m.minCtlH}(u28:${m.under28N}) labFont=${m.minLabFont} ctlFont=${m.minCtlFont} trunc=${m.truncN} `
      + `over2 rect/box/clone=${m.rectOver2}/${m.boxOver2}/${m.cloneOver2} hScroll=${m.hScroll} propsTop=${m.propsTop} `
      + `minFieldW=${m.minFieldW} hit=${m.hit && m.hit.painted}/${m.hit && m.hit.sampled} shot=${m.shotTopBytes}B`);
  }
  return out;
};
await run();
