/* ══════════════════════════════════════════════════════════════════════════
   📐 DRIVE-FORGE-WIDTH — the card editor's width, its column count, and the
   legibility floor that stops the density number being bought with small type.

   THE COMPLAINT: "it sprawls, it does not fit the screen, it is hard to find
   anything." The cause is one declaration: `.card-editor { max-width: 900px }`
   (index.html:33895) applies to `.card-editor.fx-two` as well, because the
   fx-two rule (19553) sets display + grid-template-columns and nothing else.
   So on a 2560px monitor the editor is 900px: a fixed 380px asset rail plus
   ~500px of properties holding 343 fields two-abreast at ~230px a column.

   WHAT THIS DRIVER MEASURES, at 1600 / 1280 / 1080 / 720, with a FIXED
   EXPLICIT open-set (identity + kind + effects + on-play open, EVERY other
   <details> in the editor closed — identical on both sides of an A/B, because
   a density comparison across two different open-sets measures nothing):

     · computed width of .card-editor.fx-two
     · .fx-props scrollHeight                     ← the density number
     · documentElement.scrollWidth > clientWidth  ← no horizontal page scroll
     · every .fx-two .editor-grid computed column width
     · min control height, min font-size on labels and controls
     · labels truncated (scrollWidth > clientWidth) and labels past 2 lines
     · the move editor (152511) and event editor (153739) .card-editor widths
     · at 1080/720: .fx-props top, i.e. is the asset rail full-height above it
     · the trait-pool modal's parent, offsetParent and rect

   ⚠ WIDENING ALONE CANNOT MOVE scrollHeight. Wider columns give the same row
     count; only more COLUMNS give fewer rows. That is why the column widths
     are printed per grid rather than just the editor width.

   Run:   node .gauntlet/drive-forge-width.mjs
   A/B:   node .gauntlet/drive-forge-width-ab.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import path from 'node:path';
import fs from 'node:fs';
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const WIDTHS = [1600, 1280, 1080, 720];
const HEIGHT = 1000;
/* The open-set. Named ids, not "expand all": bindCardEditor hides empty
   sections and "all" is therefore a different set on a different card. */
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];
const SHOTDIR = process.env.FORGE_WIDTH_SHOTS
  || path.join(process.env.TEMP || process.env.TMP || '.', 'forge-width-shots');
const TAG = path.basename(process.cwd());

