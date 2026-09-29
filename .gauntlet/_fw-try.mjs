/* 🧪 _FW-TRY — price a CSS candidate WITHOUT editing the 15 MB index.html.
   Injects the rules in .gauntlet/_fw-try.css on top of the live page and
   reports the same numbers the bar asks for, at all four widths. Editing
   index.html to try an idea costs a 15 MB rewrite and a reboot per idea; this
   costs one page load for the whole sweep, so candidates get PRICED instead of
   argued. It proves nothing on its own — the real verdict is _crit-fw.mjs on
   the written bytes — it only says which candidate is worth writing.
   Run: node .gauntlet/_fw-try.mjs [cssfile]                                  */
import fs from 'node:fs';
import path from 'node:path';
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const WIDTHS = [1600, 1280, 1080, 720];
const HEIGHT = 1000;
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];
const FILES = process.argv.slice(2).length ? process.argv.slice(2)
  : [path.join(REPO, '.gauntlet', '_fw-try.css')];
const CANDS = FILES.filter(f => fs.existsSync(f)).map(f => ({ name: path.basename(f), css: fs.readFileSync(f, 'utf8') }));

const SEED = () => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'fw_probe'; c.type = 'unit';
  Forge.customCards = [c];
  return { ok: true, id: c.id };
};

const APPLY = ({ css }) => {
  let s = document.getElementById('__fwtry');
  if (!s) { s = document.createElement('style'); s.id = '__fwtry'; document.head.appendChild(s); }
  s.textContent = css;
  return document.getElementById('__fwtry').textContent.length;
};

const M = ({ open }) => {
  const vis = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const ed = document.querySelector('.card-editor.fx-two');
  if (!ed) return { ok: false };
  ed.querySelectorAll('details').forEach(d => { d.open = open.indexOf(d.id) >= 0; });
  const cs = getComputedStyle(ed);
  const props = ed.querySelector('.fx-props');
  const assets = ed.querySelector('.fx-assets');
  const o = { ok: true, vw: innerWidth,
    editorW: +parseFloat(cs.width).toFixed(1), maxW: cs.maxWidth,
    propsH: props ? props.scrollHeight : -1,
    propsTop: props ? Math.round(props.getBoundingClientRect().top) : null,
    propsScrollW: props ? props.scrollWidth : -1, propsClientW: props ? props.clientWidth : -1,
    assetsH: assets ? Math.round(assets.getBoundingClientRect().height) : null,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    textLen: props ? (props.innerText || '').replace(/\s+/g, ' ').trim().length : -1,
    fieldsVis: 0, ctlsVis: 0, labelsVis: 0 };
  o.fieldsVis = [...ed.querySelectorAll('.editor-field')].filter(vis).length;
  o.ctlsVis = [...ed.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'hidden' && vis(e)).length;

  o.minCol = Infinity; o.colCounts = {};
  ed.querySelectorAll('.editor-grid').forEach((g) => {
    if (!vis(g)) return;
    const cols = getComputedStyle(g).gridTemplateColumns.split(/\s+/).map(parseFloat).filter(isFinite);
    if (!cols.length) return;
    const mn = Math.min(...cols);
    if (mn < o.minCol) o.minCol = mn;
    o.colCounts[cols.length] = (o.colCounts[cols.length] || 0) + 1;
  });
  o.minCol = isFinite(o.minCol) ? +o.minCol.toFixed(1) : null;

  o.rawUnder28 = 0; o.nonBoxMinH = Infinity; o.boxMinH = Infinity; o.minCtlFont = Infinity;
  ed.querySelectorAll('input,select,textarea').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file' || !vis(el)) return;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
    const st = getComputedStyle(el); const h = parseFloat(st.height); const f = parseFloat(st.fontSize);
    const tag = el.tagName.toLowerCase();
    if ((tag === 'input' || tag === 'select') && h < 28) o.rawUnder28++;
    if (el.type === 'checkbox' || el.type === 'radio') o.boxMinH = Math.min(o.boxMinH, h);
    else o.nonBoxMinH = Math.min(o.nonBoxMinH, h);
    o.minCtlFont = Math.min(o.minCtlFont, f);
  });

  o.trunc = 0; o.over2h = 0; o.over2r = 0; o.over2min = 0; o.minLabFont = Infinity;
  o.worst = [];
  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    const st = getComputedStyle(el); const f = parseFloat(st.fontSize);
    o.minLabFont = Math.min(o.minLabFont, f);
    if (el.scrollWidth > el.clientWidth) o.trunc++;
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const hL = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
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
    if (hL > 2) o.over2h++; if (rL > 2) o.over2r++;
    const mn = Math.min(hL, rL);
    if (mn > 2) { o.over2min++; if (o.worst.length < 12) o.worst.push(
      `${hL}h/${rL}r w=${Math.round(el.getBoundingClientRect().width)} :: ${(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,50)}`); }
  });
  const fin = v => isFinite(v) ? +v.toFixed(2) : null;
  o.nonBoxMinH = fin(o.nonBoxMinH); o.boxMinH = fin(o.boxMinH);
  o.minCtlFont = fin(o.minCtlFont); o.minLabFont = fin(o.minLabFont);

  const fulls = [...ed.querySelectorAll('.editor-field.full')].filter(vis);
  o.fullN = fulls.length;
  o.fullMaxW = fulls.length ? Math.round(Math.max(...fulls.map(f => f.getBoundingClientRect().width))) : null;
  o.proseGap = 0;
  fulls.forEach((el) => {
    const st = getComputedStyle(el);
    if (parseFloat(st.borderTopWidth) < 0.5) return;
    const r = el.getBoundingClientRect();
    let inner = 0;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!/\S/.test(n.nodeValue || '')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rects = rg.getClientRects();
      for (let i = 0; i < rects.length; i++) inner = Math.max(inner, rects[i].right - r.left);
    }
    if (r.width - inner > 80) { o.proseGap++;
      if (!o.proseList) o.proseList = [];
      if (o.proseList.length < 8) o.proseList.push(`w=${Math.round(r.width)} textRight=${Math.round(inner)} `
        + `kids=[${[...el.children].map(k => k.tagName.toLowerCase() + (k.className && typeof k.className === 'string' ? '.' + k.className.trim().split(/\s+/)[0] : '')).slice(0, 6).join(',')}] `
        + `:: ${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 46)}`); }
  });
  return o;
};

