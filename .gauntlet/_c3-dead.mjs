/* 🔎 _C3-DEAD — the two questions the bar does not ask but an owner would.
   1. DEAD SPACE: `grid-column: span 2` puts a .full block in a row with a
      neighbour, and a grid item stretches to the row. The 1600 screenshot
      shows a ~200px bordered "🧬 Mutate" box holding one checkbox and one
      line of text. Is that box TALLER than it was, i.e. did this change buy
      density by leaving holes? Measured as (block height - the height its own
      children actually occupy), summed over every visible .full block.
   2. THE OTHER CARD TYPES + EVERY SECTION OPEN: the fixed open-set is one
      unit card. A spell and a trap with every <details> open is where a
      re-layout usually breaks something the bar cannot see.
   Run: node .gauntlet/_c3-dead.mjs      prints __C3DEAD__<json>            */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';
import path from 'node:path';

const TAG = path.basename(process.cwd());
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];

const SEED = ({ type }) => {
  const pools = { unit: typeof UNIT_CARDS !== 'undefined' ? UNIT_CARDS : [],
                  spell: typeof SPELL_CARDS !== 'undefined' ? SPELL_CARDS : [],
                  trap: typeof TRAP_CARDS !== 'undefined' ? TRAP_CARDS : [] };
  const src = (pools[type] || [])[0];
  if (!src) return { ok: false, type };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'c3_' + type; c.type = type;
  Forge.customCards = [c];
  return { ok: true, id: c.id, type };
};

const DEAD = ({ open, all }) => {
  const vis = el => typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
    : el.offsetParent !== null;
  const ed = document.querySelector('.card-editor.fx-two');
  if (!ed) return { ok: false };
  ed.querySelectorAll('details').forEach(d => { d.open = all ? true : open.indexOf(d.id) >= 0; });
  const o = { ok: true, vw: innerWidth };
  const props = ed.querySelector('.fx-props');
  o.propsScrollH = props ? props.scrollHeight : -1;
  const own = (el) => {   /* how far down this element's own content reaches */
    let bottom = el.getBoundingClientRect().top;
    el.querySelectorAll('*').forEach((k) => {
      if (!vis(k)) return;
      const r = k.getBoundingClientRect();
      if (r.height > 0 && r.bottom > bottom) bottom = r.bottom;
    });
    return bottom;
  };
  o.deadTotal = 0; o.worst = []; o.fullN = 0; o.fullH = 0;
  Array.prototype.forEach.call(ed.querySelectorAll('.editor-field.full'), (f) => {
    if (!vis(f)) return;
    const r = f.getBoundingClientRect();
    const dead = Math.max(0, Math.round(r.bottom - own(f)));
    o.fullN++; o.fullH += Math.round(r.height); o.deadTotal += dead;
    if (dead > 40) o.worst.push({ t: (f.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34),
      h: Math.round(r.height), dead, w: Math.round(r.width) });
  });
  o.worst.sort((a, b) => b.dead - a.dead); o.worst = o.worst.slice(0, 8);
  /* every visible field, not just .full */
  o.deadAll = 0; o.fieldsVis = 0;
  Array.prototype.forEach.call(ed.querySelectorAll('.editor-field'), (f) => {
    if (!vis(f)) return;
    o.fieldsVis++;
    o.deadAll += Math.max(0, Math.round(f.getBoundingClientRect().bottom - own(f)));
  });
  /* narrowest visible field + anything sticking out, for the all-open sweep */
  o.minFieldW = Infinity; o.trunc = 0; o.stickOut = 0; o.zeroW = 0;
  const pr = props ? props.getBoundingClientRect() : null;
  Array.prototype.forEach.call(ed.querySelectorAll('.editor-field'), (f) => {
    if (!vis(f)) return;
    const r = f.getBoundingClientRect();
    if (r.width < o.minFieldW) o.minFieldW = r.width;
    if (r.width < 40) o.zeroW++;
    if (pr && (r.right > pr.right + 2 || r.left < pr.left - 2)) o.stickOut++;
  });
  o.minFieldW = isFinite(o.minFieldW) ? +o.minFieldW.toFixed(1) : null;
  o.minCol = Infinity;
  ed.querySelectorAll('.editor-grid').forEach((g) => {
    if (!vis(g)) return;
    const cols = getComputedStyle(g).gridTemplateColumns.split(/\s+/).map(parseFloat).filter(isFinite);
    if (cols.length) o.minCol = Math.min(o.minCol, Math.min.apply(null, cols));
  });
  o.minCol = isFinite(o.minCol) ? +o.minCol.toFixed(1) : null;
  o.overRect = 0; o.truncN = 0; o.minCtlH = Infinity; o.labelsVis = 0;
  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    o.labelsVis++;
    if (el.scrollWidth > el.clientWidth) o.truncN++;
    const st = getComputedStyle(el); const f = parseFloat(st.fontSize);
    let tops = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!/\S/.test(n.nodeValue || '')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rects = rg.getClientRects();
      for (let i = 0; i < rects.length; i++) if (rects[i].width > 0.5) tops.push(rects[i].top);
    }
    tops.sort((a, b) => a - b);
    const tol = Math.max(4, f * 0.5); let lines = 0, last = -1e9;
    for (const t of tops) if (t - last > tol) { lines++; last = t; }
    if (lines > 2) o.overRect++;
  });
  ed.querySelectorAll('input,select').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file' || !vis(el)) return;
    const h = parseFloat(getComputedStyle(el).height);
    if (h < o.minCtlH) o.minCtlH = h;
  });
  o.minCtlH = isFinite(o.minCtlH) ? +o.minCtlH.toFixed(2) : null;
  return o;
};

const run = async () => {
  const { page, close, errors } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO,
    viewport: { width: 1600, height: 1000 } });
  const out = { tag: TAG, cwd: process.cwd(), r: {} };
  try {
    for (const type of ['unit', 'spell', 'trap']) {
      const seed = await page.evaluate(SEED, { type });
      if (!seed.ok) { out.r[type] = { seedFailed: true }; continue; }
      for (const w of [1600, 1080]) {
        await page.setViewportSize({ width: w, height: 1000 });
        for (const all of [false, true]) {
          await openCardEditor(page, seed.id);
          await page.evaluate(DEAD, { open: OPEN, all });
          await page.waitForTimeout(150);
          out.r[type + '@' + w + (all ? '/ALLOPEN' : '/FIXED')] = await page.evaluate(DEAD, { open: OPEN, all });
        }
      }
    }
    out.pageErrors = errors.slice(0, 6);
  } finally { await close(); }
  console.log('__C3DEAD__' + JSON.stringify(out));
  for (const k of Object.keys(out.r)) {
    const m = out.r[k];
    console.error(`[${TAG}] ${k} props=${m.propsScrollH} fullN=${m.fullN} fullH=${m.fullH} dead=${m.deadTotal} `
      + `deadAll=${m.deadAll} minCol=${m.minCol} minFieldW=${m.minFieldW} trunc=${m.truncN} over2=${m.overRect}/${m.labelsVis} `
      + `stickOut=${m.stickOut} zeroW=${m.zeroW} minCtlH=${m.minCtlH} worst=${JSON.stringify((m.worst || []).slice(0, 3))}`);
  }
};
await run();