const MEASURE = ({ open }) => {
  const OPENSET = open;
  const vis = (el) => (typeof el.checkVisibility === 'function')
    ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
    : el.offsetParent !== null;
  const ed = document.querySelector('.card-editor.fx-two');
  const o = { ok: !!ed, w: window.innerWidth, h: window.innerHeight };
  if (!ed) return o;

  /* ── the fixed open-set, applied to EVERY <details> in the editor ─────── */
  o.openApplied = []; o.closedApplied = 0; o.detailsTotal = 0;
  ed.querySelectorAll('details').forEach((d) => {
    o.detailsTotal++;
    const want = OPENSET.indexOf(d.id) >= 0;
    d.open = want;
    if (want) o.openApplied.push(d.id + '[display=' + getComputedStyle(d).display + ']');
    else o.closedApplied++;
  });
  o.openMissing = OPENSET.filter(id => !ed.querySelector('#' + id));

  const cs = getComputedStyle(ed);
  o.editorW = Math.round(parseFloat(cs.width) * 10) / 10;
  o.editorMaxW = cs.maxWidth;
  o.editorRectW = Math.round(ed.getBoundingClientRect().width * 10) / 10;
  o.gridTemplate = cs.gridTemplateColumns;

  const props = ed.querySelector('.fx-props');
  const assets = ed.querySelector('.fx-assets');
  o.propsScrollH = props ? props.scrollHeight : -1;
  o.propsTop = props ? Math.round(props.getBoundingClientRect().top) : null;
  o.propsW = props ? Math.round(parseFloat(getComputedStyle(props).width)) : null;
  o.assetsTop = assets ? Math.round(assets.getBoundingClientRect().top) : null;
  o.assetsH = assets ? Math.round(assets.getBoundingClientRect().height) : null;
  o.assetsPos = assets ? getComputedStyle(assets).position : null;
  /* At 1080/720 the media query stacks the columns. "The rail is not
     full-height above the properties" is exactly propsTop < innerHeight. */
  o.propsAboveFold = props ? (props.getBoundingClientRect().top < window.innerHeight) : null;

  o.docScrollW = document.documentElement.scrollWidth;
  o.docClientW = document.documentElement.clientWidth;
  o.hScroll = o.docScrollW > o.docClientW;
  o.bodyScrollW = document.body.scrollWidth;

  /* ── every .fx-two .editor-grid, and its real column widths ───────────── */
  o.grids = []; o.minCol = Infinity; o.colCounts = {};
  ed.querySelectorAll('.editor-grid').forEach((g) => {
    if (!vis(g)) return;
    const t = getComputedStyle(g).gridTemplateColumns;
    const cols = t.split(/\s+/).map(parseFloat).filter(n => isFinite(n));
    if (!cols.length) return;
    const min = Math.min.apply(null, cols);
    o.grids.push({ owner: (g.parentElement && g.parentElement.id) || (g.closest('details') && g.closest('details').id) || '?',
                   n: cols.length, cols: cols.map(c => Math.round(c)), fields: g.children.length });
    if (min < o.minCol) o.minCol = min;
    o.colCounts[cols.length] = (o.colCounts[cols.length] || 0) + 1;
  });
  if (!isFinite(o.minCol)) o.minCol = null; else o.minCol = Math.round(o.minCol * 10) / 10;

  /* ── controls: height and font-size floors ──────────────────────────────
     TWO heights, because the app scales itself. _uiAutoScale (244808) sets
     html{zoom} on any window under 1600px — 0.8 at 1280x1000 — and
     getBoundingClientRect returns DEVICE px, so a 34px control measures 27.5
     there on HEAD and after. getComputedStyle().height is the LAYOUT px the
     rule actually asked for and is the number a layout change can be blamed
     for; both are printed.
     Checkboxes are counted separately: their height is the intrinsic box, not
     a function of the column width, and a bare <input type=checkbox> in this
     editor is 15px on HEAD and 15px after. Folding them into one minimum
     hides every text control behind a number no layout rule can move. */
  o.minCtlH = Infinity; o.minCtlHCss = Infinity; o.minCtlFont = Infinity; o.ctlN = 0; o.shortCtls = [];
  o.minBoxH = Infinity; o.minBoxHCss = Infinity; o.boxN = 0;
  ed.querySelectorAll('input,select,textarea').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file') return;
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const cssH = parseFloat(getComputedStyle(el).height);
    const fs2 = parseFloat(getComputedStyle(el).fontSize);
    const isBox = (el.type === 'checkbox' || el.type === 'radio');
    if (isBox) {
      o.boxN++;
      if (r.height < o.minBoxH) o.minBoxH = r.height;
      if (cssH < o.minBoxHCss) o.minBoxHCss = cssH;
      return;
    }
    o.ctlN++;
    if (r.height < o.minCtlH) o.minCtlH = r.height;
    if (cssH < o.minCtlHCss) o.minCtlHCss = cssH;
    if (fs2 < o.minCtlFont) o.minCtlFont = fs2;
    if (cssH < 28 && o.shortCtls.length < 8) {
      o.shortCtls.push({ id: el.id || el.className || el.tagName, type: el.type || el.tagName,
                         h: Math.round(r.height * 10) / 10, cssH: Math.round(cssH * 10) / 10 });
    }
  });
  const fin = (v, d) => (isFinite(v) ? Math.round(v * d) / d : null);
  o.minCtlH = fin(o.minCtlH, 10); o.minCtlHCss = fin(o.minCtlHCss, 10);
  o.minBoxH = fin(o.minBoxH, 10); o.minBoxHCss = fin(o.minBoxHCss, 10);
  o.minCtlFont = fin(o.minCtlFont, 100);

  /* ── labels: truncation and line count ────────────────────────────────
     Truncation is scrollWidth > clientWidth. Line count is measured two
     ways because one of them lies on the flex labels the editor uses for
     checkbox rows: height/line-height (wrong for a flex row that holds a
     tall checkbox) and the number of distinct line boxes a Range over the
     label's contents produces (wrong when two inline children sit at
     different vertical offsets on the SAME line). A label is only counted
     as over-wrapping when BOTH agree. */
  o.labN = 0; o.minLabFont = Infinity; o.truncated = []; o.wrapped = []; o.maxLines = 0;
  o.wrappedN = 0; o.capN = 0; o.capWrappedN = 0; o.capWrapped = []; o.labels = [];
  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    o.labN++;
    const st = getComputedStyle(el);
    const f = parseFloat(st.fontSize);
    if (f < o.minLabFont) o.minLabFont = f;
    const raw = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const txt = raw.slice(0, 46);
    if (el.scrollWidth > el.clientWidth + 1 && o.truncated.length < 12) {
      o.truncated.push({ t: txt, cls: el.className || '', cw: el.clientWidth, sw: el.scrollWidth });
    }
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const hLines = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
    /* ⚠ TEXT NODES ONLY, and that is not a softening — it is what makes the
       number mean "how many lines does this label read as". A Range over the
       whole label also gets a rect for the <input type=checkbox> and for the
       faction chip's <img>, and those sit at their OWN vertical offset: the
       first version of this counted a one-line chip as two lines and reported
       five "regressions" at 1600 that were the icon, not a wrap. */
    /* ⚠ CLUSTERED, NOT ROUNDED TO A FIXED GRID. Math.round(top / 4) was the
       first version and it invented lines: measured at 1600, "Passive Ability
       ℹ" is ONE 24px-tall line whose two runs sit at y=1734.8 and y=1733.1 —
       1.7px apart, on opposite sides of a bucket boundary — and it counted 2,
       which is how a clean run reported two "regressions" that were a badge
       sitting 1.7px above its own label. A run only opens a new line when it
       is more than 60% of the font size below the last one; a real second line
       is a full line-height (≈15px at 11.52px type) down. */
    let rLines = 1;
    try {
      const tops = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!/\S/.test(n.nodeValue || '')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rects = rg.getClientRects();
        for (let i = 0; i < rects.length; i++) if (rects[i].width > 0) tops.push(rects[i].top);
      }
      tops.sort((x, y) => x - y);
      const tol = Math.max(6, f * 0.6);
      let lines = 0, last = -1e9;
      for (const t of tops) if (t - last > tol) { lines++; last = t; }
      rLines = Math.max(1, lines);
    } catch (e) {}
    /* Two line counts because each lies on a different shape: height /
       line-height is wrong for a flex label holding a tall checkbox, and the
       text-node line boxes still round two stacked runs (a chip's icon caption
       above its name) into separate lines. The smaller of the two is the one
       no shape inflates. */
    const lines = Math.min(hLines, rLines);
    if (lines > o.maxLines) o.maxLines = lines;
    if (lines > 2) {
      o.wrappedN++;
      if (o.wrapped.length < 12) o.wrapped.push({ t: txt, lines, hLines, rLines, cw: el.clientWidth, w: Math.round(el.getBoundingClientRect().width) });
    }
    /* A CAPTION is the uppercase field name a column width governs: a direct
       label of an .editor-field, no control inside it, 60 characters or less.
       The rest are SENTENCES — "🧬 Mutate — play this ON TOP of a unit,
       replacing it…" is 108 characters and cannot be two lines at any column
       width this editor could have. Mixing the two into one number is how a
       legibility floor gets quietly failed by prose. */
    const isCap = el.parentElement && el.parentElement.classList.contains('editor-field')
      && !el.querySelector('input,select,textarea') && raw.length <= 60;
    if (isCap) {
      o.capN++;
      if (lines > 2) { o.capWrappedN++; if (o.capWrapped.length < 10) o.capWrapped.push({ t: txt, lines, cw: el.clientWidth }); }
    }
    /* every label in DOM order, so an A/B can prove no INDIVIDUAL label got
       worse — a falling total can hide one that did. */
    o.labels.push([raw.slice(0, 40), lines]);
  });
  o.minLabFont = isFinite(o.minLabFont) ? Math.round(o.minLabFont * 100) / 100 : null;

  /* ── the .full blocks: how wide does a full-bleed row actually get ─────── */
  const fulls = Array.prototype.filter.call(ed.querySelectorAll('.editor-field.full'), vis);
  o.fullN = fulls.length;
  o.fullMaxW = fulls.length ? Math.round(Math.max.apply(null, fulls.map(f => f.getBoundingClientRect().width))) : null;
  /* the widest single line of PROSE inside a .full — the thing that reads
     badly at 1500px, as opposed to the block itself. */
  let proseMax = 0;
  fulls.forEach((f) => {
    f.querySelectorAll('label,.small-text,span').forEach((n) => {
      if (!vis(n)) return;
      if (n.children.length) return;
      const w = n.getBoundingClientRect().width;
      if ((n.textContent || '').trim().length > 40 && w > proseMax) proseMax = w;
    });
  });
  o.fullProseMaxW = Math.round(proseMax);
  o.fields = ed.querySelectorAll('.editor-field').length;
  o.docScrollH = document.documentElement.scrollHeight;
  return o;
};

