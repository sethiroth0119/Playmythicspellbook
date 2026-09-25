/* 🔬 _FW-PROBE-GAPS — names the two clauses the Round-1 build did NOT meet.
   Not a verdict tool: it DUMPS the offending elements (text, ids, ancestry,
   geometry, the CSS that sized them) so a fix can be aimed rather than
   guessed. Run: node .gauntlet/_fw-probe-gaps.mjs                          */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const WIDTHS = [1600, 1280, 1080, 720];
const HEIGHT = 1000;
const OPEN = ['fx-identity', 'fx-kind', 'fx-effects', 'fx-onplay'];

const SEED = () => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'fw_probe'; c.type = 'unit';
  Forge.customCards = [c];
  return { ok: true, id: c.id };
};

const P = ({ open }) => {
  const vis = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const ed = document.querySelector('.card-editor.fx-two');
  if (!ed) return { ok: false };
  ed.querySelectorAll('details').forEach(d => { d.open = open.indexOf(d.id) >= 0; });
  const chain = (el) => { const a = []; for (let n = el; n && n !== ed; n = n.parentElement)
    a.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''));
    return a.slice(0, 5).join(' < '); };

  const out = { ok: true, vw: innerWidth, labels: [], boxes: [], fulls: [] };

  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    const st = getComputedStyle(el);
    const f = parseFloat(st.fontSize);
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const hL = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
    let rL = 1;
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
    const mn = Math.min(hL, rL);
    if (mn > 2) out.labels.push({ t: (el.textContent || '').trim().replace(/\s+/g, ' '),
      len: (el.textContent || '').trim().replace(/\s+/g, ' ').length,
      hL, rL, w: Math.round(el.getBoundingClientRect().width), lh: +lh.toFixed(1), f,
      chain: chain(el.parentElement) });
  });

  ed.querySelectorAll('input,select').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file' || !vis(el)) return;
    const st = getComputedStyle(el);
    const h = parseFloat(st.height);
    if (h >= 28) return;
    out.boxes.push({ tag: el.tagName.toLowerCase(), type: el.type, id: el.id,
      h: +h.toFixed(1), w: +parseFloat(st.width).toFixed(1),
      cssW: st.width, cssH: st.height, appearance: st.appearance,
      pad: st.padding, border: st.borderWidth, box: st.boxSizing,
      chain: chain(el.parentElement) });
  });

  Array.prototype.forEach.call(ed.querySelectorAll('.editor-field.full'), (el) => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    let inner = 0;
    el.querySelectorAll('*').forEach(k => { const kr = k.getBoundingClientRect();
      if (kr.width > 0 && kr.right - r.left > inner) inner = kr.right - r.left; });
    out.fulls.push({ w: Math.round(r.width), innerRight: Math.round(inner),
      gap: Math.round(r.width - inner), border: getComputedStyle(el).borderWidth,
      first: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 36) });
  });
  return out;
};

const run = async () => {
  const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO,
    viewport: { width: WIDTHS[0], height: HEIGHT } });
  try {
    const seed = await page.evaluate(SEED);
    if (!seed.ok) throw new Error('seed failed');
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: HEIGHT });
      await openCardEditor(page, seed.id);
      await page.evaluate(P, { open: OPEN });
      await page.waitForTimeout(140);
      const r = await page.evaluate(P, { open: OPEN });
      console.log('\n===== ' + w + ' =====');
      console.log('LABELS PAST 2 LINES: ' + r.labels.length);
      r.labels.forEach(l => console.log(`  [${l.hL}h/${l.rL}r] w=${l.w} len=${l.len} f=${l.f} lh=${l.lh} :: "${l.t.slice(0, 72)}"\n      in ${l.chain}`));
      const bySig = {};
      r.boxes.forEach(b => { const k = b.tag + ':' + b.type + ' h=' + b.h + ' w=' + b.w + ' app=' + b.appearance + ' | ' + b.chain;
        bySig[k] = (bySig[k] || 0) + 1; });
      console.log('CONTROLS UNDER 28px: ' + r.boxes.length);
      Object.keys(bySig).forEach(k => console.log('  x' + bySig[k] + '  ' + k));
      const wide = r.fulls.filter(f => f.gap > 60);
      console.log('FULL BLOCKS with >60px empty right: ' + wide.length + ' of ' + r.fulls.length);
      wide.slice(0, 6).forEach(f => console.log(`  w=${f.w} innerRight=${f.innerRight} gap=${f.gap} border=${f.border} :: ${f.first}`));
    }
  } finally { await close(); }
};
await run();
