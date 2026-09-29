/* 🔬 _FW-PROBE-LABELW — how wide would a track have to be for EVERY label in
   the card editor to fit in two lines? The bar asks for it; nobody has costed
   it. For every visible <label> this measures the nowrap width of its own text
   in its own computed font and divides by two, which is the exact container
   width that clause needs. Reports the distribution, not just the max, so the
   trade (track floor -> column count -> density) can be priced.
   Run: node .gauntlet/_fw-probe-labelw.mjs                                   */
import { bootPage, openCardEditor, REPO } from './_forge-harness.mjs';

const WIDTHS = [1600, 1080];
const HEIGHT = 1000;
const TYPES = ['unit', 'spell', 'trap', 'weather', 'location', 'counter', 'wall'];

const SEED = ({ type }) => {
  const src = (typeof UNIT_CARDS !== 'undefined' && UNIT_CARDS.length) ? UNIT_CARDS[0] : null;
  if (!src) return { ok: false };
  const c = JSON.parse(JSON.stringify(src));
  c.id = 'fw_probe_' + type; c.type = type;
  Forge.customCards = [c];
  return { ok: true, id: c.id };
};

const M = () => {
  const vis = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const ed = document.querySelector('.card-editor.fx-two');
  if (!ed) return { ok: false };
  ed.querySelectorAll('details').forEach(d => { d.open = true; });
  const ruler = document.createElement('span');
  ruler.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:pre;visibility:hidden';
  document.body.appendChild(ruler);
  const rows = [];
  ed.querySelectorAll('label').forEach((el) => {
    if (!vis(el)) return;
    const st = getComputedStyle(el);
    const f = parseFloat(st.fontSize);
    let lh = parseFloat(st.lineHeight); if (!isFinite(lh)) lh = f * 1.2;
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!t) return;
    ruler.style.font = st.font || (st.fontStyle + ' ' + st.fontVariant + ' ' + st.fontWeight + ' ' + st.fontSize + '/' + st.lineHeight + ' ' + st.fontFamily);
    ruler.style.fontFamily = st.fontFamily; ruler.style.fontSize = st.fontSize;
    ruler.style.fontWeight = st.fontWeight; ruler.style.letterSpacing = st.letterSpacing;
    ruler.style.textTransform = st.textTransform; ruler.style.fontStyle = st.fontStyle;
    ruler.textContent = t;
    const oneLine = ruler.getBoundingClientRect().width;
    const cw = el.clientWidth;
    const padX = parseFloat(st.paddingLeft) + parseFloat(st.paddingRight);
    const lines = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
    rows.push({ t: t.slice(0, 58), len: t.length, one: Math.round(oneLine),
      need2: Math.ceil(oneLine / 2 + padX + 2), cw, lines, f });
  });
  ruler.remove();
  return { ok: true, rows };
};

const run = async () => {
  const { page, close } = await bootPage({ cwd: process.cwd(), assetsFrom: REPO,
    viewport: { width: WIDTHS[0], height: HEIGHT } });
  const worst = new Map();
  try {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: HEIGHT });
      for (const ty of TYPES) {
        const seed = await page.evaluate(SEED, { type: ty });
        if (!seed.ok) continue;
        await openCardEditor(page, seed.id);
        await page.evaluate(M);
        await page.waitForTimeout(90);
        const r = await page.evaluate(M);
        if (!r.ok) { console.log(`${w} ${ty}: NO EDITOR`); continue; }
        let over = 0;
        for (const row of r.rows) {
          if (row.lines > 2) over++;
          const k = row.t;
          if (!worst.has(k) || worst.get(k).need2 < row.need2) worst.set(k, row);
        }
        console.log(`${w} ${ty}: labels=${r.rows.length} over2=${over}`);
      }
    }
  } finally { await close(); }
  const all = [...worst.values()].sort((a, b) => b.need2 - a.need2);
  console.log('\n=== WIDTH NEEDED FOR 2 LINES — top 25 of ' + all.length + ' distinct labels ===');
  all.slice(0, 25).forEach(r => console.log(`  need2=${r.need2}px one=${r.one}px len=${r.len} f=${r.f} :: ${r.t}`));
  const buckets = [260, 300, 340, 380, 420, 460, 520, 600, 800];
  console.log('\n=== how many labels still exceed 2 lines at a given track width ===');
  for (const b of buckets) console.log(`  track ${b}px -> ${all.filter(r => r.need2 > b).length} labels over 2 lines`);
};
await run();