const OTHERS = () => {
  const o = {};
  const shot = (which) => {
    App.editingCardId = null; App.editingMoveId = null; App.editingEventId = null;
    App.editingEncounterId = null; App.editingPackId = null; App.editingStructDeckId = null;
    App.editingGuideId = null; App.editingItemId = null; App.editingTutorialId = null;
    App.forgeTab = which === 'move' ? 'moves' : 'events';
    if (which === 'move') App.editingMoveId = 'NEW'; else App.editingEventId = 'NEW';
    try { renderForge(); } catch (e) { return { err: String(e).slice(0, 160) }; }
    const eds = document.querySelectorAll('.card-editor');
    if (!eds.length) return { n: 0 };
    const e0 = eds[0];
    return { n: eds.length, w: Math.round(parseFloat(getComputedStyle(e0).width) * 10) / 10,
             maxW: getComputedStyle(e0).maxWidth, fxTwo: e0.classList.contains('fx-two'),
             hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  };
  o.move = shot('move');
  o.event = shot('event');
  return o;
};

const MODAL = ({ cardId }) => {
  App.editingMoveId = null; App.editingEventId = null;
  App.forgeTab = 'cards'; App.editingCardId = cardId;
  App._traitPoolModal = true;
  try { renderForge(); } catch (e) { return { err: String(e).slice(0, 200) }; }
  const m = document.getElementById('traitpool-backdrop');
  if (!m) { App._traitPoolModal = false; return { present: false }; }
  const r = m.getBoundingClientRect();
  const st = getComputedStyle(m);
  /* Every ancestor of the EDITOR that would re-trap a position:fixed child if
     it grew a transform / filter / contain (150447-150452 documents exactly
     this trap). Reported whether or not the modal is currently parented there. */
  const bad = [];
  let a = document.querySelector('.card-editor');
  for (; a && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none'
        || (s.contain && /paint|layout|strict|content/.test(s.contain))
        || (s.willChange && /transform|filter|perspective/.test(s.willChange))
        || (s.backdropFilter && s.backdropFilter !== 'none')) {
      bad.push((a.tagName + (a.id ? '#' + a.id : '') + (typeof a.className === 'string' && a.className ? '.' + a.className.trim().split(/\s+/)[0] : ''))
        + ' {transform:' + s.transform + ';filter:' + s.filter + ';contain:' + s.contain + ';backdrop-filter:' + s.backdropFilter + '}');
    }
  }
  const out = {
    present: true,
    parentIsBody: m.parentElement === document.body,
    parentTag: m.parentElement ? (m.parentElement.tagName + (m.parentElement.id ? '#' + m.parentElement.id : '')) : null,
    offsetParentIsBody: m.offsetParent === document.body,
    offsetParent: m.offsetParent ? (m.offsetParent.tagName + (m.offsetParent.id ? '#' + m.offsetParent.id : '')) : 'null',
    position: st.position,
    rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.top >= -1 && r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
    vw: window.innerWidth, vh: window.innerHeight,
    trapAncestors: bad,
  };
  App._traitPoolModal = false;
  document.querySelectorAll('#traitpool-backdrop').forEach(n => n.remove());
  return out;
};