const run = async () => {
  const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO,
    viewport: { width: WIDTHS[0], height: HEIGHT } });
  try {
    const seed = await page.evaluate(SEED);
    if (!seed.ok) throw new Error('seed failed');
    for (const cand of [{ name: 'BASELINE = written bytes', css: '' }, ...CANDS]) {
      console.log('\n########## ' + cand.name + ' ##########');
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: HEIGHT });
        await openCardEditor(page, seed.id);
        await page.evaluate(APPLY, { css: cand.css });
        await page.evaluate(M, { open: OPEN });
        await page.waitForTimeout(140);
        const m = await page.evaluate(M, { open: OPEN });
        console.log(`${w}  edW=${m.editorW}(${m.maxW}) props=${m.propsH} minCol=${m.minCol} cols=${JSON.stringify(m.colCounts)}`
          + ` over2=${m.over2min}(h${m.over2h}/r${m.over2r}) trunc=${m.trunc} under28=${m.rawUnder28} boxH=${m.boxMinH} nonBoxH=${m.nonBoxMinH}`
          + ` labF=${m.minLabFont} ctlF=${m.minCtlFont} hScroll=${m.hScroll} propsTop=${m.propsTop} fullMaxW=${m.fullMaxW}`
          + ` proseGap=${m.proseGap} txt=${m.textLen} fields=${m.fieldsVis} ctls=${m.ctlsVis} propsSW/CW=${m.propsScrollW}/${m.propsClientW}`);
        if (process.env.FW_WORST) m.worst.forEach(x => console.log('      ' + x));
        if (process.env.FW_PROSE && m.proseList) m.proseList.forEach(x => console.log('   ~~ ' + x));
      }
    }
  } finally { await close(); }
};
await run();
