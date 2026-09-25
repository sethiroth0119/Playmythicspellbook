// CRITIC-3 independent driver. Does NOT use the builder's driver, its whitelist,
// or its harness loosening. Measures visibility with checkVisibility({opacity...}).
import { bootPage, openCardEditor } from './_forge-harness.mjs';
import fs from 'fs';

const CWD = process.argv[2] || 'D:/game-deploy';
const OUT = process.argv[3] || 'D:/game-deploy/.gauntlet/_crit3-fxgate.json';

const ctx = await bootPage({ cwd: CWD, viewport: { width: 1400, height: 1200 } });
const { page } = ctx;
await openCardEditor(page, 'NEW', {});

// Open every <details> in the editor WITHOUT touching any fx-* class or display.
const opened = await page.evaluate(() => {
  let n = 0;
  document.querySelectorAll('.card-editor details').forEach(d => { if (!d.open) { d.open = true; n++; } });
  return n;
});

const ids = await page.evaluate(() => (typeof ONPLAY_TYPES !== 'undefined' ? ONPLAY_TYPES : []).map(t => t.id));

const BLOCKS = ['ed-onplay','ed-grave','ed-ongrave','ed-onatk','ed-onkill','ed-field','ed-hand',
  'ed-onplayx-0','ed-onplayx-1','ed-onplayx-2','ed-onplayx-3','ed-onplayx-4','ed-onplayx-5'];

const present = await page.evaluate((bs) => bs.filter(b => !!document.getElementById(b + '-type')), BLOCKS);

// baseline: how many controls exist in the DOM per block (ungated denominator)
const domCount = await page.evaluate((bs) => {
  const CV = { opacityProperty:true, visibilityProperty:true, contentVisibilityAuto:true };
  const o = {};
  bs.forEach(b => {
    const els = [...document.querySelectorAll('.card-editor input[id],.card-editor select[id],.card-editor textarea[id]')]
      .filter(e => e.id.indexOf(b + '-') === 0);
    o[b] = { dom: els.length, vis: els.filter(e => e.checkVisibility(CV)).length };
  });
  return o;
}, present);

const rows = {};
for (const eff of ids) {
  const r = await page.evaluate(({ eff, bs }) => {
    const CV = { opacityProperty:true, visibilityProperty:true, contentVisibilityAuto:true };
    // set every block's picker to this effect, with real events
    const set = [];
    bs.forEach(b => {
      const s = document.getElementById(b + '-type');
      if (!s) return;
      const has = [...s.options].some(o => o.value === eff);
      if (!has) { set.push(b + ':MISSING'); return; }
      s.value = eff;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const out = { missing: set, blocks: {}, domTotal: document.querySelectorAll('.card-editor input[id],.card-editor select[id],.card-editor textarea[id]').length };
    bs.forEach(b => {
      const els = [...document.querySelectorAll('.card-editor input[id],.card-editor select[id],.card-editor textarea[id]')]
        .filter(e => e.id.indexOf(b + '-') === 0);
      out.blocks[b] = {
        dom: els.length,
        visIds: els.filter(e => e.checkVisibility(CV)).map(e => e.id.slice(b.length + 1)).sort(),
      };
    });
    // sweep coherence, document-wide
    const emptySec = [];
    document.querySelectorAll('.fx-sec,.fx-sub').forEach(sec => {
      if (!sec.checkVisibility(CV)) return;
      let live = 0;
      sec.querySelectorAll('.editor-field').forEach(f => { if (f.checkVisibility(CV)) live++; });
      if (live === 0) emptySec.push(sec.id || sec.className);
    });
    const badChips = [];
    document.querySelectorAll('[data-fx-go]').forEach(bn => {
      if (!bn.checkVisibility(CV)) return;
      const sec = document.getElementById('fx-' + bn.dataset.fxGo);
      if (!sec || !sec.checkVisibility(CV)) badChips.push(bn.dataset.fxGo);
    });
    out.emptySec = emptySec; out.badChips = badChips;
    out.onplayH = Math.round((document.getElementById('fx-onplay') || {}).scrollHeight || 0);
    return out;
  }, { eff, bs: present });
  rows[eff] = r;
}

// nine ability drawers by name
const drawers = await page.evaluate(() => {
  const names = [...document.querySelectorAll('#fx-ingrave .editor-grid > *')].map(n => (n.textContent||'').slice(0,40));
  const igIds = [...document.querySelectorAll('[id^="ed-ig-"]')].length;
  return { topLevelChildren: names.length, igIds, sample: names.slice(0,12) };
});

// legibility floor: font sizes + column widths inside the on-play block
const legibility = await page.evaluate(() => {
  const CV = { opacityProperty:true, visibilityProperty:true, contentVisibilityAuto:true };
  const host = document.getElementById('fx-onplay');
  if (!host) return null;
  const els = [...host.querySelectorAll('label, .small-text, input, select')].filter(e => e.checkVisibility(CV));
  const fs = els.map(e => parseFloat(getComputedStyle(e).fontSize)).filter(x => x > 0);
  const ws = [...host.querySelectorAll('input,select')].filter(e => e.checkVisibility(CV))
    .map(e => Math.round(e.getBoundingClientRect().width)).filter(x => x > 0);
  const grid = host.querySelector('.editor-grid');
  return {
    n: els.length,
    minFont: Math.min(...fs), medFont: fs.sort((a,b)=>a-b)[Math.floor(fs.length/2)],
    minCtrlW: Math.min(...ws), medCtrlW: ws.sort((a,b)=>a-b)[Math.floor(ws.length/2)],
    gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
    gridFont: grid ? getComputedStyle(grid).fontSize : null,
  };
});

// round trip in memory: paintSurface value -> drawCards -> back -> capture
const roundTrip = await page.evaluate(() => {
  const setSel = (id, v) => { const e = document.getElementById(id); if (!e) return false;
    e.value = v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; };
  setSel('ed-onplay-type','paintSurface');
  const okS = setSel('ed-onplay-surface','grease');
  const a = document.getElementById('ed-onplay-amount'); a.value = '37';
  a.dispatchEvent(new Event('input',{bubbles:true})); a.dispatchEvent(new Event('change',{bubbles:true}));
  setSel('ed-onplay-type','drawCards');
  const hiddenCap = {}; { const c = {}; captureEditorIntoCard(c); hiddenCap.surfaceType = c.onPlay && c.onPlay.surfaceType; hiddenCap.amount = c.onPlay && c.onPlay.amount; }
  setSel('ed-onplay-type','paintSurface');
  const c2 = {}; captureEditorIntoCard(c2);
  return { okS, whileHidden: hiddenCap, back: { surfaceType: c2.onPlay && c2.onPlay.surfaceType, amount: c2.onPlay && c2.onPlay.amount } };
});

fs.writeFileSync(OUT, JSON.stringify({ opened, present, domCount, rows, drawers, legibility, roundTrip, errors: ctx.errors }, null, 1));
console.log('blocks present:', present.join(' '));
console.log('details opened:', opened, 'pageerrors:', ctx.errors.length);
console.log('drawers:', JSON.stringify(drawers));
console.log('legibility:', JSON.stringify(legibility));
console.log('roundTrip:', JSON.stringify(roundTrip));
const eff0 = rows['drawCards'];
console.log('drawCards onplay vis:', eff0.blocks['ed-onplay'].visIds.length, 'of', eff0.blocks['ed-onplay'].dom);
console.log('wrote', OUT);
await ctx.close();