/* ── the card under test: a REAL unit card out of the shipped catalogue, so
   every type-gated block the editor can render is really there. Seeded into
   Forge.customCards by value, so both sides of an A/B edit the same card. ── */
const SEED = () => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'fw_probe';
  c.type = 'unit';
  Forge.customCards = [c];
  return { ok: true, id: c.id, name: c.name, keys: Object.keys(c).length };
};

const run = async () => {
  const { page, close, errors } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO,
    viewport: { width: WIDTHS[0], height: HEIGHT } });
  const out = { tag: TAG, cwd: process.cwd(), widths: {}, seed: null, errors: [] };
  try {
    out.seed = await page.evaluate(SEED);
    if (!out.seed.ok) throw new Error('SEED: UNIT_CARDS not reachable');
    fs.mkdirSync(SHOTDIR, { recursive: true });
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: HEIGHT });
      await openCardEditor(page, out.seed.id);
      const m = await page.evaluate(MEASURE, { open: OPEN });
      await page.waitForTimeout(120);
      const m2 = await page.evaluate(MEASURE, { open: OPEN });   // after layout settles
      out.widths[w] = m2;
      out.widths[w].firstPass = { editorW: m.editorW, propsScrollH: m.propsScrollH };
      const f = path.join(SHOTDIR, 'forge-' + TAG + '-' + w + '.png');
      await page.screenshot({ path: f, fullPage: false });
      out.widths[w].shot = f;
      out.widths[w].others = await page.evaluate(OTHERS);
      await openCardEditor(page, out.seed.id);
      out.widths[w].modal = await page.evaluate(MODAL, { cardId: out.seed.id });
    }
    out.pageErrors = errors.slice(0, 6);
  } finally { await close(); }
  console.log('__FW__' + JSON.stringify(out));
  return out;
};

const r = await run();
/* human-readable, for the run that is not being parsed */
for (const w of WIDTHS) {
  const m = r.widths[w] || {};
  console.error(`[${r.tag}] ${w}x${HEIGHT}  editorW=${m.editorW} (max-width:${m.editorMaxW})  propsScrollH=${m.propsScrollH}`
    + `  docH=${m.docScrollH}  minCol=${m.minCol}  colCounts=${JSON.stringify(m.colCounts)}  minCtlHcss=${m.minCtlHCss}`
    + `  minCtlHdev=${m.minCtlH}  minBoxHcss=${m.minBoxHCss}  minLabFont=${m.minLabFont}`
    + `  minCtlFont=${m.minCtlFont}  trunc=${(m.truncated || []).length}  wrapped>2=${m.wrappedN}  capWrapped=${m.capWrappedN}/${m.capN}  hScroll=${m.hScroll}`
    + `  fullMaxW=${m.fullMaxW} fullProse=${m.fullProseMaxW}  propsTop=${m.propsTop}  move=${JSON.stringify(m.others && m.others.move)}`
    + `  event=${JSON.stringify(m.others && m.others.event)}  modal=${m.modal && m.modal.parentIsBody}/${m.modal && m.modal.inViewport}`);
}
